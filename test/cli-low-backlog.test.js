// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md #8 and backlog).
// Real CLI invocations against offline mock chains: no keys, no network, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_FILE } from '../src/run-lock.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-low-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'A plain task.\n');
  return { dir, run: args => spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }) };
}

test('--resume of a finished run is refused (exit 15): nothing re-runs, report.json is untouched', () => {
  const { dir, run } = workspace();
  try {
    assert.equal(run(['--chain', 'mock', '--task', 'tasks/t.md']).status, 0);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const before = readFileSync(join(runDir, 'report.json'), 'utf8');
    const mtime = statSync(join(runDir, 'report.json')).mtimeMs;
    const lockOf = () => existsSync(join(runDir, LOCK_FILE)) ? readFileSync(join(runDir, LOCK_FILE), 'utf8') : null;
    const lockBefore = lockOf();
    const r = run(['--resume', runDir]);
    assert.equal(r.status, 15, r.stderr.slice(-300));
    assert.match(r.stderr, /already finished/);
    assert.equal(readFileSync(join(runDir, 'report.json'), 'utf8'), before);
    assert.equal(statSync(join(runDir, 'report.json')).mtimeMs, mtime);
    assert.equal(lockOf(), lockBefore, 'a refused resume takes no lock');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a flag that needs a value but has none is a usage error, not a raw TypeError', () => {
  const { dir, run } = workspace();
  try {
    for (const args of [['--task'], ['--resume'], ['--chain'], ['--task', 'tasks/t.md', '--draft'], ['--task', 'tasks/t.md', '--context'], ['--task', 'tasks/t.md', '--from-run']]) {
      const r = run(args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr.slice(-200)}`);
      assert.match(r.stderr, /needs a value/);
      assert.doesNotMatch(r.stderr, /TypeError/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stage files are written whole, and a torn usage file is a cache miss on resume, not a crash', () => {
  const { dir, run } = workspace();
  try {
    assert.equal(run(['--chain', 'mock-external', '--task', 'tasks/t.md']).status, 3, 'fixture: pauses at an external seat');
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.ok(!readdirSync(runDir).some(f => f.includes('.tmp-')), 'no temp file is left behind');
    const usage = readdirSync(runDir).find(f => f.endsWith('.usage.json'));
    assert.ok(usage, 'fixture: at least one paid-shape stage was recorded');
    writeFileSync(join(runDir, usage), '{"provider": "mock", "us');   // torn mid-write
    const r = run(['--resume', runDir]);
    assert.notEqual(r.status, 1, r.stderr.slice(-300));
    assert.doesNotMatch(r.stderr, /SyntaxError|Unexpected end of JSON/);
    assert.match(readFileSync(join(runDir, 'WARNINGS.md'), 'utf8'), /cache_unreadable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
