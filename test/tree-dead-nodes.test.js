// CHANGED ACCEPTED (already-false unit, C&C thcmcp-cd 24 Okt 2026; the dead-key sentence): OLD "its plan, or an ancestor's, was replaced"; NEW "replaced or set aside by a decision, or a node above it was" (table rows: "is dead (NEW): ..."; screens and refusals: "is dead: it was NEW, ..."). WHY: the old words are false for a node a decision LISTED (a consumer that never wrote a plan, or one with no successor) and for a transitive orphan whose parent was never replaced; the new tail holds on every route into deadKeys. Only the words moved: every row refuses the same keys as before.
// 0.8.3 M6 slice S8, the MONEY commit (rulings row 130; the design note G1, G3, G8, section 5a): three generic changes to accepted M5e code that the root re-plan cannot work without, and that matter for child regenerates too.
//   G1  `orphansOf` is TRANSITIVE: a grandchild of a replaced child is an orphan too (its own frontier's parent generation was never replaced, so it stayed a live, stale-for-good path).
//   G3  `deadKeys` (orphans + the nodes a regenerate decision held for good once its generation opened) is the ONE definition of "dead", and budgetOf holds NOTHING for a dead node that cannot spend any more; a dead node that is still RUNNING
//       keeps its hold until it ends (its process runs on after the decision; releasing the money would grant it twice); a node that is merely stop-stale or parent-changed-stale is NOT dead and keeps its hold (it can resume).
//   G8  the `grant_issued` table row refuses a dead node (defence in depth behind the CLI's R10 refusal); the resume chooser does not list a dead stopped node as waiting for a top-up.
// Fold units on raw events (as test/tree-latest-by-path.test.js does) and one real record with run folders for the money. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldRecord, deadKeys, orphansOf, transitionRefusal } from '../src/tree-transitions.js';
import { sittingLines, stoppedNodesOf } from '../src/tree-resume.js';
import { sittingFacts } from '../src/tree-stop-view.js';
import { gatherHandoffFacts } from '../src/tree-handoff.js';
import { decideHandler } from '../src/tree-decide.js';
import { terminal } from './helpers/terminal.js';
import { isDeadNode } from '../src/tree-run.js';
import { continuationRefusal } from '../src/tree-continuation.js';
import { TreeRefusal, appendTreeEvent } from '../src/tree-record.js';
import { budgetOf, gateTree, topUp } from '../src/tree-budget.js';
import { track } from './helpers/temp-trees.js';
import { GATE_FIELDS, IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';
import { FIXTURE_BOUND } from './helpers/tree-fixture.js';

const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' } });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', gateId: 'g', shownSha256: '0'.repeat(64), boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, pid: 1, host: 'h' });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status, share: 'released' });
const stopped = (id, n, g) => ({ id, event: 'node_stopped', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, reason: 'budget' });
const ROOT = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1)];
const sorted = set => [...set].sort();

