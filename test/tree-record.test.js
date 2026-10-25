// 0.8.3 M1 (PLAN 14, M1 exit checks): the tree record, its lock, node identity, the transition table, recovery, and the member CLI's claim. Offline, $0: a run is the all-mock chain (`mock`, `mock-budget`,
// `mock-external`), every other scenario is a fixture of events with a process id known to be dead.
//
// The status verb: the M1 check "`council tree status` reads during a hold" ran against the READER (`readTreeRecord`, which the verb will be built on); the CLI verb itself is M6's and has its own exit check there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/api.js';
import { RunLockedError } from '../src/run-lock.js';
import { sha256Of } from '../src/thin-contract.js';
import { EVENTS_FILE, TREE_FILE, TreeRefusal, appendTreeEvent, createTreeFile, readTreeRecord, stateOf, startTree, withTreeLock } from '../src/tree-record.js';
import { childNode, depthOf, frontierKey, nodeKey, obligationIdentity, obligationKey } from '../src/tree-identity.js';
import { planRecovery, recoverTree } from '../src/tree-recovery.js';
import { registerChildUnchecked, registerRoot, runFrontier } from '../src/tree-register.js';
import { foldRecord, eventShapeError, transitionRefusal } from '../src/tree-transitions.js';
import { APPROVAL_FIELDS, FIXTURE_BOUND, GATE_FIELDS, SPLIT_ROOT, chainSha, chainsFor, installSplitRoot, rootOpts } from './helpers/tree-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const SHA = 'a'.repeat(64);
const ROOT_ID = '2026-10-08T10-00-00-000Z';
const CHILD_IDS = ['2026-10-08T10-10-00-000Z', '2026-10-08T10-20-00-000Z', '2026-10-08T10-30-00-000Z'];
const DEAD = spawnSync(process.execPath, ['-e', '0']).pid;      // a process id that has exited: a claim by it is a crash (the same trick as test/gate-ledger.test.js)
const dead = { pidAlive: pid => pid !== DEAD };
const chains = chainsFor('mock-debate', 'mock');   // only for the tree.json shape tests below; a real root run uses the split-root chain (test/helpers/tree-fixture.js)
// Real chain hashes (M2: a member's start compares the chain file it runs with the one registered). The root runs `split-root` (mock-debate whose plan carries a split block and whose handoff reproduced it: it passes PLAN 5.5 items 1-3, which a child's start checks); children run `mock`.

function fixture({ cap = 5, work = null, rootId = ROOT_ID, rootChain = SPLIT_ROOT } = {}) {
  if (!work) {
    work = mkdtempSync(join(tmpdir(), 'thc-tree-'));
    mkdirSync(join(work, 'tasks'));
    writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  }
  const rootDir = join(work, 'runs', rootId);
  const splitSha = rootChain === SPLIT_ROOT ? installSplitRoot(work) : null;
  startTree(rootDir, { rootCapUsd: cap, chains: chainsFor(rootChain, 'mock', name => (name === SPLIT_ROOT ? splitSha : chainSha(name))) });
  return { work, rootDir };
}
const lineage = (work, node, generation = 1) => {
  const dir = join(work, 'bundles'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${nodeKey(node, generation).replace(/\//g, '_')}.json`);
  writeFileSync(file, JSON.stringify({ treeId: ROOT_ID, node, generation, attempt: 1, parentNode: node === 'R' ? null : node.split('/').slice(0, -1).join('/'), depth: depthOf(node) }));
  return file;
};
// the api.run options for this file's root (its own ROOT_ID and lineage files; the chain, plan and round come from the shared helper)
const rootRunOpts = (work, generation = 1) => ({ ...rootOpts({ work }), runId: ROOT_ID, treeNode: lineage(work, 'R', generation) });
const childSpec = (node, runId, generation = 1) => ({ node, generation, runId, parentRunId: ROOT_ID, chain: { name: 'mock', sha256: chainSha('mock') }, grant: { amount: 1, unit: 'usd' } });
const events = rootDir => readTreeRecord(rootDir).events;
const names = rootDir => events(rootDir).map(e => e.event);
// the node transitions only: since M2 a priced member also mirrors every reservation line into the record
const nodeNames = rootDir => names(rootDir).filter(n => n !== 'reservation_mirrored');
const claimFields = (node, runId, pid, generation = 1) => ({ node, generation, runId, pid, host: hostname() });
// A well-formed `reservation_mirrored` event (PLAN 7.2 item 6): the member's identity and a copy of one line of its own spend-reservations.jsonl.
const mirroredEvent = (runId = ROOT_ID, extra = {}) => ({ event: 'reservation_mirrored', runId, node: 'R', generation: 1, line: { schema: 'spend-reservations/1', event: 'reserved', id: 'r1', label: 'x', seat: 'p/m', usd: 1, at: '2026-10-08T10:00:00.000Z' }, ...extra });
const SPLIT = 'b'.repeat(64);

// A frontier of the given children under parent R, previewed and approved (the gate behind the approval is M5's: the event is appended directly).
function approve(rootDir, nodes, { openedBy = null, generation = 1, parentGeneration = 1 } = {}) {
  const children = nodes.map(node => ({ node, generation }));
  const key = frontierKey({ parentNode: 'R', parentGeneration, parentRunId: ROOT_ID, splitSha256: SPLIT, openedBy, children });
  appendTreeEvent(rootDir, { event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: key, parentNode: 'R', parentGeneration, parentRunId: ROOT_ID, splitSha256: SPLIT, children });
  appendTreeEvent(rootDir, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: key, revision: 1 });
  return key;
}
// Root registered, started and closed, by direct appends (no CLI): the base of the record-only scenarios.
function closedRoot() {
  const f = fixture();
  registerRoot(f.rootDir);
  appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, process.pid) });
  appendTreeEvent(f.rootDir, { event: 'node_closed', node: 'R', generation: 1, runId: ROOT_ID, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' });
  return f;
}
const run = (work, args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: work, env: { PATH: process.env.PATH }, timeout: 90_000 });

// One real tree on the mock chain, built once: the root and two siblings with IDENTICAL task text, each run by its own CLI.
let shared = null;
async function scenario() {
  if (shared) return shared;
  const f = fixture();
  registerRoot(f.rootDir);
  const start = c => api.run(c.node === 'R' ? rootRunOpts(f.work, c.generation) : { chain: 'mock', task: 'tasks/x.md', cwd: f.work, runId: c.runId, treeNode: lineage(f.work, c.node, c.generation) });
  const rootRun = await start({ node: 'R', generation: 1, runId: ROOT_ID });
  const key = approve(f.rootDir, ['R/M1', 'R/M2']);
  const frontier = { frontierKey: key, children: [childSpec('R/M1', CHILD_IDS[0]), childSpec('R/M2', CHILD_IDS[1])] };
  let calls = 0;
  const first = await runFrontier(f.rootDir, frontier, { startChild: c => { calls += 1; return start(c); }, register: registerChildUnchecked });
  const callsAfterFirst = calls;
  const second = await runFrontier(f.rootDir, frontier, { startChild: c => { calls += 1; return start(c); }, register: registerChildUnchecked });
  shared = { ...f, rootRun, frontier, first, second, callsAfterFirst, callsAfterSecond: calls };
  return shared;
}
const runJson = (work, id) => JSON.parse(readFileSync(join(work, 'runs', id, 'run.json'), 'utf8'));

