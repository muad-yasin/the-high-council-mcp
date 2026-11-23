// 0.8.4 M1 COMPLETE, unit U2 (T4c, N5), commit U2-1 (run control; HELD behind `layerOneGoUpLine`): the AUTOMATIC go-up at layer 1's revision bound. Layer 1 uses its b1 revisions and still objects: instead of the resumable stop, the plan goes up for ONE pass (layer 1 is not asked, layer 2 reviews and rules on layer 1's open
// objections with the existing `sendUp` ruling sentences, the layers above review if layer 2 signs off), the pass after restarts at layer 1. COUNT RULE (one place): layer 1's count `used[1]` STAYS after the go-up. $0, offline, runChain direct. Fixture = the go-up fixture of test/s7-go-up.test.js with layer 1 as the objecting seat (b1 = 1).
// Rows GL-5 (the go-up, its record, its words, the restart), GL-2/3 (T7g and T7h), GL-9 (the report validates), GL-credit (the ladder's credit passes), GL-1 (T4c: the not_debated climb, flagged and not ruled on, plus unresolved_at_bound), GL-5c (a second go-up at once: the count stays; layer 2 sustained and revised in between), GL-6b (held: the stop as today), GL-7 (a recorded finish wins), GL-7b (a recorded legacy send_up takes the legacy branch: one row, trigger send_up), GL-12 (lifetime and word tables), GL-14 (source pins: the count-rule site, the layer-1-only target).
// NOT DRIVEN (named): T4c's "layer 2 is shown it with its rating" half (layer 2's REVIEW section, N24: untraced for the go-up pass; it needs ratings and the rating demand), T7i (it tests the PN reading, layer 2's allowance per RUN; the code is PR, `used[2]` resets at each overseer verdict: the open P1 on Muad's list), the stop standing when no pass is left (the `round < maxRounds` guard is the S7 block's own), the ladder with a LIVE pass (the layer-1 bound is never reached, chain.js `ladderObjected`); [header corrected in U2-2: in the ladder's CREDIT passes the stop CAN occur and the go-up fires, GL-credit below drives it, T7i is NOT DRIVEN: it tests the PN reading (layer 2's allowance per RUN) and the code is PR (`used` resets at each overseer verdict, overseer-rounds.js advance())].
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped } from '../src/chain.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { reportJsonShape } from '../src/report-shape.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import * as ES from '../src/escalation.js';   // namespace import: the file still loads on a tree without isLayerOneUp (a staged red), the rows fail by assertion
const { escalationTriggersOf, escalationStoodWords } = ES;
import { layerStateWord } from '../src/layers.js';
import { escalationLastsOnePass } from '../src/stall-book.js';
import * as HB from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../src/chain.js'), 'utf8');

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
// A2 (C&C 07 Nov 2026): the go-up fires only on a chain with the ledger (answer_back) AND the rating demand, so every fixture rates its objections and holds `ratingDemand` (a failure with no rating is refused under the demand). The ratings (5) change nothing else: a 5 holds the sign-off and an overrule leaves it open, like an unrated one.
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation. NEW: each carries relation 'new' (a first raise by that seat); a repeat of a standing objection by the same seat carries `continues <id>` (`repeats` below). WHY: relationRule is recorded (src/chain.js:5462); a `new` on a standing id mints #2 and the go-up never sees the same objection again.
const X = { criterion: CRITERION, problem: 'No retry limit is stated.', quote: 'The worker', severity: 5, relation: 'new' };
const Z = { criterion: CRITERION, problem: 'No back-off is stated.', quote: 'retries failed requests', severity: 5, relation: 'new' };   // CHANGED ACCEPTED (second box run, 08 Nov 2026). OLD: quote 'The worker', the same as X's. NEW: its own quote (a substring of DRAFT). WHY: the objection id hashes the seat, the criterion and the quote and not the problem text (src/objection-ids.js), so Z had X's id; GL-5c's pass-4 objection was then a re-raise of the id layer 2 had sustained, the raiser filter dropped it, and layer 1 signed off. Only GL-5c uses Z.
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5, relation: 'new' };
const repeats = (lab, f) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const idX = objectionId('raiser-alpha', X); const idL3 = objectionId('top-gamma', L3F); const idXmid = objectionId('mid-beta', X);
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const withdrawsOf = (...ids) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: ids.map(id => ({ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' })) });
const rules = list => JSON.stringify({ rulings: list });
const REASON = 'Section two sets the limit.';
const GO_UP_LINE = { layerOneGoUpLine: HB.layerOneGoUpLine, ...DEMAND };   // the line AND the rating demand (A2: both gate the go-up; DEMAND is the recorded ratingDemand)
const LINE_ONLY = { layerOneGoUpLine: HB.layerOneGoUpLine };
const BOUND = { 'panel-1-raiser-alpha': objects(X), 'panel-2-raiser-alpha': objects(repeats('raiser-alpha', X)) };

async function run({ held = GO_UP_LINE, answers = {}, roundChoices = [], ov = { rounds: 2, bounds: { 1: 1, 2: 1 } }, ladder = null, answerBack = true } = {}) {
  const prompts = new Map(); const served = []; const lines = [];
  setPromptSpy(p => prompts.set(p.label, p));
  setHeldForTest(held);
  const script = { ...BOUND, ...answers };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    const text = label in script ? script[label] : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-l1-go-up', criteria: [CRITERION], signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}), dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds, ...(ladder ? { maxRounds: 4 } : {}),   // ADDED (the ladder unit, commit 2): a ladder run has no derived pass ceiling any more, so this fixture carries its own bound (4 passes; both ladder rows end by their sign-off at pass 3 or 4)
    seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  let result; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-l1', log: m => lines.push(m), config, roundChoices, ...(ladder ? { ladder } : {}) }); } catch (e) { error = e; }
  const report = result ? JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-l1', chain: config.name, task: 't.md', result, config }))) : null;
  return { result, report, error, prompts, served, lines };
}
const rowOf = (report, round, layer) => report.layers.find(l => l.round === round && l.layer === layer);

test('GL-5 (N5, RU-ADD-O1; this is NOT T4c, which is the not-debated climb): layer 1 uses its revision and objects again: no stop, no second revision; the plan goes up for ONE pass (layer 1 not asked, layer 2 reviews and rules with the sendUp sentences), and the pass after restarts at layer 1', async () => {
  const answers = { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: REASON }]), 'panel-3-top-gamma': objects(L3F), 'panel-4-raiser-alpha': withdrawsOf(idX), 'panel-4-top-gamma': withdrawsOf(idL3) };
  const { report, error, served, prompts, lines } = await run({ answers });
  assert.equal(error, null, String(error));
  assert.equal(report.stop, undefined, 'no stop is recorded');
  const [e] = report.escalations;
  assert.deepEqual([report.escalations.length, e.trigger, e.from_layer, e.to_layer, e.round, e.pass, e.ids], [1, 'layer1_bound', 1, 2, 2, 3, [idX]]);
  assert.deepEqual([rowOf(report, 3, 1).state, rowOf(report, 3, 1).escalated_by], ['escalated', 'layer1_bound']);
  assert.equal(served.includes('revise-2'), false, 'the call uses no revision');
  assert.equal(served.includes('panel-3-raiser-alpha'), false, 'layer 1 is not asked in the go-up pass');
  assert.ok(served.includes('rule-3-mid-beta'), 'layer 2 rules');
  assert.ok(prompts.get('rule-3-mid-beta').system.includes('were still open after the first layer had used all the revisions it was allowed'), 'the sendUp variant of the ruling sentence');
  assert.ok(lines.some(l => l.includes('The plan goes up to layer 2 instead of stopping') && l.includes('In round 3 layer 1 is not asked')), lines.join('\n'));
  assert.ok(served.includes('panel-4-raiser-alpha') && rowOf(report, 4, 1).state !== 'escalated', 'one pass: layer 1 is asked again in round 4 and is not parked');
});

