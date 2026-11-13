import { effectiveLimits, isOverseerChain, newRoundState, advance, stopIdOf, panelEnding, isHardStop, isPersonStop, markLadderStop, stopOffersContinue, layer2BoundGoUp, layer1BoundGoUp, stallStopWhy, finishChoiceOf, finishRelayedOf, relayedTail } from './overseer-rounds.js';
import { ladderOf, newLadderState, floorOf, afterObjection } from './ladder.js';
import { stepOf } from './ladder-steps.js';
import { rulingsInForce, retagsAtPass } from './rulings.js';
import { call, keyFor, resolveVendorSeat, failureFactsOf, isAutoResumable, networkResumeWait, isHttp5xx, resendWait, isSizeRefusal, halvesOnSizeRefusal } from './providers.js';
import { held } from './held-roles.js';
import { findConflict } from './conflict-detector.js';
import { MAX_CONFLICTS_PER_CALL, deciderSeatOf, deciderActive, conflictItems, readRulings, decisionRow, ConflictAsked, conflictChoiceFor } from './conflict-decider.js';
import { handoffPrompt, handoffPlanFileOf } from './handoff-prompt.js';
import { extraWithHighDefault, retryCapFor, retryCeilingOf } from './reasoning.js';
import { pinnedExtra, ownPinOf } from './price-pin.js';
import { zdrAllowedHosts } from './zero-retention.js';
import { effectiveRow } from './price-table.js';
import { draftBoundaryOn, boundedDraft } from './draft-bounds.js';   // 0.8.4 D27: the draft boundary (gate and bounded draft)
import { PriceRefused, isMaxPriceRefusal, markSkippable, seatSkipChoice, seatSkipActive, skipKeyOf } from './price-refused.js';
import { collectNoteLines, parseDisputes, fixNoteOn } from './draft-disputes.js';
import { readNotes, budgetLeft, parseNoteAnswers, notesView, fitNotes, lastRoundOf, sinceLastRevise } from './review-notes.js';
import { notesConfigOf, reviewNotesActive, splitNotes } from './review-notes-lane.js';
export { parseDisputes };

/**
 * Notes lane unit 2 (gate note addendum 1, A3): `parseDisputes` strips a writer's NOTE-TAKEN/DECLINED/SAME answer lines and returns them as `noteLines`. A stage that is not asked for them ignores them BY DESIGN (the
 * lane's prompts reach only the main revise, and in this commit not even that), and says so with a count, so nothing disappears silently. Prints nothing when there are none, so no existing log changes.
 */
/**
 * ROADMAP 83: an EARLY-FINISH trailer line (the session's proposal to end the run early) is acted on by ONE stage only: the revise of a layered chain whose reviser is the person's own session. Every other stage strips it
 * (parseDisputes) and says so, so a line the harness did not act on never disappears silently. Prints nothing when there is none.
 */
/** The harness-written builder-task section of an early finish (A-DRAFT words). One line per open objection, the judge's own text collapsed to one line. */
export function withBuilderTasks(handoff, tasks) {
  const one = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const lines = tasks.map((t, n) => `- BT-${n + 1} (${t.id}, raised by ${t.lab ? shownKey(t.lab) : 'an unnamed lab'}${readSeverity(t.severity).ok ? `; severity ${t.severity}` : ''}; ${t.handled === 'declined' ? `the reviser declined it${t.declined_reason ? `: ${one(t.declined_reason)}` : ''}` : t.handled === 'changed' ? 'the reviser changed the plan, not re-reviewed' : t.handled === 'unchanged' ? 'the plan was not changed for it' : 'still open'}): ${one(t.criterion)} - ${one(t.problem)}`);
  return `${String(handoff).replace(/\s+$/, '')}\n\n## Builder tasks left open at the early finish\n\nThis run finished early at the session's proposal and the overseer layer's yes; the lower layers did not review the last revision. This is NOT agreement. ${tasks.length ? `Each objection below is still open and is a task for the builder.\n\n${lines.join('\n')}` : 'No objection was open at the early finish, so there is no task for the builder here.'}\n`;   // R3 (held fix, A-DRAFT): with no task the section does not speak of objections below it
}
/**
 * The builder tasks of an early finish read back from a finished report.json (`council handoff --from-run` rebuilds HANDOFF.md from it): the objections are `dispute.open_objections` (the one list the dissent block and the run's own
 * handoff use, so the same N), and what the reviser did with each comes from `stop.items` by id. null when the report is not an early finish or lists none.
 */
export function earlyTasksFromReport(report) {
  if (report?.stop?.kind !== 'early_finish') return null;
  const kept = new Map((Array.isArray(report.stop.items) ? report.stop.items : []).map(i => [i.id, i]));
  // BUG-D-001: the reviser's reason for a declined objection is kept in stop.items (declined_reason, cut at 600 characters), so the handoff rebuilt from the report says what the run's own handoff said.
  const standing = (Array.isArray(report.dispute?.open_objections) ? report.dispute.open_objections : []).filter(o => o.closed_by !== 'final_read');   // 0.8.4 S8 c3: an objection the closing read closed is not a task
  return earlyTasksToWrite(standing.map(o => { const k = kept.get(o.id); return { id: o.id ?? 'no id', lab: o.seat ?? o.lab ?? null, criterion: o.criterion, problem: o.problem, handled: k?.handled ?? 'open', ...(readSeverity(o.severity).ok ? { severity: o.severity } : {}), ...(typeof k?.declined_reason === 'string' && k.declined_reason ? { declined_reason: k.declined_reason } : {}) }; }), finishedEarlyNothingOpen(report), (Array.isArray(report.dispute?.open_objections) ? report.dispute.open_objections : []).some(o => o && o.closed_by === 'final_read'));
}
/**
 * 0.8.4 round 1 (R3, C&C 80296ad3): the ONE decision whether the builder-task section is written, for the run's own handoff and for the one rebuilt from the report (`council handoff --from-run`): tasks that stand: the section with them; no task and nothing stands
 * (the one fact: both counts 0 and no late finding) and the closing read closed none: the section in its empty variant; no task otherwise (a late finding stands, the counts do not say 0, or the closing read closed the tasks): no section. Returns the tasks to write (an empty list is the empty variant) or null for no section.
 */
export function earlyTasksToWrite(tasks, nothingStands, closedByClosingRead = false) {
  if (Array.isArray(tasks) && tasks.length > 0) return tasks;
  return nothingStands === true && closedByClosingRead !== true ? [] : null;   // the closing read closed every task (S8 c3): no section, as before (the ruling is silent on that case)
}
export function earlyFinishIgnored(stage, reason, say) {
  if (typeof reason === 'string' && reason) say(`  ${stage}: an early-finish line was in the reply, removed from the text and not acted on (only the revise of a layered chain with a session reviser acts on it).`);
}
export function noteLinesIgnored(stage, noteLines, say) {
  if (Array.isArray(noteLines) && noteLines.length) say(`  ${stage}: ${noteLines.length} answer line(s) to review notes were in the reply, removed from the text and not recorded (this stage is not asked for them).`);
}
import * as R from './roles.js';
import { assertStageLabelSafe } from './lab-safety.js';
import { promptCacheTtl, exchangeCallCarriesHead, isRoutedClaudeSeat } from './prompt-cache.js';
import { cacheOrderWordsOn } from './cache-order-gate.js';      // 0.8.4 cache part (b)2: a routed Claude seat is marked only where the order is live (its words recorded)
import { judgePrompt, assertCacheOrder, cacheOrderOn, leadInOf, orderNote, markTtlOf } from './cache-order.js';   // 0.8.4 cache part (b)1: the cache-shaped prompt order of a judge call
import { exchangeJsonModeLabs, jsonModeSeat, exchangeClosingText } from './exchange-json-mode.js';
import { finishedAtStopWords } from './verdict-headline.js';   // 0.8.4 L3: pure; imports only outcome, final-read, layers and overseer-rounds
import { contextWindowOf, fitsHalfWindow } from './context-window.js';
import { splitOfFinalRead, withHandlerSorts, openFinalReadRows, finalReadLabel, finalReadTag, nobodyReadFinalPlan, FINAL_READ_REASK_SUFFIX, topSeatsOf, layer3ReadShas, seatsToRead, coverageGaps, finalReadObjections, readEntry, unreadEntry, notRunEntry, notReaskedEntry, FINAL_READ_NOT_RUN_WHY, finalReadRecord, reusedEntries, finalReadLogLines, renderFinalReadBlock } from './final-read.js';
import { closingPartsOf, lateFromUnanchored, readSorting, combineSortings, sortingOn, sortingItemsOf, sortingFindingsOf, withAnchor, closedAtClose, closingWords, closedRowsOf, buildCheckDemanded, REASON_CAP } from './sorting.js';   // 0.8.4 S8: pure; layer 3's sorting of open objections and late findings
import { layerWord, layerHyphen } from './top-layer.js';
import { seatKeyOf, keepSeatKey, assertSeatKeyed, shownKey, seatField, repeatedLabsOf, registerSeatKeys, shownSeat, labFromKey, layerNoteOf, keyOfRecord, seatsOfRow } from './seat-key.js';
import { readSeverity, holdsSignOff, severityMeets, createSeverityRun, SEVERITY_LINES, settleStateOf } from './severity.js';
import { writerNoteRows } from './writer-note.js';
import { assignLateFindingIds, lateFindingRow, readOrder, withRatingsInForce, withFinalReadObjections, withOpenMayLeave, withLateFindings, withConcerns, withClosedBelowFour, withSorted, withSortedPerSeat } from './late-finding.js';
import { endingExchangeOn, lastRoundPostSystem, lastRoundReplySystem, assertEndingPrompts } from './ending-exchange-prompts.js';
import { shortExchangeOn, signoffRefusalOn } from './short-exchange.js';   // 0.8.4 S6: the shortened exchange at layers 2 and 3 (the pair W5 + W14), one switch
import { PREFLIGHT_SYSTEM, criteriaSystemOf, debateSystemFor, criticPromptFor, panelPromptFor, climbSortingFor, replyAnchorTail, layerDebateSystemFor, layerReplySystemFor, isWriterSeat, seatIdentity, modelIdentity, labOf, withHeldNote, noQuoteMarksOn, withSplitNote as splitNoteOf, reviserSystemFor as reviserSystemOf, proposerSystemFor, replySystemFor, settingsOf, finalReadSystemFor, withSeveritySentence, disputeSystemFor, builderSystemOf } from './stage-system.js';
export { criticPromptFor, isWriterSeat, seatIdentity, modelIdentity, labOf } from './stage-system.js';
export { seatKeyOf } from './seat-key.js';
import { callGatesOf, stallWindowOf, layerOneGoUpLineOn, disputeOn, proposerSeatsOf, decisionLevelOn } from './call-gates.js';   // 0.8.4 S11: the stall window and the pass gates, one definition for this file and the call ceiling (src/call-ceiling.js)
import { costOf, worstCaseOf, promptTokensOfChars, promptCharsOf, summarise, formatUsd, wouldBreach, projectStage, projectAttempts, expectedCallUsd, repeatExpectedCallUsd, typicalCallUsd, NETWORK_RESUMES_PER_RUN, isAnthropicSeat, needsPrice, SEAT_DEFAULT_MAX_TOKENS, readUsage, readUsd, IN_PASS_REASKS_PER_SEAT } from './cost.js';
import { requiredDeliverableSections } from './preflight.js';
import { billingAccountOf, BILLING_CAP_IDS, recordedCapOf } from './caps.js';
import { withdrawalLedger } from './withdrawal-ledger.js';
import { NO_TIE_BREAK } from './tie-break.js';
import { runTool as defaultRunTool, ALLOWED_TOOLS, runSeatToolRequests } from './tools.js';
import { runLints } from './lints.js';
import { ledgerOutOn, ledgerLineSource, ledgerIdFindings, parseLedgerLine, LEDGER_MESSAGES, swapProposalsSection, scopeLedgerFile } from './scope-ledger.js';
import { extractClaims, dropInvalidClaims } from './claims.js';
import { fencedSourceOf, markFailures, quoteWarnings, spanTexts } from './quote-check.js';
import { excerptBlockFor } from './excerpt-record.js';
import { withNoTestsLine } from './verify-first.js';
import { noFencedTestFile } from './fence-tests.js';
import { placeExcerptBlock, isNotASeat } from './excerpt-slot.js';
import { excerptsMayBeShownFor, excerptChannelUsable } from './excerpt-channel.js';
import { readTextRequests, numberRequests, noticeLines } from './text-requests.js';
import { parsePatches, applyPatches, changedSince } from './patch-revise.js';
import { injectCanary, shouldSampleCanary, runIdUnit, pickCanaryTarget, pickCanaryTargetSeeded, CANARY_NOTE } from './canary.js';
import { readerView, viewRecord, translateRefs } from './debate-order.js';
import { markPostQuote, normQuoteTight } from './post-quotes.js';
import { LAYER_ONE_EXCHANGE_ROUNDS, lateUngroundedWhy, exchangeObjections, readPosts, readReplies, quoteFound, outcomeOf, notePositionsOf, minorityNotesOf, signoffOf, EXCHANGE_ROUNDS } from './layer-debate.js';   // B2 (debate-084/b2): the exchange inside layer 1
import { idSlipsOf } from './near-json.js';   // 4 Nov 2026 (unit 8): an exchange id one character off pauses for a repair
import { buildAnswerBack, answerBackSummary, applyAnswers, stillOpen, changedPassages } from './answer-back.js';
import { runSecurityReviewStage, DEFAULT_SECURITY_REVIEWER_SEAT } from './security-review.js';
import { containerText } from './container-text.js';
import { assertNoDeniedModels, deniedReasonsOf, DeniedModel } from './denied-models.js';
import { promptHashOf, promptSha256Of, cacheVerdict } from './cache-integrity.js';
import { createWordingLedger, textHashOf, routeWords } from './stale-guard.js';   // 0.8.4 T14: a resume keeps a stage saved under THC's older wording when nothing it depends on changed
import { earlyFinishEligible } from './early-finish-eligible.js';
import { isEnvelopePair, issueEnvelope, envelopeInForce, draftIdOf } from './verdict-envelope.js';
import { hasHandlingSession, endingOf } from './ending.js';
import { endingWordOf, disputeReasonOf, stopKindOf, bannerReasonOf, agreedOf, finishedAtOnceNothingOpen, finishedAtOnceCase, finishedEarlyNothingOpen, nothingStandsAtEnd } from './ending-matrix.js';   // 0.8.4 D1 (src/ending-matrix.js): the one ending word; the dispute record's `reason` is derived from it
import { buildCheckLive, buildCheckLabel, buildCheckPrompt, judgeBuildCheck } from './build-check.js';
import { handlerSortLive, handlerSortLabel, handlerSortPrompt, judgeHandlerSort } from './handler-sort.js';
import { handlerRetagPickLive, retagPickLabel, handlerRetagPickPrompt, judgeRetagPick } from './retag-pick.js';   // 0.8.4 (A5): the handling session picks between two top-layer re-rates of one objection
import { classifyDecisionObjections, selectReturnMark, runProposerReturn, returnSlotFree } from './proposer-return.js';
import { refusalWords } from './decision-entry.js';   // 0.8.4 S9: the proposer return (Q10), src/proposer-return.js
import { objectionLedger, fitLedger, fitOpenRows, declinedReasonsFromDisputes, LEDGER_MAX_CHARS } from './objection-ledger.js';
import { stripLockBlock } from './criteria-lock.js';
import { stripBuilderTaskBlock } from './handoff-contract-text.js';
import { stripHandlerNotesBlock } from './handler-notes.js';
import { liftAnyClamp } from './handoff-status.js';   // 0.8.4 D29
import { stripAcceptanceLines } from './acceptance.js';   // 0.8.4 D2
import { buildArguedFacts, checkArguedRefs, ARGUED_SYSTEM, arguedUser, ARGUED_LABEL, ARGUED_FILE } from './argued.js';
import { normaliseCriteria, criteriaSummary, kindsRecord, checksSection, unevidencedCheckableMets, summaryLine, MET_VERDICT, FAILED_VERDICT, verdictWord } from './criteria-kinds.js';
import { missingCriteriaRows, signoffTableGap, describeTableGap, outsideCriteriaRows, criterionIndexOf, metEvidenceFor, rowCriterionIndex } from './criteria-ledger.js';
import { objectionId, objectionKey, problemKey, criterionKeyOf, stripListMarker, baseObjectionId, recordAssignedId, nextSuffixedId, resetAssignedIds, setIdCriteria, snapshotIds, restoreIds } from './objection-ids.js';
import { assignIds, normProblem } from './objection-assign.js';   // 0.8.4 S2: the identity of a blind-review failure with its declared relation (active only once the relation wording W6 is recorded)
import { createStallBook, escalationLastsOnePass, heardSeats } from './stall-book.js';
import { escalationTarget, rulingActive, goUpRulingActive, layerOneRulingActive, readRulings as readEscalationRulings, settleRulings, escalatedSignoffBlock, escalationsWithNext, escalatedHeaderCauseWords, isLayerOneUp } from './escalation.js';
import { layerProblems, LAYER_STATE_WORDS, layerStateWord } from './layers.js';
import { finalReadGate } from './final-read-gate.js';
import { finalReadWordsOn } from './final-read-words.js';
import { orderForParts, packParts } from './final-read-room.js';
import { seededShuffle } from './seeded-shuffle.js';
import { buildTextLabels } from './text-labels.js';
import { lintCriteria } from './criteria-lints.js';
import { runDeepDive, deepDiveFailures } from './deep-dive.js';
import { assertOutboundClean, SecretShapedPrompt, SecretFinish, SpendFinish, NotRunForLimit } from './outbound-scan.js';
import { billedFieldsOf, discardedFieldOf } from './billed-facts.js';
import { answerRecordOf, companyOfSeat } from './answered-by.js';
import { ratingsDemanded } from './ratings-demand.js';
export { DeniedModel };

// v3 §4: the criteria stage's own user prompt, exported so it's testable without running a
// full chain. Tells the criteria seat what the chain's own contract will require in the
// deliverable, so it never writes a criterion that conflicts with a section the builder is
// required to produce - the recurring contract-vs-criteria conflict v2's pre-flight check
// could only warn about after the fact. Reuses the same required-sections data the pre-flight
// check already computes - no new state, no second source of truth.
export function criteriaUserPrompt(request, config) {
  const required = requiredDeliverableSections(config);
  const requiredBlock = required.length
    ? `\n\n# Sections this chain always adds\nThe deliverable will also contain: ${required.join(', ')}.\nDo not write a criterion that forbids this section's presence or dictates an ordering it cannot satisfy.`
    : '';
  return `# Request\n\n${request}${requiredBlock}`;
}

// v7 item 1: tool-grounded verification (relay/runs/2026-09-14T00-20-44-997Z/
// deliverable.md §1). Gated on config.verify.enabled - absent or false keeps
// v6 behaviour byte-for-byte (no ground_truth key on the returned result, no
// tool invocation, this function never called). When enabled, each entry in
// config.verify.tools ({ tool, args? }) is run through the fixed allowlist in
// src/tools.js - never a generic shell executor - and the raw, unedited
// result is both kept for the run record and rendered into a block appended
// to `request`, which every later stage's prompt already threads through, so
// "re-presented unedited to later seats' context" costs no new plumbing.
export function renderGroundTruth(groundTruth, heading = 'Ground truth (tool output, verbatim)') {
  if (!groundTruth.length) return '';
  return `\n\n# ${heading}\n${groundTruth.map(g =>
    `\n## ${g.tool}${g.args && Object.keys(g.args).length ? ` ${JSON.stringify(g.args)}` : ''}\n${JSON.stringify(g.result)}`
  ).join('\n')}`;
}

// v7.3: resource allocator. The disagreement signal is a criterion split
// across the panel THIS round - some voting critics marked it FAILED,
// others didn't - derived from data the unanimous-signoff loop already
// computes (each critique's own `failures[]`), not a new field. Chosen over
// the other two candidates in the proposal (stance values in
// debate.posts[], amend/withdraw counts in debate.replies[]) because it is
// the only one of the three that exists on every unanimous-signoff run: the
// debate stage is itself optional (config.debate), so a chain with no
// debate has no posts/replies to derive disagreement from, but every
// unanimous-signoff run has per-critic failures by construction. A
// criterion unanimously failed (every voting critic) or unanimously passed
// (no voting critic) is not disagreement - it is consensus, agreeing or
// not - and is excluded. Among genuinely split criteria, the one closest to
// an even split (min(failedCount, votingCount - failedCount), maximized) is
// the single most contested, and gets the one extra round this stage
// spends - never the whole set, so the mechanism can't turn into a second
// uniform round depth by accident. Exported for direct, offline testing.
export function pickContestedCriterion(voting) {
  if (!Array.isArray(voting) || voting.length < 2) return null;
  const failedBy = new Map();
  for (const v of voting) {
    for (const f of v.critique?.failures || []) {
      if (!f?.criterion) continue;
      // The same criterion with and without its list number (or case, spacing, a closing full stop) is ONE criterion here, as it is for the objection id; the text kept for it is the first one seen, without its list number.
      const key = criterionKeyOf(f.criterion);
      if (!failedBy.has(key)) failedBy.set(key, { criterion: stripListMarker(f.criterion), labs: new Set() });
      failedBy.get(key).labs.add(seatKeyOf(v.seat));   // by seat KEY: two seats of one model on one layer are two voters (the count is compared with voting.length, a count of seats)
    }
  }
  let best = null;
  for (const { criterion, labs } of failedBy.values()) {
    const failCount = labs.size;
    if (failCount === 0 || failCount === voting.length) continue; // unanimous - not disagreement
    const score = Math.min(failCount, voting.length - failCount);
    if (!best || score > best.score) best = { criterion, failedBy: [...labs].map(labFromKey), votingCount: voting.length, score };
  }
  return best;
}

export function runVerification(config, { runTool = defaultRunTool, log = () => {} } = {}) {
  const specs = config?.verify?.tools || [];
  const cwd = config?.verify?.cwd || process.cwd();
  const groundTruth = [];
  for (const spec of specs) {
    if (!spec || !ALLOWED_TOOLS.includes(spec.tool)) {
      log(`  skipped: "${spec?.tool}" is not on the tool allowlist (${ALLOWED_TOOLS.join(', ')})`);
      continue;
    }
    const result = runTool(spec.tool, spec.args || {}, { cwd });
    log(`  ${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''}: ${result.ok ? 'ok' : `error - ${result.error}`}`);
    const entry = { tool: spec.tool, args: spec.args || {}, result };
    // v3 §Item 2: an optional `expect.contains` marker on the spec, paired with a `fact`
    // name, turns a raw read_file result into an explicit ground-truth fact - additive,
    // specs without `expect` are untouched so every existing caller stays byte-identical.
    // `result.ok === false` (e.g. the target file is missing) can't distinguish "not
    // applied" from "can't tell", so it's surfaced as its own 'unknown' value rather than
    // folded into false.
    if (spec.expect?.contains !== undefined && spec.fact) {
      entry[spec.fact] = !result.ok
        ? 'unknown'
        : (typeof result.text === 'string' && result.text.includes(spec.expect.contains)) || 'not_applied';
    }
    groundTruth.push(entry);
  }
  return groundTruth;
}

// v4 item 2: the identity decision (relay/runs/2026-09-15T01-35-10-051Z/deliverable.md §2) -
// review the task DESCRIPTION only, never a diff, so no critic ever authors code. Gated on
// config.preflight being present - absent, this function is never called and behaviour is
// byte-for-byte v3's. Its own artifact, preflight-verdict.json, never touches `propose`.
//
// Correction to the plan's own "Research" line: the existing post-propose debate-aggregation
// code (the `config.debate` block later in this file) cannot run "unmodified" against
// task-description text - it is built around anonymising and cross-critiquing a POOL of
// distinct per-lab proposals, which has no equivalent when every seat is reviewing the same
// shared task text. Checked directly before writing this. What's built instead is a small,
// independent function in the same concurrent-Promise.all-over-labs shape as that block, sized
// to what a description-only review actually needs (no anonymisation, no cross-lab posts/
// replies - every seat reviews the same fixed text and returns one independent verdict).
export { PREFLIGHT_SYSTEM } from './stage-system.js';

export function preflightUser(request) {
  return `# Task description under review (no diff or proposal exists yet)\n\n${request}`;
}

// seats: config.preflight.seats if given, else config.seats.critics (the existing critics
// seats, reused - never config.seats.proposers, which stays the only diff-authoring role).
export async function runPreflightStage(config, { request, invoke, record, log = () => {} }) {
  const seats = (config.preflight?.seats && config.preflight.seats.length) ? config.preflight.seats : (config.seats.critics || []);
  const verdicts = await settleAll(seats.map(async seat => {
    const lab = seatKeyOf(seat);
    try {
      const s = record(await invoke(seat, {
        system: PREFLIGHT_SYSTEM,
        user: preflightUser(request),
        log, label: `preflight-${lab}`,
      }));
      const parsed = parseJson(s.text, { strict: true });
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #6): anything but the
      // exact "object" used to read as "pass" - a null parse, a cut-off reply, "Object" in another
      // case - so a garbled objection waved the task through. Only a stated "pass" passes now; an
      // unreadable reply is recorded as `unreadable` (like an unreachable seat, it does not block on
      // its own, and it is never a pass). A single string objection is still an objection.
      const stated = typeof parsed?.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : null;
      const rawObjections = Array.isArray(parsed?.objections) ? parsed.objections : typeof parsed?.objections === 'string' ? [parsed.objections] : [];
      const objections = rawObjections.filter(o => typeof o === 'string' && o.trim());
      const verdict = stated === 'object' ? 'object' : stated === 'pass' ? 'pass' : 'unreadable';
      return { lab, verdict, objections };
    } catch (err) {
      rethrowControlFlow(err);
      // A seat that fails to answer at all does not get to silently count as a "pass" that
      // could tip a marginal call - it's recorded distinctly, and does not block on its own
      // (an unreachable seat is not evidence the task is malformed).
      return { lab, verdict: 'error', objections: [], error: String(err.message).slice(0, 200) };
    }
  }));
  const blocked = verdicts.some(v => v.verdict === 'object' && v.objections.length > 0);
  return { verdicts, blocked };
}

// A "seat" is one lab's model occupying one slot in the chain.
//   { provider, model, maxTokens?, temperature? }

// Qwen3.5-9B (2026-09-10, three real runs against the same task, 3/3 failed identically):
// when quoting a source phrase verbatim inside a JSON string value, it wraps the quote in
// markdown-style 'single quotes' but leaves any literal " inside that span unescaped (e.g.
// `"evidence": "...states: 'no mention of "The Council," no round count...'"` - the inner "
// terminates the JSON string early). Separately (same evening, a different run): a raw
// unescaped newline landed inside a string value instead of \n. Both are mechanical, safe to
// repair by scanning with real string-state tracking rather than a single regex (a regex can't
// tell "the real closing quote" from "a stray quote mid-sentence" without looking at what comes
// next). A quote is only treated as ending a string if the next non-whitespace character is a
// plausible JSON continuation (, : } ]) or end-of-text; otherwise it's escaped in place. This
// was verified against all three real broken runs (fixed the one that was otherwise-clean; the
// other two had additional, genuinely garbled model output - e.g. a stray `;` and leaked
// CSS-looking text - that no mechanical repair should paper over) and regression-checked against
// every other already-valid critique reply on disk at the time (26 files, zero broken).
function repairStrayQuotesAndControlChars(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && inString) {
      out += c;
      if (i + 1 < text.length) { out += text[i + 1]; i++; }
      continue;
    }
    if (inString && (c === '\n' || c === '\r' || c === '\t')) {
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t';
      continue;
    }
    if (c === '"') {
      if (!inString) {
        inString = true;
        out += c;
        continue;
      }
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      if (next === undefined || ',:}]'.includes(next)) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}


// A closing bracket with nothing to close (B3 run 4, Haiku 5.5, 2 Nov 2026: a verdict with one `]` too many right after its criteria array, the rest of it well formed; the reply ended normally, so it was malformed, not cut off,
// and neither JSON.parse nor the repairs above read it). The scan follows JSON's own string rule, the one scanBraceSpans uses (a backslash skips the next character, a quote toggles the string), and keeps a stack of the `[` and `{`
// that are open. A `]` or `}` that matches the innermost opener is kept. One that matches NOTHING open anywhere on the stack (no `[` for a `]`, no `{` for a `}`) is dropped: it closed nothing, so removing it moves no value, no key
// and no array element. One whose opener IS open deeper (a `{` still open where a `]` arrives: a closer MISSING, not one too many) is ambiguous, and the text comes back unchanged, so it stays unreadable. Since 2 Nov 2026 (owner: "pause") such a reply is NEAR-JSON
// and, in the readers that have the pause (nearJsonPause), the run pauses for a person or a handler to repair it; elsewhere it keeps today's abstention. Only a character that is not a quote or a backslash, outside every string, is ever removed, so no string boundary can move and no quoted word of the seat's is touched. No regex: judges quote draft text full of brackets.
// Every stray closer is dropped, not just the first: dropping a closer that matched nothing never changes the stack, so each later closer is judged exactly as it would be if the earlier one had never been there (the trailing-comma repair beside it is global too).
/**
 * 3 Nov 2026 (owner's pick "Auto + handler tool": "punctuation fixes that keep every word in the same order"): a key whose opening quote is missing. Outside every string (JSON's own string rule), right after a `{` or a
 * `,`, a name made of letters, digits and underscores that is followed by `"` and a colon is a key that lost its opening quote; the quote is added. Nothing else is touched: one reading, one character added, every word in
 * its place (repairAcceptance would take it). B2, 29 Oct 2026: `{ "on": "B-2", stance": "merge", ...` in mimo-v2.6-pro's proposal-stage debate reply, read as "no posts counted".
 */
function quoteBareKeyStarts(text) {
  let out = '';
  let inString = false;
  let prev = null;   // the last character outside strings that is not white space
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[i + 1] ?? ''; i++; } else if (ch === '"') inString = false;
      continue;
    }
    if ((prev === '{' || prev === ',') && /[A-Za-z_]/.test(ch)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)"(\s*:)/.exec(text.slice(i, i + 200));
      if (m) { out += `"${m[1]}"${m[2]}`; i += m[0].length - 1; prev = ':'; continue; }
    }
    if (ch === '"') inString = true;
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
  }
  return out;
}

function dropStrayClosers(text) {
  const open = [];
  let out = '';
  let inString = false;
  let dropped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { if (i + 1 < text.length) out += text[++i]; } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '[' || c === '{') { open.push(c); out += c; continue; }
    if (c === ']' || c === '}') {
      const want = c === ']' ? '[' : '{';
      if (open[open.length - 1] === want) { open.pop(); out += c; continue; }
      if (open.includes(want)) return text; // its opener is open deeper: a missing closer, not an extra one
      dropped = true; continue;
    }
    out += c;
  }
  return dropped ? out : text;
}

// A seat with no `maxTokens` of its own gets this. Was 8000 until 2026-09-20, when the pilot showed
// reasoning seats spending the whole budget on thinking and losing their verdict (see the
// "unheard" comment in the critic loop). It is a ceiling, not a price: only tokens actually
// generated are billed. The spend cap still projects it as the worst case.
export const DEFAULT_MAX_TOKENS = SEAT_DEFAULT_MAX_TOKENS; // 36000, single source in cost.js
// One bigger-cap retry for a critic whose reply was cut off, never more than this.
export const CUT_OFF_RETRY_MAX_TOKENS = 64000;
// The retry cap for a reply cut off at `cap`: double it, bounded by `ceiling` (default CUT_OFF_RETRY_MAX_TOKENS; since 0.8.1 a call
// site passes the seat's own ceiling, retryCeilingOf in src/reasoning.js: the model's maximum, bounded by its transport), but
// never BELOW the seat's own cap. 2026-09-22: a seat given a 360k cap (above the 64k bound) would
// otherwise have been "retried with a bigger cap" of 64k - a smaller one, certain to cut off again.

// The sentence a criteria retry appends to the criteria prompt, by what the gate found ('infeasible': a criterion one document can never satisfy; 'meta': criteria about the criteria list). 0.8.2 wiring (6a, ticket 24):
// the held function `criteriaRetryNote(kind, quoted)` in src/roles.js (after the re-record) holds BOTH sentences (they leave this file) and adds, for 'meta', the sentence about a request's own list of requirements; until then these
// two are the sentences that have always been sent, byte for byte.
function criteriaRetryNote(kind, quoted) {
  const recorded = held('criteriaRetryNote');
  if (recorded) return recorded(kind, quoted);
  return kind === 'infeasible'
    ? `Your previous answer contained a criterion the draft can never satisfy: "${quoted}". The draft is ONE document. Any other file named in the request is produced by a later stage of this pipeline, not by the draft. Write criteria that one document can satisfy.`
    : `Your previous answer described the format of a criteria list ("${quoted}") instead of the deliverable the request asks for. Write criteria that a reader checks against that deliverable itself.`;
}

// 0.8.2 wiring (4a-4d, decision 2 third part, owner "Yes x3" 5 Oct): in a chain with debate_hygiene.noQuoteMarks (which is what records `quoted` on a post) the author's reply prompt shows the mark "[no quote]" before the
// colon of an objection or merge that quotes nothing, the reply prompts say what the mark means, and the debate prompts tell a poster to copy the phrase it talks about. The words are held (src/held-roles.js):
// `replyUserMarked` / `altReplyUserMarked` (the whole reply prompt, byte-identical to R.replyUser / R.altReplyUser when no post is unquoted), `noQuoteGloss`, `debatePostQuoteRule`. Until the re-record each falls back to the
// prompt that has always been sent.
const replyUserFor = config => (noQuoteMarksOn(config) ? (held('replyUserMarked') ?? R.replyUser) : R.replyUser);
const altReplyUserFor = config => (noQuoteMarksOn(config) ? (held('altReplyUserMarked') ?? R.altReplyUser) : R.altReplyUser);

// Criteria that describe the criteria list (its JSON shape, what each criterion must be) rather
// than the deliverable. Any one JSON-shape item flags it; otherwise a third or more of the items
// talking about "criterion/criteria" does. Returns the offending items.
export function metaCriteria(criteria, { shapeOnly = false } = {}) {
  const list = (criteria || []).filter(c => typeof c === 'string');
  // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #7): "json object" or
  // "list of strings" alone flagged a legitimate criterion about the deliverable (an API that
  // returns a JSON object). The shape words now count only when the criterion is about criteria.
  const shape = list.filter(c => /["'`]criteria["'`]\s*key/i.test(c)
    || (/json object|list of strings/i.test(c) && /\bcriteri(on|a)\b/i.test(c)));
  if (shape.length || shapeOnly) return shape;
  const about = list.filter(c => /\bcriteri(on|a)\b/i.test(c));
  return about.length >= 2 && about.length / list.length >= 1 / 3 ? about : [];
}

// Criteria a single build stage cannot satisfy, whatever it writes: ones that require documents
// this harness produces in its own later stages (BOARD.md from the debate record, HANDOFF.md from
// the handoff stage), or that demand several named .md files at once. 2026-09-22: a Zofia run burned
// six paid rounds and ended in a dispute because every seat agreed the draft could not be three
// documents at once. Returns the offending criteria.
export function infeasibleCriteria(criteria, { handoff = false, debate = false } = {}) {
  const list = (criteria || []).filter(c => typeof c === 'string');
  return list.filter(c => {
    const files = [...new Set((c.match(/\b[A-Za-z0-9_-]+\.md\b/g) || []).map(f => f.toUpperCase()))];
    // Bug-audit fix, 2026-09-23 (BugAudit_ChainParsers #7): any two .md names flagged it, so "does
    // not contradict DECISIONS.md or CLAUDE.md" stopped the run. Naming documents to stay consistent
    // with is not demanding them; only a criterion that asks for several documents is infeasible.
    const refersOnly = /\b(contradict\w*|consistent|conflict\w*|cite[sd]?|citing|refer\w*|according to|per|in line with|align\w*|match(es|ing)?|agree\w*|respect\w*|follow\w*|honou?r\w*)\b/i.test(c);
    if (files.length > 1 && !refersOnly) return true;
    if (handoff && /\bHANDOFF\.md\b/i.test(c)) return true;
    if (debate && /\bBOARD\.md\b/i.test(c)) return true;
    return false;
  });
}

// The author's prompt for an injected canary post: the ordinary reply prompt, with the canary's
// poster shown under a normal anonymised lab label (R.canaryPosterLabel) instead of the raw
// `canary` id, which rendered as "undefined". Pre-release audit 2026-09-23
// (ProposalsDebateDispute #1); test/canary.test.js pins that no probe wording reaches it.
export function canaryReplyPrompt({ request, proposals, post, lab, maps, guard = false, render = R.replyUser }) {
  const shown = { ...maps, labTo: { ...maps.labTo, [post.by]: R.canaryPosterLabel(maps, lab) } };
  return render({ request, proposals, posts: [post], lab, maps: shown, guard });
}

// Tiered councils, the majority guard (config.majority_guard.enabled): a withdrawal counts only when
// it quotes the argument it concedes to. `conceded_to` must match the text of a post on that same
// proposal (normalised: case, whitespace and quote marks); otherwise the reply is kept on the record
// as a withdrawal with `unargued: true`, and the proposal stays for the builder to judge. Mutates
// the replies in place (the report keeps both the action and the flag).
//
// The quote is matched against the post as the author was shown it (R.boardText: a leading "#"
// escaped as "\#", the <critic-claim> tag defused) as well as the raw post, so an author that
// copies an objection containing "#" verbatim from its prompt is not marked unargued (verification
// of thc-research PR #13, finding 3).
export function guardWithdrawals(replies, posts, log = () => {}, textVariants = x => [x.text]) {
  const norm = t => String(t || '').toLowerCase().replace(/[\u2018\u2019\u201c\u201d"'`]/g, '').replace(/\s+/g, ' ').trim();
  for (const r of replies) {
    if (r.action !== 'withdraw') continue;
    const quote = norm(r.conceded_to);
    const on = posts.filter(x => x.on === r.id && x.stance !== 'support');
    const hit = quote.length >= 8 && on.some(x => textVariants(x).some(t => norm(t).includes(quote) || norm(R.boardText(t)).includes(quote)));
    r.conceded_to = typeof r.conceded_to === 'string' ? capField(r.conceded_to, { field: 'conceded_to' }) : undefined;
    if (!hit) {
      r.unargued = true;
      log(`  majority guard: ${r.id} - its author withdrew it without quoting the argument it concedes to; it stays for the builder to judge.`);
    }
  }
  return replies;
}

// A merge_with / replaced_by reference as recorded: a real id on this board or nothing. Pre-release
// audit 2026-09-23 (DecisionRecords #3): these were neither checked nor capped, so a 50k-char
// "id" reached the board uncut and a made-up one read like a real withdrawal target.
export function boardRef(raw, maps, ids) {
  if (raw == null || raw === '') return undefined;
  const id = maps.idFrom[raw] || raw;
  return typeof id === 'string' && ids.has(id) ? id : undefined;
}

// Debate posts and author replies the stage's filters reject (0.7.8, thc-research brief 10 W3).
// The filters are unchanged; what changed is that a rejected item is counted, per lab and per
// reason, into report.json's `debate.dropped` and BOARD.md, instead of vanishing. Silent drops were
// the most common defect across the 22 council/debate repos that brief read, and the raw reply on
// disk was the only trace of one here. Reasons:
//   debate  - unknown_target (no proposal has that id), own_proposal (a lab posting on its own),
//             bad_stance (not support/object/merge), unreadable (the whole reply did not parse;
//             how many posts it held is unknown, so it counts once).
//   replies - unknown_target, not_own_proposal (another lab's proposal), not_posted_on (its own
//             proposal, but nobody posted on it, so there was nothing to answer), bad_action (not
//             keep/amend/withdraw), unreadable.
export function debatePostDropReason(post, lab, proposals) {
  if (!proposals.some(p => p.id === post.on)) return 'unknown_target';
  if (!proposals.some(p => p.id === post.on && p.lab !== lab)) return 'own_proposal';
  if (!['support', 'object', 'merge'].includes(post.stance)) return 'bad_stance';
  return null;
}

export function debateReplyDropReason(reply, lab, proposals, mineWithPosts) {
  if (!proposals.some(p => p.id === reply.id)) return 'unknown_target';
  if (!proposals.some(p => p.id === reply.id && p.lab === lab)) return 'not_own_proposal';
  if (!mineWithPosts.some(p => p.id === reply.id)) return 'not_posted_on';
  if (!['keep', 'amend', 'withdraw'].includes(reply.action)) return 'bad_action';
  return null;
}

// [{ stage, by, reason }] -> [{ stage, by, reason, count }], one row per (stage, lab, reason), in
// the order first seen (labs settle in roster order, so this is stable across runs).
export function tallyDropped(items) {
  const rows = new Map();
  for (const { stage, by, reason } of items) {
    const key = `${stage}\u0000${by}\u0000${reason}`;
    if (rows.has(key)) rows.get(key).count += 1;
    else rows.set(key, { stage, by, reason, count: 1 });
  }
  return [...rows.values()];
}

function describeDropped(items) {
  const rows = tallyDropped(items);
  return `${rows.reduce((a, r) => a + r.count, 0)} dropped (${rows.map(r => `${r.count} ${r.reason}`).join(', ')})`;
}

// Audit A1-4 (0.8.1): the cap a reply in hand was really asked at. An Anthropic seat's invoke() may have retried at a bigger cap (`stage.cappedAt`); every
// judgement of that reply (cut off? all reasoning? truncated?) must use THAT cap, not the one the call site started from, or a normal long reply reads as
// truncated and gets a third paid call. Never below the cap the caller started from (a corrupt record cannot shrink it).
export const askedCapOf = (stage, fallback) => (Number.isFinite(stage?.cappedAt) && stage.cappedAt >= fallback ? stage.cappedAt : fallback);
export function cutOffRetryCap(cap, ceiling = CUT_OFF_RETRY_MAX_TOKENS) {
  return retryCapFor(cap, ceiling);
}

/**
 * The per-seat proposal cap a chain asks for, or null (no cap). 0.8.3 (C&C ruling, 13 Oct 2026): the documented spelling is the TOP-LEVEL `max_proposals_per_seat` (README, docs/index.html);
 * the older nested `proposals.maxProposalsPerSeat` keeps working (nothing shipped uses it). A positive integer is a cap; anything else is "no cap" under either spelling (a negative value
 * must not slice from the end of a list: test/proposal-cap.test.js). A chain that sets BOTH spellings to different values is refused: it would run one cap and read like the other.
 */
export function proposalCapOf(config) {
  const top = config?.max_proposals_per_seat;
  const nested = config?.proposals?.maxProposalsPerSeat;
  if (top !== undefined && nested !== undefined && top !== nested) {
    throw new Error(`this chain sets the proposal cap twice with different values: max_proposals_per_seat is ${JSON.stringify(top)} and proposals.maxProposalsPerSeat is ${JSON.stringify(nested)}. Keep one: max_proposals_per_seat, the documented key.`);
  }
  const v = top !== undefined ? top : nested;
  return Number.isInteger(v) && v > 0 ? v : null;
}

// Repairs, mildest first. Each one targets a slip a real seat has made:
//  - trailing comma before ] or } (GLM 5.3 Flash)
//  - a key written as a bare string, "reason: text" instead of "reason": "text"
//    (Mistral Large, six times in one reply, 2026-09-07)
//  - a stray unescaped quote or raw control char inside a string value (Qwen3.5-9B, 2026-09-10)
//  - a key whose opening quote is missing, `, stance": "merge"` (B2, the proposal-stage debate of mimo-v2.6-pro, 29 Oct 2026; quoteBareKeyStarts): one quote is added, nothing else. On its own, before the stray closer.
//  - a closing ] or } with no opener of its kind open anywhere (one `]` too many after a criteria array: Haiku 5.5, B3 run 4, 2 Nov 2026; dropStrayClosers). Last, so every milder repair is tried first. On its own on purpose: a
//    reply with this slip AND a trailing comma stays unreadable (near-JSON: see nearJsonPause).
export const PARSE_REPAIRS = [
  c => c,
  c => c.replace(/,\s*([\]}])/g, '$1'),
  c => c.replace(/"([A-Za-z_][A-Za-z0-9_ ]*):\s+([^"]*)"/g, (all, k, v) => `"${k}": "${v.replace(/"/g, '\\"')}"`).replace(/,\s*([\]}])/g, '$1'),
  c => repairStrayQuotesAndControlChars(c).replace(/,\s*([\]}])/g, '$1'),
  c => quoteBareKeyStarts(c),
  c => dropStrayClosers(c),
];
/** One span read with the repairs: { ok, value, text } where `text` is the exact string that parsed (duplicate keys are checked on it). */
const readWithRepairs = span => {
  for (const repair of PARSE_REPAIRS) { const text = repair(span.trim()); try { return { ok: true, value: JSON.parse(text), text }; } catch { /* try the next repair */ } }
  return { ok: false };
};
// A span that looks like an attempt at JSON (it holds a quoted key). One that does not parse is a FAILED ATTEMPT; a prose span like {quick} is not.
const JSON_LOOKING = /"[^"\n]*"\s*:/;
// 3 Nov 2026 (owner's pick "Auto + handler tool"; C&C's ruling: the narrow rule): an object that a quoted key DIRECTLY continues (white space, an optional comma, then `"key":`) was closed too early, and the keys after
// it are still the seat's. B3 run 5, pass 24, Haiku 5.5: a stray `}` after the criteria array closed the verdict before its "failures" key, the span reader kept the first object, and the failures list was lost
// without a word (a sign-off could be read the same way from a reply that, well formed, is contradictory). Such a read is never an answer: the readers below return null, and the near-JSON pause takes it where
// the reader has one. Narrow on purpose: prose after a valid verdict that happens to hold a quoted word and a colon is not a continuation.
const KEY_DIRECTLY_AFTER = /^\s*,?\s*"(?:[^"\\\n]|\\.)*"\s*:/;
/** True when the object that closes at `end` (the index of its `}`) is directly continued by a quoted key. */
const continuedAt = (text, end) => KEY_DIRECTLY_AFTER.test(text.slice(end + 1));

/**
 * Reads JSON out of a model's reply. Models wrap JSON in prose or fences no matter how firmly you ask them not to, and the small ones leave a trailing comma (GLM 5.3 Flash, 2026-09-07).
 *
 * The decision table is Review/Build_0.8.3/m6-closing/E_ParseJson_Decision_Table.md (ruled 13 Oct 2026, Amendment 2 after Astra's review the same day); test/parse-json-prose-braces.test.js has
 * one test per row. Three kinds of caller:
 *  - N (no option): tolerant, the baseline everywhere it read, and in the span path a reply with exactly one JSON span.
 *  - V `{ verdict: true }`: the callers whose reply becomes a panel verdict (normaliseCritique). A critic is told to quote the draft, and the draft is full of `{"meets": true}`, so a quoted span must
 *    never stand in for a verdict the seat did not give. Beside the chosen answer (fenced or not) any failed JSON-looking attempt, any cut-off verdict, a duplicate key, contradictory decision
 *    fields, or another readable span standing for a DIFFERENT verdict, or for the same verdict with a different decision payload, gives null: an abstention and one re-ask, never a sign-off or an
 *    objection on the record.
 *  - S `{ strict: true }`: decision-bearing callers with no verdict polarity (the run's criteria, the security review, preflight, the cold reader): the same guards, with "distinct readable object" in
 *    place of "different verdict".
 * Baseline order is kept (the whole reply, the first fenced block, an unclosed fence, the first-to-last brace span: the first that parses wins); the guards only ever turn a parsed value into null.
 * Only when nothing parses, the outermost balanced `{...}` spans are read (audit A4-1: prose with braces of its own, "Verdict check {quick}: {...}").
 */
export function parseJson(text, { verdict = false, strict = false, expect = null, rulingsDecide = false } = {}) {   // rulingsDecide (0.8.4 S7b A3b): true only for the two verdict reads of an ask that showed the S7b section; it makes a `rulings` key decision-bearing in the duplicate-key and same-verdict comparisons. false = today's reading, byte for byte
  // E3b: the verdict envelope. The panel call sites pass `expect` when the run issues the reply identity (withEnvelope, the run.json flag); a run that does not, passes none and reads by the paths below. See readExpecting.
  if (expect) return readExpecting(text, expect, { rulingsDecide });
  const guarded = verdict || strict;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const openFence = text.match(/```(?:json)?\s*([\s\S]*)$/); // closing fence missing
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  // Guarded callers: a `{` after the last `}` that never closes and is followed by a quoted key is a verdict that was cut off. The first-to-last span must not then be read, because it can end at
  // an EARLIER object (a sign-off the seat quoted from the draft) and turn a broken verdict into a SIGN-OFF - found at 59756d5 while testing the rules below, an older defect than the audit item;
  // no run produced it, its incident is the test row T-D2 in test/parse-json-prose-braces.test.js. A trailing prose `{` with no key after it does not count.
  const scan = scanBraceSpans(text);
  const cutOffTail = guarded && scan.unclosed && scan.unclosedAt > last && JSON_LOOKING.test(text.slice(scan.unclosedAt));
  const braces = !cutOffTail && first !== -1 && last > first ? text.slice(first, last + 1) : null;
  const candidates = [['whole', text], ['fence', fenced?.[1]], ['openFence', openFence?.[1]], ['wide', braces]].filter(([, c]) => c);
  for (const repair of PARSE_REPAIRS) {
    for (const [path, c] of candidates) {
      const jsonText = repair(c.trim());
      let value;
      try { value = JSON.parse(jsonText); } catch { continue; /* try the next shape */ }
      if (path === 'wide' && continuedAt(text, last)) continue;   // the first-to-last span closed before a key the seat still wrote (KEY_DIRECTLY_AFTER): never the answer; a later repair may still read the whole reply
      if (!guarded) return value;
      if (duplicatesChangeTheDecision(jsonText, value, { verdict, rulingsDecide }) || (verdict && contradictory(value))) return null;
      return path === 'fence' || path === 'openFence' ? checkedAgainstTheRest(path, value, text, { verdict, rulingsDecide }) : value;
    }
  }
  return readSpans(scan, { verdict, strict, rulingsDecide }, text);
}

/**
 * 2 Nov 2026 (the pause for a near-JSON reply, src/near-json.js): a reply is NEAR-JSON when it starts with `{` and a quoted key (as a whole, or inside its first fence) and still reads null after every repair, even read
 * the tolerant way (no guard). So a reply that parses and is only refused by a guard (an all-MET table beside `meets: false`, a duplicate key, the ids of the verdict envelope missing) is not near-JSON, a prose reply is not,
 * and a prose reply that quotes a JSON example of the draft is not. The caller adds the rest: the reply was not cut off (abstentionReasonCode is REPLY_UNPARSEABLE) and the seat is not external.
 * 3 Nov 2026: a verdict closed before a key it still carries (KEY_DIRECTLY_AFTER, the B3 run 5 pass-24 shape) reads null the tolerant way too, so it is near-JSON and pauses where the reader has the pause.
 */
export function isNearJsonReply(text) {
  if (typeof text !== 'string') return false;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const openFence = text.match(/```(?:json)?\s*([\s\S]*)$/)?.[1];
  if (![text, fenced, openFence].some(c => typeof c === 'string' && /^\{\s*"[^"\n]*"\s*:/.test(c.trimStart()))) return false;
  // A brace that never closes is a reply that was cut off, or one whose last closer is missing: a handler who only closed the brackets would leave a verdict the seat never finished. It keeps the bigger-cap re-ask path / today's abstention.
  if (scanBraceSpans(text).unclosed) return false;
  return parseJson(text) === null;
}

/**
 * The pause for a near-JSON reply, for every reader that has it (the panel verdict read, the layer exchange, the final read, the first-mode critic): the ExternalPause to throw, or null.
 * C&C's rule (2 Nov 2026, on his words "let the handler session repair what is easily repairable" and "pause"): the pause applies wherever an unreadable near-JSON reply would otherwise remove a paid seat's contribution from the record
 * (an abstention, or "no posts"). It REPLACES the re-ask for near-JSON only; that supersedes the 0.8.2 rule "one re-ask, then abstention" for this class of reply, and nothing else. Never: a run that cannot resume in its own folder
 * (setRepairPauses), an external seat's own text, a reply the provider cut off or ended with an error (abstentionReasonCode is not REPLY_UNPARSEABLE), a reply whose brace never closes, a reply that parses, prose.
 * `st` is the stage record of the call whose reply is unreadable (its label is the stage to repair); `system` and `user` are the strings that call was sent (the repair is held to their hash on resume).
 */
/**
 * 3 Nov 2026 (owner's pick "Auto + handler tool": "At a pause, the handler gets the MCP repair tool for cases that need judgment: ... a paraphrased row"; "Everything else is re-asked as today"): a sign-off whose table is
 * COMPLETE (one row per criterion) but that row matching could not read (by text, or by position under its guards: src/criteria-ledger.js) pauses for a repair instead of being re-asked. An incomplete table is re-asked
 * as before (a missing row is never filled). Never in a run that cannot resume in its own folder, never for an external seat's own text, never for a reply cut off by the provider, never for a stage already repaired for
 * this prompt, and never when the stage's recorded prompt is not the one `system`/`user` hold (the cut-off path can hand back an earlier reply). The ExternalPause to throw, or null.
 */
function tablePause(st, seat, system, user, gap, criteria, rows) {
  if (!repairPauses || !st || st.provider === 'external' || typeof st.label !== 'string' || typeof system !== 'string' || typeof user !== 'string') return null;
  if (gap?.kind !== 'missing_rows' || !Array.isArray(criteria) || !Array.isArray(rows) || rows.length !== criteria.length) return null;
  if (providerCutOff(st.usage)) return null;
  const hash = promptHashOf(system, user);
  if (st.promptHash && st.promptHash !== hash) return null;
  if (cache.repaired?.(st.label, hash)) return null;
  return new ExternalPause(st.label, system, user, seat?.model ?? null, { original: st.text, refusal: null, kind: 'table_rows', criteria: criteria.map(String), rows: gap.criterion_ids.map(id => Number(String(id).replace(/^C/, ''))) });
}

/**
 * 4 Nov 2026 (unit 8; owner's pick "Auto + handler tool": a one-letter id slip goes to the handler; C&C: exchange post ids only, ships in 0.8.4): an exchange post, or an answer to one, that names an objection id one
 * character from exactly one id the judge was shown (src/near-json.js idSlipsOf) pauses for a repair instead of being dropped. The same guards as tablePause: a run that can resume in its own folder, never an external
 * seat's own text, never a reply cut off by the provider, the recorded prompt is the one asked, never a stage already repaired (or declined) for this prompt. `slips` [{ from, to }], `shown` the ids the judge was shown.
 * The ExternalPause to throw, or null (the post is then dropped as before). Called at the two exchange call sites, never inside src/layer-debate.js.
 */
function idSlipPause(st, seat, system, user, slips, shown) {
  if (!repairPauses || !st || st.provider === 'external' || typeof st.label !== 'string' || typeof system !== 'string' || typeof user !== 'string') return null;
  if (!Array.isArray(slips) || !slips.length) return null;
  if (providerCutOff(st.usage)) return null;
  const hash = promptHashOf(system, user);
  if (st.promptHash && st.promptHash !== hash) return null;
  if (cache.repaired?.(st.label, hash)) return null;
  return new ExternalPause(st.label, system, user, seat?.model ?? null, { original: st.text, refusal: null, kind: 'id_slip', slips, shown: [...shown] });
}
const slipWords = slips => slips.map(p => `${p.from} for ${p.to}`).join('; ');

function nearJsonPause(st, seat, system, user, shownSystem = null) {   // cache part (b)1: `shownSystem` = the system text the call would have sent before the cache-shaped order (the repair request shows it as the reply format); null where the order is not live
  if (!repairPauses || !st || st.provider === 'external' || !st.usage || typeof st.label !== 'string' || typeof system !== 'string' || typeof user !== 'string') return null;
  // 3 Nov 2026: a stage that was repaired (or declined) for this prompt is read as it is, never paused a second time; a repair that still reads null is an abstention. The signal is the accepted marker in originals/
  // (stage cache `repaired`): the repaired stage now replays under its real provider, so `external` above only means an external seat's own text.
  if (cache.repaired?.(st.label, promptHashOf(system, user))) return null;
  if (abstentionReasonCode(st.usage, askedCapOf(st, seat?.maxTokens ?? DEFAULT_MAX_TOKENS)) !== 'REPLY_UNPARSEABLE') return null;
  if (!isNearJsonReply(st.text)) return null;
  return new ExternalPause(st.label, system, user, seat?.model ?? null, { original: st.text, refusal: null, ...(typeof shownSystem === 'string' ? { shownSystem } : {}) });
}

/** The pair this call expects must be two 12-hex strings: a malformed one would make `undefined === undefined` admit every quoted verdict, so a verdict path throws instead of failing open. */
function checkedExpect(expect) {
  if (!isEnvelopePair(expect)) throw new Error('parseJson: `expect` must be { review_id, draft_id }, each 12 hex characters');
  return expect;
}
/** A parsed span that carries exactly the pair this call expects (both ids, as strings). */
const carriesPair = (o, expect) => !!o && typeof o === 'object' && !Array.isArray(o) && o.review_id === expect.review_id && o.draft_id === expect.draft_id;

/**
 * The regions a reply is read in, the same split checkedAgainstTheRest uses: the body of every closed fence, the body of a trailing fence whose closing is missing, and the prose outside both. A stray `{`
 * in the prose (code the critic quotes: `if (x) {`) must not hide a verdict in a fence, so a brace that never closes is fatal only when JSON-looking text follows it (the baseline rule).
 */
function replyRegions(text) {
  const closed = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  const withoutClosed = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, ' ');
  const open = withoutClosed.match(/```(?:json)?\s*([\s\S]*)$/)?.[1];
  const outside = withoutClosed.replace(/```[\s\S]*$/, ' ');
  return [outside, ...closed, ...(open === undefined ? [] : [open])];
}

/**
 * The whole reply is scanned first, string-aware (scanBraceSpans), so a triple backtick INSIDE a JSON string (a critic quoting code in a failure's text) can neither cut the verdict apart nor change the text read.
 * Only when that scan leaves a brace unclosed (a stray `{` in quoted code, a cut-off verdict) is the reply split into regions (replyRegions) so the stray brace cannot hide a verdict in a fence. Stated limit: a reply
 * that has BOTH a stray unclosed brace and a triple backtick inside a string falls to the region split and can read null (a span that is not a verbatim part of the reply is refused, so it never reads changed text).
 */
const regionsOf = text => (scanBraceSpans(text).unclosed ? replyRegions(text) : [text]);
/** A span the seat sent is a verbatim substring of its reply; one that is not came from the region split cutting through a string, and is never read (the record must hold what the seat wrote). */
const fromReply = (text, span) => text.includes(span);

/**
 * E3b (ruled 14 Oct 2026): the reply is read for `expect = { review_id, draft_id }`. Candidates come from the outermost balanced spans of each region (replyRegions), not the baseline's whole-text-then-fence order,
 * because a candidate must carry the pair wherever it sits and the examples around it are to be ignored, not chosen between. Only spans that carry BOTH ids equal to the pair are candidates; a span without them is an
 * example and is ignored (a quoted `{"meets": true}` in a fence, a relay seat's earlier verdict, an old example). The rules then: a failed JSON-looking attempt, a cut-off verdict (an unclosed brace followed by
 * JSON-looking text) or a decision-changing duplicate key ANYWHERE gives null (an example's duplicate key included: it is still a failed read of the reply); `contradictory` fields and different decision payloads
 * are judged among the CANDIDATES only (a contradictory example without the ids is only an example). No candidate gives null; why is envelopeReason's question. Candidates are spans inside THIS reply only: the pair
 * of another call (the first attempt of a retry, an earlier re-ask) matches nothing here. The V rules apply whatever `verdict` says; the option is accepted for symmetry with the other callers.
 */
function readExpecting(text, expect, { rulingsDecide = false } = {}) {
  checkedExpect(expect);
  const candidates = [];
  for (const region of regionsOf(text)) {
    const scan = scanBraceSpans(region);
    if (scan.unclosed && JSON_LOOKING.test(region.slice(scan.unclosedAt))) return null;
    for (const [k, span] of scan.spans.entries()) {
      if (!fromReply(text, span)) return null;
      const got = readWithRepairs(span);
      if (!got.ok) { if (JSON_LOOKING.test(span)) return null; continue; }
      if (continuedAt(region, scan.ends[k])) return null;   // an object closed before a key the seat still wrote (KEY_DIRECTLY_AFTER)
      if (duplicatesChangeTheDecision(got.text, got.value, { verdict: true, rulingsDecide })) return null;
      if (carriesPair(got.value, expect)) candidates.push(got.value);
    }
  }
  if (!candidates.length || candidates.some(contradictory)) return null;
  return candidates.every(o => decisionKey(o, rulingsDecide) === decisionKey(candidates[0], rulingsDecide)) ? candidates[0] : null;
}

/**
 * Why a reply that parseJson(text, { expect }) read as null has no candidate, for the record: 'wrong_id' when some readable object carries a review_id or draft_id that is not this call's pair, 'missing' when
 * none carries either, and null whenever the envelope is not the reason: a candidate exists (the null came from ambiguity), or the reply holds a failed JSON-looking attempt or a cut-off verdict (the seat may well
 * have sent the ids; the existing unreadable reason stands and nothing is recorded that the seat did not do). Pure.
 */
export function envelopeReason(text, expect) {
  checkedExpect(expect);
  let sawId = false, sawObject = false;
  for (const region of regionsOf(text)) {
    const scan = scanBraceSpans(region);
    if (scan.unclosed && JSON_LOOKING.test(region.slice(scan.unclosedAt))) return null;
    for (const span of scan.spans) {
      if (!fromReply(text, span)) return null;
      const got = readWithRepairs(span);
      if (!got.ok) { if (JSON_LOOKING.test(span)) return null; continue; }
      if (!got.value || typeof got.value !== 'object') continue;
      sawObject = true;
      if (carriesPair(got.value, expect)) return null;
      if ('review_id' in got.value || 'draft_id' in got.value) sawId = true;
    }
  }
  // C&C's classification order (14 Oct 2026): the envelope is named only when the reply holds a COMPLETE, PARSEABLE object that lacks or mis-states the pair. Prose with no object at all is malformed, not "missing".
  if (!sawObject) return null;
  return sawId ? 'wrong_id' : 'missing';
}

/**
 * E4: the judge's own reasoning for an answer (answers[].evidence) is kept ON the in-memory answer row, as a NON-enumerable property: the ledger reads it, `JSON.stringify` (report.json) and every spread never
 * see it, and the "latest ask counts" splice of a re-ask removes row and evidence together, so the ledger can never show reasoning for a disposition the record no longer holds.
 */
function withEvidence(row, answers) {
  const a = Array.isArray(answers) ? answers.find(x => x && typeof x === 'object' && x.id === row.id && typeof x.evidence === 'string') : null;
  if (a) Object.defineProperty(row, 'evidence', { value: a.evidence, enumerable: false });
  return row;
}

/**
 * E3b unit three (C&C's classification order, 14 Oct 2026): provider error -> truncation (usage) -> malformed JSON -> missing ids -> wrong ids. The envelope may be named ONLY when the usage-based class is the
 * "malformed JSON" fall-through (the reply was not cut off, not ended by an error, not reasoning-exhausted) AND the reply holds a complete parseable object that lacks or mis-states the pair (envelopeReason). A truncated or
 * malformed reply keeps its own reason and never reads envelope "missing". null when no envelope is in use.
 */
function envelopeWhyOf(cs, cap, env) {
  if (!env || !classifyUnreadable(cs.usage, cap).startsWith('malformed JSON')) return null;
  return envelopeReason(cs.text, env);
}

/**
 * E3b unit two (gate page section 11.1): the ONE place a critic call gets its envelope. Called at every critic call site BEFORE the user string is handed to invoke(), with the call's own label and the draft text
 * that call shows: it issues (or, on a resume, READS) the pair first, so the prompt, and with it the stage cache's prompt hash, is identical on a replay. Returns { user, expect }: the user text with the held
 * "Reply identity" section appended LAST (after every quoted block and note), and the pair the reply is read with. A run not using the envelope (the run.json flag, set once at the start) gets its text back unchanged
 * and expect null: nothing is issued, nothing is read. A run recorded as using it whose sentence is not available fails loud.
 */
export function withEnvelope(label, shownDraft, userText) {
  if (!envelopeInForce()) return { user: userText, expect: null };
  // Fail LOUD and closed: an error here (no sentence, no store, a record that cannot be written) must stop the run, never be caught by the call site as "the seat did not answer" and turn into an abstention.
  // `controlFlow` is the flag rethrowControlFlow() lets through.
  try {
    const section = held('verdictEnvelopeSection');
    if (!section) throw new Error('verdict envelope: this run is recorded as using the envelope, but src/roles.js has no verdictEnvelopeSection to show the seat');
    const { review_id, draft_id } = issueEnvelope(label, shownDraft);
    return { user: `${userText}\n\n${section({ review_id, draft_id })}`, expect: { review_id, draft_id } };
  } catch (err) {
    throw Object.assign(err, { controlFlow: true });
  }
}

/**
 * Guarded callers, a fenced answer (table rows B1-B6, C1): one inventory of everything else in the reply - the prose outside the fence and the body of every OTHER fence, read the same way, so a
 * code fence is not exempt from a failed attempt inside it. null when the inventory holds a failed attempt (an unreadable JSON-looking span, a cut-off verdict, a duplicate key), or another readable
 * object that stands for a different verdict (V) / is a different object (S), or for the same verdict with a different decision payload.
 */
function checkedAgainstTheRest(path, value, text, { verdict, rulingsDecide = false }) {
  let outside;
  const bodies = [];
  if (path === 'fence') {
    // Bug audit 2026-10-24 C-006: the body of a TRAILING fence whose closing is missing is a region of the reply too (replyRegions reads it): a closed sign-off fence followed by prose and a last fence that opens with an objection and is never closed must not read as the sign-off alone.
    const withoutClosed = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, ' ');
    const open = withoutClosed.match(/```(?:json)?\s*([\s\S]*)$/)?.[1];
    bodies.push(...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].slice(1).map(m => m[1]), ...(open === undefined ? [] : [open]));
    outside = withoutClosed.replace(/```[\s\S]*$/, ' ');
  } else {
    outside = text.slice(0, text.indexOf('```'));
  }
  const readable = [];
  for (const body of [outside, ...bodies]) {
    const around = scanBraceSpans(body);
    if (around.unclosed && JSON_LOOKING.test(body.slice(around.unclosedAt))) return null; // a cut-off verdict
    for (const span of around.spans) {
      const got = readWithRepairs(span);
      if (got.ok) { if (duplicatesChangeTheDecision(got.text, got.value, { verdict, rulingsDecide })) return null; readable.push(got.value); } else if (JSON_LOOKING.test(span)) return null; // a failed attempt
    }
  }
  if (!verdict) return readable.every(o => canon(o) === canon(value)) ? value : null;
  const mine = spanVerdict(value);
  if (readable.some(o => { const q = spanVerdict(o); return q !== null && q !== mine; })) return null;
  if (readable.some(o => contradictory(o))) return null;
  const same = readable.filter(o => mine !== null && spanVerdict(o) === mine);
  return same.every(o => decisionKey(o, rulingsDecide) === decisionKey(value, rulingsDecide)) ? value : null;
}

/** Table rows E0-E9: nothing parsed above; read the outermost balanced spans, failing closed. */
function readSpans(scan, { verdict, strict, rulingsDecide = false }, text) {
  if (scan.unclosed) return null; // an opener that never closes may be the answer opening
  const readable = [];
  for (const [k, span] of scan.spans.entries()) {
    const got = readWithRepairs(span);
    if (got.ok && continuedAt(text, scan.ends[k])) return null; // an object closed before a key the seat still wrote (KEY_DIRECTLY_AFTER), in every mode
    if (got.ok) {
      if ((verdict || strict) && duplicatesChangeTheDecision(got.text, got.value, { verdict, rulingsDecide })) return null;
      readable.push(got.value);
    } else if (JSON_LOOKING.test(span)) return null; // a failed attempt, however many readable spans surround it
  }
  if (readable.length === 0) return null;
  if (!verdict && !strict) return readable.length === 1 ? readable[0] : null; // N: a quoted example must never become a recorded proposal
  if (!verdict) return readable.every(o => canon(o) === canon(readable[0])) ? readable[0] : null; // S: distinct readable objects are ambiguous
  if (readable.some(contradictory)) return null;
  const bearing = readable.filter(o => spanVerdict(o) !== null); // V: only a span that states a verdict can be one; the others are examples
  if (bearing.length === 0) return null;
  if (new Set(bearing.map(spanVerdict)).size > 1) return null; // different verdicts: cannot tell which is the seat's
  return bearing.every(o => decisionKey(o, rulingsDecide) === decisionKey(bearing[0], rulingsDecide)) ? bearing[0] : null; // the same verdict: only an identical decision payload is safe to take
}

const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
/** The whole object as one comparable string (key order and spacing do not matter). */
const canon = v => JSON.stringify(sortKeys(v));
/** The decision-bearing part of a verdict object: meets, failures, the criteria table rows and answers, missing = empty. Wording like verdict_line is not decision-bearing. */
const decisionKey = (o, rulingsDecide = false) => canon({ meets: o?.meets ?? null, failures: o?.failures ?? [], criteria: o?.criteria ?? [], answers: o?.answers ?? [], ...(rulingsDecide ? { rulings: o?.rulings ?? [] } : {}) });   // 0.8.4 S7b A3b: layer 2's rulings are decision-bearing only in an ask that showed the S7b section (rulingsDecide); otherwise the key is today's four fields

/**
 * The same JSON text read with the FIRST of a repeated key winning (JSON.parse keeps the LAST). Only called on text JSON.parse already accepted, so the grammar is trusted: this is a reader, not
 * a validator. Keys are compared decoded (an escaped spelling is the same key); `__proto__` is set with defineProperty so it stays an own key like JSON.parse makes it.
 */
function parseFirstWins(json) {
  let i = 0;
  const ws = () => { while (i < json.length && ' \t\n\r'.includes(json[i])) i++; };
  const string = () => {
    const start = i++;
    while (json[i] !== '"') { if (json[i] === '\\') i++; i++; }
    i++;
    return JSON.parse(json.slice(start, i));
  };
  const value = () => {
    ws();
    const ch = json[i];
    if (ch === '{') {
      i++; ws();
      const o = {};
      if (json[i] === '}') { i++; return o; }
      for (;;) {
        ws();
        const k = string();
        ws(); i++; // the colon
        const v = value();
        if (!Object.prototype.hasOwnProperty.call(o, k)) Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
        ws();
        if (json[i++] === '}') return o;
      }
    }
    if (ch === '[') {
      i++; ws();
      const a = [];
      if (json[i] === ']') { i++; return a; }
      for (;;) { a.push(value()); ws(); if (json[i++] === ']') return a; }
    }
    if (ch === '"') return string();
    const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^true|^false|^null/.exec(json.slice(i));
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  return value();
}

/**
 * Audit item 3 / Astra finding 4, refined 14 Oct 2026 after diffing the parser over 1,176 real replies on disk: a repeated key is a reason to abstain only when it CHANGES THE DECISION.
 * `lastWins` is the ordinary parse. For a verdict (V) the two readings are compared on what the panel records: the verdict they stand for, `meets`, the real failures and the answer-back `answers`; for a strict
 * caller (S) on the whole object. One real reply carries an accidental second `verdict` line in a criteria row with the same outcome either way, and re-asking it would be a paid call for nothing.
 * Fails closed: if the first-wins reading cannot be made, the duplicate counts as decision-changing.
 */
function duplicatesChangeTheDecision(json, lastWins, { verdict, rulingsDecide = false }) {
  if (!hasDuplicateKeys(json)) return false;
  let first;
  try { first = parseFirstWins(json); } catch { return true; }
  if (!verdict) return canon(first) !== canon(lastWins);
  return spanVerdict(first) !== spanVerdict(lastWins)
    || (first?.meets ?? null) !== (lastWins?.meets ?? null)
    || canon(realFailures(first)) !== canon(realFailures(lastWins))
    || canon(first?.answers ?? []) !== canon(lastWins?.answers ?? [])
    || (rulingsDecide && canon(first?.rulings ?? []) !== canon(lastWins?.rulings ?? [])); // decisionKey counts answers as decision-bearing, so a repeated answers key that flips a disposition is a decision change; (0.8.4 S7b A3b) rulings too, but only when rulingsDecide
}

/**
 * True when a JSON text holds an object with the same key twice (decoded names compared, so an escaped spelling does not hide one). `JSON.parse` keeps the LATER value, which can erase an explicit
 * rejection (`{"meets": false, "meets": true}`) before any ambiguity check can run. Only called on text that already parsed.
 */
function hasDuplicateKeys(json) {
  const stack = [];
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < json.length && json[j] !== '"') { if (json[j] === '\\') j++; j++; }
      const top = stack[stack.length - 1];
      if (top?.keys && top.expectKey) {
        let name; try { name = JSON.parse(json.slice(i, j + 1)); } catch { name = json.slice(i, j + 1); }
        if (top.keys.has(name)) return true;
        top.keys.add(name);
        top.expectKey = false;
      }
      i = j;
    } else if (ch === '{') stack.push({ keys: new Set(), expectKey: true });
    else if (ch === '[') stack.push({ keys: null, expectKey: false });
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',' && stack[stack.length - 1]?.keys) stack[stack.length - 1].expectKey = true;
  }
  return false;
}

// The ONE placeholder rule of the verdict readers (parseJson's checks below and normaliseCritique): an entry that names no criterion and says nothing, or names a none-word criterion and says nothing else, is not a failure.
const NONE_WORDS = /^(none|n\/?a|-|no failures?)\.?$/i;
/** Text that says nothing: absent, blank, or a none-word ("None", "N/A", "-", "no failures"). */
const saysNothing = x => { const s = String(x ?? '').trim(); return s === '' || NONE_WORDS.test(s); };
// Bug audit 2026-10-24 C-007: a placeholder failure entry names no criterion AND says nothing (its own comment, below). The old rule dropped two entries that DO say something: a bare string (`"failures": ["The plan has no rollback section"]`) and an object whose criterion is a none-word but whose problem or fix is real. Either, beside `meets: true`, read as a sign-off around an objection the seat gave.
// ONE rule: normaliseCritique uses this function too (it used to carry a second copy kept in step by a test).
const isPlaceholderFailure = f => {
  if (!f) return true;
  if (typeof f === 'string') return saysNothing(f);
  if (typeof f !== 'object') return true;
  if (f.criterion) return NONE_WORDS.test(String(f.criterion).trim()) && saysNothing(f.problem) && saysNothing(f.fix);
  return !String(f.problem || '').trim();
};
const tableRows = o => (Array.isArray(o?.criteria) ? o.criteria.filter(r => r && typeof r === 'object' && !Array.isArray(r)) : []);
const realFailures = o => (Array.isArray(o?.failures) ? o.failures.filter(f => !isPlaceholderFailure(f)) : []);

/**
 * Contradictory decision fields: `meets: true` beside a real failure or a FAILED table row, or `meets: false` beside an all-MET table that lists NO real failure. No reading of such an object is safe.
 * An all-MET table with `meets: false` AND real failures is a consistent objection (normaliseCritique reads failures first): two of 541 verdict replies on disk have that shape (14 Oct 2026).
 */
function contradictory(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const rows = tableRows(o);
  const failing = realFailures(o).length > 0 || rows.some(r => FAILED_VERDICT.test(verdictWord(r.verdict)));
  const allMet = rows.length > 0 && rows.every(r => MET_VERDICT.test(verdictWord(r.verdict)));
  return (o.meets === true && failing) || (o.meets === false && allMet && realFailures(o).length === 0);
}

/**
 * The verdict a parsed span would stand for downstream, in the order normaliseCritique decides it: any real failure or FAILED table row is an objection; else `meets: true` or a non-empty
 * all-MET table is a sign-off; else `meets: false` is an objection; anything else (an example object with none of these fields) stands for no verdict (null).
 */
function spanVerdict(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const rows = tableRows(o);
  if (realFailures(o).length || rows.some(r => FAILED_VERDICT.test(verdictWord(r.verdict)))) return 'objection';
  if (o.meets === true || (rows.length > 0 && rows.every(r => MET_VERDICT.test(verdictWord(r.verdict))))) return 'sign-off';
  return o.meets === false ? 'objection' : null;
}

/**
 * The outermost balanced `{...}` spans of a text, left to right, with string state tracked (a brace inside a double-quoted string, and an escaped quote, do not count), and whether a `{`
 * outside every span never closed (`unclosed`, at `unclosedAt`: the scan stops at the first one, so a hostile reply of a million `{` costs one pass). A balanced span is not searched for spans inside it.
 * More than `maxStarts` spans stop the scan and read as unclosed (fail closed). Pure.
 */
export function scanBraceSpans(text, { maxStarts = 64 } = {}) {
  const spans = [];
  const ends = [];   // the index of each span's closing `}` in `text` (3 Nov 2026: continuedAt reads what follows it)
  let i = text.indexOf('{');
  while (i !== -1) {
    if (spans.length >= maxStarts) return { spans, ends, unclosed: true, unclosedAt: i };
    let depth = 0, inString = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) { if (ch === '\\') j++; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = j; break; }
    }
    if (end === -1) return { spans, ends, unclosed: true, unclosedAt: i };
    spans.push(text.slice(i, end + 1));
    ends.push(end);
    i = text.indexOf('{', end + 1);
  }
  return { spans, ends, unclosed: false, unclosedAt: -1 };
}

// Explains why a critic's reply couldn't be parsed, for the abstention log line. Found 2026-09-10
// (GP judging run 2026-09-10T20-01-59-545Z, panel-1-glm.md): the old two-way check (token cap vs.
// "malformed JSON") mislabelled a genuinely empty reply as "malformed JSON - read the saved reply,
// it may still be an objection" - there is nothing to read, and it is not an objection. The
// provider's own finish_reason ("stop" in usage, set by providers.js from finish_reason/
// stop_reason) already says this plainly when it's not a normal completion: OpenRouter/OpenAI-
// compatible providers return "error" when the upstream model errors out mid-generation (here,
// GLM 5.3 Flash burned its whole token budget on thinking - usage.thinking === usage.output - and
// returned no content at all), which is a distinct failure from either truncation or a formatting
// slip and needs its own label so a later session doesn't chase the wrong bug.
// What a debate or reply stage's unreadable text was, said once on the sitting that paid for it (0.8.4; the critic reply's classifyUnreadable reads token counts and says "it may still be an objection", which would be false here). A-DRAFT: public text (run.log).
export function unreadableReplyCause(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'the reply was empty';
  if (!t.includes('{')) return 'the reply held no JSON';
  return 'the JSON in the reply was cut off or malformed';
}
// A replayed stage is not announced again, EXCEPT an external seat's: its answer reaches invoke() as a stage-file read on the very sitting that receives it (cached: true), so a gate on `cached` alone
// would never announce an unreadable external reply. It is announced on each sitting that reads it instead, never silenced.
const unreadableIsNews = (st, seat) => !st.cached || seat?.provider === 'external';
export function classifyUnreadable(usage, maxTokens) {
  if (usage.stop === 'error') return 'provider returned an error mid-generation (stop: error) - not a truncation or a JSON-formatting problem';
  const cap = maxTokens ?? DEFAULT_MAX_TOKENS;
  if (isReasoningExhausted(usage, cap)) return `REASONING_EXHAUSTED: all ${usage.output} tokens were reasoning, stopped far under the ${cap}-token cap - a provider-side reasoning ceiling, so no bigger-cap retry`;
  if (usage.output >= cap * 0.95 || usage.stop === 'length' || usage.stop === 'max_tokens') return 'hit the token cap, truncated';
  return 'malformed JSON - read the saved reply, it may still be an objection';
}

// v8 item (a) (deep-research-v8-directional-followup-2026-09-15.md §5.3 item 1): a reserved,
// closed set of machine-readable reason codes for report.json's signoff[] entries, named so an
// abstention's cause is a schema value rather than only a log line someone has to remember to
// read. Deliberately a SEPARATE function from classifyUnreadable rather than a change to its
// return shape - classifyUnreadable's plain-string return is pinned by test/chain.test.js
// (added 2026-09-10 after a real incident) and changing it would be a needless breaking edit to
// an already-correct, already-tested function. This function reads the same two inputs
// classifyUnreadable already reads and returns the code for the same three diagnoses, plus the
// one abstention path classifyUnreadable was never meant to cover (a thrown provider/transport
// exception - see the catch block above reviewSeat, "a lab that is down"). No new abstention
// category exists beyond these four; the set is closed on purpose.
export const RESERVED_ABSTENTION_REASONS = Object.freeze([
  'SEAT_UNREACHABLE',   // the catch block: 429/5xx/network - invoke() threw before any reply came back
  'PROVIDER_ERROR',     // classifyUnreadable's stop:"error" branch - a reply came back but the provider aborted mid-generation
  'REPLY_TRUNCATED',    // classifyUnreadable's near-cap-output branch - the reply hit maxTokens before finishing
  'REPLY_UNPARSEABLE',  // classifyUnreadable's fallback branch - a complete reply that still isn't valid JSON
  // Added 2026-09-23 (seeded-defect paid run): stopped at a length limit with every output token
  // spent on reasoning, far below the seat's own cap - a provider-side reasoning ceiling, not our
  // cap. deepseek-v4.1-flash via OpenRouter did this 6 times at 4,224-4,226 tokens against a 36k
  // cap, and all 3 bigger-cap (64k) retries stopped at the same place, so the retry is skipped.
  'REASONING_EXHAUSTED',
  // Added 0.8.2 (owner decision 1, 5 Oct 2026): a sign-off without a full per-criterion table, on a chain with `signoff_table.required`. Never consent.
  'INCOMPLETE_TABLE',
]);

// "Well under the cap": a reply that ran out at half its budget or less did not hit OUR cap.
const REASONING_CEILING_FRACTION = 0.5;
function isReasoningExhausted(usage, cap) {
  const cut = usage.stop === 'length' || usage.stop === 'max_tokens';
  return cut && usage.thinking > 0 && usage.output > 0 && usage.thinking >= usage.output && usage.output <= cap * REASONING_CEILING_FRACTION;
}

// The provider itself says the reply stopped at the token cap. Unlike abstentionReasonCode's
// REPLY_TRUNCATED, no 95%-of-cap guess: a reply that finished with stop:"stop" is complete.
export function providerCutOff(usage) {
  return usage?.stop === 'length' || usage?.stop === 'max_tokens';
}

// 0.8.1 milestone R (owner: "NO LOWER EFFORT!!!!"): a reply cut off at its cap that spent tokens on thinking and returned no text. The seat
// has no answer; it is recorded, never read as a pass. The wording is the one the board uses.
export const NO_ANSWER_THINKING = 'no answer: thinking used the whole cap';
export function isNoAnswerReply(res) {
  return providerCutOff(res?.usage) && res.usage.thinking > 0 && !String(res.text ?? '').trim();
}

export function abstentionReasonCode(usage, maxTokens) {
  if (usage.stop === 'error') return 'PROVIDER_ERROR';
  const cap = maxTokens ?? DEFAULT_MAX_TOKENS;
  if (isReasoningExhausted(usage, cap)) return 'REASONING_EXHAUSTED';
  if (usage.output >= cap * 0.95 || usage.stop === 'length' || usage.stop === 'max_tokens') return 'REPLY_TRUNCATED';
  return 'REPLY_UNPARSEABLE';
}

// Small critics fill the schema literally: every criterion MET, meets:false,
// and a placeholder failure {criterion:"None"} because the array "had to"
// hold something (Llama 3.3 70B did exactly this on 2026-09-07, and the
// harness counted it as an objection). The per-criterion table is the honest
// signal, so the summary fields are derived from it rather than trusted.
// 14 Oct 2026 (C&C ruling on fix-up 3, after Astra's review finding 5): that shape is no longer a sign-off anywhere. parseJson({ verdict: true }) returns null for an all-MET table beside `meets: false`
// and no real failure (an abstention and a re-ask), and this function agrees: it reads the same object as unreadable. A reply whose own flag says it does not meet is never recorded as consent; the cost is
// up to two re-asks per occurrence (0 of 541 recorded verdict replies have the shape). The old rule (824a4b9, 23 Sep 2026: the table wins) is reversed; its test is edited with old and new in its comment.

// A critic's own text (criterion/problem/fix/verdict_line) is entirely critic-controlled and
// flows, undelimited until roles.js's own prompt-construction fix, straight into the reviser's
// prompt and the run history handed to the finalist (docs/security-prompt-injection.md S3, found
// from cnc-harness's own security review of what a plan-N seat actually runs). A 20 000-token
// critic reply could otherwise become a 20 000-token "failure" in the next prompt; cap each
// field here, at parse time, once, rather than trusting every call site downstream to remember.
//
// 0.8.1 FX-11 (owner's amendment, 2026-10-02): one 2,000-character limit for every kind cut a 6,704-character
// architecture before the builder read it, silently. Each kind now has its own limit, and every cut is loud:
// - Text other seats read as the substance of the board (a whole architecture's fields, a debate post, an author's
//   reply): never less than what the seat was allowed to write, its maxTokens at CHARS_PER_TOKEN, and never under
//   BOARD_TEXT_MIN_CHARS. A cut there means the reply was longer than its own token cap allowed, which only a
//   runaway or a miscount produces.
// - A critic field: CRITIC_FIELD_MAX_CHARS, the runaway guard above. Four fields x 8,000 characters is about 8,000
//   tokens of one critic's objections in the reviser's prompt, under a quarter of a 36,000-token seat's own reply.
// Each cut is recorded (fieldCutsSoFar: stage, field, original and kept length); the CLI writes it to WARNINGS.md and
// report.json `field_cuts`.
const CHARS_PER_TOKEN = 4; // the harness's rule everywhere it estimates tokens (estimateTokens)
const BOARD_TEXT_MIN_CHARS = 40_000; // the amendment's floor: about 10,000 tokens, five times the old cut
const CRITIC_FIELD_MAX_CHARS = 8_000; // the amendment's floor for critic fields (was 2,000)
// E84: the longest evidence text of another reviewer's table row a judge is shown in a re-ask, and the only text a peer-sourced withdrawal may quote. 600 = the cap on one objection line in answerBackSection (src/roles.js oneLine); a MET row's evidence is not capped at parse (only a FAILED row's, through capField), so the cap is applied here, before the text is shown and checked.
const PEER_ROW_MAX_CHARS = 600;
const boardTextLimit = maxTokens => Math.max(BOARD_TEXT_MIN_CHARS, (maxTokens ?? DEFAULT_MAX_TOKENS) * CHARS_PER_TOKEN);
let fieldCuts = [];
/** Start a new record of cut fields. The CLI calls it once per run (one run per process); a nested runChain (descending
 * mode's sub-runs) must not, or it would wipe the outer run's record. Tests call it between runs. */
export function resetFieldCuts() { fieldCuts = []; }
/** Every field cut so far in this run: [{ stage, field, original, kept }]. */
export function fieldCutsSoFar() { return fieldCuts.map(c => ({ ...c })); }
function capField(value, { limit = CRITIC_FIELD_MAX_CHARS, stage = null, field = null } = {}) {
  if (typeof value !== 'string' || value.length <= limit) return value;
  fieldCuts.push({ stage, field, original: value.length, kept: limit });
  return `${value.slice(0, limit)}… [truncated, ${value.length} chars total]`;
}

// Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #1, #2): `meets` used to be
// `failures.length === 0` and nothing else, so anything that failed to NAME a failure signed off -
// an explicit {"meets":false,"verdict_line":"Fails criterion 2"}, a failure with no `criterion`
// key, a table saying "FAIL" or "NOT MET" instead of the exact "FAILED", a question-only reply, a
// fenced snippet picked out of a prose objection, a truncated array's first element. That is the
// "garbled counts as consent" incident class again. A sign-off now needs no failures AND a stated
// pass: `meets: true`, or a non-empty table whose every row is MET (the table is still the honest
// signal, except for the 2026-09-07 Llama shape - all MET, meets:false, placeholder failure - which is
// unreadable since 14 Oct 2026, see above). An explicit meets:false with nothing named becomes an objection; a reply that states
// no verdict at all comes back `unreadable: true`, which callers turn into an abstention (it blocks
// unanimity; it is never consent). A non-array `failures` or a non-object reply is unreadable too,
// rather than a throw - the reply is on disk before it is parsed, so a throw here used to crash
// every resume on the same replayed file (#2).
const NO_VERDICT_FAILURE_CRITERION = '(objection named no criterion)';

// 0.8.4 D14 (WORDING U2-w1): the FAILED rows of a verdict's criteria table, [{ criterion, evidence }], for the located marks (the first row of a criterion pairs with its failure, src/quote-check.js markFailures)
const failedRowsOf = critique => (Array.isArray(critique?.criteria) ? critique.criteria : []).filter(r => r && typeof r === 'object' && !Array.isArray(r) && FAILED_VERDICT.test(verdictWord(r.verdict))).map(r => ({ criterion: r.criterion, evidence: typeof r.evidence === 'string' ? r.evidence : '' }));

export function normaliseCritique(critique, log = () => {}, { stage = null, severity = false, criteria = null } = {}) {
  const unreadable = (why, extra = {}) => {
    log(`    (no usable verdict: ${why} - counted as an abstention, not a sign-off)`);
    return { ...(critique && typeof critique === 'object' && !Array.isArray(critique) ? critique : {}), failures: [], meets: false, unreadable: true, unreadableWhy: why, ...extra };
  };
  if (!critique || typeof critique !== 'object' || Array.isArray(critique)) return unreadable(`the reply is ${Array.isArray(critique) ? 'an array' : typeof critique}, not a verdict object`);
  if (critique.failures != null && !Array.isArray(critique.failures)) return unreadable(`"failures" is ${typeof critique.failures}, not a list`);
  const rawFailures = critique.failures || [];
  const rows = Array.isArray(critique.criteria) ? critique.criteria.filter(r => r && typeof r === 'object' && !Array.isArray(r)) : [];
  const verdictOf = row => verdictWord(row.verdict);

  // A placeholder names no criterion AND says nothing - an entry with a real problem but no
  // criterion key is still an objection, just an unlabelled one.
  // a bare string entry that says something is an objection with no criterion named: it becomes { problem: <the text> } (C-007)
  const failures = rawFailures.filter(f => !isPlaceholderFailure(f)).map(f => (typeof f === 'string' ? { problem: f } : f))
    .map(f => ({ ...f, criterion: capField(f.criterion ? String(f.criterion) : NO_VERDICT_FAILURE_CRITERION, { stage, field: 'criterion' }), problem: capField(f.problem, { stage, field: 'problem' }), fix: capField(f.fix, { stage, field: 'fix' }) }));
  // B3 prep (unit 2): without the severity switch a tag a judge volunteers is DROPPED here, so no switch-off record ever carries one (and the published schema's type for the field cannot be violated); with it, the check below reads it.
  if (!severity) for (const f of failures) delete f.severity;
  const dropped = rawFailures.length - failures.length;
  if (dropped) log(`    (ignored ${dropped} placeholder failure entr${dropped === 1 ? 'y' : 'ies'} that named no criterion)`);
  const synthesised = new Set();   // failures the harness wrote itself from a FAILED table row
  // 3 Nov 2026 (row matching by position, src/criteria-ledger.js): with the run's criteria at hand, a FAILED row and a failure are the same criterion when both resolve to the same one (the row through the gate's
  // assignment, text or position; the failure through criterionIndexOf). A judge that retyped its row's words but named the criterion exactly in its failure is not given a second failure of THC's own, which carries no
  // severity and, with the severity switch on, made the whole verdict unreadable. No word of a failure changes.
  const placed = Array.isArray(criteria) && criteria.length ? rowCriterionIndex({ criteria: rows }, criteria) : null;
  for (const row of rows) {
    if (!FAILED_VERDICT.test(verdictOf(row))) continue;
    if (failures.some(f => criterionKeyOf(f.criterion) === criterionKeyOf(row.criterion))) continue;   // the same criterion with its list number or a closing full stop is not another one (the objection id reads it so too)
    if (placed?.has(row) && failures.some(f => criterionIndexOf(String(f.criterion ?? ''), criteria) === placed.get(row))) continue;
    synthesised.add(failures[failures.push({ criterion: capField(String(row.criterion ?? '(unnamed criterion)'), { stage, field: 'criterion' }), problem: capField(row.evidence, { stage, field: 'evidence' }) || `marked ${verdictOf(row)} in the criteria table`, fix: '' }) - 1]);
    log(`    (added a failure the critic marked ${verdictOf(row)} in its table but left out of its failures list)`);
  }
  const verdict_line = capField(critique.verdict_line, { stage, field: 'verdict_line' });
  // B3 prep (JUDGE lane, unit 2): with the chain's severity switch on, every objection must carry a readable severity (src/severity.js readSeverity). A missing or unreadable one makes the WHOLE verdict unreadable: the seat is asked again,
  // then unheard. Never a default number, never read as "below 4". The failures the harness writes itself (a FAILED table row the judge left out of its list) carry none, so they are unreadable too.
  if (severity) {
    const at = failures.findIndex(f => !readSeverity(f.severity).ok);
    if (at !== -1) return unreadable(`objection ${at + 1} (${String(failures[at].criterion).slice(0, 80)}) carries no readable severity: ${readSeverity(failures[at].severity).why}`, { severityGap: { kind: synthesised.has(failures[at]) ? 'table_row' : 'untagged', n: at + 1, criterion: String(failures[at].criterion).slice(0, 80) } });
  }
  if (failures.length) return { ...critique, failures, verdict_line, meets: severity ? severityMeets(failures) : false };   // unit 3: with the switch, objections all rated below the settle line do not hold the sign-off (they stay on the verdict, swept)

  const allMet = rows.length > 0 && rows.every(r => MET_VERDICT.test(verdictOf(r)));
  // The Llama shape: the flag says no and the table says yes with nothing real named. Neither wins silently (an explicit false is never approval by precedence): an abstention the panel re-asks.
  if (critique.meets === false && allMet) return unreadable('the reply says meets:false beside a table where every criterion is MET and names no failure');
  if (critique.meets === true || allMet) return { ...critique, failures, verdict_line, meets: true };
  if (critique.meets === false) {
    // A stated objection that named nothing. Kept as an objection (never consent), with whatever
    // the critic did say as its text, so the reviser has something to act on.
    if (severity) return unreadable('the reply says meets:false and names no objection, so there is nothing to carry a severity', { severityGap: { kind: 'no_objection', n: 1, criterion: '' } });
    const said = verdict_line || 'the critic answered meets:false but named no criterion and gave no reason';
    log(`    (the critic said meets:false but named no criterion - kept as an unlabelled objection)`);
    return { ...critique, verdict_line, meets: false, failures: [{ criterion: NO_VERDICT_FAILURE_CRITERION, problem: said, fix: '' }] };
  }
  return unreadable('the reply states no verdict (no meets:true, no all-MET table, no failure)');
}

// Reads the plan's own "Scope ledger" lines: `<id> - accepted|cut - <reason>`.
// An id the ledger does not mention is "unaccounted", which is itself a
// finding about the integrator, not the proposer.
export function scoreProposals(proposals, plan, ledgerText) {
  // `ledgerText` (a string, even an empty one): the Scope ledger kept in its own file (src/scope-ledger.js, switch on) - the ONLY text read then; without it the plan is read, as it always was
  // (the switch off, an old run folder, a draft handed in). The line pattern is the strip's pattern (ledgerLineSource), with this proposal's id.
  const text = typeof ledgerText === 'string' ? ledgerText : plan;
  const rows = proposals.map(p => {
    // p.id is escaped: an id is a harness-made tag today, but an unescaped "P(1" threw a
    // SyntaxError here, after every paid stage had run (bug audit 2026-09-23, ChainParsers #8).
    const re = new RegExp(ledgerLineSource(String(p.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'im');
    const m = text.match(re);
    return { ...p, status: m ? m[2].toLowerCase() : 'unaccounted', note: m ? m[3].trim() : '' };
  });
  const labs = [...new Set(rows.map(r => r.lab))].map(lab => {
    const mine = rows.filter(r => r.lab === lab);
    const n = st => mine.filter(r => r.status === st).length;
    return { lab, model: mine[0].model, proposed: mine.length, accepted: n('accepted'), cut: n('cut'), withdrawn: n('withdrawn'), unaccounted: n('unaccounted'), built: null };
  });
  return { rows, labs };
}

// A lab's identity is its provider unless the seat names one: three seats on
// OpenRouter are three labs, and mock chains need two labs on one provider.
// Exported so chain-lint.js's self-review check keys on the SAME identity the
// blind-panel and debate logic key on. A second copy of this one-liner there
// could drift from this one, and the thing that would silently break is
// exactly what the harness exists to measure (lab independence).
// How many labs sit on a chain's panel: its critics, by labOf. What `council doctor` advertises.
export const panelLabCount = config => new Set((config?.seats?.critics || []).filter(Boolean).map(labOf)).size;

// Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #1): several stages
// label a call by lab alone (`panel-<round>-<lab>`, `propose-<lab>`, `debate-<lab>`, `reply-<lab>`,
// `ambiguity-<lab>`), and the stage cache is keyed by label. Two seats sharing a lab therefore
// shared one label: in a relay panel the second seat was never called and was handed the first
// seat's verdict; in an independent panel the second write overwrote the first, and on resume both
// seats replayed the survivor - a holdout's objection became a manufactured unanimous pass.
// Renaming labels would orphan every paused run, so a chain that would collide is refused instead.
// A "first"-mode panel labels by round (`critique-<n>`), so shared labs are fine there.
// The sign-off modes runChain implements. Anything else is refused, never quietly run as "first"
// (pre-release audit 2026-09-23, PanelSignoff #3).
export const SIGNOFF_MODES = Object.freeze(['first', 'unanimous']);

export function duplicateLabSlots(config) {
  const seats = config?.seats || {};
  const out = [];
  const check = (slot, list) => {
    if (!Array.isArray(list)) return;
    const labs = list.filter(Boolean).map(labOf);
    let dupes = [...new Set(labs.filter((l, i) => labs.indexOf(l) !== i))];
    // lab-identity unit (Q1): the SAME model on different layers of a layered critics panel is not a collision, it has its own seat key (src/seat-key.js)
    if (slot === 'critics') dupes = dupes.filter(l => !repeatedLabsOf(list).find(r => r.lab === l)?.keys);
    if (dupes.length) out.push({ slot, labs: dupes });
  };
  // Every stage whose label is keyed by lab (test/prerelease-batch1b.test.js walks chain.js's
  // labels and fails if a new lab-keyed one is not listed here). Pre-release audit 2026-09-23:
  // the alternatives stage (Alternatives #2) and preflight.seats (GuardLayer, the class's second
  // recurrence) were missing, and descending critics label per lab too.
  if (config?.signoff === 'unanimous' || config?.descending) check('critics', seats.critics);
  if (config?.proposals) check('proposers', seats.proposers || seats.critics);
  if (config?.alternatives?.enabled === true) check('alternatives', seats.alternatives || seats.proposers || seats.critics);
  if (config?.ambiguity_union?.enabled) check('ambiguity', seats.ambiguity || (seats.critics || []).slice(0, 3));
  if (config?.preflight) check('preflight', (config.preflight.seats && config.preflight.seats.length) ? config.preflight.seats : seats.critics);
  return out;
}

// Item 5/6 (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md): a seat-role
// override lets a chain name, by lab/provider id, which already-configured
// seat fills a given stage - a selection change, never a new field on
// report.json. Searches every seat this chain declares, named and rostered,
// so an override can point at a critic or a proposer as well as a
// dedicated seat kind.
export function findSeatByLab(config, id) {
  const seats = config?.seats || {};
  const named = ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'challenger', 'decider']
    .map(k => seats[k]).filter(Boolean);
  const all = [...named, ...(seats.critics || []), ...(seats.proposers || []), ...(seats.alternatives || [])];
  return all.find(s => seatKeyOf(s) === id) || null;
}

// roster.criteria_seat (item 5): absent leaves the existing configured
// criteria seat exactly as today. Present, it must resolve to a real seat
// somewhere in this chain's config - chain-lint.js checks this ahead of any
// metered call, but resolveCriteriaSeat re-checks here too since a config
// can be handed to runChain() directly without going through the CLI's
// lint gate (the MCP path, tests).
export function resolveCriteriaSeat(config) {
  const id = config.roster?.criteria_seat;
  if (!id) return config.seats.criteria;
  const seat = findSeatByLab(config, id);
  if (!seat) throw new Error(`roster.criteria_seat "${id}" does not match any seat's lab/provider in this chain's seats.`);
  return seat;
}

// Ambiguity union (config.ambiguity_union, item 5): string/set-level dedup,
// deliberately with no dependency on any claim schema - confirmed in the
// debate for this item, since it operates on raw request text, not on a
// claims[] array from any other item. Normalises on trim + lowercase +
// collapsed whitespace so near-duplicate phrasing collapses to one entry;
// the FIRST seat's original casing/wording is what survives, so the union
// stays readable rather than becoming a bag of lowercase fragments.
export function unionAmbiguities(lists) {
  const seen = new Map();
  for (const list of lists || []) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (!text) continue;
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(key)) seen.set(key, text);
    }
  }
  return [...seen.values()];
}

// A run pauses at an external seat: the prompt is written for whoever plays
// that seat (a Claude Code session on the Max plan, a human), and the run
// resumes from disk once <label>.md exists. Thrown, not returned, so the
// chain's control flow stays linear.
/**
 * Round semantics 2b (Muad 15 Oct 2026: a round ends only when the overseer layer gives a verdict; after the cap or a layer's revision bound the run STOPS and the person chooses): thrown by the loop when advance() says stop. Control flow, like
 * ExternalPause: the invoke catch lets it through; runChain attaches the run so far as `partial`; the CLI writes a stopped marker + report-partial.json (NO report.json: the run did not finish) and exits 23. Thrown BEFORE the
 * post-loop stages, so a stop spends nothing more.
 */
export class RoundStopped extends Error {
  constructor(stop) { super(`the run stopped: ${stop.kind}`); this.controlFlow = true; this.stop = stop; }
}

export class ExternalPause extends Error {
  constructor(label, system, user, askedFor = null, repair = null) {
    super(`waiting for external stage ${label}`); this.controlFlow = true; this.label = label; this.system = system; this.user = user;
    this.askedFor = askedFor;   // the seat's model (harness a, S3): the NEEDS file says which model the seat asks for
    // 2 Nov 2026 (near-JSON pause, src/near-json.js): { original, refusal } when this pause is a REQUEST TO REPAIR a paid reply that was almost JSON, not a seat that waits for its answer. null for an external seat.
    this.repair = repair;
    // The prompt the external answer will be checked against on resume (pre-release audit 5 #1/#4).
    this.promptHash = promptHashOf(system, user);
  }
}

// v4 item 2: a run's preflight stage found at least one blocking objection to the task
// description itself, before any proposal exists. Thrown, not returned, for the same reason
// as ExternalPause/BudgetExceeded - the chain's control flow stays linear, and the preflight
// verdicts computed so far are handed to the caller to persist, the same shape BudgetExceeded
// already uses for its own already-completed stages.
// A draft-producing stage (build, a revise, the dispute pass, the final edit, the handoff) came back
// cut off at its token cap, and a retry with a bigger cap was cut off too - or the seat is external
// and cannot be retried. Pre-release audit 2026-09-23 (PreRelease_Audit_revise #1): these replies
// used to flow straight on, so a truncated final edit became the shipped deliverable with no review
// after it. Thrown, not returned, like BudgetExceeded: the CLI stops the run with STOPPED-truncated.md
// and never grades, reports or ships the fragment.
//
// Bug audit 2026-09-27 M4: also thrown for a draft the provider ended with `error`, `content_filter`
// or `refusal` (draftIncomplete), after one retry at the same cap. `stop` then names that reason, and
// the message says "did not complete" instead of "cut off".
export class DraftTruncated extends Error {
  constructor(label, detail, stop = null) {
    super(stop ? `stage "${label}" did not complete (stop: ${stop}): ${detail}` : `stage "${label}" was cut off at its token cap: ${detail}`);
    this.controlFlow = true;
    this.label = label;
    this.detail = detail;
    this.stop = stop;
  }
}

// Whether a free-text reply was cut off. Only the provider's own stop reason, or - when a provider
// reports none - a reply that used its whole cap, counts: a long reply that finished is not truncated,
// which is why this does not reuse the 95%-of-cap heuristic JSON seats use.
export function draftCutOff(usage, cap) {
  if (!usage) return false;
  if (usage.stop === 'length' || usage.stop === 'max_tokens') return true;
  return usage.stop == null && Number.isFinite(cap) && (usage.output || 0) >= cap;
}

// Bug audit 2026-09-27 M4: a draft the provider ended for a reason other than finishing or the cap
// (normaliseStop passes these through). Such a reply is not a finished draft either, and a bigger
// cap does not help a provider error, so draftStage retries it once at the same cap.
const INCOMPLETE_STOPS = new Set(['error', 'content_filter', 'refusal']);
export function draftIncomplete(usage) {
  return !!usage && INCOMPLETE_STOPS.has(usage.stop);
}

export class PreflightBlocked extends Error {
  constructor(preflight) {
    super('preflight stage found a blocking objection to the task description');
    this.preflight = preflight;
  }
}

// A run hits its spend ceiling: thrown from invoke() BEFORE the call goes
// out, so the breaching stage is never paid for. Like ExternalPause this is
// thrown rather than returned, and for the same reason - the chain's control
// flow stays linear, and every completed stage is already on disk, so the run
// is resumable under a higher ceiling.
export class BudgetExceeded extends Error {
  // `projected`: the call's WORST case (what is reserved and charged; ruling A of 27 Okt 2026 keeps its meaning). `gate`: the figure the NEXT RESUME must clear at this stage (S5-05, owner's pick 28 Okt 2026): the call's expected cost
  // when a planned call was stopped by the gate, and the whole worst case when the stage re-runs both attempts (the stop that refused a thinking retry; an unplanned call is gated at its worst case anyway). Absent = `projected`, so no
  // thrower can lose it. `retryRefused` says WHICH check stopped the run, for the sentences only (the first attempt was paid and is counted); the figure never reads it.
  // 0.8.4 DUALCAP (src/caps.js): `capName` when a per-provider cap stopped the run; then `cap` is that cap's limit and `spent` that cap's counted spend, and the message names the cap (A-DRAFT).
  // Without one the key is ABSENT (not undefined) and the error is the one above, byte for byte.
  constructor({ label, seat, spent, cap, projected, gate, retryRefused = false, capName, phase }) {
    const which = capName === undefined ? 'per-run spend cap' : `${capName} spend cap`;
    super(retryRefused ? `${which} reached before the retry of stage ${label}` : `${which} reached before stage ${label}`);
    this.controlFlow = true; // see rethrowControlFlow; read by modules that cannot import this file
    this.label = label;
    this.seat = seat;
    this.spent = spent;
    this.cap = cap;
    this.projected = projected;
    this.gate = Number.isFinite(gate) ? gate : projected;
    this.retryRefused = retryRefused === true;
    if (capName !== undefined) this.capName = capName;
    if (phase !== undefined) this.phase = phase;   // 0.8.4 S16 (F): where the run was (before the review rounds, inside them, after them): STOPPED-budget.json `phase`; --finish is possible only inside
  }
}

// 0.8.2 item 8a: a seat with no price row, called under a spend cap. The cap would project it at $0 and could not stop what the call costs, so invoke() refuses it before anything is sent (the run's start refuses
// the same seats first, src/unpriced.js). controlFlow, like BudgetExceeded: no catch around an invoke() may turn it into an abstention.
export class UnpricedSeat extends Error {
  // 0.8.4 DUALCAP unit 4a: `capName` when the per-provider caps are armed (then `cap` is that cap's limit; the message names it, A-DRAFT); absent otherwise, and the error is the one above, byte for byte.
  constructor({ label, seat, cap, capName }) {
    super(`${seat} has no price, so the ${capName === undefined ? '' : `${capName} `}spend cap of ${formatUsd(cap)} cannot hold it (before stage ${label})`);
    this.controlFlow = true;
    this.label = label;
    this.seat = seat;
    this.cap = cap;
    if (capName !== undefined) this.capName = capName;
  }
}

// 0.8.4 DUALCAP unit 4a (src/caps.js "IN-PROCESS"): with the per-provider caps armed, a seat whose account has no cap armed. Nothing would hold its spend, so invoke() refuses it before anything is reserved or
// sent: the backstop behind the start's refusal of uncovered seats (src/uncovered.js, exit 5; the CLI's exit for this one comes with the arming). controlFlow, like UnpricedSeat. Message A-DRAFT.
export class UncoveredSeat extends Error {
  constructor({ label, seat, capName, caps }) {
    super(`${seat} is billed through ${capName}, and no spend cap is armed for ${capName} (armed: ${caps.join(', ')}), so nothing would hold its spend (before stage ${label})`);
    this.controlFlow = true;
    this.label = label;
    this.seat = seat;
    this.capName = capName;
    this.caps = caps;
  }
}

// Bug-audit fix, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #2, confirmed independently by
// BugAudit_ChainParsers #4): every catch that wraps an invoke() call and degrades a failure into an
// abstention, a "no reply" or a default MUST call this first. BudgetExceeded and ExternalPause are
// control flow, not a seat being down - swallowed, a capped panel seat was logged SEAT_UNREACHABLE,
// the panel re-ran on the same draft up to maxRounds, runChain returned normally, and the CLI wrote
// report.json instead of STOPPED-budget.json, so the run could not be resumed under a higher cap.
// The panel's cut-off retry catch already did this; the six sibling catches did not.
export function rethrowControlFlow(err) {
  // `controlFlow` also covers DeniedModel (src/denied-models.js), which must never be turned into an
  // abstention either.
  if (err instanceof BudgetExceeded || err instanceof ExternalPause || err?.controlFlow) throw err;
}

// A3a commit 2 (18 Okt 2026; src/price-refused.js): the two helpers of the seat-skip choice. `skipChosen(seat, labels)` goes first INSIDE the try of a stage that can do without a seat (a debate post, a reply round; never a panel judge, see the panel catch): a seat
// the person chose to skip (run.json seatChoices, src/price-refused.js setSeatSkips) throws a plain error there, which the stage's own catch counts as an unreachable seat, an abstention, exactly as a down lab is. CR-1B-002: only from the stage that was refused on
// (the choice's recorded call label is one of `labels`, the labels of the call about to be made) to the end of the run; a stage the seat already finished before it replays from disk, so its cost stays counted. `offerSkip` goes first
// INSIDE that catch, before rethrowControlFlow: it tells a PriceRefused that this stage could do without the seat, and how many OTHER seats of its group (not already skipped) would stay.
function skipChosen(seat, labels) {
  const c = seatSkipActive(seat, labels);
  if (c) throw new Error(`skipped by a --skip-seat flag (price refused; recorded ${c.at ?? 'earlier'})`);
}
function offerSkip(err, seat, group) {
  if (!(err instanceof PriceRefused)) return;
  const k = skipKeyOf(seat);
  markSkippable(err, { voices: (group ?? []).filter(s => s && skipKeyOf(s) !== k && !seatSkipChoice(s)).length, lab: seatKeyOf(seat) });
}

// Bug-audit fix, 2026-09-23 (BugAudit_MoneyPath #5): a parallel stage waits for EVERY call to
// settle before it rethrows. Promise.all rejected on the first BudgetExceeded while sibling calls
// were still in flight - the CLI then exited, so those siblings were billed but never recorded,
// STOPPED-budget.json undercounted, and a resume paid for them again. Now every sibling finishes
// (and is recorded) first; the first rejection is then thrown, as Promise.all would have.
export async function settleAll(promises) {
  const results = await Promise.allSettled(promises);
  throwFirstRejection(results);
  return results.map(r => r.value);
}

// The rest of settleAll, for a caller that must look at the settled results before the rejection travels (the blind panel keeps an answered judge when a finish ends the run): throws what settleAll would throw, returns nothing when every call was fulfilled.
export function throwFirstRejection(results) {
  const failed = results.find(r => r.status === 'rejected');
  if (failed) {
    // Parallel external seats (2026-09-25, Muad's "yes" to a subscription-seat panel): when the
    // first rejection is an ExternalPause, every OTHER seat of the same stage that paused rides
    // along on it as `siblings`, so the CLI writes all their NEEDS files at once and the operator
    // can answer them in parallel. Before this, a panel of seven external seats surfaced one pause
    // per resume - seven resumes per round. Only pauses ride along: a BudgetExceeded or any other
    // rejection that settled first still wins exactly as before, and a pause that settled after
    // one is still thrown on the next resume, as it always was.
    if (failed.reason instanceof ExternalPause) {
      const siblings = results
        .filter(r => r.status === 'rejected' && r.reason !== failed.reason && r.reason instanceof ExternalPause)
        .map(r => r.reason);
      if (siblings.length) failed.reason.siblings = [...(failed.reason.siblings || []), ...siblings];
    }
    // A3a commit 2 (18 Okt 2026, C&C): every seat of this stage that OpenRouter refused at its price pin rides along on the first refusal as `also`, so ONE stop names them all and one resume (a row each, or --skip-seat) fixes the stage,
    // instead of "fix one, resume, hit the next". Only refusals ride along; any other rejection that settled first still wins exactly as before.
    if (failed.reason instanceof PriceRefused) {
      const also = results.filter(r => r.status === 'rejected' && r.reason !== failed.reason && r.reason instanceof PriceRefused).map(r => r.reason);
      if (also.length) failed.reason.also = also;
    }
    throw failed.reason;
  }
}

/** Every pause an ExternalPause carries (itself first, then its siblings, nested ones flattened),
 *  one per label. */
export function pendingPauses(err) {
  const out = [];
  const seen = new Set();
  const walk = p => {
    if (!p || seen.has(p.label)) return;
    seen.add(p.label);
    out.push(p);
    for (const s of p.siblings || []) walk(s);
  };
  walk(err);
  return out;
}

// Dispute review (2026-09-23, opt-in `dispute: { enabled: true, review: true }`). Muad: "Reviewers
// should check disputes thoroughly, no?" The dispute stage gives the reviser the last word on
// every open objection; this asks each panel seat that held one, in ONE call per seat, whether
// the final draft handles each of its objections honestly. It is a check on the record, not a
// vote: its result can flag, never pass, and it never re-opens the review.
//
// A verdict counts only if it can be checked. A claimed "accepted" or "misrepresented" whose
// quote isn't in the final draft, an unreadable reply, a reply that skips an objection and an
// unreachable seat all become "unconfirmed": silence and unverifiable answers are never read
// as consent (the same rule the panel's own unheard votes follow).
export const DISPUTE_REVIEW_VERDICTS = ['accepted', 'misrepresented', 'silently_dropped'];

const squash = t => String(t ?? '').replace(/\s+/g, ' ').trim();

// The failures a report shows: `lab` is the bare lab and a repeated seat's key moves to `seat` (the key stays internal; failures keep it in `lab` while the run is going).
// What the dispute prompt's "Raised by" line is built from (roles.js renderClaim): the objection's seat MODEL id from the seat record (never from seat-key text) and, for a model that sits on more than one
// layer of a layered critics panel, its layer. Transient: it is not part of the failure record.
const withRaisedBy = (f, critics) => {
  const seat = f.lab ? critics.find(c => seatKeyOf(c) === f.lab) : null;
  if (!seat) return f;
  const layers = new Set((critics || []).filter(c => (seatIdentity(c) ?? `model:${c.model}`) === (seatIdentity(seat) ?? `model:${seat.model}`) && Number.isInteger(c.layer)).map(c => c.layer));
  return { ...f, model: seat.model, ...(layers.size > 1 ? { model_layer: seat.layer } : {}) };
};
// A conflict item as the decider prompt, the decisions[] rows and the asked rows show it: the BARE lab, the repeated seat's key moved to `seat`.
const bareConflictItem = it => ({ ...shownFailure(it), others: it.others.map(shownFailure) });
// CR-6A-004: a peer a withdrawal quoted (`quoted_ref`) is recorded by its seat KEY (`<lab>-l2` for a model repeated on a second layer); the record shows the lab, and `quoted_layer` beside it says which layer.
const shownFailure = f => {
  const g = f?.lab && labFromKey(f.lab) !== f.lab ? { ...f, lab: labFromKey(f.lab), seat: f.lab } : f;
  return g?.quoted_ref && labFromKey(g.quoted_ref) !== g.quoted_ref ? { ...g, quoted_ref: labFromKey(g.quoted_ref) } : g;
};
const shownCritique = c => (c?.failures?.some(f => f?.lab && labFromKey(f.lab) !== f.lab) ? { ...c, failures: c.failures.map(shownFailure) } : c);
export async function runDisputeReview(config, { request, openFailures, draftBefore, draftAfter, invoke, record, log = () => {}, rulingsText = '' }) {   // rulingsText (B3 prototype): the rulings in force, appended to what each raising seat reads
  const critics = config.seats?.critics || [];
  const byLab = new Map();
  openFailures.forEach((f, index) => {
    const lab = f.lab || null;
    if (!byLab.has(lab)) byLab.set(lab, []);
    byLab.get(lab).push({ ...f, index });
  });
  const entries = new Array(openFailures.length);
  const entry = (o, fields) => ({ criterion: o.criterion, lab: o.lab ? labFromKey(o.lab) : null, ...(o.lab && labFromKey(o.lab) !== o.lab ? { seat: o.lab } : {}), ...fields });
  const after = squash(draftAfter);
  // T2-6 commit 3 (C&C FIX, 14 Oct 2026): the seat is SHOWN containerText(draftAfter) (src/roles.js disputeReviewUser), so a quote is also checked against exactly that text. Any substring of the shown text is a substring of its
  // squashed form, which is what `shownAfter` is, so a quote copied from the prompt always matches; the escape is never undone on the quote (it is not reversible). The raw match stays, for a seat that quotes the draft as written.
  const shownAfter = squash(containerText(draftAfter));

  const calls = [];
  for (const [lab, objs] of byLab) {
    const seat = lab ? critics.find(c => seatKeyOf(c) === lab) : null;
    if (!seat) {
      for (const o of objs) entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: 'no panel seat for this lab' });
      continue;
    }
    calls.push((async () => {
      let parsed = null;
      let failure = null;
      try {
        const s = record(await invoke(seat, {
          system: R.DISPUTE_REVIEW_SYSTEM,
          user: R.disputeReviewUser({ request, objections: objs, draftBefore, draftAfter }) + rulingsText,
          log, label: `dispute-review-${lab}`,
        }));
        parsed = parseJson(s.text);
        if (!Array.isArray(parsed?.reviews)) failure = 'unreadable reply';
      } catch (err) {
        rethrowControlFlow(err);
        failure = `seat unreachable: ${err.message}`;
      }
      objs.forEach((o, k) => {
        if (failure) return void (entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: failure }));
        const r = parsed.reviews.find(x => x?.objection === k + 1) ?? null;
        const claimed = DISPUTE_REVIEW_VERDICTS.includes(r?.verdict) ? r.verdict : null;
        const quote = typeof r?.quote === 'string' ? r.quote : '';
        const quoteFound = quote.trim() !== '' && (after.includes(squash(quote)) || shownAfter.includes(squash(quote)));
        const base = { claimed_verdict: claimed, quote, quote_found: quoteFound, note: typeof r?.note === 'string' ? r.note : null };
        if (!claimed) {
          entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: r ? 'no valid verdict' : 'objection not answered', ...base });
        } else if (claimed !== 'silently_dropped' && !quoteFound) {
          entries[o.index] = entry(o, { verdict: 'unconfirmed', reason: 'quote not found in the final draft', ...base });
        } else {
          entries[o.index] = entry(o, { verdict: claimed, ...base });
        }
      });
    })());
  }
  await settleAll(calls);

  const count = v => entries.filter(e => e.verdict === v).length;
  const counts = { accepted: count('accepted'), misrepresented: count('misrepresented'), silently_dropped: count('silently_dropped'), unconfirmed: count('unconfirmed') };
  log(`  dispute review: ${counts.accepted} accepted, ${counts.misrepresented} misrepresented, ${counts.silently_dropped} silently dropped, ${counts.unconfirmed} unconfirmed.`);
  return { ran: true, entries, counts, flagged: entries.filter(e => e.verdict !== 'accepted') };
}

/**
 * The final read (unit D, src/final-read.js): once, at a not-agreed end, each top-layer seat that has not read the plan as it ends reads it. One call per seat through
 * invoke(), one re-ask with a NEW label and a NEW envelope pair when the reply is unreadable (at a bigger cap when the first reply was cut off, as a panel review is),
 * then "did not read". The reply is recorded as a closing statement; it feeds nothing else (not signoff[], not panelVerdicts, not the stall or ladder state).
 * `seats` are the seat objects to ask (already chosen by seatsToRead); `lastReadShas` is the Map from layer3ReadShas.
 */
// 0.8.4 S9 (S9-R1): what readSorting reads of the route: only with the S9 words recorded and the Decisions rule on; on a chain with no proposer seat a "proposers" is read as "writer" (D29). null = S8's reading, key for key.
const routeOptsOf = config => (decisionLevelOn(config) ? { route: true, proposers: proposerSeatsOf(config).length > 0 } : null);
// 0.8.4 S16 (Q9(f), route 4): each layer-3 seat's ROOM for the list, in characters of the printed list (a Map seat key -> number). An INPUT: the tests set it here; the production source (the seat's input window W less the prompt and the reply allowance) is wired separately. null/absent for a seat = no room check and one part, as before.
let finalReadRoomsForTest = null;
export const setFinalReadRoomsForTest = rooms => { finalReadRoomsForTest = rooms; };
export const FINAL_READ_NO_ROOM_WHY = "the final read's prompt leaves this seat no room in its input window";   // WORDING S16-w9 (a)
export const FINAL_READ_SIZE_WHY = 'the provider refused the prompt for its size, even with one open objection or late finding in it';   // WORDING S16-w53 (H3)
/** 0.8.4 S16 (parts_unread, WORDING S16-w72c, w72d): the cause of a later part's unreadable reply, in the form part 1's own `why` takes: an envelope cause, else the classification of the reply; a reply that parsed and carried no sorting list says so. */
export function laterPartWhy(cs, cap, envExpect) {
  const asked = askedCapOf(cs, cap);
  const envelopeWhy = envelopeWhyOf(cs, asked, envExpect);   // the envelope cause first, as part 1's own why reads it
  const envW = envelopeWhy && held('criticEnvelopeUnreadableWhy')?.({ kind: envelopeWhy });
  if (envW) return envW;
  const parsed = (() => { try { return parseJson(cs.text, { verdict: true }); } catch { return null; } })();   // the reply as a verdict (no `expect` here: the envelope cause was read above)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.sorting)) return 'the reply carried no sorting list';
  return classifyUnreadable(cs.usage, asked);
}
export const FINAL_READ_OVERSIZE_WHY = "one open objection or late finding is longer than the room this seat's input window leaves for the list";   // WORDING S16-w9 (b)
export async function runFinalRead(config, { seats, lastReadShas, request, criteria, draft, checks = '', fencedSource = false, excerptsMayBeShown = false, rulingsText = '', endMarker = false, sortItems = null, rooms = finalReadRoomsForTest, seatInfo = null, labelTag = '', invoke, record, log = () => {} }) {
  const sortingGate = sortingOn(config);   // 0.8.4 S8: the sorting is read only with the ledger, the rating demand and both S8 words recorded (src/sorting.js sortingOn)
  // 0.8.4 S16 (G2a; WORDING S16-w14/w16b/w17): once the final read's own words are recorded (W31 `finalReadRule`, its reply form and its per-seat list), each seat is shown ITS list (marked new / what it sorted before) after W31's clause for the seat. While held: S8's list, byte for byte.
  const w31 = finalReadWordsOn();
  const listRender = w31 ? held('finalReadSortingItems') : held('layerThreeSortingItems');
  const decorateFor = key => items => (w31 ? items.map(it => { const info = seatInfo?.get(key); const prior = info?.prior?.get(it.id); return { ...it, ...(info?.newIds?.has(it.id) ? { isNew: true } : {}), ...(prior ? { prior } : {}) }; }) : items);
  const sortListText = sortingGate && sortItems && sortItems.items.length ? `\n\n${held('layerThreeSortingItems')({ items: sortItems.items })}` : '';   // 0.8.4 S8 c2a: the list the seat sorts, inside the string the envelope and the hash cover, so a re-ask carries it too
  const severityOn = ratingsDemanded(config);   // the rating demand (src/ratings-demand.js: a layered unanimous chain and the held word recorded), read here (runChain's own flag is not in this scope); it decides the strict refusal of a missing rating
  const entries = new Array(seats.length);
  const calls = seats.map((seatObj, i) => (async () => {
    const key = seatKeyOf(seatObj);
    const label = finalReadLabel(key, labelTag);   // 0.8.4 S16 (D): '' for the first read, `-c<n>` for a continue's, `-f` for the read before a finish (final-read.js finalReadTag)
    const id = { lab: labOf(seatObj), ...(seatField(seatObj).seat ? { seat: seatField(seatObj).seat } : {}), layer: seatObj.layer, lastReadSha: lastReadShas.get(key) ?? null };
    const seat0 = seatObj.panelMaxTokens ? { ...seatObj, maxTokens: seatObj.panelMaxTokens } : seatObj;
    // 0.8.4 S16 (T21ce, T21cf, T21n; H): the seat's room. A test gives it as characters of the printed list (the seam `rooms`); in production it is the window rule (src/context-window.js): the part's WHOLE prompt at chars/4 plus the cap the call is sent with fits in HALF of the model's window W (an OpenRouter seat in src/context-windows.json; no W, no check).
    // No room, or a row that no part can hold: no call, the seat is named as not having read. A list that needs more parts than one is read in parts in the plan's order.
    const clauseText = w31 ? `\n\n${held('finalReadRule')({ read: !!seatInfo?.get(key)?.read })}` : '';
    const seamRoom = rooms && typeof rooms.get === 'function' ? rooms.get(key) : undefined;
    const windowTokens = typeof seamRoom === 'number' ? null : contextWindowOf(seatObj);
    const sentCap = seat0.maxTokens ?? DEFAULT_MAX_TOKENS;
    const partsCanBeRead = typeof held('finalReadPartRule') === 'function';
    // the whole prompt of a call that carries these items: the system text and the user text the call would send (the same builders, an empty list for the base)
    const promptCharsFor = items => {
      const partRule = partsCanBeRead ? `\n\n${held('finalReadPartRule')({ n: 9, k: 9 })}` : '';   // partText(p) appends it to every part whichever way the list is worded
      const list = (w31 && sortingGate ? `${clauseText}${items.length ? `\n\n${listRender({ items })}` : ''}` : (items.length && sortingGate ? `\n\n${held('layerThreeSortingItems')({ items })}` : '')) + partRule;
      // the envelope section is added LAST by withEnvelope (which issues ids, so the check does not call it): its length is taken with generous ids
      const envelope = envelopeInForce() && typeof held('verdictEnvelopeSection') === 'function' ? held('verdictEnvelopeSection')({ review_id: 'x'.repeat(32), draft_id: 'x'.repeat(32) }).length + 2 : 0;
      return finalReadSystemFor(seatObj, config, { fencedSource, criteriaKinds: !!checks, excerptsMayBeShown }).length + (R.criticUser({ request, criteria, draft: boundedDraft(draft, endMarker), checks, endMarker }) + rulingsText + list).length + envelope + (excerptReader?.('final-read') ? excerptReader('final-read').length + 2 : 0) + (leadInOf(config, seatObj, 'panel') ? leadInOf(config, seatObj, 'panel').length + 2 : 0);   // the lead-in of the cache-shaped order is part of the prompt the room check sizes
    };
    const roomKnown = typeof seamRoom === 'number' || windowTokens !== null;
    const fits = typeof seamRoom === 'number' ? items => listRender({ items }).length <= seamRoom : items => fitsHalfWindow(windowTokens, promptCharsFor(items), sentCap);
    let parts = null; let partTags = [];   // partTags[p]: the label suffix of part p (H3: a part refused for its size is read in halves under `-h1` / `-h2` suffixes; the first read's labels never change)
    if (roomKnown) {
      if (typeof seamRoom === 'number' ? seamRoom <= 0 : !fitsHalfWindow(windowTokens, promptCharsFor([]), sentCap)) { entries[i] = unreadEntry({ ...id, label, reasked: false, why: FINAL_READ_NO_ROOM_WHY }); return; }
      if (sortingGate && sortItems && sortItems.items.length) {
        const packed = packParts(orderForParts(decorateFor(key)(sortItems.items)), fits);
        if (packed.oversize) { entries[i] = unreadEntry({ ...id, label, reasked: false, why: FINAL_READ_OVERSIZE_WHY }); return; }
        if (packed.parts.length > 1 && partsCanBeRead) {
          parts = packed.parts; partTags = parts.map((_, i) => (i ? `-part${i + 1}` : ''));
          log(`  ${labOf(seatObj)}: the list of open objections and late findings is longer than the room its input window leaves; it is read in ${parts.length} parts.`);   // WORDING S16-w10
        }
      }
    }
    const partText = p => `${clauseText}\n\n${listRender({ items: parts[p] })}\n\n${held('finalReadPartRule')({ n: parts.length, k: p + 1 })}`;
    let listText = parts ? partText(0) : (w31 && sortingGate ? `${clauseText}${sortItems && sortItems.items.length ? `\n\n${listRender({ items: decorateFor(key)(sortItems.items) })}` : ''}` : sortListText);
    let knownIds = parts ? new Set(parts[0].map(x => x.id)) : (sortItems ? sortItems.knownIds : null);
    let readOk = false;
    let reasked = false;
    let cap = seat0.maxTokens ?? DEFAULT_MAX_TOKENS;
    let lastWhy = 'no reply';
    let sevGap = null;   // post-V fix-up: the first missing-tag cause seen (src/chain.js normaliseCritique `severityGap`); the re-ask carries its note whether or not its cap was raised, so the bigger-cap attempt never drops it
    // 0.8.4 S16 (H3; Muad 09 Nov 2026, C&C): a request the provider REFUSES for its size (isSizeRefusal: the documented context_length_exceeded / payload_too_large) is not asked again as it was: the part is split in two, each half goes through invoke() under its own reservation and additive labels, down to a part of one item; a part of one item that is still refused means the judge did not read. No other error is retried here (the one re-ask of an unreadable reply is as before).
    halving: for (;;) {
    let sizeRefused = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const callLabel = `${label}${partTags[0] ?? ''}${attempt ? FINAL_READ_REASK_SUFFIX : ''}`;
      if (attempt) reasked = true;
      let askedPrompt = null;   // 2 Nov 2026: the strings this call was sent (a near-JSON pause is held to their hash on resume)
      let cs, parsed, env, envUsed = null;   // envUsed: the pair this call was asked under, taken from withEnvelope's result (the guard test/verdict-envelope.test.js E3b names this shape)
      try {
        const cu = { request, criteria, draft: boundedDraft(draft, endMarker), checks, endMarker };   // 0.8.4 D38: ONE arguments object for the prompt and for the head the excerpt block follows (R.criticUserHead of the same arguments)
        env = withEnvelope(callLabel, draft, R.criticUser(cu) + rulingsText + listText + (attempt && sevGap ? `\n\n${orderNote(config, seatObj, R.severityReaskNote(sevGap))}` : ''));   // the rulings in force, as the dispute stage shows them: a seat is not asked to re-argue what the handler already ruled
        envUsed = env.expect;
        askedPrompt = judgePrompt({ config, seat: seatObj, kind: 'panel', compose: () => finalReadSystemFor(seatObj, config, { fencedSource, criteriaKinds: !!checks, excerptsMayBeShown }), user: env.user, head: R.criticUserHead(cu), headArgs: cu, endMarker: endMarker });   // cache part (b)1: as the panel's
        cs = record(await invoke(keepSeatKey(seat0, { ...seat0, maxTokens: cap }), {
          system: askedPrompt.system,
          user: askedPrompt.user,
          blockAfter: askedPrompt.head ?? R.criticUserHead(cu),
          ...(askedPrompt.laid ? { cacheHead: askedPrompt.head, shownSystem: askedPrompt.shownSystem } : {}),
          log, label: callLabel, judge: true,
        }));
        parsed = parseJson(cs.text, { verdict: true, ...(envUsed ? { expect: envUsed } : {}) });
      } catch (err) {
        if (err instanceof NotRunForLimit) { entries[i] = attempt ? notReaskedEntry({ ...id, label: callLabel, reason: err.reason }) : notRunEntry({ ...id, label: callLabel, reason: err.reason }); return; }   // the re-ask (attempt 1) follows a reply that is on disk and could not be read: the seat WAS asked (A-DRAFT LAD-R26)   // 0.8.4 (finish at once at the spending limit): this seat's call would bill, so it is not asked; the entry says so (not an abstention, not a failed answer)
        rethrowControlFlow(err);
        if (halvesOnSizeRefusal(seatObj) && isSizeRefusal(err)) { sizeRefused = true; lastWhy = FINAL_READ_SIZE_WHY; break; }   // not billed (a pre-generation 4xx settles at $0, invoke's catch); asked again only after the part is halved
        lastWhy = `no reply (${String(err.message).slice(0, 120)})`;
        continue;
      }
      // 2 Nov 2026 (near-JSON pause, nearJsonPause): an almost-JSON closing statement pauses the run for a repair instead of being re-asked and then "did not read"; thrown outside the try, so it travels like an external seat's pause (settleAll below).
      if (!parsed) {
        const nearJson = askedPrompt && nearJsonPause(cs, { model: seatObj.model, maxTokens: cap }, askedPrompt.system, sentUserOf(cs, askedPrompt.user), askedPrompt.shownSystem);
        if (nearJson) { log(`  ${key}: the final read is almost JSON and could not be read - the run pauses for a repair (${nearJson.label}).`); throw nearJson; }
      }
      const asked = askedCapOf(cs, cap);
      // post-V fix-up: with the chain's severity switch on the parse asks for a tag on every objection (the system text already asks: criticPromptFor); before, it dropped the tags the seats wrote
      const critique = parsed ? normaliseCritique(parsed, log, { stage: callLabel, severity: severityOn, criteria }) : null;
      if (critique && !critique.unreadable && !(providerCutOff(cs.usage) && critique.meets === true)) {
        // 0.8.4 S16 (Q9(e), RU-S16-04/05, T21ae, T21af, T17y), once the final read's own words (W31, held `finalReadRule`) are recorded: a new defect a seat names in its sorting is an OBJECTION of the final read when it can anchor it (a passage that is in the plan), otherwise a late finding with the seat's rating. Before that the seat is told W7's words and nothing about it changes meaning (the records below are ungated: they describe what the seat wrote).
        const read = sortingGate ? readSorting(critique.sorting, knownIds, { ...(routeOptsOf(config) || {}), finalRead: true, ...(w31 ? { passageless: true } : {}), ...(sortItems ? { unanchored: sortItems.unanchored } : {}) }) : null;
        const seatKey = seatKeyOf(seatObj);
        const tight = w31 && read && read.fresh.length ? normQuoteTight(draft) : null;
        const anchored = w31 && read ? read.fresh.filter(f => f.quote && !lateUngroundedWhy({ criterion: f.criterion || '', quote: f.quote }, tight)) : [];
        const lateFresh = read ? read.fresh.filter(f => !anchored.includes(f)) : [];
        // an objection has an id like every objection, over the seat key (the tool mints it; the seat cannot cite it): src/final-read.js finalReadObjections (suffix #2, #3 for another text under the same id; the list the seat was shown is respected)
        const made = finalReadObjections({ failures: critique.failures || [], known: sortItems ? sortItems.problems : new Map(), baseIdOf: f => objectionId(seatKey, f),
          rows: anchored.map(f => ({ criterion: f.criterion || '', problem: f.reason, quote: f.quote, ...(typeof f.rating === 'number' ? { severity: f.rating } : {}) })) });
        const fromSorting = [...made.added, ...made.restated]; const ownFailures = made.failures;   // 0.8.4 S18 (C&C's ruling): a must-do on the seat's own earlier objection is that seat's objection again, on the same id (no new id), so it is recorded and the seat does not read as clearing
        const critique2 = fromSorting.length ? { ...critique, meets: false, failures: [...ownFailures, ...fromSorting] } : { ...critique, failures: ownFailures };
        const concern = w31 && parsed && typeof parsed.concern === 'string' && parsed.concern.trim() ? parsed.concern.trim().slice(0, REASON_CAP) : null;   // 0.8.4 S16 (I, D25): read from the reply itself (the field is asked for by W31 only); part 1 only
        entries[i] = readEntry({ ...id, label: callLabel, reasked, critique: critique2, sorting: read ? read.rows : null, sortingIgnored: read ? read.ignored : 0, sortingNew: lateFresh, concern });
        readOk = true;
        break;
      }
      if (critique?.severityGap && !sevGap) sevGap = critique.severityGap;
      // The cause, as the panel words it: a reply that parsed but lacks the envelope ids is not "malformed JSON".
      const envelopeWhy = envelopeWhyOf(cs, asked, envUsed);
      lastWhy = (envelopeWhy && held('criticEnvelopeUnreadableWhy')?.({ kind: envelopeWhy })) || (critique?.severityGap && critique.unreadableWhy) || classifyUnreadable(cs.usage, asked);   // a missing tag says so (the parse's own reason), not "malformed"
      // A reply the provider cut off is asked again at the bigger cap, as a panel review is (the one re-ask this stage has).
      if (providerCutOff(cs.usage)) { const bigger = cutOffRetryCap(asked, retryCeilingOf(seatObj)); if (bigger > asked) cap = bigger; }
    }
    if (readOk || !sizeRefused) break;
    // halve part 1: its second half becomes a sort-only part (the parts exist only once the part sentence is recorded)
    const items1 = parts ? parts[0] : (sortingGate && sortItems && sortItems.items.length ? orderForParts(decorateFor(key)(sortItems.items)) : []);
    if (!partsCanBeRead || items1.length < 2) break;
    const mid1 = Math.ceil(items1.length / 2);
    parts = [items1.slice(0, mid1), items1.slice(mid1), ...(parts ? parts.slice(1) : [])];
    partTags = [`${partTags[0] ?? ''}-h1`, `${partTags[0] ?? ''}-h2`, ...partTags.slice(1)];
    log(`  ${labOf(seatObj)}: the provider refused a part of the list for its size; it is read in two halves.`);   // WORDING S16-w52
    listText = partText(0); knownIds = new Set(parts[0].map(x => x.id));
    }
    if (!readOk) { entries[i] = unreadEntry({ ...id, label, reasked, why: lastWhy }); return; }
    // 0.8.4 S16 (T21ba, T21bn; W42): the later parts are SORT-ONLY. One call each (and one re-ask of an unreadable reply), its own additive label, the same prompt as part 1 with that part's list; only the `sorting` against that part's ids is read: a verdict, an objection or a new defect in a later part is ignored. A part that is not read leaves its ids without this seat's word (read as must-do, src/sorting.js combineSortings).
    const partsUnread = [];
    for (let p = 1; parts && p < parts.length; p++) {
      const ids = new Set(parts[p].map(x => x.id));
      let got = false; let laterRefused = false;
      let whyP = 'no reply';   // 0.8.4 S16 (parts_unread {label, why}): the cause of the LAST attempt at this part, in the sentence form of part 1's own `why` (lastWhy)
      for (let attempt = 0; attempt < 2; attempt++) {
        const callLabel = `${label}${partTags[p]}${attempt ? FINAL_READ_REASK_SUFFIX : ''}`;
        let rd = null; let csP = null; let envP = null; let capP = seat0.maxTokens ?? DEFAULT_MAX_TOKENS;
        try {
          const cu = { request, criteria, draft: boundedDraft(draft, endMarker), checks, endMarker };   // 0.8.4 D38: ONE arguments object for the prompt and for the head the excerpt block follows (R.criticUserHead of the same arguments)
          const env = withEnvelope(callLabel, draft, R.criticUser(cu) + rulingsText + partText(p));
          const envUsed = env.expect; envP = envUsed;
          const laidP = judgePrompt({ config, seat: seatObj, kind: 'panel', compose: () => finalReadSystemFor(seatObj, config, { fencedSource, criteriaKinds: !!checks, excerptsMayBeShown }), user: env.user, head: R.criticUserHead(cu), headArgs: cu, endMarker: endMarker });   // cache part (b)1: as the first call's
          const cs = record(await invoke(keepSeatKey(seat0, { ...seat0, maxTokens: capP }), { system: laidP.system, user: laidP.user, blockAfter: laidP.head ?? R.criticUserHead(cu), ...(laidP.laid ? { cacheHead: laidP.head, shownSystem: laidP.shownSystem } : {}), log, label: callLabel, judge: true }));
          csP = cs;
          // W42: in a later part the seat signs nothing and raises nothing, so the reply is read for its `sorting` ALONE (after the envelope check): a verdict, an unrated objection or a missing table cannot make the part unreadable.
          const parsed = parseJson(cs.text, { ...(envUsed ? { expect: envUsed } : {}) });
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sorting)) rd = readSorting(parsed.sorting, ids, routeOptsOf(config));
        } catch (err) { if (err instanceof NotRunForLimit) { whyP = FINAL_READ_NOT_RUN_WHY; break; } rethrowControlFlow(err); if (halvesOnSizeRefusal(seatObj) && isSizeRefusal(err)) { laterRefused = true; whyP = FINAL_READ_SIZE_WHY; break; } whyP = `no reply (${String(err.message).slice(0, 120)})`; }
        if (!rd && csP) whyP = laterPartWhy(csP, capP, envP);
        if (rd) {
          const e = entries[i];
          entries[i] = { ...e, ...(rd.rows.length || e.sorting ? { sorting: [...(e.sorting || []), ...rd.rows] } : {}), ...((e.sorting_ignored || 0) + rd.ignored > 0 ? { sorting_ignored: (e.sorting_ignored || 0) + rd.ignored } : {}) };
          got = true;
          break;
        }
      }
      if (!got && laterRefused && parts[p].length > 1) {   // H3: halve a later part and ask the first half again at this index
        const items = parts[p]; const mid = Math.ceil(items.length / 2); const tag = partTags[p];
        parts.splice(p, 1, items.slice(0, mid), items.slice(mid)); partTags.splice(p, 1, `${tag}-h1`, `${tag}-h2`);
        log(`  ${labOf(seatObj)}: the provider refused a part of the list for its size; it is read in two halves.`);   // WORDING S16-w52
        p -= 1; continue;
      }
      if (!got) {   // WORDING S16-w12b, w71, w72d: the part is named by the label its call carried; a part refused for its size had no re-ask, and says so
        const partLabel = `${label}${partTags[p]}`;
        partsUnread.push({ label: partLabel, why: whyP });
        log(laterRefused ? `  ${labOf(seatObj)}: the part of the list asked as "${partLabel}" was refused by the provider for its size, even with one open objection or late finding in it; the objections in it have no word from this seat and stand as must-do; its late findings have no word from this seat either, and a late finding counts only with the sorting of a seat that read it.` : `  ${labOf(seatObj)}: the part of the list asked as "${partLabel}" could not be read after one re-ask; the objections in it have no word from this seat and stand as must-do; its late findings have no word from this seat either, and a late finding counts only with the sorting of a seat that read it.`);
      }
    }
    if (partsUnread.length) entries[i] = { ...entries[i], parts_unread: partsUnread };
  })());
  await settleAll(calls);
  return entries;
}

/** The top-of-deliverable lines for the review. Built from the record, never from a seat's prose alone. */
export function renderDisputeReviewFlags(review) {
  if (!review?.ran) return [];
  if (!review.flagged.length) {
    return [`*Dispute review: every seat that held an open objection confirmed the draft above handles it honestly (${review.counts.accepted} checked).*`, ''];
  }
  const what = { misrepresented: 'MISREPRESENTED', silently_dropped: 'SILENTLY DROPPED', unconfirmed: 'NOT CONFIRMED' };
  return [
    `### Dispute review: ${review.flagged.length} objection(s) not confirmed as honestly handled`,
    '',
    'Each seat that raised an open objection was asked whether the reviser\'s last pass dealt with it honestly.',
    '',
    ...review.flagged.map(e => `- **${what[e.verdict]}** - ${e.criterion} (raised by ${e.seat ? shownKey(e.seat) : e.lab || 'an unnamed lab'})` +
      `${e.reason ? `: ${e.reason}` : ''}${e.note ? `. Seat's note: ${e.note}` : ''}${e.quote ? ` Quoted: "${e.quote}"` : ''}`),
    '',
  ];
}

/** BOARD.md's section for the dispute review: every objection, the seat's verdict and its quote. */
export function renderDisputeReviewBoard(dispute) {
  const entries = dispute?.review?.entries;
  if (!entries?.length) return '';
  const rows = entries.map(e => `- **${e.verdict}** - ${e.criterion} (${e.seat ? shownKey(e.seat) : e.lab || 'unnamed lab'})` +
    `${e.claimed_verdict && e.claimed_verdict !== e.verdict ? `; seat said "${e.claimed_verdict}"` : ''}` +
    `${e.reason ? `; ${e.reason}` : ''}${e.quote ? `\n  - Quote: "${e.quote}"${e.quote_found ? '' : ' (not found in the final draft)'}` : ''}` +
    `${e.note ? `\n  - Note: ${e.note}` : ''}`);
  return `\n\n## Dispute review (each objection's own seat, after the reviser's last pass)\n\n${rows.join('\n')}`;
}

// Per-run cache, set by the CLI: get(label) -> { text, usage, usd, ... } or null.
let cache = { get: () => null };
export function setCache(c) { cache = c || { get: () => null }; }
// 0.8.4 D38 (option I): the reader invoke() asks for the excerpt block of a call (label -> text, '' = none); set by runChain for a run that has recorded excerpts, restored when it returns. invoke() holds no excerpt state.
let excerptReader = null;
export function setExcerptReader(fn) { excerptReader = typeof fn === 'function' ? fn : null; }
// 0.8.4 T14 (CA2/D17, owner 05 Nov 2026 03:52): the ledger of the sitting (src/stale-guard.js), armed by the MAIN run's CLI with the running code's { version, code_sha256? }; null everywhere else (side runs, direct callers, tests), where the cache
// behaves exactly as before. `wordingKept()` is what the report lists: the stages this sitting kept as they were saved.
let wordingLedger = null, earlierWordingTold = false;
export function setWordingStamp(now) { wordingLedger = now ? createWordingLedger({ now }) : null; earlierWordingTold = false; }
export function wordingKept() { return wordingLedger ? wordingLedger.kept : []; }
export function routeKept() { return wordingLedger ? wordingLedger.keptRoute : []; }   // FIX 5: the stages kept because the route changed (their own record: report.json answered_on_another_route)
// What a saved stage says about who wrote it: its `writtenBy` when it is a plain record (the file is data), and whether the reply on disk still hashes to the `text` that record holds (absent `text`: nothing to compare).
const stampOfHit = (hit, rawText) => {
  const w = hit?.writtenBy && typeof hit.writtenBy === 'object' && !Array.isArray(hit.writtenBy) ? hit.writtenBy : null;
  return { writtenBy: w, textOk: !(typeof w?.text === 'string') || textHashOf(rawText) === w.text };
};
// The kept decision and its log lines, ONE copy for invoke() and the two stages read outside it (the handler's answers, a build-check answer). `group` null: those two depend on everything before them.
const keepsEarlierWording = (label, hit, log, { group = null, direct = false } = {}) => {
  if (!wordingLedger) return false;
  const st = stampOfHit(hit, hit.text);
  if (!wordingLedger.decide({ label, group, writtenBy: st.writtenBy, textOk: st.textOk }).keep) return false;
  if (wordingLedger.routeOnly(st.writtenBy)) {   // FIX 5: only the route changed: 'earlier wording' would be false, so its own line and no 'start a new run' line (A-DRAFT)
    log(`  CACHE: stage "${label}" was answered on ${routeWords(st.writtenBy.route ?? 'anthropic')}; this run is on ${routeWords(wordingLedger.route)}. Kept as it is, no new call.`);
    if (direct) cache.keptOnRoute?.(label, st.writtenBy, wordingLedger.route);
    return true;
  }
  log(`  CACHE: stage "${label}" was answered under THC's earlier wording (written by ${st.writtenBy.version}); kept as it is, no new call.`);
  if (!earlierWordingTold) { earlierWordingTold = true; log(`  To ask these stages again under the current wording, start a new run (--draft) with the plan as it stands.`); }   // A-DRAFT: said once per sitting
  if (direct) cache.keptEarlier?.(label, st.writtenBy);   // the WARNINGS.md line: invoke()'s kept stages get it from the CLI's onStage, these never reach it
  return true;
};
// 2 Nov 2026 (near-JSON pause, src/near-json.js): a pause for a repair is thrown only in a run that can be resumed in its own folder: the main run (src/cli.js sets this next to its stage cache). the side runs (the reshuffled-roster and replay modes), the demo and any direct runChain() caller
// leave it off: they cannot resume, so a near-JSON reply stays the abstention it was (a pause there would end the side run with "did not complete" and no diff).
let repairPauses = false;
export function setRepairPauses(on) { repairPauses = on === true; }

// Per-run spend ceiling in USD, set by the CLI. null means no ceiling.
// `spent` accumulates every stage this run has paid for, including stages
// replayed from disk on a resume - the ceiling is on the run as a whole, not
// on one sitting at the terminal.
//
// `reserved` (bug-audit fix, 2026-09-23, BugAudit_MoneyPath #1): the worst case of every call that
// has passed the cap check and not yet settled. Parallel seats (panel, proposals, debate, replies,
// ambiguity, preflight) used to all check the same `spent` before any of them had added to it, so
// seven critics at $22.89 of a $25 cap all passed and could spend $27.93. Each call now reserves its
// projection synchronously when it passes the check, and the reservation is swapped for the actual
// cost when it settles - so the check a sibling sees already counts every call in flight.
// `assumed` (cost-unit U1 split, 14 Oct 2026): the part of `spent` that is a WORST CASE charged for replayed stages whose usage record has no figure, never a recorded dollar: { stages, usd }. The cap counts it (a resume cannot lap the cap); every record
// (a stage's own usd, report totals, --spend, STOPPED-budget.json spentUsd) carries only the recorded part.
// `reservedExpected` (27 Okt 2026, owner: the gate decides on the expected case, not the worst case): the EXPECTED cost of the same in-flight calls (expectedCallUsd; the worst case for a
// call with no expected size), the figure the gate in invoke() adds to `spent`. `reserved` stays the worst-case sum: budgetState().remaining, the STOPPED line and the advice wave read it.
let budget = { cap: null, spent: 0, reserved: 0, reservedExpected: 0, assumed: { stages: 0, usd: 0 } };
// Audit A1-5 (0.8.1): a cap that is not a finite number above zero (a hand-edited run.json, a corrupt value) used to pass through and make every projection
// "fit" (NaN comparisons are false). It fails closed now: the run does not start. null still means no ceiling (the owner's `--max-usd none`).
export function setBudget(cap) {
  if (cap !== null && cap !== undefined && !(typeof cap === 'number' && Number.isFinite(cap) && cap > 0)) throw new Error(`the spend cap must be a number above 0 (or none), not ${JSON.stringify(cap)}; nothing was run and nothing was spent. Fix --max-usd, or the maxUsd value in the run's run.json.`);
  budget = { cap: cap ?? null, spent: 0, reserved: 0, reservedExpected: 0, assumed: { stages: 0, usd: 0 } };
  capBuckets = null;
  networkResumesTaken = 0;   // 0.8.4: a new sitting starts with none taken; the run folder's own count still applies
}
// 0.8.4 zero retention (the optional setting; src/zero-retention.js): a RUN-LEVEL switch like the budget, armed by the CLI before the first stage (and again from run.json on a resume). invoke() passes it to pinnedExtra, which adds provider.zdr = true to every
// OpenRouter call; nothing is written into a seat or the config (a seat's `extra` is part of the cache fingerprint). Off by default.
let zeroRetention = false;
let zeroRetentionTable = null;      // the list of hosts the run is held to (src/zero-retention.js zdrTableFor of the project folder); null = the shipped table
export function setZeroRetention(on, table = null) { zeroRetention = on === true; zeroRetentionTable = on === true ? table : null; }
// 0.8.4 DUALCAP unit 4a (the contract: src/caps.js "IN-PROCESS"): the per-provider caps. null = OFF: one run total, `budget.cap`, exactly as before (kept out of `budget`, so
// budgetState() with the switch off is byte for byte today's). Armed: { <id>: { cap, spent, reserved, reservedExpected, assumed: { stages, usd } } } for the caps in force,
// beside the run totals in `budget` (whose cap is null: there is no third total). invoke() gates and charges a seat on the bucket of the account it bills through
// (billingAccountOf); every charge also lands in the run total.
let capBuckets = null;
// Arms the buckets after setBudget(null) (the CLI's order; setBudget clears them). Fails closed like setBudget: nothing is armed unless every entry is a provider that bills
// with a finite limit above 0, and never beside a run cap. Messages A-DRAFT (the CLI prints them).
export function setCapBudgets(map) {
  if (budget.cap !== null) throw new Error(`the per-provider spend caps cannot be armed beside a per-run spend cap of ${formatUsd(budget.cap)}: a run is held to one kind of limit, not both; nothing was run and nothing was spent.`);
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length) throw new Error(`the per-provider spend caps must name at least one provider with its limit, not ${JSON.stringify(map)}; nothing was run and nothing was spent.`);
  const armed = {};
  for (const [id, cap] of Object.entries(map)) {
    if (!BILLING_CAP_IDS.includes(id)) throw new Error(`"${id}" is not a provider that bills (one of ${BILLING_CAP_IDS.join(', ')}), so it cannot have a spend cap; nothing was run and nothing was spent.`);
    if (!(typeof cap === 'number' && Number.isFinite(cap) && cap > 0)) throw new Error(`the ${id} spend cap must be a number above 0, not ${JSON.stringify(cap)}; nothing was run and nothing was spent.`);
    armed[id] = { cap, spent: 0, reserved: 0, reservedExpected: 0, assumed: { stages: 0, usd: 0 } };
  }
  capBuckets = armed;
}
const bucketOf = capName => (capBuckets && capName && Object.hasOwn(capBuckets, capName) ? capBuckets[capName] : null);
// The `estimate` block of the chain runChain is driving (null outside a run): where invoke()'s gate reads a planned call's expected output size (src/cost.js expectedCallUsd,
// the dry run's own assumptions). Armed by runChain and put back when it returns, so a nested run (descending mode's sub-runs) restores its parent's. Null - a call made outside
// runChain (runSingleStage: handoff --from-run, contract draft, digest) - means every call is gated at its worst case, as before 27 Okt 2026.
let callEstimate = null;
// The RECORDED part of the budget's spend: `spent` minus the worst-case charges for replayed stages with no recorded figure (`assumed`). This is the figure every record carries (STOPPED-*.json, the stop marker, the advice log); `spent` itself is
// what the cap counts. Equal while nothing was assumed.
export function recordedSpentOf(state = budget) { return Math.max(0, state.spent - (state.assumed?.usd || 0)); }
export function budgetState() {
  const state = { ...budget, assumed: { ...budget.assumed }, remaining: budget.cap === null ? null : Math.max(0, budget.cap - budget.spent - budget.reserved) };
  if (capBuckets) state.caps = Object.fromEntries(Object.entries(capBuckets).map(([id, b]) => [id, { ...b, assumed: { ...b.assumed }, remaining: Math.max(0, b.cap - b.spent - b.reserved) }]));   // DUALCAP: only when armed
  return state;
}
// Pre-release audit, money path #2 (Review/PreRelease_Audit_moneypath_2026-09-23.md): spend from an
// earlier sitting whose cached stage is no longer replayed - it went stale and was re-run - still
// happened. The CLI counts it in here (on resume, from the archived `<label>.stale-*.usage.json`
// files) so the cap sees it; otherwise every stale-cache resume got a fresh ceiling on top of what
// was already spent, and "resuming cannot lap the cap" was false.
// DUALCAP unit 4a: `capName` = the cap the figure's own record names (usage and charge files carry it with the caps armed); it is counted in that cap too. A figure whose cap
// is not armed counts in the run total only.
export function countEarlierSpend(usd, capName) {
  if (!(Number.isFinite(usd) && usd > 0)) return;
  budget.spent += usd;
  const b = bucketOf(capName);
  if (b) b.spent += usd;
}

// v5 item 3, touch point 1: an optional module-level progress callback, same setter style as
// setBudget/setCache. Unset (the default, and every caller other than the CLI, including every
// existing test), this is a no-op - invoke() behaves byte-identically. Called once per real
// paid call, right before the call actually goes out (a cache hit or an external pause never
// "starts working" - there is no provider call to be in flight), so state.json's `stage.label`
// only ever names a stage that is genuinely in flight.
let progressHook = () => {};
export function setProgressHook(fn) { progressHook = fn || (() => {}); }

// Money path #4 (Review/PreRelease_Audit_moneypath_2026-09-23.md): two charges were counted toward
// the cap in memory only - a call that failed after it was sent (`maybeBilled`), and an Anthropic
// attempt discarded for thinking when its retry then failed. Neither became a stage, so neither
// reached a usage file, --spend, report.totals or the cap on the next resume, which broke the
// "spend is derived from the run folder" rule. invoke() now reports each one here; the CLI writes it
// to the run folder (superseded/<label>.charge-N.usage.json). Unset, a no-op.
// 0.8.2 item 8b (src/spend-reservations.js): where a paid call's reservation is persisted before it is sent. Null (no file) for a caller that arms none, as the mock-only tests do.
let reservationSink = null;
export function setReservationSink(sink) { reservationSink = sink || null; }
let chargeHook = () => {};
export function setChargeHook(fn) { chargeHook = fn || (() => {}); }

// 0.7.9: the outbound key scan (src/outbound-scan.js), on unless the CLI waives it with
// --allow-secret-shaped. Checked in invoke() after the cache - a replay from disk sends nothing -
// and before the external pause, so a NEEDS file is scanned like a provider call.
// `allowed` ({ key, hashes: Set }): the values the person allowed in this run (run.json `secretAllow`); a prompt whose key-shaped values are ALL in it goes out, any other value pauses the run.
// `finish` (the person's recorded --finish at a found-secret pause, cli.js): the first call that misses the cache while a pass loop runs is the paused stage; invoke() throws SecretFinish for it
// instead of scanning or sending, and the pass loop ends there (see the catch in both loops). `scanPhase` says where the run is: before the pass loops, inside one, or after them.
let outboundScan = { allow: false, allowed: null, finish: false };
let scanPhase = 'before';
// 0.8.4 S16 (F): the recorded --finish at a spending stop, armed by the CLI after the person's typed raise ({ capName } or null): the same first uncached call inside a pass loop ends the loop (SpendFinish).
let spendFinish = null;
export function setSpendFinish(v) { spendFinish = v ? { capName: typeof v.capName === 'string' ? v.capName : null, atOnce: v.atOnce === true, relayed: v.relayed === true } : null; }
// 0.8.4 (ladder unit, --finish-now at a spending stop; C&C 10 Nov 2026): the sitting that ends a run at its spending stop at once. Armed by the command line for that one command only (nothing is written to run.json for a later plain resume to read). While it is armed, a call that
// would bill is not made (NotRunForLimit, thrown by invoke() after the cache and before the reservation), no judge of the panel is asked again, and the labels of the calls not made are returned in the result as `stages_not_run`.
let noMoneySitting = false;
let callsNotRun = [];
export function setNoMoneySitting(v) { noMoneySitting = v === true; callsNotRun = []; }
export { NotRunForLimit };
// the reason words of a call that is not made, as one parenthesis: the spending limit (a call that would bill), or a finish-now at a credential pause after the rounds (a call that would bill or holds the found value)   // A-DRAFT (LAD-R41)
const notMadeWhy = () => outboundScan.endsOnSecret ? 'the call would bill or holds the credential-shaped value, and the person ended the run at once at the pause' : 'the call would bill, and the run was ended at the spending limit';
export function setOutboundScan(opts) { outboundScan = { allow: !!opts?.allow, allowed: opts?.allowed ?? null, finish: opts?.finish === true, atOnce: opts?.atOnce === true, endsOnSecret: opts?.endsOnSecret === true, relayed: opts?.relayed === true }; }   // endsOnSecret (0.8.4): a finish-now at a pause AFTER the rounds: a call whose prompt holds an unallowed secret is not made
// 0.8.4 (ladder unit, step 3): the sitting that ends a run at a found-secret pause at once (--finish-now there). Money is not the limit, so calls that bill are made; what is not made is a JUDGE's read (judge: true) that is not on disk: no judge is asked again, and a read that IS on disk replays and counts as read (the cache decides). Shares callsNotRun with the no-money sitting.
let judgeReplayOnly = false;
export function setJudgeReplayOnly(v) { judgeReplayOnly = v === true; if (judgeReplayOnly) callsNotRun = []; }
// the one scan call of this file: a SecretShapedPrompt says in which phase of the run it was found (secret-stop.json `phase`: --finish is possible only inside the review rounds)
function scanned(label, prompt) {
  try { return assertOutboundClean(label, prompt, outboundScan); }
  catch (err) { if (err instanceof SecretShapedPrompt) err.phase = scanPhase; throw err; }
}

/**
 * One free-text stage on a seat, outside runChain: the same invoke() every stage goes through, so the
 * spend cap, the denied-model backstop and the outbound key scan all apply. For a caller that needs a
 * single call (src/handoff-from-run.js), never as a way round any of them. Set the cap first
 * (setBudget) or it is uncapped, as for any caller.
 */
export async function runSingleStage(seat, { system, user, log = () => {}, label, cacheHead, cacheTtl }) {
  // 0.8.4 cache part (b)2, FIX 3: the optional cache head and lifetime are forwarded to the same invoke() (the cap, the denied-model check and the key scan still apply); a caller that passes neither sends exactly what it sent before.
  return invoke(seat, { system, user, log, label, ...(cacheHead !== undefined ? { cacheHead } : {}), ...(cacheTtl !== undefined ? { cacheTtl } : {}) });
}

// 0.8.4 S20 slice 2 (#16c, the owner's "pause after this round"): asked at the HEAD of every pass after the first, before anything of that pass is logged, built, written or reserved. It returns null, or { request_seq } when the person or the handler session asked the run to stop
// before this pass starts. src/cli.js installs it; with none installed (every other caller, every existing test) a run never pauses. It only returns: the stop is thrown by the loop head below, as RoundStopped.
let pauseCheck = () => null;
export function setPauseCheck(fn) { pauseCheck = typeof fn === 'function' ? fn : () => null; }
// 0.8.4 (ladder unit, C&C 10 Nov): the second question at the head of a pass, asked BEFORE pauseCheck: did the person END the run at the pause that stopped it before this pass? The CLI installs it (src/run-controls.js pauseFinishedFor, which reads the gate ledger: a `pause_finished` line for the request of the pass before); with none installed a run never ends there. chain.js imports no gate module.
let pauseFinishCheck = () => null;
export function setPauseFinishCheck(fn) { pauseFinishCheck = typeof fn === 'function' ? fn : () => null; }

// Test seam, null in production (a seam like setPauseCheck): receives { label, provider, model, system, user } for every stage prompt before it is cached, sent or paused on.
// Door tests use it to prove a sentence reaches the seat. No code under src/ sets it (test/held-prompts.test.js scans for that).
let promptSpy = null;
/** 0.8.4 S6 (G7): the label ending of the ONE extra verdict call a top-layer judge gets when its reply to the exchange ended with "sign-off: no" and nothing of its own stands. The in-pass re-ask loop owns -reask1 .. -reask<IN_PASS_REASKS_PER_SEAT> (the cache replays by label, so a reused ending would serve the old reply); this one is above them, and /-reask\d+/ still prices it at the expected cost of the call it repeats. */
export const SIGNOFF_REASK_TAG = `-reask${IN_PASS_REASKS_PER_SEAT + 1}`;
export function setPromptSpy(fn) { promptSpy = typeof fn === 'function' ? fn : null; }

// 0.8.4 network-error resume (his decision 9 of 28 Okt 2026: "Yes, up to 3, counted and bounded. BUT: expected-case not maximum-case cost"; the pilot's rule, PROTOCOL Amendment 13: "resume up to 3 times"; C&C's ruling of 04 Nov 2026: the three are
// PER RUN, counted across every stage, label and re-ask of the run, and kept in the run folder): a call that failed in transit after its request went out (providers.js isAutoResumable) is asked again inside invoke(), while the run has
// automatic resumes left. Every attempt is gated, reserved on disk before it is sent, settled, and charged on its own. When the three are used, the next such failure stops the run (controlFlow: no catch turns it into an abstention or a re-ask).
// (NETWORK_RESUMES_PER_RUN, the three, is defined in src/cost.js beside the dry run's upper estimate, which prices the same bound; imported above.)
// The resumes this sitting has taken. Reset with the budget (a sitting arms it once). The run folder's own count (the charge files that name a resume) is read beside it, so a resume a person starts does not refill the three.
let networkResumesTaken = 0;
// S6-12's guard against a failure that repeats instead of passing: a label that already settled `billed_unreadable` this many times, in earlier calls of this run folder, is not asked again.
const NETWORK_RESUME_GUARD = 2;
// The side commands' one call each (src/cli.js: digest, handoff --from-run, contract draft): not runs, and each is checked against the policy's spend limit before it, so they are sent once.
const NO_RESUME_LABELS = new Set(['digest', 'handoff-from-run', 'contract-draft']);
// 0.8.4 unit 0b (flag 4, C&C under his 18 Okt pick (c): "count every retry AND bound the retries"): a 5xx means the request reached the provider. The adapter used to send it again twice, free and unrecorded; invoke() now does: each re-send
// has the gate, a reservation at the worst case BEFORE it is sent, a settlement, and a line in the log. The bound stays the existing 2 per ask (the first ask and a thinking-retry ask count apart, so a call has at most 4).
// His pick of 04 Nov 2026 ("2: typical cost") made each 5xx attempt a charge, so the families whose own limit is checked once, before the call, on one attempt's figure send a 5xx ONCE (C&C via Mini-C&C, 04 Nov 2026, R181): the side commands
// that make one call (digest, handoff-from-run, contract-draft: NO_RESUME_LABELS, the same one-shot design) and the deep dive (its own cap never reaches invoke(), so a re-send could not be refused against it). The advice add-on still sends
// again: its own ceiling is kept as a ledger of dollars (src/advise.js), and invoke() hands that ledger what its failed attempts were counted at (`lostChargesUsd` on the returned stage). Every other label sends again as before.
const HTTP5XX_RESENDS_PER_ASK = 2;
/**
 * What a 5xx attempt that carried no usage figure settles at. Given the call's facts: { seat, label, status, expected, typical, attemptWorstCase, onRetry } (`expected` is the call's expected cost, null for a call the dry run does not plan; `typical` is the D43 typical charge of one attempt, src/cost.js typicalCallUsd, the SAME figure an empty error reply is charged).
 * His pick (04 Nov 2026, "2: typical cost"): a bare 5xx is counted at a typical cost for the call, the SAME figure an empty error reply is charged (D43, unit 3; his decision 2 of 28 Okt: "one that carries none is charged at a typical cost for that call"). The request reached
 * the provider and no usage figure came back, so THC's count may be above or below the bill. A call the dry run does not plan (and a retry ask) gets a typical size for what it writes; never above the attempt's own worst case. Where no typical figure can be made the attempt's worst case is
 * charged (the error-reply branch does the same: the count errs high). A seat that does not bill has a typical figure of $0 and settles `failed` at $0 as before. The call site routes both outcomes through the result and marks the settlement `reachedProvider` whatever the amount.
 */
export function httpErrorAttemptSettlement({ status, expected = null, typical = null, attemptWorstCase = 0, onRetry = false } = {}) {
  const usd = typical ?? attemptWorstCase;
  const planned = !onRetry && expected !== null;   // a first ask of a call the dry run plans: the typical figure IS its expected cost
  return { usd, reason: `the provider answered HTTP ${status} after the request was sent and no usage figure came back; counted toward the cap at a typical cost for this call${planned ? ' (its expected cost)' : ''}` };
}
// Test seam, null in production (the same kind as setPromptSpy): replaces httpErrorAttemptSettlement, so a test can prove that EVERY 5xx path settles through it (test/http5xx-resend.test.js).
let http5xxSettlementOverride = null;
export function setHttp5xxSettlementForTest(fn) { http5xxSettlementOverride = typeof fn === 'function' ? fn : null; }

// 0.8.4 D38 (option I): invoke() is the one door every seat call passes; the text really sent (the excerpt block placed in it) is remembered per returned stage, so a call site that keeps a copy of the prompt for a later pause
// (a near-JSON repair, a table repair: both are held to the hash of the prompt on resume) keeps the PLACED text, not the one it built.
const sentUsers = new WeakMap();
const sentUserOf = (stage, built) => sentUsers.get(stage) ?? built;
async function invoke(seat, opts) {
  assertSeatKeyed(seat);   // a copy of a repeated model's seat that lost its key is refused here, loudly (src/seat-key.js)
  const sent = {};
  const stage = await invokeCall(seat, opts, sent);
  if (stage && typeof stage === 'object') sentUsers.set(stage, sent.user ?? opts.user);
  return stage;
}
async function invokeCall(seat, { system, user, log, label, cacheHead, cacheTtl, blockAfter, group = null, shownSystem = null, judge = false }, sent) {   // 0.8.4 T14: `group` names a set of calls proven to read none of each other (src/stale-guard.js); set only by the call sites that verified it
  assertStageLabelSafe(label, labOf(seat));   // BUG-D-021: before anything is read from or written to a run folder, sent or paid
  // Prompt caching (src/prompt-cache.js): a call site that names the start of its prompt hands it over as `cacheHead`, built by the prompt's own builder from the call's own arguments. It must be the start of the text that is sent;
  // otherwise the adapter could not place its marker and the run would stop mid-way, so a mismatch stops here, before anything is read, reserved or sent (a call-site bug, never a model's fault: control flow, not an abstention).
  if (cacheHead !== undefined && !(typeof cacheHead === 'string' && cacheHead !== '' && user.startsWith(cacheHead))) {
    throw Object.assign(new Error(`${label}: the cache head is not the start of the prompt that is sent (a call-site error); nothing was sent`), { controlFlow: true });
  }
  // The head the excerpt block follows must be the start of the prompt that is sent, on EVERY call (the block or not), so a call site that names a wrong one fails in the suites while the block's words are held; control flow, like the cache head's check.
  if (blockAfter !== undefined && !(typeof blockAfter === 'string' && blockAfter !== '' && user.startsWith(blockAfter))) {
    throw Object.assign(new Error(`${label}: the block head is not the start of the prompt that is sent (a call-site error); nothing was sent`), { controlFlow: true });
  }
  // 0.8.4 D38 (option I, C&C 09 Nov 2026): the recorded excerpts the run has shown so far, placed in the text of EVERY seat call, here, before the cost projection, the reservation, the key scan, the spy and the hash see it. `excerptReader` is given by
  // runChain (like setBudget/setCache) and holds no state here; with no block (none recorded, or the words held) `user` is returned as it is. The head is the cache head when the call has one, else `blockAfter` (the criticUser sites name theirs
  // there so that caching, which they do not use, is not switched on); no head: the true end.
  { const block = excerptReader ? excerptReader(label) : ''; if (block) user = placeExcerptBlock(user, block, cacheHead ?? blockAfter); }
  sent.user = user;   // what is really sent, for the call sites that keep a copy of the prompt (below)
  // The marker is sent only for a call that names a head AND a lifetime on a seat that calls Anthropic directly (not a Claude model reached through OpenRouter); `cacheInfo` is what the cap projects with.
  // 0.8.4 cache part (b)2: a Claude seat the route sent through OpenRouter is marked too, at 5 minutes, but only where the cache-shaped order is live (src/cache-order-gate.js markTtlOf gives it '5m'; ruling B's older mark, which exists only while the words are not recorded, never reaches it). A GPT-6 or Qwen seat is never marked.
  const cacheOn = cacheHead !== undefined && (cacheTtl === '5m' || cacheTtl === '1h') && (seat.provider === 'anthropic' || (isRoutedClaudeSeat(seat) && cacheTtl === '5m' && cacheOrderWordsOn()));
  const cacheInfo = cacheOn ? { headChars: (system || '').length + cacheHead.length, ttl: cacheTtl } : null;
  promptSpy?.({ label, provider: seat.provider, model: seat.model, system, user, ...(cacheHead !== undefined ? { cacheHead } : {}), ...(cacheOn ? { cacheTtl } : {}) });
  const started = Date.now();
  // Backstop for the check at the top of runChain: every call, including a replay from disk.
  const denied = deniedReasonsOf(seat);
  if (denied.length) throw new DeniedModel([{ path: label, reasons: denied }]);
  // Resume: a stage that already ran in this run folder is replayed from
  // disk, so a paused-and-resumed run never pays twice.
  //
  // Pre-release audit 5 #1 (HIGH) and money path #2: only when it answered the SAME prompt. A cached
  // stage records the hash of the prompt it was asked (`promptHash`); a different prompt means an
  // earlier stage came out differently this sitting (a seat that failed before and answered now, an
  // operator's new revision), and replaying the old answer would put - for example - a round-2
  // sign-off of the old draft onto new text no critic read. That is a miss: the stage re-runs, and
  // what the old answer cost still counts toward the cap. `staleInputs` is the CLI's own
  // task/config fingerprint check (cache-integrity.js), decided here for the same two reasons.
  // An external stage is never re-run silently: its old answer is set aside by the cache and the
  // run pauses to ask the operator again with the current prompt. A cached stage from before
  // prompt hashes existed has none; it replays as it always did, with a warning.
  const promptHash = promptHashOf(system, user);
  // The cap's projection for this stage, worked out before the cache is read: a replayed stage whose
  // recorded cost is unreadable is charged one attempt of it (security scan 2026-09-26, THC #3).
  //
  // Bug-audit fix, 2026-09-16: checks `seat.originalProvider ?? seat.provider`, not
  // `seat.provider` alone - resolveVendorSeat() (single-vendor mode) rewrites `provider` to the
  // vendor's own name (e.g. "openrouter") but preserves the seat's real underlying identity in
  // `originalProvider`. Checking the plain `provider` field silently under-projected the budget
  // cap for any Anthropic seat routed through single-vendor mode (assuming 1 attempt when the
  // retry below can still cost 2), the same failure this comment already names for a direct
  // Anthropic seat.
  const anthropicSeat = isAnthropicSeat(seat);   // one predicate (src/cost.js), shared with projectAttempts and the add-on's calls_at_most
  // projectStage (cost.js) is this same worst case, shared with the deep-dive seat's own cap. Since 0.8.1 (milestone R) an Anthropic
  // seat's second attempt is the same-effort retry at a BIGGER cap, so the two attempts differ: the figures are kept apart, and a
  // call that fails after it was sent is charged the worst case of the attempt that failed, not half of the total.
  const promptTokens = promptTokensOfChars(promptCharsOf({ system, user }));   // DUALCAP 4d: this call's prompt size from the ONE characters expression (cost.js promptCharsOf, the one projectAttempts and expectedCallUsd read): the projection below and the price pin send on the same tier
  const attempts = projectAttempts(seat, { system, user, cache: cacheInfo });
  const projected = attempts.first + attempts.retry;
  const oneAttempt = attempts.first;
  let attemptWorstCase = attempts.first; // the worst case of the attempt now in flight (set to attempts.retry for the retry)
  let onRetry = false; // the attempt now in flight is the thinking retry
  // What a replayed stage costs, as TWO figures (cost-unit U1 + C&C's split ruling, 14 Oct 2026). `recorded` is what the stage's own record says (the stage's returned usd, report.json, --spend: a figure the record does not hold is never invented
  // there); `charged` is what the CAP counts. They are equal except when the record has NO `usd` at all (absent or null) on a seat that can cost money: that is a lost figure, not a free stage, so the cap counts one attempt's worst case
  // (`assumed: true`) while the recorded figure stays 0. $0 stays for a seat that projects $0 (a free, external or unpriced seat). A MALFORMED figure (not a number >= 0) is charged one attempt on both, as before.
  // DUALCAP unit 4a: the cap this seat's calls count in (null with the switch OFF, or for a seat that bills through no account) and its bucket (null when none is armed for it).
  const capName = capBuckets ? billingAccountOf(seat) : null;
  const bucket = bucketOf(capName);
  // The cap a REPLAYED figure counts in: the one its own record names (usage files carry it with the caps armed) when that cap is armed; a record naming a cap that is not
  // armed counts in the run total only; a record naming none (written with the switch off, or before the caps were armed) counts in the cap of the seat's account.
  const replayCapOf = h => {
    if (!capBuckets) return null;
    const recorded = recordedCapOf(h);   // the one rule (src/caps.js), shared with the limit screen's per-limit figure
    if (recorded) return bucketOf(recorded) ? recorded : null;
    return bucket ? capName : null;
  };
  const replayFigures = h => {
    if ((h.usd === undefined || h.usd === null) && oneAttempt > 0) {
      log(`  ${label}: the cost recorded on disk for this stage is missing - ${formatUsd(oneAttempt)} (one attempt's worst case) counted toward the cap instead.`);
      return { recorded: 0, charged: oneAttempt, assumed: true };
    }
    const usd = readUsd(h.usd);
    if (usd !== null) return { recorded: usd, charged: usd, assumed: false };
    // A MALFORMED figure (cost-unit U1 split, C&C 14 Oct 2026, closing the class): the same as an absent one. The record holds no usable dollar, so the recorded figure is what src/spend.js reads it as (unknown: nothing added, so 0 here); the cap counts one attempt.
    log(`  ${label}: the cost recorded on disk for this stage is not a valid amount - ${formatUsd(oneAttempt)} (one attempt's worst case) counted toward the cap instead.`);
    return { recorded: 0, charged: oneAttempt, assumed: oneAttempt > 0 };
  };
  const chargeReplay = (f, cap = null) => {
    for (const b of [budget, bucketOf(cap)]) { if (!b) continue; b.spent += f.charged; if (f.assumed) { b.assumed.stages += 1; b.assumed.usd += f.charged; } }
  };
  let hit = cache.get(label);
  // 0.8.1 FX-9: the cached `handoff` stage may be the final HANDOFF.md on a case-insensitive disk (one file); its
  // lock block is the harness's, never the model's text, so it is cut before the text is used.
  const rawHitText = hit?.text;   // 0.8.4 T14: the reply as it is on disk, before the handoff stage's lock block is cut (the record's text hash is over the file)
  if (hit && label === 'handoff' && typeof hit.text === 'string') hit = { ...hit, text: stripAcceptanceLines(liftAnyClamp(stripHandlerNotesBlock(stripBuilderTaskBlock(stripLockBlock(hit.text))))) }; // S18 Q4.3: the handler's notes section is the harness's too (written after the end; stripBuilderTaskBlock's twin)  // 2b-1c: the builder-task block is the harness's too (stripLockBlock's twin)
  let keptEarlier = false, keptOnRoute = false;
  if (hit) {
    // Pre-release cache audit #1: the decision is cacheVerdict() (cache-integrity.js). An entry with
    // no record of its inputs is stale now; one from between the two fixes is trusted but recorded
    // through cache.warn (WARNINGS.md and report.json), and every trusted hit's prompt hash is
    // written back by the CLI (onStage), so the gap closes at the next resume.
    const verdict = cacheVerdict(hit, promptHash);
    // 0.8.4 T14 (owner 05 Nov 2026 03:52, A-DRAFT log line): a stage whose prompt differs ONLY because THC's wording changed since it was saved is kept as it is (src/stale-guard.js decides; changed content stays a cache miss).
    // The kept row carries the hash of the prompt it really answered, so the CLI's write-back never records it as an answer to today's wording.
    if (verdict.status === 'stale' && verdict.cause === 'prompt' && wordingLedger) {
      if (keepsEarlierWording(label, { ...hit, text: rawHitText }, log, { group })) { keptEarlier = true; keptOnRoute = wordingLedger.routeOnly(stampOfHit(hit, rawHitText).writtenBy); }   // the shared helper decides and says it; the text hashed is the file's, before the handoff lock block is cut
    }
    if (verdict.status === 'stale' && !keptEarlier) {
      const old = replayFigures(hit);
      const oldUsd = old.recorded;   // the sentence below says what the old answer COST; a worst case assumed for a missing figure is already named by replayFigures' own log line
      chargeReplay(old, replayCapOf(hit));
      cache.invalidate?.(label, verdict.why);
      // BUG-D-005 / BUG-C-013: the collected NOTE lines of a folded handoff (`handoff-notes`) are derived from THIS stage's reply, so they go stale with it (set aside, never read back for the new reply). Only when that file exists: no noise line for a lane-off chain.
      if (label === 'handoff' && typeof cache.get?.('handoff-notes')?.text === 'string') cache.invalidate?.('handoff-notes', verdict.why);
      // A-DRAFT (WORDING LAD-R27): "re-running it" is true only where the call goes out. In a sitting that ends the run at the spending limit it does not (the loop's stop, or the seam below, refuses it): the line says the old answer was set aside and is not asked again.
      const heldBackBySecret = outboundScan.endsOnSecret && (() => { try { scanned(label, { system, user }); return false; } catch (e) { if (e instanceof SecretShapedPrompt) return true; throw e; } })();   // a finish-now at a pause after the rounds: a call whose prompt holds the found value is not made either
      const callGoesOut = !((spendFinish && scanPhase === 'loop') || (noMoneySitting && (judge === true || needsPrice(seat) || projected > 0)) || heldBackBySecret);
      log(`  CACHE STALENESS WARNING: stage "${label}" - ${verdict.why}; ${!callGoesOut ? `the old answer was set aside, and it is not asked again because the person ended the run ${outboundScan.endsOnSecret ? 'at once at the pause' : 'at the spending limit'}` : seat.provider === 'external' ? 'the old answer was set aside and the operator is asked again' : 're-running it'}${oldUsd ? ` (the ${formatUsd(oldUsd)} the old answer cost still counts toward the cap)` : ''}.`);
      hit = null;
    } else if (verdict.status === 'unverified') {
      cache.warn?.(label, verdict.why);
      log(`  CACHE: stage "${label}" replayed UNVERIFIED - ${verdict.why}. Recorded in WARNINGS.md and report.json.`);
    }
  }
  // 0.8.4 T14: the ledger learns of EVERY stage this call passes, so no path hides an upstream from its dependents: a replay (fresh, unverified or kept) with the record it was written under, a stale stage set aside, a missing one (all live: the call below
  // goes out, or an external seat is asked). A direct cache read outside invoke() (the answers stage and the build-check answer, chain.js) is not in the ledger: named as outside the rule.
  if (wordingLedger) {
    if (hit) { const st = stampOfHit(hit, rawHitText); wordingLedger.note({ label, group, writtenBy: st.writtenBy, textOk: st.textOk, live: false }); }
    else wordingLedger.note({ label, group, live: true });
  }
  if (hit) {
    const figures = replayFigures(hit);
    const usd = figures.recorded;
    const usage = hit.usage ? readUsage(hit.usage).usage : { input: 0, output: 0 };
    const replayCap = replayCapOf(hit);
    chargeReplay(figures, replayCap);
    log(`  ${label}: ${hit.provider || seat.provider}/${hit.model || seat.model} - from disk (${usage.input} in, ${usage.output} out, ${formatUsd(usd)} already spent)`);
    // 0.8.1 R: what the original attempt decided survives the replay (the cache file is data: only a positive number and the one known mark are taken).
    const replayed = { ...(Number.isFinite(hit.cappedAt) && hit.cappedAt >= (seat.maxTokens ?? DEFAULT_MAX_TOKENS) ? { cappedAt: hit.cappedAt } : {}), ...(hit.noAnswer === NO_ANSWER_THINKING ? { noAnswer: NO_ANSWER_THINKING } : {}) };
    // 0.8.3 M2 (D18): the id of the reservation that paid for this stage, read back from its usage file, so a finished run's report names the sitting that paid (null/absent for a stage that wrote none).
    const paidBy = typeof hit.reservationId === 'string' && hit.reservationId ? { reservationId: hit.reservationId } : {};
    // 0.8.4 unit 1 (D12 part 1): the billed figure and the generation id the original attempt recorded survive the replay (the cache file is data: only a plain number and a plain token are taken).
    const billedBy = { ...billedFieldsOf(hit), ...discardedFieldOf(hit) };
    return { label, provider: hit.provider || seat.provider, model: hit.model || seat.model, lab: labOf(seat), ...seatField(seat), ...answerRecordOf(hit, seat), usage, usd, priced: true, ms: 0, text: hit.text, cached: true, promptHash: keptEarlier ? hit.promptHash : promptHash, ...(keptEarlier && !keptOnRoute ? { answeredUnderEarlierWording: true } : {}), ...(keptOnRoute ? { answeredOnAnotherRoute: true } : {}), ...(stampOfHit(hit, rawHitText).writtenBy ? { writtenBy: stampOfHit(hit, rawHitText).writtenBy } : {}), ...replayed, ...paidBy, ...billedBy, ...(replayCap ? { capName: replayCap } : {}) };
  }
  // the person's recorded --finish: THIS is the paused stage (every earlier stage replayed above); it is neither scanned nor sent
  if (outboundScan.finish && scanPhase === 'loop') throw new SecretFinish(label, outboundScan.atOnce === true, outboundScan.relayed === true);
  if (spendFinish && scanPhase === 'loop') {
    if (spendFinish.atOnce && noMoneySitting && (needsPrice(seat) || projected > 0)) callsNotRun.push({ label, seat: `${seat.provider}/${seat.model}` });   // 0.8.4: the call the loop stopped at would have billed: it is a call not made too
    throw new SpendFinish(label, spendFinish.capName, spendFinish.atOnce, spendFinish.relayed);   // 0.8.4 S16 (F)
  }
  // 0.8.4 (finish at once at a spending stop): THE seam of the no-money sitting. Here, after the cache was read and before anything is reserved or sent, a call that bills (a priced seat, or a seat the price table does not know: it bills too) is recorded as not made and
  // stopped; a seat that bills nothing (mock, ollama, an external or session seat) goes on. Every site that reaches a model passes this line (invoke() is the only paid door), the default security reviewer included.
  if (noMoneySitting && (judge === true || needsPrice(seat) || projected > 0)) {   // `judge`: a call to a judge of the panel (the final read): no judge is asked again, whatever the seat bills - a read that is not on disk is not asked for, and an external seat is not paused for
    const why = outboundScan.endsOnSecret ? 'finished_at_once' : 'spending_limit';   // a finish-now at a pause AFTER the rounds uses this same seam, and its reason is the finish, not the spending limit
    callsNotRun.push({ label, seat: `${seat.provider}/${seat.model}`, reason: why });
    log?.(why === 'finished_at_once' ? `  ${label}: not run - the person ended the run at once at the pause, so a call that bills, or a judge's read that is not on disk, is not made.` : `  ${label}: not run - the person ended the run at the spending limit, so a call that bills, or a judge's read that is not on disk, is not made.`);   // A-DRAFT (LAD-R41 for the first)
    throw new NotRunForLimit(label, why);
  }
  if (outboundScan.endsOnSecret) {   // 0.8.4 (parity batch, C&C 10 Nov: at any pause after the rounds the person can end the run there, no further paid call and no secret sent): a call whose prompt still holds a credential-shaped value the person has not allowed is NOT MADE (it is not a pause again), and the run goes on to its ending
    try { scanned(label, { system, user }); }
    catch (err) { if (!(err instanceof SecretShapedPrompt)) throw err; callsNotRun.push({ label, seat: `${seat.provider}/${seat.model}`, reason: 'finished_at_once' }); log?.(`  ${label}: not run - its prompt holds a credential-shaped string, and the person ended the run at once at the pause, so it is not sent.`); throw new NotRunForLimit(label, 'finished_at_once'); }   // A-DRAFT (LAD-R41)
  }
  if (judgeReplayOnly && judge === true) {   // 0.8.4 (step 3): a finish-now at a pause asks no judge again; a read on disk was replayed above, one that is not is not made (its seat reads not run, reason finished_at_once)
    callsNotRun.push({ label, seat: `${seat.provider}/${seat.model}`, reason: 'finished_at_once' });
    log?.(`  ${label}: not run - the person ended the run at once, so a judge's read that is not on disk is not made.`);
    throw new NotRunForLimit(label, 'finished_at_once');
  }
  const scanResult = scanned(label, { system, user });   // 'clean' | 'consented' | 'waived': the usage record says which
  if (seat.provider === 'external') throw new ExternalPause(label, system, user, seat.model);
  // 2 Nov 2026 (near-JSON pause, src/near-json.js): this stage's paid reply was almost JSON and is set aside, waiting for its repair. A resume that comes before the repair pauses again; it never calls the model a second time.
  const awaitingRepair = cache.awaitingRepair?.(label, promptHash);
  // 3 Nov 2026 (no trace, no lost money): the paid reply's usage record stays at its label while the repair is pending, and a resume's cap seed reads only superseded/ and unsettled reservations, so the payment is counted
  // here, once per sitting, the way a replay counts it (the same figures: a missing or malformed amount is charged at one attempt's worst case), before the run pauses again. A record that is gone or unreadable (`paid`
  // null) is charged the same way, at one attempt's worst case: the call was paid for, so the figure errs high (C&C's FIX on unit 2), as the orphan rule does.
  // A pause whose prompt changed is released (`released`: its paid reply is now a stale answer in superseded/, moved after this sitting's cap seed ran); its payment is counted here too, once, and the stage runs live.
  if (awaitingRepair) chargeReplay(replayFigures(awaitingRepair.paid ?? {}), replayCapOf(awaitingRepair.paid ?? {}));
  if (awaitingRepair && !awaitingRepair.released) throw new ExternalPause(label, system, user, seat.model, { original: awaitingRepair.original, refusal: awaitingRepair.refusal, ...(typeof shownSystem === 'string' ? { shownSystem } : {}), ...(awaitingRepair.kind && awaitingRepair.kind !== 'near_json' ? { kind: awaitingRepair.kind, criteria: awaitingRepair.criteria, rows: awaitingRepair.rows, ...(awaitingRepair.kind === 'id_slip' ? { slips: awaitingRepair.slips, shown: awaitingRepair.shown } : {}) } : {}) });
  // DUALCAP unit 4a: with the caps armed, a seat whose account has none armed is refused here, before anything is reserved or sent (see UncoveredSeat). Log line A-DRAFT.
  if (capName && !bucket) {
    log(`  ${label}: REFUSED - ${seat.provider}/${seat.model} is billed through ${capName}, and no spend cap is armed for ${capName}.`);
    throw new UncoveredSeat({ label, seat: `${seat.provider}/${seat.model}`, capName, caps: Object.keys(capBuckets) });
  }
  // 0.8.2 item 8a: under a cap, a seat with no price is refused here, before the only line that spends (see UnpricedSeat). DUALCAP: with the caps armed the run cap is null, so
  // the seat's own cap holds this backstop (without it the backstop would go dark under the switch); the line names that cap (A-DRAFT).
  if ((budget.cap !== null || bucket) && needsPrice(seat)) {
    const capUsd = bucket ? bucket.cap : budget.cap;
    log(`  ${label}: REFUSED - ${seat.provider}/${seat.model} has no price, so the ${bucket ? `${capName} cap` : 'spend cap'} of ${formatUsd(capUsd)} cannot hold it.`);
    throw new UnpricedSeat({ label, seat: `${seat.provider}/${seat.model}`, cap: capUsd, ...(bucket ? { capName } : {}) });
  }

  // A3a (18 Okt 2026): an OpenRouter call carries a price pin at the seat's table price (src/price-pin.js); built here, at the call boundary only: the seat, its `extra` and every record stay as they were. The retry sends the same `sentExtra`.
  // Built BEFORE the cap check and the reservation: a seat whose provider/max_price is not an object throws PinRefused (controlFlow) here, so nothing is reserved and nothing is sent (the UnpricedSeat pattern; chain-lint says it first).
  // 0.8.1 milestone R (owner: "I want reasoning to always be 'High' for the 'High' Council"; "NO LOWER EFFORT"): the reasoning setting a
  // request carries is the seat's own, plus "high" where it is unset (src/reasoning.js; a seat the table has no field for gets nothing).
  // The retry below sends the SAME `sentExtra`: no path in this file lowers a seat's effort (test/reasoning-never-lower.test.js scans for it).
  const firstCap = seat.maxTokens ?? DEFAULT_MAX_TOKENS;
  const sentExtra = pinnedExtra(seat, extraWithHighDefault(seat, firstCap), { promptTokens, ...(zeroRetention && seat?.provider === 'openrouter' ? { zeroRetention: zdrAllowedHosts(seat.model, { own: seat.extra?.provider?.only, ...(zeroRetentionTable ? { table: zeroRetentionTable } : {}) }) } : {}) });

  // The cap is checked here, before the only line in this file that spends money.
  // 27 Okt 2026, the owner's ruling on this gate: "going by the expected-maximum is absolutely stupid. Stop this", and "the rule was decided to be bad, and we wanted it to be
  // changed to the expected-case not worst-case". (A live run: at layer 3 two seats were asked at once with worst cases of $1.44 and $2.62, so the gate refused them once the
  // run had spent ~$2.94 of a $7 limit; they billed $0.08 and $0.26.) So the gate decides on the call's EXPECTED cost - the real prompt and the dry run's expected output size
  // for this kind of call, one attempt (src/cost.js expectedCallUsd) - added to what is spent and to the EXPECTED cost of the calls in flight (`reservedExpected`). A call the
  // dry run does not plan (a merge, the decider...), or any call outside runChain, has no expected size and is gated at its worst case, `projected`, as before. A re-ask or a `-retry` of a planned call is gated at the expected cost of that call (unit 4).
  // `projected` (the worst case: an Anthropic seat at two attempts, because the thinking retry below may pay twice) is still what is reserved on disk, what a crash or a
  // billed-but-unreadable reply is charged, and what the STOPPED record names.
  const expected = callEstimate === null ? null : expectedCallUsd(seat, { system, user, label, estimate: callEstimate, cache: cacheInfo });
  // 0.8.4 unit 4 (his pick OWNER 6: "Re-asks and retries are checked at the expected size of the call they repeat"; a re-ask can overrun the cap): a re-ask (`-reask<n>`) or a `-retry` is gated at the
  // expected cost of the call it repeats, on its own prompt. `expected` itself stays null for them (it also decides the charge wording and the 5xx seam's facts). A repeat of a call with no expected size anywhere keeps its worst case, and so does an `-answered` or a `-question` call (an answer-back is not a re-ask; the upper estimate does not price it).
  const repeatExpected = expected !== null || callEstimate === null ? null : repeatExpectedCallUsd(seat, { system, user, label, estimate: callEstimate, cache: cacheInfo });
  const gateUsd = expected ?? repeatExpected ?? projected;
  // DUALCAP unit 4a: `g` = the bucket of the seat's cap when the caps are armed, else the run totals (OFF: exactly as before; a seat with no account under the caps: the run
  // totals, whose cap is null, so nothing to breach). The stop names the cap (A-DRAFT) and carries that cap's limit and spend.
  const g = bucket ?? budget;
  const ceilingWords = bucket ? `the ${capName} cap's ceiling is` : 'ceiling is';
  const capField = bucket ? { capName } : {};
  // The deep dive checks each call against its own dollar cap before it is sent, and digest / handoff-from-run / contract-draft are not runs (his decision resumes a run) and
  // each is checked against the policy's max_usd_per_run before its one call (src/policy.js), so an extra send here would pass that check: their calls are not asked again (C&C, 04 Nov 2026). Earlier settlements are read once, before the first attempt.
  const mayResume = !label.startsWith('deep-dive-') && !NO_RESUME_LABELS.has(label);
  const priorBilledUnreadable = mayResume ? (reservationSink?.settledCount?.(label, 'billed_unreadable') ?? 0) : 0;
  const sendsOnce5xx = NO_RESUME_LABELS.has(label) || label.startsWith('deep-dive-');   // a 5xx is counted (his pick) but not sent again: see HTTP5XX_RESENDS_PER_ASK
  let lostCharged = 0;   // what this call's failed attempts were counted at (a 5xx re-send, a discarded attempt whose retry then failed): in the run's spend and in charge files, NOT in the returned stage's `usd`
  // The attempt loop (the gate through the finally below). The body is NOT re-indented, so that the other builders' hunks in this function still apply; `netAttempt` is 0 for the first attempt and counts the resumes.
  const resent5xx = { first: 0, retry: 0 };   // 5xx re-sends used so far, per ask (the first ask, the thinking-retry ask)
  let waitBefore = null;                       // set by the catch below: the wait before the next attempt (a resume's or a 5xx re-send's)
  for (let netAttempt = 0; ; netAttempt++) {
  if (waitBefore) { const w = waitBefore; waitBefore = null; await w(); }
  attemptWorstCase = attempts.first; onRetry = false;
  const verdict = wouldBreach({ spent: g.spent + g.reservedExpected, cap: g.cap, projected: gateUsd });
  if (verdict.breach) {
    const inFlight = g.reserved > 0 ? ` (plus up to ${formatUsd(g.reserved)} reserved by calls still in flight)` : '';
    log(`  ${label}: STOPPED - ${formatUsd(recordedSpentOf(g))} counted${inFlight}, this stage could cost up to ${formatUsd(projected)}, ${ceilingWords} ${formatUsd(g.cap)}.`);
    throw new BudgetExceeded({ label, seat: `${seat.provider}/${seat.model}`, spent: g.spent, cap: g.cap, projected, gate: gateUsd, phase: scanPhase, ...capField });
  }
  // Reserved synchronously - no await between the check above and this line - and released in the
  // finally below whether the call succeeds or throws. See `reserved` at the top of the budget block.
  budget.reserved += projected;
  budget.reservedExpected += gateUsd;
  if (bucket) { bucket.reserved += projected; bucket.reservedExpected += gateUsd; }
  let unrecordedWaste = 0; // a discarded attempt's cost, until a stage that includes it is returned
  let wasteBilled = {};    // D12 part 1: the discarded attempt's own billed figure and generation id, for its waste charge record
  let retryRefused = false; // the thinking retry was refused by the cap: the waste charge below says so instead of "its retry then failed"
  let reservationId = null, settled = { outcome: 'failed', usd: 0 };
  try {
    // 0.8.2 item 8b: the reservation is on disk BEFORE the request is sent, so a process killed in flight leaves it (charged at its worst case on resume and in --spend). A call projected at $0 writes none. If the
    // line cannot be written the call is not sent: the finally below releases the in-memory reservation.
    if (reservationSink && projected > 0) {
      try { reservationId = reservationSink.reserve({ label, seat: `${seat.provider}/${seat.model}`, usd: projected, ...capField }); } catch (e) {
        // controlFlow: no catch around a call stage may turn "the reservation could not be written" into an abstention and carry on; the run stops, nothing was sent.
        const err = new Error(`${label}: the spend reservation could not be written (${e?.code ?? e?.message}), so the call was not sent`);
        err.controlFlow = true;
        throw err;
      }
    }

    progressHook({ label, lab: labOf(seat), ...seatField(seat), startedAt: new Date().toISOString() });

    const ask = (extra, maxTokens = firstCap) => call(seat.provider, {
      model: seat.model,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens,
      temperature: seat.temperature,
      extra,
      // v7.1: a seat's own override of its provider's default base URL - e.g. LM Studio on
      // :1234 instead of Ollama's :11434, or a remote Ollama box. Ignored by every adapter except
      // callOpenAICompat, which is the only one that reads it.
      baseUrl: seat.baseUrl,
      ...(cacheOn ? { cache: { head: cacheHead, ttl: cacheTtl } } : {}),   // prompt caching (src/prompt-cache.js): the adapter splits the user text at the head and marks the first block
    });
    // Usage the cap cannot read (a NaN, a negative or non-numeric count, no usage at all) is
    // zeroed in the record and charged at one attempt's projection (cost.js readUsage).
    const readRes = r => { const { usage, unreadable } = readUsage(r.usage); return { ...r, usage, unreadable }; };
    // Bug audit 2026-09-27 H1: the provider names the model that actually answered (an OpenRouter
    // extra.models fallback, a dated alias), and an unpriced answering model cost $0, so the cap went
    // blind for that call. It is charged at the seat's own model's price instead, and says so.
    const priceAnswer = r => {
      const pin = ownPinOf(seat);   // CR-1F-001: the call carried the seat's own pin, so it is recorded at max(row, pin) per field, as the projection priced it
      const own = costOf(r.provider, r.model, r.usage, pin);
      if (own.priced || r.model === seat.model) return own;
      const asSeat = costOf(r.provider, seat.model, r.usage, pin);
      if (asSeat.priced) log(`  ${label}: answered by ${r.provider}/${r.model}, which has no price entry - charged at ${seat.model}'s price.`);
      return asSeat.priced ? asSeat : own;
    };
    const costOfRes = r => {
      const measured = priceAnswer(r);
      // A marked call whose response carried no cache counts: costOf charged the whole input as a write (the cap errs high); the record says so, never "0 cached".
      if (measured.cacheUnknown && !r.unreadable) {
        // Anthropic's input_tokens EXCLUDES the cached part, so with the counts missing the reported input may be only the tail. The whole prompt, system text included, is charged as a write of the asked lifetime
        // (the call's worst-case input at the write price, the reply at what it reported): never less than costOf's figure, and never a figure that lets an unreported cached head go uncounted.
        const promptChars = promptCharsOf({ system, user });
        // 3b: with no marker asked (r.usage.cacheAsked absent) the call is a selected OpenRouter seat (cost.js isAutoCacheWriteModel): the cache argument is left out and worstCaseOf prices the whole prompt as a write by the call's mode.
        const whole = worstCaseOf(seat.provider, seat.model, { promptChars, maxTokens: r.usage.output, pin: ownPinOf(seat), cache: r.usage.cacheAsked ? { headTokens: promptTokensOfChars(promptChars), ttl: r.usage.cacheAsked } : null }).usd;
        if (r.usage.cacheCounts !== 'unknown' && !r.usage.cacheAsked) { r.usage = { ...r.usage, cacheCounts: 'unknown' }; log(`  ${label}: the response carried no cache counts, and this model may be billed a cache write even when none is asked, so the call is charged as a cache write of its whole prompt (the cap errs high).`); }
        else if (r.usage.cacheCounts !== 'unknown') { r.usage = { ...r.usage, cacheCounts: 'unknown' }; log(`  ${label}: the response carried no cache counts, so the call is charged as a full ${r.usage.cacheAsked} cache write of its whole prompt (the cap errs high).`); }
        return { ...measured, usd: Math.max(measured.usd, whole) };
      }
      // 3b per field: a selected seat's reply carried a read count and no write count; the uncached part was charged as a write (cost.js costOf, cacheWriteUnreported). The record says so: the read count stays as reported.
      if (measured.cacheWriteUnreported && !r.unreadable && r.usage.cacheCounts === undefined) r.usage = { ...r.usage, cacheCounts: 'write-not-reported' };
      // 0.8.4 commit 5: the reply carried a write count (a zero included) on a selected seat that sent no marker, and costOf charged every uncached prompt token as a write whatever the count: the record says the count did not set the price.
      if (measured.cacheWriteInInput && !r.unreadable && r.usage.cacheCounts === undefined) r.usage = { ...r.usage, cacheCounts: 'write-in-input' };
      if (!r.unreadable) return measured;
      if (attemptWorstCase > 0) log(`  ${label}: ${r.provider}/${r.model} reported usage the spend cap cannot read (${r.unreadable}) - ${formatUsd(attemptWorstCase)} (one attempt's worst case) counted toward the cap.`);
      return { usd: attemptWorstCase, priced: measured.priced };
    };
    let finalCap = firstCap; // the cap the answer in hand was asked at: the retry's when this function retried (outer cut-off retries start from it)
    let res = readRes(await ask(sentExtra));
    let wasted = 0;
    // Claude's adaptive thinking counts against max_tokens and is not text. On
    // a hard prompt it can spend the whole budget before writing a word - the
    // netcode review on 2026-09-07 did exactly that three stages in a row, and
    // the panel reviewed an empty page twice. The same budget can also cut a
    // reply off mid-sentence (the v2 criteria stage, same day: 1534 thinking
    // tokens, JSON truncated), which is just as unusable. Either way: retry
    // once. Until 0.8.0 the retry switched thinking OFF; since 0.8.1 (owner: "NO LOWER EFFORT!!!!") it keeps the SAME effort and gives the
    // call a bigger cap (retryCapFor, bounded by the model's own maximum and its transport), and a reply that is still no text is recorded
    // as "no answer: thinking used the whole cap" (an unreadable non-pass, never a silent pass, never a downgrade).
    //
    // Bug-audit fix, 2026-09-16: also accepts `'length'`, not only the literal `'max_tokens'` -
    // an Anthropic seat routed through single-vendor mode answers via callOpenAICompat(), not
    // callAnthropic(), and OpenAI-compatible APIs (including OpenRouter) report a token-limit stop
    // as `finish_reason: "length"`, never the literal string `"max_tokens"` that is Anthropic's own
    // native API vocabulary. The `cut`/"[hit the cap]" log indicator a few lines below already
    // checked both spellings; this retry trigger only checked one, so it silently never fired for
    // any single-vendor-routed Anthropic seat even after the `anthropicSeat` fix above.
    if (anthropicSeat && res.usage.thinking > 0 && (res.usage.stop === 'max_tokens' || res.usage.stop === 'length')) {
      const retryCap = retryCapFor(firstCap, retryCeilingOf(seat));
      const how = res.text.trim() ? `text cut off - ${res.usage.thinking} of ${res.usage.output} tokens went to thinking` : `empty text - all ${res.usage.output} tokens went to thinking`;
      if (retryCap > firstCap) {
        wasted = costOfRes(res).usd;
        wasteBilled = billedFieldsOf(res);   // D12: the discarded attempt's own billed figure
        // Counted now, not with the final stage: if the retry below throws, this attempt was still
        // billed (bug-audit fix, 2026-09-23, BugAudit_MoneyPath #4a - it used to vanish from `spent`).
        budget.spent += wasted;
        if (bucket) bucket.spent += wasted;
        unrecordedWaste = wasted;
        // 28 Okt 2026 (C&C, after the expected-cost gate): the retry is a SECOND paid call and nothing gated it. Under the old gate it was pre-paid (`projected` held both attempts); under the expected gate the check at
        // the top of this function saw one attempt, so the retry went out past the cap. It is an unplanned call (the dry run does not list it), so it is gated like every other one: at its WORST case (attempts.retry),
        // through the one enforcement function. `spent` now holds the wasted first attempt, and this call's own expected cost (`gateUsd`) is still in `reservedExpected` until the finally below, so it is taken out
        // of the sum (the first attempt would count twice: as `wasted` and as its expected size). For an unplanned call `gateUsd` is `projected`, both attempts, so the subtraction leaves `wasted` where the first
        // attempt's worst case stood and a retry that was paid for up front is not refused: no special case. A breach throws before anything is sent; the wasted attempt stays counted (`budget.spent`) and is
        // written as a waste charge by the catch below. No second reservation: the one on disk already carries both attempts. The price basis was the owner's later pick (S5-14): since 0.8.4 unit 4 (his OWNER 6) a call that has an expected size is checked for its retry at that expected cost, below.
        // 0.8.4 unit 4 (his pick OWNER 6: re-asks and cut-off retries are checked "at the expected size of the call they repeat"): a call that HAS an expected size is gated for its retry at that expected cost (the retry repeats the
        // call); a call with none keeps the retry's worst case, as above. The reservation on disk still carries both attempts at their worst case.
        const retryExpected = expected ?? repeatExpected;
        const retryGateUsd = retryExpected ?? attempts.retry;
        const retryVerdict = wouldBreach({ spent: g.spent + g.reservedExpected - gateUsd, cap: g.cap, projected: retryGateUsd });
        if (retryVerdict.breach) {
          retryRefused = true;
          log(`  ${label}: ${how} (stop: max_tokens, ${formatUsd(wasted)} spent); the retry at a bigger token cap (${firstCap} -> ${retryCap} tokens) ${retryExpected !== null ? 'is expected to cost' : 'could cost up to'} ${formatUsd(retryGateUsd)} and ${bucket ? `the ${capName} spend cap's ceiling` : 'the spend ceiling'} is ${formatUsd(g.cap)}: STOPPED, the retry was not sent.`);
          // the stage leaves no file, so the resume re-runs BOTH attempts. The figure it must clear: for a call without an expected size the whole worst case (`projected`); for a call with one, what the resume's retry check will ask for again,
          // the wasted first attempt (already in `spent`, and spent again by the resume's own first attempt) plus the retry's expected cost - never above `projected`.
          const clear = retryExpected !== null ? Math.min(projected, wasted + retryGateUsd) : projected;
          throw new BudgetExceeded({ label, seat: `${seat.provider}/${seat.model}`, spent: g.spent, cap: g.cap, projected, gate: clear, retryRefused: true, phase: scanPhase, ...capField });
        }
        log(`  ${label}: ${how} (stop: max_tokens, ${formatUsd(wasted)} spent); retrying once at the same effort with a bigger cap (${firstCap} -> ${retryCap} tokens).`);
        attemptWorstCase = attempts.retry; onRetry = true;
        finalCap = retryCap;
        res = readRes(await ask(sentExtra, retryCap));
      } else {
        log(`  ${label}: ${how} (stop: max_tokens); no retry: ${firstCap} tokens is already the most this model/transport can return.`);
      }
    }
    const cost = costOfRes(res);
    const stage = {
      label,
      provider: res.provider,
      model: res.model,
      lab: labOf(seat),
      ...seatField(seat),
      usage: res.usage,
      usd: cost.usd + wasted,
      // 0.8.4 unit 6 (D11): what the amount stands for (src/counted-bases.js): THC's own token count, or one attempt's worst case when the reply's usage could not be read. Absent on a $0 stage.
      ...(cost.usd + wasted > 0 ? { basis: res.unreadable ? 'worst_case' : 'token_priced' } : {}),
      priced: cost.priced,
      ms: Date.now() - started,
      text: res.text,
      promptHash,
      // Brief 29 (25 section 6.2): what the audit line needs to show which text went where, without a second
      // copy of the text: the exact prompt's full sha256 and size, the endpoint the provider says served the
      // call (OpenRouter names it; null when the reply does not), and that the outbound key scan was on.
      promptSha256: promptSha256Of(system, user),
      promptBytes: Buffer.byteLength(system ?? '') + Buffer.byteLength(user ?? ''),
      endpoint: typeof res.endpoint === 'string' ? res.endpoint : null,
      scan: scanResult,
      // 0.8.1 milestone R: a reply cut off at its cap whose tokens were all thinking and which carries no text. The seat has NO answer; callers
      // record it as an unreadable non-pass (a panel seat is "unheard"). Additive: nothing reads this as consent.
      ...(isNoAnswerReply(res) ? { noAnswer: NO_ANSWER_THINKING } : {}),
      // 0.8.1 R review: the cap this answer was asked at. An Anthropic seat was already retried at the bigger cap here, so a caller's cut-off retry
      // starts from THIS cap and is skipped when it has no room (it used to repeat the same paid call).
      cappedAt: finalCap,
      // 0.8.3 M2 (D18): the reservation that paid for this call, so the usage file, report.json and the tree's accounting can tell it from another call with the same label. Absent when none was written (a mock call).
      ...(reservationId ? { reservationId } : {}),
      // 0.8.4 unit 1 (D12 part 1): what OpenRouter says it billed for this call and the generation id, recorded BESIDE THC's own count (`usd` above). Absent when the reply carried none; never $0. Counts for nothing yet.
      ...billedFieldsOf(res),
      // 0.8.4 unit 2: a thinking retry that answered folded the discarded attempt into `usd`; the split is kept so a comparison can be made attempt by attempt. Present only when an attempt was discarded.
      ...(wasted > 0 ? { discardedAttempt: { usd: wasted, ...wasteBilled } } : {}),
      // 0.8.4 (R181): what this call's FAILED attempts were counted at, for a caller that keeps its own dollar ceiling (the advice add-on). Already in the run's spend and in the charge files; NOT in `usd` above, and not written to the usage file or the report. Present only when there is one.
      ...(lostCharged > 0 ? { lostChargesUsd: lostCharged } : {}),
      // DUALCAP unit 4a: the cap this call counted in (the CLI writes it to the usage file, so a resume gives the figure back to its cap from the record). Absent with the switch off.
      ...capField,
    };
    budget.spent += cost.usd;
    if (bucket) bucket.spent += cost.usd; // `wasted` was already added when the first attempt was discarded
    unrecordedWaste = 0; // stage.usd carries it now
    const think = res.usage.thinking ? ` (${res.usage.thinking} thinking)` : '';
    const cut = res.usage.stop === 'max_tokens' || res.usage.stop === 'length' ? ' [hit the cap]' : '';
    log(`  ${label}: ${res.provider}/${res.model} - ${res.usage.input} in, ${res.usage.output} out${think}${cut}, ${formatUsd(stage.usd)}, ${(stage.ms / 1000).toFixed(1)}s`);
    settled = { outcome: 'recorded', usd: stage.usd, ...(stage.basis ? { basis: stage.basis } : {}) };
    return stage;
  } catch (err) {
    settled = { outcome: err?.maybeBilled ? 'billed_unreadable' : 'failed', usd: err?.maybeBilled ? attemptWorstCase : 0, ...(err?.maybeBilled && attemptWorstCase > 0 ? { basis: 'worst_case' } : {}) };
    // S5-03 (owner's pick, 28 Okt 2026): the provider answered with an ERROR REPLY (HTTP 200, `error`, no choices; providers.js `errorBody`, not marked maybeBilled): it is charged at the usage figure the body carries, else at a typical
    // cost for the call. 0.8.4 unit 3 (D43; his decision 2: "one that carries none is charged at a typical cost for that call"): ONE figure for every call - the expected cost of the call's base label, so a re-ask or the
    // thinking retry is charged like the call it repeats, and for a call the dry run does not plan (a merge, a full revise, the decider...) a typical size for what it writes (src/cost.js typicalCallUsd), never above the
    // attempt's own worst case. The gate keeps its figure. A reply that reports zero usage billed nothing: no charge. Every other throw marked maybeBilled stays at the worst case (BUG-C-032).
    const typicalUsd = () => typicalCallUsd(seat, { system, user, label, estimate: callEstimate ?? {}, cache: cacheInfo, ceilingUsd: attemptWorstCase });
    const plannedCall = !onRetry && expected !== null;   // a first attempt of a call the dry run plans: the typical figure IS its expected cost, and its charge reasons keep their earlier words
    let billed = err?.maybeBilled === true; let charge = attemptWorstCase;
    let chargeBasis = 'worst_case';   // 0.8.4 unit 6 (D11): what `charge` stands for (src/counted-bases.js); written on the charge file and the settled line
    let chargeReason = 'failed after it was sent and may have been billed (one attempt\'s worst case)';
    let chargeLog = `the call failed after it was sent and may have been billed - ${formatUsd(attemptWorstCase)} (one attempt's worst case) counted toward the cap.`;
    if (err?.errorBody) {
      const r = err.errorBody.usage ? readUsage(err.errorBody.usage) : null;
      if (r && !r.unreadable) {
        charge = costOf(seat.provider, seat.model, r.usage, ownPinOf(seat)).usd;
        chargeBasis = 'provider_usage';
        chargeReason = 'the provider answered with an error reply that carries a usage figure; charged at that figure';
        chargeLog = `the provider answered with an error reply; its own usage figure is ${formatUsd(charge)}, counted toward the cap.`;
      } else {
        const typicalOfReply = typicalUsd();
        charge = typicalOfReply ?? attemptWorstCase;
        chargeBasis = typicalOfReply === null ? 'worst_case' : 'typical_error';
        chargeReason = `the provider answered with an error reply and no usage figure; counted toward the cap at a typical cost for this call${plannedCall ? ' (its expected cost)' : ''}`;
        chargeLog = `the provider answered with an error reply and no usage figure - a typical cost for this call, ${formatUsd(charge)}, counted toward the cap.`;
      }
      billed = charge > 0;
      settled = { outcome: billed ? 'billed_unreadable' : 'failed', usd: billed ? charge : 0, ...(billed ? { basis: chargeBasis } : {}) };
    }
    // 0.8.4 network-error resume: asked again after this failure? Decided from the failure and the counters only; whether the next attempt passes the gate changes nothing here.
    // The count is run-wide: this sitting's resumes or the run folder's, whichever is more; taken in the same tick it is read, so parallel calls cannot both take the last one.
    // Order: the failure is of a kind that is asked again and the run's three are used -> the run stops, whatever the label's history says (otherwise a label the guard denies would end as a judge's abstention and a re-ask, which the ruling forbids);
    // the run has resumes left but the label's guard denies -> thrown as before; otherwise -> asked again.
    let resume = false, resumeNo = 0, exhausted = false;
    // A seat that bills: the run's resumes are this sitting's or the run folder's, whichever is more. A seat that does not bill (projects $0: mock, ollama, external) leaves no charge file to count from, so its three are this sitting's
    // only; each of its resumes is still a line in run.log and in network-resumes.jsonl (C&C, 04 Nov 2026: free seats per sitting, recorded).
    if (mayResume && isAutoResumable(err)) {
      const used = projected > 0 ? Math.max(networkResumesTaken, reservationSink?.resumesUsed?.() ?? 0) : networkResumesTaken;
      if (used >= NETWORK_RESUMES_PER_RUN) exhausted = true;
      else if (priorBilledUnreadable < NETWORK_RESUME_GUARD) { networkResumesTaken = used + 1; resumeNo = used + 1; resume = true; }
    }
    // Unit 0b: a 5xx is sent again while the ask it failed on has re-sends left. Taken in the same tick it is read. It settles through httpErrorAttemptSettlement (his pick, 04 Nov 2026: a typical cost; a seat that does not bill stays $0).
    let resend5xx = false, resendNo = 0, reachedMark = false;
    if (isHttp5xx(err) && !err?.errorBody) {
      const kind = onRetry ? 'retry' : 'first';
      const typicalOf5xx = typicalUsd();
      const s5 = (http5xxSettlementOverride ?? httpErrorAttemptSettlement)({ seat, label, status: err.status, expected, typical: typicalOf5xx, attemptWorstCase, onRetry });
      // Both outcomes come from the function's result. `reachedProvider` is derived from the status: the request reached the provider, so a $0 here (a seat that does not bill) is "bill unknown", not "nothing was sent".
      if (s5.usd > 0) { billed = true; charge = s5.usd; chargeBasis = typicalOf5xx === null ? 'worst_case' : 'typical_error'; chargeReason = s5.reason; chargeLog = `the provider answered HTTP ${err.status} after the request was sent - ${plannedCall ? 'its expected cost' : 'a typical cost for this call'}, ${formatUsd(charge)}, counted toward the cap.`; }
      settled = { outcome: s5.usd > 0 ? 'billed_unreadable' : 'failed', usd: s5.usd > 0 ? s5.usd : 0, reachedProvider: true, ...(s5.usd > 0 ? { basis: chargeBasis } : {}) };
      reachedMark = true;
      if (!sendsOnce5xx && resent5xx[kind] < HTTP5XX_RESENDS_PER_ASK) { resent5xx[kind]++; resendNo = resent5xx[kind]; resend5xx = true; }
    }
    // His decision 9 + plan A T6.1 ("Both figures"): in a call that is asked again, a failed attempt that carries no usage figure (a dropped connection has none) is charged at the call's typical cost, not its worst case. This covers the
    // first attempt, when a resume follows it, and the last, when the bound is reached. 0.8.4 unit 3 (D43; Mini-C&C, 04 Nov 2026: plan A reads "a typical cost" and "the expected cost" as ONE figure): the same function as an empty error
    // reply's (src/cost.js typicalCallUsd) - the call's expected cost, or for a call the dry run does not plan (and the thinking retry's own ask) a typical size for what it writes; never above the attempt's worst case.
    const typicalDropped = billed && !err?.errorBody && isAutoResumable(err) && (resume || netAttempt > 0) ? typicalUsd() : null;
    if (typicalDropped !== null && typicalDropped > 0) {
      charge = typicalDropped;
      chargeBasis = 'expected_retry';
      const costWords = plannedCall ? 'its expected cost' : 'a typical cost for this call';   // the earlier words for a planned call (unit 0, unchanged), the new ones where the worst case used to be charged
      chargeReason = resume ? `the connection failed after the request was sent, and the call is asked again; counted at ${costWords}`
        : `the connection failed after the request was sent, and the call is not asked again; counted at ${costWords}, like the attempts before it`;
      chargeLog = `the connection failed after the request was sent - ${costWords}, ${formatUsd(charge)}, counted toward the cap.`;
      settled = { outcome: 'billed_unreadable', usd: charge, basis: chargeBasis };
    }
    // 0.8.3 M2 (D18): both charges below carry the call's reservation id and a kind, because one call can leave BOTH (a discarded first attempt and a billed, unreadable retry); the accounting gate matches a
    // `billed_unreadable` settlement to its one `billed` charge, never to the waste.
    if (unrecordedWaste > 0) chargeHook({ label, provider: seat.provider, model: seat.model, usd: unrecordedWaste, reservationId, ...capField, ...wasteBilled, kind: 'waste', basis: 'token_priced', reason: retryRefused ? 'an attempt discarded because thinking used the whole budget; its retry was not sent because its projected cost would have passed the spend cap' : 'an attempt discarded because thinking used the whole budget; its retry then failed' });
    lostCharged += unrecordedWaste;
    // A call that failed after the request reached the provider (providers.js marks it
    // `maybeBilled`: a dropped 200 body, a non-JSON 200, a post-send timeout) was probably paid
    // for, and its usage is unreadable. Charge one attempt's projection so the cap still sees it
    // (bug-audit fix, 2026-09-23, BugAudit_Providers #1). Conservative by construction - the
    // projection is the worst case.
    if (billed) {
      // `charge` is the worst case of the attempt that failed (the retry's is bigger than the first's since 0.8.1), or the error reply's own figure / typical cost (above)
      budget.spent += charge;
      if (bucket) bucket.spent += charge;
      lostCharged += charge;
      chargeHook({ label, provider: seat.provider, model: seat.model, usd: charge, reservationId, ...capField, kind: 'billed', basis: chargeBasis, reason: chargeReason, ms: Date.now() - started, ...(resume ? { resumed: resumeNo } : {}), ...(reachedMark ? { reachedProvider: true } : {}), ...billedFieldsOf(err?.errorBody), ...failureFactsOf(err) });   // D12 part 1: an error reply's own provider-reported figure and generation id go to the charge record only, NOT to failureFactsOf (the stop record and run_status)   // S5-04 / S6-01: `ms` (the same span as a stage's `ms`: from the start of this invoke(), so a retry's earlier attempt and the waits count) and what the failure said about itself ride on the charge file
      log(`  ${label}: ${chargeLog}`);
    }
    // A3a commit 2 (18 Okt 2026; C&C C2, FAIL CLOSED): a 404 on a call that carried the price pin is OpenRouter refusing it. It stops the run for the person (src/price-refused.js, exit 24) whether or not the body names the
    // max price: a 404 left as a provider error would be an abstention at a judge or debate seat, the silent skip Muad ruled out. Only the one probe's wording earns a recommendation (`recognised`).
    if (seat.provider === 'openrouter' && err?.status === 404 && sentExtra?.provider?.max_price !== undefined && !err.controlFlow) {
      const refused = new PriceRefused({ seat: `${seat.provider}/${seat.model}`, label, pin: sentExtra.provider.max_price, row: effectiveRow(seat.provider, seat.model), status: err.status, said: String(err.message ?? '').split('\n')[0].replace(/^HTTP \d+\s*/, ''), recognised: isMaxPriceRefusal(err.message), lab: labOf(seat), ownPin: !!ownPinOf(seat), ownFields: Object.keys(ownPinOf(seat) ?? {}) });
      log(`  ${label}: REFUSED at the price limit - ${refused.seat} (HTTP 404${refused.recognised ? ', no host at or under that limit' : ', reason not recognised'}); nothing more was sent for this call.`);   // a run stops for the person; an advice call fails as a whole (PR-10, test/advice-refusal-whole-call.test.js)
      throw refused;
    }
    if (resend5xx) {
      log(onRetry
        ? `  ${label}: the provider answered HTTP ${err.status} to the retry ask; starting the call again (re-send ${resendNo} of ${HTTP5XX_RESENDS_PER_ASK} for the retry ask): its first ask is sent again before the retry ask.`
        : `  ${label}: the provider answered HTTP ${err.status} after the request was sent; sending it again (re-send ${resendNo} of ${HTTP5XX_RESENDS_PER_ASK} for the first ask).${projected > 0 ? ' Every re-send is reserved before it is sent.' : ''}`);
      const kindDone = onRetry ? 'retry' : 'first';
      waitBefore = () => resendWait(resent5xx[kindDone] - 1, err);
    } else if (!resume) {
      // The run's automatic resumes are used: this failure stops the run, as a proposer's failure always did. It must not become a judge's abstention and a re-ask under a new label with resumes of its own (C&C, 04 Nov 2026).
      if (exhausted) {
        try { err.controlFlow = true; } catch { /* a frozen error object keeps its own flags: the failure still throws */ }
        log(projected > 0
          ? `  ${label}: the connection failed after the request was sent, and the ${NETWORK_RESUMES_PER_RUN} automatic retries of this run are used: the run stops here. Resume it when the connection is back; a resume you start does not give the retries back.`
          : `  ${label}: the connection failed after the request was sent, and the ${NETWORK_RESUMES_PER_RUN} automatic retries of this sitting are used: the run stops here. Resume it when the connection is back; a resume you start has ${NETWORK_RESUMES_PER_RUN} of its own.`);
      }
      throw err;
    } else {
      log(`  ${label}: the connection failed after the request was sent${failureFactsOf(err).cause ? ` (${failureFactsOf(err).cause})` : ''}; asking again (automatic retry ${resumeNo} of ${NETWORK_RESUMES_PER_RUN} for this ${projected > 0 ? 'run' : 'sitting'}). ${projected > 0 ? 'Every attempt is reserved and counted.' : 'Each resume is recorded in network-resumes.jsonl.'}`);
      waitBefore = () => networkResumeWait(netAttempt);
    }
  } finally {
    budget.reserved -= projected;
    budget.reservedExpected -= gateUsd;
    if (bucket) { bucket.reserved -= projected; bucket.reservedExpected -= gateUsd; }
    if (reservationId) reservationSink.settle(reservationId, settled);
  }
  }
}

// 7.x single-vendor mode: the one composition point that rewrites a config's whole seat roster
// through resolveVendorSeat() - every seat-bearing slot, single or array, checked once here
// rather than at each of runChain()'s many invoke() call sites. A seat's own `transport`
// overrides the chain-level `config.transport`; neither present is a no-op (returns `config`
// unchanged, not even a shallow clone) so a chain that never sets either behaves exactly as it
// does today. Called once, up front, by both cli.js (before checkSeats/--dry-run, so both see
// the resolved vendor routing) and runChain() itself (so a caller that skips cli.js, e.g. the
// MCP path or a direct test, still gets the same resolution without remembering to call it).
// Bug-audit fix, 2026-09-16: both the singular-seat rewrite list below and allSeatsOf() used to
// name only the 8 original slots from when single-vendor mode first shipped, missing 5 real seat
// slots added by later items - challenger (§ bounded challenge stage), coldRead (post-signoff
// cold-reader), claims (claim extraction), ambiguity (an ARRAY, like critics/proposers), and
// descending (an OBJECT keyed by stage name, unlike every other slot). A chain naming a
// vendor-transport override only on one of these 5 slots (or naming `config.transport` while
// relying on one of these 5 for its own seat) had that seat silently skip vendor-rewrite -
// allSeatsOf()'s own "does anything need rewriting" early-exit check missed it just as
// completely as the rewrite loop itself did.
export function resolveChainSeats(config) {
  if (!config.transport && !allSeatsOf(config).some(s => s?.transport) && !(config.preflight?.seats ?? []).some(s => s?.transport)) return config;
  // Bug-audit fix, 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #8): a seat rerouted
  // through a vendor kept its own `region` ("EU") although its data now goes to that vendor, so an
  // EU-only policy and the compliance lint both passed a chain that set `transport`. The claim is
  // dropped - kept as `routedFromRegion` for the record - so allowed_regions fails closed on it.
  const rw = s => {
    if (!s) return s;
    const out = resolveVendorSeat(s, s.transport || config.transport);
    if (out !== s && out.provider !== s.provider && out.region !== undefined) {
      const { region, ...rest } = out;
      return { ...rest, routedFromRegion: region };
    }
    return out;
  };
  const seats = { ...config.seats };
  for (const key of ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'challenger', 'coldRead', 'claims', 'security_reviewer', 'deep_dive', 'decider']) {
    if (seats[key]) seats[key] = rw(seats[key]);
  }
  for (const key of ['critics', 'proposers', 'ambiguity', 'alternatives']) {
    if (Array.isArray(seats[key])) seats[key] = seats[key].map(rw);
  }
  // `descending` is a map of stageName -> seat (src/chain.js's own builderSeat lookup:
  // `config.seats.descending[stageName]`), not a single seat or a plain array - rewrite each
  // value in place rather than treating the object itself as one seat.
  if (seats.descending && typeof seats.descending === 'object') {
    const descending = {};
    for (const [stageName, seat] of Object.entries(seats.descending)) descending[stageName] = rw(seat);
    seats.descending = descending;
  }
  // Security-review fix (Fable 5.1 review of c915eba, MEDIUM 3): `security_reviewer` is the one
  // seat slot with a real, live fallback picked at STAGE-RUN time, not config-load time -
  // security-review.js's own `runSecurityReviewStage` does
  // `config.seats?.security_reviewer || DEFAULT_SECURITY_REVIEWER_SEAT`. Adding the key to the
  // rewrite loop above only helps when a chain names its own security_reviewer seat explicitly;
  // a chain-level `transport` with NO explicit security_reviewer would otherwise still fall
  // through to that raw default (a hardcoded direct-Anthropic seat) at stage-run time, bypassing
  // single-vendor mode for the one stage that runs last. Materialize the resolved default into
  // `seats.security_reviewer` here so the stage's own fallback lookup finds an already-routed
  // seat instead of the raw constant - gated on `security_review.enabled` (the same real
  // condition cost.js's own projection already checks), not merely on a transport being set:
  // DEFAULT_SECURITY_REVIEWER_SEAT's model (claude-fable-5-1) has no VENDOR_MODEL_MAPS route at
  // all, so resolving it unconditionally would throw "no route for..." for every single-vendor
  // chain that simply never enables the security-review stage - a real chain shape this fix must
  // not break.
  if (config.transport && config.security_review?.enabled === true && !seats.security_reviewer) {
    seats.security_reviewer = rw(DEFAULT_SECURITY_REVIEWER_SEAT);
  }
  // 0.8.4 (the Claude route): config.preflight.seats sits OUTSIDE config.seats (everySeatSlotsOf adds it), so the loops above never visited it. A preflight seat carrying a seat-level transport (the route writes one) or a chain-level transport is
  // resolved here with the rest; a preflight seat with neither comes back as it is. (No shipped chain sets a transport or a preflight roster.)
  const preflight = Array.isArray(config.preflight?.seats) ? { ...config.preflight, seats: config.preflight.seats.map(rw) } : config.preflight;
  return { ...config, seats, ...(preflight !== undefined ? { preflight } : {}) };
}

// Every seat slot a chain can fill, with the name of the slot (`role`), in one place. `allSeatsOf`
// and `everySeatOf` below are this list with the names dropped, so a reader that wants the roles
// (the dry run's per-seat key report, src/dry-run.js) cannot drift from the guards that read the
// seats. The order is the one those functions always had.
const SINGLE_SEAT_KEYS = ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'challenger', 'coldRead', 'claims', 'security_reviewer', 'deep_dive', 'decider'];
const LIST_SEAT_KEYS = ['critics', 'proposers', 'ambiguity', 'alternatives'];
export function seatSlotsOf(config) {
  const s = config.seats || {};
  const out = [];
  for (const key of SINGLE_SEAT_KEYS) if (s[key]) out.push({ role: key, seat: s[key] });
  for (const key of LIST_SEAT_KEYS) (s[key] || []).forEach((seat, i) => { if (seat) out.push({ role: `${key}[${i}]`, seat }); });
  for (const [stage, seat] of Object.entries(s.descending || {})) if (seat) out.push({ role: `descending.${stage}`, seat });
  return out;
}

function allSeatsOf(config) {
  return seatSlotsOf(config).map(x => x.seat);
}

// Every seat a run can call, for the guards (policy.json, the missing-key check). Bug-audit fix,
// 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #2): cli.js used a hand-kept list of 7
// slots plus proposers/critics, so policy.json never saw judge, challenger, coldRead, claims,
// ambiguity, descending, preflight or the default security reviewer - a Grok challenger passed an
// EU/Mistral-only policy. This adds the two seats allSeatsOf cannot see (preflight.seats and the
// security reviewer a run falls back to) and is the one list the CLI's guards read.
export function everySeatSlotsOf(config) {
  const slots = seatSlotsOf(config);
  if (Array.isArray(config?.preflight?.seats)) config.preflight.seats.forEach((seat, i) => { if (seat) slots.push({ role: `preflight.seats[${i}]`, seat }); });
  if (config?.security_review?.enabled === true && !config.seats?.security_reviewer) slots.push({ role: 'security_reviewer (default)', seat: DEFAULT_SECURITY_REVIEWER_SEAT });
  return slots;
}
export function everySeatOf(config) {
  return everySeatSlotsOf(config).map(x => x.seat);
}

export function checkSeats(seats) {
  const missing = [];
  for (const s of seats) {
    if (!s) continue;
    if (!keyFor(s.provider)) missing.push(`${s.provider} (seat ${s.model})`);
  }
  return [...new Set(missing)];
}

/**
 * Run the chain.
 *
 * Two termination modes, both against the same fixed, binary checklist - only
 * how many labs must agree changes, never what they're allowed to ask for:
 *
 *  - "first" (default): alternate one critic and a revision until any single
 *    critic passes the draft, or the round cap is reached.
 *  - "unanimous": every critic seat reviews the SAME draft each round; a round
 *    only counts as a pass if every one of them independently signs off with
 *    no failures. Otherwise the reviser fixes the union of everything any
 *    critic flagged, and the whole panel reviews again next round.
 *
 * Panel topology, unanimous mode only (config.panel):
 *  - "independent" (default): each critic sees only the draft. Verdicts are
 *    uncorrelated, so disagreement between labs means something.
 *  - "relay" (experimental): critics run one after another and each is handed
 *    the verdicts before it - the chain as originally sketched. On the one
 *    controlled comparison so far (Docs/Runs.md) it caught 0/3 of a real
 *    scope leak the blind panel caught 2/3: anchoring on the first seat.
 *    Kept for comparison runs. Seat order is randomised per round and earlier
 *    verdicts are anonymised, which is the best-evidenced mitigation short of
 *    not doing it.
 *
 * The round cap is the whole point either way - an uncapped refine loop
 * drifts, whether that's one critic asked again and again or a panel asked
 * to keep agreeing.
 */
// v7 §3, descending rounds (config.descending: true; absent key preserves runChain's
// existing behaviour exactly). Each round debates a NEW, frozen object in sequence -
// plan, then architecture, then edge cases, then code by default - rather than
// re-debating the same draft. A stage is built once, then reviewed by every critic
// seat; a critic's amendment is applied only if it targets the stage still open.
// An amendment naming any earlier, already-frozen stage is rejected here, at the
// executor level - not by the critic's own system prompt (src/roles.js's
// DESCENDING_CRITIC_SYSTEM asks nicely, but this is the line that actually enforces
// it, per this project's documented history of unenforced prompt rules).
const DEFAULT_DESCENDING_ORDER = ['plan', 'architecture', 'edge_cases', 'code'];

export async function runDescendingChain({ request, config, log = console.log, onStage = () => {}, snap = null, earlierPlan = null }) {
  const stages = [];
  // Every stage this function runs - its own descending-build/critic calls, and every stage
  // invoke()'d inside the two runChain() sub-calls below via the shared onStage hook - lands in
  // this one array, so result.totals is priced across the whole descending run, not just the
  // stages this function invokes directly.
  const record = s => { stages.push(s); onStage(s); return s; };
  const subOnStage = s => { stages.push(s); onStage(s); };
  const opt = config.descending === true ? {} : config.descending;
  const order = Array.isArray(opt.stages) && opt.stages.length ? opt.stages : DEFAULT_DESCENDING_ORDER;
  const criticSeats = config.seats.critics || [];

  const frozen = {};
  const rejectedAmendments = [];
  let planResult = null;
  // report-partial.json (see partialDefaults): a cap hit inside either sub-run arrives with that
  // sub-run's own partial attached; the plan sub-run's debate record and every stage of the whole
  // descending run (this array) replace what the sub-run alone could see.
  if (snap) snap.fn = err => {
    const sub = err?.partial || {};
    return {
      ...partialDefaults(),
      ...sub,
      ...(planResult ? {
        proposals: planResult.proposals ?? [], proposalPool: planResult.proposalPool ?? [],
        dropouts: planResult.dropouts ?? [], board: planResult.board ?? null, debate: planResult.debate ?? null,
      } : {}),
      criteria: sub.criteria?.length ? sub.criteria : (planResult?.criteria ?? []),
      descending: true,
      stages,
      totals: summarise(stages),
    };
  };

  for (let i = 0; i < order.length; i++) {
    const stageName = order[i];
    log(`\nStage (descending): ${stageName}`);

    let content;
    if (i === 0) {
      // Round 1 (the first stage, "plan" by default) runs through the EXISTING pipeline once -
      // criteria, skeleton, proposals, debate, reply, build - rather than a bespoke descending
      // prompt, so criteria and proposals are established exactly the way every other chain
      // establishes them. Critique/revise, the final edit and handoff are deliberately skipped
      // here (maxRounds: 0, no finalist, no handoff seat) - those run once, after the loop, over
      // the whole descending stack, not per stage.
      const planConfig = {
        ...config,
        descending: undefined,
        maxRounds: 0,
        seats: { ...config.seats, finalist: undefined },
        handoff: false,
        // The security gate reviews the FINAL stack, once. Pre-release audit 2026-09-23
        // (GuardLayer #1): both sub-runs used to run it under the same `security-review` label,
        // so the final review was replayed from the plan-stage one and never read the final stack.
        security_review: undefined,
        // 0.8.2: the cold read runs once, over the final stack, not on the plan sub-run as well.
        coldRead: undefined,
        // "How this plan was argued" needs the plan sub-run's debate and the final sub-run's
        // verdicts in one record, which neither sub-run has. Not supported with descending yet:
        // chain-lint refuses the pair, and neither sub-run runs the stage.
        argued: undefined,
      };
      planResult = await runChain({ request, config: planConfig, log, onStage: subOnStage, earlierPlan });       // the plan sub-run is the one with a builder; the final sub-run is handed the stacked draft
      content = planResult.deliverable;
    } else {
      const builderSeat = (config.seats.descending && config.seats.descending[stageName]) || config.seats.builder;
      const built = record(await invoke(builderSeat, {
        system: R.DESCENDING_BUILD_SYSTEM,
        user: R.descendingBuildUser({ request, stageName, frozen, order }),
        log, label: `descending-${stageName}`,
      }));
      content = built.text;
    }

    for (const critic of criticSeats) {
      const res = record(await invoke(critic, {
        system: R.DESCENDING_CRITIC_SYSTEM,
        user: R.descendingCriticUser({ request, stageName, content, frozen, order }),
        log, label: `descending-${stageName}-critic-${seatKeyOf(critic)}`,
      }));
      const parsed = parseJson(res.text);
      const amend = parsed?.amend;
      if (!amend || !amend.target) continue;

      // The lock: an amendment targeting anything other than the currently open
      // stage is rejected outright, regardless of which stage it names or whether
      // that stage even exists. Frozen means frozen.
      if (amend.target !== stageName) {
        const rejection = {
          stage: stageName,
          critic: labOf(critic),
          target: amend.target,
          text: amend.text || '',
          reason: frozen[amend.target] !== undefined
            ? `stage "${amend.target}" is frozen; amendments must target the current stage ("${stageName}")`
            : `"${amend.target}" is not the current stage ("${stageName}")`,
        };
        rejectedAmendments.push(rejection);
        log(`  amendment rejected: ${shownSeat(critic)} tried to amend "${amend.target}". Reason: ${rejection.reason}.`);
        continue;
      }
      if (amend.text) {
        content += `\n\nAmendment (${labOf(critic)}): ${amend.text}`;
        log(`  amended ${stageName} per ${shownSeat(critic)}`);
      }
    }

    frozen[stageName] = content;
  }

  const stackDeliverable = order.map(s => `# ${s}\n\n${frozen[s]}`).join('\n\n');

  // Final round: signoff and handoff run once, over the whole descending stack together - never
  // per stage. Reuses the existing critic/revise, finalist and handoff machinery by handing the
  // stack in as `draft`, which is what already makes runChain skip questions/criteria/proposals
  // and go straight to critique.
  const finalConfig = {
    ...config,
    descending: undefined,
    argued: undefined,
    criteria: (planResult?.criteria && planResult.criteria.length) ? planResult.criteria : config.criteria,
  };
  const finalResult = await runChain({ request, config: finalConfig, draft: stackDeliverable, log, onStage: subOnStage });

  return {
    descending: true,
    order,
    frozen,
    stages,
    rejectedAmendments,
    deliverable: finalResult.deliverable,
    criteria: finalResult.criteria,
    proposals: planResult?.proposals ?? [],
    proposalPool: planResult?.proposalPool ?? [],
    dropouts: planResult?.dropouts ?? [],
    board: planResult?.board ?? null,
    debate: planResult?.debate ?? null,
    // 0.8.2: what each debate reader saw happened in the plan sub-run (the final stack has no debate), so it is forwarded from there.
    ...(planResult?.debateOrders?.length ? { debateOrders: planResult.debateOrders } : {}),
    handoff: finalResult.handoff,
    passed: finalResult.passed,
    lastCritique: shownCritique(finalResult.lastCritique),
    signoff: finalResult.signoff,
    // v7.3: forwarded from finalResult so allocator (and challenge, the same
    // pre-existing gap) work when stacked with descending - the final round
    // over the whole descending stack is a normal runChain() unanimous-panel
    // call and already computes both; this just stops dropping them here.
    challenge: finalResult.challenge,
    allocator: finalResult.allocator,
    disputes: finalResult.disputes,
    history: finalResult.history,
    // Pre-release audit 2026-09-23 (GuardLayer #1, and PanelSignoff's backlog): these were dropped
    // here, so a descending chain's security gate never reached the CLI (no exit 7/8, no gate in
    // report.json) and the panel/dispute record was lost. Forwarded only when the final run set them.
    ...Object.fromEntries(['security_review', 'panelVerdicts', 'missingCriteria', 'signoffTableGaps', 'outsideCriteriaRows', 'debateOrders', 'answerBack', 'answerBackReplies', 'layerDebates', 'proposerReturns', 'coldRead', 'signedText', 'deliveredText', 'handoffText', 'criteriaLints', 'dispute', 'regressions', 'noHeardReviewer', 'notQuorate', 'severityRun', 'endingWord', 'stopKind']
      .filter(k => finalResult[k] !== undefined).map(k => [k, finalResult[k]])),
    totals: summarise(stages),
  };
}

// A run the per-run spend cap stopped (0.7.7, report-partial.json). A stopped run writes no
// report.json - that file's existence means "finished" everywhere - so a run capped after 11
// rounds (premium-7, 2026-09-25, $33.33 of $36) left ~300 stage files and no machine-readable
// summary of its proposals, debate, per-round verdicts or costs. runChain now attaches what it has
// so far to the BudgetExceeded it throws, as `err.partial`: a result object of the same shape it
// returns on success, with every stage it never reached at the value meaning "did not run". The
// CLI writes it through reportJsonShape() as report-partial.json. Additive only: no stage, label or
// cache entry changes, and nothing is attached to any other error.
function partialDefaults() {
  return {
    criteria: [], questions: null, proposals: [], proposalPool: [], dropouts: [], board: null, debate: null,
    scoreboard: null, passed: false, lastCritique: null, signoff: null, challenge: null, allocator: null,
    disputes: [], regressions: [], panelVerdicts: [], history: [], orphanSections: [], withdrawalCycles: 0,
  };
}

/**
 * The severity record names a judge by its SEAT KEY while the run is going (the ledger is keyed by it). A record a person or another tool reads names the bare lab, and a repeated seat adds `seat` (the lab-identity rule, src/seat-key.js labFromKey; test/lab-identity.test.js LI-5, test/lab-identity-paths.test.js LI-9).
 * Every layered unanimous chain keeps the ledger since M1 (S19), so a repeated-model chain now reaches this: the rows of the snapshot are rewritten here, once, where the run hands it out. A chain with no repeated seat is returned as it is.
 */
function bareLabsOfSeverity(snap) {
  if (!snap) return snap;
  const bare = row => (row && typeof row.lab === 'string' && labFromKey(row.lab) !== row.lab ? { ...row, lab: labFromKey(row.lab), ...(typeof row.seat === 'string' ? { raiser_seat: row.lab } : { seat: row.lab }) } : row);   // a retag row's own `seat` is the layer-3 seat that re-tagged: it stays, and the raiser's key goes in `raiser_seat`
  const out = { ...snap };
  for (const k of ['open', 'swept', 'withdrawn', 'overrides', 'retags', 'retags_refused']) if (Array.isArray(snap[k])) out[k] = snap[k].map(bare);
  return out;
}

/** B2: one exchange call, and ONE more under `<label>-retry` when the provider ended the reply early (cut off at the cap), as the proposal debate does; the caller treats a still unreadable reply as no posts. */
async function askOnceMore(seat, opts, label, say, record) {
  const st = record(await invoke(seat, { ...opts, label }));
  if (!draftIncomplete(st.usage)) return st;
  say(`  ${label}: the provider ended the reply with stop "${st.usage.stop}" - retrying once.`);
  return record(await invoke(seat, { ...opts, label: `${label}-retry` }));
}

/**
 * B2 (debate-084/b2): the exchange inside one layer, for judges that were heard this pass. `judges` = [{ seat, key, failures }] (key: the seat key, failures: that judge's objections as it raised them). Every call goes through invoke(), so the spend cap
 * covers it; `record` takes each call's stage record. Round 1 is: every judge posts on the others' objections, then each raiser answers the posts on its own. With `rounds` > 1 a further round runs while a disposition CHANGED in the round before
 * (an argued withdrawal, an amendment, a new objection named in a post, or a judge's stance differing from its own in the round before), at most `rounds` (7 at most): the judges then read the standing objections with the earlier posts and answers
 * (posters hidden; a judge sees which earlier post was its own) and post again. Returns the rows (one per objection, with every post and answer and the outcome), the per-round summary, the ids withdrawn and the amended texts; applying them to the pass
 * is the caller's. Exported so the pilot script can run it alone.
 */
export async function exchangeRound({ judges, request, criteria, draft, round, record, log = () => {}, where = 'layer', rounds = EXCHANGE_ROUNDS, rulingsText = '', personaSystem = null, severity = false, declinedReasons = null, cacheTtl = null, jsonModeLabs = null, layerOne = false, short = false, ending = null, layout = null }) {   // layout (0.8.4 cache part (b)1): null, or { config, checks, endMarker }: the cache-shaped order of src/cache-order.js for a seat that gets it, with H, the first user block, built from the pass's own arguments (the bounded draft, the checks block, the draft boundary); ending (0.8.4 S4b, CA6, W26): the ENDING exchange: { post(seat, again), reply(seat, again) } give the system texts of its LAST round (src/ending-exchange-prompts.js); in that round only a defect named is a late finding (returned in `late`, nothing is minted) and an amend is invalid. layerOne (0.8.4 S3): the lowest layer, where a raiser is asked to reply only after a counted contest or insufficient-evidence post (Q1(b)); layers 2 and 3 keep the shortened exchange's own trigger (S6). rulingsText (B3 prototype): the rulings in force at this pass, '' when there is none; short (0.8.4 S6, Q5, W14): the SHORTENED exchange of a layer above the lowest: one round, every raiser with a standing objection replies once whatever its posts, the line `sign-off:` of its reply is read and returned in `signoffs`, and the safety stop cannot fire (one round is the whole exchange)
  const raised = exchangeObjections(judges.map(j => ({ key: j.key, failures: j.failures, stage: j.stage })), objectionId);
  const none = { raised, rows: [], rounds: [], withdrawn: new Set(), amended: new Map(), ...(ending ? { late: [] } : {}) };
  if (judges.length < 2 || !raised.length) return none;
  const capSeat = s => (s.panelMaxTokens ? keepSeatKey(s, { ...s, maxTokens: s.panelMaxTokens }) : s);
  // 084/glm-format (src/exchange-json-mode.js, chain switch `exchange_json_mode`): the seat of a listed lab asks for JSON mode on these two calls (the post and the answer) and on no other call; `jsonModeLabs` null (the switch off) returns the seat unchanged.
  const exchangeSeat = s => jsonModeSeat(capSeat(s), jsonModeLabs);
  // 0.8.4 cache part (b)1 (src/cache-order.js): H, the first user block every judge call of this pass starts with, is R.criticUserHead of the pass's own arguments (the verdict prompts' head: the bounded draft, the checks block, the draft boundary), only where the new order is live; null: every byte as before.
  const exchangeArgs = layout ? { request, criteria, draft: boundedDraft(draft, !!layout.endMarker), checks: layout.checks ?? '', endMarker: !!layout.endMarker } : null;
  const exchangeHead = layout ? R.criticUserHead(exchangeArgs) : null;
  // The new order replaces the pair and the head. Ruling B's mark (round 2 on) does not apply to a laid call: its mark is the mark rule of the order (src/cache-order-gate.js markTtlOf): every call of a direct-Anthropic seat in a layer that runs an exchange, from round 1.
  const layOut = (ask, laid, seat) => { if (!laid.laid) return; ask.system = laid.system; ask.user = laid.user; ask.blockAfter = laid.head; ask.shownSystem = laid.shownSystem; const ttl = markTtlOf(layout.config, seat); if (ttl) ask.cacheTtl = ttl; else delete ask.cacheTtl; ask.cacheHead = laid.head; };
  // 084/glm-format (A-DRAFT, held path): one closing sentence at the very END of both exchange user messages, after the handler's rulings text, so the cached head (the start of the message) is untouched (invoke(), the head must be the start of the user text). Held until the owner's yes: held() returns nothing while roles.js has no export of that name.
  const closingText = exchangeClosingText();
  // 0.8.4 S3 (W2, held): the sentence that asks a withdrawing raiser to name the post or the passage that moved it. Until it is recorded in src/roles.js the reply prompt is byte-identical and no anchor is demanded (a judge is never flagged for what it was not asked); what a judge does give is always checked.
  const anchorRule = held('layerReplyAnchorRule');
  // 0.8.4 S3 (W44, held; Q1(a), N25, T22ap): the writer's reason for an objection it declined reaches the judges of the layer only once the sentence that introduces it is recorded in src/roles.js. ONE held() read gates both the reason block (rendered by the recorded layerDebateUser) and that sentence, on every layered chain, whatever the severity switch: while it is held no reason is passed on and the post prompt is byte-identical to the one that has always been sent; once it is recorded the reason reaches every layered chain, from the writer's DISPUTES HISTORY: the reason is the writer's most recent decline of the objection (a later decline replaces it, a revision that says nothing keeps it), whatever the answer-back record of the round holds.
  const reasonRule = held('writerReasonRule');
  const reasons = reasonRule ? declinedReasons : null;
  const objs = new Map(raised.map(o => [o.id, { ...o, status: 'standing', text_round: 0, posts: [], replies: [] }]));   // text_round: the round of the last applied amend (0: the text it was raised with, or the round it was named in); the posts on its FINAL text are the posts of later rounds
  // RU-S1-23/24 (Q3(f), D36, M0 FIX 3): each post keeps its poster's maker, the company of the seat's model, for a model-API seat; null (the key absent) for a mock seat and for a SESSION seat, whose maker is the company its answer declared and is added at report time (src/answered-by.js layerDebatesWithMakers). Record only: no branch reads it, no prompt shows it.
  const makerOfKey = new Map(judges.map(j => [j.key, j.seat?.provider === 'external' ? null : companyOfSeat(j.seat)]));
  const lastStance = new Map();   // `${judge}\u0000${id}` -> the position of that judge's latest counted post (an explicit no_view is a position; a refused or omitted post updates nothing)
  const roundsRun = [];
  const proposedAll = [];   // NEW-F4-1 (M1, S19): the defects named in posts that had no valid rating, collected over the rounds of this exchange (no id, no objection row)
  let lastChanged = new Set();
  const roundsAllowed = layerOne && !ending ? LAYER_ONE_EXCHANGE_ROUNDS : EXCHANGE_ROUNDS;   // exchange idea 2: the layer-1 exchange stops after 3 rounds; the ending exchange keeps its 7
  const maxRounds = Math.min(Math.max(Number.isInteger(rounds) ? rounds : roundsAllowed, 1), roundsAllowed);
  const labelOf = (kind, k, key) => `${kind}-${round}${k > 1 ? `-x${k}` : ''}-${key}`;
  const earlierOf = (o, judgeKey) => ({ posts: o.posts.filter(p => !p.omitted).map(p => ({ round: p.round, mine: p.by === judgeKey, stance: p.stance, text: p.text, ...(p.quote ? { quote: p.quote } : {}) })), replies: o.replies.map(r => ({ round: r.round, action: r.action, text: r.text })) });
  log(`\n  ${where} exchange: ${raised.length} objection(s), shown to the other judges of the layer (raiser hidden).`);
  const lateAll = [];   // the late findings of the ending exchange's last round (0.8.4 S4b)
  const attached = [];   // 0.8.4 S14: a quote that reached an objection that had none, from the raiser's reply (W24) or its own post (W1's clause): { lab, id, quote, round, stage }
  const attachQuote = (o, quote, stage, round) => { if (!o || o.status !== 'standing' || o.quote || o.attached_quote || !quoteFound(draft, quote)) return; o.attached_quote = quote; o.quote_attached_in = stage; attached.push({ lab: o.key, id: o.id, quote, round, stage }); };   // only an objection that still stands and has no quote, and only a passage the plan holds; the id is not touched (the quote is read AFTER the id). C&C R528 hold: the passage is the objection's own field `attached_quote`, never `quote`, so no later prompt of the exchange, no ending-exchange candidate and no note built from the rows shows it before S12 words it
  const signoffsAll = [];   // 0.8.4 S6: the sign-off line (and field) of each raiser's reply in the shortened exchange: { seat, line, field, value, mismatch }
  try {
  for (let k = 1; k <= maxRounds; k++) {
    const lastNow = !!ending && k === maxRounds;   // the seventh round of the ENDING exchange: W26 and no amend
    const standing = [...objs.values()].filter(o => o.status === 'standing');
    if (!standing.length) break;
    if (k > 1) log(`  exchange round ${k}: ${standing.length} objection(s) stand.`);
    const postResults = await settleAll(judges.map(async j => {
      const key = j.key; const lines = []; const say = m => lines.push(m);
      const showList = standing.filter(o => o.key !== key);
      if (!showList.length) return { key, lines, posts: [], news: [], dropped: [], shown: [] };
      const label = labelOf('ldebate', k, key);
      // 0.8.4 S14 (W1's clause, D37 option iv; held): in round 1 of an ordinary exchange the post lists the judge's OWN failures that quote nothing (a held block), and readPosts reads an own_quote for exactly those ids. The list is made ONCE, so the judge is never asked about an id the reader ignores, or the reverse; with the block unrecorded nothing is listed and nothing is read.
      const ownBlockFn = k === 1 && !ending ? held('ownFailuresBlock') : undefined;
      const ownShown = typeof ownBlockFn === 'function' ? [...objs.values()].filter(o => o.key === key && o.status === 'standing' && !o.quote).map(o => ({ id: o.id, criterion: o.criterion })) : [];
      const ownBlockText = ownShown.length ? `\n\n${ownBlockFn({ items: ownShown })}` : '';
      try {
        const postSystem = () => (lastNow ? ending.post(j.seat, k > 1) : personaSystem ? personaSystem('debate', j.seat, k > 1) : R.layerDebateSystem(k > 1));
        const ask = { system: postSystem(), user: R.layerDebateUser({ request, criteria, draft, objections: showList.map(o => ({ ...o, ...(reasons?.get(o.id) ? { declined_reason: reasons.get(o.id) } : {}), ...(k > 1 ? { earlier: earlierOf(o, key) } : {}) })) }) + (reasons && showList.some(o => reasons.get(o.id)) ? `\n\n${reasonRule()}` : '') + ownBlockText + rulingsText + closingText, log: say, blockAfter: R.layerDebateUserHead({ request, criteria, draft }), ...(exchangeCallCarriesHead({ ttl: cacheTtl, k, rounds: maxRounds }) ? { cacheHead: R.layerDebateUserHead({ request, criteria, draft }), cacheTtl } : {}) };   // prompt caching (ruling B): the start of the post prompt (the plan) on k>=2 of a round budget of 3 or more: k=2 writes, k>=3 read
        if (exchangeHead !== null) layOut(ask, judgePrompt({ config: layout.config, seat: j.seat, kind: 'post', compose: postSystem, user: ask.user, head: exchangeHead, headArgs: exchangeArgs, userHead: R.layerDebateUserHead({ request, criteria, draft }), endMarker: !!layout.endMarker }), j.seat);
        const st = await askOnceMore(exchangeSeat(j.seat), ask, label, say, record);
        const parsed = parseJson(st.text);
        if (!parsed) {
          const nearJson = nearJsonPause(st, exchangeSeat(j.seat), ask.system, sentUserOf(st, ask.user), ask.shownSystem);
          if (nearJson) { say(`  ${shownSeat(j.seat)}/${j.seat.model}: the exchange reply is almost JSON and could not be read - the run pauses for a repair (${nearJson.label}).`); throw nearJson; }
        }
        if (!parsed) { say(`  ${shownSeat(j.seat)}/${j.seat.model}: unreadable exchange reply - no posts counted.`); return { key, lines, posts: [], news: [], dropped: [{ reason: 'unreadable' }], shown: showList.map(o => o.id) }; }
        const got = readPosts(parsed, { shown: showList, draft, severity, lastRound: lastNow, own: ownShown.map(o => o.id) });
        {   // 4 Nov 2026 (unit 8): a post on an id one character from exactly one shown id pauses for a repair (idSlipPause); every other unknown id is dropped as before. The raw ids: the check compares them as written (a padded id is not a slip)
          const shownIds = showList.map(o => o.id);
          const named = (Array.isArray(parsed?.posts) ? parsed.posts : []).map(p => (p && typeof p.on === 'string' ? p.on : null)).filter(Boolean);
          const slipPause = idSlipPause(st, exchangeSeat(j.seat), ask.system, sentUserOf(st, ask.user), idSlipsOf(named, shownIds), shownIds);
          if (slipPause) { say(`  ${shownSeat(j.seat)}/${j.seat.model}: an exchange post names an objection id one character off (${slipWords(slipPause.repair.slips)}) - the run pauses for a repair (${slipPause.label}).`); throw slipPause; }
        }
        const cap = (v, field) => capField(v, { stage: label, field });   // the same cut the proposal debate puts on a seat's free text before other models read it
        got.posts = got.posts.map(p => ({ ...p, text: cap(p.text, 'text'), ...(p.quote ? { quote: cap(p.quote, 'quote') } : {}) }));
        got.news = got.news.map(n => ({ ...n, criterion: cap(n.criterion, 'criterion'), problem: cap(n.problem, 'problem'), ...(n.quote ? { quote: cap(n.quote, 'quote') } : {}) }));
        if (got.late) got.late = got.late.map(l => ({ ...l, problem: cap(l.problem, 'problem'), ...(l.criterion ? { criterion: cap(l.criterion, 'criterion') } : {}), ...(l.quote ? { quote: cap(l.quote, 'quote') } : {}) }));   // 0.8.4 S4b: the same cut for a late finding's free text
        got.proposed = got.proposed.map(n => ({ ...n, ...(n.criterion ? { criterion: cap(n.criterion, 'criterion') } : {}), problem: cap(n.problem, 'problem'), ...(n.quote ? { quote: cap(n.quote, 'quote') } : {}) }));
        say(`  ${shownSeat(j.seat)}/${j.seat.model}: ${got.posts.length} post(s) - ${['support', 'contest', 'insufficient_evidence'].map(x => `${got.posts.filter(p => p.stance === x).length} ${x}`).join(', ')}${got.news.length ? `; ${got.news.length} new objection(s)` : ''}${got.proposed.length ? `; ${got.proposed.length} proposed, not recorded as an objection` : ''}${got.dropped.length ? `; ${got.dropped.length} post(s) dropped` : ''}`);
        return { key, lines, ...got, shown: showList.map(o => o.id), stage: st.label ?? label };   // stage: the call whose reply was read (the one-more-ask `-retry` included), what a new objection's `raised_in` names
      } catch (err) {
        rethrowControlFlow(err);
        say(`  ${shownSeat(j.seat)}/${j.seat.model}: no exchange reply (${String(err.message).slice(0, 100)}).`);
        return { key, lines, posts: [], news: [], dropped: [{ reason: 'no_reply' }], shown: showList.map(o => o.id) };
      }
    }));
    postResults.forEach(r => r.lines.forEach(m => log(m)));
    let stanceChanged = false, newCount = 0;
    for (const r of postResults) for (const l of r.late || []) lateAll.push({ by: r.key, round: k, ...l });   // 0.8.4 S4b: late findings of the last round of the ending exchange
    for (const r of postResults) for (const n of r.proposed || []) proposedAll.push({ by: r.key, round: k, ...n });   // NEW-F4-1: a defect named in a post with no valid rating; no id, no objection row, not retried
    const changedIds = new Set();   // the objections whose disposition changed in THIS round (Q4(a)): a stance that differs from the same judge's in the round before, an argued withdrawal, a reply kind that differs from the previous reply or an amend that changes the text, a new objection
    const roundPosts = new Map();   // id -> this round's posts on it
    for (const r of postResults) {
      for (const p of r.posts) {
        const o = objs.get(p.on); if (!o) continue;
        const post = { ...p, by: r.key, round: k, ...(makerOfKey.get(r.key) ? { maker: makerOfKey.get(r.key) } : {}) };
        o.posts.push(post); roundPosts.set(p.on, [...(roundPosts.get(p.on) || []), post]);
        if (p.counted !== false) {   // Q4(a), M0 FIX 2: an EXPLICIT no_view is a position (it differs from a stance, so a move between them is a change); a post the tool refused (counted:false) is not a position, and an omitted post never reaches this loop
          const sk = `${r.key}\u0000${p.on}`; const prev = lastStance.get(sk);
          if (prev !== undefined && prev !== p.stance) { stanceChanged = true; changedIds.add(p.on); }
          lastStance.set(sk, p.stance);
        }
      }
      // Q4(a): a post omitted on a standing objection (the reply could not be read, the call failed, or the judge skipped it) counts as NO VIEW in round 1, flagged; in a later round it carries the judge's position of the round before forward, flagged, and is not a change. A position about text that has since been amended is not carried (the objection's final text is what the outcome fits, Q1).
      const gave = new Set(r.posts.map(p => p.on));
      const missingWhy = (r.dropped || []).some(d => d.reason === 'unreadable') ? 'unreadable' : (r.dropped || []).some(d => d.reason === 'no_reply') ? 'no_reply' : 'omitted';   // the record tells apart a post the judge skipped (omitted), a reply that stayed unreadable after the one cut-off retry (unreadable) and a call that failed (no_reply)
      for (const id of r.shown || []) {
        if (gave.has(id)) continue;
        const o = objs.get(id); if (!o) continue;
        const before = [...o.posts].reverse().find(p => p.by === r.key && p.round === k - 1);
        const carried = before && before.counted !== false && before.stance !== 'no_view' && before.round > o.text_round;
        // a carried position is a position the exchange keeps counting, so it is a flagged post; a post that is simply missing is not a post, it is listed on the row (`omitted`) with the reason, so `posts` holds only what judges wrote or what was carried
        if (carried) o.posts.push({ on: id, stance: before.stance, text: before.text, ...(before.quote ? { quote: before.quote } : {}), counted: true, by: r.key, round: k, ...(makerOfKey.get(r.key) ? { maker: makerOfKey.get(r.key) } : {}), omitted: true, omitted_why: missingWhy, carried: true });
        else (o.omitted ||= []).push({ by: r.key, round: k, why: missingWhy });
      }
      for (const n of r.news) {
        let id = objectionId(r.key, n);
        if (objs.has(id)) {
          // PR #2 fix unit, item 3 (Bug Audit S2 F1): a NEW objection named in an exchange post whose id (seat, criterion, quoted passage) is one of the seat's standing objections is the same complaint only when its text is the same. A different problem is a second objection under the same key and
          // takes the next suffix (#2, #3), as a blind review's new objection does (src/objection-assign.js); the suffix is registered, so every later reader that recomputes the id from this failure agrees. The same complaint again (this round or an earlier one) is still one objection.
          const base = baseObjectionId(r.key, n); const text = normProblem(n.problem);
          if ([...objs.values()].some(o => o.key === r.key && baseObjectionId(r.key, o) === base && normProblem(o.problem) === text)) continue;
          id = nextSuffixedId(r.key, n, new Set(objs.keys())); recordAssignedId(r.key, n, id);
        }
        objs.set(id, { id, key: r.key, criterion: n.criterion, problem: n.problem, ...(n.quote ? { quote: n.quote } : {}), ...(n.severity !== undefined ? { severity: n.severity } : {}), from_exchange: true, raised_in: r.stage ?? labelOf('ldebate', k, r.key), added_round: k, text_round: k, status: 'standing', posts: [], replies: [] });
        newCount += 1; changedIds.add(id);
      }
    }
    // The raisers answer: only a raiser whose objection drew a post other than no_view in THIS round is asked.
    const replyResults = await settleAll(judges.map(async j => {
      const key = j.key; const lines = []; const say = m => lines.push(m);
      const asks = p => layerOne ? p.counted !== false && (p.stance === 'contest' || p.stance === 'insufficient_evidence') : p.stance !== 'no_view';   // layer 1: a reply follows a counted contest or insufficient-evidence post only (Q1(b), T1a, T4f); a refused post is no view and asks nothing
      const mine = short ? standing.filter(o => o.key === key) : standing.filter(o => o.key === key && (roundPosts.get(o.id) || []).some(asks));   // short (S6): every raiser replies once, whatever its posts (the reply carries the sign-off line of W14)
      if (!mine.length) return { key, lines, replies: [] };
      const label = labelOf('lreply', k, key);
      try {
        const items = mine.map(o => ({ ...o, posts: (roundPosts.get(o.id) || []).filter(p => p.stance !== 'no_view').map(({ stance, text, quote }) => ({ stance, text, quote })), ...(k > 1 ? { earlier: { posts: o.posts.filter(p => p.round < k && !p.omitted).map(p => ({ round: p.round, mine: false, stance: p.stance, text: p.text, ...(p.quote ? { quote: p.quote } : {}) })), replies: o.replies.map(r => ({ round: r.round, action: r.action, text: r.text })) } } : {}) }));
        const replySystem = () => (lastNow ? ending.reply(j.seat, k > 1) : personaSystem ? personaSystem('reply', j.seat, k > 1) : R.layerReplySystem(k > 1) + replyAnchorTail());
        const ask = { system: replySystem(), user: R.layerReplyUser({ request, criteria, draft, items }) + rulingsText + closingText, log: say, blockAfter: R.layerReplyUserHead({ request, criteria, draft }), ...(exchangeCallCarriesHead({ ttl: cacheTtl, k, rounds: maxRounds }) ? { cacheHead: R.layerReplyUserHead({ request, criteria, draft }), cacheTtl } : {}) };
        if (exchangeHead !== null) layOut(ask, judgePrompt({ config: layout.config, seat: j.seat, kind: 'answer', compose: replySystem, user: ask.user, head: exchangeHead, headArgs: exchangeArgs, userHead: R.layerReplyUserHead({ request, criteria, draft }), endMarker: !!layout.endMarker }), j.seat);
        const st = await askOnceMore(exchangeSeat(j.seat), ask, label, say, record);
        const parsed = parseJson(st.text);
        if (!parsed) {
          const nearJson = nearJsonPause(st, exchangeSeat(j.seat), ask.system, sentUserOf(st, ask.user), ask.shownSystem);
          if (nearJson) { say(`  ${shownSeat(j.seat)}/${j.seat.model}: the answer to the exchange is almost JSON and could not be read - the run pauses for a repair (${nearJson.label}).`); throw nearJson; }
        }
        const signoff = short ? signoffOf(st.text, parsed) : null;   // S6 (W14, G7): read from the RAW reply text, whether or not the JSON was readable; recorded, never acted on here
        if (signoff) say(`  ${shownSeat(j.seat)}/${j.seat.model}: sign-off line: ${signoff.line}${signoff.field !== 'missing' ? `, field: ${signoff.field}` : ''}${signoff.mismatch ? ' (they differ: "no" is read)' : ''}.`);   // A-DRAFT
        if (!parsed) { say(`  ${shownSeat(j.seat)}/${j.seat.model}: unreadable answer to the exchange - its objections stand.`); return { key, lines, replies: [], unparsed: mine.map(o => o.id), ...(signoff ? { signoff } : {}) }; }
        {   // 4 Nov 2026 (unit 8): an answer naming one of the raiser's own objections one character off pauses for a repair; readReplies drops it silently, so the ids are compared here
          const ownIds = mine.map(o => o.id);
          const named = (Array.isArray(parsed?.replies) ? parsed.replies : []).map(r => (r && typeof r.id === 'string' ? r.id : null)).filter(Boolean);
          const slipPause = idSlipPause(st, exchangeSeat(j.seat), ask.system, sentUserOf(st, ask.user), idSlipsOf(named, ownIds), ownIds);
          if (slipPause) { say(`  ${shownSeat(j.seat)}/${j.seat.model}: an answer to the exchange names an objection id one character off (${slipWords(slipPause.repair.slips)}) - the run pauses for a repair (${slipPause.label}).`); throw slipPause; }
        }
        const replies = readReplies(parsed, { own: items.map(i => ({ id: i.id, criterion: i.criterion, shown: i.posts })), draft, strict: !!anchorRule, noAmend: lastNow }).map(r => ({ ...r, text: capField(r.text, { stage: label, field: 'text' }), ...(r.problem ? { problem: capField(r.problem, { stage: label, field: 'problem' }) } : {}) }));
        say(`  ${shownSeat(j.seat)}/${j.seat.model}: ${['keep', 'amend', 'withdraw'].map(x => `${replies.filter(r => r.action === x && !r.invalid).length} ${x}`).join(', ')}${replies.some(r => r.invalid) ? `, ${replies.filter(r => r.invalid).length} invalid (counted as no reply)` : ''}`);
        return { key, lines, replies, stage: st.label ?? label, ...(signoff ? { signoff } : {}) };
      } catch (err) {
        rethrowControlFlow(err);
        say(`  ${shownSeat(j.seat)}/${j.seat.model}: no answer to the exchange (${String(err.message).slice(0, 100)}) - its objections stand.`);
        return { key, lines, replies: [], unparsed: mine.map(o => o.id) };
      }
    }));
    replyResults.forEach(r => r.lines.forEach(m => log(m)));
    for (const r of replyResults) if (r.signoff) signoffsAll.push({ seat: r.key, ...r.signoff });
    let withdrawnNow = 0, amendedNow = 0;
    // A raiser reply that cannot be read counts as NO REPLY, flagged "unparsed" (Q1(b), T2c, T2p): the objection stands under the outcome its posts give and nothing closes it.
    for (const id of replyResults.flatMap(x => x.unparsed || [])) { const o = objs.get(id); if (o) (o.flags ||= []).push({ kind: 'raiser_reply_unparsed', round: k }); }
    for (const r of replyResults.flatMap(x => x.replies)) {
      const o = objs.get(r.id); if (!o) continue;
      // A reply that parses but fails the requirement of its kind also counts as no reply, flagged "invalid" with the failed requirement (T2d, T2h, T2i, T2l, T2f, T2n; D11: not retried). It is never read as a withdrawal.
      if (r.invalid) { (o.flags ||= []).push({ kind: 'raiser_reply_invalid', round: k, action: r.action, requirement: r.invalid_reason }); continue; }
      const before = o.replies.at(-1)?.action;
      o.replies.push({ ...r, round: k });
      if (before && before !== r.action) changedIds.add(o.id);   // the reply kind differs from the previous reply
      if (r.action === 'withdraw') { o.status = 'withdrawn'; withdrawnNow += 1; changedIds.add(o.id); }
      else if (r.action === 'amend' && r.problem && r.problem !== o.problem) { o.original_problem ??= o.problem; o.problem = r.problem; o.text_round = k; amendedNow += 1; if (ending) changedIds.add(o.id); }   // exchange idea 1 (layer exchange only; C&C 10 Nov: the ENDING exchange stays as it was): a reworded amend is no longer a change that keeps a layer exchange going (it still counts in `amended` and moves text_round)
    }
    // 0.8.4 S14 (W24, W1's clause; D21): a quote the raiser gave beside a keep or an amend (not a withdrawal: that closes the objection), or in its own post, is attached to its objection when it had none and the plan holds the passage. Nothing else changes: no id, no text, and the round's convergence is not touched.
    for (const rr of replyResults) for (const r of rr.replies) if (!r.invalid && r.action !== 'withdraw' && r.quote) attachQuote(objs.get(r.id), r.quote, rr.stage ?? labelOf('lreply', k, rr.key), k);
    for (const pr of postResults) for (const q of pr.own_quotes || []) attachQuote(objs.get(q.id), q.quote, pr.stage ?? labelOf('ldebate', k, pr.key), k);
    const changed = changedIds.size > 0;
    roundsRun.push({ round: k, posts: postResults.reduce((n, r) => n + r.posts.length, 0), withdrawn: withdrawnNow, amended: amendedNow, new_objections: newCount, stance_changed: stanceChanged, changed });
    lastChanged = changedIds;
    const progressed = withdrawnNow > 0 || newCount > 0;   // exchange idea 1 (C&C 10 Nov): a round with no withdrawal and no new objection ends the exchange; a changed stance, a different reply kind or a reworded amend do not keep it going
    if ((ending ? !changed : !progressed) && (k >= 2 || !layerOne)) break;   // the ENDING exchange keeps today's rule (a round that changes nothing); its late-findings round is reached as before   // convergence is a round that changes nothing; on layer 1 round 2 always runs while an objection still stands after round 1 (Q4(b), N9). Layers 2 and 3 keep their own shortened exchange (S6)
  }
  } catch (finishErr) {
    // PR #2 fix unit (C&C, 13 Nov): the person's finish ends the run at a call of this exchange. What its COMPLETED rounds settled travels with the finish: the objections a raiser withdrew in them (a round's withdrawals are applied only after its answers are all in, so a round the finish cut applied none), so the finish's record does not list a withdrawn objection as open.
    if (finishErr instanceof SecretFinish) {
      finishErr.exchangeWithdrawn = [...objs.values()].filter(o => o.status === 'withdrawn').map(o => ({ id: o.id, lab: o.key, criterion: o.criterion, problem: o.problem, ...(o.quote ? { quote: o.quote } : {}), ...(o.severity !== undefined ? { severity: o.severity } : {}), reason: o.replies.filter(r => r.action === 'withdraw').at(-1)?.text ?? '', ...(o.from_exchange ? { from_exchange: true } : {}) }));   // ruling 19: with what the closed states, the severity record and the shown-back list are written from
      // and the objections a judge NAMED in a completed round's post (they live only in this exchange's state): the same judge's answer, kept as the cut row's own objections are
      finishErr.exchangeNamed = [...objs.values()].filter(o => o.from_exchange && o.status === 'standing').map(o => ({ lab: o.key, id: o.id, criterion: o.criterion, problem: o.problem, ...(o.quote ? { quote: o.quote } : {}), ...(o.severity !== undefined ? { severity: o.severity } : {}), fix: '' }));
    }
    throw finishErr;
  }
  // The safety stop: the last round the budget allowed still changed something (N9, Q4(c)). The objections that were still changing in it, and that drew posts on their final text, are unresolved_at_stop.
  const lastRound = roundsRun.at(-1);
  // The stop fires only if the last allowed round changed something AND an objection still stands after it (N9, Q4(c); RU-S3-66: a confirming round would have run): everything withdrawn in it is a convergence, not a stop.
  const stopFired = !short && !!lastRound && lastRound.round === maxRounds && lastRound.changed && [...objs.values()].some(o => o.status === 'standing');   // short (S6): the one round of the shortened exchange is not a budget that ran out
  const rows = [...objs.values()].map(o => {
    const reply = o.replies.at(-1) || null;
    // The outcome and the minority notes fit the objection's FINAL text (Q1(d), RU-S1-07, RU-S1-12): only the posts of rounds after its last applied amend (or after the round it was named in) count. not_debated: raised or amended in a round with no round after it (RU-S1-15, T22e): its final text drew no posts.
    const lastRoundRun = lastRound?.round ?? 0;
    const onFinal = o.posts.filter(p => p.round > o.text_round);
    const outcome = o.status === 'withdrawn' ? 'withdrawn_argued' : o.text_round >= lastRoundRun ? 'not_debated' : stopFired && lastChanged.has(o.id) && onFinal.length ? 'unresolved_at_stop' : outcomeOf(onFinal, reply);
    return { id: o.id, criterion: o.criterion, problem: o.problem, ...(o.original_problem ? { original_problem: o.original_problem } : {}), ...(o.quote ? { quote: o.quote } : {}), ...(o.attached_quote ? { attached_quote: o.attached_quote } : {}), ...(o.quote_attached_in ? { quote_attached_in: o.quote_attached_in } : {}), ...(o.severity !== undefined ? { severity: o.severity } : {}), raised_by: o.key, ...(o.raised_in ? { raised_in: o.raised_in } : {}), ...(o.from_exchange ? { from_exchange: true, added_round: o.added_round } : {}), ...(o.carried_from ? { carried_from: o.carried_from } : {}),
      posts: o.posts, ...(reply ? { reply, replies: o.replies } : {}), outcome, minority_notes: minorityNotesOf(onFinal, outcome), ...(o.flags ? { flags: o.flags } : {}), ...(o.omitted ? { omitted: o.omitted } : {}) };   // minority notes (Q1(d)): the contest reasons when it stands, the support reasons when it was withdrawn over a supporter's view, verbatim   // the poster stays in the record (`by`); only the prompts hide who is who
  });
  const amended = new Map();
  for (const o of objs.values()) if (!o.from_exchange && o.original_problem && o.status !== 'withdrawn') amended.set(o.key, (amended.get(o.key) || new Map()).set(o.id, o.problem));
  return { raised, rows, rounds: roundsRun, ...(attached.length ? { attached } : {}), ...(ending ? { late: lateAll } : {}), ...(proposedAll.length ? { proposed: proposedAll } : {}), ...(short ? { signoffs: signoffsAll } : {}), ...(stopFired ? { safety_stop: true } : {}), finalPosts: new Map([...objs.values()].map(o => [o.id, o.posts.filter(p => p.round > o.text_round)])), withdrawn: new Set(rows.filter(r => r.outcome === 'withdrawn_argued').map(r => r.id)), amended };
}

export async function runChain(args) {
  // `snap.fn(err)` is set by the running chain (runChainStages, or runDescendingChain for a
  // descending chain) and returns its state so far. A nested runChain (descending mode's two
  // sub-runs) attaches its own first; the outer one then reads err.partial and replaces it.
  const snap = { fn: null };
  // The gate's expected sizes come from this chain's own `estimate` block (see callEstimate); the parent's is put back when a nested run returns. Not an object = none set: the defaults (DEFAULT_ESTIMATE) apply, as in the dry run.
  const outerEstimate = callEstimate;
  const estimate = args?.config?.estimate;
  callEstimate = estimate && typeof estimate === 'object' && !Array.isArray(estimate) ? estimate : {};
  const idsBefore = snapshotIds();   // 0.8.4 S2: the id registry (the list criteria and the assigned ids) is per run; a nested run puts its parent's back
  const outerExcerptReader = excerptReader; excerptReader = null;   // 0.8.4 D38: a nested run (descending mode) shows no excerpt; its parent's reader is put back
  try {
    return await runChainStages(args, snap);
  } catch (err) {
    if ((err instanceof BudgetExceeded || err instanceof RoundStopped || err instanceof PriceRefused || err instanceof ConflictAsked) && snap.fn) {
      try { err.partial = snap.fn(err); } catch { /* keep whatever an inner run attached */ }
    }
    // 0.8.4 D18 (not in invoke(): no money read): the numbered text requests of the round ride on the pause of the stage the handling session answers (and on its siblings), for the command to write.
    if (err instanceof ExternalPause && snap.textRequestsFor) for (const p of pendingPauses(err)) { const t = snap.textRequestsFor(p.label); if (t) p.textRequests = t; }
    throw err;
  } finally {
    callEstimate = outerEstimate;
    excerptReader = outerExcerptReader;
    restoreIds(idsBefore);
  }
}

/** The limit a stop reached, in the words the run log already uses when a person finishes at it. One source for the finish log line, the dispute stage's stop reason and the dissent block (C-005). */
function limitReachedWords(stop) {
  if (stop.kind === 'secret_pause') return `the run was paused at a credential-shaped string in stage "${stop.label}"`;
  if (stop.kind === 'budget_stop') return `the spending limit${stop.cap_name ? ` (the ${stop.cap_name} cap)` : ''} was reached at stage "${stop.label}", before its next call was paid for`;   // 0.8.4 S16 (F; WORDING S16-w61)
  if (stop.kind === 'owner_pause') return `the run was paused on request before pass ${stop.pass}`;   // 0.8.4 (ladder unit, A-DRAFT LAD-O3)
  if (stop.kind === 'stall_stop') { const n = Array.isArray(stop.stalled) && stop.stalled.length ? stop.stalled.length : 1; return `${n === 1 ? 'an objection stood' : `${n} objections stood`} unchanged and could not be passed up`; }   // 0.8.4 S5 (A-DRAFT)
  return stop.kind === 'overseer_cap' ? 'the overseer-round limit was reached' : `layer ${stop.layer} reached its limit`;
}
/** 0.8.4 S16 (E; Muad 09 Nov 2026 "keep stopping"): the chain whose every seat is a mock seat runs the whole pipeline offline for $0 and needs no handling session. The ONE source of that test: chain-lint's rule 1f and the end of a run with no handling session (below) both read it. */
export const isOfflineMockChain = config => everySeatOf(config).filter(Boolean).every(s => s.provider === 'mock');
/** 0.8.4 S16 (E, T21aq T21ay T21bf T21bg; FEATURE_SPECS route 5): a run with NO handling session that is not the offline mock chain has nobody to choose at a stop. Two stops end it instead: the overseer-round limit when it is not the hard stop (isHardStop), and a silent seat of a layer below the top layer. Everything else stops as before. */
export const endsAtStopWithoutHandler = (config, stop, topLayer) => !hasHandlingSession(config) && !isOfflineMockChain(config)
  && ((stop?.kind === 'overseer_cap' && !isPersonStop(stop)) || (stop?.kind === 'layer_bound' && stop.why === 'unheard' && Number.isInteger(stop.layer) && Number.isInteger(topLayer) && stop.layer < topLayer));
/** WORDING S16-w70: the ending exchange's trigger (report.json ending_exchange.trigger) and the words of its log line. A rule ending is its own value: the exchange record, stop.chosen and dispute.reason all say rule. */
export const exchangeTriggerOf = finishedStop => (finishedStop?.chosen === 'rule' ? 'rule' : finishedStop ? 'finish' : 'round_cap');
export const exchangeTriggerWords = trigger => (trigger === 'rule' ? 'ended at the stop because the run has no handling session' : trigger === 'finish' ? "finished at the person's choice" : 'round cap');
/** WORDING S16-w65b: the cause of an ending at a stop with no handling session. */
export const ruleStopWords = (stop, silentLabs = []) => (stop?.kind === 'overseer_cap' ? 'the overseer-round limit was reached' : `a seat of layer ${stop?.layer}${silentLabs.length ? ` (${silentLabs.join(', ')})` : ''} gave no usable reply after its re-asks`);   // WORDING S16-w65d
async function runChainStages({ request: requestIn, config, draft: initialDraft = null, log = console.log, onStage = () => {}, runId = null, treeMember = false, roundChoices = [], ladder: ladderSetting = undefined, ladderRounds = null, ladderSteps = [], rulings = [], retags = [], earlierPlan = null, excerpts = [] }, snap) {
  // 7.x single-vendor mode: resolved once, before either chain shape runs, so descending mode
  // and the normal stage flow both see vendor-routed seats without duplicating the call.
  config = resolveChainSeats(config);
  scanPhase = 'before';           // 0.8.4 pause: set to 'loop' / 'after' around the two pass loops
  resetAssignedIds();             // 0.8.4 S2: the ids the assigner gave in an earlier run in this process are not this run's
  registerSeatKeys(config);       // lab-identity unit: a model repeated on different layers of a layered critics panel gets its seat key before any stage label is built
  // No denied model (xAI/Grok, or a router that could reach it) is ever seated -
  // checked on the resolved roster, before any stage runs. See src/denied-models.js.
  assertNoDeniedModels(config);
  if ('signoff' in config && config.signoff !== undefined && !SIGNOFF_MODES.includes(config.signoff)) {
    throw new Error(`unknown signoff ${JSON.stringify(config.signoff)}: this harness runs ${SIGNOFF_MODES.map(m => `"${m}"`).join(' or ')} only, and will not quietly run a different mode than the chain names.`);
  }
  proposalCapOf(config); // refuses a chain that sets the cap under both spellings with different values, before any stage
  const shared = duplicateLabSlots(config);
  if (shared.length) {
    throw new Error(`two seats share a lab, so they would share one stage label and one cached reply: ${shared.map(d => `seats.${d.slot} (${d.labs.join(', ')})`).join('; ')}. Give each seat its own "lab".`);
  }
  // 0.8.3 E2b: the same refusals as the lint (src/layers.js), so a chain that reaches runChain without going through the CLI's lint gate (a direct import, a test) is refused too and never runs flat.
  // 0.8.4: the advice add-on is removed, so a chain that still carries an `advise` block is refused here too, whoever calls runChain (the CLI, its side runs, a direct import): it would otherwise run as a plain paid panel.
  if (config.advise !== undefined) throw new Error(`${config.name ? `the chain "${config.name}"` : 'this chain'} has an "advise" block: the advice add-on was removed in 0.8.4, so the chain cannot run. Nothing was sent and nothing was spent.`);
  const layerFindings = layerProblems(config, config.name ? `the chain "${config.name}"` : 'this chain');
  if (layerFindings.length) throw new Error(`${layerFindings[0].message} ${layerFindings[0].fix}`);
  assertEndingPrompts(config);   // 0.8.4 S4b (C&C's item 2): the last round's prompts of the ending exchange, built once here, before the first paid call (W26 recorded and a layered chain; otherwise nothing)
  assertCacheOrder(config);   // 0.8.4 cache part (b)1 (src/cache-order.js): where the cache-shaped order is live, every call kind's system texts are composed once here, before the first paid call; nothing is built where it is not live
  if (config.descending) return runDescendingChain({ request: requestIn, config, log, onStage, snap, earlierPlan });

  const stages = [];
  // 0.8.4 D9/D38: the excerpts of this run as the CLI read them from excerpts.jsonl (this file does no file I/O). An entry is shown in every seat call from the stage AFTER the stage its `answered_stage` names (the stage whose answer carried it;
  // plan A T5.1 "from the next stage on"). The block is ONE cumulative text; invoke() places it (src/excerpt-slot.js, option I) by asking the reader set below. A stage that replays from the cache passes through record() like a live one, so a
  // resume reaches the same set at the same point. Held words: while `excerptsBlock` is not recorded the block is '' and no text changes. A sub-run gets no `excerpts` (runChain() puts the reader aside for nested runs).
  const recordedLabels = new Set();
  let excerptBlockShown = '';
  let excerptsVisible = [];   // the entries behind the block now shown (empty while the block's words are not recorded)
  const showExcerptsAfter = label => {
    if (!excerpts.length || typeof label !== 'string') return;
    recordedLabels.add(label);
    const nowVisible = excerpts.filter(e => recordedLabels.has(e.answered_stage));
    const next = excerptBlockFor(nowVisible);
    if (next === excerptBlockShown) return;
    excerptBlockShown = next;
    excerptsVisible = next === '' ? [] : nowVisible;
  };
  // 0.8.4 D41: what the quote check may compare a quote with besides the fenced source: the excerpts the seats were shown, and only when the in_excerpt label's words are recorded too (WORDING D41-w1); a status the prompts could not word is never assigned.
  const excerptsForQuotes = () => (typeof held('inExcerptLabel') === 'function' ? excerptsVisible : []);
  // the same label for a failure list that goes into a prompt without the unanimous panel's own transform (the first-mode reviser): `in_excerpt` is never printed raw.
  const inExcerptShown = fs => { const exLabel = held('inExcerptLabel'); return typeof exLabel === 'function' ? fs.map(f => { if (f?.quote_status !== 'in_excerpt') return f; const { excerpt_id: xid, ...keep } = f; return { ...keep, quote_status: exLabel({ excerpt_id: xid }) }; }) : fs; };
  const record = s => { stages.push(s); onStage(s); showExcerptsAfter(s?.label); return s; };
  // 0.8.4 D18 (plan A T5.1): the text requests the judges wrote in their verdicts this run, by pass. The pause of the revise stage of that pass carries them, numbered; the numbers are the ones the handling session's answers cite.
  // Derived from the verdicts (which replay from the cache), so a resume rebuilds the same list in the same order.
  const textRequestsByRound = new Map();
  const collectTextRequests = (round, voting) => {
    if (!textRequestsOpen || typeof held('textRequestsJudgeField') !== 'function') return;
    const list = [];
    for (const v of voting) {
      if (v.carried || v.abstained || !v.critique || v.critique.unreadable === true || v.critique.text_requests === undefined) continue;   // an unreadable or abstained verdict lists nothing
      const key = seatKeyOf(v.seat);
      const { requests, dropped } = readTextRequests(v.critique.text_requests, { ownIds: (v.critique.failures || []).map(f => objectionId(key, f)) });
      for (const d of dropped) { log(`  text request of ${key} ignored: ${d}.`); cache.note?.(`text_request_dropped: ${key} asked for text of the project and the request was ignored: ${d}`); }   // WORDING D18-w8: the record must show that a seat asked (WARNINGS.md)
      list.push(...requests.map(r => ({ ...r, requested_by: key, origin: v.stage || `panel-${round}-${key}` })));   // origin: the label of the reply that carried it (C&C 09 Nov 2026)
    }
    if (list.length) textRequestsByRound.set(round, list); else textRequestsByRound.delete(round);
  };
  // The notices a requesting seat reads in its next prompt: the first pass after the answered stage in which that seat is asked shows them (the later calls of that same pass too, so a retry reads what the first ask read); the
  // pass is remembered per line, and a replay builds the same calls in the same order, so it reaches the same pass. A call-site suffix keyed on the seat, like answerBackNote: no label is parsed.
  const noticePass = new Map();
  const excerptNoticeNote = (seat, round, kind = 'judge') => {   // a notice is routed by the request's ORIGIN (the reply that carried it): a judge reads those from a verdict, the proposer return those from a debate reply (a judge and a proposer may share a seat key, and both kinds can be answered at one pause)
    const out = [];
    for (const n of noticeLines(excerpts, seatKeyOf(seat), e => (kind === 'proposer') === /^debate-/.test(e.origin ?? '') && recordedLabels.has(e.answered_stage))) {
      const first = noticePass.get(n.id);
      if (first === undefined) noticePass.set(n.id, round);
      if (first === undefined || first === round) out.push(n.line);
    }
    return out.length ? `\n\n${out.join('\n')}` : '';
  };
  // The proposers' requests (their debate-stage reply carries text_requests): one list per run, in the order of the labs, answered at the BUILD pause, which exists only when the builder is an external seat. Collected whenever excerpts may be
  // shown (the sentence is in every proposer's debate prompt then); when the builder is not external nothing answers them and the end of the run records each unanswered (answered_stage null).
  const proposerRequestsBy = new Map();
  const collectProposerRequests = (lab, raw, origin) => {
    if (!proposerRequestsOpen || typeof held('textRequestsProposerField') !== 'function' || raw === undefined) return;
    const { requests, dropped } = readTextRequests(raw, { ownIds: [] });
    for (const d of dropped) { log(`  text request of ${lab} ignored: ${d}.`); cache.note?.(`text_request_dropped: ${lab} asked for text of the project and the request was ignored: ${d}`); }   // WORDING D18-w8
    if (requests.length) proposerRequestsBy.set(lab, requests.map(r => ({ ...r, objection_id: null, requested_by: lab, origin }))); else proposerRequestsBy.delete(lab);
  };
  const proposerRequestList = () => [...proposerRequestsBy.keys()].sort().flatMap(k => proposerRequestsBy.get(k));   // a fixed order (the labs' keys), never the order the parallel debate calls finished in
  // The proposers' requests no pause has carried yet: those of a debate reply (its ORIGIN) with no line in the record. One pause lists every request of a reply and the resume records every listed one, answered or not, so the origin
  // alone decides it; a paste that overrode the path or lines changes the recorded line but not that. Rebuilt the same at every resume, so the numbers hold.
  const proposerRequestsToCarry = () => { const carried = new Set(excerpts.filter(e => e.request_kind === 'seat_request').map(e => e.origin)); return proposerRequestList().filter(r => !carried.has(r.origin)); };
  // The requests no later pause answered: a pass's judge requests when no revise stage of that pass was recorded (every judge signed off, the round cap), and the proposers' that no pause carried. The command records each
  // unanswered with answered_stage null at the run's end (WORDING D18-w6); a request that already has a line is not written again.
  const textRequestsLeft = () => [
    ...proposerRequestsToCarry(),
    ...[...textRequestsByRound.entries()].filter(([round]) => !recordedLabels.has(`revise-${round}`) && !recordedLabels.has(`revise-${round}-full`)).flatMap(([, list]) => list),
  ];
  // The list a pause carries, numbered. BUILD (an external builder): the proposers' requests. A REVISE pause: the proposers' not yet carried (when the builder is not external, so this is the first pause that comes), then the
  // requests of the judges of that pass. Both kinds ride one list, so the numbers the answers cite are one sequence.
  if (snap) snap.textRequestsFor = label => {
    const builderExternal = config.seats?.builder?.provider === 'external';
    if (label === 'build') { const l = builderExternal ? proposerRequestsToCarry() : []; return l.length ? numberRequests(l) : null; }
    const m = /^revise-(\d+)(?:-|$)/.exec(String(label)); if (!m) return null;
    const carried = new Set(excerpts.filter(e => e.request_kind === 'seat_request').map(e => e.origin));   // a reply whose requests are on file is not listed again: a revise-N-full pause follows a revise-N the session already answered
    const list = [...(builderExternal ? [] : proposerRequestsToCarry()), ...(textRequestsByRound.get(Number(m[1])) || []).filter(r => !carried.has(r.origin ?? null))];
    return list.length ? numberRequests(list) : null;
  };
  if (excerpts.length) setExcerptReader(label => (isNotASeat(label) ? '' : excerptBlockShown));   // a harness utility is excluded by name (src/excerpt-slot.js NOT_A_SEAT), never by a text search
  // report-partial.json (see partialDefaults above): the run so far, read only when the spend cap
  // stops it. A local the run never reached is still in its temporal dead zone, so `peek` reads it
  // as the fallback that means "that stage did not run"; this is safe to call from any point.
  snap.fn = () => {
    const peek = (read, fallback) => { try { return read() ?? fallback; } catch { return fallback; } };
    const props = peek(() => proposals, []);
    const plan = peek(() => draft, null);
    const ledger = props.length ? peek(() => withdrawalLedger(props), null) : null;
    const optional = {
      noHeardReviewer: peek(() => noHeardReviewer, null) || undefined,
      layers: peek(() => (layered ? layersRecordOut() : undefined), undefined),
      decisions: peek(() => (decisions.length ? decisions : undefined), undefined),
      escalations: peek(() => (escalations.length ? escalationsRecord() : undefined), undefined),   // stall escalation: a stopped run's record says which open ids were passed up, overruled or sustained
      overseer_rounds: peek(() => (ovOn ? ovCompleted : undefined), undefined),
      reviewNotes: peek(() => (notesOn ? notesBlock() : undefined), undefined), // notes lane: a stopped run keeps the items its judges gave
      layerStop: peek(() => layerStop, null) || undefined,
      notQuorate: peek(() => notQuorate, null) || undefined,
      ground_truth: peek(() => ground_truth, undefined),
      canary: peek(() => canary, undefined),
      lints: peek(() => lints, undefined),
      scopeLedger: peek(() => (scopeLedger ? scopeLedgerFile(scopeLedger) : undefined), undefined),
      claims: peek(() => claims, undefined),
      security_review: peek(() => security_review, undefined),
      dispute: peek(() => dispute, undefined),
      coldRead: peek(() => coldRead, undefined),
      alternatives: peek(() => alternatives, undefined),
      deep_dive: peek(() => deepDive, undefined),
      quoteFindings: peek(() => fencedSource || quoteFindings.length, null) ? peek(() => quoteFindings, undefined) : undefined,
      patchFallbacks: config.revise?.mode === 'patch' ? peek(() => patchFallbacks, undefined) : undefined,
    };
    const crit = peek(() => criteria, []);
    return {
      ...partialDefaults(),
      criteria: crit,
      questions: peek(() => questions, null),
      proposals: props,
      proposalPool: peek(() => proposalPool, []),
      dropouts: peek(() => dropouts, []),
      board: peek(() => board, null),
      debate: peek(() => debate, null),
      currentDraft: typeof plan === 'string' ? plan : null,   // the plan as it stands (a round stop writes it to deliverable-partial.md; no report shape reads this key)
      scoreboard: props.length && plan ? peek(() => scoreProposals(props, plan, scoreText()), null) : null,
      passed: peek(() => passed, false),
      lastCritique: peek(() => shownCritique(lastCritique), null),
      severityRun: peek(() => bareLabsOfSeverity(sevRun?.snapshot()), undefined),
      severityAsked: peek(() => (sevRun ? severityOn : undefined), undefined),
      signoff: peek(() => signoff, null),
      challenge: peek(() => challenge, null),
      allocator: config.allocator?.enabled ? peek(() => ({
        targetedRounds: allocatorRounds,
        engagedCount: allocatorRounds.filter(r => r.engaged).length,
        rubberStampCount: allocatorRounds.filter(r => !r.engaged).length,
      }), null) : null,
      disputes: peek(() => disputes, []),
      regressions: peek(() => regressions, []),
      panelVerdicts: peek(() => panelVerdicts, []),
      missingCriteria: peek(() => missingCriteria, []),
      signoffTableGaps: peek(() => signoffTableGaps, []),
      debateOrders: peek(() => debateOrders, []),
      answerBack: peek(() => answerBackRecords.map(shownFailure), []),
      answerBackReplies: peek(() => answerBackReplies.map(shownFailure), []),
      layerDebates: peek(() => layerDebates, []),
      proposerReturns: peek(() => proposerReturns, []),   // 0.8.4 S9: what a pause or a stop shows of the returns so far
      outsideCriteriaRows: peek(() => outsideCriteriaRowList, []),
      criteriaLints: peek(() => criteriaLints, []),
      history: peek(() => history, []),
      stages,
      totals: summarise(stages),
      orphanSections: ledger?.orphanSections ?? [],
      withdrawalCycles: ledger?.withdrawalCycles ?? 0,
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
      // Through peek like everything else: kindsOn is declared with the criteria stage, so a cap
      // stop at the ambiguity or questions stage read it in its temporal dead zone, the throw was
      // swallowed by runChain, and no report-partial.json was written (bug audit 2026-09-26 #5).
      ...(peek(() => kindsOn, false) ? peek(() => ({
        criteriaKinds: kindsRecord(crit, criteriaKinds),
        criteriaSummary: criteriaSummary(crit, criteriaKinds, { metWithoutEvidence }),
        metWithoutEvidence,
      }), {}) : {}),
    };
  };
  // Every stage whose reply becomes (part of) the deliverable goes through here: a reply cut off at
  // its cap is retried once with a bigger one (cutOffRetryCap, the panel's rule), under its own
  // stable `<label>-retry` label, and if that is cut off too - or the seat is external and cannot be
  // retried - the run stops (DraftTruncated) rather than carry the fragment forward.
  // Bug audit 2026-09-28 (area 2 #2): a debate post or reply round the provider ended with stop
  // "error" (or content_filter / refusal) was recorded as "did not parse" and not retried, so a
  // 2.5-second transient error cost a lab its whole reply round (plan-daily-7's first real run,
  // gemini). One retry at the same cap, under `<label>-retry`; the caller records `provider_error`
  // if that one is incomplete too.
  const onceMoreIfIncomplete = async (st, seat, opts, say) => {
    if (!draftIncomplete(st.usage)) return st;
    skipChosen(seat, [opts.label]);   // CR-1B-002: a skip recorded at the retry's refusal starts here, after the first (paid) call replayed
    say(`  ${opts.label.replace(/-retry$/, '')}: the provider ended the reply with stop "${st.usage.stop}" - retrying once.`);
    return record(await invoke(seat, opts));
  };
  const draftStage = async (seat, opts) => {
    const cap = seat.maxTokens ?? DEFAULT_MAX_TOKENS;
    const first = record(await invoke(seat, opts));
    if (draftIncomplete(first.usage)) {
      if (seat.provider === 'external') {
        throw new DraftTruncated(opts.label, `the external reply reports stop "${first.usage.stop}" - write a complete reply to ${opts.label}.md and resume`, first.usage.stop);
      }
      log(`  ${opts.label}: the provider ended the reply with stop "${first.usage.stop}" - retrying once at the same ${cap}-token cap.`);
      const again = record(await invoke(seat, { ...opts, label: `${opts.label}-retry` }));
      if (draftIncomplete(again.usage)) {
        throw new DraftTruncated(opts.label, `stop "${first.usage.stop}", and "${again.usage.stop}" again on the retry`, again.usage.stop);
      }
      if (draftCutOff(again.usage, askedCapOf(again, cap))) throw new DraftTruncated(opts.label, `stop "${first.usage.stop}", then cut off at ${cap} tokens on the retry`);
      return again;
    }
    // `from`: the cap the reply in hand was asked at. An Anthropic seat's invoke() may already have retried at the bigger cap (0.8.1), so the
    // draft's own retry starts from there and is skipped when there is no room, instead of repeating the same paid call.
    const from = first.cappedAt ?? cap;
    if (!draftCutOff(first.usage, from)) return first;
    const bigger = cutOffRetryCap(from, retryCeilingOf(seat));
    if (seat.provider === 'external' || bigger <= from) {
      throw new DraftTruncated(opts.label, seat.provider === 'external'
        ? `the external reply reports stop "${first.usage?.stop}" - write a complete reply to ${opts.label}.md and resume`
        : `it already had the largest retry cap (${from} tokens)`);
    }
    log(`  ${opts.label}: cut off at ${from} tokens - retrying once with ${bigger}.`);
    const second = record(await invoke(keepSeatKey(seat, { ...seat, maxTokens: bigger }), { ...opts, label: `${opts.label}-retry` }));
    if (draftCutOff(second.usage, bigger)) {
      throw new DraftTruncated(opts.label, `cut off at ${from} tokens, and again at ${bigger} on the retry`);
    }
    return second;
  };
  let request = requestIn;

  // The fenced source a human put in the task (src/fence.js), read once before any stage runs
  // because the criteria stage already needs to know whether the quote rule is honest to state.
  // Empty when the task carries none, which disables quote validation rather than faking it.
  const fencedSource = fencedSourceOf(request);
  // 0.8.4 A7: can any seat of this run ever be shown an excerpt? Decided once, here (run-stable: see src/excerpt-channel.js); it only has an effect once the A7 words are recorded.
  const excerptsMayBeShown = excerptsMayBeShownFor(config, everySeatOf);
  // C&C 09 Nov 2026: ONE gate for both seat kinds, "a session pause follows the stage that carries the request" (and the channel is usable in this run). A judge's requests ride the revise pause (an external reviser, else builder);
  // a proposer's the FIRST pause that comes: the build pause when the builder is external, else the first revise pause.
  const proposerRequestsOpen = excerptChannelUsable(config) && (config.seats?.builder?.provider === 'external' || hasHandlingSession(config));
  const textRequestsOpen = excerptsMayBeShown && hasHandlingSession(config);   // D18: requests reach the session only at the revise pause, which exists only when the reviser (else the builder) is an external seat
  const quoteFindings = [];
  // Patch-mode bookkeeping (src/patch-revise.js). `lastPatches` feeds the critics' "Changed
  // since your last review" section; `patchFallbacks` records every round the edits did not
  // apply, which is the only real-model evidence this feature can produce.
  let lastPatches = null;
  const patchFallbacks = [];

  // v7 item 1: tool-grounded verification, gated on config.verify.enabled.
  // Absent/false key: skip entirely, `ground_truth` stays undefined and is
  // therefore never added to the returned result - v6 behaviour unchanged.
  let ground_truth;
  if (config.verify?.enabled) {
    log('\nStage: verification (ground truth from sandboxed tools)');
    ground_truth = runVerification(config, { runTool: config.verify.runTool, log });
    request += renderGroundTruth(ground_truth);
  }

  // 0a. Ambiguity union (config.ambiguity_union.enabled, item 5). Absent or
  // false: skipped entirely, request is untouched, and the questions/criteria
  // stages' input is unchanged from today. Three cheap seats each list the
  // ambiguities they see in the raw request before any proposal exists; the
  // union is appended to `request`, which every later stage already reads,
  // so this costs no new plumbing beyond the stage itself.
  let ambiguities = null;
  if (config.ambiguity_union?.enabled && !initialDraft) {
    const seats = config.seats.ambiguity || (config.seats.critics || []).slice(0, 3);
    log(`\nStage: ambiguity union (${seats.length} seat(s) list ambiguities before any proposal exists)`);
    const results = await settleAll(seats.map(async seat => {
      const lines = []; const say = m => lines.push(m);
      let list = [];
      try {
        const res = record(await invoke(seat, {
          system: R.AMBIGUITY_SYSTEM,
          user: R.ambiguityUser({ request }),
          log: say, label: `ambiguity-${seatKeyOf(seat)}`,
        }));
        const parsed = parseJson(res.text);
        list = Array.isArray(parsed?.ambiguities) ? parsed.ambiguities.filter(a => typeof a === 'string' && a.trim()) : [];
        say(`  ${shownSeat(seat)}/${seat.model}: ${list.length} ambiguit${list.length === 1 ? 'y' : 'ies'}.`);
      } catch (err) {
        rethrowControlFlow(err);
        say(`  ${shownSeat(seat)}/${seat.model}: no ambiguity reply (${String(err.message).slice(0, 100)}).`);
      }
      return { lines, list };
    }));
    for (const r of results) r.lines.forEach(m => log(m));
    ambiguities = unionAmbiguities(results.map(r => r.list));
    log(`  union: ${ambiguities.length} unique ambiguit${ambiguities.length === 1 ? 'y' : 'ies'} after dedup.`);
    if (ambiguities.length) request += R.ambiguitiesSection(ambiguities);
  }

  // v7.x item 3: seat-requested bounded tool calls (src/tools.js). Gated on
  // config.tools.seat_requests.enabled PLUS config.verify.tools (the v7 item 1 allowlist itself,
  // unchanged) - a seat can only request a tool already on that allowlist, and only when
  // config-time tool grounding is itself configured. Absent either key: `toolRequestWarnings`
  // stays undefined and is never added to the returned result, and no seat can request a tool
  // mid-stage - v7's config-time-only tool behaviour is unchanged byte-for-byte.
  let toolRequestWarnings;
  if (config.tools?.seat_requests?.enabled && config.verify?.enabled && Array.isArray(config.verify?.tools)) {
    toolRequestWarnings = [];
  }

  // v7.x item 4: canary objections (src/canary.js). Stays `null` (not undefined) whenever
  // config.canary is absent/false so `'canary' in result` reads the same either way this run
  // went - absent-key and "gated but not sampled this run" are both "nothing to report", exactly
  // the always-present-field posture `challenge`/`allocator` already use above.
  let canary = config.canary?.enabled ? { injected: false } : undefined;

  // 0. Questions first (config.questions: { max, wait }). The answers become
  //    part of the request before criteria are written, so the checklist is
  //    written against the resolved request, not the ambiguous one.
  let questions = null;
  if (config.questions && !initialDraft) {
    const max = config.questions.max ?? 6;
    log('\nStage: questions (what would change the plan?)');
    const qs = record(await invoke(config.seats.questions || config.seats.criteria, {
      system: R.QUESTIONS_SYSTEM,
      user: R.questionsUser({ request, max }),
      log, label: 'questions',
    }));
    const parsed = parseJson(qs.text);
    questions = Array.isArray(parsed?.questions) ? parsed.questions.slice(0, max).filter(q => q && q.question) : [];
    if (!questions.length) log('  no usable questions returned; continuing without.');
    else {
      questions.forEach((q, i) => log(`  ${i + 1}. ${q.question}\n     default: ${q.default}`));
      const answersSystem = 'Answer the planner\'s questions. Write plain text: one numbered answer per question, in the same order. An answer may be "default" to take the planner\'s own default. Anything else you want the plan to know may follow the numbered answers.';
      const answersUser = `# The request\n\n${request}\n\n# The questions\n\n${R.renderQuestions(questions)}`;
      let answered = cache.get('answers');
      // Bug audit 2026-09-28 (external seats #3): the answers were replayed with no staleness check,
      // so after a task amendment the old answers were matched, by position, to the new questions.
      // Checked like every other external stage (invoke()): a different prompt, or a changed task or
      // chain, sets the old answers aside and asks again.
      if (answered) {
        const verdict = cacheVerdict(answered, promptHashOf(answersSystem, answersUser));
        // 0.8.4 T14 (his word: the run continues): answers given under the earlier wording of THEIR prompt are kept like any stage, when nothing before them changed.
        if (verdict.status === 'stale' && !(verdict.cause === 'prompt' && keepsEarlierWording('answers', answered, log, { direct: true }))) {
          cache.invalidate?.('answers', verdict.why);
          log(`  CACHE STALENESS WARNING: stage "answers" - ${verdict.why}; the old answers were set aside and the operator is asked again.`);
          answered = null;
          wordingLedger?.note({ label: 'answers', live: true });   // 0.8.4 T14: set aside, the run pauses for a new answer; that answer, read in a later sitting, is a changed upstream for every cached stage after it
        } else if (verdict.status === 'unverified') {
          cache.warn?.('answers', verdict.why);
          log(`  CACHE: stage "answers" replayed UNVERIFIED - ${verdict.why}. Recorded in WARNINGS.md and report.json.`);
        }
      }
      if (answered) {
        // 0.8.4 T14: read outside invoke(), so it reaches no write-back; its record is the pause's `answers.prompt.json` (the sitting and version that ASKED, merged into the hit by the cache getter), which is what the ledger reads. An answer with no such record (asked before this version) is unstamped: fail closed.
        if (wordingLedger) { const st = stampOfHit(answered, answered.text); wordingLedger.note({ label: 'answers', writtenBy: st.writtenBy, textOk: st.textOk, live: false }); cache.stampUse?.('answers', answered.text); }
        log(`  answers: from disk (${answered.text.split(/\s+/).length} words)`);
        request += R.answersSection(questions, answered.text);
        showExcerptsAfter('answers');   // this stage is read outside invoke(), so record() never sees it
      } else if (config.questions.wait === false) {
        log('  wait: false - defaults taken for every question.');
        request += R.answersSection(questions, '');
      } else {
        scanned('answers', { system: answersSystem, user: answersUser });
        throw new ExternalPause('answers', answersSystem, answersUser);
      }
    }
  }

  // Round semantics 2b: for a chain with maxOverseerRounds the pass limit is the DERIVED ceiling (the most advance() allows), never a second key; any other chain keeps maxRounds ?? 2.
  const limits = effectiveLimits(config, roundChoices); // the chain file's limits plus the person's recorded choices at earlier stops (round semantics 2b-ii); the choices are NOT part of the config, so the stage cache fingerprint is unchanged
  let maxRounds = limits.passes ?? Infinity;   // set again below for a ladder run: it has NO derived pass ceiling, only a pass bound the chain's author wrote (`maxRounds`)
  const stopOnPass = config.stopOnPass !== false;
  const { open } = settingsOf(config);
  // Decision records (src/roles.js, DECISIONS_RULE_*): opt-in via `decisions.enabled`, and implied by
  // the `alternatives` stage, whose losing architectures are recorded in the same "Decisions"
  // section. Absent both, every prompt that takes these options is byte-identical to before.
  const { promptOpts: promptOptsBase } = settingsOf(config);
  const promptOpts = excerptsMayBeShown ? { ...promptOptsBase, excerptsMayBeShown: true } : promptOptsBase;   // the reviser and criteria systems read the flag from here
  // 0.8.3 M3 (PLAN 5.1, 5.2): a run that is a MEMBER of a recursive-councils tree (the CLI started it with a lineage) is asked for the split block in its plan, and its handoff seat to reproduce it. Those words are held
  // (src/held-roles.js; drafted in test/held-prompts/held.js, recorded by the one 0.8.3 re-record, M7): while `held(name)` is undefined nothing is added, so every prompt of every run is byte-identical to what it
  // always was (the stage cache keys on it), and a run that is not a tree member never asks.
  const withSplitNote = (system, name) => splitNoteOf(treeMember, system, name);
  // Tiered councils: the majority guard. Off (absent) in every chain written before it existed, so
  // those runs keep today's reply prompts byte for byte.
  const { guard } = settingsOf(config);
  // Criterion kinds (src/criteria-kinds.js): opt-in via `criteria_kinds.enabled`. Absent, no prompt
  // changes, no kinds are recorded, and the result carries no criteria_kinds/criteria_summary key.
  const kindsOn = config.criteria_kinds?.enabled === true;
  let criteriaKinds = null;
  // Every criteria list this run takes - a seat's reply, a retry's, a hand-written one - goes
  // through here, so the guards below always see plain strings and kinds stay index-aligned.
  const takeCriteria = raw => {
    if (!Array.isArray(raw)) return raw;
    const n = normaliseCriteria(raw);
    criteriaKinds = kindsOn ? (n.kinds || n.texts.map(() => ({ kind: null }))) : null;
    return n.texts;
  };
  const metWithoutEvidence = [];
  // A sign-off whose criteria table left criteria out (src/criteria-ledger.js): recorded, never acted on.
  const missingCriteria = [];
  // 0.8.2 (owner decision 1, 5 Oct 2026): with `signoff_table.required` a sign-off without a full per-criterion table (a row for every criterion, each with evidence) is an abstention, never
  // consent. The seat is re-asked alone (the existing re-ask loop, at most twice a round), the heard clean verdicts are carried, and the round cap still ends it. Off by default.
  const tableRequired = config.signoff_table?.required === true;
  const signoffTableGaps = [];
  // 0.8.2 (owner decision 2): what each debate reader saw, when debate_hygiene.shuffle is on (src/debate-order.js); [] otherwise.
  const debateOrders = [];
  // 0.8.2 (owner decision 3, ticket 10): with `answer_back.enabled` the harness builds, after each revise, what each judge will be shown about its own earlier objections (src/answer-back.js).
  // Data only until the owner's prompt list is approved: the summary is recorded in report.json and the full data is held in `answerBackLatest` (written after each revise; read by the prompt that will
  // render it, which does not exist yet). It is built before the allocator's extra revise, so its changed passages do not include those edits.
  const { answerBackOn } = settingsOf(config);
  const answerBackRecords = [];
  const answerBackReplies = [];
  const writerNotes = [];   // 0.8.4 S4 (Q-l, W34): per revise of a chain with answer_back, what the writer said it did with each objection that stood (src/writer-note.js); empty while the wording is held
  const layerDebates = [];   // B2: one row per exchange (report.json layerDebates[]); additive
  const proposerReturns = [];   // 0.8.4 S9 (Q10, D8, D29): one row per decision-level objection the harness acted on or refused (report.json proposer_returns); empty while the S9 words are held
  const returnedInOv = new Set();   // the overseer rounds whose return slot is used (one return per overseer round, RU-S9-01)
  const exchangeWithdrawals = new Map();   // B2: lab -> the objections that judge withdrew in its layer's exchange [{ id, criterion, reason, pass }], shown back to it in later passes
  const readoptedAt = new Map();   // 0.8.4 S6 (Q6, C&C: the later act counts): `${seat}\0${id}` -> the pass in which a sustain made the seat hold again an objection it had withdrawn in its layer's exchange: a withdrawal of that pass or an earlier one no longer closes it for the readers of withdrawnList
  const exchangeDebated = new Map();   // B2: draft id (hash of the text the judges saw) -> Map(objection id -> { outcome, item }): what was debated on THAT draft; rebuilt by the same code on a replay
  const seatLast = new Map();   // 0.8.4 S2: seat key -> [{ id, base, problemNorm }]: the objections of its last counted verdict (what still stands for it, Q12), set when a pass records its votes
  // The history the id assigner reads (only with W6 recorded): this seat's own standing and withdrawn ids, and every withdrawn objection of the run. All of it comes from records the run already keeps, so a replay rebuilds it.
  const failureOf = (lab, id) => { for (const o of [...openByRound].reverse()) { const f = o.failures.find(x => x.lab === lab && x.id === id); if (f) return f; } return null; };
  // Only what EARLIER passes recorded: a discarded first ask of this pass may have left rows of this pass, and a re-ask must read the same history as the first ask did (the reply's own withdrawals arrive as `withdrawnNow`).
  const withdrawnList = before => [
    ...[...exchangeWithdrawals].flatMap(([lab, list]) => list.filter(w => w.pass < before).map(w => ({ lab, id: w.id, criterion: w.criterion, problem: w.problem, quote: w.quote }))),
    ...answerBackReplies.filter(r => r.round < before && (r.effect === 'withdrawn' || r.effect === 'withdrawn_exchange') && !(readoptedAt.get(`${r.lab}\u0000${r.id}`) >= r.round)).map(r => { const f = failureOf(r.lab, r.id); return f ? { lab: r.lab, id: r.id, criterion: f.criterion, problem: f.problem, quote: f.quote } : { lab: r.lab, id: r.id }; }),
  ];
  // M1 S4 (Q12; T12g, T12n, NEW-A1-1, NEW-A1-2): the ids of ONE seat that are CLOSED on the record by something other than its own withdrawal, from EARLIER passes only: an upper layer's overrule (the objection rated below 4 and never 7 to 10), an upper layer's adoption (the
  // objection was sustained and the sustaining seat took it over), a re-tag that put it below 4 (never 7 to 10). All three come from records the run already keeps (escalations[] outcomes, the severity ledger's re-tags), so a replay rebuilds them. An objection rated 4 or above that an
  // upper layer overruled "still stands": it is not listed here, so `continues` works and no r2 is minted.
  const closedOnRecord = (key, before) => {
    const out = new Map();
    // 0.8.4 (SE-14, C&C ruling 12 Nov 2026, covered by his 11 Nov 18:56 words): an objection the HANDLING SESSION lowered below 4 stays lowered when a layer also ruled on it (an overrule) in a later pass: the entry keeps the handler's `by`, so the judge's later reopen is the same objection, still at the handler's rating, and counts as heard. The record keeps both the lowering (severity.retags) and the ruling.
    // 0.8.4 round 1, A3 (his answer 6:a, 12 Nov 2026): the TOP LAYER's lowering below 4 holds the same way when a layer-2 judge also overrules the objection: the entry keeps the lowerer's `by` ('handler', or 'layer3' once its pass has settled), so the raising judge's later reopen is the same objection at the lowered rating and counts as heard. The record keeps both the lowering and the ruling.
    const loweredBy = new Map((sevRun?.clearedByRetag(key) ?? []).filter(c => (c.by === 'handler' && c.pass <= before) || (c.by === 'layer3' && c.pass < before)).map(c => [c.id, c.by]));
    for (const e of rulingRows()) {
      if (!(e.pass < before)) continue;
      for (const o of e.outcome ?? []) {
        if ((o.seat ?? o.lab) !== key) continue;
        const f = failureOf(key, o.id); if (!f) continue;
        if (o.result === 'sustained') out.set(o.id, { f, state: 'adopted' });
        else if (o.result === 'overruled' && closedByRuling(o)) out.set(o.id, { f, state: 'overruled', ...(loweredBy.has(o.id) ? { by: loweredBy.get(o.id) } : {}) });
      }
    }
    for (const c of sevRun?.clearedByRetag(key) ?? []) {
      if (!(c.by === 'handler' ? c.pass <= before : c.pass < before) || out.has(c.id)) continue;   // the handler's re-tag takes effect at the top of its own pass, a layer-3 re-tag when its pass settles
      const f = failureOf(key, c.id); if (f) out.set(c.id, { f, state: 'cleared_retag', by: c.by });   // `by` stays in memory (the id assigner reads it); it is written nowhere
    }
    return out;
  };
  const ownHistory = (key, before) => {
    const own = new Map();
    for (const w of withdrawnList(before).filter(x => x.lab === key)) own.set(w.id, { base: baseObjectionId(key, w), problemNorm: normProblem(w.problem), state: 'withdrawn' });
    for (const [id, c] of closedOnRecord(key, before)) if (!own.has(id)) own.set(id, { base: baseObjectionId(key, c.f), problemNorm: normProblem(c.f.problem), state: c.state, ...((c.state === 'cleared_retag' || c.state === 'overruled') && (c.by === 'handler' || c.by === 'layer3') ? { by: c.by } : {}) });
    for (const o of seatLast.get(key) || []) if (!own.has(o.id)) own.set(o.id, { base: o.base, problemNorm: o.problemNorm, state: 'standing' });
    return own;
  };
  const withdrawnEverywhere = before => withdrawnList(before).filter(w => w.criterion).map(w => ({ id: w.id, lab: w.lab, criterion: w.criterion, quote: problemKey({ quote: w.quote }) }));
  const attachedQuotes = new Map();   // 0.8.4 S14: 'lab\u0000id' -> { quote, pass, from }: a quote attached to an unquoted objection in the exchange, folded from exchangeRound's result (so a resume rebuilds it from the cached replies); overlaid at the fold of the pass's failures, after the id
  const exchangeCarried = new Map();   // 0.8.4 S3 (Q1(g), T22aa): raiser seat key -> Map(objection id -> { criterion, problem, quote?, severity?, found_pass }): the objections an exchange did not reach (raised or amended in its last round), carried into the next pass's exchange. Built only from the exchange rows, so a replay rebuilds it.
  let layerExchangeNow = null;   // B2: the standing objections of this pass's exchange, for the reviser's note
  let answerBackLatest = {};
  let answerBackRound = 0; // the round the latest answer-back data is for (set at the revise, matched by the next round's reviews)
  // Table rows that name none of the criteria (ticket 16): recorded, never counted.
  const outsideCriteriaRowList = [];
  const noteMissingRows = (critique, round, lab) => {
    if (critique?.meets !== true) return;
    const m = missingCriteriaRows(critique, criteria);
    if (m) missingCriteria.push({ round, lab, ...m });
  };
  const noteUnevidenced = (critique, round, lab, say) => {
    for (const criterion of unevidencedCheckableMets(critique, criteria, criteriaKinds)) {
      metWithoutEvidence.push({ round, lab, criterion });
      say(`    !! MET with no evidence on a checkable criterion: ${criterion}`);
    }
  };
  if (open) log('scope: OPEN - every seat may add scope; additions are recorded, the verdict pass cuts');

  // 0. Preflight (config.preflight, v4 item 2). Absent config: never called, zero behaviour
  // change from v3. Reviews `request` text only - never a diff, never `propose` - so no critic
  // ever authors code. A blocking objection stops the run here, before criteria/proposals/build
  // ever run, the same "thrown, not returned" shape as BudgetExceeded/ExternalPause.
  let preflight;
  if (config.preflight && !initialDraft) {
    log('\nStage: preflight (task-description review only, never a diff)');
    preflight = await runPreflightStage(config, { request, invoke, record, log });
    const objected = preflight.verdicts.filter(v => v.verdict === 'object' && v.objections.length);
    for (const v of objected) log(`  ${v.lab}: OBJECT - ${v.objections.join(' / ')}`);
    if (preflight.blocked) {
      log(`  BLOCKED: ${objected.length} seat(s) objected to the task description before any proposal exists.`);
      throw new PreflightBlocked(preflight);
    }
    log(`  ${preflight.verdicts.length} seat(s), no blocking objection - proceeding to criteria.`);
  }

  // 1. Acceptance criteria. Written before the deliverable exists, so they
  //    describe the request rather than rationalising whatever got built.
  let criteria = takeCriteria(config.criteria);
  // Resume-cache audit #2: criteria handed in (a chain's fixed list, or --from-run's) skipped both
  // guards below, so a run could reuse criteria a guard had rejected. They hold here too; there is
  // no retry for a handed-in list, so a failing one stops before any paid review round.
  // Only the unambiguous signals stop the run: a handed-in list cannot be retried, and the looser
  // "several criteria mention criteria" signal, which is fine for asking a seat once more, would
  // block a legitimate list on a word. That one is reported instead.
  if (criteria && criteria.length) {
    const bad = metaCriteria(criteria, { shapeOnly: true }).length ? 'describe the criteria list itself, not the request'
      : infeasibleCriteria(criteria, { handoff: !!config.handoff, debate: !!config.debate }).length ? 'demand documents a single build stage cannot produce'
      : null;
    if (bad) throw new Error(`The criteria handed to this run ${bad}. Stopped before any paid review round.`);
    if (metaCriteria(criteria).length) log(`  !! some handed-in criteria read as being about the criteria list itself - check them (the run continues).`);
  }
  if (!criteria || criteria.length === 0) {
    log('\nStage: acceptance criteria');
    const s = record(await invoke(resolveCriteriaSeat(config), {
      system: criteriaSystemOf(open, !!fencedSource, promptOpts),
      user: criteriaUserPrompt(request, config),
      log, label: 'criteria',
    }));
    const parsed = parseJson(s.text, { strict: true }); // the criteria are the run's checker: a quoted example must never stand in for them (Astra's review, finding 3)
    criteria = takeCriteria(parsed?.criteria);
    if (!Array.isArray(criteria) || criteria.length === 0) {
      throw new Error('The criteria stage returned no usable criteria. Raw output kept in the run log.');
    }
    // 2026-09-22, Zofia run 2026-09-22T12-07-08-270Z: the criteria seat returned criteria for a
    // *criteria list* ("Is a JSON object with a 'criteria' key...") instead of for the request, and
    // the whole panel then failed a correct plan against them for three paid rounds. Retry once,
    // saying what went wrong; if the retry is meta too, stop before any paid review round.
    const infeasible = infeasibleCriteria(criteria, { handoff: !!config.handoff, debate: !!config.debate });
    if (infeasible.length) {
      // Same shape as the meta-criteria guard: one retry naming the problem, then stop rather than
      // pay a panel to fail a draft for not being three files at once.
      log(`  !! ${infeasible.length} criterion/criteria demand documents this stage cannot produce - asking once more.`);
      const again = record(await invoke(resolveCriteriaSeat(config), {
        system: criteriaSystemOf(open, !!fencedSource, promptOpts),
        user: `${criteriaUserPrompt(request, config)}\n\n${criteriaRetryNote('infeasible', infeasible[0])}`,
        log, label: 'criteria-feasibility-retry',
      }));
      const retried = takeCriteria(parseJson(again.text, { strict: true })?.criteria);
      if (!Array.isArray(retried) || retried.length === 0 || infeasibleCriteria(retried, { handoff: !!config.handoff, debate: !!config.debate }).length) {
        throw new Error('The criteria stage twice demanded documents a single build stage cannot produce. Stopped before any paid review round; see the run log.');
      }
      criteria = retried;
    }
    if (metaCriteria(criteria).length) {
      log(`  !! criteria describe the criteria list itself, not the request (${metaCriteria(criteria).length} of ${criteria.length}) - asking once more.`);
      const again = record(await invoke(resolveCriteriaSeat(config), {
        system: criteriaSystemOf(open, !!fencedSource, promptOpts),
        user: `${criteriaUserPrompt(request, config)}\n\n${criteriaRetryNote('meta', metaCriteria(criteria)[0])}`,
        log, label: 'criteria-retry',
      }));
      const retried = takeCriteria(parseJson(again.text, { strict: true })?.criteria);
      if (!Array.isArray(retried) || retried.length === 0 || metaCriteria(retried).length) {
        throw new Error('The criteria stage twice returned criteria about the criteria list rather than the request. Stopped before any paid review round; see the run log.');
      }
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #5): the retried
      // criteria skipped the feasibility guard, so a retry demanding HANDOFF.md was accepted - the
      // Zofia "criteria about files the panel doesn't grade" failure, reached in a different order.
      // Both guards now hold on whatever criteria the run finally keeps.
      const retriedInfeasible = infeasibleCriteria(retried, { handoff: !!config.handoff, debate: !!config.debate });
      if (retriedInfeasible.length) {
        throw new Error(`The retried criteria demand documents a single build stage cannot produce ("${retriedInfeasible[0]}"). Stopped before any paid review round; see the run log.`);
      }
      criteria = retried;
    }
  }
  log(`\nAcceptance criteria (${criteria.length}):`);
  criteria.forEach((c, i) => log(`  ${i + 1}. ${c}`));
  if (kindsOn) {
    criteriaKinds.forEach((k, i) => { if (k.kind === 'checkable') log(`     ${i + 1}: checkable on ${k.on} - ${k.check}`); });
    log(`  ${summaryLine(criteriaSummary(criteria, criteriaKinds))}`);
  }
  // $0 word-level lints over the list, before any paid review round (src/criteria-lints.js): recorded
  // and logged, never a stop.
  const criteriaLints = lintCriteria(criteria);
  setIdCriteria(criteria);   // 0.8.4 S2 (RU-S2-10): an objection id reads the LIST criterion a retyped criterion text resolves to; not gated on W6
  for (const f of criteriaLints) log(`  criteria lint (${f.id}): ${f.message}`);
  // The "How the checkable criteria are settled" block for critic and handoff prompts; '' when
  // kinds are off or nothing is checkable, which keeps those prompts byte-identical.
  const checks = kindsOn ? checksSection(criteria, criteriaKinds) : '';

  // 1a. Whole alternative architectures (optional, config.alternatives.enabled; 2026-09-23, Muad:
  //     "have the models argue over whole alternative architectures: I think this is a great
  //     idea"). Before any skeleton exists, every proposer lab writes ONE whole architecture,
  //     blind and concurrently; then the same anonymised post/reply debate proposals use runs over
  //     the alternatives. The board goes to the skeleton and the builder, which choose one or
  //     combine them and record every loser in the plan's "Decisions" section (promptOpts above).
  //     Stage labels (alternative-<lab>, alt-debate-<lab>, alt-reply-<lab>) are stable so resume
  //     and the stage cache replay them; every call goes through invoke(), so the spend cap and
  //     the denied-model backstop apply; lab identity is labOf(), as everywhere else.
  let alternatives = null;
  let alternativesBoard = null;
  if (config.alternatives?.enabled === true && !initialDraft) {
    // Tiered councils (2026-09-26): seats.alternatives, when set, names who writes the whole
    // architectures (the anchors), separately from who proposes parts and debates them (the mass
    // seats in seats.proposers). Absent: today's list, unchanged.
    const altSeats = config.seats.alternatives || config.seats.proposers || config.seats.critics || [];
    // Cap: the seat's own maxTokens, as the proposal stage uses, unless the chain sets
    // alternatives.maxTokens. Pre-release audit 2026-09-23 (Alternatives #1, DecisionRecords #1):
    // a fixed 3000 sat below these rosters' thinking spend (qwen3.8-max 12300, glm5.3-flash 10612
    // on the propose stage), so 3-4 of 7 labs would come back cut off, be retried at the same cap,
    // and drop out mislabelled as "unreadable".
    const perAlt = config.alternatives.maxTokens;
    log(`\nStage: alternatives (${altSeats.length} labs each propose ONE whole architecture, blind)`);
    const altResults = await settleAll(altSeats.map(async seat => {
      const lines = []; const say = m => lines.push(m);
      const lab = seatKeyOf(seat);
      const seatCap = seat.maxTokens ?? DEFAULT_MAX_TOKENS;
      const capped = keepSeatKey(seat, { ...seat, maxTokens: perAlt ? Math.min(seatCap, perAlt) : seatCap });
      const readAlt = text => {
        const j = parseJson(text);
        const one = j && !Array.isArray(j) ? j : null;
        // A model may hand back a list or an object where a string belongs; keep it, as text.
        // FX-11: a whole architecture keeps what its seat was allowed to write (boardTextLimit).
        const lim = { limit: boardTextLimit(capped.maxTokens), stage: `alternative-${lab}` };
        const str = (v, field) => typeof v === 'string' ? capField(v, { ...lim, field }) : v == null ? '' : capField(JSON.stringify(v), { ...lim, field });
        return one && typeof one.name === 'string' && one.name.trim() && typeof one.shape === 'string' && one.shape.trim()
          ? { name: str(one.name, 'name'), shape: str(one.shape, 'shape'), key_tradeoffs: str(one.key_tradeoffs, 'key_tradeoffs'), bad_at: str(one.bad_at, 'bad_at') }
          : null;
      };
      const ask = (label, cap) => invoke(keepSeatKey(capped, { ...capped, maxTokens: cap }), {
        system: R.ALTERNATIVE_SYSTEM,
        user: R.alternativeUser({ request, criteria }),
        log: say, label,
      });
      let cap = capped.maxTokens;
      let st = record(await ask(`alternative-${lab}`, cap));
      let alt = readAlt(st.text);
      if (!alt) {
        // Same one-retry rule as the proposal stage: an unreadable reply costs one more call,
        // through invoke() like any other, then the lab drops out on the record. A reply cut off
        // at the cap is retried with a bigger one (cutOffRetryCap, the panel's rule), since the
        // same cap would only cut it off again.
        // 0.8.1 R review: the retry starts from the cap the reply was really asked at (st.cappedAt: an Anthropic seat's invoke() may already have
        // retried at the bigger cap) and is skipped when it has no room: it would repeat the same paid call.
        const from = st.cappedAt ?? cap;
        const cut = abstentionReasonCode(st.usage || {}, from) === 'REPLY_TRUNCATED';
        const room = cut ? cutOffRetryCap(from, retryCeilingOf(capped)) : from;
        if (cut && room <= from) {
          say(`  ${lab}/${seat.model}: alternative cut off at ${from} tokens, already the largest retry cap - not retried.`);
        } else {
          if (cut) cap = room;
          st = record(await ask(`alternative-${lab}-retry`, cap));
          alt = readAlt(st.text);
          say(`  ${lab}/${seat.model}: ${cut ? `alternative cut off at ${from} tokens; retried with a ${cap}-token cap` : 'unreadable alternative; retried once'} - ${alt ? 'recovered' : 'still nothing'}.`);
        }
      }
      if (alt) say(`  ${lab}/${seat.model}: "${alt.name}"`);
      const reasonCode = alt ? null : abstentionReasonCode(st.usage || {}, askedCapOf(st, cap));
      return { seat, lab, alt, lines, reasonCode, cap };
    }));
    const items = [];
    const altDropouts = [];
    const seenTag = {};
    for (const { seat, lab, alt, lines, reasonCode, cap } of altResults) {
      lines.forEach(m => log(m));
      if (!alt) {
        const reason = reasonCode === 'REPLY_TRUNCATED' ? `alternative cut off at the token cap (truncated), still cut off after a ${cap}-token retry`
          : reasonCode === 'REASONING_EXHAUSTED' ? 'every output token spent on reasoning, far under the cap (provider-side reasoning ceiling)'
          : reasonCode === 'PROVIDER_ERROR' ? 'provider returned an error mid-generation'
          : 'no readable alternative after a retry';
        // reason_code matches signoff[]/panelVerdicts[]; reasonCode is its deprecated alias (brief 03 fix 3).
        altDropouts.push({ lab, model: seat.model, stage: 'alternatives', reason, reason_code: reasonCode, reasonCode });
        continue;
      }
      let tag = lab.toUpperCase().replace(/[^A-Z0-9]/g, '');
      seenTag[tag] = (seenTag[tag] || 0) + 1;
      if (seenTag[tag] > 1) tag += String(seenTag[tag]);
      items.push({ id: `${tag}-ALT`, lab, model: seat.model, ...alt });
    }
    if (altDropouts.length) log(`  !! ${altDropouts.length} of ${altSeats.length} labs produced no alternative: ${altDropouts.map(d => d.lab).join(', ')}`);

    const posts = [];
    const replies = [];
    let altPostsRealFn = () => posts; // set inside the debate block below when there is one
    if (items.length > 1) {
      const maps = R.anonymise(items);
      const labs = items.map(a => a.lab);
      // Tiered councils: alternatives.debaters "all" lets the proposers (the mass seats) read and post
      // on the architectures too; only the authors reply. Each extra poster gets the next unused
      // "Lab X" letter. Absent or "authors": the posters are the authors, as before.
      const posterSeats = [...altSeats];
      if (config.alternatives.debaters === 'all') {
        for (const s of config.seats.proposers || []) if (!posterSeats.some(p => seatKeyOf(p) === seatKeyOf(s))) posterSeats.push(s);
      }
      const posterLabs = [...labs, ...posterSeats.map(seatKeyOf).filter(l => !labs.includes(l))];
      posterLabs.forEach(l => { if (!maps.labTo[l]) maps.labTo[l] = `Lab ${String.fromCharCode(65 + Object.keys(maps.labTo).length)}`; });
      // 0.8.2 (owner decision 2): per-reader seeded order and letters on the alternatives debate too, when debate_hygiene.shuffle is on (src/debate-order.js).
      const altViews = new Map();
      const altViewOf = lab => {
        if (!(config.debate_hygiene?.shuffle === true)) return { items, maps };
        if (!altViews.has(lab)) {
          const v = readerView(items, lab, { runId: runId ?? '', stage: 'alternatives', anonymise: R.anonymise });
          posterLabs.forEach(l => { if (!v.maps.labTo[l]) v.maps.labTo[l] = `Lab ${String.fromCharCode(65 + Object.keys(v.maps.labTo).length)}`; });
          altViews.set(lab, { items: v.items, maps: v.maps, raw: v });
          debateOrders.push(viewRecord('alternatives', lab, v));
        }
        return altViews.get(lab);
      };
      const altRefsFor = (p, toMaps) => (config.debate_hygiene?.shuffle === true && p.by !== 'canary' && !p.canary ? { ...p, text: translateRefs(p.text, altViewOf(p.by).maps, toMaps) } : p);
      const altPostsFor = author => (config.debate_hygiene?.shuffle === true ? posts.map(p => altRefsFor(p, altViewOf(author).maps)) : posts);
      altPostsRealFn = () => (config.debate_hygiene?.shuffle === true ? posts.map(p => altRefsFor(p, null)) : posts);
      const altTextVariants = x => (config.debate_hygiene?.shuffle === true && x.by !== 'canary' ? [...new Set([x.text, ...[...altViews.values()].map(v => translateRefs(x.text, altViewOf(x.by).maps, v.maps))])] : [x.text]);
      const seatOf = lab => posterSeats.find(s => seatKeyOf(s) === lab);
      log(`\nStage: alternatives debate (${posterLabs.length} labs read ${posterLabs.length > labs.length ? `the ${labs.length} authors'` : "each other's"} architectures, anonymised)`);
      const postResults = await settleAll(posterLabs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        try {
          skipChosen(seatOf(lab), [`alt-debate-${lab}`]);
          const st = record(await invoke(seatOf(lab), {
            // No persona here: seat roles apply at exactly one call site, the proposal debate
            // (test/stage-isolation.test.js guards that boundary). Widening it to this stage is a
            // separate decision, not something to slip in with the stage.
            system: withHeldNote(config, R.ALT_DEBATE_SYSTEM, 'debatePostQuoteRule'),
            user: R.altDebateUser({ request, criteria, alternatives: altViewOf(lab).items, lab, maps: altViewOf(lab).maps }),
            log: say, label: `alt-debate-${lab}`,
          }));
          const parsed = parseJson(st.text);
          if (!parsed) { if (unreadableIsNews(st, seatOf(lab))) say(`  ${lab}: unreadable debate reply (${unreadableReplyCause(st.text)}) - no posts counted.`); return { lines, posts: [] }; }
          const mine = (parsed.posts || []).map(x => ({ by: lab, on: altViewOf(lab).maps.idFrom[x.on] || x.on, stance: String(x.stance || '').toLowerCase(), text: capField(x.text, { limit: boardTextLimit(seatOf(lab)?.maxTokens), stage: `alt-debate-${lab}`, field: 'text' }) || '', merge_with: boardRef(x.merge_with, altViewOf(lab).maps, new Set(items.map(a => a.id))) }))
            .filter(x => items.some(a => a.id === x.on && a.lab !== lab) && ['support', 'object', 'merge'].includes(x.stance));
          say(`  ${lab}: ${mine.length} post(s)`);
          return { lines, posts: mine };
        } catch (err) {
          offerSkip(err, seatOf(lab), posterSeats);   // A3a commit 2: a price refusal here may be skipped as the person's recorded choice
          rethrowControlFlow(err);
          say(`  ${lab}: no debate reply (${String(err.message).slice(0, 100)}).`);
          return { lines, posts: [] };
        }
      }));
      for (const r of postResults) { r.lines.forEach(m => log(m)); posts.push(...r.posts); }
      // 0.8.2 (decision 2): the same detection as for proposals (src/post-quotes.js), against the alternative the post is about; data only here, the mark is the held reply prompt's.
      if (noQuoteMarksOn(config)) posts.forEach((x, k) => { posts[k] = markPostQuote(x, items); });

      log(`\nStage: alternatives replies (each author answers the posts on its architecture)`);
      const replyResults = await settleAll(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        const mine = items.filter(a => a.lab === lab && posts.some(x => x.on === a.id));
        if (!mine.length) { say(`  ${lab}: nothing to answer.`); return { lines, replies: [] }; }
        try {
          skipChosen(seatOf(lab), [`alt-reply-${lab}`]);
          const st = record(await invoke(seatOf(lab), {
            system: withHeldNote(config, R.altReplySystem(guard), 'noQuoteGloss'),
            user: altReplyUserFor(config)({ request, alternatives: altViewOf(lab).items, posts: altPostsFor(lab), lab, maps: altViewOf(lab).maps, guard }),
            log: say, label: `alt-reply-${lab}`,
          }));
          const parsed = parseJson(st.text);
          if (!parsed) { if (unreadableIsNews(st, seatOf(lab))) say(`  ${lab}: unreadable reply (${unreadableReplyCause(st.text)}) - its alternative stands as posted.`); return { lines, replies: [] }; }
          const got = (parsed.replies || []).map(r => ({ ...r, id: altViewOf(lab).maps.idFrom[r.id] || r.id, replaced_by: boardRef(r.replaced_by, altViewOf(lab).maps, new Set(items.map(a => a.id))), action: String(r.action || '').toLowerCase(), text: capField(r.text, { limit: boardTextLimit(seatOf(lab)?.maxTokens), stage: `alt-reply-${lab}`, field: 'text' }) || '' }))
            .filter(r => mine.some(a => a.id === r.id) && ['keep', 'amend', 'withdraw'].includes(r.action));
          say(`  ${lab}: ${got.map(r => r.action).join(', ') || 'no usable reply'}`);
          return { lines, replies: got };
        } catch (err) {
          offerSkip(err, seatOf(lab), labs.map(seatOf));   // A3a commit 2: a price refusal here may be skipped as the person's recorded choice
          rethrowControlFlow(err);
          say(`  ${lab}: no reply-round answer (${String(err.message).slice(0, 100)}).`);
          return { lines, replies: [] };
        }
      }));
      for (const r of replyResults) { r.lines.forEach(m => log(m)); replies.push(...r.replies); }
      if (guard) guardWithdrawals(replies, posts, log, altTextVariants);
      if (config.debate_hygiene?.shuffle === true) for (const r of replies) { // audit fix cnc-debate F3, alternatives stage: the stored reply is in real names like the stored posts (the guard has already read the author's own copy)
        const own = items.find(x => x.id === r.id);
        if (own) for (const f of ['text', 'conceded_to', 'shape', 'key_tradeoffs', 'bad_at']) if (typeof r[f] === 'string') r[f] = translateRefs(r[f], altViewOf(own.lab).maps, null);
      }
      for (const r of replies) {
        const a = items.find(x => x.id === r.id);
        if (r.action === 'amend') { for (const k of ['shape', 'key_tradeoffs', 'bad_at']) if (typeof r[k] === 'string' && r[k].trim()) a[k] = capField(r[k], { limit: boardTextLimit(seatOf(a.lab)?.maxTokens), stage: `alt-reply-${a.lab}`, field: k }); a.amended = true; }
        if (r.action === 'withdraw' && r.unargued) a.withdraw_unargued = true;
        else if (r.action === 'withdraw') { a.withdrawn = true; a.replaced_by = r.replaced_by; }
      }
    }
    if (items.length) {
      alternativesBoard = (guard ? `${R.GUARD_BOARD_NOTE}\n\n` : '') + R.renderAlternativesBoard(items, altPostsRealFn(), replies);
      alternatives = { items, posts: altPostsRealFn(), replies, dropouts: altDropouts, board: alternativesBoard };
      log(`  alternatives: ${items.length} architecture(s), ${posts.length} post(s), ${items.filter(a => a.withdrawn).length} withdrawn, ${items.filter(a => a.amended).length} amended.`);
    } else {
      alternatives = { items, posts, replies, dropouts: altDropouts, board: null };
      log('  alternatives: no lab produced one - the plan proceeds without an alternatives board.');
    }
  }

  // 1b. Proposal stage (optional, config.proposals). A skeleton first, then
  //     every proposer seat - blind, concurrently - offers up to N buildable
  //     parts against it. The builder integrates and keeps a scope ledger.
  //     Authorship stays with one model: the labs propose, they never
  //     co-write (Docs/Evidence.md: mixed-author merges lose to one strong
  //     author; distinct roles win).
  let proposals = [];
  let dropouts = [];
  const proposalPool = [];
  let skeleton = null;
  let board = null;
  let debate = null;
  if (config.proposals && !initialDraft) {
    const parts = config.proposals.parts ?? 3;
    // Per-part output allowance. Shipped chains set 12,000 since 0.8.1 (FX-12: Hy4 and Qwen were cut off at 12,300 and paid
    // twice): the call below asks min(seat cap, parts x perPart + 300), so 3 parts x 12,000 + 300 = 36,300 is clamped to
    // the seat's own 36,000 and a proposal gets the same output room as every other call of that seat. A cut-off reply is
    // retried once at cutOffRetryCap (64,000 at most), as a critic's is. 1,500 stays the default for a chain that sets none.
    const perPart = config.proposals.maxTokens ?? 1500;
    log('\nStage: skeleton');
    skeleton = record(await invoke(config.seats.skeleton || config.seats.builder, {
      system: R.SKELETON_SYSTEM,
      user: R.skeletonUser({ request, criteria, alternatives: alternativesBoard }),
      log, label: 'skeleton',
    })).text;
    const proposers = config.seats.proposers || config.seats.critics;
    // Context partitioning (v1, opt-in): config.proposals.partition.slices is an optional map
    // keyed by lab name (labOf(seat), the same identity blind-panel/debate logic already keys
    // off) to a per-seat instruction string. Absent field or absent/empty entry for a given seat
    // means that seat's prompt is unchanged from before this existed - partial partitioning
    // (some seats sliced, some not) is allowed by design, not a bug. This threads instruction
    // text only; it never subsets or rewrites the shared request/criteria/skeleton. Mechanism
    // only - no claim here or anywhere else that it changes proposal quality or diversity.
    const partitionSlices = config.proposals.partition?.slices || null;
    if (partitionSlices) {
      const knownLabs = new Set(proposers.map(seatKeyOf));
      for (const [lab, text] of Object.entries(partitionSlices)) {
        if (typeof text !== 'string' || !text.trim()) {
          throw new Error(`config.proposals.partition.slices["${lab}"] must be a non-empty string`);
        }
        if (!knownLabs.has(lab)) {
          throw new Error(`config.proposals.partition.slices names unknown lab "${lab}" (known: ${[...knownLabs].join(', ')})`);
        }
      }
    }
    // Best-of-N: `samples` independent attempts per lab, pooled, then a judge
    // keeps the strongest `keep` distinct ones. samples=1 means no judging.
    const samples = config.proposals.samples ?? 1;
    const keep = config.proposals.keep ?? parts;
    log(`\nStage: proposals (${proposers.length} labs, ${samples} attempt(s) of up to ${parts} parts each, blind${samples > 1 ? `; a judge keeps up to ${keep} per lab` : ''})`);
    const results = await settleAll(proposers.map(async seat => {
      const lines = [];
      const say = m => lines.push(m);
      const capped = keepSeatKey(seat, { ...seat, maxTokens: Math.min(seat.maxTokens ?? DEFAULT_MAX_TOKENS, parts * perPart + 300) });
      const slice = (partitionSlices && partitionSlices[seatKeyOf(seat)]) || null;
      const pool = [];
      let unreadable = 0, lastSt = null;
      for (let k = 0; k < samples; k++) {
        const st = lastSt = record(await invoke(capped, {
          system: proposerSystemFor(config, seat, open),
          user: R.proposerUser({ request, criteria, skeleton, parts, slice }),
          log: say, label: `propose-${seatKeyOf(seat)}${samples > 1 ? `-${k + 1}` : ''}`, group: 'propose',   // 0.8.4 T14: blind proposals read the request, criteria and skeleton only, never each other (src/stale-guard.js groups)
        }));
        const parsed = parseJson(st.text);
        const list = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, parts) : null;
        if (!list) unreadable++; else pool.push(...list.filter(p => p && p.title).map(p => ({ ...p, attempt: k + 1 })));
      }
      if (unreadable) say(`  ${shownSeat(seat)}/${seat.model}: ${unreadable} of ${samples} attempt(s) unreadable.`);
      // A lab that returns nothing readable drops out of the panel entirely:
      // no proposals, no seat in the debate, no row anyone is likely to miss
      // it from. For a harness whose whole claim is that independent labs
      // disagree on the record, losing a lab to one malformed reply quietly
      // degrades the exact thing being measured - so buy one retry before
      // accepting it. The retry goes through invoke() like any other call, so
      // the spend cap still governs it.
      if (!pool.length) {
        // Bug audit 2026-09-28 (area 2 #1): a reply cut off at the cap was retried at the same cap,
        // which a reasoning seat fills again (plan-daily-7's first real run: hy4-preview thought through
        // all 12,300 tokens twice and dropped out). Same rule as the alternatives stage: a cut-off is
        // retried with cutOffRetryCap, anything else once at the same cap.
        // 0.8.1 R review: start from the cap the reply was really asked at (lastSt.cappedAt: an Anthropic seat's invoke() may already have
        // retried at the bigger cap) and skip the retry when there is no room: it would repeat the same paid call.
        const from = lastSt?.cappedAt ?? capped.maxTokens;
        const cut = !!lastSt && abstentionReasonCode(lastSt.usage || {}, from) === 'REPLY_TRUNCATED';
        const retryCap = cut ? cutOffRetryCap(from, retryCeilingOf(capped)) : capped.maxTokens;
        if (cut && retryCap <= from) {
          say(`  ${shownSeat(seat)}/${seat.model}: proposals cut off at ${from} tokens, already the largest retry cap - not retried.`);
        } else {
          const st = record(await invoke(keepSeatKey(capped, { ...capped, maxTokens: retryCap }), {
            system: proposerSystemFor(config, seat, open),
            user: R.proposerUser({ request, criteria, skeleton, parts, slice }),
            log: say, label: `propose-${seatKeyOf(seat)}-retry`, group: 'propose',
          }));
          const parsed = parseJson(st.text);
          const list2 = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, parts) : null;
          if (list2) pool.push(...list2.filter(p => p && p.title).map(p => ({ ...p, attempt: samples + 1 })));
          say(`  ${shownSeat(seat)}/${seat.model}: ${cut ? `proposals cut off at ${from} tokens; retried with a ${retryCap}-token cap` : 'nothing readable; retried once'} - ${pool.length ? `recovered ${pool.length} proposal(s)` : 'still nothing'}.`);
        }
      }
      let list = pool;
      let judged = null;
      if (samples > 1 && pool.length > 0) {
        const judgeSeat = config.seats.judge || seat;
        const js = record(await invoke(judgeSeat, {
          system: R.JUDGE_SYSTEM,
          user: R.judgeUser({ request, criteria, skeleton, pool, keep }),
          log: say, label: `judge-${seatKeyOf(seat)}`,
        }));
        const jp = parseJson(js.text);
        const picks = Array.isArray(jp?.picks) ? [...new Set(jp.picks.map(Number).filter(n => n >= 1 && n <= pool.length))].slice(0, keep) : null;
        if (picks && picks.length) {
          list = picks.map(n => pool[n - 1]);
          judged = jp.dropped_because || '';
        } else {
          list = pool.slice(0, keep);
          say(`  ${shownSeat(seat)}/${seat.model}: the judge's reply could not be read; keeping the first ${list.length} proposals of the pool.`);
        }
      }
      if (!list.length) say(`  ${shownSeat(seat)}/${seat.model}: no proposals.`);
      else say(`  ${shownSeat(seat)}/${seat.model}: ${list.length} proposal(s)${samples > 1 ? ` kept from a pool of ${pool.length}` : ''}${list.map(p => `\n    - ${p.title}`).join('')}${judged ? `\n    judge: ${judged}` : ''}`);
      // v5 §1 candidate 10: opt-in only, no default (his call, 2026-09-13) -
      // a chain that never sets max_proposals_per_seat behaves exactly as it
      // did before this candidate existed. Only a chain that does set it, and
      // only a seat whose own list still exceeds that cap, pays for one more
      // prompt to fold its own proposals down before the board sees them.
      const cap = proposalCapOf(config);
      if (cap && list.length > cap) {
        const ms = record(await invoke(capped, {
          system: R.PROPOSAL_MERGE_SYSTEM,
          user: R.proposalMergeUser({ request, criteria, skeleton, list, cap }),
          log: say, label: `propose-${seatKeyOf(seat)}-merge`,
        }));
        const parsed = parseJson(ms.text);
        const picks = Array.isArray(parsed?.kept) ? [...new Set(parsed.kept.map(Number).filter(n => n >= 1 && n <= list.length))].slice(0, cap) : null;
        const before = list.length;
        list = picks && picks.length ? picks.map(n => list[n - 1]) : list.slice(0, cap);
        say(`  ${shownSeat(seat)}/${seat.model}: folded ${before} proposal(s) down to ${list.length} (cap ${cap})${parsed?.merged_because ? ` - ${parsed.merged_because}` : ''}`);
      }
      return { seat, list, pool, lines, slice };
    }));
    // Labs that ended the stage with nothing, after the retry. Recorded so
    // the run report shows a shrunken roster instead of leaving it to be
    // inferred from a missing scoreboard row.
    dropouts = results.filter(r => !r.list.length).map(r => ({ lab: labOf(r.seat), ...seatField(r.seat), model: r.seat.model, stage: 'proposals', reason: 'no readable proposals after a retry' }));

    const seen = {};
    for (const { seat, list, pool, lines, slice } of results) {
      lines.forEach(m => log(m));
      let tag = seatKeyOf(seat).toUpperCase().replace(/[^A-Z0-9]/g, '');
      seen[tag] = (seen[tag] || 0) + 1;
      if (seen[tag] > 1) tag += String(seen[tag]);
      // slice metadata only (v1): threads which per-seat instruction, if any, produced this
      // proposal through to whatever reads proposals downstream (debate/critic stages). No
      // debate/critic prompt text or scoring reads this field yet - deferred to a v2 that would
      // render slice-awareness into critic prompts (see chains/mock-partitioned.json's comment).
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #8): the model's own
      // object was spread LAST, so a proposal carrying its own `id` or `lab` overrode the harness's -
      // duplicate ids were scored `unaccounted`, and a lab could be misattributed. The harness's
      // identity fields now win; the model's values are kept, renamed, for the record.
      const ownIdentity = p => ({
        ...p,
        ...(p.id !== undefined ? { proposer_id: p.id } : {}),
        ...(p.lab !== undefined ? { proposer_lab: p.lab } : {}),
      });
      list.forEach((p, i) => proposals.push({ ...ownIdentity(p), id: `${tag}-${i + 1}`, lab: seatKeyOf(seat), model: seat.model, slice: slice || null }));
      pool.forEach(p => proposalPool.push({ ...ownIdentity(p), lab: labOf(seat), ...seatField(seat), model: seat.model, kept: list.includes(p) }));
    }
    log(`  ${proposals.length} proposal(s) go to the builder.`);
    if (dropouts.length) {
      log(`  !! ROSTER SHRANK: ${dropouts.length} of ${proposers.length} labs produced nothing and are not in this run's debate or scoreboard:`);
      for (const d of dropouts) log(`     - ${d.lab}/${d.model} (${d.reason})`);
      log(`     Independence is measured across the labs that actually spoke, not the ones the chain names.`);
    }

    // Debate (config.debate): every lab reads the others' proposals and posts;
    // every author replies. Labs are anonymised in the prompts. The board is
    // what the builder reads instead of bare proposals.
    if (config.debate && proposals.length > 1) {
      const maps = R.anonymise(proposals);
      // 0.8.2 (owner decision 2): with debate_hygiene.shuffle every reader gets its own seeded order and letters (src/debate-order.js); without it, one shared view, byte for byte as before.
      const shuffleOn = config.debate_hygiene?.shuffle === true;
      const views = new Map();
      const viewOf = lab => {
        if (!shuffleOn) return { proposals, maps };
        if (!views.has(lab)) { const v = readerView(proposals, lab, { runId: runId ?? '', stage: 'debate', anonymise: R.anonymise }); views.set(lab, { proposals: v.items, maps: v.maps, raw: v }); debateOrders.push(viewRecord('debate', lab, v)); }
        return views.get(lab);
      };
      // Free text in a post names proposals and labs in the poster's own lettering: re-letter it for each reader (src/debate-order.js translateRefs); null = real ids for the builder's board.
      const refsFor = (p, toMaps) => (shuffleOn && p.by !== 'canary' && !p.canary ? { ...p, text: translateRefs(p.text, viewOf(p.by).maps, toMaps) } : p);
      const postsFor = author => (shuffleOn ? posts.map(p => refsFor(p, viewOf(author).maps)) : posts);
      const postsReal = () => (shuffleOn ? posts.map(p => refsFor(p, null)) : posts);
      const textVariants = x => (shuffleOn && x.by !== 'canary' ? [...new Set([x.text, ...[...views.values()].map(v => translateRefs(x.text, viewOf(x.by).maps, v.maps))])] : [x.text]);
      const labs = [...new Set(proposals.map(p => p.lab))];
      const seatOf = lab => proposers.find(s => seatKeyOf(s) === lab);
      log(`\nStage: debate (${labs.length} labs read each other's proposals, anonymised)`);
      const postResults = await settleAll(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        let posts = [], revisions = [], toolResults = [], toolWarnings = [];
        const dropped = [];
        try {
          skipChosen(seatOf(lab), [`debate-${lab}`]);
          // v6 §1/§3: role augmentation applies only here, the debate-stage
          // system prompt - never to the panel/critique stage. A seat with
          // no role gets R.DEBATE_SYSTEM back unchanged (applySeatRole is a
          // no-op), which is what the golden-hash compatibility test in
          // test/seat-role.test.js checks.
          // 2026-09-22: loadPersonas() so an operator's COUNCIL_PERSONAS_FILE (PERSONAS.md)
          // actually reaches the prompt - it was documented but never read here, so a custom
          // persona key went out as a bare name with no voice.
          const debatePrompt = {
            system: debateSystemFor(config, seatOf(lab), { textRequests: proposerRequestsOpen }),
            user: R.debateUser({ request, criteria, skeleton, proposals: viewOf(lab).proposals, lab, maps: viewOf(lab).maps }),
          };
          const st = record(await invoke(seatOf(lab), { ...debatePrompt, log: say, label: `debate-${lab}`, group: 'debate' }   /* 0.8.4 T14: each post reads all PROPOSALS and none of the other posts */));
          const st2 = await onceMoreIfIncomplete(st, seatOf(lab), { ...debatePrompt, log: say, label: `debate-${lab}-retry`, group: 'debate' }, say);
          const parsed = parseJson(st2.text);
          if (!parsed) {
            const why = draftIncomplete(st2.usage) ? 'provider_error' : 'unreadable';
            if (unreadableIsNews(st2, seatOf(lab))) say(why === 'provider_error' ? `  ${lab}: the provider ended the debate reply with stop "${st2.usage.stop}" (after a retry) - no posts counted.` : `  ${lab}: unreadable debate reply (${unreadableReplyCause(st2.text)}) - no posts counted.`);   // a replayed stage is not announced again: the drop is in `dropped` and on the board
            dropped.push({ stage: 'debate', by: lab, reason: why });
          }
          else {
            // 0.7.8 (thc-research brief 10, W3): the same filter as before, but every post it
            // rejects is counted with its reason instead of vanishing (debate.dropped).
            posts = (parsed.posts || []).map(x => ({ by: lab, on: viewOf(lab).maps.idFrom[x.on] || x.on, stance: String(x.stance || '').toLowerCase(), text: x.text || '', merge_with: boardRef(x.merge_with, viewOf(lab).maps, new Set(proposals.map(p => p.id))) }))
              .filter(x => {
                const reason = debatePostDropReason(x, lab, proposals);
                if (reason) dropped.push({ stage: 'debate', by: lab, reason });
                return !reason;
              });
            // 0.8.2 (owner decision 2): with debate_hygiene.noQuoteMarks each objection or merge records whether it quotes the proposal it is about (src/post-quotes.js). Data only: the mark an author sees is a prompt change, held for the owner's list.
            if (config.debate_hygiene?.noQuoteMarks === true) posts = posts.map(x => markPostQuote(x, proposals));
            collectProposerRequests(lab, parsed.text_requests, st2.label);   // 0.8.4 D18: the proposer's requests, listed at the first session pause that follows
            revisions = (parsed.revisions || []).map(r => ({ ...r, id: viewOf(lab).maps.idFrom[r.id] || r.id })).filter(r => proposals.some(p => p.id === r.id && p.lab === lab));
            const n = st => posts.filter(x => x.stance === st).length;
            say(`  ${lab}: ${posts.length} post(s) - ${n('support')} support, ${n('object')} object, ${n('merge')} merge${revisions.length ? `; revised ${revisions.length} of its own` : ''}${dropped.length ? `; ${describeDropped(dropped)}` : ''}`);

            // v7.x item 3: this lab's seat may have asked for bounded, allowlisted tool calls in
            // the same reply (`tool_requests: [{tool, args}]`). Gated (see the declaration of
            // `toolRequestWarnings` above) on config.tools.seat_requests.enabled +
            // config.verify.tools - a seat can only request a tool already on that allowlist.
            if (toolRequestWarnings) {
              const allowedTools = config.verify.tools.map(t => t.tool);
              const cap = config.tools.seat_requests.cap ?? 3;
              const outcome = runSeatToolRequests(parsed.tool_requests, {
                cap, allowedTools,
                runTool: config.verify?.runTool || defaultRunTool,
                cwd: config.verify?.cwd || process.cwd(),
                seat: lab,
              });
              toolResults = outcome.results;
              toolWarnings = outcome.warnings;
              toolWarnings.forEach(w => say(`  WARNING: ${w}`));
            }
          }
        } catch (err) {
          offerSkip(err, seatOf(lab), labs.map(seatOf));   // A3a commit 2: a price refusal here may be skipped as the person's recorded choice
          rethrowControlFlow(err);
          say(`  ${lab}: no debate reply (${String(err.message).slice(0, 100)}).`);
        }
        return { lines, posts, revisions, toolResults, toolWarnings, dropped };
      }));
      const posts = [];
      const droppedItems = [];
      const debateToolResults = [];
      for (const r of postResults) {
        r.lines.forEach(m => log(m));
        posts.push(...r.posts);
        droppedItems.push(...(r.dropped || []));
        for (const rev of r.revisions) { const p = proposals.find(x => x.id === rev.id); if (rev.how) p.how = rev.how; if (rev.acceptance_test) p.acceptance_test = rev.acceptance_test; p.amended = true; }
        // v7.x item 3: appended to the same ground_truth array v7 item 1's config-time tools use,
        // in the same { tool, args, result } shape, plus `result_ref` - re-presented verbatim to
        // later stages the same way config-time ground truth already is (renderGroundTruth reads
        // this same array; nothing new to thread through for that part).
        // 0.8.2 item 5 (F5): the id is given HERE, by the one place that sees every entry, as `<tool>:<position among that tool's entries in the whole array>`: the rule claims.js
        // already reads. runSeatToolRequests numbers per call, so two seats that both asked for check_versions both came back as `check_versions:0`. Entries are added in lab order,
        // so the ids are the same on a resume that replays the stage.
        if (ground_truth) for (const e of r.toolResults) { const entry = { ...e, result_ref: `${e.tool}:${ground_truth.filter(g => g.tool === e.tool).length}` }; ground_truth.push(entry); debateToolResults.push(entry); }
        if (toolRequestWarnings && r.toolWarnings.length) toolRequestWarnings.push(...r.toolWarnings);
      }
      // 0.8.2 item 5 (ChatGPT review 2, F3): the results pushed above reached the ground_truth array and nothing else: `request` was built once, before the debate, so no later prompt (the
      // replies, the build, the critics) ever showed them. They are appended to `request` now, as one block with its own heading, and only when a seat asked for a tool: a chain
      // without seat_requests is byte-identical (the default heading above is unchanged).
      if (debateToolResults.length) request += renderGroundTruth(debateToolResults, R.DEBATE_GROUND_TRUTH_HEADING);

      log(`\nStage: replies (each author answers the posts on its proposals)`);
      const replies = [];
      const replyResults = await settleAll(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        const mineWithPosts = proposals.filter(p => p.lab === lab && posts.some(x => x.on === p.id));
        if (!mineWithPosts.length) { say(`  ${lab}: nothing to answer.`); return { lines, replies: [] }; }
        try {
          skipChosen(seatOf(lab), [`reply-${lab}`]);
          const st = await onceMoreIfIncomplete(record(await invoke(seatOf(lab), {
            system: replySystemFor(config, seatOf(lab), guard),
            user: replyUserFor(config)({ request, proposals: viewOf(lab).proposals, posts: postsFor(lab), lab, maps: viewOf(lab).maps, guard }),
            log: say, label: `reply-${lab}`,
          })), seatOf(lab), {
            system: replySystemFor(config, seatOf(lab), guard),
            user: replyUserFor(config)({ request, proposals: viewOf(lab).proposals, posts: postsFor(lab), lab, maps: viewOf(lab).maps, guard }),
            log: say, label: `reply-${lab}-retry`,
          }, say);
          const parsed = parseJson(st.text);
          if (!parsed) {
            const why = draftIncomplete(st.usage) ? 'provider_error' : 'unreadable';
            if (unreadableIsNews(st, seatOf(lab))) say(why === 'provider_error' ? `  ${lab}: the provider ended the reply round with stop "${st.usage.stop}" (after a retry) - proposals stand as posted.` : `  ${lab}: unreadable reply round (${unreadableReplyCause(st.text)}) - proposals stand as posted.`);;
            return { lines, replies: [], dropped: [{ stage: 'replies', by: lab, reason: why }] };
          }
          const dropped = [];
          const mine = (parsed.replies || []).map(r => ({ ...r, id: viewOf(lab).maps.idFrom[r.id] || r.id, replaced_by: boardRef(r.replaced_by, viewOf(lab).maps, new Set(proposals.map(p => p.id))), action: String(r.action || '').toLowerCase() }))
            .filter(r => {
              const reason = debateReplyDropReason(r, lab, proposals, mineWithPosts);
              if (reason) dropped.push({ stage: 'replies', by: lab, reason });
              return !reason;
            });
          const n = a => mine.filter(r => r.action === a).length;
          say(`  ${lab}: ${n('keep')} keep, ${n('amend')} amend, ${n('withdraw')} withdraw${dropped.length ? `; ${describeDropped(dropped)}` : ''}`);
          // v5 item 3, touch point 2: decisions already counted just above, no new parsing.
          // "held" (the design's council-seal wedge for "kept a proposal against an objection")
          // is a reply seat's own decision, not a provider outcome - kept distinct from
          // objected/signed, which belong to the critic side of a round (item 3's own
          // Assumptions note).
          progressHook({ kind: 'verdict', label: `reply-${lab}`, lab, decisions: { keep: n('keep'), amend: n('amend'), withdraw: n('withdraw') } });
          return { lines, replies: mine, dropped };
        } catch (err) {
          offerSkip(err, seatOf(lab), labs.map(seatOf));   // A3a commit 2: a price refusal here may be skipped as the person's recorded choice
          rethrowControlFlow(err);
          say(`  ${lab}: no reply-round answer (${String(err.message).slice(0, 100)}).`);
          return { lines, replies: [] };
        }
      }));
      for (const r of replyResults) { r.lines.forEach(m => log(m)); replies.push(...r.replies); droppedItems.push(...(r.dropped || [])); }
      if (guard) guardWithdrawals(replies, posts, log, textVariants);
      // Audit fix cnc-debate F3: with shuffle a reply was stored in its author's private lettering ("Lab B", "A-2") while the posts are stored in real ids and lab names, so one token meant different things in report.json and on the board.
      // The guard above has already read the author's own copy; the stored copy (and the fields an amend copies into the proposal) is re-lettered to the real names, like postsReal.
      if (shuffleOn) for (const r of replies) {
        const own = proposals.find(x => x.id === r.id);
        if (own) for (const f of ['text', 'conceded_to', 'how', 'acceptance_test']) if (typeof r[f] === 'string') r[f] = translateRefs(r[f], viewOf(own.lab).maps, null);
      }
      for (const r of replies) {
        const p = proposals.find(x => x.id === r.id);
        if (r.action === 'amend') { if (r.how) p.how = r.how; if (r.acceptance_test) p.acceptance_test = r.acceptance_test; p.amended = true; }
        if (r.action === 'withdraw' && r.unargued) p.withdraw_unargued = true;
        else if (r.action === 'withdraw') { p.withdrawn = true; p.replaced_by = r.replaced_by; }
      }
      board = (guard ? `${R.GUARD_BOARD_NOTE}\n\n` : '') + R.renderBoard(proposals, postsReal(), replies);
      // v6 §4: the field is always present once a debate stage has run, even
      // when no tie ever o     // happened" and as "the feature isn't wired up" identically, which is
      // exactly the silent-drop failure class this project was burned by
      // tonight. Phase 3 delivers the arithmetic and this always-present
      // field; no call site in this stage decides pass/fail by vote yet, so
      // debate runs record the no-op result until a future phase wires one.
      // `dropped` (0.7.8, experimental): always present once the debate ran, [] when nothing was.
      // With debate_hygiene.shuffle the stored post text is re-lettered to real ids and lab names (postsReal): report.json, BOARD.md and every later reader see one lettering, not each poster's own.
      debate = { posts: postsReal(), replies, tie_break: NO_TIE_BREAK, dropped: tallyDropped(droppedItems) };
      const w = proposals.filter(p => p.withdrawn).length;
      log(`  board: ${posts.length} post(s), ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, ${w} proposal(s) withdrawn, ${proposals.filter(p => p.amended).length} amended.${droppedItems.length ? ` Dropped: ${describeDropped(droppedItems)}.` : ''}`);

      // v7.x item 4: canary objections (src/canary.js). Gated on config.canary.enabled +
      // config.canary.sampleRate. Runs after the board is already rendered (above), so a canary
      // never appears in the board/deliverable text - only in report.json's debate.posts/replies,
      // each entry carrying `canary: true`. Deliberately does not mutate the target proposal's
      // own amended/withdrawn flags - see src/canary.js's header for why.
      // The roll is one decision per run (pre-release audit 2026-09-23, ProposalsDebateDispute #3):
      // seeded from the run id when the CLI passes one, so every resume sitting draws the same
      // answer, and a canary already paid for in an earlier sitting (its reply on disk in the stage
      // cache) always counts as sampled - so it replays, and its cost stays in totals and --spend.
      const canaryRng = config.canary?.rng || (runId ? () => runIdUnit(runId) : undefined);
      // 0.8.2: with debate_hygiene.shuffle the target is picked by seed. The pick is a pure function of the run id (and the standing proposals), so every sitting of a run picks the same one:
      // no "preferred" target from the stage cache (the item 3 review showed that rule could MOVE the target when a lab had several proposals).
      const canaryTarget = !config.canary?.enabled ? null : shuffleOn
        ? pickCanaryTargetSeeded(proposals, runId ?? '')
        : pickCanaryTarget(proposals);
      const canaryPaid = !!(canaryTarget && cache.get(`canary-reply-${canaryTarget.lab}`));
      if (config.canary?.enabled && (canaryPaid || shouldSampleCanary(config, canaryRng))) {
        const decide = config.canary.decide || (async (target, post) => {
          const lab = target.lab;
          const seat = seatOf(lab);
          if (!seat) return 'keep';
          try {
            const cst = record(await invoke(seat, {
              system: replySystemFor(config, seat, guard),
              // 4c: the canary is shown through the same marker as every other post that quotes nothing (its text quotes nothing by design); the canary record says whether the mark was on.
              user: canaryReplyPrompt({ request, proposals: viewOf(lab).proposals, post: noQuoteMarksOn(config) ? { ...post, quoted: false } : post, lab, maps: viewOf(lab).maps, guard, render: replyUserFor(config) }),
              log, label: `canary-reply-${lab}`,
            }));
            const parsed = parseJson(cst.text);
            const mine = (parsed?.replies || []).find(r => (viewOf(lab).maps.idFrom[r.id] || r.id) === target.id);
            return mine ? String(mine.action || '').toLowerCase() : 'keep';
          } catch (err) {
            rethrowControlFlow(err);
            return 'keep';
          }
        });
        const result = await injectCanary(proposals, decide, shuffleOn ? { target: canaryTarget } : {});
        if (result) {
          debate.posts.push(result.post);
          debate.replies.push(result.reply);
          canary = { injected: true, on: result.post.on, capitulated: result.capitulated, note: CANARY_NOTE, ...(noQuoteMarksOn(config) ? { no_quote_mark: !!held('replyUserMarked') } : {}) };
          log(`  canary: injected an evidence-free objection against ${result.post.on} - author ${result.capitulated ? 'capitulated' : 'held'}.`);
        }
      }

      // v5 §1 candidate 3: a withdrawal chain that cycles or dead-ends
      // (e.g. two labs mutually withdrawing in each other's favour) leaves
      // a section with no surviving owner - silently, unless the next
      // stage is told. Told here rather than aborting the run: the
      // integration stage can still assign or explicitly drop it.
      const ledger = withdrawalLedger(proposals);
      if (ledger.orphanSections.length) {
        // Bug audit 2026-09-28 (area 4 MED-2): this read as an alarm in the $0 demo, whose plan then
        // handled the withdrawal exactly as asked. It is a note the builder acts on, and says so.
        log(`  note: ${ledger.orphanSections.length} withdrawn proposal(s) with no surviving owner${ledger.withdrawalCycles ? ` (${ledger.withdrawalCycles} withdrawal cycle(s))` : ''}: ${ledger.orphanSections.join(', ')} - the builder is told to reassign each or drop it, with a reason, in the Scope ledger.`);
        board += `\n\n# Orphaned withdrawals - no surviving owner\n\nThe replacement links for these withdrawn proposals form a cycle or end without reaching a standing proposal: ${ledger.orphanSections.join(', ')}. For each one, either assign the section it covered to something else in the plan, or state explicitly in the Scope ledger that it is dropped and why - do not silently leave it uncovered.`;
      }
    }
  }

  // 2. First build - unless a draft was handed in. Re-running a panel on the
  //    exact draft an earlier run reviewed is the only fair way to compare
  //    panel topologies; a fresh build is a fresh coin toss.
  let draft = initialDraft;
  let buildDisputes = []; // DECLINED lines of the build stage (FX-15), carried into `disputes` below
  // The Scope ledger out of the plan (src/scope-ledger.js; ONE switch, a one-way door at the roles.js re-record). Every writer stage that was ASKED for a ledger (its prompt carried the proposals section) may end its
  // reply with the block; parseDisputes takes it off the draft and the last writer's block REPLACES the held one whole - never merged (owner 28 Okt 2026: judges and builders see only the plan).
  let scopeLedger = null;              // { by: stage label, earlier: [writers before it], lines: the block as written }
  const ledgerFindings = [];           // stage findings for report.lints: a writer that wrote none, a block left in the plan, an id a replacing writer dropped
  const ledgerDropped = new Set();     // messages of the generic 'missing' finding already said by a stage finding (so one id is not reported twice)
  const scoreText = () => (ledgerOutOn() ? (scopeLedger ? scopeLedger.lines.join('\n') : '') : undefined);
  const takeLedger = (parsed, stage, asked) => {
    if (!ledgerOutOn() || parsed.ledger === undefined) return;
    const l = parsed.ledger;
    const say = f => { ledgerFindings.push(f); log(`  ledger check (${stage}): ${f.message}`); };
    if (!asked) { if (l?.block) log(`  ${stage}: a scope ledger in the reply was not asked for; it was taken off the plan and is not recorded.`); return; }
    if (l?.notTaken) say({ id: 'ledger_id', message: LEDGER_MESSAGES.notTaken(stage, l.notTaken) });
    if (l?.block) {
      const prior = scopeLedger;
      scopeLedger = { by: stage, earlier: prior ? [...prior.earlier, prior.by] : [], lines: l.block };
      if (prior) {   // an id the prior ledger had and this one dropped: a finding naming this stage (replace, flag, never merge)
        const idsOf = ls => new Set(ls.map(parseLedgerLine).filter(Boolean).map(e => e.id.toLowerCase()));
        const was = idsOf(prior.lines); const now = idsOf(l.block);
        for (const p of proposals) if (was.has(String(p.id).toLowerCase()) && !now.has(String(p.id).toLowerCase())) { say({ id: 'ledger_id', message: LEDGER_MESSAGES.dropped(stage, p.id) }); ledgerDropped.add(LEDGER_MESSAGES.missing(p.id)); }
      }
    } else if (!l?.notTaken) say({ id: 'ledger_id', message: LEDGER_MESSAGES.none(stage, scopeLedger?.by) });   // a block left in the plan is named above; the stage did write one
    const found = ledgerIdFindings(scopeLedger ? scopeLedger.lines : [], proposals);
    log(`  ledger check (${stage}): ${found.length ? `${found.length} finding(s)` : 'clean'}${found.length ? '' : ' - every proposal has one line'}`);
    found.forEach(f => log(`    LEDGER [${f.id}]: ${f.message}`));
  };
  // The prior ledger, shown to a REVISER as data (C&C ruling 28 Okt 2026: a reviser is a writer and must see what the builder decided). Outside "# Current draft", labelled with the stage that wrote it; absent for the
  // first writer and when there is none. Same switch: a second held name under the one gate.
  const priorLedgerNote = () => {
    const render = ledgerOutOn() ? held('priorLedgerSection') : undefined;
    return typeof render === 'function' && scopeLedger?.lines.length ? `\n\n${render({ by: scopeLedger.by, lines: scopeLedger.lines })}` : '';
  };
  if (draft) {
    log('\nRound 1: build (skipped - reviewing a draft handed in)');
  } else {
    log('\nRound 1: build');
    const built = (await draftStage(config.seats.builder, {
      system: withSplitNote(builderSystemOf(open, promptOpts), 'treeSplitWriterNote'),
      user: swapProposalsSection(R.builderUser({ request, criteria, proposals, board, alternatives: alternativesBoard, skeleton, earlierPlan }), proposals, board),
      log, label: 'build',
    })).text;
    // 0.8.1 FX-15: a builder (an external session above all) may end its reply with DECLINED lines too. They are not part of the draft every critic
    // grades; they go to report.json `disputes` with round 'build'. A reply that is nothing but DECLINED lines leaves no draft: stop, never grade an empty page.
    const parsedBuild = parseDisputes(built, { disputedBlock: false });
    noteLinesIgnored('build', parsedBuild.noteLines, log);
    earlyFinishIgnored('build', parsedBuild.earlyFinish, log);
    takeLedger(parsedBuild, 'build', proposals.length > 0);
    if (!parsedBuild.draft.trim()) throw new DraftTruncated('build', 'its reply held nothing but DECLINED lines, so there is no draft to review', 'declined_only');
    draft = parsedBuild.draft;
    buildDisputes = parsedBuild.disputes;
    buildDisputes.forEach(reason => log(`  declined (build): ${reason}`));
  }

  // v4 item 3: wire the diff_applied fact-check for real. v3 built runVerification's
  // expect.contains/fact marker mechanism, but only ever called it before any diff existed, so
  // "diff_applied" could never be anything but absent. Gated on config.verify_post === true;
  // absent, this never runs and behaviour is byte-for-byte v3's. runVerification is reused
  // unmodified (confirmed by reading it above: it takes a config and re-reads the real
  // filesystem through the same allowlisted tools every time it's called - it has no
  // stage-order-dependent cache, so calling it a second time here, after the build stage's
  // external pause has ingested the operator's already-applied-for-real diff (coder-gate's own
  // documented contract: applying a diff to a real working tree is a human/external action that
  // happens before the builder pastes it back), reads the genuinely post-apply file state).
  // Written to its own field/artifact (ground_truth_post / verify-post.json), never mixed into
  // the pre-build `ground_truth` - so an existing chain's pre-build ground_truth/report.json
  // shape is untouched whether or not verify_post is set.
  let ground_truth_post;
  if (config.verify_post === true) {
    log('\nStage: verify (post-build, against the applied file state)');
    ground_truth_post = runVerification(config, { runTool: config.verify?.runTool, log });
  }

  // v7.x: deterministic plan lints (src/lints.js), gated on config.lints.enabled. Runs here -
  // right after the first build, before any critic sees the draft - so a $0 check catches what
  // it can before a paid critic round is spent on the same plan. Absent/false key: `lints` stays
  // undefined, never added to the returned result, v6 report.json shape unchanged.
  let lints;
  if (config.lints?.enabled) {
    log('\nStage: lints ($0 deterministic checks, before any critic sees the draft)');
    lints = runLints({ deliverable: draft, proposals, forks: config.lints.forks || [], scopeLedger: scoreText() });
    if (lints.length) lints.forEach(l => log(`  LINT [${l.id}]: ${l.message}`));
    else log('  clean - no lint failures.');
  }

  // 2c. Tiered councils: the deep-dive seat (config.deep_dive, src/deep-dive.js). One seat, one job,
  //     its own dollar cap inside the run's, every call through invoke(). It runs on the first
  //     draft, before any anchor reviews it; its findings are not votes (under all-roles its lab may also judge on the panel) and go to the reviser in
  //     one pass (label `deep-dive-revise`), fixed or DECLINED like a critic's, and the anchors
  //     then review that draft. Skipped when a draft was handed in (--from-run, a panel comparison
  //     on a fixed draft), like the proposal stages. Absent or not `true`: nothing here runs, no
  //     stage label appears, and the result carries no `deep_dive` key.
  let deepDive;
  if (config.deep_dive?.enabled === true && !initialDraft) {
    log(`\nStage: deep dive (${shownSeat(config.seats.deep_dive)}/${config.seats.deep_dive.model}, job: ${config.deep_dive.job || 'sources'}, its own cap ${formatUsd(config.deep_dive.usd)})`);
    deepDive = await runDeepDive(config, { request, criteria, draft, invoke, record, parseJson, rethrowControlFlow, log, runSpent: () => budget.spent });
    if (deepDive.findings.length) {
      log(`\nStage: revise (the deep dive's ${deepDive.findings.length} finding(s), before the panel's first review)`);
      const revised = (await draftStage(config.seats.reviser || config.seats.builder, {
        system: reviserSystemOf(false, false)(open, !!fencedSource, promptOpts),
        user: swapProposalsSection(R.reviserUser({ request, criteria, draft, critique: { failures: deepDiveFailures(deepDive), verdict_line: R.deepDiveVerdictLine({ job: deepDive.job, count: deepDive.findings.length }) }, proposals, board }), proposals, board) + priorLedgerNote(),
        log, label: 'deep-dive-revise',
      })).text;
      const parsed = parseDisputes(revised);
      takeLedger(parsed, 'deep-dive-revise', proposals.length > 0);
      noteLinesIgnored('deep-dive-revise', parsed.noteLines, log);
    earlyFinishIgnored('deep-dive-revise', parsed.earlyFinish, log);
      draft = parsed.draft;
      deepDive.revise = { declined: parsed.disputes };
      parsed.disputes.forEach(reason => log(`  declined: ${reason}`));
    }
  }

  // 3. Critic / revise rounds, hard-capped.
  const history = [];
  let passed = false;
  let lastCritique = null;
  let signoff = null;
  const disputes = [];
  buildDisputes.forEach(reason => disputes.push({ round: 'build', reason }));
  // Per-round set of failed criterion strings, and the regressions found from them (2026-09-22).
  const failedByRound = [];
  const regressions = [];
  let noHeardReviewer = null; // set when a panel round heard no reviewer at all - see the panel loop
  // 0.8.3 E2b, the layered review panel (contract Review/Build_0.8.3/m6-closing/Layered_Panel_Contract.md; gate page E2_Gate_Page.md). `layered` = every panel critic carries `layer` (layerProblems guarantees
  // all or none; the length guard because [].every() is true). `layersRecord` is one row per round per layer, kept for the whole run and shared with the partial report, so a stopped run still shows
  // which layer was asked, which was interrupted (`unfinished`) and which never started (`not_asked`). `layerStop` is set when a layer ended the run without an objection and without a usable vote.
  const layered = Array.isArray(config.seats?.critics) && config.seats.critics.length > 0 && config.seats.critics.every(c => c.layer !== undefined);
  const layerNumbers = layered ? [...new Set(config.seats.critics.map(c => c.layer))].sort((a, b) => a - b) : [];
  const layerDebateOn = layered && config.signoff === 'unanimous';   // B2 (debate-084/b2); 0.8.4: part of every layered unanimous chain, there is no switch (it runs only with two heard judges and a standing objection)
  const topLayer = layered ? layerNumbers[layerNumbers.length - 1] : null;
  // Astra #1: an overseer layer ABOVE other layers needs an explicit sign-off from every seat; with one layer a stated pass is clean, exactly as in the unlayered panel.
  const explicitTop = layered && layerNumbers.length >= 2;
  // 0.8.3 E3 (gate page E3_Gate_Page.md, readers audit E3_Readers_Audit.md): on a LAYERED chain with answer_back a judge's open objections persist until that judge is next ASKED, whatever the number of rounds in between
  // (an upper layer is not asked while a lower one objects). Unlayered chains keep the old rule byte for byte: data for the next round only. `answerBackLatest[lab]` then also holds, in memory only, `sawDraft` (the text the lab
  // LAST JUDGED; never in report.json) and a `raised_round` on each objection.
  const retained = answerBackOn && layered;
  const layersRecord = [];
  // E4b unit 2 (conflict decider; gate note m7/A_E4b_Units23_Gate_Note.md): the three captures rule R reads on ANY layered chain (widened from `ledgerOn`, addendum condition 1), and the record of what was decided. `revisedRounds` = the passes
  // that went on to a revise; `heardByRound` is filled below for every layered chain; `decisions` becomes report.json `decisions[]` (additive; present only when a conflict was found). All rebuilt on a resume (the replies, the revise and the conflict stages replay).
  const revisedRounds = []; const decisions = [];
  let unhandledConflicts = null;   // { round, found }: a swing found in a pass that has not been acted on or recorded yet; whatever leaves the pass loop with one still set records it (`loop_ended`): a swing is shown, never dropped
  const layerOf = Object.fromEntries((config.seats?.critics ?? []).filter(c => Number.isFinite(c.layer)).map(c => [seatKeyOf(c), c.layer]));
  const deciderKind = () => { const seat = deciderSeatOf(config); return !seat ? 'none' : seat.provider === 'external' ? 'external' : 'seat'; };
  // A conflict that gets no ruling is still SHOWN: one `decisions[]` row per conflict, with the reason (a swing with no ruler is recorded, never dropped).
  const recordUndecidedConflicts = (found, why, round, ov) => {
    const seat = deciderSeatOf(config);
    for (const it of conflictItems(found, openByRound, { limit: Infinity }).map(bareConflictItem)) decisions.push(decisionRow({ round, overseerRound: ov, item: it, kind: deciderKind(), deciderLab: seat ? labOf(seat) : null, why }));
  };
  // The decider stage (Branch A: an external seat pauses the run, exit 3, NEEDS-conflict-<pass>.md; Branch B: one call through invoke() under the cap; Branch C: no seat, or its prompt is not recorded yet = no call). The label is stable
  // (`conflict-<pass>`), so a resume replays the answer from disk at zero cost. A ruling ANNOTATES and is handed to the reviser as a note; it never closes an objection. Returns the reviser's note ('' when there is none).
  const decideConflicts = async (found, round, ov) => {
    const seat = deciderSeatOf(config);
    if (!seat || !deciderActive(config)) {
      const why = seat ? 'prompt_held' : 'no_decider_seat';
      recordUndecidedConflicts(found, why, round, ov);
      log(`\n  round ${round}: ${found.length} objection(s) came back after the writer revised the plan in response to another layer's objection (a swing between layers); ${seat ? 'the decider\'s prompt is not recorded yet' : 'this chain names no decider'}, so nobody rules on it.`);
      return '';
    }
    const all = conflictItems(found, openByRound, { limit: Infinity }).map(bareConflictItem);
    const items = all.slice(0, MAX_CONFLICTS_PER_CALL);
    const wrap = o => ({ ...o, criterion: R.claimText(o.criterion), problem: R.claimText(o.problem), quote: o.quote ? R.claimText(o.quote) : '' });
    const shown = items.map(it => ({ ...it, objection: wrap(it.objection), others: it.others.map(wrap) }));
    const label = `conflict-${round}`;
    const lab = seatKeyOf(seat);
    log(`\nRound ${round}: ${items.length} objection(s) came back after the writer revised the plan in response to another layer's objection - asking the decider (${lab}).`);
    let rulings = items.map(() => null); let why = 'unreadable_ruling';
    try {
      const st = record(await invoke(seat, { system: held('conflictDeciderSystem')(), user: held('conflictDeciderUser')({ plan: draft, items: shown }) + rulingsNote(round), log, label }));   // B3 prototype: the rulings in force at this pass (empty before the pass a ruling is dated at)
      rulings = readRulings(parseJson(st.text), items);
    } catch (err) {
      // rethrowControlFlow is the FIRST statement (the cap, an external pause, a refused price: not ours to swallow). A stop at the decider stage itself ends the loop before the revise, so the swing is recorded as the stop passes through, for the partial
      // report to show it; an external pause is no end (a resume replays this pass and asks again).
      try { rethrowControlFlow(err); } catch (stop) { if (!(stop instanceof ExternalPause)) recordUndecidedConflicts(found, 'loop_ended', round, ov); throw stop; }
      why = 'decider_unreachable';
      log(`  ${lab}/${seat.model}: no reply from the decider (${String(err.message).slice(0, 120)}) - nobody rules on this swing.`);
    }
    // Unit 3: a ruling that ASKS for the person. A run with a person's recorded choice for this (pass, conflict) applies the CHOICE (and keeps the decider's lean). Otherwise the run stops for the person BEFORE the revise (exit 25); the rows
    // are recorded first, so the partial report carries them. A tree member stops the same way: its tree offers the choice (`council tree decide <tree> --prevail-node <node> --prevail ...`, src/tree-choice.js) and `tree resume` applies it.
    const applied = [];   // { n, prevail, reason } the reviser may be told: only a side, never `neither`
    const asked = [];
    items.forEach((it, i) => {
      const r = rulings[i];
      const common = { round, overseerRound: ov, label, item: it, kind: deciderKind(), deciderLab: lab };
      if (!r) { decisions.push(decisionRow({ ...common, why })); return; }
      if (!r.ask_person) { decisions.push(decisionRow({ ...common, ruling: r })); if (r.prevail !== 'neither') applied.push({ n: it.n, prevail: r.prevail, reason: r.reason }); return; }
      const lean = { decider_prevail: r.prevail, decider_reason: r.reason };
      const choice = conflictChoiceFor(round, it.n);
      if (choice) { decisions.push(decisionRow({ ...common, ruling: { prevail: choice.prevail, reason: '', ask_person: true }, extra: { ...lean, via: choice.via ?? 'cli' } })); if (choice.prevail !== 'neither') applied.push({ n: it.n, prevail: choice.prevail, reason: '' }); return; }
      decisions.push(decisionRow({ ...common, why: 'person_asked', extra: lean }));
      asked.push({ n: it.n, ids: [it.id, ...it.others.map(o => o.id)], labs: [it.lab, ...it.others.map(o => o.lab)], ...([it.seat, ...it.others.map(o => o.seat)].some(Boolean) ? { seats: [it.seat ?? it.lab, ...it.others.map(o => o.seat ?? o.lab)] } : {}), layers: [it.layer, ...it.others.map(o => o.layer)], rounds: [it.round, ...it.others.map(o => o.round)], silent_round: it.silent_round, ...lean });
    });
    for (const it of all.slice(MAX_CONFLICTS_PER_CALL)) decisions.push(decisionRow({ round, overseerRound: ov, label, item: it, kind: deciderKind(), deciderLab: lab, why: 'over_limit' }));
    if (asked.length) throw new ConflictAsked({ pass: round, overseerRound: ov, asked });
    const read = applied;
    return read.length ? (held('reviserDecisionNote')({ rulings: read.map(r => ({ ...r, reason: r.reason ? R.claimText(r.reason) : '' })) }) ?? '') : '';
  };
  // Round semantics 2b: the overseer-round bookkeeping (src/overseer-rounds.js, a pure function of the verdict stream, so a resume re-derives it at zero cost). `round` stays the PASS counter (stage labels never change).
  const ovOn = layered && isOverseerChain(limits);
  let ovState = newRoundState();
  let ovCompleted = 0;
  // The ladder (src/ladder.js; run.json `ladder`, set by --ladder on a start or a resume, NOT part of the chain config, so the stage cache fingerprint is unchanged): from pass credit + 1 on, the layer a pass STARTS at follows Muad's order.
  // It needs a three-layer chain with overseer rounds. Passes up to the credit follow the plain rules, so their prompts are byte-identical and a resume replays them at $0.
  // `ladderSetting`: undefined = the chain decides (a chain file with the `ladder` key runs the ladder, one without runs plain); null = off; an object = the run's own saved numbers (run.json), which win over the key's.
  // EVERY ladder run, keyed or typed with --ladder, has no layer-3 count and no derived pass ceiling (his 10 Nov 2026 word "2: b"): nothing the chain's old keys say (maxOverseerRounds, layerRevisions) bounds a ladder pass. The only bounds are ones a person wrote:
  // the chain's own `maxRounds` (passes; the pass loop ends there as `round_cap`) and a typed `--rounds N` (`ladderRounds`: N overseer rounds, i.e. N layer-3 verdicts; at that bound the existing overseer_cap stop asks, and a continue adds one).
  const ladderChosen = ladderSetting === undefined ? (limits.ladder ? { block: limits.ladder.block, visits: limits.ladder.visits, credit: 0, exchange: 0 } : null) : ladderSetting;
  const ladder = ladderChosen === null ? null : ladderOf(ladderChosen);
  if (ladderChosen !== null && (!ladder || !ovOn)) throw new Error('the ladder needs a three-layer chain with either overseer rounds (maxOverseerRounds and layerRevisions) or the ladder key, and whole numbers for its block, visits and credit');
  if (ladder) maxRounds = Number.isInteger(config.maxRounds) ? config.maxRounds : Infinity;
  let ladderState = ladder ? newLadderState(ladder) : null;
  // B3 prototype (src/rulings.js): the rulings in force at pass `round` (those dated at or before it), as one section appended to a judge's prompt, an exchange prompt and the reviser's prompt; '' when there is none, so a run without a ruling, and every pass before the first ruling's pass, keep their prompts byte for byte.
  const rulingsNote = round => { const inForce = rulingsInForce(rulings, round); return inForce.length ? `\n\n${R.rulingsSection({ rulings: inForce })}` : ''; };
  let ladderAskedUp = false;   // B3 prototype: the pass before was asked to start at layer 3 on request and ended with no judge heard, so the automatic re-ask keeps that floor (derived from the record, so a replay does the same)
  let finishedStop = null;
  const finishedAtOnce = () => finishedStop?.finished_at_once === true || noMoneySitting;   // 0.8.4: the person ended the run at a stop at once (a stop's finish-now), or at the spending limit (the no-money sitting): no judge of the panel is asked again
  // ROADMAP 83 (C&C rulings 20 Okt 2026): the session's early-finish proposal. ELIGIBLE only on a layered chain with overseer rounds whose reviser is the person's OWN session (provider external) AND with both held sentences recorded; otherwise
  // the line is stripped and logged, never acted on (the feature is off until Muad approves the words). `earlyAsk` is set by the revise and consumed by the NEXT pass, which asks the TOP layer only; `earlyFinish` is the run's record when
  // the overseer layer said yes. It is its own variable: finishedStop means a PERSON chose, and the early yes is never lastCritique, a panelVerdicts row, signoff[] or a layers[] row.
  let earlyAsk = null; let earlyFinish = null; let earlyTasks = null; let earlyNothingStands = false;
  const earlyEligible = () => earlyFinishEligible(config);   // 0.8.4 S4: ONE predicate (src/early-finish-eligible.js), the one the route entry also asks; it is exactly `ovOn && layered && an external reviser && both held sentences`
  let layerStop = null;
  // E4 (gate page E4_Gate_Page.md, approved by C&C 14 Oct 2026): the objection ledger the TOP layer reads, on a layered chain with answer_back (`retained`) and at least two layers. Inputs are DERIVED from records the run keeps
  // plus three small captures made at the lines that already read them (all rebuilt on a resume, because the replies and the revise stages replay): ledgerRaises (the judges' OWN raises per round: no carried verdict's failures),
  // heardByRound / notAskedByRound (who gave a new verdict; whose layer was not asked), draftShaByRound (the draft each round judged), draftChangedByRound (did the revise change the draft). The reviser's reasons are read from `disputes`.
  const ledgerOn = retained && layerNumbers.length >= 2;
  const ledgerRaises = []; const heardByRound = {}; const notAskedByRound = {}; const draftShaByRound = {}; const draftChangedByRound = {};
  // The reviser's response per round, derived from `disputes` (every DECLINED reason by round and objection id; rebuilt on a resume) and draftChangedByRound.
  const reviserByRoundOf = () => { const out = {}; for (const d of disputes) (out[d.round] ||= { declined: [], draftChanged: draftChangedByRound[d.round] ?? null }).declined.push({ ...(d.objection_id ? { id: d.objection_id } : {}), reason: d.reason }); for (const rd of Object.keys(draftChangedByRound)) (out[rd] ||= { declined: [], draftChanged: draftChangedByRound[rd] }); return out; };
  let shownLedger = null; // unit 4a: { pass, rows: Map(id -> { lab, status, severity }) } of the ledger the top layer was shown this pass (the re-tags of that pass are checked against it)
  let roundLedger = null; // { text } for the round now being asked: ONE text per round, appended identically at every top-layer call
  // TAGS SHOWN (A-DRAFT): the writer is shown each objection's rating IN FORCE (a layer-3 re-tag included), not the first tag the failure object carries; an objection with no known rating shows none.
  // 0.8.4 S14 (C&C R528, the HOLD): a quote attached in the exchange lives on the failure as `attached_quote`, and the prompts built from the fold (the reviser's failure list, the dispute stage) are built from the failure AS BEFORE S14, without it. Only a held label (test/held-prompts/held-084-s14.js attachedQuoteLabel; S12 chooses the words) lets the prompt show the passage, labelled with those words in the place of the quote-check status. Nothing recorded: the failure goes through without the two attach fields, so the prompt bytes are today's.
  const attachedShown = fs => { const label = held('attachedQuoteLabel')?.(); return inExcerptShown(fs).map(f => { if (f?.attached_quote === undefined) return f; const { attached_quote: aq, quote_attached_in: _in, ...rest } = f; return typeof label === 'string' && label ? { ...rest, quote: aq, quote_status: label } : rest; }); };
  const sevShown = fs => attachedShown(severityOn ? fs.map(f => { const v = f.lab !== undefined && f.id !== undefined ? sevRun.inForce(f.lab, f.id) : null; return v === null ? f : { ...f, severity: v }; }) : fs);
  let layerOneOpen = null; // JUDGE unit L2: { text } for the middle layer now being asked (layer 1's open objections with their ratings); null everywhere else. 0.8.4 S7b adds `ruling` ({ rulable: [{ seat_key, id }], notShown: [{ seat_key, id }] }, in memory only) when the section asks for rulings
  // Notes lane unit 2, judge side (gate note Notes_Lane_Unit2_Gate_Note.md + addendum 1; C&C PASS ON CONDITIONS 15 Okt 2026). Inert unless the chain's `reviewNotes` switch is on AND every lane sentence is held (reviewNotesActive:
  // the same predicate src/cost.js asks). The items are DERIVED, never stored: this loop re-reads each judge reply on a resume (the panel stage files replay), so they rebuild identically. `notesStash` holds, per call
  // (keyed by the stage label), the notes part taken OFF the reply before the verdict was read; a stash whose reply never became a recorded verdict is counted as dropped (`verdict_not_recorded`, with lab and pass).
  const notesCfg = notesConfigOf(config); const notesOn = reviewNotesActive(config);
  const cacheTtl = promptCacheTtl(config);   // CACHE lane unit 2 (src/prompt-cache.js): null = off (every byte as before)
  const markOf = seat => { const ttl = markTtlOf(config, seat); return ttl ? { cacheTtl: ttl } : {}; };   // cache part (b)1: the mark of a laid judge call (src/cache-order-gate.js markTtlOf); the final read and the first-mode critic never ask for it
  const severityOn = ratingsDemanded(config);   // M1 (S19): the rating DEMAND, read once (src/ratings-demand.js): the sentences in every prompt AND the strict refusal of a missing rating; while the held word is not recorded it is false and every prompt is byte-identical to a chain without ratings
  const callGates = callGatesOf(config);   // 0.8.4 S11: the config-level gates of the escalation passes (src/call-gates.js), read ONCE here with ledgerOn and severityOn, as those two were: `goUpOn` is ledgerOn && severityOn
  const sevRun = layerDebateOn ? createSeverityRun() : null;   // unit 3: the run's severity ledger (first valid tag, overrides, withdrawals, the end of each pass), kept on EVERY layered unanimous run (M1: there is no switch); it reads no prompt, so its existence changes no byte a model is sent
  // 0.8.4 S17 (D, found in merged code): the ONE place an answer-back withdrawal that was accepted (a quote found in the draft) is written to the severity ledger, for a full verdict AND for a stated pass that carries `answers`; the stated-pass path used to record the reply row but never the ledger's `withdrawn[]` row (cleared_by 'fix'). `shown`: the objection's rating as the judge holds it.
  const recordAnswerWithdrawal = (lab, r, round, shown) => { if (sevRun && r.effect === 'withdrawn') sevRun.withdraw(lab, r.id, 'answer_back', round, shown, settleStateOf({ answer: r }) === 'fixed' ? 'fix' : 'withdrawal'); };
  const endMarkerOn = draftBoundaryOn(config);   // 0.8.4 D27: the draft boundary (start line, sentence, end line) needs the chain's draft_end_marker switch AND both held words recorded (src/draft-bounds.js); the notes lane is no part of it; off = today's bytes (Review/084/cnc/Boundary_DraftEnd.md)
  const notesItems = []; const notesCut = []; const notesDropped = []; const notesStash = new Map(); const notesUnheardIn = new Map(); const notesCutIn = new Map(); let notesLong = 0;
  const notesRound = round => (ovOn ? ovState.overseerRound : round); // the budget's round: the OVERSEER round on a layered chain, the pass otherwise (gate page section 7)
  // 2b-0b (C&C ruling 16 Okt 2026): a reply the provider cut off at its cap (usage stop length / max_tokens: the stop reason, as M3 decides it, never the 95% guess) never contributes notes, on any path: it can parse from an early fence the model
  // abandoned (M3), and a cut OBJECTION still counts as a verdict, a cut sign-off can be followed by a clean re-ask. Its notes are counted dropped `reply_cut_off` and the seat is not asked for notes again in this overseer round.
  // Every place that puts a parsed reply's notes in the stash comes through here. A chain with the lane off keeps the old stash (its "ignored" count).
  const stashNotes = (lab, round, label, notesReply, usage) => {
    if (!notesReply) return;
    if (notesOn && providerCutOff(usage)) { notesDropped.push({ lab, pass: round, why: 'reply_cut_off' }); notesCutIn.set(lab, notesRound(round)); return; }
    // 2b-1a (C&C ruling 16 Okt 2026): the harness treats a sign-off the provider ended with error / content_filter / refusal like a cut one (an abstention: the reply may not have finished, M4); the M3 principle covers it, so such a reply contributes no notes either.
    if (notesOn && draftIncomplete(usage)) { notesDropped.push({ lab, pass: round, why: 'reply_incomplete' }); notesCutIn.set(lab, notesRound(round)); return; }
    notesStash.set(label, { lab, pass: round, notesReply, label });
  };
  const notesAskNote = (seat, tag, round) => {
    if (!notesOn) return '';   // E195 (A2, 18 Okt 2026): the "lane is off (review notes held)" log line is gone; the four sentences are recorded in src/roles.js, so a chain with the key on always has the lane
    // The first ask of a seat's pass only (condition 1): never a re-ask in the same pass (-reaskN), and not in a later pass of the same overseer round when the seat's last outcome there was unheard or truncated.
    // The bigger-cap retry and the blocking-question attempt build their own prompts below and carry no notes ask. invoke()'s own same-effort retry of an Anthropic seat (src/chain.js, `anthropicSeat && thinking > 0 && cut off`:
    // seats whose provider, or originalProvider under single-vendor transport, is `anthropic`; no shipped tier seat is one, all are OpenRouter ids) resends the SAME prompt at a bigger cap. It fires on a reply cut off after
    // thinking, whether or not any text came back, so after a cut the notes ask may have contributed it can go out a second time: a named known limit (gate note addendum 1, corrected 15 Okt 2026).
    if (tag !== '' || notesUnheardIn.get(seatKeyOf(seat)) === notesRound(round) || notesCutIn.get(seatKeyOf(seat)) === notesRound(round)) return '';
    const lab = seatKeyOf(seat); const r = notesRound(round);
    const left = { proposal: budgetLeft(notesItems, lab, 'proposal', r, notesCfg.perKind), idea: budgetLeft(notesItems, lab, 'idea', r, notesCfg.perKind) };
    if (left.proposal === 0 && left.idea === 0) return '';
    const text = held('reviewNotesAsk')({ proposals: left.proposal, ideas: left.idea, itemChars: notesCfg.itemChars, aboutChars: notesCfg.aboutChars });
    return text ? `\n\n${text}` : '';
  };
  // 2b-1a, the writer side (records only; gate note Notes_Lane_2b1_Gate_Note.md, C&C PASS ON CONDITIONS 16 Okt 2026). The writer's answers are RECORDED, never believed: `notesAnswered` id -> the first answer the writer gave (first wins), with the stage that
  // carried it; a second, different answer for one id is `conflicting` (parseNoteAnswers), an answer naming no item is counted (notesView exclusion). Everything here is derived from the stage files a replay re-reads: no state outside the run.
  const notesAnswered = new Map(); const notesConflicts = new Set(); let notesShownThrough = 0;
  // What the answers did NOT become, counted so nothing the writer wrote disappears silently (report.json review_notes.answer_counts): malformed / repeated / reasonless lines (parseNoteAnswers), and `answered_again` = a later stage gave a DIFFERENT answer for an id already answered (the first answer stands).
  const notesAnswerCounts = { malformed: 0, repeated: 0, reasonless: 0, answered_again: 0 };
  const notesLabs = () => config.seats.critics.map(seatKeyOf);
  const recordNoteAnswers = (noteLines, from, { after = false, ending } = {}) => {
    const parsed = parseNoteAnswers((noteLines || []).join('\n'));
    notesAnswerCounts.malformed += parsed.malformed; notesAnswerCounts.repeated += parsed.repeated; notesAnswerCounts.reasonless += parsed.reasonless;
    for (const [id, a] of parsed.answers) {
      const earlier = notesAnswered.get(id);
      if (!earlier) { notesAnswered.set(id, { ...a, from, ...(after ? { after: true, ending } : {}) }); continue; }
      if (earlier.status !== a.status || (earlier.reason ?? null) !== (a.reason ?? null) || (earlier.same_as ?? null) !== (a.same_as ?? null)) notesAnswerCounts.answered_again += 1;
    }
    for (const id of parsed.conflicts) notesConflicts.add(id);
  };
  const answersArg = () => ({ answers: new Map([...notesAnswered].map(([id, a]) => { const { from, ending, ...rest } = a; return [id, rest]; })), conflicts: [...notesConflicts] });
  const wrapRow = r => ({ ...r, text: R.claimText(r.text), ...(r.about !== undefined ? { about: R.claimText(r.about) } : {}) });
  // The writer's section: the items no revise has shown it yet (sinceLastRevise), not yet answered, grouped by notesView, after the objections. '' unless the lane is on and the held sentence exists.
  const reviseNotesNote = () => {
    if (!notesOn) return '';
    const unseen = sinceLastRevise(notesItems, notesShownThrough > 0 ? [{ pass: notesShownThrough, revised: true }] : []);
    const rows = notesView(unseen, null, { chainLabs: notesLabs(), alreadyAnswered: new Set(notesAnswered.keys()) }).rows.map(wrapRow);
    if (!rows.length) return '';
    const text = held('reviewNotesRevise')?.({ rows });
    return text ? `\n\n${text}` : '';
  };
  // Cross-round memory: from the second overseer round on, every judge's prompt carries the LAST round's items with the writer's answers, cut by fitNotes (40,000 characters / the token estimate); the cut is named in the text and counted.
  // An overflow (the answered rows alone do not fit) sends nothing and logs it. Recomputed per call from the records: deterministic, so a resume builds the same prompt.
  const memoryNote = () => {
    if (!notesOn || !ovOn || ovState.overseerRound < 2) return '';
    const last = lastRoundOf(notesItems, ovState.overseerRound);
    if (last === null) return '';
    const rows = notesView(notesItems.filter(i => i.overseer_round === last), answersArg(), { chainLabs: notesLabs() }).rows.map(wrapRow);
    if (!rows.length) return '';
    const word = held('reviewNotesMemory');
    if (!word) return '';
    const fit = fitNotes(rows, ({ rows: shown, omitted }) => word({ rows: shown, omitted }) ?? '');
    if (fit.overflow) { log('  review notes: the memory block of the last overseer round is over its size limit even cut to the answered rows alone, so none is sent this round; the rows stay in the run log.'); return ''; }
    return fit.text ? `\n\n${fit.text}` : '';
  };
  // 2b-1b helpers. The fold applies only when the lane is on, unanswered items exist, the held sentence exists and the handoff seat is the writer seat (same lab, provider and model). notesFolded = the fold ran this run.
  let notesFolded = false;
  const sameSeat = (a, b) => !!a && !!b && seatKeyOf(a) === seatKeyOf(b) && a.provider === b.provider && a.model === b.model;
  const notesFoldRows = (seat, { standalone = false } = {}) => {
    if (!notesOn || !held('reviewNotesAnswer')) return [];
    const writerSeat = config.seats.reviser || config.seats.builder;
    if (!standalone && !sameSeat(seat, writerSeat)) return [];
    if (standalone && config.handoff && sameSeat(config.seats.handoff || config.seats.builder, writerSeat)) return [];
    // an id the writer already answered (even one whose SAME target is bad, which reads unanswered) is never asked again: the first answer stands, a second would only be counted answered_again
    return notesView(notesItems, answersArg(), { chainLabs: notesLabs(), alreadyAnswered: new Set(notesAnswered.keys()) }).rows.filter(r => r.answer.status === 'unanswered').map(wrapRow);
  };
  // What ended the run's panel, recorded beside an answer given after it (report.json answer.ending): a plain word per ending kind the loop has.
  const notesEnding = () => panelEnding({ passed, finishedStop, earlyFinish, layerStop, noHeardReviewer, notQuorate, escalatedEnd });
  // report.json `review_notes` (additive, present only when the lane ran): the accepted items with who raised the same exact id in the same overseer round, what was cut, what was dropped and why.
  const notesBlock = () => {
    const nv = notesView(notesItems, answersArg(), { chainLabs: notesLabs() });
    const view = new Map(nv.rows.map(r => [r.id, r.answer]));
    const answerOfItem = id => ({ ...(view.get(id) ?? { status: 'unanswered' }), ...(notesAnswered.has(id) && !notesConflicts.has(id) ? { from: notesAnswered.get(id).from, ...(notesAnswered.get(id).ending ? { ending: notesAnswered.get(id).ending } : {}) } : {}) });
    return {
    enabled: true, per_kind: notesCfg.perKind, item_chars: notesCfg.itemChars, about_chars: notesCfg.aboutChars,
    items: notesItems.map(it => ({ ...shownFailure(it), raised_by: [...new Set(notesItems.filter(o => o.id === it.id && o.overseer_round === it.overseer_round).map(o => labFromKey(o.lab)))].sort(), answer: answerOfItem(it.id) })),
    answers_from: [...new Set([...notesAnswered.values()].map(a => a.from))].sort(),
    answer_counts: { unknown_answer_ids: nv.exclusion.unknown_answer_ids, bad_same: nv.exclusion.bad_same, ...notesAnswerCounts },
    cut: notesCut, dropped: notesDropped, long: notesLong,
    };
  };
  let ledgerOffLogged = false;
  // Quorum floor (0.7.8, thc-research brief 11; chain flag `quorum: { minHeard: N }`, off unless a
  // chain sets it, and no shipped chain does). A unanimous sign-off counts only when at least N
  // reviewers gave a verdict (signed off or objected). Today a panel of seven where one seat signs
  // off and six only state a pass reads as unanimous; with a floor, that round is recorded as not
  // quorate and the loop stops the way a round with no heard reviewer does: not agreement.
  const minHeard = Number.isInteger(config.quorum?.minHeard) && config.quorum.minHeard > 0 ? config.quorum.minHeard : 0;
  let notQuorate = null;
  // Every verdict opportunity this run had, one row per seat per round, including seats that were
  // never heard (thrown call, cut off, unreadable, no verdict). Bug-audit fix, 2026-09-23
  // (Review/BugAudit_Metrics_2026-09-23.md #3): verdict-stats used to reconstruct this from stage
  // labels and the LAST round's signoff, so a vote lost in an earlier round - or a thrown call, which
  // leaves no stage - was invisible and usableVerdictRate read 1.0 on runs that lost votes.
  // { round, lab, model, verdict: 'signed_off'|'objected'|'passed'|'unheard', reason_code, reasked }
  const panelVerdicts = [];
  const cutWithdrawn = new Set();   // ruling 19: `${lab}\u0000${id}` of the objections a raiser withdrew in a COMPLETED round of the exchange a finish cut: not open at the finish, held from a finished pass or first raised in the cut pass
  const cutFailures = [];   // PR #2 fix unit, item 2 (his 1:b): the objections of the judges whose rows a finish marked `cut`. A cut row counts for no sign-off and no read; its objections stand OPEN (the report's count, the dispute record's list, the person's accept) and no model is asked about them after the finish
  const ruleCause = stop => ruleStopWords(stop, [...new Set(panelVerdicts.filter(v => v.round === stop.pass && v.verdict === 'unheard').map(v => v.lab))]);   // 0.8.4 S16 (E, WORDING S16-w65d): the labs the record holds unheard in the stop's pass
  const allocatorRounds = [];

  // Dispute stage state (2026-09-20). `dispute` is opt-in, exactly like challenge/coldRead/
  // allocator: a chain that does not set it behaves as it did before this existed, which is
  // why the stall rule is gated on it too rather than silently changing every unanimous run.
  const disputeEnabled = disputeOn(config);
  const disputeReviewEnabled = disputeEnabled && config.dispute?.review === true;
  const stallRounds = stallWindowOf(config);
  const stallBook = createStallBook({ window: Math.max(1, stallRounds), topLayer });   // 0.8.4 S5 (Q13): the PER-OBJECTION stall count (src/stall-book.js), replacing the whole-pass signature list
  const openByRound = [];
  let roundCapReached = null;   // 0.8.4 S4b (C&C's item 3): set at the ONE place the pass loop ends because it used all its passes (below, `round === maxRounds`); the ending exchange's round-cap trigger reads this and nothing else
  let stalled = null;   // a stall that ENDED the loop (dispute.reason "stalled"); an escalated stall is recorded in `escalations` only
  // Stall escalation (shape B, 27 Okt 2026; src/escalation.js, design Review/StallEscalation/Design_2026-10-27.md, C&C rulings of 27 Okt 2026). On a layered chain a stall below the top layer does not end the loop: the stalled pass
  // makes no revise, the next pass asks only the layers from the next one up (the floor; the layers below are `escalated` until the top layer gives a verdict), and the floor layer's seats rule on the stuck objections right after
  // their blind review. All of it is rebuilt on a replay (the panel and rule-* stages replay from disk); nothing new is persisted.
  const escalations = [];   // report.json escalations[] (present only when there is one)
  // 0.8.4 S7b: the rulings layer 2 makes inside its ORDINARY review call (not a pass-up): internal rows shaped like an escalation row ({ round, pass (the pass of the call), to_layer, trigger: 'in_call', ids, outcome: [], rulings: [] }), NEVER printed as escalations[];
  // `rulingRows()` is the one list every reader of a ruling's effect loops over (ruledNow, closedByLaterRuling, closedOnRecord). Rebuilt on a replay from the replayed layer-2 panel stages; nothing new is persisted.
  const inCallRulings = [];
  // 0.8.4 S7c (W41; Q8 item 5 (ii), CA8): layer 3's reasons for an open objection it overruled, shown to the objection's seat in the seat's FIRST review after layer 3 objected and the plan went back. No call, no revision: the seat answers among its ordinary answers.
  // `layerThreeShown`: `${seatKey}\0${id}` -> the round the reasons were first rendered in (a re-ask of that round re-renders them, a later round does not: "answered once"). Written at render, so a seat that stays unheard through every re-ask of that round is not shown them again (named).
  const layerThreeShown = new Map();
  const climbItems = new Map();   // 0.8.4 S8: `${round}\0${seatKey}` -> { items, knownIds, objections } of the list a top-layer seat was shown at its climb verdict (rebuilt on a replay, never persisted)
  // 0.8.4 S8 (c3): the objections EVERY top-layer seat asked in a round sorted may-leave at its climb verdict, read from the top layer's panelVerdicts rows (they replay; nothing is persisted). `closes`: the ruling's own predicate (sevRun.closesOnOverrule: rated below 4 and never 7 or above) says the sorting CLOSES it
  // (D12); otherwise it stays open and is an overrule row of the source below. ONE helper, so the seam (the ones that stay open) and the closing (the ones that close) can never disagree. An unheard seat keeps the objection out (settleRulings counts the asked seats the same way).
  // layer 3's sort of an objection id from its climb verdicts: each top-layer seat's LATEST word on it (a seat's later word replaces only its own earlier word, C&C); must_do when any seat's latest word is must-do; may_leave only when every top seat asked in the newest round sorted it may-leave (the seam's rule);
  // otherwise null (not sorted). { sort, reasons: [{ seat, reason }] }; the reasons are the seats' own words (model text: escaped where they are printed).
  const climbSortOf = id => {
    const latest = new Map();
    for (const r of panelVerdicts) {
      if (!(layered && r.layer === topLayer && !r.carried && !r.cut && Array.isArray(r.sorting))) continue;   // 0.8.4 --finish: a row marked `cut` is a cut-off layer's reply on the record and counts for no sorting word
      const w = r.sorting.find(y => y.id === id); if (!w) continue;
      const k = r.seat ?? r.lab;
      if (!latest.has(k) || r.round >= latest.get(k).round) latest.set(k, { round: r.round, seat: k, sort: w.sort, reason: w.reason });   // the seat KEY in the stored result; the build-check prompt copy below shows it as lab + note
    }
    const words = [...latest.values()];
    if (!words.length) return null;
    const pick = list => list.map(w => ({ seat: w.seat, reason: w.reason }));
    if (words.some(w => w.sort === 'must_do')) return { sort: 'must_do', reasons: pick(words.filter(w => w.sort === 'must_do')) };
    const newest = Math.max(...words.map(w => w.round));
    return climbMayLeaves().some(x => x.id === id && x.rd === newest) ? { sort: 'may_leave', reasons: pick(words.filter(w => w.round === newest)) } : null;
  };
  const climbMayLeaves = () => {
    const out = [];
    const byRound = new Map();
    for (const r of panelVerdicts) if (layered && r.layer === topLayer && !r.carried && !r.cut) { if (!byRound.has(r.round)) byRound.set(r.round, []); byRound.get(r.round).push(r); }
    for (const [rd, rows] of byRound) {
      if (!rows.every(r => (r.verdict === 'signed_off' || r.verdict === 'objected') && Array.isArray(r.sorting))) continue;
      for (const x of rows[0].sorting.filter(y => y.sort === 'may_leave')) {
        const mine = rows.map(r => r.sorting.find(y => y.id === x.id));
        if (!mine.every(y => y && y.sort === 'may_leave')) continue;
        const o = [...climbItems.entries()].filter(([k]) => k.startsWith(`${rd}\u0000`)).map(([, l]) => l.objections.get(x.id)).find(Boolean);
        if (!o || !o.lab) continue;
        const now = sevRun?.inForce(o.lab, x.id);
        const rated = typeof now === 'number' ? now : typeof o.severity === 'number' ? o.severity : null;
        out.push({ rd, id: x.id, o, rated, rows, mine, closes: !!sevRun?.closesOnOverrule(o.lab, x.id, rated) });
      }
    }
    return out;
  };
  // ONE overrule SOURCE (C&C, Q-0; M1 COMPLETE U1-1): "layer 3's overrules of a seat's open blocks", read by W41's display (layerThreeOverrulesOf, below) and by the dissent record (U1-2). The escalation rows feed it, and so does the may-leave sorting of the climb verdict (S8: every top-layer seat asked sorted the objection may-leave), concatenated
  // INSIDE it, so every reader gets those rows too. Source-neutral rows { seatKey, id, rated, ruled_layer, ruled_round, reasons: [{ lab, text }], topState (the top layer's layer-row state in the ruling pass), source, records } (`records`: the objects that take `reasons_shown_in` when the raiser is shown the reasons: an escalation's outcome row, or the sorting row of each top-layer seat);
  // NO display filter here: the ruling layer is the top layer, the objection is not closed by the ruling (rated 4 or above, unrated, or once rated 7+), and that is all. ONE row per seat, id and round: when an escalation ruling and a sorting both exist for the same seat, id and round, the row is the escalation's (the formal disposition); the sorting reason stays on the verdict row.
  const layerThreeOverrulesSource = () => {
    const out = [];
    for (const e of escalations) {   // S8: the sorting rows are concatenated here
      if (e.to_layer !== topLayer) continue;
      const topState = layersRecord.find(r => r.round === e.pass && r.layer === topLayer)?.state;
      for (const o of e.outcome) {
        const seatKey = o.seat ?? o.lab;
        if (o.result !== 'overruled' || closedByRowRuling(e, seatKey, o.id)) continue;
        const now = sevRun?.inForce(seatKey, o.id);
        const rated = typeof now === 'number' ? now : typeof o.rated === 'number' ? o.rated : null;
        out.push({ seatKey, id: o.id, rated, ruled_layer: e.to_layer, ruled_round: e.pass, reasons: e.rulings.filter(r => r.id === o.id && r.ruling === 'overrule' && r.reason).map(r => ({ lab: labFromKey(r.lab), ...(labFromKey(r.lab) !== r.lab ? { seat: r.lab } : {}), text: R.claimText(r.reason) })), topState, source: 'escalation', records: [o] });   // `record`: the row that carries `reasons_shown_in` (S8's sorting rows bring their own)
      }
    }
    // 0.8.4 S8 (money step; C&C Q1 (i)): the may-leave sorting of the climb verdict, derived from the top layer's panelVerdicts rows (they replay, so nothing new is persisted). An objection enters when EVERY top-layer seat heard in that round sorted it may-leave
    // (every seat asked: so "overruled by every judge of layer 3" stays true, as settleRulings counts it) and the ruling does not close it: the same predicate as the escalation rows (sevRun.closesOnOverrule: below 4 and never 7 or above closes it, and then it is no overrule row). Must-do rows are not overrules.
    const ruledAlready = new Set(out.filter(r => r.source === 'escalation').map(r => `${r.seatKey}\u0000${r.id}\u0000${r.ruled_round}`));   // the escalation is the ruling of record for an objection it ruled in the same round: its reasons and its `records` stand (the sorting reason stays on the verdict row)
    for (const x of climbMayLeaves()) {
      if (x.closes || ruledAlready.has(`${x.o.lab}\u0000${x.id}\u0000${x.rd}`)) continue;
      const topState = layersRecord.find(l => l.round === x.rd && l.layer === topLayer)?.state;
      out.push({ seatKey: x.o.lab, id: x.id, rated: x.rated, ruled_layer: topLayer, ruled_round: x.rd, reasons: x.rows.map((r, i) => ({ lab: r.lab, text: R.claimText(x.mine[i].reason) })).filter(e => e.text), topState, source: 'sorting', records: x.mine });
    }
    return out;
  };
  // W41's DISPLAY filters over the source: this seat, a later round than the ruling, and the top layer OBJECTED in the pass that ruled (a sign-off, or a handler's `not yet` after one, shows nothing). The caller (layerThreeNote) adds: the seat is below the top layer, the objection is still open, and once.
  const layerThreeOverrulesOf = (seatKey, atRound) => {
    const byId = new Map();   // one row per id, the later ruling wins (by trace a second layer-3 row for one (seat, id) needs a review of the seat in between, which shows or closes it: defensive)
    for (const r of layerThreeOverrulesSource()) if (r.seatKey === seatKey && atRound > r.ruled_round && r.topState === 'objected') byId.set(r.id, r);
    return [...byId.values()];
  };
  const rulingRows = () => [...escalations, ...inCallRulings];
  const escalatedFailures = new Map();   // escalations[] row -> the passed-up objections in full (criterion, problem, quote), for the dispute stage's standing dissent; in memory only
  let escalation = null;    // the one in force: { row, floor, items, rounds, ruled }
  let adoptedNow = [];      // this pass's sustained objections, each under the seat that sustained it
  let escalatedEnd = null;  // the top layer signed off with layers below the floor: the `escalated_signoff` ending (passed stays false)
  let agreementPoint = null;   // 0.8.4 S4 (CA4, D38): layer 3's sign-off on a layered run (every layer, the ladder's, or an escalated one): { pass, kind: 'full' | 'ladder' | 'escalated', sha: the id of the plan layer 3 signed }; the `ending` record rests on it
  // FIX F1: an UNQUOTED id that its raiser raised again after the ruling counted as a live objection (raised_again counted: true); from then on the ruling no longer closes it for that raiser (the raiser filter, the ledger, the dispute stage).
  const reopenedAfter = (row, seatKey, id) => (row.raised_again || []).some(r => r.counted && r.id === id && (r.seat ?? r.lab) === seatKey);
  // ---- 0.8.4 S4 (CA4, D15, W33; src/build-check.js, src/ending.js): the BUILD CHECK at layer 3's sign-off. Live only when the build-check wording is recorded (ONE held read, C&C's Q-a ADDENDUM) and the chain has a handling session. An EXTERNAL stage `build-check-<n>`
  // (the `answers` stage's shape): the run writes the check and waits (ExternalPause, exit 3); the handler's answer is build-check-<n>.md. An answer that does not name every demanded id counts as no answer: it is set aside (cache.invalidate: superseded/, never deleted) and the run waits again.
  // No API call, no revision, no counter is used by asking. `n` counts the agreement points of this run in order, so a resume replays every earlier answer from disk and asks nothing twice.
  let buildCheckSeq = 0; const buildChecks = []; let handlerBlocks = null;
  let retagPickSeq = 0;   // 0.8.4 (A5): the pick waits of this run in the order they are asked (`retag-pick-<n>`); a resume asks them in the same order, so the labels repeat
  // 0.8.4 S18 (C&C's L- ruling): every late finding a build check demanded, by id, with the numbers of the checks that demanded it. Built by askBuildCheck, which a resume re-runs from the replayed passes in pass order (the checks are rebuilt from the stage files like build_checks), so nothing is written from process memory; at the end a demanded id that the last verdict no longer carries is reported as a dropped row, so build_checks[].required always resolves.
  const lateDemanded = new Map();
  const lateRetagsConsumed = new Set();   // the handler's late-finding re-tags askBuildCheck took (applied or refused), by `${pass}\u0000${id}`: the rest are refused at the end (no_check_at_pass), so a miscomputed pass shows instead of disappearing
  const openAtAgreement = ({ round, failures }) => {
    // every open objection at the sign-off (M1: layer 3 sorts nothing yet, so each counts as must-do, below 4 included; C&C's Q-g interim, fail closed). An overrule closes an id only when it was rated below 4 and never 7 or above (W33: an overrule does not close one rated 4 or above, or without a rating);
    // a sustained original is retired as adopted (its adopted copy is listed under the sustaining seat).
    const closed = new Set(ruledNow().map(({ o }) => `${o.seat ?? o.lab}\u0000${o.id}`));
    const layerMap = Object.fromEntries(config.seats.critics.map(c => [seatKeyOf(c), c.layer]));
    const out = new Map();
    const put = (lab, id, f) => {
      const key = `${lab}\u0000${id}`; if (closed.has(key)) return;
      if (out.has(key)) { out.set(key, withAnchor(out.get(key), f)); return; }   // 0.8.4 S8 c2b: the same objection from a second record (the ledger row, then the failure): a quote the first lacked fills it
      const sev = sevRun?.inForce(lab, id) ?? f.severity;
      out.set(key, withAnchor({ id, lab, layer: layerMap[lab] ?? null, ...(Number.isInteger(f.first_round) ? { first_round: f.first_round } : {}), ...(readSeverity(sev).ok ? { severity: sev } : {}), flags: exchangeCarried.get(lab)?.has(id) ? ['not debated'] : [], problem: String(f.problem ?? f.criterion ?? '') }, f));   // the anchor (a quote, or `unanchored: true`) is read by src/anchor.js from the record this came from
    };
    if (ledgerOn) for (const r of objectionLedger({ openByRound: ledgerRaises, replies: answerBackReplies, reviserByRound: reviserByRoundOf(), draftShaByRound, heardByRound, notAskedByRound, layerOf: layerMap, currentRound: round + 1 })) if (r.status === 'active') put(r.raised_by.lab, r.id, r);
    for (const f of failures) put(f.lab, f.id, f);
    // 0.8.4 S8 (c3): an item carries layer 3's sorting where it has sorted (`sorted`: its sort and the reasons, each top seat's latest word, any must-do winning). NOTHING leaves this list because of a sorting: a below-4 objection stays on every list until the closing read closes it on the record (FEATURE_SPECS l.532; a not_yet
    // continues the run on revised text). An item layer 3 has not sorted is as it was: it counts as must-do.
    return [...out.values()].map(i => { const s = climbSortOf(i.id); return s ? { ...i, sorted: s } : i; }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  // 0.8.4 S18 (D34, RU-S18-08, T15n; the order of S18_CARRY item 3): the late findings a top-layer seat named only in its sorting at its LAST verdict, in ONE function. The build check reads it at an agreement point (layer 3's signing verdict IS its last read there:
  // the final read makes no call, chain.js final-read block) and the end of the run reads it again after the loop, so the id a check demanded is the id the record carries (assignLateFindingIds is pure over this list).
  const climbLateFindings = () => {
    if (!layered || !topLayer) return [];
    const lastOf = new Map();   // top-layer seat key -> its newest non-carried, signed-off-or-objected row: that seat's LAST verdict
    for (const r of panelVerdicts) if (r.layer === topLayer && !r.carried && !r.cut && (r.verdict === 'signed_off' || r.verdict === 'objected')) { const k = r.seat ?? r.lab; if (!lastOf.has(k) || r.round >= lastOf.get(k).round) lastOf.set(k, r); }
    const out = [];
    for (const [seat, r] of lastOf) if (Array.isArray(r.sorting_new) && r.sorting_new.length) out.push(...sortingFindingsOf({ perSeat: [{ seat, fresh: r.sorting_new }], groundedWhy: q => lateUngroundedWhy(q, normQuoteTight(draft)), round: r.round, found: 'last_verdict', flag: 'named_in_sorting' }));
    // 0.8.4 S18 (T18j, WORDING S18-w18b): an UNANCHORED failure a top-layer seat sorted must-do at its last verdict is recorded as a late finding, one per failure, linked to it (the failure stays open, flagged, with the sorting as a record only)
    const unRows = []; const unSet = new Set(); const unObj = new Map(); const unProb = new Map(); let unRound = 0;
    for (const [seat, r] of lastOf) { const list = climbItems.get(`${r.round}\u0000${seat}`); if (!list || !list.unanchored.size || !Array.isArray(r.sorting)) continue; unRows.push({ seat, rows: r.sorting }); for (const id of list.unanchored) { unSet.add(id); unObj.set(id, list.objections.get(id)); unProb.set(id, list.problems.get(id)); } unRound = Math.max(unRound, r.round); }
    if (unRows.length) out.push(...lateFromUnanchored({ perSeat: unRows, unanchored: unSet, objections: unObj, problems: unProb, round: unRound, found: 'last_verdict', flag: 'named_in_sorting' }));
    return out;
  };
  // 0.8.4 S18 (spec l.1486, D31, W40; T21bi): the wait for the handler's sorting of ONE objection of the final read (one wait per open objection, `sort-<n>`): an external stage (the build check's shape): no call, nothing re-sent, no choice of ending and no continue. An answer that omits the id, the sorting or the reasons is no answer: it is set aside, counted as a refusal row (label sort-<n>), and the wait stays.
  const askHandlerSort = async ({ n, id, split }) => {
    const label = handlerSortLabel(n);
    const f = (split.objector.failures || []).find(x => x.id === id) || {};
    const objection = { id, seat: split.objector.seat ?? split.objector.lab, rating: typeof f.severity === 'number' ? f.severity : null, criterion: R.claimText(String(f.criterion ?? '')), problem: R.claimText(String(f.problem ?? '')), ...(f.quote ? { quote: R.claimText(String(f.quote)) } : {}) };
    const { system, user } = handlerSortPrompt({ layer: topLayer, plan: draft, objection, signedBy: split.signed });
    let answered = cache.get(label);
    if (answered) {
      const verdict = cacheVerdict(answered, promptHashOf(system, user));
      // the build check's rules for an external answer, mirrored (T14 wording ledger, the kept-answer test, the unverified replay)
      if (verdict.status === 'stale' && !(verdict.cause === 'prompt' && judgeHandlerSort(answered.text, id).ok && keepsEarlierWording(label, answered, log, { direct: true }))) {
        cache.invalidate?.(label, `${verdict.why} (the handler's answer was set aside)`); log(`  CACHE STALENESS WARNING: stage "${label}" - ${verdict.why}; the old answer was set aside and the handler is asked again.`); answered = null; wordingLedger?.note({ label, live: true });
      } else if (verdict.status === 'unverified') {
        cache.warn?.(label, verdict.why); log(`  CACHE: stage "${label}" replayed UNVERIFIED - ${verdict.why}. Recorded in WARNINGS.md and report.json.`);
      }
    }
    if (answered) {
      if (wordingLedger) { const st = stampOfHit(answered, answered.text); wordingLedger.note({ label, writtenBy: st.writtenBy, textOk: st.textOk, live: false }); cache.stampUse?.(label, answered.text); }
      const j = judgeHandlerSort(answered.text, id);
      if (j.ok) { log(`  sort wait ${n}: the handler answered ${j.sort}.`); showExcerptsAfter(label); return { id, sort: j.sort, reasons: j.reasons }; }   // A-DRAFT (WORDING S18-w21); read outside invoke() too: record() never sees this stage, so the excerpts its answer carried are shown from the next call on
      const why = j.why === 'unreadable' ? 'it is neither must_do nor may_leave' : j.why === 'no_reasons' ? 'a sorting needs its reasons' : `it does not name ${j.missing.join(', ')}`;
      cache.invalidate?.(label, `the handler's answer was refused: ${why}`, 'build_check_refused', { n, label, pass: finalPanelRound ?? 1, why: j.why, missing: j.missing ?? [], required: [id] });
      log(`  sort wait ${n}: the handler's answer was refused (${why}); it counts as no answer and was set aside. Waiting for a new one.`);   // A-DRAFT
      wordingLedger?.note({ label, live: true });
    }
    scanned(label, { system, user });
    throw new ExternalPause(label, system, user);
  };
  // 0.8.4 (A5, his 03 Nov 2026 17:39 "Handler picks by reasoning"; src/retag-pick.js): the wait for the handling session's pick between two top-layer re-rates of ONE objection (one wait per such objection, `retag-pick-<n>`): the sort wait's mechanism (an external stage: no call, nothing re-sent,
  // no choice of ending and no continue), asked at the settle of the pass before anything is put in force. An answer that is not one of the offered ratings, or has no reasons, or does not name the id, is no answer: it is set aside and the wait stays.
  const askRetagPick = async ({ n, conflict, row }) => {
    const label = retagPickLabel(n); const id = conflict.id; const offered = conflict.options.map(o => o.to);
    const objection = { id, lab: conflict.lab, from: conflict.from, criterion: R.claimText(String(row?.criterion ?? '')), problem: R.claimText(String(row?.problem ?? '')), ...(row?.quote ? { quote: R.claimText(String(row.quote)) } : {}) };
    const options = conflict.options.map(o => ({ seat: o.seat, to: o.to, reason: R.claimText(String(o.reason ?? '')) }));
    const { system, user } = handlerRetagPickPrompt({ layer: topLayer, plan: draft, objection, options });
    let answered = cache.get(label);
    if (answered) {
      const verdict = cacheVerdict(answered, promptHashOf(system, user));
      if (verdict.status === 'stale' && !(verdict.cause === 'prompt' && judgeRetagPick(answered.text, id, offered).ok && keepsEarlierWording(label, answered, log, { direct: true }))) {
        cache.invalidate?.(label, `${verdict.why} (the handler's answer was set aside)`); log(`  CACHE STALENESS WARNING: stage "${label}" - ${verdict.why}; the old answer was set aside and the handler is asked again.`); answered = null; wordingLedger?.note({ label, live: true });
      } else if (verdict.status === 'unverified') {
        cache.warn?.(label, verdict.why); log(`  CACHE: stage "${label}" replayed UNVERIFIED - ${verdict.why}. Recorded in WARNINGS.md and report.json.`);
      }
    }
    if (answered) {
      if (wordingLedger) { const st = stampOfHit(answered, answered.text); wordingLedger.note({ label, writtenBy: st.writtenBy, textOk: st.textOk, live: false }); cache.stampUse?.(label, answered.text); }
      const j = judgeRetagPick(answered.text, id, offered);
      if (j.ok) { log(`  retag pick ${n}: the handler picked ${j.to} for ${id}.`); showExcerptsAfter(label); return { id, to: j.to, reasons: j.reasons }; }   // A-DRAFT
      const why = j.why === 'unreadable' ? 'it does not start with a rating' : j.why === 'not_offered' ? `${offered.join(' and ')} are the ratings to pick from` : j.why === 'no_reasons' ? 'a pick needs its reasons' : `it does not name ${j.missing.join(', ')}`;
      cache.invalidate?.(label, `the handler's answer was refused: ${why}`, 'retag_pick_refused');
      log(`  retag pick ${n}: the handler's answer was refused (${why}); it counts as no answer and was set aside. Waiting for a new one.`);   // A-DRAFT
      wordingLedger?.note({ label, live: true });
    }
    log(`  retag pick ${n}: ${conflict.options.map(o => `${o.seat} re-rated ${id} to ${o.to}`).join(' and ')}; the handler is asked to pick one.`);   // A-DRAFT
    scanned(label, { system, user });
    throw new ExternalPause(label, system, user);
  };
  const askBuildCheck = async ({ round, kind, failures, verdicts = [] }) => {
    if (!layered || !buildCheckLive() || !hasHandlingSession(config)) return null;
    const n = ++buildCheckSeq; const label = buildCheckLabel(n);
    const items = openAtAgreement({ round, failures });
    // 0.8.4 S8 (c3): the handler is shown every open objection, but is NOT demanded to answer for one that every top-layer seat asked sorted may-leave and that the ruling's own predicate would close (rated below 4, never 7 or above): it is shown with its sort and reasons; the closing read closes it on the record.
    // 0.8.4 S18 (D34, RU-S18-01/08, T15n, T21aa): the late findings of layer 3's last verdict are shown and EVERY one is demanded, whatever its rating or sorting (a separate list: they never pass through the may-leave exemption, which closes only a block rated below 4); the shown list is in rating order, 4 or above first (D24, readOrder).
    const lateFound = assignLateFindingIds(climbLateFindings()).map(lateFindingRow);
    const late = lateFound;
    for (const l of late) { const e = lateDemanded.get(l.id); if (e) { if (!e.checks.includes(n)) e.checks.push(n); } else lateDemanded.set(l.id, { row: l, checks: [n] }); }
    const demandedObjections = buildCheckDemanded(items, i => !!sevRun?.closesOnOverrule(i.lab, i.id, typeof i.severity === 'number' ? i.severity : null));
    // 0.8.4 S18 (T18t, WORDING S18-w3b/w19): a late finding made from an unanchored failure that the check demands anyway is the SAME ground: the pair is named once, by either id (the failure's id stays the required one; the late finding's id satisfies it). Any other late finding is demanded itself.
    const pairedLate = new Map(late.filter(l => typeof l.linked_to === 'string' && demandedObjections.includes(l.linked_to)).map(l => [l.linked_to, l.id]));
    const ids = [...demandedObjections, ...late.filter(l => !(typeof l.linked_to === 'string' && demandedObjections.includes(l.linked_to))).map(l => l.id)];
    const aliases = new Map([...pairedLate].map(([objId, lateId]) => [objId, [lateId]]));
    // 0.8.4 S18 (W33 (3), WORDING S18-w2c/w2d): layer 3's final statement = each top-layer seat's own closing words from its signing verdict (`critique.verdict_line`, capped at 8,000 characters by capField), read from the parsed verdicts of the sign-off pass (a resume replays them from the stage files; no new
    // report field). Source per seat: `critique.verdict_line` (the full signing verdict), else nothing (the held "no statement given" line), capped at 8,000 characters by capField. There is NO pass_reason branch: with two or more layers the top layer signs only with an explicit `critique.meets === true` (layerState explicit, chain.js:5500; explicitTop, :4388), so a stated pass is never a top-layer sign-off and never reaches a check. ON THIS TEXT ONLY: the pass whose draft this is. The words are model text: escaped here, put in the container by the held text. At an agreement point that verdict IS the final read (no call).
    const statements = draftShaByRound[round] === draftIdOf(draft)
      ? (verdicts || []).filter(v => v.seat?.layer === topLayer && !v.abstained && v.critique?.meets === true).map(v => ({ lab: labOf(v.seat), ...(seatField(v.seat).seat ? { seat: seatField(v.seat).seat } : {}), verdict: 'signed_off', words: R.claimText(String(v.critique.verdict_line ?? '').trim()) }))
      : [];
    const { system, user } = buildCheckPrompt({ layer: topLayer, plan: draft, statements, items: items.map(i => ({ ...(i.sorted ? { ...(pairedLate.has(i.id) ? { linkedLate: pairedLate.get(i.id) } : {}), ...i, sorted: { ...i.sorted, reasons: i.sorted.reasons.map(r => ({ ...r, seat: shownKey(r.seat), reason: R.claimText(r.reason) })) } } : i), problem: R.claimText(i.problem) })),
      late: readOrder(withRatingsInForce(late, sevRun?.retagsSoFar() ?? [])).map(l => ({ ...l, problem: R.claimText(l.problem), ...(l.sorted ? { sorted: { ...l.sorted, reasons: (l.sorted.reasons || []).map(r => ({ ...r, reason: R.claimText(r.reason) })) } } : {}) })) });   // 0.8.4 S8 c3: layer 3's reasons are model text: escaped here (the held line adds the container)
    // 0.8.4 S18 (Q3 (a), T21ab, WORDING S18-w16/w17): the handler's re-tags of THIS pass that name a late finding apply HERE, after the check's text is made (so the text, and the prompt hash the handler's answer is held to, is the same on every resume) and before the answer is judged. The ledger gets the finding's rating as found (seedFound: no override row); a re-tag of a finding a check demanded that the last verdict no longer carries, or of an unrated one, is refused with its reason (retags_refused), never dropped.
    if (sevRun) {
      for (const r of retagsAtPass(retags, round).filter(x => String(x?.id).startsWith('L-'))) {
        lateRetagsConsumed.add(`${r.pass}\u0000${r.id}`);
        const row = late.find(l => l.id === r.id);
        if (!row) { if (lateDemanded.has(r.id)) sevRun.refuseHandler(round, r, 'late_finding_dropped'); else sevRun.applyHandlerRetags(round, [r]); continue; }
        if (typeof row.rating !== 'number') { sevRun.refuseHandler(round, r, 'not_rated'); continue; }
        sevRun.seedFound(row.lab, row.id, row.rating, round);
        sevRun.applyHandlerRetags(round, [r]);
      }
    }
    let answered = cache.get(label);
    if (answered) {
      const verdict = cacheVerdict(answered, promptHashOf(system, user));
      // decided only for an answer that judges ok under the CURRENT ids: a kept answer is never refused afterwards (a refusal would leave a kept line, a report row and a build_check_refused line for one stage). One that does not judge ok is set aside as before.
      if (verdict.status === 'stale' && !(verdict.cause === 'prompt' && judgeBuildCheck(answered.text, ids, aliases).ok && keepsEarlierWording(label, answered, log, { direct: true }))) {
        cache.invalidate?.(label, `${verdict.why} (the handler's answer was set aside)`);
        log(`  CACHE STALENESS WARNING: stage "${label}" - ${verdict.why}; the old answer was set aside and the handler is asked again.`);
        answered = null;
        wordingLedger?.note({ label, live: true });   // 0.8.4 T14: as for `answers` above
      } else if (verdict.status === 'unverified') {
        cache.warn?.(label, verdict.why);
        log(`  CACHE: stage "${label}" replayed UNVERIFIED - ${verdict.why}. Recorded in WARNINGS.md and report.json.`);
      }
    }
    if (answered) {
      // 0.8.4 T14: as for `answers`: the record read is the pause's `<label>.prompt.json`; a refused answer (below) is noted live once it is set aside.
      if (wordingLedger) { const st = stampOfHit(answered, answered.text); wordingLedger.note({ label, writtenBy: st.writtenBy, textOk: st.textOk, live: false }); cache.stampUse?.(label, answered.text); }
      const j = judgeBuildCheck(answered.text, ids, aliases);
      if (j.ok) {
        const row = { n, label, pass: round, kind, signed_sha: draftIdOf(draft), required: ids, answer: j.answer, reasons: j.reasons };
        buildChecks.push(row);
        log(`  build check ${n}: the handler answered ${j.answer}.`);   // A-DRAFT
        showExcerptsAfter(label);   // read outside invoke() too: record() never sees this stage
        return row;
      }
      const why = j.why === 'unreadable' ? 'it is neither good_to_build nor not_yet' : j.why === 'no_reasons' ? 'a not_yet needs its reasons' : `it does not name ${j.missing.join(', ')}`;
      cache.invalidate?.(label, `the handler's answer was refused: ${why}`, 'build_check_refused', { n, label, pass: round, why: j.why, missing: j.missing ?? [], required: ids });   // 0.8.4 S18 (Q5 (a)): the row of the refusal is written beside the set-aside files (report.json `build_check_refusals`, derived from the run folder)
      log(`  build check ${n}: the handler's answer was refused (${why}); it counts as no answer and was set aside. Waiting for a new one.`);   // A-DRAFT
      wordingLedger?.note({ label, live: true });
    }
    if (outboundScan.finish && scanPhase === 'loop') throw new SecretFinish(label, outboundScan.atOnce === true, outboundScan.relayed === true);   // the finish is armed for this call too (it bypasses invoke)
    if (spendFinish && scanPhase === 'loop') throw new SpendFinish(label, spendFinish.capName, spendFinish.atOnce, spendFinish.relayed);   // 0.8.4 S16 (F)
    scanned(label, { system, user });
    throw new ExternalPause(label, system, user);
  };
  // 0.8.4 S5 U-B (RU-ADD-A7, Q12, N25, T20i; C&C 05 Nov 2026): the ONE test of "did this ruling close the objection on the record". A sustain moves it to the sustaining seat (the original is closed); an overrule closes it ONLY when the objection is rated below 4 now and
  // was never rated 7 or above (severity.js closesOnOverrule: the rating in force at READ time, so a later handler re-tag below 4 closes it); an overrule of an objection rated 4 or above, or not rated, leaves it OPEN under its id; an undecided ruling leaves it standing.
  // Every reader of a ruling's effect goes through this one function (the raiser filter, the ledger filters, the answer-back entry, the open sets); nobody repeats the rating test.
  const closedByRuling = o => o.result === 'sustained' || (o.result === 'overruled' && !!sevRun?.closesOnOverrule(o.seat ?? o.lab, o.id, o.rated));   // 0.8.4 S7b: the outcome row's own `rated` is the pending rating for an id whose first tag is not committed yet (the same pass); a committed value is never overridden
  const closedByRowRuling = (e, lab, id) => !reopenedAfter(e, lab, id) && e.outcome.some(o => o.id === id && (o.seat ?? o.lab) === lab && closedByRuling(o));   // ONE spelling of 'this escalation's ruling closed the id and its raiser has not reopened it' (an unquoted re-raise reopens it)
  const ratedOf = f => { const v = sevRun ? (sevRun.inForce(f.lab, f.id) ?? f.severity) : f.severity; return typeof v === 'number' ? v : null; };   // the rating an objection stands at (null = not rated: it counts as 4 or above)
  const adoptedHolds = f => !sevRun || holdsSignOff(f.severity);   // a sustained objection holds its seat's layer unless it is rated below the line; the adopted copy carries the ORIGINAL's rating (the sustaining seat gave none)
  // ruledNow is the same meaning as closedByRowRuling in PAIR form (the ledger filters need the outcome row too): closed by a ruling and not reopened by its raiser (`!reopenedAfter`).
  const ruledNow = () => rulingRows().flatMap(e => e.outcome.filter(o => closedByRuling(o) && !reopenedAfter(e, o.seat ?? o.lab, o.id)).map(o => ({ e, o })));   // the ids a ruling closed or moved, as the top layer's ledger filters them (JUDGE unit L2 shares it)
  // the escalations[] rows as the report prints them: an OVERRULED row says whether the objection stays open AS OF NOW (the end of the run), through the one predicate; nothing writes it at the ruling
  // 0.8.4 S7b A4: the layers[] rows as the report prints them: an overruled in-call ruling gets `stays_open` from the rating in force NOW (as escalationsRecord does for a stall ruling). With no in-call ruling it is layersRecord itself.
  const layersRecordOut = () => (layersRecord.some(r => r.rulings_in_call) ? layersRecord.map(r => (r.rulings_in_call ? { ...r, rulings_in_call: r.rulings_in_call.map(o => (o.outcome === 'overruled' ? { ...o, stays_open: !closedByRuling({ result: 'overruled', seat: o.seat, lab: o.lab, id: o.id, rated: o.rated }) } : o)) } : r)) : layersRecord);
  const escalationsRecord = () => escalations.map(e => ({ ...e, outcome: e.outcome.map(o => (o.result === 'overruled' ? { ...o, stays_open: !closedByRuling(o) } : o)) }));

  // R1 (the owner's yes, 2026-09-28): a round that ended with every heard reviewer clean and a seat
  // still unheard re-reviews an unchanged draft. The heard seats' verdicts on that exact text are
  // carried into the next round and only the unheard seat(s) are asked again - "this bounds what the
  // run pays to re-review a draft nobody asked to change; it is not an early stop, the debate and the
  // round cap are untouched, and silence is still never consent." Carried only when the text the
  // reviewers are shown is byte-identical; unanimity still needs every seat heard and clean on it.
  let carry = null;

  // 0.8.4 (found-secret pause, --finish): what the catch around a pass needs to know about the pass it ends. passReviewed = the number of the pass whose panel was recorded (recordPanelRound / lastCritique);
  // passOv = the overseer round the pass BELONGS to, taken at the pass top (ovState moves on after the panel, so reading it in the catch could name the next round).
  let passReviewed = 0;
  let passOv = 0;
  // The stop a --finish leaves: which layers of the pass were ASKED (answered and on the record) and which were not. `reviewed` is 'all' (every layer of the pass answered, or an unlayered panel recorded), 'part' (some
  // layers answered) or 'none'; a layer cut off by the finish ends `unfinished` (`cut_layers`) and one never reached stays not_asked in layers[]; the words say "cut off" or "not asked in this pass", never "did not sign off".
  const secretStopFor = (round, label, err = null) => {
    if (err instanceof SpendFinish) return { kind: 'budget_stop', pass: round, overseer_round: passOv, label, chosen: 'finish', ...(err.atOnce ? { finished_at_once: true } : {}), ...(err.relayed ? { relayed: true } : {}), ...(err.capName ? { cap_name: err.capName } : {}) };   // 0.8.4 S16 (F; WORDING S16-w60): no reviewed/asked/cut fields - the layers record says which layers answered
    const rows = layersRecord.filter(r => r.round === round);
    const asked = rows.filter(r => r.state !== 'not_asked' && r.state !== 'unfinished' && r.state !== 'escalated').map(r => r.layer);
    const cut = rows.filter(r => r.state === 'unfinished').map(r => r.layer);
    const notAsked = rows.map(r => r.layer).filter(l => !asked.includes(l) && !cut.includes(l));
    // 'signed': every layer of the pass signed off ('full' agreement point), no build-check row of this pass exists, and the finish came at the handler's build check.
    const signed = agreementPoint && agreementPoint.kind === 'full' && agreementPoint.pass === round && passReviewed === round && !buildChecks.some(c => c.pass === round);
    const reviewed = signed ? 'signed' : rows.length ? (asked.length === 0 && cut.length === 0 ? 'none' : notAsked.length || cut.length ? 'part' : 'all') : (passReviewed === round ? 'all' : 'none');
    return { kind: 'secret_pause', pass: round, overseer_round: passOv, label, reviewed, ...(rows.length ? { asked_layers: asked, cut_layers: cut, not_asked_layers: notAsked } : {}), chosen: 'finish', ...(err?.atOnce === true ? { finished_at_once: true } : {}), ...(err?.relayed === true ? { relayed: true } : {}) };
  };
  // 0.8.4 (ladder unit, the owner pause as a choice stop): a person's finish AT the pause is read at the head of the pass the pause stopped before, BEFORE pauseCheck, from the gate ledger (`pause_finished`, through pauseFinishCheck); a run.json entry alone changes nothing. A replay does not stop again. The run ends here, NOT agreed, like a finish at any stop (finish_now skips the final read and the ending exchange).
  const ownerPauseFinishAt = round => { const f = pauseFinishCheck(round); if (!f || (f.choice !== 'finish' && f.choice !== 'finish_now')) return null; const id = stopIdOf({ kind: 'owner_pause', overseer_round: ovCompleted, pass: round }); return { kind: 'owner_pause', pass: round, overseer_round: ovCompleted, ...(Number.isInteger(f.request_seq) ? { request_seq: f.request_seq } : {}), chosen: 'finish', ...(f.choice === 'finish_now' ? { finished_at_once: true } : {}), ...(finishRelayedOf(roundChoices, id) || f.relayed === true ? { relayed: true } : {}) }; };
  if (config.signoff === 'unanimous') scanPhase = 'loop';   // 0.8.4 pause: the phase a found key is answered in
  if (config.signoff === 'unanimous') {
    for (let round = 1; round <= maxRounds; round++) {
      try {
        passOv = ovOn ? ovState.overseerRound : 0;
      // #16c: the owner's pause. FIRST, before the "Round" line, the re-tag block and every stage: nothing of this pass is logged, built, written or reserved when it stops. `passed` and `unhandledConflicts` as the advance() stop leaves them.
      if (round > 1) { const ownerFinish = ownerPauseFinishAt(round); if (ownerFinish) { passed = false; if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'loop_ended', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; } finishedStop = ownerFinish; log(`\n  finishing at the person's choice${ownerFinish.finished_at_once ? ', at once' : ''}${relayedTail(ownerFinish)}: the run was paused before pass ${round}; this is NOT agreement${ownerFinish.finished_at_once ? ', and no judge reads the plan again' : ''}.`); break; } const due = pauseCheck(round); if (due) { passed = false; if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'loop_ended', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; } throw new RoundStopped({ kind: 'owner_pause', pass: round, overseer_round: ovCompleted, request_seq: due.request_seq }); } }
      const relay = config.panel === 'relay';
      log(`\nRound ${round}: panel review (${config.seats.critics.length} judges, ${relay ? 'relay - each sees the verdicts before it' : 'independent'})`);
      const verdicts = [];
      adoptedNow = [];
      handlerBlocks = null;   // 0.8.4 S4: set only when the build check of THIS pass answered not_yet
      agreementPoint = null;  // and an agreement point belongs to the pass that reached it: a run that goes on (or ends otherwise) after a not_yet has no `ending` (Q-b); the checks asked stay in `build_checks`
      // B3 prep (JUDGE 4b, his word "handler too"): the handler's approved re-tags for THIS pass take effect here, at the very top, before anything of the pass is built. A replay applies them at the same point of the same pass, so every
      // earlier prompt is rebuilt exactly as it was. Each is recorded (severity.retags, by "handler", with its gate); one that names an objection the run has not counted, or that already stands at that rating, is recorded as refused.
      { const mine = retagsAtPass(retags, round).filter(r => !String(r?.id).startsWith('L-'));   // 0.8.4 S18 (Q3 (a)): a late finding's id does not exist at the top of a pass (the late list is made at the check): its re-tag is applied at the build check (askBuildCheck), never here
        if (mine.length) {
          if (sevRun) { const done = sevRun.applyHandlerRetags(round, mine); for (const a of done.applied) { const e = answerBackLatest[a.lab]; if (e?.objections?.some(o => o.id === a.id)) answerBackLatest = { ...answerBackLatest, [a.lab]: { ...e, objections: e.objections.map(o => (o.id === a.id ? { ...o, severity: a.to } : o)) } }; } /* the lab's own open entries carry the rating in force (a stated pass and an unanswered carried objection read it there); a copy, so no earlier record that holds the old entry is rewritten */ for (const a of done.applied) log(`  handler re-tag: ${a.id} (${a.lab}) ${a.from === null ? 'had no rating' : `was ${a.from}`}, now ${a.to}.`); if (done.applied.length < mine.length) log(`  handler re-tag: ${mine.length - done.applied.length} of ${mine.length} for this pass changed nothing (recorded as refused in the severity record).`); }   // A-DRAFT
          else log(`  handler re-tag: ${mine.length} for this pass, not applied: this chain keeps no ratings (only a layered chain with "signoff": "unanimous" does).`);
        } }
      // fencedSource rides along on `freedoms` so criticSystem keeps one options argument
      // rather than growing a positional flag at three call sites. It is not a freedom; it is
      // a fact about the task that decides whether the quote rule is honest to state at all.
      const freedoms = { ...(config.freedoms || null), fencedSource: !!fencedSource, ...(excerptsMayBeShown ? { excerptsMayBeShown: true } : {}), ...(textRequestsOpen ? { textRequestsMayBeAsked: true } : {}), ...(checks ? { criteriaKinds: true } : {}) };
      // Bug audit 2026-09-28 (external seats #5): an API seat's re-ask is a fresh sample, but an
      // external seat's was a byte-identical prompt, so the person or session answering it had no
      // hint the last reply could not be read and tended to repeat it. External re-asks only; an API
      // seat's prompt is unchanged.
      const externalReaskNote = (seat, tag) => seat.provider === 'external' && /^-(?:reask\d+|solo)$/.test(tag)
        ? `\n\n# Your previous reply could not be read\n\nThe last reply to this review (\`panel-${round}-${seatKeyOf(seat)}${tag === '-reask1' ? '' : tag === '-solo' ? `-reask${IN_PASS_REASKS_PER_SEAT}` : `-reask${Number(tag.slice(6)) - 1}`}.md\`) was not a readable verdict. Answer with the JSON object the system prompt describes, and nothing else.`
        : '';
      // 0.8.2 wiring (2a): a seat re-asked because its sign-off table was refused is told what the table lacked, whatever its provider. The words are a held sentence (src/held-roles.js:
      // `criticReaskNote({ kind, ids })` in src/roles.js after the re-record, ids are criterion numbers as the judge's list shows them); until then an API seat's re-ask is the same prompt and an
      // external seat gets the note above.
      // Astra's 0.8.2 review (7 Oct 2026, F1): a seat re-asked because its clean sign-off left some of its own earlier objections without an answer is told which ids (held sentence
      // `criticUnansweredNote({ ids, also })`, drafted in test/held-prompts/held-next.js). With a table gap as well, ONE note: the table's words, then the answers' (`also`). API and external seats alike.
      // E84 (ROADMAP 84): a STATED PASS that still holds objections of its own (`gapKind` 'stated_pass') is told so with its own sentence (criticStatedPassNote: criticUnansweredNote's first sentence says "It said the draft meets the criteria",
      // which a pass did not say); on a retained chain the re-ask about a judge's own objections also carries `peerText`, the other reviewers' evidence it may quote (otherReviewersBlock), after the note.
      const reaskNote = (seat, tag, gap, answersGap = null, gapKind = null, peerText = null, envelopeKind = null, severityGap = null, signoffRefused = false) => {
        const isReask = /^-(?:reask\d+|solo)$/.test(tag);
        const table = gap && isReask ? held('criticReaskNote')?.({ kind: gap.kind, ids: gap.criterion_ids.map(id => Number(String(id).replace(/^C/, ''))) }) : null;
        const answers = answersGap?.length && isReask
          ? (gapKind === 'stated_pass' ? held('criticStatedPassNote')?.({ ids: answersGap.map(o => o.id), peers: !!peerText }) : held('criticUnansweredNote')?.({ ids: answersGap.map(o => o.id), also: !!table }))
          : null;
        // E3b: a seat whose last reply was unreadable because the ids were missing or wrong is told so (held sentence); the kind comes from the unheard row.
        const envNote = envelopeKind && isReask ? held('criticEnvelopeReaskNote')?.({ kind: envelopeKind }) : null;
        // B3 prep (unit V): a verdict unreadable for a missing severity is re-asked ONCE and told which objection lacked it (a fixed sentence, only under the switch).
        const sevNote = severityGap && isReask ? R.severityReaskNote(severityGap) : null;
        const signoffNote = signoffRefused && isReask ? held('signoffRefusedReaskNote')?.() : null;   // 0.8.4 S6 (G7): the note of the top-layer judge whose "no" left nothing standing
        const note = n => orderNote(config, seat, n);   // cache part (b)1: with the cache-shaped order live, the harness's own notes name the instructions of the call, not the system prompt (never the quoted peer evidence)
        const text = [note(table), note(answers), answers ? peerText : null, note(envNote), note(sevNote), note(signoffNote)].filter(Boolean).join('\n\n');
        // An external seat is also told how to answer (externalReaskNote) when the envelope note is the only held note: it has to know what to paste, not only what was missing.
        return text ? `\n\n${text}${envNote || sevNote || signoffNote ? externalReaskNote(seat, tag) : ''}` : externalReaskNote(seat, tag);
      };
      // E84: ONE predicate for whose evidence a judge may be SHOWN and may QUOTE (Muad's "yes to widening what a judge may quote", with his answers of 14 Oct 2026: only the layered chain, and ANY layer: "the top judges should be reading it too"):
      // the chain is layered with answer_back (`retained`), the other judge is another lab, was heard in THIS round's own asks (not carried from an earlier round, not abstained). Layers are asked in ascending order, so at a layer-k re-ask
      // the round holds layers 1..k. Everything the re-ask shows and everything applyAnswers accepts as a peer source comes from peerRowsOf below, which asks this predicate and nothing else.
      const quotableFrom = (asked, v) => retained && !!v.critique && !v.carried && !v.abstained && labOf(v.seat) !== labOf(asked);
      // Letters: the same formula as the relay `prior` list (position among the verdicts with a critique), so "Reviewer B" names one lab in the whole prompt.
      const peerRowsOf = (asked, objections) => {
        const withCritique = verdicts.filter(v => v.critique);
        const rows = []; const byObjection = {};
        for (const o of objections) {
          const at = criterionIndexOf(o.criterion, criteria);
          if (at < 0) continue; // an objection whose criterion names no single criterion has no peer evidence (fail closed)
          for (const v of verdicts) {
            if (!quotableFrom(asked, v)) continue;
            for (const raw of metEvidenceFor(v.critique, criteria, at)) {
              const text = raw.slice(0, PEER_ROW_MAX_CHARS);
              const ref = `Reviewer ${String.fromCharCode(65 + withCritique.indexOf(v))}`;
              if (!rows.some(r => r.n === at + 1 && r.ref === ref && r.text === text)) rows.push({ n: at + 1, criterion: criteria[at], ref, text });
              (byObjection[o.id] ||= []).push({ lab: seatKeyOf(v.seat), layer: v.seat.layer, text });
            }
          }
        }
        return { rows, byObjection };
      };
      // 0.8.2 wiring (3c, 3d): from round 2 a judge that had objections is shown them, the writer's reasons and the changed passages, and told how to answer (`answers`, parsed by applyAnswers below).
      // Held sentence: `answerBackSection` in src/roles.js after the re-record; until then the prompt is untouched. It stays on a re-ask of the same round (the answers are read on the re-ask too).
      // Order: the suffixes (this one, then the re-ask note) follow criticUser's last line. On the `-answered` attempt of a blocking question (freedoms.blocking_questions: in no shipped chain, a user's own
      // setting) that line is "Give your verdict now ..." and the section's reply format follows it; accepted, since the section's own last words ask for the reply the judge must give.
      // Layered (retained): the entry is shown whenever the lab is asked, the changed passages are the diff between the text it last judged and the text it is shown now, and one summary row is written per
      // round per lab when the section text was really appended AND the call went out (keyed by round and lab, so a -reask / -retry / -answered attempt cannot add a second). The row is composed when the prompt is built
      // (`pendingRows`), marked sent once invoke() has returned or the call failed after leaving (`sentLabs`), and written by flushShown() when the layer's ask ends, in seat order, even if a later seat's call stops the run:
      // a call refused before it left (a spend stop, an unpriced seat, the key scan) shows no row. A paused external seat writes its prompt for the person and its row comes when the reply is replayed.
      const pendingRows = new Map(); const sentLabs = new Set(); const pushedRows = new Set();
      const pendingReasons = new Map();   // 0.8.4 S7c: lab -> [{ record, round }], composed when the layer-3 section is rendered into a prompt, written (`reasons_shown_in`) by flushShown() only for a lab whose call went out
      const flushShown = seats => {
        for (const s of seats) {
          const lab = seatKeyOf(s);
          if (sentLabs.has(lab) && pendingRows.has(lab) && !pushedRows.has(lab)) { pushedRows.add(lab); answerBackRecords.push(pendingRows.get(lab)); }
          if (sentLabs.has(lab) && pendingReasons.has(lab)) { for (const { record, round: shownIn } of pendingReasons.get(lab)) if (record.reasons_shown_in === undefined) record.reasons_shown_in = shownIn; pendingReasons.delete(lab); }   // 0.8.4 S7c: the escalation outcome row says in which round the judge was first shown the reasons
        }
      };
      const answerBackNote = seat => {
        const lab = seatKeyOf(seat);
        const a = retained ? answerBackLatest[lab] : (answerBackOn && answerBackRound === round ? answerBackLatest[lab] : null);
        const changed = a && retained ? changedPassages(a.sawDraft, draft + changedSince(lastPatches)) : a?.changed_passages;
        const text = a ? held('answerBackSection')?.({ objections: a.objections, declined: a.declined, changed }) : null;
        if (text && retained && !pendingRows.has(lab)) {
          pendingRows.set(lab, { round, lab, objection_ids: a.objections.map(o => o.id), declined: a.declined.length, changed_passages: changed.length, raised_round: Math.min(...a.objections.map(o => o.raised_round ?? round)) });
        }
        return text ? `\n\n${text}` : '';
      };
      // E4: the ledger section, for the seats of the TOP layer only, built once per round before they are asked (below). Order in the prompt: criticUser + answer-back + LEDGER + re-ask note + the envelope section last.
      // B2: the judge's own withdrawals in the exchange, shown beside the answer-back as plain information (never entries in the list applyAnswers checks: a judge that ignores them is not asked again). Empty unless the switch is on and the judge withdrew something.
      const exchangeWithdrawnNote = seat => { const list = exchangeWithdrawals.get(seatKeyOf(seat)); return list?.length ? `\n\n${R.exchangeWithdrawnSection({ items: list.slice(-20) })}` : ''; };
      const ledgerNote = seat => (roundLedger?.text && seat.layer === topLayer ? `\n\n${roundLedger.text}` : '') + (earlyAsk && seat.layer === topLayer ? `\n\n${earlyAsk.text}` : '');   // ROADMAP 83: the session's proposal and the list, for the overseer layer only
      // 0.8.4 S7c (WORDING row S7C-1, held name layerThreeReasonsSection): after the answer-back section, in the seat's first review after the ruling; nothing while the name is held, so every prompt is what it was.
      const layerThreeNote = seat => {
        const word = held('layerThreeReasonsSection');
        if (typeof word !== 'function' || !retained || !topLayer || seat.layer >= topLayer) return '';
        const seatKey = seatKeyOf(seat);
        const open = new Set((answerBackLatest[seatKey]?.objections || []).map(o => o.id));   // still open at render: a withdrawn or fixed objection shows nothing
        const rows = layerThreeOverrulesOf(seatKey, round).filter(r => open.has(r.id) && (!layerThreeShown.has(`${seatKey}\u0000${r.id}`) || layerThreeShown.get(`${seatKey}\u0000${r.id}`) === round));
        if (!rows.length) return '';
        for (const r of rows) { layerThreeShown.set(`${seatKey}\u0000${r.id}`, round); for (const record of r.records || []) { if (!pendingReasons.has(seatKey)) pendingReasons.set(seatKey, []); pendingReasons.get(seatKey).push({ record, round }); } }
        return `\n\n${word({ layer: rows[0].ruled_layer, rows: rows.map(({ id, rated, ruled_round, reasons }) => ({ id, rated, ruled_round, reasons: reasons.map(x => ({ ...x, lab: x.seat ? shownKey(x.seat) : x.lab })) })) })}`;   // the prompt copy shows lab + note; the record copy keeps lab + seat
      };
      // 0.8.4 S8 (money step): the list a TOP-layer seat sorts with its verdict (the objections open at that pass, from the build check's one list), inside the string the envelope and the hash cover, so every ask of the pass (first, re-ask, retry) carries it.
      // The list and its ids are made once per (round, seat) and kept in `climbItems`: the reading of the verdict filters the reply by the same ids. Nothing is added unless the sorting is on and this is a top-layer seat (src/stage-system.js climbSortingFor, the predicate the prompt and the estimate share).
      const sortListNote = seat => {
        if (!climbSortingFor(seat, config)) return '';
        const key = `${round}\u0000${seatKeyOf(seat)}`;
        if (!climbItems.has(key)) climbItems.set(key, sortingItemsOf({ open: openAtAgreement({ round, failures: adoptedNow }), wrap: R.claimText }));
        const list = climbItems.get(key);
        return list.items.length ? `\n\n${held('layerThreeSortingItems')({ items: list.items })}` : '';
      };
      // The sorting a top-layer verdict carried, read against the list that seat was shown. An id outside it: a may-leave is ignored and counted; a must-do with a reason (or an entry with no id and the passage) is a defect the seat named only in its sorting and is kept whole as `sorting_new` on the verdict row (no id is minted, no late finding is made here; at the run's LAST verdict it becomes one, below). A defect the seat reports in `failures` is its own objection, read into the ledger like any other.
      const climbSortingOf = v => {
        if (!v || v.abstained || v.passed || v.carried || !v.critique || !climbSortingFor(v.seat, config)) return {};
        const list = climbItems.get(`${round}\u0000${seatKeyOf(v.seat)}`);
        if (!list) return {};
        const read = readSorting(v.critique.sorting, list.knownIds, { ...(routeOptsOf(config) || {}), ...(finalReadWordsOn() ? { rating: true } : {}), unanchored: list.unanchored });   // 0.8.4 S16 (W32): the climb reads the rating of a new defect under the same gate as its sentence
        const shownTight = normQuoteTight(draft + changedSince(lastPatches));   // the plan this seat read (the text the pass's own quote check reads): the grounding is read HERE, against it, and kept on the entry; run end reuses it (a later edit of the plan must not make a quote ungrounded that the seat quoted correctly)
        const fresh = read.fresh.map(f => ({ ...f, ungrounded_why: lateUngroundedWhy({ criterion: f.criterion || '', quote: f.quote || '' }, shownTight) }));
        return { ...(read.rows.length ? { sorting: read.rows } : {}), ...(fresh.length ? { sorting_new: fresh } : {}), ...(read.ignored > 0 ? { sorting_ignored: read.ignored } : {}) };
      };
      // 0.8.4 S9 (Q10(a), W8; HELD behind `decisionLevelRule` and `decisionLevelKeys`, WORDING rows S9-w1, S9-w2): the top layer is asked whether each objection is about a decision or about wording; nothing while the words are held, the Decisions rule is off or the chain has no overseer rounds.
      const decisionLevelNote = seat => {
        if (!callGates.decisionLevel || !ovOn || seat.layer !== topLayer) return '';
        const rule = held('decisionLevelRule')?.(); const keys = held('decisionLevelKeys')?.();
        return typeof rule === 'string' && typeof keys === 'string' ? `\n\n${rule}\n\n${keys}` : '';
      };
      const layerOneNote = seat => (layerOneOpen?.text && seat.layer > layerNumbers[0] && seat.layer < topLayer ? `\n\n${layerOneOpen.text}` : '');   // JUDGE unit L2 (A-DRAFT): after the ledger's place, so after the draft and out of any cache head
      const reviewSeat = async (criticSeat, prior, say, tag = '', tableGap = null, answersGap = null, gapKind = null, envelopeKind = null, severityGap = null, signoffRefused = false) => {
        let cs, parsed, answeredQuestion = null;
        let askedNotes = false; // the first call of this ask carried the notes ask (the notes lane): a reply cut off after that ask is recorded below
        let envUsed = null; // the pair the reply now held in `cs` was asked under (null: no envelope), for envelopeReason
        // E84: in a re-ask about the judge's OWN objections on a retained chain it is shown what the other judges of its layer wrote about the same criteria, and a withdrawal may quote it. `peer.byObjection` is built by the
        // same call that built the text shown (peerRowsOf), and is used as `sources` only when that text was really appended to this prompt (the held sentence exists): what is shown and what is checked cannot differ.
        const peer = retained && /^-(?:reask\d+|solo)$/.test(tag) && answersGap?.length ? peerRowsOf(criticSeat, answersGap) : null;
        const peerText = peer?.rows.length ? held('otherReviewersBlock')?.({ rows: peer.rows }) || null : null;
        const sources = peerText ? peer.byObjection : null;
        // Where the explicit ask stands for a row that is carried for want of an answer (retained chains only): set at the line that decides it, never filled in afterwards.
        const askOnReask = answersGap?.length ? 'asked' : 'reask_spent'; // a re-ask with the note, or one spent on a lost first reply (it carried no note)
        // `panelMaxTokens` (2026-09-22): an optional per-seat output cap for the panel review only.
        // A seat that needs room to reason (GLM-5.3 Flash cut off at 36k on the Zofia run) can get it
        // here without raising its debate posts, proposals or replies - the text other labs read.
        if (criticSeat.panelMaxTokens) criticSeat = keepSeatKey(criticSeat, { ...criticSeat, maxTokens: criticSeat.panelMaxTokens });   // the copy keeps its seat key (a WeakMap on the seat object), or a twin's calls would be labelled and recorded as the first seat's
        let cutOffRetried = false, effectiveCap = criticSeat.maxTokens ?? DEFAULT_MAX_TOKENS;
        // Notes lane (2b-0): the stage label of the call whose reply `parsed` holds (the attempt the notes came from; updated in the same statement as every assignment to `parsed`). `normaliseCritique`'s `stage` and the live-view labels keep `noteKey` (the pass's own label), so no verdict record changes.
        let parsedLabel = '', lastCallLabel = '';
        let askedPrompt = null; // 2 Nov 2026: the system and user text of the call whose reply `cs` holds (a near-JSON pause is held to that prompt on resume)
        // v7 item 4: at most one blocking-question round trip per seat per round - the critic is
        // told it may not ask a second one, and this loop does not offer it the chance to anyway.
        for (let attempt = 0; attempt < 2; attempt++) {
          const panelGroup = attempt === 0 && tag === '' && !relay ? `panel-${round}-L${criticSeat.layer ?? 0}` : null;   // 0.8.4 T14 (declared OUTSIDE the try so the cut-off retry below can read it; it sat inside the try and the retry's group field threw a ReferenceError that its own catch swallowed): the FIRST ask (and its cut-off retry) of one layer in one pass reads no same-layer verdict; a re-ask (peer block), the answered-question call and every ask of a RELAY panel (each critic is handed the verdicts before it) do, so they are not grouped
          try {
            const callLabel = attempt === 0 ? `panel-${round}-${seatKeyOf(criticSeat)}${tag}` : `panel-${round}-${seatKeyOf(criticSeat)}${tag}-answered`;
            lastCallLabel = callLabel;
            // Patch mode shows the full draft plus the edits made since the last review, so a
            // reviewer can see what moved without re-reading the plan. Empty in full-rewrite
            // mode and on round 1, where there is no "since" to speak of.
            const shown = draft + changedSince(lastPatches);
            const cu = { request, criteria, draft: boundedDraft(shown, endMarkerOn), prior, answeredQuestion, checks, endMarker: endMarkerOn };   // 0.8.4 D38: ONE arguments object for the prompt and for the head the excerpt block follows (R.criticUserHead of the same arguments)
            const env = withEnvelope(callLabel, shown, R.criticUser(cu) + answerBackNote(criticSeat) + excerptNoticeNote(criticSeat, round) + layerThreeNote(criticSeat) + sortListNote(criticSeat) + decisionLevelNote(criticSeat) + exchangeWithdrawnNote(criticSeat) + ledgerNote(criticSeat) + layerOneNote(criticSeat) + rulingsNote(round) + memoryNote() + (attempt === 0 ? (() => { const n = notesAskNote(criticSeat, tag, round); if (n) askedNotes = true; return n; })() : '') + reaskNote(criticSeat, tag, tableGap, answersGap, gapKind, peerText, envelopeKind, severityGap, signoffRefused));
            envUsed = env.expect;
            askedPrompt = judgePrompt({ config, seat: criticSeat, kind: 'panel', compose: () => panelPromptFor(criticSeat, open, freedoms, config), user: env.user, head: R.criticUserHead(cu), headArgs: cu, endMarker: endMarkerOn });   // W6 (held) is part of panelPromptFor, so the estimate prices what is sent; cache part (b)1: the cache-shaped order where it is live (src/cache-order.js), else exactly the old pair
            cs = record(await invoke(criticSeat, {
              system: askedPrompt.system,
              user: askedPrompt.user,
              blockAfter: askedPrompt.head ?? R.criticUserHead(cu),
              ...(askedPrompt.laid ? { cacheHead: askedPrompt.head, shownSystem: askedPrompt.shownSystem, ...markOf(criticSeat) } : {}),
              log: say, label: callLabel, group: panelGroup,
            }));
            sentLabs.add(seatKeyOf(criticSeat));
          } catch (err) {
            // A3a commit 2: a panel judge is NEVER skippable. The panel agrees only when every judge is heard (allSignedOff needs unheard === 0, a layer with an unheard seat is 'unheard', and the round asks again on the
            // unchanged draft until the round cap: NOT agreement), so a skipped judge would make agreement impossible and the run would pay its rounds for nothing. The stop says so and recommends the price row.
            if (err instanceof PriceRefused) err.noSkip = 'a panel agrees only when every judge is heard';
            rethrowControlFlow(err);
            // A lab that is down (429 after retries, 5xx, network) must not take
            // the panel down with it. It abstains, and the log says why.
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: no reply (${String(err.message).slice(0, 120)}) - counted as an abstention.`);
            // v5 item 3, touch point 2: a verdict update for the live view, using a value
            // chain.js has already computed at this point - no new parsing. A provider exception
            // is infrastructure failure, not a stated position - the live wedge's `dropped`
            // state, kept separate from `objected` (item 1's report.json rule, item 3's own
            // scope addition kept true in the live view too).
            progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
            return { seat: criticSeat, critique: null, abstained: true, error: String(err.message), reasonCode: 'SEAT_UNREACHABLE' };
          }
          parsed = parseJson(cs.text, { verdict: true, rulingsDecide: !!layerOneOpen?.ruling, ...(envUsed ? { expect: envUsed } : {}) });
          parsedLabel = lastCallLabel;
          // Bug audit 2026-09-27 M3: a reply the provider cut off at the cap can still parse (an
          // early complete fence, a lucky brace span), and a parsed cut-off `meets:true` went
          // straight through as a sign-off. So "cut off" is decided from the provider's stop reason
          // whether or not the reply parsed - never the 95%-of-cap guess, which would retry a reply
          // that finished normally near its cap. A pasted external reply carries no stop: no-op.
          // 0.8.1 R review: `from` is the cap the reply was really asked at (an Anthropic seat's invoke() may already have retried at the bigger
          // cap); the retry is skipped when it has no room, instead of repeating the same paid call.
          const fromCap = cs.cappedAt ?? effectiveCap;
          if (!cutOffRetried && (parsed ? providerCutOff(cs.usage) : true) && abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap)) === 'REPLY_TRUNCATED'
            && cutOffRetryCap(fromCap, retryCeilingOf(criticSeat)) > fromCap) {
            // A reply cut off at the cap is a lost vote, not a position (pilot 2026-09-17: 14 of
            // 58 lost votes, several already carrying `"meets": false`). Ask once more with a
            // bigger cap; if that fails too, the seat abstains as before and the round rule
            // below refuses to call the panel unanimous without it.
            cutOffRetried = true;
            const firstParsed = parsed, firstCs = cs, firstCap = effectiveCap, firstEnv = envUsed, firstLabel = parsedLabel;
            const biggerCap = cutOffRetryCap(fromCap, retryCeilingOf(criticSeat));
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: reply cut off at ${fromCap} tokens - asking once more with a ${biggerCap}-token cap.`);
            try {
              // The retry is its own call: its own label, its own shown draft (the plain draft) and so its OWN pair (C&C C2): the first attempt's pair read against the retry's reply is wrong_id.
              const retryLabel = `panel-${round}-${seatKeyOf(criticSeat)}${tag}-retry`;
              const cu = { request, criteria, draft: boundedDraft(draft, endMarkerOn), prior, answeredQuestion, checks, endMarker: endMarkerOn };   // 0.8.4 D38: ONE arguments object for the prompt and for the head the excerpt block follows (R.criticUserHead of the same arguments)
              const env = withEnvelope(retryLabel, draft, R.criticUser(cu) + answerBackNote(criticSeat) + excerptNoticeNote(criticSeat, round) + layerThreeNote(criticSeat) + sortListNote(criticSeat) + decisionLevelNote(criticSeat) + exchangeWithdrawnNote(criticSeat) + ledgerNote(criticSeat) + layerOneNote(criticSeat) + rulingsNote(round) + memoryNote() + (tableGap || answersGap || envelopeKind || severityGap ? reaskNote(criticSeat, tag, tableGap, answersGap, gapKind, peerText, envelopeKind, severityGap, signoffRefused) : ''));
              envUsed = env.expect;
              askedPrompt = judgePrompt({ config, seat: criticSeat, kind: 'panel', compose: () => panelPromptFor(criticSeat, open, freedoms, config), user: env.user, head: R.criticUserHead(cu), headArgs: cu, endMarker: endMarkerOn });   // W6 (held) is part of panelPromptFor, so the estimate prices what is sent; cache part (b)1: as above
              cs = record(await invoke(keepSeatKey(criticSeat, { ...criticSeat, maxTokens: biggerCap }), {
                system: askedPrompt.system,
                user: askedPrompt.user,
                blockAfter: askedPrompt.head ?? R.criticUserHead(cu),
                ...(askedPrompt.laid ? { cacheHead: askedPrompt.head, shownSystem: askedPrompt.shownSystem, ...markOf(criticSeat) } : {}),
                log: say, label: retryLabel, group: panelGroup,
              }));
              effectiveCap = biggerCap;
              parsed = parseJson(cs.text, { verdict: true, rulingsDecide: !!layerOneOpen?.ruling, ...(envUsed ? { expect: envUsed } : {}) });
              parsedLabel = retryLabel;
              // M3: when the cut-off first reply did parse, an unreadable retry must not throw away
              // what it said - back to the first reply (a cut objection still counts; a cut sign-off
              // is turned into an abstention below).
              if (!parsed && firstParsed) { parsed = firstParsed; cs = firstCs; effectiveCap = firstCap; envUsed = firstEnv; parsedLabel = firstLabel; }
              // Notes lane (2b-0): a cut-off first reply that parsed and carried notes is replaced by the retry. A reply cut at its cap can parse from a lucky span (the M3 comment above; no salvage), so its notes are NOT read:
              // recorded as dropped `reply_cut_off` instead of lost without a trace (the retry's own notes are read as any reply's).
              else if (notesOn && firstParsed && splitNotes(firstParsed).notesReply) { notesDropped.push({ lab: seatKeyOf(criticSeat), pass: round, why: 'reply_cut_off' }); notesCutIn.set(seatKeyOf(criticSeat), notesRound(round)); }
            } catch (err) {
              rethrowControlFlow(err);
              envUsed = firstEnv; // the reply held in `cs` is still the first attempt's
              say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: the bigger-cap retry failed (${String(err.message).slice(0, 120)}) - keeping the first attempt's abstention.`);
            }
          }
          if (!parsed) {
            // 2 Nov 2026 (owner: "pause", heading "HIS FOUR MORNING ANSWERS ..."; src/near-json.js; scope rule at nearJsonPause): a reply that is almost JSON from a seat that answered normally is not an abstention: the run pauses for its repair, the way an
            // external seat pauses, with or without a handler. Thrown here, outside the try around invoke(), so it travels like an external seat's: settleAll lets every other seat of the round finish and be recorded first, then rethrows it with the
            // sibling pauses. For near-JSON it replaces the re-ask (the 0.8.2 "one re-ask, then abstention"); prose, a reply a guard refuses, a cut-off or errored reply keep today's path.
            const nearJson = askedPrompt && nearJsonPause(cs, { model: criticSeat.model, maxTokens: effectiveCap }, askedPrompt.system, sentUserOf(cs, askedPrompt.user), askedPrompt.shownSystem);
            if (nearJson) {
              say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: the reply is almost JSON and could not be read - the run pauses for a repair (${nearJson.label}).`);
              throw nearJson;
            }
            // An unreadable verdict is an abstention: it neither signs off nor
            // objects, and it cannot block the panel. It used to count as a
            // pass, which would have waved a truncated FAILED straight through.
            const envelopeWhy = envelopeWhyOf(cs, askedCapOf(cs, effectiveCap), envUsed); // E3b: missing | wrong_id when the envelope is the reason (classification order above), else null
            // The false "malformed JSON" diagnosis of a well-formed reply that only lacks the ids is replaced by the held sentence (without it, and for every other cause, the text is today's).
            const why = (envelopeWhy && held('criticEnvelopeUnreadableWhy')?.({ kind: envelopeWhy })) || classifyUnreadable(cs.usage, askedCapOf(cs, effectiveCap));
            const reasonCode = abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap));
            // Notes lane: a reply that was cut off AFTER the notes ask went out lost its verdict, and the notes may be why (they ride in the same reply). Recorded with its lab and pass, and the seat is not asked for
            // notes again in this overseer round (a verdict outranks notes). Nothing is guessed about which part was cut.
            if (askedNotes && reasonCode === 'REPLY_TRUNCATED') { notesDropped.push({ lab: seatKeyOf(criticSeat), pass: round, why: 'reply_cut_off' }); notesCutIn.set(seatKeyOf(criticSeat), notesRound(round)); }
            // v5 §1 candidate 4: the code is prepended, the diagnosis itself
            // is untouched - classifyUnreadable's three distinct reasons are
            // load-bearing (each one traces to a real incident on disk) and
            // this candidate changes what's printed, never what's diagnosed.
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] unreadable reply (${cs.usage.output} tokens out; ${why})${cs.noAnswer ? ` - ${cs.noAnswer}` : ''} - counted as an abstention, not a sign-off.`);
            // Same live-wedge treatment as the provider-exception abstention above: a real
            // reply came back, but not a usable one - item 1's outcome logic already treats
            // this identically to a dropout (`signedOff === null && passed === false`), so the
            // live view stays consistent with what report.json will say at the end.
            progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
            // 0.8.1 milestone R: a seat whose thinking used the whole cap is recorded as such on the board (panelVerdicts[].no_answer), still an abstention.
            // E3b: the envelope field records why when the envelope was the reason (envelopeWhy above); the existing reasonCode stays.
            return { seat: criticSeat, critique: null, abstained: true, reasonCode, ...(cs.noAnswer ? { noAnswer: cs.noAnswer } : {}), ...(envelopeWhy ? { envelope: envelopeWhy } : {}) };
          }
          if (freedoms?.blocking_questions && parsed.blocking_question && attempt === 0) {
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: blocking question - ${parsed.blocking_question}`);
            const proposerSeat = config.seats.builder;
            const answer = record(await invoke(proposerSeat, {
              system: R.BLOCKING_ANSWER_SYSTEM,
              user: R.blockingAnswerUser({ request, draft, question: parsed.blocking_question }),
              log: say, label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}-question`,
            }));
            say(`  ${shownSeat(proposerSeat)}/${proposerSeat.model}: answered - ${answer.text}`);
            answeredQuestion = { question: parsed.blocking_question, answer: answer.text };
            // Notes lane (2b-0): attempt 0 carried the notes ask; the `-answered` attempt overwrites `parsed`, so attempt 0's notes are put in the stash BEFORE the loop goes on (read under the same rule as any reply of the pass).
            if (notesOn) stashNotes(seatKeyOf(criticSeat), round, parsedLabel, splitNotes(parsed).notesReply, cs.usage);
            continue;
          }
          break;
        }
        if (freedoms?.pass && parsed.pass) {
          // Notes lane (2b-0): a stated pass is not a recorded verdict, but its reply may carry notes: stashed like any parsed reply (read iff the seat ends the pass with a recorded verdict, e.g. after the re-ask a stated pass with open own objections gets;
          // a seat that ends on its stated pass has them counted dropped `verdict_not_recorded`, not lost without a trace).
          if (notesOn) stashNotes(seatKeyOf(criticSeat), round, parsedLabel, splitNotes(parsed).notesReply, cs.usage);
          say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: PASSED - ${parsed.pass_reason || '(no reason given)'}`);
          const passLab = seatKeyOf(criticSeat);
          const passReason = capField(parsed.pass_reason, { stage: `panel-${round}-${passLab}${tag}`, field: 'pass_reason' }) || '';
          // 0.8.3 E3 (C&C ruling a1, 14 Oct 2026): on a layered chain with answer_back a stated pass by a lab that still holds its OWN open objections is recorded as its pass, never rewritten, and those objections are carried at once
          // (`openOwn`; the record refuses to invent a disposition, not a verdict): the lab cannot sign a layer off by declining to judge. The VALUE that tells it from an objection is the
          // answer_back_replies row (effect stated_pass_open, one per id). Only a validated withdrawal with a quote consumes an objection (Astra #9).
          // E84 (ROADMAP 84): E3's carry is the FALLBACK. When the explicit ask is possible (the held sentence is recorded, and this is the judge's first ask of the round) the pass is not final yet: it is returned as the same internal shape
          // a clean sign-off with unanswered objections has (abstained, `unansweredFallback`), so the round's ONE re-ask loop (askLayer) asks the judge once about its own objections, when the rest of its layer is clean; the fallback below is
          // exactly E3's verdict, and its rows and the entry are written by `settle` only when it is adopted. A re-ask that comes back with a verdict replaces it (the latest ask counts).
          const heldOpen = retained ? (answerBackLatest[passLab]?.objections || []) : [];
          let openOwn = []; let settle = () => {};
          if (heldOpen.length) {
            // A pass reply may still carry `answers`: a withdrawal with a quote found in the draft (or, on a re-ask that showed them, in a peer's row) IS a disposition, so it is applied; what the pass leaves
            // answered some other way (sustained, a refused withdrawal, a word that is neither) is carried as applyAnswers carries it, with that effect row, and an id with no answer at all is carried as stated_pass_open.
            const applied = applyAnswers({ lab: passLab, critique: { failures: [], answers: parsed.answers }, own: heldOpen, shownDraft: draft, round, sources, texts: spanTexts({ draft, fenced: fencedSource, excerpts: excerptsForQuotes(), request, criteria }) });
            openOwn = [...applied.carried, ...applied.unanswered];
            settle = (ask, announce) => {
              // A re-ask replaces what the judge's earlier reply of the round recorded (same rule as the verdict path below); a deferred first ask has recorded nothing yet.
              if (tag) for (let k = answerBackReplies.length - 1; k >= 0; k--) if (answerBackReplies[k].round === round && answerBackReplies[k].lab === passLab) answerBackReplies.splice(k, 1);
              for (const r of applied.records) if (r.effect !== 'unanswered') { recordAnswerWithdrawal(passLab, r, round, heldOpen.find(o => o.id === r.id)?.severity); answerBackReplies.push(withEvidence({ round, lab: passLab, ...r }, parsed.answers)); }
              for (const f of applied.unanswered) answerBackReplies.push(sevRun && severityMeets([f]) ? { round, lab: passLab, id: f.id, status: null, effect: 'swept_carried', path: 'stated_pass' } : { round, lab: passLab, id: f.id, status: null, effect: 'stated_pass_open', ask });   // unit 4a: one disposition for a swept objection carried without an answer (swept_carried), the path as a field
              // What the pass withdrew with a quote is settled now: the lab's entry keeps only what is still open (gone altogether when nothing is).
              const left = stillOpen(answerBackLatest[passLab], answerBackReplies, { round, lab: passLab });
              if (left.length) answerBackLatest[passLab] = { ...answerBackLatest[passLab], objections: left }; else delete answerBackLatest[passLab];
              if (openOwn.length) announce(`  ${passLab}/${criticSeat.model}: stated a pass while ${openOwn.length} of its own earlier objection(s) stay open (a pass is not a withdrawal): ${openOwn.map(o => o.id).join(', ')}`);
            };
          }
          const finalVerdict = { seat: criticSeat, critique: null, passed: true, passReason, ...(openOwn.length ? { openOwn } : {}), ...(layerOneOpen?.ruling && Array.isArray(parsed?.rulings) ? { rulingsRaw: parsed.rulings } : {}) };   // 0.8.4 S7b A3: a stated pass may carry rulings too
          const canAsk = openOwn.length > 0 && !(sevRun && severityMeets(openOwn)) && retained && !tag && !!held('criticStatedPassNote');   // unit 3 (flag d): no paid re-ask when everything it carries is swept
          if (canAsk) {
            progressHook({ kind: 'verdict', label: `panel-${round}-${passLab}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
            return { seat: criticSeat, critique: null, abstained: true, reasonCode: 'STATED_PASS_OPEN', answersGap: openOwn, answersKind: 'stated_pass', unansweredFallback: { ...finalVerdict, settle } };
          }
          // A stated, recorded refusal to verdict - not a stated position either way, so the
          // live wedge treats it as "waiting" territory rather than objected/signed. Reported
          // as its own kind so the writer doesn't have to special-case `passed` on top of
          // `verdict`.
          progressHook({ kind: 'verdict', label: `panel-${round}-${passLab}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), passStated: true });
          settle(tag ? askOnReask : 'words_not_recorded', say);
          return finalVerdict;
        }
        // Notes lane: the two note keys come OFF the reply before the verdict is read from the rest (on EVERY chain: normaliseCritique spreads the object it is given, and a note must never ride inside a recorded
        // verdict, a peer block or a signoff record). Only normaliseCritique's argument changes: `parsed` still feeds blocking_question and answers above and below. The notes part is kept per call.
        const { verdictPart, notesReply } = splitNotes(parsed);
        const noteKey = `panel-${round}-${seatKeyOf(criticSeat)}${tag}`;
        stashNotes(seatKeyOf(criticSeat), round, parsedLabel, notesReply, cs.usage);
        // 0.8.4 S7b A3 (the notes-lane precedent): a `rulings` key never rides inside the verdict object (normaliseCritique spreads what it is given); when this ask showed the S7b section (layerOneOpen.ruling) it is taken OFF the reply here and put back on the verdict below; in every other ask (A3b) the reply is left exactly as it was read, so a stray `rulings` key rides as it did before S7b.
        const verdictClean = verdictPart && typeof verdictPart === 'object' && !Array.isArray(verdictPart) && layerOneOpen?.ruling && Object.hasOwn(verdictPart, 'rulings') ? (({ rulings: _dropped, ...rest }) => rest)(verdictPart) : verdictPart;
        let critique = normaliseCritique(verdictClean, say, { stage: noteKey, severity: severityOn, criteria });
        if (critique.unreadable) {
          // Parsed as JSON but stated no verdict - the same abstention as an unparseable reply.
          const reasonCode = abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap));
          say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] reply states no verdict (${critique.unreadableWhy}) - counted as an abstention, not a sign-off.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
          return { seat: criticSeat, critique: null, abstained: true, reasonCode, ...(critique.severityGap ? { severityGap: critique.severityGap } : {}) };
        }
        // 0.8.4 S2 (Q12, D18, CA7): once the relation wording W6 is recorded, every failure declares its relation and the assigner gives each its id (a suffix, a reopens id, a see-also pointer). A relation that cannot be read, names an id that is not this seat's
        // own standing (continues) or withdrawn (reopens) one, or a failure raised again in the reply that withdraws it, makes the reply unreadable: the counted, bounded re-ask F11 uses for any unreadable reply (no allowance is added). Without W6, or on a chain with answer_back off, nothing here runs.
        if (held('relationRule') && answerBackOn && critique.failures.length) {   // C&C GO answer back off: the relation is asked, and read, only on a chain whose judges are shown their own earlier objections (answer_back on); an unasked relation changes no id and refuses nothing
          const labKey = seatKeyOf(criticSeat);
          // a failure the JUDGE wrote must declare its relation; one the harness added itself from a FAILED table row has none to declare (it is read as new)
          const declared = new Set((Array.isArray(verdictPart?.failures) ? verdictPart.failures : []).map(f => normProblem(typeof f === 'string' ? f : f?.problem).slice(0, 80)));
          const missing = critique.failures.some(f => (f.relation === undefined || f.relation === null || f.relation === '') && declared.has(normProblem(f.problem).slice(0, 80)));
          const withdrawnNow = new Set((Array.isArray(parsed?.answers) ? parsed.answers : []).filter(a => a && typeof a === 'object' && String(a.status ?? '').toLowerCase() === 'withdrawn' && typeof a.id === 'string').map(a => a.id.trim()));
          const asn = missing ? { unreadable: { why: 'relation_missing', ids: [] } } : assignIds({ lab: labKey, failures: critique.failures, withdrawnNow, own: ownHistory(labKey, round), withdrawnAny: withdrawnEverywhere(round) });
          if (asn.unreadable) {
            const reasonCode = abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap));
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] the reply's relation field cannot be used (${asn.unreadable.why}${asn.unreadable.ids.length ? `: ${asn.unreadable.ids.join(', ')}` : ''}) - counted as an unreadable reply, not a sign-off.`);   // A-DRAFT
            progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
            return { seat: criticSeat, critique: null, abstained: true, reasonCode };
          }
          critique = { ...critique, failures: asn.failures };
        }
        if (sevRun && critique.failures.length) {
          // Unit 3: the tag in force is the FIRST valid tag already committed for the objection id, else the one claimed (src/severity.js createSeverityRun); nothing is committed until the verdict counts (below, where the pass records its votes), so a thrown-away attempt pins nothing.
          const labKey = seatKeyOf(criticSeat);
          critique = { ...critique, failures: critique.failures.map(f => { const inForce = sevRun.peek(labKey, objectionId(labKey, f), f.severity); const out = inForce === undefined ? { ...f } : { ...f, severity: inForce }; Object.defineProperty(out, '_claimed', { value: f.severity, enumerable: false }); return out; }) };   // the claim travels with the objection (not enumerable: no record or copy carries it) until the verdict counts
          critique.meets = severityMeets(critique.failures);
        }
        if (critique.meets && draftIncomplete(cs.usage)) {
          // M4's panel side: the provider ended the reply with error/content_filter/refusal. Whatever
          // parsed is not a finished verdict, so a sign-off from it is not consent.
          say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] reply signs off but the provider ended it with stop "${cs.usage.stop}" - counted as an abstention, not a sign-off.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
          return { seat: criticSeat, critique: null, abstained: true, reasonCode: abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap)) };
        }
        if (layerOneOpen?.ruling && Array.isArray(parsed?.rulings)) critique = { ...critique, rulings: parsed.rulings };   // 0.8.4 S7b A3: layer 2's rulings on layer 1's open objections ride on the verdict only when this ask showed the section (read by settleInCallRulings); nothing else reads this key
        if (critique.meets && providerCutOff(cs.usage)) {
          // M3, continued: still cut off (after the one bigger-cap retry, or a reasoning ceiling that
          // gets none). A cut-off sign-off is never consent: the seat is unheard. A cut-off objection
          // is kept - it already said no, and dropping it would lose a vote (pilot 2026-09-17).
          const reasonCode = abstentionReasonCode(cs.usage, askedCapOf(cs, effectiveCap)) === 'REASONING_EXHAUSTED' ? 'REASONING_EXHAUSTED' : 'REPLY_TRUNCATED';
          say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] reply signs off but was cut off at the cap (stop: ${cs.usage.stop}) - counted as an abstention, not a sign-off.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
          return { seat: criticSeat, critique: null, abstained: true, reasonCode };
        }
        // 0.8.2 (owner ruling 6 Oct 2026): a judge's `answers` about its own earlier objections. A withdrawal with no quote found in the draft does not count: the objection stays open.
        let pendingAnswers = null; // this ask's own objections left unanswered under a clean sign-off (not the `answersGap` argument, which was the previous ask's, for the note)
        if (answerBackOn && (retained || answerBackRound === round) && answerBackLatest[seatKeyOf(criticSeat)]) {
          const applied = applyAnswers({ lab: seatKeyOf(criticSeat), critique, own: answerBackLatest[seatKeyOf(criticSeat)].objections, shownDraft: draft, round, sources, texts: spanTexts({ draft, fenced: fencedSource, excerpts: excerptsForQuotes(), request, criteria }) }); // cnc-prompts F2: the draft alone (in patch mode the "Was:" blocks and the harness's sentences are not the draft)
          // A re-ask of the same round replaces what the seat's earlier reply of the round recorded (the latest ask is the one that counts; a refused table's reply is not counted twice).
          if (tag) for (let k = answerBackReplies.length - 1; k >= 0; k--) if (answerBackReplies[k].round === round && answerBackReplies[k].lab === seatKeyOf(criticSeat) && answerBackReplies[k].effect !== 'withdrawn_exchange') answerBackReplies.splice(k, 1);   // 0.8.4 S6: the withdrawals the seat made in its layer's exchange are not its blind reply's records: the top-layer re-ask (G7) comes after the exchange and must not erase them (no in-pass re-ask can meet one: they come before the exchange)
          // E84: on a retained chain a row carried for want of an answer says whether the judge was asked: 'asked' / 'reask_spent' on a re-ask, 'own_verdict_objects' when its own verdict already objects (carried at once, nothing to ask),
          // 'words_not_recorded' when the re-ask sentence is not recorded; a first ask that may still be re-asked is stamped where the round decides (askLayer's adoption of the fallback).
          const objectsAlready = critique.meets !== true || applied.carried.length > 0;
          const unansweredAsk = !retained ? undefined : tag ? askOnReask : objectsAlready ? 'own_verdict_objects' : !held('criticUnansweredNote') ? 'words_not_recorded' : undefined;
          const ownById = id => answerBackLatest[seatKeyOf(criticSeat)].objections.find(o => o.id === id);
          for (const r0 of applied.records) {
            // Unit 3: an earlier objection rated below the settle line that the judge left without an answer blocks nothing and is not asked about again; it is recorded as carried (and swept), never as an unanswered gap.
            const r = sevRun && r0.effect === 'unanswered' && severityMeets([ownById(r0.id)]) ? { ...r0, effect: 'swept_carried', path: 'answer_back' } : r0;
            recordAnswerWithdrawal(seatKeyOf(criticSeat), r, round, ownById(r.id)?.severity);
            answerBackReplies.push(withEvidence({ round, lab: seatKeyOf(criticSeat), ...r, ...(r.effect === 'unanswered' && unansweredAsk ? { ask: unansweredAsk } : {}) }, critique.answers));
          }
          if (applied.carried.length) {
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: ${applied.carried.length} earlier objection(s) stay open (a withdrawal needs a quote from the draft; a sustained answer, or one that says neither sustained nor withdrawn, leaves it open): ${applied.carried.map(c => c.id).join(', ')}`);
            critique = { ...critique, failures: [...critique.failures, ...applied.carried], meets: sevRun ? severityMeets([...critique.failures, ...applied.carried]) : false };
          }
          // Astra's 0.8.2 review (7 Oct 2026, F1): a CLEAN sign-off that leaves some of the judge's own objections without any answer is not counted yet. The first ask of the round
          // turns into a re-ask (below, with the table check's one re-ask: a cost cap); on the re-ask, or when the round is not re-asked, what is still unanswered is carried as a
          // failure, so the non-pass follows from the objection itself. Off until `criticUnansweredNote` is recorded in src/roles.js (the judge must be told why it is asked again).
          // A verdict that already objects (its own failures, or a carried answer above) carries its unanswered ones at once with no re-ask: it is no pass either way, and an objection it
          // skipped would otherwise be missing from the next round's answer-back and could pass unanswered there (Sonnet review of item 27, 7 Oct 2026, finding 3).
          // A re-ask whose first ask was LOST (unreadable, cut off) is a re-ask too: the round's one re-ask is spent, so what it leaves unanswered is carried without the note (a cost cap).
          // Layered (E3, readers audit 22): the unanswered branch does not depend on the held sentence: without it the ids are carried at once instead of being re-asked with a prompt that cannot say why.
          if (sevRun && applied.unanswered.length && severityMeets(applied.unanswered)) {
            // Unit 3: only objections rated below the settle line are left unanswered: nothing here blocks, so there is no re-ask (no paid call for it); they stay on the verdict as swept.
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: no answer for ${applied.unanswered.length} earlier objection(s) rated below ${SEVERITY_LINES.settle} - they block nothing, so the judge is not asked again for those answers: ${applied.unanswered.map(c => c.id).join(', ')}`);
            critique = { ...critique, failures: [...critique.failures, ...applied.unanswered] };
          } else if (applied.unanswered.length && (held('criticUnansweredNote') || retained)) {
            if (critique.meets !== true || /^-(?:reask\d+|solo)$/.test(tag) || (retained && !held('criticUnansweredNote'))) {
              say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: no answer for ${applied.unanswered.length} earlier objection(s)${critique.meets === true ? ' after the re-ask' : ''} - they stay open: ${applied.unanswered.map(c => c.id).join(', ')}`);
              critique = { ...critique, failures: [...critique.failures, ...applied.unanswered], meets: false };
            } else pendingAnswers = applied.unanswered;
          }
        }
        // What this seat's verdict becomes if it is not re-asked about its unanswered objections (or the re-ask is lost): an objection carrying them.
        const unansweredFallback = pendingAnswers ? { seat: criticSeat, critique: { ...critique, failures: [...critique.failures, ...pendingAnswers], meets: false }, stage: parsedLabel } : null;   // `stage`: the fallback is adopted as the judge's verdict when the re-ask does not replace it (M0 FIX-UP 2, raised_in)
        {
          const outside = outsideCriteriaRows(critique, criteria);
          if (outside.length) outsideCriteriaRowList.push({ round, lab: seatKeyOf(criticSeat), rows: outside });
        }
        if (tableRequired && critique.meets === true) {
          const gap = signoffTableGap(critique, criteria);
          // 3 Nov 2026: a complete table that row matching could not read pauses for a repair (tablePause); thrown outside the call's try, as the near-JSON pause is, so settleAll records the other seats first.
          const tableRepair = gap && askedPrompt ? tablePause(cs, criticSeat, askedPrompt.system, sentUserOf(cs, askedPrompt.user), gap, criteria, Array.isArray(critique.criteria) ? critique.criteria.filter(r => r && typeof r === 'object' && !Array.isArray(r)) : []) : null;
          if (tableRepair) { say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: signs off with a full table whose rows could not be matched to the criteria - the run pauses for a repair (${tableRepair.label}).`); throw tableRepair; }
          if (gap) {
            say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: signs off without a full table (${describeTableGap(gap)}) - counted as an abstention, not a sign-off.`);
            noteMissingRows(critique, round, seatKeyOf(criticSeat));
            signoffTableGaps.push({ round, lab: seatKeyOf(criticSeat), ...(tag ? { stage: `panel-${round}-${seatKeyOf(criticSeat)}${tag}` } : {}), ...gap });
            progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
            return { seat: criticSeat, critique: null, abstained: true, reasonCode: 'INCOMPLETE_TABLE', tableGap: gap, ...(unansweredFallback ? { answersGap: pendingAnswers, unansweredFallback } : {}) };
          }
        }
        if (unansweredFallback) {
          say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: signs off without answering ${pendingAnswers.length} of its own earlier objection(s) (${pendingAnswers.map(c => c.id).join(', ')}) - not counted as a sign-off yet.`);
          progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), dropped: true });
          // Internal only: the round turns every such verdict into a re-ask or into `unansweredFallback` before anything is recorded, so this code never reaches report.json.
          return { seat: criticSeat, critique: null, abstained: true, reasonCode: 'UNANSWERED_OBJECTIONS', answersGap: pendingAnswers, unansweredFallback };
        }
        say(`  ${shownSeat(criticSeat)}/${criticSeat.model}: ${critique.meets ? 'SIGNED OFF' : `${critique.failures.length} failure(s)`} - ${critique.verdict_line || ''}`);
        noteMissingRows(critique, round, seatKeyOf(criticSeat));
        if (checks) noteUnevidenced(critique, round, seatKeyOf(criticSeat), say);
        // v5 item 3, touch point 2: the verdict update the live view needs - `passed` (chain.js's
        // own name for "meets every criterion") is already computed here, no new parsing.
        progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}${tag}`, lab: labOf(criticSeat), ...seatField(criticSeat), passed: critique.meets === true, ...(earlyAsk && criticSeat.layer === topLayer ? { earlyAnswer: true } : {}) });   // ROADMAP 83: the live view labels the overseer's answer to a proposal, never as an ordinary sign-off
        critique.failures.forEach(f => say(`    FAILED: ${f.criterion} - ${f.problem}`));
        return { seat: criticSeat, critique, stage: parsedLabel };   // M0 FIX-UP 2 (item 3): the label of the stage whose reply this verdict is, so an objection can say where it was raised (`raised_in`)
      };

      // R1: the heard seats' clean verdicts from the last round, when the draft is unchanged.
      const shownDraft = draft + changedSince(lastPatches);
      const carried = carry && carry.shownDraft === shownDraft ? carry.byLab : null;
      carry = null;
      if (carried) {
        log(`  draft unchanged since round ${round - 1}: carrying over the verdicts of ${[...carried.keys()].map(labFromKey).join(', ')} on this same text; asking only ${config.seats.critics.filter(c => !carried.has(seatKeyOf(c))).map(c => `${seatKeyOf(c)}/${c.model}`).join(', ')}.`);
      }
      const carriedVerdict = criticSeat => {
        const v = carried?.get(seatKeyOf(criticSeat));
        if (!v) return null;
        progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(criticSeat)}`, lab: seatKeyOf(criticSeat), carried: true, ...(v.passed ? { passStated: true } : { passed: true }) });
        return { ...v, carried: true, ...(layered ? { fromRound: v.fromRound ?? round - 1 } : {}) };
      };

      // E2a (0.8.3, the layered panel's first step; contract Review/Build_0.8.3/m6-closing/Layered_Panel_Contract.md 4.1): everything from "ask the seats" to "turn an unanswered fallback into an objection" is one
      // function over a set of seats. It appends to the round's shared `verdicts`, and its two loops (the re-ask of unheard seats, the unanswered-objection fallback) read only the verdicts THIS call
      // appended (from `start`). The unlayered panel calls it once with every critic: start is 0, so the calls, their order, the logs and the stage labels are what they were before the refactor.
      // `panelVerdicts[].reasked`: the indices (in `verdicts`) of the seats a re-ask CALL was made for in this round. Derived from the act: it is added to in the one re-ask loop below, immediately before the call, so a seat that was
      // unheard on its first ask but never re-asked (another judge objected, so nothing was left to decide; or its re-ask was spent) is not recorded as asked again (reasked defect, found 14 Oct 2026 at 38f3314).
      const reaskedAt = new Set();
      let reaskInFlight = null;   // 0.8.4 (--finish): the index of a re-ask whose call has not come back; a finish that cuts it leaves `reasked` false (no call was sent)
      // Bug audit 2026-10-24 C-004: these two recordings used to sit AFTER the E4 ledger stop, so a round that stopped there lost what its already-asked layers produced (their panelVerdicts rows, their "Round r panel" history entry, and the notes in their
      // replies: paid calls whose records vanished). They are functions now: the ledger stop calls the same code the normal path calls (further down, in the same places as before). signoff[], lastCritique and finalPanelRound still mean "the last panel that finished".
      const foldRoundNotes = () => {
        // Notes lane, the ONE place notes are read (gate note 1.2): from the verdicts that became this pass's recorded set (a critique, not carried), in (pass, lab) order, with the budget left after the same seat's
        // earlier passes of this overseer round. A reply that never became a verdict (unreadable, cut off, an abstention that was re-asked) is counted as dropped, with its lab and pass, and a seat that ended the
        // pass unheard or truncated is not asked again in the same overseer round (notesAskNote).
        const or = notesRound(round); const consumed = new Set(); let ignored = 0;
        const seatIndex = lab => config.seats.critics.findIndex(c => seatKeyOf(c) === lab);
        // The dropped rows this pass's calls pushed while they ran (a cut-off reply, a cut-off first reply the retry replaced) are put in SEAT order: blind seats run at the same time, so on a live run they arrive in reply order, on a replay in seat order.
        { const early = []; for (let i = notesDropped.length - 1; i >= 0; i--) if (notesDropped[i].pass === round) early.unshift(...notesDropped.splice(i, 1)); early.sort((x, y) => seatIndex(x.lab) - seatIndex(y.lab)); notesDropped.push(...early); }
        // Notes lane (2b-0, C&C ruling Q1, 16 Okt 2026): the notes of EVERY reply of a pass that parsed (the first reply, a `-answered` attempt, each re-ask) are read here, in the order the calls were made, iff the seat ENDS the pass with a
        // recorded verdict (a critique that is not carried). One budget (budgetLeft over the items already read) and one id rule (an id this seat already gave in this pass is skipped before the cut, so it costs no slot) cover all of them.
        // A seat that ends the pass unheard keeps the drop below. Each item records the attempt (the stage-label suffix of the file that holds its reply: '' first reply, 'reask1', 'reask2', 'answered', ...).
        for (const v of verdicts) {
          const lab = seatKeyOf(v.seat);
          if (!v.carried) { if (v.critique || v.passed) notesUnheardIn.delete(lab); else notesUnheardIn.set(lab, or); }
          if (v.carried || !v.critique) continue;
          for (const [key, st] of notesStash) {
            if (st.lab !== lab || st.pass !== round) continue;
            consumed.add(key);
            if (!notesOn) { ignored += 1; continue; }
            const left = { proposal: budgetLeft(notesItems, lab, 'proposal', or, notesCfg.perKind), idea: budgetLeft(notesItems, lab, 'idea', or, notesCfg.perKind) };
            const skipIds = new Set(notesItems.filter(i => i.lab === lab && i.pass === round).map(i => i.id));
            const read = readNotes(st.notesReply, { left, textMax: notesCfg.textMax, aboutMax: notesCfg.aboutMax, skipIds });
            const attempt = st.label.slice(`panel-${round}-${lab}`.length).replace(/^-/, '');
            for (const item of read.items) {
              notesItems.push({ ...item, lab, layer: v.seat.layer ?? null, overseer_round: or, pass: round, attempt });
              if (item.text.length > notesCfg.itemChars) notesLong += 1;
            }
            for (const kind of ['proposal', 'idea']) if (read.cut[kind]) notesCut.push({ lab, overseer_round: or, pass: round, kind, count: read.cut[kind] });
            for (const d of read.dropped) notesDropped.push({ lab, pass: round, why: d.why, ...(d.kind ? { kind: d.kind } : {}) });
          }
        }
        // The replies whose seat did not end the pass heard: dropped, in SEAT order (a live run's replies arrive in any order; the record must not depend on it).
        for (const [key, st] of [...notesStash].filter(([, e]) => e.pass === round).sort((x, y) => seatIndex(x[1].lab) - seatIndex(y[1].lab))) {
          if (!consumed.has(key)) { if (notesOn) notesDropped.push({ lab: st.lab, pass: round, why: 'verdict_not_recorded' }); else ignored += 1; }
          notesStash.delete(key);
        }
        if (ignored) log(`  review notes: ${ignored} judge repl${ignored === 1 ? 'y' : 'ies'} in pass ${round} carried a notes part, ignored (this chain's review notes are off).`);
      };
      // The row of one seat's verdict in panelVerdicts[] (also written, marked `cut`, for the layer a --finish cut off).
      const panelRowOf = (v, i) => ({
      round, lab: labOf(v.seat), ...seatField(v.seat), model: v.seat.model,
      ...climbSortingOf(v),   // 0.8.4 S8 (money step): a top-layer seat's sorting with its verdict (additive; nothing unless the sorting is on and the seat gave a verdict this pass)
      ...(layered ? { layer: v.seat.layer } : {}),
      ...(v.seat.lane ? { lane: v.seat.lane } : {}),
      verdict: v.abstained ? 'unheard' : v.passed ? 'passed' : v.decidedOnly || adoptedNow.some(f => f.lab === seatKeyOf(v.seat) && adoptedHolds(f)) ? 'objected' : v.critique.meets === true ? 'signed_off' : 'objected',
      ...(v.exchangeChangedIn === round ? { exchange_changed: true } : {}),   // B2: a carried verdict that the exchange of THIS pass changed
      ...(!v.abstained && !v.passed && openOwnOf(v).length ? { defect_named: true } : {}),   // M1: a clean sign-off that named a defect in an exchange post keeps its signed_off word; the defect is its own open objection (signoff[].holds_layer says whether it holds the layer)
      ...(sevRun && !v.abstained && !v.passed && v.critique.meets === true && v.critique.failures.length ? { swept_only: true } : {}),   // unit 3: signed off although it lists objections, every one rated below the settle line (swept): told apart from a clean sign-off
      ...(v.exchangeCleared ? { exchange_cleared: true } : {}),   // B2 (on a carried verdict: cleared in the pass it came from): signed off because every objection of this judge was withdrawn in the layer's exchange (the verdict enum is a public contract and stays as it is)   // stall escalation: decidedOnly (it objected, only with ids a ruling had closed) and a seat that SUSTAINED a passed-up objection (it holds it as its own now) both objected
      ...(adoptedNow.some(f => f.lab === seatKeyOf(v.seat)) ? { sustained: adoptedNow.filter(f => f.lab === seatKeyOf(v.seat)).map(f => f.sustained_from.id) } : {}),   // additive: the passed-up ids this seat sustained in its ruling
      reason_code: v.abstained ? (v.reasonCode || null) : null,
      ...(v.abstained && v.tableGap ? { table_gap: v.tableGap } : {}),
      ...(v.abstained && v.noAnswer ? { no_answer: v.noAnswer } : {}),
      ...(v.abstained && v.envelope ? { envelope: v.envelope } : {}),
      reasked: reaskedAt.has(i),
      // R1: additive. True when this seat was not asked this round: its verdict from the round
      // before, on the same unchanged draft, was carried over.
      ...(v.carried ? { carried: true } : {}),
      ...(layered && v.carried ? { from_round: v.fromRound } : {}), // 0.8.3 E2b, additive: the round the carried verdict was given in
      });
      // Item 2 (his 1:b, 13 Nov 2026): what a judge's `cut` row objected to stays on the record as OPEN, whichever finish cut it. The row itself still counts for no sign-off and no read. The failures are built as the pass builds its own (seat key, objectionId), so a repeat of an objection the judge already
      // holds keeps its id; the ones that were not on the record before the cut join the open list at the end (`openFailures0`) marked `cut_off`, and stay out of every list a model is asked about (`litigated`, the final read's sorting, the closing read). One the judge already held (heard, carried, not asked, standing) stays as it was, unmarked.
      const noteCutOpen = (vs, withdrawn = [], named = []) => {
        const gone = new Set(withdrawn.map(w => w.id));
        // Ruling 19: what the cut exchange's COMPLETED rounds settled is recorded where a completed exchange records a withdrawal (the shown-back list that the closed states read, the answer-back ledger, the severity record); a round the finish cut applied nothing, so it is not here.
        for (const w of withdrawn) {
          cutWithdrawn.add(`${w.lab}\u0000${w.id}`);
          exchangeWithdrawals.set(w.lab, [...(exchangeWithdrawals.get(w.lab) || []).filter(x => x.id !== w.id), { id: w.id, criterion: w.criterion, problem: w.problem, ...(w.quote ? { quote: w.quote } : {}), reason: w.reason, pass: round }]);
          if (answerBackOn) answerBackReplies.push({ round, lab: w.lab, id: w.id, status: 'withdrawn', effect: 'withdrawn_exchange' });
          if (sevRun && !w.from_exchange) sevRun.withdraw(w.lab, w.id, 'exchange', round, w.severity);
        }
        for (const n of named) if (!gone.has(n.id) && !cutFailures.some(f => f.lab === n.lab && f.id === n.id)) cutFailures.push({ ...n, cut_off: true, last_raised_round: round });   // an objection a judge named in a completed round of the cut exchange
        for (const v of vs) {
          if (v.abstained) continue;
          const lab = seatKeyOf(v.seat);
          for (const f of [...(v.critique && v.critique.meets !== true ? v.critique.failures : []), ...openOwnOf(v)]) {
            if (!f.criterion) continue;
            const id = f.id ?? objectionId(lab, f);
            if (gone.has(id)) continue;   // the raiser withdrew it in a round of the exchange that finished before the cut
            cutFailures.push({ ...f, lab, id, cut_off: true, last_raised_round: round });
          }
        }
      };
      const recordPanelRound = () => {
      if (sevRun) for (const v of verdicts) {
        // Unit 3: this pass's counted verdicts commit their claimed tags (the first valid tag of an id stands; a later different claim is an override). A carried verdict counted in an earlier pass; an abstention counted for nothing.
        if (v.abstained) continue;
        // M1: the own open objections a verdict carries (`openOwn`: a stated pass's, and the defect a clean sign-off named in an exchange post) commit their tags too: their first valid tag is pinned like any other. A carried verdict counted in an earlier pass, except for what this pass's exchange minted on it.
        const claimed = v.carried || !v.critique ? [] : v.critique.failures; const carriedOwn = v.carried && v.exchangeChangedIn !== round ? [] : openOwnOf(v);
        const own = [...claimed, ...carriedOwn];
        if (!own.length) continue;
        const labKey = seatKeyOf(v.seat); const best = new Map();
        // 0.8.4 (FIX-1, C&C 11 Nov 2026): a carried entry that holds the value a RE-TAG put in force (the handler's, or the top layer's) is not a rating the judge gave: it is not committed, so no override row is made for it. The lowering stays on record under whoever gave it (severity.retags: by, seat, from, to, reason). A rating the judge gives itself (its listed failures) still commits and is an override when it differs from its first tag.
        // A carried entry reaches this loop in two shapes: in `openOwn`, or folded into the verdict's own failures with `carried_from_round` (the shape a quiet or sustaining judge's stated pass takes: found on the box, the first attempt that read openOwn only left the row in place). A judge's own listed failure has no `carried_from_round`.
        const isCarried = f => carriedOwn.includes(f) || Number.isInteger(f.carried_from_round);
        const byRetag = f => { const t = sevRun.retagInForce(labKey, objectionId(labKey, f)); return t !== undefined && t === readSeverity(f.severity).value; };
        for (const f of own) { if (isCarried(f) && byRetag(f)) continue; const r = readSeverity(f._claimed ?? f.severity); if (!r.ok) continue; const id = objectionId(labKey, f); if (!(best.get(id) >= r.value)) best.set(id, r.value); }
        for (const [id, value] of best) sevRun.commit(labKey, id, value, round);
      }
      verdicts.forEach((v, i) => panelVerdicts.push(panelRowOf(v, i)));

      history.push(`## Round ${round} panel\n${verdicts.map(v =>
      `- ${shownSeat(v.seat)}/${v.seat.model}: ${v.abstained ? (v.reasonCode === 'INCOMPLETE_TABLE' ? 'abstained (attempted sign-off without a complete per-criterion table)' : 'abstained (unreadable reply)') : v.passed ? `passed (declined to give a verdict) - ${v.passReason || '(no reason given)'}` : v.decidedOnly ? `raised only ${v.closedRaised.map(f => f.id).join(', ')}, closed by an earlier ruling (not counted)` : v.critique.meets && !holdingOwnOf(v).length ? 'signed off' : `${v.critique.failures.length + openOwnOf(v).length} failure(s)`}${adoptedNow.some(f => f.lab === seatKeyOf(v.seat)) ? `; then sustained ${adoptedNow.filter(f => f.lab === seatKeyOf(v.seat)).map(f => f.sustained_from.id).join(', ')} as its own` : ''}`
      ).join('\n')}`);
      };
      // E3 readers audit: ONE derived predicate for "this ask objects". A stated pass that carries its own open objections objects; every other pass is a non-vote, as before.
      const openOwnOf = v => v.openOwn || [];
      const holdingOwnOf = v => (sevRun ? openOwnOf(v).filter(f => holdsSignOff(f.severity)) : openOwnOf(v));   // unit 3 (flag d): with the switch, only the carried objections that hold a sign-off make a stated pass an objection (swept ones make it a plain stated pass)
      const objects = v => (v.critique && v.critique.meets !== true) || holdingOwnOf(v).length > 0;
      const askLayer = async seats => {
        const start = verdicts.length;
        try {
        if (relay) {
          // Relay seats run one after another, in a fresh order each round so
          // no lab is always the anchor (seeded, so a resume replays it), and
          // earlier verdicts are handed on anonymised so a seat can't defer to a name.
          for (const criticSeat of seededShuffle(seats, `${runId ?? ''}:relay:${round}`)) {
            const kept = carriedVerdict(criticSeat);
            if (kept) { verdicts.push(kept); continue; }
            const prior = verdicts.filter(v => v.critique).map((v, i) => ({ lab: `Reviewer ${String.fromCharCode(65 + i)}`, verdict_line: v.critique.verdict_line, failures: v.critique.failures }));
            verdicts.push(await reviewSeat(criticSeat, prior, log));
          }
        } else {
          // Blind seats see nothing of each other, so they run at the same
          // time. Each seat's log lines are buffered and flushed in seat order,
          // so the run log reads exactly as it did when they ran in sequence.
          const settled = await Promise.allSettled(seats.map(async criticSeat => {
            const kept = carriedVerdict(criticSeat);
            if (kept) return { verdict: kept, lines: [] };
            const lines = [];
            const verdict = await reviewSeat(criticSeat, [], m => lines.push(m));
            return { verdict, lines };
          }));
          // PR #2 review (Sol): when the person's finish ends the run at a seat's call, the judges of the same stage that DID answer stay on the record: they go into `verdicts`, where the finish's catch writes them marked `cut` and counts
          // their objections as open; a seat that was not answered is not recorded as a verdict at all (the layer ends `unfinished`), as in a relay panel. Any other rejection travels as before: the answered replies are on disk, a resume replays them.
          const first = settled.find(r => r.status === 'rejected');
          const finishedHere = first?.reason instanceof SecretFinish;
          if (!finishedHere) throwFirstRejection(settled);
          for (const { verdict, lines } of settled.filter(r => r.status === 'fulfilled').map(r => r.value)) {
            lines.forEach(m => log(m));
            verdicts.push(verdict);
          }
          if (finishedHere) throw first.reason;
        }

        // Re-ask only the seats that were not heard, and only when it matters: every heard reviewer
        // is clean (signed off or stated a pass), so the unheard seat alone decides the round. The
        // rest of the panel already answered this exact draft, so asking them again would only
        // spend money. Two extra attempts per round at most; a seat still unheard after that leaves
        // the round non-unanimous (below). If a heard reviewer objected there is nothing to
        // decide here - the reviser runs on the union of objections and the next round re-asks all.
        const heardClean = () => verdicts.slice(start).every(v => v.abstained || (v.passed && !holdingOwnOf(v).length) || (v.critique?.meets === true && !holdingOwnOf(v).length));
        // B3 prep (unit V, C&C ruling): with the severity switch on, a verdict unreadable for a MISSING TAG (`severityGap`) is re-asked exactly ONCE with a note, whatever the other judges did (one paid call per seat per round).
        // Every other unheard seat keeps today's rule above; with the switch off `severityGap` is never set, so this loop is today's.
        for (let reask = 1; reask <= IN_PASS_REASKS_PER_SEAT && verdicts.slice(start).some(v => v.abstained && (heardClean() || (v.severityGap && reask === 1))); reask++) {
          const cleanAtStart = heardClean();   // read ONCE per iteration, as before this unit: a re-ask earlier in the same sweep must not change who the later seats' re-asks depend on
          for (let i = start; i < verdicts.length; i++) {
            if (!verdicts[i].abstained) continue;
            if (!cleanAtStart && !(verdicts[i].severityGap && reask === 1)) continue;
            if (verdicts[i].severityGap && reask > 1) continue;
            // 0.8.2 (owner decision 1: "one re-ask, then abstention"): a seat refused for an incomplete table is re-asked once; an unreadable or lost reply keeps its two.
            // F1 (Astra, 7 Oct 2026): a seat re-asked about unanswered objections shares that one re-ask (a cost cap), even when the re-ask itself came back unreadable.
            if (reask > 1 && (verdicts[i].reasonCode === 'INCOMPLETE_TABLE' || verdicts[i].unansweredFallback)) continue;
            const seatToAsk = verdicts[i].seat;
            log(`  re-asking only ${shownSeat(seatToAsk)}/${seatToAsk.model} (${reask}/${IN_PASS_REASKS_PER_SEAT}) - it was not heard; the rest of the panel already answered this draft.`);
            const prior = relay ? verdicts.filter(v => v.critique).map((v, k) => ({ lab: `Reviewer ${String.fromCharCode(65 + k)}`, verdict_line: v.critique.verdict_line, failures: v.critique.failures })) : [];
            const before = verdicts[i];
            reaskedAt.add(i); reaskInFlight = i;
            verdicts[i] = await reviewSeat(seatToAsk, prior, log, `-reask${reask}`, before.tableGap || null, before.answersGap || null, before.answersKind || null, before.envelope || null, before.severityGap || null);
            // A LOST re-ask (no verdict read at all) must not lose the objections it was asked about: the earlier fallback stays. A re-ask refused only for its table did read the
            // judge's answers (an answered objection is closed, a still unanswered one was carried), so the old fallback must not come back (Sonnet review of item 27, finding 1).
            reaskInFlight = null;
            if (verdicts[i].abstained && verdicts[i].reasonCode !== 'INCOMPLETE_TABLE' && !verdicts[i].unansweredFallback && before.unansweredFallback) verdicts[i] = { ...verdicts[i], answersGap: before.answersGap, answersKind: before.answersKind, unansweredFallback: before.unansweredFallback, askedAgain: !!before.answersGap?.length };
          }
        }
        // 0.8.4 (ladder unit, silent judges; Muad 10 Nov 2026 "b is OK"; C&C's readings): a judge still silent after its in-pass re-asks gets ONE more call on its own inside the pass (label `-solo`, the re-ask price, through the cap like every call), and its layer WAITS for it: no layer signs off without it. If it is still silent the pass ends `unheard`
        // and the run stops at the silent-judge stop at once (src/overseer-rounds.js UNHEARD_PASSES_BEFORE_STOP: the solo ask replaces the two repeated full passes), which offers all three choices. Same conditions as the re-asks: only while every judge that WAS heard is clean (a judge silent in a pass where another judge objected stays unheard that pass, unchanged), and not for a seat whose
        // table was refused (its one re-ask) or that carries unanswered objections (their one re-ask).
        {
          const soloable = v => v.abstained && v.reasonCode !== 'INCOMPLETE_TABLE' && !v.unansweredFallback && !v.severityGap;
          if (verdicts.slice(start).some(soloable) && heardClean()) {
            for (let i = start; i < verdicts.length; i++) {
              if (!soloable(verdicts[i])) continue;
              const seatToAsk = verdicts[i].seat;
              log(`  asking ${shownSeat(seatToAsk)}/${seatToAsk.model} once more, on its own (solo) - it was not heard after its re-asks, and its layer waits for it.`);   // A-DRAFT (WORDING LAD-R37)
              const prior = relay ? verdicts.filter(v => v.critique).map((v, k) => ({ lab: `Reviewer ${String.fromCharCode(65 + k)}`, verdict_line: v.critique.verdict_line, failures: v.critique.failures })) : [];
              const before = verdicts[i];
              reaskedAt.add(i); reaskInFlight = i;
              verdicts[i] = await reviewSeat(seatToAsk, prior, log, '-solo', before.tableGap || null, before.answersGap || null, before.answersKind || null, before.envelope || null, before.severityGap || null);
              reaskInFlight = null;
            }
          }
        }
        // F1: a seat still waiting on its unanswered objections (not re-asked because another judge objected, or its re-ask was lost) is recorded as objecting with them, never as unheard.
        for (let i = start; i < verdicts.length; i++) {
          if (!verdicts[i].abstained || !verdicts[i].unansweredFallback) continue;
          const v = verdicts[i];
          // E84: whether the explicit ask happened is known here: 'asked' when a re-ask with the note was made (its reply was lost, so the first ask's fallback stands), else the round never re-asked because another judge of the
          // layer objected ('layer_objected': nothing to decide; the judge is asked again in the next round it is in). Retained chains only.
          const askNow = v.askedAgain ? 'asked' : 'layer_objected';
          const { settle: settleFallback, ...adopted } = v.unansweredFallback; // the closure stays out of the verdict list
          verdicts[i] = adopted;
          if (v.answersKind === 'stated_pass') {
            // The deferred stated pass is adopted as E3 recorded it: a pass that carries its objections. Its rows and the entry are written now. A first ask that was never re-asked was never "re-asked" in the record either.
            log(`  ${shownSeat(v.seat)}/${v.seat.model}: ${v.answersGap.length} earlier objection(s) still without an answer after its stated pass - they stay open: ${v.answersGap.map(c => c.id).join(', ')}`);
            settleFallback(askNow, log);
            progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(v.seat)}`, lab: seatKeyOf(v.seat), passStated: true });
          } else {
            log(`  ${shownSeat(v.seat)}/${v.seat.model}: ${v.answersGap.length} earlier objection(s) still without an answer - they stay open: ${v.answersGap.map(c => c.id).join(', ')}`);
            if (retained) for (const r of answerBackReplies) if (r.round === round && r.lab === seatKeyOf(v.seat) && r.effect === 'unanswered' && r.ask === undefined) r.ask = askNow;
            progressHook({ kind: 'verdict', label: `panel-${round}-${seatKeyOf(v.seat)}`, lab: seatKeyOf(v.seat), passed: false }); // the live view showed it dropped; it is an objection now
          }
        }
        } finally {
          flushShown(seats); // E3: the answer_back summary rows of the labs whose call went out, in seat order, even when a later seat's call stopped the run
          // E84: a stop (the spend cap refuses the re-ask before it is sent, an external seat pauses, an abort) between a judge's first ask and the round's decision leaves its deferred verdict undecided. The record must still
          // be what it was at E3 plus the truth about the ask: a stated pass writes its rows as E3 wrote them, and every row carried for want of an answer says `run_stopped` (the run ended before the judge's answer to a re-ask was in).
          // After a normal ask nothing is pending here (the adoption loop above replaced every interim verdict), so this is a no-op. Retained chains only.
          if (retained) for (let i = start; i < verdicts.length; i++) {
            const v = verdicts[i];
            if (!v.abstained || !v.unansweredFallback) continue;
            const { settle: settleFallback } = v.unansweredFallback;
            if (v.answersKind === 'stated_pass') settleFallback('run_stopped', log);
            else for (const r of answerBackReplies) if (r.round === round && r.lab === seatKeyOf(v.seat) && r.effect === 'unanswered' && r.ask === undefined) r.ask = 'run_stopped';
          }
        }
      };
      // The state of one layer from the verdicts it produced (gate page 3.2): an objection ends the climb; a seat not heard ends it too (the round asks again on the unchanged draft); a layer in which nobody
      // voted, or (the top layer above other layers) not every seat signed off explicitly, is `abstained` and stops the run.
      const layerState = (vs, explicit) => {
        if (vs.some(objects)) return 'objected';
        if (vs.some(v => v.abstained)) return 'unheard';
        if (explicit) return vs.every(v => v.critique?.meets === true) ? 'signed_off' : 'abstained';
        return vs.some(v => v.critique) ? 'signed_off' : 'abstained';
      };

      // B2 (debate-084/b2, A-DRAFT; 0.8.4: part of every layered unanimous chain): the exchange inside the lowest layer, right after its blind verdicts and BEFORE the layer's state is computed. Each heard judge reads the OTHER judges' objections with
      // the raiser hidden (no lab or model name in the prompt) and posts support / contest / insufficient_evidence / no_view on each; each raiser then answers the posts on its own objections (keep / amend / withdraw). Only a raiser's own
      // argued withdrawal closes an objection: a head count never does. A judge whose every objection was withdrawn counts as signed off (`exchangeCleared`, its own state in panelVerdicts and signoff[]). A material defect a judge
      // names in its post becomes ITS objection now, for the writer and for its own answer next pass. Every call goes through invoke() (labels ldebate-<pass>-<seat>, lreply-<pass>-<seat>), so the cap covers it. The stall signature and
      // the reviser's union read the set AFTER the exchange. Not run for a carried verdict, an unheard judge or a layer with fewer than two heard judges.
      const isHeard = v => !v.abstained && !!(v.critique || v.passed);   // heard: a usable reply (a verdict, or a stated pass)
      const layerExchange = async (from, row) => {
        // The draft the judges saw, and what was already debated on exactly that text. A re-ask pass (an unheard judge asked again on an unchanged draft) carries the verdicts of the judges heard before: they still POST on whatever has not been
        // debated on this draft yet (the re-asked judge's objections, a withdrawn objection raised again, one that was not debated), while an objection already upheld or unresolved on this draft keeps its disposition and is not shown again.
        const shown = draft + changedSince(lastPatches);
        const did = draftIdOf(shown);
        if (!exchangeDebated.has(did)) exchangeDebated.set(did, new Map());
        const debated = exchangeDebated.get(did);
        const settled = id => { const d = debated.get(id); return !!d && (d.outcome === 'stands_uncontested' || d.outcome === 'stands_contested' || d.outcome === 'unresolved_at_stop') && d.item.posted; };   // settled on a draft only when its final text drew a counted post other than no_view (`item.posted`): a row whose every poster was unreadable, or only said no view, was not debated, and is shown again (the base's rule, B2 fix-up A)
        // Q4(d): a judge is HEARD when it gave a usable reply: a verdict (objecting or signing off) or a stated pass (`passed`, critique null). A stated pass reads the others' objections and posts like any heard judge; it holds none of its own (failures []). The same reading is used by the exchange (here), its written record (noteItems, the apply loop) and the lone-heard check.
        const heardV = verdicts.slice(from).filter(isHeard);
        // 0.8.4 S6 (Q5, D4): a layer above the lowest runs the SHORTENED exchange (one round, every raiser replies once with the sign-off line of W14) once the pair W5 + W14 is recorded. `short` is false for layer 1, and for every layer while the pair is held (then only a ladder run with --ladder-exchange gets an upper exchange, as before).
        const short = row.layer !== layerNumbers[0] && shortExchangeOn();
        // The writer's note (`layerExchangeNow`) was ONE slot overwritten by every layer's exchange of the pass: a layer-2 exchange erased layer 1's standing items from the reviser's note. With S6 on the layers of one pass ADD to it (an id is listed once).
        const noteNow = items => short && layerExchangeNow?.pass === round ? { pass: round, items: [...layerExchangeNow.items, ...items.filter(i => !layerExchangeNow.items.some(x => x.id === i.id))] } : { pass: round, items };
        // Q5 "holds again": an upper layer does not inject a carried objection (its judge raises it again blind, merged by id, or it lapses). An entry of a judge that was HEARD in this pass and did not raise it again is cleared, so a flag never outlives the judge's holding it.
        if (short) for (const v of heardV) {
          if (v.carried) continue;   // a verdict carried from an earlier pass was not asked again in this one: nothing can be concluded about what the judge holds now
          const key = seatKeyOf(v.seat); const m = exchangeCarried.get(key); if (!m) continue;
          const heldNow = new Set([...(v.critique?.failures ?? []), ...openOwnOf(v)].map(f => objectionId(key, f)));   // what the judge holds: its listed objections (an answer-back "sustained" is added to them by the caller) and the own objections a stated pass carries or a clean sign-off named in a post (`openOwn`)
          for (const [id, c] of [...m]) if (c.found_pass < round && !heldNow.has(id)) m.delete(id);
          if (!m.size) exchangeCarried.delete(key);
        }
        // Q1(g) (1): an objection the last pass's exchange did not reach goes first into this pass's exchange, debated from round 1 with the objections this pass raises (a raiser that raises it again blind is merged by id, not doubled).
        // RU-S3-55: only the raiser closes its own carried objection, by a withdrawal with a reason; with answer_back on, its answer in THIS pass can be that withdrawal (a quote found in the revised plan). Such an objection is closed, recorded (the answer-back row), and not carried again.
        for (const [key, m] of exchangeCarried) for (const id of [...m.keys()]) if (answerBackReplies.some(x => x.round === round && x.lab === key && x.id === id && x.effect === 'withdrawn')) m.delete(id);
        const carriedFor = (key, own) => [...(exchangeCarried.get(key) || new Map())].filter(([id, c]) => c.found_pass < round && !own.some(f => objectionId(key, f) === id)).map(([, c]) => ({ criterion: c.criterion, problem: c.problem, ...(c.quote ? { quote: c.quote } : {}), ...(c.severity !== undefined ? { severity: c.severity } : {}), ...(c.raised_in ? { raised_in: c.raised_in } : {}), carried_from: c.found_pass }));
        const judges = heardV.map(v => { const key = seatKeyOf(v.seat); const own = v.critique?.failures ?? []; return { seat: v.seat, key, ...(v.stage ? { stage: v.stage } : {}), failures: [...own.filter(f => !settled(objectionId(key, f))), ...(row.layer === layerNumbers[0] ? carriedFor(key, own) : [])] }; });
        // A re-raise: an objection this judge withdrew in an earlier exchange (any draft) or earlier on this draft, raised again. Detected by id only: for an unquoted objection the id is judge plus criterion, so a DIFFERENT complaint under the same criterion reads as a re-raise too (recorded as such, with that limit).
        const reRaised = new Set(judges.flatMap(j => j.failures.map(f => objectionId(j.key, f)).filter(id => (exchangeWithdrawals.get(j.key) || []).some(w => w.id === id) || debated.get(id)?.outcome === 'withdrawn_argued').map(id => `${j.key}\u0000${id}`)));
        const declinedReasons = declinedReasonsFromDisputes(disputes);   // piece R: the writer's reason for each objection it DECLINED, WHOLE (his word 1 Nov 2026: no cut). M0 FIX 1: it reaches the exchange behind the held word W44 (exchangeRound), no longer behind the severity switch; while W44 is held exchangeRound passes none of it on. From the disputes history (the writer's most recent decline of the objection), not the last answer-back: a revision that says nothing keeps the reason, a later decline replaces it
        const { raised, rows, rounds: exchangeRounds, safety_stop: safetyStop, finalPosts, withdrawn, amended, proposed: proposedNew, signoffs: signoffsRaw, attached: attachedNow } = await exchangeRound({ judges, request, criteria, draft: shown, round, record, log, cacheTtl, layout: cacheOrderOn(config) ? { config, checks, endMarker: endMarkerOn } : null, jsonModeLabs: exchangeJsonModeLabs(config), declinedReasons, rulingsText: rulingsNote(round), where: `layer ${row.layer}`, layerOne: row.layer === layerNumbers[0], short, rounds: row.layer === layerNumbers[0] ? EXCHANGE_ROUNDS : short ? 1 : ladder.exchange, personaSystem: (kind, seat, again) => (kind === 'debate' ? layerDebateSystemFor : layerReplySystemFor)(config, seat, again), severity: severityOn });
        for (const at of attachedNow || []) attachedQuotes.set(`${at.lab}\u0000${at.id}`, { quote: at.quote, pass: round, from: at.stage });   // 0.8.4 S14: from here on the objection carries the quote it was given in the exchange (overlaid at the fold, after the id)
        // An exchange that could not run (fewer than two heard judges, nothing to read): the objections still reach the writer, marked as not debated.
        const noteWord = o => ({ stands_uncontested: 'upheld', stands_contested: 'unresolved', unresolved_at_stop: 'unresolved' })[o] ?? o;   // the reviser's note keeps the words it printed before the five record outcomes (held wording W4 replaces the note at the wording review): a record word is mapped back here, so the prompt bytes do not move
        const itemOf = (r, rowsById) => { const row = rowsById.get(r); if (!row && debated.get(r)?.item) return debated.get(r).item; if (!row) return { id: r, outcome: 'not_debated', posts: [], posted: false, reply: null, support: 0, contest: 0, doubt: 0 };
          // M0 FIX-UP 2 (item 6; C&C's word, Option B): "debated" (and so settled()) keeps its meaning from before M0 FIX 2 (`posted`: some reviewer left a counted post other than no_view on the final text); only the COUNTS and the LISTED posts follow each reviewer's latest position (src/layer-debate.js notePositionsOf).
          const { posted, ...seen } = notePositionsOf(finalPosts?.get(row.id) ?? row.posts);
          return { id: row.id, outcome: row.outcome !== 'withdrawn_argued' && !posted ? 'not_debated' : noteWord(row.outcome), ...seen, posted, reply: row.reply || null }; };
        const noteItems = rowsById => verdicts.slice(from).filter(isHeard).flatMap(v => [...(v.critique?.failures ?? []), ...openOwnOf(v).filter(f => rowsById.has(objectionId(seatKeyOf(v.seat), f)))].map(f => objectionId(seatKeyOf(v.seat), f))).filter((id, i, all) => all.indexOf(id) === i).map(id => itemOf(id, rowsById));   // M0 FIX-UP 2 (item 2), widened in M1: the objection a stated pass or a clean sign-off named in an exchange post is on its `openOwn` and has a row of this exchange, so it is listed for the writer like an objecting judge's minted one, whether or not the verdict carries a critique (an own objection carried from an earlier pass has no row here and is not listed)
        if (!raised.length || judges.length < 2) {
          layerExchangeNow = noteNow(noteItems(new Map()));
          // Q4(d), T22ae: where the exchange cannot run for want of two heard judges, the standing objections are recorded flagged not_debated (never claimed debated). S6 (Q7): the same row at a layer above the lowest, so a reader can tell "nothing to debate" from "could not run"; no carry there (a named limit)
          if (raised.length && (row.layer === layerNumbers[0] || short)) layerDebates.push({ pass: round, layer: row.layer, rounds: [], not_run: 'fewer_than_two_heard', objections: raised.map(o => ({ id: o.id, criterion: o.criterion, problem: o.problem, ...(o.quote ? { quote: o.quote } : {}), ...(o.severity !== undefined ? { severity: o.severity } : {}), raised_by: o.key, ...(o.raised_in ? { raised_in: o.raised_in } : {}), posts: [], outcome: 'not_debated', minority_notes: [] })) });
          return;
        }
        if (row.layer === layerNumbers[0] || short) for (const r of rows) {   // the carry store follows the rows (the lowest layer's exchange, and, with S6 on, every layer's: an upper entry is only a FLAG, read by the build check and the climb; nothing injects it again): an objection still not_debated is carried, one that was debated or withdrawn is not
          const m = exchangeCarried.get(r.raised_by) ?? new Map();
          if (r.outcome === 'not_debated') m.set(r.id, { criterion: r.criterion, problem: r.problem, ...(r.quote ? { quote: r.quote } : {}), ...(r.severity !== undefined ? { severity: r.severity } : {}), ...(r.raised_in ? { raised_in: r.raised_in } : {}), found_pass: r.carried_from ?? round });
          else m.delete(r.id);
          if (m.size) exchangeCarried.set(r.raised_by, m); else exchangeCarried.delete(r.raised_by);
        }
        for (const r of rows) { if (reRaised.has(`${r.raised_by}\u0000${r.id}`)) r.re_raise = true; debated.set(r.id, { outcome: r.outcome, item: itemOf(r.id, new Map([[r.id, r]])) }); }
        for (const r of rows) if (r.outcome === 'withdrawn_argued') exchangeWithdrawals.set(r.raised_by, [...(exchangeWithdrawals.get(r.raised_by) || []).filter(w => w.id !== r.id), { id: r.id, criterion: r.criterion, problem: r.problem, ...(r.quote ? { quote: r.quote } : {}), reason: r.reply?.text ?? '', pass: round }]);
        // answer_back: the withdrawal is the raiser's reply to its own objection, written where the ledger the top layer reads and the next pass's answer-back look for it (effect `withdrawn_exchange`: a reason, no quote, and the ledger says so).
        if (answerBackOn) for (const r of rows) if (r.outcome === 'withdrawn_argued') answerBackReplies.push({ round, lab: r.raised_by, id: r.id, status: 'withdrawn', effect: 'withdrawn_exchange' });
        const asNew = r => ({ criterion: r.criterion, problem: r.problem, ...(r.quote ? { quote: r.quote } : {}), ...(r.severity !== undefined ? { severity: r.severity } : {}), by: r.raised_by });
        const news = rows.filter(r => r.from_exchange && r.outcome !== 'withdrawn_argued').map(asNew);   // named in the exchange: new objections
        const carriedNews = rows.filter(r => r.carried_from && !r.from_exchange && r.outcome !== 'withdrawn_argued').map(r => ({ ...asNew(r), carried_from: r.carried_from }));   // carried from an earlier pass: not new, but the raiser's verdict must hold it
        const cleared = [];
        // The defects this exchange names for a judge, as that judge's OWN open objections on its verdict (`openOwn`): the one path a stated pass's own open objections take (M0 FIX 10), and, since M1, a clean sign-off's too. An entry that is already one of the verdict's own open objections is not added twice.
        const mintOwn = (v, key) => [...news, ...carriedNews].filter(n => n.by === key && !openOwnOf(v).some(f => objectionId(key, f) === objectionId(key, n))).map(({ by, carried_from, ...n }) => ({ ...n, fix: '', id: objectionId(key, n), ...(carried_from ? { carried_from_round: carried_from } : { from_exchange: true }) }));
        for (let i = from; i < verdicts.length; i++) {
          const v = verdicts[i];
          if (!isHeard(v)) continue;
          const key = seatKeyOf(v.seat);
          if (!v.critique) {   // a stated pass stays a pass (M0 FIX 8, C&C: no ruling or copy line makes it an objecting verdict, which would record a verdict the seat did not give). The defect it names in a post is ITS OWN objection now (Q1(c), RU-S3-40/41) and it rides on the verdict as `openOwn`, the one path a stated pass's own open objections already take (M0 FIX 10): the sign-off tally counts it (`objects`), it joins the round's failures at the fold point (the reviser's list, the stall signature, the answer-back: a lab with no earlier entry gets it in its new entry, a lab that kept one, a stated pass holding an objection of its own, has it joined to the kept entry, M0 FIX-UP 2), and the recorded verdict word stays "passed".
            const mintedOwn = v.passed ? mintOwn(v, key) : [];
            if (mintedOwn.length) verdicts[i] = { ...v, openOwn: [...openOwnOf(v), ...mintedOwn], ...(v.carried ? { exchangeChangedIn: round } : {}) };
            continue;
          }
          const amendedHere = amended.get(key) || new Map();
          let failures = v.critique.failures.map(f => { const id = objectionId(key, f); return amendedHere.has(id) ? { ...f, problem: amendedHere.get(id) } : f; });
          const had = failures.length;
          if (sevRun) for (const f of failures) if (withdrawn.has(objectionId(key, f))) sevRun.withdraw(key, objectionId(key, f), 'exchange', round, f.severity);
          failures = failures.filter(f => !withdrawn.has(objectionId(key, f)));
          const mineNew = [...news, ...carriedNews].filter(n => n.by === key && !failures.some(f => objectionId(key, f) === objectionId(key, n))).map(({ by, ...n }) => ({ ...n, fix: '', ...(n.carried_from ? {} : { from_exchange: true }) }));
          const changed = failures.length !== had || mineNew.length || amendedHere.size;
          if (!changed) continue;
          // M1, C&C's ruling on the clean sign-off (copy-silent): a verdict that signed off with no objection (meets:true, none listed) and then names a defect in an exchange post KEEPS its recorded meets:true. (An objection of its own CARRIED from an earlier pass, not_debated, still joins its failures and the verdict objects, as before: it is the judge's standing objection, not a defect named in this pass's post.) The defect is that judge's own objection and rides on `openOwn`, as a stated pass's does: `objects` and `holdingOwnOf` count it (the layer is not signed off), it joins the round's failures at the fold point (the reviser's list, the stall signature, the answer-back) and the writer's note lists it; the record keeps the blind sign-off, and signoff[] says what holds the layer (`holds_layer`).
          if (had === 0 && v.critique.meets === true && mineNew.length && !mineNew.some(n => n.carried_from)) {
            const minted = mintOwn(v, key);
            if (minted.length) verdicts[i] = { ...v, openOwn: [...openOwnOf(v), ...minted], ...(v.carried ? { exchangeChangedIn: round } : {}) };
            continue;
          }
          failures = [...failures, ...mineNew];
          const clears = had > 0 && !failures.length && !holdingOwnOf(v).length;
          // A judge counts as signed off only with the table a sign-off needs (the same check a blind sign-off must pass): without a complete table it is an abstention, as for any sign-off, never "objected with nothing to revise".
          const gap = clears && tableRequired ? signoffTableGap(v.critique, criteria) : null;
          if (gap) {
            log(`  ${shownSeat(v.seat)}/${v.seat.model}: every objection was withdrawn, but its table is incomplete (${describeTableGap(gap)}) - counted as an abstention, not a sign-off.`);
            signoffTableGaps.push({ round, lab: key, stage: 'exchange', ...gap });
            verdicts[i] = { seat: v.seat, critique: null, abstained: true, reasonCode: 'INCOMPLETE_TABLE', tableGap: gap };
            continue;
          }
          if (clears) cleared.push(key);
          verdicts[i] = { ...v, critique: { ...v.critique, failures, meets: failures.length ? (sevRun ? severityMeets(failures) : false) : (had > 0 ? true : v.critique.meets) }, ...(clears ? { exchangeCleared: true } : {}), ...(v.carried ? { exchangeChangedIn: round } : {}) };   // a carried verdict the exchange changed is no longer the earlier pass's verdict: the record says so, in the pass it happened (a later carry copies the flag)
        }
        // S6 (W14, G7): each raiser's sign-off line and field, beside what the computed rule says of its verdict AFTER the exchange (signs / objects / unheard). Record only here: `against_computed` is true where the line says no over a judge the rule lets sign, or yes over one it holds.
        const signoffRows = short ? (signoffsRaw ?? []).map(({ seat: key, line, field, value, mismatch }) => {
          const v = verdicts.slice(from).find(x => seatKeyOf(x.seat) === key);
          const computed = !v || v.abstained ? 'unheard' : objects(v) ? 'objects' : 'signs';
          return { seat: key, line, field, said: value, differs: mismatch, computed, against_computed: (value === 'no' && computed === 'signs') || (value === 'yes' && computed === 'objects') };
        }) : [];
        if (short && row.layer === topLayer) signoffNoPending = signoffRows.filter(x => x.said === 'no' && x.computed === 'signs').map(x => x.seat);
        layerDebates.push({ pass: round, layer: row.layer, rounds: exchangeRounds, ...(safetyStop ? { safety_stop: true } : {}), objections: rows, ...(news.length ? { new_objections: news } : {}), ...(proposedNew?.length ? { proposed: proposedNew } : {}), ...(cleared.length ? { cleared } : {}), ...(signoffRows.length ? { signoffs: signoffRows } : {}) });
        const standing = rows.filter(r => r.outcome !== 'withdrawn_argued');
        layerExchangeNow = noteNow(noteItems(new Map(rows.map(r => [r.id, r]))));
        log(`  exchange: ${withdrawn.size} withdrawn_argued, ${standing.filter(r => r.outcome === 'stands_uncontested').length} stands_uncontested, ${standing.filter(r => r.outcome === 'stands_contested').length} stands_contested, ${standing.filter(r => r.outcome === 'not_debated').length} not debated${standing.some(r => r.outcome === 'unresolved_at_stop') ? `, ${standing.filter(r => r.outcome === 'unresolved_at_stop').length} unresolved_at_stop` : ''}${cleared.length ? `; counted as signed off after the exchange: ${cleared.join(', ')}` : ''}${news.length ? `; ${news.length} new objection(s) recorded` : ''}.`);
      };
      // Stall escalation: the floor layer's ruling on the stuck objections, a SEPARATE step right after the layer's blind review (the owner's shape B). One call per seat of the layer, in seat order, label rule-<pass>-<seat>
      // (no other label starts with "rule-"), through invoke() under the cap. The raiser is hidden, lab and layer (C&C ruling 5). Until all three held sentences are recorded no call is made and every objection stays standing
      // (why: prompt_held), as the conflict decider does: the plan still goes up and the layer still reviews it blind. A sustained objection becomes the sustaining seat's own, under its own id (sustained_from keeps the raiser's);
      // an overruled or sustained one leaves its raiser's answer-back entry (closed for the raiser). The floor layer then counts as objecting when anything was sustained.
      // The escalation row and result whose ruling closed (overruled) or moved (sustained) this raiser's id; null for any other id (an undecided one stays the raiser's own).
      const closedByRulingFor = (seatKey, id) => { for (const row of escalations) if (closedByRowRuling(row, seatKey, id)) return { row, result: row.outcome.find(x => x.id === id && (x.seat ?? x.lab) === seatKey && closedByRuling(x)).result }; return null; };
      // 0.8.4 S7b A1: the settle-and-adopt half of ruleOnEscalation, moved WHOLE (byte for byte, no change of behaviour) so the ordinary-call hook of a later commit can feed the same logic: it turns the per-seat
      // rulings into esc.row.rulings and esc.row.outcome, adopts a sustained objection under the sustaining seat, removes a closed one from its raiser's answer-back entry, and makes the floor layer object when a held one was adopted.
      const settleEscalationRulings = ({ esc, row, ids, items, perSeat, seats }) => {
        const keys = seats.map(seatKeyOf);
        const settled = settleRulings({ ids, seats: keys, perSeat });
        const own = new Set(verdicts.filter(v => v.critique).flatMap(v => v.critique.failures.map(f => `${seatKeyOf(v.seat)}\u0000${objectionId(seatKeyOf(v.seat), f)}`)));
        // S6 (Q6, C&C's ruling: the later act counts): the exchange of this pass takes an objection a layer-2 judge WITHDREW out of its verdict, so `own` does not hold it, and a sustain by that same seat adopts it under the same id: the seat holds it again, the layer is made to object by it, and BOTH acts are on the record (the exchange row says withdrawn_argued, the outcome row's adopted_as entry says `withdrawn_in_exchange: true`)
        const withdrawnHere = new Set(layerDebates.filter(d => d.pass === round && d.layer === row.layer).flatMap(d => d.objections.filter(o => o.outcome === 'withdrawn_argued').map(o => `${o.raised_by}\u0000${o.id}`)));
        esc.row.rulings = perSeat.flatMap(p => ids.map(id => {
          const r = p.byId?.get(id);
          return { seat: p.seat, lab: labFromKey(p.seat), id, ruling: r?.ruling ?? null, ...(r?.reason ? { reason: r.reason } : {}), ...(!r ? { why: p.why ?? (p.ignored?.find(x => x.id === id)?.why || 'no_ruling') } : {}) };
        }));
        esc.row.outcome = settled.map(s => {
          const f = esc.items.find(x => x.id === s.id);
          const adopted = s.sustainers.map(seat => ({ seat, id: objectionId(seat, f) }));
          for (const a of adopted) {
            if (own.has(`${a.seat}\u0000${a.id}`)) continue;   // the seat already raised it itself in its blind review: one objection, not two
            adoptedNow.push({ criterion: f.criterion, problem: f.problem, fix: f.fix ?? '', ...(ratedOf(f) !== null ? { severity: ratedOf(f) } : {}), ...(f.quote ? { quote: f.quote } : {}), ...(f.quote_status ? { quote_status: f.quote_status } : {}), ...(f.excerpt_id ? { excerpt_id: f.excerpt_id } : {}), ...(f.spans ? { spans: f.spans } : {}), lab: a.seat, id: a.id, sustained_from: { lab: f.lab, layer: layerOf[f.lab] ?? null, id: f.id } });   // the quote check's mark (markFailures, a fenced-source task) travels with the objection
            if (withdrawnHere.has(`${a.seat}\u0000${a.id}`)) { readoptedAt.set(`${a.seat}\u0000${a.id}`, round); exchangeWithdrawals.set(a.seat, (exchangeWithdrawals.get(a.seat) || []).filter(w => w.id !== a.id)); }   // S6 (Q6): the later act counts: the seat holds it again, so it is no longer listed to the seat as withdrawn; the exchange row and the answer-back row of the withdrawal stay on the record
          }
          if (closedByRuling({ result: s.result, seat: f.lab, lab: f.lab, id: f.id, rated: ratedOf(f) }) && retained && answerBackLatest[f.lab]) {   // 0.8.4 S7b A3: `rated` added (the pending rating of a same-pass id); the rest of this block is A1's byte-identical move
            const left = answerBackLatest[f.lab].objections.filter(o => o.id !== f.id);
            if (left.length) answerBackLatest[f.lab] = { ...answerBackLatest[f.lab], objections: left }; else delete answerBackLatest[f.lab];
          }
          return { id: s.id, lab: labFromKey(f.lab), ...(f.lab !== labFromKey(f.lab) ? { seat: f.lab } : {}), layer: layerOf[f.lab] ?? null, first_round: items.find(i => i.id === s.id)?.first_round ?? null, problem: f.problem ?? null, result: s.result, rated: ratedOf(f), ...(adopted.length ? { adopted_as: adopted.map(a => ({ lab: labFromKey(a.seat), seat: a.seat, id: a.id, ...(withdrawnHere.has(`${a.seat}\u0000${a.id}`) ? { withdrawn_in_exchange: true } : {}) })) } : {}), ...(s.why ? { why: s.why } : {}) };
        });
        for (const o of esc.row.outcome) log(`    ${o.id}: ${o.result === 'sustained' ? `sustained by ${o.adopted_as.map(a => a.lab).join(' and ')}` : o.result === 'overruled' ? `overruled by layer ${row.layer}` : `no ruling closed it (${o.why}); it stays standing`}.`);   // A-DRAFT
        if (adoptedNow.length) { if (adoptedNow.some(adoptedHolds)) row.state = 'objected'; row.sustained = [...new Set(adoptedNow.map(f => f.sustained_from.id))]; }   // S5 U-B (RU-ADD-A7, D39): a sustain below 4 is adopted and recorded and holds nothing back: the pass goes up
      };
      // 0.8.4 S7b A3 (D39 / W39 / Q7(e)): the rulings layer 2 gave in its ORDINARY review call on layer 1's open objections. Same settle logic as the stall ruling (settleEscalationRulings, A1's move): any sustain adopts the objection under the sustaining seat, an overrule by EVERY seat of the layer closes it
      // only when it is rated below 4 and was never rated 7 or above (closesOnOverrule with the pending rating), anything else stays as it was. A seat with no usable reply (unheard, a carried verdict) rules on nothing, which blocks an all-seats overrule; a reply with no `rulings` array is no ruling (no refusal, no re-ask).
      const settleInCallRulings = (row, from) => {
        const rulable = layerOneOpen.ruling.rulable;
        if (!rulable.length) return;
        const seats = config.seats.critics.filter(c => c.layer === row.layer);
        const ids = rulable.map(r => r.id);
        const marked = markFailures(rulable.map(r => ({ ...r })), fencedSource, draft + changedSince(lastPatches), excerptsForQuotes(), { marks: false });   // the quote check's mark travels with an adopted objection, as it does on the stall path
        const mine = verdicts.slice(from);
        const perSeat = seats.map(seat => {
          const key = seatKeyOf(seat);
          const v = [...mine].reverse().find(x => seatKeyOf(x.seat) === key);
          if (!v || v.abstained) return { seat: key, why: 'unheard' };
          if (v.carried) return { seat: key, why: 'carried' };
          const read = readEscalationRulings({ rulings: v.critique?.rulings ?? v.rulingsRaw }, ids);
          return { seat: key, byId: read.byId, ignored: read.ignored };
        });
        const iRow = { round, pass: round, from_layer: layerNumbers[0], to_layer: row.layer, trigger: 'in_call', ids, outcome: [], rulings: [] };
        inCallRulings.push(iRow);
        settleEscalationRulings({ esc: { row: iRow, items: marked }, row, ids, items: rulable.map(r => ({ id: r.id, first_round: r.first_round })), perSeat, seats });
        // 0.8.4 S7b A4 (records): one entry per objection layer 2 was asked to rule on, on the layer-2 row (never in escalations[]: no new trigger). `stays_open` of an overruled entry is added when the report is written (layersRecordOut).
        row.rulings_in_call = iRow.outcome.map(o => ({ id: o.id, lab: o.lab, ...(o.seat ? { seat: o.seat } : {}), layer: o.layer, rated: o.rated, outcome: o.result, ...(o.adopted_as ? { adopted_as: o.adopted_as } : {}), ...(o.why ? { why: o.why } : {}), by: iRow.rulings.filter(r => r.id === o.id).map(({ seat, ruling, reason, why }) => ({ seat, ruling, ...(reason ? { reason } : {}), ...(why ? { why } : {}) })) }));
      };
      const ruleOnEscalation = async row => {
        const esc = escalation;
        esc.ruled = true;
        const seats = config.seats.critics.filter(c => c.layer === row.layer);
        const firstRound = f => Math.min(...openByRound.filter(o => o.failures.some(x => x.lab === f.lab && x.id === f.id)).map(o => o.round), Number.isFinite(f.carried_from_round) ? f.carried_from_round : Infinity);
        const declineOf = id => [...disputes].reverse().find(d => d.objection_id && String(d.objection_id).trim().toLowerCase() === String(id).toLowerCase());
        const toRule = esc.items.filter(f => !esc.flagged?.has(f.id));   // a flagged (not_debated) objection draws no ruling
        const items = toRule.map(f => {
          const d = declineOf(f.id);
          return { id: f.id, first_round: firstRound(f), rounds: esc.passesById?.get(`${f.lab}\u0000${f.id}`) ?? esc.rounds, criterion: R.claimText(f.criterion ?? ''), problem: R.claimText(f.problem ?? ''), ...(f.quote ? { quote: R.claimText(f.quote) } : {}), ...(d ? { declined_reason: R.claimText(d.reason), declined_round: d.round } : {}) };
        });
        const ids = items.map(i => i.id);
        if (!ids.length) {   // A-DRAFT; the layer(s) that left them not debated: layer 1 unless the shortened exchange (S6) left an upper layer's objection undebated
          const left = [...new Set(esc.items.map(f => layerOf[f.lab] ?? layerNumbers[0]))].sort((x, y) => x - y);
          const leftWords = left.length === 1 ? `layer ${left[0]}` : `layers ${left.slice(0, -1).join(', ')} and ${left.at(-1)}`;
          log(`  round ${round}: layer ${row.layer} is asked to rule on nothing: the ${esc.items.length} objection(s) passed up from layer ${esc.row.from_layer} were not debated in ${leftWords}, so they are not ruled on; they stay standing: if the plan is sent back, ${leftWords} ${left.length === 1 ? 'debates' : 'debate'} them in ${left.length === 1 ? 'its' : 'their'} first pass after that; if the run ends at the escalated sign-off, they remain standing dissent.`);
          return;
        }
        // 0.8.4 S7: the layer-2 bound go-up asks with ITS OWN three sentences (src/escalation.js GO_UP_HELD, W9): the recorded stall/send_up sentences say the objections "stood unchanged" or were open at layer 1's limit, untrue for layer 2's bound. Own gate: until all three are recorded no ruling
        // is asked (perSeat why prompt_held), layer 3 has reviewed the plan blind, and the layer-2 objections stay with their raisers.
        const goUp = esc.trigger === 'layer2_bound';
        const ratingShown = f => { const v = ratedOf(f); return v !== null && readSeverity(v).ok ? { severity: v } : {}; };   // the rating IN FORCE, only when readable (an unrated objection is shown as "no readable rating": it holds under RT)
        const goUpItems = goUp ? items.map((it, k) => ({ ...it, ...ratingShown(toRule[k]) })) : null;
        const goUpNotDebated = goUp ? esc.items.filter(f => esc.flagged?.has(f.id)).map(f => ({ criterion: R.claimText(f.criterion ?? ''), problem: R.claimText(f.problem ?? ''), ...ratingShown(f) })) : [];   // shown, never ruled on: model text, wrapped like the items'
        const active = goUp ? goUpRulingActive(held) : rulingActive(held);
        const perSeat = [];
        log(`  round ${round}: layer ${row.layer} rules on the ${ids.length} objection(s) passed up from layer ${esc.row.from_layer} (${ids.join(', ')})${active ? '' : ' - the ruling words are not recorded yet, so no ruling is asked and they stay standing'}.`);   // A-DRAFT
        for (const seat of seats) {
          const key = seatKeyOf(seat);
          if (!active) { perSeat.push({ seat: key, why: 'prompt_held' }); continue; }
          const asked = seat.panelMaxTokens ? keepSeatKey(seat, { ...seat, maxTokens: seat.panelMaxTokens }) : seat;   // a ruling is a judge's short verdict: the same output cap as its review
          try {
            const st = record(await invoke(asked, { system: goUp ? held('goUpRulingSystem')() : held('escalationRulingSystem')(isLayerOneUp(esc.trigger) ? { sendUp: true } : undefined), user: goUp ? held('goUpRulingUser')({ request, plan: draft, items: goUpItems, notDebated: goUpNotDebated }) : held('escalationRulingUser')({ request, plan: draft, items, ...(isLayerOneUp(esc.trigger) ? { sendUp: true } : {}) }), log, label: `rule-${round}-${key}` }));
            let parsed = null;
            try { parsed = parseJson(st.text); } catch { /* an unreadable ruling is no ruling: every id stays standing for this seat */ }
            if (!parsed) { perSeat.push({ seat: key, why: 'unreadable_ruling' }); log(`  ${shownSeat(seat)}/${seat.model}: the ruling could not be read - no ruling from it.`); continue; }   // A-DRAFT
            const read = readEscalationRulings(parsed, ids);
            perSeat.push({ seat: key, byId: read.byId, ignored: read.ignored });
          } catch (err) {
            rethrowControlFlow(err);   // the cap, an external pause, a refused price: not ours to swallow
            perSeat.push({ seat: key, why: 'ruler_unreachable' });
            log(`  ${shownSeat(seat)}/${seat.model}: no reply to the ruling (${String(err.message).slice(0, 120)}) - no ruling from it.`);   // A-DRAFT
          }
        }
        settleEscalationRulings({ esc, row, ids, items, perSeat, seats });
      };
      // 0.8.4 S6 (G7, TABLE_ANSWERS_M1): a TOP-layer judge signs off only when the computed rule is clean AND its line is not "no". A "no" with nothing of its own standing is never recorded as a sign-off the seat refused: the seat is asked ONCE more for its verdict (the shape of the
      // missing-rating re-ask: the same blind verdict call, label ending SIGNOFF_REASK_TAG, with the held note, through invoke() so the cap and the expected-cost price of a repeat apply) and the answer is read ONCE: a clean table signs, an objection named objects (a re-raise of one it
      // withdrew this pass counts too, recorded), a verdict that cannot be read is unheard, left to the layer's unheard handling, and so (with the rating demand recorded) is a "does not meet" that names no objection; without the demand that reply objects, through the failure its FAILED table row carries (normaliseCritique); a STATED PASS is heard, signs nothing and names nothing: it is recorded as stated_pass (the next pass, on the same draft, bounded by noRevise where there are overseer keys). The in-pass re-ask loop has
      // finished before the exchange runs, so the cause "a does-not-meet that names no objection" cannot start it again on this result: one re-ask never becomes three. Run AFTER the ruling: a sustain that makes the seat object anyway would make the call a waste.
      // A missing or garbled line, a layer below the top and a held note are none of this: the computed rule decides (T6b).
      const refusedSignoffs = async (from, row) => {
        const pending = signoffNoPending; signoffNoPending = [];
        const rowRecord = [...layerDebates].reverse().find(d => d.pass === round && d.layer === row.layer);
        for (const key of pending) {
          const i = verdicts.findIndex((v, k) => k >= from && seatKeyOf(v.seat) === key);
          if (i < 0) continue;
          const v = verdicts[i];
          if (v.abstained || v.carried || objects(v)) continue;   // the ruling made it object, or it was not heard: the "no" is moot
          log(`  ${shownSeat(v.seat)}/${v.seat.model}: its answer to the exchange ended with "sign-off: no", but none of its objections rated 4 or above stands - asked once more for its verdict.`);   // A-DRAFT
          reaskedAt.add(i); reaskInFlight = i;
          const prior = relay ? verdicts.filter(x => x.critique).map((x, k) => ({ lab: `Reviewer ${String.fromCharCode(65 + k)}`, verdict_line: x.critique.verdict_line, failures: x.critique.failures })) : [];
          const again = await reviewSeat(v.seat, prior, log, SIGNOFF_REASK_TAG, null, null, null, null, null, true);   // ask-layer-exempt: the ONE sign-off re-ask (S6 G7), made after the layer exchange and so outside askLayer; it does by hand what askLayer's wrap does: its own label -reask3, one call per judge, priced in the maximum (cost.js), reaskedAt and re_asked below, and no unanswered fallback for a -reask<n> tag; see the comment above refusedSignoffs
          reaskInFlight = null;
          // `again` is what reviewSeat returned: an abstention (an unreadable verdict, including a "does not meet" that names no objection when the rating demand is recorded, reviewSeat 4812-4817), a stated pass (critique null), or a verdict
          // with a critique that either signs (meets true) or carries at least one failure (normaliseCritique keeps a FAILED table row as a failure without the demand). The trace finds no reply shape that leaves a critique that does not meet with an empty
          // failure list. `unexpected` is the net under that finding (what the sign-off guard did before it was removed): if the trace is ever wrong, such a verdict is unheard, exactly as it was, and the log says so.
          const unexpected = !again.abstained && !!again.critique && again.critique.meets !== true && !(again.critique.failures ?? []).length && !holdingOwnOf(again).length;
          if (unexpected) log(`  ${shownSeat(v.seat)}/${v.seat.model}: its answer to the re-ask does not meet and names no objection (unexpected); it stays unheard.`);   // A-DRAFT
          verdicts[i] = unexpected ? { seat: v.seat, critique: null, abstained: true, reasonCode: 'REPLY_UNPARSEABLE', ...(again.stage ? { stage: again.stage } : {}) } : again;
          const unheard = !!again.abstained || unexpected;
          const named = unheard ? [] : (again.critique?.failures ?? []).map(f => ({ f, id: objectionId(key, f) }));
          const withdrewHere = new Set((exchangeWithdrawals.get(key) || []).filter(w => w.pass === round).map(w => w.id));
          const reRaised = named.filter(x => withdrewHere.has(x.id)).map(x => x.id);
          const result = unheard ? 'unheard' : objects(again) ? 'objects' : again.critique?.meets === true ? 'signs' : !again.critique ? 'stated_pass' : 'unheard';   // 'signs' only for a clean verdict; a stated pass (critique null) was heard, signed nothing and named nothing (it holds none of its own objections here, or 'objects' above); the last 'unheard' is the remainder the net above already turned into an abstention
          if (result !== 'unheard') for (const { f, id } of named) {   // an objection named after the exchange has not been debated: it is flagged as the exchange's own not-debated ones are
            const m = exchangeCarried.get(key) ?? new Map();
            m.set(id, { criterion: f.criterion, problem: f.problem, ...(f.quote ? { quote: f.quote } : {}), ...(f.severity !== undefined ? { severity: f.severity } : {}), found_pass: round });
            exchangeCarried.set(key, m);
          }
          const entry = rowRecord?.signoffs?.find(x => x.seat === key);
          if (entry) entry.re_asked = { result, ...(named.length ? { objections: named.map(x => x.id) } : {}), ...(reRaised.length ? { re_raised: reRaised } : {}) };
          log(`  ${shownSeat(v.seat)}/${v.seat.model}: ${result === 'signs' ? 'signs off now' : result === 'stated_pass' ? 'states a pass (it is not counted as a sign-off)' : result === 'objects' ? `names ${named.length} objection(s)${reRaised.length ? ` (${reRaised.length} it withdrew in this pass's exchange)` : ''}` : 'could not be heard (it stays unheard)'}.`);   // A-DRAFT
        }
      };
      let roundRows = null;
      let secretCut = null;   // 0.8.4 (--finish): the SecretFinish that cut this pass's layer loop; set by the inner catch below
      let cutRow = null;
      let cutVerdicts = [];   // 0.8.4 (--finish): the verdicts of the layer the finish cut off, taken out of `verdicts` by the inner catch below
      let cutFrom = 0;   // the index in `verdicts` where the layer being asked began
      let signoffNoPending = [];   // 0.8.4 S6 (G7): the top-layer judges whose reply to this pass's exchange ended with "sign-off: no" while the computed rule lets them sign off, in seat order; acted on after the ruling (refusedSignoffs)
      let loneHeard = false;   // 0.8.4 S3 (Q4(d), T4d): the lowest layer's exchange could not run because only ONE judge was heard and it holds objections: this pass re-asks the unheard judge on the same draft instead of revising
      // 0.8.4 S5 (Q-a, RU-S5-01/02, D16): a stall escalation lasts ONE pass. The pass after it (once its ruling was taken) starts at layer 1 again, whatever the escalation pass ended in; the layers below the floor are not parked.
      // Written so that T4c can turn it on for the person's send-up with one switch (escalationLastsOnePass in src/stall-book.js).
      if (escalation && escalationLastsOnePass(escalation.trigger) && round > escalation.row.pass && escalation.ruled && !carry) escalation = null;   // `carry` = this pass re-asks, on the same text, the seats that were not heard in the escalation pass: it is still that pass
      // The ladder: the layer this pass starts at (1 for every pass up to the credit, and for any run without a ladder). The layers below it are not asked this pass ('not_asked'); the climb above it is the ordinary one.
      const ladderLive = !!ladder && round > ladder.credit;
      const ladderNextPass = !!ladder && round === ladder.credit;   // 0.8.4 round 2 (the stranded run, RESULT 1): the LAST credited pass; the next pass is a ladder pass, which never passes the plan up (below), so a stall here is not passed up either: it stops for the person with its own reason

      const ladderStep = ladderLive ? stepOf(ladderSteps, round) : null;   // B3 prototype (src/ladder-steps.js): a recorded change to this one pass, written once with a fixed pass number
      const ladderKept = ladderLive && !ladderStep && ladderAskedUp;      // the re-ask of a pass that was asked to start at layer 3 and in which no layer-3 judge was heard
      // 0.8.4 S4 (control 1 on a chain WITHOUT the ladder; D27 option 1e, Q11(a)): the handler's routed decision (the gate ledger, derived into `ladderSteps` by cli.js on every resume) starts this pass at layer 3. `ladderLive` is NOT widened: the ladder's own stall filter (top layer only), layer-2 skip, state and exchange reads stay off.
      const plainStep = layered && !ladder && !earlyAsk ? stepOf(ladderSteps, round) : null;   // a pass after the session's early-finish proposal asks the overseer layer alone anyway (the same layer), and its yes is not a sign-off of the plan: the early ask decides that pass
      const plainKept = layered && !ladder && !earlyAsk && !plainStep && ladderAskedUp;   // the re-ask of a routed pass in which no layer-3 judge was heard keeps the floor
      ladderAskedUp = false;
      const floorRoute = !!plainStep || plainKept;                        // a request put this pass at layer 3 on a chain without the ladder
      const ladderRequested = !!ladderStep || ladderKept || floorRoute;  // a request, not the ladder's own count, put this pass at layer 3
      // 0.8.4 l2l: an automatic go-up (layer1_bound, layer2_bound) in force on a ladder pass puts the pass at the go-up's own floor when that is higher than the ladder's (the layer-2 go-up lands on layer 3, the ladder alone would say layer 2). For layer1_bound the two floors are equal and nothing moves.
      const goUpFloor = ladderLive && escalation && (escalation.trigger === 'layer1_bound' || escalation.trigger === 'layer2_bound') ? escalation.floor : 1;
      const ladderFloor = ladderLive ? Math.max(ladderStep ? ladderStep.floor : ladderKept ? 3 : floorOf(ladder, ladderState), goUpFloor) : floorRoute ? 3 : 1;
      // A recorded route cannot be withdrawn (gate-ledger: one routed decision per pass, no un-route), so a route that cannot be carried out stops the run BEFORE any call instead of silently running the pass from layer 1. The entry refuses both states (src/run-controls.js routeRefusal); this is the backstop for a record the entry never saw.
      if (floorRoute && !layerNumbers.includes(3)) throw new Error(`pass ${round} was asked to start at layer 3, but this chain has no layer 3. No model was called and nothing was spent after pass ${round - 1}. A recorded route cannot be withdrawn: to go on, start a new run with --draft pointing at the plan as it stands.`);   // A-DRAFT
      if (floorRoute && escalation) throw new Error(`pass ${round} was asked to start at layer 3, but in round ${escalation.row.round} the plan was passed up a layer because objections stood unchanged, and that is still in force: the two cannot both decide where this pass starts. No model was called and nothing was spent after pass ${round - 1}. A recorded route cannot be withdrawn: to go on, start a new run with --draft pointing at the plan as it stands.`);   // A-DRAFT
      // The ladder bans passing the plan up: a stall escalation already in force (the credited passes ran under the plain rules, whose stall rule may have passed objections up) would make a ladder pass rule on them. Refuse rather than mix the two.
      // The one escalation the ladder allows is the automatic layer-1 go-up (trigger 'layer1_bound', 0.8.4 U2): it fires at the credit boundary and puts this pass at layer 2, which is the ladder's own floor after the credit passes (newLadderState), so the two agree on where the pass starts. Every other escalation (a stall, the layer-2 go-up whose floor is 3, a legacy send-up) is still refused.
      if (ladderLive && escalation && escalation.trigger !== 'layer1_bound' && escalation.trigger !== 'layer2_bound') throw new Error(`the ladder cannot start at pass ${round}: in round ${escalation.row.round} the plan was passed up a layer because objections stood unchanged, and that is still in force; the ladder never passes the plan up. No model was called and nothing was spent after pass ${round - 1}.`);   // A-DRAFT
      if (ladderLive) log(`  ladder: pass ${round} starts at layer ${ladderFloor} (layer-1 revisions in this block ${ladderState.used1} of ${ladder.block}, layer-2 visits ${ladderState.l2} of ${ladder.visits}, layer-3 visits ${ladderState.l3}).`);   // A-DRAFT (LAD-L1: a ladder has no layer-3 count, so the line says no "of N" for layer 3)
      if (ladderKept) log(`  ladder: pass ${round} starts at layer 3 again: the pass before it was asked to start at layer 3, and a layer-3 judge was not heard in it. The counts above are the ladder's own; this pass does not move them.`);   // A-DRAFT
      if (ladderStep) log(`  ladder: pass ${round} starts at layer ${ladderFloor} because the pass before it was answered with a request to ask layer ${ladderFloor} next (recorded ${ladderStep.at}). The counts above are the ladder's own; this pass does not move them.`);   // A-DRAFT
      if (plainStep) log(`  pass ${round} starts at layer ${ladderFloor} because the pass before it was answered with a request to ask layer ${ladderFloor} next (recorded ${plainStep.at}). The layers below it are not asked in this pass.`);   // A-DRAFT
      if (plainKept) log(`  pass ${round} starts at layer ${ladderFloor} again: the pass before it was asked to start at layer ${ladderFloor}, and a layer-${ladderFloor} judge was not heard in it. The layers below it are not asked in this pass.`);   // A-DRAFT
      if (!layered) {
        try { await askLayer(config.seats.critics); } catch (finishErr) {
          // The person's finish ended an unlayered panel inside its ask: the judges that had answered are written to panelVerdicts[], marked `cut` (the layered pass does the same for the layer it cut, below). Nothing of this pass was recorded as a panel, so lastCritique and signoff[] stay the last finished pass's; the catch around the pass ends the run.
          if (!(finishErr instanceof SecretFinish)) throw finishErr;
          if (reaskInFlight !== null) { reaskedAt.delete(reaskInFlight); reaskInFlight = null; }
          const cutHere = verdicts.splice(0).map(v => (v.abstained && v.unansweredFallback ? (({ settle: _settle, ...first }) => first)(v.unansweredFallback) : v));
          noteCutOpen(cutHere); foldRoundNotes(); cutHere.forEach((v, k) => panelVerdicts.push({ ...panelRowOf(v, k), cut: true }));
          throw finishErr;
        }
      } else {
        roundRows = layerNumbers.map(n => ({ round, layer: n, ...(ovOn ? { overseer_round: ovState.overseerRound } : {}), labs: config.seats.critics.filter(c => c.layer === n).map(labOf), ...(ladderRequested ? { floor_by: 'request' } : {}), ...(config.seats.critics.some(c => c.layer === n && seatKeyOf(c) !== labOf(c)) ? { seats: config.seats.critics.filter(c => c.layer === n).map(seatKeyOf) } : {}), state: 'not_asked' }));
        layersRecord.push(...roundRows);
        draftShaByRound[round] = draftIdOf(draft);   // unit D: filled for every layered round (the final read compares it); only the ledger (ledgerOn) reads it otherwise
        if (ledgerOn) roundLedger = null;
        layerOneOpen = null;
        let ledgerStopped = false;
        // Stall escalation: while one is in force the layers below its floor are not asked; their rows say why (`escalated`, not `not_asked`).
        if (escalation) for (const r of roundRows) if (r.layer < escalation.floor) { r.state = 'escalated'; if (isLayerOneUp(escalation.trigger) || escalation.trigger === 'layer2_bound') r.escalated_by = escalation.trigger; }   // the row says WHY only for a send-up or a layer-2 go-up (additive): its state word must not say the objections stood unchanged
        if (ladderLive && !ladderRequested) for (const r of roundRows) if (r.layer < ladderFloor && r.state === 'not_asked') r.floor_by = 'ladder';   // 0.8.4 round 1, 10a (his answer 10:a): the row of a layer BELOW the layer the ladder started this pass at, still not_asked after the escalation loop above, says so (the state stays not_asked; an 'escalated' row keeps its own words); the layer the ladder skipped ABOVE its floor (the visits used, further down) is not marked in round 1
        // ROADMAP 83: the pass after a session's early-finish proposal asks the OVERSEER LAYER ONLY (the lower layers are exactly what an early finish skips); its answer is that overseer round's verdict.
        try {
        for (const row of (earlyAsk ? roundRows.filter(r => r.layer === topLayer) : roundRows.filter(r => r.state !== 'escalated' && r.layer >= ladderFloor))) {
          // E4: the TOP layer is shown the objection ledger. Built ONCE here (one text per round); an overflow of the ACTIVE rows stops the run BEFORE the ask (the row stays not_asked, nothing is sent to the top layer).
          if (row.layer === topLayer && layerNumbers.length >= 2) {
            if (!ledgerOn) {
              if (!ledgerOffLogged) { ledgerOffLogged = true; log('  ledger not built: answer_back is off, so there are no dispositions to show the top layer.'); }
            } else {
              const sentence = held('overseerLedgerSection');
              // Stall escalation (C&C ruling 3): an id a ruling closed (overruled) or moved (sustained) leaves the ledger's rows, whose rule "closed only when its raiser withdrew it" stays true for every row it lists, and is
              // listed after the ledger with the ruling (held sentence ledgerRulingsSection). Nothing is ruled until the ruling sentences are recorded, so until then this is a no-op and the ledger is byte-identical. The three held names (src/escalation.js RULING_HELD) are recorded together or not at all (test/held-prompts.test.js), so the filter and the section that lists what it removed never come apart.
              const ruled = ruledNow();   // FIX F1: a reopened id is a live ledger row again, not a ruled one
              const ruledKeys = new Set(ruled.map(({ o }) => `${o.seat ?? o.lab}\u0000${o.id}`));
              const rowsOf = sentence ? objectionLedger({ openByRound: ledgerRaises, replies: answerBackReplies, reviserByRound: reviserByRoundOf(), draftShaByRound, heardByRound, notAskedByRound, layerOf: Object.fromEntries(config.seats.critics.map(c => [seatKeyOf(c), c.layer])), currentRound: round }).filter(r => !ruledKeys.has(`${r.raised_by.lab}\u0000${r.id}`)).map(r => ({ ...r, seatKey: r.raised_by.lab, raised_by: { ...r.raised_by, lab: labFromKey(r.raised_by.lab) }, ...(r.judge?.quoted_ref ? { judge: { ...r.judge, quoted_ref: `${labFromKey(r.judge.quoted_ref)}${layerNoteOf(r.judge.quoted_ref)}` } } : {}) })) : [];   // CR-6A-004: the quoted peer is named like every other seat in text a model reads: the lab, plus " (layer N)" for a model repeated on more than one layer   // the ledger sentence is a prompt: the bare lab, never the seat key
              if (!sentence) log('  ledger section held: the top layer is asked with the ordinary prompt.');
              else if (rowsOf.length) {
                const inForceRows = sevRun ? rowsOf.map(r => ({ ...r, severity: sevRun.inForce(r.seatKey, r.id) ?? r.severity })) : rowsOf;   // unit 4a: layer 3 reads the value IN FORCE (a re-tag included), not the ledger row's first tag
                const fit = fitLedger(inForceRows, ({ rows, omitted }) => sentence({ rows, omitted, ...(severityOn ? { severityShown: true } : {}) }));
                const shown = { rows: fit.counts.rows, active: fit.counts.active, closed_cut: fit.counts.closed_cut, chars: fit.chars, tokens_est: fit.tokens_est };
                if (fit.overflow) {
                  layerStop = { round, layer: topLayer, reason: 'ledger_overflow', labs: row.labs, ...(row.seats ? { seats: row.seats } : {}), ledger: shown };
                  log(`\n  round ${round}: ${held('ledgerOverflowExit')?.({ rows: shown.rows, chars: shown.chars, limit: LEDGER_MAX_CHARS }) ?? `the open objections (${shown.rows} rows, ${shown.chars} characters) are too many to show the top layer in full (limit ${LEDGER_MAX_CHARS}). Nothing was sent to the top layer. Stopping; this is not agreement.`}`);
                  ledgerStopped = true;
                  break;
                }
                roundLedger = { text: severityOn ? `${fit.text}\n\n${R.RETAG_FIELD_RULE}` : fit.text };   // unit 4a (A-DRAFT, already pinned in roles.js): with the switch the top layer may re-tag an objection it is shown
                // only when the re-tag rule above was shown: an unprompted re-tag is then refused ('no_ledger_shown'), never applied
                if (severityOn) shownLedger = { pass: round, rows: new Map(inForceRows.map(r => [r.id, { lab: r.seatKey, status: r.status, severity: r.severity, criterion: r.criterion, problem: r.problem, ...(r.quote ? { quote: r.quote } : {}) }])) };
                row.ledger = shown;
                if (fit.counts.closed_cut) log(`  ledger: ${fit.counts.closed_cut} earlier closed row(s) were left out of the top layer's section (named in it).`);
              }
              // 0.8.4 S7: a run can hold a stall (or send-up) ruling AND a layer-2 go-up ruling; each has its own section and its own gate (the recorded ledgerRulingsSection cannot word a go-up row: it says "stood unchanged" / "first layer"). One section when only one kind was ruled: byte-identical to before.
              const rowOfRuled = ({ e, o }) => ({ id: o.id, lab: o.lab, layer: o.layer, first_round: o.first_round, ruled_round: e.pass, ruled_layer: e.to_layer, outcome: o.result,
                reasons: e.rulings.filter(r => r.id === o.id && r.reason && r.ruling === (o.result === 'overruled' ? 'overrule' : 'sustain')).map(r => ({ lab: shownKey(r.lab), text: R.claimText(r.reason) })), ...(o.adopted_as ? { adopted_as: o.adopted_as.map(a => ({ lab: a.lab, id: a.id })) } : {}) });
              const ruledStall = ruled.filter(({ e }) => e.trigger !== 'layer2_bound' && e.trigger !== 'in_call'); const ruledInCall = ruled.filter(({ e }) => e.trigger === 'in_call'); const ruledGoUp = ruled.filter(({ e }) => e.trigger === 'layer2_bound');
              const stallText = sentence && ruledStall.length ? held('ledgerRulingsSection')?.({ ...(ruledStall.some(({ e }) => isLayerOneUp(e.trigger)) ? { kinds: ['send_up'] } : {}), rows: ruledStall.map(rowOfRuled) }) : null;
              const goUpText = sentence && ruledGoUp.length ? held('goUpRulingsSection')?.({ rows: ruledGoUp.map(rowOfRuled) }) : null;
              const inCallText = sentence && ruledInCall.length ? held('layerOneRulingsLedgerSection')?.({ layer: layerNumbers[1], rows: ruledInCall.map(x => ({ ...rowOfRuled(x), ruled_layer: x.e.to_layer })) }) : null;   // 0.8.4 S7b (S7B-3): a ruling made in layer 2's ordinary call has its own words (the stall section says "stood unchanged")
              const rulingsText = [stallText, goUpText, inCallText].filter(Boolean).join('\n\n') || null;
              if (rulingsText) roundLedger = { text: roundLedger ? `${roundLedger.text}\n\n${rulingsText}` : rulingsText };   // not counted in fitLedger's limit: one short line per ruled id
            }
          }
          // The ladder: once layer 2 has had its visits, the next upper visit is layer 3's; a layer-1 sign-off in a block sends the plan there at once, over layer 2 (layer 2's row stays 'not_asked').
          if (ladderLive && row.layer < topLayer && row.layer > ladderFloor && ladderState.l2 >= ladder.visits) { row.floor_by = 'ladder_visits'; continue; }   // 0.8.4 round 2 (second shape of floor_by): the row says why it was not asked: the layer below it signed off in this pass, and the ladder's visits to this layer are used up in the block (a layer that is not asked because a layer below did not sign off has no mark)
          // JUDGE unit L2 (his word 1 Nov 2026, "2: yes, they should"; C&C answers a-d): a layer between the first and the top one is shown layer 1's OPEN objections with the rating in force. Open = the ledger's active rows raised by layer 1 (a
          // withdrawal made in an earlier pass or in this pass's layer-1 exchange has already closed its row), plus this pass's own layer-1 failures read from `verdicts` AFTER the layer-1 exchange (withdrawn ones removed, amended text applied), deduped by lab and id.
          // The rating is the value in force (a layer-3 re-tag included). Context only: no adopt rule, no stop, no new call. Over the ledger's own budget the lowest-rated rows are cut and counted (fitOpenRows).
          layerOneOpen = null;
          // M1: part of the rating demand (it adds a whole section to every middle-layer prompt): only when the held word is recorded
          if (severityOn && ledgerOn && row.layer > layerNumbers[0] && row.layer < topLayer) {
            const ruledKeys = new Set(ruledNow().map(({ o }) => `${o.seat ?? o.lab}\u0000${o.id}`));
            const byKey = new Map();
            const layerMap = Object.fromEntries(config.seats.critics.map(c => [seatKeyOf(c), c.layer]));
            for (const r of objectionLedger({ openByRound: ledgerRaises, replies: answerBackReplies, reviserByRound: reviserByRoundOf(), draftShaByRound, heardByRound, notAskedByRound, layerOf: layerMap, currentRound: round })) {
              const key = `${r.raised_by.lab}\u0000${r.id}`;
              if (r.raised_by.layer !== layerNumbers[0] || r.status !== 'active' || ruledKeys.has(key)) continue;
              byKey.set(key, { ...r, raised_by: { ...r.raised_by, lab: labFromKey(r.raised_by.lab) }, severity: sevRun.inForce(r.raised_by.lab, r.id) ?? r.severity });
            }
            for (const v of verdicts) {
              if (v.seat.layer !== layerNumbers[0]) continue;
              // M1: a layer-1 judge's own open objections (`openOwn`: a stated pass's, and the defect a clean sign-off named in an exchange post) are open objections of layer 1 too; a carried verdict contributes only what this pass's exchange minted on it.
              const mine = [...(v.carried || !v.critique ? [] : v.critique.failures), ...(v.carried && v.exchangeChangedIn !== round ? [] : openOwnOf(v))];
              if (!mine.length) continue;
              const seatKey = seatKeyOf(v.seat);
              for (const f of mine) {
                const id = objectionId(seatKey, f); const key = `${seatKey}\u0000${id}`;
                if (ruledKeys.has(key)) continue;
                const have = byKey.get(key);
                byKey.set(key, { ...(have ?? { id, raised_by: { lab: labFromKey(seatKey), layer: v.seat.layer }, first_round: round }), last_raised_round: round, criterion: f.criterion ?? '', problem: f.problem ?? '', ...(f.quote ? { quote: f.quote } : {}), severity: sevRun.inForce(seatKey, id) ?? f.severity });
              }
            }
            // 0.8.4 S7b (D39 / W39 / Q7(e); WORDING rows S7B-1 to S7B-3): when all five gate names are recorded and layer 1 SIGNED OFF in this pass, the layer above it (the second layer only) is shown layer 1's open objections to RULE on, raisers hidden: the rows handed to the held
            // function carry no lab and no seat key (the seat key rides on the internal `ruling` list for the hook of a later commit). The budget is the existing one (fitOpenRows, no new stop): rows it cuts are not shown, not ruled on, and stay as they were. With no rulable row the section is still
            // the S7b one (the recorded section would name the raisers) and the reply tail is left out. Until the gate is recorded this branch is never taken and the recorded branch below is textually what it was.
            const s7bRuling = layerOneRulingActive(held) && row.layer === layerNumbers[1] && roundRows.find(r => r.layer === layerNumbers[0])?.state === 'signed_off';
            if (byKey.size && s7bRuling) {
              const seatKeyOfEntry = key => key.slice(0, key.indexOf('\u0000'));   // the map key keeps the raw seat key; the value's raised_by.lab is labFromKey(...)
              const entries = [...byKey.entries()].map(([key, r]) => ({ ...r, seat_key: seatKeyOfEntry(key) }));
              const undebated = x => !!exchangeCarried.get(x.seat_key)?.has(x.id);   // an objection the layer-1 exchange left not_debated: shown with its rating, never ruled on
              const wrapRow = r => ({ id: r.id, first_round: r.first_round, ...(r.last_raised_round !== undefined ? { last_raised_round: r.last_raised_round } : {}), criterion: R.claimText(r.criterion ?? ''), problem: R.claimText(r.problem ?? ''), ...(r.quote ? { quote: R.claimText(r.quote) } : {}), ...(readSeverity(r.severity).ok ? { severity: r.severity } : {}) });
              const rulable = entries.filter(x => !undebated(x));
              const notDebatedRows = entries.filter(undebated).map(x => ({ criterion: R.claimText(x.criterion ?? ''), problem: R.claimText(x.problem ?? ''), ...(readSeverity(x.severity).ok ? { severity: x.severity } : {}) }));
              const fit = fitOpenRows(rulable, ({ rows, left }) => held('layerOneRulingsSection')({ rows: rows.map(wrapRow), left, notDebated: notDebatedRows }));
              const tail = fit.rows.length ? `\n${held('layerOneRulingsReplyTail')()}` : '';   // fit.text ends in one newline: one blank line before the tail
              layerOneOpen = { text: `${fit.text}${tail}`, ruling: { rulable: fit.rows.map(r => ({ lab: r.seat_key, id: r.id, first_round: r.first_round, criterion: r.criterion ?? '', problem: r.problem ?? '', ...(r.quote ? { quote: r.quote } : {}), ...(readSeverity(r.severity).ok ? { severity: r.severity } : {}) })), notShown: rulable.filter(x => !fit.rows.some(r => r.seat_key === x.seat_key && r.id === x.id)).map(x => ({ seat_key: x.seat_key, id: x.id })) } };
              row.layer_one_open = { shown: fit.rows.length, left_out: fit.left, chars: fit.chars, tokens_est: fit.tokens_est, ...(fit.left ? { not_shown: layerOneOpen.ruling.notShown.map(x => x.id) } : {}) };   // 0.8.4 S7b A4: the ids the size budget cut, additive, only when something was cut
              if (fit.left) log(`  layer ${row.layer}: ${fit.left} lower-rated open objection(s) of layer 1 did not fit the section its judges rule on, so they are not ruled on and stay open as they were (their ids are recorded in the run's report).`);   // A-DRAFT (WORDING row S7B-A4a), printed only in the S7b branch
            } else if (byKey.size) {
              const fit = fitOpenRows([...byKey.values()], ({ rows, left }) => R.layerOneOpenSection({ rows, left }));
              layerOneOpen = { text: fit.text };
              row.layer_one_open = { shown: fit.rows.length, left_out: fit.left, chars: fit.chars, tokens_est: fit.tokens_est };
              if (fit.left) log(`  layer ${row.layer}: ${fit.left} lower-rated open objection(s) of layer 1 were left out of its section (named in it).`);
            }
          }
          const from = verdicts.length;
          cutFrom = from; cutRow = row;
          row.state = 'unfinished';
          log(`  layer ${row.layer} of ${layerNumbers.length} (${row.labs.join(', ')}):`);
          await askLayer(config.seats.critics.filter(c => c.layer === row.layer));
          // Stall escalation, the raiser filter (design section 2.5; C&C ruling 4): once the floor has reset, a judge whose passed-up objection a ruling closed (overruled) or moved (sustained: another judge holds it now) may raise
          // the same id again. It is recorded on the escalation (raised_again) and NOT counted: not in the round's failures, the signature, the revise or the layer's state. A judge whose only objections were such ids counts as
          // clean for the climb (decidedOnly); its signoff[] row still says it did not sign off, and a sign-off of the plan in that pass is an escalated sign-off, never a pass.
          for (let i = from; i < verdicts.length; i++) {
            const v = verdicts[i];
            if (v.carried || !v.critique || !escalations.length) continue;
            const key = seatKeyOf(v.seat);
            const ruledAgain = v.critique.failures.map(f => ({ f, id: objectionId(key, f), how: closedByRulingFor(key, objectionId(key, f)) })).filter(x => x.how);
            // FIX F1 (C&C, 27 Okt 2026): only a QUOTED objection is filtered. Without a quote the id is a hash of the lab and the criterion alone (src/objection-ids.js), so the same id can be a DIFFERENT defect under that
            // criterion (on a task with no fenced source every objection is unquoted). An unquoted re-raise counts as a live objection; it is recorded as a trace (counted: true) and reopens the id. No matching on the
            // problem's words: the id is reword-stable by design (ticket 12). Consequence (design file): an unquoted re-raise can stall again and be passed up again, bounded by the pass cap.
            for (const x of ruledAgain.filter(x => !problemKey(x.f))) {
              x.how.row.raised_again = [...(x.how.row.raised_again || []), { pass: round, lab: labFromKey(key), ...(key !== labFromKey(key) ? { seat: key } : {}), id: x.id, counted: true }];
              log(`  ${shownSeat(v.seat)}/${v.seat.model}: raised ${x.id} again without a quote, so it cannot be told apart from another problem under the same criterion: it counts as a live objection.`);   // A-DRAFT
            }
            const closed = ruledAgain.filter(x => problemKey(x.f));
            if (!closed.length) continue;
            const kept = v.critique.failures.filter(f => !closed.some(x => x.f === f));
            for (const x of closed) {
              x.how.row.raised_again = [...(x.how.row.raised_again || []), { pass: round, lab: labFromKey(key), ...(key !== labFromKey(key) ? { seat: key } : {}), id: x.id }];
              log(`  ${shownSeat(v.seat)}/${v.seat.model}: raised ${x.id} again, which a ruling in round ${x.how.row.pass} ${x.how.result === 'overruled' ? 'closed (overruled)' : 'gave to another judge (sustained)'} - not counted.`);   // A-DRAFT
            }
            verdicts[i] = { ...v, critique: { ...v.critique, failures: kept, meets: kept.length ? v.critique.meets : true }, closedRaised: closed.map(x => ({ ...x.f, id: x.id, closed_by_ruling: x.how.result })), ...(kept.length ? {} : { decidedOnly: true }) };
          }
          if (layerDebateOn && (row.layer === layerNumbers[0] || (shortExchangeOn() ? !earlyAsk : ladderLive && ladder.exchange > 0))) await layerExchange(from, row);   // B2: the lowest layer's exchange, before its state is decided; layers 2 and 3 get one only on the ladder, with its own round count. S6 (Q5, Q9): with the pair W5 + W14 recorded every layer gets the shortened exchange, except in an early-ask pass (the top layer is asked alone there: its exchange would leave side effects the early yes can never wipe)
          const mine = verdicts.slice(from);
          // Q4(d) (RU-S3-72, RU-S3-73): a pass with one heard judge is followed by a re-ask pass for the unheard judges, in which the heard judge's objections are debated; nothing is revised and nothing climbs. N8 is kept by the re-ask, not by a skip.
          const heardHere = mine.filter(isHeard);
          const lone = layerDebateOn && row.layer === layerNumbers[0] && heardHere.length === 1 && mine.some(v => v.abstained) && (heardHere[0].critique?.failures.length ?? 0) > 0;
          if (lone) loneHeard = true;
          row.state = lone ? 'unheard' : layerState(mine, explicitTop && row.layer === topLayer);
          const againHere = mine.flatMap(v => (v.closedRaised || []).map(f => f.id));
          if (againHere.length) row.raised_again = againHere;   // stall escalation: the layer's row keeps the trace that a judge's objection was filtered (closed by an earlier ruling)
          const carriedHere = mine.filter(v => v.carried).map(v => ({ lab: seatKeyOf(v.seat), from_round: v.fromRound }));
          if (carriedHere.length) row.carried = carriedHere;
          // Stall escalation: the floor layer rules on the passed-up objections right after its blind review, before the climb goes on (a sustain makes the layer object).
          if (escalation && !escalation.ruled && row.layer === escalation.floor) await ruleOnEscalation(row);
          if (layerOneOpen?.ruling && row.layer === layerNumbers[1]) settleInCallRulings(row, from);   // 0.8.4 S7b A3: the second layer's rulings on layer 1's open objections, after the layer's state is known and before the climb decision (an adopted copy that holds makes the layer object)
          if (signoffNoPending.length && signoffRefusalOn() && row.state !== 'objected') { await refusedSignoffs(from, row); row.state = layerState(verdicts.slice(from), explicitTop && row.layer === topLayer); }   // 0.8.4 S6 (G7): after the ruling, so the layer's state is the one that stands
          signoffNoPending = [];
          if (row.state !== 'signed_off') {
            log(`  layer ${row.layer} did not sign off (${layerStateWord(row)}); the layers above it are not asked this round.`);
            break;
          }
        }
        } catch (secretErr) {
          // A SECOND of the three catches for the person's --finish (the first two end the pass loops): the throw came INSIDE the layer loop. The layers already answered stay on the record; the layer that was
          // cut off ends `unfinished` and those after it stay not_asked. What follows folds the answered layers exactly as the ledger stop (C-004) does, then ends the review.
          if (!(secretErr instanceof SecretFinish)) throw secretErr;
          secretCut = secretErr;
          // The layer that was CUT (its call, its exchange, its escalation ruling or its sign-off re-ask did not finish): its row ends `unfinished`, whichever window the throw came in, and its seats' verdicts leave `verdicts` (the one site every
          // in-pass reader works from) and are written below, marked `cut`, to panelVerdicts[] and signoff[]. An interim shape (a verdict waiting for its unanswered-objection re-ask) is written as the seat's first reply.
          if (cutRow) cutRow.state = 'unfinished';
          if (reaskInFlight !== null) { reaskedAt.delete(reaskInFlight); reaskInFlight = null; }
          cutVerdicts = verdicts.splice(cutFrom).map(v => (v.abstained && v.unansweredFallback ? (({ settle: _settle, ...first }) => first)(v.unansweredFallback) : v));
          noteCutOpen(cutVerdicts, secretErr.exchangeWithdrawn, secretErr.exchangeNamed);
        }
        if (secretCut && verdicts.length === 0) {   // nothing of this pass is on the record but the cut layer's own replies, kept (marked) in panelVerdicts[]; lastCritique and signoff[] stay the last finished pass's
          foldRoundNotes(); cutVerdicts.forEach((v, k) => panelVerdicts.push({ ...panelRowOf(v, cutFrom + k), cut: true })); passed = false; finishedStop = secretStopFor(round, secretCut.label, secretCut);
          log(secretCut instanceof SpendFinish ? `\n  finishing at the person's choice: the spending limit stopped the run at stage "${secretCut.label}", before its next call was paid for; this is NOT agreement.` : `\n  finishing at the person's choice: the run was paused at a credential-shaped string in stage "${secretCut.label}"; this is NOT agreement.`);   // WORDING S16-w67 (A-DRAFT, pr2 fix, item 6: the sentence the outer catches already use; these two inner catches called every finish a credential-shaped string)
          break;
        }
        // For a live view that closes a round on an event: fired once per layered round, after its last asked layer, with the labs actually asked (a carried verdict is not an ask).
        progressHook({ kind: 'round-end', round, labs: verdicts.filter(v => !v.carried).map(v => seatKeyOf(v.seat)) });
        // E4: the ledger did not fit. layerStop is set and the top row stays not_asked. The round loop ends HERE, before the E2b block below could classify the same round as no_objection_to_revise, so that block needs no guard (C&C ruling 15 Oct 2026). The ORDER is the whole safeguard: if the E2b block is ever moved ahead of this break, test/objection-ledger-wiring.test.js row "E4 w4" (layerStop.reason stays ledger_overflow) fails
        // (variant tree, 14 Oct 2026: removing a `!layerStop` guard there changed no test result, so none was added).
        if (ledgerStopped) { foldRoundNotes(); recordPanelRound(); passed = false; break; }
        if (earlyAsk && !secretCut) {
          const pending = earlyAsk; earlyAsk = null;
          const topRow = roundRows.find(r => r.layer === topLayer);
          if (topRow.state === 'signed_off' && !topRow.carried) {
            // The overseer layer said yes (every seat of it signed off explicitly). NOT a sign-off of the draft: nothing of this pass is recorded as a verdict, a layers[] row or signoff[]; lastCritique stays the objections of the pass that
            // triggered the revise, so the dispute stage and the dissent block carry every one of them (the early yes can never wipe an objection).
            earlyFinish = { kind: 'early_finish', pass: round, overseer_round: ovOn ? ovState.overseerRound : 0, chosen: 'early', reason: pending.reason, items: pending.record, overseer: topRow.labs, ...(topRow.seats ? { overseer_seats: topRow.seats } : {}) };
            earlyTasks = pending.tasks;
            if (ovOn) ovCompleted += 1;   // the overseer layer gave its verdict for this round: overseer_rounds counts it, and equals stop.overseer_round
            layersRecord.splice(layersRecord.length - roundRows.length, roundRows.length);
            // This pass's judge replies are not read as notes (the pass is not a recorded pass): counted as dropped, like any reply whose seat did not end a recorded pass.
            for (const [key, st] of [...notesStash].filter(([, e]) => e.pass === round)) { if (notesOn) notesDropped.push({ lab: st.lab, pass: round, why: 'verdict_not_recorded' }); notesStash.delete(key); }
            passed = false;
            log(`\n  finishing early at the session's proposal, with the overseer layer's yes: ${pending.record.length} open objection(s) go to the builder as tasks; this is NOT agreement.`);
            break;
          }
          log(`\n  the overseer layer did not agree to finish early (${LAYER_STATE_WORDS[topRow.state] ?? topRow.state}); its reply counts as an ordinary overseer verdict.`);
        }
        if (ledgerOn) notAskedByRound[round] = roundRows.filter(x => x.state === 'not_asked' || x.state === 'escalated').flatMap(seatsOfRow);
      }

      // Each objection carries the lab that raised it, so the human review
      // step sees who said what rather than an anonymous merged list.
      const voting = verdicts.filter(v => v.critique);
      foldRoundNotes();
      // `abstained` keeps its old meaning (everyone without a critique, including a stated pass).
      // `unheard` is the narrower set that matters for unanimity: seats whose reply was lost - cut
      // off, malformed, or the provider was down. A stated pass is a position; a lost reply is not.
      const abstained = verdicts.length - voting.length;
      const unheard = verdicts.filter(v => v.abstained).length;
      // Quote validation (2026-09-20, src/quote-check.js). Only runs when the task actually
      // carries fenced source - without it there is nothing to check a quote against, and
      // marking every claim "unquoted" would be noise that teaches seats to ignore the mark.
      // Nothing is ever dropped: an unquoted objection may still be right, and silently
      // discarding an objection is how a real defect disappears.
      // E3: a stated pass's carried objections (verdict.openOwn) join the round's failures at this single fold point, ids and carried_from_round kept (they were marked when first raised).
      const openOwnFailures = verdicts.flatMap(v => openOwnOf(v).map(f => ({ ...f, lab: seatKeyOf(v.seat) })));
      // Stall escalation: an objection a floor-layer seat SUSTAINED is that seat's own from here on, so it joins the round's failures at this same fold point (it goes to the revise, the signature, answer-back and signoff[]).
      const openOwnAny = (sevRun ? openOwnFailures.some(f => holdsSignOff(f.severity)) : openOwnFailures.length > 0) || adoptedNow.some(adoptedHolds);   // unit 3 (flag d): with the switch, a stated pass whose carried objections are all swept counts as a plain stated pass
      const allFailures = [...voting.flatMap(v =>
        markFailures(v.critique.failures, fencedSource, shownDraft, excerptsForQuotes(), { request, criteria, rows: failedRowsOf(v.critique) }).map(f => ({ ...f, lab: seatKeyOf(v.seat), id: objectionId(seatKeyOf(v.seat), f) })).map(f => { const at = f.quote ? null : attachedQuotes.get(`${f.lab}\u0000${f.id}`); return at ? { ...f, attached_quote: at.quote, quote_attached_in: at.from } : f; })), ...openOwnFailures, ...adoptedNow];   // 0.8.4 S14 (C&C R510 (a)): the attached quote joins the failure AFTER markFailures and AFTER objectionId, as its OWN field `attached_quote` (never `quote`: problemKey reads `quote` and feeds objectionId/objectionKey, and every prompt built from the fold copies `quote`; C&C R528 hold: prompts stay as before S14 until S12). Read only by the stall line below, the anchor rule and the report writer (src/anchor.js); the raise-time id is kept and a passage that is in the draft but not in the fenced source is never marked 'unverified' (C&C R525: quote_status is the F7 check of the judge's OWN reply, made before the overlay and KEPT by it: an attached passage is a stall anchor, it says nothing about whether the repo claim was checked, so an 'unquoted' mark and its warning line stay; what decides a warning reads quote_status, never f.quote)
      collectTextRequests(round, voting);
      for (const v of voting) { const k = seatKeyOf(v.seat); seatLast.set(k, v.critique.failures.map(f => ({ id: objectionId(k, f), base: baseObjectionId(k, f), problemNorm: normProblem(f.problem) }))); }   // 0.8.4 S2: what stands for each seat that gave a verdict this pass
      if (layered) heardByRound[round] = verdicts.filter(v => !v.carried && !v.abstained && (v.critique || v.passed)).map(v => seatKeyOf(v.seat));   // E4b: who gave a NEW verdict this round (rule R's "was asked"), on every layered chain
      if (ledgerOn) {
        // E4 captures: the judges' OWN raises only (a carried verdict's failures belong to an earlier round), and who gave a NEW verdict this round (a carried verdict is not "heard"). A sustained objection is the sustaining seat's own raise.
        ledgerRaises.push({ round, failures: [...voting.filter(v => !v.carried).flatMap(v => v.critique.failures.map(f => ({ ...f, lab: seatKeyOf(v.seat), id: objectionId(seatKeyOf(v.seat), f) }))), ...openOwnFailures, ...adoptedNow] });
      }
      if (fencedSource || excerptsForQuotes().length) {   // 0.8.4 A7: an unfenced run is checked once an excerpt is visible
        for (const w of quoteWarnings(allFailures.filter(f => f.quote_status), 'panel', { fenced: !!fencedSource })) {
          log(`    QUOTE: ${w}`);
          quoteFindings.push(w);
        }
      }
      // 2026-09-22 (council-method analysis): an objection that was raised, fixed, and then comes
      // back reads like ordinary progress in the log, so nobody notices the plan lost ground. Track
      // which criteria failed in each round and name a criterion that failed, passed, then failed
      // again. Recorded, never acted on: a regression is information for the human, not a veto.
      // Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #4): "passed in
      // the previous round" was inferred from the criterion's absence there - which is also what
      // happens when its only objector was simply not heard, so an unchanged draft got a false
      // REGRESSION. Now per (lab, criterion): the same lab failed it before, was HEARD in the
      // previous round without failing it, and fails it again.
      const failedNow = new Set(allFailures.filter(f => f.criterion).map(f => `${f.lab}\u0000${f.criterion}`));
      const heardNow = new Set(voting.map(v => seatKeyOf(v.seat)));
      const prevRound = failedByRound[failedByRound.length - 1];
      const regressedPairs = failedByRound.length >= 2 ? [...failedNow].filter(key =>
        prevRound.heard.has(key.split('\u0000')[0])
        && !prevRound.failed.has(key)
        && failedByRound.slice(0, -1).some(prev => prev.failed.has(key))) : [];
      for (const c of [...new Set(regressedPairs.map(k => k.split('\u0000')[1]))]) {
        const labs = regressedPairs.filter(k => k.split('\u0000')[1] === c).map(k => k.split('\u0000')[0]);
        log(`    REGRESSION: "${c}" failed in an earlier round, passed, and fails again (${labs.join(', ')}).`);
        regressions.push({ round, criterion: c, labs });
      }
      failedByRound.push({ failed: failedNow, heard: heardNow });
      // Unit 4a (C&C ruling Q2 (a)): layer 3's re-tags take effect when the pass settles. They come from COUNTED verdicts of the top layer only; the value in force changes for the lists below, and an objection a re-tag puts into a holding band is a live objection: it joins the
      // list when it was not on it, and the pass is not signed off (sign-off is ONE predicate: every seat signed AND nothing in force holds). The record says why the end is not agreed. Several seats naming one id: the higher value applies (src/severity.js applyRetags).
      let retagHold = false;
      if (sevRun) {
        const bySeat = verdicts.filter(v => !v.abstained && v.critique && !v.carried && v.seat.layer === topLayer && Array.isArray(v.critique.retags)).map(v => ({ seat: seatKeyOf(v.seat), retags: v.critique.retags }));
        const notTop = verdicts.filter(v => !v.abstained && v.critique && !v.carried && v.seat.layer !== topLayer && Array.isArray(v.critique.retags)).map(v => ({ seat: seatKeyOf(v.seat), retags: v.critique.retags }));
        if (notTop.length) sevRun.refuseRetags(round, notTop, 'not_top_layer');   // only the top layer may re-tag; a volunteered re-tag of a lower layer is recorded as refused, never dropped
        if (bySeat.length && shownLedger?.pass !== round) sevRun.refuseRetags(round, bySeat, 'no_ledger_shown');   // a volunteered re-tag with no ledger shown is recorded as refused, never dropped
        else if (bySeat.length) {
          // 0.8.4 (A5, "Handler picks by reasoning"): two top-layer seats that re-rated ONE objection to different values are decided by the handling session, before anything is put in force. With no handling session, or while the wording is not recorded, the higher value applies as it always did.
          const picks = new Map();
          if (hasHandlingSession(config) && handlerRetagPickLive() && typeof sevRun.retagConflicts === 'function') for (const c of sevRun.retagConflicts(round, bySeat, shownLedger.rows)) { const p = await askRetagPick({ n: ++retagPickSeq, conflict: c, row: shownLedger.rows.get(c.id) }); picks.set(p.id, p); }
          for (const a of sevRun.applyRetags(round, bySeat, shownLedger.rows, picks).applied) {
            let hit = false;
            for (const f of allFailures) if (f.lab === a.lab && f.id === a.id) { f.severity = a.to; hit = true; }
            if (severityMeets([{ severity: a.to }])) {   // a value below the line that holds a sign-off puts nothing on hold
              // 0.8.4 (Muad, 11 Nov 2026, the top layer's own lowering holds like the handling session's): the raiser's own open entry carries the rating in force, as a handler re-tag does at the handler's apply (a copy: no earlier record that holds the old entry is rewritten), so a sustained or unanswered carried objection reads the lowered rating and holds nothing in the next pass.
              const e = answerBackLatest[a.lab]; if (e?.objections?.some(o => o.id === a.id)) answerBackLatest = { ...answerBackLatest, [a.lab]: { ...e, objections: e.objections.map(o => (o.id === a.id ? { ...o, severity: a.to } : o)) } };
              continue;
            }
            retagHold = true;
            log(`  ${layerWord(topLayer)} re-tagged ${a.id} (${a.from} to ${a.to}): it now holds the sign-off, so this pass is not signed off and the objection goes into the revision.`);
            if (!hit) { const r = shownLedger.rows.get(a.id); allFailures.push({ lab: a.lab, id: a.id, criterion: r.criterion ?? '(from the ledger)', problem: r.problem ?? '', ...(r.quote ? { quote: r.quote } : {}), fix: '', severity: a.to, from_retag: true }); }
          }
        }
      }
      const allVotersClean = voting.length > 0 && voting.every(v => v.critique.meets === true) && !openOwnAny && !retagHold;
      const nobodyHeardSilent = voting.length === 0 && !openOwnAny && ovOn && unheard > 0;   // 0.8.4 (SOLO-1, a silent judge that is the only one asked, layer 1): nobody was heard because a seat stayed silent after its re-asks and its solo ask: that is the silent-judge stop, not a pass with nothing to revise
      const reaskNoRevise = ((allVotersClean || nobodyHeardSilent) && unheard > 0) || loneHeard;   // nothing to revise yet: ask the unheard seats again on the unchanged draft
      // An unheard reviewer is an unknown, not consent. Found in the 2026-09-17 pilot: when every
      // reviewer that WAS heard signed off, the old check declared "every lab that answered signed
      // off" and passed, with a truncated or malformed dissent silently outside the vote. The
      // relay engine already carries this rule (run 2026-09-13T20-20-07-757Z); ported here.
      // With no quorum set (minHeard 0) every round is quorate and this is exactly the old rule.
      const quorate = voting.length >= minHeard;
      const allSignedOff = allVotersClean && unheard === 0 && quorate && !verdicts.some(v => v.decidedOnly) && (!layered || roundRows.every(r => r.state === 'signed_off'));
      // 0.8.4 S7b A3: the objections layer 2 CLOSED in its ordinary call in THIS pass (an overrule below 4, or a sustain: the sustaining seat holds the adopted copy, which is in allFailures through adoptedNow) are still in `allFailures` (the audit, the ledger history and failureOf keep them: the id assigner needs them for #r2),
      // but they are no longer ACTIONABLE: the stall book must not count them (a ruled id could otherwise reach the stall window in the pass it was ruled on) and the writer is not sent them. With nothing closed it is the SAME array as allFailures, so a shipped run is byte-identical.
      const closedInCall = new Set(inCallRulings.filter(e => e.pass === round).flatMap(e => e.outcome.filter(o => closedByRuling(o) && !reopenedAfter(e, o.seat ?? o.lab, o.id)).map(o => `${o.seat ?? o.lab}\u0000${o.id}`)));
      const actionable = closedInCall.size ? allFailures.filter(f => !closedInCall.has(`${f.lab}\u0000${f.id}`)) : allFailures;
      // (defined here, AFTER the layer-3 re-tag loop above: it can push a ledger row onto allFailures, and the filtered copy must include it)
      lastCritique = { meets: allSignedOff, failures: actionable };   // 0.8.4 S7b A3: what the pass left OPEN (an objection layer 2 closed in its call is not: it would otherwise reach the dispute stage's open objections and the severity record as open; with nothing closed this is allFailures)
      // `objections` is why a seat declined, co-located with the decision itself.
      // The same failures also appear flattened in lastCritique.failures, tagged
      // with `lab`, because the reviser and the CLI want the union across the
      // panel. Both are built here from the same `voting` array in one pass, so
      // they cannot drift. Added 2026-09-11: a four-lab panel reading a run
      // folder concluded a holdout's reason was not machine-readable, because
      // signoff carried the verdict and nothing else - the join through
      // lastCritique.failures[].lab existed but was undiscoverable.
      // `lab` (0.7.7, brief 03 fix 2) is the same value as `provider`, which has always held the
      // lab despite its name. `provider` stays for compatibility and is marked deprecated in
      // schemas/report-v1.json; it can go only with a schemaVersion 2.
      // Stall escalation: a seat that SUSTAINED a passed-up objection holds it as its own, so its row does not read clean whatever its blind verdict said: signedOff false, the objection in `objections` with `sustained_from`.
      const sustainedBy = v => adoptedNow.filter(f => f.lab === seatKeyOf(v.seat)).map(({ lab: _lab, ...f }) => f);
      const signoffRowOf = v => ({
        provider: labOf(v.seat), lab: labOf(v.seat), ...seatField(v.seat), model: v.seat.model,
        ...(layered ? { layer: v.seat.layer } : {}), // 0.8.3 E2b, additive: the layer this seat sits in (layered chains only)
        // 0.7.9, additive: the seat's index in config.seats.critics. A relay panel lists signoff[]
        // in its seeded review order, so array position is not the seat (verdict-diff reads this).
        seat_index: config.seats.critics.findIndex(c => seatKeyOf(c) === seatKeyOf(v.seat)),
        signedOff: adoptedNow.some(f => f.lab === seatKeyOf(v.seat) && adoptedHolds(f)) || v.decidedOnly ? false : v.abstained || v.passed ? null : v.critique.meets === true && !holdingOwnOf(v).length,   // M1: signoff[] is a stable field and `true` means signed off: a seat that signed off blind and then named a defect that holds its layer reads `false` here, as before; the blind sign-off is kept in panelVerdicts (signed_off + defect_named)
        ...(v.exchangeCleared ? { exchange_cleared: true } : {}),   // B2: signed off because every objection of this judge was withdrawn in the layer's exchange
        objections: (() => { const own = v.abstained || v.passed ? null : v.critique.failures.map(f => ({ ...f, id: objectionId(seatKeyOf(v.seat), f) })); const extra = [...sustainedBy(v), ...(v.closedRaised || []), ...(v.abstained || v.passed ? [] : openOwnOf(v))]; return extra.length ? [...(own ?? []), ...extra] : own; })(),   // stall escalation: a sustained objection, and an id raised again that a ruling had closed (closed_by_ruling), stay visible on the row
        // v7 item 4: a pass is a stated, recorded refusal to verdict - distinct from an
        // abstention (no usable reply at all), which is why it carries its own reason field
        // instead of overloading `objections`.
        passed: v.passed === true,
        passReason: v.passed ? v.passReason : null,
        // M1 (GO item 9): a stated pass that holds an objection of its own reads signedOff null and objections null, so the row says nothing of what holds its layer: `holds_layer` names it (the tally's own predicate, `holdingOwnOf`; a defect rated below the line holds nothing and is not listed). Only a stated pass: for every other seat the row's own word (signedOff false, the objection in `objections`) already says the layer is held. Reader: decision-records.js holdsLayerOf / holdsLayerWords.
        ...(v.passed && holdingOwnOf(v).length ? { holds_layer: holdingOwnOf(v).map(({ id, criterion, problem, from_exchange, carried_from_round }) => ({ id, criterion: criterion ?? '', problem: problem ?? '', ...(from_exchange ? { from_exchange: true } : {}), ...(carried_from_round !== undefined ? { carried_from_round } : {}) })) } : {}),
        // v8 item (a): additive field, report.json contract. null for a real sign-off/objection
        // or a stated pass; one of RESERVED_ABSTENTION_REASONS (src/chain.js) when v.abstained.
        reason_code: v.abstained ? (v.reasonCode || null) : null,
      });
      signoff = verdicts.map(signoffRowOf);

      recordPanelRound();
      passReviewed = round;   // this pass's panel is on the record: a finish after this point ends a pass whose panel is recorded
      if (secretCut) {   // the layer loop was cut by the person's --finish after at least one verdict stood: those are recorded above (lastCritique, signoff, panelVerdicts); the cut layer's replies are written here, marked; the review ends here
        cutVerdicts.forEach((v, k) => { panelVerdicts.push({ ...panelRowOf(v, cutFrom + k), cut: true }); signoff.push({ ...signoffRowOf(v), cut: true }); });
        openByRound.push({ round, failures: allFailures });   // as at the end of a normal pass (first_raised_round, standsAfter read it)
        sevRun?.closePass(round, allFailures);
        passed = false; finishedStop = secretStopFor(round, secretCut.label, secretCut);
        log(secretCut instanceof SpendFinish ? `\n  finishing at the person's choice: the spending limit stopped the run at stage "${secretCut.label}", before its next call was paid for; this is NOT agreement.` : `\n  finishing at the person's choice: the run was paused at a credential-shaped string in stage "${secretCut.label}"; this is NOT agreement.`);   // WORDING S16-w67 (A-DRAFT, pr2 fix, item 6: the sentence the outer catches already use; these two inner catches called every finish a credential-shaped string)
        break;
      }

      if (allSignedOff) {
        if (layered) agreementPoint = { pass: round, kind: 'full', sha: draftIdOf(draft) };
        const check = await askBuildCheck({ round, kind: 'full', failures: allFailures, verdicts });   // 0.8.4 S4: with a handling session and the wording recorded the run WAITS here (ExternalPause); null otherwise
        if (check?.answer === 'not_yet') handlerBlocks = check;   // layer 3 signed, the handler is not satisfied: this pass goes on as an objected overseer round (below)
        else {
          passed = true;
          if (ovOn) ovCompleted += 1;
          log(abstained
            ? `  every lab that answered signed off (${abstained} passed); stopping.`
            : `  every lab on the panel signed off; stopping.`);
          break;
        }
      }

      // The ladder: a pass that did not ask every layer and in which every layer it asked signed off, the top layer included (explicitly, as layerState requires), ends the run. The layers in `below` were not asked in this pass, so it is the
      // escalated sign-off's own record (passed stays false, outcome not widened), marked `ladder`, never a plain sign-off.
      // 0.8.4 S4 (control 1 without the ladder): a routed pass (`floorRoute`) ends the same way, but it is NOT a ladder run: the record carries `requested` and no `ladder` key, the agreement point is `escalated` (Q8: an escalated sign-off after an early look), and the overseer round is counted only where the chain has them.
      // Without this branch a layer-3 sign-off on a routed pass (layers below not asked, so `allSignedOff` false) would fall through to the layer_stop below and end the run as "nothing was objected to".
      if (!handlerBlocks && (ladderLive || floorRoute) && allVotersClean && unheard === 0 && quorate && !verdicts.some(v => v.decidedOnly) && roundRows.some(r => r.state === 'not_asked') && roundRows.find(r => r.layer === topLayer).state === 'signed_off') {
        const agreementKind = ladderLive ? 'ladder' : 'escalated';
        escalatedEnd = { pass: round, layer: topLayer, ...(ovOn ? { overseer_round: ovState.overseerRound } : {}), below: roundRows.filter(r => r.state === 'not_asked').map(r => r.layer), ...(ladderLive ? { ladder: true } : {}), ...(ladderRequested ? { requested: true } : {}) };
        agreementPoint = { pass: round, kind: agreementKind, sha: draftIdOf(draft) };
        const check = await askBuildCheck({ round, kind: agreementKind, failures: allFailures, verdicts });
        if (check?.answer === 'not_yet') { handlerBlocks = check; escalatedEnd = null; }   // not an ending: the handler sends it back
        else {
          passed = false;
          if (ovOn) ovCompleted += 1;   // the top layer gave its verdict: the overseer round ends here, as on a sign-off
          log(`  every layer that was asked signed off, the top layer included; ${escalatedEnd.below.length === 1 ? 'layer' : 'layers'} ${escalatedEnd.below.join(', ')} ${escalatedEnd.below.length === 1 ? 'was' : 'were'} not asked in this pass (${escalatedEnd.requested ? `it was asked to start at layer ${escalatedEnd.layer}` : 'the ladder chose which layers to ask'}): ${ladderLive ? 'a ladder sign-off' : 'a top-layer sign-off'}, NOT agreement of the whole panel; stopping.`);   // A-DRAFT
          break;
        }
      }

      // Stall escalation: every layer the climb asked signed off, the top layer included (explicitly, as layerState requires), and the layers below the floor were passed over. That is the `escalated_signoff` ending, NOT a pass:
      // `passed` means every critic signed off on the same draft (report-v1 contract), and the judges below did not (C&C ruling 1, 27 Okt 2026). Only rows in state `escalated` are excepted, never "rows not asked": an early-finish
      // pass asks the top layer alone, and a carried top sign-off there must not read as a sign-off of the plan.
      // After the floor has reset, the same ending holds when every layer signed off but a judge's only objections were ids a ruling had closed (decidedOnly): the plan is signed over an objection its raiser still holds.
      const raisedAgainNow = verdicts.filter(v => v.decidedOnly).flatMap(v => v.closedRaised.map(f => f.id));
      if (!handlerBlocks && layered && escalations.length && allVotersClean && unheard === 0 && quorate && (roundRows.some(r => r.state === 'escalated') || raisedAgainNow.length) && roundRows.every(r => r.state === 'signed_off' || r.state === 'escalated')) {
        escalatedEnd = { pass: round, layer: topLayer, ...(ovOn ? { overseer_round: ovState.overseerRound } : {}), below: roundRows.filter(r => r.state === 'escalated').map(r => r.layer), ...(raisedAgainNow.length ? { raised_again: raisedAgainNow } : {}) };
        agreementPoint = { pass: round, kind: 'escalated', sha: draftIdOf(draft) };
        const check = await askBuildCheck({ round, kind: 'escalated', failures: allFailures, verdicts });
        if (check?.answer === 'not_yet') { handlerBlocks = check; escalatedEnd = null; }   // not an ending: the handler sends it back
        else {
        passed = false;
        if (ovOn) ovCompleted += 1;   // the top layer gave its verdict: the overseer round ends here, as on a sign-off
        log(`  every layer that was asked signed off, the top layer included, ${escalatedEnd.below.length ? `and ${escalatedEnd.below.length === 1 ? 'layer' : 'layers'} ${escalatedEnd.below.join(', ')} ${escalatedEnd.below.length === 1 ? 'was' : 'were'} passed over while objections went up a layer` : `while a judge still raised ${raisedAgainNow.join(', ')}, closed by an earlier ruling`}: an escalated sign-off, NOT agreement of the whole panel; stopping.`);   // A-DRAFT
        break;
        }
      }

      // Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #3): a round in which
      // no reviewer was heard - every seat unreachable, unreadable, or only stating a pass - fell
      // through to the reviser with an empty objection list ("(none listed)"): each round paused
      // for, or paid for, a full rewrite with nothing to fix, up to the round cap. The stall rule
      // could not catch it (an empty signature). An OpenRouter outage takes out every critic in the
      // shipped seven-lab chains at once, so this is the outage path. Stop instead, and say why.
      if (allVotersClean && unheard === 0 && !quorate) {
        notQuorate = { round, heard: voting.length, minHeard, passedOnly: verdicts.length - voting.length };
        log(`\n  round ${round}: every reviewer that gave a verdict signed off, but only ${voting.length} did (${verdicts.length - voting.length} stated a pass), below this chain's quorum of ${minHeard}. Not quorate: stopping the loop; this is not agreement.`);
        passed = false;
        break;
      }

      // 0.8.4 (ladder unit; his 10 Nov 2026 02:13 ruling: after the solo ask the run stops at the silent-judge stop and no layer signs off without the silent judge): on a chain with overseer rounds (the ladder included) a pass in which NO reviewer was heard because a seat stayed silent is not the outage end below but the silent seat's own stop (advance(), layer_bound / unheard), which offers all three choices; a layer with a judge that never answers is waiting for it.
      if (voting.length === 0 && !openOwnAny && !(ovOn && unheard > 0)) {
        noHeardReviewer = { round, unheard, passedOnly: verdicts.length - unheard, ...(layered ? { layer: roundRows.filter(r => r.state !== 'not_asked').pop().layer } : {}) };
        log(`\n  round ${round}${layered ? `, layer ${noHeardReviewer.layer}` : ''}: no reviewer was heard (${unheard} unreadable or unreachable, ${verdicts.length - unheard} stated a pass) - there is nothing to revise against. Stopping the loop; this is not agreement.`);
        passed = false;
        break;
      }

      // 0.8.3 E2b: a layered round whose climb ended on a layer in which nobody voted (only stated passes), or on a top layer where not every seat signed off explicitly, has no objection to revise
      // against and nobody unheard to ask again: it stops here, as "not agreement", instead of reaching the reviser with an empty list (the 2026-09-23 bug-audit #3 class, one layer up).
      if (layered && !allSignedOff && !handlerBlocks && allVotersClean && unheard === 0) {
        const row = roundRows.find(r => r.state === 'abstained') || roundRows.filter(r => r.state !== 'not_asked').pop();
        const mine = verdicts.filter(v => seatsOfRow(row).includes(seatKeyOf(v.seat)));
        const reason = row.state !== 'abstained' ? 'no_objection_to_revise' : mine.some(v => v.critique) ? 'top_layer_not_explicit' : 'only_stated_passes';
        layerStop = { round, layer: row.layer, reason, labs: reason === 'top_layer_not_explicit' ? mine.filter(v => v.critique?.meets !== true).map(v => labOf(v.seat)) : row.labs, ...(reason === 'top_layer_not_explicit' ? (mine.some(v => seatKeyOf(v.seat) !== labOf(v.seat)) ? { seats: mine.filter(v => v.critique?.meets !== true).map(v => seatKeyOf(v.seat)) } : {}) : (row.seats ? { seats: row.seats } : {})) };
        log(reason === 'top_layer_not_explicit'
          ? `\n  round ${round}, layer ${row.layer} (the top layer): ${layerStop.labs.join(', ')} did not sign off explicitly (stated a pass). The top layer needs an explicit sign-off from every seat. Stopping the loop; this is not agreement.`
          : reason === 'only_stated_passes'
            ? `\n  round ${round}, layer ${row.layer}: nobody gave a verdict (only stated passes) - there is nothing to revise against. Stopping the loop; this is not agreement.`
            : `\n  round ${round}: nothing was objected to, so there is nothing to revise against. Stopping the loop; this is not agreement.`);
        passed = false;
        break;
      }

      // Dispute stop rule (2026-09-20). The round cap moved 3 -> 7 so a real disagreement has
      // room to resolve, which only helps if a disagreement that ISN'T resolving stops early.
      // Otherwise raising the cap just buys four more rounds of the same objection, at the
      // reviser's price each time - the most expensive seat in the run, re-reading everything.
      //
      // "The same objection" is deliberately (criterion, lab), not the objection's prose: a
      // seat rewording the same complaint each round is the exact pattern this catches, and
      // matching on text would miss it. Sorted, so seat ordering never makes a stable
      // disagreement look like a changing one.
      // 0.8.2 (ticket 12): finer than (lab, criterion), so two different defects under one criterion no longer read as one stuck disagreement; see src/objection-ids.js.
      // 0.8.4 S5 (Q13, R9, R4): the stall is counted PER OBJECTION over the verdicts of its raiser (src/stall-book.js), not as one string for the whole pass: an unrelated second objection no longer hides the first one's count (T7b), a reworded
      // problem keeps it (T7a, T7c), a changed passage restarts it (T7d, T7f). A pass in which a seat was not heard with a NEW verdict (not asked, unheard, a carried re-ask) neither counts nor ends its objections (R9). A re-ask pass for a
      // lone heard judge repeats the same list by construction: it is no stall and is not noted. "Unchanged writer response" for a QUOTED objection = its quote was found in the draft at its last verdict and is still found now (present, then
      // absent = changed); for an UNQUOTED one there is nothing to compare, so it is unchanged while it stands (a fix shows as the judge's withdrawal or a new #2 id).
      // 0.8.4 Q4 (C&C 08 Nov 2026, NEW-A1-2): an objection CLOSED on the record (an upper layer's overrule below 4, an adoption, a re-tag below 4: `closedOnRecord`, the same history the id assigner reads) does not stand, so it is neither noted nor sent up. A carried copy of a re-tagged id is answered by the re-tag (R3). A reopen counts: an id its raiser raised again after an escalation closed it (`raised_again`, counted) stands again, as `closedByRowRuling` reads it; with W6 recorded a reopen is also a new linked id (#r2). A re-tag applied in THIS pass counts (it is applied before this note), and a copy that the raiser's verdict carries because it left a closed id unanswered is the case this exists for.
      const closedNowBy = new Map();
      const closedNow = f => { if (!closedNowBy.has(f.lab)) closedNowBy.set(f.lab, closedOnRecord(f.lab, round + 1)); return closedNowBy.get(f.lab).has(f.id) && !rulingRows().some(e => reopenedAfter(e, f.lab, f.id)); };
      const standingNow = [...actionable.filter(f => !closedNow(f)).reduce((m, f) => { const k = `${f.lab}\u0000${f.id}`; if (!m.has(k)) m.set(k, f); return m; }, new Map()).values()];
      if (!loneHeard) {
        const draftTight = normQuoteTight(draft);
        stallBook.note(round, heardSeats(verdicts, v => seatKeyOf(v.seat)), standingNow.map(f => {
          const anchorQuote = f.quote || f.attached_quote; const quoteKey = problemKey({ quote: anchorQuote }); const present = quoteKey ? draftTight.includes(normQuoteTight(anchorQuote)) : false; const prev = stallBook.peek(f.lab, f.id);
          return { id: f.id, lab: f.lab, layer: layerOf[f.lab] ?? 0, quoteKey, present, response: quoteKey && prev && prev.quoteKey === quoteKey && prev.present && !present ? 'changed' : 'unchanged' };
        }));
      }
      openByRound.push({ round, failures: allFailures });
      sevRun?.closePass(round, allFailures);   // unit 3: the pass's whole list, so a run that stops later can say what the last computed pass held
      // E4b unit 2 (rule R, src/conflict-detector.js): a lower judge's old objection came back after an upper judge's was fixed. Found HERE, before any stop can end the pass (pure; from records every layered pass keeps); ACTED on just before the revise
      // (below). A pass that ends otherwise leaves it in `unhandledConflicts`, recorded when the loop is left; the last pass records it as `last_round`.
      const conflictsNow = layered ? findConflict({ round, failuresByRound: openByRound, heardByRound, layerOf, revisedRounds }) : [];
      const conflictOv = ovOn ? ovState.overseerRound : null;   // the overseer round this pass belongs to (before advance() can move it), as the `layers` rows read it
      let returnTrigger = null;   // 0.8.4 S9: set below when the top layer's objection ended this overseer round and the run goes on (a stop throws before the hook that reads it)
      unhandledConflicts = conflictsNow.length ? { round, found: conflictsNow, ov: conflictOv } : null;
      // Passing the plan up (stall escalation shape B, and the person's "send up" at a layer-1 revision bound): ONE construction for both, so the stall path is what it was. `trigger` says which ('stall' | 'send_up'); `rounds` are the passes the
      // objections stood in. The pass makes no revise and no advance() call (no revision is used); the next pass asks the layers from `up.to` upward; the objections leave the revise loop and go to that layer's ruling.
      const passUp = (up, trigger, rounds, only = null, layerOnly = null) => {   // `only` (S5): the stalled objections {lab, id, layer, passes}; null = every objection of the pass (the person's send-up, as built). `layerOnly` (0.8.4 S7): only the objections whose judge sits in that layer (the layer-2 bound go-up sends layer 2's own objections, not layer 1's; `only` cannot do it: it writes `stalled:` on the row, which is stall-only)
        // One item per (seat, id): two unquoted problems a judge raised under one criterion share one id (src/objection-ids.js), so they are ONE objection here, their problems joined, as answer-back joins them (FIX, Fable line 4).
        const items = [...allFailures.filter(f => (!only || only.some(o => o.lab === f.lab && o.id === f.id)) && (layerOnly === null || layerOf[f.lab] === layerOnly)).reduce((m, f) => { const k = `${f.lab}\u0000${f.id}`; const had = m.get(k); if (!had) m.set(k, { ...f }); else if (f.problem && !String(had.problem).includes(f.problem)) had.problem = `${had.problem} / ${f.problem}`; return m; }, new Map()).values()];
        // Q1(g)(2), RU-S3-50 / 53 / 55: an objection the layer-1 exchange left not_debated (it is still in the carry store) climbs FLAGGED and is not ruled on: no overrule can close it; it stays standing, and if the plan is sent back layer 1 debates it in its first pass after that (otherwise it remains standing dissent at the escalated sign-off).
        const flagged = items.filter(f => exchangeCarried.get(f.lab)?.has(f.id));
        // What became of a flagged objection (`next`) is DERIVED when the report is written (src/escalation.js notDebatedNext): the climb only knows it was not debated.
        const row = { round, pass: round + 1, from_layer: up.from, to_layer: up.to, trigger, ids: items.map(f => f.id), ...(only ? { stalled: only.map(o => ({ id: o.id, lab: labFromKey(o.lab), ...(labFromKey(o.lab) !== o.lab ? { seat: o.lab } : {}), layer: o.layer, passes: o.passes })) } : {}), labs: [...new Set(items.map(f => labFromKey(f.lab)))], ...(items.some(f => labFromKey(f.lab) !== f.lab) ? { seats: [...new Set(items.map(f => f.lab))] } : {}), ...(flagged.length ? { not_debated: flagged.map(f => ({ id: f.id, lab: labFromKey(f.lab), ...(labFromKey(f.lab) !== f.lab ? { seat: f.lab } : {}), ...(layerOf[f.lab] !== undefined && layerOf[f.lab] !== layerNumbers[0] ? { layer: layerOf[f.lab] } : {}) })) } : {}), rulings: [], outcome: [] };   // 0.8.4 S6: `layer` only when the layer that left it not debated is not the lowest (a layer-2 objection the shortened exchange did not reach)
        escalations.push(row);
        escalation = { row, floor: up.to, items, rounds, ruled: false, trigger, passesById: new Map((only ?? []).map(o => [`${o.lab}\u0000${o.id}`, o.passes])), flagged: new Set(flagged.map(f => f.id)) };
        escalatedFailures.set(row, escalation.items);
        if (trigger === 'stall' || trigger === 'layer2_bound' || trigger === 'layer1_bound') stallBook.markSentUp(items); else stallBook.reset();   // S5 (T20l; C&C 05 Nov 2026, R10 refused): a stalled id is not sent up again in the same overseer round, and a chain WITHOUT overseer rounds counts the whole run as one round (an id sent up once is never sent up again there: another ruling pass would be paid each time); the person's send-up keeps its fresh window as built
        carry = null;   // the next pass asks other seats on the same text: nothing is carried
        // A swing found in this pass gets no decider call and no revise: its objections go up with the plan. Recorded, never dropped.
        if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'escalated', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; }
      };
      // Stall escalation (S5, Q13): the objections whose OWN count reached the window (src/stall-book.js) go up together as ONE event; an unrelated objection that did not stall stays with its judge. The escalation pass itself (and a pass that
      // re-asks its unheard receiving layer) never stalls again: a sustain at 4 or above, or an objection of the receiving layer's own, needs the revise that follows it (RU-S5-02, RU-S5-14, D16).
      const escalationBusy = !!escalation && (round <= escalation.row.pass || !escalation.ruled);
      // The ladder (his 10 Nov 2026 end list: "agreement, the stall stop, the spending limit or his own stop"): the stall rule runs on ladder passes too, for the TOP layer only. A lower layer's objection standing unchanged through a block goes up with the ladder's own climb;
      // the ladder never passes the plan up on a stall and a lower layer's repeat does not stop the run (C&C's reading; his decision 4 of 28 Okt 2026 covers a top-layer stall).
      const stalledNow = disputeEnabled && !loneHeard && !handlerBlocks && !escalationBusy
        ? stallBook.reached().filter(r => standingNow.some(f => f.lab === r.lab && f.id === r.id) && (!ladderLive || r.layer === topLayer)) : [];
      let stallFacts = null;   // 0.8.4 S5 (C&C, round 7): a top-layer stall that falls through to advance() at the overseer cap rides on that overseer_cap stop as `stalled`
      if (stalledNow.length) {
        // Stall escalation (shape B): on a layered chain with a layer above the highest layer among the STALLED objections AND a pass left, the plan goes up instead of ending. The stalled pass makes no revise and no advance() call (no revision is
        // used); the next pass asks the layers from `up.to` upward and the stalled objections go to that layer's ruling. The escalation lasts that ONE pass (D16: layer 1 is never parked across revisions). A stalled objection of the TOP
        // layer, on an unlayered chain, or on the last pass, ends the loop exactly as before.
        const stalledItems = standingNow.filter(f => stalledNow.some(r => r.lab === f.lab && r.id === f.id));
        // 0.8.4 SG-1 (C&C 08 Nov 2026, option B): the stall goes up only where layer 2's review section (N24) can be built: that section needs the ledger (answer_back, layered, >= 2 layers: `ledgerOn`) and the rating demand (`severityOn`), the same two terms as the layer-1 go-up (U2-1b); the stall prompt itself does show the items, so this is not about what the receiving layer is shown. Where they are off the stall cannot be passed up: it is the S5 U-C stop for the person (below), never an end.
        const stallGoUpOn = callGates.goUpOn;   // 0.8.4 S11: the same ledgerOn && severityOn, read ONCE at stage start from src/call-gates.js (callGates, below the severityOn line)
        const up = layered && round < maxRounds && stallGoUpOn && !ladderLive && !ladderNextPass ? escalationTarget({ failures: stalledItems, layerOf, layerNumbers }) : null;   // a ladder pass never passes the plan up
        if (up) {
          passUp(up, 'stall', Array.from({ length: stallRounds }, (_, i) => round - stallRounds + 1 + i), stalledNow);
          const below = layerNumbers.filter(n => n < up.to);
          log(`\n  ${stalledNow.length} objection(s) stood unchanged through the last ${stallRounds} verdicts of their judges - this is not converging. Passing the plan up to layer ${up.to}: in round ${round + 1} it reviews the plan, then rules on these objection(s). That is one round: ${below.length > 1 ? `layers ${below.join(', ')} read` : `layer ${below[0]} reads`} the plan again in the round after it, unless it ends the run.`);   // A-DRAFT
          continue;
        }
        if (!layered) {
          stalled = { rounds: stallRounds, round };
          log(`\n  the same ${stalledNow.length} objection(s) from the same lab(s) for ${stallRounds} rounds running - this is not converging. Stopping the revise loop; the disagreement goes to the dispute stage rather than costing another ${maxRounds - round} round(s) of the same argument.`);
          break;
        }
        // 0.8.4 S5 U-C (C&C 05 Nov 2026, R1 as changed): on EVERY layered chain a stall that cannot be passed up (the top layer holds it, or no pass is left) is a STOP for the person, never an end. Unlayered chains keep 'stalled' above.
        const facts = stalledNow.map(o => ({ id: o.id, lab: labFromKey(o.lab), ...(labFromKey(o.lab) !== o.lab ? { seat: o.lab } : {}), layer: o.layer, passes: o.passes }));
        const topHeld = stalledNow.some(o => o.layer === topLayer);
        // A top-layer stall AT the overseer cap is the cap's own stop: it falls through to advance() and the overseer_cap stop carries `stalled` (the hard stop's words add the stall at seven).
        // Replay-stable: a recorded choice at the overseer_cap stop of this very pass (a continue raised the cap, a finish ended the run) still counts as 'at the cap', or the same pass would turn into a stall_stop on the replay.
        const capStopId = stopIdOf({ kind: 'overseer_cap', overseer_round: ovOn ? ovState.overseerRound : 0, pass: round });
        if (!ladderLive && ovOn && topHeld && ((Number.isInteger(limits.advanceConfigAt(ovState.overseerRound).maxOverseerRounds) && ovState.overseerRound >= limits.advanceConfigAt(ovState.overseerRound).maxOverseerRounds) || roundChoices.some(c => c.stop === capStopId))) { stallFacts = facts; }   // a ladder pass has no layer-3 cap to fall through to: its top-layer stall is always its own stop
        else {
          const stop = markLadderStop({ kind: 'stall_stop', why: stallStopWhy({ topHeld, passLeft: round < maxRounds, gateOn: stallGoUpOn, ladderNext: ladderNextPass }), top_layer: topLayer, ...(ovOn && !ladderLive ? { rounds: ovState.overseerRound } : {}), stalled: facts, pass_left: round < maxRounds, pass: round, overseer_round: ovOn ? ovState.overseerRound : 0 }, !!ladder);   // `rounds` from seven makes it the hard stop (isHardStop), whatever the effective cap. A ladder run has no layer-3 count, so its stall stop carries no `rounds` (C&C, Q-D: no count-based hard stop on a ladder run; `overseer_round` still says which round)
          const finishHere = finishChoiceOf(roundChoices, stopIdOf(stop));
          if (finishHere) {
            passed = false;
            if (ovOn && topHeld) ovCompleted += 1;   // the top layer gave its verdict: the overseer round ends here
            finishedStop = { ...stop, chosen: 'finish', ...(finishHere === 'finish_now' ? { finished_at_once: true } : {}), ...(finishRelayedOf(roundChoices, stopIdOf(stop)) ? { relayed: true } : {}) };
            log(finishHere === 'finish_now' ? `\n  finishing at once at the person's choice${relayedTail(finishedStop)}: ${limitReachedWords(stop)}; this is NOT agreement, and no judge reads the plan again.` : `\n  finishing at the person's choice${relayedTail(finishedStop)}: ${limitReachedWords(stop)}; this is NOT agreement.`);
            break;
          }
          // BACKSTOP (C&C, the send-up's shape): a recorded continue counts only while a pass is left (the same predicate as the CLI, the member text and the tree's choice); run.json is project-writable text and a tree's old choice can still arrive, so with no pass left the stop stands
          if (roundChoices.some(c => c.choice === 'continue' && c.stop === stopIdOf(stop)) && stopOffersContinue(stop)) {
            stallBook.restart(stalledNow);   // the person went on: the stalled objections are counted afresh; the pass then goes on to advance() / the revise as any pass does
          } else {
            passed = false;
            if (ovOn && topHeld) ovCompleted += 1;
            if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'loop_ended', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; }
            throw new RoundStopped(stop);
          }
        }
      }

      // Round semantics 2b: AFTER the stall rule (which fires first), BEFORE the cap backstop, the E4b conflict check and the revise: classify how this pass ended and ask advance() whether a bound is reached.
      if (ladderRequested && reaskNoRevise) ladderAskedUp = true;   // the pass was put at layer 3 by a request and no layer-3 judge was heard: the re-ask keeps the floor. Outside the overseer block so a routed chain without overseer rounds keeps it too (inside it the same condition was `passEnd.outcome === 'unheard'`, which is `reaskNoRevise`)
      if (ovOn) {
        const asked = roundRows.filter(r => r.state !== 'not_asked' && r.state !== 'escalated');
        const lastAsked = asked[asked.length - 1];
        const topLayer = Math.max(...roundRows.map(r => r.layer));
        const passEnd = reaskNoRevise ? { outcome: 'unheard', layer: (roundRows.find(r => r.state === 'unheard') ?? lastAsked).layer, ...(loneHeard ? { lone: true } : {}) }
          : handlerBlocks ? { outcome: 'overseer_verdict', verdict: 'objected' }   // 0.8.4 S4: the handler's not_yet is a layer-3 objection for the counters (T15b): it ends the overseer round and counts against the cap
          : lastAsked?.state === 'objected' ? (lastAsked.layer === topLayer ? { outcome: 'overseer_verdict', verdict: 'objected' } : { outcome: 'layer_objected', layer: lastAsked.layer })
            : null;
        if (passEnd) {
          // The ladder (src/ladder.js): an objection moves the ladder, not a layer bound. Only the TOP layer's objection ends an overseer round (layer 3's visits, capped at the ladder's `visits` plus any recorded --continue), so advance() is asked for that alone;
          // a lower layer's objection is a plain revise (the silent-seat count starts again, as advance() does on a revise). A silent seat still goes through advance() unchanged.
          const ladderObjected = ladderLive && passEnd.outcome !== 'unheard';
          if (ladderObjected) ladderState = afterObjection(ladderState, lastAsked.layer);
          const ladderAdd = roundChoices.filter(c => c?.choice === 'continue' && c.kind === 'overseer_cap' && Number.isInteger(c.add) && c.add > 0).reduce((n, c) => n + c.add, 0);
          // A ladder pass reads no bound of the chain's old keys: no layer bounds, and a layer-3 count only when the person typed `--rounds N` (plus the continues recorded at that overseer_cap stop). A silent seat (`unheard`) still goes through advance() with the chain's `reasks`.
          const ladderCfg = { maxOverseerRounds: ladderRounds === null ? null : ladderRounds + ladderAdd, layerRevisions: null, reasks: limits.advanceConfigAt(ovState.overseerRound).reasks };
          const step = advance(ladderObjected ? ladderCfg : limits.advanceConfigAt(ovState.overseerRound), ovState, passEnd);
          if (step.state.overseerRound !== ovState.overseerRound) stallBook.newOverseerRound();   // 0.8.4 S5 (RU-S5-05, Q13): the counts below the top layer restart with each overseer round; the top layer's are kept
          ovState = step.state;
          if (step.overseerRoundEnded) ovCompleted += 1;
          if (passEnd.outcome === 'overseer_verdict' && !handlerBlocks && step.action !== 'stop' && callGates.decisionLevel) returnTrigger = { ovRound: conflictOv };   // S9: the top layer's objection ends the overseer round (the handler's not_yet has no Choice line to contest)
          if (step.action === 'stop') {
            passed = false;
            const { overseerRound, ...stopFields } = step.stop; // one spelling in the record: overseer_round
            const stop = markLadderStop({ ...stopFields, pass: round, overseer_round: overseerRound ?? ovCompleted, ...(handlerBlocks ? { handler_not_yet: true } : {}), ...(stallFacts ? { stalled: stallFacts } : {}) }, !!ladder);   // 0.8.4 (C&C 10 Nov): the stop a ladder run raises at the limit its person typed (--rounds N) is marked `ladder: true` (markLadderStop): it is the person's at every N, and the 7-round hard stop does not apply to it (isHardStop, isPersonStop in src/overseer-rounds.js)   // 0.8.4 S4: say when the handler's not_yet (T15c) reached this stop
            // The person chose to FINISH at this very stop (run.json roundChoices): the run ends here, NOT agreed, and the post-loop stages (dispute, handoff) run over what is on disk.
            const finishHere = finishChoiceOf(roundChoices, stopIdOf(stop));
            if (finishHere) {
              finishedStop = { ...stop, chosen: 'finish', ...(finishHere === 'finish_now' ? { finished_at_once: true } : {}), ...(finishRelayedOf(roundChoices, stopIdOf(stop)) ? { relayed: true } : {}) };
              log(finishHere === 'finish_now' ? `\n  finishing at once at the person's choice${relayedTail(finishedStop)}: ${limitReachedWords(stop)}; this is NOT agreement, and no judge reads the plan again.` : `\n  finishing at the person's choice${relayedTail(finishedStop)}: ${limitReachedWords(stop)}; this is NOT agreement.`);
              break;
            }
            // 0.8.4 S16 (E; WORDING S16-w65c): no handling session, so nobody can choose at this stop: the run ends here like a finish (the final read, the dispute stage and the handoff follow), recorded as chosen 'rule'. Not at the hard stop, not at layer 3's own silence, not when the chain is the offline mock chain.
            if (endsAtStopWithoutHandler(config, stop, topLayer)) {
              finishedStop = { ...stop, chosen: 'rule' };
              log(`\n  ending at this stop: ${ruleCause(stop)}. This run has no handling session, so nobody can choose here and the run ends here. The final read runs next; if a seat of the top layer reads the final plan, the run ends, NOT agreed.`);
              break;
            }
            // 0.8.4 S7 (Q7): the plan goes up to layer 3 INSTEAD OF STOPPING at layer 2's revision bound, with layer 2's open objections, through the escalation path of F8 (as the stall escalation does). AUTOMATIC: no roundChoices entry is read (the person's layer-1
            // send-up below is a different, turned-off choice). It sits AFTER the finish check, so a recorded `finish` at an old layer-2 stop still ends the run, and a recorded `continue` raised b2 so this bound is never met. No revision is used: the next pass asks layer 3 alone
            // (layers 1 and 2 are `escalated`, not parked past that pass: escalationLastsOnePass) and its seats rule on layer 2's objections (the go-up's own held words). With no pass left the stop stands, as it does for the layer-1 choice below.
            if (layer2BoundGoUp(stop)) {
              const up = layered && round < maxRounds ? escalationTarget({ failures: allFailures.filter(f => layerOf[f.lab] === 2), layerOf, layerNumbers }) : null;
              if (up) {
                passUp(up, 'layer2_bound', [round], null, 2);
                log(`\n  round ${round}: layer 2 used its ${stop.bound} revision(s) and still objects (${escalation.items.length} open objection(s) of layer 2). The plan goes up to layer ${up.to} instead of stopping. In round ${round + 1} only layer ${up.to} is asked: layers ${layerNumbers.filter(n => n < up.to).join(' and ')} are not asked in that round.`);   // A-DRAFT (S7-1)
                continue;
              }
              log(`\n  layer 2 used its ${stop.bound} revision(s) and still objects, and no pass is left for layer 3 to review the plan: the run stops.`);   // A-DRAFT (S7-2)
            }
            // 0.8.4 M1 COMPLETE U2 (T4c; N5, the shipped form of CA1; HELD behind `layerOneGoUpLine`, WORDING D2-1): the AUTOMATIC go-up at layer 1's revision bound. Precedence: a recorded `finish` (above) first; a recorded legacy `send_up` for THIS stop takes the legacy block below (an older run keeps its trigger and lifetime: no double fire); then this.
            // Layer 1's open objections go up (only layer 1's: `layerOnly` 1 and the target from layer-1 failures, so a carried layer-2 objection cannot move it to layer 3), no revision is used, layer 2 reviews and rules in the next pass (the stall escalation's own machinery, the `sendUp` ruling variants), the pass after restarts at layer 1.
            // THE COUNT RULE LIVES HERE AND NOWHERE ELSE: this block assigns nothing to `ovState`, so layer 1's count `used[1]` STAYS at its bound (RU-S6-04): the restarted pass that objects again goes up again at once. The alternative ("layer 1 gets a fresh count after each ruling") is ONE line, after passUp(...): ovState = { ...ovState, used: { ...ovState.used, 1: 0 } };
            // With no pass left, or while the go-up line is held, the stop stands exactly as before.
            // GATE (A2, C&C 07 Nov 2026): the go-up fires only where its receiving layer is SHOWN the climb: layer 2's review section (N24) needs the ledger (answer_back, layered, >= 2 layers: `ledgerOn`) and the rating demand (`severityOn`). Elsewhere the stop stands exactly as before. The exchange's flagged climb is shown to nobody on a chain without them.
            if (layer1BoundGoUp(stop) && callGates.goUpOn && layerOneGoUpLineOn() && !roundChoices.some(c => c.choice === 'send_up' && c.stop === stopIdOf(stop))) {
              const up = layered && round < maxRounds ? escalationTarget({ failures: allFailures.filter(f => layerOf[f.lab] === 1), layerOf, layerNumbers }) : null;
              if (up) {
                passUp(up, 'layer1_bound', [round], null, 1);
                { const stoppedIds = (layerDebates.filter(d => d.pass === round && d.layer === 1).at(-1)?.objections ?? []).filter(x => x.outcome === 'unresolved_at_stop' && escalation.items.some(i => i.id === x.id)).map(x => x.id); if (stoppedIds.length) escalation.row.unresolved_at_bound = stoppedIds; }   // M1 COMPLETE U2-2 (W4, RU-S1-18/22): the objections still changing when layer 1's exchange stopped at its last round travel with the route mark; additive, only on this row
                log(held('layerOneGoUpLine')({ round, bound: stop.bound, count: escalation.items.length, to: up.to }));
                continue;
              }
            }
            // The person chose to SEND UP at this very stop (a layer-1 revision bound; run.json roundChoices): layer 1's open objections go up to layer 2 through the stall escalation's own path, no revision is used and the next pass asks layer 2
            // (it reviews the plan blind, then rules on them with the raiser hidden). A send_up entry at any other stop is ignored. With no pass left the stop stands.
            if (stop.kind === 'layer_bound' && stop.why === 'revisions' && stop.layer === 1 && roundChoices.some(c => c.choice === 'send_up' && c.stop === stopIdOf(stop))) {
              const up = layered && round < maxRounds ? escalationTarget({ failures: allFailures, layerOf, layerNumbers }) : null;
              if (up) {
                passUp(up, 'send_up', [round]);
                log(`\n  layer 1 used its ${stop.bound} revision(s) and still objects (${allFailures.length} objection(s)), and the person chose to send the plan up. No revision is used: in round ${round + 1} layer ${up.to} reviews the plan, then rules on these objection(s).`);   // A-DRAFT
                continue;
              }
              log(`\n  the person chose to send the plan up, but no pass is left for layer ${stop.layer + 1} to review it: the stop stands.`);   // A-DRAFT
            }
            if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'loop_ended', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; }   // a stopped run still shows the swing (the partial report carries decisions)
            throw new RoundStopped(stop);
          }
        }
      }

      // On the LAST pass there is no revise, so the swing is only recorded (`why: last_round`: no call, no pause), as the cap ends the run as it always did.
      if (conflictsNow.length && round === maxRounds) { recordUndecidedConflicts(conflictsNow, 'last_round', round, conflictOv); unhandledConflicts = null; }
      if (round === maxRounds) {
        log(allVotersClean
          ? `  round cap (${maxRounds}) reached: every lab that answered signed off clean, but ${unheard} never returned a readable verdict - this is NOT agreement. Read their raw reply (see report.json signoff[]) before treating this as passed.`
          : `  round cap (${maxRounds}) reached without unanimous signoff; open objections go into the report.`);
        if (layered && roundRows.some(r => r.state === 'not_asked')) {
          const never = roundRows.filter(r => r.state === 'not_asked').map(r => r.layer);
          log(`  ${never.length === 1 ? `layer ${never[0]} was` : `layers ${never.join(', ')} were`} never asked in the final round - this is NOT agreement.`);
        }
        roundCapReached = { round };
        break;
      }

      if (reaskNoRevise) {
        // Nothing to revise - no heard reviewer objected - so re-ask the same panel on the same
        // draft rather than treating silence as consent or revising what nobody objected to.
        log(loneHeard
          ? `\nRound ${round}: only one lab in the lowest layer returned a readable verdict, so its objections could not be debated (the exchange needs two) - they are recorded as not debated, and ${unheard} did not return a readable verdict: asking again on the unchanged draft.`   // A-DRAFT
          : nobodyHeardSilent ? `\nRound ${round}: no lab returned a readable verdict (${unheard} did not) - not agreement; asking again on the unchanged draft rather than declaring it.`   // A-DRAFT (a WORDING row, LAD-R42: a line in run.log when a silent judge is the only one asked and stays silent)
          : `\nRound ${round}: every lab that answered signed off clean, but ${unheard} did not return a readable verdict - asking again on the unchanged draft rather than declaring agreement.`);
        passed = false;
        // R1: the heard seats' clean verdicts carry into the next round, on this exact text only.
        carry = { shownDraft, byLab: new Map(verdicts.filter(v => !v.abstained).map(v => [seatKeyOf(v.seat), v])) };
        // Roadmap item 30 (found building item 27, 7 Oct 2026; Muad's yes via C&C): the answer-back data was set only at a revise, so an unheard judge asked again in the next round was
        // no longer shown its open objections nor had its answers read, and a plain clean sign-off passed the run. The draft is unchanged and nothing was revised, so the same data
        // still holds: it moves on to the next round, for the seats that will be asked again (report.json's answerBack says what each round showed, and to whom).
        // Only what is still open moves on: an objection the judge withdrew with a quote in a reply that was then not counted (refused for its table) is settled (final review, finding 3).
        if (retained) {
          // Layered (E3): the three sets, kept apart. HEARD clean: every id was answered with a quote or the verdict would have objected, so the entry goes. UNHEARD: it keeps what it still had open (an id withdrawn with
          // a quote in a reply that was read is settled). NOT ASKED (not among the verdicts): untouched. A stated pass with open objections cannot be here (it objects, so this branch is not taken).
          for (const v of verdicts) {
            const lab = seatKeyOf(v.seat);
            const entry = answerBackLatest[lab];
            if (!entry || v.carried) continue;
            if (v.critique) { if (!(loneHeard && v.critique.failures?.length)) delete answerBackLatest[lab]; }   // a heard seat that still objects (the lone heard judge) keeps its entry
            else if (v.abstained) {
              const objections = stillOpen(entry, answerBackReplies, { round, lab });
              if (objections.length) answerBackLatest[lab] = { ...entry, objections }; else delete answerBackLatest[lab];
            }
          }
        } else if (answerBackOn && answerBackRound === round) {
          const asked = {};
          for (const [lab, entry] of Object.entries(answerBackLatest)) {
            if (carry.byLab.has(lab)) continue; // heard and clean on this same text: not asked again
            const objections = stillOpen(entry, answerBackReplies, { round, lab });
            if (objections.length) asked[lab] = { ...entry, objections }; else delete answerBackLatest[lab];
          }
          Object.assign(answerBackLatest, asked);
          answerBackRound = round + 1;
          answerBackRecords.push(...answerBackSummary(round + 1, asked));
        }
        unhandledConflicts = null;   // the same panel is asked again on the unchanged draft (no revise here); a swing needs an OWN objection, so this branch is not reached with one in practice
        continue;
      }

      if (layered && !handlerBlocks && (sevRun ? severityMeets(allFailures) : allFailures.length === 0)) {   // unit 3: with the switch, "nothing to revise" = nothing that holds the sign-off (swept objections do not)
        // Invariant (backend rule 14): the reviser is entered only with something to fix. Every way to get here without an objection is a stop above; this one is the net under them.
        // UNREACHABLE TODAY, kept on purpose and untested (a test it cannot fail is no evidence; C&C ruling 14 Oct 2026). Why: allFailures is empty only when no voter objected and no stated pass carries an open objection (E3's `openOwn`
        // is folded into allFailures). reviewSeat never hands a voting critique that does not meet with an empty failures list to the round (normaliseCritique keeps an unlabelled objection, or returns its unreadable shape, which reviewSeat 4812-4817 turns into an abstention), so every voter is then clean:
        // the round either passes (allSignedOff) or stops above (no voter, not quorate, only stated passes, top layer not explicit, nothing to revise). It becomes reachable if a path ever lets a voter object with no failure
        // recorded, or if a failure is dropped between the critique and allFailures; this line is the guard that turns that into a recorded stop instead of an empty revise.
        const last = roundRows.filter(r => r.state !== 'not_asked').pop();
        layerStop = { round, layer: last.layer, reason: 'no_objection_to_revise', labs: last.labs, ...(last.seats ? { seats: last.seats } : {}) };
        log(`\n  round ${round}: nothing was objected to, so there is nothing to revise against. Stopping the loop; this is not agreement.`);
        passed = false;
        break;
      }
      // E4b unit 2: the conflict decider, between the verdicts and the revise. Its note (when the prompt is recorded and a ruling was read) joins the reviser's prompt after the objections.
      unhandledConflicts = null;   // handled just below (a ruling, or a recorded reason nobody ruled)
      const decisionNote = conflictsNow.length ? await decideConflicts(conflictsNow, round, conflictOv) : '';
      // 0.8.4 S9 (Q10, D8, D29; HELD behind the S9 words, WORDING S9-w1 .. w14): the top layer's DECISION-level objection that ended this overseer round goes back to the proposers (the return), or, on a chain with no proposer seat, to the writer with the contested entry in full.
      // ONE site for both the round that follows an overseer round and the round a --continue adds (the resume replays the stopped pass and advance() now answers revise; a first-sitting stop throws before this line). The classification is read from the top layer's
      // replies (`level`, `entry`, `choice`, `most_consequential`) and checked against the plan's own text (src/decision-entry.js): a mark that fails the check is NOT decision-level and goes to the writer as an ordinary objection, recorded as refused. No retry anywhere.
      let returnNote = '';
      if (returnTrigger && returnSlotFree(returnedInOv, returnTrigger.ovRound)) {
        const seatVerdicts = verdicts.filter(v => v.critique && !v.abstained && layerOf[seatKeyOf(v.seat)] === topLayer).map(v => { const lab = seatKeyOf(v.seat); return { lab, failures: (v.critique.failures || []).map(f => ({ ...f, id: objectionId(lab, f) })), mostConsequential: v.critique.most_consequential }; });
        const { marks, refused, named } = classifyDecisionObjections({ plan: shownDraft, verdicts: seatVerdicts });
        const firstRoundOf = (lab, id) => ledgerRaises.find(r => r.failures.some(f => f.lab === lab && f.id === id))?.round ?? round;   // the objection ledger's order: first round, lab, id (src/objection-ledger.js), over the FULL ledger
        const pick = selectReturnMark({ marks, named, rankOf: m => [firstRoundOf(m.lab, m.id), m.lab, m.id] });
        const base = { overseer_round: returnTrigger.ovRound, pass: round };
        for (const r of refused) {
          log(`  round ${round}: a decision-level objection (${r.id}) was not taken as one: ${refusalWords(r.reason, r.number)}; it goes to the writer as an ordinary objection.`);
          proposerReturns.push({ ...base, route: 'writer', status: 'refused', ...(Number.isInteger(r.number) ? { entry: r.number } : {}), objection_id: r.id, refused: r.reason });
        }
        if (pick) {
          returnedInOv.add(returnTrigger.ovRound);
          const { mark, selected_by } = pick; const f = mark.failure;
          const objection = { criterion: f.criterion, problem: f.problem, fix: f.fix };
          const facts = { entry: mark.number, entry_title: mark.entry.title, choice: mark.entry.choice, objection_id: mark.id, criterion: f.criterion, selected_by, writer_step: `revise-${round}` };
          const proposerSeats = callGates.proposerReturn ? proposerSeatsOf(config) : [];
          if (proposerSeats.length) {
            const out = await runProposerReturn({ seats: proposerSeats, ovRound: returnTrigger.ovRound, number: mark.number, entryText: mark.entry.text, choice: mark.entry.choice, objection, request, criteria, skeleton, plan: shownDraft, runId, shuffle: config.debate_hygiene?.shuffle === true },
              { invoke, record, settleAll, skipChosen, offerSkip, rethrowControlFlow, parseJson, noticeFor: (seat, ovRound) => excerptNoticeNote(seat, ovRound, 'proposer'), cap: (v, seat, label) => capField(v, { limit: boardTextLimit(seat.maxTokens), stage: label, field: 'return' }), log });
            log(`  proposer return for Decision ${mark.number}: ${out.alternatives.filter(a => a.status === 'readable').length} of ${proposerSeats.length} alternative(s) read.`);
            returnNote = out.note;
            proposerReturns.push({ ...base, route: 'proposers', status: out.status, ...facts, alternatives: out.alternatives, posts: out.posts, answers: out.answers, calls: out.calls });
          } else {
            log(`  round ${round}: Decision ${mark.number} is contested and the chain has no proposer seat: the objection goes to the writer with the entry in full.`);
            const note = held('noProposerRouteNote')?.({ number: mark.number, entryText: mark.entry.text, objection });
            returnNote = typeof note === 'string' ? note : '';
            proposerReturns.push({ ...base, route: 'writer', status: 'no_proposers', ...facts });
          }
        }
      }
      revisedRounds.push(round);   // this pass goes on to a revise (rule R's "a revise was made for another layer between b and c")
      log(`\nRound ${round}: revise (union of everything any lab flagged)`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const patchMode = config.revise?.mode === 'patch';
      // 0.8.2 wiring (P13, owner 7 Oct 2026): with answer_back.enabled the reviser is told each failure's objection id and the DECLINED form that carries it (ONE form: the held systems replace the sentence that gives it,
      // they do not add a second), so the judge that raised the objection is shown the reason next to it. Held (src/held-roles.js): `reviserSystemWithIds` / `patchReviserSystemWithIds` and `reviserIdsNote({ failures })`;
      // until the re-record each falls back to what has always been sent.
      const reviserSystemFor = patch => reviserSystemOf(answerBackOn, patch);
      const exchangeItems = layerExchangeNow?.pass === round ? layerExchangeNow.items.filter(it => actionable.some(f => f.id === it.id)) : [];   // B2: what the layer's judges said about the objections that stand
      const idsNote = [answerBackOn ? (held('reviserIdsNote')?.({ failures: actionable }) ?? '') : '', answerBackOn && fixNoteOn() ? (held('writerFixNote')() ?? '') : '', decisionNote, returnNote, earlyEligible() ? (held('reviserEarlyFinishNote')() ?? '') : '', exchangeItems.length ? R.layerExchangeReviseNote({ items: exchangeItems, severity: !!sevRun}) : '', handlerBlocks ? (held('buildCheckReasonsNote')?.({ reasons: handlerBlocks.reasons }) ?? '') : ''].filter(Boolean).join('\n\n');   // 0.8.4 S4: the handler's not_yet reasons are open points of this revision (W33)
      const notesReviseNote = reviseNotesNote(); // 2b-1a: AFTER the objections (they decide the verdict; a long notes list must not crowd them out)
      const revised = (await draftStage(reviserSeat, {
        system: withSeveritySentence(config, withSplitNote(reviserSystemFor(patchMode)(open, !!fencedSource, promptOpts), 'treeSplitWriterNote')),
        user: swapProposalsSection(R.reviserUser({ request, criteria, draft, critique: { failures: sevShown(actionable) }, proposals, board, severity: severityOn }), proposals, board) + priorLedgerNote() + (idsNote ? `\n\n${idsNote}` : '') + notesReviseNote + rulingsNote(round),
        log, label: `revise-${round}`,
      })).text;
      const parsedRevise = parseDisputes(revised, { withIds: answerBackOn });
      let ledgerFrom = parsedRevise; let ledgerStage = `revise-${round}`;   // the reply that BECAME the draft is the one whose ledger counts (the full rewrite replaces a patch reply)
      if (notesOn) { recordNoteAnswers(parsedRevise.noteLines, `revise-${round}`); notesShownThrough = round; } else noteLinesIgnored('revise', parsedRevise.noteLines, log);
      let earlyReason = parsedRevise.earlyFinish;

      // Patch mode: apply the edits locally so untouched text is byte-identical by
      // construction. Any block that does not apply cleanly falls back to one full rewrite -
      // the fallback is the feature, since whether real models produce verbatim anchors is
      // UNVERIFIED and cannot be tested offline.
      if (patchMode) {
        const patches = parsePatches(parsedRevise.draft);
        const applied = applyPatches(draft, patches);
        if (applied.ok) {
          log(`  patch mode: applied ${applied.applied} edit(s); the rest of the draft is unchanged, byte for byte.`);
          parsedRevise.draft = applied.text;
          lastPatches = patches;
        } else {
          log(`  patch mode: ${applied.reason} - falling back to one full rewrite for this round.`);
          patchFallbacks.push({ round, reason: applied.reason });
          const full = (await draftStage(reviserSeat, {
            system: withSeveritySentence(config, withSplitNote(reviserSystemFor(false)(open, !!fencedSource, promptOpts), 'treeSplitWriterNote')),
            user: swapProposalsSection(R.reviserUser({ request, criteria, draft, critique: { failures: sevShown(actionable) }, proposals, board, severity: severityOn }), proposals, board) + priorLedgerNote() + (idsNote ? `\n\n${idsNote}` : '') + notesReviseNote + rulingsNote(round),
            log, label: `revise-${round}-full`,
          })).text;
          const reparsed = parseDisputes(full, { withIds: answerBackOn });
          ledgerFrom = reparsed; ledgerStage = `revise-${round}-full`;
          earlyReason = reparsed.earlyFinish;   // the full rewrite REPLACES the patch reply: the session's final word is the one in the reply that became the draft
          if (notesOn) recordNoteAnswers(reparsed.noteLines, `revise-${round}-full`); else noteLinesIgnored('revise-full', reparsed.noteLines, log);
          parsedRevise.draft = reparsed.draft;
          reparsed.disputes.forEach((r, k) => { parsedRevise.disputes.push(r); parsedRevise.disputeIds.push(reparsed.disputeIds[k]); });
          lastPatches = null;
        }
      }
      // 0.8.4 S4 (Q-l, W34, T19a/T19l): the writer's fix note of this pass, from the lines of the reply that became the draft (and its DECLINED lines) and from nothing else; recorded only while the wording is recorded. The other revise stages
      // (the dispute rewrite, the challenge's revise, the deep dive's revise, the allocator) do not carry the sentence and never read the field.
      if (answerBackOn && fixNoteOn()) {
        const note = writerNoteRows({ failures: actionable, fixTaken: ledgerFrom.fixTaken ?? [], declined: parsedRevise.disputes, declinedIds: parsedRevise.disputeIds });
        if (note.rows.length) writerNotes.push({ pass: round, stage: ledgerStage, rows: note.rows });
        if (note.dropped.length) log(`  ${ledgerStage}: ${note.dropped.length} fix line(s) named no objection of this pass and were left out of the record (${note.dropped.join(', ')}).`);
      }
      takeLedger(ledgerFrom, ledgerStage, proposals.length > 0);
      // ROADMAP 83: the session's proposal. The list the overseer reads is DERIVED from the pass that triggered this revise (every objection of it, the stated passes' own open ones included), never from the session's words: the
      // session's reason is its own claim and is recorded as model-supplied. Each item says what the revise did with it.
      if (typeof earlyReason === 'string' && earlyReason) {
        if (earlyEligible()) {
          const draftChanged = parsedRevise.draft !== draft;
          const passItems = actionable.map(f => { const k = parsedRevise.disputeIds.indexOf(f.id); return { id: f.id, lab: f.lab, criterion: f.criterion, problem: f.problem, handled: k >= 0 ? 'declined' : !answerBackOn ? 'open' : draftChanged ? 'changed' : 'unchanged', ...(k >= 0 ? { declined_reason: parsedRevise.disputes[k] } : {}) }; });
          // 0.8.4 round 1 (P2, held fix): the list is EVERY objection open in the record at this point, not only the ones this pass raised: an objection raised in an earlier pass that nobody closed (a layer the ladder did not ask in this pass, a layer that signed off with it still standing) is open too, and is a task for the builder like the rest.
          // The same reader as the build check's and the sorting's list (openAtAgreement: the ledger's active rows, the rulings that closed one taken out, the rating in force). A row this pass already lists keeps its own line; the others are added with `handled: 'open'` (what this revision did with them is not recorded), in the order of their ids.
          const onList = new Set(passItems.map(i => `${i.lab}\u0000${i.id}`));
          const criterionOf = (lab, id) => { for (let k = ledgerRaises.length - 1; k >= 0; k--) { const f = (ledgerRaises[k].failures || []).find(x => x.lab === lab && x.id === id); if (f) return f.criterion; } return undefined; };
          const earlierItems = openAtAgreement({ round, failures: actionable }).filter(r => !onList.has(`${r.lab}\u0000${r.id}`)).map(r => ({ id: r.id, lab: r.lab, criterion: criterionOf(r.lab, r.id) ?? '', problem: r.problem, handled: 'open', earlier: true }));
          const items = [...passItems, ...earlierItems];
          const text = (held('earlyFinishAskSectionOpen') ?? held('earlyFinishAskSection'))({ reason: R.claimText(earlyReason), items: items.map(i => ({ id: i.id, lab: i.lab, handled: i.handled, criterion: R.claimText(i.criterion ?? ''), problem: R.claimText(i.problem ?? ''), ...(i.earlier ? { earlier: true } : {}), ...(i.declined_reason !== undefined ? { declined_reason: R.claimText(i.declined_reason) } : {}) })) });
          earlyAsk = { text, reason: String(earlyReason).slice(0, 1000), record: items.map(i => ({ id: i.id, lab: i.lab, handled: i.handled, ...(i.earlier ? { earlier: true } : {}), ...(typeof i.declined_reason === 'string' && i.declined_reason ? { declined_reason: i.declined_reason.slice(0, 600) } : {}) })), tasks: items };
          carry = null;   // every overseer seat reads the proposal itself: a clean verdict carried from an earlier pass is never an answer to it
          log(`  revise-${round}: the session proposes an early finish with ${items.length} open objection(s). The next pass asks only the overseer layer whether to finish early.`);
        } else log(`  revise-${round}: an EARLY-FINISH line was in the reply and was not acted on (it needs a layered chain with overseer rounds and the session as its reviser).`);
      }
      if (retained) {
        // Layered (E3): the map persists. Labs HEARD this round (they gave a critique) get this round's failures as their new entry, drawn from the text they just judged (`sawDraft` = shownDraft); a heard-clean lab has none, so
        // its entry goes. A lab that STATED A PASS while holding open objections keeps its entry (raised_round and the text it last judged), refreshed with the writer's reasons from this revise and joined by any objection it was given this pass (the one it named in an exchange post, M0 FIX-UP 2). An UNHEARD lab keeps
        // what it still had open. A NOT-ASKED lab's entry is left exactly as it was. Nothing is written to the run's records here: the summary rows are written when a lab is shown the section.
        const built = buildAnswerBack({ failures: actionable, declined: parsedRevise.disputes, declinedIds: parsedRevise.disputeIds, oldDraft: draft, newDraft: parsedRevise.draft });
        const passedOpen = new Set(verdicts.filter(v => openOwnOf(v).length).map(v => seatKeyOf(v.seat)));
        for (const v of voting) delete answerBackLatest[seatKeyOf(v.seat)];
        for (const [lab, b] of Object.entries(built)) {
          if (passedOpen.has(lab) && answerBackLatest[lab]) {
            const kept = answerBackLatest[lab];
            // M0 FIX-UP 2 (item 1): an objection this pass added for the lab that is not in the kept entry (the one a stated pass named in an exchange post, M0 FIX 10) JOINS it: the lab is shown it next time, like the ones it already held.
            const joined = b.objections.filter(o => !kept.objections.some(x => x.id === o.id)).map(o => ({ ...o, raised_round: actionable.find(f => f.lab === lab && f.id === o.id)?.carried_from_round ?? round }));
            answerBackLatest[lab] = { ...kept, declined: b.declined, objections: [...kept.objections.map(o => { const reason = b.objections.find(x => x.id === o.id)?.declined_reason; return reason ? { ...o, declined_reason: reason } : o; }), ...joined] };
          } else {
            answerBackLatest[lab] = { ...b, sawDraft: shownDraft, objections: b.objections.map(o => ({ ...o, raised_round: actionable.find(f => f.lab === lab && f.id === o.id)?.carried_from_round ?? round })) };
          }
        }
        for (const v of verdicts.filter(v => v.abstained)) {
          const lab = seatKeyOf(v.seat);
          const entry = answerBackLatest[lab];
          if (!entry) continue;
          const objections = stillOpen(entry, answerBackReplies, { round, lab });
          if (objections.length) answerBackLatest[lab] = { ...entry, objections }; else delete answerBackLatest[lab];
        }
      } else if (answerBackOn) {
        // Final review of items 27/28/30 (7 Oct 2026), finding 1: a judge UNHEARD this round keeps its still-open objections (those it was shown this round, minus any it withdrew with a
        // quote in a reply that was not counted). They go to the judge again next round, not into the reviser's list above: nothing re-raised them this round, and the judge answers first.
        const keptOpen = answerBackRound === round
          ? verdicts.filter(v => v.abstained).flatMap(v => stillOpen(answerBackLatest[seatKeyOf(v.seat)], answerBackReplies, { round, lab: seatKeyOf(v.seat) }).map(o => ({ ...o, lab: seatKeyOf(v.seat) })))
          : [];
        answerBackLatest = buildAnswerBack({ failures: [...actionable, ...keptOpen], declined: parsedRevise.disputes, declinedIds: parsedRevise.disputeIds, oldDraft: draft, newDraft: parsedRevise.draft });
        answerBackRecords.push(...answerBackSummary(round + 1, answerBackLatest)); // shown to the judge in the NEXT round
        answerBackRound = round + 1;
      }
      draftChangedByRound[round] = parsedRevise.draft !== draft; // E4: did this revise change the draft at all (not: did it fix a given objection)
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach((reason, k) => disputes.push({ round, reason, ...(parsedRevise.disputeIds[k] ? { objection_id: parsedRevise.disputeIds[k] } : {}) }));
      passed = false;
      // Stall escalation, the floor (C&C ruling 4 of 27 Okt 2026, REVERSED for a stall by 0.8.4 S5: a stall escalation lasts ONE pass and is cleared at the top of the pass after it, see escalationLastsOnePass). This clearing now matters for the person's
      // send-up only, which keeps its lifetime as built: the layers below it wait until the top layer gives a verdict; when the top layer objected in this pass and the writer has revised for it, the next pass climbs from layer 1 again,
      // as a new overseer round does. The escalation's record stays in `escalations`.
      if (escalation && (handlerBlocks || roundRows?.find(r => r.layer === topLayer)?.state === 'objected')) {   // 0.8.4 S4: the handler's not_yet is the top layer's verdict going back into revision too (T15b)
        log(`  the top layer gave its verdict: from round ${round + 1} the climb starts again at layer ${layerNumbers[0]}, and the layers that waited are back in it.`);   // A-DRAFT
        escalation = null;
      }

      // v7.3: resource allocator - one extra, targeted round on top of the
      // uniform revise above, spent only where the panel actually disagreed
      // this round. Gated on config.allocator.enabled (chain-lint.js fails
      // any config that sets it without signoff: 'unanimous', since the
      // disagreement signal below doesn't exist under round-robin signoff).
      if (config.allocator?.enabled) {
        const contested = pickContestedCriterion(voting);
        if (contested) {
          log(`\nRound ${round} allocator: targeting the panel's most contested criterion (${contested.failedBy.length}/${contested.votingCount} critics FAILED it) for one extra round.`);
          // v7.3 item 3: fire item 1's tool-grounded verification dynamically,
          // scoped to this specific contested claim, rather than only the
          // config-declared-up-front verify.tools set every run always runs
          // regardless of relevance. A tool fires only if one of
          // allocator.tools names a keyword that appears in the contested
          // criterion's own text.
          let toolFired = null;
          let groundTruthBlock = '';
          const spec = (config.allocator.tools || []).find(t =>
            (t.keywords || []).some(k => contested.criterion.toLowerCase().includes(String(k).toLowerCase())));
          if (spec) {
            const runTool = config.verify?.runTool || defaultRunTool;
            const cwd = config.allocator.cwd || config.verify?.cwd || process.cwd();
            const result = runTool(spec.tool, spec.args || {}, { cwd });
            log(`  allocator verification: ${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''} -> ${result.ok ? 'ok' : `error - ${result.error}`}`);
            toolFired = { tool: spec.tool, args: spec.args || {}, result };
            groundTruthBlock = `\n\n# Ground truth for the contested claim (tool output, verbatim)\n## ${spec.tool}${spec.args ? ` ${JSON.stringify(spec.args)}` : ''}\n${JSON.stringify(result)}`;
          }
          const draftBefore = draft;
          const targeted = (await draftStage(reviserSeat, {
            system: reviserSystemOf(false, false)(open, !!fencedSource, promptOpts),
            user: R.reviserUser({
              request, criteria, draft,
              critique: { failures: [{
                criterion: contested.criterion,
                problem: `The panel split on this criterion this round: ${contested.failedBy.length} of ${contested.votingCount} voting critics marked it FAILED, the rest did not.`,
                fix: '',
              }] },
            }) + groundTruthBlock,
            log, label: `allocator-${round}`,
          })).text;
          const parsedTargeted = parseDisputes(targeted);
          takeLedger(parsedTargeted, `allocator-${round}`, false);
          noteLinesIgnored('allocator', parsedTargeted.noteLines, log);
    earlyFinishIgnored('allocator', parsedTargeted.earlyFinish, log);
          draft = parsedTargeted.draft;
          parsedTargeted.disputes.forEach(reason => disputes.push({ round: `allocator-${round}`, reason }));
          // v7.3 item 4: the falsification watch this stage's own proposal
          // flagged as required, not optional. A targeted round that leaves
          // the draft byte-for-byte unchanged is the same rubber-stamping
          // signature item 3's descending-rounds falsifier watches for -
          // recorded here, never hidden, and exposed across runs in
          // metrics.js's allocator rubber-stamp rate.
          const engaged = draft !== draftBefore;
          log(`  allocator round ${engaged ? 'changed the draft (engaged)' : 'left the draft byte-for-byte unchanged (rubber-stamp signature)'}.`);
          allocatorRounds.push({
            round,
            criterion: contested.criterion,
            failedBy: contested.failedBy,
            votingCount: contested.votingCount,
            tool: toolFired ? toolFired.tool : null,
            engaged,
          });
        }
      }
      } catch (secretErr) {
        // 0.8.4 (found-secret pause, --finish): the stage that was paused at a credential-shaped string is the first call of this sitting that missed the cache while the person's recorded finish is armed (invoke, before the scan).
        // It was not sent. The loop ends HERE and the ordinary NOT-agreed ending runs after it, exactly as after a round-stop finish (finishedStop is the one variable everything after the loop reads).
        if (!(secretErr instanceof SecretFinish)) throw secretErr;
        passed = false;
        // This catch is reached for a throw OUTSIDE the layer loop of a layered pass (the pass's panel is recorded, or none of it started) and anywhere in an unlayered pass. A throw INSIDE the layer loop
        // is the inner catch (below), which folds the layers already answered first, as the ledger stop does (C-004).
        finishedStop = secretStopFor(round, secretErr.label, secretErr);
        log(secretErr instanceof SpendFinish ? `\n  finishing at the person's choice: the spending limit stopped the run at stage "${secretErr.label}", before its next call was paid for; this is NOT agreement.` : `\n  finishing at the person's choice: the run was paused at a credential-shaped string in stage "${secretErr.label}"; this is NOT agreement.`);   // WORDING S16-w67
        break;
      }
    }
    scanPhase = 'after';
    if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'loop_ended', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; }   // the loop was left (a stall, a layer stop, the person's finish) with a swing in its last pass
  } else {
    // 0.8.4 FM-critic (R500, Muad's pick): the first-mode critic gets what the unanimous panel's seats get (the quote rule when the request has fenced source, the criteria-kinds rule, the chain's own freedoms): the SAME object as the panel's (above, "const freedoms"), at both critic calls (the call and its cut-off retry). Unfenced and without freedoms it is { fencedSource: false }, which criticSystem reads exactly as no object.
    const critiqueFreedoms = { ...(config.freedoms || null), fencedSource: !!fencedSource, ...(excerptsMayBeShown ? { excerptsMayBeShown: true } : {}), ...(textRequestsOpen ? { textRequestsMayBeAsked: true } : {}), ...(checks ? { criteriaKinds: true } : {}) };
    scanPhase = 'loop';
    for (let round = 1; round <= maxRounds; round++) {
      try {
        passOv = ovOn ? ovState.overseerRound : 0;
      // #16c: the owner's pause (as in the unanimous loop): first, before the "Round" line and the critique call.
      if (round > 1) { const ownerFinish = ownerPauseFinishAt(round); if (ownerFinish) { passed = false; if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'loop_ended', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; } finishedStop = ownerFinish; log(`\n  finishing at the person's choice${ownerFinish.finished_at_once ? ', at once' : ''}${relayedTail(ownerFinish)}: the run was paused before pass ${round}; this is NOT agreement${ownerFinish.finished_at_once ? ', and no judge reads the plan again' : ''}.`); break; } const due = pauseCheck(round); if (due) { passed = false; if (unhandledConflicts) { recordUndecidedConflicts(unhandledConflicts.found, 'loop_ended', unhandledConflicts.round, unhandledConflicts.ov); unhandledConflicts = null; } throw new RoundStopped({ kind: 'owner_pause', pass: round, overseer_round: ovCompleted, request_seq: due.request_seq }); } }
      const criticSeat = config.seats.critics[(round - 1) % config.seats.critics.length];
      log(`\nRound ${round}: critique`);
      let cs;
      let rrEnv = null; // the pair the reply held in `cs` was asked under (E3b)
      let rrPrompt = null; // 2 Nov 2026: the strings the call that produced `cs` was sent (a near-JSON pause is held to their hash on resume)
      try {
        const cu = { request, criteria, draft: boundedDraft(draft, endMarkerOn), checks, endMarker: endMarkerOn };   // 0.8.4 D38: ONE arguments object for the prompt and for the head the excerpt block follows (R.criticUserHead of the same arguments)
        const env = withEnvelope(`critique-${round}`, draft, R.criticUser(cu) + excerptNoticeNote(criticSeat, round));
        rrEnv = env.expect;
        rrPrompt = judgePrompt({ config, seat: criticSeat, kind: 'panel', compose: () => criticPromptFor(criticSeat, open, critiqueFreedoms, config), user: env.user, head: R.criticUserHead(cu), headArgs: cu, endMarker: endMarkerOn });   // cache part (b)1: the cache-shaped order where it is live (src/cache-order.js), else exactly the old pair
        cs = record(await invoke(criticSeat, {
          system: rrPrompt.system,
          user: rrPrompt.user,
          blockAfter: rrPrompt.head ?? R.criticUserHead(cu),
          ...(rrPrompt.laid ? { cacheHead: rrPrompt.head, shownSystem: rrPrompt.shownSystem } : {}),
          log, label: `critique-${round}`,
        }));
      } catch (err) {
        // v7 item 2: a provider failure here used to propagate straight out of runChain and
        // crash the whole run (a real paid run was lost to exactly this). Gated on
        // degrade_on_provider_error so a chain that doesn't opt in reproduces today's crash
        // exactly.
        rethrowControlFlow(err);
        if (!config.degrade_on_provider_error) throw err;
        // Bug audit 2026-09-28 (area 3 #2.6): this said [COUNCIL-E005], the catalog's "Policy refusal".
        log(`  ${criticSeat.provider}/${criticSeat.model}: provider failure (${String(err.message).slice(0, 120)}) - seat dropped, not counted as a pass or an objection.`);
        dropouts.push({ lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, stage: `critique-${round}`, reason: `provider failure: ${String(err.message).slice(0, 200)}` });
        panelVerdicts.push({ round, lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: 'SEAT_UNREACHABLE', reasked: false });
        lastCritique = { meets: false, dropped: true, failures: [{
          criterion: '(critic seat dropped)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} call failed (provider error) and was degraded to a dropped seat rather than crashing the run.`,
        }] };
        break;
      }

      let parsed = parseJson(cs.text, { verdict: true, ...(rrEnv ? { expect: rrEnv } : {}) });
      // Verify pass 2026-09-28 F2: M3/M4 held only on the unanimous panel, so in `first` mode a
      // cut-off or provider-ended `meets:true` still passed the run. The same rules here: one
      // bigger-cap retry for a reply cut off at its cap (parsed or not), falling back to a parsed
      // first reply; then a sign-off still cut off, or ended with error/content_filter/refusal, is
      // no verdict (below). A pasted external reply carries no stop: no-op.
      let critCap = criticSeat.maxTokens ?? DEFAULT_MAX_TOKENS;
      // 0.8.1 R review: start from the cap the reply was really asked at (an Anthropic seat's invoke() may already have retried at the bigger
      // cap) and skip the retry when it has no room: it would repeat the same paid call.
      const fromCap = cs.cappedAt ?? critCap;
      if ((parsed ? providerCutOff(cs.usage) : true) && abstentionReasonCode(cs.usage, askedCapOf(cs, critCap)) === 'REPLY_TRUNCATED'
        && cutOffRetryCap(fromCap, retryCeilingOf(criticSeat)) > fromCap) {
        const firstParsed = parsed, firstCs = cs, firstCap = critCap, firstEnv = rrEnv;
        const biggerCap = cutOffRetryCap(fromCap, retryCeilingOf(criticSeat));
        log(`  critic reply cut off at ${fromCap} tokens - asking once more with a ${biggerCap}-token cap.`);
        try {
          const cu = { request, criteria, draft: boundedDraft(draft, endMarkerOn), checks, endMarker: endMarkerOn };   // 0.8.4 D38: ONE arguments object for the prompt and for the head the excerpt block follows (R.criticUserHead of the same arguments)
          const env = withEnvelope(`critique-${round}-retry`, draft, R.criticUser(cu) + excerptNoticeNote(criticSeat, round));
          rrEnv = env.expect;
          rrPrompt = judgePrompt({ config, seat: criticSeat, kind: 'panel', compose: () => criticPromptFor(criticSeat, open, critiqueFreedoms, config), user: env.user, head: R.criticUserHead(cu), headArgs: cu, endMarker: endMarkerOn });
          cs = record(await invoke(keepSeatKey(criticSeat, { ...criticSeat, maxTokens: biggerCap }), {
            system: rrPrompt.system,
            user: rrPrompt.user,
            blockAfter: rrPrompt.head ?? R.criticUserHead(cu),
            ...(rrPrompt.laid ? { cacheHead: rrPrompt.head, shownSystem: rrPrompt.shownSystem } : {}),
            log, label: `critique-${round}-retry`,
          }));
          critCap = biggerCap;
          parsed = parseJson(cs.text, { verdict: true, ...(rrEnv ? { expect: rrEnv } : {}) });
          if (!parsed && firstParsed) { parsed = firstParsed; cs = firstCs; critCap = firstCap; rrEnv = firstEnv; }
        } catch (err) {
          rethrowControlFlow(err);
          rrEnv = firstEnv;
          log(`  the bigger-cap retry failed (${String(err.message).slice(0, 120)}) - keeping the first reply.`);
        }
      }
      // 0.8.4 FM-critic (R534, Muad: "A"): the person's two freedoms (chain.freedoms) on a turn-taking chain, handled on the raw reply as the unanimous panel does (it reads `parsed` before normaliseCritique; neither normaliseCritique nor markFailures changes).
      // A BLOCKING QUESTION (freedoms.blocking_questions): the builder seat answers (`critique-<r>-question`) and this critic is asked once more with the answer shown (`critique-<r>-answered`): two paid calls, both through invoke() and so under the cap; at most one question per round.
      let questionFailure = null;
      if (parsed && critiqueFreedoms.blocking_questions && parsed.blocking_question) {
        try {
          log(`  ${criticSeat.provider}/${criticSeat.model}: blocking question - ${parsed.blocking_question}`);
          const proposerSeat = config.seats.builder || config.seats.reviser;
          const answer = record(await invoke(proposerSeat, {
            system: R.BLOCKING_ANSWER_SYSTEM,
            user: R.blockingAnswerUser({ request, draft, question: parsed.blocking_question }),
            log, label: `critique-${round}-question`,
          }));
          log(`  ${proposerSeat.provider}/${proposerSeat.model}: answered - ${answer.text}`);
          const answeredQuestion = { question: parsed.blocking_question, answer: answer.text };
          const cu = { request, criteria, draft: boundedDraft(draft, endMarkerOn), checks, answeredQuestion, endMarker: endMarkerOn };   // 0.8.4 D38: ONE arguments object for the prompt and for the head the excerpt block follows (R.criticUserHead of the same arguments)
          const env = withEnvelope(`critique-${round}-answered`, draft, R.criticUser(cu) + excerptNoticeNote(criticSeat, round));
          rrEnv = env.expect;
          rrPrompt = judgePrompt({ config, seat: criticSeat, kind: 'panel', compose: () => criticPromptFor(criticSeat, open, critiqueFreedoms, config), user: env.user, head: R.criticUserHead(cu), headArgs: cu, endMarker: endMarkerOn });
          cs = record(await invoke(criticSeat, { system: rrPrompt.system, user: rrPrompt.user, blockAfter: rrPrompt.head ?? R.criticUserHead(cu), ...(rrPrompt.laid ? { cacheHead: rrPrompt.head, shownSystem: rrPrompt.shownSystem } : {}), log, label: `critique-${round}-answered` }));
          parsed = parseJson(cs.text, { verdict: true, ...(rrEnv ? { expect: rrEnv } : {}) });
        } catch (err) {
          // The same guard as the critic call above (v7 item 2): a provider failure on either of the two extra calls degrades to a dropped seat on a chain that opts in; otherwise it propagates as it does for the critique call.
          rethrowControlFlow(err);
          if (!config.degrade_on_provider_error) throw err;
          questionFailure = err;
        }
      }
      if (questionFailure) {
        log(`  ${criticSeat.provider}/${criticSeat.model}: provider failure (${String(questionFailure.message).slice(0, 120)}) - seat dropped, not counted as a pass or an objection.`);
        dropouts.push({ lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, stage: `critique-${round}`, reason: `provider failure: ${String(questionFailure.message).slice(0, 200)}` });
        panelVerdicts.push({ round, lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: 'SEAT_UNREACHABLE', reasked: false });
        lastCritique = { meets: false, dropped: true, failures: [{
          criterion: '(critic seat dropped)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} call failed (provider error) and was degraded to a dropped seat rather than crashing the run.`,
        }] };
        break;
      }
      if (!parsed) {
        // 2 Nov 2026 (near-JSON pause, nearJsonPause): an almost-JSON verdict pauses the run for a repair instead of stopping this round without a verdict. A single critic runs alone, so there is no sibling to settle.
        const nearJson = rrPrompt && nearJsonPause(cs, { model: criticSeat.model, maxTokens: critCap }, rrPrompt.system, sentUserOf(cs, rrPrompt.user), rrPrompt.shownSystem);
        if (nearJson) { log(`  critic reply is almost JSON and could not be read - the run pauses for a repair (${nearJson.label}).`); throw nearJson; }
        // Previously logged "treating the round as a pass and stopping" while leaving `passed`
        // at its prior value and `lastCritique` untouched - the log claimed a pass that never
        // happened, and the report came out as passed:false with no recorded reason at all
        // (found for real 2026-09-10: three separate Sophi-A runs stopped exactly here, silent).
        // Deliberately NOT treated as a real pass - a critic's reply we can't parse might be
        // hiding a genuine objection, and this chain's whole value is not letting that slip
        // through. `passed` keeps whatever it already was (false unless an earlier round already
        // passed); what changes is that the report now says why, instead of nothing.
        const rrWhy = envelopeWhyOf(cs, askedCapOf(cs, critCap), rrEnv); // E3b: see envelopeWhyOf
        panelVerdicts.push({ round, lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: abstentionReasonCode(cs.usage, askedCapOf(cs, critCap)), ...(cs.noAnswer ? { no_answer: cs.noAnswer } : {}), ...(rrWhy ? { envelope: rrWhy } : {}), reasked: false });
        // E3b unit three: a well-formed reply that only lacks the ids is not "unparseable": the held sentence replaces the false text (log, label and problem) ONLY when the envelope is the reason.
        const rrSentence = rrWhy && held('criticEnvelopeUnreadableWhy')?.({ kind: rrWhy });
        log(rrSentence ? `  critic reply: ${rrSentence}; stopping without a verdict from this critic - not a pass, not counted as an objection either.`
          : `  critic reply could not be parsed as JSON even after repair attempts; stopping ` +
          `without a verdict from this critic - not a pass, not counted as an objection either.`);
        lastCritique = { meets: false, failures: [{
          criterion: rrSentence ? (held('criticEnvelopeUnreadableLabel')?.() || '(critic reply unparseable)') : '(critic reply unparseable)',
          problem: rrSentence ? `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply: ${rrSentence} - no verdict was recovered from it.`
            : `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply could not ` +
            `be parsed as JSON even after repair attempts - no verdict was recovered from it.`,
        }] };
        break;
      }
      // A STATED PASS (freedoms.pass), ruling A: a critic that declines does not stop the run. It is recorded as 'passed' with its reason (additive pass_reason), the plan is NOT revised, the next critic reads it unchanged and the round counts toward the round limit; if every critic declines the run ends at its limit with no verdict. The log words are the panel's ("PASSED - <reason>").
      if (critiqueFreedoms.pass && parsed.pass) {
        const passReason = capField(parsed.pass_reason, { stage: `critique-${round}`, field: 'pass_reason' }) || '';
        log(`  ${criticSeat.provider}/${criticSeat.model}: PASSED - ${parsed.pass_reason || '(no reason given)'}`);
        panelVerdicts.push({ round, lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'passed', reason_code: null, pass_reason: passReason, reasked: false });
        lastCritique = { meets: false, declined: true, failures: [] };   // nothing of an earlier round (against an earlier draft) is presented as open
        history.push(`## Round ${round} critique (${criticSeat.provider}/${criticSeat.model})\npassed (declined to give a verdict) - ${passReason || '(no reason given)'}`);
        if (round === maxRounds) { log(`  round cap (${maxRounds}) reached; no critic gave a verdict on this draft.`); break; }
        continue;
      }
      let critique = normaliseCritique(parsed, log, { stage: `critique-${round}`, criteria });
      if (critique.unreadable) {
        // Parsed, but no verdict in it - handled exactly like the unparseable reply above: not a
        // pass, not an objection, and the run stops saying why (bug audit 2026-09-23).
        panelVerdicts.push({ round, lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: abstentionReasonCode(cs.usage, askedCapOf(cs, criticSeat.maxTokens)), ...(cs.noAnswer ? { no_answer: cs.noAnswer } : {}), reasked: false });
        log(`  critic reply states no verdict (${critique.unreadableWhy}); stopping without a verdict from this critic - not a pass, not counted as an objection either.`);
        lastCritique = { meets: false, failures: [{
          criterion: '(critic reply stated no verdict)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply parsed but stated no verdict: ${critique.unreadableWhy}.`,
        }] };
        break;
      }
      if (critique.meets && (draftIncomplete(cs.usage) || providerCutOff(cs.usage))) {
        // F2, continued: a sign-off the provider ended early is not a pass. Handled like the
        // unreadable reply above: no verdict from this critic, and the run stops saying why.
        const stopped = draftIncomplete(cs.usage);
        const reasonCode = stopped ? abstentionReasonCode(cs.usage, askedCapOf(cs, critCap))
          : (abstentionReasonCode(cs.usage, askedCapOf(cs, critCap)) === 'REASONING_EXHAUSTED' ? 'REASONING_EXHAUSTED' : 'REPLY_TRUNCATED');
        panelVerdicts.push({ round, lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: 'unheard', reason_code: reasonCode, ...(cs.noAnswer ? { no_answer: cs.noAnswer } : {}), reasked: false });
        log(`  [COUNCIL-E004] critic reply signs off but ${stopped ? `the provider ended it with stop "${cs.usage.stop}"` : `was cut off at the cap (stop: ${cs.usage.stop})`}; stopping without a verdict from this critic - not a pass.`);
        lastCritique = { meets: false, failures: [{
          criterion: '(critic sign-off incomplete)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply signed off, but ${stopped ? `the provider ended it with stop "${cs.usage.stop}"` : 'it was cut off at its token cap'}, so it is not a pass.`,
        }] };
        break;
      }
      // 0.8.4 FM-critic: the quote check the unanimous panel runs on every verdict (markFailures, quoteWarnings and quoteFindings at "allFailures" above). With fenced source each failure is marked verified, unverified or unquoted against the text this critic was shown; the reviser's prompt prints the mark (src/prompts/core.js), each warning goes to the run log and to quoteFindings in the report. No fenced source: nothing changes.
      if (fencedSource || excerptsForQuotes().length) {   // 0.8.4 A7
        critique = { ...critique, failures: markFailures(critique.failures, fencedSource, draft, excerptsForQuotes(), { request, criteria, rows: failedRowsOf(critique) }) };
        for (const w of quoteWarnings(critique.failures.filter(f => f.quote_status), `${criticSeat.provider}/${criticSeat.model}`, { fenced: !!fencedSource })) { log(`    QUOTE: ${w}`); quoteFindings.push(w); }
      }
      lastCritique = critique;
      collectTextRequests(round, [{ seat: criticSeat, critique, stage: cs?.label || `critique-${round}` }]);   // 0.8.4 D18: the first-mode critic's requests, listed at this pass's revise pause like the panel's
      passReviewed = round;
      noteMissingRows(critique, round, seatKeyOf(criticSeat));
      if (checks) noteUnevidenced(critique, round, seatKeyOf(criticSeat), log);
      panelVerdicts.push({ round, lab: labOf(criticSeat), ...seatField(criticSeat), model: criticSeat.model, ...(criticSeat.lane ? { lane: criticSeat.lane } : {}), verdict: critique.meets === true ? 'signed_off' : 'objected', reason_code: null, reasked: false });
      const failures = critique.failures;
      log(`  verdict: ${critique.meets ? 'MEETS' : `${failures.length} failure(s)`} - ${critique.verdict_line || ''}`);
      failures.forEach(f => log(`    FAILED: ${f.criterion} - ${f.problem}`));

      history.push(`## Round ${round} critique (${criticSeat.provider}/${criticSeat.model})\n${critique.verdict_line || ''}\n${failures.map(f => `- FAILED: ${f.criterion} - ${f.problem}`).join('\n')}`);

      if (critique.meets === true) {
        passed = true;
        if (stopOnPass) {
          log(`  a critic from a different lab passed it; stopping early rather than inventing work.`);
          break;
        }
      }

      if (round === maxRounds) {
        log(`  round cap (${maxRounds}) reached; the remaining failures go into the report, not another round.`);
        break;
      }

      log(`\nRound ${round}: revise`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const revised = (await draftStage(reviserSeat, {
        system: reviserSystemOf(false, false)(open, !!fencedSource, promptOpts),
        user: R.reviserUser({ request, criteria, draft, critique: critique?.failures ? { ...critique, failures: inExcerptShown(critique.failures) } : critique }),
        log, label: `revise-${round}`,
      })).text;
      const parsedRevise = parseDisputes(revised);
      takeLedger(parsedRevise, `revise-${round}`, false);
      noteLinesIgnored('revise', parsedRevise.noteLines, log);
      earlyFinishIgnored('revise', parsedRevise.earlyFinish, log);
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach(reason => disputes.push({ round, reason }));
      passed = false;
      } catch (secretErr) {
        // 0.8.4 (found-secret pause, --finish): the stage that was paused at a credential-shaped string is the first call of this sitting that missed the cache while the person's recorded finish is armed (invoke, before the scan).
        // It was not sent. The loop ends HERE and the ordinary NOT-agreed ending runs after it, exactly as after a round-stop finish (finishedStop is the one variable everything after the loop reads).
        if (!(secretErr instanceof SecretFinish)) throw secretErr;
        passed = false;
        // This catch is reached for a throw OUTSIDE the layer loop of a layered pass (the pass's panel is recorded, or none of it started) and anywhere in an unlayered pass. A throw INSIDE the layer loop
        // is the inner catch (below), which folds the layers already answered first, as the ledger stop does (C-004).
        finishedStop = secretStopFor(round, secretErr.label, secretErr);
        log(secretErr instanceof SpendFinish ? `\n  finishing at the person's choice: the spending limit stopped the run at stage "${secretErr.label}", before its next call was paid for; this is NOT agreement.` : `\n  finishing at the person's choice: the run was paused at a credential-shaped string in stage "${secretErr.label}"; this is NOT agreement.`);   // WORDING S16-w67
        break;
      }
    }
    scanPhase = 'after';
  }

  // v7.x: claim schema with typed evidence (src/claims.js), gated on config.claims.enabled.
  // Runs once, after the critic/revise rounds are done, over the union of objections this run
  // actually raised (lastCritique.failures) - restates each one as a typed claim and validates
  // its evidence offline (a "quote" claim against `draft`, a "tool" claim against `ground_truth`
  // from config.verify.enabled). Absent/false key: `claims`/`claimWarnings` stay undefined, never
  // added to the returned result, v6 report.json shape and every existing chain's behavior
  // unchanged. A claim whose evidence doesn't check out is dropped, not crashed - one bad quote
  // must not lose every other claim in the same reply.
  let claims;
  let claimWarnings = [];
  if (config.claims?.enabled) {
    log('\nStage: claims (typed evidence over this run\'s objections)');
    const failuresForClaims = (lastCritique?.failures || []).filter(f => !sevRun || holdsSignOff(sevRun.inForce(f.lab, f.id) ?? f.severity));   // unit 3 (C&C ruling 1): the objections that hold the plan only; swept ones are recorded, not extracted
    if (!failuresForClaims.length) {
      claims = [];
      log(sevRun && (lastCritique?.failures || []).length ? '  no objection that holds the sign-off; nothing to extract (the swept ones are recorded, not extracted).' : '  no objections this run; nothing to extract.');
    } else {
      try {
        const claimSeat = config.seats.claims || config.seats.reviser || config.seats.builder;
        const extracted = await extractClaims(claimSeat, { request, draft, failures: failuresForClaims }, {
          invoke: (seat, args) => invoke(seat, { ...args }).then(s => { record(s); return s; }),
          parseJson, roles: R, log, label: 'claims',
        });
        const validated = dropInvalidClaims(extracted.claims, { draft, groundTruth: ground_truth });
        claims = validated.claims;
        claimWarnings = validated.warnings;
        log(`  ${claims.length} claim(s) kept, ${claimWarnings.length} dropped.`);
        claimWarnings.forEach(w => log(`  WARNING: ${w}`));
      } catch (err) {
        // 0.8.4 (finish at once at the spending limit): the extraction would bill; claims stay as they are (none), and the call is on the record of calls not made
        if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
        log(`  claims: not extracted (${notMadeWhy()}).`);
      }
    }
  }

  // 0.8.2 item 4 (signed vs delivered text, LABEL only): the draft the panel last reviewed, whether it signed it, and what is still open. Every model stage after this point that changes the
  // body is recorded in `bodyChanges`, every harness-written block in `harnessNotes` (src/text-labels.js). Nothing here changes `passed` or calls a model.
  const reviewedDraft = draft;
  const signedAtPanel = passed === true;
  // The number of open objections is NOT `lastCritique.failures`: that is overwritten by a round nobody was heard in (empty) and counts a first-mode "(critic reply unparseable)" stand-in.
  // It is `openFailures` below: the one list the dissent block and `dispute.open_objections` use, so the three always say the same number (item 4 review, 6 Oct 2026).
  const bodyChanges = [];
  const harnessNotes = [];

  // 3a-bis. Dispute stage (config.dispute: { enabled: true, stall_rounds: 2 }), 2026-09-20.
  //
  // Runs once, when a unanimous chain stops without agreement - by the round cap or by the
  // stall rule above - and never when the panel signed off. It is explicitly NOT another
  // debate round: the panel does not re-review afterwards, and it cannot turn a disagreement
  // into a signoff. `outcome` stays no_consensus, because that is what happened.
  //
  // What it is for: the cheap-7 run ended with open objections that were simply dropped into
  // report.json, where a reader had to go looking for them, and a false claim survived into
  // the deliverable because the round cap hit before anyone could act on the objection to it.
  // So this does two narrow things. It gives the reviser ONE pass whose only job is to mark
  // what could not be settled - not to defend the draft, not to rewrite it. And it puts the
  // unresolved dissent at the top of the deliverable, verbatim, with the lab and round that
  // raised it, so the human reading the plan sees the disagreement before the plan rather
  // than after it.
  //
  // Deliberately not here: a re-vote, a tie-break, a "winner". A panel that did not agree did
  // not agree, and manufacturing a verdict is precisely what this harness should never do.
  // 0.8.4 S4 (C&C's Q-i1 ruling, a PERMANENT invariant): once layer 3 signed off and the handler answered good_to_build, nothing changes the plan before the build: the dispute rewrite, the challenge and the final edit are skipped there (they run only at a not-agreed ending).
  const agreedByCheck = !!agreementPoint && buildChecks.at(-1)?.answer === 'good_to_build' && buildChecks.at(-1).pass === agreementPoint.pass;
  // 0.8.4 S16 (T21d, D38, copy correction 11): the same invariant where there is NO handling session to check the build: a full sign-off of every layer ends the run AGREED (src/ending.js endingCore), so the plan is not changed after it either; the dispute rewrite, the challenge and the final edit run only at a not-agreed ending. Live with the build check's wording (ONE held read gates the check AND this ending, Q-a ADDENDUM: while it is held `ending` is not recorded and a run without a handler is what it was before 0.8.4). `passed === true` keeps a run that a secret finish ended at the check (SecretFinish before `passed` is set) out of it; a ladder or escalated sign-off without a handler keeps today's rule (not an agreement).
  const agreedAtPoint = agreedByCheck || (buildCheckLive() && !hasHandlingSession(config) && agreementPoint?.kind === 'full' && passed === true);
  let dispute = null;
  let dissentBlock = null;
  let renderDissentBlock = null;   // 0.8.4 S8 c3: set by the dispute stage (below); the closing read calls it again with the entries still open
  // After a round in which NO reviewer was heard (noHeardReviewer), lastCritique is the round
  // before's, against an earlier draft: none of it is current. Pre-release audit 2026-09-23
  // (ProposalsDebateDispute #4): it was presented as open against the current draft, under
  // "round cap reached". Those objections are carried below instead, tagged as unheard.
  const heardOpenFailures = (!passed && !noHeardReviewer && lastCritique && lastCritique.meets !== true)
    ? (lastCritique.failures || []).filter(f => f.criterion)
    : [];
  // Bug-audit fix, 2026-09-23 (Review/BugAudit_RunChainStages_2026-09-23.md #2): open objections
  // came only from the final round's HEARD voters, so a holdout that objected in rounds 1-2 and was
  // garbled or unreachable in the last round vanished - no "Unresolved dissent" block, and the
  // deliverable a builder reads first carried no warning. Such a seat's most recent recorded
  // objections are carried, keeping `lab` (the dispute stage finds the seat by it) and marked as
  // unheard in the final round, so nobody reads them as a current position.
  // C-004: a ledger-overflow stop now records the verdicts of the layers it did ask (panelVerdicts rows for its round), but lastCritique and signoff[] still hold the last FINISHED panel, so the final panel round stays that one: the dissent lists below are then exactly what they were before (a stop round counted
  // as final would carry the top layer's older objections a second time, once as heard and once as not asked).
  const finalRounds = panelVerdicts.filter(v => !v.cut).map(v => v.round).filter(r => !(layerStop?.reason === 'ledger_overflow' && r === layerStop.round));
  const finalPanelRound = finalRounds.length ? Math.max(...finalRounds) : null;
  // 0.8.4 round 1 (held fix, signed_text): `signed_text.round` names the round in which the draft with signed_text.sha256 was put to the panel: the latest round whose draft id is the id of this text and in which a seat was SENT it (the rule is on the line below); null when it was never put to a panel (a revision after the last round, or a pass whose first call was never made); a chain without layers keeps the last panel round. finalPanelRound itself (the dispute's, the dissent lists') is not changed.
  const signedTextRound = (() => { if (!layered) return finalPanelRound; const id = draftIdOf(reviewedDraft); const cutPrefixes = panelVerdicts.filter(v => v.cut).map(v => `panel-${v.round}-${keyOfRecord(v)}`); const sentRounds = new Set(stages.map(st => String(st?.label ?? '')).filter(l => /^panel-\d+-/.test(l) && !cutPrefixes.some(c => l === c || l.startsWith(`${c}-`))).map(l => Number(/^panel-(\d+)-/.exec(l)[1]))); const shown = r => sentRounds.has(r) || !layersRecord.some(x => x.round === r) || layersRecord.some(x => x.round === r && ['signed_off', 'objected', 'unheard', 'abstained'].includes(x.state) && !(x.carried && x.carried.length >= x.labs.length)); const rs = Object.entries(draftShaByRound).filter(([, v]) => v === id).map(([k]) => Number(k)).filter(shown); return rs.length ? Math.max(...rs) : null; })();   // the latest round in which a seat was SENT this text. SENT is not 'a reply came back': a round counts when a panel call of it is among the run's stages (a replayed stage counts) and its seat's row is not marked `cut` (the person's --finish discarded it), OR a layer was heard in it or could not be (a signed_off, objected, unheard or abstained row: shown, nobody read it) and that row is not wholly carried (a row whose carried list is as long as its labs holds carried verdicts only: no call went out), OR it recorded no layer row (the early finish's own pass). A pass whose first call was never made, or whose only calls were cut, does not count; draftShaByRound is filled for every layered round before its first call, so it cannot say that by itself
  // In a round nobody was heard in, a seat that only stated a pass cast no vote either.
  // The same for a round that was not quorate: its stated passes were not votes.
  const notHeard = v => v.verdict === 'unheard' || ((noHeardReviewer || notQuorate) && v.verdict === 'passed')
    || (layerStop && layerStop.round === v.round && seatsOfRow(layerStop).includes(keyOfRecord(v)) && v.verdict === 'passed');
  const unheardAtEnd = (!passed && config.signoff === 'unanimous')
    ? panelVerdicts.filter(v => v.round === finalPanelRound && !v.cut && notHeard(v)).map(keyOfRecord)
    : [];
  // FIX F2/F3 (C&C, 27 Okt 2026): the lists below take each seat's objections from a pass snapshot; an item is dropped when a LATER disposition closed it, keyed by seat and id: a ruling that overruled or moved it (stall
  // escalation; not when an unquoted re-raise reopened it), or the seat's own withdrawal with a quote (answer-back). Without this an overruled, sustained or withdrawn objection came back as open dissent.
  const closedByLaterRuling = (lab, id, round) => rulingRows().some(e => (e.trigger === 'in_call' ? e.pass >= round : e.pass > round) && closedByRowRuling(e, lab, id));   // 0.8.4 S7b: an in-call ruling happens in the SAME pass in which layer 1 raised the id (an escalation row's pass is the one AFTER the snapshot), so it compares with >=
  const withdrawnFrom = (lab, id, fromRound) => answerBackReplies.some(r => r.lab === lab && String(r.id).trim().toLowerCase() === String(id).toLowerCase() && (r.effect === 'withdrawn' || r.effect === 'withdrawn_exchange') && r.round >= fromRound);
  const closedLater = (lab, id, round) => closedByLaterRuling(lab, id, round) || withdrawnFrom(lab, id, round + 1);
  const carriedFailures = unheardAtEnd.flatMap(lab => {
    for (let i = openByRound.length - 1; i >= 0; i--) {
      const mine = openByRound[i].failures.filter(f => f.lab === lab && f.criterion);
      if (mine.length) return mine.filter(f => !closedLater(lab, f.id, openByRound[i].round)).map(f => ({ ...f, unheard_in_final_round: true, last_raised_round: openByRound[i].round }));
    }
    return [];
  });
  // 0.8.3 E2b (contract 4.6): a lab whose layer was not asked in the final round is in neither list above, but its latest objection may still be open against this draft. It is carried when its latest
  // heard, non-carried verdict was an objection; a later sign-off of that lab closes it. Tagged, so nobody reads it as a position taken against the final draft.
  const passedUpKeys = new Set(escalations.flatMap(e => (escalatedFailures.get(e) || []).map(f => `${f.lab}\u0000${f.id}`)));
  const notAskedFailures = (layered && !passed && finalPanelRound !== null)
    ? layersRecord.filter(r => r.round === finalPanelRound && (r.state === 'not_asked' || r.state === 'escalated' || r.state === 'unfinished')).flatMap(r => seatsOfRow(r).map(lab => ({ lab, escalated: r.state === 'escalated' }))).flatMap(({ lab, escalated }) => {
      const latest = panelVerdicts.filter(v => keyOfRecord(v) === lab && v.verdict !== 'unheard' && !v.carried && !v.cut).pop();
      const inRound = latest ? (openByRound.find(o => o.round === latest.round)?.failures || []).filter(f => f.lab === lab && f.criterion) : [];
      // E3 (readers audit 24): a lab whose latest verdict was a STATED PASS that carried its own open objections (they are in that round's failures) still has them open; a plain pass has none in the round.
      if (latest?.verdict !== 'objected' && !(latest?.verdict === 'passed' && inRound.length)) return [];
      // 0.8.4 S5 U-A fix-up (C&C 05 Nov 2026, item 5): a layer PASSED OVER in the final round (`escalated`) keeps the objections that were NOT passed up (only the stalled ones go up now; before S5 every one did): they are open against this draft like any not-asked layer's. The ones that WERE passed up are the standing dissent below (no duplicate).
      return inRound.filter(f => !closedLater(lab, f.id, latest.round) && !(escalated && passedUpKeys.has(`${lab}\u0000${f.id}`))).map(f => ({ ...f, not_asked_in_final_round: true, last_raised_round: latest.round }));
    })
    : [];
  // Stall escalation: a lab whose layer was passed over in the final round (`escalated`) keeps the passed-up objections no ruling closed (undecided, or not ruled yet): they are STANDING dissent and reach the dispute stage,
  // tagged; an overruled or a sustained one is not (it was closed by the ruling, or it is the sustaining seat's own now). C&C ruling 1: today's dispute stage runs over the standing ids after an escalated sign-off.
  // A standing (passed-up, unruled) objection is also not open when its raiser's LATEST heard verdict after the stall does not raise it, or a later ruling closed it. The latest position decides (correction 10g, each judge's latest position): an id the raiser
  // withdrew or left out of one verdict and then raised again under the same id (the id is a hash of seat + criterion + quote, so it recurs until the relation wording is recorded) is held again and stands; only a later RULING still closes it.
  // `null` = the raiser was not heard again after `round`; else { holds, round }: whether its latest heard verdict raises the id, and in which round (a withdrawal in that same round or later still closes it).
  const latestPosition = (lab, id, round) => {
    const later = panelVerdicts.filter(v => keyOfRecord(v) === lab && v.round > round && !v.carried && !v.cut && v.verdict !== 'unheard');
    if (!later.length) return null;
    const last = later.reduce((a, b) => (b.round > a.round ? b : a));
    return { holds: (openByRound.find(o => o.round === last.round)?.failures || []).some(f => f.lab === lab && f.id === id), round: last.round };
  };
  const standsAfter = (lab, id, round) => { const pos = latestPosition(lab, id, round); return pos === null ? !closedLater(lab, id, round) : pos.holds && !closedByLaterRuling(lab, id, round) && !withdrawnFrom(lab, id, pos.round); };
  const passedOver = new Set(layered && finalPanelRound !== null ? layersRecord.filter(r => r.round === finalPanelRound && r.state === 'escalated').flatMap(seatsOfRow) : []);
  const standingFailures = [...new Map(escalations.flatMap(e => (escalatedFailures.get(e) || []).filter(f => passedOver.has(f.lab) && !closedByRowRuling(e, f.lab, f.id) && standsAfter(f.lab, f.id, e.round)).map(f => [`${f.lab}\u0000${f.id}`, { ...f, escalated_standing: true, last_raised_round: e.round, ...(isLayerOneUp(e.trigger) || e.trigger === 'layer2_bound' ? { escalated_by: e.trigger } : {}) }]))).values()];
  // One row per (seat, id, problem): the same objection is listed once however many lists carry it (two lower-layer judges' identical raises, sustained by one seat, are adopted under ONE id and used to be listed twice, byte for byte, in dispute.open_objections). Two different problems
  // under one id stay two rows: that is the shared-id question of "the same objection", not decided here. This is the one list the dissent block, `dispute.open_objections`, `signed_text.open_objections` and the ending exchange read. (3c140182, moved to the sites of the 0.8.4 tip.)
  const seenOpen = new Set();
  const heldOpen = [...heardOpenFailures, ...carriedFailures, ...notAskedFailures, ...standingFailures].filter(f => !cutWithdrawn.has(`${f.lab}\u0000${f.id}`));   // ruling 19: an objection its raiser withdrew in a completed round of the cut exchange is closed, as a completed exchange closes it
  const heldKeys = new Set(heldOpen.map(f => `${f.lab}\u0000${f.id}`));   // F1 (C&C's unit-end review): an objection that was on the record before the cut stays exactly as it was (row, text, flags: askable, in the dispute's list, the final read's sorting and the close) when the judge's cut reply, or a verdict carried into the cut layer, repeats it (the id is reword-stable); only an objection that was not held is added from the cut layer, marked `cut_off`
  const openFailures0 = [...heldOpen, ...cutFailures.filter(f => !heldKeys.has(`${f.lab}\u0000${f.id}`))].filter(f => { const k = JSON.stringify([f.lab, f.id, f.problem]); return seenOpen.has(k) ? false : (seenOpen.add(k), true); });   // the first row of a key stays
  // 0.8.4 S4b (CA6, Q8 item 2, D19, Q1(g), Q4(d); Q-i2, Q-i3): THE ENDING EXCHANGE. Before an ending that layer 3 did not sign off, ONE layer-1 exchange runs over every layer-1 objection still marked not_debated (the carry store and the last pass's "could not run" row,
  // minus what a ruling or the seat's own withdrawal closed since). It is not a pass: no blind review, no sign-off, no revision, and the exchange changes no plan text (an amend replaces the objection's text on the record only). It runs only at a finish (--finish) and at the
  // round cap (Q-i2: the other endings keep their objections flagged not_debated; "revise outside the Council" has no ending in the code: a named limit) and never after a layer-3 sign-off (`passed`, `escalatedEnd`). Needs two heard layer-1 judges (Q4(d)): with fewer it is
  // not run, the objections stay flagged not_debated, never claimed debated. Its seventh round is W26 (a defect first found there is a LATE FINDING, src/late-finding.js). ONE held read (W26) switches it on, calls, record and prompts together; while held nothing here runs.
  const roundCapEnd = roundCapReached !== null && !passed;   // POSITIVE (C&C's item 3): the loop used all its passes and no sign-off ended the run. Every other way out of the pass loop (a sign-off, an escalated sign-off, an early finish, a finish, a stall, a layer stop, no heard reviewer, not quorate) breaks before this is set; a stop that stands throws RoundStopped and never reaches this code
  const runEndingExchange = async open0 => {
    const trigger = exchangeTriggerOf(finishedStop);
    const layer1 = layerNumbers[0];
    const l1Seats = config.seats.critics.filter(c => c.layer === layer1);
    const l1Keys = l1Seats.map(seatKeyOf);
    const l1Rows = panelVerdicts.filter(v => !v.cut && l1Keys.includes(keyOfRecord(v)));
    const lastL1 = l1Rows.length ? Math.max(...l1Rows.map(v => v.round)) : null;
    const heardKeys = new Set(l1Rows.filter(v => v.round === lastL1 && v.verdict !== 'unheard').map(keyOfRecord));   // heard in the last pass in which layer 1 was asked
    const cand = new Map();
    for (const [key, m] of exchangeCarried) if (l1Keys.includes(key)) for (const [id, c] of m) cand.set(`${key}\u0000${id}`, { key, id, found: c.found_pass ?? 0, criterion: c.criterion, problem: c.problem, ...(c.quote ? { quote: c.quote } : {}), ...(c.severity !== undefined ? { severity: c.severity } : {}) });
    const lastRow = layerDebates.filter(d => d.layer === layer1).at(-1);
    if (lastRow?.not_run && lastRow.pass === lastL1) for (const o of lastRow.objections || [])   // only the row of the LAST pass that asked layer 1: an older not-run row is stale (a later pass may have raised nothing and pushed no row)
      cand.set(`${o.raised_by}\u0000${o.id}`, { key: o.raised_by, id: o.id, found: lastRow.pass ?? 0, criterion: o.criterion, problem: o.problem, ...(o.quote ? { quote: o.quote } : {}), ...(o.severity !== undefined ? { severity: o.severity } : {}) });
    const withdrawnAll = withdrawnList(Infinity);   // 0.8.4 S4b: the Q12 closed states, one definition (S4a's closedOnRecord / withdrawnList): withdrawn (the seat's own, in an exchange or by answer-back), overruled below 4, adopted by an upper layer, cleared by a re-tag below 4
    const closedAtEnd = t => closedLater(t.key, t.id, t.found) || closedOnRecord(t.key, Infinity).has(t.id) || withdrawnAll.some(w => w.lab === t.key && w.id === t.id);
    const todo = [...cand.values()].filter(t => !closedAtEnd(t));   // still not debated and not closed since
    if (!todo.length) return null;   // zero calls when no objection of layer 1 is still not debated
    const judges = l1Seats.filter(s => heardKeys.has(seatKeyOf(s))).map(seat => ({ seat, key: seatKeyOf(seat), failures: todo.filter(t => t.key === seatKeyOf(seat)).map(({ key, id, found, ...f }) => f) }));
    const head = { trigger, ending: true, judges: judges.map(j => j.key) };
    const rowOf = (t, flags = []) => ({ id: t.id, criterion: t.criterion, problem: t.problem, ...(t.quote ? { quote: t.quote } : {}), ...(t.severity !== undefined ? { severity: t.severity } : {}), raised_by: t.key, outcome: 'not_debated', ...(flags.length ? { flags } : {}) });
    const unasked = todo.filter(t => !heardKeys.has(t.key));   // the raiser was not heard in the last pass that asked layer 1: not asked at the end (the copy is silent: B's default, named to C&C), kept flagged not_debated, never dropped
    if (finishedAtOnce()) {   // 0.8.4 (finish at once): no judge is asked again, at any stop; the objections stay on the record flagged not debated
      log(`\nEnding exchange: not run (the person finished the run at once). ${todo.length} objection(s) stay not debated and flagged.`);
      return { open: open0, late: [], record: { ...head, ran: false, not_run: 'finished_at_once', objections: todo.map(t => rowOf(t)) } };
    }
    if (judges.length < 2 || judges.every(j => !j.failures.length)) {
      log(`\nEnding exchange: not run (${judges.length} judge(s) of layer ${layer1} were heard in the last pass that asked it; it needs two). ${todo.length} objection(s) stay not debated and flagged.`);
      return { open: open0, late: [], record: { ...head, ran: false, not_run: judges.length < 2 ? 'fewer_than_two_heard' : 'raisers_not_heard', objections: todo.map(t => rowOf(t, heardKeys.has(t.key) ? [] : ['raiser_not_heard'])) } };
    }
    log(`\nStage: ending exchange (${exchangeTriggerWords(trigger)}: ${todo.length} objection(s) of layer ${layer1} still not debated, ${judges.length} judges)`);
    const ex = await exchangeRound({ judges, request, criteria, draft, round: 'end', record, log, cacheTtl, layout: cacheOrderOn(config) ? { config, checks, endMarker: endMarkerOn } : null, jsonModeLabs: exchangeJsonModeLabs(config), declinedReasons: declinedReasonsFromDisputes(disputes), rulingsText: rulingsNote(finalPanelRound ?? 0), where: 'ending', layerOne: true, rounds: EXCHANGE_ROUNDS,
      personaSystem: (kind, seat, again) => (kind === 'debate' ? layerDebateSystemFor : layerReplySystemFor)(config, seat, again, { ending: true }), severity: severityOn, ending: { post: (seat, again) => lastRoundPostSystem(config, seat, again), reply: (seat, again) => lastRoundReplySystem(config, seat, again) } });
    const gone = new Set(ex.rows.filter(r => r.outcome === 'withdrawn_argued').map(r => `${r.raised_by}\u0000${r.id}`));
    if (sevRun) for (const r of ex.rows) if (r.outcome === 'withdrawn_argued') sevRun.withdraw(r.raised_by, r.id, 'exchange', finalPanelRound ?? 0, r.severity);   // the severity record and setFinal agree with the list
    const minted = ex.rows.filter(r => r.from_exchange && r.outcome !== 'withdrawn_argued').map(r => ({ criterion: r.criterion, problem: r.problem, ...(r.quote ? { quote: r.quote } : {}), ...(r.severity !== undefined ? { severity: r.severity } : {}), fix: '', id: r.id, lab: r.raised_by, from_ending_exchange: true }));   // rounds 1 to 6: W1 applies, the defect is the finder's own objection
    const open = [...open0.filter(f => !gone.has(`${f.lab}\u0000${f.id}`)).map(f => { const t = ex.amended.get(f.lab)?.get(f.id); return t ? { ...f, problem: t } : f; }), ...minted];   // an amend changes the record's text, never the plan
    const late = assignLateFindingIds((ex.late || []).map(l => ({ ...l, lab: l.by }))).map(lateFindingRow);
    const unaskedRows = unasked.map(t => rowOf(t, ['raiser_not_heard']));
    const stillNot = [...ex.rows.filter(r => r.outcome === 'not_debated').map(r => r.id), ...unaskedRows.map(r => r.id)];
    log(`  ending exchange: ${gone.size} withdrawn, ${ex.rows.filter(r => r.outcome === 'stands_uncontested').length} stand uncontested, ${ex.rows.filter(r => r.outcome === 'stands_contested').length} stand contested, ${stillNot.length} still not debated${late.length ? `; ${late.length} late finding(s) (found in the last round, not debated)` : ''}.`);
    return { open, late, record: { ...head, ran: true, rounds: ex.rounds, ...(ex.safety_stop ? { safety_stop: true } : {}), objections: [...ex.rows, ...unaskedRows], ...(stillNot.length ? { still_not_debated: stillNot } : {}) } };
  };
  const endingRun = layered && endingExchangeOn() && !passed && !escalatedEnd && (finishedStop || roundCapEnd) ? await runEndingExchange(openFailures0) : null;
  const openFailures = endingRun ? endingRun.open : openFailures0;
  if (sevRun) for (const r of retags) if (String(r?.id).startsWith('L-') && !lateRetagsConsumed.has(`${r.pass}\u0000${r.id}`)) { sevRun.refuseHandler(r.pass, r, 'no_check_at_pass'); lateRetagsConsumed.add(`${r.pass}\u0000${r.id}`); }   // 0.8.4 S18 (Q3 (a)): a late-finding re-tag whose pass never got a build check is refused, with its reason, never dropped silently
  sevRun?.setFinal(finalPanelRound, passed ? (lastCritique?.failures || []) : openFailures, passed, { nobodyHeard: !!noHeardReviewer, unheard: unheardAtEnd });   // unit 3: the ONE capture of the end list for the severity record (a not-agreed end: the list the dispute stage uses; a passed end: the last pass's swept items)
  // M1 COMPLETE U1-2 (RU-S4-16/31/42/58/114; HELD behind `dissentRecordSection`, the text of U1-3): the DISSENTS of a run that ended at the top layer's sign-off. A dissent = a row of the ONE overrule source (`layerThreeOverrulesSource`: escalation rows today, S8's sorting rows later) whose block is STILL OPEN at the end, read from `openFailures`
  // (the same list the ending and the dispute stage read: standingFailures / openFailures0; no second derivation), computed here, BEFORE the dispute guard, so the agreed case (`agreedByCheck` skips the dispute branch) has it. The latest ruling's reasons are shown; `kept` is read against the EARLIEST overrule of the block (the seat's latest `sustained`
  // answer after it); the keep reason is the in-memory evidence of that answer row (non-enumerable, so it is not in answer_back_replies). Never in report-partial.json: it is computed here, at the end.
  let dissentRows = (() => {
    if (!layered || typeof held('dissentRecordSection') !== 'function' || !(escalatedEnd || agreementPoint)) return [];
    const byKey = new Map();
    for (const r of layerThreeOverrulesSource()) { const k = `${r.seatKey}\u0000${r.id}`; const had = byKey.get(k); byKey.set(k, { latest: !had || r.ruled_round >= had.latest.ruled_round ? r : had.latest, firstRound: Math.min(r.ruled_round, had ? had.firstRound : Infinity) }); }
    const retags = sevRun?.snapshot()?.retags ?? [];
    return openFailures.filter(f => f.id && byKey.has(`${f.lab}\u0000${f.id}`)).map(f => {
      const { latest: r, firstRound } = byKey.get(`${f.lab}\u0000${f.id}`);
      const answer = [...answerBackReplies].filter(x => x.lab === f.lab && x.id === f.id && x.effect === 'sustained' && x.round > firstRound).at(-1);
      const reason = typeof answer?.evidence === 'string' ? answer.evidence.trim() : '';
      return { name: `${labFromKey(f.lab)}${layerNoteOf(f.lab)}`, lab: labFromKey(f.lab), ...(labFromKey(f.lab) !== f.lab ? { seat: f.lab } : {}), id: f.id, criterion: f.criterion, problem: f.problem || null, ...(f.quote ? { quote: f.quote } : {}),
        rating: { as_raised: sevRun?.asRaised(f.lab, f.id) ?? null, in_force: sevRun?.inForce(f.lab, f.id) ?? null, changes: retags.filter(x => x.lab === f.lab && x.id === f.id).map(x => ({ pass: x.pass, from: x.from, to: x.applied_to ?? x.to, by: x.by === 'handler' ? 'handler' : 'layer3' })) },
        ruling: { layer: r.ruled_layer, round: r.ruled_round, source: r.source, reasons: r.reasons },
        ...(answer ? { kept: { round: answer.round, ...(reason ? { reason } : {}) } } : {}), status: 'open' };
    });
  })();
  const dissentKeys = new Set(dissentRows.map(d => `${d.seat ?? d.lab}\u0000${d.id}`));
  const endingBase = endingWordOf({ passed, noHeardReviewer, notQuorate, finishedStop, layerStop, earlyFinish, escalatedEnd, stalled });   // 0.8.4 D1: the run's ending word from the flags it set (each is set just before the pass loop's `break`, so one run sets one); the dispute record's `reason` below is DERIVED from it, in the legacy spelling
  const askable = openFailures.filter(f => !f.cut_off);   // item 2: an objection of a judge whose row a finish cut is open and listed, and no model is asked about it after the finish (litigated, the final read's sorting, the closing read)
  const litigated = sevRun ? askable.filter(f => holdsSignOff(sevRun.inForce(f.lab, f.id) ?? f.severity)) : askable;   // unit 3 (C&C ruling 1): below the settle line = recorded, not litigated: the dispute stage's two paid calls take only the objections that hold the plan (the dissent block and open_objections below still list every open one)
  if (disputeEnabled && config.signoff === 'unanimous' && openFailures.length && !agreedAtPoint) {
    const stopWhy = noHeardReviewer ? `no reviewer heard in round ${noHeardReviewer.round}` : notQuorate ? `round ${notQuorate.round} not quorate` : finishedStop ? (finishedStop.chosen === 'rule' ? `ended at this stop because the run has no handling session (${ruleCause(finishedStop)})` : `finished at the person's choice${relayedTail(finishedStop)} (${limitReachedWords(finishedStop)})`) : layerStop ? (layerStop.reason === 'ledger_overflow' ? `the objection ledger did not fit for layer ${layerStop.layer} of round ${layerStop.round}` : `layer ${layerStop.layer} of round ${layerStop.round} gave no usable verdict`) : earlyFinish ? `finished early at the session's proposal (pass ${earlyFinish.pass})` : escalatedEnd ? (escalatedEnd.ladder ? `the top layer signed off in round ${escalatedEnd.pass}; ${escalatedEnd.below.length === 1 ? 'layer' : 'layers'} ${escalatedEnd.below.join(', ')} ${escalatedEnd.below.length === 1 ? 'was' : 'were'} not asked in that pass (ladder)` : escalatedEnd.requested ? `the top layer signed off in round ${escalatedEnd.pass}; ${escalatedEnd.below.length === 1 ? 'layer' : 'layers'} ${escalatedEnd.below.join(', ')} ${escalatedEnd.below.length === 1 ? 'was' : 'were'} not asked in that pass (it was asked to start at layer ${escalatedEnd.layer})` : `the top layer signed off in round ${escalatedEnd.pass} after objections were passed up`) : stalled ? `stalled after ${stalled.rounds} identical rounds` : 'round cap reached';
    log(`\nStage: dispute (${stopWhy}, ${openFailures.length} open objection(s))`);
    log('  This does not re-open the vote. The panel is done; this records what it could not settle.');

    // Where each objection was first raised, for the dissent block. Read from the per-round
    // record rather than the last round alone, so "raised in round 2, never resolved" is
    // visible - that was true of the false claim in the cheap-7 run and nothing showed it.
    const firstSeen = new Map();
    for (const { round: r, failures } of openByRound) {
      for (const f of failures) {
        const key = objectionKey(f);
        if (!firstSeen.has(key)) firstSeen.set(key, r);
      }
    }
    for (const f of cutFailures) { const key = objectionKey(f); if (!firstSeen.has(key)) firstSeen.set(key, f.last_raised_round); }   // item 2: a cut judge's objection is not in openByRound (its pass was never recorded as a panel); the round it was raised in is the round the finish cut

    const reviserSeat = config.seats.reviser || config.seats.builder;
    // Unit 3 (C&C ruling 1): with nothing that holds the plan among the open objections (all rated below the settle line) there is no dispute call and the draft stays as it is; the record below is still written.
    let revised = null; let rewriteNotRun = false;
    if (litigated.length) {
      try {
        revised = (await draftStage(reviserSeat, {
        system: disputeSystemFor(config),
        user: R.disputeUser({ request, criteria, draft, failures: sevShown(litigated.map(f => withRaisedBy(f, config.seats.critics))), severity: severityOn }) + rulingsNote(finalPanelRound ?? 0),   // B3 prototype: the rulings in force at the last pass that ran (none can be dated later: a ruling is never accepted for a pass that has a stage)
        log, label: 'dispute',
        })).text;
      } catch (err) {
        // 0.8.4 (finish at once at the spending limit): the rewrite would bill; the draft stays as it is and the dissent block below is still built from the recorded objections
        if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
        rewriteNotRun = true;
        log(`  dispute: the rewrite was not made (${notMadeWhy()}); the plan stays as it is.`);
      }
    }
    const parsedDispute = revised === null ? { draft, disputes: [], noteLines: [], earlyFinish: null } : parseDisputes(revised);
    takeLedger(parsedDispute, 'dispute', false);
    noteLinesIgnored('dispute', parsedDispute.noteLines, log);
    earlyFinishIgnored('dispute', parsedDispute.earlyFinish, log);
    const draftBeforeDispute = draft;
    draft = parsedDispute.draft;
    if (draft !== draftBeforeDispute) bodyChanges.push('dispute');
    parsedDispute.disputes.forEach(reason => disputes.push({ round: 'dispute', reason }));

    // Dispute review (opt-in): the seats that raised the open objections check the reviser's
    // last pass. Runs before the block below is built, so a misrepresented or dropped objection
    // is flagged at the top of the deliverable, with the dissent itself.
    const reviewSkippedAtOnce = disputeReviewEnabled && litigated.length && finishedAtOnce();   // 0.8.4 (finish at once, found after 4a): the reviews are asked of the seats that RAISED the objections, which are judges of the panel: no judge is asked again
    if (reviewSkippedAtOnce) log('  Dispute review: not run (the person finished the run at once, and the reviews are asked of the judges that raised the objections).');
    const review = disputeReviewEnabled && litigated.length && !reviewSkippedAtOnce
      ? await runDisputeReview(config, { request, openFailures: inExcerptShown(litigated), draftBefore: draftBeforeDispute, draftAfter: draft, invoke, record, log, rulingsText: rulingsNote(finalPanelRound ?? 0) })
      : null;
    const reviewFlags = renderDisputeReviewFlags(review);

    // The dissent block is built here, from the recorded objections, and never from the
    // reviser's reply: a seat asked to summarise the objections against its own draft is the
    // last thing that should be authoring the record of them. Verbatim, or it is not a record.
    // 0.8.4 S8 c3: the block is written by ONE function of the failures it lists, so the closing read can write it again from the entries still open (the same text, no patching). Called at the dispute stage with every open entry, and after the final read with those that stand.
    renderDissentBlock = failures => {
      const lines = failures.map(f => {
        const r = firstSeen.get(objectionKey(f));
        // The carried tags (set above) are rendered, as that code's comment promises: an objection
        // whose author was not heard in the final round is shown as possibly out of date, never as a
        // current position against this draft.
        const status = f.unheard_in_final_round
          ? `last raised in round ${f.last_raised_round}; ${f.lab || 'that lab'} was not heard in the final round, so it may already be fixed in the draft below`
          : f.not_asked_in_final_round
            ? `last raised in round ${f.last_raised_round}; ${f.lab ? labFromKey(f.lab) : 'that lab'}'s layer was not asked in the final round, so whether the draft below answers it is not known`
            : f.escalated_standing
              ? (isLayerOneUp(f.escalated_by) ? `it was still open when layer 1 had used its revisions in round ${f.last_raised_round} and was sent up a layer, where no ruling closed it` : f.escalated_by === 'layer2_bound' ? `it was still open when layer 2 had used its revisions in round ${f.last_raised_round} and was sent up to layer 3, where no ruling closed it` : `it stood unchanged up to round ${f.last_raised_round} and was passed up a layer, where no ruling closed it`)   // A-DRAFT (stall escalation): held for the owner's yes with the ruling sentences; the send-up wording is A-DRAFT too
              : 'never resolved';
        return [
          `### ${f.criterion}`,
          `*Raised by ${f.lab ? `${labFromKey(f.lab)}${layerNoteOf(f.lab)}` : 'an unnamed lab'}${r ? `, round ${r}` : ''}, ${status}.*`,   // A-DRAFT (Astra A1): a model on more than one layer names its layer, the shape of the reviser's approved "Raised by" line (roles.js:248)
          ...(sevRun && readSeverity(sevShown([f])[0].severity).ok ? [`Severity: ${sevShown([f])[0].severity}`] : []),   // TAGS SHOWN (A-DRAFT): with the severity switch the row shows its rating in force, the number the judge wrote (or the re-tag), no band words; a missing or unreadable tag shows nothing; the "Raised by" line above is untouched (it is owner-approved text)
          '',
          f.problem || '(no problem text recorded)',
          ...(f.fix ? ['', `Suggested fix: ${f.fix}`] : []),
        ].join('\n');
      });
      // C-005: a ledger-overflow stop says what the dispute stage's log line says (the top layer was never asked); a person's --finish says so too, not "round cap reached".
      return [
        '## Unresolved dissent',
        '',
        `${failures.length} objection(s) were still open when this run stopped` +
          `${noHeardReviewer ? ` (no reviewer could be heard in round ${noHeardReviewer.round}, so the panel stopped there; nobody has reviewed the latest draft)` : notQuorate ? ` (in round ${notQuorate.round} only ${notQuorate.heard} reviewer(s) gave a verdict, below this chain's quorum of ${notQuorate.minHeard}, so the panel stopped there)` : finishedStop ? ` (${finishedStop.chosen === 'rule' ? `this run has no handling session, so nobody could choose at this stop and the run ended there: ${ruleCause(finishedStop)}` : `the person chose to finish at this stop: ${limitReachedWords(finishedStop)}`}; the panel did not agree${finishedAtStopWords({ layers: layersRecord, stop: finishedStop }) ? `, and ${finishedAtStopWords({ layers: layersRecord, stop: finishedStop })}` : ''})` : layerStop ? (layerStop.reason === 'ledger_overflow' ? ` (the objection ledger did not fit for layer ${layerStop.layer} of round ${layerStop.round}, so the panel stopped there)` : ` (in round ${layerStop.round}, layer ${layerStop.layer} gave no usable verdict, so the panel stopped there)`) : earlyFinish ? ` (the run finished early at the session's proposal, with the overseer layer's yes; the lower layers did not review the last revision)` : escalatedEnd ? (escalatedEnd.ladder ? ` (the top layer signed off in round ${escalatedEnd.pass} on the ladder; ${escalatedEnd.below.length === 1 ? 'layer' : 'layers'} ${escalatedEnd.below.join(', ')} ${escalatedEnd.below.length === 1 ? 'was' : 'were'} not asked in that pass)` : escalatedEnd.requested ? ` (the top layer signed off in round ${escalatedEnd.pass} on a pass that was asked to start at layer ${escalatedEnd.layer}; ${escalatedEnd.below.length === 1 ? 'layer' : 'layers'} ${escalatedEnd.below.join(', ')} ${escalatedEnd.below.length === 1 ? 'was' : 'were'} not asked in that pass)` : ` (the top layer signed off in round ${escalatedEnd.pass} after ${escalatedHeaderCauseWords(escalations) ?? (escalations.length && escalations.every(e => isLayerOneUp(e.trigger)) ? 'objections that were still open after layer 1 had used its revisions were sent up a layer' : escalations.some(e => isLayerOneUp(e.trigger)) ? 'objections that stood unchanged were passed up a layer and others that were still open after layer 1 had used its revisions were sent up' : 'objections that stood unchanged were passed up a layer')}; no ruling closed these)`) : stalled ? ` (the same objections for ${stalled.rounds} rounds running)` : ' (round cap reached)'}.`,
        'The panel did not agree. This plan is one draft with known, named disagreement against it,',
        'not a signed-off deliverable - read these before acting on anything below.',
        '',
        ...lines,
        '',
        ...reviewFlags,
        '---',
        '',
      ].join('\n');
    };
    // Held, not applied here. The final-edit stage strips chain artifacts and never adds
    // material, so a block prepended now would be edited straight back out - caught by the
    // mock run, where the dissent never reached the deliverable at all. It goes on after that
    // stage instead, which also puts it in front of the handoff, where a build session reads
    // it first.
    dissentBlock = renderDissentBlock(openFailures);

    dispute = {
      ran: true,
      reason: disputeReasonOf(endingBase, true),   // 0.8.4 D1: was a chain of ternaries over the flags (noHeardReviewer, notQuorate, finishedStop, layerStop, earlyFinish, escalatedEnd, stalled, else round_cap); src/ending-matrix.js holds the same table
      stall_rounds: stalled ? stalled.rounds : null,
      stopped_at_round: noHeardReviewer ? noHeardReviewer.round : notQuorate ? notQuorate.round : layerStop ? layerStop.round : earlyFinish ? earlyFinish.pass : escalatedEnd ? escalatedEnd.pass : stalled ? stalled.round : (finalPanelRound ?? (Number.isInteger(finishedStop?.pass) ? finishedStop.pass : maxRounds)),   // a finish that cut the first pass leaves no panel round: the pass it cut, not the round cap
      open_objections: openFailures.map(f => ({
        criterion: f.criterion,
        lab: f.lab ? labFromKey(f.lab) : null,
        ...(f.lab && labFromKey(f.lab) !== f.lab ? { seat: f.lab } : {}),
        problem: f.problem || null,
        ...(f.id ? { id: f.id } : {}),
        ...(severityOn ? { severity: (() => { const sv = sevRun?.inForce(f.lab, f.id) ?? f.severity; return readSeverity(sv).ok ? sv : null; })() } : {}),   // unit 4a: the value IN FORCE (a re-tag included), as the end record and the ledger read it   // post-V fix-up: with the chain's severity switch on the tag as read (null where an objection has no readable one); switch off: no key
        first_raised_round: firstSeen.get(objectionKey(f)) ?? null,
        ...(f.cut_off ? { cut_off: true, last_raised_round: f.last_raised_round } : {}),   // item 2: raised by a judge whose row the finish cut off
        ...(f.unheard_in_final_round ? { unheard_in_final_round: true, last_raised_round: f.last_raised_round } : {}),
        ...(f.not_asked_in_final_round ? { not_asked_in_final_round: true, last_raised_round: f.last_raised_round } : {}),
        ...(f.escalated_standing ? { escalated_standing: true, last_raised_round: f.last_raised_round } : {}),   // stall escalation: passed up a layer, no ruling closed it
        ...(dissentKeys.has(`${f.lab}\u0000${f.id}`) ? { dissent: true } : {}),   // U1-2: this objection is also a dissent (see `dissents`)
      })),
      panel_rereviewed: false,
      // Additive: present only when the chain sets dispute.review.
      ...(review ? { review: { entries: review.entries, counts: review.counts } } : {}),
      ...(reviewSkippedAtOnce ? { review_not_run: 'finished_at_once' } : {}),
      ...(rewriteNotRun ? { rewrite_not_run: 'spending_limit' } : {}),   // 0.8.4 (--finish-now at a spending stop): the rewrite of the plan against the open objections would bill and was not made; the objections are recorded all the same   // additive: the chain set dispute.review and the person finished at once
    };
    log(`  recorded ${openFailures.length} unresolved objection(s) at the top of the deliverable. Outcome stays "no consensus".`);
  } else if (disputeEnabled && config.signoff === 'unanimous') {
    dispute = { ran: false, reason: disputeReasonOf(endingBase, false),   // 0.8.4 D1: was passed ? 'panel_signed_off' : the same ternaries, else 'no_open_objections' (the matrix's idle column)
     ...(noHeardReviewer ? { stopped_at_round: noHeardReviewer.round } : notQuorate ? { stopped_at_round: notQuorate.round } : layerStop ? { stopped_at_round: layerStop.round } : earlyFinish ? { stopped_at_round: earlyFinish.pass } : escalatedEnd ? { stopped_at_round: escalatedEnd.pass } : {}) };
  }

  // 3b. Post-signoff challenge (config.challenge: { enabled: true }), v7
  // item 5. `enabled` is the only key chain.js or chain-lint.js ever reads -
  // one challenge, re-opening one decision, for one extra round, hard-coded
  // right here rather than pulled from config. Runs once, after the
  // critic/revise rounds are done (passed or round-capped), never inside the
  // loop above - it is a distinct, narrower stage, not another review round.
  let challenge = null;
  const challengeIsAJudgeAtOnce = config.challenge?.enabled === true && !agreedAtPoint && finishedAtOnce() && config.seats.critics.some(c => sameSeat(c, config.seats.challenger || config.seats.critics[0]));   // 0.8.4 (finish at once, found after 4a): with no challenger seat the challenge is asked of critics[0], a judge of the panel
  if (challengeIsAJudgeAtOnce) {
    log('\nStage: challenge not run (the person finished the run at once, and the challenger is a judge of the panel).');
    challenge = { ran: false, reason: 'finished_at_once' };
  } else if (config.challenge?.enabled === true && !agreedAtPoint) {
    log('\nStage: challenge (post-signoff, one decision, one round)');
    const challengerSeat = config.seats.challenger || config.seats.critics[0];
    let cs = null;
    try {
      cs = record(await invoke(challengerSeat, {
        system: R.CHALLENGE_SYSTEM,
        user: R.challengeUser({ request, criteria, draft, signoff }),
        log, label: 'challenge',
      }));
    } catch (err) {
      // 0.8.4 (finish at once at the spending limit): the challenge would bill; it is on the record of calls not made, and the plan stays as it is
      if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
      log(`  challenge: not asked (${notMadeWhy()}).`);
    }
    const parsed = cs ? parseJson(cs.text) : null;
    if (!cs) {
      challenge = null;
    } else if (parsed?.challenge === true && parsed.decision && parsed.evidence) {
      log(`  challenge raised against "${parsed.decision}" - evidence that would settle it: ${parsed.evidence}`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      let revisedText = null;
      try {
        revisedText = (await draftStage(reviserSeat, {
          system: reviserSystemOf(false, false)(open, !!fencedSource, promptOpts),
          user: R.reviserUser({
            request, criteria, draft,
            critique: { failures: [{ criterion: parsed.decision, problem: parsed.evidence, fix: '' }] },
          }),
          log, label: 'challenge-revise',
        })).text;
      } catch (err) {
        // 0.8.4 (finish at once at the spending limit): the challenge was raised (its call was paid earlier and replays) but its revision would bill: the plan is NOT revised, the challenge stays on the record as raised with no round reopened
        if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
        log(`  challenge: raised, but the revision was not made (${notMadeWhy()}); the plan stays as it is.`);
      }
      if (revisedText !== null) {
        const parsedRevise = parseDisputes(revisedText);
        takeLedger(parsedRevise, 'challenge-revise', false);
        noteLinesIgnored('challenge-revise', parsedRevise.noteLines, log);
        earlyFinishIgnored('challenge-revise', parsedRevise.earlyFinish, log);
        if (parsedRevise.draft !== draft) bodyChanges.push('challenge');
        draft = parsedRevise.draft;
        parsedRevise.disputes.forEach(reason => disputes.push({ round: 'challenge', reason }));
      }
      challenge = {
        raised: true,
        by: labOf(challengerSeat), ...seatField(challengerSeat),
        decision: parsed.decision,
        evidence_needed: parsed.evidence,
        reopened_rounds: revisedText !== null ? 1 : 0,
      };
    } else {
      log('  no challenge raised; the signed-off draft stands.');
      challenge = { raised: false };
    }
  }

  // 4. Optional final edit: strips chain artifacts. Never adds material.
  if (config.seats.finalist && !agreedAtPoint) {
    log('\nStage: final edit');
    const beforeFinal = draft;
    try {
      draft = (await draftStage(config.seats.finalist, {
        system: R.FINALIST_SYSTEM,
        user: R.finalistUser({ request, draft, history: history.join('\n\n') }),
        log, label: 'final',
      })).text;
    } catch (err) {
      // 0.8.4 (finish at once at the spending limit): the final edit would bill; the plan stays as the stages before it left it
      if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
      log(`  final edit: not made (${notMadeWhy()}); the plan stays as it is.`);
    }
    if (draft !== beforeFinal) bodyChanges.push('final_edit');
  }

  // Unresolved dissent goes on after the final edit, never before it: that stage strips
  // chain artifacts and would remove this as one. Placed ahead of the handoff on purpose -
  // the file a build session reads first should say what the panel could not settle.
  // 3c. Cold-reader coherence check (config.coldRead: { enabled: true }), harness features
  // v6 item A/6: catches a documented failure mode - internal contradictions merging can
  // leave behind - by having one fresh seat with zero debate context read only the
  // signed-off draft. No efficacy claim is made; this does not measure or assert that
  // output quality improves.
  // 0.8.2 (owner decision 4a, 5 Oct 2026): it runs AFTER the final edit, so the reader sees the text that is delivered (before 0.8.2 it ran before the final edit and read a draft the
  // delivered one could differ from); a reply that cannot be read, or a seat that cannot be reached, is `status: "not_judged"` (never a silent "no contradictions"); and its findings are
  // carried into the deliverable and WARNINGS.md (the CLI), not only report.json. The seat is a chain-file field and stays one: no seat is chosen for a chain here. A descending chain
  // runs it once, over the final stack (the plan sub-run is given none).
  let coldRead = null;
  let coldReadBlock = '';
  if (config.coldRead?.enabled === true) {
    log('\nStage: cold-reader coherence check (post-signoff, after any final edit, one fresh seat, draft only)');
    const coldReadSeat = config.seats.coldRead;
    if (!coldReadSeat) throw new Error('config.coldRead.enabled is true but config.seats.coldRead is not set - no fallback to another seat, since any seat that already saw debate context defeats the mechanism.');
    let cr = null;
    try {
      cr = record(await invoke(coldReadSeat, {
        system: R.COLD_READ_SYSTEM,
        user: R.coldReadUser(draft),
        log, label: 'cold-read',
      }));
    } catch (err) {
      if (err instanceof NotRunForLimit) { log(`  cold-reader: not asked (${notMadeWhy()}).`); }   // 0.8.4 (finish at once at the spending limit): not a seat that failed to answer: coldRead stays null and the call is on the record of calls not made
      else {
      rethrowControlFlow(err);
      log(`  cold-reader: no reply (${String(err.message).slice(0, 120)}) - NOT JUDGED.`);
      coldRead = { status: 'not_judged', reason_code: 'SEAT_UNREACHABLE', raised: false, contradictions: [] };
      }
    }
    if (cr) {
      const parsed = parseJson(cr.text, { strict: true });
      if (!parsed || typeof parsed.raised !== 'boolean') {
        const code = abstentionReasonCode(cr.usage || {}, coldReadSeat.maxTokens ?? DEFAULT_MAX_TOKENS);
        log(`  cold-reader: the reply could not be read (${code || 'REPLY_UNPARSEABLE'}) - NOT JUDGED, which is not the same as "no contradictions".`);
        coldRead = { status: 'not_judged', reason_code: code || 'REPLY_UNPARSEABLE', raised: false, contradictions: [] };
      } else {
        const contradictions = Array.isArray(parsed.contradictions)
          ? parsed.contradictions
              .filter(c => c && typeof c.note === 'string')
              .map(c => ({ sections: Array.isArray(c.sections) ? c.sections : [], note: c.note }))
          : [];
        coldRead = { status: 'judged', raised: parsed.raised === true, contradictions };
        log(coldRead.raised ? `  cold-reader flagged ${contradictions.length} contradiction(s).` : '  cold-reader found no contradictions.');
      }
    }
    if (!coldRead) {
      // 0.8.4 (finish at once at the spending limit): not asked; no block, no record (the stage is named in stages_not_run)
    } else if (coldRead.status === 'not_judged') {
      coldReadBlock = `## Cold read: not done\n\nThe cold reader (a seat that never saw the debate) was asked to read this plan for contradictions between its own sections and gave no readable answer (${coldRead.reason_code}). Nobody has done that check.\n\n---\n`;
    } else if (coldRead.raised && coldRead.contradictions.length) {
      coldReadBlock = `## Cold-reader findings\n\nA reader who never saw the debate read this plan and found ${coldRead.contradictions.length} contradiction(s) between its own sections. ${passed === true ? 'The panel had already signed off' : 'The panel did not sign off on this plan'}; read these before acting on anything below.\n\n${coldRead.contradictions.map((c, i) => `${i + 1}. ${c.sections.length ? `(${c.sections.join(', ')}) ` : ''}${c.note}`).join('\n')}\n\n---\n`;
    }
  }

  // Unit D (B3 prep; 0.8.4 S16: no switch, every layered unanimous run): the plan is final here (the dispute rewrite, the challenge and the final edit have all run; the blocks are put above it below), so at a
  // not-agreed end every top-layer seat that has not read exactly this plan reads it once. The record joins the builder's blocks (it is a record, not plan text, and nobody re-reads it); the ending stays
  // "not agreed" and nothing it says reaches signoff[], panelVerdicts, `passed` or the ladder. Absent or false: nothing here runs and no key, block or stage label appears.
  let finalRead;
  let lateAll = endingRun ? endingRun.late : [];   // 0.8.4 S8 c2b: the late findings of the run: the ending exchange's, then the closing read's own (a new defect layer 3 found there); layer 3's sorting is put on them
  // 0.8.4 S8 (money step; C&C Q2 (ii)): a defect a top-layer seat named only in its sorting at the run's LAST verdict (layer 3 signed off, or objected at the overseer cap: no round follows, so it can never be raised as an objection) becomes a late finding, so the handler, the board and the handoff see it.
  // "Last" is decided here, after the loop, PER SEAT: a top-layer seat's newest non-carried readable verdict is its last (the seat is not asked again, so it can never raise the defect as an objection). While the seat is asked again the defect stays a `sorting_new` row. Never debated (not_debated stays true); rating null reads as 4 or above; `sorted` is the seat's own must-do.
  // 0.8.4 S18: the build check now reads the same list (climbLateFindings, defined beside askBuildCheck), so the ids it demanded are these. Joined with the ending exchange's findings by the same id rule.
  const climbNewLate = climbLateFindings();
  if (climbNewLate.length) lateAll = [...lateAll, ...assignLateFindingIds([...lateAll, ...climbNewLate]).slice(lateAll.length).map(lateFindingRow)];
  let finalReadBlock = '';
  if (layered && finalReadGate(config)) {   // 0.8.4 S16: always on (N6, no switch); a chain file naming `final_read` is refused by the lint
    const finalSha = draftIdOf(draft);
    const topSeats = topSeatsOf(config.seats.critics);
    const lastReadShas = layer3ReadShas(panelVerdicts, draftShaByRound, topSeats.map(seatKeyOf));
    // 0.8.4 S18 (DEFECT FIX, Muad's 30 Okt heading: an escalated layer-3 sign-off counts as agreed): the run had ended AGREED when every layer signed (`passed`) OR when layer 3 signed off and the handler said good to build (agreedByCheck: an escalated or ladder sign-off has `passed` false). The ending, the exit code and the final-read objection rule read this value (finalReadBlocksAgreement).
    const runEnd = passed || agreedByCheck ? 'agreed' : 'not_agreed';
    const viaHandler = agreedByCheck && !passed;
    // 0.8.4 S16 (D13, RU-ADD-A12): the list the seats sort now (the build check's open objections, then the late findings); a seat that read exactly this plan is still asked when this list holds an item its last verdict was not shown, or was shown under another text.
    const sortItemsNow = sortingOn(config) ? sortingItemsOf({ open: openAtAgreement({ round: finalPanelRound ?? 0, failures: askable }), late: withRatingsInForce(lateAll, sevRun?.retagsSoFar() ?? []), wrap: R.claimText }) : null;
    const shaMustRead = seatsToRead(finalSha, lastReadShas);
    const shownBySeat = new Map();
    for (const seat of topSeats) {
      const key = seatKeyOf(seat); let lastRound = null;
      for (const row of panelVerdicts) if (keyOfRecord(row) === key && !row.cut && (row.verdict === 'signed_off' || row.verdict === 'objected') && typeof draftShaByRound[row.round] === 'string' && (lastRound === null || row.round >= lastRound)) lastRound = row.round;
      let best = null; for (const [k, list] of climbItems) { const [r, sk] = k.split('\u0000'); if (sk === key && lastRound !== null && Number(r) <= lastRound && (best === null || Number(r) >= best.round)) best = { round: Number(r), list }; }   // the newest list that seat was shown at or before its last verdict (a carried verdict has none of its own round)
      const ownFindings = sortItemsNow ? sortItemsNow.items.filter(i => lateAll.some(l => l.id === i.id && l.found === 'last_verdict' && l.lab === key) || (i.kind === 'objection' && sortItemsNow.objections.get(i.id)?.lab === key)) : [];   // a defect the seat named in its own sorting at its last verdict, and an objection it raised itself, are words of its own: they need no second look (a sibling seat's objection, raised in the same pass, was not on this seat's list and is opened-since for it)
      shownBySeat.set(key, best || ownFindings.length ? [...(best ? best.list.items : []), ...ownFindings] : null);
    }
    const coverageMustRead = !passed && !agreedAtPoint && sortItemsNow && sortItemsNow.items.length ?   // 0.8.4 S16: at a NOT-agreed ending only (T9c, T21b name it); at an agreed ending the read belongs before the handler's check (the coverage commit's placement is on the open list)
      coverageGaps({ seats: topSeats.map(seatKeyOf).filter(k => !shaMustRead.includes(k)), shownBySeat, current: sortItemsNow.items, fpOf: i => draftIdOf(`${i.kind}\u0000${i.problem}`) }) : [];
    const mustRead = [...shaMustRead, ...coverageMustRead];   // every end, agreed included: a text changed after the sign-off (the challenge, the final edit, an escalated sign-off's dispute rewrite) is a text layer 3 has not read; and a seat that read this text but was never shown an objection opened or amended since
    const reused = !sortingOn(config) ? [] : reusedEntries({ seats: topSeats.map(seat => ({ key: seatKeyOf(seat), lab: labOf(seat), ...(seatField(seat).seat ? { seat: seatField(seat).seat } : {}), layer: seat.layer })), panelVerdicts, draftShaByRound, finalSha, mustRead });   // 0.8.4 S8 c2b (T9a): the seats not asked, with what they had said; recorded only while the sorting is on, so every other run's record is as it was
    if (!mustRead.length) {   // 0.8.4 (ONE RESULT FOR EVERY FINISH-NOW, C&C 10 Nov): every top-layer seat already read THIS text (the climb, a reused sorting): no read is owed, so a finish-now records exactly what the ordinary end records - what the top layer read stays on the record, the words follow it - and nobody is asked either way
      finalRead = finalReadRecord({ ran: false, reason: 'every_top_seat_read_this_plan', finalSha, runEnd, reused });
    } else if (finishedStop?.finished_at_once && !noMoneySitting && !judgeReplayOnly) {   // 0.8.4 (finish at once): a read is owed and the person ended the run at the stop, so no seat reads the plan again; the record says so and nobody is asked. The seats that DID read this text stay on the record (`reused`).
      log(`\nFinal read: not run (the person finished the run at once).`);
      finalRead = finalReadRecord({ ran: false, reason: 'finished_at_once', finalSha, runEnd, reused, relayed: finishedStop.relayed === true, coverageOnly: shaMustRead.length === 0 && coverageMustRead.length > 0 });
      finalReadBlock = renderFinalReadBlock(finalRead); if (finalReadBlock) harnessNotes.push('final_read_block');
    } else {
      log(`\nStage: final read (${passed ? `every layer signed off, but the plan changed after ${layerWord(topLayer)}'s last read` : viaHandler ? `${layerWord(topLayer)} signed off and the handler said good to build, but the plan changed after ${layerWord(topLayer)}'s last read` : 'the run ends without agreement'}: ${mustRead.length} ${layerHyphen(topLayer)} seat(s) have not read the plan as it stands${passed ? '' : ', or were not shown every open objection and late finding as it now reads'})`);
      const sortItems = sortItemsNow;   // 0.8.4 S8 c2a/c2b (built above since S16: the coverage test reads the same list): the build check's open objections and the late findings; the same set filters the reply, and its anchor flags come from the items
      const readArgs = {
        seats: topSeats.filter(seat => mustRead.includes(seatKeyOf(seat))), lastReadShas,
        request, criteria, draft, checks, fencedSource: !!fencedSource, excerptsMayBeShown, rulingsText: rulingsNote(finalPanelRound ?? 0), endMarker: endMarkerOn, invoke, record, log,
        sortItems,
        // 0.8.4 S16 (G2a, T21ao; used only once the final read's own words are recorded): per seat, whether it read exactly this text before, which items are NEW to it (opened or amended after its last sorting) and what it sorted before (its last readable verdict's sorting rows)
        seatInfo: new Map(topSeats.map(seat => {
          const key = seatKeyOf(seat); const read = lastReadShas.get(key) === finalSha;
          const seen = new Map((shownBySeat.get(key) || []).map(i => [i.id, draftIdOf(`${i.kind}\u0000${i.problem}`)]));
          const newIds = new Set(read && sortItemsNow ? sortItemsNow.items.filter(i => seen.get(i.id) !== draftIdOf(`${i.kind}\u0000${i.problem}`)).map(i => i.id) : []);
          let last = null; for (const row of panelVerdicts) if (keyOfRecord(row) === key && !row.cut && (row.verdict === 'signed_off' || row.verdict === 'objected') && (last === null || row.round >= last.round)) last = row;
          const prior = new Map((Array.isArray(last?.sorting) ? last.sorting : []).map(r => [r.id, { sort: r.sort, reason: R.claimText(String(r.reason ?? '')) }]));
          return [key, { read, newIds, prior }];
        })),
      };
      // 0.8.4 S16 (D; Q9(e), N6, F4): when NO top-layer seat has read the final plan (both unreadable after their re-asks), the run does not end: it STOPS here, resumable, and a continue is one more final read, a finish is one read and then an ending (once in a run), a revision outside the Council ends nothing.
      // Each read is a call set of its own with additive labels (`-c<n>`, `-f`): the first read's unreadable replies are on disk and would answer a re-read at no cost. `freshCalls` tells a finish whose read just ran from one answered from the record.
      const freshCalls = { n: 0 };
      const trackedInvoke = async (...a) => { try { const st = await invoke(...a); if (!st || st.cached !== true) freshCalls.n += 1; return st; } catch (err) { freshCalls.n += 1; rethrowControlFlow(err); throw err; } };   // a call that threw was sent (or tried) in this sitting too
      const readOnce = tag => runFinalRead(config, { ...readArgs, labelTag: tag, invoke: trackedInvoke });
      let entries = await readOnce('');
      const noneAsked = (noMoneySitting || judgeReplayOnly) && entries.length > 0 && entries.every(e => e?.not_run);   // 0.8.4 (finish at once at the spending limit): not one seat could be asked (no read of this plan is on disk and every call would bill)
      if (noneAsked) { entries = []; log(noMoneySitting && !outboundScan.endsOnSecret ? `\nFinal read: not run (the person ended the run at the spending limit, and no seat of ${layerWord(topLayer)} can be asked without a bill).` : `\nFinal read: not run (the person ended the run at once, and no read of this plan by ${layerWord(topLayer)} is on disk).`); }   // A-DRAFT (LAD-R22/R28)
      // Nobody has read the final plan: no top-layer seat read exactly this text before (the climb, a reused sorting, a coverage seat's earlier read) and none read it now. A seat that read it before makes this an ordinary not-agreed end (Q9(e): no stop, no continue, when the other seat read).
      const readThisBefore = topSeats.some(seat => lastReadShas.get(seatKeyOf(seat)) === finalSha);
      const nobodyRead = es => nobodyReadFinalPlan(readThisBefore, es);
      const chooser = hasHandlingSession(config);
      let frAttempt = 0;
      let finishReadUsed = roundChoices.some(c => c?.kind === 'layer_bound' && c.why === 'final_read' && c.finish_read_used === true);
      let finishedAtOnceRead = false;   // 0.8.4 (finish at once): the person ended the run at this stop, so no seat is asked again
      let finishedAtOnceRelayed = false;   // ... and whether the handling session relayed those words
      let finishKeepsVerdict = false;   // 0.8.4 (C&C's ruling of 10 Nov 2026, his 19:01 reason: "'not agreed' means they disagreed", and a read that got no usable reply is no disagreement): a finish-now at this stop of a panel that had SIGNED OFF before the read was tried keeps that verdict; one that was already not agreed stays not agreed
      while (!noMoneySitting && !judgeReplayOnly && nobodyRead(entries)) {   // the no-money sitting never stops here to ask the person (a seat not asked is on the record; the screen asks nothing)
        const stop = { kind: 'layer_bound', why: 'final_read', layer: topLayer, top_layer: topLayer, pass: Number.isInteger(finalPanelRound) && finalPanelRound >= 1 ? finalPanelRound : 1, overseer_round: ovOn ? ovState.overseerRound : 1, attempt: frAttempt, ...(chooser ? {} : { no_chooser: true }), ...(finishReadUsed ? { finish_read_used: true } : {}) };
        const choice = chooser ? roundChoices.find(c => c?.stop === stopIdOf(stop))?.choice ?? null : null;   // no handling session: nobody is named to choose, a recorded choice (run.json is project-writable) is not read
        if (choice === 'continue') { frAttempt += 1; entries = await readOnce(finalReadTag('continue', frAttempt)); continue; }
        if (choice === 'finish_now') {
          finishedAtOnceRead = true; finishedAtOnceRelayed = finishRelayedOf(roundChoices, stopIdOf(stop));
          finishKeepsVerdict = runEnd === 'agreed';   // the panel's verdict BEFORE the read was tried, from what the run already holds (passed, or the build check's good-to-build)
          if (finishKeepsVerdict) entries = [];   // no seat read the final plan: the record is the one of a read that was owed and not made (FS-2), not a read that ran
          // 0.8.4 (R1; C&C's result: a finish at once at the final-read stop records THAT stop, ending word finish_chosen, never round_cap; CHANGELOG `stop_kind`, schemas/report-v1.json): at a NOT-agreed end the finish is the person's, so it is a stop like every other finish-now (the shape of the other sites: the stop, chosen finish, finished_at_once, relayed).
          // Kept as it was: the kept-verdict finish above (the panel's verdict stands, so no stop shape that says NOT agreement), and an earlier finish at a stop that has words of its own (a credential-shaped pause, the spending limit, the owner's pause: finishedAtStopWords and finishedAtOnceNothingOpen leave those kinds out, and secretFinishWords, budgetFinishWords and ownerPauseFinishWords read that stop).
          if (!finishKeepsVerdict && !['secret_pause', 'budget_stop', 'owner_pause'].includes(finishedStop?.kind)) finishedStop = { ...stop, chosen: 'finish', finished_at_once: true, ...(finishedAtOnceRelayed ? { relayed: true } : {}) };
          log(finishKeepsVerdict
            ? `\nFinal read: no seat of ${layerWord(topLayer)} gave a usable reply, and the person finished the run at once${relayedTail({ relayed: finishedAtOnceRelayed })}: the run keeps the verdict the panel reached before the read, and nobody has read the final plan.`   // A-DRAFT (LAD-R45)
            : `\nFinal read: no seat of ${layerWord(topLayer)} gave a usable reply, and the person finished the run at once${relayedTail({ relayed: finishedAtOnceRelayed })}: it ends here, NOT agreed, and nobody has read the final plan.`);
          break;
        }
        if (choice === 'finish') {
          const before = freshCalls.n;
          if (!finishReadUsed) { entries = await readOnce(finalReadTag('finish')); finishReadUsed = true; if (!nobodyRead(entries)) break; }
          throw new RoundStopped({ ...stop, finish_read_used: true, finish_refused: freshCalls.n > before ? 'ran' : 'repeat' });
        }
        throw new RoundStopped(stop);
      }
      // 0.8.4 S8 (exit-list ruling T17m(2)): the combine is over EVERY top-layer seat's closing word (the seat's own sorting if it read, else its reused one), the closure's own seat set: an id is may_leave only when all of them said so
      const closingSeats = sortItems ? closingWords({ seats: entries, reused }).map(w => w.seat) : [];
      const sortedRows = sortItems ? combineSortings([...entries, ...reused].filter(e => e.sorting).map(e => ({ seat: e.seat ?? e.lab, rows: e.sorting })), closingSeats).map(r => (sortItems.unanchored.has(r.id) ? { ...r, unanchored: true } : r)) : null;   // an unanchored objection sorted must-do stays an objection, flagged
      finalRead = finalReadRecord({ ran: !noneAsked && !finishKeepsVerdict, ...(finishedAtOnceRead || noneAsked ? { reason: 'finished_at_once', relayed: finishedAtOnceRelayed || (noneAsked && finishedStop?.relayed === true) } : {}), finalSha, runEnd, seats: entries, sorting: sortedRows, reused, noHandler: !hasHandlingSession(config) });   // 0.8.4 S18 (D38): where no handler exists the record says nobody decided an objection of the final read
      // 0.8.4 S8 c2b: a new defect a layer-3 seat found at the closing read joins the late findings (ids over both lists together), and layer 3's sorting is put on the ending exchange's findings.
      const sortingLate = sortItems ? sortingFindingsOf({ perSeat: entries.filter(e => e.sorting_new && e.sorting_new.length).map(e => ({ seat: e.seat ?? e.lab, fresh: e.sorting_new })), groundedWhy: q => lateUngroundedWhy(q, normQuoteTight(draft)), round: finalPanelRound ?? 0 }) : [];
      // 0.8.4 S18 (T18j, WORDING S18-w18b): an UNANCHORED failure a top-layer seat sorted must-do at the final read (or at its last verdict, for a seat that did not need to read) is one late finding linked to it; the id is the same as the climb's, so the first one stands
      const unanchoredLate = sortItems ? lateFromUnanchored({ perSeat: [...entries, ...reused].filter(e => e.sorting).map(e => ({ seat: e.seat ?? e.lab, rows: e.sorting })), unanchored: sortItems.unanchored, objections: sortItems.objections, problems: sortItems.problems, round: finalPanelRound ?? 0, found: 'final_read', flag: 'named_in_final_read' }) : [];
      if (sortingLate.length || unanchoredLate.length) lateAll = [...lateAll, ...assignLateFindingIds([...lateAll, ...sortingLate, ...unanchoredLate]).slice(lateAll.length).map(lateFindingRow)];   // ids over both lists together (a fresh finding cannot collide with a listed one); the rows already recorded stay as they are
      if (sortedRows && sortedRows.length) lateAll = withSortedPerSeat(withSorted(lateAll, sortedRows), [...entries, ...reused].filter(e => e.sorting).map(e => ({ seat: e.seat ?? e.lab, rows: e.sorting })), closingSeats);   // a last-verdict finding keeps its finder's word unless the finder is asked again and says otherwise
      if (!noneAsked && !finishKeepsVerdict) finalReadLogLines(entries, runEnd, finalSha, viaHandler).forEach(l => log(l));   // A-DRAFT
      finalReadBlock = renderFinalReadBlock(finalRead, viaHandler);
      if (finalReadBlock) harnessNotes.push('final_read_block');
    }
  }

  // 0.8.4 S18 (spec l.1486, D31, W40; HELD behind handlerSortSystem + handlerSortUser): at a not-agreed end with a handling session where the overseer layer is split (one layer-3 seat objects, the other read this same text and signed), the run WAITS for the handler's sorting of each open objection of the final read.
  // The wait follows the final read as the good-to-build check follows it at an agreed ending: it is no act on the text. The ending stays not agreed; the objection stays open under the seat's name with its own rating.
  if (finalRead?.ran === true && finalRead.run_end === 'not_agreed' && hasHandlingSession(config) && handlerSortLive()) {
    const split = splitOfFinalRead(finalRead);
    if (split && split.ids.length && finishedAtOnce()) {   // 0.8.4 (C&C 10 Nov, ruled (a)): a finish-now sitting asks nobody, the handling session included: the objection stays unsorted and the record says so
      log(`\nSort wait: not run (the person ended the run at once, so the handling session is not asked to sort the objection; it stays unsorted).`);   // A-DRAFT (LAD-R29)
      finalRead = { ...finalRead, handler_sort_not_run: 'finished_at_once' };
      finalReadBlock = renderFinalReadBlock(finalRead);
    } else if (split && split.ids.length) {
      const sorts = [];
      for (let k = 0; k < split.ids.length; k++) {
        if (k === 0) log(`\nStage: sort wait (${split.objector.seat ?? split.objector.lab} objects to the final plan and ${split.signed.join(', ')} signed it; the handler is asked to sort the objection; the run ends not agreed whatever it answers)`);   // A-DRAFT (WORDING S18-w21)
        sorts.push(await askHandlerSort({ n: k + 1, id: split.ids[k], split }));
      }
      finalRead = withHandlerSorts(finalRead, split, sorts);
      finalReadBlock = renderFinalReadBlock(finalRead);   // deliverable.md is written once, at the run's end (cli.js), so the block shows the sort
    }
  }
  // 0.8.4 S8 c3: THE CLOSURE (D12, FEATURE_SPECS l.532). The dispute stage listed every open objection while layer 3 had not yet read the final plan; now its closing words are in (the final read's sorting, or, for a seat that had read exactly this plan, its sorting at its last verdict), and an objection every top-layer seat
  // sorted may-leave, that the ruling's own predicate closes (rated below 4, never 7 or above), is CLOSED. It stays in `dispute.open_objections` with `closed_by: 'final_read'` (the list says what the dispute stage saw; nothing is removed from it, but the entry loses its dissent mark); the readers of what is open at the run's end read `standingAtEnd` (NOT `stillOpen`: that is the answer-back import, and a top-level const of that name here would shadow it for the whole function). What was built before the
  // final read (the ending exchange, the dispute review, the build check) stands on the state it was given. Only with the sorting on: otherwise `closedKeys` is empty and every record and text is as before.
  const closedKeys = finalRead && sortingOn(config) && dispute?.ran === true && Array.isArray(dispute.open_objections)
    ? closedAtClose({ finalRead, open: askable.map(f => ({ key: `${f.lab}\u0000${f.id}`, id: f.id, closes: !!sevRun?.closesOnOverrule(f.lab, f.id, typeof f.severity === 'number' ? f.severity : null) })) })
    : new Set();
  const standingAtEnd = closedKeys.size ? openFailures.filter(f => !closedKeys.has(`${f.lab}\u0000${f.id}`)) : openFailures;
  if (closedKeys.size) {
    const closedIds = [];
    for (const o of dispute.open_objections) if (closedKeys.has(`${o.seat ?? o.lab}\u0000${o.id}`)) { o.closed_by = 'final_read'; delete o.dissent; closedIds.push(o.id); }   // `dissent` says "also a dissent, see `dissents`", and a closed objection has left that list (filtered below)
    dissentRows = dissentRows.filter(d => !closedKeys.has(`${d.seat ?? d.lab}\u0000${d.id}`));   // a dissent is an overrule that left the objection OPEN; one the handler later re-tagged below 4 (never 7 or above) and the closing read closed is not one (`dissentKeys`, built from the unfiltered list, is read only by the dispute stage's open_objections, above; `litigated` only by the dispute stage)
    dissentBlock = standingAtEnd.length ? renderDissentBlock(standingAtEnd) : '';   // the same function as the dispute stage, over the entries that stand; none left = no block, as for a run with no open objection
    log(`  final read: ${layerWord(topLayer)} closed ${closedIds.length} objection(s) rated below 4 (every ${layerHyphen(topLayer)} seat sorted them may-leave): ${closedIds.join(', ')}.`);   // A-DRAFT (WORDING row 1663)
  }
  // 0.8.4 S4 (CA4, D38, G11; src/ending.js): how layer 3's sign-off ended. Where there is no handling session to check the build the run ends agreed on a sign-off that every layer gave, unless a final read objects (copy correction 11, Muad's pick of 4 Nov 2026), and the record says that no build check was made; a ladder or escalated sign-off keeps today's rule (no ending). `passed` is not touched: it keeps its meaning. Where there is a handling session,
  // the build check decides, and while its wording is held no check is asked, so there is no `ending` and every reader falls back to `passed`. Compared by the PLAN's id (the body, not the delivered text with its blocks).
  const ending = layered && agreementPoint && buildCheckLive() ? endingOf({ agreement: agreementPoint, check: ((finishedStop?.kind === 'secret_pause' || finishedStop?.kind === 'budget_stop') && buildChecks.at(-1)?.pass !== agreementPoint.pass) ? null : (buildChecks.at(-1) ?? null), handling: hasHandlingSession(config), finalSha: draftIdOf(draft), finalRead, dissents: dissentRows.length }) : null;
  // 0.8.4 D1 (src/ending-matrix.js): the word for EVERY run that ends (report.json `ending_word`), now that S4's `ending` is known: it refines only a signed_off run whose ending says not agreed. `stop_kind` says which stop a finish was chosen at.
  const endingWord = endingWordOf({ passed, noHeardReviewer, notQuorate, finishedStop, layerStop, earlyFinish, escalatedEnd, stalled, ending });
  const stopKind = finishedStop ? stopKindOf(finishedStop) : null;
  // 0.8.2: the cold reader's findings go on after the dissent block (a build session reads what the panel could not settle first, then what the cold reader found).
  const bodyDelivered = draft; // the model-written text as delivered, before any harness block
  // Stall escalation: after an escalated sign-off a person reads first what happened to every objection that was passed up (overruled, sustained, standing), then the standing ones in full in the dissent block (A-DRAFT words).
  const escalatedBlock = escalatedEnd ? escalatedSignoffBlock({ end: escalatedEnd, escalations: escalationsWithNext(escalationsRecord(), { layerDebates, answerBackReplies, escalatedSignoff: escalatedEnd }), replies: answerBackReplies, signoff: signoff ?? [], standing: new Set(standingAtEnd.filter(f => f.escalated_standing).map(f => `${f.lab}\u0000${f.id}`)), agreed: ending?.kind === 'agreed', closed: closedKeys.size ? closedKeys : null }) : '';   // 0.8.4 S4: an escalated sign-off the handler agreed says so (the shared predicate reads `ending`)
  if (escalatedBlock) harnessNotes.push('escalated_signoff_block');
  if (dissentBlock) harnessNotes.push('dissent_block');
  // M1 COMPLETE U1-3 (WORDING D1-1; held behind `dissentRecordSection`): the dissents on the record, a harness block like the others (ends with a `---` line, so tree-split's bodyOfDelivered still finds the body). It exists in the AGREED case too, where no dissent block is built (the dispute branch is skipped); model-written fields are wrapped (claimText).
  const dissentRecordBlock = (() => {
    const word = held('dissentRecordSection');
    if (!dissentRows.length || typeof word !== 'function') return '';
    const text = word({ layer: dissentRows[0].ruling.layer, rows: dissentRows.map(d => ({ ...d, criterion: R.claimText(d.criterion ?? ''), problem: d.problem ? R.claimText(d.problem) : null, ...(d.quote ? { quote: R.claimText(d.quote) } : {}), ...(d.kept ? { kept: { ...d.kept, ...(d.kept.reason ? { reason: R.claimText(d.kept.reason) } : {}) } } : {}) })) });
    return typeof text === 'string' && text.trim() ? text : '';
  })();
  if (dissentRecordBlock) harnessNotes.push('dissent_record_block');
  if (coldReadBlock) harnessNotes.push('cold_read_block');
  if (escalatedBlock || dissentBlock || dissentRecordBlock || finalReadBlock || coldReadBlock) draft = `${escalatedBlock}${dissentBlock || ''}${dissentRecordBlock}${finalReadBlock}${coldReadBlock}${draft}`;

  // 5. Handoff (config.handoff): the file a build session reads first.
  let handoff = null;
  let handoffOpenRows = [];   // 0.8.4 round 1, 9a: the rows the handoff prompt lists at an agreed-on-the-check ending with objections open (raw problem text); the report records them in handoff_text.open_objections so `council handoff --from-run` gives its seat the same rows
  const draftForHandoff = draft; // what the handoff is made from (the delivered text at this point)
  if (config.handoff) {
    log('\nStage: handoff');
    const handoffSeat = config.seats.handoff || config.seats.builder;
    // 2b-1b, the FOLD (gate note Notes_Lane_2b1_Gate_Note.md section 2, C&C PASS ON CONDITIONS 16 Okt 2026): the items nobody answered ride INSIDE this call when the handoff seat IS the writer seat, so a chain pauses once, not twice.
    const foldRows = notesFoldRows(handoffSeat);
    // 0.8.4 round 1, 9a (his answer 9:a; A-DRAFT): a run that ended agreed on the handler's build check with objections still open (a ladder sign-off: layer 1's objection stands, passed false) gives the handoff seat those objections at the end of its user prompt, by id, rating and layer, quoted. Built ONLY at this ending: ending.kind agreed on the handler's check, the whole panel did not sign off, an objection stands at the end (what the final read closed is not one). No other ending changes.
    const standingKeys = new Set(standingAtEnd.map(f => `${f.lab}\u0000${f.id}`));
    const openAtHandoff = ending?.kind === 'agreed' && ending.basis?.includes('handler_check') && !signedAtPanel && standingKeys.size
      ? openAtAgreement({ round: finalPanelRound ?? 0, failures: standingAtEnd }).filter(i => standingKeys.has(`${i.lab}\u0000${i.id}`)).map(i => ({ id: i.id, layer: i.layer, severity: i.severity, problem: i.problem }))
      : [];
    handoffOpenRows = openAtHandoff;
    const atOnceCase = finishedAtOnceCase({ stop: finishedStop ?? earlyFinish, passed, signedText: { open_objections: signedAtPanel ? 0 : standingAtEnd.length }, dispute, ending, lateFindings: lateAll });   // R1/R2/R3 (held fixes): the facts the reason and the ending lines read, from the same fields every reader of the report reads
    const nothingStandsNow = nothingStandsAtEnd({ signedText: { open_objections: signedAtPanel ? 0 : standingAtEnd.length }, dispute, lateFindings: lateAll });   // M-reason: the one fact of nothing standing at the end, from the same fields as atOnceCase
    earlyNothingStands = atOnceCase?.early === true;   // R3 (C&C 80296ad3): the one fact, read again where the builder-task section is written
    let handoffStage = null;
    try {
      handoffStage = await draftStage(handoffSeat, {
        ...handoffPrompt({ config, request, draft, planFile: handoffPlanFileOf(config), checks, criteria, treeMember, ...(foldRows.length ? { notes: { rows: foldRows, ending: notesEnding() } } : {}), ending: { word: endingWord, reason: bannerReasonOf(endingWord, false, { nothingOpenAtOnce: finishedAtOnceNothingOpen({ stop: finishedStop, signedText: { open_objections: signedAtPanel ? 0 : standingAtEnd.length } }), atOnce: atOnceCase, nothingStands: nothingStandsNow }), agreed: agreedOf({ endingWord, passed, ending, finalRead }) }, ...(openAtHandoff.length ? { openObjections: openAtHandoff.map(r => ({ ...r, problem: R.claimText(r.problem) })) } : {}) }),
        log, label: 'handoff',
      });
    } catch (err) {
      // 0.8.4 (finish at once at the spending limit): the handoff would bill; it is not made, the run has no HANDOFF.md, and the screen says how to get one later
      if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
      log(`  handoff: not made (${notMadeWhy()}).`);
    }
    if (handoffStage) {
      const raw = handoffStage.text;
      handoff = raw;
      if (foldRows.length) {
        // The raw reply stays in the stage file `handoff.md` (draftStage wrote it): a replay re-derives the answers from it every time. Only the closing NOTE lines leave the TEXT everything downstream reads; no NOTE lines = every item stays unanswered, and NO fallback call runs.
        // 2b-1c (C&C condition 1 on a case-insensitive disk, where HANDOFF.md overwrites handoff.md after the run): the collected NOTE lines also get their OWN stage file, `handoff-notes.md`, written when the handoff call completes (a zero-cost
        // harness record, never a model call) and read back FIRST on every replay, so the answers never depend on the one file the CLI rewrites.
        const got = collectNoteLines(raw);
        const prior = cache.get('handoff-notes');
        // BUG-D-005 / BUG-C-013: the file is read back only when the handoff stage itself was REPLAYED; a handoff that ran live (a stale one re-run, or an external answer just pasted) takes its OWN reply's NOTE lines, and they are written fresh (cached: false).
        const usedPrior = handoffStage.cached === true && typeof prior?.text === 'string';
        const noteLines = usedPrior ? collectNoteLines(prior.text).noteLines : got.noteLines;
        // a replay records it too (cached: true, so the CLI does not rewrite it): a resumed run's report.stages keeps the row the first run had
        if (noteLines.length) record({ label: 'handoff-notes', provider: 'harness', model: 'none', lab: labOf(handoffSeat), usage: { input: 0, output: 0 }, usd: 0, priced: true, ms: 0, text: noteLines.join('\n'), cached: usedPrior });
        handoff = got.text; notesFolded = true;
        recordNoteAnswers(noteLines, 'handoff', { after: true, ending: notesEnding() });
      }
      // 0.8.4 slot H1-e (D17 T3.3 entry 5): the harness's no-test-file line goes after the seat's "Verify first" section (or ends the seat's text), here, once the seat's text has settled and before the harness's own sections are added below. The stage file keeps the seat's own words; idempotent, so a replay or a handoff.md / HANDOFF.md name collision adds it once. Nothing while the line is unrecorded.
      if (typeof handoff === 'string') handoff = withNoTestsLine(handoff, noFencedTestFile(request));
    }
  }
  // 2b-1b, the STANDALONE fallback: when the fold did not apply (no handoff stage, or a handoff seat that is not the writer) one `notes-answer` call over the same items. Never both; its text never becomes a draft or a handoff.
  if (notesOn && !notesFolded) {
    const writerSeat = config.seats.reviser || config.seats.builder;
    const rows = notesFoldRows(writerSeat, { standalone: true });
    if (rows.length) {
      log('\nStage: notes-answer');
      // The system prompt carries no quoted judge text: a short held writer line; the plan, then the items and the ask, ride in the user prompt.
      let reply = null;
      try {
        reply = (await draftStage(writerSeat, { system: held('reviewNotesAnswer')({ rows: [], standaloneSystem: true }), user: held('reviewNotesAnswer')({ rows, plan: draftForHandoff, ending: notesEnding() }), log, label: 'notes-answer' })).text;
      } catch (err) {
        // 0.8.4 (finish at once at the spending limit): the answers to the review notes would bill; the notes stay unanswered on the record
        if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
        log(`  notes-answer: not made (${notMadeWhy()}).`);
      }
      if (reply !== null) recordNoteAnswers(collectNoteLines(reply).noteLines, 'notes-answer', { after: true, ending: notesEnding() });
    }
  }

  // ROADMAP 83 (ruling d): every open objection of an early finish is carried into the handoff as a NAMED builder task. Written by the harness, not asked of the handoff model, so no model can drop one; appended AFTER the model's text as a
  // last `##` section, so the Status line (the top block before the first `##`) and the milestones section (which ends at the next `##`) read exactly as they did (test/early-finish-flow.test.js pins parseMilestones before and after).
  const tasksStanding = earlyTasks ? earlyTasks.filter(t => !closedKeys.has(`${t.lab}\u0000${t.id}`)) : earlyTasks;   // 0.8.4 S8 c3: a task the closing read closed is not a builder task (the rebuilt handoff, earlyTasksFromReport, leaves marked entries out too)
  const tasksToWrite = earlyFinish && typeof handoff === 'string' ? earlyTasksToWrite(tasksStanding, earlyNothingStands, closedKeys.size > 0) : null;
  if (tasksToWrite) handoff = withBuilderTasks(handoff, sevRun ? tasksToWrite.map(t => { const v = sevRun.inForce(t.lab, t.id) ?? t.severity; return readSeverity(v).ok ? { ...t, severity: v } : t; }) : tasksToWrite);   // TAGS SHOWN: the rating in force at the END, the value `dispute.open_objections` records, so the rebuilt handoff (earlyTasksFromReport) says the same
  // TAGS SHOWN (A-DRAFT): a run that PASSED with objections rated below the settle line still open lists them, with their rating, as the last section of its handoff (the severity record keeps them too). Written by the harness; nothing asks the handoff model for it.
  if (sevRun && passed && !earlyFinish && typeof handoff === 'string') {
    const heldOpenByFinalRead = new Set(openFinalReadRows(finalRead).map(r => r.id));   // 0.8.4 S18 (C&C's ruling on the restated must-do): an objection the top layer's final read holds open again is listed once, in the section of the final read's open objections; the swept record (severity.swept) is not touched
    const swept = (lastCritique?.failures || []).map(f => ({ id: f.id, lab: f.lab ? labFromKey(f.lab) : null, criterion: f.criterion, problem: f.problem, severity: sevRun.inForce(f.lab, f.id) ?? f.severity })).filter(r => readSeverity(r.severity).ok && !holdsSignOff(r.severity) && !heldOpenByFinalRead.has(r.id));
    if (swept.length) handoff = `${handoff.replace(/\s+$/, '')}${R.sweptObjectionsSection(swept)}`;
  }
  if (lateAll.length && typeof handoff === 'string') handoff = withLateFindings(handoff, withRatingsInForce(lateAll, sevRun?.retagsSoFar() ?? []), topLayer);   // late findings come from layered paths only (the ending exchange, the climb, the closing read): topLayer is set   // 0.8.4 S4b (A-DRAFT): the builder reads the late findings too (RU-S4-04/09: shown to the handler)
  // 0.8.4 S18 (WORDING S18-w14c, A-DRAFT, committed like the sections around it: HANDOFF.md is run output): the open objections of the final read go to the build list, read from the record's own mark (spec l.1486).
  if (typeof handoff === 'string') handoff = withFinalReadObjections(handoff, openFinalReadRows(finalRead), topLayer);
  if (typeof handoff === 'string' && finalRead && Array.isArray(finalRead.seats) && finalRead.seats.some(e => e.concern)) handoff = withConcerns(handoff, finalRead.seats.filter(e => e.concern).map(e => ({ lab: shownKey(e.seat ?? e.lab), text: e.concern })), R.claimText, topLayer);   // 0.8.4 S16 (I, D25; WORDING S16-w21): the concerns of the final read, after the late findings
  // 0.8.4 S18 (Q7, C&C F6: no new field; WORDING S18-w24, w25): what the top layer's closing words did to the objections still standing, read from the failures, the ruling's own predicate and final_read's sorting. At an AGREED ending the dispute stage does not run, so "Closed below 4" is read here (T21s, T21bc); the open ones the sorting did not close are listed with the sorting's reasons and any re-tag (T21t, T21ak), at both kinds of ending.
  const closingParts = typeof handoff === 'string' && finalRead && sortingOn(config) ? closingPartsOf({ open: standingAtEnd.map(f => ({ ...f, severity: sevRun?.inForce(f.lab, f.id) ?? f.severity, closes: !!sevRun?.closesOnOverrule(f.lab, f.id, typeof f.severity === 'number' ? f.severity : null) })), finalRead }) : { closed: [], openMayLeave: [] };
  if (closedKeys.size === 0 && closingParts.closed.length && typeof handoff === 'string') handoff = withClosedBelowFour(handoff, closingParts.closed.map(r => ({ ...r, lab: labFromKey(r.lab) })), R.claimText, topLayer);
  if (closedKeys.size && typeof handoff === 'string') handoff = withClosedBelowFour(handoff, closedRowsOf({ dispute, finalRead }), R.claimText, topLayer);   // the closure needs the final read, which needs a layered chain: topLayer is set   // 0.8.4 S8 c3 (A-DRAFT, WORDING row 1661): the build list is the handoff; what the closing read closed is shown, with layer 3's reasons
  if (closingParts.openMayLeave.length && typeof handoff === 'string') handoff = withOpenMayLeave(handoff, closingParts.openMayLeave.map(r => { const t = (sevRun?.retagsSoFar() ?? []).filter(x => x.id === r.id).at(-1); return { ...r, lab: labFromKey(r.lab), retag: t ? { from: t.from, to: t.applied_to ?? t.to, by: t.by, pass: t.pass } : null }; }), R.claimText, topLayer);

  // 5b. "How this plan was argued" (config.argued.enabled, src/argued.js). Opt-in, enabled in no
  // shipped chain. Runs once, on the handoff seat (the builder when there is no handoff seat) - an
  // external Claude Code session in the plan-7 chains, so no API call; a billed seat goes through
  // invoke() via draftStage like every other free-text stage, and --dry-run prices it. The writer
  // gets a fact pack built from this run's own record and nothing else, and its reply is checked
  // for ids and labs the pack does not contain. Written to ARGUED.md by the CLI, never into the
  // deliverable: the plan is what gets scored, reviewed and built, and a narrative citing proposal
  // ids inside it would be read as plan content. Absent or not `true`: nothing here runs, no stage
  // label appears, and the result carries no `argued` key.
  let argued;
  if (config.argued?.enabled === true) {
    log('\nStage: how this plan was argued');
    const facts = buildArguedFacts({
      proposals, scoreRows: proposals.length ? scoreProposals(proposals, draft, scoreText()).rows : [],
      debate, alternatives, disputes, dispute, signoff, panelVerdicts, plan: draft,
    });
    let text = null;
    try {
      text = (await draftStage(config.seats.handoff || config.seats.builder, {
        system: ARGUED_SYSTEM,
        user: arguedUser({ request, plan: draft, facts }),
        log, label: ARGUED_LABEL,
      })).text;
    } catch (err) {
      // 0.8.4 (finish at once at the spending limit): "how this plan was argued" would bill; no argued file, no argued key
      if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
      log(`  how this plan was argued: not written (${notMadeWhy()}).`);
    }
    const check = text === null ? null : checkArguedRefs(text, facts);
    if (check) argued = { file: ARGUED_FILE, text, facts_counts: facts.counts, check };
    if (check) log(check.ok
      ? `  ${ARGUED_FILE}: ${check.refs_cited} distinct id(s) and lab(s) cited, every one in the run's record.`
      : `  !! ${ARGUED_FILE}: names things the run's record does not contain - ${[...check.unknown_refs, ...check.unknown_labs].join(', ') || 'none'}; missing labs: ${check.missing_labs.join(', ') || 'none'}; missing sections: ${check.missing_sections.join(', ') || 'none'}.`);
  }

  // 6. Final security review (config.security_review.enabled, src/security-review.js). The very
  // last stage - after build, verify_post, every critic/revise round, the challenge, the final
  // edit and the handoff - so it always reviews the finished deliverable, never a draft that can
  // still change. Read-only: its reply is recorded, never assigned to `draft`, and never handed to
  // a reviser. Pause and spend-cap errors propagate like any other stage's; a reviewer that simply
  // fails to answer becomes a "not_judged" result, which is never a pass. Absent or not `true`:
  // never called, and the result carries no security_review key.
  let security_review;
  if (config.security_review?.enabled === true) {
    log('\nStage: security review (final, read-only)');
    try {
      security_review = await runSecurityReviewStage(config, {
        request, deliverable: draft, groundTruthPost: ground_truth_post, invoke, record, parseJson: t => parseJson(t, { strict: true }),
        abstentionReasonCode, rethrow: [ExternalPause, BudgetExceeded, SecretShapedPrompt, SecretFinish, DeniedModel, NotRunForLimit], log,
      });
      log(`  gate: ${security_review.gate} - ${security_review.findings.length} finding(s), ${security_review.blocking_count} blocking${security_review.reason_code ? ` (${security_review.reason_code})` : ''}`);
    } catch (err) {
      // 0.8.4 (finish at once at the spending limit): the security review (the default reviewer included: it is a fallback outside config.seats, and it bills) is not run; no security_review key, and the call is on the record of calls not made
      if (!(err instanceof NotRunForLimit)) { rethrowControlFlow(err); throw err; }
      security_review = undefined;
      log(`  security review: not run (${notMadeWhy()}).`);
    }
  }

  // Scoreboard: what each lab proposed and what the plan did with it. The
  // "built" column can only be filled after a build session; it is left to
  // the human on purpose (a part that reads well may not build).
  const scoreboard = proposals.length ? scoreProposals(proposals, draft, scoreText()) : null;
  // The default ledger check's findings (S3-03): the stage findings, plus the id check of the LAST writer's ledger, joined to `lints` (which the flag-gated lint may already hold). One problem, one entry.
  if (ledgerOutOn() && proposals.length) {
    const generic = ledgerIdFindings(scopeLedger ? scopeLedger.lines : [], proposals).filter(f => !ledgerDropped.has(f.message));
    const all = [...(lints || []), ...ledgerFindings, ...generic];
    const merged = all.filter((f, i) => all.findIndex(g => g.id === f.id && g.message === f.message) === i);
    if (merged.length) lints = merged;
  }
  if (scoreboard) {
    log('\nProposal scoreboard (built column: fill in after the build session)');
    for (const row of scoreboard.labs) log(`  ${row.lab.padEnd(12)} proposed ${row.proposed}  accepted ${row.accepted}  cut ${row.cut}  withdrawn ${row.withdrawn}  unaccounted ${row.unaccounted}`);
  }

  const ledger = proposals.length ? withdrawalLedger(proposals) : null;

  // 0.8.4 S18: the late findings a check demanded that the last verdict no longer carries. Never in lateAll: the sort list, the build list (HANDOFF), the board and every count show only the findings that are still carried; a dropped row exists so that build_checks[].required resolves.
  const droppedLate = [...lateDemanded].filter(([id]) => !lateAll.some(l => l.id === id)).map(([, e]) => ({ ...e.row, demanded_in: [...e.checks], dropped_after_check: true }));
  return {
    // 0.8.2 item 4 (additive; `passed` untouched): which text the panel signed, which text is delivered, what the handoff was made from.
    ...(() => { const l = buildTextLabels({ reviewedDraft, signed: signedAtPanel, round: signedTextRound, openObjections: signedAtPanel ? 0 : standingAtEnd.length, bodyChanges, harnessNotes, body: bodyDelivered, deliverable: draft, handoffMadeFrom: config.handoff ? draftForHandoff : null, handoffOpenObjections: handoffOpenRows }); return { signedText: l.signed_text, deliveredText: l.delivered_text, ...(l.handoff_text ? { handoffText: l.handoff_text } : {}) }; })(),
    deliverable: draft,
    criteria,
    ambiguities,
    questions,
    skeleton,
    proposals,
    proposalPool,
    dropouts,
    board,
    debate,
    handoff,
    scoreboard,
    passed,
    lastCritique: shownCritique(lastCritique),
    signoff,
    challenge,
    ...(callsNotRun.length ? { stages_not_run: [...new Set(callsNotRun.map(c => c.label))].map(label => ({ label, reason: callsNotRun.find(c => c.label === label)?.reason ?? 'spending_limit' })) } : {}),   // 0.8.4 (finish at once at the spending limit): every call that was not made, by label; additive
    coldRead,
    allocator: config.allocator?.enabled ? {
      targetedRounds: allocatorRounds,
      engagedCount: allocatorRounds.filter(r => r.engaged).length,
      rubberStampCount: allocatorRounds.filter(r => !r.engaged).length,
    } : null,
    disputes,
    regressions,
    panelVerdicts,
    ...(sevRun ? { severityRun: bareLabsOfSeverity(sevRun.snapshot()), severityAsked: severityOn } : {}),   // unit 3: the severity ledger of this run (report.json `severity`)
    // Additive: present only when a panel round heard no reviewer and the loop stopped there.
    ...(noHeardReviewer ? { noHeardReviewer } : {}),
    // Additive (0.8.3 E2b): the layered panel's per-round, per-layer record, and the stop of a layer that ended the run without a usable vote. Present only on a layered chain.
    ...(layered ? { layers: layersRecordOut(), ...(layerStop ? { layerStop } : {}), ...(ovOn ? { overseer_rounds: ovCompleted } : {}), ...(finishedStop ? { stop: finishedStop } : earlyFinish ? { stop: earlyFinish } : {}) } : (finishedStop?.kind === 'secret_pause' || finishedStop?.kind === 'owner_pause' ? { stop: finishedStop } : {})),
    // Additive (0.7.8): present only when the chain set a quorum and a round fell short of it.
    ...(notQuorate ? { notQuorate } : {}),
    // Additive (0.8.3 E4b): one row per conflict between layers the panel found (rule R), with the ruling or the reason nobody ruled. Present only when a conflict was found.
    ...(decisions.length ? { decisions } : {}),
    ...(dissentRows.length ? { dissents: dissentRows } : {}),   // M1 COMPLETE U1-2: the dissents (held behind dissentRecordSection), only at an end at the top layer's sign-off
    ...(escalations.length ? { escalations: escalationsRecord() } : {}),   // stall escalation, additive: present only when a stall was passed up a layer
    ...(escalatedEnd ? { escalated_signoff: escalatedEnd } : {}),   // the ending word: the top layer signed off with layers passed over (passed stays false)
    ...(buildChecks.length ? { buildChecks } : {}),   // 0.8.4 S4: every build check asked, in order, whatever the run's ending (report.json `build_checks`)
    ...(ending ? { ending } : {}),   // 0.8.4 S4: additive; present only on a layered run that reached layer 3's sign-off and has a recorded ending (src/ending.js)
    endingWord, ...(stopKind ? { stopKind } : {}),   // 0.8.4 D1: the matrix's word for every run that ends, and the kind of the stop a finish was chosen at (report.json `ending_word`, `stop_kind`)
    history,
    stages,
    totals: summarise(stages),
    orphanSections: ledger?.orphanSections ?? [],
    withdrawalCycles: ledger?.withdrawalCycles ?? 0,
    ...(notesOn ? { reviewNotes: notesBlock() } : {}),
    ...(ground_truth !== undefined ? { ground_truth } : {}),
    ...(argued !== undefined ? { argued } : {}),
    ...(toolRequestWarnings !== undefined ? { toolRequestWarnings } : {}),
    ...(canary !== undefined ? { canary } : {}),
    ...(lints !== undefined ? { lints } : {}),
    ...(scopeLedger ? { scopeLedger: scopeLedgerFile(scopeLedger) } : {}),   // the text of scope-ledger.md (cli.js writes it beside deliverable.md); absent while the switch is off
    ...(claims !== undefined ? { claims, claimWarnings } : {}),
    ...(preflight !== undefined ? { preflight } : {}),
    ...(ground_truth_post !== undefined ? { ground_truth_post } : {}),
    ...(security_review !== undefined ? { security_review } : {}),
    // Additive, per report.json's public contract: absent entirely on a chain that does not
    // enable the dispute stage, so nothing built on an existing run folder sees a new field.
    ...(dispute !== null ? { dispute } : {}),
    ...(finalRead !== undefined ? { finalRead } : {}),   // unit D; 0.8.4 S16: set on every layered unanimous run (no switch)
    // Additive: absent unless the task carried fenced source for quotes to be checked against.
    ...(fencedSource || quoteFindings.length ? { quoteFindings } : {}),
    ...(textRequestsLeft().length ? { text_requests_left: textRequestsLeft() } : {}),   // 0.8.4 D18: requests no later pause answered; the command records them unanswered   // 0.8.4 A7: an unfenced run reports findings only when it has any
    ...(config.revise?.mode === 'patch' ? { patchFallbacks } : {}),
    // Additive, per report.json's public contract: absent on any chain without the alternatives stage.
    ...(alternatives !== null ? { alternatives } : {}),
    // Additive: absent on any chain without the deep-dive seat (tiered councils).
    ...(deepDive !== undefined ? { deep_dive: deepDive } : {}),
    // Additive (0.8.0): the sign-offs whose criteria table skipped criteria; [] when there were none.
    missingCriteria,
    // Additive (0.8.2): present only when something happened - sign-offs refused for an incomplete table (signoff_table.required) and table rows that named no criterion.
    ...(signoffTableGaps.length ? { signoffTableGaps } : {}),
    ...(answerBackRecords.length ? { answerBack: answerBackRecords.map(shownFailure) } : {}),
    ...(answerBackReplies.length ? { answerBackReplies: answerBackReplies.map(shownFailure) } : {}),
    ...(writerNotes.length ? { writerNotes } : {}),
    ...(endingRun ? { endingExchange: endingRun.record } : {}), ...(lateAll.length ? { lateFindings: lateAll.map(l => (lateDemanded.has(l.id) ? { ...l, demanded_in: [...lateDemanded.get(l.id).checks] } : l)) } : {}), ...(droppedLate.length ? { lateFindingsDropped: droppedLate } : {}),   // 0.8.4 S4b: the ending exchange and its late findings (absent while W26 is held)   // 0.8.4 S4: the writer's fix notes (W34); absent while the wording is held
    ...(layerDebates.length ? { layerDebates } : {}),
    ...(proposerReturns.length ? { proposerReturns } : {}),   // 0.8.4 S9: report.json proposer_returns (additive; src/report-shape.js)
    ...(debateOrders.length ? { debateOrders: [...debateOrders].sort((a, b) => (a.stage + a.reader < b.stage + b.reader ? -1 : 1)) } : {}),
    ...(outsideCriteriaRowList.length ? { outsideCriteriaRows: outsideCriteriaRowList } : {}),
    criteriaLints,
    // Additive: absent unless the chain enabled criterion kinds (src/criteria-kinds.js).
    ...(kindsOn ? {
      criteriaKinds: kindsRecord(criteria, criteriaKinds),
      criteriaSummary: criteriaSummary(criteria, criteriaKinds, { metWithoutEvidence }),
      metWithoutEvidence,
    } : {}),
  };
}
