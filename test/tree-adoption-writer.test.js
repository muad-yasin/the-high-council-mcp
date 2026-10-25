// 0.8.3 M7 apply, C2b-2 (plan Review/Build_0.8.3/m7/C2b2_Plan_DRAFT_2026-10-18.md; C&C thcmcp-6d: PASS TO CODE, PICK HELD for Muad's regenerate answer): the WRITER of whole adoptions. The tree is the REAL depth-2 tree of test/helpers/depth-two-replan.js taken through the person's verbs
// (a root re-plan; R@g2 approved and run, its children frontier waiting): R/M3@g1 (a finished leaf, its inputs unchanged) is a candidate for the slot R/M3; R/M1@g1 is not whole (its child R/M1/M3 was not signed). $0, all mock chains.
// Rows: describe writes `reused` for R/M3 and only for it; the screen names the slot (+ a known-bad view that drops it); the approval adopts it through the real verb and the sitting registers the other children but NOT the slot; the fan-out counter is one helper; a cross-level pair is refused at pairing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as WIRE from '../src/tree-reuse-wire.js';
import * as FAN from '../src/tree-fan-out.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { planRecovery } from '../src/tree-recovery.js';
import * as DL from '../src/tree-derive-load.js';
import { candidatesOf } from '../src/tree-transitions.js';
import { adoptedTree, replanParent } from './helpers/adoption-fixture.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';

let S;
const fixture = async () => {
  if (!S) {
    S = await driveToDepthTwoReplan();
    let r = await S.approve(); assert.equal(r.code, 0, `the new root plan is approved: ${r.text}`);
    r = await S.sit(); assert.equal(r.code, 20, `R@g2 runs and its children frontier waits: ${r.text}`);
  }
  return S;
};
const describeNow = () => { const pending = findPendingFrontier({ rootDir: S.rootDir }); assert.ok(pending, 'a children frontier waits'); return { pending, described: describeFrontier({ rootDir: S.rootDir, work: S.work, pending }) }; };

test('C2b-2 describe: the finished, unchanged R/M3 is REUSED (entry on its preview child, no money, no run), R/M1 (its branch is not whole) is not, and every other child is a new run', async () => {
  await fixture();
  const { described } = describeNow();
  assert.ok(!described.refusal, JSON.stringify(described.refusal));
  const kid = node => described.view.children.find(c => c.node === node);
  const m3 = kid('R/M3'); assert.ok(m3?.reused, `R/M3 is reused: ${JSON.stringify(described.view.children.map(c => [c.node, !!c.reused]))}`);
  assert.deepEqual([m3.reused.adoptsNode, m3.reused.adoptsGeneration, m3.reused.runId], ['R/M3', 1, S.nodeOf('R/M3', 1).runId]);
  assert.match(m3.reused.fieldsSha256, /^[0-9a-f]{64}$/); assert.ok(Array.isArray(m3.reused.identityMap));
  assert.deepEqual([m3.admitted, m3.grant, m3.ceiling, m3.mayStop], [true, 0, 0, false], 'filled, never sized');
  assert.equal(kid('R/M1')?.reused, undefined, 'a node adopted as itself (its branch is not whole) is C2b-3: its slot gets a new run');
  const inPreview = described.preview.children.find(c => c.node === 'R/M3');
  assert.deepEqual(inPreview.reused, m3.reused, 'the entry is inside the payload the approval binds');
  for (const c of described.view.children.filter(x => x !== m3)) assert.equal(c.reused, undefined, `${c.node} is not reused`);
});

test('C2b-2 slots of DIFFERENT generations are compared together: R/M3 (generation 2) is still reused when its sibling R/M2 is proposed at generation 3 (a replacement frontier)', async () => {
  await fixture();
  const { pending } = describeNow();
  const mixed = { ...pending, children: [{ node: 'R/M3', generation: 2 }, { node: 'R/M2', generation: 3 }] };
  const described = describeFrontier({ rootDir: S.rootDir, work: S.work, pending: mixed });
  assert.ok(!described.refusal, JSON.stringify(described.refusal));
  assert.deepEqual(described.view.children.map(c => `${c.node}@g${c.generation}`).sort(), ['R/M2@g3', 'R/M3@g2']);
  assert.ok(described.view.children.find(c => c.node === 'R/M3')?.reused, 'finished work is not planned again because a sibling carries another number');
});

