// 0.8.4 L3, REAL STOPS (in-process runChain on the scripted-cache fixture of test/stall-stop.test.js, $0): for each stop kind the Council can raise on a layered plan chain, the stop is raised, the person's
// finish is recorded as a roundChoices entry, and the finished run's own record and readers say that the top layer did not sign off. Per kind: (a) the C&C pin - `stop.chosen === 'finish'` and
// `dispute.reason === 'finish_chosen'` agree; (b) the CONSISTENCY row - the stop sentence of U-C1 (didNotSignOffWords) carries the phrase exactly when the shared core (topLayerNotSignedFrom) says the top layer did not sign off,
// read from the layers[] the run recorded; (c) the DECIDE-TIME read - the partial report at the stop already carries layers[], so the core says it BEFORE the person chooses (the decide screen's second line); (d) the readers.
// New exports are read through NAMESPACE imports, so on a tree without L3 the file loads and each row fails by assertion.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { roundChoiceEntry, didNotSignOffWords } from '../src/overseer-rounds.js';
import * as LY from '../src/layers.js';
import * as VH from '../src/verdict-headline.js';
import { verdictHeadline } from '../src/verdict-headline.js';
import { finishedRunState } from '../src/run-status.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const TOP = 'top-gamma';
const LOW = 'raiser-alpha';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const objectsAnswering = (fs, answers) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, answers, verdict_line: 'no' });
const quotes = ['The worker', 'retries failed', 'failed requests', 'The worker retries', 'retries failed requests', 'worker retries failed'];
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried neither `relation` nor `severity`. NEW: each carries a rating (5: it holds the sign-off, as an unrated one did) and a relation: `new` for a first raise, `continues <id>` for the same seat's repeat of its standing objection. WHY: relationRule and ratingDemand recorded (src/chain.js relation gate; src/ratings-demand.js).
const T = (i, relation = 'new') => ({ criterion: CRITERION, problem: `Problem ${i}.`, quote: quotes[i], fix: 'Fix it.', severity: 5, relation });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];
// a judge `lab` raises T(k-1) in pass k and withdraws the previous pass's objection in the same reply; at pass `repeatAt` it raises the previous pass's objection again (a stall)
const reply = (lab, k, repeatAt) => (k === 1 ? objects(T(0)) : k === repeatAt ? objects(T(k - 2, `continues ${objectionId(lab, T(k - 2))}`)) : objectsAnswering([T(k - 1)], withdraws(objectionId(lab, T(k - 2)))));
const script = (lab, passes, repeatAt) => Object.fromEntries(Array.from({ length: passes }, (_, i) => [`panel-${i + 1}-${lab}`, reply(lab, i + 1, repeatAt)]));

