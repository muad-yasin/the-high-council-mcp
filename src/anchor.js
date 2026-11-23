// 0.8.4 S14 (R22, N12, D21, C&C's R510/R517 rulings): the ONE rule for an UNANCHORED objection, read by every place that states it: src/report-shape.js sets the `unanchored` flag on the report's objection records and
// states the count on the board; S8's sorting reads it later. Never a second copy of the rule.
//
// An objection record is a failure with an `id` (the objection id of src/objection-ids.js). It is UNANCHORED when it quotes no passage of the plan (its quote, normalised the way the id and the stall read it, is empty).
// The flag says what the RECORD holds: that no quote is recorded. It does not say whether the judge was asked for one (before W23 is applied the critic is not offered a quote field in an unfenced run). Pure.
import { problemKey } from './objection-ids.js';

/** A real objection (it has an id); the harness's own placeholder failures of a degraded seat have none and are not counted. */
export const isObjectionRecord = r => !!r && typeof r === 'object' && typeof r.id === 'string' && r.id !== '';
/** True when the record is an objection that quotes no passage. */
export const isUnanchored = r => isObjectionRecord(r) && problemKey({ quote: r.quote || r.attached_quote }) === '';
/** The report's view of the objection list (C&C R528 hold): a quote attached in the exchange lives in the run as its own field `attached_quote` (so no id, no prompt and no ledger built from the fold ever sees it); the record names it `quote`, beside `quote_attached_in`, as the docs say. */
export const materialiseAttached = list => (Array.isArray(list) ? list.map(r => { if (!r || typeof r !== 'object' || r.attached_quote === undefined) return r; const { attached_quote: aq, ...rest } = r; return rest.quote ? rest : { ...rest, quote: aq }; }) : list);
/** The same list, with `unanchored: true` added to each unanchored objection and nothing added to any other record (a non-list is returned as it is). */
export const flagUnanchored = list => (Array.isArray(list) ? list.map(r => (isUnanchored(r) && r.unanchored !== true ? { ...r, unanchored: true } : r)) : list);
/** { n, m }: how many of the objections in `failures` are unanchored, and how many objections there are. */
export const unanchoredCount = failures => {
  const objections = (Array.isArray(failures) ? failures : []).filter(isObjectionRecord);
  return { n: objections.filter(isUnanchored).length, m: objections.length };
};
/** The unanchored objections of a result's last critique (the records S8's sorting and the board read). */
export const unanchoredOf = result => (Array.isArray(result?.lastCritique?.failures) ? result.lastCritique.failures.filter(isUnanchored) : []);
/** The board's one count sentence (C&C R517 option (2), A-DRAFT; BOARD.md and BOARD-partial.md both get it through renderBoardMd): "N of the M objections in the last critique name no quoted passage.", or '' when no objection lacks a quote. It lists nothing. */
export const anchorSentence = failures => { const { n, m } = unanchoredCount(failures); return n > 0 ? `Objections in the last critique that name no quoted passage: ${n} of ${m}.` : ''; };
