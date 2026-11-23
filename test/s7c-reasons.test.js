// 0.8.4 S7c, commit 1 (W41; Q8 item 5 (ii), CA8; WORDING row S7C-1): when layer 3 overruled an OPEN objection of a lower-layer seat (an escalation ruling: the go-up here) and then OBJECTED, so the plan went back, the seat's FIRST review after that carries layer 3's reasons
// beside the objection (a held section, no call, no revision); the seat answers among its ordinary answers. A layer-3 sign-off, a closed (rated below 4) objection and a held name show nothing; "answered once" = shown in that pass only (a re-ask re-renders, a later pass does not).
// $0, offline. The fixture is the go-up fixture of test/s7-go-up.test.js (layer 2 hits its bound, the plan goes up to layer 3, which rules), with layer 3 objecting at pass 3 so pass 4 starts at layer 1.
// NOT DRIVEN (named, none lost): (1) the still-open-at-render filter when the objection was WITHDRAWN in an exchange between the ruling and the review; (2) T17am's ladder skip (the seat's layer is below a ladder floor in the pass after the ruling); (3) Q-b, a layer-1 raiser in the same row; (4) the handler's
// `not yet` after a layer-3 sign-off (the `objected` term of the input function has no red here: after a sign-off the run ends, so RL-4 cannot fail on it; it is driven through the build-check CLI path only); (5) the sorting overrule of the climb verdict (S8, not built: the single input function layerThreeOverrulesOf is where its rows join).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import * as HB from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { checkT13w } from './helpers/s8-record-rows.js';
import { reportJsonShape } from '../src/report-shape.js';
import { estimateChainRows, estimateTokens } from '../src/cost.js';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried neither `relation` nor `severity`, and layer 3's reasons named an unrated objection (`not rated`). NEW: Y and L3F carry the rating 5 (the number the rated rows below already use), a first raise says `new` and layer 2's repeat in pass 2 says `continues <id>`; the section names `rated 5`. WHY: relationRule and ratingDemand recorded (src/chain.js relation gate; src/ratings-demand.js).
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', severity: 5 };
const idY = objectionId('mid-beta', Y);
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5 };
const idL3 = objectionId('top-gamma', L3F);   // layer 3's own objection must be answered when it is next asked (else the unanswered re-ask walks the run to the cap)
const ANSWER_BACK = '# Your objections from the last round, and what happened';   // src/prompts/recorded-082.js answerBackSection
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const rules = list => JSON.stringify({ rulings: list });
const withdrawsOf = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
const keepsOf = (f, id) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [{ ...f, relation: `continues ${id}` }], verdict_line: 'no', answers: [{ id, status: 'sustained', evidence: 'No owner is named in section two.' }] });
const rated = (f, severity = 5) => ({ ...f, severity });
const GOUP = { goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };
const W41 = { layerThreeReasonsSection: HB.layerThreeReasonsSection };
const HEADING = "# Layer 3's reasons for objections of yours it overruled";
const REASON = 'Section two names the owner.';
const OVERRULE = { 'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: REASON }]) };
const BOUND = { 'panel-1-mid-beta': objects({ ...Y, relation: 'new' }), 'panel-2-mid-beta': objects({ ...Y, relation: `continues ${idY}` }) };

async function run({ held, answers = {}, ov = { rounds: 3, bounds: { 1: 1, 2: 1 } }, retags = null } = {}) {
  const prompts = new Map(); const served = [];
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const script = { ...BOUND, ...answers };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return script[label] === null ? null : { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-w41', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds,
    seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-w41', log: () => {}, config, ...(retags ? { retags } : {}) });
  return { result, prompts, served, config };
}
const reportOf = ({ result, config }) => JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-w41', chain: 'fixture-w41', task: 't.md', result, config })));
const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateEscalations = ajv.compile({ $defs: schema.$defs, ...schema.properties.escalations });
const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
const sectionIn = (prompts, label) => prompts.get(label)?.user.includes(HEADING);
const anywhere = prompts => [...prompts.keys()].filter(l => prompts.get(l).user.includes(HEADING));

test('RL-1 (T17ap/as/at): layer 3 overruled an open objection of layer 2 and objected: layer 2\'s next review carries layer 3\'s reasons after its answer-back; nobody else does', async () => {
  const { prompts, served } = await run({ held: { ...GOUP, ...W41 }, answers: { ...OVERRULE, 'panel-3-top-gamma': objects({ ...L3F, relation: 'new' }), 'panel-4-mid-beta': withdrawsOf(idY), 'panel-4-top-gamma': withdrawsOf(idL3) } });
  assert.ok(served.includes('revise-3') && served.includes('panel-4-mid-beta'), 'layer 3 objected, the writer revised and pass 4 asked layer 2');
  const u = prompts.get('panel-4-mid-beta').user;
  assert.ok(u.includes(HEADING), 'the section');
  assert.ok(u.includes(`- ${idY}, rated 5, overruled by every judge of layer 3 in round 3. Reasons given: top-gamma: ${REASON}`), u.slice(u.indexOf(HEADING)));
  assert.ok(u.includes(ANSWER_BACK) && u.indexOf(HEADING) > u.indexOf(ANSWER_BACK), 'after the answer-back section');
  assert.deepEqual(anywhere(prompts), ['panel-4-mid-beta'], 'only that review');
});

// ADDED (0.8.4 apply, group 7, C&C RULING_STEP5_6 D, P3: the section IS sent on a pass that carries it, so the priced figure is checked against what is sent). The MAXIMUM prices the layer-3 reasons section as 400 input tokens per top-layer judge (K3) on a lower seat's review rows (src/cost.js s7cGainOf; RS-S7c-1 pins the per-call figures by term); the unit is an upper bound
// (one reason per top-layer judge, shown once per block). This leg runs RL-1's fixture (the stall-free go-up shape: layer 3 overruled layer 2's objection and objected, pass 4 asks layer 2 again) and compares the section SENT in panel-4-mid-beta with the term priced on that seat's row: the sent section (heading and its row, up to the next heading) is positive and no larger than 400 x K3.
test('RL-9 (money, the spy leg of the W41 term): the section sent to layer 2 in pass 4 is no larger than the 400 x K3 the maximum prices on that seat\'s row', async () => {
  const { prompts, config } = await run({ held: { ...GOUP, ...W41 }, answers: { ...OVERRULE, 'panel-3-top-gamma': objects({ ...L3F, relation: 'new' }), 'panel-4-mid-beta': withdrawsOf(idY), 'panel-4-top-gamma': withdrawsOf(idL3) } });
  const u = prompts.get('panel-4-mid-beta').user; const from = u.indexOf(HEADING); assert.ok(from >= 0, 'the section was sent');
  const rest = u.slice(from + HEADING.length); const next = rest.search(/\n# /); const section = HEADING + (next === -1 ? rest : rest.slice(0, next));
  const sent = estimateTokens(section);
  setHeldForTest(null);
  const k3 = config.seats.critics.filter(k => k.layer === 3).length;
  const mx = estimateChainRows(config, { maximum: true }).find(r => r.label === 'panel-L2-mid-beta'); const ex = estimateChainRows(config, { maximum: false }).find(r => r.label === 'panel-L2-mid-beta');
  const priced = 400 * k3;   // the reasons term of the layer-2 row (the row also carries 400 x K1 of the rule-on-layer-one section: RS-S7c-1 pins both by term)
  assert.ok((mx.input / (mx.times ?? 1)) - (ex.input / (ex.times ?? 1)) >= priced, 'the row carries at least the reasons term');
  assert.ok(sent > 0 && sent <= priced, `the section sent (${sent} tokens) is positive and within the priced unit (400 x K3 = ${priced})`);
});

// REMOVED (0.8.4 apply, recorded state; K7): RL-2 (held control), 'without the held name no prompt of the run carries the section'. A held-state row: layerThreeReasonsSection is recorded, so every shipped run carries the section. Sibling: RL-1, the live twin (the same run, the section asserted in pass 4 only).

test('RL-3 (answered once, T17aj): shown in pass 4 only: a seat that keeps the objection is not shown the reasons again in pass 5', async () => {
  const { prompts, served } = await run({ held: { ...GOUP, ...W41 }, answers: { ...OVERRULE, 'panel-3-top-gamma': objects({ ...L3F, relation: 'new' }), 'panel-4-mid-beta': keepsOf(Y, idY), 'panel-5-mid-beta': withdrawsOf(idY), 'panel-5-top-gamma': withdrawsOf(idL3) } });
  assert.ok(served.includes('panel-5-mid-beta'), 'pass 5 asked layer 2 again');
  assert.equal(sectionIn(prompts, 'panel-4-mid-beta'), true);
  assert.equal(sectionIn(prompts, 'panel-5-mid-beta'), false, 'not again');
});

test('RL-4 (PIN): layer 3 signs off after its ruling: nothing is shown anywhere (the run ends; this row cannot fail on the objected term, see NOT DRIVEN 4)', async () => {
  const { prompts } = await run({ held: { ...GOUP, ...W41 }, answers: OVERRULE });
  assert.deepEqual(anywhere(prompts), []);
});

test('RL-5: an objection layer 3 overruled that the overrule CLOSES (rated 5, re-tagged to 3) shows nothing; the same run left rated 5 shows the reasons with the rating', async () => {
  const answers = { 'panel-1-mid-beta': objects({ ...rated(Y), relation: 'new' }), 'panel-2-mid-beta': objects({ ...rated(Y), relation: `continues ${idY}` }), ...OVERRULE, 'panel-3-top-gamma': objects({ ...rated(L3F), relation: 'new' }), 'panel-4-mid-beta': withdrawsOf(idY), 'panel-4-top-gamma': withdrawsOf(idL3) };   // ratings are demanded in this run: layer 3's own objection carries one
  const closed = await run({ held: { ...DEMAND, ...GOUP, ...W41 }, retags: [{ pass: 3, id: idY, severity: 3, reason: 'A missing owner does not change what is built.' }], answers });
  assert.deepEqual(anywhere(closed.prompts), [], 'closed: nothing owed');
  const open = await run({ held: { ...DEMAND, ...GOUP, ...W41 }, answers });
  assert.ok(open.prompts.get('panel-4-mid-beta')?.user.includes(`- ${idY}, rated 5, overruled by every judge of layer 3 in round 3.`), 'control: still open, shown with its rating');
});

test('RL-8: the section renders one row and several rows in the label form of the ledger, names the layer given, and says "not rated" for an unrated row', () => {
  const one = HB.layerThreeReasonsSection({ layer: 3, rows: [{ id: 'O-1', rated: 5, ruled_round: 3, reasons: [{ lab: 'lc', text: 'Covered.' }] }] });
  assert.ok(one.startsWith("# Layer 3's reasons for objections of yours it overruled\n\nLayer 3 read the plan after your last review, objected, and overruled the objection below, named by its id"));
  assert.ok(one.includes('\n- O-1, rated 5, overruled by every judge of layer 3 in round 3. Reasons given: lc: Covered.'));
  assert.ok(one.includes('or keep it (answer it sustained). That answer is all this section asks of you.'));   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `or keep it (answer it sustained). Nothing else follows.` NEW: `or keep it (answer it sustained). That answer is all this section asks of you.` WHY: the reviewed row of layerThreeReasonsSection (src/prompts/recorded-084-b.js:239; the apply, commit 1). First-read class was R in my table; RL-8 is P.
  const many = HB.layerThreeReasonsSection({ layer: 4, rows: [{ id: 'O-1', rated: null, ruled_round: 2, reasons: [{ lab: 'ld', text: 'A.' }, { lab: 'le', text: 'B.' }] }, { id: 'O-2', rated: 7, ruled_round: 2, reasons: [] }] });
  assert.ok(many.includes("Layer 4 read the plan after your last review, objected, and overruled the objections below, named by their ids"));
  assert.ok(many.includes('\n- O-1, not rated, overruled by every judge of layer 4 in round 2. Reasons given: ld: A. / le: B.\n- O-2, rated 7, overruled by every judge of layer 4 in round 2.'));
  assert.equal(many.includes('Layer 3'), false, 'the layer is a parameter');
});

test('RL-7 (records): the escalation outcome row says in which round the judge was first shown the reasons (the report, not the internal row); unchanged by a later pass; schema-valid', async () => {
  const live = await run({ held: { ...GOUP, ...W41 }, answers: { ...OVERRULE, 'panel-3-top-gamma': objects({ ...L3F, relation: 'new' }), 'panel-4-mid-beta': keepsOf(Y, idY), 'panel-5-mid-beta': withdrawsOf(idY), 'panel-5-top-gamma': withdrawsOf(idL3) } });
  const rep = reportOf(live);
  assert.deepEqual(rep.escalations[0].outcome.map(o => [o.id, o.result, o.reasons_shown_in]), [[idY, 'overruled', 4]], 'first shown in round 4, and pass 5 does not move it');
  assert.ok(validateEscalations(rep.escalations), JSON.stringify(validateEscalations.errors));
  assert.equal(validateEscalations(rep.escalations.map(e => ({ ...e, outcome: e.outcome.map(o => ({ ...o, reasons_shown_in: 0 })) }))), false, 'the schema rejects round 0 (so this row can fail)');
  // REMOVED (0.8.4 apply, recorded state; K7): the held half, 'held: the key is absent'. Sibling: the live half above (reasons_shown_in is 4 and schema-valid) in this test.
});

test('RL-6 (the handler\'s `not yet`): layer 3 overruled and SIGNED OFF, the handler answered not_yet and the plan went back: layer 2\'s next review is asked with the objection open and shows NO reasons (layer 3 did not object)', async () => {
  const served = []; const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, p));
  setHeldForTest({ ...GOUP, ...W41, ...CHECK });
  // CHANGED (box run of 08 Nov 2026, found by reading build-check.js judgeBuildCheck): a not_yet whose reasons do not name every demanded id is refused, the run pauses for a new answer and pass 4 never happened; the reasons now name idY.
  const script = { ...BOUND, ...OVERRULE, 'build-check-1': answer('not_yet', `${idY}: Name the owner of the worker before building.`), 'build-check-2': answer('good_to_build'), 'panel-4-mid-beta': withdrawsOf(idY) };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    if (label.startsWith('build-check-')) return null;
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-w41-nyet', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: SESSION, reviser: SESSION, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  try { await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-w41-nyet', log: () => {}, config }); } catch { /* a stop after the not_yet is fine: only the prompts are read */ }
  assert.ok(served.includes('build-check-1'), 'the handler was asked once layer 3 had signed off');
  const u = prompts.get('panel-4-mid-beta')?.user;
  assert.ok(u, 'pass 4 asked layer 2 again');
  assert.ok(u.includes(ANSWER_BACK) && u.includes(idY), 'control: the objection is open in layer 2\'s answer-back, so only the objected term keeps the section out');
  // CHANGED ACCEPTED (0.8.4 S8 rulings, T13w; this file is S7c's): OLD RL-6 had no assertion on the calls S gets between the two build checks. NEW one call, checkT13w(served), at the end of the row: in that window only panel-4-mid-beta names mid-beta. WHY: the plan's exit list asks that S gets no call beyond its ordinary review. No existing assertion is changed or removed.
  checkT13w(served);   // T13w (NAMED PIN, no input can make the call happen): between build-check-1 and build-check-2 seat S is asked only its ordinary review. Fail condition: any other label naming mid-beta is served in that window.
  assert.deepEqual(anywhere(prompts), []);
});
