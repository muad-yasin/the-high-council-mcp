// The shape of a run's report.json and the text of its BOARD.md, in one place.
//
// Moved out of cli.js on 2026-09-23 (pre-release audit, Review/PreRelease_Audit_replay_2026-09-23.md,
// HIGH): --replay hand-built its own report.json and so dropped the alternatives record and about
// 25 contract fields, and wrote no BOARD.md at all - a replay folder was a different, thinner
// artifact than the run it was compared against. Every writer (a normal run, `council init`,
// --rematch, --replay) now builds from these functions.
import { renderDeepDiveBoard } from './deep-dive.js';
import { LAYER_STATE_WORDS, layerStateWord } from './layers.js';
import { escalationsWithNext, notDebatedNextWords, escalationStoodWords, escalationTriggersOf, isLayerOneUp } from './escalation.js';
import { flagUnanchored, anchorSentence, materialiseAttached } from './anchor.js';   // 0.8.4 S14: the one rule for an objection that quotes no passage
// The escalations[] rows as the report AND the board print them: each flagged (not_debated) entry gets its `next`, derived from the record (one reader for both).
const escalationsOf = result => escalationsWithNext(result.escalations, { layerDebates: result.layerDebates, answerBackReplies: result.answerBackReplies, escalatedSignoff: result.escalated_signoff });
import { stopWhyGeneral, relayedTail } from './overseer-rounds.js';
import { PAUSE_GENERAL_WORDS } from './owner-pause.js';
import { held } from './held-roles.js';
import { judgePersonasRecord, PERSONA_SWITCH } from './judge-persona.js';
import { personaRunFields } from './persona-record.js';
import { severityRecord } from './severity.js';
import { LEDGER_MAX_CHARS } from './objection-ledger.js';
import { computeOutcome } from './outcome.js';
import { renderTextLabelsBoard } from './text-labels.js';
import { earlyFinishWords, secretFinishWords, budgetFinishWords, endingWords, noBuildCheckWords, finishedAtStopWords, ownerPauseFinishWords, stagesNotRunWords } from './verdict-headline.js';
import { buildThinContract, sha256Of } from './thin-contract.js';
import { computeRoleDiagnostics } from './role-diagnostics.js';
import { deriveDisagreementGroups } from './disagreement-groups.js';
import { renderDisputeReviewBoard } from './chain.js';
import { renderFinalReadBoard, finalReadObjected, finalReadBlocksAgreement, layerNOf } from './final-read.js';
import { closedRowsOf } from './sorting.js';
import { layerWord, layerHyphen, topLayerOf } from './top-layer.js';
import { boardText } from './roles.js';
import { summaryLine } from './criteria-kinds.js';
import { criterionIds } from './criteria-ledger.js';
import { criteriaHash, checksHash, checksOf } from './criteria-lock.js';
import { cutDespiteSupport, disagreementMap } from './decision-records.js';
import { isAbsolute, relative, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { harnessProducer } from './version.js';
import { rosterAnswersOf, layerDebatesWithMakers, companyOfSeat } from './answered-by.js';
import { seatKeyOf } from './seat-key.js';
import { refusalWords } from './decision-entry.js';   // 0.8.4 S9: the one copy of the refusal words (run.log and BOARD.md); an import-free file
import { renderLateFindingsBoard, withRatingsInForce } from './late-finding.js';

// report.json's format version, published as schemas/report-v1.json (docs/report-format.md). An
// integer that moves only on a breaking change - a field renamed, removed, or its type or meaning
// changed. Adding a field never moves it: readers ignore fields they do not know. Independent of
// the chain-config schemaVersion in src/schema-version.js; the two describe different files.
// A report.json with no schemaVersion was written before 0.7.7 and reads as version 1.
export const REPORT_SCHEMA_VERSION = 1;

// report.json's `task` and `fromRun`: never an absolute path. run.json records the task as an absolute path
// (so a resume from anywhere finds it), and every writer after the first sitting (--resume,
// --rematch, --replay, init) used to copy that into report.json, putting /home/<user>/... into a
// file people share (brief 03, fix 4). A path inside the run's working directory is written
// relative to it; one outside it is written as its file name only. A relative path is kept as
// given. Forward slashes on every platform. `fromRun` (a run folder, saved absolute in run.json
// since the 2026-09-23 resume fix) had the same leak and gets the same treatment: relative to the
// start directory, else the run folder's name.
export function reportTaskPath(task, cwd) {
  if (typeof task !== 'string' || !task) return task ?? null;
  if (!isAbsolute(task)) return task.split(sep).join('/');
  if (cwd && isAbsolute(cwd)) {
    const rel = relative(cwd, task);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  }
  return basename(task);
}

// The shape of a run's report.json, in one place - bug-audit finding
// (2026-09-13, v5 Phase 2): `council init`'s canned demo run used to
// hand-roll a second, independently-maintained literal missing fields
// (criteria, proposals, ...) the real writer below includes, so
// `--from-run` against an init-produced run silently reran the criteria
// stage instead of reusing it - no crash, just a broken promise. Both
// writers now build from this one function.
// `taskCwd` is the directory the run was started in (run.json's `cwd`); `taskText` is the task
// file's text as this sitting read it, hashed into `task_sha256` (its first 12 hex characters are
// run.json's `taskHash`).
// `startedAt` is when the run's first sitting began (ISO 8601), when the writer knows it; the
// report is stamped `finished_at` as it is built.
/**
 * The thin contract (src/thin-contract.js) of a chain result, or null (an advice run, or one with no criteria, task text or signed text). One function for report.json and for HANDOFF.md, which
 * prints the record's hash before report.json is written, so the two can never disagree.
 */
export function thinContractOf({ taskText, contextSha256 = null, result }) {
  if (!result) return null;
  const has = Array.isArray(result.criteria) && result.criteria.length;
  return buildThinContract({
    taskSha256: typeof taskText === 'string' ? sha256Of(taskText) : null,
    criteriaSha256: has ? criteriaHash(result.criteria) : null,
    checksSha256: has ? checksHash(checksOf(result.criteria, result.criteriaKinds)) : null,
    contextSha256, groundTruth: result.ground_truth, signedTextSha256: result.signedText?.sha256,
  });
}

/** 0.8.4 S4 (T19f): the `severity` section with the MAKER of each critic seat beside it (`makers`: seat key -> the model's company, record only, never weighed); a seat with no maker (a mock seat, a session seat that names no model) has none, and with no maker at all the key is absent and the section is byte for byte what it was. */
export function severityWithMakers(config, result) {
  const sev = severityRecord(config, result);
  if (!sev) return sev;
  const makers = {};
  for (const seat of config?.seats?.critics ?? []) { const company = companyOfSeat(seat); if (company) makers[seatKeyOf(seat)] = company; }
  return Object.keys(makers).length ? { ...sev, makers } : sev;
}

export function reportJsonShape({ runId, chain, task, taskCwd = null, taskText = null, startedAt = null, sittings = null, result, fromRun = null, fromRunCwd = taskCwd, maxUsd = null, config = null, contextSha256 = null, policyChecks = null, policyWarnings = null, tree = null, verdictEnvelope = false, caps = null }) {
  // v6 §7: failure-mode diagnostics, computed from this run's own real
  // debate output - never from the phase 4 measurement harness, which
  // is a deterministic heuristic probe and cannot speak to real debate
  // diversity (see docs/v6-decisions.md). Additive-only: a chain with
  // no debate stage keeps debate as-is (null); one that did debate
  // always gets a diagnostics object, with nulls/empty flags rather
  // than an absent key when there's nothing to compute.
  //
  // v6 phase 7 bug-audit fix: role only ever takes effect on a
  // seats.proposers entry - chain.js's debate-stage seatOf(lab) looks
  // seats up exclusively from proposers, so a role set on any other
  // seat kind (builder, judge, critics, ...) is already a silent no-op
  // (see chain-lint.js's new warning for that). This used to pull role
  // from every seat kind, which could misclassify a proposer's own
  // debate posts as role-bearing via a shared provider-as-lab fallback
  // string with an unrelated non-proposer seat that happened to carry
  // a role. Restricted to proposers, the only seats debate ever touches.
  const roleLabs = new Set(
    (config?.seats?.proposers || [])
      .filter(s => s?.role)
      .map(s => s.lab || s.provider) // same lab || provider fallback chain.js's own labOf uses
  );
  const debate = result.debate
    ? { ...result.debate, diagnostics: computeRoleDiagnostics(result.debate, roleLabs) }
    : result.debate;
  const personaRecord = personaRunFields(result.stages, config);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    producer: harnessProducer({ sittings }),
    runId,
    ...(typeof startedAt === 'string' ? { started_at: startedAt } : {}),
    finished_at: new Date().toISOString(),
    chain,
    task: reportTaskPath(task, taskCwd),
    ...(typeof taskText === 'string' ? { task_sha256: createHash('sha256').update(taskText, 'utf8').digest('hex') } : {}),
    fromRun: reportTaskPath(fromRun, fromRunCwd),
    criteria: result.criteria,
    // A descending-mode run never set these four, so JSON.stringify dropped the keys (brief 03
    // fix 1). Every writer now emits them: null, [] and 0 mean the stage did not apply.
    questions: result.questions ?? null,
    passed: result.passed,
    ...(Array.isArray(result.dissents) && result.dissents.length ? { dissents: result.dissents } : {}),   // M1 COMPLETE U1-2 (additive, experimental): the dissents of a run that ended at the top layer's sign-off, held behind the dissent wording; never in a partial report (computed at the end)
    ...(typeof result.endingWord === 'string' ? { ending_word: result.endingWord } : {}),   // 0.8.4 D1 (src/ending-matrix.js): ONE word for every run that ends; where `ending` and final_read.run_end exist they agree with it on agreed or not (schemas/report-v1.json)
    ...(typeof result.stopKind === 'string' ? { stop_kind: result.stopKind } : {}),   // 0.8.4 D1: the kind of the stop a finish was chosen at (layer_bound/revisions, overseer_cap, stall_stop/top_layer, secret_pause ...)
    ...(result.ending ? { ending: result.ending } : {}),   // 0.8.4 S4 (src/ending.js): how layer 3's sign-off ended; additive, experimental. `passed` is never set by it
    ...(result.buildCheckRefusals?.length ? { build_check_refusals: result.buildCheckRefusals } : {}),   // 0.8.4 S18: the refused answers, derived from the run folder (cli.js)
    ...(result.buildChecks?.length ? { build_checks: result.buildChecks } : {}),   // every build check asked (a not_yet that sent the plan back stays on the record whatever the ending)
    lastCritique: result.lastCritique && Array.isArray(result.lastCritique.failures) ? { ...result.lastCritique, failures: flagUnanchored(materialiseAttached(result.lastCritique.failures)) } : result.lastCritique,   // 0.8.4 S14: `unanchored: true` on an objection record that quotes no passage (derived here, not in the run)
    signoff: Array.isArray(result.signoff) ? result.signoff.map(s => (s && Array.isArray(s.objections) ? { ...s, objections: flagUnanchored(s.objections) } : s)) : result.signoff,
    challenge: result.challenge,
    ...(result.spendingFinish ? { spending_finish: result.spendingFinish } : {}),   // 0.8.4 (--finish-now at a spending stop): the person ended the run at its spending limit; { phase, label, cap_name? }; additive
    ...(Array.isArray(result.keptLimits) && result.keptLimits.length ? { kept_limits: result.keptLimits } : {}),   // 0.8.4 (--finish-now at a spending stop): each limit kept in force and what was counted against it; additive
    ...(Array.isArray(result.stages_not_run) && result.stages_not_run.length ? { stages_not_run: result.stages_not_run } : {}),   // 0.8.4 (finish at once at the spending limit): the calls that were not made, [{ label, reason: 'spending_limit' }]; additive
    allocator: result.allocator,
    proposals: result.proposals,
    dropouts: result.dropouts,
    outcome: computeOutcome(result),
    debate,
    scoreboard: result.scoreboard ?? null,
    disputes: result.disputes,
    orphanSections: result.orphanSections ?? [],
    withdrawalCycles: result.withdrawalCycles ?? 0,
    totals: result.totals,
    // 0.8.3 M2 (D18, CL-117, additive, experimental): the superseded records totals.supersededUsd absorbed: { label, usd, reservationId }. Present only when something was superseded.
    ...(Array.isArray(result.superseded) && result.superseded.length ? { superseded: result.superseded } : {}),
    // 0.8.4 S5-01 (additive, experimental): the paid stage files no `stages[]` row accounts for, which `totals.unreplayedUsd` absorbed: { label, usd, reservationId }. Present only when there were any.
    ...(Array.isArray(result.unreplayed) && result.unreplayed.length ? { unreplayed: result.unreplayed } : {}),
    maxUsd,
    // 0.8.4 DUALCAP unit 4b2 (additive, experimental): with one spending cap per provider (COUNCIL_SPEND_CAPS), each cap's typed limit and the spend recorded through it; maxUsd is then null.
    // Present only for such a run.
    ...(caps ? { caps } : {}),
    // 0.8.1 DR-13 (N4): the exact prompt's full sha256, its size, the serving endpoint and the scan result go to
    // audit.jsonl only (src/audit.js); stages[] keeps the 16-hex promptHash it always had.
    stages: personaRecord.stages.map(({ writtenBy, answeredUnderEarlierWording, answeredOnAnotherRoute, text, promptSha256, promptBytes, endpoint, scan, providerReportedCost, providerReportedUnverified, generationId, discardedAttempt, lostChargesUsd, ...rest }) => rest),   // 0.8.4 T14: writtenBy and answeredUnderEarlierWording are bookkeeping of the cache (the record lives in the stage's own files and in answered_under_earlier_wording), not stage fields. 0.8.4 unit 1: like `endpoint`, the provider-reported figure and the generation id stay in the usage files; the counter that publishes them in report.json (with its schema) is unit 2
    // 0.8.4 lane C (additive, experimental): the persona set a debate prompt was built from (personas_source, personas_sha256, personas_used), lifted from the stage rows that carried one; the per-row persona fields ride
    // on stages[] above (src/persona-record.js: stamped when the prompt was built, kept in the stage's usage.json, so a replayed row has what the sitting that made the call recorded).
    ...personaRecord.run,
    // 0.8.3 harness (a), additive and experimental: who answered the session seats, as the answerers declared it (src/answered-by.js). Present only when the run had a session-seat stage.
    ...(rosterAnswersOf(result.stages) ? { roster_answers: rosterAnswersOf(result.stages) } : {}),
    // v7 item 1: additive-only, same pattern as debate's diagnostics above -
    // present only when the run actually did verification (config.verify.
    // enabled), absent otherwise so v6 report.json shape is unchanged.
    ...(result.ground_truth !== undefined ? { ground_truth: result.ground_truth } : {}),
    // v7.x: additive-only, same pattern as ground_truth above - present only when the run
    // actually enabled the stage (config.lints.enabled / config.claims.enabled), absent
    // otherwise so a chain that never opts in keeps today's report.json shape exactly.
    ...(result.lints !== undefined ? { lints: result.lints } : {}),
    ...(result.claims !== undefined ? { claims: result.claims } : {}),
    // MLLM Coder v5 item 4: additive, present only when the run debated (src/disagreement-groups.js).
    ...(result.debate ? { disagreement_groups: deriveDisagreementGroups(result.debate, result.proposals) } : {}),
    // MLLM Coder v5 item 5: present only when a policy.json was in force for this run - what it
    // restricted, by capability. Absent means no policy, never "a policy with no checks".
    ...(policyChecks ? { policy: { checks: policyChecks, ...(Array.isArray(policyWarnings) && policyWarnings.length ? { warnings: policyWarnings } : {}) } } : {}),
    // Final security-review gate (src/security-review.js): additive, present only when the chain
    // enabled the stage - same object as the run folder's security-review.json.
    ...(result.security_review !== undefined ? { security_review: result.security_review } : {}),
    // Bug-audit fix, 2026-09-23 (Review/BugAudit_Metrics_2026-09-23.md #3, #6): these were on the
    // runChain result but never reached report.json, so the stats readers and anyone reading a run
    // folder could not see them (a real run's dispute stage and canary lived only in run.log).
    // Additive only; each is absent when the run produced none of it.
    ...(Array.isArray(result.panelVerdicts) ? { panelVerdicts: result.panelVerdicts } : {}),
    // 0.8.0 (roadmap "Debate, criteria, milestones" 4 and 9), all additive and all derived or recorded
    // without a prompt change: positional criterion ids, the sign-offs whose criteria table skipped
    // criteria (src/criteria-ledger.js), proposals cut despite another lab's support, and the round by
    // lab verdict map (src/decision-records.js). A key is absent where it does not apply.
    // 0.8.2, additive and only when something happened: sign-offs refused for an incomplete table, and table rows that named no criterion (recorded, never counted).
    // 0.8.2 item 4, additive: the text the panel signed vs the text delivered (src/text-labels.js). `passed` is not touched.
    ...(result.signedText ? { signed_text: result.signedText } : {}),
    ...(result.deliveredText ? { delivered_text: result.deliveredText } : {}),
    ...(result.handoffText ? { handoff_text: result.handoffText } : {}),
    ...(Array.isArray(result.signoffTableGaps) && result.signoffTableGaps.length ? { signoff_table_gaps: result.signoffTableGaps } : {}),
    // 0.8.2, additive, only with debate_hygiene.shuffle: the order and lab letters each debate reader saw.
    ...(Array.isArray(result.writerNotes) && result.writerNotes.length ? { writer_notes: result.writerNotes } : {}),
    ...(result.endingExchange ? { ending_exchange: result.endingExchange } : {}),   // 0.8.4 S4b, additive: the ending exchange (ran or not run) while W26 is recorded
    ...((Array.isArray(result.lateFindings) && result.lateFindings.length) || (Array.isArray(result.lateFindingsDropped) && result.lateFindingsDropped.length) ? { late_findings: [...(result.lateFindings || []), ...(result.lateFindingsDropped || [])] } : {}),   // 0.8.4 S18: the findings still carried first, then (marked dropped_after_check) the ones a build check demanded that the last verdict no longer carries; the BOARD and the HANDOFF read the carried ones only   // 0.8.4 S4b, additive: defects first found in the last round of the ending exchange (D24)   // 0.8.4 S4 (Q-l, W34), additive: the writer's fix note of each pass; absent while the wording is held
    ...(Array.isArray(result.answerBack) && result.answerBack.length ? { answer_back: result.answerBack } : {}),
    ...(Array.isArray(result.answerBackReplies) && result.answerBackReplies.length ? { answer_back_replies: result.answerBackReplies } : {}),
    ...(Array.isArray(result.layerDebates) && result.layerDebates.length ? { layer_debates: layerDebatesWithMakers(result.layerDebates, result.stages).map(d => (d && Array.isArray(d.objections) ? { ...d, objections: flagUnanchored(materialiseAttached(d.objections)) } : d)) } : {}),   // B2 (debate-084/b2), additive; M0 FIX 3: the makers (RU-S1-23/24) are added here, at report time
    ...(severityRecord(config, result) ? { severity: severityWithMakers(config, result) } : {}),   // B3 prep (unit 3), additive: only on a layered unanimous chain (ratingsRecorded; M1, S19: there is no switch)
    ...(judgePersonasRecord(config, result) ? { [PERSONA_SWITCH]: judgePersonasRecord(config, result) } : {}),   // B3 prep (unit P), additive: only with the chain's seat_personas switch
    ...(Array.isArray(result.debateOrders) && result.debateOrders.length ? { debate_orders: result.debateOrders } : {}),
    ...(Array.isArray(result.outsideCriteriaRows) && result.outsideCriteriaRows.length ? { outside_criteria_rows: result.outsideCriteriaRows } : {}),
    ...(Array.isArray(result.missingCriteria) && Array.isArray(result.criteria) && result.criteria.length
      ? { criteria_ids: criterionIds(result.criteria), missing_criteria: result.missingCriteria } : {}),
    // The fingerprint of the criteria list (src/criteria-lock.js), the same one HANDOFF.md's lock block carries.
    ...(Array.isArray(result.criteria) && result.criteria.length ? { criteria_sha256: criteriaHash(result.criteria) } : {}),
    // 0.8.1 FX-10 (DR-11): how each criterion is checked (criteria_kinds' check and on), fingerprinted apart from the
    // wording. This file is the sole writer; the HANDOFF.md lock block carries the same hash in its second marker.
    ...(Array.isArray(result.criteria) && result.criteria.length ? { checks_sha256: checksHash(checksOf(result.criteria, result.criteriaKinds)) } : {}),
    // 0.8.2 item 6a (owner: thin contract YES): one record of what this run was asked, graded against, shown and signed, in full-width hashes (src/thin-contract.js). Absent for an advice run and for any
    // run that has no criteria, task text or signed text to seal. signed_text.sha256 is item 4's hash, read here, not defined again.
    ...(() => { const t = thinContractOf({ taskText, contextSha256, result }); return t ? { thin_contract: t } : {}; })(),
    // 0.8.2 item 6c: only with handoff_contract.milestones: what the $0 lint found in the handoff's milestones (src/milestones.js). Never touches `passed`.
    ...(result.handoffMilestones ? { handoff_milestones: result.handoffMilestones } : {}),
    // 0.8.3 M3: only when the plan holds a marked split block: what the $0 block-local checks of PLAN 5.3 found (src/tree-split.js). Never touches `passed`.
    ...(result.splitContract ? { split_contract: result.splitContract } : {}),
    // 0.8.4 D15 / D33: only when lane A's words ask for them: what the two information checks of the plan's body found (src/plan-checks.js; per check ran / did not run / findings). Never touches `passed`; tree readiness does not read it.
    ...(result.planChecks ? { plan_checks: result.planChecks } : {}),
    // 0.8.3 M6 S7 (PLAN 10.4): only on a tree MEMBER: its lineage, exactly the `tree` field of its run.json (src/tree-member.js runTreeField, the one source of the eight fields). Nothing is computed here.
    ...(tree ? { tree } : {}),
    ...(verdictEnvelope ? { verdict_envelope: true } : {}), // E3b: the run used the verdict envelope (run.json flag); absent = it did not
    // $0 word-level lints over the criteria, run before any paid round (src/criteria-lints.js); [] when clean.
    ...(Array.isArray(result.criteriaLints) ? { criteria_lints: result.criteriaLints } : {}),
    // The ledger status (accepted / cut / withdrawn) is on scoreboard.rows, not on proposals[] (0.8.0: the
    // first version read proposals[] and could never fire).
    ...(cutDespiteSupport(result.scoreboard?.rows, result.debate) !== undefined ? { cut_despite_support: cutDespiteSupport(result.scoreboard?.rows, result.debate) } : {}),
    ...(disagreementMap(result.panelVerdicts) !== undefined ? { disagreement_map: disagreementMap(result.panelVerdicts) } : {}),
    ...(Array.isArray(result.regressions) ? { regressions: result.regressions } : {}),
    ...(result.dispute != null ? { dispute: result.dispute } : {}),
    ...(result.finalRead != null ? { final_read: result.finalRead } : {}),   // unit D (src/final-read.js): additive; 0.8.4 S16: present on every layered unanimous run that reaches the end of runChain
    ...(result.canary !== undefined ? { canary: result.canary } : {}),
    ...(result.quoteFindings !== undefined ? { quoteFindings: result.quoteFindings } : {}),
    ...(result.patchFallbacks !== undefined ? { patchFallbacks: result.patchFallbacks } : {}),
    ...(result.coldRead != null ? { coldRead: result.coldRead } : {}),
    ...(result.noHeardReviewer ? { noHeardReviewer: result.noHeardReviewer } : {}),
    // 0.8.3 (layered review panel), additive, present only on a layered chain: one row per round per layer, and the stop of a layer that ended the run without a usable vote.
    ...(Array.isArray(result.layers) ? { layers: result.layers } : {}),
    ...(result.layerStop ? { layerStop: result.layerStop } : {}),
    ...(Array.isArray(result.proposerReturns) && result.proposerReturns.length ? { proposer_returns: result.proposerReturns } : {}), // 0.8.4 S9 (Q10, D8, D29), additive: one row per top-layer objection about a decision that the run acted on or refused; absent otherwise
    ...(Array.isArray(result.decisions) && result.decisions.length ? { decisions: result.decisions } : {}), // 0.8.3 E4b, additive: one row per conflict between layers the panel found; present only when one was found
    ...(Array.isArray(result.escalations) && result.escalations.length ? { escalations: escalationsOf(result) } : {}), // stall escalation, additive: one row per stall that was passed up a layer; present only when there was one
    ...(Array.isArray(result.handler_retags) && result.handler_retags.length ? { handler_retags: result.handler_retags } : {}), // B3 prep (JUDGE 4b), additive: the handler's re-tags of an objection's rating, each with the gate, the pass and the person's words as relayed
    ...(Array.isArray(result.owner_rulings) && result.owner_rulings.length ? { owner_rulings: result.owner_rulings } : {}), // B3 prototype, additive: the rulings the person who owns the request gave, each with the pass it applies from (gate.js rulingsOf)
    ...(Array.isArray(result.declined_requests) && result.declined_requests.length ? { declined_requests: result.declined_requests } : {}), // B3 prototype, additive: every ruling or withdrawal the handler session asked for and then declined itself (gate.js declinedBySessionOf); it set nothing, so it has no person_words
    ...(Array.isArray(result.relayed) && result.relayed.length ? { relayed: result.relayed } : {}), // B3 prototype, additive: every answer the handler session relayed on a person's permission, with his words (gate.js relayedAnswersOf)
    ...(Array.isArray(result.run_controls) && result.run_controls.length ? { run_controls: result.run_controls } : {}), // 0.8.4 S20 slice 2, additive: every request to start a pass at layer 3 and every route decision of the run, derived from the gate ledger at report time (src/run-controls.js runControlsOf)
    ...(Array.isArray(result.pauses) && result.pauses.length ? { pauses: result.pauses } : {}), // 0.8.4 S20 slice 2 (#16c), additive: every request to pause the run after the pass in progress, each with whether the resume took it or it lapsed, derived from the gate ledger at report time (src/run-controls.js pausesOf)
    ...(Array.isArray(result.raises) && result.raises.length ? { raises: result.raises } : {}), // 0.8.4 S20 slice 1, additive: every raise of the typed spending limit the run USED, derived from the gate ledger at report time (src/run-controls.js controlHistory): old and new total per cap, the ledger's own channel, who relayed it and in whose words
    ...(result.escalated_signoff ? { escalated_signoff: result.escalated_signoff } : {}), // stall escalation, additive: the top layer signed off with layers passed over; `passed` stays false and `outcome` is not widened
    ...(result.stop ? { stop: result.stop } : {}), // round semantics 2b: a run the person FINISHED at an overseer limit (chosen: 'finish') or a run that finished early at the session's proposal (kind early_finish, chosen: 'early'); a stopped run has it in report-partial.json
    ...(result.reviewNotes ? { review_notes: result.reviewNotes } : {}), // notes lane unit 2, additive: only on a run whose chain had the lane on
    ...(Number.isInteger(result.overseer_rounds) ? { overseer_rounds: result.overseer_rounds } : {}), // round semantics 2b, additive: only on a chain with overseer rounds
    ...(result.notQuorate ? { notQuorate: result.notQuorate } : {}),
    // Whole alternative architectures: additive, present only when the chain ran the stage. The
    // rendered board text lives in BOARD.md; the JSON carries the structured record only.
    // Pre-release cache audit #1: stages replayed from a cache entry that could only be checked
    // against the task and chain, not the exact prompt. Absent when there were none.
    ...(Array.isArray(result.unverifiedReplays) && result.unverifiedReplays.length ? { unverifiedReplays: result.unverifiedReplays } : {}),
    // 0.8.4 T14 (additive): the stages this sitting kept as they were saved under THC's earlier wording (an update between a pause and the resume changed a prompt sentence; nothing else did). Absent when there were none.
    ...(Array.isArray(result.answeredUnderEarlierWording) && result.answeredUnderEarlierWording.length ? { answered_under_earlier_wording: result.answeredUnderEarlierWording } : {}),
    ...(Array.isArray(result.answeredOnAnotherRoute) && result.answeredOnAnotherRoute.length ? { answered_on_another_route: result.answeredOnAnotherRoute } : {}),   // FIX 5, experimental
    // 0.8.1 FX-11: every model-written field the harness cut before the next stage read it. Absent when none was.
    ...(Array.isArray(result.fieldCuts) && result.fieldCuts.length ? { field_cuts: result.fieldCuts } : {}),
    ...(result.alternatives ? { alternatives: (({ board, ...rest }) => rest)(result.alternatives) } : {}),
    // Tiered councils: the deep-dive seat's record (src/deep-dive.js). Additive, present only when
    // the chain enabled the stage.
    ...(result.deep_dive ? { deep_dive: result.deep_dive } : {}),
    // "How this plan was argued" (src/argued.js): additive, present only when the chain enabled it.
    // The text itself is ARGUED.md; the JSON carries where it is, the fact-pack counts and the
    // reference check (unknown_refs / unknown_labs are ids and labs it named that the run never had).
    ...(result.argued ? { argued: { file: result.argued.file, facts_counts: result.argued.facts_counts, ...result.argued.check } } : {}),
    // Criterion kinds (src/criteria-kinds.js): additive, present only when the chain enabled them.
    // `criteria` above stays the plain list of strings; `criteria_kinds` is index-aligned with it.
    ...(result.criteriaKinds ? {
      criteria_kinds: result.criteriaKinds,
      criteria_summary: result.criteriaSummary,
      criteria_met_without_evidence: result.metWithoutEvidence,
    } : {}),
  };
}


