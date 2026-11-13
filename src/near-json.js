// 2 Nov 2026 (owner, to C&C: "pause"; heading "HIS FOUR MORNING ANSWERS ..." in the detail file; ruling of C&C the same day on the scope): a reply that LOOKS like JSON (it starts with `{` and a quoted key) and still reads null after every repair is
// paid for, and its words are probably all there. It pauses the run the way an external seat does, with or without a handler: whoever repairs it writes the reply again with the JSON fixed and no word changed, and THC takes the repair only
// if, with the JSON punctuation and white space left out, it reads word for word like the original. Prose replies are not near-JSON (they stay an abstention), neither is a reply that parses but is refused by a guard, and neither is a
// reply that was cut off or whose last brace never closes (a handler who only closed its brackets would leave a verdict the seat never finished).
//
// This module is pure text and files: the check (repairAcceptance), the words a person reads (repairNeedsBody) and the file moves that make the pause.
// 3 Nov 2026 (owner: "THE REPAIR TOOL LEAVES NO TRACE IN THC'S RECORD ...": nothing about a repair in the board, report.json or a prompt; the original kept as a file in the run folder for the maintainers): only the paid
// reply's TEXT moves, into `originals/` (ORIGINALS_DIR). Its usage record (`<label>.usage.json`, with the prompt hash) stays at its label, so the paid call is counted once, at its label, under its real provider, by
// every spend reader, and the repaired stage replays as an ordinary stage. No record reader opens originals/ (the stage cache reads top-level `<label>.*`; the report and spend readers read superseded/ and top-level
// usage records; resume-brief.js, shape-rounds.js and verdict-stats.js read top-level `*.md`): only this module does, through the stage cache. (Before, c513ea4c moved the reply AND its usage record into superseded/, so
// report.json listed the payment under superseded[] and the repaired stage replayed as provider external, usd 0: two traces.)
// The pause is a MARKER FILE, `<label>.repair.json`, at the top level while the repair is pending: which original it is held to, the prompt hash and the inputs fingerprint, the kind, and the last refusal. It is written BEFORE
// the move, so a crash between the two leaves a marker with the reply still in place, and the next read finishes the move (finishMove) instead of calling the model. When a repair is taken, the marker (marked accepted) and
// the NEEDS file move into originals/ too, so the top level is an ordinary stage again; the accepted marker is also how a resume knows the stage was repaired and must never pause a second time (acceptedRepairOf).
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUPERSEDED_DIR, nextSupersededN } from './superseded-n.js';

/** Where a repaired stage's original reply is kept, inside the run folder (3 Nov 2026). Only this module reads it. */
export const ORIGINALS_DIR = 'originals';

// What counts as the JSON punctuation of a reply: braces, brackets, colon, comma, the double quote, and the backslash of an escape. White space goes too.
const PUNCTUATION_AND_SPACE = /[\s{}[\]:,"\\]/g;

// A JSON string escape, read the way JSON reads it, in the original and in the repair alike: `\n`, `\t`, `\r`, `\b`, `\f` are white space, `\uXXXX` is its character, any other escaped character is itself. So a raw newline in a
// string that the repair escapes (`\n`) is the same white space, and a quote the repair escapes is the same quote.
function readEscapes(text) {
  return text.replace(/\\(?:u([0-9a-fA-F]{4})|([\s\S]))/g, (m, hex, ch) => (hex ? String.fromCharCode(parseInt(hex, 16)) : 'nrtbf'.includes(ch) ? ' ' : ch));
}
// One surrounding code fence is formatting, not words: its opening line (```json) and its closing line are left out of both texts.
const withoutFence = text => String(text).replace(/^\s*```[A-Za-z0-9_-]*[ \t]*\r?\n/, '').replace(/\r?\n?[ \t]*```[ \t]*\s*$/, '');

/** The words of a reply: everything but JSON punctuation and white space, escapes read as JSON reads them. Two replies with the same words differ only in punctuation and spacing. */
export const wordsOfReply = text => readEscapes(withoutFence(text)).replace(PUNCTUATION_AND_SPACE, '');

/**
 * The acceptance check. { ok: true } when the repaired text has the original's words in the original's order and nothing else; otherwise { ok: false, why } with the first place they differ.
 * It admits any move of braces, brackets, commas, colons and quotes, on purpose: those moves are the ambiguity the person repairing resolves. It admits no letter, digit or other character that was not there, and loses none.
 * What the moved punctuation MEANS is not judged here; the reply is read again by the verdict guards (duplicate keys, contradictory fields) when it is used.
 */
export function repairAcceptance(original, repaired) {
  if (typeof repaired !== 'string' || !repaired.trim()) return { ok: false, why: 'the repair is empty' };
  const a = wordsOfReply(original);
  const b = wordsOfReply(repaired);
  if (a === b) return { ok: true };
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const around = s => JSON.stringify(s.slice(Math.max(0, i - 25), i + 25));
  return { ok: false, why: `the repair does not read word for word like the original (JSON punctuation and white space left out): they first differ ${i} characters in, original ${around(a)}, repair ${around(b)}` };
}

/** The JSON object of a reply, read plainly: the whole text, or the span from its first `{` to its last `}` (a fence or a sentence around it). null when neither parses. The verdict guards read the result again when it is used.
 *  Exported for the MCP repair tool (src/repair-reply.js), which builds a table repair from it, so the tool and this check read the reply the same way. */
export function objectOf(text) {
  for (const c of [String(text ?? '').trim(), (() => { const s = String(text ?? ''); const a = s.indexOf('{'); const b = s.lastIndexOf('}'); return a >= 0 && b > a ? s.slice(a, b + 1) : ''; })()]) {
    try { const v = JSON.parse(c); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* the next shape */ }
  }
  return null;
}
const canonical = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));

