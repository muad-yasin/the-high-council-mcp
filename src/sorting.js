// 0.8.4 S8 (Q9, D12, CA4): layer 3's SORTING of the open objections and late findings at its read. A layer-3 seat that reads the plan sorts each open objection (and each late finding) as must-do or
// may-leave for the build and gives its reason (W7, held until the wording review: nothing here asks for it; this file only READS a sorting a reply carries). A must-do names the objection's id and a
// criterion or a decision of the plan; without one it is still a must-do and is flagged `ungrounded`. The sorting is routing for the build: it settles nothing by itself.
// readSorting and combineSortings are pure (no I/O, no model call); sortingOn reads the held-word state. The record shapes are additive (final_read.seats[].sorting, final_read.sorting).
import { ratingsDemanded } from './ratings-demand.js';
import { held } from './held-roles.js';
import { isUnanchored } from './anchor.js';
import { readSeverity } from './severity.js';
import { lateFindingKey } from './objection-ids.js';

export const SORT_KINDS = Object.freeze(['must_do', 'may_leave']);
const text = v => (typeof v === 'string' ? v.trim() : '');
export const REASON_CAP = 8000;   // = chain.js CRITIC_FIELD_MAX_CHARS, the cap every other critic field is read at (as src/review-notes-lane.js does)

/**
 * The gate: the sorting names objection ids, which exist only with the answer_back ledger, and it is asked for with the rating demand (the same predicate that gates the climb verdict's sorting).
 * It also needs all three S8 words recorded (layerThreeSortingRule, W7, the sentence that asks a layer-3 seat to sort; layerThreeSortingForm, where it writes the sorting; layerThreeSortingItems, the list it sorts): while any of the four words is held back this is false and nothing here is read or recorded.
 */
export const sortingOn = config => !!(config && config.answer_back && config.answer_back.enabled === true && ratingsDemanded(config) && typeof held('layerThreeSortingRule') === 'function' && typeof held('layerThreeSortingForm') === 'function' && typeof held('layerThreeSortingItems') === 'function');

/**
 * Reads the `sorting` a reply carries. A row needs an id and a sort (must_do or may_leave); anything else is ignored and counted (`ignored`), never read as a sorting. With `knownIds` (a Set: the ids of the list the seat was shown) an id outside it is ignored too. A must_do row with no criterion and no
 * decision is kept and flagged `ungrounded: true`.
 */
/**
 * 0.8.4 S9 (S9-R1; Q9, Q10, D29): the ROUTE a layer-3 seat names for a must-do ("writer" or "proposers", W7 asks for it, WORDING S9-w18 .. w20). Read only when `opts.route` is true (the S9 words are recorded) and only on a must-do row. A closing read only RECOMMENDS the
 * proposers: nothing here starts a return. On a chain with NO proposer seat (`opts.proposers` false) a "proposers" is read as "writer" and recorded as read so (`route_asked`), with no retry call (D29). A value that is neither is not read as a route: it is kept as
 * `route_unread` (capped). Without `opts` the rows are what S8 made them, key for key.
 */
