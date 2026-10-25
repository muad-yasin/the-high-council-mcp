// `council tree resume` (0.8.3 M5c3; PLAN 8.3 steps 4-5, 12 rows 1 and 6; M5-DEFAULTS rows 2 and 3 and default 22; M5 exit check L18). All-mock, $0. The children run through api.run where a test says "real"; the
// others use an injected resumer so a deterministic failure can be repeated exactly. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { RunLockedError, acquireRunLock } from '../src/run-lock.js';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { topUp } from '../src/tree-budget.js';
import { registerNextChild } from '../src/tree-loop.js';
import { apiStarter, requestStop, runTree, stopRequested } from '../src/tree-run.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { SITTING_LOCK_FILE, resumeCountOf, resumeHandler, stoppedReasonsOf } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { externalChildren, pricedChildren } from './helpers/child-chains.js';
import { LEAF_PLAN, approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { GATE_FIELDS, ROOT_ID, claim, hostnameOf, syntheticRun } from './helpers/tree-fixture.js';

const io = () => { const o = []; const e = []; const stdout = new PassThrough(); const stderr = new PassThrough(); const stdin = new PassThrough(); stdout.on('data', d => o.push(String(d))); stderr.on('data', d => e.push(String(d))); return { stdout, stderr, stdin, out: () => o.join(''), err: () => e.join('') }; };
const resume = async (r, deps = {}, extra = {}) => { const d = io(); const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, ...d, deps, ...extra }); return { code, out: d.out(), err: d.err() }; };
const nothing = () => { throw new Error('must not be called'); };
/** A tree whose first child R/M1 is registered, started by hand (a claim by a process that is gone) and not ended: an interrupted ordinary execution. Its run folder carries a STOPPED-error.md with a reason. */
async function interrupted() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  const dir = syntheticRun(r.t, reg.runId, {});
  writeFileSync(join(dir, 'STOPPED-error.md'), '# The run failed\n\nsomething deterministic: the provider said no \u001b[31mred\u001b[0m \u202eevil\n');
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim('R/M1', reg.runId, 999991, 1, hostnameOf()) });
  return { r, reg, dir, facts: { pidAlive: () => false } };
}
/** What a member's own CLI does when it is resumed: writes its node_resumed claim, then fails (or not). */
const failingResumer = (r, reg, code = 1, log = []) => async args => { log.push(args); appendTreeEvent(r.t.rootDir, { event: 'node_resumed', purpose: 'resume', ...claim('R/M1', reg.runId, 999992, 1, hostnameOf()) }); return { exitCode: code, outputTail: 'x' }; };

test('L18 (real): a child paused at an external seat is waited for (exit 3, the NEEDS file named, nothing started and nothing resumed); once its answer file is in ITS run folder under the stage label, `tree resume` resumes that node as the same run, then the sitting goes on', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(externalChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
  assert.equal(first.status, 'waiting'); assert.deepEqual(first.needs, ['NEEDS-build.md']);
  const dir = join(r.t.runsDir, first.runId);
  assert.match(JSON.parse(readFileSync(join(dir, 'build.prompt.json'), 'utf8')).promptHash, /^[0-9a-f]{16}$/, 'the prompt the answer will be held to was written when the run paused');
  // no answer yet: the command names the file and starts and resumes nothing
  const w = await resume(r, { startRun: nothing, resumeRun: nothing });
  assert.equal(w.code, 3); assert.match(w.out, /R\/M1 \(run .*\) waits for an external answer[^]*NEEDS-build\.md[^]*council tree resume/);
  assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1']);
  // the answer, under its stage label, in the paused child's own folder
  writeFileSync(join(dir, 'build.md'), LEAF_PLAN);
  let resumed = 0;
  const real = (await import('../src/tree-resume.js')).apiResumer({ work: r.t.work });
  const res = await resume(r, { startRun: draftStarter(r), resumeRun: async a => { resumed += 1; assert.equal(a.runDir, dir, 'the answer continues THAT node'); return real(a); } });
  assert.equal(res.code, 0, res.out + res.err); assert.equal(resumed, 1); assert.match(res.out, /Resuming R\/M1 \(run .*\): resume number 1 of this node\./);
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'closed', 'R/M2': 'closed', 'R/M3': 'closed' });
  const ev = eventsOf(r);
  assert.equal(ev.filter(e => e.event === 'node_registered' && e.node === 'R/M1').length, 1, 'the same registration, no second run for R/M1');
  assert.equal(resumeCountOf(readTreeRecord(r.t.rootDir), 'R/M1', 1), 1);
  const claimEv = ev.find(e => e.event === 'node_resumed' && e.node === 'R/M1');
  assert.equal(claimEv.capAskedUsd, ev.find(e => e.event === 'node_registered' && e.node === 'R/M1').grant.amount, 'the resumed child asked for its grant as --max-usd, not the $7 default'); assert.equal(claimEv.capUsd, claimEv.capAskedUsd);
  const resumedAt = ev.findIndex(e => e.event === 'node_resumed' && e.node === 'R/M1');
  assert.ok(resumedAt >= 0 && resumedAt < ev.findIndex(e => e.event === 'node_closed' && e.node === 'R/M1') && ev.findIndex(e => e.event === 'node_closed' && e.node === 'R/M1') < ev.findIndex(e => e.event === 'node_registered' && e.node === 'R/M2'), 'R/M1 resumed and closed before any sibling was registered');
});

