'use strict';

const { httpError } = require('./lib/http');
const { podman } = require('./lib/podman');
const { listTemplates } = require('./templates');

/** Group `podman images --format` output rows into one record per image ID.
 *  Podman keeps ONE copy of the layers no matter how many tags point at it
 *  (e.g. localhost/podstream-x + quay.io/.../podstream-x), so one row per image
 *  is what actually matches disk usage. */
function groupImageRows(out, templateRefs) {
  const templateImages = new Set(templateRefs);
  const byId = new Map();
  for (const line of out.split('\n').filter(Boolean)) {
    const [id, ref, size, created] = line.split('\t');
    if (!id || !ref) continue;
    const rec = byId.get(id) || { id: id.slice(0, 12), refs: [], size, created, usedByApp: false, dangling: true };
    rec.refs.push(ref);
    if (!ref.includes('<none>')) rec.dangling = false;
    if (templateImages.has(ref)) rec.usedByApp = true;
    byId.set(id, rec);
  }
  return [...byId.values()].map((r) => ({
    ...r,
    ref: r.refs.find((x) => !x.includes('<none>')) || '<none>:<none>',
  }));
}

async function listImages() {
  const out = await podman(['images', '--format', '{{.ID}}\t{{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}']);
  return groupImageRows(out, listTemplates().map((t) => t.image));
}

/** Remove an image by ref (or id for dangling images). Refuses anything a
 *  container uses, and never force-removes. */
async function removeImage(ref) {
  if (!ref || ref.includes('<none>')) throw httpError(400, 'missing image ref');
  // Ask podman directly — this covers every container (running, stopped,
  // adopted, or created outside PodStream), not just our session records.
  const users = await podman([
    'ps', '-a', '--filter', `ancestor=${ref}`, '--format', '{{.ID}} {{.Names}}',
  ]).catch(() => '');
  if (users) {
    throw httpError(409, `image is used by container(s): ${users.split('\n').join(' | ')} — remove them first`);
  }
  try {
    // deliberately no -f: podman must never break containers behind our back
    await podman(['rmi', ref], { timeout: 5 * 60 * 1000 });
  } catch (err) {
    throw httpError(err.status || 500, String(err.stderr || err.message).split('\n').slice(-2).join(' ').trim());
  }
  console.log(`image removed: ${ref}`);
}

module.exports = { listImages, removeImage, groupImageRows };
