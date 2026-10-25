// C&C's Q5 ruling B (25 Okt 2026; the window found by T's trace): every read of the root task for a derivation or a split's verification goes through ONE reader that reads the file once and compares it with the pin in tree.json
// (src/tree-root-task.js rootTaskOf). A changed file is refused with no owner (a file cause, no stop on a plan); readiness derives `root_task_changed` at tree scope from the same read, and it clears itself when the bytes match again.
//   (a) after a root re-plan R@g2 runs from a COPY of the task (its bundle's task.md), so its own contract check never sees an edit of the original: before B a child of R@g2 was derived from the edited bytes;
//   (b) a split verified in the same sitting step as the edit recorded resolvedRefs from bytes the pin never saw.
// Real verbs on all-mock chains, $0; the plans are drafts handed to each run (api.run's `draft`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { startHandler } from '../src/tree-start.js';
import { resumeHandler } from '../src/tree-resume.js';
import { approveHandler } from '../src/tree-approve.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { requestStop } from '../src/tree-run.js';
import { readinessOf } from '../src/tree-ready.js';
import { readTreeRecord } from '../src/tree-record.js';
import { track } from './helpers/temp-trees.js';
import { splitRootConfig } from './helpers/tree-fixture.js';
import { splitChild } from './helpers/child-chains.js';
import { block3, ownQuestions, plan3 } from './helpers/split-fixture.js';
import { LEAF_PLAN } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';

const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };
const CHANGED = /has changed since the tree was started \(its hash differs from the pinned one\): put it back as the tree was started with; a different goal is a new tree, started with `council tree start`/;
const reasonOf = (rootDir, work) => readinessOf(rootDir, { work }).reasons.find(x => x.code === 'root_task_changed');

test('B (a): after a root re-plan, the original task file edited -> the children of R@g2 are NOT derived from it: approve refuses (root_task_changed, no stop: a file cause), status names it at tree scope; the file put back clears both', { timeout: 900_000 }, async () => {
  const S = await driveToDepthTwoReplan();
  let r = await S.approve(); assert.equal(r.code, 0, `the new root plan is approved: ${r.text}`);
  r = await S.sit(); assert.equal(r.code, 20, `R@g2 runs and its children frontier waits: ${r.text}`);
  const task = join(S.work, 'tasks', 'x.md'); const original = readFileSync(task, 'utf8');
  writeFileSync(task, `${original}\nA goal the tree was not started with.\n`);
  r = await S.approve();
  assert.equal(r.code, 19, r.text);
  assert.match(r.text, CHANGED);
  assert.equal(S.kinds('needs_decision_opened').filter(e => e.source === 'blocked' && e.node === 'R').length, 0, 'no stop on a plan: no plan\'s text caused it');
  assert.equal(reasonOf(S.rootDir, S.work)?.scope, 'tree');
  assert.match(reasonOf(S.rootDir, S.work).text, CHANGED);
  writeFileSync(task, original);
  assert.equal(reasonOf(S.rootDir, S.work), undefined, 'the reason clears itself when the bytes match again');
  r = await S.approve(); assert.equal(r.code, 0, r.text);
});

test('B (b): the root task edited while R/M1 runs -> the next step does not verify R/M1\'s split from the edited bytes (refused root_task_changed, no resolvedRefs); the file put back -> the next sitting verifies it (RECHECKED)', { timeout: 900_000 }, async () => {
  const work = track(mkdtempSync(join(tmpdir(), 'thc-pin-b-')));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  const task = join(work, 'tasks', 'x.md'); const original = 'Plan a tiny change.\n';
  writeFileSync(task, original);
  writeFileSync(join(work, 'chains', 'pin-root.json'), JSON.stringify({ ...splitRootConfig(), name: 'pin-root' }, null, 2));
  writeFileSync(join(work, 'chains', 'pin-child.json'), JSON.stringify({ ...splitChild(), name: 'pin-child' }, null, 2));
  writeFileSync(join(work, 'plan.md'), plan3());
  writeFileSync(join(work, 'child-plan.md'), plan3(ownQuestions(block3())));
  writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN);
  const S = {};
  const kinds = (...names) => readTreeRecord(S.rootDir).events.filter(e => names.includes(e.event));
  let editAfterM1 = true;
  const startRun = async ({ node, chain, bundleDir, runId, grantUsd }) => {
    const res = await api.run({ chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}), context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', cwd: work, maxUsd: grantUsd, draft: node === 'R/M1' ? 'child-plan.md' : 'leaf-plan.md', rounds: 1 });
    if (node === 'R/M1' && editAfterM1) { editAfterM1 = false; writeFileSync(task, `${original}\nA goal the tree was not started with.\n`); }      // the person edits the root task while the sitting runs
    return res;
  };
  const sit = async () => { const o = quiet(); const code = await resumeHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun } }); return { code, text: o.text() }; };
  const o = quiet();
  assert.equal(await startHandler({ flags: { task: 'tasks/x.md', chain: 'pin-root', 'child-chain': 'pin-child', 'max-usd': '100' }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: 4000, startRun: opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 }) } }), 0, o.text());
  [S.rootId] = readdirSync(join(work, 'runs')); S.rootDir = join(work, 'runs', S.rootId);
  assert.equal((await sit()).code, 20);
  const pending = findPendingFrontier({ rootDir: S.rootDir });
  const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  assert.equal(await approveHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0, t.shown() + t.errors());
  const run = await sit();
  assert.equal(kinds('split_verified').some(e => e.node === 'R/M1'), false, `R/M1's split is not verified from the edited bytes: ${run.text}`);
  assert.ok(kinds('blocked').some(e => e.reason === 'expansion_refused' && e.scope === 'R/M1@g1' && e.check === 'root_task_changed'), run.text);
  writeFileSync(task, original);
  const back = await sit();
  const v = kinds('split_verified').find(e => e.node === 'R/M1' && e.generation === 1);
  assert.ok(v && Array.isArray(v.resolvedRefs), `verified once the file is back, with what each child resolved to: ${back.text}`);
});

