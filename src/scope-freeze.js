// Frozen-scope enforcement (v3 §2, ~/Projects/relay/tasks/thcmcp-v3-draft-fixed.md). Real
// incident: an operator added a real requirement at the build stage, after task and criteria
// were already frozen; a critic correctly failed the draft for scope it couldn't tell came
// from the owner. Two rounds and a restart were burned before the run passed.
//
// Hashes the raw task file's own text at run start (reusing src/integrity.js's hashing, not a
// new implementation) and refuses to silently continue a --resume past a change to it, unless
// AMENDMENTS.md - append-only, written by the operator - covers the change. Pure decision logic
// lives here so it's testable without spawning src/cli.js as a subprocess; cli.js does the
// actual file I/O and calls this with what it read.
import { fingerprint } from './integrity.js';

/** sha256 (12 hex chars, matching src/integrity.js's own truncation) of a task's raw text. */
export function taskHashOf(taskText) {
  return fingerprint(taskText).sha256;
}

/**
 * Decide whether a --resume may proceed. `storedHash` comes from run.json (absent on a
 * pre-v3 run - trusted, not treated as stale, the same posture §7.2's cache staleness check
 * already takes for a missing fingerprint). `amendmentsText` is AMENDMENTS.md's content, or
 * null if the file doesn't exist. Returns { ok: true, amended: boolean } or
 * { ok: false, message }; never throws, never reads or writes a file itself.
 */
export function checkFrozenScope({ storedHash, currentHash, amendmentsText }) {
  if (!storedHash || storedHash === currentHash) return { ok: true, amended: false };
  const covered = typeof amendmentsText === 'string' && amendmentsText.includes(currentHash);
  if (!covered) {
    return {
      ok: false,
      message: `task hash mismatch: this run's task file has changed since it started (recorded ${storedHash}, now ${currentHash}). If this change is deliberate, write it into this run's AMENDMENTS.md first, one entry per change: old hash, new hash, one-line reason, timestamp. Then --resume again. If it wasn't deliberate, restore the task file to what this run started with.`,
    };
  }
  return { ok: true, amended: true };
}
