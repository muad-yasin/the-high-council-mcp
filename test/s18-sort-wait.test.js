// 0.8.4 S18 (spec l.1486, D31, W40; T21bi, T21bk, T21bl, T21bm): at a NOT-agreed ending with a handling session, where one layer-3 seat objects to the final text (rated 5.0) and the other layer-3 seat read the same text and signed, the run WAITS for the handler's sorting of the objection (must_do or may_leave, with reasons naming the objection's id) at
// a pause (`sort-1`): no call is made there and no choice of ending and no continue is offered. The sorting is made and put on the combined row (`by: "handler"`, both the raiser's own must-do and the handler's reasons) and on the build list with the other seat's sign-off beside it; the ending stays not agreed after it, the basis is the final read, and the
// objection stays open under the seat's name with its rating unchanged. An answer that omits the id, the sorting or the reasons is no answer: the wait stays. The wait's wording W40 is HELD (handlerSortSystem + handlerSortUser, test data in test/held-prompts/held-084-b.js): as shipped nothing waits. Fixture: T21o of test/s16-run-rows.test.js with two layer-3 seats
// (test/s18-no-wait.test.js shares it), COPIED. Written without a run (no tests on the laptop): the first box run decides the fixture; NO green twin. The reds are the parent commit (nothing waits there) and swapped-input variants (S18_SWAPS.json).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, ExternalPause, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { isAgreed } from '../src/ending.js';
import * as FR from '../src/final-read.js';   // namespace imports: a tree without these exports still loads this file, and each row fails on its own
import * as LF from '../src/late-finding.js';
import { renderBoardMd } from '../src/report-shape.js';
import { SORTING } from './helpers/rating-demand.js';
import { W31 } from './helpers/w31-held.js';
import { scenario, CRITERION, failureOf } from './helpers/layer-two-run.js';
import { handlerSortSystem, handlerSortUser } from './held-prompts/held-084-b.js';
import { objectionId } from '../src/objection-ids.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const OBJ5 = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });
const newDefect = rating => ({ sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: 'retries failed requests', rating });
// lc objected to the plan in the climb (panel-1-lc). Its objection at the final read is a verdict that does not meet, with its failures (the shape the real judge gives), on a passage of its own ('with a pause between tries'): a `sorting` entry with the SAME criterion and passage as its climb objection is that objection restated on the same id (test/s18-restated-objection.test.js), which these fixtures do not test, and the same passage under another text could get a suffixed id.
const objectsWith = rows => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: rows.map(r => ({ criterion: r.criterion, problem: r.reason, fix: 'Back off between tries.', quote: r.quote, severity: r.rating })), verdict_line: 'no' });
const REWRITE = 'The worker retries failed requests up to five times, with a pause between tries.';
const CRITICS = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const choiceOf = (stop, choice) => roundChoiceEntry(stop, choice, null);
// the id of lc's objection of the final read (minted over the seat key from its criterion, passage and text): computed, not read from the wait, so a tree where nothing waits fails at the behaviour asserted and not at a TypeError
const LC_QUOTE = 'with a pause between tries';   // lc's passage at the final read: not the passage of its own climb objection (see objectsWith), so its objection is a new one with its own id
const ID_LC = objectionId('lc', { criterion: CRITERION, problem: 'The worker never backs off.', quote: LC_QUOTE });

// answers: the handler's replies by label ({ 'sort-1': ... }); returns what the run did: an ExternalPause (the wait) or the result
async function go(answers = {}, lcRows = [{ ...newDefect(5), quote: LC_QUOTE }]) {
  setHeldForTest({ ...SORTING, ...W31, handlerSortSystem, handlerSortUser });
  const opts = { answerBack: true, handler: true, critics: CRITICS, extra: { maxOverseerRounds: 1, dispute: { enabled: true, stall_rounds: 2 } }, overrides: { 'panel-1-la': MET, 'panel-1-lc': OBJ5, dispute: REWRITE, 'final-read-lc': objectsWith(lcRows), 'final-read-ld': MET, ...answers } };
  let first = null;
  try { await scenario(opts); } catch (e) { if (e instanceof RoundStopped) first = e; else throw e; }
  assert.equal(first?.stop?.kind, 'overseer_cap', 'premise: the climb stops at the overseer-round limit (the wait is not the climb\'s stop)');
  try { return { r: await scenario({ ...opts, runExtra: { roundChoices: [choiceOf(first.stop, 'finish')] } }) }; } catch (e) { if (e instanceof ExternalPause) return { wait: e }; throw e; }
}

