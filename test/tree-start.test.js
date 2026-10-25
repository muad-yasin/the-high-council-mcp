// `council tree start` (0.8.3 M6 S5 commit 2): the root run folder, the tree record, the root registered with the whole cap, the sitting lock, the refusals that write nothing, the exit codes of the root run, and the
// one `--spend` line per tree. All chains are mock ($0 on the wire); every working folder is a temp folder of the test's own (never the repo's runs/ or tasks/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { readTreeRecord } from '../src/tree-record.js';
import { SITTING_LOCK_FILE } from '../src/tree-run.js';
import { RunLockedError, acquireRunLock } from '../src/run-lock.js';
import { root, cli, installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const io = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin, stdout, stderr, out: () => o, err: () => e }; };

/** A fresh working folder: a task, the split-root chain (milestones, a plan.md the test hands the root as a draft), a child chain `priced-debate` (milestones). No runs/ folder: `tree start` makes it. */
function work() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-s5-')); made.push(dir);
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  installSplitRoot(dir);
  writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  return dir;
}
const GOOD = ['--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5'];
const cliRun = (dir, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env }, timeout: 120_000 });
const snapshot = dir => JSON.stringify(readdirSync(dir, { recursive: true }).sort());
/** The starter a test hands the handler: the real api.run, with the plan handed in as a draft (as the fixtures start a root), so the root finishes with a split block at $0.04. */
const draftStarter = extra => opts => api.run({ ...opts, draft: 'plan.md', rounds: 1, ...extra });
const idOf = text => /Tree (\S+) started/.exec(text)?.[1];

test('S5-1 `tree start` through treeCommand: tree.json, then tree_started, then ONE node_registered for R (generation 1, grant == the cap, no grant_issued), the lineage file, the root run started as a member; the lock is gone at the end; the next step is named', async () => {
  const dir = work(); const d = io();
  const code = await treeCommand(['start', ...GOOD], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: draftStarter() } }) } });
  assert.equal(code, 0, d.err() + d.out());
  const id = idOf(d.out()); assert.match(id ?? '', /^\d{4}-\d\d-\d\dT[\d-]+Z$/, d.out());
  const rootDir = join(dir, 'runs', id);
  const rec = readTreeRecord(rootDir);
  assert.equal(rec.corrupt.length, 0); assert.equal(rec.tree.treeId, id); assert.equal(rec.tree.rootCapUsd, 5);
  assert.deepEqual(rec.tree.chains.map(c => [c.depth, c.name]), [[0, 'split-root'], [1, 'priced-debate'], [2, 'priced-debate']]);
  const names = rec.events.map(e => e.event);
  assert.equal(names[0], 'tree_started', `tree_started precedes everything: ${names.join(', ')}`);
  const reg = rec.events.filter(e => e.event === 'node_registered'); assert.equal(reg.length, 1, 'ONE node_registered');
  assert.deepEqual([reg[0].node, reg[0].generation, reg[0].runId, reg[0].grant], ['R', 1, id, { amount: 5, unit: 'usd' }], 'grant == the cap');
  assert.equal(names.includes('grant_issued'), false, 'no grant_issued: the root has its whole grant at registration');
  assert.ok(names.indexOf('tree_started') < names.indexOf('node_registered'));
  const lineage = JSON.parse(readFileSync(join(rootDir, 'tree', 'inputs', 'R@g1', 'node.json'), 'utf8'));
  assert.deepEqual(lineage, { treeId: id, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0, splitSha256: null, bundleSha256: null });
  const runJson = JSON.parse(readFileSync(join(rootDir, 'run.json'), 'utf8')); assert.deepEqual(runJson.tree, lineage, 'the root run is a member: its run.json carries the lineage');
  // the task pin (commit 3): tree.json records the task as run.json does - the same path string, the same cwd, the hash made by the same function - so a root that never ran still has its task on record
  assert.deepEqual(rec.tree.rootTask, { task: runJson.task, cwd: runJson.cwd, taskHash: runJson.taskHash }, 'tree.json rootTask == run.json task/cwd/taskHash');
  assert.ok(names.includes('node_started') && names.includes('node_closed'), `the root ran as a member: ${names.join(', ')}`);
  assert.equal(existsSync(join(rootDir, 'tree', SITTING_LOCK_FILE)), false, 'the sitting lock is released at the end');
  assert.match(d.out(), new RegExp(`The root run finished\\. Next: council tree resume ${id} `), 'the step after a finished root is resume: it verifies the split, so approve would still find nothing');
  // the printed next step is true: `resume` on this tree verifies the root's split (a split_verified record for R@g1), starts nothing, blocks nothing, and names `approve` (this also pins that the lineage file tree/inputs/R@g1/node.json is never read as an input bundle: a sitting that passes over R@g1 writes no `blocked` record)
  assert.equal(rec.events.some(e => e.event === 'split_verified'), false, 'start does not verify the split: the sitting does');
  const r = io(); let started = 0;
  const resumeCode = await DEFAULT_HANDLERS.resume({ rootDir, rootId: id, work: dir, stdout: r.stdout, stderr: r.stderr, deps: { startRun: async () => { started += 1; return { exitCode: 0 }; }, resumeRun: async () => { started += 1; return { exitCode: 0 }; } } });
  assert.equal(started, 0, `resume started nothing: ${r.err()}`);
  const after = readTreeRecord(rootDir);
  assert.equal(after.events.some(e => e.event === 'split_verified' && e.node === 'R' && e.generation === 1 && e.runId === id), true, `resume verified the root's split: exit ${resumeCode} ${r.out()} ${r.err()}`);
  assert.equal(after.events.filter(e => e.event === 'blocked').length, 0, 'no blocked record: nothing treated the lineage file as a bundle');
  assert.match(r.out(), new RegExp(`council tree approve ${id}`), 'the sitting names the approval that waits');
});