test('C2b-2 the screen names EVERY reused slot (and a view whose reused child the renderer would drop is caught)', async () => {
  await fixture();
  const { described } = describeNow();
  const text = renderFrontierText(described.view);
  assert.ok(described.view.children.some(c => c.reused), 'the view has a reused child (without one the loop below checks nothing)');
  for (const c of described.view.children.filter(x => x.reused)) {
    assert.ok(new RegExp(`REUSED[^\\n]*run ${c.reused.runId}\\b`).test(text), `${c.node} is named on the screen (C3 b: the pass-2 line, or the fallback when the reason is not at hand)`);
  }
  assert.match(text, /Approving authorizes up to \$[0-9.]+ of new paid runs/, 'the total counts the NEW grants only');
  const dropped = { ...described.view, children: described.view.children.map(c => { const { reused, ...rest } = c; return rest; }) };
  assert.ok(!/REUSED/.test(renderFrontierText(dropped)), 'known-bad: a view without the entry shows no such line, so the check above has something to fail on');
});

test('C2b-2 the REAL approval adopts R/M3@g1 into the slot, the sitting registers the others and NEVER the slot, and no money moves for it', async () => {
  await fixture();
  const before = readTreeRecord(S.rootDir); const spentBefore = before.events.length;
  const { described } = describeNow();
  const freshTotal = described.view.children.filter(c => c.admitted && !c.registered && !c.reused).reduce((n, c) => n + c.grant, 0);
  const r = await S.approve(); assert.equal(r.code, 0, r.text);
  assert.match(r.text, /Reused, nothing new started: R\/M3 \(R\/M3 generation 1\)/, 'the last line says what was reused');
  const st = stateOf(readTreeRecord(S.rootDir));
  assert.deepEqual([...st.adopted.keys()], ['R/M3@g1'], 'only the whole, unchanged candidate is adopted');
  assert.equal(st.adopted.get('R/M3@g1').slot, 'R/M3@g2');
  const approved = readTreeRecord(S.rootDir).events.filter(e => e.event === 'frontier_previewed').at(-1).children.find(c => c.node === 'R/M3');
  assert.deepEqual([approved.capUsd, approved.ceilingUsd, approved.admitted], [0, 0, true]);
  assert.ok(freshTotal > 0, 'the other children still get their equal share');
  const sit = await S.sit(); assert.ok([0, 20].includes(sit.code), sit.text);
  const registered = readTreeRecord(S.rootDir).events.filter(e => e.event === 'node_registered' && e.generation === 2).map(e => e.node);
  assert.ok(registered.includes('R/M1'), `the new children are registered (${registered.join(', ')})`);
  assert.ok(!registered.includes('R/M3'), `the reused slot is never registered (${registered.join(', ')})`);
  assert.ok(readTreeRecord(S.rootDir).events.length > spentBefore);
});

test('C2b-2 recovery (tree-recovery.js:118): a frontier whose only unregistered child is the REUSED slot has no child left to register', () => {
  const { t } = adoptedTree({ finishC: true });
  const rec = readTreeRecord(t.rootDir);
  const fk = stateOf(rec).adopted.get('R/M1/A@g1').frontierKey;       // the adopting frontier (the root's own frontier still has R/M2 to register: not this row's business)
  assert.deepEqual(planRecovery(rec).filter(a => a.action === 'register_next' && a.frontierKey === fk), [], JSON.stringify(planRecovery(rec)));
});

test('C2b-2 the candidate list after the ADOPTING plan is planned again: the adopted node and the new node of its old path are BOTH kept candidates (the adoption lapsed with its plan)', () => {
  const { t } = adoptedTree();
  replanParent(t);
  const st = stateOf(readTreeRecord(t.rootDir));
  const keys = candidatesOf(st).filter(c => c.state === 'kept' || c.state === 'held').map(c => c.key);
  assert.ok(keys.includes('R/M1/A@g1') && keys.includes('R/M1/A@g2'), `both nodes of the path are candidates (${keys.join(', ')})`);
  assert.equal(st.adopted.size, 0, 'no adoption is left');
});

