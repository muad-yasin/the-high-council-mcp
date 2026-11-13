// test/persona-system-delivery.test.js
//
// 0.8.4, lane C unit 5, plan C items P1-P3 (the delivery of a seat's SYSTEM text to the provider).
// A seat's persona (title or voice) rides in the system text of its call. This file pins, for every
// provider the harness can call over the network, that the system text the harness built is the
// system text the request carries, and that a seat's `extra` cannot replace it.
//
// THESE ARE PINS, NOT REDS. They pass on the source as it is: src/providers.js spreads `extra` FIRST
// in callAnthropic and callOpenAICompat, so the fields set after it always win. Limits of the pin: it
// reads the request body a stubbed fetch received, so it shows what is SENT, never that a model obeys
// the text; other keys of `extra` pass through to the body by design (it is the escape hatch for a
// provider's own fields), only the system text and the messages are pinned. The dispatch row shows that
// every provider providerNames() lists reaches a request body; both it and call() read one table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { call, providerNames } from '../src/providers.js';

const SYSTEM = 'SYSTEM-TEXT-FROM-THE-HARNESS: You are arguing as Noah.';
const EVIL = 'SYSTEM-TEXT-FROM-A-SEAT-EXTRA';

// The key variable of each provider, read from the source's own table, so a new provider's variable is
// set here without an edit of this file.
const SOURCE = readFileSync(new URL('../src/providers.js', import.meta.url), 'utf8');
const KEY_VARS = ['ANTHROPIC_API_KEY', ...[...SOURCE.matchAll(/key: '([A-Z0-9_]+)'/g)].map(m => m[1])];

function withKeysAndFetch(handler) {
  const had = Object.fromEntries(KEY_VARS.map(k => [k, process.env[k]]));
  for (const k of KEY_VARS) process.env[k] = 'sk-test';
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
    for (const k of KEY_VARS) { if (had[k] === undefined) delete process.env[k]; else process.env[k] = had[k]; }
  };
}

const OK_COMPAT = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
const OK_ANTHROPIC = { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };

async function sentBody(provider, extra) {
  let body;
  const restore = withKeysAndFetch(async (url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => (provider === 'anthropic' ? OK_ANTHROPIC : OK_COMPAT) };
  });
  try {
    await call(provider, { model: 'm-test', system: SYSTEM, messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, extra });
    return body;
  } finally { restore(); }
}

const systemOf = (provider, body) => (provider === 'anthropic' ? body.system : body.messages.find(m => m.role === 'system')?.content);

test('P1-P3 dispatch: every provider providerNames() lists reaches a request body', async () => {
  const names = providerNames();
  assert.ok(names.includes('anthropic') && names.includes('openrouter'), `providerNames() lost a provider: ${names.join(',')}`);
  for (const provider of names) {
    const body = await sentBody(provider);
    assert.ok(body && typeof body === 'object', `${provider}: no request body reached the stubbed fetch`);
  }
});

test('P1-P3 delivery: the request of every provider carries the harness system text', async () => {
  for (const provider of providerNames()) {
    const body = await sentBody(provider);
    assert.equal(systemOf(provider, body), SYSTEM, `${provider}: the system text sent is not the one built`);
  }
});

test('P1-P3 extra cannot replace the system text: a seat extra naming system (and messages) loses, for every provider', async () => {
  for (const provider of providerNames()) {
    const body = await sentBody(provider, { system: EVIL, messages: [{ role: 'system', content: EVIL }] });
    assert.equal(systemOf(provider, body), SYSTEM, `${provider}: extra.system replaced the system text`);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    assert.ok(!messages.some(m => JSON.stringify(m).includes(EVIL)), `${provider}: text from extra reached the messages of the request`);
  }
});

test('P1-P3 the external provider is never called: its seats are answered by a file', async () => {
  await assert.rejects(() => call('external', { model: 'claude-code-session', system: SYSTEM, messages: [], maxTokens: 1 }), /external seats are answered by writing/);
});
