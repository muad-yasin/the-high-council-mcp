// 0.8.4 S8 (M3): layer 3's SORTING of the open objections and late findings, read at the closing read (the final read of N26): must-do or may-leave, with a reason; a must-do without a ground is
// still a must-do and is flagged ungrounded (T9d); an unanchored failure is sorted like any other (T12m); the closing read of a never-heard end asks both layer-3 seats once, records each seat's
// sorting and moves no counter (T9b); a seat that has read exactly this text is not asked again (T9h, a NAMED PIN: the text-only test of src/final-read.js already gives it).
// Offline, mock seats, $0. The pure rows import src/sorting.js through a guard, so a tree without it fails each row BY NAME. Run rows score the closing read through a label-keyed scripted cache
// (`final-read-<seat>`), because the mock provider cannot write a sorting. The rating demand is held in-process (setHeldForTest): a spawned CLI would not see it.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { promptHashOf } from '../src/cache-integrity.js';
import { objectionId } from '../src/objection-ids.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import * as HS8 from './held-prompts/held-084-s8.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as RC from '../src/roles.js';   // the RECORDED words (src/roles.js): the expected prompt text below is built from them, not from the held mirrors and not from the code under test
import * as SS from '../src/stage-system.js';   // a namespace, so a tree without climbSortingFor fails the rows BY NAME and not the whole file at link time
const { systemTextsFor, panelPromptFor } = SS;
import { estimateChainRows, estimateTokens } from '../src/cost.js';
import { reportJsonShape } from '../src/report-shape.js';
import { readFileSync } from 'node:fs';
import { critic, chainOf } from './helpers/final-read-chain.js';
import { scenario, idOf, CRITERION as SC_CRITERION } from './helpers/layer-two-run.js';
import * as VE from '../src/verdict-envelope.js';

// CHANGED ACCEPTED TEST (0.8.4 apply, job 12 rows S8-12, S8-27, S8-29): the recorded W7 as a layer-3 read carries it. OLD: `HS8.layerThreeSortingRule()` whole (the held state: W7 alone). NEW: W7 with W32's rating sentence after "it is recorded as a late finding." (every layer-3 read that carries W7, climb included: src/stage-system.js withSortingWords, finalReadWordsOn()), and at the FINAL read also without W7's two closing-read clauses (W31) and with the final read's own reply form. WHY: the S16 words (lateFindingRatingSentence, finalReadRule, finalReadSortingForm, finalReadSortingItems) are recorded in src/prompts/recorded-084-s16.js, so SORTING (which leaves them out) falls through to them; `p.system.includes(HS8.layerThreeSortingRule())` is false in every shipped run (job 12: 'W7 is in the system text'). The strings are composed from the RECORDED exports by literal edits the plan names (W32's sentence goes after the anchor; W31 cuts the two clauses), never by calling withSortingWords or finalReadSystemFor.
const W32_ANCHOR = 'it is recorded as a late finding.';
const W31_CUTS = [' (at a closing read, state your position on the plan: it is not a verdict that ends an overseer round)', ' At a closing read, if you find a new material defect that no open objection names, add it as a must-do item of its own, with the passage and the criterion.'];
const W7_AT_CLIMB = () => RC.layerThreeSortingRule().replace(W32_ANCHOR, () => `${W32_ANCHOR}${RC.lateFindingRatingSentence()}`);
const W7_AT_FINAL_READ = () => W31_CUTS.reduce((w, cut) => w.replace(cut, () => ''), W7_AT_CLIMB());

let S = null;
try { S = await import('../src/sorting.js'); } catch { S = null; }
const need = () => { assert.ok(S && typeof S.readSorting === 'function' && typeof S.combineSortings === 'function' && typeof S.sortingOn === 'function', 'src/sorting.js exports readSorting, combineSortings and sortingOn'); return S; };
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); VE.setEnvelopeStore(null); VE.setEnvelopeInForce(false); });
const frLabels = r => r.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));   // calls are counted by recorded stage label (a replayed stage records one), never by cache lookups

const CRITERION = 'The plan defines a retry limit.';
const failureOf = (problem, quote, severity = 5) => ({ criterion: CRITERION, problem, fix: 'Specify one.', ...(quote ? { quote } : {}), severity });
const idOfFailure = f => objectionId('l1a', f);

test('S8-1 readSorting: a row names an id, a sort (must_do or may_leave) and a reason; anything else is ignored and counted, never read as a sorting', () => {
  const { readSorting } = need();
  const got = readSorting([
    { id: 'o1', sort: 'must_do', reason: 'The defect holds.', criterion: CRITERION },
    { id: 'o2', sort: 'may_leave', reason: 'Cosmetic.' },
    { id: 'o3', sort: 'maybe', reason: 'x' },
    { sort: 'must_do', reason: 'no id' },
    'text',
  ]);
  assert.deepEqual(got.rows.map(r => [r.id, r.sort]), [['o1', 'must_do'], ['o2', 'may_leave']]);
  assert.equal(got.ignored, 3);
  // CHANGED ACCEPTED (S8 c2b). OLD: readSorting returned { rows, ignored }. NEW: it also returns `fresh` (the new defects a closing read hands in; [] here). WHY: c2b keeps a must-do outside the list instead of dropping it. Red on f851a748 at the OLD line (set-3e38e391: actual { fresh: [], ignored: 0, rows: [] }).
  assert.deepEqual(readSorting(undefined), { rows: [], ignored: 0, fresh: [] }, 'no key: the reply carried no sorting');
  // CHANGED ACCEPTED (S8 c1b, C&C item 2). OLD: readSorting('nope') was { rows: [], ignored: 0 }, so a sorting that was not a list left no trace. NEW: it is ignored: 1. WHY: a dropped sorting must be counted (sorting_ignored on the seat entry).
  assert.deepEqual(readSorting('nope'), { rows: [], ignored: 1, fresh: [] });
});

test('S8-2 (T9d) a must-do without a criterion or a decision is still a must-do, flagged ungrounded; the other seat\'s may-leave does not make it may-leave; a grounded must-do from either seat clears the flag', () => {
  const { readSorting, combineSortings } = need();
  const a = readSorting([{ id: 'o1', sort: 'must_do', reason: 'It is wrong.' }]);
  const b = readSorting([{ id: 'o1', sort: 'may_leave', reason: 'Minor.' }]);
  assert.equal(a.rows[0].ungrounded, true, 'a must-do with no criterion and no decision is flagged');
  const both = combineSortings([{ seat: 'l3a', rows: a.rows }, { seat: 'l3b', rows: b.rows }]);
  assert.equal(both.length, 1);
  assert.equal(both[0].sort, 'must_do', 'it is not sorted may-leave');
  assert.equal(both[0].ungrounded, true);
  assert.deepEqual(both[0].seats.sort(), ['l3a', 'l3b']);
  const grounded = readSorting([{ id: 'o1', sort: 'must_do', reason: 'It is wrong.', criterion: CRITERION }]);
  const cleared = combineSortings([{ seat: 'l3a', rows: a.rows }, { seat: 'l3b', rows: grounded.rows }]);
  assert.equal(cleared[0].sort, 'must_do');
  assert.ok(!cleared[0].ungrounded, 'a grounded must-do from the other seat is a ground');
});

test('S8-3 sortingOn is the gate: the answer_back ledger AND the rating demand (the sorting names ledger ids)', () => {
  const { sortingOn } = need();
  const cfg = { signoff: 'unanimous', answer_back: { enabled: true }, seats: { critics: [critic('m', 'a', 1), critic('m', 'b', 2), critic('m', 'c', 3)] } };
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row first proved that the gate stayed off while the rating demand, W7 or the reply form was held back (seven assertions with held maps). NEW: those are removed; the recorded gate is pinned (on for this chain, off without a ledger). WHY: layerThreeSortingRule, layerThreeSortingForm and layerThreeSortingItems are recorded (src/prompts/recorded-084-s8.js), so no shipped run has them held back; sibling rows S8-26 and S8-27 pin the recorded sorting predicate and the recorded top text.
  assert.equal(sortingOn(cfg), true);
  assert.equal(sortingOn({ ...cfg, answer_back: undefined }), false, 'no ledger, no sorting');
});

// ---- run rows: a layered chain whose layer 1 is never heard (the A1 end of test/final-read-stage.test.js), so neither layer-3 seat has read anything and the closing read asks both.
const scripted = replyOf => {
  const hashes = new Map();
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); });
  setCache({ invalidate: () => {}, get(label) {
    if (!label.startsWith('final-read-')) return null;
    const text = replyOf(label);
    return text === undefined ? null : { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
};
const chain = (tag, extra = {}) => chainOf([
  critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic(`mock-critic-script-o-s8-2-${tag}`, 'l2a', 2),
  critic('mock-review-fixture', 'l3a', 3, { maxTokens: 3000 }), critic('mock-review-fixture', 'l3b', 3, { maxTokens: 3000 }),
], { answer_back: { enabled: true }, ...extra });
const go = (config) => runChain({ request: 'A mock task.', log: () => {}, runId: 'r-s8', config });
const objecting = (failures, sorting) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no', ...(sorting ? { sorting } : {}) });

// ---- the scenario fixture (test/helpers/layer-two-run.js): la (layer 1) raises one rated objection in round 1, maxRounds 1 ends the run not agreed at the round cap, so the layer-3 seats lc and ld never read the plan and
// the closing read asks both; the objection is OPEN (its id is idOf(5)) and is the list the seats sort. CHANGED ACCEPTED (S8 c2a) for S8-4, S8-5 and S8-9: OLD the never-heard fixture above (no open objection), NEW this one,
// because a sorting id must now be in the list the seat was shown; their assertions are unchanged, their red stands on set-692962b7 and set-a2e51a4a.
const OPEN = idOf(5);
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: SC_CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: SC_CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(sorting !== undefined ? { sorting } : {}) });
// The run reaches layer 1's revision bound (7 revisions, so pass 8 of overseer round 1; maxRounds is not what limits it; stop id read from the box run set-de87ed1f): the person's recorded FINISH at that stop (the sg FINISH_STALL pattern) ends it not agreed, with layer 3 unread, and the post-loop stages (the closing read) run.
const FINISH = { runExtra: { roundChoices: [{ choice: 'finish', stop: 'layer_bound:1:8', kind: 'layer_bound', why: 'revisions', layer: 1 }] } };
const STOPPED = async fn => { try { return await fn(); } catch (e) { if (e && e.stop) throw new Error(`premise: the run stopped at ${e.stop.kind}:${e.stop.overseer_round}:${e.stop.pass} (why ${e.stop.why}, layer ${e.stop.layer}): the recorded finish names a different stop id`); throw e; } };
const scn = (overrides = {}, o = {}) => STOPPED(() => scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides, extra: { maxRounds: 1 }, ...FINISH, ...o }));
const premise = (r, labels = ['final-read-lc', 'final-read-ld']) => {
  assert.equal(r.result.passed, false, 'premise: the run ends not agreed (on the recorded finish)');
  assert.equal(r.result.stop?.chosen, 'finish', 'premise: the run ended on the recorded finish');
  assert.ok(r.result.finalRead && r.result.finalRead.ran === true, 'premise: the closing read ran');
  assert.deepEqual(frLabels(r.result).sort(), labels, 'premise: both unread layer-3 seats were asked once');
};

