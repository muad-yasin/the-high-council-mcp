// Readiness fail-open (0.8.3 M6, C&C 14 Oct 2026; found while building the restore gap): a closed node whose PLAN cannot be read (deliverable.md missing, or not hashing to the delivered_text.body_sha256 report.json records) judged READY:
// runFactsOf returned plan null, `split` stayed null and judgeNode returned at `if (!split)`. The verdict is what `tree status`, the handoff and `tree check` tell a person (no code admits a child on it alone), so it told a person a node was fine whose plan could not be read: it failed OPEN. Now it is `blocked: plan_unreadable` (its own code), for the root too (one
// policy for every node), and the existing rule opens a blocked-child stop for it. Real all-mock trees on the milestone mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renameSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { gatherReadinessFacts, readinessOf } from '../src/tree-ready.js';
import { REFUSED_CODES } from '../src/tree-check.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';

async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
const dirOf = (r, node) => join(r.t.runsDir, [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node).runId);
const reasonsOf = (r, code) => readinessOf(r.t.rootDir, { work: r.t.work }).reasons.filter(x => x.code === code).map(x => [x.severity, x.scope]);
const away = (r, node, name) => { const f = join(dirOf(r, node), name); renameSync(f, `${f}.away`); return () => renameSync(`${f}.away`, f); };

test('a healthy tree has no plan_unreadable, and the gatherer sets a BOOLEAN planReadable on every closed node (never leaves it for the judge to guess)', { timeout: 400_000 }, async () => {
  const { r } = await finished();
  assert.deepEqual(reasonsOf(r, 'plan_unreadable'), []);
  const closed = gatherReadinessFacts(r.t.rootDir, { work: r.t.work }).nodes.filter(n => n.phase === 'closed');
  assert.ok(closed.length >= 4, 'R and its three children');
  for (const n of closed) assert.equal(n.planReadable, true, `${n.node}@g${n.generation}`);
});

test('a child whose deliverable.md is gone is BLOCKED (plan_unreadable, at its scope) and no longer judged ready; the file put back clears it; a deliverable that no longer hashes to the report is the same', { timeout: 400_000 }, async () => {
  const { r } = await finished();
  const back = away(r, 'R/M2', 'deliverable.md');
  assert.deepEqual(reasonsOf(r, 'plan_unreadable'), [['blocked', 'R/M2@g1']]);
  assert.equal(readinessOf(r.t.rootDir, { work: r.t.work }).reasons.find(x => x.code === 'plan_unreadable').text, 'R/M2@g1: its plan file deliverable.md is missing, cannot be read, or is not the text whose hash report.json records', 'E158 (M7): the reason names what it fires on, a missing file and a changed one alike');
  assert.equal(readinessOf(r.t.rootDir, { work: r.t.work }).verdict, 'blocked');
  back();
  assert.deepEqual(reasonsOf(r, 'plan_unreadable'), [], 'the restored file clears it (the verdict is recomputed from the files)');
  const f = join(dirOf(r, 'R/M2'), 'deliverable.md'); const original = readFileSync(f, 'utf8');
  writeFileSync(f, `${original}\nChanged after the close.\n`);
  assert.deepEqual(reasonsOf(r, 'plan_unreadable'), [['blocked', 'R/M2@g1']]);
  writeFileSync(f, original);
});

test('the ROOT is judged by the same code: its plan gone is plan_unreadable at R@g1; and when report.json is ALSO gone only report_unreadable is given (it comes first)', { timeout: 400_000 }, async () => {
  const { r } = await finished();
  const back = away(r, 'R', 'deliverable.md');
  assert.deepEqual(reasonsOf(r, 'plan_unreadable'), [['blocked', 'R@g1']]);
  back();
  const b1 = away(r, 'R/M1', 'deliverable.md'); const b2 = away(r, 'R/M1', 'report.json');
  assert.deepEqual(reasonsOf(r, 'plan_unreadable'), []); assert.deepEqual(reasonsOf(r, 'report_unreadable'), [['blocked', 'R/M1@g1']]);
  b1(); b2();
});

test('a real sitting turns it into a blocked-child stop (the existing rule: every blocked reason at a closed child opens one), blockedBy plan_unreadable; plan_unreadable refuses a recording like every node-scoped blocked code', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  away(r, 'R/M2', 'deliverable.md');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const stops = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked');
  assert.deepEqual(stops.map(e => [e.node, e.blockedBy.map(b => b.code)]), [['R/M2', ['plan_unreadable']]]);
  assert.match(stops[0].blockedBy[0].text, /R\/M2@g1: its plan file deliverable\.md is missing, cannot be read, or is not the text whose hash report\.json records/);   // EDITED in the M7 apply (E158; old: "its plan (deliverable.md, read against the hash report.json records for it) cannot be read")
  assert.equal(REFUSED_CODES.includes('plan_unreadable'), true);
});
