// The per-seat persona record of report.json (0.8.4, lane C, unit 1; plan C's D5 on the built persona code). STAMPED WHEN THE PROMPT IS BUILT, not worked out afterwards:
//   - src/stage-system.js notes, on the SEAT, what a persona prompt carried at the moment it was built (debateSystemFor: the persona set it loaded, with its source, and the name it wrote; personaSystemFor: the name a judge's
//     prompt carried, or none). The note is a WeakMap on the seat object, like src/seat-key.js's SEAT_KEYS; nothing is read from the note by any prompt or decision.
//   - src/cli.js's onStage turns a finished stage row into a stamp (personaStampFor), puts it on the row (the same object chain.js hands to onStage and keeps in result.stages), and writes it into the stage's usage.json; a
//     replayed row gets its stamp back from its own usage.json (personaFieldsFromUsage), so a resume keeps what the sitting that made the call recorded.
//   - src/report-shape.js (personaRunFields) reads the rows and lifts the persona set to the run level.
// Nothing here calls a model or reads a clock. The only reads and writes of a file are in stampRow (the stage's own usage.json and prompt.json, in the run folder, written through the caller's atomic writer); the persona set
// itself is read only by debateSystemFor.
//
// Per stage row (plan C3: "every stage usage record and the report's matching stage row", null when there is none):
//   persona              the seat's configured persona: a judge's `persona` (a bare name, seats.critics) or a debating seat's `role.persona` (a key into the persona set, seats.proposers); null for any other row.
//   persona_name         the name the call's prompt actually carried; null when the prompt carried none (a judge's persona while the chain's seat_personas switch is off: configured, never sent).
//   persona_set_sha256   a debate row: the SHA-256 of the persona set that prompt was built from; null otherwise (a judge's name is a bare string that is never looked up in the set).
//   model_source         where the row's `model` comes from (src/answered-by.js modelSourceOf): 'provider' | 'declared' | 'undeclared'.
//   persona_set_source   (stored in usage.json, lifted to the run level in report.json, not kept on the report row) 'default' | 'file' | 'fallback' for a debate row that carried a set; null otherwise.
// Per run (src/report-shape.js), only when a debate prompt carried a persona set: personas_source and personas_sha256 (null when the rows that carried a set disagree: each row has its own), personas_used (the keys the debating seats name).
// A SESSION SEAT pauses the run and is answered later, in another process: at the pause cli.js writes the note of the prompt it just built (personaPauseNote, found by the stage label) into <label>.prompt.json; each time the answer is read back, the row is stamped from that note, so a persona file edited between the pause and the answer does not change the hash.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyOfRecord, seatKeyOf, repeatedLabsOf } from './seat-key.js';
import { modelSourceOf } from './answered-by.js';
import { resolvePersona } from './personas.js';
import { personaEntryUsable } from './seat-role.js';
import { personaOf } from './judge-persona.js';
import { blankHiddenChars } from './hidden-chars.js';
import { canonicalJson, sha256Of } from './thin-contract.js';

const SET_SOURCES = ['default', 'file', 'fallback'];
const MODEL_SOURCES = ['provider', 'declared', 'undeclared'];
// Row labels by the prompt they carry. JUDGE: src/stage-system.js criticPromptFor / layerDebateSystemFor / layerReplySystemFor (the verdict, the two exchange prompts, the final read's verdict prompt). DEBATE: debateSystemFor.
// PROPOSER: the other stages of a debating seat: propose-, reply- and canary-reply- (their prompts carry the seat's title once the words are recorded; src/stage-system.js proposerSystemFor, replySystemFor).
const JUDGE_ROW = /^(panel|critique|ldebate|lreply|final-read)-/;
const DEBATE_ROW = /^debate-/;
const PROPOSER_ROW = /^(propose|reply|canary-reply)-/;   // 0.8.4 H1-c: the canary reply is built by replySystemFor (src/chain.js), so its prompt carries the seat's title like a reply- prompt, and its row says so (the job is 'reply'; the seat key is the row's own lab)

