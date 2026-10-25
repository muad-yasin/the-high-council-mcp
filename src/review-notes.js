// The review-notes module (0.8.3 notes lane, UNIT 1; gate page Review/Build_0.8.3/m6-closing/Notes_Lane_Gate_Page.md section 9 and its 15 Okt PASS ON CONDITIONS; short note Notes_Lane_Unit1_Note.md; C&C rulings 15 Okt 2026).
// PURE: no model, no clock, no file, no env. Its only imports are node:crypto (the project's one hashing scheme, like src/objection-ids.js) and the pure leaf src/objection-ledger.js (the ledger's budget figure, measure and cut mark: ONE copy of
// each, never retyped). Only src/draft-disputes.js imports it so far (the NOTE-line grammar, notes lane unit 2 commit 1); the wiring into runChain behind held sentences is unit 2 commit 2. No sentence a person or a model reads lives here (held wording is test/held-prompts/held.js).
// Muad (15 Okt 2026): each round each judge may add up to X proposals (adds something the plan does not have) and X improvement ideas (improves something already in it), per seat, per layer, per round; the writer answers each; across rounds
// every judge sees the last round's items WITH the writer's answers. The VERDICT is read from the criteria only: notes ride beside it and never change `meets` (this module never reads or writes `failures` or `meets`).
//
// CONTRACT (all functions are pure; none throws on any JSON shape except the argument errors named):
//   NOTE_LINE, isNoteLine(line), noteLineOf(line)   THE ONE grammar of an answer line, for this module AND for unit 2's stripDeclined extension (no second regex):
//        NOTE-TAKEN: N-xxxxxxxx   |   NOTE-DECLINED: N-xxxxxxxx[: <reason>]   |   NOTE-SAME: N-xxxxxxxx: N-yyyyyyyy          (case-exact; x = lowercase hex)
//        An answer line never starts with `DECLINED:` and carries no `O-` id, so the dispute parser (src/draft-disputes.js) can never read it as a dispute.
//   noteId(kind, text) -> 'N-' + 8 hex           sha256 over 'note\n' + kind + '\n' + normalised FULL text (NFC, trim, whitespace runs -> one space, case kept), cut to 8 hex. The lab is NOT in the hash (two judges with the same exact text
//        share an id, so "raised by N" is a real count: the E4b #10 trap). 32 bits: a collision is possible in principle (about 6e-7 across 72 items), so the same id with DIFFERENT text is kept as TWO items and counted, never merged.
//   readNotes(reply, { left: {proposal, idea}, textMax, aboutMax }) -> { items: [{ kind, id, text, about? }], cut: { proposal, idea }, dropped: [{ why, kind?, index? }], carried }
//   budgetLeft(items, lab, kind, overseerRound, perKind) -> whole number >= 0       perKind is REQUIRED (the chain's number): missing or not a whole number >= 1 -> TypeError
//   parseNoteAnswers(trailerText) ->  (the CALLER passes only the TRAILING region of the reviser's reply, found by the same closing-region walk as stripDeclined: a NOTE line quoted in the plan body is plan text, not an answer; this function reads every line it is given)
//   parseNoteAnswers(trailerText) -> { answers: Map id -> { status: 'taken'|'declined'|'same', reason?, same_as? }, conflicts: [id], malformed, repeated, reasonless }
//   notesView(items, answers, { chainLabs, afterSignoff, alreadyAnswered }) -> { rows, exclusion }       rows: { kind, id, text, about?, raised_by: [lab], raised_count, overseer_rounds: [n], answer: { status, reason?, same_as? }, id_collision? }
//        answer.status: taken | declined | same | unanswered | conflicting | builder_task (a `taken` AFTER sign-off: the plan is not changed, page option A)
//   lastRoundOf(items, currentRound) -> the newest overseer round before currentRound, or null;   sinceLastRevise(items, passes) -> the items no revise has shown the writer yet (passes: [{ pass, revised }], an unheard pass included)
//   fitNotes(rows, render, { maxChars, maxTokens, floor }) -> like fitLedger (src/objection-ledger.js): an injected render({ rows, omitted }), chars AND tokens, an exclusion that is NAMED AND COUNTED; the writer's answers are never cut.
// STATE: none. Items live in the run's verdict files (each verdict's stage file keeps the raw reply); every figure here is derived from them, so a resume replays at zero cost.
import { createHash } from 'node:crypto';
import { CUT_MARK, LEDGER_MAX_CHARS, LEDGER_MAX_TOKENS_EST, measure } from './objection-ledger.js';

