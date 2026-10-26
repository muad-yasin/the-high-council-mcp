// 0.8.3 M7 apply, C2a-record commit 3, K4 (reduced per C&C thcmcp-6d, Q1 (ii); plan + gate answer: Review/Build_0.8.3/m7/C2a_Commit3_Plan_2026-10-18.md section 2 and 4): the adopted-aware supersession predicate and the lineage-aware live set.
// `isSupersededGeneration` answers "is this generation replaced?" in ONE place and says NO for an ADOPTED node (C2a_Gate_Page.md section 6, I1'): an adopted node keeps its own key and its own run, so a newer generation of its PATH (the new plan's node that reuses the path) does not replace it.
// Honest limit (stated in the plan): `state.adopted` is EMPTY until C2b writes adoption, so these rows prove the predicate and the helper on a HAND-SEEDED Map, not an adoption end to end. The readers that compare a generation to the newest one directly move in C2b, each with a real-record row.
// Fold units on raw events (as test/tree-subplan-candidates.test.js does), $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as TR from '../src/tree-transitions.js';
import { FIXTURE_BOUND } from './helpers/tree-fixture.js';

// a namespace import, so that a missing export (the base of this commit, for the red run) fails the tests that call it and not the whole file at link time
const { foldRecord, frontierParentReplaced, isSupersededGeneration, liveNodesByPath, orphansOf } = TR;
const G = { gateId: 'g', shownSha256: '0'.repeat(64) };
const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' } });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, pid: 1, host: 'h' });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status, share: 'released' });
const sorted = list => [...list].sort();

// R -> {R/M1, R/M2}; R/M1 -> {R/M1/M1}; R/M1 is regenerated (a decision opens R/M1@g2) and the new plan registers R/M1@g2 on the SAME path.
const BASE = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'),
  { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1, 'needs_decision'), { id: 'e5', ...run('R/M2', 1, 'R', 'kA') }, started('e5b', 'R/M2', 1), closed('e5c', 'R/M2', 1),
  ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e6'), { id: 'e7', ...run('R/M1/M1', 1, 'R/M1', 'kB') }, started('e7b', 'R/M1/M1', 1), closed('e7c', 'R/M1/M1', 1)];
const STOP = { id: 'e8', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] };
const DEC = { id: 'e9', event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: 'e8', ...G };
const OPEN = { id: 'e10', event: 'generation_opened', decisionId: 'e9', nodes: [{ node: 'R/M1', generation: 2 }] };
const NEWNODE = [...front('kN', 'R', 1, [{ node: 'R/M1', generation: 2 }], 'e11'), { id: 'e12', ...run('R/M1', 2, 'R', 'kN') }];       // the new plan's node on the reused path
const record = [...BASE, STOP, DEC, OPEN, ...NEWNODE];

test('K4 the predicate with NO adoption is the plain comparison, and the fold carries an EMPTY adopted Map (nothing in this commit can mark a node adopted)', () => {
  const st = foldRecord(record);
  assert.ok(st.adopted instanceof Map && st.adopted.size === 0, 'state.adopted exists and is empty until C2b');
  assert.equal(isSupersededGeneration(st, 'R/M1', 1), true, 'a newer generation of the path is registered: replaced');
  assert.equal(isSupersededGeneration(st, 'R/M1', 2), false, 'the newest generation is not');
  assert.equal(isSupersededGeneration(st, 'R/M2', 1), false, 'a path nobody replaced');
  assert.equal(isSupersededGeneration(st, 'R/M9', 1), false, 'a path the record does not know');
});

test('K4 an ADOPTED node is not superseded by a newer generation of its path (hand-seeded Map); the others are judged as before', () => {
  const st = foldRecord(record);
  st.adopted.set('R/M1@g1', { by: 'seeded in the test; C2b defines the real value' });
  assert.equal(isSupersededGeneration(st, 'R/M1', 1), false, 'the adopted generation is live beside the new-era node of its path');
  assert.equal(isSupersededGeneration(st, 'R/M1', 2), false);
  const other = foldRecord([...record, ...front('kM', 'R', 1, [{ node: 'R/M2', generation: 2 }], 'e13'), { id: 'e14', ...run('R/M2', 2, 'R', 'kM') }]);
  other.adopted.set('R/M1@g1', {});
  assert.equal(isSupersededGeneration(other, 'R/M2', 1), true, 'adopting R/M1@g1 does not protect R/M2@g1');
});

test('K4 through orphansOf and frontierParentReplaced (both take a state): the child of an ADOPTED node is not an orphan, the child of a replaced one is', () => {
  const plain = foldRecord(record);
  assert.deepEqual(sorted(orphansOf(plain)), ['R/M1/M1@g1'], 'control: R/M1@g1 was replaced, so its child is an orphan');
  const f = plain.frontiers.get('kB');
  assert.equal(frontierParentReplaced(plain, f), true);
  const adopted = foldRecord(record);
  adopted.adopted.set('R/M1@g1', {});
  assert.deepEqual(sorted(orphansOf(adopted)), [], 'the adopted node\'s subtree stays live: its child is not an orphan');
  assert.equal(frontierParentReplaced(adopted, f), false);
});

test('K4 liveNodesByPath: one list per path, newest first; an ADOPTED older generation is live beside the new-era node (latestByPath returns ONE node per path and cannot); with no adoption it is exactly the newest node of each path', () => {
  const plain = foldRecord(record);
  const keys = m => Object.fromEntries([...m].map(([path, list]) => [path, list.map(n => `${n.node}@g${n.generation}`)]));
  assert.deepEqual(keys(liveNodesByPath(plain)), { R: ['R@g1'], 'R/M1': ['R/M1@g2'], 'R/M2': ['R/M2@g1'], 'R/M1/M1': ['R/M1/M1@g1'] });
  const adopted = foldRecord(record);
  adopted.adopted.set('R/M1@g1', {});
  assert.deepEqual(keys(liveNodesByPath(adopted))['R/M1'], ['R/M1@g2', 'R/M1@g1'], 'both nodes of the path, newest first');
  assert.deepEqual(keys(liveNodesByPath(adopted, [adopted.nodes.get('R/M2@g1')])), { 'R/M2': ['R/M2@g1'] }, 'the optional node list narrows it');
});
