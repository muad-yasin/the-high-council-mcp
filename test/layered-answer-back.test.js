// 0.8.3 E3 (gate page Review/Build_0.8.3/m6-closing/E3_Gate_Page.md sections 1-7, readers audit E3_Readers_Audit.md): on a LAYERED chain with answer_back a judge's open objections persist until that judge is next ASKED,
// whatever the number of rounds in between (an upper layer is not asked while a lower one objects). Fixture style of test/answer-back-unheard.test.js: every reply comes from a label-keyed cache, the prompts are read
// through setPromptSpy. $0, offline.
//   Round 1: la (layer 1) signs off, lb (layer 2) objects. Round 2 and 3: la objects, so lb is NOT asked. Round 4: la withdraws its own objection with a quote, lb is asked for the first time since round 1.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget, BudgetExceeded } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import { reportJsonShape } from '../src/report-shape.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crit = (name, text) => ({ criterion: 'The plan defines a retry limit.', problem: text, fix: 'Fix it.', _name: name });
const CRITERION = 'The plan defines a retry limit.';
const F_A = { criterion: CRITERION, problem: 'Layer one: no retry limit is specified.', fix: 'Specify one.' };
const F_B = { criterion: CRITERION, problem: 'Layer two: the retry limit has no unit.', fix: 'Give it a unit.' };
const ID_A = objectionId('la', F_A);
const ID_B = objectionId('lb', F_B);
const DRAFT = 'The worker retries failed requests.';
const QUOTE = '`The worker retries failed requests.`';
const SECTION = '# Your objections from the last round';
const verdict = (meets, extra = {}) => JSON.stringify({ meets, criteria: [{ criterion: CRITERION, verdict: meets ? 'MET' : 'FAILED', evidence: meets ? 'Checked.' : 'Missing.' }], failures: meets ? [] : [F_A], verdict_line: meets ? 'ok' : 'no', ...extra });
const objecting = (f, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no', ...extra });
const withdraw = (id, evidence = QUOTE) => ({ answers: [{ id, status: 'withdrawn', evidence }] });
const PASS = JSON.stringify({ pass: true, pass_reason: 'I would rather not judge this round.' });

async function run(replies, { maxRounds = 6, critics = ['la', 'lb'], layers = [1, 2], extra = {}, budget = null, models = {}, miss = () => false, stages = null } = {}) {
  const hashes = new Map(); const prompts = new Map(); const served = []; const stale = [];
  setBudget(budget);
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, p.user); });
  setCache({ invalidate: label => stale.push(label), get(label) {
    if (miss(label)) return null;
    if (stages?.has(label)) return stages.get(label); // a stage recorded by an earlier sitting: replayed, no new call
    served.push(label);
    // CHANGED ACCEPTED TEST (decider-readiness apply patch, 24 Okt 2026; C&C ruling (b): the 12 incidental tests get on-state updates). OLD: the held state, where a stated pass is carried at once with no further call. NEW: with the re-ask sentence recorded (E84) a lab that states a pass while holding an objection is asked ONCE more; these E3 fixtures keep their meaning (the stated pass is carried) by letting that lab state its pass again, so a `-reask1` label replays the pass its first label gave. The E84 behaviour itself is tested in layered-ask-before-carry.test.js.
    const reply = l => { const m = /^(panel-\d+-[a-z]+)-reask\d+$/.exec(l); const base = m ? replies(m[1]) : null; let isPass = false; try { isPass = Boolean(base) && JSON.parse(base).pass === true; } catch { /* not JSON: not a stated pass */ } return isPass ? base : replies(l); };
    const text = label.startsWith('panel-') ? (reply(label) ?? verdict(true)) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: models[lab] ?? 'mock-review-fixture', lab, maxTokens: 3000, ...(layer === undefined ? {} : { layer }) });
  const config = {
    name: 'fixture-e3', criteria: [CRITERION], maxRounds, signoff: 'unanimous', answer_back: { enabled: true }, ...extra,
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: critics.map((lab, i) => seat(lab, layers[i])) },
  };
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-e3', log: () => {}, config });
  return { r, prompts, config, served, stale };
}

