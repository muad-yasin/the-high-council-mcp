// 0.8.4 S16 (E; T21aq T21ay T21bf T21bg; FEATURE_SPECS route 5; Muad 09 Nov 2026 "keep stopping"): a layered run with NO handling session that is NOT the offline mock chain has nobody to choose at a stop. Two stops end it instead of stopping it:
// the overseer-round limit when it is not the hard stop, and a silent seat of a layer below the top layer. The run ends like a finish (the final read runs first), recorded as stop.chosen 'rule' and dispute.reason 'rule_no_handler', NOT agreed.
// The chain is a layered mock chain that lists ONE non-mock seat for a stage that is off (test/helpers/layer-two-run.js `nonMockSlot`): it is never called, and it makes the chain not the offline mock chain. Offline, $0.
// Muad's pick: an all-mock chain, and a chain with a handling session, keep stopping as before (the third and second tests). The pure parts are test/s16-rule-end-pure.test.js.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { panelEnding } from '../src/overseer-rounds.js';
import { scenario, FINAL_READ_OK, CRITERION, failureOf } from './helpers/layer-two-run.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const OBJ3 = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });
// one overseer round: layer 1 objects in pass 1 (a revise), everybody signs in pass 2 except layer 3, which objects: the round ends at the limit
const DISPUTE = { dispute: { enabled: true, stall_rounds: 2 } };   // the dispute stage records why the run ended (dispute.reason)
// one overseer round: layers 1 and 2 sign in pass 1 and layer 3 objects: the round ends at the limit in pass 1 (no revise, so no stall can fire; the default scenario has layer 1 object in pass 1, which would need an answer-back in pass 2)
const SIGN = FINAL_READ_OK['final-read-lc'];
const CAP = { extra: { maxOverseerRounds: 1, ...DISPUTE }, overrides: { 'panel-1-la': SIGN, 'panel-1-lc': OBJ3, ...FINAL_READ_OK } };
// a silent seat of layer 2 (a model that never gives a readable reply) beside a layer-2 seat that reads; layer 3 reads
const SILENT2 = [['la', 1], ['lb', 2], ['ls', 2, 'mock-unreadable'], ['lc', 3]];

async function ran(opts) {
  try { return { done: await scenario(opts) }; } catch (e) { if (e instanceof RoundStopped) return { stopped: e }; throw e; }
}

test('T21aq, T21ay: no handling session, the chain is not the offline mock chain, the overseer-round limit is not the hard stop: the final read runs, then the run ends NOT agreed, chosen "rule", dispute reason rule_no_handler, with no stop', async () => {
  const { done, stopped } = await ran({ ...CAP, nonMockSlot: true });
  assert.equal(stopped, undefined, 'the run ended, it did not stop');
  const r = done.result;
  assert.equal(r.passed, false);
  assert.deepEqual([r.stop.kind, r.stop.chosen], ['overseer_cap', 'rule']);
  assert.equal(r.dispute.reason, 'rule_no_handler', 'stop.chosen "rule" and dispute.reason "rule_no_handler" agree');
  // Which branch the final read takes here depends on whether the dispute rewrite changed the text lc objected to in pass 1: if it did, lc is asked again; if not, lc's own pass-1 read of exactly this text stands and no call is made (reason every_top_seat_read_this_plan). Either way nobody is left unread. The row that PINS that the read runs is the silent-seat row below (lc is never asked in the climb there).
  assert.ok(r.finalRead, 'T21ay: the final read is on the record before the end');
  if (r.finalRead.ran) assert.equal(r.finalRead.seats.find(s => s.lab === 'lc').read, true, 'lc read the final plan');
  else assert.equal(r.finalRead.reason, 'every_top_seat_read_this_plan', 'no call: lc already read exactly this text');
});

test('Muad\'s pick: the same run on an all-mock chain keeps stopping at the limit (the offline path stays)', async () => {
  const { stopped } = await ran({ ...CAP });
  assert.ok(stopped, 'the run stopped');
  assert.deepEqual([stopped.stop.kind, stopped.stop.cap], ['overseer_cap', 1]);
});

test('with a handling session the same non-mock run keeps stopping at the limit: the rule is for a run with nobody to choose', async () => {
  const { stopped } = await ran({ ...CAP, nonMockSlot: true, handler: true });
  assert.ok(stopped, 'the run stopped');
  assert.equal(stopped.stop.kind, 'overseer_cap');
});

test('T21bf, T21bg: no handling session, a silent seat of layer 2 that never gives a usable reply, a layer-3 seat that reads: after the silent passes the final read runs and the run ends NOT agreed, chosen "rule", with no stop', async () => {
  const { done, stopped } = await ran({ critics: SILENT2, overrides: { 'panel-1-la': SIGN, ...FINAL_READ_OK }, extra: { maxRounds: 8, ...DISPUTE }, silentLabs: ['ls'], nonMockSlot: true });
  assert.equal(stopped, undefined, 'the run ended, it did not stop');
  const r = done.result;
  assert.equal(r.passed, false);
  assert.deepEqual([r.stop.kind, r.stop.why, r.stop.layer, r.stop.chosen], ['layer_bound', 'unheard', 2, 'rule']);
  assert.equal(r.dispute.reason, 'rule_no_handler');
  assert.equal(r.finalRead.ran, true, 'the final read ran before the end');
  assert.equal(r.finalRead.seats.find(s => s.lab === 'lc').read, true);
  assert.ok(r.panelVerdicts.some(v => v.lab === 'ls' && v.verdict === 'unheard'), 'T21bg: the silent seat is named in the record by its lab');
  assert.ok(!r.panelVerdicts.some(v => v.lab === 'lb' && v.verdict === 'unheard'), 'the other seat of the layer read');
});

test('Muad\'s pick: the silent lower seat on an all-mock chain keeps stopping (layer_bound, unheard)', async () => {
  const { stopped } = await ran({ critics: SILENT2, overrides: { 'panel-1-la': SIGN, ...FINAL_READ_OK }, extra: { maxRounds: 8, ...DISPUTE }, silentLabs: ['ls'] });
  assert.ok(stopped, 'the run stopped');
  assert.deepEqual([stopped.stop.kind, stopped.stop.why], ['layer_bound', 'unheard']);
});

test('the ending word: a rule ending is rule_no_handler, a person\'s finish stays finish_chosen, the order of the older endings is unchanged', () => {
  assert.equal(panelEnding({ passed: false, finishedStop: { kind: 'overseer_cap', chosen: 'rule' } }), 'rule_no_handler');
  assert.equal(panelEnding({ passed: false, finishedStop: { kind: 'overseer_cap', chosen: 'finish' } }), 'finish_chosen');
  assert.equal(panelEnding({ passed: true, finishedStop: { chosen: 'rule' } }), 'signed_off');
});