test('S8-4 (T9b) the closing read asks both unread layer-3 seats once; each seat\'s sorting is recorded on its entry and combined in final_read.sorting; no round counter moves and nothing reaches signoff[] or panelVerdicts', async () => {
  setHeldForTest(SORTING);
  // CHANGED ACCEPTED (0.8.4 S16, N6: no switch). OLD: `off`, the twin run without `final_read`, was the control for 'the closing read moves nothing'. NEW: the twin would read too, so the controls are what the run itself records: the signoff, panelVerdicts, layers and passed of the loop (fixed values below) and the stop it ended on. WHY: the read cannot be switched off any more.
  const r = await scn({ 'final-read-lc': metWith([{ id: OPEN, sort: 'must_do', reason: 'The defect holds.', criterion: SC_CRITERION }]), 'final-read-ld': metWith([{ id: OPEN, sort: 'may_leave', reason: 'Minor.' }]) });
  premise(r);
  const fr = r.result.finalRead;
  for (const s of fr.seats) assert.ok(!('sorting_ignored' in s), `${s.lab}: the open id is in the list, nothing ignored`);
  assert.deepEqual(fr.seats.map(s => [s.lab, s.sorting?.map(x => [x.id, x.sort])]), [['lc', [[OPEN, 'must_do']]], ['ld', [[OPEN, 'may_leave']]]]);
  assert.deepEqual(fr.sorting.map(x => [x.id, x.sort]), [[OPEN, 'must_do']], 'the combined sorting: any must-do wins');
  assert.equal(r.result.panelVerdicts.some(v => v.layer === 3), false, 'panelVerdicts: the closing read adds no layer-3 verdict row');
  assert.equal(r.result.signoff.some(x => frLabels(r.result).includes(`final-read-${x.lab}`)), false, 'signoff[]: nothing of the closing read reaches it');
  assert.equal(r.result.layers.find(l => l.layer === 3)?.state, 'not_asked', 'layers: layer 3 is still not_asked after the closing read');
  assert.equal(r.result.passed, false);
  // CHANGED ACCEPTED (0.8.4 S8 rulings, T9b and T17x; S8-4 is S8's own row): OLD S8-4 compared signoff, panelVerdicts, layers and passed only. NEW the assertions below: overseer_rounds, the stop, the labels asked and the layer-3 row count are equal with and without the closing read, and the run does not end at the overseer cap. WHY: the plan's exit list names T9b and T17x. No existing assertion is changed or removed.
  // T9b / T17x (NAMED PINS: no input can make the closing read move a counter, because every overseer-round increment sits inside the pass loop (src/chain.js:5800, :5953, :6156) and the closing read runs after it (:7140) and feeds nothing back).
  // Fail condition: overseer_rounds, the stop object, the layer-3 verdict rows or the labels asked of the cache differ between the run WITH the closing read and the run WITHOUT it, or the run ends at the overseer cap.
  assert.ok(Number.isInteger(r.result.overseer_rounds), 'T9b/T17x premise: overseer_rounds is recorded (the compared counter is not undefined)');
  assert.ok(r.result.stop && r.result.finalRead?.ran === true, 'T9b/T17x premise: the run ended on the recorded finish and the closing read ran');
  assert.ok(r.served.some(l => l.startsWith('final-read-')), 'T9b/T17x premise: the closing read asked for final-read labels');
  assert.equal(r.result.overseer_rounds, 0, 'T9b: no overseer round has finished (the recorded finish at layer_bound:1:8 ends round 1 INSIDE the pass loop, before the increment sites cited above), and the closing read, which runs after the loop, increments nothing; failing case: the round counter moves)');
  assert.deepEqual([r.result.stop.kind, r.result.stop.overseer_round, r.result.stop.pass], ['layer_bound', 1, 8], 'T9b: the stop (kind, overseer_round, pass) is the recorded one');
  assert.deepEqual(r.served.slice(r.served.findIndex(l => l.startsWith('final-read-'))).filter(l => /^(revise|rule|panel|ldebate|lreply)-/.test(l)), [], 'T9b: no revise, rule, panel or exchange call after the closing read starts');
  const l3rows = x => x.result.panelVerdicts.filter(v => v.layer === 3).length;   // S16: the control is 0 (layer 3 never read in this run), not a twin
  assert.equal(l3rows(r), 0, 'T17x: layer 3 was never asked in this run, so the layer-3 number is 0 before and after');
  assert.notEqual(r.result.stop.kind, 'overseer_cap', 'T17x: the closing read does not spend the cap (the run did not end at the overseer cap)');
});

test('S8-5(T12m, NAMED PIN since c2b: no counting red; its assertions were written green against the c1b source) an unanchored failure (no quote) is sorted like any other: its row is kept with its sort, not dropped or ranked below the anchored one. Fail condition: the unanchored failure\'s must-do row, or its place after the anchored one, is missing from the seat entry', async () => {
  setHeldForTest(SORTING);
  const bare = { criterion: SC_CRITERION, problem: 'No back-off is stated.', fix: 'State one.', severity: 5 };
  const idb = objectionId('la', bare);
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'S8-5(T12m'): OLD: `extraFailures: [bare]` (the second failure carried no `relation`). NEW: `[{ ...bare, relation: 'new' }]`. WHY: the TAP's error line "premise: the run ends not agreed (on the recorded finish)  true !== false": the scenario chain has answer_back on, so with relationRule recorded a failure the judge writes without its relation makes la's whole reply `relation_missing` (src/chain.js:5465-5468), la is not heard, every layer then signs and the run ends agreed. S8-4 (same scn, no extra failure, ok in job 12) is the control. The id idb is unchanged: baseObjectionId (src/objection-ids.js:54) has no relation term; test/helpers/layer-two-run.js failureOf is the same shape (bareFailureOf + relation 'new').
  const r = await scn({ 'final-read-lc': metWith([{ id: idb, sort: 'must_do', reason: 'It holds.', criterion: SC_CRITERION }, { id: OPEN, sort: 'may_leave', reason: 'Minor.' }]), 'final-read-ld': MET }, { extraFailures: [{ ...bare, relation: 'new' }] });   // ld answers a plain read: unscripted, ld got the stub's default text and was asked again (set-adf2e24d showed final-read-ld-reask1)
  premise(r);
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc');
  assert.ok(lc, 'lc is on the record');
  assert.ok(Array.isArray(lc.sorting), 'the entry carries a sorting');
  assert.deepEqual(lc.sorting.map(x => [x.id, x.sort]), [[idb, 'must_do'], [OPEN, 'may_leave']], 'the unanchored failure keeps its must-do and its place');
});

test('S8-6 (T9h, NAMED PIN) a seat that has read exactly this text is not asked again: every layer signs off on the plan as it ends (the chain of test/final-read-stage.test.js:67 with the ledger and the demand), so the closing read makes no call. Fail condition: a closing-read call for a seat that read this text', async () => {
  setHeldForTest(DEMAND);
  scripted(() => undefined);
  const r = await go(chainOf([critic('mock-critic-script-o-fra1-s8', 'l1', 1), critic('mock-critic-script-o-fra2-s8', 'l2', 2), critic('mock-critic-script-o-fra3-s8', 'l3', 3)], { answer_back: { enabled: true }, final_read: { enabled: true } }));
  assert.equal(r.passed, true, 'premise: every layer signed off');
  assert.deepEqual(frLabels(r), []);
  assert.equal(r.finalRead.ran, false);
  assert.equal(r.finalRead.reason, 'every_top_seat_read_this_plan');
});

test('S8-7 (NAMED PIN, the gate) while the rating demand is held back nothing is recorded as a sorting, whatever the reply carries. Fail condition: a sorting key on an entry or on final_read without the demand', async () => {
  const f = failureOf('No retry limit is stated.', 'The worker');
  const id = idOfFailure(f);
  scripted(() => objecting([{ ...f }], [{ id, sort: 'must_do', reason: 'It holds.', criterion: CRITERION }]));
  const r = await go(chain('gate'));
  assert.ok(r.finalRead && r.finalRead.ran === true, 'premise: the closing read ran');
  for (const e of r.finalRead.seats) assert.ok(!('sorting' in e), `${e.lab}: no sorting without the demand`);
  assert.ok(!('sorting' in r.finalRead));
});

test('S8-8 (NAMED PIN, any one S8 word held) the rating demand is in force and the ledger is kept, but ONE of the three S8 words (W7, the reply form, the list) is held back: nothing is recorded as a sorting, whatever the reply carries. Fail condition: a sorting key on an entry or on final_read while any of them is held', async () => {
  // CHANGED ACCEPTED (S8 c2a, C&C: "S8-8 covers any one of the three held back"). OLD: all three held at once. NEW: each one held alone, the other two recorded.
  const f = failureOf('No retry limit is stated.', 'The worker');
  const id = idOfFailure(f);
  for (const gone of ['layerThreeSortingRule', 'layerThreeSortingForm', 'layerThreeSortingItems']) {
    setHeldForTest({ ...SORTING, [gone]: undefined });
    scripted(() => objecting([{ ...f }], [{ id, sort: 'must_do', reason: 'It holds.', criterion: CRITERION }]));
    const r = await go(chain(`w7held-${gone}`));
    assert.ok(r.finalRead && r.finalRead.ran === true, `premise (${gone} held): the closing read ran`);
    for (const e of r.finalRead.seats) { assert.ok(!('sorting' in e), `${gone} held, ${e.lab}: no sorting`); assert.ok(!('sorting_ignored' in e), `${gone} held, ${e.lab}: nothing counted either`); }
    assert.ok(!('sorting' in r.finalRead), `${gone} held: no combined sorting`);
    setPromptSpy(null); setCache(null);
  }
});

