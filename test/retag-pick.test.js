// 0.8.4, A5 (his 03 Nov 2026 17:39: "the handling session and its advisor pick one of the two, as the plan already does when the two top judges split at the final read (D31)"; C&C's ruling 10 Nov 2026: way 1, through the same mechanism as the sort wait).
// Two top-layer seats re-rate ONE objection to different ratings in the same pass (fixture: test/s17-layer3-retag.test.js with a second top seat). With a handling session (an external reviser) and the wording held in test/held-prompts/held-084-a5.js, the run WAITS at `retag-pick-1`
// for the handler's pick before anything is put in force; the pick is what applies, and every row of the objection says so (picked_by, pick_reason). A chain with no handling session keeps "the higher rating applies" (the control run, which is also the fixture's premise).
// Written without a run (no tests on the laptop): the first box run decides the fixture. Namespace-free on purpose: this file imports no src module the change adds, so a tree without it fails at the first behavioural assertion and not at a load error.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { SORTING } from './helpers/rating-demand.js';
import { CRITERION } from './helpers/layer-two-run.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { handlerRetagPickSystem, handlerRetagPickUser } from './held-prompts/held-084-a5.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const Y = { criterion: CRITERION, problem: 'No owner is named.' };
const idY = objectionId('mid-beta', Y);
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5 };
const idL3 = objectionId('top-gamma', L3F);
const GOUP = { goUpRulingSystem: HB084.goUpRulingSystem, goUpRulingUser: HB084.goUpRulingUser, goUpRulingsSection: HB084.goUpRulingsSection };
const verdictOf = (failures, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no', ...extra });
const meetsOf = extra => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const rulesOf = (id, reason) => JSON.stringify({ rulings: [{ id, ruling: 'overrule', reason }] });
const FOUND = 'It reads "The worker retries failed requests."';
const ABSENT = 'It reads "The worker uses exponential back-off."';
const RATE = 5;          // the rating mid-beta gives Y
const GAMMA_TO = 2;      // top-gamma re-tags Y to 2 (below 4: it would not hold the sign-off)
const DELTA_TO = 6;      // top-delta re-tags Y to 6 (it holds the sign-off)

// session: whether the chain has a handling session (an external reviser); answers: the handler's replies by label ({ 'retag-pick-1': ... }); a label with no answer is a miss, so the stage waits
async function run({ session, answers = {} }) {
  const served = [];
  setHeldForTest({ ...SORTING, ...GOUP, dissentRecordSection: () => '', ...(session ? { handlerRetagPickSystem, handlerRetagPickUser } : {}) });
  const script = {
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried no `relation`. NEW: mid-beta's first raise says `new`; its repeats in passes 2 and 5 say `continues <id>` (the pass-4 withdrawal quotes a passage the draft does not hold, so it is refused and Y stands); top-gamma's own objection says `new`. WHY: relationRule recorded (src/chain.js relation gate).
    'panel-1-mid-beta': verdictOf([{ ...Y, severity: RATE, relation: 'new' }]), 'panel-2-mid-beta': verdictOf([{ ...Y, severity: RATE, relation: `continues ${idY}` }]),
    'rule-3-top-gamma': rulesOf(idY, 'Section two names the owner.'), 'rule-3-top-delta': rulesOf(idY, 'Section two names the owner.'),
    'panel-3-top-gamma': verdictOf([{ ...L3F, relation: 'new' }]),
    'panel-4-mid-beta': meetsOf({ answers: [{ id: idY, status: 'withdrawn', evidence: ABSENT }] }),
    'panel-5-mid-beta': verdictOf([{ ...Y, severity: RATE, relation: `continues ${idY}` }]),
    'rule-6-top-gamma': rulesOf(idY, 'Section two names the owner.'), 'rule-6-top-delta': rulesOf(idY, 'Section two names the owner.'),
    'panel-6-top-gamma': meetsOf({ answers: [{ id: idL3, status: 'withdrawn', evidence: FOUND }], retags: [{ id: idY, severity: GAMMA_TO, reason: 'Section two names the owner.' }] }),
    'panel-6-top-delta': meetsOf({ retags: [{ id: idY, severity: DELTA_TO, reason: 'The owner is named only in passing.' }] }),
  };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row A5): OLD: only `retag-pick-*` labels were served from `answers`; every other label got the stub's default text. NEW: `build-check-*` labels are served from `answers` too (a miss when unanswered, so the run waits at the check as shipped). WHY: the TAP's error line "the handler's pick applies and is recorded on both rows (the run ended with ExternalPause: waiting for external stage build-check-1)": with the pick given, the run reaches layer 3's sign-off and a layered run with an EXTERNAL reviser WAITS at build-check-1 (src/chain.js askBuildCheck: `!layered || !buildCheckLive() || !hasHandlingSession(config)` is false here), where the stub used to hand back the plan text as its answer.
    if (label.startsWith('retag-pick-') || label.startsWith('build-check-')) return label in answers ? hit(answers[label]) : null;
    if (label in script) return hit(script[label]);
    return hit(label.startsWith('panel-') || label.startsWith('final-read-') ? meetsOf() : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.');
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-a5-retag-pick', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: writer, reviser: session ? { ...writer, provider: 'external' } : writer, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3), seat('top-delta', 3)] } };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-a5-pick', log: () => {}, config }); } catch (e) { error = e; }
  return { result, error, served };
}
const recordOf = r => r.result ?? r.error?.partial;
const rowsOf = r => (recordOf(r)?.severityRun?.retags || []).filter(x => x.id === idY);