// ---- the notes (written by stage-system.js while it builds a prompt) ----
// A prompt built to be PRICED (src/stage-system.js systemTextsFor, the estimator) is not a prompt sent: it must leave no note, or a row of a prompt that carried no title could read as one that did (the send path rebuilds the
// notes of the prompts it sends, but a prompt that was still built elsewhere than through the helpers would keep the estimator's note; since 0.8.4 H1-c propose-, reply- and canary-reply- are all built through them).
let noting = true;
/** Runs `fn` with the notes switched off (the estimator's scope); returns its value. */
export function withoutNotes(fn) { const was = noting; noting = false; try { return fn(); } finally { noting = was; } }
const DEBATE_NOTES = new WeakMap();   // seat -> { persona, persona_name, persona_set_sha256, persona_set_source } for the last debate prompt built for it
const TITLE_NOTES = new WeakMap();    // seat -> { propose, debate, reply } -> the title name the last such prompt carried (null: none) - a proposer's bare `persona`, held words (src/stage-system.js)
const JUDGE_NOTES = new WeakMap();    // seat -> { persona_name } for the last judge prompt built for it (null: the prompt carried no name)
const rolePersonaOf = seat => (typeof seat?.role?.persona === 'string' && seat.role.persona ? seat.role.persona : null);

/** Called by debateSystemFor with the set it used ({ set, source }). A seat with no persona key leaves no note. */
export function noteDebateBuild(seat, loaded) {
  if (!noting || !seat || typeof seat !== 'object') return;
  const key = rolePersonaOf(seat);
  if (key === null) { DEBATE_NOTES.delete(seat); return; }
  const entry = resolvePersona(key, loaded.set);
  // the name src/seat-role.js applySeatRole writes: the entry's name when the entry is complete, else the bare key
  DEBATE_NOTES.set(seat, { persona: key, persona_name: personaEntryUsable(entry) ? entry.name : key, persona_set_sha256: sha256Of(canonicalJson(loaded.set)), persona_set_source: loaded.source });
}
/**
 * The note of the debate prompt a stage `label` (debate-<seat key>) has just built, for the pause to write beside its NEEDS file, or null. The pause is thrown right after the prompt is built, in the same process, and a seat's
 * debate prompt is built once per stage, so the seat's latest note is that prompt's.
 */
export function personaPauseNote(label, config) {
  const m = typeof label === 'string' ? /^debate-(.+)$/.exec(label) : null;
  const seat = m ? proposerOfKey(config, m[1]) : null;
  return seat ? DEBATE_NOTES.get(seat) ?? null : null;
}
/** Called by the proposer-side prompt builders (src/stage-system.js proposerSystemFor, debateSystemFor, replySystemFor) with the job and the name the prompt carried (null when it carried none). */
export function noteTitleBuild(seat, job, name) {
  if (!noting || !seat || typeof seat !== 'object') return;
  const n = TITLE_NOTES.get(seat) ?? {};
  TITLE_NOTES.set(seat, { ...n, [job]: typeof name === 'string' ? name : null });
}
/** Called by personaSystemFor: the name the judge prompt it just built carries (null when the switch is off or the seat has none). */
export function noteJudgeBuild(seat, name) {
  if (noting && seat && typeof seat === 'object') JUDGE_NOTES.set(seat, { persona_name: typeof name === 'string' ? name : null });
}

