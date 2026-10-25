// The restore gap, commit 1 (0.8.3 M6; gate page Review/Build_0.8.3/m6-closing/Restore_Gap_Gate_Page.md sections 3, 7 and 8; Astra #16-#18). `stop_restored` is a SYSTEM record (actor 'sitting') that answers ONE open blocked-source stop
// whose cause was an unreadable report.json, when the files on disk hash, byte for byte, to what the tree RECORDED at the node's close. Real all-mock trees on the milestone mock, $0: a real sitting opens the stop, the files are damaged and
// restored by this test, restoreClosedStops (src/tree-restore.js) is called directly (the sitting wiring is commit 2). The table rows (R9) hand-write the candidate event against the REAL fold, and each asserts its OWN reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../src/thin-contract.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { EVENT_NAMES, RESTORABLE_CODES, eventShapeError, transitionRefusal } from '../src/tree-transitions.js';
import { restoreClosedStops, restoreDecision, snapshotOfRun } from '../src/tree-restore.js';
import { runTree } from '../src/tree-run.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { presenceProblems } from './helpers/event-presence.js';
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
const nodeOf = (r, node) => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
const fileOf = (r, node, name) => join(r.t.runsDir, nodeOf(r, node).runId, name);
/** Damages report.json (not JSON) and returns the original bytes, so the test can put them back. */
function damage(r, node) { const f = fileOf(r, node, 'report.json'); const original = readFileSync(f, 'utf8'); writeFileSync(f, '{ not json'); return original; }
const restore = (r, node, original) => writeFileSync(fileOf(r, node, 'report.json'), original);
const sitting = (r, start) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
const blockedStops = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked');
const restored = r => eventsOf(r).filter(e => e.event === 'stop_restored');
const openStopIds = r => stateOf(readTreeRecord(r.t.rootDir)).openStops;
const run = r => restoreClosedStops(r.t.rootDir, { runsDir: r.t.runsDir });

test('R1 (REAL): a node whose report.json was unreadable opens a blocked stop; the SAME bytes put back close it by one stop_restored (actor sitting, the record-held hash, the snapshot\'s hash), recorded, with nothing else written (no money, no decision), and a further call writes nothing', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const original = damage(r, 'R/M2');
  await sitting(r, start);
  const [stop] = blockedStops(r);
  assert.deepEqual([stop.node, stop.blockedBy.map(b => b.code)], ['R/M2', ['report_unreadable']]);
  assert.deepEqual(run(r).map(x => [x.stopId, x.restored, x.why]), [[stop.id, false, 'still_unreadable']], 'a still-damaged file closes nothing');
  assert.equal(restored(r).length, 0);
  restore(r, 'R/M2', original);
  const before = eventsOf(r).length; const held = nodeOf(r, 'R/M2').deliveredBodySha256;
  assert.match(held, /^[0-9a-f]{64}$/, 'the closure holds the body hash');
  assert.deepEqual(run(r), [{ stopId: stop.id, node: 'R/M2', generation: 1, restored: true }]);
  const added = eventsOf(r).slice(before);
  assert.deepEqual(added.map(e => e.event), ['stop_restored'], 'ONE record, nothing else: no grant, no gate, no decision');
  const [ev] = added;
  assert.deepEqual([ev.actor, ev.stopId, ev.node, ev.generation, ev.runId, ev.deliveredBodySha256, ev.observedBodySha256], ['sitting', stop.id, 'R/M2', 1, nodeOf(r, 'R/M2').runId, held, held]);
  assert.equal(ev.thinContractSha256, nodeOf(r, 'R/M2').thinContractSha256, 'the closure\'s thin-contract pin is carried when it holds one');
  assert.deepEqual(openStopIds(r), [], 'the stop is no longer open');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).restoredStops.get(stop.id), ev.id);
  assert.deepEqual(run(r), [], 'idempotent: nothing open, nothing written'); assert.equal(eventsOf(r).length, before + 1);
  assert.equal(eventsOf(r).some(e => e.event === 'decision_recorded'), false, 'it is not a person\'s decision');
});

