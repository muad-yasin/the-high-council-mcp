// The ONE place the system text of a stage is composed when more than a roles.js constant is involved (0.8.3 estimator unit, C&C thcmcp-6d ruling "B-narrow", 19 Okt 2026): chain.js sends these texts and
// src/cost.js (estimateChainRows) prices them, so the upper estimate counts the system text invoke() will really project (cost.js worstCaseOf: system + user characters / 4). Nothing here changes a byte a seat is
// sent: the functions below were moved out of src/chain.js unchanged (test/prompt-pin, held-prompts and the goldens are the proof).
//
// Contract:
//   labOf, modelIdentity, seatIdentity, isWriterSeat, criticPromptFor, PREFLIGHT_SYSTEM   moved from src/chain.js (chain.js re-exports them: every importer is unchanged)
//   noQuoteMarksOn(config), withHeldNote(config, system, name), withSplitNote(treeMember, system, name), reviserSystemFor(answerBackOn, patch)   the wrappers chain.js applies at its call sites
//   settingsOf(config) -> { open, guard, answerBackOn, promptOpts }   the four values chain.js derives from the config for every prompt (the same expressions, now one function)
//   systemTextsFor(label, config, seat) -> string[]   every system text the row `label` can send (each flag the config leaves open to the run: a quoted source, a tree member, a criteria check, a patch revise);
//                                                    the estimator prices the LONGEST. [] only for a row that has its own system pricing (the advise rows). An unknown label THROWS: a row without a rule is a bug.
import * as R from './roles.js';
import { held } from './held-roles.js';
import { withLane } from './lanes.js';
import { applySeatRole } from './seat-role.js';
import { personaOf, PERSONA_FORMS } from './judge-persona.js';
import { loadPersonas } from './personas.js';
import { handoffPrompt } from './handoff-prompt.js';
import { ARGUED_SYSTEM } from './argued.js';
import { SECURITY_REVIEW_SYSTEM, SECURITY_REVIEW_LABEL } from './security-review.js';
export const labOf = seat => seat.lab || seat.provider;
export const noQuoteMarksOn = config => config?.debate_hygiene?.noQuoteMarks === true;
/** TAGS SHOWN (A-DRAFT): under the chain's severity switch the writer's revise and dispute prompts say once what the number on an objection is (roles.js SEVERITY_WRITER_SENTENCE). Without the switch: the system text unchanged. */
/** The dispute stage's system text: with the severity switch it is edited (milestone 2, A-DRAFT) and, when a final read follows (final_read on, layered), says so. Same text for the call and for the estimator's row. */
export const disputeSystemFor = config => withSeveritySentence(config, R.DISPUTE_SYSTEM, 'dispute');
export const withSeveritySentence = (config, system, kind = 'reviser') => {
  if (config?.severity?.enabled !== true) return system;
  const finalRead = kind === 'dispute' && config.final_read?.enabled === true && Array.isArray(config.seats?.critics) && config.seats.critics.length > 0 && config.seats.critics.every(c => c.layer !== undefined);
  return `${R.severityWriterEdits(system, kind, { finalRead })}\n\n${R.SEVERITY_WRITER_SENTENCE}`;
};
export const withHeldNote = (config, system, name) => { const text = noQuoteMarksOn(config) ? held(name)?.() : null; return text ? `${system}\n\n${text}` : system; };

export const PREFLIGHT_SYSTEM = `You review a task description before any code change is proposed against it. You never see, write, or evaluate a diff - only the text below. Your only job is to catch a task framing that would be unsafe or nonsensical to start building against: contradictory requirements, a missing or unnamed target, an acceptance test that cannot be satisfied as stated. Do not comment on style or completeness beyond that. Reply as JSON only: {"verdict": "pass" | "object", "objections": ["one sentence per real problem, empty if verdict is pass"]}`;

