// `council stop runs/<id>` (0.8.1 plan M6 Work 2): a person asks a running advice call to stop. It writes the run's STOP request
// (src/stop-files.js, by "user"); the run ends before its next paid step with exit 18 and report-partial.json, and calls already in
// flight finish and are recorded (they are billed either way). Nothing is killed: a run that is not running reads the request when it
// starts (an advice call approved later then stops before its first call).
//
// Contract.
//   stopCommand(args, { work, stdout, stderr }) -> exit code
//     0  the request was written
//     1  it could not be written
//     2  usage: not a run folder in <work>/runs, not an advice call (planning runs cannot be stopped in 0.8.1), or already ended
import { existsSync, readFileSync } from 'node:fs';
import { isAlivePid } from './run-status.js';
import { basename, dirname, join, resolve } from 'node:path';
import { isAdviceFolder } from './advice-run.js';
import { writeStopRequest, readStoppedMarker } from './stop-files.js';
import { PARTIAL_REPORT_FILE } from './report-shape.js';

export function stopCommand(args, { work = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, extra] = args;
  if (!runArg || extra !== undefined) { err('usage: council stop <run folder>'); return 2; }
  const dir = resolve(work, runArg);
  if (dirname(dir) !== join(resolve(work), 'runs') || !existsSync(dir)) { err(`stop: ${runArg} is not a run folder in ${join(work, 'runs')}. Nothing was written.`); return 2; }
  if (!isAdviceFolder(dir)) { err(`stop: ${runArg} is not an advice call; planning runs cannot be stopped from outside in 0.8.1 (stop the process instead). Nothing was written.`); return 2; }
  // M6 review D5: only a call that has started and not ended can read the request. Before its start the person declines the gate instead
  // (a STOP there would let the approval be consumed, `sent`, and then stop at $0).
  if (!existsSync(join(dir, 'run.json'))) { err(`stop: ${runArg} has not started (it waits for approval). To call it off, decline it: council gate answer ${runArg} g1 --decline. Nothing was written.`); return 2; }
  if (existsSync(join(dir, 'report.json')) || existsSync(join(dir, PARTIAL_REPORT_FILE)) || readStoppedMarker(dir) || existsSync(join(dir, 'STOPPED-error.md')) || existsSync(join(dir, 'STOPPED-budget.json'))) { err(`stop: ${runArg} has already ended. Nothing was written.`); return 2; }
  // A run whose process is gone would never read the request (a crashed call is asked again, not stopped).
  let pid = null;
  try { pid = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).pid ?? null; } catch { /* unreadable run.json: judged by the markers above */ }
  if (pid && !isAlivePid(pid)) { err(`stop: ${runArg} is not running (its process ${pid} has ended). Nothing was written.`); return 2; }
  try { writeStopRequest(dir, { by: 'user', run: basename(dir) }); } catch (e) { err(`stop: could not write the request (${e.code ?? e.message}).`); return 1; }
  out(`stop: requested for ${runArg}. The call ends before its next paid step (exit 18); calls already in flight finish and are billed. What was paid for will be in ${PARTIAL_REPORT_FILE}.`);
  return 0;
}
