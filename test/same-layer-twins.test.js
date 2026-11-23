// SAME-LAYER TWINS (0.8.4 seats and retirements unit; C&C's blocking items 2 after the key commit: "two seats of one model on one layer, run through the exchange and one re-ask ... each record carries its own reply; one twin silent, and its layer
// waits for it, never signing off on the other twin's reply"). Twins = the same provider + model + lab on the same layer (plan-claude-council seats Haiku twice on layer 1 and Sonnet twice on layer 2). Offline, mock seats, $0. A reply per stage label is
// served from a label-keyed cache (the technique of test/panel-reasked-record.test.js), so a twin's reply is chosen by its seat key, not by call order.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { estimateChainRows } from '../src/cost.js';
import { pickContestedCriterion } from '../src/chain.js';
import { registerSeatKeys, seatKeyOf } from '../src/seat-key.js';
import * as SK from '../src/seat-key.js';   // the new exports (keepSeatKey, assertSeatKeyed) are read through the namespace, so a tree without them fails those rows alone and not the whole file
import { rethrowControlFlow } from '../src/chain.js';
import { jsonModeSeat } from '../src/exchange-json-mode.js';
import { disagreementMap } from '../src/decision-records.js';
import { rosterAnswersOf } from '../src/answered-by.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });

const criterion = 'It states the assumptions it was written under.';
const signoff = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
const objects = JSON.stringify({ meets: false, criteria: [], failures: [{ criterion, problem: 'No assumptions section.', fix: 'Add one.' }], verdict_line: 'One criterion failed.' });
const UNREADABLE = 'I could not finish my review';
const twin = model => ({ provider: 'mock', model, lab: 'alpha', layer: 1 });
const chainOf = (critics, extra = {}) => ({
  name: 'same-layer-twins', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
// serves `replies(label)` for panel stages (undefined = run live) and records every label the run asked for
async function go(config, replies) {
  const asked = [];
  setCache({ get(label) { asked.push(label); const text = /^panel-/.test(label) ? replies(label) : undefined; return text === undefined ? null : { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 }; } });
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-twins', config });
  return { r, asked };
}
const rowOf = (r, seat, round = 1) => r.panelVerdicts.find(v => v.round === round && v.lab === 'alpha' && (v.seat ?? 'alpha') === seat);

test('TW-1 BOTH TWINS OBJECT AND MEET IN THE EXCHANGE: each twin is its own raiser, with its own objection id, its own exchange post and its own reply', async () => {
  const c = chainOf([twin('mock-exch-contest-keep'), twin('mock-exch-contest-keep'), { provider: 'mock', model: 'mock-critic-script-o-tw1', lab: 'beta', layer: 2 }]);
  const { r } = await go(c, () => undefined);
  const labels = r.stages.map(s => s.label);
  for (const l of ['panel-1-alpha', 'panel-1-alpha-l1-2']) assert.ok(labels.includes(l), `${l} was asked: ${labels.filter(x => /^panel-/.test(x)).join()}`);
  const exch = labels.filter(l => /^(ldebate|lreply)-/.test(l));
  assert.ok(exch.some(l => /^ldebate-1-alpha$/.test(l)) && exch.some(l => /^ldebate-1-alpha-l1-2$/.test(l)), `an exchange post for each twin: ${exch.join()}`);
  assert.equal(new Set(exch).size, exch.length, 'no exchange label is used twice');
  const d = r.layerDebates[0];
  const raisers = d.objections.map(o => o.raised_by).sort();
  assert.deepEqual(raisers, ['alpha', 'alpha-l1-2'], 'two raisers, not one');
  assert.equal(new Set(d.objections.map(o => o.id)).size, 2, 'two objection ids');
  assert.deepEqual([rowOf(r, 'alpha').verdict, rowOf(r, 'alpha-l1-2').verdict], ['objected', 'objected']);
});

test('TW-2 THE TWINS ANSWER DIFFERENTLY: one objects, one signs off; each record carries its own reply and the layer does not sign off', async () => {
  const c = chainOf([twin('mock-exch-contest-keep'), twin('mock-exch-contest-keep'), { provider: 'mock', model: 'mock-critic-script-o-tw2', lab: 'beta', layer: 2 }]);
  const { r } = await go(c, label => (label === 'panel-1-alpha' ? objects : label === 'panel-1-alpha-l1-2' ? signoff : undefined));
  assert.equal(rowOf(r, 'alpha').verdict, 'objected');
  assert.equal(rowOf(r, 'alpha-l1-2').verdict, 'signed_off');
  const texts = new Map(r.stages.filter(s => /^panel-1-alpha(-l1-2)?$/.test(s.label)).map(s => [s.label, s.text]));
  assert.equal(texts.get('panel-1-alpha'), objects);
  assert.equal(texts.get('panel-1-alpha-l1-2'), signoff);
  assert.equal(r.stages.some(s => s.label === 'panel-1-beta'), false, 'layer 2 (beta) was not asked in pass 1: layer 1 did not sign off');
});

test('TW-3 ONE TWIN IS SILENT: it is re-asked under its own label; when it stays silent its layer waits for it and never signs off on the other twin\'s reply', async () => {
  const c = chainOf([twin('mock-critic-script-o-tw3'), twin('mock-critic-script-o-tw3'), { provider: 'mock', model: 'mock-critic-script-o-tw3b', lab: 'beta', layer: 2 }]);
  const { r, asked } = await go(c, label => (/^panel-1-alpha-l1-2/.test(label) ? UNREADABLE : label === 'panel-1-alpha' ? signoff : undefined));
  assert.ok(asked.some(l => /^panel-1-alpha-l1-2-reask\d+$/.test(l)), `the silent twin was re-asked under its own label: ${asked.filter(l => /^panel-/.test(l)).join()}`);
  assert.equal(asked.some(l => /^panel-1-alpha-reask\d+$/.test(l)), false, 'the twin that answered was not re-asked');
  assert.equal(rowOf(r, 'alpha').verdict, 'signed_off');
  assert.equal(rowOf(r, 'alpha-l1-2').verdict, 'unheard', 'the silent twin is unheard, whatever the other twin said');
  assert.equal(rowOf(r, 'alpha-l1-2').reasked, true);
  assert.equal(r.stages.some(s => s.label === 'panel-1-beta'), false, 'layer 2 is not asked while a layer-1 seat is unheard');
  assert.equal(r.passed, false, 'the run did not end agreed');
});

test('TW-4 A TWIN THAT ANSWERS ON THE RE-ASK IS HEARD FROM ITS OWN ANSWER: the first reply unreadable, the re-ask a sign-off; the other twin\'s reply is not borrowed', async () => {
  const c = chainOf([twin('mock-critic-script-o-tw4'), twin('mock-critic-script-o-tw4'), { provider: 'mock', model: 'mock-critic-script-o-tw4b', lab: 'beta', layer: 2 }]);
  const { r } = await go(c, label => (label === 'panel-1-alpha-l1-2' ? UNREADABLE : /^panel-1-alpha-l1-2-reask\d+$/.test(label) ? signoff : label === 'panel-1-alpha' ? signoff : undefined));
  assert.equal(rowOf(r, 'alpha-l1-2').verdict, 'signed_off');
  assert.equal(rowOf(r, 'alpha-l1-2').reasked, true);
  assert.equal(rowOf(r, 'alpha').reasked, false);
  assert.ok(r.stages.some(s => s.label === 'panel-1-beta'), 'both twins signed off, so layer 2 was asked');
});

test('TW-5 THE DISPUTE REVIEW\'S DRY-RUN ROWS CARRY THE SEAT KEY (the label the run uses, which has no layer): twins on one layer and one model on two layers get four distinct rows', () => {
  const c = chainOf([twin('mock-critic-script-o-tw5'), twin('mock-critic-script-o-tw5'), { provider: 'mock', model: 'mock-critic-script-o-tw5b', lab: 'beta', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-o-tw5b', lab: 'beta', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-o-tw5c', lab: 'gamma', layer: 2 }], { dispute: { enabled: true, review: true } });
  for (const maximum of [false, true]) {
    const labels = estimateChainRows(structuredClone(c), { maximum }).map(r => r.label).filter(l => /^dispute-review-/.test(l));
    assert.deepEqual(labels.sort(), ['dispute-review-alpha', 'dispute-review-alpha-l1-2', 'dispute-review-beta', 'dispute-review-beta-l2', 'dispute-review-gamma']);
  }
});

test('TW-6 A TWIN CHAIN WITH NO PERSONA NAMES: the board tells the two seats apart (the model\'s first / second seat on this layer, counted among the seats of that model on that layer, with another lab between them), a seat with no twin reads as before, and no exchange prompt carries the note', async () => {
  const x = model => ({ provider: 'mock', model, lab: 'alpha', layer: 1 });
  const c = chainOf([x('mock-critic-script-x-tw6'), { provider: 'mock', model: 'mock-critic-holdout', lab: 'beta', layer: 1 }, x('mock-critic-script-x-tw6'), { provider: 'mock', model: 'mock-critic-script-x-tw6c', lab: 'gamma', layer: 2 }], { maxRounds: 2, dispute: { enabled: true, stall_rounds: 3 }, answer_back: { enabled: true } });
  const seen = []; setPromptSpy(p => seen.push(p));
  const { r } = await go(c, () => undefined);
  const lines = [...(r.deliverable ?? '').matchAll(/\*Raised by [^\n]*/g)].map(m => m[0]);
  assert.ok(lines.some(l => l.startsWith("*Raised by alpha (layer 1, the model's first seat on this layer), round 1")), lines.join(' | '));
  assert.ok(lines.some(l => l.startsWith("*Raised by alpha (layer 1, the model's second seat on this layer), round 1")), lines.join(' | '));
  assert.ok(lines.some(l => l.startsWith('*Raised by beta, round 1')), 'a seat with no twin reads exactly as before: ' + lines.join(' | '));
  assert.ok(seen.some(q => /^ldebate-/.test(q.label)), 'premise: an exchange ran, so the prompts below were really looked at');
  for (const p of seen.filter(q => /^(ldebate|lreply)-/.test(q.label))) assert.ok(!/seat on this layer/.test(p.system + p.user), `${p.label}: the note stays out of the exchange prompts`);
});

// TW-7: the layer-3 re-tag of a TWIN's objection (the fixture of test/s17-layer3-retag.test.js T21aj, with layer 2 seating the model twice: the first twin meets, the second raises the block). The severity ledger and the re-tag are looked up by the seat KEY;
// before the fix the ledger row was converted to the bare lab first, so the second twin's row was looked up under the first twin's key.
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { SORTING } from './helpers/rating-demand.js';
import { CRITERION } from './helpers/layer-two-run.js';
import * as HB084 from './held-prompts/held-084-b.js';
const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const Y = { criterion: CRITERION, problem: 'No owner is named.' };
const TWIN2 = 'mid-beta-l2-2';   // the seat key of the second seat of the model on layer 2
const idY = objectionId(TWIN2, Y);
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5 };
const idL3 = objectionId('top-gamma', L3F);
const verdictOf = failures => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no' });
const meetsOf = extra => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const rulesOf = (id, reason) => JSON.stringify({ rulings: [{ id, ruling: 'overrule', reason }] });

test('TW-7 LAYER 3 RE-TAGS A TWIN\'S OBJECTION: the re-tag is found under the twin\'s own key, recorded for that seat, and the objection is settled (not re-attributed to the other twin)', async () => {
  const RATE = 5, TO = 3, REASON = 'The seat\'s reason: section two names the owner.';
  const FOUND = 'It reads "The worker retries failed requests."', ABSENT = 'It reads "The worker uses exponential back-off."';
  setHeldForTest({ ...SORTING, goUpRulingSystem: HB084.goUpRulingSystem, goUpRulingUser: HB084.goUpRulingUser, goUpRulingsSection: HB084.goUpRulingsSection, dissentRecordSection: () => '' });
  const script = {
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried no `relation`. NEW: the second twin's first raise says `new`; its repeats in passes 2 and 5 say `continues <id>` (the pass-4 withdrawal quotes a passage the draft does not hold, so it is refused and Y stands); top-gamma's own objection says `new`. WHY: relationRule recorded (src/chain.js relation gate).
    [`panel-1-${TWIN2}`]: verdictOf([{ ...Y, severity: RATE, relation: 'new' }]), [`panel-2-${TWIN2}`]: verdictOf([{ ...Y, severity: RATE, relation: `continues ${idY}` }]),
    'rule-3-top-gamma': rulesOf(idY, 'Section two names the owner.'),
    'panel-3-top-gamma': verdictOf([{ ...L3F, relation: 'new' }]),
    [`panel-4-${TWIN2}`]: meetsOf({ answers: [{ id: idY, status: 'withdrawn', evidence: ABSENT }] }),
    [`panel-5-${TWIN2}`]: verdictOf([{ ...Y, severity: RATE, relation: `continues ${idY}` }]),
    'rule-6-top-gamma': rulesOf(idY, 'Section two names the owner.'),
    'panel-6-top-gamma': meetsOf({ answers: [{ id: idL3, status: 'withdrawn', evidence: FOUND }], retags: [{ id: idY, severity: TO, reason: REASON }] }),
  };
  const served = [];
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return hit(script[label]);
    return hit(label.startsWith('panel-') || label.startsWith('final-read-') ? meetsOf() : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.');
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-tw7', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: writer, reviser: writer, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  let result = null, error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-tw7', log: () => {}, config }); } catch (e) { error = e; }
  const rec = result ?? error?.partial;
  const reply = (rec?.answerBackReplies || []).find(x => x.round === 4 && x.id === idY);
  assert.equal(reply?.effect, 'withdrawal_refused', `premise: the twin's pass-4 withdrawal was refused (the run ended with: ${String(error)}; replies ${JSON.stringify((rec?.answerBackReplies || []).map(x => [x.lab, x.seat, x.round, x.effect, x.id === idY]))}; labels ${served.filter(l => /^(rule|panel-[456])/.test(l)).join(',')})`);
  assert.equal(reply?.seat ?? reply?.lab, TWIN2, 'the reply belongs to the second twin');
  const rt = (rec?.severityRun?.retags || []).find(x => x.id === idY);
  assert.deepEqual([rt?.pass, rt?.from, rt?.to, rt?.by, rt?.cleared_by], [6, RATE, TO, 'layer3', 'retag'], 'the re-tag of the second twin\'s block is recorded');
  assert.deepEqual([rt?.lab, rt?.raiser_seat], ['mid-beta', TWIN2], 'recorded for the second twin (its seat key), not for the first');
  assert.equal(rt?.seat, 'top-gamma', 'the re-tagger (the layer-3 seat) is still named in `seat`');
  assert.equal((rec?.severityRun?.open || []).some(o => o.id === idY), false, 'settled: not open at the end');
});

