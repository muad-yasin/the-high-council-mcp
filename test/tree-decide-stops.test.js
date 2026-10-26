// The stop-answering records (0.8.3 M5d, sub-commit 5; PLAN 8.4, 8.5 rows 4 and 11): per-stop clearing in the fold, the rules the table now enforces on `decision_recorded` and `milestone_resolved`, and recovery's
// behaviour with them. Stops here are HAND-APPENDED (`needs_decision_opened`): the detection that writes them from a closed node is M5e, and replaces this hand shape. $0, no run is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { foldRecord, orphansOf } from '../src/tree-transitions.js';
import { planRecovery } from '../src/tree-recovery.js';
import { track } from './helpers/temp-trees.js';
import { FIXTURE_BOUND, GATE_FIELDS, IDS, ROOT_ID, approveFrontier, closedChildTree, registerKid } from './helpers/tree-fixture.js';

const events = t => readTreeRecord(t.rootDir).events;
const stop = (t, affected, extra = {}) => appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected, ...extra });
const nodes = (...keys) => keys.map(k => ({ node: k, generation: 1 }));
const refused = (fn, re) => assert.throws(fn, e => e instanceof TreeRefusal && re.test(e.reason), String(re));
const tree = () => { const t = closedChildTree({ cap: 50 }); track(t.work); return t; };
/** a stop of the CHILD R/M1 (closed in tree()): the only kind a PLAIN regenerate may answer (a regenerate answer to a ROOT stop is a root re-plan: S8, `replansRoot`). `stop` opens ROOT stops. */
const cstop = (t, affected, extra = {}) => appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'status', affected, ...extra });
const noFacts = () => ({ hasRunJson: false, end: null, paused: false });

/** Answers a stop IN PLACE (a milestone decision + its resolution on the root's milestone `ms`): this RELEASES the stop's marks (row 8). The root provides to no sibling, so no changesProvides field. */
const resolveInPlace = (t, stopId, ms = 'M5') => {
  const d = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: `resolved ${ms}`, affected: [], form: 'milestone', stopId, node: 'R', generation: 1, milestone: ms, ...GATE_FIELDS });
  return appendTreeEvent(t.rootDir, { event: 'milestone_resolved', node: 'R', generation: 1, milestone: ms, decisionId: d.id });
};
const regenerate = (t, stopId, affected = []) => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'start again', affected, form: 'regenerate', stopId, ...GATE_FIELDS });

test('Q1 (row 4) / row 8: answering stop A IN PLACE releases A\'s stale marks and leaves a parent_changed frontier\'s marks standing; answering it by REGENERATE answers the stop but HOLDS its marks (M5e S3: the nodes are being replaced)', () => {
  const t = tree();
  const key = stateOf(readTreeRecord(t.rootDir)).nodes.get('R/M1@g1').frontierKey;          // the frontier of the closed child tree() holds
  appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'R/M1@g1', frontierKey: key, check: 'ancestor', ancestor: 'R', detail: 'test' });
  const a = stop(t, nodes('R/M2', 'R/M3')); const b = cstop(t, nodes('R/M4'));
  const stale = () => [...stateOf(readTreeRecord(t.rootDir)).stale].sort();
  assert.deepEqual(stale(), ['R/M1@g1', 'R/M2@g1', 'R/M3@g1', 'R/M4@g1'], 'the block\'s mark and the two stops\' marks');
  resolveInPlace(t, a.id);
  assert.deepEqual(stale(), ['R/M1@g1', 'R/M4@g1'], 'A released (in place): its marks are gone; the other stop\'s and the parent_changed frontier\'s stand'); assert.equal(stateOf(readTreeRecord(t.rootDir)).sticky.has('parent_changed'), true);
  regenerate(t, b.id, nodes('R/M4'));
  const st = stateOf(readTreeRecord(t.rootDir));
  assert.deepEqual([...st.stale].sort(), ['R/M1@g1', 'R/M4@g1'], 'B answered by regenerate: the stop is answered, its mark is HELD (the node is being replaced)'); assert.equal(st.openStops.length, 0);
  assert.match(st.staleWhy.get('R/M4@g1').join(' '), /decision e\d+ is replacing it/); assert.match(st.staleWhy.get('R/M1@g1').join(' '), /its parent changed \(frontier [0-9a-f]{8}\)/);
});

test('a node marked by two stops stays stale until BOTH are released (the stale set is a union built at the end, never a shared set edited)', () => {
  const t = tree();
  const a = stop(t, nodes('R/M1', 'R/M2')); const b = stop(t, nodes('R/M2', 'R/M3'));
  assert.deepEqual([...foldRecord(events(t)).stale].sort(), ['R/M1@g1', 'R/M2@g1', 'R/M3@g1'], 'the union of both stops');
  resolveInPlace(t, a.id, 'M5');
  assert.deepEqual([...foldRecord(events(t)).stale].sort(), ['R/M2@g1', 'R/M3@g1'], 'A\'s own mark R/M1 is gone; R/M2 is still B\'s');
  resolveInPlace(t, b.id, 'M4');
  assert.equal(foldRecord(events(t)).stale.size, 0);
});

