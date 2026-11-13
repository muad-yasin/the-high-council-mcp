// 0.8.4 S16 (Q9(e), D31, RU-S16-04/05/06): what the final read does with a defect a layer-3 seat names that no open objection names. A defect it can anchor (a passage in the plan) is an OBJECTION of the final read: its quote, a rating, an id like every objection, never debated; at an agreed ending it holds the sign-off when rated 4 or above or unrated. A defect
// it cannot anchor is a late finding with the seat's rating. The two changes of meaning (an anchored sorting entry is an objection that holds the sign-off; a passage-less entry is a late finding) are live only once the final read's own words (W31, held `finalReadRule`) are recorded, so every row injects it; test/s8-sorting.test.js S8-16/17/18 hold the W7 state without it. T21ae, T21af, T21f, T21g, T21h (the reader and the records; the W31 prompt call site is the next step).
// The basis of a not-agreed ending whose final read was objected to (T21f) is the field final_read.basis (WORDING S16-w73d; the last test of this file); the basis of a late finding at an agreed ending (T17y) has no record and moves to S18. Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { finalReadBlocksAgreement, finalReadObjections } from '../src/final-read.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION, idOf, failureOf } from './helpers/layer-two-run.js';
import { W31 } from './helpers/w31-held.js';
import { objectionId } from '../src/objection-ids.js';
import { oneLayerRun, OBJECTS } from './helpers/one-layer-stated-pass.js';
import { agreedOf } from '../src/ending-matrix.js';
import { reportJsonShape } from '../src/report-shape.js';
import { readFileSync } from 'node:fs';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });
const OPEN = idOf(5);   // la\'s own objection (rated 5, raised in pass 1; layer 3 never read the plan: the climb stopped at layer 1)
const sortsOpen = { id: OPEN, sort: 'may_leave', reason: 'Minor for the build.' };
const newDefect = rating => ({ sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: 'retries failed requests', ...(rating !== undefined ? { rating } : {}) });

async function run(lcRows, { w31 = true } = {}) {
  setHeldForTest(w31 ? { ...SORTING, ...W31 } : SORTING);
  setOutboundScan({ finish: true });
  try {
    return await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'final-read-lc': metWith(lcRows), 'final-read-ld': MET }, extra: {}, cutLabels: ['revise-1'] });
  } finally { setOutboundScan({}); }
}
const entryOf = (r, lab) => r.result.finalRead.seats.find(e => e.lab === lab);
const agreedRecord = e => ({ ran: true, run_end: 'agreed', final_sha: 'abc', seats: [e] });

test('T21ae: a defect no open objection names, quoted from the plan and rated 5.0, is an objection of the final read: its quote, rating 5, an id with no L- prefix, never debated; it holds an agreed ending\'s sign-off', async () => {
  const r = await run([sortsOpen, newDefect(5)]);
  assert.equal(r.result.passed, false, 'premise: not agreed, on the finish');
  const lc = entryOf(r, 'lc');
  assert.equal(lc.meets, false);
  assert.equal(lc.failures.length, 1);
  assert.match(lc.failures[0].id, /^O-[0-9a-f]{8}$/);
  assert.deepEqual([lc.failures[0].quote, lc.failures[0].severity, lc.failures[0].not_debated], ['retries failed requests', 5, true]);
  assert.deepEqual(r.result.lateFindings ?? [], [], 'it is no late finding');
  assert.equal(finalReadBlocksAgreement(agreedRecord(lc)), true, 'at an agreed ending it holds the sign-off');
});

test('T21g (pin): the same defect rated 3.0 is recorded and holds nothing (below the hold line)', async () => {
  const r = await run([sortsOpen, newDefect(3)]);
  const lc = entryOf(r, 'lc');
  assert.deepEqual([lc.failures[0].severity, lc.failures[0].not_debated], [3, true]);
  assert.equal(finalReadBlocksAgreement(agreedRecord(lc)), false);
});

