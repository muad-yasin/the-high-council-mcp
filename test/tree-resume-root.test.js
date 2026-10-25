// `council tree resume` starts a root run that was never started (0.8.3 M6 closing; contract Review/Build_0.8.3/m6-closing/C_Resume_Starts_Unstarted_Root_Contract.md). Three window states of an interrupted `council tree start`:
//   S1 tree.json only          S2 tree_started, no root registered          S3 root registered, its run never started (its own CLI refused it before the run folder was made)
// All $0: the root starter is a stub that records its options, except the one test that runs the real api.run on a mock chain. Every working folder is a temp folder, removed at the end of the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { everySeatOf, resolveChainSeats } from '../src/chain.js';
import { missingKeyLines } from '../src/run-preflight.js';
import { configSha256 } from '../src/tree-continuation.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { createHash } from 'node:crypto';
import { DEFAULT_LIMITS, EVENTS_FILE, createTreeFile, readTreeRecord, startTree, treeDirOf } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { makeRootTaskPin } from '../src/tree-task-pin.js';
import { resumeHandler } from '../src/tree-resume.js';
import { GATE_FIELDS, installSplitRoot, root } from './helpers/tree-fixture.js';
import { amendCap } from '../src/tree-budget.js';
import { withTreeLock } from '../src/tree-record.js';
import { pricedDebate } from './helpers/child-chains.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const ID = '2026-10-12T10-00-00-000Z';
const io = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin: new PassThrough(), stdout, stderr, out: () => o, err: () => e }; };
const GOOD = ['--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5'];

/** A fresh working folder with a task, the split-root chain and the child chain. */
function work() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-c-resume-root-')); made.push(dir);
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  installSplitRoot(dir);
  writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  return dir;
}
const chainsOf = dir => [['split-root', 0], ['priced-debate', 1], ['priced-debate', 2]].map(([name, depth]) => ({ depth, name, sha256: configSha256(join(dir, 'chains', `${name}.json`)) }));
/** An interrupted `tree start`, in the state asked for: 's1' tree.json only, 's2' + tree_started, 's3' + the root registered (and its lineage file). `spec` adds/overrides tree.json fields (rootTask: null leaves the pin out). */
function interrupted(state, spec = {}) {
  const dir = work(); const rootDir = join(dir, 'runs', ID);
  const { rootTask = makeRootTaskPin(join(dir, 'tasks', 'x.md'), dir), ...rest } = spec;
  const args = { rootCapUsd: 5, chains: chainsOf(dir), ...(rootTask === null ? {} : { rootTask }), ...rest };
  if (state === 's1') createTreeFile(rootDir, args); else startTree(rootDir, args);
  if (state === 's3') { mkdirSync(join(rootDir, 'tree', 'inputs', 'R@g1'), { recursive: true }); writeFileSync(join(rootDir, 'tree', 'inputs', 'R@g1', 'node.json'), `${JSON.stringify(lineageOf(ID), null, 2)}\n`); registerRoot(rootDir); }
  return { dir, rootDir };
}
const lineageOf = id => ({ treeId: id, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0, splitSha256: null, bundleSha256: null });
/** A root starter that records its options and answers `exitCode` (the root's own exit code). It writes no run folder, like a root whose CLI refused. */
const recorder = (exitCode = 3, calls = []) => Object.assign(async opts => { calls.push(opts); return { exitCode }; }, { calls });
const forbidden = () => { throw new Error('the sitting must not start or resume a node here'); };
const resume = async (t, deps) => { const d = io(); const code = await treeCommand(['resume', ID], { work: t.dir, ...d, handlers: { ...DEFAULT_HANDLERS, resume: ctx => resumeHandler({ ...ctx, deps }) } }); return { code, out: d.out(), err: d.err() }; };
const registrations = t => readTreeRecord(t.rootDir).events.filter(e => e.event === 'node_registered');
const strip = o => { const { onOutput, ...rest } = o; assert.equal(typeof onOutput, 'function', 'onOutput is handed over'); return JSON.parse(JSON.stringify(rest).split(o.cwd).join('<WORK>')); };
const lineageFile = t => join(t.rootDir, 'tree', 'inputs', 'R@g1', 'node.json');

