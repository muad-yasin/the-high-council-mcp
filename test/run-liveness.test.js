// Liveness (13 Oct 2026, C&C's ruling after the api-abort failure at the batch suite): `running` is said only about a pid alive on THIS host, read in one stated order
// (src/run-status.js isRunAlive): a live lock holder -> a live spawn pid (.spawn.json, the server's record of the child it just spawned) -> the run.json pid -> otherwise
// `stopped`. The old fallback, a machine-wide `pgrep -af src/cli.js`, answered `running` for a DEAD run whenever anything else was running (a parallel test, another session;
// in the packaged binary the server's own process), and `run_status until: settled` then held to its limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveRunStatus, isRunAlive, SPAWN_FILE } from '../src/run-status.js';

const folder = () => mkdtempSync(join(tmpdir(), 'thc-live-'));
const deadPid = () => { const r = spawnSync(process.execPath, ['-e', '0']); return r.pid; }; // a pid that existed and has exited
const lock = (dir, pid, host = hostname()) => writeFileSync(join(dir, '.council.lock'), JSON.stringify({ pid, host }));
const spawnFile = (dir, pid, host = hostname()) => writeFileSync(join(dir, SPAWN_FILE), JSON.stringify({ pid, host, at: new Date().toISOString() }));
// A stand-in for "another council process on the machine" (what a parallel test or another session is): its command line contains src/cli.js.
const bystander = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', 'src/cli.js'], { stdio: 'ignore' });
const withBystander = async fn => { const b = bystander(); try { await once(b, 'spawn'); return await fn(); } finally { b.kill(); } }; // 'spawn' = the process exists and has its command line

test('a dead run with no run.json reads stopped even while ANOTHER council process runs on the machine (the ghost: it used to read running)', async () => {
  await withBystander(() => {
    const dir = folder();
    assert.equal(deriveRunStatus(dir, null), 'stopped');
    lock(dir, deadPid());
    assert.equal(deriveRunStatus(dir, null), 'stopped', 'a stale lock (its pid has exited) is not a live holder');
    assert.equal(deriveRunStatus(folder(), { pid: deadPid() }), 'stopped', 'a run.json whose pid has exited, beside a live bystander');
  });
});

test('the read order: a live lock holder, then a live spawn pid (a just-spawned child, a resumed child), then the run.json pid; each says running, none of them is a guess', () => {
  const live = process.pid; // this test process: alive, on this host
  const a = folder(); lock(a, live);
  assert.equal(deriveRunStatus(a, null), 'running', '(1) a live lock holder, no run.json');
  const b = folder(); spawnFile(b, live);
  assert.equal(deriveRunStatus(b, null), 'running', '(2) the window between the spawn and the lock: no lock, no run.json, the server recorded the child');
  const c = folder(); spawnFile(c, live);
  assert.equal(deriveRunStatus(c, { pid: deadPid() }), 'running', '(2) a resume: the old run.json pid is dead, the resumed child is not locked yet');
  assert.equal(deriveRunStatus(folder(), { pid: live }), 'running', '(3) the run.json pid of a live process');
  const d = folder(); spawnFile(d, deadPid());
  assert.equal(deriveRunStatus(d, null), 'stopped', 'a spawn pid that has exited is not a live child');
});

test('a holder or spawn record from another host, or an unreadable lock, is not a pid we can check: it does not read running', () => {
  const a = folder(); lock(a, process.pid, 'some-other-machine');
  assert.equal(isRunAlive(a, null), false);
  const b = folder(); spawnFile(b, process.pid, 'some-other-machine');
  assert.equal(isRunAlive(b, null), false);
  const c = folder(); writeFileSync(join(c, '.council.lock'), '{ half-written');
  assert.equal(isRunAlive(c, null), false);
});
