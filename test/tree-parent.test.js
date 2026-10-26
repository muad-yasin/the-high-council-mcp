// `blocked: parent_changed` and the sitting lock (0.8.3 M5c4; PLAN 12 row 3, 8.2; M5-DEFAULTS 23, gap 1; M5 exit check L10). Fold units on synthetic records, then the real path: a parent's file edited after the approval and
// after a child was registered, the start refused (exit 19, no provider call), the file restored and the start STILL refused, the frontier approved again through the real `tree approve`, the start going through.
// Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunLockedError, acquireRunLock } from '../src/run-lock.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { approvalValid, eventShapeError, foldRecord } from '../src/tree-transitions.js';
import { parentChangedEvent } from '../src/tree-continuation.js';
import { approveHandler } from '../src/tree-approve.js';
import { prefixOf } from '../src/tree-stop.js';
import { registerNextChild } from '../src/tree-loop.js';
import { SITTING_LOCK_FILE, apiStarter, runTree } from '../src/tree-run.js';
import { resumeHandler } from '../src/tree-resume.js';
import { LEAF_PLAN } from './helpers/sitting.js';
import { trackedRealRoot, track } from './helpers/temp-trees.js';
import { externalChildren, pricedChildren, splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { APPROVAL_FIELDS, FIXTURE_BOUND, GATE_FIELDS, IDS, ROOT_ID, approveFrontier, closedRootTree, registerKid } from './helpers/tree-fixture.js';

const stateOfTree = rootDir => stateOf(readTreeRecord(rootDir));
const blockOf = (rootDir, key, extra = {}) => appendTreeEvent(rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'R/M1@g1', frontierKey: key, check: 'ancestor', detail: 'test', ...extra });
const usageFiles = dir => { try { return readdirSync(dir).filter(f => f.endsWith('.usage.json')); } catch { return []; } };

test('the fold: a parent_changed names the frontier it invalidates: the tree is blocked (sticky parent_changed), THAT approval is invalid, THAT frontier\'s registered children are stale; the other frontier is untouched', () => {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); const k2 = approveFrontier(t.rootDir, ['R/M3']);
  registerKid(t, k1, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', node: 'R/M1', generation: 1, runId: IDS[0], pid: process.pid, host: (process.env.HOSTNAME || 'localhost') });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: null, share: 'released' });
  blockOf(t.rootDir, k1);
  const st = stateOfTree(t.rootDir);
  assert.equal(st.sticky.has('parent_changed'), true); assert.deepEqual([...st.parentBlocks.keys()], [k1]);
  assert.equal(approvalValid(st.frontiers.get(k1)), false, 'the approval it names is invalid'); assert.equal(approvalValid(st.frontiers.get(k2)), true, 'the other frontier is untouched');
  assert.equal(st.stale.has('R/M1@g1'), true, 'the registered child of that frontier is stale');
});

test('clearing: only a frontier_approved written AFTER the block, for THAT key, lifts it (and its stale marks); an approval of another key clears nothing; two blocks need two approvals', () => {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); const k2 = approveFrontier(t.rootDir, ['R/M3']);
  registerKid(t, k1, 'R/M1', IDS[0], 10);
  blockOf(t.rootDir, k1); blockOf(t.rootDir, k2, { scope: 'R/M3@g1' });
  const approve = (key, rev) => appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: key, revision: rev });
  approve(k2, 2);
  let st = stateOfTree(t.rootDir);
  assert.deepEqual([...st.parentBlocks.keys()], [k1], 'the approval of k2 cleared k2 only'); assert.equal(st.sticky.has('parent_changed'), true, 'k1 still blocks the tree'); assert.equal(st.stale.has('R/M1@g1'), true);
  approve(k1, 2);
  st = stateOfTree(t.rootDir);
  assert.equal(st.parentBlocks.size, 0); assert.equal(st.sticky.has('parent_changed'), false); assert.equal(st.stale.has('R/M1@g1'), false); assert.equal(approvalValid(st.frontiers.get(k1)), true);
  // an approval written BEFORE a block clears nothing of it
  blockOf(t.rootDir, k1);
  assert.equal(stateOfTree(t.rootDir).sticky.has('parent_changed'), true, 'the earlier approval does not count');
});