test('held marks, option (i) SUPERSEDED WITH THE PARENT (M5e S5): before generation_opened every held mark is pending; after it a node the decision REPLACED and a DESCENDANT of a replaced node are stale for good - also AFTER the replacement closed PASSED (the window between "A@g2 passed" and "A@g2\'s new split registers" does not exist); a replacement that did not pass changes nothing either; and there is no release (fold-level, hand-built events)', () => {
  const run = (n, g) => ({ node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: 'R', frontierKey: `k${g}`, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } });
  const base = [
    { id: 'e1', event: 'tree_started', treeId: 't' },
    { id: 'e2', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'x', source: 'node_closed', affected: nodes('R/M1', 'R/M1/M1', 'R/M2') },
    { id: 'e3', event: 'decision_recorded', text: 'again', affected: nodes('R/M1', 'R/M1/M1', 'R/M2'), form: 'regenerate', stopId: 'e2', gateId: 'g', shownSha256: '0'.repeat(64) },
  ];
  const stale = evs => [...foldRecord(evs).stale].sort();
  const all = ['R/M1/M1@g1', 'R/M1@g1', 'R/M2@g1'];
  assert.deepEqual(stale(base), all, 'pending: the decision is recorded and nothing is opened yet');
  const opened = [...base, { id: 'e4', event: 'generation_opened', decisionId: 'e3', nodes: [{ node: 'R/M1', generation: 2 }] }];
  assert.deepEqual(stale(opened), all, 'opened, replacement not registered');
  const registered = [...opened, { id: 'e5', event: 'node_registered', ...run('R/M1', 2) }];
  assert.deepEqual(stale(registered), all, 'registered, not closed');
  const closed = outcome => [...registered, { id: 'e7', event: 'node_closed', node: 'R/M1', generation: 2, runId: 'run-R-M1-2', outcome, passed: outcome === 'passed', status: null, share: 'released' }];
  for (const o of ['not_passed', 'incomplete', 'passed']) assert.deepEqual(stale(closed(o)), all, `closed ${o}: nothing is released`);
  const why = foldRecord(closed('passed')).staleWhy;
  assert.match(why.get('R/M1/M1@g1').join(' '), /superseded with its parent R\/M1, replaced by decision e3/); assert.match(why.get('R/M1@g1').join(' '), /replacing it \(superseded\)/);
});

test('ORPHANS (derived, one definition): a node whose frontier was proposed by an OLDER generation of its parent than the parent path\'s latest (registered or opened) is an orphan; "<" not "!="; the root\'s children are never orphans; nothing is written for it', () => {
  const run = (n, g, parent, fk) => ({ node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } });
  const prev = (fk, parent, pg, children) => ({ event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children });
  const evs = [
    { id: 'e1', event: 'tree_started', treeId: 't' },
    { id: 'e2', event: 'node_registered', ...run('R/M1', 1, 'R', 'kR') },
    { id: 'e3', ...prev('kA', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }]) },
    { id: 'e4', event: 'node_registered', ...run('R/M1/M1', 1, 'R/M1', 'kA') },
  ];
  assert.deepEqual([...orphansOf(foldRecord(evs))], [], 'the parent R/M1 is at generation 1 and so is the frontier\'s parent generation: not an orphan');
  const opened = [...evs, { id: 'e5', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'x', source: 'status', affected: nodes('R/M1') }, { id: 'e6', event: 'decision_recorded', text: 't', affected: nodes('R/M1'), form: 'regenerate', stopId: 'e5', gateId: 'g', shownSha256: '0'.repeat(64) }, { id: 'e7', event: 'generation_opened', decisionId: 'e6', nodes: [{ node: 'R/M1', generation: 2 }] }];
  assert.deepEqual([...orphansOf(foldRecord(opened))], ['R/M1/M1@g1'], 'opened counts as the latest generation already (the window is closed by construction)');
  const registered = [...opened, { id: 'e8', event: 'node_registered', ...run('R/M1', 2, 'R', 'kB') }];
  assert.deepEqual([...orphansOf(foldRecord(registered))], ['R/M1/M1@g1']);
  // a child of the NEW generation is not an orphan; equal generations are not "<"
  const fresh = [...registered, { id: 'e9', ...prev('kC', 'R/M1', 2, [{ node: 'R/M1/M1', generation: 2 }]) }, { id: 'e10', event: 'node_registered', ...run('R/M1/M1', 2, 'R/M1', 'kC') }];
  assert.deepEqual([...orphansOf(foldRecord(fresh))].sort(), ['R/M1/M1@g1'], 'R/M1/M1@g2 is proposed by R/M1@g2, the latest: not an orphan');
});

