// The ONE place the system text of a stage is composed when more than a roles.js constant is involved (0.8.3 estimator unit, C&C thcmcp-6d ruling "B-narrow", 19 Okt 2026): chain.js sends these texts and
// src/cost.js (estimateChainRows) prices them, so the upper estimate counts the system text invoke() will really project (cost.js worstCaseOf: system + user characters / 4). Nothing here changes a byte a seat is
// sent: the functions below were moved out of src/chain.js unchanged (the held-prompts tests are the proof).
//
// Contract:
//   labOf, modelIdentity, seatIdentity, isWriterSeat, criticPromptFor, PREFLIGHT_SYSTEM   moved from src/chain.js (chain.js re-exports them: every importer is unchanged)
//   noQuoteMarksOn(config), withHeldNote(config, system, name), withSplitNote(treeMember, system, name), reviserSystemFor(answerBackOn, patch) (returns (open, fenced, opts) => the reviser's system text, with the excerpt clause of 0.8.4 H8)   the wrappers chain.js applies at its call sites
//   builderSystemOf(open, promptOpts)   R.builderSystem plus the drafted items of the builder's Rules list (0.8.4 plan A); exactly R.builderSystem until src/roles.js records one
//   settingsOf(config) -> { open, guard, answerBackOn, promptOpts }   the four values chain.js derives from the config for every prompt (the same expressions, now one function)
//   systemTextsFor(label, config, seat) -> string[]   every system text the row `label` can send (each flag the config leaves open to the run: a quoted source, a tree member, a criteria check, a patch revise);
//                                                    the estimator prices the LONGEST. [] only for a row that has its own system pricing (the advise rows). An unknown label THROWS: a row without a rule is a bug.
import * as R from './roles.js';
import { held } from './held-roles.js';
import { shortExchangeOn } from './short-exchange.js';
import { ratingsDemanded } from './ratings-demand.js';
import { sortingOn } from './sorting.js';
import { ratingsRecorded } from './severity.js';
import { hasHandlingSession } from './ending.js';
import { cacheOrderSeat } from './cache-order-gate.js';
import { finalReadGate } from './final-read-gate.js';
import { finalReadWordsOn } from './final-read-words.js';
import { withLane } from './lanes.js';
import { applySeatRole } from './seat-role.js';
import { personaOf, PERSONA_FORMS, PERSONA_SWITCH, TITLE_JOBS } from './judge-persona.js';
import { loadPersonasWithSource } from './personas.js';
import { noteDebateBuild, noteJudgeBuild, noteTitleBuild, withoutNotes } from './persona-record.js';
import { handoffPrompt } from './handoff-prompt.js';
import { ARGUED_SYSTEM } from './argued.js';
import { SECURITY_REVIEW_SYSTEM, SECURITY_REVIEW_LABEL } from './security-review.js';
export const labOf = seat => seat.lab || seat.provider;
export const noQuoteMarksOn = config => config?.debate_hygiene?.noQuoteMarks === true;
/** TAGS SHOWN (A-DRAFT): once the rating demand is in force (src/ratings-demand.js: a layered unanimous chain and the held word `ratingDemand` recorded) the writer's revise and dispute prompts say once what the number on an objection is (roles.js SEVERITY_WRITER_SENTENCE). Otherwise the system text is unchanged. */
/** The dispute stage's system text: with the rating demand in force it is edited (milestone 2, A-DRAFT) and, when a final read follows (final_read on, layered), says so. Same text for the call and for the estimator's row. */
export const disputeSystemFor = config => withSeveritySentence(config, withDisputedMark(R.DISPUTE_SYSTEM), 'dispute');   // 0.8.4 slot H7 (D15): the DISPUTED sentence goes in first; the severity edits touch other spans of the text
export const withSeveritySentence = (config, system, kind = 'reviser') => {
  if (!ratingsDemanded(config)) return system;
  const finalRead = kind === 'dispute' && finalReadGate(config);
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
  return ratingsRecorded(config) && hasHandlingSession(config);   // 0.8.4 S4 (C&C): ONE predicate for "is there a handler" (src/ending.js)
}
export function severityLedgerPossible(config) {
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  const layered = critics.length > 0 && critics.every(c => c.layer !== undefined);
  return layered && config?.answer_back?.enabled === true && new Set(critics.map(c => c.layer)).size >= 2;
}
/**
 * 0.8.4 D14 / T7 wording (WORDING U2-w6; held name `failedRowAbsencePhrase`): the critic's reply format says how to anchor something absent. The phrase of the failed-row evidence is replaced exactly once (loud otherwise) once the name is
 * recorded in src/roles.js; nothing recorded: the very same text. Every critic prompt (panel, first-to-pass, final read) goes through criticPromptFor, which applies it to its finished text (the outermost wrapper, so the call text of withExcerptClause that test/excerpt-clause-wiring.test.js pins is untouched).
 */