const routeBitsOf = (r, sort, opts) => {
  if (!opts || opts.route !== true || sort !== 'must_do') return {};
  const v = text(r && typeof r === 'object' ? r.route : '').toLowerCase();
  if (!v) return {};
  if (v === 'writer') return { route: 'writer' };
  if (v === 'proposers') return opts.proposers === false ? { route: 'writer', route_asked: 'proposers' } : { route: 'proposers' };
  return { route_unread: v.slice(0, 40) };
};
/** 0.8.4 S16 (W32): the rating of a new defect named in a sorting row at the FINAL read, by the key the ending exchange's late finding uses (`rating`, or `severity`); null when missing or invalid. Only with opts.finalRead. */
const ratingBitsOf = (r, opts) => {
  if (!opts || (opts.finalRead !== true && opts.rating !== true)) return {};
  const raw = r && typeof r === 'object' ? (r.rating !== undefined ? r.rating : r.severity) : undefined;
  const v = readSeverity(raw);
  return v.ok ? { rating: v.value } : {};
};
export function readSorting(raw, knownIds = null, opts = null) {
  if (raw === undefined || raw === null) return { rows: [], ignored: 0, fresh: [] };   // no key: the reply carried no sorting
  if (!Array.isArray(raw)) return { rows: [], ignored: 1, fresh: [] };   // a sorting that is not a list is ignored and counted, never dropped without a trace
  const rows = []; const fresh = [];
  let ignored = 0;
  const seen = new Set();
  for (const r of raw) {
    const id = r && typeof r === 'object' ? text(r.id) : '';
    const sort = r && typeof r === 'object' ? text(r.sort) : '';
    const criterion = text(r && typeof r === 'object' ? r.criterion : ''); const decision = text(r && typeof r === 'object' ? r.decision : '');
    if (!id && knownIds instanceof Set && sort === 'must_do') {
      // An entry with no id: a new defect (W7's last sentence) only when it carries the passage it is about and a reason; kept as a finding of its own (the reader gives it an id when it is recorded). Without the passage it is ignored and counted.
      const reason = text(r.reason).slice(0, REASON_CAP); const quote = text(r.quote).slice(0, REASON_CAP);
      // 0.8.4 S16 (opts.passageless, set at the final read once its own words (W31) are recorded; Q9(e), RU-S16-05, T17y, T21af): at the final read a new defect with NO passage is a late finding too (its reason says what is absent and where), with the seat's rating; before, and at every other read, it is ignored and counted.
      if (reason && (quote || opts?.passageless === true)) fresh.push({ sort, reason, ...(quote ? { quote } : {}), ...ratingBitsOf(r, opts), ...routeBitsOf(r, sort, opts), ...(criterion ? { criterion } : {}), ...(decision ? { decision } : {}), ...(!criterion && !decision ? { ungrounded: true } : {}) }); else ignored += 1;
      continue;
    }
    if (!id || !SORT_KINDS.includes(sort) || seen.has(id)) { ignored += 1; continue; }
    if (knownIds instanceof Set && !knownIds.has(id)) {
      // An id outside the list the seat was shown. A must-do with a reason is a NEW defect the seat found (W7's last sentence): its content is kept, as a finding of its own, never as a sorting of something nobody listed. Anything else is ignored and counted.
      const reason = text(r.reason).slice(0, REASON_CAP); const quote = text(r.quote).slice(0, REASON_CAP);
      if (sort === 'must_do' && reason) { seen.add(id); fresh.push({ id, sort, reason, ...ratingBitsOf(r, opts), ...routeBitsOf(r, sort, opts), ...(quote ? { quote } : {}), ...(criterion ? { criterion } : {}), ...(decision ? { decision } : {}), ...(!criterion && !decision ? { ungrounded: true } : {}) }); } else ignored += 1;
      continue;
    }
    seen.add(id);
    rows.push({
      id, sort, reason: text(r.reason).slice(0, REASON_CAP), ...routeBitsOf(r, sort, opts),
      ...(sort === 'must_do' && opts?.unanchored instanceof Set && opts.unanchored.has(id) ? ratingBitsOf(r, opts) : {}),   // 0.8.4 S18 (T18j, W32): the rating a seat gives an UNANCHORED failure it sorts must-do is the rating of the late finding made from it (WORDING S18-w18)
      ...(criterion ? { criterion } : {}), ...(decision ? { decision } : {}),
      ...(sort === 'must_do' && !criterion && !decision ? { ungrounded: true } : {}),
    });
  }
  return { rows, ignored, fresh };
}

/**
 * One row per id across the layer-3 seats, in the order the ids first appear. The sort is must_do when any seat says must_do (the build may get more than it needs: D12); the row is `ungrounded` only
 * when no seat's must-do row is grounded. `seats` lists the seats that sorted it; `reasons` their words.
 */
export function combineSortings(perSeat, allSeats = null) {
  const byId = new Map();
  for (const { seat, rows } of perSeat || []) {
    for (const r of rows || []) {
      let c = byId.get(r.id);
      if (!c) { c = { id: r.id, sort: r.sort, seats: [], reasons: [], grounded: false }; byId.set(r.id, c); }
      if (r.sort === 'must_do') { c.sort = 'must_do'; if (!r.ungrounded) c.grounded = true; }
      c.seats.push(seat);
      c.reasons.push({ seat, sort: r.sort, reason: r.reason, ...(r.route ? { route: r.route } : {}), ...(r.route_asked ? { route_asked: r.route_asked } : {}) });
    }
  }
  // 0.8.4 S8 (exit-list ruling T17m(2)): with `allSeats` (every top-layer seat's key) an id is may_leave only when EVERY one of them said so; a seat that gave no word counts as must-do (the closure's rule, `closedAtClose`: the record and the closure cannot disagree). `ungrounded` stays "a real must-do names no criterion": a must-do derived by silence is not flagged. Without `allSeats` = the rule before, byte for byte.
  const every = Array.isArray(allSeats) && allSeats.length ? allSeats : null;
  return [...byId.values()].map(({ grounded, ...c }) => ({ ...c, ...routeSummaryOf(c.reasons), ...(every && c.sort === 'may_leave' && !every.every(s => c.seats.includes(s)) ? { sort: 'must_do' } : {}), ...(c.sort === 'must_do' && !grounded ? { ungrounded: true } : {}) }));
}
/**
 * 0.8.4 S9: the route of a combined must-do, from the seats' words on it: "proposers" when any seat's must-do word says so (the build may get more than it needs, as D12 does for the sort), else "writer" when one says so (`route_asked` when a seat asked the proposers
 * on a chain that has none, D29); nothing when no must-do word named a route. Pure.
 */