// ---------------------------------------------------------------------------------------------------------------------------------- exit check 1: a frontier is registered once
test('registering the same frontier twice leaves one node_registered per child and one run folder each; the second call starts nothing (PLAN 12 row 2)', async () => {
  const s = await scenario();
  assert.deepEqual(s.first.map(r => r.status), ['registered', 'registered']);
  assert.deepEqual(s.second.map(r => r.status), ['existing', 'existing']);
  assert.equal(s.callsAfterSecond, s.callsAfterFirst, 'the second call started nothing');
  const registered = events(s.rootDir).filter(e => e.event === 'node_registered');
  assert.deepEqual(registered.map(e => e.node), ['R', 'R/M1', 'R/M2']);
  assert.deepEqual(readdirSync(join(s.work, 'runs')).sort(), [ROOT_ID, CHILD_IDS[0], CHILD_IDS[1]].sort());
  assert.equal(readTreeRecord(s.rootDir).corrupt.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------- exit check 4: identity is not in the task text
test('two siblings with identical task text record identical task hashes and different tree fields in run.json (PLAN 4.4: no node id in task text)', async () => {
  const s = await scenario();
  const a = runJson(s.work, CHILD_IDS[0]); const b = runJson(s.work, CHILD_IDS[1]);
  assert.equal(a.taskHash, b.taskHash);
  assert.ok(a.taskHash);
  assert.notDeepEqual(a.tree, b.tree);
  assert.deepEqual([a.tree.node, b.tree.node], ['R/M1', 'R/M2']);
  assert.deepEqual([a.tree.treeId, a.tree.depth, a.tree.parentNode, a.tree.attempt, a.tree.generation], [ROOT_ID, 1, 'R', 1, 1]);
  assert.equal(runJson(s.work, ROOT_ID).tree.node, 'R');
});

// ---------------------------------------------------------------------------------------------------------------------------------- exit check 8: start before close, written by the child's own CLI
test('a child cannot close before its start is durable: node_started (written by its own CLI) precedes node_closed, and the orchestrator writes no node_started (PLAN 7.6 step 3)', async () => {
  const s = await scenario();
  const ev = events(s.rootDir);
  for (const node of ['R', 'R/M1', 'R/M2']) {
    const order = ev.filter(e => e.node === node).map(e => e.event);
    // the ROOT's one priced call (its handoff, $0.04 on the fixture row) is mirrored into the record as a `reservation_mirrored` event for its reserved line and one for its settled line (printed by s2/scratch/root-mirrors.test.js), between its start and its close; the unpriced mock-budget child makes no priced call
    assert.deepEqual(order, node === 'R' ? ['node_registered', 'node_started', 'reservation_mirrored', 'reservation_mirrored', 'node_closed'] : ['node_registered', 'node_started', 'node_closed'], node);
  }
  for (const e of ev.filter(x => x.event === 'node_started')) {
    assert.notEqual(e.pid, process.pid, 'the claim is the member CLI\'s own process');
    assert.equal(e.host, hostname());
  }
  const closed = ev.filter(e => e.event === 'node_closed');
  assert.ok(closed.every(e => e.outcome === 'passed' && e.share === 'released'), JSON.stringify(closed));
  // registerRoot / registerChildUnchecked / runFrontier never write a claim: a registration alone leaves the node registered, not started.
  const f = fixture(); registerRoot(f.rootDir);
  assert.deepEqual(names(f.rootDir), ['tree_started', 'node_registered']);
});

// ---------------------------------------------------------------------------------------------------------------------------------- exit check 2: the tree lock
test('the tree lock: a second taker throws RunLockedError after its bounded retry; a lock left by a dead pid is replaced', () => {
  const f = fixture();
  withTreeLock(f.rootDir, () => {
    let slept = 0;
    assert.throws(() => withTreeLock(f.rootDir, () => assert.fail('must not run'), { tries: 4, waitMs: 5, sleep: () => { slept += 1; } }), RunLockedError);
    assert.equal(slept, 3, 'it tried 4 times, waiting between tries');
  });
  withTreeLock(f.rootDir, () => {});            // released in finally: free again
  const lock = join(f.rootDir, 'tree', '.tree.lock');
  writeFileSync(lock, JSON.stringify({ pid: DEAD, host: hostname(), at: new Date().toISOString(), nonce: 'x' }));
  appendTreeEvent(f.rootDir, { event: 'blocked', reason: 'transition_refused', scope: 'tree' });   // a dead holder's lock is replaced (pack A2)
  assert.equal(events(f.rootDir).at(-1).event, 'blocked');
  assert.equal(existsSync(lock), false, 'released after the write');
});

// A holder in another process keeps the lock until a marker file appears; nothing below depends on how long anything takes, only on what happened first.
function holdLock(rootDir, go) {
  const sab = 'new Int32Array(new SharedArrayBuffer(4))';
  return spawn(process.execPath, ['--input-type=module', '-e',
    `import { withTreeLock } from ${JSON.stringify(join(root, 'src', 'tree-record.js'))};
     import { existsSync } from 'node:fs';
     withTreeLock(${JSON.stringify(rootDir)}, () => { process.stdout.write('held\\n'); const w = ${sab}; while (!existsSync(${JSON.stringify(go)})) Atomics.wait(w, 0, 0, 10); });`], { stdio: ['ignore', 'pipe', 'inherit'] });
}
const heldBy = holder => new Promise((res, rej) => { holder.stdout.once('data', res); holder.once('error', rej); });
const napSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test('a mirrored write made while another process holds the lock succeeds once the hold ends; the reader never takes the lock (PLAN 4.3)', async () => {
  const f = fixture();
  registerRoot(f.rootDir);
  const go = join(f.work, 'go');
  const holder = holdLock(f.rootDir, go);
  await heldBy(holder);
  const lock = join(f.rootDir, 'tree', '.tree.lock');
  assert.equal(existsSync(lock), true);
  const during = readTreeRecord(f.rootDir);                // the reader, while the lock is held: it returns, takes nothing, and leaves the holder's lock alone
  assert.equal(existsSync(lock), true, 'the holder still holds it');
  assert.deepEqual(during.events.map(e => e.event), ['tree_started', 'node_registered']);
  assert.equal(during.corrupt.length, 0);
  let retries = 0;
  const mirrored = appendTreeEvent(f.rootDir, mirroredEvent(), { tries: 1000, waitMs: 10, sleep: ms => { retries += 1; if (retries === 3) writeFileSync(go, 'x'); napSync(ms); } });
  assert.ok(retries >= 3, 'it retried while the lock was held, and wrote only after the hold ended');
  assert.equal(mirrored.event, 'reservation_mirrored');
  await new Promise(res => holder.once('close', res));
  assert.equal(names(f.rootDir).at(-1), 'reservation_mirrored');
  assert.equal(existsSync(lock), false);
});

test('a member whose claim cannot take the tree lock fails closed: exit 19, "nothing was run", no node_started', async () => {
  const f = fixture(); registerRoot(f.rootDir);
  const go = join(f.work, 'go');
  const holder = holdLock(f.rootDir, go);
  await heldBy(holder);
  const r = run(f.work, ['--chain', 'mock', '--task', 'tasks/x.md', '--run-id', ROOT_ID, '--tree-node', lineage(f.work, 'R')]);     // retries for its full bounded wait, then gives up
  writeFileSync(go, 'x');
  await new Promise(res => holder.once('close', res));
  assert.equal(r.status, 19, r.stderr);
  assert.match(r.stderr, /locked by another process/);
  assert.match(r.stderr, /Nothing was run and nothing was spent/);
  assert.deepEqual(names(f.rootDir), ['tree_started', 'node_registered']);
  assert.ok(!existsSync(join(f.work, 'runs', ROOT_ID, 'deliverable.md')));
});

// ---------------------------------------------------------------------------------------------------------------------------------- exit checks 3, 6, 7, 9: recovery
const factsFor = map => runId => map[runId] ?? { hasRunJson: false, end: null, paused: false };

test('recovery: a registered node whose folder has a run.json is RESUMED (same attempt); one with no run.json is STARTED with its registered run id and grant; the root (folder holds only tree/) is started', () => {
  const f = fixture();
  registerRoot(f.rootDir);
  const [start] = planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({}) });
  assert.deepEqual(start, { action: 'start', node: 'R', generation: 1, runId: ROOT_ID, grant: { amount: 5, unit: 'usd' } });
  const [resume] = planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({ [ROOT_ID]: { hasRunJson: true, end: null, paused: false } }) });
  assert.deepEqual(resume, { action: 'resume', node: 'R', generation: 1, runId: ROOT_ID, firstStart: true });
});

