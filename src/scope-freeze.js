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
  // Pre-release audit 2026-09-23 (PreRelease_Audit_revise #2): this used to be
  // `amendmentsText.includes(currentHash)`, so reverting the task to ANY hash the append-only file
  // had ever mentioned - the old hash of an earlier entry, say - passed as a recorded amendment.
  // Only the latest amendment's target counts now: the last task hash written anywhere in the file
  // (entries record the old hash, then the new one). A later change, a revert included, needs its
  // own new entry.
  const latestTarget = latestAmendmentTarget(amendmentsText);
  if (latestTarget !== currentHash) {
    const why = latestTarget && typeof amendmentsText === 'string' && amendmentsText.includes(currentHash)
      ? ` AMENDMENTS.md mentions ${currentHash}, but only as part of an earlier entry - its latest entry moves the task to ${latestTarget}, so going back needs a new entry of its own.`
      : '';
    return {
      ok: false,
      message: `task hash mismatch: this run's task file has changed since it started (recorded ${storedHash}, now ${currentHash}).${why} If this change is deliberate, append it to this run's AMENDMENTS.md first, one entry per change: old hash, new hash, one-line reason, timestamp. Then --resume again. If it wasn't deliberate, restore the task file to what this run started with.`,
    };
  }
  return { ok: true, amended: true };
}

/** The target hash of AMENDMENTS.md's latest entry: the last 12-hex task hash in the text, or null. */
export function latestAmendmentTarget(amendmentsText) {
  if (typeof amendmentsText !== 'string') return null;
  const hashes = amendmentsText.match(/\b[0-9a-f]{12}\b/g);
  return hashes ? hashes[hashes.length - 1] : null;
}
