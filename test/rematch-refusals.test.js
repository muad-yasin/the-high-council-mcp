// CR-RM-001/002/003 (25 Okt 2026): three ways a --rematch paid for a run the readers could not see, or for the wrong input. Real verbs on an all-mock run, offline, $0.
//   RM-2  the seed is part of the folder name (`<id>.rematch-<seed>`): `-5`, `1e21`, `0x10` and friends made names the spend and status readers do not recognise, so that rematch's spend was invisible.
//   RM-3  a rematch of a rematch (`<id>.rematch-5.rematch-7`) or of a folder like `<id>-init` has the same effect.
//   RM-1  the task was read live and never compared with the hash the original run recorded, and was looked up in the CURRENT folder instead of the run's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const TASK = 'A smoke-test task for the rematch refusals.\n';
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd } });
const runs = dir => readdirSync(join(dir, 'runs')).sort();
function original() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rematch-refusals-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'smoke.md'), TASK);
  const first = sh(dir, ['--chain', 'mock-unanimous', '--task', 'tasks/smoke.md']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  return { dir, id: runs(dir)[0] };
}

test('RM-2: a seed that is not a plain non-negative number written with digits is refused before any folder exists; a digits-only seed still runs', () => {
  const { dir, id } = original();
  const before = runs(dir);
  for (const bad of ['-5', '1e21', '0x10', ' 5', '5.5', '1000000000000000000000', 'abc']) {
    const r = sh(dir, ['--rematch', join('runs', id), '--rematch-seed', bad]);
    assert.equal(r.status, 2, `seed ${JSON.stringify(bad)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--rematch-seed: expected a whole number written with digits only, from 0 up to 9007199254740991, got ".*"\. Nothing was run and nothing was spent\./, bad);
    assert.deepEqual(runs(dir), before, `seed ${JSON.stringify(bad)} made a folder`);
  }
  const ok = sh(dir, ['--rematch', join('runs', id), '--rematch-seed', '12']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual(runs(dir), [...before, `${id}.rematch-12`].sort());
});

test('RM-3: a rematch folder, or a folder whose rematch name the readers would not recognise, is not rematched; the original still is', () => {
  const { dir, id } = original();
  assert.equal(sh(dir, ['--rematch', join('runs', id), '--rematch-seed', '5']).status, 0);
  const before = runs(dir);
  const again = sh(dir, ['--rematch', join('runs', `${id}.rematch-5`), '--rematch-seed', '7']);
  assert.equal(again.status, 2, again.stdout + again.stderr);
  assert.match(again.stderr, /--rematch: .*cannot be rematched: only a finished run whose folder is named by its start time \(like 2026-10-25T18-37-06-737Z\) can, because the spend of a rematch of anything else would not show in --spend or the spending limits\. Rematch the original run instead\. Nothing was run and nothing was spent\./);
  assert.deepEqual(runs(dir), before, 'no folder was made');
  // `<id>-init` is a run folder name the readers know, but `<id>-init.rematch-7` is not one.
  cpSync(join(dir, 'runs', id), join(dir, 'runs', `${id}-init`), { recursive: true });
  const init = sh(dir, ['--rematch', join('runs', `${id}-init`), '--rematch-seed', '7']);
  assert.equal(init.status, 2, init.stdout + init.stderr);
  assert.match(init.stderr, /cannot be rematched/);
  assert.equal(existsSync(join(dir, 'runs', `${id}-init.rematch-7`)), false);
});

test('RM-1: an edited task is refused (exit 2, nothing made); the unedited task runs; a rematch typed from another folder is refused (CR-RC-003)', () => {
  const { dir, id } = original();
  const before = runs(dir);
  writeFileSync(join(dir, 'tasks', 'smoke.md'), `${TASK}One line added after the run.\n`);
  const edited = sh(dir, ['--rematch', join('runs', id), '--rematch-seed', '3']);
  assert.equal(edited.status, 2, edited.stdout + edited.stderr);
  assert.match(edited.stderr, /--rematch: the task file .*smoke\.md has changed since .* started - a rematch tests the panel, not the task, so the input must be byte-identical\. Restore the file to what that run started with\. Nothing was run and nothing was spent\./);
  assert.deepEqual(runs(dir), before, 'no folder was made');
  writeFileSync(join(dir, 'tasks', 'smoke.md'), TASK);
  assert.equal(sh(dir, ['--rematch', join('runs', id), '--rematch-seed', '3']).status, 0, 'the restored task runs');
  // From another working folder: refused (CR-RC-003). The rematch folder would land in THIS project's runs/, where the other folder's --spend and limits never look (test/side-run-placement.test.js has the sentences);
  // before, this call ran and sent the original run's own task bytes. The task-path lookup therefore has no reachable case from another folder any more; the moved-project test below keeps the cwd lookup.
  const other = mkdtempSync(join(tmpdir(), 'thc-rematch-other-')); mkdirSync(join(other, 'tasks'));
  writeFileSync(join(other, 'tasks', 'smoke.md'), 'A different task that must not be sent.\n');
  const far = sh(other, ['--rematch', join(dir, 'runs', id), '--rematch-seed', '4']);
  assert.equal(far.status, 2, far.stdout + far.stderr);
  assert.match(far.stderr, /--rematch: .* is in .*runs, not in .*runs, so the spend of a rematch written beside it would not show/);
  assert.equal(existsSync(join(dir, 'runs', `${id}.rematch-4`)), false, 'no folder was made');
});

test('RM-1 (moved project): when the recorded folder no longer exists the task is looked up where the command runs; the same bytes rematch, a changed file is still refused', () => {
  const { dir, id } = original();
  const moved = `${dir}-moved`; renameSync(dir, moved);          // the project folder was renamed: run.json `cwd` names a folder that is gone
  assert.equal(existsSync(dir), false);
  // A run started today records its task path ABSOLUTE (the old folder, which a rename leaves dangling: "original task file not found", unchanged). The cwd lookup serves a RELATIVE recorded path, the older record shape, which no verb writes
  // any more - so run.json is edited by hand here to reproduce it.
  const metaPath = join(moved, 'runs', id, 'run.json'); const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  writeFileSync(metaPath, JSON.stringify({ ...meta, task: 'tasks/smoke.md' }, null, 2));
  const ok = sh(moved, ['--rematch', join('runs', id), '--rematch-seed', '6']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  writeFileSync(join(moved, 'tasks', 'smoke.md'), `${TASK}Changed after the move.\n`);
  const before = runs(moved);
  const edited = sh(moved, ['--rematch', join('runs', id), '--rematch-seed', '8']);
  assert.equal(edited.status, 2, edited.stdout + edited.stderr);
  assert.match(edited.stderr, /has changed since/);
  assert.deepEqual(runs(moved), before);
});
