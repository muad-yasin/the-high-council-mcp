// 0.8.4 S18 (spec l.1486, D31, D38; T21cb, T21bj, T21ca): the cases at a not-agreed ending where NOTHING waits for a sorting and the objection of the final read stays must-do: no handling session (the record says nobody decided it: final_read.decided_by "none"), both layer-3 seats object, and the other layer-3 seat gave no usable reply
// after its one re-ask. The wait for the handler's sorting itself (one seat objects, the other signed) is in test/s18-sort-wait.test.js. The handler's disagreement note ADDED AFTER the ending (T21bj, T21ca) is `council note-add`, a verb on a finished run (the owner said yes, Q4.3, 09 Nov 2026): its half is in test/s18-note-verb.test.js; this file keeps the "nothing waits, must-do"
// half. Offline, mock seats, $0; the final read's own words (W31, W32) and the sorting words are HELD and injected. Fixture: T21o of test/s16-run-rows.test.js (a person's finish at the overseer-round limit; the dispute rewrite changes the text, so both layer-3 seats read it) and the s16-final-read-objection fixture
// (no handler), COPIED. Written without a run (no tests on the laptop): the first box run decides the fixtures. The reds are the parent commit (no decided_by) and swapped-input variants (S18_SWAPS.json).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, ExternalPause, setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { isAgreed } from '../src/ending.js';
import { SORTING } from './helpers/rating-demand.js';
import { W31 } from './helpers/w31-held.js';
import { scenario, CRITERION, failureOf } from './helpers/layer-two-run.js';
import { handlerSortSystem, handlerSortUser } from './held-prompts/held-084-b.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const OBJ5 = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });
const newDefect = rating => ({ sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: 'retries failed requests', rating });
// lc objected to the plan in the climb (panel-1-lc). Its objection at the final read is a verdict that does not meet, with its failures (the shape the real judge gives), on a passage of its own: a `sorting` entry with the SAME criterion and passage as its climb objection is that objection restated on the same id (test/s18-restated-objection.test.js), which these fixtures do not test.
const objectsWith = rows => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: rows.map(r => ({ criterion: r.criterion, problem: r.reason, fix: 'Back off between tries.', quote: r.quote, severity: r.rating })), verdict_line: 'no' });
const REWRITE = 'The worker retries failed requests up to five times, with a pause between tries.';
const CRITICS = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const choiceOf = (stop, choice) => roundChoiceEntry(stop, choice, null);

// a handling session: the climb stops at the overseer-round limit, the person finishes, the dispute rewrite changes the text, both layer-3 seats read the rewrite at the final read
async function withHandler(finalReads) {
  setHeldForTest({ ...SORTING, ...W31, handlerSortSystem, handlerSortUser });   // W40 is injected: if the case WERE a split, the run would wait (the pins below fail then)
  const opts = { answerBack: true, handler: true, critics: CRITICS, extra: { maxOverseerRounds: 1, dispute: { enabled: true, stall_rounds: 2 } }, overrides: { 'panel-1-la': MET, 'panel-1-lc': OBJ5, dispute: REWRITE, ...finalReads } };
  let first = null;
  try { await scenario(opts); } catch (e) { if (e instanceof RoundStopped) first = e; else throw e; }
  assert.equal(first?.stop?.kind, 'overseer_cap', 'premise: the climb stops at the overseer-round limit');
  try { return { r: await scenario({ ...opts, runExtra: { roundChoices: [choiceOf(first.stop, 'finish')] } }) }; } catch (e) { if (e instanceof ExternalPause) return { wait: e }; throw e; }
}
const lcFailure = r => r.result.finalRead.seats.find(e => e.lab === 'lc')?.failures?.[0];
const handled = r => (r.result.finalRead.sorting || []).filter(x => x.by === 'handler');

test('T21cb: a run with NO handling session in which a layer-3 seat objects to the final text: nothing waits, the objection is open and must-do, and the record says that nobody decided it (final_read.decided_by "none")', async () => {
  const HANDLING = false;   // whether the run has a handling session
  setHeldForTest({ ...SORTING, ...W31 });
  setOutboundScan({ finish: true });
  let r; try { r = await scenario({ answerBack: true, l1Severity: 5, critics: CRITICS, handler: HANDLING, overrides: { 'final-read-lc': metWith([newDefect(5)]), 'final-read-ld': MET }, extra: {}, cutLabels: ['revise-1'] }); } finally { setOutboundScan({}); }
  assert.equal(lcFailure(r)?.severity, 5, 'premise: lc objected at the final read with a holding objection (rated 5)');
  assert.equal(isAgreed(r.result), false, 'premise: the run ends not agreed, nothing waited (the run returned)');
  assert.equal(r.result.finalRead.decided_by, 'none', 'T21cb: the record says nobody decided the objection');
});

test('T21bj: BOTH layer-3 seats object to the final text (a handling session exists): nothing waits, each objection stays open and must-do, and the record does not say "nobody decided"', async () => {
  const BOTH_OBJECT = true;   // whether the other layer-3 seat objects too (false: it signs, and the case is the split of the wait)
  const d = await withHandler({ 'final-read-lc': objectsWith([{ ...newDefect(5), quote: 'with a pause between tries' }]), 'final-read-ld': BOTH_OBJECT ? metWith([newDefect(6)]) : MET });
  assert.equal(d.wait, undefined, `T21bj: nothing waits for a sorting (${d.wait ? d.wait.label : ''})`);
  const r = d.r;
  assert.deepEqual(r.result.finalRead.seats.map(e => [e.lab, e.read, e.failures?.[0]?.severity]).sort(), [['lc', true, 5], ['ld', true, 6]], 'premise: both seats read the rewrite and objected with a holding objection');
  assert.equal(r.result.passed, false, 'T21bj: the run ends not agreed without waiting');
  assert.equal(r.result.finalRead.decided_by, undefined, 'a handling session exists: the "nobody decided" record is not written');
  assert.equal(handled(r).length, 0, 'no sorting by the handler was made');
});

test('T21ca: one layer-3 seat objects and the other gave no usable reply after its one re-ask (a handling session exists): nothing waits and the objection stays open and must-do', async () => {
  const UNREADABLE = 'this is not a verdict';
  const d = await withHandler({ 'final-read-lc': objectsWith([{ ...newDefect(5), quote: 'with a pause between tries' }]), 'final-read-ld': UNREADABLE, 'final-read-ld-reask1': UNREADABLE });
  assert.equal(d.wait, undefined, `T21ca: nothing waits for a sorting (${d.wait ? d.wait.label : ''})`);
  const r = d.r;
  const ld = r.result.finalRead.seats.find(e => e.lab === 'ld');
  assert.deepEqual([ld?.read, ld?.reasked, lcFailure(r)?.severity], [false, true, 5], 'premise: ld gave no usable reply after its re-ask; lc objected (rated 5)');
  assert.equal(r.result.passed, false, 'T21ca: the run ends not agreed without waiting');
  assert.equal(handled(r).length, 0, 'no sorting by the handler was made');
});
