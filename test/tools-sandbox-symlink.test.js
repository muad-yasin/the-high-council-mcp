// Bug-audit fix, 2026-09-16: src/tools.js's sandboxPath() was purely lexical (resolve() + string
// comparison) despite its own doc comment claiming it "also rejects symlink escapes at the
// string level" - false, since resolve() never touches the filesystem or follows a link. A
// symlink physically inside the workspace pointing outside it passed the lexical check and then
// every caller (read_file, run_tests, grep_repo) opened/read/executed through it, landing
// outside the sandbox for real. Same root cause broke grep_repo's own walk(): statSync() follows
// symlinks, so a symlinked directory was walked straight through, and a symlink cycle recursed
// until the stack overflowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool } from '../src/tools.js';

function freshWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'sandbox-workspace-'));
  const outside = mkdtempSync(join(tmpdir(), 'sandbox-outside-'));
  return { workspace, outside };
}

test('read_file: a symlink inside the workspace pointing outside it is refused, not read through', () => {
  const { workspace, outside } = freshWorkspace();
  try {
    const secretPath = join(outside, 'secret.txt');
    writeFileSync(secretPath, 'outside-the-sandbox-secret');
    symlinkSync(secretPath, join(workspace, 'link-to-secret.txt'));

    const result = runTool('read_file', { path: 'link-to-secret.txt' }, { cwd: workspace });
    assert.equal(result.ok, false, 'a symlink escape must be refused, not silently read');
    assert.doesNotMatch(JSON.stringify(result), /outside-the-sandbox-secret/, 'the outside file content must never appear in the result');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('grep_repo: a symlinked directory pointing outside the workspace is not walked into', () => {
  const { workspace, outside } = freshWorkspace();
  try {
    writeFileSync(join(outside, 'secret.txt'), 'UNIQUE_OUTSIDE_MARKER_9f3a');
    symlinkSync(outside, join(workspace, 'escape-dir'));
    writeFileSync(join(workspace, 'real.txt'), 'a real in-workspace line');

    const result = runTool('grep_repo', { pattern: 'UNIQUE_OUTSIDE_MARKER_9f3a' }, { cwd: workspace });
    assert.equal(result.ok, true);
    assert.equal(result.matches.length, 0, 'the outside file must never be matched via the symlinked directory');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('grep_repo: a symlink cycle inside the workspace does not stack-overflow', () => {
  const { workspace } = freshWorkspace();
  try {
    mkdirSync(join(workspace, 'a'));
    mkdirSync(join(workspace, 'b'));
    symlinkSync(join(workspace, 'b'), join(workspace, 'a', 'to-b'));
    symlinkSync(join(workspace, 'a'), join(workspace, 'b', 'to-a'));
    writeFileSync(join(workspace, 'real.txt'), 'findme-in-a-real-file');

    let result;
    assert.doesNotThrow(() => { result = runTool('grep_repo', { pattern: 'findme' }, { cwd: workspace }); });
    assert.equal(result.ok, true);
    assert.equal(result.matches.length, 1, 'the real file is still found; the cycle is simply not descended into');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('run_tests: a symlinked test file pointing outside the workspace is refused, not executed', () => {
  const { workspace, outside } = freshWorkspace();
  try {
    writeFileSync(join(outside, 'evil.test.mjs'), "require('node:fs').writeFileSync(require('node:path').join(process.env.MARKER_DIR,'ran'),'yes');");
    symlinkSync(join(outside, 'evil.test.mjs'), join(workspace, 'link.test.mjs'));

    const result = runTool('run_tests', { file: 'link.test.mjs' }, { cwd: workspace });
    assert.equal(result.ok, false, 'a symlinked test file escaping the workspace is refused before spawning node');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('read_file: a plain, non-symlinked file inside the workspace still works exactly as before (no regression)', () => {
  const { workspace } = freshWorkspace();
  try {
    writeFileSync(join(workspace, 'normal.txt'), 'hello world');
    const result = runTool('read_file', { path: 'normal.txt' }, { cwd: workspace });
    assert.equal(result.ok, true);
    assert.equal(result.text, 'hello world');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('grep_repo: a symlinked *file* (not directory) inside the workspace is skipped, not read through', () => {
  const { workspace, outside } = freshWorkspace();
  try {
    writeFileSync(join(outside, 'secret.txt'), 'UNIQUE_OUTSIDE_FILE_MARKER_71cd');
    symlinkSync(join(outside, 'secret.txt'), join(workspace, 'link.txt'));
    writeFileSync(join(workspace, 'real.txt'), 'a real line');

    const result = runTool('grep_repo', { pattern: 'UNIQUE_OUTSIDE_FILE_MARKER_71cd' }, { cwd: workspace });
    assert.equal(result.ok, true);
    assert.equal(result.matches.length, 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a path that does not exist yet still gets the lexical `..`/absolute check (no regression from the existence-gated realpath check)', () => {
  const { workspace } = freshWorkspace();
  try {
    const result = runTool('read_file', { path: '../../../etc/passwd' }, { cwd: workspace });
    assert.equal(result.ok, false);
    assert.match(result.error, /escapes workspace/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
