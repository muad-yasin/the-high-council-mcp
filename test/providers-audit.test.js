// test/providers-audit.test.js - 2026-09-23 audit, Review/BugAudit_Providers_2026-09-23.md #3, #5, #6.
// Offline: a local HTTP server or a stubbed fetch, provider `ollama` (no key needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { call, normaliseStop, redactUrlCredentials, setRequestDeadline, setRetrySleep } from '../src/providers.js';

const opts = (baseUrl) => ({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, baseUrl });

function server(handler) {
  return new Promise((resolve) => {
    let hits = 0;
    const srv = createServer((req, res) => { hits += 1; handler(req, res); });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, hits: () => hits, close: () => { srv.closeAllConnections(); srv.close(); } }));
  });
}

// ---- #3: a request deadline, and plain words for Node's headers timeout ----

test('#3: a body that trickles forever ends at the request deadline, once, flagged as maybe billed', async () => {
  const s = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"choices": [');
    const t = setInterval(() => res.write(' '), 50);
    req.on('close', () => clearInterval(t));
  });
  setRequestDeadline(400);
  setRetrySleep(async () => {});
  try {
    await assert.rejects(call('ollama', opts(s.url)), (err) => /request deadline/.test(err.message) && err.maybeBilled === true);
    assert.equal(s.hits(), 1, 'a maybe-billed request must not be re-sent');
  } finally {
    setRequestDeadline(null);
    setRetrySleep(null);
    s.close();
  }
});

test("#3: Node's 300 s headers timeout is explained, and not retried", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const err = new TypeError('fetch failed');
    err.cause = { code: 'UND_ERR_HEADERS_TIMEOUT' };
    throw err;
  };
  setRetrySleep(async () => {});
  try {
    await assert.rejects(call('ollama', opts('http://127.0.0.1:9')), (err) => /300 s/.test(err.message) && /maxTokens/.test(err.message));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = real;
    setRetrySleep(null);
  }
});

// ---- #5: cut-off stop reasons under other names ----

test('#5: Mistral model_length and Anthropic model_context_window_exceeded read as a cut-off', () => {
  assert.equal(normaliseStop('model_length'), 'length');
  assert.equal(normaliseStop('model_context_window_exceeded'), 'length');
  for (const same of ['length', 'max_tokens', 'stop', 'end_turn', 'error']) assert.equal(normaliseStop(same), same);
  assert.equal(normaliseStop(null), null);
  assert.equal(normaliseStop(undefined), null);
});

test('#5: the adapter reports the normalised stop', async () => {
  const s = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"a": "cut' }, finish_reason: 'model_length' }], usage: { prompt_tokens: 1, completion_tokens: 10 } }));
  });
  try {
    const r = await call('ollama', opts(s.url));
    assert.equal(r.usage.stop, 'length');
  } finally {
    s.close();
  }
});

// ---- #6: credentials in a baseUrl ----

test('#6: a baseUrl with credentials is refused before anything is sent, without repeating them', async () => {
  const s = await server((req, res) => res.end('{}'));
  const withCreds = s.url.replace('http://', 'http://admin:hunter2secret@');
  try {
    await assert.rejects(call('ollama', opts(withCreds)), (err) => /credentials/.test(err.message) && !err.message.includes('hunter2secret'));
    assert.equal(s.hits(), 0);
  } finally {
    s.close();
  }
});

test('#6: redactUrlCredentials removes user:pass from any message', () => {
  assert.equal(redactUrlCredentials('fetch http://admin:pw@host:1/v1 failed'), 'fetch http://[redacted]@host:1/v1 failed');
  assert.equal(redactUrlCredentials('https://host/v1 ok'), 'https://host/v1 ok');
});