// report-partial.json (0.7.7): a run the per-run spend cap stopped. Same shape as report.json, built
// from the partial result runChain attaches to BudgetExceeded (`err.partial`), plus `partial: true`,
// `stoppedBy` and `stoppedAtStage`. Its own file name on purpose: report.json existing means
// "finished" to run-status, spend, the API and the MCP server, and a stopped run is not finished.
// `finished_at` here is when the run stopped. Same privacy rules as report.json (task and fromRun
// relative, never absolute), because it is built by the same function.
export const PARTIAL_REPORT_FILE = 'report-partial.json';
export const PARTIAL_BOARD_FILE = 'BOARD-partial.md';
// The third partial twin (review fix F5, 18 Okt 2026): the plan as it stands when a layered run stops at an overseer limit, the DECLINED lines already stripped (src/draft-disputes.js stripDeclined). A derived copy of the current draft; it records no verdict. It lives and dies with report-partial.json.
export const PARTIAL_DELIVERABLE_FILE = 'deliverable-partial.md';
export function partialReportJsonShape({ stoppedBy, stoppedAtStage = null, ...args }) {
  return {
    ...reportJsonShape(args),
    partial: true,
    stoppedBy,
    ...(typeof stoppedAtStage === 'string' ? { stoppedAtStage } : {}),
  };
}

