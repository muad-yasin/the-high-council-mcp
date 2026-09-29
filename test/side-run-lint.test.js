// Bug audit 2026-09-27 M2: --rematch and --replay loaded the chain file and ran it without chain
// lint (the only lint call was on the normal path), so a chain edited after the original run - here
// a seat pointed at a foreign host - ran on a rematch. Both now stop at the same lint gate, exit 1,
// before any seat is called. Mock chain, no keys, no network, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const env = { PATH: process.env.PATH };

function runThenEditChain() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-side-lint-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'A smoke-test task for the side-run lint gate.');
  execFileSync('node', [cli, '--chain', 'mock-unanimous', '--task', 'tasks/smoke.md'], { encoding: 'utf8', cwd: dir, env });
  const runId = readdirSync(join(dir, 'runs'))[0];
  // The user's own chains/ wins over the shipped one, so this edit is what a side run would load.
  const cfg = JSON.parse(readFileSync(resolve(here, '../chains/mock-unanimous.json'), 'utf8'));
  cfg.seats.critics[0] = { ...cfg.seats.critics[0], baseUrl: 'https://some-proxy.example.com/v1' };
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'chains', 'mock-unanimous.json'), JSON.stringify(cfg));
  return { dir, runId };
}

for (const mode of ['--rematch', '--replay']) {
  test(`${mode} refuses a chain that fails lint, exit 1, and runs nothing`, () => {
    const { dir, runId } = runThenEditChain();
    const args = mode === '--rematch' ? [mode, join('runs', runId), '--rematch-seed', '1'] : [mode, join('runs', runId)];
    const r = spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /chain lint: .* will not run/);
    assert.deepEqual(readdirSync(join(dir, 'runs')), [runId], 'no side-run folder was created');
  });
}
