// Judge personas (B3 prep, JUDGE lane, unit P): the pure parts. A judge seat may carry a `persona`, a bare name string; with the chain switch `seat_personas: { enabled, form }` the judge's own system prompts (the verdict
// prompt and the two layer-exchange prompts) get a block naming it, placed after the grading rules and before the reply format (src/stage-system.js personaSystemFor; the words are in src/roles.js judgePersonaBlock, all A-DRAFT).
// Nothing here calls a model or reads a clock. The one file read is the persona SET behind lint rule 5b (judgePersonaWarnings): its default is loadPersonas(), which reads an operator's file only when COUNCIL_PERSONAS_FILE names one; a caller (or a test) passes the set in.
//
// THE NAME IS A BARE STRING. It is never looked up in src/personas.js (the debate stage's shipped voices: a seat named "noah" must not pull in a voice the brief bans for judges). It goes raw into a system prompt, so it is linted:
// letters, spaces, hyphens and apostrophes only, 1 to 40 characters, no leading or trailing space, no line break, no "#".
// NO RULE DEPENDS ON WHETHER THE PERSON BEHIND A NAME IS ALIVE (the 4 Nov 2026 heading "ONE RULE FOR EVERY NAME, ALIVE OR NOT", which follows the owner's 3 Nov 23:54 pick "A full voice" for Karpathy and Merkel): the chain key name_only that gave a listed name only the name-only line is gone; the recorded name-only sentence stays in src/prompts as frozen bytes until the release re-record.
// THE RECORD (report.json `seat_personas`, additive, never required): { enabled, form, seats: [{ seat, kind, layer, persona }], names_in_text: [{ where, seat, id?, pass?, name, own }] }. The detector COUNTS and never redacts:
// any persona name found in judge-written text (an objection, an exchange post, an answer, a sign-off objection) is a row, saying where, who wrote it and whether it is the author's own name (`own`) or another seat's. Quoted plan text
// (`quote` fields) is never counted. A name can be an ordinary word in a plan (Matthew), so a row is a lead, not a verdict.
import { seatKeyOf } from './seat-key.js';
import { loadPersonas, resolvePersona } from './personas.js';
import { personaEntryUsable } from './seat-role.js';

/** The name of the chain switch that governs every seat's persona and of the report section that records it (0.8.4: it was judges-only, as `judge_personas`, in no release). The one place the name is spelled in src/ code; the schemas, messages, docs and tests spell it out. */
export const PERSONA_SWITCH = 'seat_personas';
export const PERSONA_FORMS = Object.freeze(['title', 'voice']);   // the owner's rule: everyone has a title or everyone has the full voice (4 Nov 2026); the judges-only 'method' form is gone (C&C's word)
/** The jobs a seat title is written for (test/held-prompts/held-084-c.js seatTitleBlock): a judge's verdict and exchange prompts, a proposer's proposal, debate post and reply. */
export const TITLE_JOBS = Object.freeze(['judge', 'propose', 'debate', 'reply']);
export const PERSONA_NAME_MAX = 40;
/** The two names the shipped chain's top layer carries (plan-the-high-council, layer 3). Lint rule W5 reads them; no other code does. */
const TOP_LAYER_NAMES = Object.freeze(['Melchizedek', 'Karpathy']);
const NAME_RE = new RegExp(`^[A-Za-z][A-Za-z '’-]{0,${PERSONA_NAME_MAX - 1}}$`);

