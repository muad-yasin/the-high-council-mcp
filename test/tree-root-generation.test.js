// CHANGED ACCEPTED (already-false unit, C&C thcmcp-cd 24 Okt 2026; the dead-key sentence): OLD "its plan, or an ancestor's, was replaced"; NEW "replaced or set aside by a decision, or a node above it was" (table rows: "is dead (NEW): ..."; screens and refusals: "is dead: it was NEW, ..."). WHY: the old words are false for a node a decision LISTED (a consumer that never wrote a plan, or one with no successor) and for a transitive orphan whose parent was never replaced; the new tail holds on every route into deadKeys. Only the words moved: every row refuses the same keys as before.
// 0.8.3 M6 slice S8-2a (rulings row 130; design note sections 2-3, 5a, 13): the RECORD LAYER of a root re-plan - what the table accepts and refuses once the root can be replaced: the decision (replansRoot), the generation it opens, the
// frontier of the replacement (no parent), the registration of a root generation >= 2 (row R2), and the dead-state rule for a superseded root generation. Fold units on raw events, as test/tree-latest-by-path.test.js does. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childGenerationOf, foldRecord, deadKeys, transitionRefusal, eventShapeError } from '../src/tree-transitions.js';
import { topmostOf } from '../src/tree-recovery.js';
import { continuationRefusal } from '../src/tree-continuation.js';
import { FIXTURE_BOUND } from './helpers/tree-fixture.js';

const G = { gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' };       // K10 (EDITED; OLD: gate fields only; NEW: and who answered; WHY: the table requires actor/via on a new decision, close or approval)
const RID2 = '2026-10-12T09-00-00-000Z';       // a fresh run folder id
const runFor = (n, g) => (n === 'R' && g === 1 ? 't' : `run-${n.replace(/\//g, '-')}-${g}`);
const reg = (n, g, parent, fk, extra = {}) => ({ event: 'node_registered', node: n, generation: g, runId: runFor(n, g), attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' }, ...extra });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: runFor(n, g), pid: 1, host: 'h' });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: runFor(n, g), outcome: 'passed', passed: true, status, share: 'released' });
const BASE = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, 'needs_decision'),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1)];
const STOP = { id: 'e5', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const DEC = { id: 'e6', event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: 'e5', replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...G };
const OPEN = { id: 'e7', event: 'generation_opened', decisionId: 'e6', nodes: [{ node: 'R', generation: 2 }] };
const PREV = { id: 'e8', event: 'frontier_previewed', kind: 'root_replan', openedBy: 'e6', frontierKey: 'kR', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND };
const APPR = { id: 'e9', event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: 'kR', revision: 1 };
const R2 = { event: 'node_registered', node: 'R', generation: 2, runId: RID2, attempt: 1, depth: 0, parentNode: null, frontierKey: 'kR', chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 9, unit: 'usd' }, replacesRunId: 't', bundleSha256: 'b'.repeat(64), taskSha256: 'c'.repeat(64) };
const st = (...evs) => foldRecord([...BASE, ...evs]);
const why = (state, event) => transitionRefusal(state, { id: 'e99', ...event })?.reason ?? null;

