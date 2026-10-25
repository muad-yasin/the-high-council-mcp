// 0.8.3 M6 S3 (PLAN 9.2; the recorder, not yet its hook in the sitting): readiness is a RECORD. recordReadiness appends one `readiness` event { verdict, reasons, inputs } when the verdict OR anything it rests on differs from the
// last recorded one, never when nothing changed, and never lets a stale verdict land after a newer one. Real all-mock trees on the milestone mock; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventShapeError } from '../src/tree-transitions.js';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { lastReadinessOf, recordReadiness, sameReadiness } from '../src/tree-readiness.js';
import { readinessOf } from '../src/tree-ready.js';
import { checkHandler } from '../src/tree-check.js';
import { decideHandler } from '../src/tree-decide.js';
import { affectedFor } from '../src/tree-affected.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const A1 = 'R@g1:A1';
async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  return r;
}
const readinessEvents = r => eventsOf(r).filter(e => e.event === 'readiness');
const rec = r => recordReadiness(r.t.rootDir, { work: r.t.work });
async function passA1(r) {
  const io = terminal([A1, 'y']);
  const code = await checkHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, args: [A1, 'pass'], flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 0, io.shown() + io.errors());
}

test('PLAN exit 1 (second half): the sitting records the verdict as it goes (incomplete, naming the agreement); recording a pass records ready; asking again with nothing changed appends nothing (the count is asserted)', async () => {
  const r = await finished();
  const afterSitting = readinessEvents(r);
  assert.ok(afterSitting.length >= 1, 'the sitting recorded the verdict after its steps');
  const last = afterSitting.at(-1);
  assert.equal(last.verdict, 'incomplete');
  assert.deepEqual(last.reasons.map(x => [x.code, x.scope]), [['integration_unrecorded', A1]]);
  assert.deepEqual(last.inputs.nodes.map(n => [n.node, n.generation, n.phase, n.passed, n.status]), [['R', 1, 'closed', true, 'ready_for_build'], ['R/M1', 1, 'closed', true, 'ready_for_build'], ['R/M2', 1, 'closed', true, 'ready_for_build'], ['R/M3', 1, 'closed', true, 'ready_for_build']]);
  assert.equal(eventShapeError({ schema: 'tree-events/1', id: 'e1', at: new Date().toISOString(), event: 'readiness', verdict: last.verdict, reasons: last.reasons, inputs: last.inputs }), null);
  for (let i = 0; i < 3; i += 1) assert.deepEqual([rec(r).appended, rec(r).verdict], [false, 'incomplete']);
  assert.equal(readinessEvents(r).length, afterSitting.length, 'nothing changed: no event, however often it is asked');
  await passA1(r);                                                               // the verb records the verdict itself (PLAN 9.2: after check)
  assert.equal(readinessEvents(r).length, afterSitting.length + 1);
  assert.deepEqual(readinessEvents(r).map(e => e.verdict).slice(-2), ['incomplete', 'ready']);
  assert.deepEqual(readinessEvents(r).at(-1).inputs.integrations.map(i => [i.target, i.result, i.current]), [[A1, 'pass', true]]);
  assert.equal(rec(r).appended, false); assert.equal(readinessEvents(r).length, afterSitting.length + 1);
});

test('an unchanged verdict can rest on CHANGED inputs (PLAN exit 1: a provider re-pinned and re-checked with the SAME verdict): ready at g1, both children regenerate and the agreement is checked again - ready again, one more ready event whose inputs differ; the reader returns the newest', async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  await passA1(r);
  assert.equal(readinessEvents(r).at(-1).verdict, 'ready');
  // a stop on the provider R/M1 regenerates R/M1 and (through the affected set) R/M2
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ record, state, runsDir: r.t.runsDir, node: 'R/M1' }).affected });
  const io = terminal([`The interface changes.\n.`, stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  approvePending(r); await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  await passA1(r);
  const ready = readinessEvents(r).filter(e => e.verdict === 'ready');
  assert.equal(ready.length, 2, 'ready twice: once for g1, once for g2');
  assert.notDeepEqual(ready[0].inputs, ready[1].inputs, 'on changed inputs');
  assert.deepEqual(ready[1].inputs.nodes.filter(n => n.node !== 'R').map(n => `${n.node}@g${n.generation}`), ['R/M1@g2', 'R/M2@g2', 'R/M3@g1']);
  const two = readinessEvents(r).at(-1);
  assert.equal(two.verdict, 'ready');
  assert.deepEqual(lastReadinessOf(readTreeRecord(r.t.rootDir)), { id: two.id, at: two.at, verdict: two.verdict, reasons: two.reasons, inputs: two.inputs });
});

