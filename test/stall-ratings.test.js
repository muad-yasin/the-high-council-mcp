// 0.8.4 S5 U-B (Q8, Q12, Q13, RU-ADD-A7, D20, D39, N25; T17ac, T20i, T20j, T20l, NEW-A7-1; the overruled R10 variant; C&C's re-tag row and the Q-g once-only rows): the RATING SPLIT of a ruling. Offline, $0: a cache stub answers every stage by its
// label (test/stall-escalation.test.js's pattern). The ruling words and the rating demand are HELD words (test/held-prompts/held-escalation.js, test/helpers/rating-demand.js). Every row says what it uses:
//   DEMAND = the held rating demand injected (test/helpers/rating-demand.js: the judges are told to rate, an objection without a rating is refused) ; FIXTURE = `severity` on the scripted failures (objection-closed-states.test.js's shape) ; W6 = the relation wording injected.
//   UB-1  T20i   every ruling judge overrules a sent-up objection rated 5: it stays open under its id (outcome rated 5, stays_open true) and reaches the dispute stage's open set ONCE   [DEMAND + FIXTURE]
//   UB-2  T20j   the layer-1 judge repeats the overruled rated-5 objection as `continues <id>`: the SAME id, no #r2, and no second escalation (the count itself is the pure rows of test/stall-book.test.js)   [DEMAND + FIXTURE + W6]
//   UB-3  NEW-A7-1 + D5   a stalled objection rated 3 that layer 2 sustains: adopted, recorded, holds nothing back, the pass goes up and layer 3 signs: an escalated sign-off whose block carries the D5 sentence   [DEMAND + FIXTURE]
//   UB-4  T17ac  an escalated sign-off with no block overruled ends the run: no layer-1 pass follows   [ruling words only]
//   UB-5  R10    (the overruled variant, a layered chain WITHOUT overseer rounds): an overruled rated-5 objection that stands unchanged in later passes is not sent up again in the run, and stays open   [DEMAND + FIXTURE]
//   UB-6  T20l   (WITH overseer rounds, one overseer round): the same, and the partial report of the stop carries the escalation with stays_open true   [DEMAND + FIXTURE]
//   UB-7  re-tag an objection overruled at 5 and then re-tagged to 3 by the handler reads stays_open FALSE, in the final report and in the partial report of a stop after the re-tag   [DEMAND + FIXTURE + the runChain `retags` input]
//   UB-9  item 5 (C&C 05 Nov 2026, the fix-up on top of 35119520): X stalls and is overruled-but-open, Y (raised once, NOT stalled) is held by the same layer: at an escalated sign-off BOTH reach dispute.open_objections, once each, X with its ruling and Y without   [DEMAND + FIXTURE]
//   UB-10 item 5, the agreed end: Y is in the build list (openAtAgreement) once, with X   [DEMAND + FIXTURE + W6 + the build-check wording]
//   UB-11 SCAN PIN (C&C: sevRun is null off the layered unanimous chains): an escalation exists only on a layered unanimous chain, where the ledger is built; so no overrule is judged without a ledger
//   UB-12 item 5, the latest position (correction 10g; the fix-up on top of 2f215e1a): X passed up, overruled-but-open, withdrawn, raised again under the SAME id, a second escalation passes the layer over in the final round: X is listed once as standing dissent   [DEMAND + FIXTURE]
//   UB-13 item 5, a RE-OPENED id (the second hunk of the latest-position series): an UNQUOTED id is sustained, its raiser raises it again (counted), a second escalation passes the layer over in the final round: the raiser's id is listed once, and the sustainer's adopted copy once   [DEMAND + FIXTURE]
//   UB-8  Q-g    on an AGREED end the open overruled objection is demanded by the build check ONCE (the openAtAgreement path, not also the escalated list)   [DEMAND + FIXTURE + W6 + the build-check wording]
// UB-12 on 6805be01: the whole-signature stall compares [H5a] with [H5a, X] at pass 5 and does not fire, so the premise `two escalations` fails first; on 2f215e1a (without the latest-position hunk) it fails at `X is the raiser's latest position: listed once` (closedLater drops X on the round-4 withdrawal and heardLaterWithout on the pass-4 gap).
// UB-13 on 0dced70b (before the reopenedAfter hunk): RED at `the raiser's re-opened id is listed once` (standingFailures' own row check dropped it as closed by the sustain, and passedUpKeys kept it out of the not-asked list). On 6805be01: RED, first failing premise NOT pinned: layer 1 is parked in pass 4 on old source, so panel-4-raiser-alpha is never served and no re-raise is recorded; whether `two escalations` or `raised_again` fails first depends on whether the unanswered adopted copy stalls layer 2 into its own escalation (re-check at the box).
// RED BASE 6805be01: the outcome rows have no `rated` / `stays_open`, an overrule closes the objection whatever its rating, a sustain below 4 ends the pass: UB-1, UB-2, UB-3, UB-5, UB-6, UB-7 and UB-8 fail at their first assertion on that; UB-4 PASSES there (it pins the ending).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { estimateChainRows, estimateTokens, DEFAULT_ESTIMATE } from '../src/cost.js';
import * as RC from '../src/roles.js';
import { objectionId } from '../src/objection-ids.js';
import * as HESC from './held-prompts/held-escalation.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
const W6 = { relationRule: HB084.relationRule };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const LOW = 'raiser-alpha';
const X5 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };   // holds its layer
const X3 = { ...X5, severity: 3 };                                                                                                          // swept: rated below the line
const Z6 = { criterion: CRITERION, problem: 'No back-off is named.', quote: 'failed requests', fix: 'Name one.', severity: 6 };            // the top layer's own objection: it makes the writer revise
const Y6 = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 6 };               // layer 2's own objection
const H5a = { criterion: CRITERION, problem: 'The scope is unclear.', quote: 'The worker', fix: 'State the scope.', severity: 5 };          // a holder whose quote changes each pass, so its own count restarts
const H5b = { ...H5a, quote: 'failed requests' };
const idX = objectionId(LOW, X5); const idH5a = objectionId(LOW, H5a);
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = (answers) => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], ...(answers ? { answers } : {}), verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const objectsAnswering = (fs, answers) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, answers, verdict_line: 'no' });
const rules = list => JSON.stringify({ rulings: list });
const rel = (f, relation) => ({ ...f, relation });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub replies of UB-1, UB-3 to UB-7 and UB-9 carried failures with no relation (UB-2 and UB-8 already carried one). NEW: a first raise carries relation 'new' (N) and a raise of the same failure by the same seat in a later pass carries `continues <id>` (again). WHY: relationRule is recorded (NS-0193, src/prompts/recorded-084-b.js): a judge failure with no relation is an unreadable reply, and a `new` on a standing id mints #2.
const N = f => rel(f, 'new');
const again = (f, lab = LOW) => rel(f, `continues ${objectionId(lab, f)}`);
const OVERRULE = (id, who = 'mid-beta') => ({ [`rule-3-${who}`]: rules([{ id, ruling: 'overrule', reason: 'Section two sets the limit.' }]) });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];

