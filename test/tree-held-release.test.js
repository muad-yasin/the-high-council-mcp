// 0.8.3 M6 T1-7 (audit S10-1; C&C ruling 13 Oct 2026: option b): the release of the held nodes (exit X2, src/tree-loop.js releaseHeldIfNoChildren) must never be decided by a plan that does not READ. The trace at f3ac63a on REAL sittings: with the
// new root plan's report.json removed, or its deliverable.md edited after the close, a real sitting writes NO held_released - its afterStep opens a blocked stop on the root first and the release returns early. Production is protected by that order;
// these PINS keep it (no red needed: regression guards), and the DIRECT-CALL tests (commit 2) make the same safety explicit at the line. Real flow: trackedRealRoot, the real decide and approve verbs, the REAL starter (all-mock chain), $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as api from '../src/api.js';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { runTree } from '../src/tree-run.js';
import { deadKeys, heldKeys, keptKeys } from '../src/tree-transitions.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { block3, planWith } from './helpers/split-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };
// a real root, R/M1 finished and passed, the root stop answered by a re-plan, the new root plan approved and REALLY run (one sitting, one start): R@g2 is closed PASSED and R/M1 is HELD
async function heldBelowFinishedRoot() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  let t = io(['Plan it again, offline store first.\n.', stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0);
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  t = io([pending.key.slice(0, 8), 'y']);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0);
  const s1 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1 });
  assert.equal(s1.status, 'limit_reached', JSON.stringify(s1));
  const g2 = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g2');
  assert.deepEqual([g2.phase, g2.outcome], ['closed', 'passed']);
  assert.deepEqual([...heldKeys(stateOf(readTreeRecord(r.t.rootDir)))], ['R/M1@g1'], 'held while the new root plan stands');
  return { r, runDir: join(r.t.runsDir, g2.runId) };
}
// each damage returns its UNDO (the exit that keeps the held nodes: put the file back)
const damage = {
  'report.json removed': runDir => { renameSync(join(runDir, 'report.json'), join(runDir, 'report.json.gone')); return () => renameSync(join(runDir, 'report.json.gone'), join(runDir, 'report.json')); },
  'deliverable.md edited after the close': runDir => { const original = readFileSync(join(runDir, 'deliverable.md'), 'utf8'); writeFileSync(join(runDir, 'deliverable.md'), `${original}\nEdited after the panel signed it.\n`); return () => writeFileSync(join(runDir, 'deliverable.md'), original); },
};
const events = r => readTreeRecord(r.t.rootDir).events;

test('PIN, control: a real sitting after the new root plan closed PASSED with a plan that READS and holds no split block releases the held nodes (no_split), once', async () => {
  const { r } = await heldBelowFinishedRoot();
  const s2 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3 });
  assert.equal(s2.status, 'nothing_to_do', JSON.stringify(s2));
  const released = events(r).filter(e => e.event === 'held_released');
  assert.equal(released.length, 1); assert.deepEqual([released[0].reason, released[0].nodes], ['no_split', ['R/M1@g1']]);
  // EDITED 18 Okt 2026 (C2a-record K2). OLD: assert.equal(heldKeys(...).size, 0) - the release emptied the held set. NEW: the node stays held and is PASSED OVER (kept); the release only annotates. WHY: release is not death (Muad 12 Oct 21:25).
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual([...heldKeys(st)], ['R/M1@g1']); assert.deepEqual([...keptKeys(st)], ['R/M1@g1']); assert.equal(deadKeys(st).has('R/M1@g1'), false);
  // NEW (K2 repeat guard): the node is still held after the release, so the writer must not write the same release again at every later sitting
  const s3 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3 });
  assert.equal(s3.status, 'nothing_to_do', JSON.stringify(s3));
  assert.equal(events(r).filter(e => e.event === 'held_released').length, 1, 'a later sitting writes no second held_released for a node that is already passed over');
});

