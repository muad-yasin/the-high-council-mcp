// 0.8.3 M7 apply, C2a-record commit 2 (SHA-stop: records - a regenerate decision's `affected`, the held/kept fold, a table row -; C2a_Gate_Page.md section 3, K1: "root re-plan OR a single sub-plan regenerate: one operation, #6"; plan: Review/Build_0.8.3/m7/C2a_Commit2_Plan_2026-10-18.md; C&C thcmcp-6d 18 Okt: Q1 yes, consumers' finished descendants are candidates too).
// A regenerate answer to a SUB-PLAN stop used to list the stopped node, its consumers and EVERY descendant, so every finished, passed grandchild was dead the moment the new generation opened. Now the decision lists the nodes it REPLACES (the stopped node and its consumers) and the nodes below them that
// cannot be held; the finished, passed ones below are CANDIDATES (held, then kept once the new plan's children are approved without them), and the table binds the list to the stop's recorded set. Fold units on raw events (as test/tree-dead-nodes.test.js does), $0; a record written before this commit
// (the decision lists every descendant) folds as it always did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import * as TR from '../src/tree-transitions.js';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';
import { frontierKey } from '../src/tree-identity.js';
import { planRecovery } from '../src/tree-recovery.js';
import { gatherReadinessFacts } from '../src/tree-ready.js';
import { gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';
import { FIXTURE_BOUND, GATE_FIELDS as GF, IDS, ROOT_ID, SPLIT, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

// a namespace import, so that a missing export (the base of this commit, for the red run) fails the tests that call it and not the whole file at link time
const { candidatesOf, deadKeys, foldRecord, heldKeys, heldPhraseOf, keptKeys, subplanAffectedWanted, transitionRefusal } = TR;
const G = { gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' };       // K10 (EDITED; OLD: gate fields only; NEW: and who answered; WHY: the table requires actor/via on a new decision, close or approval)
const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' } });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, pid: 1, host: 'h' });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status, share: 'released' });
const stopped = (id, n, g) => ({ id, event: 'node_stopped', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, reason: 'budget' });
const sorted = set => [...set].sort();
const keys = list => list.map(a => `${a.node}@g${a.generation}`);

const ROOT = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1)];
// R -> {R/M1, R/M2}; R/M1 -> {R/M1/A, R/M1/B}; R/M1/A -> {R/M1/A/X}; R/M2 -> {R/M2/C}. Every node closed and passed; R/M1 ended with needs_decision (its stop); R/M2 consumes R/M1.
const finished = (path, g, parent, fk, ids, status = null) => [{ id: `${ids}a`, ...run(path, g, parent, fk) }, started(`${ids}b`, path, g), closed(`${ids}c`, path, g, status)];
const BASE = [...ROOT,
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'),
  ...finished('R/M1', 1, 'R', 'kA', 'e4', 'needs_decision'), ...finished('R/M2', 1, 'R', 'kA', 'e5'),
  ...front('kB', 'R/M1', 1, [{ node: 'R/M1/A', generation: 1 }, { node: 'R/M1/B', generation: 1 }], 'e6'),
  ...finished('R/M1/A', 1, 'R/M1', 'kB', 'e7'), ...finished('R/M1/B', 1, 'R/M1', 'kB', 'e8'),
  ...front('kC', 'R/M1/A', 1, [{ node: 'R/M1/A/X', generation: 1 }], 'e9'), ...finished('R/M1/A/X', 1, 'R/M1/A', 'kC', 'e10'),
  ...front('kD', 'R/M2', 1, [{ node: 'R/M2/C', generation: 1 }], 'e11'), ...finished('R/M2/C', 1, 'R/M2', 'kD', 'e12')];
const SET = ['R/M1', 'R/M1/A', 'R/M1/A/X', 'R/M1/B', 'R/M2', 'R/M2/C'].map(node => ({ node, generation: 1 }));        // what the stop records: the stopped node, its consumer, and everything below them (affectedSet)
const STOP = { id: 'e13', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'node_closed', affected: SET };
const decision = affected => ({ id: 'e14', event: 'decision_recorded', text: 't', affected, form: 'regenerate', stopId: 'e13', ...G });
const NEW = [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }];       // the new-style list: only what the decision replaces
const OPEN = { id: 'e15', event: 'generation_opened', decisionId: 'e14', nodes: [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }] };