async function run({ held, script = {}, maxRounds = 6, ov = null, retags = null, stall = 2 } = {}) {
  const served = []; const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });   // 0.8.4 apply, group 7 (GL-IN): the spied prompts ride on the result and on a thrown stop (`e.prompts`, `e.config`)
  setHeldForTest(held);
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-ratings', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: stall },
    ...(ov ? { maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds } : { maxRounds }),
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  let result;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-ub', log: () => {}, config, ...(retags ? { retags } : {}) }); }
  catch (e) { e.prompts = prompts; e.config = config; throw e; }
  return { result, served, config, prompts, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-ub', chain: 'fixture-ratings', task: 't.md', result, config }))) };
}
const HELD = { ...INJECT, ...DEMAND };
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');

test('UB-1 T20i [DEMAND + FIXTURE]: every ruling judge overrules a sent-up objection rated 5: it stays open under its id (rated 5, stays_open true) and reaches the dispute stage\'s open set ONCE', async () => {
  const { result, report } = await run({ held: HELD, script: { 'panel-1-raiser-alpha': objects(N(X5)), 'panel-2-raiser-alpha': objects(again(X5)), ...OVERRULE(idX) } });
  const o = report.escalations[0].outcome[0];
  assert.deepEqual([o.id, o.result, o.rated, o.stays_open], [idX, 'overruled', 5, true]);
  assert.equal(report.dispute.open_objections.filter(x => x.id === idX).length, 1, 'open on the record, once');
  assert.match(result.deliverable, /It stays open: it is rated 4 or above, is not rated, or was once rated 7 or above, so the ruling closed nothing/);
});