export function routeSummaryOf(reasons) {
  const m = (Array.isArray(reasons) ? reasons : []).filter(x => x && x.sort === 'must_do');
  if (m.some(x => x.route === 'proposers')) return { route: 'proposers' };
  if (m.some(x => x.route === 'writer')) return { route: 'writer', ...(m.some(x => x.route_asked === 'proposers') ? { route_asked: 'proposers' } : {}) };
  return {};
}
/** True for a combined row whose must-do is DERIVED by silence: no seat said must-do (every word on it is may_leave) and the row is must_do all the same. Pure. */
export const derivedMustDo = c => !!c && c.sort === 'must_do' && Array.isArray(c.reasons) && c.reasons.length > 0 && c.reasons.every(x => x.sort === 'may_leave');

/**
 * An open objection as the sorting list and the build check read it: `base` ({ id, layer, severity?, flags[], problem }) plus the anchor, read from the record the objection came from by the ONE rule of src/anchor.js (isUnanchored).
 * `f` is a failure of the last critique or a row of the objection ledger (the ledger row carries the latest failure's `quote`); a quote the exchange attached (`attached_quote`) counts. A later record of the same objection that
 * holds a quote fills one an earlier record lacked. Adds `quote` (when there is one) and `unanchored: true` (when there is none); nothing else changes.
 */
export function withAnchor(base, f) {
  const quote = base.quote || (f && (f.quote || f.attached_quote)) || '';
  const { unanchored, quote: oldQuote, ...rest } = base;
  const item = { ...rest, ...(quote ? { quote } : {}) };
  return isUnanchored({ id: item.id, quote: item.quote }) ? { ...item, unanchored: true } : item;
}

/**
 * The list a layer-3 seat sorts and the ids that list names, built in ONE place so the prompt and the filter cannot drift. `open`: the build check's open objections ({ id, layer, severity, flags[], problem, unanchored? }); `late`: the
 * late findings ({ id, rating, flags[], problem }); `wrap`: the claim container (the caller passes R.claimText). The problem is printed WHOLE inside the claim container (it is already capped upstream at the field cap every critic field is read at; layer 3 sorts on exactly this text, so nothing is cut). One item per id.
 * Also returns `problems` (id -> the whole problem), `unanchored` (the Set of ids whose objection quotes no passage, read from the item) and `objections` (id -> the open record: the raiser's `lab`, the rating, for the seam).
 */
export function sortingItemsOf({ open = [], late = [], wrap = s => s } = {}) {
  const items = []; const seen = new Set(); const problems = new Map(); const unanchored = new Set(); const objections = new Map();
  for (const o of open) {
    if (!o || !o.id || seen.has(o.id)) continue;
    seen.add(o.id); problems.set(o.id, String(o.problem ?? '')); objections.set(o.id, o); if (o.unanchored === true) unanchored.add(o.id);
    items.push({ id: o.id, kind: 'objection', first_round: Number.isInteger(o.first_round) ? o.first_round : null, layer: Number.isInteger(o.layer) ? o.layer : null, rating: typeof o.severity === 'number' ? o.severity : null, flags: [...(o.flags || []), ...(o.unanchored === true ? ['unanchored'] : [])], problem: wrap(String(o.problem ?? '')) });
  }
  for (const l of late) {
    if (!l || !l.id || seen.has(l.id)) continue;
    seen.add(l.id);
    items.push({ id: l.id, kind: 'late finding', first_round: Number.isInteger(l.round) ? l.round : null, layer: null, rating: typeof l.rating === 'number' ? l.rating : null, flags: [...(l.flags || [])], problem: wrap(String(l.problem ?? '')) });
  }
  return { items, knownIds: new Set(items.map(i => i.id)), problems, unanchored, objections };
}

