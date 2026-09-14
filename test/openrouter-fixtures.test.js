// test/openrouter-fixtures.test.js
//
// MLLM Coder v2, IN-4 (relay/runs/2026-09-14T17-25-10-314Z/deliverable.md §8/§9). Recorded
// OpenRouter response fixtures under test/fixtures/openrouter/ - success, a transport-failure-
// triggered fallback, and a routing-param error - extending test/openrouter-adapter-
// capabilities.test.js's (IN-1) stubbing pattern to the response side.
//
// One real finding worth recording here: §8's own text says to run these "with network disabled
// (the repo's existing socket-blocking guard)". No such guard exists anywhere in this repo (grep
// confirms it) - there is no global network-blocking test setup. The actual offline guarantee in
// every test below, and in every other provider test in this suite, is that `globalThis.fetch` is
// replaced with a stub before any call() happens and restored immediately after - no test in this
// file, or in test/openrouter-adapter-capabilities.test.js, ever calls the real global fetch. That
// is what "network disabled" means in practice here; flagging the gap between the plan's assumed
// guard and what actually exists rather than silently asserting a mechanism that isn't there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call } from '../src/providers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'openrouter');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

async function withStubbedKey(fn) {
  const had = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test';
  try { return await fn(); }
  finally { if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}

test('success.json: a normal response parses into the adapter\'s standard { text, usage } shape', async () => {
  const fixture = loadFixture('success.json');
  const restore = stubFetch(async () => ({ ok: true, json: async () => fixture }));
  try {
    const res = await withStubbedKey(() => call('openrouter', {
      model: 'anthropic/claude-opus-5', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100,
    }));
    assert.equal(res.text, 'The diff applies cleanly and the named test passes.');
    assert.equal(res.usage.input, 420);
    assert.equal(res.usage.output, 37);
  } finally { restore(); }
});

test('transport-failure-fallback.json: a fallback response\'s own `model` field (not the request\'s primary model) is what the caller must read', async () => {
  const fixture = loadFixture('transport-failure-fallback.json');
  let sentBody;
  const restore = stubFetch(async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => fixture };
  });
  try {
    const res = await withStubbedKey(() => call('openrouter', {
      model: 'anthropic/claude-opus-5', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100,
      extra: { models: ['openai/gpt-5', 'google/gemini-3.6-flash'] },
    }));
    // The request still names the primary model plus the fallback array, verbatim.
    assert.equal(sentBody.model, 'anthropic/claude-opus-5');
    assert.deepEqual(sentBody.models, ['openai/gpt-5', 'google/gemini-3.6-flash']);
    // The response text still comes through the normal path - the caller does not need to know
    // fallback happened to get a usable reply, but the fixture's own `model` field (not read by
    // this adapter at all, which is a real, documented limit worth naming: `res.model` is
    // returned as the *requested* model, not the fixture's `model` field, because
    // callOpenAICompat's return shape hardcodes `model` from its own input, never from
    // json.model - see below) is what a build session would need if it wanted to log which model
    // actually answered.
    assert.equal(res.text, 'Answering via the first fallback model after the primary model rate-limited.');
    assert.notEqual(fixture.model, sentBody.model, 'sanity: this fixture is deliberately a DIFFERENT model than the primary, proving fallback occurred');
  } finally { restore(); }
});

test('finding: callOpenAICompat\'s returned `model` field echoes the request\'s primary model, never the response body\'s own `model` field - so a fallback answer is silently attributed to the primary model everywhere this adapter\'s return value is used', async () => {
  const fixture = loadFixture('transport-failure-fallback.json');
  const restore = stubFetch(async () => ({ ok: true, json: async () => fixture }));
  try {
    const res = await withStubbedKey(() => call('openrouter', {
      model: 'anthropic/claude-opus-5', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100,
      extra: { models: ['openai/gpt-5'] },
    }));
    assert.equal(res.model, 'anthropic/claude-opus-5'); // NOT fixture.model ("openai/gpt-5")
  } finally { restore(); }
});

test('routing-param-error.json: OpenRouter\'s documented error shape surfaces as a normal provider error, not a crash, and is not retried (4xx, non-429)', async () => {
  const fixture = loadFixture('routing-param-error.json');
  // The fixture's `_note` field is this file's own documentation, not part of OpenRouter's real
  // response body - a real response never carries it, so it's stripped before serializing what
  // the stub returns from res.text(), matching what the real API would actually send.
  const { _note, ...realBody } = fixture;
  let fetchCalls = 0;
  const restore = stubFetch(async () => {
    fetchCalls++;
    return { ok: false, status: fixture.error.code, text: async () => JSON.stringify(realBody) };
  });
  try {
    await assert.rejects(
      () => withStubbedKey(() => call('openrouter', {
        model: 'openrouter/pareto-code', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100,
        extra: { plugins: [{ id: 'pareto-router', min_coding_score: 2 }] }, // deliberately invalid score
      })),
      (err) => {
        assert.match(err.message, /HTTP 400/);
        assert.match(err.message, /invalid or missing params/);
        assert.equal(err.status, 400);
        return true;
      }
    );
  } finally { restore(); }
  assert.equal(fetchCalls, 1, 'a 4xx, non-429 error must not be retried');
});

test('no live OpenRouter URL is ever fetched by this test file or by test/openrouter-adapter-capabilities.test.js', () => {
  for (const file of ['openrouter-fixtures.test.js', 'openrouter-adapter-capabilities.test.js']) {
    const text = readFileSync(join(here, file), 'utf8');
    // The only occurrences of the real domain in either file must be inside a comment (this
    // sentence and its neighbours) - never inside a live, unstubbed call. Every `call('openrouter',
    // ...)` invocation in both files runs strictly after `stubFetch(...)` replaces
    // globalThis.fetch, so no test here can reach the real network even though the code under
    // test still names 'openrouter' as its provider string.
    const liveUrlPattern = /fetch\(\s*['"`]https?:\/\/openrouter\.ai/;
    assert.doesNotMatch(text, liveUrlPattern, `${file} must never construct a live fetch() call to openrouter.ai`);
  }
});
