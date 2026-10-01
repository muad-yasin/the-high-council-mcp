// The local UI's request guard (src/ui/guard.js, 0.8.0 B11) and its wiring into the run viewer.
// Designed and first tested in wave-4 brief 14 (thc-research results/14-webui-local-security/, plus a
// real-Chromium check that cannot run here). $0: no browser, no provider, no chain. Node's http client
// sets Host and Origin freely, which is exactly what a rebinding page or a hostile tool can do at the
// wire level; what a browser will or will not send is not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuard, makeToken, tokenEquals, SECURITY_HEADERS, refusalBody } from '../src/ui/guard.js';

const here = dirname(fileURLToPath(import.meta.url));
const ui = f => resolve(here, '../src/ui', f);
const PORT = 8787;

// A request as Node gives it to a handler: headers lower-cased in `headers`, every header pair kept in `rawHeaders`.
const fake = ({ method = 'GET', host = `127.0.0.1:${PORT}`, headers = {} } = {}) => {
  const h = { ...(host === null ? {} : { host }), ...headers };
  return { method, headers: h, rawHeaders: Object.entries(h).flatMap(([k, v]) => [k, v]) };
};
const JSON_CT = { 'content-type': 'application/json' };
const ORIGIN = { origin: `http://127.0.0.1:${PORT}` };

test('guard, Host: only the two loopback names on this port, exactly one Host header', () => {
  const g = createGuard({ port: PORT });
  for (const host of [`evil.example:${PORT}`, 'evil.example', `127.0.0.1.evil.example:${PORT}`, `127.0.0.1:${PORT + 1}`, 'localhost', `localhost.:${PORT}`,
    `[::1]:${PORT}`, `0.0.0.0:${PORT}`, `evil.localhost:${PORT}`, `evil.example@127.0.0.1:${PORT}`, `127.0.0.1:${PORT}@evil.example`, `127.0.0.1:${PORT}.evil.example`,
    `127.0.0.1:0${PORT}`, `127.1:${PORT}`, `0x7f.0.0.1:${PORT}`, `127.0.0.2:${PORT}`, `2130706433:${PORT}`, null]) {
    const r = g.check(fake({ host }));
    assert.equal(r.ok, false, `Host ${JSON.stringify(host)}`);
    assert.equal(r.status, 403);
  }
  assert.equal(g.check(fake()).ok, true);
  assert.equal(g.check(fake({ host: `LocalHost:${PORT}` })).ok, true, 'host names are case-insensitive');
  const dup = fake();
  dup.rawHeaders.push('Host', 'evil.example');
  assert.equal(g.check(dup).ok, false, 'two Host headers');
  assert.equal(createGuard({ port: PORT, extraHosts: ['Proxy.Lan:9000'] }).check(fake({ host: 'proxy.lan:9000', headers: {} })).ok, true, 'an exact extra host is allowed, case-insensitively');
  assert.equal(createGuard({ port: PORT, extraHosts: ['proxy.lan:9000'] }).check(fake({ host: 'other.lan:9000' })).ok, false);
});

test('guard, Origin: foreign, null and missing-on-a-change are refused', () => {
  const g = createGuard({ port: PORT, token: 't' });
  for (const origin of ['http://evil.example', 'null', `http://127.0.0.1:${PORT + 1}`, `http://localhost:${PORT + 1}`, `https://127.0.0.1:${PORT}`,
    `http://foo.localhost:${PORT}`, `http://127.0.0.1.evil.example:${PORT}`]) {
    assert.equal(g.check(fake({ headers: { origin } })).ok, false, `GET with Origin ${origin}`);
    const r = g.check(fake({ method: 'POST', headers: { origin, ...JSON_CT, authorization: 'Bearer t' } }), { api: true });
    assert.equal(r.status, 403, `POST with Origin ${origin}`);
  }
  assert.equal(g.check(fake({ method: 'POST', headers: { ...JSON_CT, authorization: 'Bearer t' } }), { api: true }).reason, 'origin-missing', 'a POST with no Origin fails closed');
  assert.equal(g.check(fake({ headers: ORIGIN })).ok, true, 'our own Origin on a GET');
  assert.equal(g.check(fake()).ok, true, 'no Origin on a plain GET (a same-origin fetch sends none)');
});

