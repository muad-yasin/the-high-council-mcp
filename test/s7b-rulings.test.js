// 0.8.4 S7b, commit A3 (the hook): layer 2's `rulings` in its ordinary review reply are read, settled by the stall ruling's own logic (settleEscalationRulings), and closed or moved on the record. $0, offline, runChain direct (no CLI, no api).
// Rows RC-1 (an overrule of a rated-3 same-pass objection closes it), RC-2 (a reply with no rulings array leaves it), RC-3 (a sustain adopts it and holds nothing), RC-4 (a ruled id is not open dissent when the run ends).
// The same fixture and held map as test/s7b-prompt.test.js. Every layer-1 reply declares relation "new" (relationRule is injected), and every row first asserts the prompt's ref equals the precomputed id, so a mismatch fails loudly and is never a silent "no ruling".
// NOT DRIVEN here (named): R9 (a ruled id with a full stall window is not passed up in the pass it was ruled on: needs a multi-pass fixture where layer 1's swept id stands across the window while another layer objects); the NEXT pass's #r2 for a re-raise (a two-pass fixture). A stated pass carrying rulings and an unheard layer-2 seat blocking an overrule are driven in test/s7b-gaps.test.js (G-4, G-3).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as HB from './held-prompts/held-084-b.js';
import { scenario, CRITERION, idOf } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));

const LIVE = Object.freeze({ ...DEMAND, relationRule: HB.relationRule, layerOneRulingsSection: HB.layerOneRulingsSection, layerOneRulingsReplyTail: HB.layerOneRulingsReplyTail, layerOneRulingsLedgerSection: HB.layerOneRulingsLedgerSection });
const ID = idOf(3);
const failure = (criterion, severity, quote) => ({ criterion, problem: 'No retry limit is specified.', fix: 'Specify one.', quote, severity, relation: 'new' });
const raiseOf = failures => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no' });
const sign = rulings => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(rulings ? { rulings } : {}) });
const L1 = { 'panel-1-la': raiseOf([failure(CRITERION, 3, 'retries failed requests')]) };
const refsOf = text => [...text.matchAll(/<prior-review ref="([^"]+)">/g)].map(m => m[1]);
const SECTION = "# Objections of layer 1 ruled on in layer 2's review";

const run = async (lbReply, extra = {}) => {
  setHeldForTest(LIVE);
  const s = await scenario({ answerBack: true, l1Severity: 3, overrides: { ...L1, ...(lbReply === undefined ? {} : { 'panel-1-lb': lbReply }), ...(extra.overrides ?? {}) }, ...(extra.extra ? { extra: extra.extra } : {}), ...(extra.runExtra ? { runExtra: extra.runExtra } : {}) });
  assert.deepEqual(refsOf(s.prompts.get('panel-1-lb').user), [ID], 'the prompt lists the precomputed id (a mismatch here would make every ruling below a silent no_ruling)');
  return s;
};

test('RC-1: layer 2 overrules layer 1\'s open objection (rated 3) in its ordinary reply: it is closed on the record, and layer 3 is told so in its own words', async () => {
  const { prompts } = await run(sign([{ id: ID, ruling: 'overrule', reason: 'The plan already sets one in section two.' }]));
  const lc = prompts.get('panel-1-lc');
  assert.ok(lc, 'layer 3 was asked in the same pass');
  assert.ok(lc.user.includes(SECTION), 'the in-call ruling section');
  assert.ok(lc.user.includes(`- ${ID}, raised by la (layer 1) in round 1: overruled by every judge of layer 2 in round 1.`), lc.user.slice(lc.user.indexOf(SECTION)));
  assert.ok(lc.user.includes('Reasons given: lb: The plan already sets one in section two.'));
});

test('RC-2: a layer-2 reply with no rulings array rules on nothing: the objection stays as it was (no refusal, no re-ask, no section for layer 3)', async () => {
  const { prompts, served, result } = await run(sign(undefined));
  assert.equal(prompts.get('panel-1-lc').user.includes(SECTION), false);
  assert.deepEqual([...new Set(served.filter(l => l.startsWith('panel-1-lb')))], ['panel-1-lb'], 'layer 2 was asked once: no re-ask label');
  assert.equal(result.layers.find(l => l.round === 1 && l.layer === 2).sustained, undefined);
});

test('RC-3: layer 2 sustains it: the sustaining seat takes it over under a new id, it is rated 3 so it holds nothing back, and no revision follows', async () => {
  const { prompts, served, result } = await run(sign([{ id: ID, ruling: 'sustain' }]));
  const row = result.layers.find(l => l.round === 1 && l.layer === 2);
  assert.deepEqual(row.sustained, [ID], 'the layers[] row names the sustained original');
  assert.equal(row.state, 'signed_off', 'a sustained objection rated below 4 holds nothing back');
  assert.equal(served.some(l => l.startsWith('revise-')), false, 'no revision');
  const lc = prompts.get('panel-1-lc');
  assert.ok(lc.user.includes(SECTION) && lc.user.includes(`- ${ID}, raised by la (layer 1) in round 1: sustained in round 1 by lb (layer 2); it is now `), lc.user.slice(lc.user.indexOf(SECTION)));
});

test('RC-4 (RS-17): a run that ends not agreed after the ruling does not list the overruled objection as open dissent; without the ruling it does', async () => {
  const l3 = { 'panel-1-lc': raiseOf([failure(`${CRITERION} (layer 3)`, 5, 'worker')]) };
  // The chain has overseer rounds, so `maxRounds` is ignored (roundLimitsOf: the pass limit is derived): the premise "one pass" is now ONE OVERSEER ROUND. Layer 3's objection in pass 1 meets that cap (stop id overseer_cap:<rounds ended>:<pass> = overseer_cap:1:1) and the person's recorded choice is to FINISH there: the run ends not agreed, with the dispute stage over what is open.
  const extra = { overrides: l3, extra: { maxOverseerRounds: 1, dispute: { enabled: true } }, runExtra: { roundChoices: [{ stop: 'overseer_cap:1:1', choice: 'finish', kind: 'overseer_cap', overseer_round: 1, add: 0 }] } };
  const ruled = await run(sign([{ id: ID, ruling: 'overrule', reason: 'The plan already sets one in section two.' }]), extra);
  assert.equal(ruled.result.passed, false, 'layer 3 objected at the overseer-round cap and the run was finished there');
  assert.ok(ruled.result.dispute?.open_objections?.some(o => o.criterion === `${CRITERION} (layer 3)`), 'layer 3\'s own objection is open dissent');
  assert.equal(ruled.result.dispute.open_objections.some(o => o.lab === 'la' && o.criterion === CRITERION), false, 'layer 1\'s overruled objection is not');
  const control = await run(sign(undefined), extra);
  assert.ok(control.result.dispute?.open_objections?.some(o => o.lab === 'la' && o.criterion === CRITERION), 'without the ruling it is open dissent (the control that proves this row can fail)');
});
