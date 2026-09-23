// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #3).
// A panel round that heard no reviewer used to revise against an empty objection list every round
// up to the cap - paying (or pausing) for rewrites with nothing to fix. Repro: /tmp/audit3/outage.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget } from '../src/chain.js';

const chain = critics => ({
  maxRounds: 4, signoff: 'unanimous', dispute: { enabled: true, stall_rounds: 2 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
});

test('an all-unreachable panel never revises; it stops and records no_heard_reviewer', async () => {
  setCache(null); setBudget(null);
  const r = await runChain({ request: 'A mock task.', log: () => {}, config: chain([
    { provider: 'mock', model: 'mock-network-error', lab: 'x' },
    { provider: 'mock', model: 'mock-network-error', lab: 'y' },
  ]) });
  assert.equal(r.stages.filter(s => /^revise-/.test(s.label)).length, 0, 'no rewrite with nothing to fix');
  assert.equal(r.passed, false);
  assert.equal(r.noHeardReviewer?.round, 1);
  assert.ok(r.panelVerdicts.every(v => v.verdict === 'unheard'));
});

test('an all-unreadable panel stops the same way', async () => {
  setCache(null); setBudget(null);
  const r = await runChain({ request: 'A mock task.', log: () => {}, config: chain([
    { provider: 'mock', model: 'mock-unreadable', lab: 'x' },
    { provider: 'mock', model: 'mock-unreadable', lab: 'y' },
  ]) });
  assert.equal(r.stages.filter(s => /^revise-/.test(s.label)).length, 0);
  assert.equal(r.passed, false);
  assert.ok(r.noHeardReviewer);
});

test('control: a panel where one lab objects still revises, and records no noHeardReviewer', async () => {
  setCache(null); setBudget(null);
  const r = await runChain({ request: 'A mock task.', log: () => {}, config: chain([
    { provider: 'mock', model: 'mock-critic-holdout', lab: 'x' },
    { provider: 'mock', model: 'mock-network-error', lab: 'y' },
  ]) });
  assert.ok(r.stages.some(s => /^revise-/.test(s.label)));
  assert.equal(r.noHeardReviewer, undefined);
});