/** BOARD-partial.md's text: the same board, headed as a stopped run's, or '' when there is none. */
// What stopped the run, in the board's first line (0.8.1 M6, P20). `budget` keeps its words from 0.7.7.
const STOP_CAUSE_WORDS = Object.freeze({
  // BUG-D-002 (A-DRAFT): the general words of the layered stops (overseer-rounds.js whyOf) plus the tail the two entries below use.
  overseer_cap: `${stopWhyGeneral('overseer_cap')}, and the run waits for the person to choose`,
  layer_bound: `${stopWhyGeneral('layer_bound')}, and the run waits for the person to choose`,
  stall_stop: `${stopWhyGeneral('stall_stop')}, and the run waits for the person to choose`,   // 0.8.4 S5 (A-DRAFT)
  price_refused: 'OpenRouter refused a seat at its price limit and the run waits for the person to choose',
  conflict: 'the conflict decider asked for the person to choose which objection takes priority and the run waits',
  owner_pause: `${PAUSE_GENERAL_WORDS}, and the run waits for the person to resume it`,   // 0.8.4 S20 slice 2 (#16c, A-DRAFT)
});
export function renderPartialBoardMd({ runId, result, stoppedAtStage = null, cause = 'budget', noChooser = false }) {   // 0.8.4 S16 (D; WORDING S16-w39): a pause with no handling session names no chooser
  const board = renderBoardMd({ runId, result });
  if (!board) return '';
  if (cause === 'budget') return `> **Partial board.** This run stopped at its spend cap${stoppedAtStage ? ` before stage \`${stoppedAtStage}\`` : ''} and did not finish. The same record as data: \`${PARTIAL_REPORT_FILE}\`.\n\n${board}`;
  const causeWords = (STOP_CAUSE_WORDS[cause] ?? cause);
  const causeShown = noChooser ? causeWords.replace(/, and the run waits for the person to choose$/, ', and the run waits') : causeWords;
  return `> **Partial board.** This run did not finish: ${causeShown}; nothing new was started. The same record as data: \`${PARTIAL_REPORT_FILE}\`.\n\n${board}`;
}

