// Stall escalation (shape B, 27 Okt 2026; src/escalation.js, the wiring in src/chain.js; C&C rulings of 27 Okt 2026). Offline, $0: the cache stub answers every stage by its label (the conflict decider's test pattern), so the
// judges object, sign off and rule exactly when the script says. The ruling words are HELD (test/held-prompts/held-escalation.js): every row that needs a ruling injects them; the rows without them pin shape A, the fallback.
// Pinned: a stall below the top layer passes the plan up instead of ending; the floor layer reviews blind and then rules; sustain / overrule / undecided; the escalated sign-off ending (passed false, outcome not widened, the
// dispute stage over the standing ids); the raiser is hidden in the ruling prompt; a stall at the top layer or on the last pass ends as before; a stop's partial record carries escalations[]; the expected size of a rule- call.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { objectionId } from '../src/objection-ids.js';
import { expectedOutputTokensOf } from '../src/cost.js';
import { escalationTarget, readRulings, settleRulings, rulingActive, RULING_HELD } from '../src/escalation.js';
import * as ESC from '../src/escalation.js';   // the 0.8.4 exports (notDebatedNext, escalationsWithNext) are read through the namespace, so a tree without them fails those tests alone and not the whole file
import * as HESC from './held-prompts/held-escalation.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };

// CHANGED (0.8.4 S5 U-B, RU-ADD-A7 / N25 / T20i, C&C 05 Nov 2026): an overrule closes an objection ONLY when it is rated below 4 (and was never rated 7 or above); an unrated one stays open. The rows below that test what follows a CLOSING ruling (SE-1, SE-14, SE-15, SE-16, SE-18) keep that premise:
// the held rating demand is injected, their scripted objections carry `severity` 5 (fixture ratings: objection-closed-states.test.js's shape), and the handler re-tags the objection to 3 at the top of the escalation pass (the runChain `retags` input), before the ruling. The stays-open case is test/stall-ratings.test.js.
const CLOSING = { ...INJECT, ...DEMAND };
const rated = (f, severity = 5) => ({ ...f, severity });
const retagTo3 = (id, pass = 3) => [{ pass, id, severity: 3, reason: 'A missing limit does not change what is built.' }];
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const X = { severity: 5, criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const LOW = 'raiser-alpha';   // a distinctive lab name, so "the prompt does not name the raiser" cannot pass by accident
const idX = objectionId(LOW, X);
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried no `relation`. NEW: a first raise says `new`, the same seat's repeat in a later pass says `continues <id>` (a `new` on a standing id would mint #2 and the stall would never fire); the ids do not read the relation. WHY: relationRule recorded (src/chain.js, the relation gate).
const nw = f => ({ ...f, relation: 'new' });
const cont = (lab, f) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const rules = (list) => JSON.stringify({ rulings: list });
// Layer 1 objects with X in passes 1 and 2 (the stall); the writer declines X in revise-1 with a reason; layers 2 and 3 sign off whenever asked unless a row overrides it.
const BASE = { 'panel-1-raiser-alpha': objects(nw(X)), 'panel-2-raiser-alpha': objects(cont(LOW, X)), 'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idX}: The limit is set in section two.` };

// 0.8.4 SG-1 (C&C 08 Nov 2026): the stall goes up only with the ledger AND the rating demand; every row that needs the climb runs with DEMAND and rated objections (severity 5 holds the sign-off and never closes on an overrule: the meaning the unrated fixtures had). SE-7 and SE-8 (the two stops) keep INJECT: they are the evidence that the top-layer and last-pass stops keep their reasons without the gate.
async function run({ held = { ...INJECT, ...DEMAND }, answers = {}, maxRounds = 6, ov = null, upper = ['mid-beta'], stall = 2, peers = [], retags = null } = {}) {   // 0.8.4 C7: `peers` = more layer-1 seats (it defaults to what the older tests ran with: ONE layer-1 seat, where the exchange cannot run; with a peer it runs, since the exchange has no switch)
  const prompts = new Map(); const served = [];
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const script = { ...BASE, ...answers };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return script[label] === null ? null : { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = {
    name: 'fixture-escalation', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: stall },
    ...(ov ? { maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds } : { maxRounds }),
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), ...peers.map(l => seat(l, 1)), ...upper.map(l => seat(l, 2)), seat('top-gamma', 3)] },
  };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-esc', log: () => {}, config, ...(retags ? { retags } : {}) }).catch(e => { e.served = served; e.prompts = prompts; throw e; });
  return { result, prompts, served, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-esc', chain: 'fixture-escalation', task: 't.md', result, config }))) };
}
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');

test('SE-1 OVERRULE: a layer-1 stall passes the plan up; layer 2 reviews blind, then rules; an overrule closes the id and the top layer\'s sign-off is an ESCALATED sign-off (passed false, outcome not widened)', async () => {
  const { result, report, prompts, served } = await run({ held: CLOSING, retags: retagTo3(idX), answers: { 'panel-1-raiser-alpha': objects(nw(rated(X))), 'panel-2-raiser-alpha': objects(cont(LOW, rated(X))), 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]) } });
  assert.equal(states(report), '1.1:objected 1.2:not_asked 1.3:not_asked 2.1:objected 2.2:not_asked 2.3:not_asked 3.1:escalated 3.2:signed_off 3.3:signed_off');
  assert.ok(served.indexOf('panel-3-mid-beta') < served.indexOf('rule-3-mid-beta'), 'the blind review comes first, then the ruling');
  assert.equal(served.includes('revise-2'), false, 'the stalled pass makes no revise');
  assert.equal(report.passed, false);
  assert.equal(report.outcome, 'no_consensus');
  assert.deepEqual(report.escalated_signoff, { pass: 3, layer: 3, below: [1] });
  const [e] = report.escalations;
  assert.deepEqual([e.round, e.pass, e.from_layer, e.to_layer, e.ids], [2, 3, 1, 2, [idX]]);
  assert.deepEqual(e.outcome.map(o => [o.id, o.lab, o.layer, o.first_round, o.result]), [[idX, LOW, 1, 1, 'overruled']]);
  assert.deepEqual(e.rulings, [{ seat: 'mid-beta', lab: 'mid-beta', id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]);
  assert.equal(result.dispute.ran, false, 'nothing is standing: no dispute stage');
  assert.equal(result.dispute.reason, 'escalated_signoff');
  assert.match(result.deliverable, /^## Escalated sign-off\n/);
  assert.ok(result.deliverable.includes(`${idX} (raised by ${LOW}, layer 1: "No limit on retries."): overruled by every judge of layer 2 in round 3. Reasons given: mid-beta: Section two sets the limit.`), result.deliverable.slice(0, 600));
  // The ruling prompt: the request, the plan, the objection and the writer's reason (with its round); NOT the raiser's lab or layer.
  const p = prompts.get('rule-3-mid-beta');
  const text = `${p.system}\n${p.user}`;
  assert.ok(text.includes('Write a worker plan') && text.includes(DRAFT) && text.includes(idX) && text.includes('No limit on retries.'));
  assert.ok(text.includes("The writer's reason for declining it, from round 1: The limit is set in section two."), text);
  assert.equal(text.includes(LOW), false, 'the raiser\'s lab is hidden');
  assert.equal(/layer/i.test(p.user), false, 'the raiser\'s layer is hidden (no layer is named in the user prompt)');
  // The words promise what settleRulings does (outside review D3): one judge's overrule does not close an objection, every judge's does; a sustain from any one makes it that judge's own.
  assert.ok(p.system.includes('An objection is closed for the rest of the run only if every judge asked to rule on it overrules it'), p.system);
});