test('G1: orphansOf is transitive - a depth-3 descendant of a replaced child is an orphan, and the same depth under a parent that was NOT replaced is not (the control)', () => {
  // R -> R/M1@g1 -> R/M1/M1@g1 -> R/M1/M1/M1@g1, all closed
  const tree = [...ROOT,
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1),
    ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e5'), { id: 'e6', ...run('R/M1/M1', 1, 'R/M1', 'kB') }, started('e6b', 'R/M1/M1', 1), closed('e6c', 'R/M1/M1', 1),
    ...front('kC', 'R/M1/M1', 1, [{ node: 'R/M1/M1/M1', generation: 1 }], 'e7'), { id: 'e8', ...run('R/M1/M1/M1', 1, 'R/M1/M1', 'kC') }, started('e8b', 'R/M1/M1/M1', 1), closed('e8c', 'R/M1/M1/M1', 1)];
  assert.deepEqual(sorted(orphansOf(foldRecord(tree))), [], 'control: nothing was replaced, nothing is an orphan');
  // R/M1 is replaced (a status stop, a regenerate decision, its generation 2 registered): the child AND the grandchild are orphans
  const replaced = [...tree,
    { id: 'e9', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'status', affected: [{ node: 'R/M1', generation: 1 }] },
    { id: 'e10', event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: 'e9', gateId: 'g', shownSha256: '0'.repeat(64) },
    { id: 'e11', event: 'generation_opened', decisionId: 'e10', nodes: [{ node: 'R/M1', generation: 2 }] },
    ...front('kD', 'R', 1, [{ node: 'R/M1', generation: 2 }], 'e12'), { id: 'e13', ...run('R/M1', 2, 'R', 'kD') }];
  assert.deepEqual(sorted(orphansOf(foldRecord(replaced))), ['R/M1/M1/M1@g1', 'R/M1/M1@g1']);
  // the sibling subtree of an unreplaced parent stays live: add R/M2@g1 with its own child
  const sibling = [...replaced, ...front('kE', 'R', 1, [{ node: 'R/M2', generation: 1 }], 'e14'), { id: 'e15', ...run('R/M2', 1, 'R', 'kE') }, started('e15b', 'R/M2', 1), closed('e15c', 'R/M2', 1),
    ...front('kF', 'R/M2', 1, [{ node: 'R/M2/M1', generation: 1 }], 'e16'), { id: 'e17', ...run('R/M2/M1', 1, 'R/M2', 'kF') }];
  assert.deepEqual(sorted(orphansOf(foldRecord(sibling))), ['R/M1/M1/M1@g1', 'R/M1/M1@g1'], 'the grandchild under R/M2 is not an orphan');
});

test('G3: deadKeys is orphans + the nodes a regenerate decision held for good once its generation OPENED - not a pending one, not a stop-stale node, not a parent-changed-stale node', () => {
  const base = [...ROOT, ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'),
    { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1, 'needs_decision'),
    { id: 'e5', ...run('R/M2', 1, 'R', 'kA') }, started('e5b', 'R/M2', 1), stopped('e5c', 'R/M2', 1)];
  const stop = { id: 'e6', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] };
  const dec = { id: 'e7', event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], form: 'regenerate', stopId: 'e6', gateId: 'g', shownSha256: '0'.repeat(64) };
  const open = { id: 'e8', event: 'generation_opened', decisionId: 'e7', nodes: [{ node: 'R/M1', generation: 2 }] };
  const s1 = foldRecord([...base, stop]);
  assert.equal(s1.stale.has('R/M2@g1'), true, 'the open stop puts R/M2 in question'); assert.deepEqual(sorted(deadKeys(s1)), [], 'but it is stop-stale, not dead: its stop can be answered in place and it resumes');
  const s2 = foldRecord([...base, stop, dec]);
  assert.equal(s2.stale.has('R/M2@g1'), true); assert.deepEqual(sorted(deadKeys(s2)), [], 'a decision whose generation is not opened yet is pending: nothing is dead');
  const s3 = foldRecord([...base, stop, dec, open]);
  assert.deepEqual(sorted(deadKeys(s3)), ['R/M1@g1', 'R/M2@g1'], 'once the generation is opened the held marks are for good');
  const s4 = foldRecord([...base, { id: 'e6b', event: 'blocked', reason: 'parent_changed', scope: 'R/M2@g1', frontierKey: 'kA', check: 'ancestor', detail: 'x' }]);
  assert.equal(s4.stale.has('R/M2@g1'), true); assert.deepEqual(sorted(deadKeys(s4)), [], 'a parent-changed mark is released by approving the frontier again: not dead');
});