// la: round 1 clean, rounds 2-3 objects (same objection), round 4 withdraws it with a quote. lb: objects in round 1; `lbRound4` is what it says when it is next asked.
const retention = lbRound4 => label => {
  if (label === 'panel-1-lb') return objecting(F_B);
  if (label === 'panel-2-la' || label === 'panel-3-la') return verdict(false);
  if (label === 'panel-4-la') return verdict(true, withdraw(ID_A));
  if (/^panel-4-lb/.test(label)) return lbRound4(label);
  return null;
};

test('E3 retention: a layer-2 judge that objected in round 1 and was not asked in rounds 2-3 is shown its objection and the changed passages in round 4, and a quoted withdrawal lets the run pass', async () => {
  const { r, prompts } = await run(retention(() => verdict(true, withdraw(ID_B))));
  for (const l of ['panel-2-lb', 'panel-3-lb']) assert.equal(prompts.has(l), false, `${l}: layer 2 is not asked while layer 1 objects`);
  const p4 = prompts.get('panel-4-lb');
  assert.ok(p4.includes(SECTION), 'round 4: lb is shown its round-1 objection');
  assert.ok(p4.includes(F_B.problem), 'the section names the objection');
  assert.match(p4, /Revision 3/, 'the changed passages are those since the text lb last judged (the round-1 draft), not only the last revise');
  assert.equal(r.passed, true);
  assert.deepEqual(r.answerBackReplies.filter(x => x.lab === 'lb').map(x => [x.round, x.id, x.effect]), [[4, ID_B, 'withdrawn']]);
  assert.deepEqual(r.answerBack.filter(x => x.lab === 'lb'), [{ round: 4, lab: 'lb', objection_ids: [ID_B], declined: 0, changed_passages: 1, raised_round: 1 }], 'one row, written when the section was shown, naming the round it was raised in');
});

test('E3 consumption: a clean-looking verdict cannot drop a retained id (sustained, no answer, a quote that is not in the draft)', async () => {
  const sustained = await run(retention(() => verdict(true, { answers: [{ id: ID_B, status: 'sustained', evidence: QUOTE }] })), { maxRounds: 4 });
  assert.equal(sustained.r.passed, false, 'a sustained answer keeps the run from passing');
  assert.deepEqual(sustained.r.answerBackReplies.filter(x => x.lab === 'lb').map(x => x.effect), ['sustained']);
  const carriedBy = sustained.r.signoff.find(s => s.lab === 'lb');
  assert.equal(carriedBy.signedOff, false);
  assert.deepEqual(carriedBy.objections.map(o => [o.id, o.carried_from_round]), [[ID_B, 1]], 'the carried failure names the round it was raised, not round - 1');

  const silent = await run(retention(label => (label === 'panel-4-lb' ? verdict(true) : verdict(true))), { maxRounds: 4 });
  assert.equal(silent.r.passed, false, 'a plain clean sign-off with no answers does not pass');
  assert.ok(silent.prompts.has('panel-4-lb-reask1'), 'it is asked once more (the existing unanswered-objection re-ask)');
  assert.deepEqual(silent.r.answerBackReplies.filter(x => x.lab === 'lb').map(x => x.effect), ['unanswered']);

  const wrongQuote = await run(retention(() => verdict(true, withdraw(ID_B, '`a sentence that is not in the draft anywhere`'))), { maxRounds: 4 });
  assert.equal(wrongQuote.r.passed, false);
  assert.deepEqual(wrongQuote.r.answerBackReplies.filter(x => x.lab === 'lb').map(x => x.effect), ['withdrawal_refused']);
});

test('E3 unheard: a retained judge whose round-4 reply is lost keeps its objection and is shown it again in the next round', async () => {
  const lost = label => (label === 'panel-4-lb' || label === 'panel-4-lb-reask1' || label === 'panel-4-lb-reask2' ? 'I could not finish my review' : null);
  const replies = label => (label === 'panel-5-lb' ? verdict(true, withdraw(ID_B)) : retention(lost)(label));
  const { r, prompts } = await run(replies, { maxRounds: 6 });
  assert.ok(prompts.has('panel-4-lb-reask2'), 'asked again twice in the round, then unheard');
  assert.ok(prompts.get('panel-5-lb').includes(SECTION), 'round 5: the objection is shown again');
  assert.equal(r.passed, true, 'withdrawn with a quote in round 5');
});