export const FROM_SORTING = 'final_read';   // late_findings[].found for a finding the closing read made
/**
 * The late-finding inputs a closing read makes (W7's last sentence): a new defect a layer-3 seat found that no listed item names (`fresh`: a must-do with an id outside the list, or with no id and the passage). `perSeat`: [{ seat, fresh[] }];
 * `groundedWhy({ criterion, quote })`: the one late-finding rule for `ungrounded` (src/layer-debate.js lateUngroundedWhy, asked against the plan). -> [{ lab, criterion?, problem, quote?, rating: null, flags[], round, found, sorted }];
 * `sorted` is the seat's own words ({ sort: 'must_do', seats[], reasons[] }). A sorting row on an UNANCHORED failure keeps its place as a record only (its row is flagged `unanchored`, S18: the must-do is the late finding made from it by lateFromUnanchored below): nothing is made of it here.
 */
export function sortingFindingsOf({ perSeat = [], groundedWhy = () => null, round = 0, found = FROM_SORTING, flag = 'named_in_final_read' } = {}) {
  const out = [];
  for (const { seat, fresh = [] } of perSeat) {
    for (const f of fresh) {
      const criterion = f.criterion || '';   // only what the seat wrote as the criterion: a cited decision stays on the entry (sorting_new)
      const why = Object.hasOwn(f, 'ungrounded_why') ? f.ungrounded_why : groundedWhy({ criterion, quote: f.quote || '' });   // a grounding read where the seat's own plan was in scope (the climb verdict) is kept; the closing read's entries are read here
      out.push({ lab: seat, ...(criterion ? { criterion } : {}), problem: f.reason, ...(f.quote ? { quote: f.quote } : {}), rating: typeof f.rating === 'number' ? f.rating : null, flags: [flag, ...(why ? ['ungrounded'] : [])], round, found, sorted: { sort: 'must_do', seats: [seat], reasons: [{ seat, sort: 'must_do', reason: f.reason, ...(f.route ? { route: f.route } : {}), ...(f.route_asked ? { route_asked: f.route_asked } : {}) }], ...routeSummaryOf([{ sort: 'must_do', route: f.route, route_asked: f.route_asked }]), ...(!f.criterion && !f.decision ? { ungrounded: true } : {}) } });
    }
  }
  return out;
}

/**
 * 0.8.4 S18 (T18j, T18s, W7: "if you hold that its defect must be done, say so, and it is recorded as a late finding"; WORDING S18-w18b): the late findings made from UNANCHORED failures that a top-layer seat sorted must-do. ONE per failure, however many seats sorted it: its id is made from the failure's own
 * seat, criterion and text (lateFindingKey), so it does not change when a seat words its reason again and the climb and the final read make the same id; `sorted` holds every sorting seat's words; the rating is the highest rating a seat gave it (fail closed), null when none gave one; `linked_to` is the failure's id.
 * `perSeat`: [{ seat, rows[] }] (sorting rows as readSorting makes them); `unanchored`/`objections`/`problems`: from sortingItemsOf. Pure. -> late-finding inputs ({ id, lab, problem, rating, flags[], round, found, linked_to, sorted }).
 */
export function lateFromUnanchored({ perSeat = [], unanchored = new Set(), objections = new Map(), problems = new Map(), round = 0, found = FROM_SORTING, flag = 'named_in_final_read' } = {}) {
  const by = new Map();
  for (const { seat, rows = [] } of perSeat) {
    for (const r of rows || []) {
      if (!r || r.sort !== 'must_do' || !unanchored.has(r.id)) continue;
      let e = by.get(r.id); if (!e) { e = { id: r.id, seats: [], reasons: [], rating: null, criterion: '' }; by.set(r.id, e); }
      if (!e.seats.includes(seat)) e.seats.push(seat);
      e.reasons.push({ seat, sort: 'must_do', reason: r.reason, ...(r.route ? { route: r.route } : {}) });
      if (typeof r.rating === 'number') e.rating = e.rating === null ? r.rating : Math.max(e.rating, r.rating);
      if (!e.criterion && r.criterion) e.criterion = r.criterion;
    }
  }
  return [...by.values()].map(e => {
    const o = objections.get(e.id) || {}; const problem = String(problems.get(e.id) ?? o.problem ?? '');
    const { base } = lateFindingKey(o.lab ?? e.seats[0], { criterion: '', problem });   // the failure's seat and text (the check's items carry no criterion)
    return { id: base, lab: e.seats[0], ...(e.criterion ? { criterion: e.criterion } : {}), problem: e.reasons[0].reason, rating: e.rating, flags: [flag], round, found, linked_to: e.id, sorted: { sort: 'must_do', seats: [...e.seats], reasons: e.reasons } };
  });
}

