'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { httpError } = require('./lib/http');
const { podman } = require('./lib/podman');
const { hex } = require('./lib/rand');

const QUAY_NS = process.env.QUAY_NAMESPACE || 'podstream';
const QUAY_API = 'https://quay.io/api/v1';
const marketplacePulls = new Map(); // id -> {id, ref, name, status, error, startedAt}

/** Basic-auth header from podman's stored quay.io credentials (if any). */
function quayAuthHeader() {
  try {
    const authPath = path.join(os.homedir(), '.config', 'containers', 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const a = auth.auths && (auth.auths['quay.io'] || auth.auths['https://quay.io'] || auth.auths['quay.io/']);
    if (a && a.auth) return `Basic ${a.auth}`;
  } catch { /* anonymous */ }
  return null;
}

async function quayApi(apiPath) {
  const headers = {};
  const h = quayAuthHeader();
  if (h) headers.Authorization = h;
  const res = await fetch(QUAY_API + apiPath, { headers });
  if (!res.ok) throw httpError(res.status, `quay.io API ${res.status} ${res.statusText}`);
  return res.json();
}

/** List the quay.io <namespace> repos with their newest tag and local presence. */
async function listMarketplace() {
  const out = { namespace: QUAY_NS, repos: [], pulls: [...marketplacePulls.values()].sort((a, b) => b.startedAt - a.startedAt), error: null };
  try {
    const data = await quayApi(`/repository?namespace=${encodeURIComponent(QUAY_NS)}&limit=100&public=true`);
    for (const r of data.repositories || []) {
      // pick the newest available tag (fallback: latest)
      let tag = 'latest';
      const repoDetail = await quayApi(`/repository/${QUAY_NS}/${r.name}`).catch(() => null);
      const tags = repoDetail && repoDetail.tags ? Object.keys(repoDetail.tags) : [];
      if (tags.length) {
        if (!tags.includes('latest')) tag = tags[0];
      }
      const ref = `quay.io/${QUAY_NS}/${r.name}:${tag}`;
      const local = await podman(['image', 'exists', ref]).then(() => true).catch(() => false);
      out.repos.push({
        name: r.name,
        ref,
        tag,
        description: r.description || '',
        visibility: r.is_public ? 'public' : 'private',
        local,
      });
    }
  } catch (err) {
    out.error = `quay.io listing failed: ${err.message}`;
  }
  return out;
}

/** Kick off a background `podman pull` for a marketplace repo; returns the job. */
function startPull(name, tag) {
  name = String(name || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  tag = String(tag || 'latest').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!name) throw httpError(400, 'missing repo name');
  if (name.includes('..')) throw httpError(400, 'bad repo name');
  const ref = `quay.io/${QUAY_NS}/${name}:${tag}`;
  for (const j of marketplacePulls.values()) {
    if (j.ref === ref && j.status === 'pulling') throw httpError(409, 'this image is already being pulled');
  }
  const job = { id: hex(4), ref, name, status: 'pulling', error: null, startedAt: Date.now() };
  marketplacePulls.set(job.id, job);
  console.log(`[marketplace] pulling ${ref}`);
  (async () => {
    try {
      await podman(['pull', ref], { timeout: 45 * 60 * 1000 });
      job.status = 'done';
      console.log(`[marketplace] pulled ${ref}`);
    } catch (err) {
      job.status = 'error';
      job.error = String(err.stderr || err.message).split('\n').slice(-2).join(' ').slice(0, 200);
      console.error(`[marketplace] pull failed: ${job.error}`);
    }
    setTimeout(() => marketplacePulls.delete(job.id), 10 * 60 * 1000).unref();
  })();
  return job;
}

module.exports = { listMarketplace, startPull };
