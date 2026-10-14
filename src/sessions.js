'use strict';

const crypto = require('crypto');

const {
  MAX_SESSIONS,
  NAME_PREFIX,
  PLANS,
  SESSION_TTL_MIN,
  INSECURE_SECCOMP,
} = require('./config');
const { httpError } = require('./lib/http');
const { freePort } = require('./lib/ports');
const { podman, imageExists, getHostPort, podmanPullStreaming } = require('./lib/podman');
const { sessions } = require('./state');
const { getTemplate } = require('./templates');

const PORT_CONFLICT = /already allocated|address already in use|port is already reserved/i;

function containerName(templateId, id) {
  return `${NAME_PREFIX}${templateId}-${id}`;
}

function publicSession(s) {
  return {
    id: s.id,
    template: s.template,
    name: s.name,
    plan: s.plan,
    hostname: s.hostname,
    status: s.status,
    error: s.error,
    pullProgress: s.pullProgress || null,
    vncPassword: s.password,
    cockpit: !!s.cockpitPort,
    adopted: !!s.adopted,
    createdAt: s.createdAt,
    uptimeSec: Math.floor((Date.now() - s.createdAt) / 1000),
  };
}

async function launch(session, template) {
  // Use the local image when present — `podman pull localhost/foo` would try to
  // contact a registry on localhost:5000 and hang through its connect timeout.
  if (await imageExists(template.image)) {
    console.log(`[${session.id}] using local image ${template.image}`);
  } else if (template.pullRef) {
    // Not local under the template's ref. First check the local store under the
    // remote (quay) ref — an earlier pull may have left it there; tagging it is
    // instant and needs no network. Only if truly absent do we pull.
    if (await imageExists(template.pullRef)) {
      console.log(`[${session.id}] using local quay image ${template.pullRef} -> ${template.image}`);
      await podman(['tag', template.pullRef, template.image]);
    } else {
      console.log(`[${session.id}] pulling ${template.pullRef} (remote) -> ${template.image}`);
      session.pullProgress = `pulling ${template.pullRef}`;
      try {
        await podmanPullStreaming(template.pullRef, (line) => {
          session.pullProgress = line.slice(0, 160);
        });
        await podman(['tag', template.pullRef, template.image]);
        console.log(`[${session.id}] remote image pulled and tagged as ${template.image}`);
      } catch (err) {
        session.pullProgress = null;
        throw new Error(
          `pulling remote image ${template.pullRef} failed: ${String(err.message || err).split('\n')[0].slice(0, 200)}`
        );
      }
    }
  } else {
    if (template.image.startsWith('localhost/')) {
      // A localhost image can't be pulled from anywhere — a pull attempt would
      // hang probing the localhost:5000 registry. Fail fast with guidance.
      throw new Error(
        `image '${template.image}' is not built locally and has no pullRef — ` +
        `build it first (podman build -t ${template.image.replace(/:latest$/, '')} ./<image-dir>), ` +
        `or set "pullRef" on the template to pull it from a registry`
      );
    }
    console.log(`[${session.id}] pulling ${template.image}`);
    try {
      await podmanPullStreaming(template.image, (line) => {
        session.pullProgress = line.slice(0, 160);
      });
    } catch (err) {
      throw err;
    }
  }

  session.status = 'starting';
  const args = [
    'run', '-d',
    '--name', session.name,
    '--pull', 'never',
    '--shm-size', '1g',
    '-p', `127.0.0.1:0:${template.displayPort}/tcp`, // placeholder, rewritten per attempt
  ];
  if (session.plan && session.plan !== 'standard') {
    const plan = PLANS.find((pl) => pl.id === session.plan);
    if (plan) {
      args.push('--memory', plan.memory, '--cpus', String(plan.vcpu));
    }
  }
  if (template.network) args.push('--network', template.network);
  if (session.hostname || template.hostname) args.push('--hostname', String(session.hostname || template.hostname));
  const portArgIdx = args.indexOf('-p') + 1;
  // Cockpit web console edge (cockpit-ws inside the image listens on 9090).
  // Published on 127.0.0.1 only, like VNC — the host cannot reach rootless
  // container IPs directly, so the /cockpit proxy goes through this port.
  const cockpitArgIdx = template.cockpit ? args.push('-p', 'cockpit-edge-placeholder') - 1 : -1;
  if (template.resolution) args.push('-e', `VNC_RESOLUTION=${template.resolution}`);
  if (template.vncPasswordEnv) args.push('-e', `${template.vncPasswordEnv}=${session.password}`);
  for (const [k, v] of Object.entries(template.env)) args.push('-e', `${k}=${v}`);
  if (INSECURE_SECCOMP) {
    // Unconfined seccomp avoids the classic "browser crashes inside container" issue.
    // Set PODSTREAM_INSECURE_SECCOMP=0 for stricter sandboxing.
    args.push('--security-opt', 'seccomp=unconfined');
  }
  args.push(template.image);

  for (let attempt = 1; ; attempt++) {
    session.port = await freePort();
    if (cockpitArgIdx >= 0) session.cockpitPort = await freePort();
    args[portArgIdx] = `127.0.0.1:${session.port}:${template.displayPort}/tcp`;
    if (cockpitArgIdx >= 0) args[cockpitArgIdx] = `127.0.0.1:${session.cockpitPort}:9090/tcp`;
    try {
      await podman(args, { timeout: 2 * 60 * 1000 });
      break;
    } catch (err) {
      // a failed `run` can leave a half-created container behind, which would
      // collide with the next attempt's --name
      await podman(['rm', '-f', session.name]).catch(() => {});
      if (attempt < 3 && PORT_CONFLICT.test(err.stderr || '')) continue; // port raced, try another
      throw err;
    }
  }

  session.status = 'running';
  console.log(`[${session.id}] running as ${session.name} (vnc via 127.0.0.1:${session.port}${session.cockpitPort ? `, cockpit via 127.0.0.1:${session.cockpitPort}` : ''})`);
}

