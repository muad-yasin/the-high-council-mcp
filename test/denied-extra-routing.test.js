// Pre-release audit 2026-09-23 (GuardLayer #2 HIGH, #5): "No grok, ever" had a bypass. The
// adapters spread a seat's `extra` AFTER `model`, so extra.model replaced the model the
// denied-model check had approved, and the check never looked at extra.model/route/provider.
// Router ids with a suffix (openrouter/auto:nitro) or a server-side preset (@preset/x) also passed.
// Offline: the provider call goes to a 127.0.0.1 stub with a dummy key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { call } from '../src/providers.js';
import { deniedReasonsOf, ROUTER_MODEL } from '../src/denied-models.js';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const denied = ['x-', 'ai/gr', 'ok-4'].join(''); // assembled, so no source file names it outright

test('an OpenAI-compatible call sends the seat\'s own model, whatever extra.model says', async () => {
  let body = null;
  const server = createServer((req, res) => {
    let s = ''; req.on('data', c => { s += c; }); req.on('end', () => {
      body = JSON.parse(s);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const saved = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'dummy-test-key';
  try {
    await call('openrouter', {
      model: 'openai/gpt-5', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 10,
      extra: { model: denied, max_completion_tokens: 999999, messages: [], reasoning: { effort: 'low' } },
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    });
  } finally {
    server.close();
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved;
  }
  assert.equal(body.model, 'openai/gpt-5');
  assert.equal(body.max_completion_tokens, 10);
  assert.equal(body.messages.length, 2, 'extra cannot replace the messages either');
  assert.deepEqual(body.reasoning, { effort: 'low' }, 'extra\'s own non-standard fields still pass through');
});

test('the Anthropic adapter also spreads extra before the fields it must not override', () => {
  const src = readFileSync(join(root, 'src', 'providers.js'), 'utf8');
  const body = src.slice(src.indexOf('async function callAnthropic'), src.indexOf('async function callOpenAICompat'));
  assert.ok(body.indexOf('...(extra || {})') < body.indexOf('      model,'), 'extra must come first');
});

for (const extra of [{ model: denied }, { route: denied }, { provider: { order: ['x-ai'] } }, { models: denied }, { model: 'openrouter/auto' }, { plugins: [{ id: 'web', fallback: denied }] }]) {
  test(`a seat whose extra routes to a denied model or a router is refused: ${JSON.stringify(extra)}`, () => {
    const seat = { provider: 'openrouter', model: 'openai/gpt-5', extra };
    assert.ok(deniedReasonsOf(seat).length >= 1);
    const lint = lintChain({ name: 't', maxRounds: 1, seats: { builder: seat, critics: [{ provider: 'mock', model: 'mock-critic' }] } });
    assert.ok(lint.some(f => f.kind === 'denied-model'), 'lint refuses it too');
  });
}

test('router variants: suffixes and server-side presets are routers too', () => {
  for (const id of ['openrouter/auto', 'openrouter/auto:nitro', 'openrouter/auto:online', 'openrouter/auto/', 'auto:floor', '@preset/my-mix']) {
    assert.ok(ROUTER_MODEL.test(id), id);
  }
  for (const id of ['openai/gpt-5', 'openrouter', 'mistralai/mistral-medium-3.5', 'autocomplete-model']) {
    assert.equal(ROUTER_MODEL.test(id), false, id);
  }
});

test('a plain extra (reasoning, thinking, chat_template_kwargs) is not refused', () => {
  for (const extra of [{ reasoning: { effort: 'low' } }, { thinking: { type: 'disabled' } }, { chat_template_kwargs: { thinking: false } }]) {
    assert.deepEqual(deniedReasonsOf({ provider: 'openrouter', model: 'openai/gpt-5', extra }), []);
  }
});
