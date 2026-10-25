// 0.8.3 red triage, the SLOT FIX and the DEAD-FRONTIER BLOCK (C&C thcmcp-cd rulings, 23 Okt 2026). Fold units on raw events (as test/tree-dead-nodes.test.js does): no files, all $0.
//   SLOT (Option A): a node that is REGISTERED, never started and DEAD can never start (node_started refuses a dead key), so it does not hold the one slot; a dead node that RUNS keeps it; a LIVE registered node holds it.
//   A4: a parent_changed block refuses every paid event tree-wide (it is in `sticky`). One whose frontier's PARENT is dead guards nothing and is dropped (by state); one on a frontier whose parent is LIVE stays, and approving that frontier again lifts it.
// Rows: (S1) dead + registered: no slot; (S2) live registered: the slot (control); (S3) dead + RUNNING: the slot; (B1) the lock: a block on the dead frontier of a replaced parent is dropped, and the replacement registers; (B2) the fail-closed half: under that dead frontier a
// registration is still refused and the dead node still cannot start; (B3) corner 1: the parent is live, the block stays and re-approving its frontier lifts it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { foldRecord, deadKeys, transitionRefusal } from '../src/tree-transitions.js';
import { FIXTURE_BOUND } from './helpers/tree-fixture.js';

const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5 }, bundleSha256: 'b'.repeat(64) });
const started = (id, n, g, pid = 2147483000) => ({ id, event: 'node_started', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, pid, host: hostname() });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status, share: 'released' });
const preview = (id, fk, parent, pg, children) => ({ id, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children: children.map(c => ({ node: c, generation: 1 })) });
const approve = (id, fk, revision = 1) => ({ id, event: 'frontier_approved', frontierKey: fk, revision, boundSha256: FIXTURE_BOUND, gateId: 'g', shownSha256: '0'.repeat(64) });
const ROOT = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, started('e2b', 'R', 1, 1), closed('e2c', 'R', 1)];
const blockOn = (id, fk, scope) => ({ id, event: 'blocked', reason: 'parent_changed', scope, frontierKey: fk, check: 'ancestor', detail: 'x' });
const stopOn = (id, node, affected) => ({ id, event: 'needs_decision_opened', node, generation: 1, runId: `run-${node.replace(/\//g, '-')}-1`, source: 'node_closed', affected: affected.map(a => ({ node: a, generation: 1 })) });
const decide = (id, stopId, affected) => ({ id, event: 'decision_recorded', text: 't', affected: affected.map(a => ({ node: a, generation: 1 })), form: 'regenerate', stopId, gateId: 'g', shownSha256: '0'.repeat(64) });
const opened = (id, decisionId, node) => ({ id, event: 'generation_opened', decisionId, nodes: [{ node, generation: 2 }] });
const noBlock = refusal => assert.equal(/blocked: parent_changed/.test(String(refusal?.reason)), false, JSON.stringify(refusal));

// R -> kA -> R/M1 (closed, needs_decision) and R/M2 (D: registered, never started). The stop on R/M1 lists both; the regenerate decision opens R/M1@g2: D is dead (listed).
const listed = [...ROOT, preview('e3a', 'kA', 'R', 1, ['R/M1', 'R/M2']), approve('e3b', 'kA'),
  { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1, 1), closed('e4c', 'R/M1', 1, 'needs_decision'), { id: 'e5', ...run('R/M2', 1, 'R', 'kA') }];
const regen = [stopOn('e6', 'R/M1', ['R/M1', 'R/M2']), decide('e7', 'e6', ['R/M1', 'R/M2']), opened('e8', 'e7', 'R/M1')];

test('S1/S2/S3 the slot: a dead registered never-started node does not hold it; a live registered node does; a dead node that RUNS keeps it', () => {
  const before = foldRecord([...listed, stopOn('e6', 'R/M1', ['R/M1', 'R/M2'])]);
  assert.equal(before.active, 'R/M2@g1', 'S2 control: the registered node of a live plan holds the slot');
  const dead = foldRecord([...listed, ...regen]);
  assert.equal(deadKeys(dead).has('R/M2@g1'), true);
  assert.equal(dead.nodes.get('R/M2@g1').phase, 'registered');
  assert.deepEqual([dead.active, dead.activeKeys], [null, []], `S1: dead and registered: no slot; the fold says active ${JSON.stringify(dead.active)}, activeKeys ${JSON.stringify(dead.activeKeys)}`);
  const running = foldRecord([...listed.slice(0, -1), { id: 'e5', ...run('R/M2', 1, 'R', 'kA') }, started('e5b', 'R/M2', 1), ...regen]);
  assert.equal(deadKeys(running).has('R/M2@g1'), true);
  assert.equal(running.active, 'R/M2@g1', 'S3: a dead node that RUNS keeps the slot (the check "never races a running node" still holds)');
});