// 0.8.2 item 7: the ONE door every critic system prompt goes through, so a lane paragraph (src/lanes.js) can never be applied at some call sites and missed at others (a source-scan test fails on a bare
// R.criticSystem( anywhere else in this file). A seat with no lane gets R.criticSystem's text unchanged.
// Item 28 (Muad's yes 7 Oct 2026 via C&C): in a chain with "selfReview": "allowed", the critic seat that wrote the draft gets the self-review opening (R.criticSystem's `selfReview`).
/** Can the chain's TOP layer be shown an objection ledger (src/chain.js ledgerOn: a layered chain with answer_back and at least two layers)? Only then can a layer-3 re-tag lower a rating, so only then does the told sentence say so. */
/** Can the handler session re-tag on this chain (B3 prep, JUDGE 4b)? `council retag-add` works at a revise pause, which only a reviser seat of provider "external" has (the handler session is that reviser). Only then does the told sentence say "or the handler". */
export function severityHandlerPossible(config) {
  const reviser = config?.seats?.reviser || config?.seats?.builder;
  return config?.severity?.enabled === true && reviser?.provider === 'external';
}
export function severityLedgerPossible(config) {
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  const layered = critics.length > 0 && critics.every(c => c.layer !== undefined);
  return layered && config?.answer_back?.enabled === true && new Set(critics.map(c => c.layer)).size >= 2;
}
export function criticPromptFor(seat, open, opts, config) {
  const self = config?.selfReview === 'allowed' && isWriterSeat(seat, config.seats);
  const o = self ? { ...(opts || {}), selfReview: true } : opts;
  // B3 prep (unit V): the severity flag comes from the CHAIN's switch only, set after the user's freedoms are read; a `severity` in a user's freedoms asks for nothing (unit 2 would drop the tags it got).
  const sevOn = config?.severity?.enabled === true;
  const own = o && ('severity' in o || 'severityLedger' in o || 'severityHandler' in o) ? (({ severity, severityLedger, severityHandler, ...rest }) => rest)(o) : o;
  const o2 = sevOn ? { ...(own || {}), severity: true, ...(severityLedgerPossible(config) ? { severityLedger: true } : {}), ...(severityHandlerPossible(config) ? { severityHandler: true } : {}) } : own;
  return withLane(seat, personaSystemFor(seat, o2 === undefined ? R.criticSystem(open) : R.criticSystem(open, o2), config));
}

// B3 prep (JUDGE lane, unit P; C&C ruling 1 Nov 2026). A judge's persona (chain switch `judge_personas`, seat field `persona`) is composed in ONE place. withJudgePersona is the only function that inserts the block and personaSystemFor
// is its only caller; criticPromptFor (the verdict prompt) and layerDebateSystemFor / layerReplySystemFor (the two exchange prompts) are the only callers of personaSystemFor. test/stage-isolation.test.js pins all of it. The block goes
// directly before the prompt's own reply-format sentence, found by text; a missing or doubled sentence throws, so switch-off bytes can never be touched and a template change cannot slip the block to the wrong place.
const REPLY_FORMAT_ANCHOR = 'Reply with a single JSON object and nothing else:';
function withJudgePersona(system, name, form, nameOnly) {
  const at = system.indexOf(REPLY_FORMAT_ANCHOR);
  if (at === -1 || system.indexOf(REPLY_FORMAT_ANCHOR, at + 1) !== -1) throw new Error('a judge prompt must carry its reply-format sentence exactly once for the persona block to be placed before it');
  return `${system.slice(0, at)}${R.judgePersonaBlock({ name, form, nameOnly })}\n\n${system.slice(at)}`;
}
export function personaSystemFor(seat, system, config) {
  const cfg = config?.judge_personas;
  if (cfg?.enabled !== true) return system;
  const name = personaOf(seat);
  if (name === null) return system;
  if (!PERSONA_FORMS.includes(cfg.form)) throw new Error(`judge_personas.form must be one of ${PERSONA_FORMS.join(', ')}, not ${JSON.stringify(cfg.form)}`);
  const nameOnly = (Array.isArray(cfg.name_only) ? cfg.name_only : []).some(n => String(n).trim().toLowerCase() === name.trim().toLowerCase());
  return withJudgePersona(system, name, cfg.form, nameOnly);
}
export const layerDebateSystemFor = (config, seat, again) => personaSystemFor(seat, R.layerDebateSystem(again, config?.severity?.enabled === true ? { severity: true, ...(severityLedgerPossible(config) ? { severityLedger: true } : {}), ...(severityHandlerPossible(config) ? { severityHandler: true } : {}) } : null), config);
export const layerReplySystemFor = (config, seat, again) => personaSystemFor(seat, R.layerReplySystem(again, config?.severity?.enabled === true ? { severity: true } : null), config);

