// 0.8.4 (a fix-up on the round rule): `signed_text.round` on a layered chain is the latest round in which a seat was SENT the signed text. "Sent" is not "a reply came back": a pass in which every seat was shown the text and
// none could be heard still counts (the entry's own words: "in a round where no seat could be heard the draft was shown but nobody read it"); a pass whose first call was never made does not; a seat's reply the person's
// `--finish` discarded (the row is marked `cut`) does not make its pass the round. What tells the cases apart (not a wording pin): the field `signed_text.round` of in-process runs, offline, $0.
//   S1 a finish at the spending limit that refused the pass's FIRST call: nobody was sent the text: null.
//   S2 the limit refused layer 2's call, layer 1 was heard: 1.
//   S3 the limit refused the SECOND seat of layer 1, the first was sent and answered (its stage is in the run). CHANGED ACCEPTED (PR #2 fix unit, item 1): OLD: its answer was in no report row, so the round was 1. NEW: its answer is a row marked `cut` (the answered judge is kept), so the rule above applies to it, "a pass whose only calls were cut does not count": null (as in a relay panel's finish today).
//   P a partly cut round (the secret-pause cut of CUT-1's fixture): round 1.
//   U the finish at the silent-judge stop (layer_bound, unheard): layer 1's only seat was sent the text and could not be heard, the layers above were not asked: round 1. A control beside S3, green on both trees (the old rule counted its `unheard` row).
//   By read, no row drives it: a pass whose layers were all CARRIED verdicts (no call went out, so it is not counted: a layer row counts only when it is not wholly carried).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as chain from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { scenario, FINAL_READ_OK } from './helpers/layer-two-run.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { stopIdOf } from '../src/overseer-rounds.js';
import * as HB084 from './held-prompts/held-084-b.js';

afterEach(() => { chain.setSpendFinish?.(null); chain.setCache(null); chain.setBudget(null); chain.setPromptSpy(null); chain.setOutboundScan({}); setHeldForTest(null); });

const DISPUTE = { dispute: { enabled: true, stall_rounds: 2 } };
const overrides = { 'panel-1-la': FINAL_READ_OK['final-read-lc'], 'panel-1-la2': FINAL_READ_OK['final-read-lc'], ...FINAL_READ_OK };
async function spendStopped({ critics = null, cutLabel }) {
  chain.setSpendFinish?.({ capName: 'anthropic' });
  const { result } = await scenario({ extra: { ...DISPUTE }, cutLabels: [cutLabel], ...(critics ? { critics } : {}), overrides });
  assert.equal(result.stop?.kind, 'budget_stop', `premise: the finish at the spending limit ended the run: ${JSON.stringify(result.stop)}`);
  assert.equal(result.stop?.pass, 1, 'premise: in pass 1');
  return result;
}
const stateOf = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');

test('S1 the limit refused the pass\'s first call: nobody was sent the text, signed_text.round is null', async () => {
  const r = await spendStopped({ cutLabel: 'panel-1-la' });
  assert.equal(r.stages.some(s => /^panel-1-/.test(s.label)), false, 'premise: no panel call of pass 1 was made');
  assert.equal(r.signedText.round, null, stateOf(r));
});
test('S2 layer 1 was heard, the limit refused layer 2: round 1', async () => {
  const r = await spendStopped({ cutLabel: 'panel-1-lb' });
  assert.ok(r.layers.some(x => x.layer === 1 && x.state === 'signed_off'), `premise: layer 1 was heard: ${stateOf(r)}`);
  assert.equal(r.signedText.round, 1, stateOf(r));
});
test('S3 the limit refused the second seat of layer 1, the first was sent and answered (its answer is a row marked cut, never a heard layer): round null, as the only calls of the pass were cut', async () => {
  const r = await spendStopped({ critics: [['la', 1], ['la2', 1], ['lb', 2], ['lc', 3]], cutLabel: 'panel-1-la2' });
  assert.ok(r.stages.some(s => s.label === 'panel-1-la'), 'premise: the first seat of layer 1 was sent the text (its stage is in the run)');
  assert.deepEqual(r.panelVerdicts.map(v => [v.lab, v.cut === true]), [['la', true]], 'premise: its answer is a row marked cut');
  assert.equal(r.layers.filter(x => x.state === 'signed_off' || x.state === 'objected').length, 0, `premise: no layer is recorded as heard: ${stateOf(r)}`);
  assert.equal(r.signedText.round, null, stateOf(r));
});

