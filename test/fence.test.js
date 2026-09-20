// test/fence.test.js
//
// `council fence` (2026-09-20). The cheap-7 run asked seven labs about a codebase and showed
// them none of it; one converged on a claim about a directory that does not exist. This is the
// human-in-the-loop answer to that: a person picks the files, the task file records exactly
// what left the machine, and the command never chooses, follows imports, or summarises.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fenceFile, scanTaskForSecrets, FENCE_MAX_BYTES } from '../src/fence.js';
import { checkArtifactReferences } from '../src/preflight.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const root = resolve(here, '..');
const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fence-'));
  mkdirSync(join(dir, 'repo', 'secrets'), { recursive: true });
  writeFileSync(join(dir, 'repo', 'SaveSystem.cs'), 'class SaveSystem {\n  int Version = 3;\n}\n');
  writeFileSync(join(dir, 'repo', 'secrets', 'upload.key'), `${SECRET}\n`);
  writeFileSync(join(dir, 'repo', 'big.cs'), 'x'.repeat(FENCE_MAX_BYTES + 500));
  writeFileSync(join(dir, 'repo', 'leaky.cs'), `const apiKey = "${SECRET}";\n`);
  writeFileSync(join(dir, 'task.md'), 'Review SaveSystem.cs and report what breaks.\n');
  return dir;
}

function fence(dir, ...args) {
  try {
    return { status: 0, stdout: execFileSync('node', [cli, 'fence', '--task', join(dir, 'task.md'), '--repo', join(dir, 'repo'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('fencing a file clears the artifact gate that blocked the run', () => {
  const dir = sandbox();
  const before = readFileSync(join(dir, 'task.md'), 'utf8');
  assert.equal(checkArtifactReferences(before).length, 1, 'precondition: the gate blocks this task');

  assert.equal(fence(dir, 'SaveSystem.cs').status, 0);

  const after = readFileSync(join(dir, 'task.md'), 'utf8');
  assert.deepEqual(checkArtifactReferences(after), [],
    'the whole point: the fix the gate names must actually satisfy the gate');
  assert.match(after, /class SaveSystem/, 'real contents, not a summary');
  assert.match(after, /hand-picked, partial slice/, 'seats are told what they are NOT seeing');
  rmSync(dir, { recursive: true, force: true });
});

test('a denylisted file is refused, and the task is left untouched', () => {
  const dir = sandbox();
  const before = readFileSync(join(dir, 'task.md'), 'utf8');
  const r = fence(dir, 'secrets/upload.key');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /denylist/);
  assert.equal(readFileSync(join(dir, 'task.md'), 'utf8'), before);
  rmSync(dir, { recursive: true, force: true });
});

test('one refused file fails the whole command - a partly-fenced task looks fenced', () => {
  const dir = sandbox();
  const before = readFileSync(join(dir, 'task.md'), 'utf8');
  const r = fence(dir, 'SaveSystem.cs', 'secrets/upload.key');
  assert.equal(r.status, 2);
  assert.equal(readFileSync(join(dir, 'task.md'), 'utf8'), before,
    'the good file must not be written either, or the operator has to notice an absence');
  rmSync(dir, { recursive: true, force: true });
});

test('a secret inside an ordinary source file is redacted, and the operator is told', () => {
  const dir = sandbox();
  const r = fence(dir, 'leaky.cs');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /redacted/, 'silent redaction would hide that the file was altered');
  const after = readFileSync(join(dir, 'task.md'), 'utf8');
  assert.ok(!after.includes(SECRET));
  rmSync(dir, { recursive: true, force: true });
});

test('a large file is truncated with the truncation visible in the sent text', () => {
  const dir = sandbox();
  const r = fence(dir, 'big.cs');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /truncated/);
  const after = readFileSync(join(dir, 'task.md'), 'utf8');
  assert.match(after, /\[truncated: \d+ of \d+ bytes not shown\]`?/,
    'the seats must see that what they have is partial, not only the operator');
  rmSync(dir, { recursive: true, force: true });
});

test('paths are jailed to the repo, including through a symlink', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'outside.txt'), 'not yours');
  symlinkSync(join(dir, 'outside.txt'), join(dir, 'repo', 'link.cs'));
  assert.equal(fence(dir, '../outside.txt').status, 2);
  const viaLink = fence(dir, 'link.cs');
  assert.equal(viaLink.status, 2, 'a symlink resolving outside the repo must be refused');
  assert.match(viaLink.stderr, /symlink|outside/);
  rmSync(dir, { recursive: true, force: true });
});

test('fenceFile reports what happened, because "it worked" is not enough here', () => {
  const dir = sandbox();
  const block = fenceFile(join(dir, 'repo'), 'SaveSystem.cs');
  assert.equal(block.rel, 'SaveSystem.cs');
  assert.equal(block.truncated, false);
  assert.equal(block.redacted, 0);
  assert.match(block.text, /```csharp/, 'the fence is language-tagged from the extension');
  rmSync(dir, { recursive: true, force: true });
});

test('scanTaskForSecrets blocks rather than warns - a sent credential cannot be recalled', () => {
  assert.equal(scanTaskForSecrets('An ordinary task about apiKey handling.').clean, true);
  const bad = scanTaskForSecrets(`Use api_key = "${SECRET}" when testing.`);
  assert.equal(bad.clean, false);
  assert.match(bad.message, /rotate it if it was ever real/);
});

test('the secret scan covers prose already in the task, not only what fence adds', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'task.md'), `Review it. The key is api_key="${SECRET}".\n`);
  const r = fence(dir, 'SaveSystem.cs');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /NOT modified/);
  rmSync(dir, { recursive: true, force: true });
});

test('the header is written once, however many times fence is run', () => {
  const dir = sandbox();
  assert.equal(fence(dir, 'SaveSystem.cs').status, 0);
  assert.equal(fence(dir, 'leaky.cs').status, 0);
  const after = readFileSync(join(dir, 'task.md'), 'utf8');
  assert.equal(after.split('# Source, fenced verbatim').length - 1, 1);
  assert.match(after, /class SaveSystem/);
  assert.match(after, /leaky\.cs/);
  rmSync(dir, { recursive: true, force: true });
});
