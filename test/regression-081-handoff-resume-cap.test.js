// 0.8.1 FX-2 (the 2026-10-02 audit of 0.8.0, finding 2): a later --resume did not count a `handoff --from-run` call's
// cost toward the run's cap (the cap is a total for the run), because the call's record was not a stage file. Since FX-1
// the call is a file in superseded/, which the resume's cap already reads, so the cap and --spend agree. Offline: the
// mock-budget chain's priced mock seats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpentUsd } from '../src/spend.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-02T23-30-00-000Z';
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

test('FX-2: a resume counts an earlier handoff --from-run call toward the run\'s cap, and the stop reports the folder\'s total', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx2-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  // A run the cap stopped, with a draft on disk for the handoff to read.
  assert.equal(run(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', RUN]).status, 4);
  const rd = join(dir, 'runs', RUN);
  writeFileSync(join(rd, 'build.md'), '# Plan\n\nA reading list: add, tick, remove.\n');
  const before = runSpentUsd(rd);
  const h = run(dir, ['handoff', '--from-run', join('runs', RUN), '--max-usd', '100']);
  assert.equal(h.status, 0, h.stdout + h.stderr);
  // The call's record: superseded/handoff-from-run.call-1.usage.json since FX-1, handoff-from-run.usage.json in 0.8.0.
  // Either way --spend counts it; the cap check below is what this test is about.
  const rec = [join(rd, 'superseded', 'handoff-from-run.call-1.usage.json'), join(rd, 'handoff-from-run.usage.json')].find(existsSync);
  assert.ok(rec, 'the handoff call is on record');
  const x = readJson(rec).usd;
  assert.ok(x > 0);
  assert.ok(Math.abs(runSpentUsd(rd) - (before + x)) < 1e-9, '--spend counts the handoff call');
  // A total just under what the folder already cost: the resume must stop before its first paid call.
  const cap = before + x - 1e-6;
  const r = run(dir, ['--resume', join('runs', RUN), '--max-usd', String(cap)]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const stopped = readJson(join(rd, 'STOPPED-budget.json'));
  assert.ok(Math.abs(stopped.spentUsd - runSpentUsd(rd)) < 1e-6, `stop says ${stopped.spentUsd}, folder holds ${runSpentUsd(rd)}`);
});
