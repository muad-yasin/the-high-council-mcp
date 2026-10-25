// S8-9 §11.12 (C&C's go, 13 Oct 2026): the depth-2 REAL-FLOW fixture (test/helpers/depth-two-replan.js) reaches the state C5's walk starts from, through the person's verbs only. The first test pins what the FIXTURE gives (a real tree at depth 2, one
// piece of R/M1's branch failed, a root re-plan decided); the second states what C2a must deliver (a `todo` until then).
import test from 'node:test';
import assert from 'node:assert/strict';
import { deadKeys, heldKeys } from '../src/tree-transitions.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';

let S;
const fixture = async () => { S ??= await driveToDepthTwoReplan(); return S; };

test('DEPTH-2 FIXTURE: a real tree at depth 2 - R/M1 split into three children, two of them closed passed, the independent one NOT passed with a blocked-child stop - then a root re-plan decided (R@g2 opened, nothing of it approved or registered)', async () => {
  const f = await fixture();
  const phase = (n, g = 1) => { const x = f.nodeOf(n, g); return x ? [x.phase, x.outcome] : null; };
  assert.deepEqual(phase('R/M1'), ['closed', 'passed']); assert.deepEqual(phase('R/M3'), ['closed', 'passed']);
  assert.deepEqual(phase('R/M1/M1'), ['closed', 'passed']); assert.deepEqual(phase('R/M1/M2'), ['closed', 'passed']);
  assert.equal(phase('R/M1/M3')[0], 'closed'); assert.notEqual(phase('R/M1/M3')[1], 'passed');
  assert.equal(f.nodeOf('R/M2', 1), undefined, 'R/M2 expects from R/M1 and was never registered');
  assert.deepEqual(f.kinds('split_verified').map(e => [e.node, e.generation, e.children]).filter(x => x[0] === 'R/M1'), [['R/M1', 1, ['R/M1/M1', 'R/M1/M2', 'R/M1/M3']]]);
  assert.deepEqual([f.childStop.node, f.childStop.source], ['R/M1/M3', 'blocked']);
  assert.deepEqual([f.rootStop.node, f.rootStop.source], ['R', 'obligation']);
  assert.equal(f.decision.replansRoot, true); assert.deepEqual(f.opened.nodes, [{ node: 'R', generation: 2 }]);
  assert.equal(f.nodeOf('R', 2), undefined, 'R@g2 is decided, not registered');
});

// What this fixture is FOR: after S8-9 C2a (per-node eligibility) the finished pieces of R/M1's branch are HELD for the new R/M1's split instead of dying with the failed one. The test below states THAT (the ruled-for behaviour) and is a `todo` until C2a lands -
// a todo failure does not fail the suite, and C2a's builder turns it into a plain `test`. (An earlier version asserted today's whole-subtree list as a passing baseline; C&C: that pins the behaviour Muad ruled against as a pass condition.)
// TURNED INTO A PLAIN test 18 Okt 2026 (C2a-record K1; the todo's own instruction: "C2a's builder turns it into a plain `test`").
test('S8-9 C2a (per-node eligibility): the root re-plan decision sets aside only what fails ITSELF - the failed R/M1/M3 - and the finished R/M1, R/M1/M1 and R/M1/M2 are HELD (not dead), with the other finished top-level child R/M3', async () => {
  const f = await fixture();
  const st = f.state();
  assert.equal(f.decision.affected.some(a => a.node === 'R' && a.generation === 1), true, 'the record\'s shape: the replaced root generation is in the decision\'s list');
  const setAside = f.decision.affected.filter(a => a.node !== 'R').map(a => `${a.node}@g${a.generation}`).sort();
  assert.deepEqual(setAside, ['R/M1/M3@g1'], 'only the piece that failed itself is set aside');
  assert.deepEqual([...heldKeys(st)].sort(), ['R/M1/M1@g1', 'R/M1/M2@g1', 'R/M1@g1', 'R/M3@g1']);
  assert.ok(deadKeys(st).has('R/M1/M3@g1') && !deadKeys(st).has('R/M1/M1@g1'));
});
