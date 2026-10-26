// Replacement generations (0.8.3 M5e slice 5; PLAN 8.4, 8.2; M5 exit checks L4, L6/L8 through a replacement): a regenerate decision opens generation 2 of the TOPMOST affected nodes; a replacement frontier waits for approval; the
// replaced parent's old children are dead with it (orphans); the consumer waits for the replacement's whole new subtree. Real depth-2 trees, all-mock, $0. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { candidateOriginOf, foldRecord, keptKeys, orphansOf, transitionRefusal } from '../src/tree-transitions.js';
import { affectedFor, treeGraph } from '../src/tree-affected.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { providerEligibility, registerNextChild } from '../src/tree-loop.js';
import { budgetOf } from '../src/tree-budget.js';
import { branchPinsOf } from '../src/tree-reuse-load.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ceilCents, pricedDebateFigures } from './helpers/money-figures.js';
import { APPROVAL_FIELDS, FIXTURE_BOUND, GATE_FIELDS, ROOT_ID, SPLIT_ROOT_HANDOFF_USD, reservedLine, writeLines } from './helpers/tree-fixture.js';

const view = r => { const record = readTreeRecord(r.t.rootDir); return { record, state: stateOf(record), runsDir: r.t.runsDir }; };
const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 6000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
const DECISION = 'The retention rule changes: keep records for 90 days.';

/** R/M1 splits into M2 and M3 children only (M1 is dropped: its milestone is `ready`); no agreement: the NEW split of the replaced R/M1. */
function droppedBlock() {
  const b = block3();
  b.milestones[0] = { id: 'M1', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  b.children = b.children.filter(c => c.id !== 'K1');
  for (const c of b.children) { c.provides = c.provides.filter(p => p.sibling !== 'K1'); c.expects = c.expects.filter(e => e.sibling !== 'K1'); }
  b.agreements = [];
  return b;
}
function oldBlock() {
  const b = block3();
  for (const m of b.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  return b;
}

/** The L8 tree with R/M1's frontier approved; `register`: true runs everything (stage two), false leaves R/M1's children unregistered. */
async function tree({ register }) {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  writeFileSync(join(r.t.work, 'plan-b.md'), planWith(droppedBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = a => draftStarter(r, { 'R/M1': a.generation >= 2 ? 'plan-b.md' : 'plan-a.md' })(a);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);                                                                                 // R/M1's own frontier
  if (register) await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
/** A stop of R/M1 as detection would write it (its closure), answered by a REGENERATE through the real verb. */
async function regenerate(r) {
  const { record, state, runsDir } = view(r);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ record, state, runsDir, node: 'R/M1' }).affected });
  // CHANGED ACCEPTED (bundle unit, 20 Okt 2026). OLD: the regenerate was decided with no flag. NEW: `fresh: true`. WHY: a regenerate now offers the set-aside plan as data by default, and this fixture's approvals are priced for FIXTURE_BUNDLE_ALLOWANCE_BYTES (4000), so the plan makes the new input 5,646 bytes and the child's bundle stops "oversize: over the 4000 its approval was priced for" (needs_decision bundle_input) before it registers. These tests are about dead parents and orphans, not about the earlier-plan route, so they leave the plan out; the data route has its own tests (tree-decide-bundle and the bundle unit's rows). The plan here is a normal finished plan and is read fine.
  const d = decide(r, { fresh: true }, [`${DECISION}\n.`, stop.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  return stop;
}

test('DEAD PARENTS: R/M1 is regenerated while its approved frontier has NOT registered a child: the old children R/M1/M1..M3 are never registered (not by the original frontier, not after R/M1@g2 passed); the never-registered consumer R/M2 enters the replacement as a FRESH admission at g2 (R/M2@g1 never exists) and is counted once', { timeout: 600_000 }, async () => {
  const { r, start } = await tree({ register: false });
  assert.equal(phases(r)['R/M1/M1'], undefined);
  await regenerate(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(out.approvalWaits, true, 'the sitting says a frontier (the replacement) waits for an approval'); assert.equal(out.replacementWaits, true); assert.equal(out.status, 'nothing_to_do', 'nothing is held back: the superseded R/M2@g1 is not even listed');
  const gen = eventsOf(r).find(e => e.event === 'generation_opened');
  assert.deepEqual(gen.nodes.map(n => [n.node, n.generation]), [['R/M1', 2], ['R/M2', 2]], 'topmost only: the descendants R/M1/* are not listed');
  assert.deepEqual(Object.keys(phases(r)).filter(k => k.startsWith('R/M1/')), [], 'the old frontier registered no child');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.deepEqual(pending.children, [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }]);
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.deepEqual(d.view.children.map(c => [c.node, c.generation, c.admitted, c.registered]), [['R/M1', 2, true, null], ['R/M2', 2, true, null]], 'both FRESH admissions (neither "already registered")');
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });                                  // R/M1@g2 runs; the consumer waits for its whole new subtree
  approvePending(r);                                                                                 // R/M1@g2's own frontier (its split drops M1)
  const after = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const reg = eventsOf(r).filter(e => e.event === 'node_registered').map(e => `${e.node}@g${e.generation}`);
  assert.equal(reg.includes('R/M2@g1'), false, 'R/M2@g1 never existed'); assert.equal(reg.filter(k => k === 'R/M2@g2').length, 1, 'counted once');
  assert.equal(reg.some(k => k.startsWith('R/M1/') && k.endsWith('@g1')), false, 'the old children never register, even after R/M1@g2 closed');
  assert.equal(after.status, 'nothing_to_do', JSON.stringify(after));
});

