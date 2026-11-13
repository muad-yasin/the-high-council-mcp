// 0.8.4 unit 6 (D11; plan A T6.2 and T6.6; Mini-C&C R393/R394): the ONE reader of a run folder's COUNTED records, with the basis of each (src/counted-bases.js). The spend report, `--spend`, run_status, the floor a new typed
// limit must exceed and the report's `totals.counted` read it, so one paid call is counted once whatever else is on disk. Like src/provider-reported.js it is DERIVED from the files at the moment it is asked, never recorded.
//
// What it reads (each file once; report.json is never read):
//   top-level `<label>.usage.json` ......... a stage's record (also `handoff-from-run.usage.json`, `<stage>.late.usage.json`)
//   superseded/`<label>.<n>.usage.json` .... a stage set aside (stale or orphaned)
//   superseded/`<label>.call-<n>.usage.json` ... the one paid call of handoff --from-run, contract draft or digest
//   superseded/`<label>.charge-<n>.usage.json` ... a failed attempt's charge (kind `billed`), or a discarded thinking attempt's waste (kind `waste`)
//   spend-reservations.jsonl ............... for the two records that have NO file: an unsettled reservation (the call was in flight when the process ended: its worst case, basis `reserved_unsettled`) and a settled call whose
//                                            usage file was never written and whose reserved line is in the folder (settle runs before the file is written; a kill in between loses the payment from every disk sum): its SETTLED figure, never a waste part.
// The dedupe key is the reservation id and it is used for two things only. (1) A SETTLED line is not counted as a call with no file when a usage or charge file carries its id. (2) A call with an UNSETTLED reservation and a file that carries
// its id counts ONCE, at the WORST CASE (the larger of the reservation and the file), as `reserved_unsettled`: an unsettled reservation is never reconciled (CLAUDE.md "The one recorded figure"; C&C's ruling, Mini-C&C R398).
// Files are never merged against files by id: a discarded thinking attempt's `waste` charge and the call's `billed` charge SHARE one id and are different amounts, so a `waste` file does not mark an id as carried. A line that a fallback
// reservation names in `standsFor` (src/cli.js recordCallOrCharge, written when a call's record could not be written) is carried too: the fallback counts the call, once, at its worst case.
//
// The counted amount of every record is THC's OWN figure (`usd`). OpenRouter's reported figure is recorded beside it and counted nowhere (his 03 and 04 Nov 2026 pick; plan A F3 (c) is superseded): `countedAmountOf` is the one place
// that rule lives.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { usdFigure } from './usd-figure.js';
import { reservationLinesOf } from './spend-reservations.js';
import { ESTIMATED_BASES, isBasis } from './counted-bases.js';

const SUPERSEDED = 'superseded';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const readRecord = path => { try { const o = JSON.parse(readFileSync(path, 'utf8')); return isRecord(o) ? o : null; } catch { return null; } };

/** The amount a record counts for: THC's own `usd` (a figure that does not read is `null`, unknown). The provider-reported figure is never the counted amount (units 1-2). The ONE place this rule lives. */
export function countedAmountOf(rec) {
  return isRecord(rec) ? usdFigure(rec.usd) : null;
}

function fileRecords(runDir) {
  const out = [];
  const add = (source, file, path) => {
    const rec = readRecord(path);
    const usd = countedAmountOf(rec);
    out.push({
      source, file, label: file.replace(/\.usage\.json$/, ''), usd: usd ?? 0, unknown: usd === null,
      basis: isBasis(rec?.basis) ? rec.basis : null,
      reservationId: typeof rec?.reservationId === 'string' && rec.reservationId ? rec.reservationId : null,
      ...(typeof rec?.capName === 'string' && rec.capName ? { capName: rec.capName } : {}),
      ...(rec?.kind === 'waste' ? { kind: 'waste' } : {}),
    });
  };
  try { for (const f of readdirSync(runDir)) if (f.endsWith('.usage.json')) add('stage', f, join(runDir, f)); } catch { /* an unreadable folder counts what was read */ }
  const sup = join(runDir, SUPERSEDED);
  try {
    if (existsSync(sup)) {
      for (const f of readdirSync(sup)) {
        if (!f.endsWith('.usage.json')) continue;
        add(/\.charge-\d+\.usage\.json$/.test(f) ? 'charge' : /\.call-\d+\.usage\.json$/.test(f) ? 'call' : 'superseded', `${SUPERSEDED}/${f}`, join(sup, f));
      }
    }
  } catch { /* as above */ }
  return out;
}

