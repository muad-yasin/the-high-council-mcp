// What a run has spent and what it has left (moved out of src/mcp/server.js unchanged so a test can reach it).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supersededSpendOf, supersededUnknownFilesOf } from './superseded.js';
import { unsettledUsd } from './spend-reservations.js';
import { runSpendOf, usageSpendOf } from './spend.js';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// What a run has spent and what it has left. Source of truth is report.json
// once the run finished; while it is still running (or was stopped short)
// the per-stage <label>.usage.json files are the only record, so they are
// summed directly.
export function budgetOf(dir, report) {
  const stopped = readJson(join(dir, 'STOPPED-budget.json'));
  // Audit A5-4 (0.8.1): a finished run's spend is what `council --spend` says, which also counts a handoff --from-run call made after the report (superseded/).
  // 0.8.3 (Builder D, Batch 1 audit item 10): the usage-file sum is spend.js's own (one reader, usdFigure): a figure that is there and is not a number of
  // dollars (a string, a negative, null) is no longer added or read as 0; `spentUsd` is then a FLOOR and `unknownFigures` says so, and `remainingUsd` is 0 (fail closed:
  // a limit is not "room left" on a spend that cannot be read). Absent when every figure read, so the answer's shape is unchanged.
  let spent;
  let unknownFigures = 0;
  if (report?.totals?.usd !== undefined && report?.totals?.usd !== null) {
    ({ usd: spent, unknownFigures } = runSpendOf(dir));
  } else if (!existsSync(dir)) {
    spent = 0;
  } else {
    const files = usageSpendOf(dir);
    unknownFigures = files.unknownFigures + supersededUnknownFilesOf(dir).length;
    spent = files.usd
      // Money path #2: stages a resume re-ran keep their first payment in superseded/.
      + supersededSpendOf(dir)
      // 0.8.2 item 8b: a call in flight when the process died stays charged at its worst case, so a killed run's remaining budget is what a resume will enforce.
      + unsettledUsd(dir);
  }
  const cap = report?.maxUsd ?? stopped?.capUsd ?? readJson(join(dir, 'run.json'))?.maxUsd ?? null;
  return {
    spentUsd: spent,
    capUsd: cap,
    remainingUsd: cap === null || cap === undefined ? null : (unknownFigures ? 0 : Math.max(0, cap - spent)),
    stoppedByCap: stopped ? { stage: stopped.stoppedAt, seat: stopped.seat, projectedStageUsd: stopped.projectedStageUsd } : null,
    ...(unknownFigures ? { unknownFigures } : {}),
  };
}