test('SETTLED THROUGH A REPLACEMENT (one tree): R/M1 regenerated after its children ran; its NEW split DROPS M1; the old child R/M1/M1@g1 stays registered, stale and an ORPHAN, is not part of the provider subtree, and the consumer R/M2@g2 starts only once R/M1@g2 AND its new children closed passed, pinning exactly those (never the orphan); the graph keeps R/M1@g1\'s block while g2 is open and uses g2\'s once it closed; descendants born from the re-plan carry the decision LABELLED as the ancestor\'s', { timeout: 900_000 }, async () => {
  const { r, start } = await tree({ register: true });
  assert.equal(phases(r)['R/M1/M1'], 'closed'); assert.equal(phases(r)['R/M2'], 'closed');
  await regenerate(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });                    // recovery opens the generations
  const gen = eventsOf(r).find(e => e.event === 'generation_opened');
  assert.deepEqual(gen.nodes.map(n => [n.node, n.generation]), [['R/M1', 2], ['R/M2', 2]]);
  // the replacement frontier of the parent R: R/M1@g2 and R/M2@g2
  approvePending(r);
  const reg1 = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg1.kind, reg1.node], ['registered', 'R/M1']);
  {
    const g = treeGraph(view(r));                                                                   // R/M1@g2 is registered and NOT closed: R/M1@g1's block still counts
    assert.ok(g.nodes.some(n => n.node === 'R/M1/M1'), 'g1\'s block (with M1) is the newest CLOSED one while g2 is open');
  }
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });                    // R/M1@g2 runs, closes, its split (M2, M3 only) is verified
  const afterClose = view(r);
  assert.deepEqual([...orphansOf(afterClose.state)].sort(), ['R/M1/M1@g1', 'R/M1/M2@g1', 'R/M1/M3@g1'], 'the old children are dead with the replaced parent');
  assert.ok(!treeGraph(afterClose).nodes.some(n => n.node === 'R/M1/M1'), 'g2 closed: its new split is the one that counts, the dropped M1 is gone from the graph');
  assert.ok(findPendingFrontier({ rootDir: r.t.rootDir }), 'R/M1@g2\'s own split waits for approval');
  assert.deepEqual(afterClose.record.events.filter(e => e.event === 'split_verified' && e.node === 'R/M1').map(e => e.generation), [1, 2], 'M5f (a): the rule is per node@GENERATION: R/M1@g2 is verified after R/M1@g1 already was');
  // the consumer does not start before the new children have closed
  assert.deepEqual(eventsOf(r).filter(e => e.event === 'node_registered' && e.node === 'R/M2').map(e => e.generation), [1], 'R/M2@g2 is not registered yet: exactly one registration so far, at g1');
  approvePending(r);                                                                                 // R/M1@g2's own frontier
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out));
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const kids = [...state.nodes.values()].filter(n => n.node.startsWith('R/M1/')).map(n => `${n.node}@g${n.generation}`).sort();
  assert.deepEqual(kids, ['R/M1/M1@g1', 'R/M1/M2@g1', 'R/M1/M2@g2', 'R/M1/M3@g1', 'R/M1/M3@g2'], 'the new split\'s children are g2 (above what the dead parent\'s children had); M1 was dropped');
  const r2 = record.events.find(e => e.event === 'node_registered' && e.node === 'R/M2' && e.generation === 2);
  assert.deepEqual(r2.dependsOn.map(d => `${d.node}@g${d.generation}`).sort(), ['R/M1/M2@g2', 'R/M1/M3@g2', 'R/M1@g2'], 'the consumer pins the replacement and its NEW subtree: never the dropped orphan');
  // BUG-B-002 parity: what the slot rule reads at reuse time (branchPinsOf, by lineage) is what the consumer pinned at registration (tree-derive.js dependsOn minus the provider itself)
  assert.deepEqual(branchPinsOf(state, state.nodes.get('R/M1@g2')).map(p => `${p.node}@g${p.generation}`), ['R/M1/M2@g2', 'R/M1/M3@g2'], 'the branch of the replacement is its own new kids, never the dropped orphans');
  assert.ok(record.events.findIndex(e => e.event === 'node_registered' && e.node === 'R/M2' && e.generation === 2) > Math.max(...record.events.map((e, i) => (e.event === 'node_closed' && e.node.startsWith('R/M1/') && e.generation === 2 ? i : -1))), 'registered only after the new children closed');
  // EDITED in the M7 apply (C2a-record commit 2; old: assert.equal(state.stale.has('R/M1/M1@g1'), true, 'the orphan stays stale for good'); why: a finished, passed child of a regenerated sub-plan is a CANDIDATE kept for the new plan, not stale for good: R/M1@g2's own children frontier was approved without it, so it is kept)
  assert.equal(state.stale.has('R/M1/M1@g1'), false, 'the old child is a candidate, not stale for good');
  assert.equal(keptKeys(state).has('R/M1/M1@g1'), true, 'and it was passed over by the approval of the new plan\'s children');
  // the eraOf commit (C2a-record; a REAL record, produced by the real verbs): the old child is a SUB-route candidate of the replaced R/M1, named so, while the new plan's nodes that reuse the child paths (R/M1/M2@g2, R/M1/M3@g2) are live and not candidates
  assert.deepEqual(candidateOriginOf(state, 'R/M1/M1@g1'), { route: 'sub', replaces: 'R/M1' });
  assert.equal(candidateOriginOf(state, 'R/M1/M2@g2'), null); assert.equal(candidateOriginOf(state, 'R/M1/M3@g2'), null);
  const m = readFileSync(join(bundleDirOf(r.t.rootDir, 'R/M1/M2', 2), 'context.md'), 'utf8');
  const decId = record.events.find(e => e.event === 'decision_recorded').id;
  assert.ok(m.includes(`decision ${decId} re-planned R/M1; this plan is part of that re-plan`) && m.includes(DECISION), 'a descendant born from the re-plan carries the decision, labelled as the ancestor\'s');
  const own = readFileSync(join(bundleDirOf(r.t.rootDir, 'R/M1', 2), 'context.md'), 'utf8');
  assert.ok(own.includes(`----- decision ${decId} -----\n${DECISION}\n----- end -----`) && !own.includes('re-planned R/M1;'), 'the replaced node itself: the decision byte for byte, not labelled as an ancestor\'s');
});

