// Cross-run spend accounting.
//
// "What have I spent today, across every run" is not answerable from
// run_status, which reports one run, or from the per-run cap, which governs
// one run. This answers it.
//
// It is DERIVED, not recorded. There is no ledger file and nothing to append
// to: every figure here is read back out of runs/<id>/ on disk, the same
// disk-is-the-source-of-truth convention the rest of the project uses. That
// choice buys four things a separate ledger cannot:
//
//   - It cannot drift. A ledger is a second copy of the truth, and a second
//     copy that is written on a path that can fail is a copy that will
//     eventually disagree with the run folders.
//   - It has no failure mode to degrade from. Nothing is written, so a run
//     can never fail, stall or warn because bookkeeping failed.
//   - It is retroactive. Runs that completed before this file existed are
//     already accounted for.
//   - It respects deletion. Delete a run folder because the work was
//     sensitive and its cost goes with it. An append-only ledger outside the
//     project would keep a record of work the user deliberately destroyed.
//
// Privacy: chain name, cost and state only. Never the task path or any run
// content - what a run was about is not spend data.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// Run ids are ISO timestamps with : and . replaced, e.g.
// 2026-09-11T10-06-06-899Z. Anything else in runs/ is not ours; skip it.
export function runIdToDate(runId) {
  const d = new Date(runId.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

// A finished run's cost is in report.json. A run that is still going, or that
// the cap stopped, has no report - but every stage it paid for left a
// <label>.usage.json behind, so the spend is still on disk.
function costOfRun(dir) {
  const report = readJson(join(dir, 'report.json'));
  if (report?.totals?.usd !== undefined && report?.totals?.usd !== null) {
    return { usd: report.totals.usd, chain: report.chain ?? null, complete: true };
  }
  let usd = 0;
  let stages = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.usage.json')) continue;
    usd += readJson(join(dir, f))?.usd ?? 0;
    stages += 1;
  }
  return { usd, chain: readJson(join(dir, 'run.json'))?.chain ?? null, complete: false, stages };
}

function stateOf(dir) {
  if (existsSync(join(dir, 'report.json'))) return 'complete';
  if (existsSync(join(dir, 'STOPPED-budget.json'))) return 'stopped: spend cap';
  if (readdirSync(dir).some(f => f.startsWith('NEEDS-'))) return 'paused';
  return 'incomplete';
}

/**
 * Spend across every run in `runsDir` within the last `days`.
 *
 * Never throws. A missing or unreadable runs/ is not an error - it means no
 * runs, which is a true and useful answer.
 */
export function spendReport(runsDir, { days = 1, now = Date.now() } = {}) {
  const cutoff = now - days * 24 * 3600 * 1000;
  const runs = [];
  let unreadable = 0;

  let ids = [];
  try {
    ids = existsSync(runsDir) ? readdirSync(runsDir) : [];
  } catch {
    return { runsDir, days, since: new Date(cutoff), runs: [], totalUsd: 0, count: 0,
             unreadable: 0, note: 'runs directory could not be read' };
  }

  for (const id of ids) {
    const when = runIdToDate(id);
    if (!when || when.getTime() < cutoff) continue;
    const dir = join(runsDir, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const { usd, chain, complete } = costOfRun(dir);
      runs.push({ id, when, chain, usd, state: stateOf(dir), complete });
    } catch {
      unreadable += 1;   // a run folder we cannot read is reported, not fatal
    }
  }

  runs.sort((a, b) => b.when - a.when);
  return {
    runsDir, days,
    since: new Date(cutoff),
    runs,
    totalUsd: runs.reduce((s, r) => s + r.usd, 0),
    count: runs.length,
    unreadable,
  };
}
