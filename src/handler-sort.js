// 0.8.4 S18 (spec l.1486, D31, W40; T21bi, T21bk, T21bl, T21bm): the handler's SORTING of an objection of the final read. When one layer-3 seat objects to the final text and the other layer-3 seat read this same text and signed it (the overseer layer is split), a handling session decides by reasoning whether
// the objection is must-do or may-leave on the build list: the run WAITS for that one sorting at a pause (an external stage `sort-<n>`: no call is made, nothing is re-sent, no choice of ending and no continue is offered). The ending stays not agreed (N26). One wait per open objection (W40 is singular: each answer names its one id).
// This file holds the switch (the wording W40 is HELD: handlerSortSystem + handlerSortUser), the prompt and the test of an answer; the wiring is in chain.js. A held read, so as shipped nothing waits.
import { held } from './held-roles.js';
import { draftIdOf } from './verdict-envelope.js';
import { namesEveryId } from './ending.js';

export const handlerSortLive = () => typeof held('handlerSortSystem') === 'function' && typeof held('handlerSortUser') === 'function';
export const handlerSortLabel = n => `sort-${n}`;

/** The prompt of one sort wait: { system, user }. `objection`: { id, seat, rating, criterion, problem, quote? } (model text already escaped by the caller); `signedBy`: the seat keys that signed this exact text. Deterministic: a resume rebuilds it byte for byte. */
export function handlerSortPrompt({ plan, objection, signedBy, layer = null }) {
  return { system: held('handlerSortSystem')({ layer }), user: held('handlerSortUser')({ plan, sha: draftIdOf(plan), objection, signedBy, layer }) };
}

const SORTS = { must_do: 'must_do', 'must-do': 'must_do', may_leave: 'may_leave', 'may-leave': 'may_leave' };
/** Reads the answer: JSON { "sort": "must_do" | "may_leave", "reasons": "..." }, or plain text whose first word is the sort (the rest is the reasons). Anything else is null. */
export function readSortAnswer(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  try { const j = JSON.parse(t); if (j && typeof j === 'object' && SORTS[String(j.sort ?? '').toLowerCase()]) return { sort: SORTS[String(j.sort).toLowerCase()], reasons: String(j.reasons ?? '').trim() }; } catch { /* plain text */ }
  const m = /^(\W*)([A-Za-z_-]+)\W*([\s\S]*)$/.exec(t);
  const word = m ? SORTS[m[2].toLowerCase()] : null;
  return word ? { sort: word, reasons: m[3].trim() } : null;
}

/** The test of an answer (spec l.1486: "an answer that omits the id, the sorting or the reasons is no answer"): { ok: true, sort, reasons } | { ok: false, why: 'unreadable' | 'no_reasons' | 'ids_missing', missing? }. */
export function judgeHandlerSort(text, id) {
  const a = readSortAnswer(text);
  if (!a) return { ok: false, why: 'unreadable' };
  if (!a.reasons) return { ok: false, why: 'no_reasons' };
  const named = namesEveryId(a.reasons, [id]);
  if (!named.ok) return { ok: false, why: 'ids_missing', missing: named.missing };
  return { ok: true, sort: a.sort, reasons: a.reasons };
}
