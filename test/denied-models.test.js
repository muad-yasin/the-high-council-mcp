// Owner decision 2026-09-23: "No grok, ever!!!". A hard error in chain-lint (no opt-out) and at run
// time, so neither a user-written chain nor a direct runChain() caller can seat xAI/Grok or a router
// that could route to it. Kimi/Moonshot was denied the same way until 2026-09-26, when the owner
// said it was only meant to leave the shipped chains (test/shipped-chains-no-kimi.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { runChain, runDescendingChain, rethrowControlFlow, setCache, setBudget, DeniedModel } from '../src/chain.js';
import { deniedSeatsOf, deniedReasonsOf } from '../src/denied-models.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chains = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'));
const denied = cfg => lintChain(cfg, 'fixture.json').filter(f => f.kind === 'denied-model');
const withCritic = seat => ({ name: 'x', seats: { builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }, seat] } });

test('every shipped chain is free of denied models and router seats', () => {
  assert.ok(chains.length > 10);
  for (const f of chains) {
    const cfg = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    assert.deepEqual(denied(cfg).map(x => x.message), [], f);
  }
});

test('lint: xAI/Grok is an error in every spelling and slot; Kimi/Moonshot is allowed in a user chain', () => {
  for (const seat of [
    { provider: 'xai', model: 'grok-4' },
    { provider: 'openrouter', model: 'x-ai/grok-4.1' },
    { provider: 'openrouter', model: 'openai/gpt-5', extra: { models: ['x-ai/grok-4'] } },
  ]) {
    assert.equal(denied(withCritic(seat)).length, 1, JSON.stringify(seat));
  }
  for (const seat of [
    { provider: 'openrouter', model: 'moonshotai/kimi-k3' },
    { provider: 'together', model: 'Moonshot/Kimi-K2-Instruct' },
  ]) {
    assert.equal(denied(withCritic(seat)).length, 0, JSON.stringify(seat));
  }
  // Outside the critics list too - the check walks the whole config.
  assert.equal(denied({ seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }] }, preflight: { seats: [{ provider: 'xai', model: 'grok-4' }] } }).length, 1);
  assert.equal(denied({ seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }], builder: { provider: 'openrouter', model: 'moonshotai/kimi-k3' } } }).length, 0);
});

test('lint: router ids are errors, not warnings (they can route to a denied model)', () => {
  for (const seat of [
    { provider: 'openrouter', model: 'openrouter/auto' },
    { provider: 'openrouter', model: 'openrouter/pareto-code' },
    { provider: 'openrouter', model: 'openai/gpt-5', extra: { plugins: [{ id: 'pareto-router' }] } },
    { provider: 'openrouter', model: 'some/auto-router' },
    // 2026-10-01: live ids in OpenRouter's own namespace that the name list missed (brief 31).
    { provider: 'openrouter', model: 'openrouter/auto-beta' },
    { provider: 'openrouter', model: 'openrouter/fusion' },
    { provider: 'openrouter', model: 'openrouter/free' },
    { provider: 'openrouter', model: 'openrouter/bodybuilder' },
    { provider: 'openrouter', model: 'openrouter/some-stealth-alpha' },
    { provider: 'openrouter', model: 'OpenRouter/Fusion:nitro' },
    { provider: 'openrouter', model: 'openrouter/fusion/' },
    { provider: 'openrouter', model: 'openai/gpt-6.1-sol', extra: { models: ['openrouter/free'] } },
  ]) {
    assert.equal(denied(withCritic(seat)).length, 1, JSON.stringify(seat));
  }
});

