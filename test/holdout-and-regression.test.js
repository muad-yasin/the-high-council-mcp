// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #2, #4).
// Scripted through the stage cache (the same mechanism a resume uses), so each round's replies are
// exact. Repros: /tmp/audit3/lastround.mjs and /tmp/audit3/regress.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget } from '../src/chain.js';

const fail = (...cs) => JSON.stringify({ meets: false, criteria: [], failures: cs.map(c => ({ criterion: c, problem: 'Still wrong: ' + c, fix: 'fix it' })), verdict_line: 'fails' });
const ok = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'all met' });
const C = 'It states the assumptions.', D = 'It is short.';
const config = maxRounds => ({
  maxRounds, signoff: 'unanimous', dispute: { enabled: true, stall_rounds: 2 },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' },
    builder: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [{ provider: 'mock', model: 'm', lab: 'x' }, { provider: 'mock', model: 'm', lab: 'y' }],
  },
});
async function scripted(script, maxRounds) {
  setBudget(null);
  setCache({ get: label => label in script ? { text: script[label], usage: { input: 1, output: 3 }, usd: 0 } : null });
  try { return await runChain({ config: config(maxRounds), request: 'A mock task.', log: () => {} }); }
  finally { setCache(null); }
}

test('#2: a holdout that is unheard in the final round keeps its objections in the dissent record', async () => {
  const r = await scripted({
    criteria: JSON.stringify({ criteria: [C, D] }), build: 'DRAFT v1',
    'panel-1-x': fail(C), 'panel-1-y': ok, 'revise-1': 'DRAFT v2',
    'panel-2-x': fail(C, D), 'panel-2-y': ok, 'revise-2': 'DRAFT v3',
    'panel-3-x': 'garbled', 'panel-3-x-reask1': 'garbled', 'panel-3-x-reask2': 'garbled', 'panel-3-y': ok,
    dispute: 'DRAFT v3 disputed',
  }, 3);
  assert.equal(r.passed, false);
  assert.notEqual(r.dispute?.reason, 'no_open_objections', 'the holdout\'s dissent must not vanish');
  const open = r.dispute.open_objections;
  assert.deepEqual(open.map(o => o.criterion).sort(), [C, D].sort());
  assert.ok(open.every(o => o.lab === 'x'), 'each carried objection keeps its lab');
  assert.match(r.deliverable, /dissent|objection/i, 'the deliverable leads with the warning');
});

test('#4: no REGRESSION when the only objector was simply unheard in the round in between', async () => {
  const r = await scripted({
    criteria: JSON.stringify({ criteria: [C, D] }), build: 'DRAFT v1',
    'panel-1-x': fail(C), 'panel-1-y': ok, 'revise-1': 'DRAFT v2',
    'panel-2-x': 'garbled', 'panel-2-x-reask1': 'garbled', 'panel-2-x-reask2': 'garbled', 'panel-2-y': ok,
    'panel-3-x': fail(C), 'panel-3-y': ok, 'revise-3': 'DRAFT v3',
    'panel-4-x': ok, 'panel-4-y': ok,
  }, 5);
  assert.deepEqual(r.regressions, []);
});

test('#4 control: a real regression (heard, passed, then failed again) is still flagged', async () => {
  const r = await scripted({
    criteria: JSON.stringify({ criteria: [C, D] }), build: 'DRAFT v1',
    'panel-1-x': fail(C), 'panel-1-y': ok, 'revise-1': 'DRAFT v2',
    'panel-2-x': fail(D), 'panel-2-y': ok, 'revise-2': 'DRAFT v3',
    'panel-3-x': fail(C), 'panel-3-y': ok, 'revise-3': 'DRAFT v4',
    'panel-4-x': ok, 'panel-4-y': ok,
  }, 5);
  assert.deepEqual(r.regressions, [{ round: 3, criterion: C, labs: ['x'] }]);
});
