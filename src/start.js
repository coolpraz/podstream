'use strict';

const http = require('http');

const { AUTH_TOKEN, PODMAN, PORT, RECONCILE_MS } = require('./config');
const { buildApp } = require('./app');
const { attach } = require('./ws');
const { checkPodman } = require('./lib/podman');
const { runtime } = require('./state');
const { adoptOrphans, reconcileSessions } = require('./sessions');
const { adoptLabs, reconcileLabs } = require('./labs');

/** Boot PodStream: podman check, adoption, reconcile loop, HTTP + WS listen. */
async function start() {
  await checkPodman();
  if (!runtime.podmanVersion) {
    console.warn(`WARNING: '${PODMAN}' is not usable right now — launches will fail until it is.`);
  } else {
    console.log(`podman: ${runtime.podmanVersion}`);
  }

  await adoptOrphans().catch((err) => console.warn(`adoption failed: ${err.message}`));
  await adoptLabs().catch((err) => console.warn(`lab adoption failed: ${err.message}`));
  setInterval(() => {
    reconcileSessions();
    reconcileLabs();
  }, RECONCILE_MS).unref();

  const server = http.createServer(buildApp());
  attach(server);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`port ${PORT} is already in use — is another PodStream instance running?`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, () => {
    console.log(`PodStream listening on http://localhost:${PORT}${AUTH_TOKEN ? ' (token auth enabled)' : ''}`);
  });
}

module.exports = { start };