// CORNER 2: R -> kA -> R/M1 (closed, needs_decision) -> kB (parent R/M1@g1; children R/M1/M1 = D and R/M1/M2) ; D registered never started; a parent_changed block stands on kB; R/M1 is regenerated: D is an ORPHAN of a replaced parent.
const replaced = [...ROOT, preview('e3a', 'kA', 'R', 1, ['R/M1']), approve('e3b', 'kA'),
  { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1, 1), closed('e4c', 'R/M1', 1, 'needs_decision'),
  preview('e5a', 'kB', 'R/M1', 1, ['R/M1/M1', 'R/M1/M2']), approve('e5b', 'kB'), { id: 'e5', ...run('R/M1/M1', 1, 'R/M1', 'kB') },
  preview('e5c', 'kD', 'R/M1', 1, ['R/M1/M3']), approve('e5d', 'kD'),       // kD: a second frontier of the same parent, with NO block
  blockOn('e6b', 'kB', 'R/M1/M1@g1'), stopOn('e6', 'R/M1', ['R/M1']), decide('e7', 'e6', ['R/M1']), opened('e8', 'e7', 'R/M1'),
  { ...preview('e9a', 'kC', 'R', 1, []), children: [{ node: 'R/M1', generation: 2 }] }, approve('e9b', 'kC')];       // kC: the new frontier of the live root, for the replacement R/M1@g2

test('B1 THE LOCK: the block on the DEAD frontier of a replaced parent is dropped (it would refuse every paid event, the replacement\'s registration included), and the replacement registers', () => {
  const s = foldRecord(replaced);
  const reg = transitionRefusal(s, { id: 'x1', ...run('R/M1', 2, 'R', 'kC') });
  assert.equal(reg, null, `the replacement R/M1@g2 registers under its own, approved frontier (the A-alone red shows the blocked text here): ${JSON.stringify(reg)}`);
  assert.equal(deadKeys(s).has('R/M1/M1@g1'), true, 'D is dead: an orphan of the replaced R/M1@g1');
  assert.equal(s.nodes.get('R/M1/M1@g1').phase, 'registered');
  assert.equal(s.active, null, 'and it holds no slot');
  assert.equal(s.parentBlocks.size, 0, 'the block of the dead frontier kB is gone');
  assert.equal(s.sticky.has('parent_changed'), false, 'sticky is derived from what is left of the blocks');
});

test('B2 the fail-closed half: under the dead frontier a registration is STILL refused, whatever the frontier\'s own flag says, and the dead node still cannot start', () => {
  const s = foldRecord(replaced);
  // kB still carries the `blocked` flag its block set (approvalValid reads it: the approval is "no longer valid", the :1190 row, which fires BEFORE the replaced-parent rows); kD has no block, so the replaced-parent row :1195 answers
  const underBlocked = transitionRefusal(s, { id: 'x2', ...run('R/M1/M2', 1, 'R/M1', 'kB') });
  assert.match(String(underBlocked?.reason), /the approval for that frontier key is no longer valid/, JSON.stringify(underBlocked));
  noBlock(underBlocked);
  const underClean = transitionRefusal(s, { id: 'x2b', ...run('R/M1/M3', 1, 'R/M1', 'kD') });
  assert.match(String(underClean?.reason), /which was replaced: its new split is the one that counts/, JSON.stringify(underClean));
  const start = transitionRefusal(s, { id: 'x3', event: 'node_started', node: 'R/M1/M1', generation: 1, runId: 'run-R-M1-M1-1', pid: 1, host: 'h' });
  assert.match(String(start?.reason), /is dead/, JSON.stringify(start));
});

test('B3 corner 1: the PARENT is live (only the children were replaced): the block stays, it refuses a paid event, and re-approving the frontier lifts it', () => {
  const blocked = [...listed, blockOn('e5c', 'kA', 'R/M2@g1'), ...regen];
  const s = foldRecord(blocked);
  assert.equal(deadKeys(s).has('R/M2@g1'), true);
  assert.equal(s.sticky.has('parent_changed'), true, 'the block of a frontier whose parent R@g1 is live stays');
  assert.match(String(transitionRefusal(s, { id: 'x4', ...run('R/M3', 1, 'R', 'kA') })?.reason), /the tree is blocked: parent_changed/);
  const lifted = foldRecord([...blocked, approve('e9', 'kA', 2)]);
  assert.equal(lifted.sticky.has('parent_changed'), false, 're-approving kA is the way out');
});

test('S4 the row of a root stop a PERSON opens (tree-transitions.js :1370, state.active) no longer refuses because of a dead registered node (OLD: "R/M2@g1 is active: nothing may be running when a person opens a stop on the root plan")', () => {
  const s = foldRecord([...listed, ...regen]);
  assert.equal(deadKeys(s).has('R/M2@g1'), true);
  const refusal = transitionRefusal(s, { id: 'x5', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'The plan is wrong at the root.', gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' });
  assert.equal(refusal, null, JSON.stringify(refusal));
});