test('a process killed right after node_registered leaves a node whose grant is IN that event; recovery starts it with the registered run id and that grant; no registered node can lack a grant', async () => {
  const f = closedRoot();
  const key = approve(f.rootDir, ['R/M1']);
  const reg = registerChildUnchecked(f.rootDir, { frontierKey: key, ...childSpec('R/M1', CHILD_IDS[0]), grant: { amount: 1.25, unit: 'usd' } });
  assert.deepEqual(reg.grant, { amount: 1.25, unit: 'usd' });
  assert.deepEqual(names(f.rootDir).slice(-1), ['node_registered']);          // the process dies here
  const started = [];
  const out = await recoverTree(f.rootDir, { runFactsOf: factsFor({}), facts: dead, startNode: a => started.push(a) });
  assert.deepEqual(started, [{ action: 'start', node: 'R/M1', generation: 1, runId: CHILD_IDS[0], grant: { amount: 1.25, unit: 'usd' } }]);
  assert.equal(out.applied.length, 1);
  // a node_registered without a grant is not a record this writer will write, and the reader rejects one found on disk
  assert.throws(() => appendTreeEvent(f.rootDir, { event: 'node_registered', ...childSpec('R/M9', CHILD_IDS[2]), grant: undefined, generation: 1, attempt: 1, depth: 1, parentNode: 'R', frontierKey: key }), TypeError);
  assert.match(eventShapeError({ schema: 'tree-events/1', id: 'e9', at: new Date().toISOString(), event: 'node_registered', ...childSpec('R/M1', CHILD_IDS[0]), grant: undefined, attempt: 1, depth: 1, parentNode: 'R', frontierKey: key }), /"grant"/);
});

test('an empty tree registers and starts its root without a frontier: tree_started, then the root\'s node_registered with the whole cap, then its own node_started; recovery after a preview still permits approval; recovery of a partly registered frontier registers only its remaining children', async () => {
  const f = fixture({ cap: 7.5 });
  assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({}) }), [{ action: 'register_root' }]);
  const reg = registerRoot(f.rootDir);
  assert.deepEqual([reg.node, reg.parentNode, reg.frontierKey, reg.grant], ['R', null, null, { amount: 7.5, unit: 'usd' }]);
  const rootRun = await api.run(rootRunOpts(f.work));
  assert.equal(rootRun.exitCode, 0);
  assert.deepEqual(names(f.rootDir), ['tree_started', 'node_registered', 'node_started', 'reservation_mirrored', 'reservation_mirrored', 'node_closed']);
  // a preview with no approval: recovery waits for the approval, and the approval is still allowed afterwards
  const children = ['R/M1', 'R/M2', 'R/M3'].map(node => ({ node, generation: 1 }));
  const key = frontierKey({ parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, children });
  appendTreeEvent(f.rootDir, { event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: key, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, children });
  assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({}) }), [{ action: 'await_approval', frontierKey: key }]);
  appendTreeEvent(f.rootDir, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: key, revision: 1 });
  // approved, the first child registered and finished: only the REMAINING children are registered, one at a time
  registerChildUnchecked(f.rootDir, { frontierKey: key, ...childSpec('R/M1', CHILD_IDS[0]) });
  appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R/M1', CHILD_IDS[0], process.pid) });
  appendTreeEvent(f.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: CHILD_IDS[0], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' });
  assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({}) }), [{ action: 'register_next', frontierKey: key }]);
  registerChildUnchecked(f.rootDir, { frontierKey: key, ...childSpec('R/M2', CHILD_IDS[1]) });
  assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({}) }).map(a => a.action), ['start'], 'R/M2 is registered and active: it starts, R/M3 waits');
});