export const NOTE_KINDS = Object.freeze(['proposal', 'idea']);
/** The memory block's budget IS the ledger's (Muad/C&C: 40,000 characters, the E4 cut rule): re-exported, not copied. */
export { LEDGER_MAX_CHARS as MEMORY_MAX_CHARS, LEDGER_MAX_TOKENS_EST as MEMORY_MAX_TOKENS_EST };
/** The shortest an item's text is cut to when the memory block is over its budget (a tunable, not a measured figure; the cut is visible with CUT_MARK). 400 characters keeps a sentence or two; 72 items x 400 = 28,800 < 40,000. */
export const NOTE_SHORTEN_FLOOR_CHARS = 400;
/** How many omitted ids the exclusion line names; the COUNT stays exact (as the ledger's OMITTED_IDS_MAX). */
export const NOTE_OMITTED_IDS_MAX = 20;

const ID = 'N-[0-9a-f]{8}';
const ID_RE = new RegExp(`^${ID}$`);
/** One answer line. Strict on case and the id form. Group 1 = status, 2 = id, 3 = the rest after a second colon (a reason, or the SAME target). */
export const NOTE_LINE = new RegExp(`^\\s*NOTE-(TAKEN|DECLINED|SAME):\\s*(${ID})(?![0-9a-f])(?:\\s*:\\s*(\\S[\\s\\S]*?))?\\s*$`);
const NOTE_PREFIX = /^\s*NOTE-/;
export const isNoteLine = line => typeof line === 'string' && NOTE_PREFIX.test(line);

/** -> { status, id, reason?, same_as? } for a well-formed answer line; { malformed: true } for any other line that starts `NOTE-`; null for every other line. */
export function noteLineOf(line) {
  if (!isNoteLine(line)) return null;
  const m = NOTE_LINE.exec(line);
  if (!m) return { malformed: true };
  const [, word, id, rest] = m;
  if (word === 'TAKEN') return rest === undefined ? { status: 'taken', id } : { malformed: true };
  if (word === 'DECLINED') return { status: 'declined', id, reason: rest === undefined ? null : rest };       // no reason: null, never invented text
  return rest !== undefined && ID_RE.test(rest) && rest !== id ? { status: 'same', id, same_as: rest } : { malformed: true };
}

