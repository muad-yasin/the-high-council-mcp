// 0.7.9, owner decision 2026-09-28: "Refuse 0 everywhere". `--max-usd 0` and MAX_USD_PER_RUN=0
// used to mean no ceiling in the CLI (and max_usd 0 over MCP), while the JS API refused 0. Now all
// of them refuse it; `none` is the one explicit way to run without a ceiling. $0: refused at startup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
function cliRun(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-maxusd0-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  const r = spawnSync('node', [cli, '--chain', 'mock', '--task', 'tasks/x.md', ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { ...r, dir };
}

for (const [what, args, env] of [
  ['--max-usd 0', ['--max-usd', '0'], {}],
  ['--max-usd 0.0', ['--max-usd', '0.0'], {}],
  ['MAX_USD_PER_RUN=0', [], { MAX_USD_PER_RUN: '0' }],
]) {
  test(`${what} is refused with exit 2 and runs nothing`, () => {
    const r = cliRun(args, env);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /0 is refused.*--max-usd none/);
    assert.ok(!existsSync(join(r.dir, 'runs')), 'no run folder');
  });
}

test('--max-usd none still runs without a ceiling, and says so', () => {
  const r = cliRun(['--max-usd', 'none']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /none|no spend ceiling|no ceiling/i);
});
