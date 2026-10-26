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
import { loadPersonas } from './personas.js';
import { handoffPrompt } from './handoff-prompt.js';
import { ARGUED_SYSTEM } from './argued.js';
import { SECURITY_REVIEW_SYSTEM, SECURITY_REVIEW_LABEL } from './security-review.js';
export const labOf = seat => seat.lab || seat.provider;
export const noQuoteMarksOn = config => config?.debate_hygiene?.noQuoteMarks === true;
export const withHeldNote = (config, system, name) => { const text = noQuoteMarksOn(config) ? held(name)?.() : null; return text ? `${system}\n\n${text}` : system; };

export const PREFLIGHT_SYSTEM = `You review a task description before any code change is proposed against it. You never see, write, or evaluate a diff - only the text below. Your only job is to catch a task framing that would be unsafe or nonsensical to start building against: contradictory requirements, a missing or unnamed target, an acceptance test that cannot be satisfied as stated. Do not comment on style or completeness beyond that. Reply as JSON only: {"verdict": "pass" | "object", "objections": ["one sentence per real problem, empty if verdict is pass"]}`;

// 0.8.2 item 7: the ONE door every critic system prompt goes through, so a lane paragraph (src/lanes.js) can never be applied at some call sites and missed at others (a source-scan test fails on a bare
// R.criticSystem( anywhere else in this file). A seat with no lane gets R.criticSystem's text unchanged.
// Item 28 (Muad's yes 7 Oct 2026 via C&C): in a chain with "selfReview": "allowed", the critic seat that wrote the draft gets the self-review opening (R.criticSystem's `selfReview`).
export function criticPromptFor(seat, open, opts, config) {
  const self = config?.selfReview === 'allowed' && isWriterSeat(seat, config.seats);
  const o = self ? { ...(opts || {}), selfReview: true } : opts;
  return withLane(seat, o === undefined ? R.criticSystem(open) : R.criticSystem(open, o));
}

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
const reviserTexts = config => {
  const { open, answerBackOn, promptOpts } = settingsOf(config);
  return BOOL.flatMap(fenced => BOOL.flatMap(member => (config.revise?.mode === 'patch' ? BOOL : [false]).map(patch => withSplitNote(member, reviserSystemFor(answerBackOn, patch)(open, fenced, promptOpts), 'treeSplitWriterNote'))));
};
const replyTexts = (config, name, fn) => BOOL.map(g => withHeldNote(config, fn(g), name));

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
  [/^build$/, config => { const { open, promptOpts } = settingsOf(config); return BOOL.map(m => withSplitNote(m, R.builderSystem(open, promptOpts), 'treeSplitWriterNote')); }],
  [/^deep-dive-revise$/, config => reviserTexts(config)],
  [/^deep-dive-/, () => R.DEEP_DIVE_JOBS.map(j => R.deepDiveSystem(j))],
  [/^(panel|critique)-/, (config, seat) => { const { open } = settingsOf(config); return BOOL.map(k => criticPromptFor(seat, open, { ...(config.freedoms || null), fencedSource: true, ...(k ? { criteriaKinds: true } : {}) }, config)); }],
  [/^revise-/, config => reviserTexts(config)],
  [/^conflict(-|$)/, () => { const t = held('conflictDeciderSystem')?.(); return t ? [t] : []; }],
  [/^dispute-review-/, () => [R.DISPUTE_REVIEW_SYSTEM]],
  [/^dispute$/, () => [R.DISPUTE_SYSTEM]],
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