test('S8-9 (sorting_ignored) rows that are dropped leave a trace: a seat whose rows are all malformed has NO sorting but sorting_ignored = the count; a sorting that is not a list counts 1', async () => {
  setHeldForTest(SORTING);
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row S8-9): OLD: the first malformed row was `{ sort: 'must_do', reason: 'no id' }`. NEW: `{ sort: 'may_leave', reason: 'no id' }` (still a row with no id, so still ignored and counted). WHY: error 'Expected values to be strictly equal: 3 !== 2' at `byLab.lc.sorting_ignored`: at the final read the recorded W31 sets opts.passageless (src/chain.js:1780), so an id-less must-do WITH a reason is a late finding (src/sorting.js:59), no longer a dropped row; its recorded-state coverage is test/s16-final-read-objection.test.js 'T21af / T17y (rating): a defect it cannot anchor is a late finding with the seat's rating'. The count of three malformed rows stays exact.
  const r = await scn({ 'final-read-lc': metWith([{ sort: 'may_leave', reason: 'no id' }, { id: OPEN, sort: 'maybe', reason: 'x' }, 'text']), 'final-read-ld': metWith('all must-do') });
  premise(r);
  const byLab = Object.fromEntries(r.result.finalRead.seats.map(e => [e.lab, e]));
  assert.equal(byLab.lc.sorting_ignored, 3, 'three malformed rows counted');
  assert.ok(!('sorting' in byLab.lc), 'no valid row, so no sorting key');
  assert.equal(byLab.ld.sorting_ignored, 1, 'a sorting that is not a list counts 1');
  assert.ok(!('sorting' in r.result.finalRead), 'nothing valid to combine');
});

test('S8-10 (NAMED PIN, the cap) the reason cap of src/sorting.js is the cap every other critic field is read at: REASON_CAP equals chain.js CRITIC_FIELD_MAX_CHARS (not importable without a cycle, so read from the source). Fail condition: the two numbers differ', () => {
  const { REASON_CAP } = need();
  const m = /const CRITIC_FIELD_MAX_CHARS = ([0-9_]+);/.exec(readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8'));
  assert.ok(m, 'chain.js still names CRITIC_FIELD_MAX_CHARS');
  assert.equal(REASON_CAP, Number(m[1].replace(/_/g, '')));
});

// CHANGED ACCEPTED (S8 c2b). OLD: an unknown id with sort must_do was ignored and counted (sorting_ignored 1). NEW: a must-do with a reason whose id is outside the list is a NEW defect (W7's last sentence): kept on the entry (sorting_new), not a sorting row, not counted ignored;
// a may_leave with an unknown id is still ignored and counted. WHY: condition d of the c2a PASS (the content must not be dropped). Red on 231f074a at the FIRST failing assertion `the unknown may-leave is counted, the unknown must-do is not` (that tree counts both: sorting_ignored 2); the entry assertion after it is first run in the set.
test('S8-11 (the list filters the reply) an id outside the list the seat was shown is never recorded as a sorting: a may-leave of it is ignored and counted, a must-do of it is a new defect and kept whole; an open id nobody sorted stays unsorted', async () => {
  setHeldForTest(SORTING);
  const r = await scn({ 'final-read-lc': metWith([{ id: OPEN, sort: 'must_do', reason: 'It holds.', criterion: SC_CRITERION }, { id: 'O-unknown0', sort: 'must_do', reason: 'A defect nobody listed.', criterion: SC_CRITERION }, { id: 'O-unknown1', sort: 'may_leave', reason: 'x' }]), 'final-read-ld': metWith([]) });
  premise(r);
  const byLab = Object.fromEntries(r.result.finalRead.seats.map(e => [e.lab, e]));
  assert.deepEqual(byLab.lc.sorting.map(x => x.id), [OPEN], 'only the known id is recorded as a sorting');
  assert.equal(byLab.lc.sorting_ignored, 1, 'the unknown may-leave is counted, the unknown must-do is not');   // red on 231f074a here (2)
  assert.equal(byLab.lc.sorting_new?.[0]?.reason, 'A defect nobody listed.', 'the new defect is kept on the entry');
  assert.ok(!('sorting' in byLab.ld) && !('sorting_ignored' in byLab.ld) && !('sorting_new' in byLab.ld), 'ld sorted nothing: the open id stays unsorted');
  assert.deepEqual(r.result.finalRead.sorting.map(x => x.id), [OPEN]);
});

test('S8-12 (prompt wiring) with all four words in force the final read\'s system text carries W7 and the reply form directly before the reply-format sentence, and its user text carries the list of open objections with their ids (the problem inside the claim container)', async () => {
  setHeldForTest(SORTING);
  const r = await scn({ 'final-read-lc': MET, 'final-read-ld': MET });
  premise(r);
  const p = r.prompts.get('final-read-lc');
  assert.ok(p, 'the prompt of final-read-lc was seen');
  const at = p.system.indexOf('Reply with a single JSON object and nothing else:');
  assert.ok(at > 0, 'premise: the reply-format sentence is in the system text');
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row S8-12): OLD: HS8.layerThreeSortingRule() and HS8.layerThreeSortingForm() (the held W7 and S8's form). NEW: the final read's recorded W7 (W7_AT_FINAL_READ: W32's sentence in, W31's two closing-read clauses out) and the recorded final-read reply form (RC.finalReadSortingForm). WHY: error 'W7 is in the system text' at the first line below: the final read carries W31/W32's recorded words (src/stage-system.js:94-109), so the held W7 is not a substring and S8's form is absent (its indexOf is -1).
  assert.ok(p.system.includes(W7_AT_FINAL_READ()), 'W7 is in the system text');
  assert.ok(p.system.indexOf(RC.finalReadSortingForm()) > 0 && p.system.indexOf(RC.finalReadSortingForm()) < at, 'the form sits before the reply-format sentence');
  // CHANGED ACCEPTED (S8 money step; a pin: the header is test data, so no counting red). OLD: `The open objections and late findings to sort, ...`. NEW: the header names only what the list holds, and this list has no late finding. WHY: a climb verdict's list has none (WORDING row for the items header).
  assert.ok(p.user.includes('The open objections to sort, with the id your sorting must use for each:'), 'the list header is in the user text');
  assert.ok(p.user.includes(`- ${OPEN} (raised in layer 1; rated 5.0`), 'the open objection is listed with its id, layer and rating');
  assert.match(p.user, new RegExp(`- ${OPEN}[^\\n]*<critic-claim>`), 'its problem is inside the claim container');
});

// REMOVED (0.8.4 apply, K7): S8-13 (NAMED PIN, any one S8 word held): it compared the final read's text of the run `setHeldForTest(DEMAND)` with the runs `{ ...SORTING, [gone]: undefined }` and expected them byte-identical. Job 12 error: 'layerThreeSortingRule held, final-read-lc: system text unchanged' (the first, `DEMAND`-only run now carries the recorded W7, form and items, the others have one held off). The three S8 words are recorded (src/roles.js), so the first run is no longer the 'none' state, and a map naming a 0.8.4 word undefined is the banned HELD_OFF map (src/held-roles.js:15). The whole row is the held state. Sibling (same file): S8-12 (all four words in force: W7 and the form before the reply-format sentence, the list in the user text) and the other S8 rows that run on the recorded words.

// CHANGED ACCEPTED (S8 c2b). OLD: an unknown-id must-do was ignored and counted. NEW: it is returned as `fresh` (a new defect) when it has a reason; an unknown-id may-leave, and a must-do with no reason, stay ignored and counted. Red on 231f074a at `fresh` (absent).
test('S8-14 readSorting(raw, knownIds): with a known-id Set an id outside it is never a sorting row; a must-do with a reason is returned as a new defect (fresh), anything else is ignored and counted; without a Set the rows are read as before', () => {
  const { readSorting } = need();
  const raw = [{ id: 'o1', sort: 'must_do', reason: 'r', criterion: CRITERION }, { id: 'o9', sort: 'may_leave', reason: 'r' }, { id: 'o8', sort: 'must_do', reason: 'new defect', criterion: CRITERION }, { id: 'o7', sort: 'must_do' }];
  const got = readSorting(raw, new Set(['o1']));
  assert.deepEqual(got.rows.map(r => r.id), ['o1']);
  assert.deepEqual(got.fresh?.map(f => [f.id, f.reason]), [['o8', 'new defect']], 'fresh: the must-do with a reason');
  assert.equal(got.ignored, 2, 'the may-leave and the must-do with no reason are counted');
  assert.deepEqual(readSorting(raw).rows.map(r => r.id), ['o1', 'o9', 'o8', 'o7']);
});

// CHANGED ACCEPTED (S8 money step, C&C's Q-B). OLD: the problem was cut to 300 characters before it was wrapped (a number with no derivation: it removes the text layer 3 sorts on). NEW: the problem is printed WHOLE inside the container (it is capped upstream at the field cap).
// Red on fbb65694 at `the problem is printed whole`.
test('S8-15 sortingItemsOf builds the list and the known ids in one place: the build check\'s open objections (severity read as rating) then the late findings, one item per id, the problem printed whole inside the container, an unanchored objection flagged from its own item', () => {
  const S2 = need();
  assert.equal(typeof S2.sortingItemsOf, 'function', 'src/sorting.js exports sortingItemsOf');
  const { sortingItemsOf } = S2;
  const long = 'x'.repeat(500);
  const { items, knownIds, unanchored, problems, objections } = sortingItemsOf({
    open: [{ id: 'O-1', lab: 'la', layer: 1, severity: 5, flags: ['not debated'], problem: long }, { id: 'O-1', layer: 1, problem: 'dup' }, { id: 'O-2', layer: null, problem: 'two', unanchored: true }],
    late: [{ id: 'L-1', rating: null, flags: [], problem: 'late' }],
    wrap: s => `<w>${s}</w>`,
  });
  assert.deepEqual(items.map(i => [i.id, i.kind, i.rating, i.layer]), [['O-1', 'objection', 5, 1], ['O-2', 'objection', null, null], ['L-1', 'late finding', null, null]]);
  assert.equal(items[0].problem, `<w>${long}</w>`, 'the problem is printed whole');
  assert.deepEqual(items[1].flags, ['unanchored'], 'the item\'s own anchor flag becomes the flag in the list');
  assert.deepEqual([...knownIds].sort(), ['L-1', 'O-1', 'O-2']);
  assert.deepEqual([...unanchored], ['O-2'], 'the anchor flag is read from the item, not asked of a callback');
  assert.equal(problems.get('O-1'), long);
  assert.equal(objections.get('O-1').lab, 'la', 'the raiser is kept for the seam');
});

// ---- c2b: the record side. Red tree = 231f074a's src + these tests; each run row asserts its premise first.
const LF = await import('../src/late-finding.js');
const lateOf = r => (r.result.lateFindings ?? []).filter(x => x.found === 'final_read');   // the closing read's own; the ending exchange's, if the run has any, are not this row's concern
const sorted = rows => rows.map(x => [x.lab, x.found, x.flags.join('+'), x.sorted?.sort]);

test('S8-16 (W7 last sentence, condition d) a must-do whose id is outside the list is a NEW defect: it is recorded as a late finding (found final_read, flagged named_in_final_read, and ungrounded when its quote is not in the plan) with the seat\'s own words kept, sorted must-do by that seat; it is no sorting row and not counted ignored', async () => {
  setHeldForTest(SORTING);
  const r = await scn({ 'final-read-lc': metWith([{ id: OPEN, sort: 'must_do', reason: 'It holds.', criterion: SC_CRITERION }, { id: 'X-new', sort: 'must_do', reason: 'The retry limit has no back-off.', criterion: SC_CRITERION, quote: 'a passage the plan does not hold' }]), 'final-read-ld': MET });
  premise(r);
  const rows = lateOf(r);
  assert.equal(rows.length, 1, 'the new defect is recorded as a late finding');
  const f = rows[0];
  assert.match(f.id, /^L-[0-9a-f]{8}$/);
  assert.deepEqual([f.lab, f.found, f.problem, f.not_debated, f.rating], ['lc', 'final_read', 'The retry limit has no back-off.', true, null]);
  assert.deepEqual(f.flags, ['named_in_final_read', 'ungrounded'], 'the late-finding rule: a quote the plan does not hold is ungrounded');
  assert.deepEqual([f.sorted.sort, f.sorted.seats, f.sorted.reasons.map(x => x.reason)], ['must_do', ['lc'], ['The retry limit has no back-off.']]);
  assert.ok(!('sorting_ignored' in r.result.finalRead.seats.find(e => e.lab === 'lc')), 'not counted ignored');
  assert.deepEqual(r.result.finalRead.sorting.map(x => x.id), [OPEN], 'and it is no sorting row');
});

// REMOVED (0.8.4 apply, K7, job 12 row S8-17 'the id-less new defect with its passage is kept'): the row's premise is the held state of W31 (the final read's own words not recorded): an entry with NO id and the passage it is about becomes a LATE FINDING, 'grounded when its quote is in the plan'. WHY: error `0 !== 1` at `rows.length` (lateOf(r), found 'final_read'): W31 is recorded, so at the final read a quote that IS in the plan is an OBJECTION of the final read (src/chain.js:1783-1790 `anchored` goes to finalReadObjections, not to the late findings), and no shipped path puts a grounded id-less quote into late_findings. The late-finding half that survives (a quote the plan does not hold, or no passage) is minted the same way. Siblings (other file; the same file has no id-less recorded-state row, S8-16 is the id-given one; that file's own header says 'test/s8-sorting.test.js S8-16/17/18 hold the W7 state without it'): test/s16-final-read-objection.test.js 'T21ae: a defect no open objection names, quoted from the plan and rated 5.0, is an objection of the final read ...' (its reply is the id-less sorting entry `{ sort: 'must_do', reason, criterion, quote: 'retries failed requests', rating: 5 }`; assertions `assert.match(lc.failures[0].id, /^O-[0-9a-f]{8}$/)` and `assert.deepEqual(r.result.lateFindings ?? [], [], 'it is no late finding')`) and 'T21af / T17y (rating): a defect it cannot anchor is a late finding with the seat's rating (the key `rating`) and holds nothing' (assert.match(rows[0].id, /^L-[0-9a-f]{8}$/): the reader-given L- id on an id-less entry).

// CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row S8-18): OLD: the id-less passage-less must-do was read at the FINAL read (the closing read), where it was ignored and counted. NEW: the same entry is read at layer 3's CLIMB verdict (goUpRun: the shipped go-up path, pass 3 of test/s8-sorting.test.js's go-up fixture), the read that still ignores and counts it. The final-read half moved out: it is test/s16-final-read-objection.test.js 'T21af / T17y (rating)' (a late finding with the seat's rating). WHY: error `undefined !== 1` at `lc.sorting_ignored`: at the final read W31 sets opts.passageless (src/chain.js:1780, src/sorting.js:59), so the entry is a late finding there; the climb read passes no `passageless` (src/chain.js climbSortingOf), so there `reason && quote` fails and `ignored += 1` (src/sorting.js:59). The pin's fail condition is unchanged: a passage-less id-less entry is recorded as a late finding or as sorting_new.
test('S8-18 (Q3, NAMED PIN: green on the parent, which ignores every id-less entry) an entry with no id and no passage is ignored and counted, not recorded. Fail condition: a passage-less id-less entry is recorded as a late finding or on the entry as sorting_new (read at layer 3\'s climb verdict: at the final read, with W31 recorded, it is a late finding: test/s16-final-read-objection.test.js T21af)', async () => {
  const r = await goUpRun([{ sort: 'must_do', reason: 'The worker never backs off.', criterion: SC_CRITERION }]);
  goUpPremise(r);
  const row = r.result.panelVerdicts.find(v => v.lab === 'top-gamma' && v.round === 3);
  assert.equal(row.sorting_ignored, 1);
  assert.ok(!('sorting_new' in row));
  assert.ok(!('sorting' in row), 'no sorting row either');
  assert.deepEqual((r.result.lateFindings ?? []).filter(x => x.found === 'last_verdict' || x.found === 'final_read'), []);
});

test('S8-19 withSorted puts layer 3\'s sorting on the late findings it names and leaves the others null', () => {
  assert.equal(typeof LF.withSorted, 'function', 'src/late-finding.js exports withSorted');
  const rows = [{ id: 'L-aaaaaaaa', sorted: null }, { id: 'L-bbbbbbbb', sorted: null }];
  const out = LF.withSorted(rows, [{ id: 'L-aaaaaaaa', sort: 'may_leave', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'may_leave', reason: 'Minor.' }] }]);
  assert.deepEqual(out.map(r => r.sorted && r.sorted.sort), ['may_leave', null]);   // red on 231f074a at the export line above
  assert.deepEqual(rows.map(r => r.sorted), [null, null], 'the input is not changed');
});