test('R6 + R11 (REAL): two damaged nodes, two stops (R/M2 depends on R/M1, so its stop ALSO names provider_pin); restoring R/M1 closes ONLY its stop - the other stays open, its node stays stale-marked by its own stop, and once its own file is back too, the dependent\'s stop closes with the provider pins it re-read; a restored node damaged AGAIN opens a NEW stop', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const o1 = damage(r, 'R/M1'); const o2 = damage(r, 'R/M2');
  await sitting(r, start);
  const stops = Object.fromEntries(blockedStops(r).map(e => [e.node, e.id]));
  assert.deepEqual(blockedStops(r).map(e => [e.node, e.blockedBy.map(b => b.code)]), [['R/M1', ['report_unreadable']], ['R/M2', ['provider_pin', 'report_unreadable']]]);
  // D2 F13j S14 (A-DRAFT; lane T, G5+6; B3c): the dependent's stop names the free restore of its provider's files, through the real gather (src/tree-stop-view.js pinProviders from the registration's pins). RED at f7ccc764: no such line
  // (the provider_pin restore was not printed, D1a B3c); R/M1's own stop names no provider_pin, so it gets none
  assert.ok(needsDecisionStopText(r.t.rootDir, blockedStops(r).find(e => e.node === 'R/M2')).split('\n').includes('  Put the run files of R/M1@g1 back as its run wrote them: the next `council tree resume` closes this stop by itself when its thin contract reads as the one R/M2 was registered against.'));
  assert.equal(needsDecisionStopText(r.t.rootDir, blockedStops(r).find(e => e.node === 'R/M1')).includes('Put the run files of'), false);
  restore(r, 'R/M1', o1);
  const out = run(r);
  assert.deepEqual(out.map(x => [x.node, x.restored, x.why ?? null]), [['R/M1', true, null], ['R/M2', false, 'still_unreadable']]);
  assert.deepEqual(openStopIds(r), [stops['R/M2']], 'only the restored node\'s stop closed');
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.stale.has('R/M2@g1'), true, 'the node of the still-open stop stays in question');
  assert.equal(st.stale.has('R/M1@g1'), false, 'the restored node\'s own marks are released');
  restore(r, 'R/M2', o2);
  assert.deepEqual(run(r).map(x => [x.node, x.restored]), [['R/M2', true]], 'its own file is back AND the provider it registered against reads the pin it registered against: the dependent\'s stop closes by itself (C&C ruling 1, option (b))');
  const [e2] = restored(r).slice(-1); const m1 = nodeOf(r, 'R/M1');
  assert.deepEqual(e2.providerPins, [{ node: 'R/M1', generation: 1, boundThinContractSha256: m1.thinContractSha256, observedThinContractSha256: m1.thinContractSha256 }]);
  assert.equal(restored(r).length, 2); assert.deepEqual(openStopIds(r), []);
  assert.deepEqual(presenceProblems(restored(r)), [], 'the presence audit: the dependent\'s event carries its providerPins');
  // R11: the restored node is damaged AGAIN
  damage(r, 'R/M1');
  await sitting(r, start);
  const again = blockedStops(r).filter(e => e.node === 'R/M1');
  assert.equal(again.length, 2, 'a NEW stop for R/M1 opened after the restore'); assert.notEqual(again[0].id, again[1].id);
  // the dependent is now in question again: R/M1's pin reads differently, so R/M2 gets a NEW provider_pin stop of its own (its own file is fine)
  const stopsNow = blockedStops(r).slice(-2);
  assert.deepEqual(stopsNow.map(e => [e.node, e.blockedBy.map(b => b.code)]), [['R/M1', ['report_unreadable']], ['R/M2', ['provider_pin']]]);
  assert.deepEqual(openStopIds(r), stopsNow.map(e => e.id));
});

test('R2 + R4 (REAL, the red rows): a swapped deliverable.md beside a swapped report.json whose body_sha256 MATCHES the swapped body is a different hash than the record holds: the stop stays open (the comparison is to the RECORD, never to the report); a changed deliverable beside the original report stays open too', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const repFile = fileOf(r, 'R/M2', 'report.json'); const delFile = fileOf(r, 'R/M2', 'deliverable.md');
  const origReport = readFileSync(repFile, 'utf8'); const origDel = readFileSync(delFile, 'utf8');
  writeFileSync(repFile, '{ not json');
  await sitting(r, start);
  const [stop] = blockedStops(r);
  // R4: report.json back as it was, deliverable.md changed
  writeFileSync(repFile, origReport); writeFileSync(delFile, `${origDel}\nChanged after the close.\n`);
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'plan_unreadable']], 'the report\'s hash no longer matches the file: nothing is closed');
  // R2: swapped deliverable AND a report whose own body_sha256 matches it
  const rep = JSON.parse(origReport); const text = `${origDel}\nSwapped body.\n`;
  const notes = rep.delivered_text.harness_notes.length; const at = notes === 0 ? 0 : [...text.matchAll(/^---\n/gm)][0].index + 4;
  rep.delivered_text.body_sha256 = sha256Of(text.slice(at));
  writeFileSync(delFile, text); writeFileSync(repFile, JSON.stringify(rep));
  const snap = snapshotOfRun(r.t.runsDir, nodeOf(r, 'R/M2').runId);
  assert.equal(snap.observedBodySha256, rep.delivered_text.body_sha256, 'the swapped pair is self-consistent: only the RECORD can tell');
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'body_differs']]);
  assert.deepEqual(openStopIds(r), [stop.id]); assert.equal(restored(r).length, 0);
  // and the original files, put back, close it (the red rows above were red for the right reason)
  writeFileSync(repFile, origReport); writeFileSync(delFile, origDel);
  assert.deepEqual(run(r).map(x => x.restored), [true]);
});