test('the decision: a regenerate answer to a ROOT stop is accepted when it says it re-plans the root (replansRoot) and the root is closed with nothing active; every other shape is refused with its own sentence', () => {
  const s = st(STOP);
  assert.equal(why(s, DEC), null, 'the case');
  assert.match(why(s, { ...DEC, replansRoot: undefined }), /belongs to the root: a regenerate answer to it re-plans the root and must say so \(replansRoot\)/);
  assert.match(why(s, { ...DEC, form: 'milestone', node: 'R', generation: 1, milestone: 'M5' }), /only the regenerate form re-plans the root/);
  // a CHILD's stop: replansRoot is refused (control: the same decision without it is the ordinary child regenerate)
  const child = st({ id: 'e5c', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] });
  assert.match(why(child, { ...DEC, stopId: 'e5c' }), /belongs to R\/M1, not to the root: replansRoot answers a stop of the root/);
  assert.equal(why(child, { ...DEC, stopId: 'e5c', replansRoot: undefined, affected: [{ node: 'R/M1', generation: 1 }] }), null, 'control: the child regenerate is unchanged');
  // nothing active: a registered (never started) child makes it refuse
  const busy = foldRecord([...BASE, ...front('kB', 'R', 1, [{ node: 'R/M2', generation: 1 }], 'e4d'), { id: 'e4e', ...reg('R/M2', 1, 'R', 'kB') }, STOP]);
  assert.match(why(busy, DEC), /node R\/M2@g1 is active: a root re-plan never races a running node/);
  // one at a time
  const pending = st(STOP, DEC);
  const stop2 = { ...STOP, id: 'e5x' };
  assert.match(why(foldRecord([...BASE, STOP, stop2, DEC]), { ...DEC, id: 'e6x', stopId: 'e5x' }), /a root re-plan is already pending/);
  assert.ok(pending);
  // the root must be closed: a root registered, started and not closed is refused (the case: a stop on a running root cannot exist, so build the state by hand)
  const running = foldRecord([{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), { ...STOP, id: 'e2c' }]);
  assert.match(why(running, { ...DEC, stopId: 'e2c' }) ?? '', /(is not closed|is active|a root plan is replaced only once it is closed)/);
});

test('generation_opened names R@g2; the replacement frontier has NO parent (the four parent fields null) and is opened by that very decision; nulls without kind root_replan, a parent with it, a wrong child, an unopened decision are all refused', () => {
  const opened = st(STOP, DEC, OPEN);
  assert.equal(why(opened, PREV), null, 'the case');
  assert.match(why(st(STOP, DEC), PREV), /opened by a decision that re-plans the root and has opened its generation/, 'the decision has not opened its generation yet');
  assert.match(why(opened, { ...PREV, kind: undefined }), /a split frontier names its parent and the split it was proposed from/, 'nulls need kind root_replan');
  assert.match(why(opened, { ...PREV, parentNode: 'R', parentGeneration: 1 }), /a root replacement frontier has no parent/);
  assert.match(why(opened, { ...PREV, children: [{ node: 'R', generation: 3 }] }), /lists exactly the root generation its decision opened \(R@g2\)/);
  assert.match(why(opened, { ...PREV, openedBy: 'e5' }), /opened by a decision that re-plans the root/);
  assert.equal(eventShapeError({ schema: 'tree-events/1', id: 'e8', at: new Date().toISOString(), ...PREV }), null, 'the shape accepts the nulls');
  assert.match(eventShapeError({ schema: 'tree-events/1', id: 'e8', at: new Date().toISOString(), ...PREV, kind: 'other' }) ?? '', /"kind" is malformed/);
});

test('row R2 (T1): R@g2 registers only after its decision opened it and its replacement frontier was approved, with a fresh run id, the run it replaces, the bundle and the task hashes, and nothing active; row R1 (generation 1) is unchanged', () => {
  const ready = st(STOP, DEC, OPEN, PREV, APPR);
  assert.equal(why(ready, R2), null, 'the case');
  assert.match(why(st(STOP, DEC, OPEN, PREV), R2), /no frontier_approved for that root replacement frontier/);
  assert.match(why(ready, { ...R2, runId: 't' }), /fresh run folder id: not the tree id/);
  assert.match(why(ready, { ...R2, runId: 'not-a-run-folder' }), /fresh run folder id/);
  assert.match(why(ready, { ...R2, runId: runFor('R/M1', 1) }), /fresh run folder id/);
  assert.match(why(ready, { ...R2, generation: 3 }), /is not the root generation a decision opened/);
  assert.match(why(ready, { ...R2, replacesRunId: 'other' }), /replaces the run t \(R@g1\), not other/);
  assert.match(why(ready, { ...R2, bundleSha256: undefined }), /registered with the sha256 of its input bundle and of the task bytes/);
  assert.match(why(ready, { ...R2, taskSha256: undefined }), /registered with the sha256 of its input bundle and of the task bytes/);
  assert.match(why(ready, { ...R2, frontierKey: 'kA' }), /no frontier_approved for that root replacement frontier/);
  assert.match(why(ready, { ...R2, parentNode: 'R' }), /depth 0 and no parent/);
  // nothing active
  const busy = foldRecord([...BASE, STOP, DEC, OPEN, PREV, APPR, ...front('kB', 'R', 1, [{ node: 'R/M2', generation: 1 }], 'e10'), { id: 'e11', ...reg('R/M2', 1, 'R', 'kB') }]);
  assert.match(why(busy, R2) ?? '', /is active; registration is one node at a time/);
  // twice
  const once = foldRecord([...BASE, STOP, DEC, OPEN, PREV, APPR, { id: 'e10', ...R2 }]);
  assert.match(why(once, { ...R2, runId: '2026-10-12T09-00-01-000Z' }), /is already registered/);
  // row R1: a generation 1 root with another run id is refused, as before
  assert.match(why(foldRecord([{ id: 'e1', event: 'tree_started', treeId: 't' }]), { ...reg('R', 1, null, null), depth: 0, runId: RID2 }), /the root run is the tree itself/);
  // no generation opened: R@g2 is not a thing yet
  assert.match(why(st(STOP, DEC, PREV), R2) ?? '', /(is not the root generation a decision opened|no frontier_approved)/);
});