test('L18 (the answer is held to its prompt): an answer whose prompt.json hash is not the one the run asked is not used - the resume does not close the node - and the command says so; with the file put right it goes on', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(externalChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
  const dir = join(r.t.runsDir, first.runId);
  const promptFile = join(dir, 'build.prompt.json'); const good = readFileSync(promptFile, 'utf8');
  writeFileSync(promptFile, JSON.stringify({ ...JSON.parse(good), promptHash: '0000000000000000' }));
  writeFileSync(join(dir, 'build.md'), LEAF_PLAN);
  const bad = await resume(r, { startRun: nothing });
  assert.equal(bad.code, 3, bad.out + bad.err); assert.notEqual(phases(r)['R/M1'], 'closed');   // the run asked again: it pauses at the same stage, exit 3
  assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1'], 'no sibling started');
  assert.equal(existsSync(join(dir, 'build.md')), false, 'the answer to another prompt was set aside, not used');
  assert.equal(JSON.parse(readFileSync(promptFile, 'utf8')).promptHash, JSON.parse(good).promptHash, 'the prompt it asks now is the real one');
  writeFileSync(join(dir, 'build.md'), LEAF_PLAN);
  const ok = await resume(r, { startRun: draftStarter(r) });
  assert.equal(ok.code, 0, ok.out + ok.err); assert.equal(phases(r)['R/M1'], 'closed');
});

