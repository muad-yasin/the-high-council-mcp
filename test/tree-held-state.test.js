// 0.8.3 M6, the HELD state of a root re-plan (contract Review/Build_0.8.3/M6_HeldState_Contract_2026-10-12.md, C&C gate 1 passed; design note 16.4/16.7): an ELIGIBLE old child (it and every descendant closed, passed, not needs_decision, no open
// stop) is HELD between the replacing decision's `generation_opened` and the release; an ineligible one is DEAD from the decision. Held and dead never overlap. Fold units on raw events, as test/tree-root-generation.test.js does.
// UPDATED 18 Okt 2026 (C2a-record K2): the old INTERIM note read "until S8-9 (reuse) nothing is adopted, so every held node dies at its release". Release is no longer death: a held node that a later frontier approval or a held_released record goes past is KEPT (held, passed over, not dead) until it is adopted (C2b) or the tree is abandoned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keptNodesOf } from '../src/tree-handoff.js';
import { KEPT_PHRASE, candidateOriginOf, candidatesOf, deadKeys, eventShapeError, foldRecord, heldKeys, heldPhraseOf, ineligibleBelowRoot, keptKeys, orphansOf, transitionRefusal } from '../src/tree-transitions.js';
import { FIXTURE_BOUND, GATE_FIELDS, IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';

const G = GATE_FIELDS;
const runFor = (n, g) => (n === 'R' && g === 1 ? 't' : `run-${n.replace(/\//g, '-')}-${g}`);
const reg = (n, g, parent, fk, extra = {}) => ({ event: 'node_registered', node: n, generation: g, runId: runFor(n, g), attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' }, ...extra });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: runFor(n, g), pid: 1, host: 'h' });
const closed = (id, n, g, extra = {}) => ({ id, event: 'node_closed', node: n, generation: g, runId: runFor(n, g), outcome: 'passed', passed: true, status: null, share: 'released', ...extra });
const stopped = (id, n, g) => ({ id, event: 'node_stopped', node: n, generation: g, runId: runFor(n, g), reason: 'budget' });
const split = (id, n, children, extra = {}) => ({ id, event: 'split_verified', node: n, generation: 1, runId: runFor(n, 1), splitSha256: 's', ...(children === undefined ? {} : { children }), ...extra });
const stop = (id, n, g) => ({ id, event: 'needs_decision_opened', node: n, generation: g, runId: runFor(n, g), source: 'node_closed', affected: [{ node: n, generation: g }] });

// R closed (needs_decision); children R/M1 (closed passed, with a closed passed child R/M1/M1), R/M2 (closed passed, Status needs_decision), R/M3 (stopped at its cap)
const TREE = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, { status: 'needs_decision' }),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }, { node: 'R/M3', generation: 1 }], 'e3'),
  { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1), split('e4v', 'R/M1', ['R/M1/M1']),
  ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e5'), { id: 'e6', ...reg('R/M1/M1', 1, 'R/M1', 'kB') }, started('e6b', 'R/M1/M1', 1), closed('e6c', 'R/M1/M1', 1),
  { id: 'e7', ...reg('R/M2', 1, 'R', 'kA') }, started('e7b', 'R/M2', 1), closed('e7c', 'R/M2', 1, { status: 'needs_decision' }),
  { id: 'e8', ...reg('R/M3', 1, 'R', 'kA') }, started('e8b', 'R/M3', 1), stopped('e8c', 'R/M3', 1)];
const ROOT_STOP = stop('e9', 'R', 1);
const decide = (affected, extra = {}) => ({ id: 'e10', event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: 'e9', replansRoot: true, affected, ...G, ...extra });
const OPEN = { id: 'e11', event: 'generation_opened', decisionId: 'e10', nodes: [{ node: 'R', generation: 2 }] };
const keys = (...ks) => ks.map(k => ({ node: k.split('@g')[0], generation: Number(k.split('@g')[1]) }));
const RIGHT = keys('R@g1', 'R/M2@g1', 'R/M3@g1');
const replanned = foldRecord([...TREE, ROOT_STOP, decide(RIGHT), OPEN]);
const why = (state, event) => transitionRefusal(state, { id: 'e99', ...event })?.reason ?? null;

test('THE DISCRIMINATING TEST: after the root re-plan opens its generation, the ELIGIBLE child R/M1 and its child are HELD, the ineligible R/M2 (Status needs_decision) and R/M3 (stopped) and the old root are DEAD; held and dead never overlap (at bdd248f every one of them is dead)', () => {
  assert.deepEqual([...heldKeys(replanned)].sort(), ['R/M1/M1@g1', 'R/M1@g1']);
  const dead = deadKeys(replanned);
  for (const k of ['R@g1', 'R/M2@g1', 'R/M3@g1']) assert.ok(dead.has(k), `${k} is dead`);
  for (const k of ['R/M1@g1', 'R/M1/M1@g1']) assert.equal(dead.has(k), false, `${k} is held, not dead`);
  assert.ok([...heldKeys(replanned)].every(k => !dead.has(k)), 'never two');
  assert.ok(orphansOf(replanned).has('R/M1@g1') && orphansOf(replanned).has('R/M1/M1@g1'), 'orphansOf is untouched: a held node is outside every live graph');
  // before the generation opens nothing is held yet (the decision alone changes no node)
  assert.equal(heldKeys(foldRecord([...TREE, ROOT_STOP, decide(RIGHT)])).size, 0);
});

