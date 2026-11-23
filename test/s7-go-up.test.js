// 0.8.4 S7 (Q7, the layer-2 bound go-up; trigger 'layer2_bound'). $0, offline. Rows GU-1, GU-10b, GU-H1 and GU-H2 (commit A1: the pure parts); GU-2, GU-3, GU-10a, GU-11 and GU-13 (commit A2: the hook in src/chain.js); GU-15 and GU-16 (commit A3: the readers and the schema); GU-14 (commit A4: the maximum); GU-21 (commit A6r: the backstop pin for a layered chain with no handling session); GU-4, GU-5, GU-6, GU-7, GU-10c and GU-24 (commit A5: the rest); later commits add more.
// New exports are read through NAMESPACE imports (OR., ES.) so this file LOADS on the old source and a row fails by assertion, not by a load error.
// "go-up" is the feature of this file; it is NOT the ladder of src/ladder.js (a different feature, the pass that starts at a chosen layer): no ladder.js name is used here.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd, renderEscalationsBoard } from '../src/report-shape.js';
import * as LY from '../src/layers.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { objectionId } from '../src/objection-ids.js';
import { estimateChainRows } from '../src/cost.js';
import * as END from '../src/ending.js';
import { CHECK } from './helpers/build-check.js';
import { DEMAND } from './helpers/rating-demand.js';
import { checkT17t, checkT17ak } from './helpers/s8-record-rows.js';
import * as OR from '../src/overseer-rounds.js';
import * as ES from '../src/escalation.js';
import { escalationLastsOnePass } from '../src/stall-book.js';
import * as HB from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';

const stopOf = (kind, why, layer) => ({ kind, why, layer, overseer_round: 1, pass: 3 });

test('GU-1 layer2BoundGoUp is true for the layer-2 revisions stop only; canSendUp (the layer-1 person\'s choice) is untouched', () => {
  assert.equal(typeof OR.layer2BoundGoUp, 'function', 'S7 adds layer2BoundGoUp to src/overseer-rounds.js');
  const yes = stopOf('layer_bound', 'revisions', 2);
  assert.equal(OR.layer2BoundGoUp(yes), true);
  for (const [name, no] of [
    ['layer 1', stopOf('layer_bound', 'revisions', 1)],
    ['a silent seat of layer 2', stopOf('layer_bound', 'unheard', 2)],
    ['the overseer cap', { kind: 'overseer_cap', rounds: 3, cap: 3, overseer_round: 3, pass: 9 }],
    ['a stall stop', { kind: 'stall_stop', why: 'top_layer', top_layer: 3, overseer_round: 1, pass: 4 }],
    ['no stop', null], ['undefined', undefined], ['an empty object', {}],
  ]) assert.equal(OR.layer2BoundGoUp(no), false, name);
  // the person's layer-1 choice keeps its predicate: it is the layer-1 stop, never the layer-2 one
  assert.equal(OR.canSendUp(stopOf('layer_bound', 'revisions', 1)), true);
  assert.equal(OR.canSendUp(yes), false);
  assert.equal(OR.layer2BoundGoUp(stopOf('layer_bound', 'revisions', 1)), false, 'the two predicates never both hold');
});

test('GU-10b the layer-2 bound go-up lasts ONE pass (layer 1 is never parked); the person\'s send_up keeps its lifetime until T4c turns it on', () => {
  assert.equal(escalationLastsOnePass('stall'), true);
  assert.equal(escalationLastsOnePass('layer2_bound'), true, 'S7 (C&C grant H-S7-a): one pass for the new trigger');
  assert.equal(escalationLastsOnePass('send_up'), false, 'T4c\'s switch: untouched by S7');
  assert.equal(escalationLastsOnePass('something_else'), false);
  assert.equal(escalationLastsOnePass(undefined), false);
});

test('GU-H1 the go-up asks for a ruling only when ALL THREE of its own sentences are recorded, and the recorded stall/send_up three do not count for it', () => {
  assert.ok(Array.isArray(ES.GO_UP_HELD), 'S7 adds GO_UP_HELD to src/escalation.js');
  const drafted = Object.keys(HB).filter(n => n.startsWith('goUp')).sort();
  assert.deepEqual([...ES.GO_UP_HELD].sort(), drafted, 'the gate names are exactly the drafted go-up sentences (as held-prompts.test.js pins RULING_HELD for the recorded three)');
  assert.equal(ES.GO_UP_HELD.length, 3);
  const heldOf = names => name => (names.includes(name) ? () => '' : undefined);
  assert.equal(ES.goUpRulingActive(heldOf(ES.GO_UP_HELD)), true);
  assert.equal(ES.goUpRulingActive(heldOf([])), false);
  for (const missing of ES.GO_UP_HELD) assert.equal(ES.goUpRulingActive(heldOf(ES.GO_UP_HELD.filter(n => n !== missing))), false, `without ${missing}`);
  // the two gates are independent: the recorded three (stall, send_up) being live does not turn the go-up's ruling on
  assert.equal(ES.rulingActive(heldOf(ES.RULING_HELD)), true);
  assert.equal(ES.goUpRulingActive(heldOf(ES.RULING_HELD)), false, 'the recorded stall sentences say "stood unchanged": untrue at layer 2\'s bound');
  assert.deepEqual(Object.keys(HESC).filter(n => n.startsWith('goUp')), [], 'no name drafted in two batches');
});

