/* Polling data refreshers — pull API state into `state` and re-render pages. */

import { state } from './state.js';
import { $ } from './ui.js';
import { api } from './api.js';
import { render } from './router.js';
import { closeDeadViewers } from './viewer.js';

export async function refreshSessions() {
  try {
    state.sessions = await api('/api/sessions');
    if (state.page === 'instances' || state.page === 'dashboard') render();
    closeDeadViewers(aliveViewerIds());
  } catch { /* keep last view */ }
}

export async function refreshLabs() {
  try {
    state.labs = await api('/api/labs');
    if (state.page === 'labs') render();
    const alive = new Set(state.sessions.map((s) => s.id));
    for (const lab of state.labs) for (const m of lab.members) if (m.kind === 'desktop') alive.add(m.id);
    closeDeadViewers(alive);
  } catch { /* keep last view */ }
}

export async function refreshImages() {
  try {
    state.images = await api('/api/images');
    if (state.page === 'images') render();
  } catch { /* keep last view */ }
}

export async function refreshStats() {
  try {
    state.stats = await api('/api/stats');
    if (state.page === 'dashboard') render();
  } catch { /* keep last view */ }
}

export function aliveViewerIds() {
  const set = new Set(state.sessions.map((s) => s.id));
  for (const lab of state.labs) for (const m of lab.members) if (m.kind === 'desktop') set.add(m.id);
  return set;
}

export async function pollHealth() {
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    const dot = $('#podman-dot');
    dot.className = `dot ${h.podman ? 'ok' : 'warn'}`;
    $('#podman-ver').textContent = h.podman ? `podman ${h.podman}` : 'podman unavailable';
  } catch { /* keep last state */ }
}
