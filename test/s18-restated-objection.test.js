// 0.8.4 S18 (C&C's ruling of 09 Nov 2026, a defect found in merged S16 code by the first box run of s18-sort-wait; the owner's 29 Okt "layer 3 signs off"): a layer-3 seat that objected in the climb and, at the final read, sorts a MUST-DO on the same criterion and passage
// has restated its own objection. src/final-read.js finalReadObjections gives such an entry no new id (Q12) but used to throw the seat's word away: the seat read as `meets: true`, `failures: []`, "no objection" in the deliverable, and S18's split of the overseer layer
// would have called it a seat that SIGNED. Now the entry is recorded as that seat's failure on the TAKEN id with the reason, passage and rating it gave; the seat does not read as clearing; the climb objection keeps its own rating.
// Offline, mock seats, $0. Fixture: the probe/sort-wait scenario (copied; no *.test.js file is imported). Namespace import of src/final-read.js, so a tree without the new behaviour still loads this file and each assertion fails on its own. Written without a run (no tests on the laptop).
// Red: the parent src (298d17f0) at the first assertion (lc's failures are empty there: probe A of 09 Nov 2026) and the swapped-input variant V18-NV11 (S18_SWAPS.json: another passage, so a NEW id).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';
import { setHeldForTest } from '../src/held-roles.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { isAgreed } from '../src/ending.js';
import * as FR from '../src/final-read.js';
import { SORTING } from './helpers/rating-demand.js';
import { W31 } from './helpers/w31-held.js';
import { scenario, CRITERION, failureOf, checkAnswerOf } from './helpers/layer-two-run.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const OBJ5 = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });
const REWRITE = 'The worker retries failed requests up to five times, with a pause between tries.';
const CRITICS = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const escapeRe = t => t.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');   // the handler's reasons typed as data, matched whole