/**
 * 3 Nov 2026 (owner's pick "Auto + handler tool": "At a pause, the handler gets the MCP repair tool for cases that need judgment: ... a paraphrased row"): the check of a TABLE repair. The repaired reply must be the
 * original object with nothing changed but the `criterion` text of some rows of its `criteria` table, each set to the run's exact text of the criterion at that row's own position. The rows keep their number and order; a
 * verdict, evidence, a failure, an answer, a rating or an id never changes. No change at all is a decline, and it is taken (the stage is then read as before). { ok: true, changed: [row numbers] } or { ok: false, why }.
 * 4 Nov 2026 (C&C's review of unit 6): only a row the pause FLAGGED may change (`flagged`, the marker's `rows`: the criteria the table left without a row). A row whose criterion already has a row (matched by text) keeps
 * its text, so no criterion gets a second row. One rule for both ways a repair arrives: the MCP tool and a reply written by hand, which the stage cache checks here. A pause record with no rows list, or an empty one,
 * refuses every answer, a decline included (fail closed: the marker sits in a project-writable file).
 */
export function tableRowsAcceptance(original, repaired, criteria, flagged) {
  if (typeof repaired !== 'string' || !repaired.trim()) return { ok: false, why: 'the repair is empty' };
  const named = Array.isArray(flagged) ? flagged.filter(n => Number.isInteger(n)) : [];
  if (!named.length) return { ok: false, why: 'the pause record names no row a repair may change' };
  const list = Array.isArray(criteria) ? criteria : [];
  const a = objectOf(original);
  const b = objectOf(repaired);
  if (!a) return { ok: false, why: 'the original reply could not be read as one JSON object' };
  if (!b) return { ok: false, why: 'the repair is not one JSON object' };
  const rowsA = Array.isArray(a.criteria) ? a.criteria : null;
  const rowsB = Array.isArray(b.criteria) ? b.criteria : null;
  if (!rowsA || !rowsB || rowsA.length !== rowsB.length) return { ok: false, why: 'the repair must keep the table\'s rows, their number and their order' };
  const changed = [];
  for (const [k, ra] of rowsA.entries()) {
    const rb = rowsB[k];
    if (canonical({ ...ra, criterion: null }) !== canonical({ ...rb, criterion: null })) return { ok: false, why: `row ${k + 1} changed something other than its criterion text (a verdict or evidence is the judge's)` };
    if (ra?.criterion === rb?.criterion) continue;
    if (!named.includes(k + 1)) return { ok: false, why: `row ${k + 1}'s criterion text may not change: this pause names only ${named.length === 1 ? `row ${named[0]}` : `rows ${named.join(', ')}`}, where the row's words did not fit the criterion at that position` };
    if (typeof list[k] !== 'string' || rb?.criterion !== list[k]) return { ok: false, why: `row ${k + 1}'s criterion text must be criterion ${k + 1}'s exact text, or left as the judge wrote it` };
    changed.push(k + 1);
  }
  if (canonical({ ...a, criteria: null }) !== canonical({ ...b, criteria: null })) return { ok: false, why: 'the repair changed something outside the table\'s criterion texts' };
  return { ok: true, changed };
}

