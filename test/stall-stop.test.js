// 0.8.4 S5 U-C (Q13, R1 as changed, C&C 05 Nov 2026; T4c's neighbour): a stall that cannot be passed up (the top layer holds it, or no pass is left) is a STOP for the person on EVERY layered chain, kind `stall_stop`. Offline, $0: a cache stub answers every
// stage by its label (test/stall-ratings.test.js's pattern); the top layer objects as the script says, the lower layers sign off. The words are A-DRAFT (WORDING rows, U-C).
//   TS-1  below the cap (a 7-round chain, a top-layer stall at round 3): stall_stop with why top_layer, `stalled`, the exit-23 choice set; a recorded `continue` goes on and adds NO overseer round (the cap stays 7); a recorded `finish` ends finish_chosen
//   TS-2  exactly at seven (a 7-round chain, a stall at round 7): the stop is overseer_cap, the hard stop, carrying `stalled`; --finish is not offered; --continue raises the cap to 8; a stall at round 8 is the hard stop again
//   TS-3  a 3-round chain, a stall at round 3: it falls through to overseer_cap WITH `stalled`; --finish is offered (below seven)
//   TS-4  a layered chain WITHOUT overseer rounds, a pass left: stall_stop, overseer_round 0, no `rounds`, pass_left true; --continue is offered; a recorded finish ends finish_chosen
//   TS-12 the two second copies in src/run-controls.js (C&C): the file-name literal equals report-shape's PARTIAL_REPORT_FILE, and stopOfPartial gives the same answer as tree-choice's readStopOfRun on the same fixtures
//   TS-10 the BACKSTOP: with no pass left a recorded continue does not count, the stop stands
//   TS-11 pure: stopOffersContinue and didNotSignOffWords (a readable stop only; never at a handler_not_yet stop)
//   TS-5  a stall on the LAST pass of a lower layer: why last_pass, and the sentence says layer 3 has not read the plan as it stands; with the chain's final read on, it says --finish gives layer 3 that read
//   TS-6  rounds used >= 7 with the cap raised (a 9-round chain, a stall at round 7): stall_stop carrying `rounds` 7 presents as the HARD stop (no --finish), whatever the cap
//   TS-7  pure: the kind is in every list (STOP_CAUSES, ROUND_STOP_CAUSES, STOP_STATUS, the schema's two enums); an unstalled hard stop keeps its sentence; the figures are never printed as undefined
//   TS-9a REAL VERBS (cli.js), no pass left: exit 23, STOPPED-stall_stop.json is written, the sentence has no --continue, --continue is refused (exit 2, nothing recorded), --finish is accepted and ends finish_chosen
//   TS-9b REAL VERBS, a pass left: --continue is offered and accepted
//   TS-8  PIN: every shipped layered plan chain carries maxOverseerRounds (mock-layered is excluded on purpose: it is layered and has none)
// RED BASE 6805be01: the file loads there (the two new exports are read through the namespace). TS-1..TS-6 fail at their first assertion (no stall_stop kind: the run ends 'stalled' or runs on), TS-7 at its first list, TS-9 at exit 22 instead of 23 (the stall ends the run 'stalled'); TS-8 PASSES there (it pins an existing fact).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { effectiveLimits, stopSentence, isHardStop, roundChoiceEntry, stopIdOf } from '../src/overseer-rounds.js';
import * as OR from '../src/overseer-rounds.js';
const stopOffersContinue = stop => (OR.stopOffersContinue ?? (() => 'MISSING'))(stop);   // new in S5: read through the namespace so the file loads on the red tree
import * as RC from '../src/run-controls.js';   // stopOfPartial is new in S5: read through the namespace so the file still loads on the red tree
import { readStopOfRun } from '../src/tree-choice.js';
import { PARTIAL_REPORT_FILE } from '../src/report-shape.js';   // a namespace import for the two new exports: on the red tree the row that reads them fails by assertion and the file still loads
import { STOP_CAUSES, ROUND_STOP_CAUSES, STOP_STATUS } from '../src/stop-files.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const TOP = 'top-gamma';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
// distinct quoted objections of the top layer: each quotes a passage the draft keeps, so a repeat is "unchanged"
const quotes = ['The worker', 'retries failed', 'failed requests', 'The worker retries', 'retries failed requests', 'worker retries failed'];
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation and no rating. NEW: a first raise carries relation 'new' and severity 5; a repeat of a standing objection by the same seat carries `continues <id>` (a `new` on a standing id mints #2 and the stall never fires). WHY: relationRule and ratingDemand are recorded (src/chain.js:5462, src/ratings-demand.js).
const T = i => ({ criterion: CRITERION, problem: `Problem ${i}.`, quote: quotes[i], fix: 'Fix it.', relation: 'new', severity: 5 });
const repeats = (lab, f) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const idT = i => objectionId(TOP, T(i));
// `who` = the words didNotSignOffWords (src/overseer-rounds.js) prints for the stop: 'the top layer' for an overseer_cap stop (it carries no top_layer), 'layer 3' for a stall_stop (it carries top_layer, as TS-5 and TS-11 pin). One exact sentence per stop kind, never "either".
const ALL3 = (sentence, who = 'the top layer') => { assert.match(sentence, /hard stop after 7 overseer rounds: only you decide here\./); assert.match(sentence, /--continue/); assert.match(sentence, new RegExp(`--finish \\(the dispute stage and the handoff run, the open objections are handed over, the result stays "not agreed", and ${who} did not sign off on this plan\\)`)); assert.match(sentence, /revise it yourself outside the Council/); assert.doesNotMatch(sentence, /cannot be finished as it stands/); };   // Muad's word of 05 Nov 2026: at the hard stop all three choices are offered, and the finish parenthesis carries his phrase

async function run({ script = {}, ov = null, maxRounds = 6, roundChoices = [], finalRead = false } = {}) {
  setPromptSpy(() => {}); setHeldForTest(null);
  setCache({ invalidate() {}, get(label) {
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-stall-stop', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 },
    ...(ov ? { maxOverseerRounds: ov, layerRevisions: { 1: 1, 2: 1 } } : { maxRounds }), ...(finalRead ? { final_read: { enabled: true } } : {}),
    seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat(TOP, 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-ts', log: () => {}, config, roundChoices });
  return { result, config, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-ts', chain: 'fixture-stall-stop', task: 't.md', result, config }))) };
}
const stopOf = (opts) => run(opts).then(() => null, e => e);
// The top layer raises T(k-1) in pass k and WITHDRAWS the previous pass's objection in the same reply (answer_back keeps a judge's unanswered objections standing, so a silent drop would make the old one stall in pass 2: R3). In the pass `repeatAt` it raises the previous pass's objection
// again, so that one objection stands in two top-layer verdicts across overseer rounds (Q13, NEW-A8-1). Each pass is one overseer round: the lower layers sign off.
const objectsAnswering = (fs, answers) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, answers, verdict_line: 'no' });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];
const topReply = (k, repeatAt) => (k === 1 ? objects(T(0)) : k === repeatAt ? objects(repeats(TOP, T(k - 2))) : objectsAnswering([T(k - 1)], withdraws(idT(k - 2))));
const topScript = (passes, repeatAt) => Object.fromEntries(Array.from({ length: passes }, (_, i) => [`panel-${i + 1}-${TOP}`, topReply(i + 1, repeatAt)]));

test('TS-1 below the cap: a top-layer stall at round 3 of a 7-round chain is a stall_stop; continue goes on with NO added round; finish ends finish_chosen', async () => {
  const script = topScript(3, 3);   // pass 1: T0, pass 2: T1, pass 3: T1 again -> the top layer's own objection stood through two of its verdicts, across overseer rounds
  const err = await stopOf({ ov: 7, script });
  assert.ok(err instanceof RoundStopped, String(err));
  const { stop } = err;
  assert.deepEqual([stop.kind, stop.why, stop.top_layer, stop.rounds, stop.pass, stop.overseer_round], ['stall_stop', 'top_layer', 3, 3, 3, 3]);
  assert.deepEqual(stop.stalled, [{ id: idT(1), lab: TOP, layer: 3, passes: [2, 3] }]);
  assert.equal(stop.pass_left, true, 'a pass is left: --continue is offered');
  const sentence = stopSentence(stop, { runDir: '/r' });
  assert.match(sentence, /--continue/); assert.match(sentence, /--finish/); assert.doesNotMatch(sentence, /hard stop/);
  assert.equal(err.partial.escalations?.length ?? 0, 0, 'nothing was passed up');
  // continue: the stalled objections are counted afresh, the run goes on, the cap is still 7
  const entry = roundChoiceEntry(stop, 'continue', err.partial.config ?? { maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 } });
  assert.equal(entry.add, 0, 'a continue at this stop adds no overseer round');
  assert.equal(effectiveLimits({ maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 } }, [entry]).overseer, 7);
  const signsAndWithdraws = JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], answers: [{ id: idT(1), status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }], verdict_line: 'ok' });   // a judge that signs off answers its own earlier objection
  const went = await run({ ov: 7, script: { ...script, 'panel-4-top-gamma': signsAndWithdraws }, roundChoices: [entry] });
  assert.equal(went.result.passed, true, 'the run went on past the stop and the top layer signed in round 4');
  // finish: ends not agreed through the dispute stage
  const fin = await run({ ov: 7, script, roundChoices: [roundChoiceEntry(stop, 'finish', { maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 } })] });
  assert.equal(fin.result.passed, false);
  assert.equal(fin.report.dispute.reason, 'finish_chosen');
  assert.equal(fin.report.stop.kind, 'stall_stop'); assert.equal(fin.report.stop.chosen, 'finish');
});

