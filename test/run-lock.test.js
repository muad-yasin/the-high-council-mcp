// test/run-lock.test.js - one process per run folder (2026-09-23 audit, CLI finding 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync, utimesSync } from 'node:fs';
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

// ================================================================================================================================================================ the takeover race (8 Oct 2026)
// test/gate-ledger.test.js "two processes appending at once" went red 2 of ~26 whole-file runs with a LOST ledger line and a valid chain. Cause: on a failed create the takeover read "no holder" for an ABSENT lock too
// (its holder had just released it), took the claim, and renamed its own lock OVER one another process had created in the meantime, so two processes held the lock. These tests make that interleaving
// deterministic with the `_seam` option (test only): the file is changed at exactly the two points where another process could change it.
const holderJson = (extra = {}) => JSON.stringify({ pid: process.pid, host: hostname(), at: 'then', nonce: 'someone-else', ...extra });

test('a lock that is RELEASED between our failed create and our read is absent, not stale: when a third process creates a fresh lock before we take, we do NOT overwrite it (we are told it is locked) - the lost-update interleaving', () => {
  const d = dir();
  const lock = join(d, LOCK_FILE);
  writeFileSync(lock, holderJson({ nonce: 'first-holder' }));
  const fresh = holderJson({ nonce: 'third-process' });
  const stages = [];
  const seam = (stage, path) => {
    stages.push(stage);
    if (stage === 'after-exists') unlinkSync(path);                    // the first holder releases right now
    if (stage === 'before-take') writeFileSync(path, fresh, { flag: 'wx' });   // a third process takes the lock in the same gap
  };
  assert.throws(() => acquireRunLock(d, { _seam: seam }), RunLockedError);
  assert.deepEqual(stages, ['after-exists', 'after-claim-create', 'after-claim', 'before-take', 'before-rename']);   // CR-SOL-003 added 'after-claim-create' (the claim exists, not yet written) and, in the cross-read fix-up, 'before-rename' (the claim confirmed, the take not yet made): a changed accepted test, 26 Okt 2026
  assert.equal(readFileSync(lock, 'utf8'), fresh, 'the third process\'s lock is untouched');
  assert.equal(existsSync(`${lock}.claim`), false, 'and the claim is gone');
});

test('an absent lock at the takeover is created exclusively and becomes OUR lock, with no claim or temp file left behind', () => {
  const d = dir();
  const lock = join(d, LOCK_FILE);
  writeFileSync(lock, holderJson());
  const release = acquireRunLock(d, { _seam: (stage, path) => { if (stage === 'after-exists') unlinkSync(path); } });
  const mine = JSON.parse(readFileSync(lock, 'utf8'));
  assert.equal(mine.pid, process.pid); assert.notEqual(mine.nonce, 'someone-else');
  assert.equal(existsSync(`${lock}.claim`), false);
  assert.deepEqual(readdirSync(d).sort(), [LOCK_FILE]);
  release();
  assert.equal(existsSync(lock), false);
});

test('a stale lock (a dead pid on this host) is replaced BECAUSE nothing can change the file under the claim: a contender that tries to create the lock at the take point finds it existing (locked), and the claimant ends up holding it', () => {
  const d = dir();
  const lock = join(d, LOCK_FILE);
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), at: 'then' }));
  let contenderSaw = null;
  const release = acquireRunLock(d, { _seam: (stage, path) => {
    if (stage !== 'before-take') return;
    try { writeFileSync(path, holderJson({ nonce: 'contender' }), { flag: 'wx' }); contenderSaw = 'created'; } catch (e) { contenderSaw = e.code; }
    try { acquireRunLock(d); contenderSaw += '+acquired'; } catch (e) { contenderSaw += `+${e.constructor.name}`; }   // a second claimant meets the claim file
  } });
  assert.equal(contenderSaw, 'EEXIST+RunLockedError');
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
  release();
});

test('an unreadable lock is HELD while it is young (its writer is between the create and the write) and replaced once it is older than unreadableStaleMs (a crashed writer); with no threshold it is never replaced', () => {
  const d = dir();
  const lock = join(d, LOCK_FILE);
  writeFileSync(lock, '');                                             // created, not yet written
  assert.throws(() => acquireRunLock(d, { unreadableStaleMs: 30_000 }), RunLockedError);
  assert.throws(() => acquireRunLock(d), RunLockedError);
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(lock, old, old);
  assert.throws(() => acquireRunLock(d), RunLockedError, 'no threshold: never replaced');
  const release = acquireRunLock(d, { unreadableStaleMs: 30_000 });
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
  release();
});

test('another contender that finishes a takeover first (a live lock appears after our claim is taken) is respected: we are told it is locked and its lock is untouched', () => {
  const d = dir();
  const lock = join(d, LOCK_FILE);
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), at: 'then' }));    // stale, so we get to the claim
  const winner = holderJson({ nonce: 'finished-first' });
  assert.throws(() => acquireRunLock(d, { _seam: (stage, path) => { if (stage === 'after-claim') writeFileSync(path, winner); } }), RunLockedError);
  assert.equal(readFileSync(lock, 'utf8'), winner);
  assert.equal(existsSync(`${lock}.claim`), false);
});

test('a lock file that a third process has created but not yet written (young, empty) when we look after our claim is HELD, with or without a threshold: we are told it is locked and we leave the file alone', () => {
  for (const opts of [{}, { unreadableStaleMs: 30_000 }]) {
    const d = dir();
    const lock = join(d, LOCK_FILE);
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), at: 'then' }));    // stale, so we get to the claim
    assert.throws(() => acquireRunLock(d, { ...opts, _seam: (stage, path) => { if (stage === 'after-claim') writeFileSync(path, ''); } }), RunLockedError, JSON.stringify(opts));
    assert.equal(readFileSync(lock, 'utf8'), '', 'the young file is untouched');
    assert.equal(existsSync(`${lock}.claim`), false);
  }
});
