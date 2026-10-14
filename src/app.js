'use strict';

const path = require('path');

const express = require('express');

const { ROOT } = require('./config');
const apiRouter = require('./routes/api');
const cockpitRouter = require('./routes/cockpit');

/** Build the express app: static assets, vendor mounts, API + proxy routers. */
function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.static(path.join(ROOT, 'public')));
  // noVNC client library, served locally so the app has no CDN dependency
  app.use('/vendor/novnc', express.static(path.join(ROOT, 'node_modules', '@novnc', 'novnc')));
  // web-terminal frontend (xterm.js) for the console feature
  app.use('/vendor/xtermcss', express.static(path.join(ROOT, 'node_modules', '@xterm', 'xterm', 'css')));
  app.use('/vendor/xtermjs', express.static(path.join(ROOT, 'node_modules', '@xterm', 'xterm', 'lib')));

  app.use('/api', apiRouter);
  app.use('/cockpit', cockpitRouter);

  // global error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    console.error(err.message);
    res.status(err.status || 500).json({ error: err.message });
  });

  return app;
}

module.exports = { buildApp };