test('the OpenRouter-namespace rule does not catch provider-prefixed ids or :free variants', () => {
  for (const seat of [
    { provider: 'openrouter', model: 'openrouter/openai/gpt-6.1-sol' },
    { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash:free' },
    { provider: 'openrouter', model: 'z-ai/glm-5.3' },
  ]) {
    assert.deepEqual(deniedReasonsOf(seat), [], JSON.stringify(seat));
  }
});

test('lint: ordinary seats, including OpenRouter-hosted ones and the word "openrouter", are not flagged', () => {
  for (const seat of [
    { provider: 'openrouter', model: 'openai/gpt-5.6-luna' },
    { provider: 'openrouter', model: 'anthropic/claude-opus-5', extra: { models: ['openai/gpt-5', 'google/gemini-3.6-flash'] } },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'openrouter', model: 'mistralai/mistral-medium-3-5' },
  ]) {
    assert.deepEqual(deniedReasonsOf(seat), [], JSON.stringify(seat));
  }
});

test('lint: a denied model hidden behind single-vendor mode is still caught (checked after resolveChainSeats)', () => {
  const cfg = { name: 'sv', transport: 'openrouter', seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }, { provider: 'xai', model: 'grok-4' }] } };
  assert.equal(denied(cfg).length, 1);
});

test('run time: runChain refuses a denied seat before any stage runs, and nothing can downgrade it', async () => {
  setCache(null); setBudget(null);
  const stages = [];
  await assert.rejects(
    () => runChain({ request: 'Req.', config: withCritic({ provider: 'mock', model: 'grok-mock', lab: 'g' }), draft: 'DRAFT', log: () => {}, onStage: s => stages.push(s) }),
    DeniedModel);
  assert.equal(stages.length, 0, 'no stage may run - not even a free one');
  await assert.rejects(
    () => runDescendingChain({ request: 'Req.', config: { name: 'd', descending: { stages: ['plan'] }, seats: { descending: { plan: { provider: 'openrouter', model: 'openrouter/auto' } }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }, log: () => {} }),
    DeniedModel);
  assert.throws(() => rethrowControlFlow(new DeniedModel([{ path: 'x', reasons: ['y'] }])), DeniedModel,
    'a catch around invoke() must never turn it into an abstention');
  assert.equal(deniedSeatsOf({}).length, 0);
});

test('there is no xai provider at all: no adapter, no alias, no price, no example key', async () => {
  const { call, providerNames } = await import('../src/providers.js');
  assert.ok(!providerNames().includes('xai'));
  await assert.rejects(() => call('xai', { model: 'grok-4', system: 's', messages: [], maxTokens: 1 }), /Unknown provider: xai/);
  const pricing = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
  assert.ok(!Object.keys(pricing).some(k => /grok|xai|x-ai/i.test(k)));
  assert.ok(!/XAI_API_KEY/.test(readFileSync(join(root, '.env.example'), 'utf8')));
  assert.ok(!/x-ai\/|xai:/.test(readFileSync(join(root, 'src', 'providers.js'), 'utf8')), 'no single-vendor alias to xAI either');
});

// Bug audit 2026-09-27 M1: a missing, null or empty model skipped every id check, at lint and at run
// time, so what the provider then picked (possibly a router) was never checked.
test('a seat on an API provider with no, null or empty model is refused by lint and at run time', async () => {
  for (const seat of [{ provider: 'openrouter' }, { provider: 'openrouter', model: null }, { provider: 'openrouter', model: '' }, { provider: 'anthropic', model: '  ' }]) {
    assert.ok(deniedReasonsOf(seat).some(r => /has no model/.test(r)), JSON.stringify(seat));
    const cfg = withCritic({ ...seat, lab: 'n' });
    assert.ok(deniedSeatsOf(cfg).length >= 1, `lint walk finds ${JSON.stringify(seat)}`);
    setCache(null); setBudget(null);
    await assert.rejects(() => runChain({ request: 'Req.', config: cfg, draft: 'DRAFT', log: () => {} }), DeniedModel);
  }
  // external (a person pastes the reply) and mock (offline) call no API, so they may leave it out.
  assert.deepEqual(deniedReasonsOf({ provider: 'external' }), []);
  assert.deepEqual(deniedReasonsOf({ provider: 'mock' }), []);
});