for (const [name, hurt] of Object.entries(damage)) {
  test(`PIN, a REAL sitting after the new root plan's ${name}: nothing is released (held stays), the sitting's afterStep opened the blocked stop on the root first (held_by_stop) - the order that protects production`, async () => {
    const { r, runDir } = await heldBelowFinishedRoot();
    hurt(runDir);
    const s2 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3 });
    assert.equal(s2.status, 'held_by_stop', JSON.stringify(s2));
    const state = stateOf(readTreeRecord(r.t.rootDir));
    assert.equal(events(r).filter(e => e.event === 'held_released').length, 0, 'no held_released');
    assert.deepEqual([...heldKeys(state)], ['R/M1@g1']);
    assert.deepEqual(state.openStops.map(id => [state.stopMeta.get(id).source, state.stopMeta.get(id).node]), [['blocked', 'R']], 'the blocked stop on the root is open');
  });
}

// ---- commit 2: DIRECT CALLS (registerNextChild without the sitting's afterStep): the safety is explicit at the line. Production was already protected by afterStep's order; these make the rule independent of it.
import { registerNextChild } from '../src/tree-loop.js';

const planRecords = r => events(r).filter(e => e.event === 'blocked' && e.check === 'plan_unreadable');
for (const [name, hurt] of Object.entries(damage)) {
  test(`registerNextChild CALLED DIRECTLY on a plan whose ${name} releases NOTHING and writes ONE blocked record (red at the base: it releases no_split); a second call writes no second record; putting the file back lets the next call release (no_split)`, async () => {
    const { r, runDir } = await heldBelowFinishedRoot();
    const undo = hurt(runDir);
    registerNextChild(r.t.rootDir, { work: r.t.work });
    assert.equal(events(r).filter(e => e.event === 'held_released').length, 0, 'nothing released');
    assert.deepEqual([...heldKeys(stateOf(readTreeRecord(r.t.rootDir)))], ['R/M1@g1'], 'still held');
    const rec = planRecords(r); assert.equal(rec.length, 1, 'ONE record');
    assert.deepEqual([rec[0].reason, rec[0].transition, rec[0].scope, rec[0].check], ['expansion_refused', 'held_release', 'R@g2', 'plan_unreadable']);
    assert.match(rec[0].detail, /^the plan of R@g2 \(run \S+: its report\.json and deliverable\.md\) does not read as the text its panel signed, so the nodes held below it stay held and nothing was released$/);
    registerNextChild(r.t.rootDir, { work: r.t.work });
    assert.equal(planRecords(r).length, 1, 'a second call writes no second record'); assert.equal(events(r).filter(e => e.event === 'held_released').length, 0);
    undo();
    registerNextChild(r.t.rootDir, { work: r.t.work });
    const released = events(r).filter(e => e.event === 'held_released');
    assert.deepEqual(released.map(e => [e.reason, e.nodes]), [['no_split', ['R/M1@g1']]], 'the plan reads again: the normal release');
  });
}

test('a verified split that names NO children releases the held nodes even if the plan\'s file later breaks: the record is consulted BEFORE the file (hand-written split_verified; at the base the same tree releases too, but as no_split: only the reason label is red)', async () => {
  const { r, runDir } = await heldBelowFinishedRoot();
  const g2 = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g2');
  appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 2, runId: g2.runId, splitSha256: 's'.repeat(64), children: [] });
  damage['report.json removed'](runDir);
  registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(events(r).filter(e => e.event === 'held_released').map(e => [e.reason, e.nodes]), [['no_children', ['R/M1@g1']]]);
  assert.equal(planRecords(r).length, 0, 'and no unreadable-plan record: the record already knew');
});

// ---- X4 fix-up (13 Oct 2026): a node held from R@g1 survives a SECOND root re-plan, so the approve screen of the new root plan must name the plan the held node hangs under (it used to say "held below the earlier plan" right after "The earlier plan R@g2 ... set aside")
test('the approve screen of a SECOND root re-plan names the root plan the held node hangs under (R@g1), not the plan being replaced (R@g2); the first re-plan\'s sentence is unchanged (tree-root-frontier.test.js)', async () => {
  const { r, runDir } = await heldBelowFinishedRoot(); damage['report.json removed'](runDir);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3 });
  const stopId = stateOf(readTreeRecord(r.t.rootDir)).openStops[0];
  let t = io(['Plan the root again; keep what is finished.\n.', stopId, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stopId, fresh: true }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0);
  // CHANGED ACCEPTED (bundle unit, 20 Okt 2026). OLD: the second root re-plan was decided with no flag. NEW: `fresh: true`. WHY: a root re-plan now reads the earlier plan as data by default and REFUSES (fails closed, exit 1: "the earlier plan cannot be read ... run the command again with --fresh") when it cannot; this test damages the earlier plan's report.json on purpose to reach the held-node screen, and its subject is the screen's wording, not the old plan.
  assert.deepEqual([...heldKeys(stateOf(readTreeRecord(r.t.rootDir)))], ['R/M1@g1'], 'held across the second re-plan');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  t = io([pending.key.slice(0, 8), 'y']);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  assert.match(t.shown(), /The earlier plan R@g2 and nothing else are set aside and stay counted\./);
  assert.match(t.shown(), /1 finished node is held below the earlier root plan R@g1 \(not below R@g2, the plan being replaced\); they stay held until you approve the new root plan's children \(checking them for reuse comes in a later step\)\./);
});

