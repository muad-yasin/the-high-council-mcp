// CR-SOL-002 and CR-SOL-003 (26 Okt 2026): two ways two processes both came back from acquireRunLock holding the same lock, found by a review of CR-X3-002's lock code. The REAL module is driven through its test seams;
// two contenders are real child processes whose seam callbacks wait for marker files, so each interleaving is exact. All offline, $0.
//   S-1 / CR-SOL-002  A creates the file and is suspended before its body write for longer than the age rule; B replaces the empty file; A resumes, writes into the replaced file and used to return holding.
//   S-2 / CR-SOL-003  the lock and its claim belong to a dead owner; A judges the claim abandoned and pauses; B clears it, makes its own claim and reads the lock as stale; A resumes and used to clear B's fresh claim
//                     and take the lock too; B then renamed over A's lock.
// The constructed parts: the dead owner's lock and claim are written as JSON naming a process that is gone; the age is made by `utimesSync` (a test must not wait 30 seconds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireRunLock, RunLockedError } from '../src/run-lock.js';
import { SITTING_LOCK_FILE } from '../src/tree-files.js';
import { TREE_LOCK_FILE } from '../src/tree-record.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'run-lock.js');
const DEAD_PID = 2 ** 22 + 12345;   // above the largest process id the kernel hands out (pid_max is at most 2^22), so no process is ever alive under it; the pid of a child that exited can be handed to a new process within seconds on a busy machine
const dirOf = () => mkdtempSync(join(tmpdir(), 'thc-two-owners-'));

/** A real contender. `pause` names the seam stage where it stops and says so; it goes on when `<name>-go` appears; it prints `held` or `locked`, and keeps the hold until `done` appears (so its exit cannot release it before the test counts). */
function contender(dir, marks, file, name, { pause, bigintPid = false } = {}) {
  const code = `
    import { acquireRunLock } from ${JSON.stringify(SRC)};
    import { existsSync } from 'node:fs';
    import { join } from 'node:path';
    const nap = new Int32Array(new SharedArrayBuffer(4));
    const wait = f => { const t = Date.now(); while (!existsSync(f)) { if (Date.now() - t > 25000) { console.log('timeout ' + f); process.exit(3); } Atomics.wait(nap, 0, 0, 10); } };
    const say = s => console.log(s);
    try {
      acquireRunLock(${JSON.stringify(dir)}, { file: ${JSON.stringify(file)}, ${bigintPid ? 'pid: 1n, ' : ''}_seam: stage => { if (stage === ${JSON.stringify(pause ?? '')}) { say('paused ' + stage); wait(join(${JSON.stringify(marks)}, ${JSON.stringify(`${name}-go`)})); } } });
      say('held ' + process.pid);
    } catch (e) { say(e.constructor.name === 'RunLockedError' ? 'locked' : 'error ' + e.name); }
    wait(join(${JSON.stringify(marks)}, 'done'));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = []; let buf = ''; const waiters = [];
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } waiters.splice(0).forEach(w => w()); });
  const next = pattern => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${name}: no line matching ${pattern} (seen: ${JSON.stringify(lines)})`)), 30000);
    const look = () => { const i = lines.findIndex(l => pattern.test(l)); if (i >= 0) { clearTimeout(t); res(lines.splice(0, i + 1).pop()); } else waiters.push(look); };
    look();
  });
  const exited = new Promise(res => child.once('close', res));
  return { child, next, exited, name };
}
const go = (marks, name) => writeFileSync(join(marks, `${name}-go`), 'x');
async function finish(marks, ...cs) { writeFileSync(join(marks, 'done'), 'x'); await Promise.all(cs.map(c => c.exited)); }
const kill = (...cs) => cs.forEach(c => { try { c.child.kill('SIGKILL'); } catch { /* gone */ } });