test('T21bi, T21bl: one layer-3 seat objects (rated 5.0) and the other signed this exact text: the run WAITS at a pause for the handler\'s sorting (the objection and the seat that signed are on the prompt); no choice of ending, no continue, no call is made there', async () => {
  const d = await go();
  assert.ok(d.wait instanceof ExternalPause && d.wait.label === 'sort-1', `T21bi: the run waits for the handler's sorting (${d.wait ? d.wait.label : 'it ended'})`);
  assert.equal(d.wait instanceof RoundStopped, false, 'T21bl: the wait is a pause, not a stop that offers a choice');
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'T21bi, T21bl'): OLD: the heading read `# The seat that signed this exact text`. NEW: `# Who signed this exact text`. WHY: the TAP's error line "the other seat's sign-off is shown beside the objection" printed `actual: ... # Who signed this exact text\n\n- ld`; the reviewed wording of f60ebad2 changed the heading in src/prompts/recorded-084-b.js:59 (handlerSortUser; the held copy test/held-prompts/held-084-b.js:59 has the same text). The rest of the pin is as it was.
  assert.match(d.wait.user, /# Who signed this exact text\n\n- ld\n/, 'the other seat\'s sign-off is shown beside the objection');
  assert.match(d.wait.user, /# The objection\n\n- O-[0-9a-f]{8}(?:#r?\d+)? \(raised by lc; rated 5\.0\)/, 'the objection is shown with its rating');
  assert.match(d.wait.system, /Answer must_do or may_leave for this objection/);
  const finalReadLabels = (d.wait.served || []).filter(l => /^final-read-/.test(l));
  assert.deepEqual(finalReadLabels.filter(l => /-(?:c\d+|f)$/.test(l)), [], 'T21bl: no continue read and no finish read: no call was added at the wait');
  assert.deepEqual([...new Set(finalReadLabels)].sort(), ['final-read-lc', 'final-read-ld'], 'T21bl: only the two first final-read labels were served');
});

test('T21bi, T21bk, T21bm (T21bk and T21bm are NAMED PINS by construction: FAIL CONDITION the handler\'s sort turns the ending agreed, or re-rates or closes the objection; the test\'s first assertion carries the red on the parent): the handler sorts it may_leave naming the id: the sorting is on the combined row (by handler, both words), the run ends NOT agreed on the final read\'s basis, and the objection stays open under the seat\'s name with its rating unchanged at 5.0', async () => {
  const id = ID_LC;
  const d = await go({ 'sort-1': JSON.stringify({ sort: 'may_leave', reasons: `${id}: the build can leave it, the other seat signed this text.` }) });
  assert.ok(d.r, `premise: after the answer the run ends (${d.wait ? 'it still waits at ' + d.wait.label : ''})`);
  const row = (d.r.result.finalRead.sorting || []).find(x => x.id === id);
  assert.deepEqual([row?.sort, row?.by, row?.reasons?.map(x => [x.seat, x.sort])], ['may_leave', 'handler', [['lc', 'must_do'], ['handler', 'may_leave']]], 'T21bi: the sorting is recorded, with the raiser\'s own must-do beside the handler\'s word');
  assert.deepEqual([d.r.result.passed, d.r.result.finalRead.basis, isAgreed(d.r.result)], [false, 'final_read_objection', false], 'T21bk: the ending stays not agreed after the sorting, the basis is the final read');
  const f = d.r.result.finalRead.seats.find(e => e.lab === 'lc').failures.find(x => x.id === id);
  assert.deepEqual([f.severity, f.open], [5, true], 'T21bm: open under the seat\'s name, the rating unchanged at 5.0 (not re-rated, not closed)');
});

test('T21bi (no answer): an answer that omits the id is no answer: it is set aside and the run waits at the same pause again', async () => {
  const NAMES_ID = false;   // whether the handler's reasons name the objection's id
  const id = ID_LC;
  const d = await go({ 'sort-1': JSON.stringify({ sort: 'may_leave', reasons: NAMES_ID ? `${id}: leave it.` : 'The build can leave it.' }) });
  assert.ok(d.wait instanceof ExternalPause && d.wait.label === 'sort-1', 'the answer without the id is refused: the run waits again');
});

test('T21bi (the build list, pure): a sorted objection shows the handler\'s sort, its reasons and the seat that signed; an unsorted one still counts as must-do', () => {
  const SORT_O1 = 'may_leave';   // what the handler sorted O-1
  const rec = { ran: true, run_end: 'not_agreed', seats: [{ lab: 'lc', read: true, meets: false, failures: [{ id: 'O-1', criterion: 'C', problem: 'No back-off.', severity: 5, open: true }, { id: 'O-2', criterion: 'C2', problem: 'No timeout.', severity: 6, open: true }] }, { lab: 'ld', read: true, meets: true, failures: [] }], sorting: [{ id: 'O-1', sort: SORT_O1, by: 'handler', seats: ['handler'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'No back-off.' }, { seat: 'handler', sort: SORT_O1, reason: 'O-1: the build can leave it.' }] }] };
  const text = LF.withFinalReadObjections('# Handoff', FR.openFinalReadRows(rec), 3);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the build-list line read `...sorted may-leave by the handling session; ld signed this text): ...`. NEW: `...ld signed off on the final plan): ...` (K5). WHY: the reviewed line of src/late-finding.js:119 (withFinalReadObjections). The deliverable's and the BOARD's notes (final-read.js) keep `signed this text`.
  assert.match(text, /- O-1 \(raised by lc; rated 5\.0; sorted may-leave by the handling session; ld signed off on the final plan\): C: No back-off\. The handling session's reasons: O-1: the build can leave it\./);
  assert.match(text, /- O-2 \(raised by lc; rated 6\.0; sorted must-do by its seat\): C2: No timeout\./);
});

test('T21bi (the people\'s copies): the deliverable\'s final-read block and the BOARD show the handler\'s sort from the same record row, the handler\'s words and the raiser\'s text each as its own', async () => {
  const id = ID_LC;
  const SORT = 'may_leave';   // what the handler sorts it
  const d = await go({ 'sort-1': JSON.stringify({ sort: SORT, reasons: `${id}: the build can leave it, ld signed this text.` }) });
  assert.ok(d.r, 'premise: the run ends after the answer');
  assert.match(d.r.result.deliverable, /The handling session sorted it may-leave \(ld signed this text\): O-[0-9a-f]{8}(?:#r?\d+)?: the build can leave it, ld signed this text\./, 'the deliverable\'s final-read block shows the sort (deliverable.md is written once, at the end)');
  assert.match(renderBoardMd({ runId: 'r-s18-sort', result: d.r.result }), /objected\*\* - lc \(layer 3\): [^\n]*\(sorted may-leave by the handling session\)/, 'the BOARD row shows the sort');
});

test('T21bi (one seat, two objections): the run waits at sort-1 and, once that is answered, at sort-2: two pauses in sequence; answering both ends the run with two handler rows', async () => {
  const TWO = [{ ...newDefect(5), quote: LC_QUOTE }, { ...newDefect(6), reason: 'The worker has no timeout.', quote: 'five times' }];
  const idsOf = user => [...String(user).matchAll(/- (O-[0-9a-f]{8}(?:#r?\d+)?) \(raised by lc/g)].map(m => m[1]);
  const one = await go({}, TWO);
  assert.equal(one.wait?.label, 'sort-1', 'the first sitting waits at sort-1');
  const id1 = idsOf(one.wait.user)[0];
  const two = await go({ 'sort-1': JSON.stringify({ sort: 'must_do', reasons: `${id1}: this one holds.` }) }, TWO);
  assert.equal(two.wait?.label, 'sort-2', 'answering sort-1 gives a wait at sort-2');
  const id2 = idsOf(two.wait.user)[0];
  assert.notEqual(id1, id2, 'each wait names its own objection');
  const end = await go({ 'sort-1': JSON.stringify({ sort: 'must_do', reasons: `${id1}: this one holds.` }), 'sort-2': JSON.stringify({ sort: 'may_leave', reasons: `${id2}: leave this one.` }) }, TWO);
  assert.deepEqual((end.r?.result.finalRead.sorting || []).filter(x => x.by === 'handler').map(x => [x.id, x.sort]), [[id1, 'must_do'], [id2, 'may_leave']], 'two handler rows, one per objection');
});
