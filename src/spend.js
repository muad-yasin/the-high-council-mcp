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

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { supersededSpendOf, supersededStagesOf, supersededUnknownFilesOf } from './superseded.js';
import { unsettledUsd } from './spend-reservations.js';
import { usdFigure } from './usd-figure.js';
import { deriveRunStatus, APPROVAL_STATUSES, stoppedShortFile, waitingStages } from './run-status.js';
import { readStoppedMarker, waitsForPerson, ROUND_STOPPED_STATE } from './stop-files.js';
import { runFolderKind } from './run-files.js';
import { readTreeRecord, stateOf as treeStateOf } from './tree-record.js';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// Run ids are ISO timestamps with : and . replaced, e.g.
// 2026-09-11T10-06-06-899Z. Anything else in runs/ is not ours; skip it.
// Pre-release audit, metrics #3 (Review/PreRelease_Audit_metrics_2026-09-23.md): the whole id is
// matched now. `new Date()` alone accepted "2026-09-23", "old-2026-09-23" and "2026", so a renamed or
// copied run folder was counted twice by --spend, --stats and --metrics.
const RUN_ID = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
export function runIdToDate(runId) {
  const m = RUN_ID.exec(String(runId));
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Bug-audit fix, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #3): --rematch and --replay
// write sibling folders named `<run-id>.rematch-<seed>` and `<run-id>.replay-<YYYY-MM-DD>`. Those
// failed runIdToDate, so --spend never counted what they paid. runIdToDate itself stays strict -
// metrics, verdict-stats and cost-forecast read it and must not start treating a rematch as a
// separate run - so spend has its own reader. The timestamp in the name is the ORIGINAL run's, not
// when the rematch/replay ran and paid, so the date comes from the folder's own files instead.
const SIDE_RUN = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2})$/;
/** A name the spend readers treat as a run folder's: a run id or a --rematch / --replay side folder. Asked before anything is read (the kind check comes first, then the date). */
const looksLikeRunName = id => runIdToDate(id) !== null || SIDE_RUN.test(id);
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
// `council handoff --from-run` pays for a call after the run is over. Since 0.8.1 (FX-1) each call is its own file in
// superseded/; a 0.8.0 run folder may still hold the single handoff-from-run.usage.json, read here for old folders only.
// 0.8.3 M6 (Builder D; Batch 1 audit item 10 and Batch 3 entry 14): ONE rule for a dollar figure read out of a run folder (the rule is src/cost.js readUsd's: a finite number of zero or more). An ABSENT
// figure is $0 on purpose (an external stage records 0 itself; a file from before costs were recorded). A figure that is PRESENT and not a number of that kind is UNKNOWN: null (what JSON.stringify writes for a NaN),
// a string (it used to be concatenated: "0.5" + 1 = "0.51"), a negative number (it used to lower the total), NaN, Infinity, an object. Unknown is never read as 0 and never added. The returned `usd` stays a finite
// number - the sum of the figures that DO read, a floor (the tree's unreadable-member acceptance route already treats it so, and nothing here may become null or Infinity in a record or an answer) - and the count
// of unknown figures travels beside it as `unknownFigures` (0 when every figure read), so the places that decide or show money can say "at least". No real writer writes a null (Review/Build_0.8.3/d-scratch/null-usd-writers.md).
export { usdFigure };   // the rule lives in src/usd-figure.js (shared with superseded.js)
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/**
 * The sum of a folder's top-level `<label>.usage.json` figures: { usd (the readable part), stages (files), unknownFigures, unknownFiles }. A file that does not parse is an unknown figure too (its cost
 * cannot be read). `unknownFiles` names them (file names inside the run folder, never content) so a person can find and repair them: the monthly policy check lists them.
 */
export function usageSpendOf(dir) {
  let usd = 0;
  let stages = 0;
  const unknownFiles = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.usage.json')) continue;
    const u = readJson(join(dir, f));
    const n = isRecord(u) ? usdFigure(u.usd) : null;
    if (n === null) unknownFiles.push(f); else usd += n;
    stages += 1;
  }
  return { usd, stages, unknownFigures: unknownFiles.length, unknownFiles };
}

// 0.8.2 item 8b (src/spend-reservations.js): a call that was in flight when its process ended stays charged at its worst case, here and in a resume's cap. The one recorded figure in this derivation.
function costOfRun(dir) {
  const r = costOfRunSettled(dir);
  // 0.8.3 M2e: when STOPPED-budget.json supplied the figure (no stage finished), that figure is the TOTAL at the stop and already holds the earlier superseded records and the earlier unsettled reservations
  // (budgetState().spent, countEarlierSpend in src/cli.js). Adding them again counted an in-flight call twice: W became 2W. The larger of the stop file's total and what is on disk now is the figure: spend that
  // arrived AFTER the stop (a later superseded record) is on disk and wins; nothing is added twice.
  if (r.stoppedUsd !== undefined) return { ...r, usd: Math.max(r.stoppedUsd, r.usd + unsettledUsd(dir)) };
  return { ...r, usd: r.usd + unsettledUsd(dir) };
}

