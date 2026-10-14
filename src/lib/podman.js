'use strict';

const { execFile, spawn } = require('child_process');

const { PODMAN } = require('../config');
const { runtime } = require('../state');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeout || 60 * 1000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            err.code === 'ENOENT'
              ? `cannot execute '${cmd}': not found (set PODMAN_BIN?)`
              : `${cmd} ${args[0]} failed: ${String(err.message).split('\n')[0].slice(0, 200)}`
          );
          e.stderr = String(stderr || '');
          e.status = err.code === 'ENOENT' ? 500 : 502;
          reject(e);
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      }
    );
  });
}

async function podman(args, opts) {
  const { stdout } = await run(PODMAN, args, opts);
  return stdout.trim();
}

async function checkPodman() {
  try {
    const out = await podman(['--version'], { timeout: 10 * 1000 });
    runtime.podmanVersion = out.replace(/^podman version\s*/i, '');
  } catch {
    runtime.podmanVersion = null;
  }
}

/** Parse `podman port NAME` output for a container port; null when absent. */
function parseHostPort(out, displayPort) {
  // lines look like:  5901/tcp -> 127.0.0.1:41235
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\/tcp\s+->\s+\S+:(\d+)\s*$/);
    if (m && parseInt(m[1], 10) === displayPort) return parseInt(m[2], 10);
  }
  return null;
}

async function getHostPort(name, displayPort) {
  const out = await podman(['port', name]);
  return parseHostPort(out, displayPort);
}

async function imageExists(ref) {
  try {
    await podman(['image', 'exists', ref]);
    return true;
  } catch {
    return false;
  }
}

/** `podman pull` with stderr progress streamed line-by-line to onProgress
 *  (podman renders live transfer bars as \r-overwritten lines on stderr). */
function podmanPullStreaming(ref, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(PODMAN, ['pull', ref], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let lastErr = '';
    const feed = (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split(/[\r\n]+/);
      buf = parts.pop() || '';
      for (const line of parts) {
        if (line.trim()) onProgress(line.trim().slice(0, 160));
      }
      if (buf.trim()) onProgress(buf.trim().slice(0, 160));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', (chunk) => {
      feed(chunk);
      const lines = chunk.toString('utf8').split(/[\r\n]+/).filter((l) => l.trim());
      if (lines.length) lastErr = lines[lines.length - 1].slice(0, 200);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(lastErr || `podman pull ${ref} failed (exit ${code})`));
    });
  });
}

/** The container's IP on the given (bridge) network; null when it has none. */
async function containerIp(containerName, netName) {
  try {
    const out = await podman([
      'inspect', '-f',
      `{{(index .NetworkSettings.Networks "${netName}").IPAddress}}`,
      containerName,
    ]);
    return out || null;
  } catch {
    return null;
  }
}

module.exports = {
  run,
  podman,
  checkPodman,
  parseHostPort,
  getHostPort,
  imageExists,
  podmanPullStreaming,
  containerIp,
};
