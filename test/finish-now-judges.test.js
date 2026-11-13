// 0.8.4 (the ladder unit, fix-up of 4a; found while tracing the budget stop): "after finish-now NO JUDGE is asked again" asserted BY SEAT ROLE. FN-1 matched post-loop LABELS (final-read, ldebate-end, lreply-end) and could not see two other post-loop calls to a
// critic seat: the dispute reviews (asked of the judges that raised the objections; opt-in dispute.review) and the challenge (asked of config.seats.challenger, else of critics[0], a judge; opt-in challenge.enabled). Here every call is recorded with the seat's model
// (critics carry one model, the writers another), and the judge-model calls of a finish-now run must be exactly those of the pass history. Offline, $0. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, RoundStopped } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); });

const CRITERION = 'The plan defines a retry limit.'; const DRAFT = 'The worker retries failed requests.'; const TOP = 'top-gamma'; const LOW = 'raiser-alpha';
const LIMITS = { maxOverseerRounds: 2, layerRevisions: { 1: 1, 2: 1 } };   // the limits the chain below runs under (roundChoiceEntry records them as the fixtures of finish-now.test.js do)
const JUDGE = 'mock-review-fixture'; const WRITER = 'mock-builder';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const objectsAnswering = (fs, answers) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, answers, verdict_line: 'no' });
const quotes = ['The worker', 'retries failed', 'failed requests', 'The worker retries', 'retries failed requests', 'worker retries failed'];
const T = i => ({ criterion: CRITERION, problem: `Problem ${i}.`, quote: quotes[i], fix: 'Fix it.', severity: 5, relation: 'new' });   // K1, K3: relationRule and ratingDemand are recorded; each pass raises a different problem, so every one is a first raise
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];
const reply = (lab, k) => (k === 1 ? objects(T(0)) : objectsAnswering([T(k - 1)], withdraws(objectionId(lab, T(k - 2)))));
const script = (lab, passes) => Object.fromEntries(Array.from({ length: passes }, (_, i) => [`panel-${i + 1}-${lab}`, reply(lab, i + 1)]));

async function run(roundChoices = [], extra = {}) {
  const calls = [];
  setPromptSpy(p => { calls.push({ label: p.label, model: p.model }); }); setHeldForTest(null);
  const scripted = script(TOP, 2);
  setCache({ invalidate() {}, get(label) {
    const text = label in scripted ? scripted[label] : label === 'challenge' ? JSON.stringify({ challenge: false }) : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: JUDGE, lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: WRITER, lab: 'writer' };
  const config = { name: 'fixture-fnj', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2, review: true }, challenge: { enabled: true },
    maxOverseerRounds: 2, layerRevisions: { 1: 1, 2: 1 }, seats: { builder: writer, reviser: writer, critics: [seat(LOW, 1), seat('mid-beta', 2), seat(TOP, 3)] }, ...extra };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-fnj', log: () => {}, config, roundChoices }); } catch (e) { error = e; }
  return { result, error, calls, judgeLabels: calls.filter(c => c.model === JUDGE).map(c => c.label), report: result ? JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-fnj', chain: 'fixture-fnj', task: 't.md', result, config }))) : null };
}

test('FNJ-1 (by seat role): at an overseer-cap stop, a finish-now run makes NO call to a judge seat after the pass history (no dispute review, no challenge, no final read, no exchange), where the plain finish at the same stop does (the premise: both the dispute review and the challenge are asked of judges); the report names what was not run', async () => {
  const control = await run();
  assert.ok(control.error instanceof RoundStopped, 'the premise: the chain stops at the overseer cap');
  const history = control.judgeLabels;   // the judge calls of the pass history (the run that only stopped)
  const plain = await run([roundChoiceEntry(control.error.stop, 'finish', LIMITS)]);
  assert.equal(plain.error, null, String(plain.error));
  const extra = plain.judgeLabels.filter(l => !history.includes(l));
  assert.ok(extra.some(l => /^dispute-review-/.test(l)), `the premise: a plain finish asks the dispute reviews of the judges that raised the objections (${extra})`);
  assert.ok(extra.includes('challenge'), `the premise: a plain finish asks the challenge of critics[0], a judge (${extra})`);
  const now = await run([roundChoiceEntry(control.error.stop, 'finish_now', LIMITS)]);
  assert.equal(now.error, null, String(now.error));
  assert.deepEqual(now.judgeLabels, history, 'a finish-now run makes no judge call beyond the pass history, whatever the post-loop stage');
  assert.deepEqual([now.report.dispute?.ran, now.report.dispute?.review_not_run], [true, 'finished_at_once'], 'the dispute stage still ran (a writer), its judge reviews did not');
  assert.equal(now.report.dispute?.review, undefined);
  assert.deepEqual(now.report.challenge, { ran: false, reason: 'finished_at_once' });
});

test('FNJ-2 (by seat role): a challenger seat that is NOT a judge of the panel still runs after a finish-now (the rule is about judges); the control of FNJ-1 asked critics[0]', async () => {
  const challenger = { provider: 'mock', model: 'mock-challenger-fixture', lab: 'challenger-delta', maxTokens: 3000 };
  const control = await run();
  assert.ok(control.error instanceof RoundStopped);
  const stop = control.error.stop;
  const seat = (lab, layer) => ({ provider: 'mock', model: JUDGE, lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: WRITER, lab: 'writer' };
  const now = await run([roundChoiceEntry(stop, 'finish_now', LIMITS)], { seats: { builder: writer, reviser: writer, challenger, critics: [seat(LOW, 1), seat('mid-beta', 2), seat(TOP, 3)] } });
  assert.equal(now.error, null, String(now.error));
  assert.ok(now.calls.some(c => c.model === 'mock-challenger-fixture' && c.label === 'challenge'), 'the challenger (not a judge) was asked');
  assert.equal(now.report.challenge?.ran, undefined, 'and the challenge is not recorded as not run');
});
