// The prompts are the product. Everything else is plumbing.
//
// Two rules decide whether this harness helps or just inflates output:
//
//  1. The critic is never asked "could this be better?" That question has
//     no false answer, so every stage adds scope and the chain drifts away
//     from what was asked. It is asked instead whether each written
//     acceptance criterion is met, and to quote the evidence.
//  2. The builder is told to fix only what the critic proved was missing.
//     Unrequested additions are a defect, not initiative.

export { BUILDER_SYSTEM, REVISER_SYSTEM, FINALIST_SYSTEM, EARLIER_PLAN_LABEL, builderUser, DRAFT_END_MARKER, criticUserHead, criticUser, BLOCKING_ANSWER_SYSTEM, blockingAnswerUser, claimText, boardText, reviserUser, finalistUser } from './prompts/core.js';
export { CHALLENGE_SYSTEM, challengeUser } from './prompts/challenge.js';
export { SKELETON_SYSTEM, PROPOSER_SYSTEM, skeletonUser, proposerUser, proposalsSection, JUDGE_SYSTEM, judgeUser, PROPOSAL_MERGE_SYSTEM, proposalMergeUser } from './prompts/proposals.js';
export { DEBATE_SYSTEM, DEBATE_GROUND_TRUTH_HEADING } from './prompts/debate.js';
export { REPLY_SYSTEM } from './prompts/tiered.js';
export { HANDOFF_SYSTEM, canaryPosterLabel, anonymise, debateUser, replyUser, renderBoard } from './prompts/debate.js';
export { ALTERNATIVE_SYSTEM, alternativeUser, ALT_DEBATE_SYSTEM } from './prompts/alternatives.js';
export { ALT_REPLY_SYSTEM } from './prompts/tiered.js';
export { altDebateUser, altReplyUser, renderAlternativesBoard } from './prompts/alternatives.js';
export { alternativesSkeletonSection } from './prompts/proposals.js';
export { alternativesBuilderSection } from './prompts/core.js';
export { handoffUser } from './prompts/alternatives.js';
export { QUOTE_RULE_CRITIC, QUOTE_RULE_CRITERIA, QUOTE_RULE_REVISER, DECISIONS_RULE_BUILDER, DECISIONS_RULE_REVISER, DECISIONS_RULE_CRITERIA, KINDS_RULE_CRITERIA, KINDS_RULE_CRITIC } from './prompts/scope.js';
export { COUNCIL_INTRO } from './prompts/recorded-083.js';
export { COUNCIL_INTRO_ASTRA, criticSystem, criteriaSystem, builderSystem, reviserSystem, proposerSystem, CRITIC_SYSTEM, CRITERIA_SYSTEM } from './prompts/scope.js';
export { QUESTIONS_SYSTEM, questionsUser, renderQuestions, answersSection } from './prompts/questions.js';
export { AMBIGUITY_SYSTEM, ambiguityUser, ambiguitiesSection, DESCENDING_BUILD_SYSTEM, descendingBuildUser, DESCENDING_CRITIC_SYSTEM, descendingCriticUser, CLAIM_EXTRACTION_SYSTEM, claimExtractionUser } from './prompts/ambiguity.js';
export { COLD_READ_SYSTEM, coldReadUser } from './prompts/cold-read.js';
export { DISPUTE_SYSTEM, disputeUser, DISPUTE_REVIEW_SYSTEM, disputeReviewUser, PATCH_REVISER_RULE, patchReviserSystem } from './prompts/dispute.js';
export { replySystem, altReplySystem, UNARGUED_STATUS, GUARD_BOARD_NOTE, DEEP_DIVE_JOBS, deepDiveVerdictLine, deepDiveSystem, deepDiveUser } from './prompts/tiered.js';
export { criticReaskNote, criticUnansweredNote, answerBackSection, reviserSystemWithIds, patchReviserSystemWithIds, reviserIdsNote, criteriaRetryNote, replyUserMarked, altReplyUserMarked, noQuoteGloss, debatePostQuoteRule, handoffSystem, handoffUserMilestones, LANE_TEXT, CONTRACT_DRAFT_SYSTEM, contractDraftUser } from './prompts/recorded-082.js';
export { reviewNotesAsk, reviewNotesRevise, reviewNotesMemory, reviewNotesAnswer } from './prompts/notes-lane.js';
export { conflictDeciderSystem, conflictDeciderUser, reviserDecisionNote, reviserEarlyFinishNote, earlyFinishAskSection, treeSplitWriterNote, treeSplitHandoffNote, treeChildTaskInstruction, criticStatedPassNote, otherReviewersBlock, verdictEnvelopeSection, criticEnvelopeReaskNote, criticEnvelopeUnreadableWhy, criticEnvelopeUnreadableLabel, overseerLedgerSection, severityWriterEdits, SEVERITY_WRITER_SENTENCE, sweptObjectionsSection, layerOneOpenSection, ledgerOverflowExit, escalationRulingSystem, escalationRulingUser, ledgerRulingsSection, LAYER_DEBATE_SYSTEM, rulingsSection, layerDebateUserHead, layerReplyUserHead, layerDebateUser, LAYER_DEBATE_AGAIN, LAYER_REPLY_SYSTEM, LAYER_REPLY_AGAIN, layerExchangeClosing, layerDebateSystem, layerReplySystem, layerReplyUser, layerExchangeReviseNote, exchangeWithdrawnSection, JUDGE_PERSONA_METHOD_LINES, judgePersonaBlock, SEVERITY_ANCHORS, SEVERITY_TOLD, SEVERITY_TOLD_PLAIN, SEVERITY_TOLD_HANDLER, SEVERITY_TOLD_BOTH, severityTold, severityRule, SEVERITY_FIELD, severityReaskNote, declinedReasonBlock, RETAG_FIELD_RULE, ledgerSeverityText } from './prompts/recorded-083.js';
export { builderLimitsRule, builderMarkersRule, criteriaQuotePhrase, criticExcerptOnlyRule, criticOnlySourceSentence, criticQuoteCopiedPhrase, criticQuoteFieldPhrase, criticQuoteNeverSentence, disputedMarkSentence, excerptAnswersField, excerptDeclinedNotice, excerptHiddenLinesMarker, excerptNotCutNotice, excerptRefusedNotice, excerptUnansweredNotice, excerptWithheldNotice, excerptsBlock, externalStageParagraph, failedRowAbsencePhrase, fenceHeaderOnlySource, handoffEndingLines, handoffOpenObjectionsBlock, handoffNoTestsLine, handoffPlanFileName, inExcerptLabel, oneShotAssumptionsReport, oneShotDependencyEnd, oneShotGapsTail, oneShotHandoffNote, oneShotItemOneClosing, oneShotReplanLead, reviserExcerptOnlyRule, reviserOnlySourceSentence, reviserQuoteFindPhrase, reviserQuoteFromSentence, sessionReadsField, textRequestsJudgeField, textRequestsList, textRequestsProposerField, verifyFirstItemOne, verifyFirstParagraph, verifyFirstStatusRule } from './prompts/recorded-084-a.js';
export { handlerRetagPickSystem, handlerRetagPickUser } from './prompts/recorded-084-a5.js';
export { buildCheckReasonsNote, buildCheckRefusalNote, buildCheckSystem, buildCheckUser, dissentRecordSection, earlyFinishAskSectionOpen, goUpRulingSystem, goUpRulingUser, goUpRulingsSection, handlerSortSystem, handlerSortUser, lastRoundReplyRule, lateFindingRule, layerOneGoUpLine, layerOneRulingsLedgerSection, layerOneRulingsReplyTail, layerOneRulingsSection, layerReplyAnchorRule, layerThreeReasonsSection, ratingDemand, relationRule, shortExchangeRule, signoffLineRule, signoffRefusedReaskNote, writerFixNote, writerReasonRule } from './prompts/recorded-084-b.js';
export { SEAT_VOICE_LINES, seatTitleBlock, seatVoiceBlock, stageInstructionsBlock } from './prompts/recorded-084-c.js';
export { criticExcerptOnlyRuleOrder, criticOnlySourceSentenceOrder, draftBoundarySentenceNeutral, draftEndLineNeutral, judgeKindLeadIn, orderInstructionsPhrase, repairFormatWhereOrder } from './prompts/recorded-084-cache-order.js';
export { draftBoundarySentence, draftStartLine } from './prompts/recorded-084-d27.js';
export { criticFixHint } from './prompts/recorded-084-fixline.js';
export { priorLedgerSection, proposalsSectionLedgerOut } from './prompts/recorded-084-ledger-out.js';
export { attachedQuoteLabel, criticQuoteFieldSentence, layerDebateOwnQuoteSentence, layerReplyQuoteSentence, ownFailuresBlock } from './prompts/recorded-084-s14.js';
export { finalReadPartRule, finalReadRule, finalReadSortingForm, finalReadSortingItems, lateFindingRatingSentence } from './prompts/recorded-084-s16.js';
export { layerThreeSortingForm, layerThreeSortingItems, layerThreeSortingRule } from './prompts/recorded-084-s8.js';
export { decisionLevelKeys, decisionLevelRule, decisionsNumberingRule, layerThreeSortingRouteClause, layerThreeSortingRouteKey, noProposerRouteNote, noProposerSortingRouteClause, proposerReturnAltUser, proposerReturnAnswerUser, proposerReturnPostUser, proposerReturnReplyForm, proposerReturnSystem, returnIntegrationNote } from './prompts/recorded-084-s9.js';
export { handlerSummaryEndLine, handlerSummaryInstruction } from './prompts/recorded-084-summary.js';
