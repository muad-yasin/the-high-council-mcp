// 0.8.4 S8 (M3), the closing-read rows T9g, T13l and T13t: one fixture and one set of assertions per row, shared by the committed rows (test/s8-closing-rows.test.js: run(), the correct behaviour)
// and by the red-only file that is never committed (test/s8-closing-rows-red.test.js: run(true), the SAME assertions on the SWAPPED INPUT, so the box shows a real red with the failing assertion's message).
// Offline, mock seats, $0. No import from any *.test.js (that would run its tests). Every global the fixture sets is reset in the `finally` of its run and again by the test files' afterEach.
import assert from 'node:assert/strict';
import { runChain, RoundStopped, setPromptSpy, setCache, setBudget, setOutboundScan } from '../../src/chain.js';
import { setHeldForTest } from '../../src/held-roles.js';
import { computeOutcome } from '../../src/outcome.js';
import { SORTING } from './rating-demand.js';
import { critic, chainOf, neverHeardChain } from './final-read-chain.js';
import { objectionId } from '../../src/objection-ids.js';
import { scenario, CRITERION } from './layer-two-run.js';

const frLabels = r => r.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));   // calls counted by recorded stage label, as test/s8-sorting.test.js:34 does

// ================================================================== T9g
// Spec (FEATURE_SPECS:1459): a finish at E3's safety stop (the found-secret pause) on a plan text that BOTH layer-3 seats have read as it stands; expect 0 calls and their last statements as the read. Failing case: a fresh read of 2 calls is made.
// The finish is the in-process stand-in of the person's recorded --finish (test/secret-pause-cut.test.js:21): setOutboundScan({ finish: true }) makes the FIRST cache miss of a pass loop throw SecretFinish (src/chain.js:2058); the cache stub of
// test/helpers/layer-two-run.js misses only for the labels named in `cutLabels`.
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];   // test/s8-sorting.test.js:108
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });   // s8-sorting.test.js:109 (EV of layer-two-run.js:7)
// lc objects in pass 1 with a rated-5 objection (the failure shape of layer-two-run.js:9, the reply shape of s8-sorting.test.js:90); la and lb sign off, ld signs off by the stub's default (layer-two-run.js:19)
const LC_OBJECTS = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ criterion: CRITERION, problem: 'No back-off is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5, relation: 'new' }], verdict_line: 'no' });
// pass 2 (S16): lc raises the objection again and sorts it must-do, ld signs off and sorts it may-leave; both were shown it on their lists (T9a's shape, test/helpers/s8-stop-rows.js)
const X_FAILURE = { criterion: CRITERION, problem: 'No back-off is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5 };
const X_ID = objectionId('lc', X_FAILURE);
const LC_OBJECTS_SORTED = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ ...X_FAILURE, relation: `continues ${X_ID}` }], verdict_line: 'no', sorting: [{ id: X_ID, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }] });
const LD_SORTED = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting: [{ id: X_ID, sort: 'may_leave', reason: 'Minor for the build.' }] });
// The same STOPPED guard as s8-sorting.test.js:113: a run that stops at a choice is a fixture error and says where.
const STOPPED = async fn => { try { return await fn(); } catch (e) { if (e && e.stop) throw new Error(`premise: the run stopped at ${e.stop.kind}:${e.stop.overseer_round}:${e.stop.pass} (why ${e.stop.why}, layer ${e.stop.layer}): the fixture did not reach its cut`); throw e; } };

/** variant=false: the cut is the reviser call of pass 1 (`revise-1`), after both layer-3 seats read the plan and before it was rewritten. variant=true (the SWAPPED INPUT, red-only): the cut is `panel-2-la` instead, so revise-1 ran, the plan changed, and neither layer-3 seat has read it as it stands. */
export async function runT9g(variant = false) {
  const cutLabel = variant ? 'panel-3-la' : 'revise-2';   // CHANGED ACCEPTED (0.8.4 S16, RU-ADD-A12). OLD: the cut came after pass 1, with lc's objection open and listed to nobody at layer 3 (cutLabel revise-1 / panel-2-la). NEW: one pass later, as T9a (test/helpers/s8-stop-rows.js): in pass 2 lc and ld sort the objection from the list they were shown. WHY: a seat that read exactly this text is reused only if its sorting covers every open objection (src/final-read.js coverageGaps); in the OLD fixture ld had never been shown lc's objection, so the closing read would ask it, and the row's claim (0 calls on a plan read as it stands) holds only for a fixture whose open objections the seats sorted.
  setHeldForTest(SORTING);
  setOutboundScan({ finish: true });
  try {
    // 'final-read-lc'/'-ld' are scripted MET in BOTH runs: the committed run never asks them; the variant asks them, and a stub default (the plan text) would be unreadable and make 4 calls instead of the spec's 2.
    const r = await STOPPED(() => scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'panel-1-la': MET, 'panel-1-lc': LC_OBJECTS, 'panel-2-lc': LC_OBJECTS_SORTED, 'panel-2-ld': LD_SORTED, 'final-read-lc': MET, 'final-read-ld': MET }, extra: {}, cutLabels: [cutLabel] }));
    return { variant, cutLabel, result: r.result, served: r.served };
  } finally { setOutboundScan({}); setHeldForTest(null); }
}