test('GL-2/GL-3 (T7g, T7h): layer 2\'s revision is spent, then the layer-1 go-up that layer 2 sustains: no layer-2 revision, the plan goes up to layer 3 with the objection (the S7 go-up takes over), and layer 1 is asked no more than b1 + b2 + 1 times', async () => {
  const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', severity: 5, relation: 'new' }; const idY = objectionId('mid-beta', Y);
  const answers = { 'panel-1-mid-beta': objects(Y), 'panel-2-raiser-alpha': objects(X), 'panel-3-raiser-alpha': objects(repeats('raiser-alpha', X)), 'panel-4-mid-beta': withdrawsOf(idY),
    'rule-4-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'The limit is not stated.' }]), 'rule-5-top-gamma': rules([{ id: idXmid, ruling: 'overrule', reason: REASON }]) };
  const { report, error, served } = await run({ held: { ...GO_UP_LINE, goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection }, answers: { ...answers, 'panel-1-raiser-alpha': meets() } });
  assert.equal(error, null, String(error));
  assert.deepEqual(report.escalations.map(e => e.trigger), ['layer1_bound', 'layer2_bound']);
  assert.deepEqual(served.filter(l => l.startsWith('revise-')), ['revise-1', 'revise-2'], 'T7g: no layer-2 revision beyond its bound (revise-4 would be one)');
  assert.ok(served.filter(l => /^panel-\d+-raiser-alpha$/.test(l)).length <= 3, 'T7h: layer 1 is asked at most b1 + b2 + 1 = 3 times');
});

test('GL-5c (count rule, BOX RISK: long fixture): layer 2 sustained and revised, layer 1 objects again with a NEW objection: it goes up AGAIN at once, with no second layer-1 revision (layer 1\'s count stays)', async t => {
  const answers = { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'The limit is not stated.' }]), 'panel-4-raiser-alpha': objects(Z),
    'rule-5-mid-beta': rules([{ id: objectionId('raiser-alpha', Z), ruling: 'overrule', reason: REASON }]), 'panel-5-mid-beta': withdrawsOf(idXmid) };
  const { report, error, served } = await run({ answers });
  t.diagnostic(('GL-5c dx ' + JSON.stringify({ escalations: (report?.escalations ?? []).map(e => [e.trigger, e.pass]), layers: (report?.layers ?? []).map(l => `${l.round}.${l.layer}:${l.state}`).join(' ') })).slice(0, 600));   // TEST-ONLY diagnostic: the values the deepEqual below compares
  assert.equal(error, null, String(error));
  assert.deepEqual(report.escalations.map(e => [e.trigger, e.pass]), [['layer1_bound', 3], ['layer1_bound', 5]], JSON.stringify(report.escalations.map(e => [e.trigger, e.pass])));
  assert.deepEqual(served.filter(l => l.startsWith('revise-')), ['revise-1', 'revise-3'], 'layer 1 revised once (round 1); the other revision is layer 2\'s (round 3)');
});