test('L4 (run limit): the replacement child counts toward the run limit: with maxRuns at the current count it is "not admitted: run limit" and takes no grant', { timeout: 600_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: { maxDepth: 2, maxRuns: 4, maxChildrenPerSplit: 4, attemptsPerChild: 1 } });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.size, 4, 'R + three children = the limit');
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M3', generation: 1, runId: view(r).state.nodes.get('R/M3@g1').runId, source: 'status', affected: [{ node: 'R/M3', generation: 1 }] });
  const d = decide(r, {}, ['Again.\n.', stop.id, 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: draftStarter(r) });
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const desc = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  const c = desc.view.children[0];
  assert.deepEqual([c.node, c.generation, c.admitted, c.grant, c.refusedLimit], ['R/M3', 2, false, 0, 'maxRuns']); assert.match(c.notAdmittedReason, /run limit/);
});

test('a child a stop put in question is SHOWN as not admitted (stale), with no grant and no share, and the approval binds exactly that (describeFrontier)', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'obligation', affected: [{ node: 'R/M3', generation: 1 }] });
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  const by = Object.fromEntries(d.view.children.map(c => [c.node, c]));
  assert.deepEqual([by['R/M3'].admitted, by['R/M3'].grant], [false, 0]); assert.match(by['R/M3'].notAdmittedReason, /not admitted: stale \(stop e\d+ put it in question\)/);
  assert.equal(by['R/M1'].admitted, true); assert.equal(by['R/M2'].admitted, true);
  const total = d.view.children.filter(c => c.admitted).reduce((a, c) => a + c.grant, 0);
  assert.ok(total > 0 && by['R/M1'].grant + by['R/M2'].grant === total, 'the money is shared among the two children that can start');
  const changed = JSON.stringify(d.preview.children.find(c => c.node === 'R/M3'));
  assert.match(changed, /"admitted":false/);
});

