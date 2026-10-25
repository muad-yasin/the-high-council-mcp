// The tree's two files are refreshed by the VERBS, not only by the sitting (0.8.3 M6, the stale-views follow-up found 12 Oct while writing the S8-8 contract): `afterStep` in src/tree-run.js writes TREE_HANDOFF.md and
// tree/report.json after a sitting's step, but `council tree start | approve | decide | check` each changed the record and left both files as the last sitting wrote them - so after `decide --open-root-stop` (S8-8) or a
// `check` that turns the verdict, TREE_HANDOFF.md would still say "ready". Now `recordReadinessAfter` (src/tree-readiness.js: the one call every verb makes after its own record write) writes both files from the new
// record, under their OWN views lock (`.views.lock`, waited for briefly; the sitting lock keeps its one meaning), and `tree start` writes them after the root run. A failing write is named on stderr (one plain line), never fatal.
// Everything is mock and $0; every working folder is removed at the end of the file (test/helpers/temp-trees.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { approveHandler } from '../src/tree-approve.js';
import { checkHandler } from '../src/tree-check.js';
import { decideHandler } from '../src/tree-decide.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';
import { recordReadinessAfter } from '../src/tree-readiness.js';
import * as files from '../src/tree-files.js';
const { fileProblemLine, writeTreeFiles } = files;
const VIEWS_LOCK_FILE = files.VIEWS_LOCK_FILE ?? '.views.lock';          // (read by namespace so a base without the export runs the tests and fails them, instead of failing the import)
import { buildTreeReport, renderTreeReport } from '../src/tree-report.js';
import { treeDirOf } from '../src/tree-record.js';
import { prefixOf } from '../src/tree-stop.js';
import { runTree, SITTING_LOCK_FILE } from '../src/tree-run.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, pricedDebate, splitMilestoneChildren } from './helpers/child-chains.js';
import { registerNextChild } from '../src/tree-loop.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { realRoot } from './helpers/real-root.js';
import { IDS, ROOT_ID, approveFrontier, closedRootTree, registerKid, syntheticRun, installSplitRoot } from './helpers/tree-fixture.js';
import { PassThrough } from 'node:stream';

const HANDOFF = rootDir => join(rootDir, 'tree', 'TREE_HANDOFF.md');
const REPORT = rootDir => join(rootDir, 'tree', 'report.json');
const built = (rootDir, work) => ({ handoff: renderTreeHandoff(gatherHandoffFacts(rootDir, { work })), report: renderTreeReport(buildTreeReport(rootDir, { work })) });
/** Both files exist and are exactly what the builders make of the record as it stands NOW (the new record position). */
function assertFreshFiles(rootDir, work, what) {
  assert.ok(existsSync(HANDOFF(rootDir)) && existsSync(REPORT(rootDir)), `${what}: both files exist`);
  const b = built(rootDir, work);
  assert.equal(readFileSync(HANDOFF(rootDir), 'utf8'), b.handoff, `${what}: TREE_HANDOFF.md reflects the record`);
  assert.equal(readFileSync(REPORT(rootDir), 'utf8'), b.report, `${what}: report.json reflects the record`);
}
const noFiles = (rootDir, what) => assert.equal(existsSync(HANDOFF(rootDir)) || existsSync(REPORT(rootDir)), false, `${what}: before the verb neither file exists (nothing but a verb touched this tree)`);
/** A tree with a limit stop to answer: maxRuns 3, R/M1 ran, R/M2 registered, R/M3 refused for the limit (as test/tree-decide-limits.test.js builds it). The sitting's own writer is silenced: only the VERB may write what is asserted. */
async function limitTree() {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: { maxDepth: 2, maxRuns: 3, maxChildrenPerSplit: 4, attemptsPerChild: 1 } });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r), hooks: { writeFiles: () => [] } });
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).node, 'R/M2');
  return r;
}
const decideWith = (r, flags, answers) => {
  const io = terminal(answers); if (!answers.length) io.stdin.end();
  return { io, run: () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }) };
};

test('VF-1 `tree approve`: after the typed approval of a frontier both files exist and reflect the new record (red at 2a90c85: only a sitting wrote them)', async () => {
  const r = await realRoot(); track(r.t.work);
  noFiles(r.t.rootDir, 'approve');
  const key = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) }).frontierKey;
  const io = terminal([prefixOf(key), 'y']);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  assertFreshFiles(r.t.rootDir, r.t.work, 'approve');
});