test('SE-2 SUSTAIN beside an OVERRULE: one seat sustains and one overrules, so the id is SUSTAINED and adopted by the sustaining seat alone, under its own id; that seat\'s signoff row does not read clean; the next pass starts at layer 1', async () => {
  const idB = objectionId('mid-beta', X);
  // In pass 4 the sustaining seat is asked about its adopted objection (answer-back, by its own id) and withdraws it with a quote the draft holds; a seat that never answers it would keep it open, stall layer 2 and send the plan up again (SE-9).
  const withdraws = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id: idB, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
  const { result, report, prompts } = await run({ upper: ['mid-beta', 'mid-delta'], answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'The limit is not stated.' }]), 'rule-3-mid-delta': rules([{ id: idX, ruling: 'overrule', reason: 'It is stated.' }]), 'panel-4-mid-beta': withdraws } });
  const e = report.escalations[0];
  assert.deepEqual(e.outcome.map(o => [o.id, o.result, o.adopted_as?.map(a => [a.lab, a.id])]), [[idX, 'sustained', [['mid-beta', idB]]]]);
  const row3 = report.layers.find(x => x.round === 3 && x.layer === 2);
  assert.deepEqual([row3.state, row3.sustained], ['objected', [idX]]);
  // signoff[] is the LAST pass's; the pass-3 rows are read from the revise prompt and the pass-3 record instead.
  assert.ok(prompts.get('revise-3').user.includes('No limit on retries.'), 'the sustained objection goes to the writer as the sustaining seat\'s own');
  // CHANGED (0.8.4 S5, Q-a / RU-S5-02 / D16, C&C 05 Nov 2026): the escalation lasts ONE pass. Before: pass 4 'still starts at the floor: layer 1 waits for the top layer's verdict' (4.1:escalated) and ended in an escalated sign-off. Now: the sustain
  // (rated 4 or above, here unrated) ended the pass, the writer revised, and pass 4 starts at layer 1 again: a plain full sign-off, no escalated sign-off. The D5 sentence (the sustained line ends on the adopted objection's final status) is produced only by an
  // escalated sign-off block; it is now reached by a sustain BELOW 4 (NEW-A7-1), where the pass goes up, and is asserted there (test/stall-ratings.test.js, U-B).
  assert.equal(/4\.1:escalated/.test(states(report)), false, 'pass 4 starts at layer 1: layer 1 is not parked');
  assert.equal(report.escalated_signoff, undefined, 'pass 4 was a plain full sign-off, not an escalated one');
});

test('SE-3 the sustaining seat\'s signoff[] row in the ruling pass: signedOff false, the adopted objection with sustained_from', async () => {
  const idB = objectionId('mid-beta', X);
  // pass 3 is the last pass, so signoff[] is that pass's
  const { report } = await run({ maxRounds: 3, answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'Not stated.' }]) } });
  const row = report.signoff.find(s => s.lab === 'mid-beta');
  assert.equal(row.signedOff, false);
  assert.deepEqual(row.objections.map(o => [o.id, o.sustained_from]), [[idB, { lab: LOW, layer: 1, id: idX }]]);
});

test('SE-4 UNDECIDED: an unreadable ruling is never an overrule; the id stays STANDING and today\'s dispute stage runs over it after the escalated sign-off, tagged', async () => {
  const { result, report } = await run({ answers: { 'rule-3-mid-beta': 'not json at all' } });
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.id, o.result, o.why]), [[idX, 'undecided', 'unreadable_ruling']]);
  assert.equal(result.dispute.ran, true);
  assert.equal(result.dispute.reason, 'escalated_signoff');
  assert.deepEqual(result.dispute.open_objections.map(o => [o.id, o.escalated_standing, o.last_raised_round]), [[idX, true, 2]]);
  assert.ok(result.deliverable.includes('passed up a layer, where no ruling closed it'));
  assert.ok(result.deliverable.indexOf('## Escalated sign-off') < result.deliverable.indexOf('## Unresolved dissent'));
});

test('SE-5 an overrule WITHOUT a reason is no ruling (the prompt promises it): the id stays standing', async () => {
  const { report } = await run({ answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: '  ' }]) } });
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.result, o.why]), [['undecided', 'no_ruling']]);
  assert.deepEqual(report.escalations[0].rulings.map(r => [r.ruling, r.why]), [[null, 'overrule_without_reason']]);
});

