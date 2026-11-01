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
import * as HESC from './held-prompts/held-escalation.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const X = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const LOW = 'raiser-alpha';   // a distinctive lab name, so "the prompt does not name the raiser" cannot pass by accident
const idX = objectionId(LOW, X);
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const rules = (list) => JSON.stringify({ rulings: list });
// Layer 1 objects with X in passes 1 and 2 (the stall); the writer declines X in revise-1 with a reason; layers 2 and 3 sign off whenever asked unless a row overrides it.
const BASE = { 'panel-1-raiser-alpha': objects(X), 'panel-2-raiser-alpha': objects(X), 'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idX}: The limit is set in section two.` };

async function run({ held = INJECT, answers = {}, maxRounds = 6, ov = null, upper = ['mid-beta'], stall = 2 } = {}) {
  const prompts = new Map(); const served = [];
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const script = { ...BASE, ...answers };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return script[label] === null ? null : { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = {
    name: 'fixture-escalation', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: stall },
    ...(ov ? { maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds } : { maxRounds }),
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), ...upper.map(l => seat(l, 2)), seat('top-gamma', 3)] },
  };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-esc', log: () => {}, config }).catch(e => { e.served = served; e.prompts = prompts; throw e; });
  return { result, prompts, served, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-esc', chain: 'fixture-escalation', task: 't.md', result, config }))) };
}
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');

test('SE-1 OVERRULE: a layer-1 stall passes the plan up; layer 2 reviews blind, then rules; an overrule closes the id and the top layer\'s sign-off is an ESCALATED sign-off (passed false, outcome not widened)', async () => {
  const { result, report, prompts, served } = await run({ answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]) } });
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

test('SE-2 SUSTAIN beside an OVERRULE: one seat sustains and one overrules, so the id is SUSTAINED and adopted by the sustaining seat alone, under its own id; that seat\'s signoff row does not read clean; the floor holds', async () => {
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
  assert.equal(states(report).includes('4.1:escalated'), true, 'pass 4 still starts at the floor: layer 1 waits for the top layer\'s verdict');
  assert.deepEqual(report.escalated_signoff, { pass: 4, layer: 3, below: [1] });
  // Outside review D5: the sustained line ends on the adopted objection's FINAL status, read from the record (here: withdrawn with a quote in pass 4).
  assert.ok(result.deliverable.includes(`sustained in round 3 by mid-beta (layer 2), whose objection it then was (${idB}). Final status: withdrawn by mid-beta in round 4, quoting the draft.`), result.deliverable.slice(0, 900));
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
  const { report, served } = await run({ held: Object.fromEntries(RULING_HELD.map(n => [n, undefined])) });
  assert.equal(served.some(l => l.startsWith('rule-')), false);
  assert.ok(served.includes('panel-3-mid-beta'));
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.result, o.why]), [['undecided', 'prompt_held']]);
  assert.equal(report.dispute.reason, 'escalated_signoff');
});

test('SE-7 a stall at the TOP layer ends the loop as before (dispute reason "stalled", no escalation)', async () => {
  const { report } = await run({ answers: { 'panel-1-raiser-alpha': meets(), 'panel-2-raiser-alpha': meets(), 'panel-1-top-gamma': objects(X), 'panel-2-top-gamma': objects(X) } });
  assert.equal(report.escalations, undefined);
  assert.equal(report.dispute.reason, 'stalled');
  assert.equal(report.dispute.stall_rounds, 2);
});

test('SE-8 a stall on the LAST pass ends the loop as before: no pass is left to escalate into', async () => {
  const { report } = await run({ maxRounds: 2 });
  assert.equal(report.escalations, undefined);
  assert.equal(report.dispute.reason, 'stalled');
});

test('SE-9 the stall window starts fresh after an escalation: the pass right after the escalated one cannot stall again at once', async () => {
  // layer 2 sustains, then objects with the same adopted objection in passes 3 and 4: the earliest new stall compares passes 3 and 4 (r+1, r+2), so it fires in pass 4 and escalates to layer 3.
  const { report } = await run({ answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'Not stated.' }]), 'panel-3-mid-beta': objects(X), 'panel-4-mid-beta': objects(X) } });
  assert.deepEqual(report.escalations.map(e => [e.round, e.from_layer, e.to_layer]), [[2, 1, 2], [4, 2, 3]]);
});

test('SE-10 a STOP keeps the record: on a chain with overseer rounds, a sustained objection uses a layer-2 revision, and the stop at layer 2\'s bound carries escalations[] in its partial record', async () => {
  // pass 4: layer 2 objects with a DIFFERENT objection (the same one twice would be a new stall, which fires before the bound: SE-9), so advance() meets layer 2's bound of one revision, used by the sustain in pass 3.
  const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  const err = await run({ ov: { rounds: 1, bounds: { 1: 1, 2: 1 } }, answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'Not stated.' }]), 'panel-4-mid-beta': objects(Y) } }).then(() => null, e => e);
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, err.stop.why, err.stop.layer], ['layer_bound', 'revisions', 2]);
  assert.deepEqual(err.partial.escalations.map(e => e.outcome.map(o => o.result)), [['sustained']]);
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
  const Z = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  const idZ = objectionId('top-gamma', Z);   // the top judge answers its own objection in pass 4 (answer-back), withdrawing it with a quote the draft holds
  const topWithdraws = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id: idZ, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
  const { result, report } = await run({ answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]), 'panel-3-top-gamma': objects(Z), 'panel-4-raiser-alpha': objects(X), 'panel-4-top-gamma': topWithdraws } });
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
  assert.equal(report.dispute.reason, 'escalated_signoff');
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.match(renderBoardMd({ runId: 'r-esc', result }), /Raised again by raiser-alpha in pass 4, with a quote; not counted\./);
});

