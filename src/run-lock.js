// One process per run folder (2026-09-23 audit, Review/BugAudit_CLI_2026-09-23.md finding 4).
// Two `--resume`s of the same run (a CLI and an MCP resume_run, or two MCP calls) used to both
// pay for every uncached stage, each with its own budget, so together they could spend twice
// --max-usd. run.json's pid was written but never checked.
//
// The lock is a file created with O_EXCL (`wx`), so two processes can't both take it. It holds
// the owner's pid and host. A lock whose pid is dead on this host is stale (a crash, a kill -9)
// and is replaced; a lock from another host is never judged stale from here, since its pid
// means nothing on this machine.
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, writeFileSync, renameSync, statSync, fstatSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const LOCK_FILE = '.council.lock';

// Which lock files get an age rule for an UNREADABLE file (empty, or half-written) without the caller asking for one: the lock names in a tree's folder (the tree record, the sitting, the views).
// The bound is the one the approvals ledger's lock and send-path's run-lock take already use: 30 seconds. Why age is a safe judge here and judges no process: a take writes its JSON in the very next
// call after it creates the file, so a live take is unreadable for microseconds, and a live holder (on any host) always has readable JSON in the file. A file that is still unreadable after 30 seconds
// therefore only says that no take ever finished (a power cut or a full disk between the create and the write). The run lock (.council.lock) is not listed: it keeps "unreadable = held" (a named asymmetry,
// CR-X3-002). test/run-lock.test.js pins these names to TREE_LOCK_FILE, SITTING_LOCK_FILE and VIEWS_LOCK_FILE (src/tree-record.js, src/tree-files.js), which this module cannot import without a cycle.
export const UNREADABLE_STALE_MS_BY_LOCK = Object.freeze({ '.tree.lock': 30_000, '.sitting.lock': 30_000, '.views.lock': 30_000 });
const staleMsOf = (file, given) => given ?? UNREADABLE_STALE_MS_BY_LOCK[file];

// A-DRAFT (CR-X3-002): what a person reads when the lock file cannot be read.
const unreadableWords = (lockPath, staleMs) => `${lockPath} is empty or half-written (a power cut or a full disk can leave that), so it is not known who holds it. ` +
  (staleMs > 0 ? `If it is older than ${Math.round(staleMs / 1000)} seconds the next try replaces it; try again then. If it stays, delete that file.` : 'If no other process is working on this run, delete that file.');

