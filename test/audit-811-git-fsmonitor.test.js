// Audit item 8 (13 Oct 2026, C&C's rulings): git runs the program named by `core.fsmonitor` when it checks ignores or status, and git reads its per-user config from `$XDG_CONFIG_HOME/git/config`. A project `.env`
// that could set XDG_CONFIG_HOME therefore made `council doctor`, `council fence` and every tool-enabled chain start a program the project chose. Two layers stop it, and each is shown ALONE here through the REAL verbs
// (a marker file is the observable): layer 1 = src/env-file.js refuses XDG_* from a project `.env`; layer 2 = src/git.js puts `-c core.fsmonitor=false` on every git call. A control row proves the setup really starts
// the program on THIS git (raw git, no flag): where it does not (an older git, a platform that skips it) the other rows SKIP with that reason instead of passing vacuously.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

// A project folder that is a git repository with a .env, a tiny tracked-looking file, and a per-user git config (in `<dir>/xdg`) whose core.fsmonitor program appends to `<dir>/marker`.
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fsmon-'));
  const proj = join(dir, 'proj'); const xdg = join(dir, 'xdg');
  mkdirSync(proj); mkdirSync(join(xdg, 'git'), { recursive: true }); mkdirSync(join(dir, 'home'));
  const hook = join(dir, 'hook.sh');
  writeFileSync(hook, `#!/bin/sh\necho ran >> '${join(dir, 'marker')}'\nprintf '\\0'\n`); chmodSync(hook, 0o755);
  writeFileSync(join(xdg, 'git', 'config'), `[core]\n\tfsmonitor = ${hook}\n`);
  spawnSync('git', ['init', '-q', '.'], { cwd: proj });
  writeFileSync(join(proj, 'a.txt'), 'plain text\n');
  writeFileSync(join(proj, 'task.md'), 'A task.\n');
  return { dir, proj, xdg, marker: join(dir, 'marker') };
}
const baseEnv = p => ({ PATH: process.env.PATH, HOME: join(p.dir, 'home'), LC_ALL: 'C' });

const control = (() => {
  const p = project();
  spawnSync('git', ['check-ignore', '-q', 'a.txt'], { cwd: p.proj, env: { ...baseEnv(p), XDG_CONFIG_HOME: p.xdg } });
  return existsSync(p.marker);
})();
const needsControl = control ? {} : { skip: 'this git does not start a core.fsmonitor program for `git check-ignore` (the control row: raw git, no flag, left no marker), so a missing marker would prove nothing' };

test('CONTROL: raw git with that config DOES start the program (the setup is a real one on this git)', needsControl, () => {
  assert.equal(control, true);
});

test('layer 1: a project .env that sets XDG_CONFIG_HOME starts nothing through `council doctor`, and the name is reported once', needsControl, () => {
  const p = project();
  writeFileSync(join(p.proj, '.env'), `OPENROUTER_API_KEY=k\nXDG_CONFIG_HOME=${p.xdg}\n`);
  const r = spawnSync(process.execPath, [cli, 'doctor'], { cwd: p.proj, env: baseEnv(p), encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(0, 400));
  assert.equal(existsSync(p.marker), false, 'the project-chosen program did not run');
  assert.equal((r.stderr.match(/\.env: XDG_CONFIG_HOME is not read from a project \.env file/g) || []).length, 1, r.stderr);
});

test('layer 2 alone: XDG_CONFIG_HOME in the REAL environment (no .env rule can help) starts nothing through `council doctor`', needsControl, () => {
  const p = project();
  writeFileSync(join(p.proj, '.env'), 'OPENROUTER_API_KEY=k\n');
  const r = spawnSync(process.execPath, [cli, 'doctor'], { cwd: p.proj, env: { ...baseEnv(p), XDG_CONFIG_HOME: p.xdg }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(0, 400));
  assert.equal(existsSync(p.marker), false, 'the program did not run: the flag on the git call stopped it');
});

test('layer 2 alone, the fence route: `council fence` (pathRefusal -> gitIgnoredSet -> src/git.js) starts nothing either', needsControl, () => {
  const p = project();
  const r = spawnSync(process.execPath, [cli, 'fence', '--task', 'task.md', '--repo', '.', 'a.txt'], { cwd: p.proj, env: { ...baseEnv(p), XDG_CONFIG_HOME: p.xdg }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(0, 400));
  assert.equal(existsSync(p.marker), false, 'the program did not run');
  assert.ok(/a\.txt/.test(r.stdout + r.stderr), 'and the fence really read the file (the git ignore check ran): ' + `${r.stdout}${r.stderr}`.slice(0, 200));
});
