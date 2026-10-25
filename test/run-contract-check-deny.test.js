// R16 (security baseline; found while building the M6 readiness reader): `contractCheckOf` reads the task path and the context paths a run.json names. Under MCP the run folder is DATA (as untrusted as the path inside
// it), so a `.env`-shaped task path, or a context path outside the working folder, would be read and hashed - an existence / content oracle on a secret file through the verdict. `deny` (the secret denylist, src/tools.js
// isDeniedPath) is what every MCP caller passes; with it the task path is refused if denied and every context path must be a regular file inside the working folder and not denied. The CLI on the person's own folder
// passes none and is unchanged. A real $0 mock run is made once; the tests tamper with COPIES of its run folder.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractCheckOf } from '../src/run-contract-check.js';
import { isDeniedPath } from '../src/tools.js';

const text = c => c.shown.out.join('\n');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

let shared;
function runOnce() {
  if (shared) return shared;
  const dir = mkdtempSync(join(tmpdir(), 'thc-deny-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'ctx'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  writeFileSync(join(dir, 'ctx', 'notes.md'), 'Readers prefer short lists.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'tc.json'), JSON.stringify({ ...cfg, name: 'tc' }));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'tc', '--task', 'tasks/t.md', '--context', 'ctx/notes.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  shared = { dir, run: join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]) };
  return shared;
}
/** the unguarded reader resolves relative context paths against the process cwd; the CLI runs it from the working folder, so the test does too */
function fromCwd(dir, fn) { const cwd = process.cwd(); process.chdir(dir); try { return fn(); } finally { process.chdir(cwd); } }
/** a copy of the run folder whose run.json is edited by `edit` */
function tampered(edit) {
  const { dir, run } = runOnce();
  const copy = join(dir, 'runs', `copy-${Math.random().toString(36).slice(2, 8)}`);
  cpSync(run, copy, { recursive: true });
  const meta = JSON.parse(readFileSync(join(copy, 'run.json'), 'utf8')); edit(meta, dir);
  writeFileSync(join(copy, 'run.json'), JSON.stringify(meta));
  return copy;
}

test('the control: an untouched run checks sealed (exit 0) with and without the denylist', () => {
  const { dir, run } = runOnce();
  assert.equal(contractCheckOf(run, { work: dir }).exit, 0);
  assert.equal(contractCheckOf(run, { work: dir, deny: isDeniedPath }).exit, 0, 'a relative context path is resolved against the working folder, not the server\'s cwd');
});

test('a `.env`-shaped TASK path in run.json: read and hashed without the denylist (the oracle), refused with it', () => {
  const copy = tampered((meta, dir) => { writeFileSync(join(dir, '.env'), 'Plan a small reading list app.\n'); meta.task = '.env'; });
  const { dir } = runOnce();
  const open = fromCwd(dir, () => contractCheckOf(copy, { work: dir }));
  assert.match(text(open), /ok: task: the task file still has the text the run was given/, 'the CLI on the person\'s own folder still reads it (no deny): this is the oracle an MCP caller must not get');
  const guarded = contractCheckOf(copy, { work: dir, deny: isDeniedPath });
  assert.match(text(guarded), /cannot check: task: the task file is not readable from here/, 'the denied file was not read: the task is "cannot check", not compared');
  assert.doesNotMatch(text(guarded), /ok: task: the task file still has the text/);
});

test('a CONTEXT path in run.json outside the working folder, or `.env`-shaped inside it: read without the denylist, refused with it', () => {
  const outside = mkdtempSync(join(tmpdir(), 'thc-deny-out-')); made.push(outside);
  writeFileSync(join(outside, 'notes.md'), 'Readers prefer short lists.\n');
  const farCopy = tampered(meta => { meta.context = join(outside, 'notes.md'); });
  const envCopy = tampered((meta, dir) => { writeFileSync(join(dir, 'ctx', '.env'), 'Readers prefer short lists.\n'); meta.context = 'ctx/.env'; });
  const { dir } = runOnce();
  for (const [label, copy] of [['outside the working folder', farCopy], ['.env inside it', envCopy]]) {
    // the unguarded reader resolves relative paths against the process cwd; run it from the working folder as the CLI does
    const open = fromCwd(dir, () => contractCheckOf(copy, { work: dir }));
    assert.doesNotMatch(text(open), /cannot check: context/, `${label}: without deny the file IS read (compared: ok or drift)`);
    const guarded = contractCheckOf(copy, { work: dir, deny: isDeniedPath });
    assert.match(text(guarded), /cannot check: context: the --context documents are not readable from here/, `${label}: with deny it is not read at all`);
  }
});

test('a context file that is a link inside the working folder keeps the heading it was named with, and what is READ is the real file that was checked - a link swapped between the check and the read reads nothing outside (R16 follow-up: check-then-read)', async () => {
  const { symlinkSync, renameSync } = await import('node:fs');
  const { contextFilesInside } = await import('../src/run-files.js');
  const { contextBundleText } = await import('../src/context-files.js');
  const dir = mkdtempSync(join(tmpdir(), 'thc-deny-ln-')); made.push(dir);
  const outside = mkdtempSync(join(tmpdir(), 'thc-deny-sw-')); made.push(outside);
  writeFileSync(join(outside, 'secret.md'), 'NOT FOR THE VERDICT\n');
  mkdirSync(join(dir, 'ctx')); writeFileSync(join(dir, 'ctx', 'notes.md'), 'Readers prefer short lists.\n'); symlinkSync('notes.md', join(dir, 'ctx', 'link.md'));
  const files = contextFilesInside('ctx/link.md', dir, isDeniedPath);
  assert.equal(files.length, 1); assert.equal(files[0].title, 'link.md', 'the heading is the name the run was sealed with');
  assert.equal(files[0].path.split('/').pop(), 'notes.md', 'and the file to read is the real path that was checked');
  // the swap: after the check the link is pointed outside the working folder
  renameSync(join(dir, 'ctx', 'link.md'), join(dir, 'ctx', 'link.moved')); symlinkSync(join(outside, 'secret.md'), join(dir, 'ctx', 'link.md'));
  const text = contextBundleText(files);
  assert.match(text, /^## link\.md\n\nReaders prefer short lists\./); assert.equal(text.includes('NOT FOR THE VERDICT'), false, 'the swapped link was not followed');
  assert.throws(() => contextFilesInside('ctx/link.md', dir, isDeniedPath), /outside the working folder/, 'a fresh check of the swapped link refuses it');
  assert.throws(() => contextFilesInside('ctx/link.moved', dir, p => /notes/.test(p)), /denylist/, 'the denylist looks at the REAL path the link points to');
  assert.throws(() => contextFilesInside('ctx/gone.md', dir, isDeniedPath), /ENOENT|no such file/, 'a context file that is gone throws: deliberate, the caller reads it as "not readable from here"');
});
