// test/resume-safety.test.js - 2026-09-23 audit item E, resume half (Review/BugAudit_CLI_
// 2026-09-23.md findings 4-6), end to end through the real CLI on the offline mock-external
// chain (it pauses at the external "build" stage, $0, no keys).
//   4. a resume while another process holds the run used to pay for every stage twice;
//   5. a resume from another directory used to start a fresh folder and re-pay;
//   6. a --max-usd given on resume was never saved to run.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_FILE } from '../src/run-lock.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function run(args, cwd) {
  try {
    return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH } }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// MCP start_run stores an absolute task path; that's the case finding 5 describes.
function pausedRun({ absoluteTask = false } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'thc-resume-'));
  mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'A test task.');
  const task = absoluteTask ? join(work, 'tasks', 'x.md') : 'tasks/x.md';
  const r = run(['--task', task, '--chain', 'mock-external', '--max-usd', '1'], work);
  const runs = readdirSync(join(work, 'runs'));
  assert.equal(runs.length, 1, r.out);
  const runDir = join(work, 'runs', runs[0]);
  assert.ok(readdirSync(runDir).some((f) => f.startsWith('NEEDS-')), `the run didn't pause:\n${r.out}`);
  assert.equal(existsSync(join(runDir, LOCK_FILE)), false, 'a paused run must release its lock on exit');
  return { work, runDir, id: runs[0] };
}

const stageLog = (runDir) => (existsSync(join(runDir, 'stage-log.jsonl')) ? readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8') : '');

test('4: a resume is refused while a live process holds the run, and nothing runs', async () => {
  const { work, runDir, id } = pausedRun();
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    writeFileSync(join(runDir, LOCK_FILE), JSON.stringify({ pid: holder.pid, host: hostname(), at: 'now' }));
    const before = stageLog(runDir);
    const r = run(['--resume', join('runs', id)], work);
    assert.equal(r.code, 13, r.out); // a locked run has its own exit code (bug audit 2026-09-23, CLI #7)
    assert.match(r.out, /already running/);
    assert.equal(stageLog(runDir), before, 'a stage ran although the run was locked');
  } finally {
    holder.kill();
  }
});

test('4: a lock left by a dead process does not block a resume', () => {
  const { work, runDir, id } = pausedRun();
  writeFileSync(join(runDir, LOCK_FILE), JSON.stringify({ pid: 2 ** 22 + 4321, host: hostname(), at: 'then' }));
  const r = run(['--resume', join('runs', id)], work);
  assert.doesNotMatch(r.out, /already running/, r.out);
  assert.ok(readdirSync(runDir).some((f) => f.startsWith('NEEDS-')), r.out);
});

test('5: resuming from another directory uses the run folder it was given', () => {
  const { runDir } = pausedRun({ absoluteTask: true });
  const elsewhere = mkdtempSync(join(tmpdir(), 'thc-resume-elsewhere-'));
  const r = run(['--resume', runDir], elsewhere);
  assert.equal(existsSync(join(elsewhere, 'runs')), false, `a fresh run folder was started elsewhere:\n${r.out}`);
  assert.match(r.out, /from disk/, 'completed stages should replay from disk');
});

test('6: a --max-usd given on resume is saved to run.json', () => {
  const { work, runDir, id } = pausedRun();
  assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).maxUsd, 1);
  run(['--resume', join('runs', id), '--max-usd', '3'], work);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).maxUsd, 3);
  run(['--resume', join('runs', id)], work);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).maxUsd, 3, 'a later resume without the flag must keep the saved cap');
  run(['--resume', join('runs', id), '--max-usd', 'none'], work);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).maxUsd, null);
});

// ---- 5, continued: where the task file is on resume ----

const patchRunJson = (runDir, fn) => {
  const p = join(runDir, 'run.json');
  const meta = JSON.parse(readFileSync(p, 'utf8'));
  fn(meta);
  writeFileSync(p, JSON.stringify(meta, null, 2));
};

test('5: a new run records its task as an absolute path plus the directory it started in', () => {
  const { work, runDir } = pausedRun();
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(meta.task, join(work, 'tasks', 'x.md'));
  assert.equal(meta.cwd, work);
});

test('5: an older run with a relative task path resumes from anywhere via its recorded cwd', () => {
  const { work, runDir } = pausedRun();
  patchRunJson(runDir, (m) => { m.task = 'tasks/x.md'; m.cwd = work; });
  const r = run(['--resume', runDir], mkdtempSync(join(tmpdir(), 'thc-resume-elsewhere-')));
  assert.match(r.out, /from disk/, r.out);
});

test('5: with no recorded cwd, a missing task fails clearly, and --task finds it', () => {
  const { work, runDir } = pausedRun();
  patchRunJson(runDir, (m) => { m.task = 'tasks/x.md'; delete m.cwd; });
  const elsewhere = mkdtempSync(join(tmpdir(), 'thc-resume-elsewhere-'));
  const lost = run(['--resume', runDir], elsewhere);
  assert.equal(lost.code, 1, lost.out);
  assert.match(lost.out, /tasks\/x\.md/);
  assert.match(lost.out, /--task/);
  const found = run(['--resume', runDir, '--task', join(work, 'tasks', 'x.md')], elsewhere);
  assert.match(found.out, /from disk/, found.out);
});

test('5: --task on resume cannot swap in a different task (the stored hash still decides)', () => {
  const { runDir } = pausedRun();
  const other = join(mkdtempSync(join(tmpdir(), 'thc-other-task-')), 'y.md');
  writeFileSync(other, 'A completely different task.');
  const before = stageLog(runDir);
  const r = run(['--resume', runDir, '--task', other], mkdtempSync(join(tmpdir(), 'thc-resume-elsewhere-')));
  assert.notEqual(r.code, 0, r.out);
  assert.equal(stageLog(runDir), before, 'a stage ran on a swapped task');
});