// CHANGED (0.8.4 S5 U-C1 fix-up, Muad's word of 05 Nov 2026): TODAY'S HEADING was "... the hard stop with `stalled`; --finish is not offered; continue raises the cap to 8; a stall at round 8 is the hard stop again" (C&C's item-4 rows); --finish is now OFFERED at the hard stop.
test('TS-2 exactly at seven: the stall is the overseer_cap hard stop with `stalled`; continue, finish (with his phrase) and revising outside the Council are all offered; continue raises the cap to 8; a stall at round 8 is the hard stop again with all three', async () => {
  const script = topScript(7, 7);   // T0..T5 in passes 1-6, T5 again in pass 7
  const err = await stopOf({ ov: 7, script });
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.rounds, err.stop.cap], ['overseer_cap', 7, 7]);
  assert.deepEqual(err.stop.stalled, [{ id: idT(5), lab: TOP, layer: 3, passes: [6, 7] }]);
  assert.equal(isHardStop(err.stop), true);
  const sentence = stopSentence(err.stop, { runDir: '/r' });
  ALL3(sentence); assert.match(sentence, /also stood unchanged through the last 2 verdicts of its judge/);
  const cont = roundChoiceEntry(err.stop, 'continue', { maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 } });
  assert.equal(effectiveLimits({ maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 } }, [cont]).overseer, 8);
  const again = await stopOf({ ov: 7, script: { ...script, 'panel-8-top-gamma': objects(repeats(TOP, T(5))) }, roundChoices: [cont] });   // pass 8 raises T5 again, as in pass 7
  assert.ok(again instanceof RoundStopped, String(again));
  assert.deepEqual([again.stop.kind, again.stop.rounds, again.stop.cap, isHardStop(again.stop)], ['overseer_cap', 8, 8, true], 'a stall at round 8 is the hard stop again');
  ALL3(stopSentence(again.stop, { runDir: '/r' }));
});

