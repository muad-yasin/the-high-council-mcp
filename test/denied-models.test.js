// Owner decision 2026-09-23: "Drop grok drop Kimi k3", then "No grok, ever!!!". A hard error in
// chain-lint (no opt-out) and at run time, so neither a user-written chain nor a direct runChain()
// caller can seat xAI/Grok, Kimi/Moonshot, or a router that could route to them.
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

test('lint: xAI/Grok and Kimi/Moonshot are errors in every spelling and slot', () => {
  for (const seat of [
    { provider: 'xai', model: 'grok-4' },
    { provider: 'openrouter', model: 'x-ai/grok-4.1' },
    { provider: 'openrouter', model: 'moonshotai/kimi-k3' },
    { provider: 'together', model: 'Moonshot/Kimi-K2-Instruct' },
    { provider: 'openrouter', model: 'openai/gpt-5', extra: { models: ['x-ai/grok-4'] } },
  ]) {
    assert.equal(denied(withCritic(seat)).length, 1, JSON.stringify(seat));
  }
  // Outside the critics list too - the check walks the whole config.
  assert.equal(denied({ seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }] }, preflight: { seats: [{ provider: 'xai', model: 'grok-4' }] } }).length, 1);
  assert.equal(denied({ seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }], builder: { provider: 'openrouter', model: 'moonshotai/kimi-k3' } } }).length, 1);
});

test('lint: router ids are errors, not warnings (they can route to a denied model)', () => {
  for (const seat of [
    { provider: 'openrouter', model: 'openrouter/auto' },
    { provider: 'openrouter', model: 'openrouter/pareto-code' },
    { provider: 'openrouter', model: 'openai/gpt-5', extra: { plugins: [{ id: 'pareto-router' }] } },
    { provider: 'openrouter', model: 'some/auto-router' },
  ]) {
    assert.equal(denied(withCritic(seat)).length, 1, JSON.stringify(seat));
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