// REMOVED (0.8.4 apply, K7): GL-6b (held) ran with `held: {}` and expected the layer-1 bound to stop the run "without the go-up line"; job 12 error 'null' (`assert.ok(error instanceof RoundStopped)`, line 105): `layerOneGoUpLine` is recorded (src/roles.js:37), so `{}` falls through to the recorded line and the go-up fires (src/chain.js:6676 layerOneGoUpLineOn). The held-off state no longer exists. Sibling (same file): GL-5 (the go-up with the recorded line), and the stop itself as it still happens is driven by GL-A2a/b's answer_back-off half.

test('GL-7: a recorded `finish` at the stop ends the run there, not agreed, and the go-up does not fire; a recorded LEGACY send_up for the stop takes the legacy branch (one row, trigger send_up) and the automatic branch does not also fire', async () => {
  const stop = { kind: 'layer_bound', why: 'revisions', layer: 1, overseer_round: 1, pass: 2, bound: 1 };
  const fin = await run({ roundChoices: [roundChoiceEntry(stop, 'finish')] });
  assert.equal(fin.error, null, String(fin.error));
  assert.equal(fin.report.escalations, undefined);
  assert.equal(fin.report.passed, false);
  const legacy = await run({ roundChoices: [roundChoiceEntry(stop, 'send_up')], answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: REASON }]) } });
  assert.equal(legacy.error, null, String(legacy.error));
  assert.deepEqual(legacy.report.escalations.map(e => e.trigger), ['send_up'], 'one row, the legacy trigger');
  assert.equal(legacy.lines.some(l => l.includes('The plan goes up to layer 2 instead of stopping')), false, 'the automatic line was not written');
});