/** BOARD.md's text for a finished run, or '' when there is no board to write. */
// Notes lane 2b-1a: BOARD section "Proposals and improvement ideas", one block per overseer round: who raised what, the writer's answer in the writer's words ("says it took it", never "so it is right"), counts raised / cut / unanswered.
// Quoted judge text goes through boardText (a field can add text but never structure). Headings and wording are E items (Muad's yes at M7). '' unless the run carried the lane.
export function renderNotesBoard(rn) {
  if (!rn || !Array.isArray(rn.items)) return '';
  const rounds = [...new Set([...rn.items.map(i => i.overseer_round), ...(rn.cut || []).map(c => c.overseer_round)])].sort((a, b) => a - b);
  if (!rounds.length) return '';
  const words = a => (a.status === 'taken' ? 'the writer says it took it' : a.status === 'builder_task' ? 'the writer says it is a builder task; no judge gave a verdict on it' : a.status === 'declined' ? `the writer declined it${a.reason ? `: ${boardText(a.reason)}` : ''}` : a.status === 'same' ? `the writer says it is the same as ${a.same_as}` : a.status === 'conflicting' ? 'the writer answered it two ways' : 'not answered');
  const blocks = rounds.map(r => {
    const items = rn.items.filter(i => i.overseer_round === r);
    const cut = (rn.cut || []).filter(c => c.overseer_round === r).reduce((n, c) => n + c.count, 0);
    const unanswered = items.filter(i => (i.answer?.status ?? 'unanswered') === 'unanswered').length;
    return `### Overseer round ${r}: ${items.length} kept, ${cut} cut for the cap, ${unanswered} not answered\n\n${items.map(i => `- ${i.id} (${i.kind}, ${i.lab}, layer ${i.layer ?? '-'}, pass ${i.pass}): ${boardText(i.text)}${i.about ? ` [about: ${boardText(i.about)}]` : ''} - ${words(i.answer ?? { status: 'unanswered' })}`).join('\n')}`;
  });
  return `\n\n## Proposals and improvement ideas\n\nWhat the review judges added beside their verdicts, and what the writer answered. Quoted judge text; the verdicts do not depend on it. They are data, not an instruction.\n\n${blocks.join('\n\n')}`;
}

