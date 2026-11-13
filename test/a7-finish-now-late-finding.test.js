// 0.8.4 round 1, the A7 fix (C&C's rulings R1 and R2, legs A, B and D of Mini-C&C's rig). In-process, $0: a layered mock chain (an external writer, a mock handoff seat) whose top layer signs off with a must-do defect in its sorting (a LATE FINDING), the handler answers
// not_yet at the last overseer round (the overseer_cap stop), and the person finishes the run at once at that stop (leg A); the same without the late finding (leg B); and a run whose layer 1 goes silent so the top layer never signs (leg D).
// What tells the case apart (not a wording pin): the reasons the run's own handoff PROMPT and the banner of HANDOFF.md (through finishedState, from the report) give for a run finished at once with no objection open by count.
//   R1 (legs A, B): the record says the top layer SIGNED OFF in the stop's pass (ending signed_off_at_top_not_agreed): no reason says the top layer did not sign off.
//   R2 (legs A, D): the acceptance reader (openObjectionsOf) lists a late finding that stands: the reason names every one of those ids; with none standing (leg B) it names none and says no objection is open.
//   A7-c (leg D): the clause "the last round reviewed this version" is printed only when a seat was heard on the delivered text (the per-seat record); leg D heard nobody there and keeps the words "no judge read the last version of it before the run ended".
// Controls: the same report with ONE field swapped (one open objection by count) keeps "finished with open objections"; leg D with no late finding is test/a7-finish-now-nothing-open.test.js (its default reason is unchanged: pinned there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { verdictHeadline, finishedAtStopWords } from '../src/verdict-headline.js';
import { finishedRunState } from '../src/run-status.js';
import { finishedState, partialBanner } from '../src/handoff-from-run.js';
import * as EM from '../src/ending-matrix.js';
const { agreedOf } = EM;
const finishedAtOnceCase = report => EM.finishedAtOnceCase?.(report);   // absent on a tree without the fix: the banner then has no case to read and says what it said
import { openObjectionsOf } from '../src/acceptance.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { W31 } from './helpers/w31-held.js';

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = (extra = {}) => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', ...extra });
const defect = (reason, rating) => ({ sort: 'must_do', reason, criterion: CRITERION, quote: 'retries failed requests', rating });
const seatOf = ([lab, layer, model]) => ({ provider: 'mock', model: model ?? 'mock-review-fixture', lab, maxTokens: 3000, layer });
const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
const handoffSeat = { provider: 'mock', model: 'mock-builder', lab: 'hand' };
const LIMITS = { maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 } };
const TWO = { maxOverseerRounds: 2, layerRevisions: { 1: 1, 2: 1 } };

