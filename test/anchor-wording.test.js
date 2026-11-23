// 0.8.4 S14: the plan's three sentences (W23, W24 and the clause inside W1's draft) are pinned here WORD FOR WORD as literals. That they ARE the plan's words was compared by script against the maintainer's plan text (FEATURE_SPECS, S14 "Wording drafts"), byte-equal, and is recorded in the S14 report; the plan itself is a private, gitignored folder and no test of this repo reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { criticQuoteFieldSentence, layerReplyQuoteSentence, layerDebateOwnQuoteSentence } from './held-prompts/held-084-s14.js';

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: W23 and W1 as the plan drafted them ('(for a missing part, the nearest passage where it belongs, and say what is absent there)'). NEW: the two sentences the recording holds ('For a missing part, quote the nearest passage where it belongs and say, outside the quote, what is absent there.'; W1 ends 'If you cannot give a passage, leave own_quote out for that failure: it stays flagged.'). WHY: criticQuoteFieldSentence and layerDebateOwnQuoteSentence (src/prompts/recorded-084-s14.js), the resolved text of the rows (RESOLVED_LIST).
const W23 = 'For each failure, give a field quote: the passage of the draft that you attack, copied word for word. For a missing part, quote the nearest passage where it belongs and say, outside the quote, what is absent there. A failure with no quote is kept, flagged unanchored.';
const W24 = 'For each of your objections that has no quote, add a field quote to your reply: the passage of the draft that it attacks, copied word for word. You see the draft and the other reviewers\' posts here. Keep, amend or withdraw as before; the field quote goes with whichever you choose, and an amend does not replace it; the objection keeps the rating it was given.';
const W1 = 'In round 1, if a block lists your own failures that quote nothing, add for each a field own_quote: the passage of the draft it attacks, copied word for word. For a missing part, quote the nearest passage where it belongs and say, outside the quote, what is absent there. If you cannot give a passage, leave own_quote out for that failure: it stays flagged.';

test('the three drafted sentences are the plan\'s words, written out here as the pin (a clean checkout has no plan)', () => {
  assert.equal(criticQuoteFieldSentence(), W23);
  assert.equal(layerReplyQuoteSentence(), W24);
  assert.equal(layerDebateOwnQuoteSentence(), W1);
});
