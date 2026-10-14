/* Images: one row per on-disk image (tags grouped), dangling-image cleanup. */

import { state } from '../state.js';
import { el } from '../ui.js';
import { api } from '../api.js';
import { refreshImages } from '../refresh.js';

export function renderImages(c) {
  const bar = el('div', '');
  bar.style.display = 'flex';
  bar.style.justifyContent = 'space-between';
  bar.style.alignItems = 'center';
  bar.style.marginBottom = '12px';
  const note = el('span', 'muted', 'One row per image — multiple tags (localhost/… + quay.io/…) share the same copy on disk.');
  bar.append(note);
  const dangling = state.images.filter((i) => i.dangling);
  if (dangling.length) {
    const clean = el('button', 'small', `Clean dangling (${dangling.length})`);
    clean.title = 'Delete untagged leftovers of superseded builds/pulls — they are used by no container';
    clean.addEventListener('click', async () => {
      if (!confirm(`Delete ${dangling.length} dangling image(s)? They have no tag and no container.`)) return;
      clean.disabled = true;
      for (const img of dangling) {
        try {
          await api('/api/images', { method: 'DELETE', body: JSON.stringify({ ref: img.id }) });
        } catch (e) {
          alert(e.message);
          break;
        }
      }
      await refreshImages();
    });
    bar.append(clean);
  }
  c.append(bar);

  if (!state.images.length) {
    c.append(el('div', 'empty', 'No local images.'));
    return;
  }
  const table = el('table');
  const hr = el('tr');
  for (const h of ['Image', 'Size', 'Created', 'Used by an app', '']) hr.append(el('th', '', h));
  table.append(hr);
  const tbody = el('tbody');
  for (const img of state.images) {
    const tr = el('tr');
    const refTd = el('td');
    refTd.append(el('code', '', img.ref));
    if (img.refs && img.refs.length > 1) {
      const extra = img.refs.filter((r) => r !== img.ref).join(', ');
      refTd.append(el('div', 'muted', `also tagged ${extra} — same copy`));
    }
    if (img.dangling) refTd.append(el('div', 'muted', 'dangling — leftover of a superseded build/pull'));
    tr.append(refTd);
    tr.append(el('td', '', img.size));
    tr.append(el('td', '', img.created || ''));
    tr.append(el('td', '', img.usedByApp ? 'yes' : '—'));
    const delTd = el('td');
    const del = el('button', 'danger small', img.dangling ? 'Reclaim' : 'Delete');
    if (img.dangling) del.title = 'Untagged and unused — safe to remove';
    del.addEventListener('click', async () => {
      const target = img.dangling ? img.id : img.ref;
      if (!confirm(`Delete image ${img.dangling ? img.id : img.ref}? Images used by running sessions cannot be deleted.`)) return;
      del.disabled = true;
      try {
        await api('/api/images', { method: 'DELETE', body: JSON.stringify({ ref: target }) });
        await refreshImages();
      } catch (e) {
        alert(e.message);
      }
    });
    delTd.append(del);
    tr.append(delTd);
    tbody.append(tr);
  }
  table.append(tbody);
  c.append(table);
}
