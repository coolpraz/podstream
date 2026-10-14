/* REST client: fetch wrapper with bearer-token auth and 401 re-prompt. */

let TOKEN = localStorage.getItem('podstream_token') || '';

export function getToken() {
  return TOKEN;
}

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const t = prompt('Access token (AUTH_TOKEN env on the server):', TOKEN);
    TOKEN = t || '';
    if (TOKEN) localStorage.setItem('podstream_token', TOKEN);
    else localStorage.removeItem('podstream_token');
    throw new Error('Unauthorized — token saved, try again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}