test('TS-3 a stall at the cap of a 3-round chain falls through to overseer_cap WITH `stalled`, and --finish is offered (below seven)', async () => {
  const err = await stopOf({ ov: 3, script: topScript(3, 3) });
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.rounds, err.stop.cap], ['overseer_cap', 3, 3]);
  assert.deepEqual(err.stop.stalled.map(s => s.id), [idT(1)]);
  const sentence = stopSentence(err.stop, { runDir: '/r' });
  assert.match(sentence, /--finish/); assert.match(sentence, /all 3 overseer rounds were used and the top layer still objected, and an objection also stood unchanged/);
});

test('TS-4 a layered chain WITHOUT overseer rounds, a pass left: a top-layer stall is a stall_stop with overseer_round 0, no `rounds` and pass_left true; --continue is offered (a pass is left); finish ends finish_chosen', async () => {
  const script = { 'panel-1-top-gamma': objects(T(0)), 'panel-2-top-gamma': objects(repeats(TOP, T(0))) };
  const err = await stopOf({ script });
  assert.ok(err instanceof RoundStopped, String(err));
  const { stop } = err;
  assert.deepEqual([stop.kind, stop.why, stop.overseer_round, 'rounds' in stop, stop.pass_left], ['stall_stop', 'top_layer', 0, false, true]);
  const sentence = stopSentence(stop, { runDir: '/r' });
  assert.match(sentence, /To go on: council --resume \/r --continue/); assert.doesNotMatch(sentence, /No pass is left/);
  const fin = await run({ script, roundChoices: [roundChoiceEntry(stop, 'finish')] });
  assert.equal(fin.report.dispute.reason, 'finish_chosen');
});