test('SE-15 THE CONSENSUS PATH keeps the record (C&C ruling, 27 Okt 2026: (a) as built): after the floor resets, the raiser re-reviews the final text and signs off cleanly, so every judge signed the same draft (passed, consensus); escalations[] stays in report.json and on BOARD.md, and the deliverable gets no escalated sign-off block', async () => {
  const Z = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  const idZ = objectionId('top-gamma', Z);
  const topWithdraws = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id: idZ, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
  // pass 4: layer 1 is asked again from layer 1 (the floor reset) and signs off: its overruled X left its answer-back entry at the ruling, so it is not reminded of it.
  const { result, report, prompts } = await run({ answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]), 'panel-3-top-gamma': objects(Z), 'panel-4-top-gamma': topWithdraws } });
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

test('SE-16 F1: an UNQUOTED id is never filtered: two unquoted problems under one criterion are one passed-up item; after the floor resets, the raiser\'s unquoted re-raise counts as a live objection (raised_again counted: true)', async () => {
  const U1 = { criterion: CRITERION, problem: 'No limit on retries.' }; const U2 = { criterion: CRITERION, problem: 'The limit is not tested.' };
  const idU = objectionId(LOW, U1);
  assert.equal(objectionId(LOW, U2), idU, 'precondition: without a quote both problems share one id');
  const Z = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
  const { result, report } = await run({ maxRounds: 4, answers: { 'panel-1-raiser-alpha': objectsMany([U1, U2]), 'panel-2-raiser-alpha': objectsMany([U1, U2]), 'rule-3-mid-beta': rules([{ id: idU, ruling: 'overrule', reason: 'Section two sets it.' }]), 'panel-3-top-gamma': objects(Z), 'panel-4-raiser-alpha': objects(U2) } });
  const [e] = report.escalations;
  assert.deepEqual(e.ids, [idU], 'one item for the one id (the problems are joined)');
  assert.equal(e.outcome.length, 1);
  assert.deepEqual(e.raised_again, [{ pass: 4, lab: LOW, id: idU, counted: true }]);
  assert.equal(report.layers.find(x => x.round === 4 && x.layer === 1).state, 'objected', 'the unquoted re-raise counts: layer 1 objects');
  assert.ok(result.lastCritique.failures.some(f => f.id === idU), 'it is in the round\'s failures');
  assert.equal(report.escalated_signoff, undefined);
});

test('SE-17 F2: an undecided id its raiser later WITHDREW is not standing dissent; the block gives its final status in the approved form', async () => {
  const Y = { criterion: CRITERION, problem: 'No owner.', quote: 'The worker' }; const idY = objectionId(LOW, Y);
  const Z = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' }; const idZ = objectionId('top-gamma', Z);
  const { result, report } = await run({ maxRounds: 8, answers: {
    'rule-3-mid-beta': 'not json', 'panel-3-top-gamma': objects(Z),                       // pass 3: X undecided; the top layer objects, so the floor resets
    'panel-4-raiser-alpha': withdrawing([idX], [Y]), 'panel-5-raiser-alpha': objects(Y),     // pass 4: the raiser withdraws X with a quote and raises Y; pass 5: Y again (a new stall, a second escalation)
    'rule-6-mid-beta': 'not json', 'panel-6-top-gamma': withdrawing([idZ]) } });            // pass 6: Y undecided; the top layer withdraws Z and signs off: an escalated sign-off
  assert.deepEqual(report.escalations.map(e => [e.round, e.ids]), [[2, [idX]], [5, [idY]]]);
  assert.equal(report.dispute.reason, 'escalated_signoff');
  assert.deepEqual(report.dispute.open_objections.map(o => o.id), [idY], 'X was withdrawn in pass 4: it is not standing dissent');
  assert.ok(result.deliverable.includes(`no ruling closed it. Final status: withdrawn by ${LOW} in round 4, quoting the draft.`), result.deliverable.slice(0, 1200));
  assert.ok(result.deliverable.includes(`${idY} (raised by ${LOW}, layer 1: "No owner."): passed up to layer 2 in round 6; no ruling closed it, so it is listed under Unresolved dissent.`));
});

test('SE-18 F3: an OVERRULED id does not come back through the not-asked path after the floor resets', async () => {
  const X2 = { criterion: CRITERION, problem: 'No retry limit.', quote: 'retries failed requests' }; const idX2 = objectionId('mid-beta', X2);
  const Z = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' }; const idZ = objectionId('top-gamma', Z);
  const W = { criterion: CRITERION, problem: 'No backoff.', quote: 'failed requests' }; const idW = objectionId(LOW, W);
  const { report } = await run({ maxRounds: 4, answers: {
    'panel-1-raiser-alpha': meets(), 'panel-2-raiser-alpha': meets(), 'panel-1-mid-beta': objects(X2), 'panel-2-mid-beta': objects(X2),   // a layer-2 stall: up to the top layer
    'panel-3-top-gamma': objects(Z), 'rule-3-top-gamma': rules([{ id: idX2, ruling: 'overrule', reason: 'Section two sets it.' }]),   // the top layer overrules X2 and objects Z: the floor resets
    'panel-4-raiser-alpha': objects(W) } });                                                                                            // pass 4 (the cap): layer 1 objects, layer 2 is not asked
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
