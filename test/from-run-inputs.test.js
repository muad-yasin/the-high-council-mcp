// Bug audit 2026-09-28: (area 3 #2.2) --from-run of a finished criterion-kinds run reused the plain
// criteria strings and dropped every kind; (area 4 LOW-1) a missing --draft file or --from-run folder
// crashed with a raw stack trace. Mock chains, no keys, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const env = { PATH: process.env.PATH };
function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fromrun-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, '.env'), '');
  return dir;
}
const cliRun = (dir, args) => spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env });

test('--from-run of a finished kinds run keeps its criterion kinds', () => {
  const dir = workDir();
  try {
    let r = cliRun(dir, ['--chain', 'mock-criteria-kinds', '--task', 'tasks/x.md']);
    assert.equal(r.status === 0 || r.status === 1, true, r.stdout + r.stderr);
    const first = readdirSync(join(dir, 'runs'))[0];
    const a = JSON.parse(readFileSync(join(dir, 'runs', first, 'report.json'), 'utf8'));
    assert.ok(a.criteria_summary.checkable > 0, JSON.stringify(a.criteria_summary));
    r = cliRun(dir, ['--chain', 'mock-criteria-kinds', '--task', 'tasks/x.md', '--from-run', join('runs', first)]);
    const second = readdirSync(join(dir, 'runs')).find(d => d !== first);
    const b = JSON.parse(readFileSync(join(dir, 'runs', second, 'report.json'), 'utf8'));
    assert.equal(b.criteria_summary.checkable, a.criteria_summary.checkable, JSON.stringify(b.criteria_summary));
    assert.deepEqual(b.criteria, a.criteria, 'report.criteria stays the plain list');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [what, args, msg] of [
  ['--draft with a missing file', ['--draft', 'nofile.md'], /--draft: no such file/],
  ['--from-run with a missing folder', ['--from-run', 'runs/nope'], /--from-run: no such run folder/],
]) {
  test(`${what} exits 2 with a message, no stack trace`, () => {
    const dir = workDir();
    try {
      const r = cliRun(dir, ['--chain', 'mock', '--task', 'tasks/x.md', ...args]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, msg);
      assert.doesNotMatch(r.stderr, /at .*\.js:\d+/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
