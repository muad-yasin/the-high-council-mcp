// How a run child's EXIT CODE reads to the MCP caller (the two places that spawn the CLI: start_run's spawnRun and the resume that resume_run and submit_stage share). ONE decision, so the two sites cannot disagree.
// Before this module both compared bare codes, and 23 (a layered run stopped at an overseer limit, waiting for the person's choice) and 22 / 7 / 8 (finished, not agreed or security-gated) fell into "never started":
// a false record for a run that ran, may have spent money and stopped (exit-22 unit, C&C 15 Oct 2026). Returns:
//   'running'  no exit yet (exited is null)   'finished'  the run FINISHED (0, 7, 8, 22: read report.json for how it ended)
//   'stopped'  23 (an overseer limit), 24 (a seat refused at its price pin), 25 (the decider asked for the person) or 26 (excerpts wait for the person's approval); 23, 24 and 25 are resumable and wait for the person (report-partial.json, no report.json), 26 is refused a resume while the approval waits for the person or cannot be read (with the privacy switch on, an answered gate is applied by the next resume: src/gate.js excerptApprovalStops)
//   'paused'   3, waiting at an external seat
//   'failed'   any other code: the run died or refused at once. 21 (a limit a person types) is answered by the caller BEFORE this is asked.
import { secretPauseAfterExit } from '../secret-pause.js';
import { EXIT_ROUND_STOPPED, EXIT_PRICE_REFUSED, EXIT_CONFLICT_ASKED, EXIT_AWAITING_EXCERPT_APPROVAL, FINISHED_EXIT_CODES } from '../exit-codes.js';
//   0.8.4 (a found secret PAUSES the run): exit 11 is a refusal (failed) by its code alone, the pre-run key or personal-data stop. Given `ctx` = { runDir, spawnedAt } it is 'stopped' when the child ALSO wrote a whole
//   secret-stop/1 record at or after its spawn (src/secret-pause.js secretPauseAfterExit): that child ran, and waits for the person's `--continue` at a terminal, like exit 23. A stale record or none stays 'failed'.
/** @param {null | { code: number | null, signal?: string | null }} exited what the child's 'exit' event gave, or null while it runs
 *  @param {{ runDir?: string | null, spawnedAt?: number }} [ctx] */
export function childEndOf(exited, { runDir = null, spawnedAt = 0 } = {}) {
  if (!exited) return 'running';   // no 'exit' event yet
  const { code } = exited;   // a child killed by a signal has code null (and a signal): that is a run that died, never a running one
  if (FINISHED_EXIT_CODES.has(code)) return 'finished';
  if (code === EXIT_ROUND_STOPPED || code === EXIT_PRICE_REFUSED || code === EXIT_CONFLICT_ASKED || code === EXIT_AWAITING_EXCERPT_APPROVAL) return 'stopped';
  if (code === 3) return 'paused';
  if (code === 11 && runDir && secretPauseAfterExit(runDir, exited, spawnedAt)) return 'stopped';
  return 'failed';
}
