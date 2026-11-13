// B3 prep, CACHE unit 1 (off the cap path): the Anthropic adapter's optional prompt-cache markers, the cache counts it returns, and the
// per-model cache-read multiplier. Offline: globalThis.fetch is stubbed for every call (the same guard test/providers-retry.test.js uses),
// a dummy key is set, and nothing here reaches api.anthropic.com. The marker shape is the one Anthropic's prompt-caching page documents
// (read 2026-11-01): cache_control { type: 'ephemeral' } or { type: 'ephemeral', ttl: '1h' } on a content block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from '../src/providers.js';
import { cacheReadMultiplierOf } from '../src/cache-prices.js';   // CHANGED (0.8.4 seats unit): src/budget.js is removed (Muad 10 Nov 2026 02:09); the table lives in cache-prices.js
import { costOf } from '../src/cost.js';
import { setUserPrices, resetUserPrices } from '../src/price-table.js';

const reply = usage => ({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, ...usage } });

// Stubs fetch; returns the request bodies it saw, as the parsed objects and as the exact bytes sent.
async function withAnthropic(responder, fn) {
  const original = globalThis.fetch; const hadKey = process.env.ANTHROPIC_API_KEY;
  const sent = []; const urls = [];
  globalThis.fetch = async (url, init) => { urls.push(String(url)); sent.push({ raw: init.body, body: JSON.parse(init.body), headers: Object.keys(init.headers).sort() }); return new Response(JSON.stringify(responder(sent.length)), { status: 200, headers: { 'content-type': 'application/json' } }); };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy';
  try { return await fn({ sent, urls }); }
  finally {
    globalThis.fetch = original;
    if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = hadKey;
  }
}
const ask = (opts = {}) => call('anthropic', { model: 'claude-opus-5-5', system: 'You are a judge.', messages: [{ role: 'user', content: '# Original request\nBuild it.\n# Draft under review\nthe draft\n# Objections\n1. x' }], maxTokens: 1000, ...opts });
const HEAD = '# Original request\nBuild it.\n# Draft under review\nthe draft\n';

// Captured ONCE from the base tree b051a41f (callAnthropic as it was before this lane touched it), by driving its real call() with a stubbed
// fetch: url, header names and the exact body bytes of two requests. The new code is compared with those bytes, not with a body it rebuilds itself.
const BASE = JSON.parse(readFileSync(new URL('./fixtures/anthropic-request-bodies-b051a41f.json', import.meta.url), 'utf8'));

