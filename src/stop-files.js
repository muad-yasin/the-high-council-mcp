// The stop marker of a run (0.8.1 plan M6, DR-10; persistence register P8), and the one file test every reader uses to tell an old advice call's folder.
//
// Contract.
//   STOPPED-<stoppedBy>.json: the marker of a run that stopped, written by the CLI from the config the run loaded:
//     {schema: "stopped/1", stoppedBy, beforeFirstCall, spentUsd, resumeAfterStop, at, reason?}. Readers take resumeAfterStop from
//     here and never load a chain (a chain lookup can be shadowed by a project's chains/, M5 review D1). readStoppedMarker(dir) -> null | { stoppedBy, file, data } (data null when unreadable).
//   STOP_CAUSES, STOP_STATUS (cause -> run status, mirroring budget_stopped), stoppedFileOf(cause).
//   isAdviceFolder(dir): the folder of an advice call that an earlier version made (the add-on was removed in 0.8.4); such a folder is never resumed, handed off or counted as a passed plan.
// No imports beyond node: every reader (run-status, spend, the MCP server, the CLI) may import this.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STOPPED_SCHEMA = 'stopped/1';
// Decided rule 6: a person, a client that cancelled or left, a wall clock. `budget` is the older stop with its own files.
// Round semantics 2b: `overseer_cap` and `layer_bound` end a layered run RESUMABLY at exit 23 (the person chooses to continue or finish); 0.8.4 S5 adds `stall_stop` (an objection stood unchanged and could not be passed up).
export const STOP_CAUSES = Object.freeze(['overseer_cap', 'layer_bound', 'stall_stop', 'price_refused', 'conflict', 'owner_pause']);
// The three causes that end a layered run RESUMABLY at exit 23 (round semantics 2b); EVERY reader that words a stop marker asks isRoundStop first, so a new cause
// cannot read "stopped by undefined" (exit-22 unit; test/stop-cause-words.test.js loops over STOP_CAUSES for each reader). The state words are an E item.
export const ROUND_STOP_CAUSES = Object.freeze(['overseer_cap', 'layer_bound', 'stall_stop']);
export const isRoundStop = cause => ROUND_STOP_CAUSES.includes(cause);
// A3a commit 2 (18 Okt 2026): a SIBLING of the round stop, not inside it. `price_refused` ends a run RESUMABLY at exit 24 and waits for the person (src/price-refused.js), but it has no --continue / --finish choice, so
// the choice code (cli.js round branch, the MCP resume's stop-id logic, the tree member's round-stop kind) stays round-only (`isRoundStop`). The pure word readers (state words, the stop sentence) use `waitsForPerson`.
// 0.8.4 S20 slice 2 (#16c): `owner_pause` is the owner's "pause after this round" (src/owner-pause.js): the run waits for the person to resume it. It is a PERSON stop, NOT a round stop: no --continue / --finish, and it must never enter ROUND_STOP_CAUSES.
export const PERSON_STOP_CAUSES = Object.freeze(['price_refused', 'conflict', 'owner_pause']);
export const waitsForPerson = cause => ROUND_STOP_CAUSES.includes(cause) || PERSON_STOP_CAUSES.includes(cause);
export const ROUND_STOPPED_STATE = "stopped, waiting for the person's choice";
// 0.8.4 16c-MCP (R380 bound limit): an owner pause waits for the person to RESUME, not to choose; MCP's state words say so (the other word readers keep theirs: test/owner-pause-stop.test.js OS-6). A-DRAFT.
export const OWNER_PAUSED_STATE = 'paused at a request to pause after the pass, waiting for the person to resume it';
export const stopStateOf = cause => (cause === 'owner_pause' ? OWNER_PAUSED_STATE : ROUND_STOPPED_STATE);
export const STOP_STATUS = Object.freeze({ overseer_cap: 'awaiting_choice', layer_bound: 'awaiting_choice', stall_stop: 'awaiting_choice', price_refused: 'awaiting_choice', conflict: 'awaiting_choice', owner_pause: 'owner_paused' });
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
 * Here, with no imports, so src/run-status.js can read it (M6 review D3).
 */
export const isAdviceFolder = dir => existsSync(join(dir, 'advice.meta.json')) || existsSync(join(dir, 'advise-log.json'));

export function writeStoppedMarker(dir, { stoppedBy, beforeFirstCall, spentUsd, resumeAfterStop, reason = null, requestSeq = null, now = Date.now() }) {
  if (!STOP_CAUSES.includes(stoppedBy)) throw new Error(`not a stop cause: ${stoppedBy}`);
  writeAtomic(join(dir, stoppedFileOf(stoppedBy)), `${JSON.stringify({ schema: STOPPED_SCHEMA, stoppedBy, beforeFirstCall: !!beforeFirstCall, spentUsd, resumeAfterStop: resumeAfterStop === true, at: new Date(now).toISOString(), ...(reason ? { reason } : {}), ...(Number.isInteger(requestSeq) ? { request_seq: requestSeq } : {}) }, null, 2)}\n`);   // request_seq: the owner's pause names the ledger request it stopped for (#16c)
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
