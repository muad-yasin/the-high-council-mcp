// The roles.js split (0.8.4, row S1): src/roles.js is a list of exports by name, its words are in src/prompts/*.js. Pins: the 275 export names; roles.js holds nothing but its head comment and the export lines; every prompts
// file imports on its own and the import graph between them has no cycle (a cycle would make a top-level const read before it exists); no prompts file shares a name with a file under test/held-prompts/. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const promptFiles = () => readdirSync(join(root, 'src', 'prompts')).filter(f => f.endsWith('.js')).sort();

// the names src/roles.js exported when it was one file (dba32ac1), sorted: a name added or dropped changes this list on purpose, in the commit that does it.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: 171 names, including the ten advisor exports (ADVISE_CONFIDENCE, ADVISE_SYNTHESIS_SYSTEM, ADVISE_VERDICTS, ADVISOR_DEBATE_SYSTEM, ADVISOR_SYSTEM, adviseSynthesisUser, advisorDebateUser, advisorPositions, advisorText, advisorUser). NEW: 161 names. WHY: src/prompts/advise.js is deleted with the advice add-on and roles.js no longer exports them (REM-w29, Muad's Q6: prompts deleted, none added or changed; DEBATE_GROUND_TRUTH_HEADING stays in the list, now exported from src/prompts/debate.js).
// CHANGED ACCEPTED TEST (0.8.4 apply, the recording): OLD: 161 names. NEW: 273 names (the 161 plus the 112 held names the recording exports from the 13 src/prompts/recorded-084-<x>.js files, one export line each in src/roles.js). WHY: the 112 names were held test data until dc60423a recorded them whole (C&C's ruling of 11 Nov 2026); the list stays the exact sorted set src/roles.js exports.
// CHANGED ACCEPTED TEST (0.8.4 round 1, 9a): OLD: 273 names. NEW: 274 (+ handoffOpenObjectionsBlock, exported by name from src/prompts/recorded-084-a.js: the one import point of a prompt's words is src/roles.js). WHY: the pin says a name added changes this list on purpose, in the commit that does it. The witness stays: any other added or dropped name still fails the deepEqual below.
// CHANGED ACCEPTED TEST (0.8.4 round 2, R3/P2 held fix): OLD: 274 names. NEW: 275 (+ earlyFinishAskSectionOpen, exported by name from src/prompts/recorded-084-b.js: the early ask over an empty list or over objections of earlier passes; a NEW name, so the 0.8.3 sentence of earlyFinishAskSection is untouched). WHY: the pin is a count and a name list that move in the commit that adds a name (as 9a's did); no wording is pinned here.
const EXPORT_NAMES = [
  'ALTERNATIVE_SYSTEM', 'ALT_DEBATE_SYSTEM', 'ALT_REPLY_SYSTEM', 'AMBIGUITY_SYSTEM', 'BLOCKING_ANSWER_SYSTEM', 'BUILDER_SYSTEM',
  'CHALLENGE_SYSTEM', 'CLAIM_EXTRACTION_SYSTEM', 'COLD_READ_SYSTEM', 'CONTRACT_DRAFT_SYSTEM', 'COUNCIL_INTRO', 'COUNCIL_INTRO_ASTRA',
  'CRITERIA_SYSTEM', 'CRITIC_SYSTEM', 'DEBATE_GROUND_TRUTH_HEADING', 'DEBATE_SYSTEM', 'DECISIONS_RULE_BUILDER', 'DECISIONS_RULE_CRITERIA',
  'DECISIONS_RULE_REVISER', 'DEEP_DIVE_JOBS', 'DESCENDING_BUILD_SYSTEM', 'DESCENDING_CRITIC_SYSTEM', 'DISPUTE_REVIEW_SYSTEM',
  'DISPUTE_SYSTEM', 'DRAFT_END_MARKER', 'EARLIER_PLAN_LABEL', 'FINALIST_SYSTEM', 'GUARD_BOARD_NOTE', 'HANDOFF_SYSTEM',
  'JUDGE_PERSONA_METHOD_LINES', 'JUDGE_SYSTEM', 'KINDS_RULE_CRITERIA', 'KINDS_RULE_CRITIC', 'LANE_TEXT', 'LAYER_DEBATE_AGAIN',
  'LAYER_DEBATE_SYSTEM', 'LAYER_REPLY_AGAIN', 'LAYER_REPLY_SYSTEM', 'PATCH_REVISER_RULE', 'PROPOSAL_MERGE_SYSTEM', 'PROPOSER_SYSTEM',
  'QUESTIONS_SYSTEM', 'QUOTE_RULE_CRITERIA', 'QUOTE_RULE_CRITIC', 'QUOTE_RULE_REVISER', 'REPLY_SYSTEM', 'RETAG_FIELD_RULE',
  'REVISER_SYSTEM', 'SEAT_VOICE_LINES', 'SEVERITY_ANCHORS', 'SEVERITY_FIELD', 'SEVERITY_TOLD', 'SEVERITY_TOLD_BOTH',
  'SEVERITY_TOLD_HANDLER', 'SEVERITY_TOLD_PLAIN', 'SEVERITY_WRITER_SENTENCE', 'SKELETON_SYSTEM', 'UNARGUED_STATUS', 'altDebateUser',
  'altReplySystem', 'altReplyUser', 'altReplyUserMarked', 'alternativeUser', 'alternativesBuilderSection', 'alternativesSkeletonSection',
  'ambiguitiesSection', 'ambiguityUser', 'anonymise', 'answerBackSection', 'answersSection', 'attachedQuoteLabel', 'blockingAnswerUser',
  'boardText', 'buildCheckReasonsNote', 'buildCheckRefusalNote', 'buildCheckSystem', 'buildCheckUser', 'builderLimitsRule',
  'builderMarkersRule', 'builderSystem', 'builderUser', 'canaryPosterLabel', 'challengeUser', 'claimExtractionUser', 'claimText',
  'coldReadUser', 'conflictDeciderSystem', 'conflictDeciderUser', 'contractDraftUser', 'criteriaQuotePhrase', 'criteriaRetryNote',
  'criteriaSystem', 'criticEnvelopeReaskNote', 'criticEnvelopeUnreadableLabel', 'criticEnvelopeUnreadableWhy', 'criticExcerptOnlyRule',
  'criticExcerptOnlyRuleOrder', 'criticFixHint', 'criticOnlySourceSentence', 'criticOnlySourceSentenceOrder', 'criticQuoteCopiedPhrase',
  'criticQuoteFieldPhrase', 'criticQuoteFieldSentence', 'criticQuoteNeverSentence', 'criticReaskNote', 'criticStatedPassNote',
  'criticSystem', 'criticUnansweredNote', 'criticUser', 'criticUserHead', 'debatePostQuoteRule', 'debateUser', 'decisionLevelKeys',
  'decisionLevelRule', 'decisionsNumberingRule', 'declinedReasonBlock', 'deepDiveSystem', 'deepDiveUser', 'deepDiveVerdictLine',
  'descendingBuildUser', 'descendingCriticUser', 'disputeReviewUser', 'disputeUser', 'disputedMarkSentence', 'dissentRecordSection',
  'draftBoundarySentence', 'draftBoundarySentenceNeutral', 'draftEndLineNeutral', 'draftStartLine', 'earlyFinishAskSection', 'earlyFinishAskSectionOpen',
  'escalationRulingSystem', 'escalationRulingUser', 'excerptAnswersField', 'excerptDeclinedNotice', 'excerptHiddenLinesMarker',
  'excerptNotCutNotice', 'excerptRefusedNotice', 'excerptUnansweredNotice', 'excerptWithheldNotice', 'excerptsBlock',
  'exchangeWithdrawnSection', 'externalStageParagraph', 'failedRowAbsencePhrase', 'fenceHeaderOnlySource', 'finalReadPartRule',
  'finalReadRule', 'finalReadSortingForm', 'finalReadSortingItems', 'finalistUser', 'goUpRulingSystem', 'goUpRulingUser',
  'goUpRulingsSection', 'handlerRetagPickSystem', 'handlerRetagPickUser', 'handlerSortSystem', 'handlerSortUser', 'handlerSummaryEndLine',
  'handlerSummaryInstruction', 'handoffEndingLines', 'handoffNoTestsLine', 'handoffOpenObjectionsBlock', 'handoffPlanFileName', 'handoffSystem', 'handoffUser',
  'handoffUserMilestones', 'inExcerptLabel', 'judgeKindLeadIn', 'judgePersonaBlock', 'judgeUser', 'lastRoundReplyRule',
  'lateFindingRatingSentence', 'lateFindingRule', 'layerDebateOwnQuoteSentence', 'layerDebateSystem', 'layerDebateUser',
  'layerDebateUserHead', 'layerExchangeClosing', 'layerExchangeReviseNote', 'layerOneGoUpLine', 'layerOneOpenSection',
  'layerOneRulingsLedgerSection', 'layerOneRulingsReplyTail', 'layerOneRulingsSection', 'layerReplyAnchorRule', 'layerReplyQuoteSentence',
  'layerReplySystem', 'layerReplyUser', 'layerReplyUserHead', 'layerThreeReasonsSection', 'layerThreeSortingForm',
  'layerThreeSortingItems', 'layerThreeSortingRouteClause', 'layerThreeSortingRouteKey', 'layerThreeSortingRule', 'ledgerOverflowExit',
  'ledgerRulingsSection', 'ledgerSeverityText', 'noProposerRouteNote', 'noProposerSortingRouteClause', 'noQuoteGloss',
  'oneShotAssumptionsReport', 'oneShotDependencyEnd', 'oneShotGapsTail', 'oneShotHandoffNote', 'oneShotItemOneClosing',
  'oneShotReplanLead', 'orderInstructionsPhrase', 'otherReviewersBlock', 'overseerLedgerSection', 'ownFailuresBlock', 'patchReviserSystem',
  'patchReviserSystemWithIds', 'priorLedgerSection', 'proposalMergeUser', 'proposalsSection', 'proposalsSectionLedgerOut',
  'proposerReturnAltUser', 'proposerReturnAnswerUser', 'proposerReturnPostUser', 'proposerReturnReplyForm', 'proposerReturnSystem',
  'proposerSystem', 'proposerUser', 'questionsUser', 'ratingDemand', 'relationRule', 'renderAlternativesBoard', 'renderBoard',
  'renderQuestions', 'repairFormatWhereOrder', 'replySystem', 'replyUser', 'replyUserMarked', 'returnIntegrationNote', 'reviewNotesAnswer',
  'reviewNotesAsk', 'reviewNotesMemory', 'reviewNotesRevise', 'reviserDecisionNote', 'reviserEarlyFinishNote', 'reviserExcerptOnlyRule',
  'reviserIdsNote', 'reviserOnlySourceSentence', 'reviserQuoteFindPhrase', 'reviserQuoteFromSentence', 'reviserSystem',
  'reviserSystemWithIds', 'reviserUser', 'rulingsSection', 'seatTitleBlock', 'seatVoiceBlock', 'sessionReadsField', 'severityReaskNote',
  'severityRule', 'severityTold', 'severityWriterEdits', 'shortExchangeRule', 'signoffLineRule', 'signoffRefusedReaskNote', 'skeletonUser',
  'stageInstructionsBlock', 'sweptObjectionsSection', 'textRequestsJudgeField', 'textRequestsList', 'textRequestsProposerField',
  'treeChildTaskInstruction', 'treeSplitHandoffNote', 'treeSplitWriterNote', 'verdictEnvelopeSection', 'verifyFirstItemOne',
  'verifyFirstParagraph', 'verifyFirstStatusRule', 'writerFixNote', 'writerReasonRule'
];

