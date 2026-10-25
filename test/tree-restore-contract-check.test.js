// Restore gap FIX-UP (0.8.3 M6; found by Builder A while driving the accept flow, disclosed to C&C 14 Oct 2026; C&C's ruling: its own SHA-stop before unit 2b). A plan swapped and put back byte for byte stopped with BOTH `plan_unreadable` and `contract_check`
// (an edited sealed file fails the contract check as well); only plan_unreadable was restorable, so NO sitting could close that stop. Now `contract_check` is closable ONLY beside `plan_unreadable`, when the sitting's OWN re-run of the contract check on the
// restored files exits 0; the event carries that exit and the table refuses every other shape, each with its own sentence. Real all-mock trees, $0.
// AMENDED (lane T, G2, D2 F4c): contract_check now also closes ALONE, on the same re-run exiting 0 (the B3d test below; the files it reads are read live).
//
// WHICH ACCEPTED TEST PASSED OVER THIS, AND WHAT ITS FIXTURE LACKED: test/tree-restore.test.js "plan_unreadable (REAL, gate page 9.2)" opened its stop by MOVING deliverable.md away (a MISSING file: the contract check reads it as "not readable", an `unchecked` item that
// is neither drift nor a pass, so the stop held plan_unreadable alone) and then wrote a changed file only AFTER the stop existed. No fixture ever let a sitting READ a CHANGED deliverable.md (bytes present, different) when it opened the stop, which is the case
// that raises both codes. This file does exactly that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { sittingLines } from '../src/tree-resume.js';
import { restoreClosedStops, restoreDecision, snapshotOfRun } from '../src/tree-restore.js';
import { transitionRefusal } from '../src/tree-transitions.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { presenceProblems } from './helpers/event-presence.js';

async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
const nodeOf = (r, node) => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
const planFile = (r, node) => join(r.t.runsDir, nodeOf(r, node).runId, 'deliverable.md');
const sit = (r, start) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
const stopsOf = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const restoredEvents = r => eventsOf(r).filter(e => e.event === 'stop_restored');
const openIds = r => stateOf(readTreeRecord(r.t.rootDir)).openStops;
/** Swap the plan (bytes present, different), let a REAL sitting open the stop, return { stop, original }. */
async function swapped(r, start, node = 'R/M2') {
  const original = readFileSync(planFile(r, node), 'utf8');
  writeFileSync(planFile(r, node), `${original}\nAn added sentence.\n`);
  await sit(r, start);
  const stop = stopsOf(r, node).at(-1);
  assert.ok(stop && openIds(r).includes(stop.id));
  return { stop, original };
}
/** The candidate stop_restored a hand would write for `node`'s stop, from the record's own numbers. */
function candidate(r, stop, over = {}) {
  const n = nodeOf(r, stop.node);
  return { event: 'stop_restored', actor: 'sitting', stopId: stop.id, node: stop.node, generation: stop.generation, runId: stop.runId, deliveredBodySha256: n.deliveredBodySha256, observedBodySha256: n.deliveredBodySha256, ...(n.thinContractSha256 ? { thinContractSha256: n.thinContractSha256 } : {}), ...over };
}
const refusedWith = (r, event) => { const x = transitionRefusal(stateOf(readTreeRecord(r.t.rootDir)), event); return x?.reason ?? null; };

test('REAL SITTING (the stranding): a plan swapped (bytes present, different) opens a stop holding BOTH plan_unreadable and contract_check; the same bytes put back, a sitting closes it: ONE stop_restored carrying the exit of ITS OWN re-run of the contract check (0); no new stop', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop, original } = await swapped(r, start);
  assert.deepEqual(stop.blockedBy.map(b => b.code).sort(), ['contract_check', 'plan_unreadable']);
  writeFileSync(planFile(r, 'R/M2'), original);
  const back = await sit(r, start);
  assert.equal(restoredEvents(r).length, 1, 'the sitting closed the stop');
  assert.deepEqual([restoredEvents(r)[0].stopId, restoredEvents(r)[0].actor, restoredEvents(r)[0].contractExit], [stop.id, 'sitting', 0]);
  assert.equal(back.restored.length, 1); assert.equal(openIds(r).includes(stop.id), false); assert.equal(stopsOf(r, 'R/M2').length, 1, 'no new stop');
  assert.deepEqual(presenceProblems(restoredEvents(r)), []);
});

test('the stop stays open while the contract check still fails after the bytes are back (the task bundle file changed): the sitting\'s re-run exits non-zero, nothing is written; and a caller that gives NO working folder cannot re-run it, so it closes nothing either', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop, original } = await swapped(r, start);
  writeFileSync(planFile(r, 'R/M2'), original);
  const meta = JSON.parse(readFileSync(join(r.t.runsDir, nodeOf(r, 'R/M2').runId, 'run.json'), 'utf8'));
  const task = meta.task.startsWith('/') ? meta.task : join(r.t.work, meta.task);
  const taskText = readFileSync(task, 'utf8'); writeFileSync(task, `${taskText}\nA line the run never saw.\n`);
  assert.deepEqual(restoreClosedStops(r.t.rootDir, { runsDir: r.t.runsDir, work: r.t.work }).map(x => [x.restored, x.why]), [[false, 'contract_check_still']], 'the check still exits non-zero');
  writeFileSync(task, taskText);
  assert.deepEqual(restoreClosedStops(r.t.rootDir, { runsDir: r.t.runsDir }).map(x => [x.restored, x.why]), [[false, 'contract_check_not_run']], 'without a working folder the check cannot run: the stop stays open, and the word says it never ran');
  assert.equal(restoredEvents(r).length, 0); assert.ok(openIds(r).includes(stop.id));
  const closed = restoreClosedStops(r.t.rootDir, { runsDir: r.t.runsDir, work: r.t.work });
  assert.deepEqual(closed.map(x => x.restored), [true], 'with the task as it was and the working folder given, it closes');
  // E164 (M7): the sitting's line names the contract re-check because THIS stop held one (the event carries contractExit 0)
  assert.equal(closed[0].contractChecked, true);
  assert.match(sittingLines({ restored: closed }, 'ROOT').join('\n'), new RegExp(`Closed by the sitting: stop ${stop.id} on R/M2 \\(generation 1\\)\\. The plan text is the one recorded when that step finished, and its contract check passes again, so nothing needed your answer\\.`));
});

