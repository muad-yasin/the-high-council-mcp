// 0.8.4 S4 (M1), U4: the rows of the layer rule and the sign-off after the exchange that the S2/S3/S19 units built (T3b, T5a, T5c, T5d, T22e, T22z). Offline, mock seats only, $0. Most of them hold on the tip before this unit (PINS: they are the copy's rows written down; a source
// change that broke one would turn it red); each says what it adds over the older tests. The rating demand is injected where a rating matters (test/helpers/rating-demand.js).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = (critics, extra = {}) => ({
  name: 'layer-rule-rows', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async (config, { held = DEMAND, scripted = {} } = {}) => {
  const lines = [];
  setHeldForTest(held);
  if (Object.keys(scripted).length) setCache({ invalidate() {}, get: label => (label in scripted ? { text: scripted[label], provider: 'mock', model: 'm', usage: { input: 30, output: 30 }, usd: 0 } : null) });
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-layer-rule-rows', config });
  return { r, log: lines.join('\n') };
};
const labels = r => r.stages.map(s => s.label);
const exch = r => labels(r).filter(l => /^(ldebate|lreply)-/.test(l));
const verdictOf = (r, round, lab) => r.panelVerdicts.find(v => v.round === round && v.lab === lab);

test('T3b: K = 4, the raiser withdraws in round 1: 4 exchange calls (three posts and the raiser\'s reply), then a confirming round that makes no call; the exchange ends and the judge is signed off', async () => {
  // e1 raises; e2, e3, e4 are clean blind and contest it; e1 withdraws with a reason
  const { r } = await go(chainOf([seat('mock-exch-support-withdraw', 'e1', 1), ...['e2', 'e3', 'e4'].map(l => seat('mock-exch-contest-keep-clean', l, 1)), seat('mock-critic-x', 'e9', 2)], { maxRounds: 1 }));
  assert.deepEqual(exch(r).sort(), ['ldebate-1-e2', 'ldebate-1-e3', 'ldebate-1-e4', 'lreply-1-e1'], 'four calls');
  assert.equal(labels(r).some(l => /^(ldebate|lreply)-1-x2/.test(l)), false, 'the confirming round makes no call');
  const d = r.layerDebates[0];
  assert.deepEqual(d.objections.map(o => [o.raised_by, o.outcome]), [['e1', 'withdrawn_argued']]);
  assert.deepEqual([verdictOf(r, 1, 'e1').verdict, verdictOf(r, 1, 'e1').exchange_cleared], ['signed_off', true]);
});

// K = 4: three judges with no objection and one whose objection, rated 5.0, stands after the exchange (everyone else supports it, nobody withdraws it).
const k4 = () => go(chainOf([...['e1', 'e2', 'e3'].map(l => seat('mock-exch-support-keep-clean', l, 1)), seat('mock-exch-support-keep-sev5', 'e4', 1), seat('mock-critic-x', 'e9', 2)], { maxRounds: 1 }));
test('T5a: K = 4, three judges with no objection and one whose objection, rated 5.0, stands after the exchange: the layer does not sign off (layer 2 is not asked)', async () => {
  const { r } = await k4();
  assert.equal(r.layerDebates[0].objections[0].outcome, 'stands_uncontested');
  assert.equal(r.layerDebates[0].objections[0].severity, 5, 'the premise: it is rated 5.0 and stands');
  assert.equal(verdictOf(r, 1, 'e4').verdict, 'objected');
  assert.equal(labels(r).includes('panel-1-e9'), false, 'layer 2 is not asked: layer 1 did not sign off');
});
test('T5c: a judge that posts support on a peer\'s objection and has no objection of its own keeps its sign-off', async () => {
  const { r } = await k4();
  const posted = r.layerDebates[0].objections[0].posts.map(p => p.by);
  assert.deepEqual([...new Set(posted)].sort(), ['e1', 'e2', 'e3'], 'the premise: all three clean judges posted support (in each round of the exchange)');
  for (const lab of ['e1', 'e2', 'e3']) assert.deepEqual([verdictOf(r, 1, lab).verdict, verdictOf(r, 1, lab).exchange_cleared], ['signed_off', undefined], `${lab} stays signed off`);
});

