// A stable id for each objection, and the signature the stall rule compares (0.8.2 item 3; owner decisions of 5 Oct 2026 + C&C's C4, tickets 1 and 12).
//
// An objection is "the same problem" when the same lab raises the same criterion about the same quoted text. The id is a short hash of exactly that, so it is the same in every
// round the problem comes back, whatever words the lab uses for it; a different defect under the same broad criterion gets its own id. The ids are data for the board and for
// the answer-back (decision 3, a judge's own earlier objections); nothing here changes a prompt.
//
// The stall rule used to compare (lab, criterion) and nothing finer, so two DIFFERENT defects raised under one broad criterion looked like one stuck disagreement and stopped the loop
// early (ticket 12). The signature below adds the quoted text, which is finer, never coarser: two rounds that match under it also match under the old (lab, criterion) signature
// (test/objection-ids.test.js proves the implication). It can only make a stall LESS likely; it adds no early stop, and a reworded complaint about the same quote still counts as the same.
import { createHash } from 'node:crypto';
import { criterionIndexOf } from './criteria-ledger.js';

const norm = s => String(s ?? '').toLowerCase().replace(/[`*_"'‘’“”]/g, '').replace(/\s+/g, ' ').trim();
/** A leading list marker a judge copies from the NUMBERED criteria list ("7. The plan ...", "7) ...", "(7) ...", "7: ...") is not part of the criterion: the same criterion, with and without it, is one criterion for the id, the key and the stall signature (found 29 Okt 2026: one objection stood under five ids once a judge began numbering its criteria). Up to three digits and a following space, so "3.5 seconds" and "2024. The plan" are untouched. */
export const stripListMarker = s => String(s ?? '').replace(/^\s*\(?\d{1,3}[.):]\s+/, '');
/** The part of the draft an objection is about: its normalised quote, cut at 160 characters ('' when it quotes nothing, which falls back to the old, coarser key). */
export const problemKey = f => norm(f?.quote).slice(0, 160);

/** The criterion as the id reads it (audit fix 73-verdicts 4): trimming, case, inner spacing, quote marks and a closing full stop do not make a different criterion, so a judge that lists a sustained objection again with a drifted criterion is not given a second id. */
/** The identity read of a criterion TEXT: the list marker, case, inner spacing, quote marks and a closing full stop do not make another criterion. The id hashes it; the two other places that compare criterion texts in src/chain.js (pickContestedCriterion, normaliseCritique) read it too. */
export const criterionKeyOf = c => norm(stripListMarker(c)).replace(/[.;:,]+$/, '');
const criterionKey = f => criterionKeyOf(f?.criterion);

// 0.8.4 S2 (RU-S2-10, C&C's repair-lane ruling): a failure whose criterion text was retyped hashes the LIST criterion it resolves to (an exact match, a unique loose match, or a leading list number that agrees with a loose match), else its own text.
// No word of the failure changes and position never applies to failures: only the id's input does. The list is registered once per run (setIdCriteria); with none registered the id reads the typed text, as before.
let ID_CRITERIA = null;
export function setIdCriteria(list) { ID_CRITERIA = Array.isArray(list) && list.length ? list.filter(c => typeof c === 'string') : null; }
const LEADING_NUMBER = /^\s*(?:c|criterion\s*)?(\d{1,2})\s*[.):\-]/i;
/** The criterion text the id reads for a typed criterion: the list criterion it resolves to, else the typed text. */
export function resolvedCriterion(text) {
  if (!ID_CRITERIA) return text;
  const at = criterionIndexOf(text, ID_CRITERIA);
  if (at >= 0) return ID_CRITERIA[at];
  const lead = LEADING_NUMBER.exec(String(text ?? ''));
  if (lead) {   // a leading number that AGREES: the number names a list criterion whose words the rest of the text also names
    const n = Number(lead[1]) - 1;
    const rest = String(text).replace(LEADING_NUMBER, '').trim();
    if (n >= 0 && n < ID_CRITERIA.length && rest && criterionIndexOf(rest, ID_CRITERIA) === n) return ID_CRITERIA[n];
  }
  return text;
}

// 0.8.4 S2 (Q12, RU-S2-12..18; only once the relation wording W6 is recorded): the ids src/objection-assign.js has assigned in this run, by (lab, base id, normalised problem text). objectionId returns the assigned id when the same
// failure is asked for again, so every site that recomputes an id from a failure agrees with the assigner. Empty (the pure hash) until the assigner records something; cleared at the start of every run, and rebuilt by a replay in the same order.
const ASSIGNED = new Map();
export const resetAssignedIds = () => ASSIGNED.clear();
/** A run starts from an empty registry and a nested run (descending sub-runs, tree members) must not overwrite its parent's: runChain takes a snapshot on entry and restores it on exit. */
export const snapshotIds = () => ({ criteria: ID_CRITERIA, assigned: new Map(ASSIGNED) });
export const restoreIds = snap => { ID_CRITERIA = snap.criteria; ASSIGNED.clear(); for (const [k, v] of snap.assigned) ASSIGNED.set(k, v); };
const assignedKey = (lab, base, f) => `${lab}\u0000${base}\u0000${norm(f?.problem)}`;
export const recordAssignedId = (lab, f, id) => { ASSIGNED.set(assignedKey(lab, baseObjectionId(lab, f), f), id); };

/**
 * The next free suffixed id (#2, #3, ...) of a new objection whose key (seat, criterion, quoted passage) is already in use: not one of `taken` (the ids of the objections in hand) and not one the assigner has given this seat for this key in the run, a withdrawn or closed one included,
 * so a live objection never shares an id with a recorded withdrawal (the same rule the blind reviews' assigner follows, src/objection-assign.js). The caller registers the id it takes (recordAssignedId).
 */
export function nextSuffixedId(lab, f, taken = new Set()) {
  const base = baseObjectionId(lab, f);
  const used = new Set(taken);
  for (const [k, id] of ASSIGNED) if (k.startsWith(`${lab}\u0000${base}\u0000`)) used.add(id);
  for (let n = 2; ; n++) { const id = `${base}#${n}`; if (!used.has(id)) return id; }
}

/** O-xxxxxxxx: the same for the same (lab, criterion, quoted text) in every round. This is the DERIVED key (no suffix). */
export function baseObjectionId(lab, f) {
  return `O-${createHash('sha256').update(`${lab}\u0000${criterionKeyOf(resolvedCriterion(f?.criterion))}\u0000${problemKey(f)}`).digest('hex').slice(0, 8)}`;
}
/**
 * 0.8.4 S4b (D24, Q12, RU-S4-07/08; T17z): the key of a LATE FINDING (a defect first found in the last round of the ending exchange, not an objection): `L-` and eight hex digits of a hash over (the seat key, the criterion as the id reads it, the normalised
 * problem text), so the same seat's two findings of the same criterion with different texts have different keys unless the hashes collide (then the caller suffixes `#2`, `#3`). Returns { base, problemNorm }; the text part is what tells a collision from the same finding twice.
 */
export function lateFindingKey(lab, f) {
  const problemNorm = norm(f?.problem);
  return { base: `L-${createHash('sha256').update(`${lab}\u0000${criterionKeyOf(resolvedCriterion(f?.criterion))}\u0000${problemNorm}`).digest('hex').slice(0, 8)}`, problemNorm };
}

/** The id of an objection: the assigned one (a suffix, a reopens id) when the assigner gave this failure one, else the derived key. */
export function objectionId(lab, f) {
  const base = baseObjectionId(lab, f);
  return ASSIGNED.size ? (ASSIGNED.get(assignedKey(lab, base, f)) ?? base) : base;
}

/** The key a "first raised" map uses: lab, criterion and problem, so two defects under one criterion keep their own first round. */
export const objectionKey = f => `${f.lab}\u0000${stripListMarker(f.criterion)}\u0000${problemKey(f)}`;

/** What the stall rule compares round to round (sorted, so seat order never changes it). */
export const stallSignature = failures => failures.map(objectionKey).sort().join('\n');

/** The pre-0.8.2 signature, kept only so the implication "new equal => old equal" can be tested. */
export const legacyStallSignature = failures => failures.map(f => `${f.lab}|${f.criterion}`).sort().join('\n');
// (The new key joins with NUL, as objectionId does: a '|' inside a criterion or a quote cannot make two different objections look equal; found by the item 3 review.)
