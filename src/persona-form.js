// The persona form for ONE run (0.8.4; Muad 11 Nov 2026: "the voices should have a switch if people want to use them on other chains too"; his pick: "Add a run-time switch too").
// A chain file says how its named seats are told their names: `seat_personas: { enabled: true, form: "title" | "voice" }` (src/judge-persona.js). This module is the per-run choice over that key: the CLI start line's
// `--persona-form title|voice` and the MCP tools' `persona_form` argument (start_run, dry_run) name the form the run uses, for this run only, on a chain that already switches `seat_personas` on. Nothing here turns the switch
// on, and nothing here calls a model, reads a file or a clock. The pattern is `--zero-retention` and `--ladder`: one place for the decision and the words, used by src/cli.js and src/mcp/server.js.
//
// THE DECISION (decidePersonaForm). The form in force is the overlay of the chain's own `seat_personas.form`, so every reader of that key (the lint, the pre-flight list, the estimate, the prompts, the report's `seat_personas.form`)
// sees the chosen form and none of them knows a flag exists. State: run.json `persona_form` ('title' or 'voice') is written only when the choice was typed at a START, so a run started without the setting has no such key and a
// run.json that has none reads exactly as before. A resume that types nothing keeps the saved form; a resume that types the form the run uses is accepted and records nothing; a resume that types the OTHER form is refused before
// anything is sent (a run never changes form part-way: the stages it already wrote carry the first form's text). The setting is refused where it would change nothing (a chain that does not switch `seat_personas` on, or whose seats carry
// no persona), never ignored. The lint's own refusals still hold under the chosen form (a proposer's `role.persona` under `voice` is `seat-persona-role-under-voice`), because the overlay is applied before the chain is linted.
//
// WHAT IS HELD. Before the one wording review the voice sentences are held (src/held-roles.js): the form is recorded and the prompts follow whatever is recorded at the time, as they do for a chain file that says `voice`. The sentences of THIS
// file are A-DRAFT until the owner approves them (WORDING_0.8.4.md, rows PF-w1 to PF-w8, docs PF-d1 to PF-d3); they are constants here, apart from every text the apply rewrites by exact string.
import { PERSONA_SWITCH, PERSONA_FORMS, personaOf } from './judge-persona.js';
import { SIDE_COMMAND_WORDS, SIDE_OPTIONS } from './excerpt-approval.js';

/** The command line's spelling and the MCP argument's, the two places a person types the setting. */
export const PERSONA_FORM_FLAG = '--persona-form';
export const PERSONA_FORM_ARGUMENT = 'the persona_form argument';
const NOTHING = 'Nothing was started and nothing was spent.';

const FORMS_TEXT = PERSONA_FORMS.join(' or ');
const shown = v => JSON.stringify(String(v).slice(0, 40));

// ---- every sentence this file adds, A-DRAFT (WORDING_0.8.4.md PF-w1 .. PF-w7) ----
/** PF-w1: the bare flag. */
export const personaFormNeedsValueSentence = source => `${source} needs a value: ${FORMS_TEXT}. ${NOTHING}`;   // A-DRAFT
/** PF-w2: a value that is not a form. */
export const personaFormNotAFormSentence = (source, value) => `${source}: ${shown(value)} is not a seat form. Use ${FORMS_TEXT}. ${NOTHING}`;   // A-DRAFT
/** PF-w3: a chain on which the setting would change nothing. */
export const personaFormNoSwitchSentence = source => `${source} would change nothing on this chain: it does not switch seat_personas on, or none of its seats has a persona. ${NOTHING}`;   // A-DRAFT
/** PF-w4: a resume that types the other form. `used` is the form the run uses, `typed` the one asked for. */
export const personaFormResumeSentence = (source, typed, used) => `${source} ${typed}: this run uses the ${used} form, and a run keeps the form it began with, because the stages it already wrote carry that form's text. ${NOTHING}`;   // A-DRAFT
/** PF-w5: the start screen's and the dry run's line, printed only when the run's form is not the chain file's. */
export const personaFormLineSentence = (form, fileForm) => `Seat personas: the ${form} form for this run (the chain file says ${fileForm}).`;   // A-DRAFT

/** PF-w8: the flag typed on something that is not a start or a resume of a council run (`what` names it). */
export const personaFormSideSentence = what => `--persona-form: it sets the form of a council run you start or resume, so on ${what} it would change nothing. Nothing was run and nothing was spent.`;   // A-DRAFT

/** The MCP tools' description of the argument (PF-w6; one constant for start_run and dry_run). */
export const PERSONA_FORM_ARGUMENT_DESCRIPTION = 'title or voice: whether every named seat of the chain is given its title or its voice for this run (the CLI\'s --persona-form). The chain must already switch seat_personas on, or the call is refused. Left out: the chain\'s own form. A resume keeps the form its run began with.';   // A-DRAFT