// EDITED 18 Okt 2026 (C2a-record K1; C2a_Gate_Page.md section 3, Astra #3/#5). OLD title and loop: "ONE bad state anywhere in a child's subtree makes the child AND its whole subtree ineligible" (every variant expected ['R/M1/M1@g1', 'R/M1@g1']).
// NEW: each node is judged ON ITS OWN - only the node that fails itself is ineligible; its finished neighbours stay candidates (variants below carry their own expected set). WHY: a finished sub-plan must not be thrown away because a sibling or a descendant of it failed (Muad 12 Oct 21:25).
test('the predicate (K1): EACH node is judged on its own - only the node that fails itself is ineligible; the answered stop\'s own marks do not count, another stale source does', () => {
  const ineligible = events => ineligibleBelowRoot(foldRecord([...TREE.filter(e => !events.drop?.includes(e.id)), ...(events.add ?? []), ROOT_STOP]), { answeringStopId: 'e9' });
  assert.deepEqual(ineligible({}), ['R/M2@g1', 'R/M3@g1'], 'the case: R/M1 and its child are eligible');
  const variants = {
    'a stopped grandchild': { drop: ['e6c'], add: [stopped('e6x', 'R/M1/M1', 1)], expect: ['R/M1/M1@g1'] },
    'a grandchild registered and not started': { drop: ['e6b', 'e6c'], expect: ['R/M1/M1@g1'] },
    'a grandchild still running': { drop: ['e6c'], expect: ['R/M1/M1@g1'] },
    'a grandchild closed incomplete': { drop: ['e6c'], add: [closed('e6x', 'R/M1/M1', 1, { outcome: 'incomplete', passed: false })], expect: ['R/M1/M1@g1'] },
    'a grandchild not passed': { drop: ['e6c'], add: [closed('e6x', 'R/M1/M1', 1, { outcome: 'failed', passed: false })], expect: ['R/M1/M1@g1'] },
    'the child ended needs_decision': { drop: ['e4c'], add: [closed('e4x', 'R/M1', 1, { status: 'needs_decision' })], expect: ['R/M1@g1'] },
    'an open stop of the grandchild': { add: [stop('e6s', 'R/M1/M1', 1)], expect: ['R/M1/M1@g1'] },
    'stale for ANOTHER stop': { add: [{ id: 'e6t', event: 'needs_decision_opened', node: 'R/M3', generation: 1, runId: runFor('R/M3', 1), source: 'blocked', affected: [{ node: 'R/M1', generation: 1 }] }], expect: ['R/M1@g1'] },
  };
  for (const [name, v] of Object.entries(variants)) {
    const out = ineligible(v);
    assert.deepEqual(out.filter(k => k.startsWith('R/M1')), v.expect, `${name}: only the node that fails itself`);
  }
  // U13: an obligation ROOT stop marks the carriers' whole closure; those marks are the stop's own and are released with it, so the carrier stays eligible
  const obligation = ineligibleBelowRoot(foldRecord([...TREE, { ...ROOT_STOP, affected: [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }, { node: 'R/M1/M1', generation: 1 }] }]), { answeringStopId: 'e9' });
  assert.deepEqual(obligation, ['R/M2@g1', 'R/M3@g1'], 'the answered stop\'s marks do not make the carriers ineligible');
  const notAnswered = ineligibleBelowRoot(foldRecord([...TREE, { ...ROOT_STOP, affected: [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }] }]), { answeringStopId: 'e777' });
  assert.ok(notAnswered.includes('R/M1@g1'), 'known-bad: the same marks from a stop that is NOT the one being answered do count');
});

test('known-bad (D2): nothing that died EARLIER comes back as held - a child regenerate before the root re-plan leaves its replaced node and that node\'s orphaned child dead', () => {
  const before = [...TREE, stop('e5x', 'R/M1', 1), { id: 'e5y', event: 'decision_recorded', text: 'redo', form: 'regenerate', stopId: 'e5x', affected: keys('R/M1@g1', 'R/M1/M1@g1'), ...G },
    { id: 'e5z', event: 'generation_opened', decisionId: 'e5y', nodes: [{ node: 'R/M1', generation: 2 }] }];
  const s0 = foldRecord(before);
  assert.ok(deadKeys(s0).has('R/M1@g1') && deadKeys(s0).has('R/M1/M1@g1'), 'control: dead through the child regenerate');
  const root = foldRecord([...before, ROOT_STOP, decide(keys('R@g1', 'R/M2@g1', 'R/M3@g1')), OPEN]);
  assert.deepEqual([...heldKeys(root)], [], 'neither is resurrected as held');
  assert.ok(deadKeys(root).has('R/M1@g1') && deadKeys(root).has('R/M1/M1@g1'));
});

test('D3: the replansRoot decision must list EXACTLY R@g and the nodes that cannot be held - leaving out the stopped child, or listing an eligible one, is refused by the table; the exact set is accepted', () => {
  const s = foldRecord([...TREE, ROOT_STOP]);
  assert.equal(why(s, decide(RIGHT)), null, 'the exact set');
  assert.match(why(s, decide(keys('R@g1', 'R/M2@g1'))) ?? '', /missing R\/M3@g1/, 'the stopped child left out: it would be held, keep its grant hold and could be resumed');
  assert.match(why(s, decide([...RIGHT, ...keys('R/M1@g1')])) ?? '', /not to be listed R\/M1@g1/, 'an eligible child listed');
  assert.match(why(s, decide(keys('R/M2@g1', 'R/M3@g1'))) ?? '', /missing R@g1/);
});

