// 0.8.3 M6 S3b: the sitting records the verdict after every tree step (PLAN 9.2), asks again only when the record moved, retries a step whose recording was skipped, and never lets a lock held elsewhere replace the sitting's real
// result. Real all-mock trees on the milestone mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, withTreeLock } from '../src/tree-record.js';
import { recordReadinessAfter } from '../src/tree-readiness.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';

async function tree() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  return r;
}
const readiness = r => eventsOf(r).filter(e => e.event === 'readiness');

test('a sitting records the verdict as it goes (the state after each step), and a second sitting with nothing changed appends NO readiness event (the count is asserted)', async () => {
  const r = await tree();
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'nothing_to_do');
  const n = readiness(r).length;
  assert.ok(n >= 2, `several steps changed the verdict: ${n}`);
  assert.deepEqual(readiness(r).map(e => e.verdict).filter((v, i, a) => i === 0 || v !== a[i - 1]), ['incomplete'], 'incomplete all the way: the agreement is unrecorded');
  for (let i = 0; i < 3; i += 1) await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(readiness(r).length, n, 'three more sittings, nothing changed: no event');
});

test('a step whose recording was SKIPPED is not remembered: the next step on an unchanged record asks again (the memo is set only when nothing was skipped)', async () => {
  const r = await tree();
  let calls = 0;
  const hooks = { recordReadiness: (root, opts) => { calls += 1; return calls === 1 ? { appended: false, skipped: 'lock_busy', verdict: null } : recordReadinessAfter(root, opts); } };
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), hooks });
  assert.ok(calls >= 2, `asked again after the skipped attempt: ${calls} calls`);
  assert.ok(readiness(r).length >= 1, 'and the verdict was recorded in this sitting');
});

test('recordReadinessAfter swallows ONLY a lock held elsewhere and a refused record write (reported as skipped); any other error is a defect and is thrown', async () => {
  const r = await tree();
  const before = readiness(r).length;
  const busy = withTreeLock(r.t.rootDir, () => recordReadinessAfter(r.t.rootDir, { work: r.t.work }));             // the tree lock is held by this very call: the inner writer cannot get it
  assert.deepEqual([busy.appended, busy.skipped], [false, 'lock_busy']);
  assert.equal(readiness(r).length, before, 'nothing was written');
  assert.throws(() => recordReadinessAfter(r.t.rootDir, {}), TypeError, 'a missing working folder is a bug, not a busy lock');
  void readTreeRecord;
});
