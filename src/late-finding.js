// 0.8.4 S4b (M1; D24, Q1(g), Q12, RU-S4-01..12, 64..71, W26): the LATE FINDING record. PURE: plain data in, plain data out.
// A late finding is a defect that claims a failure and was NOT debated: one first found in the last (seventh) round of the ending exchange, where no round follows (src/layer-debate.js readPosts, lastRound). It is not an objection:
// it mints no objection id, holds no sign-off, counts in no tally (N20, N23, D24), and is never dropped, declined or debated. It goes to the handler, recorded in report.json `late_findings[]`, marked "not debated, found in the last round",
// with its rating (which only decides the order the handler reads it in: missing or refused, it reads as 4 or above) and its flags: `ungrounded` (no criterion, no quote, or a quote the plan does not hold: kept, never dropped, Q-i4)
// and `named_as_objection` (the judge put it in new_objections in the last round, where nothing may be minted: kept as a late finding, Q-i5). Layer 3's sorting of it is S8 (M3): `sorted` is null until then.
import { lateFindingKey } from './objection-ids.js';
import { shownKey } from './seat-key.js';
import { layerWord, layerWordCap } from './top-layer.js';
import { derivedMustDo, routeSummaryOf } from './sorting.js';   // 0.8.4 S8 (T17m(2)): a combined row whose must-do is derived by silence puts no `sorted` on a late finding

export const LATE_FOUND = 'ending_exchange_last_round';

/**
 * Gives each finding its id: `L-` + 8 hex digits (src/objection-ids.js lateFindingKey) with `#2`, `#3` for the same seat and key with a DIFFERENT text (a hash collision), in order. The same seat naming the same key with the SAME text twice
 * is one finding (the second is dropped here, as a repeated post is). `list`: [{ lab, criterion, problem, ... }] in the order the posts were read. -> the same entries with `id`, duplicates removed.
 */
export function assignLateFindingIds(list) {
  const seen = new Map();   // `${lab}\u0000${base}` -> [{ problemNorm, id }]
  const out = [];
  for (const f of list || []) {
    if (typeof f.linked_to === 'string' && typeof f.id === 'string') { if (!out.some(o => o.id === f.id)) { seen.set(`${f.id}\u0000linked`, [{ id: f.id }]); out.push(f); } continue; }   // 0.8.4 S18: a finding made from an unanchored failure has its id already (keyed on the failure); the first one stands
    const { base, problemNorm } = lateFindingKey(f.lab, f);
    const k = `${f.lab}\u0000${base}`;
    const had = seen.get(k) || [];
    if (had.some(x => x.problemNorm === problemNorm)) continue;
    const id = had.length ? `${base}#${had.length + 1}` : base;
    had.push({ problemNorm, id }); seen.set(k, had);
    out.push({ ...f, id });
  }
  return out;
}

/**
 * The report row of one late finding. `f`: { lab, criterion?, problem, quote?, rating (a number, or null), rating_refused?, flags[], round }. A row keeps the finder's own words (model-supplied, as they came). Rating null is read as
 * 4 or above for the handler's order (D24): `rating_read_as` says so, so no reader has to know the rule.
 */
export function lateFindingRow(f) {
  return {
    id: f.id, lab: f.lab,
    ...(typeof f.linked_to === 'string' ? { linked_to: f.linked_to } : {}),   // 0.8.4 S18 (WORDING S18-w18b): made from this unanchored failure
    ...(f.criterion ? { criterion: f.criterion } : {}), problem: f.problem, ...(f.quote ? { quote: f.quote } : {}),
    rating: typeof f.rating === 'number' ? f.rating : null,
    ...(typeof f.rating === 'number' ? {} : { rating_read_as: '4 or above', ...(f.rating_refused ? { rating_refused: f.rating_refused } : {}) }),
    flags: [...(f.flags || [])],
    found: f.found ?? LATE_FOUND, round: f.round, not_debated: true, sorted: f.sorted ?? null,   // 0.8.4 S8: `found` is 'final_read' for a defect layer 3 found at its final read; `sorted` is layer 3's sorting of it (null until it is sorted)
  };
}

/** 0.8.4 S8: the rows with layer 3's sorting put on them. `combined`: final_read.sorting ([{ id, sort, seats[], reasons[], ungrounded? }]); a row it names gets `sorted` = { sort, seats, reasons }, any other keeps what it had (null). Pure. */
export function withSorted(rows, combined) {
  const by = new Map((Array.isArray(combined) ? combined : []).map(c => [c.id, c]));
  return (Array.isArray(rows) ? rows : []).map(r => { const c = by.get(r.id); return c && r.sorted == null && !derivedMustDo(c) ? { ...r, sorted: { sort: c.sort, seats: [...(c.seats || [])], reasons: (c.reasons || []).map(x => ({ ...x })), ...(c.ungrounded ? { ungrounded: true } : {}), ...routeSummaryOf(c.reasons) } } : r; });
}