test('U the finish at the silent-judge stop: layer 1 was sent the text and could not be heard, nothing above was asked: round 1', async () => {
  // a mock-unreadable seat served live (silentLabs: the cache does not answer it), so the pass ends `unheard` and the run stops at layer_bound; the stop is then finished at once as the person's recorded choice
  const base = { extra: { ...DISPUTE }, critics: [['la', 1, 'mock-unreadable'], ['lb', 2], ['lc', 3]], silentLabs: ['la'] };
  let stop;
  await assert.rejects(scenario(base), e => { stop = e.stop; return stop?.kind === 'layer_bound' && stop.why === 'unheard'; }, 'premise: the run stops at the silent-judge stop');
  const { result: r } = await scenario({ ...base, runExtra: { roundChoices: [{ choice: 'finish_now', stop: stopIdOf(stop), kind: stop.kind }] } });
  assert.deepEqual(r.layers.map(x => `${x.round}.${x.layer}:${x.state}`), ['1.1:unheard', '1.2:not_asked', '1.3:not_asked'], 'premise: the shape');
  assert.equal(r.signedText.round, 1);
});

// ---- P: a PARTLY cut round (the fixture of secret-pause-cut CUT-1): layers 1 and 2 were heard, the person's --finish cut layer 3's sign-off re-ask: layer 3's row is `unfinished`, its seats' rows are `cut`; the round counts: 1
{
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const reply = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');

// ---- the sign-off re-ask (short-exchange-signoff.test.js's fixture): layer 3's raiser r3 withdraws its only objection and ends "sign-off: no"; the extra verdict call (-reask3) is the call the finish cuts.
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule, signoffRefusedReaskNote: HB084.signoffRefusedReaskNote };
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried no `relation` (X3 no `severity` either). NEW: X3 carries `severity: 5` (layered unanimous chain: the rating demand); X3 carries no `relation` (the two X3 chains have no answer_back, so the judge is not asked for one); in the escalation fixture (answer_back on) the first raise of X says `new` and the second raise by the same seat (pass 2) says `continues <id>`. WHY: relationRule and ratingDemand recorded (src/chain.js relation gate; src/ratings-demand.js).
const X3 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 };
const idX3 = objectionId('r3', X3);
const support = id => JSON.stringify({ posts: [{ on: id, stance: 'support', text: 'It holds against the criteria.' }], new_objections: [] });
const withdraw = (id, line) => `${JSON.stringify({ replies: [{ id, action: 'withdraw', text: 'The quoted passage settles it.', quote: 'retries failed requests' }] })}\nsign-off: ${line}`;

async function runReask({ cutLabel }) {
  const script = { 'panel-1-r3': objects(X3), 'ldebate-1-q3': support(idX3), 'lreply-1-r3': withdraw(idX3, 'no'), [cutLabel]: null };
  setHeldForTest(PAIR);
  chain.setCache({ invalidate() {}, get(label) {
    if (label in script) return script[label] === null ? null : reply(script[label]);
    return reply((label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : DRAFT);
  } });
  chain.setOutboundScan({ finish: true });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-secret-cut-reask', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 1, seats: { builder, reviser: builder, critics: [seat('l1', 1), seat('l2', 2), seat('r3', 3), seat('q3', 3)] } };
  const result = await chain.runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-cut-reask', log: () => {}, config });
  return { result, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-cut-reask', chain: config.name, task: 't.md', result, config }))) };
}

test('P a partly cut round: layers 1 and 2 were heard, layer 3 was cut off: round 1 (the cut layer\'s own rows are discarded, the heard layers\' calls were sent)', async () => {
  const { report } = await runReask({ cutLabel: 'panel-1-r3-reask3' });
  assert.deepEqual(report.layers.map(x => `${x.round}.${x.layer}:${x.state}`), ['1.1:signed_off', '1.2:signed_off', '1.3:unfinished'], 'premise: the shape of CUT-1');
  assert.equal(report.signed_text.round, 1);
});
}
