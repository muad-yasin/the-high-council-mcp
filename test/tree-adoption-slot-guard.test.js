// 0.8.3 M7 apply, C2b-2 money fix-up 2 (plan Review/Build_0.8.3/m7/C2b2_Money_Fixup_Plan_2026-10-19.md): a slot a LIVE adoption holds is never registered fresh. One helper (`slotHeldBy`) stands in front of the table row and the chooser; the table row is the class guard (it needs no trigger).
// Rows: (1) a hand-appended registration on an adopted slot is refused by name; (2) the helper; (8) the positive row, 6d's: after the adopting parent is re-planned and the adoption lapses, the NEW frontier registers the slot and the guard stays silent (the person's exit). Expected values written before the first run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fanOutOf } from '../src/tree-fan-out.js';
import * as T from '../src/tree-transitions.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { registerChildUnchecked } from '../src/tree-register.js';
import { frontierKey } from '../src/tree-identity.js';
import { adoptedTree, replanParent } from './helpers/adoption-fixture.js';
import { FIXTURE_BOUND, GATE_FIELDS as GF, IDS, SPLIT, approveFrontier, chainSha, claim, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

const chainOf = t => ({ name: t.childChain, sha256: (t.shaIn ?? chainSha)(t.childChain) });
const slotFrontierOf = state => [...state.frontiers].find(([, f]) => f.parentNode === 'R/M1' && f.parentGeneration === 2)[0];

test('C2b-2 fix-up 2 row 1: a registration on a slot a live adoption holds is refused by name (the adopted run fills it); a sibling slot of the same frontier is not affected', () => {
  const { t } = adoptedTree({ finishC: true });       // no node is active, so the refusal under test is the only one
  const state = stateOf(readTreeRecord(t.rootDir)); const fk = slotFrontierOf(state);
  assert.equal(T.slotHeldBy(state, 'R/M1/B@g2'), 'R/M1/A@g1', 'the helper names the adopted run that fills the slot');
  assert.equal(T.slotHeldBy(state, 'R/M1/C@g2'), null, 'a slot nobody holds');
  assert.equal(T.slotHeldBy(state, 'R/M1/B@g3'), null, 'another generation of the path is not the held slot');
  assert.throws(() => registerChildUnchecked(t.rootDir, { frontierKey: fk, node: 'R/M1/B', generation: 2, runId: IDS[10], parentRunId: IDS[2], chain: chainOf(t), grant: { amount: 4, unit: 'usd' } }), /R\/M1\/B@g2 is filled by the finished run R\/M1\/A@g1/);
  assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M1/B@g2'), false, 'nothing was written');
});

test('C2b-2 fix-up 2 row 8 (positive, the person\'s exit): after the adopting parent is re-planned the adoption lapses, and the NEW frontier registers the slot at its new generation; the guard stays silent', () => {
  const { t } = adoptedTree({ finishC: true });       // every other child of the adopting frontier is finished: only the held slot is unregistered, and no node is active when the new frontier is previewed
  replanParent(t);                                                                                     // R/M1@g2 planned again: the decision opens R/M1@g3, the parent clause ends the adoption
  assert.equal(stateOf(readTreeRecord(t.rootDir)).adopted.size, 0, 'the adoption lapsed');
  const kR = approveFrontier(t.rootDir, ['R/M1'], { generation: 3 });
  registerKid(t, kR, 'R/M1', IDS[10], 10, 3); syntheticRun(t, IDS[10], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[10], process.pid, 3, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 3, runId: IDS[10], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 10 });
  const children = [{ node: 'R/M1/B', generation: 3 }];
  const k = frontierKey({ parentNode: 'R/M1', parentGeneration: 3, parentRunId: IDS[10], splitSha256: SPLIT, openedBy: null, children });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: k, parentNode: 'R/M1', parentGeneration: 3, parentRunId: IDS[10], splitSha256: SPLIT, children, boundSha256: FIXTURE_BOUND });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GF, frontierKey: k, revision: 1, boundSha256: FIXTURE_BOUND });
  registerChildUnchecked(t.rootDir, { frontierKey: k, node: 'R/M1/B', generation: 3, runId: IDS[11], parentRunId: IDS[10], chain: chainOf(t), grant: { amount: 4, unit: 'usd' } });
  const st = stateOf(readTreeRecord(t.rootDir));
  assert.ok(st.nodes.has('R/M1/B@g3'), 'the slot is registered fresh by the new plan');
  assert.equal(T.slotHeldBy(st, 'R/M1/B@g3'), null);
});

test('C2b-2 fix-up 2 row 3 (the width): a SECOND frontier of the adopting split that lists the held slot counts it once, though it does not own the adoption (known-bad: the owner-key count gives 0, so a limit, and the admission at registration, would not see the slot)', () => {
  const { t } = adoptedTree({ finishC: true });
  const first = slotFrontierOf(stateOf(readTreeRecord(t.rootDir)));
  const children = [{ node: 'R/M1/B', generation: 2 }];
  const k2 = frontierKey({ parentNode: 'R/M1', parentGeneration: 2, parentRunId: IDS[2], splitSha256: SPLIT, openedBy: 'a-later-decision', children });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: k2, parentNode: 'R/M1', parentGeneration: 2, parentRunId: IDS[2], splitSha256: SPLIT, openedBy: 'a-later-decision', children, boundSha256: FIXTURE_BOUND });
  const st = stateOf(readTreeRecord(t.rootDir));
  assert.notEqual(k2, first);
  assert.equal(fanOutOf(st, k2), 1, 'the held slot fills one place of the second frontier');
  assert.equal(fanOutOf(st, k2, { pending: 1 }), 2, 'the caller\'s own pending child is added on top');
});