test('T21h: the same defect without a rating is kept unrated and holds the sign-off as one rated 4 or above does', async () => {
  // ADDED (0.8.4 apply, the re-pin of the removed row S8-17 of test/s8-sorting.test.js; C&C 11 Nov 2026 19:33 and 12 Nov 2026). OLD: S8-17 asserted, in the held state of the final read's own words, that an id-less entry with NO rating that quotes a passage of the plan is kept as a late finding; with those words recorded it is an objection of the final read (src/chain.js, `anchored` goes to the final read's objections), and no row asserted that for an UNRATED entry (T21ae does it for the same entry rated 5). NEW: the same entry with no rating is an objection with an O- id (no L- prefix), keeps its quote, and makes no late finding. WHY: a read of the code is not a pin; this is what the removed row would assert on the recorded state.
  const r = await run([sortsOpen, newDefect()]);
  const lc = entryOf(r, 'lc');
  assert.equal('severity' in lc.failures[0], false);
  assert.equal(lc.failures.length, 1);
  assert.match(lc.failures[0].id, /^O-[0-9a-f]{8}$/);
  assert.equal(lc.failures[0].quote, 'retries failed requests');
  assert.deepEqual(r.result.lateFindings ?? [], [], 'it is no late finding');
  assert.equal(finalReadBlocksAgreement(agreedRecord(lc)), true);
});

test('T21f: at a not-agreed ending (a finish at a stop) the objection is recorded with its rating and not_debated; the run stays not agreed, with no check of the handler and no second stop. (The "basis final read" record is NOT built: no row names one.)', async () => {
  const r = await run([sortsOpen, newDefect(5)]);
  assert.equal(r.result.passed, false);
  assert.equal(r.result.stop?.chosen, 'finish', 'the only stop is the recorded finish');
  assert.equal(r.result.stages.some(s => /^build-check-/.test(s.label)), false, 'no good-to-build check follows');
  assert.equal(entryOf(r, 'lc').failures[0].severity, 5);
});

test('T21af / T17y (rating): a defect it cannot anchor is a late finding with the seat\'s rating (the key `rating`) and holds nothing', async () => {
  const r = await run([sortsOpen, { sort: 'must_do', reason: 'No back-off is stated anywhere.', criterion: CRITERION, rating: 6 }]);
  const lc = entryOf(r, 'lc');
  assert.equal(lc.meets, true);
  const rows = (r.result.lateFindings ?? []).filter(x => x.found === 'final_read');
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^L-[0-9a-f]{8}$/);
  assert.equal(rows[0].rating, 6);
  assert.equal(finalReadBlocksAgreement(agreedRecord(lc)), false, 'a late finding holds nothing by itself');
});

// REMOVED (0.8.4 apply, K7): 'W31 gate: without the final read's own words (the W7 state) ...' ran `run(..., { w31: false })` (SORTING only) and expected the OLD meaning (the seat still meets, no failure, a late finding). Job 12: `false !== true` on `lc.meets`. `finalReadRule` (W31) is recorded (src/roles.js), so SORTING without W31 falls through to the recorded word and the defect is an objection of the final read. Sibling (same file): T21ae (the recorded state: the quoted defect rated 5 is an objection, lc.meets false, holds the sign-off), T21g, T21h and T21af (the passage-less entry is still a late finding).

test('dedupe (W31: "sort each open objection, yours included"): a defect the seat raised itself in failures and also sorts as an id-less quoted must-do is its own sorting, not a second objection', async () => {
  setHeldForTest({ ...SORTING, ...W31 });
  setOutboundScan({ finish: true });
  const own = { criterion: CRITERION, problem: 'The worker never backs off.', fix: 'Add a back-off.', quote: 'retries failed requests', severity: 5 };
  const reply = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [own], verdict_line: 'no', sorting: [sortsOpen, { sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: 'retries failed requests', rating: 5 }] });
  let r;
  try { r = await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'final-read-lc': reply, 'final-read-ld': MET }, extra: {}, cutLabels: ['revise-1'] }); } finally { setOutboundScan({}); }
  const lc = entryOf(r, 'lc');
  assert.equal(lc.failures.length, 1, 'one objection, not two');
  assert.equal(lc.failures[0].id, objectionId('lc', own));
});