/**
 * 0.8.4 S8 (money step; C&C 08 Nov): the final read's sorting of a finding a top-layer seat named at its LAST VERDICT. A seat's later word replaces only its own earlier word: the finder's must-do stands as its sorting unless the finder itself is asked again at the final read and
 * says otherwise; the other seats' words are added; the row follows the existing rule (any must-do wins: combineSortings, D12). `perSeat`: [{ seat, rows[] }] (the final read's entries). Only rows with found 'last_verdict' are touched; pure.
 */
export function withSortedPerSeat(rows, perSeat, allSeats = null) {
  const every = Array.isArray(allSeats) && allSeats.length ? allSeats : null;   // 0.8.4 S8 (T17m(2), C&C Q2 option B): with every top seat's key, a finding that no seat sorted must-do and that not every seat sorted may-leave stays UNSORTED (sorted null: "not yet sorted", no build obligation, RU-S8-04), as withSorted leaves it
  return (Array.isArray(rows) ? rows : []).map(r => {
    if (r.found !== 'last_verdict') return r;
    const words = new Map((r.sorted?.reasons || []).map(x => [x.seat, { ...x, ungrounded: r.sorted?.ungrounded === true }]));   // the finder's word carries the row's own ungrounded flag; a final-read word carries its row's
    for (const { seat, rows: sr } of perSeat || []) { const w = (sr || []).find(y => y.id === r.id); if (w) words.set(seat, { seat, sort: w.sort, reason: w.reason, ungrounded: w.ungrounded === true, ...(w.route ? { route: w.route } : {}), ...(w.route_asked ? { route_asked: w.route_asked } : {}) }); }
    const all = [...words.values()];
    if (!all.length) return r;
    const mustDo = all.filter(x => x.sort === 'must_do');
    if (!mustDo.length && every && !every.every(k => words.has(k))) return { ...r, sorted: null };
    const reasons = all.map(({ ungrounded, ...rest }) => rest);
    return { ...r, sorted: { sort: mustDo.length ? 'must_do' : 'may_leave', seats: reasons.map(x => x.seat), reasons, ...(mustDo.length && mustDo.every(x => x.ungrounded) ? { ungrounded: true } : {}), ...routeSummaryOf(reasons) } };   // ungrounded only when the sort is must-do and no must-do word is grounded (combineSortings' rule)
  });
}