test('the TABLE: node_registered of a superseded generation, and under a frontier proposed by a REPLACED parent generation, is refused; the replacement itself and a fresh child of the new parent generation are not', () => {
  const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } });
  const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: fk, revision: 1 }];
  const closed = (id, n, g) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status: null, share: 'released' });
  const events = [
    { id: 'e1', event: 'tree_started', treeId: 't' },
    { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, { id: 'e2b', event: 'node_started', node: 'R', generation: 1, runId: 't', pid: 1, host: 'h' }, closed('e2c', 'R', 1),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'),
    { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, { id: 'e4b', event: 'node_started', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', pid: 1, host: 'h' }, closed('e4c', 'R/M1', 1),
    ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e5'),
    { id: 'e6', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'status', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] },
    { id: 'e7', event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], form: 'regenerate', stopId: 'e6', gateId: 'g', shownSha256: '0'.repeat(64) },
    { id: 'e8', event: 'generation_opened', decisionId: 'e7', nodes: [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }] },
    ...front('kC', 'R', 1, [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }], 'e9'),
  ];
  const refusal = ev => transitionRefusal(foldRecord(events), { id: 'e99', ...ev })?.reason ?? null;
  assert.match(refusal(run('R/M2', 1, 'R', 'kA')), /R\/M2@g1 is superseded: a newer generation of R\/M2 is registered or opened/, 'the never-registered R/M2 of the OLD frontier');
  assert.match(refusal(run('R/M1/M1', 1, 'R/M1', 'kB')), /superseded|belongs to a frontier of R\/M1@g1, which was replaced/, 'a child under the replaced parent');
  assert.equal(refusal(run('R/M1', 2, 'R', 'kC')), null, 'the replacement itself');
  const withG2 = [...events, { id: 'e10', ...run('R/M1', 2, 'R', 'kC') }, { id: 'e10b', event: 'node_started', node: 'R/M1', generation: 2, runId: 'run-R-M1-2', pid: 1, host: 'h' }, closed('e10c', 'R/M1', 2), ...front('kD', 'R/M1', 2, [{ node: 'R/M1/M2', generation: 2 }], 'e11')];
  const r2 = ev => transitionRefusal(foldRecord(withG2), { id: 'e99', ...ev })?.reason ?? null;
  assert.match(r2(run('R/M1/M1', 1, 'R/M1', 'kB')), /belongs to a frontier of R\/M1@g1, which was replaced/, 'the old child, now that g2 is registered too');
  assert.equal(r2(run('R/M1/M2', 2, 'R/M1', 'kD')), null, 'a fresh child of the new parent generation');
});