test('killing an ordinary child (first start, and again after a budget-stop resume) leads recovery to continue the SAME attempt and never to node_released; a dead post-run call releases only its own claim; a decision_recorded with no generation_opened gets it appended', async () => {
  // first start, killed: node_started by a dead process, run not ended, run.json present
  let f = fixture(); registerRoot(f.rootDir);
  appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, DEAD) });
  const facts = factsFor({ [ROOT_ID]: { hasRunJson: true, end: null, paused: false } });
  let resumed = [];
  let out = await recoverTree(f.rootDir, { runFactsOf: facts, facts: dead, resumeNode: a => resumed.push(a) });
  assert.deepEqual(resumed, [{ action: 'resume', node: 'R', generation: 1, runId: ROOT_ID, firstStart: false }]);
  assert.ok(!names(f.rootDir).includes('node_released'));
  // a stopped node resumed (purpose resume) and killed again: the same recovery
  f = fixture(); registerRoot(f.rootDir);
  appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, process.pid) });
  appendTreeEvent(f.rootDir, { event: 'node_stopped', node: 'R', generation: 1, runId: ROOT_ID, reason: 'budget' });
  appendTreeEvent(f.rootDir, { event: 'node_resumed', purpose: 'resume', ...claimFields('R', ROOT_ID, DEAD) }, { facts: dead });
  resumed = [];
  out = await recoverTree(f.rootDir, { runFactsOf: facts, facts: dead, resumeNode: a => resumed.push(a) });
  assert.equal(resumed.length, 1);
  assert.ok(!names(f.rootDir).includes('node_released'));
  // a killed POST-RUN call: node_released, only that claim, and the node stays closed
  f = closedRoot();
  appendTreeEvent(f.rootDir, { event: 'node_resumed', purpose: 'post_run', ...claimFields('R', ROOT_ID, DEAD) });
  assert.equal(stateOf(readTreeRecord(f.rootDir)).active, 'R@g1', 'a post-run claim makes the node active');
  out = await recoverTree(f.rootDir, { runFactsOf: factsFor({}), facts: dead });
  const rel = events(f.rootDir).at(-1);
  assert.deepEqual([rel.event, rel.reason, rel.node], ['node_released', 'dead_post_run', 'R']);
  const st = stateOf(readTreeRecord(f.rootDir));
  assert.equal(st.active, null);
  assert.equal(st.nodes.get('R@g1').phase, 'closed');
  // an interrupted decision gets the generation it authorized
  f = closedRoot();
  const k1 = approve(f.rootDir, ['R/M1']);        // a regenerate answers a CHILD's stop (the root is never regenerated): a closed R/M1
  registerChildUnchecked(f.rootDir, { frontierKey: k1, ...childSpec('R/M1', CHILD_IDS[0]) });
  appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R/M1', CHILD_IDS[0], process.pid) });
  appendTreeEvent(f.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: CHILD_IDS[0], outcome: 'not_passed', passed: false, status: 'needs_decision', share: 'revoked' });
  const stop = appendTreeEvent(f.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: CHILD_IDS[0], source: 'status', affected: [{ node: 'R/M1', generation: 1 }] }); // EDITED in the M7 apply (C2a-record commit 2; old: a stop with no `affected`; why: the table now binds a regenerate's list to the stop's recorded set, so the stop records the node the decision lists)
  const dec = appendTreeEvent(f.rootDir, { event: 'decision_recorded', text: 'use the second design', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: stop.id, ...GATE_FIELDS });
  await recoverTree(f.rootDir, { runFactsOf: factsFor({}), facts: dead });
  const gen = events(f.rootDir).at(-1);
  assert.deepEqual([gen.event, gen.decisionId, gen.nodes], ['generation_opened', dec.id, [{ node: 'R/M1', generation: 2 }]]);
  assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({}) }), [], 'nothing left to recover');
});

test('recovery: completed outcomes are reconciled first; a pause waits for its answer; another host\'s claim waits for a person; a started node with no folder is accounting_blocked', () => {
  const f = fixture(); registerRoot(f.rootDir);
  appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, DEAD) });
  const plan = (extra, facts = dead) => planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({ [ROOT_ID]: { hasRunJson: true, end: null, paused: false, ...extra } }), facts });
  // M5f fix-up (the maintainer): a closing event REQUIRES the run folder (its spend decides what goes back to the pool): a closed end without runDir is a TypeError, never "the whole grant back"
  assert.throws(() => plan({ end: { kind: 'closed', outcome: 'not_passed', passed: false, status: 'needs_decision', share: 'revoked' } }), /a closing event needs the run folder/);
  const closed = plan({ runDir: join(f.rootDir, '..', ROOT_ID), end: { kind: 'closed', outcome: 'not_passed', passed: false, status: 'needs_decision', share: 'revoked' } });
  assert.equal(typeof closed[0].event.returnedUsd, 'number');
  assert.deepEqual([closed[0].action, closed[0].event.event, closed[0].event.share, closed[0].event.status], ['append', 'node_closed', 'revoked', 'needs_decision']);
  assert.deepEqual(plan({ end: { kind: 'stopped' } })[0].event.event, 'node_stopped');
  assert.deepEqual(plan({ paused: true }), [{ action: 'wait_for_answer', node: 'R', generation: 1 }]);
  assert.deepEqual(plan({}, { ...dead, host: 'some-other-host' }).map(a => a.action), ['wait_for_person']);
  const missing = plan({ hasRunJson: false })[0];
  assert.deepEqual([missing.action, missing.reason, missing.node], ['blocked', 'accounting_blocked', 'R'], 'reported, not appended: accounting_blocked is derived by the gate (M2), so restoring the record lifts it');
  assert.equal(stateOf(readTreeRecord(f.rootDir)).sticky.size, 0, 'nothing sticks');
  assert.deepEqual(plan({ hasRunJson: false }), [missing], 'and asking again appends and piles up nothing');
  // a state that DOES stick (parent_changed): no paid start or resume anywhere until a person acts, and recovery only reports it
  appendTreeEvent(f.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'tree' });
  assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({}) }).map(a => a.action), ['blocked']);
  assert.throws(() => appendTreeEvent(f.rootDir, { event: 'node_resumed', purpose: 'resume', ...claimFields('R', ROOT_ID, process.pid) }, { facts: dead }), /blocked: parent_changed/);
});

test('a registered node whose CLI died after run.json but before its claim is resumed as the same attempt: the claim comes from the RECORD (node_started), not from --resume (end to end)', async () => {
  const f = fixture();                                                    // the root is NOT registered yet
  const first = run(f.work, ['--chain', SPLIT_ROOT, '--task', 'tasks/x.md', '--draft', 'plan.md', '--rounds', '1', '--run-id', ROOT_ID, '--tree-node', lineage(f.work, 'R')]);
  assert.equal(first.status, 19, first.stderr);                           // refused at the claim, after run.json was written
  assert.ok(existsSync(join(f.work, 'runs', ROOT_ID, 'run.json')));
  registerRoot(f.rootDir);
  assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), { runFactsOf: factsFor({ [ROOT_ID]: { hasRunJson: true, end: null, paused: false } }) }).map(a => a.action), ['resume']);
  const res = await api.resume({ runDir: join(f.work, 'runs', ROOT_ID), cwd: f.work });
  assert.equal(res.exitCode, 0, res.outputTail);
  assert.deepEqual(names(f.rootDir), ['tree_started', 'blocked', 'node_registered', 'node_started', 'reservation_mirrored', 'reservation_mirrored', 'node_closed']);
  assert.equal(events(f.rootDir).filter(e => e.event === 'node_resumed').length, 0, 'a registered node\'s first claim is node_started even through --resume');
  assert.equal(runJson(f.work, ROOT_ID).tree.attempt, 1);
});

