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

/**
 * The target hash of AMENDMENTS.md's latest entry (its last line holding a task hash): the entry's second hash, or null.
 * A task hash is 12 hex characters in run.json and in the error message, but a person copying one from
 * `sha256sum` writes all 64; both name the same hash, so any 12-to-64 hex token counts and is reduced
 * to its first 12 (0.8.0: the old 12-only match read a full-length hash as no entry at all).
 */
export function latestAmendmentTarget(amendmentsText) {
  if (typeof amendmentsText !== 'string') return null;
  // A longer token of digits only (a compact timestamp, an id) is not a hash; a 12-character one is
  // kept as before, since a real hash can be all digits (about 1 in 280).
  const hashesIn = s => (s.match(/(?<!ctx-)\b[0-9a-f]{12,64}\b/g) || []).filter(h => h.length === 12 || /[a-f]/.test(h));
  // 0.8.1 FX-5: an entry is one line (old hash, new hash, reason, timestamp), and its target is its SECOND hash token;
  // tokens after it belong to the reason (a cited commit id was read as the new task hash). A line with one hash token
  // keeps the 0.7.9 meaning: that token is the target. The latest entry is the last line that holds a task hash.
  const entries = amendmentsText.split(/\r?\n/).map(hashesIn).filter(h => h.length);
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  return (last.length >= 2 ? last[1] : last[0]).slice(0, 12);
}

// ---- The --context documents (0.8.0, roadmap "Debate, criteria, milestones" item 10) ----
// The standing-context bundle is read again on every resume, so a document edited during a pause went
// to every seat without a word on the record, while an edited TASK was refused without an amendment.
// It is the same rule now. A context hash is written `ctx-<12 hex>` in AMENDMENTS.md, so the two
// subjects never read each other's entries: latestAmendmentTarget above ignores `ctx-` tokens, and the
// one below reads nothing else.

/** 12 hex of the standing-context bundle text (`## name` heading and content per file, as the seats see it). */
export function contextHashOf(bundleText) {
  return taskHashOf(bundleText);
}

/** The target of AMENDMENTS.md's latest context entry: the last `ctx-<hex>` token (12 to 64 hex, reduced to 12), or null. */
export function latestContextAmendmentTarget(amendmentsText) {
  if (typeof amendmentsText !== 'string') return null;
  const hashes = amendmentsText.match(/\bctx-[0-9a-f]{12,64}\b/g);
  return hashes ? hashes[hashes.length - 1].slice(4, 16) : null;
}

/**
 * Whether a --resume may proceed past a change to the --context documents. Same shape and posture as
 * checkFrozenScope: no stored hash (a run from before 0.8.0) is trusted; only the LATEST context entry
 * of AMENDMENTS.md counts. Returns { ok: true, amended } or { ok: false, message }.
 */
export function checkFrozenContext({ storedHash, currentHash, amendmentsText }) {
  if (!storedHash || storedHash === currentHash) return { ok: true, amended: false };
  const latest = latestContextAmendmentTarget(amendmentsText);
  if (latest !== currentHash) {
    return {
      ok: false,
      message: `context changed: the --context documents have changed since this run started (recorded ctx-${storedHash}, now ctx-${currentHash}). If this change is deliberate, append it to this run's AMENDMENTS.md first, one entry per change: old ctx-<hash>, new ctx-<hash> (write them as printed here), one-line reason, timestamp. Then --resume again. If it wasn't deliberate, restore the documents to what this run started with.`,
    };
  }
  return { ok: true, amended: true };
}
