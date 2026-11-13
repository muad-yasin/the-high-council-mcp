// 0.8.4 S16 (D; Q9(e), N6, F4, D38, D32 route 6; T21al am au av aw bh br bs bu by, WORDING S16-w25 to w33c, w38 to w40). NOT built in this commit: T21bt and T21bx (revise outside the Council that runs one read and can end the run: the reopen is not built, RU-S8-10), T21bv and T21bw (they are T21am's case, a run with no handling session, where a continue and a finish are made "with a handling session" and no path adds one to a pinned chain, S16-w32d): when NO top-layer seat has read the final plan (both unreadable after their re-asks) the run does not end: it STOPS,
// resumable, at the stop F4 gives for a seat with no usable reply. It is kind `layer_bound` with the reason `final_read` (a round stop: exit 23, the existing choice code). With a handling session the choices are F4's three
// (continue = one more final read, finish = one read and then an ending, revise outside the Council = nothing recorded); with none the stop is a PAUSE that names no chooser. Offline, mock seats, $0.
// c_u and the session's gates in stop_decide (T13o, T13r, T21an, T21ax, T4l, T4m) are the next commit's.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { stopIdOf, stopSentence, roundChoiceEntry, roundStopPhraseOf, roundStopsInWords, stopWhyGeneral, defaultAdd, didNotSignOffWords } from '../src/overseer-rounds.js';
import { nobodyReadFinalPlan } from '../src/final-read.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
// layers 1 and 2 never read (the run is cut at its first revision by the armed finish); both layer-3 seats are a model that never gives a readable reply
const L3 = [['la', 1], ['lb', 2], ['lc', 3, 'mock-unreadable'], ['ld', 3, 'mock-unreadable']];
const readLabels = tag => ['lc', 'ld'].flatMap(k => [`final-read-${k}${tag}`, `final-read-${k}${tag}-reask1`]);
// every final-read label is a cache MISS, so each read is a real (mock) call and a stage that is served from disk is only one the test leaves out
const ALL = ['', '-c1', '-c2', '-f'].flatMap(readLabels);
const without = labels => ALL.filter(l => !labels.includes(l));

async function stopped({ handler = true, choices = [], overrides = {}, cut = ALL } = {}) {
  setOutboundScan({ finish: true });
  try { await scenario({ critics: L3, cutLabels: ['revise-1', ...cut], overrides, handler, runExtra: { roundChoices: choices } }); }
  catch (e) { if (e instanceof RoundStopped) return e; throw e; }
  finally { setOutboundScan({}); }
  return assert.fail('the run was expected to stop at the final read');
}
async function completed({ choices = [], overrides = {}, cut = ALL } = {}) {
  setOutboundScan({ finish: true });
  try { return await scenario({ critics: L3, cutLabels: ['revise-1', ...cut], overrides, handler: true, runExtra: { roundChoices: choices } }); }
  finally { setOutboundScan({}); }
}
const sentenceOf = (stop, extra = {}) => stopSentence(stop, { spentUsd: 0, draftFile: 'deliverable-partial.md', runDir: 'runs/x', ...extra });
const choiceOf = (stop, choice) => roundChoiceEntry(stop, choice, null);