test('SE-6 SHAPE A (the ruling words held): the plan still goes up and layer 2 reviews blind, NO rule- call is made, and the id stays standing (why: prompt_held)', async () => {
  // The words are recorded in src/roles.js since the owner's yes, so the held state is set explicitly ({ name: undefined }: src/held-roles.js honours it), as test/helpers/held-off.js does for the 0.8.3 names.
  const { report, served } = await run({ held: { ...Object.fromEntries(RULING_HELD.map(n => [n, undefined])), ...DEMAND } });
  assert.equal(served.some(l => l.startsWith('rule-')), false);
  assert.ok(served.includes('panel-3-mid-beta'));
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.result, o.why]), [['undecided', 'prompt_held']]);
  assert.equal(report.dispute.reason, 'escalated_signoff');
});

// CHANGED (0.8.4 S5 U-C, C&C 05 Nov 2026, R1 as changed): SE-7 and SE-8 ran a LAYERED chain without overseer rounds and ended it 'stalled' (dispute reason, no stop). A stall that cannot be passed up (the top layer holds it, or no pass is left) is now a STOP for the person on every
// layered chain: RoundStopped, kind stall_stop, why top_layer / last_pass; 'stalled' stays only on unlayered chains (test/dispute-stage.test.js). The stop's own rows are test/stall-stop.test.js. OLD source: both ended 'stalled' and these two assertions fail there.
test('SE-7 a stall at the TOP layer STOPS the run for the person (stall_stop, why top_layer; no escalation)', async () => {
  const err = await run({ held: INJECT, answers: { 'panel-1-raiser-alpha': meets(), 'panel-2-raiser-alpha': meets(), 'panel-1-top-gamma': objects(nw(X)), 'panel-2-top-gamma': objects(cont('top-gamma', X)) } }).then(() => null, e => e);
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.why, err.stop.top_layer, err.stop.pass], ['stall_stop', 'top_layer', 3, 2]);
  assert.equal(err.partial.escalations?.length ?? 0, 0, 'nothing was passed up');
});

test('SE-8 a stall on the LAST pass STOPS the run for the person (stall_stop, why last_pass): no pass is left to escalate into', async () => {
  const err = await run({ held: INJECT, maxRounds: 2 }).then(() => null, e => e);
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.why, err.stop.pass], ['stall_stop', 'last_pass', 2]);
  assert.equal(err.partial.escalations?.length ?? 0, 0);
});

test('SE-9 the stall window starts fresh after an escalation: the pass right after the escalated one cannot stall again at once', async () => {
  // layer 2 sustains, then objects with the same adopted objection in passes 3 and 4: the earliest new stall compares passes 3 and 4 (r+1, r+2), so it fires in pass 4 and escalates to layer 3.
  const { report } = await run({ answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'Not stated.' }]), 'panel-3-mid-beta': objects(nw(X)), 'panel-4-mid-beta': objects(cont('mid-beta', X)) } });
  assert.deepEqual(report.escalations.map(e => [e.round, e.from_layer, e.to_layer]), [[2, 1, 2], [4, 2, 3]]);
});

test('SE-10 a STOP keeps the record: on a chain with overseer rounds, a sustained objection uses a layer-2 revision, layer 2\'s bound then sends the plan up (0.8.4 S7) and the overseer-round cap stop that follows carries escalations[] in its partial record', async () => {
  // pass 4: layer 2 objects with a DIFFERENT objection (the same one twice would be a new stall, which fires before the bound: SE-9), so advance() meets layer 2's bound of one revision, used by the sustain in pass 3.
  const Y = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  // CHANGED (0.8.4 S5, R3): the adopted idB stood in passes 3 and 4 unless layer 2 answers it; a per-objection count would stall it at layer 2 before advance() meets the bound. So the pass-4 reply withdraws idB (with a quote the draft holds) and objects Y alone.
  const idB = objectionId('mid-beta', X);
  const objectsYWithdrawingB = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: Y.problem }], failures: [nw(Y)], answers: [{ id: idB, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }], verdict_line: 'no' });
  // CHANGED (0.8.4 S7, Q7): the run no longer STOPS at layer 2's bound - the plan goes up to layer 3 instead (a second escalation, trigger layer2_bound, pass 5). The stop that keeps the record is now the overseer-round cap: layer 3 objects in that pass (rounds: 1).
  // The go-up's ruling words are not recorded in this file's held map (its own gate), so its outcome is undecided, prompt_held.
  const Z = { severity: 5, criterion: CRITERION, problem: 'No owner is named for the queue.', quote: 'failed requests' };
  const err = await run({ ov: { rounds: 1, bounds: { 1: 1, 2: 1 } }, answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'Not stated.' }]), 'panel-4-mid-beta': objectsYWithdrawingB, 'panel-5-top-gamma': objects(nw(Z)) } }).then(() => null, e => e);
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.cap, err.stop.pass], ['overseer_cap', 1, 5]);
  assert.deepEqual(err.partial.escalations.map(e => [e.trigger ?? 'stall', e.outcome.map(o => o.result)]), [['stall', ['sustained']], ['layer2_bound', ['undecided']]]);
});

test('SE-11 the pure parts: the target layer (mixed-layer signature goes up from its highest layer), the parser\'s promises, settling, and the one-batch rule', () => {
  const layerOf = { a: 1, b: 2, c: 3 };
  assert.deepEqual(escalationTarget({ failures: [{ lab: 'a' }], layerOf, layerNumbers: [1, 2, 3] }), { from: 1, to: 2 });
  assert.deepEqual(escalationTarget({ failures: [{ lab: 'a' }, { lab: 'b' }], layerOf, layerNumbers: [1, 2, 3] }), { from: 2, to: 3 }, 'mixed: from the highest layer in the signature');
  assert.equal(escalationTarget({ failures: [{ lab: 'c' }], layerOf, layerNumbers: [1, 2, 3] }), null, 'the top layer: no escalation');
  const r = readRulings({ rulings: [{ id: 'O-1', ruling: 'Overrule.', reason: 'ok' }, { id: 'O-2', ruling: 'sustain' }, { id: 'O-2', ruling: 'overrule', reason: 'x' }, { id: 'O-3', ruling: 'fixed' }, { id: 'O-9', ruling: 'sustain' }] }, ['O-1', 'O-2', 'O-3']);
  assert.deepEqual([...r.byId.entries()], [['O-1', { ruling: 'overrule', reason: 'ok' }]], 'two different rulings for one id are none; a word that is neither is none');
  assert.deepEqual(r.ignored.map(i => i.why).sort(), ['conflicting_rulings', 'unknown_id', 'unreadable_ruling']);
  const s = settleRulings({ ids: ['O-1'], seats: ['p', 'q'], perSeat: [{ seat: 'p', byId: new Map([['O-1', { ruling: 'overrule', reason: 'r' }]]) }, { seat: 'q', why: 'ruler_unreachable' }] });
  assert.deepEqual(s, [{ id: 'O-1', result: 'undecided', sustainers: [], why: 'ruler_unreachable' }], 'overruled needs EVERY seat');
  assert.equal(rulingActive(name => (name === RULING_HELD[0] ? () => '' : undefined)), false, 'one recorded name of three is not active');
});