// The model a seat actually runs, provider prefix and :variant dropped, so `anthropic/claude-sonnet-5` on OpenRouter and `claude-sonnet-5` direct are one model. Mock and external seats
// have no real model identity (mock chains reuse names on purpose), so they return null and never match. (Moved here from src/chain-lint.js, which re-exports it.)
export function modelIdentity(seat) {
  if (!seat?.model || seat.provider === 'mock' || seat.provider === 'external') return null;
  return String(seat.model).toLowerCase().split('/').pop().split(':')[0];
}
// Who a seat is, for "is this the same agent": its model identity, or for an external seat its model string (a writer and a critic that name the same session,
// "claude-code-session", are the same agent: audit fix cnc-chains-lint F1). One rule for chain-lint's self-review check and for the writer's critic prompt.
export const seatIdentity = seat => modelIdentity(seat) ?? (seat?.provider === 'external' && seat.model ? `external:${String(seat.model).toLowerCase()}` : null);
/** True when this critic seat is the plan's writer (the builder's or the reviser's lab, or the same model / session under another lab label). */
export function isWriterSeat(seat, seats) {
  return ['builder', 'reviser'].some(k => {
    const w = seats?.[k];
    if (!w || !seat) return false;
    if (labOf(w) === labOf(seat)) return true;
    const id = seatIdentity(w);
    return id !== null && id === seatIdentity(seat);
  });
}

export const settingsOf = config => ({
  open: config.scope === 'open',
  guard: config.majority_guard?.enabled === true,
  answerBackOn: config.answer_back?.enabled === true,
  // `kinds` (criteria_kinds.enabled) was added to this object by chain.js after it was made and before any prompt used it: the same object, one place now
  promptOpts: { decisions: config.decisions?.enabled === true || config.alternatives?.enabled === true, ...(config.criteria_kinds?.enabled === true ? { kinds: true } : {}) },
});
// The debate stage's system text: the persona text of a seat's role (src/seat-role.js applySeatRole; its ONE call site, test/stage-isolation.test.js) and the held quote rule. chain.js sends it and the estimator prices it.
export const debateSystemFor = (config, seat) => withHeldNote(config, applySeatRole(R.DEBATE_SYSTEM, seat?.role, loadPersonas()), 'debatePostQuoteRule');
export const withSplitNote = (treeMember, system, name) => { const text = treeMember ? held(name)?.() : null; return text ? `${system}\n\n${text}` : system; };
export const reviserSystemFor = (answerBackOn, patch) => (answerBackOn ? held(patch ? 'patchReviserSystemWithIds' : 'reviserSystemWithIds') : undefined) ?? (patch ? R.patchReviserSystem : R.reviserSystem);

const BOOL = [false, true];
// The writer's reviser text over what a run decides later: a quoted source in the request (fenced), a tree member, the patch mode. The longest of them is what the estimate prices.
const reviserTexts = (config, sev = true) => {
  const { open, answerBackOn, promptOpts } = settingsOf(config);
  return BOOL.flatMap(fenced => BOOL.flatMap(member => (config.revise?.mode === 'patch' ? BOOL : [false]).map(patch => { const t = withSplitNote(member, reviserSystemFor(answerBackOn, patch)(open, fenced, promptOpts), 'treeSplitWriterNote'); return sev ? withSeveritySentence(config, t) : t; })));
};
const replyTexts = (config, name, fn) => BOOL.map(g => withHeldNote(config, fn(g), name));

// The system text of a FINAL-READ call (unit D, src/final-read.js): the seat's panel text for the same request, without the freedoms the stage does not honour
// (a stated pass, a blocking question). chain.js sends it and systemTextsFor prices it from this one function; the four variants are what a run decides later.
export const finalReadSystemFor = (seat, config, { fencedSource = false, criteriaKinds = false } = {}) =>
  criticPromptFor(seat, settingsOf(config).open, { fencedSource: !!fencedSource, ...(criteriaKinds ? { criteriaKinds: true } : {}) }, config);