const LATE_ROW = (extra = {}) => ({ id: 'L-aaaaaaaa', lab: 'lc', problem: 'No back-off.', rating: null, rating_read_as: '4 or above', flags: [], found: 'ending_exchange_last_round', round: 1, not_debated: true, sorted: null, ...extra });
// S8 follow-up (no default 3): the late-findings functions take the run's top layer as an argument; these pins are about a three-layer run, so the fixture passes 3 and every pinned sentence keeps its bytes (C&C: fixture first).
const LF3 = { renderLateFindingsBoard: rows => LF.renderLateFindingsBoard(rows, 3), withLateFindings: (h, rows) => LF.withLateFindings(h, rows, 3) };
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: '... they hold no sign-off, and layer 3 has not sorted them. They are listed in the order of their rating; ...'. NEW: '... they hold back no sign-off, and layer 3 has not sorted them. They are listed from the highest rating down; ...'. WHY: src/late-finding.js renderLateFindingsBoard (apply f60ebad2; the late-findings board sentence).
test('S8-20 (NAMED PIN, green on the parent) the late-findings board and handoff sections read byte for byte as before while layer 3 has sorted nothing and found nothing. Fail condition: any byte differs for rows of the S4b shape', () => {
  const plain = LF3.renderLateFindingsBoard([LATE_ROW()]);
  assert.equal(plain, '## Late findings (found in the last round of the ending exchange; not debated)\n\nThese defects were first found in the last round, where no round was left to debate them. They are not objections: they hold back no sign-off, and layer 3 has not sorted them. They are listed from the highest rating down; one with no valid rating reads as 4 or above.\n\n- L-aaaaaaaa (lc; not rated, read as 4 or above): No back-off.\n\n');
  assert.match(LF3.withLateFindings('H', [LATE_ROW()]), /\nThe ending exchange found these defects in its last round/);
  assert.doesNotMatch(LF3.withLateFindings('H', [LATE_ROW()]), /sorted by layer 3/);
});

test('S8-20b once layer 3 has sorted a finding or found one at its final read, every line says whether layer 3 sorted it ("not yet sorted by layer 3" for the rest); the board heading names the final read; the handoff names the final read only when it found one', () => {
  const mixed = LF3.renderLateFindingsBoard([LATE_ROW({ sorted: { sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'It holds.' }] } }), LATE_ROW({ id: 'L-bbbbbbbb' })]);
  // CHANGED ACCEPTED again (S8 money step): the heading names the readers with an "or" that stays true for the final read and the last verdict. Red on fbb65694 at this line.
  assert.match(mixed, /^## Late findings \(found in the last round of the ending exchange, or by layer 3 at its final read or its last verdict; not debated\)/);
  assert.match(mixed, /- L-aaaaaaaa \(lc; not rated, read as 4 or above; sorted by layer 3: must-do\): No back-off\. Layer 3's reason: It holds\./);
  assert.match(mixed, /- L-bbbbbbbb \(lc; not rated, read as 4 or above; not yet sorted by layer 3\): No back-off\./);
  const sortedOnly = LF3.withLateFindings('H', [LATE_ROW({ sorted: { sort: 'may_leave', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'may_leave', reason: 'Minor.' }] } })]);
  assert.match(sortedOnly, /sorted by layer 3: may-leave/);
  assert.match(sortedOnly, /\nThe ending exchange found these defects in its last round/, 'layer 3 only sorted an ending-exchange finding: the final read found nothing');
  // CHANGED ACCEPTED (S8 c2b fix-up, C&C's read of f851a748). OLD: a list of final-read findings only was introduced by `The ending exchange and layer 3's final read found these defects`, false when no ending exchange found anything. NEW: the intro names who found them, by the rows' `found`. Red on f851a748 at the first assertion below.
  const sortedRow = { sort: 'must_do', seats: ['lc'], reasons: [] };
  const readOnly = LF3.withLateFindings('H', [LATE_ROW({ found: 'final_read', sorted: sortedRow })]);
  assert.match(readOnly, /^H\n\n## Late findings \(not debated\)\n\nLayer 3 found these defects where no round was left to debate them\./, 'layer-3 findings only: the ending exchange is not named');
  assert.doesNotMatch(readOnly, /The ending exchange/);
  const both = LF3.withLateFindings('H', [LATE_ROW({ found: 'final_read', sorted: sortedRow }), LATE_ROW({ id: 'L-bbbbbbbb' })]);
  assert.match(both, /^H\n\n## Late findings \(not debated\)\n\nThe ending exchange and layer 3 found these defects/, 'both kinds: both are named');
  const lastVerdict = LF3.withLateFindings('H', [LATE_ROW({ found: 'last_verdict', sorted: sortedRow })]);
  assert.match(lastVerdict, /\n\nLayer 3 found these defects/, 'a finding of the last verdict reads the same');
});