/** root cap 30; R/M1 (grant 8) closed with Status needs_decision; R/M2 (grant 7, `spentUsd` spent) registered. `r2` is 'registered' (never started), 'stopped' (budget), 'running' (this process holds the claim) or 'gone' (running, its claim's process is dead). A status stop on R/M1 puts R/M2 in question. */
function tree(r2, spentUsd = 2) {
  const t = closedRootTree({ cap: 30 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 8); syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'needs_decision', share: 'revoked' });
  registerKid(t, key, 'R/M2', IDS[1], 7); syntheticRun(t, IDS[1], spentUsd ? { usage: [{ file: 'build', usd: spentUsd }] } : {});
  if (r2 !== 'registered') appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], r2 === 'gone' ? 2147483000 : process.pid, 1, hostnameOf()) });
  if (r2 === 'stopped') appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M2', generation: 1, runId: IDS[1], reason: 'budget' });
  return { t, key };
}
const stopOnM1 = t => appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] });
const regenerate = (t, stop) => { const d = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], form: 'regenerate', stopId: stop.id, ...GATE_FIELDS }); return appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: d.id, nodes: [{ node: 'R/M1', generation: 2 }] }); };
const held = (b, node) => b.nodes.find(n => n.node === node).heldUsd;

test('G3/T11: a budget-stopped node whose plan was replaced holds NOTHING (its $2 spend stays counted and its unspent $5 returns to the pool); the same node with only an open stop on it (stop-stale) KEEPS its hold - the known-bad release keyed on state.stale (T11c)', () => {
  const { t } = tree('stopped');
  const stop = stopOnM1(t);
  const before = budgetOf(t.rootDir);
  assert.equal(held(before, 'R/M2'), 5, 'stop-stale and budget-stopped: it can be topped up and resume after the stop is answered in place, so its money stays held (grant 7 - spent 2)');
  assert.equal(before.treeSpentUsd, 2);
  regenerate(t, stop);
  const after = budgetOf(t.rootDir);
  assert.equal(held(after, 'R/M2'), 0, 'dead: it can never resume');
  assert.equal(after.treeSpentUsd, 2, 'and its spend is still counted');
  assert.equal(Math.round((after.availableUsd - before.availableUsd) * 100) / 100, 5, 'the whole unspent grant returned to the pool, once');
});

// CHANGED ACCEPTED (C&C thcmcp-cd 23 Okt 2026, SG-1 refined: a node with a PROCESS races a regenerate (CnC_M7_Lists.md:175; 21f960f); the 'listed dead while running' flow is refused, so the real flow is: stop the node, then regenerate). OLD (G3): a regenerate listed a RUNNING node dead and the test checked that its hold stayed while its process ran on. NEW: that state is no longer reachable (the table refuses the decision while the node runs); the money rule it protected is checked on the real flow: the refused decision leaves the running node's hold alone, and once the node has ended (stopped) the same decision is accepted and the hold is released.
test('G3 (SG-1): a regenerate that would list a RUNNING node dead is refused and the node keeps its hold; once it has ended the same decision is accepted and the hold is released', () => {
  const { t } = tree('running');
  const stop = stopOnM1(t);
  assert.throws(() => regenerate(t, stop), e => e instanceof TreeRefusal && /never races a running node/.test(e.reason ?? e.message));
  const mid = budgetOf(t.rootDir);
  assert.equal(held(mid, 'R/M2'), 5, 'running: the refused decision left the hold (grant 7 - spent 2)');
  assert.ok(mid.treeSpentUsd + mid.heldUsd <= mid.rootCapUsd + 1e-9, 'spent + holds never exceed the cap');
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M2', generation: 1, runId: IDS[1], reason: 'budget' });
  regenerate(t, stop);
  assert.equal(held(budgetOf(t.rootDir), 'R/M2'), 0, 'it ended and its plan was replaced: the hold is released');
});