/** What a root's start must be, every time: the starter's options and the record. */
function assertRootStarted(t, calls, { piiGate } = {}) {
  assert.equal(calls.length, 1, 'the root starter is called once');
  const o = calls[0];
  assert.deepEqual(strip(o), { chain: 'split-root', task: join(t.dir, 'tasks', 'x.md').split(t.dir).join('<WORK>'), cwd: '<WORK>', runId: ID, treeNode: lineageFile(t).split(t.dir).join('<WORK>'), maxUsd: 5, ...(piiGate ? { piiGate } : {}) });
  const rec = readTreeRecord(t.rootDir); const names = rec.events.map(e => e.event);
  assert.equal(names[0], 'tree_started'); assert.equal(rec.corrupt.length, 0);
  const reg = rec.events.filter(e => e.event === 'node_registered'); assert.equal(reg.length, 1, 'ONE node_registered');
  assert.deepEqual([reg[0].node, reg[0].generation, reg[0].runId, reg[0].grant], ['R', 1, ID, { amount: 5, unit: 'usd' }], 'grant == the cap'); assert.equal(names.includes('grant_issued'), false);
  assert.deepEqual(JSON.parse(readFileSync(lineageFile(t), 'utf8')), lineageOf(ID));
}

test('T1 S1 (tree.json only): resume completes tree_started, registers the root and starts it from the pin with the options `tree start` passes; the real api.run runs it and the sitting goes on', { timeout: 120_000 }, async () => {
  const t = interrupted('s1');
  assert.equal(readTreeRecord(t.rootDir).events.length, 0, 'the window: tree.json and no event');
  const calls = [];
  const res = await resume(t, { startRootRun: opts => { calls.push(opts); return api.run({ ...opts, draft: 'plan.md', rounds: 1 }); }, startRun: forbidden, resumeRun: forbidden });
  assert.match(res.out, /Starting the root plan of tree \S+ on split-root \(task .*tasks\/x\.md\): up to \$5\.00, the cap now in force for this tree\./, res.out + res.err);
  assertRootStarted(t, calls);
  const names = readTreeRecord(t.rootDir).events.map(e => e.event);
  assert.ok(names.includes('node_started') && names.includes('node_closed'), `the root ran as a member: ${names.join(', ')}`);
  assert.ok(existsSync(join(t.rootDir, 'run.json')));
  assert.equal(res.code, 20, `the sitting went on after the root (its split waits for approval): ${res.out}${res.err}`); assert.match(res.out, /council tree approve/);
  assert.equal(res.err, '');
});

test('T2 S2 (tree_started, no root registered): the same starter call, ONE node_registered', async () => {
  const t = interrupted('s2'); const starter = recorder(3);
  const res = await resume(t, { startRootRun: starter, startRun: forbidden, resumeRun: forbidden });
  assert.equal(res.code, 3, res.out + res.err); assertRootStarted(t, starter.calls);
});

test('T3 S3 (root registered, its run never started): the same starter call and NO second node_registered; a root whose start is refused leaves S3 and the next resume starts it again', async () => {
  const t = interrupted('s3'); assert.equal(registrations(t).length, 1);
  const first = recorder(5);
  const a = await resume(t, { startRootRun: first, startRun: forbidden, resumeRun: forbidden });
  assert.equal(a.code, 1, 'a refused root: exit 1'); assertRootStarted(t, first.calls); assert.doesNotMatch(a.err, /could not be written/, 'the two views were written (inside tree/)');
  assert.match(a.err, /the root run of tree \S+ ended with exit code 5 \(no run was made, nothing was spent\)\. Fix what the lines above say, then run: council tree resume \S+/);
  assert.deepEqual(readdirSync(join(t.dir, 'runs', ID)), ['tree'], 'nothing but tree/ in the root folder: startable again');
  const second = recorder(3);
  const b = await resume(t, { startRootRun: second, startRun: forbidden, resumeRun: forbidden });
  assert.equal(b.code, 3, b.out + b.err); assertRootStarted(t, second.calls);
});

