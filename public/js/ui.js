/* Tiny DOM helpers shared by every page. */

export const $ = (s, r = document) => r.querySelector(s);

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export const fmtUptime = (sec) => {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
};

export const badge = (status) => {
  const map = { running: 'ok', ready: 'ok', pulling: 'warn', creating: 'warn', starting: 'warn', stopping: 'dim', error: 'err' };
  return el('span', `badge ${map[status] || 'dim'}`, status);
};