const twinPair = tag => { const a = { provider: 'mock', model: `mock-critic-script-o-${tag}`, lab: 'alpha', layer: 1 }, b = { ...a }, c = { provider: 'mock', model: `mock-critic-script-o-${tag}c`, lab: 'beta', layer: 1 }; registerSeatKeys({ seats: { critics: [a, b, c] } }); return { a, b, c }; };

test('TW-8a THE ALLOCATOR\'S CONTESTED CRITERION COUNTS SEATS: two twins failing a criterion of two voters is unanimous, two of three is a split', () => {
  const { a, b, c } = twinPair('tw8a');
  const fail = seat => ({ seat, critique: { failures: [{ criterion: 'It states its assumptions.' }] } }), pass = seat => ({ seat, critique: { failures: [] } });
  assert.equal(pickContestedCriterion([fail(a), fail(b)]), null, 'both twins fail it and nobody else votes: unanimous, not a split');
  const split = pickContestedCriterion([fail(a), fail(b), pass(c)]);
  assert.deepEqual([split?.failedBy, split?.votingCount], [['alpha', 'alpha'], 3], 'two of three voters failed it');
});

test('TW-8b THE ROUND MAP OF VERDICTS KEEPS BOTH TWINS: one objected, one signed off, two entries', () => {
  const m = disagreementMap([{ round: 1, lab: 'alpha', verdict: 'objected' }, { round: 1, lab: 'alpha', seat: 'alpha-l1-2', verdict: 'signed_off' }]);
  assert.deepEqual(m[0].labs, { alpha: 'objected', 'alpha-l1-2': 'signed_off' });
});