test('a SUPERSEDED root generation is dead as soon as the next one is OPENED (before it is registered): deadKeys holds R@g1, and the node_resumed (post_run), grant_issued and node_started rows refuse it - the dead-node refusals cover the root; R@g1 is not dead before', () => {
  assert.deepEqual([...deadKeys(st(STOP, DEC))], [...deadKeys(st(STOP, DEC))].filter(k => k !== 'R@g1'), 'a decision that has not opened its generation kills no root');
  const opened = st(STOP, DEC, OPEN);
  assert.ok(deadKeys(opened).has('R@g1'), 'R@g1 is dead once R@g2 is opened');
  assert.match(why(opened, { event: 'node_resumed', node: 'R', generation: 1, runId: 't', pid: 1, host: 'h', purpose: 'post_run' }), /R@g1 is dead \(replaced or set aside by a decision, or a node above it was\): it is never given a post-run call/);
  const registered = foldRecord([...BASE, STOP, DEC, OPEN, PREV, APPR, { id: 'e10', ...R2 }]);
  assert.ok(deadKeys(registered).has('R@g1') && !deadKeys(registered).has('R@g2'), 'and R@g2, the live root, is not');
  assert.equal(why(registered, { event: 'node_started', node: 'R', generation: 2, runId: RID2, pid: 1, host: 'h' }), null, 'R@g2 starts');
  assert.ok(why(registered, { event: 'node_resumed', node: 'R', generation: 1, runId: 't', pid: 1, host: 'h', purpose: 'post_run' }), 'and the superseded root is refused here too (by the active R@g2 first)');
});

test('topmostOf keeps R ONLY for a root re-plan: it opens only R@g+1 (every other affected node is below it); any other decision leaves R out (a root milestone resolution lists R in the stop\'s affected set and must open only the children); a child regenerate opens its topmost nodes as before', () => {
  const withRoot = [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 2 }];
  assert.deepEqual(topmostOf(withRoot, { root: true }), [{ node: 'R', generation: 1 }]);
  assert.deepEqual(topmostOf(withRoot), [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 2 }]);
  assert.deepEqual(topmostOf([{ node: 'R/M1', generation: 1 }, { node: 'R/M1/M2', generation: 1 }, { node: 'R/M3', generation: 1 }]), [{ node: 'R/M1', generation: 1 }, { node: 'R/M3', generation: 1 }]);
});