test('R1: closing the last REGISTERED child lifts the block (the tree is not stuck) but the approval stays void while a child the preview offered is still unregistered; when EVERY child of the frontier is registered and closed there is nothing left to approve, so it stands', () => {
  const t = closedRootTree(); track(t.work);
  const open = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); const whole = approveFrontier(t.rootDir, ['R/M3']);
  const run = (node, id) => { registerKid(t, node === 'R/M3' ? whole : open, node, id, 10); appendTreeEvent(t.rootDir, { event: 'node_started', node, generation: 1, runId: id, pid: process.pid, host: (process.env.HOSTNAME || 'localhost') }); };
  const close = (node, id) => appendTreeEvent(t.rootDir, { event: 'node_closed', node, generation: 1, runId: id, outcome: 'passed', passed: true, status: null, share: 'released' });
  run('R/M1', IDS[0]); blockOf(t.rootDir, open); close('R/M1', IDS[0]);                                   // one node at a time: the first frontier's block is lifted by its close before the second frontier's child registers
  run('R/M3', IDS[1]); blockOf(t.rootDir, whole, { scope: 'R/M3@g1' }); close('R/M3', IDS[1]);
  const st = stateOfTree(t.rootDir);
  assert.equal(st.sticky.has('parent_changed'), false, 'both blocks lifted: every registered child of each frontier is closed');
  assert.equal(approvalValid(st.frontiers.get(open)), false, 'R/M2 was offered by the preview and never registered: the old approval does not revive for it');
  assert.equal(approvalValid(st.frontiers.get(whole)), true, 'R/M3 was the only child and it ran: nothing is left that the approval could start');
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: open, revision: 2 });
  assert.equal(approvalValid(stateOfTree(t.rootDir).frontiers.get(open)), true, 'a frontier_approved written after the block makes it valid');
});

test('R3: the table refuses a frontier_approved without the gate whose approval it spends (gateId and shownSha256, each alone is not enough), and accepts one that carries both', () => {
  const t = closedRootTree(); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  const base = { event: 'frontier_approved', frontierKey: key, revision: 2 };
  for (const extra of [{}, { gateId: 'g-1' }, { shownSha256: '0'.repeat(64) }]) {
    assert.throws(() => appendTreeEvent(t.rootDir, { ...base, ...extra }), e => e instanceof TreeRefusal && /gateId, shownSha256/.test(e.message), JSON.stringify(extra));
  }
  assert.throws(() => appendTreeEvent(t.rootDir, { ...base, gateId: 'g-1', shownSha256: '0'.repeat(64) }), e => e instanceof TreeRefusal && /records who gave it/.test(e.message), 'K10: with both gate fields but no who answered it is still refused');
  assert.equal(appendTreeEvent(t.rootDir, { ...base, gateId: 'g-1', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' }).event, 'frontier_approved');       // K10 (EDITED; OLD: gateId + shownSha256 were enough; NEW: and who answered; WHY: the table requires it)
});

test('R3 (the R1 edge): a frontier with NO recorded child never has its approval revived by a close - the fold fails closed (a record with no preview children is only reachable by hand, the table refuses to build it)', () => {
  const K = 'k'.repeat(64);
  const line = (id, e) => ({ schema: 'tree-events/1', id, at: '2026-10-11T12:00:00.000Z', ...e });
  const events = [
    line('e1', { event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: K, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: 'a'.repeat(64), children: [] }),
    line('e2', { event: 'frontier_approved', frontierKey: K, revision: 1, gateId: 'g', shownSha256: 'b'.repeat(64), boundSha256: FIXTURE_BOUND }),
    line('e3', { event: 'node_registered', node: 'R/M1', generation: 1, runId: IDS[0], attempt: 1, depth: 1, parentNode: 'R', frontierKey: K, grant: { amount: 1, unit: 'usd' } }),
    line('e4', { event: 'blocked', reason: 'parent_changed', scope: 'R/M1@g1', frontierKey: K, check: 'ancestor', detail: 'x' }),
    line('e5', { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: null, share: 'released' }),
  ];
  const st = foldRecord(events);
  assert.equal(st.sticky.has('parent_changed'), false, 'the block lifts');
  assert.equal(approvalValid(st.frontiers.get(K)), false, 'but the approval did not cover anything the close could prove started: it stays void');
});

test('a parent_changed with no frontierKey (the shape of the M1/M2 fixtures) stays sticky: no approval clears it; a record that carries a frontierKey for ANOTHER reason (held_changed) is no parent block', () => {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1']);
  appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'tree' });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: k1, revision: 2 });
  assert.equal(stateOfTree(t.rootDir).sticky.has('parent_changed'), true, 'nothing clears the tree-wide shape');
  const u = closedRootTree(); track(u.work);
  const k = approveFrontier(u.rootDir, ['R/M1']);
  appendTreeEvent(u.rootDir, { event: 'blocked', reason: 'expansion_refused', scope: 'R/M1@g1', transition: 'derivation', check: 'held_changed', detail: 'x', frontierKey: k });
  const st = stateOfTree(u.rootDir);
  assert.equal(st.parentBlocks.size, 0); assert.equal(st.sticky.size, 0); assert.equal(approvalValid(st.frontiers.get(k)), true, 'a held_changed record is keyed by its reason, not by its frontierKey');
});