test('C2b-2 fanOutOf: ONE counter for the width of a split - registered children plus the slots filled by a finished run, plus the reused slots a preview is about to propose', async () => {
  await fixture();
  const st = stateOf(readTreeRecord(S.rootDir));
  const fk = st.adopted.get('R/M3@g1').frontierKey;
  const registered = [...st.nodes.values()].filter(n => n.frontierKey === fk).length;
  assert.equal(FAN.fanOutOf(st, fk), registered + 1, 'the adopted slot counts, its own registration names the OLD frontier');
  assert.equal(FAN.fanOutOf(st, fk, { pending: 2 }), registered + 3);
  assert.equal(FAN.fanOutOf(st, 'no-such-frontier'), 0);
});

test('C2b-2 refuseCrossLevel: a pair whose candidate sits at another LEVEL than the slot is refused at pairing (before anyone is asked), naming both paths; a same-level pair is left alone', () => {
  const row = (node, adopts) => ({ node, verdict: 'same', field: null, reason: 'same', adopts: { node: adopts, generation: 1, runId: 'run' }, fieldsSha256: 'f', identityMap: [] });
  const pairs = new Map([['a', row('R/M2', 'R/M1/X')], ['b', row('R/M2', 'R/M3')]]);
  WIRE.refuseCrossLevel(pairs);
  assert.deepEqual([pairs.get('a').verdict, pairs.get('a').field], ['changed', 'depth']);
  assert.match(pairs.get('a').reason, /R\/M1\/X sits at level 2 and the slot R\/M2 at level 1/);
  assert.equal(pairs.get('a').adopts, undefined);
  assert.equal(pairs.get('b').verdict, 'same', 'the same level stays');
});

test('C2b-2 refuseCrossLevel: a pair at the same level but under ANOTHER PARENT (R/M2/X into the slot R/M1/B) is refused at pairing too; the same parent stays (known-bad: no parent clause leaves it "same")', () => {
  const row = (node, adopts) => ({ node, verdict: 'same', field: null, reason: 'same', adopts: { node: adopts, generation: 1, runId: 'run' }, fieldsSha256: 'f', identityMap: [] });
  const pairs = new Map([['a', row('R/M1/B', 'R/M2/X')], ['b', row('R/M1/B', 'R/M1/A')]]);
  WIRE.refuseCrossLevel(pairs);
  assert.deepEqual([pairs.get('a').verdict, pairs.get('a').field], ['changed', 'parent']);
  assert.match(pairs.get('a').reason, /R\/M2\/X sits under R\/M2 and the slot R\/M1\/B under R\/M1/);
  assert.equal(pairs.get('a').adopts, undefined);
  assert.equal(pairs.get('b').verdict, 'same', 'the same parent stays');
});

test('C2b-2 wholeBranchOf: R/M3@g1 (a finished leaf) is whole; R/M1@g1 is not (its child R/M1/M3 did not pass)', async () => {
  await fixture();
  const st = stateOf(readTreeRecord(S.rootDir));
  assert.equal(WIRE.wholeBranchOf(st, 'R/M3@g1'), true);
  assert.equal(WIRE.wholeBranchOf(st, 'R/M1@g1'), false);
  assert.equal(WIRE.wholeBranchOf(st, 'R/Nope@g1'), false, 'a node the record does not hold is not whole');
});

// wholeBranchOf on small hand-made states: it is a pure function of state.nodes and state.frontiers
const mk = (nodes, frontiers = [], extra = {}) => ({ nodes: new Map(nodes.map(n => [`${n.node}@g${n.generation}`, { phase: 'closed', outcome: 'passed', closedStatus: 'ready_for_build', verifiedSplit: null, frontierKey: null, ...n }])), frontiers: new Map(frontiers), stale: new Set(), maxOpened: new Map(), ...extra });
const fr = (key, parentNode, parentGeneration) => [key, { parentNode, parentGeneration }];
test('C2b-2 wholeBranchOf (a): a node with NO verified split is a leaf (whole); a split verified before the record listed its children (children null) is unknown, so NOT whole; a named child that is not registered is not whole', () => {
  assert.equal(WIRE.wholeBranchOf(mk([{ node: 'R/X', generation: 1 }]), 'R/X@g1'), true, 'a leaf');
  assert.equal(WIRE.wholeBranchOf(mk([{ node: 'R/X', generation: 1, verifiedSplit: { children: null } }]), 'R/X@g1'), false, 'old shape: unknown');
  assert.equal(WIRE.wholeBranchOf(mk([{ node: 'R/X', generation: 1, verifiedSplit: { children: ['R/X/D'] } }]), 'R/X@g1'), false, 'its child is not registered');
  assert.equal(WIRE.wholeBranchOf(mk([{ node: 'R/X', generation: 1, verifiedSplit: { children: [] } }]), 'R/X@g1'), true, 'a split that names no child');
});