test('no cache option: url, header names and body bytes are identical to what b051a41f sent (captured fixture), and no cache_control appears', async () => {
  const user = '# Original request\nBuild it.\n# Draft under review\nthe draft\n# Objections\n1. x';
  await withAnthropic(() => reply({}), async ({ sent, urls }) => {
    await call('anthropic', { model: 'claude-opus-5-5', system: 'You are a judge.', messages: [{ role: 'user', content: user }], maxTokens: 1000 });
    await call('anthropic', { model: 'claude-sonnet-5-5', system: 'S', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c "quoted" \u00e9' }], maxTokens: 64, temperature: 0.2, extra: { output_config: { effort: 'high' } } });
    assert.deepEqual(urls, BASE.map(b => b.url));
    // CHANGED ACCEPTED TEST (0.8.4 long direct Claude calls): OLD: the bytes equal the captured base bytes. NEW: they equal the base bytes with ONE field appended, `"stream":true` (a direct Anthropic call is streamed); nothing else moved. WHY: the call is a stream now (test/anthropic-stream.test.js).
    assert.deepEqual(sent.map(s => s.raw), BASE.map(b => b.body.replace(/\}$/, ',"stream":true}')));
    assert.deepEqual(sent.map(s => s.headers), BASE.map(b => b.headers));
    for (const s of sent) assert.ok(!s.raw.includes('cache_control'));
  });
});

test('cache { head } (1h by default): the user text splits into two blocks at head, the marker is on the first, head + rest is the original text', async () => {
  await withAnthropic(() => reply({}), async ({ sent }) => {
    const user = HEAD + '# Objections\n1. x';
    await ask({ messages: [{ role: 'user', content: user }], cache: { head: HEAD } });
    const [m] = sent[0].body.messages;
    assert.deepEqual(m.content, [{ type: 'text', text: HEAD, cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: '# Objections\n1. x' }]);
    assert.equal(m.content.map(b => b.text).join(''), user, 'no byte of the prompt changes');
    assert.equal(sent[0].body.system, 'You are a judge.');
  });
});

test('cache ttl 5m: the marker carries no ttl field (the default lifetime); a head that is the whole message sends one block (no empty text block)', async () => {
  await withAnthropic(() => reply({}), async ({ sent }) => {
    await ask({ cache: { head: HEAD, ttl: '5m' } });
    assert.deepEqual(sent[0].body.messages[0].content[0].cache_control, { type: 'ephemeral' });
    const whole = 'only a head';
    await ask({ messages: [{ role: 'user', content: whole }], cache: { head: whole } });
    assert.deepEqual(sent[1].body.messages[0].content, [{ type: 'text', text: whole, cache_control: { type: 'ephemeral', ttl: '1h' } }]);
  });
});

test('a cache request that cannot be placed throws BEFORE anything is sent: empty or foreign head, bad ttl, last message not a user string', async () => {
  await withAnthropic(() => reply({}), async ({ sent }) => {
    const user = [{ role: 'user', content: 'abc def' }];
    await assert.rejects(ask({ messages: user, cache: { head: '' } }), /non-empty leading text/);
    await assert.rejects(ask({ messages: user, cache: {} }), /non-empty leading text/);
    await assert.rejects(ask({ messages: user, cache: { head: 'xyz' } }), /starts with "head"/);
    await assert.rejects(ask({ messages: user, cache: { head: 'abc', ttl: '2h' } }), /ttl must be one of 5m, 1h/);
    await assert.rejects(ask({ messages: [{ role: 'user', content: 'abc' }, { role: 'assistant', content: 'abc' }], cache: { head: 'abc' } }), /starts with "head"/);
    assert.equal(sent.length, 0, 'a refused placement never reaches the network');
  });
});

test('usage: the three cache counts are returned when the response carries them; input stays the provider\'s own figure (it excludes cached tokens)', async () => {
  await withAnthropic(() => reply({ input_tokens: 40, cache_read_input_tokens: 1800, cache_creation_input_tokens: 248, cache_creation: { ephemeral_5m_input_tokens: 148, ephemeral_1h_input_tokens: 100 } }), async () => {
    const { usage } = await ask({ cache: { head: HEAD } });
    assert.equal(usage.input, 40, 'input is not summed with the cached counts here; the cost side prices each count');
    assert.equal(usage.cacheRead, 1800);
    assert.equal(usage.cacheWrite, 248);
    assert.equal(usage.cacheWrite1h, 100);
  });
});

test('usage: a count the response does not carry is ABSENT, never 0; a malformed count is treated as not carried', async () => {
  await withAnthropic(() => reply({}), async () => {
    const { usage } = await ask({ cache: { head: HEAD } });
    for (const k of ['cacheRead', 'cacheWrite', 'cacheWrite1h']) assert.ok(!(k in usage), `${k} must be absent when unreported`);
  });
  await withAnthropic(() => reply({ cache_read_input_tokens: 0, cache_creation_input_tokens: '12', cache_creation: { ephemeral_1h_input_tokens: -3 } }), async () => {
    const { usage } = await ask({ cache: { head: HEAD } });
    assert.equal(usage.cacheRead, 0, 'a reported zero is a zero');
    assert.ok(!('cacheWrite' in usage) && !('cacheWrite1h' in usage));
  });
  await withAnthropic(() => reply({ cache_creation_input_tokens: 90 }), async () => {
    const { usage } = await ask({ cache: { head: HEAD } });
    assert.equal(usage.cacheWrite, 90);
    assert.ok(!('cacheWrite1h' in usage), 'no split reported, no 1h part claimed');
  });
});

test('a call WITHOUT cache gets the usage object it always had, even when the response carries cache counts (zeros included): no new keys reach the usage file', async () => {
  await withAnthropic(() => reply({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }), async () => {
    const { usage } = await ask();
    assert.deepEqual(Object.keys(usage).sort(), ['input', 'output', 'stop', 'thinking']);
  });
});

test('cacheReadMultiplierOf: 0.05x for direct Opus 5.5 and Sonnet 5.5, 0.025x for direct Fable 5.2, the old 0.1x for everything else (Haiku 5.5, Fable 5.1, other hosts, other labs)', () => {
  // CHANGED ACCEPTED TEST (0.8.4 seats unit): the Fable 5.2 line is new (Anthropic's pricing page, read 2026-11-09: a cache hit on Claude Fable 5.2 costs 2.5 percent of the input price, $0.20 per million tokens); Fable 5.1 keeps the 0.1x it had (its 0.025x is not applied, see src/cache-prices.js).
  assert.equal(cacheReadMultiplierOf('anthropic/claude-opus-5-5'), 0.05);
  assert.equal(cacheReadMultiplierOf('anthropic/claude-sonnet-5-5'), 0.05);
  assert.equal(cacheReadMultiplierOf('anthropic/claude-fable-5-2'), 0.025);
  for (const k of ['anthropic/claude-haiku-5-5', 'anthropic/claude-fable-5-1', 'openrouter/anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5', 'openai/gpt-6.1-sol', 'google/gemini-3.8-flash']) assert.equal(cacheReadMultiplierOf(k), 0.1, k);
});

// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 02:09: src/budget.js and src/buys.js are removed). OLD: priceRoster({ perModel: 1e6, roster: [key], inputShare: 1, cacheHitRate: 1 }) priced a million fully cached input tokens. NEW: costOf, the module every run is priced with, prices the same million cached-read tokens (a marked call that read 1,000,000 tokens and sent none). WHY: the module that carried the check is gone; the claim (read multiplier per model, only the Anthropic 5.5 and Fable 5.2 rows moved) is the same, on the real code.
test('costOf: a cached read is priced at the per-model read multiplier, and only the Anthropic 5.5 rows moved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-adapter-'));
  try {
    // CHANGED ACCEPTED (0.8.4, after the plan-the-high-council chain shipped a Haiku price row). OLD: the third user row was `anthropic/claude-haiku-5-5` at in 0.1 / out 0.5, and the third assertion expected $0.01 per million cached input for it. NEW: the third user row is `anthropic/claude-user-row-only-test`, a model id no shipped table prices (the figures and the $0.01 are unchanged). WHY: the shipped table now prices `anthropic/claude-haiku-5-5` at in 0.5 / out 2.5 (the over-100,000-token tier, so the cap never projects less than a long prompt bills); a user row only adds or raises a price (`effectiveRowByKey` takes the larger of the shipped and the user figure), so the $0.10 user row no longer lowered it and the result was $0.05. A user-only id stops this test from tracking shipped rows. Haiku 5.5's own 0.1x read multiplier is still pinned by the `cacheReadMultiplierOf` test above. The Opus and Sonnet rows stay at their shipped figures, because their 0.05x is keyed on those exact ids.
    writeFileSync(join(dir, 'pricing.user.json'), JSON.stringify({ 'anthropic/claude-opus-5-5': { in: 4, out: 20 }, 'anthropic/claude-sonnet-5-5': { in: 2, out: 10 }, 'anthropic/claude-user-row-only-test': { in: 0.1, out: 0.5 } }));
    setUserPrices(dir);
    const price = key => { const [provider, ...rest] = key.split('/'); return costOf(provider, rest.join('/'), { input: 0, output: 0, cacheAsked: '5m', cacheRead: 1e6, cacheWrite: 0 }).usd; };
    assert.ok(Math.abs(price('anthropic/claude-opus-5-5') - 0.2) < 1e-9, 'Opus 5.5: $0.20 per million cached input');
    assert.ok(Math.abs(price('anthropic/claude-sonnet-5-5') - 0.1) < 1e-9, 'Sonnet 5.5: $0.10 per million');
    assert.ok(Math.abs(price('anthropic/claude-user-row-only-test') - 0.01) < 1e-9, 'a model the multiplier table does not name reads at 0.1x: $0.01 per million on a $0.10 user row');
    const uncached = costOf('anthropic', 'claude-opus-5-5', { input: 1e6, output: 0 }).usd;
    assert.ok(Math.abs(uncached - 4) < 1e-9, 'an uncached million is unchanged');
  } finally { resetUserPrices(); rmSync(dir, { recursive: true, force: true }); }
});
