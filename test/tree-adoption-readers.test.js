// 0.8.3 M7 apply, C2b-1b (plan + gate answer: Review/Build_0.8.3/m7/C2b1b_Plan_2026-10-18.md; C&C thcmcp-6d: the PLACE model, `placeOf` derived on read; the lineage closure `adoptedBelow` is the unit's first change). The readers that kept ONE entry per PATH are re-keyed by PLACE, each with a row
// on a REAL record (test/helpers/adoption-fixture.js: every event through the real table, the adoption a preview with a `reused` entry and its approval, because nothing in src/ writes `reused` before C2b-2). The fixture is the MOVED adoption of the Q6 ruling: R/M1/A@g1 is adopted into the slot
// R/M1/B while the new plan has its own R/M1/A@g2, and (deep) both have a child at R/M1/A/D. A reader keyed by path would hold two nodes under one key and lose one of them. $0, no run is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as TR from '../src/tree-transitions.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { gatherReadinessFacts, heldTargetsOf, verdictOf } from '../src/tree-ready.js';
import { treeGraph, affectedFor } from '../src/tree-affected.js';
import { providerEligibility } from '../src/tree-loop.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { adoptedTree } from './helpers/adoption-fixture.js';

// a namespace import, so that a missing export (the base of this commit, for the red run) fails the test that calls it and not the whole file at link time
const { isSupersededGeneration, liveNodesByPath, placeOf } = TR;
const read = t => { const record = readTreeRecord(t.rootDir); return { record, state: stateOf(record) }; };
const keysOf = list => list.map(n => `${n.node}@g${n.generation}`);

test('C2b-1b the lineage closure: the nodes BELOW an adopted node are adopted with it, so a newer generation of their path (the new plan\'s own node there) does not make them replaced', () => {
  const { t } = adoptedTree({ deep: true });
  const { state } = read(t);
  assert.equal(state.adoptedBelow?.get('R/M1/A/D@g1'), 'R/M1/A@g1', 'D@g1 hangs under the adopted node');
  assert.equal(state.adoptedBelow?.has('R/M1/A/D@g2'), false, 'the new D@g2 hangs under the new A@g2, not under an adopted node');
  assert.equal(isSupersededGeneration(state, 'R/M1/A/D', 1), false, 'D@g1 is live beside D@g2');
  assert.equal(isSupersededGeneration(state, 'R/M1/A/D', 2), false);
  assert.deepEqual(liveNodesByPath(state).get('R/M1/A/D').map(n => n.generation), [2, 1]);
});

test('C2b-1b a node REGENERATED inside an adopted branch replaces its predecessor there: D@g1 is replaced by D@g3 (registered under the adopted root), so no two live nodes of the branch share a place; an opened generation alone does not replace it', () => {
  const { t } = adoptedTree({ deep: true, regenerate: true });
  const { state } = read(t);
  assert.equal(state.adoptedBelow?.get('R/M1/A/D@g3'), 'R/M1/A@g1', 'the replacement hangs under the adopted root');
  assert.equal(isSupersededGeneration(state, 'R/M1/A/D', 1), true, 'D@g1 was regenerated inside its own branch');
  assert.equal(isSupersededGeneration(state, 'R/M1/A/D', 3), false);
  const orphans = TR.orphansOf(state);
  const inBranch = TR.liveNodesOf(state, [...state.nodes.values()].filter(n => !orphans.has(`${n.node}@g${n.generation}`))).filter(n => state.adoptedBelow?.has(`${n.node}@g${n.generation}`) || state.adopted?.has(`${n.node}@g${n.generation}`));
  assert.deepEqual(keysOf(inBranch).sort(), ['R/M1/A/D@g3', 'R/M1/A@g1'], 'the adopted branch holds one node per place');
});

test('C2b-1b placeOf: the PLACE of a node in the plan in force - the path, except an adopted node (the slot it fills) and a node below one (the slot plus the rest of its own path)', () => {
  const { t } = adoptedTree({ deep: true });
  const { state } = read(t);
  const place = k => placeOf(state, state.nodes.get(k));
  assert.deepEqual(['R@g1', 'R/M1@g2', 'R/M1/A@g2', 'R/M1/A/D@g2', 'R/M1/C@g2'].map(place), ['R', 'R/M1', 'R/M1/A', 'R/M1/A/D', 'R/M1/C']);
  assert.deepEqual(['R/M1/A@g1', 'R/M1/A/D@g1'].map(place), ['R/M1/B', 'R/M1/B/D'], 'the adopted node fills R/M1/B, its child sits under that slot');
  const orphans = TR.orphansOf(state);
  const places = TR.liveNodesOf(state, [...state.nodes.values()].filter(n => !orphans.has(`${n.node}@g${n.generation}`))).map(n => place(`${n.node}@g${n.generation}`));       // the LIVE nodes: R/M1@g1 is replaced by R/M1@g2 and shares its place
  assert.equal(new Set(places).size, places.length, `no two live nodes share a place: ${places.join(', ')}`);
});

