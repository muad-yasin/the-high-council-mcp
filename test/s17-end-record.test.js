// 0.8.4 S17 (Q9(d), D33, N25; C&C's ruling of 09 Nov on Q3, RU-S19-10 / RT; NEW-A4-1, T21ak): an objection that was EVER rated 7 or above and that a re-tag put below 4 is not closed: it stays OPEN on the end record
// (severity.open_at_end), rated below 4, until it is fixed or its raiser withdraws it. It holds no sign-off (N23), so it sets no `invariant` on a passed run. Pure (the severity ledger over plain data), offline, $0.
// RED ON THE PARENT (route (a)): the parent lists such an objection under `swept`, so the first test fails at its open-list assertion. The pins are green on both trees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeverityRun } from '../src/severity.js';

const ID = 'O-aaaaaaaa';
const ledger = (severity) => new Map([[ID, { lab: 'la', status: 'active', severity }]]);
const retag = (run, pass, to, from) => run.applyRetags(pass, [{ seat: 's', retags: [{ id: ID, severity: to, reason: `to ${to}` }] }], ledger(from));
const finish = (run, passed) => { run.setFinal(4, [{ lab: 'la', id: ID, severity: 5 }], passed); return run.snapshot(); };

test('NEW-A4-1, T21ak (pure): rated 5, re-tagged to 8, then to 3, and still open at the end: it is in open_at_end at 3 with its original 5, in no swept list, not cleared by the re-tag', () => {
  const run = createSeverityRun();
  run.commit('la', ID, 5, 1);
  retag(run, 2, 8, 5);
  retag(run, 3, 3, 8);
  const snap = finish(run, false);
  assert.deepEqual(snap.open.map(o => [o.id, o.original, o.severity]), [[ID, 5, 3]], 'open on the record, rated 3 now, 5 originally');
  assert.deepEqual(snap.swept.map(o => o.id), [], 'not swept');
  assert.equal(run.closesOnOverrule('la', ID), false, 'an overrule or a sorting does not close it');
  assert.deepEqual(run.clearedByRetag('la'), [], 'the re-tag did not clear it');
});

test('T21ak (pure): rated 8 and re-tagged to 3 by the handler: open_at_end at 3, in no swept list', () => {
  const run = createSeverityRun();
  run.commit('la', ID, 8, 1);
  run.applyHandlerRetags(2, [{ id: ID, severity: 3, reason: 'Narrower than tagged.' }]);
  const snap = finish(run, false);
  assert.deepEqual(snap.open.map(o => [o.id, o.original, o.severity]), [[ID, 8, 3]]);
  assert.deepEqual(snap.swept.map(o => o.id), []);
});

test('NEW-A4-1 (PIN, green on the parent): rated 5, re-tagged to 6 and then to 3 (never 7 or above): the re-tag cleared it, so it is swept and not open', () => {
  const run = createSeverityRun();
  run.commit('la', ID, 5, 1);
  retag(run, 2, 6, 5);
  retag(run, 3, 3, 6);
  const snap = finish(run, false);
  assert.deepEqual(snap.swept.map(o => [o.id, o.original, o.severity]), [[ID, 5, 3]]);
  assert.deepEqual(snap.open.map(o => o.id), []);
  assert.deepEqual(run.clearedByRetag('la').map(c => c.id), [ID]);
});

test('NEW-A4-1 (PIN): a PASSED run whose only open row is such an objection sets no invariant; a passed run with a row that still holds a sign-off (rated 5, or with no readable rating) does', () => {
  const run = createSeverityRun();
  run.commit('la', ID, 8, 1);
  run.applyHandlerRetags(2, [{ id: ID, severity: 3, reason: 'Narrower than tagged.' }]);
  assert.equal(finish(run, true).invariant, undefined, 'it holds nothing, so a passed run is not a defect');
  const held = createSeverityRun();
  held.commit('la', ID, 5, 1);
  assert.equal(finish(held, true).invariant, 'passed_with_open_objection', 'a row that holds a sign-off on a passed run is the defect the invariant names');
  const bare = createSeverityRun();
  bare.setFinal(4, [{ lab: 'la', id: ID }], true);
  assert.equal(bare.snapshot().invariant, 'passed_with_open_objection', 'a row with no readable rating holds a sign-off too (holdsSignOff reads it as held): the invariant names it');
});