/** Rules by row label, first match wins. Each returns the list of system texts that row's call can send. */
const RULES = [
  [/^advise-/, () => []],                                                       // the advise rows add their own system text (src/cost.js adviseRows)
  [/^ambiguity-/, () => [R.AMBIGUITY_SYSTEM]],
  [/^preflight-/, () => [PREFLIGHT_SYSTEM]],
  [/^questions$/, () => [R.QUESTIONS_SYSTEM]],
  [/^criteria$/, config => { const { open, promptOpts } = settingsOf(config); return BOOL.map(f => R.criteriaSystem(open, f, promptOpts)); }],
  [/^alternative-/, () => [R.ALTERNATIVE_SYSTEM]],
  [/^alt-debate-/, config => [withHeldNote(config, R.ALT_DEBATE_SYSTEM, 'debatePostQuoteRule')]],
  [/^alt-reply-/, config => replyTexts(config, 'noQuoteGloss', R.altReplySystem)],
  [/^skeleton$/, () => [R.SKELETON_SYSTEM]],
  [/^propose-/, config => [R.proposerSystem(settingsOf(config).open)]],
  [/^judge-/, () => [R.JUDGE_SYSTEM]],
  [/^canary-reply-/, config => replyTexts(config, 'noQuoteGloss', R.replySystem)],
  [/^debate-/, (config, seat) => [debateSystemFor(config, seat)]],
  [/^reply-/, config => replyTexts(config, 'noQuoteGloss', R.replySystem)],
  [/^ldebate-/, (config, seat) => BOOL.map(again => layerDebateSystemFor(config, seat, again))],   // both rounds: the later-round text is longer, and the persona block (if any) rides on both   // B2 (debate-084/b2): the exchange inside layer 1
  [/^lreply-/, (config, seat) => BOOL.map(again => layerReplySystemFor(config, seat, again))],
  [/^build$/, config => { const { open, promptOpts } = settingsOf(config); return BOOL.map(m => withSplitNote(m, R.builderSystem(open, promptOpts), 'treeSplitWriterNote')); }],
  [/^deep-dive-revise$/, config => reviserTexts(config, false)],   // the deep dive's findings carry no severity, so its revise prompt carries no sentence about one
  [/^deep-dive-/, () => R.DEEP_DIVE_JOBS.map(j => R.deepDiveSystem(j))],
  [/^final-read-/, (config, seat) => BOOL.flatMap(f => BOOL.map(k => finalReadSystemFor(seat, config, { fencedSource: f, criteriaKinds: k })))],
  [/^(panel|critique)-/, (config, seat) => { const { open } = settingsOf(config); return BOOL.map(k => criticPromptFor(seat, open, { ...(config.freedoms || null), fencedSource: true, ...(k ? { criteriaKinds: true } : {}) }, config)); }],
  [/^revise-/, config => reviserTexts(config)],
  [/^conflict(-|$)/, () => { const t = held('conflictDeciderSystem')?.(); return t ? [t] : []; }],
  [/^dispute-review-/, () => [R.DISPUTE_REVIEW_SYSTEM]],
  [/^dispute$/, config => [disputeSystemFor(config)]],
  [/^claims$/, () => [R.CLAIM_EXTRACTION_SYSTEM]],
  [/^challenge-revise$/, config => reviserTexts(config)],
  [/^challenge$/, () => [R.CHALLENGE_SYSTEM]],
  [/^cold-read$/, () => [R.COLD_READ_SYSTEM]],
  [/^final$/, () => [R.FINALIST_SYSTEM]],
  [/^handoff$/, config => BOOL.map(member => handoffPrompt({ config, request: '', draft: '', treeMember: member }).system)],
  [/^notes-answer$/, () => { const t = held('reviewNotesAnswer')?.({ rows: [], standaloneSystem: true }); return typeof t === 'string' ? [t] : []; }],
  [/^argued$/, () => [ARGUED_SYSTEM]],
  [new RegExp(`^${SECURITY_REVIEW_LABEL}$`), () => [SECURITY_REVIEW_SYSTEM]],
];
export function systemTextsFor(label, config, seat) {
  const rule = RULES.find(([re]) => re.test(label));
  if (!rule) throw new Error(`estimateChainRows: the row "${label}" has no system-text rule (src/stage-system.js RULES): add one, so the estimate counts the text invoke() will send`);
  return rule[1](config, seat);
}