test('S5-2 every refusal writes NOTHING: no runs/ folder, no tree, no lock (a before/after snapshot of the working folder), through the real CLI', () => {
  const dir = work(); const before = snapshot(dir);
  const without = key => { const a = [...GOOD]; const i = a.indexOf(key); a.splice(i, 2); return a; };
  const swap = (key, value) => { const a = [...GOOD]; a[a.indexOf(key) + 1] = value; return a; };
  const cases = [
    [[], 2, /council tree start needs --task <file>: the task the root plan answers/],
    [without('--task'), 2, /needs --task <file>/], [without('--chain'), 2, /needs --chain <name>: the chain the root plan runs on/],
    [without('--child-chain'), 2, /council tree start needs --child-chain <name>: the chain every sub-plan runs on/], [without('--max-usd'), 2, /needs --max-usd <usd>: the cap of the whole tree/],
    [swap('--max-usd', 'none'), 2, /a tree needs a finite cap: --max-usd none is refused/], [swap('--max-usd', '0'), 2, /--max-usd needs a plain number of dollars above 0/],
    [swap('--max-usd', '-1'), 2, /--max-usd needs a plain number of dollars above 0/], [swap('--max-usd', 'abc'), 2, /--max-usd needs a plain number of dollars above 0/],
    [swap('--task', 'tasks/nope.md'), 1, /--task tasks\/nope\.md: no such task file/], [swap('--task', 'tasks'), 1, /no such task file/],
    [swap('--chain', 'no-such-chain'), 1, /--chain: the chain no-such-chain is not in/], [swap('--chain', '../x'), 1, /--chain: "..\/x" is not a chain name/],
    [swap('--child-chain', 'no-such-chain'), 1, /--child-chain: the chain no-such-chain is not in/],
  ];
  for (const [args, status, re] of cases) {
    const r = cliRun(dir, ['tree', 'start', ...args]);
    assert.equal(r.status, status, `${args.join(' ')}: ${r.stderr}`); assert.match(r.stderr, re, args.join(' '));
    assert.equal(snapshot(dir), before, `${args.join(' ')}: the working folder is unchanged`); assert.equal(existsSync(join(dir, 'runs')), false);
  }
});