test('schema, id and time are the writer\'s: an event read back from the record cannot be appended again (it would repeat its id and corrupt the record); a node path has no "." or ".." segment', () => {
  const f = fixture(); registerRoot(f.rootDir);
  const before = readFileSync(join(f.rootDir, 'tree', EVENTS_FILE));
  const echoed = events(f.rootDir).at(-1);
  assert.throws(() => appendTreeEvent(f.rootDir, echoed), /"schema" is set by the writer/);
  assert.throws(() => appendTreeEvent(f.rootDir, mirroredEvent(ROOT_ID, { id: 'e1' })), /"id" is set by the writer/);
  assert.throws(() => appendTreeEvent(f.rootDir, mirroredEvent(ROOT_ID, { at: '2026-01-01T00:00:00.000Z' })), /"at" is set by the writer/);
  assert.ok(readFileSync(join(f.rootDir, 'tree', EVENTS_FILE)).equals(before), 'nothing was written');
  assert.equal(readTreeRecord(f.rootDir).corrupt.length, 0);
  const shape = node => eventShapeError({ schema: 'tree-events/1', id: 'e5', at: new Date().toISOString(), event: 'node_started', node, generation: 1, runId: ROOT_ID, pid: 1, host: 'h' });
  assert.equal(shape('R/M2'), null);
  for (const bad of ['R/..', 'R/../x', 'R/.', 'R//M1', 'R/M1/', 'R/1x', 'M1', 'R/a b']) assert.match(shape(bad), /"node"/, bad);
});

test('tree.json and tree_started: a crash between the two writes is completed; events without tree.json, or a hash that differs, are a corrupt record', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-tree-'));
  const rootDir = join(work, 'runs', ROOT_ID);
  createTreeFile(rootDir, { rootCapUsd: 3, chains });                                    // the process dies before tree_started
  assert.equal(readTreeRecord(rootDir).events.length, 0);
  assert.equal(readTreeRecord(rootDir).corrupt.length, 0);
  assert.equal(planRecovery(readTreeRecord(rootDir), {})[0].event.event, 'tree_started');
  await recoverTree(rootDir, { runFactsOf: factsFor({}) });
  const [ev] = readTreeRecord(rootDir).events;
  assert.equal(ev.event, 'tree_started'); assert.equal(ev.treeJsonSha256, sha256Of(readFileSync(join(rootDir, 'tree', TREE_FILE), 'utf8')));
  await recoverTree(rootDir, { runFactsOf: factsFor({}) });
  assert.equal(readTreeRecord(rootDir).events.length, 1, 'nothing more to complete: a second recovery appends no second tree_started');
  assert.throws(() => createTreeFile(rootDir, { rootCapUsd: 3, chains }), /never edited/);
  assert.throws(() => createTreeFile(join(work, 'runs', 'x'), { rootCapUsd: Infinity, chains }), /finite/);
  writeFileSync(join(rootDir, 'tree', TREE_FILE), readFileSync(join(rootDir, 'tree', TREE_FILE), 'utf8').replace('"rootCapUsd": 3', '"rootCapUsd": 99'));
  assert.ok(readTreeRecord(rootDir).corrupt.some(c => /differs from the hash/.test(c.reason)));
});

// ---------------------------------------------------------------------------------------------------------------------------------- exit check 5: replacement generations are another frontier
test('a frontier of replacement generations (same parent run and split hash, opened by a recorded decision) has a different key, is not returned as the old registration, and registers nothing until its own approval', async () => {
  const f = closedRoot();
  const k1 = approve(f.rootDir, ['R/M1']);
  registerChildUnchecked(f.rootDir, { frontierKey: k1, ...childSpec('R/M1', CHILD_IDS[0]) });
  appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R/M1', CHILD_IDS[0], process.pid) });
  appendTreeEvent(f.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: CHILD_IDS[0], outcome: 'not_passed', passed: false, status: 'needs_decision', share: 'revoked' });
  const stop = appendTreeEvent(f.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: CHILD_IDS[0], source: 'status', affected: [{ node: 'R/M1', generation: 1 }] }); // EDITED in the M7 apply (C2a-record commit 2; old: a stop with no `affected`; why: the table now binds a regenerate's list to the stop's recorded set, so the stop records the node the decision lists)
  const dec = appendTreeEvent(f.rootDir, { event: 'decision_recorded', text: 'take the other route', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: stop.id, ...GATE_FIELDS });
  appendTreeEvent(f.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R/M1', generation: 2 }] });
  const k2 = frontierKey({ parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, openedBy: dec.id, children: [{ node: 'R/M1', generation: 2 }] });
  assert.notEqual(k2, k1);
  assert.equal(k2, frontierKey({ parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, openedBy: dec.id, children: [{ generation: 2, node: 'R/M1' }] }), 'the same inputs give the same key');
  // asked to run the replacement frontier before it is approved: nothing is registered, nothing is started, and the old registration is not returned for it
  let started = 0;
  appendTreeEvent(f.rootDir, { event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: k2, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, children: [{ node: 'R/M1', generation: 2 }] });
  await assert.rejects(runFrontier(f.rootDir, { frontierKey: k2, children: [childSpec('R/M1', CHILD_IDS[1], 2)] }, { startChild: () => { started += 1; }, register: registerChildUnchecked }), TreeRefusal);   // the table is under test here, on synthetic folders: the unchecked path
  assert.equal(started, 0);
  assert.deepEqual(events(f.rootDir).filter(e => e.event === 'node_registered').map(e => nodeKey(e.node, e.generation)), ['R@g1', 'R/M1@g1']);
  const refused = events(f.rootDir).at(-1);
  assert.deepEqual([refused.event, refused.reason, refused.scope, refused.transition], ['blocked', 'transition_refused', 'R/M1@g2', 'node_registered']);
  assert.equal(stateOf(readTreeRecord(f.rootDir)).sticky.size, 0, 'a refused transition is a record, not a sticky block');
  // its own approval, then it registers
  appendTreeEvent(f.rootDir, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: k2, revision: 1 });
  const out = await runFrontier(f.rootDir, { frontierKey: k2, children: [childSpec('R/M1', CHILD_IDS[1], 2)] }, { startChild: () => { started += 1; }, register: registerChildUnchecked });
  assert.deepEqual(out.map(r => r.status), ['registered']);
  assert.equal(started, 1);
});

// ---------------------------------------------------------------------------------------------------------------------------------- exit checks 10, 11: the tail rule, a corrupt record, the table
test('an events.jsonl ending in a fragment: the next append copies the fragment byte for byte to events.torn-1.txt, truncates to the last complete line, then writes; the file then holds only complete, valid lines', () => {
  const f = fixture(); registerRoot(f.rootDir);
  const file = join(f.rootDir, 'tree', EVENTS_FILE);
  const fragment = Buffer.concat([Buffer.from('{"schema":"tree-events/1","id":"e3","event":"node_started","note":"'), Buffer.from([0xc2])]);   // cut inside the two bytes of "§"
  appendFileSync(file, fragment);
  const before = readFileSync(file);
  const rec = readTreeRecord(f.rootDir);
  assert.equal(rec.corrupt.length, 0, 'a torn tail is not a malformed line');
  assert.ok(rec.fragment.equals(fragment));
  assert.deepEqual(readFileSync(file), before, 'the reader truncates nothing');
  const w = appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, process.pid) });
  assert.equal(w.id, 'e3', 'the uncommitted id is reused');
  assert.ok(readFileSync(join(f.rootDir, 'tree', 'events.torn-1.txt')).equals(fragment), 'byte for byte, including the cut multi-byte character');
  const after = readFileSync(file);
  assert.equal(after[after.length - 1], 0x0a);
  assert.equal(readTreeRecord(f.rootDir).corrupt.length, 0);
  assert.equal(readTreeRecord(f.rootDir).fragment, null);
  assert.deepEqual(names(f.rootDir), ['tree_started', 'node_registered', 'node_started']);
  appendFileSync(file, 'partial');                                   // a second torn tail: another copy, never an overwrite
  appendTreeEvent(f.rootDir, mirroredEvent());
  assert.equal(readFileSync(join(f.rootDir, 'tree', 'events.torn-2.txt'), 'utf8'), 'partial');
  assert.ok(readFileSync(join(f.rootDir, 'tree', 'events.torn-1.txt')).equals(fragment));
});