/** The stage label a record file stands for: 'superseded/x.charge-2.usage.json' -> 'x', 'x.usage.json' -> 'x'. */
export const baseLabelOf = file => file.replace(/^superseded\//, '').replace(/\.usage\.json$/, '').replace(/\.(charge|call)-\d+$/, '').replace(/\.\d+$/, '');

/** Ids a file carries as a PAID call (a `waste` charge does not mark its call's id: it shares the id with the billed charge). */
function carriedIds(files, lines) {
  const ids = new Set();
  for (const r of files) if (r.reservationId && r.kind !== 'waste') ids.add(r.reservationId);
  for (const l of lines) if (l.event === 'reserved' && typeof l.standsFor === 'string' && l.standsFor) ids.add(l.standsFor);
  return ids;
}

/**
 * The reservation-file records and the files they touch. { records, unsettledCarried }:
 *   records ........ [{ source: 'unsettled'|'settled', label, usd, basis, reservationId, capName? }] - what the reservation file holds that the usage files do not
 *   unsettledCarried  the ids of unsettled reservations a usage or charge file also carries
 * An unsettled reservation is never reconciled (CLAUDE.md "The one recorded figure"; C&C's ruling, Mini-C&C R398): a call that has BOTH an unsettled reservation and a file carrying its id counts ONCE, at the WORST CASE (the larger of the
 * reservation and the file), in every reader, and the whole of it is an estimate (`reserved_unsettled`). The file's own amount is in the files' sum; the record here is the rest of the worst case, so the folder holds max(worst, file).
 */
function analyse(runDir, files) {
  const lines = reservationLinesOf(runDir);
  const unsettledCarried = new Set();
  if (!lines.length) return { records: [], unsettledCarried };
  files = files ?? fileRecords(runDir);
  const carried = carriedIds(files, lines);
  const fileUsdById = new Map();
  for (const r of files) if (r.reservationId && r.kind !== 'waste') fileUsdById.set(r.reservationId, (fileUsdById.get(r.reservationId) ?? 0) + r.usd);
  const reserved = new Map(lines.filter(l => l.event === 'reserved').map(l => [l.id, l]));
  const settled = new Map(lines.filter(l => l.event === 'settled').map(l => [l.id, l]));
  // A record written before reservation ids were kept (or by hand) carries none: it stands for a settled line of its label, so that line is not counted as a call with no file.
  const labelsWithoutId = new Set(files.filter(r => !r.reservationId).map(r => baseLabelOf(r.file)));
  const records = [];
  for (const [id, l] of reserved) {
    if (settled.has(id) || !Number.isFinite(l.usd) || !(l.usd > 0)) continue;
    const capName = typeof l.capName === 'string' && l.capName ? { capName: l.capName } : {};
    if (fileUsdById.has(id)) {
      unsettledCarried.add(id);
      const rest = Math.max(0, l.usd - fileUsdById.get(id));
      if (rest > 0) records.push({ source: 'unsettled', label: l.label ?? '', usd: rest, basis: 'reserved_unsettled', reservationId: id, ...capName });
    } else records.push({ source: 'unsettled', label: l.label ?? '', usd: l.usd, basis: 'reserved_unsettled', reservationId: id, ...capName });
  }
  for (const [id, s] of settled) {
    if (carried.has(id) || !Number.isFinite(s.usd) || !(s.usd > 0)) continue;
    const r = reserved.get(id);   // the settled line carries only the figure: the label and the cap name come from its reserved line
    if (!r) continue;   // 0.8.4 unit 6 (D11, C&C): a settled line whose reserved line is not in the folder is damage (a call is reserved before it is sent), not a call to count; tree accounting blocks it (settled_without_reserved) and the tree's own mirror holds the reservation
    if (labelsWithoutId.has(r.label)) continue;
    if (s.outcome !== 'recorded' && s.outcome !== 'billed_unreadable') continue;
    records.push({ source: 'settled', label: r?.label ?? '', usd: s.usd, basis: isBasis(s.basis) ? s.basis : (s.outcome === 'recorded' ? 'token_priced' : 'worst_case'), reservationId: id, ...(typeof r?.capName === 'string' && r.capName ? { capName: r.capName } : {}) });
  }
  return { records, unsettledCarried };
}
/** The reservation-file records (see analyse). */
export const reservationRecordsOf = (runDir, files = null) => analyse(runDir, files).records;

/** Every counted record of the folder: the files, then the reservation-file records. Never throws. */
export function countedRecordsOf(runDir) {
  const files = fileRecords(runDir);
  const { records, unsettledCarried } = analyse(runDir, files);
  // a file whose reservation was never settled is part of an estimate, whatever it names (the call counts at the larger of the two)
  const marked = files.map(r => (r.reservationId && r.kind !== 'waste' && unsettledCarried.has(r.reservationId) ? { ...r, basis: 'reserved_unsettled' } : r));
  return [...marked, ...records];
}

/**
 * What the folder holds that the files' own sum does NOT: { usd, unsettledUsd, settledOnlyUsd } (optionally for one cap). `settledOnly: false` leaves the settled-without-file records out: a folder whose report.json holds the total already counts every call of the run in it (the report is written after the stages, so a call that was settled and then lost its file is a run that never got a report). `costOfRun` adds it to its figure, the floor and `run_status` read the result through it.
 */
export function countedExtrasOf(runDir, { capName, settledOnly = true } = {}) {
  let unsettledUsd = 0, settledOnlyUsd = 0;
  for (const r of reservationRecordsOf(runDir)) {
    if (capName !== undefined && r.capName !== capName) continue;
    if (r.source === 'settled' && !settledOnly) continue;
    if (r.source === 'unsettled') unsettledUsd += r.usd; else settledOnlyUsd += r.usd;
  }
  return { usd: unsettledUsd + settledOnlyUsd, unsettledUsd, settledOnlyUsd };
}

/**
 * The reservation ids a folder settles without ever reserving (0.8.4 unit 6, D11; C&C via Mini-C&C R424): [id, ...]. A call is reserved, with an fsync, before it is sent, and is not sent when that write fails, so a settled line with no reserved line is
 * damage to the file. It is counted in NO figure; `council --spend` names it (src/cli.js) so it is not silent.
 */
export function orphanSettledIdsOf(runDir) {
  const lines = reservationLinesOf(runDir);
  const reserved = new Set(lines.filter(l => l.event === 'reserved').map(l => l.id));
  return [...new Set(lines.filter(l => l.event === 'settled' && !reserved.has(l.id)).map(l => l.id))];
}

/** The settled calls with no usage file, for a resume's seed (src/cli.js): [{ label, usd, capName? }]. */
export function settledWithoutFileOf(runDir) {
  return reservationRecordsOf(runDir).filter(r => r.source === 'settled').map(({ label, usd, capName }) => ({ label, usd, ...(capName ? { capName } : {}) }));
}

/**
 * The count-once summary of one run folder: { usd, estimatedUsd, bases?, unlabelledUsd?, unknownFigures? } - `usd` is every record counted once, `estimatedUsd` the part whose basis is an estimate (typical_error, expected_retry,
 * reserved_unsettled, worst_case), `bases` the non-zero amount per basis, `unlabelledUsd` what records from before 0.8.4 (no basis) hold. null when the folder holds no paid record.
 */
export function countedSummaryOf(runDir) { return summariseCounted(countedRecordsOf(runDir)); }

/** The summary of records already read (countedRecordsOf): the one fold, so a caller that also lists the records (the board's money section, src/board-money.js) gets a total that is the sum of its own lines. */
export function summariseCounted(records) {
  let usd = 0, estimatedUsd = 0, unlabelledUsd = 0, unknown = 0, any = false;
  const bases = {};
  for (const r of records) {
    if (r.unknown) unknown += 1;
    if (!(r.usd > 0)) continue;
    any = true; usd += r.usd;
    if (r.basis === null) unlabelledUsd += r.usd;
    else { bases[r.basis] = (bases[r.basis] ?? 0) + r.usd; if (ESTIMATED_BASES.includes(r.basis)) estimatedUsd += r.usd; }
  }
  if (!any) return null;
  return { usd, estimatedUsd, bases, ...(unlabelledUsd > 0 ? { unlabelledUsd } : {}), ...(unknown > 0 ? { unknownFigures: unknown } : {}) };
}

/** Puts the summary into a report's totals as `totals.counted` when the folder holds a paid record; a no-op otherwise. The main run and a side run call it next to foldProviderReportedInto. `totals.usd` keeps its documented meaning. */
export function foldCountedInto(result, dir) {
  const c = countedSummaryOf(dir);
  if (c) result.totals = { ...result.totals, counted: c };
  return result;
}

/** `" (of which $x estimated)"` for a counted figure, or '' when no part of it is an estimate. `format` turns dollars into text (src/cost.js formatUsd). */
export const estimatedPartWords = (estimatedUsd, format) => (Number.isFinite(estimatedUsd) && estimatedUsd > 0 ? ` (of which ${format(estimatedUsd)} estimated)` : '');
