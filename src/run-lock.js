// One process per run folder (2026-09-23 audit, Review/BugAudit_CLI_2026-09-23.md finding 4).
// Two `--resume`s of the same run (a CLI and an MCP resume_run, or two MCP calls) used to both
// pay for every uncached stage, each with its own budget, so together they could spend twice
// --max-usd. run.json's pid was written but never checked.
//
// The lock is a file created with O_EXCL (`wx`), so two processes can't both take it. It holds
// the owner's pid and host. A lock whose pid is dead on this host is stale (a crash, a kill -9)
// and is replaced; a lock from another host is never judged stale from here, since its pid
// means nothing on this machine.
import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const LOCK_FILE = '.council.lock';

export class RunLockedError extends Error {
  constructor(holder, lockPath) {
    super(`run is already running: pid ${holder.pid} on ${holder.host} holds ${lockPath} (since ${holder.at}). ` +
      'Two processes on one run pay for every stage twice. Wait for it, or stop it; ' +
      'if that process is gone and this is wrong, delete the lock file.');
    this.holder = holder;
  }
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, owned by someone else
  }
}

/** The current holder of `runDir`'s lock if a live process holds it, else null. Read-only. */
export function lockHolder(runDir) {
  let holder;
  try {
    holder = JSON.parse(readFileSync(join(runDir, LOCK_FILE), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // Unreadable or half-written: treat as held rather than guess. The message names the file.
    return { pid: null, host: 'unknown', at: 'unknown', unreadable: true };
  }
  if (holder.host === hostname() && !isPidAlive(holder.pid)) return null; // stale
  return holder;
}

/**
 * Takes `runDir`'s lock for this process, or throws RunLockedError. Returns release(), which
 * removes the lock only if it is still ours. Also released on process exit.
 */
export function acquireRunLock(runDir, { pid = process.pid } = {}) {
  const lockPath = join(runDir, LOCK_FILE);
  const mine = { pid, host: hostname(), at: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = lockHolder(runDir);
      if (holder) throw new RunLockedError(holder, lockPath);
      try { unlinkSync(lockPath); } catch { /* another process replaced it first; retry decides */ }
      continue;
    }
    writeSync(fd, JSON.stringify(mine));
    closeSync(fd);
    const release = () => {
      try {
        const now = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (now.pid === mine.pid && now.host === mine.host) unlinkSync(lockPath);
      } catch { /* already gone */ }
    };
    process.once('exit', release);
    return release;
  }
  throw new RunLockedError(lockHolder(runDir) ?? { pid: '?', host: '?', at: '?' }, lockPath);
}