test('S5-2b a task named like a secrets file is refused; a chain without handoff_contract.milestones is refused as root and as child, and the sentence lists the shipped chains that qualify (derived from chains/, not typed)', () => {
  const dir = work(); writeFileSync(join(dir, 'tasks', 'prod.env'), 'x\n'); const before = snapshot(dir);
  const env = cliRun(dir, ['tree', 'start', ...GOOD.map(a => (a === 'tasks/x.md' ? 'tasks/prod.env' : a))]);
  assert.equal(env.status, 1); assert.match(env.stderr, /a file of that name is never read/);
  const shipped = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).filter(f => JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')).handoff_contract?.milestones === true).map(f => f.slice(0, -5)).sort();
  assert.ok(shipped.length >= 2, 'the package ships chains that write milestones');
  for (const [key, who] of [['--chain', 'root'], ['--child-chain', 'child']]) {
    const a = [...GOOD]; a[a.indexOf(key) + 1] = 'mock';
    const r = cliRun(dir, ['tree', 'start', ...a]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, new RegExp(`the ${who} chain mock does not set handoff_contract\\.milestones to true: a tree built on it could never be ready; use a chain that does \\(for example ${shipped.join(', ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  }
  assert.equal(snapshot(dir), before); assert.equal(existsSync(join(dir, 'runs')), false);
});

test('S5-2c a seat with no price row (root or child chain) is refused under the cap, exit 5, before anything is written: the root run would refuse after the record existed and leave a root that can never start', () => {
  const dir = work();
  const unpriced = name => writeFileSync(join(dir, 'chains', `${name}.json`), JSON.stringify({ ...pricedDebate(), name, seats: { ...pricedDebate().seats, builder: { provider: 'openrouter', model: 'nobody/unpriced-model', maxTokens: 1000 } } }, null, 2));
  unpriced('unpriced-root'); unpriced('unpriced-kid'); const before = snapshot(dir);
  for (const [chain, child, shown] of [['unpriced-root', 'priced-debate', '--chain'], ['split-root', 'unpriced-kid', '--child-chain']]) {
    // a key is set so the check of the keys (which comes first, as in a normal run) passes and the price rows are the question
    const r = cliRun(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', chain, '--child-chain', child, '--max-usd', '5'], { OPENROUTER_API_KEY: 'placeholder-not-a-real-key' });
    const who = shown === '--chain' ? `the root chain ${chain}` : `the child chain ${child}`;
    assert.equal(r.status, 5, r.stderr); assert.match(r.stderr, new RegExp(`${who} cannot start:[\\s\\S]*COUNCIL-E002[\\s\\S]*nobody/unpriced-model`)); assert.equal(snapshot(dir), before, 'nothing was written'); assert.equal(existsSync(join(dir, 'runs')), false);
  }
});

test('S5-3 the sitting lock: held for the whole root run (a second holder gets RunLockedError; `tree resume` on the same tree starts nothing and writes nothing), released after the run and after a start that failed', async () => {
  const dir = work(); const d = io(); const seen = {};
  const startRun = async opts => {
    const rootDir = join(dir, 'runs', opts.runId);
    seen.lockFile = existsSync(join(rootDir, 'tree', SITTING_LOCK_FILE));
    try { acquireRunLock(join(rootDir, 'tree'), { file: SITTING_LOCK_FILE }); seen.second = 'acquired'; } catch (e) { seen.second = e instanceof RunLockedError ? 'locked' : String(e); }
    const eventsBefore = readTreeRecord(rootDir).events.length;
    const r = io(); let started = 0;
    const resumeCode = await DEFAULT_HANDLERS.resume({ rootDir, rootId: opts.runId, work: dir, stdout: r.stdout, stderr: r.stderr, deps: { startRun: async () => { started += 1; return { exitCode: 0 }; }, resumeRun: async () => { started += 1; return { exitCode: 0 }; } } });
    Object.assign(seen, { resumeCode, resumeErr: r.err(), started, eventsAfter: readTreeRecord(rootDir).events.length, eventsBefore });
    return { exitCode: 0 };
  };
  const code = await treeCommand(['start', ...GOOD], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun } }) } });
  assert.equal(code, 0, d.err());
  assert.equal(seen.lockFile, true, 'the lock file exists while the root runs'); assert.equal(seen.second, 'locked', 'a second holder is refused');
  assert.equal(seen.resumeCode, 1); assert.match(seen.resumeErr, /another sitting of this tree is running/); assert.equal(seen.started, 0, 'resume started nothing'); assert.equal(seen.eventsAfter, seen.eventsBefore, 'resume wrote nothing');
  const id = idOf(d.out()); assert.equal(existsSync(join(dir, 'runs', id, 'tree', SITTING_LOCK_FILE)), false, 'released after the run');
  // a start that fails after the records were written still releases the lock, and says the tree exists
  const dir2 = work(); const d2 = io();
  const bad = await treeCommand(['start', ...GOOD], { work: dir2, ...d2, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: async () => { throw new Error('boom'); } } }) } });
  assert.equal(bad, 1); assert.match(d2.err(), /the root run could not be started: boom\. Nothing was spent\. The tree \(\S+\) exists: fix the cause, then run: council tree resume \S+ \(it starts the root run\)/);
  const id2 = idOf(d2.out()); assert.equal(existsSync(join(dir2, 'runs', id2, 'tree', SITTING_LOCK_FILE)), false, 'released after a failed start');
});

test('S5-6 the root run\'s exit code passes through (0, 3, 4, 19 and any other), each with its own next step; a real paused root (an external seat) answers 3', async () => {
  for (const [exitCode, re] of [[3, /waits for an external answer.*council tree resume/s], [4, /stopped at its cap.*council tree status/s], [19, /refused to start the root run \(exit 19\)/], [7, /The root run did not start \(exit code 7; no run was made, nothing was spent\)\. Fix what the lines above say, then run: council tree resume \S+ \(it starts the root run\)\./]]) {
    const dir = work(); const d = io();
    const code = await treeCommand(['start', ...GOOD], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: async () => ({ exitCode }) } }) } });
    assert.equal(code, exitCode, d.err()); assert.match(d.out(), re, String(exitCode));
  }
  // an exit code with a run folder behind it (run.json exists) keeps the plain line: the run is resumable
  { const dir = work(); const d = io();
    const code = await treeCommand(['start', ...GOOD], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: async o => { mkdirSync(join(dir, 'runs', o.runId), { recursive: true }); writeFileSync(join(dir, 'runs', o.runId, 'run.json'), '{}'); return { exitCode: 7 }; } } }) } });
    assert.equal(code, 7); assert.match(d.out(), /The root run ended with exit code 7\. See: council tree status/); }
  // real: the root chain has an external builder, so the root run pauses (exit 3) and `tree resume` finds it active
  const dir = work(); const ext = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'ext-root.json'), JSON.stringify({ ...ext, name: 'ext-root', handoff_contract: { milestones: true } }, null, 2));
  const r = cliRun(dir, ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'ext-root', '--child-chain', 'priced-debate', '--max-usd', '5']);
  assert.equal(r.status, 3, r.stderr + r.stdout); assert.match(r.stdout, /waits for an external answer/);
  const id = idOf(r.stdout); const rec = readTreeRecord(join(dir, 'runs', id)); assert.equal(rec.events.some(e => e.event === 'node_started' && e.node === 'R'), true, 'the root was started as a member');
  // the printed next step is true: `tree resume` on that tree finds the root active and waiting, and starts no second run of it
  const res = cliRun(dir, ['tree', 'resume', id]);
  assert.equal(res.status, 3, res.stderr + res.stdout); assert.match(res.stdout, /waits for an external answer/);
  assert.equal(readTreeRecord(join(dir, 'runs', id)).events.filter(e => e.event === 'node_started' && e.node === 'R').length, 1, 'no second node_started for R');
});

test('S5-9 through the real CLI with no seam: `council tree start` makes the tree and runs the root (exit 0), the next step is named, and `tree status` reads it', () => {
  const dir = work();
  const r = cliRun(dir, ['tree', 'start', ...GOOD]);
  assert.equal(r.status, 0, r.stderr + r.stdout); const id = idOf(r.stdout); assert.ok(id, r.stdout);
  assert.match(r.stdout, new RegExp(`Next: council tree resume ${id}`));
  const s = cliRun(dir, ['tree', 'status', id]); assert.equal(s.status, 0, s.stderr); assert.match(s.stdout, new RegExp(id));
});

test('S5-5 `--spend` prints one line per tree after the table, only when a tree exists; with no tree the output has no such line', () => {
  const dir = work(); const none = cliRun(dir, ['--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '5']); assert.equal(none.status, 0, none.stderr);
  const plain = cliRun(dir, ['--spend']); assert.equal(plain.status, 0, plain.stderr); assert.doesNotMatch(plain.stdout, /^\s*tree \S+:/m, 'no tree, no tree line');
  const started = cliRun(dir, ['tree', 'start', ...GOOD]); assert.equal(started.status, 0, started.stderr); const id = idOf(started.stdout);
  const after = cliRun(dir, ['--spend']); assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, new RegExp(`^  tree ${id}: \\$[0-9.]+ across 1 run\\(s\\), already in the total$`, 'm'));
  const tableLines = s => s.split('\n').filter(l => /^\s+\d{4}-\d\d-\d\dT/.test(l)).map(l => l.replace(/\s+/g, ' ').trim());
  assert.deepEqual(tableLines(after.stdout).filter(l => !l.startsWith(id)), tableLines(plain.stdout), 'the table lines of the other runs are unchanged');
});