test('G8: the grant_issued row refuses a DEAD node (a top-up would promise a resume that cannot happen), library topUp() inherits it, and the same step on a stop-stale stopped node is accepted (the control: the refusal is the dead rule and nothing else)', () => {
  const { t } = tree('stopped', 0);       // no spend: the accounting gate passes, so the refusal that is tested is the dead rule and not the money gate
  const stop = stopOnM1(t);
  const gate = { gateId: 'g-top', shownSha256: 'c'.repeat(64), actor: 'person', via: 'terminal' };       // K10 (EDITED; OLD: gate fields only; NEW: and who answered; WHY: the table requires it on a top-up)
  const grant = { event: 'grant_issued', node: 'R/M2', generation: 1, runId: IDS[1], amount: 1, unit: 'usd', ...gate };
  const live = foldRecordOf(t);
  assert.equal(transitionRefusal(live, grant), null, 'control: stop-stale and stopped - accepted');
  regenerate(t, stop);
  const dead = foldRecordOf(t);
  assert.match(transitionRefusal(dead, grant)?.reason ?? '', /R\/M2@g1 is dead \(replaced or set aside by a decision, or a node above it was\): a top-up would promise a resume that cannot happen/);
  assert.throws(() => topUp(t.rootDir, { node: 'R/M2', amountUsd: 1, ...gate }), e => e instanceof TreeRefusal && /dead/.test(e.message));
  assert.equal(gateTree(t.rootDir).ok, true, 'and the accounting gate is untouched');
});
function foldRecordOf(t) { return gateTree(t.rootDir).state; }

test('G8: the resume chooser (stoppedNodesOf) lists a stop-stale stopped node as waiting for a top-up and does NOT list a dead one (a top-up for it is refused, so the sentence "its grant must be raised first" would point at a command that refuses)', () => {
  const { t } = tree('stopped', 0);
  const stop = stopOnM1(t);
  assert.deepEqual(stoppedNodesOf(gateTree(t.rootDir).state).map(n => n.node), ['R/M2'], 'control: stop-stale and stopped - listed');
  regenerate(t, stop);
  assert.deepEqual(stoppedNodesOf(gateTree(t.rootDir).state).map(n => n.node), [], 'dead: not listed');
});

test('S8 (C&C, the af0bdd4 follow-up): budgetOf releases a dead node\'s hold in every phase but running and closed, so the RECORD refuses every step that would make a dead node spend again - node_started (registered), node_resumed for a budget stop and for a dead claim (resume), node_resumed for a post-run call; each is accepted on the same node while it is only stop-stale (the control)', () => {
  const dead = (r2) => { const { t } = tree(r2, 0); const stop = stopOnM1(t); const before = gateTree(t.rootDir).state; regenerate(t, stop); return { before, after: gateTree(t.rootDir).state }; };
  const ev = (event, extra = {}) => ({ event, node: 'R/M2', generation: 1, runId: IDS[1], pid: process.pid, host: hostnameOf(), ...extra });
  const cases = [
    ['registered', ev('node_started'), /R\/M2@g1 is dead \(replaced or set aside by a decision, or a node above it was\): it is never started/],
    ['stopped', ev('node_resumed', { purpose: 'resume' }), /it is never resumed/],
    // CHANGED ACCEPTED (C&C thcmcp-cd 23 Okt 2026, SG-1 refined: a node with a PROCESS races a regenerate (CnC_M7_Lists.md:175; 21f960f); the 'listed dead while running' flow is refused, so the real flow is: stop the node, then regenerate). OLD: a 'gone' case (a RUNNING node with a dead process) was listed dead and its resume refused. NEW: that decision is refused while the record says the node runs (asserted below), so the case cannot be made dead any more.
  ];
  for (const [phase, event, re] of cases) {
    const { before, after } = dead(phase);
    assert.equal(transitionRefusal(before, event), null, `${phase}: control - stop-stale, accepted`);
    assert.match(transitionRefusal(after, event)?.reason ?? '', re, `${phase}: dead, refused`);
  }
  // C&C 23 Okt 2026 ('gone' ruling): the PHASE decides, liveness only speaks: a node the record says runs whose process died is refused, with the words that say so and name the two real ways out
  { const g = tree('gone', 0); assert.throws(() => regenerate(g.t, stopOnM1(g.t)), e => e instanceof TreeRefusal && /node R\/M2 is marked running but its process is gone/.test(e.reason ?? e.message) && /council tree decide <root run id> --close R\/M2@g1/.test(e.reason ?? e.message) && /if its run already ended, `council tree resume <root run id>` records how it ended first/.test(e.reason ?? e.message), 'gone: refused with the gone wording'); }
  // a post-run call follows a CLOSED node: R/M1 is closed and is itself in the decision's affected set, so it is dead after the generation opened
  const { t } = tree('stopped', 0); const stop = stopOnM1(t);
  const post = { event: 'node_resumed', node: 'R/M1', generation: 1, runId: IDS[0], pid: process.pid, host: hostnameOf(), purpose: 'post_run' };
  const beforeState = gateTree(t.rootDir).state;
  regenerate(t, stop);
  assert.equal(transitionRefusal(beforeState, post), null, 'control: a closed stop-stale node may be given a post-run call');
  assert.match(transitionRefusal(gateTree(t.rootDir).state, post)?.reason ?? '', /R\/M1@g1 is dead \(replaced or set aside by a decision, or a node above it was\): it is never given a post-run call/);
});