// 3 Nov 2026 (owner's pick "Auto + handler tool": a one-letter id slip goes to the handler; C&C: exchange post ids only, the relation field stays B3's D18/RU-S2-04, ships in 0.8.4): an id a judge wrote one character away
// from an id it was shown. An id is a printable, space-free string; the slip must have the length of a shown id and differ from EXACTLY ONE shown id, in exactly one position. Anything else is not a slip (the post is
// dropped as before): two characters off, two candidates, a hidden character, or a reply that already names the candidate (a repair there would only make a second post the reader drops).
const ID_SHAPE = /^[\x21-\x7e]{1,64}$/;
// 0.8.4 S2: an objection id may carry a suffix (#2, #r2): the suffix is STRUCTURE, never a place where a letter slipped, so only the base of two ids with the same suffix can be one character apart.
const splitSuffix = id => { const i = id.indexOf('#'); return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i)]; };
const oneApartId = (a, b) => { const [ba, sa] = splitSuffix(a); const [bb, sb] = splitSuffix(b); return sa === sb && oneApart(ba, bb); };
const oneApart = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length && d < 2; i++) if (a[i] !== b[i]) d++; return d === 1; };

/** The slips among the ids a reply names: [{ from, to }], one per named id that is not shown and is one character from exactly one shown id the reply does not already name. `named` and `shown` are strings. */
export function idSlipsOf(named, shown) {
  const shownIds = [...new Set((Array.isArray(shown) ? shown : []).filter(x => typeof x === 'string' && ID_SHAPE.test(x)))];
  const namedIds = (Array.isArray(named) ? named : []).filter(x => typeof x === 'string');
  const out = [];
  for (const from of new Set(namedIds)) {
    if (!ID_SHAPE.test(from) || shownIds.includes(from)) continue;
    const near = shownIds.filter(id => oneApartId(from, id));
    if (near.length !== 1 || namedIds.includes(near[0])) continue;
    out.push({ from, to: near[0] });
  }
  return out;
}

// The id fields a slip repair may change, by where they sit in the reply: an exchange post's `on`, an answer's `id`.
const ID_FIELDS = [['posts', 'on', 'post', "a stance, a reason or a quote is the judge's"], ['replies', 'id', 'answer', "an action or its words are the judge's"]];
const withoutIds = o => Object.fromEntries(Object.entries(o).map(([k, v]) => { const f = ID_FIELDS.find(([arr]) => arr === k); return [k, f && Array.isArray(v) ? v.map(e => (e && typeof e === 'object' && !Array.isArray(e) ? { ...e, [f[1]]: null } : e)) : v]; }));

/**
 * 4 Nov 2026 (unit 8): the check of an ID SLIP repair. The repaired reply must be the original object with nothing changed but the objection ids of some posts (`posts[k].on`) or answers (`replies[k].id`), each changed from a
 * `from` to its `to` exactly as the pause recorded them (`slips`, the marker's: THC found them, nobody types an id). The posts and answers keep their number and order; a stance, a reason, a quote, an action or anything
 * else never changes. No change at all is a decline, and it is taken. A pause record with no slips, or an empty list, refuses every answer (fail closed). { ok: true, changed: [the ids now named] } or { ok: false, why }.
 */
export function idSlipAcceptance(original, repaired, slips) {
  if (typeof repaired !== 'string' || !repaired.trim()) return { ok: false, why: 'the repair is empty' };
  const pairs = (Array.isArray(slips) ? slips : []).filter(p => p && typeof p.from === 'string' && typeof p.to === 'string');
  if (!pairs.length) return { ok: false, why: 'the pause record names no id a repair may change' };
  const a = objectOf(original);
  const b = objectOf(repaired);
  if (!a) return { ok: false, why: 'the original reply could not be read as one JSON object' };
  if (!b) return { ok: false, why: 'the repair is not one JSON object' };
  const changed = [];
  for (const [arr, field, noun, whose] of ID_FIELDS) {
    const ea = Array.isArray(a[arr]) ? a[arr] : null;
    const eb = Array.isArray(b[arr]) ? b[arr] : null;
    if (!ea && !eb) continue;
    if (!ea || !eb || ea.length !== eb.length) return { ok: false, why: "the repair must keep the reply's posts and answers, their number and their order" };
    for (const [k, x] of ea.entries()) {
      const y = eb[k];
      const plain = v => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v, [field]: null } : v);
      if (canonical(plain(x)) !== canonical(plain(y))) return { ok: false, why: `${noun} ${k + 1} changed something other than its objection id (${whose})` };
      if (x?.[field] === y?.[field]) continue;
      if (!pairs.some(p => p.from === x?.[field] && p.to === y?.[field])) return { ok: false, why: `${noun} ${k + 1}'s objection id may change only to the id the request names for it` };
      changed.push(y[field]);
    }
  }
  if (canonical(withoutIds(a)) !== canonical(withoutIds(b))) return { ok: false, why: 'the repair changed something outside the ids of the posts and answers' };
  return { ok: true, changed };
}

