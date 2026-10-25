// CR-RC-008: --rematch and --replay read the policy file from the folder recorded in the run's run.json, and that folder is gone when the project was moved or renamed ("no folder, so no policy"), so a monthly or per-run
// limit in the moved project's policy.json did not apply. Both now read the policy of the project the command is typed in (the original is directly in its runs/ folder: CR-RC-003), the one --spend counts from.
// Real verbs on an all-mock run, offline, $0, no hand-written records. The moved shape: the task file lives OUTSIDE the project (a run records its task path absolute, so a task inside a renamed project would be refused
// first with "original task file not found" and never reach the gate); the project folder is then renamed, which leaves the run's recorded folder gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const DATE = '2026-10-25';
const POLICY = { required_chain_tags: ['approved'] };
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd } });
function movedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-side-policy-'));
  const taskFile = join(mkdtempSync(join(tmpdir(), 'thc-side-policy-task-')), 'smoke.md');
  writeFileSync(taskFile, 'A smoke-test task for the side-run policy folder.\n');
  const first = sh(dir, ['--chain', 'mock-unanimous', '--task', taskFile]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const id = readdirSync(join(dir, 'runs'))[0];
  const moved = `${dir}-moved`; renameSync(dir, moved);
  assert.equal(existsSync(dir), false, 'the recorded folder is gone');
  return { moved, id };
}
const SIDE = [
  ['--rematch', id => ['--rematch', join('runs', id), '--rematch-seed', '3'], /\.rematch-3$/],
  ['--replay', id => ['--replay', join('runs', id), '--replay-date', DATE], /\.replay-/],
];

for (const [name, argsOf, sideName] of SIDE) {
  test(`SP-1 ${name}: the policy.json of the (moved) project applies although the recorded folder is gone; without that file the same command runs`, () => {
    const { moved, id } = movedProject();
    const before = readdirSync(join(moved, 'runs')).sort();
    writeFileSync(join(moved, 'policy.json'), JSON.stringify(POLICY));
    const refused = sh(moved, argsOf(id));
    assert.equal(refused.status, 12, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /COUNCIL-E005/);
    assert.match(refused.stderr, /required_chain_tags: chain "mock-unanimous" is missing required tag\(s\): approved\./);
    assert.deepEqual(readdirSync(join(moved, 'runs')).sort(), before, 'nothing was made');
    writeFileSync(join(moved, 'policy.json'), '{}');   // an empty policy: the same command runs, so the refusal above was the policy's
    const ok = sh(moved, argsOf(id));
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(readdirSync(join(moved, 'runs')).some(n => sideName.test(n)));
  });
}
