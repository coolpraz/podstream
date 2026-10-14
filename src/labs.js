'use strict';

const crypto = require('crypto');

const { PLANS, INSECURE_SECCOMP } = require('./config');
const { httpError } = require('./lib/http');
const { freePort } = require('./lib/ports');
const { podman, containerIp } = require('./lib/podman');
const { hex } = require('./lib/rand');
const { labs } = require('./state');
const { getTemplate } = require('./templates');

// A lab = an isolated bridge network connecting multiple podman pods and
// containers — real networking infrastructure: every pod gets its own IP on
// the lab subnet, members resolve each other by name (aardvark-dns), targets
// are never exposed to the host, and the only host-facing exposure is each
// desktop pod's VNC edge (proxied through PodStream).

const POD_TARGETS = [
  { id: 'juice-shop', name: 'OWASP Juice Shop', image: 'docker.io/bkimminich/juice-shop:latest', ports: [3000], hint: 'vulnerable web app — attack http://<target-ip>:3000 from the desktop' },
  { id: 'web-dvwa', name: 'DVWA', image: 'docker.io/vulnerables/web-dvwa:latest', ports: [80], hint: 'Damn Vulnerable Web App — attack http://<target-ip> from the desktop' },
];

const LAB_NET_PREFIX = 'podstream-lab-';

function publicLab(l) {
  return {
    id: l.id,
    name: l.name,
    netName: l.netName,
    status: l.status,
    error: l.error,
    createdAt: l.createdAt,
    members: l.members.map((m) => ({
      id: m.id,
      kind: m.kind,
      name: m.name,
      status: m.status,
      error: m.error,
      ip: m.ip,
      hostname: m.hostname,
      desktop: m.desktop,
      desktopName: m.desktopName,
      ref: m.ref,
      ports: m.ports || [],
      vncPassword: m.kind === 'desktop' ? m.vncPassword : undefined,
      cockpit: m.kind === 'desktop' ? !!m.cockpitPort : undefined,
    })),
  };
}

async function addDesktopToLab(lab, dt, planId) {
  const memberId = hex(4);
  const podName = `${LAB_NET_PREFIX}${lab.id}-${memberId}`;
  const vncPort = await freePort();
  const cockpitPort = dt.cockpit ? await freePort() : null;
  const vncPassword = dt.vncPassword || crypto.randomBytes(6).toString('base64url');
  const member = {
    kind: 'desktop',
    id: memberId,
    podName,
    containerName: `${podName}-desktop`,
    name: `${dt.name} pod`,
    desktop: dt.id,
    desktopName: dt.name,
    hostname: dt.hostname || podName,
    termUser: dt.termUser || 'user',
    vncPort,
    cockpitPort,
    vncPassword,
    status: 'creating',
    ip: null,
    error: null,
  };
  lab.members.push(member);

  (async () => {
    try {
      await podman([
        'pod', 'create', '--name', podName, '--hostname', member.hostname,
        '--network', lab.netName,
        '--label', `podstream.lab=${lab.id}`,
        '--label', 'podstream.role=desktop',
        '--label', `podstream.termuser=${member.termUser || 'user'}`,
        '--label', `podstream.vncpw=${vncPassword}`,
        '-p', `127.0.0.1:${vncPort}:${dt.displayPort}/tcp`,
        ...(cockpitPort ? ['-p', `127.0.0.1:${cockpitPort}:9090/tcp`] : []),
      ]);

      const run = ['run', '-d', '--pod', podName, '--name', member.containerName,
        '--pull', 'never', '--shm-size', '1g'];
      const plan = PLANS.find((pl) => pl.id === (planId || 'standard')) || PLANS[1];
      run.push('--memory', plan.memory, '--cpus', String(plan.vcpu));
      run.push('-e', `VNC_RESOLUTION=${dt.resolution || '1600x900'}`);
      if (dt.vncPasswordEnv) run.push('-e', `${dt.vncPasswordEnv}=${vncPassword}`);
      for (const [k, v] of Object.entries(dt.env || {})) run.push('-e', `${k}=${v}`);
      if (INSECURE_SECCOMP) run.push('--security-opt', 'seccomp=unconfined');
      run.push(dt.image);
      await podman(run, { timeout: 10 * 60 * 1000 });

      member.ip = await containerIp(member.containerName, lab.netName);
      member.status = 'running';
      console.log(`[lab ${lab.id}] desktop pod up: ${podName} @ ${member.ip || '?'}`);
    } catch (err) {
      member.status = 'error';
      member.error = String(err.stderr || err.message).split('\n').slice(-2).join(' ').slice(0, 200);
      podman(['pod', 'rm', '-f', podName]).catch(() => {});
    }
  })();

  return member;
}