const FAILED_ROW_PHRASE = 'FAILED: the quoted passage, or what is absent,';
export const withAbsenceAnchor = system => {
  const text = held('failedRowAbsencePhrase')?.();
  if (typeof text !== 'string' || !text) return system;
  const n = String(system).split(FAILED_ROW_PHRASE).length - 1;
  if (n !== 1) throw new Error(`withAbsenceAnchor: the critic's prompt must carry the failed-row phrase once (found ${n}), so the absence anchor has no place to go`);
  return String(system).replace(FAILED_ROW_PHRASE, () => text);
};
export function criticPromptFor(seat, open, opts, config, sorting = false, finalRead = false) {
  const self = config?.selfReview === 'allowed' && isWriterSeat(seat, config.seats);
  const o = self ? { ...(opts || {}), selfReview: true } : opts;
  // B3 prep (unit V): the rating flag comes from the chain's demand only (src/ratings-demand.js), set after the user's freedoms are read; a `severity` in a user's freedoms asks for nothing (the parser would drop the tags it got).
  const sevOn = ratingsDemanded(config);
  const own = o && ('severity' in o || 'severityLedger' in o || 'severityHandler' in o) ? (({ severity, severityLedger, severityHandler, ...rest }) => rest)(o) : o;
  const o2 = sevOn ? { ...(own || {}), severity: true, ...(severityLedgerPossible(config) ? { severityLedger: true } : {}), ...(severityHandlerPossible(config) ? { severityHandler: true } : {}) } : own;
  return withAbsenceAnchor(withLane(seat, personaSystemFor(seat, withSortingWords(withQuoteField(withTextRequestsField(withExcerptQuoteWords(withExcerptClause(o2 === undefined ? R.criticSystem(open) : R.criticSystem(open, o2), 'critic', !!o2?.fencedSource, cacheOrderSeat(config, seat)), 'critic', { fenced: !!o2?.fencedSource, mayShow: o2?.excerptsMayBeShown === true, order: cacheOrderSeat(config, seat) }), 'textRequestsJudgeField', o2?.textRequestsMayBeAsked === true)), sorting && sortingOn(config), sorting && sortingOn(config) && decisionLevelOn(config) ? { proposers: proposerSeatsOf(config).length > 0 } : null, finalRead), config)));   // the route words are computed only where the sorting words are (a caller with no config never reaches settingsOf)   // 0.8.4 H8: the excerpt clause, before the persona and the lane
}

// B3 prep (JUDGE lane, unit P; C&C ruling 1 Nov 2026). A judge's persona (chain switch `seat_personas`, seat field `persona`) is composed in ONE place. withJudgePersona is the only function that inserts the block and personaSystemFor
// is its only caller; criticPromptFor (the verdict prompt) and layerDebateSystemFor / layerReplySystemFor (the two exchange prompts) are the callers of personaSystemFor, and since cache part (b)1 so is judgePersonaBlockFor (the cache-shaped order asks it for the block once per seat). test/stage-isolation.test.js pins all of it. The block goes
// directly before the prompt's own reply-format sentence, found by text; a missing or doubled sentence throws, so switch-off bytes can never be touched and a template change cannot slip the block to the wrong place.
const REPLY_FORMAT_ANCHOR = 'Reply with a single JSON object and nothing else:';
/** 0.8.4 S8 c2a (held: test/held-prompts/held-084-s8.js): the sorting's two sentences, W7 and the reply form, put directly before the reply-format sentence like withQuoteField (so a persona block still ends up last); the final read's system text only, and only when all four words of src/sorting.js sortingOn are in force. */
const withSortingWords = (system, on, route = null, finalRead = false) => {
  if (!on) return system;
  // 0.8.4 S9 (S9-R1; WORDING S9-w18 .. w20): with the S9 words recorded the sorting also says where the route goes: the reply key after S8's form, and on a chain with NO proposer seat W29(i) in place of W7's route clause (found exactly once; loud otherwise, never a silent skip).
  let rule = held('layerThreeSortingRule')();
  if (route && !route.proposers) {
    const anchor = held('layerThreeSortingRouteClause')(); const found = rule.split(anchor).length - 1;
    if (found !== 1) throw new Error(`withSortingWords: the sorting rule must carry its route clause once (found ${found}), so the route clause for a chain with no proposer seat has no place to go`);
    rule = rule.replace(anchor, () => held('noProposerSortingRouteClause')());
  }
  // 0.8.4 S16 (W32, WORDING S16-w19): the rating sentence after W7's sentence on an unanchored failure, found exactly once or loud; every layer-3 read that carries W7. While held: nothing.
  if (finalReadWordsOn()) {
    const anchor = 'it is recorded as a late finding.'; const found = rule.split(anchor).length - 1;
    if (found !== 1) throw new Error(`withSortingWords: the sorting rule must carry its late-finding sentence once (found ${found}), so the sentence on a late finding's rating has no place to go`);
    rule = rule.replace(anchor, () => `${anchor}${held('lateFindingRatingSentence')()}`);
  }
  // 0.8.4 S16 (W31, WORDING S16-w16b/w18): at the FINAL READ, once its own words are recorded, W7's two closing-read clauses are cut (W31 replaces them, in the seat's user text) and the final read's own reply form stands in place of S8's. Each cut string is found exactly once or loud. While held: W7 and S8's form, byte for byte.
  const w31 = finalRead && finalReadWordsOn();
  if (w31) {
    for (const cut of [' (at a closing read, state your position on the plan: it is not a verdict that ends an overseer round)', ' At a closing read, if you find a new material defect that no open objection names, add it as a must-do item of its own, with the passage and the criterion.']) {
      const found = rule.split(cut).length - 1;
      if (found !== 1) throw new Error(`withSortingWords: the sorting rule must carry the closing-read clause once (found ${found}) for the final read's own words to replace it`);
      rule = rule.replace(cut, () => '');
    }
  }
  const key = route ? held('layerThreeSortingRouteKey')({ proposers: route.proposers }) : '';
  const text = `${rule}\n\n${w31 ? held('finalReadSortingForm')() : held('layerThreeSortingForm')()}${key ? `\n\n${key}` : ''}`;
  const at = system.indexOf(REPLY_FORMAT_ANCHOR);
  return at === -1 ? `${system}\n\n${text}` : `${system.slice(0, at)}${text}\n\n${system.slice(at)}`;
};
/** 0.8.4 S14 (W23, held: test/held-prompts/held-084-s14.js): the sentence that asks every judge for a `quote` beside each failure, put directly before the reply-format sentence like a persona block; unchanged while it is not recorded. In a FENCED run it comes beside the fenced-source quote rule (one field, two meanings: the S12 open item). It reaches every prompt criticPromptFor builds (the panel, the critique, the final read, the re-asks). */
const withQuoteField = system => {
  const text = held('criticQuoteFieldSentence')?.();
  if (typeof text !== 'string' || !text) return system;
  const at = system.indexOf(REPLY_FORMAT_ANCHOR);
  return at === -1 ? `${system}\n\n${text}` : `${system.slice(0, at)}${text}\n\n${system.slice(at)}`;
};
// The one place a block of persona words is put into a system prompt: directly before the prompt's own reply-format sentence (every judge prompt and every proposer prompt carries it exactly once).
function placeBeforeReplyFormat(system, block) {
  const at = system.indexOf(REPLY_FORMAT_ANCHOR);
  if (at === -1 || system.indexOf(REPLY_FORMAT_ANCHOR, at + 1) !== -1) throw new Error('a judge prompt must carry its reply-format sentence exactly once for the persona block to be placed before it');
  return `${system.slice(0, at)}${block}\n\n${system.slice(at)}`;
}
function withJudgePersona(system, name, form) {
  return placeBeforeReplyFormat(system, R.judgePersonaBlock({ name, form }));
}
/**
 * The words a seat's name brings to its prompt (0.8.4, lane C). The owner: "everyone gets their seat, which comes with a title" (the form `title`: one sentence, "the name is the title of your seat; it does not change ...") and, as an
 * experiment off in every shipped chain, "everyone has the full voice" (the form `voice`: the seat speaks in the voice of the name). Both are HELD words (test/held-prompts/held-084-c.js: seatTitleBlock, seatVoiceBlock, each
 * ({ name, job })), so until src/roles.js records them this returns null and the prompt is byte-identical. `job` is judge / propose / debate / reply. Null too when the chain's switch is off or the seat has no name.
 */
