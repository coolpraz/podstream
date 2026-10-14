'use strict';

const { spawn } = require('child_process');

// node-pty (optional): real host-side PTY for web consoles. Without it the
// console falls back to `script`-wrapped pipes (readline degraded).
let pty = null;
try {
  pty = require('node-pty');
} catch {
  pty = null;
}

const { PODMAN, ROOT } = require('./config');
const { podman } = require('./lib/podman');

/** Bridge a web-console WebSocket to an interactive shell inside the
 *  instance's container via `podman exec`. With node-pty, `exec -t` gives full
 *  readline/colors and live resize; otherwise `script` allocates the PTY
 *  container-side (readline degraded). */
async function openTerminal(ws, session) {
  // Guard: refuse consoles for containers that no longer exist, so the tab
  // fails with a clear close instead of a zombie session.
  const exists = await podman(['container', 'exists', session.containerName]).then(() => true).catch(() => false);
  if (!exists) {
    console.log(`[${session.id}] console refused: container ${session.containerName} is gone`);
    try { ws.close(1011, 'instance container is gone — relaunch it'); } catch { /* gone */ }
    return;
  }
  console.log(`[${session.id}] console opened on ${session.containerName}`);
  let child;
  let termProc = null;
  if (pty) {
    // Real host-side PTY: full readline, colors, and live resize through
    // `podman exec -t` (conmon propagates the size into the container).
    termProc = pty.spawn(PODMAN, [
      'exec', '-it', '-e', 'TERM=xterm-256color',
      '-w', session.termHome,
      '-u', session.termUser,
      session.containerName, 'bash', '-l',
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: ROOT,
      env: process.env,
    });
    termProc.onData((d) => { if (ws.readyState === ws.OPEN) ws.send(typeof d === 'string' ? d : Buffer.from(d)); });
    termProc.onExit(({ exitCode }) => {
      console.log(`[${session.id}] console exited (${exitCode})`);
      try { ws.close(1000, 'shell exited'); } catch { /* gone */ }
    });
    ws.on('message', (data) => {
      const s = data.toString('utf8');
      if (s.startsWith('\x00RESIZE ')) {
        const [cols, rows] = s.slice(8).split('x').map((n) => parseInt(n, 10) || 0);
        if (cols && rows && termProc) {
          try { termProc.resize(cols, rows); } catch { /* gone */ }
        }
        return;
      }
      // node-pty's IPty exposes write() directly — it has no .stdin
      if (termProc) termProc.write(s);
    });
    ws.on('close', () => { try { termProc.kill(); } catch { /* gone */ } });
    ws.on('error', () => { try { termProc.kill(); } catch { /* gone */ } });
    return;
  }
  try {
    child = spawn(PODMAN, [
      'exec', '-i', '-e', 'TERM=xterm-256color',
      '-w', session.termHome,
      '-u', session.termUser,
      session.containerName, 'script', '-qfc', 'bash -l', '/dev/null',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    try { ws.close(1011, 'console failed to start'); } catch { /* gone */ }
    return;
  }
  child.stdout.on('data', (d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
  child.stderr.on('data', (d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
  ws.on('message', (data) => {
    const s = data.toString('utf8');
    if (s.startsWith('\x00RESIZE ')) {
      const [cols, rows] = s.slice(8).split('x').map((n) => parseInt(n, 10) || 0);
      if (cols && rows) {
        spawn(PODMAN, ['exec', session.containerName, 'stty', `rows ${rows}`, `cols ${cols}`],
          { stdio: 'ignore', timeout: 5000 }).on('error', () => {});
      }
      return;
    }
    if (child.stdin.writable) child.stdin.write(s);
  });
  const cleanupTerm = () => { try { child.kill('SIGHUP'); } catch { /* gone */ } try { child.kill(); } catch { /* gone */ } };
  ws.on('close', cleanupTerm);
  ws.on('error', cleanupTerm);
  child.on('exit', () => { if (ws.readyState === ws.OPEN) ws.close(1000); });
  child.on('error', () => { try { ws.close(1011, 'console process failed'); } catch { /* gone */ } });
}

module.exports = { openTerminal };
