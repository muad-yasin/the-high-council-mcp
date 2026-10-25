// CR-X3-002: the process dies while it takes the tree lock, the sitting lock or the views lock (power loss, a full disk) and leaves an EMPTY or half-written lock file. Before, every later tree step refused for
// good ("treat as held rather than guess"). Now an unreadable file in a tree's folder that is older than 30 seconds is the leftover of a take that never finished, and is replaced; a young one is still held, and the
// refusal names the file and the way out. The run lock (.council.lock) keeps "unreadable = held" on purpose. All offline, $0.
//
// How the files are made: a REAL child process does `openSync(path, 'wx')` (the create a take starts with) and is SIGKILLed before it writes, which leaves exactly an empty lock file. The one constructed part is the age:
// `utimesSync` backdates the file by a minute, because the rule is about age and a test must not wait 30 seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_FILE, RunLockedError, UNREADABLE_STALE_MS_BY_LOCK, acquireRunLock, lockHolder } from '../src/run-lock.js';
import { TREE_LOCK_FILE, treeDirOf, withTreeLock } from '../src/tree-record.js';
import { SITTING_LOCK_FILE, VIEWS_LOCK_FILE } from '../src/tree-files.js';

const here = dirname(fileURLToPath(import.meta.url));
const dirOf = () => mkdtempSync(join(tmpdir(), 'thc-lock-unreadable-'));
const DEAD_PID = 2 ** 22 + 12345;

/** An empty file where a lock goes, as a take that died right after the create leaves it: a real child does the create and is killed. */
async function killedTake(path) {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { openSync } from 'node:fs'; openSync(${JSON.stringify(path)}, 'wx'); process.stdout.write('created'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { child.stdout.once('data', res); child.once('error', rej); });
  const gone = new Promise(res => child.once('close', res));
  child.kill('SIGKILL');
  await gone;
  assert.equal(statSync(path).size, 0, 'the killed take left an empty file');
}
const backdate = (path, ms = 60_000) => { const t = new Date(Date.now() - ms); utimesSync(path, t, t); };

test('X3-5 the names the age rule is keyed by are the real lock file names (run-lock.js cannot import them without a cycle)', () => {
  assert.deepEqual(Object.keys(UNREADABLE_STALE_MS_BY_LOCK).sort(), [SITTING_LOCK_FILE, TREE_LOCK_FILE, VIEWS_LOCK_FILE].sort());
  for (const ms of Object.values(UNREADABLE_STALE_MS_BY_LOCK)) assert.equal(ms, 30_000, 'the gate ledger lock and send-path use 30 seconds');
  assert.equal(UNREADABLE_STALE_MS_BY_LOCK[LOCK_FILE], undefined, 'the run lock is not in the map');
});

test('X3-1 the tree lock: a young empty file is HELD and the refusal names the file and the wait; an old one is replaced and the write goes through', async () => {
  const rootDir = dirOf(); mkdirSync(treeDirOf(rootDir));
  const lock = join(treeDirOf(rootDir), TREE_LOCK_FILE);
  await killedTake(lock);
  assert.throws(() => withTreeLock(rootDir, () => assert.fail('must not run'), { tries: 1 }), err => {
    assert.ok(err instanceof RunLockedError);
    assert.equal(err.lockPath, lock);
    assert.match(err.message, /is empty or half-written/); assert.ok(err.message.includes(lock), err.message); assert.match(err.message, /older than 30 seconds/);
    assert.doesNotMatch(err.message, /pid null/);
    return true;
  });
  backdate(lock);
  let ran = false;
  withTreeLock(rootDir, () => { ran = true; });
  assert.equal(ran, true, 'the old empty file was a leftover');
  assert.equal(existsSync(lock), false, 'released at the end');
});

