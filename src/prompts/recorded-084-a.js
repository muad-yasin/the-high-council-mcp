// Prompt words: the 0.8.4 words of the held batch held-084-a (test/held-prompts/held-084-a.js), recorded at the apply after the wording review: the functions are copied from that file, src/roles.js exports them by name, and test/held-prompts-084-a.test.js compares the two.
// The comments below are the held file's own drafting notes, kept word for word; where they say "test data" or "drafted" they describe the file as it was before the recording.
// The DRAFTED sentences of lane A of the 0.8.4 build (plan A, l.86 and following), written exactly as they will appear in src/roles.js. Test data, like held.js: nothing here ships.
// This batch is recorded all together or not at all (test/held-prompts.test.js), at the one prompt re-record after the maintainer's yes at the release wording review. A-DRAFT: every sentence waits for that yes.
// A name drafted here may not be drafted in another batch. Each function carries the plan item it comes from.

// D16 (T1.2, plan A l.86): added to the writer seat's builder rules (BUILDER_SYSTEM's "Rules:" list). A limit the plan sets is a default with a reason; only a limit the request sets is hard.
// src/stage-system.js builderSystemOf puts the returned sentence into the Rules list as one more "- " item, right after BUILDER_SYSTEM and before the scope and decisions rules, once src/roles.js exports
// `builderLimitsRule`; until then nothing is added and the prompt is byte-identical. D15's marker paragraph (l.84) joins the same list (BUILDER_RULE_ITEMS).
// fenceFor is src/fence.js's, copied here (three lines, no import of src/fence.js, which reaches src/roles.js through src/held-roles.js and would make a cycle).
const fenceFor = text => '`'.repeat(Math.max(3, Math.max(0, ...[...String(text).matchAll(/`+/g)].map(m => m[0].length)) + 1));
import { containerText } from '../container-text.js';

export function builderLimitsRule() {
  return 'A limit you set on where the build session may change code is a default: give its reason and the evidence that would lift it. Write a hard limit only when the request sets it, and say that the request sets it. Where a step rests on an UNVERIFIED claim, give the fallback the build session takes if checking disproves the claim; write a step that stops the build only when no safe fallback exists.';
}

// D33 (T1.6, plan A T3.3 entry 5): the harness line for the end of List 1 ("Verify first") of a handoff whose task fenced no test file (src/fence-tests.js noFencedTestFile). The harness writes it, not a seat. It is
// shown only after the maintainer's yes on T3.3's entries 2 and 5; List 1 itself is D17's, so nothing places it yet.
export function handoffNoTestsLine() {
  return "None of the source blocks quoted to the Council has the path or name of a test file. Before the first step, read the tests that cover the code you will change. The Council may not have seen the checks used to judge this work.";
}

// D22 (T3.3, plan A T3 wording, the seat-written half of the one-shot switch `builder_kind: "one_shot"`): used by src/handoff-prompt.js through src/builder-kind.js, only when BOTH are recorded.
// oneShotDependencyEnd replaces the two sentences "If it cannot check, it stops and asks the person. It never treats this list as already checked." of the handoff seat's dependency paragraph.
export function oneShotDependencyEnd() {
  return "If it cannot check, it does not install the item, records it under 'Assumptions' with what it did instead, and never treats this list as already checked.";
}
// oneShotHandoffNote is added at the end of the handoff seat's prompt.
export function oneShotHandoffNote() {
  return 'The build session works alone: it cannot ask a person or run council commands. Never tell it to stop and ask; give the fallback the plan states, or tell it to skip the item and record it.';
}

// D3 (T2.6, plan A T3.3 entry 8): the file name the handoff prompt gives the plan, the name the CLI writes the delivered plan under (src/cli.js: deliverable.md). The sentence's words do not change; only this value does
// (today `PLAN.md`). Used by src/handoff-prompt.js handoffPlanFileOf, only once recorded and only when the chain sets no handoffPlanFile of its own.
export function handoffPlanFileName() {
  return 'deliverable.md';
}

// D9 (T5.3, plan A T5 wording): the excerpt block. excerptsBlock({ entries }) is the block that sits after the fenced source in a prompt, from the RECORDED text of each entry that carries one (never by cutting the file again;
// STEP3 A3), used by src/excerpt-record.js excerptBlockFor. The heading and the entry headings are plan A T5 wording; the fixed sentence depends on the source, and an edited repository excerpt has the variant A3 asks for
// ("... cut by the harness from the file named and edited by the person before it was sent"; the rest of the sentence unchanged is my reading of A3's "..."). The text sits in a fence longer than any backtick run in it.
// The values in a heading come from a seat's reply (the path it asked for, its objection id) or from the session; each is folded to one line and put through containerText like every interpolated text that
// reaches a prompt. The excerpt's own text is not escaped: it sits inside a fence longer than any backtick run in it, as fenced source does.
const oneLine = v => containerText(String(v ?? '').replace(/\s+/g, ' ').trim());
const REPOSITORY = 'Project text the handling session added during the run, cut by the harness from the file named; it is not the fenced source and was not part of the task at its start.';
const REPOSITORY_EDITED = 'Project text the handling session added during the run, cut by the harness from the file named and edited by the person before it was sent; it is not the fenced source and was not part of the task at its start.';
const TASK_INPUT = "Project text from the task's own inputs, repeated here as an excerpt; it is not the fenced source.";

export function excerptsBlock({ entries }) {
  const part = e => {
    const who = e.request_kind === 'session_read'
      ? `read by the handling session for its answer to ${oneLine(e.answered_stage)}`
      : `asked by ${oneLine(e.requested_by)} for ${e.objection_id ? oneLine(e.objection_id) : 'no objection'}`;
    const sentence = e.source_kind === 'repository_file' ? (e.edited ? REPOSITORY_EDITED : REPOSITORY) : TASK_INPUT;
    const fence = fenceFor(e.text);
    // D10-w13: a text of only whitespace says so after the closing fence; the fenced body stays exactly the recorded text.
    const empty = e.text.trim() === '' ? '\nThese lines hold no text.' : '';
    return `## ${e.id}: ${oneLine(e.path)}${e.lines ? `, lines ${oneLine(e.lines)}` : ''} (${oneLine(e.source_kind)}; ${who})\n\n${sentence}\n\n${fence}\n${e.text}\n${fence}${empty}`;
  };
  return `# Project excerpts added during this run\n\n${entries.map(part).join('\n\n')}`;
}

// D9 fix-up (C&C, 04 Nov 2026; plan A T5 wording, "Notices shown to the requesting seat", the refused form): the one line the requesting seat reads in its next prompt when the person refused its request at an approval. The reason is
// the person's own words and optional; without one the sentence ends after "the person". Every value in it comes from a seat's reply (the path), the person (the reason) or the record, so each is folded to one line and put through
// containerText like the block's headings. Not yet used: the notices are built with the pause (D8).
export function excerptRefusedNotice({ path, lines, reason }) {
  const where = `${oneLine(path)}${lines ? `, lines ${oneLine(lines)}` : ''}`;
  const why = typeof reason === 'string' && reason.trim() !== '' ? `: ${oneLine(reason)}` : '';
  return `Your request for ${where} was refused by the person${why}${/[.!?]$/.test(why) ? '' : '.'}`;
}

// D10 slice 2b (plan A T5.5, C&C's ruling "edit = a narrower range or redacted lines ... the hidden-line marker is held wording"): the ONE line that takes the place of each run of lines the person hid when they edited an
// excerpt. It lands INSIDE the excerpt text in a seat's prompt, so it is model-read wording: held, on the lane A recording list, never in src/roles.js before the apply. Used by src/excerpt-approval.js editedText.
export function excerptHiddenLinesMarker() {
  return '[lines hidden by the person]';
}

// D15 (T1.1, plan A l.84 and l.85): the claim-marker vocabulary. builderMarkersRule is one more item of the writer seat's builder rules (src/stage-system.js BUILDER_RULE_ITEMS puts it before the limits item, the
// plan's order); STEP3 F7 adds "(for an excerpt, its id: excerpt E-<n>)", which I place inside the angle brackets after "rests on" (the plan's DRAFT has no other place for it).
export function builderMarkersRule() {
  return "End every statement about the project with one marker. [CHECKED: <the fenced block, tool result or excerpt it rests on (for an excerpt, its id: excerpt E-<n>)>] when it rests on text you were shown; add 'inferred from' when you drew it from that text rather than read it there. [UNVERIFIED: <the one reading that would settle it>] when nobody here could check it. [ABSENT: <where you looked>] when you say something is not in what you were shown; never say it is not in the repository. Do not write DISPUTED; the last revision writes it.";
}
// disputedMarkSentence is added to the dispute pass's prompt right after "Never delete a disputed claim silently." (src/stage-system.js withDisputedMark).
export function disputedMarkSentence() {
  return 'Where an open objection disputes a claim and you keep the claim, mark it [DISPUTED: <objection id>].';
}
// D17 (T1.3, slice 1; plan A T3.3 entries 2, 3 and 4, with STEP3 F4): the "Verify first" list. verifyFirstParagraph is entry 2 (a paragraph put right before the handoff seat's dependency paragraph, both forms) with F4's
// sentence "For a claim no step rests on, ..." which I place after the sentence that gives the line form (the plan's text of F4 names no place). verifyFirstStatusRule is entry 3 (milestone form only, right after the Status
// instruction). verifyFirstItemOne is entry 4 (the harness's "Before you build" item 1, its first two sentences; the closing clause is D2's, the one-shot variant D22's). handoffNoTestsLine (entry 5, D33) is the harness line
// appended after the section by src/verify-first.js withNoTestsLine.
export function verifyFirstParagraph() {
  return "Write a section 'Verify first': one line for each claim the plan marks UNVERIFIED that a step rests on, and one for each item to install or download, in the form '<item> - <what to read or check> - <if it fails: the plan's fallback, or stop>'. For a claim no step rests on, write '<claim> - none: no step rests on it'. Take the fallback from the plan; never supply one yourself. If there is nothing to verify, write 'Verify first: nothing - the plan marks no claim UNVERIFIED and names nothing to install.' The dependency lines below are part of this section.";
}
export function verifyFirstStatusRule() {
  return "Write needs_evidence when a line of 'Verify first' has 'stop' as its fallback.";
}
export function verifyFirstItemOne() {
  return "1. Read this whole plan before you change anything. Before you write code, work through the 'Verify first' section of the handoff, and add any blocker you see that it does not name: a step you cannot do with the tools you have, a criterion you cannot check, a fact the plan assumes that nobody verified.";
}

// D22 (T3.3, plan A T3 wording, the HARNESS half of the one-shot switch): used by src/handoff-contract-text.js builderSection through src/builder-kind.js oneShotHarnessWords, only under `builder_kind: "one_shot"` and only
// when ALL of them are recorded. oneShotItemOneClosing replaces "Send the blockers back to the person who owns the plan. Do not work around them silently." in "Before you build" item 1 (plan A l.317).
export function oneShotItemOneClosing() {
  return 'Record each blocker in the decisions file as one line, with the assumption you made and the fallback you took, then continue with what you can build. A blocker with no fallback stops only the item it blocks. Do not work around a blocker silently.';
}
// oneShotReplanLead replaces "Stop building and send the plan back (to its owner, or into a new council run) as soon as any of these is true:" (plan A l.318, with STEP3 A1's fix: "a plan nobody accepted" reads "a plan that did not
// agree and that nobody accepted as it stands").
export function oneShotReplanLead() {
  return 'As soon as any of these is true, stop the item you are on, record why in the decisions file, and go on with the items that do not depend on it (a plan that the panel did not agree on and that nobody accepted as it stands stops every item, since every item rests on it):';
}
// oneShotAssumptionsReport is added after the replan triggers (plan A l.320).
export function oneShotAssumptionsReport() {
  return "When you finish, end your report with a section 'Assumptions': one line per blocker you recorded, '<the blocker> - <the assumption you made> - <the fallback you took>', and one line per item you did not build because a blocker had no fallback. If there were none, write 'Assumptions: none'.";
}
// oneShotGapsTail replaces the parenthetical "(fix them, or send the plan back)" of "Before you build" item 4's heading (the gaps list) under one_shot (STEP3 A8: a one-shot session has nobody to send the plan back to). It has its own
// gate in src/builder-kind.js, apart from the three harness words above.
export function oneShotGapsTail() {
  return '(fix them, or record and skip the item)';
}

// D30 (T1.5, plan A l.96-98; excerpts ship in 0.8.4, his decision 7 of 28 Okt): the "only source" wording when seats are shown excerpts. Each is a replacement for ONE existing sentence (src/fence.js fenceHeader,
// src/stage-system.js withExcerptClause) or the paragraph added to the external-stage text (src/excerpt-record.js externalStageBlock). "Excerpts on" = these words recorded; nothing recorded = today's text byte for byte.
export function fenceHeaderOnlySource() {
  return 'They are the only source you can see, together with the excerpts marked as such that the handling session adds during the run.';
}
export function criticOnlySourceSentence() {
  return 'The fenced source, together with the excerpts marked as such below, is the ONLY thing you know about the repository: a claim about the project that neither shows is UNVERIFIED.';
}
export function reviserOnlySourceSentence() {
  return 'Some of the task is real source code, fenced verbatim, and it is, with the recorded excerpts marked as such, the only source anyone in this chain has seen.';
}
export function externalStageParagraph() {
  return 'You may have the project open. Anything you use from it beyond the fenced source goes into the run as an excerpt (record it) or is marked [UNVERIFIED: ...]; never write that the plan or the panel saw the repository.';
}


// D38 (T1.4, F2): the description of the optional `session_reads` field of the MCP tool submit_stage, read by the handling session; the field is absent from the tool until this name is recorded in src/roles.js (src/excerpt-channel.js).
export function sessionReadsField() {
  return 'Optional. Project files you read yourself to write this answer, as a list of { path, lines, why }: the path in the project, the lines you read as "3-5" (leave out for the whole file), and one sentence on what you used it for. The harness cuts those lines itself, scans them for keys, and shows the text to every later seat. A claim about code you read that is not listed here stays unverified.';
}

// D41 (T5.3, plan A l.587): the label a quote found in a recorded excerpt carries in the reviser's and the dispute stage's failure list, in the place of the quote-check status `in_excerpt` (which is never printed raw). Used by
// src/chain.js attachedShown; the status is assigned only once this name and the block's words are recorded.
export function inExcerptLabel({ excerpt_id }) {
  return `a passage of a recorded excerpt, ${String(excerpt_id).replace(/[^E0-9-]/g, '')}`;
}

// A7 + plan A step 4 (C&C 09 Nov 2026: built HELD in 0.8.4; the gate is RUN-STABLE, src/excerpt-channel.js excerptsMayBeShown): the quote words when excerpts may be shown. Each FENCED-run name is the replacement for ONE existing
// phrase or sentence (src/stage-system.js withExcerptQuoteWords; exactly once, loud otherwise); each UNFENCED-run name is text added to the system prompt. Nothing recorded = today's text byte for byte. All recorded together.
export function criticQuoteFieldPhrase() { return 'the exact text it rests on, copied from the fenced source or from an excerpt marked as such'; }
export function criticQuoteCopiedPhrase() { return 'copied from the fenced source or from an excerpt marked as such.'; }
export function criticQuoteNeverSentence() { return 'Never write a "quote" that is not in the fenced source or in an excerpt marked as such.'; }
export function reviserQuoteFromSentence() { return 'An objection may carry a "quote" from it or from an excerpt marked as such.'; }
export function reviserQuoteFindPhrase() { return 'with a quote you cannot find in the fenced source or in an excerpt marked as such,'; }
export function criteriaQuotePhrase() { return 'unless the fenced source, or an excerpt marked as such, shows it.'; }
export function criticExcerptOnlyRule() {
  return '\n- The handling session may add excerpts of the project during the run, marked as such below. If none is shown, you know nothing about the repository: state a claim about it as a question or mark it UNVERIFIED, and do not invent a source. If one is shown, it is a partial slice: a file that is not shown may still exist, and its absence is not evidence. When an objection claims something about the repository, its quote is the exact text of an excerpt marked as such that it rests on; never write a quote that is not in the draft or in an excerpt marked as such.';
}
export function reviserExcerptOnlyRule() {
  return '\n- The handling session may add excerpts of the project during the run, marked as such below; if none is shown, no one in this chain has seen the repository. An objection about the repository may carry a "quote" from an excerpt. One with no quote, or with a quote you cannot find in an excerpt, has not been checked by anyone: weaken it to UNVERIFIED and name what would settle it. Do not silently delete the objection, and do not silently adopt it.';
}

// D18 (T5.1, plan A l.1145; C&C 09 Nov 2026): how a seat asks for project text inside a reply it already writes, what the handling session sees, and how it answers. All held, A-DRAFT. The two field sentences are added to a judge's /
// a proposer's system text only in a run where excerpts may be shown (run-stable, src/excerpt-channel.js excerptsMayBeShownFor); the list sits in NEEDS-<stage>.md between the instructions and "## System prompt".
export function textRequestsJudgeField() {
  return '\n- If you cannot judge an objection without text of the project that is not shown here, you may add a key text_requests to your JSON reply: a list of { "path": "<the file\'s path in the project>", "lines": "<a-b, or leave this out for the whole file>", "why": "<one sentence: what you need it for>", "objection_id": "<the id of your own objection it serves, or leave this out>" }. The handling session may paste the text or decline; you are told which in your next prompt. Leave the key out when you need nothing.';
}
export function textRequestsProposerField() {
  return '\n- If you cannot argue a point without text of the project that is not shown here, you may add a key text_requests to your JSON reply: a list of { "path": "<the file\'s path in the project>", "lines": "<a-b, or leave this out for the whole file>", "why": "<one sentence: what you need it for>" }. The handling session may paste the text or decline; if you are asked again, you are told which in your next prompt. Leave the key out when you need nothing.';
}
/** `requests` = [{ n, requested_by, objection_id, path, lines, why }]; the values are already folded to one line and marked by the caller. */
export function textRequestsList({ requests }) {
  const line = r => `${r.n}. ${r.requested_by} asks for ${r.path}${r.lines ? `, lines ${r.lines}` : ''}${r.objection_id ? ` (for objection ${r.objection_id})` : ''}: ${r.why}`;
  return `# Text requests from the panel\n\nThe seats below asked for text of the project. Answer in the excerpt_answers of your answer to this stage, by request number: name the path (and lines) to paste, or decline with a reason. A request you leave out is recorded as unanswered.\n\n${requests.map(line).join('\n')}`;
}
export function excerptAnswersField() {
  return 'Optional. Your answers to the text requests listed in this stage\'s prompt, as a list of { request, path, lines } to paste (request is the number in the list; path and lines default to what was asked) or { request, decline } to decline with one sentence. The harness cuts the lines itself and shows the text to every later seat.';
}
export function excerptUnansweredNotice({ path, lines }) {
  return `Your request for ${oneLine(path)}${lines ? `, lines ${oneLine(lines)}` : ''} was not answered by the handling session.`;
}

// D18 notices (C&C 09 Nov 2026; WORDING D18-w10, w11): beside excerptRefusedNotice (a refusal at the approval screen, "by the person") and excerptUnansweredNotice: the line for a decline made by the HANDLING SESSION, and for a request whose
// text the person dropped. Each value in them is folded to one line and put through containerText, like the block's headings.
export function excerptDeclinedNotice({ path, lines, reason }) {
  const where = `${oneLine(path)}${lines ? `, lines ${oneLine(lines)}` : ''}`;
  const why = typeof reason === 'string' && reason.trim() !== '' ? `: ${oneLine(reason)}` : '';
  return `Your request for ${where} was declined by the handling session${why}${/[.!?]$/.test(why) ? '' : '.'}`;
}
// D10-w8 (C&C 09 Nov 2026): the notice for a request whose text the HARNESS could not cut (status not_cut): the record's own reason follows, folded to one line like every value in these notices.
export function excerptNotCutNotice({ path, lines, reason }) {
  const where = `${oneLine(path)}${lines ? `, lines ${oneLine(lines)}` : ''}`;
  const why = typeof reason === 'string' && reason.trim() !== '' ? ` ${oneLine(reason)}` : '';
  return `Your request for ${where} got no text.${why}`;
}
export function excerptWithheldNotice({ path, lines }) {
  return `The requested text from ${oneLine(path)}${lines ? `, lines ${oneLine(lines)}` : ''} was withheld. No seat sees it.`;
}

// D14 / T7 wording (plan A l.919 "Failed row evidence"; C&C 09 Nov 2026, unit 2; WORDING U2-w6; A-DRAFT, held): the failed-row evidence of a judge's table says how to anchor something ABSENT: QUOTE the heading of the section where it should be (the plan says "copy"; only a quoted heading is a span, src/post-quotes.js markSpans), which makes the absence
// a span the located marks can find in the draft. src/stage-system.js withAbsenceAnchor replaces the phrase `FAILED: the quoted passage, or what is absent,` of the critic's reply format (src/prompts/core.js) exactly once with the returned text, once src/roles.js exports this name.
// D29 / T2.5 (plan A l.~1266 and T3.3 entry 7; C&C 09 Nov 2026, unit 3; WORDING U3-w31; A-DRAFT, held): the handoff seat is told how the run it writes for ended, at the top of its user prompt, ONLY after a run that did not agree. src/handoff-prompt.js
// puts the returned text, a blank line and then the seat's user prompt; nothing is added while src/roles.js does not record the name, and an agreed run is told nothing. `word` is the ending word (src/ending-matrix.js) and `reason` the matrix's reason sentence.
export function handoffEndingLines({ word, reason }) {
  return `The run behind this plan ended "${word}" (${reason}). The run did not end agreed, so do not write Status ready_for_build or partial: write needs_decision, needs_evidence or blocked, and say in the next section what a person has to settle before anyone builds it.`;
}

// 0.8.4 round 1, 9a (his answer 9:a, 12 Nov 2026; wording by Helper B, ROUND1 item 9a; A-DRAFT): a run that ended agreed on the handler's build check while objections were still open tells the handoff seat which ones, at the END of its user prompt:
// one lead sentence, a blank line, one row per open objection in the build check's own form (src/prompts/recorded-084-b.js) without its sorting part. `rows` = [{ id, layer, severity, problem }], the problem text already escaped by the caller (R.claimText).
// Built only at that ending (src/chain.js); every other prompt is as before. There is no system sentence: the dry run prices the per-stage system table from src/stage-system.js.
export function handoffOpenObjectionsBlock({ rows }) {
  const line = r => `- ${r.id} (raised in layer ${r.layer}; ${typeof r.severity === 'number' ? `rated ${r.severity.toFixed(1)}` : 'not rated'}): <critic-claim>${r.problem}</critic-claim>`;   // A-DRAFT (ROUND1 9a)
  return `The objections below were still open when the handler session answered that the plan is good to build and the run ended agreed, and the layers that raised them have not withdrawn them: list each one in the handoff, by its id, as a task for the builder.\n\n${rows.map(line).join('\n')}`;   // A-DRAFT (ROUND1 9a)
}

export function failedRowAbsencePhrase() {
  return 'FAILED: the quoted passage, or what is absent (for something absent, also quote the heading of the section where it should be),';
}