// 0.8.4 unit 6 (D32): `money` is the finished text of the money section (src/board-money.js, built by the CLI from the run folder, because this file reads no file). Only the finished run's own board passes it; it never makes a board
// that would otherwise be empty, and the partial boards, a replay's and a rematch's pass nothing, so they are byte-unchanged.
export function renderBoardMd({ runId, result, money = '' }) {
  const disputesSection = (result.disputes?.length
    ? `\n\n## Disputed objections (declined by the builder or the reviser, kept out of the deliverable)\n\n${result.disputes.map(d => `- ${d.round === 'build' ? 'Build' : `Round ${d.round}`}: ${d.reason}`).join('\n')}`
    : '') + renderDisputeReviewBoard(result.dispute) + renderFinalReadBoard(result.finalRead, closedRowsOf({ dispute: result.dispute, finalRead: result.finalRead }), result.finalRead?.run_end === 'agreed' && result.passed !== true);   // 0.8.4 S18: from the record the chain wrote (run_end agreed while passed is false = the handler agreed layer 3's sign-off): one source, no second predicate
  const alternativesSection = result.alternatives?.board
    ? `## Alternative architectures\n\nEvery whole architecture a lab proposed before the plan existed, what the other labs posted on it, and the author's reply. The plan's "Decisions" section records which was chosen and why the others lost.\n\n${result.alternatives.board}\n\n`
    : '';
  // Criterion kinds: the count goes at the top of the board, where a person sees how much of the
  // definition of done a command can settle and how much rests on reviewers' judgement.
  const kindsSection = result.criteriaSummary ? `${summaryLine(result.criteriaSummary)}\n\n` : '';
  // 0.8.4 S14 (C&C R517, A-DRAFT, WORDING row): the count of the last critique's objections that quote no passage, beside the other count at the top of the board. It lists nothing: before W23 is applied every objection of an unfenced run is in it, and a list would read as a subset.
  const anchorLine = anchorSentence(result.lastCritique?.failures);
  const anchorSection = anchorLine ? `${anchorLine}\n\n` : '';
  const deepDiveSection = renderDeepDiveBoard(result.deep_dive, { judges: [...new Set([...(result.signoff || []), ...(result.panelVerdicts || [])].filter(v => !v?.cut).map(v => v?.lab).filter(Boolean))] });
  const dropoutsSection = renderDropoutsBoard(result.dropouts);
  const answersSection = renderAnswersBoard(rosterAnswersOf(result.stages));
  const topN = runTopLayer(result);   // 0.8.4 S8: the run's top layer from the result's layers[] (none: the texts say "the top layer", src/top-layer.js)
  const closedSet = new Set(closedRowsOf({ dispute: result.dispute, finalRead: result.finalRead }).map(r => `${r.lab}\u0000${r.id}`));
  const layersSection = renderLayersBoard(result.layers, result.layerStop) + renderDecisionsBoard(result.decisions, result.escalations) + renderProposerReturnsBoard(result.proposerReturns, topN) + renderEscalationsBoard(escalationsOf(result), result.escalated_signoff, closedSet.size ? closedSet : null, topN) + renderDissentsBoard(result.dissents);
  const labelsSection = renderTextLabelsBoard({ signedText: result.signedText, deliveredText: result.deliveredText, outcome: computeOutcome(result), ending: result.ending ?? null, ladderBlock: result.escalated_signoff?.ladder === true, requestedBlock: result.escalated_signoff?.requested === true && result.escalated_signoff?.ladder !== true, sentToJudge: (result.panelVerdicts || []).some(v => v?.cut === true) });   // PR #2 fix unit: a judge whose answer the finish cut DID read this text: "was never put to the panel" is not said then // only added to a board that exists (below)
  const notesSection = renderNotesBoard(result.reviewNotes);
  const earlyW = earlyFinishWords({ stop: result.stop, passed: result.passed });   // ROADMAP 83: the board says so at the top
  const earlySection = earlyW ? `## Finished early by the session\n\n${earlyW}.\n\n` : '';
  const secretW = secretFinishWords({ stop: result.stop, passed: result.passed });   // 0.8.4 (found-secret pause, --finish): a run the person finished at a credential-shaped pause
  const secretSection = secretW ? `## Not agreed: finished at a credential-shaped pause\n\n${secretW[0].toUpperCase()}${secretW.slice(1)}.\n\n` : '';
  const budgetW = budgetFinishWords({ stop: result.stop, passed: result.passed, finalRead: result.finalRead });   // 0.8.4 S16 (F; WORDING S16-w60b): a run the person finished at a spending stop
  const pauseW = ownerPauseFinishWords({ stop: result.stop, passed: result.passed });   // 0.8.4 (ladder unit, LAD-O6): a run the person finished at the owner's pause
  const pauseSection = pauseW ? `## Not agreed: finished at the owner's pause\n\n${pauseW[0].toUpperCase()}${pauseW.slice(1)}.\n\n` : '';
  const notRunW = stagesNotRunWords(result);   // 0.8.4 (LAD-B4): a run the person ended at the spending limit lists the calls that were not made; it says nothing of the verdict
  const notRunSection = notRunW ? `## ${(result.stages_not_run || []).some(r => r?.reason === 'spending_limit') ? 'Ended at the spending limit' : 'Ended at once'}\n\n${notRunW[0].toUpperCase()}${notRunW.slice(1)}.\n\n` : '';
  const budgetSection = budgetW ? `## Not agreed: finished at the spending limit\n\n${budgetW[0].toUpperCase()}${budgetW.slice(1)}.\n\n` : '';
  const finishedW = finishedAtStopWords(result);   // 0.8.4 L3, A-DRAFT (WORDING row L3-5): a stop the person finished while the top layer had not signed off on that plan
  const finishedSection = finishedW ? `## Not agreed: ${result.stop?.chosen === 'rule' ? 'ended at a stop because the run has no handling session' : `finished at the person's choice${relayedTail(result.stop)}`}\n\n${finishedW[0].toUpperCase()}${finishedW.slice(1)}.\n\n` : '';
  const endingW = endingWords(result);   // 0.8.4 S4, A-DRAFT: layer 3 signed off and the run does not end agreed
  const finalReadHeld = result.passed === true && finalReadBlocksAgreement(result.finalRead);   // its own banner (below) says so: not twice
  const endingBanner = endingW && !finalReadHeld ? `## Not agreed: ${endingW}\n\nEvery layer asked signed off, and the run is still recorded as not agreed (see \`ending\` in report.json). The signed plan is below; read the open objections before acting on it.\n\n` : '';
  const lateSection = renderLateFindingsBoard(withRatingsInForce(result.lateFindings, result.severityRun?.retags), topN);   // 0.8.4 S4b, A-DRAFT
  // 0.8.4 T14, A-DRAFT (one sentence, WORDING row): the stages kept as saved under THC's earlier wording. Named by label; nothing else is claimed about them.
  const earlierKept = Array.isArray(result.answeredUnderEarlierWording) ? result.answeredUnderEarlierWording : [];
  const earlierSection = earlierKept.length ? `## Kept as saved under THC's earlier wording\n\nThis run was resumed after THC's wording changed. ${earlierKept.length === 1 ? 'One stage was' : `${earlierKept.length} stages were`} answered under the earlier wording and kept as saved, with no new call: ${earlierKept.map(k => k.stage).join(', ')}. To ask ${earlierKept.length === 1 ? 'it' : 'them'} again under the current wording, start a new run (--draft) with the plan as it stands.\n\n` : '';
  const noCheckW = noBuildCheckWords(result);   // 0.8.4 S4, A-DRAFT (copy correction 11): agreed, and the record says that no build check was made
  const noCheckBanner = noCheckW ? `## Agreed on ${layerWord(topN)}'s sign-off, no build check\n\nThis run ended ${noCheckW} (see \`ending\` in report.json).\n\n` : '';
  const finalReadBanner = result.passed === true && finalReadBlocksAgreement(result.finalRead) ? `## Not agreed: ${finalReadObjected(result.finalRead) ? `${layerWord(topN)} objected to` : `not every ${layerHyphen(topN)} seat read`} the final plan\n\nEvery layer had signed off on an earlier text, but the plan changed afterwards and ${finalReadObjected(result.finalRead) ? `a ${layerHyphen(topN)} objection to the final text holds the sign-off` : `not every ${layerHyphen(topN)} seat read the final text`} (see Final read by ${layerWord(layerNOf(result.finalRead))} below). The panel verdict is not the ending.\n\n` : '';
  if (!(result.board || disputesSection || alternativesSection || kindsSection || deepDiveSection || dropoutsSection || answersSection || layersSection || notesSection || earlySection || secretSection || finishedSection || earlierSection || finalReadBanner || endingBanner || noCheckBanner || lateSection || pauseSection || budgetSection || notRunSection)) return '';   // 0.8.4 (ladder unit, found by the box set): a run finished at the owner's pause or at its spending limit, on a chain with no other board content, kept no BOARD.md at all, so the heading that says it was not agreed was never shown
  return `# Debate board - run ${runId}\n\n${finalReadBanner}${endingBanner}${noCheckBanner}${earlySection}${secretSection}${budgetSection}${pauseSection}${notRunSection}${finishedSection}${earlierSection}${lateSection}${kindsSection}${anchorSection}${dropoutsSection}${answersSection}${layersSection}${labelsSection}${alternativesSection}${deepDiveSection}${result.board ? `${alternativesSection ? '## Proposals\n\n' : ''}Every proposal, what the other labs posted on it, and the author's reply.\n\n${result.board}` : 'No proposal debate ran this round.'}${renderDroppedBoard(result.debate?.dropped)}${disputesSection}${notesSection}${typeof money === 'string' ? money : ''}`;
}