function createSession(templateId, opts = {}) {
  const template = getTemplate(templateId);
  if (!template) throw httpError(404, `unknown template '${templateId}'`);

  const plan = PLANS.find((pl) => pl.id === (opts.plan || 'standard')) || PLANS[1];
  const hostname = String(opts.hostname || template.hostname || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 30) || templateId;

  const active = [...sessions.values()].filter((s) => s.status !== 'error').length;
  if (active >= MAX_SESSIONS) throw httpError(429, `session limit reached (MAX_SESSIONS=${MAX_SESSIONS})`);

  const id = crypto.randomBytes(4).toString('hex');
  const session = {
    id,
    template: templateId,
    name: containerName(templateId, id),
    plan: plan.id,
    hostname,
    status: 'pulling',
    port: null,
    // RFB passwords are limited to 8 chars; base64url(6 bytes) is exactly 8.
    password: template.vncPassword || crypto.randomBytes(6).toString('base64url'),
    error: null,
    adopted: false,
    createdAt: Date.now(),
  };
  sessions.set(id, session);

  launch(session, template).catch((err) => {
    if (!sessions.has(id)) return;
    session.status = 'error';
    session.error = err.message;
    console.error(`[${id}] launch failed: ${err.message}`);
  });

  return publicSession(session);
}

async function stopSession(id) {
  const s = sessions.get(id);
  if (!s) throw httpError(404, 'no such session');
  s.status = 'stopping';
  try {
    await podman(['rm', '-f', '-t', '5', s.name], { timeout: 40 * 1000 });
  } catch {
    /* already gone */
  }
  sessions.delete(id);
  console.log(`[${id}] stopped`);
}

/** Drop sessions whose container died; enforce the optional TTL. */
async function reconcileSessions() {
  try {
    const out = await podman(['ps', '--format', '{{.Names}}', '--filter', `name=${NAME_PREFIX}`]);
    const alive = new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
    for (const [id, s] of [...sessions]) {
      if (s.status === 'running' && !alive.has(s.name)) {
        console.log(`[${id}] container ${s.name} is gone, dropping session`);
        sessions.delete(id);
      } else if (
        SESSION_TTL_MIN > 0 &&
        s.status === 'running' &&
        Date.now() - s.createdAt > SESSION_TTL_MIN * 60 * 1000
      ) {
        stopSession(id).catch(() => {});
      }
    }
  } catch {
    /* podman hiccup — try again next round */
  }
}

/** On startup, re-attach to containers left running by a previous instance. */
async function adoptOrphans() {
  const out = await podman(['ps', '--format', '{{.Names}}', '--filter', `name=${NAME_PREFIX}`]);
  for (const name of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const m = name.match(new RegExp(`^${NAME_PREFIX}(.+)-([0-9a-f]{8})$`));
    if (!m) continue;
    const [, templateId, id] = m;
    if (sessions.has(id)) continue;
    const template = getTemplate(templateId);
    const displayPort = template ? template.displayPort : 5901;
    let port = null;
    try {
      port = await getHostPort(name, displayPort);
    } catch {
      /* fall through */
    }
    if (!port) {
      try {
        await podman(['rm', '-f', name]);
      } catch {
        /* ignore */
      }
      continue;
    }
    let cockpitPort = null;
    try {
      cockpitPort = await getHostPort(name, 9090);
    } catch {
      /* no cockpit edge */
    }
    sessions.set(id, {
      id,
      template: templateId,
      name,
      status: 'running',
      port,
      cockpitPort,
      password: null, // unknown after restart — client will prompt
      error: null,
      adopted: true,
      createdAt: Date.now(),
    });
    console.log(`adopted existing container ${name} (session ${id})`);
  }
}

module.exports = {
  containerName,
  publicSession,
  createSession,
  stopSession,
  reconcileSessions,
  adoptOrphans,
};