function costOfRunSettled(dir) {
  const report = readJson(join(dir, 'report.json'));
  const unknownFiles = [];
  if (report?.totals?.usd !== undefined && report?.totals?.usd !== null) {
    const total = usdFigure(report.totals.usd);
    if (total !== null) {
      // report.json's total already holds the superseded spend it saw (totals.supersededUsd); what superseded/ gained after
      // the report was written (a handoff --from-run call, FX-1) is added, so nothing is counted twice.
      const later = Math.max(0, supersededSpendOf(dir) - (Number(report.totals.supersededUsd) || 0));
      const handoff = usdFigure(readJson(join(dir, 'handoff-from-run.usage.json'))?.usd);
      if (handoff === null) unknownFiles.push('handoff-from-run.usage.json');
      unknownFiles.push(...supersededUnknownFilesOf(dir));
      return { usd: total + (handoff ?? 0) + later, chain: report.chain ?? null, complete: true, unknownFigures: unknownFiles.length, unknownFiles };
    }
    // a total that is there and is not a number (a string, a negative): the report cannot be trusted for the figure; the stage files below give a floor and the count says so
    unknownFiles.push('report.json');
  }
  const files = usageSpendOf(dir);
  let usd = files.usd;
  const stages = files.stages;
  unknownFiles.push(...files.unknownFiles);
  // A capped --rematch/--replay has no stage cache, so no usage files - its STOPPED-budget.json
  // carries what the sitting spent. A normal stopped run has usage files, which win.
  let stoppedUsd;
  if (!stages) {
    stoppedUsd = usdFigure(readJson(join(dir, 'STOPPED-budget.json'))?.spentUsd);
    if (stoppedUsd === null) { unknownFiles.push('STOPPED-budget.json'); stoppedUsd = 0; }
  }
  if (!stages) usd = 0;                 // the stop file's figure is applied in costOfRun, which also knows the unsettled reservations
  // Money path #2: stages a resume found stale and re-ran keep their first payment in superseded/.
  usd += supersededSpendOf(dir);
  unknownFiles.push(...supersededUnknownFilesOf(dir));
  return { usd, ...(stoppedUsd !== undefined ? { stoppedUsd } : {}), chain: readJson(join(dir, 'run.json'))?.chain ?? null, complete: false, stages, unknownFigures: unknownFiles.length, unknownFiles };
}

/** What one run folder has cost so far, in USD (report.json's total, else its usage files), handoff-from-run included. */
export const runSpentUsd = dir => costOfRun(dir).usd;
/** The same, with the count of figures that did not read and the files they are in: { usd (a floor when unknownFigures > 0), unknownFigures, unknownFiles }. */
export const runSpendOf = dir => { const r = costOfRun(dir); return { usd: r.usd, unknownFigures: r.unknownFigures, unknownFiles: r.unknownFiles }; };
/** Did every figure of this run folder read? false = `runSpentUsd` is a floor (see usdFigure): a caller that enforces a limit must not treat it as the whole spend. */
export const runSpendIsKnown = dir => runSpendOf(dir).unknownFigures === 0;

// v2 plan §8 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md), narrowed per
// decision in maintainers/DECISIONS.md: §8 proposed a new ledger file to get per-call cost granularity
// and a calendar-day "cost-today" view. Both are already derivable from what's on disk -
// report.json's `stages` array for a finished run, individual `<label>.usage.json` files for
// one still going - so this extends the existing derivation instead of adding a ledger.
//
// Per-call/per-stage cost breakdown for one run: [{ label, provider, model, usd }, ...].
function stagesOfRun(dir) {
  const report = readJson(join(dir, 'report.json'));
  if (Array.isArray(report?.stages)) {
    const extra = readJson(join(dir, 'handoff-from-run.usage.json'));
    return [...report.stages.map(s => stageRow(s.label, s.provider, s.model, s.usd)),
      ...(extra ? [stageRow('handoff-from-run', extra.provider, extra.model, extra.usd)] : []), ...supersededStagesOf(dir)];
  }
  const stages = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.usage.json')) continue;
    const u = readJson(join(dir, f));
    if (!u) continue;
    stages.push(stageRow(f.replace(/\.usage\.json$/, ''), u.provider, u.model, u.usd));
  }
  return [...stages, ...supersededStagesOf(dir)];
}
// one stage's row: the figure is the readable part (0 when it does not read) and `unknown` says so
function stageRow(label, provider, model, rawUsd) {
  const n = usdFigure(rawUsd);
  return { label, provider: provider ?? null, model: model ?? null, usd: n ?? 0, ...(n === null ? { unknown: true } : {}) };
}