test('TW-8c TWO EXTERNAL TWINS WITH NO DECLARED MODEL ARE TWO UNVERIFIED SEATS', () => {
  const noModel = rosterAnswersOf([{ provider: 'external', lab: 'alpha', label: 'panel-1-alpha', asked_for: 'claude-code-session' }, { provider: 'external', lab: 'alpha', seat: 'alpha-l1-2', label: 'panel-1-alpha-l1-2', asked_for: 'claude-code-session' }]);
  assert.equal(noModel?.unverified_seats, 2, `two undeclared external twins are two seats: ${JSON.stringify(noModel)}`);
});

test('TW-8d A COPY MADE FOR THE EXCHANGE\'S JSON MODE KEEPS THE TWIN\'S KEY', () => {
  const { b } = twinPair('tw8d');
  assert.equal(seatKeyOf(jsonModeSeat(b, new Set(['alpha']))), 'alpha-l1-2');
});

test('TW-9 A TWIN WITH A PANEL OUTPUT CAP KEEPS ITS OWN LABEL AND RECORD: panelMaxTokens makes a copy of the seat for the call, and the copy still carries the twin\'s key', async () => {
  const c = chainOf([{ ...twin('mock-critic-script-o-tw9'), panelMaxTokens: 3000 }, { ...twin('mock-critic-script-o-tw9'), panelMaxTokens: 3000 }, { provider: 'mock', model: 'mock-critic-script-o-tw9b', lab: 'beta', layer: 2 }]);
  const { r } = await go(c, () => undefined);
  const labels = r.stages.map(s => s.label).filter(l => /^panel-1-alpha/.test(l));
  assert.deepEqual(labels.sort(), ['panel-1-alpha', 'panel-1-alpha-l1-2']);
  assert.deepEqual(r.panelVerdicts.filter(v => v.round === 1 && v.lab === 'alpha').map(v => v.seat ?? 'alpha').sort(), ['alpha', 'alpha-l1-2']);
});

