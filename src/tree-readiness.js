// Readiness is a RECORD (0.8.3 M6 slice S3; PLAN 9.2, CL-52). At every tree step the orchestrator computes the verdict (src/tree-ready.js, read-only) and, when the verdict OR any of its inputs differs from the last
// `readiness` event, appends one: { verdict, reasons, inputs }. Never when nothing changed. Everything that SHOWS readiness (TREE_HANDOFF.md, tree/report.json, `council tree status`, the MCP tree_status tool) reads it
// through `lastReadinessOf`, the ONE reader of the newest recorded verdict.
//
// Order, and why: the verdict is computed OUTSIDE the tree lock (it runs a contract check on every closed node: tens of milliseconds, more on a big tree, and a lock is held for a validate-and-append). The record's last
// event id is read before the computation and again INSIDE the lock; if it moved, something was recorded while the verdict was being computed (a `tree check` just recorded `ready`, a child closed) and the verdict may
// be stale - a sitting's stale `incomplete` must never land after a newer `ready` - so it is computed again (up to ATTEMPTS times) and, if the record is still moving, nothing is appended: the next step records it.
// `attempts` and `afterCompute` are test seams (the race above is pinned with them). A record that does not read (tree.json missing, a corrupt line, the tree not started) is never appended to here: the verdict is `blocked: record_unreadable` and the writers of that state are elsewhere.
// The comparison is the canonical JSON of { verdict, reasons, inputs }: an unchanged verdict can rest on changed reasons, versions or evidence (PLAN 9.2), and nothing else is compared (no clock, no event id).
import { canonicalJson } from './thin-contract.js';
import { RunLockedError } from './run-lock.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, withTreeLock } from './tree-record.js';
import { gatherReadinessFacts, verdictOf } from './tree-ready.js';
import { fileProblemLine, writeTreeFiles } from './tree-files.js';

const ATTEMPTS = 3;
const lastIdOf = record => record.events.at(-1)?.id ?? null;

/** The newest `readiness` event of a record as { id, at, verdict, reasons, inputs }, or null when none was recorded. THE reader: nothing else parses a readiness event. */
export function lastReadinessOf(record) {
  const e = [...record.events].reverse().find(x => x.event === 'readiness');
  return e ? { id: e.id, at: e.at, verdict: e.verdict, reasons: e.reasons ?? [], inputs: e.inputs ?? {} } : null;
}

/** The verdict NOW with the id of the record's last event it was computed at: { before, verdict } or { before, unreadable: true }. Reads only; the caller may hand it to recordReadiness (`precomputed`) so one step computes once. */
export function computeReadiness(rootDir, { work, deny = null } = {}) {
  const before = lastIdOf(readTreeRecord(rootDir));
  const facts = gatherReadinessFacts(rootDir, { work, deny });
  return facts.problems.length ? { before, unreadable: true } : { before, verdict: verdictOf(facts) };
}

const payloadOf = ({ verdict, reasons, inputs }) => canonicalJson({ verdict, reasons, inputs });
/** True when two readiness answers (a recorded one and a computed one) are the same record: the verdict, the reasons and the inputs, nothing else (no id, no time). */
export const sameReadiness = (a, b) => payloadOf(a) === payloadOf(b);

/**
 * Computes the verdict and records it when it differs from the last recorded one. -> { appended, event?, verdict, skipped? }. `skipped` is 'record_unreadable' (nothing appended) or 'record_moving' (the record kept
 * changing while the verdict was computed). Takes the tree lock only for the final compare-and-append; the caller may or may not hold the sitting lock (this is a record write, like every other).
 */
export function recordReadiness(rootDir, { work, deny = null, now, attempts = ATTEMPTS, afterCompute = null, precomputed = null } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const c = attempt === 0 && precomputed ? precomputed : computeReadiness(rootDir, { work, deny });
    if (c.unreadable) return { appended: false, skipped: 'record_unreadable', verdict: 'blocked' };
    const { before, verdict: computed } = c;
    if (afterCompute) afterCompute(attempt);                                       // a test seam: something is recorded between the computation and the lock
    const outcome = withTreeLock(rootDir, () => {
      const record = readTreeRecord(rootDir);
      if (lastIdOf(record) !== before) return { moved: true };
      const last = lastReadinessOf(record);
      if (last && sameReadiness(last, computed)) return { appended: false, verdict: computed.verdict };
      const event = appendTreeEventLocked(rootDir, { event: 'readiness', verdict: computed.verdict, reasons: computed.reasons, inputs: computed.inputs }, now ? { now } : {});
      return { appended: true, event, verdict: computed.verdict };
    });
    if (!outcome.moved) return outcome;
  }
  return { appended: false, skipped: 'record_moving', verdict: null };
}

/**
 * recordReadiness for a CALLER whose own work is already done (a sitting's result, a recorded check or decision): a lock held elsewhere or a refused record write must never replace or undo that work - the next tree
 * step records the verdict - so those two (and only those) are caught and reported as { appended: false, skipped: 'lock_busy' | 'refused' }. Any other error is a defect and is thrown.
 */
export function recordReadinessAfter(rootDir, opts = {}) {
  const { writeFiles = true, report = line => process.stderr.write(`${line}\n`), ...rest } = opts;
  let res;
  try { res = recordReadiness(rootDir, rest); } catch (e) {
    if (e instanceof RunLockedError) res = { appended: false, skipped: 'lock_busy', verdict: null };
    else if (e instanceof TreeRefusal) res = { appended: false, skipped: 'refused', verdict: null };
    else throw e;
  }
  if (writeFiles === false) return res;
  // THE STALE-VIEWS REFRESH (src/tree-files.js, under its own views lock, never the sitting lock): every verb that changed the record calls this, so the two view files follow the record whether or not a sitting wrote it. A sitting passes `writeFiles: false`: it writes them in
  // its own afterStep, under its own lock, and must not write twice. Even a skipped verdict (the record moved, the verdict did not) refreshes: the verb's own event is what the files must show. Never fatal; a problem is one plain line.
  let fileProblems;
  try { fileProblems = writeTreeFiles(rootDir, { work: opts.work }); } catch (e) { fileProblems = [{ file: 'tree files', error: String(e?.message ?? e).split('\n')[0].slice(0, 300) }]; }
  for (const p of fileProblems) report(fileProblemLine(rootDir, p));
  return { ...res, fileProblems };
}
