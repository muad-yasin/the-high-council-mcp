// R18 (Fable Q3-3, ruled by C&C as a hard-lock fix): a child bound "not admitted: stale" at the preview, whose stale mark is GONE after its stop was answered in place, was never offered again: the next sitting said
// "nothing to do", the child was never registered, no frontier was pending and nothing listed it - the tree could never finish and nothing said why. The frontier is now pending again, like held_changed, and a new
// approval previews the child admitted. Real tree, all-mock, $0. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier, frontierReopened } from '../src/tree-frontier.js';
import { runTree } from '../src/tree-run.js';
import { exitCodeOf } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const decide = (r, flags, answers) => { const io = terminal(answers); return { io, run: () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }) }; };

test('R18: R/M2 is held stale when the frontier is previewed and approved (a root stop), the stop is answered in place; the frontier is pending again (not "nothing to do"), a new approval previews R/M2 admitted and it registers and runs', { timeout: 600_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  const d1 = approvePending(r);
  const out1 = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out1.status, 'held_by_stop'); assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1', 'R/M3'], 'R/M2 was bound as not admitted: stale, so it is not registered');
  const preview = eventsOf(r).filter(e => e.event === 'frontier_previewed').at(-1).children.find(c => c.node === 'R/M2');
  assert.deepEqual([preview.admitted, preview.refusedBy], [false, 'stale'], 'the preview says WHY, as a structured key');
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), d1.frontierKey), false, 'while the stop stands it is not reopened');
  const d = decide(r, { milestone: 'M5' }, ['Resolved.\n.', 'R@g1:M5', 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).stale.size, 0, 'the mark is gone');
  // the hard lock: it used to be nothing_to_do here with no frontier pending
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), d1.frontierKey), true);
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir })?.key, d1.frontierKey, 'approve offers it again');
  const out2 = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out2.approvalWaits, true, 'the sitting says a frontier waits for an approval'); assert.equal(exitCodeOf(out2), 20, 'and exits 20, not 0');
  approvePending(r);
  const out3 = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(phases(r)['R/M2'], 'closed', JSON.stringify(out3)); assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }), null, 'and nothing waits any more');
});

test('R18 consequence: the OTHER admitted, unregistered children of the reopened frontier wait for the new approval too (as with held_changed): nothing registers under the old approval, and the new approval starts them all', { timeout: 600_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  const d1 = approvePending(r);   // approved while R/M2 is stale: R/M1 and R/M3 are admitted and NOT yet registered (no sitting has run)
  const preview = eventsOf(r).filter(e => e.event === 'frontier_previewed').at(-1);
  assert.deepEqual(preview.children.map(c => [c.node, c.admitted]).sort(), [['R/M1', true], ['R/M2', false], ['R/M3', true]]);
  assert.deepEqual(Object.keys(phases(r)), ['R'], 'nothing is registered yet');
  const d = decide(r, { milestone: 'M5' }, ['Resolved.\n.', 'R@g1:M5', 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), d1.frontierKey), true);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.approvalWaits, true, JSON.stringify(out));
  assert.deepEqual(Object.keys(phases(r)), ['R'], 'R/M1 and R/M3 were NOT registered under the approval that did not cover R/M2');
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(['R/M1', 'R/M2', 'R/M3'].map(n => phases(r)[n]), ['closed', 'closed', 'closed'], 'the new approval starts all three');
});
