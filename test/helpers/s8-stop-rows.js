// 0.8.4 S8 (M3), the stop rows T11b and T9a: one fixture and one set of assertions per row, shared by the committed rows (test/s8-stop-rows.test.js: run<ROW>(), the correct behaviour)
// and by the red-only file that is never committed (test/s8-stop-rows-red.test.js: run<ROW>(swapped), the SAME assertions on a SWAPPED INPUT, so the box shows a real red with the failing assertion's message).
// Offline, mock seats, $0. No import from any *.test.js (that would run its tests). Every global a fixture sets is reset in the `finally` of its run and again by the test files' afterEach.
// Pattern: test/helpers/s8-closing-rows.js (runT9g / checkT9g) and test/helpers/s8-handler-rows.js. Premises first (each true in the green run AND in the swapped run, message `<ROW> premise:`), then the targets (message `<ROW>:`).
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, setOutboundScan, RoundStopped } from '../../src/chain.js';
import { setHeldForTest } from '../../src/held-roles.js';
import { objectionId } from '../../src/objection-ids.js';
import { stopOffersContinue } from '../../src/overseer-rounds.js';
import { SORTING } from './rating-demand.js';
import { scenario, CRITERION, DRAFT } from './layer-two-run.js';

const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });   // test/l3-finished-run.test.js:24 (CRITERION = layer-two-run.js:6 = l3-finished-run.test.js:20)

// ================================================================================================================================================================================
// T11b (Q11): the run stops at the overseer cap in the 4th overseer round: resumable, not agreed, with the top seat's sorting attached to the stopped partial and no extra layer-3 call (no closing read before the choice).
// Spec (FEATURE_SPECS.md:1166): "the same in round 4; expect the run stops, resumable and not agreed, with the sorting attached and no extra layer-3 call. Failing case: a fifth round opens without a continue."
// Fixture: test/l3-finished-run.test.js:81 (L3-6c, the overseer_cap stop below seven with no stall) over its `run()` :35-49 and its `script`/`reply` :28-33, with THREE changes, each of which the S8 sorting needs:
//   (1) the S8 words (SORTING, test/helpers/rating-demand.js:11) are held for the whole run (the copy of `run()` does not call setHeldForTest(null) first, as l3-finished-run.test.js:36 does);
//   (2) every scripted failure carries a rating of 5 (the rating demand is in force with SORTING, so src/chain.js:1211-1213 makes an unrated failure an unreadable verdict, and the cap stop would never be reached);
//   (3) the top seat's reply from the second pass on names the one objection that is open on its list (the objection it raised one pass earlier, listed by the ledger: src/objection-ledger.js:28 and src/chain.js:4561-4574) in a `sorting`,
//       and `final_read: { enabled: true }` is on, so "no closing read" is not vacuous. The cap is 4 overseer rounds (the spec's "round 4"), not 2.
// SWAPPED INPUTS (red-only): variant `true` = the chain's cap is 5 overseer rounds, so a fifth round opens without a continue (the spec's own failing case); variant 'word' = the top seat's last reply sorts the listed id with a word readSorting
// rejects ('must-do', src/sorting.js:39), so no sorting is attached to the stopped partial. Both keep every premise.
// The "no closing read before the choice" half is a NAMED PIN: no input makes a final-read label appear before the stop is thrown. FAIL CONDITION (the check below): a label starting `final-read-` is served to the cache, or a stage with
// such a label is on the partial, in the run that ends on the RoundStopped. WHY no input can: the RoundStopped is thrown inside the pass loop (src/chain.js:6207) and the closing read runs after the loop (src/chain.js:7144).
// ================================================================================================================================================================================
const TOP = 'top-gamma';   // l3-finished-run.test.js:22
const LOW = 'raiser-alpha';   // :23
const MID = 'mid-beta';   // :46
const QUOTES = ['The worker', 'retries failed', 'failed requests', 'The worker retries', 'retries failed requests', 'worker retries failed'];   // :28
const F = i => ({ criterion: CRITERION, problem: `Problem ${i}.`, quote: QUOTES[i], fix: 'Fix it.', severity: 5, relation: 'new' });   // :29 T(i), plus the rating (change 2) and the relation (each pass raises a different quote, so each is a first raise)
const idF = i => objectionId(TOP, F(i));   // the id of the top seat's objection raised in pass i+1 (:32 objectionId(lab, T(k-2)))
const WITHDRAW_EVIDENCE = 'It reads "The worker retries failed requests."';   // :30 withdraws(); the quote is in every draft the stub writes (the stub's DRAFT, layer-two-run.js:7, is the first line of each)
const sortReason = i => `Objection ${i + 1} holds.`;
// KNOWN PROPERTY of this fixture (not a gap): the id the top seat sorts at a pass is one it withdraws in the SAME reply (l3-finished-run.test.js:32, the withdraw-and-raise script that keeps the stop a plain cap stop). Keeping it open instead would make it stand through
// two verdicts under stall_rounds 2 and turn the stop into the stalled cap stop of L3-6d (src/chain.js:6087-6115). The sorting is read against the list the seat was SHOWN (the id is on it), not against what the reply withdraws.
const LAST_PASS = 4;   // the pass of the 4th overseer round: the layers below sign off every pass, so each overseer round is one pass (l3-finished-run.test.js:32, 6c)