export function checkT9g({ variant, cutLabel, result, served }) {
  // ---- premises: what the fixture must have done before the thing under test
  assert.equal(result.passed, false, 'T9g premise: the run ends not agreed');
  const st = result.stop;
  assert.ok(st, 'T9g premise: the run ended on a recorded stop');
  assert.deepEqual([st.kind, st.chosen], ['secret_pause', 'finish'], 'T9g premise: the run ended at the found-secret pause, on the finish');
  assert.equal(st.label, cutLabel, `T9g premise: the finish cut the run at ${cutLabel}, the call the fixture left unanswered`);
  assert.equal(st.pass, variant ? 3 : 2, 'T9g premise: the cut came in the pass the fixture names');
  assert.ok(served.includes(cutLabel), 'T9g premise: the cut call was asked of the cache');
  assert.ok(!result.stages.some(s => s.label === cutLabel), 'T9g premise: the cut call was never sent or recorded');
  assert.deepEqual(result.panelVerdicts.filter(v => v.layer === 3).map(v => [v.lab, v.round, v.verdict, !!v.cut]).sort(), [['lc', 1, 'objected', false], ['lc', 2, 'objected', false], ['ld', 1, 'signed_off', false], ['ld', 2, 'signed_off', false]], 'T9g premise: both layer-3 seats gave a readable verdict in rounds 1 and 2 and none is marked cut');
  assert.ok(result.finalRead, 'T9g premise: the chain has the final read on, so the record exists');
  // ---- the thing under test
  assert.deepEqual(frLabels(result), [], 'T9g: a finish at the found-secret pause on a plan text that both layer-3 seats have read as it stands makes no closing-read call (failing case: a fresh read of 2 calls is made)');
  assert.ok(!served.some(l => l.startsWith('final-read-')), 'T9g: the cache was never asked for a final-read label');
  const fr = result.finalRead;
  assert.equal(fr.ran, false, 'T9g: the closing read did not run');
  assert.equal(fr.reason, 'every_top_seat_read_this_plan', 'T9g: the reason is that every top seat read this plan');
  assert.deepEqual(fr.seats, [], 'T9g: nobody was asked, so there are no entries');
  assert.equal(fr.run_end, 'not_agreed', 'T9g: the run ends not agreed');
  assert.ok(Array.isArray(fr.reused), 'T9g: final_read.reused is recorded (the sorting is on)');
  assert.deepEqual(fr.reused.map(x => [x.lab, x.layer, x.round, x.statement?.verdict]), [['lc', 3, 2, 'objected'], ['ld', 3, 2, 'signed_off']], 'T9g: the read is the two seats\' last statements, from round 2');
  assert.ok(fr.reused.every(x => x.read_sha === fr.final_sha), 'T9g: each reused statement was made on exactly the final plan');
}

// ================================================================== T13l / T13t
// Spec (FEATURE_SPECS:1246, 1247): a closing read of a plan text that neither layer-3 seat has read as it stands, whose statements are unreadable twice: at most 2 x K3 = 4 calls (one read and one re-ask per seat); the closing read costs 4 calls, not 2.
// Behavioural half only (the price half, Cl = 4 / "priced at 6 / at 2", belongs to another unit). Base: the A1 end of test/helpers/final-read-chain.js:10 with BOTH layer-3 seats `mock-unreadable` (src/providers.js:191).
// SWAPPED INPUT (variant): the helper's own neverHeardChain, where l3a answers readably (a scripted sign-off) and only l3b is unreadable: 3 calls (test/final-read-stage.test.js:61).
const FR = {};   // final-read-stage.test.js:36. CHANGED ACCEPTED (0.8.4 S16, N6): the final read has no switch; OLD { final_read: { enabled: true } }
const T13_LABELS = ['final-read-l3a', 'final-read-l3a-reask1', 'final-read-l3b', 'final-read-l3b-reask1'];   // runFinalRead's labels, src/final-read.js:23 and :24 (finalReadLabel, FINAL_READ_REASK_SUFFIX)
const bothUnreadable = (tag, extra = {}) => chainOf([
  critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-s8c-fr2-' + tag, 'l2a', 2),
  critic('mock-unreadable', 'l3a', 3), critic('mock-unreadable', 'l3b', 3),
], extra);
const go = config => runChain({ request: 'A mock task.', log: () => {}, runId: 'r-s8-closing', config });   // final-read-stage.test.js:38 (the log is not read here)
const memo = new Map();

