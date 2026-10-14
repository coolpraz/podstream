/* Multi-tab viewer: VNC streams (noVNC) and web consoles (xterm.js) share the
 * viewer bar — background tabs stay connected while others are on screen. */

import RFB from '/vendor/novnc/core/rfb.js';
import { Terminal } from '/vendor/xtermjs/xterm.mjs';

import { state } from './state.js';
import { $, el } from './ui.js';
import { getToken } from './api.js';

export function openConsole(session) {
  const tabId = 'term-' + session.id;
  if (state.viewers.has(tabId)) {
    activateViewer(tabId);
    return;
  }

  $('#viewer').classList.remove('hidden');

  const label = `${session.name || session.hostname || session.id} — console`;
  const tab = el('button', 'vtab');
  tab.append(el('span', 'vtab-name', '⌨ ' + label), el('span', 'vtab-x', '✕'));
  tab.title = label;
  tab.addEventListener('click', () => activateViewer(tabId));
  tab.querySelector('.vtab-x').addEventListener('click', (e) => {
    e.stopPropagation();
    closeViewer(tabId);
  });
  $('#viewer-tabs').append(tab);

  const screen = el('div', 'vnc-screen');
  $('#viewer-stack').append(screen);

  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(proto + location.host + '/ws/term/' + session.id + (getToken() ? `?token=${encodeURIComponent(getToken())}` : ''));
  ws.binaryType = 'arraybuffer';

  const term = new Terminal({
    fontSize: 14,
    cursorBlink: true,
    theme: { background: '#0c0c0c' },
    scrollback: 5000,
  });
  term.open(screen);
  term.focus();

  ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
  ws.onclose = () => closeViewer(tabId);
  ws.onerror = () => term.write('\r\n\x1b[31m[connection error]\x1b[0m\r\n');
  term.onData((d) => { if (ws.readyState === 1) ws.send(d); });
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === 1) ws.send('\x00RESIZE ' + cols + 'x' + rows);
  });
  term.resize(120, 34);

  state.viewers.set(tabId, {
    id: tabId,
    name: label,
    kind: 'term',
    term,
    ws,
    screen,
    tab,
    scaling: false,
  });
  activateViewer(tabId);
}

function updateRestorePill() {
  const minimized = $('#viewer').classList.contains('hidden');
  const n = state.viewers.size;
  $('#restore-pill').classList.toggle('hidden', !minimized || n === 0);
  $('#restore-count').textContent = n;
}

export function minimizeViewer() {
  $('#viewer').classList.add('hidden');
  updateRestorePill();
}

export function restoreViewer() {
  if (!state.viewers.size) return;
  $('#viewer').classList.remove('hidden');
  activateViewer(
    state.activeViewer && state.viewers.has(state.activeViewer)
      ? state.activeViewer
      : [...state.viewers.keys()][0]
  );
  updateRestorePill();
}

export function openViewer(session) {
  if (state.viewers.has(session.id)) {
    activateViewer(session.id);
    return;
  }

  $('#viewer').classList.remove('hidden');

  const password = session.vncPassword ?? prompt('VNC password (default for accetto images: headless):', 'headless');

  const t = state.templates.find((x) => x.id === session.template);
  const label = session.name || `${(t && t.name) || session.template} — ${session.id}`;

  const tab = el('button', 'vtab');
  tab.append(el('span', 'vtab-name', label), el('span', 'vtab-x', '✕'));
  tab.title = label;
  tab.addEventListener('click', () => activateViewer(session.id));
  tab.querySelector('.vtab-x').addEventListener('click', (e) => {
    e.stopPropagation();
    closeViewer(session.id);
  });
  $('#viewer-tabs').append(tab);

  const screen = el('div', 'vnc-screen');
  $('#viewer-stack').append(screen);

  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const url = proto + location.host + '/ws/vnc/' + session.id + (getToken() ? `?token=${encodeURIComponent(getToken())}` : '');

  const rfb = new RFB(screen, url, { shared: true });
  rfb.scaleViewport = true;
  rfb.background = '#000';

  rfb.addEventListener('connect', () => tab.classList.add('ok'));
  rfb.addEventListener('disconnect', () => closeViewer(session.id));
  rfb.addEventListener('credentialsrequired', () => {
    if (state.viewers.has(session.id)) rfb.sendCredentials({ password: password || '' });
  });
  rfb.addEventListener('securityfailure', (e) => {
    const reason = (e.detail && (e.detail.reason || e.detail)) || '';
    tab.classList.add('err');
    tab.title = `auth failed: ${reason}`;
  });
  rfb.addEventListener('clipboard', (e) => {
    if (navigator.clipboard) navigator.clipboard.writeText(e.detail.text).catch(() => {});
  });

  state.viewers.set(session.id, {
    id: session.id,
    name: label,
    rfb,
    screen,
    tab,
    scaling: true,
    password: password || '',
  });
  activateViewer(session.id);
}

function activateViewer(id) {
  state.activeViewer = id;
  for (const [vid, v] of state.viewers) {
    v.screen.classList.toggle('hidden', vid !== id);
    v.tab.classList.toggle('active', vid === id);
  }
  const v = state.viewers.get(id);
  if (v && v.kind === 'term' && v.term) v.term.focus();
  window.dispatchEvent(new Event('resize'));
}

export function closeViewer(id) {
  const v = state.viewers.get(id);
  if (!v) return;
  state.viewers.delete(id);
  if (v.kind === 'term') {
    try { v.ws.close(); } catch { /* already gone */ }
    try { v.term.dispose(); } catch { /* already gone */ }
  } else {
    try {
      v.rfb.disconnect();
    } catch { /* already gone */ }
  }
  v.screen.remove();
  v.tab.remove();
  if (state.activeViewer === id) {
    const next = [...state.viewers.keys()][0];
    if (next) activateViewer(next);
    else {
      state.activeViewer = null;
      $('#viewer').classList.add('hidden');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }
  updateRestorePill();
}

export function activeViewer() {
  return state.viewers.get(state.activeViewer);
}

export function closeDeadViewers(aliveIds) {
  for (const id of [...state.viewers.keys()]) {
    if (!aliveIds.has(id)) closeViewer(id);
  }
}
