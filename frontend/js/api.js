// Thin fetch wrapper with timeouts. Every call resolves (never throws) so callers can fall back locally.

async function request(method, path, body, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) return { ok: false, status: res.status, error: data?.error || { code: 'HTTP_' + res.status, message: 'Request failed.' }, offline: false };
    return { ok: true, status: res.status, data, offline: false };
  } catch (e) {
    return { ok: false, status: 0, error: { code: e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', message: 'Server unreachable.' }, offline: true };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: (p, t) => request('GET', p, null, t),
  post: (p, b, t) => request('POST', p, b, t),
};

let healthCache = { at: 0, value: null };

/** Cached backend health; also reports whether Gemini is configured. */
export async function health(force = false) {
  if (!force && Date.now() - healthCache.at < 20000 && healthCache.value) return healthCache.value;
  const r = await api.get('/health', 2500);
  healthCache = { at: Date.now(), value: r.ok ? { online: true, gemini: !!r.data?.gemini?.enabled } : { online: false, gemini: false } };
  return healthCache.value;
}

export const contactsPayload = (list) => list.slice(0, 100).map((b) => ({ name: b.name, upi_id: b.upi_id || null, verified: !!b.verified, favorite: !!b.favorite }));
export const recentPayload = (txns) => txns.slice(0, 20).map((t) => ({ recipient: t.recipient, upi_id: t.upi_id || null, amount: t.amount, ts: t.ts, status: t.status }));
