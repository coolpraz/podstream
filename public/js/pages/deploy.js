/* Deploy: pick image + plan + hostname, then poll the new instance to running. */

import { state } from '../state.js';
import { el } from '../ui.js';
import { api } from '../api.js';
import { navigate, render } from '../router.js';
import { refreshSessions } from '../refresh.js';

export function renderDeploy(c) {
  const d = state.deploy;

  const grid = el('div', 'deploy-grid');
  const left = el('div', '');
  const right = el('div', 'summary');

  left.append(el('h2', 'section', '1 · Choose an image'));
  const imgGrid = el('div', 'pick-grid');
  for (const t of state.templates) {
    const sizeMatch = (t.description || '').match(/~[\d.]+ ?GB/);
    const card = el('div', `pick${d.template === t.id ? ' selected' : ''}`);
    card.append(el('div', 'pick-icon', t.icon || '📦'));
    card.append(el('div', 'pick-name', t.name));
    card.append(el('div', 'pick-desc', t.description || ''));
    if (sizeMatch) card.append(el('div', 'pick-size', `image ${sizeMatch[0]}`));
    card.addEventListener('click', () => {
      d.template = t.id;
      render();
    });
    imgGrid.append(card);
  }
  left.append(imgGrid);

  left.append(el('h2', 'section', '2 · Choose a plan'));
  const planGrid = el('div', 'plan-grid');
  for (const p of state.plans) {
    const card = el('div', `pick${d.plan === p.id ? ' selected' : ''}`);
    card.append(el('div', 'pick-icon', '⚙️'));
    card.append(el('div', 'pick-name', p.name));
    const ul = el('ul', 'plan-spec');
    ul.append(el('li', '', `${p.vcpu} vCPU`));
    ul.append(el('li', '', `${p.memory} RAM`));
    ul.append(el('li', '', p.desc));
    card.append(ul);
    card.addEventListener('click', () => {
      d.plan = p.id;
      render();
    });
    planGrid.append(card);
  }
  left.append(planGrid);

  left.append(el('h2', 'section', '3 · Instance name'));
  const hostIn = el('input', '');
  hostIn.placeholder = 'auto from image';
  hostIn.value = d.hostname || '';
  hostIn.style.width = '320px';
  hostIn.addEventListener('input', () => {
    d.hostname = hostIn.value;
  });
  left.append(hostIn);

  // summary
  const t = state.templates.find((x) => x.id === d.template) || state.templates[0];
  const plan = state.plans.find((p) => p.id === d.plan) || state.plans[1];
  right.append(el('h3', '', 'Summary'));
  const row = (k, v) => {
    const r = el('div', 'srow');
    r.append(el('span', 'k', k));
    r.append(el('span', 'v', v));
    return r;
  };
  right.append(row('Image', t ? t.name : '—'));
  right.append(row('Plan', plan ? `${plan.name} · ${plan.vcpu} vCPU · ${plan.memory}` : '—'));
  right.append(row('Network', 'private (NAT)'));
  right.append(row('Hostname', d.hostname || 'auto'));

  const deployBtn = el('button', 'deploy-btn', '🚀 Deploy instance');
  deployBtn.addEventListener('click', () => deployInstance());
  right.append(deployBtn);
  right.append(el('div', 'muted', 'Streaming console opens as a tab. Tools install in-session; add whole toolsets with one package command.'));

  grid.append(left);
  grid.append(right);
  c.append(grid);
}

async function deployInstance() {
  const btn = document.querySelector('.deploy-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Provisioning…';
  }
  try {
    const created = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        templateId: state.deploy.template,
        plan: state.deploy.plan,
        hostname: state.deploy.hostname,
      }),
    });
    // Progress: poll until running/error
    const prog = el('div', 'progress');
    const bar = el('div', '');
    bar.style.width = '15%';
    prog.append(bar);
    const statusLine = el('div', 'muted', 'Creating instance…');
    btn.replaceWith(prog);
    prog.after(statusLine);

    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const list = await api('/api/sessions').catch(() => []);
      const cur = list.find((x) => x.id === created.id);
      if (!cur) break;
      const pct = Math.min(90, (bar.style.width.replace('%', '') | 0) + 8);
      bar.style.width = cur.status === 'running' ? '100%' : `${pct}%`;
      statusLine.textContent =
        cur.status === 'pulling' ? 'Fetching image…'
        : cur.status === 'starting' ? 'Booting…'
        : cur.status === 'running' ? 'Running ✓'
        : cur.status;
      if (cur.status === 'running' || cur.status === 'error') break;
    }
    await refreshSessions();
    navigate('instances');
  } catch (e) {
    alert(`Deploy failed: ${e.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Deploy instance';
    }
  }
}
