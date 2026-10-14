/* Labs: multi-pod engagement networks — members, add pod/target, stream. */

import { state } from '../state.js';
import { $, el, badge } from '../ui.js';
import { api } from '../api.js';
import { openViewer, openConsole } from '../viewer.js';
import { refreshLabs } from '../refresh.js';

export async function createLab() {
  const desktop = $('#lab-desktop').value;
  if (!desktop) {
    alert('Pick a desktop for the first pod.');
    return;
  }
  const btn = $('#lab-create');
  btn.disabled = true;
  try {
    await api('/api/labs', { method: 'POST', body: JSON.stringify({ desktop, name: `lab-${Date.now().toString(36)}` }) });
    await refreshLabs();
  } catch (e) {
    alert(`Lab creation failed: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

function desktopSelect(selected) {
  const sel = document.createElement('select');
  for (const t of state.templates) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon || ''} ${t.name}`.trim();
    sel.append(opt);
  }
  if (selected) sel.value = selected;
  return sel;
}

function targetSelect() {
  const sel = document.createElement('select');
  for (const t of state.podTargets) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.append(opt);
  }
  return sel;
}

export function renderLabs() {
  const sel = $('#lab-desktop');
  const cur = sel.value;
  sel.innerHTML = '';
  for (const t of state.templates) {
    const opt = el('option', '', `${t.icon || ''} ${t.name}`.trim());
    opt.value = t.id;
    sel.append(opt);
  }
  if (cur) sel.value = cur;

  const list = $('#lab-list');
  list.innerHTML = '';
  const labs = state.labs || [];
  $('#no-labs').classList.toggle('hidden', labs.length > 0);

  for (const lab of labs) {
    const card = el('div', 'card lab-card');
    const head = el('div', 'session-head');
    head.append(el('span', 'icon', '🧪'), el('span', '', lab.name), badge(lab.status));
    card.append(head);
    card.append(el('div', 'lab-net', `network ${lab.netName}`));

    for (const m of lab.members) {
      const row = el('div', 'member-row');
      row.append(el('span', 'm-role', m.kind === 'desktop' ? '🖥 desktop pod' : '🎯 target'));
      row.append(el('span', '', m.name));
      if (m.ip) row.append(el('code', '', m.ip));
      if (m.ports && m.ports.length) row.append(el('span', 'muted', `ports ${m.ports.join(', ')}`));
      row.append(badge(m.status));

      if (m.kind === 'desktop' && m.status === 'running') {
        const open = el('button', 'small', 'Stream');
        open.title = 'Open the graphical desktop (browser streaming)';
        open.addEventListener('click', () =>
          openViewer({ id: m.id, name: `${m.name} — ${lab.name}`, vncPassword: m.vncPassword })
        );
        row.append(open);
        const shell = el('button', 'small', 'Console');
        shell.title = 'Open a shell in this pod (web terminal)';
        shell.addEventListener('click', () =>
          openConsole({ id: m.id, name: `${m.name} — ${lab.name}` })
        );
        row.append(shell);
        const cp = el('button', 'small', 'Cockpit');
        if (m.cockpit) {
          cp.title = 'Open the Cockpit web console (terminal + system apps) in a new tab';
          cp.addEventListener('click', () => window.open(`/cockpit/${m.id}/`, '_blank'));
        } else {
          cp.title = 'No Cockpit edge on this pod — add a fresh desktop pod to enable Cockpit';
          cp.disabled = true;
        }
        row.append(cp);
      }
      const del = el('button', 'icon-btn', '✕');
      del.title = 'Remove this member';
      del.addEventListener('click', async () => {
        del.disabled = true;
        try {
          await api(`/api/labs/${lab.id}/members/${m.id}`, { method: 'DELETE' });
          await refreshLabs();
        } catch (e) {
          alert(e.message);
        }
      });
      row.append(del);
      card.append(row);
    }

    if (lab.error) card.append(el('div', 'err-text', lab.error));

    const actions = el('div', 'lab-actions');
    const podSel = desktopSelect();
    const addPod = el('button', 'small', '+ Desktop pod');
    addPod.addEventListener('click', async () => {
      addPod.disabled = true;
      try {
        await api(`/api/labs/${lab.id}/desktops`, { method: 'POST', body: JSON.stringify({ desktop: podSel.value }) });
        await refreshLabs();
      } catch (e) {
        alert(e.message);
      } finally {
        addPod.disabled = false;
      }
    });
    const tSel = targetSelect();
    const addTarget = el('button', 'small', '+ Target');
    addTarget.addEventListener('click', async () => {
      addTarget.disabled = true;
      try {
        await api(`/api/labs/${lab.id}/targets`, { method: 'POST', body: JSON.stringify({ targetId: tSel.value }) });
        await refreshLabs();
      } catch (e) {
        alert(e.message);
      } finally {
        addTarget.disabled = false;
      }
    });
    const delLab = el('button', 'danger small', 'Delete lab');
    delLab.addEventListener('click', async () => {
      if (!confirm(`Delete lab "${lab.name}"? The network and all its pods and targets are removed.`)) return;
      delLab.disabled = true;
      try {
        await api(`/api/labs/${lab.id}`, { method: 'DELETE' });
        await refreshLabs();
      } catch (e) {
        alert(e.message);
      }
    });
    actions.append(el('span', 'muted', 'add:'), podSel, addPod, addTarget, el('span', 'spacer'), delLab);
    card.append(actions);
    list.append(card);
  }
}
