/* Boot: toolbar wiring, config load, polling, first render. */

import { state } from './state.js';
import { $, el } from './ui.js';
import { api } from './api.js';
import { PAGES, render } from './router.js';
import {
  closeViewer,
  activeViewer,
  minimizeViewer,
  restoreViewer,
} from './viewer.js';
import {
  refreshSessions,
  refreshLabs,
  refreshImages,
  refreshStats,
  pollHealth,
} from './refresh.js';
import { refreshMarketplace } from './pages/marketplace.js';
import { createLab } from './pages/labs.js';

async function init() {
  $('#btn-disconnect').addEventListener('click', () => {
    if (state.activeViewer) closeViewer(state.activeViewer);
  });
  $('#viewer-min').addEventListener('click', minimizeViewer);
  $('#restore-pill').addEventListener('click', restoreViewer);

  $('#btn-scale').addEventListener('click', () => {
    const v = activeViewer();
    if (!v) return;
    v.scaling = !v.scaling;
    v.rfb.scaleViewport = v.scaling;
    $('#btn-scale').textContent = `Scale: ${v.scaling ? 'on' : 'off'}`;
    // noVNC re-layouts on window resize — nudge it after the mode switch
    window.dispatchEvent(new Event('resize'));
  });
  $('#btn-fullscreen').addEventListener('click', () => {
    const v = activeViewer();
    if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else v.screen.requestFullscreen().catch(() => {});
  });
  $('#btn-cad').addEventListener('click', () => {
    const v = activeViewer();
    if (v && v.kind !== 'term') v.rfb.sendCtrlAltDel();
  });
  $('#btn-paste').addEventListener('click', async () => {
    const v = activeViewer();
    if (!v || !navigator.clipboard) return;
    try {
      if (v.kind === 'term') {
        v.term.write(await navigator.clipboard.readText());
      } else {
        v.rfb.clipboardPasteFrom(await navigator.clipboard.readText());
      }
    } catch { /* clipboard permission denied */ }
  });

  // initial page from the URL hash (default: dashboard)
  const initial = (location.hash || '').replace(/^#\//, '');
  if (PAGES[initial]) state.page = initial;

  try {
    render(); // paint the shell immediately; data fills in as it arrives
  } catch (err) {
    console.error('RENDER THROW: ' + (err.stack || err.message || String(err)));
  }

  pollHealth();
  setInterval(pollHealth, 15000);

  let cfgLoaded = false;
  try {
    const cfg = await api('/api/config');
    state.templates = cfg.templates || [];
    state.plans = cfg.plans || [];
    state.podTargets = cfg.podTargets || [];
    if (!state.deploy.template) state.deploy.template = state.templates[0]?.id || null;
    const sel = $('#lab-desktop');
    if (sel) {
      sel.innerHTML = '';
      for (const t of state.templates) {
        const opt = el('option', '', `${t.icon || ''} ${t.name}`.trim());
        opt.value = t.id;
        sel.append(opt);
      }
    }
    $('#lab-create').addEventListener('click', createLab);
    cfgLoaded = true;
  } catch (e) {
    $('#page-content').append(el('div', 'empty', `Failed to load config: ${e.message}`));
  }

  refreshSessions();
  refreshLabs();
  refreshImages();
  refreshStats();
  refreshMarketplace();
  setInterval(refreshSessions, 2500);
  setInterval(refreshLabs, 5000);
  setInterval(refreshImages, 10000);
  setInterval(refreshStats, 10000);
  setInterval(refreshMarketplace, 10000);

  render();
  if (!cfgLoaded) {
    // config failed (e.g. server was starting) — retry once after a beat
    setTimeout(async () => {
      try {
        const cfg = await api('/api/config');
        state.templates = cfg.templates || [];
        state.plans = cfg.plans || [];
        state.podTargets = cfg.podTargets || [];
        if (!state.deploy.template) state.deploy.template = state.templates[0]?.id || null;
        render();
      } catch { /* next poll cycle covers the rest */ }
    }, 3000);
  }
}

init();