// The AGREED ending, driven: every layer signs off in pass 1, the final edit changes the plan, layer 3 reads it again and one seat names a quoted defect rated 5 in its sorting. With W31 recorded the objection holds the sign-off and the run ends NOT agreed (exit 22 territory); without it (the W7 state) the defect is a late finding and the run stays agreed.
// CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026, part 7; row 7 'agreed ending (driven)' and its fixture agreedRun). OLD: a three-layer chain with a finalist: a full sign-off, then the final edit changed the plan and both top seats read it again; lc's reply was a CLEARING one whose sorting named a quoted defect rated 5 (W31); the run ended NOT agreed (outcome no_consensus), the sign-off untouched; in the W7 state (W31 held off) the same reply left it agreed (outcome consensus). Red on the tip (jobs 122 and 146, premise :111: the re-read list is empty): the finalist's edit is skipped at an agreed end
// (chain.js:7660; build-check.test.js :154 and :171), so nobody is owed a re-read. NEW: the same claim on the one-layer stated-pass end (test/helpers/one-layer-stated-pass.js; printed in jobs 151 and 155): seat-b's final read is a CLEARING reply (meets true, no failures) whose sorting names a quoted must-do rated 5: the reply's form in; the failure out (seat-b read true, meets false, one failure, severity 5, open); no late finding; passed true, run_end 'agreed', finalReadBlocksAgreement true, agreedOf false, the ending kind signed_off_at_top_not_agreed; signoff untouched; and the SAME reply with the must-do RATED 3 (T21g's form) leaves the run AGREED: that contrast replaces the W7 half (a held state: bin 1).
// computeOutcome claims (no_consensus / consensus): bin 1 (outcome 'degraded' on this end; outcome.js:31 is not reached). WHY: the same subject (a rated-5 must-do named in a clearing reply's sorting holds the sign-off at an agreed end; a rated-3 one holds nothing) on a run that exists. RED: the two ratings swapped (the rated-5 reply leaves the run agreed). Chain: test/helpers/one-layer-stated-pass.js through layer-two-run.js `scenario`: ONE layer of two judges, no ladder key, no dispute stage, a mock builder with an external reviser, no handoff seat, `freedoms { pass: true }`, the held SORTING and W31 words (recorded), a scripted cache; no chains/plan-*.json file has a stated-pass freedom.
test('agreed ending (one layer, a stated pass): a clearing final-read reply whose sorting names a quoted must-do rated 5 ends the agreed run NOT agreed, the sign-off untouched; the same reply rated 3 leaves it agreed', async () => {
  setHeldForTest({ ...SORTING, ...W31 });
  const reply = rating => metWith([{ sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: 'retries failed requests', rating }]);
  const form = JSON.parse(reply(5));
  assert.deepEqual([form.meets, form.failures.length, form.sorting.map(x => [x.sort, x.rating])], [true, 0, [['must_do', 5]]], 'the reply\'s form IN: a clearing reply, no failure, one sorting row rated 5');
  const on = await oneLayerRun({ finalRead: reply(5) });
  assert.equal(on.result.passed, true, 'premise: every layer signed off (seat-a signed, seat-b stated a pass)');
  assert.equal(on.result.finalRead.run_end, 'agreed');
  const seatB = on.result.finalRead.seats.find(e => e.lab === 'seat-b');
  assert.deepEqual([seatB.read, seatB.meets, seatB.failures.map(f => [f.id, f.severity, f.open])], [true, false, [[objectionId('seat-b', failureOf(5)), 5, true]]], 'the failure OUT: the must-do is recorded as the seat\'s failure, rated 5, open');
  assert.deepEqual(on.result.lateFindings ?? [], [], 'no late finding: the defect is the seat\'s objection, not a late finding');
  assert.equal(finalReadBlocksAgreement(on.result.finalRead), true);
  assert.equal(agreedOf({ passed: on.result.passed, ending: on.result.ending, final_read: on.result.finalRead }), false, 'the run ends not agreed');
  assert.equal(on.result.ending?.kind, 'signed_off_at_top_not_agreed');
  const off = await oneLayerRun({ finalRead: reply(3) });
  assert.deepEqual(off.result.signoff, on.result.signoff, 'signoff[] untouched: the final read changes nothing the panel recorded');
  assert.equal(off.result.passed, true);
  assert.deepEqual(off.result.lateFindings ?? [], [], 'rated 3: no late finding either');
  assert.equal(finalReadBlocksAgreement(off.result.finalRead), false, 'rated 3 holds nothing');
  assert.equal(agreedOf({ passed: off.result.passed, ending: off.result.ending, final_read: off.result.finalRead }), true, 'the same reply rated 3 leaves the run agreed');
});