test('a malformed complete line (and a blank line) is record_corrupt: nothing but a blocked record is appended, and a start exits 19', () => {
  for (const bad of ['this is not json\n', '\n', '{"schema":"tree-events/1","id":"e9","event":"nope","at":"2026-10-08T10:00:00.000Z"}\n', '{"schema":"tree-events/1","id":"e1","event":"blocked","at":"2026-10-08T10:00:00.000Z","reason":"transition_refused","scope":"tree"}\n']) {
    const f = fixture(); registerRoot(f.rootDir);
    appendFileSync(join(f.rootDir, 'tree', EVENTS_FILE), bad);        // the last one repeats the id e1
    const rec = readTreeRecord(f.rootDir);
    assert.equal(rec.corrupt.length, 1, JSON.stringify(bad));
    assert.ok(stateOf(rec).sticky.has('record_corrupt'));
    assert.throws(() => appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, process.pid) }), e => e instanceof TreeRefusal && e.code === 'record_corrupt');
    const blockedCount = () => events(f.rootDir).filter(e => e.event === 'blocked' && e.reason === 'record_corrupt').length;
    assert.equal(blockedCount(), 1);
    assert.throws(() => appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, process.pid) }), TreeRefusal);
    assert.equal(blockedCount(), 1, 'a second refusal does not pile up blocked records');
    assert.ok(!names(f.rootDir).includes('node_started'));
    assert.deepEqual(planRecovery(readTreeRecord(f.rootDir), {}).map(a => a.action), ['blocked']);
    // the member CLI: exit 19, nothing run
    const r = run(f.work, ['--chain', 'mock', '--task', 'tasks/x.md', '--run-id', ROOT_ID, '--tree-node', lineage(f.work, 'R')]);
    assert.equal(r.status, 19, r.stderr);
    assert.match(r.stderr, /record_corrupt/);
    assert.match(r.stderr, /Nothing was run and nothing was spent/);
    assert.ok(!existsSync(join(f.work, 'runs', ROOT_ID, 'deliverable.md')));
  }
});

test('an event out of the table order is refused with exit 19 and a blocked record naming the transition: node_started with no node_registered; a second node_registered while a node is active', () => {
  const f = fixture();
  assert.throws(() => appendTreeEvent(f.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, process.pid) }), e => e instanceof TreeRefusal && e.transition === 'node_started' && /not registered/.test(e.reason));
  let b = events(f.rootDir).at(-1);
  assert.deepEqual([b.event, b.reason, b.scope, b.transition], ['blocked', 'transition_refused', 'R@g1', 'node_started']);
  registerRoot(f.rootDir);
  assert.throws(() => registerRoot(f.rootDir), e => e instanceof TreeRefusal && /already registered/.test(e.reason));
  // a frontier is previewed when nothing is active: the registered root is
  assert.throws(() => approve(f.rootDir, ['R/M1']), e => e instanceof TreeRefusal && /is active/.test(e.reason));
  // with the root closed: two approved children, the first registered and so active; the second cannot be registered until it ends
  const g = closedRoot();
  const key = approve(g.rootDir, ['R/M1', 'R/M2']);
  registerChildUnchecked(g.rootDir, { frontierKey: key, ...childSpec('R/M1', CHILD_IDS[0]) });
  assert.throws(() => registerChildUnchecked(g.rootDir, { frontierKey: key, ...childSpec('R/M2', CHILD_IDS[1]) }), e => e instanceof TreeRefusal && /R\/M1@g1 is active/.test(e.reason));
  assert.equal(stateOf(readTreeRecord(g.rootDir)).sticky.size, 0, 'a refused transition is a record, not a sticky block');
  // and the CLI: a --tree-node for a node the record does not hold exits 19 and records the refusal
  const r = run(f.work, ['--chain', 'mock', '--task', 'tasks/x.md', '--run-id', CHILD_IDS[2], '--tree-node', lineage(f.work, 'R/M7')]);
  assert.equal(r.status, 19, r.stderr);
  b = events(f.rootDir).at(-1);
  assert.deepEqual([b.event, b.scope, b.transition], ['blocked', 'R/M7@g1', 'node_started']);
  // a run id other than the one registered is refused too
  const r2 = run(f.work, ['--chain', 'mock', '--task', 'tasks/x.md', '--run-id', '2026-10-08T10-40-00-000Z', '--tree-node', lineage(f.work, 'R')]);
  assert.equal(r2.status, 19, r2.stderr);
  assert.match(events(f.rootDir).at(-1).detail, /not the run registered/);
});

test('a tree\'s root exception is for THAT tree\'s folder: a run of tree X started with another tree\'s root id is refused (exit 2) before it writes anything, and the other tree\'s root still starts', async () => {
  const X = fixture(); registerRoot(X.rootDir);                                         // tree X, root registered
  const OTHER = '2026-10-08T10-05-00-000Z';
  const Y = fixture({ work: X.work, rootId: OTHER }); registerRoot(Y.rootDir);          // tree Y in the same runs/ folder, freshly started
  const yDir = join(X.work, 'runs', OTHER);
  assert.deepEqual(readdirSync(yDir), ['tree']);
  const r = run(X.work, ['--chain', 'mock', '--task', 'tasks/x.md', '--run-id', OTHER, '--tree-node', lineage(X.work, 'R')]);     // lineage says tree X (ROOT_ID), the folder is Y's
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /already exists/);
  assert.deepEqual(readdirSync(yDir), ['tree'], 'no run.json was written into the other tree\'s folder');
  assert.deepEqual(names(Y.rootDir), ['tree_started', 'node_registered'], 'and nothing was claimed');
  // the other tree\'s root can still start, with its own lineage
  const yLineage = join(X.work, 'bundles', 'Y.json');
  writeFileSync(yLineage, JSON.stringify({ treeId: OTHER, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0 }));
  const ok = await api.run({ ...rootRunOpts(X.work), runId: OTHER, treeNode: yLineage });
  assert.equal(ok.exitCode, 0, ok.outputTail);
  assert.deepEqual(names(Y.rootDir), ['tree_started', 'node_registered', 'node_started', 'reservation_mirrored', 'reservation_mirrored', 'node_closed']);
});

