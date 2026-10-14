/* Marketplace: quay.io repos in your namespace + background pull jobs. */

import { state } from '../state.js';
import { $, el } from '../ui.js';
import { api } from '../api.js';

export async function refreshMarketplace() {
  try {
    state.marketplace = await api('/api/marketplace');
    if (state.page === 'marketplace') renderMarketplace();
  } catch { /* keep last view */ }
}

export function renderMarketplace() {
  const c = $('#page-content');
  c.innerHTML = '';
  const m = state.marketplace || {};
  if (m.error) c.append(el('div', 'empty', `quay.io listing failed: ${m.error}`));

  const pulls = m.pulls || [];
  const pullState = {};
  for (const j of pulls) pullState[j.ref] = j;

  const grid = el('div', 'grid cols-3');
  for (const r of m.repos || []) {
    const ref = r.ref;
    const job = pullState[ref];
    const card = el('div', 'card');
    const head = el('div', 'session-head');
    head.append(el('span', 'icon', '🏷️'), el('span', '', r.name));
    card.append(head);
    if (r.description) card.append(el('div', 'pick-desc', r.description));
    card.append(el('div', 'muted', ref));
    const foot = el('div', 'actions');

    const vis = el('span', 'badge info', r.visibility);
    foot.append(vis);

    if (job && job.status === 'pulling') {
      foot.append(el('span', 'badge warn', 'pulling…'));
    } else if (r.local) {
      foot.append(el('span', 'badge ok', 'available locally'));
    } else if (job && job.status === 'error') {
      const errWrap = el('div', '', '');
      errWrap.style.display = 'flex';
      errWrap.style.gap = '6px';
      errWrap.style.alignItems = 'center';
      errWrap.append(el('span', 'badge err', 'failed'));
      const retry = el('button', 'small', 'Retry');
      retry.addEventListener('click', () => pullImage(r.name));
      errWrap.append(retry);
      foot.append(errWrap);
    } else {
      const pull = el('button', 'primary small', 'Pull');
      pull.addEventListener('click', () => {
        pull.disabled = true;
        pullImage(r.name);
      });
      foot.append(pull);
    }
    card.append(foot);
    grid.append(card);
  }
  c.append(grid);

  if (pulls.length) {
    c.append(el('h2', 'section', 'Pull jobs'));
    const t = el('table', '');
    for (const j of pulls) {
      const tr = el('tr');
      tr.append(el('td', '', j.ref));
      tr.append(el('td', '', j.status === 'done' ? '✓ pulled' : j.status === 'error' ? `failed: ${j.error || ''}` : j.status));
      tr.append(el('td', '', `${Math.round((Date.now() - j.startedAt) / 1000)}s ago`));
      t.append(tr);
    }
    c.append(t);
  }
}

async function pullImage(name) {
  try {
    await api('/api/marketplace/pull', { method: 'POST', body: JSON.stringify({ name }) });
    await refreshMarketplace();
  } catch (e) {
    alert(`Pull failed: ${e.message}`);
  }
}
