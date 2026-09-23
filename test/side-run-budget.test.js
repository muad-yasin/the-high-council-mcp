// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #3).
//
// --rematch and --replay called runChain() before --max-usd was parsed and before setBudget(), so
// they ran with no ceiling at all (repro: $50.50 spent, nothing stopping it). And --spend never
// counted them, because their folder names (`<id>.rematch-N`, `<id>.replay-DATE`) failed
// runIdToDate. Real CLI invocations against mock-budget (fixture prices, no keys, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spendReport } from '../src/spend.js';
import { runIdToDate } from '../src/spend.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const run = (dir, args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });

function runOriginal() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-siderun-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'A smoke-test task for the side-run cap.');
  const r = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/smoke.md', '--max-usd', 'none']);
  assert.equal(r.status, 0, `fixture run failed: ${r.stderr}`);
  const runId = readdirSync(join(dir, 'runs'))[0];
  return { dir, runId, runDir: join(dir, 'runs', runId) };
}

test('--rematch honours --max-usd: stops before the first stage over the cap, exit 4, marker on disk', () => {
  const { dir, runId, runDir } = runOriginal();
  const r = run(dir, ['--rematch', join('runs', runId), '--rematch-seed', '1', '--max-usd', '1']);
  assert.equal(r.status, 4, `expected the cap to stop the rematch (exit 4), got ${r.status}: ${r.stdout.slice(-400)}`);
  const stopped = JSON.parse(readFileSync(join(`${runDir}.rematch-1`, 'STOPPED-budget.json'), 'utf8'));
  assert.equal(stopped.capUsd, 1);
  assert.ok(stopped.spentUsd <= 1);
  assert.ok(!existsSync(join(`${runDir}.rematch-1`, 'report.json')), 'a stopped rematch must not look finished');
});

test('--rematch gets the same default ceiling as a normal run when --max-usd is not given', () => {
  const { dir, runId } = runOriginal();
  const r = run(dir, ['--rematch', join('runs', runId), '--rematch-seed', '1']);
  assert.match(r.stdout, /cap:\s+\$7/);
});

test('--replay honours --max-usd: stops at the cap, exit 4, marker on disk', () => {
  const { dir, runId, runDir } = runOriginal();
  const r = run(dir, ['--replay', join('runs', runId), '--replay-date', '2026-09-23', '--max-usd', '1']);
  assert.equal(r.status, 4, `expected the cap to stop the replay (exit 4), got ${r.status}: ${r.stderr.slice(-400)}`);
  assert.ok(existsSync(join(`${runDir}.replay-2026-09-23`, 'STOPPED-budget.json')));
});

test('--spend counts completed and capped rematch/replay folders; the shared runIdToDate stays strict', () => {
  const { dir, runId, runDir } = runOriginal();
  assert.equal(run(dir, ['--rematch', join('runs', runId), '--rematch-seed', '3', '--max-usd', 'none']).status, 0);
  assert.equal(run(dir, ['--replay', join('runs', runId), '--replay-date', '2026-09-23', '--max-usd', '1']).status, 4);
  const report = spendReport(join(dir, 'runs'), { days: 1 });
  const ids = report.runs.map(x => x.id);
  assert.ok(ids.includes(`${runId}.rematch-3`), `rematch folder missing from --spend: ${ids}`);
  assert.ok(ids.includes(`${runId}.replay-2026-09-23`), `replay folder missing from --spend: ${ids}`);
  const rematch = report.runs.find(x => x.id === `${runId}.rematch-3`);
  const expected = JSON.parse(readFileSync(join(`${runDir}.rematch-3`, 'report.json'), 'utf8')).totals.usd;
  assert.ok(expected > 0 && rematch.usd === expected);
  // metrics/verdict-stats/cost-forecast read runIdToDate and must not start counting side runs.
  assert.equal(runIdToDate(`${runId}.rematch-3`), null);
});
