// 0.8.4 S7b (D39 / W39 / Q7(e): layer 2 rules on layer 1's still-open objections inside its ordinary blind-review call). Commit A1: the pure parts. $0, offline, no run.
// New exports are read through NAMESPACE imports (ES., SV.) so this file LOADS on the S7 tip and a row fails by assertion, not by a load error.
// S7B-1  the gate: five names, all recorded or nothing is live.
// S7B-2  closesOnOverrule(lab, id, pending): a pending rating closes an uncommitted id below 4; a committed value is never overridden; an unreadable pending value counts as no rating.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ES from '../src/escalation.js';
import * as SV from '../src/severity.js';

const heldOf = names => name => (names.includes(name) ? () => '' : undefined);

test('S7B-1: layerOneRulingActive needs the rating demand, the relation wording and the three S7b names, all recorded', () => {
  assert.ok(Array.isArray(ES.LAYER_ONE_RULING_HELD), 'S7b adds LAYER_ONE_RULING_HELD to src/escalation.js');
  assert.deepEqual([...ES.LAYER_ONE_RULING_HELD].sort(), ['layerOneRulingsLedgerSection', 'layerOneRulingsReplyTail', 'layerOneRulingsSection', 'ratingDemand', 'relationRule']);
  assert.equal(typeof ES.layerOneRulingActive, 'function');
  assert.equal(ES.layerOneRulingActive(heldOf(ES.LAYER_ONE_RULING_HELD)), true);
  for (const missing of ES.LAYER_ONE_RULING_HELD) assert.equal(ES.layerOneRulingActive(heldOf(ES.LAYER_ONE_RULING_HELD.filter(n => n !== missing))), false, `without ${missing}`);
  assert.equal(ES.layerOneRulingActive(heldOf([...ES.RULING_HELD, ...ES.GO_UP_HELD])), false, 'the recorded stall sentences and the go-up sentences do not switch the S7b ruling on');
  assert.equal(ES.layerOneRulingActive(() => undefined), false, 'nothing recorded: dark');
});

test('S7B-2: closesOnOverrule takes a pending rating for an uncommitted id and never overrides a committed one', () => {
  const r = SV.createSeverityRun();
  assert.equal(r.closesOnOverrule('la', 'O-aaaaaaaa'), false, 'no pending argument and nothing committed: open (as before)');
  assert.equal(r.closesOnOverrule('la', 'O-aaaaaaaa', 3), true, 'pending 3, nothing committed: closes');
  assert.equal(r.closesOnOverrule('la', 'O-aaaaaaaa', 3.9), true);
  assert.equal(r.closesOnOverrule('la', 'O-aaaaaaaa', 4), false, '4 or above holds');
  assert.equal(r.closesOnOverrule('la', 'O-aaaaaaaa', 8), false);
  for (const bad of [3.25, '3', 'x', NaN, 0, 11, null, undefined, {}]) assert.equal(r.closesOnOverrule('la', 'O-aaaaaaaa', bad), false, `an unreadable pending value (${String(bad)}) counts as no rating: held`);
  r.commit('la', 'O-bbbbbbbb', 5, 1);
  assert.equal(r.closesOnOverrule('la', 'O-bbbbbbbb', 3), false, 'a committed 5 stands: the pending 3 does not override it');
  r.commit('la', 'O-cccccccc', 3, 1);
  assert.equal(r.closesOnOverrule('la', 'O-cccccccc', 8), true, 'a committed 3 stands: the pending 8 does not override it');
  r.commit('la', 'O-dddddddd', 8, 1); r.applyHandlerRetags(2, [{ id: 'O-dddddddd', severity: 3, reason: 'down' }]);
  assert.equal(r.closesOnOverrule('la', 'O-dddddddd', 3), false, 'ever rated 7 or above: never closed by an overrule, pending or not');
});