test('TS-10 the BACKSTOP: with no pass left a recorded continue does not count (run.json is project-writable text, a tree\'s old choice can still arrive): the stop stands and the run throws it again, instead of ending at the round cap', async () => {
  const script = { 'panel-1-top-gamma': objects(T(0)), 'panel-2-top-gamma': objects(repeats(TOP, T(0))) };
  const err = await stopOf({ maxRounds: 2, script });
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.pass, err.stop.pass_left], ['stall_stop', 2, false]);
  const again = await stopOf({ maxRounds: 2, script, roundChoices: [roundChoiceEntry(err.stop, 'continue', { maxRounds: 2 })] });
  assert.ok(again instanceof RoundStopped, 'the stop stands: ' + String(again));
  assert.equal(again.stop.pass_left, false);
  assert.equal(stopOffersContinue(err.stop), false);
});

test('TS-11 pure: the ONE predicate and the phrase of Muad\'s word: --continue is offered unless a stall_stop says no pass is left; the clause is said only for a READABLE stop (an integer pass) and never at a stop the handler\'s not_yet reached', () => {
  assert.deepEqual([stopOffersContinue({ kind: 'stall_stop', pass_left: false }), stopOffersContinue({ kind: 'stall_stop', pass_left: true }), stopOffersContinue({ kind: 'stall_stop' }), stopOffersContinue({ kind: 'overseer_cap', pass_left: false }), stopOffersContinue(null)], [false, true, true, true, true]);
  const dns = OR.didNotSignOffWords ?? (() => 'MISSING');
  assert.equal(dns({ kind: 'overseer_cap', pass: 3 }), ', and the top layer did not sign off on this plan');
  assert.equal(dns({ kind: 'stall_stop', pass: 2, top_layer: 3 }), ', and layer 3 did not sign off on this plan');
  assert.equal(dns({ kind: 'overseer_cap' }), '', 'a kind-only stop (the partial report did not read) says nothing');
  assert.equal(dns({ kind: 'overseer_cap', pass: 3, handler_not_yet: true }), '', 'the top layer signed that plan');
  // the one phrase that is true for THIS stop (the fallback of cli.js names it), else the whole list
  const phrase = OR.roundStopPhraseOf ?? (() => 'MISSING');
  assert.equal(phrase({ kind: 'overseer_cap' }), 'at its overseer-round limit');
  assert.equal(phrase({ kind: 'layer_bound', why: 'revisions' }), "at a layer's revision limit");
  assert.equal(phrase({ kind: 'layer_bound', why: 'unheard' }), 'because a seat of a layer stayed silent for too many passes in a row');
  assert.equal(phrase({ kind: 'stall_stop' }), 'because an objection stood unchanged and could not be passed up');
  assert.equal(phrase({ kind: 'layer_bound' }), "at its overseer-round limit, at a layer's revision limit, because a seat of a layer stayed silent for too many passes in a row, because no seat of the top layer could read the final plan, or because an objection stood unchanged and could not be passed up", 'a stop with no reason (the partial did not read): the whole list');
  assert.equal(phrase(null), phrase({}), 'no stop at all: the whole list');
  const sentence = stopSentence({ kind: 'stall_stop', why: 'last_pass', top_layer: 3, rounds: 2, pass_left: false, stalled: [{ id: 'O-aaaaaaaa', lab: 'x', layer: 1, passes: [1, 2] }], pass: 2, overseer_round: 2 }, { runDir: '/r' });
  assert.match(sentence, /No pass is left, so there is no --continue\./); assert.doesNotMatch(sentence, /To go on/);
});