async function addTargetToLab(lab, t) {
  const def = POD_TARGETS.find((x) => x.id === (t.id || t.targetId));
  const ref = def ? def.image : t.image;
  const name = def ? def.name : String(ref || '').split('/').pop().split(':')[0] || 'target';
  if (!ref) throw httpError(400, 'target needs an image');
  const memberId = hex(4);
  const cname = `${LAB_NET_PREFIX}${lab.id}-${memberId}`;
  const member = {
    kind: 'target',
    id: memberId,
    cname,
    name,
    ref,
    ports: def ? def.ports : t.ports || [],
    status: 'creating',
    ip: null,
    error: null,
  };
  lab.members.push(member);

  (async () => {
    try {
      await podman(['run', '-d', '--network', lab.netName,
        '--label', `podstream.lab=${lab.id}`,
        '--label', 'podstream.role=target',
        '--name', cname, ref], { timeout: 15 * 60 * 1000 });
      member.ip = await containerIp(cname, lab.netName);
      member.status = 'running';
      console.log(`[lab ${lab.id}] target up: ${name} @ ${member.ip || '?'}`);
    } catch (err) {
      member.status = 'error';
      member.error = String(err.stderr || err.message).split('\n').slice(-2).join(' ').slice(0, 200);
      podman(['rm', '-f', cname]).catch(() => {});
    }
  })();

  return member;
}

async function createLab(opts = {}) {
  const dt = getTemplate(opts.desktop);
  if (!dt) throw httpError(404, `unknown desktop '${opts.desktop}'`);
  const id = hex(4);
  const netName = `${LAB_NET_PREFIX}${id}`;
  const lab = {
    id,
    name: opts.name || `lab-${id}`,
    netName,
    members: [],
    status: 'creating',
    error: null,
    createdAt: Date.now(),
  };
  labs.set(id, lab);
  console.log(`[lab ${id}] creating network ${netName}`);

  (async () => {
    try {
      await podman(['network', 'create', '--label', `podstream.lab=${id}`, netName]);
      await addDesktopToLab(lab, dt);
      lab.status = 'ready';
      console.log(`[lab ${id}] ready`);
    } catch (err) {
      lab.status = 'error';
      lab.error = String(err.stderr || err.message).split('\n').slice(-2).join(' ').slice(0, 300);
      console.error(`[lab ${id}] failed: ${lab.error}`);
    }
  })();

  return publicLab(lab);
}

function findLab(id) {
  const lab = labs.get(id);
  if (!lab) throw httpError(404, 'no such lab');
  return lab;
}

async function deleteLab(id) {
  const lab = findLab(id);
  for (const m of lab.members) {
    if (m.kind === 'desktop') await podman(['pod', 'rm', '-f', m.podName], { timeout: 120 * 1000 }).catch(() => {});
    else await podman(['rm', '-f', m.cname], { timeout: 60 * 1000 }).catch(() => {});
  }
  await podman(['network', 'rm', '-f', lab.netName], { timeout: 60 * 1000 }).catch(() => {});
  labs.delete(id);
  console.log(`lab ${id} removed (${lab.netName})`);
}

async function deleteLabMember(lab, memberId) {
  const m = lab.members.find((x) => x.id === memberId);
  if (!m) throw httpError(404, 'no such member');
  if (m.kind === 'desktop') await podman(['pod', 'rm', '-f', m.podName], { timeout: 120 * 1000 }).catch(() => {});
  else await podman(['rm', '-f', m.cname], { timeout: 60 * 1000 }).catch(() => {});
  lab.members = lab.members.filter((x) => x.id !== memberId);
}

/** Drop labs whose network or members disappeared behind our back. */
async function reconcileLabs() {
  try {
    for (const [id, lab] of [...labs]) {
      let netOk = true;
      try {
        netOk = await podman(['network', 'exists', lab.netName]).then(() => true).catch(() => false);
      } catch {
        netOk = true;
      }
      if (!netOk) {
        console.log(`[${id}] lab network ${lab.netName} is gone, dropping lab`);
        labs.delete(id);
        continue;
      }
      for (const m of [...lab.members]) {
        if (m.status === 'creating') continue; // creation in flight
        const ok = await podman(['container', 'exists', m.containerName || m.cname]).then(() => true).catch(() => false);
        if (!ok) {
          console.log(`[lab ${id}] member ${m.name} is gone, dropping it`);
          lab.members = lab.members.filter((x) => x !== m);
        }
      }
    }
  } catch {
    /* podman hiccup — try again next round */
  }
}

