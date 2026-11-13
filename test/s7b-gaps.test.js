// 0.8.4 S7b, commit A6 (tests only): the rows the earlier commits named NOT DRIVEN that are cheap to drive. $0, offline, runChain direct; fixture and held map as test/s7b-rulings.test.js and s7b-records.test.js.
// Rows G-1 (a revise round run for another reason does not list the overruled-below-4 id, in the reviser's prompt or the judge's answer-back), G-2 (several sustainers: the record and layer 3's section; the section's two branches rendered), G-3 (an unheard layer-2 seat blocks an overrule),
// G-4 (a stated pass carrying rulings is read).
// STILL NOT DRIVEN (named, with the reason): R9 (a ruled id with a full stall window is not passed up in the pass it was ruled on: needs a multi-pass stall fixture); the next pass's `#r2` for a re-raise (a two-pass fixture with the assigner on); a not_debated row in the S7b section and the
// empty-rulable edge (section shown, no reply tail: reachable ONLY through a not_debated row, because the size budget cannot cut every row: a critic field is capped at 8,000 characters and the section budget is 40,000); both need a layer-1 exchange that leaves an objection not debated (S3/S6 fixtures).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as HB from './held-prompts/held-084-b.js';
import { scenario, CRITERION, DRAFT, idOf, FINAL_READ_OK } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { RoundStopped } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));

const LIVE = Object.freeze({ ...DEMAND, relationRule: HB.relationRule, layerOneRulingsSection: HB.layerOneRulingsSection, layerOneRulingsReplyTail: HB.layerOneRulingsReplyTail, layerOneRulingsLedgerSection: HB.layerOneRulingsLedgerSection });
const ID = idOf(3);
const L1_PROBLEM = 'No retry limit is specified.';
const failure = (criterion, severity, quote, problem = L1_PROBLEM) => ({ criterion, problem, fix: 'Specify one.', quote, severity, relation: 'new' });
const raiseOf = failures => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no' });
const sign = rulings => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(rulings ? { rulings } : {}) });
const L1 = { 'panel-1-la': raiseOf([failure(CRITERION, 3, 'retries failed requests')]) };
const OVERRULE = [{ id: ID, ruling: 'overrule', reason: 'The plan already sets one in section two.' }];
const rowOf = (result, layer = 2) => result.layers.find(l => l.round === 1 && l.layer === layer);
const TWO_L2 = [['la', 1], ['lb', 2], ['lb2', 2], ['lc', 3]];
// A clean sign-off that WITHDRAWS one of the judge's own earlier objections: the quote is the plan's own first line, which the revised plan keeps (layer-two-run.js: a revision is DRAFT plus a line).
const withdrawsOf = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: `It reads "${DRAFT}"` }] });
const run = async (overrides, extra = {}) => { setHeldForTest(LIVE); return scenario({ answerBack: true, l1Severity: 3, overrides: { ...FINAL_READ_OK, ...L1, ...overrides }, ...extra }); };   // 0.8.4 S16: the top seat reads at the final read (a run that ended with nobody having read it now stops)

test('G-1: a revise round run for ANOTHER reason (layer 3 objects) does not list the overruled-below-4 id: not in the reviser\'s prompt, not in layer 1\'s answer-back; without the ruling both do', async () => {
  // Layer 3 raises in pass 1 and, in pass 2, answers its own objection by withdrawing it (a plain sign-off without an answer leaves it unanswered, it is carried as an objection, and the run walks to the overseer cap). The id is computed with the LIST criterion: inside the run, the criterion text "<CRITERION> (layer 3)" resolves to CRITERION (setIdCriteria), outside it nothing resolves it.
  const l3Id = objectionId('lc', { criterion: CRITERION, quote: 'worker' });
  const l3 = { 'panel-1-lc': raiseOf([failure(`${CRITERION} (layer 3)`, 5, 'worker', 'Layer three has its own concern.')]), 'panel-2-lc': withdrawsOf(l3Id) };
  const ruled = await run({ ...l3, 'panel-1-lb': sign(OVERRULE) });
  const control = await run({ ...l3, 'panel-1-lb': sign(undefined) });
  for (const [name, r] of [['ruled', ruled], ['control', control]]) assert.ok(r.prompts.get('revise-1'), `${name}: the writer revised after layer 3 objected`);
  assert.ok(ruled.prompts.get('revise-1').user.includes('Layer three has its own concern.'), 'the layer-3 objection is in the revise list');
  assert.equal(ruled.prompts.get('revise-1').user.includes(L1_PROBLEM), false, 'the overruled objection is not');
  assert.ok(ruled.prompts.get('panel-2-la'), 'layer 1 was asked again in pass 2');
  assert.equal(ruled.prompts.get('panel-2-la').user.includes(L1_PROBLEM), false, 'layer 1 is not shown it again in its answer-back');
  assert.ok(control.prompts.get('revise-1').user.includes(L1_PROBLEM), 'control: without the ruling it is in the revise list (this row can fail)');
  assert.ok(control.prompts.get('panel-2-la')?.user.includes(L1_PROBLEM), 'control: without the ruling layer 1 is shown it in its answer-back (answerBackSection prints the problem; this half can fail)');
});