/** The layered panel's "Panel layers" table for BOARD.md (0.8.3), from report.json's `layers` rows; '' for an unlayered run. A layer that was never asked is a row, not a gap. */
/** The named exit when a run stopped because the open objections alone did not fit the top layer's ledger (E4): the held sentence, or null (before M7, and for every other run). Used by the --resume refusal. */
export function ledgerOverflowWords(report) {
  if (report?.layerStop?.reason !== 'ledger_overflow') return null;
  return held('ledgerOverflowExit')?.({ rows: report.layerStop.ledger?.rows, chars: report.layerStop.ledger?.chars, limit: LEDGER_MAX_CHARS }) ?? null;
}

export function renderLayersBoard(layers, layerStop = null) {
  if (!Array.isArray(layers) || !layers.length) return '';
  const rows = layers.map(r => `| ${r.round} | ${r.layer} | ${(r.labs || []).join(', ')} | ${layerStateWord(r)}${r.carried?.length ? ` (carried from an earlier round: ${r.carried.map(c => `${c.lab} from round ${c.from_round}`).join(', ')})` : ''} |`);
  // The held ledger sentence ends in its own full stop: add one only when the reason text has none, so the board never prints '..'.
  const stopWhy = layerStop ? layerStop.reason === 'top_layer_not_explicit' ? `${layerStop.labs.join(', ')} did not sign off explicitly (the top layer needs an explicit sign-off from every seat)` : layerStop.reason === 'only_stated_passes' ? 'nobody in it gave a verdict, only stated passes' : layerStop.reason === 'ledger_overflow' ? (held('ledgerOverflowExit')?.({ rows: layerStop.ledger?.rows, chars: layerStop.ledger?.chars, limit: LEDGER_MAX_CHARS }) ?? 'the open objections were too many to show the top layer in full, so nothing was sent to it') : 'nothing was objected to, so there was nothing to revise against' : '';
  const stop = layerStop ? `\n\nThe run stopped in round ${layerStop.round}, layer ${layerStop.layer}: ${stopWhy}${/[.!?]$/.test(stopWhy) ? '' : '.'} This is not agreement.` : '';
  const pressed = layers.some(r => r.floor_by === 'request');   // A-DRAFT variant for a board that has a pass that was asked to start at the top layer (the record shows a request, not whose); any other board keeps its sentence byte for byte
  return `## Panel layers\n\nA layer is asked only when every seat of the layers below it signed off on the same draft${(() => { const ex = [pressed && 'a pass that was asked to start at the top layer', layers.some(r => r.floor_by === 'ladder') && 'a pass the ladder started above layer 1', layers.some(r => r.floor_by === 'ladder_visits') && 'a pass in which the ladder passed a layer over'].filter(Boolean); return ex.length ? `, except ${ex.length > 1 ? `${ex.slice(0, -1).join(', ')} or ${ex.at(-1)}` : ex[0]}` : ''; })()}. (report.json \`layers\`.)\n\n| Round | Layer | Labs | State |\n|---|---|---|---|\n${rows.join('\n')}${stop}\n\n`;
}

/**
 * The conflict decider's footer for BOARD.md (0.8.3 E4b), from report.json's `decisions` rows; '' when there are none. One line per conflict: what swung, who ruled (or why nobody did), and, when the decider's lab is one of the labs
 * in the conflict, that it is. A-DRAFT wording (listed for the later Fable pass).
 */
/**
 * Stall escalation's BOARD.md section (A-DRAFT words), from report.json's `escalations` rows and `escalated_signoff`; '' when there are none. One line per passed-up objection: where it went, who ruled and what came of it; then, after an
 * escalated sign-off, that it is not consensus.
 */
/** M1 COMPLETE U1-3 (WORDING D1-2; A-DRAFT): the BOARD.md section for the dissents on the record, from report.json's `dissents`; '' when there are none (a held report and a board without dissents are unchanged). */
export function renderDissentsBoard(dissents) {
  if (!Array.isArray(dissents) || !dissents.length) return '';
  const num = v => (typeof v === 'number' ? v : null);
  const lines = dissents.map(d => {
    const r = num(d.rating?.in_force) ?? num(d.rating?.as_raised);
    return `- ${d.id} (${d.name}): ${r === null ? 'not rated' : `rated ${r}`}; overruled by layer ${d.ruling.layer} in round ${d.ruling.round}; ${d.kept ? `kept in round ${d.kept.round}` : 'not answered after the overrule'}; open.`;
  });
  return `## Dissents on the record\n\nThe top layer signed off and overruled these objections. Their judges still hold them.\n\n${lines.join('\n')}\n\n`;
}

/** The run's top layer: the highest layer of the recorded layer rows, else the final read's. 3 when neither names one (every shipped layered chain has layers 1, 2, 3). Pure. */
export function runTopLayer(result) { return topLayerOf({ layers: result?.layers, finalRead: result?.finalRead }); }