test('GL-12: the lifetime switch (one pass for the automatic go-up, the legacy send_up keeps its own) and the word tables read layer1_bound like the send-up', () => {
  assert.equal(escalationLastsOnePass('layer1_bound'), true);
  assert.equal(escalationLastsOnePass('send_up'), false, 'the legacy lifetime for an older run');
  assert.equal(ES.isLayerOneUp?.('layer1_bound'), true); assert.equal(ES.isLayerOneUp?.('send_up'), true); assert.equal(ES.isLayerOneUp?.('layer2_bound'), false); assert.equal(ES.isLayerOneUp?.('stall'), false);
  assert.deepEqual(escalationTriggersOf([{ trigger: 'layer1_bound' }, { trigger: 'send_up' }, { trigger: 'stall' }]), { stall: 1, send_up: 2, layer2_bound: 0 });
  assert.equal(escalationStoodWords({ trigger: 'layer1_bound', round: 2 }), escalationStoodWords({ trigger: 'send_up', round: 2 }));
  assert.equal(layerStateWord({ state: 'escalated', escalated_by: 'layer1_bound' }), layerStateWord({ state: 'escalated', escalated_by: 'send_up' }));
});

test('GL-14 (source pins): the count-rule site assigns nothing to ovState and names the alternative line; the target is computed from layer-1 failures and passUp is called with layerOnly 1; the not_debated flag has no trigger term', () => {
  const m = /if \(layer1BoundGoUp\(stop\)[\s\S]*?\n            \}\n/.exec(src);
  assert.ok(m, 'the automatic block is found');
  assert.doesNotMatch(m[0].replace(/\/\/[^\n]*/g, ''), /ovState\s*=/, 'the block makes no assignment to ovState: layer 1\'s count stays');
  assert.match(m[0], /allFailures\.filter\(f => layerOf\[f\.lab\] === 1\)/);
  assert.match(m[0], /passUp\(up, 'layer1_bound', \[round\], null, 1\)/);
  assert.match(src, /ovState = \{ \.\.\.ovState, used: \{ \.\.\.ovState\.used, 1: 0 \} \};/, 'the alternative is written next to the rule, as a comment');
  const flagged = /const flagged = items\.filter\([^\n]*\);/.exec(src);
  assert.ok(flagged && !/trigger/.test(flagged[0]), 'GL-1p: the climb flags a not_debated objection whatever the trigger');
});

const schema = JSON.parse(readFileSync(resolve(here, '../schemas/report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateAll = ajv.compile(schema);

test('GL-9: the report of a go-up run validates (the enums learn layer1_bound); the schema declares the trigger, escalated_by and unresolved_at_bound', async () => {
  const answers = { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: REASON }]) };
  const { report, error } = await run({ answers });
  assert.equal(error, null, String(error));
  assert.ok(validateAll(report), JSON.stringify(validateAll.errors));
  assert.ok(schema.properties.escalations.items.properties.trigger.enum.includes('layer1_bound'));
  assert.ok(schema.properties.layers.items.properties.escalated_by.enum.includes('layer1_bound'));
  assert.equal(schema.properties.escalations.items.properties.unresolved_at_bound.type, 'array');
});

