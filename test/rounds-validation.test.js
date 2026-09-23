// Bug audit 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md backlog): `--rounds abc` gave NaN,
// so zero reviews ran and the run exited 0 with a deliverable; `--rounds 1.5` paid for a revision
// nobody graded; lint never checked maxRounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');

test('--rounds must be a whole number of 1 or more; anything else is a usage error before any run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rounds-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'A plain task.\n');
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const r = spawnSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--rounds', bad], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
      assert.equal(r.status, 2, `--rounds ${bad}: ${r.stderr.slice(-200)}`);
      assert.match(r.stderr, /--rounds: expected a whole number/);
    }
    assert.ok(!existsSync(join(dir, 'runs')), 'no run folder for a rejected flag');
    const ok = spawnSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--rounds', '1'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
    assert.equal(ok.status, 0, ok.stderr.slice(-200));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('lint refuses a maxRounds that is not a positive whole number', () => {
  const base = { seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }] } };
  for (const bad of [0, -2, 1.5, '3', null]) {
    assert.equal(lintChain({ ...base, maxRounds: bad }, 'f.json').filter(f => f.kind === 'invalid-max-rounds').length, 1, JSON.stringify(bad));
  }
  assert.deepEqual(lintChain({ ...base, maxRounds: 3 }, 'f.json').filter(f => f.kind === 'invalid-max-rounds'), []);
  assert.deepEqual(lintChain(base, 'f.json').filter(f => f.kind === 'invalid-max-rounds'), []);
});
