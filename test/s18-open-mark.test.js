// 0.8.4 S18 (spec l.1486, T21bm; C&C's F5 ruling): an objection of the final read that holds the sign-off stays OPEN on the record under the seat's name with its own rating (`final_read.seats[].failures[].open`, additive, ships), never deleted or re-rated, and goes to the build list as must-do (the HANDOFF section, A-DRAFT, committed like its neighbours: WORDING S18-w14c). It is NOT put into severity.open_at_end or dispute.open_objections (those are built before the final read, and a passed run with a text change after its sign-off would trip the passed_with_open_objection
// invariant on a legitimate state). Offline, mock seats, $0. The ends it arose at were a final edit (finalist) and a challenge changing the plan after a full sign-off (`!agreedAtPoint`); on the recorded wording neither runs at an agreed end, so the ONE-LAYER ROW below (test/helpers/one-layer-stated-pass.js) is where it arises now; the old finalist fixture (the helper `end`) is gone, and the build-list row runs on the named-pin ending (batch 1).
// THE ONE-LAYER ROW runs on the recorded wording (the build-check words live, a handler): its end is agreed at the point and neither stage runs, so its objection comes from a seat that stated a pass (test/helpers/one-layer-stated-pass.js). The build-list row below runs on the NAMED-PIN ending (batch 1, printed in job 159); the OLD ends (a finalist's final edit, a challenge) and their helper `end` are gone from this file. Written without a run (no tests on the laptop). The reds are the parent commit (no mark, no section) and a pure swapped input (V18-OM1).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as FR from '../src/final-read.js';   // a namespace import: a tree without openFinalReadRows still loads this file, and each row fails on its own
import { isAgreed } from '../src/ending.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';
import { W31 } from './helpers/w31-held.js';
import { oneLayerRun, OBJECTS } from './helpers/one-layer-stated-pass.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });
const newDefect = rating => ({ sort: 'must_do', reason: 'The worker never backs off.\nIt retries at once.', criterion: CRITERION, quote: 'retries failed requests', rating });

test('open mark (pure): an objection of the final read that holds the sign-off (rated 4 or above, or not rated) carries open: true with its own rating; one rated below 4 carries none', () => {
  const RATING = 5;
  const e = FR.readEntry({ lab: 'lc', layer: 3, label: 'final-read-lc', lastReadSha: null, reasked: false, critique: { meets: false, failures: [{ criterion: 'C', problem: 'P', quote: 'q', severity: RATING }, { criterion: 'C2', problem: 'P2', quote: 'q2', severity: 3 }, { criterion: 'C3', problem: 'P3', quote: 'q3' }] } });
  assert.deepEqual(e.failures.map(f => [f.severity ?? 'none', f.open === true]), [[RATING, true], [3, false], ['none', true]], 'rated 5 and not rated hold (open), rated 3 does not');
});

