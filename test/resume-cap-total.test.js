// test/resume-cap-total.test.js
//
// 0.8.0 WM0 item 5. `--resume --max-usd N` sets N as the NEW TOTAL ceiling for the whole run, not as
// extra spend on top of what was already spent: stages replayed from disk count toward it. Pinned
// here on mock-budget ($0 in reality, priced by a fixture) so a UI that offers "raise the cap to N"
// can rely on the meaning. The stop's own numbers are read back from STOPPED-budget.json, not typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const RUN = '2026-09-28T15-00-00-000Z';
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmpdir() }, timeout: 60_000 });
const stopped = dir => JSON.parse(readFileSync(join(dir, 'runs', RUN, 'STOPPED-budget.json'), 'utf8'));

test('--resume --max-usd N is a total: it must cover what is already spent plus the next stage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cap-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');

  // Sitting 1: the criteria stage is paid for, then the build would cross a $1 cap.
  assert.equal(run(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', RUN]).status, 4);
  const first = stopped(dir);
  assert.equal(first.stoppedAt, 'build');
  assert.ok(first.spentUsd > 0 && first.projectedStageUsd > 1, 'fixture: something was spent, and the build projects far above the cap');

  // Sitting 2: a cap that would be plenty if it were EXTRA spend (it is above the build's projection alone),
  // but is below spent + projection. It stops at the same stage: the replayed criteria count.
  const extraWouldFit = first.projectedStageUsd + first.spentUsd / 2;
  assert.ok(extraWouldFit > first.projectedStageUsd && extraWouldFit < first.spentUsd + first.projectedStageUsd);
  const second = run(dir, ['--resume', `runs/${RUN}`, '--max-usd', String(extraWouldFit)]);
  assert.equal(second.status, 4, second.stdout + second.stderr);
  assert.match(second.stdout, /criteria: .*from disk .*already spent/, 'the replayed stage is shown as already spent');
  assert.equal(stopped(dir).stoppedAt, 'build');
  assert.equal(stopped(dir).capUsd, extraWouldFit);
  assert.ok(Math.abs(stopped(dir).spentUsd - first.spentUsd) < 1e-9, 'nothing new was spent');

  // Sitting 3: a total that covers spent + projection lets the build through, and the run stops at the next
  // stage it cannot cover - the cap is still one number for the whole run.
  const covers = Math.ceil((first.spentUsd + first.projectedStageUsd) * 100) / 100;
  const third = run(dir, ['--resume', `runs/${RUN}`, '--max-usd', String(covers)]);
  assert.equal(third.status, 4, third.stdout + third.stderr);
  assert.notEqual(stopped(dir).stoppedAt, 'build', 'the build was paid for');
  assert.equal(stopped(dir).capUsd, covers);
  assert.ok(stopped(dir).spentUsd > first.spentUsd);
  assert.ok(stopped(dir).spentUsd <= covers, 'the run as a whole never passes the total');

  // The new total is saved for the next sitting, and a resume that names none keeps it.
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', RUN, 'run.json'), 'utf8')).maxUsd, covers);
  const fourth = run(dir, ['--resume', `runs/${RUN}`]);
  assert.equal(fourth.status, 4);
  assert.equal(stopped(dir).capUsd, covers);

  // `none` removes it.
  assert.equal(run(dir, ['--resume', `runs/${RUN}`, '--max-usd', 'none']).status, 0);
});
