// What a run has spent and what it has left (moved out of src/mcp/server.js unchanged so a test can reach it).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supersededSpendOf } from './superseded.js';
import { runSpentUsd } from './spend.js';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// What a run has spent and what it has left. Source of truth is report.json
// once the run finished; while it is still running (or was stopped short)
// the per-stage <label>.usage.json files are the only record, so they are
// summed directly.
export function budgetOf(dir, report) {
  const stopped = readJson(join(dir, 'STOPPED-budget.json'));
  // Audit A5-4 (0.8.1): a finished run's spend is what `council --spend` says, which also counts a handoff --from-run call made after the report (superseded/).
  let spent = report?.totals?.usd === undefined || report?.totals?.usd === null ? undefined : runSpentUsd(dir);
  if (spent === undefined || spent === null) {
    spent = !existsSync(dir) ? 0 : readdirSync(dir)
      .filter(f => f.endsWith('.usage.json'))
      .reduce((sum, f) => sum + (readJson(join(dir, f))?.usd ?? 0), 0)
      // Money path #2: stages a resume re-ran keep their first payment in superseded/.
      + (existsSync(dir) ? supersededSpendOf(dir) : 0);
  }
  const cap = report?.maxUsd ?? stopped?.capUsd ?? readJson(join(dir, 'run.json'))?.maxUsd ?? null;
  return {
    spentUsd: spent,
    capUsd: cap,
    remainingUsd: cap === null || cap === undefined ? null : Math.max(0, cap - spent),
    stoppedByCap: stopped ? { stage: stopped.stoppedAt, seat: stopped.seat, projectedStageUsd: stopped.projectedStageUsd } : null,
  };
}
