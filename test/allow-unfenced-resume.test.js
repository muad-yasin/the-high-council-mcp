// --allow-unfenced across a resume (bug audit 2026-09-26 #1, 0.7.8). The waiver was read from the
// sitting's own argv only, and the artifact gate runs again on every resume, so a run started with
// it was blocked at exit 9 the first time it resumed without it - which is every MCP resume
// (resume_run and submit_stage cannot pass the flag). Worse, the resume deleted a capped run's
// STOPPED-budget.json, report-partial.json and BOARD-partial.md before the gate refused it.
// The waiver is now saved in run.json and applied on resume, and the markers are deleted only
// after the gate passes. All offline: mock chains, no key, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTIAL_REPORT_FILE, PARTIAL_BOARD_FILE } from '../src/report-shape.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const server = join(root, 'src', 'mcp', 'server.js');
const EXIT_ARTIFACTS_BLOCKED = 9;
const UNFENCED_TASK = 'Plan a change to src/app.js so it reads its port from the environment.\n';

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-unfenced-resume-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), UNFENCED_TASK);
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
const runJson = runDir => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
const waiting = runDir => readdirSync(runDir).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(runDir, f.slice('NEEDS-'.length)))).map(f => f.slice('NEEDS-'.length, -'.md'.length));

// mock-budget-rounds (as in test/report-partial.test.js): only the reviser is priced, so a $1 cap
// stops the run a round or two in, after the debate, with a partial report and board on disk.
function roundsChain() {
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  return {
    ...c, name: 'mock-budget-rounds', maxRounds: 4,
    seats: {
      ...c.seats,
      reviser: { provider: 'mock', model: 'mock-priced', maxTokens: 100 },
      critics: [
        { provider: 'mock', model: 'mock-critic-holdout', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-critic-holdout', lab: 'mock-b' },
      ],
    },
  };
}

test('the gate still blocks an unfenced task with no waiver (control)', () => {
  const dir = workDir();
  try {
    assert.equal(run(dir, ['--chain', 'mock', '--task', 'tasks/x.md']).status, EXIT_ARTIFACTS_BLOCKED);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scenario 1: a run started with --allow-unfenced resumes past its external pause without the flag', () => {
  const dir = workDir();
  try {
    const first = run(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md', '--allow-unfenced']);
    assert.equal(first.status, 3, `expected an external pause: ${first.stdout.slice(-300)}${first.stderr}`);
    const runDir = onlyRun(dir);
    assert.equal(runJson(runDir).allowUnfenced, true, 'the waiver is saved in run.json');
    const [stage] = waiting(runDir);
    writeFileSync(join(runDir, `${stage}.md`), '# Plan\n\nRead PORT from the environment, default 8080.\n');
    const resumed = run(dir, ['--resume', runDir]);
    assert.notEqual(resumed.status, EXIT_ARTIFACTS_BLOCKED, `the resume was blocked by the gate it was allowed past:\n${resumed.stdout.slice(-400)}`);
    assert.ok([0, 3].includes(resumed.status), `resume should pause again or finish, got ${resumed.status}: ${resumed.stderr}`);
    assert.ok(!existsSync(join(runDir, 'BLOCKED-ARTIFACTS.md')));
    assert.equal(runJson(runDir).allowUnfenced, true, 'still saved for the next sitting');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scenario 1, over MCP: submit_stage resumes such a run (it cannot pass --allow-unfenced)', async () => {
  const dir = workDir();
  try {
    assert.equal(run(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md', '--allow-unfenced']).status, 3);
    const runDir = onlyRun(dir);
    const runId = runDir.split(/[\\/]/).pop();
    const [stage] = waiting(runDir);
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'unfenced-resume-test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'submit_stage', arguments: { run: runId, stage, content: '# Plan\n\nRead PORT from the environment, default 8080.\n' } } },
    ];
    const r = spawnSync(process.execPath, [server], { cwd: dir, input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 90_000, env: { PATH: process.env.PATH } });
    const reply = (r.stdout || '').split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(m => m?.id === 2);
    const out = JSON.parse(reply?.result?.content?.[0]?.text ?? 'null');
    assert.equal(out?.resumed, true, `submit_stage did not resume the run: ${JSON.stringify(out)}`);
    // The resumed sitting is detached: wait for it to pause again or finish, never to be blocked.
    const t0 = Date.now();
    while (!(existsSync(join(runDir, 'report.json')) || existsSync(join(runDir, 'BLOCKED-ARTIFACTS.md'))
      || (!existsSync(join(runDir, '.council.lock')) && waiting(runDir).length))) {
      if (Date.now() - t0 > 60_000) throw new Error('timed out waiting for the resumed sitting');
      await new Promise(res => setTimeout(res, 100));
    }
    assert.ok(!existsSync(join(runDir, 'BLOCKED-ARTIFACTS.md')), 'the MCP resume was blocked by the artifact gate');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scenario 2: a capped run whose resume the gate blocks keeps its STOPPED marker, partial report and board', () => {
  const dir = workDir();
  try {
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'chains', 'mock-budget-rounds.json'), JSON.stringify(roundsChain(), null, 2));
    const first = run(dir, ['--chain', 'mock-budget-rounds', '--task', 'tasks/x.md', '--allow-unfenced', '--max-usd', '1']);
    assert.equal(first.status, 4, `expected a spend-cap stop: ${first.stdout.slice(-300)}${first.stderr}`);
    const runDir = onlyRun(dir);
    const kept = ['STOPPED-budget.json', PARTIAL_REPORT_FILE, PARTIAL_BOARD_FILE];
    for (const f of kept) assert.ok(existsSync(join(runDir, f)), `${f} written at the stop`);
    // A run saved before 0.7.8 has no waiver in run.json; resuming it without the flag is the
    // audit's exact path. The gate blocks it (exit 9, nothing spent) and the stopped run's record
    // must still be there afterwards.
    const meta = runJson(runDir);
    delete meta.allowUnfenced;
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(meta, null, 2));
    const blocked = run(dir, ['--resume', runDir, '--max-usd', 'none']);
    assert.equal(blocked.status, EXIT_ARTIFACTS_BLOCKED);
    for (const f of kept) assert.ok(existsSync(join(runDir, f)), `${f} was deleted by a resume the gate refused`);
    // Given the waiver on this resume, it goes on, finishes, and the stop's record makes way for report.json.
    const resumed = run(dir, ['--resume', runDir, '--max-usd', 'none', '--allow-unfenced']);
    assert.equal(resumed.status, 0, `${resumed.stdout.slice(-400)}${resumed.stderr}`);
    for (const f of kept) assert.ok(!existsSync(join(runDir, f)), `${f} must not outlive the stop it describes`);
    assert.ok(existsSync(join(runDir, 'report.json')));
    assert.equal(runJson(runDir).allowUnfenced, true, 'a waiver given on a resume is saved too');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a narrower --allow-unfenced <files> on resume replaces the saved whole-gate waiver', () => {
  const dir = workDir();
  try {
    assert.equal(run(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md', '--allow-unfenced']).status, 3);
    const runDir = onlyRun(dir);
    const r = run(dir, ['--resume', runDir, '--allow-unfenced', 'src/other.js']);
    assert.equal(r.status, EXIT_ARTIFACTS_BLOCKED, 'app.js is no longer waived');
    const meta = runJson(runDir);
    assert.equal(meta.allowUnfenced, undefined);
    assert.deepEqual(meta.unfencedAllowList, ['src/other.js']);
    // A file list is saved and applied on the next flagless resume the same way. (The gate reports and
    // matches the file name the task's prose names as a token, `app.js` here, not `src/app.js`.)
    assert.equal(run(dir, ['--resume', runDir, '--allow-unfenced', 'app.js']).status, 3, 'back to the external pause');
    assert.deepEqual(runJson(runDir).unfencedAllowList, ['app.js']);
    assert.equal(run(dir, ['--resume', runDir]).status, 3, 'the saved list waives app.js without the flag');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