test('GU-H2 (PIN by construction: the held file is a test file in the red tree; drafted test data): the go-up sentences say what is true at layer 2\'s bound, show every rating, and never list a not-debated objection as one to rule on', () => {
  const sys = HB.goUpRulingSystem();
  assert.match(sys, /were still open after layer 2 had used its revisions; they did not necessarily stand unchanged/);
  assert.doesNotMatch(sys, /stood unchanged over consecutive rounds|first layer had used/);
  assert.match(sys, /Objections marked not debated are shown to you below, without an id, and are not ruled on: give them no entry\./);
  const items = [{ id: 'O-aaaa', first_round: 1, rounds: [2, 3], criterion: 'C1', problem: 'P1', severity: 5, quote: 'Q1', declined_reason: 'R1', declined_round: 2 }, { id: 'O-bbbb', first_round: 2, rounds: [3], criterion: 'C2', problem: 'P2' }];
  const user = HB.goUpRulingUser({ request: 'REQ', plan: 'PLAN', items, notDebated: [{ criterion: 'C3', problem: 'P3', severity: 6.5 }, { criterion: 'C4', problem: 'P4' }] });
  assert.match(user, /it was still open when layer 2 had used its revisions in round 3\./);
  assert.match(user, /Severity: 5\./);
  assert.match(user, /Severity: no readable rating\./, 'a missing rating is said, not left out: an unrated objection holds under RT');
  const nd = user.slice(user.indexOf('# Objections marked not debated'));
  assert.doesNotMatch(nd, /## |O-aaaa|O-bbbb/, 'the not-debated section carries no id and no heading');
  assert.match(nd, /Criterion: C3\nProblem: P3\nSeverity: 6\.5\./);
  assert.match(nd, /Criterion: C4\nProblem: P4\nSeverity: no readable rating\./);
  assert.doesNotMatch(HB.goUpRulingUser({ request: 'REQ', plan: 'PLAN', items }), /not debated/, 'with nothing flagged there is no section');
  const rows = [{ id: 'O-aaaa', lab: 'a', layer: 2, first_round: 1, ruled_round: 4, ruled_layer: 3, outcome: 'overruled', reasons: [] }];
  assert.match(HB.goUpRulingsSection({ rows }), /^# Objections ruled on by another layer\n\nThese objections were still open after layer 2 had used its revisions, so the plan was sent up to layer 3 and the judges there ruled on them\. /);
});

// ---- commit A2: the hook. The harness is the one of test/stall-escalation.test.js (the cache stub answers every stage by its label), with layer 2 as the objecting seat and the stall rule switched off (stall_rounds 9), so the only
// thing that can end layer 2's run of revisions is its bound. Layer 1 and layer 3 sign off unless a row says otherwise.
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
const idY = objectionId('mid-beta', Y);
const idG = objectionId('top-gamma', Y);   // the id Y gets when top-gamma sustains it (adopted under the sustainer's own id)
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a failure literal carried no relation and no rating. NEW: every failure of a reply declares its relation ('new' for a first raise, `continues <id>` through `again` for the same seat's repeat in a later pass) and a readable rating (5 unless the literal has its own). WHY: relationRule (W6) and ratingDemand are recorded (K1, K2, K3).
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [{ severity: 5, relation: 'new', ...f }], verdict_line: 'no' });
const again = (f, lab) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const rules = list => JSON.stringify({ rulings: list });
const GOUP = { goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };
const STALL_WORDS = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
// Layer 2 objects with Y in passes 1 and 2 (b2 = 1: pass 1 uses the one layer-2 revision, pass 2 meets the bound).
const BOUND = { 'panel-1-mid-beta': objects(Y), 'panel-2-mid-beta': objects(again(Y, 'mid-beta')) };
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');

async function run({ held = {}, answers = {}, ov = { rounds: 2, bounds: { 1: 1, 2: 1 } }, roundChoices = [], retags = null, stall = 9 } = {}) {
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
  const config = {
    name: 'fixture-go-up', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: stall },
    maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds,
    seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] },
  };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-goup', log: () => {}, config, roundChoices, ...(retags ? { retags } : {}) }).catch(e => { e.served = served; e.prompts = prompts; throw e; });
  return { result, prompts, served, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-goup', chain: 'fixture-go-up', task: 't.md', result, config }))) };
}

test('GU-2 (T8a) layer 2 used its b2 revision and objects again: the plan goes up to layer 3 INSTEAD OF STOPPING - no stop, no revision used, layers 1 and 2 passed over for that one pass, an escalated sign-off follows (words held: layer 3 reviews, nobody rules)', async () => {
  const { report, served } = await run();
  assert.equal(report.stop, undefined, 'no stop is recorded: the run did not stop at layer 2\'s bound');
  assert.equal(states(report), '1.1:signed_off 1.2:objected 1.3:not_asked 2.1:signed_off 2.2:objected 2.3:not_asked 3.1:escalated 3.2:escalated 3.3:signed_off');
  assert.equal(served.includes('revise-2'), false, 'the call uses no revision');
  const [e] = report.escalations;
  assert.deepEqual([report.escalations.length, e.round, e.pass, e.from_layer, e.to_layer, e.trigger, e.ids], [1, 2, 3, 2, 3, 'layer2_bound', [idY]]);
  assert.deepEqual(report.layers.filter(x => x.round === 3 && x.layer < 3).map(x => [x.layer, x.state, x.escalated_by]), [[1, 'escalated', 'layer2_bound'], [2, 'escalated', 'layer2_bound']]);
  assert.deepEqual(report.escalated_signoff, { pass: 3, layer: 3, overseer_round: 1, below: [1, 2] });
  assert.equal(report.escalated_signoff.ladder, undefined, 'never the ladder of src/ladder.js (H6)');
  assert.deepEqual([report.passed, report.outcome], [false, 'no_consensus']);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the go-up words were held, so no ruling was asked and the outcome was [idY, 'undecided', 'prompt_held']. NEW: that held half is removed (K7, SIBLING: GU-4 and GU-5 assert the go-up with its ruling). WHY: goUpRulingSystem, goUpRulingUser, goUpRulingsSection are recorded.
});