test('the stale marks of a parent block are their own: a stop answered IN PLACE releases only the stop\'s marks, and a regenerate holds them; neither wipes the parent block\'s', () => {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, k1, 'R/M1', IDS[0], 10);
  blockOf(t.rootDir, k1);
  const events = readTreeRecord(t.rootDir).events;
  const stop = { id: 'e900', event: 'needs_decision_opened', node: 'R', generation: 1, source: 'integration', affected: [{ node: 'R', generation: 1 }] };
  const inPlace = foldRecord([...events, stop,
    { id: 'e901', event: 'decision_recorded', text: 'x', affected: [], form: 'milestone', stopId: 'e900', node: 'R', generation: 1, milestone: 'M5' },
    { id: 'e902', event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M5', decisionId: 'e901' }]);
  assert.equal(inPlace.stale.has('R@g1'), false, 'the stop\'s mark was released by the in-place answer');
  assert.equal(inPlace.stale.has('R/M1@g1'), true, 'the parent block\'s mark was not');
  const childStop = { ...stop, affected: [{ node: 'R/M2', generation: 1 }] };
  const regen = foldRecord([...events, childStop, { id: 'e901', event: 'decision_recorded', text: 'x', affected: [], form: 'regenerate', stopId: 'e900' }]);
  assert.equal(regen.stale.has('R/M2@g1'), true, 'a regenerate HOLDS the stop\'s mark (M5e S3)'); assert.equal(regen.stale.has('R/M1@g1'), true);
  const rootRegen = foldRecord([...events, stop, { id: 'e901', event: 'decision_recorded', text: 'x', affected: [], form: 'regenerate', stopId: 'e900' }]);
  assert.equal(rootRegen.stale.has('R@g1'), false, 'the ROOT is never regenerated, so a regenerate never HOLDS its mark (M5e S4)');
});

test('while a frontier is blocked its approval is the ONLY paid-free event that matters: frontier_previewed and frontier_approved are written (only starts, registrations and resumes are refused), and the approval lifts exactly that block', () => {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); const k2 = approveFrontier(t.rootDir, ['R/M3']);
  blockOf(t.rootDir, k1);
  assert.throws(() => registerKid(t, k2, 'R/M3', IDS[1], 5), e => e instanceof TreeRefusal && /the tree is blocked: parent_changed/.test(e.reason), 'registration is refused for ANY frontier while one is blocked');
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: k1, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: 'b'.repeat(64), children: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: k1, revision: 2 });
  assert.equal(stateOfTree(t.rootDir).sticky.has('parent_changed'), false);
  assert.doesNotThrow(() => registerKid(t, k2, 'R/M3', IDS[1], 5), 'and registration works again');
});