test('UB-2 T20j [DEMAND + FIXTURE + W6]: the layer-1 judge repeats the overruled rated-5 objection as `continues <id>`: the SAME id, no #r2, and no second escalation', async () => {
  const { report } = await run({ held: { ...HELD, ...W6 }, maxRounds: 5, script: {
    'panel-1-raiser-alpha': objects(rel(X5, 'new')), 'panel-2-raiser-alpha': objects(rel(X5, `continues ${idX}`)), ...OVERRULE(idX),
    'panel-3-top-gamma': objects(rel(Z6, 'new')),
    'panel-4-raiser-alpha': objects(rel(X5, `continues ${idX}`)), 'panel-5-raiser-alpha': objects(rel(X5, `continues ${idX}`)),
  } });
  assert.equal(report.escalations.length, 1, 'not sent up a second time');
  const ids = (report.dispute?.open_objections ?? []).map(x => x.id);
  assert.ok(ids.includes(idX), 'the same id is still open');
  assert.equal(ids.some(i => /#r\d/.test(i)), false, 'no r2 id was minted');
});

test('UB-3 NEW-A7-1 + D5 [DEMAND + FIXTURE]: a stalled objection rated 3 that layer 2 sustains is adopted, recorded and holds nothing back: the pass goes up and layer 3 signs (an escalated sign-off with the D5 sentence)', async () => {
  const idB = objectionId('mid-beta', X3);
  const { result, report, served } = await run({ held: HELD, script: {
    'panel-1-raiser-alpha': objects(N(X3), N(H5a)),
    'panel-2-raiser-alpha': objectsAnswering([again(X3), N(H5b)], withdraws(idH5a)),   // X3 stands again; the holder changes its quote (answering the old one), so only X3 reaches the window
    'rule-3-mid-beta': rules([{ id: objectionId(LOW, X3), ruling: 'sustain', reason: 'The limit is not stated.' }]),
  } });
  assert.deepEqual(report.escalations[0].ids, [objectionId(LOW, X3)], 'only the swept objection stalled');
  const o = report.escalations[0].outcome[0];
  assert.deepEqual([o.result, o.rated, o.adopted_as.map(a => a.id)], ['sustained', 3, [idB]]);
  assert.equal(served.includes('panel-3-top-gamma'), true, 'the pass went up: layer 3 was asked in the escalation pass');
  assert.match(states(report), /3\.2:signed_off 3\.3:signed_off/);
  assert.deepEqual([report.escalated_signoff.pass, report.escalated_signoff.layer], [3, 3]);
  assert.ok(result.deliverable.includes(`sustained in round 3 by mid-beta (layer 2), whose objection it then was (${idB}). Final status: mid-beta signed off in round 3 and still holds it as its own, open objection.`), result.deliverable.slice(0, 900));
});

test('UB-4 T17ac [ruling words only]: an escalated sign-off with no block overruled ends the run: no layer-1 pass follows', async () => {
  // CHANGED (0.8.4 SG-1, C&C 08 Nov 2026): the stall goes up only with the ledger AND the rating demand, so this row runs with DEMAND and a rated objection (5 holds the sign-off and never closes on an overrule, like the unrated one it replaces); its meaning (an escalated sign-off with no block overruled ends the run) is unchanged. The gate-off pins are test/stall-gate.test.js.
  const rated5 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 };
  const { report, served } = await run({ held: { ...INJECT, ...DEMAND }, script: { 'panel-1-raiser-alpha': objects(N(rated5)), 'panel-2-raiser-alpha': objects(again(rated5)) } });
  assert.deepEqual(report.escalated_signoff && [report.escalated_signoff.pass, report.escalated_signoff.layer], [3, 3]);
  assert.equal(served.includes('panel-4-raiser-alpha'), false, 'no layer-1 pass after the escalated sign-off');
});

test('UB-5 R10, the overruled variant, a chain WITHOUT overseer rounds [DEMAND + FIXTURE]: an overruled rated-5 objection that stands unchanged in later passes is not sent up again in the run, and stays open', async () => {
  const { report, served, config } = await run({ held: HELD, script: {
    'panel-1-raiser-alpha': objects(N(X5)), 'panel-2-raiser-alpha': objects(again(X5)), ...OVERRULE(idX), 'panel-3-top-gamma': objects(N(Z6)),
    'panel-4-raiser-alpha': objects(again(X5)), 'panel-5-raiser-alpha': objects(again(X5)), 'panel-6-raiser-alpha': objects(again(X5)),
  } });
  assert.equal(config.maxOverseerRounds, undefined, 'fixture: no overseer rounds');
  assert.equal(report.escalations.length, 1);
  assert.equal(served.includes('panel-6-raiser-alpha'), true);
  assert.equal(report.escalations[0].outcome[0].stays_open, true);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026, UB-6 re-aimed to T20l and the plan's bound line). T20l (FEATURE_SPECS.md:1044): "an objection rated 5 is overruled at its first stall escalation and the window is reached again with the passage and the writer's response unchanged in the same overseer round; expect no second escalation and the objection still open". The plan's bound line (FEATURE_SPECS.md:491): "...the restarted layer-1 pass runs in the same overseer round (F3's b1 + b2 + 1 layer-1 passes), and a layer-1 objection in it with the bound already used is not revised but goes up with the plan by N5". OLD: the row asserted ONE escalation in all (any trigger) and that the run stops (RoundStopped); on the recorded state the run does not stop: it reaches the top layer at pass 10, and X is sent up again at passes 7 and 9 by the layer-1 bound (trigger layer1_bound), not by the stall window. NEW: the stall window sends X up ONCE (one escalation of trigger stall carries X, outcome overruled, stays open: T20l kept); every later escalation that carries X is a layer1_bound go-up (the plan's N5 at the bound), with layer 2's rulings scripted at passes 7 and 9 (rated 5: the overrule closes nothing). WHY: T20l is about the stall window; the second and third sends are the bound rule, which the plan states separately; the old assertion counted every trigger.
test('UB-6 T20l, WITH overseer rounds, one overseer round [DEMAND + FIXTURE]: the stall window sends X up once and the objection stays open; later sends of X are only layer-1 bound go-ups, each ruled on by layer 2', async () => {
  const { report, served } = await run({ held: HELD, ov: { rounds: 1, bounds: { 1: 3, 2: 2 } }, script: {
    'panel-1-raiser-alpha': objects(N(X5)), 'panel-2-raiser-alpha': objects(again(X5)), ...OVERRULE(idX), 'panel-3-mid-beta': objects(N(Y6)),
    'panel-4-raiser-alpha': objects(again(X5)), 'panel-5-raiser-alpha': objects(again(X5)), 'panel-6-raiser-alpha': objects(again(X5)),
    'rule-7-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]), 'rule-9-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]),
  } });
  const ofX = report.escalations.filter(e => e.ids.includes(idX));
  assert.deepEqual(ofX.filter(e => e.trigger === 'stall').map(e => e.pass), [3], 'the stall window sent X up once, at pass 3 (T20l)');
  assert.deepEqual([ofX[0].outcome[0].result, ofX[0].outcome[0].stays_open], ['overruled', true], 'and the objection stays open');
  assert.deepEqual(ofX.filter(e => e.trigger !== 'stall').map(e => [e.pass, e.trigger]), [[7, 'layer1_bound'], [9, 'layer1_bound']], 'every later send of X is a layer-1 bound go-up (the plan, N5)');
  assert.ok(served.includes('rule-7-mid-beta') && served.includes('rule-9-mid-beta'), 'layer 2 was asked to rule at each go-up');
});

// NEW (0.8.4, Mini-C&C bar on UB-6's re-aim: stays_open true at a STOP is pinned nowhere else on this shape). The UB-6 fixture with ONE more script entry: the top layer objects at pass 10 (its first visit), so the one overseer round ends and the cap of one round stops the run: a RoundStopped whose partial report carries every escalation of X with its outcome overruled and stays_open true (X is rated 5: the overrule closes nothing).
test("UB-6b T20l, WITH overseer rounds, one overseer round, ending at the overseer cap [DEMAND + FIXTURE]: the partial report of the stop carries each send-up of X (pass 3 stall, passes 7 and 9 layer-1 bound) overruled with stays_open true", async () => {
  const err = await run({ held: HELD, ov: { rounds: 1, bounds: { 1: 3, 2: 2 } }, script: {
    "panel-1-raiser-alpha": objects(N(X5)), "panel-2-raiser-alpha": objects(again(X5)), ...OVERRULE(idX), "panel-3-mid-beta": objects(N(Y6)),
    "panel-4-raiser-alpha": objects(again(X5)), "panel-5-raiser-alpha": objects(again(X5)), "panel-6-raiser-alpha": objects(again(X5)),
    "rule-7-mid-beta": rules([{ id: idX, ruling: "overrule", reason: "Section two sets the limit." }]), "rule-9-mid-beta": rules([{ id: idX, ruling: "overrule", reason: "Section two sets the limit." }]),
    "panel-10-top-gamma": objects(N(Z6)),
  } }).then(() => null, e => e);
  assert.ok(err instanceof RoundStopped, String(err));
  const ofX = err.partial.escalations.filter(e => e.ids.includes(idX));
  assert.deepEqual(ofX.map(e => [e.pass, e.trigger]), [[3, "stall"], [7, "layer1_bound"], [9, "layer1_bound"]], "the send-ups of X in the partial report");
  assert.deepEqual(ofX.map(e => { const o = e.outcome.find(x => x.id === idX); return [o.result, o.stays_open]; }), [["overruled", true], ["overruled", true], ["overruled", true]], "each stays open in the partial report of the stop");
});

// NEW (0.8.4 apply, group 7, C&C RULING_STEP5_6 E and the 04:53 line: the prompt-spy leg of the go-up ruling rows goes on UB-6's shape, which sends them; figures printed in job 97, P5a/P6). GL-IN: on UB-6's shape ending at the overseer cap (the same script as UB-6b) the ruling calls that were SENT carry the system texts the dry run prices: the layer-1 bound go-ups (passes 7 and 9, rule-<n>-mid-beta) the send-up
// sentence, the stall ruling (pass 3) the plain one, the layer-2 bound go-up (pass 10, rule-10-top-gamma) the go-up sentence; and the maximum's `rule-bound-L2-mid-beta` and `rule-go-up-L3-top-gamma` rows are, per call, prompt + draft (the chain has no estimate block: DEFAULT_ESTIMATE; no held map: the words are the recorded ones, as in the probe that printed them) + 400 x the judges whose objections ride along (K1, K2) + the system text SENT. The stall ruling has no priced row (src/cost.js: its rule- calls stay unlisted).
test('GL-IN UB-6 shape, ending at the overseer cap [DEMAND + FIXTURE]: the system text each ruling call SENT is the text its priced row carries (send-up at the layer-1 bound, plain at the stall, go-up at layer 2\'s bound), and the priced input is prompt + draft + 400 x K + that system text', async () => {
  const err = await run({ held: null, ov: { rounds: 1, bounds: { 1: 3, 2: 2 } }, script: {
    'panel-1-raiser-alpha': objects(N(X5)), 'panel-2-raiser-alpha': objects(again(X5)), ...OVERRULE(idX), 'panel-3-mid-beta': objects(N(Y6)),
    'panel-4-raiser-alpha': objects(again(X5)), 'panel-5-raiser-alpha': objects(again(X5)), 'panel-6-raiser-alpha': objects(again(X5)),
    'rule-7-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]), 'rule-9-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]),
    'panel-10-top-gamma': objects(N(Z6)),
  } }).then(() => null, e => e);
  assert.ok(err instanceof RoundStopped, String(err));
  const sys = label => err.prompts.get(label)?.system;
  assert.equal(sys('rule-3-mid-beta'), RC.escalationRulingSystem(), 'the stall ruling sent the plain ruling text');
  for (const label of ['rule-7-mid-beta', 'rule-9-mid-beta']) assert.equal(sys(label), RC.escalationRulingSystem({ sendUp: true }), `${label}: the layer-1 bound go-up sent the send-up text`);
  assert.equal(sys('rule-10-top-gamma'), RC.goUpRulingSystem(), 'the layer-2 bound go-up sent the go-up text');
  setHeldForTest(null);   // the recorded state: the dry run reads the recorded words
  const config = err.config; const a = { ...DEFAULT_ESTIMATE, ...(config.estimate || {}) };
  const K = layer => config.seats.critics.filter(k => k.layer === layer).length;
  const rows = estimateChainRows(config, { maximum: true }); const perCall = r => r.input / (r.times ?? 1);
  const bound = rows.filter(r => r.label.startsWith('rule-bound-')); const goUp = rows.filter(r => r.label.startsWith('rule-go-up-'));
  assert.deepEqual(bound.map(r => r.label), ['rule-bound-L2-mid-beta'], 'one priced row for the layer-1 bound go-up ruling');
  assert.equal(perCall(bound[0]), a.promptTokens + a.draftTokens + 400 * K(1) + estimateTokens(sys('rule-7-mid-beta')), 'rule-bound: prompt + draft + 400 x K1 + the system text of the ruling SENT at pass 7');
  assert.deepEqual(goUp.map(r => r.label), ['rule-go-up-L3-top-gamma'], 'one priced row for the layer-2 bound go-up ruling');
  assert.equal(perCall(goUp[0]), a.promptTokens + a.draftTokens + 400 * K(2) + estimateTokens(sys('rule-10-top-gamma')), 'rule-go-up: prompt + draft + 400 x K2 + the system text of the ruling SENT at pass 10');
  assert.equal(rows.filter(r => /^rule-3-/.test(r.label)).length, 0, 'the stall ruling has no priced row');
});