test('VF-2 `tree decide` - a limit form and `--close` - : both files reflect the new record after each (the shared tail of decideHandler covers every form)', async () => {
  const lim = await limitTree();
  noFiles(lim.t.rootDir, 'decide limit');
  const d = decideWith(lim, { 'max-runs': '4' }, ['4', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assertFreshFiles(lim.t.rootDir, lim.t.work, 'decide --max-runs');
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {});
  noFiles(t.rootDir, 'decide --close');
  const io = terminal(['R/M1', 'y']);
  assert.equal(await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { close: 'R/M1' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  assertFreshFiles(t.rootDir, t.work, 'decide --close');
});

test('VF-3 `tree check`: after a recorded integration pass both files reflect the new record', async () => {
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(block3(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r); await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), hooks: { writeFiles: () => [] } });       // the sitting's own writer is silenced: only the VERB may write what is asserted
  for (const f of [HANDOFF(r.t.rootDir), REPORT(r.t.rootDir)]) rmSync(f, { force: true });
  const A1 = 'R@g1:A1'; const io = terminal([A1, 'y']);
  assert.equal(await checkHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, args: [A1, 'pass'], flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  assertFreshFiles(r.t.rootDir, r.t.work, 'check');
});

test('VF-4 `tree start`: after the root run both files exist and reflect the record', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-vf-')); track(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n'); installSplitRoot(dir);
  writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { o += d; });
  const code = await treeCommand(['start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5'], { work: dir, stdin: new PassThrough(), stdout, stderr, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 }) } }) } });
  assert.equal(code, 0, o);
  const id = /Tree (\S+) started/.exec(o)?.[1]; assert.ok(id, o);
  assertFreshFiles(join(dir, 'runs', id), dir, 'start');
});

test('VF-5 a write that fails is NAMED, never fatal: with report.json a symbolic link the verb still exits 0 (the decision is recorded), TREE_HANDOFF.md is still written, and stderr carries ONE plain line naming report.json', async () => {
  const r = await limitTree();
  mkdirSync(treeDirOf(r.t.rootDir), { recursive: true });
  symlinkSync(join(r.t.work, 'elsewhere.json'), REPORT(r.t.rootDir));
  const d = decideWith(r, { 'max-runs': '4' }, ['4', 'y']);
  // the line goes to the PROCESS's stderr (recordReadinessAfter is called by the verbs without their streams): captured here
  const real = process.stderr.write.bind(process.stderr); let captured = '';
  process.stderr.write = chunk => { captured += chunk; return true; };
  let code; try { code = await d.run(); } finally { process.stderr.write = real; }
  assert.equal(code, 0, d.io.shown() + d.io.errors() + captured);
  assert.ok(existsSync(HANDOFF(r.t.rootDir)), 'the other file was still written');
  const lines = captured.split('\n').filter(l => /report\.json/.test(l)); assert.equal(lines.length, 1, captured);
  assert.match(lines[0], /could not be written/); assert.match(lines[0], /council tree status/);
  assert.equal(existsSync(join(r.t.work, 'elsewhere.json')), false, 'nothing was written through the link');
});

test('VF-6 a RUNNING sitting (the sitting lock held by another live process) does not stop a verb from writing the views, and the verb does not touch that lock: files written, no line printed, the other sitting\'s lock file untouched (C&C\'s ruling on fb5a50f REVERSED the earlier "skip beside a sitting" rule: the views have their own lock)', async () => {
  const r = await limitTree();
  mkdirSync(treeDirOf(r.t.rootDir), { recursive: true });
  const { hostname } = await import('node:os');
  const lockText = JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'vf6' });
  writeFileSync(join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE), lockText);
  const d = decideWith(r, { 'max-runs': '4' }, ['4', 'y']);
  const real = process.stderr.write.bind(process.stderr); let captured = '';
  process.stderr.write = chunk => { captured += chunk; return true; };
  let code; try { code = await d.run(); } finally { process.stderr.write = real; }
  assert.equal(code, 0, d.io.shown() + d.io.errors() + captured);
  assertFreshFiles(r.t.rootDir, r.t.work, 'decide while a sitting runs'); assert.equal(captured, '', 'nothing printed');
  assert.equal(readFileSync(join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE), 'utf8'), lockText, 'the other sitting\'s lock is byte for byte untouched');
});

