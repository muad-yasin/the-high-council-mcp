// The request guard for the local web UI (0.8.0, B11). Node built-ins only; it is what stands between
// a page in the same browser (DNS rebinding, cross-site requests, clickjacking) and a server that will
// one day be able to start paid runs. Design and tests: wave-4 brief 14 (thc-research
// results/14-webui-local-security/, 17 tests, plus a real-Chromium check), written from the specs and
// advisories named there; no code from other projects.
//
// Order matters: the cheapest, least informative refusal first, so a scanner learns nothing from a wrong
// Host. Every refusal is the same body (see refusalBody), and every reply, refusals included, carries
// SECURITY_HEADERS.
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const makeToken = () => randomBytes(32).toString('base64url');

const sha = s => createHash('sha256').update(String(s)).digest();
export const tokenEquals = (a, b) => timingSafeEqual(sha(a), sha(b));

// frame-ancestors is NOT covered by default-src and is ignored in a <meta> policy, so the policy has
// to be an HTTP header. script-src and style-src 'self' also mean no inline script, no inline handler
// and no style="" attribute anywhere in the page (a style set from script through the CSSOM is fine).
export const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
    "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};

export const refusalBody = '{"error":"refused"}';

const SAFE = new Set(['GET', 'HEAD']);

// createGuard({ port, token, extraHosts, tokenForReads }) -> { check(req, opts), hosts, origins }
//   token          the per-launch secret. With none, every state-changing request and every stream is
//                  refused (fail closed): the read-only viewer has no route that needs one.
//   tokenForReads  also require the token on plain GETs of api routes (the run-starting UI will).
//   extraHosts     exact extra Host values (a proxy or Docker user), never wildcards.
// check() returns { ok: true } or { ok: false, status, reason }; `reason` is for logs and tests, never
// for the reply body.
export function createGuard({ port, token = null, extraHosts = [], tokenForReads = false }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...extraHosts.map(h => String(h).toLowerCase())]);
  const origins = new Set([...hosts].map(h => `http://${h}`));
  const no = (status, reason) => ({ ok: false, status, reason });

  // opts: api = an /api route, stream = a long-lived event stream, anon = the one anonymous route
  // (a ticket exchange), which still has to pass Host, Origin and content type.
  function check(req, { api = false, stream = false, anon = false } = {}) {
    // 1. Host: exactly one, an exact match (DNS rebinding sends the attacker's own name). Node keeps
    //    one `host` in req.headers, so the duplicates are counted in rawHeaders.
    const rawHosts = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'host') rawHosts.push(req.rawHeaders[i + 1]);
    if (rawHosts.length !== 1 || !hosts.has(rawHosts[0].toLowerCase())) return no(403, 'host');

    const method = req.method || 'GET';
    const changing = !SAFE.has(method);
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];

    // 2. Fetch Metadata, when the browser sends it: another site is refused for anything that changes
    //    state or streams. "none" is a typed URL or a bookmark. A second layer only: non-browser
    //    clients send none.
    if ((changing || stream) && site && site !== 'same-origin' && !(site === 'none' && !changing)) return no(403, 'site');

    // 3. Origin: if present it must be one of ours ("null" is not). State changes and streams must
    //    carry one (browsers always send it on non-GET fetches). No Access-Control-* header is ever
    //    sent, so no other origin can read a reply either.
    if (origin !== undefined && !origins.has(String(origin).toLowerCase())) return no(403, 'origin');
    if ((changing || stream) && origin === undefined) return no(403, 'origin-missing');

    if (!api && !changing) return { ok: true };

    // 4. Method and content type: no preflight is ever answered, and only JSON bodies are read.
    if (method === 'OPTIONS') return no(405, 'method');
    if (changing) {
      if (method !== 'POST') return no(405, 'method');
      if (!/^application\/json(\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) return no(415, 'content-type');
    }

    // 5. The per-launch secret, in a header only. Never in the query string, a cookie or a log: it
    //    would reach history, Referer and the process list.
    if (anon) return { ok: true };
    if (!changing && !stream && !tokenForReads) return { ok: true };
    if (!token) return no(401, 'no-token-configured');
    const auth = req.headers.authorization || '';
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!given || !tokenEquals(given, token)) return no(401, 'token');
    return { ok: true };
  }
  return { check, hosts, origins };
}
