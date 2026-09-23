// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_Providers_2026-09-23.md #1, #2, #4).
// Offline: globalThis.fetch is stubbed for every call (the same guard test/openrouter-fixtures.test.js
// uses), and the retry backoff is replaced so nothing waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, setRetrySleep, isRetryable, usageOfOpenAICompat } from '../src/providers.js';
import { runChain, setBudget, setCache, budgetState } from '../src/chain.js';

const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const reply = { model: 'm', choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };

async function withStub(responder, fn) {
  const original = globalThis.fetch; const hadKey = process.env.OPENROUTER_API_KEY;
  const sleeps = []; let n = 0;
  globalThis.fetch = async (...a) => responder(++n, ...a);
  process.env.OPENROUTER_API_KEY = 'sk-test';
  setRetrySleep(async ms => { sleeps.push(ms); });
  try { return await fn({ calls: () => n, sleeps }); }
  finally {
    globalThis.fetch = original; setRetrySleep(null);
    if (hadKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = hadKey;
  }
}
const ask = () => call('openrouter', { model: 'x/y', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 100 });

test('a connection dropped while reading a 200 body is not re-sent, and is marked maybeBilled', async () => {
  await withStub(() => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"choi')); c.error(new TypeError('terminated')); } }), { status: 200 }), async ({ calls }) => {
    await assert.rejects(ask, err => err.maybeBilled === true);
    assert.equal(calls(), 1, 'a paid generation must not be requested again');
  });
});

test('a truncated or HTML 200 is not re-sent, and is marked maybeBilled', async () => {
  for (const body of ['{"choices":[{"mess', '<html>proxy error</html>']) {
    await withStub(() => new Response(body, { status: 200 }), async ({ calls }) => {
      await assert.rejects(ask, err => err.maybeBilled === true);
      assert.equal(calls(), 1, body);
    });
  }
});

test('a failure after sending (reset / headers timeout) is not retried; a refused connection is', async () => {
  const fail = code => { const e = new TypeError('fetch failed'); e.cause = { code }; return e; };
  await withStub(() => { throw fail('UND_ERR_HEADERS_TIMEOUT'); }, async ({ calls }) => {
    await assert.rejects(ask, err => err.maybeBilled === true);
    assert.equal(calls(), 1);
  });
  await withStub(n => { if (n < 3) throw fail('ECONNREFUSED'); return ok(reply); }, async ({ calls }) => {
    assert.equal((await ask()).text, 'hi');
    assert.equal(calls(), 3, 'nothing was sent, so retrying is free');
  });
});

test('429/5xx are still retried; Retry-After is honoured; no sleep after the final attempt', async () => {
  await withStub(n => n === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }) : ok(reply), async ({ calls, sleeps }) => {
    assert.equal((await ask()).text, 'hi');
    assert.equal(calls(), 2);
    assert.deepEqual(sleeps, [30000]);
  });
  await withStub(() => new Response('down', { status: 503 }), async ({ calls, sleeps }) => {
    await assert.rejects(ask, err => err.status === 503 && !err.maybeBilled);
    assert.equal(calls(), 3);
    assert.equal(sleeps.length, 2, 'two waits between three tries, none after the last');
  });
  assert.equal(isRetryable({ status: 400 }), false);
});

test('invoke charges a maybe-billed failure to the run spend, so the cap still sees it', async () => {
  await withStub(() => new Response('<html>', { status: 200 }), async () => {
    setCache(null); setBudget(1000);
    const seat = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 1000 };
    await assert.rejects(() => runChain({ request: 'Req.', config: { name: 'x', maxRounds: 1, seats: { criteria: seat, builder: seat, critics: [seat] } }, log: () => {} }));
    assert.ok(budgetState().spent > 0, 'the probably-billed attempt must count toward the cap');
    assert.equal(budgetState().reserved, 0);
    setBudget(null);
  });
});

test('usage: Google-style thinking (only in total_tokens) is counted as thinking and billed as output', () => {
  // Google's OpenAI-compatible endpoint: no reasoning_tokens, thinking only in total_tokens.
  assert.deepEqual(usageOfOpenAICompat({ prompt_tokens: 100, completion_tokens: 77, total_tokens: 4177 }), { input: 100, output: 4077, thinking: 4000 });
  // Providers that report reasoning inside completion_tokens (OpenRouter, OpenAI) are unchanged.
  assert.deepEqual(usageOfOpenAICompat({ prompt_tokens: 100, completion_tokens: 500, total_tokens: 600, completion_tokens_details: { reasoning_tokens: 300 } }), { input: 100, output: 500, thinking: 300 });
  // No thinking at all, or no total reported: unchanged.
  assert.deepEqual(usageOfOpenAICompat({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }), { input: 100, output: 50, thinking: 0 });
  assert.deepEqual(usageOfOpenAICompat({ prompt_tokens: 100, completion_tokens: 50 }), { input: 100, output: 50, thinking: 0 });
  assert.deepEqual(usageOfOpenAICompat(undefined), { input: 0, output: 0, thinking: 0 });
});