test('S8-21 (T9a) a seat that already read this plan is not asked and is listed in final_read.reused with what it had said (its last verdict and round); recorded only while the sorting is on', async () => {
  const chain = () => chainOf([critic('mock-critic-script-o-fra1-s8', 'l1', 1), critic('mock-critic-script-o-fra2-s8', 'l2', 2), critic('mock-critic-script-o-fra3-s8', 'l3', 3)], { answer_back: { enabled: true }, final_read: { enabled: true } });
  setHeldForTest(SORTING);
  scripted(() => undefined);
  const on = await go(chain());
  assert.equal(on.passed, true, 'premise: every layer signed off');
  assert.equal(on.finalRead.ran, false, 'premise: nobody was asked');
  assert.ok(Array.isArray(on.finalRead.reused), 'final_read.reused is recorded');
  assert.deepEqual(on.finalRead.reused.map(x => [x.lab, x.layer, x.statement?.verdict]), [['l3', 3, 'signed_off']]);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row also ran the chain with the sorting held off (DEMAND alone) and asserted that final_read.reused was not recorded. NEW: removed. WHY: the S8 words are recorded (src/prompts/recorded-084-s8.js), so the sorting is on in every shipped layered run; sibling assertions above pin final_read.reused.
});

test('S8-22 (condition e) the anchor of an open objection is read from the record it came from by the one rule of src/anchor.js: a ledger row with no quote is unanchored, one with a quote is not, an attached quote counts, and a later record of the same objection that holds a quote fills one the first lacked', () => {
  const { withAnchor } = need();
  assert.equal(typeof withAnchor, 'function', 'src/sorting.js exports withAnchor');
  const base = { id: 'O-1', layer: 1, flags: [], problem: 'p' };
  assert.equal(withAnchor(base, { id: 'O-1' }).unanchored, true, 'a ledger row with no quote');
  assert.equal(withAnchor(base, { id: 'O-1', quote: 'retries failed requests' }).unanchored, undefined);
  assert.equal(withAnchor(base, { id: 'O-1', attached_quote: 'retries failed requests' }).unanchored, undefined, 'an exchange-attached quote counts');
  const first = withAnchor(base, { id: 'O-1' });
  const merged = withAnchor(first, { id: 'O-1', quote: 'retries failed requests' });
  assert.deepEqual([merged.unanchored, merged.quote], [undefined, 'retries failed requests'], 'the second record fills the quote the first lacked');
  assert.equal(withAnchor({ id: 'O-2', quote: 'kept' }, { id: 'O-2' }).unanchored, undefined, 'a quote already held is not lost');
});

test('S8-23 (run pin) the list the seat is shown flags the objection that quotes no passage and not the one that does, through the items\' own anchor flag', async () => {
  setHeldForTest(SORTING);
  const bare = { criterion: SC_CRITERION, problem: 'No back-off is stated.', fix: 'State one.', severity: 5 };
  const idb = objectionId('la', bare);
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'S8-23'): OLD: `extraFailures: [bare]` (no `relation`). NEW: `[{ ...bare, relation: 'new' }]`. WHY: the same cause as S8-5(T12m (the TAP's error line "premise: the run ends not agreed (on the recorded finish)  true !== false"): without its relation la's reply is unreadable (src/chain.js:5465-5468) and the run ends agreed. The id idb and the unanchored flag asserted below do not depend on the relation.
  const r = await scn({ 'final-read-lc': MET, 'final-read-ld': MET }, { extraFailures: [{ ...bare, relation: 'new' }] });
  premise(r);
  const user = r.prompts.get('final-read-lc').user;
  const line = id => user.split('\n').find(l => l.includes(id)) || '';
  assert.match(line(idb), /unanchored/);
  assert.doesNotMatch(line(OPEN), /unanchored/);
});

test('S8-24 sortingFindingsOf: a new defect becomes a late-finding input with the seat\'s words; the grounding comes from the one late-finding rule it is handed', () => {
  const { sortingFindingsOf } = need();
  assert.equal(typeof sortingFindingsOf, 'function', 'src/sorting.js exports sortingFindingsOf');
  const out = sortingFindingsOf({ perSeat: [{ seat: 'lc', fresh: [{ id: 'X', sort: 'must_do', reason: 'r1', criterion: 'c', quote: 'q' }, { sort: 'must_do', reason: 'r2' }] }], groundedWhy: ({ criterion, quote }) => (criterion && quote ? null : 'x'), round: 3 });
  assert.deepEqual(out.map(f => [f.lab, f.problem, f.flags.join('+'), f.round, f.found]), [['lc', 'r1', 'named_in_final_read', 3, 'final_read'], ['lc', 'r2', 'named_in_final_read+ungrounded', 3, 'final_read']]);
});

// CHANGED ACCEPTED (S8 c2b, C&C's schema condition): late_findings[].found was a constant (ending_exchange_last_round), `sorted` was null only, and the flags had two names. NEW: found may also be final_read, sorted may be an object, flags may name named_in_final_read;
// final_read gains reused and seats[].sorting_new. No existing test pinned the old constants (report-schema.test.js names none of these fields); this row is the pin. Red on 231f074a's schema at the first assertion.
test('S8-25 the report schema accepts a late finding found at the final read and sorted, a final read with reused[] and sorting_new, and still refuses an unknown found', async () => {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile({ ...schema, required: [] });
  const late = { id: 'L-0a1b2c3d', lab: 'lc', problem: 'No back-off.', rating: null, rating_read_as: '4 or above', flags: ['named_in_final_read', 'ungrounded'], found: 'final_read', round: 1, not_debated: true, sorted: { sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'r' }], ungrounded: true } };
  const seat = { lab: 'lc', layer: 3, label: 'final-read-lc', last_read_sha: null, reasked: false, read: true, meets: true, failures: [], sorting_new: [{ sort: 'must_do', reason: 'r', quote: 'q' }] };
  const fr = { ran: true, run_end: 'not_agreed', final_sha: 'abc', seats: [seat], sorting: [{ id: 'O-1', sort: 'must_do', seats: ['lc'], reasons: [], unanchored: true }], reused: [{ lab: 'l3', layer: 3, read_sha: 'abc', round: 1, statement: { verdict: 'signed_off' } }] };
  assert.equal(validate({ late_findings: [late], final_read: fr }), true, JSON.stringify(validate.errors));
  const pv = { round: 3, lab: 'lc', model: 'm', verdict: 'objected', sorting: [{ id: 'O-1', sort: 'may_leave', reason: 'r', reasons_shown_in: 4 }], sorting_new: [{ sort: 'must_do', reason: 'r' }], sorting_ignored: 1 };
  assert.equal(validate({ late_findings: [{ ...late, found: 'last_verdict', flags: ['named_in_sorting'] }], panelVerdicts: [pv] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ panelVerdicts: [{ ...pv, sorting: [{ ...pv.sorting[0], reasons_shown_in: 0 }] }] }), false, 'reasons_shown_in is a round: not 0');
  assert.equal(validate({ late_findings: [{ ...late, found: 'somewhere_else' }] }), false, 'an unknown found is refused');
  assert.equal(validate({ late_findings: [{ ...late, sorted: 'yes' }] }), false, 'sorted is an object or null');
});

// ---- the money step: the climb verdict's prompt, list and record, the seam, and the MAXIMUM term. Red tree = fbb65694's src + these tests (+ lanes.test.js, held-084-s8.js).
const mseat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const MCFG = { name: 's8-money', criteria: [SC_CRITERION], maxRounds: 4, maxOverseerRounds: 3, layerRevisions: { 1: 7, 2: 5 }, signoff: 'unanimous', answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [mseat('mock-critic-a', 'la', 1), mseat('mock-critic-b', 'lb', 2), mseat('mock-critic-c', 'lc', 3), mseat('mock-critic-d', 'ld', 3)] } };
const WORDS3 = ['layerThreeSortingRule', 'layerThreeSortingForm', 'layerThreeSortingItems'];
const textsOf = (label, seat) => systemTextsFor(label, MCFG, seat);
const lcSeat = MCFG.seats.critics[2]; const laSeat = MCFG.seats.critics[0]; const lbSeat = MCFG.seats.critics[1];

test('S8-26 the sorting predicate: only a TOP-layer seat of a layered chain with two layers or more sorts, and only while the sorting is on', () => {
  const climbSortingFor = SS.climbSortingFor;
  assert.equal(typeof climbSortingFor, 'function', 'src/stage-system.js exports climbSortingFor');
  setHeldForTest(SORTING);
  assert.deepEqual([laSeat, lbSeat, lcSeat].map(x => climbSortingFor(x, MCFG)), [false, false, true]);
  assert.equal(climbSortingFor(lcSeat, { ...MCFG, answer_back: undefined }), false, 'no ledger, no sorting');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: with DEMAND alone the predicate was false ('the words are held back'). NEW: that assertion is removed (the recorded predicate is pinned above and below). WHY: the S8 words are recorded (recorded-084-s8.js).
  assert.equal(climbSortingFor(lcSeat, { ...MCFG, seats: { ...MCFG.seats, critics: [mseat('x', 'one', 1)] } }), false, 'one layer is not a climb');
});

