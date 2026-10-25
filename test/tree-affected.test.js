// The affected set of a stop (0.8.3 M5e slice 1; PLAN 8.4, Astra N5; M5 exit checks L3 closure, L6, L8 second half) from the RECORD, on the real depth-2 tree (all-mock, $0): R/M1 splits into three children, R/M2 expects from R/M1
// (so it is registered only after R/M1's whole subtree), R/M3 is independent. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { foldRecord } from '../src/tree-transitions.js';
import { affectedFor, treeGraph } from '../src/tree-affected.js';
import { consumersWaiting } from '../src/tree-close.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const nodesOf = a => a.affected.map(x => x.node);
const view = r => { const record = readTreeRecord(r.t.rootDir); return { record, state: stateOf(record), runsDir: r.t.runsDir }; };

/** The L8 tree: stage 'one' = R/M1 and R/M3 closed, R/M1's frontier previewed (R/M2 not registered); stage 'two' = everything closed, R/M2 registered with dependsOn the provider and each of its children. */
async function deepTree(stage) {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  const one = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.deepEqual(one.started.map(s => s.node), ['R/M1', 'R/M3']);
  if (stage === 'two') {
    approvePending(r);
    const two = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
    assert.deepEqual(two.started.map(s => s.node), ['R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2']);
  }
  return r;
}

test('L3 (closure) / L6 / L8 second half, everything finished: a stop in R/M1/M3 (independent of its siblings, EMPTY provides/expects) reaches R/M2 through dependsOn read from node_registered; a stop in R/M1/M1 also reaches its consumer sibling R/M1/M2 by the block edge; R/M3 (D) is never touched', { timeout: 400_000 }, async () => {
  const r = await deepTree('two');
  const { record, state, runsDir } = view(r);
  const reg = record.events.find(e => e.event === 'node_registered' && e.node === 'R/M2');
  assert.deepEqual(reg.dependsOn.map(d => d.node), ['R/M1', 'R/M1/M1', 'R/M1/M2', 'R/M1/M3'], 'the registered entries are objects { node, generation, thinContractSha256 }'); assert.ok(reg.dependsOn.every(d => typeof d === 'object' && d.generation === 1 && d.thinContractSha256));
  const a3 = affectedFor({ record, state, runsDir, node: 'R/M1/M3' });
  assert.deepEqual(nodesOf(a3), ['R/M1/M3', 'R/M2'], 'L6: an empty provides/expects does not stop the traversal: R/M2 depends on R/M1/M3'); assert.match(a3.why.get('R/M2'), /depends on R\/M1\/M3/);
  const a1 = affectedFor({ record, state, runsDir, node: 'R/M1/M1' });
  assert.deepEqual(nodesOf(a1), ['R/M1/M1', 'R/M1/M2', 'R/M2'], 'L3/L8: the consumer sibling and the finished consumer R/M2, both by their registered dependsOn'); assert.match(a1.why.get('R/M1/M2'), /depends on R\/M1\/M1/, 'registered: its dependsOn names the provider');
  assert.equal(a1.affected.every(x => x.generation === 1), true); assert.equal(a1.rootAffected, false); assert.equal(a1.graphReadable, true);
  assert.equal(nodesOf(a1).includes('R/M3'), false, 'D (the independent sibling) keeps running');
});

test('before the consumer is registered the same closure comes from the block edges alone (no dependsOn yet): a stop in R/M1 reaches R/M2 (it expects from R/M1) and everything below R/M1, not R/M3; children not registered yet are known from the verified split', { timeout: 400_000 }, async () => {
  const r = await deepTree('one');
  const { record, state, runsDir } = view(r);
  assert.equal(state.nodes.has('R/M2@g1'), false);
  const a = affectedFor({ record, state, runsDir, node: 'R/M1' });
  assert.deepEqual(nodesOf(a), ['R/M1', 'R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2'], 'below R/M1 (its split\'s children, unregistered) and the consumer R/M2 by the edge R/M1 > R/M2');
  assert.deepEqual(a.affected.map(x => x.generation), [1, 1, 1, 1, 1], 'an unregistered child counts at generation 1');
  assert.match(a.why.get('R/M2'), /expects an agreement from R\/M1/);
  assert.deepEqual(consumersWaiting({ record, state, runsDir, node: 'R/M1' }).map(w => w.node), ['R/M2'], 'the consumers of a node never include its own subtree (a close ends that subtree with it)');
  const g = treeGraph({ record, state, runsDir });
  assert.deepEqual(g.nodes.find(n => n.node === 'R/M2').dependsOn, [], 'not registered: nothing recorded');
});