/** The `council --help` lines for the flag (PF-w7), printed beside the start line's own entry. */
export const PERSONA_FORM_HELP_LINES = [
  '  council --task tasks/example.md --chain <name> --persona-form title|voice',
  '                                       gives every named seat its title or its voice, for this run only',
  '                                       (the chain must already switch seat_personas on); a resume keeps the',
  '                                       form the run began with',
];   // A-DRAFT

const switchedOn = config => config?.[PERSONA_SWITCH]?.enabled === true;
const hasNamedSeat = config => [...(Array.isArray(config?.seats?.critics) ? config.seats.critics : []), ...(Array.isArray(config?.seats?.proposers) ? config.seats.proposers : [])].some(s => personaOf(s) !== null);
/** The form the chain file itself names, or null when the switch is off (the value is read as written; a bad file value is the lint's to refuse). */
export const chainFileFormOf = config => (switchedOn(config) ? (config[PERSONA_SWITCH].form ?? null) : null);

/**
 * The per-run form.
 *   config   the chain as its file says (never changed here)
 *   typed    what the person typed: undefined (nothing), true (a bare flag), or the value
 *   source   how the sentences name the setting (PERSONA_FORM_FLAG or PERSONA_FORM_ARGUMENT)
 *   saved    run.json `persona_form` of the run being resumed (undefined or null when it has none)
 *   resumed  true when the command continues an existing run
 * -> { refusal: sentence | null, config, form, fileForm, changed, record }
 *   config  the chain with seat_personas.form overlaid (the same object when nothing changes)
 *   form    the form in force when this module decided one (the chosen or saved form), else null
 *   fileForm the form the chain file names (null when its switch is off)
 *   changed true when that form is not the one the chain file names (the start screen says so)
 *   record  true when run.json should now carry `persona_form` (a typed choice at a start)
 */
export function decidePersonaForm(config, { typed, source = PERSONA_FORM_FLAG, saved = null, resumed = false } = {}) {
  const none = { refusal: null, config, form: null, fileForm: chainFileFormOf(config), changed: false, record: false };
  const savedForm = PERSONA_FORMS.includes(saved) ? saved : null;
  if (typed === undefined) {
    // nothing typed: a saved form is the run's own and is applied again (only while the chain still switches the setting on; a chain edited since is the person's to see, not ours to re-enable)
    if (!resumed || savedForm === null || !switchedOn(config)) return none;
    return overlay(config, savedForm, { record: false });
  }
  if (typed === true) return { ...none, refusal: personaFormNeedsValueSentence(source) };
  if (typeof typed !== 'string' || !PERSONA_FORMS.includes(typed)) return { ...none, refusal: personaFormNotAFormSentence(source, typed) };
  if (!switchedOn(config) || !hasNamedSeat(config)) return { ...none, refusal: personaFormNoSwitchSentence(source) };
  if (resumed) {
    const used = savedForm ?? chainFileFormOf(config);
    if (used !== null && typed !== used) return { ...none, refusal: personaFormResumeSentence(source, typed, used) };   // a chain file with no form at all is the lint's to refuse (judge-personas: invalid-seat-personas-config), not this sentence's
    return overlay(config, typed, { record: false });
  }
  return overlay(config, typed, { record: true });
}

function overlay(config, form, { record }) {
  const fileForm = chainFileFormOf(config);
  return { refusal: null, config: form === fileForm ? config : { ...config, [PERSONA_SWITCH]: { ...config[PERSONA_SWITCH], form } }, form, fileForm, changed: form !== fileForm, record };
}

/** The start screen's and the dry run's lines for the decision: one line when the form in force differs from the chain file's, else none. */
export const personaFormLines = decision => (decision?.changed ? [personaFormLineSentence(decision.form, decision.fileForm ?? 'none')] : []);

/**
 * The flag is on the one list of known options, so every command would accept it and ignore it (the `--dry` lesson, as for `--approve-excerpts`): it is refused on every command that is not a start or a resume of a council run, with the lists of src/excerpt-approval.js
 * (test/excerpt-approval.test.js derives them from the dispatches of src/cli.js, so a new command or side option cannot be missed). `args` is the command line after the program name; -> a sentence or null.
 */
export function personaFormFlagRefusal(args) {
  if (!Array.isArray(args) || !args.includes(PERSONA_FORM_FLAG)) return null;
  const what = SIDE_COMMAND_WORDS.includes(args[0]) ? `\`${args[0]}\`` : SIDE_OPTIONS.find(o => args.includes(o));
  return what ? personaFormSideSentence(what) : null;
}