test('GL-credit: with the ladder\'s CREDIT passes (credit 2) the layer-1 stop occurs in the plain pass 2 and the go-up fires there; pass 3 is the first ladder pass, whose floor (2, ladder.js newLadderState) equals the go-up\'s: layer 1 stays unasked, layer 2 rules (BOX RISK: ladder + overseer rounds together)', async () => {
  const answers = { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: REASON }]) };
  const { report, error, served, lines } = await run({ answers, ladder: { block: 1, visits: 1, credit: 2, exchange: 0 } });
  assert.equal(error, null, String(error));
  assert.deepEqual(report.escalations.map(e => [e.trigger, e.pass]), [['layer1_bound', 3]]);
  assert.equal(rowOf(report, 3, 1).state, 'escalated');
  assert.equal(served.includes('panel-3-raiser-alpha'), false);
  assert.ok(served.includes('rule-3-mid-beta'));
  assert.ok(lines.some(l => l.includes('ladder: pass 3 starts at layer 2')), lines.filter(l => /ladder/.test(l)).join('\n'));
});

test('GL-1 (T4c; BOX RISK: the mock exchange family, mocks count their asks in the process): a pass that ends at the layer-1 bound with an objection first named in round 7 of its own exchange (e3 is unheard in pass 1, so its seventh post is in the bound pass): it climbs FLAGGED not_debated and is NOT ruled on; the objection still changing at the exchange\'s stop travels with unresolved_at_bound', async () => {
  const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
  const config = { name: 'l1-t4c', signoff: 'unanimous', answer_back: { enabled: true }, maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seat('mock-exch-support-keep-always', 'e1', 1), seat('mock-exch-alt-keep-clean', 'e2', 1), seat('mock-exch-new7-keep-clean-late-t4c', 'e3', 1), seat('mock-critic-x', 'e9', 2), seat('mock-critic-x', 'e10', 3)] } };   // three layers: layer 2 is the MIDDLE layer, as in the spec (a two-layer chain would land the go-up on the top layer: the W41/dissent reach, not T4c)
  setHeldForTest(GO_UP_LINE);   // the line + the rating demand (A2); the mock judges rate on their own once the prompt demands it
  setCache({ invalidate() {}, get(label) { return label.startsWith('rule-') ? { text: rules([]), provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 } : null; } });   // only the layer-2 ruling is scripted (no ruling: everything stays standing); every other stage is the mock family itself
  let result; try { result = await runChain({ request: 'A mock task.', runId: 'r-t4c', log: () => {}, config }); } catch (e) { assert.fail(`premise: the run must reach the go-up, got ${e}`); }
  const first = result.layerDebates.find(d => d.pass === 2);   // the BOUND pass's own exchange: e3 is unheard in pass 1 (`-late-`, its post counter stays at 0), so its 7th post lands in round 7 of pass 2
  const x7 = first?.objections.find(o => o.from_exchange && o.added_round === 3);
  assert.equal(x7?.outcome, 'not_debated', 'premise: the bound pass\'s own exchange left the round-7 objection not debated');
  const e = result.escalations?.[0];
  assert.equal(e?.trigger, 'layer1_bound', 'premise: layer 1 objected in pass 2 and the go-up fired');
  assert.ok(e.ids.includes(x7.id), 'premise: the round-7 objection WENT UP with the plan, so the flag below is what keeps it from being ruled on');
  assert.ok(e.not_debated?.some(n => n.id === x7.id), 'it climbs flagged not_debated');
  assert.equal(e.outcome.some(o => o.id === x7.id), false, 'layer 2 does not rule on it');
  assert.equal(e.rulings.some(r => r.id === x7.id), false);
  assert.ok((e.unresolved_at_bound ?? []).length >= 1, JSON.stringify(e.unresolved_at_bound));
});