test('the release (K2, C2a-record: release is NOT death): X1 the approval of the new root plan\'s children frontier PASSES OVER every held node (kept, not dead); X2 held_released (the event, its row and its fold) the same; X4 is REMOVED (13 Oct 2026: the next root generation releases nothing, see the test after this one); X5 an R@g2 that never finishes leaves them held', () => {
  const reg2 = { id: 'e12', ...reg('R', 2, null, 'kR', { runId: '2026-10-12T09-00-00-000Z', replacesRunId: 't', bundleSha256: 'b'.repeat(64), bundleBytes: 9, taskSha256: 'c'.repeat(64), depth: 0, parentNode: null }) };
  const planned = [...TREE, ROOT_STOP, decide(RIGHT), OPEN, { id: 'e11a', event: 'frontier_previewed', kind: 'root_replan', openedBy: 'e10', frontierKey: 'kR', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND },
    { id: 'e11b', event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: 'kR', revision: 1 }, reg2, { id: 'e13', event: 'node_started', node: 'R', generation: 2, runId: reg2.runId, pid: 1, host: 'h' }];
  // X5: R@g2 runs, stops, closes needs_decision: the held nodes stay held (the root's own approval is a root_replan frontier, parentNode null: not a children frontier)
  const x5 = foldRecord([...planned, { id: 'e14', event: 'node_closed', node: 'R', generation: 2, runId: reg2.runId, outcome: 'passed', passed: true, status: 'needs_decision', share: 'released' }]);
  assert.deepEqual([...heldKeys(x5)].sort(), ['R/M1/M1@g1', 'R/M1@g1'], 'X5: still held, harmless');
  // X1: R@g2's split frontier (parentNode R, parentGeneration 2), first approval
  const split = [...front('kS', 'R', 2, [{ node: 'R/M1', generation: 3 }], 'e15')];
  const x1 = foldRecord([...planned, { id: 'e14', event: 'node_closed', node: 'R', generation: 2, runId: reg2.runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' }, ...split]);
  // EDITED 18 Okt 2026 (M7 apply, C2a-record K2; C2a_Gate_Page.md section 3, Muad 12 Oct 21:25 "a sub-plan is not thrown away before it is checked for reuse"). OLD: assert.equal(heldKeys(x1).size, 0, 'X1: released') and deadKeys(x1) has both nodes ("dead, nothing adopts until S8-9").
  // NEW: both nodes stay HELD, are marked passed over (keptKeys) and are NOT dead. WHY: dead was the only state with no way back; a candidate must stay offerable to a later frontier (relocation, the g1/g3 gap) until it is adopted or the tree is abandoned.
  assert.deepEqual([...heldKeys(x1)].sort(), ['R/M1/M1@g1', 'R/M1@g1'], 'X1: still held');
  assert.deepEqual([...keptKeys(x1)].sort(), ['R/M1/M1@g1', 'R/M1@g1'], 'and marked passed over');
  assert.ok(!deadKeys(x1).has('R/M1@g1') && !deadKeys(x1).has('R/M1/M1@g1'), 'and not dead');
  const second = foldRecord([...planned, ...split, { id: 'e16', event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: 'kS', revision: 2 }]);
  assert.equal(second.heldReleasedBelow, 2, 'a later revision of the same frontier changes nothing ("only at the first revision" cannot be observed until adoption exists: S8-9, test U11)');
  // X2: the event
  const closedOk = [...planned, { id: 'e14', event: 'node_closed', node: 'R', generation: 2, runId: reg2.runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' }];
  const sx2 = foldRecord(closedOk);
  const ev = { event: 'held_released', reason: 'no_children', nodes: ['R/M1@g1', 'R/M1/M1@g1'] };
  assert.equal(eventShapeError({ schema: 'tree-events/1', id: 'e99', at: '2026-10-12T00:00:00.000Z', ...ev }), null);
  assert.ok(eventShapeError({ schema: 'tree-events/1', id: 'e99', at: '2026-10-12T00:00:00.000Z', ...ev, reason: 'because' }), 'an unknown reason is malformed');
  assert.equal(why(sx2, ev), null, 'a closed re-planned root releases keys that ARE held');
  assert.match(why(sx2, { ...ev, nodes: ['R/M2@g1'] }) ?? '', /R\/M2@g1 is not held/);
  assert.match(why(foldRecord([...TREE, ROOT_STOP, decide(RIGHT), OPEN]), ev) ?? '', /no root re-plan has replaced the root|held nodes are released only once it is closed|is not held/);
  const afterX2 = foldRecord([...closedOk, { id: 'e15', ...ev }]);
  // EDITED 18 Okt 2026 (K2, same reason). OLD: heldKeys(afterX2).size 0 and deadKeys has R/M1@g1. NEW: still held, passed over by the record, not dead.
  assert.deepEqual([...heldKeys(afterX2)].sort(), ['R/M1/M1@g1', 'R/M1@g1']); assert.deepEqual([...keptKeys(afterX2)].sort(), ['R/M1/M1@g1', 'R/M1@g1']); assert.ok(!deadKeys(afterX2).has('R/M1@g1'));
  assert.equal(keptKeys(foldRecord([...closedOk])).size, 0, 'before any release nothing is passed over');
  // X4 REMOVED (13 Oct 2026; EDITED, disclosed; old: "a third root generation opens: earlier-era held nodes die", heldKeys(x4).size 0 and R/M1@g1 dead): the next root generation releases NOTHING (Muad, 12 Oct 21:25: a sub-plan is not thrown away before it is checked for reuse)
  const x4 = foldRecord([...planned, { id: 'e17', event: 'node_closed', node: 'R', generation: 2, runId: reg2.runId, outcome: 'passed', passed: true, status: 'needs_decision', share: 'released' },
    stop('e18', 'R', 2), { id: 'e19', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e18', replansRoot: true, affected: keys('R@g2'), ...G }, { id: 'e20', event: 'generation_opened', decisionId: 'e19', nodes: [{ node: 'R', generation: 3 }] }]);
  assert.deepEqual([...heldKeys(x4)].sort(), ['R/M1/M1@g1', 'R/M1@g1'], 'the held nodes of the era below R@g2 are STILL held when R@g3 opens');
  assert.ok(!deadKeys(x4).has('R/M1@g1') && !deadKeys(x4).has('R/M1/M1@g1') && deadKeys(x4).has('R@g1') && deadKeys(x4).has('R@g2'), 'held, not dead; both replaced root plans are dead');
});

test('D4: a HELD node refuses node_resumed for BOTH purposes (post_run is a paid call on a finished run) and any stop; its own rows refuse the rest as a closed node', () => {
  const resume = purpose => ({ event: 'node_resumed', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), pid: 1, host: 'h', purpose });
  assert.match(why(replanned, resume('post_run')) ?? '', /is held pending the new root plan: it is neither resumed nor given a post-run call/);
  assert.match(why(replanned, resume('resume')) ?? '', /is held pending the new root plan/);
  assert.match(why(replanned, stop('e99', 'R/M1', 1)) ?? '', /R\/M1@g1 is held pending the new root plan: no stop is opened on it/);
  // known-bad control: the same post_run on a closed node that is NOT held (before the re-plan) is accepted - the refusal is the held one
  assert.equal(why(foldRecord([...TREE]), resume('post_run')), null);
});

test('MONEY (a REAL record, a pin that holds in both states because a closed node holds nothing): a held node holds no grant, its run appears once in the gate\'s members and the tree\'s spend does not move when the root is re-planned', () => {
  const t = closedRootTree();
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], { usage: [{ file: 'a', usd: 0.5, provider: 'mock' }] });
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 9.5 });
  const before = budgetOf(t.rootDir); const gateBefore = gateTree(t.rootDir);
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] });
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  const state = stateOf(readTreeRecord(t.rootDir));
  assert.deepEqual([...heldKeys(state)], ['R/M1@g1'], 'the eligible child is held (a real record, the table accepted the exact affected set)');
  const after = budgetOf(t.rootDir); const gateAfter = gateTree(t.rootDir);
  assert.equal(after.treeSpentUsd, before.treeSpentUsd, 'the tree\'s spend does not move');
  assert.ok(after.treeSpentUsd >= 0.5 - 1e-9, 'and it includes the held node\'s 0.50');
  assert.equal(after.nodes.find(n => n.key === 'R/M1@g1').heldUsd, 0, 'a held node holds no grant');
  assert.equal(gateAfter.members.filter(m => m.runId === IDS[0]).length, 1, 'its run counts once');
  assert.deepEqual(gateAfter.members.map(m => [m.runId, m.spentUsd]), gateBefore.members.map(m => [m.runId, m.spentUsd]), 'and every member is counted as before');
  assert.equal(after.heldUsd, before.heldUsd);
});