/** The top seat's reply in pass k (k >= 1): raises F(k-1), withdraws F(k-2) (:32 objectsAnswering + withdraws) and, from pass 2 on, sorts the one id on its list (F(k-2)) must_do. `badWord`: the 'word' variant writes 'must-do'. */
const topReply = (k, badWord) => JSON.stringify({
  meets: false, criteria: [crow('FAILED')], failures: [F(k - 1)],
  ...(k > 1 ? { answers: [{ id: idF(k - 2), status: 'withdrawn', evidence: WITHDRAW_EVIDENCE }], sorting: [{ id: idF(k - 2), sort: badWord && k === LAST_PASS ? 'must-do' : 'must_do', reason: sortReason(k - 2), criterion: CRITERION }] } : {}),
  verdict_line: 'no',
});

export async function runT11b(variant = false) {
  const cap = variant === true ? 5 : 4;
  const badWord = variant === 'word';
  const served = []; const prompts = new Map();
  const out = { variant, cap, served, prompts, idListed: idF(LAST_PASS - 2) };
  try {
    setHeldForTest(SORTING);
    setPromptSpy(p => { prompts.set(p.label, p); });
    const script = Object.fromEntries(Array.from({ length: cap }, (_, i) => [`panel-${i + 1}-${TOP}`, topReply(i + 1, badWord)]));
    setCache({ invalidate() {}, get(label) {   // l3-finished-run.test.js:37-41, plus the served list
      served.push(label);
      const text = label in script ? script[label] : label.startsWith('panel-') ? JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok' }) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
      return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    } });
    const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });   // :42
    const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };   // :43
    const config = { name: 'fixture-t11b', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, final_read: { enabled: true },   // :44, plus final_read
      maxOverseerRounds: cap, layerRevisions: { 1: 1, 2: 1 },   // :45 (the `ov` branch)
      seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat(MID, 2), seat(TOP, 3)] } };   // :46
    out.config = config;
    try { out.result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-t11b', log: () => {}, config }); } catch (e) { out.error = e; }   // :47
  } finally { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); }
  return out;
}