test('continuationRefusal: a SUPERSEDED root generation is refused as DEAD first (it would skip every check as the root); the generation-2 root is no longer exempt - its bundle, approval and stale checks run (T6)', () => {
  const state = foldRecord([...BASE, STOP, DEC, OPEN, PREV, APPR, { id: 'e10', ...R2 }]);
  const rootDir = mkdtempSync(join(tmpdir(), 'thc-rootgen-'));
  const base = { rootDir, record: { events: [] }, state, chainPath: null, work: rootDir, deps: { ancestorCheck: () => null } };
  const g1 = continuationRefusal({ ...base, node: { node: 'R', generation: 1 }, registered: { chain: {}, frontierKey: null } });
  assert.deepEqual([g1?.check], ['dead'], g1?.detail);
  const g2 = continuationRefusal({ ...base, node: { node: 'R', generation: 2 }, registered: { chain: {}, frontierKey: 'kR', bundleSha256: 'b'.repeat(64) } });
  assert.deepEqual([g2?.check], ['bundle'], 'R@g2 has an input bundle and it is checked: ' + g2?.detail);
  // the generation-1 root of a tree with NO re-plan still skips (control)
  const plain = foldRecord(BASE);
  assert.equal(continuationRefusal({ ...base, state: plain, node: { node: 'R', generation: 1 }, registered: { chain: {}, frontierKey: null } }), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- S8-2b: THE ERA BOUNDARY (design note 5a)
test('T9b: an old-era decision that OPENED R/M1@g2 (nobody registered it) does not make the new root\'s first R/M1 collide with it - the new child starts above every opened generation; a tree with no root re-plan is unchanged (the control)', () => {
  const oldEra = [...BASE, { id: 'e5c', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] },
    { id: 'e6c', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e5c', affected: [{ node: 'R/M1', generation: 1 }], ...G }, { id: 'e7c', event: 'generation_opened', decisionId: 'e6c', nodes: [{ node: 'R/M1', generation: 2 }] }];
  const control = foldRecord(oldEra);
  assert.equal(childGenerationOf(control, 2, 'R/M1'), 2, 'control: no root re-plan, the old rule (the new parent generation)');
  const replanned = foldRecord([...oldEra, STOP, DEC, OPEN]);
  assert.equal(childGenerationOf(replanned, 2, 'R/M1'), 3, 'after the root re-plan the first R/M1 of R@g2 is g3, above the opened (never registered) g2');
});

test('T9c: every stop opened before the root re-plan is answered by it - the root stop by the decision, the stops of the old era at the era boundary - and nothing of the old era is offered afterwards; a stop opened AFTER stays', () => {
  const old = { id: 'e5c', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] };
  const dec = { ...DEC, affected: [{ node: 'R', generation: 1 }] };           // the decision does not list R/M1: its stop is still open until the era boundary
  const beforeOpen = foldRecord([...BASE, old, STOP, dec]);
  assert.deepEqual([...beforeOpen.openStops], ['e5c'], 'before the generation opens the old-era stop is still open');
  const afterOpen = foldRecord([...BASE, old, STOP, dec, OPEN]);
  assert.deepEqual([...afterOpen.openStops], [], 'retired at the era boundary');
  assert.equal(afterOpen.stale.has('R/M1@g1'), false, 'and its marks went with it');
  const later = foldRecord([...BASE, old, STOP, dec, OPEN, { id: 'e8x', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] }]);
  assert.deepEqual([...later.openStops], ['e8x'], 'a stop opened after the boundary is the new era\'s');
});

test('T9d + root_affected: the old era\'s parent_changed block and root_affected block no longer refuse the new root (lifted at the boundary), a block written AFTER stays; a RECORDED record_corrupt line is history, not a block (EDITED, entry 3, 14 Oct 2026: it used to be "never dropped"; the corruption block is derived from the read, test/tree-corrupt-clears.test.js)', () => {
  const pc = { id: 'e5p', event: 'blocked', reason: 'parent_changed', scope: 'R/M1@g1', frontierKey: 'kA', check: 'ancestor', detail: 'x' };
  const ra = { id: 'e5r', event: 'blocked', reason: 'root_affected', scope: 'tree', stopId: 'e5' };
  const rc = { id: 'e5q', event: 'blocked', reason: 'record_corrupt', scope: 'tree', detail: 'x' };
  const withBlocks = [...BASE, STOP, pc, ra, rc, DEC];
  const before = foldRecord(withBlocks);
  assert.deepEqual([...before.sticky.keys()].sort(), ['parent_changed', 'root_affected'], 'a recorded record_corrupt line is not a block by itself');
  const after = foldRecord([...withBlocks, OPEN]);
  assert.deepEqual([...after.sticky.keys()], [], 'the boundary lifted both old-era blocks');
  const again = foldRecord([...withBlocks, OPEN, { ...pc, id: 'e9p' }]);
  assert.ok(again.sticky.has('parent_changed'), 'a parent_changed written after the boundary stands');
});