const one = v => String(v ?? '').replace(/\s+/g, ' ').trim();
/** The handler reads the highest rating first; a finding with no valid rating reads as 4 or above (D24), so it sits with the 4s. */
export const readOrder = rows => [...rows].sort((a, b) => (typeof b.rating === 'number' ? b.rating : 4) - (typeof a.rating === 'number' ? a.rating : 4));
/** True when layer 3's sorting reached any row (it sorted one, or found one at its final read): only then do the lines and the intro say more than they always did, so every other run reads byte for byte as before. */
const touched = rows => rows.some(r => r.sorted != null || (r.found ?? LATE_FOUND) !== LATE_FOUND);
const byLayer3 = r => (r.found ?? LATE_FOUND) === 'final_read' || (r.found ?? LATE_FOUND) === 'last_verdict';   // found by a layer-3 seat (its final read, or its sorting at its last verdict)
const sortWord = (r, N) => (r.sorted ? `sorted by ${layerWord(N)}: ${r.sorted.sort === 'must_do' ? 'must-do' : 'may-leave'}` : `not yet sorted by ${layerWord(N)}`);
const lineOf = (r, mixed = false, N) => `- ${r.id} (${shownKey(r.lab)}; ${typeof r.rating === 'number' ? `rating ${r.rating}` : 'not rated, read as 4 or above'}${r.flags?.length ? `; ${r.flags.join(', ')}` : ''}${mixed ? `; ${sortWord(r, N)}` : ''}): ${one(r.problem)}${r.criterion ? ` Criterion: ${one(r.criterion)}.` : ''}${r.quote ? ` Quoted passage: "${one(r.quote)}".` : ''}${mixed && r.sorted?.reasons?.length ? ` ${layerWordCap(N)}'s reason: ${r.sorted.reasons.map(x => one(x.reason)).filter(Boolean).join(' / ')}.` : ''}`;
/** A-DRAFT: the BOARD section of the late findings of a run ('' when there are none). */
export function renderLateFindingsBoard(rows, N) {   // N: the run's top layer; none = "the top layer" (src/top-layer.js)
  if (!Array.isArray(rows) || !rows.length) return '';
  if (touched(rows)) return `## Late findings (found in the last round of the ending exchange, or by ${layerWord(N)} at its final read or its last verdict; not debated)\n\nThese defects were first found where no round was left to debate them. They are not objections: they hold back no sign-off. ${layerWordCap(N)} has sorted those marked sorted below; the others are not yet sorted by ${layerWord(N)}. They are listed from the highest rating down; one with no valid rating reads as 4 or above.\n\n${readOrder(rows).map(r => lineOf(r, true, N)).join('\n')}\n\n`;
  return `## Late findings (found in the last round of the ending exchange; not debated)\n\nThese defects were first found in the last round, where no round was left to debate them. They are not objections: they hold back no sign-off, and ${layerWord(N)} has not sorted them. They are listed from the highest rating down; one with no valid rating reads as 4 or above.\n\n${readOrder(rows).map(r => lineOf(r)).join('\n')}\n\n`;
}
/** A-DRAFT: the section appended to a handoff (HANDOFF.md) so the builder reads the late findings too. */
export function withLateFindings(handoff, rows, N) {   // N: the run's top layer; none = "the top layer"
  if (!Array.isArray(rows) || !rows.length) return handoff;
  const fromRead = rows.some(byLayer3);
  const fromExchange = rows.some(r => !byLayer3(r));
  if (touched(rows) && !fromRead) return `${String(handoff).replace(/\s+$/, '')}\n\n## Late findings (not debated)\n\nThe ending exchange found these defects in its last round, where no round was left to debate them. Each is a claimed failure that nobody has argued for or against; read it against the plan before you build. They are listed from the highest rating down (one with no valid rating reads as 4 or above). A finding ${layerWord(N)} sorted must-do is required of the build; its line gives ${layerWord(N)}'s reason. A finding sorted may-leave is recorded and not required. A finding not yet sorted by ${layerWord(N)} is not required.\n\n${readOrder(rows).map(r => lineOf(r, true, N)).join('\n')}\n`;
  if (touched(rows)) return `${String(handoff).replace(/\s+$/, '')}\n\n## Late findings (not debated)\n\n${fromExchange ? `The ending exchange and ${layerWord(N)}` : `${layerWordCap(N)}`} found these defects where no round was left to debate them. Each is a claimed failure that nobody has argued for or against; read it against the plan before you build. They are listed from the highest rating down (one with no valid rating reads as 4 or above). A finding ${layerWord(N)} sorted must-do is required of the build; its line gives ${layerWord(N)}'s reason. A finding sorted may-leave is recorded and not required. A finding not yet sorted by ${layerWord(N)} is not required.\n\n${readOrder(rows).map(r => lineOf(r, true, N)).join('\n')}\n`;
  return `${String(handoff).replace(/\s+$/, '')}\n\n## Late findings (not debated)\n\nThe ending exchange found these defects in its last round, where no round was left to debate them. Each is a claimed failure that nobody has argued for or against; read it against the plan before you build. They are listed from the highest rating down (one with no valid rating reads as 4 or above).\n\n${readOrder(rows).map(r => lineOf(r)).join('\n')}\n`;
}

/** A-DRAFT (WORDING S16-w21; D25): the HANDOFF.md section of the CONCERNS layer 3 attached to its final read: notes that claim no criterion fails. `rows`: [{ lab, text }]; `wrap` escapes model text; N: the run's top layer. */
export function withConcerns(handoff, rows, wrap = s => s, N) {
  if (!Array.isArray(rows) || !rows.length) return handoff;
  const lines = rows.map(r => `- ${r.lab}: ${wrap(one(r.text))}`);
  return `${String(handoff).replace(/\s+$/, '')}\n\n## Concerns\n\n${layerWordCap(N)} attached these notes to its final read. A concern does not claim that a criterion fails and does not predict a failure: it is not an objection, it holds nothing back, it is not debated and it is not declined. Read each against the plan before you build.\n\n${lines.join('\n')}\n`;
}

/** A-DRAFT (WORDING row 1661; S8 c3): the HANDOFF.md section of the objections layer 3's closing read closed ('' rows: the handoff is returned as it is). `rows`: closedRowsOf's rows; `wrap` escapes model text. */
export function withClosedBelowFour(handoff, rows, wrap = s => s, N) {   // N: the run's top layer; none = "the top layer"
  if (!Array.isArray(rows) || !rows.length) return handoff;
  const stop = t => { const x = one(t); return /[.!?]$/.test(x) ? x : `${x}.`; };
  const lines = rows.map(r => `- ${r.id} (raised by ${shownKey(r.lab)}): ${wrap(stop(r.problem ?? r.criterion ?? ''))} ${layerWordCap(N)}'s reason: ${r.reasons.map(x => `${shownKey(x.seat)}: ${wrap(one(x.reason))}`).join(' / ')}`);
  return `${String(handoff).replace(/\s+$/, '')}\n\n## Closed below 4\n\n${layerWordCap(N)} read the final plan and sorted each of these may-leave. Each is rated below 4 and was never rated 7 or above, so each is closed: it is recorded here and is not required of the build.\n\n${lines.join('\n')}\n`;
}