/** One run serves T13l and T13t (memoised per variant), with a prompt spy that lists every prompt sent. CHANGED ACCEPTED (0.8.4 S16, N6): OLD it ran a twin with the closing read off as the control; the read has no switch, so the control is what the run itself records (see t13Premise). */
export function runT13(variant = false) {
  if (!memo.has(variant)) memo.set(variant, (async () => {
    const chainOn = variant ? neverHeardChain('s8c-t13-ctl', FR) : bothUnreadable('on', FR);
    const calls = [];
    try {
      setPromptSpy(p => { calls.push(p.label); });   // fires before the cache read (src/chain.js:1939), so it lists every call that was sent
      // CHANGED ACCEPTED (0.8.4 S16, D; Q9(e), N6): OLD the run ended not agreed with both layer-3 entries "did not read". NEW a run in which NO layer-3 seat read does not end: it STOPS at the final-read stop (RoundStopped), after the same 4 calls.
      const on = await go(chainOn).catch(e => { if (e instanceof RoundStopped && !variant) return e; throw e; });
      return on instanceof RoundStopped ? { variant, stopped: on, calls: calls.filter(l => l.startsWith('final-read-')) } : { variant, on, calls: calls.filter(l => l.startsWith('final-read-')) };
    } finally { setPromptSpy(null); setCache(null); setBudget(null); }
  })());
  return memo.get(variant);
}

function t13Premise({ on, calls }) {
  assert.equal(on.passed, false, 'T13 premise: the run ends not agreed');
  assert.deepEqual(on.layers.map(x => `${x.layer}:${x.state}`), ['1:unheard', '2:not_asked', '3:not_asked'], 'T13 premise: layer 1 was never heard, so nobody at layer 3 has read the plan');
  assert.ok(!on.panelVerdicts.some(v => v.layer === 3), 'T13 premise: no layer-3 verdict row before or after the closing read');
  assert.ok(on.finalRead && on.finalRead.ran === true, 'T13 premise: the closing read ran');
  assert.deepEqual(on.finalRead.seats.map(s => s.last_read_sha), [null, null], 'T13 premise: neither layer-3 seat had read any plan before the closing read');
  assert.deepEqual(on.finalRead.seats.map(s => s.lab), ['l3a', 'l3b'], 'T13 premise: both layer-3 seats were asked, in panel order');
  assert.ok(calls.length > 0, 'T13 premise: the prompt spy saw the closing read');
}

function checkT13Stopped({ stopped, calls }) {
  assert.ok(stopped instanceof RoundStopped, 'T13: the run stopped');
  assert.deepEqual([stopped.stop.kind, stopped.stop.why, stopped.stop.attempt], ['layer_bound', 'final_read', 0], 'T13: nobody read the final plan, so the run stops at the final-read stop instead of ending');
  assert.deepEqual([...calls].sort(), T13_LABELS, 'T13l/T13t: before the stop, the closing read made exactly 4 calls, a read and one re-ask for each of the two seats (counted at the prompt spy)');
}
export function checkT13l(data) {
  if (data.stopped) return checkT13Stopped(data);
  const { on, calls } = data;
  t13Premise(data);
  assert.deepEqual(frLabels(on).sort(), T13_LABELS, 'T13l: the closing read of a never-read plan with unreadable statements makes exactly 4 recorded calls, a read and one re-ask for each of the two seats (failing case: priced at 6)');
  assert.deepEqual([...calls].sort(), T13_LABELS, 'T13l: the same 4 prompts were sent (counted at the prompt spy, not by stage records)');
  assert.deepEqual(on.finalRead.seats.map(s => [s.lab, s.layer, s.read, s.reasked, s.label]), [['l3a', 3, false, true, 'final-read-l3a'], ['l3b', 3, false, true, 'final-read-l3b']], 'T13l: both entries are "did not read" and re-asked');
  for (const s of on.finalRead.seats) assert.match(s.why, /.+/, `T13l: ${s.lab} says why it did not read`);
  // the controls are the run's own record (S16): layers and passed are asserted in the premise, panelVerdicts holds no layer-3 row, signoff[] names no layer-3 seat, and the outcome is what it is without the read's record
  assert.ok(!on.signoff.some(x => ['l3a', 'l3b'].includes(x.lab)), 'T13l: signoff[] is not touched by the closing read');
  assert.equal(computeOutcome(on), computeOutcome({ ...on, finalRead: undefined }), 'T13l: the ending is not touched by the closing read');
}

export function checkT13t(data) {
  if (data.stopped) return checkT13Stopped(data);
  const { on } = data;
  t13Premise(data);
  assert.equal(frLabels(on).length, 4, 'T13t: the closing read costs 4 calls, 2 x K3 (failing case: it is priced at 2)');
  assert.notEqual(frLabels(on).length, 2, 'T13t: the closing read is not 2 calls');
  assert.equal(data.calls.length, 4, 'T13t: 4 prompts were sent');
}