test('the table as code: every transition of PLAN 8.5 in one record, and an unlisted one is refused', () => {
  const f = closedRoot();
  const st = () => stateOf(readTreeRecord(f.rootDir));
  const ev = (e, extra = {}) => ({ schema: 'tree-events/1', id: 'e99', at: new Date().toISOString(), ...e, ...extra });
  // closed node: node_started again and node_stopped are not transitions
  assert.match(transitionRefusal(st(), ev({ event: 'node_started', ...claimFields('R', ROOT_ID, 1) })).reason, /closed/);
  assert.match(transitionRefusal(st(), ev({ event: 'node_stopped', node: 'R', generation: 1, runId: ROOT_ID, reason: 'budget' })).reason, /not running/);
  assert.match(transitionRefusal(st(), ev({ event: 'node_released', node: 'R', generation: 1, runId: ROOT_ID, reason: 'x' })).reason, /no post-run call/);
  assert.match(transitionRefusal(st(), ev({ event: 'grant_issued', node: 'R', generation: 1, amount: 1, unit: 'usd' })).reason, /not stopped/);
  assert.equal(transitionRefusal(st(), ev({ event: 'node_resumed', purpose: 'post_run', ...claimFields('R', ROOT_ID, 1) })), null, 'a post-run call follows a closed node');
  assert.match(transitionRefusal(st(), ev({ event: 'node_resumed', purpose: 'resume', ...claimFields('R', ROOT_ID, 1) })).reason, /closed; resume follows/);
  assert.match(transitionRefusal(st(), ev({ event: 'decision_recorded', text: 'x', affected: [] })).reason, /no open stop/);
  assert.match(transitionRefusal(st(), ev({ event: 'generation_opened', decisionId: 'e5', nodes: [] })).reason, /no decision_recorded/);
  assert.match(transitionRefusal(st(), ev({ event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: 'k', revision: 1 })).reason, /no frontier_previewed/);
  assert.equal(transitionRefusal(st(), ev({ event: 'tree_started', treeId: ROOT_ID, treeJsonSha256: SHA })).reason, 'the tree is already started');
  assert.equal(transitionRefusal(foldRecord([]), ev({ event: 'node_registered', ...childSpec('R', ROOT_ID), attempt: 1, depth: 0, parentNode: null, frontierKey: null })).reason, 'the tree has not started (no tree_started yet)');
  // records are never transitions
  for (const name of ['guard_refused', 'integration_recorded', 'accounting_accepted', 'reservation_mirrored', 'readiness', 'blocked']) assert.equal(transitionRefusal(st(), ev({ event: name })), null, name);
  // a budget-stop and a top-up on a running node, then a resume after the top-up
  const g = fixture(); registerRoot(g.rootDir);
  appendTreeEvent(g.rootDir, { event: 'node_started', ...claimFields('R', ROOT_ID, process.pid) });
  appendTreeEvent(g.rootDir, { event: 'node_stopped', node: 'R', generation: 1, runId: ROOT_ID, reason: 'budget' });
  assert.equal(stateOf(readTreeRecord(g.rootDir)).active, null, 'a budget-stopped node is not active');
  appendTreeEvent(g.rootDir, { event: 'grant_issued', node: 'R', generation: 1, amount: 2, unit: 'usd', ...GATE_FIELDS });
  appendTreeEvent(g.rootDir, { event: 'node_resumed', purpose: 'resume', ...claimFields('R', ROOT_ID, process.pid) });
  assert.equal(stateOf(readTreeRecord(g.rootDir)).active, 'R@g1');
  // a live claim cannot be taken over; the root's run id is the tree id
  assert.match(transitionRefusal(stateOf(readTreeRecord(g.rootDir)), ev({ event: 'node_resumed', purpose: 'resume', ...claimFields('R', ROOT_ID, process.pid) })).reason, /is running/);
  const h = fixture();
  assert.match(transitionRefusal(stateOf(readTreeRecord(h.rootDir)), ev({ event: 'node_registered', ...childSpec('R', CHILD_IDS[0]), attempt: 1, depth: 0, parentNode: null, frontierKey: null })).reason, /run id is the tree id/);
});

// ---------------------------------------------------------------------------------------------------------------------------------- the member CLI's end hook, claim choice, flags
// CHANGED ACCEPTED (already-false unit, Q3; C&C thcmcp-cd 24 Okt 2026): memberStart now REFUSES a node that registered a chain hash when it is given no chain file. OLD: no `chainPath` in the script's memberStart call. NEW: the root's registered chain file (work/chains/split-root.json, installed by the fixture, whose hash the root's registration holds). WHY: the script tests the end hook, not the chain check, and must still start the member.
function hookScript(rootDir, work, mode) {
  const src = (f) => JSON.stringify(join(root, 'src', f));
  return `import { memberStart, installMemberEndHook } from ${src('tree-member.js')};
import { appendTreeEvent } from ${src('tree-record.js')};
import { writeFileSync, mkdirSync } from 'node:fs';
const runDir = ${JSON.stringify(join(work, 'runs', ROOT_ID))};
const lineage = { treeId: ${JSON.stringify(ROOT_ID)}, node: 'R', generation: 1, attempt: 1 };
const start = memberStart({ runDir, runId: ${JSON.stringify(ROOT_ID)}, lineage, capAskedUsd: 5, chainPath: ${JSON.stringify(join(work, 'chains', `${SPLIT_ROOT}.json`))}, inputs: {}, piiGate: null, piiAllow: [], allowSecretShaped: false, ceiling: null });
installMemberEndHook({ runDir, runId: ${JSON.stringify(ROOT_ID)}, lineage, claim: start.claim });
const mode = ${JSON.stringify(mode)};
if (mode === 'report') writeFileSync(runDir + '/report.json', JSON.stringify({ passed: true }));
if (mode === 'recovered') appendTreeEvent(${JSON.stringify(rootDir)}, { event: 'node_closed', node: 'R', generation: 1, runId: ${JSON.stringify(ROOT_ID)}, outcome: 'passed', passed: true, status: null, share: 'released' });
if (mode === 'recovered') writeFileSync(runDir + '/report.json', JSON.stringify({ passed: true }));
process.exit({ report: 0, cap: 4, pause: 3, crash: 16, recovered: 0 }[mode]);`;
}
test('the member\'s exit hook: exit 4 writes node_stopped; a report written in this sitting writes node_closed; a pause (3) and a crash (16, no report) write nothing; an end already recorded is not written twice', () => {
  const outcome = mode => {
    const f = fixture(); registerRoot(f.rootDir);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', hookScript(f.rootDir, f.work, mode)], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(r.status, { report: 0, cap: 4, pause: 3, crash: 16, recovered: 0 }[mode], r.stderr);
    return { names: names(f.rootDir), last: events(f.rootDir).at(-1), corrupt: readTreeRecord(f.rootDir).corrupt.length };
  };
  const cap = outcome('cap'); assert.deepEqual([cap.names.at(-1), cap.last.reason], ['node_stopped', 'budget']);
  const rep = outcome('report'); assert.deepEqual([rep.names.at(-1), rep.last.outcome, rep.last.share], ['node_closed', 'passed', 'released']);
  assert.deepEqual(outcome('pause').names, ['tree_started', 'node_registered', 'node_started'], 'a pause leaves the node active');
  assert.deepEqual(outcome('crash').names, ['tree_started', 'node_registered', 'node_started'], 'a crash with no report writes no end event');
  const again = outcome('recovered');
  assert.deepEqual(again.names, ['tree_started', 'node_registered', 'node_started', 'node_closed'], 'recovery got there first: the hook adds nothing and writes no blocked');
  assert.equal(again.corrupt, 0);
});