test('VF-7 `recordReadinessAfter` writes the files by default and NOT when the caller says so (`writeFiles: false` - the sitting, which writes them in afterStep itself, so a sitting never writes twice); the lock it takes is released', async () => {
  const r = await realRoot(); track(r.t.work);
  recordReadinessAfter(r.t.rootDir, { work: r.t.work, writeFiles: false });
  noFiles(r.t.rootDir, 'writeFiles false');
  const res = recordReadinessAfter(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(res.fileProblems ?? [], []); assertFreshFiles(r.t.rootDir, r.t.work, 'default');
  assert.equal(existsSync(join(treeDirOf(r.t.rootDir), VIEWS_LOCK_FILE)), false, 'the views lock is released'); assert.equal(existsSync(join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE)), false, 'and no sitting lock was ever left');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- fix-up: the sitting lock keeps ONE meaning
// C&C's ruling on fb5a50f: accepted code reads `.sitting.lock` as "a sitting is running" (tree-root-replan's sittingHeld; the "another sitting holds this tree" refusals; S8-4/S8-8 preconditions), so a verb that holds it for
// 30 ms while it writes the views makes them say something false. View writes now serialise on their OWN lock (`.views.lock`), taken with a short bounded WAIT; whoever holds it reads the record AFTER acquiring it; the
// sitting's afterStep and every verb go through the same `writeTreeFiles`; a lock that stays busy is a NAMED problem line, not silence.
test('VX-1 a verb NEVER takes the sitting lock to write the views (known-bad at fb5a50f: it did): watching tree/ during `decide`, no `.sitting.lock` appears; the views lock does, and both are gone afterwards', async () => {
  const r = await limitTree(); const dir = treeDirOf(r.t.rootDir);
  const seen = new Set(); const w = watch(dir, (_e, name) => { if (name) seen.add(String(name)); });
  try {
    const d = decideWith(r, { 'max-runs': '4' }, ['4', 'y']);
    assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
    for (let i = 0; i < 100 && !seen.has(VIEWS_LOCK_FILE); i += 1) await new Promise(res => setTimeout(res, 20));          // inotify events arrive after the synchronous writes: a bounded poll (2 s), not a fixed pause
    await new Promise(res => setTimeout(res, 100));                                                                          // and a moment for any other event of the same writes (the negative check below)
  } finally { w.close(); }
  assert.equal(seen.has(SITTING_LOCK_FILE), false, `a verb must not touch the sitting lock: saw ${[...seen].join(', ')}`);
  assert.equal(seen.has(VIEWS_LOCK_FILE), true, 'the views lock was used');
  assert.equal(existsSync(join(dir, VIEWS_LOCK_FILE)), false, 'and released');
  assertFreshFiles(r.t.rootDir, r.t.work, 'decide');
});

test('VX-2 WHILE the views are being written the tree reads as having NO running sitting (the lock holder of `.sitting.lock` is null, and a concurrent sitting could start), while the views lock is held; a sitting running elsewhere does not stop the verb from writing (it does not wait on the sitting lock at all)', async () => {
  const r = await limitTree(); const dir = treeDirOf(r.t.rootDir);
  let during = null;
  writeTreeFiles(r.t.rootDir, { work: r.t.work, beforeWrite: () => { during = { sitting: existsSync(join(dir, SITTING_LOCK_FILE)), views: existsSync(join(dir, VIEWS_LOCK_FILE)) }; } });
  assert.deepEqual(during, { sitting: false, views: true });
  const { hostname } = await import('node:os');
  writeFileSync(join(dir, SITTING_LOCK_FILE), JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'x' }));
  const p = writeTreeFiles(r.t.rootDir, { work: r.t.work }); assert.deepEqual(p, []);
  assertFreshFiles(r.t.rootDir, r.t.work, 'written beside a running sitting');
});

test('VX-3 the views lock is WAITED for, briefly, then released into: a holder that lets go during the wait costs nothing; one that never does is a NAMED problem (file `tree files`, "the views lock is held by pid <n>"), the files stay as they were, and the verb line says so', async () => {
  const r = await limitTree(); const dir = treeDirOf(r.t.rootDir);
  const { hostname } = await import('node:os');
  const lock = join(dir, VIEWS_LOCK_FILE);
  writeFileSync(lock, JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'y' }));
  let slept = 0;
  const released = writeTreeFiles(r.t.rootDir, { work: r.t.work, tries: 5, waitMs: 1, sleep: () => { slept += 1; if (slept === 2) unlinkSync(lock); } });
  assert.deepEqual(released, []); assert.equal(slept, 2, 'it waited, twice, then took the lock'); assertFreshFiles(r.t.rootDir, r.t.work, 'after the wait');
  for (const f of [HANDOFF(r.t.rootDir), REPORT(r.t.rootDir)]) unlinkSync(f);
  writeFileSync(lock, JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'z' }));
  const stuck = writeTreeFiles(r.t.rootDir, { work: r.t.work, tries: 3, waitMs: 1, sleep: () => {} });
  assert.equal(stuck.length, 1); assert.equal(stuck[0].file, 'tree files'); assert.match(stuck[0].error, /views lock is held by pid \d+/);
  noFiles(r.t.rootDir, 'a stuck lock writes nothing'); assert.match(fileProblemLine(r.t.rootDir, stuck[0]), /could not be written/);
});

test('VX-4 the problem line is TERMINAL-SAFE (known-bad at fb5a50f: raw): an escape sequence, a bell and a bidi override in the error text are removed from the line a verb prints', () => {
  const line = fileProblemLine('/x/runs/r1', { file: 'report.json', error: 'EACCES \u001b[31mred\u0007 \u202Eevil' });
  assert.doesNotMatch(line, /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E]/);
  assert.match(line, /report\.json could not be written \(EACCES/);
});