test('UB-7 re-tag [DEMAND + FIXTURE + the runChain `retags` input]: an objection overruled at 5 and re-tagged to 3 by the handler reads stays_open FALSE, in the final report and in the partial report of a stop after the re-tag', async () => {
  // the top layer answers its pass-3 objection (withdrawing it, quoting the draft) and raises another in pass 4, so no top-layer objection stands in two verdicts (that would be a stall_stop at the top layer)
  const idZ6 = objectionId('top-gamma', Z6); const Z6b = { ...Z6, problem: 'The back-off is not bounded.', quote: 'The worker' };
  const script = { 'panel-1-raiser-alpha': objects(N(X5)), 'panel-2-raiser-alpha': objects(again(X5)), ...OVERRULE(idX), 'panel-3-top-gamma': objects(N(Z6)), 'panel-4-top-gamma': objectsAnswering([N(Z6b)], withdraws(idZ6)) };
  const retags = [{ pass: 4, id: idX, severity: 3, reason: 'A missing limit does not change what is built.' }];
  const stopped = await run({ held: HELD, retags, ov: { rounds: 2, bounds: { 1: 3, 2: 2 } }, script }).then(() => null, e => e);
  assert.ok(stopped instanceof RoundStopped, String(stopped));
  assert.deepEqual([stopped.partial.escalations[0].outcome[0].result, stopped.partial.escalations[0].outcome[0].stays_open], ['overruled', false], 'the PARTIAL report path');
  const { report } = await run({ held: HELD, retags, ov: { rounds: 3, bounds: { 1: 3, 2: 2 } }, script: { ...script, 'panel-4-top-gamma': meets(withdraws(idZ6)) } });
  assert.deepEqual([report.escalations[0].outcome[0].rated, report.escalations[0].outcome[0].stays_open], [5, false], 'rated at the ruling is kept; stays_open is read at the end');
});

