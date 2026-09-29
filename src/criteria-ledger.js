// Criterion ids and the record of sign-offs that skipped criteria (0.8.0, roadmap "Debate, criteria,
// milestones" item 4). A reviewer's reply carries a table with one row per acceptance criterion, the
// criterion quoted verbatim (src/roles.js). A sign-off whose table leaves criteria out is not a
// sign-off on those criteria; the wave-3 archives found 4 of 812 sign-offs short in that way. This
// module only RECORDS it: nothing here changes a verdict, a prompt or a stop (abstaining on missing
// rows is a later, opt-in flag). Pure and $0; the harness reads the table the reply already has.

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
  const missing = ids.filter((id, i) => !rows.some(r => names(r.criterion, list[i], id)));
  return missing.length ? { criterion_ids: missing, table_rows: rows.length, criteria_total: list.length } : null;
}