const normalise = text => String(text ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
export function noteId(kind, text) {
  return `N-${createHash('sha256').update(`note\n${kind}\n${normalise(text)}`).digest('hex').slice(0, 8)}`;
}

const wholeAtLeast = (v, min) => Number.isInteger(v) && v >= min;
/** capField's own cut and mark (src/chain.js capField: `${value.slice(0, limit)}… [truncated, ${n} chars total]`). The limit is a REQUIRED argument: no literal here. */
const capText = (value, limit) => (value.length <= limit ? value : `${value.slice(0, limit)}… [truncated, ${value.length} chars total]`);
const own = (obj, key) => (obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function readNotes(reply, caps) {
  const { left, textMax, aboutMax } = caps ?? {};
  const skipIds = caps?.skipIds instanceof Set ? caps.skipIds : new Set();
  if (!wholeAtLeast(textMax, 1) || !wholeAtLeast(aboutMax, 1)) throw new TypeError(`readNotes: textMax and aboutMax must be whole numbers of at least 1 (the caller's caps), got ${JSON.stringify([textMax, aboutMax])}`);
  if (!left || !wholeAtLeast(left.proposal, 0) || !wholeAtLeast(left.idea, 0)) throw new TypeError(`readNotes: left must be { proposal, idea } whole numbers (budgetLeft), got ${JSON.stringify(left)}`);
  const out = { items: [], cut: { proposal: 0, idea: 0 }, dropped: [], carried: false };
  if (reply !== null && typeof reply === 'object' && own(reply, 'carried') === true) { out.carried = true; return out; }       // a carried verdict's notes were counted in the round they were given
  const seen = new Set();
  for (const [kind, key] of [['proposal', 'proposals'], ['idea', 'ideas']]) {
    const list = own(reply, key);
    if (list === undefined) continue;
    if (!Array.isArray(list)) { out.dropped.push({ why: 'not_an_array', kind }); continue; }
    let accepted = 0;
    list.forEach((raw, index) => {
      const text = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? own(raw, 'text') : undefined;
      const shown = typeof text === 'string' ? text.normalize('NFC').trim() : '';
      if (shown === '') { out.dropped.push({ why: 'bad_item', kind, index }); return; }
      const id = noteId(kind, shown);
      if (seen.has(id)) { out.dropped.push({ why: 'duplicate_in_reply', kind, index }); return; }          // the same exact text twice in one reply: counted once, and it spends no budget
      if (skipIds.has(id)) { out.dropped.push({ why: 'duplicate_of_earlier_reply', kind, index }); return; }          // 2b-0: an id this judge already gave in an earlier reply of the same pass: counted once, spends no budget (checked BEFORE the cut)
      seen.add(id);                                                                                         // a CUT item is seen too: a later identical text is a duplicate, not a second cut
      if (accepted >= left[kind]) { out.cut[kind] += 1; return; }
      const about = kind === 'idea' ? own(raw, 'about') : undefined;
      const item = { kind, id, text: capText(shown, textMax) };
      if (typeof about === 'string' && about.trim() !== '') item.about = capText(about.normalize('NFC').trim(), aboutMax);
      else if (about !== undefined) out.dropped.push({ why: 'bad_about', kind, index });
      out.items.push(item);
      accepted += 1;
    });
  }
  return out;
}

export function budgetLeft(items, lab, kind, overseerRound, perKind) {
  if (!wholeAtLeast(perKind, 1)) throw new TypeError(`budgetLeft: perKind must be the chain's whole number of at least 1, got ${JSON.stringify(perKind)}`);
  let used = 0;
  for (const it of Array.isArray(items) ? items : []) if (it && it.lab === lab && it.kind === kind && it.overseer_round === overseerRound) used += 1;
  return Math.max(0, perKind - used);
}

export function parseNoteAnswers(trailerText) {
  const answers = new Map(); const conflicts = new Set();
  let malformed = 0; let repeated = 0; let reasonless = 0;
  for (const line of (typeof trailerText === 'string' ? trailerText : '').split(/\r?\n/)) {
    const a = noteLineOf(line);
    if (a === null) continue;
    if (a.malformed) { malformed += 1; continue; }
    const earlier = answers.get(a.id);
    if (earlier === undefined) { answers.set(a.id, { status: a.status, ...(a.status === 'declined' ? { reason: a.reason } : {}), ...(a.status === 'same' ? { same_as: a.same_as } : {}) }); if (a.status === 'declined' && a.reason === null) reasonless += 1; continue; }
    const same = earlier.status === a.status && (earlier.reason ?? null) === (a.reason ?? null) && (earlier.same_as ?? null) === (a.same_as ?? null);
    if (same) repeated += 1; else conflicts.add(a.id);          // TAKEN then DECLINED for one id: recorded as conflicting, never silently resolved
  }
  return { answers, conflicts: [...conflicts].sort(byCode), malformed, repeated, reasonless };
}

export function notesView(items, answers, opts = {}) {
  const { chainLabs, afterSignoff = false, alreadyAnswered = new Set() } = opts;
  if (!chainLabs || typeof chainLabs[Symbol.iterator] !== 'function') throw new TypeError('notesView: chainLabs (the chain\'s judge labs) is required');
  const labs = new Set(chainLabs); const answered = new Set(alreadyAnswered);
  const answerOf = answers?.answers instanceof Map ? answers.answers : answers instanceof Map ? answers : new Map();
  const conflicting = new Set(answers?.conflicts ?? []);
  const exclusion = { off_chain: 0, already_answered: 0, id_collisions: 0, unknown_answer_ids: 0, unanswered: 0, bad_same: 0 };
  const groups = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.text !== 'string' || typeof it.id !== 'string' || !NOTE_KINDS.includes(it.kind)) continue;
    if (!labs.has(it.lab)) { exclusion.off_chain += 1; continue; }
    if (answered.has(it.id)) { exclusion.already_answered += 1; continue; }
    const key = `${it.kind}\u0000${it.id}\u0000${normalise(it.text)}`;
    const g = groups.get(key) ?? { kind: it.kind, id: it.id, text: it.text, ...(typeof it.about === 'string' ? { about: it.about } : {}), labs: new Set(), rounds: new Set() };
    g.labs.add(it.lab); if (Number.isInteger(it.overseer_round)) g.rounds.add(it.overseer_round);
    groups.set(key, g);
  }
  const perId = new Map();
  for (const g of groups.values()) perId.set(g.id, (perId.get(g.id) ?? 0) + 1);
  const ids = new Set([...groups.values()].map(g => g.id));
  const resolve = (id, seen = new Set()) => {            // follows NOTE-SAME to a TERMINAL answer (taken or declined): an unknown target, self, a cycle or a target nobody answered -> null (the item reads unanswered, counted)
    const a = answerOf.get(id);
    if (a === undefined || conflicting.has(id)) return null;
    if (a.status !== 'same') return a;
    if (seen.has(id) || !ids.has(a.same_as)) return null;
    seen.add(id);
    return resolve(a.same_as, seen);
  };
  const rows = [...groups.values()].map(g => {
    let answer;
    if (conflicting.has(g.id)) answer = { status: 'conflicting' };
    else {
      const a = answerOf.get(g.id);
      if (a === undefined) answer = { status: 'unanswered' };
      else if (a.status === 'taken') answer = { status: afterSignoff || a.after === true ? 'builder_task' : 'taken' };
      else if (a.status === 'declined') answer = { status: 'declined', reason: a.reason };
      else { if (resolve(g.id) === null) { answer = { status: 'unanswered' }; exclusion.bad_same += 1; } else answer = { status: 'same', same_as: a.same_as }; }
    }
    if (answer.status === 'unanswered') exclusion.unanswered += 1;
    return { kind: g.kind, id: g.id, text: g.text, ...(g.about !== undefined ? { about: g.about } : {}), raised_by: [...g.labs].sort(byCode), raised_count: g.labs.size, overseer_rounds: [...g.rounds].sort((a, b) => a - b), answer, ...(perId.get(g.id) > 1 ? { id_collision: true } : {}) };
  });
  for (const [id, n] of perId) if (n > 1) exclusion.id_collisions += n - 1;
  for (const id of answerOf.keys()) if (!ids.has(id) && !answered.has(id)) exclusion.unknown_answer_ids += 1;      // an answer naming an id nobody raised: never an answer to anything
  rows.sort((a, b) => byCode(a.kind, b.kind) || byCode(a.id, b.id) || byCode(a.text, b.text));
  return { rows, exclusion };
}