test('guard, Fetch Metadata: same-site and cross-site changes and streams are refused even with a good Origin', () => {
  const g = createGuard({ port: PORT, token: 't' });
  const post = site => g.check(fake({ method: 'POST', headers: { ...ORIGIN, ...JSON_CT, authorization: 'Bearer t', 'sec-fetch-site': site } }), { api: true });
  assert.equal(post('cross-site').status, 403);
  assert.equal(post('same-site').status, 403);
  assert.equal(post('none').status, 403, '"none" is a typed URL, never a change');
  assert.equal(post('same-origin').ok, true);
  assert.equal(g.check(fake({ headers: { ...ORIGIN, authorization: 'Bearer t', 'sec-fetch-site': 'cross-site' } }), { api: true, stream: true }).status, 403);
  assert.equal(g.check(fake({ headers: { 'sec-fetch-site': 'none' } })).ok, true, 'a typed URL may load the page');
});

test('guard, methods and content type: no preflight, POST with JSON only', () => {
  const g = createGuard({ port: PORT, token: 't' });
  const auth = { authorization: 'Bearer t' };
  assert.equal(g.check(fake({ method: 'OPTIONS', headers: { ...ORIGIN, 'access-control-request-method': 'POST' } }), { api: true }).status, 405);
  for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal(g.check(fake({ method, headers: { ...ORIGIN, ...JSON_CT, ...auth } }), { api: true }).status, 405, method);
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '', 'application/json-patch+json', 'application/jsonx'])
    assert.equal(g.check(fake({ method: 'POST', headers: { ...ORIGIN, 'content-type': ct, ...auth } }), { api: true }).status, 415, JSON.stringify(ct));
  assert.equal(g.check(fake({ method: 'POST', headers: { ...ORIGIN, 'content-type': 'application/json; charset=utf-8', ...auth } }), { api: true }).ok, true);
});

test('guard, token: fail closed with none configured; in a header only; reads need it only when asked', () => {
  const change = (g, headers = {}) => g.check(fake({ method: 'POST', headers: { ...ORIGIN, ...JSON_CT, ...headers } }), { api: true });
  const none = createGuard({ port: PORT });
  assert.equal(change(none, { authorization: 'Bearer anything' }).status, 401, 'no token configured: every change is refused');
  assert.equal(none.check(fake({ headers: ORIGIN }), { api: true, stream: true }).status, 401, 'and every stream');
  assert.equal(none.check(fake(), { api: true }).ok, true, 'a plain read of the read-only viewer needs none');

  const token = makeToken();
  assert.ok(token.length >= 43, '256 random bits, base64url');
  assert.notEqual(token, makeToken());
  const g = createGuard({ port: PORT, token });
  assert.equal(change(g, { authorization: `Bearer ${token}` }).ok, true);
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: `Bearer ${token}x` }, { authorization: token }, { authorization: `Basic ${token}` }, { cookie: `token=${token}` }])
    assert.equal(change(g, headers).status, 401, JSON.stringify(headers));
  const urlToken = fake({ headers: { ...ORIGIN, ...JSON_CT } });
  urlToken.url = `/api/x?token=${token}`;
  assert.equal(g.check({ ...urlToken, method: 'POST' }, { api: true }).status, 401, 'a token in the URL is not read');

  const reads = createGuard({ port: PORT, token, tokenForReads: true });
  assert.equal(reads.check(fake(), { api: true }).status, 401);
  assert.equal(reads.check(fake({ headers: { authorization: `Bearer ${token}` } }), { api: true }).ok, true);
  assert.equal(reads.check(fake()).ok, true, 'the page shell itself never needs the token');
  assert.equal(reads.check(fake({ method: 'POST', headers: { ...ORIGIN, ...JSON_CT } }), { api: true, anon: true }).ok, true, 'the anonymous route still passes Host, Origin and content type');
  assert.equal(reads.check(fake({ method: 'POST', headers: { origin: 'http://evil.example', ...JSON_CT } }), { api: true, anon: true }).status, 403);
  assert.equal(tokenEquals('a', 'a'), true);
  assert.equal(tokenEquals('a', 'b'), false);
});