test('S3 root_affected (Q2): a block carries the id of the ROOT stop that stands for it; answering that stop by REGENERATE leaves the block standing; a ROOT milestone resolution that answers it clears it (event-ordered); a block with no stop id stays sticky for good; a resolution of another node\'s milestone clears nothing', () => {
  const t = tree();
  const rootStop = stop(t, nodes('R', 'R/M1'), { source: 'obligation' });
  const block = (extra = {}) => appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', detail: 'an obligation the root carries', ...extra });
  block({ stopId: rootStop.id });
  const sticky = () => stateOf(readTreeRecord(t.rootDir)).sticky.has('root_affected');
  assert.equal(sticky(), true);
  const other = cstop(t, nodes('R/M2'));
  regenerate(t, other.id, nodes('R/M2'));
  assert.equal(sticky(), true, 'a regenerate anywhere leaves it standing');
  refused(() => regenerate(t, rootStop.id, nodes('R/M1')), /belongs to the root: a regenerate answer to it re-plans the root and must say so \(replansRoot\)/);
  assert.equal(sticky(), true, 'the ROOT stop cannot be answered by a plain regenerate (the table refuses it, S8: only replansRoot re-plans the root): a root milestone resolution, or a root re-plan');
  const t2 = tree();
  const s2 = stop(t2, nodes('R', 'R/M1'), { source: 'obligation' });
  appendTreeEvent(t2.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', detail: 'x', stopId: s2.id });
  resolveInPlace(t2, s2.id);
  assert.equal(stateOf(readTreeRecord(t2.rootDir)).sticky.has('root_affected'), false, 'the root milestone resolution answered the root stop: the block clears');
  const t3 = tree();
  appendTreeEvent(t3.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', detail: 'no stop id' });
  const s3 = stop(t3, nodes('R')); resolveInPlace(t3, s3.id);
  assert.equal(stateOf(readTreeRecord(t3.rootDir)).sticky.has('root_affected'), true, 'a block without a stop id nothing clears');
  // two root blocks (two root stops): answering one clears ITS block only
  const t4 = tree();
  const sa = stop(t4, nodes('R'), { source: 'obligation' }); const sb = stop(t4, nodes('R', 'R/M1'), { source: 'obligation' });
  for (const id of [sa.id, sb.id]) appendTreeEvent(t4.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', detail: 'x', stopId: id });
  resolveInPlace(t4, sa.id, 'M5');
  assert.equal(stateOf(readTreeRecord(t4.rootDir)).sticky.has('root_affected'), true, 'the other root stop\'s block stands');
  resolveInPlace(t4, sb.id, 'M4');
  assert.equal(stateOf(readTreeRecord(t4.rootDir)).sticky.has('root_affected'), false);
});

test('the table: a decision names an OPEN stop (stopId), carries the gate fields and a form; a milestone decision names its milestone; the old bare shape is refused', () => {
  const t = tree();
  refused(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'regenerate', stopId: 'e1', ...GATE_FIELDS }), /no open stop/);
  const a = cstop(t, nodes('R/M1'));
  refused(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'regenerate', ...GATE_FIELDS }), /names an open stop/);
  refused(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'regenerate', stopId: 'e999', ...GATE_FIELDS }), /names an open stop/);
  refused(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'regenerate', stopId: a.id }), /gate whose approval authorized it/);
  refused(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], stopId: a.id, ...GATE_FIELDS }), /regenerate form, the milestone form or the keep form/);
  refused(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'milestone', stopId: a.id, ...GATE_FIELDS }), /names the node, generation and milestone/);
  assert.throws(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: '', affected: [], form: 'regenerate', stopId: a.id, ...GATE_FIELDS }), TypeError, 'empty text');
  const ok = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'fine', affected: nodes('R/M1'), form: 'regenerate', stopId: a.id, ...GATE_FIELDS }); // EDITED in the M7 apply (C2a-record commit 2; old: `affected: []`; why: the table now binds a regenerate's list to the stop's recorded set, so a hand-written decision lists the node its stop recorded)
  refused(() => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'again', affected: [], form: 'regenerate', stopId: a.id, ...GATE_FIELDS }), /no open stop/);
  void ok;
});

