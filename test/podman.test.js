'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseHostPort } = require('../src/lib/podman');

const PODMAN_PORT_OUTPUT = [
  '5901/tcp -> 127.0.0.1:41235',
  '9090/tcp -> 127.0.0.1:45673',
].join('\n');

test('parseHostPort finds the host port for a container port', () => {
  assert.strictEqual(parseHostPort(PODMAN_PORT_OUTPUT, 5901), 41235);
  assert.strictEqual(parseHostPort(PODMAN_PORT_OUTPUT, 9090), 45673);
});

test('parseHostPort returns null for unmapped ports and junk', () => {
  assert.strictEqual(parseHostPort(PODMAN_PORT_OUTPUT, 8080), null);
  assert.strictEqual(parseHostPort('', 5901), null);
  assert.strictEqual(parseHostPort('error: no such container', 5901), null);
});