/** The pause kinds this module knows: a marker's `kind` must be one of them. */
export const REPAIR_KINDS = Object.freeze(['near_json', 'table_rows', 'id_slip']);

/** The check a repair of this pause's kind must pass (the stage cache and the MCP repair tool call the same one). A kind the module does not know refuses every answer (4 Nov 2026: fail closed; the marker sits in a project-writable file). */
export function acceptanceFor(marker, original, repaired) {
  if (marker?.kind === 'table_rows') return tableRowsAcceptance(original, repaired, marker.criteria, marker.rows);
  if (marker?.kind === 'id_slip') return idSlipAcceptance(original, repaired, marker.slips);
  if (marker?.kind !== undefined && marker?.kind !== 'near_json') return { ok: false, why: 'the pause record names a kind of repair the harness does not know' };
  return repairAcceptance(original, repaired);
}

const markerPath = (runDir, label) => join(runDir, `${label}.repair.json`);
const insideRunFolder = p => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.split('/').includes('..');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The pause number of a marker: the `<n>` of `originals/<label>.<n>.md`. */
const pauseNumberOf = marker => Number(/\.(\d+)\.md$/.exec(marker?.repairOf ?? '')?.[1]) || null;
/** The next free pause number for `label` in originals/ (1 when there is none). */
function nextOriginalN(runDir, label) {
  let names = [];
  try { names = readdirSync(join(runDir, ORIGINALS_DIR)); } catch { return 1; }
  const re = new RegExp(`^${escapeRe(label)}\\.(\\d+)\\.`);
  return names.reduce((n, f) => Math.max(n, Number(re.exec(f)?.[1] ?? 0)), 0) + 1;
}

// An id slip pause's own fields, shape-checked on read (the marker is project-writable): `slips` [{ from, to }] and `shown` [id], every id printable and space-free, 1 to 64 characters. A field with anything else is left
// out, so the check refuses (no slips: fail closed) and nothing odd reaches an answer.
const slipFieldsOf = m => ({
  ...(Array.isArray(m.slips) && m.slips.length <= 200 && m.slips.every(p => p && ID_SHAPE.test(p.from ?? '') && ID_SHAPE.test(p.to ?? '')) ? { slips: m.slips.map(p => ({ from: p.from, to: p.to })) } : {}),
  ...(Array.isArray(m.shown) && m.shown.length <= 200 && m.shown.every(x => ID_SHAPE.test(x ?? '')) ? { shown: [...m.shown] } : {}),
});

/** The marker of a repair pause: { repairOf, promptHash, inputsFingerprint, kind, refusal, accepted } or null (no marker, unreadable, or a path that leaves the run folder). */
export function repairMarkerOf(runDir, label) {
  const file = markerPath(runDir, label);
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    if (!insideRunFolder(m?.repairOf)) return null;
    return { repairOf: m.repairOf, promptHash: typeof m.promptHash === 'string' ? m.promptHash : null, inputsFingerprint: typeof m.inputsFingerprint === 'string' ? m.inputsFingerprint : null, kind: typeof m.kind === 'string' ? m.kind : 'near_json', refusal: typeof m.refusal === 'string' ? m.refusal : null, accepted: m.accepted === true, ...(m.declined === true ? { declined: true } : {}), ...(Array.isArray(m.criteria) && m.criteria.every(c => typeof c === 'string') ? { criteria: m.criteria } : {}), ...(Array.isArray(m.rows) ? { rows: m.rows.filter(n => Number.isInteger(n)) } : {}), ...slipFieldsOf(m) };
  } catch { return null; }
}