test('GL-1b (T4c, the "shown with its rating" half; BOX RISK: the rating demand + answer_back + the mock exchange family together): in the go-up pass layer 2 is NOT asked to rule on the flagged objection, but its REVIEW prompt (the L2 section, N24) lists it, open, with its rating', async () => {
  const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
  const config = { name: 'l1-t4c-shown', signoff: 'unanimous', answer_back: { enabled: true }, maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seat('mock-exch-support-keep-always-t4d', 'e1', 1), seat('mock-exch-alt-keep-clean-t4d', 'e2', 1), seat('mock-exch-new7-keep-clean-late-t4d', 'e3', 1), seat('mock-critic-x', 'e9', 2), seat('mock-critic-x', 'e10', 3)] } };   // own model strings (the process-wide ask counters are keyed by the model string): GL-1b does not depend on GL-1 running first
  const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, p));
  setHeldForTest(GO_UP_LINE);
  setCache({ invalidate() {}, get(label) { return label.startsWith('rule-') ? { text: rules([]), provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 } : null; } });
  let result; try { result = await runChain({ request: 'A mock task.', runId: 'r-t4d', log: () => {}, config }); } catch (e) { assert.fail(`premise: the run must reach the go-up, got ${e}`); }
  const x7 = result.layerDebates.find(d => d.pass === 2)?.objections.find(o => o.from_exchange && o.added_round === 3);
  assert.equal(x7?.outcome, 'not_debated', 'premise');
  const e = result.escalations?.[0];
  assert.ok(e?.trigger === 'layer1_bound' && e.ids.includes(x7.id) && e.not_debated?.some(n => n.id === x7.id), 'premise: the go-up fired and the objection went up flagged');
  assert.equal(e.outcome.some(o => o.id === x7.id), false, 'layer 2 does not rule on it');
  const review = prompts.get('panel-3-e9')?.user;
  assert.ok(review, 'premise: layer 2 was asked in the go-up pass');
  const entry = new RegExp(`<prior-review ref="${x7.id}"[\\s\\S]*?</prior-review>`).exec(review)?.[0];
  assert.ok(entry, 'layer 2\'s review lists the flagged objection (the L2 section)');
  assert.match(entry, /open\. Severity: \d/, 'open, with its rating');
});

test('GL-A2a/b (the gate, C&C\'s ruling A2): the go-up fires only where layer 2 is shown the climb: without answer_back the layer-1 bound stops the run exactly as before, even with the go-up line recorded', async () => {
  const noAnswerBack = await run({ answerBack: false });
  assert.ok(noAnswerBack.error instanceof RoundStopped, `answer_back off: ${noAnswerBack.error}`);
  assert.deepEqual([noAnswerBack.error.stop.kind, noAnswerBack.error.stop.layer], ['layer_bound', 1]);
  assert.equal(noAnswerBack.served.some(l => l.startsWith('rule-')), false);
  // REMOVED (0.8.4 apply, K7): the `noDemand` half (`run({ held: LINE_ONLY })`, expected the stop). Job 12 error 'rating demand not recorded: null' (line 216): `ratingDemand` is recorded (src/roles.js:37), so a map that leaves it out falls through to the recorded demand and the go-up fires. Setting it to undefined is the banned HELD_OFF map. Sibling (same test): the answer_back-off half above (the stop where layer 2 is not shown the climb) and the `both` control below (the go-up with both gates on).
  const both = await run({ answers: { 'rule-3-mid-beta': rules([{ id: idX, ruling: 'overrule', reason: REASON }]) } });
  assert.equal(both.error, null, `control (both gates on): ${both.error}`);
  assert.equal(both.report.escalations[0].trigger, 'layer1_bound');
});

// REMOVED (0.8.4 apply, K7): job 12 row 'GL-A2c (GL-1b's control; BOX RISK, own model strings): with the rating demand NOT recorded the T4c fixture does not go up: the run stops at layer 1's bound'. OLD: the T4c fixture (five mock exchange seats, answer_back on) with `setHeldForTest(LINE_ONLY)` (the go-up line, NO rating demand) asserted the run stops at layer 1's bound (RoundStopped, layer_bound, layer 1). WHY: error 'null' at assert.ok(error instanceof RoundStopped, String(error)) (test line 231): the run did not stop. `ratingDemand` is RECORDED (src/prompts/recorded-084-b.js), so a map that leaves it out falls through to the recorded function (src/held-roles.js:15) and the go-up fires (src/chain.js:6676: layer1BoundGoUp(stop) && callGates.goUpOn && layerOneGoUpLineOn()). NO_DEMAND (`ratingDemand: undefined`, test/helpers/rating-demand.js) is the held-off state, banned for 0.8.4 names, and no config switches the demand off: ratingsDemanded (src/ratings-demand.js:11) = ratingsRecorded(config) (src/severity.js:147: signoff unanimous and every critic layered) && the recorded word, and the T4c fixture's exchange exists only on a layered unanimous chain (chain-lint.js:1119). Sibling: 'GL-1b (T4c, the "shown with its rating" half ...)' in this file, the same T4c fixture with the demand recorded, where the go-up fires and layer 2's review lists the flagged objection with its rating. (The row GL-A2a/b in this file has a held-off half of its own and is red for the same cause; it is not in my list.)