export function checkT11b(d) {
  const err = d.error; const stop = err?.stop; const partial = err?.partial;
  const topRow = round => (partial?.panelVerdicts ?? []).find(v => v.lab === TOP && v.round === round);
  // ---- premises: what the fixture must have done before the thing under test (true in the green run and in every swapped run)
  assert.ok(err instanceof RoundStopped, `T11b premise: the run ended on a RoundStopped (a stop for the person), not on a result or another error (${String(err?.stack || err || 'it returned a result')})`);
  assert.equal(stop?.kind, 'overseer_cap', 'T11b premise: the stop is the overseer-round cap (kind overseer_cap), the stop of test/l3-finished-run.test.js:81');
  assert.deepEqual([stop?.rounds, stop?.cap], [d.cap, d.cap], 'T11b premise: all of the chain\'s overseer rounds were used (rounds = cap = the chain\'s maxOverseerRounds)');
  assert.equal(stop?.pass, stop?.overseer_round, 'T11b premise: one pass per overseer round (the layers below sign off every pass), so the stop\'s pass is its overseer round');
  assert.equal(stop?.chosen, undefined, 'T11b premise: no choice is on the stop yet (the person has not chosen)');
  assert.equal(d.config.final_read?.enabled, true, 'T11b premise: the chain has the closing read on, so its absence below is not vacuous');
  assert.ok(partial && Array.isArray(partial.panelVerdicts), 'T11b premise: the stop carries the run so far (partial.panelVerdicts)');
  assert.deepEqual([topRow(LAST_PASS)?.layer, topRow(LAST_PASS)?.verdict], [3, 'objected'], 'T11b premise: the top layer gave a readable objection in the 4th pass (the stop is not at a lower layer, and the rated reply was read)');
  assert.ok(d.served.includes(`panel-${LAST_PASS}-${TOP}`), 'T11b premise: the top seat was asked in the 4th pass');
  assert.deepEqual((topRow(LAST_PASS - 1)?.sorting ?? []).map(x => [x.id, x.sort]), [[idF(1), 'must_do']], 'T11b premise: the fixture\'s sorting is read at all: the top seat\'s verdict row of the 3rd pass carries its sorting (id from the list it was shown)');
  assert.equal(topRow(LAST_PASS - 1)?.sorting_ignored, undefined, 'T11b premise: nothing of the top seat\'s 3rd-pass sorting was ignored');
  assert.ok((d.prompts.get(`panel-${LAST_PASS}-${TOP}`)?.user ?? '').includes(d.idListed), 'T11b premise: the top seat was shown, on its list at the 4th pass, the objection it raised in the 3rd (else its sorting of it is ignored and the fixture, not the code, decides)');
  assert.deepEqual(d.served.filter(l => /reask/.test(l)), [], 'T11b premise: no seat was re-asked (every scripted reply was read at the first ask)');
  // ---- the thing under test
  assert.deepEqual(d.served.filter(l => /^panel-5-/.test(l)), [], 'T11b: no fifth round opens without a continue (failing case: a fifth round opens): no panel call of a pass beyond the 4th is made');
  assert.deepEqual([stop.pass, stop.overseer_round, stop.rounds], [LAST_PASS, LAST_PASS, LAST_PASS], 'T11b: the run stops at the cap after the 4th overseer round (pass 4)');
  assert.equal(partial.passed, false, 'T11b: the stopped run is not agreed');
  assert.equal(stopOffersContinue(stop), true, 'T11b: the stop is resumable: it offers the person a continue (and a finish)');
  const row = topRow(stop.pass);
  assert.deepEqual((row?.sorting ?? []).map(x => [x.id, x.sort, x.reason]), [[d.idListed, 'must_do', sortReason(LAST_PASS - 2)]], 'T11b: the top seat\'s sorting is attached to the stopped partial (its verdict row of the last pass carries the sorting rows, ids from the list it was shown)');
  assert.equal(row?.sorting_ignored, undefined, 'T11b: nothing of the top seat\'s sorting was ignored');
  // NAMED PIN half: FAIL CONDITION in the comment above runT11b.
  assert.deepEqual(d.served.filter(l => l.startsWith('final-read-')), [], 'T11b: no closing-read (final-read-*) label was asked before the choice (failing case: an extra layer-3 call)');
  assert.deepEqual((partial.stages ?? []).map(s => s.label).filter(l => l.startsWith('final-read-')), [], 'T11b: no closing-read stage is on the stopped partial');
}