test('the export-name pin: src/roles.js exports exactly the 275 recorded names, and none of the ten advisor names is among them', () => {
  assert.equal(EXPORT_NAMES.length, 275);   // 0.8.4 round 2 (R3/P2 held fix): + earlyFinishAskSectionOpen (src/prompts/recorded-084-b.js); 0.8.4 round 1 (9a): + handoffOpenObjectionsBlock (the block for a run agreed on the handler's check with objections open; src/prompts/recorded-084-a.js); 0.8.4 apply (dc60423a): 161 + the 112 held names the recording exports from the 13 src/prompts/recorded-084-<x>.js files
  for (const gone of ['ADVISE_CONFIDENCE', 'ADVISE_SYNTHESIS_SYSTEM', 'ADVISE_VERDICTS', 'ADVISOR_DEBATE_SYSTEM', 'ADVISOR_SYSTEM', 'adviseSynthesisUser', 'advisorDebateUser', 'advisorPositions', 'advisorText', 'advisorUser']) assert.equal(gone in R, false, `${gone} is gone`);
  assert.equal(R.DEBATE_GROUND_TRUTH_HEADING, 'Ground truth from the debate (tool output, verbatim)', 'the heading moved to src/prompts/debate.js, bytes unchanged');
  assert.deepEqual(Object.keys(R).sort(), EXPORT_NAMES);
});

