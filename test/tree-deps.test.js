// 0.8.3 M5a: who depends on whom (PLAN 8.1, 8.4) and qualified ids (PLAN 10.1). PURE: plain data in, plain data out, no file, no record, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { affectedSet, blockEdges, isWithin, parentPathOf, pathOfKey, subtreeEligible, subtreeOf } from '../src/tree-deps.js';
import { parseQid, qidIndex, qualify, resolveQid } from '../src/tree-qid.js';
import { validBlock } from './helpers/split-fixture.js';

const node = (n, dependsOn = []) => ({ node: n, generation: 1, dependsOn });

test('isWithin is a path test, not a prefix test: R/M20 is not within R/M2; the parent of R/M2/M1 is R/M2; a key loses its generation', () => {
  assert.equal(isWithin('R/M2/M1', 'R/M2'), true); assert.equal(isWithin('R/M2', 'R/M2'), true); assert.equal(isWithin('R/M20', 'R/M2'), false); assert.equal(isWithin('R', 'R/M2'), false);
  assert.equal(parentPathOf('R/M2/M1'), 'R/M2'); assert.equal(parentPathOf('R'), null);
  assert.equal(pathOfKey('R/M2@g3'), 'R/M2');
});

test('blockEdges maps block child ids to node PATHS through the block: an agreement and a non-empty provides/expects entry both make an edge; an id the block does not hold is reported, never guessed; a replacement generation whose ids repeat is a different edge set under its own parent', () => {
  const block = validBlock();                                       // K1 (M1) provides A1 to K2 (M2)
  const r = blockEdges('R', block);
  assert.deepEqual(r.edges, [{ provider: 'R/M1', consumer: 'R/M2' }]); assert.deepEqual(r.unreadable, []);
  const deeper = blockEdges('R/M1', block);                          // the same ids one level down are other paths
  assert.deepEqual(deeper.edges, [{ provider: 'R/M1/M1', consumer: 'R/M1/M2' }]);
  const broken = validBlock(); broken.agreements[0].to = 'K9';
  const b = blockEdges('R', broken);
  assert.ok(b.unreadable.length >= 1 && b.edges.every(e => e.consumer !== undefined), 'an unknown child id is reported');
  assert.equal(blockEdges('R', null).edges.length, 0);
});

test('PLAN 8.4 (L3): A ends needs_decision; B and C expect from A, D is independent => B and C are affected, D is not; each says why', () => {
  const nodes = ['R', 'R/A', 'R/B', 'R/C', 'R/D'].map(n => node(n));
  const edges = [{ provider: 'R/A', consumer: 'R/B' }, { provider: 'R/A', consumer: 'R/C' }];
  const { affected, rootAffected, why } = affectedSet({ stopped: 'R/A', nodes, edges });
  assert.deepEqual([...affected].sort(), ['R/A', 'R/B', 'R/C']); assert.equal(rootAffected, false);
  assert.match(why.get('R/B'), /expects an agreement from R\/A/);
});

test('PLAN 8.4 (L6): A1 is a child of A with EXPLICIT EMPTY provides/expects, B consumes A => A1 stopping still affects B (a consumer of A is a consumer of everything inside A), by the block edge AND by dependsOn', () => {
  const nodes = [node('R'), node('R/A'), node('R/A/A1'), node('R/B', ['R/A', 'R/A/A1']), node('R/D')];
  const viaEdge = affectedSet({ stopped: 'R/A/A1', nodes: nodes.map(n => ({ ...n, dependsOn: [] })), edges: [{ provider: 'R/A', consumer: 'R/B' }] });
  assert.deepEqual([...viaEdge.affected].sort(), ['R/A/A1', 'R/B']);
  const viaDeps = affectedSet({ stopped: 'R/A/A1', nodes, edges: [] });
  assert.deepEqual([...viaDeps.affected].sort(), ['R/A/A1', 'R/B'], 'B finished: its registered dependsOn names A1');
  assert.match(viaDeps.why.get('R/B'), /depends on R\/A\/A1/);
});

test('PLAN 8.4 (L8): B expects from A and A has children A1 and A2; B depends on A, A1 and A2; A1 stopping marks B (through dependsOn) and A2 is not affected unless it sits below the stopped node', () => {
  const nodes = [node('R'), node('R/A'), node('R/A/A1'), node('R/A/A2'), node('R/B', ['R/A', 'R/A/A1', 'R/A/A2'])];
  const { affected } = affectedSet({ stopped: 'R/A/A1', nodes, edges: [{ provider: 'R/A', consumer: 'R/B' }] });
  assert.deepEqual([...affected].sort(), ['R/A/A1', 'R/B']);
});

test('descendants of an affected node are affected; a stop below a node does not affect its parent or its siblings', () => {
  const nodes = [node('R'), node('R/A'), node('R/A/A1'), node('R/A/A1/X'), node('R/A/A2')];
  const { affected } = affectedSet({ stopped: 'R/A/A1', nodes, edges: [] });
  assert.deepEqual([...affected].sort(), ['R/A/A1', 'R/A/A1/X']);
});

