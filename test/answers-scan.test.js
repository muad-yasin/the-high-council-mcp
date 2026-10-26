// C&C (14 Oct 2026, B's "answers scan" defect; Muad 12 Oct: "the check should go everywhere"): the typed answers of a run paused at its `answers` stage are text a person typed, and they reach every later seat's prompt. On the CLI they are the file
// answers.md, read by the stage cache on `--resume`. Until now their only scan was invoke()'s send-time distinctiveOnly one, so a Bearer token, a URL credential and a NAME=secret line passed into later prompts. They now get the FULL input scan (the
// same textSecretFindings call every typed text uses) on resume, before any stage is replayed or paid for: exit 11, the file and the line named, never the value. Offline: the $0 chain mock-questions-wait in a fresh temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 120_000 });
const BEARER = 'Bearer a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
const URLCRED = 'postgres://app:RealPw9xQ@prod.corp.io/db';
const NAMED = 'DB_PASSWORD=Xk9fQ2mZ7vL4pR8sT1uW';
function paused() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-answers-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A small tool that turns a one-paragraph idea into a build plan.');
  const r = sh(dir, ['--chain', 'mock-questions-wait', '--task', 'tasks/x.md']);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  assert.ok(existsSync(join(run, 'NEEDS-answers.md')));
  return { dir, run };
}
const withPaused = fn => { const p = paused(); try { return fn(p); } finally { rmSync(p.dir, { recursive: true, force: true }); } };

test('AS-1 a typed answer holding a Bearer token, a URL credential and a NAME=secret line is refused on --resume (exit 11): the file and each line named, no value printed, nothing replayed or written', () => withPaused(({ dir, run }) => {
  writeFileSync(join(run, 'answers.md'), `1. default\n2. Authorization header is ${BEARER}\n3. the database is ${URLCRED}\n4. ${NAMED}\n`);
  const before = readdirSync(run).sort();
  const r = sh(dir, ['--resume', run]);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /answers\.md/);
  for (const line of [2, 3, 4]) assert.match(r.stderr, new RegExp(`stage\\):${line}\\s`), `line ${line} is named (the format is "<file>:<line>  <name>")`);
  for (const secret of ['a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6', 'RealPw9xQ', 'Xk9fQ2mZ7vL4pR8sT1uW']) assert.doesNotMatch(r.stdout + r.stderr, new RegExp(secret), 'a value is never printed');
  assert.deepEqual(readdirSync(run).sort(), before, 'nothing was written or replayed');
}));

test('AS-2 control (green before this change): clean typed answers resume and finish', () => withPaused(({ dir, run }) => {
  writeFileSync(join(run, 'answers.md'), '1. default\n2. default\n3. default\n');
  const r = sh(dir, ['--resume', run]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}));

test('AS-3 control: --allow-secret-shaped ("I read this text") still lets a person send an answer with a secret-shaped line, exactly as it does for the task file', () => withPaused(({ dir, run }) => {
  writeFileSync(join(run, 'answers.md'), `1. default\n2. ${NAMED}\n3. default\n`);
  const r = sh(dir, ['--resume', run, '--allow-secret-shaped']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(run, 'report.json')), 'the run finished with the answer sent as typed');
}));