test('S-2 / CR-SOL-003: two contenders clearing one dead claim end with ONE owner; the lock on disk is that owner\'s (the base: both return holding)', async () => {
  const dir = dirOf(); const marks = dirOf(); const lock = join(dir, TREE_LOCK_FILE);
  const dead = JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'dead' });
  writeFileSync(lock, dead); writeFileSync(`${lock}.claim`, JSON.stringify({ pid: DEAD_PID, host: hostname() }));
  const A = contender(dir, marks, TREE_LOCK_FILE, 'A', { pause: 'before-clear' });
  let B;                                                          // started only after A has stopped: two contenders started together race to the claim and the interleaving is theirs, not ours
  try {
    await A.next(/^paused before-clear$/);                       // A judged the old claim abandoned and stops
    B = contender(dir, marks, TREE_LOCK_FILE, 'B', { pause: 'before-take' });
    await B.next(/^paused before-take$/);                        // B cleared it, made its own claim and read the lock as stale
    go(marks, 'A');
    const a = await A.next(/^(held|locked)/);                    // A goes on: it must not clear B's fresh claim
    go(marks, 'B');
    const b = await B.next(/^(held|locked)/);
    const holders = [a, b].filter(l => l.startsWith('held'));
    assert.equal(holders.length, 1, `exactly one owner; A said "${a}", B said "${b}"`);
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, Number(holders[0].split(' ')[1]), 'and the lock on disk is that owner\'s');
    assert.equal(existsSync(`${lock}.claim`), false, 'no claim is left behind');
  } finally { const all = [A, B].filter(Boolean); await finish(marks, ...all).catch(() => kill(...all)); kill(...all); }
});

test('S-1 / CR-SOL-002: a taker suspended between its create and its body write for longer than the age rule does not come back holding when another process has replaced its empty file (the base: both return holding)', async () => {
  const dir = dirOf(); const marks = dirOf(); const lock = join(dir, SITTING_LOCK_FILE);
  const A = contender(dir, marks, SITTING_LOCK_FILE, 'A', { pause: 'after-create' });
  try {
    await A.next(/^paused after-create$/);                       // A has created the empty file and is suspended
    const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);   // the one constructed part: the suspension lasted longer than 30 seconds
    const releaseB = acquireRunLock(dir, { file: SITTING_LOCK_FILE });       // B reads the aged empty file as a crashed take and replaces it
    go(marks, 'A');
    const a = await A.next(/^(held|locked)/);                    // A resumes and writes its body into the file that was replaced
    assert.equal(a, 'locked', `A said "${a}" while B holds the lock: A must not hold a lock it no longer has`);
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid, 'the lock on disk is still B\'s');
    releaseB();
    assert.equal(existsSync(lock), false, 'and B releases it');
  } finally { await finish(marks, A).catch(() => kill(A)); kill(A); }
});

test('S-1 (the failure path): a suspended taker whose body write then throws does not remove the lock that replaced its file (the base: B\'s lock is unlinked and a third contender could take it)', async () => {
  const dir = dirOf(); const marks = dirOf(); const lock = join(dir, SITTING_LOCK_FILE);
  const A = contender(dir, marks, SITTING_LOCK_FILE, 'A', { pause: 'after-create', bigintPid: true });   // CONSTRUCTED failure: a BigInt pid makes the JSON write throw after the create, the same shape as a full disk
  try {
    await A.next(/^paused after-create$/);
    const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);
    const releaseB = acquireRunLock(dir, { file: SITTING_LOCK_FILE });
    go(marks, 'A');
    const a = await A.next(/^(held|locked|error)/);
    assert.match(a, /^error/, 'A\'s write failed');
    assert.equal(existsSync(lock), true, 'B\'s lock is still there');
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
    releaseB();
  } finally { await finish(marks, A).catch(() => kill(A)); kill(A); }
});

test('CR-SOL-003 (the claim is ours): a takeover whose claim was taken from it stops before it replaces anything and leaves the other contender\'s claim alone (the base: it renames over the lock and removes the other\'s claim)', () => {
  const dir = dirOf(); const lock = join(dir, SITTING_LOCK_FILE); const claim = `${lock}.claim`;
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'dead' }));
  const other = JSON.stringify({ pid: process.pid, host: hostname(), nonce: 'another-contender' });
  assert.throws(() => acquireRunLock(dir, { file: SITTING_LOCK_FILE, _seam: (stage, path) => {
    if (stage === 'before-take') { unlinkSync(`${path}.claim`); writeFileSync(`${path}.claim`, other); }   // another contender cleared our claim and made its own in the gap
  } }), RunLockedError);
  assert.equal(readFileSync(claim, 'utf8'), other, 'the other contender\'s claim is untouched');
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).nonce, 'dead', 'and the lock was not replaced');
});