// X1, a REAL walk (C2a-record K2; the test.todo of tree-whole-mock.test.js "X1: approving a signed new root plan's children frontier releases the held nodes (they die, none adopted yet)", turned real and flipped): the person re-plans the root, the new root plan R@g2 closes PASSED WITH a verified split,
// and the person approves its CHILDREN frontier (the first approval of a later root generation's children): the held node is PASSED OVER (kept), not dead, and no later sitting writes a release for it. OLD behaviour (todo title): "they die". NEW: kept, offerable to a later frontier.
test('X1 (K2) REAL: the person approves the new root plan\'s children frontier (R@g2 closed passed WITH a split): the held R/M1@g1 is passed over (kept), not dead, and the sitting writes no held_released', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  let t = io(['Plan it again, offline store first.\n.', stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0);
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  t = io([pending.key.slice(0, 8), 'y']);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0);
  // EDITED 18 Okt 2026 (C2b-2, the adoption writer). OLD: planWith(block3(), ...) - the new plan carried K1 unchanged. NEW: K1's scope differs. WHY: with the writer an UNCHANGED finished child is ADOPTED at this approval (that is the feature; test/tree-adoption-walk.test.js walks it), which would end the kept state this test is about.
  // The changed scope keeps the K2 case real: a candidate the new plan does not use is passed over (kept) and offered later. The pin below says nothing was adopted, so the test does not depend on the content compare happening to differ.
  const changedBlock = block3(); changedBlock.children.find(c => c.id === 'K1').scope = 'Choose and build the record store, offline first.';
  writeFileSync(join(r.t.work, 'plan-r2.md'), planWith(changedBlock, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const kids = draftStarter(r);       // R@g2 is a ROOT plan: its bundle has a task and a node file, no criteria or context; it is handed a plan WITH a split block as its draft
  const rootPlan = ({ chain, bundleDir, runId, grantUsd }) => api.run({ chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}), ...(existsSync(join(bundleDir, 'context.md')) ? { context: join(bundleDir, 'context.md') } : {}), runId, treeNode: join(bundleDir, 'node.json'), cwd: r.t.work, maxUsd: grantUsd, draft: 'plan-r2.md', rounds: 1 });
  const s1 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: opts => (opts.node === 'R' ? rootPlan(opts) : kids(opts)) });
  assert.equal(s1.status, 'limit_reached', JSON.stringify(s1));
  let st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual([st.nodes.get('R@g2').phase, st.nodes.get('R@g2').outcome], ['closed', 'passed']);
  assert.deepEqual([...heldKeys(st)], ['R/M1@g1'], 'held while the new root plan\'s children wait for approval'); assert.equal(keptKeys(st).size, 0, 'nothing is passed over yet');
  approvePending(r);                                                                      // the first approval of R@g2's CHILDREN frontier: X1
  st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual([...heldKeys(st)], ['R/M1@g1']); assert.deepEqual([...keptKeys(st)], ['R/M1@g1'], 'X1 passed it over'); assert.equal(deadKeys(st).has('R/M1@g1'), false, 'and it is not dead');
  assert.equal(st.adopted.size, 0, 'nothing was adopted (pin, C2b-2): the changed scope is why it is kept'); assert.equal(readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'frontier_previewed').at(-1).children.some(c => c.reused), false, 'and the approved preview carries no reused entry');
  assert.equal(events(r).filter(e => e.event === 'held_released').length, 0, 'X1 writes no release event');
});
