// Restore gap, the SITTING wiring (0.8.3 M6; C&C 14 Oct 2026: commit 1 built the library, nothing called it; gate note in the report). A real sitting (`runTree`, the verb behind `council tree resume`) closes a blocked-child stop whose file is back byte for
// byte, BEFORE afterStep, and says so in the sitting lines. Real all-mock trees, $0. R7 (a file replaced between the read and the append) uses a test-only seam; R10 pins the root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { sittingLines } from '../src/tree-resume.js';
import { decideHandler } from '../src/tree-decide.js';
import { checkHandler } from '../src/tree-check.js';
import { readinessOf } from '../src/tree-ready.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { presenceProblems } from './helpers/event-presence.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
const nodeOf = (r, node) => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
const reportOf = (r, node) => join(r.t.runsDir, nodeOf(r, node).runId, 'report.json');
const damage = (r, node) => { const f = reportOf(r, node); const original = readFileSync(f, 'utf8'); writeFileSync(f, '{ not json'); return original; };
const sit = (r, start, over = {}) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0, ...over });
const stops = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked');
const restored = r => eventsOf(r).filter(e => e.event === 'stop_restored');
const openIds = r => stateOf(readTreeRecord(r.t.rootDir)).openStops;

test('a REAL sitting closes the stop of a node whose report.json is back as it was: ONE stop_restored (actor sitting), the sitting result and lines say so, `tree status` no longer lists the stop, and a further sitting appends nothing', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const original = damage(r, 'R/M2');
  const first = await sit(r, start);
  const [stop] = stops(r);
  assert.deepEqual([stop.node, stop.blockedBy.map(b => b.code)], ['R/M2', ['report_unreadable']]);
  assert.equal(restored(r).length, 0); assert.deepEqual(openIds(r), [stop.id]);
  assert.deepEqual(first.restored, [], 'a still-damaged file closes nothing: the sitting opened the stop and left it');
  writeFileSync(reportOf(r, 'R/M2'), original);
  const before = eventsOf(r).length;
  const second = await sit(r, start);
  // the RECORD first (the behaviour: the stop is closed), then what the sitting reports about it
  assert.equal(restored(r).length, 1); assert.equal(restored(r)[0].actor, 'sitting'); assert.equal(restored(r)[0].stopId, stop.id);
  assert.deepEqual(openIds(r), [], 'the stop is closed');
  assert.deepEqual(second.restored, [{ stopId: stop.id, node: 'R/M2', generation: 1, restored: true }]);
  assert.equal(stops(r).length, 1, 'no NEW stop: nothing else was wrong with the node');
  assert.match(sittingLines(second, ROOT_ID).join('\n'), new RegExp(`Closed by the sitting: stop ${stop.id} on R/M2 \\(generation 1\\)\\. The plan text is the one recorded when that step finished, so nothing needed your answer\\.`));   // EDITED in the M7 apply (E164; old: 'on R/M2@g1. The files are back as the run produced them (the plan body matches the hash recorded when the node closed), so ...'; why: the old clause claimed more than the check compares, and the developer's key is not for the person)
  assert.doesNotMatch(sittingLines(second, ROOT_ID).join('\n'), /contract check/, 'no contract clause when the stop did not hold a contract check');
  const third = await sit(r, start);
  assert.deepEqual(third.restored, [], 'idempotent: a second sitting appends nothing'); assert.equal(restored(r).length, 1);
  assert.equal(eventsOf(r).slice(before).some(e => e.event === 'decision_recorded'), false, 'no decision of anyone is recorded');
  assert.deepEqual(presenceProblems(restored(r)), [], 'the presence audit covers stop_restored: a new call site cannot drop a field the table reads');
});

test('R7 (REAL, the test-only seam): the file is swapped AFTER the sitting read it and BEFORE the event is appended: the event carries the SNAPSHOT\'s hash (what was read), and the next sitting step reopens a stop because every reader checks the file as it is now', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const original = damage(r, 'R/M2');
  await sit(r, start);
  writeFileSync(reportOf(r, 'R/M2'), original);
  const held = nodeOf(r, 'R/M2').deliveredBodySha256;
  const out = await sit(r, start, { hooks: { afterRestoreSnapshot: () => writeFileSync(reportOf(r, 'R/M2'), '{ swapped after the read') } });
  assert.equal(restored(r).length, 1, 'the snapshot was good, so the stop closed');
  assert.equal(restored(r)[0].observedBodySha256, held, 'the event carries the hash of what was READ');
  assert.equal(out.restored.length, 1);
  // the swap is seen by the NEXT step's readers: the node is blocked again and a NEW stop opens
  assert.equal(stops(r).filter(e => e.node === 'R/M2').length >= 2, true, 'a new stop for R/M2 opened in the same sitting (afterStep reads the file as it is now)');
  assert.equal(openIds(r).length, 1);
});

test('R10 (REAL): the ROOT\'s own report.json: while damaged its stop is open and `--milestone` is refused (and writes nothing: with the root\'s report unreadable no milestone can even be found); put back exactly, the sitting closes that stop, recorded as the sitting\'s (a CHANGED root plan stays the person\'s: commits 2b/2c)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const original = damage(r, 'R');
  await sit(r, start);
  const rootStop = stops(r).find(e => e.node === 'R');
  assert.ok(rootStop, 'the root has a blocked stop'); assert.ok(openIds(r).includes(rootStop.id));
  const before = eventsOf(r).length;
  const io = terminal([]); io.stdin.end();
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { milestone: 'R@g1:M5', stop: rootStop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 1); assert.match(io.errors(), /Nothing was asked and nothing was written/); assert.equal(eventsOf(r).length, before, '--milestone on the open root stop wrote nothing');
  writeFileSync(reportOf(r, 'R'), original);
  const out = await sit(r, start);
  assert.equal(openIds(r).includes(rootStop.id), false, 'byte-identical: the sitting closes the root\'s stop too (the run\'s own file is back; nobody decided anything)');
  assert.ok(out.restored.some(x => x.stopId === rootStop.id));
  const ev = restored(r).find(e => e.stopId === rootStop.id);
  assert.deepEqual([ev.actor, ev.node, ev.generation], ['sitting', 'R', 1]);
});

test('a restored node does NOT wait for a `tree check` it did not need before the damage (C&C question, DRIVEN): a recorded integration pass is bound to the thin-contract pins of the participants; while their report is unreadable the pass reads as "other versions" and the agreement is unrecorded again, and when the SAME bytes come back (the sitting closes the stop) the pass is current again', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const A1 = 'R@g1:A1';
  const reasons = () => readinessOf(r.t.rootDir, { work: r.t.work }).reasons.filter(x => x.code === 'integration_unrecorded').map(x => x.scope);
  assert.deepEqual(reasons(), [A1], 'before any check: the agreement is unrecorded (the fixture\'s own baseline)');
  const io = terminal([A1, 'y']);
  const code = await checkHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, args: [A1, 'pass'], flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 0, io.shown() + io.errors());
  assert.deepEqual(reasons(), [], 'a pass is recorded and current');
  const original = damage(r, 'R/M1');
  await sit(r, start);
  assert.deepEqual(reasons(), [A1], 'while a participant\'s report is unreadable the recorded pass is bound to other versions: unrecorded again');
  writeFileSync(reportOf(r, 'R/M1'), original);
  await sit(r, start);
  assert.equal(openIds(r).length, 0, 'the sitting closed the stop');
  assert.deepEqual(reasons(), [], 'the same bytes are back: the recorded pass counts again, nothing needs re-checking');
});