export function lastRoundOf(items, currentRound) {
  let best = null;
  for (const it of Array.isArray(items) ? items : []) if (it && Number.isInteger(it.overseer_round) && it.overseer_round < currentRound && (best === null || it.overseer_round > best)) best = it.overseer_round;
  return best;
}

/** passes: [{ pass, revised }] in order; `revised` = a revise ran after that pass (the writer was shown everything up to it). An unheard pass has no items and no revise: it simply extends the span. */
export function sinceLastRevise(items, passes) {
  let shownThrough = -Infinity;
  for (const p of Array.isArray(passes) ? passes : []) if (p && p.revised === true && Number.isInteger(p.pass) && p.pass > shownThrough) shownThrough = p.pass;
  return (Array.isArray(items) ? items : []).filter(it => it && Number.isInteger(it.pass) && it.pass > shownThrough);
}

export function fitNotes(rows, render, { maxChars = LEDGER_MAX_CHARS, maxTokens = LEDGER_MAX_TOKENS_EST, floor = NOTE_SHORTEN_FLOOR_CHARS } = {}) {
  const fits = text => { const m = measure(text); return m.chars <= maxChars && m.tokens_est <= maxTokens; };
  const done = (shown, omitted, text, counts) => ({ rows: shown, omitted, overflow: false, text, ...measure(text), counts: { rows: shown.length, shortened: counts.shortened, collapsed: counts.collapsed, omitted: omitted ? omitted.count : 0 } });
  let text = render({ rows, omitted: null });
  if (fits(text)) return done(rows, null, text, { shortened: 0, collapsed: 0 });
  let kept = rows.map(r => ({ ...r }));
  const longestFirst = () => kept.map((r, i) => [i, r]).filter(([, r]) => !r.collapsed).sort((a, b) => b[1].text.length - a[1].text.length || byCode(a[1].id, b[1].id));
  let shortened = 0; let collapsed = 0;
  for (const [i, r] of longestFirst()) {                                    // (2) texts shortened, longest first, visibly
    if (r.text.length <= floor) continue;
    kept[i] = { ...r, text: `${r.text.slice(0, floor)}${CUT_MARK}`, shortened: true }; shortened += 1;
    text = render({ rows: kept, omitted: null }); if (fits(text)) return done(kept, null, text, { shortened, collapsed });
  }
  for (const [i, r] of longestFirst()) {                                    // (3) rows collapsed to id + kind + the writer's answer (the item text goes, the answer stays)
    kept[i] = { ...r, text: '', about: undefined, collapsed: true }; collapsed += 1;
    text = render({ rows: kept, omitted: null }); if (fits(text)) return done(kept, null, text, { shortened, collapsed });
  }
  const cutIds = [];                                                         // (4) UNANSWERED rows are omitted, oldest round first, NAMED and COUNTED; an answered row is never dropped
  const order = kept.map((r, i) => [i, r]).filter(([, r]) => r.answer?.status === 'unanswered').sort((a, b) => (a[1].overseer_rounds[0] ?? 0) - (b[1].overseer_rounds[0] ?? 0) || byCode(a[1].id, b[1].id));
  const dropped = new Set();
  const omittedOf = (idsMax) => { const sorted = [...cutIds].sort(byCode); return { count: sorted.length, ids: sorted.slice(0, idsMax), more: Math.max(0, sorted.length - idsMax) }; };
  for (const [i, r] of order) {
    dropped.add(i); cutIds.push(r.id);
    const rest = kept.filter((_, k) => !dropped.has(k));
    for (const idsMax of [NOTE_OMITTED_IDS_MAX, 0]) { text = render({ rows: rest, omitted: omittedOf(idsMax) }); if (fits(text)) return done(rest, omittedOf(idsMax), text, { shortened, collapsed }); }
  }
  const rest = kept.filter((_, k) => !dropped.has(k));
  const left = cutIds.length ? omittedOf(0) : null;
  const m = measure(render({ rows: rest, omitted: left }));
  return { rows: rest, omitted: left, overflow: true, text: null, ...m, counts: { rows: rest.length, shortened, collapsed, omitted: cutIds.length } };       // OVERFLOW: the answered rows alone do not fit; the caller stops and sends nothing
}
