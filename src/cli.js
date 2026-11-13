#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync, readdirSync, statSync, renameSync, realpathSync } from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopShaOf, spendFinishDecision, spendFinishState, spendFinishAnswer, spendFinishNote, SPEND_FINISH_BAD, spendFinishUnrecordedNote, spendFinishWithdrawnNote, spendFinishContinuedNote, spendFinishNowDecision, finishNowNote, finishNowBeforeRounds, finishNowLimitFired, finishNowScreen } from './spend-finish.js';
import { callGatesOf, finalReadOn } from './call-gates.js';
import { setPauseCheck, setZeroRetention, setPauseFinishCheck, setNoMoneySitting, setJudgeReplayOnly, NotRunForLimit, earlyTasksFromReport, withBuilderTasks, recordedSpentOf, runChain, setWordingStamp, wordingKept, routeKept, runSingleStage, draftIncomplete, draftCutOff, checkSeats, everySeatOf, everySeatSlotsOf, resolveChainSeats, panelLabCount, setCache, setBudget, setCapBudgets, setReservationSink, budgetState, countEarlierSpend, setProgressHook, setChargeHook, setOutboundScan, setSpendFinish, resetFieldCuts, fieldCutsSoFar, ExternalPause, BudgetExceeded, RoundStopped, UnpricedSeat, PreflightBlocked, DraftTruncated, renderDisputeReviewBoard, pendingPauses, setRepairPauses } from './chain.js';
import { registerSeatKeys, seatKeyOf, labFromKey } from './seat-key.js';
import { stampRow, personaUsageFields, personaPauseNote, scrubPersona } from './persona-record.js';
import { secretShapesIn, secretRefusalLines, SecretShapedPrompt, assertOutboundClean, newAllowKey, inputValueHashes } from './outbound-scan.js';
import { readSecretStop, secretStopRecord, secretPauseText, secretMemberStopText, secretFinishState, secretGateStopId, SECRET_STOP_FILE, SECRET_MARKER_FILE } from './secret-pause.js';
import { secretEndingOf, secretEndingSentence } from './secret-ending.js';
import { savedPiiGateRefusal, chainLintLines, missingKeyLines, piiGateReport, piiWarningLines, piiLogLines, policyGate, policyRefusalText, sideCommandGate, inputSecretFindings, inputSecretSources, textSecretFindings, secretScanRefusalLines } from './run-preflight.js';
import { BLOCKING_SEVERITIES } from './security-review.js';
import { deriveRunStatus, waitingStages, ARTIFACTS_BLOCKED_FILE, RUN_FOLDER } from './run-status.js';
import { acquireRunLock, RunLockedError } from './run-lock.js';
import { createInterface as createReadlineInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { askLine, mayOffer, needsOfSeat, offerPriceRaise, resumeAtExit } from './price-raise.js';
import { extraWithHighDefault } from './reasoning.js';
import { parseRoundFromLabel, classifyStageCompletion, classifyVerdictEvent, sumCostFromStageLogText } from './run-state.js';
import { resolveParentSpanId, recordRoundStageAndCheckClose, replaySpanStateFromStageLogText, sumRoundUsdFromStageLogText } from './spans.js';
import { appendSpanRecord, buildSpanRecord } from './progress-spans.js';
import { computeOutcome } from './outcome.js';
import { FIRST_WORDS, DEGRADED_WORDS, verdictShort, earlyFinishWords, secretFinishWords, budgetFinishWords, endingWords, agreedAfterEscalationWords, noBuildCheckWords, finishedAtStopWords, ownerPauseFinishWords } from './verdict-headline.js';
import { endsNotAgreed, hasHandlingSession } from './ending.js';
import { agreedOf, statusAllowedOf, finishedAtOnceNothingOpen, finishedAtOnceCase, topSignedNotAgreed, nothingStandsAtEnd } from './ending-matrix.js';   // 0.8.4 D1
import { clampStatus, CLAMPED_STATUS } from './handoff-status.js';   // 0.8.4 D29
import { refusedAnswersOf, refusalRowsOf, latestRefusalOf } from './build-check.js';
import { held } from './held-roles.js';
import { setEnvelopeStore, setEnvelopeInForce, fileEnvelopeStore, sideEnvelopeFlag } from './verdict-envelope.js';
import { askedForSentence, answerNoteOf, undeclaredNoteOf, NO_MODEL_SEAT } from './answered-by.js';
import { ledgerOverflowWords, reportJsonShape, thinContractOf, renderBoardMd, partialReportJsonShape, renderPartialBoardMd, PARTIAL_REPORT_FILE, PARTIAL_BOARD_FILE, PARTIAL_DELIVERABLE_FILE } from './report-shape.js';
import { resumeCeilingUsd } from './resume-ceiling.js';
import { userInfo } from 'node:os';
import { excerptSwitchRequest, excerptSwitchFlagRefusal, excerptWaitWords } from './excerpt-approval.js';
import { excerptChannelOn } from './excerpt-channel.js';
import { recordSessionReads, excerptBatch, recordUnaskedRequests, pendingExcerptCount, isExcerptLabel } from './excerpt-resume.js';
import { pauseAtApproval, recordApproved, completeUsedGates } from './excerpt-pause.js';
import { needsRequestsBlock } from './text-requests.js';
import { readExcerpts, liveExcerpts, excerptsReportEntry, externalStageBlock, excerptIdSetsOf } from './excerpt-record.js';
import { planChecksOf, planCheckLines } from './plan-checks.js';
import { ladderExpectedWords, ladderUpperWords, summarise, tokensLine, formatUsd, priceOf, priceProblemOf, estimateChainRows, rowBillsThroughCap, priceTableLines, DEFAULT_ESTIMATE, SEAT_DEFAULT_MAX_TOKENS, smallestCapThatPasses, needsPrice, projectStage } from './cost.js';
import { providerNames, envKeyName, keyFor, isKeyOptional, call, setOpenRouterSessionId, isRetryable, setRequestDeadlineAt, failureFactsOf, causeClassOf } from './providers.js';
import { recordBudgetFinish, budgetFinishRecordFor, budgetPlainFinishRunState, budgetFinishStandsForContinue, capScopeSha256, relayedAnswersOf, declinedBySessionOf, rulingsOf, gatesOfKind, runCapAuthority, recordExcerptSwitchOn, excerptSwitchOf, excerptApprovalWaiting, excerptApprovalStops, requestGate, readGateAnswer, recordExcerptsRecorded, EXCERPT_APPROVAL_KIND, EXCERPTS_MAX, SHOWN_LINES_MAX, EXCERPT_LINE_NUMBER_MAX, readLedger as readGateLedger } from './gate.js';
import { writeStoppedMarker, writeAtomic, stoppedFileOf, STOP_CAUSES, readStoppedMarker, isRoundStop, isAdviceFolder } from './stop-files.js';
// The one fingerprint of a text (stage fingerprints, the policy hash, the cap scope, the handoff scopes); it lived in src/advice-run.js until 0.8.4.
const sha256Hex = text => createHash('sha256').update(text, 'utf8').digest('hex');
import { DEMO_REQUEST } from './mock-demo.js';
import { billedFieldsOf, discardedFieldOf } from './billed-facts.js';
import { foldProviderReportedInto } from './provider-reported.js';
import { foldCountedInto, countedSummaryOf, estimatedPartWords, settledWithoutFileOf, orphanSettledIdsOf } from './counted-spend.js';
import { readCompletedRun, generateDigestText, writeDigest } from './dissent-digest.js';
import { deniedReasonsOf, DeniedModel } from './denied-models.js';
import { spendReport, costToday, treeIsAbandoned, usageSpendOf } from './spend.js';
import { verdictStats, independenceStatsCsv } from './verdict-stats.js';
import { metricsReport } from './metrics.js';
import { withIntegrityFooter } from './integrity.js';
import { generateResumeBrief } from './resume-brief.js';
import { recordedChoiceFor, backedConflictChoices } from './tree-choice.js';
import { backedRoundChoices } from './backed-round-choices.js';
import { memberResumeRedirect, memberResumeCommand, memberTopUpCommand, memberStopContinue, memberWho, memberPrevailCommand } from './tree-redirect.js';
import { preflightCheck, checkArtifactReferences } from './preflight.js';
import { fenceFile, scanTaskForSecrets, fenceHeader, FENCE_MAX_BYTES } from './fence.js';
import { outsideFences } from './quote-check.js';
import { parseCriteriaFile } from './criteria-kinds.js';
import { lintCriteria } from './criteria-lints.js';
import { keyEnvValue, keySource, keyProblem } from './key-env.js';
import { applyEnvFile, envFilePathFor } from './env-file.js';
import { resolveRun, recordedRouteOf, KEY_STOPS } from './resolve-run.js';      // 0.8.4 the Claude route: the one place a chain gets its route (src/claude-route.js decides, src/resolve-run.js orders the steps)
import { routedSeatsWithoutWindow, skippedRoomLines } from './context-window.js';
import { routeLines, resumeStopLines, readClaudeRouteSetting, sessionStopsLines } from './claude-route.js';
import { resolveZeroRetention, zeroRetentionLines, readZeroRetentionSetting, zdrTableFor } from './zero-retention.js';
import { decidePersonaForm, personaFormLines, personaFormFlagRefusal, PERSONA_FORM_HELP_LINES } from './persona-form.js';      // 0.8.4 the persona form for one run (--persona-form)
import { refreshZdrList } from './zdr-refresh.js';      // 0.8.4 the optional zero-retention setting
import { CAPS_SETTING, parseCapsSetting, commandMaySpend, capsNotArmedSentence, capsRefusedClassOf, capsClassRefusalSentence, capsDryRunNote, capsDeferredStart, capsResumeClassOf, capsClassRefusalEntry, capsStartRefusalLine, perRunIsSet, capsWaitSentence, capsLogLine, readCapCeiling, capCeilingName, capsResumeVerdict, capsRaiseNameSentence, capsRaiseUnknownSentence } from './caps.js';
import { capsStartRefusals, capsInForce } from './uncovered.js';
import { pickDraft, pickBuildDraft, pickNoteLines, pickNotesLine, readCriteria, readChecks, existsExactCase, stopState, partialBanner, finishedState, externalPromptText, openObjectionsOfReport } from './handoff-from-run.js';
import { textSha256 } from './text-labels.js';
import { noteAddCommand } from './handler-notes.js';
import { summaryAddCommand } from './summary-add.js';
import { acceptCommand } from './accept-cli.js';   // 0.8.4 D2
import { withAcceptance } from './acceptance.js';
import { handoffPrompt, handoffPlanFileOf } from './handoff-prompt.js';
import { harnessVersion, sittingEntry } from './version.js';
import { writtenByRecord, textHashOf, keptLineOf, keptRouteLineOf } from './stale-guard.js';   // 0.8.4 T14: the record every stage gets of the code and sitting that wrote it
import { stageKindOf, answerShapeKindOf } from './stage-contract.js';
import { validateDeliverable } from './partial-deliverable.js';
import { fingerprintInputs } from './cache-integrity.js';
import { topLayerReadsMade, ladderBoundOf } from './ladder-resume.js';
import { staleFinishedStages, staleNoticeLine } from './stale-stages.js';
import { LADDER_BLOCK, LADDER_VISITS } from './ladder.js';
import { shortExchangeOn } from './short-exchange.js';
import { stepOk } from './ladder-steps.js';
import { relayCommand, rulingAddCommand, rulingWithdrawCommand, retagAddCommand, routeDecideCommand, pauseCommand } from './gate-relay-cli.js';
import { handlerRetagsOf } from './handler-retags.js';
import { makeStageCache, writeSideStage, foldSupersededInto, endpointField } from './stage-cache.js';
import { foldUnreplayedInto } from './unreplayed.js';
import { moneySectionOf } from './board-money.js';
import { supersededSpendOf, supersededStagesOf, recordLostCharge, recordCall } from './superseded.js';
import { idSlipRepairNeedsBody, repairNeedsBody, setAsideOriginal, tableRepairNeedsBody } from './near-json.js';
import { taskHashOf, checkFrozenScope, contextHashOf, checkFrozenContext } from './scope-freeze.js';
import { lockBlock, checkLock, checksOf } from './criteria-lock.js';
import { runSpentUsd } from './spend.js';
import { withdrawalLedger } from './withdrawal-ledger.js';
import { schemaVersionWarning } from './schema-version.js';
import { forecastCost } from './cost-forecast.js';
import { dryRunReport } from './dry-run.js';
import { callCeilingOf } from './call-ceiling.js';
// A static import, not a dynamic one - see the comment on runMcpServer in mcp/server.js for why.
// mcp/server.js's own self-invocation guard means this import alone never starts a server; only
// the explicit call below, inside the --mcp branch, does.
import { runMcpServer } from './mcp/server.js';
import { renderBoardHtml } from './board-export.js';
import { buildTranscript, renderTranscriptText } from './replay.js';
import { lintChain } from './chain-lint.js';
import { judgePersonaWarnings } from './judge-persona.js';
import { modelLabWarnings } from './lab-name-warnings.js';
import { raiseFlagRefusal, raiseChoiceRefusal, routeFlagRefusal } from './raise-flags.js';
import { controlHistory, routeRefusal, askRoute, routedStepsOf, runControlsOf, pausesOf, pauseDue, pauseFinishedFor, settlePauseAtResume, pauseStandsForMarker } from './run-controls.js';
import { pauseSentence } from './owner-pause.js';
import { reshuffleSeats, RematchRefused, rematchDestinationProblems } from './rematch.js';
import { computeVerdictDiff } from './verdict-diff.js';
import { computeRoleDiagnostics } from './role-diagnostics.js';
import { formatCouncilError, ERROR_CATALOG } from './errors.js';
import { parseChangeRequestFields, POLICY_PATH } from './policy.js';
import { deriveDisagreementGroups } from './disagreement-groups.js';
import { shouldEnableAudit, loadHmacKey, createAuditWriter } from './audit.js';
import { runCouncilReplay, replayDirFor } from './council-replay.js';

// v5 §1 candidate 4: distinct exit codes for a degradable condition (a
// stranger can fix it and continue - a missing key, an unpriced model)
// vs. a fatal one (nothing more can happen this invocation - a chain
// file that can't even be parsed). 1-4 are already used by this file's
// own existing exit paths (usage errors, ExternalPause, BudgetExceeded).
const EXIT_DEGRADABLE = 5;
const EXIT_FATAL = 6;
// Final security-review gate (src/security-review.js): the run itself completed and every artifact
// is on disk, but the gate did not pass. Kept distinct from every code above so a caller can tell a
// blocked or unjudged build from a crashed or degraded run.
const EXIT_SECURITY_BLOCKED = 7;
const EXIT_SECURITY_NOT_JUDGED = 8;
// Bug-audit fix, 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md #7): several different outcomes
// shared one code - 5 was both "a key is missing" and "preflight blocked the task", 2 was both a
// usage error and the artifact gate, 6 was a fatal error, a policy refusal and a locked run, and 1
// covered the PII gate and a changed task. A caller (a script, the MCP server, CI) could not tell
// them apart. Every guard that refuses a run now has its own code; the README lists them all.
const EXIT_ARTIFACTS_BLOCKED = 9;
const EXIT_PREFLIGHT_BLOCKED = 10;
// 0.7.9: also the outbound key scan (src/outbound-scan.js), on by default - both are "the input
// holds something that must not be sent".
const EXIT_PII_BLOCKED = 11;
const EXIT_POLICY_REFUSED = 12;
const EXIT_RUN_LOCKED = 13;
const EXIT_SCOPE_CHANGED = 14;
const EXIT_ALREADY_FINISHED = 15;
// CLI audit #5 (Review/PreRelease_Audit_cli_2026-09-23.md): a run that crashed mid-stage (a dead
// local model, a provider error nothing caught) rethrew and exited 1 - the code the README reserves
// for lint and missing input - with a raw stack and nothing in the run folder saying it stopped.
const EXIT_RUN_FAILED = 16;
// Pre-release audit 2026-09-23 (PreRelease_Audit_revise #1): a build, revise, dispute, final or
// handoff reply was cut off at its token cap and its one bigger-cap retry was cut off too (or the
// seat is external). The run stops rather than grade, report or ship the fragment.
const EXIT_DRAFT_TRUNCATED = 17;
// 0.8.3 M1 (owner decision 4, 8 Oct 2026): a recursive-councils tree refused the start or resume of one of its runs (the record does not allow that step, or cannot be read). New public surface; exit 4 keeps its one meaning, the spend cap.
const EXIT_TREE_REFUSED = 19;
// 0.8.3 M5e (C&C ruling, 9 Oct 2026): a `council tree resume` sitting stopped FOR A PERSON with nothing broken (an open stop holds children back, or the step belt ran out). Not 0 (not finished) and not 1 ("other"). The number lives in src/tree-resume.js (EXIT_STOPPED_FOR_PERSON); test/exit-codes.test.js compares the two.
const EXIT_TREE_STOPPED_FOR_PERSON = 20;
// 0.8.3 M6 typed cap T4a (typed-cap gate page section 8, Q6): a PAID run waits for a spending limit that a person types. The run folder and its limit screen are written, nothing is started, nothing is spent; `council gate answer` records the limit and `--resume` continues the same run.
const EXIT_AWAITING_USER_CAP = 21;
// Round semantics 2b / exit 22 (C&C ruling, 14-15 Oct 2026): EXIT_ROUND_STOPPED (23, a layered run stopped resumable at an overseer limit, waiting for the person's choice) and EXIT_NOT_AGREED (22, a run that FINISHED and whose panel did not agree: `passed` false in report.json)
// live in src/exit-codes.js, the one module the programs that spawn this CLI also read (test/exit-codes.test.js pins the rest).
import { EXIT_NOT_AGREED, EXIT_ROUND_STOPPED, EXIT_PRICE_REFUSED, EXIT_CONFLICT_ASKED, EXIT_ROUTE_REQUESTED, EXIT_AWAITING_EXCERPT_APPROVAL } from './exit-codes.js';
import { finalReadObjected, finalReadBlocksAgreement, finalReadSummaryLine } from './final-read.js';
import { ConflictAsked, setConflictChoices, parsePrevail, conflictAskedWords, seatsForOneKey } from './conflict-decider.js';
import { PriceRefused, setSeatSkips, priceRefusedWords, canSkip, refusedSet } from './price-refused.js';
import { scanArtifacts } from './key-redaction.js';
import { resetToolCallLog, renderToolsMd } from './tools.js';
import { arguedWarnings } from './argued.js';
import { councilCommand, unignoredEnvFile } from './invocation.js';
import { contextFileList, readContextFile, contextBundleText, ContextFileError } from './context-files.js';
import { sha256Of } from './thin-contract.js';
import { checkThinContract, renderCheck } from './thin-contract-check.js';
import { contractCommand } from './contract-cli.js';
import { contractCheckOf } from './run-contract-check.js';
import { contractDraftPrompt, finishDraft } from './contract-draft.js';
import { stripDeclined } from './draft-disputes.js';
import { SCOPE_LEDGER_FILE } from './scope-ledger.js';
import { piiModeSetting } from './pii-mode.js';
import { unpricedSeats } from './unpriced.js';
import { openReservations, unsettledReservations, unsettledUsd } from './spend-reservations.js';
import { capSpentOf } from './spend.js';   // DUALCAP 4c1/4c2: what a run folder recorded through ONE cap (one copy, shared with run-budget.js)
import { checkContract } from './contract-record.js';
import { builderSection, builderTaskBlock, checkFailuresOf } from './handoff-contract-text.js';
import { lintMilestones } from './milestones.js';
import { builderKindOf } from './builder-kind.js';
import { withNoTestsLine } from './verify-first.js';
import { noFencedTestFile } from './fence-tests.js';
import { criterionIds } from './criteria-ledger.js';
import { bodyOfDelivered, splitContractOf } from './tree-split.js';
import { trustedRunDir, readRunJson, readRunFile, readRecordedTask } from './run-files.js';
import { roundLimitsOf, limitReachable, isOverseerChain, setRounds, roundsSetting, stopSentence, stopIdOf, defaultAdd, roundChoiceEntry, stopOffersContinue, roundStopsInWords, roundStopPhraseOf, CONTINUE_WORDS } from './overseer-rounds.js';
import { cliChoiceFields, entryFieldsOf } from './stop-decision.js';
import { stopDecisionAnswerOf, closeStopAnswer, budgetStopWithSha, limitApprovedAfterGate, gateQuoteNamesHash, relayedSecretAnswerOf } from './stop-gate.js';
import { escalationCauseWords, escalationTriggersOf } from './escalation.js';
import { chainNameRefusal, DEFAULT_CHAIN, QUICK_START_CHAIN, defaultChainNotice, PROMOTED_CHAINS, outdatedChainHint } from './chain-name.js';
import { terminalSafe, escapeTerminalUnsafe } from './terminal-safe.js';
import { gateCommand, answerAtTerminal } from './gate-cli.js';
import { chainIsPaid, buildStartScope } from './start-scope.js';
import { authorizeStart } from './start-cap.js';
import { capScreenMemoryClause, notesMemoryClause } from './review-notes-lane.js';
import { buildCapScreen, preferenceSentence } from './cap-screen.js';
import { readUsdLimit, limitSource, isLimitPlaceholder, USD_LIMIT_AS_GIVEN } from './mcp/usd-limit.js';
import { setUserPrices, resetUserPrices, UserPriceFileError, userPriceLines, userRowOf, effectiveRow, priceSource } from './price-table.js';
import { setProviderPreference, resetProviderPreference, PreferenceFileError, preferenceRows } from './provider-preference.js';
import { TREE_ONLY_FLAGS, treeCommand } from './tree-cli.js';
import { findUnknownFlag, unknownFlagLine, findStrayPositional, strayPositionalLine } from './unknown-flag.js';
import { TreeRefusal } from './tree-record.js';
import { MONEY_EPS } from './tree-budget.js';
import { DEFAULT_MAX_USD } from './default-cap.js';
import { readTreeNodeFile, runTreeField, recordedPiiAllow, memberStart, memberPreflight, memberFlagRefusal, installMemberEndHook, installPostRunHook } from './tree-member.js';
import { memberRootCover, coverRanges } from './tree-member-cover.js';
import { memberEarlierPlan } from './old-plan.js';
import { basisField } from './counted-bases.js';
import { layerHyphen } from './top-layer.js';
import { runTopLayer } from './report-shape.js';
import { finalReadGate } from './final-read-gate.js';
import { capUsdNumber } from './cap-input.js';

// One lint gate for every path that calls runChain() on a chain file: the normal run and resume
// (above), --rematch and --replay (bug audit 2026-09-27 M2: both skipped it, so an edited chain
// could send a key to a foreign host on a rematch). Exit 1, the same messages everywhere.
// 0.8.4 (C&C ruling on FINDING 2): the plan the verify-first gap check reads is the model-written BODY of the delivered file, never the harness notes above it (a dissent block quotes judge text, which can carry a marker the plan lacks).
// The body is found by the reader the tree already uses (src/tree-split.js bodyOfDelivered: the suffix whose sha256 is delivered_text.body_sha256). A text that cannot be separated that way (no record, or a record that does not match the file) gives
// undefined, so the check is off for it: a limit, never a guess about where the notes end.
function gapPlanOf(text, delivered) {
  try { return bodyOfDelivered(text, delivered).body; } catch { return undefined; }
}
function exitOnLint(cfg, cfgPath) {
  const lintLines = chainLintLines(cfg, cfgPath);   // src/run-preflight.js (`council tree start` asks the same question before it writes a tree's record)
  if (lintLines) {
    for (const l of lintLines) console.error(l);
    process.exit(1);
  }
}

function exitOnSecretShaped(err, what, { member = false } = {}) {
  console.error(`\n${what}: refused - ${err.message}.`);
  for (const l of secretRefusalLines(err.findings.map(f => ({ where: `stage ${err.label} (${f.part} prompt)`, ...f })))) console.error(l);
  // a tree member takes no override: the flag is the one thing it is refused for, so it is never offered (the member unit's closing line, run-preflight.js)
  console.error(member ? 'Nothing was sent. A tree takes no override.' : `Remove the key from the input, or rerun with --allow-secret-shaped to send it deliberately.`);
  process.exit(EXIT_PII_BLOCKED);
}

const here = dirname(fileURLToPath(import.meta.url));

// Write under a temp name in the same directory, then rename: readers see the old file or the whole
// new one, never a torn write.
function writeFileAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

// Two roots, and the distinction matters once this is installed from npm
// rather than cloned. `pkg` is where the shipped assets live (chains/,
// pricing.json) - inside node_modules for an npx user. `work` is the user's
// own directory, where their .env, their task files and their run output
// belong. Resolving a task path against pkg sends an npx user looking for
// their own file inside node_modules, which is exactly what it did.
// In a cloned checkout the two are the same directory, so nothing changes.
const pkg = resolve(here, '..');
const work = process.cwd();

// Minimal .env loader. No dependency for four lines of parsing. The user's
// own directory wins; the package copy is the fallback that makes a cloned
// checkout behave as before.
// 0.8.4 DUALCAP unit 4b2: MAX_USD_PER_RUN as the process was GIVEN it, before a project .env may fill it (a project file only fills an unset value): Q1's refusal names where a
// run-wide figure was set (the environment, where the Desktop plugin's max_usd setting also lands, or the project .env), as readUsdCeiling does for COUNCIL_MAX_USD_LIMIT.
const PER_RUN_AS_GIVEN = process.env.MAX_USD_PER_RUN;
const envPath = envFilePathFor(work, pkg);
if (existsSync(envPath)) {
  applyEnvFile(readFileSync(envPath, 'utf8'), process.env, {
    onIgnored: name => console.error(`.env: ${name} is not read from a project .env file (it changes how the process runs, or is the operator's own setting); set it in the real environment instead.`),
    // 13 Oct 2026 (audit item 11, S02-2): a repeated spend setting stops every command, `--version` included (the first value would win silently).
    onRepeatedMoney: (name, sentence) => { console.error(sentence); process.exit(2); },
    onMalformedMoney: (name, sentence) => { console.error(sentence); process.exit(2); }, // 14 Oct 2026 (C&C's entry 5): a spend setting written as `"NAME"=5` or `NAME: 5` set nothing, in silence
    label: envPath,
  });
}

// The project's own price rows (0.8.3 user price row P2; gate page UserPriceRow_Gate_Page.md): read ONCE here for every command from the folder the command runs in; a resume reads the folder the run recorded (below). A file that cannot be
// read in full installs NOTHING (shipped prices only: an unpriced seat is then refused as usual) and the commands that price say why (refuseOnUserPriceProblem; `council doctor` reports it).
let userPriceProblem = null;
let preferenceProblem = null;
function loadUserPrices(folder) {
  try { setUserPrices(folder); userPriceProblem = null; } catch (e) { if (!(e instanceof UserPriceFileError)) throw e; resetUserPrices(); userPriceProblem = e; }
  // the project's host preference (0.8.4 unit 3) is read with the price rows but has its OWN problem and its OWN reset: a preference file that cannot be read never discards the price rows. Every command that prices or sends refuses on it, like on the price file.
  try { setProviderPreference(folder); preferenceProblem = null; } catch (e) { if (!(e instanceof PreferenceFileError)) throw e; resetProviderPreference(); preferenceProblem = e; }
}
function refuseOnUserPriceProblem() { const p = userPriceProblem ?? preferenceProblem; if (p) { console.error(`\n${p.message}`); process.exit(2); } }
loadUserPrices(work);

// `npx <local-tarball-or-package-spec> council demo` is a real invocation, not
// a hypothetical one: once npx has resolved a package spec to this package's
// one bin, it does not also strip a literal repeat of the bin's own name from
// the arguments that follow, so that repeat lands as argv[0] here. The
// `doctor`/`demo` checks below key off argv[0], so a redundant leading
// `council` (or its `relay` alias) silently fell through to the usage banner
// instead of running - caught by the 2026-09-13 tarball verification pass.
// Drop one such leading token before anything else looks at argv[0].
const rawArgv = process.argv.slice(2);
// Audit A1-1 (0.8.1): `--max-usd=0.2` used to match no flag, so the run silently got the $7 default while the log said --max-usd. A flag that takes a value is
// now read in both spellings (`--name value` and `--name=value`), in this one place, before anything else looks at argv.
const VALUE_FLAGS = new Set(['stop-gate', 'reason', 'zero-retention', 'persona-form', 'ruling', 'note', 'objection', 'summary-file', 'retag-objection', 'retag-severity', 'retag-reason', 'person-words', 'total', 'accounting', 'allow-size', 'prevail', 'allow-pii', 'accept-chain-limits', 'allow-unfenced', 'amend-cap', 'amount', 'chain', 'child-chain', 'claude-route', 'close', 'allow-pii-node', 'continue-node', 'finish-node', 'prevail-node', 'keep', 'context', 'criteria', 'date', 'days', 'draft', 'from-run', 'handoff', 'label', 'max-children', 'max-depth', 'max-runs', 'max-usd', 'milestone', 'model', 'obligation', 'out', 'pii-gate', 'provider', 'rematch', 'rematch-seed', 'replay', 'replay-date', 'repo', 'ladder-credit', 'ladder-exchange', 'resume', 'rounds', 'run', 'run-id', 'signoff', 'stop', 'task', 'top-up', 'tree-node']);
// 0.8.3 M0 (ROADMAP 37, owner 8 Oct 2026): the options that take NO value, the other half of the known list (VALUE_FLAGS above is the half that does). An option on neither list is refused below, exit 2,
// before anything else runs: `--dry` was not an option, was ignored, and the command it sat in started a real paid run. One list for every command, subcommands and the modules they hand argv to included
// (contract-cli.js: md, decide, decline; gate-cli.js: decline). `yes` is named only in the comment above `council init` (a deliberate no-op); `version` is read as argv[0].
// test/cli-unknown-flag.test.js fails if an option the CLI reads, or the README shows, is missing from the two lists.
const BOOLEAN_FLAGS = new Set(['route', 'continue', 'finish', 'finish-now', 'send-up', 'ladder', 'next-pass-layer-3', 'raise-cap', 'relayed', 'skip-seat', 'abandon', 'advice-meta', 'allow-secret-shaped', 'allow-task-drift', 'cost-today', 'csv', 'decide', 'decline', 'dry-run', 'forecast-cost', 'fresh', 'help', 'json', 'mcp', 'md', 'metrics', 'accept-plan', 'open-root-stop', 'scan-artifacts', 'spend', 'stats', 'version', 'yes', 'approve-excerpts', 'drop-excerpt']);
const expandEquals = args => args.flatMap(a => { const m = /^--([a-z][a-z0-9-]*)=([\s\S]*)$/.exec(a); return m && VALUE_FLAGS.has(m[1]) ? [`--${m[1]}`, m[2]] : [a]; });
const argvExpanded = expandEquals((rawArgv[0] === 'council' || rawArgv[0] === 'relay') ? rawArgv.slice(1) : rawArgv);
// Re-audit 2: a flag that takes no value, spelled `--flag=value` (`--dry-run=true`), used to be ignored, and the command then ran for real (a paid run under the default cap).
// Any `--name=value` still here after the expansion is refused, never ignored.
{
  const stray = argvExpanded.find(a => /^--[A-Za-z][A-Za-z0-9_-]*=/.test(a));
  if (stray) { console.error(`${stray}: this option takes no value (write it bare), or it is not an option of this command. Nothing was run and nothing was spent.`); process.exit(2); }
}
// 0.8.3 M0: an option that is on neither list is refused here, with the closest real one named (`--dry` -> `--dry-run`), instead of being ignored. Same point and same exit as the `--name=value` refusal above.
{
  const unknown = findUnknownFlag(argvExpanded, VALUE_FLAGS, BOOLEAN_FLAGS);
  if (unknown) { console.error(unknownFlagLine(unknown)); process.exit(2); }
}
// 0.8.3 M1 (C&C, 8 Oct): `--rematch` and `--replay` are paid calls on a finished run that run outside a tree's record. `--tree-node` together with either would be ignored on those paths, so it is refused (the lesson of
// `--dry`). Whether such a call on a tree member counts against the tree is an M2 question (PLAN 7.6, post-run paid calls).
if (argvExpanded.includes('--tree-node') && (argvExpanded.includes('--rematch') || argvExpanded.includes('--replay'))) {
  console.error('--tree-node: not allowed with --rematch or --replay (they spend outside the tree record, and the flag would be ignored). Nothing was run and nothing was spent.');
  process.exit(2);
}
// 0.8.4 S20 slice 2: `--route` and `--reason` are on the known list so that `council route-decide` gets past the refusal above, which means any OTHER command would read them as known and ignore them (`council --resume D --route` would run a paid pass at layer 1
// while the person thought it was routed). They are refused everywhere but under `council route-decide`.
// #16c: `--reason` is also an option of `council pause` (the handler's own reason for a request to pause); `--route` stays route-decide's alone.
if (argvExpanded[0] !== 'route-decide') {
  const stray = ['route', ...(argvExpanded[0] === 'pause' || argvExpanded[0] === 'accept' ? [] : ['reason'])].find(f => argvExpanded.includes(`--${f}`));
  if (stray === 'route') { console.error(`--route: an option of \`council route-decide\` only (the handler's decision on a request to start the next pass at layer 3). Nothing was run and nothing was spent.`); process.exit(2); }   // A-DRAFT
  if (stray) { console.error(`--reason: an option of \`council route-decide\`, \`council pause\` and \`council accept\` only (the handler's decision on a request to start the next pass at layer 3, its own request to pause a running run, or the reason for accepting a plan as it stands). Nothing was run and nothing was spent.`); process.exit(2); }   // A-DRAFT
}
// 0.8.4 S18 (Q4.3): `--note` and `--objection` are on the known list so that `council note-add` gets past the refusal above, which means any OTHER command would read them as known and ignore them (the `--dry` lesson). They are refused everywhere but under `council note-add`.
if (argvExpanded[0] !== 'note-add') {
  const stray = ['note', 'objection'].find(f => argvExpanded.includes(`--${f}`));
  if (stray) { console.error(`--${stray}: an option of \`council note-add\` only (the handling session's note on the build list after a run has ended), not of this command. Nothing was run and nothing was spent.`); process.exit(2); }   // A-DRAFT
}
// 0.8.4 item 6: `--summary-file` is an option of `council summary-add` only, for the same reason.
if (argvExpanded[0] !== 'summary-add' && argvExpanded.includes('--summary-file')) { console.error('--summary-file: an option of `council summary-add` only (the handling session\'s summary block at the top of the plan after a run has ended), not of this command. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT
// 0.8.4 D10 (plan A T5.5): `--approve-excerpts` is refused on anything that is not a start or a resume of a council run (src/excerpt-approval.js), the way the tree-only options are below.
{
  const refusal = excerptSwitchFlagRefusal(argvExpanded);
  if (refusal) { console.error(refusal); process.exit(2); }
}
// 0.8.4 the persona form for one run (src/persona-form.js): `--persona-form` is on the known list, so it is refused the same way everywhere that is not a start or a resume of a council run.
{
  const refusal = personaFormFlagRefusal(argvExpanded);
  if (refusal) { console.error(refusal); process.exit(2); }
}
// 0.8.3 M5: the options of `council tree decide` (--milestone, --amount, --max-runs, ...) are on the known list so that command gets past the refusal above, which means any OTHER command would read them as known and ignore
// them (`--dry` again). They are refused everywhere but under `council tree`, which refuses the ones its own verb does not take (src/tree-cli.js).
if (argvExpanded[0] !== 'tree') {
  const stray = TREE_ONLY_FLAGS.find(f => argvExpanded.includes(`--${f}`));
  if (stray) { console.error(`--${stray}: an option of \`council tree\` only, not of this command. Nothing was run and nothing was spent.`); process.exit(2); }
}
const argv = argvExpanded;
// 0.8.4 (Muad, 1 Nov 2026: "remove --send-up ... just deactivate it so it doesn't get offered anymore"): the flag stays a known boolean, so it is REFUSED here, in every mode and before anything is written, never silently ignored (the --dry lesson). A-DRAFT.
if (argv.includes('--send-up')) { console.error('--send-up is turned off in this version: to answer a stopped run, use --continue or --finish. Nothing was run and nothing was spent.'); process.exit(2); }
// 0.8.4 DUALCAP unit 2 (src/caps.js; C&C's rulings of 1 Nov 2026): the per-provider caps switch is read ONCE, here, after a project .env was applied (which cannot set it: env-file NEVER_FROM_ENV_FILE) and before
// any command runs. Every paid path passes this line (the MCP server, the JS API, tree members and the http server all spawn this file). A command that may spend (commandMaySpend, fail closed) is
// refused before anything is written or sent while the switch cannot be read and, until the per-provider caps are armed, while it is on (capsNotArmedSentence, temporary). A command that spends nothing runs as before.
// Unit 3a (C&C's Q1a / Q1b): with the switch on, a command of a REFUSED CLASS (a tree, a paid side command, the advice add-on: capsRefusedClassOf) gets its OWN sentence and exit code first; an honoured dry run of
// one gets a note (stdout, stderr beside --json so the JSON stays whole) and goes on, calling nothing.
// Unit 3b: a main START or RESUME that is no refused class (capsDeferredStart) is not refused here: it meets the start refusals after its own checks (below, right
// after the unpriced refusal), the not-armed line last. Every other line that may spend keeps the not-armed refusal here (fail closed). The answer is kept
// (capsSwitch, capsOn), so the start refusals read the same answer.
const capsSwitch = parseCapsSetting(process.env[CAPS_SETTING]);
const capsOn = capsSwitch.ok ? capsSwitch.caps : [];
// Unit 4b2: the caps this run is held to, one typed limit each (set on the main path, after the start refusals; read there and by capGateOrExit). [] = today's path.
let capsArmed = [];
// Unit 4c1: the cap the resumed run stopped at, and the caps this sitting asks a raise for (set on the main path before the gates; read by capGateOrExit).
let capsStopCap = null;
let capsRaiseTargets = [];
// Unit 4c1 (C&C, 1 Nov 2026): an EARLY raise names its cap, `--raise-cap <id>`, read ONLY with the switch on (with it off `--raise-cap` stays the boolean it always was, and
// a word after it stays a stray word, refused as before: OFF byte for byte). A token that starts with "--" is never the id (`--raise-cap --relayed`).
const raiseCapAt = argv.indexOf('--raise-cap');
const raiseCapId = capsOn.length && raiseCapAt !== -1 && typeof argv[raiseCapAt + 1] === 'string' && !argv[raiseCapAt + 1].startsWith('--') ? argv[raiseCapAt + 1] : null;
const argvForStray = raiseCapId !== null ? argv.filter((_, i) => i !== raiseCapAt + 1) : argv;
{
  const spends = commandMaySpend(argv);
  if (!capsSwitch.ok) {
    if (spends) { console.error(capsSwitch.sentence); process.exit(2); }
  } else if (capsOn.length) {
    const refusedClass = capsRefusedClassOf(argv);
    if (refusedClass && !spends) (argv.includes('--json') ? console.error : console.log)(capsDryRunNote(refusedClass, capsOn));
    else if (refusedClass) { console.error(capsClassRefusalSentence(refusedClass, capsOn)); process.exit(refusedClass.exit); }
    else if (spends && !capsDeferredStart(argv)) { console.error(capsNotArmedSentence(capsOn)); process.exit(2); }
  }
}
// T2-1 commit 5: read by the five paid side commands (--replay, --rematch, handoff, contract draft, digest --provider), which run above the main dry-run's own flag read; see sideGateOrExit below
const sideDryRun = argv.includes('--dry-run');
// T1-1 positional rule, ORDER (C&C FIX on 5837985, 14 Oct 2026; box suite: the generic line spoke before `--advice-meta`'s own refusal): the stray-word refusal is the LAST refusal before money moves. Every block
// calls this at the end of its own refusals, before its lock, its folder, its first write and its first call (and before a dry run prints), never at the top. `skip` = the command words ahead of the options (`contract draft` 2, `handoff` and
// `digest` 1, the main path 0). It is a function declaration so the subcommand blocks above the later consts can reach it.
// C&C ruling (14 Oct 2026): `--json` on a side command's dry run is refused, never ignored (a flag silently dropped is the T1-1 class, and a script that expects JSON gets text). Argv only, so it is made at the top of each side block,
// before anything is read; the stray-word refusal below stays the last one.
// D1: set by recordCallOrCharge (below) when a paid call's cost could not be recorded; declared up here with the other state the subcommand blocks use, because those blocks run before the later top-level declarations are evaluated.
let recordFailedWho = null;   // set once by recordCallOrCharge; the exit handler it installs says the reply was written only when the command is about to exit 0
function refuseSideJson(who) {
  if (sideDryRun && argv.includes('--json')) { console.error(`${who}: --json cannot be used with --dry-run here: the dry run prints text, so the option would be ignored. Nothing was run and nothing was spent.`); process.exit(2); }
}
function refuseStray(skip = 0) {
  const stray = findStrayPositional(argvForStray.slice(skip), VALUE_FLAGS, BOOLEAN_FLAGS);   // unit 4c1: the --raise-cap <id> word is no stray word under the switch
  if (stray) { console.error(strayPositionalLine(stray)); process.exit(2); }
}
// C&C ruling (14 Oct 2026, on the --json table): `--json` is read by exactly two things, the MAIN command's --dry-run (the JSON dry run) and the `council replay --run <folder>` transcript. Anywhere else it was silently ignored, and a script that
// expected JSON got text (the T1-1 class). It is refused there, argv only, before anything runs. The five paid side commands with --dry-run keep their own, more specific sentence (refuseSideJson, E 138). SUBCOMMANDS is every `argv[0] === '<word>'`
// dispatch in this file (test/json-flag-everywhere.test.js reads cli.js and fails if one is missing, so a subcommand added later cannot read --json by accident of being absent from the list); the mode flags are the main-path modes that answer
// and exit before the main dry run could print JSON. The only readers of --json are: this check, refuseSideJson, the `replay` transcript and the main dry run (`dryRun && argv.includes('--json')`).
const SUBCOMMANDS = new Set(['--version', '-v', 'accept', 'check-lock', 'contract', 'demo', 'digest', 'doctor', 'export-board', 'refresh-zdr-list', 'fence', 'gate', 'handoff', 'init', 'lint-criteria', 'relay-answer', 'replay', 'ruling-add', 'retag-add', 'note-add', 'summary-add', 'pause', 'ruling-withdraw', 'route-decide', 'tree', 'verify-handoff']);
const JSON_BLIND_MODES = ['--spend', '--cost-today', '--stats', '--metrics', '--forecast-cost', '--mcp', '--help', '--rematch', '--replay'];
{
  const ownSentence = sideDryRun && (argv[0] === 'handoff' || argv[0] === 'digest' || (argv[0] === 'contract' && argv[1] === 'draft') || argv.includes('--replay') || argv.includes('--rematch'));
  const reads = argv[0] === 'replay' || (sideDryRun && !SUBCOMMANDS.has(argv[0]) && !JSON_BLIND_MODES.some(f => argv.includes(f)));
  if (argv.includes('--json') && !reads && !ownSentence) { console.error('--json: only the main command\'s dry run (`council --chain <name> --dry-run --json`) and `council replay --run <folder>` read it, so here it would be ignored. Nothing was run and nothing was spent.'); process.exit(2); }
}
// Audit A1-5: an invalid cap (a corrupt run.json value, a malformed flag) stops the command with one clear line instead of a stack trace, before any spend.
// 0.8.2 item 8a for the side runs (--rematch, --replay): under a cap a seat with no price row is refused before anything is sent, with the same message and exit 5 as a run (the main path checks at its own start).
function refuseUnpricedOrExit(config, cap, { paidStart = false, roleLabel = null } = {}) {
  // T5: a paid side start (rematch, replay) has its limit typed later, so a `none` flag no longer lets an unpriced seat through; the refusal then names no cap. With a flag or the default, the text is the main path's (the number is the suggestion).
  if ((cap === null || cap === undefined) && !paidStart) return;
  if (!config) return;
  const found = unpricedSeats(config);
  if (!found.length) return;
  console.error('');
  for (const u of found) { console.error(formatCouncilError('COUNCIL-E002', { provider: u.provider, model: u.model, problem: u.problem, roles: roleLabel ?? u.roles, ...(cap === null || cap === undefined ? {} : { capUsd: cap }) })); console.error(''); }
  process.exit(EXIT_DEGRADABLE);
}
function setBudgetOrExit(cap) { try { setBudget(cap); } catch (e) { console.error(e.message); process.exit(2); } }
if (argv[0] === '--version' || argv[0] === '-v') {
  console.log(harnessVersion());
  process.exit(0);
}
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return (next && !next.startsWith('--')) ? next : true;
}
// 0.8.4 the Claude route: every site that turns a chain file into the roster a run uses goes through here (src/resolve-run.js). `meta` is the run's run.json for a site that reads an EXISTING run (the route it began with is checked, never obeyed from the file);
// a stop (a value that is not a route, `session`, a malformed key, a route that changed under a run) prints its sentence and exits 2 before anything is sent. `who` prefixes the sentence for a verb that is not the main run. Returns resolveRun's answer.
/** 0.8.4 the persona form of a run that is rematched or replayed: the chain is read BY NAME there, not from run.json, so the form the run saved (`persona_form`, typed at its start) is applied to the chain as it is read, as the route and zero retention are kept from run.json. A run with none keeps the chain file's own form; nothing is ever refused here (nothing is typed). */
const withSavedPersonaForm = (cfg, meta) => decidePersonaForm(cfg, { saved: meta?.persona_form, resumed: true }).config;
function routeRun(cfg, { meta, who, dry = false } = {}) {
  const f = flag('claude-route', undefined);
  const say = text => console.error(who ? `${who}: ${text}` : text);
  if (f === true) { say('--claude-route needs a value: auto, anthropic, openrouter or session. Nothing was started and nothing was spent.'); process.exit(2); }
  const r = resolveRun(cfg, { flag: f, env: process.env, recorded: meta ? { route: recordedRouteOf(meta) } : undefined, dry });
  // A malformed key exits as every other lab's malformed key does at the key check (missingKeyLines: EXIT_DEGRADABLE, a result of the key, "set it and run again"); a value that is not a route, or a route that changed under a run, is a refusal of what was typed or chosen (2).
  if (r.stop) { say(r.message); process.exit(KEY_STOPS.has(r.code) ? EXIT_DEGRADABLE : 2); }
  return r;
}
// 0.8.4 the optional zero-retention setting (src/zero-retention.js): decided AFTER the route, on the roster as it is sent, at every site that sends. `--zero-retention on|off`, else COUNCIL_ZERO_RETENTION (operator-only: a project .env never sets it), else the
// run's own record (`meta.zero_retention`, true when it began with the setting on: a record only keeps the setting on). A value that is not on or off exits 2 (a dry run too); with the setting on and a seat the table cannot serve, or a table older than its limit, a START
// exits 5 before anything is sent (the dry run reports the refusal and goes on); with it on the run switch is armed, so every OpenRouter call carries provider.zdr and provider.only (src/price-pin.js). Returns resolveZeroRetention's answer.
function zeroRetentionRun(cfg, { meta, who, dry = false } = {}) {
  const f = flag('zero-retention', undefined);
  const say = text => console.error(who ? `${who}: ${text}` : text);
  if (f === true) { say('--zero-retention needs a value: on or off. Nothing was started and nothing was spent.'); process.exit(2); }
  const list = zdrTableFor(meta?.cwd ? resolve(meta.cwd) : work);      // the shipped list, or the refreshed one of the folder the run was started in (as pricing.user.json: the recorded cwd of a resume); never wider than the shipped one
  const r = { ...resolveZeroRetention(everySeatOf(cfg), { flag: f, env: process.env, recorded: meta?.zero_retention === true, table: list.table, future: list.future }), asOf: list.table.asOf, source: list.source };
  if (r.stop) { say(r.message); process.exit(2); }
  if (r.on && list.problem) say(list.problem);      // an unreadable refreshed list is not used, and the person is told once
  if (!dry) {
    if (r.refusal) { say(r.refusal); process.exit(EXIT_DEGRADABLE); }
    setZeroRetention(r.on, list.table);
  }
  return r;
}
// 0.7.9: the outbound key scan's one override. Set here so --rematch and --replay (below, before the
// run-folder code) honour it too; a normal run adds the value saved in run.json further down.
const allowSecretShapedFlag = argv.includes('--allow-secret-shaped');
setOutboundScan({ allow: allowSecretShapedFlag });

// reportJsonShape() and the BOARD.md text now live in src/report-shape.js, shared with --replay.

// A run folder's report.json can exist but still be unreadable - truncated
// by a killed run, or hand-edited - and every read-only reporting command
// (doctor --run, export-board, replay) must degrade to a clean error
// rather than an uncaught SyntaxError and a raw stack trace.
function readReportOrExit(reportPath, cmdLabel) {
  let text;
  try { text = readFileSync(reportPath, 'utf8'); } catch {
    console.error(`${cmdLabel}: no report.json in ${dirname(reportPath)}`);
    process.exit(2);
  }
  try { return JSON.parse(text); } catch {
    console.error(`${cmdLabel}: report.json in ${dirname(reportPath)} is not valid JSON`);
    process.exit(2);
  }
}

// `council doctor` answers "can this actually run, right now, on this
// machine" for a stranger who just installed it - which keys are present (by
// name only, never the value), which shipped chains are runnable with those
// keys (or need nothing at all: mock and external seats never need a key),
// and the worst-case price of each. Zero network calls: this only reads env
// var names and chains/*.json and does the same static pricing math as
// --dry-run (estimateChainRows, shared from cost.js, not re-derived here).
// 0.8.4 `council refresh-zdr-list` (src/zdr-refresh.js): one public GET of OpenRouter's list of zero-retention hosts, narrowed to the shipped list, written to zdr-hosts.user.json in this folder; a failed refresh writes nothing (exit 1) and the refusal that asked for it stands.
if (argv[0] === 'refresh-zdr-list') {
  const r = await refreshZdrList({ work });
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  process.exit(r.ok ? 0 : 1);
}
if (argv[0] === 'doctor') {
  // `council doctor --run <folder>` (v5 §1 candidate 3): read-only check of
  // one run's withdrawal chains for a section that ended up with no
  // surviving owner - recomputed from proposals on disk rather than
  // trusting a stored field, so it still catches an older report.json
  // written before orphanSections existed.
  const runArg = flag('run', null);
  if (runArg) {
    const runDir = resolve(work, runArg);
    const reportPath = join(runDir, 'report.json');
    const report = readReportOrExit(reportPath, 'council doctor --run');
    const ledger = withdrawalLedger(report.proposals || []);
    if (ledger.orphanSections.length) {
      // Bug audit 2026-09-28 (area 4 MED-2): "cycle detected: 0 cycle(s)" for a plain withdrawal.
      console.error(`${ledger.withdrawalCycles ? `withdrawal cycle detected (${ledger.withdrawalCycles} cycle(s)); ` : ''}${ledger.orphanSections.length} withdrawn proposal(s) with no surviving owner: ${ledger.orphanSections.join(', ')} - check the deliverable's Scope ledger says each is dropped and why`);
      process.exit(1);
    }
    console.log(`No orphaned withdrawal chains in ${runDir}.`);
    process.exit(0);
  }

  // `council doctor --chain <file>` (v5 §1 candidate 5): fail-loud lint of
  // one chain config - missing stage contracts, unreachable stages, and
  // unrecognized provider references - before anything is ever run against
  // it. Takes a path (own chains/ or a shipped one), not a bare chain name,
  // so a chain still being drafted (not yet named/installed) can be linted.
  const chainArg = flag('chain', null);
  if (chainArg) {
    const chainPath = resolve(work, chainArg);
    if (!existsSync(chainPath)) {
      console.error(`council doctor --chain: no such file ${chainPath}`);
      process.exit(2);
    }
    let cfg;
    try { cfg = JSON.parse(readFileSync(chainPath, 'utf8')); } catch {
      console.error(`council doctor --chain: ${chainPath} is not valid JSON`);
      process.exit(2);
    }
    const findings = lintChain(cfg, chainPath);
    for (const w of modelLabWarnings(cfg)) console.log(`WARNING: ${w.message}`);   // #4 (A-DRAFT): one model under two lab names; a warning, never a lint finding
    for (const w of judgePersonaWarnings(cfg)) console.log(`WARNING: ${w.message}`);   // unit W (A-DRAFT): persona-without-switch is a warning, never a lint finding
    if (findings.length) {
      console.error(`\n${chainPath}: ${findings.length} problem(s)\n`);
      for (const f of findings) {
        console.error(`  [${f.kind}] ${f.message}`);
        console.error(`    fix: ${f.fix}\n`);
      }
      process.exit(1);
    }
    console.log(`${chainPath}: no lint problems.`);
    process.exit(0);
  }

  // `council doctor --scan-artifacts` (v5 §1 candidate 11): a key-shaped string pasted into a
  // task file or chain config is the one thing that can turn BYOK into a leaked secret, and this
  // repo is public. Scans the user's own task files and chain configs; never prints the matched
  // text, only where it was found.
  if (argv.includes('--scan-artifacts')) {
    const roots = [join(work, 'tasks'), join(work, 'chains'), join(pkg, 'chains')].filter(existsSync);
    const { findings, filesScanned } = scanArtifacts(roots);
    if (findings.length) {
      console.error(`key-redaction scan: ${findings.length} possible key(s) found across ${filesScanned} file(s) scanned:`);
      for (const f of findings) console.error(`  ${f.file}:${f.line}:${f.column} - looks like ${f.pattern} (value not shown)`);
      console.error(`\nRemove or rotate any real key found above before committing or sharing these files.`);
      process.exit(1);
    }
    console.log(`key-redaction scan: no key-shaped strings found across ${filesScanned} file(s) in ${roots.join(', ')}.`);
    process.exit(0);
  }

  console.log(`\nAPI keys (name only - the value is never read here beyond presence/absence):`);
  const names = providerNames();
  const nw = Math.max(...names.map(n => n.length));
  const present = new Set();
  for (const name of names) {
    const envName = envKeyName(name);
    const has = !!keyEnvValue(envName);
    if (has) present.add(name);
    const status = has ? (keySource(envName) === 'dialog' ? 'set (plugin settings dialog)' : 'set') : keyProblem(envName) ? 'set but malformed (a line break or another control character in it: nothing is sent with it)' : isKeyOptional(name) ? 'not required (local - a dummy or missing key is fine)' : 'not set';
    console.log(`  ${name.padEnd(nw)}  ${envName.padEnd(20)}  ${status}`);
  }

  { const setting = readClaudeRouteSetting(process.env.COUNCIL_CLAUDE_ROUTE, 'COUNCIL_CLAUDE_ROUTE'); if (!setting.ok) console.log(`\n${setting.message} Every run refuses to start until it is fixed.`); }
  { const setting = readZeroRetentionSetting(process.env.COUNCIL_ZERO_RETENTION, 'COUNCIL_ZERO_RETENTION'); if (!setting.ok) console.log(`\n${setting.message} Every run refuses to start until it is fixed.`); }      // 0.8.4 zero retention: a refused value is said once, like the route's
  console.log(`\nChains (runnable = every seat's provider has its key set, or is mock/external):`);
  const chainsDir = join(pkg, 'chains');
  const files = readdirSync(chainsDir).filter(f => f.endsWith('.json')).sort();
  const cw = Math.max(...files.map(f => f.length - 5));
  // A beginner's question is "what is the least I need to set up?", not "what is every chain's
  // state?". Collected while listing, answered after it (see "Start here" below).
  const schemaWarnings = new Map();
  const oneKey = new Map();
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(join(chainsDir, f), 'utf8'));
    // Pre-release audit 2026-09-23 (lint #3): this listing hand-built its own seat list and missed
    // the challenger, cold reader, claims, ambiguity, descending, preflight and default security
    // reviewer seats, so it called a chain "runnable" that a real run refuses. It now uses the same
    // enumerator the real run path checks (everySeatOf after vendor resolution).
    let resolved;
    try { const rr = resolveRun(cfg, { env: process.env }); resolved = rr.stop ? cfg : rr.config; } catch { resolved = cfg; }      // 0.8.4: the roster as the route would send it (a refused setting is said once, above the list)
    const seats = everySeatOf(resolved);
    const missing = checkSeats(seats);
    const runnable = missing.length === 0;
    const worst = estimateChainRows(cfg).reduce((sum, r) => sum + r.usd, 0);
    const most = estimateChainRows(cfg, { maximum: true }).reduce((sum, r) => sum + r.usd, 0);
    const label = f.replace(/\.json$/, '');
    const providers = new Set(seats.filter(Boolean).map(s => s.provider));
    const local = providers.has('ollama') ? '  (needs Ollama running locally, with the chain\'s models pulled)' : '';
    console.log(`  ${label.padEnd(cw)}  ${(runnable ? 'runnable' : 'blocked ').padEnd(8)}  expected ${formatUsd(worst).padStart(8)}, upper estimate ${formatUsd(most).padStart(8)}/run${runnable ? local : `  (missing: ${missing.join(', ')})`}`);
    // v5 §1 candidate 13: warn, never fail - an old chain file is read exactly as it always was.
    // Printed once per distinct warning after the list, with the chains it covers, rather than
    // once under every chain (48 identical lines buried the listing).
    const warning = schemaVersionWarning(cfg);
    if (warning) schemaWarnings.set(warning, [...(schemaWarnings.get(warning) || []), label]);
    // Chains whose paid seats all run on one key, with the person's own agent session (the `claude-code-session` seat) answering the rest (no other external seat, no mock seat: a seat answered through
    // a Claude or ChatGPT subscription is not "one key plus a session"; 0.8.4 HS, Muad 05 Nov 2026 22:19: every layered chain has a session; the 24 Okt "B sounds fine to me" decider exception is that seat too)
    // and no lint finding: the shortest path from "no keys" to a real council. Derived from the chain file, never from a name.
    const isSession = s => s.provider === 'external' && s.model === NO_MODEL_SEAT;
    const keyProviders = new Set(seatsForOneKey(resolved, seats).filter(Boolean).filter(s => !isSession(s)).map(s => s.provider));
    const keyNames = [...keyProviders].map(p => (p === 'mock' || p === 'external' || isKeyOptional(p)) ? null : envKeyName(p));
    if (keyNames.length && keyNames.every(Boolean) && new Set(keyNames).size === 1 && !lintChain(cfg, join(chainsDir, f)).length) {
      // The labs a chain advertises are its panel's: critics only, by labOf (a seat's own `lab`
      // wins). Counting every seat by model-id prefix called cheap-7-v2 a 9-lab chain while the
      // README calls it a seven-lab panel.
      oneKey.set(keyNames[0], [...(oneKey.get(keyNames[0]) || []), { label, worst, most, labs: panelLabCount(resolved) }]);
    }
  }
  for (const [warning, labels] of schemaWarnings) {
    console.log(`\n  schemaVersion (${labels.length} of ${files.length} chains): ${warning.split('\n').join('\n    ')}`);
  }

  console.log(`\nStart here:`);
  console.log(`  $0, no key:  "${councilCommand()} demo" shows every stage on a scripted example; "${councilCommand()} init" writes a task and chain you own.`);
  for (const [envName, chains] of oneKey) {
    const shown = chains.sort((a, b) => (b.label === QUICK_START_CHAIN) - (a.label === QUICK_START_CHAIN) || a.worst - b.worst).slice(0, 3).map(c => `${c.label} (expected ${formatUsd(c.worst)}, upper estimate ${formatUsd(c.most)}${c.labs ? `, ${c.labs} judges` : ''})`);   // the quick-start chain first (the README names it), then the cheapest
    console.log(`  one key:     ${envName} plus your agent session (Claude Code, for example) runs ${shown.join(', ')}`);   // A-DRAFT (WORDING HS-3): "alone" would be untrue; the swing-pause caveat goes (every chain listed pauses at its session seats)
  }
  console.log(`  before paying: "${councilCommand()} --task tasks/<yours>.md --chain <name> --dry-run" prices it; a paid run stops at the limit you type before it starts ($${DEFAULT_MAX_USD} is the default cap the dry run compares a chain with).`);
  if (unignoredEnvFile(work)) {
    console.log(`\nWARNING: ${join(work, '.env')} holds your API keys and git would commit it. Add ".env" to .gitignore before your next commit.`);
  }
  console.log('');
  for (const line of priceTableLines()) console.log(line);
  for (const line of userPriceLines()) console.log(line);
  if (userPriceProblem) console.log(`WARNING: pricing.user.json is not used at all: ${userPriceProblem.row ? `${userPriceProblem.row}: ` : ''}${userPriceProblem.why}.`);
  if (preferenceProblem) console.log(`WARNING: provider-preference.json cannot be read in full, so it is not used at all. The reason: ${preferenceProblem.row ? `${preferenceProblem.row}: ` : ''}${preferenceProblem.why}.`);
  console.log(`\nNo network calls were made - this only reads environment variable names and chains/*.json.`);

  // v5 §1 candidate 4: doctor's own diagnostic block also names every code
  // a stranger might see from a hard-fail path, so a code seen in a
  // terminal is greppable straight back to this same command.
  console.log(`\nError codes (see TROUBLESHOOTING.md for the full message and fix for each):`);
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
    console.log(`  ${code}  [${entry.kind}]  ${entry.title}`);
  }
  process.exit(0);
}

// `council demo` runs a $0, offline, no-keys-needed chain end to end with the
// mock provider (calls nothing real) and prints the resulting deliverable and
// debate board to stdout, so a stranger who just installed this can see the
// whole mechanism - proposals, anonymised debate, panel sign-off - work
// before ever touching a real key. The seats are mock-debate's, renamed to
// the `mock-demo-*` models, whose replies are the scripted photo-renamer
// scenario in src/mock-demo.js rather than the tests' placeholder text.
if (argv[0] === 'demo') {
  const demoConfig = JSON.parse(readFileSync(join(pkg, 'chains', 'mock-debate.json'), 'utf8'));
  const demoSeat = seat => ({ ...seat, model: seat.model.replace(/^mock-/, 'mock-demo-'), ...(seat.lab ? { lab: seat.lab.replace(/^mock-/, 'lab-') } : {}) });
  demoConfig.name = 'demo';
  for (const [role, seat] of Object.entries(demoConfig.seats)) {
    demoConfig.seats[role] = Array.isArray(seat) ? seat.map(demoSeat) : demoSeat(seat);
  }
  console.log(`\nThe High Council - offline demo (provider: mock)`);
  console.log(`No API key, no network call, $0. Every seat's reply below is scripted in advance`);
  console.log(`(src/mock-demo.js) - no model is judging anything. What is real is the mechanism`);
  console.log(`around them: blind proposals, anonymised debate, the board, panel rounds, the ledger.`);
  console.log(`\nThe request:\n\n${DEMO_REQUEST.replace(/^/gm, '  ')}\n`);
  const demoResult = await runChain({
    request: DEMO_REQUEST,
    config: demoConfig,
    log: line => console.log(terminalSafe(line)),
  });
  console.log(`\n${'='.repeat(72)}\nDELIVERABLE (the plan)\n${'='.repeat(72)}\n`);
  console.log(demoResult.deliverable);
  if (demoResult.board) {
    console.log(`\n${'='.repeat(72)}\nDEBATE BOARD\n${'='.repeat(72)}\n`);
    console.log(demoResult.board);
  }
  if (demoResult.handoff) {
    console.log(`\n${'='.repeat(72)}\nHANDOFF\n${'='.repeat(72)}\n`);
    console.log(demoResult.handoff);
  }
  console.log(`\nThat was $0 and touched no network - the mock provider calls nothing real.`);
  console.log(`Next: "${councilCommand()} init" writes a first task and chain you own, or`);
  console.log(`"${councilCommand()} doctor" shows which real chains your own keys can run and what each would cost.`);
  process.exit(0);
}

// `council init [--yes]` (v5 §1 candidate 6): the gap between "the demo
// ran" and "I can run my own task" is where a clone gets abandoned -
// `doctor` says what's broken and `demo` shows output, but neither
// leaves a stranger with a chain file they own and understand. This
// does: doctor's key check, a starter chain + task file written to the
// user's own directory, a real (no-network) price of that starter
// chain, then a canned, all-mock, 3-seat run executed end to end so the
// first artifact a stranger inspects is a real run folder, not just
// terminal output. `--yes` skips nothing interactive - there is nothing
// interactive to skip - it only exists so a script can invoke this
// without wondering whether it will ever prompt.
if (argv[0] === 'init') {
  console.log(`\ncouncil init - a first chain and task you own, plus one real run to look at.\n`);

  console.log(`API keys (name only - the value is never read here beyond presence/absence):`);
  const names = providerNames();
  const nw = Math.max(...names.map(n => n.length));
  let anyKeySet = false;
  for (const name of names) {
    const envName = envKeyName(name);
    const has = !!keyEnvValue(envName);
    if (has) anyKeySet = true;
    const status = has ? (keySource(envName) === 'dialog' ? 'set (plugin settings dialog)' : 'set') : keyProblem(envName) ? 'set but malformed (a line break or another control character in it: nothing is sent with it)' : isKeyOptional(name) ? 'not required (local - a dummy or missing key is fine)' : 'not set - a chain using this lab would abort (COUNCIL-E001), not degrade';
    console.log(`  ${name.padEnd(nw)}  ${envName.padEnd(20)}  ${status}`);
  }

  const chainsDir = join(work, 'chains');
  const tasksDir = join(work, 'tasks');
  mkdirSync(chainsDir, { recursive: true });
  mkdirSync(tasksDir, { recursive: true });

  // JSON has no comment syntax, so "commented" here means the same
  // "_note" convention src/pricing.json already uses: a real, readable
  // field that JSON.parse happily ignores as unused chain config.
  const starterChain = {
    _note: 'Your first chain. One seat writes a plan, one critic reviews it once. As written every seat is Anthropic, so this is one lab checking itself: put the critic on another lab you have a key for (e.g. provider openrouter, model openai/gpt-5.6-luna) to get a second lab\'s opinion. See README.md#chains for the full field list.',
    name: 'my-first-chain',
    description: 'A minimal real chain: one builder, one critic, one round.',
    maxRounds: 1,
    seats: {
      criteria: { _note: 'Writes the acceptance criteria before anything else exists.', provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 2000 },
      builder: { _note: 'Writes the first draft.', provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 8000 },
      critics: [{ _note: 'Reviews the draft against the criteria. Add a second seat here for a real second opinion.', provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 8000 }],
    },
  };
  // Never overwrite a file the user was told to edit - the starter chain's
  // own _note says "edit the seats below", and a silent overwrite on a
  // rerun would erase exactly that edit with no warning.
  const starterChainPath = join(chainsDir, 'my-first-chain.json');
  if (existsSync(starterChainPath)) {
    console.log(`\n${starterChainPath} already exists - left as-is.`);
  } else {
    writeFileSync(starterChainPath, JSON.stringify(starterChain, null, 2));
    console.log(`\nWrote ${starterChainPath}`);
  }

  const starterTaskPath = join(tasksDir, 'my-first-task.md');
  if (existsSync(starterTaskPath)) {
    console.log(`${starterTaskPath} already exists - left as-is.`);
  } else {
    writeFileSync(starterTaskPath, `A short plan for a personal weekly reading list: what it tracks, how an entry gets added, how "done" is marked. Plain prose - this file is read by the criteria stage as-is, nothing else parses it.\n`);
    console.log(`Wrote ${starterTaskPath}`);
  }

  console.log(`\nPrice of your starter chain (no network call, no key needed for this step):`);
  const rows = estimateChainRows(starterChain);
  const w = Math.max(...rows.map(r => r.seat.length));
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(12)} ${r.seat.padEnd(w)}  ${r.priced ? formatUsd(r.usd) : 'unpriced'}`);
  }
  const worst = rows.reduce((s, r) => s + r.usd, 0);
  console.log(`  expected: ${formatUsd(worst)} for the whole chain (typical output; "council --dry-run" also prints the upper estimate)`);

  console.log(`\nRunning a canned, offline, $0 task end to end so you can see a real run folder before touching a key:`);
  const cannedConfig = {
    name: 'council-init-demo',
    maxRounds: 1,
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-critic-a' }],
    },
  };
  const initRunId = `${new Date().toISOString().replace(/[:.]/g, '-')}-init`;
  const initRunDir = join(work, 'runs', initRunId);
  mkdirSync(initRunDir, { recursive: true });
  const initStartedAt = new Date().toISOString();
  // E3b unit three: init's run folder records its reply identities like any run's (the same rule as a fresh run: the Reply identity sentence exists); its canned mock critic echoes the ids (src/providers.js).
  const initEnvelope = !!held('verdictEnvelopeSection');
  setEnvelopeStore(fileEnvelopeStore(initRunDir)); setEnvelopeInForce(initEnvelope);
  const initResult = await runChain({
    request: readFileSync(starterTaskPath, 'utf8'),
    config: cannedConfig,
    log: line => console.log(`  ${terminalSafe(line)}`),
  });
  writeFileSync(join(initRunDir, 'deliverable.md'), initResult.deliverable);
  writeAtomic(join(initRunDir, 'report.json'), JSON.stringify(reportJsonShape({
    runId: initRunId, chain: cannedConfig.name, task: starterTaskPath, taskCwd: work, taskText: readFileSync(starterTaskPath, 'utf8'), startedAt: initStartedAt, result: initResult, config: cannedConfig, verdictEnvelope: initEnvelope,
  }), null, 2));

  console.log(`\nWrote ${initRunDir} - a real run folder (report.json, deliverable.md) from the canned demo task, $0, no network call.`);
  console.log(`\nNext, with a real key set: ${councilCommand()} --chain my-first-chain --task ${starterTaskPath.replace(work + '/', '')} --dry-run`);
  console.log(`Then, for real: ${councilCommand()} --chain my-first-chain --task ${starterTaskPath.replace(work + '/', '')}`);
  if (!anyKeySet) console.log(`\nNo API keys are set yet - see README.md#setup, or "${councilCommand()} doctor" any time to re-check.`);
  process.exit(0);
}

// `council export-board --run <folder> --out <file>` (v5 §1 candidate 8):
// a run's proposals/debate/replies/verdict as one self-contained HTML
// file - no external assets, no template-engine dependency, no server.
if (argv[0] === 'export-board') {
  const runArg = flag('run', null);
  const outArg = flag('out', 'board.html');
  if (!runArg) {
    console.error('export-board: --run <folder> is required');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  const reportPath = join(runDir, 'report.json');
  const report = readReportOrExit(reportPath, 'export-board');
  const outPath = resolve(work, outArg);
  writeFileSync(outPath, renderBoardHtml(report));
  console.log(`Wrote ${outPath}`);
  process.exit(0);
}

// `council replay --run <folder> [--json]` (v5 §1 candidate 9): a
// numbered, indented, step-by-step transcript of a run's reasoning - a
// CLI-native complement to export-board's shareable HTML artifact.
if (argv[0] === 'replay') {
  refuseOnUserPriceProblem();   // every command that PRICES refuses on an unreadable price file BEFORE it prices (shipped figures alone would silently under-count a raised row)
  const runArg = flag('run', null);
  if (!runArg) {
    console.error('replay: --run <folder> is required');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  const reportPath = join(runDir, 'report.json');
  const report = readReportOrExit(reportPath, 'replay');
  const steps = buildTranscript(report);
  if (argv.includes('--json')) {
    // Bug audit 2026-10-24 C-018: the transcript quotes model text (a proposal's title and what it does) from report.json, so it must not reach the terminal raw: a folder received from someone else could clear, retitle or overprint it.
    // The --json form writes the characters terminalSafe removes as \uXXXX escapes (the document parses to the same data); the text form goes through terminalSafe like every other log sink here.
    console.log(escapeTerminalUnsafe(JSON.stringify(steps, null, 2)));
  } else {
    console.log(terminalSafe(renderTranscriptText(steps)));
  }
  process.exit(0);
}

// `council check-lock <HANDOFF.md> [--run <folder>]` (0.8.0, alias `verify-handoff`): $0, no network. Does
// this file (the run's copy, or the project's own) still carry the criteria the harness locked into it?
// With --run, also: are they the criteria that run's report.json settled? Exit 0 yes, 1 no (each
// problem on its own line), 2 no such file or no lock block to check.
if (argv[0] === 'check-lock' || argv[0] === 'verify-handoff') {
  const fileArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
  if (!fileArg) {
    console.error(`${argv[0]}: give the HANDOFF.md to check`);
    console.error(`usage: council ${argv[0]} <HANDOFF.md> [--run runs/<id>]`);
    process.exit(2);
  }
  let text;
  try { text = readFileSync(resolve(work, fileArg), 'utf8'); } catch { console.error(`${argv[0]}: cannot read ${fileArg}`); process.exit(2); }
  let expected, expectedChecksSha256;
  const runArg = flag('run', null);
  if (runArg && runArg !== true) {
    const report = readReportOrExit(join(resolve(work, runArg), 'report.json'), argv[0]);
    // Audit A5-5 (0.8.1): a comparison that cannot be made is not a pass.
    if (!Array.isArray(report.criteria)) { console.error(`${argv[0]}: ${join(runArg, 'report.json')} has no criteria list, so there is nothing to compare the file's criteria with. Nothing was checked.`); process.exit(2); }
    expected = report.criteria;
    if (typeof report.checks_sha256 === 'string') expectedChecksSha256 = report.checks_sha256;
  }
  const verdict = checkLock(text, { expected, expectedChecksSha256 });
  for (const n of verdict.notes || []) console.error(`${fileArg}: note: ${n}`);
  if (!verdict.found) { console.error(`${fileArg}: ${verdict.problems[0]}`); process.exit(2); }
  if (verdict.ok) { console.log(`${fileArg}: criteria lock holds (${verdict.sha256.slice(0, 12)}${verdict.run ? `, run ${verdict.run}` : ''})`); process.exit(0); }
  for (const p of verdict.problems) console.error(`${fileArg}: ${p}`);
  process.exit(1);
}

// `council contract check <runs/id>` (0.8.2 item 6a): $0, no network. Recomputes what the run folder still holds (the criteria, the task file, the --context documents, the tool results,
// deliverable.md, HANDOFF.md) and compares it with the thin contract in report.json. Exit 0 sealed, 1 drift (each on its own line), 2 nothing to check. What it cannot read is said, never a pass.
// The family name leaves room for the full contract record (`contract lock | show`) in a later release.
if (argv[0] === 'contract' && argv[1] !== 'draft') {
  // 0.8.2 item 6d: lock, show and amend --decide live in src/contract-cli.js (the record, its gate and its terminal answer); check stays here, beside the thin-contract check it extends.
  if (argv[1] !== 'check') process.exit(await contractCommand(argv.slice(1), { work }));
  if (!argv[2] || argv[2].startsWith('--')) {
    console.error('usage: council contract check <runs/id> [--handoff <HANDOFF.md>]');
    process.exit(2);
  }
  const abs = resolve(work, argv[2]);
  const trusted = trustedRunDir(dirname(abs), basename(abs));
  if (trusted.refusal) { console.error(`contract check: ${trusted.refusal}`); process.exit(2); }
  // 0.8.3 M2: the check itself is src/run-contract-check.js (the tree's ancestor check runs the same code); this command only reads --handoff and prints.
  const checked = contractCheckOf(trusted.dir, { work, handoffCopy: () => {
    // --handoff: the builder's own copy of HANDOFF.md, read from wherever it is (this is the person's own command).
    const copyArg = flag('handoff', null);
    if (copyArg === null) return undefined;
    if (copyArg === true) { console.error('contract check: --handoff needs a file'); process.exit(2); }
    try { return readFileSync(resolve(work, copyArg), 'utf8'); } catch { console.error(`contract check: cannot read ${copyArg}`); process.exit(2); }
  } });
  const record = checked.record;
  const printRecord = () => { for (const l of record.lines) (record.exit === 0 ? console.log : (x) => console.error(`contract check: ${x}`))(l); };
  if (checked.kind === 'noreport') {
    if (record.present) { printRecord(); process.exit(record.exit); }
    console.error(`contract check: ${argv[2]}/report.json is missing or not JSON (an unfinished run has no thin contract)`); process.exit(2);
  }
  for (const l of checked.shown.out) console.log(l);
  for (const l of checked.shown.err) console.error(`contract check: ${l}`);
  if (record.present) printRecord();
  process.exit(checked.exit);
}

// `council handoff --from-run <folder> [--chain <name>] [--max-usd N|none]` (0.8.0): a HANDOFF.md for a
// run that stopped before it wrote one (the spend cap, an abandoned pause, a crash), made from the
// latest draft the folder holds (src/handoff-from-run.js). One call on the chain's handoff seat (its
// builder seat when it has none), under the same spend cap and outbound key scan as any stage. A run
// no panel signed off gets a banner saying so, written by the harness. Never overwrites HANDOFF.md:
// it writes HANDOFF-from-run.md next to one that exists. An external handoff seat (a session you run)
// gets a prompt file instead of a call. Exit 0 written, 2 nothing to hand off, 3 the prompt was written
// for an external seat, 4 the cap, 11 a key-shaped string in the draft, 16 the call failed or was cut off.
if (argv[0] === 'handoff' || (argv[0] === 'contract' && argv[1] === 'draft')) {
  refuseOnUserPriceProblem();
  // 0.8.2 item 6d: `council contract draft --from-run <run>` is this same block in draft mode: the same chain and seat lookup, run lock, policy gate, outbound key scan, spend cap and per-call cost record; the call's prompt
  // is src/contract-draft.js's (held until the re-record) and its reply is a draft of obligations (linted, written as contract/draft.json) instead of a HANDOFF file.
  const draftMode = argv[0] === 'contract';
  const who = draftMode ? 'contract draft' : 'handoff';
  refuseSideJson(who);
  const fromArg = flag('from-run', null);
  if (!fromArg || fromArg === true) {
    console.error(`${who}: --from-run <run folder> is required`);
    console.error(`usage: council ${draftMode ? 'contract draft' : 'handoff'} --from-run runs/<id> [--chain <name>] [--max-usd N|none]`);
    process.exit(2);
  }
  const hRunDir = resolve(work, fromArg);
  const hMeta = existsSync(join(hRunDir, 'run.json')) ? (() => { try { return JSON.parse(readFileSync(join(hRunDir, 'run.json'), 'utf8')); } catch { return null; } })() : null;
  if (!hMeta) { console.error(`${who}: ${hRunDir} is not a run folder (no readable run.json)`); process.exit(2); }
  // 0.8.1 FX-14 (owner, 2026-10-02): an advice call has no plan to hand off. A handoff of its answer would be a paid call whose acceptance items came from advice, read as signed off (advice reports carry passed: true, which is not a
  // sign-off). Refused on the folder's own files before any chain is looked up, read further or spent (the add-on itself was removed in 0.8.4; this is the old folder's tombstone).
  if (isAdviceFolder(hRunDir)) {
    console.error(`${who}: ${hRunDir} is an advice call, not a plan: there is nothing to hand off. Read its deliverable.md (the advice) instead.`);
    process.exit(2);
  }
  // 0.8.3 M2 (PLAN 7.6): a post-run paid call on a tree member is held to the member's lifetime cap like a run; `--max-usd none` / `off` (and a run.json that saved no cap) is refused before anything else happens.
  if (hMeta.tree) {
    const askedEarly = flag('max-usd', null);
    if (askedEarly === 'none' || askedEarly === 'off' || (askedEarly === null && 'maxUsd' in hMeta && hMeta.maxUsd === null)) {
      console.error(`${who}: --max-usd none is refused for a recursive-councils tree member: the call is held to the member's lifetime cap. Nothing was run and nothing was spent.`);
      process.exit(EXIT_TREE_REFUSED);
    }
  }
  const chainArg = flag('chain', null);
  const hChain = chainArg && chainArg !== true ? chainArg : hMeta.chain;
  { const bad = chainNameRefusal(hChain, chainArg ? '--chain' : 'the chain recorded in run.json'); if (bad) { console.error(bad); process.exit(2); } }
  const hConfigPath = [hMeta.cwd ? join(hMeta.cwd, 'chains', `${hChain}.json`) : null, join(work, 'chains', `${hChain}.json`), join(pkg, 'chains', `${hChain}.json`)].filter(Boolean).find(existsSync);
  if (!hConfigPath) { console.error(`${who}: no such chain "${hChain}" (looked in the run's own chains/, ./chains and the package's).${outdatedChainHint(hChain)}`); process.exit(1); }
  let hConfig;
  try { hConfig = JSON.parse(readFileSync(hConfigPath, 'utf8')); } catch { console.error(`\n${formatCouncilError('COUNCIL-E003', { path: hConfigPath })}`); process.exit(EXIT_FATAL); }
  exitOnLint(hConfig, hConfigPath);
  try { hConfig = routeRun(hConfig, { meta: hMeta, who }).config; } catch { /* reported by the seat check below */ }      // 0.8.4: the roster the run used (its own route is checked, never obeyed from run.json)
  const hSeat = hConfig.seats?.handoff || hConfig.seats?.builder;
  if (!hSeat) { console.error(`${who}: chain "${hChain}" has neither a handoff nor a builder seat`); process.exit(2); }
  zeroRetentionRun({ seats: { handoff: hSeat } }, { meta: hMeta, who, dry: sideDryRun });      // 0.8.4 zero retention: the handoff sends ONE call, to this seat (not the chain's other seats): decided on it alone, armed before it is sent (a dry run is priced, not stopped)
  const hDraft = pickDraft(hRunDir);
  if (!hDraft) { console.error(`${who}: nothing to hand off - ${hRunDir} holds no draft (deliverable.md, or a final, revise-N, deep-dive-revise or build draft that can be read and is not empty)`); process.exit(2); }
  // what the pick passed over is said here AND in the HANDOFF.md banner (the durable record): a newer draft that could not be read or failed, or a fragment handed on because every draft failed
  for (const l of pickNoteLines(hDraft)) console.error(`${who}: ${l}`);
  { const nl = pickNotesLine(hDraft); if (nl) console.error(`${who}: ${nl}`); }
  const hTaskPath = hMeta.task ? (isAbsolute(hMeta.task) ? hMeta.task : resolve(hMeta.cwd || work, hMeta.task)) : null;
  let hRequest;
  try { hRequest = readFileSync(hTaskPath, 'utf8'); } catch { console.error(`${who}: cannot read the run's task file (${hTaskPath || 'none recorded'})`); process.exit(2); }
  const hCriteria = readCriteria(hRunDir);
  // FX-6: never a silent HANDOFF.md without its lock block.
  if (!hCriteria.length) console.error(draftMode ? `${who}: no criteria could be read from ${hRunDir} (report.json, report-partial.json, criteria.md): the obligations cannot be linked to criteria.` : `${who}: no criteria could be read from ${hRunDir} (report.json, report-partial.json, criteria.md): the file is written without a lock block, so council check-lock cannot check it.`);
  // T2-1 commit 5: the prompt of the one call, as a function so the dry-run branch below prices the SAME prompt; on the real run it is called at the same point as before (after the lock).
  const handoffCallPrompt = () => {
    if (draftMode) {
      if (hSeat.provider === 'external') { console.error(`${who}: the handoff seat of "${hChain}" is external (a session you run); a contract draft is made by a model call. Write the draft yourself and pass it: council contract lock runs/<id> --draft <file>`); process.exit(2); }
      // The recorded prompt is roles.js's (CONTRACT_DRAFT_SYSTEM, contractDraftUser; P12): a build without it refuses a real seat here, before anything is sent (src/contract-draft.js).
      const dp = contractDraftPrompt({ provider: hSeat.provider, request: hRequest, draft: hDraft.text, handoff: readRunFile(hRunDir, 'HANDOFF.md').text ?? '', criteria: hCriteria });
      if (!dp.ok) { console.error(`${who}: ${dp.message}`); process.exit(2); }
      return { system: dp.system, user: dp.user };
    }
    return handoffPrompt({ config: hConfig, request: hRequest, draft: hDraft.text, planFile: handoffPlanFileOf(hConfig), checks: '', criteria: hCriteria, treeMember: Boolean(hMeta.tree), openObjections: openObjectionsOfReport(readRunJson(hRunDir, 'report.json')) });   // 0.8.4 round 1, 9a: the objections the run's own handoff prompt listed, when its report recorded them
  };
  // T2-1 commit 5: `--dry-run` is a SEPARATE early branch (C&C gate 1, 14 Oct 2026): it reads without the lock, applies the policy gate, prices the one call and exits 0. It takes no lock, writes no prompt file and no tree claim
  // (memberStart), and the real run below keeps its order exactly: lock -> prompt -> scan -> gate -> cap. A stale price costs nothing; a stale prompt on a real run would.
  // T1-1 positional rule: these are paid starts too, and neither has a bare-word form after its command words (`handoff --from-run <run> dry-run` would have made the paid call with the word ignored). The last refusal of the block: a REAL run
  // is checked here, after every refusal above (the folder, the member's `--max-usd none`, the chain, the seat, the draft, the task) and before the lock; the policy gate, key scan and cap below come after the lock and cannot precede it.
  // A DRY run takes no lock and has refusals of its own below (the policy gate, an unpriced seat), so it is checked inside its branch, after those.
  if (!sideDryRun) refuseStray(draftMode ? 2 : 1);
  if (sideDryRun) {
    sideGateOrExit(hConfig, everySeatOf(hConfig), hMeta.cwd || work);
    if (hSeat.provider === 'external' && !draftMode) { refuseStray(1); console.log(`${who}: the handoff seat of "${hChain}" is external (a session you run), so there is no call to price. A real run writes the prompt file and stops for your session (exit 3); this dry run wrote nothing.`); process.exit(0); }
    priceSingleCallAndExit(who, hSeat, handoffCallPrompt(), draftMode ? 2 : 1);
  }
  // Audit A5-1 (0.8.1): one process per run folder, like --resume. A handoff used to ignore the lock, so it could run beside a resume and replace a finished run's
  // HANDOFF.md, and two handoffs could both write the same name. Taken before the model call and held to exit (released by the exit listener).
  try { acquireRunLock(hRunDir); } catch (err) {
    if (!(err instanceof RunLockedError)) throw err;
    console.error(`\n${err.message}`);
    process.exit(EXIT_RUN_LOCKED);
  }
  const hState = stopState(hRunDir);
  const hRunId = basename(hRunDir);
  const { system: hSystem, user: hUser } = handoffCallPrompt();
  // Exact case (FX-9): on a case-insensitive disk existsSync would find the stage file handoff.md under this name.
  const hOut = existsExactCase(hRunDir, 'HANDOFF.md') ? 'HANDOFF-from-run.md' : 'HANDOFF.md';
  // The outbound key scan and the member's flag refusal, BEFORE the external branch writes anything (13 Oct 2026: the external branch used to write handoff-from-run.prompt.md and exit 3 before either ran, so a member's typed
  // --allow-secret-shaped was not refused there and a key in the task or the draft went into a file). The outbound key scan, as for a run: the task is a user input, so every shape (a password in a URL
  // included) is checked once up front, naming the line and never the value; the per-call scan inside the
  // call covers the draft (model text). --allow-secret-shaped is the one override.
  const hAllowSecret = argv.includes('--allow-secret-shaped');
  // NAMED ASYMMETRY (13 Oct 2026, C&C ruling, backend rule 12: recorded here, not fixed in this change): an `allowSecretShaped: true` SAVED in a member's run.json is ignored on this path (the scan runs and never waives), where a resume of the same
  // member refuses it with exit 19 (src/tree-member.js memberFlagRefusal, `saved`). Fail-closed either way, and the product cannot produce the saved value on a member: a member started with the flag is refused before run.json is written.
  // the member unit: a tree member takes no override of the key scan, on this path too (probed 13 Oct 2026: `handoff --from-run` on a member with the flag skipped the scan and wrote its post-run claim); a typed flag is a usage error, no tree record
  if (hMeta.tree) { const bad = memberFlagRefusal({ lineage: hMeta.tree, typed: { allowSecretShaped: hAllowSecret } }); if (bad) { console.error(`\n${who}: ${bad.text}`); process.exit(bad.code); } }
  setOutboundScan({ allow: hAllowSecret });
  if (!hAllowSecret) {
    const found = secretShapesIn(hRequest, { exemptReservedHosts: true }).map(f => ({ where: hTaskPath, ...f }));   // a refusal scan of an input, as inputSecretFindings (src/run-preflight.js)
    if (found.length) {
      console.error(`\n${who}: refused - the task file contains ${found.length} credential-shaped string(s).`);
      for (const l of secretRefusalLines(found)) console.error(l);
      console.error(hMeta.tree ? 'Nothing was sent. A tree takes no override.' : 'Remove the key from the task, or rerun with --allow-secret-shaped to send it deliberately.');
      process.exit(EXIT_PII_BLOCKED);
    }
  }
  if (hSeat.provider === 'external') {
    const promptFile = join(hRunDir, 'handoff-from-run.prompt.md');
    // the prompt carries the draft (model text) too: scanned like a provider call, a NEEDS file's rule (src/chain.js invoke(): the scan runs before the external pause)
    try { assertOutboundClean('handoff-from-run', { system: hSystem, user: hUser }, { allow: hAllowSecret }); } catch (err) { if (err instanceof SecretShapedPrompt) exitOnSecretShaped(err, who, { member: Boolean(hMeta.tree) }); throw err; }
    writeFileSync(promptFile, externalPromptText({ system: hSystem, user: hUser, runDir: hRunDir, target: join(hRunDir, hOut) }));
    console.log(`The handoff seat of "${hChain}" is external (a session you run). Prompt written: ${promptFile}`);
    console.log(`Give it to that session and save its reply as ${join(hRunDir, hOut)}.`);
    process.exit(3);
  }
  const hMissing = checkSeats([hSeat]);
  if (hMissing.length) { console.error(`${who}: a key is missing for ${hMissing.join(', ')}. Set it, then run this again.`); process.exit(EXIT_DEGRADABLE); }
  // The same policy gate the run itself passes (GuardLayer #4's class: a seat the policy forbids must not
  // be called because a different command reached it).
  sideGateOrExit(hConfig, everySeatOf(hConfig), hMeta.cwd || work);
  // The cap: the run's own, with what the folder has already cost counted toward it - a run stopped at a
  // $1 cap does not get a fresh $7. --max-usd N is a total for the run, as on --resume; `none` lifts it.
  const hSpent = runSpentUsd(hRunDir);
  const hCapArg = flag('max-usd', null);
  let hCap;
  if (hCapArg === 'none' || hCapArg === 'off') hCap = null;
  else if (hCapArg !== null) {
    hCap = Number(hCapArg);
    if (hCapArg === true || !Number.isFinite(hCap) || hCap <= 0) { console.error(`--max-usd: expected a positive number of dollars or "none", got "${hCapArg === true ? '' : hCapArg}"`); process.exit(2); }
  } else if ('maxUsd' in hMeta) hCap = hMeta.maxUsd;
  else hCap = Number(process.env.MAX_USD_PER_RUN) > 0 ? Number(process.env.MAX_USD_PER_RUN) : DEFAULT_MAX_USD;
  // T5b: a PAID handoff / contract draft on a run that is not a tree member waits for a limit a person types (the gate page of 14 Oct 2026): the run's saved cap, MAX_USD_PER_RUN and the $12 default are not the limit, `--max-usd N` is only the suggestion on the
  // screen, and `none` is not offered. A member keeps its claim and its lifetime cap (above, unchanged); a free seat (mock, ollama, external) keeps the flag. The order stays lock -> prompt -> key scan -> policy gate -> unpriced refusal -> typed limit -> cap.
  const hGateConfig = { name: hChain, seats: { handoff: hSeat } };
  let hGateDir = null;
  if (!hMeta.tree && chainIsPaid(hGateConfig)) {
    refuseUnpricedOrExit(hGateConfig, null, { paidStart: true });   // before the `none` refusal: an unpriced seat is exit 5 whatever the flag said
    if (hCapArg === 'none' || hCapArg === 'off') { console.error('--max-usd none is not offered: a limit is a number a person types. Nothing was started.'); process.exit(2); }
    refuseUnreadableUsdLimitOnPaidStart(hGateConfig);   // T9: before the gate folder
    const gate = await postRunLimitOrExit({
      who, verb: draftMode ? 'draft' : 'handoff', label: who, origDir: hRunDir, config: hGateConfig, plain: `${draftMode ? 'draft' : 'handoff'}|${hChain}|${hSeat.provider}/${hSeat.model}`,
      subject: { chain: hChain, task: hTaskPath }, worstUsd: projectStage(hSeat, { system: hSystem, user: hUser }), again: againCommand([]), flagUsd: hCapArg !== null ? Number(hCapArg) : undefined,
      scopeBaseOf: () => ({ taskSha256: sha256Hex(hRequest), contextSha256: null, chainSha256: sha256Hex(readFileSync(hConfigPath)), policySha256: policySha256Of(hMeta.cwd || work), sensitivityFloor: null, piiMode: null, deliverableSha256: sha256Hex(hDraft.text) }),
    });
    hCap = gate.cap; hGateDir = gate.gateDir;
  }
  // 0.8.3 M2 (PLAN 7.6): on a tree member this call is a POST-RUN claim (node_resumed, purpose post_run, released on every exit) under the same gate, checks and lifetime cap as a run; the cap it is held to is the lesser of
  // what was asked and the lifetime cap, so a call on the root while a child holds a grant cannot spend that grant. Its reservations are mirrored into the tree's record.
  let hMirror = null;
  // already-false unit (Q3; C&C ruling 24 Okt 2026): the tree's chain check reads `hConfigPath`, the file this call actually sends (read at :802, hashed for the gate at :914), not a second lookup by the member's own chain name: with `--chain <other>` that lookup aimed the check at a file the call never uses, or skipped it when the member's own file was missing.
  if (hMeta.tree) {
    try {
      const start = memberStart({ runDir: hRunDir, runId: hRunId, lineage: hMeta.tree, purpose: 'post_run', capAskedUsd: hCap, chainPath: hConfigPath, piiGate: hMeta.piiGate?.mode ?? null, piiAllow: hMeta.piiGate?.allow ?? [], allowSecretShaped: hAllowSecret, ceiling: chainIsPaid(hGateConfig) ? readUsdCeiling() : null, work });
      hCap = start.capUsd; hMirror = start.mirror;
      installPostRunHook({ runDir: hRunDir, runId: hRunId, lineage: hMeta.tree, claim: start.claim });
    } catch (err) {
      const why = err instanceof TreeRefusal ? err.message : err instanceof RunLockedError ? (err.holder?.unreadable ? err.message : `the tree record is locked by another process (pid ${err.holder?.pid}) and stayed locked`) : `the tree record could not be written (${err.code || err.message})`;
      console.error(`\n${who}: ${why}\nNothing was run and nothing was spent.`);
      process.exit(EXIT_TREE_REFUSED);
    }
  }
  setBudgetOrExit(hCap);
  setReservationSink(openReservations(hRunDir, hMirror ? { mirror: hMirror } : {})); // 0.8.2 item 8b: this call's reservation is on disk before it is sent (src/spend-reservations.js)
  countEarlierSpend(hSpent);
  console.log(`${who}: ${hDraft.name} of ${hRunId} -> ${hSeat.provider}/${hSeat.model}${hState.signedOff ? '' : ` (the run ${hState.reason}${draftMode ? '' : ': the file will say the plan was not signed off'})`}; cap ${hCap === null ? 'none' : formatUsd(hCap)}, ${formatUsd(hSpent)} already spent`);
  // FX-1: a call that fails after it was sent (it may be billed) is charged on disk, as in a run.
  setChargeHook(c => recordLostCharge(hRunDir, c.label, c));
  let hRes;
  try {
    hRes = await runSingleStage(hSeat, { system: hSystem, user: hUser, log: m => console.log(m), label: draftMode ? 'contract-draft' : 'handoff-from-run' });
  } catch (err) {
    if (err instanceof UnpricedSeat) { console.error(`\n${formatCouncilError('COUNCIL-E002', { provider: hSeat.provider, model: hSeat.model, problem: priceProblemOf(hSeat.provider, hSeat.model), roles: 'handoff', capUsd: hCap })}`); process.exit(EXIT_DEGRADABLE); }
    if (err instanceof BudgetExceeded && hGateDir) postRunBudgetStop(hGateDir, err, who, againCommand([]));
    if (err instanceof BudgetExceeded) { console.error(`${who}: stopped by the spend cap (${formatUsd(err.spent)} spent, this call could cost up to ${formatUsd(err.projected)}, ceiling ${formatUsd(err.cap)}). Raise --max-usd.`); process.exit(4); }
    if (err instanceof SecretShapedPrompt) exitOnSecretShaped(err, who, { member: Boolean(hMeta.tree) });
    console.error(`${who}: the call failed - ${err?.message || err}`);
    process.exit(EXIT_RUN_FAILED);
  }
  // The money is on record before anything else can fail, a cut-off reply included. One file per call (FX-1): a second
  // handoff used to overwrite the first's handoff-from-run.usage.json; superseded/ is what --spend and a resume's cap read.
  recordCallOrCharge(hRunDir, draftMode ? 'contract-draft' : 'handoff-from-run', { provider: hRes.provider, model: hRes.model, usage: hRes.usage, usd: hRes.usd, ms: hRes.ms, promptHash: hRes.promptHash, reservationId: hRes.reservationId, ...basisField(hRes), ...billedFieldsOf(hRes), ...discardedFieldOf(hRes) }, { seat: hSeat, system: hSystem, user: hUser }, who, hMirror);
  const hStop = hRes.usage?.stop;
  if (['length', 'max_tokens', 'error', 'content_filter', 'refusal'].includes(hStop) || !String(hRes.text || '').trim()) {
    console.error(`${who}: the reply did not complete (${hStop ? `stop: ${hStop}` : 'empty'}); nothing was written. Raise the seat's maxTokens and run this again. ${formatUsd(hRes.usd)} was spent.`);
    process.exit(EXIT_RUN_FAILED);
  }
  if (draftMode) {
    const ids = criterionIds(hCriteria);
    const fin = finishDraft(hRunDir, String(hRes.text), { criteriaIds: ids }); // [] (not null) for a run with no readable criteria: an invented label is refused
    if (!fin.ok) {
      console.error(`${who}: the reply is refused by the lint (${fin.problems.length} problem${fin.problems.length === 1 ? '' : 's'}); only the reply itself was kept (contract/draft-reply.md), no draft was written. ${formatUsd(hRes.usd)} was spent.`);
      for (const l of fin.problems) console.error(`  ${terminalSafe(l)}`);
      process.exit(EXIT_RUN_FAILED);
    }
    console.log(`${who}: wrote ${join(hRunDir, 'contract', 'draft.json')} (${fin.obligations.length} obligation${fin.obligations.length === 1 ? '' : 's'}, ${formatUsd(hRes.usd)}). Read it, then: council contract lock ${fromArg}`);
    process.exit(0);
  }
  // The reply itself, as every stage keeps its own (<label>.md); the usage file above is what `council --spend`
  // and the next cap check read.
  // Named .reply.md (FX-9, P18): 'handoff-from-run.md' and the output 'HANDOFF-from-run.md' are one file on a
  // case-insensitive disk. Written atomically: temp file, then rename.
  writeFileSync(join(hRunDir, 'handoff-from-run.reply.md.tmp'), String(hRes.text));
  renameSync(join(hRunDir, 'handoff-from-run.reply.md.tmp'), join(hRunDir, 'handoff-from-run.reply.md'));
  // 0.8.2 item 6b: the same harness-written section as a run's own HANDOFF.md, from the thin contract the run's report.json holds (none in an older run: then the file reads as before).
  const hChecks = readChecks(hRunDir, hCriteria);
  // 0.8.4 slot H2-n (D17 entry 5): the seat's text gets the no-test-file line at the same place the run's own handoff does (src/chain.js, right after the seat's text settles), before the builder tasks and the lint read it; the reply file above stays the seat's own words.
  const hSeatRaw = withNoTestsLine(String(hRes.text), noFencedTestFile(hRequest));
  // 0.8.4 slot H2-h (D17 T1.3): `plan` is the plan the handoff seat answered, WITHOUT the harness notes above it: for deliverable.md the body the run's own record finds (gapPlanOf; a file the record cannot separate gives no plan, so no gap check: a named limit); a stage draft (final.md, revise-N.md, build.md) has no notes above it, so it is the text the seat was shown (hDraft.text).
  const hPlan = hDraft.name === 'deliverable.md' ? gapPlanOf(hDraft.text, readRunJson(hRunDir, 'report.json')?.delivered_text) : hDraft.text;
  let hFailures, hGaps = [], hMilestonesOn = false; try { const hCfgRead = JSON.parse(readFileSync(hConfigPath, 'utf8')); registerSeatKeys(hCfgRead); hFailures = checkFailuresOf(hCfgRead); hMilestonesOn = hCfgRead.handoff_contract?.milestones === true; if (hMilestonesOn) hGaps = lintMilestones({ text: hSeatRaw, criteriaIds: criterionIds(hCriteria), planText: (() => { try { return readFileSync(join(hRunDir, 'deliverable.md'), 'utf8'); } catch { return null; } })(), plan: hPlan }).findings; } catch { hFailures = undefined; /* the chain file was already read and linted above; if it cannot be read again the section is written with the default threshold and no milestone gaps, never a failed handoff */ }
  // Audit fix 73-handoff 1: the milestone gaps are written where the run path writes them (WARNINGS.md) and said on the console, whether or not the run has a thin contract to carry them into the file
  // (a cap-stopped run has no report.json; a 0.8.1 run has no thin_contract: builderSection returns '' for both).
  if (hGaps.length) {
    if (!existsSync(join(hRunDir, 'WARNINGS.md'))) writeFileSync(join(hRunDir, 'WARNINGS.md'), '# Warnings\n\n');
    appendFileSync(join(hRunDir, 'WARNINGS.md'), hGaps.map(f => `- handoff_milestones: ${f.kind}: ${f.message}\n`).join(''));
    console.log(`${who}: handoff milestones: ${hGaps.length} gap(s) (${[...new Set(hGaps.map(f => f.kind))].join(', ')}); see ${join(hRunDir, 'WARNINGS.md')}`);
  }
  const hBuilder = builderSection({ thin: readRunJson(hRunDir, 'report.json')?.thin_contract, runId: hRunId, failures: hFailures, hasChecks: Array.isArray(hChecks) && hChecks.some(Boolean), gaps: hGaps, builderKind: builderKindOf(hConfig) });   // 0.8.4 slot H2-q (D22): the chain's builder_kind reaches the harness half, as the seat half already does through handoffPrompt(hConfig)
  const hEarlyTasks = earlyTasksFromReport(readRunJson(hRunDir, 'report.json'));   // ROADMAP 83: an early finish keeps its builder tasks when the handoff is rebuilt
  const hText = hEarlyTasks ? withBuilderTasks(hSeatRaw, hEarlyTasks) : hSeatRaw;
  // 0.8.4 T2.5 (D29): the same Status rule as the run's own HANDOFF.md; a run that did not agree (a degraded sign-off is agreed) cannot say ready_for_build or partial here either
  const hReportNow = readRunJson(hRunDir, 'report.json');
  const hAcceptance = hReportNow?.acceptance && typeof hReportNow.acceptance === 'object' ? hReportNow.acceptance : null;   // an acceptance recorded for this run (src/acceptance.js): the clamp is lifted and the line goes under the banner
  const hSeatText = hMilestonesOn ? clampStatus(hText, statusAllowedOf(hReportNow?.ending_word, { agreed: hState.signedOff === true || hState.degraded === true, accepted: hAcceptance !== null })).text : hText;
  const body0 = partialBanner({ state: hState, draftName: hDraft.name, runId: hRunId, pick: hDraft }) + hSeatText.replace(/\s+$/, '') + '\n' + (hBuilder ? `\n${hBuilder}` : '') + lockBlock(hCriteria, { runId: hRunId, checks: hChecks });
  const body = hAcceptance ? withAcceptance(body0, hAcceptance) : body0;
  // Exclusive create (audit A5-1, FX-9): a file that appeared since the name was chosen (another handoff, the run's own HANDOFF.md finishing, or on a case-insensitive disk
  // the stage file handoff.md under another spelling) is never overwritten: the next free name is used.
  let hWritten = null;
  for (let n = 0; n < 20 && !hWritten; n++) {
    const name = n === 0 ? hOut : n === 1 ? 'HANDOFF-from-run.md' : `HANDOFF-from-run-${n}.md`;
    try { writeFileSync(join(hRunDir, name), body, { flag: 'wx' }); hWritten = name; } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  if (!hWritten) { console.error(`${who}: HANDOFF.md, HANDOFF-from-run.md and its numbered names all exist in ${hRunDir}; nothing was written. ${formatUsd(hRes.usd)} was spent. The reply is in handoff-from-run.reply.md.`); process.exit(EXIT_RUN_FAILED); }
  console.log(`${who}: wrote ${join(hRunDir, hWritten)} (${formatUsd(hRes.usd)})`);
  process.exit(0);
}

// `council gate show|answer|verify <run> [gate]` (0.8.1, plan M3): the terminal channel of the gate, a thin
// caller of src/gate-cli.js (the command, its terminal check and its exit codes live there).
if (argv[0] === 'gate') {
  process.exit(await gateCommand(argv.slice(1), { work }));
}

// `council tree approve | decide | resume | stop <rootId>` (0.8.3 M5, PLAN 10.1): the person's verbs for a recursive-councils tree (src/tree-cli.js; the answer is src/tree-gate.js's terminal answer).
if (argv[0] === 'tree') {
  if (argv[1] === 'start' || argv[1] === 'resume') refuseOnUserPriceProblem();
  const treePiiSetting = piiModeSetting(process.env);   // the tree's mode is the flag, else this setting, else warn (src/tree-start.js); the module itself reads no environment variable
  process.exit(await treeCommand(argv.slice(1), { work, ceiling: readUsdCeiling, piiSetting: treePiiSetting, claudeRouteEnv: process.env }));      // a thunk: only a paid tree path reads the ceiling (src/tree-ceiling.js)
}

// 0.8.4 D2 (src/accept-cli.js): the person's acceptance of the plan of a run that ended without agreement, as it stands.
if (argv[0] === 'accept') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--reason');
  const given = flag('reason', null);
  process.exit(await acceptCommand(positional, { work, reason: typeof given === 'string' ? given : undefined }));
}

// B3 prototype (src/gate-relay-cli.js): asks for a ruling, to apply from the next pass.
if (argv[0] === 'ruling-add') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--ruling');
  const given = flag('ruling', null);
  process.exit(rulingAddCommand(positional, { work, ruling: typeof given === 'string' ? given : undefined, relayed: argv.includes('--relayed') }));
}

// M1 (S19 (c); src/gate-relay-cli.js, src/handler-retags.js): the handler session's own act, a change of one objection's rating from the next pass on, recorded in retags.jsonl in the run folder (no gate, no answer from the person). The chain of the run (its ratings and its handler-session reviser) is read through the same lookup a resume uses.
if (argv[0] === 'retag-add') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--retag-objection', '--retag-severity', '--retag-reason'].includes(all[i - 1]));
  const given = v => (typeof v === 'string' ? v : undefined);
  const readRunMeta = dir => { try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); } catch { return null; } };
  const chainOf = meta => {
    if (!meta?.chain) return null;
    const path = [meta.cwd ? join(meta.cwd, 'chains', `${meta.chain}.json`) : null, join(work, 'chains', `${meta.chain}.json`), join(pkg, 'chains', `${meta.chain}.json`)].filter(Boolean).find(existsSync);
    try { return path ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
  };
  process.exit(retagAddCommand(positional, { work, objection: given(flag('retag-objection', null)), severity: given(flag('retag-severity', null)), reason: given(flag('retag-reason', null)), relayed: argv.includes('--relayed'), chainOf, readRunMeta }));
}

// 0.8.4 S18 (Q4.3; src/handler-notes.js): the handling session's note on the build list AFTER the run has ended. A record path (report.json, HANDOFF.md and its recorded hash move together); no harness call, no money path.
if (argv[0] === 'note-add') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--note', '--objection'].includes(all[i - 1]));
  const given = v => (typeof v === 'string' ? v : undefined);
  const readRunMeta = dir => { try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); } catch { return null; } };
  const chainOf = meta => {
    if (!meta?.chain) return null;
    const path = [meta.cwd ? join(meta.cwd, 'chains', `${meta.chain}.json`) : null, join(work, 'chains', `${meta.chain}.json`), join(pkg, 'chains', `${meta.chain}.json`)].filter(Boolean).find(existsSync);
    try { return path ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
  };
  process.exit(noteAddCommand(positional, { work, note: given(flag('note', null)), objection: given(flag('objection', null)), chainOf, readRunMeta }));
}

// 0.8.4 item 6 (src/summary-add.js): the handling session's plan summary and index at the top of deliverable.md AFTER the run has ended. A record path (report.json and deliverable.md move together); no harness call, no money path. Off as shipped: the instruction it writes from is held.
if (argv[0] === 'summary-add') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--summary-file'].includes(all[i - 1]));
  const given = v => (typeof v === 'string' ? v : undefined);
  const readRunMeta = dir => { try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); } catch { return null; } };
  const chainOf = meta => {
    if (!meta?.chain) return null;
    const path = [meta.cwd ? join(meta.cwd, 'chains', `${meta.chain}.json`) : null, join(work, 'chains', `${meta.chain}.json`), join(pkg, 'chains', `${meta.chain}.json`)].filter(Boolean).find(existsSync);
    try { return path ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
  };
  process.exit(summaryAddCommand(positional, { work, summaryFile: given(flag('summary-file', null)), chainOf, readRunMeta }));
}

// B3 prototype (src/gate-relay-cli.js): the way out of a ruling: the session declines a request it asked for, or asks for the withdrawal of an approved ruling from the next pass.
if (argv[0] === 'ruling-withdraw') {
  const positional = argv.slice(1).filter(a => !a.startsWith('--'));
  process.exit(rulingWithdrawCommand(positional, { work, relayed: argv.includes('--relayed') }));
}

// S20 slice 2, control 1 (src/gate-relay-cli.js, slot H20): the handler session's decision on a request to start the next pass at layer 3, or its own route. The chain of the run is read the way a resume reads it (the same three folders as retag-add above) and its seats are resolved,
// so the seat keys of the stage files are the keys the run used (N7 needs them).
if (argv[0] === 'route-decide') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--reason' && all[i - 1] !== '--person-words');
  const given = v => (typeof v === 'string' ? v : undefined);
  const readRunMeta = dir => { try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); } catch { return null; } };
  const chainOf = meta => {
    if (!meta?.chain) return null;
    const path = [meta.cwd ? join(meta.cwd, 'chains', `${meta.chain}.json`) : null, join(work, 'chains', `${meta.chain}.json`), join(pkg, 'chains', `${meta.chain}.json`)].filter(Boolean).find(existsSync);
    try { return path ? resolveChainSeats(JSON.parse(readFileSync(path, 'utf8'))) : null; } catch { return null; }
  };
  process.exit(routeDecideCommand(positional, { work, route: argv.includes('--route'), decline: argv.includes('--decline'), reason: given(flag('reason', null)), personWords: given(flag('person-words', null)), chainOf, readRunMeta }));
}

// S20 slice 2, #16c (src/gate-relay-cli.js): "pause after this round": asks the RUNNING run to stop before its next pass. Takes no run lock; records one ledger line.
if (argv[0] === 'pause') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--reason' && all[i - 1] !== '--person-words');
  const given = v => (typeof v === 'string' ? v : undefined);
  const readRunMeta = dir => { try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); } catch { return null; } };
  process.exit(pauseCommand(positional, { work, reason: given(flag('reason', null)), personWords: given(flag('person-words', null)), readRunMeta }));
}

// B3 prototype (src/gate-relay-cli.js): the handler session's relay of a person's permission for a raised limit or a ruling.
if (argv[0] === 'relay-answer') {
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--person-words' && all[i - 1] !== '--total');
  const given = v => (typeof v === 'string' ? v : undefined);
  process.exit(relayCommand(positional, { work, personWords: given(flag('person-words', null)), total: given(flag('total', null)) }));
}

// `council lint-criteria --criteria <file> | --run <folder>` (0.8.0): the $0 word-level lints over an
// acceptance-criteria list (src/criteria-lints.js) - the same ones every run logs before its first paid
// round - so a hand-written list can be looked at before a run exists. Exit 0 clean, 1 with findings
// (one per line), 2 no list to read. Heuristics: a finding is a question for a person, not a verdict.
if (argv[0] === 'lint-criteria') {
  const critArg = flag('criteria', null);
  const runArg = flag('run', null);
  if ((!critArg || critArg === true) === (!runArg || runArg === true)) {
    console.error('lint-criteria: give exactly one of --criteria <file> or --run <folder>');
    console.error('usage: council lint-criteria --criteria criteria.md   |   council lint-criteria --run runs/<id>');
    process.exit(2);
  }
  let list;
  if (critArg && critArg !== true) {
    try { list = parseCriteriaFile(readFileSync(resolve(work, critArg), 'utf8'), critArg); } catch (e) { console.error(`lint-criteria: ${e.message}`); process.exit(2); }
  } else {
    const dir = resolve(work, runArg);
    const file = existsSync(join(dir, 'report.json')) ? 'report.json' : existsSync(join(dir, 'report-partial.json')) ? 'report-partial.json' : null;
    if (!file) { console.error(`lint-criteria: no report.json in ${dir}`); process.exit(2); }
    list = readReportOrExit(join(dir, file), 'lint-criteria').criteria;
    if (!Array.isArray(list) || !list.length) { console.error('lint-criteria: that report has no criteria'); process.exit(2); }
  }
  const findings = lintCriteria(list);
  if (!findings.length) { console.log(`${list.length} criteria, no findings.`); process.exit(0); }
  for (const f of findings) console.log(`${f.id}: ${f.message}`);
  process.exit(1);
}

// `council digest --run <folder> [--provider p --model m]` (v6 item E): a short, plain-English
// paragraph explaining why the panel disagreed (or that it didn't), written into the completed
// run's own folder as digest.md. Deliberately its own top-level subcommand, never a stage inside
// runChain - see src/dissent-digest.js's header comment and test/no-digest-in-prompt-paths.test.js
// for the structural read-only guarantee this depends on. --provider/--model are optional: with
// neither given, the digest is the fixed deterministic template (renderDigestTemplate), no model
// call at all - the one real BYOK call this feature ever makes is opt-in, named explicitly by the
// operator, never automatic.
// `council fence --task <task.md> --repo <path> <file> [file...]` (2026-09-20). Appends real
// file contents to a task file, fenced and labelled, for the operator to read BEFORE the run.
// Deliberately not automatic: a person decides what a third-party lab gets to see, and the
// task file is the record of exactly that. See src/fence.js for why this shape and not a tool.
if (argv[0] === 'fence') {
  const taskArg = flag('task', null);
  const repoArg = flag('repo', null);
  if (!taskArg || taskArg === true || !repoArg || repoArg === true) {
    console.error('fence: --task <task.md> and --repo <path> are both required');
    console.error('usage: council fence --task task.md --repo ../my-project SaveSystem.cs run-tests.sh');
    process.exit(2);
  }
  // Positional file arguments: everything that is not a flag or a flag's value.
  const flagsWithValues = new Set(['--task', '--repo']);
  const files = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { if (flagsWithValues.has(argv[i])) i += 1; continue; }
    files.push(argv[i]);
  }
  if (!files.length) {
    console.error('fence: name at least one file to fence, relative to --repo');
    process.exit(2);
  }
  const taskPathAbs = resolve(work, taskArg);
  if (!existsSync(taskPathAbs)) {
    console.error(`fence: no such task file: ${taskArg}`);
    process.exit(2);
  }
  const repoRoot = resolve(work, repoArg);
  if (!existsSync(repoRoot)) {
    console.error(`fence: no such repository: ${repoArg}`);
    process.exit(2);
  }

  let appended = '';
  const summary = [];
  for (const f of files) {
    try {
      const block = fenceFile(repoRoot, f);
      appended += block.text;
      summary.push(block);
    } catch (err) {
      // One refused file fails the whole command: a partially-fenced task looks fenced,
      // and the operator would have to notice the absence to catch it.
      console.error(`fence: ${err.message}`);
      process.exit(2);
    }
  }

  const existing = readFileSync(taskPathAbs, 'utf8');
  // The header counts only where `council fence` writes it, outside any block: a fenced file that
  // quotes it (src/fence.js itself, say) is not the header.
  const header = outsideFences(existing).includes('# Source, fenced verbatim') ? '' : fenceHeader();
  const next = `${existing.replace(/\s*$/, '')}\n${header}${appended}`;

  // Scan the RESULT, not just what was added: a credential already sitting in the task's
  // prose is just as sent as one inside a fence.
  const scan = scanTaskForSecrets(next);
  if (!scan.clean) {
    console.error(`fence: ${scan.message}`);
    console.error('fence: the task file was NOT modified.');
    process.exit(2);
  }

  writeFileSync(taskPathAbs, next);
  console.log(`Fenced ${summary.length} file(s) into ${taskArg}:`);
  for (const b of summary) {
    const notes = [
      b.truncated ? `truncated at ${FENCE_MAX_BYTES} bytes of ${b.bytes}` : `${b.bytes} bytes`,
      b.redacted ? `${b.redacted} value(s) redacted as possible secrets` : null,
      b.invisible ? `${b.invisible} invisible character(s) (such as bidi, zero-width, variation-selector or filler characters): the text you read may not be the text a seat reads` : null,
    ].filter(Boolean).join(', ');
    console.log(`  ${b.rel} - ${notes}`);
  }
  console.log('\nRead the task file before running it. Everything in it is sent to every seat,');
  console.log('and therefore to every lab behind them.');
  process.exit(0);
}

if (argv[0] === 'digest') {
  refuseOnUserPriceProblem();
  refuseSideJson('digest');
  const runArg = flag('run', null);
  if (!runArg) {
    console.error('digest: --run <folder> is required');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  let report;
  try {
    report = readCompletedRun(runDir);
  } catch (e) {
    console.error(`digest: ${e.message}`);
    process.exit(2);
  }
  const providerArg = flag('provider', null);
  const modelArg = flag('model', null);
  let digestCall = null;
  if (providerArg) {
    // T1-14 (13 Oct 2026): the digest's one paid call goes through invoke() like every other paid call, under the money rules of `handoff --from-run` word for word: --max-usd is the RUN's total (what the folder already cost counts
    // toward it), `none` lifts it, and a typed number is required because the call used to be uncapped. Every refusal is before anything is sent and writes nothing.
    // Money path #5 first: a denied model is the absolute refusal and the most informative one, so it comes before the usage checks (test/prerelease-batch2.test.js pins it without --max-usd).
    {
      const denied = deniedReasonsOf({ provider: providerArg === true ? null : providerArg, model: modelArg === true ? null : modelArg });
      if (denied.length) {
        console.error(`digest: refused - ${denied.join('; ')}. This harness never calls a denied model.`);
        process.exit(2);
      }
    }
    if (providerArg === true || modelArg === null || modelArg === true) { console.error('digest: --provider needs --model (the model to call). Nothing was sent.'); process.exit(2); }
    // CR-6A-003: an external seat answers by hand and this one call cannot pause for it (the pause is control flow the digest lets through), so it used to end in a stack trace after the run folder was read. Refused here, before anything is sent or written.
    if (providerArg === 'external') { console.error('digest: --provider external is not available: an external seat is answered by hand and a digest call cannot pause for it. Name a provider that answers by itself with --provider and --model, or leave --provider out to get the free template. Nothing was sent.'); process.exit(2); }
    // T5b: a digest on a PAID seat waits for a limit a person types (the call is the first and only one, so its screen is built where its prompt is known, inside digestCall below); `--max-usd N` is then only the suggestion and `none` is not offered.
    // A digest on a free seat needs no flag any more (nothing to cap); a number given for it still caps it.
    const capArg = flag('max-usd', null);
    let digestCap;
    if (capArg === 'none' || capArg === 'off' || capArg === null) digestCap = null;
    else {
      digestCap = Number(capArg);
      if (capArg === true || !Number.isFinite(digestCap) || digestCap <= 0) { console.error(`--max-usd: expected a positive number of dollars or "none", got "${capArg === true ? '' : capArg}"`); process.exit(2); }
    }
    // a tree member's folder is the tree's account: a digest call there would run outside the member's post-run claim and lifetime cap
    if (readRunJson(runDir, 'run.json')?.tree) { console.error(`digest: ${runDir} is a member of a recursive-councils tree; a paid digest call there would run outside the tree's accounting (the member's post-run claim and its lifetime cap). Nothing was sent. Run it without --provider for the free template.`); process.exit(2); }
    const seat = { provider: providerArg, model: modelArg, maxTokens: SEAT_DEFAULT_MAX_TOKENS };
    let digestPolicy = null;   // the arguments of the gate below, kept for the second check inside digestCall (T5b: the call's own figure)
    // T2-1 commit 5: the shared policy gate, on the run's recorded chain and every seat of it plus this digest seat (a chain that cannot be read is replaced by a one-seat stand-in: a policy that needs more refuses, fail closed).
    {
      const dm = readRunJson(runDir, 'run.json');
      let dChain = null;
      if (dm && typeof dm.chain === 'string' && !chainNameRefusal(dm.chain, 'digest')) {
        const dPath = [dm.cwd ? join(dm.cwd, 'chains', `${dm.chain}.json`) : null, join(work, 'chains', `${dm.chain}.json`), join(pkg, 'chains', `${dm.chain}.json`)].filter(Boolean).find(existsSync);
        try { if (dPath) dChain = resolveChainSeats(JSON.parse(readFileSync(dPath, 'utf8'))); } catch { /* the stand-in below */ }
      }
      const gateConfig = dChain ?? { name: 'digest', seats: { digest: seat } };
      // C&C gate 1 (Q1): the consequence is said next to the refusal. A rule about the chain (required_chain_tags, the spend limits) is judged on the run's whole chain, so it applies to a one-call digest too.
      digestPolicy = [gateConfig, [...(dChain ? everySeatOf(dChain) : []), seat], dm?.cwd || work, dChain
        ? `digest: the policy is checked against this run's chain ("${dChain.name}") together with the digest seat, so a rule about the chain applies to the digest too. Nothing was sent.`
        : 'digest: the run\'s chain could not be read, so the policy is checked against the digest seat alone, and a rule about the chain refuses it. Nothing was sent.'];
      sideGateOrExit(...digestPolicy);
    }
    // a stand-in chain for the one digest call: the seat sits in a slot the chain code knows (`digest` is not one: before T5b the unpriced pre-flight below saw no seat at all and only invoke()'s backstop refused)
    const digestStandIn = { name: 'digest', seats: { handoff: seat } };
    const digestPaid = chainIsPaid(digestStandIn);
    zeroRetentionRun(digestStandIn, { meta: readRunJson(runDir, 'run.json') ?? undefined, who: 'digest', dry: sideDryRun });      // 0.8.4 zero retention: the digest's one call, decided on its seat alone and armed before it is sent
    let digestGateDir = null;
    // what a digest call must have in place before it is sent: the earlier spend of the folder counted, the reservation sink, the lost-charge hook (unchanged from before T5b; for a paid seat it runs after the limit is typed)
    const armDigestBudget = cap => {
      const spent = runSpentUsd(runDir);
      setBudgetOrExit(cap);
      setReservationSink(openReservations(runDir));
      countEarlierSpend(spent);
      setChargeHook(c => recordLostCharge(runDir, c.label, c));
    };
    if (!sideDryRun) {
      const missing = checkSeats([seat]);
      if (missing.length) { console.error(`digest: a key is missing for ${missing.join(', ')}. Set it, then run this again. Nothing was sent.`); process.exit(EXIT_DEGRADABLE); }
      refuseUnpricedOrExit(digestStandIn, digestCap, { paidStart: digestPaid, roleLabel: 'digest' });   // before the `none` refusal: an unpriced seat is exit 5 whatever the flag said
      if (digestPaid && (capArg === 'none' || capArg === 'off')) { console.error('--max-usd none is not offered: a limit is a number a person types. Nothing was started.'); process.exit(2); }
      if (digestPaid) usdLimitOrExit();   // T9: an unreadable limit is refused here, before digestCall makes the gate folder
      if (!digestPaid) armDigestBudget(digestCap);
    }
    // T5b: the policy's spend limit (max_usd_per_run) is judged on the digest CALL's own figure, the one `digest --dry-run` prints (projectStage), in BOTH branches of the gate above: with a readable chain that gate priced the run's whole chain again and never the digest, and with the one-seat
    // stand-in (the chain could not be read) its unknown slot priced $0. Same policy, same refusal text and exit (12); it runs where the prompt is known, before the typed limit, any request or reservation.
    const digestPolicyCallCheck = (system, user) => sideGateOrExit(...digestPolicy.slice(0, 4), projectStage(seat, { system, user }));
    if (sideDryRun) digestCall = async (_provider, { system, messages }) => { digestPolicyCallCheck(system, messages[0].content); return priceSingleCallAndExit('digest', seat, { system, user: messages[0].content }, 1); };
    else digestCall = async (_provider, { system, messages }) => {
      digestPolicyCallCheck(system, messages[0].content);
      if (digestPaid) {
        const gate = await postRunLimitOrExit({
          who: 'digest', verb: 'digest', label: 'digest', origDir: runDir, config: digestStandIn, plain: `digest|${seat.provider}/${seat.model}`,
          subject: { chain: readRunJson(runDir, 'run.json')?.chain ?? null, task: report?.task ?? null }, worstUsd: projectStage(seat, { system, user: messages[0].content }), again: againCommand([]), flagUsd: capArg !== null ? Number(capArg) : undefined,
          // a digest has no chain file and no task file of its own: the report it summarizes stands for the task, the seat's identity for the chain (stated in the T5b report)
          scopeBaseOf: () => ({ taskSha256: sha256Hex(JSON.stringify(report)), contextSha256: null, chainSha256: sha256Hex(`${seat.provider}/${seat.model}`), policySha256: policySha256Of(readRunJson(runDir, 'run.json')?.cwd || work), sensitivityFloor: null, piiMode: null }),
        });
        digestGateDir = gate.gateDir;
        armDigestBudget(gate.cap);
      }
      let res;
      try {
        res = await runSingleStage(seat, { system, user: messages[0].content, log: () => {}, label: 'digest' });
      } catch (err) {
        if (err instanceof UnpricedSeat) { console.error(`\n${formatCouncilError('COUNCIL-E002', { provider: seat.provider, model: seat.model, problem: priceProblemOf(seat.provider, seat.model), roles: 'digest', capUsd: digestCap })}`); process.exit(EXIT_DEGRADABLE); }
        if (err instanceof BudgetExceeded && digestGateDir) postRunBudgetStop(digestGateDir, err, 'digest', againCommand([]));
        if (err instanceof BudgetExceeded) {
          console.error(`digest: stopped by the spend cap: this run's total so far is ${formatUsd(err.spent)}, this call could cost up to ${formatUsd(err.projected)}, and the cap is ${formatUsd(err.cap)}. The smallest cap that passes this check is ${formatUsd(smallestCapThatPasses(err.spent, err.projected))}. Nothing was sent.`);
          process.exit(4);
        }
        if (err instanceof SecretShapedPrompt) exitOnSecretShaped(err, 'digest');
        throw err;
      }
      recordCallOrCharge(runDir, 'digest', { provider: res.provider, model: res.model, usage: res.usage, usd: res.usd, ms: res.ms, promptHash: res.promptHash, reservationId: res.reservationId, ...basisField(res), ...billedFieldsOf(res), ...discardedFieldOf(res) }, { seat, system, user: messages[0].content }, 'digest');
      if (draftIncomplete(res.usage) || draftCutOff(res.usage, seat.maxTokens)) throw new Error(`the reply did not complete (${res.usage?.stop ? `stop: ${res.usage.stop}` : 'cut off'})`);
      return { text: res.text };
    };
  }
  // T1-1 positional rule (`digest --run <run> --provider ... dry-run` made the paid call with the word ignored): the last refusal of this block, after the run, model, cap, member and policy-gate refusals and the key and price checks,
  // and before the first call or write. A dry run that would price a call is checked inside priceSingleCallAndExit, after the unpriced-seat refusal, and one that would make no call (below) is checked just before it says so.
  if (!(sideDryRun && providerArg)) refuseStray(1);   // a dry run that prices a call is checked inside priceSingleCallAndExit, after its unpriced-seat refusal
  const text = await generateDigestText({
    report,
    call: digestCall,
    provider: providerArg || null,
    model: modelArg || null,
    note: sideDryRun ? () => {} : n => {
      if (n.kind === 'secret_shaped') console.error('digest: the summary holds a key-shaped string, so no model call was made. The template was written instead.');
      else if (n.kind === 'empty') console.error('digest: a model call was made and its reply was empty, so the template was written instead. The call is on record in the run folder.');
      else console.error(`digest: a model call was made and failed (${n.message}), so the template was written instead. Any spend is on record in the run folder.`);
    },
  });
  // a dry run that reached here made no call to price (the summary holds a key-shaped string, so no call would be made): it writes nothing
  if (sideDryRun && providerArg) { refuseStray(1); console.log('digest: the summary holds a key-shaped string, so no model call would be made and there is nothing to price. Nothing was sent and nothing was spent.'); process.exit(0); }
  const path = writeDigest(runDir, text);
  // C&C ruling (14 Oct 2026): the free template is still written under --dry-run (it costs nothing and there is no call to price), and the person is told, so "nothing was written" is never the impression.
  if (sideDryRun) console.log('digest: --dry-run prices a model call, and without --provider there is none, so the free template digest was written. Nothing was sent and nothing was spent.');
  console.log(`Wrote ${path}`);
  process.exit(0);
}

// T1-1 positional rule (14 Oct 2026, C&C): every subcommand block above has exited, so what is left is the flag-driven main path, which has no bare-word form. A word that is not an option and not the value of an option is refused
// (`dry-run` typed without hyphens, `ーdry-run`, `一dry-run` each started a paid run with the option dropped, probe p24; no list of look-alike glyphs closes that class). The check is NOT made here: it is the last refusal of each path
// (refuseStray, defined at the top), made after that path's own more specific refusals (the removed flags, the policy gate, the keys, the cap) and before its lock, folder and first call.
// Bug-audit fix, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #3): parsed here, above
// --rematch and --replay, because both of those call runChain() - and they used to do it before
// this block ran and before setBudget(), so they spent under the module default of no ceiling.
// Per-run spend ceiling. A BYOK tool that a stranger points their own API
// keys at ships with a ceiling ON by default; --max-usd none is the explicit
// way to run without one, and says so in the log.
const SIDE_RUN_FOLDER = /\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2})$/;
// Unit 4b2 (C&C, ON-ONLY): with the per-provider caps switch on, a blank MAX_USD_PER_RUN or a host placeholder (a Desktop field left empty) counts as unset; with it off the
// old reading stands byte for byte (a blank value is refused below as 0, the owner's decision behind the MCP server's own "set but empty" sentence).
const perRunEnv = capsOn.length && !perRunIsSet(process.env.MAX_USD_PER_RUN) ? undefined : process.env.MAX_USD_PER_RUN;
const maxUsdArg = flag('max-usd', perRunEnv ?? String(DEFAULT_MAX_USD));
let maxUsd;
if (maxUsdArg === true) { console.error('--max-usd: needs a value, e.g. --max-usd 2'); process.exit(2); }
else if (maxUsdArg === 'none' || maxUsdArg === 'off') maxUsd = null;
else {
  maxUsd = Number(maxUsdArg);
  // 0.7.9 (owner, 2026-09-28: "Refuse 0 everywhere"): 0 used to mean no ceiling here and over MCP,
  // while the JS API refused it. Someone who writes 0 almost certainly means "spend nothing", so
  // reading it as "spend without limit" was the costliest possible guess. `none` is the one way.
  if (Number.isFinite(maxUsd) && maxUsd === 0) {
    console.error(`--max-usd: 0 is refused${flag('max-usd', null) === null ? ' (from MAX_USD_PER_RUN)' : ''} - it used to mean no ceiling. Use a positive number of dollars (--max-usd none only for a chain with no paid seat).`);
    process.exit(2);
  }
  if (!Number.isFinite(maxUsd) || maxUsd < 0) {
    console.error(`--max-usd: expected a positive number of dollars or "none", got "${maxUsdArg}"`);
    process.exit(2);
  }
}

// --rematch / --replay stop at the ceiling like a normal run. They have no stage cache and no
// per-stage usage files, so this marker is the only record of what the stopped sitting spent -
// spend.js falls back to it, which is how --spend still counts a capped rematch or replay.
// `reportArgs` (everything reportJsonShape needs but the result) turns the partial result runChain
// attached to the error into report-partial.json, as for a normal run.
// T2-1 + J1-08-1 (13 Oct 2026): a side run (--rematch, --replay) writes each stage as it completes, takes the run lock, and RESUMES through the stage cache. Called once, after every refusal and before the first stage:
// makes the folder, takes the lock (a live process on the same folder is refused, and `isRunAlive` now reads the folder as running, not "stopped, resumable"), clears an earlier sitting's stop markers (they describe the run as
// it stood at that stop), counts what earlier sittings already spent (superseded/ and unsettled reservations: a resume cannot lap the cap, as on --resume), arms the cache and the reservation sink, and says what a resume
// keeps and what is left. Returns the stage writer. Rule 8b stands: a folder with nothing or only reservations is simply reused; one with stage files is resumed; report.json means finished (refused by the caller).
function armSideRun(what, dir, config, fingerprint) {
  mkdirSync(dir, { recursive: true });
  try { acquireRunLock(dir); } catch (err) {
    if (err instanceof RunLockedError) { console.error(`${what}: ${err.message} Nothing was run.`); process.exit(2); }
    throw err;
  }
  for (const f of ['STOPPED-budget.json', 'STOPPED-budget.md', PARTIAL_REPORT_FILE, PARTIAL_BOARD_FILE, PARTIAL_DELIVERABLE_FILE]) { if (existsSync(join(dir, f))) rmSync(join(dir, f)); }
  const unfinished = unfinishedSideSummary(dir, config);
  countEarlierSpend(supersededSpendOf(dir));
  countEarlierSpend(unsettledReservations(dir).reduce((n, r) => n + r.usd, 0));
  countEarlierSpend(settledWithoutFileOf(dir).reduce((n, r) => n + r.usd, 0));   // 0.8.4 item 9a: a call an earlier sitting settled whose usage file was never written is paid for and in no file; the main resume seeds it too (above, "settledWithoutFileOf"), so a rematch and a replay hold the same limit
  setReservationSink(openReservations(dir));
  setChargeHook(c => recordLostCharge(dir, c.label, c));   // CR-1D-001: a call that fails after it was sent (billed, unreadable) or a discarded thinking attempt leaves its charge in THIS folder, as on a run and on --resume: the next sitting and --spend count it
  const unverified = [];
  setCache(makeStageCache({ dir, fingerprint, unverified }));
  const envelope = sideEnvelopeFlag(dir, !!unfinished, !!held('verdictEnvelopeSection')); // E3b unit three: src/verdict-envelope.js
  setEnvelopeStore(fileEnvelopeStore(dir)); // E3b unit three: the reply-identity records of a side run live in ITS folder, beside its stage files
  setEnvelopeInForce(envelope);
  if (unfinished) console.log(`${what}: ${basename(dir)} was started and did not finish: ${unfinished.stages} stage(s) are on disk (recorded spend so far: ${formatUsd(unfinished.paid)}); the stages still to run could cost up to ${formatUsd(unfinished.remaining)} more. Only those stages run from here.`);
  return { onStage: s => { stampRow(s, config, { dir, write: writeFileAtomic }); writeSideStage(dir, s, { fingerprint }); }, unverified, envelope };   // 0.8.4 lane C: a side run's rows carry the persona stamp too
}
// Cost-unit U1 split (14 Oct 2026): STOPPED-budget.json's spentUsd is the RECORDED spend (what the folder holds and --spend reads); the worst-case part the cap also counted, for replayed stages whose usage record has no figure, is its own
// additive value, present only when something was assumed. The sentence that names it to a person (STOPPED-budget.md, the log lines below) is held for the owner's yes.
function stoppedSpentUsd(err, state) { return Math.max(0, (err.spent || 0) - (state.assumed?.usd || 0)); }   // T5b: function declarations (hoisted), because the handoff / draft / digest blocks run above this line
// T4c: the 'spent' words of a stop screen. Two bases exist: the RECORDED spend (what the folder holds) and what the cap COUNTED (recorded + the worst case assumed for replayed stages that kept no figure; the raise floor is this one). With nothing assumed the words are the recorded figure alone, byte for byte as before; with something assumed both bases are named, recorded first (E 181, held).
function spentWords(err, state) {
  const assumed = state.assumed?.usd || 0;
  return assumed > 0 ? `${formatUsd(stoppedSpentUsd(err, state))} recorded, ${formatUsd(assumed)} assumed at worst case for replayed stages with no figure (${formatUsd(stoppedCountedUsd(err, state))} counted)` : formatUsd(stoppedSpentUsd(err, state));
}
function stoppedCountedUsd(err, state) { return (err.spent || 0); }   // what the cap COUNTED at the stop (recorded + the worst case assumed for replayed stages): the raise floor, the same figure STOPPED-budget.json holds as spentUsd + assumedAtWorstCase.usd

// The "Continue it" command of a budget stop. A PAID chain's limit is a number a person types, so resuming asks for a new TOTAL above what the cap counted (T4b2); a FREE chain has no typed limit and still resumes with --max-usd.
function budgetStopContinue(err, state, runId, config) {
  const suggested = resumeCeilingUsd({ cap: err.cap, spent: err.spent, projected: err.projected, gate: err.gate }) ?? Math.ceil((err.cap + err.projected) * 100) / 100;
  if (!chainIsPaid(config)) return `    ${councilCommand()} --resume runs/${runId} --max-usd ${suggested.toFixed(2)}\n\nOr \`--max-usd none\` to continue with no ceiling.`;
  return `    ${councilCommand()} --resume runs/${runId}\n\nThe limit of this run is a number a person types, so resuming shows a screen and asks for a NEW TOTAL for the whole run (not extra): it must be above ${formatUsd(stoppedCountedUsd(err, state))}, and the smallest total that lets the next call to a model be sent is ${formatUsd(suggested)}. With no terminal, the resume leaves a screen to answer with \`council gate answer runs/${runId} <gate>\`, then resume again.`;
}
function assumedAtWorstCase(state) { return (state.assumed?.stages > 0 ? { assumedAtWorstCase: { replayedStages: state.assumed.stages, usd: state.assumed.usd } } : {}); }
function writeSideRunBudgetStop(dir, err, what, reportArgs = null, again = null) {
  // Money path #1: err.spent was read when the cap was hit, before sibling calls still in flight
  // settled; their cost reaches budgetState() only afterwards. By the time this runs they have
  // settled (runChain waits for them), so the budget is the true figure.
  err.spent = Math.max(err.spent || 0, budgetState().spent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'STOPPED-budget.json'), JSON.stringify({
    stoppedAt: err.label, seat: err.seat, spentUsd: stoppedSpentUsd(err, budgetState()), capUsd: err.cap, projectedStageUsd: err.projected, gateStageUsd: err.gate, ...assumedAtWorstCase(budgetState()),
  }, null, 2));
  if (err.partial && reportArgs) {
    try {
      writeAtomic(join(dir, PARTIAL_REPORT_FILE), JSON.stringify(partialReportJsonShape({
        stoppedBy: 'budget', stoppedAtStage: err.label, ...reportArgs, result: err.partial,
      }), null, 2));
      const board = renderPartialBoardMd({ runId: reportArgs.runId, result: err.partial, stoppedAtStage: err.label });
      if (board) writeFileSync(join(dir, PARTIAL_BOARD_FILE), board);
    } catch (e) {
      console.error(`${what}: ${PARTIAL_REPORT_FILE} not written (${e?.message || e})`);
    }
  }
  console.error(`${what}: STOPPED - per-run spend cap reached before stage "${err.label}" (${spentWords(err, budgetState())} spent of ${formatUsd(err.cap)}; ${err.seat} could cost up to ${formatUsd(err.projected)}).${again ? ` Run the same command again: it asks for a new total above ${formatUsd(err.spent || 0)} (the smallest total that lets the next call to a model be sent is ${formatUsd(resumeCeilingUsd({ cap: err.cap, spent: err.spent, projected: err.projected, gate: err.gate }) ?? Math.ceil((err.cap + err.projected) * 100) / 100)}):\n  ${again}` : ' Raise it with --max-usd <higher> or --max-usd none.'}`);
  process.exit(4);
}


// `--rematch <run-dir> [--rematch-seed N]` (item C, relay/runs/2026-09-15T15-12-52-325Z/
// deliverable.md): re-runs an already-decided task with labs re-shuffled/re-anonymized
// (src/rematch.js), then writes a concrete, checkable diff of the new verdict against the
// original (src/verdict-diff.js, schemas/verdict-diff.json) - order/framing robustness, not a
// re-judgment of the deliverable's quality. Config-load-time reshuffle in this CLI wrapper only;
// src/chain.js and src/tools.js are both untouched (0-line delta, per the plan).
// Resume-cache audit #3 (Review/PreRelease_Audit_ResumeCache_2026-09-23.md): --rematch and --replay
// have no stage cache and do not catch an external pause, so on a chain with an external seat they
// paid everything up to that seat and then died - no NEEDS file, nothing to resume, and --spend never
// saw the cost. They also re-run from the task text alone, ignoring the original run's --context,
// --draft, --from-run and --criteria criteria, so the diff would blame the roster for a difference in
// inputs. Both are refused up front, before anything is paid.
function refuseSideRun(what, config, runMeta) {
  const external = everySeatOf(config).filter(s => s.provider === 'external');
  if (external.length) {
    console.error(`${what}: chain "${config.name}" has ${external.length} external seat(s). ${what} cannot pause for an external answer, so it would pay up to that seat and stop with nothing to resume. Refused before any call.`);
    process.exit(2);
  }
  // criteriaFile (--criteria) joined the list with the 2026-09-26 bug audit (#3): a rematch of a run
  // given hand-written criteria asked a criteria seat for new ones.
  const FLAG_OF = { fromRun: 'from-run', criteriaFile: 'criteria' };
  const inputs = ['context', 'draft', 'fromRun', 'criteriaFile'].filter(k => runMeta?.[k]);
  if (inputs.length) {
    console.error(`${what}: the original run also used ${inputs.map(k => `--${FLAG_OF[k] || k}`).join(', ')}, which ${what} does not carry over, so any difference would come from the inputs, not the panel. Refused before any call.`);
    process.exit(2);
  }
}

// T2-1 commit 5 (14 Oct 2026): `--replay`, `--rematch`, `handoff --from-run`, `contract draft --from-run` and `digest --provider` are paid calls on a finished run, and `--dry-run` was a known flag that none of them read: each RAN (p23/p24 probes,
// scratch/c/probe-out) and wrote files. A dry run is now a SEPARATE early branch in each block: after the usage, lint and refuseSideRun refusals and the policy gate, before every lock, folder, reservation, tree claim and prompt file, it prints a
// price and exits 0. The policy gate is ONE function (src/run-preflight.js sideCommandGate) called by all five at their own point; before this the handoff block had an inline copy and the other three had none.
// CR-RC-003: a side run (--rematch, --replay) writes its folder BESIDE the original. --spend, --cost-today and the spending limits read only join(work, 'runs'), so a side folder written anywhere else is spend
// they cannot see. The original therefore has to sit directly in this project's runs/ folder; otherwise the command refuses before anything is written or sent (the dry run too, so it predicts the real run).
// The PARENT is compared by real path (a run folder that is itself a symlink inside runs/ still gets its side folder inside runs/); where a path cannot be resolved the resolved string is used.
// A-DRAFT (two shapes): the parent is some project's runs/ folder (name the project and the command), or it is not a runs/ folder at all (the folder has to be moved into one first).
function sidePlacementRefusal(flagName, what, originalDir) {
  const runsDir = join(work, 'runs');
  const parent = dirname(originalDir);
  const real = p => { try { return realpathSync(p); } catch { return resolve(p); } };
  if (real(parent) === real(runsDir)) return null;
  const id = basename(originalDir);
  const cause = `so the spend of ${what} written beside it would not show in --spend, --cost-today or`;
  if (basename(parent) === 'runs') {
    return `${flagName}: ${originalDir} is in ${parent}, not in ${runsDir}, ${cause} this project's spending limits. Run it from the project that holds that folder (${dirname(parent)}), as: council ${flagName} runs/${id}. Nothing was run and nothing was spent.`;
  }
  return `${flagName}: ${originalDir} is not in a project's runs/ folder, ${cause} any project's spending limits. Move the folder into the runs/ folder of the project it belongs to, then run council ${flagName} runs/${id} from that project. Nothing was run and nothing was spent.`;
}
function sideGateOrExit(config, allSeats, policyCwd = work, neighbour = null, callFigureUsd = null) {
  const refused = sideCommandGate({ config, allSeats, work, policyCwd, callFigureUsd });
  if (!refused) return;
  console.error(refused.text);
  if (neighbour && !refused.parseError) console.error(neighbour);
  process.exit(refused.parseError ? EXIT_FATAL : EXIT_POLICY_REFUSED);
}
// The typed-limit gate of a start, extracted unchanged from the main path (T5-0, no behaviour change) so that the side commands can use the same code (T5a/T5b). Returns the typed total or exits (2 refused, EXIT_AWAITING_USER_CAP waiting).
// `scopeBaseOf()` yields the inputs of the scope that only the caller knows (task, context, chain file, policy file, PII mode); it is called at the point the inline code built them. `beforeAuthorize` runs where the inline code prepared run.json.
// T5b: handoff / contract draft / digest keep their gate in `<original run folder>/side/<verb>-<h8>/` (runDir = that folder) and spend in the ORIGINAL folder (`floorDir`: the floor on the screen is what the original has counted, the same figure the armed budget carries as earlier spend);
// `oneCall` = { usd } is the worst case of the ONE call (these commands make one), used for the estimate and the maximum instead of a chain's rows; `flagUsd` is the `--max-usd` number as the caller parsed it (the blocks above `maxUsd`'s declaration cannot read the variable).
// Unit 4b2: `capName` asks the limit of ONE per-provider cap (src/caps.js "THE ARMING"): its ceiling is that cap's own COUNCIL_MAX_USD_LIMIT_<ID>, never COUNCIL_MAX_USD_LIMIT; no
// run-wide figure is suggested; the screen names the cap. `onPending` (with capName) collects a wait instead of exiting, so every cap's gate is asked before the ONE exit 21.
var mainRerun = null;   // what the amend screen needs of the main run ({ fingerprint, ladderAdopted }), copied here where `cacheFingerprint` is made (below). The box showed `ReferenceError: cacheFingerprint is not defined` from the screen's reader (the name is not visible from this function, and rerunOf swallowed the error, so the finished-steps sentence was never printed); `var` so a gate that runs before this line (a side command's, the post-run limit gate near the top of the file) finds it undefined instead of throwing, because this statement has not run yet; rerunOf treats undefined and null alike
async function capGateOrExit({ runDir, runId, resume, config, fromRun, subject, scopeBaseOf, beforeAuthorize = null, beforePendingExit = null, sideVerb = null, sideLabel = sideVerb, again = null, floorDir = runDir, oneCall = null, flagUsd, capName = null, onPending = null, routeLine = null, typedReads = null }) {
  const ceilings = [];
  if (capName) {
    const own = readCapCeiling(capName);
    if (own.unreadable) { console.error(`\n${own.unreadable} Nothing was started.`); process.exit(2); }   // the start refusals answer it first; a backstop
    if (own.usd !== null) ceilings.push({ usd: own.usd, source: capCeilingName(capName) });
  } else {
    const limitUsd = usdLimitOrExit();   // the one helper (and the one sentence) the early refusals use too
    if (limitUsd !== null) ceilings.push({ usd: limitUsd, source: 'COUNCIL_MAX_USD_LIMIT' });
  }
  const suggested = capName ? null : argv.includes('--max-usd') ? { usd: flagUsd !== undefined ? flagUsd : maxUsd, source: '--max-usd' } : Number(process.env.MAX_USD_PER_RUN) > 0 ? { usd: Number(process.env.MAX_USD_PER_RUN), source: 'MAX_USD_PER_RUN' } : null;
  const scope = buildStartScope({
    ...scopeBaseOf(),
    seats: everySeatSlotsOf(config).map(({ role, seat }) => ({ role, provider: seat.provider, model: typeof seat.model === 'string' ? seat.model : null })),   // CR-5B-004: a seat with no model is null in the scope
    // the rows of THIS chain's seats that rest on pricing.user.json (project-writable: a changed row is a changed screen); shipped rows are not in the digest (package-versioned)
    userPrices: [...new Map(everySeatSlotsOf(config).filter(({ seat }) => seat && userRowOf(seat.provider, seat.model)).map(({ seat }) => [`${seat.provider}/${seat.model}`, seat])).values()].map(seat => {
      const raw = userRowOf(seat.provider, seat.model); const eff = effectiveRow(seat.provider, seat.model);
      return { key: `${seat.provider}/${seat.model}`, file_in: raw.in, file_out: raw.out, effective_in: eff.in, effective_out: eff.out };
    }),
    providerPreference: preferenceRows(everySeatSlotsOf(config).map(({ seat }) => seat)),   // 0.8.4 unit 3: the host preference for THIS chain's models (omitted from the scope when the file names none)
    ...(capName ? { caps: capsArmed } : {}),   // unit 4b2: the caps in force are part of what each cap's limit was typed for (a changed set shows a new screen)
  });
  // DUALCAP milestone 2: one cap's screen shows THAT cap's figures, the dry run's rows that bill through it (estimateChainRows' account); with no cap, the whole run's, as before.
  const mine = r => rowBillsThroughCap(r, capName);
  const expected = oneCall ? oneCall.usd : estimateChainRows(config, { fromRun, accounts: !!capName, typedReads }).filter(mine).reduce((sum, r) => sum + r.usd, 0);
  const most = oneCall ? oneCall.usd : estimateChainRows(config, { fromRun, maximum: true, accounts: !!capName, typedReads }).filter(mine).reduce((sum, r) => sum + r.usd, 0);
  const screenUserPrices = (scope.user_prices ?? []).map(r => { const at = r.key.indexOf('/'); return { key: r.key, in: r.effective_in, out: r.effective_out, src: priceSource(r.key.slice(0, at), r.key.slice(at + 1)) }; }).filter(r => r.src && (r.src.in === 'user' || r.src.out === 'user'));
  // What the run has already counted, from the run folder (T4b2): the floor of a later limit and the figures its screen shows. After a budget stop the floor and the suggested total come from STOPPED-budget.json through src/resume-ceiling.js
  // (spentUsd + assumedAtWorstCase.usd, exactly as run_status.suggestedMaxUsd does: the cap also counts E's worst-case assumptions for replayed stages), never from the in-process error; otherwise runSpentUsd (which already includes the unsettled reservations).
  const historyOfRun = () => {
    // Unit 4c1: ONE cap's history. The stopped cap reads its stop file's own figures (capSpentUsd + capAssumedUsd: the floor and the suggestion's base; capUsd: the
    // limit it stopped at); every other cap, and a run with no stop file, counts what the folder recorded through that cap (usage, superseded and charge files,
    // unsettled reservations by capName). Never the run total.
    if (capName) {
      let st = null;
      try { const j = JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); if (j && j.capName === capName && Number.isFinite(j.capUsd) && Number.isFinite(j.capSpentUsd)) st = j; } catch { /* no stop file at this cap */ }
      const unsettledCap = unsettledReservations(runDir).filter(r => r.capName === capName).reduce((n, r) => n + r.usd, 0);
      // 0.8.4 unit 6 (D11; H-U6-a): the floor is the LARGER of the stop file's figure and what the folder holds through the cap. The stop file is the stopping sitting's in-process total, which never saw a paid file of a label it did not ask (plan A case (iv)); the folder does.
      const counted = Math.max(st ? st.capSpentUsd + (st.capAssumedUsd || 0) : 0, capSpentOf(runDir, capName));
      return {
        spentUsd: counted, floorUsd: counted, unsettledUsd: unsettledCap, capName,
        stopped: st ? { capName, capUsd: st.capUsd } : null, projectedStageUsd: st?.projectedStageUsd,
        suggestedUsd: st ? resumeCeilingUsd({ cap: st.capUsd, spent: counted, projected: st.projectedStageUsd, gate: st.gateStageUsd }) : null,
      };
    }
    let stopped = null;
    try { const st = JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); if (st && Number.isFinite(st.capUsd) && Number.isFinite(st.spentUsd)) stopped = st; } catch { /* no stop file, or not readable: the recorded spend is the floor */ }
    // the stop file is read from the GATE folder only (the original run may hold the main run's own STOPPED-budget.json, which must never turn a first side screen into a raise screen); the spend is read from the floor folder. When they are two folders the
    // larger of the two figures is the floor (the call that stopped was counted in the original folder's totals afterwards, never less).
    const stopCounted = stopped ? stopped.spentUsd + (stopped.assumedAtWorstCase?.usd || 0) : null;
    // 0.8.4 unit 6 (D11; H-U6-a): the larger of the two in every case. With a stop file the floor used to be the stop file's figure alone, which is the stopping sitting's in-process total and never saw a paid file of a label it did not ask (plan A case (iv)); a limit the person could type then was below what the folder holds.
    const counted = Math.max(stopCounted ?? 0, runSpentUsd(floorDir));
    return {
      spentUsd: counted, floorUsd: counted, unsettledUsd: unsettledReservations(floorDir).reduce((n, r) => n + r.usd, 0), estimatedUsd: countedSummaryOf(floorDir)?.estimatedUsd ?? 0,   // 0.8.4 unit 6: the part of the counted figure that is an estimate (shown only when non-zero)
      stopped: stopped ? { capUsd: stopped.capUsd } : null, projectedStageUsd: stopped?.projectedStageUsd,
      suggestedUsd: stopped ? resumeCeilingUsd({ cap: stopped.capUsd, spent: counted, projected: stopped.projectedStageUsd, gate: stopped.gateStageUsd }) : null,
      finishNote: (() => { try { return budgetFinishArmed ? spendFinishNote(budgetFinishArmed.label) : (budgetFinishContinued || budgetContinue) ? spendFinishContinuedNote : budgetFinishWithdrawn ? spendFinishWithdrawnNote : budgetFinishUnrecorded ? spendFinishUnrecordedNote(budgetFinishUnrecorded) : null; } catch (e) { if (e instanceof ReferenceError) return null; throw e; } })(),   // a side command asks its limit before the module's resume variables exist (the same guard as rerunOf)   // 0.8.4 (unit-end item i): what the person's recorded --finish does to this raise, said on the screen they read before they type the figure
    };
  };
  const rerunOf = () => { if (!mainRerun) return null; const r = staleFinishedStages(runDir, mainRerun.fingerprint, { capName }); return { ...r, ...(capName ? { limit: capName } : {}), ladder: mainRerun.ladderAdopted }; };   // 10 Nov 2026: the old `try { ... cacheFingerprint ... } catch (e) { if (e instanceof ReferenceError) return null; }` read a name this function cannot see, so the finished-steps sentence of a resume after a change was never printed; now the main run's fingerprint and ladder flag are copied to a module variable where they are made, ONLY a gate that runs before the main run's fingerprint exists (a side command's, the post-run limit gate) returns null, and any other error surfaces. What the change does to the finished steps (src/stale-stages.js), for the amend screen; under per-provider caps the paid count and the cost are those of the steps billed through this screen's limit; a side command's gate runs before the main run's fingerprint exists: then the screen says nothing of it
  const buildScreen = (kind, { history }) => buildCapScreen({
    kind, notesMemory: capScreenMemoryClause(config, { fullRun: !oneCall && !fromRun && !sideVerb }), subject: sideVerb ? { ...subject, verb: sideLabel } : subject, ...(kind === 'run' || kind === 'side' ? { estimate: { usd: expected, scope: oneCall ? 'this one call' : 'this run' }, maximum: { usd: most } } : {}), history: kind === 'amend' ? { ...history, rerun: rerunOf() } : history,
    ceilings, suggestion: suggested && Number.isFinite(suggested.usd) && suggested.usd > 0 ? suggested : null, userPrices: screenUserPrices, preferences: scope.provider_preference ?? [],
    route: routeLine,      // 0.8.4 the Claude route: the screen that asks for the limit says the Claude seats go through OpenRouter (nothing for a direct run or a side verb: the screen is what it was)
    ...(capName ? { cap: { id: capName, of: capsArmed } } : {}),
  }).text;
  // A new run's run.json must not carry a limit nobody typed (the flag, MAX_USD_PER_RUN or the $12 default): run_status reads `maxUsd` from it as the run's cap. It is written after the limit is authorized (below).
  if (beforeAuthorize) beforeAuthorize();
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const outcome = await authorizeStart({
    runDir, runId, resume, sideVerb, scopeSha256: capScopeSha256(scope), scope, buildScreen, history: historyOfRun,
    ceiling: ceilings.length ? ceilings.reduce((low, c) => (c.usd < low.usd ? c : low)) : null,
    interactive, ask: (dir, gateId) => answerAtTerminal(dir, gateId, { startsRun: true }),
    forceRaise: capName ? capsRaiseTargets.includes(capName) : !sideVerb && argv.includes('--raise-cap'),   // B3 prototype; unit 4c1: under the caps, only the cap a raise names
    relayed: capName ? argv.includes('--relayed') && (capsRaiseTargets.includes(capName) || capName === capsStopCap) : !sideVerb && argv.includes('--relayed'),
    ...(capName ? { capName } : {}),
  });
  if (outcome.status === 'refused') { console.error(`\n${outcome.message}`); process.exit(2); }
  // unit 4c1: a pending gate is RELAYED only when the session asked for it (its ledger line's requester mark): a gate the person asked for earlier (a plain --resume) is
  // reused by authorizeStart and stays the person's to type, so the wait names `gate answer` for it, never relay-answer (which would refuse it).
  if (outcome.status === 'pending' && onPending) { const led = readGateLedger(runDir); const sessionAsked = led.ok && led.lines.some(l => l.event === 'gate_requested' && l.gate === outcome.gate && l.requested_by === 'session'); onPending({ capName, gate: outcome.gate, note: outcome.note ?? null, relayed: sessionAsked }); return null; }
  if (outcome.status === 'pending') {
    if (beforePendingExit) beforePendingExit();   // the wait is not a refusal: a choice typed on this command is kept for the plain --resume that follows `gate answer`
    if (outcome.note) console.error(`\n${outcome.note.message}`);
    // unit 4c1 (C&C, 1 Nov 2026: a defect, fixed in both modes): the relayed instruction only for a gate the SESSION asked for (its ledger line's requester mark); a
    // pending gate the person asked for (a plain --resume first) is reused by authorizeStart and stays the person's to type, so the wait names `gate answer` for it.
    const sessionAsked = (() => { const led = readGateLedger(runDir); return led.ok && led.lines.some(l => l.event === 'gate_requested' && l.gate === outcome.gate && l.requested_by === 'session'); })();
    if (!sideVerb && argv.includes('--relayed') && sessionAsked) console.error(`\nThis run waits for a raised spending limit that the person gives and the handler session relays. No call was started and nothing more was spent.\n  1. ${councilCommand()} relay-answer ${runDir} ${outcome.gate} --total <the total, in dollars> --person-words "<the person's words as typed in this window, with the total in digits>"\n  2. ${councilCommand()} --resume ${runDir} --raise-cap --relayed\nThe tool cannot verify the permission; the record shows who relayed it.`);   // A-DRAFT
    else console.error(`\nThis ${sideLabel ?? 'run'} waits for a spending limit that you type. No call was started and nothing more was spent.\n  1. ${councilCommand()} gate answer ${runDir} ${outcome.gate}\n  2. ${again ?? `${councilCommand()} --resume ${runDir}${!sideVerb && argv.includes('--raise-cap') ? ' --raise-cap' : ''}`}`);
    process.exit(EXIT_AWAITING_USER_CAP);
  }
  // S20 slice 1 (H2-l; G5, Mini-C&C's 'consumed, or recorded and printed, never a silent drop'): an approved early raise that could not be used (the ceiling now lower, not above what the run has counted, not above the limit it has) leaves
  // the run under the limit it has. It is PRINTED and written to run.log (an MCP caller reads run.log), and the answer itself stays in the gate ledger (`raises` in report.json lists only the raises the run used).
  if (outcome.setAside) {
    const line = terminalSafe(`The raise the person approved can no longer be used: ${outcome.setAside.reason}. It is closed in the record, and this resume keeps the limit of ${formatUsd(outcome.capUsd)}. To raise the limit, type a new raise: ${councilCommand()} --resume ${runDir} --raise-cap${capName ? ` ${capName}` : ''}`);   // A-DRAFT
    console.error(`\n${line}`);
    try { appendFileSync(join(runDir, 'run.log'), `${line}\n`); } catch { /* the run log is a convenience copy; the line is on stderr */ }
  }
  return outcome.capUsd;
}
// T4c: also called by the main path (start and resume of a paid run). T5a: the typed limit of a paid side command (rematch, replay; handoff / draft / digest follow in T5b). The gate lives in the folder the command spends in, is keyed by that folder's name (the logical run), and is the SAME authorizeStart as the main path.
// `--max-usd` is only a suggestion on the screen, and `none` / `off` is refused (a limit is a number a person types). `again` is the exact command that finds the same logical run again (the seed or the date is in it).
// T9: the operator's COUNCIL_MAX_USD_LIMIT for the CLI (as the process was GIVEN it, before server.js drops a placeholder and before a project .env is applied: a project file may only FILL an unset limit, never replace an operator's value, malformed or not; env-file's "blank counts as absent" serves keys and settings, not caps), resolved by the MCP server's rule (limitSource: an operator's non-empty value is never replaced by a project .env, even whitespace-only or malformed) -> the limit in dollars, or null when none
// is set; a value that is set and unreadable ends the command (exit 2) with ONE sentence per cause, whichever door found it first (the early refusal before any folder, or capGateOrExit's backstop). A host placeholder
// (`${user_config.max_usd}` left unexpanded) is refused too: the limit cannot be checked against it.
// The ONE reader (15 Oct 2026, tree ceiling unit): { usd: number | null, source: 'environment' | 'project-env', unreadable: sentence | null }. It never exits, so a caller that must record a refusal (the tree's member start) can; `usdLimitOrExit` wraps it with the
// SAME two sentences. `source` is where the value came from AS THIS PROCESS SEES IT: a member CLI spawned by a sitting inherits a value the sitting took from the project .env as if it were the operator's (api.js runCli copies process.env), so a member cannot tell the two apart and its sentence names both places.
function readUsdCeiling() {
  const raw = limitSource(USD_LIMIT_AS_GIVEN, process.env.COUNCIL_MAX_USD_LIMIT);
  const source = USD_LIMIT_AS_GIVEN !== undefined && USD_LIMIT_AS_GIVEN !== '' ? 'environment' : 'project-env';
  if (isLimitPlaceholder(raw)) return { usd: null, source, unreadable: 'COUNCIL_MAX_USD_LIMIT still holds a placeholder from a settings template that was never filled in, so no limit can be checked against it. Set it to a number of dollars, or unset it. Nothing was started.' };
  const limit = readUsdLimit(raw);
  if (limit.refusal) return { usd: null, source, unreadable: 'COUNCIL_MAX_USD_LIMIT is set but is not a positive number of dollars, so no limit can be checked against it. Nothing was started.' };
  return { usd: limit.value, source, unreadable: null };
}
function usdLimitOrExit() {
  const ceiling = readUsdCeiling();
  if (ceiling.unreadable) { console.error(`\n${ceiling.unreadable}`); process.exit(2); }
  return ceiling.usd;
}
// T9: a PAID start or side command with an unreadable limit is refused BEFORE any folder (it used to be refused inside the gate, after run.json or the side / gate folder existed). A chain with no paid seat never reads the limit and runs at $0.
function refuseUnreadableUsdLimitOnPaidStart(config) { if (chainIsPaid(config)) usdLimitOrExit(); }
function refuseNoneOnPaidStart(config) {
  // the sentence names the source the person used: the flag they typed, or the MAX_USD_PER_RUN (environment or .env) they set (the same discriminator as the `0 is refused` line)
  if (maxUsd === null && chainIsPaid(config)) { console.error(`${flag('max-usd', null) === null ? 'MAX_USD_PER_RUN=none' : '--max-usd none'} is not offered: a limit is a number a person types. Nothing was started.`); process.exit(2); }
}
async function sideLimitOrExit({ verb, dir, runId, config, subject, again, scopeBaseOf }) {
  mkdirSync(dir, { recursive: true });
  return capGateOrExit({ runDir: dir, runId, resume: false, config, fromRun: false, subject, scopeBaseOf, sideVerb: verb, again });
}
// T5b: the typed limit of a PAID post-run call on a finished run (handoff, contract draft, digest). Its gate lives in `<original run folder>/side/<verb>-<h8>/`; <h8> is the first 8 hex of the SHA-256 of the plain identity (verb, chain, provider/model: a model id holds a `/`,
// which a logical run id does not allow). The logical run id is `<original run id>:<verb>-<h8>`; the spend, the floor and the usage lines are the ORIGINAL folder's, the gate folder holds only the gate ledger, the screens, cap-scope-<n>.json and the stop file.
function postRunGateDir(origDir, verb, plain, who) {
  const h8 = sha256Hex(plain).slice(0, 8);
  const runId = `${basename(origDir)}:${verb}-${h8}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(runId)) { console.error(`${who}: the run folder's name (${basename(origDir)}) is too long, or holds a character that a spending limit cannot be recorded under. Nothing was started and nothing was spent.`); process.exit(2); }
  return { dir: join(origDir, 'side', `${verb}-${h8}`), runId };
}
async function postRunLimitOrExit({ who, verb, label, origDir, config, plain, subject, scopeBaseOf, worstUsd, again, flagUsd }) {
  const g = postRunGateDir(origDir, verb, plain, who);
  mkdirSync(g.dir, { recursive: true });
  const cap = await capGateOrExit({ runDir: g.dir, runId: g.runId, resume: false, config, fromRun: false, subject, scopeBaseOf, sideVerb: verb, sideLabel: label, again, floorDir: origDir, oneCall: { usd: worstUsd }, flagUsd });
  // the stop file of an earlier sitting was the history of the screen just answered; a later stop writes its own
  rmSync(join(g.dir, 'STOPPED-budget.json'), { force: true });
  return { cap, gateDir: g.dir };
}
// The stop of a PAID post-run call at the typed total: ONE stop file, in the gate folder only (the original folder holds the main run's own stop file and must not be overwritten), then the same-command-again text. Exits 4.
function postRunBudgetStop(gateDir, err, what, again) {
  err.spent = Math.max(err.spent || 0, budgetState().spent);
  mkdirSync(gateDir, { recursive: true });
  writeFileSync(join(gateDir, 'STOPPED-budget.json'), JSON.stringify({ stoppedAt: err.label ?? what, seat: err.seat, spentUsd: stoppedSpentUsd(err, budgetState()), capUsd: err.cap, projectedStageUsd: err.projected, gateStageUsd: err.gate }, null, 2));
  console.error(`${what}: stopped by the limit (${formatUsd(err.spent || 0)} counted of ${formatUsd(err.cap)}; this call could cost up to ${formatUsd(err.projected)}). Run the same command again: it asks for a new total above ${formatUsd(err.spent || 0)} (the smallest total that lets the next call to a model be sent is ${formatUsd(resumeCeilingUsd({ cap: err.cap, spent: err.spent, projected: err.projected, gate: err.gate }) ?? Math.ceil((err.cap + err.projected) * 100) / 100)}):\n  ${again}`);
  process.exit(4);
}
// The command that finds the same side run again: the argv exactly as the person typed it, plus the one flag that makes it the SAME run when they left it out (the seed of a rematch is random, a replay's date is today). Words with a space or a quote are single-quoted.
function shellWord(w) { return (/^[A-Za-z0-9@%+=:,./_-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`); }
function againCommand(extra) { return `${councilCommand()} ${[...argv, ...extra].map(shellWord).join(' ')}`; }
function policySha256Of(cwd) { return (existsSync(join(cwd, 'policy.json')) ? sha256Hex(readFileSync(join(cwd, 'policy.json'))) : null); }
// The chain's rows exactly as the main `--dry-run` prints them (moved here from the dry-run block below, unchanged): the expected figure, the maximum, and a note for external seats. -> the expected rows.
function printChainRows(config, { fromRun = false, typedReads = null } = {}) {
  const rows = estimateChainRows(config, { fromRun, typedReads });
  const w = Math.max(...rows.map(r => r.seat.length));
  for (const r of rows) {
    // Bug audit 2026-09-28 (area 2 #6): an external seat printed as a priced "$0.0000", though a
    // person or another session does that work outside this total (plan-daily-7's Opus voter).
    const cost = r.seat.startsWith('external/') ? 'external' : r.priced ? formatUsd(r.usd) : 'unpriced';
    console.log(`  ${(r.times ? `${r.label} x${r.times}` : r.label).padEnd(12)} ${r.seat.padEnd(w)}  ${String(r.input).padStart(7)} in  ${String(r.output).padStart(6)} out  ${cost}`);
  }
  const t = rows.reduce((s, r) => ({ i: s.i + r.input, o: s.o + r.output, u: s.u + r.usd }), { i: 0, o: 0, u: 0 });
  console.log(`\n  TOTAL        ${''.padEnd(w)}  ${String(t.i).padStart(7)} in  ${String(t.o).padStart(6)} out  ${formatUsd(t.u)}  per run  (expected)`);
  // 0.8.2 item 8c: the same calls with every one writing its seat's whole output allowance (and an Anthropic seat's one retry): what the spend cap's own projection charges. Both figures, so a cap can be chosen against the right one.
  const maxRows = estimateChainRows(config, { fromRun, maximum: true, typedReads });
  const mt = maxRows.reduce((s2, r) => ({ o: s2.o + r.output, u: s2.u + r.usd }), { o: 0, u: 0 });
  console.log(`  UPPER ESTIMATE ${''.padEnd(w)}  ${''.padStart(7)}   ${String(mt.o).padStart(6)} out  ${formatUsd(mt.u)}  per run  (every planned call at its whole output allowance; re-asks and network retries at their expected cost)`);
  const externalRows = rows.filter(r => r.seat.startsWith('external/')).reduce((n, r) => n + (r.times ?? 1), 0);
  const stageCount = rows.reduce((n, r) => n + (r.times ?? 1), 0);
  if (externalRows) console.log(`\n  ${externalRows} of ${stageCount} stages are answered by external seats (a person or another session, e.g. a Claude Code session on a subscription) and are not in this total.`);
  return rows;
}
// A side folder that was started and did not finish: how many stages are on disk and what they cost. The resume notice (armSideRun) and the dry run read the same figures.
function unfinishedSideSummary(dir, config) {
  if (!existsSync(dir)) return null;
  const kept = readdirSync(dir).filter(f => f.endsWith('.usage.json') && existsSync(join(dir, f.replace(/\.usage\.json$/, '.md'))));
  if (!kept.length) return null;
  const remaining = estimateChainRows(config, { maximum: true }).filter(r => !existsSync(join(dir, `${r.label}.md`))).reduce((n, r) => n + r.usd, 0);
  return { stages: kept.length, paid: runSpentUsd(dir), remaining };
}
// `--replay --dry-run` / `--rematch --dry-run`: the chain's rows at today's prices, then exit 0. An unpriced seat is shown as unpriced (the real side runs refuse one only under a cap).
function priceSideRunAndExit(what, config, sideDir, routing, zero) {
  console.log(`\nChain: ${config.name} - ${config.description}`);
  for (const l of [...routeLines(routing), ...resumeStopLines(routing, what.slice(2)), ...zeroRetentionLines(zero ?? {}), ...skippedRoomLines(routedSeatsWithoutWindow(everySeatOf(config)))]) console.log(l);      // `routing` is the caller's own decision: this runs before the module-level one is made (C4: C2 read the later `const` here, a ReferenceError for every --rematch/--replay --dry-run)
  printChainRows(config);
  if (zero?.refusal) { console.log(''); console.log(`  ${zero.refusal}`); }      // 0.8.4 zero retention: what a real run would stop with (exit 5), said and gone on
  const sum = unfinishedSideSummary(sideDir, config);
  if (sum) console.log(`\n${what}: ${basename(sideDir)} was started and did not finish: ${sum.stages} stage(s) are on disk (recorded spend so far: ${formatUsd(sum.paid)}); a real run could cost up to ${formatUsd(sum.remaining)} more for the stages still to run, not the whole chain.`);
  process.exit(0);
}
// `handoff` / `contract draft` / `digest --provider` with --dry-run: one call, priced as invoke() projects it before sending (the whole prompt as input, the seat's whole maxTokens as output, an Anthropic seat's second attempt).
function priceSingleCallAndExit(who, seat, { system = '', user = '' }, skip) {
  if (needsPrice(seat)) { console.error(`\n${formatCouncilError('COUNCIL-E002', { provider: seat.provider, model: seat.model, problem: priceProblemOf(seat.provider, seat.model), roles: who })}`); process.exit(EXIT_DEGRADABLE); }
  refuseStray(skip);   // the last refusal, after the unpriced-seat one
  console.log(`${who}: this call could cost up to ${formatUsd(projectStage(seat, { system, user }))}. Nothing was sent and nothing was spent.`);
  process.exit(0);
}

// D1 (T1-14 fix-up, 14 Oct 2026, A8 D1): a post-run paid call (handoff, contract draft, digest) goes through invoke(), which settles its reservation as `recorded` the moment the reply is back; the usage record is written AFTER that, by recordCall.
// When that write fails the call WAS paid and is in no total at all: the settled line is left out of every unsettled sum and no usage file exists. So a failure here writes a FRESH unsettled reservation at the call's worst case (the figure
// invoke() projected, projectStage), which every total counts exactly once (the settled line adds nothing), says so on stderr and in WARNINGS.md, and makes the command exit 16 AFTER it has done its work (C&C Q1, 14 Oct 2026: paid output is
// never lost, the T2-1 class): the caller goes on and writes the reply it paid for, and an exit handler turns the exit 0 of that success into 16. A seat priced at $0 has no worst case to charge (an unsettled $0 line adds nothing), so it
// gets its own sentence (C&C Q2). If even the worst-case line cannot be written, the sentence says the total is too low.
function recordCallOrCharge(runDir, label, rec, { seat, system, user }, who, mirror = null) {
  try { return recordCall(runDir, label, rec); } catch (err) {
    const why = err?.code || err?.message || 'unknown';
    const worst = projectStage(seat, { system, user });
    let line;
    if (!(worst > 0)) {
      line = `${who}: the call was made, but its cost could not be recorded (${why}). Its seat is priced at $0.00, so this run's total is unchanged.`;
    } else {
      // read back, not assumed: a tree member's mirror can refuse AFTER the run-file line is written (that line stays, charged)
      const before = unsettledUsd(runDir);
      try { openReservations(runDir, mirror ? { mirror } : {}).reserve({ label, seat: `${seat.provider}/${seat.model}`, usd: worst, standsFor: rec?.reservationId }); } catch { /* said below */ }   // 0.8.4 unit 6: names the reservation it stands for, so the one reader counts the call once
      const charged = unsettledUsd(runDir) > before;
      line = charged
        ? `${who}: the call was made, but its cost could not be recorded (${why}). This run's total now counts it at its worst case, ${formatUsd(worst)}, because the real figure is not on disk; the provider's own bill has the real one.`
        : `${who}: the call was made, but its cost could not be recorded (${why}) and the worst case could not be written either, so this run's total is too low by up to ${formatUsd(worst)}. Check the provider's bill.`;
    }
    console.error(line);
    try {
      if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
      appendFileSync(join(runDir, 'WARNINGS.md'), `- ${line}\n`);
    } catch { /* stderr has it */ }
    if (recordFailedWho === null) {
      recordFailedWho = who;
      // a success that could not be recorded is not a success: the command went on to write what it paid for, and only if it is about to exit 0 (the reply was written) does it say so and turn the exit into 16. A cut-off or empty reply exits non-zero
      // by its own path with its own sentence ("nothing was written"), so the claim is never made there.
      process.on('exit', code => { if (code === 0) { console.error(`${recordFailedWho}: the reply above was written. This command exits 16 only because the cost of the call could not be recorded.`); process.exitCode = EXIT_RUN_FAILED; } });
    }
    return null;
  }
}

const rematchArg = flag('rematch', null);
if (rematchArg) {
  refuseOnUserPriceProblem();
  refuseSideJson('--rematch');
  const originalRunDir = resolve(work, rematchArg);
  const originalReportPath = join(originalRunDir, 'report.json');
  const originalReport = readReportOrExit(originalReportPath, '--rematch');
  const originalRunMetaPath = join(originalRunDir, 'run.json');
  if (!existsSync(originalRunMetaPath)) {
    console.error(`--rematch: no run.json in ${originalRunDir} - can't recover the original task/chain.`);
    process.exit(2);
  }
  // Replay audit #3: an unparseable run.json degrades to a clean exit 2, like readReportOrExit.
  let originalRunMeta;
  try { originalRunMeta = JSON.parse(readFileSync(originalRunMetaPath, 'utf8')); } catch {
    console.error(`--rematch: run.json in ${originalRunDir} is not valid JSON - can't recover the original task/chain.`);
    process.exit(2);
  }
  // 0.8.3 M2 (C&C, 8 Oct): a rematch is a paid call on a finished run that writes a SIDE folder, and the tree sums only the folders its record names, so it would spend outside the tree's accounting. Refused for a tree member,
  // before the side folder exists.
  if (originalRunMeta.tree) { console.error(`--rematch: ${originalRunDir} is a member of a recursive-councils tree; a rematch would spend outside the tree's record. Nothing was run and nothing was spent.`); process.exit(EXIT_TREE_REFUSED); }
  { const placed = sidePlacementRefusal('--rematch', 'a rematch', originalRunDir); if (placed) { console.error(placed); process.exit(2); } }
  const seedArg = flag('rematch-seed', null);
  // Default random, but always recorded on disk (run.json below) so a rematch that used a random
  // seed is still reproducible after the fact by reading what it actually ran with.
  // CR-RM-002: the seed becomes part of a folder name (`<id>.rematch-<seed>`) that the spend and status readers recognise only for digits, so it is digits only: `-5` made `<id>.rematch--5`, which no reader sees, and `1e21` or `0x10` were
  // taken as numbers too. (A bare `--rematch-seed` with no value arrives as `true` and keeps today's behaviour.)
  if (typeof seedArg === 'string' && !(/^\d+$/.test(seedArg) && Number.isSafeInteger(Number(seedArg)))) {
    console.error(`--rematch-seed: expected a whole number written with digits only, from 0 up to 9007199254740991, got "${seedArg}". Nothing was run and nothing was spent.`);
    process.exit(2);
  }
  const seed = seedArg !== null ? Number(seedArg) : Math.floor(Math.random() * 1_000_000);
  // CR-RM-003: only an original run can be rematched. The folder the rematch would make has to be a name the spend and status readers recognise (RUN_FOLDER, the same regex they use): `<id>.rematch-5.rematch-7` and `<id>-init.rematch-7` are
  // not, so their spend would be invisible to --spend, --cost-today and the limits. A rematch folder also records `rematchOf`. (A --replay folder has no run.json at all, so it is refused above.)
  if (originalRunMeta.rematchOf || !RUN_FOLDER.test(`${basename(originalRunDir)}.rematch-${seed}`)) {
    console.error(`--rematch: ${basename(originalRunDir)} cannot be rematched: only a finished run whose folder is named by its start time (like 2026-10-25T18-37-06-737Z) can, because the spend of a rematch of anything else would not show in --spend or the spending limits. Rematch the original run instead. Nothing was run and nothing was spent.`);
    process.exit(2);
  }

  // CR-RM-001: the task is read where the original run read it (run.json `cwd`, as the side-run gate and the report below already do) and must be the bytes the original run started with (its recorded taskHash, the way --replay checks):
  // an edited task would be paid for and the board would blame the panel for a change of input, and a rematch only ever sends the task text the original start checked for personal data and keys. A run.json from before taskHash existed has none to compare.
  const originalTaskPath = originalRunMeta.task;
  // A run started today records its task path ABSOLUTE, and an absolute path is used as it is. The lookup below serves an older RELATIVE record: run.json `cwd` first, and the folder the command runs from when that folder is gone. Either way the recorded hash
  // below is what decides: the same bytes rematch, a different file is refused. (A project folder that was moved or renamed breaks an absolute record for --resume and --replay too: one rule for all three verbs is a 0.8.4 item.)
  const originalTaskDir = originalRunMeta.cwd && existsSync(originalRunMeta.cwd) ? originalRunMeta.cwd : work;
  const originalTaskFile = originalTaskPath ? resolve(originalTaskDir, originalTaskPath) : null;
  if (!originalTaskPath || !existsSync(originalTaskFile)) {
    console.error(`--rematch: original task file not found (recorded as "${originalTaskPath}" in ${originalRunMetaPath}).`);
    process.exit(2);
  }
  const originalRequest = readFileSync(originalTaskFile, 'utf8');
  if (originalRunMeta.taskHash && taskHashOf(originalRequest) !== originalRunMeta.taskHash) {
    console.error(`--rematch: the task file ${originalTaskFile} has changed since ${basename(originalRunDir)} started - a rematch tests the panel, not the task, so the input must be byte-identical. Restore the file to what that run started with. Nothing was run and nothing was spent.`);
    process.exit(2);
  }

  const chainName = originalRunMeta.chain;
  { const bad = chainNameRefusal(chainName, `--rematch: the chain recorded in ${originalRunMetaPath}`); if (bad) { console.error(bad); process.exit(2); } }
  const chainConfigPath = [join(work, 'chains', `${chainName}.json`), join(pkg, 'chains', `${chainName}.json`)]
    .find(existsSync);
  if (!chainConfigPath) {
    console.error(`--rematch: chain "${chainName}" (recorded in ${originalRunMetaPath}) has no chain config on disk.${outdatedChainHint(chainName)}`);
    process.exit(2);
  }
  const rawRematchConfig = withSavedPersonaForm(JSON.parse(readFileSync(chainConfigPath, 'utf8')), originalRunMeta);      // 0.8.4 the persona form the original run saved is kept
  exitOnLint(rawRematchConfig, chainConfigPath);
  const rematchRouting = routeRun(rawRematchConfig, { meta: originalRunMeta, who: '--rematch', dry: sideDryRun });
  const originalConfig = rematchRouting.config;
  // CR-MX-001: a layered array where only some seats have a layer is refused, and where each seat of the RESHUFFLED config would send its key is checked before anything else (the lint above ran on the original chain only).
  const rematchConfig = (() => {
    try { return reshuffleSeats(originalConfig, seed); } catch (err) {
      if (err instanceof RematchRefused) { console.error(`--rematch: ${err.message} Nothing was run and nothing was spent.`); process.exit(2); }
      throw err;
    }
  })();
  {
    const bad = rematchDestinationProblems(everySeatOf(rematchConfig));
    if (bad.length) { console.error(`--rematch: after the seats were reshuffled, ${bad.map(b => `${b.seat}: ${b.reasons.join('; ')}`).join(' | ')}. A rematch never sends a key where the chain itself would not. Nothing was run and nothing was spent.`); process.exit(2); }
  }
  refuseSideRun('--rematch', originalConfig, originalRunMeta);
  // CR-RC-008: the policy file is THIS project's (`work`). The original is directly in work/runs (the placement check above), so `work` is the project that owns the run; the run's recorded folder is gone when the project was moved or renamed, and "no folder, so no policy" would have let the rematch past a monthly limit.
  const rematchZero = zeroRetentionRun(rematchConfig, { meta: originalRunMeta, who: '--rematch', dry: sideDryRun });      // 0.8.4 zero retention, on the roster the rematch sends
  sideGateOrExit(rematchConfig, everySeatOf(rematchConfig));
  if (sideDryRun) refuseStray();   // T1-1: a dry run prints after the gate and has no refusal of its own below; a real rematch is checked after its key, price and already-run refusals, further down
  if (sideDryRun) priceSideRunAndExit('--rematch', rematchConfig, join(dirname(originalRunDir), `${basename(originalRunDir)}.rematch-${seed}`), rematchRouting, rematchZero);

  // Every seat the rematch can call, the same list the main run checks (everySeatOf): it used to name
  // eight slots by hand and missed seats.alternatives, seats.deep_dive and every later seat kind, so a
  // rematch of a tiered chain started without the key those seats need (PR #13 verification, #4).
  const missing = checkSeats(everySeatOf(rematchConfig));
  if (missing.length) {
    console.error(`\nMissing API keys for: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Audit fix cnc-money F3: an unpriced seat under a cap is refused before any folder exists (it used to leave <id>.rematch-N/run.json behind, so the same command later said "already exists").
  const rematchPaid = chainIsPaid(rematchConfig);
  refuseUnpricedOrExit(rematchConfig, maxUsd, { paidStart: rematchPaid });
  refuseNoneOnPaidStart(rematchConfig); refuseUnreadableUsdLimitOnPaidStart(rematchConfig);
  const rematchRunId = `${basename(originalRunDir)}.rematch-${seed}`;
  const rematchRunDir = join(dirname(originalRunDir), rematchRunId);
  // Replay audit #4: the same seed again re-paid the whole rematch and overwrote the earlier folder.
  // T2-1: only a FINISHED rematch (report.json) is "already run"; one that was started and did not finish is resumed from its stage files (armSideRun).
  if (existsSync(join(rematchRunDir, 'report.json'))) {
    console.error(`--rematch: ${rematchRunId} already exists - that seed was already run. Use another --rematch-seed, or move the old folder aside first. Nothing was run.`);
    process.exit(2);
  }
  refuseStray();   // T1-1: the last refusal before the budget, the folder and the first call (every refusal of this block is above)
  // T5a: a PAID rematch waits for a limit a person types, in the rematch folder itself (made here, after every refusal above). The seed is part of the folder's name, so the printed next step carries it: a second invocation without it would be another rematch.
  const rematchAgain = againCommand(argv.includes('--rematch-seed') ? [] : ['--rematch-seed', String(seed)]);
  const rematchCap = rematchPaid ? await sideLimitOrExit({
    verb: 'rematch', dir: rematchRunDir, runId: rematchRunId, config: rematchConfig, subject: { chain: chainName, task: originalTaskPath }, again: rematchAgain,
    scopeBaseOf: () => ({ taskSha256: sha256Hex(originalRequest), contextSha256: null, chainSha256: sha256Hex(readFileSync(chainConfigPath)), policySha256: policySha256Of(work), sensitivityFloor: null, piiMode: null }),
  }) : maxUsd;
  setBudgetOrExit(rematchCap); // before armSideRun: setBudget starts the counters again, and the earlier sittings' spend is counted into them
  const rematchSide = armSideRun('--rematch', rematchRunDir, rematchConfig, fingerprintInputs(originalRequest, rematchConfig));
  if (!existsSync(join(rematchRunDir, 'run.json'))) writeFileSync(join(rematchRunDir, 'run.json'), JSON.stringify({
    chain: chainName, task: originalTaskPath, rematchOf: basename(originalRunDir), rematchSeed: seed,
  }, null, 2));

  console.log(`\nrematch of ${basename(originalRunDir)} (chain: ${chainName}, seed: ${seed})`);
  console.log(`cap:   ${rematchCap === null ? 'none - this rematch has no spend ceiling' : `${formatUsd(rematchCap)} (${rematchPaid ? 'the limit typed for this rematch' : '--max-usd'})`}`);
  let rematchResult;
  const rematchStartedAt = new Date().toISOString();
  try {
    rematchResult = await runChain({
      request: originalRequest,
      config: rematchConfig,
      log: line => console.log(terminalSafe(line)),
      onStage: rematchSide.onStage,
    });
    if (rematchSide.unverified.length) rematchResult.unverifiedReplays = rematchSide.unverified;
    foldSupersededInto(rematchResult, rematchRunDir);
  } catch (err) {
    if (err instanceof BudgetExceeded) writeSideRunBudgetStop(rematchRunDir, err, '--rematch', { // exits 4, like a normal run
      runId: rematchRunId, chain: chainName, task: originalTaskPath, taskCwd: originalRunMeta.cwd || work, taskText: originalRequest, startedAt: rematchStartedAt, config: rematchConfig, verdictEnvelope: rematchSide.envelope,
    }, rematchPaid ? rematchAgain : null);
    if (err instanceof SecretShapedPrompt) exitOnSecretShaped(err, '--rematch');
    console.error(`--rematch: the reshuffled run did not complete (${err.message}). No diff written - a rematch that never reached a verdict has nothing to diff.`);
    process.exit(1);
  }

  writeFileSync(join(rematchRunDir, 'deliverable.md'), rematchResult.deliverable);
  const rematchBoard = renderBoardMd({ runId: rematchRunId, result: rematchResult });
  if (rematchBoard) writeFileSync(join(rematchRunDir, 'BOARD.md'), rematchBoard);
  const newReport = reportJsonShape({
    runId: rematchRunId, chain: chainName, task: originalTaskPath, taskCwd: originalRunMeta.cwd || work, taskText: originalRequest, startedAt: rematchStartedAt, result: rematchResult, config: rematchConfig, verdictEnvelope: rematchSide.envelope,
  });   // the run's config, as the budget-stop record above has it: the records that read it (seat_personas, severity, the persona fields, the debate's role labs) are a rematch's too
  writeAtomic(join(rematchRunDir, 'report.json'), JSON.stringify(newReport, null, 2));

  const diff = computeVerdictDiff(originalReport, newReport);
  writeFileSync(join(rematchRunDir, 'rematch-diff.json'), JSON.stringify(diff, null, 2));

  console.log(`\nrematch verdict: ${verdictShort(newReport)} (original: ${verdictShort(originalReport)})`);
  console.log(`signoff_match: ${diff.signoff_match}  verdict_category_changed: ${diff.verdict_category_changed}  objection_overlap_ratio: ${diff.objection_overlap_ratio.toFixed(2)}`);
  if (diff.critics_objecting_added.length) console.log(`critics newly objecting: ${diff.critics_objecting_added.join(', ')}`);
  if (diff.critics_objecting_removed.length) console.log(`critics no longer objecting: ${diff.critics_objecting_removed.join(', ')}`);
  console.log(`\nWrote ${rematchRunDir} (deliverable.md, report.json, rematch-diff.json).`);
  process.exit(endsNotAgreed(newReport) ? EXIT_NOT_AGREED : 0);   // 0.8.4 S4: the one shared agreement predicate (src/ending.js); newReport.final_read is read through it
}

// `--replay <run-dir> [--replay-date YYYY-MM-DD] [--allow-task-drift]` (v6 item D, harness
// feature round: relay/runs/2026-09-15T15-12-52-325Z/deliverable.md, "Item D — Council
// replay"): rerun an already-decided task's exact original input against today's chain config,
// then diff the new verdict against the one already recorded. Read-only with respect to
// src/chain.js and src/tools.js (0-line delta, per the plan) - the mechanism lives entirely in
// src/council-replay.js and the diff semantics it shares with item C's --rematch in
// src/verdict-diff.js. Not a claim that the new run is better or worse - see both modules'
// own headers.
if (argv.includes('--replay')) {
  refuseOnUserPriceProblem();
  refuseSideJson('--replay');
  const runArg = flag('replay', null);
  if (!runArg || runArg === true) {
    console.error('--replay: a run folder path is required, e.g. --replay runs/2026-09-01T00-00-00-000Z');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, 'report.json')) || !existsSync(join(runDir, 'run.json'))) {
    console.error(`--replay: ${runDir} is not a completed run folder (needs run.json and report.json)`);
    process.exit(2);
  }
  const dateArg = flag('replay-date', null);
  const date = dateArg ? new Date(`${dateArg}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(date.getTime())) {
    console.error('--replay-date: expected YYYY-MM-DD');
    process.exit(2);
  }
  // Same work-then-pkg chain-config search order as a normal run (line ~749 above) - a chain
  // named by the original run may live in the user's own chains/ or in the shipped set.
  let runMetaForChain;
  try { runMetaForChain = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); } catch {
    console.error(`--replay: run.json in ${runDir} is not valid JSON - can't recover the original task/chain.`);
    process.exit(2);
  }
  // 0.8.3 M2 (C&C, 8 Oct): same as --rematch above: a replay writes a side folder the tree's accounting does not read.
  if (runMetaForChain.tree) { console.error(`--replay: ${runDir} is a member of a recursive-councils tree; a replay would spend outside the tree's record. Nothing was run and nothing was spent.`); process.exit(EXIT_TREE_REFUSED); }
  { const placed = sidePlacementRefusal('--replay', 'a replay', runDir); if (placed) { console.error(placed); process.exit(2); } }
  // CR-RC-007: the folder the replay would make has to be a name the spend and status readers recognise (RUN_FOLDER, the same regex they use), as for --rematch (CR-RM-003). `<id>.rematch-5.replay-<date>` and
  // `<id>-init.replay-<date>` are not, so their spend would be invisible to --spend, --cost-today and the limits. A-DRAFT: the same sentence as the accepted --rematch one, with "replay" for "rematch".
  if (!RUN_FOLDER.test(basename(replayDirFor(runDir, date)))) {
    console.error(`--replay: ${basename(runDir)} cannot be replayed: only a finished run whose folder is named by its start time (like 2026-10-25T18-37-06-737Z) can, because the spend of a replay of anything else would not show in --spend or the spending limits. Replay the original run instead. Nothing was run and nothing was spent.`);
    process.exit(2);
  }
  // Replay audit #4: a second replay on the same day re-paid everything and overwrote the first. T2-1 (13 Oct 2026): only a FINISHED replay (report.json) is "already replayed"; a folder that was started and did not finish is
  // RESUMED from its stage files (armSideRun, below), so its paid stages are not paid for again; a live process on it is refused by the run lock.
  if (existsSync(join(replayDirFor(runDir, date), 'report.json'))) {
    console.error(`--replay: ${basename(replayDirFor(runDir, date))} already exists - this run was already replayed for that date. Pass another --replay-date, or move the old folder aside first. Nothing was run.`);
    process.exit(2);
  }
  { const bad = chainNameRefusal(runMetaForChain.chain, `--replay: the chain recorded in ${join(runDir, 'run.json')}`); if (bad) { console.error(bad); process.exit(2); } }
  const chainsDirCandidates = [join(work, 'chains'), join(pkg, 'chains')];
  const chainsDir = chainsDirCandidates.find(d => existsSync(join(d, `${runMetaForChain.chain}.json`))) || chainsDirCandidates[1];
  let replayPaid = false;
  {
    const replayChainPath = join(chainsDir, `${runMetaForChain.chain}.json`);
    let rawReplayConfig = null;
    try { rawReplayConfig = withSavedPersonaForm(JSON.parse(readFileSync(replayChainPath, 'utf8')), runMetaForChain); } catch { /* council-replay reports a missing or bad chain itself */ }
    if (rawReplayConfig) {
      exitOnLint(rawReplayConfig, replayChainPath);
      let replayConfig = null, replayRouting = null;
      try { replayRouting = routeRun(rawReplayConfig, { meta: runMetaForChain, who: '--replay', dry: sideDryRun }); replayConfig = replayRouting.config; } catch { /* reported by council-replay */ }
      if (replayConfig) {
        refuseSideRun('--replay', replayConfig, runMetaForChain);
        const replayZero = zeroRetentionRun(replayConfig, { meta: runMetaForChain, who: '--replay', dry: sideDryRun });      // 0.8.4 zero retention, on the roster the replay sends
        sideGateOrExit(replayConfig, everySeatOf(replayConfig));   // CR-RC-008: this project's policy file, as for --rematch
        if (sideDryRun) refuseStray();   // T1-1: as for --rematch; a real replay is checked below
        if (sideDryRun) priceSideRunAndExit('--replay', replayConfig, replayDirFor(runDir, date), replayRouting, replayZero);
        replayPaid = chainIsPaid(replayConfig);
        refuseUnpricedOrExit(replayConfig, maxUsd, { paidStart: replayPaid });
        refuseNoneOnPaidStart(replayConfig); refuseUnreadableUsdLimitOnPaidStart(replayConfig);
      }
    }
    // a dry run prices the chain recorded in the run; one that cannot be read is not priced, and not run
    if (sideDryRun) { console.error('--replay: --dry-run prices the chain recorded in the run, and that chain could not be read (running the replay without --dry-run refuses it and says why). Nothing was run and nothing was spent.'); process.exit(2); }
  }
  refuseStray();   // T1-1: the last refusal before the budget and the replay folder, after the unreadable-chain dry-run refusal above
  // T5a: a PAID replay waits for a limit a person types, asked in the replay folder once every refusal of the replay itself (task drift, the chain load) has passed (the onReady hook, below); a free replay keeps --max-usd.
  const replayAgain = againCommand(argv.includes('--replay-date') ? [] : ['--replay-date', date.toISOString().slice(0, 10)]);
  if (!replayPaid) {
    setBudgetOrExit(maxUsd);
    console.log(`cap:   ${maxUsd === null ? 'none - this replay has no spend ceiling' : `${formatUsd(maxUsd)} (--max-usd)`}`);
  }
  let replayNotAgreed = false;
  try {
    const { replayDir, diff, report: replayReport } = await runCouncilReplay(runDir, {
      chainsDir,
      workDir: work,
      date,
      log: (...parts) => console.log(terminalSafe(parts.join(' '))),
      allowTaskDrift: argv.includes('--allow-task-drift'),
      prepareConfig: c => { const kept = withSavedPersonaForm(c, runMetaForChain); try { return routeRun(kept, { meta: runMetaForChain, who: '--replay' }).config; } catch { return kept; } },      // 0.8.4 the persona form the run saved is kept (the pre-read above does the same)      // 0.8.4 the Claude route: the run's own route, as the gate above saw it; a chain the route cannot resolve (a transport with no route for a paid seat) is read as it is, as before, and the guard in onReady refuses it
      onReady: async ({ dir, config, fingerprint, taskText }) => {
        // the decision is the config that RUNS: if the CLI could not pre-read it (so no key, price, policy or `none` check ran for it) and it turns out paid, nothing is run ungated
        const paidNow = chainIsPaid(config);
        if (paidNow && !replayPaid) { console.error('--replay: the chain could not be read before the run, so no limit can be asked for it. Nothing was started.'); process.exit(2); }
        if (!paidNow && replayPaid) { setBudgetOrExit(maxUsd); console.log(`cap:   ${maxUsd === null ? 'none - this replay has no spend ceiling' : `${formatUsd(maxUsd)} (--max-usd)`}`); }
        if (paidNow) {
          const replayCap = await sideLimitOrExit({
            verb: 'replay', dir, runId: basename(dir), config, subject: { chain: config.name, task: runMetaForChain.task }, again: replayAgain,
            scopeBaseOf: () => ({ taskSha256: sha256Hex(taskText), contextSha256: null, chainSha256: sha256Hex(readFileSync(join(chainsDir, `${runMetaForChain.chain}.json`))), policySha256: policySha256Of(work), sensitivityFloor: null, piiMode: null }),
          });
          setBudgetOrExit(replayCap);
          console.log(`cap:   ${formatUsd(replayCap)} (the limit typed for this replay)`);
        }
        return armSideRun('--replay', dir, config, fingerprint);
      },
    });
    console.log(`\nWrote ${replayDir} (report.json, deliverable.md, replay-diff.json).`);
    console.log(`signoff_match: ${diff.signoff_match}  verdict_category_changed: ${diff.verdict_category_changed}`);
    replayNotAgreed = endsNotAgreed(replayReport);   // 0.8.4 S4: the shared predicate (--replay re-runs the chain and builds a NEW report: its own `ending` decides)
  } catch (err) {
    if (err instanceof BudgetExceeded) writeSideRunBudgetStop(replayDirFor(runDir, date), err, '--replay', err.partialReportArgs, replayPaid ? replayAgain : null); // exits 4, like a normal run
    if (err instanceof SecretShapedPrompt) exitOnSecretShaped(err, '--replay');
    console.error(`--replay: ${err.message}`);
    process.exit(1);
  }
  process.exit(replayNotAgreed ? EXIT_NOT_AGREED : 0);
}

// `council --spend [--days N]` answers "what have I spent across every run",
// which neither run_status (one run) nor the per-run cap (one run) can.
// The free modes below price or read and never spend; they refuse a stray word before they answer.
if (['--spend', '--cost-today', '--stats', '--metrics', '--forecast-cost', '--mcp'].some(f => argv.includes(f))) refuseStray();
if (argv.includes('--spend')) {
  const days = Number(flag('days', 1));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const r = spendReport(join(work, 'runs'), { days });
  console.log(`\nSpend across ${r.count} run(s) since ${r.since.toISOString().slice(0, 16).replace('T', ' ')}  (${join(work, 'runs')})`);
  if (!r.count) {
    console.log(`  no runs in this window.${r.note ? `  ${r.note}` : ''}`);
  } else {
    const w = Math.max(...r.runs.map(x => (x.chain || '?').length));
    for (const x of r.runs) {
      console.log(`  ${x.id}  ${(x.chain || '?').padEnd(w)}  ${formatUsd(x.usd).padStart(9)}  ${x.state}`);
      // 0.8.4 unit 2 (D12 part 2, A-DRAFT): what the provider REPORTED beside THC's count, labelled, never added to the total; only when an attempt carried a figure.
      // 0.8.4 unit 6 (D11, A-DRAFT): a settled line with no reserved line is damage to the file; it is counted nowhere and named here (the folder, the id).
      for (const orphan of orphanSettledIdsOf(join(work, 'runs', x.id))) console.log(`      ${x.id}  reservation ${terminalSafe(String(orphan).slice(0, 80))}: a settled line with no reserved line: damage, counted nothing`);   // the id is read from a file a project can write: shown without control characters
      const pr = x.providerReported;
      if (pr && pr.attempts > 0) console.log(`      provider-reported cost (unverified; the provider reports it in credits): ${Number(pr.cost.toFixed(6))} for ${pr.attempts} attempt(s); THC counted ${formatUsd(pr.thcUsd)} for those${pr.attemptsWithout ? `; ${pr.attemptsWithout} paid attempt(s) carried none` : ''}. Not in the total.`);
    }
    console.log(`  ${''.padEnd(24)}  ${''.padEnd(w)}  ${formatUsd(r.totalUsd).padStart(9)}  total`);
    if (r.totalEstimatedUsd > 0) console.log(`  ${''.padEnd(24)}  ${''.padEnd(w)}  ${estimatedPartWords(r.totalEstimatedUsd, formatUsd).trim()} of that total`);   // 0.8.4 unit 6 (D11): the part of the counted total that is an estimate
    if (r.runs.some(x => !x.complete)) console.log(`\n  Runs still going or stopped short are counted from the stages they already paid for.`);
    // 0.8.3 M6 S5: one line per recursive-councils tree, a part of the total above (src/spend.js treeSubtotals), never added to it again
    for (const t of r.trees ?? []) console.log(`  tree ${t.treeId}: ${formatUsd(t.usd)} across ${t.memberRuns} run(s), already in the total${treeIsAbandoned(r.runsDir, t.treeId) ? '; abandoned' : ''}`);
  }
  if (r.unreadable) console.log(`  ${r.unreadable} run folder(s) could not be read and are not counted.`);
  if (r.symbolicLinksNotCounted) console.log(`  ${r.symbolicLinksNotCounted} symbolic link(s) in runs/ were not counted (a run folder is never a link).`);
  console.log(`\n  Derived from the run folders on disk. Nothing is recorded anywhere else, and nothing leaves this machine.`);
  process.exit(0);
}

// `council --cost-today [--date YYYY-MM-DD]` answers "what have I spent today", by the
// local calendar day rather than --spend's rolling 24h window, with a per-model breakdown
// across every run counted - the granularity v2 plan §8 wanted a ledger file for, derived
// instead from the same run-folder files --spend already reads (see maintainers/DECISIONS.md).
if (argv.includes('--cost-today')) {
  const dateArg = flag('date', null);
  const date = dateArg && dateArg !== true ? new Date(`${dateArg}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) {
    console.error('--date: expected YYYY-MM-DD');
    process.exit(2);
  }
  const r = costToday(join(work, 'runs'), { date });
  // r.date is local midnight; toISOString() converts to UTC and can print the wrong
  // calendar day in any non-UTC timezone, so format from local parts instead.
  const dayLabel = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}`;
  console.log(`\nSpend on ${dayLabel} across ${r.count} run(s)  (${join(work, 'runs')})`);
  if (!r.count) {
    console.log(`  no runs on this day.${r.note ? `  ${r.note}` : ''}`);
  } else {
    const w = Math.max(...r.runs.map(x => (x.chain || '?').length));
    for (const x of r.runs) {
      console.log(`  ${x.id}  ${(x.chain || '?').padEnd(w)}  ${formatUsd(x.usd).padStart(9)}  ${x.state}`);
    }
    console.log(`  ${''.padEnd(24)}  ${''.padEnd(w)}  ${formatUsd(r.totalUsd).padStart(9)}  total`);
    if (r.perModel.length) {
      console.log(`\n  By model:`);
      for (const m of r.perModel) console.log(`    ${m.model.padEnd(40)}  ${formatUsd(m.usd).padStart(9)}`);
    }
  }
  if (r.unreadable) console.log(`  ${r.unreadable} run folder(s) could not be read and are not counted.`);
  if (r.symbolicLinksNotCounted) console.log(`  ${r.symbolicLinksNotCounted} symbolic link(s) in runs/ were not counted (a run folder is never a link).`);
  console.log(`\n  Derived from the run folders on disk. Nothing is recorded anywhere else, and nothing leaves this machine.`);
  process.exit(0);
}

// `council --stats [--days N]` answers "how is the debate mechanism itself
// doing" - sign-off rate, rounds, objections, cost and the biggest prompt
// files - per chain and per lab, across every run on disk.
if (argv.includes('--stats')) {
  const days = Number(flag('days', 30));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const r = verdictStats(join(work, 'runs'), { days });
  console.log(`\nVerdict stats across ${r.runsSeen} run(s) since ${r.since.toISOString().slice(0, 16).replace('T', ' ')}  (${join(work, 'runs')})`);
  if (r.adviceRunsSkipped) console.log(`  (${r.adviceRunsSkipped} advice call(s) skipped: an advice call is not a sign-off)`);
  if (!r.chains.length) {
    console.log(`  no completed runs in this window.${r.note ? `  ${r.note}` : ''}`);
  } else {
    console.log(`\nBy chain:`);
    const w = Math.max(...r.chains.map(c => c.chain.length));
    for (const c of r.chains) {
      console.log(`  ${c.chain.padEnd(w)}  runs=${c.runs}  signoff=${c.signoffRate === null ? '-' : `${Math.round(c.signoffRate * 100)}%`}` +
        `  rounds=${c.meanRoundsToSignoff === null ? '-' : c.meanRoundsToSignoff.toFixed(1)}` +
        `  objections=${c.objections}  withdrawn=${c.withdrawals}  accepted=${c.accepted}` +
        `  dropouts=${c.dropouts}  unparseable=${c.unparseable}  shapeOnlyRounds=${c.shapeOnlyRounds}` +
        `  cost=${c.meanCostUsd === null ? '-' : formatUsd(c.meanCostUsd)}` +
        `  wall=${c.meanWallMs === null ? '-' : `${Math.round(c.meanWallMs / 1000)}s`}`);
    }
    console.log(`\nBy lab:`);
    for (const l of r.labs) {
      console.log(`  ${l.lab}: proposed=${l.proposed} accepted=${l.accepted} withdrawn=${l.withdrawn} cut=${l.cut} dropouts=${l.dropouts} unparseable=${l.unparseable}`);
    }
    console.log(`\nIndependence skew (novel-objection rate, solo-signoff rate - descriptive only, never auto-reweighted):`);
    for (const l of r.labs) {
      const novel = l.novelObjectionRate === null ? '-' : `${Math.round(l.novelObjectionRate * 100)}%`;
      const solo = l.soloSignoffRate === null ? '-' : `${Math.round(l.soloSignoffRate * 100)}%`;
      console.log(`  ${l.lab}: novelObjections=${novel} (${l.novelObjections}/${l.objections})  soloSignoff=${solo} (${l.soloSignoffs}/${l.signoffs})${l.lowIndependence ? '  [low independence]' : ''}`);
    }
    if (argv.includes('--csv')) {
      console.log(`\nIndependence skew CSV:`);
      console.log(independenceStatsCsv(r.labs));
    }
    if (r.largestPrompts.length) {
      console.log(`\nLargest prompt file per stage type:`);
      for (const p of r.largestPrompts.slice(0, 10)) {
        console.log(`  ${p.stageType}: ${p.file} (${p.run}) - ${(p.bytes / 1024).toFixed(1)}KB, ~${p.tokensApprox} tokens`);
      }
    }
  }
  if (r.unreadable) console.log(`\n  ${r.unreadable} run folder(s) could not be read and are not counted.`);
  if (r.symbolicLinksNotCounted) console.log(`\n  ${r.symbolicLinksNotCounted} symbolic link(s) in runs/ were not counted (a run folder is never a link).`);
  console.log(`\n  Derived from the run folders on disk. Nothing is recorded anywhere else, and nothing leaves this machine.`);
  process.exit(0);
}

// `council --metrics [--days N]` prints DESCRIPTIVE TELEMETRY ONLY: amendment
// rate, withdrawal rate, objection-follow-through rate and tool-call usage,
// derived from existing run logs on disk. This is not an evaluation, not a
// benchmark, and not a baseline - it is the zero-cost substitute for the
// evaluation-first direction the author declined to fund (see src/metrics.js
// header). Never read any number below as a claim that the council's output
// is better than any other tool's or person's - nothing here compares
// against anything outside this harness's own run history.
if (argv.includes('--metrics')) {
  const days = Number(flag('days', 30));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const r = metricsReport(join(work, 'runs'), { days });
  const pct = x => (x === null ? 'no data' : `${Math.round(x * 100)}%`);
  console.log(`\nDescriptive telemetry across ${r.runsSeen} run(s) since ${r.since.toISOString().slice(0, 16).replace('T', ' ')}  (${join(work, 'runs')})`);
  if (r.adviceRunsSkipped) console.log(`  (${r.adviceRunsSkipped} advice call(s) skipped: an advice call is not a plan)`);
  console.log(`  NOT an evaluation, benchmark or baseline - see "council --help" and README. Counts and rates only, no comparison to anything outside this harness's own run history.\n`);
  console.log(`  amendment rate:                ${pct(r.amendmentRate)}  (${r.counts.amended}/${r.counts.proposals} proposals)`);
  console.log(`  withdrawal rate:                ${pct(r.withdrawalRate)}  (${r.counts.withdrawn}/${r.counts.proposals} proposals)`);
  console.log(`  objection-follow-through rate:  ${pct(r.objectionFollowThroughRate)}  (${r.counts.objectedFollowedThrough}/${r.counts.objected} objected proposals later amended or withdrawn)`);
  console.log(`  tool-call usage:                ${pct(r.toolCallUsageRate)}  (${r.counts.acceptanceItemsNamingTool}/${r.counts.acceptanceItems} handoff acceptance items name a declared tool; ${r.counts.runsWithoutToolsSection} run(s) declared no "Available tools" section)`);
  // Pre-release audit, metrics #2: computed and README-documented, but never printed.
  console.log(`  consensus-induced regressions:  ${r.consensusInducedRegressionCount ?? 'no data'}${r.consensusInducedRegression?.excluded?.length ? `  (${r.consensusInducedRegression.excluded.length} case(s) excluded)` : ''}`);
  console.log(`  allocator rubber-stamp rate:    ${pct(r.allocatorRubberStampRate ?? null)}`);
  if (r.unreadable) console.log(`\n  ${r.unreadable} run folder(s) could not be read and are not counted.`);
  if (r.symbolicLinksNotCounted) console.log(`\n  ${r.symbolicLinksNotCounted} symbolic link(s) in runs/ were not counted (a run folder is never a link).`);
  console.log(`\n  Derived from the run folders on disk. Nothing is recorded anywhere else, and nothing leaves this machine.`);
  process.exit(0);
}

// `council --forecast-cost --chain <name>` (v5 §1 candidate 7): a
// realistic-case range from this chain's own history on this machine,
// repriced at today's pricing.json - distinct from `--dry-run`'s
// worst-case estimate from the chain's declared token assumptions.
if (argv.includes('--forecast-cost')) {
  let chainNameArg = flag('chain', null);
  if (chainNameArg === null) { console.error(defaultChainNotice()); chainNameArg = DEFAULT_CHAIN; }
  const days = Number(flag('days', 90));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const f = forecastCost(chainNameArg, join(work, 'runs'), { days });
  console.log(`\nCost forecast for chain "${f.chain}", from ${f.runsUsed} historical run(s) in the last ${f.days} day(s):`);
  if (f.low === null) {
    console.log(`  no estimate - ${f.note}. Try "council --chain ${f.chain} --dry-run" for an estimate with no history needed.`);
  } else {
    console.log(`  ${formatUsd(f.low)} - ${formatUsd(f.high)}  (mean ${formatUsd(f.mean)})`);
    console.log(`  This is a range from what this chain has actually cost before, repriced at today's rates - not a promise. A run outside this range is possible.`);
    if (f.partial) console.log(`  PARTIAL: ${f.note}`);
  }
  process.exit(0);
}

// `council --mcp` starts the MCP server instead of running a chain. The
// package ships one bin, so this is what makes a single npx invocation work
// as an MCP command: `npx -y the-high-council --mcp`. Checked before any
// other argument handling, since the server takes none of them.
if (argv.includes('--mcp')) {
  await runMcpServer();
} else {

// `--advice-meta` was removed in 0.8.1 (a sidecar a caller could write to claim an approval no person gave) and the advice add-on in 0.8.4; only the refusal stays.
if (argv.includes('--advice-meta')) {
  console.error('--advice-meta was removed in 0.8.1, and the advice add-on with it in 0.8.4. Nothing was run and nothing was spent.');
  process.exit(2);
}
const chainName = flag('chain', null);
const taskPath = flag('task', null);
const fromRun = flag('from-run', null);
const resumeRun = flag('resume', null);
// A flag that takes a path or a name but was given none comes back from flag() as `true`, which
// then reached resolve()/readFileSync as a boolean and threw a raw TypeError (bug audit 2026-09-23,
// CLI backlog). A usage error instead, before anything else runs.
for (const name of ['chain', 'task', 'from-run', 'resume', 'draft', 'context', 'tree-node']) {
  if (flag(name, null) === true) {
    console.error(`--${name}: needs a value, e.g. --${name} ${name === 'chain' ? 'plan-mini-council' : name === 'resume' || name === 'from-run' ? 'runs/<id>' : name === 'context' ? 'context/' : '<file>'}`);
    process.exit(2);
  }
}
const dryRun = argv.includes('--dry-run');

// MLLM Coder v4 item 4: who signed off on this change request, for policy.json's
// required_signoff_paths. A bare `--signoff` with no name is refused rather than read as "signed".
const signoffFlag = flag('signoff', undefined);
if (signoffFlag === true) {
  console.error('--signoff: needs a name, e.g. --signoff alice');
  process.exit(2);
}

// The ladder (Muad's order for a three-layer chain, src/ladder.js): `--ladder` on a start or a resume saves it in run.json; `--ladder-credit N` says the first N passes already ran under the plain rules and count as the first block
// (B2: its 7 layer-1 revisions). A-DRAFT (every sentence below).
const ladderFlag = argv.includes('--ladder');
const ladderCreditArg = flag('ladder-credit', null);
const ladderExchangeArg = flag('ladder-exchange', null);
// 0.8.4 S6 (Q2; C&C: REFUSE, not ignore): once the shortened exchange is in force (the pair W5 + W14 recorded) layers 2 and 3 have their own exchange round and a ladder-exchange count would mean something else, so the flag, with ANY value, is refused before any call; an accepted flag that did nothing would be the --dry incident class. While the pair is held the flag works as it always did.
if (ladderExchangeArg !== null && shortExchangeOn()) { console.error('--ladder-exchange is no longer used: layers 2 and 3 have their own exchange round. Leave the flag out. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT
if ((ladderCreditArg !== null || ladderExchangeArg !== null) && !ladderFlag) { console.error('--ladder-credit and --ladder-exchange go with --ladder. Nothing was run and nothing was spent.'); process.exit(2); }
if (ladderExchangeArg === true || (ladderExchangeArg !== null && !/^[0-7]$/.test(String(ladderExchangeArg)))) { console.error('--ladder-exchange: needs a number of exchange rounds from 0 to 7 for layers 2 and 3, e.g. --ladder-exchange 2. Nothing was run and nothing was spent.'); process.exit(2); }
if (ladderCreditArg === true || (ladderCreditArg !== null && !/^\d+$/.test(String(ladderCreditArg)))) { console.error('--ladder-credit: needs a whole number of passes, e.g. --ladder-credit 7. Nothing was run and nothing was spent.'); process.exit(2); }
const ladderTyped = ladderFlag ? { block: LADDER_BLOCK, visits: LADDER_VISITS, credit: ladderCreditArg === null ? 0 : Number(ladderCreditArg), exchange: ladderExchangeArg === null ? 0 : Number(ladderExchangeArg) } : null;

// v7.x item 2: PII/secrets pre-flight gate. Absent entirely (no --pii-gate flag) means this
// gate is never invoked at all - byte-identical to every prior release. `warn` logs and
// proceeds; `hard-stop` refuses the run before any provider call if it finds a match.
const piiGateMode = flag('pii-gate', null);
if (piiGateMode !== null && piiGateMode !== 'warn' && piiGateMode !== 'hard-stop') {
  console.error(`--pii-gate: expected "warn" or "hard-stop", got "${piiGateMode}"`);
  process.exit(2);
}
const piiAllow = flag('allow-pii', null);
const piiAllowList = piiAllow ? String(piiAllow).split(',').map(x => x.trim()).filter(Boolean) : [];

// The unfenced-artifact gate's two escapes (see the pre-flight block below).
// `--allow-unfenced` alone waives the whole gate for this run; given a value it
// waives only the named files, so the common case - one file that genuinely is
// just a location - does not disarm the check for everything else in the task.
const unfencedArg = flag('allow-unfenced', null);
const allowUnfenced = unfencedArg === true;
const unfencedAllowList = (unfencedArg && unfencedArg !== true)
  ? String(unfencedArg).split(',').map(x => x.trim()).filter(Boolean)
  : [];

// the usage entries are hand-wrapped at this column; a sentence built from the shared maps is wrapped to it (greedy, 52 characters)
const helpWrap = (text, indent = 39, width = 52) => { const lines = []; let cur = ''; for (const w of text.split(' ')) { if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; } if (cur) lines.push(cur); return lines.join(`\n${' '.repeat(indent)}`).replace(/^/, ' '.repeat(indent)); };
// A-DRAFT (pr2 fix, A1): the --approve-excerpts paragraph of the help below ends with a sentence on what a --resume with the switch waits on.
if (argv.includes('--help') || (!taskPath && !dryRun && !resumeRun)) {
  console.log(`The High Council - a chained multi-model harness

  council demo                         $0, offline, no keys needed: run a full
                                       mock chain (proposals, debate, sign-off)
                                       and print the deliverable and board
  council doctor                       which API keys you have (names only),
                                       which chains you can run with them, and
                                       each one's expected cost and upper estimate. No network call.
  council doctor --chain <file>        lint one chain file before any paid run
  council doctor --scan-artifacts      scan your tasks and chains for key formats
  council --task tasks/example.md --chain <name> [--rounds N]
                                       --chain takes a chain name, never a path; without it the
                                       default chain ${DEFAULT_CHAIN} is used. Recommended: ${PROMOTED_CHAINS.join(', ')}
                                       (what each needs and costs: the README, or \`council doctor\`)
                                       --rounds N sets the review rounds; on a chain that has overseer
                                       rounds (maxOverseerRounds) it counts OVERSEER rounds, not passes.
                                       On the ladder (the chain's "ladder" key, or --ladder) it counts
                                       top-layer reads: after the Nth read without agreement the run
                                       stops and asks you what next
${PERSONA_FORM_HELP_LINES.join('\n')}
  council --resume <run folder> --continue | --finish | --finish-now
${helpWrap(`answers a run that stopped ${roundStopsInWords()} (exit 23): --continue goes on (${CONTINUE_WORDS}; the run's spending limit still applies), --finish ends it here, NOT agreed (the dispute stage and the handoff run)`)}
${helpWrap(`--finish-now ends a stopped run at once: no judge is asked again (a final read already on disk for this text is kept; the dispute stage and the handoff run). Inside the review rounds and at a round stop the run ends NOT agreed (except at the stop where no seat of the top layer could read the final plan: a panel that had signed off before the read keeps that verdict there); at a spending stop or a credential-shaped pause after the review rounds it keeps the verdict the rounds reached`)}
${helpWrap(`--continue also answers a run paused at a credential-shaped string in a prompt (exit 11, STOPPED-secret.md): it sends that stage as it is and allows the value(s) found. --finish there records that the run is to end here, NOT agreed; the run stays paused, and nothing is sent, until --continue.`)}
${helpWrap(`--drop-excerpt answers a run paused at a credential-shaped string in an excerpt (the stop is named excerpt-E-<n>): the text is left out, recorded as withheld, shown to no seat, and the run goes on. At a terminal, like --continue.`)}
${helpWrap(`--approve-excerpts (a start or a --resume; "approve_excerpts": true in the chain does the same) asks for your approval before any seat is shown project text the handling session added: the run stops with exit 26, nothing run and nothing spent; at a terminal, \`council gate answer <run folder> <gate>\` lets you approve, edit or refuse each text, and the next --resume records your answers and goes on. Turned on at a --resume, the switch also waits for your approval on the texts recorded while it was off that no call on the run's record has sent to a seat; a text a seat may already have been shown stays as it is.`)}
  council --resume <run folder> [--skip-seat]
                                       a run that stopped because OpenRouter refused a seat at its price limit
                                       (exit 24) goes on after you add the model's price to pricing.user.json;
                                       --skip-seat instead drops that seat for the rest of the run, where its
                                       stage can do without it (the stop message says which)
  council --resume <run folder> --prevail n=<objection id>|neither[,...]
                                       answers a run that stopped because the conflict decider asked you
                                       to choose between objections (exit 25); "neither" keeps them all
  council fence --task tasks/x.md --repo <path> <file> [file...]
                                       append real files to the task, fenced, so the
                                       seats read the code instead of guessing it
  council --task tasks/x.md --allow-unfenced [a.js,b.ts]
                                       run although the task names files it does not
                                       include (all of them, or only those listed)
  council --task tasks/x.md --chain <name> --from-run runs/<earlier run>
                                       reuse that run's criteria and first draft,
                                       so two panels can be compared on one draft
  council --task tasks/x.md --chain <name> --from-run runs/<r> --draft file.md --rounds 1
                                       panel-only: grade this draft against that run's criteria
  council --task tasks/x.md --criteria criteria.md
                                       use these acceptance criteria instead of the
                                       criteria stage (one per line, or JSON with
                                       optional kind/check per criterion)
  council --task tasks/x.md --chain <name> --context context/my-project
                                       append standing direction docs to the request
                                       (each file 2 MB at most)
  council --resume runs/<r>            continue a run that paused at an external seat
                                       (after writing runs/<r>/<label>.md); completed
                                       stages replay from disk and cost nothing
  council --chain <name> --dry-run     estimate tokens and cost, call nothing
  council --chain <name> --dry-run --json
                                       the same as one JSON document, plus which
                                       seat lacks which API key
  council --spend [--days 7]           what every run has cost, across runs,
                                       read back off disk. Nothing is recorded
                                       and nothing leaves this machine.
  council --cost-today [--date Y-M-D]  what has been spent today, by calendar day,
                                       with a per-model breakdown. Same disk-only source.
  council --stats [--days 30]          how the debate mechanism itself is doing:
                                       sign-off rate, rounds, objections, dropouts,
                                       cost/wall time and the biggest prompt files,
                                       per chain and per lab. Same disk-only source.
  council --metrics [--days 30]        DESCRIPTIVE TELEMETRY ONLY - amendment rate,
                                       withdrawal rate, objection-follow-through rate
                                       and tool-call usage, from existing run logs.
                                       Not an evaluation, benchmark or baseline; no
                                       comparison to anything outside this harness's
                                       own run history. Same disk-only source.
  council --task tasks/x.md --pii-gate warn|hard-stop
                                       scan the task file for PII-shaped (email, checksum-
                                       valid IBAN, Luhn-valid card) and secret-shaped content
                                       before any provider call. Every run is checked: by default a
                                       finding STOPS the run (exit 11, nothing started or spent) and
                                       the stop names the way on, --allow-pii <types found>. warn
                                       prints and goes on; it is yours to set (this flag, your
                                       shell environment, the Desktop field), never a project .env.
                                       --allow-pii email,iban,card,secret suppresses named
                                       pattern classes (always printed, never a silent hole).
  council --task tasks/x.md --allow-secret-shaped
                                       send key-shaped text anyway. Every prompt is scanned
                                       for the key formats in src/secret-patterns.js before
                                       it leaves. A match before the run starts refuses it
                                       (exit 11); a match in a later prompt pauses the run
                                       (exit 11, STOPPED-secret.md), with the file or stage,
                                       line and format, never the value. On a resume of a
                                       paused run the flag means --continue. Key shapes only:
                                       a password in prose is not caught.
  council --task tasks/x.md --signoff alice
                                       name who signed off on this change request, for
                                       policy.json's required_signoff_paths. The task
                                       file's own "signoff:" line is used when the flag
                                       is absent; its "target_file:" line is the path checked.
  council --task tasks/x.md --max-usd 2 a paid chain asks you to type its
                                       limit and suggests $2; the run stops
                                       before any call that, by THC's estimate,
                                       would take it
                                       past that. A chain with no paid seat
                                       has no screen: $2 is its ceiling
                                       (default $${DEFAULT_MAX_USD}, or MAX_USD_PER_RUN;
                                       --max-usd none disables it).
                                       A stopped run resumes with
                                       --resume and a higher total; stages
                                       already on disk replay for free.

  council init                         a first chain and task you own, plus one
                                       offline demo run to look at
  council export-board --run runs/<r> [--out board.html]
                                       a finished run's board as one HTML file
  council --rematch runs/<r>           the same task again with the panel reshuffled,
                                       and a verdict diff against the original
  council --replay runs/<r>            the same task and chain again today, with a diff
  council replay --run runs/<r> [--json]
                                       a finished run as a numbered transcript
  council handoff --from-run runs/<r> [--chain <name>] [--max-usd N]
                                       a HANDOFF.md for a run that stopped before it wrote
                                       one, from its latest draft (one call, under the
                                       run's own limit; --max-usd is a total)
  council lint-criteria --criteria <file> | --run runs/<r>
                                       $0 word-level lints over acceptance criteria
                                       (the ones every run logs before its first paid round)
  council refresh-zdr-list             fetches OpenRouter's list of zero-retention hosts again (a public
                                       request, $0, nothing of your project is sent) and keeps what this
                                       version shipped with, in zdr-hosts.user.json
  council check-lock HANDOFF.md [--run runs/<r>]
                                       does this HANDOFF still carry the criteria the
                                       run locked into it? ($0; alias verify-handoff)
  council contract check runs/<r> [--handoff HANDOFF.md]
                                       does this run folder (and a HANDOFF copy you hold) still match
                                       its thin contract (task, criteria, evidence, signed text), and
                                       its contract record if it has one? ($0)
  council contract lock runs/<r> [--draft <file>]
                                       show the exact obligations to a person, and on approval write
                                       contract/v1.json + CONTRACT.md (needs a terminal, or answer the
                                       gate with council gate answer, then run it again)
  council contract draft --from-run runs/<r> [--chain <name>] [--max-usd N|none]
                                       one call on the run's handoff seat drafts the obligations
                                       (contract/draft.json); a person reads it before council contract lock
  council contract show runs/<r> [--md]
                                       the current contract version, its obligations and requests ($0)
  council contract amend --decide runs/<r> [request] [--decline]
                                       a person's decision on an amendment request: the exact current
                                       and proposed words, then approve (a new version) or decline
  council accept runs/<r> --reason "<why>"
                                       accept the plan of a run that ended without agreement, as it
                                       stands (needs a terminal; agrees with no judge, changes no
                                       objection; HANDOFF.md gets one line and its Status back; $0)
  council gate show runs/<r> [gate]    a run's gates, or one gate's whole text
  council gate answer runs/<r> <gate> [--decline]
                                       show the exact text, then approve or decline
                                       it (needs a person at a terminal)
  council gate verify runs/<r>         does the run's gate ledger still chain? ($0)
  council --forecast-cost --chain <name> [--days N]
                                       a realistic cost range from this chain's own
                                       past runs on this machine
  council --mcp                        run as an MCP server (stdio)
  council --version                    print the version

Chains live in chains/*.json. Runs are written to runs/<timestamp>/.
Only 'council' is installed as a command. A leading 'council' or 'relay' (the pre-rename
name) in the arguments is accepted and ignored, so older scripts keep working.`);
  // Asking for --help is success (exit 0) even with no task given; landing
  // here with neither --help nor a task/dry-run/resume is the error case
  // (exit 1) - these used to be conflated into one `taskPath ? 0 : 1`, which
  // made a bare `--help` exit 1.
  process.exit(argv.includes('--help') ? 0 : 1);
}

// --resume: everything about the run comes from its own run.json.
let resumeMeta = null;
if (resumeRun) {
  // CLI audit #2: a --rematch/--replay folder is not a resumable run. --resume re-ran it with the
  // un-reshuffled chain, paid in full and wrote a report that looked like a finished rematch; a
  // replay folder has no run.json and crashed. Both are refused, as is a folder with no run.json.
  const resumeDir = resolve(resumeRun);
  if (SIDE_RUN_FOLDER.test(basename(resumeDir))) {
    console.error(`--resume: ${basename(resumeDir)} is a --rematch/--replay folder, which cannot be resumed. Run the --rematch or --replay again instead (with a higher --max-usd if the cap stopped it).`);
    process.exit(2);
  }
  try { resumeMeta = JSON.parse(readFileSync(join(resumeDir, 'run.json'), 'utf8')); } catch (e) {
    console.error(`--resume: ${resumeDir} has no readable run.json (${e.code || e.message}) - it is not a run folder this CLI can resume.`);
    process.exit(2);
  }
  if (resumeMeta.rematchOf) {
    console.error(`--resume: ${basename(resumeDir)} is a --rematch of ${resumeMeta.rematchOf}, which cannot be resumed. Run the --rematch again instead.`);
    process.exit(2);
  }
}
// Unit 3b (C&C, 1 Nov 2026): a resume takes the class of its RUN FOLDER, never of the --resume flag (B3 resumes after every external seat and every pause). A tree
// member's run (run.json's lineage) is a tree: with the switch on, the tree sentence and exit 19 (src/tree-run.js reads it as tree_refused) before anything else of
// the member runs; its dry run gets the note and goes on (Q1b).
let capsResumeClass = null;
if (capsOn.length && resumeMeta?.tree) {
  capsResumeClass = capsResumeClassOf({ tree: resumeMeta.tree });
  if (dryRun) (argv.includes('--json') ? console.error : console.log)(capsDryRunNote(capsResumeClass, capsOn));
  else { console.error(capsClassRefusalSentence(capsResumeClass, capsOn)); process.exit(capsResumeClass.exit); }
}
// A resume prices with the project's rows of the folder the run was made in (the same rule the policy file follows); the file is read once per process, so a row edited during a sitting counts from the next one.
if (resumeMeta?.cwd && resolve(resumeMeta.cwd) !== resolve(work)) loadUserPrices(resumeMeta.cwd);
refuseOnUserPriceProblem();
// 0.8.3 E5c: no --chain (and no run.json supplying one) = the default chain, announced on stderr first.
const chainNameEff = resumeMeta?.chain || chainName || (console.error(defaultChainNotice()), DEFAULT_CHAIN);
// A chain is named, never a path (src/chain-name.js): the name is joined onto chains/ below.
{ const bad = chainNameRefusal(chainNameEff, resumeMeta ? '--resume: the chain recorded in run.json' : '--chain'); if (bad) { console.error(bad); process.exit(2); } }
// A user's own chains/ takes precedence, so a custom chain works from an
// npm install without editing anything inside node_modules.
// On resume the run's own start directory comes first (CLI audit #3's class): a custom chain lives in
// the chains/ of the directory the run was started in, not wherever the resume is typed.
// A run folder an advice call left (the add-on was removed in 0.8.4) is never resumed, whatever ended it: refused on the folder's own evidence (src/stop-files.js isAdviceFolder),
// BEFORE any chain is looked up, so no chain of the same name in a project's chains/ can run its brief with no gate (the 0.8.1 M5 review D1 reason).
if (resumeRun && isAdviceFolder(resolve(resumeRun))) {
  console.error(`--resume: ${basename(resolve(resumeRun))} is an advice call, which is not continued, whatever ended it. Nothing was sent and nothing was spent.`);
  process.exit(2);
}
const configPath = [resumeMeta?.cwd ? join(resumeMeta.cwd, 'chains', `${chainNameEff}.json`) : null, join(work, 'chains', `${chainNameEff}.json`), join(pkg, 'chains', `${chainNameEff}.json`)]
    .filter(Boolean).find(existsSync) || join(pkg, 'chains', `${chainNameEff}.json`);
if (!existsSync(configPath)) {
  // Bug audit 2026-09-28 (area 4 LOW-4): name every folder searched, not just the package's.
  const searched = [...new Set([resumeMeta?.cwd ? join(resumeMeta.cwd, 'chains') : null, join(work, 'chains'), join(pkg, 'chains')].filter(Boolean))];
  console.error(`No such chain: "${chainNameEff}" - looked for ${chainNameEff}.json in ${searched.join(' and ')}.${outdatedChainHint(chainNameEff)}`);
  process.exit(1);
}
// v5 §1 candidate 4, COUNCIL-E003: a malformed chain file is a fatal,
// stranger-facing condition - caught here rather than left to an
// uncaught SyntaxError. Handled inline (not left to the later try/catch
// around the run itself, which starts well after this point) so the
// tone-shaped message prints even though nothing has been invoked yet.
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  console.error(`\n${formatCouncilError('COUNCIL-E003', { path: configPath })}`);
  process.exit(EXIT_FATAL);
}
// 0.8.4: the advice add-on is removed, so a chain file that still carries an `advise` block cannot run: refused here, before anything is read further, sent or spent (it would otherwise run as a plain paid panel).
if (config && typeof config === 'object' && config.advise !== undefined) {
  console.error(`Chain "${chainNameEff}" has an "advise" block: the advice add-on was removed in 0.8.4, so this chain cannot run. Remove the block, or use a planning chain. Nothing was sent and nothing was spent.`);
  process.exit(2);
}
// 0.8.4 the persona form for ONE run (src/persona-form.js): `--persona-form title|voice` overlays the chain's seat_personas.form before anything reads it (the lint just below, the pre-flight list, the estimate, the prompts, the report). It is saved in run.json
// (`persona_form`) only when typed at a START; a resume keeps the saved form, accepts the same form and refuses the other one before anything is sent; a chain that does not switch seat_personas on refuses it (nothing here turns the switch on). The decision is made here, before the lint, so
// the lint's own refusals hold under the chosen form.
const personaFormDecision = decidePersonaForm(config, { typed: flag('persona-form', undefined), saved: resumeMeta?.persona_form, resumed: !!resumeMeta });
if (personaFormDecision.refusal) { console.error(personaFormDecision.refusal); process.exit(2); }
config = personaFormDecision.config;
// A positive whole number or nothing. Bug-audit fix, 2026-09-23 (GuardLayer backlog): `--rounds
// abc` became NaN, so zero review rounds ran and the run exited 0 with an unreviewed deliverable;
// `--rounds 1.5` paid for a revision no round ever graded; `--rounds 0` reviewed nothing.
/** The line a --rounds N typed (or relayed) at a resume prints when the run keeps the rounds it started with (LAD-R4). */
function roundsNotUsedLine(n, saved) { return `--rounds ${n} was not used: this run started with ${saved} review round${saved === 1 ? '' : 's'} and keeps ${saved === 1 ? 'it' : 'them'}. Start a new run to use ${n}.`; }
/** A --rounds N the person typed, or the session relayed with a continue (src/gate.js rounds): on a ladder run (the flag, a ladder the run saved, or the chain's ladder key) it is the run's own limit of top-layer reads; otherwise it sets the chain's rounds, which a resume then keeps as the run began (the line above says so). ONE branch for both. */
function applyTypedRounds(n) { if (ladderFlag || !!resumeMeta?.ladder || !!roundLimitsOf(config).ladder) ladderRoundsTyped = n; else { setRounds(config, n); roundsTypedOffLadder = n; } }
/** Who a choice at a stop is attributed to (0.8.4): the typed command line (actor unknown, channel cli), or, when `--stop-gate <id>` names the session's answered stop_decision gate for exactly this stop and this choice (and its number, if any, is the --rounds on the command line), that gate's record. A refusal exits 2 with nothing recorded. ONE function for every stop that takes a choice. */
function attributeChoice(id, choice) {
  const named = flag('stop-gate', null);
  if (named === null) return cliChoiceFields(new Date().toISOString());
  const a = typeof named === 'string' ? stopDecisionAnswerOf(runDir, id, choice, { gate: named }) : null;
  const typedNumber = ladderRoundsTyped ?? roundsTypedOffLadder;   // a --rounds on the command line, on or off the ladder
  if (!a || (typedNumber !== null && typedNumber !== (a.rounds ?? null))) { console.error(`--stop-gate ${typeof named === 'string' ? named.slice(0, 40) : ''}: no answered stop_decision gate of this run by that name matches this stop (${id}), this choice (${choice})${typedNumber !== null ? ' and the --rounds number' : ''}, within ten minutes of its answer. Nothing was recorded, run or spent.`); process.exit(2); }
  // typed = relayed (C&C 10 Nov): the gate's number takes the SAME branch a typed --rounds N takes at any stop (applyTypedRounds): the saved limit and the next stop are the same; off the ladder the run prints the same line (below, with the typed one's)
  stopGateNamed = named;
  if (a.rounds !== undefined) applyTypedRounds(a.rounds);
  return entryFieldsOf(a);
}
let ownerPauseFinishPass = null;   // the pass the pause stopped before (the partial report's stop), written on the pause_finished line
let ownerPauseFinishing = null;   // 'finish' | 'finish_now' when the person's finish at the owner's pause is being recorded by this command: its request is settled as pause_finished, never as taken or lapsed
let stopGateNamed = null;   // the answered stop_decision gate this command line names (--stop-gate), once the choice is attributed to it
let ladderRoundsTyped = null; let roundsTypedOffLadder = null;   // a typed --rounds N on a LADDER run (see below); null otherwise
/** 0.8.4 (the --rounds fix-up; C&C ruling 11 Nov 2026): the number of top-layer reads this ladder run is bound by, for every figure that prices it (the dry run, the limit screen, the policy gate, the notes at the start): the number typed on this command line (the run's own bound, `ladderRoundsTyped`), else a resumed run's saved `ladderRounds` plus its recorded continues, else null. `choices` = the round choices to add up: a call before `roundChoices` exists (the policy gate, the dry run) passes none and reads the saved record; a later call passes `roundChoices`, so a continue typed in this sitting counts. A missing `add` is filled as the run itself fills it (defaultAdd). Never reads a `let` that is not yet set. */
function ladderTypedReads(choices = resumeMeta?.roundChoices) { return ladderBoundOf({ typed: ladderRoundsTyped, saved: resumeMeta?.ladderRounds ?? null, choices: (Array.isArray(choices) ? choices : []).map(c => (c?.choice === 'continue' && !Number.isInteger(c.add) ? { ...c, add: defaultAdd(c, config) } : c)) }); }
{
  const roundsArg = flag('rounds', null);
  if (roundsArg !== null) {
    const n = Number(roundsArg);
    if (roundsArg === true || !Number.isInteger(n) || n < 1) {
      console.error(`--rounds: expected a whole number of review rounds, 1 or more, got ${roundsArg === true ? 'no value' : `"${roundsArg}"`}`);
      process.exit(2);
    }
    // On a layered chain with overseer rounds `--rounds N` sets THEM (the number a person reads as "rounds": run.json `rounds` beside maxOverseerRounds). A LADDER run (the chain file carries the ladder key, or --ladder is typed, or the run being resumed saved one) has no overseer-round
    // count of the chain's: the number the person types is his own bound, N overseer rounds (layer-3 verdicts), kept as the meaning it has everywhere else, and the existing overseer_cap stop asks at it (a continue adds one). It is saved in run.json as `ladderRounds` at a fresh start; a number typed at a resume replaces it from there on (it is flushed with the other typed settings).
    applyTypedRounds(n);
  }
}

// v5 §1 candidate 5: fail loud, before a single metered call, on a chain
// config that is broken rather than merely risky - distinct from
// preflightCheck's warn-never-block posture below, which is about task
// text, not chain config validity. Also run on --resume (bug audit 2026-09-23,
// RunChainStages #5 / GuardLayer #8): it used to be skipped there on the grounds that the first
// sitting proved the config runnable - but the chain file is re-read on resume and may have been
// edited in between, and a resumed run pays for everything after the pause.
exitOnLint(config, configPath);


// --from-run: the earlier run's criteria and first draft are reused verbatim,
// so whatever differs in the outcome is the panel, not a fresh coin toss.
let handedDraft = null;
// The earlier run's criteria. A run that crashed has no report.json but does have criteria.md -
// the criteria stage's raw reply - so the criteria can still be reused. One function for the
// fresh start and the resume: the resume copy used to skip the criteria.md fallback, so a
// --from-run of a crashed run regenerated its criteria on resume, changed the cache
// fingerprint and re-paid every stage (2026-09-23 audit, MoneyPath #6).
function criteriaOfRun(dir) {
  // Bug audit 2026-09-28 (area 4 LOW-1): a missing or corrupt earlier run crashed with a raw stack.
  if (!existsSync(dir)) { console.error(`--from-run: no such run folder: ${dir}`); process.exit(2); }
  const reportPath = join(dir, 'report.json');
  if (existsSync(reportPath)) {
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch {
      console.error(`--from-run: ${reportPath} is not valid JSON - can't reuse that run's criteria.`);
      process.exit(2);
    }
    // Bug audit 2026-09-28 (area 3 #2.2): the plain strings dropped every criterion kind, so a
    // --from-run of a finished kinds run lost its checkable criteria and "MET with no evidence".
    // criteria_kinds is index-aligned with criteria and is a shape normaliseCriteria reads back.
    const kinds = report.criteria_kinds;
    return Array.isArray(kinds) && Array.isArray(report.criteria) && kinds.length === report.criteria.length ? kinds : report.criteria;
  }
  // Resume-cache audit #2 (Review/PreRelease_Audit_ResumeCache_2026-09-23.md): an unfinished run's
  // criteria.md may be the answer a guard REJECTED - the accepted list is the last retry that ran
  // (chain.js runs the feasibility retry, then the meta retry). Taking criteria.md reused rejected
  // criteria and repeated the Zofia three-paid-rounds incident. runChain() also re-checks both
  // guards on criteria handed in this way.
  const label = ['criteria-retry', 'criteria-feasibility-retry', 'criteria'].find(l => existsSync(join(dir, `${l}.md`))) || 'criteria';
  if (!existsSync(join(dir, `${label}.md`))) { console.error(`--from-run: ${dir} has neither report.json nor criteria.md - nothing to reuse.`); process.exit(2); }
  const raw = readFileSync(join(dir, `${label}.md`), 'utf8');
  try { return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).criteria; } catch {
    console.error(`--from-run: ${join(dir, `${label}.md`)} holds no readable criteria.`);
    process.exit(2);
  }
}
// The earlier run's FIRST draft (documented: `--from-run` reuses its criteria and first draft), or a clean exit 2 (area 4 LOW-1). The build stage's adopted attempt: `build-retry.md` when the first try was cut off or refused
// and the retry worked (src/handoff-from-run.js pickBuildDraft); a pick that passed something over says so on the console.
function firstDraftOfRun(dir, what) {
  const pick = pickBuildDraft(dir);
  if (!pick) {
    if (!existsSync(join(dir, 'build.md')) && !existsSync(join(dir, 'build-retry.md'))) { console.error(`${what}: no such file: ${join(dir, 'build.md')}`); process.exit(2); }
    console.error(`${what}: ${dir} holds no first draft that can be read and is not empty (build.md, build-retry.md)`); process.exit(2);
  }
  // every build attempt failed: the flag exists so two panels can be compared on one FINISHED draft (a handoff gets a banner in HANDOFF.md; this path has no such file), so it refuses before anything is spent
  if (pick.failed) {
    console.error(`${what}: ${dir} holds no finished first draft: ${pick.failures.map(f => `\`${f.name}\` ${f.why}`).join('; ')}. No call was made. Use --from-run on a run that finished a draft, or start a fresh run without it.`);
    process.exit(2);
  }
  for (const l of pickNoteLines(pick)) console.error(`${what}: ${l}`);
  { const nl = pickNotesLine(pick); if (nl) console.error(`${what}: ${nl}`); }
  return pick.text;
}
// An input file, or a clean exit 2 (area 4 LOW-1).
function readRequired(path, what) {
  if (!existsSync(path)) { console.error(`${what}: no such file: ${path}`); process.exit(2); }
  return readFileSync(path, 'utf8');
}
if (fromRun) {
  config.criteria = criteriaOfRun(resolve(fromRun));
  handedDraft = firstDraftOfRun(resolve(fromRun), '--from-run'); // the run's FIRST draft (build-retry.md over build.md; FX-15: a builder's DECLINED lines are not part of it)
}
// --draft <file>: review this exact text instead of building one. With
// --from-run it replaces that run's build.md; the criteria still come from
// the run. With --rounds 1 this is a panel-only pass: no builder, no reviser.
// CLI audit #3 / resume-cache #5: a relative path is resolved against the directory the run was
// started in (run.json's cwd), like the task - never against wherever the resume is typed, which
// crashed, or silently read a different file of the same name. run.json now stores it absolute.
const startDir = resumeMeta ? (resumeMeta.cwd || work) : work;
const draftPathRaw = resumeMeta ? resumeMeta.draft : flag('draft', null);
const draftPath = draftPathRaw && draftPathRaw !== true ? resolve(startDir, draftPathRaw) : draftPathRaw;
if (draftPath === true) { console.error('--draft: needs a file path, e.g. --draft plan.md'); process.exit(2); }
if (draftPath) handedDraft = readRequired(draftPath, '--draft');
// The earlier run's folder, as recorded: absolute for runs started since 2026-09-23, else
// relative to the directory the run was started in (run.json's cwd) - the same rule as the task.
const fromRunDirOnResume = resumeMeta?.fromRun ? resolve(resumeMeta.cwd || work, resumeMeta.fromRun) : null;
if (resumeMeta?.fromRun && !fromRun) {
  config.criteria = criteriaOfRun(fromRunDirOnResume);
  // Bug-audit fix, 2026-09-16: this branch restored the original run's criteria but never its
  // handed draft. A run started with `--from-run <X>` and NO separate `--draft` (the normal case
  // - `--from-run` alone already hands the earlier run's own build.md as the draft to review,
  // per this file's own comment above at handedDraft's first assignment) has `resumeMeta.draft`
  // as null, so line 991's `if (draftPath) handedDraft = ...` never fires on resume - the panel
  // then reviewed nothing-handed, i.e. built a brand-new draft from scratch, defeating
  // `--from-run`'s whole purpose for any run paused on an external seat. Restore it the same way
  // the original (non-resumed) `--from-run` branch above does, but only when no explicit
  // `--draft` is already set (never override draftPath's own value with fromRun's build.md).
  if (!draftPath) {
    handedDraft = firstDraftOfRun(fromRunDirOnResume, '--from-run');
  }
}

// --criteria <file>: hand-written acceptance criteria, used instead of the criteria stage. JSON (an
// array, or { "criteria": [...] }, items plain strings or { criterion, kind, check, on } objects) or
// text/markdown with one criterion per line. It is the same slot a chain's own "criteria" list and
// --from-run fill, so runChain's criteria guards hold on it too. Resolved like --draft, and recorded
// in run.json so a resume reads the same file rather than regenerating criteria.
const criteriaPathRaw = resumeMeta ? resumeMeta.criteriaFile : flag('criteria', null);
if (criteriaPathRaw === true) { console.error('--criteria: needs a file path, e.g. --criteria criteria.md'); process.exit(2); }
const criteriaPath = criteriaPathRaw ? resolve(startDir, criteriaPathRaw) : null;
if (criteriaPath) {
  if (fromRun || resumeMeta?.fromRun) { console.error('--criteria: cannot be combined with --from-run, which already supplies that run\'s criteria.'); process.exit(2); }
  try {
    config.criteria = parseCriteriaFile(readFileSync(criteriaPath, 'utf8'), `--criteria ${criteriaPathRaw}`);
  } catch (e) {
    console.error(e.code === 'ENOENT' ? `--criteria: no such file: ${criteriaPath}` : e.message);
    process.exit(2);
  }
}

// 7.x single-vendor mode: resolved once, before checkSeats and --dry-run both read config.seats,
// so a missing-key check and the resolution printout (the existing --dry-run output, which
// already lists each seat's provider/model) both see the real vendor routing rather than the
// direct-lab config on disk. A no-op for any chain that never sets `transport`.
// The chain as its file says, before transport rerouting: what the MCP server priced and showed in the gate (it does not resolve).
const configAsWritten = config;
// 0.8.4 the Claude route (src/resolve-run.js): the Claude seats go straight to Anthropic, through OpenRouter, or to the person's own Claude Code sessions. `--claude-route auto|anthropic|openrouter|session`, else COUNCIL_CLAUDE_ROUTE (operator-only: a project .env cannot set it), else auto.
// A bad value (anything that is not a route) refuses the start on ANY chain, the dry run included, as a bad COUNCIL_PII_GATE does; a malformed key never routes silently. A resume decides afresh from what only the person controls and is
// never moved by run.json: when an auto decision differs from the route the run began with, it stops before any paid call (resolve-run.js step 4). The one record it does obey: a run that began as a SESSION run stays one when no route is typed (a run keeps its seats; it can only move toward no API spend), and goes to the API only when the person types a route (resolve-run.js step 1b).
const claudeRouting = routeRun(config, { meta: resumeMeta, dry: dryRun });
config = claudeRouting.config;
if (claudeRouting.route !== 'anthropic') exitOnLint(config, configPath);      // the lint above read the chain as written; through OpenRouter, or answered by sessions, the roster is another one (prices, hosts), so it is read again as it will be sent, before anything is paid
const claudeRoute = claudeRouting.route;      // 'anthropic' | 'openrouter' | 'session'; the route a new run records, and what the start log and the dry run say
const zeroRet = zeroRetentionRun(config, { meta: resumeMeta, dry: dryRun });      // 0.8.4 the optional zero-retention setting, decided on the roster as the route sends it
// 0.8.4 D10 (plan A T5.5): does this invocation ask for the privacy switch (`--approve-excerpts`, or the chain's `approve_excerpts: true`)? Read once here, for a start and a resume alike. The switch itself is recorded in
// the gate ledger by the gate module (a later part of D10); this is only the ask, and it has no way to ask for "off".
const excerptSwitchAsked = excerptSwitchRequest({ flag: argv.includes('--approve-excerpts'), config });
// Every seat the run can call - including judge, challenger, coldRead, claims, ambiguity,
// descending, preflight and the default security reviewer, which a hand-kept list here missed
// (bug audit 2026-09-23, GuardLayer #2). policy.json and the missing-key check both read it.
const allSeats = everySeatOf(config);

// MLLM Coder v5 item 5: the checks the policy configured, for report.json's `policy` block. Set
// only when a policy was in force; recorded in run.json below because the gate is skipped on
// --resume, so a resumed run can only report what its first round actually enforced. That is a
// fact about a moment (the policy file may change later), which is why it is persisted rather
// than re-derived.
let policyChecks = null;
let policyWarnings = [];

// v7.x item 1, COUNCIL-E005: the central policy file. No file at the locked path (work/
// policy.json) = today's behavior, byte-identical - this is the very first thing checked, and
// it changes nothing when absent. Skipped on --resume for the same reason lintChain is skipped
// above: the chain already proved runnable against this same policy on its first round. Runs
// before checkSeats/dryRun so a policy violation is caught before either a missing-key check or
// a price estimate - no provider is ever invoked either way, so ordering relative to those two
// doesn't change what gets spent, only what gets reported first.
// Pre-release audit 2026-09-23 (GuardLayer #4): this used to be skipped on --resume, while the
// chain itself is re-read on every sitting - so a seat added during a pause (e.g. a provider the
// policy forbids) was called on resume. The policy is evaluated on EVERY sitting now; a resume
// evaluates it against the run's own working directory.
{
  // src/run-preflight.js (the same gate `council tree start` asks before it writes a tree's record)
  const gate = policyGate({ config, allSeats, work, typedReads: ladderTypedReads(), policyCwd: resumeMeta?.cwd || work, signoffFlag: signoffFlag || (typeof resumeMeta?.signoff === 'string' && resumeMeta.signoff.trim() !== '' ? resumeMeta.signoff : undefined),   // C-025 part 2: a newly typed sign-off, else the one saved in run.json at the start, else the task file's `signoff:` line. run.json is project-writable text (owner choice A: trust it after strict checks): the saved value counts only as a non-empty string, the shape --signoff accepts; anything else is ignored, so it can neither pass a policy nor shadow the task file's own line
    // MLLM Coder v4 item 4: the change request's target_file and the operator's signoff, so required_signoff_paths can fire end to end. The task file is read here rather than at its
    // normal spot further down because the policy gate runs first.
    // Bug audit 2026-10-24 C-025 part 1: on a plain `--resume` (every MCP resume_run) `--task` is absent, so the task text was '' and `required_signoff_paths` found no target_file and passed: a resume skipped the sign-off check a start would have refused (exit 12). A resume reads the task file the run recorded
    // (the same rule as taskFile below).
    taskText: () => {
      const f = taskPath ? resolve(work, taskPath) : resumeMeta?.task ? (isAbsolute(resumeMeta.task) ? resumeMeta.task : resolve(resumeMeta.cwd || work, resumeMeta.task)) : null;
      return f && existsSync(f) ? readFileSync(f, 'utf8') : '';
    } });
  if (gate.parseError) {
    console.error(policyRefusalText(gate, { work }));
    process.exit(EXIT_FATAL);
  }
  if (gate.policy !== null) {
    policyChecks = gate.checks;
    policyWarnings = gate.warnings; // 0.8.2 item 8c: the maximum over max_usd_per_run warns (printed in the dry run and at the start, and written to WARNINGS.md); it never refuses
    if (!gate.ok) {
      console.error(policyRefusalText(gate, { work, chainName: config.name }));
      process.exit(EXIT_POLICY_REFUSED);
    }
  }
}

// Unit 3b: the start refusals, computed once and read three times (the JSON dry run, the text dry run, the real start below the unpriced refusal). A refused class
// that reaches this line (a member line's dry run; a resumed member's or advice folder's dry run) is reported first, then the chain's own (src/uncovered.js).
const capsClass = capsOn.length ? (capsRefusedClassOf(argv) ?? capsResumeClass) : null;
// Unit 4b2: the main limit as the refusals read it (an unreadable one is refused when a cap is in force), and a run-wide figure set under the switch (Q1, refused last):
// the flag, else MAX_USD_PER_RUN where it was set (a blank value or a host placeholder is unset with the switch on: perRunIsSet).
const capsLimitRead = capsOn.length ? readUsdCeiling() : null;
const capsRunWide = !capsOn.length ? null : argv.includes('--max-usd') ? 'flag' : perRunIsSet(process.env.MAX_USD_PER_RUN) ? (perRunIsSet(PER_RUN_AS_GIVEN) ? 'environment' : 'project-env') : null;
const capsChainRefusals = capsStartRefusals(config, capsOn, { limitUsd: capsLimitRead?.usd ?? null, limitUnreadable: capsLimitRead?.unreadable ?? null, runWide: capsRunWide });
const startRefusals = [...(capsClass ? [capsClassRefusalEntry(capsClass, capsOn)] : []), ...capsChainRefusals, ...(zeroRet.refusal ? [{ code: 'zero_retention_refused', exit: EXIT_DEGRADABLE, sentence: zeroRet.refusal }] : [])];
if (dryRun) refuseStray();   // T1-1: a dry run prints after the policy gate and has no refusal of its own below (the removed flags, the gate are above); a real run is checked at its folder, below
if (dryRun && argv.includes('--json')) {
  // The same dry run as one JSON document on stdout (src/dry-run.js), plus which seat lacks which
  // key. Nothing else is printed, so a caller can parse the whole output.
  const taskFileForDry = taskPath ? resolve(work, taskPath) : null;
  const taskChars = taskFileForDry && existsSync(taskFileForDry) ? readFileSync(taskFileForDry, 'utf8').length : null;
  console.log(JSON.stringify({ ...dryRunReport(config, {
    fromRun, taskChars, defaultCapUsd: maxUsd ?? null, typedReads: ladderTypedReads(),
    history: forecastCost(config.name, join(work, 'runs')),
  }), ...(policyWarnings.length ? { policyWarnings } : {}), ...(startRefusals.length ? { startRefusals } : {}), ...(zeroRet.on ? { zeroRetention: { on: true, asOf: zeroRet.asOf, source: zeroRet.source, covered: zeroRet.covered, notCovered: zeroRet.notCovered, lines: zeroRetentionLines(zeroRet), ...(zeroRet.stops.length ? { stops: zeroRet.stops } : {}) } } : {}), ...(claudeRoute !== 'anthropic' || ['key_state', 'recorded'].includes(claudeRouting.why) ? { claudeRoute: { route: claudeRoute, why: claudeRouting.why, seats: claudeRouting.routed.length, lines: [...routeLines(claudeRouting), ...sessionStopsLines(claudeRouting, config, { draft: Boolean(draftPath) }), ...resumeStopLines(claudeRouting), ...skippedRoomLines(routedSeatsWithoutWindow(everySeatOf(config)))] } } : {}) }, null, 2));
  process.exit(0);
}

// A bad COUNCIL_PII_GATE refuses a dry run too (C&C ruling 18 Okt 2026, fix-up 4): the dry run is how people check before spending, and a typo ignored there is the silent ignore the setting's ruling rules out. A tree member never reads the setting, and a member
// is known by --tree-node (its lineage file) or, on a resume, by the lineage saved in run.json (resumeMeta.tree, read above this point); a member does not run a dry run today, so this is a precaution, and the check stays behind that exemption.
if (dryRun && flag('tree-node', null) === null && !resumeMeta?.tree) { const s = piiModeSetting(process.env); if (s.refusal) { console.error(s.refusal); process.exit(2); } }
if (dryRun) {
  // A dry run prices the chain from the config's own declared token
  // assumptions. It calls nothing, so it costs nothing.
  console.log(`\nChain: ${config.name} - ${config.description}`);
  console.log((roundLimitsOf(config).overseer !== null ? `Overseer rounds: ${roundLimitsOf(config).overseer} (a round ends when the top layer gives a verdict; the run stops, resumable, at that cap or when a layer's revision bound is reached; at most ${roundLimitsOf(config).passes} passes, a ceiling, not a plan)\n` : roundLimitsOf(config).ladder ? `Rounds: none (a ladder chain: layer 1 in blocks of ${roundLimitsOf(config).ladder.block} revisions, ${roundLimitsOf(config).ladder.visits} layer-2 visits, then a top-layer read; the run ends on agreement, a stuck debate, the limit you type or your stop${ladderTypedReads() !== null ? `; you typed ${ladderTypedReads()} top-layer reads as your own bound` : ''})\n` : `Rounds: ${roundLimitsOf(config).passes}\n`));   // A-DRAFT (WORDING LAD-R38). CHANGED ACCEPTED (0.8.4 --rounds fix-up, C&C ruling 11 Nov 2026): the recorded suffix "; you typed N top-layer reads as your own bound" now prints when ladderTypedReads() (a typed or saved number) is set; OLD it read the chain file's own passes, which a typed --rounds on a ladder chain never set (so the line said "none" beside an upper figure of N reads) and which printed "you typed" for a chain's own limit. NO new words.
  for (const l of [...routeLines(claudeRouting), ...sessionStopsLines(claudeRouting, config, { draft: Boolean(draftPath) }), ...resumeStopLines(claudeRouting), ...zeroRetentionLines(zeroRet), ...personaFormLines(personaFormDecision), ...skippedRoomLines(routedSeatsWithoutWindow(everySeatOf(config)))]) console.log(l);      // 0.8.4 the Claude route: the route this chain was priced on, before the rows (C3: the C2 commit named it for the JSON and the replay dry run only; a direct run with a usable key prints nothing here)
  const rows = printChainRows(config, { fromRun, typedReads: ladderTypedReads() });
  console.log(`\n  Expected: the chain's assumed sizes, the typical output of a review, ${roundLimitsOf(config).ladder ? ladderExpectedWords(roundLimitsOf(config), ladderTypedReads()) : roundLimitsOf(config).overseer !== null ? 'seven overseer rounds each ending after ONE climb through the layers, no inner revisions (the plain-run shape; a clean first climb stops early and costs less)'.replace('seven', String(roundLimitsOf(config).overseer)) : 'every round up to the cap; a clean first critique stops early and costs less'}. Upper estimate: every planned call writes its seat's whole output allowance (an Anthropic seat's one retry is included); a pass that asks a silent seat again, the retry of a cut-off reply from another seat and the stages a chain does not list are not priced, and the spend cap stops them. The cap can stop a run between the two figures.${roundLimitsOf(config).overseer !== null ? ` For this chain the upper estimate counts every allowed revision used in every overseer round (layer 1 up to ${roundLimitsOf(config).layerRevisions[1]}, layer 2 up to ${roundLimitsOf(config).layerRevisions[2]} per round); it counts the in-pass re-asks (up to 2 per seat) at the review's expected cost, but not up to 2 consecutive passes that re-ask a silent seat, the explicit asks of a silent judge, answer-back calls, ${notesMemoryClause(config) ? `${notesMemoryClause(config)}, ` : ''}or the larger prompt the top layer reads. The limit you type is the only ceiling.` : roundLimitsOf(config).ladder ? ` For this chain the upper estimate is priced on ${ladderUpperWords(roundLimitsOf(config), ladderTypedReads())}. It does not count the stages a chain does not list, answer-back calls or the larger prompt the top layer reads. The limit you type is the only ceiling.` : ''}`);
  for (const w of policyWarnings) console.log(`\n  policy warning - ${w}`);
  { const cc = callCeilingOf(config); if (cc) console.log(`\n  ${cc.words.split('\n').join('\n  ')}`); }   // 0.8.4 S11 (A-DRAFT S11-w1..w4): the most calls the chain's rules allow; the JSON carries the same as `callCeiling`
  for (const line of priceTableLines()) console.log(`  ${line}`);
  for (const line of userPriceLines()) console.log(`  ${line}`);
  { const pref = preferenceSentence(preferenceRows(everySeatSlotsOf(config).map(({ seat }) => seat))); if (pref) console.log(`  ${pref}`); }   // the limit-screen cleanup (1 Nov 2026): the host preference moved here from the per-cap screen
  // The rows above price the chain's own assumed prompt size, not the task in hand: a 13-word task
  // and a 30,000-token one priced the same (walked 2026-09-25). With --task, say how the task
  // compares, and reprice with it added when it is larger. Four characters per token is a rough
  // rule, not a tokenizer; the per-run cap still checks every real prompt before it is sent.
  if (taskPath && existsSync(resolve(work, taskPath))) {
    const assumed = config.estimate?.promptTokens ?? DEFAULT_ESTIMATE.promptTokens;
    const taskTokens = Math.ceil(readFileSync(resolve(work, taskPath), 'utf8').length / 4);
    if (taskTokens > assumed) {
      const biggerConfig = { ...config, estimate: { ...(config.estimate || DEFAULT_ESTIMATE), promptTokens: assumed + taskTokens } };
      const bigger = estimateChainRows(biggerConfig, { fromRun, typedReads: ladderTypedReads() }).reduce((sum, r) => sum + r.usd, 0);
      const biggerMax = estimateChainRows(biggerConfig, { fromRun, maximum: true, typedReads: ladderTypedReads() }).reduce((sum, r) => sum + r.usd, 0);
      console.log(`  Your task is roughly ${taskTokens} tokens, more than the ${assumed} this estimate assumes for a whole prompt.`);
      console.log(`  Priced again with your task added to every prompt: ${formatUsd(bigger)} per run expected, with an upper estimate of ${formatUsd(biggerMax)}.`);
    } else {
      console.log(`  Your task (roughly ${taskTokens} tokens) fits inside the ${assumed}-token prompt this estimate assumes.`);
    }
  }
  // mock/external are synthetic seats that are never billed and were never
  // going to be in pricing.json - only a real provider's missing price is
  // worth telling anyone about.
  // Every seat slot, not only the planned rows (0.8.2 item 8a): an unpriced seat of a stage that is switched off is refused under a cap too.
  const unpriced = [...new Set([...rows.filter(r => !r.priced && !r.seat.startsWith('mock/') && !r.seat.startsWith('external/')).map(r => r.seat), ...unpricedSeats(config).map(u => `${u.provider}/${u.model}`)])];
  if (unpriced.length) {
    console.log('');
    for (const seat of unpriced) {
      const [provider, model] = seat.split('/');
      console.log(`  ${formatCouncilError('COUNCIL-E002', { provider, model, problem: priceProblemOf(provider, model), ...(maxUsd !== null ? { capUsd: maxUsd } : {}) }).replace(/\n/g, '\n  ')}`);
    }
  }
  // Unit 3b (Q1b): the start refusals a real start would meet, reported the way unpriced seats are (a refused class's note was printed above).
  if (capsChainRefusals.length) { console.log(''); for (const r of capsChainRefusals) console.log(`  ${capsStartRefusalLine(r)}`); }
  if (zeroRet.refusal) { console.log(''); console.log(`  ${zeroRet.refusal}`); }      // 0.8.4 zero retention: what a real start would stop with (exit 5), said and gone on
  process.exit(0);
}

const missingLines = missingKeyLines(config, allSeats);
if (missingLines) {
  for (const l of missingLines) console.error(l);
  process.exit(EXIT_DEGRADABLE);
}

// A resumed run inherits the ceiling it was started under unless this invocation names a different one - otherwise resuming would silently drop the cap the run was created with.
let maxUsdEff = argv.includes('--max-usd') ? maxUsd
  : (resumeMeta && 'maxUsd' in resumeMeta) ? resumeMeta.maxUsd
  : maxUsd;
// 0.8.2 item 8a (owner, 7 Oct 2026): under a cap, a seat with no price row is refused before anything is sent. The cap projects such a seat at $0, so it could not stop what a call to it costs; the way out is a pricing row
// or --max-usd none. mock, external and ollama are exempt (src/cost.js needsPrice). invoke() refuses the same seats if a call reaches it some other way.
if (maxUsdEff !== null || chainIsPaid(config)) {   // a paid start always has a cap by the time it runs (the typed limit, below), even when a flag said `none`: an unpriced seat is refused here, before the gate and before any spend
  const unpricedNow = unpricedSeats(config);
  if (unpricedNow.length) {
    console.error('');
    for (const u of unpricedNow) { console.error(formatCouncilError('COUNCIL-E002', { provider: u.provider, model: u.model, problem: u.problem, roles: u.roles, ...(capsOn.length && capsInForce(config, capsOn).length ? {} : { capUsd: maxUsdEff }) })); console.error(''); }   // unit 4c1: under the caps no run-wide figure is the run's cap
    process.exit(EXIT_DEGRADABLE);
  }
}
// Unit 3b: the start refusals (src/caps.js "THE START REFUSALS"), right after the unpriced refusal and before anything is written: every refusal of the first kind
// met (a seat that is not mock carrying mockBills, whatever the switch says; seats no enabled cap covers, exit 5; option B and the unreadable limits; Q1).
if (capsChainRefusals.length) {
  const first = capsChainRefusals[0];
  for (const r of capsChainRefusals.filter(x => x.code === first.code)) console.error(r.sentence);
  process.exit(first.exit);
}
// Unit 4b2 (src/caps.js "THE ARMING"): the caps this run is held to, one typed limit each ([] = today's path: the switch off, or no cap in force). A START arms them.
// Unit 4c1 (src/caps.js "THE RESUME"): a RESUME takes its class from its run folder: a caps run resumes under the limits typed for it (each read back from the ledger
// at its gate below), a start still waiting for its typed limits continues; the mode flip (both ways), a changed set of caps and a folder whose limits cannot be
// told are refused here, before anything is written. A chain with no cap in force keeps today's path.
capsArmed = capsOn.length ? capsInForce(config, capsOn) : [];
if (resumeMeta) {
  const dir = resolve(resumeRun);
  const named = resumeMeta.caps && typeof resumeMeta.caps === 'object' && !Array.isArray(resumeMeta.caps) ? Object.keys(resumeMeta.caps) : [];
  const verdict = capsResumeVerdict({ switchCaps: capsOn, armed: capsArmed, meta: resumeMeta, entries: capsOn.length ? readdirSync(dir, { recursive: true }) : [], consumed: named.filter(id => runCapAuthority(dir, { runId: basename(dir), capName: id }).status === 'ok') });
  if (verdict.refuse) { console.error(verdict.refuse); process.exit(2); }   // A-DRAFT sentences (src/caps.js)
}

const taskPathEff = resumeMeta?.task || taskPath;
// Where the task file is. A new run records it as an absolute path plus the directory it was
// started in, so a resume from anywhere finds it (2026-09-23 audit, CLI finding 5). An older
// run.json with a relative path is tried against its recorded cwd, else this directory. On
// resume, --task may point at the file's new location: its content is still checked against
// the run's stored hash below (frozen scope), so this can't swap in a different task.
const taskFile = !resumeMeta ? resolve(work, taskPathEff)
  : taskPath ? resolve(work, taskPath)
  : isAbsolute(resumeMeta.task) ? resumeMeta.task
  : resolve(resumeMeta.cwd || work, resumeMeta.task);
if (resumeMeta && !existsSync(taskFile)) {
  console.error(`\nThis run's task file isn't where run.json says: ${taskFile}`);
  console.error(`run.json records the task as "${resumeMeta.task}"${resumeMeta.cwd ? ` (started in ${resumeMeta.cwd})` : ' (relative, and this run predates recording its start directory)'}.`);
  console.error(`Resume from the directory the run was started in, or pass --task <path to the same task file>;`);
  console.error(`its content is checked against the run's stored hash, so it must be the same task.`);
  process.exit(1);
}
if (!existsSync(taskFile)) {
  console.error(`\nNo task file at ${taskFile}`);
  console.error(`The task file is the request the council plans against - plain prose, written by you.`);
  console.error(`Create one and run again, e.g.:\n`);
  console.error(`    mkdir -p tasks`);
  console.error(`    echo "What I want planned, in plain words." > ${taskPathEff}`);
  process.exit(1);
}
let request = readFileSync(taskFile, 'utf8');

// v5 item 2: a readable name for this run. Precedence: --label flag, then the task file's own
// `label:` line, then the task file's own basename with no input required. Only computed on a
// fresh start - a resumed run carries its label forward unchanged via run.json's spread below,
// since --label/the task file may have changed by the time someone resumes.
const labelFlagRaw = flag('label', null);
const labelFlagValue = typeof labelFlagRaw === 'string' ? labelFlagRaw : null;
// Read from the task's own prose only: a fenced YAML file's `label:` line is not the operator's.
const labelFieldMatch = outsideFences(request).match(/^label:[ \t]*(.*?)[ \t]*$/m);
const labelDefault = basename(taskPathEff).replace(/\.[^./]+$/, '');
const labelEff = labelFlagValue || (labelFieldMatch ? labelFieldMatch[1] : null) || labelDefault;

// v2 plan §7.2: fingerprint scope is the task's own text and the chain config, not the
// --context document bundle appended below - captured before that append happens.
const rawTaskTextForCacheFingerprint = request;
// v3 §2: frozen-scope enforcement. Hashes the raw task text alone (not the chain config -
// that's §7.2's cache fingerprint, a different property) so a run can tell whether its own
// task file changed since it started, independent of --context docs. Reuses src/integrity.js's
// own hashing rather than a second implementation.
const taskHash = taskHashOf(rawTaskTextForCacheFingerprint);
// --context: standing direction documents, appended to every request so the
// harness plans within the same direction the humans discuss (context/README.md).
const contextArgRaw = resumeMeta ? resumeMeta.context : flag('context', null);
// Stored absolute in run.json (see startDir above); an older run's relative entries resolve against
// the directory it was started in.
const contextArg = contextArgRaw && contextArgRaw !== true
  ? String(contextArgRaw).split(',').map(x => x.trim()).filter(Boolean).map(e => resolve(startDir, e)).join(',')
  : contextArgRaw;
// CLI audit #1: what the artifact gate reads. The --context documents are standing direction, not
// artifacts the task claims to include, and the CLI itself writes a `## <file>.md` heading over each
// one - so gating them blocked every --context run at exit 9 (MCP start_run's `context` could never
// work, since MCP cannot pass --allow-unfenced). The gate reads the task text alone.
const requestForArtifactGate = request;
let contextFilesForScan = [];
let contextSha256 = null;
let contextHash = null; // 0.8.0: the standing-context bundle's hash, so a resume can tell it changed
if (contextArg) {
  // Which files, and each one read non-blocking with a size cap: a FIFO, a device or an oversized
  // file is refused with its name, before any call (src/context-files.js).
  let files, docs;
  try {
    files = contextFileList(contextArg);
    contextFilesForScan = files;
    docs = contextBundleText(files);
    contextHash = contextHashOf(docs);
    contextSha256 = sha256Of(docs); // 0.8.2 item 6a: the full-width hash the thin contract carries (contextHash above is the 12-character fingerprint)
  } catch (e) {
    if (!(e instanceof ContextFileError)) throw e;
    console.error(`${e.message}. Refused before any call.`);
    process.exit(2);
  }
  request += `\n\n---\n\n# Standing context - direction documents\n\nThese are the mission, the decisions already taken and the ideas parked for later, as the people running this project keep them. Plan within them. Do not restate them, do not re-decide anything they settle, and do not pull a parked idea into scope unless the request above asks for it. Where the request and a document conflict, the request wins and you say so under "Assumptions".\n\n${docs}`;
  console.log(`context: ${files.length} document(s) appended (${files.map(f => f.split('/').pop()).join(', ')})`);
}
// v7.x item 2: the PII/secrets pre-flight gate - strictly before any provider adapter is
// constructed and before a run folder is even created. Not invoked at all unless --pii-gate was
// passed (see flag parsing above). Bug-audit fix, 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md
// #3): it used to scan the task file alone, BEFORE --context was appended, and never the handed
// draft (--draft / --from-run) - both reach every seat. It now scans everything a seat will read.
// Pre-release audit 2026-09-23 (GuardLayer #3): the mode came from argv only and was not stored,
// so a resume (the pause hint, MCP resume) ran with no gate at all - while --context and --draft
// are re-read, so text added during a pause went to every seat unscanned. The mode and allow-list
// are saved in run.json on the first sitting and re-applied, with a fresh scan, on every sitting.
// A flag given on resume wins over the saved one.
// Bug audit 2026-09-26 #1: --allow-unfenced was read from this sitting's argv only, so a run
// started with it and resumed without it (MCP resume_run/submit_stage cannot pass it; nor does the
// pause hint) was blocked at exit 9 by the gate it had been allowed past. Saved in run.json like
// piiGate.allow and applied on resume; a flag given on the resume replaces the saved value.
const allowUnfencedEff = unfencedArg !== null ? allowUnfenced : resumeMeta?.allowUnfenced === true;
const unfencedAllowListEff = unfencedArg !== null ? unfencedAllowList
  : (Array.isArray(resumeMeta?.unfencedAllowList) ? resumeMeta.unfencedAllowList.map(String) : []);
const unfencedMeta = { ...(allowUnfencedEff ? { allowUnfenced: true } : {}), ...(unfencedAllowListEff.length ? { unfencedAllowList: unfencedAllowListEff } : {}) };
let piiGateEff = piiGateMode !== null ? piiGateMode : (resumeMeta?.piiGate?.mode ?? null);   // typed or saved; a tree MEMBER keeps null when neither (it runs under its tree's mode, src/tree-member.js)
const piiAllowEff = piiGateMode !== null || piiAllow ? piiAllowList : (resumeMeta?.piiGate?.allow ?? []);
// BUG-D-012 (a): run.json is project-writable text, so a saved piiGate is checked like a typed one before it is used: a mode that is neither warn nor hard-stop (an "off", a typo) or an allow that is not a list of the four types REFUSES the resume (exit 2, nothing started),
// the same stance as src/pii-mode.js for the setting. Only the parts this resume USES are checked: the saved mode when no --pii-gate was typed, the saved list when neither --pii-gate nor --allow-pii was.
if (resumeMeta && resumeMeta.piiGate !== undefined && (piiGateMode === null || !piiAllow)) {
  const refusal = savedPiiGateRefusal(resumeMeta.piiGate, join(resolve(resumeRun), 'run.json'), { mode: piiGateMode === null, allow: piiGateMode === null && !piiAllow });
  if (refusal) { console.error(refusal); process.exit(2); }
}
// 0.8.3 M1 (PLAN 4.4, 7.6): `--tree-node <file>` makes this run a member of a recursive-councils tree; its lineage (tree id, logical node, generation, attempt...) comes from that file, never from task text. A resumed
// member reads its lineage from its own run.json. A member claims its node in the tree record just before its first paid call (below) and is refused, exit 19, when the record does not allow it.
const treeNodeArg = flag('tree-node', null);
if (treeNodeArg !== null && resumeMeta) { console.error('--tree-node: a resume reads the lineage from the run\'s own run.json'); process.exit(2); }
let treeLineage = null;
if (treeNodeArg !== null) {
  try { treeLineage = readTreeNodeFile(resolve(work, treeNodeArg)); } catch (err) { console.error(`--tree-node: ${err.message}`); process.exit(2); }
} else if (resumeMeta?.tree) treeLineage = resumeMeta.tree;
// The member unit (13 Oct 2026, gate 1 passed): what a tree member does not take, and whose input it is, are settled HERE, before any gate reads the input and before run.json is written (a refusal after run.json would trap the node:
// the next sitting takes the resume path, reads the saved value and is refused again). Order: tampering first, then secrets, then personal data.
const exitOnMemberRefusal = err => {
  // Fail closed: a member that cannot record its claim does not run. The table refusing the step, the gate or a check failing, no live grant, the record locked past the retries, an unreadable record, a full disk:
  // all exit 19, nothing run, nothing spent.
  const why = err instanceof TreeRefusal ? err.message : err instanceof RunLockedError ? (err.holder?.unreadable ? err.message : `the tree record is locked by another process (pid ${err.holder?.pid}) and stayed locked`) : `the tree record could not be written (${err.code || err.message})`;
  console.error(`\n${why}\nNothing was run and nothing was spent.`);
  process.exit(EXIT_TREE_REFUSED);
};
if (treeLineage) {
  // a typed flag is a usage error (exit 2, no lock, no tree record: a typo must not append to the record); a value SAVED in run.json by a run that predates this refusal is exit 19 with the way out
  const flagRefusal = memberFlagRefusal({ lineage: treeLineage, typed: { allowSecretShaped: allowSecretShapedFlag, allowPii: Boolean(piiAllow) }, saved: { allowSecretShaped: resumeMeta?.allowSecretShaped === true, allowPii: resumeMeta?.piiGate?.allow } });
  if (flagRefusal) { console.error(`\n${flagRefusal.text}`); process.exit(flagRefusal.code); }
  // the node's input must BE the bundle it was registered with: read-only identity check under the tree lock, a `blocked` record on refusal, NEVER a claim (memberStart, later, is the claim and the locked backstop)
  try { memberPreflight({ rootDir: join(resumeMeta ? dirname(resolve(resumeRun)) : join(work, 'runs'), treeLineage.treeId), lineage: treeLineage, inputs: { task: taskFile, criteria: criteriaPath, context: contextArg || null }, piiGate: piiGateEff }); } catch (err) { exitOnMemberRefusal(err); }
}
// bundle unit step 2: the earlier plan of this node (the bundle's old-plan.md, offered as data to the BUILDER only; not scanned: Muad 19 Okt)
const memberEarlier = treeLineage ? memberEarlierPlan({ rootDir: join(resumeMeta ? dirname(resolve(resumeRun)) : join(work, 'runs'), treeLineage.treeId), lineage: treeLineage }) : null;
if (memberEarlier?.error) { console.error(`\n${memberEarlier.error}. Nothing was run and nothing was spent.`); process.exit(EXIT_TREE_REFUSED); }
// S5b part A commit 3: a tree MEMBER under `warn` also keeps its findings in WARNINGS.md (written below, once the run folder exists and the member marker is read): the console lines are lost in an unattended sitting
let piiWarnFindings = [];
// 0.8.3 (owner 18 Okt 2026, 16:45): the gate STOPS at a finding by default on every run, CLI and MCP (src/pii-mode.js); only the user can choose `warn`. A run that is not a tree member records the mode it ran under (typed, saved, else the setting COUNCIL_PII_GATE, else hard-stop) in run.json with
// its other metadata, so a later sitting keeps it; a tree member keeps what the tree says (piiGateEff stays null for the tree comparison) and scans under hard-stop when nothing else is set.
const piiSetting = piiModeSetting(process.env);
// A value that is neither warn nor hard-stop refuses the run (exit 2, as an invalid --pii-gate does), whatever else is typed or saved: the setting can only tighten, so a typo must not loosen it (C&C ruling 18 Okt 2026). A tree member never reads the setting.
if (piiSetting.refusal && !treeLineage) { console.error(piiSetting.refusal); process.exit(2); }
if (piiGateEff === null && !treeLineage) piiGateEff = piiSetting.mode;
// a member that was handed no mode scans under the stop, never a quiet warn (C&C 19 Okt 2026: a standing warn comes only from the user); memberStart still holds it to the tree's recorded mode (exit 19 on a mismatch)
const piiScanMode = piiGateEff ?? 'hard-stop';
// On a resume of a PAUSED run, --allow-secret-shaped is the pause's one choice (= --continue, below), whether or not the run was started with the flag: for a run not started with it the flag is NOT saved as
// allowSecretShaped (so the run stays resumable over MCP, audit F1) and does not switch the input scan off; for a run started with it the saved flag already stands and nothing more is saved.
const flagAnswersPause = allowSecretShapedFlag && !!resumeMeta && existsSync(join(resolve(resumeRun), 'STOPPED-secret.md'));
const typedStartFlag = allowSecretShapedFlag && !flagAnswersPause;
const keyScanRefusesHere = !(typedStartFlag || resumeMeta?.allowSecretShaped === true);   // the same two inputs as allowSecretShapedEff below
{
  // BUG-C-026: the criteria and the typed answers reach every seat's prompt too (the key scan below already reads both), so the PII gate reads them with the SAME labels the key scan uses. A tree MEMBER keeps its recorded allowance model (task text only for the root, the whole input for a child): not extended here.
  const answersPathForPii = resumeMeta ? join(resolve(resumeRun), 'answers.md') : null;
  let answersTextForScan = '';
  if (!treeLineage && answersPathForPii && existsSync(answersPathForPii)) { try { answersTextForScan = readFileSync(answersPathForPii, 'utf8'); } catch { /* the stage cache cannot read it either: it asks again */ } }
  const criteriaTextForPii = treeLineage ? '' : criteriaPath
    ? (() => { try { return readFileSync(criteriaPath, 'utf8'); } catch { return ''; } })()
    : (Array.isArray(config.criteria) ? config.criteria : []).map(c => (typeof c === 'string' ? c : JSON.stringify(c)).replace(/\n/g, ' ')).join('\n');
  // A new source that the key scan below refuses anyway (a credential-shaped string in it) is left to that refusal, which names each line: a URL credential (`app:Pw@host`) is also e-mail-shaped, and the PII screen must not take the refusal's place (test/answers-scan.test.js AS-1).
  const keyScanWillRefuse = text => keyScanRefusesHere && textSecretFindings(text, 'x').length > 0;
  const sources = [['the task file and --context documents', request], ['the handed draft (--draft / --from-run)', handedDraft]].filter(([, text]) => text)
    .concat([[criteriaPath ?? 'the criteria reused from --from-run (criterion number)', criteriaTextForPii], ['answers.md (the typed answers of the "answers" stage)', answersTextForScan]].filter(([, text]) => text && !keyScanWillRefuse(text)));
  // T-b: a tree member's allowance is the one a person recorded in the tree (tree.json piiAllow for R@g1, the bundle_input_allowed event for a child), read here from the record; typed/saved stays empty for a member (memberFlagRefusal)
  const piiRecordedAllow = treeLineage ? recordedPiiAllow({ rootDir: join(resumeMeta ? dirname(resolve(resumeRun)) : join(work, 'runs'), treeLineage.treeId), lineage: treeLineage }) : [];
  // C&C ruling (c): the root's recorded allowance covers the TASK text only (the task is the start of `request`); a child's covers its whole input
  const rootMember = treeLineage?.node === 'R';
  // C&C ruling (c): a CHILD's input carries the root task's own bytes in context.md section 2 (copied by the tree code); the root allowance covers exactly those stretches, found by re-deriving the bundle, never by looking at the text
  let rootCoverRanges = null;
  if (treeLineage && !rootMember && contextFilesForScan.length === 1) {
    try {
      const rd = join(resumeMeta ? dirname(resolve(resumeRun)) : join(work, 'runs'), treeLineage.treeId);
      const cover = memberRootCover({ rootDir: rd, lineage: treeLineage, work, contextText: readContextFile(typeof contextFilesForScan[0] === 'string' ? contextFilesForScan[0] : contextFilesForScan[0].path) });
      const docsText = contextBundleText(contextFilesForScan);
      const ranges = cover.types.length ? coverRanges({ request, docs: docsText, prefix: docsText.slice(0, docsText.indexOf('\n\n') + 2), spans: cover.spans }) : null;
      if (ranges) rootCoverRanges = { types: cover.types, ranges, where: 'the task file and --context documents' };
    } catch { rootCoverRanges = null; }
  }
  const pii = piiGateReport({ mode: piiScanMode, allowRanges: rootCoverRanges, allow: [...new Set([...piiAllowEff, ...(rootMember ? [] : piiRecordedAllow)])], allowTask: rootMember && piiRecordedAllow.length ? { types: piiRecordedAllow, lines: requestForArtifactGate.split('\n').length, where: 'the task file and --context documents' } : null, sources, keyScanAllowed: !keyScanRefusesHere, keyScanRefuses: keyScanRefusesHere, ...(treeLineage ? { forTree: 'member' } : {}) });   // src/run-preflight.js (`council tree start` asks the same question for a tree's runs)
  for (const l of pii.lines) console.error(l);
  if (pii.blocked) process.exit(EXIT_PII_BLOCKED);
  if (piiScanMode === 'warn') piiWarnFindings = pii.findings;
}
// 0.7.9: the outbound key scan, on by default (src/outbound-scan.js). invoke() checks every prompt
// before it leaves; this checks the input files once, on every sitting, so the refusal names the file
// and line - and a run that would be refused at its first stage costs nothing and leaves no folder.
// `--allow-secret-shaped` is saved in run.json, so a resume keeps it.
// 0.8.4 (Muad 8 Nov 2026: a found secret PAUSES the run): --allow-secret-shaped waives the INPUT scan below, as it always did (and the PII gate's secret lines above), but it no longer
// waives the scan of every later prompt. The person's consent attaches to VALUES: run.json `secretAllow` { key, hashes } holds an HMAC (outbound-scan.js valueHashOf) of each key-shaped
// value the person allowed, under a random per-run key. A flag typed on this command allows the values its inputs hold (so the task's own key passes every stage); a --continue at a
// pause allows the values the pause found (below). Any other value found in a prompt pauses the run. A tree member takes none.
const allowSecretShapedEff = typedStartFlag || resumeMeta?.allowSecretShaped === true;
const secretScanMeta = allowSecretShapedEff ? { allowSecretShaped: true } : {};
const secretAllow = (() => {
  const saved = resumeMeta?.secretAllow;
  const okKey = saved && typeof saved.key === 'string' && /^[0-9a-f]{32}$/.test(saved.key);
  return { key: okKey ? saved.key : newAllowKey(), hashes: new Set(okKey && Array.isArray(saved.hashes) ? saved.hashes.filter(h => typeof h === 'string' && /^[0-9a-f]{32}$/.test(h)) : []), saved: okKey };
})();
let secretFinishArmed = false;    // --continue with a recorded finish for this pause
let secretFinishRelayed = false;   // 0.8.4 (Q9): the finish that is armed was the person's choice RELAYED by the handling session (the ledger says so; run.json only names the gate)
let secretEndsAtPause = false;   // 0.8.4: --finish-now at a pause AFTER the rounds (no loop to end): the sitting is a no-money sitting that also does not send a prompt holding an unallowed secret
let secretFinishAtOnce = false;   // 0.8.4 (step 3): the armed finish is a --finish-now: no judge is asked again, and the value the pause found is NOT added to the allowed list
let budgetFinishOnly = null;     // 0.8.4 S16 (F): --finish at a spending stop: { label, cap_name? }; the command records it and exits 4 right after the run lock
let budgetContinue = null;       // 0.8.4 (unit-end item ii): --continue at a spending stop with a finish on record: the way back past it; { phase, label, capName, stopSha, stopId, relayed }
let budgetFinishContinued = false;   // the latest choice of the run's ledger is that continue: the rounds go on
let budgetFinishWithdrawn = false;   // the approval record holds a plain finish, run.json no longer does: taken back by hand
let budgetFinishUnrecorded = false;   // false | 'loop' | 'after': where the stop falls   // run.json holds a finish for this stop that the ledger does not (an older folder): not applied
let budgetFinishNow = null;      // 0.8.4 (ladder unit): --finish-now at a spending stop: { phase, label, capName }; this command only, nothing is recorded for a later resume to read
let budgetFinishArmed = null;    // 0.8.4 S16 (F): a resume that carries the recorded finish: { label, capName }
let secretFinishOnly = null;     // --finish: the label; the command records it and exits 11 right after flushChoices()
let secretAllowDirty = !secretAllow.saved && !treeLineage;   // a run.json without a usable key gets one at the end of the start's refusals (flushChoices)
if (typedStartFlag && !treeLineage) {
  try {
    const texts = inputSecretSources({ taskFile, taskText: rawTaskTextForCacheFingerprint, contextFiles: contextFilesForScan, readContext: readContextFile, handedDraft, criteriaPath, config }).map(([, t]) => t);
    const answersFile = resumeMeta ? join(resolve(resumeRun), 'answers.md') : null;
    if (answersFile && existsSync(answersFile)) { try { texts.push(readFileSync(answersFile, 'utf8')); } catch { /* the stage cache cannot read it either: it asks again */ } }
    for (const h of inputValueHashes(texts, secretAllow.key)) secretAllow.hashes.add(h);
    secretAllowDirty = true;
  } catch { /* an unreadable --criteria file is refused elsewhere */ }
}
setOutboundScan({ allow: false, allowed: treeLineage ? null : secretAllow });
if (!allowSecretShapedEff) {
  // C&C (14 Oct 2026, B's "answers scan" defect; Muad 12 Oct: "the check should go everywhere"): the typed answers of a run paused at its `answers` stage are TEXT A PERSON TYPED, and they reach every later seat's prompt. On the CLI they are a file the person
  // writes by hand (answers.md), read by the stage cache on this resume; the only scan they met was invoke()'s send-time distinctiveOnly one, so a Bearer token, a URL credential or a NAME=secret line went through. They get the FULL input scan here,
  // the same call the other typed texts use (textSecretFindings), naming the file and the line, never the value, before any stage is replayed or paid for. The MCP half (submit_stage) calls the same helper at submission.
  const answersPath = resumeMeta ? join(resolve(resumeRun), 'answers.md') : null;
  let answersText = '';
  if (answersPath && existsSync(answersPath)) { try { answersText = readFileSync(answersPath, 'utf8'); } catch { /* the stage cache cannot read it either: it asks again */ } }
  const found = [
    ...inputSecretFindings({ taskFile, taskText: rawTaskTextForCacheFingerprint, contextFiles: contextFilesForScan, readContext: readContextFile, handedDraft, criteriaPath, config }),
    ...(answersText ? textSecretFindings(answersText, 'answers.md (the typed answers of the "answers" stage)') : []),
  ];
  if (found.length) {
    for (const l of secretScanRefusalLines(found, treeLineage ? { forTree: 'member' } : {})) console.error(l);
    process.exit(EXIT_PII_BLOCKED);
  }
}
// --run-id: the MCP server picks the folder name up front, so two start_run calls in the same
// instant can't both report the first folder that appeared (pre-release audit 2026-09-23,
// McpServer #2). Same character set the server's run-id check accepts.
const requestedRunId = flag('run-id', null);
if (requestedRunId !== null && (resumeMeta || !/^[0-9TZ-]+$/.test(requestedRunId))) {
  console.error(resumeMeta ? '--run-id: a resume keeps its own folder' : `--run-id: digits, T, Z and "-" only, got "${requestedRunId}"`);
  process.exit(2);
}
// 0.8.3 M2 (PLAN 7.6 step 4): a member runs under a finite cap, always. `--max-usd none`, a run.json that saved `maxUsd: null`, and an api call with 'none' all end here, before a run folder or run.json is written.
if (treeLineage && maxUsdEff === null) {
  console.error('\n--max-usd none is refused for a recursive-councils tree member: its cap is the lesser of what you ask and its grant. Nothing was run and nothing was spent.');
  process.exit(EXIT_TREE_REFUSED);
}
// report.json's started_at (0.7.7): saved in run.json on the first sitting, so a resumed run's
// report still says when the run began.
const runStartedAt = new Date().toISOString();
const runId = resumeMeta ? basename(resolve(resumeRun)) : (requestedRunId || runStartedAt.replace(/[:.]/g, '-'));
// 0.8.3 M5f: a tree member's pause notice and resume brief name the tree and its command (src/tree-redirect.js); null for every other run
const memberNotice = memberResumeRedirect(treeLineage ? { tree: treeLineage } : null, runId, councilCommand());
// A resume uses the folder it was pointed at. It used to rebuild the path as
// <cwd>/runs/<basename>, so resuming from another directory (an MCP-started run keeps an
// absolute task path) silently started a fresh folder and paid for every stage again
// (2026-09-23 audit, CLI finding 5).
const runDir = resumeMeta ? resolve(resumeRun) : join(work, 'runs', runId);
// A finished run is not resumable. Bug-audit fix, 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md
// backlog): --resume on a run that already has report.json replayed its stages from disk only while
// the task and chain were unchanged; after a chain edit the cache went stale, every stage was paid
// for again, and report.json was overwritten. Refused before the run lock is taken, so a refusal
// never holds the folder. To run the same task again: a new run, --rematch or --replay.
if (resumeMeta && existsSync(join(runDir, 'report.json'))) {
  console.error(`\n--resume: ${runDir} already finished (it has a report.json). Nothing was run and nothing was spent.`);
  console.error(`To run this task again, start a new run with --task, or compare against it with --rematch ${resumeRun} / --replay ${resumeRun}.`);
  // E4: a run that stopped because its open objections did not fit the top layer's ledger is told what to do instead (held sentence; nothing before M7).
  const overflowExit = (() => { try { return ledgerOverflowWords(JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'))); } catch { return null; } })();
  if (overflowExit) console.error(overflowExit);
  process.exit(EXIT_ALREADY_FINISHED);
}
// CR-1E-006: a choice typed on THIS command (--continue / --finish, --skip-seat, --prevail) is held in `pendingChoices`, never assigned into resumeMeta, so none of the run.json writes of the resume branch below (the pid rewrite, the amended task hash, the context
// hash) carries it. flushChoices() writes it once, from the file as it is on disk, after the last refusal of the start (the changed-task and changed-context checks, and the typed-limit gate's refusal). The gate's WAIT (exit 21: "No call was started")
// is not a refusal: the person's next step is a plain --resume after `gate answer`, so the choice is written before that exit too.
const pendingChoices = {};
const pendingSettings = { set: null, drop: [] };   // the settings typed on a RESUME (see the resume branch below); null for a start
const flushNotes = [];   // sentences about a choice that is printed once it IS recorded (after the last refusal of the start), never before
function flushChoices() {
  if (!Object.keys(pendingChoices).length && !pendingSettings.set) return;
  const onDisk = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  for (const k of pendingSettings.drop) delete onDisk[k];
  const { maxUsd: typedMaxUsd, ...settings } = pendingSettings.set ?? {};
  // a paid chain's run.json carries the TYPED limit (the gate's own write, which comes first); the flag value is only a suggestion there
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...onDisk, ...settings, ...(typedMaxUsd !== undefined && !capGateApplies && !capsArmed.length ? { maxUsd: typedMaxUsd } : {}), ...pendingChoices }, null, 2));
  for (const k of Object.keys(pendingChoices)) delete pendingChoices[k];
  pendingSettings.set = null; pendingSettings.drop = [];
  while (flushNotes.length) console.log(flushNotes.shift());
}
// S20 slice 1 (H2-i; Mini-C&C's ruling G3): a raise goes alone. An overseer-round choice (--continue, --finish, --next-pass-layer-3) given with --raise-cap / --relayed would be recorded (flushed at the exit-21 wait) while the raise is
// still unanswered: refused HERE, in any run state, before the --continue / --finish refusals and before the run folder, the lock and run.json are written. The other raise-flag refusals follow refuseStray(), below.
{
  const bad = raiseChoiceRefusal({ argv });
  if (bad) { console.error(`${bad} Nothing was recorded, run or spent.`); process.exit(2); }
}
// S20 slice 2, control 1: `--next-pass-layer-3` on a resume only RECORDS a request and exits, so it goes alone too (raise-alone stays first; before the --ladder refusal below, which would otherwise answer first).
{
  const bad = routeFlagRefusal({ argv });
  if (bad) { console.error(`${bad} Nothing was recorded, run or spent.`); process.exit(2); }
}
// Round semantics 2b-ii (Muad 15 Oct 2026: after the cap or a bound the PERSON chooses; C&C ruling): --continue / --finish answer a run that STOPPED at an overseer limit (STOPPED-overseer_cap/layer_bound.json, report-partial.json, no report.json).
// The choice is recorded in run.json `roundChoices` keyed by the stop (so typing it again after the limit screen counts once) and applied on the replay (chain.js effectiveLimits). A resume WITHOUT a choice
// is not an error and not a fresh stop: it says again that the run is waiting and exits 23 (nothing spent, nothing changed).
// The ladder in force: what this command typed, else what run.json saved. A saved ladder is never replaced by a different one (the passes it already ran were planned under it).
const sameLadder = (a, b) => ['block', 'visits', 'credit', 'exchange'].every(k => a?.[k] === b?.[k]);
if (ladderTyped && resumeMeta?.ladder && !sameLadder(ladderTyped, resumeMeta.ladder)) { console.error(`--ladder: this run already runs under a ladder (layer-1 blocks of ${resumeMeta.ladder.block}, ${resumeMeta.ladder.visits} layer-2 visits, credit ${resumeMeta.ladder.credit}); its passes were planned under those numbers, so a different ladder cannot replace it. Nothing was run and nothing was spent.`); process.exit(2); }   // A-DRAFT (LAD-C3)
// The ladder in force: what this command typed (the person's own numbers win at a fresh start), else what run.json saved, else, on a FRESH start only, the numbers the chain file carries (the permanent ladder). A resume of a run with no saved ladder stays plain.
const ladderKey = roundLimitsOf(config).ladder;
// A resume of a run saved WITHOUT a ladder, on a chain whose file carries the key (the chain was changed since the run started): the run adopts the ladder from the key, with no refusal: a stage it already made is replayed only when the prompt it answered is the one asked now (the stage cache's own check), every other stage is asked again and paid again, exactly as for a typed --ladder on a plain run.
const ladderAdopted = !ladderTyped && !!resumeMeta && !resumeMeta.ladder && !!ladderKey;
const ladderEff = ladderTyped ?? resumeMeta?.ladder ?? ((!resumeMeta || ladderAdopted) && ladderKey ? { block: ladderKey.block, visits: ladderKey.visits, credit: 0, exchange: 0 } : null);
if (ladderCreditArg !== null && ladderKey && !(resumeMeta && !resumeMeta.ladder)) { console.error('--ladder-credit: this chain runs the ladder from its first pass (its file carries the ladder key), so it has no plain passes to credit. Leave the flag out. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT (LAD-C4)
if (ladderEff && !(isOverseerChain(roundLimitsOf(config)) && new Set((config.seats?.critics || []).map(c => c.layer)).size === 3)) { console.error('--ladder: this chain does not have exactly three layers with overseer rounds (maxOverseerRounds and layerRevisions), which the ladder needs. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT; chain.js refuses too, as the backstop
// S20 slice 2, control 1 (replaces the B3 prototype, which wrote `{pass, floor: 3, at, via: 'cli'}` into run.json `ladderSteps`): `--next-pass-layer-3` on a resume asks the NEXT pass to start at layer 3. It does NOT start anything: after the refusals below (all before
// any write, and byte for byte as the prototype had them: src/run-controls.js routeRefusal) it RECORDS a request in the gate ledger and exits 27 (the append, below, after the last refusal a plain resume makes before the run folder and the lock). The handler decides
// (`council route-decide`); the plain resume that follows derives its steps from the ledger's routed decisions. A run.json `ladderSteps` entry is only judged here (a damaged one is refused); the steps themselves are derived after the ruling and re-tag refusals.
let ladderSteps = Array.isArray(resumeMeta?.ladderSteps) ? resumeMeta.ladderSteps : [];
if (ladderSteps.some(x => !stepOk(x))) { console.error('run.json holds a ladderSteps entry that is not {pass, floor: 3}. Check the file: it may have been edited by hand or damaged. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT
if (argv.includes('--next-pass-layer-3')) {
  const refuse = why => { console.error(`--next-pass-layer-3: ${why} Nothing was recorded, run or spent.`); process.exit(2); };   // A-DRAFT
  if (!resumeMeta) refuse('it answers a paused run: use it with --resume <run folder>.');
  const may = routeRefusal(runDir, { ladder: ladderEff, config });
  if (!may.ok) refuse(may.message);
}
// B3 prototype (src/rulings.js): the rulings the person who owns the request has given (gate kind `ruling`). A resume goes on only when every ruling gate can be read and none waits for his answer: a ruling approved after its pass had started would change
// the prompts of stages that are already on disk, and those would be asked again for money. An expired gate can never be approved, so it does not hold the run.
const rulingState = resumeMeta ? rulingsOf(runDir) : { ok: true, rulings: [], pending: [], unreadable: [] };
if (!rulingState.ok) { console.error(argv.includes('--finish-now') && resumeMeta && existsSync(join(runDir, 'STOPPED-budget.json')) ? '--finish-now: the limit this run stopped at cannot be read from the record of what you typed (a folder from before that record, or a damaged one), so it cannot be kept in force in this command. Nothing was recorded, run or spent. What you can still do: a plain resume asks for a new limit above what the run has counted and records it; with that on record, --finish-now can be given again.' : 'The approval record of this run cannot be read, so its rulings cannot be read either. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT (LAD-B9 for a --finish-now at a spending stop: an unreadable ledger names what the person can still do, LADDER_GO 'ROWS BEFORE THE COMMIT' 1)
if (rulingState.unreadable.length) {   // A-DRAFT
  const info = rulingState.unreadableInfo.find(i => i.gate === rulingState.unreadable[0]);
  console.error(`Ruling gate ${rulingState.unreadable[0]} cannot be read as a ruling, and a ruling is never dropped silently.${info?.file ? ` Its text file ${info.file} must hold exactly the bytes the gate was asked for (sha256 ${info.sha256}); restore it, or decline the gate if it still waits (council gate answer ${runDir} ${rulingState.unreadable[0]} --decline). This tool has no command that repairs a damaged gate file or a record whose hash chain is broken.` : ' Its gate file or the approval record is damaged, and this tool has no command that repairs it.'} Nothing was run and nothing was spent.`);
  process.exit(2);
}
if (rulingState.pending.length) {   // A-DRAFT
  const w = rulingState.pending[0];
  const what = w.kind === 'ruling_withdrawal' ? `The withdrawal of ruling ${w.target} from pass ${w.pass}` : `A ruling for pass ${w.pass}`;
  console.error(`${what} waits for the person's answer (gate ${w.gate}): the pass would run without it, and a ruling given after that would change what its stages were asked. Give the answer, or let the gate expire, or take the request back: council ruling-withdraw ${runDir} ${w.gate} --relayed (the handler session, for a gate it asked for), or council gate answer ${runDir} ${w.gate} --decline (at a terminal). Nothing was run and nothing was spent.`);
  process.exit(2);
}
// 0.8.4 D10 slice 2c (H2-v; C&C's ruling (ii)): a resume while a gate of kind excerpt_approval has no excerpts_recorded line is REFUSED with the one dedicated code. This is the run's stop at an excerpt approval: a plain
// resume, resume_run, submit_stage and a tree member's resume all end here. CHANGED ACCEPTED (C&C 09 Nov 2026): with the privacy switch on, only a gate that waits for the person or cannot be read stops here (excerptApprovalStops);
// an answered one is applied, and an expired one asked again, by the pause unit (src/excerpt-pause.js, prepareExcerpts below), which creates these gates and uses the SAME constant for its own stop. A ledger that does not verify was refused just above (the rulings reader), so `ok` is true here.
const excerptWait = resumeMeta ? excerptApprovalStops(runDir) : { ok: true, waiting: [] };   // with the privacy switch on, only a gate that waits for the person (or cannot be read) stops a resume: the pause unit applies an answered one and asks again for an expired one
// `!ok` is reachable only if the ledger stops verifying between two reads inside this process (the rulings reader above already refused a broken one); it is kept so the refusal can never fail OPEN. Untested by design.
if (!excerptWait.ok) { console.error('The approval record of this run cannot be read, so its excerpt approvals cannot be read either. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT
if (excerptWait.waiting.length) {   // A-DRAFT
  const w = excerptWait.waiting[0];
  const words = excerptWaitWords(w.status, `${councilCommand()} gate answer ${runDir} ${w.gate}`);
  console.error(`This run is stopped at an approval of excerpts of your project (gate ${w.gate}): it ${words.phrase}${excerptWait.waiting.length > 1 ? `, and ${excerptWait.waiting.length - 1} more wait` : ''}. ${words.tail} Nothing was run and nothing was spent.`);
  process.exit(EXIT_AWAITING_EXCERPT_APPROVAL);
}
const ownerRulings = rulingState.rulings;
// M1 (S19 (c)): the handler's re-tags are the handler session's OWN act, recorded by `council retag-add` in retags.jsonl (src/handler-retags.js); a resume reads them and applies each at the top of its pass. A line that cannot be read stops the resume: a re-tag is never dropped silently.
const retagState = resumeMeta ? handlerRetagsOf(runDir) : { ok: true, retags: [], unreadable: [] };
if (!retagState.ok || retagState.unreadable.length) { console.error(`retags.jsonl in this run folder cannot be read (${retagState.ok ? `line ${retagState.unreadable[0].line}: ${retagState.unreadable[0].why}` : 'the file cannot be opened'}), and a re-tag is never dropped silently. Repair or remove that line, then resume. Nothing was run and nothing was spent.`); process.exit(2); }   // A-DRAFT
for (const g of resumeMeta ? gatesOfKind(runDir, 'retag') : []) console.error(`Gate ${g.gate} in this run's approval record is of the kind "retag", which no longer exists: a re-tag is the handler session's own act now (council retag-add), so this gate sets nothing${g.status === 'pending' ? ' and nothing waits for it' : ''}. Going on.`);   // A-DRAFT
const handlerRetags = retagState.retags;
// S20 slice 2, control 1: the steps that start a pass at layer 3 are DERIVED from the gate ledger's routed decisions (src/run-controls.js routedStepsOf), not read from run.json: there is no second copy. They sit AFTER the ruling and re-tag refusals above, which already read the
// ledger and refuse a corrupt one with their own sentence; this is the fail-closed backstop. A run.json `ladderSteps` entry whose pass has no routed decision behind it (a prototype's, or a hand-written one) has no author in the record and is refused.
if (resumeMeta) {
  const routed = routedStepsOf(runDir);
  if (!routed.ok) { console.error('The approval record of this run cannot be read, so the routes recorded in it cannot be read either. Nothing was run and nothing was spent.'); process.exit(2); }   // A-DRAFT
  const unbacked = ladderSteps.find(x => !routed.steps.some(r => r.pass === x.pass));
  if (unbacked) { console.error(`run.json holds a ladderSteps entry for pass ${unbacked.pass} that no routed decision in the gate ledger backs (an earlier version wrote the route into run.json only, or the file was edited by hand). To go on, delete the \`ladderSteps\` line from run.json in the run folder; to still start that pass at layer 3, ask again with --next-pass-layer-3 and route it with \`council route-decide\`. Nothing was run and nothing was spent.`); process.exit(2); }   // A-DRAFT
  ladderSteps = routed.steps;
}
let roundChoices = Array.isArray(resumeMeta?.roundChoices) ? resumeMeta.roundChoices.map(c => (c?.choice === 'continue' && !Number.isInteger(c.add) ? { ...c, add: defaultAdd(c, config) } : c)) : [];   // a tree sitting writes an entry without `add` (it holds no chain config): filled here, the one place that has it
if (resumeMeta && Array.isArray(resumeMeta.roundChoices)) resumeMeta.roundChoices = roundChoices;   // the resume branch rewrites run.json from resumeMeta: the filled `add` is kept
// Bug audit 2026-10-24 D-013 / C-024 (member half): a tree MEMBER applies only the roundChoices its TREE RECORD backs (run.json is project-writable text: an entry alone, or one for another stop, must not raise a limit or finish the run); the file itself is left as it is.
if (treeLineage && resumeRun) roundChoices = backedRoundChoices(join(dirname(resolve(resumeRun)), treeLineage.treeId), treeLineage, roundChoices);
{
  const wantContinue = argv.includes('--continue'); const wantFinishNow = argv.includes('--finish-now'); const wantFinish = argv.includes('--finish') || wantFinishNow; const wantDrop = argv.includes('--drop-excerpt');   // 0.8.4 (finish at once): --finish-now is a finish that also skips the final read and the ending exchange
  if (wantContinue && wantFinish) { console.error(`--continue and ${wantFinishNow ? '--finish-now' : '--finish'} are two different choices: give one. Nothing was run and nothing was spent.`); process.exit(2); }
  if (flag('stop-gate', null) !== null && !wantContinue && !wantFinish && !wantDrop) { console.error('--stop-gate names the answered stop_decision gate a choice carries: use it with --continue, --finish, --finish-now or --drop-excerpt. Nothing was run and nothing was spent.'); process.exit(2); }   // --drop-excerpt since Q9 (10 Nov 2026): a relayed drop at an excerpt pause
  if (wantFinishNow && argv.includes('--finish')) { console.error('--finish and --finish-now are two different choices: give one. Nothing was run and nothing was spent.'); process.exit(2); }
  if ((wantContinue || wantFinish) && !resumeMeta) { console.error(`${wantFinishNow ? '--continue / --finish-now' : '--continue / --finish'} answer a stopped run: use them with --resume <run folder>. Nothing was run and nothing was spent.`); process.exit(2); }
  const marker = resumeMeta ? readStoppedMarker(runDir) : null;
  const roundMarker = marker && isRoundStop(marker.stoppedBy) ? marker : null;
  const ownerPauseMarker = marker && marker.stoppedBy === 'owner_pause' && pauseStandsForMarker(runDir) ? marker : null;   // the owner's pause (0.8.4 ladder unit): a plain --resume continues it; --finish / --finish-now end it
  const budgetStopFile = resumeMeta && existsSync(join(runDir, 'STOPPED-budget.json'));   // the run is stopped at the spending limit
  // 0.8.4 (relay at a spending stop): a choice RELAYED by the handling session names the answered stop_decision gate that holds the person's words (--stop-gate <id>). It is taken only if (1) the gate is this run's answered gate for THIS stop and THIS choice (attributeChoice: the stop id carries the first 12 characters of the hash of the stop file's figures; answered on the session channel, not closed, read within its ten minutes), (2) the quote the gate holds names the FULL hash of the stop file as it is now, and (3) no spending limit was approved after the gate was asked for. Anything else refuses, nothing recorded or run. -> null (typed) | { stopId, chooser }
  const relayedBudgetChoice = (choice, label, stopFile) => {
    if (flag('stop-gate', null) === null) return null;
    const sha = stopShaOf(stopFile);
    const stopId = stopIdOf({ kind: 'budget_stop', overseer_round: 1, pass: 1, label, sha: sha ?? undefined });
    const chooser = attributeChoice(stopId, choice);
    if (chooser?.gate && (limitApprovedAfterGate(runDir, chooser.gate) || !gateQuoteNamesHash(runDir, chooser.gate, sha))) { console.error(`--stop-gate ${String(chooser.gate).slice(0, 40)}: that answer was not given for exactly this spending stop (its quote names another stop file), or a spending limit was approved after it was given, or the record cannot be read, so the answer does not apply. Nothing was recorded, run or spent.`); process.exit(2); }   // A-DRAFT (LAD-R9)
    return { stopId, chooser };
  };
  // 0.8.4 (Q9, the person's yes of 10 Nov 2026): a choice RELAYED by the handling session at a found-secret pause names the answered stop_decision gate that holds the person's words (--stop-gate <id>). It is taken only if the gate is this run's answered, person-only gate for THIS pause (its id is the pause record's own, the stage plus the hash of the exact prompt) and
  // THIS choice, answered on the session channel with the person's words, relayed, not closed, read within its ten minutes: the ledger is the only authority, never run.json. A choice typed with no gate is the terminal's, as before; a gate that does not match exits 2 with nothing recorded, run or sent.
  const relayedSecretChoice = (choice, pause) => {
    const named = flag('stop-gate', null);
    if (named === null) return null;
    const stopId = secretGateStopId(pause);
    const a = typeof named === 'string' ? stopDecisionAnswerOf(runDir, stopId, choice, { gate: named }) : null;
    if (!a || a.relayed !== true || !relayedSecretAnswerOf(runDir, a.gate, stopId, choice, a.person_words)) { console.error(`--stop-gate ${typeof named === 'string' ? named.slice(0, 40) : ''}: no answered, person-only stop_decision gate of this run by that name matches this credential-shaped pause (${stopId}) and this choice (${choice}), relayed with the person's words, within ten minutes of its answer. Nothing was recorded, run or sent.`); process.exit(2); }   // A-DRAFT (LAD-Q9-5)
    stopGateNamed = named;
    return { gate: a.gate, personWords: a.person_words, at: a.at };
  };
  const recordedFinishRelayed = f => !!(f && f.relayed === true && typeof f.stop === 'string' && relayedSecretAnswerOf(runDir, f.stop_gate, `secret_pause:${f.stop}`, f.choice, typeof f.person_words === 'string' ? f.person_words : null));   // the mark `relayed` on a RECORDED finish is believed only when the ledger holds that answer (never run.json alone)
  const relayedFields = rel => (rel ? { via: 'session', relayed: true, stop_gate: rel.gate, person_words: rel.personWords } : { via: 'cli' });   // what the run.json entry of a choice says about who gave it: the ledger's gate is the authority, this only names it
  const relayedTail9 = rel => (rel ? ' (the person\'s choice in their own words, relayed by the handling session)' : '');   // A-DRAFT (LAD-Q9-2)
  const secretPausedNow = resumeMeta && existsSync(join(runDir, SECRET_MARKER_FILE));   // paused at a credential-shaped string
  if (wantFinishNow && !roundMarker && !ownerPauseMarker && !budgetStopFile && !secretPausedNow) { console.error('--finish-now answers a run stopped at a round limit, a layer\'s limit, a stall or a silent seat, at the owner\'s pause, at the spending limit or at a credential-shaped string, and this run is not stopped at one. Nothing was recorded, run or spent.'); process.exit(2); }   // A-DRAFT (WORDING LAD-R30: the interim sentence listed only the round stops)
  // 0.8.4 D38 (WORDING D38-w8, A-DRAFT): --drop-excerpt answers only a pause at an excerpt; it is its own choice.
  if (wantDrop && (wantContinue || wantFinish || allowSecretShapedFlag)) { console.error('--drop-excerpt is its own choice: give it alone. Nothing was run and nothing was spent.'); process.exit(2); }
  if (wantDrop && !resumeMeta) { console.error('--drop-excerpt answers a run paused at an excerpt: use it with --resume <run folder>. Nothing was run and nothing was spent.'); process.exit(2); }
  if (wantDrop && roundMarker) { console.error('--drop-excerpt: this run is stopped at a round limit, not paused at an excerpt. Nothing was run and nothing was spent.'); process.exit(2); }
  if (roundMarker) {
    const stop = (() => { try { return JSON.parse(readFileSync(join(runDir, PARTIAL_REPORT_FILE), 'utf8')).stop ?? null; } catch { return null; } })();
    const id = stop ? stopIdOf(stop) : null;
    // 0.8.4 S5 (A-DRAFT, C&C's rule): at a stall --continue is refused only when no pass is left (nothing recorded, run or spent); --finish and revising outside the Council stay.
    if (wantContinue && stop && !stopOffersContinue(stop)) { console.error('--continue: no pass is left, so the run cannot go on. Give --finish to end the run here, or revise the draft yourself outside the Council. Nothing was recorded, run or spent.'); process.exit(2); }
    // a member goes on from an entry only when the TREE RECORD holds the person's choice for this stop (run.json is project-writable text: an entry alone never spends)
    const entryStands = !!(id && roundChoices.some(c => c.stop === id)) && (!treeLineage || recordedChoiceFor(join(dirname(resolve(resumeRun)), treeLineage.treeId), treeLineage, id, roundChoices.find(c => c.stop === id)?.choice));
    // Review fix F7 (18 Okt 2026, C&C ruling b): a stop that cannot be read from report-partial.json (missing or damaged) cannot be matched to a choice. A typed choice is REFUSED (nothing recorded, run or spent) instead of being dropped silently; a resume
    // WITHOUT a choice does not stop at the sentence below but goes on to the replay, which costs nothing (stages on disk) and re-stops at the same place, rewriting the partial files; then the choice works. A readable partial keeps its exit 23, and so does a tree MEMBER whatever the file says (a member goes on only from the tree record's choice; run.json alone never spends, so an unreadable partial must not let a stale run.json entry reach the replay).
    if (!wantContinue && !wantFinish && !entryStands && (stop || memberNotice)) { console.error(roundMarker.data?.reason ?? `This run is stopped ${roundStopPhraseOf(stop)}, and waits for your choice: ${stop && !stopOffersContinue(stop) ? '--finish. No pass is left, so there is no --continue' : '--continue or --finish'}.`); process.exit(EXIT_ROUND_STOPPED); }
    // A tree MEMBER is continued or finished only through its tree (a verb that is owed, a separate unit): a direct choice writes nothing into its record.
    if ((wantContinue || wantFinish) && memberNotice) { console.error(stopSentence(stop ?? { kind: roundMarker.stoppedBy }, { memberTail: memberStopContinue({ ...memberNotice, stop }, 'round_stop') })); process.exit(2); }
    // 0.8.4 S16 (D; WORDING S16-w33c): a pause with no handling session names nobody to choose: a typed choice is refused (nothing recorded, run or spent)
    if ((wantContinue || wantFinish) && stop?.no_chooser === true) { console.error(`${wantFinishNow ? '--finish-now' : '--continue / --finish'}: this run is paused with no handling session, so nobody is named to choose here. Nothing was run and nothing was spent.`); process.exit(2); }
    if ((wantContinue || wantFinish) && !id) { console.error(`--continue / --finish: ${join(runDir, PARTIAL_REPORT_FILE)} cannot be read (missing or damaged), so your choice cannot be matched to the stop it answers. Nothing was recorded, run or spent. Run \`${councilCommand()} --resume ${runDir}\` once without a choice: it rebuilds that file from the stages already on disk (a stage you removed is asked of its seat again, within your limit). Then give your choice.`); process.exit(2); }
    if ((wantContinue || wantFinish) && id) {
      const choice = wantFinishNow ? 'finish_now' : wantFinish ? 'finish' : 'continue';
      // 0.8.4 D5a (T4.2): the entry says who chose, how and when (additive fields). When the handling session answered a stop_decision gate for THIS stop with THIS choice (the MCP tool stop_decide, then this resume), the hash-chained
      // ledger is the authority and the entry takes actor, channel, time, reason and the advisor state from it, with the gate's id. Any other choice is a CLI choice (actor unknown: the CLI cannot tell a person from an agent with a shell).
      // 0.8.4 (C&C 10 Nov): the entry is attributed to a gate ONLY when the command line names it (`--stop-gate <id>`, which the MCP tool passes for every answer it carries, the session's own and the relayed ones). A choice typed with no gate is a CLI choice, whatever answered gates the ledger holds for this stop.
      // A named gate must be this run's answered stop_decision gate for exactly this stop and this choice, read within its ten minutes, and its number (a relayed continue's new limit) must be the one on the command line, if any: otherwise nothing is recorded, run or spent. The number reaches the run from the gate alone.
      const chooser = attributeChoice(id, choice);
      const entry = roundChoiceEntry(stop, choice, config);
      roundChoices = [...roundChoices.filter(c => c.stop !== id), { ...(choice === 'continue' && ladderEff && ladderRoundsTyped !== null && stop.kind === 'overseer_cap' ? { ...entry, add: 0 } : entry), ...chooser }];   // a --rounds typed with the continue is the TOTAL of top-layer reads: the continue answers the stop and adds nothing
      pendingChoices.roundChoices = roundChoices; // CR-1E-006: held in memory; flushChoices() writes it after the last refusal of the start
    }
  } else if (resumeMeta && existsSync(join(runDir, SECRET_MARKER_FILE)) && wantFinishNow) {
    // 0.8.4 (ladder unit, step 3; C&C 10 Nov: terminal-typed only, a relay waits for the owner): --finish-now at a PAUSED run ends it at once, in THIS command, NOT agreed: the loop ends at the paused stage (nothing of it is sent), no judge is asked again (a final read already on disk replays and counts as read;
    // one that is not on disk is not made), and the value the pause found is NOT added to the allowed list - a prompt of the ending that still holds it pauses AGAIN, and only the person's --continue at that screen lets it go. The choice is recorded (run.json `secretFinish`, choice finish_now) so that --continue there goes on with the ending.
    // Sits BEFORE the plain --finish branch: wantFinish is true for --finish-now too, and without this the command would fall into the plain finish and record the wrong choice.
    if (allowSecretShapedFlag) { console.error('--finish-now and --allow-secret-shaped are two different choices: give one. Nothing was run and nothing was spent.'); process.exit(2); }
    if (memberNotice) { console.error(memberStopContinue(memberNotice, 'secret')); process.exit(2); }
    const pause = readSecretStop(runDir);
    if (!pause || !pause.phase) { console.error(`--finish-now: the pause record (${SECRET_STOP_FILE}) is missing, cannot be read or does not say where in the run the pause came, so your choice cannot be matched to the stage it answers. Run \`${councilCommand()} --resume ${runDir}\` once without a choice: it pauses again at the same place and writes the record. Then give --finish-now. Nothing was run or sent.`); process.exit(2); }
    if (pause.phase === 'before') { console.error('--finish-now: this pause came before the review rounds began, so there is no review to end. Give --continue, or leave the run paused. Nothing was recorded, run or sent.'); process.exit(2); }
    const rel = relayedSecretChoice('finish_now', pause);   // 0.8.4 (Q9)
    secretFinishRelayed = !!rel;
    if (pause.phase === 'after') {   // 0.8.4 (parity batch, C&C 10 Nov): there is no loop to end here, but the person can still end the run AT the pause: no further paid call, no judge, and no prompt that holds the found value is sent (a call whose prompt holds it is not made; it does not pause again). The verdict stays what the review rounds reached.
      pendingChoices.secretFinish = { choice: 'finish_now', label: pause.label, stop: pause.stop, at: new Date().toISOString(), ...relayedFields(rel), phase: 'after' };
      secretEndsAtPause = true;
      flushNotes.push(`  stage "${pause.label}": you chose --finish-now at the pause after the review rounds${relayedTail9(rel)}: no further call that bills is made, no judge is asked again, and no prompt that holds the credential-shaped value(s) it found is sent (the run goes on to its end without that stage; the verdict stays what the rounds reached).`);   // A-DRAFT (WORDING LAD-R41)
    } else {
    pendingChoices.secretFinish = { choice: 'finish_now', label: pause.label, stop: pause.stop, at: new Date().toISOString(), ...relayedFields(rel), phase: 'loop' };
    secretFinishArmed = true; secretFinishAtOnce = true;
    flushNotes.push(`  stage "${pause.label}": you chose --finish-now${relayedTail9(rel)}: it is not sent, the run ends here at once, NOT agreed, and no judge is asked again. The credential-shaped value(s) it found are NOT allowed: a later stage whose prompt holds one pauses the run again.`);   // A-DRAFT (WORDING LAD-R31)
    }
  } else if (resumeMeta && existsSync(join(runDir, SECRET_MARKER_FILE)) && wantFinish) {
    // --finish at a PAUSED run (F-C, 0.8.4): it only RECORDS the person's choice (run.json `secretFinish`, through pendingChoices: CR-1E-006) and the command ends at exit 11, still paused, before any sitting work.
    // Nothing is sent. The ending happens on the person's --continue: the loop ends at the paused stage and the ordinary not-agreed ending runs (chain.js, the catch of the two pass loops).
    if (allowSecretShapedFlag) { console.error('--finish and --allow-secret-shaped are two different choices: give one. Nothing was run and nothing was spent.'); process.exit(2); }
    if (memberNotice) { console.error(memberStopContinue(memberNotice, 'secret')); process.exit(2); }
    const pause = readSecretStop(runDir);
    if (!pause || !pause.phase) { console.error(`--finish: the pause record (${SECRET_STOP_FILE}) is missing, cannot be read or does not say where in the run the pause came, so your choice cannot be matched to the stage it answers. Run \`${councilCommand()} --resume ${runDir}\` once without a choice: it pauses again at the same place and writes the record. Then give --finish. Nothing was run or sent.`); process.exit(2); }
    if (pause.phase === 'before') { console.error('--finish: this pause came before the review rounds began, so there is no review to end. Give --continue, or leave the run paused. Nothing was recorded, run or sent.'); process.exit(2); }
    if (pause.phase === 'after') { console.error('--finish: this pause came after the review rounds, so the run is already ending. Give --continue, or leave the run paused. Nothing was recorded, run or sent.'); process.exit(2); }
    const rel = relayedSecretChoice('finish', pause);   // 0.8.4 (Q9)
    pendingChoices.secretFinish = { choice: 'finish', label: pause.label, stop: pause.stop, at: new Date().toISOString(), ...relayedFields(rel) };
    secretFinishOnly = pause.label;
    if (rel) flushNotes.push(`  stage "${pause.label}": you chose --finish${relayedTail9(rel)}: it is recorded and nothing is sent; the run stays paused until --continue.`);   // A-DRAFT (LAD-Q9-2)
  } else if (resumeMeta && existsSync(join(runDir, SECRET_MARKER_FILE)) && wantDrop) {
    // 0.8.4 D38 (C&C 09 Nov 2026, Muad's yes to a drop route; WORDING D38-w8): beside --continue, on exactly its channel (a command typed at a terminal). The excerpt is not recorded with its text and no seat is shown it: the stop label is added to
    // run.json `secretDrops` (a list: one resume can need several), and the resume's processing (src/excerpt-resume.js) writes ONE `withheld` line for it. The value is NOT added to the allowed list.
    if (memberNotice) { console.error(memberStopContinue(memberNotice, 'secret')); process.exit(2); }
    const pause = readSecretStop(runDir);
    if (!pause) { console.error(`--drop-excerpt: the pause record (${SECRET_STOP_FILE}) is missing or cannot be read, so your choice cannot be matched to the text it answers. Run \`${councilCommand()} --resume ${runDir}\` once without a choice: it pauses again at the same place and writes the record. Then give --drop-excerpt. Nothing was run or sent.`); process.exit(2); }
    if (!isExcerptLabel(pause.label)) { console.error(`--drop-excerpt answers a pause at an excerpt, and this run is paused at stage "${pause.label}". Give --continue to send it as it is, or leave the run paused. Nothing was run or sent.`); process.exit(2); }
    const earlierDrops = Array.isArray(resumeMeta.secretDrops) ? resumeMeta.secretDrops.filter(d => d && d.label !== pause.label) : [];
    const rel = relayedSecretChoice('drop', pause);   // 0.8.4 (Q9)
    pendingChoices.secretDrops = [...earlierDrops, { choice: 'drop', label: pause.label, stop: pause.stop, at: new Date().toISOString(), ...relayedFields(rel) }];
    flushNotes.push(`  excerpt "${pause.label}": you chose to leave it out${relayedTail9(rel)}; it is recorded as withheld and the run goes on without it.`);
  } else if (resumeMeta && existsSync(join(runDir, SECRET_MARKER_FILE)) && (wantContinue || (flagAnswersPause && !wantFinish))) {
    // A run PAUSED at a credential-shaped prompt (src/secret-pause.js). Not a round stop: no cause is added to stop-files.js, so the handling session's stop_decide, the gate and a tree resume never see it (E3: the
    // answer is the person's). `--continue` and `--allow-secret-shaped` on a resume are ONE choice: they add the values the pause found to the run's allowed list (run.json `secretAllow`, flushed after the last refusal
    // of the start, CR-1E-006). The stage that threw has no <label>.md, so this resume re-runs it; this block runs before any stage, and the allowed list is read by that stage's send, so the consent reaches exactly
    // the prompts that hold those values and no other value.
    if (wantContinue && allowSecretShapedFlag) { console.error('--continue and --allow-secret-shaped are the same choice: give one. Nothing was run and nothing was spent.'); process.exit(2); }
    if (memberNotice) { console.error(memberStopContinue(memberNotice, 'secret')); process.exit(2); }
    const pause = readSecretStop(runDir);
    if (!pause) { console.error(`--continue: the pause record (${SECRET_STOP_FILE}) is missing or cannot be read, so your choice cannot be matched to the text it answers. Run \`${councilCommand()} --resume ${runDir}\` once without a choice: it pauses again at the same place and writes the record. Then give --continue. Nothing was run or sent.`); process.exit(2); }
    const finishState = secretFinishState(resumeMeta, pause);
    if (finishState === 'bad') { console.error('--continue: the finish recorded in run.json (secretFinish) is unreadable or names another stage than this pause, so it cannot be matched. Nothing was run or sent. Give --finish again to record it, or remove the secretFinish entry to go on with the review.'); process.exit(2); }
    const rel = relayedSecretChoice('continue', pause);   // 0.8.4 (Q9): the person's continue, relayed: it allows the value(s), so the ledger's answer and the person's words are the record, named here and in run.json `relayedSecretChoices`
    for (const h of pause.values) secretAllow.hashes.add(h);
    secretAllowDirty = true;
    if (rel) pendingChoices.relayedSecretChoices = [...(Array.isArray(resumeMeta.relayedSecretChoices) ? resumeMeta.relayedSecretChoices : []), { choice: 'continue', label: pause.label, stop: pause.stop, at: new Date().toISOString(), ...relayedFields(rel) }];
    secretFinishArmed = finishState === 'finish' || finishState === 'finish_now';
    secretFinishAtOnce = finishState === 'finish_now';   // the recorded --finish-now: the ending it started goes on, still at once
    secretFinishRelayed = secretFinishArmed && recordedFinishRelayed(resumeMeta.secretFinish);
    flushNotes.push(`  stage "${pause.label}": you allowed the credential-shaped value(s) it found (${pause.values.length})${relayedTail9(rel)}; ${secretFinishArmed ? `the run ends here${secretFinishAtOnce ? ' at once' : ''}, NOT agreed, as you chose with ${secretFinishAtOnce ? '--finish-now' : '--finish'}${secretFinishRelayed ? relayedTail9(true) : ''}` : 'the run goes on'}.`);
  } else if (resumeMeta && wantFinishNow && !wantContinue && budgetStopFile && !roundMarker && !ownerPauseMarker) {
    // 0.8.4 (ladder unit, C&C 10 Nov 2026; his "may finish at any stop ... does not ask"): --finish-now at a SPENDING stop ends the run in THIS command, with no raise and no limit screen. It records nothing in run.json: a plain resume still meets the limit gate. The sitting makes no
    // call that bills (chain.js NotRunForLimit), asks no judge again, and names every call it did not make (report.json stages_not_run). It sits BEFORE the plain --finish branch below: wantFinish is true for both flags, and a typed --finish-now must never land in the --finish branch.
    const stopFile = (() => { try { return JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } })();
    // a --max-usd beside it is the person's raise only above the limit the run stopped at (the MCP's resume adds its own ceiling at or below it: server.js ceilingArgs); the same rule as the record path below
    const maxFlag = argv.includes('--max-usd') ? Number(argv[argv.indexOf('--max-usd') + 1]) : null;
    const flagRaises = maxFlag !== null && !(Number.isFinite(maxFlag) && Number.isFinite(stopFile?.capUsd) && maxFlag <= stopFile.capUsd);
    const d = spendFinishNowDecision({ stop: stopFile, member: !!memberNotice || !!treeLineage, maxUsdGiven: flagRaises, runDir });
    if (d.refusal) { console.error(d.refusal); process.exit(2); }
    const rb = relayedBudgetChoice('finish_now', d.label, stopFile);
    budgetFinishNow = { phase: d.phase, label: d.label, capName: d.capName, stopSha: stopShaOf(stopFile), stopId: rb?.stopId ?? null, recorded: false, ...(rb?.chooser?.relayed === true ? { relayed: { personWords: rb.chooser.person_words, gate: rb.chooser.gate } } : {}) };
  } else if (resumeMeta && wantFinish && !wantFinishNow && !wantContinue && finalReadOn(config) && existsSync(join(runDir, 'STOPPED-budget.json'))) {   // WORDING S16-w62j: a chain with no final read falls through to today's refusal below, unchanged
    // 0.8.4 S16 (F; WORDING S16-w62b, w62f, w62g; T9e T21q T21bz): --finish at a SPENDING stop only RECORDS the choice (run.json `budgetFinish`, through pendingChoices) and the command ends at exit 4 right after the run lock: nothing is run, nothing is spent, no gate is asked. The ending happens on the resume after the person's own typed raise.
    const stopFile = (() => { try { return JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } })();
    const maxFlagPlain = argv.includes('--max-usd') ? Number(argv[argv.indexOf('--max-usd') + 1]) : null;   // the MCP's own ceiling (at or below the limit the run stopped at) is not a new limit
    const plainFlagRaises = maxFlagPlain !== null && !(Number.isFinite(maxFlagPlain) && Number.isFinite(stopFile?.capUsd) && maxFlagPlain <= stopFile.capUsd);
    const d = spendFinishDecision({ stop: stopFile, member: !!memberNotice, maxUsdGiven: plainFlagRaises, runDir });
    if (d.refusal) { console.error(d.refusal); process.exit(2); }
    const rb = relayedBudgetChoice('finish', d.record.label, stopFile);
    const relayedWords = rb?.chooser?.relayed === true ? { personWords: rb.chooser.person_words, gate: rb.chooser.gate } : null;
    pendingChoices.budgetFinish = { choice: 'finish', label: d.record.label, at: new Date().toISOString(), via: relayedWords ? 'session' : 'cli', ...(relayedWords ? { relayed: true } : {}), ...(d.record.cap_name ? { cap_name: d.record.cap_name } : {}) };   // run.json keeps the mechanics (and a display mark); the AUTHORITY for who chose and in which order is the ledger line written below
    budgetFinishOnly = { ...d.record, stopSha: stopShaOf(stopFile), stopId: rb?.stopId ?? null, relayed: relayedWords };
  } else if (resumeMeta && wantContinue && !wantFinish && budgetStopFile && !roundMarker && !ownerPauseMarker) {
    // 0.8.4 (ladder unit, unit-end item ii; C&C 10 Nov): THE WAY BACK BY A WORD. At a spending stop with a finish of the person's on record (plain or now), a later typed --continue (or the relayed one, with the person's words) sets that finish aside: the rounds go on, the latest choice decides, and the record shows both in order (budget_finish lines: finish, then continue).
    // It raises nothing: the limit is the person's own number, typed with --max-usd or at the limit screen as for any raise. Beside a found-secret pause this is never reached (the pause is answered first, at the terminal).
    const stopFile = (() => { try { return JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } })();
    if (memberNotice || treeLineage) { console.error('--continue: a tree member\'s spending stop is raised through its tree, not answered here. Nothing was recorded, run or spent.'); process.exit(2); }   // A-DRAFT (LAD-R35)
    if (!stopFile || typeof stopFile.stoppedAt !== 'string' || !(stopFile.phase === 'loop' || stopFile.phase === 'after')) { console.error(`--continue: the stop file (STOPPED-budget.json) cannot be read or does not say where in the run the limit stopped it. Nothing was recorded, run or spent.`); process.exit(2); }
    if (!budgetFinishStandsForContinue(runDir)) { console.error('--continue: this run is stopped at its spending limit and no finish of yours is on record, so there is nothing to go on past. To go on, raise the limit (--max-usd, or --raise-cap); to end the run here instead, give --finish-now. Nothing was recorded, run or spent.'); process.exit(2); }   // A-DRAFT (LAD-R35)
    const rb = relayedBudgetChoice('continue', stopFile.stoppedAt, stopFile);
    budgetContinue = { phase: stopFile.phase, label: stopFile.stoppedAt, capName: typeof stopFile.capName === 'string' ? stopFile.capName : null, stopSha: stopShaOf(stopFile), stopId: rb?.stopId ?? null, relayed: rb?.chooser?.relayed === true ? { personWords: rb.chooser.person_words, gate: rb.chooser.gate } : null };
  } else if (wantDrop) {
    console.error(`--drop-excerpt: ${runDir} is not paused at an excerpt, so there is nothing to answer. Nothing was run and nothing was spent.`); process.exit(2);   // WORDING D38-w8
  } else if (resumeMeta && ownerPauseMarker && wantFinish && !wantContinue) {
    // 0.8.4 (ladder unit, C&C 10 Nov; his "all three options should be open"): at the owner's pause the person (typed, or relayed with person_words through --stop-gate) can END the run: --finish (the run ends NOT agreed, the closing steps run and a layered chain's final read runs first) or --finish-now
    // (no judge reads the plan again). It is recorded as a roundChoices entry for the pause's own stop id; the chain consumes it at the head of the pass the pause stopped before, BEFORE the pause check (src/chain.js ownerPauseFinishAt). A plain --resume still continues the pause.
    const pauseStop = (() => { try { return JSON.parse(readFileSync(join(runDir, PARTIAL_REPORT_FILE), 'utf8')).stop ?? null; } catch { return null; } })();
    const pauseId = pauseStop && pauseStop.kind === 'owner_pause' && Number.isInteger(pauseStop.pass) && Number.isInteger(pauseStop.overseer_round) ? stopIdOf(pauseStop) : null;
    if (!pauseId) { console.error(`${wantFinishNow ? '--finish-now' : '--finish'}: ${join(runDir, PARTIAL_REPORT_FILE)} cannot be read (missing, damaged or not the pause's own), so your choice cannot be matched to the pause it answers. Nothing was recorded, run or spent.`); process.exit(2); }   // A-DRAFT (LAD-O3)
    const choice = wantFinishNow ? 'finish_now' : 'finish';
    const chooser = attributeChoice(pauseId, choice);
    roundChoices = [...roundChoices.filter(c => c.stop !== pauseId), { ...roundChoiceEntry(pauseStop, choice, config), ...(Number.isInteger(pauseStop.request_seq) ? { request_seq: pauseStop.request_seq } : {}), ...chooser }];
    pendingChoices.roundChoices = roundChoices;   // held in memory; flushChoices() writes it after the last refusal of the start
    ownerPauseFinishing = choice; ownerPauseFinishPass = pauseStop.pass;
  } else if (resumeMeta && ownerPauseMarker && wantContinue) {
    console.error(`--continue: this run is paused on request: a plain council --resume ${runDir} continues it (no --continue is needed), and --finish or --finish-now end it here. Nothing was run and nothing was spent.`); process.exit(2);   // A-DRAFT (LAD-O5)
  } else if (wantContinue || wantFinish) {
    if (budgetStopFile && wantFinish && !wantFinishNow) { console.error('--finish: this run is stopped at its spending limit, and this chain has no final read, so there is no last read to end after. Give --finish-now to end the run here, or raise the limit. Nothing was recorded, run or spent.'); process.exit(2); }   // A-DRAFT (LAD-R35: the sentence below said "not stopped" of a run that is)
    console.error(`--continue / --finish: ${runDir} is not stopped for --continue or --finish, so there is nothing to answer: they answer a run stopped ${roundStopsInWords()}${wantFinish ? '' : ' or paused at a credential-shaped string'}. Nothing was run and nothing was spent.`); process.exit(2);    console.error(`--continue / --finish: ${runDir} is not stopped for --continue or --finish, so there is nothing to answer: they answer a run stopped ${roundStopsInWords()}${wantFinish ? '' : ' or paused at a credential-shaped string'}. Nothing was run and nothing was spent.`); process.exit(2);
  }
  // 0.8.4 (ladder unit, step 3): THE RECORD PATH of a --finish-now at a found-secret pause. The sitting that took the choice may stop again before it ends the run (on a shipped chain a session writes the handoff, exit 3), and the plain resume after that answer carries no marker and no choice;
  // without this the paused stage (still uncached) would be the first loop call again and the rounds would go on. A plain resume (no choice, no drop, no allowed-value flag) of a run whose run.json holds a whole `secretFinish` entry with choice finish_now for a stage that is STILL uncached arms the same finish
  // as the typed command did: the loop ends there (at once for a finish-now; a plain finish ends it the ordinary way and the final read runs), the allowed list is whatever it is (a finish-now added nothing; a plain finish's --continue allowed the value). A planted entry can only end a run early at a stage (the parity list's D4 class); it cannot spend or send anything.
  if (resumeMeta && !treeLineage && !secretFinishArmed && !secretPausedNow && !wantContinue && !wantFinish && !wantDrop && !allowSecretShapedFlag) {   // no marker: the run is not at a pause now (it stopped LATER, at a session's stage); with a marker a plain resume pauses again, as it always did
    const f = resumeMeta.secretFinish;
    if (f && typeof f === 'object' && (f.choice === 'finish_now' || f.choice === 'finish') && typeof f.label === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/.test(f.label) && typeof f.at === 'string' && Number.isFinite(Date.parse(f.at)) && !existsSync(join(runDir, `${f.label}.md`))) {
      secretFinishRelayed = recordedFinishRelayed(f);
      if (f.choice === 'finish_now' && f.phase === 'after') {   // the record of a finish-now at a pause after the rounds: the same sitting again after a session's stage
        secretEndsAtPause = true;
        flushNotes.push(`  you chose --finish-now${secretFinishRelayed ? relayedTail9(true) : ''} at the credential-shaped string in stage "${f.label}", after the review rounds: the run goes on ending here at once; no call that bills is made, no judge is asked again, and no prompt that holds the value is sent.`);   // A-DRAFT (WORDING LAD-R41)
      } else {
        secretFinishArmed = true; secretFinishAtOnce = f.choice === 'finish_now';
        flushNotes.push(`  you chose ${secretFinishAtOnce ? '--finish-now' : '--finish'}${secretFinishRelayed ? relayedTail9(true) : ''} at the credential-shaped string in stage "${f.label}": the run goes on ending here${secretFinishAtOnce ? ' at once' : ''}, NOT agreed${secretFinishAtOnce ? ', and no judge is asked again' : ''}.`);   // A-DRAFT (WORDING LAD-R33)
      }
    }
  }
  // 0.8.4 (ladder unit, C&C 10 Nov: ONE finish-now, given once, ends the run): a resume with NO choice and NO new limit on a run that holds the person's recorded finish-now FOR THIS STOP (the gate ledger, hash-chained; bound by the stop's hash) goes on ending the run in a
  // no-money sitting - this is the resume after a session wrote a stage (a handoff on every shipped chain). It asks for no limit. A command that carries a limit (--max-usd, --raise-cap) or any choice is the person's NEW intent and takes the ordinary path. A planted file cannot make this
  // happen: run.json is never read for it, and a record on the ledger for another stop (a raise changed the stop's figures) does not match.
  if (!budgetFinishNow && resumeMeta && budgetStopFile && !wantContinue && !wantFinish && !wantDrop && !argv.includes('--raise-cap') && !memberNotice && !treeLineage) {
    const stopFile = (() => { try { return JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } })();
    // a limit on a FREE chain (no typed limit gate) typed above the limit the run stopped at is the person's raise; a lower figure is the MCP's own ceiling (server.js ceilingArgs keeps the run's cap or lowers it to COUNCIL_MAX_USD_LIMIT) and is not. On a chain with a typed limit, --max-usd is only a suggestion on the screen and is never a raise by itself; the ledger decides (a limit gate requested after the record).
    const flagUsd = argv.includes('--max-usd') ? Number(argv[argv.indexOf('--max-usd') + 1]) : null;
    const raisedByFlag = flagUsd !== null && !(chainIsPaid(config) || capsArmed.length) && !(Number.isFinite(flagUsd) && Number.isFinite(stopFile?.capUsd) && flagUsd <= stopFile.capUsd);
    const sha = stopShaOf(stopFile);
    const rec = sha && !raisedByFlag ? budgetFinishRecordFor(runDir, sha) : null;
    if (rec) { const d = spendFinishNowDecision({ stop: stopFile, runDir }); if (d.ok) budgetFinishNow = { phase: d.phase, label: d.label, capName: d.capName, stopSha: sha, recorded: true, relayedMark: rec.relayed === true }; }
  }
}
{
  // 0.8.4 S16 (F; WORDING S16-w66, w62g): a resume of a run whose run.json holds the person's finish at a spending stop carries it into this sitting: the loop ends at the first call that misses the cache inside the review rounds (chain.js SpendFinish). Only the SHAPE of the entry is checked (a later stop at the final read rewrites STOPPED-budget.json). A tree member is never given one.
  const state = !treeLineage && resumeMeta && !budgetFinishOnly && !budgetFinishNow && !budgetContinue && finalReadOn(config) ? spendFinishState(resumeMeta) : 'none';   // a chain with no final read ignores the entry, as before F
  if (state === 'bad') { console.error(SPEND_FINISH_BAD); process.exit(2); }
  // 0.8.4 (C&C 10 Nov, ruled): the ending after the raise is armed from the LEDGER's budget_finish line (choice finish, the person's latest choice at THIS stop, bound by the hash of the stop file), never from run.json alone: a planted run.json entry must not end a run the person only raised. A run.json entry the ledger does not hold (a folder from before the ledger record) is NOT applied, and the sitting says so.
  if (!treeLineage && resumeMeta && !budgetFinishOnly && !budgetFinishNow && !budgetContinue && finalReadOn(config)) {   // NO stop-file condition: after the armed sitting ended the loop the run may stop at something that is not a spending stop (a session's handoff, a final-read stop, a pause), and the next resume must still end the rounds at the stage chosen
    const stopFile = existsSync(join(runDir, 'STOPPED-budget.json')) ? (() => { try { return JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } })() : null;   // only to word the notes
    // armed by the RUN's governing plain finish (the latest budget_finish line, if it is a plain finish), not by this stop's hash: after a raise too small for what follows the run stops AGAIN at another stop (another hash, inside the rounds or after them) and the next raise must still end the rounds at the stage the person chose to end them
    const st = budgetPlainFinishRunState(runDir);
    // an approval record that cannot be read never falls through to an unarmed raise that would run the rounds the person may have chosen to end: it refuses, nothing run or spent
    if (!st.ok && (state === 'finish' || stopFile)) { console.error('--resume: the approval record of this run cannot be read, so it cannot be told whether you chose to end the review rounds. Nothing was run or spent.'); process.exit(2); }   // A-DRAFT (LAD-R19)
    const rec = st.rec;
    // BOTH are needed to end the rounds: the ledger's plain finish (a planted run.json entry alone ends nothing) AND the run.json entry (the way back that existed before the ledger record: removing the budgetFinish entry takes the finish back and the rounds go on; the sitting says so)
    if (rec && state === 'finish') budgetFinishArmed = { label: rec.label ?? stopFile?.stoppedAt, capName: typeof rec.cap_name === 'string' ? rec.cap_name : (typeof stopFile?.capName === 'string' ? stopFile.capName : null), relayed: rec.relayed === true };
    else if (rec) budgetFinishWithdrawn = true;
    else if (st.continued) budgetFinishContinued = true;   // the person's latest choice is the way back (a --continue after the finish): the rounds go on, and nothing is armed
    else if (state === 'finish') budgetFinishUnrecorded = stopFile?.phase === 'loop' ? 'loop' : stopFile ? 'after' : 'none';
  }
}
if (budgetFinishArmed) setSpendFinish({ capName: budgetFinishArmed.capName, relayed: budgetFinishArmed.relayed });
if (budgetFinishNow) { setSpendFinish({ capName: budgetFinishNow.capName, atOnce: true, relayed: Boolean(budgetFinishNow.relayed) || budgetFinishNow.relayedMark === true }); setNoMoneySitting(true); }   // 0.8.4: the stopped run's own saved ceiling (run.json maxUsd) stays armed where there is one, as a second wall behind invoke()'s own stop of every call that would bill (NotRunForLimit); under the per-provider caps no limit is typed in this command, so none is armed there
if (secretAllowDirty && !treeLineage) pendingChoices.secretAllow = { key: secretAllow.key, hashes: [...secretAllow.hashes] };   // flushed with the other choices, after the last refusal of the start
if (secretFinishArmed) setOutboundScan({ allow: false, allowed: secretAllow, finish: true, atOnce: secretFinishAtOnce, relayed: secretFinishRelayed });
if (secretFinishAtOnce) setJudgeReplayOnly(true);   // no judge is asked again: a final read on disk replays, one that is not is not made (chain.js)   // the first call of this sitting that misses the cache inside a pass loop is the paused stage: chain.js ends the loop there
if (secretEndsAtPause) { setNoMoneySitting(true); setOutboundScan({ allow: false, allowed: secretAllow, finish: false, atOnce: true, endsOnSecret: true, relayed: secretFinishRelayed }); }   // a finish-now at a pause after the rounds: no call that bills, no judge, and no prompt that holds the value is sent
// A3a commit 2 (18 Okt 2026; src/price-refused.js, gate note A3a_Refusal_Pause_Gate_Note.md): a run that STOPPED at exit 24 (STOPPED-price_refused.json, report-partial.json `stop`) waits for the person. A plain --resume goes on
// (after a pricing.user.json row, or a newer table) and re-asks only the refused stage. --skip-seat records the person's choice to do without that seat for the REST of the run: run.json `seatChoices` { seat, choice: 'skip', via: 'cli', at, label },
// applied from the refused stage on in every replay (src/chain.js skipChosen; the stage's own catch counts the seat as unreachable). It is refused, with nothing run, where the stage cannot do without the seat or is not stopped this way.
// CR-1B-002: the skip starts at the stage that was refused (the call label of that seat's own refusal), so the stages it already finished replay from disk and stay counted. A stop record from before `labels` names one label for the whole stop: it is only that seat's own when the stop names one seat; else no label is recorded and the skip starts at the beginning, as it did.
const skipLabelOf = (stop, i) => (Array.isArray(stop.labels) && typeof stop.labels[i] === 'string' ? stop.labels[i] : stop.seatKeys.length === 1 && typeof stop.label === 'string' ? stop.label : null);
let seatChoices = Array.isArray(resumeMeta?.seatChoices) ? resumeMeta.seatChoices : [];
if (treeLineage) seatChoices = [];   // D-013: nothing writes a seat choice for a tree member (--skip-seat is refused for one, below), so an entry in a member's run.json is forged: it must not drop a seat
{
  const wantSkip = argv.includes('--skip-seat');
  if (wantSkip && !resumeMeta) { console.error('--skip-seat answers a stopped run: use it with --resume <run folder>. Nothing was run and nothing was spent.'); process.exit(2); }
  if (wantSkip) {
    const marker = readStoppedMarker(runDir);
    const stop = (() => { try { return JSON.parse(readFileSync(join(runDir, PARTIAL_REPORT_FILE), 'utf8')).stop ?? null; } catch { return null; } })();
    if (marker?.stoppedBy !== 'price_refused' || !stop || stop.kind !== 'price_refused') { console.error(`--skip-seat: ${runDir} is not stopped because a seat was refused at its price limit, so there is nothing to skip. Nothing was run and nothing was spent.`); process.exit(2); }
    if (memberNotice) { console.error(`--skip-seat: ${runDir} is a member of a tree; a seat is not skipped from a tree member in 0.8.3. Fix the price (pricing.user.json) and run \`council tree resume\`. Nothing was run and nothing was spent.`); process.exit(2); }
    if (!stop.skippable || !Array.isArray(stop.seatKeys) || !stop.seatKeys.length) { console.error(`--skip-seat: ${stop.seat} cannot be skipped here: its stage (${stop.label}) cannot do without it (${stop.noSkip ?? 'no seat to spare'}). Add its price to pricing.user.json and resume. Nothing was run and nothing was spent.`); process.exit(2); }
    seatChoices = [...seatChoices.filter(c => !stop.seatKeys.includes(c.seat)), ...stop.seatKeys.map((k, i) => ({ seat: k, choice: 'skip', via: 'cli', at: new Date().toISOString(), ...(skipLabelOf(stop, i) ? { label: skipLabelOf(stop, i) } : {}) }))];   // `via`, not `by`: the CLI cannot tell a person from an agent with a shell, so no actor is claimed (like roundChoices)
    pendingChoices.seatChoices = seatChoices;   // CR-1E-006: held in memory; flushChoices() writes it after the last refusal of the start
  }
  setSeatSkips(seatChoices);
}
// E4b unit 3 (gate note m7/A_E4b_Unit3_Gate_Note.md): a run that STOPPED at exit 25 (STOPPED-conflict.json, report-partial.json `stop`) waits for the person's choice. `--prevail n=<objection id>|neither[,...]` records it in run.json
// `conflictChoices` { pass, n, prevail, via: 'cli', at } (the channel, no actor: the CLI cannot tell a person from an agent with a shell, as for --skip-seat); the replay applies it. A PLAIN resume of such a run asks nothing and spends nothing:
// it says again that the run waits and exits 25. A choice can only pick between the conflict's own objections or "neither", so run.json (project-writable) can never make it spend.
let conflictChoices = Array.isArray(resumeMeta?.conflictChoices) ? resumeMeta.conflictChoices : [];
// a tree MEMBER applies only the entries its TREE RECORD backs (a node_choice prevail event for this node and stop): run.json is project-writable text, so an entry alone never starts a paid resume and never writes a pick nobody made
if (treeLineage) conflictChoices = backedConflictChoices(join(dirname(resolve(resumeRun ?? '.')), treeLineage.treeId), treeLineage, conflictChoices);
{
  const prevailArg = flag('prevail', undefined);
  if (prevailArg !== undefined && !resumeMeta) { console.error('--prevail answers a stopped run: use it with --resume <run folder>. Nothing was run and nothing was spent.'); process.exit(2); }
  const marker = resumeMeta ? readStoppedMarker(runDir) : null;
  const conflictMarker = marker?.stoppedBy === 'conflict' ? marker : null;
  const stop = conflictMarker ? (() => { try { return JSON.parse(readFileSync(join(runDir, PARTIAL_REPORT_FILE), 'utf8')).stop ?? null; } catch { return null; } })() : null;
  if (prevailArg !== undefined && memberNotice) { console.error(`--prevail: ${runDir} is a member of a tree; its pick is given through the tree: ${memberPrevailCommand(memberNotice)}. Nothing was run and nothing was spent.`); process.exit(2); }
  if (prevailArg !== undefined) {
    if (!conflictMarker || !stop || stop.kind !== 'conflict') { console.error(`--prevail: ${runDir} is not stopped because the decider asked for a choice, so there is nothing to answer. Nothing was run and nothing was spent.`); process.exit(2); }
    const parsed = parsePrevail(prevailArg === true ? '' : prevailArg, stop);
    if (!parsed.ok) { console.error(`--prevail: ${parsed.why}. Nothing was run and nothing was spent.`); process.exit(2); }
    conflictChoices = [...conflictChoices.filter(c => !(c.pass === stop.pass && parsed.picks.some(p => p.n === c.n))), ...parsed.picks.map(p => ({ pass: stop.pass, n: p.n, prevail: p.prevail, via: 'cli', at: new Date().toISOString() }))];
    pendingChoices.conflictChoices = conflictChoices;   // CR-1E-006: held in memory; flushChoices() writes it after the last refusal of the start
  } else if (conflictMarker && stop?.kind === 'conflict' && !stop.conflicts.every(c => conflictChoices.some(x => x.pass === stop.pass && x.n === c.n))) {
    console.error(conflictMarker.data?.reason ?? 'This run is stopped because the decider asked for your choice: --resume <run folder> --prevail n=<objection id>|neither.');
    process.exit(EXIT_CONFLICT_ASKED);
  }
  setConflictChoices(conflictChoices);
}
// A new run never writes into an existing folder: two runs started in the same millisecond, or a
// reused --run-id, would otherwise share one.
// 0.8.3 M1: the one other exception is the tree's own root run, whose folder already holds `tree/` (the record is started before the root runs) and nothing else. The folder must BE the lineage's tree (its name is the tree id):
// otherwise a run of tree X started with another tree's root id would write run.json into that tree's fresh root before the claim refuses it, and that root could never start ("already a run").
const treeRootFolder = treeLineage?.node === 'R' && runId === treeLineage.treeId && !resumeMeta && existsSync(runDir) && readdirSync(runDir).every(f => f === 'tree');
if (!resumeMeta && !treeRootFolder && existsSync(runDir)) {
  console.error(`\nrun folder ${runDir} already exists; a new run needs a new folder. Nothing was run and nothing was spent.`);
  process.exit(2);
}
if (!treeLineage && chainIsPaid(config)) { refuseNoneOnPaidStart(config); refuseUnreadableUsdLimitOnPaidStart(config); }   // T4c: `--max-usd none` on a PAID start or resume is refused BEFORE any folder, lock or gate (it used to be ignored without a word and the screen asked for a total anyway); a tree member has its own refusal above, a chain with no paid seat keeps the flag
refuseStray();   // T1-1: the last refusal of the main path, after every refusal above (the keys, the cap, the tree, the scans) and before the folder, the lock and the first call
// S20 slice 1 (H2-i; Mini-C&C's ruling G2): the remaining refusals of the raise flags sit HERE, after the stray-word refusal and before the run folder, the lock and run.json are written, so 'Nothing was recorded, run or spent' is true.
// They used to come after run.json was rewritten (and on a start, after a whole new folder was made). The rule is src/raise-flags.js raiseFlagRefusal.
// Unit 4b2: under the per-provider caps (capsArmed) the one run-wide gate gives way to one gate per cap, below.
const capGateApplies = !budgetFinishNow && !capsArmed.length && !treeLineage && chainIsPaid(config);
// Unit 4c1: under the caps a raise is ONE number for ONE cap (C&C, 1 Nov 2026): a run stopped at a cap raises that cap (its stop file names it; no new syntax), an early
// raise names its cap (`--raise-cap <id>`). capsStopCap: the cap the run stopped at; capsRaiseTargets: the caps this sitting asks a raise for besides it.
if (capsArmed.length && resumeMeta) { try { const st = JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8')); if (capsArmed.includes(st?.capName)) capsStopCap = st.capName; } catch { /* no stop file, or not readable: no cap stopped */ } }
capsRaiseTargets = capsArmed.length && argv.includes('--raise-cap') ? [raiseCapId ?? capsStopCap].filter(id => capsArmed.includes(id)) : [];
{
  const bad = raiseFlagRefusal({ argv, resumeMeta, capsArmed, raiseCapId, stopCap: capsStopCap, capGateApplies, capsRaiseUnknownSentence, capsRaiseNameSentence });
  if (bad) { console.error(`${bad} Nothing was recorded, run or spent.`); process.exit(2); }
}
// S20 slice 2, control 1: the request. Every refusal a plain resume makes before the run folder and the lock has been passed, so the flag now RECORDS what the person asked and stops: one `route_requested` line in the gate ledger (the run lock taken for the instant of
// the write, with the refusals re-run under it: src/run-controls.js requestRoute), exit 27, nothing run, nothing spent. It sits BEFORE the lock, the run.json rewrite and every refusal a resume makes after them (a changed task or context, exit 14; blocked artifacts, 9;
// the cap gate): those belong to the resume that follows the handler's decision (Mini-C&C R307, A). It reaches no cap gate, setBudget, invoke or reservation: nothing below this block runs.
if (argv.includes('--next-pass-layer-3')) {
  const wordsGiven = flag('person-words', null);   // R2-tty: given = the handler session relays the person's request (channel session); not given = the person at the terminal (askRoute reads the streams)
  const res = askRoute(runDir, { personWords: wordsGiven === true ? '' : wordsGiven, stdin: process.stdin, stdout: process.stdout, ladder: ladderEff, config });
  if (!res.ok && res.code === 'run_locked') { console.error(`\n${res.message}`); process.exit(EXIT_RUN_LOCKED); }
  if (!res.ok) { console.error(`--next-pass-layer-3: ${res.message} Nothing was recorded, run or spent.`); process.exit(2); }   // A-DRAFT
  console.log(`--next-pass-layer-3: pass ${res.pass}: a request to start the pass at layer 3 is recorded (request ${res.seq}). The run now waits for the handler's decision: council route-decide ${resumeRun} ${res.seq} --route --reason "..." (or --decline). Nothing was run and nothing was spent.`);   // A-DRAFT
  process.exit(EXIT_ROUTE_REQUESTED);
}
mkdirSync(runDir, { recursive: true });
// One process per run folder, before any stage can spend: two resumes of the same run used
// to both pay for every uncached stage, each under its own cap (audit finding 4).
try {
  acquireRunLock(runDir);
} catch (err) {
  if (!(err instanceof RunLockedError)) throw err;
  console.error(`\n${err.message}`);
  process.exit(EXIT_RUN_LOCKED);
}
// 0.8.4 S16 (F; WORDING S16-w62f): --finish at a spending stop records the choice and ends here: before the privacy switch, the advice record, the pause settlement and every gate, so nothing but the entry in run.json is written and nothing is asked or run.
if (budgetFinishOnly) {
  // the person's plain finish goes on the ledger first (a hash-chained `budget_finish` line, choice finish: the authority for who chose, in which order, and whether the command took the answer); run.json keeps the mechanics and a display mark
  { const rec = recordBudgetFinish(runDir, { stopSha256: budgetFinishOnly.stopSha, phase: 'loop', choice: 'finish', stopId: budgetFinishOnly.stopId, relayed: budgetFinishOnly.relayed, label: budgetFinishOnly.label, capName: budgetFinishOnly.cap_name ?? null }); if (!rec.ok) { console.error(`--finish: your choice could not be recorded (${rec.message}). Nothing was run or spent.`); process.exit(2); } }   // A-DRAFT (LAD-B14)
  flushChoices();
  const crit = Array.isArray(config.seats?.critics) ? config.seats.critics.filter(c => c && Number.isInteger(c.layer)) : [];
  const topLayer = crit.length ? Math.max(...crit.map(c => c.layer)) : null;
  console.log(spendFinishAnswer({ label: budgetFinishOnly.label, topLayer, topSeats: crit.filter(c => c.layer === topLayer).length, parts: callGatesOf(config).finalReadParts === true, runDir }));
  process.exit(4);   // still stopped: the stop files stay (clearStopRecords comes later)
}
// 0.8.4 (unit-end item ii): --continue at a spending stop with a finish on record goes on the ledger now (before every gate, so a typed-limit wait that follows still finds it: the plain resume after `gate answer` must not meet the earlier finish again). The command then goes on as an ordinary resume.
if (budgetContinue) {
  const rec = recordBudgetFinish(runDir, { stopSha256: budgetContinue.stopSha, phase: budgetContinue.phase, choice: 'continue', stopId: budgetContinue.stopId, relayed: budgetContinue.relayed, label: budgetContinue.label, capName: budgetContinue.capName });
  if (!rec.ok) { console.error(`--continue: your choice could not be recorded (${rec.message}). Nothing was run or spent.`); process.exit(2); }   // A-DRAFT (LAD-R35)
}
// 0.8.4 D10 (plan A T5.5): a start or a resume that asks for the privacy switch records it first, under the run lock and before any stage can run. A switch that cannot be recorded stops the run: a run the person
// asked to keep private must not go on without the record. Recording it again on a run that already has it adds nothing.
if (excerptSwitchAsked.on) {
  const on = recordExcerptSwitchOn(runDir, { source: excerptSwitchAsked.source });
  if (!on.ok) { console.error(`\nthe privacy switch could not be recorded (${on.code}): ${on.message.replace(/\.?$/, '.')} Nothing was run and nothing was spent.`); process.exit(2); }
}
// 7.x item 5: audit export. `policy.json`'s documented, locked path is the user's own working
// directory (`work`, same resolution root as `.env` above) - a presence check only, item 1's own
// src/policy.js owns parsing that file, never duplicated here. Opt-in via `"audit": true` on a
// chain with no policy.json; inert (no audit.jsonl, no other change to the run folder) for
// everyone else. The writer is created even on resume, so a resumed run's remaining stages are
// still audited - only the stages already replayed from disk (onStage's `s.cached` check below)
// are skipped, same as every other per-stage artifact this callback already writes.
const auditEnabled = shouldEnableAudit({ config, policyPath: join(work, 'policy.json') });
let auditWriter = null;
if (auditEnabled) {
  let hmacKey = null;
  try {
    hmacKey = loadHmacKey({ runDir });
  } catch (err) {
    console.error(`\naudit: ${err.message}`);
    process.exit(EXIT_FATAL);
  }
  if (!hmacKey) console.error('\naudit: no AUDIT_HMAC_KEY or AUDIT_HMAC_KEY_FILE set - audit.jsonl will be written with signature: null on every line (unsigned, still hash-chained).');
  auditWriter = createAuditWriter({ runDir, run: runId, chain: chainNameEff, hmacKey });
}

// v6 item V6-2: one span-tree root per run, not per process - a resumed run keeps the same tree
// rather than starting a second, disconnected one each time it's resumed. Generated fresh only
// when the run has never carried one (a genuinely new run, or an older run.json from before this
// feature existed); once set it is spread forward on every resume below, unchanged.
const rootSpanId = resumeMeta?.rootSpanId || randomUUID();
// A --rounds typed on a LADDER run is the TOTAL of top-layer reads (his word). At a resume the run's reads are counted from its folder: a number at or below them is refused, once, before any call; otherwise the number is stored as the base the recorded continues
// add to, so that base + continues = exactly what he typed (the continue typed with it adds nothing; the ones recorded earlier are replaced).
let ladderRoundsBase = ladderRoundsTyped;
if (resumeMeta && ladderEff && ladderRoundsTyped !== null) {
  const made = topLayerReadsMade(runDir, config);
  if (!limitReachable(ladderRoundsTyped, made)) { if (stopGateNamed) { try { closeStopAnswer(runDir, stopGateNamed, { code: 'number_refused' }); } catch { /* a close that cannot be written leaves the refusal as it is: the answer stays readable for its ten minutes */ } }   // the answer the run did not take is closed: no later --stop-gate consumes it (C&C 10 Nov)
    console.error(`--rounds ${ladderRoundsTyped}: this run has already made ${made} top-layer read${made === 1 ? '' : 's'}, so ${ladderRoundsTyped} is not a limit it can still reach. Type a number above ${made}, or leave --rounds out${readStoppedMarker(runDir) ? ' and answer the stop with --continue (one more read) or --finish (end the run here)' : ''}. Nothing was run and nothing was spent.`); process.exit(2); }   // A-DRAFT (LAD-R1)
  ladderRoundsBase = ladderRoundsTyped - roundChoices.filter(c => c?.choice === 'continue' && c.kind === 'overseer_cap' && Number.isInteger(c.add) && c.add > 0).reduce((n, c) => n + c.add, 0);
}

// E3b: whether this RUN uses the verdict envelope is decided once, here: a fresh run uses it when the Reply identity sentence exists (src/roles.js), a resume uses what run.json recorded at the start (a run started
// before the sentence went live never starts refusing its replayed replies). The flag, not the record on disk, is the authority (gate page section 11.2 path F).
const envelopeFlag = resumeMeta ? resumeMeta.verdict_envelope === true : !!held('verdictEnvelopeSection');
if (!resumeMeta) {
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...(envelopeFlag ? { verdict_envelope: true } : {}), chain: chainNameEff, task: taskFile, cwd: work, label: labelEff, startedAt: runStartedAt, context: contextArg || null, contextHash, fromRun: fromRun ? resolve(fromRun) : null, draft: draftPath || null, ...(criteriaPath ? { criteriaFile: criteriaPath } : {}), rounds: roundsSetting(config), ...(capsArmed.length ? {} : { maxUsd }), taskHash, ...(ladderEff ? { ladder: ladderEff, ...(ladderRoundsTyped !== null ? { ladderRounds: ladderRoundsTyped } : {}) } : {}), pid: process.pid, rootSpanId, ...(treeLineage ? { tree: runTreeField(treeLineage) } : {}), ...(policyChecks ? { policyChecks } : {}), ...(signoffFlag ? { signoff: signoffFlag } : {}), ...(piiGateEff !== null ? { piiGate: { mode: piiGateEff, allow: piiAllowEff } } : {}), ...(claudeRoute !== 'anthropic' ? { claude_route: claudeRoute } : {}), ...(zeroRet.on ? { zero_retention: true } : {}), ...(personaFormDecision.record ? { persona_form: personaFormDecision.form } : {}), ...unfencedMeta, ...secretScanMeta }, null, 2));      // the route is recorded only when it is not the default; zero retention only when it is on: a direct run's run.json is what it always was
} else {
  if (resumeMeta.rounds && !ladderEff) {
    if (roundsTypedOffLadder !== null && roundsTypedOffLadder !== resumeMeta.rounds) console.error(roundsNotUsedLine(roundsTypedOffLadder, resumeMeta.rounds));   // A-DRAFT (LAD-R4)
    setRounds(config, resumeMeta.rounds);
  }   // a ladder run reads no round count of the chain's: its bound is run.json `ladderRounds`
  // v5 item 2: pid is rewritten on every resume - a resumed run is a new process. label and
  // every other field carry forward unchanged via the spread. v6 item V6-2: rootSpanId is
  // likewise carried forward (or set, the first time an older run.json is resumed under this
  // feature) rather than regenerated.
  // A --max-usd named on resume is saved, so the next sitting (the pause hint, MCP
  // submit_stage, resume_run without max_usd) keeps it instead of falling back to the old
  // cap - raised, the run stopped again at the old one; lowered, the next sitting went
  // back past it (audit finding 6).
  // The unfenced-gate waiver is rewritten from the effective values, so a flag given on this resume
  // (a narrower list, or none at all over a saved whole-gate waiver) is what the next sitting reads.
  // CR-1E-006 (same class): the settings typed on THIS command (--max-usd, --pii-gate / --allow-pii, --signoff, --allow-unfenced, --allow-secret-shaped, the policy checks) are what this sitting runs with, so `resumeMeta` carries them in memory; but they reach run.json
  // only through flushChoices(), after the last refusal, so a refused command cannot weaken what the NEXT plain resume reads (a refused `--resume --allow-unfenced` used to leave the waiver behind for the next artifact gate). Only the pid and the span root
  // are written now (run_status needs the pid at once). A waiver saved earlier is replaced at the flush by the effective values, as before.
  const { allowUnfenced: _savedAllow, unfencedAllowList: _savedList, ...resumeRest } = resumeMeta;
  const typedSettings = { ...(ladderTyped ? { ladder: ladderTyped } : {}), ...(ladderRoundsBase !== null && ladderEff ? { ladderRounds: ladderRoundsBase } : {}), ...(ladderAdopted ? { ladder: ladderEff } : {}), ...(argv.includes('--max-usd') ? { maxUsd } : {}), ...(piiGateEff !== null ? { piiGate: { mode: piiGateEff, allow: piiAllowEff } } : {}), ...(policyChecks ? { policyChecks } : {}), ...(signoffFlag ? { signoff: signoffFlag } : {}), ...(claudeRoute !== recordedRouteOf(resumeMeta) ? { claude_route: claudeRoute } : {}), ...(zeroRet.changed ? { zero_retention: zeroRet.on } : {}), ...unfencedMeta, ...secretScanMeta };      // a route the person chose on this resume (an auto decision that differs was stopped above) is what the next sitting reads
  pendingSettings.set = typedSettings; pendingSettings.drop = ['allowUnfenced', 'unfencedAllowList'];
  if (ladderAdopted) flushNotes.push(`This chain runs the ladder from its key (layer-1 blocks of ${ladderKey.block}, ${ladderKey.visits} layer-2 visits), and this run was saved without one: it runs the ladder from here, and run.json now says so.`);   // A-DRAFT (LAD-R3), printed once it IS recorded (flushChoices)
  const savedOnDisk = { ...resumeMeta };
  resumeMeta = { ...resumeRest, pid: process.pid, rootSpanId, ...typedSettings };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...savedOnDisk, pid: process.pid, rootSpanId }, null, 2));
}

// v3 §2: refuse to silently resume past a changed task file. A stored taskHash on an older
// run (pre-v3) is absent, not mismatched - trusted, not treated as stale, the same posture
// §7.2's cache staleness check already takes for a missing fingerprint. AMENDMENTS.md is the
// one path past a real mismatch: an entry covering the current hash means the operator
// declared the change on the record rather than editing the task file quietly.
if (resumeMeta) {
  const amendmentsPath = join(runDir, 'AMENDMENTS.md');
  const amendmentsText = existsSync(amendmentsPath) ? readFileSync(amendmentsPath, 'utf8') : null;
  const scopeCheck = checkFrozenScope({ storedHash: resumeMeta.taskHash, currentHash: taskHash, amendmentsText });
  if (!scopeCheck.ok) {
    console.error(`\n${scopeCheck.message}\n(${amendmentsPath})`);
    process.exit(EXIT_SCOPE_CHANGED);
  }
  if (scopeCheck.amended) {
    // The new hash becomes this run's baseline going forward.
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), taskHash }, null, 2));   // from the file as it is: the typed settings are not on it yet
    console.log(`task hash mismatch covered by a recorded amendment in ${amendmentsPath} - proceeding.`);
  }
  // The same rule for the --context documents (roadmap item 10). A run from before this check has no
  // stored hash: it is trusted, and today's becomes its baseline.
  const ctxCheck = checkFrozenContext({ storedHash: resumeMeta.contextHash, currentHash: contextHash, amendmentsText });
  if (!ctxCheck.ok) {
    console.error(`\n${ctxCheck.message}\n(${amendmentsPath})`);
    process.exit(EXIT_SCOPE_CHANGED);
  }
  if (ctxCheck.amended || (resumeMeta.contextHash === undefined && contextHash)) {
    const onDisk = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...onDisk, contextHash }, null, 2));
    if (ctxCheck.amended) console.log(`context change covered by a recorded amendment in ${amendmentsPath} - proceeding.`);
  }
}
// Stage cache: <label>.md holds the text, <label>.usage.json what it cost.
// Both are written as each stage completes, so a resume replays them.
const unverifiedReplays = [];
// The Claude route is not part of the fingerprint: a stage written on one route is fresh on the other (the run replays it at no cost; the route is the person's to change, src/resolve-run.js). The fingerprint is made from the chain resolved WITHOUT the route.
const cacheFingerprint = fingerprintInputs(rawTaskTextForCacheFingerprint, claudeRoute !== 'anthropic' ? { ...claudeRouting.unrouted, ...config, seats: claudeRouting.unrouted.seats, ...(claudeRouting.unrouted.preflight !== undefined ? { preflight: claudeRouting.unrouted.preflight } : {}), ...(claudeRouting.unrouted.prompt_cache !== undefined ? { prompt_cache: claudeRouting.unrouted.prompt_cache } : {}) } : config);      // a session route may drop `prompt_cache` (no seat is left that can use it): the fingerprint still reads the chain as written, so a mode change keeps every finished stage. The unrouted chain is spread FIRST so the keys keep the chain's own order (JSON.stringify is order-sensitive: a key put back at the end of the object hashes differently; found by test/session-caching.test.js SC-2 on the merged tree)
mainRerun = { fingerprint: cacheFingerprint, ladderAdopted };
// A resume after the chain or the task changed, on a chain with no gate (free seats or sessions of yours): the paid chain's limit screen says what the change does to the finished steps; here ONE line says it, before the first step is asked again.
let staleNotice = null;   // printed once the log exists (below), so it is in run.log: a handler over MCP reads run.log and run_status's key lines
if (resumeMeta && !budgetFinishNow && !capGateApplies && !capsArmed.length) { const stale = staleFinishedStages(runDir, cacheFingerprint); if (stale.n > 0) staleNotice = staleNoticeLine(stale); }   // A-DRAFT (LAD-S5 free chain, LAD-S6 paid chain without a gate)
// Pre-release audits (money path #2, resume-cache #1/#4): the getter no longer decides staleness by
// returning null - that threw the old answer's cost away. It returns what is on disk, flagged
// `staleInputs` when the task/config fingerprint differs, and invoke() in chain.js decides (it also
// compares the stage's prompt hash, which only it can compute). A stale stage is moved into
// superseded/ through `invalidate`, never overwritten. An external answer gets its prompt hash and
// fingerprint from `<label>.prompt.json`, written when the run paused to ask for it, since the
// operator (or submit_stage) writes only the answer.
// Whether stage-log.jsonl already has a line for this stage (external seats #2, onStage below).
function stageLogged(label) {
  const p = join(runDir, 'stage-log.jsonl');
  if (!existsSync(p)) return false;
  return readFileSync(p, 'utf8').split('\n').some(line => {
    if (!line.trim()) return false;
    try { const e = JSON.parse(line); return !e.kind && e.stage === label; } catch { return false; }
  });
}
setEnvelopeStore(fileEnvelopeStore(runDir)); // E3b: the per-call reply-identity records live beside the stage files
setEnvelopeInForce(envelopeFlag);
setCache(makeStageCache({ dir: runDir, fingerprint: cacheFingerprint, unverified: unverifiedReplays, wording: { sitting: () => sittingNo } })); // the cache object lives in src/stage-cache.js (one copy for the main run and both side runs)
setRepairPauses(true); // 2 Nov 2026: the main run can be resumed in its own folder, so a near-JSON reply pauses for a repair (the side runs do not set this)
// Money path #4: charges that are not stages go to disk too, so --spend and a resume count them.
setChargeHook(c => recordLostCharge(runDir, c.label, c));
// 0.8.3 M6 typed cap T4a (typed-cap gate page sections 2-4 and 7-8; T4 start-path page; Muad 14 Oct 2026: "a max-cap that the user always have to type manually before a run starts", "Typed cap is for every run"):
// a PAID run's spending limit is a number a person TYPES, found in (or asked into) the run folder's gate ledger; --max-usd and MAX_USD_PER_RUN are only a suggestion shown on the screen and are never the limit.
// Exempt, by the page: a chain whose every seat is free (mock, external, ollama), a tree member (authority = its registered claim, memberStart below), an adopted advice call (its own approval). The gate sits after every
// refusal that needs no money (the chain, the keys, an unpriced seat, the policy, the scans) and before the first reservation and the first provider call.
// Unit 4b2: under the per-provider caps (capsArmed) the one run-wide gate gives way to one gate per cap, below. (capGateApplies, capsStopCap, capsRaiseTargets and the refusal of the raise flags moved up, before the run folder
// and the lock: S20 slice 1, H2-i.)
if (capGateApplies) {
  maxUsdEff = await capGateOrExit({
    runDir, runId, resume: Boolean(resumeMeta), config, fromRun, subject: { chain: chainNameEff, task: taskPathEff }, routeLine: routeLines(claudeRouting)[0] ?? null, typedReads: ladderTypedReads(roundChoices),
    scopeBaseOf: () => ({
      taskSha256: sha256Hex(rawTaskTextForCacheFingerprint), contextSha256: contextHash ? sha256Hex(contextHash) : null, chainSha256: sha256Hex(readFileSync(configPath)),
      policySha256: existsSync(join(resumeMeta?.cwd || work, 'policy.json')) ? sha256Hex(readFileSync(join(resumeMeta?.cwd || work, 'policy.json'))) : null, sensitivityFloor: null, piiMode: piiGateEff,
    }),
    beforeAuthorize: () => { if (!resumeMeta) { const fresh = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); delete fresh.maxUsd; writeFileSync(join(runDir, 'run.json'), JSON.stringify(fresh, null, 2)); } },
    beforePendingExit: flushChoices,
  });
  // The typed figure is THE limit of this run, whatever a flag, the environment or a saved run.json said; run.json keeps it as a convenience copy (the gate ledger is the record).
  const onDisk = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...onDisk, maxUsd: maxUsdEff }, null, 2));
}
// Unit 4b2 (src/caps.js "THE ARMING"): one typed limit per cap in force, each asked at its own gate (sorted), every gate asked before the ONE wait (exit 21) that lists
// the ones still open; a partial answer never arms (a typed gate is consumed now and read back at the next sitting). A pending start is a START here (resume: false),
// so a cap with no gate yet gets a first screen, never the legacy one.
const capsLimits = {};
// 0.8.4 (--finish-now at a spending stop; C&C 10 Nov, the SECOND WALL): this command asks no limit, but the limits the run stopped at stay IN FORCE in it, read from the hash-chained record of what the person typed (runCapAuthority), never from run.json (project-writable text) or from
// STOPPED-budget.json: a call that somehow escaped invoke()'s own stop (NotRunForLimit) would still be refused by the cap, before any reservation. ONE fact makes this a no-money sitting: `budgetFinishNow`, set only by the --finish-now flag on a run whose stop file says
// loop or after (above); it skips the gates here, arms these limits, and (below) switches the seam on. An unreadable limit refuses the command, nothing run or spent.
if (budgetFinishNow) {
  const unreadable = [];
  if (capsArmed.length) {
    for (const id of capsArmed) { const a = runCapAuthority(runDir, { runId, capName: id }); if (a?.status === 'ok' && capUsdNumber(a.capUsd) !== null) capsLimits[id] = capUsdNumber(a.capUsd); else unreadable.push(id); }   // the typed limit is stored as a decimal string: capUsdNumber (src/cap-input.js) reads the number from it
  } else if (chainIsPaid(config) && !treeLineage) {
    const a = runCapAuthority(runDir, { runId }); if (a?.status === 'ok' && capUsdNumber(a.capUsd) !== null) maxUsdEff = capUsdNumber(a.capUsd); else unreadable.push('the run');   // a paid chain always has a typed limit on record; run.json (project-writable text) is never the fallback here
  }
  if (unreadable.length) { console.error(`--finish-now: the limit ${unreadable.length === 1 && unreadable[0] === 'the run' ? 'this run stopped at' : `${unreadable.join(', ')} stopped at`} cannot be read from the record of what you typed (a folder from before that record, or a damaged one), so it cannot be kept in force in this command. Nothing was recorded, run or spent. What you can still do: a plain resume asks for a new limit above what the run has counted and records it; with that on record, --finish-now can be given again.`); process.exit(2); }   // A-DRAFT (LAD-B9)
}
if (capsArmed.length && !budgetFinishNow) {
  const pending = [];
  for (const id of capsArmed) {
    const usd = await capGateOrExit({
      runDir, runId, resume: false, config, fromRun, subject: { chain: chainNameEff, task: taskPathEff }, capName: id, onPending: p => pending.push(p), routeLine: routeLines(claudeRouting)[0] ?? null, typedReads: ladderTypedReads(roundChoices),
      scopeBaseOf: () => ({
        taskSha256: sha256Hex(rawTaskTextForCacheFingerprint), contextSha256: contextHash ? sha256Hex(contextHash) : null, chainSha256: sha256Hex(readFileSync(configPath)),
        policySha256: existsSync(join(resumeMeta?.cwd || work, 'policy.json')) ? sha256Hex(readFileSync(join(resumeMeta?.cwd || work, 'policy.json'))) : null, sensitivityFloor: null, piiMode: piiGateEff,
      }),
      beforeAuthorize: () => { const fresh = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); if (Object.hasOwn(fresh, 'maxUsd')) { delete fresh.maxUsd; writeFileSync(join(runDir, 'run.json'), JSON.stringify(fresh, null, 2)); } },
    });
    if (usd !== null) capsLimits[id] = usd;
  }
  if (pending.length) {
    flushChoices();   // the wait is not a refusal: a choice typed on this command is kept for the plain --resume that follows `gate answer`
    for (const p of pending) if (p.note) console.error(`\n${p.note.message}`);
    console.error(`\n${capsWaitSentence(pending.map(p => ({ id: p.capName, gate: p.gate, relayed: p.relayed })), capsOn, { dir: runDir, command: councilCommand(), raiseId: raiseCapId, relayed: argv.includes('--relayed') })}`);   // A-DRAFT
    process.exit(EXIT_AWAITING_USER_CAP);
  }
  // The typed figures are THE limits of this run; run.json keeps them as a convenience copy (the gate ledger is the record), never a run-wide maxUsd.
  const onDisk = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  delete onDisk.maxUsd;
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...onDisk, caps: Object.fromEntries(capsArmed.map(id => [id, { maxUsd: capsLimits[id] }])) }, null, 2));
  maxUsdEff = null;
}
if (capsArmed.length && budgetFinishNow) maxUsdEff = null;   // under the caps the run total carries no ceiling; each cap its own bucket (set below)
// A resumed run inherits the ceiling it was started under unless this
// invocation names a different one - otherwise resuming would silently drop
// the cap the run was created with.
setBudgetOrExit(maxUsdEff);
// Unit 4b2: under the caps the run total carries no ceiling (setBudget(null) above) and each cap its own bucket, armed last before anything is counted or sent.
if (capsArmed.length) { try { setCapBudgets(capsLimits); } catch (e) { console.error(`The spending caps could not be set up (${e.message}). Nothing was started.`); process.exit(2); } }   // A-DRAFT
// Money path #2: what earlier sittings spent on stages that were later superseded still counts.
const earlierSupersededUsd = supersededSpendOf(runDir);
if (capsArmed.length) { for (const r of supersededStagesOf(runDir)) countEarlierSpend(r.usd, r.capName); } else countEarlierSpend(earlierSupersededUsd);   // unit 4c1: each in the cap it billed through (a record without one: the run total only)
// 0.8.2 item 8b: calls an earlier sitting reserved and never settled (the process ended while they were in flight) stay charged at their worst case, so a resume cannot lap the cap; this sitting writes its own
// reservations before it sends (src/spend-reservations.js).
const earlierUnsettled = unsettledReservations(runDir);
const earlierUnsettledUsd = earlierUnsettled.reduce((n, r) => n + r.usd, 0);
if (capsArmed.length) { for (const r of earlierUnsettled) countEarlierSpend(r.usd, r.capName); } else countEarlierSpend(earlierUnsettledUsd);   // unit 4c1: per cap, at their worst case
// 0.8.4 unit 6 (D11; H-U6-e): a call an earlier sitting SETTLED whose usage file was never written (the process ended between the settle line and the file) was paid for and is in no file; `--spend` and the reports count it (src/counted-spend.js),
// so the resume's budget does too, in the cap its reserved line names. Its stage is asked again, so without this a resume could spend past the cap by that call.
const earlierSettledNoFile = settledWithoutFileOf(runDir);
if (capsArmed.length) { for (const r of earlierSettledNoFile) countEarlierSpend(r.usd, r.capName); } else countEarlierSpend(earlierSettledNoFile.reduce((n, r) => n + r.usd, 0));
setReservationSink(openReservations(runDir));

const logPath = join(runDir, 'run.log');
const log = (...parts) => {
  // Model text reaches the log; control and bidi characters are dropped here (src/terminal-safe.js).
  const line = terminalSafe(parts.join(' '));
  console.log(line);
  appendFileSync(logPath, line + '\n');
};

log(`council run ${runId}${resumeMeta ? ' (resumed)' : ''}`);
log(`chain: ${config.name} (${roundLimitsOf(config).ladder ? `the ladder: layer 1 in blocks of ${roundLimitsOf(config).ladder.block}, layer 2 for ${roundLimitsOf(config).ladder.visits} visits, layer 3 with no count${roundLimitsOf(config).passes === null ? '' : `, at most ${roundLimitsOf(config).passes} passes`}` : roundLimitsOf(config).overseer !== null ? `${roundLimitsOf(config).overseer} overseer rounds, at most ${roundLimitsOf(config).passes} passes, a ceiling` : `${roundLimitsOf(config).passes} round cap`})`);   // A-DRAFT (LAD-C2: the ladder chain's line)   // CR-4B-007: the EFFECTIVE cap (maxRounds, else the default of 2), never "undefined" for a chain that omits maxRounds
if (staleNotice) log(staleNotice);
if (earlierUnsettled.length) log(`earlier sitting: ${earlierUnsettled.length} call(s) were in flight when the process ended and were never settled (${earlierUnsettled.map(r => r.label).join(', ')}); ${formatUsd(earlierUnsettledUsd)} (their worst case) stays counted toward the cap`);
if (earlierSupersededUsd > 0) log(`spent earlier on superseded stages: ${formatUsd(earlierSupersededUsd)} (counted toward the cap; see superseded/)`);
log(budgetFinishNow ? (capsArmed.length ? `${capsLogLine(capsLimits, formatUsd)} - the limits the run stopped at, kept in force; this command makes no call that bills` : `cap:   ${maxUsdEff === null ? 'none armed' : `${formatUsd(maxUsdEff)} per run (the limit of the stopped run)`} - this command makes no call that bills`) : capsArmed.length ? capsLogLine(capsLimits, formatUsd) : `cap:   ${maxUsdEff === null ? 'none - this run has no spend ceiling' : `${formatUsd(maxUsdEff)} per run (${capGateApplies ? 'the limit typed for this run' : '--max-usd'})`}`);   // the caps' line is A-DRAFT
log(`task:  ${taskPathEff}`);
for (const l of [...routeLines(claudeRouting), ...zeroRetentionLines(zeroRet), ...personaFormLines(personaFormDecision), ...skippedRoomLines(routedSeatsWithoutWindow(everySeatOf(config)))]) log(l);      // 0.8.4 the Claude route: said before anything is paid (a direct run prints nothing here)
// A chain whose worst case is above the ceiling may stop part-way, with no deliverable yet. Said
// before anything is spent, not only when the cap trips (walked 2026-09-25: plan-premium-7's worst
// case is $18.55 against the $7 default).
for (const w of policyWarnings) log(`policy warning - ${w}`);
if (policyWarnings.length) {
  if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
  // Audit fix cnc-cli-resume F3: the policy is re-evaluated every sitting (by design), but its warning is recorded once per run: a line already in WARNINGS.md is not appended again.
  const haveWarned = readFileSync(join(runDir, 'WARNINGS.md'), 'utf8');
  appendFileSync(join(runDir, 'WARNINGS.md'), policyWarnings.map(w => `- policy: ${w}\n`).filter(l => !haveWarned.includes(l)).join(''));
}
// 0.8.3 (C&C ruling 18 Okt 2026): a normal run's warn lines also go into run.log, because an MCP caller reads run.log (run_status, read_run_file) and the detached run's stderr is a separate file. A tree member records its findings in WARNINGS.md below, so it is skipped here.
// (built from the finding fields, never the printed lines, which carry a masked prefix; a refused start makes no folder: its lines are only on stderr, which is where a refusal is read)
if (!treeLineage) for (const l of piiLogLines(piiWarnFindings)) appendFileSync(logPath, `${terminalSafe(l)}\n`);
// S5b part A commit 3: a tree member's PII findings under warn (type, where, line - never the value). A normal run writes nothing here (byte-identical). Each sitting scans again; a line already in the file is not appended again, as the policy warning above.
if (treeLineage && piiWarnFindings.length) {
  if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
  const haveWarnedPii = readFileSync(join(runDir, 'WARNINGS.md'), 'utf8');
  appendFileSync(join(runDir, 'WARNINGS.md'), piiWarningLines(piiWarnFindings).filter(l => !haveWarnedPii.includes(l)).join(''));
}
if (!resumeMeta && maxUsdEff !== null) {
  const worstCase = estimateChainRows(config, { fromRun, typedReads: ladderTypedReads(roundChoices) }).reduce((sum, r) => sum + r.usd, 0);
  const mostCase = estimateChainRows(config, { fromRun, maximum: true, typedReads: ladderTypedReads(roundChoices) }).reduce((sum, r) => sum + r.usd, 0);
  if (worstCase > maxUsdEff) log(`note:  this chain's expected cost is ${formatUsd(worstCase)} (upper estimate ${formatUsd(mostCase)}), above the ${formatUsd(maxUsdEff)} cap. If it gets that far it stops before the stage that would cross it, keeps what it has, and resumes with a higher ${chainIsPaid(config) ? 'limit that a person types' : '--max-usd'}.`);
  else if (mostCase > maxUsdEff) log(`note:  this chain's expected cost is ${formatUsd(worstCase)}, within the ${formatUsd(maxUsdEff)} cap, but its upper estimate is ${formatUsd(mostCase)}: a run in which every call writes its seat's whole output allowance stops at the cap before the call that, by THC's estimate, would cross it, keeps what it has, and resumes with a higher --max-usd.`);
}

// v2 plan §6: before any stage runs, before a single metered API call, a static keyword
// check for the specific class of conflict this project already hit once (a chain requiring
// an appended section against text demanding a standalone document). Warns, never blocks.
//
// Bug-audit fix, 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md #2): the whole block used to sit
// inside `if (!resumeMeta)`, so a run the artifact gate had blocked could simply be resumed - and
// its unfenced task then went through every seat. Its marker was also named NEEDS-ARTIFACTS.md,
// which run-status reads as an external pause, so MCP invited exactly that resume. The gate (free:
// no call is made) now runs on every start AND every resume, which also re-checks a task edited or
// amended in between; only the warnings are written once. The marker is BLOCKED-ARTIFACTS.md.
{
  // v3 §3: same call site, same warn-never-block posture, checking for a task that names a
  // file it never inlines verbatim rather than a section/criteria conflict.
  const contractWarnings = preflightCheck(config, request);
  const artifactFindings = checkArtifactReferences(requestForArtifactGate, { allow: unfencedAllowListEff });
  const preflightWarnings = [...contractWarnings, ...artifactFindings, ...judgePersonaWarnings(config), ...modelLabWarnings(config)];   // unit W: a persona with no seat_personas switch
  if (preflightWarnings.length && !resumeMeta) {
    for (const w of preflightWarnings) log(`  PRE-FLIGHT WARNING: ${w.message}`);
    if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
    appendFileSync(join(runDir, 'WARNINGS.md'), preflightWarnings.map(w => `- pre_flight: ${w.message}\n`).join(''));
  }

  // 2026-09-20: the artifact check is a gate, not a warning. A task naming a file it never
  // fences sends every lab to guess at that file's contents, and they guess confidently -
  // the cheap-7 run shipped a false claim about a directory for exactly this reason, having
  // printed this same warning and run anyway. Exits BEFORE any metered call, so a blocked run
  // costs nothing. --allow-unfenced is the explicit override and is recorded in WARNINGS.md
  // above alongside the findings, so bypassing leaves a trace rather than erasing one.
  if (artifactFindings.length && !allowUnfencedEff) {
    const needsPath = join(runDir, ARTIFACTS_BLOCKED_FILE);
    writeFileSync(needsPath, [
      '# Missing artifacts',
      '',
      `This run stopped before its first API call. The task names ${artifactFindings.length} file(s)`,
      'whose contents it never includes, so no seat can read them:',
      '',
      ...artifactFindings.map(w => `- \`${w.path}\``),
      '',
      '## How to fix',
      '',
      'Fence the real content into the task file, so the run folder records exactly what was',
      'sent to each lab:',
      '',
      '```',
      `council fence --task <task.md> --repo <path> ${artifactFindings.map(w => w.path).join(' ')}`,
      '```',
      '',
      'Or, if a file is named only as a location and its contents genuinely do not matter,',
      'allow it explicitly - either `--allow-unfenced` for this run, or in the task front-matter',
      'so the decision travels with the task:',
      '',
      '```',
      '---',
      `unfenced-ok: [${artifactFindings.map(w => w.path).join(', ')}]`,
      '---',
      '```',
      '',
      'Everything fenced into the task is sent to every seat, and therefore to each lab behind',
      'them. Fence what the question needs answered, not the whole file, and never a secret.',
      '',
    ].join('\n'));
    log(`\n  BLOCKED: ${artifactFindings.length} file(s) named but never fenced. Wrote ${needsPath}`);
    log('  Nothing was called and nothing was spent. See that file for the two ways forward.');
    process.exit(EXIT_ARTIFACTS_BLOCKED);
  }
  // Passed this time (the task was fenced, or --allow-unfenced given): a marker left by an earlier
  // blocked sitting would otherwise keep the run reading as blocked.
  for (const f of [ARTIFACTS_BLOCKED_FILE, 'NEEDS-ARTIFACTS.md']) if (existsSync(join(runDir, f))) rmSync(join(runDir, f));
}
// #16c, the owner's "pause after this round": a request still standing is SETTLED here, in the ledger, by the sitting that is about to run: the request the stop marker names is taken (the pause did what it was asked), any other
// standing request lapses (it was asked of a sitting that ended some other way, and must not stop this one at an unrelated pass). Here and not earlier: after the LAST refusal of the start and BEFORE flushChoices and the sitting stamp (R417 part 2, CR-1E-006: a refusal here is itself the last refusal, so nothing the command typed has been written when it
// stops), so a REFUSED resume of a paused run records nothing and the request stays untaken (it never moves ahead of the other refusals: no pause_taken on a run whose start is then refused); before clearStopRecords, which deletes the marker that names the request. A tree member has no pause (the verb refuses it). If the line cannot be written the resume stops, nothing started: a request left standing would pause the
// sitting again at the paused pass.
if (!treeLineage && resumeMeta) {
  const settled = settlePauseAtResume(runDir, { finished: ownerPauseFinishing, pass: ownerPauseFinishPass });   // 'pause_finished' only when this command ENDS the run at the pause
  if (!settled.ok) { console.error(`--resume: a request to pause this run could not be settled (${settled.message ?? settled.code}). Nothing was started; run the same command again.`); process.exit(2); }   // A-DRAFT
  if (settled.event === 'pause_finished') log(`  (this run was paused on request before its next pass, and you chose to finish it there${ownerPauseFinishing === 'finish_now' ? ' at once' : ''}; the run does not go on.)`);   // A-DRAFT (LAD-O3)
  if (settled.event === 'pause_lapsed') log(`  (a request to pause this run was still standing from an earlier sitting; it lapsed and does not pause this one.)`);   // A-DRAFT
}
// CR-1E-006, ONE rule: a command that is REFUSED leaves nothing it typed on disk. What a person types on this command reaches run.json only here, after the LAST refusal that can come before the first call: the CHOICES (--continue / --finish, --skip-seat, --prevail)
// and the SETTINGS (--max-usd, --pii-gate / --allow-pii, --signoff, --allow-unfenced, --allow-secret-shaped, the policy checks; a saved waiver is replaced by the effective one). The refusals are the changed-task and changed-context checks, the typed-limit gate's refusal, the
// cap, and the artifact gate (exit 9: its way out is a different command, --allow-unfenced or a changed task, and a saved waiver or choice would apply silently). A tree member never gets here with a pending choice (a direct choice is refused for a member above).
// THE ONE EXCEPTION is the typed-limit WAIT (exit 21, "No call was started"), whose printed next step is a plain `--resume` after `gate answer`: capGateOrExit writes both before that exit (beforePendingExit). Only the pid and the span root are written earlier.
flushChoices();
if (budgetFinishArmed) console.log(spendFinishNote(budgetFinishArmed.label));
if (budgetFinishUnrecorded) console.log(spendFinishUnrecordedNote(budgetFinishUnrecorded));
if (budgetFinishWithdrawn) console.log(spendFinishWithdrawnNote);
if (budgetFinishContinued || budgetContinue) console.log(spendFinishContinuedNote);   // WORDING LAD-R34   // WORDING LAD-R20   // WORDING LAD-R15
if (budgetFinishNow) console.log(finishNowNote(budgetFinishNow.phase, budgetFinishNow.label));   // WORDING LAD-B2   // WORDING S16-w66: printed here, after the last refusal, whether or not a choice was pending (flushChoices drains its notes only when it writes)
if (secretFinishOnly) {
  const e = secretEndingOf(config, { typedReads: ladderTypedReads(roundChoices) });
  console.log(`--finish recorded for stage "${secretFinishOnly}". Nothing was sent and the run stays paused. To end it here, NOT agreed, give: ${councilCommand()} --resume ${runDir} --continue.${e?.makesCalls ? ' The ending sends the plan (see STOPPED-secret.md); leave the run paused to send nothing.' : ''}`);
  process.exit(EXIT_PII_BLOCKED);   // still paused: the pause files stay (stampSitting and clearStopRecords come after this line)
}
// 0.8.4: this sitting is stamped into run.json (`sittings[]`: when, which process, which version, the code stamp when it can be computed), so a run that was resumed on another tree says so. It is written after the last refusal
// of the start (like flushChoices), so a refused command writes nothing: here for every run but a tree member, whose claim can still refuse (exit 19, "writes nothing back"); a member is stamped right after its claim passed. The entry is
// appended to run.json as it is on disk. A stamp that cannot be written must never stop the run.
// 0.8.4 T14 (CA2/D17): `sittingNo` = this sitting's number and `wordingNow` = the code running, both set ONLY when the stamp was really written; they are what every stage record's `writtenBy` is made from and what arms the chain's ledger. A sitting
// whose stamp failed leaves both null: its stages carry no `writtenBy` (a later sitting reads them as unstamped) and the ledger stays off, so the cache behaves exactly as before (fail closed).
let sittingNo = null, wordingNow = null;
const writtenByNow = text => writtenByRecord({ now: wordingNow, sitting: sittingNo, text });
function stampSitting() {
  try {
    const onDisk = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    const entry = sittingEntry();
    const sittings = [...(Array.isArray(onDisk.sittings) ? onDisk.sittings : []), entry];
    // FIX 7: the run's OpenRouter session id: made once, kept in run.json (a resume carries the same one), handed to the provider adapter; it is in no config, no report and no prompt hash
    const sessionId = typeof onDisk.openrouter_session === 'string' && /^thc-[0-9a-f]{24}$/.test(onDisk.openrouter_session) ? onDisk.openrouter_session : `thc-${randomBytes(12).toString('hex')}`;
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...onDisk, sittings, openrouter_session: sessionId }, null, 2));
    setOpenRouterSessionId(sessionId);
    sittingNo = sittings.length; wordingNow = { version: entry.version, ...(entry.code_sha256 ? { code_sha256: entry.code_sha256 } : {}), route: claudeRoute };   // FIX 5: the route this sitting runs on, so a route change lets a saved stage be kept (src/stale-guard.js routeChanged)
    setWordingStamp(wordingNow);   // armed by the main run, on --resume too
  } catch (e) { console.error(`  (this sitting was not stamped into run.json: ${e?.message || e})`); }
}
if (!treeLineage) stampSitting();

// A previous sitting may have stopped this run at the ceiling. Clear that
// marker now that we are past it, so a run that goes on to finish is not
// still advertising itself as capped. report-partial.json and BOARD-partial.md go with
// STOPPED-budget.json: they describe the run as it stood at that stop, which this sitting is
// about to change, so they live and die with the marker. If this sitting is capped again they are
// written fresh; if it finishes, report.json replaces them.
// Bug audit 2026-09-26 #1: this ran before the artifact gate above, so a resume the gate blocked
// (exit 9, nothing spent) had already deleted the stopped run's partial report and its marker. It
// now runs only once the gate has passed.
// Bug audit 2026-10-24 C-009: a tree MEMBER's claim (memberStart, further down) can still refuse the resume (exit 19: the accounting gate, a lowered ceiling, no live grant, the continuation check), and exit 19 writes nothing back,
// so a member clears these only after its claim succeeded (and rewrites state.json then); every other run has no later refusal and clears here, as before.
// Every stop is kept as a small record before the next sitting clears the stop files (0.8.4): `stop-<nnnn>.json` beside run.json, numbered, never deleted. The names are flat and not `STOPPED-*` on purpose: tree resume globs
// `STOPPED-*`, and read_run_file takes plain names only. Compact: the stop (its id, kind, round, pass, figures), what stopped the run, and the small stop markers as they were; not the partial report or the board (a stop
// records its own figures; the full partial report is 130 KB at pass 7 of a long run). A stop that comes back at the same id (a heal re-stop) rewrites the newest record. A record that cannot be written is logged and the sitting goes on:
// it is a keepsake, and losing one must never stop a resume.
const keepStopRecord = () => {
  try {
    const markerFiles = ['STOPPED-budget.json', 'STOPPED-error.json', 'STOPPED-truncated.json', SECRET_STOP_FILE, ...STOP_CAUSES.map(stoppedFileOf)].filter(f => existsSync(join(runDir, f)));
    if (!markerFiles.length && !existsSync(join(runDir, PARTIAL_REPORT_FILE))) return;   // a fresh run or a run that did not stop: nothing to keep
    const readJson = f => { try { return JSON.parse(readFileSync(join(runDir, f), 'utf8')); } catch { return null; } };
    const partial = readJson(PARTIAL_REPORT_FILE);
    const stop = budgetStopWithSha(runDir, partial?.stop ?? null);   // a spending stop is named with the hash of its figures, so two stops at one stage keep two records
    const stopId = stop && Number.isInteger(stop.overseer_round) && Number.isInteger(stop.pass) ? stopIdOf(stop) : null;
    const earlier = readdirSync(runDir).filter(f => /^stop-\d{4}\.json$/.test(f)).sort();
    const newest = earlier.at(-1);
    const name = stopId && newest && readJson(newest)?.stop_id === stopId ? newest : `stop-${String((newest ? Number(newest.slice(5, 9)) : 0) + 1).padStart(4, '0')}.json`;
    writeAtomic(join(runDir, name), `${JSON.stringify({
      schema: 'stop-record/1', stop_id: stopId, kept_at: new Date().toISOString(),
      stopped_by: partial?.stoppedBy ?? null, stopped_at_stage: partial?.stoppedAtStage ?? null, stop,
      markers: Object.fromEntries([...new Set(markerFiles)].map(f => [f, readJson(f)])),
    }, null, 2)}\n`);
  } catch (e) { log(`  (the stop record of the last sitting was not kept: ${e?.message || e})`); }
};
const clearStopRecords = () => {
  keepStopRecord();
  for (const f of ['STOPPED-budget.json', 'STOPPED-budget.md', PARTIAL_REPORT_FILE, PARTIAL_BOARD_FILE, PARTIAL_DELIVERABLE_FILE, 'STOPPED-error.md', 'STOPPED-error.json', 'STOPPED-preflight.md', 'STOPPED-truncated.json', 'STOPPED-truncated.md', 'STOPPED-secret.md', SECRET_STOP_FILE, ...STOP_CAUSES.map(stoppedFileOf)]) {
    if (existsSync(join(runDir, f))) rmSync(join(runDir, f));
  }
};
if (budgetFinishNow && !budgetFinishNow.recorded) {
  // the person's typed --finish-now goes on the ledger now, past every refusal, so the resume that follows a session's answer ends the run without asking again (idempotent for the same stop)
  const rec = recordBudgetFinish(runDir, { stopSha256: budgetFinishNow.stopSha, phase: budgetFinishNow.phase, choice: 'finish_now', stopId: budgetFinishNow.stopId, relayed: budgetFinishNow.relayed ?? null });
  if (!rec.ok) { console.error(`--finish-now: your choice could not be recorded (${rec.message}). Nothing was run or spent.`); process.exit(2); }   // A-DRAFT (LAD-B14)
  budgetFinishNow.recorded = true;
}
if (!treeLineage && !budgetFinishNow) clearStopRecords();   // a --finish-now sitting sets the stop files aside only when it has ENDED the run (below): a sitting that cannot end it leaves the run exactly as it was stopped

// v5 item 3: state.json, a live progress file rewritten atomically from files already on disk
// plus the in-flight stage - never read back as chain input (deleting it loses nothing). The
// classification/parsing logic itself is in src/run-state.js (pure, unit-tested with no CLI or
// process running); this block is the thin stateful wrapper: it owns the seat-status Map,
// installs chain.js's progressHook, and does the file I/O.
// Every seat that works in the debate or review: the tiered-council seats (seats.alternatives, the
// anchors who write the architectures; seats.deep_dive) are on the board too (PR #13 verification,
// #4). A lab in several lists is one row.
registerSeatKeys(config);   // lab identity: a repeated model's seats are separate rows here (keyed by seat, shown by lab + `seat`)
const seatState = new Map(
  [
    ...(config.seats.proposers || []), ...(config.seats.critics || []),
    ...(Array.isArray(config.seats.alternatives) ? config.seats.alternatives : []),
    ...(config.deep_dive?.enabled === true && config.seats.deep_dive && !Array.isArray(config.seats.deep_dive) ? [config.seats.deep_dive] : []),
  ].filter(Boolean).map(s => [seatKeyOf(s), 'waiting']),
);
let currentStage = null;
let currentRound = 1;
// v6 item 2 (progress-spans.js): per-boundary start times, keyed so onStage/round-close can
// look up a real started_at instead of inventing one. Stage keys are the stage label (unique per
// progressHook 'startedAt' event); round keys are the round number, set once on that round's
// first panel/critique stage start and left alone afterward.
const stageStartedAt = new Map();
const roundStartedAt = new Map();

function applyStageCompletion(label, lab) {
  if (!lab) return;
  const r = parseRoundFromLabel(label);
  if (r) currentRound = r;
  const status = classifyStageCompletion(label);
  if (status) seatState.set(lab, status);
}

function writeStateJson() {
  const cost = sumCostFromStageLogText(existsSync(join(runDir, 'stage-log.jsonl')) ? readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8') : '');
  const runMetaNow = { pid: process.pid, ...(resumeMeta || {}) };
  const state = {
    runId, label: labelEff,
    phase: deriveRunStatus(runDir, runMetaNow),
    stage: currentStage,
    round: currentRound, maxRounds: roundLimitsOf(config).passes,
    seats: [...seatState.entries()].map(([key, status]) => ({ lab: labFromKey(key), ...(labFromKey(key) !== key ? { seat: key } : {}), status })),
    // The external stages the run is waiting on (empty unless it is paused): what a live view shows
    // as "your turn" without listing the folder itself.
    waiting: waitingStages(runDir),
    cost: { perLab: cost.perLab, spentUsd: cost.spentUsd, maxUsd: maxUsdEff },
    updatedAt: new Date().toISOString(),
  };
  const tmp = join(runDir, '.state.json.tmp');
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, join(runDir, 'state.json'));
}

// Called once a stop marker (or NEEDS file) is on disk, so state.json at rest says what the run is
// now (paused, budget_stopped, failed, ...) instead of the "running" its last progress event wrote.
function finalState() { currentStage = null; try { writeStateJson(); } catch { /* the marker is the record */ } }

// Rebuild seatState/round from whatever this run folder already recorded, so a --resume run's
// first state.json write (before any new stage even starts) reflects real history rather than
// a blank roster - stage-log.jsonl already exists for a resumed run's completed stages.
const existingStageLogText = existsSync(join(runDir, 'stage-log.jsonl')) ? readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8') : '';
if (existingStageLogText) {
  for (const line of existingStageLogText.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.kind) continue;
    applyStageCompletion(entry.stage, entry.seat ?? entry.lab);
  }
}
// V6-2: same replay-from-disk reconstruction as seatState above, so a round left partially
// complete before a pause closes correctly once its remaining critics report post-resume,
// instead of starting a second, disconnected span for a round already in progress.
const { roundSpanIds, roundPanelCounts } = replaySpanStateFromStageLogText(existingStageLogText);
const criticsCount = (config.seats?.critics || []).length;

// v5 item 3, touch point 1's receiver: chain.js calls this once per real paid call, right
// before it goes out, and a second time per critique/panel/reply stage once its verdict is
// parsed (touch point 2) - see src/chain.js's progressHook call sites for the exact payloads.
setProgressHook(event => {
  if (event.startedAt) {
    currentStage = { label: event.label, lab: event.lab, startedAt: event.startedAt };
    seatState.set(event.seat ?? event.lab, 'working');
    stageStartedAt.set(event.label, event.startedAt);
    const r = parseRoundFromLabel(event.label);
    if (r) {
      currentRound = r;
      if (!roundStartedAt.has(r)) roundStartedAt.set(r, event.startedAt);
    }
  } else {
    const status = classifyVerdictEvent(event, seatState.get(event.seat ?? event.lab));
    if (status) seatState.set(event.seat ?? event.lab, status);
    // V6-2: checked here, not in onStage's stage-file writer - chain.js posts a panel stage's
    // 'verdict' progressHook event (touch point 2) strictly after that stage's own onStage/
    // record() call (touch point 1) already ran, so seatState wouldn't yet reflect the very
    // critic whose verdict just closed the round if this ran at onStage time instead. Checking
    // here means the round record's seats[] snapshot always includes every critic's real,
    // just-posted status - never "working" for the seat that only just finished.
    const closedRound = recordRoundStageAndCheckClose(event.label, roundPanelCounts, criticsCount);
    if (closedRound) {
      const roundSeats = (config.seats?.critics || []).map(c => {
        const key = seatKeyOf(c);
        return { lab: labFromKey(key), ...(labFromKey(key) !== key ? { seat: key } : {}), status: seatState.get(key) || 'unknown' };
      });
      const stageLogPath = join(runDir, 'stage-log.jsonl');
      const spentUsd = sumRoundUsdFromStageLogText(existsSync(stageLogPath) ? readFileSync(stageLogPath, 'utf8') : '', closedRound);
      appendFileSync(stageLogPath, `${JSON.stringify({
        kind: 'round', round: closedRound,
        span_id: roundSpanIds.get(closedRound), parent_span_id: rootSpanId,
        seats: roundSeats, spentUsd,
      })}\n`);
      // v6 item 2: this round's own boundary in spans.jsonl. cost_so_far is real (derived from
      // the stage-log.jsonl text, which this call just re-read after the line above appended to
      // it) - not a placeholder, since the cumulative cost is already computable at this point.
      const roundStart = roundStartedAt.get(closedRound) ?? null;
      appendSpanRecord(runDir, buildSpanRecord({
        runId, stage: `round-${closedRound}`, round: closedRound,
        seatsParticipating: roundSeats.map(s => s.lab),
        startedAt: roundStart,
        startedAtReason: roundStart == null ? 'no panel/critique stage start observed for this round before it closed' : undefined,
        endedAt: new Date().toISOString(),
        outcome: 'closed',
        costSoFar: sumCostFromStageLogText(readFileSync(stageLogPath, 'utf8')).spentUsd,
      }));
    }
  }
  writeStateJson();
});
writeStateJson();

log(resumeMeta ? `resume: stages already on disk replay for free` : '');
// One run's tool calls, for TOOLS.md below (the log lives in tools.js's memory).
resetToolCallLog();
// What report.json (a finished run) and report-partial.json (a run the spend cap stopped) are built
// from, besides the result itself: one list, so the two files cannot drift apart.
// Unit 4b2: report.json's `caps`: each cap's typed limit and the spend RECORDED through it (the engine's bucket, without the worst case assumed for replayed stages).
const capsReportField = () => { const st = budgetState().caps ?? {}; return Object.fromEntries(capsArmed.map(id => [id, { maxUsd: capsLimits[id], spentUsd: Math.max(0, (st[id]?.spent ?? 0) - (st[id]?.assumed?.usd ?? 0)) }])); };
// 0.8.4 (relay of --finish-now): a spending stop is a stop object in the partial report too, so the person-only stop gate can carry it (kind budget_stop, the stage it stopped before, the phase). The round and pass are 1: the id carries the stage, and an answer is bound to ITS stop by the hash of the quote (spent and limit figures).
const budgetStopObjectOf = err => ({ kind: 'budget_stop', overseer_round: 1, pass: 1, label: err.label, phase: err.phase ?? null, ...(err.capName ? { cap_name: err.capName } : {}) });
const reportArgsFor = result => {
  { const relayed = relayedAnswersOf(runDir); if (relayed.length) result.relayed = relayed; const raises = controlHistory(runDir).raises.filter(r => r.consumed); if (raises.length) result.raises = raises; const runControls = runControlsOf(runDir); if (runControls.length) result.run_controls = runControls; const pauses = pausesOf(runDir); if (pauses.length) result.pauses = pauses;   /* S20 slice 1 (H2-k): the raises the run USED, from the gate ledger */ const declined = declinedBySessionOf(runDir); if (declined.length) result.declined_requests = declined; if (ownerRulings.length) result.owner_rulings = ownerRulings; if (handlerRetags.length) result.handler_retags = handlerRetags; }   // B3 prototype: what the handler session relayed, with the person's words
  // FX-11: every field cut this sitting (stage, field, original and kept length), loud in WARNINGS.md and report.json.
  const cuts = fieldCutsSoFar();
  if (cuts.length) {
    result.fieldCuts = cuts;
    appendFileSync(join(runDir, 'WARNINGS.md'), cuts.map(c => `- field_cut: ${c.stage ? `stage "${c.stage}", ` : ''}field "${c.field}" was ${c.original} characters; the next stages read the first ${c.kept}\n`).join(''));
  }
  // Money path #2: the report's total includes what superseded stages cost (they were paid for, in
  // this sitting or an earlier one), shown separately as totals.supersededUsd.
  const supersededUsd = supersededSpendOf(runDir);
  if (unverifiedReplays.length) result.unverifiedReplays = unverifiedReplays;
  if (routeKept().length) result.answeredOnAnotherRoute = routeKept();   // FIX 5: the stages this sitting kept because the route changed (rebuilt every sitting)
  if (wordingKept().length) result.answeredUnderEarlierWording = wordingKept();   // 0.8.4 T14: the stages this sitting kept as saved under THC's earlier wording (rebuilt every sitting); the partial report goes through here too
  if (supersededUsd > 0) result.totals = { ...result.totals, usd: (result.totals.usd || 0) + supersededUsd, supersededUsd };
  // 0.8.3 M2 (D18, CL-117): the superseded records this total absorbed, by label, amount and reservation id, so a lost file does not lose the attribution of its share of `totals.supersededUsd`.
  if (supersededUsd > 0) result.superseded = supersededStagesOf(runDir).map(({ label, usd, reservationId, kind }) => ({ label, usd, reservationId, ...(kind ? { kind } : {}) }));
  // 0.8.4 S5-01: paid stage files no stage row accounts for (a label an earlier sitting paid for and this one never asked) are in the total too, shown as totals.unreplayedUsd, so the report and `--spend` agree.
  foldUnreplayedInto(result, runDir);
  // 0.8.4 unit 2 (D12 part 2): what the provider reported beside THC's count, derived from this folder (src/provider-reported.js, the one reader `--spend` uses too). Counted nowhere; labelled unverified.
  foldProviderReportedInto(result, runDir);
  // 0.8.4 unit 6 (D11; H-U6-b): the count-once figure of this folder and the part of it that is an estimate, as totals.counted (src/counted-spend.js, the reader `--spend` and the floor use too). `totals.usd` keeps its meaning.
  foldCountedInto(result, runDir);
  if (result.ending) result.ending = { ...result.ending, refused_answers: refusedAnswersOf(runDir) };   // 0.8.4 S4 (C&C's Q-f): derived by listing superseded/, never a counter
  { const refusals = refusalRowsOf(runDir); if (refusals.length) result.buildCheckRefusals = refusals; }   // 0.8.4 S18 (RU-S18-02, Q5 (a)): the refused answers as rows, a sibling of build_checks (which stays one row per ANSWERED check: its last row is the decision)
  return {
    runId, chain: config.name, task: taskPathEff, taskCwd: resumeMeta?.cwd || work, taskText: rawTaskTextForCacheFingerprint,
    // A run.json from before 0.7.7 has no startedAt: the report then has no started_at either.
    startedAt: resumeMeta ? (resumeMeta.startedAt ?? null) : runStartedAt, result, config,
    fromRun: fromRun || resumeMeta?.fromRun || null, fromRunCwd: fromRun ? work : (resumeMeta?.cwd || work), maxUsd: maxUsdEff,
    caps: capsArmed.length ? capsReportField() : null,   // unit 4b2
    policyChecks: policyChecks ?? resumeMeta?.policyChecks ?? null, policyWarnings, contextSha256,
    verdictEnvelope: envelopeFlag,
    sittings: (() => { try { const x = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).sittings; return Array.isArray(x) ? x : null; } catch { return null; } })(),   // 0.8.4: one entry per sitting, from run.json (an older run has none)
    tree: treeLineage ? runTreeField(treeLineage) : null,   // 0.8.3 M6 S7: a member's report carries the same `tree` as its run.json (PLAN 10.4); a non-member's has no such key
  };
};

// #16c: the owner's "pause after this round": the chain asks at the head of every pass after the first (src/chain.js setPauseCheck); pauseDue reads the gate ledger and the run folder and never throws. A tree member has none (its verb is refused), an advice call has no passes.
if (!treeLineage) {
  let pauseProblemLogged = false;
  setPauseCheck(round => {
    const due = pauseDue(runDir, round);
    if (due?.problem) { if (!pauseProblemLogged) { pauseProblemLogged = true; log(`  (${due.problem})`); } return null; }
    return due;
  });
  setPauseFinishCheck(round => pauseFinishedFor(runDir, round));   // 0.8.4 (ladder unit): the person's finish AT the pause, read from the ledger, asked before pauseCheck
}
// 0.8.3 M1/M2 (PLAN 7.6 steps 1-5): a tree member claims its node in the tree record HERE, after every pre-flight refusal and before the first paid call, in ONE hold of the tree lock: the accounting gate, the continuation
// checks, the lifetime cap, the claim. The record decides whether this is the node's first start or a resume; a step it does not allow is refused (exit 19, nothing run, nothing spent). The cap this run is held to is
// min(the cap asked for, the node's lifetime cap), re-armed here because setBudget starts the counters again; the earlier spend is counted exactly as above. Its reservations are mirrored into the tree's record. The exit
// hook writes how this sitting ended (node_stopped at the cap, node_closed with a report).
if (treeLineage) {
  try {
    // M4 FIX (C&C): the inputs the run actually reads, as resolved above (absolute), so a member whose registration names a bundle is refused unless they are the bundle's own files
    const start = memberStart({ runDir, runId, lineage: treeLineage, purpose: 'run', capAskedUsd: maxUsdEff, chainPath: configPath, inputs: { task: taskFile, criteria: criteriaPath, context: contextArg || null }, piiGate: piiGateEff, piiAllow: piiAllowEff, allowSecretShaped: allowSecretShapedEff, ceiling: chainIsPaid(config) ? readUsdCeiling() : null, work });
    setBudgetOrExit(start.capUsd);
    countEarlierSpend(earlierSupersededUsd);
    countEarlierSpend(earlierUnsettledUsd);
    countEarlierSpend(earlierSettledNoFile.reduce((n, r) => n + r.usd, 0));   // 0.8.4 item 9a: setBudget above started the counters again, so the settled-without-file seed of the main resume (earlierSettledNoFile) is counted again, as the two lines before it are
    setReservationSink(openReservations(runDir, { mirror: start.mirror }));
    log(`  tree member ${treeLineage.node} (tree ${treeLineage.treeId}): held to ${formatUsd(start.capUsd)} (asked ${formatUsd(maxUsdEff)}, lifetime cap ${formatUsd(start.lifetimeCapUsd)}).`);
    installMemberEndHook({ runDir, runId, lineage: treeLineage, claim: start.claim });
  } catch (err) { exitOnMemberRefusal(err); }
}
if (treeLineage) { clearStopRecords(); stampSitting(); writeStateJson(); }   // C-009: the claim passed, so this sitting now replaces the stop records it is about to change (state.json again: its first write above still saw them)
// 0.8.4 D38: the reads a handling session named in its stage answers are cut, scanned and recorded now, before any stage runs (src/excerpt-resume.js); a hit pauses the run through the catch below, with the stop label
// excerpt-E-<n>. The recorded excerpts (every line the file holds) go to the chain, which shows them from the stage after the one that carried them. Not for an advice call (never resumed) or a descending chain (its
// main run returns before the block hook); with the privacy switch ON nothing is recorded yet (the approval step is a later commit of this unit). Off entirely until the channel's words are recorded.
function prepareExcerpts() {
  if (!excerptChannelOn()) return [];
  const { entries: recordedNow } = readExcerpts(runDir);
  const waiting = () => pendingExcerptCount(runDir, recordedNow);
  if (config.descending) { const n = waiting(); if (n) log(`  session reads: ${n} not recorded: this chain runs in descending mode, which does not show excerpts.`); return []; }   // WORDING D38-w5 (c)
  const sw = excerptSwitchOf(runDir);
  if (!sw.ok) { const n = waiting(); if (n) log(`  session reads: ${n} not recorded: the approval record of this run cannot be read.`); return []; }   // WORDING D10-w2 (replaces D38-w5 (d)); fail closed: nothing is shown without the record
  const savedDrops = readRunJson(runDir, 'run.json')?.secretDrops;
  const drops = Array.isArray(savedDrops) ? savedDrops.filter(d => d && typeof d.label === 'string' && typeof d.stop === 'string') : [];
  let actor = null; try { actor = userInfo().username; } catch { /* no user name on this system: recorded as null */ }
  try {
    const scanOptions = { allow: false, allowed: treeLineage ? null : secretAllow };
    if (sw.on) {   // 0.8.4 D10 (plan A T5.5): the privacy switch is on: the rows that carry text wait at ONE excerpt_approval gate; the answers are applied at the resume after them
      const batch = excerptBatch({ runDir, root: resumeMeta?.cwd || work, drops, scanOptions, actor, hold: true, maxShownLines: SHOWN_LINES_MAX, maxLineNumber: EXCERPT_LINE_NUMBER_MAX });
      for (const line of batch.notes) log(line);
      const gateApi = {
        max: EXCERPTS_MAX,
        waiting: () => { const w = excerptApprovalWaiting(runDir); return w.ok ? w.waiting.map(x => { const st = readGateAnswer(runDir, x.gate); return { id: x.gate, status: st.status, excerpts: st.gate?.excerpts, answer: st.answer }; }) : []; },
        all: () => gatesOfKind(runDir, EXCERPT_APPROVAL_KIND).map(x => ({ id: x.gate, excerpts: readGateAnswer(runDir, x.gate).gate?.excerpts })),   // every excerpt gate, oldest first (a gate asked again is told from the one the rows came from)
        request: ({ screen, excerpts }) => {
          const file = `excerpt-approval-${gatesOfKind(runDir, EXCERPT_APPROVAL_KIND).length + 1}.txt`;
          writeFileSync(join(runDir, file), screen);
          const made = requestGate(runDir, { kind: EXCERPT_APPROVAL_KIND, textPath: file, excerpts });
          return made.ok ? { ok: true, id: made.gate.id } : made;
        },
        recorded: (id, count) => recordExcerptsRecorded(runDir, id, { runId, count }),
      };
      completeUsedGates({ entries: recordedNow, gate: gateApi });   // a crash between the rows and the use line: the line is written now, no row is (src/excerpt-pause.js)
      const step = pauseAtApproval({ batch: batch.inputs, firstId: batch.firstId, gate: gateApi, scanOptions });
      if (step.action === 'asked') {
        const words = excerptWaitWords('pending', `${councilCommand()} gate answer ${runDir} ${step.gateIds[0]}`);
        console.error(`This run is stopped at an approval of excerpts of your project (gate ${step.gateIds[0]}): it ${words.phrase}${step.gateIds.length > 1 ? `, and ${step.gateIds.length - 1} more wait` : ''}. ${words.tail} Nothing was run and nothing was spent.`);   // A-DRAFT, the words of the resume refusal above
        process.exit(EXIT_AWAITING_EXCERPT_APPROVAL);
      }
      const written = recordApproved({ runDir, rows: step.rows, gates: step.gates, gateApi });
      if (written.length) log(`  session reads: ${written.length} recorded as excerpts (${written[0].id} to ${written[written.length - 1].id}).`);
      return liveExcerpts(readExcerpts(runDir).entries);   // A1: a row the switch asked about again is replaced by its answered copy; what no later row replaces is what the seats are shown
    }
    const done = recordSessionReads({ runDir, root: resumeMeta?.cwd || work, drops, scanOptions, actor });
    for (const line of done.notes) log(line);
  } catch (err) {
    if (err?.excerptRefusal) { console.error(err.message); process.exit(2); }   // WORDING D38-w5 (e)
    throw err;   // a SecretShapedPrompt goes to the catch below: the existing pause, with the stop label excerpt-E-<n>
  }
  return liveExcerpts(readExcerpts(runDir).entries);
}
let result;
resetFieldCuts(); // FX-11: this run's record of cut fields (one run per process)
try {
  result = await runChain({
    request,
    config,
    roundChoices,
    ladder: ladderEff,
    ladderRounds: ladderEff ? (ladderRoundsBase ?? resumeMeta?.ladderRounds ?? null) : null,   // a --rounds typed at a resume is his limit from there on (flushed to run.json with the other typed settings); none typed: the saved number
    ladderSteps,
    rulings: ownerRulings,
    retags: handlerRetags,
    draft: handedDraft,
    excerpts: prepareExcerpts(),   // evaluated here, INSIDE the try: a key-shaped hit pauses the run through the catch below
    log,
    // 0.8.3 M3: a tree member is asked for the split block (held words, src/chain.js withSplitNote); any other run is not.
    treeMember: Boolean(treeLineage),
    earlierPlan: memberEarlier ? memberEarlier.text : null,
    // Stable across --resume (the folder name), so run-level decisions such as the canary roll
    // are made once per run, not once per sitting.
    runId,
    onStage: s => {
      // v5 item 3: the in-flight stage just finished (cached or not - a cache hit on resume is
      // still "no longer in flight"), so it's cleared here regardless of the cached early
      // return just below, which only skips the older, non-state.json side effects that are
      // already on disk for a cache hit.
      currentStage = null;
      applyStageCompletion(s.label, s.seat ?? s.lab);
      writeStateJson();
      // 0.8.4 lane C (the persona record, src/persona-record.js stampRow): this row IS the report's row (chain.js record() keeps the object it hands here). A live row is stamped from what its prompt carried when it was built; a
      // replayed row gets back the stamp its own usage.json holds; a session seat's answer, replayed here, is stamped from the note its pause wrote (and the stamp is kept in its usage.json when it has one).
      stampRow(s, config, { dir: runDir, write: writeFileAtomic });
      if (s.cached) {
        // Pre-release cache audit #1: a trusted hit gets the hash of the prompt it was just matched
        // against written back, so an entry cached before prompt hashes existed is checked properly
        // from the next resume on.
        const up = join(runDir, `${s.label}.usage.json`);
        if (s.promptHash && existsSync(up)) {
          try {
            const u = JSON.parse(readFileSync(up, 'utf8'));
            if (!u.promptHash) writeFileAtomic(up, JSON.stringify({ ...scrubPersona(u), promptHash: s.promptHash, inputsFingerprint: u.inputsFingerprint ?? cacheFingerprint, ...(!u.writtenBy && s.writtenBy ? { writtenBy: { ...s.writtenBy, text: textHashOf(s.text) } } : {}) }));   // 0.8.4 T14: an external answer first read here is bound to the hash of the prompt it was SHOWN (a kept replay carries that one) and to the sitting that asked (the pause's prompt.json, merged into the hit), plus the hash of the answer on disk   // a malformed persona stamp is dropped here, never written through
          } catch { /* unreadable: the getter already treats it as a miss next time */ }
        }
        // 0.8.4 T14 (A-DRAFT line): a stage kept as it was saved under THC's earlier wording is named in WARNINGS.md at the moment it is kept, so a sitting that ends at a pause or a stop right after still carries the mark. One line per stage per sitting.
        if (s.answeredOnAnotherRoute) appendFileSync(join(runDir, 'WARNINGS.md'), keptRouteLineOf({ label: s.label, writtenRoute: s.writtenBy?.route ?? 'anthropic', route: claudeRoute, sitting: sittingNo }));   // FIX 5: its own line (A-DRAFT)
        if (s.answeredUnderEarlierWording) appendFileSync(join(runDir, 'WARNINGS.md'), keptLineOf({ label: s.label, version: s.writtenBy?.version, sitting: sittingNo }));
        // Bug audit 2026-09-28 (external seats #2): an external answer is first consumed on a
        // resume, as a cache hit, so it returned here in every sitting and never got the
        // partial-output check (the only truncation signal a stop-less pasted draft has), an
        // audit-log entry, a stage-log line or a span. Its first replay now counts as its
        // completion; only the usage/text writes are skipped (the answer is already on disk).
        if (!(s.provider === 'external' && !stageLogged(s.label))) return;
        { const note = answerNoteOf(s); if (note) log(`  ${note}`); }   // harness (a) S4: a note once per stage, nothing is stopped
      }
      // v2 plan §7.1: validate against the stage contract's required_sections before
      // trusting this deliverable - same class of bug as the lab-dropout fix, just one
      // stage later in the pipeline. Warns loudly and records it; does not, and cannot
      // from here, change chain.js's own in-run control flow (§11: mechanism untouched).
      // 0.8.4 q-warn: a `-question` stage is the builder's prose answer to a blocking question, not a verdict (answerShapeKindOf, src/stage-contract.js): it is checked as prose (the two stop checks, then the empty-text and ends-mid-structure checks), never against a verdict's shape. The kind printed stays stageKindOf's.
      const kind = stageKindOf(s.label);
      if (kind) {
        const check = validateDeliverable(kind, s.text, s.usage, { asProse: answerShapeKindOf(s.label) === null });
        if (!check.ok) {
          log(`  PARTIAL OUTPUT WARNING: stage "${s.label}" (${kind}) - ${check.reason}`);
          appendFileSync(join(runDir, 'WARNINGS.md'), `- partial_output: stage "${s.label}" (${kind}) - ${check.reason}\n`);
        }
      }
      // Both written atomically (temp file + rename), cost first and text last: `<label>.md` is what
      // marks a stage done, so a crash between the two leaves a stage that re-runs rather than a
      // text trusted with no record of its cost, and a crash mid-write never leaves a torn file
      // for a resume to trip over (bug audit 2026-09-23, CLI #8).
      if (!s.cached) {
        writeFileAtomic(join(runDir, `${s.label}.usage.json`), JSON.stringify({ provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms, inputsFingerprint: cacheFingerprint, promptHash: s.promptHash, ...personaUsageFields(s), ...(writtenByNow(textHashOf(s.text)) ? { writtenBy: writtenByNow(textHashOf(s.text)) } : {}), ...(s.capName ? { capName: s.capName } : {}),   /* unit 4b2: the cap the stage billed through (chain.js, caps armed) */
          // 0.8.1 milestone R (additive): what the stage's retry decided, so a resume replays it for free instead of asking again: the cap the answer was
          // asked at, and the no-answer mark of a reply whose thinking used the whole cap.
          ...(Number.isFinite(s.cappedAt) ? { cappedAt: s.cappedAt } : {}), ...(s.noAnswer ? { noAnswer: s.noAnswer } : {}),
          // 0.8.4 unit 1 (D12 part 1, additive): what OpenRouter says it billed and the generation id, beside THC's own `usd`. Absent when the reply carried none.
          ...billedFieldsOf(s), ...discardedFieldOf(s),
          // 0.8.4 unit 6 (D11, additive): what the stage's amount stands for (src/counted-bases.js). Absent on a $0 stage.
          ...basisField(s),
          // 0.8.3 M2 (D18, additive): the reservation that paid for this stage (absent for a mock stage), so the tree's accounting matches this file to its `settled` line by id, not by label.
          ...(s.reservationId ? { reservationId: s.reservationId } : {}),
          // 0.8.4 (S6-03, additive): the endpoint the reply named as having served the call, when it named one (OpenRouter's `provider`), so the record says where this stage ran without the audit log.
          ...endpointField(s) }));
        writeFileAtomic(join(runDir, `${s.label}.md`), s.text);
      }
      if (auditWriter) auditWriter.recordStage(s);
      // v5 §1 candidate 14: one JSONL line per stage, alongside the existing markdown/usage
      // artifacts - structured so future tooling (candidate #9's replay, #2's independence
      // report) can read a run without re-parsing prose. No prompt content, same privacy
      // posture as verdict-stats.js: seat/lab/counts/cost/timing only.
      // V6-2: span_id/parent_span_id turn this flat log into a span tree - every panel/critique
      // stage's parent is its enclosing round's span, everything else's parent is the run root
      // (src/spans.js resolves which).
      appendFileSync(join(runDir, 'stage-log.jsonl'), `${JSON.stringify({
        stage: s.label, seat: `${s.provider}/${s.model}`, lab: s.lab,
        tokensIn: s.usage?.input ?? 0, tokensOut: s.usage?.output ?? 0,
        usd: s.usd, ms: s.ms, outcome: s.text ? 'ok' : 'empty',
        span_id: randomUUID(), parent_span_id: resolveParentSpanId(s.label, rootSpanId, roundSpanIds, randomUUID),
      })}\n`);
      // v6 item 2: this stage's own boundary in spans.jsonl - a separate, purely additive file
      // (src/progress-spans.js), not a rename/replacement of stage-log.jsonl above. started_at is
      // the real timestamp progressHook recorded when this stage began (absent only if this
      // stage's start event was never observed, e.g. a resumed cache-hit path that returns before
      // reaching here - that early-return already skips this whole block, so in practice this is
      // always real for a line that gets written). cost_so_far is real, re-derived from the
      // stage-log.jsonl text this call just appended to, same "derive, never record twice"
      // precedent audit.js/spend.js already use - not a placeholder.
      const stageStart = stageStartedAt.get(s.label) ?? null;
      appendSpanRecord(runDir, buildSpanRecord({
        runId, stage: s.label, round: parseRoundFromLabel(s.label),
        seatsParticipating: [s.lab || `${s.provider}/${s.model}`],
        startedAt: stageStart,
        startedAtReason: stageStart == null ? 'no progressHook startedAt event observed for this stage label' : undefined,
        endedAt: new Date().toISOString(),
        outcome: s.text ? 'ok' : 'empty',
        costSoFar: sumCostFromStageLogText(readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8')).spentUsd,
      }));
      stageStartedAt.delete(s.label);
      // v2 plan §5: regenerate at every stage-completion boundary, always from
      // disk state, never itself trusted as the source of truth.
      writeFileSync(join(runDir, 'RESUME.md'), generateResumeBrief({ runId, dir: runDir, runMeta: { chain: chainNameEff, task: taskPathEff }, chainConfig: config , member: memberNotice }));
    },
  });
} catch (err) {
  if (err instanceof RoundStopped) {
    // Round semantics 2b (Muad 15 Oct 2026; gate note Round_2b_Gate_Note.md, C&C ruling): a layered run reached the overseer-round cap or a layer's revision bound. It is a RESUMABLE stop and the PERSON chooses (continue or finish):
    // the same family as the branches around it: STOPPED-<cause>.json (stop-files.js, so run_status can say why without loading a chain), report-partial.json (the run so far, with the stop), state.json, and NO report.json / deliverable.md
    // (a folder that carries those reads as finished). Thrown before the post-loop stages, so nothing more was spent. Exit 23 (22 is "ended, not agreed", a finished run).
    const stop = err.stop;
    const spentUsd = recordedSpentOf();
    // The plan as it stands is written beside the partial report as deliverable-partial.md (review fix F5, 18 Okt 2026): the revise-N.md stage files still carry the DECLINED trailer lines and a Disputed block, and the partial report holds no draft. Derived copy, through stripDeclined, no verdict.
    // currentDraft is the draft the chain already parsed (chain.js `plan`), not a raw stage reply: its NOTE lines were recorded or counted at the stage that read it, so this is not a raw-text reader (test/note-lines-ignored.test.js ALLOW row). stripDeclined here is defence in depth only.
    const planNow = typeof err.partial?.currentDraft === 'string' ? stripDeclined(err.partial.currentDraft) : '';
    const draftFile = planNow.trim() ? PARTIAL_DELIVERABLE_FILE : null;
    // #16c: the owner's pause is not an overseer limit: its own sentence (src/owner-pause.js), and its marker names the ledger request it stopped for
    const ownerPause = stop.kind === 'owner_pause';
    const sentence = ownerPause ? pauseSentence({ pass: stop.pass, spentUsd, draftFile, runDir }) : stopSentence(stop, { spentUsd, draftFile, runDir, memberTail: memberNotice ? memberStopContinue({ ...memberNotice, stop }, 'round_stop') : null, add: defaultAdd(stop, config), finalRead: finalReadGate(config) });
    try { writeStoppedMarker(runDir, { stoppedBy: stop.kind, beforeFirstCall: false, spentUsd, resumeAfterStop: true, reason: sentence, ...(ownerPause ? { requestSeq: stop.request_seq } : {}) }); }
    catch (e) { log(`  (${stoppedFileOf(stop.kind)} not written: ${e?.message || e})`); }
    try {
      if (err.partial) {
        const shaped = partialReportJsonShape({ stoppedBy: stop.kind, ...reportArgsFor(err.partial) });
        writeAtomic(join(runDir, PARTIAL_REPORT_FILE), JSON.stringify({ ...shaped, stop }, null, 2));
        const partialBoard = renderPartialBoardMd({ runId, result: err.partial, cause: stop.kind, noChooser: stop.no_chooser === true });
        if (partialBoard) writeAtomic(join(runDir, PARTIAL_BOARD_FILE), partialBoard);
        if (draftFile) writeAtomic(join(runDir, PARTIAL_DELIVERABLE_FILE), planNow);
        if (typeof err.partial.scopeLedger === 'string') writeAtomic(join(runDir, SCOPE_LEDGER_FILE), err.partial.scopeLedger);   // the Scope ledger kept apart from the plan (src/scope-ledger.js); only while its switch is on
      }
    } catch (e) { log(`  (${PARTIAL_REPORT_FILE} not written: ${e?.message || e})`); }
    log(`\n${sentence}`);
    finalState();
    process.exit(EXIT_ROUND_STOPPED);
  }
  if (err instanceof PriceRefused) {
    // A3a commit 2 (18 Okt 2026; Muad: "pause the run and ask the user how to proceed with a recommendation"): OpenRouter refused a seat at its price pin. A RESUMABLE stop for the person, exit 24, in the family of the branches around it:
    // STOPPED-price_refused.json (so run_status can say why without loading a chain), report-partial.json with the stop (seat, stage, whether the stage can do without the seat), state.json, and NO report.json / deliverable.md.
    // The refused call cost nothing and nothing is sent after it.
    const spentUsd = recordedSpentOf();
    const set = refusedSet(err);   // the first refusal and the seats of the same stage that rode along (chain.js settleAll)
    const stop = { kind: 'price_refused', seat: set.map(e => e.seat).join(', '), seatKeys: set.map(e => `${e.lab}/${e.seat}`), labels: set.map(e => e.label), label: err.label, skippable: canSkip(err), noSkip: err.noSkip, voices: err.voices, recognised: set.every(e => e.recognised), ownPin: set.some(e => e.ownPin), pin: err.pin };
    const sentence = priceRefusedWords(err, { runPath: join('runs', basename(runDir)), command: councilCommand() });
    try { writeStoppedMarker(runDir, { stoppedBy: 'price_refused', beforeFirstCall: false, spentUsd, resumeAfterStop: true, reason: sentence }); }
    catch (e) { log(`  (${stoppedFileOf('price_refused')} not written: ${e?.message || e})`); }
    try {
      if (err.partial) {
        const shaped = partialReportJsonShape({ stoppedBy: 'price_refused', ...reportArgsFor(err.partial) });
        writeAtomic(join(runDir, PARTIAL_REPORT_FILE), JSON.stringify({ ...shaped, stop }, null, 2));
        const partialBoard = renderPartialBoardMd({ runId, result: err.partial, cause: 'price_refused' });
        if (partialBoard) writeAtomic(join(runDir, PARTIAL_BOARD_FILE), partialBoard);
      }
    } catch (e) { log(`  (${PARTIAL_REPORT_FILE} not written: ${e?.message || e})`); }
    log(`\n${sentence}`);
    // 0.8.3 (Muad 21 Okt 2026): with a person at the terminal the run asks to raise the price and goes on in the same breath instead of only stopping (src/price-raise.js). Every other case keeps the stop above, unchanged.
    let raisedAndResume = false;
    try {
      const mayAsk = mayOffer({ set, tty: Boolean(process.stdin.isTTY && process.stdout.isTTY), member: Boolean(memberNotice || treeLineage) });
      if (mayAsk.ok) {
        const rl = createReadlineInterface({ input: process.stdin, output: process.stdout });
        try {
          const seatOf = e => everySeatOf(config).find(s => `${s.provider}/${s.model}` === e.seat);
          // what a host must support to serve the seat (needsOfSeat): the output cap (the default when the seat names none) and reasoning, which counts when the call carries a reasoning field (the harness's high default included) or the model reasons by itself above high; a seat this chain does not name gets no offer
          const needsOf = e => { const s = seatOf(e); if (!s) throw new Error(`${e.seat} is not a seat of this chain`); return needsOfSeat(s, SEAT_DEFAULT_MAX_TOKENS); };
          const offer = await offerPriceRaise({ set, folder: resumeMeta?.cwd ?? work, capUsd: maxUsdEff, needsOf, ask: q => askLine(rl, q), say: m => console.log(`\n${m}`) });
          if (!offer.offered) console.log(`\nNo price offer: ${offer.why}.`);
          raisedAndResume = offer.raised === true;
        } finally { rl.close(); }
      }
    } catch (e) { console.error(`\nNo price offer: ${e?.message || e}. The stop above stands.`); }
    finalState();
    if (raisedAndResume) resumeAtExit({ runPath: resolve(runDir), entry: process.argv[1], cwd: resumeMeta?.cwd ?? work, spawn: spawnSync });
    process.exit(EXIT_PRICE_REFUSED);
  }
  if (err instanceof ConflictAsked) {
    // E4b unit 3: the decider asked for the person to choose between the objections of a swing. A RESUMABLE stop, exit 25, before the revise: STOPPED-conflict.json, report-partial.json with the stop (the asked conflicts and the decider's lean),
    // state.json, and NO report.json / deliverable.md. The decider's ruling is already on disk (its stage file), so a resume replays it for free and never pays the seat again.
    const spentUsd = recordedSpentOf();
    const stop = { kind: 'conflict', pass: err.pass, ...(Number.isInteger(err.overseerRound) ? { overseer_round: err.overseerRound } : {}), conflicts: err.asked };
    // a tree member's answer goes through its tree (`tree decide --prevail-node`, then `tree resume`), never `--resume --prevail` on the member's own folder
    const sentence = conflictAskedWords(stop, { runPath: join('runs', basename(runDir)), command: councilCommand(), choose: memberNotice ? memberStopContinue({ ...memberNotice, picksTemplate: stop.conflicts.map(c => `${c.n}=<${c.ids.join('|')}|neither>`).join(',') }, 'conflict') : null });
    try { writeStoppedMarker(runDir, { stoppedBy: 'conflict', beforeFirstCall: false, spentUsd, resumeAfterStop: true, reason: sentence }); }
    catch (e) { log(`  (${stoppedFileOf('conflict')} not written: ${e?.message || e})`); }
    try {
      if (err.partial) {
        const shaped = partialReportJsonShape({ stoppedBy: 'conflict', ...reportArgsFor(err.partial) });
        writeAtomic(join(runDir, PARTIAL_REPORT_FILE), JSON.stringify({ ...shaped, stop }, null, 2));
        const partialBoard = renderPartialBoardMd({ runId, result: err.partial, cause: 'conflict' });
        if (partialBoard) writeAtomic(join(runDir, PARTIAL_BOARD_FILE), partialBoard);
      }
    } catch (e) { log(`  (${PARTIAL_REPORT_FILE} not written: ${e?.message || e})`); }
    log(`\n${sentence}`);
    finalState();
    process.exit(EXIT_CONFLICT_ASKED);
  }
  if (err instanceof PreflightBlocked) {
    // Same posture as BudgetExceeded below: deliberately no report.json/deliverable.md - a
    // preflight objection means propose/build never ran, so there is no deliverable to report
    // on. preflight-verdict.json is its own artifact and is written whether or not the run
    // blocks (a resumed/fixed task file re-runs preflight fresh, same as any other stage).
    writeFileSync(join(runDir, 'preflight-verdict.json'), JSON.stringify(err.preflight, null, 2));
    const objections = err.preflight.verdicts.filter(v => v.verdict === 'object' && v.objections.length);
    writeFileSync(join(runDir, 'STOPPED-preflight.md'), `# Run stopped: preflight objected to the task description

This run stopped before \`criteria\`/\`proposals\`/\`build\` ever ran - no diff or proposal exists
for this run.

${objections.map(v => `- **${v.lab}**: ${v.objections.join(' / ')}`).join('\n')}

${memberNotice ? `The task description is this node's own task file, written by the tree. Nothing here is resumable the way an external pause is: no stage after preflight ever started.

${memberStopContinue(memberNotice, 'preflight')}` : `Fix the task description (this run's own task file, not a diff), then re-run. Nothing here is
resumable via \`--resume\` the way an \`ExternalPause\` is, since no stage after preflight ever
started.
`}`);
    log(`\nSTOPPED: preflight objected to the task description (${objections.length} seat(s)).`);
    log(`  detail:  ${join(runDir, 'STOPPED-preflight.md')}`);
    log(`  verdict: ${join(runDir, 'preflight-verdict.json')}`);
    finalState();
    process.exit(EXIT_PREFLIGHT_BLOCKED);
  }
  if (err instanceof DraftTruncated) {
    // Same posture as the budget and preflight stops: no report.json and no deliverable.md, so a
    // stopped run never reads as a finished one. The cut-off replies are on disk under their own
    // labels for inspection. A resume replays them from disk and stops again until the chain gives
    // that seat a larger maxTokens (which changes the chain, so the stage is asked again) or the
    // external reply is replaced with a complete one.
    const stopped = { stage: err.label, detail: err.detail, ...(err.stop ? { stop: err.stop } : {}), spentUsd: recordedSpentOf() };
    writeFileSync(join(runDir, 'STOPPED-truncated.json'), JSON.stringify(stopped, null, 2));
    // M4 (bug audit 2026-09-27): a draft the provider ended with error/content_filter/refusal stops
    // here too, and the message names that stop instead of calling it cut off.
    writeFileSync(join(runDir, 'STOPPED-truncated.md'), err.stop === 'declined_only' ? `# Run stopped: the reply held no draft

Stage \`${err.label}\` came back with only DECLINED lines (${err.detail}): the model declined every objection and wrote no plan, so there is nothing to grade.

Nothing after this stage ran, and there is no \`report.json\` or \`deliverable.md\` for this run. Raising a token limit does not help.

${memberNotice ? `To continue: replace \`${err.label}.md\` with a complete plan (or move it aside to ask the seat again).

${memberStopContinue(memberNotice, 'truncated')}` : `To continue: replace \`${err.label}.md\` with a complete plan (or move it aside to ask the seat again), then \`--resume\` this run.
`}` : err.stop ? `# Run stopped: a draft did not complete

Stage \`${err.label}\` came back unfinished: the provider ended it with stop "${err.stop}" (${err.detail}).

An unfinished draft is never graded, reported or shipped. Nothing after this stage ran, and there is no
\`report.json\` or \`deliverable.md\` for this run.

To continue: the replies are on disk as \`${err.label}.md\` and \`${err.label}-retry.md\`, and a resume replays
them. Move both aside to ask the seat again (or, for an external seat, replace \`${err.label}.md\` with a
complete reply)${memberNotice ? '.' : ', then \`--resume\` this run.'} A "content_filter" or "refusal" stop usually needs a changed task
or a different seat.
${memberNotice ? `
${memberStopContinue(memberNotice, 'truncated')}` : ''}` : `# Run stopped: a draft was cut off at its token cap

Stage \`${err.label}\` produced a reply that ended at the seat's token limit: ${err.detail}.

A cut-off draft is never graded, reported or shipped. Nothing after this stage ran, and there is no
\`report.json\` or \`deliverable.md\` for this run.

${memberNotice ? `To continue: for an external seat, replace \`${err.label}.md\` with a complete reply; for any other seat the cause is its \`maxTokens\` in the chain, which the tree pins.

${memberStopContinue(memberNotice, 'truncated')}` : `To continue: raise that seat's \`maxTokens\` in the chain (or, for an external seat, replace
\`${err.label}.md\` with a complete reply), then \`--resume\` this run.
`}`);
    log(err.stop ? `\nSTOPPED: stage "${err.label}" did not complete (stop: ${err.stop}) - ${err.detail}.` : `\nSTOPPED: stage "${err.label}" was cut off at its token cap - ${err.detail}.`);
    log(`  detail:  ${join(runDir, 'STOPPED-truncated.md')}`);
    finalState();
    process.exit(EXIT_DRAFT_TRUNCATED);
  }
  if (err instanceof ExternalPause) {
    // A parallel stage with several external seats pauses on all of them at once (settleAll
    // attaches the siblings): one NEEDS file per seat, so they can be answered in parallel. The
    // run resumes once every one has its <label>.md; answering only some just pauses again on
    // the rest.
    const pauses = pendingPauses(err);
    // 0.8.4 S18 (Q5 (b), WORDING S18-w6; HELD behind `buildCheckRefusalNote`): a build check that was refused says why at the top of its NEEDS file, from the latest refusal row on disk; the check's prompt text (and its hash) is untouched.
    const refusalNoteFor = label => { const note = held('buildCheckRefusalNote'); if (typeof note !== 'function' || !/^(?:build-check|sort)-\d+$/.test(label)) return ''; const r = latestRefusalOf(runDir, label); return r ? `${note({ why: r.why, missing: r.missing, label })}\n\n` : ''; };
    for (const p of pauses) {
      const need = join(runDir, `NEEDS-${p.label}.md`);
      // 2 Nov 2026 (near-JSON pause, src/near-json.js): a paid reply that was almost JSON. Its text is set aside in originals/ (3 Nov 2026: its usage record stays at its label, counted there), the marker (with the prompt hash and the inputs fingerprint the repair is held to) is written as `<label>.repair.json` by setAsideOriginal, no `<label>.prompt.json` is written for it, and the request below says what to write.
      // The answer is written and the run resumed exactly as for an external seat (the file name, the rename, MCP submit_stage); src/stage-cache.js checks it against the original when the run reads it.
      if (p.repair) {
        setAsideOriginal({ runDir, label: p.label, promptHash: p.promptHash, fingerprint: cacheFingerprint, refusal: p.repair.refusal, kind: p.repair.kind ?? 'near_json', criteria: p.repair.criteria ?? null, rows: p.repair.rows ?? null, slips: p.repair.slips ?? null, shown: p.repair.shown ?? null });
        const how = memberNotice
          ? `This stage belongs to a recursive-councils tree member (${memberWho(memberNotice, p.label)}). Write the repaired reply to \`${join(runDir, `${p.label}.md.partial`)}\`, rename it to \`${join(runDir, `${p.label}.md`)}\` when it is complete (never write it in place), and run, in a terminal:\n\n    ${memberResumeCommand(memberNotice, councilCommand())}\n\n`
          : `Write the repaired reply to \`${join(runDir, `${p.label}.md.partial`)}\`, rename it to \`${join(runDir, `${p.label}.md`)}\` when it is complete (the run resumes as soon as that name exists, so never write it in place), and run:\n\n    ${councilCommand()} --resume runs/${runId}\n\n`;
        writeFileSync(need, withIntegrityFooter(p.repair.kind === 'table_rows'
          ? tableRepairNeedsBody({ label: p.label, askedFor: p.askedFor, original: p.repair.original, refusal: p.repair.refusal, how, criteria: p.repair.criteria ?? [], rows: p.repair.rows ?? [] })
          : p.repair.kind === 'id_slip'   // 4 Nov 2026 (unit 8): an objection id one character off
          ? idSlipRepairNeedsBody({ label: p.label, askedFor: p.askedFor, original: p.repair.original, refusal: p.repair.refusal, how, slips: p.repair.slips ?? [], shown: p.repair.shown ?? [] })
          : repairNeedsBody({ label: p.label, askedFor: p.askedFor, original: p.repair.original, refusal: p.repair.refusal, how, system: p.repair.shownSystem ?? p.system, ...(p.repair.shownSystem ? { systemWhere: held('repairFormatWhereOrder')?.() ?? null } : {}) })));
        continue;
      }
      // The prompt this answer will be held to on resume (resume-cache audit #1/#4).
      writeFileAtomic(join(runDir, `${p.label}.prompt.json`), JSON.stringify({ provider: 'external', promptHash: p.promptHash, inputsFingerprint: cacheFingerprint, ...(p.textRequests?.length ? { text_requests: p.textRequests } : {}), ...(writtenByNow(null) ? { writtenBy: writtenByNow(null) } : {}), ...(personaPauseNote(p.label, config) ? { persona_note: personaPauseNote(p.label, config) } : {}) }));   // 0.8.4 lane C: the persona set this prompt was built from, kept for the answer's row
      // FX-13: the run resumes as soon as <label>.md exists, so a seat that writes it in place can expose half an answer.
      // It writes <label>.md.partial and renames it when finished (a rename is one step); nothing reads a .partial file.
      // 0.8.3 M5f (the maintainer, 10 Oct: the accident is a person typing `council --resume runs/<child>` because THIS file told them to): a tree MEMBER's notice names the tree, node, run and stage and gives the tree's
      // command as THE command; the direct --resume line is absent, not merely accompanied.
      // 0.8.4 slot H2-f (D30, plan A T1.5): both forms carry the held excerpt paragraph (src/excerpt-record.js externalStageBlock, '' while it is not recorded) right above "## System prompt", so it sits outside the system and user text the prompt hash covers.
      writeFileSync(need, withIntegrityFooter(memberNotice ? `# External stage: ${p.label}\n\n${refusalNoteFor(p.label)}This stage belongs to a recursive-councils tree member (${memberWho(memberNotice, p.label)}).\n\nWrite the reply to \`${join(runDir, `${p.label}.md.partial`)}\`, rename it to \`${join(runDir, `${p.label}.md`)}\` when it is complete (never write it in place), and run, in a terminal:\n\n    ${memberResumeCommand(memberNotice, councilCommand())}\n\nThe tree resumes this node and holds the answer to the prompt below; a tree member is not resumed alone.\n\n${askedForSentence(p.askedFor)}${needsRequestsBlock(p.textRequests)}${externalStageBlock()}## System prompt\n\n${p.system}\n\n## User prompt\n\n${p.user}` : `# External stage: ${p.label}\n\n${refusalNoteFor(p.label)}Write the reply to \`${join(runDir, `${p.label}.md.partial`)}\`, rename it to \`${join(runDir, `${p.label}.md`)}\` when it is complete (the run resumes as soon as that name exists, so never write it in place), and run:\n\n    ${councilCommand()} --resume runs/${runId}\n\n${askedForSentence(p.askedFor)}${needsRequestsBlock(p.textRequests)}${externalStageBlock()}## System prompt\n\n${p.system}\n\n## User prompt\n\n${p.user}`));
    }
    if (pauses.length === 1 && err.repair) {
      log(err.repair.kind === 'table_rows'   // 3 Nov 2026: a table pause says what it is (A-DRAFT); the NEEDS file holds the request
        ? `\nPAUSED: stage "${err.label}" got a sign-off table whose rows could not be matched to the criteria; it needs a repair (only a row's criterion text may change).`
        : err.repair.kind === 'id_slip'   // 4 Nov 2026 (unit 8, A-DRAFT)
        ? `\nPAUSED: stage "${err.label}" got a reply that names an objection id one character off; it needs a repair (only that id may change).`
        : `\nPAUSED: stage "${err.label}" got a reply that is almost JSON; it needs a repair (no word changed).`);
      log(`  request: ${join(runDir, `NEEDS-${err.label}.md`)}`);
      log(`  answer:  write ${join(runDir, `${err.label}.md.partial`)}, then rename it to ${err.label}.md when complete`);
    } else if (pauses.length === 1) {
      log(`\nPAUSED: stage "${err.label}" is an external seat.`);
      log(`  prompt:  ${join(runDir, `NEEDS-${err.label}.md`)}`);
      log(`  answer:  write ${join(runDir, `${err.label}.md.partial`)}, then rename it to ${err.label}.md when complete`);
    } else {
      log(`\nPAUSED: ${pauses.length} external seats are waiting (answer each, in any order):`);
      for (const p of pauses) log(`  ${p.label}:  ${p.repair ? 'repair request' : 'prompt'} ${join(runDir, `NEEDS-${p.label}.md`)}  ->  answer ${join(runDir, `${p.label}.md.partial`)}, renamed to ${p.label}.md when complete`);
    }
    log(memberNotice ? `  resume:  ${memberResumeCommand(memberNotice, councilCommand())}   (${memberWho(memberNotice, null)}; a tree member is resumed only by its tree)` : `  resume:  ${councilCommand()} --resume runs/${runId}`);
    if (budgetFinishNow) log(`  your --finish-now is on record: after the answer, resume as usual and the run ends without asking for a limit (to raise the limit instead, resume with --raise-cap).`);   // WORDING LAD-B12
    finalState();
    process.exit(3);
  }
  if (err instanceof UnpricedSeat) {
    // Reached only when a call got past the start-of-run refusal (a model resolved at call time): the run stops before the call, keeps what it has on disk and can resume after a price row is added or with --max-usd none.
    const [provider, ...rest] = err.seat.split('/');
    console.error(`\n${formatCouncilError('COUNCIL-E002', { provider, model: rest.join('/'), problem: priceProblemOf(provider, rest.join('/')), roles: err.label, capUsd: err.cap })}`);
    finalState();
    process.exit(EXIT_DEGRADABLE);
  }
  if (budgetFinishNow && (err instanceof NotRunForLimit || err instanceof BudgetExceeded)) {
    // 0.8.4 (--finish-now at a spending stop; C&C 10 Nov: never a second budget stop). Two ways to get here: a call BEFORE the review rounds would bill (a stage the run folder no longer holds; NotRunForLimit), or a kept limit fired in this sitting (BudgetExceeded: a call
    // escaped invoke()'s own stop; the cap refused it before any reservation). Neither writes a stop: the stop files were not set aside (they go only when the run ended), so the run is exactly as it was stopped, nothing was sent, and the person is told what is still open.
    console.error(`\n${err instanceof NotRunForLimit ? finishNowBeforeRounds(err.label, runDir) : finishNowLimitFired(err.label, runDir)}`);   // WORDING LAD-B2b, LAD-B10
    finalState();
    process.exit(4);
  }
  if (err instanceof BudgetExceeded) {
    // Deliberately NO report.json and NO deliverable.md: a run folder that
    // carries those reads as a finished run everywhere else in this codebase.
    // What lands instead says plainly that the run stopped short.
    const state = budgetState();
    // Unit 4b2: a stop at ONE per-provider cap (err.capName, with the caps armed). err.spent and err.cap are that cap's; the run total is written beside them, never
    // mixed into the cap's figure (no Math.max with the run total). Continuing such a run is the resume unit's (4c): the stop says so instead of offering a command.
    const capStop = err.capName && capsArmed.length ? (state.caps?.[err.capName] ?? null) : null;
    if (capStop) {
      err.spent = Math.max(err.spent || 0, capStop.spent);   // money path #1, per cap: the cap's spend after the in-flight siblings settled
      const capAssumed = capStop.assumed?.usd || 0;
      const capSpent = Math.max(0, err.spent - capAssumed);
      const runSpent = Math.max(0, state.spent - (state.assumed?.usd || 0));
      const capFloor = capSpent + capAssumed;   // unit 4c1: the raise's floor and the suggestion's base are this cap's own figures, never the run total
      const capSmallest = resumeCeilingUsd({ cap: err.cap, spent: capFloor, projected: err.projected, gate: err.gate });
      writeFileSync(join(runDir, 'STOPPED-budget.json'), JSON.stringify({
        stoppedAt: err.label, seat: err.seat, spentUsd: runSpent, capName: err.capName, capUsd: err.cap, capSpentUsd: capSpent, ...(capAssumed > 0 ? { capAssumedUsd: capAssumed } : {}),
        projectedStageUsd: err.projected, gateStageUsd: err.gate, ...assumedAtWorstCase(state), ...(err.phase ? { phase: err.phase } : {}),
        note: err.retryRefused ? 'Stopped before the retry of the stage above was sent: its first attempt was paid for and is counted.' : 'Stopped before the stage above was paid for.',
      }, null, 2));
      let capPartial = false;
      if (err.partial) {
        if (!err.partial.stop && !memberNotice) err.partial.stop = budgetStopObjectOf(err);   // a tree member's partial report is written exactly as before: no stop object
        try { writeAtomic(join(runDir, PARTIAL_REPORT_FILE), JSON.stringify(partialReportJsonShape({ stoppedBy: 'budget', stoppedAtStage: err.label, ...reportArgsFor(err.partial) }), null, 2)); const pb = renderPartialBoardMd({ runId, result: err.partial, stoppedAtStage: err.label }); if (pb) writeFileSync(join(runDir, PARTIAL_BOARD_FILE), pb); capPartial = true; } catch (e) { log(`  (${PARTIAL_REPORT_FILE} not written: ${e?.message || e})`); }
      }
      // A-DRAFT (unit 4b2): the stop names the cap
      // A tree member never reaches this branch today (with the caps switch on, src/caps.js refuses a member's start and its resume, exit 19), but the member
      // text goes through memberStopContinue like every other STOPPED-*.md writer (test/tree-member-stops.test.js), so the branch cannot ship a bare --resume.
      writeFileSync(join(runDir, 'STOPPED-budget.md'), `# Run stopped: the ${err.capName} spend cap reached

${err.retryRefused ? `This run stopped **inside** stage \`${err.label}\` (${err.seat}): its first attempt was paid for and is counted,
and the retry at a bigger cap was not sent.` : `This run stopped **before** stage \`${err.label}\` (${err.seat}) was called, so that stage was
never paid for.`}

- spent so far through ${err.capName}: **${formatUsd(capSpent)}**
- the ${err.capName} cap: **${formatUsd(err.cap)}**
- spent by the whole run: **${formatUsd(runSpent)}**
- that stage could have cost up to: **${formatUsd(err.projected)}**
${capPartial ? `- what the run has so far, as data: \`${PARTIAL_REPORT_FILE}\` (same shape as report.json, \`partial: true\`)\n` : ''}
Stage cost is projected as the whole prompt billed as input plus the seat's entire \`maxTokens\`
budget billed as output, so the real cost would very likely have been lower. The ceiling is
checked against a call's expected cost; only a call with no expected size and an answer-back call are
checked against this worst case.

${memberNotice ? `## Continue it

Every completed stage is on disk and replays for free, so resuming only pays for what is left.

${memberStopContinue(memberNotice, 'budget')}` : `## Continue it

Every completed stage is on disk and replays for free, so resuming only pays for what is left. The run asks for a new total for the ${err.capName} cap, above ${formatUsd(capFloor)} (what it has counted through ${err.capName}); the smallest total that lets the next call to a model be sent is ${formatUsd(capSmallest)}:

Relayed by the handler session, with the person's words:

    ${councilCommand()} --resume runs/${runId} --raise-cap ${err.capName} --relayed

Typed by the person at a terminal:

    ${councilCommand()} --resume runs/${runId}
${finishNowScreen({ command: councilCommand(), runId, phase: err.phase, hasHandoff: Boolean(config.handoff) })}`}`);
      log(err.retryRefused ? `\nSTOPPED: the ${err.capName} spend cap reached before the retry of stage "${err.label}".` : `\nSTOPPED: stage "${err.label}" would pass the ${err.capName} spend cap, so it was not called.`);   // A-DRAFT
      log(`  spent:   ${formatUsd(capSpent)} through ${err.capName}, of its ${formatUsd(err.cap)} cap`);
      log(`  stage:   ${err.seat} could cost up to ${formatUsd(err.projected)}`);
      log(`  detail:  ${join(runDir, 'STOPPED-budget.md')}`);
      if (capPartial) log(`  so far:  ${join(runDir, PARTIAL_REPORT_FILE)}`);
      log(memberNotice ? `  resume:  ${memberTopUpCommand(memberNotice)}, then ${memberResumeCommand(memberNotice)}   (${memberWho(memberNotice, null)}; a tree member is resumed only by its tree)` : `  resume:  ${councilCommand()} --resume runs/${runId} --raise-cap ${err.capName} --relayed   (the handler session relays the person's new ${err.capName} total, above ${formatUsd(capFloor)})`);   // A-DRAFT
      if (!memberNotice) log(`  or:      ${councilCommand()} --resume runs/${runId}   (the person types the new ${err.capName} total at a terminal)`);   // A-DRAFT
      if (!memberNotice && (err.phase === 'loop' || err.phase === 'after')) log(`  or:      ${councilCommand()} --resume runs/${runId} --finish-now   (ends the run here at no cost; see ${join(runDir, 'STOPPED-budget.md')})`);   // WORDING LAD-B1b
      finalState();
      process.exit(4);
    }
    // Money path #1: the budget after the in-flight siblings settled, not err.spent from the moment
    // the cap was hit (see writeSideRunBudgetStop).
    err.spent = Math.max(err.spent || 0, state.spent);
    writeFileSync(join(runDir, 'STOPPED-budget.json'), JSON.stringify({
      stoppedAt: err.label,
      seat: err.seat,
      spentUsd: stoppedSpentUsd(err, state),
      capUsd: err.cap,
      projectedStageUsd: err.projected,
      gateStageUsd: err.gate,
      ...assumedAtWorstCase(state),
      ...(err.phase ? { phase: err.phase } : {}),   // 0.8.4 S16 (F): before | loop | after the review rounds
      note: err.retryRefused ? 'Stopped before the retry of the stage above was sent: its first attempt was paid for and is counted. On resume this stage starts over; completed stages are on disk and replay for free.' : 'Stopped before the stage above was paid for. Completed stages are on disk and replay for free on resume.',
    }, null, 2));
    // report-partial.json (0.7.7): the run so far as data, in report.json's shape plus partial: true,
    // so a run capped after many rounds can be read without rebuilding it from its stage files. Its
    // own name, because report.json means "finished". Writing it must never mask the stop itself.
    let partialWritten = false;
    if (err.partial) {
      if (!err.partial.stop && !memberNotice) err.partial.stop = budgetStopObjectOf(err);   // a tree member's partial report is written exactly as before: no stop object
      try {
        writeAtomic(join(runDir, PARTIAL_REPORT_FILE), JSON.stringify(partialReportJsonShape({
          stoppedBy: 'budget', stoppedAtStage: err.label, ...reportArgsFor(err.partial),
        }), null, 2));
        const partialBoard = renderPartialBoardMd({ runId, result: err.partial, stoppedAtStage: err.label });
        if (partialBoard) writeFileSync(join(runDir, PARTIAL_BOARD_FILE), partialBoard);
        partialWritten = true;
      } catch (e) {
        log(`  (${PARTIAL_REPORT_FILE} not written: ${e?.message || e})`);
      }
    }
    writeFileSync(join(runDir, 'STOPPED-budget.md'), `# Run stopped: per-run spend cap reached

${err.retryRefused ? `This run stopped **inside** stage \`${err.label}\` (${err.seat}): its first attempt was paid for and is counted,
and its retry (the same stage with a bigger allowance for the call) was not sent: the run's spending limit would not cover it.` : `This run stopped **before** stage \`${err.label}\` (${err.seat}) was called, so that stage was
never paid for.`}

- spent so far: **${formatUsd(stoppedSpentUsd(err, state))}**
- ceiling: **${formatUsd(err.cap)}**
- that stage could have cost up to: **${formatUsd(err.projected)}**
${partialWritten ? `- what the run has so far, as data: \`${PARTIAL_REPORT_FILE}\` (same shape as report.json, \`partial: true\`)\n` : ''}
Stage cost is projected as the whole prompt billed as input plus the seat's entire \`maxTokens\`
budget billed as output, so the real cost would very likely have been lower. The ceiling is
checked against a call's expected cost; only a call with no expected size and an answer-back call are checked against this worst case.

${memberNotice ? `## Continue it

Every completed stage is on disk and replays for free, so resuming only pays for what is left.

${memberStopContinue(memberNotice, 'budget')}` : `## Continue it

Every completed stage is on disk and replays for free, so resuming only pays for what is left:

${budgetStopContinue(err, state, runId, config)}
${finishNowScreen({ command: councilCommand(), runId, phase: err.phase, hasHandoff: Boolean(config.handoff) })}`}`);
    log(err.retryRefused ? `\nSTOPPED: per-run spend cap reached before the retry of stage "${err.label}".` : `\nSTOPPED: per-run spend cap reached before stage "${err.label}".`);
    log(`  spent:   ${spentWords(err, state)} of ${formatUsd(err.cap)} ceiling`);
    log(`  stage:   ${err.seat} could cost up to ${formatUsd(err.projected)}`);
    log(`  detail:  ${join(runDir, 'STOPPED-budget.md')}`);
    if (partialWritten) log(`  so far:  ${join(runDir, PARTIAL_REPORT_FILE)}`);
    log(memberNotice ? `  resume:  ${memberTopUpCommand(memberNotice)}, then ${memberResumeCommand(memberNotice)}   (${memberWho(memberNotice, null)}; a tree member is resumed only by its tree)` : chainIsPaid(config) ? `  resume:  ${councilCommand()} --resume runs/${runId}   (asks for a new total above ${formatUsd(err.spent || 0)})` : `  resume:  ${councilCommand()} --resume runs/${runId} --max-usd <higher>`);
    if (!memberNotice && (err.phase === 'loop' || err.phase === 'after')) log(`  or:      ${councilCommand()} --resume runs/${runId} --finish-now   (ends the run here at no cost; see ${join(runDir, 'STOPPED-budget.md')})`);   // WORDING LAD-B1b
    finalState();
    process.exit(4);
  }
  if (err instanceof SecretShapedPrompt) {
    // Model output or the chain's own prompt text, not an input file (those were scanned before the
    // run started): the prompt of this stage holds a key shape. Nothing was sent.
    // 0.8.4 (Muad 8 Nov 2026: "It should pause not stop"): a run PAUSES here (src/secret-pause.js): resumable, not ended, and only the person's `--continue` at a terminal sends the stage. An ADVICE call
    // is never resumed (its approval is used up), so it ends, as at the budget stop above, and its marker names no resume line. A tree MEMBER keeps its old stop and its tree command. Exit 11 and
    // STOPPED-secret.md stay for every form: old readers (spend, handoff-from-run, run_status) still find them.
    const pausing = !memberNotice;
    writeFileSync(join(runDir, 'STOPPED-secret.md'), memberNotice ? secretMemberStopText(err, memberStopContinue(memberNotice, 'secret'))
        : secretPauseText(err, { runId, command: councilCommand(), ending: err.phase === 'loop' ? (() => { const e = secretEndingOf(config, { typedReads: ladderTypedReads(roundChoices) }); return e ? secretEndingSentence(e) : null; })() : null }));
    // The pause record is written AFTER the marker and only when it is a whole secret-stop/1 file with value hashes; a record that cannot be written leaves the old shape (marker only), which fails closed.
    if (pausing) { try { writeAtomic(join(runDir, SECRET_STOP_FILE), `${JSON.stringify(secretStopRecord(err), null, 2)}\n`); } catch (e) { log(`  (${SECRET_STOP_FILE} not written: ${e?.message || e})`); } }
    log(`\n${pausing ? 'PAUSED' : 'STOPPED'}: ${err.message}.${pausing ? ' The run is waiting for your choice.' : ''}`);
    for (const f of err.findings) log(`  ${f.part} prompt, line ${f.line}: ${f.name}`);
    if (pausing) log(`  choose:  ${councilCommand()} --resume runs/${runId} --continue, at a terminal`);
    if (pausing && isExcerptLabel(err.label)) log(`  or:      ${councilCommand()} --resume runs/${runId} --drop-excerpt, at a terminal`);   // WORDING D38-w7
    log(`  detail:  ${join(runDir, SECRET_MARKER_FILE)}`);
    // 0.8.1 FX-7: state.json at rest says the run stopped, like every other stop exit.
    finalState();
    process.exit(EXIT_PII_BLOCKED);
  }
  // A denied model is a lint failure (exit 1), found at run time instead of by chain-lint.
  const denied = err instanceof DeniedModel;
  // 0.8.4 S16 (K; D32, T21r, T21bb; WORDING S16-w57/w58): a failed run on a chain with a final read says the final read has not run. No paid call is made on this path; the flag is read from the run folder (no final-read stage file) and the chain.
  const finalReadOwed = !denied && (() => { try { return finalReadGate(config) && !readdirSync(runDir).some(f => /^final-read-.+\.md$/.test(f)); } catch { return false; } })();
  const owedLayer = (() => { const l = Math.max(...(config?.seats?.critics ?? []).map(c => c.layer).filter(Number.isInteger)); return Number.isFinite(l) ? `layer ${l}` : 'the top layer'; })();
  const owedSentence = finalReadOwed ? `The final read of ${owedLayer} has not run yet: it is still owed, and this run cannot end before it has run.` : '';
  writeFileSync(join(runDir, 'STOPPED-error.md'), `# Run stopped: ${denied ? 'a denied model' : 'an error'}

${err?.message || String(err)}

${owedSentence ? `${owedSentence}

` : ''}No report.json or deliverable.md was written, so this run does not read as finished. Completed
stages are on disk and replay for free${memberNotice ? '.' : ': fix the cause, then'}

${memberNotice ? memberStopContinue(memberNotice, 'error') : `    ${councilCommand()} --resume runs/${runId}
`}`);
  // The same stop as data (0.8.0 WM0): what failed, and whether asking the same question again could
  // succeed (a provider that was down or rate-limiting) or will fail the same way (a guard, a lint).
  writeFileSync(join(runDir, 'STOPPED-error.json'), JSON.stringify({
    exitCode: denied ? 1 : EXIT_RUN_FAILED,
    kind: denied ? 'denied_model' : 'error',
    name: err?.name || 'Error',
    message: String(err?.message || err).slice(0, 500),   // the refusal sentence is longer than 500 characters and is read back whole (MCP)
    ...(Number.isInteger(err?.status) ? { httpStatus: err.status } : {}),
    transient: !denied && isRetryable(err ?? {}),
    maybeBilled: err?.maybeBilled === true,
    ...(finalReadOwed ? { final_read_owed: true } : {}),   // S16 (K, C&C 09 Nov): additive; absent unless the final read is still owed
    ...(denied ? {} : { causeClass: causeClassOf(err) }),   // 0.8.4 S6-02 (additive): transport / http_status / provider_body / unreadable_reply / other, from the error's flags only; `transient` keeps its meaning
    ...(denied ? {} : failureFactsOf(err)),   // 0.8.4 S6-01 (additive): `cause` (the error chain as tokens), `host`, `providerCode`: only what the failure said about itself
  }, null, 2));
  appendFileSync(logPath, `${err?.stack || String(err)}\n`);
  log(`\nSTOPPED: ${denied ? 'a denied model' : 'the run failed'} - ${err?.message || String(err)}${!denied && failureFactsOf(err).cause ? ` (cause: ${failureFactsOf(err).cause})` : ''}`);
  if (finalReadOwed) log(`  the final read of ${owedLayer} has not run yet: it is still owed.`);
  log(`  detail:  ${join(runDir, 'STOPPED-error.md')}`);
  finalState();
  process.exit(denied ? 1 : EXIT_RUN_FAILED);
}

if (budgetFinishNow) {
  // 0.8.4 (--finish-now at a spending stop): the sitting ended the run, so the stop files are set aside now (kept as stop-NNNN.json), and the report carries each limit that was kept in force with what was counted against it.
  clearStopRecords();
  result.spendingFinish = { phase: budgetFinishNow.phase, label: budgetFinishNow.label, ...(budgetFinishNow.capName ? { cap_name: budgetFinishNow.capName } : {}), ...(budgetFinishNow.relayed || budgetFinishNow.relayedMark === true ? { relayed: true } : {}) };   // the person's finish at a spending stop, in every phase (phase after makes no stop): the accept check reads it
  const st = budgetState();
  result.keptLimits = capsArmed.length
    ? capsArmed.map(id => ({ cap_name: id, limit_usd: capsLimits[id], spent_usd: Math.round(recordedSpentOf(st.caps?.[id] ?? { spent: 0 }) * 1e6) / 1e6 }))
    : (maxUsdEff !== null ? [{ cap_name: null, limit_usd: maxUsdEff, spent_usd: Math.round(recordedSpentOf(st) * 1e6) / 1e6 }] : []);
}
writeFileSync(join(runDir, 'deliverable.md'), result.deliverable);
if (typeof result.scopeLedger === 'string') writeFileSync(join(runDir, SCOPE_LEDGER_FILE), result.scopeLedger);   // beside deliverable.md, written the same way: the Scope ledger is not part of the plan (src/scope-ledger.js)
// 0.8.3 M3 (PLAN 5.3): a plan that holds a marked split block gets the $0 block-local result recorded as the additive report.json field `split_contract`. It never changes `passed`, calls no model and is read from the
// model-written BODY (without the harness's notes above it). A defect in this report-only field must never lose a finished run's report, so a failure here leaves the field out (the tree re-checks at expansion).
try {
  const planBody = bodyOfDelivered(result.deliverable, result.deliveredText);
  if (planBody.body !== undefined) { const sc = splitContractOf({ text: planBody.body, criteriaIds: criterionIds(result.criteria) }); if (sc) result.splitContract = sc; }
} catch (e) { log(`  split_contract: not recorded (${e?.message || e})`); }
// 0.8.4 D15 / D33 (plan A l.22): the two information checks of the plan's own body (src/plan-checks.js): their findings go to WARNINGS.md and to the additive report.json field `plan_checks`. Asked for by lane A's words (null while they are unrecorded: nothing is written).
// The body is read through gapPlanOf (no second reader of the delivered file). A defect in a report-only field must never lose a finished run's report, so a failure here leaves the field and the lines out. Never changes `passed`, the exit code or any text.
try {
  const planChecks = planChecksOf({ plan: gapPlanOf(result.deliverable, result.deliveredText), task: rawTaskTextForCacheFingerprint, excerpts: excerptIdSetsOf(liveExcerpts(readExcerpts(runDir).entries)), disputePassRan: result.dispute?.ran === true });
  if (planChecks) {
    result.planChecks = planChecks;
    const lines = planCheckLines(planChecks);
    if (lines.length) {
      if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
      appendFileSync(join(runDir, 'WARNINGS.md'), lines.join(''));
    }
  }
} catch (e) { log(`  plan_checks: not recorded (${e?.message || e})`); }
if (result.proposalPool?.length && result.proposalPool.length > result.proposals.length) {
  writeFileSync(join(runDir, 'proposals-pool.md'), `# Every proposal every lab wrote (${result.proposalPool.length}); "kept" ones went to the builder\n\n` + result.proposalPool.map(p =>
    `## ${p.kept ? 'KEPT' : 'dropped'} - ${p.lab}/${p.model}, attempt ${p.attempt}\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
// §5 (v3 plan): declined objections are a first-class record, never part of the deliverable text
// itself, so they get their own section wherever the board already lives - the same file that
// already lists proposals and debate posts (or a standalone one, if no debate happened this run).
// 0.8.4 unit 6 (D32): the money section of the finished run's board, read from the run folder (src/board-money.js); the partial boards pass none. Nothing paid is written between here and report.json.
const boardMd = renderBoardMd({ runId, result, money: moneySectionOf({ runDir, stages: result.stages }) });
if (boardMd) writeFileSync(join(runDir, 'BOARD.md'), boardMd);
// The locked-criteria block (src/criteria-lock.js) is written by the harness after the model's text,
// so the criteria a build session reads are the ones the run settled, and `council check-lock` can tell
// when a copy no longer carries them.
if (result.handoff) {
  // 0.8.2 item 4 (F1/F7): a harness-written banner above the model's text when the plan is not a clean sign-off (not signed, or degraded) or the delivered text is not the signed text (src/handoff-from-run.js
  // finishedState/partialBanner, the same wording `council handoff --from-run` uses). The lock block stays last and unmoved; the file's hash is recorded in report.json (handoff_text.file_sha256).
  const handoffBanner = partialBanner({ state: finishedState({ passed: agreedOf(result), outcome: computeOutcome(result), delivered_text: result.deliveredText, ending_word: result.endingWord, nothing_open_at_once: finishedAtOnceNothingOpen(result), at_once: finishedAtOnceCase(result), top_signed: topSignedNotAgreed(result), nothing_stands: nothingStandsAtEnd(result) }), draftName: 'deliverable.md', runId });
  // 0.8.2 item 6b: the harness-written "Before you build" and "Replan triggers" (src/handoff-contract-text.js) go between the model's text and the lock block, which stays last.
  const checksHere = checksOf(result.criteria, result.criteriaKinds);
  // 0.8.2 item 6c: with handoff_contract.milestones on, the seat-written milestones are linted ($0): every criterion discharged by a milestone with a check. Findings never change `passed`.
  let milestoneGaps = [];
  let handoffSeatText = result.handoff;   // the seat's text as it goes into HANDOFF.md (0.8.4 D29: its Status may be clamped; the stage file and the lint keep the seat's own words)
  if (config.handoff_contract?.milestones === true) {
    const lint = lintMilestones({ text: result.handoff, criteriaIds: criterionIds(result.criteria), planText: result.deliverable, plan: gapPlanOf(result.deliverable, result.deliveredText) });   // 0.8.4 slot H2-g (D17 T1.3): the plan's own body reaches the "Verify first" gap check (bodyDelivered, found by the record; never the harness notes above it)
    milestoneGaps = lint.findings;
    // 0.8.4 T2.5 (D29): after a run that did not agree, ready_for_build and partial are not Status values the handoff may carry until an acceptance is recorded (src/handoff-status.js, the matrix's Status column)
    const clamp = clampStatus(result.handoff, statusAllowedOf(result.endingWord, { agreed: agreedOf(result) }));
    handoffSeatText = clamp.text;
    result.handoffMilestones = { status: lint.status, milestones: lint.milestones.length, findings: lint.findings, ...(clamp.original ? { status_set_by_harness: CLAMPED_STATUS } : {}) };
    if (lint.findings.length) {
      if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
      appendFileSync(join(runDir, 'WARNINGS.md'), lint.findings.map(f => `- handoff_milestones: ${f.kind}: ${f.message}\n`).join(''));
    }
  }
  const builderText = builderSection({ thin: thinContractOf({ taskText: rawTaskTextForCacheFingerprint, contextSha256, result }), runId, failures: checkFailuresOf(config), hasChecks: checksHere.some(Boolean), gaps: milestoneGaps, builderKind: builderKindOf(config) });   // 0.8.4 slot H2-r (D22)
  const taskText = builderTaskBlock(result.reviewNotes);
  const handoffFile = handoffBanner + handoffSeatText.replace(/\s+$/, '') + '\n' + (builderText ? `\n${builderText}` : '') + (taskText ? `\n${taskText}` : '') + lockBlock(result.criteria, { runId, checks: checksHere });
  writeFileSync(join(runDir, 'HANDOFF.md'), handoffFile);
  if (result.handoffText) result.handoffText = { ...result.handoffText, file_sha256: textSha256(handoffFile) };
}
// "How this plan was argued" (src/argued.js): its own file next to the deliverable, never inside it,
// and every id or lab it names that the run never had goes to WARNINGS.md as well as report.json.
if (result.argued) {
  writeFileSync(join(runDir, result.argued.file), result.argued.text);
  const lines = arguedWarnings(result.argued.check);
  if (lines.length) {
    if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
    appendFileSync(join(runDir, 'WARNINGS.md'), lines.map(l => `- ${l}\n`).join(''));
  }
}
// v4 item 2: written on every run that had a preflight config, blocked or not - the blocked
// path also writes this same file from the PreflightBlocked catch above, before this line is
// ever reached, so this covers only the non-blocking case.
if (result.preflight) writeFileSync(join(runDir, 'preflight-verdict.json'), JSON.stringify(result.preflight, null, 2));
// v4 item 3: its own artifact, separate from report.json's pre-build `ground_truth` - a chain
// without config.verify_post never has this key, so this line never runs for it.
if (result.ground_truth_post) writeFileSync(join(runDir, 'verify-post.json'), JSON.stringify(result.ground_truth_post, null, 2));
// Final security-review gate: its own artifact, written whether the gate passed or not.
if (result.security_review) writeFileSync(join(runDir, 'security-review.json'), JSON.stringify(result.security_review, null, 2));
if (result.proposals?.length) {
  writeFileSync(join(runDir, 'proposals.md'), result.proposals.map(p =>
    `## ${p.id} (${p.lab}/${p.model})\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
// v7.x: lint failures and dropped claims are informational, same WARNINGS.md the pre_flight/
// cache_stale/partial_output warnings above already append to - never a reason to fail the run.
if (result.lints?.length || result.claimWarnings?.length || result.toolRequestWarnings?.length) {
  if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
  appendFileSync(join(runDir, 'WARNINGS.md'), (result.lints || []).map(l => `- lint (${l.id}): ${l.message}\n`).join(''));
  appendFileSync(join(runDir, 'WARNINGS.md'), (result.claimWarnings || []).map(w => `- claim: ${w}\n`).join(''));
  // v7.x item 3: seat-requested tool calls that exceeded the per-stage cap, or named a
  // disallowed tool, same WARNINGS.md the lint/claim lines above already append to.
  appendFileSync(join(runDir, 'WARNINGS.md'), (result.toolRequestWarnings || []).map(w => `- tool_request: ${w}\n`).join(''));
}
// 0.8.2 (owner decision 4a, 5 Oct 2026): the cold reader's findings, or the fact that it was not judged, reach WARNINGS.md as well as report.json and the deliverable.
if (result.coldRead && (result.coldRead.status === 'not_judged' || (result.coldRead.raised && result.coldRead.contradictions?.length))) {
  if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
  appendFileSync(join(runDir, 'WARNINGS.md'), result.coldRead.status === 'not_judged'
    ? `- cold_read_not_judged: the cold reader gave no readable answer (${result.coldRead.reason_code}); nobody has checked the plan for contradictions between its sections\n`
    : result.coldRead.contradictions.map(c => `- cold_read: ${c.sections?.length ? `(${c.sections.join(', ')}) ` : ''}${c.note}\n`).join(''));
}
// TOOLS.md: every tool call this sitting made, after redaction (pre-release audit 2026-09-23,
// FenceToolsRedaction #7 - the log was collected and never written). Appended, so a resumed run
// keeps every sitting's calls.
{
  const toolsMd = renderToolsMd();
  if (toolsMd) appendFileSync(join(runDir, 'TOOLS.md'), `${toolsMd}\n`);
}
// Bug audit 2026-10-24 C-010: report.json IS the finished-run marker (`--resume` refuses a run that has one, run_status reads it as done), so it is written like the stop markers: temp file, fsync, rename. A kill or a full disk mid-write used to leave a torn file that read as finished and unreadable.
if (excerptChannelOn() && Array.isArray(result?.text_requests_left)) { try { recordUnaskedRequests({ runDir, left: result.text_requests_left }); } catch (e) { log(`  (requests nobody answered were not recorded: ${e?.message || e})`); } }   // 0.8.4 D18: before the report, so its excerpts entry counts them
writeAtomic(join(runDir, 'report.json'), JSON.stringify((() => { const shaped = reportJsonShape(reportArgsFor(result)); const ex = excerptsReportEntry(runDir); return ex ? { ...shaped, excerpts: ex } : shaped; })(), null, 2));   // 0.8.4 D9: the record's count and hash, additive, present only when the run recorded an excerpt (schemas/report-v1.json `excerpts`)
// v5 item 3: one last write now that report.json exists on disk, so `phase` in state.json
// reflects `done` rather than staying on whatever it said mid-run (`deriveRunStatus` checks
// report.json first; without this call, a completed run's state.json would show "running"
// forever, since nothing else touches it after the last stage's own onStage-triggered write).
currentStage = null;
writeStateJson();
// report.json existing is this codebase's own definition of "finished" (STOPPED-budget.json's
// comment above says so explicitly) - the audit chain closes here, not in a finally block, so a
// paused or budget-stopped run's audit.jsonl is correctly left without a close line.
if (auditWriter) auditWriter.close();
// Final regeneration: the last onStage-triggered RESUME.md was written before
// deliverable.md/report.json existed, so without this it would keep reporting
// "in progress" forever on an already-finished run. Run after report.json so
// an orphaned-withdrawal warning (v5 §1 candidate 3) can be read back from it.
writeFileSync(join(runDir, 'RESUME.md'), generateResumeBrief({ runId, dir: runDir, runMeta: { chain: chainNameEff, task: taskPathEff }, chainConfig: config , member: memberNotice }));

const t = result.totals;
log(`\n---`);
if (result.signoff) {
  const panelRows = result.signoff.filter(s => !s.cut);   // 0.8.4 --finish: a row marked `cut` is a cut-off layer's reply; the panel line shows who signed off
  // 0.8.4 S4 (the M1-G1 verdict's named limit): a seat that STATED a pass (signedOff null, passed true) was heard; "?" is for a seat with no usable reply only
  log(`panel:    ${panelRows.map(s => `${s.provider}${s.signedOff === null ? (s.passed === true ? ' (stated a pass)' : ' ?') : s.signedOff ? ' ✓' : ' ✗'}`).join('  ')}`);
  if (panelRows.some(s => s.signedOff === null && s.passed !== true)) log(`          ? = no usable reply (truncated, malformed, or the lab was down), abstained - neither a pass nor an objection`);
}
{
  log(`verdict:  ${result.passed && finalReadBlocksAgreement(result.finalRead)
    ? (finalReadObjected(result.finalRead) ? `NOT agreement: every layer had signed off on an earlier text, but a ${layerHyphen(runTopLayer(result))} objection to the final plan holds the sign-off (see report.json final_read)` : `NOT agreement: every layer had signed off on an earlier text, but not every ${layerHyphen(runTopLayer(result))} seat read the final plan (see report.json final_read)`)
    : secretFinishWords(result) ? `${secretFinishWords(result)} (see report.json stop)`
    : budgetFinishWords(result) ? `${budgetFinishWords(result)} (see report.json stop)`   // 0.8.4 S16 (F; WORDING S16-w60b)
    : ownerPauseFinishWords(result) ? `${ownerPauseFinishWords(result)} (see report.json stop and pauses)`   // 0.8.4 (ladder unit, LAD-O6)
    : endingWords(result) ? `${endingWords(result)} (see ending in report.json)`   // 0.8.4 S4, A-DRAFT: layer 3 signed off and the run does not end agreed
    : agreedAfterEscalationWords(result) ? agreedAfterEscalationWords(result)   // an escalated sign-off the handler agreed
    : result.passed
    ? (computeOutcome(result) === 'degraded' ? DEGRADED_WORDS : result.signoff ? `every lab on the panel signed off${noBuildCheckWords(result) ? `; ${noBuildCheckWords(result)}` : ''}` : FIRST_WORDS)
    : earlyFinishWords(result) ? 'finished early by the session, NOT agreement (the overseer layer said to finish; see report.json stop)' : result.escalated_signoff?.ladder ? `ladder sign-off: the top layer signed off in pass ${result.escalated_signoff.pass}; ${result.escalated_signoff.below.length === 1 ? 'layer' : 'layers'} ${result.escalated_signoff.below.join(', ')} ${result.escalated_signoff.below.length === 1 ? 'was' : 'were'} not asked in that pass, NOT agreement of the whole panel (see report.json escalated_signoff)` : result.escalated_signoff?.requested ? `top-layer sign-off: the top layer signed off on a pass that was asked to start at layer ${result.escalated_signoff.layer}; ${result.escalated_signoff.below.length === 1 ? 'layer' : 'layers'} ${result.escalated_signoff.below.join(', ')} ${result.escalated_signoff.below.length === 1 ? 'was' : 'were'} not asked in that pass, NOT agreement of the whole panel (see report.json escalated_signoff)` : result.escalated_signoff ? `escalated sign-off: the top layer signed off ${result.escalated_signoff.below.length ? (escalationTriggersOf(result.escalations).layer2_bound ? `after ${escalationCauseWords(result.escalations)} (${result.escalated_signoff.below.length === 1 ? 'layer' : 'layers'} ${result.escalated_signoff.below.join(', ')} ${result.escalated_signoff.below.length === 1 ? 'was' : 'were'} passed over)` : `after ${escalationCauseWords(result.escalations)} from layer ${result.escalated_signoff.below.join(', ')}`) : 'while a judge still raised objections an earlier ruling had closed'}, NOT agreement of the whole panel (see report.json escalations)` : finishedAtStopWords(result) ? (nothingStandsAtEnd(result) ? `stopped without agreement; ${finishedAtStopWords(result)} (see report.json)` : `stopped with open failures; ${finishedAtStopWords(result)} (see report.json)`) : (nothingStandsAtEnd(result) ? 'stopped without agreement (see report.json)' : 'stopped with open failures (see report.json)')}`);   // the escalated words: stall escalation, A-DRAFT; 0.8.4 L3, A-DRAFT: a stop the person finished says the top layer did not sign off A-DRAFT (0.8.4 round 1, A7-3: the first of the two `stopped ...` texts is the run finished at once with no objection open).
}
if (result.finalRead?.ran) log(finalReadSummaryLine(result.finalRead));   // unit D, A-DRAFT: the handler acts on the terminal, so the closing statement is in the summary too
const closedAtEnd = new Set((Array.isArray(result.dispute?.open_objections) ? result.dispute.open_objections : []).filter(o => o.closed_by === 'final_read').map(o => o.id));   // 0.8.4 S8 c3: the closing read closed these; the summary lists what still stands
const openForReview = (result.lastCritique?.failures || []).filter(f => !(f.id && closedAtEnd.has(f.id)));
if ((!result.passed || !agreedOf(result)) && openForReview.length) {
  log(`open:     ${openForReview.length} objection(s) for human review - the labs can be wrong, read the draft before acting on these`);
  for (const f of openForReview) log(`  - ${f.lab ? `${f.lab}: ` : ''}${f.problem || f.criterion}`);
}
if (result.scoreboard) {
  log(`labs:     ${result.scoreboard.labs.map(l => `${l.lab} ${l.accepted}/${l.proposed}`).join('  ')}  (accepted/proposed; "built" is yours to fill after the build session)`);
}
// Bug audit 2026-09-28 (area 2 #4): a seated lab that dropped out was missing from the summary
// (and from BOARD.md and WARNINGS.md), so "degraded" had no visible reason.
if (result.dropouts?.length) {
  log(`dropped:  ${result.dropouts.map(d => `${d.lab} (${d.stage}: ${d.reason})`).join('; ')}`);
  if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
  appendFileSync(join(runDir, 'WARNINGS.md'), result.dropouts.map(d => `- dropout: ${d.lab}${d.model ? ` (${d.model})` : ''} produced nothing usable at ${d.stage} - ${d.reason}; the council went on without it\n`).join(''));
}
{ const undeclared = undeclaredNoteOf(result.stages); if (undeclared) log(`answers:  ${undeclared}`); }   // harness (a) S5
log(`tokens:   ${tokensLine(t)}`);
log(`cost:     ${formatUsd(Number.isFinite(t.counted?.usd) ? t.counted.usd : t.usd)}${t.counted ? ' counted' : ''}${estimatedPartWords(t.counted?.estimatedUsd, formatUsd)}${t.unpriced.length ? ` (+ unpriced: ${t.unpriced.join(', ')})` : ''}${maxUsdEff === null ? '' : ` of ${formatUsd(maxUsdEff)} ceiling`}`);
const boardWritten = !!boardMd;
log(`output:   ${join(runDir, 'deliverable.md')}${result.handoff ? `  (+ HANDOFF.md${boardWritten ? ', BOARD.md' : ''})` : boardWritten ? '  (+ BOARD.md)' : ''}`);
if (result.argued) log(`argued:   ${join(runDir, result.argued.file)}${result.argued.check.ok ? '' : '  (names things the run never had - see WARNINGS.md)'}`);
// 0.8.4 item 6 (his "a": every run that delivers a plan and has a handling session, not-agreed ends included; C&C accepted the line, 10 Nov 2026): the handling session is told that it can add a summary and index of the plan. HELD (`handlerSummaryEndLine`, A-DRAFT WRR-s6): as shipped no line is printed. It is the LAST line before the gate below, so
// run_status's lastLogLines (the last three lines of run.log) carries it to a session that reads the run through MCP, unless a security review's lines follow it.
{ const endLine = held('handlerSummaryEndLine'); if (typeof endLine === 'function' && hasHandlingSession(config)) log(`summary:  ${endLine({ run: runDir })}`); }
// Final security-review gate. Checked last, after every artifact (report.json, state.json, the
// audit close, RESUME.md) is on disk, so a failed gate still leaves a complete, readable run
// folder. Exit 7 = blocked, 8 = not judged; both are failures a caller must not treat as a pass.
if (result.security_review) {
  const sr = result.security_review;
  log(`security: ${sr.gate} - ${sr.seat}, ${sr.findings.length} finding(s), ${sr.blocking_count} blocking${sr.reason_code ? ` (${sr.reason_code})` : ''} - ${join(runDir, 'security-review.json')}`);
  for (const f of sr.findings.filter(f => BLOCKING_SEVERITIES.includes(f.severity))) {
    log(`  - [${f.severity}] ${f.category} ${f.file ?? '?'}:${f.line ?? '?'} - ${f.problem ?? f.evidence}`);
  }
  if (sr.gate === 'blocked') process.exit(EXIT_SECURITY_BLOCKED);
  if (sr.gate === 'not_judged') process.exit(EXIT_SECURITY_NOT_JUDGED);
}
// Last of all, after every artifact and the security gate: the panel did not agree. `=== false` so a result with no verdict never gets it. A tree member keeps 0 (its record carries the outcome; src/tree-run.js reads exit 0 as "read the record"), and an advice call keeps 0 (its verdict word is its answer).
if (endsNotAgreed(result) && !treeLineage) process.exit(EXIT_NOT_AGREED);   // 0.8.4 S4: the shared predicate (src/ending.js): a recorded `ending` that is not agreed ends the run not agreed even though `passed` stays true;   // unit D: a layer-3 objection to the final plan ends an agreed run as not agreed

}
// end of the non-MCP path (see the --mcp branch at the top of this file)