/**
 * 0.8.4 S18 (WORDING S18-w14c, A-DRAFT, committed like its neighbours: HANDOFF.md is run output; C&C's ruling): the section of the build list that lists the OPEN objections of the final read, one line each. `rows`: openFinalReadRows (src/final-read.js), read from the record's own `failures[].open` mark, model text already
 * collapsed to one line, the seat named by its key. The intro is neutral: when the handler sorts a split objection (the Q4 wait), its sort replaces "sorted must-do by its seat". '' when there is no row.
 */
export function withFinalReadObjections(handoff, rows, N) {
  if (!Array.isArray(rows) || !rows.length) return handoff;
  return `${String(handoff).replace(/\s+$/, '')}\n\n## Objections of the final read (open)\n\n${layerWordCap(N)} read the final plan and objected. Each objection below is open on the record. It counts as must-do for the build unless the handling session sorted it; then its line shows that sort.\n\n${rows.map(r => `- ${r.id ?? '(no id)'} (raised by ${r.seat}; ${typeof r.rating === 'number' ? `rated ${r.rating.toFixed(1)}` : 'not rated, read as 4 or above'}; ${r.handlerSort ? `sorted ${r.handlerSort === 'may_leave' ? 'may-leave' : 'must-do'} by the handling session; ${(r.signedBy || []).join(', ')} signed off on the final plan` : 'sorted must-do by its seat'}): ${r.criterion}: ${r.problem}${r.handlerSort ? ` The handling session's reasons: ${r.handlerReason}` : ''}`).join('\n')}\n`;
}

/**
 * 0.8.4 S18 (Q3 (a), T21ab): the late findings with the rating IN FORCE for display: a handler's re-tag (report.json severity.retags, the latest row naming the finding's id) moves the rating the check, the BOARD and the HANDOFF show, while the late finding's own row keeps the rating AS FOUND (the record is never overwritten; the change, with old, new, who and reason, is the re-tag row). Pure.
 */
export function withRatingsInForce(rows, retags) {
  const by = new Map();
  for (const r of Array.isArray(retags) ? retags : []) if (typeof r?.id === 'string' && r.id.startsWith('L-') && typeof (r.applied_to ?? r.to) === 'number') by.set(r.id, r.applied_to ?? r.to);
  return (Array.isArray(rows) ? rows : []).map(l => (by.has(l.id) ? { ...l, rating: by.get(l.id), rating_read_as: undefined } : l));
}

/**
 * 0.8.4 S18 (WORDING S18-w24, A-DRAFT, committed): the section of the build list (HANDOFF.md) of the open objections the top layer sorted may-leave that the sorting did NOT close, with the sorting's reasons and, where an objection was re-tagged, the re-tag. `rows`: closingPartsOf(...).openMayLeave plus `retag`: { from, to, by, pass } | null; `wrap` escapes model text; N: the run's top layer. Pure.
 */
export function withOpenMayLeave(handoff, rows, wrap = s => s, N) {
  if (!Array.isArray(rows) || !rows.length) return handoff;
  const stop = t => { const x = one(t); return /[.!?]$/.test(x) ? x : `${x}.`; };
  const lines = rows.map(r => `- ${r.id} (raised by ${shownKey(r.lab)}; ${typeof r.rating === 'number' ? `rated ${r.rating.toFixed(1)}` : 'not rated, read as 4 or above'}${r.retag ? `; re-tagged from ${typeof r.retag.from === 'number' ? r.retag.from.toFixed(1) : 'its first rating'} to ${r.retag.to.toFixed(1)} by ${r.retag.by === 'handler' ? 'the handler' : layerWord(N)} in pass ${r.retag.pass}` : ''}): ${wrap(stop(r.problem ?? r.criterion ?? ''))} ${layerWordCap(N)}'s reason: ${r.reasons.map(x => `${shownKey(x.seat)}: ${wrap(one(x.reason))}`).join(' / ')}`);
  return `${String(handoff).replace(/\s+$/, '')}\n\n## Open objections the top layer sorted may-leave\n\n${layerWordCap(N)} read the final plan and sorted each of these may-leave. Each is rated 4 or above, or was once rated 7 or above, so the sorting does not close it: each is still open on the record.\n\n${lines.join('\n')}\n`;
}