test('the CHOOSER is the first line of defence, the table the second (mutations J5, J6, J19): a decision that does not mark the old children stale, with a hand-opened replacement of R/M2, still registers nothing from the dead frontier of R/M1@g1 or from R/M2@g1, never ends `refused`, writes no blocked record; and an UNAPPROVED frontier of a replaced parent is never offered for approval', { timeout: 600_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = a => draftStarter(r, { 'R/M1': 'plan-a.md' })(a);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });                     // R/M1 and R/M3 closed; R/M1's own frontier is NOT approved yet
  assert.deepEqual([first.approvalWaits, first.replacementWaits], [true, false], 'a first split waits for an approval, and it is NOT a replacement (mutation J21)');
  const pendingBefore = findPendingFrontier({ rootDir: r.t.rootDir }); assert.equal(pendingBefore.parent.node, 'R/M1', 'R/M1@g1\'s own split waits for approval');
  approvePending(r);                                                                                 // now it IS approved (its children stay unregistered)
  const { state } = view(r);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: [{ node: 'R/M1', generation: 1 }] });
  // CHANGED (oversize unit, C&C thcmcp-cd 23 Okt 2026: a sub-plan regenerate whose new input is over the allowance is refused AT DECIDE; same accepted change as tree-replace.test.js:64). OLD: decided with no flag. NEW: `fresh: true`. WHY: the earlier plan is offered as data by default (a5d818f) and this fixture's approvals are priced for 4000 bytes: with the earlier plan the new input is about 5,646 bytes, so `decide` now refuses (exit 1, before any prompt) where it used to record and fail only at registration; this row is about the chooser, not the size (both decisions of this test: here and r2 below).
  const d = decide(r, { fresh: true }, [`${DECISION}\n.`, stop.id, 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const dec = eventsOf(r).find(e => e.event === 'decision_recorded');
  appendTreeEvent(r.t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }] });     // R/M2@g1 is superseded but NOT stale
  assert.equal(view(r).state.stale.has('R/M2@g1'), false); assert.equal(view(r).state.stale.has('R/M1/M1@g1'), false);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.notEqual(out.status, 'refused', JSON.stringify(out)); assert.equal(eventsOf(r).some(e => e.event === 'blocked'), false, 'nothing was even attempted');
  assert.deepEqual(Object.keys(phases(r)).filter(k => k.startsWith('R/M1/') || k === 'R/M2'), [], 'neither the dead frontier\'s children nor R/M2@g1 registered');
  assert.equal((out.held ?? []).some(h => h.node === 'R/M2'), false, 'R/M2@g1 is not even listed as waiting: it is superseded');
  // an UNAPPROVED frontier of a replaced parent is not offered: the replacement of R is
  const r2 = await trackedRealRoot(splitChildren());
  approvePending(r2);
  writeFileSync(join(r2.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start2 = a => draftStarter(r2, { 'R/M1': 'plan-a.md' })(a);
  await runTree(r2.t.rootDir, { work: r2.t.work, startRun: start2 });
  const st2 = view(r2).state;
  const stop2 = appendTreeEvent(r2.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: st2.nodes.get('R/M1@g1').runId, source: 'status', affected: [{ node: 'R/M1', generation: 1 }] });
  // `fresh: true`: as for `d` above (the comment is on its own line: a trailing one swallowed the assertion in the first version of this edit)
  const d2 = decide(r2, { fresh: true }, [`${DECISION}\n.`, stop2.id, 'y']); assert.equal(await d2.run(), 0, d2.io.shown() + d2.io.errors());
  await runTree(r2.t.rootDir, { work: r2.t.work, maxStarts: 0, startRun: start2 });
  const offered = findPendingFrontier({ rootDir: r2.t.rootDir });
  assert.deepEqual([offered.parent.node, offered.children], ['R', [{ node: 'R/M1', generation: 2 }]], 'the replacement frontier of R, not the old split of R/M1@g1');
});