test('E3 stated pass (C&C ruling a1): a lab that states a pass while its own retained objection is open is recorded as a pass, its objection is carried at once, and the run does not pass', async () => {
  // la L1; lb and lc both L2 (freedoms.pass on). Round 1: lb objects, lc clean. Round 2: la objects (layer 2 not asked). Round 3: la withdraws, lb states a pass, lc signs off. Round 4: lb is asked and withdraws with a quote.
  const replies = label => {
    if (label === 'panel-1-lb') return objecting(F_B);
    if (label === 'panel-2-la') return verdict(false);
    if (label === 'panel-3-la') return verdict(true, withdraw(ID_A));
    if (label === 'panel-3-lb') return PASS;
    if (label === 'panel-4-lb') return verdict(true, withdraw(ID_B));
    return null;
  };
  const { r, prompts } = await run(replies, { critics: ['la', 'lb', 'lc'], layers: [1, 2, 2], maxRounds: 5, extra: { freedoms: { pass: true } } });
  // CHANGED ACCEPTED (apply patch): OLD no extra call for the passing lab; NEW exactly one re-ask of it (the recorded re-ask sentence), after which the pass is carried as before.
  assert.equal(prompts.has('panel-3-lb-reask1'), true, 'the passing lab is asked once more');
  assert.equal(prompts.has('panel-3-lb-reask2'), false, 'and only once');
  assert.ok(prompts.has('revise-3'), 'a round with only a stated pass and a clean sign-off still revises: an objection stands');
  assert.ok(prompts.get('revise-3').includes(F_B.problem), 'the reviser is given the carried objection (departure from contract 4.4, disclosed)');
  assert.deepEqual(r.answerBackReplies.filter(x => x.effect === 'stated_pass_open').map(x => [x.round, x.lab, x.id, x.status]), [[3, 'lb', ID_B, null]], 'the VALUE that tells it from an objection');
  const lbThree = r.panelVerdicts.find(v => v.round === 3 && v.lab === 'lb');
  assert.equal(lbThree.verdict, 'passed', 'the pass is recorded as a pass, never rewritten');
  assert.equal(r.layers.find(x => x.round === 3 && x.layer === 2).state, 'objected');
  assert.equal(r.regressions.length, 0, 'a lab that only passed is not "heard": no REGRESSION');
  assert.ok(prompts.get('panel-4-lb').includes(SECTION), 'the next time it is asked it is shown its section and can withdraw with a quote');
  assert.equal(r.passed, true);
  assert.deepEqual(r.answerBackReplies.filter(x => x.lab === 'lb' && x.round === 4).map(x => x.effect), ['withdrawn']);
});

test('E3 dispute (readers audit 24): a stated pass that carried its objection, then a final round in which its layer is not asked, still sends that objection to the dispute stage', async () => {
  // Round 1: lb objects. Round 2: la objects. Round 3: la withdraws, lb states a pass, lc signs off (the objection is carried, revise-3). Round 4 (the cap): la objects, layer 2 is not asked.
  const replies = label => {
    if (label === 'panel-1-lb') return objecting(F_B);
    if (label === 'panel-2-la') return verdict(false);
    if (label === 'panel-3-la') return verdict(true, withdraw(ID_A));
    if (label === 'panel-3-lb') return PASS;
    if (label === 'panel-4-la') return verdict(false, { failures: [{ criterion: CRITERION, problem: 'Layer one: a new problem in round four.', fix: 'Fix.' }] });
    return null;
  };
  const { r } = await run(replies, { critics: ['la', 'lb', 'lc'], layers: [1, 2, 2], maxRounds: 4, extra: { freedoms: { pass: true }, dispute: { enabled: true } } });
  assert.equal(r.passed, false);
  const carried = r.dispute.open_objections.find(o => o.id === ID_B);
  assert.ok(carried, `the stated-pass lab's carried objection is in the dispute record: ${JSON.stringify(r.dispute.open_objections)}`);
  assert.equal(carried.not_asked_in_final_round, true);
  assert.equal(carried.last_raised_round, 3);
  assert.equal(r.layers.find(x => x.round === 4 && x.layer === 2).state, 'not_asked');
});

