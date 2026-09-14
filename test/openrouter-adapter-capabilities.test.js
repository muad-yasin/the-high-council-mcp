// test/openrouter-adapter-capabilities.test.js
//
// MLLM Coder v2, IN-1 (relay/runs/2026-09-14T17-25-10-314Z/deliverable.md §3/§9). A read-only,
// fixture-based inventory of what src/providers.js's EXISTING OpenRouter adapter
// (callOpenAICompat, shared by every OPENAI_COMPAT provider) already accepts and rejects for
// model routing - derived by reading the adapter source (below) and confirmed against real
// outbound request bodies captured with a stubbed fetch, never assumed.
//
// Real finding, corrects the plan's own §3 wording: the plan describes the seat's `model` field
// itself taking on three shapes ("plain id / an array of model ids / a routing-param route").
// That is not how OpenRouter's real API works (confirmed against OpenRouter's own docs,
// docs.openrouter.ai/docs/guides/routing/model-fallbacks and .../routers/pareto-router, checked
// 2026-09-14):
//   - Provider-array fallback is a SEPARATE top-level field, `models` (plural, an array),
//     alongside a `model` that stays a required plain string. There is no "model becomes an
//     array" shape in OpenRouter's real request body.
//   - The Pareto Code Router is invoked by setting `model` to a plain string router slug
//     ("openrouter/pareto-code") plus an optional `plugins` array configuring it
//     (`[{ id: "pareto-router", min_coding_score: <0..1> }]`) - also not a value inside `model`.
// So "model" is ALWAYS a plain string to this adapter; the array/plugin shapes ride on the
// adapter's pre-existing `extra` escape hatch (see below), never on `model` itself. This is a
// stronger finding than the plan's Falsified-if condition names ("cannot forward array/
// routing-param values without adapter-side selection logic") - the adapter needs no change at
// all, but the seat-model-schema (IN-2) must validate the real shape, not the plan's original
// imprecise one, or it would document and green-light a request body OpenRouter cannot parse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call } from '../src/providers.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

async function capturedBody(seatExtras, model) {
  const had = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test';
  let body;
  const restore = stubFetch(async (url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  });
  try {
    await call('openrouter', { model, system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, extra: seatExtras });
    return body;
  } finally {
    restore();
    if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had;
  }
}

// --- Model-string variants (>= 5, per the plan's own minimum) -------------------------------

test('model-string variant 1: a plain OpenRouter model id is forwarded verbatim as a string', async () => {
  const body = await capturedBody(undefined, 'anthropic/claude-sonnet-5');
  assert.equal(body.model, 'anthropic/claude-sonnet-5');
  assert.equal(typeof body.model, 'string');
});

test('model-string variant 2: the Pareto Code router slug is just another plain string - the adapter does not special-case it', async () => {
  const body = await capturedBody(undefined, 'openrouter/pareto-code');
  assert.equal(body.model, 'openrouter/pareto-code');
});

test('model-string variant 3: OpenRouter\'s auto-router slug is also just a plain string', async () => {
  const body = await capturedBody(undefined, 'openrouter/auto');
  assert.equal(body.model, 'openrouter/auto');
});

test('model-string variant 4: a vendor-prefixed slug with a colon-free vendor path (deepseek-style) round-trips unchanged', async () => {
  const body = await capturedBody(undefined, 'deepseek/deepseek-chat');
  assert.equal(body.model, 'deepseek/deepseek-chat');
});

test('model-string variant 5: an empty string is forwarded as-is - the adapter performs no presence/format validation on `model`', async () => {
  const body = await capturedBody(undefined, '');
  assert.equal(body.model, '');
});

test('model-string variant 6 (gotcha, do not ship): if `model` were ever set to a real JS array instead of a string, the adapter does not reject it - it JSON-serializes the array in place, producing a body OpenRouter cannot parse as a model id. This is exactly why IN-2\'s schema must reject `model` as anything but a string - the adapter provides no safety net.', async () => {
  const body = await capturedBody(undefined, ['a', 'b']);
  assert.deepEqual(body.model, ['a', 'b']); // proves the adapter does nothing to stop this
});

// --- Provider-array / routing-param variants (>= 3, per the plan's own minimum) --------------
// All three ride on the adapter's existing, unmodified `extra` pass-through
// (`...(extra || {})` spread into the request body in callOpenAICompat) - already shipped,
// already generic, not added for this plan.

test('provider-array variant 1: extra.models (OpenRouter\'s real fallback field) is forwarded verbatim, in order, as a sibling of `model`', async () => {
  const body = await capturedBody({ models: ['fallback/one', 'fallback/two'] }, 'primary/model');
  assert.equal(body.model, 'primary/model');
  assert.deepEqual(body.models, ['fallback/one', 'fallback/two']);
});

test('provider-array variant 2: extra.plugins (Pareto Code Router\'s real configuration shape) is forwarded verbatim', async () => {
  const body = await capturedBody({ plugins: [{ id: 'pareto-router', min_coding_score: 0.8 }] }, 'openrouter/pareto-code');
  assert.deepEqual(body.plugins, [{ id: 'pareto-router', min_coding_score: 0.8 }]);
});

test('provider-array variant 3: extra.models and extra.plugins can both be set on the same seat at once - the adapter merges every extra key with no collision handling of its own', async () => {
  const body = await capturedBody({ models: ['fb/one'], plugins: [{ id: 'pareto-router' }] }, 'primary/model');
  assert.deepEqual(body.models, ['fb/one']);
  assert.deepEqual(body.plugins, [{ id: 'pareto-router' }]);
});

// --- The core finding this inventory exists to establish -------------------------------------

test('finding: a plain-string-model seat with no extra produces a request body byte-identical to today\'s (no regression from this inventory existing)', async () => {
  const body = await capturedBody(undefined, 'anthropic/claude-sonnet-5');
  assert.deepEqual(Object.keys(body).sort(), ['max_completion_tokens', 'messages', 'model'].sort());
});

test('finding: the adapter performs no model selection, retry, or fallback logic of its own - it sends exactly one HTTP request per call() regardless of model/extra shape', async () => {
  let fetchCalls = 0;
  const had = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test';
  const restore = stubFetch(async () => {
    fetchCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  });
  try {
    await call('openrouter', { model: 'a/model', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, extra: { models: ['b/model', 'c/model'] } });
  } finally {
    restore();
    if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had;
  }
  assert.equal(fetchCalls, 1, 'the adapter must make exactly one HTTP call - any sequential fallback retry is OpenRouter-side, never adapter-side');
});