test('C2b-1b gatherReadinessFacts: the adopted node and its child are judged like any live node - each is a fact of its own, with its place, and none is "waiting for a newer generation"', () => {
  const { t } = adoptedTree({ deep: true });
  const facts = gatherReadinessFacts(t.rootDir, { work: t.work });
  const keys = keysOf(facts.nodes);
  for (const k of ['R/M1/A@g1', 'R/M1/A@g2', 'R/M1/A/D@g1', 'R/M1/A/D@g2', 'R/M1/C@g2']) assert.ok(keys.includes(k), `${k} is a fact (${keys.join(', ')})`);
  assert.equal(new Set(keys).size, keys.length, 'no key twice');
  const f = k => facts.nodes.find(n => `${n.node}@g${n.generation}` === k);
  assert.deepEqual([f('R/M1/A@g1').place, f('R/M1/A/D@g1').place], ['R/M1/B', 'R/M1/B/D']);
  assert.equal(f('R/M1/A@g2').place, undefined, 'a node that is where its path says carries no place');
  assert.deepEqual([f('R/M1/A@g1').nextGeneration, f('R/M1/A/D@g1').nextGeneration], [null, null], 'the adopted branch waits for no newer generation of its path');
});

test('C2b-1b verdictOf: a decompose milestone whose slot is filled by an ADOPTED node finds its child by place (it is not "unexpanded"), and the child\'s own readiness settles it', () => {
  const { t } = adoptedTree();
  const facts = gatherReadinessFacts(t.rootDir, { work: t.work });
  const parent = facts.nodes.find(n => n.node === 'R/M1' && n.generation === 2);
  assert.ok(facts.nodes.some(n => n.node === 'R/M1/A' && n.generation === 1), 'the adopted node is a fact');
  // the parent plan (R/M1@g2) says: milestone B is a decompose milestone, so its child is R/M1/B - the slot the adopted node fills
  Object.assign(parent, { phase: 'closed', outcome: 'passed', run: { unreadable: null, passed: true, signedOff: true, sameAsSigned: true, changedBy: [], lint: { status: 'ready_for_build', findings: [] }, thinContractSha256: null, contractExit: 0 }, planReadable: true,
    split: { readable: true, sha256: 'a'.repeat(64), verifiedSha256: 'a'.repeat(64), refusals: [], milestones: [{ id: 'B', status: 'decompose' }], agreements: [], resolved: [] } });
  const v = verdictOf(facts);
  assert.equal(v.reasons.some(r => r.code === 'unexpanded' && r.scope === 'R/M1@g2'), false, JSON.stringify(v.reasons.filter(r => r.code === 'unexpanded')));
});

test('C2b-1b heldTargetsOf: a held item carried by the ADOPTED node is a target with that node as its carrier (the new node of the path carries none)', () => {
  const { t } = adoptedTree({ held: true });
  const { record, state } = read(t);
  const targets = heldTargetsOf({ record, state });
  assert.equal(targets.length, 1, JSON.stringify(targets.map(x => x.label)));
  assert.deepEqual(targets[0].carriers, [{ node: 'R/M1/A', generation: 1 }]);
});

test('C2b-1b treeGraph: the adopted node and the new node of its old path are two vertices (by place), and the consumer pinned to the adopted node depends on ITS vertex', () => {
  const { t } = adoptedTree({ deep: true });
  const { record, state } = read(t);
  const g = treeGraph({ record, state, runsDir: t.runsDir });
  const vertices = g.nodes.map(n => n.node);
  for (const p of ['R/M1/A', 'R/M1/B', 'R/M1/A/D', 'R/M1/B/D', 'R/M1/C']) assert.ok(vertices.includes(p), `${p} is a vertex (${vertices.join(', ')})`);
  assert.deepEqual(g.nodes.find(n => n.node === 'R/M1/C').dependsOn, ['R/M1/B'], 'C was registered against the adopted node, which sits at R/M1/B');
});

test('C2b-1b affectedFor: a stop at the ADOPTED node puts in question the adopted branch, not the new node of its old path - and the list names real nodes', () => {
  const { t } = adoptedTree({ deep: true });
  const { record, state } = read(t);
  const { affected } = affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1/A', generation: 1 });
  const keys = keysOf(affected);
  assert.ok(keys.includes('R/M1/A@g1') && keys.includes('R/M1/A/D@g1'), `the adopted branch is affected (${keys.join(', ')})`);
  assert.ok(!keys.includes('R/M1/A@g2') && !keys.includes('R/M1/A/D@g2'), `the new nodes of the old path are not (${keys.join(', ')})`);
});

test('C2b-1b providerEligibility: a provider placed at the slot of the ADOPTED node is judged by that node and what hangs under it (it is not "not registered yet")', () => {
  const { t } = adoptedTree({ deep: true });
  const { record, state } = read(t);
  const out = providerEligibility({ record, state, runsDir: t.runsDir, work: t.work }, 'R/M1/B');
  assert.ok(!out.why.some(w => /not registered/.test(w)), JSON.stringify(out.why));
  assert.ok(out.why.some(w => /R\/M1\/A/.test(w)) || out.eligible, `the adopted node is judged: ${JSON.stringify(out)}`);
});

test('C2b-1b the stop text of the ADOPTED node reads like any stop (smoke: the stop view\'s parent, entry and independent list follow the place; it names the adopted branch and does not throw)', () => {
  const { t } = adoptedTree({ deep: true });
  const { record, state } = read(t);
  const { affected } = affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1/A', generation: 1 });
  const x = state.nodes.get('R/M1/A@g1');
  const stop = { id: 'e9999', event: 'needs_decision_opened', node: 'R/M1/A', generation: 1, runId: x.runId, source: 'node_closed', affected };
  const text = needsDecisionStopText(t.rootDir, stop);
  assert.match(text, /R\/M1\/A generation 1/);
  assert.match(text, /R\/M1\/A\/D/, 'the finished child of the adopted node is named');
});
