'use strict';

const fs = require('fs');

const express = require('express');

const {
  AUTH_TOKEN,
  MAX_SESSIONS,
  PLANS,
  SESSION_TTL_MIN,
} = require('../config');
const { httpError, wrap } = require('../lib/http');
const { runtime, labs, sessions } = require('../state');
const {
  normalizeTemplate,
  listTemplates,
  addTemplate,
  removeTemplate,
} = require('../templates');
const { publicSession, createSession, stopSession } = require('../sessions');
const {
  POD_TARGETS,
  publicLab,
  createLab,
  findLab,
  addDesktopToLab,
  addTargetToLab,
  deleteLab,
  deleteLabMember,
} = require('../labs');
const { listImages, removeImage } = require('../images');
const { listMarketplace, startPull } = require('../marketplace');

const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true, podman: runtime.podmanVersion }));

router.get('/config', (req, res) =>
  res.json({ authRequired: !!AUTH_TOKEN, templates: listTemplates(), plans: PLANS, podTargets: POD_TARGETS, sessionTtlMin: SESSION_TTL_MIN, maxSessions: MAX_SESSIONS })
);

// Cloud-console dashboard stats (disk via statfs, counts from in-memory state)
router.get('/stats', (req, res) => {
  let diskFreeGb = null;
  let diskTotalGb = null;
  try {
    const s = fs.statfsSync('/');
    diskFreeGb = Math.round((s.bavail * s.bsize) / 1e9);
    diskTotalGb = Math.round((s.blocks * s.bsize) / 1e9);
  } catch { /* not critical */ }
  const running = [...sessions.values()].filter((s) => s.status === 'running').length;
  const labDesktops = [...labs.values()].reduce(
    (n, l) => n + l.members.filter((m) => m.kind === 'desktop' && m.status === 'running').length,
    0
  );
  res.json({
    instancesRunning: running + labDesktops,
    sessions: sessions.size,
    labs: labs.size,
    images: null, // filled by /api/images consumers; kept simple here
    diskFreeGb,
    diskTotalGb,
    podmanVersion: runtime.podmanVersion,
  });
});

function requireAuth(req, res, next) {
  if (!AUTH_TOKEN) return next();
  const header = req.headers.authorization || '';
  if (header === `Bearer ${AUTH_TOKEN}` || req.query.token === AUTH_TOKEN) return next();
  res.status(401).json({ error: 'unauthorized' });
}
router.use(requireAuth);

// ---- sessions ----

router.get('/sessions', (req, res) => {
  res.json([...sessions.values()].sort((a, b) => a.createdAt - b.createdAt).map(publicSession));
});

router.post(
  '/sessions',
  wrap(async (req, res) => {
    const body = req.body || {};
    const templateId = String(body.templateId || body.template || '');
    res.status(202).json(createSession(templateId, { plan: body.plan, hostname: body.hostname }));
  })
);

router.delete(
  '/sessions/:id',
  wrap(async (req, res) => {
    await stopSession(req.params.id);
    res.json({ ok: true });
  })
);

// ---- app (template) management ----

router.post(
  '/templates',
  wrap(async (req, res) => {
    const body = req.body || {};
    const t = normalizeTemplate({ ...body, id: body.id || body.name });
    if (!t.image) throw httpError(400, 'app needs an image');
    if (listTemplates().some((x) => x.id === t.id)) throw httpError(409, `app id '${t.id}' already exists`);
    addTemplate(t);
    console.log(`app added: ${t.id} (${t.image})`);
    res.status(201).json(t);
  })
);

router.delete(
  '/templates/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    const busy = [...sessions.values()].find(
      (s) => s.template === id && s.status !== 'error' && s.status !== 'stopping'
    );
    if (busy) throw httpError(409, `app is in use by session ${busy.id} — stop it first`);
    if (!removeTemplate(id)) throw httpError(404, 'no such app');
    console.log(`app deleted: ${id}`);
    res.json({ ok: true });
  })
);

// ---- image management ----

router.get(
  '/images',
  wrap(async (req, res) => {
    res.json(await listImages());
  })
);

router.delete(
  '/images',
  wrap(async (req, res) => {
    await removeImage(String((req.body && req.body.ref) || ''));
    res.json({ ok: true });
  })
);

// ---- labs (multi-pod networking) ----

router.get('/labs', (req, res) => {
  res.json([...labs.values()].sort((a, b) => a.createdAt - b.createdAt).map(publicLab));
});

router.post(
  '/labs',
  wrap(async (req, res) => {
    const body = req.body || {};
    const lab = await createLab({ desktop: body.desktop, name: body.name });
    res.status(202).json(lab);
  })
);

router.get('/labs/:id', wrap(async (req, res) => {
  res.json(publicLab(findLab(req.params.id)));
}));

router.post(
  '/labs/:id/desktops',
  wrap(async (req, res) => {
    const lab = findLab(req.params.id);
    const dt = listTemplates().find((t) => t.id === ((req.body || {}).desktop || ''));
    if (!dt) throw httpError(400, 'unknown or missing desktop');
    const member = await addDesktopToLab(lab, dt, (req.body || {}).plan);
    res.status(202).json(member);
  })
);

router.post(
  '/labs/:id/targets',
  wrap(async (req, res) => {
    const lab = findLab(req.params.id);
    const member = await addTargetToLab(lab, req.body || {});
    res.status(202).json(member);
  })
);

router.delete(
  '/labs/:id/members/:memberId',
  wrap(async (req, res) => {
    await deleteLabMember(findLab(req.params.id), req.params.memberId);
    res.json({ ok: true });
  })
);

router.delete(
  '/labs/:id',
  wrap(async (req, res) => {
    await deleteLab(req.params.id);
    res.json({ ok: true });
  })
);

// ---- marketplace (quay.io) ----

router.get('/marketplace', wrap(async (req, res) => {
  res.json(await listMarketplace());
}));

router.post(
  '/marketplace/pull',
  wrap(async (req, res) => {
    const body = req.body || {};
    const job = startPull(body.name, body.tag);
    res.status(202).json(job);
  })
);

router.use((req, res) => res.status(404).json({ error: 'not found' }));

module.exports = router;