test('T11c, the in-place leg (owed before the M6 PASS): a budget-stopped node that an open stop put in question KEEPS its hold; the person resolves the stop IN PLACE; the node is no longer in question, still holds its money, and its resume is accepted by the record (it is not dead)', () => {
  const { t } = tree('stopped', 0);
  const stop = stopOnM1(t);
  const held0 = held(budgetOf(t.rootDir), 'R/M2');
  assert.equal(held0, 7);
  const d = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Keep it.', form: 'milestone', node: 'R/M1', generation: 1, milestone: 'M5', stopId: stop.id, ...GATE_FIELDS, affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  appendTreeEvent(t.rootDir, { event: 'milestone_resolved', decisionId: d.id, node: 'R/M1', generation: 1, milestone: 'M5', changesProvides: false, remaining: [] });
  const state = gateTree(t.rootDir).state;
  assert.equal(state.openStops.includes(stop.id), false, 'the stop is answered in place');
  assert.equal(state.stale.has('R/M2@g1'), false, 'and the node is no longer in question');
  assert.deepEqual(sorted(deadKeys(state)), [], 'nothing is dead');
  assert.equal(held(budgetOf(t.rootDir), 'R/M2'), held0, 'its hold is exactly what it was');
  assert.equal(transitionRefusal(state, { event: 'node_resumed', node: 'R/M2', generation: 1, runId: IDS[1], pid: process.pid, host: hostnameOf(), purpose: 'resume' }), null, 'and it resumes');
});

