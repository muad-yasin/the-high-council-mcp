// The shape of a run's report.json and the text of its BOARD.md, in one place.
//
// Moved out of cli.js on 2026-09-23 (pre-release audit, Review/PreRelease_Audit_replay_2026-09-23.md,
// HIGH): --replay hand-built its own report.json and so dropped the alternatives record and about
// 25 contract fields, and wrote no BOARD.md at all - a replay folder was a different, thinner
// artifact than the run it was compared against. Every writer (a normal run, `council init`,
// --rematch, --replay) now builds from these functions.
import { renderDeepDiveBoard } from './deep-dive.js';
import { LAYER_STATE_WORDS } from './layers.js';
import { stopWhyGeneral } from './overseer-rounds.js';
import { held } from './held-roles.js';
import { LEDGER_MAX_CHARS } from './objection-ledger.js';
import { renderAdviseBoard } from './advise.js';
import { computeOutcome } from './outcome.js';
import { renderTextLabelsBoard } from './text-labels.js';
import { earlyFinishWords } from './verdict-headline.js';
import { buildThinContract, sha256Of } from './thin-contract.js';
import { computeRoleDiagnostics } from './role-diagnostics.js';
import { deriveDisagreementGroups } from './disagreement-groups.js';
import { renderDisputeReviewBoard } from './chain.js';
import { boardText } from './roles.js';
import { summaryLine } from './criteria-kinds.js';
import { criterionIds } from './criteria-ledger.js';
import { criteriaHash, checksHash, checksOf } from './criteria-lock.js';
import { cutDespiteSupport, disagreementMap } from './decision-records.js';
import { isAbsolute, relative, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { harnessProducer } from './version.js';
import { rosterAnswersOf } from './answered-by.js';

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
  if (!result || result.advise) return null;
  const has = Array.isArray(result.criteria) && result.criteria.length;
  return buildThinContract({
    taskSha256: typeof taskText === 'string' ? sha256Of(taskText) : null,
    criteriaSha256: has ? criteriaHash(result.criteria) : null,
    checksSha256: has ? checksHash(checksOf(result.criteria, result.criteriaKinds)) : null,
    contextSha256, groundTruth: result.ground_truth, signedTextSha256: result.signedText?.sha256,
  });
}