test('TS-5 a stall on the last pass of a LOWER layer: why last_pass, the choice to finish says layer 3 did not sign off on this plan; with the final read on it says --finish gives layer 3 that read', async () => {
  const X = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', relation: 'new', severity: 5 };
  const script = { 'panel-1-raiser-alpha': objects(X), 'panel-2-raiser-alpha': objects(repeats('raiser-alpha', X)) };
  const err = await stopOf({ maxRounds: 2, script });
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.why, err.stop.top_layer], ['stall_stop', 'last_pass', 3]);
  assert.deepEqual(err.stop.stalled.map(s => [s.layer, s.passes]), [[1, [1, 2]]]);
  assert.equal(err.stop.pass_left, false, 'the last pass: no pass is left');
  const plain = stopSentence(err.stop, { runDir: '/r' });
  assert.match(plain, /unchanged through the last 2 verdicts of its judge, and no pass is left to pass it up/);
  assert.match(plain, /the result stays "not agreed", and layer 3 did not sign off on this plan\)/, 'his word: the choice to finish says layer 3 did not sign off');
  assert.doesNotMatch(plain, /layer 3 reads the final plan/);
  assert.match(stopSentence(err.stop, { runDir: '/r', finalRead: true }), /--finish \(the dispute stage and the handoff run, layer 3 reads the final plan, the open objections are handed over, the result stays "not agreed", and layer 3 did not sign off on this plan\)/);
  const top = stopSentence({ ...err.stop, why: 'top_layer' }, { runDir: '/r', finalRead: true });
  assert.doesNotMatch(top, /reads the final plan/, 'the clause is said only where it is true');
});

// CHANGED (0.8.4 S5 U-C1 fix-up, Muad's word of 05 Nov 2026): TODAY'S HEADING ended "... presents as the HARD stop (no --finish), whatever the cap"; the hard stop now offers --finish too.
test('TS-6 rounds used >= 7 with the cap raised: a stall at round 7 of a 9-round chain is a stall_stop carrying `rounds` 7 and presents as the HARD stop (continue, finish with his phrase, revise outside), whatever the cap', async () => {
  const err = await stopOf({ ov: 9, script: topScript(7, 7) });
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.rounds], ['stall_stop', 7]);
  assert.equal(isHardStop(err.stop), true);
  const sentence = stopSentence(err.stop, { runDir: '/r' });
  ALL3(sentence, 'layer 3');   // CHANGED ACCEPTED (0.8.4 S5 U-C1 fix-up). OLD: "and the top layer did not sign off on this plan". NEW: "and layer 3 did not sign off on this plan". WHY: this stop is a stall_stop and carries top_layer 3, so didNotSignOffWords names the layer (TS-5 and TS-11 pin the same sentence); the overseer_cap rows (TS-2) have no top_layer and keep "the top layer".
  assert.equal(isHardStop({ kind: 'stall_stop', rounds: 6 }), false);
  assert.equal(isHardStop({ kind: 'layer_bound', why: 'revisions', rounds: 7 }), false, 'a layer-bound stop is never the hard stop (T15l, as before)');
});