// ================================================================================================================================================================================
// T9a (Q9): a finish on a plan text that both layer-3 seats have read exactly as it stands: 0 layer-3 calls, each seat's statement AND sorting reused.
// Spec (FEATURE_SPECS.md:1452): "a finish on a plan text that both layer-3 seats have read exactly as it stands; expect 0 layer-3 calls and each seat's statement and sorting reused. Failing case: a new layer-3 call."
// Fixture: runT9g (test/helpers/s8-closing-rows.js:26-35), a --finish cut by setOutboundScan({ finish: true }) with cutLabels (test/helpers/layer-two-run.js:13,19), both layer-3 seats lc and ld read, lc objected, ld signed off.
// What is new, because a sorting is kept only for ids on the list the seat was shown (src/chain.js:4789 readSorting(.., list.knownIds)) and a pass's list holds the objections of EARLIER rounds only (the ledger is filled after the pass's verdicts: src/chain.js:5837-5839,
// and src/objection-ledger.js:28 keeps an unanswered objection active): the cut is one pass later. Pass 1 is T9g's (lc raises the rated-5 objection X, everyone else signs off). Pass 2: lc raises X again (listing it again counts as holding it, no answer needed:
// src/answer-back.js:104-108) and sorts X must-do; ld signs off and sorts X may-leave; both lists carry X. The cut is `revise-2` (the reviser call after pass 2), so the plan both seats read in pass 2 is the plan as the run ends.
// SWAPPED INPUT (red-only): the cut is the first label of pass 3 (`panel-3-la`), so revise-2 ran, the plan was rewritten after layer 3 read it, and the closing read asks both seats (T9g's own swap, one pass later).
// ================================================================================================================================================================================
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];   // s8-closing-rows.js:18
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });   // s8-closing-rows.js:19
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });   // s8-sorting.test.js:110
const LC_FAILURE = { criterion: CRITERION, problem: 'No back-off is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5 };   // s8-closing-rows.js:21
const lcObjects = (relation, sorting) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ ...LC_FAILURE, relation }], verdict_line: 'no', ...(sorting ? { sorting } : {}) });   // s8-closing-rows.js:21 (+ the sorting key)
const idLC = objectionId('lc', LC_FAILURE);
const LC_WORDS = [{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }];
const LD_WORDS = [{ id: idLC, sort: 'may_leave', reason: 'Minor for the build.' }];

export async function runT9a(variant = false) {
  const cutLabel = variant ? 'panel-3-la' : 'revise-2';
  const out = { variant, cutLabel, idLC };
  setHeldForTest(SORTING);
  setOutboundScan({ finish: true });
  try {
    try {
      // 'final-read-lc'/'-ld' are scripted MET in BOTH runs (s8-closing-rows.js:31): the green run never asks them; the swapped run asks them.
      const r = await scenario({ answerBack: true, l1Severity: 5, critics: L3,
        overrides: { 'panel-1-la': MET, 'panel-1-lc': lcObjects('new'), 'panel-2-lc': lcObjects(`continues ${idLC}`, LC_WORDS), 'panel-2-ld': metWith(LD_WORDS), 'final-read-lc': MET, 'final-read-ld': MET },
        extra: { final_read: { enabled: true } }, cutLabels: [cutLabel] });
      Object.assign(out, { result: r.result, served: r.served, prompts: r.prompts });
    } catch (e) { out.error = e; }   // a run that stopped at a choice (RoundStopped) or failed is DATA: the first premise of checkT9a names it
  } finally { setOutboundScan({}); setHeldForTest(null); }
  return out;
}

