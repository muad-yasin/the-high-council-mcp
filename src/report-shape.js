// The shape of a run's report.json and the text of its BOARD.md, in one place.
//
// Moved out of cli.js on 2026-09-23 (pre-release audit, Review/PreRelease_Audit_replay_2026-09-23.md,
// HIGH): --replay hand-built its own report.json and so dropped the alternatives record and about
// 25 contract fields, and wrote no BOARD.md at all - a replay folder was a different, thinner
// artifact than the run it was compared against. Every writer (a normal run, `council init`,
// --rematch, --replay) now builds from these functions.
import { computeOutcome } from './outcome.js';
import { computeRoleDiagnostics } from './role-diagnostics.js';
import { deriveDisagreementGroups } from './disagreement-groups.js';
import { renderDisputeReviewBoard } from './chain.js';
import { summaryLine } from './criteria-kinds.js';
import { isAbsolute, relative, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { harnessProducer } from './version.js';

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
export function reportJsonShape({ runId, chain, task, taskCwd = null, taskText = null, startedAt = null, result, fromRun = null, fromRunCwd = taskCwd, maxUsd = null, config = null, policyChecks = null }) {
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
    maxUsd,
    stages: result.stages.map(({ text, ...rest }) => rest),
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
    ...(policyChecks ? { policy: { checks: policyChecks } } : {}),
    // Final security-review gate (src/security-review.js): additive, present only when the chain
    // enabled the stage - same object as the run folder's security-review.json.
    ...(result.security_review !== undefined ? { security_review: result.security_review } : {}),
    // Bug-audit fix, 2026-09-23 (Review/BugAudit_Metrics_2026-09-23.md #3, #6): these were on the
    // runChain result but never reached report.json, so the stats readers and anyone reading a run
    // folder could not see them (a real run's dispute stage and canary lived only in run.log).
    // Additive only; each is absent when the run produced none of it.
    ...(Array.isArray(result.panelVerdicts) ? { panelVerdicts: result.panelVerdicts } : {}),
    ...(Array.isArray(result.regressions) ? { regressions: result.regressions } : {}),
    ...(result.dispute != null ? { dispute: result.dispute } : {}),
    ...(result.canary !== undefined ? { canary: result.canary } : {}),
    ...(result.quoteFindings !== undefined ? { quoteFindings: result.quoteFindings } : {}),
    ...(result.patchFallbacks !== undefined ? { patchFallbacks: result.patchFallbacks } : {}),
    ...(result.coldRead != null ? { coldRead: result.coldRead } : {}),
    ...(result.noHeardReviewer ? { noHeardReviewer: result.noHeardReviewer } : {}),
    // Whole alternative architectures: additive, present only when the chain ran the stage. The
    // rendered board text lives in BOARD.md; the JSON carries the structured record only.
    // Pre-release cache audit #1: stages replayed from a cache entry that could only be checked
    // against the task and chain, not the exact prompt. Absent when there were none.
    ...(Array.isArray(result.unverifiedReplays) && result.unverifiedReplays.length ? { unverifiedReplays: result.unverifiedReplays } : {}),
    ...(result.alternatives ? { alternatives: (({ board, ...rest }) => rest)(result.alternatives) } : {}),
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
export function partialReportJsonShape({ stoppedBy, stoppedAtStage = null, ...args }) {
  return {
    ...reportJsonShape(args),
    partial: true,
    stoppedBy,
    ...(typeof stoppedAtStage === 'string' ? { stoppedAtStage } : {}),
  };
}

/** BOARD-partial.md's text: the same board, headed as a stopped run's, or '' when there is none. */
export function renderPartialBoardMd({ runId, result, stoppedAtStage = null }) {
  const board = renderBoardMd({ runId, result });
  if (!board) return '';
  return `> **Partial board.** This run stopped at its spend cap${stoppedAtStage ? ` before stage \`${stoppedAtStage}\`` : ''} and did not finish. The same record as data: \`${PARTIAL_REPORT_FILE}\`.\n\n${board}`;
}

/** BOARD.md's text for a finished run, or '' when there is no board to write. */
export function renderBoardMd({ runId, result }) {
  const disputesSection = (result.disputes?.length
    ? `\n\n## Disputed objections (declined by the reviser, kept out of the deliverable)\n\n${result.disputes.map(d => `- Round ${d.round}: ${d.reason}`).join('\n')}`
    : '') + renderDisputeReviewBoard(result.dispute);
  const alternativesSection = result.alternatives?.board
    ? `## Alternative architectures\n\nEvery whole architecture a lab proposed before the plan existed, what the other labs posted on it, and the author's reply. The plan's "Decisions" section records which was chosen and why the others lost.\n\n${result.alternatives.board}\n\n`
    : '';
  // Criterion kinds: the count goes at the top of the board, where a person sees how much of the
  // definition of done a command can settle and how much rests on reviewers' judgement.
  const kindsSection = result.criteriaSummary ? `${summaryLine(result.criteriaSummary)}\n\n` : '';
  if (!(result.board || disputesSection || alternativesSection || kindsSection)) return '';
  return `# Debate board - run ${runId}\n\n${kindsSection}${alternativesSection}${result.board ? `${alternativesSection ? '## Proposals\n\n' : ''}Every proposal, what the other labs posted on it, and the author's reply.\n\n${result.board}` : 'No proposal debate ran this round.'}${renderDroppedBoard(result.debate?.dropped)}${disputesSection}`;
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
};
export function renderDroppedBoard(dropped) {
  if (!Array.isArray(dropped) || !dropped.length) return '';
  const rows = dropped.map(d => {
    const what = d.stage === 'replies' ? 'author reply' : 'debate post';
    const n = d.reason === 'unreadable' ? `the whole ${d.stage === 'replies' ? 'reply round' : 'debate reply'}` : `${d.count} ${what}${d.count === 1 ? '' : 's'}`;
    return `- ${d.by}: ${n} - ${DROP_REASON_TEXT[d.reason] || d.reason}${d.reason === 'unreadable' && d.count > 1 ? ` (${d.count} times)` : ''}`;
  });
  return `\n\n## Dropped from the debate\n\nPosts and replies the harness could not place on this board, so they are not above. The raw replies are in this run folder (\`debate-<lab>.md\`, \`reply-<lab>.md\`).\n\n${rows.join('\n')}`;
}