async function run({ script: scripted = {}, ov = null, maxRounds = 6, roundChoices = [], answerBack = true } = {}) {
  setPromptSpy(() => {}); setHeldForTest(null);
  setCache({ invalidate() {}, get(label) {
    if (label in scripted) return { text: scripted[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-l3', criteria: [CRITERION], signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}), dispute: { enabled: true, stall_rounds: 2 },
    ...(ov ? { maxOverseerRounds: ov, layerRevisions: { 1: 1, 2: 1 } } : { maxRounds }),
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat('mid-beta', 2), seat(TOP, 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-l3', log: () => {}, config, roundChoices });
  return { result, config, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-l3', chain: 'fixture-l3', task: 't.md', result, config }))) };
}
const stopOf = opts => run(opts).then(() => null, e => e);

async function finishedAt(opts, kind, why) {
  const err = await stopOf(opts);
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, ...(why ? [err.stop.why] : [])], [kind, ...(why ? [why] : [])], 'the premise: the stop the Council raised');
  // (c) the decide-time read: the partial report at the stop carries layers[], the core reads it before any choice exists
  assert.deepEqual(LY.topLayerNotSignedFrom({ layers: err.partial.layers, stop: err.stop }), { layer: 3 }, 'decide time: the member\'s partial report says layer 3 did not sign off');
  assert.equal(err.stop.chosen, undefined, 'and no choice is on the stop yet, so a gate on `chosen` would never fire there');
  const fin = await run({ ...opts, roundChoices: [roundChoiceEntry(err.stop, 'finish', opts.ov ? { maxOverseerRounds: opts.ov, layerRevisions: { 1: 1, 2: 1 } } : null)] });
  const { report } = fin;
  // (a) the C&C pin
  assert.equal(report.passed, false);
  assert.equal(report.stop.chosen, 'finish'); assert.equal(report.dispute?.reason, 'finish_chosen', 'stop.chosen "finish" and dispute.reason "finish_chosen" agree');
  // (b) consistency: the stop sentence has the phrase exactly when the core (over the recorded layers[]) says so
  const core = LY.topLayerNotSignedFrom({ layers: report.layers, stop: report.stop });
  assert.deepEqual(core, { layer: 3 });
  assert.equal(didNotSignOffWords(err.stop) !== '', core !== null, 'the stop sentence and the finished run agree');
  // (d) the readers
  assert.equal(VH.finishedAtStopWords(report), 'layer 3 did not sign off on this plan');
  assert.equal(verdictHeadline(report).text, 'OPEN OBJECTIONS - layer 3 did not sign off on this plan');
  assert.equal(finishedRunState(report), 'done: open objections; layer 3 did not sign off on this plan');
  assert.ok(renderBoardMd({ runId: 'r-l3', result: fin.result }).includes('## Not agreed: finished at the person\'s choice\n\nLayer 3 did not sign off on this plan.\n'));
  return { err, fin };
}

test('L3-6a stall_stop top_layer (a 7-round chain, the top layer\'s own objection stood through two verdicts)', async () => { await finishedAt({ ov: 7, script: script(TOP, 3, 3) }, 'stall_stop', 'top_layer'); });
test('L3-6b stall_stop last_pass (a lower layer\'s objection stood unchanged on the last pass; layer 3 was not asked)', async () => {
  const X = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };
  await finishedAt({ maxRounds: 2, script: { [`panel-1-${LOW}`]: objects({ ...X, relation: 'new' }), [`panel-2-${LOW}`]: objects({ ...X, relation: `continues ${objectionId(LOW, X)}` }) } }, 'stall_stop', 'last_pass');
});
test('L3-6c overseer_cap below seven, with no stall (all 2 overseer rounds used, the top layer still objected)', async () => { await finishedAt({ ov: 2, script: script(TOP, 2, 99) }, 'overseer_cap'); });
test('L3-6d overseer_cap below seven, with a stall (it falls through to the cap and carries `stalled`)', async () => {
  const { err } = await finishedAt({ ov: 3, script: script(TOP, 3, 3) }, 'overseer_cap');
  assert.ok(err.stop.stalled?.length, 'the premise: a stalled objection stood at the cap');
});
test('L3-6e the hard stop (seven overseer rounds used): a finish is offered there and says it too', async () => {
  const { err } = await finishedAt({ ov: 7, script: script(TOP, 7, 7) }, 'overseer_cap');
  assert.equal(err.stop.rounds, 7);
});
// CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row L3-6f): OLD: the run carried answer_back and layer 1's bound stopped it (layer_bound/revisions). NEW: the same run on a chain WITHOUT answer_back (run()'s `answerBack: false`). WHY: error 'null' at finishedAt's assert.ok(err instanceof RoundStopped, String(err)) (test line 55): the run did not stop. With the layer-1 go-up line (layerOneGoUpLine), the rating demand and answer_back all in force, layer 1's revision bound no longer stops the run: the plan goes up a layer (src/chain.js:6676, `layer1BoundGoUp(stop) && callGates.goUpOn && layerOneGoUpLineOn()`; goUpOn = ledgerOn && severityOn, src/call-gates.js:49, ledgerOn needs settingsOf(config).answerBackOn). The stop as it stood is still what a layered chain WITHOUT answer_back raises (shipped path: chain.js:6676 is skipped when goUpOn is false), so the premise is recreated by switching answer_back off. The scripted failures keep their rating and relation (a relation on a chain without answer_back is not asked and is ignored, chain.js:5462).
test('L3-6f layer_bound, revisions (layer 1 used its revisions; layers 2 and 3 were not asked)', async () => { await finishedAt({ ov: 7, script: script(LOW, 4, 99), answerBack: false }, 'layer_bound', 'revisions'); });

test('L3-7 the not-finished control through the same fixtures: the stop as raised (no choice) and a run that went on say nothing about layer 3; a finish does not change passed or the stop kind', async () => {
  const err = await stopOf({ ov: 2, script: script(TOP, 2, 99) });
  assert.ok(err instanceof RoundStopped, String(err));
  assert.equal(VH.finishedAtStopWords({ passed: false, layers: err.partial.layers, stop: err.stop }), null, 'before the choice there is no finish to describe');
  const fin = await run({ ov: 2, script: script(TOP, 2, 99), roundChoices: [roundChoiceEntry(err.stop, 'finish', { maxOverseerRounds: 2, layerRevisions: { 1: 1, 2: 1 } })] });
  assert.equal(fin.report.stop.kind, 'overseer_cap'); assert.equal(fin.report.passed, false);
});