test('T4 equivalence: the root `tree resume` starts from a hand-built S2 is the root `tree start` starts: options, lineage bytes, the node_registered event, PII mode (once with the tree\'s own piiGate, which the starter receives)', async () => {
  for (const piiGate of [undefined, 'warn']) {
    // `tree start` with a capturing starter
    const dirA = work(); const startCalls = []; const d = io();
    const code = await treeCommand(['start', ...GOOD, ...(piiGate ? ['--pii-gate', piiGate] : [])], { work: dirA, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: recorder(3, startCalls), newRunId: () => ID } }) } });
    assert.equal(code, 3, d.err() + d.out());
    const A = { dir: dirA, rootDir: join(dirA, 'runs', ID) };
    // `tree resume` from an S2 built by hand with the same inputs
    // CHANGED ACCEPTED TEST (PII warn by default, 18 Okt 2026). OLD: a `tree start` without --pii-gate recorded no mode, so the equivalent hand-built S2 carried none and the starter received none. NEW: `tree start` without the flag records `warn` (flag, else COUNCIL_PII_GATE, else warn), so the equivalent S2 carries warn and the starter receives it. WHY: owner via the caps session: "Warn by default sounds very good and very user friendly."; C&C: the tree record learns the mode at start.
    // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026). OLD: a tree started with no --pii-gate was 'warn' (the hand-built S2 fell back to 'warn'). NEW: 'hard-stop'. WHY: f1fc915 (19 Okt, PII stop unit) records 'hard-stop' when none is typed; Muad 18 Okt 16:45 (FOCUS-detail): "'the run goes on' Giant no ... the warning has to stop the plan from running". The same change is already marked in test/tree-start-piigate.test.js:106 and test/tree-whole-mock.test.js:76.
    const B = interrupted('s2', { piiGate: piiGate ?? 'hard-stop' }); const resumeCalls = recorder(3);
    const res = await resume(B, { startRootRun: resumeCalls, startRun: forbidden, resumeRun: forbidden });
    assert.equal(res.code, 3, res.out + res.err);
    assert.equal(startCalls.length, 1); assert.equal(resumeCalls.calls.length, 1);
    assert.deepEqual(strip(resumeCalls.calls[0]), strip(startCalls[0]), 'the same options (minus onOutput; the working folder normalised)');
    assert.equal(resumeCalls.calls[0].piiGate, piiGate ?? 'hard-stop', 'the tree\'s own PII mode (hard-stop when none was typed) reaches the root starter');
    assert.equal(readFileSync(lineageFile(B), 'utf8'), readFileSync(lineageFile(A), 'utf8'), 'the lineage file, byte for byte');
    const shape = t => registrations(t).map(({ id, at, ...rest }) => rest);
    assert.deepEqual(shape(B), shape(A), 'the node_registered event (minus id and time)');
    assert.deepEqual(readTreeRecord(B.rootDir).events.map(e => e.event), readTreeRecord(A.rootDir).events.map(e => e.event).filter(e => e !== 'node_started'));
  }
});

test('T5 no pin (a tree.json written before the pin): a plain sentence, exit 1, the starter is not called, no node_registered', async () => {
  const t = interrupted('s2', { rootTask: null }); const starter = recorder(0);
  const res = await resume(t, { startRootRun: starter, startRun: forbidden, resumeRun: forbidden });
  assert.equal(res.code, 1); assert.equal(starter.calls.length, 0);
  assert.match(res.err, /council tree resume: the root run of tree \S+ never started, and this tree was started before its task was recorded in it[^]*Nothing was started or spent\. Start a new tree with council tree start\./);
  assert.equal(registrations(t).length, 0); assert.equal(res.out, '');
  assert.doesNotMatch(res.err, /\n\s+at /, 'no stack trace');
  assert.equal(existsSync(join(t.rootDir, 'run.json')), false);
});