test('UB-8 Q-g [DEMAND + FIXTURE + W6 + the build-check wording]: on an AGREED end the open overruled objection is demanded by the build check ONCE', async () => {
  const served = [];
  setHeldForTest({ ...HELD, ...W6, ...CHECK });
  setPromptSpy(() => {});
  const script = { 'panel-1-raiser': objects(rel(X5, 'new')), 'panel-2-raiser': objects(rel(X5, `continues ${objectionId('raiser', X5)}`)) };
  const id = objectionId('raiser', X5);
  const make = extra => {
    setCache({ invalidate() {}, get(label) {
      served.push(label);
      const all = { ...script, 'rule-3-mid': rules([{ id, ruling: 'overrule', reason: 'Section two sets the limit.' }]), ...extra };
      if (label in all) return { text: all[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
      if (label.startsWith('build-check-')) return null;
      const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
      return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    } });
    const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
    return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-ub-q-g', log: () => {}, config: { name: 'fixture-q-g', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
      seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seat) } } });
  };
  const ask = await make({}).then(() => null, e => e);
  assert.ok(ask instanceof ExternalPause && ask.label === 'build-check-1', String(ask));
  const listed = ask.user.match(new RegExp(`- ${id} \\(raised in layer 1;`, 'g')) ?? [];
  // CHANGED ACCEPTED (0.8.4 S5, C&C 08 Nov 2026), comment only: "ONCE" is guaranteed by the Map in openAtAgreement (chain.js, `out` keyed lab + id) and by one rendered line per item; this assertion does not test it and cannot fail on it. What it CAN see is zero listings: the overruled X (rated 5) is dropped when the overrule closes it (severity.js closesOnOverrule, `v < 4`). The red line is that one, shared with UB-10.
  assert.equal(listed.length, 1, 'the build check lists the open overruled objection once');
  const result = await make({ 'build-check-1': answer('good_to_build', `${id}: the build can leave it, the limit is set in section two.`) });
  assert.deepEqual(result.buildChecks[0].required, [id]);
});