// CHANGED ACCEPTED TESTS (0.8.4 apply, C&C ruling 12 Nov 2026, part 3 item 3: SPLIT). OLD: two rows ('open mark, finalist end' and '... challenge end'): a full sign-off in pass 1, then the plan changes (a finalist's final edit, or the challenge stage), layer 3's seat lc reads the new text and objects with a quoted defect rated 5; b1 passed true, b2 both top seats read it again, b3 [severity 5, open true, not_debated true], b4 isAgreed false, b5 the run wrote a build list (HANDOFF), b6 its "## Objections of the final read (open)" section.
// Red on the tip (job 128: b2 :45, "the plan changed after the sign-off, so both top seats read it again"): with the build-check wording recorded `passed` true implies agreedAtPoint, so neither the final edit nor the challenge runs at an agreed end (chain.js:7660, 7601). The skip is pinned by test/build-check.test.js: the 'Q-i1 (permanent)' row at :154 (the handler form: after good_to_build the challenge and the final edit are not served) and T21d at :171 (the no-handler form); the dispute rewrite's skip is read, not driven. NEW (A1, b1-b4): ONE row on the one-layer stated-pass end (test/helpers/one-layer-stated-pass.js; printed jobs 124, 127, 135): seat-b states a pass, then reads the final plan and objects (a rated-5 failure): b1 passed true, b2 the top seats that read it = [seat-b] (seat-a was reused),
// b3 [severity 5, open true, not_debated true] (printed, job 127), b4 isAgreed false. COLLAPSE: the finalist and challenge kinds differ only in WHICH stage changes the text, and neither runs at an agreed end (the gate above), so the two kinds are one row. HELD (b5, b6: bin 3, pinned nowhere else): the build-list section; no leg printed a handoff at the NAMED-PIN ending, so they stay in ONE retained row below, RED on the tip until that print (named in the commit message as a carried red). ROW COUNT: 2 rows -> 2 rows (one new one-layer row, one retained hold row); the file's other three stay.
test('open mark, one layer (a stated pass): seat-b reads the final plan and objects: the objection stays open on the record with its rating, the run is not agreed although every layer signed', async () => {
  setHeldForTest(null);   // the fixture the jobs printed: no sorting held, the objection is a failure of the reply
  const r = await oneLayerRun({ finalRead: OBJECTS });
  assert.equal(r.result.passed, true, 'premise: every layer signed off');
  assert.deepEqual(r.result.finalRead.seats.map(e => e.lab).sort(), ['seat-b'], 'premise: seat-b had stated a pass, so it is the one top seat that reads the final plan (seat-a was reused)');
  const f = (r.result.finalRead.seats.find(e => e.lab === 'seat-b')?.failures ?? [])[0];
  assert.ok(f, 'premise: seat-b objected at the final read');
  assert.deepEqual([f.severity, f.open, f.not_debated], [5, true, true], 'T21bm: open under the seat\'s name with its rating unchanged at 5.0');
  assert.equal(isAgreed(r.result), false, 'premise: the objection holds, so the run is not agreed');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, batch 1; C&C's part 3 item 3 hold, released by the print of job 159). OLD ('open mark, build list (HELD, b5 and b6)'): the run came from end('finalist') (a full sign-off, then the final edit changes the plan, lc reads it and objects); b5 the run wrote a build list (HANDOFF), b6 its "## Objections of the final read (open)" section carried the objection as must-do, the whole intro sentence and the line pinned in one regex.
// Red on the tip (job 128): the final edit is skipped at an agreed end (agreedAtPoint, chain.js:7660), so lc was never owed a read. NEW: the NAMED-PIN ending of the row below (no handling session, la's rated objection stands, the cut at revise-1 ends the run by rule, the final read runs and lc objects with a new defect rated 5 on its own passage) with `handoff: true` and nothing else (printed, job 159, B5B6-plain: handoff a string, the section found, the line "- O-923dba21 (raised by lc; rated 5.0; sorted must-do by its seat): <criterion>: The worker never backs off. It retries at once."). The section's INTRO sentence is no longer pinned: it was moved by f60ebad2 (the reviewed v2 text) and a test that pins a sentence is not kept (Muad, 12 Nov 2026: "I don't see why we would need a test that pins wording. That is not a test, that is bloat."); what the row keeps is what the run does: the build list is written, the section is there, it names the objection's id, its rating, that the seat sorted it must-do, and its problem as one line.
// WHY: the same subject (the final read's open objection reaches the build list as must-do) on an ending a run can have. RED: the objection rated 3 instead of 5 (it is not open, so no section): the section assert fails. Chain: test/helpers/layer-two-run.js `scenario` (not a chains/ file); differences from chains/plan-mini-council.json: four judges in 3 layers (plan: 3 layers, 8 judges), no ladder key, no dispute stage, no decisions/proposals/personas, no handling session, default handoff seat (plan: external), held SORTING + W31, scripted cache.
test('open mark, build list (the named-pin ending, handoff true): the run writes a build list and its "Objections of the final read (open)" section carries the objection as must-do', async () => {
  setHeldForTest({ ...SORTING, ...W31 });
  setOutboundScan({ finish: true });
  let r;
  try { r = await scenario({ answerBack: true, l1Severity: 5, critics: L3, handler: false, overrides: { 'final-read-lc': metWith([newDefect(5)]), 'final-read-ld': MET }, extra: { handoff: true }, cutLabels: ['revise-1'] }); } finally { setOutboundScan({}); }
  const f = (r.result.finalRead.seats.find(e => e.lab === 'lc')?.failures ?? [])[0];
  assert.ok(f, 'premise: lc objected at the final read');
  assert.equal(typeof r.result.handoff, 'string', 'premise: the run wrote a build list (HANDOFF)');
  const at = r.result.handoff.indexOf('## Objections of the final read (open)');
  assert.ok(at >= 0, 'the build list has the section for the final read\'s open objections');
  const lines = r.result.handoff.slice(at).split('\n').filter(l => l.startsWith('- '));
  assert.equal(lines.length, 1, 'one line: the objection');
  assert.ok(lines[0].startsWith(`- ${f.id} (raised by lc; rated 5.0; sorted must-do by its seat): `), 'the line names the id, the seat, the rating and that the seat sorted it must-do');
  assert.ok(lines[0].endsWith(`${CRITERION}: The worker never backs off. It retries at once.`), 'and carries the criterion and the problem as one line (the model\'s newline collapsed)');
});

test('open mark (NAMED PIN, green on the parent; FAIL CONDITION: the final-read objection\'s NEW id (not a climb objection restated, test/s18-restated-objection.test.js) appears in severity.open_at_end or dispute.open_objections, or severityRun.invariant is set): not in severity.open_at_end or dispute.open_objections (built before the final read; the passed_with_open_objection invariant would fire on a legitimate state)', async () => {
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'open mark (NAMED PIN, ...'): OLD: the run came from end('finalist') (a full sign-off in pass 1, then the final edit changes the plan, lc reads it and objects). NEW: the run is the person-less not-agreed end of test/s18-no-wait.test.js T21cb (no handling session: la's rated objection stands, the cut at revise-1 ends the run by rule, the final read runs next and lc objects with a new defect rated 5 on its own passage; lc has no climb objection, so the id is NEW). WHY: error "Cannot read properties of undefined (reading 'failures')" at r.result.finalRead.seats.find(e => e.lab === 'lc').failures[0] (test line 56): the run never read lc. The build check is live (buildCheckLive, src/chain.js:7305): with no handling session a full sign-off ends the run AGREED at the point, so neither the final edit nor the challenge runs (agreedAtPoint, src/chain.js:7305, 7586-7590, 7649) and the final read has nothing to read again; this file's own header says so ('Do NOT inject the build-check words here ...'). The two whole-run rows above ('open mark, finalist end' / 'open mark, challenge end') are red for the same cause and are not changed here. The pin's FAIL CONDITION is unchanged and still reachable: a final-read objection with a NEW id that must not be in severity.open_at_end or dispute.open_objections.
  setHeldForTest({ ...SORTING, ...W31 });
  setOutboundScan({ finish: true });
  let r;
  try { r = await scenario({ answerBack: true, l1Severity: 5, critics: L3, handler: false, overrides: { 'final-read-lc': metWith([newDefect(5)]), 'final-read-ld': MET }, extra: {}, cutLabels: ['revise-1'] }); } finally { setOutboundScan({}); }
  const f = r.result.finalRead.seats.find(e => e.lab === 'lc').failures[0];
  assert.deepEqual([f.severity, f.open], [5, true], 'premise: lc objected at the final read with a new defect that holds the sign-off, rated 5');
  assert.equal((r.result.severityRun?.open || []).some(o => o.id === f.id), false, 'not in the severity record');
  assert.equal(r.result.severityRun?.invariant, undefined, 'no invariant fires on this state');
  assert.equal((r.result.dispute?.open_objections || []).some(o => o.id === f.id), false, 'not in the dispute list');
});

// no red of its own on the parent (FR.openFinalReadRows does not exist there: a TypeError): its red rides on the two whole-run rows above, which assert the same section end to end
test('open mark (pure): openFinalReadRows reads the record\'s own mark', () => {
  const rec = { ran: true, seats: [{ lab: 'lc', read: true, failures: [{ id: 'O-1', criterion: 'C', problem: 'a\nb', severity: 5, open: true }, { id: 'O-2', criterion: 'C', problem: 'x', severity: 3 }] }, { lab: 'ld', read: false, why: 'no reply' }] };
  assert.deepEqual(FR.openFinalReadRows(rec), [{ id: 'O-1', seat: 'lc', rating: 5, criterion: 'C', problem: 'a b' }]);
});