test('GU-3 (T8b) layer 3 SUSTAINS the sent-up objection (unrated = 4 or above): it is layer 3\'s own, the writer revises, the overseer round ends and the next round restarts at LAYER 1 (never layer 2)', async () => {
  const withdraws = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id: idG, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
  const { report, served } = await run({ held: GOUP, answers: { 'rule-3-top-gamma': rules([{ id: idY, ruling: 'sustain', reason: 'The owner is not named.' }]), 'panel-4-top-gamma': withdraws } });
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.id, o.result, o.adopted_as?.map(a => [a.lab, a.id])]), [[idY, 'sustained', [['top-gamma', idG]]]]);
  assert.equal(served.includes('revise-3'), true, 'the writer revises for the layer-3 objection');
  assert.equal(served.indexOf('panel-4-raiser-alpha') > served.indexOf('revise-3'), true, 'pass 4 asks layer 1 first');
  assert.equal(/4\.1:escalated/.test(states(report)), false, 'layer 1 is not parked after the go-up pass');
  assert.match(states(report), /4\.1:signed_off 4\.2:signed_off 4\.3:signed_off$/);
  assert.equal(report.layers.find(x => x.round === 4 && x.layer === 1).overseer_round, 2, 'the next overseer round opened');
  assert.equal(report.escalated_signoff, undefined, 'pass 4 was an ordinary sign-off');
});