test('E3 stated pass that also carries answers: a quoted withdrawal in the pass reply is honoured, the id that gets no answer is carried as stated_pass_open', async () => {
  // lb holds TWO retained objections (F_B and F_B2). In round 3 it states a pass whose reply withdraws F_B with a quote and says nothing about F_B2.
  // A second, distinct objection: the id is the same for the same lab, criterion and quoted text by design (src/objection-ids.js), so it carries a quote of its own.
  const F_B2 = { criterion: CRITERION, problem: 'Layer two: the retry limit has no owner.', fix: 'Name one.', quote: 'retries failed requests' };
  const ID_B2 = objectionId('lb', F_B2);
  const two = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [F_B, F_B2], verdict_line: 'no' });
  const passWithAnswer = JSON.stringify({ pass: true, pass_reason: 'Not judging.', answers: [{ id: ID_B, status: 'withdrawn', evidence: QUOTE }] });
  const replies = label => {
    if (label === 'panel-1-lb') return two;
    if (label === 'panel-2-la') return verdict(false);
    if (label === 'panel-3-la') return verdict(true, withdraw(ID_A));
    if (label === 'panel-3-lb') return passWithAnswer;
    return null;
  };
  const { r, prompts } = await run(replies, { critics: ['la', 'lb', 'lc'], layers: [1, 2, 2], maxRounds: 4, extra: { freedoms: { pass: true } } });
  assert.deepEqual(r.answerBackReplies.filter(x => x.round === 3 && x.lab === 'lb').map(x => [x.id, x.effect]).sort(), [[ID_B, 'withdrawn'], [ID_B2, 'stated_pass_open']].sort(), 'the quoted withdrawal is a disposition; the silent id is carried');
  assert.ok(prompts.get('revise-3').includes(F_B2.problem), 'the carried id reaches the reviser');
  assert.equal(prompts.get('revise-3').includes(F_B.problem), false, 'the withdrawn id does not');
  assert.equal(r.passed, false);
});

test('E3 stated pass without an open objection stays a plain pass (no carried ids, no stated_pass_open row)', async () => {
  const replies = label => (label === 'panel-1-lb' ? PASS : null);
  const { r } = await run(replies, { critics: ['la', 'lb', 'lc'], layers: [1, 1, 2], maxRounds: 2, extra: { freedoms: { pass: true } } });
  assert.equal(r.answerBackReplies?.some(x => x.effect === 'stated_pass_open') ?? false, false);
  assert.equal(r.passed, true);
});

test('E3 without the held unanswered-objection sentence a layered chain carries an unanswered id at once instead of re-asking blind', async () => {
  setHeldForTest({ criticUnansweredNote: undefined });
  const { r, prompts } = await run(retention(() => verdict(true)), { maxRounds: 4 });
  assert.equal(prompts.has('panel-4-lb-reask1'), false, 'no re-ask whose prompt cannot say why');
  assert.equal(r.passed, false, 'the unanswered id is carried: the run does not pass');
  assert.deepEqual(r.answerBackReplies.filter(x => x.lab === 'lb').map(x => x.effect), ['unanswered']);
});

test('E3 report: a layered answer_back report validates against schemas/report-v1.json (raised_round and stated_pass_open included)', async () => {
  const replies = label => (label === 'panel-1-lb' ? objecting(F_B) : label === 'panel-2-la' ? verdict(false) : label === 'panel-3-la' ? verdict(true, withdraw(ID_A)) : label === 'panel-3-lb' ? PASS : null);
  const { r, config } = await run(replies, { critics: ['la', 'lb', 'lc'], layers: [1, 2, 2], maxRounds: 3, extra: { freedoms: { pass: true } } });
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-e3', chain: 'fixture-e3', task: 't.md', result: r, config })));
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.ok(report.answer_back.some(x => x.raised_round === 1));
  assert.ok(report.answer_back_replies.some(x => x.effect === 'stated_pass_open'));
});

test('E3 rows: a spend stop at the layer-2 ask writes no row for a section that never left; the layer-1 row of the same round stays', async () => {
  // lb is a priced seat and its round-4 reply is NOT in the cache, so invoke() is asked to spend $8 under a one-cent cap and refuses before sending.
  const err = await run(retention(() => verdict(true, withdraw(ID_B))), { maxRounds: 4, budget: 0.01, models: { lb: 'mock-priced' }, miss: l => l === 'panel-4-lb' }).then(() => null, e => e);
  assert.ok(err instanceof BudgetExceeded, `the run stops on the cap: ${err}`);
  const rows = err.partial.answerBack;
  assert.ok(rows.some(x => x.lab === 'la' && x.round === 4), 'la was asked and shown its objection in round 4');
  assert.equal(rows.some(x => x.lab === 'lb' && x.round === 4), false, 'lb was never sent its section, so no row says it was shown');
});