export function seatPersonaText(config, seat, job) {
  if (!TITLE_JOBS.includes(job)) throw new Error(`a seat's persona words are for one of ${TITLE_JOBS.join(', ')}, not ${JSON.stringify(job)}`);
  const cfg = config?.[PERSONA_SWITCH];
  const name = personaOf(seat);
  if (cfg?.enabled !== true || name === null) return null;
  const word = cfg.form === 'title' ? 'seatTitleBlock' : cfg.form === 'voice' ? 'seatVoiceBlock' : null;
  const text = word ? held(word)?.({ name, job }) : null;
  return typeof text === 'string' && text ? text : null;
}
// A proposer-side prompt (propose, debate, reply): the seat's words go before the reply-format sentence, and the seat's note says what the prompt carried (the name, or none: src/persona-record.js).
const titled = (config, seat, job, system) => {
  const text = seatPersonaText(config, seat, job);
  noteTitleBuild(seat, job, text ? personaOf(seat) : null);
  return text ? placeBeforeReplyFormat(system, text) : system;
};
export const proposerSystemFor = (config, seat, open) => titled(config, seat, 'propose', R.proposerSystem(open));
export const replySystemFor = (config, seat, guard) => withHeldNote(config, titled(config, seat, 'reply', R.replySystem(guard)), 'noQuoteGloss');
// 0.8.4 cache part (b)1 (src/cache-order.js): the new prompt order writes a judge's persona block ONCE per seat, at the end of the welcome, and composes the rest of the system text without it. `withoutPersonaBlock(fn)` runs a
// (synchronous) composition with personaSystemFor returning its text unchanged and leaving no note; `judgePersonaBlockFor` asks personaSystemFor itself for the block, so there is ONE decision about what a judge's persona is.
let personaSuppressed = false;
export function withoutPersonaBlock(fn) { const was = personaSuppressed; personaSuppressed = true; try { return fn(); } finally { personaSuppressed = was; } }
export function judgePersonaBlockFor(seat, config) {
  const out = personaSystemFor(seat, REPLY_FORMAT_ANCHOR, config);
  if (out === REPLY_FORMAT_ANCHOR) return null;
  const tail = `\n\n${REPLY_FORMAT_ANCHOR}`;
  if (!out.endsWith(tail)) throw Object.assign(new Error('judgePersonaBlockFor: personaSystemFor no longer places the block directly before the reply-format sentence'), { controlFlow: true });   // a harness bug, not a judge's silence (rethrowControlFlow)
  return out.slice(0, out.length - tail.length);
}
/** The system text of a judge call under the cache-shaped order (R1): the Council welcome and, where the seat has a persona block, that block. ONE text per seat for the whole run; judgePrompt sends it and the cost estimate sizes the cached head from it. */
export function judgeSystemR1(seat, config) {
  const persona = judgePersonaBlockFor(seat, config);
  return persona ? `${R.COUNCIL_INTRO}\n\n${persona}` : R.COUNCIL_INTRO;
}
export function personaSystemFor(seat, system, config) {
  if (personaSuppressed) return system;
  const cfg = config?.[PERSONA_SWITCH];
  const name = personaOf(seat);
  if (cfg?.enabled !== true || name === null) { noteJudgeBuild(seat, null); return system; }   // the note (src/persona-record.js) says what this prompt carried: no name
  if (!PERSONA_FORMS.includes(cfg.form)) throw new Error(`${PERSONA_SWITCH}.form must be one of ${PERSONA_FORMS.join(', ')}, not ${JSON.stringify(cfg.form)}`);
  if (cfg.form === 'title' || cfg.form === 'voice') {   // the held words, when recorded; a judge under the voice form without them keeps today's recorded frame (below)
    const text = seatPersonaText(config, seat, 'judge');
    if (text) { noteJudgeBuild(seat, name); return placeBeforeReplyFormat(system, text); }
    if (cfg.form === 'title') { noteJudgeBuild(seat, null); return system; }   // the title form never reaches the recorded judgePersonaBlock (the voice is its only form)
  }
  const out = withJudgePersona(system, name, cfg.form);
  noteJudgeBuild(seat, name);
  return out;
}
export const layerDebateSystemFor = (config, seat, again, { ending = false } = {}) => personaSystemFor(seat, R.layerDebateSystem(again, ratingsDemanded(config) ? { severity: true, ...(severityLedgerPossible(config) ? { severityLedger: true } : {}), ...(severityHandlerPossible(config) ? { severityHandler: true } : {}) } : null), config) + (again || ending ? '' : heldTail('layerDebateOwnQuoteSentence')) + shortExchangeTail(config, seat);   // 0.8.4 S14: W1's clause, round 1 only; 0.8.4 S6 (W5): the tail of a seat above the lowest layer, '' while the pair is held
export const layerReplySystemFor = (config, seat, again, { ending = false } = {}) => personaSystemFor(seat, R.layerReplySystem(again, ratingsDemanded(config) ? { severity: true } : null), config) + replyAnchorTail() + (ending ? '' : heldTail('layerReplyQuoteSentence')) + shortExchangeTail(config, seat) + signoffLineTail(config, seat);   // 0.8.4 S6: W5, then W14 (the last line of the reply is the sign-off line, so it comes last)

