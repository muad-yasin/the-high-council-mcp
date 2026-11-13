// Prompt words: the 0.8.4 words of the held batch held-084-s14 (test/held-prompts/held-084-s14.js), recorded at the apply after the wording review: the functions are copied from that file, src/roles.js exports them by name, and test/held-prompts-084-s14.test.js compares the two.
// The comments below are the held file's own drafting notes, kept word for word; where they say "test data" or "drafted" they describe the file as it was before the recording.
// 0.8.4 S14 (the quote field; R22, N12, D21, Q12): the HELD DRAFTS of the step's wording, A-DRAFT until the one release wording review (C&C's ruling R523: S14's wording is its own held file, so it is one thing Muad can approve or hold on its own).
// Three of the four texts are the PLAN'S words exactly (FEATURE_SPECS S14, "Wording drafts": W23 and W24; W1's draft, its clause on the judge's own failures); the fourth, ownFailuresBlock, is the only new text: the structural block of the
// round-1 post that lists the judge's own failures that quote nothing, so W1's clause has something to refer to.
// They are injected with setHeldForTest and are inert (byte-identical prompts) until src/roles.js exports a function of the same name; the seams are in src/stage-system.js (criticPromptFor, layerReplySystemFor, layerDebateSystemFor) and
// src/chain.js (the post's user text). Recorded all together or not at all (test/held-prompts-084-s14.test.js).

/** W23 (Q9, Q12, S14): a sentence added to every judge's reply template. */
export function criticQuoteFieldSentence() {
  return 'For each failure, give a field quote: the passage of the draft that you attack, copied word for word. For a missing part, quote the nearest passage where it belongs and say, outside the quote, what is absent there. A failure with no quote is kept, flagged unanchored.';
}

/** W24 (Q9, Q12, S14): a sentence added to the raiser's reply. */
export function layerReplyQuoteSentence() {
  return 'For each of your objections that has no quote, add a field quote to your reply: the passage of the draft that it attacks, copied word for word. You see the draft and the other reviewers\' posts here. Keep, amend or withdraw as before; the field quote goes with whichever you choose, and an amend does not replace it; the objection keeps the rating it was given.';
}

/** W1's clause (Q12(f), D37 option iv): added to the round-1 post prompt. */
export function layerDebateOwnQuoteSentence() {
  return 'In round 1, if a block lists your own failures that quote nothing, add for each a field own_quote: the passage of the draft it attacks, copied word for word. For a missing part, quote the nearest passage where it belongs and say, outside the quote, what is absent there. If you cannot give a passage, leave own_quote out for that failure: it stays flagged.';
}

/** The block the clause refers to (the only new text): the judge's own failures that quote nothing, by id and criterion, in the round-1 post's user text. `items` = [{ id, criterion }]. */
export function ownFailuresBlock({ items } = {}) {
  const rows = Array.isArray(items) ? items : [];
  return `Your own failures that quote nothing:\n${rows.map(i => `- ${i.id}: ${i.criterion}`).join('\n')}`;
}

/** The label a quote that was ATTACHED in the exchange (not the judge's own) carries in the reviser's and the dispute stage's failure list, in the place of the quote-check status (C&C R528 hold; S12 chooses the words; A-DRAFT, a placeholder). Until it is recorded the prompts show the failure as before S14, without the passage. */
export function attachedQuoteLabel() {
  return 'a passage of the draft, given later in the exchange';
}
