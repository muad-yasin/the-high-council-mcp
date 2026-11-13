// PR #2 fix unit, item 2 (his 1:b, 13 Nov 2026: "Same row, but it counts as open: the report no longer says no objection stands, and accepting the plan lists it for you to answer. The found-secret finish changes the same way."):
// the objection of a judge whose row the person's finish marked `cut` is OPEN, in both finishes (the spending finish and the found-secret finish). A cut row still counts for no sign-off and no read, no route changes `passed`, the outcome, the ending word or the exit,
// and no model is asked about the objection after the finish. Offline, $0: the scenario of test/helpers/layer-two-run.js (judge `la` answered and raises "No retry limit is specified" rated 5; the stage of judge `lb` is a cache miss, so the armed finish ends the run at it).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import * as chain from '../src/chain.js';
import { computeOutcome } from '../src/outcome.js';
import { endsNotAgreed } from '../src/ending.js';
import { nothingStandsAtEnd } from '../src/ending-matrix.js';
import { openObjectionsOf } from '../src/acceptance.js';
import { reportJsonShape } from '../src/report-shape.js';
import { setHeldForTest } from '../src/held-roles.js';
import { scenario, FINAL_READ_OK, idOf, repeatOf, CRITERION, bareFailureOf } from './helpers/layer-two-run.js';
import { objectionId } from '../src/objection-ids.js';
import { DEMAND } from './helpers/rating-demand.js';
import { severityRecord } from '../src/severity.js';

afterEach(() => { chain.setSpendFinish?.(null); chain.setCache(null); chain.setBudget(null); chain.setPromptSpy(null); chain.setOutboundScan({}); chain.setNoMoneySitting?.(false); setHeldForTest(null); });

const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);

const PROBLEM = 'No retry limit is specified.';
const arm = kind => { if (kind === 'spend') chain.setSpendFinish({ capName: null }); else if (kind === 'spend-at-once') { chain.setSpendFinish({ capName: null, atOnce: true }); chain.setNoMoneySitting(true); } else chain.setOutboundScan({ finish: true }); };
const LAYERED = { critics: [['la', 1], ['lb', 1], ['lx', 2], ['lc', 3]], cutLabels: ['panel-1-lb'], extra: { dispute: { enabled: true, stall_rounds: 2 } }, overrides: { ...FINAL_READ_OK } };
const FLAT = { critics: [['la'], ['lb']], cutLabels: ['panel-1-lb'], extra: {}, answerBack: false };
const reportOf = (result, config = null) => JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-cut-open', chain: 'fixture-l2', task: 't.md', taskText: 'x', result, config })));

for (const kind of ['spend', 'secret']) {
  test(`${kind} finish, a layer with two blind judges: the cut judge's objection counts as open: the count, the dispute record's list and the person's accept list all carry it, and the report no longer says that no objection stands`, async () => {
    arm(kind);
    const { result: r } = await scenario(LAYERED);
    const report = reportOf(r);
    assert.equal(report.signed_text.open_objections, 1, 'Sol\'s case printed 0');
    const row = report.dispute.open_objections.find(o => o.id === idOf(5));
    assert.deepEqual([row?.lab, row?.cut_off, row?.first_raised_round, row?.problem], ['la', true, 1, PROBLEM], 'listed, marked, with the round the finish cut');
    assert.deepEqual(openObjectionsOf(report).map(o => o.id), [idOf(5)], 'accepting the plan lists it for the person to answer');
    assert.equal(report.dispute.stopped_at_round, 1, 'the dispute record names the pass the finish cut, not the round cap');
    assert.equal(nothingStandsAtEnd(report), false, 'the one fact "no objection stands" is false');
    assert.ok(validate(report), JSON.stringify(validate.errors?.slice(0, 3)));
  });

  test(`${kind} finish, an unlayered panel: the count carries the cut judge's objection`, async () => {
    arm(kind);
    const { result: r } = await scenario(FLAT);
    assert.equal(reportOf(r).signed_text.open_objections, 1);
    assert.equal(nothingStandsAtEnd(reportOf(r)), false);
  });

  test(`${kind} finish: counting it as open moves no route: passed, the outcome, the ending word and the exit are what a finish gave before, a cut row counts for no sign-off, and no judge or writer call after the finish carries the objection (a handoff stage, where the chain has one, reads the dissent block of the deliverable as at every not-agreed ending)`, async () => {
    arm(kind);
    const { result: r, prompts } = await scenario(LAYERED);
    const report = reportOf(r);
    assert.equal(r.passed, false);
    assert.equal(computeOutcome(r), 'no_consensus');
    assert.equal(report.ending_word, 'finish_chosen');
    assert.equal(endsNotAgreed(report), true, 'the exit stays "not agreed"');
    assert.equal(report.dispute.reason, 'finish_chosen');
    assert.ok(!(r.signoff ?? []).some(s => s.signedOff === true), 'a cut row is no sign-off');
    assert.deepEqual(r.stages.map(s => s.label), ['build', 'panel-1-la', 'final-read-lc'], 'the dispute stage listed the objection and made no call; the final read ran as before');
    for (const [label, p] of prompts) assert.ok(!`${p.system}\n${p.user}`.includes(PROBLEM), `the prompt of ${label} does not carry the cut judge's objection`);
  });
}