// CHANGED ACCEPTED (SLOT FIX, C&C thcmcp-cd 23 Okt 2026, Option A; it REVERSES C&C's 12 Oct design "the ACTIVE dead node", whose follow-on is ROADMAP 65 (auto-close, 0.8.4)).
// OLD: a registered node whose plan was replaced "is still the active one", holds the slot until a person runs `--close` (state.active was R/M2@g1; sittingFacts listed it as a registered child to start; the handoff named it "the active node"; the top-up refusal called it "(active)").
// NEW: it can never start (node_started refuses a dead key) and holds no money (S8 G3), so it does NOT hold the slot: state.active is null, no reader offers it as a node to start or as the active node. Nothing closes it (ROADMAP 65 stays open). WHY: a node that can never start is not what the slot protects.
// The refusal checks and the exit-19 line below are UNCHANGED: the continuation check still refuses a dead node on a hand start, and the line "it still holds the active slot ... Close it" is still true for a dead node that RUNS (such a node keeps the slot: test/tree-slot-dead-frontier.test.js).
test('a dead registered node does NOT hold the slot (SLOT FIX, C&C 23 Okt 2026; reverses "the ACTIVE dead node", C&C 12 Oct): the fold, the sitting facts, the handoff and the top-up refusal agree; its own continuation check still refuses it as DEAD and the exit-19 line still names `decide --close`; a refusal of a live node gets no such line', async () => {
  const { t } = tree('registered', 0);
  const stop = stopOnM1(t);
  assert.equal(isDeadNode(t.rootDir, 'R/M2', 1), false, 'control: only in question, not dead');
  assert.equal(gateTree(t.rootDir).state.active, 'R/M2@g1', 'control: before the decision the registered node holds the slot');
  regenerate(t, stop);
  assert.equal(isDeadNode(t.rootDir, 'R/M2', 1), true);
  assert.equal(gateTree(t.rootDir).state.active, null, 'NEW (OLD: R/M2@g1): the dead registered node does not hold the slot');
  assert.deepEqual(gateTree(t.rootDir).state.activeKeys, []);
  const state = gateTree(t.rootDir).state;
  const why = continuationRefusal({ rootDir: t.rootDir, record: { events: [] }, state, node: { node: 'R/M2', generation: 1 }, registered: { chain: {}, frontierKey: null }, chainPath: null, work: t.work, deps: { ancestorCheck: () => null } });
  assert.deepEqual([why?.check, why?.detail], ['dead', 'R/M2@g1 is dead: it was replaced or set aside by a decision, or a node above it was']);
  const res = { status: 'tree_refused', started: [], node: 'R/M2', generation: 1, runId: IDS[1], exitCode: 19, detail: why.detail, deadNode: true };
  const lines = sittingLines(res, 'rid').join('\n');
  assert.ok(lines.includes('The tree refused to start or resume R/M2 (run ' + IDS[1] + ') (exit 19): R/M2@g1 is dead: it was replaced or set aside by a decision, or a node above it was. Nothing was spent.'), lines);
  assert.ok(lines.includes("R/M2@g1 is dead: it was replaced or set aside by a decision, or a node above it was, and it still holds the active slot, so no other node can start. Close it: `council tree decide rid --close R/M2@g1`."), lines);
  assert.equal(sittingLines({ ...res, deadNode: false }, 'rid').join('\n').includes('--close'), false, 'a live node\'s refusal names no close route');
});

// the readers that offered a dead registered node (SLOT FIX, C&C 23 Okt 2026): each its own row, so each can fail by itself
test('A1 sittingFacts (tree-stop-view.js): a dead registered node is not listed as a registered child to start (OLD: listed, with a grant it does not hold; tree-status "holds a grant" and "start the registered child" were built on it)', () => {
  const { t } = tree('registered', 0);
  assert.equal(sittingFacts(t.rootDir).registeredNotStarted.length, 1, 'control: before the decision the live registered node is listed');
  regenerate(t, stopOnM1(t));
  assert.deepEqual(sittingFacts(t.rootDir).registeredNotStarted, []);
});
test('A2 the handoff (tree-handoff.js): a dead registered node is not named "the active node" / the next node to read (OLD: it was)', () => {
  const { t } = tree('registered', 0);
  regenerate(t, stopOnM1(t));
  const facts = gatherHandoffFacts(t.rootDir, { work: t.work });
  assert.notEqual(facts.next?.node, 'R/M2', JSON.stringify(facts.next));
});
test('A3 the top-up refusal (tree-decide.js): a dead registered node is "registered", not "registered (active)" (OLD: "(active)")', async () => {
  const { t } = tree('registered', 0);
  regenerate(t, stopOnM1(t));
  const io = terminal([]); io.stdin.end();
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { 'top-up': 'R/M2', amount: '1' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.notEqual(code, 0, io.shown() + io.errors());
  assert.ok(io.errors().includes('R/M2@g1 is registered; only a node that stopped at its budget cap can be topped up') && !io.errors().includes('(active)'), io.errors());
});