test('S8-27 (prompt, system) a top-layer seat\'s panel system text carries W7 and the reply form; a lower layer\'s panel text is byte for byte what it was; with any ONE of the three S8 words held back the top text is byte for byte the text without the sorting (the loop of S8-13, for the panel)', () => {
  setHeldForTest(DEMAND);
  const base = { top: textsOf('panel-L3-lc', lcSeat), low: textsOf('panel-L1-la', laSeat), mid: textsOf('panel-L2-lb', lbSeat) };
  setHeldForTest(SORTING);
  const on = { top: textsOf('panel-L3-lc', lcSeat), low: textsOf('panel-L1-la', laSeat), mid: textsOf('panel-L2-lb', lbSeat) };
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row S8-27): OLD: HS8.layerThreeSortingRule() whole. NEW: W7_AT_CLIMB() (the recorded W7 with W32's rating sentence); the form stays S8's recorded form (a panel read is not the final read). WHY: error 'W7 and the form are in every priced top text': lateFindingRatingSentence is recorded, so W32's sentence splits the held W7 string (src/stage-system.js:94-98).
  assert.ok(on.top.every(t => t.includes(W7_AT_CLIMB()) && t.includes(RC.layerThreeSortingForm())), 'W7 and the form are in every priced top text');
  assert.deepEqual(on.low, base.low, 'layer 1 is byte for byte');
  assert.deepEqual(on.mid, base.mid, 'layer 2 is byte for byte');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a loop proved that with any ONE of the three S8 words held back the top text was the text without the sorting. NEW: removed. WHY: the three S8 words are recorded (recorded-084-s8.js), so no shipped run holds one back.
  setHeldForTest(SORTING);
  assert.ok(panelPromptFor(lcSeat, false, undefined, MCFG).includes(W7_AT_CLIMB()), 'the text SENT is the one priced');   // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row S8-27): OLD: HS8.layerThreeSortingRule(). NEW: W7_AT_CLIMB(). WHY: as the row above (W32's sentence is in the recorded W7).
});

const rowOf = (cfg, max, label) => estimateChainRows(cfg, { maximum: max }).find(r => r.label === label);
// CHANGED ACCEPTED TEST (0.8.4 apply, group 7, C&C RULING_STEP5_6 C; figures printed in job 97, probe_s828). OLD: S8-28 compared the sorting ON against the sorting OFF on held maps (`setHeldForTest(DEMAND)` vs SORTING; the three S8 words and the W41 section set to `undefined` one by one): "the MAXIMUM figure of a top-layer review rises by 400 tokens per judge below the top layer, times the row's count,
// over what the added system text costs; the EXPECTED figure rises by the system text alone; a seat below the top layer does not move; with any ONE word held back neither figure moves". NEW: the same claims on the RECORDED state, by term, with no map (every word is recorded: recorded-084-s8.js, roles.js): the top row's maximum exceeds its expected figure by 400 x (the judges below the top layer) per call; the
// expected top row exceeds a lower seat's expected row by exactly the added S8 system text (W7 and the reply form); a lower seat carries the top layer's reasons section (400 x K3), the second layer also 400 x K1; the real off (answer_back removed) moves nothing. The WORDS3 held-back loop and 'a lower seat does not move while W41 is not recorded' are REMOVED: they set recorded names to `undefined`, a state no shipped run has.
test('S8-28 (money) the MAXIMUM figure of a top-layer review rises by 400 tokens per judge below the top layer, times the row\'s count; the EXPECTED figure of the top row exceeds a lower seat\'s by the S8 system text alone; a lower seat carries the top layer\'s reasons section by term; answer_back removed moves nothing', () => {
  setHeldForTest(null);   // the recorded state
  const rowAt = (cfg, max, label) => rowOf(cfg, max, label); const perCall = r => r.input / (r.times ?? 1);
  const below = MCFG.seats.critics.filter(k => k.layer < 3).length;   // la (layer 1) and lb (layer 2): 2 judges below the top layer
  const top = { max: rowAt(MCFG, true, 'panel-L3-lc'), exp: rowAt(MCFG, false, 'panel-L3-lc') };
  const times = top.max.times ?? 1;
  assert.equal((perCall(top.max) - perCall(top.exp)) * times, 400 * below * times, 'the list term: 400 tokens x the judges below the top layer x the row count (maximum minus expected, the same system text on both sides)');
  // the added system text is priced in the EXPECTED figure: the top row's expected per call exceeds a lower seat's by exactly the difference of their system texts (the estimator's unit: ceil(length / 4) of the longest system text of the label)
  const sysOf = (label, seat) => Math.max(0, ...textsOf(label, seat).map(t => estimateTokens(t)));
  const lowExp = rowAt(MCFG, false, 'panel-L1-la');
  assert.equal(perCall(top.exp) - perCall(lowExp), sysOf('panel-L3-lc', lcSeat) - sysOf('panel-L1-la', laSeat), 'the expected figure: the top row exceeds a lower row by the added system text alone');
  // a lower seat carries the top layer's reasons section (400 x K3), the second layer also the section that asks it to rule on layer 1 (400 x K1), by term
  const k3 = MCFG.seats.critics.filter(k => k.layer === 3).length; const k1 = MCFG.seats.critics.filter(k => k.layer === 1).length;
  const la = { max: rowAt(MCFG, true, 'panel-L1-la'), exp: rowAt(MCFG, false, 'panel-L1-la') }; const lb = { max: rowAt(MCFG, true, 'panel-L2-lb'), exp: rowAt(MCFG, false, 'panel-L2-lb') };
  assert.equal(perCall(la.max) - perCall(la.exp), 400 * k3, 'layer 1: the top layer\'s reasons section, 400 x K3');
  assert.equal(perCall(lb.max) - perCall(lb.exp), 400 * (k3 + k1), 'layer 2 of three: the reasons section (400 x K3) and the section that asks it to rule on layer 1 (400 x K1)');
  // the real off: no ledger (answer_back) -> no sorting, no reasons section, no list: every row of the maximum equals its expected row
  const { answer_back: _ab, ...noLedger } = MCFG;
  for (const label of ['panel-L1-la', 'panel-L2-lb', 'panel-L3-lc']) assert.equal(perCall(rowAt(noLedger, true, label)), perCall(rowAt(noLedger, false, label)), `${label}: answer_back removed -> maximum = expected`);
});