/** On startup, re-adopt labs (bridge networks + pods + containers) that are
 *  still running from a previous instance. */
async function adoptLabs() {
  let nets;
  try {
    nets = (await podman(['network', 'ls', '--filter', `name=${LAB_NET_PREFIX}`, '--format', '{{.Name}}']))
      .split('\n').map((s) => s.trim()).filter((n) => n.startsWith(LAB_NET_PREFIX));
  } catch {
    return;
  }
  for (const netName of nets) {
    const id = netName.slice(LAB_NET_PREFIX.length);
    if (labs.has(id)) continue;
    const lab = {
      id,
      name: `lab-${id}`,
      netName,
      members: [],
      status: 'ready',
      error: null,
      createdAt: Date.now(),
    };

    // Desktop pods: the pod carries our labels, so enumerate pods directly.
    // (The label filter on `podman ps` finds only the infra container, which
    // podman names <pod-id>-infra — not the desktop container we need.)
    let pods = '';
    try {
      pods = await podman(['pod', 'ps', '--filter', `label=podstream.lab=${id}`, '--format', '{{.Name}}']);
    } catch {
      pods = '';
    }
    for (const podName of pods.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const desktop = `${podName}-desktop`;
      const exists = await podman(['container', 'exists', desktop]).then(() => true).catch(() => false);
      if (!exists) continue;
      let vncPort = null;
      try {
        const ports = await podman(['port', desktop, '5901/tcp']);
        const pm = ports.match(/127\.0\.0\.1:(\d+)/);
        if (pm) vncPort = parseInt(pm[1], 10);
      } catch { /* no published port */ }
      if (!vncPort) continue; // can't stream it — skip
      let cockpitPort = null;
      try {
        const cports = await podman(['port', desktop, '9090/tcp']);
        const cm = cports.match(/127\.0\.0\.1:(\d+)/);
        if (cm) cockpitPort = parseInt(cm[1], 10);
      } catch { /* no cockpit edge */ }
      let ip = null;
      try { ip = await containerIp(desktop, netName); } catch { /* keep null */ }
      let vncpw = null;
      let termUser = 'user';
      try {
        vncpw = await podman(['pod', 'inspect', '-f', '{{(index .Labels "podstream.vncpw")}}', podName]) || null;
        termUser = await podman(['pod', 'inspect', '-f', '{{(index .Labels "podstream.termuser")}}', podName]) || 'user';
      } catch { /* labels unreadable — defaults fine */ }
      lab.members.push({
        kind: 'desktop', id: hex(4), podName, containerName: desktop,
        name: `${podName} pod (adopted)`,
        desktop: 'adopted', desktopName: 'desktop (adopted)',
        hostname: podName, termUser, vncPort, cockpitPort, vncPassword: vncpw,
        status: 'running', ip, error: null,
      });
      console.log(`[lab ${id}] adopted desktop pod ${podName} (vnc :${vncPort}${cockpitPort ? `, cockpit :${cockpitPort}` : ''})`);
    }

    // Targets: plain containers with our labels (pod infra containers carry
    // role=desktop and are skipped here).
    let out = '';
    try {
      out = await podman([
        'ps', '--filter', `label=podstream.lab=${id}`, '--filter', 'status=running',
        '--format', '{{.Names}}\t{{.Label "podstream.role"}}',
      ]);
    } catch {
      out = '';
    }
    for (const line of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const [cname, role] = line.split('\t');
      if (!cname || role === 'desktop') continue;
      let ip = null;
      try { ip = await containerIp(cname, netName); } catch { /* keep null */ }
      lab.members.push({
        kind: 'target', id: hex(4), cname, name: cname.replace(`${LAB_NET_PREFIX}${id}-`, ''),
        ref: null, ports: [], status: 'running', ip, error: null,
      });
      console.log(`[lab ${id}] adopted target ${cname}`);
    }
    labs.set(id, lab);
    console.log(`[lab ${id}] adopted (${lab.members.length} members)`);
  }
}

module.exports = {
  POD_TARGETS,
  LAB_NET_PREFIX,
  publicLab,
  addDesktopToLab,
  addTargetToLab,
  createLab,
  findLab,
  deleteLab,
  deleteLabMember,
  reconcileLabs,
  adoptLabs,
};