const Y5 = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
const idY5 = objectionId(LOW, Y5);

test('UB-9 item 5 [DEMAND + FIXTURE]: X stalls and is overruled-but-open; Y (raised in pass 2 only) is held by the same layer and was NOT passed up: at the escalated sign-off BOTH reach the dispute stage\'s open set, ONCE each, X with its ruling and Y without', async () => {
  const { report } = await run({ held: HELD, script: { 'panel-1-raiser-alpha': objects(N(X5)), 'panel-2-raiser-alpha': objects(again(X5), N(Y5)), ...OVERRULE(idX) } });
  assert.deepEqual(report.escalations[0].ids, [idX], 'only X went up');
  assert.deepEqual(report.escalations[0].outcome.map(o => o.id), [idX], 'X has a ruling; Y has none');
  const open = report.dispute.open_objections.map(o => o.id);
  assert.equal(open.filter(i => i === idX).length, 1, 'X once (through the escalated list, not also through the not-asked list)');
  assert.equal(open.filter(i => i === idY5).length, 1, 'Y once (through the not-asked list)');
  assert.equal(report.dispute.open_objections.find(o => o.id === idX).escalated_standing, true);
  assert.equal(report.dispute.open_objections.find(o => o.id === idY5).not_asked_in_final_round, true);
});

test('UB-10 item 5, the AGREED end [DEMAND + FIXTURE + W6 + the build-check wording]: Y (not passed up) is demanded by the build check, once, together with X', async () => {
  setHeldForTest({ ...HELD, ...W6, ...CHECK });
  setPromptSpy(() => {});
  const id = objectionId('raiser', X5); const idY = objectionId('raiser', Y5);
  const script = { 'panel-1-raiser': objects(rel(X5, 'new')), 'panel-2-raiser': objects(rel(X5, `continues ${id}`), rel(Y5, 'new')), 'rule-3-mid': rules([{ id, ruling: 'overrule', reason: 'Section two sets the limit.' }]) };
  const make = extra => {
    setCache({ invalidate() {}, get(label) {
      const all = { ...script, ...extra };
      if (label in all) return { text: all[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
      if (label.startsWith('build-check-')) return null;
      const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
      return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    } });
    const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
    return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-ub-10', log: () => {}, config: { name: 'fixture-item5', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
      seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seat) } } });
  };
  const ask = await make({}).then(() => null, e => e);
  assert.ok(ask instanceof ExternalPause && ask.label === 'build-check-1', String(ask));
  // CHANGED ACCEPTED (0.8.4 S5, C&C 08 Nov 2026), comment only: "ONCE" is guaranteed by the Map in openAtAgreement (chain.js, `out` keyed lab + id) and by one rendered line per item; this loop does not test it and cannot fail on it. The red lands on X (overruled, rated 5: severity.js closesOnOverrule, `v < 4`, the line shared with UB-8); Y's listing has no red of its own.
  for (const i of [id, idY]) assert.equal((ask.user.match(new RegExp(`- ${i} \\(raised in layer 1;`, 'g')) ?? []).length, 1, `${i} is listed once`);
  const result = await make({ 'build-check-1': answer('good_to_build', `${id} and ${idY}: the build can leave both, section two covers them.`) });
  assert.deepEqual(result.buildChecks[0].required, [id, idY].sort());
});