// ---- 0.8.4 S8 c3: the closing read's CLOSURE (FEATURE_SPECS l.532, D12) ----
const wordsOf = rows => (Array.isArray(rows) && rows.length ? new Map(rows.map(r => [r.id, { sort: r.sort, reason: r.reason }])) : null);
/**
 * Each top-layer seat's CLOSING WORDS from the final_read record: a seat that read at the final read gives its sorting there; a seat that was not asked because it had read exactly this plan gives its sorting at its last verdict (`reused[].sorting`).
 * A seat asked but unread, or with no sorting rows, has no words (null): fail closed. [{ seat, words: Map(id -> { sort, reason }) | null }]. Pure.
 */
export function closingWords(finalRead) {
  const out = [];
  if (!finalRead || typeof finalRead !== 'object') return out;
  for (const e of Array.isArray(finalRead.seats) ? finalRead.seats : []) out.push({ seat: e.seat ?? e.lab, words: e.read === true ? wordsOf(e.sorting) : null });
  for (const e of Array.isArray(finalRead.reused) ? finalRead.reused : []) out.push({ seat: e.seat ?? e.lab, words: wordsOf(e.sorting) });
  return out;
}
/**
 * The open objections the closing read CLOSES: every top-layer seat's closing word on the id is may_leave AND the ruling's own predicate says it closes (`closes`: rated below 4 and never 7 or above). `open`: [{ key, id, closes }];
 * returns the Set of keys. One seat that is silent, unread or must-do closes nothing. Pure.
 */
export function closedAtClose({ finalRead = null, open = [] } = {}) {
  const seats = closingWords(finalRead);
  if (!seats.length) return new Set();
  return new Set(open.filter(o => o && o.id && o.closes === true && seats.every(s => s.words?.get(o.id)?.sort === 'may_leave')).map(o => o.key));
}
/** The seats' own reasons for one closed id, from the same closing words: [{ seat, reason }]. Pure. */
export const closingReasonsOf = (finalRead, id) => closingWords(finalRead).map(s => ({ seat: s.seat, reason: s.words?.get(id)?.reason ?? '' }));
/** The closed entries of a run, for the BOARD and the HANDOFF: the marked entries of `dispute.open_objections` (closed_by 'final_read') with the seats' own closing reasons: [{ id, lab, criterion, problem, reasons: [{ seat, reason }] }]. Pure; [] when nothing was closed. */
export const closedRowsOf = ({ dispute = null, finalRead = null } = {}) => (Array.isArray(dispute?.open_objections) ? dispute.open_objections : []).filter(o => o && o.closed_by === 'final_read').map(o => ({ id: o.id, lab: o.seat ?? o.lab, criterion: o.criterion, problem: o.problem ?? null, reasons: closingReasonsOf(finalRead, o.id) }));
/**
 * 0.8.4 S18 (Q7 ruled by C&C as F6: derived from existing records, no new field; T21s, T21bc, T21t, T21ak): what the top layer's CLOSING words did to the objections still standing at the end, read from the failures (`open`: { id, lab, problem, criterion?, severity, closes }), `finalRead` (closingWords: the seat's own sorting at the final read, or the reused one) and nothing else.
 * `closed`: sorted may-leave by EVERY top-layer seat and closed by the ruling's own predicate (`closes`: rated below 4, never 7 or above) - at an agreed ending the dispute stage does not run, so nothing marks dispute.open_objections and the HANDOFF section reads this. `openMayLeave`: sorted may-leave by every seat and NOT closed: still open on the record, shown with its sorting and
 * its reasons. Pure. -> { closed: [row], openMayLeave: [row] }; row = { id, lab, criterion, problem, rating, reasons: [{ seat, reason }] }.
 */
export function closingPartsOf({ open = [], finalRead = null } = {}) {
  const seats = closingWords(finalRead);
  const out = { closed: [], openMayLeave: [] };
  if (!seats.length) return out;
  for (const o of open) {
    if (!o || !o.id || !seats.every(s => s.words?.get(o.id)?.sort === 'may_leave')) continue;
    const row = { id: o.id, lab: o.lab, criterion: o.criterion, problem: o.problem ?? null, rating: typeof o.severity === 'number' ? o.severity : null, reasons: closingReasonsOf(finalRead, o.id) };
    (o.closes === true ? out.closed : out.openMayLeave).push(row);
  }
  return out;
}
/** The ids the build check DEMANDS an answer for: every open item except one every top-layer seat sorted may-leave that the ruling's own predicate closes (`closesOf(item)`: rated below 4, never 7 or above); that one is shown, with its sort and reasons, and not demanded. Pure. */
export const buildCheckDemanded = (items, closesOf) => (items || []).filter(i => !(i.sorted?.sort === 'may_leave' && closesOf(i))).map(i => i.id);