test('src/roles.js is its head comment and export lines naming src/prompts/ files, nothing else; every name it exports comes from exactly one file', () => {
  const lines = readFileSync(join(root, 'src', 'roles.js'), 'utf8').split('\n');
  const code = lines.filter(l => l.trim() && !l.startsWith('//'));
  const EXPORT_LINE = /^export \{ ([A-Za-z0-9_]+(?:, [A-Za-z0-9_]+)*) \} from '\.\/prompts\/([a-z0-9-]+)\.js';$/;
  const seen = new Map();
  for (const l of code) {
    const m = EXPORT_LINE.exec(l);
    assert.ok(m, `src/roles.js holds something besides export lines: ${l.slice(0, 80)}`);
    assert.ok(promptFiles().includes(`${m[2]}.js`), `${m[2]}.js is not a file under src/prompts/`);
    for (const n of m[1].split(', ')) { assert.ok(!seen.has(n), `${n} is exported twice`); seen.set(n, m[2]); }
  }
  assert.deepEqual([...seen.keys()].sort(), EXPORT_NAMES);
});

test('each src/prompts/*.js file imports on its own, in a fresh process (no cycle that only works because another file was loaded first)', () => {
  for (const f of promptFiles()) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(root, 'src', 'prompts', f)).href)});`], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f} does not import on its own:\n${r.stderr}`);
  }
});

test('the import graph between the prompts files has no cycle', () => {
  const graph = new Map(promptFiles().map(f => [f, [...readFileSync(join(root, 'src', 'prompts', f), 'utf8').matchAll(/^import \{[^}]+\} from '\.\/([a-z0-9-]+\.js)';$/gm)].map(m => m[1])]));
  const state = new Map();
  const visit = (f, path) => {
    assert.notEqual(state.get(f), 1, `import cycle: ${[...path, f].join(' > ')}`);
    if (state.get(f) === 2) return;
    state.set(f, 1);
    for (const t of graph.get(f) ?? []) { assert.ok(graph.has(t), `${f} imports ${t}, which is not a prompts file`); visit(t, [...path, f]); }
    state.set(f, 2);
  };
  for (const f of graph.keys()) visit(f, []);
});

test('no src/prompts file shares a name with a file under test/held-prompts/ (the held drafts and the recorded words are told apart by name)', () => {
  const held = new Set(readdirSync(join(root, 'test', 'held-prompts')));
  for (const f of promptFiles()) assert.ok(!held.has(f), `${f} is also under test/held-prompts/`);
});