// 0.8.4 S2/S3 (held W6 and W2): the two held sentences that end a judge's prompt, composed HERE so the cost estimate (systemTextsFor) and the send read ONE text. Each is '' until src/roles.js exports the function (src/held-roles.js held()),
// so no byte moves before the one re-record. `relationTail` ends the blind-review prompt of a panel seat of a chain with answer_back on (W6: the relation each failure declares, src/objection-assign.js); `replyAnchorTail` ends the raiser's reply prompt of the exchange (W2: the anchor of a withdrawal).
const heldTail = name => { const f = held(name); return f ? `\n\n${f()}` : ''; };
export const relationTail = () => heldTail('relationRule');
export const replyAnchorTail = () => heldTail('layerReplyAnchorRule');
// 0.8.4 S6 (M1; Q5, D4, W5, W14): the two held sentences of the SHORTENED exchange, composed here for the same reason: the estimate (systemTextsFor, labels ldebate- and lreply-) and the send read ONE text. W5 ends BOTH exchange prompts of a seat above the lowest layer; W14 ends the reply prompt
// of such a seat (layers 2 and 3; at layer 1 the computed rule controls and the reply carries no such line). Both are '' unless the PAIR is recorded (src/short-exchange.js), so no byte moves before the one re-record, and the ending exchange (layer-1 seats) never carries them.
const aboveLowestLayer = (config, seat) => { const layers = (config?.seats?.critics ?? []).map(c => c.layer).filter(Number.isInteger); return Number.isInteger(seat?.layer) && layers.length > 0 && seat.layer > Math.min(...layers); };
export const shortExchangeTail = (config, seat) => (shortExchangeOn() && aboveLowestLayer(config, seat) ? heldTail('shortExchangeRule') : '');
export const signoffLineTail = (config, seat) => (shortExchangeOn() && aboveLowestLayer(config, seat) ? heldTail('signoffLineRule') : '');
/** The blind-review prompt of a panel seat: criticPromptFor plus the relation sentence (the first-mode critic, label critique-, does not declare relations and keeps criticPromptFor). */
/**
 * 0.8.4 S8 (money step): does this panel seat's verdict also SORT? Only a TOP-layer seat of a layered chain with at least two layers, and only while the sorting is on (src/sorting.js sortingOn: the ledger, the rating demand and the three S8 words recorded).
 * The ONE predicate: panelPromptFor (what is sent and what the estimate prices) and the chain's list and reading all ask it, so they cannot differ. A lower layer's panel prompt stays byte for byte.
 */