test('X3-2 the sitting lock and the views lock follow the same rule through acquireRunLock and lockHolder; the run lock does NOT (unreadable stays held for ever, and its refusal says to delete the file)', async () => {
  const d = dirOf();
  for (const file of [SITTING_LOCK_FILE, VIEWS_LOCK_FILE]) {
    const lock = join(d, file);
    await killedTake(lock);
    assert.equal(lockHolder(d, { file })?.unreadable, true, `${file} young: held`);
    assert.throws(() => acquireRunLock(d, { file }), err => err instanceof RunLockedError && /older than 30 seconds/.test(err.message));
    backdate(lock);
    assert.equal(lockHolder(d, { file }), null, `${file} old: no holder`);
    const release = acquireRunLock(d, { file });
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid, 'and it is ours now');
    release();
    assert.equal(existsSync(lock), false);
  }
  const run = join(d, LOCK_FILE);
  await killedTake(run); backdate(run);
  assert.equal(lockHolder(d)?.unreadable, true, 'the run lock: an old empty file is still held');
  assert.throws(() => acquireRunLock(d), err => err instanceof RunLockedError && err.message.includes(run) && /delete that file/.test(err.message) && !/older than/.test(err.message));
});

test('X3-3 an empty or half-written CLAIM (a takeover that died between its create and its write) does not lock every later takeover for ever: old, it is cleared and the take goes through at once; young, it is respected', async () => {
  const d = dirOf();
  const lock = join(d, SITTING_LOCK_FILE); const claim = `${lock}.claim`;
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'x' }));   // a stale lock, so the takeover goes through the claim
  await killedTake(claim);
  assert.throws(() => acquireRunLock(d, { file: SITTING_LOCK_FILE }), RunLockedError, 'a young claim is another taker in the middle of its write');
  assert.equal(existsSync(claim), true, 'and it is left alone');
  backdate(claim);
  const release = acquireRunLock(d, { file: SITTING_LOCK_FILE });
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
  assert.equal(existsSync(claim), false, 'the claim is gone');
  release();
  // a half-written claim (not just an empty one) is the same
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'y' }));
  writeFileSync(claim, '{"pid":12'); backdate(claim);
  acquireRunLock(d, { file: SITTING_LOCK_FILE })();
});

test('X3-4 a half-written lock, or one whose JSON is not an object, is read as unreadable, never as a holder, and never throws', () => {
  const d = dirOf();
  const lock = join(d, TREE_LOCK_FILE);
  for (const text of ['{"pid":12', 'null', '17', '"x"']) {
    writeFileSync(lock, text);
    assert.equal(lockHolder(d, { file: TREE_LOCK_FILE })?.unreadable, true, `${text} young`);
    backdate(lock);
    assert.equal(lockHolder(d, { file: TREE_LOCK_FILE }), null, `${text} old`);
    const release = acquireRunLock(d, { file: TREE_LOCK_FILE }); release();
  }
  writeFileSync(join(d, LOCK_FILE), 'null');
  assert.equal(lockHolder(d)?.unreadable, true, 'the run lock reads `null` as unreadable too (it used to throw a TypeError)');
});

test('X3-6 a take whose write THROWS never goes on as the holder: the error leaves acquireRunLock before a handle is returned and no empty lock or claim is left (a BigInt pid makes the JSON write throw after the create, the same shape as a full disk)', () => {
  const d = dirOf();
  const lock = join(d, SITTING_LOCK_FILE);
  const before = process.listenerCount('exit');
  assert.throws(() => acquireRunLock(d, { file: SITTING_LOCK_FILE, pid: 1n }), TypeError);
  assert.equal(existsSync(lock), false, 'no empty file behind');
  assert.equal(process.listenerCount('exit'), before, 'and no release handler: nothing was held');
  // the takeover branches too: a stale lock, then a throwing write for the new owner's body
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'x' }));
  assert.throws(() => acquireRunLock(d, { file: SITTING_LOCK_FILE, pid: 1n }), TypeError);
  assert.equal(existsSync(`${lock}.claim`), false, 'the claim is not left behind either');
  // and an absent-then-created lock still works for a normal take afterwards
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'y' }));
  acquireRunLock(d, { file: SITTING_LOCK_FILE })();
});

test('X3-7 a claim left by a process that is gone is cleared and the take goes through in the same attempt, for the run lock too (before, that attempt reported "locked" and only the next one succeeded)', () => {
  for (const file of [LOCK_FILE, SITTING_LOCK_FILE]) {
    const d = dirOf();
    const lock = join(d, file);
    writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'x' }));
    writeFileSync(`${lock}.claim`, JSON.stringify({ pid: DEAD_PID, host: hostname() }));
    const release = acquireRunLock(d, { file });
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid, file);
    assert.equal(existsSync(`${lock}.claim`), false);
    release();
  }
});