test('T6 the task file or the root chain file changed or is gone: a sentence naming the cause, nothing started, nothing registered', async () => {
  const cases = [
    ['task changed', t => writeFileSync(join(t.dir, 'tasks', 'x.md'), 'A different task.\n'), /has changed since the tree was started/],
    ['task gone', t => rmSync(join(t.dir, 'tasks', 'x.md')), /cannot be read/],
    ['chain changed', t => writeFileSync(join(t.dir, 'chains', 'split-root.json'), `${readFileSync(join(t.dir, 'chains', 'split-root.json'), 'utf8')}\n`), /has changed since the tree was started \(its hash differs/],
    ['chain gone', t => rmSync(join(t.dir, 'chains', 'split-root.json')), /the root chain split-root cannot be used/],
  ];
  for (const [name, spoil, re] of cases) {
    const t = interrupted('s2'); spoil(t); const starter = recorder(0);
    const res = await resume(t, { startRootRun: starter, startRun: forbidden, resumeRun: forbidden });
    assert.equal(res.code, 1, name); assert.equal(starter.calls.length, 0, name); assert.match(res.err, re, name); assert.match(res.err, /Nothing was started or spent\./, name);
    assert.equal(registrations(t).length, 0, name); assert.doesNotMatch(res.err, /\n\s+at /, name);
  }
});

test('T7 an unusable personal-data mode fails closed: a plain sentence, the starter is not called (the fixture writes tree.json by hand with a matching tree_started hash: editing tree.json alone is a corrupt record, not this branch)', async () => {
  // the record by hand: tree.json with a mode the reader cannot use, and a tree_started that carries ITS hash
  const hash = text => createHash('sha256').update(text).digest('hex');
  const dir = work(); const rootDir = join(dir, 'runs', ID); mkdirSync(join(rootDir, 'tree'), { recursive: true });
  const tree = { schema: 'tree/1', treeId: ID, rootCapUsd: 5, chains: chainsOf(dir), rootTask: makeRootTaskPin(join(dir, 'tasks', 'x.md'), dir), limits: { ...DEFAULT_LIMITS }, piiGate: 'off', createdAt: new Date(0).toISOString() };
  const text = JSON.stringify(tree, null, 2);
  writeFileSync(join(rootDir, 'tree', 'tree.json'), text);
  writeFileSync(join(rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: 'tree-events/1', id: 'e1', event: 'tree_started', at: new Date(0).toISOString(), treeId: ID, treeJsonSha256: hash(text) })}\n`);
  const rec = readTreeRecord(rootDir); assert.equal(rec.corrupt.length, 0, `the hand-built record reads as sound: ${JSON.stringify(rec.corrupt)}`);
  const starter = recorder(0); const d = io();
  const code = await treeCommand(['resume', ID], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, resume: ctx => resumeHandler({ ...ctx, deps: { startRootRun: starter, startRun: forbidden, resumeRun: forbidden } }) } });
  assert.equal(code, 1, d.err()); assert.equal(starter.calls.length, 0);
  assert.match(d.err(), /the root run of tree \S+ cannot be started: its personal-data mode cannot be read \(piiGate must be exactly "warn" or "hard-stop", not "off"\), and a tree never runs with the check off by accident\. Nothing was started or spent\./);
  assert.equal(readTreeRecord(rootDir).events.filter(e => e.event === 'node_registered').length, 0);
});

test('T8 the root\'s exit code in resume\'s own set: 3 -> 3, 4 -> 4, 19 -> 19, any other (7) -> 1 naming the root\'s code, a starter that throws -> 1; the cap is said before the launch', async () => {
  for (const [exitCode, want, re] of [[3, 3, /R \(run \S+\) waits for an external answer/], [4, 4, /R \(run \S+\) stopped at its budget cap/], [19, 19, /The tree refused to start or resume R \(run \S+\) \(exit 19\)/]]) {
    const t = interrupted('s2'); const starter = recorder(exitCode);
    const res = await resume(t, { startRootRun: starter, startRun: forbidden, resumeRun: forbidden });
    assert.equal(res.code, want, res.out + res.err); assert.match(res.out, re, String(exitCode));
    assert.match(res.out.split('\n')[0], /^Starting the root plan of tree \S+ on split-root \(task \S+\): up to \$5\.00, the cap now in force for this tree\.$/, 'the cap comes first');
  }
  { const t = interrupted('s2'); const res = await resume(t, { startRootRun: recorder(7), startRun: forbidden, resumeRun: forbidden });
    assert.equal(res.code, 1); assert.match(res.err, /the root run of tree \S+ ended with exit code 7 \(no run was made, nothing was spent\)\. Fix what the lines above say, then run: council tree resume \S+/); }
  { const t = interrupted('s2'); const res = await resume(t, { startRootRun: async () => { throw new Error('boom\nsecond line'); }, startRun: forbidden, resumeRun: forbidden });
    assert.equal(res.code, 1); assert.match(res.err, /the root run could not be started: boom\. Nothing was spent\. Fix the cause, then run: council tree resume \S+/); assert.doesNotMatch(res.err, /second line/); }
  // a root that is already started is not started a second time: resume goes to its ordinary route
  { const t = interrupted('s3'); mkdirSync(join(t.dir, 'runs', ID), { recursive: true }); writeFileSync(join(t.dir, 'runs', ID, 'run.json'), '{}');
    const starter = recorder(0); await resume(t, { startRootRun: starter, startRun: async () => ({ exitCode: 1 }), resumeRun: async () => ({ exitCode: 1 }) }).catch(() => {});
    assert.equal(starter.calls.length, 0, 'the root starter is not used once run.json exists'); }
});

test('T8b the REAL starter (api.run, the shipped chain verify, no key in the environment, $0): the root\'s own CLI refuses at exit 5 before its folder is made, the tree stays at S3 with nothing but tree/ in the root folder, no node_started is claimed, and the next resume starts it again', { timeout: 120_000 }, async () => {
  const saved = {};
  for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET/i.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    const dir = work(); const rootDir = join(dir, 'runs', ID);
    const verify = { depth: 0, name: 'verify', sha256: configSha256(join(root, 'chains', 'verify.json')) };
    startTree(rootDir, { rootCapUsd: 5, chains: [0, 1, 2].map(depth => ({ ...verify, depth })), rootTask: makeRootTaskPin(join(dir, 'tasks', 'x.md'), dir) });
    mkdirSync(join(rootDir, 'tree', 'inputs', 'R@g1'), { recursive: true }); writeFileSync(join(rootDir, 'tree', 'inputs', 'R@g1', 'node.json'), `${JSON.stringify(lineageOf(ID), null, 2)}\n`); registerRoot(rootDir);
    // fail closed: this test may never spend. The run's own reader of keys must say that EVERY seat of the chain lacks one (the scrub above removes key-like names; a key from anywhere else fails the test before any call)
    const config = resolveChainSeats({ ...JSON.parse(readFileSync(join(root, 'chains', 'verify.json'), 'utf8')), name: 'verify' });
    const seats = everySeatOf(config);
    assert.ok(seats.length > 0 && missingKeyLines(config, seats), 'the verify chain must be missing a key here, or this test could spend money');
    for (const seat of seats) assert.ok(missingKeyLines(config, [seat]), `no key may be found for ${seat.provider}`);
    let launches = 0;
    for (const attempt of [1, 2]) {
      const d = io();
      const code = await treeCommand(['resume', ID], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, resume: ctx => resumeHandler({ ...ctx, deps: { startRootRun: opts => { launches += 1; return api.run(opts); }, startRun: forbidden, resumeRun: forbidden } }) } });
      assert.equal(code, 1, `attempt ${attempt}: ${d.out()}${d.err()}`); assert.equal(launches, attempt);
      assert.match(d.err(), /the root run of tree \S+ ended with exit code 5 \(no run was made, nothing was spent\)\. Fix what the lines above say, then run: council tree resume/);
      assert.doesNotMatch(d.err(), /could not be written/);
      assert.deepEqual(readdirSync(join(dir, 'runs', ID)), ['tree'], `attempt ${attempt}: the root folder holds nothing but tree/`);
      const rec = readTreeRecord(rootDir); assert.deepEqual(rec.events.map(e => e.event), ['tree_started', 'node_registered'], 'no claim was written, no second registration');
    }
  } finally { Object.assign(process.env, saved); }
});

// E54 (M7 text apply, B0 finding; C&C ruling 18 Okt 2026): `--amend-cap` is accepted in S2 (tree_started, root not registered) and, upward only, in S3 (the root's recorded grant is committed, so a lower total is refused);
// before this fix the root's grant (registerRoot) and its start (beginRoot: announce + maxUsd) read tree.json's STARTING cap, so a total the person had withdrawn at $2 still granted and ran the root at $5. The root now
// starts at its own bound: the cap in force in S2, min(recorded grant, cap in force) in S3. Offline, $0: the root starter is the recorder stub.
const amend = (t, toCapUsd) => amendCap(t.rootDir, { toCapUsd, expectedRevision: 1, ...GATE_FIELDS });
const announced = res => res.out.split('\n')[0];

test('T9 S2 amended DOWN before the root starts: the root is granted AND started at the cap in force ($2), never the starting cap ($5); the announce line says so', async () => {
  const t = interrupted('s2'); amend(t, 2);
  const calls = []; const starter = recorder(3, calls);
  const res = await resume(t, { startRootRun: starter, startRun: forbidden, resumeRun: forbidden });
  assert.equal(calls.length, 1, 'the root starter is called once'); assert.equal(calls[0].maxUsd, 2, 'the root run is started with the cap in force');
  assert.deepEqual(registrations(t).map(e => e.grant), [{ amount: 2, unit: 'usd' }], 'the root is granted the cap in force');
  assert.match(announced(res), /^Starting the root plan of tree \S+ on split-root \(task \S+\): up to \$2\.00, the cap now in force for this tree\.$/, res.out + res.err);
});

test('T10 S2 amended UP before the root starts: grant and maxUsd follow the cap in force ($8)', async () => {
  const t = interrupted('s2'); amend(t, 8);
  const calls = []; const res = await resume(t, { startRootRun: recorder(3, calls), startRun: forbidden, resumeRun: forbidden });
  assert.equal(calls[0].maxUsd, 8); assert.deepEqual(registrations(t).map(e => e.grant), [{ amount: 8, unit: 'usd' }]);
  assert.match(announced(res), /up to \$8\.00, the cap now in force for this tree\.$/);
});

test('T11 S3 (root registered at $5) amended UP to $8: the recorded grant still bounds the root, so it is started and announced at $5 and the sentence names both figures; amended DOWN is refused (control)', async () => {
  const down = interrupted('s3');
  assert.throws(() => amend(down, 2), /below the .*already committed/, 'the root\'s held grant is committed: a lower total is refused');
  const t = interrupted('s3'); amend(t, 8);
  const calls = []; const res = await resume(t, { startRootRun: recorder(3, calls), startRun: forbidden, resumeRun: forbidden });
  assert.equal(calls[0].maxUsd, 5, 'the root can spend only what it was granted'); assert.equal(registrations(t).length, 1, 'no second node_registered');
  assert.match(announced(res), /up to \$5\.00, the grant already recorded for the root plan \(the cap now in force for the whole tree is \$8\.00\)\.$/, res.out + res.err);
});

test('T12 fail closed: a cap_amended line that does not read as a positive number is a corrupt record; the sitting registers nothing, grants nothing and starts nothing (no NaN, 0 or negative grant)', async () => {
  for (const bad of ['x', 0, -3, null, 'NaN']) {
    const t = interrupted('s2');
    appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: 'tree-events/1', id: 'e2', event: 'cap_amended', fromCapUsd: 5, toCapUsd: bad, expectedRevision: 1, ...GATE_FIELDS, at: new Date().toISOString() })}\n`);
    const calls = []; const res = await resume(t, { startRootRun: recorder(3, calls), startRun: forbidden, resumeRun: forbidden });
    assert.equal(calls.length, 0, `toCapUsd ${JSON.stringify(bad)}: the root is not started`); assert.equal(registrations(t).length, 0, `toCapUsd ${JSON.stringify(bad)}: nothing is registered or granted`);
    assert.notEqual(res.code, 0, `toCapUsd ${JSON.stringify(bad)}: a refusal, not a success`);
  }
});