// Aggregate per-model spend across a list of run directories - the "per-call granularity"
// §8 wanted, without a ledger: sum every stage's cost by provider/model across every run
// given, in one pass over files already being read for their totals anyway.
function perModelBreakdown(dirs) {
  const byModel = new Map();
  for (const dir of dirs) {
    for (const s of stagesOfRun(dir)) {
      const key = `${s.provider ?? '?'}/${s.model ?? '?'}`;
      const row = byModel.get(key) ?? { usd: 0, unknownFigures: 0 };
      row.usd += s.usd;
      if (s.unknown) row.unknownFigures += 1;
      byModel.set(key, row);
    }
  }
  return [...byModel.entries()]
    .map(([model, r]) => ({ model, usd: r.usd, ...(r.unknownFigures ? { unknownFigures: r.unknownFigures } : {}) }))
    .sort((a, b) => b.usd - a.usd);
}

function stateOf(dir) {
  // Pre-release audit, metrics #4: a report.json that exists but does not parse is not a finished run
  // (costOfRun already treats it as absent); it used to read "complete" at $0.
  if (readJson(join(dir, 'report.json'))) return 'complete';
  if (existsSync(join(dir, 'report.json'))) return 'incomplete: report.json unreadable';
  if (existsSync(join(dir, 'STOPPED-error.md'))) return 'stopped: error';
  if (existsSync(join(dir, 'STOPPED-budget.json'))) return 'stopped: spend cap';
  // 0.8.1 M6: an advice call a person, its client or its wall clock stopped (exit 18); what it paid for is counted like any run's.
  const stop = readStoppedMarker(dir);
  if (stop && waitsForPerson(stop.stoppedBy)) return ROUND_STOPPED_STATE;   // a layered run stopped at an overseer limit (exit 23) or a run whose seat was price-refused (exit 24), waiting for the person's choice
  if (stop) return `stopped: ${({ user: 'by a person', client_cancel: 'by its client', wall_clock: 'at its wall clock' })[stop.stoppedBy]}`;
  const short = stoppedShortFile(dir);
  if (short) return `stopped: ${({ 'STOPPED-preflight.md': 'task refused before any stage', 'STOPPED-secret.md': 'a key-shaped string in the prompt' })[short] ?? 'a draft did not complete'}`;
  if (waitingStages(dir).length) return 'paused';
  // An advice call's folder before its run starts (0.8.1 DR-15): made by the server before a person answers its gate; nothing was
  // sent or spent, so it is named for what it is rather than read as a run that died (M4 review follow-up).
  // Only an advice folder: deriveRunStatus may look for a live process, and this report must stay a cheap read (review nit).
  if (!existsSync(join(dir, 'run.json')) && existsSync(join(dir, 'advice.meta.json'))) {
    const s = deriveRunStatus(dir, null);
    if (APPROVAL_STATUSES.includes(s)) return `advice call not started: ${s.replace('_', ' ')} (nothing sent or spent)`;
  }
  return 'incomplete';
}

// One row of either report. A folder an advice call made before its start names its chain only in advice.meta.json.
function runRow(id, when, dir) {
  const { usd, chain, complete, unknownFigures, unknownFiles } = costOfRun(dir);
  return { id, when, chain: chain ?? readJson(join(dir, 'advice.meta.json'))?.chain ?? null, usd, state: stateOf(dir), complete, unknownFigures, unknownFiles };
}

// 0.8.3 M6 S7 (d), PLAN 10.2: the per-tree subtotal of a spend report. ADDITIVE: the rows and `totalUsd` are untouched, and a subtotal is a part of that total, never added to it again. A tree's members are the
// rows of runs that the tree's OWN record lists (a node_registered with their run id): run.json is project-writable text, so its `tree.treeId` only says which record to ask, never what counts. The root folder must be
// a real folder (a symbolic link gives no subtotal). Each figure is the row's usd, i.e. runSpentUsd, the same number tree/report.json sums as memberSpend. `memberRuns` is the number of members INSIDE the report's
// window (a window can cut a tree). Output: a tree id (a run id) and amounts only. Never throws: a tree whose record cannot be read has no subtotal (its runs are still in the rows and the total).
const TREE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/**
 * ROADMAP 57 (c3): did a person abandon this tree? READ-ONLY and for the CLI's `--spend` line only: the MCP `spend_report` `trees` entry stays as it was (Q11), so the flag is NOT part of treeSubtotals' output.
 * Never throws (a tree whose record cannot be read is not reported as abandoned); a link is not a folder.
 */