// The go-up fixture of test/s7c-reasons.test.js (copied: its helpers are not exported). Layer 2 hits its bound in pass 2, the plan goes up, layer 3 rules in pass 3 and objects there, so the raiser is asked again in pass 4. Layer 3's verdict in pass 3 is the climb verdict these rows score.
const GY = { criterion: SC_CRITERION, problem: 'No owner is named.', quote: 'The worker', severity: 5 };
const GL3 = { criterion: SC_CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 6 };
const gidY = objectionId('mid-beta', GY); const gidL3 = objectionId('top-gamma', GL3);
const gDraft = 'The worker retries failed requests.';
const gMeets = () => JSON.stringify({ meets: true, criteria: [{ criterion: SC_CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the go-up fixture's stub failures carried no relation. NEW: gObjects gives each failure relation 'new' unless it names one; mid-beta's second raise of GY in pass 2 is `continues <gidY>`. WHY: relationRule is recorded (NS-0193): a judge failure without its relation is an unreadable reply, and a `new` on a standing id mints #2.
const gObjects = (f, sorting) => JSON.stringify({ meets: false, criteria: [{ criterion: SC_CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [{ relation: 'new', ...f }], verdict_line: 'no', ...(sorting ? { sorting } : {}) });
const gWithdraws = id => JSON.stringify({ meets: true, criteria: [{ criterion: SC_CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
const GOUP = { goUpRulingSystem: HB084.goUpRulingSystem, goUpRulingUser: HB084.goUpRulingUser, goUpRulingsSection: HB084.goUpRulingsSection };
const G_REASON = 'Section two names the owner.';
const G_HEADING = "# Layer 3's reasons for objections of yours it overruled";
async function goUpRun(sorting, { rulings = [{ id: gidY, ruling: 'overrule', reason: G_REASON }], goUp = true, more = {}, rounds = 3, choices = null, delta = null } = {}) {
  const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest({ ...SORTING, ...(goUp ? GOUP : {}), layerThreeReasonsSection: HB084.layerThreeReasonsSection });   // without the go-up's own words the plan still goes up (chain.js layer2BoundGoUp) and the ruling is undecided (prompt_held): no rule- call
  const script = { 'panel-1-mid-beta': gObjects(GY), 'panel-2-mid-beta': gObjects({ ...GY, relation: `continues ${gidY}` }), 'rule-3-top-gamma': JSON.stringify({ rulings }), 'panel-3-top-gamma': gObjects(GL3, sorting), 'panel-4-mid-beta': gWithdraws(gidY), 'panel-4-top-gamma': gWithdraws(gidL3), ...(delta ? { 'panel-3-top-delta': delta.reply, 'panel-4-top-delta': delta.again } : {}), ...more };
  setCache({ invalidate() {}, get(label) {
    const text = label in script ? script[label] : (label.startsWith('panel-') || label.startsWith('final-read-')) ? gMeets() : label.startsWith('revise-') ? `${gDraft}\n\nRevision ${label.slice(7)}.` : gDraft;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-s8-goup', criteria: [SC_CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: rounds, layerRevisions: { 1: 1, 2: 1 }, seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3), ...(delta ? [seat('top-delta', 3)] : [])] } };
  try { return { result: await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s8-goup', log: () => {}, config, ...(choices ? { roundChoices: choices } : {}) }), prompts, config }; }
  catch (e) { if (e && e.stop) throw new Error(`premise: the run stopped at ${e.stop.kind}:${e.stop.overseer_round}:${e.stop.pass} (why ${e.stop.why}, layer ${e.stop.layer})`); throw e; }
}
const goUpPremise = r => {
  assert.ok(r.prompts.get('panel-3-top-gamma'), 'premise: layer 3 was asked in pass 3');
  assert.ok(r.prompts.get('panel-4-mid-beta'), 'premise: layer 3 objected and the raiser was asked again in pass 4');
};

test('S8-29 (climb: list, record) the top-layer seat is shown the objections open at its verdict (ids, layer, rating, the problem whole in the container) and its sorting is recorded on its verdict row with ids filtered; a seat below the top layer is shown no list and no W7; a may-leave outside the list is counted ignored', async () => {
  const r = await goUpRun([{ id: gidY, sort: 'may_leave', reason: 'Minor for the build.' }, { id: 'X-old', sort: 'may_leave', reason: 'Not listed.' }]);
  goUpPremise(r);
  const top = r.prompts.get('panel-3-top-gamma'); const mid = r.prompts.get('panel-2-mid-beta');
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row S8-29): OLD: HS8.layerThreeSortingRule() whole, in the positive and in the negative assertion. NEW: W7_AT_CLIMB() in both, and the negative also names S8's recorded reply form (a whole-W7 negative is true of any text that lacks the rating sentence, so it must move with the positive). WHY: error "W7 is in the top seat's system text": W32's sentence is recorded, so the held W7 is not a substring of a layer-3 climb prompt.
  assert.ok(top.system.includes(W7_AT_CLIMB()), 'W7 is in the top seat\'s system text');
  assert.ok(top.user.includes(`- ${gidY} (raised in layer 2; rated 5.0`), 'the open objection is listed');
  assert.ok(!mid.system.includes(W7_AT_CLIMB()) && !mid.system.includes(RC.layerThreeSortingForm()) && !mid.user.includes('to sort, with the id'), 'a lower seat is shown neither');
  const row = r.result.panelVerdicts.find(v => v.lab === 'top-gamma' && v.round === 3);
  assert.deepEqual(row.sorting.map(x => [x.id, x.sort]), [[gidY, 'may_leave']], 'the sorting is on the verdict row, ids filtered');
  assert.equal(row.sorting_ignored, 1, 'the may-leave outside the list is counted');
});

test('S8-30 (seam) layer 3\'s may-leave of an objection rated 4 or above is a row of the same source as an escalation ruling: with the go-up ruling undecided (the ruler names no ruling for it), the raiser\'s next review is shown layer 3\'s sorting reason for it (the W41 section is there only because of the sorting)', async () => {
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row S8-30): OLD: `{ goUp: false }`, the go-up words held back, so the ruling was undecided (prompt_held). NEW: the go-up words stay recorded and the ruler's reply names no ruling (`rulings: []`), so the ruling is undecided the shipped way (src/escalation.js settleRulings: why no_ruling, line 115). WHY: error "layer 3's sorting reason is in it": goUpRulingSystem/User/Section are recorded (the GOUP map only repeats them), so `goUp: false` still ran the ruling, the stub's default overrule of gidY decided it, and the escalation row displaced the sorting row (src/chain.js:4862-4866 ruledAlready, the behaviour S8-30b pins).
  const r = await goUpRun([{ id: gidY, sort: 'may_leave', reason: 'Minor for the build.' }], { rulings: [] });
  goUpPremise(r);
  const u = r.prompts.get('panel-4-mid-beta').user;
  assert.ok(u.includes(G_HEADING), 'the W41 section is shown');
  assert.ok(u.includes('Minor for the build.'), 'layer 3\'s sorting reason is in it');
});

test('S8-30b (seam, NAMED PIN: green on the parent, which has no sorting row) an objection the escalation ruled in the same round keeps the escalation\'s reasons and its record: the raiser is shown the ruling\'s reason and not the sorting\'s, and the escalation row still says in which round the reasons were first shown. Fail condition: the sorting row displaces the escalation\'s reason or its record', async () => {
  // RL-7's script (s7c-reasons.test.js): the raiser keeps the objection in pass 4 and withdraws it in pass 5, so `reasons_shown_in` is 4 and pass 5 does not move it
  const keeps = JSON.stringify({ meets: false, criteria: [{ criterion: SC_CRITERION, verdict: 'FAILED', evidence: GY.problem }], failures: [GY], verdict_line: 'no', answers: [{ id: gidY, status: 'sustained', evidence: 'No owner is named in section two.' }] });
  const r = await goUpRun([{ id: gidY, sort: 'may_leave', reason: 'Minor for the build.' }], { more: { 'panel-4-mid-beta': keeps, 'panel-5-mid-beta': gWithdraws(gidY), 'panel-5-top-gamma': gWithdraws(gidL3) } });
  goUpPremise(r);
  const u = r.prompts.get('panel-4-mid-beta').user;
  assert.ok(u.includes(G_REASON), 'the escalation\'s reason is shown');
  assert.ok(!u.includes('Minor for the build.'), 'the sorting reason is not');
  const rep = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-s8-goup', chain: 'fixture-s8-goup', task: 't.md', result: r.result, config: r.config })));
  assert.equal(rep.escalations[0].outcome[0].reasons_shown_in, 4, 'the escalation outcome row keeps its shown-in round');
});

test('S8-30c (the record half of the dedupe) with an escalation ruling and a sorting for the same objection in one round, the verdict row still carries the may-leave and its reason', async () => {
  const r = await goUpRun([{ id: gidY, sort: 'may_leave', reason: 'Minor for the build.' }]);
  goUpPremise(r);
  const row = r.result.panelVerdicts.find(v => v.lab === 'top-gamma' && v.round === 3);
  assert.deepEqual(row?.sorting?.map(x => [x.id, x.sort, x.reason]), [[gidY, 'may_leave', 'Minor for the build.']]);
});

const FR = await import('../src/final-read.js');
test('S8-31 (reused) a top-layer seat that is not asked at the final read is listed in reused with the sorting its last verdict row carries', () => {
  const out = FR.reusedEntries({ seats: [{ key: 'lc', lab: 'lc', layer: 3 }], panelVerdicts: [{ round: 2, lab: 'lc', verdict: 'signed_off', sorting: [{ id: 'O-1', sort: 'may_leave', reason: 'r' }] }], draftShaByRound: { 2: 'abc' }, finalSha: 'abc', mustRead: [] });
  assert.deepEqual(out.map(x => [x.lab, x.statement?.verdict]), [['lc', 'signed_off']], 'premise: the seat is listed with its verdict');
  assert.deepEqual(out[0].sorting?.map(x => [x.id, x.sort]), [['O-1', 'may_leave']], 'its sorting is listed');
});

// ---- the money step, continued: sorting_new at a climb, the last verdict, two top seats. Red tree = fbb65694 + these tests.
test('S8-32 (a middle climb) a defect the top-layer seat names only in its sorting, while the seat is asked again, is kept whole as sorting_new on its verdict row; no id is minted and no late finding is made', async () => {
  const r = await goUpRun([{ id: gidY, sort: 'may_leave', reason: 'Minor for the build.' }, { id: 'X-new', sort: 'must_do', reason: 'A new defect.', criterion: SC_CRITERION, quote: 'Revision 1.' }]);
  goUpPremise(r);
  assert.ok(r.prompts.get('panel-4-top-gamma'), 'premise: layer 3 is asked again in pass 4');
  const row = r.result.panelVerdicts.find(v => v.lab === 'top-gamma' && v.round === 3);
  assert.deepEqual(row?.sorting_new?.map(x => [x.reason, x.quote]), [['A new defect.', 'Revision 1.']], 'recorded whole on the verdict row');
  // the plan layer 3 read in pass 3 holds "Revision 1."; the plan at the run's end holds "Revision 3.": the grounding is read against the plan the seat read
  assert.equal(row.sorting_new[0].ungrounded_why, null, 'grounded against the plan the seat read, kept on the entry');
  assert.ok(!('sorting_ignored' in row), 'and not counted ignored');
  assert.deepEqual((r.result.lateFindings ?? []).filter(x => x.found === 'last_verdict'), [], 'the seat is asked again in pass 4: no late finding');
});

const lastVerdictRows = r => (r.result.lateFindings ?? []).filter(x => x.found === 'last_verdict');
const NEWDEF = [{ sort: 'must_do', reason: 'A new defect.', criterion: SC_CRITERION, quote: 'The worker' }];
test('S8-33 (the last verdict, layer 3 signs off) a defect layer 3 names only in its sorting at its last verdict becomes a late finding (found last_verdict, flag named_in_sorting, never debated, sorted must-do), so the handler, the board and the handoff see it; the run is still agreed or ended as it was', async () => {
  const signoffWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: SC_CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', sorting });
  const r = await goUpRun([], { more: { 'panel-3-top-gamma': signoffWith(NEWDEF) } });   // RL-4's shape (s7c-reasons): the go-up words and the overrule in place, layer 3 signs off after its ruling and the run ends
  assert.ok(r.prompts.get('panel-3-top-gamma'), 'premise: layer 3 was asked in pass 3 and signed off');
  assert.ok(![...r.prompts.keys()].some(l => /^panel-([4-9])-top-gamma$/.test(l)), 'premise: pass 3 was layer 3\'s last verdict');
  const rows = lastVerdictRows(r);
  assert.equal(rows.length, 1, 'the new defect is a late finding');
  assert.deepEqual([rows[0].lab, rows[0].problem, rows[0].flags, rows[0].not_debated, rows[0].rating, rows[0].sorted?.sort], ['top-gamma', 'A new defect.', ['named_in_sorting'], true, null, 'must_do']);
});

test('S8-34 (the last verdict, layer 3 objects at the overseer cap) the same: the run ends at the cap on a recorded finish, no round follows, and the defect is a late finding', async () => {
  const r = await goUpRun([], { rounds: 1, choices: [{ choice: 'finish', stop: 'overseer_cap:1:3', kind: 'overseer_cap' }], more: { 'panel-3-top-gamma': gObjects(GL3, NEWDEF) } });
  assert.ok(r.prompts.get('panel-3-top-gamma'), 'premise: layer 3 was asked in pass 3 and objected at the cap');
  assert.equal(r.result.stop?.chosen, 'finish', 'premise: the run ended on the recorded finish');
  assert.equal(lastVerdictRows(r).length, 1);
});

test('S8-35 (two top seats) two top-layer seats sort the same objection may-leave in one round: the raiser is shown both reasons, and BOTH sorting rows carry reasons_shown_in with that round', async () => {
  const GL3d = { criterion: SC_CRITERION, problem: 'Layer three has another concern.', quote: 'The worker', severity: 6 };
  const gidL3d = objectionId('top-delta', GL3d);
  const r = await goUpRun([{ id: gidY, sort: 'may_leave', reason: 'Minor for the build.' }], { goUp: false, delta: { reply: gObjects(GL3d, [{ id: gidY, sort: 'may_leave', reason: 'Agreed, minor.' }]), again: gWithdraws(gidL3d) } });
  goUpPremise(r);
  const shown = lab => r.result.panelVerdicts.find(v => v.lab === lab && v.round === 3)?.sorting?.[0]?.reasons_shown_in;
  assert.deepEqual([shown('top-gamma'), shown('top-delta')], [4, 4], 'both rows say in which round the raiser was shown their reasons');
  const u = r.prompts.get('panel-4-mid-beta').user;
  assert.ok(u.includes('Minor for the build.') && u.includes('Agreed, minor.'), 'both reasons are shown');
});

test('S8-36 (pure) a grounding the climb verdict stored on the entry is reused at run end, not read again against a later plan: stored null stays grounded though the function it is handed now says the quote is not in the plan', () => {
  const { sortingFindingsOf } = need();
  assert.equal(typeof sortingFindingsOf, 'function', 'premise: src/sorting.js exports sortingFindingsOf');
  const out = sortingFindingsOf({ perSeat: [{ seat: 'lc', fresh: [{ sort: 'must_do', reason: 'r', criterion: 'c', quote: 'q', ungrounded_why: null }, { sort: 'must_do', reason: 'r2', criterion: 'c', quote: 'q2', ungrounded_why: 'quote_not_in_plan' }] }], groundedWhy: () => 'quote_not_in_plan', found: 'last_verdict', flag: 'named_in_sorting' });
  assert.deepEqual(out.map(f => f.flags), [['named_in_sorting'], ['named_in_sorting', 'ungrounded']], 'the stored reason wins over the later plan');
});

const LV = extra => ({ id: 'L-aaaaaaaa', lab: 'lc', problem: 'A new defect.', rating: null, flags: ['named_in_sorting'], found: 'last_verdict', round: 3, not_debated: true, sorted: { sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'It holds.' }] }, ...extra });
test('S8-37 (the later word, per seat) the finder was not asked again at the final read and another top seat says may-leave: the finding stays must-do (any must-do wins, D12), with both words listed', () => {
  assert.equal(typeof LF.withSortedPerSeat, 'function', 'src/late-finding.js exports withSortedPerSeat');
  const [out] = LF.withSortedPerSeat([LV()], [{ seat: 'ld', rows: [{ id: 'L-aaaaaaaa', sort: 'may_leave', reason: 'Minor.' }] }]);
  assert.deepEqual([out.sorted.sort, out.sorted.seats], ['must_do', ['lc', 'ld']]);
});
test('S8-38 (the later word, per seat) the finder is asked again at the final read and says may-leave, and no other seat says must-do: the finding becomes may-leave (the seat\'s later word replaces only its own earlier word)', () => {
  assert.equal(typeof LF.withSortedPerSeat, 'function', 'src/late-finding.js exports withSortedPerSeat');
  const [out] = LF.withSortedPerSeat([LV({ sorted: { sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'It holds.' }], ungrounded: true } })], [{ seat: 'lc', rows: [{ id: 'L-aaaaaaaa', sort: 'may_leave', reason: 'On reflection, minor.' }] }]);
  assert.ok(!('ungrounded' in out.sorted), 'a may-leave is never flagged ungrounded');
  assert.deepEqual([out.sorted.sort, out.sorted.seats, out.sorted.reasons.map(x => x.reason)], ['may_leave', ['lc'], ['On reflection, minor.']]);
  const [other] = LF.withSortedPerSeat([{ ...LV(), found: 'final_read' }], [{ seat: 'ld', rows: [{ id: 'L-aaaaaaaa', sort: 'may_leave', reason: 'x' }] }]);
  assert.equal(other.sorted.sort, 'must_do', 'a row of another kind is not touched');
});

// ---- 0.8.4 S8, exit-list ruling T17m(2) (C&C 08 Nov 2026): the combined sort follows the closure's rule. An id is may_leave only when EVERY top-layer seat's closing word on it (read, else reused) is may_leave; a seat that gave no word counts as must-do.
// Red source (1): tree 21f8f8d2, whose combine ignores the second argument and records the lone seat's may_leave. Option B (C&C Q2): a late finding no seat sorted must-do and that not every seat sorted may-leave keeps `sorted` null.
test('S8-39 (T17m(2), run, S8-5\'s fixture) one top seat says may-leave and the other is silent: final_read.sorting records must_do for the id (the seat\'s own word stays in seats/reasons, no ungrounded flag), and the closure agrees (the entry is not closed)', async () => {
  setHeldForTest(SORTING);
  const r = await scn({ 'final-read-lc': metWith([{ id: OPEN, sort: 'may_leave', reason: 'Minor.' }]), 'final-read-ld': MET });
  premise(r);
  const fr = r.result.finalRead;
  assert.deepEqual(fr.seats.map(s => [s.lab, s.sorting?.map(x => [x.id, x.sort])]), [['lc', [[OPEN, 'may_leave']]], ['ld', undefined]], 'premise: lc sorted it may-leave and ld gave no sorting');
  const row = (fr.sorting || []).find(x => x.id === OPEN);
  assert.ok(row, 'premise: the combined record has a row for the open objection');
  assert.equal(row.sort, 'must_do', 'S8-39: one seat may-leave and one silent records must_do, not may_leave');
  assert.deepEqual(row.seats, ['lc'], 'S8-39: seats names the seat that spoke');
  assert.deepEqual(row.reasons.map(x => [x.seat, x.sort, x.reason]), [['lc', 'may_leave', 'Minor.']], 'S8-39: the seat\'s own word is kept unchanged');
  assert.ok(!('ungrounded' in row), 'S8-39: a must-do derived by silence is not flagged ungrounded');
  assert.ok(!('closed_by' in ((r.result.dispute?.open_objections || []).find(o => o.id === OPEN) || {})), 'S8-39: the closure agrees (a silent seat closes nothing)');
});
test('S8-40 (T17m(2), pure) combineSortings(perSeat, allSeats): may_leave only when every listed seat said may_leave; a must_do wins; a seat missing from the list of speakers makes the row must_do; without allSeats the rule is the old one byte for byte', () => {
  const { combineSortings } = need();
  const lc = { seat: 'lc', rows: [{ id: 'o1', sort: 'may_leave', reason: 'Minor.' }] };
  const ld = { seat: 'ld', rows: [{ id: 'o1', sort: 'may_leave', reason: 'Fine.' }] };
  const ldMust = { seat: 'ld', rows: [{ id: 'o1', sort: 'must_do', reason: 'It holds.', criterion: 'c' }] };
  const one = combineSortings([lc], ['lc', 'ld']);
  assert.deepEqual(one.map(x => [x.id, x.sort, x.seats]), [['o1', 'must_do', ['lc']]], 'S8-40: one speaker of two is must_do');
  assert.ok(!('ungrounded' in one[0]), 'S8-40: derived by silence, not flagged ungrounded');
  assert.deepEqual(combineSortings([lc, ld], ['lc', 'ld']).map(x => x.sort), ['may_leave'], 'S8-40: both said may_leave');
  assert.deepEqual(combineSortings([lc, ldMust], ['lc', 'ld']).map(x => x.sort), ['must_do'], 'S8-40: any must_do wins');
  assert.deepEqual(combineSortings([lc]).map(x => x.sort), ['may_leave'], 'S8-40: without allSeats the old rule stands');
  assert.deepEqual(combineSortings([lc], []).map(x => x.sort), ['may_leave'], 'S8-40: an empty allSeats is no seat list');
});
test('S8-41 (T17m(2), pure, C&C Q2 option B) a late finding that no seat sorted must-do and that not every top seat sorted may-leave keeps sorted null; the finder\'s later may-leave with a silent second seat leaves a last-verdict finding unsorted; with every seat may-leave it is sorted may-leave', () => {
  const derived = { id: 'L-aaaaaaaa', sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'may_leave', reason: 'Minor.' }] };
  const real = { id: 'L-bbbbbbbb', sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'It holds.' }], ungrounded: true };
  const rows = [{ id: 'L-aaaaaaaa', lab: 'lc', sorted: null }, { id: 'L-bbbbbbbb', lab: 'lc', sorted: null }];
  const out = LF.withSorted(rows, [derived, real]);
  assert.equal(out[0].sorted, null, 'S8-41: a must-do derived by silence puts no sorted on the late finding');
  assert.equal(out[1].sorted?.sort, 'must_do', 'S8-41: a real must-do is put on the row');
  const finder = { sorted: { sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'It holds.' }] } };
  const again = [{ seat: 'lc', rows: [{ id: 'L-aaaaaaaa', sort: 'may_leave', reason: 'On reflection, minor.' }] }];
  const [silent] = LF.withSortedPerSeat([LV(finder)], again, ['lc', 'ld']);
  assert.equal(silent.sorted, null, 'S8-41: the finder says may-leave on reflection and ld is silent: unsorted, not may-leave');
  const [both] = LF.withSortedPerSeat([LV(finder)], [...again, { seat: 'ld', rows: [{ id: 'L-aaaaaaaa', sort: 'may_leave', reason: 'Agreed.' }] }], ['lc', 'ld']);
  assert.deepEqual([both.sorted.sort, both.sorted.seats], ['may_leave', ['lc', 'ld']], 'S8-41: every seat may-leave is may-leave');
});
test('S8-42 (T17m(2), pure) a reused seat\'s word joins the combine: a seat that read fresh says may-leave and a reused seat\'s last verdict said must-do (or said nothing): must_do; both may-leave: may_leave (the run half is NOT DRIVEN: no run fixture with a reused seat and a fresh one at a final read)', () => {
  const { combineSortings } = need();
  const reusedOf = sorting => FR.reusedEntries({ seats: [{ key: 'ld', lab: 'ld', layer: 3 }], panelVerdicts: [{ round: 2, lab: 'ld', verdict: 'signed_off', ...(sorting ? { sorting } : {}) }], draftShaByRound: { 2: 'abc' }, finalSha: 'abc', mustRead: [] });
  const fresh = { seat: 'lc', rows: [{ id: 'o1', sort: 'may_leave', reason: 'Minor.' }] };
  const asRow = e => ({ seat: e.seat ?? e.lab, rows: e.sorting });
  const must = reusedOf([{ id: 'o1', sort: 'must_do', reason: 'It holds.', criterion: 'c' }]);
  assert.ok(must[0].sorting, 'premise: the reused entry carries its sorting');
  assert.deepEqual(combineSortings([fresh, asRow(must[0])], ['lc', 'ld']).map(x => x.sort), ['must_do'], 'S8-42: a reused must-do wins');
  const may = reusedOf([{ id: 'o1', sort: 'may_leave', reason: 'Fine.' }]);
  assert.deepEqual(combineSortings([fresh, asRow(may[0])], ['lc', 'ld']).map(x => x.sort), ['may_leave'], 'S8-42: both may-leave (one reused) is may_leave');
  const none = reusedOf(null);
  assert.deepEqual(combineSortings([fresh], ['lc', 'ld']).map(x => x.sort), ['must_do'], 'S8-42: a reused seat with no sorting row is silent: must_do');
  assert.equal(none[0].sorting, undefined, 'premise: that reused entry has no sorting');
});
