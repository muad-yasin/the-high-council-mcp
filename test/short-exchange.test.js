// 0.8.4 S6 (M1), U6-2: the SHORTENED exchange at layers 2 and 3 in a run (Q5, D4, W5, W14; T6b exchange half, T6c, T6e, T6f). Offline, mock seats only, $0. WRITTEN WITHOUT A RUN (overnight, no box).
// The switch is the PAIR W5 + W14 (src/short-exchange.js): every row that needs the exchange injects it (setHeldForTest). The rows of the held state are PINS: nothing of S6 exists there, so they are green on the old source by design.
// FIXTURE: layer 1 = ONE clean seat (one seat means no layer-1 exchange; it signs off), layer 2 = the raiser `r2` (`mock-exch-support-keep`: objects blind, keeps) and its peers, layer 3 = ONE clean seat; one pass (maxRounds 1), so a layer-2 objection ends the run at the cap and layer 3 is not asked.
// `mock-exch-<post>-<reply>[-clean]` (src/providers.js): `-clean` signs off blind and still posts; every row asserts that a layer_debates row with `layer: 2` exists, or it would pass vacuously on a tree without the exchange. No counter-based mock is used, so no model string needs its own tag.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule };
const W26 = { lateFindingRule: HB084.lateFindingRule, lastRoundReplyRule: HB084.lastRoundReplyRule };
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = (critics, extra = {}) => ({
  name: 'short-exchange', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async (config, held = PAIR) => {
  const lines = []; const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-short-exchange', config });
  return { r, log: lines.join('\n'), prompts };
};
const labels = r => r.stages.map(s => s.label);
const exch = r => labels(r).filter(l => /^(ldebate|lreply)-/.test(l));
const verdictOf = (r, round, lab) => r.panelVerdicts.find(v => v.round === round && v.lab === lab);
const L1 = seat('mock-exch-support-keep-clean', 'l1', 1);
const TOP = seat('mock-exch-support-keep-clean', 't3', 3);
const layer2 = (...seats) => seats.map(([model, lab]) => seat(model, lab, 2));
const rowAt = (r, layer) => (r.layerDebates ?? []).find(d => d.layer === layer);

// REMOVED (0.8.4 apply, recorded state; K7): 'PIN (held): with the pair not recorded, or only one of W5 and W14, a layer-2 objection draws no exchange and no sign-off record'. A held-state row: shortExchangeRule and signoffLineRule are recorded, so shortExchangeOn() (src/short-exchange.js:7) is true in every shipped run. Sibling: 'T6c (Q5)' just below and the other rows of this file, which assert the shortened exchange at layer 2 (a layer_debates row with `layer: 2`, exchange calls) on the recorded state.

test('T6c (Q5): every closure in the shortened exchange carries its reason: an argued withdrawal closes the objection and signs the judge off, a withdrawal with no reason closes nothing (an invalid reply, no reply recorded) and the objection stands', async () => {
  const closed = await go(chainOf([L1, ...layer2(['mock-exch-support-withdraw', 'r2'], ['mock-exch-contest-keep-clean', 'p1']), TOP]));
  const d = rowAt(closed.r, 2);
  assert.ok(d, 'a layer_debates row at layer 2');
  const [o] = d.objections;
  assert.equal(o.outcome, 'withdrawn_argued');
  assert.deepEqual([o.reply.action, typeof o.reply.text, o.reply.text.length > 0], ['withdraw', 'string', true], 'the closure carries its reason');
  for (const row of closed.r.layerDebates) for (const x of row.objections) if (x.outcome === 'withdrawn_argued') assert.ok(x.reply?.text, `${x.id}: a closure with no recorded reason`);
  assert.equal(verdictOf(closed.r, 1, 'r2').exchange_cleared, true, 'the judge counts as signed off after the exchange');
  assert.ok(labels(closed.r).includes('panel-1-t3'), 'layer 2 signed off, so layer 3 is asked');
  const unargued = await go(chainOf([L1, ...layer2(['mock-exch-support-withdraw-unargued', 'r2'], ['mock-exch-contest-keep-clean', 'p1']), TOP]));
  const [u] = rowAt(unargued.r, 2).objections;
  // CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R07; a record row). OLD: the withdrawal with no reason is recorded as a keep, unargued: `u.reply.unargued === true` (a throw on the tip: there is no reply). NEW: it closes nothing (the objection stands, contested), its record carries no reply and the flag {kind 'raiser_reply_invalid', round 1, action 'withdraw', requirement 'withdraw_no_reason'}, and the judge still reads objected. WHY: layerReplyAnchorRule is recorded since dc60423a, so a withdrawal with no reason is an invalid reply (src/layer-debate.js, strict), not a keep; src/chain.js records the flag and no reply for it.
  assert.notEqual(u.outcome, 'withdrawn_argued', 'a withdrawal with no reason closes nothing');
  assert.equal(u.outcome, 'stands_contested', 'the objection stands');
  assert.equal(u.reply, undefined, 'no reply is recorded for it');
  assert.deepEqual(u.flags, [{ kind: 'raiser_reply_invalid', round: 1, action: 'withdraw', requirement: 'withdraw_no_reason' }], 'it is recorded as an invalid reply, with its requirement');
  assert.equal(verdictOf(unargued.r, 1, 'r2').verdict, 'objected');
});

test('T6f (Q5): a post that fails its check is in the record as no view with its refusal reason, the real contest is in the minority notes, the raiser\'s reply is recorded; and a raiser whose only post is no view is still asked', async () => {
  const bad = await go(chainOf([L1, ...layer2(['mock-exch-support-keep', 'r2'], ['mock-exch-contestbad-keep-clean', 'cb'], ['mock-exch-contest-keep-clean', 'cg']), TOP]));
  const [o] = rowAt(bad.r, 2).objections;
  const refused = o.posts.find(p => p.by === 'cb');
  assert.deepEqual([refused.stance, refused.counted, refused.why, refused.asked], ['no_view', false, 'quote_not_in_plan', 'contest'], 'the refused post is kept, as no view, with why');
  assert.equal(o.posts.find(p => p.by === 'cg').stance, 'contest');
  assert.deepEqual(o.minority_notes.map(n => n.by), ['cg'], 'the real contest is the minority note; the refused one is not');
  assert.equal(o.reply.action, 'keep', 'the reply is recorded');
  const silent = await go(chainOf([L1, ...layer2(['mock-exch-support-keep', 'r2'], ['mock-exch-noview-keep-clean', 'nv']), TOP]));
  assert.ok(labels(silent.r).includes('lreply-1-r2'), 'the raiser replies once whatever its posts drew (here only an explicit no view): the reply carries the sign-off line');
  const [s] = rowAt(silent.r, 2).objections;
  assert.ok(s.posts.some(p => p.by === 'nv' && p.stance === 'no_view'), 'the post that was made is in the record');
  assert.equal(s.reply.action, 'keep');
});

// T6b, the exchange half (the sign-off line is READ and RECORDED here; what a "no" does at the top layer is U6-5's, G7): layer 3 is the top layer with two judges, the raiser `r3` and `q3`; layers 1 and 2 are one clean seat each.
const topPair = (model, extra = []) => chainOf([L1, seat('mock-exch-support-keep-clean', 'l2', 2), seat(model, 'r3', 3), seat('mock-exch-support-keep-clean', 'q3', 3), ...extra]);
const panelCalls = (r, lab) => labels(r).filter(l => new RegExp(`^panel-\\d+-${lab}(-|$)`).test(l));

test('T6b (exchange half): a layer-3 judge withdraws its only objection and ends its reply with the sign-off line: the line is recorded with what the computed rule says, the judge is signed off and is NOT asked again blind on the same draft', async () => {
  const { r } = await go(topPair('mock-exch-support-withdraw-signoffyes'));
  const d = rowAt(r, 3);
  assert.ok(d, 'a layer_debates row at layer 3');
  assert.equal(d.objections[0].outcome, 'withdrawn_argued');
  assert.deepEqual(d.signoffs, [{ seat: 'r3', line: 'yes', field: 'missing', said: 'yes', differs: false, computed: 'signs', against_computed: false }]);
  assert.deepEqual(panelCalls(r, 'r3'), ['panel-1-r3'], 'one blind ask of the seat, none again on the same draft');
  assert.equal(verdictOf(r, 1, 'r3').exchange_cleared, true);
  assert.equal(verdictOf(r, 1, 'r3').verdict, 'signed_off');
});

test('T6b (record): what a raiser said is recorded whatever it says; where the line and the JSON field differ the record says so and "no" is what it said; a garbled line is no answer; a line that goes against the computed rule is flagged', async () => {
  const said = async model => { const { r } = await go(topPair(model)); return rowAt(r, 3).signoffs[0]; };
  // CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R08; a record row). OLD: the two records of a "no" over a judge the rule lets sign off (the first and the third below) are the plain object. NEW: each carries `re_asked: { result: 'objects', objections: ['O-ede280f7'], re_raised: ['O-ede280f7'] }`, the re-ask it drew (the judge was asked once more for its verdict and objected again, re-raising the one objection). WHY: signoffRefusedReaskNote is recorded since dc60423a, so the re-ask of src/chain.js (refusedSignoffs) runs in every shipped run; the object is copied from a printed run.
  const REASKED = { result: 'objects', objections: ['O-ede280f7'], re_raised: ['O-ede280f7'] };
  assert.deepEqual(await said('mock-exch-support-withdraw-signoffno'), { seat: 'r3', line: 'no', field: 'missing', said: 'no', differs: false, computed: 'signs', against_computed: true, re_asked: REASKED }, 'a "no" over a judge the rule lets sign off is recorded as against the rule, with the re-ask it drew');
  assert.deepEqual(await said('mock-exch-support-withdraw-signoffjunk'), { seat: 'r3', line: 'garbled', field: 'missing', said: null, differs: false, computed: 'signs', against_computed: false });
  assert.deepEqual(await said('mock-exch-support-withdraw-signoffyesfieldno'), { seat: 'r3', line: 'yes', field: 'no', said: 'no', differs: true, computed: 'signs', against_computed: true, re_asked: REASKED }, 'line yes, field no: they differ and no wins, and the re-ask is recorded');
  assert.deepEqual(await said('mock-exch-support-withdraw-signofffieldyes'), { seat: 'r3', line: 'missing', field: 'yes', said: 'yes', differs: false, computed: 'signs', against_computed: false });
  assert.deepEqual(await said('mock-exch-support-keep-signoffno'), { seat: 'r3', line: 'no', field: 'missing', said: 'no', differs: false, computed: 'objects', against_computed: false }, 'a "no" over an objection that stands agrees with the rule');
  assert.deepEqual(await said('mock-exch-support-keep'), { seat: 'r3', line: 'missing', field: 'missing', said: null, differs: false, computed: 'objects', against_computed: false }, 'no line at all: the computed rule decides, nothing stops and nobody is asked again');
});

test('T6b (layer 2): the line is asked and recorded at layer 2 too, and the computed rule decides there', async () => {
  const { r } = await go(chainOf([L1, ...layer2(['mock-exch-support-keep-signoffno', 'r2'], ['mock-exch-contest-keep-clean', 'p1']), TOP]));
  assert.deepEqual(rowAt(r, 2).signoffs, [{ seat: 'r2', line: 'no', field: 'missing', said: 'no', differs: false, computed: 'objects', against_computed: false }]);
});

test('Q7: an upper layer that cannot run the exchange (one seat) and has an objection writes the not_run row, flagged not debated, and makes no exchange call', async () => {
  const config = chainOf([L1, ...layer2(['mock-exch-support-keep', 'r2']), TOP]);
  const on = await go(config);
  const d = rowAt(on.r, 2);
  assert.ok(d, 'a layer_debates row at layer 2');
  assert.deepEqual([d.not_run, d.rounds, d.objections.map(o => [o.raised_by, o.outcome])], ['fewer_than_two_heard', [], [['r2', 'not_debated']]]);
  assert.deepEqual(exch(on.r), [], 'no exchange call');
  // REMOVED (K7): the 'pair held' half (`go(config, {})`: no row, as before). Sibling: the 'on' half above (the not_run row, flagged not debated, no exchange call).
});

test('writer\'s note (Q5, T6f check iii): layer 1\'s standing item stays in the reviser\'s note when layer 2 also ran an exchange in the same pass (the note accumulates per pass, it is not overwritten)', async () => {
  // layer 1: a1 raises an objection rated 3 that b1 contests and a1 keeps (it does not block, so layer 1 signs off); layer 2: r2 raises one rated 5 that p2 contests: layer 2 objects, the pass revises (maxRounds 2)
  const config = chainOf([seat('mock-exch-support-keep-sev3', 'a1', 1), seat('mock-exch-contest-keep-clean', 'b1', 1), ...layer2(['mock-exch-support-keep', 'r2'], ['mock-exch-contest-keep-clean', 'p2']), TOP], { maxRounds: 2 });
  const { r, prompts } = await go(config, { ...DEMAND, ...PAIR });
  const one = rowAt(r, 1); const two = rowAt(r, 2);
  assert.ok(one && two, 'both layers ran an exchange in the pass');
  const idOne = one.objections.find(o => o.raised_by === 'a1').id; const idTwo = two.objections.find(o => o.raised_by === 'r2').id;
  const revise = prompts.get('revise-1');
  assert.ok(revise, 'the pass revised');
  const text = `${revise.system}\n${revise.user}`;
  assert.ok(text.includes(idOne), 'layer 1\'s item is in the reviser\'s note');
  assert.ok(text.includes(idTwo), 'and so is layer 2\'s');
});

// The n2 fixture: layer 2 has the raiser r2 and n2, which supports r2's objection and names a new defect in its post (minted as n2's own objection, not debated, since no round follows).
let n2Run = null;
const n2Fixture = () => (n2Run ??= go(chainOf([seat('mock-exch-support-keep-clean', 'l1a', 1), seat('mock-exch-support-keep-clean', 'l1b', 1), ...layer2(['mock-exch-support-keep', 'r2'], ['mock-exch-new-keep-clean', 'n2']), TOP]), { ...PAIR, ...W26 }));

test('Q1(c) in the shortened exchange: a defect a peer names in a layer-2 post becomes that peer\'s own objection, not debated; in the one round the safety stop does not fire although the round changed something and an objection still stands', async () => {
  const { r } = await n2Fixture();
  const d = rowAt(r, 2);
  assert.ok(d, 'a layer_debates row at layer 2');
  const minted = d.objections.find(o => o.raised_by === 'n2');
  assert.ok(minted && minted.outcome === 'not_debated' && minted.from_exchange, 'n2\'s objection is minted, from the exchange, and not debated');
  assert.equal(d.objections.find(o => o.raised_by === 'r2').outcome, 'stands_uncontested', 'and r2\'s objection still stands after the round');
  assert.equal(d.rounds.length, 1);
  assert.equal(d.rounds[0].changed, true, 'the premise: the round changed something');
  assert.equal(d.safety_stop, undefined, 'one round is the whole exchange: no safety stop');
});

test('PIN (ending exchange): an objection left not debated at layer 2 is not a layer-1 candidate of the ending exchange: with no layer-1 objection still not debated the ending makes no call and writes no record. Limit: green on the old source (no upper entry is stored there); it fails only if upper entries are stored without the layer-1 filter of the candidate set', async () => {
  const { r } = await n2Fixture();
  assert.equal(r.endingExchange, undefined, 'no ending record: nothing of layer 1 is still not debated');
  assert.equal(labels(r).some(l => /^(ldebate|lreply)-end/.test(l)), false, 'and no ending call');
});