test('PLAN 8.4 (L5): an obligation the stop is about joins the nodes that carry it; one that originated at the root reaches the root (rootAffected), one made global inside A\'s subtree binds A\'s subtree only', () => {
  const nodes = [node('R'), node('R/A'), node('R/A/A1'), node('R/B'), node('R/C')];
  const root = affectedSet({ stopped: 'R/A', nodes, edges: [], obligationCarriers: ['R', 'R/A', 'R/A/A1', 'R/B', 'R/C'] });
  assert.equal(root.rootAffected, true); assert.deepEqual([...root.affected].sort(), ['R', 'R/A', 'R/A/A1', 'R/B', 'R/C']);
  const sub = affectedSet({ stopped: 'R/A', nodes, edges: [], obligationCarriers: ['R/A', 'R/A/A1'] });
  assert.equal(sub.rootAffected, false); assert.deepEqual([...sub.affected].sort(), ['R/A', 'R/A/A1'], 'the unrelated branch C keeps running');
});

test('an unreadable graph makes every sibling of the stopped node (and everything below them) affected, never assumed independent', () => {
  const nodes = [node('R'), node('R/A'), node('R/B'), node('R/B/X'), node('R/C')];
  const { affected } = affectedSet({ stopped: 'R/A', nodes, edges: [], graphReadable: false });
  assert.deepEqual([...affected].sort(), ['R/A', 'R/B', 'R/B/X', 'R/C']);
});

test('subtreeOf lists a provider and everything below it in path order, and nothing that merely shares a prefix', () => {
  const nodes = [node('R/A/A2'), node('R/A'), node('R/AB'), node('R/A/A1'), node('R/B')];
  assert.deepEqual(subtreeOf(nodes, 'R/A').map(n => n.node), ['R/A', 'R/A/A1', 'R/A/A2']);
});

test('PLAN 8.1 eligibility (L7, L8): every node of the provider\'s subtree must be closed and passed, not needs_decision, no open stop, items 1-2 intact; item 3 matters ONLY when the node holds a block, so a finished LEAF provider is eligible', () => {
  const ok = n => ({ node: n, closed: true, passed: true, status: 'ready_for_build', openStop: false, itemsOk: true, hasBlock: false, blockOk: false });
  assert.deepEqual(subtreeEligible([ok('R/A')]), { eligible: true, why: [] }, 'a leaf: no block, still eligible');
  assert.equal(subtreeEligible([ok('R/A'), { ...ok('R/A/A1'), hasBlock: true, blockOk: true }]).eligible, true);
  const why = f => subtreeEligible(f).why.join(' | ');
  assert.match(why([{ ...ok('R/A'), closed: false }]), /R\/A has not closed/);
  assert.match(why([{ ...ok('R/A'), passed: false }]), /closed but the panel did not pass it/);
  assert.match(why([{ ...ok('R/A'), status: 'needs_decision' }]), /needs_decision/);
  assert.match(why([{ ...ok('R/A'), openStop: true }]), /open stop/);
  assert.match(why([{ ...ok('R/A'), itemsOk: false }]), /items 1-2/);
  assert.match(why([{ ...ok('R/A'), hasBlock: true, blockOk: false }]), /did not reproduce/);
  assert.match(why([ok('R/A'), { ...ok('R/A/A2'), closed: false }]), /R\/A\/A2 has not closed/, 'one open node in the subtree is enough');
});

test('qualified ids: R/M2@g1:M1 parses; a bare id parses; a hostile or half-formed one is neither', () => {
  assert.deepEqual(parseQid('R/M2@g1:M1'), { qualified: true, node: 'R/M2', generation: 1, id: 'M1' });
  assert.deepEqual(parseQid('R@g12:A3'), { qualified: true, node: 'R', generation: 12, id: 'A3' });
  assert.deepEqual(parseQid('M1'), { qualified: false, id: 'M1' });
  for (const bad of ['', 'R/M2@g0:M1', 'R/../x@g1:M1', 'R/M2:M1', 'R/M2@g1:', '@g1:M1', 'M 1', 'R/M2@g1:M1:extra', 'x/y', '../M1', 'R\\M2@g1:M1']) assert.equal(parseQid(bad), null, JSON.stringify(bad));
  assert.equal(qualify({ node: 'R/M2', generation: 1, id: 'M1' }), 'R/M2@g1:M1');
});

test('PLAN 10.1 (L15): a bare M1 that two nodes hold lists both qualified ids and resolves to nothing; R/M2@g1:M1 resolves; a bare id held once resolves; the generation tells g1 from g2; kind restricts', () => {
  const b = validBlock();
  const index = qidIndex([{ node: 'R', generation: 1, block: b }, { node: 'R/M2', generation: 1, block: b }, { node: 'R/M2', generation: 2, block: b }]);
  const bare = resolveQid('M1', index, { kind: 'milestone' });
  assert.equal(bare.ok, false); assert.deepEqual(bare.matches, ['R@g1:M1', 'R/M2@g1:M1', 'R/M2@g2:M1']); assert.match(bare.reason, /held by 3 nodes/);
  assert.deepEqual(resolveQid('R/M2@g1:M1', index, { kind: 'milestone' }).match, { node: 'R/M2', generation: 1, kind: 'milestone', id: 'M1' });
  assert.equal(resolveQid('R/M2@g3:M1', index).ok, false);
  const single = qidIndex([{ node: 'R', generation: 1, block: b }]);
  assert.equal(resolveQid('M1', single, { kind: 'milestone' }).ok, true);
  assert.equal(resolveQid('A1', single, { kind: 'milestone' }).ok, false, 'an agreement id is not a milestone');
  assert.equal(resolveQid('A1', single, { kind: 'agreement' }).ok, true);
  assert.equal(resolveQid('../x', single).ok, false);
  assert.deepEqual(resolveQid('Z9', single).matches, []);
});