// ---- the stamp ----
const seatsOf = (config, slot) => (Array.isArray(config?.seats?.[slot]) ? config.seats[slot] : []).filter(s => s && typeof s === 'object');
// A critics panel may repeat a model on different layers; its seats are then told apart by a key (src/seat-key.js). The key is worked out here from the panel itself, so the lookup does not depend on the seat objects
// having been registered by the run that built the report.
function criticOfKey(config, key) {
  const critics = seatsOf(config, 'critics');
  const derived = new Map();
  for (const r of repeatedLabsOf(critics)) if (r.keys) for (const [seat, k] of r.keys) derived.set(seat, k);
  return critics.find(s => (derived.get(s) ?? seatKeyOf(s)) === key) ?? null;
}
const proposerOfKey = (config, key) => seatsOf(config, 'proposers').find(s => seatKeyOf(s) === key) ?? null;

/** The stamp of ONE finished stage row: { persona, persona_name, persona_set_sha256, model_source, persona_set_source }. Every row gets one; most are null but for model_source. */
export function personaStampFor(row, config, { pauseNote = null } = {}) {
  const label = typeof row?.label === 'string' ? row.label : '';
  const key = keyOfRecord(row);
  const stamp = { persona: null, persona_name: null, persona_set_sha256: null, model_source: modelSourceOf(row), persona_set_source: null };
  if (JUDGE_ROW.test(label)) {
    const seat = criticOfKey(config, key);
    const persona = personaOf(seat);
    if (persona !== null) { stamp.persona = persona; stamp.persona_name = JUDGE_NOTES.get(seat)?.persona_name ?? null; }
  } else if (DEBATE_ROW.test(label) || PROPOSER_ROW.test(label)) {
    const seat = proposerOfKey(config, key);
    const persona = rolePersonaOf(seat) ?? personaOf(seat);   // a debating seat's voice key, or its bare title name (a seat carries one of them, never both)
    if (persona !== null) {
      stamp.persona = persona;
      const job = DEBATE_ROW.test(label) ? 'debate' : /^propose-/.test(label) ? 'propose' : 'reply';
      if (rolePersonaOf(seat) !== null) {
        // a session seat's row: the note the PAUSE wrote (the set its NEEDS prompt was built from); anything else: the seat's note from the prompt just built
        if (DEBATE_ROW.test(label)) { const n = pauseNote && pauseNote.persona === persona ? pauseNote : DEBATE_NOTES.get(seat); if (n && n.persona === persona) Object.assign(stamp, { persona_name: n.persona_name, persona_set_sha256: n.persona_set_sha256, persona_set_source: n.persona_set_source }); }
      } else {
        stamp.persona_name = TITLE_NOTES.get(seat)?.[job] ?? null;   // a title is a bare name: no set is read, so no hash and no source
      }
    }
  }
  return stamp;
}

// ---- the record in usage.json (project-writable data: read back clean, anything malformed reads as no stamp) ----
const text = (v, max) => (v === null ? null : typeof v === 'string' ? (blankHiddenChars(v).replace(/ +/g, ' ').trim().slice(0, max) || null) : undefined);
/** The stamp fields of a usage.json object, cleaned; null unless all of them are present and well-formed. */
export function personaFieldsFromUsage(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const persona = text(u.persona, 80), name = text(u.persona_name, 120);
  const sha = u.persona_set_sha256 === null || (typeof u.persona_set_sha256 === 'string' && /^[0-9a-f]{64}$/.test(u.persona_set_sha256)) ? u.persona_set_sha256 : undefined;
  const src = u.persona_set_source === null || SET_SOURCES.includes(u.persona_set_source) ? u.persona_set_source : undefined;
  const ms = MODEL_SOURCES.includes(u.model_source) ? u.model_source : undefined;
  if ([persona, name, sha, src, ms].some(v => v === undefined)) return null;
  return { persona, persona_name: name, persona_set_sha256: sha, model_source: ms, persona_set_source: src };
}
/** The stamp fields of a stage row, for the usage.json writer to spread: {} when the row carries no stamp (the key is absent, never half-written). */
export const personaUsageFields = row => personaFieldsFromUsage(row) ?? {};

