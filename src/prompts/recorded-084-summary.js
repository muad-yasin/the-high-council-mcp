// Prompt words: the 0.8.4 words of the held batch held-084-summary (test/held-prompts/held-084-summary.js), recorded at the apply after the wording review: the functions are copied from that file, src/roles.js exports them by name, and test/held-prompts-084-summary.test.js compares the two.
// The comments below are the held file's own drafting notes, kept word for word; where they say "test data" or "drafted" they describe the file as it was before the recording.
// 0.8.4 item 6 (WRR-s2; his 05 Nov 2026 "1: a" and 10 Nov 18:06 "1:a": the handling session writes the plan's summary and index after the debate, no paid call; and his "a": every run that delivers a plan and has a handling session gets it, not-agreed ends included).
// A-DRAFT: drafted for the one release wording review, recorded all together or not at all (test/held-prompts-084-summary.test.js). `council summary-add <run folder>` with no --summary-file prints it after the usage line; until it is recorded in src/roles.js
// the command refuses ("this build does not offer a summary block yet") and no run gets a block.
// Traces: summary, index and key data points = his "1: a" to C&C's option text of 05 Nov ("key data points" is C&C's phrase); "using only what the plan says" and "(2) what the plan leaves open" are the builder's, from his rule against roles that invite speculative claims into the record (28 Okt) and so that an open choice
// is not reported as settled; "one line each", "with the heading each sits under", the list of data kinds and the order of the four parts are the builder's formatting choices. The harness writes the heading, the ending line and the note; the session writes only this.
export function handlerSummaryInstruction() {
  return 'Write the summary block for this finished plan, using only what the plan says. Give (1) a summary: the decisions the plan settles, one line each, with the heading each sits under; (2) what the plan leaves open or hands to the builder; (3) the key data points the plan states (counts, limits, sizes, prices, versions), copied as the plan writes them; (4) an index: each heading of the plan, in order, with one line on what it holds. Add no claim, number or decision that the plan does not contain, and change nothing in the plan. Save your text in a file and add it with: council summary-add <run folder> --summary-file <file>.';
}

// handlerSummaryEndLine({ run }): the line of a finished run's closing summary (src/cli.js, after `output:`; run.log, so run_status's lastLogLines carries it) that tells the handling session the summary block can be added. WRR-s6 (A-DRAFT). Shown only when the run delivered a plan and has a handling session; not-agreed ends included (his "a").
export function handlerSummaryEndLine({ run }) {
  return `the handling session can add a summary and index of this plan at the top of deliverable.md: run council summary-add ${run} to see what to write.`;
}
