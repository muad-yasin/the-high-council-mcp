// Judge personas (B3 prep, JUDGE lane, unit P): the pure parts. A judge seat may carry a `persona`, a bare name string; with the chain switch `judge_personas: { enabled, form, name_only }` the judge's own system prompts (the verdict
// prompt and the two layer-exchange prompts) get a block naming it, placed after the grading rules and before the reply format (src/stage-system.js personaSystemFor; the words are in src/roles.js judgePersonaBlock, all A-DRAFT).
// Nothing here calls a model, reads a clock or a file.
//
// THE NAME IS A BARE STRING. It is never looked up in src/personas.js (the debate stage's shipped voices: a seat named "noah" must not pull in a voice the brief bans for judges). It goes raw into a system prompt, so it is linted:
// letters, spaces, hyphens and apostrophes only, 1 to 40 characters, no leading or trailing space, no line break, no "#".
// THE LIVING-PERSON RULE is data: `name_only` lists names that get only the name-only line in BOTH forms (no voice frame, no method line, no views); the protection is config, so a living name missing from the list gets the voice frame.
// THE RECORD (report.json `judge_personas`, additive, never required): { enabled, form, name_only, seats: [{ seat, layer, persona }], names_in_text: [{ where, seat, id?, pass?, name, own }] }. The detector COUNTS and never redacts:
// any persona name found in judge-written text (an objection, an exchange post, an answer, a sign-off objection) is a row, saying where, who wrote it and whether it is the author's own name (`own`) or another seat's. Quoted plan text
// (`quote` fields) is never counted. A name can be an ordinary word in a plan (Matthew), so a row is a lead, not a verdict.
import { seatKeyOf } from './seat-key.js';

export const PERSONA_FORMS = Object.freeze(['voice', 'method']);
export const PERSONA_NAME_MAX = 40;
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

/** The report section, or undefined when the switch is off. */
export function judgePersonasRecord(config, result) {
  const cfg = config?.judge_personas;
  if (cfg?.enabled !== true) return undefined;
  const seats = criticsOf(config).filter(c => personaOf(c) !== null).map(c => ({ seat: seatKeyOf(c), layer: c.layer ?? null, persona: c.persona }));
  const names = seats.map(s => s.persona);
  const personaOfSeat = new Map(seats.map(s => [s.seat, s.persona]));
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
  return { enabled: true, form: cfg.form, name_only: Array.isArray(cfg.name_only) ? [...cfg.name_only] : [], seats, names_in_text: rows };
}

/** chain-lint findings for the switch and the seat field (empty when the switch is off). */
export function lintJudgePersonas(config, filePath = 'the chain file') {
  const cfg = config?.judge_personas;
  const out = [];
  const add = (kind, message, fix) => out.push({ kind, message, fix });   // A-DRAFT (every message and fix: the words a person reads)
  // These two hold whether or not the switch is on: a persona somewhere it can never be read, and a seat that is both a debater and a judge, are mistakes in any chain (a silent no-op is refused, as the other seat fields are).
  for (const [slot, v] of Object.entries(config?.seats || {})) {
    if (slot === 'critics') continue;
    for (const s of Array.isArray(v) ? v : [v]) if (s && typeof s === 'object' && 'persona' in s) add('judge-persona-not-a-critic', `seats.${slot} has a "persona": a persona is read on judges (seats.critics) only, so it would silently do nothing here.`, `Remove "persona" from seats.${slot} in ${filePath}.`);
  }
  for (const c of criticsOf(config)) if (c && typeof c === 'object' && 'persona' in c && 'role' in c) add('judge-persona-with-role', 'a critic carries both "role" and "persona": "role" belongs to debating seats and "persona" to judges, and a seat is never both.', `Remove one of them from the critic in ${filePath}.`);
  if (cfg?.enabled !== true) return out;
  if (config.signoff !== 'unanimous') add('judge-personas-needs-unanimous', 'judge_personas.enabled is true but this chain does not set "signoff": "unanimous". Personas are written into the judges\' prompts only under unanimous sign-off, so in any other mode they would silently do nothing.', `Set "signoff": "unanimous" in ${filePath}, or remove judge_personas.`);
  if (cfg.form === undefined) add('invalid-judge-personas-config', `judge_personas.form is missing: it must be ${PERSONA_FORMS.map(f => `"${f}"`).join(' or ')}.`, `Set "judge_personas": { "enabled": true, "form": "voice" } in ${filePath} ("method" is the other form).`);
  const critics = criticsOf(config);
  const named = critics.filter(c => personaOf(c) !== null || (c && typeof c === 'object' && 'persona' in c));
  if (!named.length) add('judge-personas-no-persona', 'judge_personas.enabled is true but no critic carries a "persona": nothing would be written into any prompt.', `Give at least one critic a "persona" (a plain name) in ${filePath}, or remove judge_personas.`);
  const seen = new Map();
  for (const c of named) {
    const problem = personaNameProblem(c.persona);
    if (problem) { add('judge-persona-name', `seats.critics: ${problem}.`, `Use a plain name in ${filePath}.`); continue; }
    const k = lc(c.persona);
    if (seen.has(k)) add('judge-persona-duplicate', `two critics carry the persona "${c.persona}" (upper and lower case count as the same): the record could not tell them apart.`, `Give each critic its own persona in ${filePath}.`);
    seen.set(k, true);
  }
  for (const n of Array.isArray(cfg.name_only) ? cfg.name_only : []) if (!seen.has(lc(n))) add('judge-persona-name-only-unmatched', `judge_personas.name_only lists ${JSON.stringify(n)}, which matches no critic's persona (the whole name must match; upper and lower case count as the same): the entry does nothing, though it looks as if it did.`, `Remove it, or correct the spelling, in ${filePath}.`);
  return out;
}

/**
 * Notes (not findings) for a chain whose critics carry a `persona` while the switch `judge_personas` is not on: no persona is written into any prompt, so the config reads as a feature and does nothing. lintChain has no warning tier and
 * stays untouched; `council doctor --chain` prints these as WARNING: lines and the run path adds them to its pre-flight list (src/cli.js). Never fatal: toggling the switch stays one edit. -> [{ message }]
 */
export function judgePersonaWarnings(config) {
  if (config?.judge_personas?.enabled === true) return [];
  const names = criticsOf(config).map(personaOf).filter(n => n !== null && n !== '');
  if (!names.length) return [];
  // A-DRAFT (the words a person reads)
  return [{ message: `seats.critics carry a "persona" (${names.join(', ')}) but this chain does not switch "judge_personas" on, so no persona is written into any prompt; add "judge_personas": { "enabled": true, "form": "voice" } to use them ("method" is the other form), or remove "persona" to silence this warning.` }];
}