test('T21al, T21au: both layer-3 seats unreadable in a run with a handling session: the run does not end, it stops at the final-read stop with the choices offered', async () => {
  const e = await stopped();
  assert.deepEqual([e.stop.kind, e.stop.why, e.stop.top_layer, e.stop.attempt], ['layer_bound', 'final_read', 3, 0]);
  assert.equal('no_chooser' in e.stop, false, 'a handling session exists: a chooser is named');
  assert.ok(e.served.includes('final-read-lc') && e.served.includes('final-read-lc-reask1'), 'each seat was asked and re-asked once');
  const text = sentenceOf(e.stop);
  assert.match(text, /^THE RUN STOPPED, NOT AGREED, and is waiting for your choice: no seat of layer 3 gave a usable reply to the final read, so nobody has read the final plan\./);
  assert.match(text, /To go on: council --resume runs\/x --continue \(layer 3 reads the final plan once more; the run's spending limit still applies\)\./);
  assert.match(text, /To end it here: council --resume runs\/x --finish \(layer 3 reads the final plan once more first; if a seat reads it, the handoff runs, the open objections are handed over and the result stays "not agreed", with each seat that did not read named; if no seat reads it, the run does not end and stays stopped\)\./);
  assert.match(text, /Or take the draft and revise it yourself outside the Council\.$/);
  assert.equal(didNotSignOffWords(e.stop), '', 'layer 3 may have signed this plan off: the clause is not said at this stop');
});

test('T21am, T21aw, T21bh, T21by: both unreadable in a run with NO handling session: a pause that names no person, no choice and no command; a recorded choice is not read', async () => {
  const e = await stopped({ handler: false });
  assert.equal(e.stop.no_chooser, true);
  const text = sentenceOf(e.stop);
  assert.match(text, /^THE RUN IS PAUSED, NOT ENDED: no seat of layer 3 gave a usable reply to the final read, so nobody has read the final plan\./);
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row T21am): OLD: '... It stays paused: nothing in this run is named to choose, and it can be resumed ...'. NEW: '... It stays paused: nobody is named to choose in this run, and it can be resumed ...' (the rest of the pattern is unchanged, whole and anchored at the end). WHY: error 'The input did not match the regular expression /A run does not end before layer 3 has read the final plan ... nothing in this run is named to choose ...$/': the reviewed wording reworded the no-chooser pause (Review/084/wording-batch/v2/RESOLVED_LIST.md line 9503, applied by f60ebad2 in src/overseer-rounds.js:222); the input in the TAP reads 'nobody is named to choose in this run'.
  assert.match(text, /A run does not end before layer 3 has read the final plan, so it waits\. It stays paused: nobody is named to choose in this run, and it can be resumed only when a handling session is there to choose\.$/);
  assert.doesNotMatch(text, /--continue|--finish|your choice|you |person|outside the Council/);
  const again = await stopped({ handler: false, choices: [choiceOf(e.stop, 'finish')] });
  assert.equal(again.stop.no_chooser, true, 'run.json is project-writable: with no handling session a choice in it ends nothing');
  assert.equal(again.stop.finish_refused, undefined);
});

test('T21br: a continue is ONE more final read under new labels (the first read\'s unreadable replies are not replayed as the answer); a second failure is a second stop with an id of its own', async () => {
  const first = await stopped();
  const e = await stopped({ choices: [choiceOf(first.stop, 'continue')] });
  assert.equal(e.stop.attempt, 1);
  assert.notEqual(stopIdOf(e.stop), stopIdOf(first.stop));
  assert.equal(stopIdOf(first.stop), `layer_bound:${first.stop.overseer_round}:${first.stop.pass}:final_read0`);
  for (const l of readLabels('-c1')) assert.ok(e.served.includes(l), `${l} was asked`);
  assert.ok(!e.served.some(l => /-f($|-reask)/.test(l)), 'a continue makes no finish read');
  assert.ok(!e.served.some(l => /-c2/.test(l)), 'one continue is one read');
});

test('T21br: a continue whose read is readable for one seat goes on: the run ends not agreed, the other seat named as not having read', async () => {
  const first = await stopped();
  const r = await completed({ choices: [choiceOf(first.stop, 'continue')], overrides: { 'final-read-lc-c1': MET }, cut: without(['final-read-lc-c1']) });
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc'); const ld = r.result.finalRead.seats.find(s => s.lab === 'ld');
  assert.deepEqual([lc.read, lc.label, ld.read], [true, 'final-read-lc-c1', false]);
  assert.equal(r.result.passed, false);
});

test('T21bs: a finish runs one more final read first; a seat that reads it lets the run end not agreed, the seat that did not read named', async () => {
  const first = await stopped();
  const r = await completed({ choices: [choiceOf(first.stop, 'finish')], overrides: { 'final-read-lc-f': MET }, cut: without(['final-read-lc-f']) });
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc'); const ld = r.result.finalRead.seats.find(s => s.lab === 'ld');
  assert.deepEqual([lc.read, lc.label, ld.read, r.result.passed], [true, 'final-read-lc-f', false, false]);
  assert.ok(!r.served.some(l => /-c1/.test(l)), 'a finish makes no continue read');
});

test('T21av, T21bu: a finish whose read still finds nobody does not end the run: the refusal says why and the choices that remain, and the stop is still a round stop', async () => {
  const first = await stopped();
  const e = await stopped({ choices: [choiceOf(first.stop, 'finish')] });
  assert.deepEqual([e.stop.finish_refused, e.stop.finish_read_used, e.stop.attempt], ['ran', true, 0]);
  const text = sentenceOf(e.stop);
  assert.match(text, /^--finish: the final read ran once more and no seat of layer 3 gave a usable reply, so nobody has read the final plan\. A finish does not end the run before layer 3 has read it, so this run did not end: it stays stopped, and your request to end it is recorded\. What remains: --continue \(layer 3 reads the final plan once more\), --finish-now \(the run ends now with the verdict the panel had before the read, and layer 3 did not read the final plan\), or revising the draft yourself outside the Council with this run left stopped\. Spent so far: \$0\.00\.$/);
});

test('T21bu: a repeated finish is answered from the record with no further read; after the one finish read the stop offers --continue and revising outside only', async () => {
  const first = await stopped();
  const repeat = await stopped({ choices: [choiceOf(first.stop, 'finish')], cut: without(readLabels('-f')) });   // the finish read's stages are on disk: nothing is asked again
  assert.equal(repeat.stop.finish_refused, 'repeat');
  assert.match(sentenceOf(repeat.stop), /^--finish: no seat of layer 3 has read the final plan, and a finish does not end the run before layer 3 has read it, so this run did not end\. No further read was made for this request: only --continue reads again\. What remains: --continue, --finish-now \(the run ends now with the verdict the panel had before the read, and layer 3 did not read the final plan\), or revising the draft yourself outside the Council with this run left stopped\. Nothing was run and nothing was spent\.$/);
  const afterFinish = await stopped({ choices: [choiceOf({ ...first.stop, finish_read_used: true }, 'continue')] });
  assert.equal(afterFinish.stop.attempt, 1);
  assert.equal(afterFinish.stop.finish_read_used, true, 'the finish read happens once in a run, whichever stop it was asked at');
  assert.ok(!afterFinish.served.some(l => /-f($|-reask)/.test(l)), 'no finish read is made after a continue either');
  const text = sentenceOf(afterFinish.stop);
  assert.doesNotMatch(text, /--finish/);
  assert.match(text, /To go on: council --resume runs\/x --continue \(layer 3 reads the final plan once more; the run's spending limit still applies\)\. Or take the draft and revise it yourself outside the Council\.$/);
});

test('the words of the new reason in the shared places (WORDING S16-w26, w27b, w38): the phrase list, the general words of BOARD-partial and a continue that adds nothing', () => {
  const stop = { kind: 'layer_bound', why: 'final_read' };
  assert.equal(roundStopPhraseOf(stop), 'because no seat of the top layer could read the final plan');
  assert.match(roundStopsInWords(), /because a seat of a layer stayed silent for too many passes in a row, because no seat of the top layer could read the final plan, or because an objection stood unchanged and could not be passed up$/);
  assert.match(stopWhyGeneral('layer_bound'), /a layer needed more than its allowed revisions, a seat of a layer stayed silent for too many passes in a row, or no seat of the top layer could read the final plan$/);
  assert.equal(defaultAdd(stop, {}), 0);
  assert.equal(stopIdOf({ kind: 'layer_bound', why: 'unheard', overseer_round: 1, pass: 3 }), 'layer_bound:1:3', 'every older id is what it was');
  assert.equal(stopIdOf({ kind: 'layer_bound', why: 'revisions', overseer_round: 1, pass: 3, layer: 1 }), 'layer_bound:1:3');
});

test('Q9(e): a seat that read exactly this plan before makes an unreadable final read an ordinary not-agreed end (no stop); nobody having read is the only case that stops', () => {
  const unread = { read: false }; const read = { read: true };
  assert.equal(nobodyReadFinalPlan(false, [unread, unread]), true);
  assert.equal(nobodyReadFinalPlan(true, [unread]), false, 'the other seat read this text in the climb');
  assert.equal(nobodyReadFinalPlan(false, [read, unread]), false);
  assert.equal(nobodyReadFinalPlan(false, [read]), false);
});