test('G-2: two layer-2 judges both sustain: the record names both adopted ids and both rulings, and layer 3 is told in the plural; the section renders both branches', async () => {
  const sustain = sign([{ id: ID, ruling: 'sustain' }]);
  const { result, prompts } = await run({ 'panel-1-lb': sustain, 'panel-1-lb2': sustain }, { critics: TWO_L2 });
  const e = rowOf(result).rulings_in_call[0];
  assert.equal(e.outcome, 'sustained');
  assert.deepEqual(e.adopted_as.map(a => a.lab), ['lb', 'lb2']);
  assert.equal(new Set(e.adopted_as.map(a => a.id)).size, 2, 'a new id for each judge');
  assert.deepEqual(e.by.map(b => [b.seat, b.ruling]), [['lb', 'sustain'], ['lb2', 'sustain']]);
  const lc = prompts.get('panel-1-lc').user;
  assert.match(lc, /sustained in round 1 by lb \(layer 2\) and lb2 \(layer 2\); it is now \S+ of lb and \S+ of lb2; from the round after the ruling the ledger lists each new id under its judge\./);
  const one = { id: 'O-aaaaaaaa', lab: 'la', layer: 1, first_round: 1, ruled_round: 1, ruled_layer: 2, outcome: 'sustained', reasons: [], adopted_as: [{ lab: 'lb', id: 'O-bbbbbbbb' }] };
  const text1 = HB.layerOneRulingsLedgerSection({ layer: 2, rows: [one] });
  const text2 = HB.layerOneRulingsLedgerSection({ layer: 2, rows: [{ ...one, adopted_as: [...one.adopted_as, { lab: 'lb2', id: 'O-cccccccc' }] }] });
  assert.ok(text1.includes('; from the round after the ruling the ledger lists the new id under that judge.'));
  assert.ok(text2.includes('; from the round after the ruling the ledger lists each new id under its judge.'));
  for (const t of [text1, text2]) assert.equal(t.includes("see that judge's rows in the ledger above"), false, 'the false sentence is gone');
});

test('G-3: an unheard layer-2 seat blocks an overrule: the objection is undecided, the heard seat\'s overrule and the unheard seat\'s reason are both on the record; with both heard it is overruled', async () => {
  const garbage = new Proxy({ ...L1, 'panel-1-lb': sign(OVERRULE) }, { get: (o, k) => (typeof k === 'string' && k.includes('-lb2') ? 'this is not a verdict' : o[k]) });
  setHeldForTest(LIVE);
  // Every lb2 label is unreadable (the in-pass re-asks too), so the unheard seat is never heard: after the re-ask passes the run STOPS (layer_bound, unheard), resumable. Round 1's layer-2 row is read from the stop's partial record.
  let blocked = null;
  try { await scenario({ answerBack: true, l1Severity: 3, overrides: garbage, critics: TWO_L2 }); } catch (err) { if (!(err instanceof RoundStopped)) throw err; blocked = { result: err.partial, stop: err.stop }; }
  assert.ok(blocked, 'the run stopped at the silent seat');
  assert.deepEqual([blocked.stop.kind, blocked.stop.why], ['layer_bound', 'unheard']);
  const e = rowOf(blocked.result).rulings_in_call[0];
  assert.equal(e.outcome, 'undecided');
  assert.equal(e.by.find(b => b.seat === 'lb').ruling, 'overrule');
  const lb2 = e.by.find(b => b.seat === 'lb2');
  assert.deepEqual([lb2.ruling, lb2.why], [null, 'unheard']);
  const both = await run({ 'panel-1-lb': sign(OVERRULE), 'panel-1-lb2': sign(OVERRULE) }, { critics: TWO_L2 });
  assert.equal(rowOf(both.result).rulings_in_call[0].outcome, 'overruled', 'control: every seat heard and overruling closes it (this row can fail)');
});

test('G-4: a layer-2 seat that STATES A PASS may carry rulings: they are read and settled like a verdict\'s', async () => {
  const stated = JSON.stringify({ pass: true, pass_reason: 'The rest is outside my field.', rulings: OVERRULE });
  const { result } = await run({ 'panel-1-lb': stated }, { extra: { freedoms: { pass: true } } });
  const e = rowOf(result).rulings_in_call?.[0];
  assert.ok(e, 'the stated pass produced a record');
  assert.deepEqual([e.outcome, e.stays_open], ['overruled', false]);
  assert.deepEqual(e.by, [{ seat: 'lb', ruling: 'overrule', reason: 'The plan already sets one in section two.' }]);
});
