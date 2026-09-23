// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #1).
// Stages labelled by lab alone (panel-<round>-<lab>, propose-<lab>, ...) share one cache entry when
// two seats share a lab - a holdout's objection could replay as the other seat's pass on resume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintChain } from '../src/chain-lint.js';
import { runChain, duplicateLabSlots, setCache, setBudget } from '../src/chain.js';

const critic = (model, lab) => ({ provider: 'mock', model, ...(lab ? { lab } : {}) });
const dupLint = cfg => lintChain(cfg, 'fixture.json').filter(f => f.kind === 'duplicate-lab');

test('a unanimous panel with two seats in one lab is refused by lint and at run time', async () => {
  const cfg = { name: 'dupe', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'],
    seats: { critics: [critic('mock-critic-holdout', 'x'), critic('mock-critic-a', 'x')] } };
  assert.equal(dupLint(cfg).length, 1);
  setCache(null); setBudget(null);
  const stages = [];
  await assert.rejects(() => runChain({ request: 'R', config: cfg, draft: 'D', log: () => {}, onStage: s => stages.push(s) }), /share a lab/);
  assert.equal(stages.length, 0);
});

test('duplicate proposers (when proposals run) and duplicate ambiguity seats are refused too', () => {
  assert.deepEqual(duplicateLabSlots({ proposals: { parts: 1 }, seats: { proposers: [critic('a'), critic('b')], critics: [critic('c', 'c')] } }), [{ slot: 'proposers', labs: ['mock'] }]);
  assert.deepEqual(duplicateLabSlots({ ambiguity_union: { enabled: true }, seats: { critics: [critic('a', 'q'), critic('b', 'q')] } }), [{ slot: 'ambiguity', labs: ['q'] }]);
});

test('a "first"-mode panel may share a lab (it labels by round, not by lab) - mock and single-vendor chains rely on it', () => {
  const cfg = { name: 'first', seats: { critics: [critic('mock-critic-a'), critic('mock-critic-b')] } };
  assert.deepEqual(duplicateLabSlots(cfg), []);
  assert.equal(dupLint(cfg).length, 0);
});