/** The original reply of a repair pause, read from the file the marker names in originals/; null when it cannot be read (the check then refuses everything, never accepts blind). */
export function originalOf(runDir, marker) {
  try { return readFileSync(join(runDir, marker.repairOf), 'utf8'); } catch { return null; }
}

function writeAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
const markerJson = m => JSON.stringify({ repairOf: m.repairOf, promptHash: m.promptHash, inputsFingerprint: m.inputsFingerprint, kind: m.kind ?? 'near_json', ...(m.refusal ? { refusal: m.refusal } : {}), ...(m.accepted ? { accepted: true } : {}), ...(m.declined ? { declined: true } : {}), ...(m.criteria ? { criteria: m.criteria } : {}), ...(m.rows ? { rows: m.rows } : {}), ...(m.slips ? { slips: m.slips } : {}), ...(m.shown ? { shown: m.shown } : {}) });
const writeMarker = (runDir, label, m) => writeAtomic(markerPath(runDir, label), markerJson(m));

/**
 * Finishes a move that a crash cut short: the marker names `originals/<label>.<n>.md` and that file is not there, so the paid reply's text is still live at `<label>.md`. It moves to the name the marker gives. Only the
 * text moves: the usage record stays at its label. Nothing is called, nothing is deleted. Returns true when it moved something.
 */
export function finishMove(runDir, label, marker = repairMarkerOf(runDir, label)) {
  if (!marker || marker.accepted || existsSync(join(runDir, marker.repairOf))) return false;
  const from = join(runDir, `${label}.md`);
  if (!existsSync(from)) return false;
  mkdirSync(join(runDir, ORIGINALS_DIR), { recursive: true });
  renameSync(from, join(runDir, marker.repairOf));
  return true;
}

/**
 * Makes the pause on disk for one stage, marker first, then the move. First pause: the number is chosen, the marker is written, then the paid reply's text (`<label>.md`) moves to `originals/<label>.<n>.md`; its usage
 * record stays where it is. A stage that is already paused keeps its first original as THE original: a move cut short is finished; a repair that arrived and was refused moves into originals/ as
 * `<label>.<n>.refused-<k>.md` (nothing deleted) and the marker is rewritten with the refusal; a second pause with nothing live moves nothing. Returns { keptAs } (a path inside the run folder).
 */
export function setAsideOriginal({ runDir, label, promptHash, fingerprint, refusal = null, kind = 'near_json', criteria = null, rows = null, slips = null, shown = null }) {
  const earlier = repairMarkerOf(runDir, label);
  if (!earlier || earlier.accepted) {
    if (!existsSync(join(runDir, `${label}.md`))) throw new Error(`stage "${label}" has no reply on disk to set aside for a repair`);
    const keptAs = `${ORIGINALS_DIR}/${label}.${nextOriginalN(runDir, label)}.md`;
    const marker = { repairOf: keptAs, promptHash, inputsFingerprint: fingerprint, kind, refusal, ...(kind === 'table_rows' && Array.isArray(criteria) ? { criteria, rows: Array.isArray(rows) ? rows : [] } : {}), ...(kind === 'id_slip' ? { slips: Array.isArray(slips) ? slips : [], shown: Array.isArray(shown) ? shown : [] } : {}) };
    writeMarker(runDir, label, marker);   // FIRST: from here a resume pauses again whatever state the move is in
    finishMove(runDir, label, marker);
    return { keptAs };
  }
  finishMove(runDir, label, earlier);
  const live = join(runDir, `${label}.md`);
  if (existsSync(live)) {   // a repair that was not taken: kept beside the original, numbered, never overwritten
    const n = pauseNumberOf(earlier);
    const dir = join(runDir, ORIGINALS_DIR);
    mkdirSync(dir, { recursive: true });
    let k = 1;
    while (existsSync(join(dir, `${label}.${n}.refused-${k}.md`))) k++;
    renameSync(live, join(dir, `${label}.${n}.refused-${k}.md`));
  }
  writeMarker(runDir, label, { ...earlier, promptHash: promptHash ?? earlier.promptHash, inputsFingerprint: fingerprint ?? earlier.inputsFingerprint, refusal: refusal ?? earlier.refusal });
  return { keptAs: earlier.repairOf };
}