test('R3 (REAL): a closure WITHOUT the recorded body hash (an older closure) is never guessed: the stop stays open, the answer path is untouched; a thin-contract or passed/status that differs from the closure also leaves it open', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const original = damage(r, 'R/M2');
  await sitting(r, start);
  const [stop] = blockedStops(r);
  restore(r, 'R/M2', original);
  // thin contract differs from the one the closure holds
  const rep = JSON.parse(original); rep.thin_contract = { ...rep.thin_contract, sha256: 'f'.repeat(64) }; writeFileSync(fileOf(r, 'R/M2', 'report.json'), JSON.stringify(rep));
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'thin_contract_differs']]);
  const rep2 = JSON.parse(original); rep2.passed = !rep2.passed; writeFileSync(fileOf(r, 'R/M2', 'report.json'), JSON.stringify(rep2));
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'closure_differs']]);
  restore(r, 'R/M2', original);
  // an older closure: the field removed from the REAL recorded line (a test-only edit of a real record, disclosed in the report)
  const file = join(r.t.rootDir, 'tree', 'events.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').map(l => { if (!l) return l; const e = JSON.parse(l); if (e.event === 'node_closed' && e.node === 'R/M2') delete e.deliveredBodySha256; return JSON.stringify(e); });
  writeFileSync(file, lines.join('\n'));
  assert.equal(nodeOf(r, 'R/M2').deliveredBodySha256, null);
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'no_recorded_hash']]);
  assert.deepEqual(openStopIds(r), [stop.id]); assert.equal(restored(r).length, 0);
});

test('R5 (REAL): a stop with a code beside (or instead of) the file code is untouched - a lint finding (status_policy) and a hand-opened split_unreadable stop on a body that matches the record stay open; the restorable set is pinned (each code with its own live test)', { timeout: 400_000 }, async () => {
  // CHANGED ACCEPTED TEST (lane T, G2, D2 F4c; Q2 "Yes to all"): the restorable set grows by four codes, each with its own live test (src/tree-restore.js); the two codes this test is about (status_policy, split_unreadable) stay out, unchanged
  assert.deepEqual([...RESTORABLE_CODES], ['report_unreadable', 'plan_unreadable', 'provider_pin', 'split_changed', 'contract_check', 'expansion_refused', 'derivation_refused']);
  const { r, start } = await finished();
  const f = fileOf(r, 'R/M2', 'report.json'); const original = readFileSync(f, 'utf8');
  const rep = JSON.parse(original); rep.handoff_milestones = { ...rep.handoff_milestones, findings: [{ kind: 'unknown_criterion', message: 'M0 names C3' }] }; writeFileSync(f, JSON.stringify(rep));
  await sitting(r, start);
  const [stop] = blockedStops(r);
  assert.deepEqual(stop.blockedBy.map(b => b.code), ['status_policy']);
  writeFileSync(f, original);                                                    // the file is back as the run produced it, but the stop is about a lint code
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'other_reason']]);
  // split_unreadable: the body hashes to the record, so the fence parses the same as it did: a restored file cannot close it
  const n = nodeOf(r, 'R/M1');
  const sp = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: n.runId, source: 'blocked', blockedBy: [{ code: 'split_unreadable', text: 'its plan holds a split fence that does not read' }], affected: [{ node: 'R/M1', generation: 1 }] });
  assert.deepEqual(run(r).map(x => [x.stopId, x.restored, x.why]), [[stop.id, false, 'other_reason'], [sp.id, false, 'other_reason']]);
  assert.equal(restored(r).length, 0); assert.equal(openStopIds(r).length, 2);
});

