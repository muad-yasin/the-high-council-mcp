// ONE generation rule (0.8.3 M5 API reviews R13, Astra F4; the helper merge of M6 rulings row 68). A stop marks the nodes it puts in question at the generation they will REGISTER at, and the frontier proposes
// exactly that generation: for a node that is not registered yet under a replaced parent the two used to disagree (stale marks at g1, the frontier at g2), so the scheduler could start a g2 child under its
// parent's open stop. Real depth-2 trees, all-mock, $0 (the fixtures of test/tree-replace.test.js). Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { affectedFor } from '../src/tree-affected.js';
import { planRecovery } from '../src/tree-recovery.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const view = r => { const record = readTreeRecord(r.t.rootDir); return { record, state: stateOf(record), runsDir: r.t.runsDir }; };
const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 6000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
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

/**
 * The L8 tree: R/M1 splits (plan-a), `register` runs the old children too; R/M1 is then REGENERATED (plan-b drops M1), the replacement frontier is approved and R/M1@g2 runs and closes: its own frontier (R/M1/M2, R/M1/M3
 * at g2, nobody registered them yet) is the one pending. -> { r, start, g2 } with g2 the run of R/M1@g2.
 */
async function replacedAndClosed({ register }) {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  writeFileSync(join(r.t.work, 'plan-b.md'), planWith(droppedBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = a => draftStarter(r, { 'R/M1': a.generation >= 2 ? 'plan-b.md' : 'plan-a.md' })(a);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);                                                                                 // R/M1@g1's own frontier
  if (register) await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const { state } = view(r);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ ...view(r), node: 'R/M1' }).affected });
  // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026; the same change as test/tree-replace.test.js:64). OLD: the regenerate was decided with no flag. NEW: `fresh: true`. WHY: since a5d818f (19 Okt: a regenerate offers the set-aside plan to the new plan's writer as DATA by default; FOCUS-detail 19 Okt 17:22) the new R/M1@g2 input is over this fixture's 4000-byte allowance, registration opens a bundle_input stop and registers nothing, and `get('R/M1@g2').runId` below threw. The test is about generations and the stop, not the earlier-plan route. Proof: box set f4f6cdf9 (this one-line change, 4/4 green).
  const d = decide(r, { fresh: true }, ['Replace it.\n.', stop.id, 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });                                  // opens the replacement frontier
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });                                  // R/M1@g2 runs and closes
  return { r, start, g2: view(r).state.nodes.get('R/M1@g2').runId };
}
const keyOf = n => `${n.node}@g${n.generation}`;

for (const register of [false, true]) {
  test(`R13 (Astra F4), ${register ? 'the old children were registered and are dead' : 'the old children were never registered'}: a stop of the replacement R/M1@g2 marks its not-yet-registered descendants at the generation the NEXT PREVIEW proposes for them, and the scheduler holds them (no g2 child starts under the parent's open stop)`, { timeout: 900_000 }, async () => {
    const { r, start, g2 } = await replacedAndClosed({ register });
    const pending = findPendingFrontier({ rootDir: r.t.rootDir });
    assert.equal(pending.parent.node, 'R/M1'); assert.equal(pending.parent.generation, 2);
    const preview = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending }).view.children.map(c => [c.node, c.generation]);
    assert.deepEqual(preview, [['R/M1/M2', 2], ['R/M1/M3', 2]], 'the frontier proposes the new children at g2');
    // the invariant: what a stop marks for a path that is not registered yet is the generation the frontier will register it at
    const { affected } = affectedFor({ ...view(r), node: 'R/M1' });
    for (const [node, generation] of preview) assert.equal(affected.find(a => a.node === node)?.generation, generation, `${node} is marked at the generation the preview proposes`);
    // the sequence: the stop is open, the frontier is approved, the sitting resumes
    appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 2, runId: g2, source: 'status', affected });
    const st = view(r).state;
    for (const [node, generation] of preview) assert.equal(st.stale.has(keyOf({ node, generation })), true, `${node}@g${generation} is stale`);
    approvePending(r);
    const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
    const registered = eventsOf(r).filter(e => e.event === 'node_registered').map(keyOf);
    assert.deepEqual(registered.filter(k => k.startsWith('R/M1/M') && k.endsWith('@g2')), [], 'no g2 child was registered under the open stop');
    assert.equal(out.status, 'held_by_stop', JSON.stringify(out)); assert.ok(out.stopIds.length > 0, 'the sitting ends held by the open stop, not as finished');
  });
}