/**
 * A repair was taken (or declined: the original put back unchanged): the marker, marked accepted, and the stage's NEEDS file move into originals/ beside the original, so the top level is an ordinary stage again. The marker is
 * first rewritten in place as accepted, then moved: a crash between the two leaves an accepted marker at the top level, and the next read finishes the move (the stage cache). Returns true when it moved the marker.
 */
export function acceptRepair(runDir, label, marker = repairMarkerOf(runDir, label), { declined = false } = {}) {
  if (!marker) return false;
  const n = pauseNumberOf(marker) ?? nextOriginalN(runDir, label);
  if (!marker.accepted || (declined && !marker.declined)) writeMarker(runDir, label, { ...marker, accepted: true, ...(declined ? { declined: true } : {}) });
  const dir = join(runDir, ORIGINALS_DIR);
  mkdirSync(dir, { recursive: true });
  const needs = join(runDir, `NEEDS-${label}.md`);
  if (existsSync(needs) && !existsSync(join(dir, `${label}.${n}.needs.md`))) renameSync(needs, join(dir, `${label}.${n}.needs.md`));
  renameSync(markerPath(runDir, label), join(dir, `${label}.${n}.repair.json`));
  return true;
}

/** The newest accepted repair of `label` in originals/: { promptHash, declined } or null. A stage with one for the prompt asked now was repaired and is read as it is: it never pauses a second time. */
export function acceptedRepairOf(runDir, label) {
  let names = [];
  try { names = readdirSync(join(runDir, ORIGINALS_DIR)); } catch { return null; }
  const re = new RegExp(`^${escapeRe(label)}\\.(\\d+)\\.repair\\.json$`);
  const newest = names.map(f => [Number(re.exec(f)?.[1] ?? 0), f]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0])[0];
  if (!newest) return null;
  try {
    const m = JSON.parse(readFileSync(join(runDir, ORIGINALS_DIR, newest[1]), 'utf8'));
    return m?.accepted === true ? { promptHash: typeof m.promptHash === 'string' ? m.promptHash : null, ...(m.declined === true ? { declined: true } : {}) } : null;
  } catch { return null; }
}

/**
 * The pause is over for this stage without an answer, because the stage is stale or its prompt changed: the marker moves into originals/ (as `<label>.<n>.released.json`), so the stage runs normally. If the paid reply is
 * still set aside (no `<label>.md`), it is now a stale answer: its usage record moves into superseded/, numbered, the way every stale stage is kept, so the new call can never overwrite the paid record and its cost is
 * still counted. The record moves whenever it is at the label, whether or not the original text can be found (the review of the money unit: with the original missing, the record used to stay and the re-run overwrote
 * it); the original text follows it into superseded/ only then. When no record is at the label (a stale stage whose files the cache has already archived), the original stays in originals/, the maintainers' copy.
 * A no-op without a marker. No WARNINGS line, as before (the stale-stage path writes its own).
 */
export function releaseRepairMarker(runDir, label) {
  const file = markerPath(runDir, label);
  if (!existsSync(file)) return false;
  const marker = repairMarkerOf(runDir, label);
  const records = ['usage.json', 'prompt.json'].filter(ext => existsSync(join(runDir, `${label}.${ext}`)));   // usage record first, text last (the order archiveSuperseded uses)
  if ((!marker || !marker.accepted) && !existsSync(join(runDir, `${label}.md`)) && records.length) {
    const n = nextSupersededN(runDir, label);
    mkdirSync(join(runDir, SUPERSEDED_DIR), { recursive: true });
    for (const ext of records) renameSync(join(runDir, `${label}.${ext}`), join(runDir, SUPERSEDED_DIR, `${label}.${n}.${ext}`));
    if (marker && existsSync(join(runDir, marker.repairOf))) renameSync(join(runDir, marker.repairOf), join(runDir, SUPERSEDED_DIR, `${label}.${n}.md`));
  }
  const dir = join(runDir, ORIGINALS_DIR);
  mkdirSync(dir, { recursive: true });
  renameSync(file, join(dir, `${label}.${pauseNumberOf(marker) ?? nextOriginalN(runDir, label)}.released.json`));
  return true;
}

