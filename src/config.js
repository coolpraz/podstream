'use strict';

const path = require('path');

// Project root — one level above src/. Runtime data (templates.local.json) and
// static assets (public/, node_modules vendor mounts) resolve from here.
const ROOT = path.join(__dirname, '..');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PODMAN = process.env.PODMAN_BIN || 'podman';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const SESSION_TTL_MIN = parseInt(process.env.SESSION_TTL_MINUTES || '0', 10); // 0 = never expire
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '10', 10);

// `0` opts out of `--security-opt seccomp=unconfined` on session containers
// (stricter, but container browsers may crash without it).
const INSECURE_SECCOMP = process.env.PODSTREAM_INSECURE_SECCOMP !== '0';

// Deploy plans (cloud-style resource sizing: memory + cpu limits per instance)
const PLANS = [
  { id: 'pico', name: 'Pico', vcpu: 1, memory: '1g', desc: 'Light desktop work' },
  { id: 'standard', name: 'Standard', vcpu: 2, memory: '2g', desc: 'Balanced daily driver' },
  { id: 'performance', name: 'Performance', vcpu: 4, memory: '4g', desc: 'Heavy multitasking' },
  { id: 'extreme', name: 'Extreme', vcpu: 6, memory: '8g', desc: 'Max resources this host offers' },
];

const NAME_PREFIX = 'podstream-'; // container names: podstream-<template>-<8 hex>
const RECONCILE_MS = 30 * 1000;

module.exports = {
  ROOT,
  PORT,
  PODMAN,
  AUTH_TOKEN,
  SESSION_TTL_MIN,
  MAX_SESSIONS,
  INSECURE_SECCOMP,
  PLANS,
  NAME_PREFIX,
  RECONCILE_MS,
};