test('the finish at once (--finish-now at a spending stop): the cut judge\'s objection is open as well, and still no model is asked about it', async () => {
  arm('spend-at-once');
  const { result: r, prompts } = await scenario(LAYERED);
  const report = reportOf(r);
  assert.equal(r.stop?.finished_at_once, true);
  assert.equal(report.signed_text.open_objections, 1);
  assert.deepEqual(report.dispute.open_objections.map(o => [o.id, o.cut_off]), [[idOf(5), true]]);
  for (const [label, p] of prompts) assert.ok(!`${p.system}\n${p.user}`.includes(PROBLEM), `the prompt of ${label} does not carry it`);
});

test('a cut layer whose judges had all answered (the finish cut the exchange): each judge\'s objection is open, one row per judge', async () => {
  arm('spend');
  const second = JSON.stringify({ meets: false, criteria: [{ criterion: 'The plan defines a retry limit.', verdict: 'FAILED', evidence: 'x' }], failures: [{ criterion: 'The plan defines a retry limit.', problem: 'A second judge also objects.', fix: 'Fix it.', quote: 'retries failed requests', severity: 5, relation: 'new' }], verdict_line: 'no' });
  const { result: r } = await scenario({ ...LAYERED, cutLabels: ['ldebate-1-la', 'ldebate-1-lb'], overrides: { 'panel-1-lb': second, ...FINAL_READ_OK } });
  assert.deepEqual(r.panelVerdicts.map(v => [v.lab, v.verdict, v.cut]), [['la', 'objected', true], ['lb', 'objected', true]]);
  const report = reportOf(r);
  assert.equal(report.signed_text.open_objections, 2);
  assert.deepEqual(report.dispute.open_objections.map(o => [o.lab, o.cut_off]), [['la', true], ['lb', true]]);
});

// OLD (b625e0da, first draft of this unit): a cut judge that repeats, in new words, an objection it already holds: one row under the id with the cut reply's text, marked cut_off, and the dispute stage no longer litigated it
// ([[idOf(5), 'There is still no limit on retries.', true, 1]]). NEW (C&C's unit-end review, finding F1): an objection that was on the record before the cut (here: the judge's own pass-1 objection, held) stays exactly as it was when the judge's cut reply repeats it: its pass-1 row and text, no cut_off,
// counted once, listed once at accept, and in the list the dispute stage litigates (the dispute stage runs, as it did before this unit). The control run cuts the judge before its reply: nothing is repeated, and the row must be the same one.
const REPEATED = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ ...repeatOf(5), problem: 'There is still no limit on retries.' }], verdict_line: 'no' });
test('a cut judge that repeats, in new words, an objection it already holds: the objection stays as recorded before the cut (its pass-1 row, no cut_off), counted once, listed once at accept, and the dispute stage still litigates it', async () => {
  arm('spend');
  const { result: r, prompts } = await scenario({ ...LAYERED, cutLabels: ['panel-2-lb'], overrides: { 'panel-2-la': REPEATED, ...FINAL_READ_OK } });
  assert.deepEqual(r.panelVerdicts.map(v => [v.round, v.lab, v.cut === true]), [[1, 'la', false], [1, 'lb', false], [2, 'la', true]], 'premise: pass 1 recorded, pass 2 cut after la answered');
  const report = reportOf(r);
  assert.equal(report.signed_text.open_objections, 1);
  assert.deepEqual(report.dispute.open_objections.map(o => [o.id, o.problem, o.cut_off, o.first_raised_round]), [[idOf(5), PROBLEM, undefined, 1]], 'its pass-1 row and text, not the cut reply\'s, and not marked');
  assert.deepEqual(openObjectionsOf(report).map(o => o.id), [idOf(5)]);
  assert.ok(r.stages.some(s => s.label === 'dispute'), 'the dispute stage litigated it, as it did before this unit');
  assert.ok(`${prompts.get('dispute')?.system}\n${prompts.get('dispute')?.user}`.includes(PROBLEM), 'its pass-1 text is in the dispute call');
  arm('spend');
  const control = await scenario({ ...LAYERED, cutLabels: ['panel-2-la'], overrides: { ...FINAL_READ_OK } });
  assert.deepEqual(control.result.panelVerdicts.map(v => [v.round, v.lab, v.verdict, v.cut === true]), [[1, 'la', 'objected', false], [1, 'lb', 'signed_off', false], [2, 'lb', 'signed_off', true]], 'premise: in the control la was cut before it answered (no row), lb\'s clean pass-2 row is cut, and la\'s pass-1 objection is the only one held');
  assert.deepEqual(report.dispute.open_objections, reportOf(control.result).dispute.open_objections, 'the same row as when the judge was cut before it answered: nothing was added by the repeat');
});

