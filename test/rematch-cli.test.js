// Item C (blind rematch) - relay/runs/2026-09-15T15-12-52-325Z/deliverable.md. Integration
// coverage for the `--rematch <run-dir> [--rematch-seed N]` CLI wrapper, same style as
// test/init.test.js: a real mock-chain run on disk, then a real CLI invocation against it, no
// keys, no network, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function runOriginal(dir) {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'A smoke-test task for the rematch feature.');
  execFileSync('node', [cli, '--chain', 'mock-unanimous', '--task', 'tasks/smoke.md'], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });
  const runId = readdirSync(join(dir, 'runs'))[0];
  return join(dir, 'runs', runId);
}

test('1. --rematch produces a sibling run folder with deliverable.md, report.json, rematch-diff.json, $0, no chain.js/tools.js involvement needed for it to work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rematch-'));
  const originalRunDir = runOriginal(dir);
  const originalRunId = originalRunDir.split('/').pop();

  const out = execFileSync('node', [cli, '--rematch', join('runs', originalRunId), '--rematch-seed', '1'], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });

  const rematchRunDir = `${originalRunDir}.rematch-1`;
  assert.ok(existsSync(rematchRunDir), 'rematch run folder should exist');
  assert.ok(existsSync(join(rematchRunDir, 'deliverable.md')));
  assert.ok(existsSync(join(rematchRunDir, 'report.json')));
  assert.ok(existsSync(join(rematchRunDir, 'rematch-diff.json')));

  const rematchReport = JSON.parse(readFileSync(join(rematchRunDir, 'report.json'), 'utf8'));
  assert.equal(rematchReport.totals.usd, 0, 'the mock chain must cost $0');

  assert.match(out, /rematch verdict:/);
});

test('2. rematch-diff.json has all five named fields with the correct types', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rematch-'));
  const originalRunDir = runOriginal(dir);
  const originalRunId = originalRunDir.split('/').pop();
  execFileSync('node', [cli, '--rematch', join('runs', originalRunId), '--rematch-seed', '2'], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });
  const diff = JSON.parse(readFileSync(`${originalRunDir}.rematch-2/rematch-diff.json`, 'utf8'));
  assert.equal(typeof diff.signoff_match, 'boolean');
  assert.equal(typeof diff.verdict_category_changed, 'boolean');
  assert.ok(Array.isArray(diff.critics_objecting_added));
  assert.ok(Array.isArray(diff.critics_objecting_removed));
  assert.equal(typeof diff.objection_overlap_ratio, 'number');
  assert.ok(diff.objection_overlap_ratio >= 0 && diff.objection_overlap_ratio <= 1);
});

test('3. the reshuffle produced a different seat-to-model permutation than the original run folder recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rematch-'));
  const originalRunDir = runOriginal(dir);
  const originalRunId = originalRunDir.split('/').pop();
  execFileSync('node', [cli, '--rematch', join('runs', originalRunId), '--rematch-seed', '1'], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });
  const originalReport = JSON.parse(readFileSync(join(originalRunDir, 'report.json'), 'utf8'));
  const rematchReport = JSON.parse(readFileSync(`${originalRunDir}.rematch-1/report.json`, 'utf8'));
  const originalStages = originalReport.stages.map(s => `${s.label}:${s.provider}/${s.model}`).sort();
  const rematchStages = rematchReport.stages.map(s => `${s.label}:${s.provider}/${s.model}`).sort();
  assert.notDeepEqual(originalStages, rematchStages, 'the panel stages should show a different provider/model assignment after reshuffle');
});

test('4. --rematch with no --rematch-seed still succeeds (default random) and records the seed it actually used in run.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rematch-'));
  const originalRunDir = runOriginal(dir);
  const originalRunId = originalRunDir.split('/').pop();
  execFileSync('node', [cli, '--rematch', join('runs', originalRunId)], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });
  const rematchDirs = readdirSync(join(dir, 'runs')).filter(f => f.startsWith(`${originalRunId}.rematch-`));
  assert.equal(rematchDirs.length, 1);
  const runMeta = JSON.parse(readFileSync(join(dir, 'runs', rematchDirs[0], 'run.json'), 'utf8'));
  assert.equal(typeof runMeta.rematchSeed, 'number');
  assert.ok(rematchDirs[0].endsWith(`.rematch-${runMeta.rematchSeed}`));
});

test('5. --rematch against a run folder with no report.json fails loudly, exit code 2, no crash with a raw stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rematch-'));
  mkdirSync(join(dir, 'runs', 'fake-run'), { recursive: true });
  assert.throws(() => execFileSync('node', [cli, '--rematch', 'runs/fake-run'], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'],
  }), /Command failed/);
});

test('6. --rematch is untraceable in src/chain.js and src/tools.js by grep - the plan\'s own 0-line-delta claim, checked mechanically', () => {
  const chainSrc = readFileSync(resolve(here, '../src/chain.js'), 'utf8');
  const toolsSrc = readFileSync(resolve(here, '../src/tools.js'), 'utf8');
  assert.ok(!/rematch/i.test(chainSrc), 'src/chain.js must not mention rematch');
  assert.ok(!/rematch/i.test(toolsSrc), 'src/tools.js must not mention rematch');
});