test('GU-11 the go-up\'s ruling has its OWN gate: the recorded stall words being live do not turn it on; with its three sentences the ruling seats get the go-up prompt (layer 2 had used its revisions, not "stood unchanged"), the rating text, and the raiser\'s lab is hidden', async () => {
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a run with only the stall words asked no go-up ruling (`undecided`, `prompt_held`); and with the go-up words the rating line read `Severity: no readable rating.` NEW: the held half is removed (K7, SIBLING: GU-H1 asserts the go-up's own three-sentence gate), and the rating line reads `Severity: 5.` (K5). WHY: goUpRulingSystem, goUpRulingUser, goUpRulingsSection and ratingDemand are recorded; the objection carries the rating 5 the stub now gives.
  const on = await run({ held: { ...STALL_WORDS, ...GOUP }, answers: { 'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: 'Section two names the owner.' }]) } });
  assert.equal(on.served.includes('rule-3-top-gamma'), true);
  const p = on.prompts.get('rule-3-top-gamma');
  assert.match(p.system, /were still open after layer 2 had used its revisions; they did not necessarily stand unchanged/);
  assert.doesNotMatch(p.system, /stood unchanged over consecutive rounds|first layer had used/);
  assert.match(p.user, /it was still open when layer 2 had used its revisions in round 2\./);
  assert.match(p.user, /Severity: 5\./, 'the objection carries the rating 5 of the stub');
  assert.equal(`${p.system}\n${p.user}`.includes('mid-beta'), false, 'the raiser\'s lab is hidden');
  assert.ok(p.user.includes(idY) && p.user.includes('No owner is named.'));
  assert.deepEqual(on.report.escalations[0].outcome.map(o => [o.id, o.result]), [[idY, 'overruled']]);
});

test('GU-13 (PIN of old records) a recorded FINISH at a layer-2 revision stop still ends the run there, before the go-up is considered', async () => {
  const { report, served } = await run({ roundChoices: [{ choice: 'finish', stop: 'layer_bound:1:2', kind: 'layer_bound', why: 'revisions', layer: 2 }] });
  assert.deepEqual([report.stop.kind, report.stop.why, report.stop.layer, report.stop.chosen], ['layer_bound', 'revisions', 2, 'finish']);
  assert.equal(report.escalations === undefined || report.escalations.length === 0, true, 'nothing went up');
  assert.equal(served.includes('panel-3-top-gamma'), false, 'layer 3 was never asked');
});

test('GU-10a (source pin; the stall book is not observable in a run) a layer-2 go-up marks its objections sent up and does NOT reset the stall book (the top layer\'s counts survive, Q13)', () => {
  const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
  // CHANGED ACCEPTED (0.8.4 M1 COMPLETE U2-1, d947c091: the automatic layer-1 go-up joins the line; found by the box run of 08 Nov 2026, my miss): OLD `stall || layer2_bound`; NEW `stall || layer2_bound || layer1_bound`; WHY: a layer-1 go-up marks its objections sent up too, and still does not reset the book. A send-up that is NOT one of these three (the legacy send_up) still resets it.
  assert.match(src, /if \(trigger === 'stall' \|\| trigger === 'layer2_bound' \|\| trigger === 'layer1_bound'\) stallBook\.markSentUp\(items\); else stallBook\.reset\(\);/);
});

// ---- commit A3: the readers, the schema, the docs. Every existing output (stall only, send_up only, both) stays BYTE-IDENTICAL; the layer-2 go-up adds one clause. The readers' new helper is read through the namespace (ES.).
const ER = (trigger, extra = {}) => ({ round: 2, pass: 3, from_layer: trigger === 'send_up' ? 1 : 2, to_layer: trigger === 'send_up' ? 2 : 3, trigger, ids: ['O-aaaa'], labs: ['mid-beta'], rulings: [], outcome: [{ id: 'O-aaaa', lab: 'mid-beta', layer: 2, first_round: 1, problem: 'No owner is named.', result: 'undecided', why: 'prompt_held' }], ...extra });
const STALL_ROW = { ...ER('stall'), trigger: 'stall' };

test('GU-15a the verdict line\'s cause words: stall only, send_up only and both are byte for byte what they were; a layer-2 go-up adds one clause', () => {
  assert.equal(typeof ES.escalationTriggersOf, 'function', 'S7 adds escalationTriggersOf to src/escalation.js');
  assert.deepEqual(ES.escalationTriggersOf([ER('stall'), ER('send_up'), ER('layer2_bound'), ER('layer2_bound'), { trigger: undefined }]), { stall: 2, send_up: 1, layer2_bound: 2 }, 'a row without a known trigger is a stall');
  const S = 'objections that stood unchanged were passed up';
  const U = "objections that were still open at layer 1's revision limit were sent up";
  const G = "objections of layer 2 that were still open at layer 2's revision limit were sent up";
  assert.equal(ES.escalationCauseWords([]), S);
  assert.equal(ES.escalationCauseWords([STALL_ROW]), S);
  assert.equal(ES.escalationCauseWords([ER('send_up')]), U);
  assert.equal(ES.escalationCauseWords([STALL_ROW, ER('send_up')]), `${S} and others that were still open at layer 1's revision limit were sent up`);
  assert.equal(ES.escalationCauseWords([ER('layer2_bound')]), G);
  assert.equal(ES.escalationCauseWords([STALL_ROW, ER('layer2_bound')]), `${S} and others of layer 2 that were still open at layer 2's revision limit were sent up`);
  assert.equal(ES.escalationCauseWords([STALL_ROW, ER('send_up'), ER('layer2_bound')]), `${S} and others that were still open at layer 1's revision limit were sent up and others of layer 2 that were still open at layer 2's revision limit were sent up`);
});

test('GU-15b the dissent clause, the layer-state words and the BOARD section say what is true for a layer-2 go-up, and the old ones are unchanged', () => {
  assert.equal(ES.escalationStoodWords(STALL_ROW), 'stood unchanged up to pass 2');
  assert.equal(ES.escalationStoodWords(ER('send_up')), 'still open when layer 1 had used its revisions in pass 2');
  assert.equal(ES.escalationStoodWords(ER('layer2_bound')), 'still open when layer 2 had used its revisions in pass 2');
  assert.equal(LY.layerStateWord({ state: 'escalated' }), 'not asked (objections that stood unchanged were passed up a layer)');
  assert.equal(LY.layerStateWord({ state: 'escalated', escalated_by: 'send_up' }), 'not asked (the plan was sent up a layer while its objections were still open)');
  assert.equal(LY.layerStateWord({ state: 'escalated', escalated_by: 'layer2_bound' }), "not asked (the plan was sent up to layer 3 while layer 2's objections were still open)");
  const head = LY.layersHeadline([{ round: 3, layer: 1, labs: ['a'], state: 'escalated', escalated_by: 'layer2_bound' }, { round: 3, layer: 2, labs: ['b'], state: 'escalated', escalated_by: 'layer2_bound' }, { round: 3, layer: 3, labs: ['c'], state: 'objected' }]);
  assert.match(head, /layer 1 was passed over \(the plan went up to layer 3\), layer 2 was passed over \(the plan went up to layer 3\), layer 3 objected/);
  assert.match(LY.layersHeadline([{ round: 3, layer: 1, labs: ['a'], state: 'escalated' }, { round: 3, layer: 2, labs: ['b'], state: 'objected' }]), /layer 1 was passed over \(its objections went up a layer\)/);
  const board = renderEscalationsBoard([ER('layer2_bound')], { pass: 3, layer: 3, below: [1, 2] });
  assert.match(board, /^## Objections passed up a layer\n\nLayer 2's objections were still open after layer 2 had used its revisions, so instead of ending the run the plan was sent up to layer 3 \(layers 1 and 2 were not asked in that pass\), whose judges reviewed it/);
  assert.match(board, /still open when layer 2 had used its revisions in pass 2, passed up to layer 3, not ruled on in pass 3: /, 'an outcome that says prompt_held was not ruled on');
  assert.match(board, /whose judges reviewed it, but none of its objections was ruled on, because the ruling words are not recorded yet\./);
  const ruled = ER('layer2_bound', { outcome: [{ id: 'O-aaaa', lab: 'mid-beta', layer: 2, first_round: 1, problem: 'No owner is named.', result: 'sustained', adopted_as: [{ lab: 'top-gamma', seat: 'top-gamma', id: 'O-gggg' }] }] });
  assert.match(renderEscalationsBoard([ruled]), /whose judges reviewed it and then ruled on them\./);
  assert.match(renderEscalationsBoard([ruled]), /passed up to layer 3, ruled on in pass 3: sustained/);
  assert.match(renderEscalationsBoard([STALL_ROW]), /^## Objections passed up a layer\n\nA lower layer's objections stood unchanged for the stall rule's rounds, so instead of ending the run the plan was passed up a layer, whose judges reviewed it/);
  assert.match(renderEscalationsBoard([ER('send_up')]), /^## Objections passed up a layer\n\nA lower layer's objections were still open after layer 1 had used its revisions, so instead of ending the run the plan was sent up a layer, whose judges reviewed it/);
  assert.match(renderEscalationsBoard([STALL_ROW, ER('send_up')]), /^## Objections passed up a layer\n\nSome of a lower layer's objections stood unchanged for the stall rule's rounds and some were still open after layer 1 had used its revisions, so instead of ending the run the plan was passed up a layer, whose judges reviewed it/);
  assert.match(renderEscalationsBoard([STALL_ROW, ER('layer2_bound')]), /^## Objections passed up a layer\n\nSome objections stood unchanged for the stall rule's rounds, or were still open after layer 1 or layer 2 had used its revisions, so instead of ending the run the plan was passed up a layer, whose judges reviewed it/);
});

test('GU-15c the escalated sign-off block\'s cause sentence: stall only, send_up only and both are byte for byte what they were; the layer-2 go-up and a mix add their clause', () => {
  const block = escalations => ES.escalatedSignoffBlock({ end: { pass: 3, layer: 3, below: [1, 2] }, escalations });
  assert.match(block([STALL_ROW]), /but not every judge did: objections that stood unchanged over consecutive rounds were passed up a layer instead of ending the run\./);
  assert.match(block([ER('send_up')]), /but not every judge did: objections that were still open after layer 1 had used its revisions were sent up a layer instead of ending the run\./);
  assert.match(block([STALL_ROW, ER('send_up')]), /but not every judge did: objections that stood unchanged over consecutive rounds were passed up a layer, and objections that were still open after layer 1 had used its revisions were sent up a layer, instead of ending the run\./);
  assert.match(block([ER('layer2_bound')]), /but not every judge did: objections of layer 2 that were still open after layer 2 had used its revisions were sent up a layer instead of ending the run\./);
  assert.match(block([STALL_ROW, ER('send_up'), ER('layer2_bound')]), /were passed up a layer, objections that were still open after layer 1 had used its revisions were sent up a layer, and objections of layer 2 that were still open after layer 2 had used its revisions were sent up a layer, instead of ending the run\./);
});

test('GU-15d (real run, words held) the records of a go-up say what is true: the final verdict words, the dissent block and the BOARD name the layer-2 go-up, never "stood unchanged"', async () => {
  const { report, result } = await run();
  assert.match(result.deliverable, /but not every judge did: objections of layer 2 that were still open after layer 2 had used its revisions were sent up a layer instead of ending the run\./);
  assert.match(result.deliverable, /it was still open when layer 2 had used its revisions in round 2 and was sent up to layer 3, where no ruling closed it/);
  assert.doesNotMatch(result.deliverable, /stood unchanged/);
  const board = renderBoardMd({ runId: 'r-goup', result });
  assert.match(board, /Layer 2's objections were still open after layer 2 had used its revisions, so instead of ending the run the plan was sent up to layer 3/);
  // REMOVED (0.8.4 apply, K7): only the held-state match `/whose judges reviewed it, but none of its objections was ruled on, because the ruling words are not recorded yet\./` ('the held state says nobody ruled'; job 12 error). `run()` holds `{}`, so the recorded go-up ruling words are in force and layer 3 IS asked (src/chain.js:5998). Sibling (same file): GU-15b above (the board's sentences from rows). KEPT, and RED ON PURPOSE: the next line. FINDING for Builder B (not a K7 removal): in this run the unscripted `rule-3-top-gamma` is answered with the draft text, so the ruling is unreadable; the job-12 board reads 'whose judges reviewed it and then ruled on them' and '... ruled on in pass 3: no ruling closed it (a ruling could not be read)' because src/report-shape.js:467 writes ' and then ruled on them' whenever any outcome has `why !== 'prompt_held'` (and :462 'ruled on' likewise), unreadable_ruling / ruler_unreachable / no_ruling included.
  assert.doesNotMatch(board, /and then ruled on them/);
  // CHANGED ACCEPTED TEST (0.8.4 GU-15d, C&C ruling 12 Nov 2026: a CUT of the false BOARD sentence). OLD: the line above stood alone (red on purpose). NEW: also the row says what the record says ("not ruled on in pass 3: no ruling closed it (a ruling could not be read)") and the record's outcome rows carry the failure and no ruling (why 'unreadable_ruling', result 'undecided'). WHY: report-shape.js now writes "ruled on" (header and row) only for an outcome that has a ruling (sustained or overruled); the record line reads report.json's own rows, so the board and the record cannot say different things. The record line reads report.json, which the cut does not touch: NO RED OF ITS OWN, it pins what held.
  assert.match(board, /passed up to layer 3, not ruled on in pass 3: no ruling closed it \(a ruling could not be read\)/);
  const outs = (report.escalations || []).flatMap(e => e.outcome || []);
  assert.ok(outs.length >= 1 && outs.every(o => o.why === 'unreadable_ruling' && o.result === 'undecided'), `the record carries the failure and no ruling: ${JSON.stringify(outs)}`);
  assert.deepEqual(report.layers.filter(x => x.round === 3 && x.layer < 3).map(x => LY.layerStateWord(x)), Array(2).fill("not asked (the plan was sent up to layer 3 while layer 2's objections were still open)"));
});

test('GU-16 a go-up report is a valid report-v1 (the trigger and escalated_by enums list layer2_bound), and so is one with the ruling and a sustain', async () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  // CHANGED ACCEPTED (0.8.4 M1 COMPLETE U2-2, WORDING D2-2). OLD: the expected trigger enum was ['stall', 'send_up', 'layer2_bound']. NEW: it also lists 'layer1_bound' (the automatic go-up at layer 1's revision bound). WHY: the enum is part of the public schema and the new trigger is additive.
  assert.deepEqual(schema.properties?.escalations?.items?.properties?.trigger?.enum ?? null, ['stall', 'send_up', 'layer2_bound', 'layer1_bound']);
  for (const opts of [{}, { held: GOUP, answers: { 'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: 'Section two names the owner.' }]) } }]) {
    const { report } = await run(opts);
    assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  }
});

// 0.8.4 (apply, C&C ruling 12 Nov 2026: the over-count). The shipped planning chains carry the ladder key, and a ladder run cannot send the go-up ruling calls (no layer bounds, so no layer_bound stop with why 'revisions'; no passUp on a ladder pass). GU-14 above prices the CONVERTED shape (ladder removed, overseer rounds and bounds added) and keeps its rows; this row prices the chains AS SHIPPED and pins that their maximum lists no `rule-bound-` and no `rule-go-up-` row (box job 66 and job 68: the old figure listed 3 + 2 to 5 + 2 of them, $20 to $133 of each upper figure), while the same chain converted lists both kinds.
test('GU-15 (the over-count) the shipped ladder chains list NO rule-bound and NO rule-go-up row in the maximum; the same chain converted to overseer rounds lists both', () => {
  setHeldForTest(null);   // the recorded state, no held map: exactly what ships
  const dir = new URL('../chains/', import.meta.url);
  const ladder = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))).filter(c => 'ladder' in c && c.signoff === 'unanimous' && (c.seats?.critics || []).some(k => k.layer === 3));
  assert.ok(ladder.length >= 7, `the shipped ladder chains were found (${ladder.length})`);
  const isRule = r => /^rule-(bound|go-up)-/.test(r.label);
  for (const c of ladder) {
    assert.deepEqual(estimateChainRows(c, { maximum: true }).filter(isRule).map(r => r.label), [], `${c.name}: as shipped (a ladder) the maximum lists no go-up ruling row`);
    const { ladder: _ladder, ...rest } = c;
    const converted = estimateChainRows({ ...rest, maxOverseerRounds: 7, layerRevisions: { 1: 7, 2: 3 } }, { maximum: true }).filter(isRule).map(r => /^(rule-bound-L2|rule-go-up-L3)-/.exec(r.label)?.[1] ?? r.label);
    assert.deepEqual([...new Set(converted)].sort(), ['rule-bound-L2', 'rule-go-up-L3'], `${c.name}: converted to overseer rounds (a shape where the go-up can fire) it lists both kinds`);
  }
});

// ---- commit A4: the upper estimate. A number inside the maximum, no label on any screen (the dry run prints rows by the EXPECTED pass and joins the maximum rows by label), gated by the same three go-up sentences as the ruling itself.
test('GU-14 (A4) the go-up\'s ruling calls are in the MAXIMUM only once its three sentences are recorded: one row per top-layer seat, once per overseer round; held, no row and no figure moves; the expected figure never changes', () => {
  const dir = new URL('../chains/', import.meta.url);
  const layered = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
    .map(c => ('ladder' in c ? (({ ladder: _ladder, ...rest }) => ({ ...rest, maxOverseerRounds: 7, layerRevisions: { 1: 7, 2: 3 } }))(c) : c))   // FINDING (not on the owed list of the ladder unit; 10 Nov 2026): the shipped planning chains carry the ladder key (no overseer-round keys). These rows test the overseer-round mechanics, so they read each shipped chain as an overseer chain (the key replaced by 7 rounds, bounds 7 and 3), as test/overseer-keys.test.js does.
    .filter(c => c.signoff === 'unanimous' && Number.isInteger(c.maxOverseerRounds) && (c.seats?.critics || []).length && c.seats.critics.every(k => Number.isInteger(k.layer)) && c.seats.critics.some(k => k.layer === 3) && c.seats.critics.some(k => k.layer === 2));
  assert.ok(layered.length >= 7, `the shipped layered chains were found (${layered.length})`);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 8. NEW bar: 7 (seven planning chains left). WHY: the count moves with the thing it counts
  const isGoUp = r => r.label.startsWith('rule-go-up-');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: each shipped chain was priced twice, held (no go-up row, `off`) and with the three sentences, and the rows were compared with each other. NEW: the held half is removed (K7: after the recording no shipped run is held); the rows asserted on the recorded state are unchanged (one row per top-layer seat, its label, once per overseer round). SIBLING: GU-H1 asserts the three recorded sentences are the go-up's own gate. WHY: goUpRulingSystem, goUpRulingUser, goUpRulingsSection are recorded in src/roles.js.
  for (const c of layered) {
    setHeldForTest(GOUP);
    const on = estimateChainRows(c, { maximum: true });
    const extra = on.filter(isGoUp);
    const top = c.seats.critics.filter(k => k.layer === 3);
    assert.equal(extra.length, top.length, `${c.name}: one row per top-layer seat`);
    assert.deepEqual(extra.map(r => r.label).sort(), top.map(k => `rule-go-up-L3-${k.lab || k.provider}`).sort(), `${c.name}: the label is the seat key (the lab string when no seat is registered, as in an estimate)`);
    for (const r of extra) assert.equal(r.times ?? 1, c.maxOverseerRounds, `${c.name}: once per overseer round`);
  }
});

// ---- commit A3b: public text the go-up made untrue. The ten planning chains' descriptions (what list_chains returns) and the chain-schema description say what happens at layer 2's bound.
test('GU-23 (A3b) the shipped planning chains\' descriptions no longer say the run stops at either limit, and say what a ladder run does with the plan instead: it is never sent up a layer ahead of its turn; the schema says layer 2\'s bound sends the plan up to layer 3', () => {
  const dir = new URL('../chains/', import.meta.url);
  const planning = readdirSync(dir).filter(f => f.startsWith('plan-') && f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]);
  // CHANGED ACCEPTED (0.8.4 ladder unit, the ladder is permanent; owed list: 'rows that read the shipped chains' old round fields'; 10 Nov 2026). OLD: the descriptions said "When the overseer-round limit or layer 1's revision limit is reached the run stops ... continue ... or finish" (these chains had overseer rounds). NEW: every shipped planning chain runs the ladder; its description says so, and that the plan is never sent up a layer ahead of its turn.
  assert.ok(planning.length >= 7, `the shipped planning chains (${planning.length})`);
  for (const [f, c] of planning) {
    assert.doesNotMatch(c.description, /When either limit is reached/, f);
    assert.match(c.description, /ladder/, f);
    assert.match(c.description, /never sent up a layer ahead of its turn/, f);
  }
  const schema = JSON.parse(readFileSync(new URL('../config/chain-schema.json', import.meta.url), 'utf8'));
  assert.match(schema.properties.layerRevisions.description, /After layer 1's bound the run stops for the person; after layer 2's the plan goes up to layer 3 instead, while a pass is left \(0\.8\.4\)\./);
  assert.doesNotMatch(schema.properties.layerRevisions.description, /before the run stops for the person/);
});

// ---- commit A6r (Muad 05 Nov 2026, later: every layered chain needs a handling session): A6's "an escalated sign-off with no handling session ends agreed" is reverted; GU-21 is the one pin that stays, the backstop until the lint of the next unit refuses such a chain at load.
const rated = (f, severity = 5) => ({ ...f, severity });
const retagTo3 = (id, pass = 3) => [{ pass, id, severity: 3, reason: 'A missing owner does not change what is built.' }];   // runChain's `retags` stands in for the layer-3 re-tag of the ledger row it is shown (applied when the pass settles, chain.js ~5614, the SAME pass, after the ruling)
const WITH_CHECK = { ...CHECK, ...DEMAND };
test('GU-21 (PIN, the backstop) a layered chain with NO handling session: an escalated sign-off gets no `ending` and is not agreed, whether the build-check wording is live or held (the go-up fixture: Y rated 5, re-tagged to 3, layer 3 overrules it, so nothing is open - the case an agreed rule would have ended agreed; every layered chain has a handling session and chain-lint refuses one without at load; runChain called directly does not lint, so this is the fail-closed backstop)', async () => {   // CHANGED (0.8.4 HS): the title said "until a lint refuses one"; the lint (src/chain-lint.js, layered-no-handling-session) now exists, the assertions are the same
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row ran twice, with the build-check wording live and with it held (`NO_CHECK`). NEW: the held iteration is removed (K7, SIBLING: the live iteration of the same row); the pin stays that a layered chain with no handling session records no `ending` at an escalated sign-off and is not agreed. WHY: buildCheckSystem and buildCheckUser are recorded.
  for (const [name, checks] of [['build-check wording live', WITH_CHECK]]) {
    const { report } = await run({ held: { ...checks, ...GOUP }, retags: retagTo3(idY), answers: { 'panel-1-mid-beta': objects(rated(Y)), 'panel-2-mid-beta': objects(again(rated(Y), 'mid-beta')), 'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: 'Section two names the owner.' }]) } });
    assert.equal(report.escalated_signoff?.layer, 3, `${name}: the run reached the escalated sign-off`);
    assert.equal(report.ending, undefined, `${name}: no ending is recorded`);
    assert.equal(END.isAgreed(report), false, `${name}: the run is not agreed`);
    assert.equal(report.passed, false, `${name}: passed keeps its meaning`);
  }
});

// ---- commit A5: the remaining rows (tests only). GU-9 is SE-10 (test/stall-escalation.test.js, CHANGED in A2). Named gaps, NOT driven: GU-8 (T6d, a layer-2 not_debated item: needs a layer-2 exchange fixture of S6) and GU-17 (a replay of an old-version run folder).
const Z = { criterion: CRITERION, problem: 'The limit is not stated.', quote: 'retries failed requests' };   // a top-layer objection (top-gamma's id), distinct from Y
const withdrawsOf = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
const layer3Rules = ruling => ({ 'rule-3-top-gamma': rules([{ id: idY, ruling, reason: 'Section two names the owner.' }]) });

test('GU-4 (T8c) layer 3 OVERRULES the sent-up objection rated below 4 (the layer-3 re-tag of its ledger row, applied the same pass, after the ruling): the objection is closed, nothing stays open, the escalated sign-off follows and layer 1 is not parked', async () => {
  const { report, result } = await run({ held: { ...DEMAND, ...GOUP }, retags: retagTo3(idY), answers: { 'panel-1-mid-beta': objects(rated(Y)), 'panel-2-mid-beta': objects(again(rated(Y), 'mid-beta')), ...layer3Rules('overrule') } });
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.id, o.result, o.rated, !!o.stays_open]), [[idY, 'overruled', 3, false]]);
  assert.deepEqual(report.escalated_signoff, { pass: 3, layer: 3, overseer_round: 1, below: [1, 2] });
  assert.equal(report.dispute?.ran, false, 'nothing is open, so the dispute stage has nothing to record');
  assert.equal(report.passed, false, 'passed keeps its meaning: not every layer signed the same draft');
  assert.doesNotMatch(result.deliverable, /It stays open/);
});

test('GU-5 layer 3 OVERRULES the sent-up objection rated 5: an overrule closes only below 4, so it STAYS OPEN, is on the record, and the run does not end agreed', async () => {
  const { report, result, served } = await run({ held: { ...DEMAND, ...GOUP }, answers: { 'panel-1-mid-beta': objects(rated(Y)), 'panel-2-mid-beta': objects(again(rated(Y), 'mid-beta')), ...layer3Rules('overrule') } });
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.id, o.result, o.rated, !!o.stays_open]), [[idY, 'overruled', 5, true]]);
  assert.equal(report.dispute?.ran, true);
  assert.equal(report.dispute.open_objections.some(o => o.id === idY), true, 'the objection the ruling did not close is listed');
  assert.match(result.deliverable, /It stays open: it is rated 4 or above/);
  assert.equal(END.isAgreed(report), false);
  // CHANGED ACCEPTED (0.8.4 S8 rulings, T17t and T17ak; this file is S7's): OLD GU-5 asserted the escalation outcome, the open objection, the deliverable line and not-agreed only. NEW four assertions after them (T17t-g1, T17t-g2, checkT17t, checkT17ak): the escalated sign-off record, the layer states of pass 3, no call to the block's seat at the layer-3 sign-off, and the block's layer counted as not signed. WHY: the plan's exit list names these two rows; they are false in the GU-7 and layer-3-objects runs, which is what the red file feeds them. No existing assertion is changed or removed; the run now also returns `served`.
  assert.deepEqual(report.escalated_signoff, { pass: 3, layer: 3, overseer_round: 1, below: [1, 2] }, 'T17t-g1: the run ended at the escalated sign-off of pass 3 (the fixture of GU-4)');
  assert.match(states(report), /3\.1:escalated 3\.2:escalated 3\.3:signed_off$/, 'T17t-g2: layers 1 and 2 were passed over in pass 3 and layer 3 signed');
  checkT17t(served);   // T17t: no call to the block's seat at the layer-3 sign-off
  checkT17ak(report);   // T17ak: the block's layer is counted as not signed (escalated, no signoff[] row)
});

test('GU-6 (T19g) with b2 = 5 the go-up fires on the SIXTH layer-2 objection (after five revisions), and not before', async () => {
  const panels = Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`panel-${n}-mid-beta`, objects(n === 1 ? Y : again(Y, 'mid-beta'))]));
  const { report, served } = await run({ ov: { rounds: 2, bounds: { 1: 1, 2: 5 } }, answers: panels });
  const [e] = report.escalations;
  assert.deepEqual([report.escalations.length, e.round, e.pass, e.from_layer, e.to_layer, e.trigger, e.ids], [1, 6, 7, 2, 3, 'layer2_bound', [idY]]);
  assert.equal(served.includes('revise-5'), true, 'five revisions were used');
  assert.equal(served.includes('revise-6'), false, 'the sixth objection uses none');
  assert.match(states(report), /7\.1:escalated 7\.2:escalated 7\.3:signed_off$/);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state; K2 relation on a repeat): OLD: pass 3's stub `objects(Y)` carried no relation, so it read as the same seat's repeat (and, with the recorded relation gate, as an unreadable reply that left layer 2 silent: the row was green without layer 2's objection ever standing). NEW: pass 3 repeats Y through `again(Y, 'mid-beta')` (`continues <id>`), and a premise assertion on the layer states shows the objection stood in passes 1 to 3 and every layer signed in pass 4. WHY: under the recorded relation rule a `new` for a standing own id is a second objection (`#2`), which the pass-4 withdrawal of idY does not close, so the go-up fired.
test('GU-7 (NEW-A9-1, a PIN by construction) with b2 = 7 three layer-2 objections then a sign-off: no go-up, no escalation, the run is signed by every layer', async () => {
  const { report } = await run({ ov: { rounds: 2, bounds: { 1: 1, 2: 7 } }, answers: { 'panel-3-mid-beta': objects(again(Y, 'mid-beta')), 'panel-4-mid-beta': withdrawsOf(idY) } });   // the third raise of the same objection by the same seat CONTINUES it (a `new` for a standing own id is a second objection, `#2`, which the withdrawal of idY does not close)
  assert.match(states(report), /2\.2:objected .*3\.2:objected .*4\.1:signed_off 4\.2:signed_off 4\.3:signed_off$/, 'premise: layer 2 objected in passes 1 to 3 (its objection stood, repeated, not read as a second one) and every layer signed in pass 4 after its withdrawal');
  assert.equal((report.escalations ?? []).length, 0);
  assert.equal(report.escalated_signoff, undefined);
  assert.equal(report.stop, undefined);
  assert.equal(report.passed, true);
});

test('GU-10c (behavioural; GU-10a is the source pin of the same line) the top layer\'s stall count is KEPT across the go-up pass (Q13): the same top-layer objection raised in passes 1, 4 and 5 (stall window 3) stalls the run at pass 5 (a stall_stop is a stop: the run throws it, with its partial record)', async () => {
  const err = await run({ stall: 3, ov: { rounds: 4, bounds: { 1: 1, 2: 1 } }, answers: {
    'panel-1-mid-beta': meets(), 'panel-1-top-gamma': objects(Z),
    'panel-2-mid-beta': objects(Y), 'panel-3-mid-beta': objects(again(Y, 'mid-beta')),
    'panel-4-top-gamma': objects(again(Z, 'top-gamma')),
    'panel-5-mid-beta': withdrawsOf(idY), 'panel-5-top-gamma': objects(again(Z, 'top-gamma')),
  } }).then(() => null, e => e);
  assert.ok(err?.stop, 'the run stops (it does not finish)');
  assert.equal(err.partial.escalations.some(e => e.trigger === 'layer2_bound' && e.pass === 4), true, 'the go-up happened at pass 4');
  assert.deepEqual([err.stop.kind, err.stop.why, err.stop.top_layer, err.stop.pass], ['stall_stop', 'top_layer', 3, 5]);
  assert.equal(err.served.includes('panel-6-raiser-alpha'), false, 'no pass 6');
});

// GU-24 (real verb, the CLI): copies test/exit-not-agreed.test.js's layered fixture. Layer 2 objects twice ('xxo'), the stall window is set to 9 as run() does (the default 2 would stall layer 2 at the same pass), so with b2 = 1 the plan goes up to layer 3 at pass 3 and layer 3 signs. In the shipped state (the go-up ruling words and the build-check wording not recorded) the run ends NOT agreed.
const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const scripted = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
test('GU-24 (real verb) a CLI run whose layer 2 reaches its bound: exit 22, the verdict line names the layers passed over, report.json records the layer2_bound escalation', t => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-goup-cli-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify({
      name: 'ovc', signoff: 'unanimous', dispute: { stall_rounds: 9 }, maxOverseerRounds: 2, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
        critics: [scripted('o', 'a', 'l1', 1), scripted('xxo', 'b', 'l2', 2), scripted('o', 'c', 'l3', 3)] },
    }));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const r = spawnSync(process.execPath, [cliPath, '--chain', 'ovc', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
    t.diagnostic(`GU-24 exit ${r.status}; ${(r.stdout.split('\n').find(l => /verdict:/.test(l)) ?? '(no verdict line)').trim()}`);
    assert.equal(r.status, 22, r.stdout + r.stderr);
    assert.match(r.stdout, /verdict: +escalated sign-off: the top layer signed off after .*\(layers 1, 2 were passed over\), NOT agreement of the whole panel/);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs')).sort()[0]);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.deepEqual(report.escalations.map(e => e.trigger), ['layer2_bound']);
    assert.equal(report.passed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
