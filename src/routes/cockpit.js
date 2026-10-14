'use strict';

const http = require('http');

const express = require('express');

const { cockpitEntry } = require('../cockpit');
const { wrap } = require('../lib/http');

const router = express.Router();

// Reverse-proxy every HTTP request for /cockpit/:id/* to cockpit-ws inside the
// instance through its published 127.0.0.1 edge (see src/cockpit.js).
router.use(
  '/:id',
  wrap(async (req, res) => {
    const entry = cockpitEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: 'no such instance' });
    if (!entry.port) {
      return res.status(409).json({ error: 'this instance has no Cockpit edge — deploy it again to get one' });
    }

    const rest = req.originalUrl.slice(`/cockpit/${req.params.id}`.length) || '/';
    const proxy = http.request(
      { host: '127.0.0.1', port: entry.port, method: req.method, path: rest || '/',
        headers: { ...req.headers, host: `127.0.0.1:${entry.port}` } },
      (pr) => { res.writeHead(pr.statusCode || 502, pr.headers); pr.pipe(res); }
    );
    proxy.on('error', (e) => {
      try {
        // reset/refused here almost always means the image has no cockpit-ws
        const msg = e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED'
          ? 'cockpit-ws is not reachable inside this instance — its image may not include the cockpit packages (rebuild the image)'
          : String(e.message);
        res.status(502).json({ error: msg });
      } catch { /* gone */ }
    });
    req.pipe(proxy);
  })
);

module.exports = router;