test('SE-12 a rule- call has an expected size, the same as the seat\'s review (the gate admits it at its expected cost)', () => {
  const seat = { provider: 'openrouter', model: 'x/y', maxTokens: 40000 };
  assert.equal(expectedOutputTokensOf('rule-8-mimo-v2.6-pro', seat, {}), expectedOutputTokensOf('panel-8-mimo-v2.6-pro', seat, {}));
  assert.notEqual(expectedOutputTokensOf('rule-8-mimo-v2.6-pro', seat, {}), null);
});

test('SE-13 the records are a valid report-v1 (the widened enums and the new fields), and BOARD.md names the escalated sign-off', async () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  for (const answers of [{ 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Set in section two.' }]) }, { 'rule-3-mid-beta': 'not json' }]) {
    const { result, report } = await run({ answers });
    assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
    const board = renderBoardMd({ runId: 'r-esc', result });
    assert.match(board, /## Objections passed up a layer/);
    assert.match(board, /\*\*Escalated sign-off:\*\* the top layer \(layer 3\) signed off in pass 3 with layer 1 passed over/);
  }
});

test('SE-14 THE RAISER FILTER after the floor resets: an id a ruling closed, raised again by its raiser, is recorded and NOT counted; the raiser counts as clean for the climb; the sign-off of that pass is an escalated sign-off, never a pass', async () => {
  // pass 3: layer 2 overrules X and signs off, the top layer objects (Z), the writer revises, so the floor resets; pass 4: layer 1 raises X AGAIN and nothing else, layers 2 and 3 sign off.
  const Z = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  const idZ = objectionId('top-gamma', Z);   // the top judge answers its own objection in pass 4 (answer-back), withdrawing it with a quote the draft holds
  const topWithdraws = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id: idZ, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
  const { result, report } = await run({ held: CLOSING, retags: retagTo3(idX), answers: { 'panel-1-raiser-alpha': objects(nw(rated(X))), 'panel-2-raiser-alpha': objects(cont(LOW, rated(X))), 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]), 'panel-3-top-gamma': objects(nw(rated(Z))), 'panel-4-raiser-alpha': objects({ ...rated(X), relation: `reopens ${idX}` }), 'panel-4-top-gamma': topWithdraws } });
  assert.equal(states(report).split(' ').filter(x => x.startsWith('4.')).join(' '), '4.1:signed_off 4.2:signed_off 4.3:signed_off', 'pass 4 climbs from layer 1 again, and the filtered judge counts as clean');
  assert.deepEqual(report.escalations[0].raised_again, [{ pass: 4, lab: LOW, id: idX }]);
  assert.equal(report.passed, false, 'a judge that raised a closed id did not sign off');
  assert.deepEqual(report.escalated_signoff, { pass: 4, layer: 3, below: [], raised_again: [idX] });
  const row = report.signoff.find(s => s.lab === LOW);
  assert.equal(row.signedOff, false);
  assert.deepEqual(row.objections.map(o => [o.id, o.closed_by_ruling]), [[idX, 'overruled']]);
  assert.equal(report.panelVerdicts.find(v => v.round === 4 && v.lab === LOW).verdict, 'objected');
  assert.deepEqual(report.layers.find(x => x.round === 4 && x.layer === 1).raised_again, [idX], 'the layer row keeps the trace');
  assert.ok([].concat(result.history).join('\n').includes(`raised only ${idX}, closed by an earlier ruling (not counted)`), 'the history does not say it signed off');
  assert.equal(result.lastCritique.failures.some(f => f.id === idX), false, 'not in the round\'s failures');
  // ADDED (0.8.4, the SE-14 commit's bar: his option "a" promised 'no extra rounds; the record keeps both the lowering and the overrule'). OLD: SE-14 pinned the pass-4 climb and the raised-again trace but neither promise. NEW: the run ends in pass 4 (no pass 5 or later in the layers record) and report.json keeps both the handling session's lowering (severity.retags) and the layer's overrule (the sign-off row) in one assertion.
  assert.equal(Math.max(...report.layers.map(x => x.round)), 4, 'no extra rounds: the run ends in pass 4');
  assert.deepEqual({ lowering: report.severity.retags.map(r => [r.id, r.from, r.to, r.by, r.pass]), ruling: row.objections.map(o => [o.id, o.closed_by_ruling]) }, { lowering: [[idX, 5, 3, 'handler', 3]], ruling: [[idX, 'overruled']] }, 'the report keeps both: the handling session\'s lowering (severity.retags) and the layer\'s overrule (the raiser\'s sign-off row)');
  assert.equal(report.dispute.reason, 'escalated_signoff');
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.match(renderBoardMd({ runId: 'r-esc', result }), /Raised again by raiser-alpha in pass 4, with a quote; not counted\./);
});