test('the ROOT ending needs_decision is pinned to {R}: its own stop puts nothing else in question (the plan stands unchanged, children keep running)', { timeout: 400_000 }, async () => {
  const r = await deepTree('two');
  const { record, state, runsDir } = view(r);
  const a = affectedFor({ record, state, runsDir, node: 'R' });
  assert.deepEqual(a.affected, [{ node: 'R', generation: 1 }]); assert.equal(a.rootAffected, false);
});

test('an unreadable graph treats every sibling as affected, not independent: R/M1\'s verified plan no longer reads, so a stop in R/M3 reaches R/M1 and R/M2 (and what is below R/M1)', { timeout: 400_000 }, async () => {
  const r = await deepTree('two');
  const file = join(r.t.runsDir, readTreeRecord(r.t.rootDir).events.find(e => e.event === 'node_registered' && e.node === 'R/M1').runId, 'deliverable.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nedited after the verification\n`);
  const { record, state, runsDir } = view(r);
  const a = affectedFor({ record, state, runsDir, node: 'R/M3' });
  assert.equal(a.graphReadable, false);
  for (const p of ['R/M1', 'R/M2', 'R/M3']) assert.ok(nodesOf(a).includes(p), p);
  assert.match(a.why.get('R/M1'), /graph could not be read/);
});

test('the generation comes out right (the stale-mark keys and decision_recorded.affected key on node@gN): R/M1 registered at g1 and g2, R/M2 depending on R/M1@g2 -> R/M1 at generation 2, R/M2 at 1; an unregistered node counts at 1 (in-memory record, nothing run)', () => {
  const run = (n, g) => ({ node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: 'R', frontierKey: `k${g}`, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } });
  const pin = 'b'.repeat(64);
  const events = [
    { id: 'e1', event: 'tree_started', treeId: 't' },
    { id: 'e2', event: 'node_registered', ...run('R/M1', 1) },
    { id: 'e3', event: 'node_registered', ...run('R/M1', 2) },
    { id: 'e4', event: 'node_registered', ...run('R/M2', 1), dependsOn: [{ node: 'R/M1', generation: 2, thinContractSha256: pin }] },
  ];
  const record = { events, tree: {}, corrupt: [] };
  const a = affectedFor({ record, state: foldRecord(events), runsDir: '/nonexistent', node: 'R/M1' });
  assert.deepEqual(a.affected, [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 1 }]); assert.match(a.why.get('R/M2'), /depends on R\/M1/);
});

test('the root pin yields to obligation carriers: affectedFor({ node: R, obligationCarriers }) is NOT pinned to {R} (the root\'s own needs_decision is; an obligation decision is built from its carriers, seedless)', () => {
  const run = (n, g) => ({ node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: 'R', frontierKey: `k${g}`, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } });
  const events = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', event: 'node_registered', ...run('R/M1', 1) }, { id: 'e3', event: 'node_registered', ...run('R/M2', 1) }];
  const record = { events, tree: {}, corrupt: [] }; const state = foldRecord(events);
  assert.deepEqual(affectedFor({ record, state, runsDir: '/nonexistent', node: 'R' }).affected, [{ node: 'R', generation: 1 }]);
  const withCarriers = affectedFor({ record, state, runsDir: '/nonexistent', node: 'R', obligationCarriers: ['R/M1'] });
  assert.ok(withCarriers.affected.some(a => a.node === 'R/M1'), 'the carrier is in the set, not swallowed by the pin');
  const seedless = affectedFor({ record, state, runsDir: '/nonexistent', node: 'R/M2', obligationCarriers: ['R/M1'], seedless: true });
  assert.deepEqual(seedless.affected.map(a => a.node), ['R/M1'], 'seedless: the stopped node R/M2 is not dragged in');
});