test('the one writer: parentChangedEvent refuses to build a record without its frontierKey (it could never be cleared), the record shape validates frontierKey/ancestor, and nothing else in src/ writes reason parent_changed', () => {
  assert.throws(() => parentChangedEvent({ scope: 'R/M1@g1', detail: 'x' }), /names the frontier it invalidates/);
  const ev = parentChangedEvent({ scope: 'R/M1@g1', frontierKey: 'k'.repeat(64), detail: 'x', ancestor: 'R' });
  assert.deepEqual([ev.event, ev.reason, ev.check, ev.ancestor], ['blocked', 'parent_changed', 'ancestor', 'R']);
  const line = { schema: 'tree-events/1', id: 'e1', at: new Date().toISOString(), ...ev };
  assert.equal(eventShapeError(line), null); assert.match(eventShapeError({ ...line, frontierKey: 5 }), /frontierKey/);
  const srcDir = join(import.meta.dirname, '..', 'src');
  const writers = readdirSync(srcDir).filter(f => f.endsWith('.js') && readFileSync(join(srcDir, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').includes("reason: 'parent_changed'"));
  assert.deepEqual(writers, ['tree-continuation.js']);
});

/** The real `tree approve` for the frontier that waits, with a scripted terminal. */
async function approveAgain(r, key) {
  const io = terminal([prefixOf(key), 'y']);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  return { code, shown: io.shown(), errors: io.errors() };
}

test('L10 (real): a parent\'s deliverable.md edited after the approval and after a child was registered: the start exits 19 with NO provider call and records parent_changed (frontier, scope, ancestor); the approval is invalid and both nodes are stale; with the file restored the start is STILL refused; the real `tree approve` then lifts it and the start goes through', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d = approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });                  // R/M1 runs and closes
  const b = registerNextChild(r.t.rootDir, { work: r.t.work });                                              // R/M2 is registered, not started
  assert.equal(b.kind, 'registered'); assert.equal(b.node, 'R/M2');
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}\nAn edit after the approval.\n`);
  const bDir = join(r.t.runsDir, b.runId);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(first.status, 'tree_refused', JSON.stringify(first)); assert.equal(first.exitCode, 19); assert.deepEqual(usageFiles(bDir), [], 'no provider call');
  const ev = eventsOf(r);
  const blocked = ev.filter(e => e.event === 'blocked' && e.reason === 'parent_changed');
  assert.equal(blocked.length, 1); assert.deepEqual([blocked[0].frontierKey, blocked[0].scope, blocked[0].check, blocked[0].ancestor], [d.frontierKey, 'R/M2@g1', 'ancestor', 'R']);
  assert.equal(ev.some(e => e.event === 'node_started' && e.node === 'R/M2'), false, 'no claim was written');
  let st = stateOfTree(r.t.rootDir);
  assert.equal(st.sticky.has('parent_changed'), true); assert.equal(approvalValid(st.frontiers.get(d.frontierKey)), false);
  assert.equal(st.stale.has('R/M1@g1') && st.stale.has('R/M2@g1'), true, 'A and B are stale');
  // the file restored exactly: still refused
  writeFileSync(file, original);
  const second = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(second.status, 'blocked'); assert.deepEqual(second.reasons, ['parent_changed']); assert.deepEqual(usageFiles(bDir), []);
  // R6 (Opus 4-1, Fable Q4-3): `tree resume` on that blocked tree exits 20 (stopped for a person) and prints the way out - approve again - instead of 1 with nothing to do
  { const calls = []; const eventsBefore = eventsOf(r).length; const io = terminal([]);
    const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { startRun: async () => { calls.push('start'); return { exitCode: 0 }; }, resumeRun: async () => { calls.push('resume'); return { exitCode: 0 }; } } });
    assert.equal(calls.length, 0, 'nothing started'); assert.equal(code, 20, `${io.shown()}${io.errors()}`);
    assert.equal(eventsOf(r).length, eventsBefore, 'the resume under a block wrote nothing (no verification, no stop detection)');
    assert.match(io.shown(), /The tree is blocked: parent_changed/); assert.match(io.shown(), new RegExp(`council tree approve ${ROOT_ID}`)); }
  // the person approves the frontier again, through the real verb
  const ap = await approveAgain(r, d.frontierKey);
  assert.equal(ap.code, 0, ap.shown + ap.errors);
  st = stateOfTree(r.t.rootDir);
  assert.equal(st.sticky.has('parent_changed'), false); assert.equal(approvalValid(st.frontiers.get(d.frontierKey)), true); assert.deepEqual([...st.stale], [], 'nobody is stale: the edit made the root plan_unreadable + contract_check (a blocked stop), and the file was put back byte for byte, so the sitting closed that stop (restore fix-up 14 Oct 2026, EDITED and disclosed: it used to expect [\'R@g1\', the stop outliving the restored file, which was the stranding)');
  const third = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(third.status, 'nothing_to_do', JSON.stringify(third)); assert.deepEqual(third.started.map(s => s.node), ['R/M2', 'R/M3']);       // restore fix-up (EDITED, disclosed; S8 G9 had 'held_by_stop': the root's own blocked stop outlived the restored file): the stop is closed by the sitting, so the children ran to the end and nothing is left
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'closed', 'R/M2': 'closed', 'R/M3': 'closed' });
});

test('registration-time drift (the same writer): the parent\'s file edited after the approval and before a child is registered: nothing is registered, parent_changed is recorded for the frontier, the next call says blocked; restored and approved again it registers', { timeout: 200_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d = approvePending(r);
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}\nAn edit after the approval.\n`);
  const a = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([a.kind, a.check], ['refused', 'parent_changed']); assert.equal(stateOfTree(r.t.rootDir).nodes.has('R/M1@g1'), false);
  const rec = eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'parent_changed');
  assert.deepEqual(rec.map(e => [e.frontierKey, e.scope, e.ancestor]), [[d.frontierKey, 'R/M1@g1', 'R']]);
  assert.deepEqual(registerNextChild(r.t.rootDir, { work: r.t.work }), { kind: 'blocked', reasons: ['parent_changed'] });
  writeFileSync(file, original);
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).kind, 'blocked', 'restored, still blocked');
  assert.equal((await approveAgain(r, d.frontierKey)).code, 0);
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).kind, 'registered');
});