export function treeIsAbandoned(runsDir, treeId) {
  try {
    if (typeof treeId !== 'string' || !TREE_ID.test(treeId)) return false;
    const rootDir = join(runsDir, treeId);
    if (!lstatSync(rootDir).isDirectory()) return false;
    const record = readTreeRecord(rootDir);
    return record.exists && !record.corrupt.length && treeStateOf(record).abandoned !== null;
  } catch { return false; }
}
function treeSubtotals(runsDir, rows) {
  const claimed = new Map();
  for (const row of rows) {
    const treeId = readJson(join(runsDir, row.id, 'run.json'))?.tree?.treeId;
    if (typeof treeId !== 'string' || !TREE_ID.test(treeId)) continue;
    if (!claimed.has(treeId)) claimed.set(treeId, []);
    claimed.get(treeId).push(row);
  }
  const out = [];
  for (const [treeId, claimants] of [...claimed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    try {
      const rootDir = join(runsDir, treeId);
      if (!lstatSync(rootDir).isDirectory()) continue;                       // lstat: a link is not a folder
      const record = readTreeRecord(rootDir);
      if (!record.exists) continue;
      const listed = new Set(record.events.filter(e => e.event === 'node_registered' && typeof e.runId === 'string').map(e => e.runId));
      const members = claimants.filter(r => listed.has(r.id));
      if (members.length) { const unknown = members.reduce((s, r) => s + r.unknownFigures, 0); out.push({ treeId, memberRuns: members.length, usd: members.reduce((s, r) => s + r.usd, 0), ...(unknown ? { unknownFigures: unknown } : {}) }); }
    } catch { /* an unreadable tree has no subtotal; its runs stay in the rows and the total (this report never throws) */ }
  }
  return out;
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
  let symbolicLinksNotCounted = 0;

  let ids = [];
  try {
    ids = existsSync(runsDir) ? readdirSync(runsDir) : [];
  } catch {
    return { runsDir, days, since: new Date(cutoff), runs: [], trees: [], totalUsd: 0, count: 0,
             unreadable: 0, symbolicLinksNotCounted: 0, unknownFigures: 0, note: 'runs directory could not be read' };
  }

  for (const id of ids) {
    if (!looksLikeRunName(id)) continue;
    // a symbolic link in runs/ is never a run (the harness never makes one): asked FIRST (before the date and the window, so a dangling link and a link outside the window are counted too), counted apart, never read as a second run (src/run-files.js runFolderKind, the one predicate every reader of runs/ asks)
    const kind = runFolderKind(join(runsDir, id));
    if (kind === 'link') { symbolicLinksNotCounted += 1; continue; }
    const when = spendDateOf(runsDir, id);
    if (!when || when.getTime() < cutoff) continue;
    const dir = join(runsDir, id);
    if (kind === 'missing') { unreadable += 1; continue; }
    if (kind !== 'folder') continue;
    try {
      runs.push(runRow(id, when, dir));
    } catch {
      unreadable += 1;   // a run folder we cannot read is reported, not fatal
    }
  }

  runs.sort((a, b) => b.when - a.when);
  return {
    runsDir, days,
    since: new Date(cutoff),
    runs,
    trees: treeSubtotals(runsDir, runs),
    totalUsd: runs.reduce((s, r) => s + r.usd, 0),
    unknownFigures: runs.reduce((s, r) => s + r.unknownFigures, 0),   // 0 when every figure read; otherwise totalUsd is a floor (usdFigure)
    count: runs.length,
    unreadable,
    symbolicLinksNotCounted,
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
  let symbolicLinksNotCounted = 0;

  let ids = [];
  try {
    ids = existsSync(runsDir) ? readdirSync(runsDir) : [];
  } catch {
    return { runsDir, date: new Date(startOfDay), runs: [], totalUsd: 0, count: 0,
             unreadable: 0, symbolicLinksNotCounted: 0, unknownFigures: 0, perModel: [], note: 'runs directory could not be read' };
  }

  for (const id of ids) {
    if (!looksLikeRunName(id)) continue;
    // a symbolic link in runs/ is never a run (the harness never makes one): asked FIRST (before the date and the window, so a dangling link and a link outside the window are counted too), counted apart, never read as a second run (src/run-files.js runFolderKind, the one predicate every reader of runs/ asks)
    const kind = runFolderKind(join(runsDir, id));
    if (kind === 'link') { symbolicLinksNotCounted += 1; continue; }
    const when = spendDateOf(runsDir, id);
    if (!when || when.getTime() < startOfDay || when.getTime() >= endOfDay) continue;
    const dir = join(runsDir, id);
    if (kind === 'missing') { unreadable += 1; continue; }
    if (kind !== 'folder') continue;
    try {
      runs.push(runRow(id, when, dir));
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
    unknownFigures: runs.reduce((s, r) => s + r.unknownFigures, 0),
    count: runs.length,
    perModel: perModelBreakdown(countedDirs),
    unreadable,
    symbolicLinksNotCounted,
  };
}