export function renderEscalationsBoard(escalations, escalatedSignoff = null, closed = null, N) {   // 0.8.4 S8 c3: `closed` (seat key + id, the closure's own keys) and N: a passed-up objection the closing read closed says so (WORDING row 1672)
  if (!Array.isArray(escalations) || !escalations.length) return '';
  const ruledOn = (e, o) => o.result === 'sustained' || o.result === 'overruled' || (e.rulings || []).some(r => r.id === o.id && r.ruling);   // a ruling was READ for this objection (a seat's ruling, or a settled result): "ruled on" says only that; an unreadable or unreachable ruler, or the ruling words not recorded, is "not ruled on"
  const whyWords = { prompt_held: 'the ruling words are not recorded yet', ruler_unreachable: 'a ruling seat could not be reached', unreadable_ruling: 'a ruling could not be read', no_ruling: 'not every seat ruled on it' };
  const lines = escalations.flatMap(e => (e.outcome || []).map(o => {
    const reasons = (e.rulings || []).filter(r => r.id === o.id && r.reason).map(r => `${r.lab} (${r.ruling}): ${r.reason}`).join('; ');
    const result = o.result === 'sustained' ? `sustained; from then on the objection of ${(o.adopted_as || []).map(a => `${a.lab} (${a.id})`).join(' and ')}`
      : o.result === 'overruled' ? (o.stays_open === true ? 'overruled; it stays open (rated 4 or above, not rated, or once rated 7 or above), so the ruling closed nothing' : o.stays_open === false ? 'overruled; closed, although its raiser did not withdraw it (rated below 4)' : 'overruled; closed, although its raiser did not withdraw it') : `no ruling closed it (${whyWords[o.why] ?? o.why}); ${closed && closed.has(`${o.seat ?? o.lab}\u0000${o.id}`) ? `closed below 4 at ${layerWord(N)}'s closing read (every ${layerHyphen(N)} seat sorted it may-leave)` : `it stands as ${o.lab}'s`}`;
    const again = (e.raised_again || []).filter(r => r.id === o.id && !r.counted).map(r => r.pass);
    const reopened = (e.raised_again || []).filter(r => r.id === o.id && r.counted).map(r => r.pass);
    return `- ${o.id} (${o.lab}, layer ${o.layer ?? '?'}): ${escalationStoodWords(e)}, passed up to layer ${e.to_layer}, ${ruledOn(e, o) ? 'ruled on' : 'not ruled on'} in pass ${e.pass}: ${result}.${reasons ? ` ${reasons}` : ''}${again.length ? ` Raised again by ${o.lab} in pass ${again.join(', ')}, with a quote; not counted.` : ''}${reopened.length ? ` Raised again by ${o.lab} in pass ${reopened.join(', ')} without a quote, so in pass ${reopened.join(', ')} it counted as a live objection again.` : ''}`;   // the reopened words: FIX F1, A-DRAFT
  }));
  // 0.8.4 (A-DRAFT): an objection that climbed FLAGGED (layer 1's exchange had not debated it) is not ruled on, so it has no outcome row above; it gets its own line, with what became of it (`next`, derived: one reader for the report and the board).
  for (const e of escalations) for (const n of e.not_debated || []) lines.push(`- ${n.id} (${n.lab}): ${escalationStoodWords(e)}, passed up to layer ${e.to_layer}, but layer ${n.layer ?? 1}'s exchange had not debated it, so layer ${e.to_layer} was not asked to rule on it. ${notDebatedNextWords(n)}`.trim());
  const end = escalatedSignoff ? `\n\n**Escalated sign-off:** the top layer (layer ${escalatedSignoff.layer}) signed off in pass ${escalatedSignoff.pass} ${escalatedSignoff.below.length ? `with layer ${escalatedSignoff.below.join(', ')} passed over` : `while ${(escalatedSignoff.raised_again || []).join(', ')} ${(escalatedSignoff.raised_again || []).length === 1 ? 'was' : 'were'} still raised by a judge, after a ruling had closed ${(escalatedSignoff.raised_again || []).length === 1 ? 'it' : 'them'}`}. This is not consensus: \`passed\` is false.` : '';
  const outsAll = escalations.flatMap(e => e.outcome || []);   // INTRO-7fe-base: the one branch whose judges were asked, whether or not every seat was heard
  const noRulingRead = outsAll.length > 0 && !escalations.some(e => (e.outcome || []).some(o => ruledOn(e, o))) && !outsAll.every(o => o.why === 'prompt_held');
  return `## Objections passed up a layer\n\n${(() => { const n = escalationTriggersOf(escalations); const total = escalations.length; return n.layer2_bound === total ? "Layer 2's objections were still open after layer 2 had used its revisions, so instead of ending the run the plan was sent up to layer 3 (layers 1 and 2 were not asked in that pass), " : n.layer2_bound > 0 ? "Some objections stood unchanged for the stall rule's rounds, or were still open after layer 1 or layer 2 had used its revisions, so instead of ending the run the plan was passed up a layer, " : n.send_up === 0 ? "A lower layer's objections stood unchanged for the stall rule's rounds, so instead of ending the run the plan was passed up a layer, " : n.send_up === total ? "A lower layer's objections were still open after layer 1 had used its revisions, so instead of ending the run the plan was sent up a layer, " : "Some of a lower layer's objections stood unchanged for the stall rule's rounds and some were still open after layer 1 had used its revisions, so instead of ending the run the plan was passed up a layer, "; })()}whose judges ${noRulingRead ? 'were asked to review' : 'reviewed'} it${(() => { const outs = escalations.flatMap(e => e.outcome || []); return escalations.some(e => (e.outcome || []).some(o => ruledOn(e, o))) ? ' and then ruled on them' : outs.length && outs.every(o => o.why === 'prompt_held') ? ', but none of its objections was ruled on, because the ruling words are not recorded yet' : outs.length ? ', but no ruling was read for any of the objections passed up; each line below says why' : `, but none of its objections was ruled on, because layer ${escalations.flatMap(e => e.not_debated || [])[0]?.layer ?? 1}\'s exchange had not debated them`; })()}. Details are in report.json under \`escalations\`.\n\n${lines.join('\n')}${end}\n\n`;
}

export function renderDecisionsBoard(decisions, escalations = []) {
  if (!Array.isArray(decisions) || !decisions.length) return '';
  const escalatedWhy = d => { const t = (Array.isArray(escalations) ? escalations : []).find(e => e.round === d.pass)?.trigger; return isLayerOneUp(t) ? "the pass that found it ended at layer 1's revision limit, and its objections were sent up a layer instead (see the escalations section)" : t === 'layer2_bound' ? "the pass that found it ended at layer 2's revision limit, and its objections were sent up to layer 3 instead (see the escalations section)" : 'the pass that found it stalled, and its objections were passed up a layer instead (see the section "Objections passed up a layer")'; };   // per decision: the escalation row of THAT pass says which (a run can have both)
  const why = { escalated: 'the pass that found it stalled, and its objections were passed up a layer instead (see the section "Objections passed up a layer")', no_decider_seat: 'this chain names no decider', prompt_held: "the decider's prompt is not recorded yet", last_round: 'it came in the last pass, which has no revise', loop_ended: 'the review loop ended before the revise it would have shaped (a stop, the person\'s finish, or the dispute rule)', over_limit: 'more conflicts than one decider call takes', person_asked: 'the decider asked for the person to choose and the run stopped for the answer', tree_member: 'the decider asked for the person, which a tree member is not offered, so neither side was applied and both objections stand', unreadable_ruling: "the decider's answer could not be read", decider_unreachable: 'the decider gave no reply' };
  const lines = decisions.map(d => {
    const swing = `${d.ids[0]} (${d.labs[0]}, layer ${d.layers[0]}) came back in pass ${d.pass}, after the writer revised the plan in response to ${d.ids.slice(1).map((id, i) => `${id} (${d.labs[i + 1]}, layer ${d.layers[i + 1]})`).join(', ')}. The judge that raised ${d.ids[0]} was asked in pass ${d.silent_round} and did not list it`;      // no last full stop: the line's own comes after the ruling clause (B-DRAFT join)
    const lean = d.decider_prevail !== undefined ? ` The decider leaned to ${d.decider_prevail === 'neither' ? 'neither side' : d.decider_prevail}${d.decider_reason ? ` (${d.decider_reason})` : ''}.` : '';
    const sideWords = d.prevail === 'neither' ? 'neither side prevails' : `${d.prevail} prevails`;
    const ruled = d.why === 'tree_member' ? `${why.tree_member}; the person was not asked`
      : d.decided ? (d.via ? `chosen ${d.via === 'tree' ? 'through the tree' : 'with --prevail at the terminal'}: ${sideWords}` : `${d.decider_lab ?? 'the decider'} ruled: ${sideWords}${d.reason ? ` (${d.reason})` : ''}${d.ask_person ? '; it asked for the person to choose' : ''}`)
      : `nobody ruled on this conflict: ${d.why === 'escalated' ? escalatedWhy(d) : (why[d.why] ?? d.why)}`;
    const shared = d.shares_lab_with?.length ? ` The decider's lab (${d.shares_lab_with.join(', ')}) is one of the labs in this conflict.` : '';
    return `- Pass ${d.pass}: ${swing}; ${ruled}.${lean}${shared}`;
  });
  return `## Conflicts between review layers\n\nAn objection from a judge of one layer came back after the writer revised the plan in response to an objection from another layer. The decider's ruling on such a conflict closes nothing: the judge who raised an objection is still asked about it. Details are in report.json under \`decisions\`.\n\n${lines.join('\n')}\n\n`;
}