// The ids (pure): per seat, criterion and quoted passage (src/objection-ids.js); the same ones is the SAME objection whatever the words; a suffix comes only from the Q12 assigner (objectionId's registry).
const baseId = f => `O-${f.quote === 'q1' ? 'aaaaaaaa' : f.quote === 'q2' ? 'bbbbbbbb' : 'cccccccc'}`;
const fr = (problem, quote = 'q1', extra = {}) => ({ criterion: 'C', problem, quote, ...extra });
test('ids (pure): another passage gives another id; the same passage with other words is the same objection (one, not two); the seat\'s own failures keep one id each', () => {
  const other = finalReadObjections({ failures: [fr('first')], rows: [fr('other passage', 'q2')], baseIdOf: baseId });
  assert.deepEqual([...other.failures, ...other.added].map(x => x.id), ['O-aaaaaaaa', 'O-bbbbbbbb']);
  const same = finalReadObjections({ failures: [fr('Same text.')], rows: [fr('reworded complaint')], baseIdOf: baseId });
  assert.deepEqual([same.failures.length, same.added.length], [1, 0], 'the same criterion and passage: the seat\'s word on its own objection');
  const own = finalReadObjections({ failures: [fr('one'), fr('two', 'q2')], rows: [], baseIdOf: baseId });
  assert.deepEqual(own.failures.map(x => x.id), ['O-aaaaaaaa', 'O-bbbbbbbb']);
});

test('ids vs the list the seat was shown (Q12, pure): a sorting entry with a listed objection\'s id is that objection; a seat re-raising its listed objection in other words keeps the listed id; a new passage is a new objection', () => {
  const known = new Map([['O-aaaaaaaa', 'The climb text.']]);
  assert.deepEqual(finalReadObjections({ failures: [], rows: [fr('A different text.')], known, baseIdOf: baseId }).added, [], 'the listed objection, not a new one');
  assert.deepEqual(finalReadObjections({ failures: [fr('In other words.')], rows: [], known, baseIdOf: baseId }).failures.map(x => x.id), ['O-aaaaaaaa']);
  assert.deepEqual(finalReadObjections({ failures: [], rows: [fr('new', 'q2')], known, baseIdOf: baseId }).added.map(x => x.id), ['O-bbbbbbbb']);
});