/** A usage object with a malformed stamp removed (never written through); a valid or absent stamp is left as it is. */
export function scrubPersona(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u) || personaFieldsFromUsage(u)) return u;
  const { persona, persona_name, persona_set_sha256, model_source, persona_set_source, ...rest } = u;
  return rest;
}
/** The pause note a <label>.prompt.json holds, cleaned; null when it holds none or a malformed one. */
export function personaNoteFromPrompt(p) {
  const n = p && typeof p === 'object' ? p.persona_note : null;
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null;
  const persona = text(n.persona, 80), name = text(n.persona_name, 120);
  const ok = typeof persona === 'string' && typeof name === 'string' && typeof n.persona_set_sha256 === 'string' && /^[0-9a-f]{64}$/.test(n.persona_set_sha256) && SET_SOURCES.includes(n.persona_set_source);
  return ok ? { persona, persona_name: name, persona_set_sha256: n.persona_set_sha256, persona_set_source: n.persona_set_source } : null;
}

/**
 * What src/cli.js's onStage (and a side run's) does with every finished stage row. A live row is stamped from what its prompt carried; a replayed row gets back the stamp its own usage.json holds (a malformed one is
 * dropped). A replayed SESSION-seat row with no valid stamp in its file (a person's hand-written <label>.md has no usage file at all; MCP submit_stage writes one without a stamp) is stamped in every sitting: the debate set from
 * the note its pause wrote beside the NEEDS file (<label>.prompt.json), the rest from the prompt rebuilt in this sitting and the row itself. The stamp is written into the usage file only when one exists (it is never created:
 * src/spend.js counts a usage file with no readable `usd` as an unknown figure). Any other replayed row with no stamp in its file (a stage recorded before 0.8.4) stays without one.
 */
export function stampRow(s, config, { dir, write }) {
  if (!s || typeof s !== 'object') return;
  if (!s.cached) { Object.assign(s, personaStampFor(s, config)); return; }
  const pu = join(dir, `${s.label}.usage.json`);
  let u = null;
  try { u = JSON.parse(readFileSync(pu, 'utf8')); } catch { /* no usage file, or an unreadable one */ }
  const stored = personaFieldsFromUsage(u);
  if (stored) { Object.assign(s, stored); return; }
  if (s.provider !== 'external') return;
  let pauseNote = null;
  try { pauseNote = personaNoteFromPrompt(JSON.parse(readFileSync(join(dir, `${s.label}.prompt.json`), 'utf8'))); } catch { /* no pause note: the seat's note from the prompt rebuilt in this sitting is used */ }
  const stamp = personaStampFor(s, config, { pauseNote });
  Object.assign(s, stamp);
  if (u && typeof u === 'object' && !Array.isArray(u)) { try { write(pu, JSON.stringify({ ...scrubPersona(u), ...stamp })); } catch { /* the row keeps its stamp for this report; the file is left as it was */ } }
}

// ---- the report (src/report-shape.js) ----
/** { stages, run }: the stage rows without the stored-only `persona_set_source`, and the run-level set fields (or {}) lifted from the rows that carried a set. */
export function personaRunFields(stages, config) {
  const rows = Array.isArray(stages) ? stages : [];
  const withSet = rows.filter(r => typeof r?.persona_set_sha256 === 'string' && SET_SOURCES.includes(r.persona_set_source));
  const clean = rows.map(r => { if (r && typeof r === 'object' && 'persona_set_source' in r) { const { persona_set_source, ...rest } = r; return rest; } return r; });
  if (!withSet.length) return { stages: clean, run: {} };
  const agree = new Set(withSet.map(r => `${r.persona_set_source} ${r.persona_set_sha256}`)).size === 1;   // rows that name different sets: the run claims none (each row still has its own)
  const used = [...new Set(seatsOf(config, 'proposers').map(rolePersonaOf).filter(k => k !== null))];
  return { stages: clean, run: { personas_source: agree ? withSet[0].persona_set_source : null, personas_sha256: agree ? withSet[0].persona_set_sha256 : null, personas_used: used } };
}