test('TS-7 pure: the kind is in every list and both schema enums; an unstalled hard stop keeps its sentence; the figures are never printed as undefined', () => {
  assert.ok(STOP_CAUSES.includes('stall_stop') && ROUND_STOP_CAUSES.includes('stall_stop'));
  assert.equal(STOP_STATUS.stall_stop, 'awaiting_choice');
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  assert.ok(schema.properties.stop.properties.kind.enum.includes('stall_stop'), 'stop.kind');
  assert.ok(schema.properties.stoppedBy.enum.includes('stall_stop'), 'stoppedBy');
  assert.ok(schema.properties.stop.properties.why.enum.includes('top_layer') && schema.properties.stop.properties.why.enum.includes('last_pass'), 'stop.why');
  assert.ok(schema.properties.stop.properties.stalled && schema.properties.stop.properties.top_layer, 'stalled and top_layer are declared');
  const hard = { kind: 'overseer_cap', rounds: 7, cap: 7, pass: 7, overseer_round: 7 };
  // the literal hard-stop sentence as it reads at 6805be01 (no pin of its full text existed: T15j matches only): an unstalled hard stop is byte for byte what it was
  // CHANGED (0.8.4 S5 U-C1 fix-up, Muad's word of 05 Nov 2026): TODAY'S sentence was "...This is the hard stop after 7 overseer rounds: only you decide here, and the run cannot be finished as it stands. To go on: ... Or take the draft..." (read against 6805be01); it now offers --finish with his phrase.
  assert.equal(stopSentence(hard, { runDir: '/r' }), "THE RUN STOPPED, NOT AGREED, and is waiting for your choice: all 7 overseer rounds were used and the top layer still objected. Nothing more was paid for after this point. This is the hard stop after 7 overseer rounds: only you decide here. To go on: council --resume /r --continue (one more overseer round; the run's spending limit still applies). To end it here: council --resume /r --finish (the dispute stage and the handoff run, the open objections are handed over, the result stays \"not agreed\", and the top layer did not sign off on this plan). Or take the draft and revise it yourself outside the Council.");
  assert.doesNotMatch(stopSentence(hard, { runDir: '/r' }), /unchanged through/);
  assert.doesNotMatch(stopSentence({ kind: 'stall_stop' }, { runDir: '/r' }), /undefined|null|NaN/);
  assert.match(stopSentence({ kind: 'stall_stop' }, { runDir: '/r' }), /objections stood unchanged for several verdicts in a row and could not be passed up/);
  assert.equal(stopIdOf({ kind: 'stall_stop', overseer_round: 3, pass: 3 }), 'stall_stop:3:3');
  // Muad's word: the choice to finish says the top layer did not sign off, at every round stop where that is true; NOT where the handler's not_yet reached the stop (the top layer signed that plan)
  assert.match(stopSentence({ kind: 'layer_bound', why: 'revisions', layer: 1, used: 1, bound: 1, pass: 2, overseer_round: 1 }, { runDir: '/r' }), /the result stays "not agreed", and the top layer did not sign off on this plan\)/);
  assert.match(stopSentence({ kind: 'overseer_cap', rounds: 3, cap: 3, pass: 3, overseer_round: 3 }, { runDir: '/r' }), /and the top layer did not sign off on this plan\)/);
  assert.doesNotMatch(stopSentence({ kind: 'overseer_cap', rounds: 3, cap: 3, pass: 3, overseer_round: 3, handler_not_yet: true }, { runDir: '/r' }), /did not sign off on this plan/, 'the handler\'s not_yet stop: the top layer signed that plan');
  // the member sentences are built from ONE phrase map: every round-stop cause has its words there
  for (const c of ROUND_STOP_CAUSES) assert.ok(c in (OR.ROUND_STOP_PHRASES ?? {}), `${c} has no words in ROUND_STOP_PHRASES`);
  assert.match(OR.roundStopsInWords?.() ?? '', /^at its overseer-round limit, at a layer's revision limit, because a seat of a layer stayed silent for too many passes in a row, because no seat of the top layer could read the final plan, or because an objection stood unchanged and could not be passed up$/);
});

test('TS-8 PIN: every shipped layered plan chain carries maxOverseerRounds, so no shipped plan chain ends a top-layer stall without a continue (mock-layered is layered and has none, on purpose: it is excluded here)', () => {
  const dir = join(root, 'chains');
  const plans = readdirSync(dir).filter(f => /^plan-.*\.json$/.test(f)).map(f => [f, JSON.parse(readFileSync(join(dir, f), 'utf8'))]).filter(([, c]) => (c.seats?.critics || []).some(s => Number.isInteger(s.layer)));
  assert.ok(plans.length >= 7, `found ${plans.length} layered plan chains`);   // CHANGED ACCEPTED TEST (0.8.4 seats unit): OLD bar 9. NEW bar: 7 (seven planning chains left after the three retirements and the China mini). WHY: the count moves with the thing it counts
  // MOVED BAR (commit 8): a ladder chain is an overseer chain too; OLD every plan chain carried maxOverseerRounds, NEW it carries maxOverseerRounds or the ladder key
  for (const [f, c] of plans) assert.ok((Number.isInteger(c.maxOverseerRounds) && c.maxOverseerRounds >= 1) || (c.ladder && Number.isInteger(c.ladder.block) && Number.isInteger(c.ladder.visits)), `${f} has neither maxOverseerRounds nor the ladder key`);
});