// T22e: the seventh round of an exchange in an ordinary pass (a pass follows): a post names a material defect.
test('T22e: the defect a post names in round 3 (the last the layer-1 exchange allows) is minted as the finder\'s own objection WITH its rating, marked not_debated, and carried to the next pass\'s exchange (W1 stands: it is not a late finding)', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep-sev3-t22e', 'e1', 1), seat('mock-exch-alt-keep-clean', 'e2', 1), seat('mock-exch-new7-keep-clean', 'e3', 1), seat('mock-critic-x', 'e9', 2)], { maxRounds: 2 }));
  const first = r.layerDebates[0];
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list: the layer-1 exchange rows; exchange ideas 1 and 2). OLD: rounds 7 and the defect named in round 7. NEW: 3: the exchange stops after 3 rounds, `new7` names one defect in round 2 (the progress that earns round 3) and the one under test in round 3, so the objection under test is found by its round.
  assert.deepEqual([first.rounds.length, first.safety_stop], [3, true], 'the premise: the exchange ran its third round');
  const minted = first.objections.find(o => o.from_exchange && o.added_round === 3);
  assert.deepEqual([minted.raised_by, minted.outcome, minted.added_round, minted.severity], ['e3', 'not_debated', 3, 5], 'the finder\'s own objection, rated, not debated');
  assert.equal(first.late_findings, undefined, 'W1 stands: no late finding is recorded in an ordinary pass');
  const second = r.layerDebates[1];
  assert.ok(second && second.objections.some(o => o.raised_by === 'e3' && o.carried_from === 1), 'carried to the next pass\'s exchange');
});

// T22z: layer 1's exchange ends with an objection rated 3.0 not_debated (named in round 3, the last the layer-1 exchange allows; it was round 7) and layer 1 otherwise signs off. The mock writes a rating on a post defect only without a `-sev` suffix (5), so e3's posts are scripted by their labels: one new objection in round 2 (the progress that earns round 3) and the rated one in round 3.
test('T22z: an objection rated 3.0 named in round 3 (not_debated) and layer 1 otherwise signs off: no second exchange in the pass, the objection carried', async () => {
  const first = 'It adds no scope the request did not ask for.';
  const { r } = await go(chainOf([seat('mock-exch-support-keep-sev3-t22z', 'e1', 1), seat('mock-exch-alt-keep-clean', 'e2', 1), seat('mock-exch-support-keep-clean', 'e3', 1), seat('mock-critic-x', 'e9', 2)], { maxRounds: 2 }),
    { scripted: { 'ldebate-1-x2-e3': JSON.stringify({ posts: [], new_objections: [{ criterion: first, problem: 'The plan names a deliverable nobody asked for in round two.', quote: 'A passage that round two names.', severity: 3 }] }), 'ldebate-1-x3-e3': JSON.stringify({ posts: [], new_objections: [{ criterion: first, problem: 'The plan names a second deliverable nobody asked for.', severity: 3 }] }) } });
  const d = r.layerDebates[0];
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: one layerDebates entry in pass 1. NEW: one entry for LAYER 1 in pass 1 (no second exchange of layer 1); a seat above the lowest layer that objects now gets its own entry (the shortened exchange: not_run 'fewer_than_two_heard' for a lone judge), and pass 2's layer-1 entry is found by its pass and layer, not by position. WHY: shortExchangeRule and signoffLineRule are recorded (src/short-exchange.js shortExchangeOn; chain.js:5816 and :5847 write the row for a layer above the lowest).
  assert.equal(r.layerDebates.filter(x => x.pass === 1 && x.layer === 1).length, 1, 'no second exchange of layer 1 in the pass');
  const minted = d.objections.find(o => o.from_exchange && o.added_round === 3);
  assert.deepEqual([minted?.raised_by, minted?.outcome, minted?.severity], ['e3', 'not_debated', 3], 'the premise: rated 3.0, named in round 3');
  assert.equal(verdictOf(r, 1, 'e3').verdict, 'signed_off', 'a rating below 4 holds nothing');
  assert.ok(labels(r).includes('panel-1-e9'), 'layer 1 otherwise signed off: layer 2 was asked');
  assert.ok(r.layerDebates.find(x => x.pass === 2 && x.layer === 1)?.objections.some(o => o.raised_by === 'e3' && o.carried_from === 1), 'the objection is carried to the next pass');
});
