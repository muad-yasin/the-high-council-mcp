// Criterion ids and the record of sign-offs that skipped criteria (0.8.0, roadmap "Debate, criteria,
// milestones" item 4). A reviewer's reply carries a table with one row per acceptance criterion, the
// criterion quoted verbatim (src/roles.js). A sign-off whose table leaves criteria out is not a
// sign-off on those criteria; the wave-3 archives found 4 of 812 sign-offs short in that way. This
// module only RECORDS it: nothing here changes a verdict, a prompt or a stop. Since 0.8.2 (owner decision 1,
// 5 Oct 2026) a chain may ask for more: `signoff_table: { required: true }` makes a sign-off without a full
// table an abstention (src/chain.js), and signoffTableGap below says what was missing. Pure and $0; the
// harness reads the table the reply already has.

import { isReadableVerdict } from './criteria-kinds.js';

/** Positional ids for a criteria list: C1, C2, ... (the list order is the run's, and fixed for it). */
export const criterionIds = criteria => (Array.isArray(criteria) ? criteria : []).map((_, i) => `C${i + 1}`);

const norm = s => String(s ?? '').toLowerCase().replace(/[`*_"'‘’“”]/g, '').replace(/\s+/g, ' ').replace(/[.;:,]+$/, '').trim();

// A row names its criterion when it equals it after normalisation, or (a reviewer that trims or
// extends a long criterion) one contains the other and the shorter side is at least 12 characters,
// or it is the id itself ("C3").
const names = (row, text, id) => {
  const r = norm(row);
  if (!r) return false;
  if (r === id.toLowerCase()) return true;
  const c = norm(text);
  if (r === c) return true;
  const [short, long] = r.length <= c.length ? [r, c] : [c, r];
  return short.length >= 12 && long.includes(short);
};

// Audit fix cnc-prompts F4 / 73-verdicts 2: for GATING, a row belongs to at most ONE criterion. An exact match (the criterion's own text, or its id) wins; a row that only contains or is contained in criteria
// (a reviewer trimming or extending a long criterion) belongs to one only when exactly one criterion fits it, so a longer criterion's row can no longer stand in for a shorter one's (and hide an omitted row or a
// blank evidence). A row that fits several criteria loosely names none (fail closed: the table is incomplete and is re-asked). Returns, per criterion, the rows assigned to it.
const exactly = (row, text, id) => { const r = norm(row); return !!r && (r === id.toLowerCase() || r === norm(text)); };
function rowsPerCriterion(rows, list, ids) {
  const out = ids.map(() => []);
  for (const r of rows) {
    const exact = ids.map((id, i) => (exactly(r.criterion, list[i], id) ? i : -1)).filter(i => i >= 0);
    if (exact.length) { out[exact.find(i => !out[i].length) ?? exact[0]].push(r); continue; } // two criteria with identical text take one row each
    const loose = ids.map((id, i) => (names(r.criterion, list[i], id) ? i : -1)).filter(i => i >= 0);
    if (loose.length === 1) out[loose[0]].push(r);
  }
  return out;
}

/**
 * Which criteria a reply's table left out. Returns null when there is nothing to record: the reply
 * has no table at all (a different failure, visible on its own), or every criterion has a row.
 * Otherwise { criterion_ids, table_rows, criteria_total }.
 */
export function missingCriteriaRows(critique, criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  const rows = Array.isArray(critique?.criteria) ? critique.criteria.filter(r => r && typeof r === 'object' && !Array.isArray(r)) : [];
  if (!list.length || !rows.length) return null;
  const ids = criterionIds(list);
  const per = rowsPerCriterion(rows, list, ids);
  const missing = ids.filter((id, i) => !per[i].length);
  return missing.length ? { criterion_ids: missing, table_rows: rows.length, criteria_total: list.length } : null;
}

const rowsOf = critique => (Array.isArray(critique?.criteria) ? critique.criteria.filter(r => r && typeof r === 'object' && !Array.isArray(r)) : []);

/**
 * What a sign-off's table lacks for it to count under `signoff_table.required` (owner decision 1, 5 Oct 2026: "a judge's sign-off without a full per-criterion
 * table with evidence does not count"). null when the table is full: a row for every criterion, each with non-empty evidence. Otherwise
 * { kind: 'no_table' | 'missing_rows' | 'no_evidence' | 'unreadable_verdict', criterion_ids, table_rows, criteria_total } (the first kind that applies, in that order).
 * A run with no criteria has nothing to check.
 */
export function signoffTableGap(critique, criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  if (!list.length) return null;
  const ids = criterionIds(list);
  const rows = rowsOf(critique);
  const base = { table_rows: rows.length, criteria_total: list.length };
  if (!rows.length) return { kind: 'no_table', criterion_ids: ids, ...base };
  const per = rowsPerCriterion(rows, list, ids);
  const missing = ids.filter((id, i) => !per[i].length);
  if (missing.length) return { kind: 'missing_rows', criterion_ids: missing, ...base };
  const bare = ids.filter((id, i) => per[i].some(r => !String(r.evidence ?? '').trim())); // every row of the criterion needs evidence, as `unsaid` below reads every row
  if (bare.length) return { kind: 'no_evidence', criterion_ids: bare, ...base };
  // 0.8.2: a row that says neither MET nor FAILED (UNCHECKED, "MET (partially)", SATISFIED) is not a verdict: a sign-off may not rest on it (the judge's reply is incomplete, never a failure of the plan).
  const unsaid = ids.filter((id, i) => per[i].some(r => !isReadableVerdict(r.verdict))); // every row assigned to the criterion, not the first one found
  return unsaid.length ? { kind: 'unreadable_verdict', criterion_ids: unsaid, ...base } : null;
}

/** One line for the log: what the table lacked. */
export const describeTableGap = gap => (gap.kind === 'no_table' ? 'no per-criterion table'
  : gap.kind === 'missing_rows' ? `no row for ${gap.criterion_ids.join(', ')}`
    : gap.kind === 'unreadable_verdict' ? `a verdict that is neither MET nor FAILED for ${gap.criterion_ids.join(', ')}`
      : `no evidence for ${gap.criterion_ids.join(', ')}`);

/**
 * Rows a reply's table carries that name none of the criteria (ticket 16): recorded, never counted for or against anyone. [] when there are none.
 */
export function outsideCriteriaRows(critique, criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  if (!list.length) return [];
  const ids = criterionIds(list);
  return rowsOf(critique).filter(r => !list.some((c, i) => names(r.criterion, c, ids[i]))).map(r => String(r.criterion ?? '(unnamed row)').slice(0, 300));
}