const seatOf = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
function cliFixture(maxRounds) {
  const config = { name: 'ss', maxRounds, signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seatOf('mock-exch-support-keep-clean', 'e1', 1), seatOf('mock-exch-support-keep-clean', 'e2', 2), seatOf('mock-exch-support-keep-always', 'e3', 3)] } };
  const dir = mkdtempSync(join(tmpdir(), 'ss-cli-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ss.json'), JSON.stringify(config)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const cli = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, cli, runDirOf: () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]) };
}
test('TS-9a REAL VERBS, NO pass left (maxRounds 2: the top layer\'s repeated objection stalls on the last pass): exit 23, STOPPED-stall_stop.json is written, the sentence has no --continue; --continue is refused (exit 2, nothing recorded); --finish is accepted and ends finish_chosen', () => {
  const { cli, runDirOf } = cliFixture(2);
  const first = cli(['--chain', 'ss', '--task', 'tasks/t.md']);
  assert.equal(first.status, 23, first.stdout + first.stderr);
  const runDir = runDirOf();
  const partial = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8'));
  assert.deepEqual([partial.stop.kind, partial.stop.why, partial.stoppedBy, partial.stop.pass_left], ['stall_stop', 'top_layer', 'stall_stop', false], 'the premise');
  assert.ok(existsSync(join(runDir, 'STOPPED-stall_stop.json')), 'the marker is written (writeStoppedMarker refuses an unlisted cause)');
  const said = first.stdout + first.stderr;
  assert.match(said, /No pass is left, so there is no --continue\./); assert.match(said, /--finish/);
  const cont = cli(['--resume', runDir, '--continue']);
  assert.equal(cont.status, 2, cont.stdout + cont.stderr);
  assert.match(cont.stderr, /--continue: no pass is left, so the run cannot go on/);
  assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).roundChoices ?? [], [], 'nothing was recorded');
  const fin = cli(['--resume', runDir, '--finish']);
  assert.notEqual(fin.status, 2, fin.stdout + fin.stderr);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')).dispute.reason, 'finish_chosen');
});

test('TS-9b REAL VERBS, a pass left (maxRounds 6): the stop offers --continue (To go on is in the sentence) and --continue is accepted (not refused)', () => {
  const { cli, runDirOf } = cliFixture(6);
  const first = cli(['--chain', 'ss', '--task', 'tasks/t.md']);
  assert.equal(first.status, 23, first.stdout + first.stderr);
  const runDir = runDirOf();
  assert.equal(JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop.pass_left, true, 'the premise');
  assert.match(first.stdout + first.stderr, /To go on: council --resume .* --continue/);
  const cont = cli(['--resume', runDir, '--continue']);
  assert.notEqual(cont.status, 2, 'continue is not refused: ' + cont.stdout + cont.stderr);
});

test('TS-12 the two second copies in src/run-controls.js fail safe and are pinned: the file-name literal equals report-shape\'s constant; stopOfPartial and tree-choice\'s readStopOfRun give the same answer on one set of fixtures', () => {
  const src = readFileSync(join(root, 'src', 'run-controls.js'), 'utf8');
  assert.ok(src.includes(`join(runDir, '${PARTIAL_REPORT_FILE}')`), 'run-controls reads the file report-shape names');
  const good = { kind: 'stall_stop', why: 'top_layer', pass: 2, overseer_round: 2, pass_left: false };
  const fixtures = [['a readable stop', { stop: good }], ['no stop', {}], ['no pass', { stop: { ...good, pass: undefined } }], ['a text overseer_round', { stop: { ...good, overseer_round: '2' } }], ['an array', { stop: [good] }], ['a null stop', { stop: null }], ['no kind', { stop: { pass: 2, overseer_round: 2 } }]];
  const asked = RC.stopOfPartial ?? (() => 'MISSING');
  for (const [name, body] of fixtures) {
    const dir = mkdtempSync(join(tmpdir(), 'ts12-'));
    writeFileSync(join(dir, PARTIAL_REPORT_FILE), JSON.stringify(body));
    assert.deepEqual(asked(dir), readStopOfRun(dir)?.stop ?? null, name);
  }
  const torn = mkdtempSync(join(tmpdir(), 'ts12-')); writeFileSync(join(torn, PARTIAL_REPORT_FILE), '{"stop": ');
  assert.equal(asked(torn), null, 'a torn file reads as no stop'); assert.equal(readStopOfRun(torn), null);
  assert.equal(asked(mkdtempSync(join(tmpdir(), 'ts12-'))), null, 'no file: no stop');
});