test('A5: two top-layer seats re-rate one objection to 2 and 6 in one pass: with a handling session the run WAITS at retag-pick-1 for the handler\'s pick (a pick that is not one of the two ratings, or has no reasons, or does not name the id, is no answer), and the pick is what applies, recorded on both rows; with no session the higher rating (6) applies and nothing waits', async () => {
  // the control, and the fixture's premise: no handling session: both seats' rows are recorded, the higher rating applies, nothing waits
  const control = await run({ session: false });
  assert.deepEqual(rowsOf(control).map(x => [x.seat, x.to, x.applied_to, x.picked_by]), [['top-gamma', GAMMA_TO, DELTA_TO, undefined], ['top-delta', DELTA_TO, DELTA_TO, undefined]], `premise: with no session the higher rating applies and both rows are recorded (${control.error ? `the run ended with ${control.error.constructor?.name}: ${String(control.error.message).slice(0, 120)}` : 'the run ended'})`);
  assert.deepEqual(control.served.filter(l => l.startsWith('retag-pick-')), [], 'no session: no pick wait is asked');

  // the handling session: the first sitting waits at retag-pick-1 and shows both ratings and their reasons
  const first = await run({ session: true });
  assert.ok(first.error instanceof ExternalPause && first.error.label === 'retag-pick-1', `the run waits for the handler's pick (${first.error ? first.error.constructor?.name + ' ' + (first.error.label ?? first.error.message) : 'it ended'})`);
  assert.match(first.error.user, /- top-gamma re-rated it to 2\.0: /);
  assert.match(first.error.user, /- top-delta re-rated it to 6\.0: /);
  assert.ok(first.error.user.includes(idY), 'the objection is named by its id');
  assert.equal(first.served.at(-1), 'retag-pick-1', 'the wait is the last thing the run asked for: nothing was asked after it');

  // a pick that is not one of the two ratings is no answer: the wait stays
  const refused = await run({ session: true, answers: { 'retag-pick-1': JSON.stringify({ pick: 4, reasons: `${idY}: the middle.` }) } });
  assert.ok(refused.error instanceof ExternalPause && refused.error.label === 'retag-pick-1', 'a rating that was not offered is refused: the run waits at the same pause again');
  // a pick whose reasons do not name the id is no answer either
  const noId = await run({ session: true, answers: { 'retag-pick-1': JSON.stringify({ pick: GAMMA_TO, reasons: 'The owner is named.' }) } });
  assert.ok(noId.error instanceof ExternalPause && noId.error.label === 'retag-pick-1', 'reasons that do not name the objection are refused: the run waits again');

  // the pick: the lower rating, with reasons that name the id: it applies (not the higher), and both rows of the objection say the handler picked
  const reasons = `${idY}: section two names the owner, so it does not hold the build.`;
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row A5): OLD: the picked run was a single `run(...)`. NEW: after the pick the handling session answers the build check the run now waits at (build-check-1: good_to_build, its reasons naming every id the check lists, read from the check's own pause text the way test/helpers/build-check.js answerBuildChecks reads NEEDS-build-check-<n>.md). WHY: see the marker at the cache stub; the pick is still what applies and is recorded on both rows, nothing in the assertion below moved.
  let done = await run({ session: true, answers: { 'retag-pick-1': JSON.stringify({ pick: GAMMA_TO, reasons }) } });
  const checkAnswers = {};
  for (let i = 0; i < 5 && done.error instanceof ExternalPause && /^build-check-\d+$/.test(done.error.label); i++) {
    const ids = [...new Set([...done.error.user.matchAll(/^- ([OL]-[0-9a-f]{8}(?:#r?\d+)?) \(/gm)].map(m => m[1]))];
    checkAnswers[done.error.label] = JSON.stringify({ answer: 'good_to_build', reasons: ids.map(id => `${id}: the build can do it.`).join(' ') });
    done = await run({ session: true, answers: { 'retag-pick-1': JSON.stringify({ pick: GAMMA_TO, reasons }), ...checkAnswers } });
  }
  assert.deepEqual(rowsOf(done).map(x => [x.seat, x.to, x.applied_to, x.by, x.picked_by, x.pick_reason]), [['top-gamma', GAMMA_TO, GAMMA_TO, 'layer3', 'handler', reasons], ['top-delta', DELTA_TO, GAMMA_TO, 'layer3', 'handler', reasons]], `the handler's pick applies and is recorded on both rows (${done.error ? `the run ended with ${done.error.constructor?.name}: ${String(done.error.message).slice(0, 120)}` : 'the run ended'})`);
});
