// 0.8.1 FX-8 (the 2026-10-02 audit of 0.8.0, finding 8): a run stopped on a key-shaped prompt (STOPPED-secret.md) read
// as resumable with nothing to do (reason process_gone). The stop file itself says what to do: fix the cause, or resume
// with --allow-secret-shaped. So it reads resumable, reason secret_blocked, needs fix_cause; the plan said resumable false,
// which would hide the resume the stop file offers (deviation recorded in Review/0.8.1-decisions.md). Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResumability } from '../src/run-status.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
const KEY = ['sk', '-ant-api03-', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7d'].join(''); // synthetic, built here

test('FX-8: a key-shaped stop reads resumable with the cause to fix (secret_blocked, fix_cause), and the resume it offers works', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx8-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  assert.equal(run(dir, ['--chain', 'mock-external', '--task', 'tasks/t.md']).status, 3);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  const pending = readdirSync(runDir).find(f => f.startsWith('NEEDS-')).slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(runDir, `${pending}.md`), `# Plan\n\nUse ${KEY} here.\n`);
  assert.equal(run(dir, ['--resume', join('runs', id)]).status, 11);
  const s = runResumability(runDir, JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')));
  assert.deepEqual([s.resumable, s.reason, s.needs], [true, 'secret_blocked', 'fix_cause']);
  // The proof that "not resumable" would have been wrong: the resume the stop file names goes through.
  assert.notEqual(run(dir, ['--resume', join('runs', id), '--allow-secret-shaped']).status, 11);
});
