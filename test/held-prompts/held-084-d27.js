// 0.8.4 D27 held wording (WORDING_0.8.4.md D27-w1, D27-w2): the start of the draft in a judge's user prompt and in the final read's. A-DRAFT: drafted for the release wording review, recorded together or not at all.
// The end line is DRAFT_END_MARKER (recorded, src/prompts/core.js). Layout, built by src/draft-bounds.js: "# Draft under review", the sentence, the start line, the draft, the end line.

// draftStartLine(): the line directly before the draft.
export function draftStartLine() {
  return '[Start of the draft under review.]';
}

// draftBoundarySentence(): one sentence, directly under the header "# Draft under review" and before the start line.
export function draftBoundarySentence() {
  return 'The draft you grade is only the text between the start line and the end line.';
}
