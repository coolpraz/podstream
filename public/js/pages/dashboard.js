/* Dashboard: stats tiles + CTAs + recent instances. */

import { state } from '../state.js';
import { el } from '../ui.js';
import { navigate } from '../router.js';
import { instanceTable } from './instances.js';

export function renderDashboard(c) {
  const s = state.stats || {};

  const g = el('div', 'stat-grid');
  const mk = (num, label) => {
    const card = el('div', 'stat');
    card.append(el('div', 'stat-num', String(num)));
    card.append(el('div', 'stat-label', label));
    return card;
  };
  g.append(mk(s.instancesRunning ?? '—', 'Instances running'));
  g.append(mk(state.labs.length, 'Labs'));
  g.append(mk(state.images.length, 'Local images'));
  g.append(mk(s.diskFreeGb != null ? `${s.diskFreeGb} GB` : '—', 'Disk free'));
  c.append(g);

  const grid = el('div', 'grid cols-3');
  grid.style.marginTop = '18px';

  const cta = el('div', 'cta-card');
  cta.append(el('h3', '', 'Deploy a new instance'));
  cta.append(el('p', '', 'Kali, Parrot HTB or BlackArch — choose a plan and it boots in under a minute.'));
  const deployBtn = el('button', '', 'Deploy instance →');
  deployBtn.addEventListener('click', () => navigate('deploy'));
  cta.append(deployBtn);
  grid.append(cta);

  const labCta = el('div', 'card');
  labCta.style.display = 'flex';
  labCta.style.flexDirection = 'column';
  labCta.style.gap = '8px';
  labCta.append(el('h3', '', 'Spin up a lab'));
  labCta.append(el('p', 'muted', 'A private network with desktops and vulnerable targets — isolated from your host.'));
  const labBtn = el('button', '', 'Open Labs →');
  labBtn.addEventListener('click', () => navigate('labs'));
  labCta.append(labBtn);
  grid.append(labCta);

  c.append(el('h2', 'section', 'Recent instances'));
  const recent = [...state.sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  if (!recent.length) c.append(el('div', 'empty', 'No instances yet — deploy one from the Deploy page.'));
  else {
    const wrap = el('div', '');
    wrap.append(instanceTable(recent));
    c.append(wrap);
  }
  c.append(grid);
}