// CHANGED ACCEPTED TEST (lane T, G2, D2 F4c / B3d; Q2, Muad 25 Okt 2026 14:45 "Yes to all"). BEFORE: the table refused this closure ("names contract_check without plan_unreadable beside it: a restored file does not change a failed contract
// check on its own"). The premise moved: the check reads the task, context and HANDOFF files LIVE (src/run-contract-check.js), so the file put back DOES change it. AFTER: the stop closes by the sitting's own re-run exiting 0, and only then.
test('B3d: a contract_check stop ALONE (the task file changed, the plan reads) closes by itself once the file is back: the table takes the closure only with exit 0, a sitting while the file still differs writes nothing, and the sitting after the file is back closes it', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const meta = JSON.parse(readFileSync(join(r.t.runsDir, nodeOf(r, 'R/M2').runId, 'run.json'), 'utf8'));
  const task = meta.task.startsWith('/') ? meta.task : join(r.t.work, meta.task);
  const taskText = readFileSync(task, 'utf8');
  writeFileSync(task, `${taskText}\nA line the run never saw.\n`);
  await sit(r, start);
  const stop = stopsOf(r, 'R/M2').at(-1);
  assert.deepEqual(stop.blockedBy.map(b => b.code), ['contract_check'], 'the check fails ALONE: the plan reads');
  assert.match(refusedWith(r, candidate(r, stop)), /must carry the contract check's exit \(0\)/);
  assert.equal(refusedWith(r, candidate(r, stop, { contractExit: 0 })), null, 'with exit 0 the table takes a lone contract_check closure');
  await sit(r, start);
  assert.equal(restoredEvents(r).length, 0, 'the file still differs: nothing is closed');
  writeFileSync(task, taskText);
  const back = await sit(r, start);
  assert.deepEqual(restoredEvents(r).map(e => [e.stopId, e.actor, e.contractExit]), [[stop.id, 'sitting', 0]]);
  assert.equal(openIds(r).includes(stop.id), false);
  assert.match(sittingLines(back, 'ROOT').join('\n'), /Closed by the sitting: stop .* on R\/M2 \(generation 1\)\. The plan text is the one recorded when that step finished, and its contract check passes again, so nothing needed your answer\./);
});

test('TABLE: a closure of a stop that holds contract_check must carry exit 0; one that holds none carries none', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await swapped(r, start);                                             // holds contract_check AND plan_unreadable
  assert.match(refusedWith(r, candidate(r, stop)), /must carry the contract check's exit \(0\), re-run by the sitting on the restored files/);
  assert.match(refusedWith(r, candidate(r, stop, { contractExit: 1 })), /must carry the contract check's exit \(0\)/);
  assert.equal(refusedWith(r, candidate(r, stop, { contractExit: 0 })), null, 'with exit 0 the table accepts the shape');
  // a stop with plan_unreadable ALONE (the file is missing) carries no exit
  const { r: r2, start: start2 } = await finished();
  renameSync(planFile(r2, 'R/M2'), `${planFile(r2, 'R/M2')}.gone`);
  await sit(r2, start2);
  const lone = stopsOf(r2, 'R/M2').at(-1);
  assert.deepEqual(lone.blockedBy.map(b => b.code), ['plan_unreadable']);
  assert.match(refusedWith(r2, candidate(r2, lone, { contractExit: 0 })), /names no contract_check, so it carries no contract check exit/);
});

test('restoreDecision (pure): a stop holding contract_check beside plan_unreadable closes only with contractExit 0; the event it writes carries it', () => {
  const sha = 'a'.repeat(64);
  const state = { stopMeta: new Map([['e5', { source: 'blocked', blockedCodes: ['contract_check', 'plan_unreadable'], node: 'R/M2', generation: 1, runId: 'x' }]]), openStops: ['e5'], nodes: new Map([['R/M2@g1', { phase: 'closed', runId: 'x', deliveredBodySha256: sha, thinContractSha256: sha, outcome: 'passed', closedStatus: null, dependsOn: [] }]]) };
  const stop = { id: 'e5', node: 'R/M2', generation: 1, runId: 'x' };
  const snapshot = { observedBodySha256: sha, thinContractSha256: sha, passed: true, status: null };
  assert.deepEqual(restoreDecision({ state, stop, snapshot }), { restore: false, why: 'contract_check_not_run' });
  assert.deepEqual(restoreDecision({ state, stop, snapshot, contractExit: 1 }), { restore: false, why: 'contract_check_still' });
  const ok = restoreDecision({ state, stop, snapshot, contractExit: 0 });
  assert.equal(ok.restore, true); assert.equal(ok.event.contractExit, 0);
  assert.equal(typeof snapshotOfRun, 'function');
});