// LB-1 (the fresh-eyes read's missing test, 25 Okt 2026): the root task that cannot be read when a split BELOW the root is verified refuses `root_task_unreadable` (for R itself the contract check refuses first), and the split is verified
// again once the file is back (RECHECKED, D2 F4a). The setup holds every other registration back (R/M1 is not signed and stops, so its consumer R/M2 waits; R/M3's own children wait for approval) so no derivation reads the missing file
// in the same step; R/M3's split is left unverified by the person's `tree stop` during its run (as in tree-record-only-under-block.test.js T5c).
test('LB-1: the root task gone when R/M3\'s split is verified -> refused root_task_unreadable, no split_verified; the file back -> the next resume verifies it', { timeout: 900_000 }, async () => {
  const work = track(mkdtempSync(join(tmpdir(), 'thc-lb1-')));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  const task = join(work, 'tasks', 'x.md'); writeFileSync(task, 'Plan a tiny change.\n');
  writeFileSync(join(work, 'chains', 'lb1-root.json'), JSON.stringify({ ...splitRootConfig(), name: 'lb1-root' }, null, 2));
  writeFileSync(join(work, 'chains', 'lb1-child.json'), JSON.stringify({ ...splitChild(), name: 'lb1-child' }, null, 2));
  writeFileSync(join(work, 'plan.md'), plan3());
  const m3Block = ownQuestions(block3()); m3Block.classes = m3Block.classes.filter(c => c.id !== 'C3'); for (const c of m3Block.children) c.inherits = c.inherits.map(x => (x === 'C3' ? 'C2' : x));
  writeFileSync(join(work, 'child-plan.md'), plan3(m3Block));
  writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN);
  writeFileSync(join(work, 'leaf-plan-unsigned.md'), '# A draft the mock critics do not sign\n\nIt carries no marker line.\n');
  const S = {};
  const kinds = (...names) => readTreeRecord(S.rootDir).events.filter(e => names.includes(e.event));
  const draftFor = node => (node === 'R/M1' ? 'leaf-plan-unsigned.md' : node === 'R/M3' ? 'child-plan.md' : 'leaf-plan.md');
  const startRun = async ({ node, chain, bundleDir, runId, grantUsd }) => {
    const res = await api.run({ chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}), context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', cwd: work, maxUsd: grantUsd, draft: draftFor(node), rounds: 1 });
    if (node === 'R/M3') { requestStop(S.rootDir); renameSync(task, `${task}.away`); }      // the person stops the sitting and the root task goes away while R/M3 runs
    return res;
  };
  const sit = async () => { const o = quiet(); const code = await resumeHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun } }); return { code, text: o.text() }; };
  const o = quiet();
  assert.equal(await startHandler({ flags: { task: 'tasks/x.md', chain: 'lb1-root', 'child-chain': 'lb1-child', 'max-usd': '100' }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: 4000, startRun: opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 }) } }), 0, o.text());
  [S.rootId] = readdirSync(join(work, 'runs')); S.rootDir = join(work, 'runs', S.rootId);
  assert.equal((await sit()).code, 20);
  const pending = findPendingFrontier({ rootDir: S.rootDir });
  const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  assert.equal(await approveHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0, t.shown() + t.errors());
  const run = await sit();
  assert.equal(kinds('split_verified').some(e => e.node === 'R/M3'), false, `the stop ended the sitting before R/M3 was verified: ${run.text}`);
  const gone = await sit();
  assert.ok(kinds('blocked').some(e => e.reason === 'expansion_refused' && e.scope === 'R/M3@g1' && e.check === 'root_task_unreadable'), `refused root_task_unreadable: ${gone.text}`);
  assert.equal(kinds('split_verified').some(e => e.node === 'R/M3'), false);
  renameSync(`${task}.away`, task);
  const back = await sit();
  assert.ok(kinds('split_verified').some(e => e.node === 'R/M3' && e.generation === 1), `verified once the file is back: ${back.text}`);
});