test('sameReadiness compares the verdict, the reasons and the inputs - each alone is enough to differ - and nothing else (no id, no time)', () => {
  const a = { verdict: 'incomplete', reasons: [{ severity: 'incomplete', code: 'x', scope: 'R@g1', text: 't' }], inputs: { nodes: [{ node: 'R' }], integrations: [] } };
  assert.equal(sameReadiness(a, { ...a, id: 'e9', at: 'later' }), true, 'an id and a time are not compared');
  assert.equal(sameReadiness(a, { ...a, verdict: 'blocked' }), false);
  assert.equal(sameReadiness(a, { ...a, reasons: [{ ...a.reasons[0], text: 'other words' }] }), false, 'a changed reason under the same verdict and inputs');
  assert.equal(sameReadiness(a, { ...a, inputs: { nodes: [{ node: 'R', passed: true }], integrations: [] } }), false);
});

test('THE RACE: a verdict computed before another writer recorded something is not the one recorded - the record is read again inside the lock and the verdict recomputed (control: with one attempt the stale verdict is NOT written, nothing is)', async () => {
  const r = await finished();
  const bare = () => appendTreeEvent(r.t.rootDir, { event: 'integration_recorded', agreement: A1, result: 'pass' });   // another writer, between the computation and the lock
  const n0 = readinessEvents(r).length;
  // control: ONE attempt only - the record moved, so nothing is appended (a stale 'incomplete' must not land)
  let n = 0;
  const skipped = recordReadiness(r.t.rootDir, { work: r.t.work, attempts: 1, afterCompute: () => { if (n++ === 0) bare(); } });
  assert.deepEqual([skipped.appended, skipped.skipped], [false, 'record_moving']);
  assert.equal(readinessEvents(r).length, n0, 'the stale verdict was not recorded');
  // with attempts the verdict is computed AGAIN on the new record: the bare result is in the reasons that land
  const r2 = await finished();
  let m = 0;
  const landed = recordReadiness(r2.t.rootDir, { work: r2.t.work, afterCompute: () => { if (m++ === 0) appendTreeEvent(r2.t.rootDir, { event: 'integration_recorded', agreement: A1, result: 'pass' }); } });
  assert.equal(landed.appended, true);
  const e = readinessEvents(r2).at(-1);
  assert.match(e.reasons.find(x => x.scope === A1).text, /no current recorded pass/, 'the recorded reasons are from the NEW record (the bare event is in them), not the stale computation');
});

test('a record that does not read is never appended to here: a corrupt line gives record_unreadable and no readiness event, and nothing throws', async () => {
  const r = await finished();
  const n0 = readinessEvents(r).length;
  appendFileSync(join(treeDirOf(r.t.rootDir), EVENTS_FILE), 'this is not an event\n');
  const x = rec(r);
  assert.deepEqual([x.appended, x.skipped], [false, 'record_unreadable']);
  assert.equal(readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'readiness').length, n0, 'no readiness event was appended to the unreadable record');
  void readinessOf;
});

test('the readiness event shape: verdict is ready, incomplete or blocked; reasons is a list of { severity, code, scope, text }; inputs is an object - anything else is malformed', () => {
  const ok = { schema: 'tree-events/1', id: 'e9', at: new Date().toISOString(), event: 'readiness', verdict: 'ready', reasons: [], inputs: { nodes: [], integrations: [] } };
  assert.equal(eventShapeError(ok), null);
  for (const [field, value] of [['verdict', 'maybe'], ['verdict', undefined], ['reasons', 'none'], ['reasons', [{ code: 'x' }]], ['reasons', undefined], ['inputs', []], ['inputs', undefined]]) {
    assert.match(eventShapeError({ ...ok, [field]: value }) ?? '', new RegExp(`field "${field}"`), `${field}=${JSON.stringify(value)}`);
  }
});