// NEW (C&C ruling 19, 13 Nov): an objection its raiser WITHDREW in a completed round of the cut pass's exchange is not open at the finish, whether it was held from a finished pass (here) or first raised in the cut pass (the test below). Before: a held one stayed listed open, unmarked,
// the dispute stage was paid to argue it and accept asked the person to answer it. The report's other records agree: the closed states (answer_back_replies, effect withdrawn_exchange) and the severity record (severityRun.withdrawn, how exchange). A round the finish cut applies nothing: B stays.
const WB = { ...bareFailureOf(5), problem: 'No back-off is specified.', quote: 'The worker', relation: 'new' }; const idWB = objectionId('la', WB);
const HELD_WITHDRAWN = () => {
  const repeat = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [repeatOf(5), { ...WB, relation: `continues ${idWB}` }], verdict_line: 'no' });
  const post = JSON.stringify({ posts: [{ on: idOf(5), stance: 'contest', text: 'The plan covers it.', quote: 'The worker retries failed requests' }, { on: idWB, stance: 'support', text: 'It holds.' }], new_objections: [] });
  const reply = JSON.stringify({ replies: [{ id: idOf(5), action: 'withdraw', text: 'The passage answers it.', quote: 'The worker retries failed requests' }, { id: idWB, action: 'keep', text: 'Still open.' }] });
  return { ...LAYERED, extraFailures: [WB], cutLabels: ['ldebate-2-x2-lb', 'ldebate-2-x2-la'], overrides: { 'panel-2-la': repeat, 'ldebate-2-lb': post, 'lreply-2-la': reply, ...FINAL_READ_OK } };
};
test('an objection held from a finished pass that its raiser withdrew in a completed round of the cut exchange is not open: not counted, not listed, not asked at accept, not argued by the dispute stage; the one that stayed is listed unmarked; the closed states record the withdrawal', async () => {
  arm('spend');
  const { result: r, prompts } = await scenario(HELD_WITHDRAWN());
  assert.equal(r.stop?.label, 'ldebate-2-x2-lb', 'premise: the finish cut round 2 of the pass-2 exchange, after round 1 had withdrawn the held objection');
  const report = reportOf(r);
  assert.equal(report.signed_text.open_objections, 1, 'only B');
  assert.deepEqual(report.dispute.open_objections.map(o => [o.id, o.cut_off]), [[idWB, undefined]], 'B was held and stayed: its row, unmarked; the withdrawn objection is not listed');
  assert.deepEqual(openObjectionsOf(report).map(o => o.id), [idWB], 'accept asks about B only');
  const dispute = `${prompts.get('dispute')?.system}\n${prompts.get('dispute')?.user}`;
  assert.ok(dispute.includes(WB.problem), 'premise: the dispute stage ran and argues B');
  assert.ok(!dispute.includes(PROBLEM), 'the withdrawn objection is not in the dispute call');
  assert.ok(report.answer_back_replies.some(a => a.id === idOf(5) && a.lab === 'la' && a.round === 2 && a.effect === 'withdrawn_exchange'), 'the closed state: answer_back_replies has the withdrawal');
  assert.ok(validate(report), JSON.stringify(validate.errors?.slice(0, 3)));
});
test('the same, with ratings kept: the severity record has the withdrawal (how exchange, pass 2) and the objection is not open in it', async () => {
  arm('spend');
  setHeldForTest(DEMAND);
  const { result: r } = await scenario(HELD_WITHDRAWN());
  assert.equal(r.stop?.label, 'ldebate-2-x2-lb', 'premise');
  const rec = severityRecord({ signoff: 'unanimous', seats: { critics: LAYERED.critics.map(([lab, layer]) => ({ lab, layer })) } }, r);   // the report's severity block (config as the report shape reads it: layered, unanimous)
  const w = rec.withdrawn.find(x => x.id === idOf(5));
  assert.deepEqual([w?.lab, w?.how, w?.pass], ['la', 'exchange', 2], 'the severity record has the withdrawal');
  assert.ok(rec.open_at_end.some(o => (o.id ?? o) === idWB), 'premise: the objection that stayed is open in it');
  assert.ok(!rec.open_at_end.some(o => (o.id ?? o) === idOf(5)), 'and the withdrawn one is not');
  assert.deepEqual(reportOf(r).dispute.open_objections.map(o => o.id), [idWB]);
});
test('a carried verdict in the cut layer is not a cut reply: a layer-1 judge heard alone (its partner unreadable) is carried into the next pass on the unchanged draft, the finish cuts the partner\'s ask, and the carried judge\'s objection stays as it was: not marked cut_off, litigated by the dispute stage', async () => {
  arm('spend');
  const bad = 'this is not json at all';
  const { result: r } = await scenario({ critics: [['la', 1], ['lb', 1], ['lx', 2], ['lc', 3]], cutLabels: ['panel-2-lb'], extra: { dispute: { enabled: true, stall_rounds: 2 } }, overrides: { 'panel-1-lb': bad, 'panel-1-lb-reask1': bad, 'panel-1-lb-reask2': bad, 'panel-1-lb-solo': bad, ...FINAL_READ_OK } });
  assert.deepEqual(r.panelVerdicts.map(v => [v.round, v.lab, v.verdict, v.cut === true, v.carried === true]), [[1, 'la', 'objected', false, false], [1, 'lb', 'unheard', false, false], [2, 'la', 'objected', true, true]], 'premise: la\'s pass-1 verdict is carried into pass 2, and that row is in the layer the finish cut');
  const report = reportOf(r);
  assert.equal(report.signed_text.open_objections, 1);
  assert.deepEqual(report.dispute.open_objections.map(o => [o.id, o.problem, o.cut_off, o.first_raised_round]), [[idOf(5), PROBLEM, undefined, 1]]);
  assert.ok(r.stages.some(s => s.label === 'dispute'), 'the dispute stage litigated it, as it did before this unit');
});