/**
 * 0.8.4 S9 (Q10, D8, D29; WORDING S9-w16): BOARD.md's section on the proposer return, from the run's `proposerReturns` rows (report.json `proposer_returns`); '' when there are none. For people only: never in the seat-facing board. The raising seat is not named.
 */
const SELECTED_WORDS = { named: n => `because ${layerWord(n)} named it as the most consequential`, majority: 'because more seats named it', first_listed: 'as the first the seat listed', first_recorded: 'as the first recorded' };
export function renderProposerReturnsBoard(rows, topN = null) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const lines = rows.map(r => {
    const at = `Overseer round ${r.overseer_round}, pass ${r.pass}`;
    const title = r.entry_title ? ` (${r.entry_title})` : '';
    if (r.status === 'refused') return `- ${at}: an objection (${r.objection_id}) marked as a decision was not taken as one: ${refusalWords(r.refused, r.entry)}; it went to the writer as an ordinary objection.`;
    if (r.status === 'no_proposers') return `- ${at}: Decision ${r.entry}${title} is contested and the chain has no proposer seat, so the objection went to the writer with the entry in full.`;
    if (r.status === 'failed') return `- ${at}: Decision ${r.entry}${title} went back to the proposers, but no alternative could be read; the objection went to the writer as an ordinary one.`;
    const read = list => (Array.isArray(list) ? list.filter(x => x.status === 'readable').length : 0);
    const lost = list => (Array.isArray(list) ? list.filter(x => x.status !== 'readable').length : 0);
    const unreadable = [lost(r.alternatives) ? `${lost(r.alternatives)} alternative(s)` : null, lost(r.posts) ? `${lost(r.posts)} post(s)` : null, lost(r.answers) ? `${lost(r.answers)} answer(s)` : null].filter(Boolean);
    return `- ${at}: Decision ${r.entry}${title} went back to ${(r.alternatives || []).length} proposer(s): ${read(r.alternatives)} of ${(r.alternatives || []).length} alternative(s) read, ${read(r.posts)} post(s), ${read(r.answers)} answer(s). It was chosen ${typeof SELECTED_WORDS[r.selected_by] === 'function' ? SELECTED_WORDS[r.selected_by](topN) : (SELECTED_WORDS[r.selected_by] ?? r.selected_by)}. The writer's step was ${r.writer_step}.${unreadable.length ? ` Unreadable: ${unreadable.join(', ')}.` : ''}`;
  });
  return `## Proposer returns\n\nAn objection from the top layer that is about a decision, not about wording, ends an overseer round. On a chain with proposer seats that one decision goes back to the proposers: each writes an alternative, reads the others' and posts once, and answers the posts on its own; the writer then integrates one alternative or keeps the original with its reasons. A chain with no proposer seat sends the decision to the writer with the entry in full. A mark that cannot be checked against the plan's own text is not taken as a decision-level objection.\n\n${lines.join('\n')}\n\n`;
}

// Bug audit 2026-09-28 (area 2 #4): report.json's `dropouts` (a seated lab that produced nothing
// usable) was in no file a person reads, so a run whose `outcome` is "degraded" gave no reason
// anywhere but report.json and run.log. Near the top of BOARD.md, since it changes who argued.
// A-DRAFT (harness a, S6, Muad's yes owed): the BOARD section for the session seats. Everything in it is what the answerers declared; none of it steers the run.
const ANSWER_ROWS_SHOWN = 40;
export function renderAnswersBoard(ra) {
  if (!ra || !Array.isArray(ra.seats) || !ra.seats.length) return '';
  const who = a => (a?.client?.name ? `${a.client.name}${a.client.version ? ` ${a.client.version}` : ''}` : 'a client that gave no name');
  // a seat that asks for no model is a design fact, not a gap: it is listed as what it is and counted nowhere
  const rows = ra.seats.slice(0, ANSWER_ROWS_SHOWN).map(e => (e.status === 'no-model-asked' && !e.answered_by?.model
    ? `- ${e.label}: this seat asks for no particular model; answered by ${who(e.answered_by)}`
    : `- ${e.label}: seated as ${e.asked_for ?? 'no model'}; answered by ${who(e.answered_by)} as ${e.answered_by?.model ?? 'not declared'} (${e.company ?? 'company not known'})`));
  const more = ra.seats.length > ANSWER_ROWS_SHOWN ? `\n- ...and ${ra.seats.length - ANSWER_ROWS_SHOWN} more (report.json \`roster_answers\`)` : '';
  return `## Who answered the session seats\n\nAs declared by the client and the session, never verified.\n\n${rows.join('\n')}${more}\n\nCompanies on the panel as recorded: ${ra.recorded_companies}. Session seats whose company is not known: ${ra.unverified_seats}. The chain was designed for ${ra.design_companies}.${ra.panel_session_seats > 0 ? ' Nothing checks that the session seats on the panel were answered by separate sessions.' : ''}\n\n`;
}

export function renderDropoutsBoard(dropouts) {
  if (!Array.isArray(dropouts) || !dropouts.length) return '';
  const rows = dropouts.map(d => `- ${d.lab}${d.model ? ` (${d.model})` : ''}, at ${d.stage || 'an unknown stage'}: ${d.reason || 'no reason recorded'}`);
  return `## Dropped out\n\nSeated labs that produced nothing usable, so the council ran without them from that point (report.json \`dropouts\`; this is why a run's outcome can read "degraded").\n\n${rows.join('\n')}\n\n`;
}

// 0.7.8: what the debate stage's filters rejected (report.json debate.dropped). Only in BOARD.md,
// never in the board text the builder reads (R.renderBoard), so no seat's prompt changes.
const DROP_REASON_TEXT = {
  unknown_target: 'named a proposal id that does not exist',
  own_proposal: 'posted on its own proposal',
  bad_stance: 'had a stance other than support, object or merge',
  not_own_proposal: "answered another lab's proposal",
  not_posted_on: 'answered one of its proposals nobody posted on',
  bad_action: 'had an action other than keep, amend or withdraw',
  unreadable: 'reply did not parse at all',
  provider_error: 'the provider ended the reply with an error, a refusal or its content filter, twice (retried once)',
};
export function renderDroppedBoard(dropped) {
  if (!Array.isArray(dropped) || !dropped.length) return '';
  const rows = dropped.map(d => {
    const what = d.stage === 'replies' ? 'author reply' : 'debate post';
    const whole = d.reason === 'unreadable' || d.reason === 'provider_error';
    const n = whole ? `the whole ${d.stage === 'replies' ? 'reply round' : 'debate reply'}` : `${d.count} ${what}${d.count === 1 ? '' : 's'}`;
    return `- ${d.by}: ${n} - ${DROP_REASON_TEXT[d.reason] || d.reason}${whole && d.count > 1 ? ` (${d.count} times)` : ''}`;
  });
  return `\n\n## Dropped from the debate\n\nPosts and replies the harness could not place on this board, so they are not above. The raw replies are in this run folder (\`debate-<lab>.md\`, \`reply-<lab>.md\`).\n\n${rows.join('\n')}`;
}