test('the sitting lock is mechanical: runTree takes it itself and releases it; another holder makes runTree THROW (RunLockedError) before anything starts; a caller that claims to hold it must hold it (the lock file names this process)', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const lockPath = join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE);
  let calls = 0; const startRun = async () => { calls += 1; return { exitCode: 3 }; };
  // another holder
  const other = acquireRunLock(treeDirOf(r.t.rootDir), { file: SITTING_LOCK_FILE });
  await assert.rejects(runTree(r.t.rootDir, { work: r.t.work, startRun }), e => e instanceof RunLockedError); assert.equal(calls, 0);
  // a claimed hold that is not true: the holder is this process here, so claim it with the lock ABSENT first
  other();
  await assert.rejects(runTree(r.t.rootDir, { work: r.t.work, startRun, sittingLockHeld: true }), /does not hold tree\/\.sitting\.lock/); assert.equal(calls, 0);
  // a claimed hold held by someone else (a lock file naming another pid)
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid + 1, host: (await import('node:os')).hostname(), at: new Date().toISOString(), nonce: 'x' }));
  await assert.rejects(runTree(r.t.rootDir, { work: r.t.work, startRun, sittingLockHeld: true, facts: {} }), /does not hold tree\/\.sitting\.lock/);
  writeFileSync(lockPath, JSON.stringify({ pid: 999995, host: (await import('node:os')).hostname(), at: new Date().toISOString(), nonce: 'x' }));      // a dead holder: stale, replaced
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun });
  assert.equal(out.status, 'waiting'); assert.equal(calls, 1);
  assert.throws(() => readFileSync(lockPath, 'utf8'), /ENOENT/, 'the sitting released its lock');
  // and the true claim works
  const mine = acquireRunLock(treeDirOf(r.t.rootDir), { file: SITTING_LOCK_FILE });
  try { const again = await runTree(r.t.rootDir, { work: r.t.work, startRun, sittingLockHeld: true }); assert.equal(again.status, 'waiting'); } finally { mine(); }
});