test('E3 resume pin (C&C condition 1): a run cut after round 2 and resumed from its recorded stages gives the same answer_back, answer_back_replies, layers and prompts as the uninterrupted run, with no new call for the recorded rounds', async () => {
  const script = retention(() => verdict(true, withdraw(ID_B)));
  const whole = await run(script);
  // The "sitting" that was cut: every stage of rounds 1 and 2 (the build, both panels, both revises) as its onStage would have written it.
  const recorded = new Map(whole.r.stages.filter(s => s.label === 'build' || /^(panel|revise)-[12](-|$)/.test(s.label))
    .map(s => [s.label, { text: s.text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: s.promptHash }]));
  assert.ok(recorded.has('revise-2') && recorded.has('panel-2-la'), `fixture: rounds 1-2 were recorded: ${[...recorded.keys()].join(', ')}`);
  const resumed = await run(script, { stages: recorded });
  assert.deepEqual(resumed.stale, [], 'no recorded stage went stale: every prompt of rounds 1-2 is rebuilt identically');
  assert.deepEqual(resumed.served.filter(l => recorded.has(l)), [], 'no new call for a recorded stage');
  assert.ok(resumed.served.some(l => /^panel-[3-9]/.test(l)), 'fixture: the rounds after the cut were asked');
  assert.deepEqual(resumed.r.answerBack, whole.r.answerBack);
  assert.deepEqual(resumed.r.answerBackReplies, whole.r.answerBackReplies);
  assert.deepEqual(resumed.r.layers, whole.r.layers);
  assert.equal(resumed.prompts.get('panel-4-lb'), whole.prompts.get('panel-4-lb'), 'the judge is shown the same passages after a resume (sawDraft is rebuilt from the replayed stages)');
  assert.equal(resumed.r.passed, whole.r.passed);
});

test('E3 audit row 26: a stated pass that carries an open objection keeps its layer from passing even when the unheard peer signs off on its re-ask (the layer cannot pass, the reviser runs on the union)', async () => {
  const UNREAD = 'I could not finish my review';
  const replies = label => {
    if (label === 'panel-1-lb') return objecting(F_B);
    if (label === 'panel-2-la') return verdict(false);
    if (label === 'panel-3-la') return verdict(true, withdraw(ID_A));
    if (label === 'panel-3-lb') return PASS;
    if (label === 'panel-3-lc') return UNREAD;
    return null;
  };
  const { r, prompts } = await run(replies, { critics: ['la', 'lb', 'lc'], layers: [1, 2, 2], maxRounds: 4, extra: { freedoms: { pass: true } } });
  // CHANGED ACCEPTED TEST (decider-readiness apply patch + fix-up, 24 Okt 2026; C&C ruling (b)). OLD: the unheard peer lc was not re-asked while a stated pass carried an open objection, and its verdict stayed 'unheard'. NEW: with the re-ask sentence recorded the stated pass is an abstention (STATED_PASS_OPEN) and the abstaining judges are re-asked together, so lc IS re-asked; its label has no scripted reply, so it signs off, and the assertion says signed_off. WHY: the first version of this change (PX fad02049) still expected 'unheard' and failed there. lc is NOT kept unreadable on purpose: an unheard lc would block layer 2 by itself and the test would pass even if the stated-pass-with-open-objection logic were broken; with lc signed off, only lb's open objection can keep the layer 'objected'. The peer's re-ask count is not pinned (test/layered-ask-before-carry.test.js pins the ask flow).
  assert.ok(prompts.has('revise-3'), 'the round goes to the reviser with the carried objection');
  assert.equal(r.panelVerdicts.find(v => v.round === 3 && v.lab === 'lc').verdict, 'signed_off', 'the unheard peer is re-asked and signs off (the fixture default for a label with no scripted reply): only the open objection can keep the layer from passing');
  assert.equal(r.layers.find(x => x.round === 3 && x.layer === 2).state, 'objected');
});