// EDITED 18 Okt 2026 (C2a-record K1, per-node eligibility). OLD title: "...makes the child AND its whole subtree ineligible", (a) expected ['R/M1/M1@g1', 'R/M1@g1'], the table's missing list named R/M1/M1@g1 too, and after that decision heldKeys was empty with R/M1 dead. NEW: only the half-finished node itself (R/M1) is ineligible; its finished child R/M1/M1 stays a candidate.
test('HALF-FINISHED (C&C, read of 3945050; K1 per node): a node is eligible only when EVERY node its verified split names and every opened generation below it is registered, closed and passed - an unregistered split child, an unknown child list, a children frontier with an unregistered member, or a replacement opened and not registered makes THAT node ineligible (not its finished children)', () => {
  const without = (...ids) => TREE.filter(e => !ids.includes(e.id));
  const ineligibleOf = events => ineligibleBelowRoot(foldRecord([...events, ROOT_STOP]), { answeringStopId: 'e9' });
  assert.deepEqual(ineligibleOf(TREE), ['R/M2@g1', 'R/M3@g1'], 'control: the split names R/M1/M1 and it is registered, closed, passed');
  // (a) the verified split names R/M1/M2, which was never registered
  assert.deepEqual(ineligibleOf([...without('e4v'), split('e4v', 'R/M1', ['R/M1/M1', 'R/M1/M2'])]).filter(k => k.startsWith('R/M1')), ['R/M1@g1'], '(a) an unregistered split child: the half-finished node, not its finished child');
  //     a verified split whose child list the record does not hold (a record from before the field) is unknown, so not whole
  assert.ok(ineligibleOf([...without('e4v'), split('e4v', 'R/M1', undefined)]).includes('R/M1@g1'), 'an unknown child list is never held');
  // (b) R/M1/M1 is under an opened regenerate: g2 opened, not registered
  const pending = [...TREE, stop('e6s', 'R/M1/M1', 1), { id: 'e6d', event: 'decision_recorded', text: 'redo', form: 'regenerate', stopId: 'e6s', affected: keys('R/M1/M1@g1'), ...G }, { id: 'e6o', event: 'generation_opened', decisionId: 'e6d', nodes: [{ node: 'R/M1/M1', generation: 2 }] }];
  assert.ok(deadKeys(foldRecord(pending)).has('R/M1/M1@g1'), 'control: the replaced grandchild is dead, so it drops out of the registered walk');
  assert.ok(ineligibleOf(pending).includes('R/M1@g1'), '(b) a replacement opened and not registered, below the child');
  // (c) no verified split on record but a children frontier of R/M1 is previewed with an unregistered member
  const noSplit = [...without('e4v'), ...front('kC', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }, { node: 'R/M1/M9', generation: 1 }], 'e4f')];
  assert.ok(ineligibleOf(noSplit).includes('R/M1@g1'), '(c) a children frontier with an unregistered member');
  // the whole-subtree rule and the table: a decision that left the half-finished child out is REFUSED, the one that lists it is accepted
  const half = foldRecord([...without('e4v'), split('e4v', 'R/M1', ['R/M1/M1', 'R/M1/M2']), ROOT_STOP]);
  assert.match(why(half, decide(RIGHT)) ?? '', /missing R\/M1@g1/);
  assert.equal(why(half, decide(keys('R@g1', 'R/M1@g1', 'R/M2@g1', 'R/M3@g1'))), null);
  // and after that decision the half-finished node is DEAD, not held; its finished child R/M1/M1 is a held candidate on its own (K1)
  const opened = foldRecord([...without('e4v'), split('e4v', 'R/M1', ['R/M1/M1', 'R/M1/M2']), ROOT_STOP, decide(keys('R@g1', 'R/M1@g1', 'R/M2@g1', 'R/M3@g1')), OPEN]);
  assert.deepEqual([...heldKeys(opened)], ['R/M1/M1@g1']); assert.ok(deadKeys(opened).has('R/M1@g1')); assert.equal(deadKeys(opened).has('R/M1/M1@g1'), false);
});

