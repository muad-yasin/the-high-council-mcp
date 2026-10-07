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

const norm = s => String(s ?? '').toLowerCase().replace(/[`*_"'‘’“”]/g, '').replace(/\s+/g, ' ').trim();
/** The part of the draft an objection is about: its normalised quote, cut at 160 characters ('' when it quotes nothing, which falls back to the old, coarser key). */
export const problemKey = f => norm(f?.quote).slice(0, 160);

/** The criterion as the id reads it (audit fix 73-verdicts 4): trimming, case, inner spacing, quote marks and a closing full stop do not make a different criterion, so a judge that lists a sustained objection again with a drifted criterion is not given a second id. */
const criterionKey = f => norm(f?.criterion).replace(/[.;:,]+$/, '');

/** O-xxxxxxxx: the same for the same (lab, criterion, quoted text) in every round. */
export function objectionId(lab, f) {
  return `O-${createHash('sha256').update(`${lab}\u0000${criterionKey(f)}\u0000${problemKey(f)}`).digest('hex').slice(0, 8)}`;
}

/** The key a "first raised" map uses: lab, criterion and problem, so two defects under one criterion keep their own first round. */
export const objectionKey = f => `${f.lab}\u0000${f.criterion}\u0000${problemKey(f)}`;

/** What the stall rule compares round to round (sorted, so seat order never changes it). */
export const stallSignature = failures => failures.map(objectionKey).sort().join('\n');

/** The pre-0.8.2 signature, kept only so the implication "new equal => old equal" can be tested. */
export const legacyStallSignature = failures => failures.map(f => `${f.lab}|${f.criterion}`).sort().join('\n');
// (The new key joins with NUL, as objectionId does: a '|' inside a criterion or a quote cannot make two different objections look equal; found by the item 3 review.)