/** The raw persona string of a seat, or null (no such field). */
export const personaOf = seat => (seat && typeof seat === 'object' && typeof seat.persona === 'string' ? seat.persona : null);
/** Why a persona is not a usable name, or null. */
export function personaNameProblem(v) {
  if (typeof v !== 'string') return `a persona must be text, not ${v === null ? 'null' : `a ${typeof v}`}`;
  if (!NAME_RE.test(v) || v !== v.trim()) return `the persona ${JSON.stringify(v)} is not a plain name. A persona is letters, spaces, hyphens and apostrophes only, 1 to ${PERSONA_NAME_MAX} characters, with no leading or trailing space`;
  return null;
}
const lc = v => String(v).trim().toLowerCase();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which of `names` (as spelled in `names`) occur in `text` as whole words, any case. Order of `names`. */
export function personaNamesIn(text, names) {
  if (typeof text !== 'string' || !text || !Array.isArray(names)) return [];
  return names.filter(n => typeof n === 'string' && n && new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`, 'i').test(text));
}

const criticsOf = config => (Array.isArray(config?.seats?.critics) ? config.seats.critics : []);
const proposersOf = config => (Array.isArray(config?.seats?.proposers) ? config.seats.proposers : []);

/** The report section, or undefined when the switch is off. */
export function judgePersonasRecord(config, result) {
  const cfg = config?.[PERSONA_SWITCH];
  if (cfg?.enabled !== true) return undefined;
  // every seat that carries a name: the judges first (as before), then the proposers (layer null): the record shows each seat whose prompt can carry a name
  const of = (list, kind) => list.filter(c => personaOf(c) !== null).map(c => ({ seat: seatKeyOf(c), kind, layer: c.layer ?? null, persona: c.persona }));
  const seats = [...of(criticsOf(config), 'judge'), ...of(proposersOf(config), 'proposer')];
  const names = seats.map(s => s.persona);
  // who wrote a counted name: the scanned text is judge-written, so the map is the judges' (a proposer that shares a lab with a judge must not overwrite the judge's entry)
  const personaOfSeat = new Map(seats.filter(s => s.kind === 'judge').map(s => [s.seat, s.persona]));
  const rows = [];
  const scan = (text, where, seat, extra = {}) => { for (const name of personaNamesIn(text, names)) rows.push({ where, seat, ...extra, name, own: personaOfSeat.get(seat) === name }); };
  for (const d of Array.isArray(result?.layerDebates) ? result.layerDebates : []) {
    for (const o of d.objections || []) {
      const at = { id: o.id, pass: d.pass };
      scan(o.problem, 'objection', o.raised_by, at);
      for (const p of o.posts || []) scan(p.text, 'post', p.by, at);
      for (const r of o.replies || []) { scan(r.text, 'reply', o.raised_by, at); scan(r.problem, 'reply', o.raised_by, at); }
    }
  }
  for (const e of Array.isArray(result?.signoff) ? result.signoff : []) {
    for (const o of e.objections || []) { const at = { id: o.id }; const seat = e.seat ?? e.lab; scan(o.problem, 'signoff_objection', seat, at); scan(o.fix, 'signoff_objection', seat, at); }
  }
  return { enabled: true, form: cfg.form, seats, names_in_text: rows };
}

/** chain-lint findings for the switch and the seat field (empty when the switch is off). */
export function lintJudgePersonas(config, filePath = 'the chain file') {
  const cfg = config?.[PERSONA_SWITCH];
  const out = [];
  const add = (kind, message, fix) => out.push({ kind, message, fix });   // A-DRAFT (every message and fix: the words a person reads)
  // These hold whether or not the switch is on: a persona somewhere it can never be read, and a seat that is both a debater and a judge (or carries a title and a voice), are mistakes in any chain (a silent no-op is refused, as the other seat fields are).
  for (const [slot, v] of Object.entries(config?.seats || {})) {
    if (slot === 'critics' || slot === 'proposers') continue;
    for (const s of Array.isArray(v) ? v : [v]) if (s && typeof s === 'object' && 'persona' in s) add('judge-persona-not-a-critic', `seats.${slot} has a "persona": a persona is read on judges (seats.critics) and proposers (seats.proposers) only, so it would silently do nothing here.`, `Remove "persona" from seats.${slot} in ${filePath}.`);
  }
  for (const c of criticsOf(config)) if (c && typeof c === 'object' && 'persona' in c && 'role' in c) add('judge-persona-with-role', 'a critic carries both "role" and "persona": "role" belongs to debating seats and "persona" to judges, and a seat is never both.', `Remove one of them from the critic in ${filePath}.`);
  for (const p of proposersOf(config)) if (p && typeof p === 'object' && 'persona' in p && typeof p.role?.persona === 'string') add('seat-persona-with-role-persona', 'a proposer carries both "persona" (its title) and "role.persona" (a voice from the persona set): a seat has one or the other, never both.', `Remove one of them from the proposer in ${filePath}.`);
  if (cfg?.enabled !== true) return out;
  const formsText = PERSONA_FORMS.map(f => `"${f}"`).join(' or ');
  if (config.signoff !== 'unanimous') add('judge-personas-needs-unanimous', 'seat_personas.enabled is true but this chain does not set "signoff": "unanimous". The judges\' names are written into their prompts only under unanimous sign-off, so in any other mode a judge\'s persona would silently do nothing.', `Set "signoff": "unanimous" in ${filePath}, or remove seat_personas.`);
  if (cfg.form === undefined) add('invalid-seat-personas-config', `seat_personas.form is missing: it must be ${formsText}.`, `Set "seat_personas": { "enabled": true, "form": "title" } in ${filePath} ("voice" is the other form).`);
  const seats = [...criticsOf(config).map(s => ['critic', s]), ...proposersOf(config).map(s => ['proposer', s])];
  const named = seats.filter(([, c]) => personaOf(c) !== null || (c && typeof c === 'object' && 'persona' in c));
  if (!named.length) add('judge-personas-no-persona', 'seat_personas.enabled is true but no seat carries a "persona": nothing would be written into any prompt.', `Give at least one critic or proposer a "persona" (a plain name) in ${filePath}, or remove seat_personas.`);
  const seen = new Map();
  for (const [kind, c] of named) {
    const problem = personaNameProblem(c.persona);
    if (problem) { add('judge-persona-name', `seats.${kind === 'critic' ? 'critics' : 'proposers'}: ${problem}.`, `Use a plain name in ${filePath}.`); continue; }
    const k = lc(c.persona);
    if (seen.has(k)) add('judge-persona-duplicate', `two seats carry the persona "${c.persona}" (upper and lower case count as the same): the record could not tell them apart.`, `Give each seat its own persona in ${filePath}.`);
    seen.set(k, true);
  }
  // The owner's rule: everyone has a title or everyone has the full voice (4 Nov 2026). One switch, one form for the chain; a seat that would get something else is refused, never quietly given another form.
  if (cfg.form === 'title') {
    for (const p of proposersOf(config)) if (p && typeof p.role?.persona === 'string') add('seat-persona-voice-under-title', `a proposer's role.persona "${p.role.persona}" would give it a voice, but seat_personas.form is "title": a chain has titles for everyone or voices for everyone, not both.`, `Remove role.persona from the proposer (give it a "persona" for its title) in ${filePath}, or change the form.`);
  }
  if (cfg.form === 'voice') {
    // the voice is the seat's own persona for every job; a role.persona beside it is a second voice route (the debate stage only), and a chain has one
    for (const p of proposersOf(config)) if (p && typeof p.role?.persona === 'string') add('seat-persona-role-under-voice', `a proposer's role.persona "${p.role.persona}" is a second voice route (the debate stage only), but seat_personas.form is "voice" and gives every named seat its voice: the chain would have the seat speak twice.`, `Remove role.persona from the proposer (give it a "persona" for its voice) in ${filePath}, or use the form "title".`);
  }
  return out;
}

