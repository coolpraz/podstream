/* Hash router: page registry, navigation, and the render dispatcher. */

import { state } from './state.js';
import { $, el } from './ui.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderInstances } from './pages/instances.js';
import { renderDeploy } from './pages/deploy.js';
import { renderLabs } from './pages/labs.js';
import { renderImages } from './pages/images.js';
import { renderMarketplace } from './pages/marketplace.js';

export const PAGES = {
  dashboard: { title: 'Dashboard', sub: 'Resource overview' },
  instances: { title: 'Instances', sub: 'Running desktops and their consoles' },
  deploy: { title: 'Deploy an instance', sub: 'Pick an image and a plan — ready in under a minute' },
  labs: { title: 'Labs', sub: 'Multi-pod engagement networks' },
  images: { title: 'Images', sub: 'Local container images' },
  marketplace: { title: 'Marketplace', sub: 'Pull images from your quay.io podstream namespace' },
};

const RENDERERS = {
  dashboard: renderDashboard,
  instances: renderInstances,
  deploy: renderDeploy,
  labs: renderLabs,
  images: renderImages,
  marketplace: renderMarketplace,
};

export function navigate(page) {
  state.page = page;
  location.hash = `#/${page}`;
  render();
}

export function render() {
  const page = state.page;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.page === page);
  $('#page-title').textContent = PAGES[page]?.title || page;
  $('#page-sub').textContent = PAGES[page]?.sub || '';
  const c = $('#page-content');
  c.innerHTML = '';
  $('#labs-section').classList.toggle('hidden', page !== 'labs');
  try {
    (RENDERERS[page] || (() => {}))(c);
  } catch (err) {
    c.append(el('pre', 'err-text', 'render error: ' + (err.stack || err.message || String(err))));
  }
}

window.addEventListener('hashchange', () => {
  const page = (location.hash || '').replace(/^#\//, '') || 'dashboard';
  if (PAGES[page]) {
    state.page = page;
    render();
  }
});