test('M5 row 2: ONE resume per command, never a loop on a deterministic failure: the resumer is called once, the count of this node\'s resumes (from the record) and the run folder\'s STOPPED-* contents are shown, nothing else starts, and the next command is the next attempt', async () => {
  const { r, reg, dir, facts } = await interrupted();
  assert.deepEqual(stoppedReasonsOf(dir).map(s => [s.name, /deterministic/.test(s.text)]), [['STOPPED-error.md', true]]);
  const log = [];
  const a = await resume(r, { startRun: nothing, resumeRun: failingResumer(r, reg, 1, log) }, { facts });
  assert.equal(a.code, 1); assert.equal(log.length, 1, 'one resume');
  assert.doesNotMatch(a.out + a.err, /[\u001b\u202e]/, 'run-folder text reaches the terminal without escape or bidi characters');
  assert.match(a.out, /Resuming R\/M1 \(run .*\): resume number 1 of this node\./); assert.match(a.out, /earlier: STOPPED-error\.md: # The run failed[^]*the provider said no/);
  assert.match(a.out, /Resume number 1 of R\/M1 ended with exit code 1\./); assert.match(a.out, /R\/M1 \(run .*\) ended with exit code 1 and no result\./);
  assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1'], 'no sibling was registered');
  const b = await resume(r, { startRun: nothing, resumeRun: failingResumer(r, reg, 1, log) }, { facts });
  assert.equal(log.length, 2, 'a second command is a second attempt, and only one'); assert.match(b.out, /resume number 2 of this node/);
  assert.equal(resumeCountOf(readTreeRecord(r.t.rootDir), 'R/M1', 1), 2);
  assert.equal(log[0].maxUsd, reg.grantUsd, 'the resumed run is held to the node\'s grant, passed explicitly (a resume without a cap would inherit run.json\'s first cap)');
});

test('the cap of a resume is the whole grant: the first grant plus every top-up, and a node stopped at its cap is resumed only after its grant was raised (the command says what to do otherwise)', async () => {
  const { r, reg, dir } = await interrupted();
  // the run stopped at its cap: node_stopped, no top-up yet
  appendTreeEvent(r.t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: reg.runId, reason: 'budget' });
  writeFileSync(join(dir, 'STOPPED-budget.json'), JSON.stringify({ reason: 'budget' }));
  const log = [];
  // an independent sibling still runs while R/M1 waits for a larger grant (a stopped node is not active)
  const none = await resume(r, { startRun: draftStarter(r), resumeRun: failingResumer(r, reg, 0, log) });
  assert.equal(log.length, 0, 'not resumed without a larger grant'); assert.match(none.out, /R\/M1 \(run .*\) stopped at its budget cap and is not resumed by this command: its grant must be raised first/); assert.equal(/later part of this build/.test(none.out), false, 'R10: --top-up exists, the text no longer says it arrives later');
  assert.equal(phases(r)['R/M3'], 'closed', 'the independent sibling ran'); assert.equal(phases(r)['R/M2'], undefined, 'the consumer of the stopped node waits');
  topUp(r.t.rootDir, { node: 'R/M1', generation: 1, amountUsd: 2, ...GATE_FIELDS });
  const some = await resume(r, { startRun: nothing, resumeRun: failingResumer(r, reg, 3, log) });
  assert.equal(log.length, 1, some.out + some.err); assert.equal(log[0].maxUsd, reg.grantUsd + 2, 'first grant + the top-up'); assert.equal(some.code, 3);
});

test('two `tree resume` at once: the second starts and resumes NOTHING and says another sitting runs, and it leaves a stop in place (it did not get as far as removing it); a stale lock of a dead process does not block', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  let release; const gate = new Promise(res => { release = res; });
  let inStart; const started = new Promise(res => { inStart = res; });
  let calls = 0;
  const first = resume(r, { startRun: async () => { calls += 1; inStart(); await gate; return { exitCode: 3 }; } });
  await started;
  requestStop(r.t.rootDir);
  const second = await resume(r, { startRun: nothing, resumeRun: nothing });
  assert.equal(second.code, 1); assert.match(second.err, /another sitting of this tree is running \(pid \d+/); assert.match(second.err, /Nothing was started\./);
  assert.equal(stopRequested(r.t.rootDir), true, 'the second command did not remove the stop');
  release(); await first;
  assert.equal(calls, 1); assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1']);
  assert.equal(existsSync(join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE)), false, 'the lock is released at the end');
  // a lock file left by a process that is gone is replaced
  writeFileSync(join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE), JSON.stringify({ pid: 999993, host: hostnameOf(), at: new Date().toISOString(), nonce: 'x' }));
  const third = await resume(r, { startRun: async () => ({ exitCode: 3 }), resumeRun: nothing });
  assert.notEqual(third.err.includes('another sitting'), true, third.err);
});

test('CR-X3-002 (real verb): an EMPTY .sitting.lock left by a take that died is refused while it is young (the file named, the wait said, nothing started, the stop left) and replaced once it is older than 30 seconds', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const lock = join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE);
  writeFileSync(lock, '');   // byte-identical to what a take killed between its create and its write leaves
  requestStop(r.t.rootDir);
  const young = await resume(r, { startRun: nothing, resumeRun: nothing });
  assert.equal(young.code, 1); assert.ok(young.err.includes(lock), young.err); assert.match(young.err, /is empty or half-written[^]*older than 30 seconds[^]*delete that file[^]*Nothing was started\./);
  assert.doesNotMatch(young.err, /pid null|another sitting of this tree is running/);
  assert.equal(stopRequested(r.t.rootDir), true, 'it did not get as far as removing the stop');
  const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);   // the one constructed part: the age
  const third = await resume(r, { startRun: async () => ({ exitCode: 3 }), resumeRun: nothing });
  assert.doesNotMatch(third.err, /empty or half-written|another sitting/, third.err);
  assert.equal(existsSync(lock), false, 'taken, used and released');
});

