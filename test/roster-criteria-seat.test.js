// test/roster-criteria-seat.test.js
//
// Item 5 (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md): `roster.criteria_seat` is a
// seat-*selection* override - it routes the criteria stage's prompt to whichever already-declared
// seat a chain names as strongest (by lab/provider id), without changing which stage runs and
// without adding any new field to report.json. Absent key: today's default criteria seat, exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, resolveCriteriaSeat, findSeatByLab } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unanimousConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));

test('resolveCriteriaSeat: roster.criteria_seat absent returns the chain\'s configured criteria seat unchanged', () => {
  const seat = resolveCriteriaSeat(unanimousConfig);
  assert.deepEqual(seat, unanimousConfig.seats.criteria);
});

test('resolveCriteriaSeat: roster.criteria_seat set to a critic\'s lab routes to that seat', () => {
  const config = { ...unanimousConfig, roster: { criteria_seat: 'mock-a' } };
  const seat = resolveCriteriaSeat(config);
  assert.equal(seat.model, 'mock-critic-a');
});

test('resolveCriteriaSeat: an id matching no seat throws rather than silently falling back', () => {
  const config = { ...unanimousConfig, roster: { criteria_seat: 'nobody-here' } };
  assert.throws(() => resolveCriteriaSeat(config), /nobody-here/);
});

test('findSeatByLab: finds a seat by its own "lab" field across named seats and roster arrays', () => {
  const config = {
    seats: {
      criteria: { provider: 'anthropic', model: 'x', lab: 'strong-lab' },
      builder: { provider: 'mock', model: 'y' },
      critics: [{ provider: 'openai', model: 'z', lab: 'critic-lab' }],
    },
  };
  assert.equal(findSeatByLab(config, 'strong-lab').model, 'x');
  assert.equal(findSeatByLab(config, 'critic-lab').model, 'z');
  assert.equal(findSeatByLab(config, 'no-such-lab'), null);
});

test('runChain: roster.criteria_seat absent uses today\'s default criteria seat', async () => {
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: unanimousConfig, log: () => {} });
  const criteriaStage = result.stages.find(s => s.label === 'criteria');
  assert.equal(criteriaStage.model, 'mock-criteria');
});

test('runChain: roster.criteria_seat set routes the criteria stage to the named seat instead of the chain default', async () => {
  const config = {
    ...unanimousConfig,
    roster: { criteria_seat: 'mock-a' },
  };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  const criteriaStage = result.stages.find(s => s.label === 'criteria');
  assert.equal(criteriaStage.model, 'mock-critic-a');
  // The existing criteria-fixture assertion still holds regardless of which seat answered -
  // the mock provider dispatches on the criteria system prompt text, not the seat/model.
  assert.ok(Array.isArray(result.criteria) && result.criteria.length > 0);
});

test('chain-lint: roster.criteria_seat naming a real seat has no findings', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'strong' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5', lab: 'strong' }],
    },
    roster: { criteria_seat: 'strong' },
  }, 'chains/fixture.json');
  assert.deepEqual(findings.filter(f => f.kind === 'invalid-roster-config'), []);
});

test('chain-lint: roster.criteria_seat naming no real seat fails validation with a fix', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
    roster: { criteria_seat: 'nobody-here' },
  }, 'chains/fixture.json');
  const finding = findings.find(f => f.kind === 'invalid-roster-config');
  assert.ok(finding);
  assert.match(finding.fix, /chains\/fixture\.json/);
});

test('chain-lint: an unrecognized roster key fails validation', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
    roster: { madeUpKey: true },
  }, 'chains/fixture.json');
  assert.ok(findings.some(f => f.kind === 'invalid-roster-config'));
});