test('a layer-3 seat that sorts a must-do on the passage of its own earlier objection is recorded as objecting again, on the same id, with the rating it gave; it does not read as signing, the run is not agreed, and the climb rating is untouched', async () => {
  const PASSAGE = 'retries failed requests';   // the passage of lc's climb objection (failureOf): the same criterion and passage, so the same id
  const RATING = 7;   // what lc rates the restated must-do at the final read (its climb rating is 5)
  setHeldForTest({ ...SORTING, ...W31 });
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'a layer-3 seat that sorts a must-do'): OLD: the handler's `sort-1` was not scripted (the sort wait was held, so nothing waited). NEW: the handling session answers the sort wait (`sort-1`: must_do, its reasons naming the restated objection's id, which is lc's climb id: the same criterion and passage). WHY: the TAP's error line 'waiting for external stage sort-1' (thrown by askHandlerSort, src/chain.js:4959, called at src/chain.js:7845): with handlerSortSystem/handlerSortUser recorded, a not-agreed end with a handling session where one top seat objects and the other signed waits for the handler's sorting (src/chain.js:7835). The shipped path is the handler's sort-1 answer, as test/s18-sort-wait.test.js go() scripts it.
  const SORT_REASONS = `${objectionId('lc', failureOf(5))}: this one holds.`;
  const opts = { answerBack: true, handler: true, critics: CRITICS, extra: { maxOverseerRounds: 1, dispute: { enabled: true, stall_rounds: 2 } },
    overrides: { 'panel-1-la': MET, 'panel-1-lc': OBJ5, dispute: REWRITE, 'final-read-lc': metWith([{ sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: PASSAGE, rating: RATING }]), 'final-read-ld': MET, 'sort-1': JSON.stringify({ sort: 'must_do', reasons: SORT_REASONS }) } };
  let first = null;
  try { await scenario(opts); } catch (e) { if (e instanceof RoundStopped) first = e; else throw e; }
  assert.equal(first?.stop?.kind, 'overseer_cap', 'premise: the climb stops at the overseer-round limit');
  const { result } = await scenario({ ...opts, runExtra: { roundChoices: [roundChoiceEntry(first.stop, 'finish', null)] } });
  const climb = (result.dispute?.open_objections || []).find(o => (o.seat ?? o.lab) === 'lc');
  assert.ok(climb, 'premise: lc\'s objection of the climb is open in the dispute record');
  assert.equal(result.finalRead.run_end, 'not_agreed', 'premise: the run ends without agreement');
  const lc = result.finalRead.seats.find(e => e.lab === 'lc');
  assert.deepEqual([lc.meets, (lc.failures || []).map(f => [f.id, f.severity, f.open, f.problem, f.quote])], [false, [[climb.id, RATING, true, 'The worker never backs off.', PASSAGE]]],
    'lc\'s must-do on its own passage is recorded as its objection on the SAME id, with its reason, passage and rating (no new id, nothing thrown away)');
  assert.deepEqual([isAgreed(result), result.passed, result.finalRead.basis], [false, false, 'final_read_objection'], 'the seat holds an open must-do, so the run is not agreed');
  assert.doesNotMatch(result.deliverable, /### lc: no objection/, 'the deliverable no longer says lc raised no objection');
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'a layer-3 seat that sorts a must-do'): OLD: the line ended at 'The worker never backs off.' (`$`). NEW: the same line carries the handling session's note after it, whole: ' The handling session sorted it must-do (ld signed this text): <the handler's reasons>' (both anchors kept; the literal is typed, not built from the code). WHY: with the handler's sort row on the record (final_read.sorting, by 'handler') src/final-read.js:224 appends handlerNoteOf (src/final-read.js:197) to the objection line; precedent: test/s18-sort-wait.test.js 'T21bi (the people\'s copies)' pins the same note as a literal.
  assert.match(result.deliverable, new RegExp(`^- "The plan defines a retry limit\\.": The worker never backs off\\. The handling session sorted it must-do \\(ld signed this text\\): ${escapeRe(SORT_REASONS)}$`, 'm'), 'the deliverable carries lc\'s objection line');
  const split = FR.splitOfFinalRead(result.finalRead);
  assert.deepEqual([split?.objector?.lab, split?.signed], ['lc', ['ld']], 'the split names lc as the seat that objects and ld as the one that signed (lc is not a signer)');
  assert.equal(JSON.stringify(result.dispute).includes(`"severity":${RATING}`), false, 'NAMED PIN (the dispute record is built before the final read, so no input changes this; FAIL CONDITION: the final read\'s rating appears in dispute.open_objections): the climb record keeps its own rating');
  const once = (list, id) => (list || []).filter(o => o.id === id).length;
  assert.deepEqual([once(result.severityRun?.open, climb.id), once(result.dispute?.open_objections, climb.id)], [1, 1], 'NAMED PIN (the severity record and the dispute record are built before the final read, so lc\'s restated objection adds no row to either; it holds by construction and is never reached on the parent tree, where the lines above fail first; FAIL CONDITION: the climb id appears twice, or not at all, in severityRun.open or dispute.open_objections): the id is counted once');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026, parts 5 and 6; the 'agreed end' row). OLD: a chain of four layers (la 1, lb 2, lc 3, ld 3) with a finalist: lc rated its climb objection 3 (swept), so every layer signed off in pass 1; the finalist then changed the plan, lc read it again and sorted a must-do rated 5 on the passage of that swept objection; c1-c9: passed true; both top seats read the new text; lc's failure on the SAME id (severity 5, open); the final read blocks the agreement; the run is not agreed; the id once in the handoff; the "Objections of the final read (open)" section with
// lc's own must-do line; the ledger's swept list == [id] with nothing open; the heading '## Objections rated below 4 left open' absent. Red on the tip (job 146, c2 :69 premise): with the build-check wording recorded the finalist's edit never runs at an agreed end, so no top seat is owed a read on a changed text (chain.js:7660; build-check.test.js :154 and :171). NEW: the same claims on the one end that exists (a person's own chain: ONE layer, `freedoms: { pass: true }`, an external handler; printed in job 152): pass 1 seat-a objects rated 5 and seat-b rated 3 (swept: its pass-1 verdict is signed_off, swept_only); the writer revises; pass 2 seat-a signs
// (withdrawing its objection) and seat-b STATES A PASS; the handler answers good_to_build naming seat-b's swept id (the check lists it: "not yet sorted by layer 1: counts as must-do"); the run agrees on the REVISED text, which seat-b's last readable verdict (pass 1) is not on, so it is owed the final read and restates its swept objection as a must-do rated 5. c2 now names seat-b (seat-a was reused); the handler's naming of the id records no handler sort (the sort wait needs run_end not_agreed), so c7's line still reads "sorted must-do by its seat". WHY: the same subject (a seat's swept objection restated at 5 holds the sign-off at an AGREED end) on a run that exists;
// every pin keeps its message. RED: RESTATED = 3 (the must-do is swept again): the run stays agreed and c3/c4/c5 fail. Chain: test/helpers/layer-two-run.js `scenario` with ONE layer of two judges, no ladder key, no dispute stage, a mock builder, an external reviser, a mock handoff seat, `freedoms { pass: true }` and the held SORTING and W31 words (recorded); no chains/plan-*.json file has a stated-pass freedom.
test('agreed end (one layer, a stated pass): a seat\'s swept objection restated as a must-do rated 4 or above at the final read holds the sign-off: the run is not agreed (it was recorded agreed)', async () => {
  const RESTATED = 5;   // the rating of the restated must-do (3: it would be swept again and the run would stay agreed)
  const PASSAGE = 'retries failed requests';
  setHeldForTest({ ...SORTING, ...W31 });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const seats = { builder: seat(['writer']), reviser: { ...seat(['writer']), provider: 'external' }, handoff: seat(['hand']), critics: [['seat-a', 1], ['seat-b', 1]].map(seat) };
  const id = objectionId('seat-b', failureOf(3));
  const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no' });
  const overrides = {
    'panel-1-seat-a': objects(failureOf(5)), 'panel-1-seat-b': objects(failureOf(3)),
    'panel-2-seat-a': JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], answers: [{ id: objectionId('seat-a', failureOf(5)), status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }], verdict_line: 'ok' }),
    'panel-2-seat-b': JSON.stringify({ pass: true, pass_reason: 'Nothing more to object to.' }),
    'build-check-1': checkAnswerOf([id]),
    'final-read-seat-b': metWith([{ sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: PASSAGE, rating: RESTATED }]),
  };
  const { result } = await scenario({ answerBack: true, critics: [['seat-a', 1], ['seat-b', 1]], overrides, extra: { handoff: true, freedoms: { pass: true }, seats, layerRevisions: undefined, maxOverseerRounds: undefined } });
  assert.equal(result.passed, true, 'premise: every layer signed off (seat-b\'s objection rated 3 is swept)');
  assert.equal(result.panelVerdicts.find(v => v.round === 1 && v.lab === 'seat-b').swept_only, true, 'premise: seat-b\'s pass-1 objection was swept (its verdict signed off)');
  assert.deepEqual(result.finalRead.seats.map(e => e.lab).sort(), ['seat-b'], 'premise: the plan was revised after seat-b\'s last read, so it is the one top seat owed the final read (seat-a was reused)');
  const lc = result.finalRead.seats.find(e => e.lab === 'seat-b');
  assert.deepEqual([lc.meets, (lc.failures || []).map(f => [f.id, f.severity, f.open])], [false, [[id, RESTATED, true]]], 'seat-b restated its swept objection as a must-do rated 5: recorded on the same id and holding');
  assert.equal(FR.finalReadBlocksAgreement(result.finalRead), true, 'the final read blocks the agreement');
  assert.equal(isAgreed(result), false, 'the run is not recorded agreed');
  assert.equal(result.handoff.split(id).length - 1, 1, 'one id, one line on the build list: the objection is listed once (a swept "not required" line and a must-do line for the same id would contradict each other)');
  assert.match(result.handoff, new RegExp(`## Objections of the final read \\(open\\)[\\s\\S]*- ${id} \\(raised by seat-b; rated 5\\.0; sorted must-do by its seat\\)`), 'and it is the final read\'s must-do line');
  assert.deepEqual([(result.severityRun?.swept || []).map(o => o.id), (result.severityRun?.open || []).length], [[id], 0], 'NAMED PIN (the severity record is built before the final read; it holds by construction; FAIL CONDITION: the record loses the swept row, lists the id as open, or holds another swept row): the record keeps seat-b\'s objection as swept');
  assert.equal(result.handoff.includes('## Objections rated below 4 left open'), false, 'NAMED PIN (the shown section is the record minus the ids the final read holds open; the record\'s swept list here is only this id, so the section is absent; FAIL CONDITION: the heading is shown, i.e. a swept line stands beside the final read\'s must-do line)');
});