test('the writer: verifySplit records the child paths the verified block names (REAL root run, all-mock), so the record alone can say a node is half-finished', async () => {
  const r = await trackedRealRoot();
  const ev = readTreeRecord(r.t.rootDir).events.find(e => e.event === 'split_verified' && e.node === 'R');
  assert.deepEqual(ev.children, ['R/M1', 'R/M2', 'R/M3'], 'the three children of the fixture plan');
  assert.deepEqual(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g1').verifiedSplit.children, ['R/M1', 'R/M2', 'R/M3']);
  assert.match(eventShapeError({ ...ev, children: ['not a path'] }) ?? '', /field "children" is malformed/, 'a malformed list is refused by the shape check');
});


// ---- X4 REMOVED (13 Oct 2026, C&C ruling): held nodes stay held ACROSS root generations until a release that actually runs or replaces the reuse check: X1 (the first children frontier of a LATER root generation is approved), X2 (held_released), or abandon.
const REG2 = { id: 'e12', ...reg('R', 2, null, 'kR', { runId: '2026-10-12T09-00-00-000Z', replacesRunId: 't', bundleSha256: 'b'.repeat(64), bundleBytes: 9, taskSha256: 'c'.repeat(64), depth: 0, parentNode: null }) };
const PLANNED = [...TREE, ROOT_STOP, decide(RIGHT), OPEN, { id: 'e11a', event: 'frontier_previewed', kind: 'root_replan', openedBy: 'e10', frontierKey: 'kR', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND },
  { id: 'e11b', event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: 'kR', revision: 1 }, REG2, { id: 'e13', event: 'node_started', node: 'R', generation: 2, runId: REG2.runId, pid: 1, host: 'h' },
  { id: 'e17', event: 'node_closed', node: 'R', generation: 2, runId: REG2.runId, outcome: 'passed', passed: true, status: 'needs_decision', share: 'released' }, stop('e18', 'R', 2),
  { id: 'e19', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e18', replansRoot: true, affected: keys('R@g2'), ...G }, { id: 'e20', event: 'generation_opened', decisionId: 'e19', nodes: [{ node: 'R', generation: 3 }] }];
const REG3 = { id: 'e21', ...reg('R', 3, null, 'kR3', { runId: '2026-10-12T10-00-00-000Z', replacesRunId: REG2.runId, bundleSha256: 'b'.repeat(64), bundleBytes: 9, taskSha256: 'c'.repeat(64), depth: 0, parentNode: null }) };
const G3_RUNNING = [...PLANNED, REG3, { id: 'e22', event: 'node_started', node: 'R', generation: 3, runId: REG3.runId, pid: 1, host: 'h' }];
const G3_CLOSED = [...G3_RUNNING, { id: 'e23', event: 'node_closed', node: 'R', generation: 3, runId: REG3.runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' }];
const BOTH = ['R/M1/M1@g1', 'R/M1@g1'];

test('X4 removed: the held nodes of the first era cross a second root re-plan - held when R@g3 opens, registered, running and closed (X5 harmless), and each exit then releases them: X1 the first children frontier of R@g3 approved, X2 held_released when R@g3 closes passed, abandon', () => {
  for (const [name, events] of [['R@g3 opened', PLANNED], ['R@g3 registered', [...PLANNED, REG3]], ['R@g3 running', G3_RUNNING], ['R@g3 closed passed (a split not yet approved)', G3_CLOSED]]) assert.deepEqual([...heldKeys(foldRecord(events))].sort(), BOTH, `still held: ${name}`);
  const x1 = foldRecord([...G3_CLOSED, ...front('kS3', 'R', 3, [{ node: 'R/M1', generation: 4 }], 'e24')]);
  // EDITED 18 Okt 2026 (C2a-record K2). OLD: heldKeys(x1).size 0 ("releases the era") and both nodes dead ("nothing adopts until S8-9"). NEW: both stay held, are passed over (kept) and are not dead. WHY: release is not death (Muad 12 Oct 21:25).
  assert.deepEqual([...heldKeys(x1)].sort(), BOTH, 'X1: the first approval of a children frontier of R@g3 passes the era over, it releases nothing'); assert.deepEqual([...keptKeys(x1)].sort(), BOTH); assert.ok(BOTH.every(k => !deadKeys(x1).has(k)), 'and they are not dead');
  const ev = { event: 'held_released', reason: 'no_split', nodes: BOTH };
  assert.equal(why(foldRecord(G3_CLOSED), ev), null, 'X2: R@g3 closed passed: the held keys can be released');
  const x2 = foldRecord([...G3_CLOSED, { id: 'e24', ...ev }]);
  // EDITED 18 Okt 2026 (C2a-record K2). OLD: heldKeys(x2).size 0 and both dead. NEW: held, passed over, not dead.
  assert.deepEqual([...heldKeys(x2)].sort(), BOTH); assert.deepEqual([...keptKeys(x2)].sort(), BOTH); assert.ok(BOTH.every(k => !deadKeys(x2).has(k)));
  const gone = foldRecord([...G3_CLOSED, { id: 'e24', event: 'tree_abandoned', ...G }]);
  // UNCHANGED BEHAVIOUR (K2 keeps it): ABANDON is the end of every candidate; they are dead then, and nothing is kept or held
  assert.equal(heldKeys(gone).size, 0, 'abandon retires every held node'); assert.equal(keptKeys(gone).size, 0); assert.ok(BOTH.every(k => deadKeys(gone).has(k)), 'and they are dead');
});

// THE HANDSHAKE WITH BUILDER B (C&C 13 Oct 2026). Under today's WHOLE-ERA X1, at most ONE era holds nodes at any moment: an era k can only be held after R@gk's children frontier was approved, and that first approval releases every era below k.
// The record below is the one that SEPARATES the two rules: R@g2 closes passed and its children frontier (slot R/M1@g2) is approved - today's X1 kills BOTH era-1 nodes (R/M1@g1 and its grandchild) in that event; R/M1@g2 runs and closes passed with no split;
// R@g2 is re-planned and R@g3 opens. Today: held = [R/M1@g2] only (ONE era). Under the per-frontier X1' (S8-9 contract section 11.6, B's C2a) the grandchild R/M1/M1@g1 would SURVIVE the approval (its parent path's new node never split): held =
// [R/M1/M1@g1, R/M1@g2], TWO eras. B flips the two assertions marked FLIP in C2a together with its contract amendment; it is not a bug when they flip.
const eraOf = (state, key) => { let f = state.frontiers.get(state.nodes.get(key)?.frontierKey); let guard = 0; while (f && f.parentNode !== 'R' && guard++ < 20) f = state.frontiers.get(state.nodes.get(`${f.parentNode}@g${f.parentGeneration}`)?.frontierKey); return f?.parentGeneration ?? null; };   // the root generation whose children frontier the node hangs under
const erasOf = (state, keys) => new Set([...keys].map(k => eraOf(state, k)));
test('HANDSHAKE (B\'s C2a flips the FLIP lines): the record where X1 and X1\' differ - today ONE era is held at every prefix and the final held set is exactly [R/M1@g2]; the counter itself can see two eras (synthetic control)', () => {
  const kS2 = front('kS2', 'R', 2, [{ node: 'R/M1', generation: 2 }], 'e15');
  const full = [...TREE, ROOT_STOP, decide(RIGHT), OPEN, { id: 'e11a', event: 'frontier_previewed', kind: 'root_replan', openedBy: 'e10', frontierKey: 'kR', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND },
    { id: 'e11b', event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: 'kR', revision: 1 }, REG2, { id: 'e13', event: 'node_started', node: 'R', generation: 2, runId: REG2.runId, pid: 1, host: 'h' },
    { id: 'e14', event: 'node_closed', node: 'R', generation: 2, runId: REG2.runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' }, ...kS2,
    { id: 'e16', ...reg('R/M1', 2, 'R', 'kS2') }, started('e16b', 'R/M1', 2), closed('e16c', 'R/M1', 2),
    stop('e18', 'R', 2), { id: 'e19', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e18', replansRoot: true, affected: keys('R@g2'), ...G }, { id: 'e20', event: 'generation_opened', decisionId: 'e19', nodes: [{ node: 'R', generation: 3 }] }];
  // FLIPPED 18 Okt 2026 (C2a-record K2; the FLIP lines this test announced). OLD: at every prefix at most ONE era was held and the final held set was ['R/M1@g2']. NEW: two eras can be held at once (a passed-over candidate stays), exactly two at the end, and the final set is all three nodes.
  for (let n = 1; n <= full.length; n += 1) { const st = foldRecord(full.slice(0, n)); assert.ok(erasOf(st, heldKeys(st)).size <= 2, `prefix ${n} (${full[n - 1].event}): more than two eras are held`); }
  const end = foldRecord(full);
  // C2a-record commit 1 (K2): R/M1@g1 stays held (passed over by R@g2's frontier, not killed) beside R/M1@g2: two eras.
  // EDITED in the eraOf commit (C2a-record, C&C 18 Okt: its own commit before K4; Review/Build_0.8.3/m7/C2a_EraOf_Fix_GateAnswer_2026-10-18.md). OLD: the final held set was ['R/M1@g1', 'R/M1@g2'] and the kept set ['R/M1@g1']: the grandchild R/M1/M1@g1 read DEAD, because eraOf stopped climbing at a parent whose PATH another era had reused (R/M1@g2 under R@g2), a silent death of a finished sub-plan.
  // NEW: path reuse by another era replaces nothing, so the climb goes on and the grandchild is a candidate of era 1 beside its parent (and passed over with it). WHY: K1 never silently dead; Muad 12 Oct 21:25 (a finished sub-plan is not thrown away before it is checked for reuse); gate page section 10 names this final set.
  assert.deepEqual([...heldKeys(end)].sort(), ['R/M1/M1@g1', 'R/M1@g1', 'R/M1@g2'], 'K2: R@g2\'s approved children frontier passed R/M1@g1 and its child over, it did not kill them; R/M1@g2 is held when R@g3 opens');
  assert.deepEqual([...erasOf(end, heldKeys(end))].sort(), [1, 2]); assert.deepEqual([...keptKeys(end)].sort(), ['R/M1/M1@g1', 'R/M1@g1'], 'the era-1 nodes are the ones passed over');
  assert.deepEqual(candidateOriginOf(end, 'R/M1/M1@g1'), { route: 'root', replaces: null }, 'the ROOT route owns it (no decision replaced its parent); the sub route never claims it');
  assert.equal(heldPhraseOf(end, 'R/M1/M1@g1'), KEPT_PHRASE, 'and it is called by the root route\'s words, never "held pending the new plan of ..."');
  assert.equal(deadKeys(end).has('R/M1/M1@g1'), false, 'it left the dead set');
  assert.deepEqual(keptNodesOf(end).filter(h => h.node === 'R/M1/M1').map(h => [h.node, h.route, h.replaces]), [['R/M1/M1', 'root', null]], 'the kept list (the readers\' one list of held things) carries it on the root route');
  assert.equal(heldKeys(end, { route: 'root' }).has('R/M1/M1@g1'), true, 'EXCLUSIVITY: it is in the root route\'s held list ...');
  assert.equal(heldKeys(end, { route: 'sub' }).has('R/M1/M1@g1'), false, '... NOT in the sub list, and (above) NOT dead: under the lineage rule the two routes never both claim a node, so this pins root OWNERSHIP, not a precedence contest');
  const fake = { nodes: new Map([['a@g1', { frontierKey: 'f1' }], ['b@g1', { frontierKey: 'f2' }]]), frontiers: new Map([['f1', { parentNode: 'R', parentGeneration: 1 }], ['f2', { parentNode: 'R', parentGeneration: 2 }]]) };
  assert.equal(erasOf(fake, ['a@g1', 'b@g1']).size, 2, 'control: the counter reports two eras when two exist');
});

// ---- C2a-record (K1/K2), M7 apply 18 Okt 2026 ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('K1 candidatesOf: every node the root re-plan orphaned is listed with where it came from and why it is or is not usable; nothing is dropped for being ineligible; an abandoned tree has none', () => {
  const rows = candidatesOf(replanned).map(c => [c.key, c.state, c.eligible === true ? true : c.eligible.code, c.proposedBy.node, c.proposedBy.generation, c.era]);
  assert.deepEqual(rows, [
    ['R/M1/M1@g1', 'held', true, 'R/M1', 1, 1], ['R/M1@g1', 'held', true, 'R', 1, 1],
    ['R/M2@g1', 'set_aside', 'needs_decision', 'R', 1, 1], ['R/M3@g1', 'set_aside', 'not_finished', 'R', 1, 1],
  ]);
  // passed over: the same listing says kept (X2: a held_released record)
  const afterX2 = foldRecord([...TREE, ROOT_STOP, decide(RIGHT), OPEN, { id: 'e12', event: 'held_released', reason: 'no_children', nodes: ['R/M1@g1', 'R/M1/M1@g1'] }]);
  assert.deepEqual(candidatesOf(afterX2).filter(c => c.eligible === true).map(c => [c.key, c.state]), [['R/M1/M1@g1', 'kept'], ['R/M1@g1', 'kept']]);
  assert.deepEqual(candidatesOf(foldRecord([...TREE, ROOT_STOP, decide(RIGHT), OPEN, { id: 'e12', event: 'tree_abandoned', ...G }])), [], 'ABANDON retires every candidate');
  assert.deepEqual(candidatesOf(foldRecord([...TREE])), [], 'before any re-plan there is none');
});

test('K2 a KEPT candidate is refused every action a held one is refused, in its own words (it was passed over, not "pending the new root plan"); the views list it apart', () => {
  const kept = foldRecord([...TREE, ROOT_STOP, decide(RIGHT), OPEN, { id: 'e12', event: 'held_released', reason: 'no_split', nodes: ['R/M1@g1', 'R/M1/M1@g1'] }]);
  const resume = purpose => ({ event: 'node_resumed', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), pid: 1, host: 'h', purpose });
  assert.deepEqual([...keptKeys(kept)].sort(), ['R/M1/M1@g1', 'R/M1@g1']);
  assert.match(why(kept, resume('post_run')) ?? '', /R\/M1@g1 is kept from an earlier root plan \(a later root plan did not use it\): it is neither resumed nor given a post-run call/);
  assert.match(why(kept, resume('resume')) ?? '', /is kept from an earlier root plan/);
  assert.match(why(kept, stop('e99', 'R/M1', 1)) ?? '', /is kept from an earlier root plan \(a later root plan did not use it\): no stop is opened on it/);
  assert.doesNotMatch(why(kept, resume('resume')) ?? '', /pending the new root plan/, 'known-bad: the held sentence is not said of a kept node');
  assert.match(why(replanned, resume('resume')) ?? '', /is held pending the new root plan/, 'control: a node that was NOT passed over keeps the held sentence');
});

test('K2 MONEY (a REAL record; C&C 18 Okt, :237): a kept candidate adds $0 to every figure a person is shown - the same run is counted once, the hold is 0 and the free amount does not move while it is held, after it is passed over, and after abandon (the named exit)', () => {
  const t = closedRootTree();
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], { usage: [{ file: 'a', usd: 8, provider: 'mock' }] });
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 2 });
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] });
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  const figures = () => { const b = budgetOf(t.rootDir); const g = gateTree(t.rootDir); return { spent: b.treeSpentUsd, held: b.heldUsd, available: b.availableUsd, nodeHold: b.nodes.find(n => n.key === 'R/M1@g1').heldUsd, runs: g.members.filter(m => m.runId === IDS[0]).length }; };
  const st0 = stateOf(readTreeRecord(t.rootDir)); assert.deepEqual([...heldKeys(st0)], ['R/M1@g1']); assert.equal(keptKeys(st0).size, 0);
  const held = figures();
  appendFileSync(join(treeDirOf(t.rootDir), 'events.jsonl'), `${JSON.stringify({ schema: 'tree-events/1', id: `e${st0.lastId + 1}`, at: new Date().toISOString(), event: 'held_released', reason: 'no_children', nodes: ['R/M1@g1'] })}\n`);   // raw, in the writer's shape: a MONEY pin, not a writer test (the table wants R@g2 closed)
  const st1 = stateOf(readTreeRecord(t.rootDir)); assert.deepEqual([...keptKeys(st1)], ['R/M1@g1']);
  const kept = figures();
  assert.deepEqual(kept, held, 'passing it over moves no dollar: spent, hold, free amount and the run count are what they were');
  assert.equal(kept.spent >= 8 - 1e-9, true, 'the 8.00 it spent stays counted'); assert.equal(kept.runs, 1, 'its run counts once'); assert.equal(kept.nodeHold, 0, 'a kept candidate holds nothing');
  // the named exit: abandon ends every candidate; the spend stays counted, once, and nothing is held
  appendTreeEvent(t.rootDir, { event: 'tree_abandoned', ...GATE_FIELDS });
  const gone = figures();
  assert.deepEqual([gone.spent, gone.held, gone.runs, gone.nodeHold], [held.spent, 0, 1, 0], 'abandon: the 8.00 is still counted once, nothing is held');
});

