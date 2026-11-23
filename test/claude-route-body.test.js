// 0.8.4 the Claude route, WIRING (Builder B; the PASS of 579e6fb3 named this as a blocker): effort high and the price pin asserted on the REQUEST BODY the real route sends, for every shipped Claude model and for the default security reviewer, and the URL each request goes to.
// How: the chain is resolved by the real resolveRun (route applied, then resolveChainSeats), then run by the real runChain; globalThis.fetch is replaced (dummy keys, $0) and every captured request is read: its URL host, its model id, reasoning.effort, the absence of the direct
// route's own effort fields (output_config, thinking), provider.max_price against the routed price row, and the host ban in provider.ignore. The roster carries a Claude seat in the slots a stub can answer without a stage's own reply format: the panel (four models), the
// preflight roster (Haiku 5.5) and the default security reviewer (Fable 5.1, named by no chain file). The other slots (criteria, builder, reviser, ...) are routed by the same code path and are pinned slot by slot in test/resolve-run.test.js RR-3.
// CAN IT FAIL? The same check runs on the bodies of a DIRECT run of the same chain (route anthropic: every request goes to api.anthropic.com in the Anthropic shape): it must throw at its own assertion. That known-bad INPUT is this file's red evidence; the check on the routed run is the
// pin. A host check is in it because a seat that silently went direct (the preflight gap found in this unit: resolveChainSeats did not visit preflight.seats) shows only there.
// NO RED OF ITS OWN beyond that known-bad input: on the tree before this unit the routed run does not exist (resolveRun is missing), so RB-1 fails at its first assertion.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Chain from '../src/chain.js';
import * as Providers from '../src/providers.js';
import { OPEN_INFERENCE } from '../src/host-block.js';

const RR = await import('../src/resolve-run.js').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRICES = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
afterEach(() => { Chain.setBudget(null); Chain.setCache(null); Chain.setPromptSpy(null); });

const claude = (model, lab) => ({ provider: 'anthropic', model, lab, maxTokens: 4000 });
const chainOf = () => ({
  name: 'route-body', maxRounds: 2, signoff: 'unanimous', security_review: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  preflight: { seats: [claude('claude-haiku-5-5', 'pre')] },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [claude('claude-haiku-5-5', 'haiku'), claude('claude-sonnet-5-5', 'sonnet'), claude('claude-opus-5-5', 'opus'), claude('claude-fable-5-2', 'fable')],
  },
});
const OR_IDS = ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-fable-5.2', 'anthropic/claude-fable-5.1'];

/** A run of the chain with the given route; returns every request the run made: { url, body }. */
async function runWith(route) {
  const originalFetch = globalThis.fetch; const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENROUTER_API_KEY };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy'; process.env.OPENROUTER_API_KEY = 'sk-or-test-dummy';
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); sent.push({ url: String(url), body });
    const viaOr = new URL(String(url)).host === 'openrouter.ai';
    const system = viaOr ? (body.messages.find(m => m.role === 'system')?.content ?? '') : body.system;
    const u = body.messages.find(m => m.role === 'user')?.content;
    const user = typeof u === 'string' ? u : (u ?? []).map(b => b.text).join('');
    const text = /claude-fable-5[.-]1$/.test(String(body.model)) ? '{"verdict":"pass","findings":[]}'
      : system === Chain.PREFLIGHT_SYSTEM ? '{"verdict":"pass","objections":[]}'
      : (await Providers.call('mock', { model: 'mock-critic-a', system, messages: [{ role: 'user', content: user }], maxTokens: body.max_tokens ?? 1000 })).text;
    const out = viaOr ? { model: body.model, choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }
      : { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } };
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  Chain.setCache(null); Chain.setBudget(null);
  let error = null;
  try {
    const routing = RR.resolveRun(chainOf(), { flag: route, env: { ANTHROPIC_API_KEY: 'sk-ant-test-dummy', OPENROUTER_API_KEY: 'sk-or-test-dummy' } });
    assert.equal(routing.stop, undefined, JSON.stringify(routing));
    await Chain.runChain({ request: 'A bake sale.', log: () => {}, runId: 'r-route-body', config: routing.config });
  } catch (e) { error = e; } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.a], ['OPENROUTER_API_KEY', saved.o]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return { sent, error };
}

// the check: takes the captured requests
const checkRoutedBodies = sent => {
  assert.ok(sent.length >= 6, `the run made its calls (${sent.length})`);
  for (const { url, body } of sent) {
    const where = `${body.model} (${new URL(url).host})`;
    assert.equal(new URL(url).host, 'openrouter.ai', `${where}: the request goes to OpenRouter`);
    assert.ok(OR_IDS.includes(body.model), `${where}: a routed Claude id`);
    assert.equal(body.reasoning?.effort, 'high', `${where}: effort is high in OpenRouter's field`);
    assert.equal(body.output_config, undefined, `${where}: no direct-route effort field`); assert.equal(body.thinking, undefined, `${where}: no thinking block`);
    const row = PRICES[`openrouter/${body.model}`]; assert.ok(row, `${where}: a routed price row`);
    assert.deepEqual(body.provider?.max_price, { prompt: row.in, completion: row.out }, `${where}: the price pin is the routed row's own figures`);
    assert.ok(Array.isArray(body.provider?.ignore) && body.provider.ignore.includes(OPEN_INFERENCE), `${where}: the host ban is in provider.ignore`);
  }
  assert.deepEqual([...new Set(sent.map(s => s.body.model))].sort(), [...OR_IDS].sort(), 'every shipped Claude model and the default reviewer was sent a request');
};

test('RB-1: through the real route every request goes to OpenRouter with effort high, no direct-route effort field, the routed row\'s price pin and the host ban: the panel, the preflight seat and the default security reviewer', async () => {
  assert.equal(typeof RR.resolveRun, 'function', 'src/resolve-run.js exports resolveRun');
  const { sent, error } = await runWith('openrouter');
  assert.equal(error, null, `the routed run ended without an error: ${error?.stack ?? error}`);
  checkRoutedBodies(sent);
});
test('RB-2: the check can fail: on the bodies of a DIRECT run of the same chain (route anthropic) it throws at its own assertion', async () => {
  assert.equal(typeof RR.resolveRun, 'function');
  const { sent, error } = await runWith('anthropic');
  assert.equal(error, null, `the direct run ended without an error: ${error?.stack ?? error}`);
  assert.ok(sent.every(s => new URL(s.url).host === 'api.anthropic.com'), 'premise: a direct run goes to Anthropic');
  assert.throws(() => checkRoutedBodies(sent), { name: 'AssertionError' });
});
