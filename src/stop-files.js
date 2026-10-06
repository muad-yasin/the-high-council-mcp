// The stop request and the stop marker of an advice run (0.8.1 plan M6, decided rule 6, DR-10; persistence register P8).
//
// Contract.
//   STOP (runs/<id>/STOP): a request to stop, written by the MCP server when its client cancels or leaves (`client_cancel`) and by
//     `council stop runs/<id>` for a person (`user`). {schema: "stop/1", by, run, at, note?}. Presence stops the run before its next
//     paid step; calls in flight finish and are recorded.
//     readStopRequest(dir, runId) -> null | { by, corrupt? }: an unparseable file still stops, as `user` (P8); a request naming
//     another run id is stale (left from an earlier run in the folder) and is ignored.
//   STOPPED-<stoppedBy>.json: the marker of a run that ended at exit 18, written by the CLI from the config the run loaded:
//     {schema: "stopped/1", stoppedBy, beforeFirstCall, spentUsd, resumeAfterStop, at, reason?}. Readers take resumeAfterStop from
//     here and never load a chain (src/run-status.js cannot import the advice modules; a chain lookup can be shadowed by a
//     project's chains/, M5 review D1). readStoppedMarker(dir) -> null | { stoppedBy, file, data } (data null when unreadable).
//   STOP_CAUSES, STOP_STATUS (cause -> run status, mirroring budget_stopped), stoppedFileOf(cause).
// No imports beyond node: every reader (run-status, spend, the MCP server, the CLI) may import this.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STOP_FILE = 'STOP';
export const STOP_SCHEMA = 'stop/1';
export const STOPPED_SCHEMA = 'stopped/1';
// Decided rule 6: a person, a client that cancelled or left, a wall clock. `budget` is the older stop with its own files.
export const STOP_CAUSES = Object.freeze(['user', 'client_cancel', 'wall_clock']);
export const STOP_STATUS = Object.freeze({ user: 'user_stopped', client_cancel: 'client_cancel_stopped', wall_clock: 'wall_clock_stopped' });
export const stoppedFileOf = cause => `STOPPED-${cause}.json`;

/** Temp file in the same folder, fsync, rename, then sync the folder (plan section 4, "Atomic"; P8, P20). */
export function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  let dfd;
  try { dfd = openSync(dirname(path), 'r'); fsyncSync(dfd); } catch { /* a folder fsync is unsupported on some platforms; the rename is done */ } finally { if (dfd !== undefined) closeSync(dfd); }
}

/**
 * Whether `dir` holds an advice call, by its own files: advice.meta.json (a tool-started call, from before its approval) or
 * advise-log.json (any advice run that started). Never by the chain file, which a project's chains/ could shadow (M5 review D1).
 * Here, with no imports, so src/run-status.js can read it (M6 review D3); src/advice-run.js re-exports it.
 */
export const isAdviceFolder = dir => existsSync(join(dir, 'advice.meta.json')) || existsSync(join(dir, 'advise-log.json'));

/** Writes runs/<id>/STOP. `by` is 'client_cancel' or 'user'. */
export function writeStopRequest(dir, { by, run, note = null, now = Date.now() }) {
  if (!['client_cancel', 'user'].includes(by)) throw new Error(`a STOP request is by client_cancel or user, not ${by}`);
  writeAtomic(join(dir, STOP_FILE), `${JSON.stringify({ schema: STOP_SCHEMA, by, run, at: new Date(now).toISOString(), ...(note ? { note } : {}) })}\n`);
}

export function readStopRequest(dir, runId) {
  const p = join(dir, STOP_FILE);
  if (!existsSync(p)) return null;
  let r;
  try { r = JSON.parse(readFileSync(p, 'utf8')); } catch { return { by: 'user', corrupt: true }; }
  if (!r || typeof r !== 'object' || r.schema !== STOP_SCHEMA || !['client_cancel', 'user'].includes(r.by)) return { by: 'user', corrupt: true };
  if (typeof r.run === 'string' && runId && r.run !== runId) return null; // stale: a request for another run
  return { by: r.by };
}

export function writeStoppedMarker(dir, { stoppedBy, beforeFirstCall, spentUsd, resumeAfterStop, reason = null, now = Date.now() }) {
  if (!STOP_CAUSES.includes(stoppedBy)) throw new Error(`not a stop cause: ${stoppedBy}`);
  writeAtomic(join(dir, stoppedFileOf(stoppedBy)), `${JSON.stringify({ schema: STOPPED_SCHEMA, stoppedBy, beforeFirstCall: !!beforeFirstCall, spentUsd, resumeAfterStop: resumeAfterStop === true, at: new Date(now).toISOString(), ...(reason ? { reason } : {}) }, null, 2)}\n`);
}

/** What a stop marker says about money: 'none' (stopped before the first paid call), 'some' (after paid calls), 'unknown' (a marker that cannot be read, or one without the field). */
export function stopSpendNote(marker) {
  const b = marker?.data?.beforeFirstCall;
  return b === true ? 'none' : b === false ? 'some' : 'unknown';
}

export function readStoppedMarker(dir) {
  for (const cause of STOP_CAUSES) {
    const file = stoppedFileOf(cause);
    if (!existsSync(join(dir, file))) continue;
    let data = null;
    try { data = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { data = null; }
    return { stoppedBy: cause, file, data: data && typeof data === 'object' ? data : null };
  }
  return null;
}