test('approve while a node of ANOTHER frontier is active is still refused ("a frontier is approved when nothing is active"); only a re-approval of the frontier whose own child is active goes through (M5c4)', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(splitChildren()); approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });   // R/M1 (A) runs and closes; its split is verified: A's frontier waits
  const c = registerNextChild(r.t.rootDir, { work: r.t.work });                                                       // R/M3 (the independent sibling of the ROOT frontier) is registered: active
  assert.equal(c.node, 'R/M3');
  const pendingKey = (await import('../src/tree-frontier.js')).findPendingFrontier({ rootDir: r.t.rootDir }).key;
  const io = terminal([prefixOf(pendingKey), 'y']);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 1); assert.match(io.errors(), /R\/M3@g1 is running or paused at an external seat; a frontier is approved when nothing is active/);
  assert.equal(eventsOf(r).filter(e => e.event === 'frontier_approved').length, 1, 'nothing was approved');
});

test('registration-time drift through the CONTRACT check (the root task file edited after the approval: the plan still reads, `contract check` says DRIFT): parent_changed for the frontier, nothing registered; restored and approved again it registers', { timeout: 200_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d = approvePending(r);
  const task = join(r.t.work, 'tasks', 'x.md'); const original = readFileSync(task, 'utf8');
  writeFileSync(task, `${original}\nA line added after the approval.\n`);
  const a = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([a.kind, a.check], ['refused', 'parent_changed']); assert.match(a.detail, /contract check/);
  assert.equal(stateOfTree(r.t.rootDir).nodes.has('R/M1@g1'), false);
  const rec = eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'parent_changed');
  assert.deepEqual(rec.map(e => [e.frontierKey, e.scope, e.ancestor, e.check]), [[d.frontierKey, 'R/M1@g1', 'R', 'ancestor']]);
  writeFileSync(task, original);
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).kind, 'blocked');
  assert.equal((await approveAgain(r, d.frontierKey)).code, 0);
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).kind, 'registered');
});

test('a re-approval of a blocked frontier is refused while a node of a DIFFERENT frontier is active (only its own child may be)', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  const d0 = approvePending(r);                                                                                          // the root frontier
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });                  // R/M1 (A) and the independent R/M3 run; R/M2 waits for A's subtree
  approvePending(r);                                                                                                     // A's frontier
  const c = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(c.node, 'R/M1/M1');                                                                                       // a child of A's frontier is active
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'R/M2@g1', frontierKey: d0.frontierKey, check: 'ancestor', detail: 'test', ancestor: 'R' });
  const io = terminal([prefixOf(d0.frontierKey), 'y']);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 1); assert.match(io.errors(), /R\/M1\/M1@g1 is running or paused at an external seat/);
  assert.equal(stateOfTree(r.t.rootDir).parentBlocks.has(d0.frontierKey), true, 'the block stands');
});

test('L10 (the "or resume" half, real): a child paused at an external seat; the parent\'s deliverable.md edited; its answer written; `tree resume` exits 19 with NO new provider call and records parent_changed for the frontier; restored it is still refused; approved again it resumes', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(externalChildren());
  const d = approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
  assert.equal(first.status, 'waiting');
  const dir = join(r.t.runsDir, first.runId);
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}\nAn edit while the child waits.\n`);
  writeFileSync(join(dir, 'build.md'), LEAF_PLAN);
  const usageBefore = usageFiles(dir).length;
  const io = () => { const o = []; const e = []; return { stdout: { write: x => o.push(String(x)) }, stderr: { write: x => e.push(String(x)) }, out: () => o.join(''), err: () => e.join('') }; };
  const run = async () => { const d2 = io(); const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: d2.stdout, stderr: d2.stderr, deps: { startRun: draftStarter(r) } }); return { code, out: d2.out(), err: d2.err() }; };
  const a = await run();
  assert.equal(a.code, 19, a.out + a.err); assert.equal(usageFiles(dir).length, usageBefore, 'no provider call');
  const blocked = eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'parent_changed');
  assert.deepEqual(blocked.map(e => [e.frontierKey, e.scope, e.ancestor]), [[d.frontierKey, 'R/M1@g1', 'R']]);
  writeFileSync(file, original);
  const b = await run();
  assert.equal(b.code, 20, b.out + b.err); assert.match(b.out, /The tree is blocked: parent_changed\. Nothing was started\./);                  // R6: exit 20 and the sitting text, not exit 1 with one stderr line
  assert.equal((await approveAgain(r, d.frontierKey)).code, 0);
  const c = await run();
  assert.equal(c.code, 0, c.out + c.err); assert.equal(phases(r)['R/M1'], 'closed');
});
