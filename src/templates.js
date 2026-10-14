'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./config');

const DEFAULT_TEMPLATES = [
  {
    id: 'xfce-firefox',
    name: 'Firefox',
    icon: '🦊',
    description: 'Firefox on an XFCE desktop',
    image: 'docker.io/accetto/ubuntu-vnc-xfce-firefox:latest',
    displayPort: 5901,
    resolution: '1600x900',
    vncPasswordEnv: 'VNC_PW',
    vncPassword: 'headless',
    env: {},
  },
  {
    id: 'xfce',
    name: 'XFCE Desktop',
    icon: '🖥️',
    description: 'Plain XFCE desktop (Ubuntu)',
    image: 'docker.io/accetto/ubuntu-vnc-xfce:latest',
    displayPort: 5901,
    resolution: '1600x900',
    vncPasswordEnv: 'VNC_PW',
    vncPassword: 'headless',
    env: {},
  },
  {
    id: 'xfce-gimp',
    name: 'GIMP',
    icon: '🖌️',
    description: 'GIMP image editor on XFCE',
    image: 'docker.io/accetto/ubuntu-vnc-xfce-gimp:latest',
    displayPort: 5901,
    resolution: '1600x900',
    vncPasswordEnv: 'VNC_PW',
    vncPassword: 'headless',
    env: {},
  },
  {
    id: 'example-image',
    name: 'Custom image',
    icon: '📦',
    description: 'Built from ./example-image (podman build -t podstream-example ./example-image)',
    image: 'localhost/podstream-example:latest',
    displayPort: 5901,
    resolution: '1440x900',
    vncPasswordEnv: 'VNC_PW',
    vncPassword: null, // null = generate a random password per session
    env: {},
  },
];

function normalizeTemplate(t) {
  if (!t.id || !t.image) throw new Error('template needs at least "id" and "image"');
  t.id = String(t.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!t.id) throw new Error('template id is empty after sanitizing');
  t.name = t.name || t.id;
  t.displayPort = parseInt(t.displayPort || 5901, 10);
  t.termUser = t.termUser || 'user';
  t.cockpit = !!t.cockpit; // template's image runs cockpit-ws on 9090
  t.env = t.env || {};
  return t;
}

// Where GUI-made template changes are persisted. TEMPLATES_FILE wins; otherwise
// templates.local.json in the project root (auto-created on first change).
const TEMPLATES_STORE = process.env.TEMPLATES_FILE || path.join(ROOT, 'templates.local.json');

function loadTemplates() {
  let list = DEFAULT_TEMPLATES.map(normalizeTemplate);
  if (fs.existsSync(TEMPLATES_STORE)) {
    const raw = JSON.parse(fs.readFileSync(TEMPLATES_STORE, 'utf8'));
    // Two file formats:
    //   [ ...templates ]            legacy/GUI-less: merged over the defaults
    //   { removedIds, templates }   GUI-managed snapshot: defaults minus
    //                               removedIds, overridden by `templates`
    const removed = Array.isArray(raw) ? [] : raw.removedIds || [];
    const templates = Array.isArray(raw) ? raw : raw.templates || [];
    const byId = new Map(list.map((t) => [t.id, t]));
    for (const id of removed) byId.delete(id);
    for (const t of templates) byId.set(t.id, normalizeTemplate(t));
    list = [...byId.values()];
  }
  return list;
}

let templates = loadTemplates();

function listTemplates() {
  return templates;
}

function getTemplate(id) {
  return templates.find((t) => t.id === id);
}

/** Snapshot the current template set to disk so it survives restarts. */
function persistTemplates() {
  const removedIds = DEFAULT_TEMPLATES.map((t) => t.id).filter((id) => !templates.some((t) => t.id === id));
  fs.writeFileSync(TEMPLATES_STORE, JSON.stringify({ removedIds, templates }, null, 2) + '\n');
}

/** Add a normalized template and persist; caller checks for duplicate ids. */
function addTemplate(t) {
  templates.push(t);
  persistTemplates();
}

/** Remove a template by id and persist; false when there was no such id. */
function removeTemplate(id) {
  const before = templates.length;
  templates = templates.filter((t) => t.id !== id);
  if (templates.length === before) return false;
  persistTemplates();
  return true;
}

module.exports = { normalizeTemplate, listTemplates, getTemplate, addTemplate, removeTemplate };