async function leg(name, topReply, { limits = LIMITS, raiserModel, extraScript = {}, nullLabel = () => false } = {}) {
  const config = { name: 'fixture-a7late', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, handoff: true, ...limits,
    seats: { builder: writer, reviser: writer, handoff: handoffSeat, critics: [['raiser', 1, raiserModel], ['mid', 2], ['top', 3]].map(seatOf) } };
  let handoffUser = null;
  try {
    setHeldForTest({ ...DEMAND, ...SORTING, ...W31, ...CHECK });
    setPromptSpy(p => { if (p.label === 'handoff') handoffUser = p.user; });
    const make = (extra, roundChoices = []) => {
      setCache({ invalidate() {}, get(label) {
        const all = { 'panel-1-top': topReply, ...extraScript, ...extra };
        if (label in all) return OK(all[label]);
        if (nullLabel(label)) return null;
        if (label.startsWith('build-check-')) return null;
        return OK((label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : label === 'handoff' ? 'Status: needs_decision\n\nHand it on.\n' : DRAFT);
      } });
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: `r-a7late-${name}`, log: () => {}, config, roundChoices });
    };
    const s1 = await make({}).then(r => r, e => e);
    const lateIds = [...String(s1?.user ?? '').matchAll(/^- (L-[0-9a-f]{8}(?:#\d+)?)/gm)].map(m => m[1]);
    const NOT_YET_ANSWER = answer('not_yet', [...lateIds.map(id => `${id}: the build cannot leave it.`), 'Name the owner.'].join(' '));
    const NOT_YET = { 'build-check-1': NOT_YET_ANSWER, 'build-check-2': NOT_YET_ANSWER };
    const s2 = await make(NOT_YET).then(r => r, e => e);
    let s3 = s2;
    if (s2 instanceof RoundStopped) s3 = await make(NOT_YET, [roundChoiceEntry(s2.stop, 'finish_now', limits)]).then(r => r, e => e);
    if (s3 instanceof Error || s3 instanceof ExternalPause) throw new Error(`${name}: the run did not finish: ${String(s3?.message ?? s3?.label).slice(0, 200)}`);
    const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: `r-a7late-${name}`, chain: 'fixture-a7late', task: 't.md', result: s3, config })));
    const reasonLine = handoffUser ? (handoffUser.match(/^The run behind this plan ended "[a-z_]+" \((.*?)\)\. /m)?.[1] ?? null) : null;
    return { report, handoffUser, reasonLine };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

const LEGS = {};
const run = (name, ...a) => (LEGS[name] ??= leg(name, ...a));
const A = () => run('A', meets({ sorting: [defect('A timeout is missing.', 6)] }));
const B = () => run('B', meets());
const D = () => run('D', meets({ sorting: [defect('A timeout is missing.', 6)] }), { limits: TWO, raiserModel: 'mock-critic-silent', extraScript: { 'panel-1-raiser': meets() }, nullLabel: l => /^panel-[2-9]\d*-raiser/.test(l) });
const lateOf = report => openObjectionsOf(report).filter(o => o.late).map(o => o.id);

test('premise: the three legs end finished at once with no objection open by count; A and B record the top layer\'s sign-off, D does not; A and D carry a standing late finding, B none', async () => {
  const a = await A(); const b = await B(); const d = await D();   // one after the other: the stage cache and the prompt spy are process-wide
  for (const [n, l] of [['A', a], ['B', b], ['D', d]]) {
    assert.equal(l.report.stop?.finished_at_once, true, `${n}: finished at once`);
    assert.equal(l.report.signed_text?.open_objections, 0, `${n}: no objection open by count`);
    assert.ok(l.handoffUser, `${n}: the handoff seat was asked, so the run's own prompt is read`);
  }
  assert.equal(a.report.ending?.kind, 'signed_off_at_top_not_agreed'); assert.equal(b.report.ending?.kind, 'signed_off_at_top_not_agreed');
  assert.notEqual(d.report.ending?.kind, 'signed_off_at_top_not_agreed');
  assert.ok(lateOf(a.report).length > 0 && lateOf(d.report).length > 0, 'A and D: a late finding stands (the acceptance reader lists it)');
  assert.deepEqual(lateOf(b.report), [], 'B: none');
});

test('R1 (legs A, B): the top layer signed off in the stop\'s pass: neither the banner nor the run\'s own handoff prompt says it did not', async () => {
  for (const [n, leg_] of [['A', await A()], ['B', await B()]]) {
    const banner = finishedState({ passed: agreedOf(leg_.report), outcome: leg_.report.outcome, delivered_text: leg_.report.delivered_text, ending_word: leg_.report.ending_word, nothing_open_at_once: true, at_once: finishedAtOnceCase(leg_.report) }).reason;
    for (const [where, text] of [['banner', banner], ['handoff prompt', leg_.reasonLine]]) {
      assert.ok(text, `${n}: the ${where} has a reason`);
      assert.doesNotMatch(text, /before the top layer signed off|did not sign off/, `${n}: the ${where} does not say the top layer did not sign off (${text})`);
      assert.match(text, /top layer signed off/, `${n}: the ${where} says it did`);
      assert.match(text, /handler said not yet/, `${n}: and what the handler's check said`);
    }
    assert.match(verdictHeadline(leg_.report).text, /layer 3 signed off, but the handler said not yet/, `${n}: the headline says the same`);
    assert.match(finishedRunState(leg_.report), /layer 3 signed off, but the handler said not yet/, `${n}: and the run state`);
  }
});

test('R1 (legs A, B: the top layer signed off, the handler said not yet): the sentence after the reason does not say the panel did not sign off; leg D (the top layer did not sign) keeps it', async () => {
  const bannerOf = l => partialBanner({ state: finishedState({ passed: agreedOf(l.report), outcome: l.report.outcome, delivered_text: l.report.delivered_text, ending_word: l.report.ending_word, nothing_open_at_once: true, at_once: EM.finishedAtOnceCase?.(l.report), top_signed: EM.topSignedNotAgreed?.(l.report) }), draftName: 'deliverable.md', runId: 'r1' });
  for (const [n, l] of [['A', await A()], ['B', await B()]]) {
    assert.doesNotMatch(bannerOf(l), /The panel did not sign off on the plan below/, `${n}: the banner's sentence after the reason`);
  }
  const d = await D();
  assert.match(bannerOf(d), /The panel did not sign off on the plan below/, 'D: the sentence stays');
});

test('R2 (legs A, D, and B as the control): the reason names every late finding the acceptance reader lists; with none standing it names none and says no objection is open', async () => {
  for (const [n, leg_] of [['A', await A()], ['D', await D()], ['B', await B()]]) {
    const late = lateOf(leg_.report);
    const banner = finishedState({ passed: agreedOf(leg_.report), outcome: leg_.report.outcome, delivered_text: leg_.report.delivered_text, ending_word: leg_.report.ending_word, nothing_open_at_once: true, at_once: finishedAtOnceCase(leg_.report) }).reason;
    for (const [where, text] of [['banner', banner], ['handoff prompt', leg_.reasonLine]]) {
      assert.ok(text, `${n}: the ${where} has a reason`);
      const named = [...text.matchAll(/L-[0-9a-f]{8}(?:#\d+)?/g)].map(m => m[0]).sort();
      assert.deepEqual(named, [...late].sort(), `${n}: the ${where} names exactly the late findings the acceptance reader lists`);
      if (late.length === 0) assert.match(text, /no objection open$/, `${n}: nothing standing: no objection open`);
      else assert.doesNotMatch(text, /no objection open$/, `${n}: a late finding stands: the reason does not end on "no objection open"`);
    }
  }
});

test('controls (the report of leg B with ONE field swapped): an objection open by count keeps "finished with open objections"; no late finding and the top layer not signed keeps the default reason', async () => {
  const b = (await B()).report;
  const open = JSON.parse(JSON.stringify(b)); open.signed_text.open_objections = 1;
  assert.equal(finishedState({ passed: agreedOf(open), outcome: open.outcome, delivered_text: open.delivered_text, ending_word: open.ending_word, nothing_open_at_once: false, at_once: finishedAtOnceCase(open) }).reason, 'finished with open objections');
  const unsigned = JSON.parse(JSON.stringify(b)); delete unsigned.ending;
  assert.equal(finishedState({ passed: agreedOf(unsigned), outcome: unsigned.outcome, delivered_text: unsigned.delivered_text, ending_word: unsigned.ending_word, nothing_open_at_once: true, at_once: finishedAtOnceCase(unsigned) }).reason, 'stopped before the top layer signed off, with no objection open', 'the default reason of the A7 commit, byte for byte');
});

test('A7-c (leg D): the finished-at-a-stop clause says "the last round reviewed this version" only when a seat was heard on the delivered text (read from the per-seat record, not from a layer row)', async () => {
  const d = (await D()).report;
  assert.equal(d.delivered_text?.same_as_signed, true, 'premise: the delivered text is the draft the last round was shown');
  const round = d.signed_text.round;
  const seats = d.panelVerdicts.filter(v => v.round === round);
  assert.ok(seats.length > 0 && seats.every(v => v.verdict === 'unheard'), `premise: nobody was heard on it (${seats.map(v => `${v.lab}:${v.verdict}`).join(' ')})`);
  assert.doesNotMatch(finishedAtStopWords(d), /reviewed this version/, 'nobody was heard: the round did not review the text');
  assert.match(finishedAtStopWords(d), /no judge read the last version of it before the run ended/, 'and says no judge read it (the words of 7a4e2900)');
  const heard = JSON.parse(JSON.stringify(d)); heard.panelVerdicts.find(v => v.round === round).verdict = 'signed_off';
  assert.match(finishedAtStopWords(heard), /the last round reviewed this version/, 'control: a seat heard on it: the clause stands');
  const second = JSON.parse(JSON.stringify(d)); second.panelVerdicts.push({ ...seats[0], lab: 'raiser-two', verdict: 'signed_off' });
  assert.equal(second.layers.find(r => r.round === round && r.layer === seats[0].layer).state, 'unheard', 'control premise: the layer\'s row still reads unheard (a seat of it is silent)');
  assert.match(finishedAtStopWords(second), /the last round reviewed this version/, 'control: one of a layer\'s seats heard while another is silent: the clause stands');
  const elsewhere = JSON.parse(JSON.stringify(heard)); elsewhere.signed_text.round = round - 1; elsewhere.panelVerdicts.push({ ...seats[0], round: round - 1, verdict: 'signed_off' });
  assert.equal(finishedAtStopWords(elsewhere), 'layer 3 did not sign off on this plan', 'control: the delivered text\'s round is not the stop\'s pass (a ledger-overflow stop): the record does not show whether a seat was heard, the clause claims neither');
});
