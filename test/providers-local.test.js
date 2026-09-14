// v7.1: a locally-run model (Ollama, LM Studio, ...) as a seat. Ollama's own OpenAI-compatibility
// docs (docs.ollama.com/openai, checked 2026-09-14) were read before writing this: the default
// base URL is http://localhost:11434/v1, an API key is "required, but unused" (any value, or
// none, works), and a non-streaming /v1/chat/completions reply looks exactly like the fixture
// below - choices[0].message.content, choices[0].finish_reason, usage.prompt_tokens/
// completion_tokens. That is the same shape callOpenAICompat already parses for every other
// OPENAI_COMPAT provider, which is what makes ollama a ~15-line addition rather than a new
// adapter - but it is not "zero new code": a baseUrl override and an optional (rather than
// required) key both needed real support, which is what these tests cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, keyFor, isFreeProvider, isKeyOptional, providerNames } from '../src/providers.js';
import { priceOf, costOf, worstCaseOf } from '../src/cost.js';

// A verbatim example from Ollama's OpenAI-compatibility docs.
const OLLAMA_FIXTURE_RESPONSE = {
  model: 'llama3.1',
  created: 1234567890,
  choices: [
    { index: 0, message: { role: 'assistant', content: 'This is a test' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('ollama is a known provider, with no API key required', () => {
  assert.ok(providerNames().includes('ollama'));
  assert.equal(isKeyOptional('ollama'), true);
  assert.equal(isKeyOptional('openai'), false);
});

test('keyFor("ollama") is truthy with no OLLAMA_API_KEY set, so checkSeats/cli never flag it as a missing key', () => {
  const had = process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  try {
    assert.ok(keyFor('ollama'));
  } finally {
    if (had !== undefined) process.env.OLLAMA_API_KEY = had;
  }
});

test('call("ollama", ...) hits the default base URL with no Authorization header when no key is set, and parses a real Ollama-shaped reply', async () => {
  const had = process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  let seenUrl, seenHeaders;
  const restore = stubFetch(async (url, opts) => {
    seenUrl = url;
    seenHeaders = opts.headers;
    return { ok: true, json: async () => OLLAMA_FIXTURE_RESPONSE };
  });
  try {
    const res = await call('ollama', {
      model: 'llama3.1',
      system: 'You are a test.',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });
    assert.equal(seenUrl, 'http://localhost:11434/v1/chat/completions');
    assert.equal('authorization' in seenHeaders, false, 'no Authorization header should be sent when no real key is set');
    assert.equal(res.text, 'This is a test');
    assert.equal(res.usage.input, 10);
    assert.equal(res.usage.output, 5);
    assert.equal(res.usage.stop, 'stop');
    assert.equal(res.provider, 'ollama');
  } finally {
    restore();
    if (had !== undefined) process.env.OLLAMA_API_KEY = had;
  }
});

test('call("ollama", { baseUrl }) overrides the default base URL, e.g. for LM Studio on a different port', async () => {
  let seenUrl;
  const restore = stubFetch(async (url) => {
    seenUrl = url;
    return { ok: true, json: async () => OLLAMA_FIXTURE_RESPONSE };
  });
  try {
    await call('ollama', {
      model: 'mistral',
      system: 'You are a test.',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      baseUrl: 'http://localhost:1234/v1',
    });
    assert.equal(seenUrl, 'http://localhost:1234/v1/chat/completions');
  } finally {
    restore();
  }
});

test('a real OLLAMA_API_KEY, if set, is still sent as a normal Bearer token', async () => {
  const had = process.env.OLLAMA_API_KEY;
  process.env.OLLAMA_API_KEY = 'sk-whatever';
  let seenHeaders;
  const restore = stubFetch(async (url, opts) => {
    seenHeaders = opts.headers;
    return { ok: true, json: async () => OLLAMA_FIXTURE_RESPONSE };
  });
  try {
    await call('ollama', { model: 'llama3.1', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    assert.equal(seenHeaders.authorization, 'Bearer sk-whatever');
  } finally {
    restore();
    if (had === undefined) delete process.env.OLLAMA_API_KEY; else process.env.OLLAMA_API_KEY = had;
  }
});

test('a local (ollama) seat prices at exactly $0 for any model name, and counts as priced - not "unpriced"', () => {
  assert.equal(isFreeProvider('ollama'), true);
  assert.equal(isFreeProvider('anthropic'), false);
  assert.deepEqual(priceOf('ollama', 'some-model-nobody-pinned-in-pricing-json'), { in: 0, out: 0 });
  const cost = costOf('ollama', 'llama3.1', { input: 100000, output: 50000 });
  assert.equal(cost.usd, 0);
  assert.equal(cost.priced, true);
  const worst = worstCaseOf('ollama', 'llama3.1', { promptChars: 4000, maxTokens: 8000, retries: 1 });
  assert.equal(worst.usd, 0);
  assert.equal(worst.priced, true);
});