test('row 11: milestone_resolved names a recorded decision WITH text, of the milestone form, for THIS milestone, whose stop is still open and which resolved nothing yet; the milestone decision leaves its stop open until then', () => {
  const t = tree();
  const a = stop(t, nodes('R/M1'));
  const rec = (extra = {}) => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'the old API stays', affected: [], form: 'milestone', stopId: a.id, node: 'R', generation: 1, milestone: 'M5', ...GATE_FIELDS, ...extra });
  const res = (decisionId, extra = {}) => appendTreeEvent(t.rootDir, { event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M5', decisionId, ...extra });
  refused(() => res('e999'), /names no recorded decision with text/);
  const reg = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'regen', affected: nodes('R/M2'), form: 'regenerate', stopId: cstop(t, nodes('R/M2')).id, ...GATE_FIELDS }); // EDITED in the M7 apply (C2a-record commit 2; old: `affected: []`; why: the table now binds a regenerate's list to the stop's recorded set, so a hand-written decision lists the node its stop recorded)
  refused(() => res(reg.id), /not a milestone decision/);
  const d = rec();
  assert.deepEqual(foldRecord(events(t)).openStops, [a.id], 'a milestone decision does NOT close its stop');
  refused(() => res(d.id, { milestone: 'M4' }), /was recorded for R@g1:M5, not this milestone/);
  refused(() => res(d.id, { node: 'R/M1' }), /was recorded for R@g1:M5/);
  const r = res(d.id); assert.equal(r.event, 'milestone_resolved');
  assert.equal(foldRecord(events(t)).openStops.length, 0, 'the resolution answers the stop'); assert.deepEqual([...foldRecord(events(t)).stale], ['R/M2@g1'], 'its marks are released; the regenerate decision\'s mark on R/M2 is HELD');
  refused(() => res(d.id), /no open stop|already resolved/);
  // a second decision for the same milestone, on a second stop, cannot resolve it again
  const b = stop(t, nodes('R/M3'));
  const d2 = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'changed my mind', affected: [], form: 'milestone', stopId: b.id, node: 'R', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  refused(() => res(d2.id), /R@g1:M5 is already resolved/);
});

test('recovery: a regenerate decision gets the generation_opened it authorized on the next command (PLAN 8.5 interrupted decision; accepted M1 code, pinned as is); a milestone (resolve-in-place) decision NEVER opens a generation', () => {
  const t = tree();
  const a = stop(t, nodes('R/M1')); const b = cstop(t, nodes('R/M2'));
  appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'resolve in place', affected: [], form: 'milestone', stopId: a.id, node: 'R', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  assert.deepEqual(planRecovery(readTreeRecord(t.rootDir), { runFactsOf: noFacts }), [], 'no generation for an in-place decision');
  const reg = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'start again', affected: [{ node: 'R/M2', generation: 1 }], form: 'regenerate', stopId: b.id, ...GATE_FIELDS });
  const plan = planRecovery(readTreeRecord(t.rootDir), { runFactsOf: noFacts });
  assert.equal(plan.length, 1); assert.deepEqual([plan[0].event.event, plan[0].event.decisionId, plan[0].event.nodes], ['generation_opened', reg.id, [{ node: 'R/M2', generation: 2 }]]);
});

test('a resolution that COVERS a second root stop: the table refuses milestone_resolved when a covered stop was answered meanwhile (here by another milestone\'s resolution), and answering both clears the blocks of BOTH stops, the covered one\'s included', () => {
  const t = tree();
  const a = stop(t, nodes('R'), { source: 'obligation' }); const b = stop(t, nodes('R', 'R/M1'), { source: 'obligation' });
  for (const id of [a.id, b.id]) appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', detail: 'x', stopId: id });
  const d1 = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'both', affected: [], form: 'milestone', stopId: a.id, covers: [b.id], node: 'R', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  // b is answered meanwhile by ANOTHER milestone's resolution of its own
  const d2 = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'other', affected: [], form: 'milestone', stopId: b.id, node: 'R', generation: 1, milestone: 'M4', ...GATE_FIELDS });
  appendTreeEvent(t.rootDir, { event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M4', decisionId: d2.id });
  refused(() => appendTreeEvent(t.rootDir, { event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M5', decisionId: d1.id }), /a stop this decision answers is not open/);
  // and the blocks: a fresh pair, the BLOCK is on the covered (second) stop
  const t2 = tree();
  const c = stop(t2, nodes('R')); const e = stop(t2, nodes('R', 'R/M1'), { source: 'obligation' });
  appendTreeEvent(t2.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', detail: 'x', stopId: e.id });
  const d3 = appendTreeEvent(t2.rootDir, { event: 'decision_recorded', text: 'both', affected: [], form: 'milestone', stopId: c.id, covers: [e.id], node: 'R', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  appendTreeEvent(t2.rootDir, { event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M5', decisionId: d3.id });
  const st = stateOf(readTreeRecord(t2.rootDir)); assert.deepEqual(st.openStops, []); assert.equal(st.sticky.has('root_affected'), false, 'the block of the COVERED stop clears too');
});
