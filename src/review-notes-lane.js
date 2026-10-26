// The notes lane's wiring helpers (0.8.3 notes lane unit 2; gate note Review/Build_0.8.3/m6-closing/Notes_Lane_Unit2_Gate_Note.md and addendum 1, C&C PASS ON CONDITIONS 15 Okt 2026). Pure functions over a chain
// config and a parsed reply; no call, no clock, no file. src/review-notes.js is the item/budget/answer-grammar module; this file is what chain.js and src/cost.js both ask:
//   notesConfigOf(config)      -> null (the chain has no `reviewNotes` switch on) or { perKind, itemChars, aboutChars, textMax, aboutMax }, every number from the chain file or a named default below
//   reviewNotesActive(config)  -> the ONE activation predicate: the chain key is on AND every held lane sentence exists (src/held-roles.js; they exist only after the one roles.js re-record, M7). chain.js (what is
//                                 asked and run) and cost.js (what is priced) both call it, so a half-recorded M7 can neither spend output on notes nobody reads nor price a stage that never runs.
//   splitNotes(parsed)         -> { verdictPart, notesReply }: the two note keys taken OFF a parsed judge reply, before the verdict is read from the rest.
import { held } from './held-roles.js';
import { MEMORY_MAX_TOKENS_EST } from './review-notes.js';
import { roundLimitsOf } from './overseer-rounds.js';

/** The held sentences the lane needs, all of them or none (a half-recorded set leaves the lane off). Drafted in test/held-prompts/held-083.js; recorded in src/roles.js only with Muad's yes at M7. */
export const LANE_HELD_NAMES = Object.freeze(['reviewNotesAsk', 'reviewNotesRevise', 'reviewNotesMemory', 'reviewNotesAnswer']);

// Defaults (tunables, not measured figures). Derivations:
//  itemChars 400: 6 items x 400 characters + 3 `about` fields x 200, at 4 characters per token, is about 750 tokens, against the 10,000-token typical review reply of the shipped chains; it keeps a judge's notes
//  well under the 12,000 tokens that 6 items at the 8,000-character read cap could take (gate note addendum 1, A1/A2). aboutChars 200 is half of itemChars (an `about` names a place in the plan, not an argument).
//  textMax 8000 = chain.js CRITIC_FIELD_MAX_CHARS, the cap every other critic field is read at; aboutMax 400 = twice aboutChars, the read backstop for the same field. The read caps never drop a note for being
//  long: they cut with capField's mark. chain-lint refuses itemChars above textMax and aboutChars above aboutMax (a prompt limit larger than the read cap would ask for text the harness then cuts).
export const NOTES_ITEM_CHARS_DEFAULT = 400;
export const NOTES_ABOUT_CHARS_DEFAULT = 200;
export const NOTES_TEXT_MAX_DEFAULT = 8_000;
export const NOTES_ABOUT_MAX_DEFAULT = 400;

const whole = (v, min = 1) => Number.isInteger(v) && v >= min;

/** The chain's `reviewNotes` switch as the numbers the lane uses, or null when it is off or malformed (chain-lint is where a malformed one is refused; here a bad number never turns the lane on). */
export function notesConfigOf(config) {
  const k = config?.reviewNotes;
  if (!k || typeof k !== 'object' || k.enabled !== true || !whole(k.perKind)) return null;
  const pick = (v, dflt) => (v === undefined ? dflt : whole(v) ? v : null);
  const itemChars = pick(k.itemChars, NOTES_ITEM_CHARS_DEFAULT); const aboutChars = pick(k.aboutChars, NOTES_ABOUT_CHARS_DEFAULT);
  const textMax = pick(k.textMax, NOTES_TEXT_MAX_DEFAULT); const aboutMax = pick(k.aboutMax, NOTES_ABOUT_MAX_DEFAULT);
  if ([itemChars, aboutChars, textMax, aboutMax].includes(null)) return null;
  return { perKind: k.perKind, itemChars, aboutChars, textMax, aboutMax };
}

/** True only when the chain key is on AND all four lane sentences are held. `heldFn` is injectable for a test that wants to stand a half-recorded state up; production calls pass nothing. */
export function reviewNotesActive(config, heldFn = held) {
  return notesConfigOf(config) !== null && LANE_HELD_NAMES.every(name => typeof heldFn(name) === 'function');
}

/** The one clause that says what the printed MAXIMUM leaves out of a lane-on chain: the memory block every judge CALL reads from overseer round 2 on. '' unless the lane is active (the dry run and the cap screen print it, so no
 *  existing text moves). The number is MEMORY_MAX_TOKENS_EST, re-exported from the objection ledger's constant: one constant, never a copy. */
export function notesMemoryClause(config, heldFn = held) {
  return reviewNotesActive(config, heldFn) ? `the memory block judge calls read from overseer round 2 on (up to ${MEMORY_MAX_TOKENS_EST} tokens per call, paid input that neither figure prices)` : '';
}

/** The cap screen's line is for a FULL chain run only: a one-call screen (`handoff --from-run`, `contract draft`, `digest`) runs no judge, and a chain with no overseer rounds has no round 2. '' otherwise. */
export function capScreenMemoryClause(config, { fullRun = false, heldFn = held } = {}) {
  return fullRun && roundLimitsOf(config).overseer !== null ? notesMemoryClause(config, heldFn) : '';
}

/** Take `proposals` and `ideas` off a parsed judge reply. Anything that is not a plain object is returned untouched (normaliseCritique reports it unreadable as it always did); the input is never mutated. */
export function splitNotes(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { verdictPart: parsed, notesReply: null };
  const { proposals, ideas, ...verdictPart } = parsed;
  const notesReply = {};
  if (proposals !== undefined) notesReply.proposals = proposals;
  if (ideas !== undefined) notesReply.ideas = ideas;
  return { verdictPart, notesReply: Object.keys(notesReply).length ? notesReply : null };
}
