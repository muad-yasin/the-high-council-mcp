// Criterion ids and the record of sign-offs that skipped criteria (0.8.0, roadmap "Debate, criteria,
// milestones" item 4). A reviewer's reply carries a table with one row per acceptance criterion, the
// criterion quoted verbatim (src/roles.js). A sign-off whose table leaves criteria out is not a
// sign-off on those criteria; the wave-3 archives found 4 of 812 sign-offs short in that way. This
// module only RECORDS it: nothing here changes a verdict, a prompt or a stop. Since 0.8.2 (owner decision 1,
// 5 Oct 2026) a chain may ask for more: `signoff_table: { required: true }` makes a sign-off without a full
// table an abstention (src/chain.js), and signoffTableGap below says what was missing. Pure and $0; the
// harness reads the table the reply already has.

import { isReadableVerdict, isMetVerdict } from './criteria-kinds.js';

/** Positional ids for a criteria list: C1, C2, ... (the list order is the run's, and fixed for it). */
export const criterionIds = criteria => (Array.isArray(criteria) ? criteria : []).map((_, i) => `C${i + 1}`);

const norm = s => String(s ?? '').toLowerCase().replace(/[`*_"'‘’“”]/g, '').replace(/\s+/g, ' ').replace(/[.;:,]+$/, '').trim();

// A row names its criterion when it equals it after normalisation, or (a reviewer that trims or
// extends a long criterion) one contains the other and the shorter side is at least 12 characters,
// or it is the id itself ("C3"), or (a reviewer that drops a word in the middle: a debate run lost a whole sign-off
// table to "shows a declared model as declared rather than verified" for "... rather than as verified") the shorter
// text of at least 8 words is the longer one with at most 2 words removed, in order. Only `names` reads this; the
// exact match and the one-criterion-per-row rule in rowsPerCriterion are untouched, so a row that fits two criteria names none.
const wordsDropped = (a, b) => {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 8 || l.length - s.length > 2) return false;
  let i = 0;
  for (const w of l) if (i < s.length && w === s[i]) i++;
  return i === s.length;
};
// PR #2 fix unit (item 8; Sol): the words that DECIDE what a criterion requires. A row that is the criterion with ONE of these changed, "must write" for "must not write", "at least three" for "at most three", "thirty" for "three", is another requirement: the dropped-words
// match (`names`) and the position reading (`byPosition`, guard G6) must not put its verdict on the criterion. Negations count as one class (cannot = not), a bound or comparison word counts as itself, a number by its value (3 = three; only a SUBSTITUTED number counts). Only a row that is NEAR the criterion is
// compared (at most MAX_REQUIREMENT_EDITS words differ, counted as a multiset, so a dropped "the" or "as" is no edit that matters): a heavily reworded row has no word-for-word pair to compare, real judges condense long criteria this way (B3 run 5: 372 of 3102 table rows), and
// the position reading stays the evidence for it, as before. The contained-text rule (a judge trimming or extending a criterion) is unchanged.
const NEGATION_WORDS = new Set(['not', 'no', 'never', 'cannot', 'cant', 'dont', 'doesnt', 'didnt', 'wont', 'isnt', 'arent', 'wasnt', 'werent', 'shouldnt', 'mustnt', 'without', 'nor', 'none', 'neither', 'nothing', 'nobody']);
const BOUND_WORDS = new Set(['least', 'most', 'more', 'less', 'fewer', 'fewest', 'than', 'exceed', 'exceeds', 'exceeding', 'over', 'under', 'above', 'below', 'minimum', 'maximum', 'min', 'max', 'only']);
const NUMBER_WORDS = new Map([...'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ').map((w, i) => [w, i]), ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90], ['hundred', 100], ['thousand', 1000]]);
export const MAX_REQUIREMENT_EDITS = 4;
// A text's words, each a canonical token: 'neg' for any negation, 'n:<value>' for a number, else the word; a row's leading list number ("3.", "C3:") is its position, not a number of the requirement.
const requirementTokens = text => (norm(text).replace(/^\s*(?:c|criterion\s*)?\d{1,2}\s*[.):\-]\s*/i, '').match(/[a-z0-9]+/g) || []).map(t => (NEGATION_WORDS.has(t) ? 'neg' : NUMBER_WORDS.has(t) ? `n:${NUMBER_WORDS.get(t)}` : /^\d+/.test(t) ? `n:${Number(/^\d+/.exec(t)[0])}` : t));
const isNumber = t => t.startsWith('n:');
export const sameRequirementWords = (a, b) => {
  const x = requirementTokens(a); const y = requirementTokens(b);
  const left = new Map(); for (const t of y) left.set(t, (left.get(t) || 0) + 1);
  const added = [];   // words of `a` the criterion does not have
  for (const t of x) { if (left.get(t) > 0) left.set(t, left.get(t) - 1); else added.push(t); }
  const removed = [...left].flatMap(([t, n]) => Array(n).fill(t));   // words of the criterion `a` does not have
  if (added.length + removed.length > MAX_REQUIREMENT_EDITS) return true;
  if ([...added, ...removed].some(t => t === 'neg' || BOUND_WORDS.has(t))) return false;   // a negation or a bound gained, lost or swapped
  return !(added.some(isNumber) && removed.some(isNumber));   // a number SUBSTITUTED (a number only dropped or only added is left to the other rules: in a long criterion it is mostly a retyping drift)
};
const names = (row, text, id) => {
  const r = norm(row);
  if (!r) return false;
  if (r === id.toLowerCase()) return true;
  const c = norm(text);
  if (r === c) return true;
  const [short, long] = r.length <= c.length ? [r, c] : [c, r];
  return (short.length >= 12 && long.includes(short)) || (wordsDropped(r.split(' '), c.split(' ')) && sameRequirementWords(r, c));   // a row that is a verbatim part of its criterion (a judge trimming a long one: real tables do it in 13% of rows) is not guarded; a row that DROPPED words in the middle must not have dropped a deciding one
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
  if (out.some(x => !x.length)) return byPosition(rows, list, ids, out) ?? out;
  return out;
}

// 3 Nov 2026 (owner's pick "Auto + handler tool": "complete tables matched by row position instead of by retyped text (no repair needed)"; C&C's guards): a judge that retypes a criterion's words (B3 run 5: about 46 votes lost,
// 56 of 59 retyped tables in the catalog map row k to criterion k) still judged criterion k when its table is complete and in order. When the text match above leaves a criterion without a row, the table is read by
// row position, but only when every guard holds; otherwise the text assignment stands (an incomplete table is re-asked as before; a complete one that fails a guard is for the repair pause). Position never puts a
// verdict on a criterion whose row it does not fit:
//   G1 complete: exactly one row per criterion the judge was asked for.
//   G2 its own words: each row's best word overlap (the same measure the catalog used: lower-cased [a-z0-9]+ words, a leading list number left out, Jaccard) is with its own position's criterion, and strictly (a tie fails).
//   G3 numbers agree: a leading list number on a row ("7.", "7)", "C7:", "criterion 7 -") is its own position.
//   G4 no text match elsewhere: a row the text match above placed (an exact or a single loose match) was placed at its own position.
//   G6 same requirement words (item 8): a negation, a bound (least, most, more than ...) or a number that differs between the row and its position's criterion puts the row on no criterion (sameRequirementWords above).
//   G5 not too short to claim a criterion: a row of fewer than 12 characters (after the normalisation the match uses) is never placed by position, the same floor the text match puts on a contained text ("plan" does
//      not stand for "The plan names a data store"). In the catalog's retyped tables every row has 12 words or more, so the floor refuses none of them.
//   G2 and G5 judge only the rows the text match could not place; a row it placed at its own position (its words, or its id "C3") stands as placed.
const LEADING_LIST_NUMBER = /^\s*(?:c|criterion\s*)?(\d{1,2})\s*[.):\-]/i;
const wordSet = s => new Set(String(s ?? '').toLowerCase().replace(/^\s*(?:c|criterion\s*)?\d{1,2}\s*[.):\-]\s*/i, '').match(/[a-z0-9]+/g) || []);
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / ((a.size + b.size - n) || 1); };
function byPosition(rows, list, ids, textOut) {
  if (rows.length !== list.length) return null;   // G1
  const placedAt = new Map(textOut.flatMap((rs, i) => rs.map(r => [r, i])));
  const words = list.map(wordSet);
  for (const [k, r] of rows.entries()) {
    if (placedAt.has(r) && placedAt.get(r) !== k) return null;   // G4
    const n = LEADING_LIST_NUMBER.exec(String(r.criterion ?? ''));
    if (n && Number(n[1]) - 1 !== k) return null;   // G3
    if (placedAt.has(r)) continue;   // placed by the text match at its own position (its words, or its id "C3"): G5 and G2 judge only the rows the text match could not place
    if (norm(r.criterion).length < 12) return null;   // G5
    const sims = words.map(w => jaccard(wordSet(r.criterion), w));
    const best = Math.max(...sims);
    if (!(best > 0) || sims[k] !== best || sims.filter(s => s === best).length !== 1) return null;   // G2
    if (!sameRequirementWords(r.criterion, list[k])) return null;   // G6: its own words decide the requirement: not, least/most, a number. Word overlap cannot see them (item 8)
  }
  return ids.map((_, k) => [rows[k]]);
}

/** Which criterion (its index into `criteria`) each row of the reply's table is assigned to, by the same assignment the sign-off gate reads (text first, then row position under its guards). Rows assigned to none are absent. */
export function rowCriterionIndex(critique, criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  const rows = rowsOf(critique);
  if (!list.length || !rows.length) return new Map();
  return new Map(rowsPerCriterion(rows, list, criterionIds(list)).flatMap((rs, i) => rs.map(r => [r, i])));
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

// ROADMAP 84 (E84, gate page Review/Build_0.8.3/m6-closing/E84_Gate_Page.md section 3.2): what another judge's table says about the criterion an objection is about. Two small readers over the matching the sign-off gate already uses.
/** The index into `criteria` of the criterion a free-text criterion string names, or -1 when it names none or several (identical texts included): fail closed, so no peer evidence is shown for it. */
export function criterionIndexOf(text, criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  const ids = criterionIds(list);
  const exact = ids.map((id, i) => (exactly(text, list[i], id) ? i : -1)).filter(i => i >= 0);
  if (exact.length) return exact.length === 1 ? exact[0] : -1;
  const loose = ids.map((id, i) => (names(text, list[i], id) ? i : -1)).filter(i => i >= 0);
  return loose.length === 1 ? loose[0] : -1;
}

/** The MET rows of `critique`'s table that the gate assigns to criterion number `index` (src/criteria-ledger.js rowsPerCriterion, the assignment signoffTableGap reads): `evidence` text only, in table order. */
export function metEvidenceFor(critique, criteria, index) {
  const list = Array.isArray(criteria) ? criteria : [];
  if (!(index >= 0 && index < list.length)) return [];
  return (rowsPerCriterion(rowsOf(critique), list, criterionIds(list))[index] || []).filter(r => isMetVerdict(r.verdict)).map(r => String(r.evidence ?? '').trim()).filter(Boolean);
}

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
  // 3 Nov 2026: a row the gate assigned (by text, or by position under its guards) names its criterion; only the others can be outside rows.
  const assigned = rowCriterionIndex(critique, list);
  if (assigned.size) return rowsOf(critique).filter(r => !assigned.has(r) && !list.some((c, i) => names(r.criterion, c, criterionIds(list)[i]))).map(r => String(r.criterion ?? '(unnamed row)').slice(0, 300));
  if (!list.length) return [];
  const ids = criterionIds(list);
  return rowsOf(critique).filter(r => !list.some((c, i) => names(r.criterion, c, ids[i]))).map(r => String(r.criterion ?? '(unnamed row)').slice(0, 300));
}