test('UB-11 SCAN PIN: an escalation exists only on a layered unanimous chain, which is exactly where the severity ledger (`sevRun`) is built, so a ruling is never judged without a ledger (on a chain without it every overrule would leave its objection open, unrated)', () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/chain.js'), 'utf8');
  assert.match(src, /const layerDebateOn = layered && config\.signoff === 'unanimous';/);
  assert.match(src, /const sevRun = layerDebateOn \? createSeverityRun\(\) : null;/);
  const loop = src.indexOf("if (config.signoff === 'unanimous') {\n    for (let round = 1; round <= maxRounds; round++) {");
  assert.ok(loop > 0 && src.indexOf('const passUp = (up, trigger, rounds, only = null') > loop, 'passUp (the only place an escalation is created) sits inside the unanimous pass loop');   // CHANGED ACCEPTED (0.8.4 S7, 9a4b7f56). OLD: the searched text ended at `only = null)`. NEW: it ends at `only = null`, the prefix of the signature. WHY: S7 A2 added a fifth parameter (`layerOnly = null`) after `only`, so the closing parenthesis moved; the row pins WHERE passUp sits, not how many parameters it has. (On the S5 tree the old text still matches: this edit changes nothing there.)
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026). OLD: `const up = layered && round < maxRounds && stallGoUpOn ? escalationTarget(`. NEW: `... && stallGoUpOn && !ladderLive ? ...`: a ladder pass never passes the plan up (the stall stop runs on ladder passes, top layer only).
  // CHANGED ACCEPTED TEST (0.8.4 apply, the stranded-run fix; found by job 231, whose row 13 is the red on the landing tree). OLD: `... && stallGoUpOn && !ladderLive ? escalationTarget(`. NEW: `... && !ladderLive && !ladderNextPass ? ...`: the last credited pass, whose next pass is a ladder pass, passes nothing up either (it stops for the person: stall_stop, why ladder_next).
  assert.match(src, /const up = layered && round < maxRounds && stallGoUpOn && !ladderLive && !ladderNextPass \? escalationTarget\(/, 'and only a layered chain passes a stall up, never a ladder pass and never the pass before one');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state; UB-12; C&C ruling 12 Nov 2026, re-aimed to the plan's Q12 rule). OLD: the stub replies carried failures with no `relation` field, so the run refused them as relation_missing, signed off in pass 1 and never escalated (box job 58, `report.escalations` undefined); and the row expected the raise of the withdrawn X under the SAME id, listed once with the standing flag. NEW: each reply carries its relation (`new`, `continues <id>`, `reopens <id>`); the raise of the withdrawn X is a REOPEN, so the open list holds the new linked id X#r2 once (and no bare X), and X#r2 carries no standing flag while H5a does. WHY: with relations recorded a reopen of a withdrawn id is the plan's Q12 rule (a new id with the suffix r2, linked); the flag `escalated_standing` marks an objection an escalation PASSED UP whose layer was passed over in the final round (src/chain.js standingFailures, the escalation's own items): the second escalation passed up H5a only, so X#r2 was never passed up and has none (box job 68 print of the open list: [mid-beta's id, X#r2 with no flag, H5a standing]).
test('UB-12 item 5, the latest position (correction 10g) [DEMAND + FIXTURE]: X is passed up and overruled-but-open, the raiser WITHDRAWS it, raises it again as a REOPEN (Q12: the new linked id X#r2), and a second escalation passes the layer over in the final round: X#r2 is listed ONCE, H5a as standing dissent', async t => {
  const { report } = await run({ held: HELD, maxRounds: 6, script: {   // CHANGED ACCEPTED (second box run, 08 Nov 2026). OLD: maxRounds 7. NEW: 6. WHY: with 7 the run had a real pass 7 (the box layers line showed `7.1:objected`), the escalation of pass 6 was over by then, so no layer was passed over in the FINAL round and X had no route into the standing list; the row says "passes the layer over in the final round", so pass 6 must be the last (UB-13 below uses 6 for the same shape). The assertions are unchanged.
    'panel-1-raiser-alpha': objects(N(X5)), 'panel-2-raiser-alpha': objects(again(X5)),        // X stalls: escalation 1 (pass 3)
    'panel-3-mid-beta': objects(N(Y6)), ...OVERRULE(idX),                                           // layer 2 overrules X (rated 5: it stays open) and objects itself, so the run goes on
    'panel-4-raiser-alpha': objectsAnswering([N(H5a)], withdraws(idX)),                             // pass 4: layer 1 withdraws X and raises H5a
    'panel-5-raiser-alpha': objects(again(H5a), rel(X5, `reopens ${idX}`)),                          // pass 5: H5a stalls (passes 4, 5) and X is raised again (`reopens`)
    'rule-6-mid-beta': rules([{ id: idH5a, ruling: 'overrule', reason: 'Section two sets the scope.' }]),   // escalation 2 (pass 6): layer 1 is passed over in the final round
  } });
  const lbl = id => id === idX ? 'X' : id === idH5a ? 'H5a' : String(id).slice(0, 12);
  t.diagnostic(('UB-12 dx ' + JSON.stringify({ esc: (report?.escalations ?? []).map(e => ({ trigger: e.trigger, pass: e.pass, ids: (e.ids ?? []).map(lbl) })), layers: (report?.layers ?? []).map(x => `${x.round}.${x.layer}:${x.state}`).join(' '), open: (report?.dispute?.open_objections ?? []).map(o => ({ id: lbl(o.id), lab: o.lab, seat: o.seat, standing: o.escalated_standing })) })).slice(0, 600));   // TEST-ONLY diagnostic: the values the assertions below compare (X = idX, H5a = idH5a)
  // premises, so a red here names the right cause
  assert.equal(report.escalations.length, 2, 'two escalations');
  assert.deepEqual(report.escalations[1].ids, [idH5a], 'the second one passed up H5a only');
  assert.match(states(report), /6\.1:escalated/, 'layer 1 was passed over in the final round');
  assert.ok((report.answer_back_replies ?? []).some(r => r.id === idX && r.round === 4 && /^withdrawn/.test(r.effect)), 'the withdrawal of X was recorded in round 4');
  // the check
  const open = report.dispute.open_objections;
  const idX2 = `${idX}#r2`;
  assert.equal(open.filter(o => o.id === idX2).length, 1, 'the reopened X is listed once, under its new linked id');
  assert.equal(open.filter(o => o.id === idX).length, 0, 'the withdrawn X is not listed: its reopen replaced it');
  assert.equal(open.find(o => o.id === idX2).escalated_standing, undefined, 'no escalation passed X#r2 up, so it carries no standing flag');
  assert.equal(open.filter(o => o.id === idH5a).length, 1, 'H5a once');
  assert.equal(open.find(o => o.id === idH5a).escalated_standing, true, 'H5a was passed up by the second escalation and its layer was passed over in the final round');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state; UB-13; C&C ruling 12 Nov 2026). OLD: the replies carried no `relation` (the run refused them and never escalated), and the row expected the raise of the sustained, adopted id to be COUNTED under the same id: escalations[0].raised_again [{ pass: 4, lab, id, counted: true }], the raiser's id listed once under that id. NEW: each reply carries its relation; the raise of the adopted id is a REOPEN and gets a linked id (X#r2): no raised_again is recorded for it (escalations[0].raised_again is absent), the second escalation passes up X#r2 beside H5a, and the open list holds X#r2 once (standing dissent, at its own rating), the sustainer's adopted copy once and H5a once. The declaring pass's entries name the old id (`reopens`) and the relation on lastCritique.failures and signoff[].objections; those entries of pass 4 are on no report list of this run, so that pin is the existing rows (objection-assign: T12c, which pins reopens for an id the seat withdrew; objection-closed-states: the assigner row over withdrawn, overruled, adopted and re-tagged ids, and T12g, T12n). WHY: the plan's relation field (Q12) says of `reopens <id>` ("an id this seat withdrew, or one an upper layer overruled and closed on the record (rated below 4, RT in Part 0) or sustained and adopted (D20), or one cleared by a re-tag below 4 (N25)"): "a new id is minted, the derived key with the suffix r2, r3 and so on, ... with a link to the old one; the withdrawal or the overrule stays on the record". So the raise of the adopted id is a reopen under a new linked id, not a re-raise counted under the old one; the link is the declaring pass's entry (above); nothing is claimed about a pass that only continues the reopened id. The escalation row writes raised_again only when a judge raised a filtered id again, so here the field is absent.
test('UB-13 item 5, a RE-OPENED id (correction 10g, the second hunk of the latest-position series) [DEMAND + FIXTURE]: an UNQUOTED id is sustained and adopted, its raiser reopens it (a linked X#r2, counted at its own rating), a second escalation passes the layer over in the final round: X#r2 is listed ONCE as standing dissent, the sustainer\'s adopted copy once as its own, and no raised_again is recorded', async () => {
  const Xu = { criterion: CRITERION, problem: 'No limit on retries.', fix: 'State a limit.', severity: 5 };   // no quote: the key is the lab and the criterion alone
  const idXu = objectionId(LOW, Xu); const idB = objectionId('mid-beta', Xu); const idXu2 = `${idXu}#r2`;
  const { report } = await run({ held: HELD, maxRounds: 6, script: {
    'panel-1-raiser-alpha': objects(N(Xu)), 'panel-2-raiser-alpha': objects(again(Xu)),          // Xu stalls: escalation 1 (pass 3)
    'rule-3-mid-beta': rules([{ id: idXu, ruling: 'sustain', reason: 'The limit is not stated.' }]),   // layer 2 sustains it (rated 5: it holds, the pass ends and the writer revises)
    'panel-4-raiser-alpha': objects(rel(Xu, `reopens ${idXu}`), N(H5a)), 'panel-5-raiser-alpha': objects(rel(Xu, `continues ${idXu2}`), again(H5a)),          // pass 4: Xu reopened (X#r2) beside H5a; pass 5: H5a stalls (passes 4, 5): escalation 2 (pass 6)
    'rule-6-mid-beta': rules([{ id: idH5a, ruling: 'overrule', reason: 'Section two sets the scope.' }]),
    'panel-6-mid-beta': objects(again(Xu, 'mid-beta')),                                                              // the sustainer still holds its adopted copy in the final round
  } });
  // premises, so a red here names the right cause
  assert.equal(report.escalations.length, 2, 'two escalations');
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.id, o.result, o.adopted_as?.map(a => a.id)]), [[idXu, 'sustained', [idB]]]);
  assert.equal(report.escalations[0].raised_again, undefined, 'the raise of the adopted id is a reopen: no counted re-raise is recorded');
  assert.deepEqual([...report.escalations[1].ids].sort(), [idXu2, idH5a].sort(), 'the second one passed up the reopened X#r2 and H5a');
  assert.match(states(report), /6\.1:escalated/, 'layer 1 was passed over in the final round');
  // the check
  const open = report.dispute.open_objections;
  assert.equal(open.filter(o => o.id === idXu2).length, 1, 'the raiser\'s reopened id is listed once, under its own linked id');
  assert.equal(open.find(o => o.id === idXu2).escalated_standing, true);
  assert.equal(open.filter(o => o.id === idXu).length, 0, 'the old id is not listed: its sustain closed it for its first owner');
  assert.equal(open.filter(o => o.id === idB).length, 1, 'the sustainer\'s adopted copy once, as its own');
  assert.equal(open.filter(o => o.id === idH5a).length, 1, 'H5a once');
  assert.equal(report.severity.open_at_end.find(o => o.id === idXu2)?.severity, 5, 'the reopened objection stands at its own rating (5)');
});