/** A-DRAFT (public text: what a person or a handler reads in NEEDS-<label>.md for a TABLE repair, 3 Nov 2026). Shown once at the release review. `rows`: the row numbers that did not fit their position. */
export function tableRepairNeedsBody({ label, askedFor = null, original, refusal = null, how = '', criteria = [], rows = [] }) {
  const which = rows.length ? `row${rows.length === 1 ? '' : 's'} ${rows.join(', ')}` : 'some rows';
  return `# Repair needed: ${label} (a sign-off table)\n\n${askedFor ? `${askedFor} signed off` : 'A seat signed off'} with a table that has one row per criterion, in order, but the words of ${which} do not fit their criterion closely enough to be read by position. The reply was paid for.\n\n`
    + `For each of those rows, compare the judge's words with the criterion at that row's position. If they ask the same thing, put that criterion's exact text (below) in the row's "criterion" field. If the judge's words changed what the criterion asks, leave the row as the judge wrote it. Change nothing else. To make no repair at all, write the original back unchanged: the seat is then asked again.\n\n`
    + `THC takes the repair only if every change is a row's criterion text set to the exact text of the criterion at that row's position. A verdict, evidence, a failure or a rating is never changed.\n\n`
    + `Answer this request BEFORE you add or change a ruling, a criterion or the draft. The repair is held to the prompt the seat was asked; if that prompt changes before the run resumes, the repair is set aside, the seat is asked again and paid again.\n\n`
    + `${refusal ? `The last repair was not taken: ${refusal}\n\n` : ''}${how}## The original reply\n\n${original}\n\n## The criteria, numbered as the seat saw them\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`;
}

/** A-DRAFT (public text: what a person or a handler reads in NEEDS-<label>.md for an ID SLIP repair, 4 Nov 2026). Shown once at the release review. `slips` [{ from, to }]: what the pause found; `shown`: the ids the seat was shown. */
export function idSlipRepairNeedsBody({ label, askedFor = null, original, refusal = null, how = '', slips = [], shown = [] }) {
  const pairs = slips.map(p => `${p.from} for ${p.to}`).join('; ');
  return `# Repair needed: ${label} (an objection id one character off)\n\n${askedFor ? `${askedFor} wrote` : 'A seat wrote'} a reply that names an objection id it was not shown, one character away from an id it was shown: ${pairs}. The reply was paid for; as written, a post or answer with such an id would be dropped.\n\n`
    + `If the post or answer clearly means the objection whose id the seat was shown (the id one character away), give it that id and change nothing else. If it may mean something else, leave it: it is then dropped, as before. To make no repair at all, write the original back unchanged.\n\n`
    + `THC takes the repair only if every change is one of the ids above set to the id the seat was shown. A stance, a reason, a quote or an answer never changes.\n\n`
    + `Answer this request BEFORE you add or change a ruling, a criterion or the draft. The repair is held to the prompt the seat was asked; if that prompt changes before the run resumes, the repair is set aside, the seat is asked again and paid again.\n\n`
    + `${refusal ? `The last repair was not taken: ${refusal}\n\n` : ''}${how}## The original reply\n\n${original}\n\n## The ids the seat was shown\n\n${shown.map(id => `- ${id}`).join('\n')}\n`;
}

/** A-DRAFT (public text: it is what a person or a handler reads in NEEDS-<label>.md). Shown once at the release review. */
export function repairNeedsBody({ label, askedFor = null, original, refusal = null, how = '', system = null, systemWhere = null }) {
  return `# Repair needed: ${label}\n\n${askedFor ? `${askedFor} wrote` : 'A seat wrote'} a reply to this stage that is almost JSON and could not be read. The reply was paid for and its words are all there; some brackets, braces, commas or quotes are wrong.\n\n`
    + `Return the original reply with its JSON punctuation corrected. You may edit only brackets, braces, commas, colons and quotation marks. Preserve every word in its original order. Return the reply without a code fence.\n\n`
    + `THC takes the repair only if, with the JSON punctuation and white space left out, it reads word for word like the original below. If it does not, the repair is set aside and this request stays.\n\n`
    + `Answer this request BEFORE you add or change a ruling, a criterion or the draft. The repair is held to the prompt the seat was asked; if that prompt changes before the run resumes, the repair is set aside, the seat is asked again and paid again.\n\n`
    + `${refusal ? `The last repair was not taken: ${refusal}\n\n` : ''}${how}## The original reply\n\n${original}\n${system ? `\n## The reply format the seat was given (${systemWhere ?? 'its system prompt; the long user prompt is left out'})\n\n${system}\n` : ''}`;
}
