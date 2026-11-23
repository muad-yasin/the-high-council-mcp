// 0.8.4 S2 (Q12; RU-S2-11..25, D10, D18): the identity of a blind-review failure, with the relation a judge declares for it. Pure helpers for src/chain.js: no call is made here and nothing is written to disk.
//
// The id is the DERIVED key (src/objection-ids.js baseObjectionId: seat key, criterion, first 160 normalised characters of the quoted passage; the coarse key of N22 when there is no quote). On top of it:
//   - a NEW objection whose key equals an id of this seat that still stands (or that this reply already uses) takes the numeric suffix #2, #3 and the record notes "same key" (`same_key`);
//   - `continues <id>` (an id this seat raised that still stands) keeps that id, whatever the new problem text;
//   - `reopens <id>` (an id this seat withdrew earlier) mints a new id with the suffix #r2, #r3, linked to the old one (`reopens`); the withdrawal stays on the record. A recurrence of a withdrawn key with the SAME normalised problem text and no
//     declaration is recorded as reopens in the same way; with a DIFFERENT text it is a new objection that shares the key and takes #2;
//   - a relation that names a missing id, or an id that is not this seat's own standing/withdrawn id, makes the reply unreadable (CA7: the counted re-ask F11 uses; no allowance is added); so does a reply that withdraws an id and raises
//     it again in the same reply (the same normalised text, or `reopens`/`continues` naming the id it withdraws). A failure with the key of an id the same reply withdraws but a DIFFERENT text is a new objection #2 (C&C's reading of Q12
//     l.168/171/181, 4 Nov 2026): the withdrawal stands, and the stall count of the old id ends while the new id starts its own;
//   - a supporter (another seat) that raises, as new, the defect of a withdrawn objection (same criterion and quoted passage) gets its own id and a see-also pointer (`see_also`) to the withdrawn one: never a merge.
// The whole assigner is active only once the relation wording W6 is recorded (D18) AND the chain has answer_back on (a judge is shown its own earlier ids only there): src/chain.js asks `held('relationRule')` and the answer_back switch; without either, ids are the pure derived key, as before, and nothing here runs.
import { baseObjectionId, recordAssignedId, criterionKeyOf, problemKey, resolvedCriterion } from './objection-ids.js';