test('S-3 (the claim has the same shape, found in the cross-read): a claimant suspended between creating its claim and writing it, for longer than the age rule, finds its claim replaced by another contender\'s and does not take the lock (the base: both return holding)', async () => {
  const dir = dirOf(); const marks = dirOf(); const lock = join(dir, SITTING_LOCK_FILE); const claim = `${lock}.claim`;
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'dead' }));   // a dead owner's lock, so the takeover goes through the claim
  const A = contender(dir, marks, SITTING_LOCK_FILE, 'A', { pause: 'after-claim-create' });
  let B;
  try {
    await A.next(/^paused after-claim-create$/);                 // A created its (empty) claim and is suspended
    const old = new Date(Date.now() - 60_000); utimesSync(claim, old, old);   // the one constructed part: the suspension lasted longer than 30 seconds
    B = contender(dir, marks, SITTING_LOCK_FILE, 'B', { pause: 'before-take' });
    await B.next(/^paused before-take$/);                        // B judged A's claim abandoned, made its own, and read the lock as stale
    go(marks, 'A');
    const a = await A.next(/^(held|locked)/);                    // A resumes, writes its claim body into the file that was replaced, and must see that the claim at the path is not its own
    go(marks, 'B');
    const b = await B.next(/^(held|locked)/);
    const holders = [a, b].filter(l => l.startsWith('held'));
    assert.equal(holders.length, 1, `exactly one owner; A said "${a}", B said "${b}"`);
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, Number(holders[0].split(' ')[1]), 'and the lock on disk is that owner\'s');
  } finally { const all = [A, B].filter(Boolean); await finish(marks, ...all).catch(() => kill(...all)); kill(...all); }
});

test('X-1 / CR-SOL-003 (cross-read): a contender suspended between judging a claim abandoned and moving it aside does not destroy the LIVE claim that has replaced it, so a third contender cannot take the lock beside the owner (the base: both D and B return holding)', async () => {
  const dir = dirOf(); const marks = dirOf(); const lock = join(dir, TREE_LOCK_FILE);
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'dead' })); writeFileSync(`${lock}.claim`, JSON.stringify({ pid: DEAD_PID, host: hostname() }));
  const A = contender(dir, marks, TREE_LOCK_FILE, 'A', { pause: 'before-tomb' });     // A judged the old claim abandoned, twice, and stops before it moves it aside
  let B; let D;
  try {
    await A.next(/^paused before-tomb$/);
    B = contender(dir, marks, TREE_LOCK_FILE, 'B', { pause: 'before-rename' });       // B clears the old claim, makes its own, confirms it, and stops before it takes the lock
    await B.next(/^paused before-rename$/);
    go(marks, 'A');
    const a = await A.next(/^(held|locked)/);                                         // A resumes and moves aside what is now B's LIVE claim
    assert.equal(a, 'locked');
    D = contender(dir, marks, TREE_LOCK_FILE, 'D', {});                               // a third contender arrives while B is still before its take
    const d = await D.next(/^(held|locked)/);
    go(marks, 'B');
    const b = await B.next(/^(held|locked)/);
    const holders = [a, b, d].filter(l => l.startsWith('held'));
    assert.equal(holders.length, 1, `exactly one owner; A said "${a}", B said "${b}", D said "${d}"`);
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, Number(holders[0].split(' ')[1]), 'and the lock on disk is that owner\'s');
  } finally { const all = [A, B, D].filter(Boolean); await finish(marks, ...all).catch(() => kill(...all)); kill(...all); }
});

test('X-1 (after the take): a take whose claim was destroyed after its check, with another contender taking the lock in that gap, is undone: it holds nothing (the base: both return holding)', () => {
  const dir = dirOf(); const lock = join(dir, SITTING_LOCK_FILE); const claim = `${lock}.claim`;
  writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, host: hostname(), at: 'then', nonce: 'dead' }));
  let inner = null;
  assert.throws(() => acquireRunLock(dir, { file: SITTING_LOCK_FILE, _seam: (stage, path) => {
    if (stage !== 'before-rename') return;
    unlinkSync(claim);                                              // a contender moved our claim aside and destroyed it after our check
    inner = acquireRunLock(dir, { file: SITTING_LOCK_FILE });       // and a third contender took the lock in the gap
  } }), RunLockedError, 'the take that lost its claim is refused');
  assert.ok(inner, 'the third contender holds');
  inner();
});