test('R9 (the table, REAL fold): a hand-written stop_restored is refused with ITS OWN reason for each wrong shape - not open, not a blocked stop, another node, a code outside the set, a hash that is not the record\'s, a thin contract that is not the closure\'s, an older closure - and a malformed one fails the shape check; an accepted one is the real one', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const original = damage(r, 'R/M2');
  await sitting(r, start);
  const [stop] = blockedStops(r);
  restore(r, 'R/M2', original);
  const n = nodeOf(r, 'R/M2'); const held = n.deliveredBodySha256;
  const good = { event: 'stop_restored', actor: 'sitting', stopId: stop.id, node: 'R/M2', generation: 1, runId: n.runId, deliveredBodySha256: held, observedBodySha256: held, thinContractSha256: n.thinContractSha256 };
  const refusal = (over, state = stateOf(readTreeRecord(r.t.rootDir))) => transitionRefusal(state, { ...good, ...over })?.reason ?? null;
  assert.equal(refusal({}), null, 'the real event is accepted');
  assert.match(refusal({ stopId: 'e999' }), /is not an open stop/);
  assert.match(refusal({ node: 'R/M1' }), /is about R\/M2@g1 .*, not R\/M1@g1/);
  assert.match(refusal({ runId: 'other-run' }), /is about R\/M2@g1/);
  assert.match(refusal({ deliveredBodySha256: 'a'.repeat(64) }), /the event names plan body hash aaaaaaaaaaaa, the record holds hash/);
  assert.match(refusal({ observedBodySha256: 'b'.repeat(64) }), /the file on disk hashes to bbbbbbbbbbbb.* a changed file is not closed by the sitting/);
  assert.match(refusal({ thinContractSha256: 'c'.repeat(64) }), /thin contract on disk \(cccccccccccc\) is not the one the node closed with/);
  assert.match(refusal({ thinContractSha256: undefined }), /thin contract on disk \(none\) is not the one the node closed with/);
  assert.match(eventShapeError({ schema: readTreeRecord(r.t.rootDir).events[0].schema, id: 'e9999', at: new Date().toISOString(), ...good, actor: 'person' }), /stop_restored: field "actor" is missing or malformed/);
  assert.match(eventShapeError({ schema: readTreeRecord(r.t.rootDir).events[0].schema, id: 'e9999', at: new Date().toISOString(), ...good, observedBodySha256: 'xyz' }), /field "observedBodySha256"/);
  // a stop of another source, another code, an older closure: built on the same real record
  const other = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: nodeOf(r, 'R/M1').runId, source: 'status', affected: [{ node: 'R/M1', generation: 1 }] });
  const m1 = nodeOf(r, 'R/M1');
  assert.match(refusal({ stopId: other.id, node: 'R/M1', runId: m1.runId, deliveredBodySha256: m1.deliveredBodySha256, observedBodySha256: m1.deliveredBodySha256, thinContractSha256: m1.thinContractSha256 }), /is a status-source stop, not a blocked-child stop/);
  const lint = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M3', generation: 1, runId: nodeOf(r, 'R/M3').runId, source: 'blocked', blockedBy: [{ code: 'report_unreadable', text: 'x' }, { code: 'status_policy', text: 'y' }], affected: [{ node: 'R/M3', generation: 1 }] });
  const m3 = nodeOf(r, 'R/M3');
  assert.match(refusal({ stopId: lint.id, node: 'R/M3', runId: m3.runId, deliveredBodySha256: m3.deliveredBodySha256, observedBodySha256: m3.deliveredBodySha256, thinContractSha256: m3.thinContractSha256 }), /names status_policy: a restored file closes a stop only for report_unreadable, plan_unreadable, provider_pin/);
  const state = stateOf(readTreeRecord(r.t.rootDir)); state.nodes.get('R/M2@g1').deliveredBodySha256 = null;       // an older closure, folded
  assert.match(refusal({}, state), /closed without a recorded hash of its plan body/);
  assert.equal(EVENT_NAMES.includes('stop_restored'), true);
});

test('PIN: a stop that is not in the fold is not restored (restoreDecision answers not_a_blocked_stop before it looks at any file)', () => {
  const state = { stopMeta: new Map(), openStops: [], nodes: new Map() };
  assert.deepEqual(restoreDecision({ state, stop: { id: 'e1', node: 'R/M1', generation: 1, runId: 'x' }, snapshot: { unreadable: 'x' } }), { restore: false, why: 'not_a_blocked_stop' });
});

test('plan_unreadable (REAL, gate page 9.2): a stop whose cause is a MISSING deliverable.md closes when the same file is put back (the same body-hash test as report_unreadable); a changed one does not', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const f = fileOf(r, 'R/M2', 'deliverable.md'); const original = readFileSync(f, 'utf8');
  renameSync(f, `${f}.away`);
  await sitting(r, start);
  const [stop] = blockedStops(r);
  assert.deepEqual([stop.node, stop.blockedBy.map(b => b.code)], ['R/M2', ['plan_unreadable']]);
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'plan_unreadable']]);
  writeFileSync(f, `${original}\nChanged.\n`);
  assert.deepEqual(run(r).map(x => [x.restored, x.why]), [[false, 'plan_unreadable']], 'a changed plan is not the plan the run produced');
  writeFileSync(f, original);
  assert.deepEqual(run(r).map(x => [x.restored]), [[true]]);
  assert.deepEqual(openStopIds(r), []); assert.equal(restored(r)[0].providerPins, undefined, 'a stop with no provider_pin carries no provider pins');
});