test('K1 sub-plan route: after the generation opens, the finished, passed descendants of the replaced nodes (and of the CONSUMER) are candidates, held; only the replaced nodes are dead; nothing is a candidate before the generation opens', () => {
  const pending = foldRecord([...BASE, STOP, decision(NEW)]);
  assert.deepEqual(sorted(heldKeys(pending)), [], 'a pending decision (its generation not opened) makes nothing a candidate: every mark stays pending, there is no window');
  assert.deepEqual(sorted(deadKeys(pending)), []);
  const opened = foldRecord([...BASE, STOP, decision(NEW), OPEN]);
  assert.deepEqual(sorted(deadKeys(opened)), ['R/M1@g1', 'R/M2@g1'], 'the replaced nodes are dead, and ONLY they');
  assert.deepEqual(sorted(heldKeys(opened)), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M1/B@g1', 'R/M2/C@g1'], 'every other finished node below them is held');
  assert.deepEqual(sorted(heldKeys(opened, { route: 'root' })), [], 'none of them is the root route\'s');
  assert.deepEqual(sorted(heldKeys(opened, { route: 'sub' })), sorted(heldKeys(opened)));
  const cands = candidatesOf(opened);
  assert.deepEqual(cands.map(c => [c.key, c.route, c.state, c.eligible, c.era, `${c.proposedBy.node}@g${c.proposedBy.generation}`]), [
    ['R/M1/A/X@g1', 'sub', 'held', true, null, 'R/M1@g1'], ['R/M1/A@g1', 'sub', 'held', true, null, 'R/M1@g1'], ['R/M1/B@g1', 'sub', 'held', true, null, 'R/M1@g1'], ['R/M2/C@g1', 'sub', 'held', true, null, 'R/M2@g1']]);
  assert.equal(heldPhraseOf(opened, 'R/M1/A@g1'), 'held pending the new plan of R/M1', 'the refusal names the replaced plan, not the root plan');
  assert.match(transitionRefusal(opened, { event: 'node_resumed', node: 'R/M1/A', generation: 1, runId: 'run-R-M1-A-1', purpose: 'resume', pid: 1, host: 'h' })?.reason ?? '', /R\/M1\/A@g1 is held pending the new plan of R\/M1: it is neither resumed nor given a/);
});

test('K1 sub-plan route: kept = a children frontier of the replaced node\'s NEWER generation was approved without them; the consumer\'s descendants stay held (their plan has offered nothing yet); abandon retires every candidate', () => {
  const reg = foldRecord([...BASE, STOP, decision(NEW), OPEN, ...front('kE', 'R', 1, [{ node: 'R/M1', generation: 2 }], 'e16'), { id: 'e17', ...run('R/M1', 2, 'R', 'kE') }, started('e17b', 'R/M1', 2), closed('e17c', 'R/M1', 2),
    ...front('kF', 'R/M1', 2, [{ node: 'R/M1/N', generation: 1 }], 'e18')]);
  assert.deepEqual(sorted(keptKeys(reg)), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M1/B@g1'], 'R/M1@g2 offered its children and the approval did not adopt them: passed over, still candidates');
  assert.deepEqual(sorted(heldKeys(reg)), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M1/B@g1', 'R/M2/C@g1'], 'kept ones are still candidates; the consumer\'s descendant is held');
  assert.equal(heldPhraseOf(reg, 'R/M1/A@g1'), 'kept from an earlier plan of R/M1 (the new plan did not use it)');
  assert.equal(heldPhraseOf(reg, 'R/M2/C@g1'), 'held pending the new plan of R/M2');
  assert.deepEqual(candidatesOf(reg).filter(c => c.state === 'kept').map(c => c.key), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M1/B@g1']);
  const gone = foldRecord([...BASE, STOP, decision(NEW), OPEN, { id: 'e99', event: 'tree_abandoned', at: '2026-10-18T00:00:00Z', ...G }]);
  assert.deepEqual(sorted(heldKeys(gone)), [], 'abandon retires every candidate');
  assert.deepEqual(sorted(deadKeys(gone)), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M1/B@g1', 'R/M1@g1', 'R/M2/C@g1', 'R/M2@g1'], 'and they are dead like any other replaced node');
});

test('K1 sub-plan route, the TABLE: the list must equal the replaced nodes plus the nodes below them that cannot be held; a missing replaced node, an eligible descendant listed, and a missing unholdable one are each refused with their own words; the new-style list is accepted', () => {
  const before = foldRecord([...BASE, STOP]);
  assert.deepEqual(keys(subplanAffectedWanted(before, 'e13')), ['R/M1@g1', 'R/M2@g1'], 'the wanted list is the topmost nodes of the stop\'s recorded set (all held below)');
  assert.equal(transitionRefusal(before, decision(NEW)), null, 'the new-style list is accepted');
  assert.match(transitionRefusal(before, decision([{ node: 'R/M1', generation: 1 }]))?.reason ?? '', /lists exactly the nodes it replaces.*missing R\/M2@g1/);
  assert.match(transitionRefusal(before, decision([...NEW, { node: 'R/M1/A', generation: 1 }]))?.reason ?? '', /the finished sub-plans that passed are kept for the new plan, not listed: not to be listed R\/M1\/A@g1/);
  // a descendant that cannot be held MUST be listed: R/M1/B is not finished and passed
  // CHANGED ACCEPTED (C&C thcmcp-cd 23 Okt 2026, SG-1 refined: a node with a PROCESS races a regenerate (CnC_M7_Lists.md:175; 21f960f); the 'listed dead while running' flow is refused, so the real flow is: stop the node, then regenerate). OLD: B was RUNNING (its close dropped from the record). NEW: B is budget-STOPPED (node_stopped at the same place): still unholdable, and a stopped node has no process, so the decision is not refused by the running-node guard.
  const running = foldRecord([...BASE.map(e => (e.id === 'e8c' ? stopped('e8c', 'R/M1/B', 1) : e)), STOP]);
  assert.deepEqual(sorted(keys(subplanAffectedWanted(running, 'e13'))), ['R/M1/B@g1', 'R/M1@g1', 'R/M2@g1'], 'a stopped descendant is wanted in the list: it is dead, as before');
  assert.match(transitionRefusal(running, decision(NEW))?.reason ?? '', /missing R\/M1\/B@g1/);
  assert.equal(transitionRefusal(running, decision([...NEW, { node: 'R/M1/B', generation: 1 }])), null);
  const after = foldRecord([...BASE.map(e => (e.id === 'e8c' ? stopped('e8c', 'R/M1/B', 1) : e)), STOP, decision([...NEW, { node: 'R/M1/B', generation: 1 }]), OPEN]);
  assert.deepEqual(sorted(deadKeys(after)), ['R/M1/B@g1', 'R/M1@g1', 'R/M2@g1'], 'the stopped descendant is dead as today');
  assert.deepEqual(sorted(heldKeys(after)), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M2/C@g1'], 'its finished neighbours are candidates');
});

test('K1 sub-plan route, a record written BEFORE this commit (the decision lists every descendant) folds as it always did: they are dead, nothing is a candidate; the OBLIGATION route binds only the safety half', () => {
  const old = foldRecord([...BASE, STOP, decision(SET), OPEN]);
  assert.deepEqual(sorted(deadKeys(old)), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M1/B@g1', 'R/M1@g1', 'R/M2/C@g1', 'R/M2@g1']);
  assert.deepEqual(sorted(heldKeys(old)), [], 'no candidate: the decision listed every descendant');
  // the obligation route: its list is widened at decide time from files, so the row cannot recompute it; an unholdable descendant of a listed node must still be listed
  const before = foldRecord([...BASE.map(e => (e.id === 'e8c' ? stopped('e8c', 'R/M1/B', 1) : e)), STOP]);       // CHANGED ACCEPTED (same ruling: B stopped, not running)
  const ob = affected => ({ ...decision(affected), obligation: 'o1' });
  assert.match(transitionRefusal(before, ob([{ node: 'R/M1', generation: 1 }]))?.reason ?? '', /missing R\/M1\/B@g1/);
  assert.equal(transitionRefusal(before, ob(SET)), null, 'the whole closure is fine on the obligation route');
});

test('K1 sub-plan route, the OPENING: recovery turns a narrowed decision into a generation_opened for exactly the replaced nodes (the topmost listed), whatever is kept below them', () => {
  const record = { corrupt: [], tree: { treeId: 't' }, treeSha256: 'x', events: [...BASE, STOP, decision(NEW)] };
  const [opening, ...rest] = planRecovery(record, { runFactsOf: () => { throw new Error('no run is read: nothing is running'); } });
  assert.equal(rest.length, 0); assert.equal(opening.action, 'append');
  assert.equal(opening.event.event, 'generation_opened');
  assert.deepEqual(opening.event.nodes, [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }], 'the same two nodes the wide list opened: narrowing the list drops nothing that gets a generation');
});

test('K1 sub-plan route, MONEY (a REAL record with run folders; C&C 18 Okt: a candidate holds $0 beyond what it spent): the descendant\'s run is counted once and its $8 stays spent while it is held, after it is passed over, and after abandon', () => {
  const t = closedRootTree();
  const k1 = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, k1, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'needs_decision', share: 'released', returnedUsd: 10 });
  // R/M1's children frontier (a hand-written preview/approval pair, as test/helpers/tree-fixture.js approveFrontier writes the root's), then R/M1/A registered, run for $8, closed passed
  const sub = { parentNode: 'R/M1', parentGeneration: 1, parentRunId: IDS[0], splitSha256: SPLIT, children: [{ node: 'R/M1/A', generation: 1 }] };
  const k2 = frontierKey({ ...sub, openedBy: null });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: k2, ...sub, boundSha256: FIXTURE_BOUND });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GF, frontierKey: k2, revision: 1, boundSha256: FIXTURE_BOUND });
  registerKid(t, k2, 'R/M1/A', IDS[1], 10); syntheticRun(t, IDS[1], { usage: [{ file: 'a', usd: 8, provider: 'mock' }] });
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1/A', IDS[1], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1/A', generation: 1, runId: IDS[1], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 2 });
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/A', generation: 1 }] });
  // the REAL table judges the new-style list: only the replaced node, not the finished descendant
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, affected: [{ node: 'R/M1', generation: 1 }], ...GF });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R/M1', generation: 2 }] });
  const figures = () => { const b = budgetOf(t.rootDir); const g = gateTree(t.rootDir); return { spent: b.treeSpentUsd, held: b.heldUsd, available: b.availableUsd, nodeHold: b.nodes.find(n => n.key === 'R/M1/A@g1').heldUsd, runs: g.members.filter(m => m.runId === IDS[1]).length }; };
  const st0 = stateOf(readTreeRecord(t.rootDir));
  assert.deepEqual([...heldKeys(st0)], ['R/M1/A@g1'], 'the finished descendant is a candidate'); assert.equal(keptKeys(st0).size, 0);
  const held = figures();
  assert.equal(held.spent >= 8 - 1e-9, true, 'the 8.00 it spent stays counted'); assert.equal(held.runs, 1, 'its run counts once'); assert.equal(held.nodeHold, 0, 'a candidate holds nothing');
  // passed over: a children frontier of R/M1@g2 approved without it (raw, in the writer\'s shape: a MONEY pin, not a writer test)
  const next = { parentNode: 'R/M1', parentGeneration: 2, parentRunId: 'run-R-M1-2', splitSha256: SPLIT, children: [{ node: 'R/M1/N', generation: 1 }] };
  const lines = [{ event: 'frontier_previewed', frontierKey: frontierKey({ ...next, openedBy: null }), ...next, boundSha256: FIXTURE_BOUND }, { event: 'frontier_approved', ...GF, frontierKey: frontierKey({ ...next, openedBy: null }), revision: 1, boundSha256: FIXTURE_BOUND }];
  lines.forEach((l, i) => appendFileSync(join(treeDirOf(t.rootDir), 'events.jsonl'), `${JSON.stringify({ schema: 'tree-events/1', id: `e${st0.lastId + 1 + i}`, at: new Date().toISOString(), ...l })}\n`));
  const st1 = stateOf(readTreeRecord(t.rootDir)); assert.deepEqual([...keptKeys(st1)], ['R/M1/A@g1']);
  // THE FOUR READERS (C&C 18 Okt): the candidate is NOT in the live node list the verdict counts (readiness), the handoff's node list or the status node list; it is in the ONE held/kept list, with the plan it hangs under
  const rf = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.equal(rf.nodes.some(n => n.node === 'R/M1/A'), false, 'readiness: a candidate is not part of the live tree the verdict counts');
  const hf = gatherHandoffFacts(t.rootDir, { work: t.work });
  assert.equal(hf.nodes.some(n => n.node === 'R/M1/A'), false, 'handoff: not in the node list');
  assert.deepEqual(hf.keptNodes.map(h => [h.node, h.route, h.replaces]), [['R/M1/A', 'sub', 'R/M1']]);
  const htext = renderTreeHandoff(hf);
  assert.match(htext, /### Kept from an earlier plan\n[\s\S]*R\/M1\/A`? generation 1, run \S+ \(kept from an earlier plan of R\/M1 \(the new plan did not use it\)\)/);
  const sf = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.equal(sf.nodes.some(n => n.node === 'R/M1/A'), false, 'status: not in the node list');
  assert.match(renderTreeStatus(sf), /Kept from an earlier plan\n[\s\S]*R\/M1\/A {2}generation 1 {2}run \S+ \(kept from an earlier plan of R\/M1/);
  assert.deepEqual(treeStatusPayload(sf).keptNodes.map(h => [h.node, h.route, h.replaces]), [['R/M1/A', 'sub', 'R/M1']], 'MCP: the plain node list has no such node, the kept list names the plan');
  assert.deepEqual(figures(), held, 'passing it over moves no dollar');
  appendTreeEvent(t.rootDir, { event: 'tree_abandoned', ...GF });
  const gone = figures();
  assert.deepEqual([gone.spent, gone.held, gone.runs, gone.nodeHold], [held.spent, 0, 1, 0], 'abandon: the 8.00 is still counted once, nothing is held');
});