test('TW-10 A KEYED TWIN\'S CUT-OFF RETRY RUNS UNDER ITS OWN KEY: the first reply is cut off at the cap, the bigger-cap retry (a copy of the seat) is recorded for the second twin, not the first', async () => {
  const c = chainOf([twin('mock-critic-script-o-tw10'), twin('mock-critic-script-o-tw10'), { provider: 'mock', model: 'mock-critic-script-o-tw10b', lab: 'beta', layer: 2 }]);
  const cut = '{"meets": true, "criteria": [], "failures": [], "verdict_line":';
  const asked = [];
  setCache({ get(label) {
    asked.push(label);
    if (label === 'panel-1-alpha-l1-2') return { text: cut, provider: 'mock', model: 'm', usage: { input: 0, output: 3000, stop: 'length' }, usd: 0 };
    return null;
  } });
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-tw10', config: c });
  const retry = r.stages.find(s => s.label === 'panel-1-alpha-l1-2-retry');
  assert.ok(retry, `the second twin was asked again with a bigger cap: ${asked.filter(l => /^panel-1/.test(l)).join()}`);
  assert.equal(retry.seat, 'alpha-l1-2', 'the retry\'s record names the second twin');
  assert.equal(r.stages.some(s => s.label === 'panel-1-alpha-retry'), false, 'the first twin was not retried');
});