// The provider_pin table rows (gate page 9.3), each its OWN test(), one shared real fixture: R/M1 and R/M2 damaged, the stops open, then both files put back. Each candidate is appended to the REAL record's fold and must be refused with ITS OWN reason.
let fixture;
const shared = () => (fixture ??= (async () => {
  const { r, start } = await finished();
  const o1 = damage(r, 'R/M1'); const o2 = damage(r, 'R/M2');
  await sitting(r, start);
  restore(r, 'R/M1', o1); restore(r, 'R/M2', o2);
  const state = stateOf(readTreeRecord(r.t.rootDir));
  const stop = blockedStops(r).find(e => e.node === 'R/M2'); const m1 = nodeOf(r, 'R/M1'); const m2 = nodeOf(r, 'R/M2');
  const pin = { node: 'R/M1', generation: 1, boundThinContractSha256: m1.thinContractSha256, observedThinContractSha256: m1.thinContractSha256 };
  const good = { event: 'stop_restored', actor: 'sitting', stopId: stop.id, node: 'R/M2', generation: 1, runId: m2.runId, deliveredBodySha256: m2.deliveredBodySha256, observedBodySha256: m2.deliveredBodySha256, thinContractSha256: m2.thinContractSha256, providerPins: [pin] };
  return { r, state, stop, good, pin, m1, m2 };
})());
const why = async over => { const f = await shared(); return transitionRefusal(over.__state ?? f.state, { ...f.good, ...over, __state: undefined })?.reason ?? null; };
test('provider_pin row: the real event is accepted', async () => { assert.equal(await why({}), null); });
test('provider_pin row: a stop that names provider_pin without providerPins is refused', async () => { assert.match(await why({ providerPins: undefined }), /names provider_pin: the event must carry the provider pins it re-read/); });
test('provider_pin row: a pin the dependent never registered against is refused', async () => { const f = await shared(); assert.match(await why({ providerPins: [f.pin, { ...f.pin, node: 'R/M3' }] }), /never registered against \(R\/M3@g1\)/); });
test('provider_pin row: a registered pin the event did not re-read is refused', async () => { assert.match(await why({ providerPins: [{ node: 'R/M3', generation: 1, boundThinContractSha256: 'a'.repeat(64), observedThinContractSha256: 'a'.repeat(64) }] }), /R\/M1@g1 is pinned by R\/M2@g1 and the event re-read no pin of it/); });
test('provider_pin row: a bound pin that is not the registration\'s is refused', async () => { const f = await shared(); assert.match(await why({ providerPins: [{ ...f.pin, boundThinContractSha256: 'b'.repeat(64), observedThinContractSha256: 'b'.repeat(64) }] }), /the bound pin of R\/M1@g1 in the event \(hash bbbbbbbbbbbb\) is not the one R\/M2@g1 registered against/); });
test('provider_pin row: an observed pin that differs from the bound one (the pin has not come back) is refused', async () => { const f = await shared(); assert.match(await why({ providerPins: [{ ...f.pin, observedThinContractSha256: 'c'.repeat(64) }] }), /reads hash cccccccccccc, not the hash .* R\/M2@g1 registered against: the pin has not come back/); });
test('provider_pin row: a provider that has moved past the generation registered against is refused', async () => {
  const f = await shared(); const state = stateOf(readTreeRecord(f.r.t.rootDir)); state.nodes.set('R/M1@g2', { ...state.nodes.get('R/M1@g1'), generation: 2 });
  assert.match(await why({ __state: state }), /provider R\/M1 has moved past generation 1/);
});
test('provider_pin row: a stop with no provider_pin must not carry provider pins', async () => {
  const f = await shared(); const m1stop = blockedStops(f.r).find(e => e.node === 'R/M1');
  assert.match(transitionRefusal(f.state, { ...f.good, stopId: m1stop.id, node: 'R/M1', runId: f.m1.runId, deliveredBodySha256: f.m1.deliveredBodySha256, observedBodySha256: f.m1.deliveredBodySha256, thinContractSha256: f.m1.thinContractSha256 })?.reason ?? '', /names no provider_pin, so it carries no provider pins/);
});