test('R13, opened but not registered: a node a decision OPENED at g2 whose replacement is not registered yet is marked at g2 (not at g1) by a later stop that reaches it', { timeout: 900_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = a => draftStarter(r, { 'R/M1': 'plan-a.md' })(a);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  const { state } = view(r);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ ...view(r), node: 'R/M1' }).affected });
  // CHANGED (oversize unit, C&C thcmcp-cd 23 Okt 2026: a sub-plan regenerate whose new input is over the allowance is refused AT DECIDE; same accepted change as tree-replace.test.js:64). OLD: decided with no flag. NEW: `fresh: true`. WHY: the earlier plan is offered as data by default (a5d818f) and this fixture's approvals are priced for 4000 bytes: with the earlier plan the new input is about 5,646 bytes, so `decide` now refuses (exit 1, before any prompt) where it used to record and fail only at registration; this row is about the generation rule, not the size.
  const d = decide(r, { fresh: true }, ['Replace it.\n.', stop.id, 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });                                  // generation_opened: R/M1@g2 and the never-registered consumer R/M2@g2, nothing registered yet
  const v = view(r);
  assert.equal(v.state.maxOpened.get('R/M2'), 2, 'the fixture: R/M2 is opened at g2'); assert.equal(v.state.nodes.has('R/M2@g2'), false, 'and not registered');
  const aff = affectedFor({ ...v, node: 'R/M1' }).affected;
  assert.equal(aff.find(a => a.node === 'R/M2')?.generation, 2, 'R/M2 is marked at the generation it was opened at');
});

test('R13 and recovery: a node a decision OPENED at g2 and nobody registered, replaced again by a later decision that reached it at g2, is opened at g3 (recovery opens one above the generation the decision marked); before the rule it was marked at g1 and "opened" at g2 again', () => {
  const line = (id, e) => ({ schema: 'tree-events/1', id, at: '2026-10-11T12:00:00.000Z', ...e });
  const events = [
    line('e1', { event: 'tree_started', treeId: 't' }),
    line('e2', { event: 'node_registered', node: 'R', generation: 1, runId: 't', attempt: 1, depth: 0, parentNode: null, frontierKey: null, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } }),
    line('e3', { event: 'node_started', node: 'R', generation: 1, runId: 't', pid: 1, host: 'h' }),
    line('e4', { event: 'node_closed', node: 'R', generation: 1, runId: 't', outcome: 'passed', passed: true, status: null, share: 'released' }),
    line('e5', { event: 'generation_opened', decisionId: 'e0', nodes: [{ node: 'R/M2', generation: 2 }] }),                       // an earlier decision opened R/M2@g2; nobody registered it
    line('e6', { event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'status', affected: [{ node: 'R/M2', generation: 2 }] }),
    line('e7', { event: 'decision_recorded', text: 'again', affected: [{ node: 'R/M2', generation: 2 }], form: 'regenerate', stopId: 'e6', gateId: 'g', shownSha256: '0'.repeat(64) }),
  ];
  const plan = planRecovery({ events, corrupt: [], tree: { treeId: 't' }, treeSha256: 'x' }, { runFactsOf: () => ({ hasRunJson: false, runDir: '/nonexistent', end: null, paused: false }) });
  const opening = plan.find(a => a.action === 'append' && a.event.event === 'generation_opened');
  assert.deepEqual(opening?.event.nodes, [{ node: 'R/M2', generation: 3 }]);
});