test('TW-11 A HALF-SAVED RESUME CALLS ONLY THE MISSING TWIN: one twin\'s reply is on disk, the other\'s is not; the saved one is replayed, the missing one is asked (and paid), nothing else of layer 1 is', async () => {
  const c = chainOf([twin('mock-critic-script-o-tw11'), twin('mock-critic-script-o-tw11'), { provider: 'mock', model: 'mock-critic-script-o-tw11b', lab: 'beta', layer: 2 }]);
  setCache({ get: l => (l === 'panel-1-alpha' ? { text: signoff, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 } : null) });
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-tw11', config: c });
  const byLabel = new Map(r.stages.filter(s => /^panel-1-alpha/.test(s.label)).map(s => [s.label, s]));
  assert.deepEqual([...byLabel.keys()].sort(), ['panel-1-alpha', 'panel-1-alpha-l1-2']);
  assert.equal(byLabel.get('panel-1-alpha').cached, true, 'the saved twin\'s reply is replayed, not paid for again');
  assert.notEqual(byLabel.get('panel-1-alpha-l1-2').cached, true, 'the missing twin is asked');
  assert.equal(rowOf(r, 'alpha').verdict, 'signed_off');
  assert.ok(rowOf(r, 'alpha-l1-2'), 'the missing twin has its own verdict');
});