// ---- l2l (0.8.4, C&C 08 Nov 2026): the layer-2 go-up on a LADDER chain. Harness = this file's run() (the ladder and the log lines are captured); the fixture is S7's GU-2/GU-3 shape: layer 2 objects Y in passes 1 and 2 (b2 = 1), which meets the bound inside the two credit passes; layer 1 signs off; layer 3 sustains Y in pass 3.
const L2L_Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', severity: 5, relation: 'new' };   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: no rating, no relation. NEW: severity 5 (the rating demand) and relation 'new'; the second raise in the credit test continues it. WHY: ratingDemand and relationRule are recorded.
const L2L_idY = objectionId('mid-beta', L2L_Y);
const L2L_idG = objectionId('top-gamma', L2L_Y);   // the id Y gets when top-gamma sustains it
const L2L_GOUP = { goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };

test('GL-L2-credit: with the ladder\'s CREDIT passes (credit 2) layer 2 meets its bound in pass 2 and the plan goes up to layer 3: pass 3, the first ladder pass, asks layer 3 ONLY (layers 1 and 2 escalated), layer 3 sustains, pass 4 starts at layer 1 and the layer-3 visit is counted', async () => {
  const answers = {
    'panel-1-raiser-alpha': meets(), 'panel-2-raiser-alpha': meets(),
    'panel-1-mid-beta': objects(L2L_Y), 'panel-2-mid-beta': objects(repeats('mid-beta', L2L_Y)),
    'rule-3-top-gamma': rules([{ id: L2L_idY, ruling: 'sustain', reason: 'The owner is not named.' }]),
    'panel-4-top-gamma': withdrawsOf(L2L_idG),
  };
  const { report, error, served, lines } = await run({ held: L2L_GOUP, answers, ladder: { block: 1, visits: 2, credit: 2, exchange: 0 } });
  assert.equal(error, null, String(error));
  assert.equal(report.stop, undefined, 'no stop is recorded');
  const [e] = report.escalations;
  assert.deepEqual([report.escalations.length, e.trigger, e.round, e.pass, e.from_layer, e.to_layer, e.ids], [1, 'layer2_bound', 2, 3, 2, 3, [L2L_idY]]);
  assert.deepEqual([rowOf(report, 3, 1).state, rowOf(report, 3, 2).state, rowOf(report, 3, 3).state], ['escalated', 'escalated', 'objected']);
  assert.equal(served.includes('panel-3-raiser-alpha'), false, 'layer 1 is not asked in pass 3');
  assert.equal(served.includes('panel-3-mid-beta'), false, 'layer 2 is not asked in pass 3');
  assert.ok(served.includes('panel-3-top-gamma'), 'layer 3 is asked');
  assert.deepEqual(e.outcome.map(o => [o.id, o.result]), [[L2L_idY, 'sustained']]);
  assert.ok(lines.some(l => l.includes('ladder: pass 3 starts at layer 3')), lines.filter(l => /ladder/.test(l)).join('\n'));
  assert.ok(lines.some(l => l.includes('ladder: pass 4 starts at layer 1 (layer-1 revisions in this block 0 of 1, layer-2 visits 0 of 2, layer-3 visits 1)')), lines.filter(l => /ladder/.test(l)).join('\n'));
  assert.deepEqual([rowOf(report, 4, 1).state, rowOf(report, 4, 2).state, rowOf(report, 4, 3).state], ['signed_off', 'signed_off', 'signed_off']);
  assert.equal(report.escalated_signoff, undefined, 'pass 4 was an ordinary sign-off');
});
