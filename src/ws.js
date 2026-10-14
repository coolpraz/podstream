'use strict';

const net = require('net');

const { WebSocketServer } = require('ws');

const { AUTH_TOKEN } = require('./config');
const { cockpitEntry } = require('./cockpit');
const { openTerminal } = require('./console-session');
const { labs, sessions } = require('./state');
const { getTemplate } = require('./templates');

/** Resolve /ws/vnc|term/:id to a streaming target (plain session or lab pod). */
function resolveSessionTarget(kind, mid) {
  if (kind === 'vnc') {
    const s = sessions.get(mid);
    if (s && s.status === 'running') return { port: s.port, id: mid };
  }
  if (kind === 'term') {
    // plain sessions: shell in the instance's own container
    const s = sessions.get(mid);
    if (s && s.status === 'running') {
      const tpl = getTemplate(s.template);
      const termUser = (tpl && tpl.termUser) || 'user';
      return { kind: 'term', containerName: s.name, id: mid, termUser, termHome: `/home/${termUser}` };
    }
  }
  for (const lab of labs.values()) {
    const dm = lab.members.find((x) => x.id === mid && x.kind === 'desktop' && x.status === 'running');
    if (dm) {
      return kind === 'term'
        ? { kind: 'term', containerName: dm.containerName, id: dm.id, termUser: dm.termUser || 'user', termHome: `/home/${dm.termUser || 'user'}` }
        : { port: dm.vncPort, id: dm.id };
    }
  }
  return null;
}

/** Wire upgrade routing (cockpit proxy + vnc/term streaming) onto the server. */
function attach(server) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false, // RFB is already compressed-ish; keep latency low
    handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false), // what noVNC expects
  });

  server.on('upgrade', (req, socket, head) => {
    // cockpit (per-instance web console): raw TCP pipe to cockpit-ws inside the
    // container (port 9090). The raw upgrade request is replayed into the
    // container through its published 127.0.0.1 edge.
    const cmatch = (req.url || '').match(/^\/cockpit\/([0-9a-f]{8})(\/.*)?$/);
    if (cmatch) {
      const entry = cockpitEntry(cmatch[1]);
      const authed = !AUTH_TOKEN ||
        new URL(`http://x${req.url}`).searchParams.get('token') === AUTH_TOKEN ||
        req.headers.authorization === `Bearer ${AUTH_TOKEN}`;
      if (!entry || !authed || !entry.port) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const dest = net.connect(entry.port, '127.0.0.1');
      const raw = `${req.method} ${cmatch[2] || '/'} HTTP/1.1\r\n` +
        req.rawHeaders.map((h, i) => (i % 2 === 0 ? `${h}: ${req.rawHeaders[i + 1]}` : null)).filter(Boolean).join('\r\n') +
        '\r\n\r\n';
      dest.on('connect', () => { dest.write(raw); if (head && head.length) dest.write(head); });
      socket.on('error', () => dest.destroy());
      dest.on('error', () => socket.destroy());
      dest.on('close', () => socket.destroy());
      socket.on('close', () => dest.destroy());
      dest.pipe(socket);
      socket.pipe(dest);
      return;
    }

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    const m = url.pathname.match(/^\/ws\/(vnc|term)\/([0-9a-f]{8})$/);
    const kind = m && m[1];
    const mid = m && m[2];
    const session = m ? resolveSessionTarget(kind, mid) : null;

    const authorized = !AUTH_TOKEN || url.searchParams.get('token') === AUTH_TOKEN;
    if (!session || !authorized || (kind === 'vnc' && !session.port)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, session));
  });

  wss.on('connection', async (ws, req, session) => {
    // Web console (terminal) sessions bridge to an interactive shell inside the
    // container; everything else streams VNC.
    if (session.kind === 'term') return openTerminal(ws, session);

    console.log(`[${session.id}] vnc client connected (${ws._socket.remoteAddress})`);
    const target = net.connect(session.port, '127.0.0.1');

    ws.on('message', (data) => {
      if (target.writable) target.write(data);
    });
    target.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    });

    const cleanup = () => {
      target.destroy();
      if (ws.readyState <= ws.OPEN) ws.terminate();
      console.log(`[${session.id}] vnc client disconnected`);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
    target.on('close', () => ws.close());
    target.on('error', () => ws.close());
  });

  return wss;
}

module.exports = { attach };