test('the claim is chosen from the RECORD, not from --resume: a stopped node resumed by the real CLI claims node_resumed (purpose resume) and is closed when it finishes; a node paused at an external seat stays active', async () => {
  // mock-budget: the cap stops the run (exit 4 -> node_stopped); a higher cap resumes it (node_resumed, purpose resume) and it closes
  const f = fixture({ cap: 100, rootChain: 'mock-budget' }); registerRoot(f.rootDir);
  const first = await api.run({ chain: 'mock-budget', task: 'tasks/x.md', cwd: f.work, runId: ROOT_ID, treeNode: lineage(f.work, 'R'), maxUsd: 1 });
  assert.equal(first.exitCode, 4, first.outputTail);
  assert.deepEqual(nodeNames(f.rootDir), ['tree_started', 'node_registered', 'node_started', 'node_stopped']);
  assert.equal(stateOf(readTreeRecord(f.rootDir)).active, null);
  const second = await api.resume({ runDir: join(f.work, 'runs', ROOT_ID), cwd: f.work, maxUsd: 100 });
  assert.equal(second.exitCode, 0, second.outputTail);
  const ev = events(f.rootDir);
  const nodeEv = ev.filter(e => e.event !== 'reservation_mirrored');
  assert.deepEqual(nodeEv.map(e => e.event), ['tree_started', 'node_registered', 'node_started', 'node_stopped', 'node_resumed', 'node_closed']);
  assert.equal(nodeEv[4].purpose, 'resume');
  assert.notEqual(nodeEv[4].pid, nodeEv[2].pid, 'each sitting is its own process');
  // an external seat pauses the run (exit 3): the node stays active, with no end event
  const g = fixture({ rootChain: 'mock-external' }); registerRoot(g.rootDir);
  const paused = await api.run({ chain: 'mock-external', task: 'tasks/x.md', cwd: g.work, runId: ROOT_ID, treeNode: lineage(g.work, 'R') });
  assert.equal(paused.exitCode, 3, paused.outputTail);
  assert.deepEqual(names(g.rootDir), ['tree_started', 'node_registered', 'node_started']);
  assert.equal(stateOf(readTreeRecord(g.rootDir)).active, 'R@g1');
});

test('--tree-node: a bare flag exits 2; with --resume exits 2; an unreadable or incomplete file exits 2; an unknown run folder is not touched (CLI usage errors, no tree needed)', () => {
  const f = fixture();
  const base = ['--chain', 'mock', '--task', 'tasks/x.md'];
  assert.equal(run(f.work, [...base, '--tree-node']).status, 2);
  const missing = run(f.work, [...base, '--tree-node', 'bundles/none.json']);
  assert.equal(missing.status, 2); assert.match(missing.stderr, /--tree-node: /);
  mkdirSync(join(f.work, 'bundles'), { recursive: true });
  writeFileSync(join(f.work, 'bundles', 'bad.json'), JSON.stringify({ node: 'R' }));
  const bad = run(f.work, [...base, '--tree-node', 'bundles/bad.json']);
  assert.equal(bad.status, 2); assert.match(bad.stderr, /treeId/);
  writeFileSync(join(f.work, 'bundles', 'dots.json'), JSON.stringify({ treeId: ROOT_ID, node: 'R/../x', generation: 1 }));
  const dots = run(f.work, [...base, '--tree-node', 'bundles/dots.json']);
  assert.equal(dots.status, 2); assert.match(dots.stderr, /node: a path of milestone ids/);
  const file = lineage(f.work, 'R');
  const ok = run(f.work, [...base, '--run-id', '2026-10-08T11-00-00-000Z', '--tree-node', file]);       // a run folder that is not the tree's root, a node never registered
  assert.equal(ok.status, 19);
  // --rematch and --replay spend outside the tree's record: the flag is refused with them instead of being ignored
  for (const side of ['--rematch', '--replay']) {
    const r = run(f.work, [side, join(f.work, 'runs', ROOT_ID), '--tree-node', file]);
    assert.equal(r.status, 2, `${side}: ${r.stderr}`);
    assert.match(r.stderr, /--tree-node: not allowed with --rematch or --replay/);
    assert.match(r.stderr, /Nothing was run and nothing was spent/);
  }
  // --resume of a finished-run folder is refused before the lineage is looked at; a lineage with --resume is a usage error
  const withResume = run(f.work, ['--resume', join(f.work, 'runs', ROOT_ID), '--tree-node', file]);
  assert.equal(withResume.status, 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------- identity
test('identity: frontier keys ignore the order of the children and change with anything that defines the frontier; obligation identities keep text, origin and class apart from a child\'s criterion number', () => {
  const base = { parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, openedBy: null, children: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] };
  const k = frontierKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(frontierKey({ ...base, children: [...base.children].reverse() }), k);
  for (const change of [{ parentNode: 'R/M3' }, { parentGeneration: 2 }, { parentRunId: CHILD_IDS[0] }, { splitSha256: 'c'.repeat(64) }, { openedBy: 'e12' }, { children: [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 1 }] }]) assert.notEqual(frontierKey({ ...base, ...change }), k, JSON.stringify(change));
  assert.throws(() => frontierKey({ ...base, children: [] }), TypeError);
  assert.equal(nodeKey('R/M2', 3), 'R/M2@g3');
  assert.equal(childNode('R', 'M2'), 'R/M2');
  assert.deepEqual(['R', 'R/M2', 'R/M2/M1'].map(depthOf), [0, 1, 2]);
  const o = obligationIdentity({ originNode: 'R', originGeneration: 1, originId: 'C3', originClass: 'global', text: 'No network calls.' });
  assert.equal(o.textSha256, sha256Of('No network calls.'));
  assert.equal(o.form, 'No network calls.');
  assert.notEqual(obligationKey(o), obligationKey(obligationIdentity({ originNode: 'R', originGeneration: 1, originId: 'C3', originClass: 'global', text: 'No network calls at all.' })), 'a reworded copy is another obligation');
  assert.notEqual(obligationKey(o), obligationKey({ ...o, originClass: 'delegated' }));
  assert.throws(() => obligationIdentity({ originNode: 'R', originGeneration: 1, originId: 'C3', originClass: 'everyone', text: 'x' }), TypeError);
  const withForm = obligationIdentity({ originNode: 'R', originGeneration: 1, originId: 'C4', originClass: 'delegated', text: 'x', form: { criterion: 'x', kind: 'checkable', check: 'grep x', on: 'build' } });
  assert.equal(withForm.form.kind, 'checkable');
});