test('T13 registerRoot itself fails closed: a corrupt cap_amended (not a positive number) throws and writes no node_registered, whatever the caller checked before', () => {
  for (const bad of ['x', 0, -3, null]) {
    const t = interrupted('s2');
    appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: 'tree-events/1', id: 'e2', event: 'cap_amended', fromCapUsd: 5, toCapUsd: bad, expectedRevision: 1, ...GATE_FIELDS, at: new Date().toISOString() })}\n`);
    assert.throws(() => registerRoot(t.rootDir), /does not read as a positive number of dollars/, `toCapUsd ${JSON.stringify(bad)}`);
    assert.equal(registrations(t).length, 0, 'nothing granted');
  }
});

test('T14 registerRoot reads the cap in force and appends in ONE hold of the tree lock (a source pin: `tree decide --amend-cap` takes no sitting lock, so a read outside the hold could grant a cap withdrawn a moment earlier); called while the lock is held it is refused and registers nothing', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'tree-register.js'), 'utf8');
  const body = src.slice(src.indexOf('export function registerRoot('), src.indexOf('export function registerChildUnchecked') > 0 ? src.indexOf('UNCHECKED registration') : undefined);
  assert.match(body, /withTreeLock\(rootDir, \(\) => \{[\s\S]*readTreeRecord\(rootDir\)[\s\S]*effectiveCapUsd\(record\)[\s\S]*appendTreeEventLocked\(rootDir/, 'read, cap and append sit inside one withTreeLock callback');
  assert.doesNotMatch(body, /[^.]appendTreeEvent\(/, 'no append that takes the lock on its own');
  const t = interrupted('s2');
  withTreeLock(t.rootDir, () => { assert.throws(() => registerRoot(t.rootDir), /already running|holds/, 'registerRoot takes the tree lock itself'); });
  assert.equal(registrations(t).length, 0);
});