export class RunLockedError extends Error {
  constructor(holder, lockPath) {
    super(holder?.unreadable ? unreadableWords(lockPath, holder.staleMs) : `run is already running: pid ${holder.pid} on ${holder.host} holds ${lockPath} (since ${holder.at}). ` +
      'Two processes on one run pay for every stage twice. Wait for it, or stop it; ' +
      'if that process is gone and this is wrong, delete the lock file.');
    this.holder = holder;
    this.lockPath = lockPath;
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
//
// `unreadableStaleMs` (0.8.1, opt-in, the gate ledger's lock): a lock file that cannot be parsed and is older than this (by mtime) is stale rather than held forever. Unset, the bound comes from
// UNREADABLE_STALE_MS_BY_LOCK by the file's name (the tree folder's locks, CR-X3-002); for any other name nothing changes: the run lock treats an unreadable file as held.
export function lockHolder(runDir, { file = LOCK_FILE, unreadableStaleMs } = {}) {
  const bound = staleMsOf(file, unreadableStaleMs);
  let holder;
  try {
    holder = JSON.parse(readFileSync(join(runDir, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    holder = null;   // unreadable, below
  }
  if (!holder || typeof holder !== 'object') {   // also JSON `null` or a bare number: a file with no holder in it
    if (bound > 0) {
      try { if (Date.now() - statSync(join(runDir, file)).mtimeMs > bound) return null; } catch { return null; /* gone meanwhile */ }
    }
    // Unreadable or half-written: treat as held rather than guess. The message names the file.
    return { pid: null, host: 'unknown', at: 'unknown', unreadable: true, staleMs: bound > 0 ? bound : 0 };
  }
  if (holder.host === hostname() && !isPidAlive(holder.pid)) return null; // stale
  return holder;
}

/**
 * Takes `runDir`'s lock for this process, or throws RunLockedError. Returns release(), which
 * removes the lock only if it is still ours. Also released on process exit.
 */
//
// Pre-release audit, CLI #4 (Review/PreRelease_Audit_cli_2026-09-23.md): taking over a stale lock was
// unlink-then-create, so a second contender could unlink the first one's fresh lock and both held it
// (12 of 60 trials with three processes). A takeover now needs a claim: `<lock>.claim` is created
// with O_EXCL, so exactly one contender at a time may replace a stale lock, and it re-checks that the
// lock is still stale before replacing it (atomically, by rename). Everyone else backs off as locked.
// No timing is involved, so a loaded machine cannot reopen the race. A claim left by a dead process
// is cleared and the claim is tried once more at once (CR-X3-002; before, that attempt reported the run as locked).
// What the lock file ITSELF says right now, for the takeover (8 Oct 2026, found by the ledger concurrency test "two processes appending at once": 2 red of ~26 whole-file runs, a LOST ledger line with a valid chain):
//   'absent'  there is no lock file (its holder released it a moment ago);
//   'held'    a live holder, a holder on another host, or a file that cannot be read yet (its writer is between creating it and writing it);
//   'stale'   a holder on this host whose pid is dead, or an unreadable file older than `unreadableStaleMs` (opt-in, the gate ledger's lock): a crashed writer.
// lockHolder() above answers null for ALL of 'absent' and 'stale', which is why the takeover must not branch on it alone: an absent lock is not a stale one.
function lockFileState(lockPath, unreadableStaleMs) {
  let text;
  try { text = readFileSync(lockPath, 'utf8'); } catch (err) { return err.code === 'ENOENT' ? 'absent' : 'held'; }
  let holder = null;
  try { holder = JSON.parse(text); } catch { /* unreadable: below */ }
  if (!holder || typeof holder !== 'object') {
    if (!(unreadableStaleMs > 0)) return 'held';
    try { return Date.now() - statSync(lockPath).mtimeMs > unreadableStaleMs ? 'stale' : 'held'; } catch (err) { return err.code === 'ENOENT' ? 'absent' : 'held'; }
  }
  return holder.host === hostname() && !isPidAlive(holder.pid) ? 'stale' : 'held';
}

// Writes `body` as JSON into the file this process has just created (`wx`). If the write throws, or comes up short (a full disk can return fewer bytes without throwing), the file is closed and removed and the error
// leaves acquireRunLock: NO handle is returned, so nothing runs behind an empty or half-written lock (CR-X3-002: the sitting lock is the gate in front of paid starts, and a file that stays unreadable is replaced
// after 30 seconds, which is only sound if its taker never went on as the holder).
function writeLockBody(fd, path, body, { removeOnFail = true } = {}) {
  try {
    const text = JSON.stringify(body);
    if (writeSync(fd, text) !== Buffer.byteLength(text)) throw Object.assign(new Error(`short write to ${path}`), { code: 'ENOSPC' });
  } catch (err) {
    // Only the file this descriptor wrote to is removed: a process suspended for longer than the age rule finds another process's lock at the path (CR-SOL-002), and that one is not ours to unlink.
    let ours = false;
    try { const was = fstatSync(fd); const now = statSync(path); ours = was.ino === now.ino && was.dev === now.dev; } catch { /* gone */ }
    try { closeSync(fd); } catch { /* already closed */ }
    if (removeOnFail && ours) { try { unlinkSync(path); } catch { /* already gone */ } }
    throw err;
  }
  closeSync(fd);
}

const isMine = (lockPath, mine) => {
  try {
    const now = JSON.parse(readFileSync(lockPath, 'utf8'));
    return now.pid === mine.pid && now.host === mine.host && now.nonce === mine.nonce;
  } catch { return false; }
};

//
// 0.8.1 (plan M3): `file` names a different lock in the same folder (the approvals record of plan DR-4 takes one),
// with the same O_EXCL take and stale-pid takeover. release() also drops its exit listener, since a
// long-lived MCP server takes the ledger lock once per append and the listeners would otherwise pile up.
//
// `_seam` (TEST ONLY, a no-op unless a test passes one; it is not reachable from the environment or the command line, like chain.js's setPromptSpy): called as _seam(stage, lockPath) at the two points where another
// process can change the lock file between our looking and our acting: 'after-exists' (our create failed because the file existed, before we read it), 'after-claim' (the claim is ours, before we read the
// file's state) and 'before-take' (we have decided what the file's state is, before we act on it); also 'after-create' (the fast path created the file and has not written its body) and 'after-claim-create' (our claim was created, not yet written) and 'before-clear' (an abandoned claim was judged, not yet cleared). test/run-lock.test.js and test/run-lock-two-owners.test.js use it to make the interleavings that lost an update, or gave two owners, deterministic.
export function acquireRunLock(runDir, { pid = process.pid, file = LOCK_FILE, unreadableStaleMs: givenStaleMs, _seam = null } = {}) {
  const unreadableStaleMs = staleMsOf(file, givenStaleMs);
  const seam = stage => { if (_seam) _seam(stage, join(runDir, file)); };
  const lockPath = join(runDir, file);
  const mine = { pid, host: hostname(), at: new Date().toISOString(), nonce: Math.random().toString(36).slice(2) };
  const release = () => {
    process.removeListener('exit', release);
    try { if (isMine(lockPath, mine)) unlinkSync(lockPath); } catch { /* already gone */ }
  };
  const hold = () => { process.once('exit', release); return release; };
  const holderNow = () => lockHolder(runDir, { file, unreadableStaleMs });
  const locked = () => new RunLockedError(holderNow() ?? { pid: '?', host: '?', at: '?' }, lockPath);
  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    seam('after-exists');
    const holder = holderNow();
    if (holder) throw new RunLockedError(holder, lockPath);
    const claimPath = `${lockPath}.claim`;
    // A claim left behind by a dead process, or an unreadable one older than the bound (its writer died between the create and the write; CR-X3-002), is cleared and the claim is tried once more at once.
    // One that is being written right now, or belongs to a live process, is respected: the attempt reports the run as locked.
    const claimAbandoned = (path = claimPath) => {
      let c = null;
      try { c = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return false; /* unreadable: below */ }
      if (c && typeof c === 'object') return c.host === hostname() && !isPidAlive(c.pid);
      if (!(unreadableStaleMs > 0)) return false;
      try { return Date.now() - statSync(path).mtimeMs > unreadableStaleMs; } catch { return false; }
    };
    const claimIsOurs = () => {
      try { const c = JSON.parse(readFileSync(claimPath, 'utf8')); return c.pid === pid && c.host === mine.host && c.nonce === mine.nonce; } catch { return false; }
    };
    let cfd;
    for (let again = true; cfd === undefined; again = false) {
      try { cfd = openSync(claimPath, 'wx'); } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (!again || !claimAbandoned()) throw locked();
        // CR-SOL-003: the claim we judged abandoned may have been replaced since (another contender cleared it and made its own). Judge it again; then move it aside under a name only we use, and judge what we took:
        // a path is never unlinked on the strength of an earlier look. A claim that turns out to be alive was taken from its owner, who sees it is gone before it takes the lock and stops; so do we.
        seam('before-clear');
        if (!claimAbandoned()) throw locked();
        const gone = `${claimPath}.${pid}.${mine.nonce}.gone`;
        try { renameSync(claimPath, gone); } catch { continue; /* cleared by someone else meanwhile: try the create again */ }
        const wasAbandoned = claimAbandoned(gone);
        try { unlinkSync(gone); } catch { /* gone */ }
        if (!wasAbandoned) throw locked();
      }
    }
    const claimId = (() => { try { const st = fstatSync(cfd); return { ino: st.ino, dev: st.dev }; } catch { return null; } })();
    try {
      seam('after-claim-create');
      writeLockBody(cfd, claimPath, { pid, host: mine.host, nonce: mine.nonce }, { removeOnFail: false });   // inside the try: a write that throws must not leave the claim behind. The `finally` below removes it, and only if it is still the file we created
      // Branch on the lock file's ACTUAL state, never on "no holder" (that is also what an ABSENT lock looks like, and renaming over an absent lock overwrites one another process created in the meantime):
      //   absent -> create it exclusively, the way the fast path does (a lock that appeared since is then EEXIST = locked); the content is written after the create, so a reader that sees the young empty file
      //             reads it as 'held', never as stale;
      //   stale  -> rename over it. That is safe ONLY because (1) our claim file keeps every other claimant out, (2) the fast path cannot create a lock while the stale file exists (its create is EEXIST) and
      //             (3) a dead holder cannot release it: nothing but this rename can change the file between our check and the rename;
      //   held   -> locked.
      // Both takes happen only while the claim at its path is still OURS (CR-SOL-003: a claim another contender took from us means we no longer hold the right to replace anything), and each is followed by
      // a check that the lock at the path is ours (CR-SOL-002): a take that is not confirmed holds nothing.
      seam('after-claim');
      const state = lockFileState(lockPath, unreadableStaleMs);
      seam('before-take');
      if (state === 'held') throw locked();
      if (!claimIsOurs()) throw locked();
      if (state === 'absent') {
        let nfd;
        try { nfd = openSync(lockPath, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw locked(); throw e; }
        writeLockBody(nfd, lockPath, mine);
      } else {
        const tmp = `${lockPath}.${pid}.${mine.nonce}.tmp`;
        writeFileSync(tmp, JSON.stringify(mine));
        renameSync(tmp, lockPath);
      }
      if (!isMine(lockPath, mine)) throw locked();
    } finally {
      // Removed only if it is still the file we created: the same inode AND not another contender's claim (a freed inode number can be handed to the next file created, so the inode alone is not proof). A claim whose write
      // failed is empty or partial and carries no one's nonce; it is ours by its inode.
      try {
        const st = statSync(claimPath);
        let theirs = false;
        try { const c = JSON.parse(readFileSync(claimPath, 'utf8')); theirs = Boolean(c) && typeof c === 'object' && c.nonce !== mine.nonce; } catch { /* unreadable or empty: not another contender's */ }
        if (claimId && st.ino === claimId.ino && st.dev === claimId.dev && !theirs) unlinkSync(claimPath);
      } catch { /* gone, or no longer ours */ }
    }
    return hold();
  }
  seam('after-create');
  writeLockBody(fd, lockPath, mine);
  if (!isMine(lockPath, mine)) throw locked();   // CR-SOL-002: the file at the path is not ours (a suspended taker whose empty file was replaced): we hold nothing, and nothing of the other's is touched
  return hold();
}
