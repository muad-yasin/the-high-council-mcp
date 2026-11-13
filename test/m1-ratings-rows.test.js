// 0.8.4 M1 COMPLETE U1-2: two M1 rows the plan found without a test of their own by title (M1C_U1_PLAN.md section 8): T19c and T19p. Test ADDITIONS only (no src): they pin behaviour that exists. Pure, offline.
// T19c (Q2(e), Q3(e)): a layer whose only standing objection is rated exactly 4.0 does not sign off; control: 3.9 does (the line is 4); an unrated one does not either (T19m's twin).
// T19p (Q3(f), Q3(g)): every change of a rating is in the record, for objections of seats of two makers: a handler re-tag and a layer-3 re-tag both reach the severity snapshot's `retags`, each with its lab, pass and who made it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { severityMeets, createSeverityRun } from '../src/severity.js';

test('T19c: a layer whose only standing objection is rated 4.0 does not sign off; at 3.9 it does (the control that makes this row able to fail); unrated does not', () => {
  assert.equal(severityMeets([{ severity: 4.0 }]), false);
  assert.equal(severityMeets([{ severity: 3.9 }]), true);
  assert.equal(severityMeets([{}]), false);
  assert.equal(severityMeets([{ severity: 3.5 }, { severity: 3.9 }]), true);
});

test('T19p: a handler re-tag and a layer-3 re-tag of objections of two seats (two makers) are both in the severity record, each with its lab, pass and who made it', () => {
  const run = createSeverityRun();
  const a = { lab: 'alpha', id: 'O-aaaaaaaa', severity: 5 }; const b = { lab: 'beta', id: 'O-bbbbbbbb', severity: 5 };
  run.commit('alpha', a.id, 5, 1); run.commit('beta', b.id, 5, 1);
  run.applyHandlerRetags(2, [{ id: a.id, severity: 6, reason: 'worse than first thought' }]);
  const ledger = new Map([[b.id, { lab: 'beta', status: 'active', severity: 5 }]]);
  run.applyRetags(3, [{ seat: 'gamma', retags: [{ id: b.id, severity: 7, reason: 'much worse' }] }], ledger);
  run.closePass(3, [a, b]);
  const rows = run.snapshot().retags;
  assert.deepEqual(rows.map(r => [r.lab, r.id, r.pass, r.from, r.to, r.by]), [['alpha', a.id, 2, 5, 6, 'handler'], ['beta', b.id, 3, 5, 7, 'layer3']]);
});