test('`tree resume` removes a stop first (the person asked to go on) and says so; the verb is wired in the CLI (treeCommand reaches the handler and its exit code), and it refuses a blocked or corrupt tree before it starts anything', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  requestStop(r.t.rootDir);
  const d = io(); let calls = 0;
  const handlers = { ...DEFAULT_HANDLERS, resume: ctx => resumeHandler({ ...ctx, deps: { startRun: async () => { calls += 1; return { exitCode: 3 }; } } }) };
  const code = await treeCommand(['resume', ROOT_ID], { work: r.t.work, handlers, stdout: d.stdout, stderr: d.stderr, stdin: d.stdin });
  assert.equal(code, 3); assert.equal(calls, 1); assert.match(d.out(), /The stop was removed\./); assert.equal(stopRequested(r.t.rootDir), false);
  // a sticky block (parent_changed) refuses before anything is started
  const b = await trackedRealRoot(pricedChildren()); approvePending(b);
  appendTreeEvent(b.t.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'tree', detail: 'test' });
  const blocked = await resume(b, { startRun: nothing, resumeRun: nothing });
  // R6: a block a person can act on exits 20 and the sitting text (stdout) says it, with the remedy; it used to be exit 1 with one line on stderr
  assert.equal(blocked.code, 20); assert.match(blocked.out, /The tree is blocked: parent_changed\. Nothing was started\./);
});

test('a node whose claim is alive in another process is not resumed (the command says so and starts nothing); the verb itself is wired in the CLI with its default handler (no "not built")', async () => {
  const { r, reg } = await interrupted();
  const alive = await resume(r, { startRun: nothing, resumeRun: nothing }, { facts: { pidAlive: () => true } });
  assert.equal(alive.code, 1); assert.match(alive.out, /R\/M1 \(run .*\) is running in another process\. Nothing was started\./);
  const fresh = await trackedRealRoot(pricedChildren());      // a tree with nothing approved: the real default handler answers, it does not say "not built"
  const d = io();
  const code = await treeCommand(['resume', ROOT_ID], { work: fresh.t.work, stdout: d.stdout, stderr: d.stderr, stdin: d.stdin });
  assert.equal(code, 20, 'a frontier waits for an approval: a human gate, not "done" (C&C 9 Oct)\n' + d.out() + d.err()); assert.doesNotMatch(d.err() + d.out(), /not built/); assert.match(d.out(), /Nothing could start\./);
  void reg;
});

test('a node that was topped up EARLIER and stopped again at the new cap is not resumed without a further top-up (the top-up must be newer than the latest stop)', async () => {
  const { r, reg, dir } = await interrupted();
  appendTreeEvent(r.t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: reg.runId, reason: 'budget' });
  topUp(r.t.rootDir, { node: 'R/M1', generation: 1, amountUsd: 2, ...GATE_FIELDS });
  appendTreeEvent(r.t.rootDir, { event: 'node_resumed', purpose: 'resume', ...claim('R/M1', reg.runId, 999994, 1, hostnameOf()) });
  appendTreeEvent(r.t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: reg.runId, reason: 'budget' });
  writeFileSync(join(dir, 'STOPPED-budget.json'), JSON.stringify({ reason: 'budget' }));
  const log = [];
  const none = await resume(r, { startRun: draftStarter(r), resumeRun: failingResumer(r, reg, 0, log) });
  assert.equal(log.length, 0); assert.match(none.out, /stopped at its budget cap and is not resumed by this command/);
});

test('the resume module reads no environment variable and no process argument and never spawns', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'src', 'tree-resume.js'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal(/process\.env|process\.argv|\bargv\b/.test(code), false); assert.equal(/\bspawn\b|execFile|child_process/.test(code), false);
});

void RunLockedError; void acquireRunLock; void stateOf;
