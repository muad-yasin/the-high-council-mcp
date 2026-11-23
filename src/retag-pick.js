// 0.8.4 (A5, his 03 Nov 2026 17:39 pick "Handler picks by reasoning": "the handling session and its advisor pick one of the two, as the plan already does when the two top judges split at the final read (D31)"):
// when two top-layer seats re-rate ONE objection to DIFFERENT values in the same pass, a handling session picks one of the two ratings by reasoning, and the pick is what the run puts in force. The run WAITS for it at a pause
// (an external stage `retag-pick-<n>`: the same mechanism as the final-read sort wait `sort-<n>` and the build check: no call is made, nothing is re-sent, no choice of ending and no continue is offered), at the settle of the
// pass in which the seats re-rated, before anything is put in force. One wait per objection. A chain with no handling session, and a tree where the wording is not recorded, keep the rule that was always there: the HIGHER value applies.
// This file holds the switch (the wording is HELD: handlerRetagPickSystem + handlerRetagPickUser, test/held-prompts/held-084-a5.js), the prompt and the test of an answer; the wiring is in src/chain.js and the record is src/severity.js.
import { held } from './held-roles.js';
import { draftIdOf } from './verdict-envelope.js';
import { namesEveryId } from './ending.js';
import { readSeverity } from './severity.js';

export const handlerRetagPickLive = () => typeof held('handlerRetagPickSystem') === 'function' && typeof held('handlerRetagPickUser') === 'function';
export const retagPickLabel = n => `retag-pick-${n}`;

/** The prompt of one pick wait: { system, user }. `objection`: { id, lab, from, criterion, problem, quote? } (model text already escaped by the caller); `options`: [{ seat, to, reason }], the ratings the seats gave and their reasons (already escaped).
 * Deterministic: a resume rebuilds it byte for byte. */
export function handlerRetagPickPrompt({ plan, objection, options, layer = null }) {
  return { system: held('handlerRetagPickSystem')({ layer }), user: held('handlerRetagPickUser')({ plan, sha: draftIdOf(plan), objection, options, layer }) };
}

/** Reads the answer: JSON { "pick": <a rating>, "reasons": "..." }, or plain text whose first word is the rating (the rest is the reasons). Anything else is null. */
export function readPickAnswer(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const rating = v => { const r = readSeverity(typeof v === 'string' ? Number(v) : v); return r.ok ? r.value : null; };
  try { const j = JSON.parse(t); if (j && typeof j === 'object' && !Array.isArray(j)) { const to = rating(j.pick); if (to !== null) return { to, reasons: String(j.reasons ?? '').trim() }; } } catch { /* plain text */ }
  const m = /^\W*(\d+(?:\.\d)?)\b\W*([\s\S]*)$/.exec(t);
  const to = m ? rating(m[1]) : null;
  return to === null ? null : { to, reasons: m[2].trim() };
}

/** The test of an answer: the pick is one of the offered ratings, it has reasons, and the reasons name the objection by its id. { ok: true, to, reasons } | { ok: false, why: 'unreadable' | 'not_offered' | 'no_reasons' | 'ids_missing', missing? }. */
export function judgeRetagPick(text, id, offered) {
  const a = readPickAnswer(text);
  if (!a) return { ok: false, why: 'unreadable' };
  if (!(offered || []).includes(a.to)) return { ok: false, why: 'not_offered' };
  if (!a.reasons) return { ok: false, why: 'no_reasons' };
  const named = namesEveryId(a.reasons, [id]);
  if (!named.ok) return { ok: false, why: 'ids_missing', missing: named.missing };
  return { ok: true, to: a.to, reasons: a.reasons };
}
