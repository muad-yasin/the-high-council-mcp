// Wait for a run's detached child to have EXITED, not for a file to exist. A child that writes report.json keeps writing afterwards (state.json, RESUME.md, the output log, the lock release at exit), so a test that waits only for
// report.json and then removes its folder races those writes (ENOTEMPTY: CI 29 Sep 2026, fad02049 on 24 Okt, and the dotted-lab test again in the 0.8.3 batch suite). Not a test file.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** True when the process no longer exists. EPERM means it exists (another user's process); ESRCH means gone. */
export const pidGone = pid => { try { process.kill(pid, 0); return false; } catch (e) { return e.code !== 'EPERM'; } };
/** The pid of the child a run folder belongs to: `.spawn.json` when the server recorded one (it does for a resume and the advice path, where the folder exists at the spawn), else the pid the child itself wrote into run.json
 *  (on start_run the CHILD makes the folder, so the server has nothing to record). null when neither reads. */
export function childPid(runDir) {
  for (const f of ['.spawn.json', 'run.json']) {
    try { const pid = JSON.parse(readFileSync(join(runDir, f), 'utf8')).pid; if (Number.isInteger(pid)) return pid; } catch { /* absent or mid-write: try the next */ }
  }
  return null;
}
/** Waits until the run's child has exited, polling every 100 ms, with a guard that only a broken run reaches. An UNREADABLE pid is not an exit (verification rule 6, unreadable is not a pass): the spawn record or run.json appears within the
 *  window, so the wait goes on until a readable pid is gone. -> true when a readable pid is gone, false on the guard (the caller asserts, naming the pid or that none could be read). */
export async function childGone(runDir, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const pid = childPid(runDir);
    if (pid !== null && pidGone(pid)) return true;
    if (Date.now() - t0 >= ms) return false;
    await sleep(100);
  }
}
/** The criterion for "the run is over and nothing writes to its folder any more": report.json exists (the run finished) AND its child has exited. Fails loudly (a thrown Error naming the pid) instead of falling through to a cleanup
 *  that would race a child still writing. -> the run folder's report.json path. */
export async function waitForRunEnd(runDir, { ms = 60_000 } = {}) {
  const report = join(runDir, 'report.json');
  for (let i = 0; i < ms / 250 && !existsSync(report); i++) await sleep(250);
  if (!existsSync(report)) throw new Error(`the run did not finish: no report.json in ${runDir} after ${ms} ms`);
  if (!(await childGone(runDir, ms))) throw new Error(`the run's child (${childPid(runDir) === null ? 'no pid could be read from .spawn.json or run.json' : `pid ${childPid(runDir)}`}) had not exited ${ms} ms after report.json appeared in ${runDir}`);
  return report;
}