test('TW-12 THE GUARD: a copy of a repeated model\'s seat that lost its key is refused; a keyed copy, the first twin, and a proposer or writer seat of the same lab (no layer) pass', () => {
  const t1 = { provider: 'mock', model: 'mock-critic-script-o-tw12', lab: 'alpha', layer: 1 }, t2 = { ...t1 }, other = { provider: 'mock', model: 'mock-critic-script-o-tw12b', lab: 'beta', layer: 2 };
  const proposer = { provider: 'mock', model: 'mock-critic-script-o-tw12', lab: 'alpha' };
  registerSeatKeys({ seats: { critics: [t1, t2, other], proposers: [proposer] } });
  const { keepSeatKey, assertSeatKeyed } = SK;
  assert.doesNotThrow(() => { assertSeatKeyed(t1); assertSeatKeyed(t2); assertSeatKeyed(other); assertSeatKeyed(proposer); });
  assert.doesNotThrow(() => assertSeatKeyed(keepSeatKey(t2, { ...t2, maxTokens: 10 })), 'a copy that keeps the key');
  assert.equal(seatKeyOf(keepSeatKey(t2, { ...t2, maxTokens: 10 })), 'alpha-l1-2');
  assert.throws(() => assertSeatKeyed({ ...t2, maxTokens: 10 }), /without its seat key/, 'a bare copy is refused loudly');
  assert.throws(() => assertSeatKeyed({ ...t1, maxTokens: 10 }), /without its seat key/, 'the first twin\'s bare copy too');
  assert.doesNotThrow(() => assertSeatKeyed({ ...other, maxTokens: 10 }), 'a seat of a model that is not repeated needs no key');
  assert.doesNotThrow(() => assertSeatKeyed({ ...proposer, maxTokens: 10 }), 'a proposer or writer seat has no layer');
  let caught = null; try { assertSeatKeyed({ ...t2, maxTokens: 10 }); } catch (e) { caught = e; }
  assert.throws(() => rethrowControlFlow(caught), /without its seat key/, 'a stage\'s catch rethrows it: the run fails loudly, the twin is never counted as an unheard seat')
  assert.equal(caught.constructor, Error, 'a plain internal error: not a denied model, a pause or a spending stop');
});
