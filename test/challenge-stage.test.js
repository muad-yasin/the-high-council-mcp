// test/challenge-stage.test.js
//
// v7 item 5: a post-signoff challenge stage modelled on the graphe paranomon. After signoff,
// exactly one recorded challenge may re-open exactly one decision for one round; the challenger
// must state what evidence would settle it. The one-challenge, one-decision bound is hard-coded
// in the executor (src/chain.js), not configurable upward - chain-lint.js fails validation on any
// attempt to add a max-challenges or extra-rounds key. Gated on `challenge: { enabled: true }`,
// the only key exposed; absent key preserves current behavior exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unanimousConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));

test('runChain: challenge disabled (key absent) behaves exactly as before - no challenge stage, no challenge field logged', async () => {
  const result = await runChain({
    request: 'Write a short fixture deliverable.',
    config: unanimousConfig,
    log: () => {},
  });
  assert.equal(result.challenge, null);
});

test('runChain: with challenge enabled and a scripted challenger that raises one, exactly one decision is re-opened for one round and the run records it', async () => {
  const config = {
    ...unanimousConfig,
    challenge: { enabled: true },
    seats: {
      ...unanimousConfig.seats,
      challenger: { provider: 'mock', model: 'mock-challenge-yes', lab: 'mock-challenger' },
    },
  };
  const result = await runChain({
    request: 'Write a short fixture deliverable.',
    config,
    log: () => {},
  });
  assert.ok(result.challenge, 'expected a challenge object in the result');
  assert.equal(result.challenge.raised, true);
  assert.equal(result.challenge.reopened_rounds, 1);
  assert.equal(typeof result.challenge.decision, 'string');
  assert.ok(result.challenge.decision.length > 0);
  assert.equal(typeof result.challenge.evidence_needed, 'string');
  assert.ok(result.challenge.evidence_needed.length > 0);
  assert.equal(result.challenge.by, 'mock-challenger');
});

test('runChain: with challenge enabled and the default (declining) mock challenger, no decision is re-opened', async () => {
  const config = { ...unanimousConfig, challenge: { enabled: true } };
  const result = await runChain({
    request: 'Write a short fixture deliverable.',
    config,
    log: () => {},
  });
  assert.deepEqual(result.challenge, { raised: false });
});

test('chain-lint: challenge.enabled is the only key exposed - a max-challenges key fails validation', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
    challenge: { enabled: true, maxChallenges: 3 },
  }, 'chains/fixture.json');
  const kinds = findings.map(f => f.kind);
  assert.ok(kinds.includes('invalid-challenge-config'));
});

test('chain-lint: an additional-rounds key fails validation the same way', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
    challenge: { enabled: true, additionalRounds: 2 },
  }, 'chains/fixture.json');
  const kinds = findings.map(f => f.kind);
  assert.ok(kinds.includes('invalid-challenge-config'));
});

test('chain-lint: challenge.enabled alone, or challenge entirely absent, has no findings', () => {
  const base = {
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  };
  assert.deepEqual(lintChain(base, 'chains/fixture.json'), []);
  assert.deepEqual(lintChain({ ...base, challenge: { enabled: true } }, 'chains/fixture.json'), []);
  assert.deepEqual(lintChain({ ...base, challenge: { enabled: false } }, 'chains/fixture.json'), []);
});
