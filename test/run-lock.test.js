// test/run-lock.test.js - one process per run folder (2026-09-23 audit, CLI finding 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { acquireRunLock, lockHolder, RunLockedError, LOCK_FILE } from '../src/run-lock.js';

const dir = () => mkdtempSync(join(tmpdir(), 'thc-lock-'));

test('a second acquire on a held run throws, naming the holder', () => {
  const d = dir();
  const release = acquireRunLock(d);
  assert.throws(() => acquireRunLock(d, { pid: process.pid + 1 }), (err) => err instanceof RunLockedError && /pid \d+/.test(err.message));
  release();
  assert.equal(existsSync(join(d, LOCK_FILE)), false);
});

test('a lock left by a dead process on this host is stale and gets replaced', () => {
  const d = dir();
  writeFileSync(join(d, LOCK_FILE), JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), at: 'then' }));
  assert.equal(lockHolder(d), null);
  const release = acquireRunLock(d);
  assert.equal(JSON.parse(readFileSync(join(d, LOCK_FILE), 'utf8')).pid, process.pid);
  release();
});

test('a lock held by a live process is respected', async () => {
  const d = dir();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    writeFileSync(join(d, LOCK_FILE), JSON.stringify({ pid: child.pid, host: hostname(), at: 'now' }));
    assert.throws(() => acquireRunLock(d), RunLockedError);
  } finally {
    child.kill();
  }
});

test('a lock from another host is never judged stale from here', () => {
  const d = dir();
  writeFileSync(join(d, LOCK_FILE), JSON.stringify({ pid: 1, host: 'some-other-host', at: 'now' }));
  assert.throws(() => acquireRunLock(d), RunLockedError);
});

test('an unreadable lock counts as held, not as free', () => {
  const d = dir();
  writeFileSync(join(d, LOCK_FILE), '{"pid": 12');
  assert.ok(lockHolder(d));
  assert.throws(() => acquireRunLock(d), RunLockedError);
});

test('release leaves a lock alone once someone else holds it', () => {
  const d = dir();
  const release = acquireRunLock(d);
  writeFileSync(join(d, LOCK_FILE), JSON.stringify({ pid: process.pid + 7, host: hostname(), at: 'later' }));
  release();
  assert.equal(existsSync(join(d, LOCK_FILE)), true);
});
