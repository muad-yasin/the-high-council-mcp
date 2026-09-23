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

// Bug-audit fix, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #3): --rematch and --replay
// write sibling folders named `<run-id>.rematch-<seed>` and `<run-id>.replay-<YYYY-MM-DD>`. Those
// failed runIdToDate, so --spend never counted what they paid. runIdToDate itself stays strict -
// metrics, verdict-stats and cost-forecast read it and must not start treating a rematch as a
// separate run - so spend has its own reader. The timestamp in the name is the ORIGINAL run's, not
// when the rematch/replay ran and paid, so the date comes from the folder's own files instead.
const SIDE_RUN = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2})$/;
export function spendDateOf(runsDir, id) {
  const strict = runIdToDate(id);
  if (strict) return strict;
  if (!SIDE_RUN.test(id)) return null;
  const dir = join(runsDir, id);
  for (const f of ['report.json', 'STOPPED-budget.json', 'run.json']) {
    try { return statSync(join(dir, f)).mtime; } catch { /* try the next */ }
  }
  try { return statSync(dir).mtime; } catch { return null; }
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
  // A capped --rematch/--replay has no stage cache, so no usage files - its STOPPED-budget.json
  // carries what the sitting spent. A normal stopped run has usage files, which win.
  if (!stages) usd = readJson(join(dir, 'STOPPED-budget.json'))?.spentUsd ?? 0;
  return { usd, chain: readJson(join(dir, 'run.json'))?.chain ?? null, complete: false, stages };
}

// v2 plan §8 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md), narrowed per
// decision in DECISIONS.md: §8 proposed a new ledger file to get per-call cost granularity
// and a calendar-day "cost-today" view. Both are already derivable from what's on disk -
// report.json's `stages` array for a finished run, individual `<label>.usage.json` files for
// one still going - so this extends the existing derivation instead of adding a ledger.
//
// Per-call/per-stage cost breakdown for one run: [{ label, provider, model, usd }, ...].
function stagesOfRun(dir) {
  const report = readJson(join(dir, 'report.json'));
  if (Array.isArray(report?.stages)) {
    return report.stages.map(s => ({ label: s.label, provider: s.provider ?? null, model: s.model ?? null, usd: s.usd ?? 0 }));
  }
  const stages = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.usage.json')) continue;
    const u = readJson(join(dir, f));
    if (!u) continue;
    stages.push({ label: f.replace(/\.usage\.json$/, ''), provider: u.provider ?? null, model: u.model ?? null, usd: u.usd ?? 0 });
  }
  return stages;
}

// Aggregate per-model spend across a list of run directories - the "per-call granularity"
// §8 wanted, without a ledger: sum every stage's cost by provider/model across every run
// given, in one pass over files already being read for their totals anyway.
function perModelBreakdown(dirs) {
  const byModel = new Map();
  for (const dir of dirs) {
    for (const s of stagesOfRun(dir)) {
      const key = `${s.provider ?? '?'}/${s.model ?? '?'}`;
      byModel.set(key, (byModel.get(key) ?? 0) + s.usd);
    }
  }
  return [...byModel.entries()]
    .map(([model, usd]) => ({ model, usd }))
    .sort((a, b) => b.usd - a.usd);
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
    const when = spendDateOf(runsDir, id);
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

/**
 * What has been spent today, by the local calendar day (midnight to midnight), not a
 * rolling 24h window like spendReport's default - the distinction §8 asked for by name.
 * Adds a per-model breakdown across every run counted, which is the per-call granularity
 * §8 wanted a ledger for; both are derived from the same on-disk files spendReport already
 * reads, so no new file is written anywhere.
 *
 * Never throws, same degradation contract as spendReport.
 */
export function costToday(runsDir, { date = new Date(), now = Date.now() } = {}) {
  const day = new Date(date);
  const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  // The next local midnight, not start + 24h: DST change days are 23 or 25 hours long, and
  // the fixed length dropped a late-evening run (autumn) or counted one twice (spring).
  const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const runs = [];
  const countedDirs = [];
  let unreadable = 0;

  let ids = [];
  try {
    ids = existsSync(runsDir) ? readdirSync(runsDir) : [];
  } catch {
    return { runsDir, date: new Date(startOfDay), runs: [], totalUsd: 0, count: 0,
             unreadable: 0, perModel: [], note: 'runs directory could not be read' };
  }

  for (const id of ids) {
    const when = spendDateOf(runsDir, id);
    if (!when || when.getTime() < startOfDay || when.getTime() >= endOfDay) continue;
    const dir = join(runsDir, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const { usd, chain, complete } = costOfRun(dir);
      runs.push({ id, when, chain, usd, state: stateOf(dir), complete });
      countedDirs.push(dir);
    } catch {
      unreadable += 1;
    }
  }

  runs.sort((a, b) => b.when - a.when);
  return {
    runsDir,
    date: new Date(startOfDay),
    runs,
    totalUsd: runs.reduce((s, r) => s + r.usd, 0),
    count: runs.length,
    perModel: perModelBreakdown(countedDirs),
    unreadable,
  };
}
