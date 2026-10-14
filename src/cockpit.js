'use strict';

const { labs, sessions } = require('./state');

// Resolve an instance/lab-pod id to its Cockpit host edge for the proxy. The
// proxy must target the published 127.0.0.1 edge — the host cannot open TCP
// connections to rootless container IPs (slirp4netns has none at all, and lab
// bridge addresses are unreachable from the host netns).
function cockpitEntry(id) {
  const s = sessions.get(id);
  if (s && s.status === 'running') return { port: s.cockpitPort, session: s };
  for (const lab of labs.values()) {
    const m = lab.members.find((x) => x.id === id && x.kind === 'desktop' && x.status === 'running');
    if (m) return { port: m.cockpitPort, member: m, lab };
  }
  return null;
}

module.exports = { cockpitEntry };