export const normProblem = s => String(s ?? '').toLowerCase().replace(/[`*_"'‘’“”]/g, '').replace(/\s+/g, ' ').trim();
const norm = normProblem;
const ID = /^O-[0-9a-f]{8}(?:#r?\d+)?$/;

/** The relation a failure declares -> { kind: 'new' } | { kind: 'continues' | 'reopens', id } | { kind: 'bad' } (present but not readable). An absent relation is { kind: 'absent' }. Accepts "continues O-xxxxxxxx" or { kind, id }. */
export function parseRelation(raw) {
  if (raw === undefined || raw === null || raw === '') return { kind: 'absent' };
  let kind; let id;
  if (typeof raw === 'string') {
    const m = /^\s*(new|continues|reopens)\b\s*:?\s*(\S*)\s*$/i.exec(raw);
    if (!m) return { kind: 'bad' };
    kind = m[1].toLowerCase(); id = m[2];
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.kind === 'string') {
    kind = raw.kind.toLowerCase().trim(); id = typeof raw.id === 'string' ? raw.id.trim() : '';
  } else return { kind: 'bad' };
  if (kind === 'new') return id ? { kind: 'bad' } : { kind: 'new' };
  if (kind === 'continues' || kind === 'reopens') return ID.test(id) ? { kind, id } : { kind: 'bad' };
  return { kind: 'bad' };
}

const suffixed = (base, mark, taken) => { for (let n = 2; ; n++) { const id = `${base}#${mark}${n}`; if (!taken.has(id)) return id; } };

/**
 * Assigns the ids of one blind-review reply.
 * `lab`: the seat key. `failures`: the reply's normalised failures (each may carry `relation`). `withdrawnNow`: the ids this reply withdraws (its answers with status withdrawn).
 * `own`: Map(id -> { base, problemNorm, state }): the ids this seat has raised before and what became of them. `state` is 'standing', or one of the CLOSED states (GONE below): 'withdrawn' (its own argued withdrawal), 'overruled' (an upper layer's overrule closed it on the record, rated below 4), 'adopted' (an upper layer sustained and adopted it, D20), 'cleared_retag' (a re-tag put it below 4, N25). `withdrawnAny`: [{ id, lab, criterion, quote }]: every withdrawn objection of the run (for the see-also pointer).
 * Returns { unreadable: null | { why, ids }, failures }: failures with `id` set by a copy, plus `same_key`, `reopens`, `see_also` where they apply. Every id is recorded (objection-ids recordAssignedId) when the reply is readable.
 */
// Q12 (M1 S4): the states in which an id of this seat is CLOSED on the record. `reopens` accepts any of them; an undeclared recurrence of the same text under one of them is recorded as reopens (r2), a different text takes the suffix #2.
export const GONE_STATES = Object.freeze(['withdrawn', 'overruled', 'adopted', 'cleared_retag']);
const isGone = o => GONE_STATES.includes(o?.state);
// 0.8.4 (Muad, 11 Nov 2026): an objection the HANDLING SESSION or the TOP LAYER lowered below 4 stays lowered when the judge answers on it again: `continues <id>`, `reopens <id>` and the same text as `new` keep the id, with no suffix and no reopens note (the rating in force is the re-tagger's, so the objection holds no sign-off). Only a re-tag, by the handler or by layer 3 (the `by` of the re-tag row, kept in memory only): every other closed state reads as before.
const heldByRetag = o => (o?.state === 'cleared_retag' && (o?.by === 'handler' || o?.by === 'layer3')) || (o?.state === 'overruled' && (o?.by === 'handler' || o?.by === 'layer3'));   // a re-tag with no `by` (an unknown source) stays refused
export function assignIds({ lab, failures, withdrawnNow = new Set(), own = new Map(), withdrawnAny = [] }) {
  const taken = new Set(own.keys());
  const inReply = new Map();   // base -> ids assigned in this reply
  const seen = new Map();      // `${base}\0${problemNorm}` -> id: the same complaint twice in one reply is one objection
  const out = [];
  for (const f of failures) {
    const base = baseObjectionId(lab, f); const pn = norm(f.problem);
    const dup = seen.get(`${base}\u0000${pn}`);
    const rel = parseRelation(f.relation);
    if (rel.kind === 'bad') return { unreadable: { why: 'relation_unreadable', ids: [] }, failures };
    let id; const note = {};
    if (dup && rel.kind !== 'continues' && rel.kind !== 'reopens') { out.push({ ...f, id: dup }); continue; }
    if (rel.kind === 'continues') {
      const o = own.get(rel.id);
      if (!o || (o.state !== 'standing' && !heldByRetag(o)) || withdrawnNow.has(rel.id)) return { unreadable: { why: 'continues_not_standing', ids: [rel.id] }, failures };
      id = rel.id;
    } else if (rel.kind === 'reopens') {
      const o = own.get(rel.id);
      if (withdrawnNow.has(rel.id)) return { unreadable: { why: 'withdrawn_and_raised_again', ids: [rel.id] }, failures };
      if (!isGone(o)) return { unreadable: { why: 'reopens_not_closed', ids: [rel.id] }, failures };
      if (heldByRetag(o)) id = rel.id;
      else { id = suffixed(base, 'r', new Set([...taken, ...(inReply.get(base) || [])])); note.reopens = rel.id; }
    } else {
      const mine = [...own].filter(([, o]) => o.base === base);
      const goneNow = mine.find(([wid]) => withdrawnNow.has(wid));
      const standing = mine.find(([wid, o]) => o.state === 'standing' && !withdrawnNow.has(wid));
      const gone = mine.find(([wid, o]) => isGone(o) && !withdrawnNow.has(wid));
      const used = new Set([...taken, ...(inReply.get(base) || [])]);
      if (goneNow && goneNow[1].problemNorm === pn) return { unreadable: { why: 'withdrawn_and_raised_again', ids: [goneNow[0]] }, failures };
      const heldSame = mine.find(([wid, o]) => heldByRetag(o) && o.problemNorm === pn && !withdrawnNow.has(wid));
      if (heldSame) id = heldSame[0];   // the same complaint again under a key the handler lowered: the same objection, still at the handler's rating
      else if (gone && !goneNow && !standing && gone[1].problemNorm === pn) { id = suffixed(base, 'r', used); note.reopens = gone[0]; }   // the same text under a withdrawn key, undeclared: recorded as reopens and linked
      else if (goneNow || standing || gone || (inReply.get(base) || []).length) { id = suffixed(base, '', used); note.same_key = true; }
      else id = base;
      // a supporter: another seat's withdrawn objection with the same criterion and quoted passage -> a pointer, never a merge
      const crit = criterionKeyOf(resolvedCriterion(f.criterion)); const q = problemKey(f);
      const w = q ? withdrawnAny.find(x => x.lab !== lab && criterionKeyOf(resolvedCriterion(x.criterion)) === crit && x.quote === q) : null;
      if (w) note.see_also = w.id;
    }
    inReply.set(base, [...(inReply.get(base) || []), id]);
    seen.set(`${base}\u0000${pn}`, id);
    out.push({ ...f, id, ...note });
  }
  for (const f of out) recordAssignedId(lab, f, f.id);
  return { unreadable: null, failures: out };
}