// T21f (WORDING S16-w73d; C&C 09 Nov: an additive `final_read.basis`, no `ending` record): the named basis of a not-agreed end whose final read was objected to.
test('T21f (basis): at a not-agreed ending (a finish at a stop) an objection of the final read that holds sets final_read.basis "final_read_objection", in the record and in report.json, and no `ending` is added; the same run with the objection rated 3 (swept) and an AGREED run with an objecting seat carry no basis', async () => {
  const r = await run([sortsOpen, newDefect(5)]);
  assert.equal(r.result.finalRead?.basis, 'final_read_objection', 'presence: run_end not_agreed, the read ran, a seat objected with a rating of 5');
  assert.equal(r.result.finalRead?.run_end, 'not_agreed');
  assert.equal(r.result.ending, undefined, 'no ending record at a finish: the basis is a field of final_read, nothing else');
  const rep = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r', chain: 'fixture-l2', task: 't.md', result: r.result, config: { name: 'x', seats: { critics: [] } } })));
  assert.equal(rep.final_read?.basis, 'final_read_objection', 'it reaches report.json whole');
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.final_read?.properties?.basis?.enum, ['final_read_objection'], 'the schema declares the one value');
  const swept = await run([sortsOpen, newDefect(3)]);
  assert.equal(swept.result.finalRead?.ran, true, 'premise: the read ran');
  assert.equal(swept.result.finalRead?.run_end, 'not_agreed', 'premise: not agreed');
  assert.equal(swept.result.finalRead?.basis, undefined, 'rated 3: swept, it holds nothing, no basis');
  // CHANGED ACCEPTED (0.8.4 apply, C&C ruling 12 Nov 2026, part 3). OLD: this last leg ran agreedRun(true): a finalist's edit after the sign-off, so lc read the final plan again and objected (an agreed end with a changed text). Red on the tip (job 122, :152: the stage did not run, lc has no entry): the final edit is skipped at an agreed end (chain.js:7660), so nobody is owed a re-read. NEW: the same claim (an agreed end with an objection of the final read
  // writes no `basis`: the ending names the reason) on the one-layer stated-pass run (test/helpers/one-layer-stated-pass.js; printed: final_read has no `basis` key, jobs 135 and 136): seat-b reads the final plan and objects. WHY: the same subject on a run that exists. RED: seat-b's reply swapped for a clear read: the premise that it objected fails.
  setHeldForTest(null);   // the fixture the jobs printed (no sorting held): this leg's seat-b reply carries no sorting list
  const agreed = await oneLayerRun({ finalRead: OBJECTS });
  assert.equal(agreed.result.finalRead?.run_end, 'agreed', 'premise: every layer signed off');
  assert.equal(agreed.result.finalRead?.seats?.find(e => e.lab === 'seat-b')?.meets, false, 'premise: a top seat objected to the final plan');
  assert.equal(agreed.result.finalRead?.basis, undefined, 'an agreed run: its ending names the reason, this field is not written');
});

// T21ah, T21j, T21at (WHOLE-RUN rows of the S16 fix round), on the T21f fixture: at a not-agreed ending (a finish at a stop) a layer-3 seat objects at the final read with a rating of 5.0.
test('T21ah, T21j, T21at: after a final-read objection no further layer-3 call is made (one call per asked seat, no re-ask), and no stop is raised, none offers a choice or a continue: the run ends on the person\'s own finish', async () => {
  const LC = metWith([sortsOpen, newDefect(5)]);   // the objecting seat's reply to its one call
  const LD = MET;   // the second layer-3 seat's reply to its one call
  setHeldForTest({ ...SORTING, ...W31 });
  setOutboundScan({ finish: true });
  let r; let stopped;
  try { r = await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'final-read-lc': LC, 'final-read-ld': LD }, extra: {}, cutLabels: ['revise-1'] }); }
  catch (e) { if (e instanceof RoundStopped) stopped = e; else throw e; } finally { setOutboundScan({}); }
  assert.equal(stopped, undefined, 'T21j, T21at: no stop is raised after the objection: nothing offers a continue, a finish or a revision outside the Council');
  const reads = r?.result?.stages?.map(s => s.label).filter(l => l.startsWith('final-read-')).sort();
  assert.deepEqual(reads, ['final-read-lc', 'final-read-ld'], 'T21ah: one call per asked seat; nothing is asked again after the objection');
  assert.equal(r?.result?.finalRead?.seats?.find(e => e.lab === 'lc')?.meets, false, 'premise: the objection was made');
  assert.equal(r?.result?.passed, false, 'T21j: the run is over for the Council, not agreed');
  assert.equal(r?.result?.stop?.chosen, 'finish', 'the only stop of the run is the person\'s own finish');
  assert.ok(!r?.result?.stages?.some(s => /^build-check/.test(s.label)), 'and no handler check is asked');
});