/**
 * Notes (not findings), 0.8.4 unit 5 (CHANGED ACCEPTED): three kinds. (1) `persona-unknown-key` (rule 5b) and (2) a one-seat top layer carrying a shipped top-layer name (W5) are reported whatever the switch says; (3) the older note below only while the switch is not on. The older note: a chain whose critics or proposers carry a `persona` while the switch `seat_personas` is not on: no persona is written into any prompt, so the config reads as a feature and does nothing. lintChain has no warning tier and
 * stays untouched; `council doctor --chain` prints these as WARNING: lines and the run path adds them to its pre-flight list (src/cli.js). Never fatal: toggling the switch stays one edit. -> [{ message, kind?, fix? }]; `personas` is the persona set (default loadPersonas()).
 */
export function judgePersonaWarnings(config, personas) {
  const out = [];
  // Rule 5b (plan C, 0.8.4): a debating seat's role.persona key that has no usable entry (a name AND a voice) in the persona set in use. The seat is told "You are arguing as <key>." with no voice behind it (src/seat-role.js applySeatRole). Debating seats are
  // the proposers (the critics when the chain has no proposers array) of a chain that runs proposals and a debate; the other seats are covered by lintJudgePersonas' rules 5 and 5a. With the switch ON a proposer's role.persona is already refused under both forms
  // (lintJudgePersonas), so proposers are skipped then to avoid a double report; critics that debate (a chain with no proposers) are not covered by that refusal, so they are reported with the switch on too. One finding per seat, shaped like the plan's W2: a `kind`,
  // the message, and the fix (cli.js prints `message` only, so the fix sentence is also the end of the message).
  if (config?.proposals && config?.debate) {
    const hasProposers = Array.isArray(config?.seats?.proposers);
    if (!(hasProposers && config?.[PERSONA_SWITCH]?.enabled === true)) {
      const slot = hasProposers ? 'proposers' : 'critics';
      const debaters = hasProposers ? config.seats.proposers : criticsOf(config);
      const set = personas ?? loadPersonas();
      const keys = Object.keys(set && typeof set === 'object' ? set : {}).filter(k => personaEntryUsable(resolvePersona(k, set)));
      debaters.forEach((seat, i) => {
        const key = seat?.role?.persona;
        if (typeof key !== 'string' || !key || personaEntryUsable(resolvePersona(key, set))) return;
        // A-DRAFT (the words a person reads)
        const message = `seats.${slot}[${i}] names the persona "${key}", which has no entry with both a name and a voice in the persona set in use, so this seat is sent "You are arguing as ${key}." with no voice.`;
        const fix = keys.length ? `Add an entry for "${key}" with a name and a voice to your persona file, or use one of: ${keys.join(', ')}.` : `Add an entry for "${key}" with a name and a voice to your persona file.`;
        out.push({ kind: 'persona-unknown-key', message: `${message} ${fix}`, fix });
      });
    }
  }
  // Rule W5 (plan C item C4): a person's own layered chain whose TOP layer holds ONE seat that carries one of the two shipped top-layer names. The harness assigns no name by position, so the seat keeps the key its author wrote and the other name goes unused; the run is
  // not refused. Gated on the shipped names so the sentence is true (a one-seat top layer with any other name says nothing about them). Three or more top seats say nothing (a seat beyond the second carries no name unless its author gives it one). The shipped chains are held by
  // a test of their own (two top seats), not by this warning. Does not depend on the switch: the names are `persona` fields either way.
  {
    const layered = criticsOf(config).filter(c => c && typeof c === 'object' && Number.isInteger(c.layer) && c.layer >= 1);
    const top = layered.length ? Math.max(...layered.map(c => c.layer)) : 0;
    const topSeats = layered.filter(c => c.layer === top);
    const named = topSeats.length === 1 ? TOP_LAYER_NAMES.find(n => lc(personaOf(topSeats[0]) ?? '') === lc(n)) : undefined;
    // A-DRAFT (the words a person reads)
    if (named) out.push({ message: `Layer ${top} holds one judge, carrying the persona ${named}, so the other top-layer name (${TOP_LAYER_NAMES.find(n => n !== named)}) is unused; the run still starts. Add a second judge seat to layer ${top} to use both.` });
  }
  if (config?.[PERSONA_SWITCH]?.enabled === true) return out;
  const names = [...criticsOf(config), ...proposersOf(config)].map(personaOf).filter(n => n !== null && n !== '');
  if (!names.length) return out;
  // A-DRAFT (the words a person reads)
  out.push({ message: `seats carry a "persona" (${names.join(', ')}) but this chain does not switch "seat_personas" on, so no persona is written into any prompt; add "seat_personas": { "enabled": true, "form": "title" } to use them ("voice" is the other form), or remove "persona" to silence this warning.` });
  return out;
}
