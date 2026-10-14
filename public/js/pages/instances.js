/* Instances: table of sessions with Stream / Console / Cockpit / Destroy. */

import { state } from '../state.js';
import { $, el, fmtUptime, badge } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { openViewer, openConsole } from '../viewer.js';
import { refreshSessions } from '../refresh.js';

export function instanceTable(list) {
  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Instance', 'Image', 'Plan', 'Status', 'Uptime', '']) hr.append(el('th', '', h));
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const s of list) {
    const t = state.templates.find((x) => x.id === s.template);
    const tr = el('tr');
    const nameTd = el('td');
    const nameWrap = el('div', '', '');
    nameWrap.style.display = 'flex';
    nameWrap.style.alignItems = 'center';
    nameWrap.style.gap = '10px';
    nameWrap.append(el('span', '', t?.icon || '📦'));
    const nw = el('div', '');
    nw.append(el('div', '', s.hostname || s.name));
    nw.append(el('div', 'muted', `${s.plan || 'standard'} · ${s.id}`));
    nw.style.lineHeight = '1.3';
    nameWrap.append(nw);
    nameTd.append(nameWrap);
    tr.append(nameTd);
    tr.append(el('td', '', t?.name || s.template));
    tr.append(el('td', '', s.plan || 'standard'));
    const stTd = el('td');
    stTd.append(badge(s.status));
    tr.append(stTd);
    tr.append(el('td', '', s.status === 'running' ? fmtUptime(s.uptimeSec) : '—'));
    const actTd = el('td');
    actTd.style.display = 'flex';
    actTd.style.gap = '6px';
    const stream = el('button', 'small', 'Stream');
    stream.title = 'Open the graphical desktop (browser streaming)';
    stream.disabled = s.status !== 'running';
    stream.addEventListener('click', () => openViewer(s));
    const consoleBtn = el('button', 'small', 'Console');
    consoleBtn.title = 'Open a shell in the instance (web terminal)';
    consoleBtn.disabled = s.status !== 'running';
    consoleBtn.addEventListener('click', () => openConsole(s));
    const cockpitBtn = el('button', 'small', 'Cockpit');
    if (s.cockpit) {
      cockpitBtn.title = 'Open the Cockpit web console (terminal + system apps) in a new tab';
      cockpitBtn.disabled = s.status !== 'running';
      cockpitBtn.addEventListener('click', () => window.open(`/cockpit/${s.id}/`, '_blank'));
    } else {
      cockpitBtn.title = 'No Cockpit edge on this instance — deploy it again to enable Cockpit';
      cockpitBtn.disabled = true;
    }
    const del = el('button', 'danger small', 'Destroy');
    del.disabled = s.status === 'stopping';
    del.addEventListener('click', async () => {
      if (!confirm(`Destroy instance "${s.hostname || s.id}"?`)) return;
      del.disabled = true;
      try {
        await api(`/api/sessions/${s.id}`, { method: 'DELETE' });
        await refreshSessions();
      } catch (e) {
        alert(e.message);
      }
    });
    actTd.append(stream, consoleBtn, del);
    actTd.style.whiteSpace = 'nowrap';
    tr.append(actTd);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

export function renderInstances(c) {
  const running = state.sessions.filter((s) => s.status === 'running').length;
  const sub = `${running} running · ${state.sessions.length} total`;
  $('#page-sub').textContent = sub;

  if (!state.sessions.length) {
    const empty = el('div', 'empty', 'No instances yet.');
    const btn = el('button', 'primary', 'Deploy an instance');
    btn.style.marginLeft = '12px';
    btn.addEventListener('click', () => navigate('deploy'));
    empty.append(btn);
    c.append(empty);
    return;
  }

  const bar = el('div', '');
  bar.style.display = 'flex';
  bar.style.justifyContent = 'flex-end';
  bar.style.marginBottom = '12px';
  const dep = el('button', 'primary', 'Deploy instance');
  dep.addEventListener('click', () => navigate('deploy'));
  bar.append(dep);
  c.append(bar);

  c.append(instanceTable([...state.sessions].sort((a, b) => b.createdAt - a.createdAt)));
}