// ADDED (0.8.4 round 1, A3; his answer 6:a, ruled by C&C from the control run CTL1): SE-14's shape with the lowering made by the TOP LAYER instead of the handling session. Layer 3 reads pass 3 (its own objection Z) and its verdict lowers X to 3 (critique.retags); the layer-2 overrule of X in the same pass closes it on the record once X is below 4;
// in pass 4 the raiser reopens X. WITHOUT the fix the reopen minted X#r2 (the entry kept no `by`), counted at rating 5 and held layer 1; now the lowering holds as the handling session's does: the same objection at the lowered rating, a re-raise that counts as heard.
const topLowers = (to, reason = 'A missing limit does not change what is built.') => {
  const Z = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  return JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: Z.problem }], failures: [nw(Z)], verdict_line: 'no', ...(to === null ? {} : { retags: [{ id: idX, severity: to, reason }] }) });
};
const SE14B = (topVerdict) => ({ 'panel-1-raiser-alpha': objects(nw(rated(X))), 'panel-2-raiser-alpha': objects(cont(LOW, rated(X))), 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]), 'panel-3-top-gamma': topVerdict, 'panel-4-raiser-alpha': objects({ ...rated(X), relation: `reopens ${idX}` }),
  'panel-4-top-gamma': JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id: objectionId('top-gamma', { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' }), status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] }) });

test('SE-14b THE TOP LAYER\'S LOWERING holds like the handling session\'s: after layer 3 lowers X below 4 and a layer-2 judge overrules it, the raiser\'s reopen is the same objection, recorded and NOT counted; the run ends in pass 4; the record keeps both', async () => {
  const { report } = await run({ held: CLOSING, answers: SE14B(topLowers(3)) });
  assert.equal(states(report).split(' ').filter(x => x.startsWith('4.')).join(' '), '4.1:signed_off 4.2:signed_off 4.3:signed_off', 'pass 4 climbs from layer 1 again, and the filtered judge counts as clean');
  assert.deepEqual(report.escalated_signoff, { pass: 4, layer: 3, below: [], raised_again: [idX] }, 'the reopen is the same id: no X#r2');
  assert.equal(JSON.stringify(report).includes(`${idX}#r2`), false, 'no second id is minted for the reopen');
  assert.equal(Math.max(...report.layers.map(x => x.round)), 4, 'no extra rounds: the run ends in pass 4');
  const row = report.signoff.find(s => s.lab === LOW);
  assert.deepEqual({ lowering: report.severity.retags.map(r => [r.id, r.from, r.to, r.by, r.pass]), ruling: row.objections.map(o => [o.id, o.closed_by_ruling]) }, { lowering: [[idX, 5, 3, 'layer3', 3]], ruling: [[idX, 'overruled']] }, 'the report keeps both: layer 3\'s lowering and the overrule');
});

test('SE-14c CONTROL (the fix is not wider): with NO lowering, X stays rated 5, the layer-2 overrule closes nothing, and the reopen holds layer 1 as before: no #r2, no lowering in the record', async () => {
  const { report } = await run({ held: CLOSING, answers: SE14B(topLowers(null)) });
  assert.equal(states(report).split(' ').filter(x => x.startsWith('4.')).join(' '), '4.1:objected 4.2:not_asked 4.3:not_asked', 'the original X still holds layer 1 in pass 4');
  assert.deepEqual(report.severity?.retags ?? [], [], 'no lowering is recorded');
  assert.equal(JSON.stringify(report).includes(`${idX}#r2`), false, 'no second id is minted: the overrule closed nothing');
});

test('SE-15 THE CONSENSUS PATH keeps the record (C&C ruling, 27 Okt 2026: (a) as built): after the floor resets, the raiser re-reviews the final text and signs off cleanly, so every judge signed the same draft (passed, consensus); escalations[] stays in report.json and on BOARD.md, and the deliverable gets no escalated sign-off block', async () => {
  const Z = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  const idZ = objectionId('top-gamma', Z);
  const topWithdraws = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id: idZ, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
  // pass 4: layer 1 is asked again from layer 1 (the floor reset) and signs off: its overruled X left its answer-back entry at the ruling, so it is not reminded of it.
  const { result, report, prompts } = await run({ held: CLOSING, retags: retagTo3(idX), answers: { 'panel-1-raiser-alpha': objects(nw(rated(X))), 'panel-2-raiser-alpha': objects(cont(LOW, rated(X))), 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]), 'panel-3-top-gamma': objects(nw(rated(Z))), 'panel-4-top-gamma': topWithdraws } });
  assert.equal(states(report).split(' ').filter(x => x.startsWith('4.')).join(' '), '4.1:signed_off 4.2:signed_off 4.3:signed_off');
  assert.equal(prompts.get('panel-4-raiser-alpha').user.includes(idX), false, 'the raiser is not reminded of the overruled id: it left its answer-back entry at the ruling');
  assert.equal(report.passed, true);
  assert.equal(report.outcome, 'consensus');
  assert.equal(report.escalated_signoff, undefined);
  assert.deepEqual(report.escalations.map(e => [e.round, e.pass, e.outcome.map(o => o.result)]), [[2, 3, ['overruled']]], 'the record of the escalation stays on a consensus ending');
  assert.match(renderBoardMd({ runId: 'r-esc', result }), /## Objections passed up a layer/);
  assert.equal(result.deliverable.includes('## Escalated sign-off'), false, 'no block above the plan for a consensus');
});

// FIX on c8d848bf (C&C, 27 Okt 2026): F1 (only a quoted id is filtered), F2/F3 (the dispute's open set drops what a later ruling or withdrawal closed), F4 (a sustaining seat reads objected), Fable line 4 (one item per id).
const objectsMany = fs => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: fs[0].problem }], failures: fs, verdict_line: 'no' });
const withdrawing = (ids, also = []) => JSON.stringify({ meets: also.length === 0, criteria: [{ criterion: CRITERION, verdict: also.length ? 'FAILED' : 'MET', evidence: 'Section two.' }], failures: also, verdict_line: 'x', answers: ids.map(id => ({ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' })) });

// CHANGED (0.8.4 S5 U-C fix-up, 08 Nov 2026; C&C's ruling on the box run, Q3: the handler's re-tag is a decision that a re-raise does not overturn; the Q12 commit text aee7a579 is silent on whether a re-tag's force survives a counted reopen). OLD: the unquoted re-raise in pass 4 held layer 1 (state objected). NEW: the re-raise inherits the re-tag's rating 3 (the run reads the value in force for the id), so it is counted (raised_again), recorded and in the round's failures, but holds nothing: layer 1 signs off. The top judge also answers its own pass-3 objection Z by withdrawing it, or Z stands unanswered at the last pass and the top-layer stall ends the run (the S5 stop).
// CHANGED ACCEPTED (0.8.4, the SE-14 commit; C&C ruling 12 Nov 2026). OLD: pass 1 and pass 2 carried BOTH unquoted problems in one reply each (without a `relation` field, so the replies were refused and the run never reached the re-tag). NEW: one problem per pass under ONE id: pass 1 raises U1 (`new`), pass 2 repeats the objection with the second problem's words (`continues` the same id), so the two problems are still joined under one id and one escalation item, and the handler's re-tag names the one id that stands. WHY: with a `relation` on each of two `new` problems under one key the assigner gives them two ids (idU and idU#2); the second, never answered and never lowered, held layer 1 in pass 4 (box job 58), which hid the path the row is about: the handler lowers an unquoted objection, layer 2 overrules it, the judge re-raises it unquoted, it is counted and recorded (F1) and holds nothing, layer 1 signs off.
test('SE-16 F1: an UNQUOTED id is never filtered: two unquoted problems under one criterion are one passed-up item; after the floor resets, the raiser\'s unquoted re-raise is counted (raised_again counted: true) and recorded, carrying the handler\'s re-tag it holds nothing', async () => {
  const U1 = { severity: 5, criterion: CRITERION, problem: 'No limit on retries.' }; const U2 = { severity: 5, criterion: CRITERION, problem: 'The limit is not tested.' };
  const idU = objectionId(LOW, U1);
  assert.equal(objectionId(LOW, U2), idU, 'precondition: without a quote both problems share one id');
  const Z = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  const { result, report } = await run({ held: CLOSING, retags: retagTo3(idU), maxRounds: 4, answers: { 'panel-1-raiser-alpha': objects(nw(rated(U1))), 'panel-2-raiser-alpha': objects(cont(LOW, rated(U2))), 'rule-3-mid-beta': rules([{ id: idU, ruling: 'overrule', reason: 'Section two sets it.' }]), 'panel-3-top-gamma': objects(nw(rated(Z))), 'panel-4-raiser-alpha': objects({ ...rated(U2), relation: `reopens ${idU}` }), 'panel-4-top-gamma': withdrawing([objectionId('top-gamma', Z)]) } });
  const [e] = report.escalations;
  assert.deepEqual(e.ids, [idU], 'one item for the one id (the problems are joined)');
  assert.equal(e.outcome.length, 1);
  assert.deepEqual(e.raised_again, [{ pass: 4, lab: LOW, id: idU, counted: true }]);
  assert.equal(report.layers.find(x => x.round === 4 && x.layer === 1).state, 'signed_off', 'the re-raise carries the handler\'s re-tag (3): it is counted but holds nothing, so layer 1 signs off');
  assert.ok(result.lastCritique.failures.some(f => f.id === idU), 'it is in the round\'s failures');
  assert.equal(report.escalated_signoff, undefined);
});

test('SE-17 F2: an undecided id its raiser later WITHDREW is not standing dissent; the block gives its final status in the approved form', async () => {
  const Y = { severity: 5, criterion: CRITERION, problem: 'No owner.', quote: 'The worker' }; const idY = objectionId(LOW, Y);
  const Z = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' }; const idZ = objectionId('top-gamma', Z);
  const { result, report } = await run({ maxRounds: 8, answers: {
    'rule-3-mid-beta': 'not json', 'panel-3-top-gamma': objects(nw(Z)),                       // pass 3: X undecided; the top layer objects, so the floor resets
    'panel-4-raiser-alpha': withdrawing([idX], [nw(Y)]), 'panel-5-raiser-alpha': objects(cont(LOW, Y)),     // pass 4: the raiser withdraws X with a quote and raises Y; pass 5: Y again (a new stall, a second escalation)
    'rule-6-mid-beta': 'not json', 'panel-6-top-gamma': withdrawing([idZ]) } });            // pass 6: Y undecided; the top layer withdraws Z and signs off: an escalated sign-off
  assert.deepEqual(report.escalations.map(e => [e.round, e.ids]), [[2, [idX]], [5, [idY]]]);
  assert.equal(report.dispute.reason, 'escalated_signoff');
  assert.deepEqual(report.dispute.open_objections.map(o => o.id), [idY], 'X was withdrawn in pass 4: it is not standing dissent');
  assert.ok(result.deliverable.includes(`no ruling closed it. Final status: withdrawn by ${LOW} in round 4, quoting the draft.`), result.deliverable.slice(0, 1200));
  assert.ok(result.deliverable.includes(`${idY} (raised by ${LOW}, layer 1: "No owner."): passed up to layer 2 in round 6; no ruling closed it, so it is listed under Unresolved dissent.`));
});

test('SE-18 F3: an OVERRULED id does not come back through the not-asked path after the floor resets', async () => {
  const X2 = { severity: 5, criterion: CRITERION, problem: 'No retry limit.', quote: 'retries failed requests' }; const idX2 = objectionId('mid-beta', X2);
  const Z = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' }; const idZ = objectionId('top-gamma', Z);
  const W = { severity: 5, criterion: CRITERION, problem: 'No backoff.', quote: 'failed requests' }; const idW = objectionId(LOW, W);
  const { report } = await run({ held: CLOSING, retags: retagTo3(idX2), maxRounds: 4, answers: {
    'panel-1-raiser-alpha': meets(), 'panel-2-raiser-alpha': meets(), 'panel-1-mid-beta': objects(nw(rated(X2))), 'panel-2-mid-beta': objects(cont('mid-beta', rated(X2))),   // a layer-2 stall: up to the top layer
    'panel-3-top-gamma': objects(nw(rated(Z))), 'rule-3-top-gamma': rules([{ id: idX2, ruling: 'overrule', reason: 'Section two sets it.' }]),   // the top layer overrules X2 and objects Z: the floor resets
    'panel-4-raiser-alpha': objects(nw(rated(W))) } });                                                                                     // pass 4 (the cap): layer 1 objects, layer 2 is not asked
  assert.equal(report.layers.find(x => x.round === 4 && x.layer === 2).state, 'not_asked');
  const ids = report.dispute.open_objections.map(o => o.id);
  assert.equal(ids.includes(idX2), false, `overruled in pass 3, it must not come back: ${ids}`);
  assert.ok(ids.includes(idZ) && ids.includes(idW), ids.join(' '));
});

test('SE-19 F4: a seat that signed off blind and then SUSTAINED reads objected in panelVerdicts (and so in disagreement_map) and in the history', async () => {
  const { result, report } = await run({ maxRounds: 3, answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'Not stated.' }]) } });
  const pv = report.panelVerdicts.find(v => v.round === 3 && v.lab === 'mid-beta');
  assert.deepEqual([pv.verdict, pv.sustained], ['objected', [idX]]);
  assert.equal(report.disagreement_map.find(r => r.round === 3).labs['mid-beta'], 'objected');
  assert.ok([].concat(result.history).join('\n').includes(`then sustained ${idX} as its own`));
});

// ---- 0.8.4 C7 (Q1(g)(2); RU-S3-50, 53, 55): a layer-1 objection the exchange left NOT DEBATED climbs flagged and is not ruled on.
// Layer 1 = raiser-alpha (objects X in passes 1 and 2) + peer-delta (signs off). In every exchange round the peer contests X and the raiser amends it with new words, so X is amended in the last round that runs: not debated, carried. The stall fires after pass 2.
// The scripts cover every round label (-x2 .. -x7), so the scenario does not depend on how many rounds the exchange runs.
const post = () => JSON.stringify({ posts: [{ on: idX, stance: 'contest', quote: 'retries failed requests', text: 'The plan already bounds it.' }], new_objections: [] });
const amend = tag => JSON.stringify({ replies: [{ id: idX, action: 'amend', text: 'Right in part.', problem: `Narrowed (${tag}): no upper limit on retries is stated.` }] });
const keep = () => JSON.stringify({ replies: [{ id: idX, action: 'keep', text: 'The posts do not change it.' }] });
const OVERRULE = rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]);
const roundLabels = (pass, kind, who, reply) => Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(k => [`${kind}-${pass}${k > 1 ? `-x${k}` : ''}-${who}`, reply(k)]));
const NOT_DEBATED = Object.assign({}, ...[1, 2].flatMap(pass => [roundLabels(pass, 'ldebate', 'peer-delta', post), roundLabels(pass, 'lreply', 'raiser-alpha', k => amend(`${pass}.${k}`))]));
const EX = { peers: ['peer-delta'] };   // 0.8.4: the exchange has no switch; the peer is what lets it run
// (1) the climb: the stall fires after pass 2 and the plan goes up with X still not debated
let flaggedRun; const flagged = () => (flaggedRun ??= run({ ...EX, answers: { ...NOT_DEBATED, 'rule-3-mid-beta': OVERRULE } }));
// CHANGED ACCEPTED (0.8.4 C7 fix-up, C&C's `next` ruling). OLD: the row's `next` was 'debated_after_send_back', a prediction written at the climb. NEW: this run has no send-back, it ends at the escalated sign-off with X standing, so the row reads 'standing_dissent' (derived when the report is written). WHY: the field states the outcome once known, not a prediction.
test('C7 / RU-S3-50, RU-S3-53: an objection left not debated in layer 1 climbs FLAGGED: the escalations row names it and what happens next, and layer 2 is asked to rule on nothing (no rule- call, no ruling, no outcome)', async () => {
  const { report, served } = await flagged();
  const [e] = report.escalations;
  assert.deepEqual([e.ids, e.not_debated, e.rulings, e.outcome, served.filter(l => l.startsWith('rule-'))], [[idX], [{ id: idX, lab: LOW, next: 'standing_dissent' }], [], [], []]);   // this run has no send-back: it ends at the escalated sign-off with X standing, and the row says so (the outcome once known, derived when the report is written)
});
test('C7: the escalations row of a flagged climb is a valid report-v1; a not_debated entry whose next is outside its enum is rejected (known-bad input)', async () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const { report: shared } = await flagged();
  const report = structuredClone(shared);   // the run is shared by the tests below: this test breaks its own copy, never theirs
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  report.escalations[0].not_debated[0].next = 'later';
  assert.equal(validate(report), false);
});
// (2) the send-back: layer 2 signs off in the escalated pass, the TOP layer objects (only its objection resets the floor), the writer revises, and layer 1 is asked again in pass 4.
const Y = { severity: 5, criterion: CRITERION, problem: 'The back-off is not stated.', quote: 'The worker' };
const idYTop = objectionId('top-gamma', Y);   // the top judge's own objection (pass 3): in pass 4 it must answer it (withdraw it with a quote), or it stands unanswered at the last pass and the top-layer stall ends the run (0.8.4 S5 U-C)
const SEND_BACK = { ...NOT_DEBATED, 'panel-3-top-gamma': objects(nw(Y)), 'ldebate-4-peer-delta': post(), 'lreply-4-raiser-alpha': keep() };
let sentBackRun; const sentBack = () => (sentBackRun ??= run({ ...EX, maxRounds: 4, answers: { ...SEND_BACK, 'rule-3-mid-beta': OVERRULE } }));
const pass4 = report => report.layer_debates.find(d => d.pass === 4)?.objections.find(x => x.id === idX);
const counted4 = report => pass4(report)?.posts.filter(p => !p.omitted).length;   // the peer's counted posts: under the loop pass 4 asks a second round, in which the unscripted peer's post is unreadable and its position is carried as an omitted entry
// CHANGED ACCEPTED (0.8.4 C7 fix-up). OLD: pass 4 has a row for X with one post. NEW: the same, and the row says debated_after_send_back. WHY: `next` is now the derived outcome; on the code as it was this element holds too (the value was written at the climb), so it discriminates nothing.
test('C7 (the flag is not a hole): the flagged objection is debated in layer 1\'s first pass after the send-back: pass 4 has a row for it with the peer\'s post on it, and the row says debated_after_send_back', async () => {
  const { report, served } = await sentBack();
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: pass 4's row holds one post. NEW: one COUNTED post (the second round's unreadable post is carried as an omitted entry in the list). WHY: the loop runs a second round.
  assert.deepEqual([served.includes('ldebate-4-peer-delta'), counted4(report), report.escalations[0].not_debated.map(n => n.next)], [true, 1, ['debated_after_send_back']]);
});
// RU-S3-55 (the traced path): on the old code the overrule recorded X as closed while the carry store still handed it to pass 4's exchange, so the record said "overruled" and "debated again" at once.
test('RU-S3-55: no overrule closes a carried not_debated objection: the scripted overrule of X is not recorded, the row says what X does next, and pass 4 debates X as the row said', async () => {
  const { report } = await sentBack();
  const [e] = report.escalations;
  assert.deepEqual([e.outcome.filter(o => o.id === idX).map(o => o.result), e.not_debated?.filter(n => n.id === idX).map(n => n.next), !!pass4(report)], [[], ['debated_after_send_back'], true]);
});
// (3) RU-S3-51 / 53, the send-back half (KB-8: holds on the code as it was): with the ruling words held no ruling is asked on either code, so X is still an open objection of its raiser when layer 1 is asked again in pass 4, and the exchange debates it.
test('RU-S3-51 / 53: with the ruling words held, the send-back run also debates the objection in pass 4 (one post on it)', async () => {
  const { report } = await run({ ...EX, maxRounds: 4, held: { ...Object.fromEntries(RULING_HELD.map(n => [n, undefined])), ...DEMAND }, answers: SEND_BACK });
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4): one COUNTED post (see counted4).
  assert.equal(counted4(report), 1);
});
// `next` is the outcome once known, derived from the record when the report is written (src/escalation.js notDebatedNext), never written at the climb.
test('notDebatedNext: debated after a send-back wins; then withdrawn by its raiser; then standing dissent at the escalated sign-off; otherwise pending (the run stopped before any of these)', () => {
  const entry = { id: idX, lab: LOW }; const esc = { round: 2, pass: 3 };
  const row = (pass, outcome, posts = [{}]) => ({ pass, objections: [{ id: idX, outcome, posts }] });
  const withdrawn = [{ round: 4, id: idX, effect: 'withdrawn' }];
  const end = { pass: 3, layer: 3, below: [1] };
  assert.deepEqual([
    ESC.notDebatedNext(entry, esc, { layerDebates: [row(4, 'stands_contested')], answerBackReplies: withdrawn, escalatedSignoff: end }),
    ESC.notDebatedNext(entry, esc, { answerBackReplies: withdrawn, escalatedSignoff: end }),
    ESC.notDebatedNext(entry, esc, { escalatedSignoff: end }),
    ESC.notDebatedNext(entry, esc, {}),
    ESC.notDebatedNext(entry, esc, { layerDebates: [row(3, 'stands_contested'), row(4, 'stands_contested', [])] }),   // a row at the escalated pass itself, or with no post, is not 'debated after the send-back'
    ESC.notDebatedNext(entry, esc, { layerDebates: [row(4, 'not_debated')] }),   // posts, but amended or named in the last round again: still not debated (the record's own test)
    ESC.notDebatedNext(entry, esc, { answerBackReplies: [{ round: 1, id: idX, effect: 'withdrawn' }, { round: 2, id: idX, effect: 'withdrawn' }] }),   // a withdrawal from before the climb, or in the stalled pass itself, is not 'after'
  ], ['debated_after_send_back', 'withdrawn', 'standing_dissent', 'pending', 'pending', 'pending', 'pending']);
});
test('escalationsWithNext: a row with no flagged objection is returned as it is', () => {
  const rows = [{ round: 2, pass: 3, ids: ['O-aaaaaaaa'], rulings: [], outcome: [] }];
  assert.deepEqual(ESC.escalationsWithNext(rows, {}), rows);
});
// The path that reaches `withdrawn`: after the send-back the answer-back offers the raiser its open objections, and it withdraws the flagged one with a quote from the revised plan.
// CHANGED ACCEPTED (0.8.4 S5 U-C fix-up, 08 Nov 2026). OLD: pass 4 asked layers 2 and 3 once layer 1 had withdrawn X, and the top judge's plain sign-off was enough. NEW: the top judge also withdraws its OWN pass-3 objection (Y) with a quote the draft holds. WHY: a clean sign-off that leaves its own objection unanswered stands as that objection again, and a top-layer objection that stood in two of its verdicts (passes 3, 4) is a stall at the last pass: a stall_stop, not a finished run. The row is about X's `next`, which is unchanged.
test('next, run level: the raiser withdraws the flagged objection in its answer after the send-back: the row reads withdrawn', async () => {
  const { report } = await run({ ...EX, maxRounds: 4, answers: { ...SEND_BACK, 'rule-3-mid-beta': OVERRULE, 'panel-4-raiser-alpha': withdrawing([idX]), 'panel-4-top-gamma': withdrawing([idYTop]) } });
  assert.deepEqual(report.escalations[0].not_debated.map(n => n.next), ['withdrawn']);
});
// BOARD.md is the same record for people: it prints the flagged objection with the SAME derived `next` (one reader).
test('BOARD.md: a flagged objection has its own line with what became of it, from the same derivation as report.json', async () => {
  const { result, report } = await flagged();
  const board = renderBoardMd({ runId: 'r-esc', result });
  assert.ok(board.includes(`- ${idX} (${LOW}): stood unchanged up to pass 2, passed up to layer 2, but layer 1's exchange had not debated it, so layer 2 was not asked to rule on it. The run ended at the escalated sign-off with it still standing.`), board.slice(board.indexOf('## Objections passed up'), board.indexOf('## Objections passed up') + 900));
  assert.equal(report.escalations[0].not_debated[0].next, 'standing_dissent');
  // the intro no longer says the judges ruled on objections when none was ruled on, and the escalated sign-off block (in the deliverable) lists the flagged objection with the same words
  assert.ok(board.includes('whose judges reviewed it, but none of its objections was ruled on, because layer 1\'s exchange had not debated them.'), board.slice(board.indexOf('## Objections passed up'), board.indexOf('## Objections passed up') + 500));
  assert.ok(result.deliverable.includes(`- ${idX} (raised by ${LOW}, layer 1): passed up to layer 2 in round 3, but layer 1's exchange had not debated it, so it was not ruled on. The run ended at the escalated sign-off with it still standing.`), result.deliverable.slice(0, 900));
});