test('a finish in a LATER round of the layer\'s exchange keeps what its completed rounds settled: an objection the raiser withdrew in round 1 is not listed as open (OLD, before this unit: nothing of the cut layer was listed; first draft of this unit: both were)', async () => {
  arm('spend');
  const B = { ...bareFailureOf(5), problem: 'No back-off is specified.', quote: 'The worker', relation: 'new' };
  const idB = objectionId('la', B);
  const post = JSON.stringify({ posts: [{ on: idOf(5), stance: 'support', text: 'It holds.' }, { on: idB, stance: 'contest', text: 'The plan covers it.', quote: 'The worker retries failed requests' }], new_objections: [] });
  const reply = JSON.stringify({ replies: [{ id: idB, action: 'withdraw', text: 'The passage answers it.', quote: 'The worker retries failed requests' }, { id: idOf(5), action: 'keep', text: 'Still open.' }] });
  const { result: r } = await scenario({ ...LAYERED, extraFailures: [B], cutLabels: ['ldebate-1-x2-lb', 'ldebate-1-x2-la'], overrides: { 'ldebate-1-lb': post, 'lreply-1-la': reply, ...FINAL_READ_OK } });
  assert.equal(r.stop?.label, 'ldebate-1-x2-lb', 'premise: the finish cut round 2 of the exchange, after round 1 had withdrawn B');
  const report = reportOf(r);
  assert.equal(report.signed_text.open_objections, 1);
  assert.deepEqual(report.dispute.open_objections.map(o => [o.id, o.cut_off]), [[idOf(5), true]], 'only the objection that was not withdrawn');
});

test('a finish in a LATER round of the exchange keeps what a judge NAMED in a completed round: its new objection (#2) is open, it is not lost with the exchange\'s own state', async () => {
  arm('spend');
  const X = { ...bareFailureOf(5), problem: 'No back-off is specified.', quote: 'The worker', relation: 'new' };
  const B = { criterion: bareFailureOf(5).criterion, problem: 'The limit it names applies to every request, not only failed ones.', fix: 'Say which.', quote: bareFailureOf(5).quote, severity: 5 };
  const lbRaise = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'x' }], failures: [X], verdict_line: 'no' });
  const postLa = JSON.stringify({ posts: [{ on: objectionId('lb', X), stance: 'support', text: 'It holds.' }], new_objections: [B] });
  const postLb = JSON.stringify({ posts: [{ on: idOf(5), stance: 'support', text: 'It holds.' }], new_objections: [] });
  const { result: r } = await scenario({ ...LAYERED, cutLabels: ['ldebate-1-x2-la', 'ldebate-1-x2-lb'], overrides: { 'panel-1-lb': lbRaise, 'ldebate-1-la': postLa, 'ldebate-1-lb': postLb, ...FINAL_READ_OK } });
  assert.ok(r.stop?.label.startsWith('ldebate-1-x2'), 'premise: the finish cut round 2 of the exchange, after round 1 had named B');
  const report = reportOf(r);
  assert.equal(report.signed_text.open_objections, 3, 'la\'s first objection, lb\'s, and the one la named in round 1');
  assert.ok(report.dispute.open_objections.some(o => o.id === `${idOf(5)}#2` && o.lab === 'la' && o.cut_off === true && o.problem === B.problem));
});