export const climbSortingFor = (seat, config) => {
  const critics = config && config.seats && config.seats.critics;
  if (!Array.isArray(critics) || !critics.length || !critics.every(c => c.layer !== undefined)) return false;
  const layers = [...new Set(critics.map(c => c.layer))].sort((a, b) => a - b);
  return layers.length >= 2 && seat && seat.layer === layers[layers.length - 1] && sortingOn(config);
};
// 0.8.4 (C&C GO "answer back off", Muad's yes): the relation sentence is sent only where a judge is SHOWN its own earlier objections (answer_back on: the answer-back section lists their ids, so a judge can name one). On a unanimous panel chain with answer_back off nothing is added (no new words): the judges are not asked for a relation and a repeated objection keeps its id the 0.8.3 way (src/chain.js asks the same switch before it reads a relation).
export const panelPromptFor = (seat, open, opts, config) => criticPromptFor(seat, open, opts, config, climbSortingFor(seat, config)) + (settingsOf(config).answerBackOn ? relationTail() : '');

// The model a seat actually runs, provider prefix and :variant dropped, so `anthropic/claude-sonnet-5` on OpenRouter and `claude-sonnet-5` direct are one model. Mock and external seats
// have no real model identity (mock chains reuse names on purpose), so they return null and never match. (Moved here from src/chain-lint.js, which re-exports it.)
export function modelIdentity(seat) {
  if (!seat?.model || seat.provider === 'mock' || seat.provider === 'external') return null;
  const id = String(seat.model).toLowerCase().split('/').pop().split(':')[0];
  // 0.8.4 the OpenRouter switch (plan section 14): OpenRouter writes a Claude version with a dot ("anthropic/claude-opus-5.5"), Anthropic with a hyphen ("claude-opus-5-5"). They are ONE model on both routes, so a routed copy of a repeated
  // model is still recognised as it (seat-key.js assertSeatKeyed, repeatedModelKeys). Claude ids only: every other id keeps its dots.
  return id.startsWith('claude-') ? id.replace(/\./g, '-') : id;
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

/**
 * 0.8.4 S9 (Q10, D8): the decision-level reading of a layer-3 objection is live: the chain has a Decisions section to contest (`settingsOf(config).promptOpts.decisions`) and the drafted words are recorded. ONE held name stands for the whole S9 batch (W8, W10,
 * W13, W29, the route words): test/held-prompts-084-s9.test.js makes the batch recorded all together or not at all. Defined HERE, beside settingsOf, because src/call-gates.js imports settingsOf from this file and this file reads the gate for the route words
 * (the other way round would be an import cycle); src/call-gates.js re-exports both.
 */
export const decisionLevelOn = config => settingsOf(config).promptOpts.decisions === true && typeof held('decisionLevelRule') === 'function';
/** The seats a proposer return goes to: `seats.proposers` ONLY. Unlike the proposal stage there is no fall back to the critics: a chain with no proposer seat takes the writer route (S9a, D29). */
export const proposerSeatsOf = config => (Array.isArray(config?.seats?.proposers) ? config.seats.proposers.filter(Boolean) : []);
export const settingsOf = config => ({
  open: config.scope === 'open',
  guard: config.majority_guard?.enabled === true,
  answerBackOn: config.answer_back?.enabled === true,
  // `kinds` (criteria_kinds.enabled) was added to this object by chain.js after it was made and before any prompt used it: the same object, one place now
  promptOpts: { decisions: config.decisions?.enabled === true || config.alternatives?.enabled === true, ...(config.criteria_kinds?.enabled === true ? { kinds: true } : {}) },
});
// The debate stage's system text: the persona text of a seat's role (src/seat-role.js applySeatRole; its ONE call site, test/stage-isolation.test.js) and the held quote rule. chain.js sends it and the estimator prices it.
// The persona set for one debate prompt: loaded ONCE, so the set applySeatRole uses and the set the seat's note (the report's persona_set_sha256, src/persona-record.js) names are the same object.
const debatePersonasFor = seat => { const loaded = loadPersonasWithSource(); noteDebateBuild(seat, loaded); return loaded.set; };
export const debateSystemFor = (config, seat, { textRequests = false } = {}) => withTextRequestsField(withHeldNote(config, applySeatRole(titled(config, seat, 'debate', R.DEBATE_SYSTEM), seat?.role, debatePersonasFor(seat)), 'debatePostQuoteRule'), 'textRequestsProposerField', textRequests);   // 0.8.4 D18: the sentence that lets a proposer ask for project text, only in a run where excerpts may be shown
// 0.8.4 plan A, writer seat (D16 T1.2; D15 T1.1 joins): drafted items of the builder's Rules list. Held words (src/held-roles.js): while src/roles.js exports none of these names the system text is exactly R.builderSystem's, so every
// prompt stays byte-identical. Each recorded item is one more "- " line right after BUILDER_SYSTEM's own rules, in this order, before the scope and decisions rules. The list is the one place a new
// builder-rules sentence is registered. The estimate below prices this text; the send site in src/chain.js moves from R.builderSystem to this helper as its own small unit (identical until the first name is recorded).
const BUILDER_RULE_ITEMS = ['builderMarkersRule', 'builderLimitsRule'];   // plan A l.84 (the claim markers, D15) before l.86 (the limits, D16)
/**
 * 0.8.4 S9 (W13, the plan's first sentence; held name `decisionsNumberingRule`, WORDING S9-w7): where the Decisions rule is on (`promptOpts.decisions`), the builder's and the reviser's system text ends with the one sentence that numbers the entries, so a reviewer can name
 * "Decision 2" and the harness can find it (src/decision-entry.js). Nothing while the sentence is held or the Decisions rule is off. Not a BUILDER_RULE_ITEMS entry: that list is not gated by the Decisions rule.
 */
const withNumberingRule = (system, promptOpts) => { const t = promptOpts?.decisions ? held('decisionsNumberingRule')?.() : null; return typeof t === 'string' && t ? `${system}\n\n${t}` : system; };
export const builderSystemOf = (open, promptOpts) => {
  const base = R.builderSystem(open, promptOpts);
  const items = BUILDER_RULE_ITEMS.map(name => held(name)?.()).filter(text => typeof text === 'string' && text);
  if (!items.length) return withNumberingRule(base, promptOpts);
  if (!base.startsWith(R.BUILDER_SYSTEM)) throw new Error('builderSystemOf: R.builderSystem no longer starts with BUILDER_SYSTEM, so the builder rules have no place to go'); // loud, never a silent skip of a sentence the owner approved
  return withNumberingRule(R.BUILDER_SYSTEM + items.map(text => `\n- ${text}`).join('') + base.slice(R.BUILDER_SYSTEM.length), promptOpts);
};
/**
 * 0.8.4 D15 (plan A l.85): the dispute pass's one drafted sentence about the DISPUTED marker, put right after "Never delete a disputed claim silently." in its system text. Inert while the sentence is not recorded in
 * src/roles.js (held name `disputedMarkSentence`); loud if the anchor is not in the text exactly once. Called by `disputeSystemFor` (near the top of this file; slot H7), the one text the dispute call and the estimator's dispute row both use.
 */
/**
 * 0.8.4 D30 (plan A T1.5): the critic's and the reviser's "only source" rule, one sentence each, when seats are shown excerpts (held names `criticOnlySourceSentence`, `reviserOnlySourceSentence`; the rule
 * is in the prompt only when the task carries fenced source, so `fenced` says whether to look). The sentence that carries the phrase ("... is the ONLY thing you know about the repository." in the critic's
 * QUOTE_RULE_CRITIC, "Some of the task is real source code, ... the only source anyone in this chain has seen." in the reviser's QUOTE_RULE_REVISER) is replaced by the drafted one, exactly once. Inert while the
 * words are unrecorded or `fenced` is false; loud if a fenced prompt does not carry the sentence exactly once. Called by criticPromptFor (kind 'critic', fenced = the freedoms' `fencedSource`) and by the function
 * reviserSystemFor returns (kind 'reviser'; 0.8.4 H8): the reviser sites in src/chain.js and the estimate (reviserTexts, the panel, critique and final-read cost rules) reach it through those two.
 */
const ONLY_SOURCE = {
  critic: { held: 'criticOnlySourceSentence', re: /That fenced text is the ONLY thing you\s+know about the repository\./g },
  reviser: { held: 'reviserOnlySourceSentence', re: /Some of the task is real source code, fenced verbatim, and it is the only source anyone in\s+this chain has seen\./g },
};
// 0.8.4 cache part (b)1: with the cache-shaped prompt order live for a judge seat the excerpt block stands ABOVE the instructions (directly under the plan), so the two judge-side sentences that say "marked as such below" are
// replaced by their reworded variants (held names, recorded with the order's batch: src/cache-order-gate.js ORDER_WORDS). Everything else about them is unchanged.
const ORDER_VARIANT = Object.freeze({ criticOnlySourceSentence: 'criticOnlySourceSentenceOrder', criticExcerptOnlyRule: 'criticExcerptOnlyRuleOrder' });
const heldName = (name, order) => (order && ORDER_VARIANT[name] && typeof held(name) === 'function' ? ORDER_VARIANT[name] : name);   // the variant stands only where the sentence it rewords is recorded: the order rewords a sentence, it never adds one the original does not carry
export const withExcerptClause = (system, kind, fenced, order = false) => {
  const rule = ONLY_SOURCE[kind];
  if (!rule) throw new Error(`withExcerptClause: unknown kind ${kind}`);
  const text = held(heldName(rule.held, order))?.();
  if (!fenced || typeof text !== 'string' || !text) return system;
  const found = (String(system).match(rule.re) || []).length;
  if (found !== 1) throw new Error(`withExcerptClause: the ${kind}'s prompt must carry its "only source" sentence once (found ${found}), so the excerpt clause has no place to go`);
  return String(system).replace(rule.re, () => text);
};
/**
 * 0.8.4 A7 + plan A step 4 (C&C 09 Nov 2026; WORDING A7-w1..w5, w7; all held): the quote words when excerpts MAY be shown in this run. `mayShow` is the run-stable flag (src/excerpt-channel.js excerptsMayBeShown, decided once at
 * the start of the run, never per call), so a seat's system text is the same in all of its calls. FENCED run: the phrases that name the fenced source alone name "or an excerpt marked as such" as well (each replaced exactly once,
 * loud otherwise). UNFENCED run: the critic and the reviser each get a rule, worded for the case that none is shown (no reply-format field is added: S14's sentence owns the quote field of every judge); the criteria stage gets nothing. Nothing recorded (all the names are recorded
 * together, or none) or `mayShow` false: the very same text.
 */
const QUOTE_WORDS = {
  critic: { fenced: [[/the exact text from the fenced source it rests on/g, 'criticQuoteFieldPhrase'], [/copied from the\s+fenced source\./g, 'criticQuoteCopiedPhrase'], [/Never write a "quote" that is not in the fenced source\./g, 'criticQuoteNeverSentence']], unfenced: ['criticExcerptOnlyRule'] },
  reviser: { fenced: [[/An objection may carry a "quote" from it\./g, 'reviserQuoteFromSentence'], [/with a quote you cannot find in the fenced\s+source,/g, 'reviserQuoteFindPhrase']], unfenced: ['reviserExcerptOnlyRule'] },
  criteria: { fenced: [[/unless the fenced source shows it\./g, 'criteriaQuotePhrase']], unfenced: [] },
};
export const withExcerptQuoteWords = (system, kind, { fenced = false, mayShow = false, order = false } = {}) => {
  const rule = QUOTE_WORDS[kind];
  if (!rule) throw new Error(`withExcerptQuoteWords: unknown kind ${kind}`);
  if (!mayShow) return system;
  const names = fenced ? rule.fenced.map(([, n]) => n) : rule.unfenced;
  const words = names.map(n => held(heldName(n, order))?.());
  if (!names.length || words.some(w => typeof w !== 'string' || !w)) return system;
  const once = (text, re, what) => { const n = (String(text).match(re) || []).length; if (n !== 1) throw new Error(`withExcerptQuoteWords: the ${kind}'s prompt must carry ${what} once (found ${n}), so the excerpt wording has no place to go`); };
  let out = String(system);
  if (fenced) {
    rule.fenced.forEach(([re, name], i) => { once(out, re, `the sentence of ${name}`); out = out.replace(re, () => words[i]); });
    return out;
  }
  return out + words[0];
};
/** 0.8.4 D18 (WORDING D18-w1, held): the sentence that lets a judge ask for project text in its reply, added at the end of the judge's system text; only when the call site says the run may show excerpts (the same run-stable flag as A7) and the words are recorded. */
export const withTextRequestsField = (system, name, on) => { const text = on ? held(name)?.() : null; return typeof text === 'string' && text ? `${system}${text}` : system; };
/** The criteria stage's system text, with the A7 words for a fenced run (the three sites of src/chain.js go through here). */
export const criteriaSystemOf = (open, fenced, opts) => withExcerptQuoteWords(R.criteriaSystem(open, fenced, opts), 'criteria', { fenced: !!fenced, mayShow: opts?.excerptsMayBeShown === true });
export const withDisputedMark = system => {
  const text = held('disputedMarkSentence')?.();
  if (typeof text !== 'string' || !text) return system;
  const anchor = 'Never delete a disputed claim silently.';
  const found = String(system).split(anchor).length - 1;
  if (found !== 1) throw new Error(`withDisputedMark: the dispute prompt must carry "${anchor}" once (found ${found}), so the DISPUTED sentence has no place to go`);
  return String(system).replace(anchor, () => `${anchor} ${text}`);
};
export const withSplitNote = (treeMember, system, name) => { const text = treeMember ? held(name)?.() : null; return text ? `${system}\n\n${text}` : system; };
export const reviserSystemFor = (answerBackOn, patch) => {
  const base = (answerBackOn ? held(patch ? 'patchReviserSystemWithIds' : 'reviserSystemWithIds') : undefined) ?? (patch ? R.patchReviserSystem : R.reviserSystem);
  return (open, fenced = false, opts = {}) => withNumberingRule(withExcerptQuoteWords(withExcerptClause(base(open, fenced, opts), 'reviser', fenced), 'reviser', { fenced: !!fenced, mayShow: opts?.excerptsMayBeShown === true }), opts);   // 0.8.4 H8: every reviser site and the estimate go through here; S9: and the numbering sentence where the Decisions rule is on
};

const BOOL = [false, true];
// The writer's reviser text over what a run decides later: a quoted source in the request (fenced), a tree member, the patch mode. The longest of them is what the estimate prices.
const reviserTexts = (config, sev = true) => {
  const { open, answerBackOn, promptOpts } = settingsOf(config);
  return BOOL.flatMap(fenced => BOOL.flatMap(mayShow => BOOL.flatMap(member => (config.revise?.mode === 'patch' ? BOOL : [false]).map(patch => { const t = withSplitNote(member, reviserSystemFor(answerBackOn, patch)(open, fenced, mayShow ? { ...promptOpts, excerptsMayBeShown: true } : promptOpts), 'treeSplitWriterNote'); return sev ? withSeveritySentence(config, t) : t; }))));
};
const replyTexts = (config, name, fn) => BOOL.map(g => withHeldNote(config, fn(g), name));

// The system text of a FINAL-READ call (unit D, src/final-read.js): the seat's panel text for the same request, without the freedoms the stage does not honour
// (a stated pass, a blocking question). chain.js sends it and systemTextsFor prices it from this one function; the four variants are what a run decides later.
export const finalReadSystemFor = (seat, config, { fencedSource = false, criteriaKinds = false, excerptsMayBeShown = false } = {}) =>
  criticPromptFor(seat, settingsOf(config).open, { fencedSource: !!fencedSource, ...(criteriaKinds ? { criteriaKinds: true } : {}), ...(excerptsMayBeShown ? { excerptsMayBeShown: true } : {}) }, config, true, true);

/** Rules by row label, first match wins. Each returns the list of system texts that row's call can send. */
const RULES = [
  [/^ambiguity-/, () => [R.AMBIGUITY_SYSTEM]],
  [/^preflight-/, () => [PREFLIGHT_SYSTEM]],
  [/^questions$/, () => [R.QUESTIONS_SYSTEM]],
  [/^criteria$/, config => { const { open, promptOpts } = settingsOf(config); return BOOL.flatMap(f => BOOL.map(m => criteriaSystemOf(open, f, m ? { ...promptOpts, excerptsMayBeShown: true } : promptOpts))); }],
  [/^alternative-/, () => [R.ALTERNATIVE_SYSTEM]],
  [/^alt-debate-/, config => [withHeldNote(config, R.ALT_DEBATE_SYSTEM, 'debatePostQuoteRule')]],
  [/^alt-reply-/, config => replyTexts(config, 'noQuoteGloss', R.altReplySystem)],
  [/^skeleton$/, () => [R.SKELETON_SYSTEM]],
  [/^propose-/, (config, seat) => [proposerSystemFor(config, seat, settingsOf(config).open)]],
  [/^judge-/, () => [R.JUDGE_SYSTEM]],
  [/^canary-reply-/, (config, seat) => BOOL.map(g => replySystemFor(config, seat, g))],   // 0.8.4 H1-c: the run's canary reply goes through replySystemFor (src/chain.js), so it carries the seat's title and the quote gloss, exactly as the reply- rows are priced
  [/^debate-/, (config, seat) => BOOL.map(t => debateSystemFor(config, seat, { textRequests: t }))],   // the estimate prices the sentence as a max over the flag the live debate reads
  [/^reply-/, (config, seat) => BOOL.map(g => replySystemFor(config, seat, g))],
  [/^ldebate-/, (config, seat) => BOOL.map(again => layerDebateSystemFor(config, seat, again))],   // both rounds: the later-round text is longer, and the persona block (if any) rides on both   // B2 (debate-084/b2): the exchange inside layer 1
  [/^lreply-/, (config, seat) => BOOL.map(again => layerReplySystemFor(config, seat, again))],
  [/^build$/, config => { const { open, promptOpts } = settingsOf(config); return BOOL.map(m => withSplitNote(m, builderSystemOf(open, promptOpts), 'treeSplitWriterNote')); }],
  [/^deep-dive-revise$/, config => reviserTexts(config, false)],   // the deep dive's findings carry no severity, so its revise prompt carries no sentence about one
  [/^deep-dive-/, () => R.DEEP_DIVE_JOBS.map(j => R.deepDiveSystem(j))],
  [/^final-read-/, (config, seat) => BOOL.flatMap(f => BOOL.flatMap(k => BOOL.map(m => finalReadSystemFor(seat, config, { fencedSource: f, criteriaKinds: k, excerptsMayBeShown: m }))))],
  [/^panel-/, (config, seat) => { const { open } = settingsOf(config); return BOOL.flatMap(f => BOOL.flatMap(t => BOOL.map(k => panelPromptFor(seat, open, { ...(config.freedoms || null), fencedSource: f, excerptsMayBeShown: true, textRequestsMayBeAsked: t, ...(k ? { criteriaKinds: true } : {}) }, config)))); }],
  [/^critique-/, (config, seat) => { const { open } = settingsOf(config); return BOOL.flatMap(f => BOOL.flatMap(t => BOOL.map(k => criticPromptFor(seat, open, { ...(config.freedoms || null), fencedSource: f, excerptsMayBeShown: true, textRequestsMayBeAsked: t, ...(k ? { criteriaKinds: true } : {}) }, config)))); }],
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
  [/^rule-bound-/, () => { const t = held('escalationRulingSystem')?.({ sendUp: true }); return typeof t === 'string' ? [t] : []; }],   // M1 COMPLETE U2-3: the maximum's row for the layer-1 go-up's ruling calls (src/cost.js); the system text is the recorded send-up variant of the ruling sentence the call sends (chain.js ruleOnEscalation, isLayerOneUp)
  [/^rule-go-up-/, () => { const t = held('goUpRulingSystem')?.(); return typeof t === 'string' ? [t] : []; }],   // 0.8.4 S7: the maximum's row for the layer-2 go-up's ruling calls (src/cost.js); the system text is the go-up's own held sentence (no row exists while it is held)
  [/^return-(alt|post|answer)-/, () => { const t = held('proposerReturnSystem')?.(); return typeof t === 'string' ? [t] : []; }],   // 0.8.4 S9: the proposer return's three calls (src/proposer-return.js); no seat role, no persona, one system line (the held `proposerReturnSystem`); no text while the S9 words are held (no row exists then either)
  [new RegExp(`^${SECURITY_REVIEW_LABEL}$`), () => [SECURITY_REVIEW_SYSTEM]],
];
export function systemTextsFor(label, config, seat) {
  const rule = RULES.find(([re]) => re.test(label));
  if (!rule) throw new Error(`estimateChainRows: the row "${label}" has no system-text rule (src/stage-system.js RULES): add one, so the estimate counts the text invoke() will send`);
  return withoutNotes(() => rule[1](config, seat));   // the estimator prices a prompt; it does not send one, so it leaves no note (src/persona-record.js)
}
