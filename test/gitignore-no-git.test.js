// A machine with no `git` on PATH (a Windows user without Git for Windows, a minimal Linux box, a GUI host that launches the server with a
// stripped PATH). Found 7 Oct 2026 by the Wine smoke of the packaged .exe: `start_run` answered "refused: can't check .gitignore (ENOENT)" for
// EVERY task, because gitIgnoredSet failed closed on the missing binary even in a folder that is no repository at all. Linux CI never saw it:
// its runner has git, and git itself says "not a git repository" for the smoke's empty folder.
// The rule (src/tools.js gitIgnoredSet): a missing git binary reads as "not a repository" ONLY when no `.git` entry exists at the root or any
// ancestor and GIT_DIR / GIT_WORK_TREE are unset. Inside a checkout the gate stays closed (test/secret-gates-audit.test.js, section C, pins
// the other git failures). $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool, gitIgnoredSet } from '../src/tools.js';

// PATH is REPLACED by an empty folder (secret-gates-audit's withFakeGit prepends, so the real git would still be found).
function withNoGit(fn, extraEnv = {}) {
  const emptyBin = mkdtempSync(join(tmpdir(), 'thc-no-git-bin-'));
  const saved = { PATH: process.env.PATH, ...Object.fromEntries(Object.keys(extraEnv).map(k => [k, process.env[k]])) };
  process.env.PATH = emptyBin;
  Object.assign(process.env, extraEnv);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const workspace = prefix => { const d = mkdtempSync(join(tmpdir(), prefix)); writeFileSync(join(d, 'notes.md'), 'ordinary\n'); return d; };

test('no git binary and no repository anywhere above: the folder reads (there is no .gitignore to honour)', () => {
  const dir = workspace('thc-nogit-plain-');
  const res = withNoGit(() => runTool('read_file', { path: 'notes.md' }, { cwd: dir }));
  assert.equal(res.ok, true, `refused although nothing can be gitignored here: ${res.error}`);
  assert.equal(withNoGit(() => gitIgnoredSet(realpathSync(dir), ['notes.md'])).size, 0);
});

test('no git binary inside a checkout (.git directory): still refuses, and says what to do', () => {
  const dir = workspace('thc-nogit-dir-');
  mkdirSync(join(dir, '.git'));
  const res = withNoGit(() => runTool('read_file', { path: 'notes.md' }, { cwd: dir }));
  assert.equal(res.ok, false, 'read allowed in a checkout although git cannot be asked');
  assert.match(res.error, /gitignore/i);
  assert.match(res.error, /not installed or not on PATH/);
});

test('no git binary inside a worktree or submodule (.git file): still refuses', () => {
  const dir = workspace('thc-nogit-file-');
  writeFileSync(join(dir, '.git'), 'gitdir: ../elsewhere/.git/worktrees/x\n');
  const res = withNoGit(() => runTool('read_file', { path: 'notes.md' }, { cwd: dir }));
  assert.equal(res.ok, false);
  assert.match(res.error, /not installed or not on PATH/);
});

test('no git binary in a subfolder of a checkout (.git is an ancestor): still refuses', () => {
  const top = workspace('thc-nogit-anc-');
  mkdirSync(join(top, '.git'));
  const sub = join(top, 'pkg', 'inner');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'notes.md'), 'ordinary\n');
  const res = withNoGit(() => runTool('read_file', { path: 'notes.md' }, { cwd: sub }));
  assert.equal(res.ok, false);
  assert.match(res.error, /not installed or not on PATH/);
});

test('no git binary but GIT_DIR or GIT_WORK_TREE is set: the caller says it is a repository, so it refuses', () => {
  for (const extra of [{ GIT_DIR: '/nonexistent/.git' }, { GIT_WORK_TREE: '/nonexistent' }]) {
    const dir = workspace('thc-nogit-env-');
    const res = withNoGit(() => runTool('read_file', { path: 'notes.md' }, { cwd: dir }), extra);
    assert.equal(res.ok, false, `read allowed with ${Object.keys(extra)[0]} set`);
  }
});