export function checkT9a(d) {
  const e = d.error;
  // ---- premises: what the fixture must have done before the thing under test (true in the green run and in the swapped run)
  assert.equal(e, undefined, `T9a premise: the run ended with a result, not an error (${e?.stop ? `it stopped at ${e.stop.kind}:${e.stop.overseer_round}:${e.stop.pass} (why ${e.stop.why}, layer ${e.stop.layer}): the fixture did not reach its cut` : String(e?.stack || e)})`);   // as s8-closing-rows.js:23 STOPPED, as data
  const { variant, cutLabel, result, served, prompts, idLC: id } = d;
  const wordsOf = (lab, round) => result.panelVerdicts.find(v => v.layer === 3 && v.lab === lab && v.round === round);
  const frLabels = result.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));   // calls counted by recorded stage label (s8-closing-rows.js:12)
  assert.equal(result.passed, false, 'T9a premise: the run ends not agreed');
  const st = result.stop;
  assert.ok(st, 'T9a premise: the run ended on a recorded stop');
  assert.deepEqual([st.kind, st.chosen], ['secret_pause', 'finish'], 'T9a premise: the run ended at the found-secret pause, on the finish');
  assert.equal(st.label, cutLabel, `T9a premise: the finish cut the run at ${cutLabel}, the call the fixture left unanswered`);
  assert.equal(st.pass, variant ? 3 : 2, 'T9a premise: the cut came in the pass the fixture names');
  assert.ok(served.includes(cutLabel), 'T9a premise: the cut call was asked of the cache');
  assert.ok(!result.stages.some(s => s.label === cutLabel), 'T9a premise: the cut call was never sent or recorded');
  assert.deepEqual(result.panelVerdicts.filter(v => v.layer === 3).map(v => [v.lab, v.round, v.verdict, !!v.cut]).sort(), [['lc', 1, 'objected', false], ['lc', 2, 'objected', false], ['ld', 1, 'signed_off', false], ['ld', 2, 'signed_off', false]], 'T9a premise: both layer-3 seats gave a readable verdict in rounds 1 and 2 and none is marked cut');
  assert.ok(result.finalRead, 'T9a premise: the chain has the final read on, so the record exists');
  assert.deepEqual(served.filter(l => /reask/.test(l)), [], 'T9a premise: no seat was re-asked (every scripted reply was read at the first ask)');
  assert.ok((prompts.get('panel-2-lc')?.user ?? '').includes(id) && (prompts.get('panel-2-ld')?.user ?? '').includes(id), 'T9a premise: both layer-3 seats were shown the open objection on their list at pass 2 (else a sorting of it is ignored and the fixture, not the code, decides)');
  assert.deepEqual([wordsOf('lc', 2), wordsOf('ld', 2)].map(r => (r?.sorting ?? []).map(x => [x.id, x.sort])), [[[id, 'must_do']], [[id, 'may_leave']]], 'T9a premise: each seat\'s verdict row of round 2 carries its sorting, ids from the list it was shown');
  assert.deepEqual([wordsOf('lc', 2), wordsOf('ld', 2)].map(r => r?.sorting_ignored), [undefined, undefined], 'T9a premise: nothing of either seat\'s sorting was ignored');
  // ---- the thing under test
  assert.deepEqual(frLabels, [], 'T9a: a finish on a plan text that both layer-3 seats have read as it stands makes no layer-3 call (failing case: a new layer-3 call)');
  assert.ok(!served.some(l => l.startsWith('final-read-')), 'T9a: the cache was never asked for a final-read label');
  const fr = result.finalRead;
  assert.equal(fr.ran, false, 'T9a: the closing read did not run');
  assert.equal(fr.reason, 'every_top_seat_read_this_plan', 'T9a: the reason is that every top seat read this plan');
  assert.deepEqual(fr.seats, [], 'T9a: nobody was asked, so there are no entries');
  assert.ok(Array.isArray(fr.reused), 'T9a: final_read.reused is recorded (the sorting is on)');
  assert.deepEqual(fr.reused.map(x => [x.lab, x.layer, x.round, x.statement?.verdict]), [['lc', 3, 2, 'objected'], ['ld', 3, 2, 'signed_off']], 'T9a: both seats\' statements are reused: their last statements, from round 2');
  assert.deepEqual(fr.reused.map(x => [x.lab, (x.sorting ?? []).map(s => [s.id, s.sort, s.reason])]), [['lc', [[id, 'must_do', LC_WORDS[0].reason]]], ['ld', [[id, 'may_leave', LD_WORDS[0].reason]]]], 'T9a: both seats\' sortings are reused, by id, sort and reason');
  assert.ok(fr.reused.every(x => x.read_sha === fr.final_sha), 'T9a: each reused statement was made on exactly the final plan (read_sha = final_sha)');
}