const RUNNING_B = [...BASE.filter(e => e.id !== 'e8c'), STOP, decision(NEW), OPEN];            // R/M1/B never closed; the list is the new style and does NOT name it (a record the table did not judge)

test('K1 sub-plan route, a decision that omits a RUNNING descendant (a record the table did not judge): its finished neighbours are candidates and the candidates list says why the running one is not (NEW BEHAVIOUR: red at the base, which has no candidates at all)', () => {
  const st = foldRecord(RUNNING_B);
  assert.deepEqual(sorted(heldKeys(st)), ['R/M1/A/X@g1', 'R/M1/A@g1', 'R/M2/C@g1'], 'the finished neighbours are held');
  const all = candidatesOf(st).find(c => c.key === 'R/M1/B@g1');
  assert.deepEqual([all.state, all.eligible.code], ['set_aside', 'not_finished'], 'and the candidates list says why the running one is not');
});

test('K1 sub-plan route, the holdability GUARD (a CONTROL at the base, green there: the base never holds a running node; no red exists for the guard line itself): a running descendant the decision omitted reads dead, never held', () => {
  const st = foldRecord(RUNNING_B);
  assert.equal(heldKeys(st).has('R/M1/B@g1'), false, 'the running descendant is not held');
  assert.equal(deadKeys(st).has('R/M1/B@g1'), true, 'it is dead, like any orphan that cannot be held');
});