test('security headers: CSP with frame-ancestors none, no inline, no wildcard; and no CORS header exists', () => {
  const csp = SECURITY_HEADERS['content-security-policy'];
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.equal(SECURITY_HEADERS['x-frame-options'], 'DENY');
  assert.equal(SECURITY_HEADERS['x-content-type-options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['referrer-policy'], 'no-referrer');
  assert.equal(SECURITY_HEADERS['cache-control'], 'no-store');
  assert.equal(Object.keys(SECURITY_HEADERS).filter(k => k.startsWith('access-control-')).length, 0);
  assert.deepEqual(JSON.parse(refusalBody), { error: 'refused' });
});

test('the page runs under that CSP: no inline style, handler or script in index.html and app.js', () => {
  const html = readFileSync(ui('index.html'), 'utf8');
  const js = readFileSync(ui('app.js'), 'utf8');
  for (const [name, text] of [['index.html', html], ['app.js', js]]) {
    assert.doesNotMatch(text, /\sstyle\s*=/i, `${name}: a style attribute would be blocked by style-src 'self'`);
    assert.doesNotMatch(text, /\son[a-z]+\s*=\s*["']/i, `${name}: an inline event handler would be blocked by script-src 'self'`);
    assert.doesNotMatch(text, /javascript:/i, name);
  }
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, 'index.html: no inline <script>');
  assert.doesNotMatch(html, /<style[\s>]/i, 'index.html: no inline <style>');
  assert.doesNotMatch(js, /setAttribute\(\s*['"]style/, 'app.js: the style attribute is refused by the CSP; use element.style');
  assert.doesNotMatch(html + js, /https?:\/\/(?!127\.0\.0\.1|localhost)/, 'no third-party request');
});

// ---- the viewer, over the wire ----
function get(port, path, { method = 'GET', headers = {}, host = `127.0.0.1:${port}` } = {}) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host, ...headers } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}
const rawRequest = (port, text) => new Promise((ok, fail) => {
  const c = connect(port, '127.0.0.1', () => c.write(text));
  let o = '';
  c.on('data', d => { o += d; });
  c.on('end', () => ok(o.split('\r\n')[0]));
  c.on('error', fail);
  setTimeout(() => { c.destroy(); ok(o.split('\r\n')[0]); }, 500);
});

test('run viewer: every reply carries the security headers; only the three page files are served; nothing can change state', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [ui('server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => {
      child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); });
      child.on('exit', code => fail(new Error(`viewer exited early (${code})`)));
    });
    const own = { origin: `http://127.0.0.1:${port}` };
    const replies = [
      await get(port, '/'), await get(port, '/app.js'), await get(port, '/style.css'), await get(port, '/index.html'), await get(port, '/api/runs'),
      await get(port, '/nope'), await get(port, '/server.js'), await get(port, '/', { host: 'evil.example' }),
      await get(port, '/api/runs', { headers: { origin: 'http://evil.example' } }), await get(port, '/api/runs', { method: 'POST', headers: { ...own, 'content-type': 'application/json' } }),
    ];
    for (const r of replies) {
      assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.equal(r.headers['x-frame-options'], 'DENY');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['referrer-policy'], 'no-referrer');
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.equal(Object.keys(r.headers).filter(k => k.startsWith('access-control-')).length, 0, 'no CORS header on any reply');
    }
    assert.deepEqual(replies.slice(0, 5).map(r => r.status), [200, 200, 200, 200, 200]);
    // Not served: the server's own source, the parser, the guard, dotfiles, traversal.
    for (const p of ['/server.js', '/parse.js', '/guard.js', '/../package.json', '/%2e%2e/package.json', '/.env', '/app.js/', '/style.css?x=1/../server.js']) {
      const r = await get(port, p);
      assert.ok(r.status === 404 || r.status === 200 && ['/style.css?x=1/../server.js'].includes(p), `${p} -> ${r.status}`);
      assert.ok(!/createServer|createGuard/.test(r.body), `${p} did not return source`);
    }
    assert.equal(replies[7].status, 403);
    assert.deepEqual(JSON.parse(replies[7].body), { error: 'refused' }, 'a refusal says nothing useful');
    assert.equal(replies[8].status, 403, 'a foreign Origin is refused on a read too');
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = await get(port, '/api/runs', { method, headers: { ...own, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } });
      assert.ok([401, 405].includes(r.status), `${method} -> ${r.status}: the viewer has no route that changes state, and no token`);
    }
    assert.match(await rawRequest(port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nHost: evil.example\r\nConnection: close\r\n\r\n`), / 403 /, 'two Host headers');
    assert.match(await rawRequest(port, 'GET / HTTP/1.0\r\n\r\n'), / 403 /, 'no Host');
    assert.equal((await get(port, '/api/runs')).status, 200, 'still up');
  } finally {
    child.kill();
  }
});