test('the SHARE SPLIT reserves nothing for a child that is stale (it will not register): money drops after the approval (here: spend in the root run folder), a stale R/M2 is not counted, so R/M1 still gets the grant the approval showed (mutation J10)', { timeout: 300_000 }, async () => {
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); this test passed on fad02049 and typed the same class of figure). OLD: 13.5 + the root's handoff typed (an equal third of 13.5 = 4.5 over the cheapest end 4.119 and under the at-most 4.919) and 11.5 after a 2.00 reservation. NEW: the third SHARE is half way between priced-debate's own cheapest end and at-most figure, the pool is three of them, and the figure after the reservation is the pool less 2.00. WHY: the figures move with every recorded or reworded sentence in src/roles.js.
  const SHARE = ceilCents((pricedDebateFigures().cheapestUsd + pricedDebateFigures().atMostUsd) / 2); const POOL = Math.round(3 * SHARE * 100) / 100;      // available to share, after the root's own handoff
  const r = await trackedRealRoot({ ...pricedChildren(), cap: POOL + SPLIT_ROOT_HANDOFF_USD });
  const d = approvePending(r);
  const shown = d.view.children.find(c => c.node === 'R/M1').grant;                                  // an equal third of 10
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'obligation', affected: [{ node: 'R/M2', generation: 1 }] });
  writeLines(r.t, ROOT_ID, 'R', [reservedLine('rx', 2.0, 'extra')]);                                    // an unsettled reservation of the root run: charged at its worst case, 2.00 less to share
  assert.ok(Math.abs(budgetOf(r.t.rootDir).availableUsd - (POOL - 2)) < 1e-6, `the money dropped to ${POOL - 2} after the approval`);   // CHANGED ACCEPTED (20 Okt 2026; named by the line history: 1e81a99 (estimator unit commit 2, ruling B-narrow) moved this test's cap from 10 to 13.5 and left this line; a bisect with this test fixed is degenerate, it fails at 0c57c97 too because the fixed test carries both the new cap and the old 8): OLD 8 (= 10 available - 2.00 reserved); NEW 11.5 (= 13.5 - 2.00). WHY: arithmetic of the cap that commit set; no code moved.
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.node], ['registered', 'R/M1']);
  assert.ok(Math.abs(reg.grantUsd - shown) < 1e-9, `R/M1 gets the ${shown} the approval showed (11.5 shared by R/M1 and R/M3 is 5.75, above it); counting the stale R/M2 would cut it to 11.5/3 = 3.83, below it`);
});

test('the ORPHAN is never an eligible provider: providerEligibility refuses the dead path ("not registered yet") while the live path under the replacement is judged on its own; a node that expects from the orphan is itself an orphan and is never chosen', { timeout: 900_000 }, async () => {
  const { r, start } = await tree({ register: true });
  await regenerate(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });                    // R/M1@g2 runs and closes
  const v = view(r);
  assert.ok(orphansOf(v.state).has('R/M1/M1@g1'));
  const e = providerEligibility({ ...v, work: r.t.work }, 'R/M1/M1');
  // M6 S0 (a): the path HAS a registration (generation 1) and it is dead with the replaced R/M1; "not registered yet" would say it is only a matter of time, so the reason names the cause. R/M1 is generation 2 here.
  assert.deepEqual([e.eligible, e.why], [false, ['R/M1/M1 is not registered: every registration of it (generation 1) belonged to a plan that R/M1@g2 replaced and is dead with it; it is registered again only if the new plan names it and its frontier is approved']], 'the orphan path is refused outright, with its cause');
  // the control: a path with no node at all is still only "not registered yet" (the new branch must not swallow the true case); and a path the orphan's name merely starts with is not the orphan
  assert.deepEqual(providerEligibility({ ...v, work: r.t.work }, 'R/M1/M9').why, ['R/M1/M9 is not registered yet']);
  assert.deepEqual(providerEligibility({ ...v, work: r.t.work }, 'R/M1/M').why, ['R/M1/M is not registered yet']);
  const live = providerEligibility({ ...v, work: r.t.work }, 'R/M1');
  assert.equal(live.eligible, false); assert.ok(live.why.every(w => !/R\/M1\/M1/.test(w)), 'R/M1@g2 waits for its NEW children, never for the orphan');
});