// ---- the eraOf commit (C2a-record, its own commit before K4; protective rows) -------------------------------------------------------------------------------------------------------------------------------------------------
test('eraOf (a) a SET-ASIDE parent (listed by the root re-plan, so not a candidate itself) with a finished child: the child stays held on the root route, as in commit 1 (per-node K1); the fix must not undo it', () => {
  const withChild = [...TREE, ...front('kC', 'R/M2', 1, [{ node: 'R/M2/C', generation: 1 }], 'e12'), { id: 'e12r', ...reg('R/M2/C', 1, 'R/M2', 'kC') }, started('e12s', 'R/M2/C', 1), closed('e12c', 'R/M2/C', 1)];
  const st = foldRecord([...withChild, ROOT_STOP, decide(RIGHT), OPEN]);
  assert.equal(deadKeys(st).has('R/M2@g1'), true, 'the parent is set aside (dead)');
  assert.deepEqual(candidateOriginOf(st, 'R/M2/C@g1'), { route: 'root', replaces: null }, 'its finished child is a root-route candidate');
  assert.equal(heldKeys(st).has('R/M2/C@g1'), true);
});

test('eraOf (b) a parent REPLACED BY A REGENERATE DECISION (its own lineage) with an unlisted finished child: the child stays on the SUB route even when the root is re-planned later (commit 2 does not move); the ROOT route does not claim it', () => {
  const subStop = { id: 'e9s', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: keys('R/M1@g1', 'R/M1/M1@g1') };
  const subDec = { id: 'e9d', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e9s', affected: keys('R/M1@g1'), ...G };
  const subOpen = { id: 'e9o', event: 'generation_opened', decisionId: 'e9d', nodes: [{ node: 'R/M1', generation: 2 }] };
  const afterSub = foldRecord([...TREE, subStop, subDec, subOpen]);
  assert.deepEqual(candidateOriginOf(afterSub, 'R/M1/M1@g1'), { route: 'sub', replaces: 'R/M1' });
  // then the ROOT is re-planned too: the child is still the sub route's (its parent was replaced by a decision about it)
  const both = foldRecord([...TREE, subStop, subDec, subOpen, ROOT_STOP, decide([...RIGHT, ...keys('R/M1@g1')]), OPEN]);
  assert.deepEqual(candidateOriginOf(both, 'R/M1/M1@g1'), { route: 'sub', replaces: 'R/M1' }, 'the nearest lineage-replaced ancestor owns it: the sub route');
  assert.equal(heldKeys(both, { route: 'root' }).has('R/M1/M1@g1'), false);
});

test('eraOf (c) abandon retires the new candidate too: the HANDSHAKE grandchild is dead again after tree_abandoned', () => {
  const kS2 = front('kS2', 'R', 2, [{ node: 'R/M1', generation: 2 }], 'e15');
  const events = [...TREE, ROOT_STOP, decide(RIGHT), OPEN, { id: 'e11a', event: 'frontier_previewed', kind: 'root_replan', openedBy: 'e10', frontierKey: 'kR', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND },
    { id: 'e11b', event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: 'kR', revision: 1 }, REG2, { id: 'e13', event: 'node_started', node: 'R', generation: 2, runId: REG2.runId, pid: 1, host: 'h' },
    { id: 'e14', event: 'node_closed', node: 'R', generation: 2, runId: REG2.runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' }, ...kS2, { id: 'e16', ...reg('R/M1', 2, 'R', 'kS2') }, started('e16b', 'R/M1', 2), closed('e16c', 'R/M1', 2)];
  assert.equal(heldKeys(foldRecord(events)).has('R/M1/M1@g1'), true, 'NEW behaviour (red at the base, where the grandchild is dead): held while the tree is alive');
  const gone = foldRecord([...events, { id: 'e99', event: 'tree_abandoned', at: '2026-10-18T00:00:00Z', ...G }]);
  assert.equal(heldKeys(gone).size, 0); assert.equal(deadKeys(gone).has('R/M1/M1@g1'), true);   // the abandon half is green at the base too (the node is already dead there): it has no red of its own beyond commit 1's abandon rows
});

test('eraOf (d) the COMMON sub-plan shape (no root re-plan): P = R/M1 is regenerated, its new generation reuses the child path (R/M1/M1@g2 registers), and the finished GRANDCHILD of the old child is a SUB candidate, passed over once the new plan\'s children are approved (red at the base: the base lost it the moment R/M1/M1@g2 registered, because the old climb stopped at the path-superseded R/M1/M1@g1)', () => {
  const GRAND = [...front('kG', 'R/M1/M1', 1, [{ node: 'R/M1/M1/M1', generation: 1 }], 'e6g'), { id: 'e6h', ...reg('R/M1/M1/M1', 1, 'R/M1/M1', 'kG') }, started('e6i', 'R/M1/M1/M1', 1), closed('e6j', 'R/M1/M1/M1', 1)];
  const subStop = { id: 'e9s', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: keys('R/M1@g1', 'R/M1/M1@g1', 'R/M1/M1/M1@g1') };
  const subDec = { id: 'e9d', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e9s', affected: keys('R/M1@g1'), ...G };
  const subOpen = { id: 'e9o', event: 'generation_opened', decisionId: 'e9d', nodes: [{ node: 'R/M1', generation: 2 }] };
  const NEWPLAN = [...front('kR1', 'R', 1, [{ node: 'R/M1', generation: 2 }], 'e20'), { id: 'e21', ...reg('R/M1', 2, 'R', 'kR1') }, started('e21b', 'R/M1', 2), closed('e21c', 'R/M1', 2),
    ...front('kR2', 'R/M1', 2, [{ node: 'R/M1/M1', generation: 2 }], 'e22'), { id: 'e23', ...reg('R/M1/M1', 2, 'R/M1', 'kR2') }];
  const st = foldRecord([...TREE.slice(0, 15), ...GRAND, ...TREE.slice(15), subStop, subDec, subOpen, ...NEWPLAN]);
  assert.equal(st.nodes.has('R/M1/M1/M1@g1') && st.nodes.has('R/M1/M1@g2'), true, 'the fixture holds the grandchild and the reused child path');
  assert.deepEqual(candidateOriginOf(st, 'R/M1/M1/M1@g1'), { route: 'sub', replaces: 'R/M1' }, 'the grandchild is a sub-route candidate of the replaced R/M1');
  assert.deepEqual(candidateOriginOf(st, 'R/M1/M1@g1'), { route: 'sub', replaces: 'R/M1' });
  assert.equal(keptKeys(st).has('R/M1/M1/M1@g1'), true, 'passed over: R/M1@g2\'s children frontier was approved without it');
  assert.equal(heldPhraseOf(st, 'R/M1/M1/M1@g1'), 'kept from an earlier plan of R/M1 (the new plan did not use it)');
  assert.equal(deadKeys(st).has('R/M1/M1/M1@g1'), false);
});

// 0.8.3 M7 fix-up 4 (C&C thcmcp-6d): node_started had no held line (node_resumed, node_registered and the stop row have one); deadKeys leaves held keys out, so a registered, never-started node under a held parent could start and spend. Fold-level: by real verbs the root decision refuses while such a child exists.
test('fix-up 4: node_started refuses a HELD node (a registered, never-started grandchild the root decision did not list), with the same words node_resumed uses', () => {
  const tree = [...TREE.filter(e => !['e6b', 'e6c'].includes(e.id)), ROOT_STOP, decide(RIGHT), OPEN];
  const state = foldRecord(tree);
  assert.ok(heldKeys(state).has('R/M1/M1@g1'), 'precondition: the unstarted grandchild is held, not dead');
  assert.equal(deadKeys(state).has('R/M1/M1@g1'), false);
  const start = { event: 'node_started', node: 'R/M1/M1', generation: 1, runId: runFor('R/M1/M1', 1), pid: 1, host: 'h' };
  assert.match(why(state, start) ?? '', new RegExp(`R/M1/M1@g1 is ${heldPhraseOf(state, 'R/M1/M1@g1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: it is not started`), 'known-bad (42b31036): no held line, the node starts');
});