test('C2b-2 wholeBranchOf (b): a child planned again IN PLACE under the same parent generation counts by its LIVE (newest) generation only - a finished older one does not make the branch whole while the newer one failed (known-bad: kids.some over every generation)', () => {
  const st = mk([
    { node: 'R/X', generation: 1, verifiedSplit: { children: ['R/X/D'] } },
    { node: 'R/X/D', generation: 1, frontierKey: 'f1' },
    { node: 'R/X/D', generation: 2, frontierKey: 'f1', outcome: 'failed' },
  ], [fr('f1', 'R/X', 1)]);
  assert.equal(WIRE.wholeBranchOf(st, 'R/X/D@g1'), true, 'the older generation on its own is whole');
  assert.equal(WIRE.wholeBranchOf(st, 'R/X@g1'), false, 'but the branch follows the live generation, which failed');
});

test('C2b-2 wholeBranchOf (d): a child whose NEWER generation is OPENED but not registered yet, or that a stop put in question (stale), does not make the branch whole - it is being planned again or decided (known-bad: the registered generation alone says whole)', () => {
  const nodes = [{ node: 'R/X', generation: 1, verifiedSplit: { children: ['R/X/D'] } }, { node: 'R/X/D', generation: 1, frontierKey: 'f1' }];
  assert.equal(WIRE.wholeBranchOf(mk(nodes, [fr('f1', 'R/X', 1)]), 'R/X@g1'), true, 'control: finished, passed, nothing opened, nothing stale');
  assert.equal(WIRE.wholeBranchOf(mk(nodes, [fr('f1', 'R/X', 1)], { maxOpened: new Map([['R/X/D', 2]]) }), 'R/X@g1'), false, 'D@g2 is opened, not registered');
  assert.equal(WIRE.wholeBranchOf(mk(nodes, [fr('f1', 'R/X', 1)], { stale: new Set(['R/X/D@g1']) }), 'R/X@g1'), false, 'D@g1 is stale');
});

test('C2b-2 fanOutOf (c): the fold ALWAYS holds `adopted` (a Map, empty without an adoption), so the helper needs no guard', async () => {
  const st = stateOf(readTreeRecord((await fixture()).rootDir));
  assert.ok(st.adopted instanceof Map);
  assert.equal(FAN.fanOutOf({ nodes: new Map(), adopted: new Map() }, 'x'), 0);
});

test('C2b-2 providerSubtreeOf: below an ADOPTED provider a consumer is handed the provider\'s OWN descendants (R/M1/A/D@g1), never the new plan\'s node on the same path (D@g2); below the new node it is the new one (known-bad: the newest-of-path filter)', () => {
  const { t } = adoptedTree({ deep: true });
  const st = stateOf(readTreeRecord(t.rootDir));
  const keys = list => list.map(n => `${n.node}@g${n.generation}`);
  assert.deepEqual(keys(DL.providerSubtreeOf(st, st.nodes.get('R/M1/A@g1'))), ['R/M1/A/D@g1']);
  assert.deepEqual(keys(DL.providerSubtreeOf(st, st.nodes.get('R/M1/A@g2'))), ['R/M1/A/D@g2']);
});

test('C2b-2 providerSubtreeOf: inside the adopted branch a node planned again after the adoption (D@g3) replaces D@g1 for the consumer (known-bad: every node of the branch, both generations)', () => {
  const { t } = adoptedTree({ deep: true, regenerate: true });
  const st = stateOf(readTreeRecord(t.rootDir));
  const keys = list => list.map(n => `${n.node}@g${n.generation}`);
  assert.deepEqual(keys(DL.providerSubtreeOf(st, st.nodes.get('R/M1/A@g1'))), ['R/M1/A/D@g3']);
});
