/* Shared application state — one object mutated in place by pages and viewer. */

export const state = {
  page: 'dashboard',
  templates: [],
  plans: [],
  podTargets: [],
  sessions: [],
  labs: [],
  images: [],
  stats: {},
  deploy: { template: null, plan: 'standard', hostname: '' },
  viewers: new Map(),
  activeViewer: null,
};