export function reportJsonShape({ runId, chain, task, taskCwd = null, taskText = null, startedAt = null, result, fromRun = null, fromRunCwd = taskCwd, maxUsd = null, config = null, contextSha256 = null, policyChecks = null, policyWarnings = null, adviseExtra = null, tree = null, verdictEnvelope = false }) {
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

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    producer: harnessProducer(),
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
    lastCritique: result.lastCritique,
    signoff: result.signoff,
    challenge: result.challenge,
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
    maxUsd,
    // 0.8.1 DR-13 (N4): the exact prompt's full sha256, its size, the serving endpoint and the scan result go to
    // audit.jsonl only (src/audit.js); stages[] keeps the 16-hex promptHash it always had.
    stages: result.stages.map(({ text, promptSha256, promptBytes, endpoint, scan, ...rest }) => rest),
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
    ...(Array.isArray(result.answerBack) && result.answerBack.length ? { answer_back: result.answerBack } : {}),
    ...(Array.isArray(result.answerBackReplies) && result.answerBackReplies.length ? { answer_back_replies: result.answerBackReplies } : {}),
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
    ...(result.canary !== undefined ? { canary: result.canary } : {}),
    ...(result.quoteFindings !== undefined ? { quoteFindings: result.quoteFindings } : {}),
    ...(result.patchFallbacks !== undefined ? { patchFallbacks: result.patchFallbacks } : {}),
    ...(result.coldRead != null ? { coldRead: result.coldRead } : {}),
    ...(result.noHeardReviewer ? { noHeardReviewer: result.noHeardReviewer } : {}),
    // 0.8.3 (layered review panel), additive, present only on a layered chain: one row per round per layer, and the stop of a layer that ended the run without a usable vote.
    ...(Array.isArray(result.layers) ? { layers: result.layers } : {}),
    ...(result.layerStop ? { layerStop: result.layerStop } : {}),
    ...(Array.isArray(result.decisions) && result.decisions.length ? { decisions: result.decisions } : {}), // 0.8.3 E4b, additive: one row per conflict between layers the panel found; present only when one was found
    ...(result.stop ? { stop: result.stop } : {}), // round semantics 2b: a run the person FINISHED at an overseer limit (chosen: 'finish') or a run that finished early at the session's proposal (kind early_finish, chosen: 'early'); a stopped run has it in report-partial.json
    ...(result.reviewNotes ? { review_notes: result.reviewNotes } : {}), // notes lane unit 2, additive: only on a run whose chain had the lane on
    ...(Number.isInteger(result.overseer_rounds) ? { overseer_rounds: result.overseer_rounds } : {}), // round semantics 2b, additive: only on a chain with overseer rounds
    ...(result.notQuorate ? { notQuorate: result.notQuorate } : {}),
    // Whole alternative architectures: additive, present only when the chain ran the stage. The
    // rendered board text lives in BOARD.md; the JSON carries the structured record only.
    // Pre-release cache audit #1: stages replayed from a cache entry that could only be checked
    // against the task and chain, not the exact prompt. Absent when there were none.
    ...(Array.isArray(result.unverifiedReplays) && result.unverifiedReplays.length ? { unverifiedReplays: result.unverifiedReplays } : {}),
    // 0.8.1 FX-11: every model-written field the harness cut before the next stage read it. Absent when none was.
    ...(Array.isArray(result.fieldCuts) && result.fieldCuts.length ? { field_cuts: result.fieldCuts } : {}),
    ...(result.alternatives ? { alternatives: (({ board, ...rest }) => rest)(result.alternatives) } : {}),
    // Tiered councils: the deep-dive seat's record (src/deep-dive.js). Additive, present only when
    // the chain enabled the stage.
    ...(result.deep_dive ? { deep_dive: result.deep_dive } : {}),
    // The council advisor (src/advise.js): additive, present only when the chain enabled it. Every
    // seat's blind answer and final position, the debate, the verdict, the dissent and what it cost.
    // Brief 29 (experimental), nested by the 0.8.1 naming pass (DR-13): where the brief went (advise.sent_to) and
    // the dispositions the caller recorded before the call (advise.dispositions). The brief's hash is task_sha256.
    ...(result.advise ? { advise: { ...result.advise, ...(adviseExtra || {}) } } : {}),
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
const ADVICE_ONLY_CAUSES = Object.freeze(['user', 'client_cancel', 'wall_clock']);
const STOP_CAUSE_WORDS = Object.freeze({
  user: 'a person asked it to stop. Calls already in flight were finished and are recorded',
  client_cancel: 'the client that started it cancelled the call or went away. Calls already in flight were finished and are recorded',
  // A wall clock is a deadline every request gets (setRequestDeadlineAt): a call still running at that moment is cut off.
  wall_clock: 'its wall-clock ceiling passed. A call still running at that moment was cut off and is recorded as not answering',
  // BUG-D-002 (A-DRAFT): the general words of the layered stops (overseer-rounds.js whyOf) plus the tail the two entries below use.
  overseer_cap: `${stopWhyGeneral('overseer_cap')}, and the run waits for the person to choose`,
  layer_bound: `${stopWhyGeneral('layer_bound')}, and the run waits for the person to choose`,
  price_refused: 'OpenRouter refused a seat at its price limit and the run waits for the person to choose',
  conflict: 'the conflict decider asked for the person to choose which objection takes priority and the run waits',
});
export function renderPartialBoardMd({ runId, result, stoppedAtStage = null, cause = 'budget' }) {
  // Only an advice call is stopped by a person, a client or a wall clock (0.8.1): with no answer paid for it has no board, never the
  // planning board's dropout list (M6 review fix).
  // BUG-D-002: only these three are an advice call's stops; the layered stops, the price refusal and the conflict ask stop a PLANNING run, which has a board to show.
  if (ADVICE_ONLY_CAUSES.includes(cause) && !(result.advise?.opinions || []).length) return '';
  const board = renderBoardMd({ runId, result });
  if (!board) return '';
  if (cause === 'budget') return `> **Partial board.** This run stopped at its spend cap${stoppedAtStage ? ` before stage \`${stoppedAtStage}\`` : ''} and did not finish. The same record as data: \`${PARTIAL_REPORT_FILE}\`.\n\n${board}`;
  return `> **Partial board.** This run did not finish: ${STOP_CAUSE_WORDS[cause] ?? cause}; nothing new was started. The same record as data: \`${PARTIAL_REPORT_FILE}\`.\n\n${board}`;
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

export function renderBoardMd({ runId, result }) {
  // An advice run has no proposal board: its board is the advice, every seat's answer and the debate.
  // A run stopped before it answered has nothing to show.
  // A stopped call (0.8.1 M6) shows what was paid for, when anything was.
  if (result.advise) return result.advise.status === 'answered' || (result.advise.status === 'stopped' && (result.advise.opinions || []).length) ? `# Advice board - run ${runId}\n\n${renderAdviseBoard(result.advise, result.adviseRecord)}` : '';
  const disputesSection = (result.disputes?.length
    ? `\n\n## Disputed objections (declined by the builder or the reviser, kept out of the deliverable)\n\n${result.disputes.map(d => `- ${d.round === 'build' ? 'Build' : `Round ${d.round}`}: ${d.reason}`).join('\n')}`
    : '') + renderDisputeReviewBoard(result.dispute);
  const alternativesSection = result.alternatives?.board
    ? `## Alternative architectures\n\nEvery whole architecture a lab proposed before the plan existed, what the other labs posted on it, and the author's reply. The plan's "Decisions" section records which was chosen and why the others lost.\n\n${result.alternatives.board}\n\n`
    : '';
  // Criterion kinds: the count goes at the top of the board, where a person sees how much of the
  // definition of done a command can settle and how much rests on reviewers' judgement.
  const kindsSection = result.criteriaSummary ? `${summaryLine(result.criteriaSummary)}\n\n` : '';
  const deepDiveSection = renderDeepDiveBoard(result.deep_dive, { judges: [...new Set([...(result.signoff || []), ...(result.panelVerdicts || [])].map(v => v?.lab).filter(Boolean))] });
  const dropoutsSection = renderDropoutsBoard(result.dropouts);
  const answersSection = renderAnswersBoard(rosterAnswersOf(result.stages));
  const layersSection = renderLayersBoard(result.layers, result.layerStop) + renderDecisionsBoard(result.decisions);
  const labelsSection = renderTextLabelsBoard({ signedText: result.signedText, deliveredText: result.deliveredText, outcome: computeOutcome(result) }); // only added to a board that exists (below)
  const notesSection = renderNotesBoard(result.reviewNotes);
  const earlyW = earlyFinishWords({ stop: result.stop, passed: result.passed });   // ROADMAP 83: the board says so at the top
  const earlySection = earlyW ? `## Finished early by the session\n\n${earlyW}.\n\n` : '';
  if (!(result.board || disputesSection || alternativesSection || kindsSection || deepDiveSection || dropoutsSection || answersSection || layersSection || notesSection || earlySection)) return '';
  return `# Debate board - run ${runId}\n\n${earlySection}${kindsSection}${dropoutsSection}${answersSection}${layersSection}${labelsSection}${alternativesSection}${deepDiveSection}${result.board ? `${alternativesSection ? '## Proposals\n\n' : ''}Every proposal, what the other labs posted on it, and the author's reply.\n\n${result.board}` : 'No proposal debate ran this round.'}${renderDroppedBoard(result.debate?.dropped)}${disputesSection}${notesSection}`;
}

/** The layered panel's "Panel layers" table for BOARD.md (0.8.3), from report.json's `layers` rows; '' for an unlayered run. A layer that was never asked is a row, not a gap. */
/** The named exit when a run stopped because the open objections alone did not fit the top layer's ledger (E4): the held sentence, or null (before M7, and for every other run). Used by the --resume refusal. */
export function ledgerOverflowWords(report) {
  if (report?.layerStop?.reason !== 'ledger_overflow') return null;
  return held('ledgerOverflowExit')?.({ rows: report.layerStop.ledger?.rows, chars: report.layerStop.ledger?.chars, limit: LEDGER_MAX_CHARS }) ?? null;
}

export function renderLayersBoard(layers, layerStop = null) {
  if (!Array.isArray(layers) || !layers.length) return '';
  const rows = layers.map(r => `| ${r.round} | ${r.layer} | ${(r.labs || []).join(', ')} | ${LAYER_STATE_WORDS[r.state] || r.state}${r.carried?.length ? ` (carried from an earlier round: ${r.carried.map(c => `${c.lab} from round ${c.from_round}`).join(', ')})` : ''} |`);
  // The held ledger sentence ends in its own full stop: add one only when the reason text has none, so the board never prints '..'.
  const stopWhy = layerStop ? layerStop.reason === 'top_layer_not_explicit' ? `${layerStop.labs.join(', ')} did not sign off explicitly (the top layer needs an explicit sign-off from every seat)` : layerStop.reason === 'only_stated_passes' ? 'nobody in it gave a verdict, only stated passes' : layerStop.reason === 'ledger_overflow' ? (held('ledgerOverflowExit')?.({ rows: layerStop.ledger?.rows, chars: layerStop.ledger?.chars, limit: LEDGER_MAX_CHARS }) ?? 'the open objections were too many to show the top layer in full, so nothing was sent to it') : 'nothing was objected to, so there was nothing to revise against' : '';
  const stop = layerStop ? `\n\nThe run stopped in round ${layerStop.round}, layer ${layerStop.layer}: ${stopWhy}${/[.!?]$/.test(stopWhy) ? '' : '.'} This is not agreement.` : '';
  return `## Panel layers\n\nA layer is asked only when every seat of the layers below it signed off on the same draft. (report.json \`layers\`.)\n\n| Round | Layer | Labs | State |\n|---|---|---|---|\n${rows.join('\n')}${stop}\n\n`;
}

/**
 * The conflict decider's footer for BOARD.md (0.8.3 E4b), from report.json's `decisions` rows; '' when there are none. One line per conflict: what swung, who ruled (or why nobody did), and, when the decider's lab is one of the labs
 * in the conflict, that it is. A-DRAFT wording (listed for the later Fable pass).
 */
export function renderDecisionsBoard(decisions) {
  if (!Array.isArray(decisions) || !decisions.length) return '';
  const why = { no_decider_seat: 'this chain names no decider', prompt_held: "the decider's prompt is not recorded yet", last_round: 'it came in the last pass, which has no revise', loop_ended: 'the review loop ended before the revise it would have shaped (a stop, the person\'s finish, or the dispute rule)', over_limit: 'more conflicts than one decider call takes', person_asked: 'the decider asked for the person to choose and the run stopped for the answer', tree_member: 'the decider asked for the person, which a tree member is not offered, so neither side was applied and both objections stand', unreadable_ruling: "the decider's answer could not be read", decider_unreachable: 'the decider gave no reply' };
  const lines = decisions.map(d => {
    const swing = `${d.ids[0]} (${d.labs[0]}, layer ${d.layers[0]}) came back in pass ${d.pass}, after the writer revised the plan in response to ${d.ids.slice(1).map((id, i) => `${id} (${d.labs[i + 1]}, layer ${d.layers[i + 1]})`).join(', ')}. The judge that raised ${d.ids[0]} was asked in pass ${d.silent_round} and did not list it`;      // no last full stop: the line's own comes after the ruling clause (B-DRAFT join)
    const lean = d.decider_prevail !== undefined ? ` The decider leaned to ${d.decider_prevail === 'neither' ? 'neither side' : d.decider_prevail}${d.decider_reason ? ` (${d.decider_reason})` : ''}.` : '';
    const sideWords = d.prevail === 'neither' ? 'neither side prevails' : `${d.prevail} prevails`;
    const ruled = d.why === 'tree_member' ? `${why.tree_member}; the person was not asked`
      : d.decided ? (d.via ? `chosen ${d.via === 'tree' ? 'through the tree' : 'with --prevail at the terminal'}: ${sideWords}` : `${d.decider_lab ?? 'the decider'} ruled: ${sideWords}${d.reason ? ` (${d.reason})` : ''}${d.ask_person ? '; it asked for the person to choose' : ''}`)
      : `nobody ruled: ${why[d.why] ?? d.why}`;
    const shared = d.shares_lab_with?.length ? ` The decider's lab (${d.shares_lab_with.join(', ')}) is one of the labs in this conflict.` : '';
    return `- Pass ${d.pass}: ${swing}; ${ruled}.${lean}${shared}`;
  });
  return `## Conflicts between review layers\n\nAn objection from a judge of one layer came back after the writer revised the plan in response to an objection from another layer. A ruling closes nothing: the judge who raised an objection is still asked about it. Details are in report.json under \`decisions\`.\n\n${lines.join('\n')}\n\n`;
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
  return `## Who answered the session seats\n\nAs declared by the client and the session, never verified.\n\n${rows.join('\n')}${more}\n\nCompanies on the panel as recorded: ${ra.recorded_companies}. Session seats whose company is not known: ${ra.unverified_seats}. The chain was designed for ${ra.design_companies}.\n\n`;
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
