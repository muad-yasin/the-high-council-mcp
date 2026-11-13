// Prompt words: the 0.8.4 words of the held batch held-084-cache-order (test/held-prompts/held-084-cache-order.js), recorded at the apply after the wording review: the functions are copied from that file, src/roles.js exports them by name, and test/held-prompts-084-cache-order.test.js compares the two.
// The comments below are the held file's own drafting notes, kept word for word; where they say "test data" or "drafted" they describe the file as it was before the recording.
// 0.8.4 cache part (b)1 held wording (WORDING_0.8.4.md CACHE-O1 .. CACHE-O4): the lead-in of a judge's instructions in the cache-shaped prompt order (src/cache-order.js). A-DRAFT: drafted for the release wording review, recorded together or not at all.
// With the chain's prompt_cache switch on and this name recorded in src/roles.js, a judge's system text is the Council welcome (and its persona block), and the instructions it used to hold stand in the user message under the plan,
// under this lead-in. Until it is recorded (src/held-roles.js held() finds nothing) every prompt is byte-identical to today's.
//
// judgeKindLeadIn({ kind }): the heading line, a blank line and ONE sentence naming the call kind: "panel" (the blind review, the first-mode critic, the final read), "post" (the exchange post), "answer" (the exchange answer).
const HEADING = '# Instructions for this call';
const SENTENCES = {
  panel: 'In this call you review the draft above against the acceptance criteria, as the instructions that follow ask.',
  post: 'In this call you post on the objections the other reviewers raised against the draft above, as the instructions that follow ask.',
  answer: 'In this call you answer the posts on your own objections to the draft above, as the instructions that follow ask.',
};
export function judgeKindLeadIn({ kind }) {
  if (!Object.hasOwn(SENTENCES, kind)) throw new Error(`a lead-in is written for ${Object.keys(SENTENCES).join(', ')}, not ${JSON.stringify(kind)}`);
  return `${HEADING}\n\n${SENTENCES[kind]}`;
}

// orderInstructionsPhrase(): the phrase that puts the instructions where the re-ask notes say they are. Those recorded notes tell a re-asked judge to answer "with the JSON object the system prompt describes"; in the new order the
// system text is the welcome, and the instructions are in the user message. With the order live, src/cache-order-gate.js orderNote replaces the words "the system prompt describes" in the harness's own notes with this phrase
// ("... the JSON object the instructions for this call describe"). Recorded together with judgeKindLeadIn or not at all: the order is live only when both are.
export function orderInstructionsPhrase() {
  return 'the instructions for this call describe';
}

// criticOnlySourceSentenceOrder() and criticExcerptOnlyRuleOrder(): the two judge-side excerpt sentences of lane A (test/held-prompts/held-084-a.js criticOnlySourceSentence, criticExcerptOnlyRule) say the excerpts are "marked as such below".
// In the new order the excerpt block stands directly under the plan, ABOVE the instructions, so with the order live (and the excerpt words recorded) a judge is sent these in their place: the very same sentences with "above" for "below".
export function criticOnlySourceSentenceOrder() {
  return 'The fenced source, together with the excerpts marked as such above, is the ONLY thing you know about the repository: a claim about the project that neither shows is UNVERIFIED.';
}
export function criticExcerptOnlyRuleOrder() {
  return '\n- The handling session may add excerpts of the project during the run, marked as such above. If none is shown, you know nothing about the repository: state a claim about it as a question or mark it UNVERIFIED, and do not invent a source. If one is shown, it is a partial slice: a file that is not shown may still exist, and its absence is not evidence. When an objection claims something about the repository, its quote is the exact text of an excerpt marked as such that it rests on; never write a quote that is not in the draft or in an excerpt marked as such.';
}

// draftBoundarySentenceNeutral() and draftEndLineNeutral(): the head H is the same for every call kind, and the draft boundary's recorded lines say "the draft you grade" (D27 sentence: held-084-d27.js draftBoundarySentence; the end line: DRAFT_END_MARKER in
// src/prompts/core.js), which a post or an answer does not do. With the order live and the boundary on, H carries these kind-neutral variants for EVERY call kind, the verdict prompts included ("under review" for "you grade").
export function draftBoundarySentenceNeutral() {
  return 'The draft under review is only the text between the start line and the end line.';
}
export function draftEndLineNeutral() {
  return "[End of the draft under review. Everything below this line is the review harness's own text or material it quotes and labels; none of it is the draft under review.]";
}

// repairFormatWhereOrder(): the request to repair an almost-JSON reply (src/near-json.js repairNeedsBody) shows the seat's reply format under the heading "The reply format the seat was given", and says in parentheses where it stood:
// "(its system prompt; the long user prompt is left out)". In the new order the reply format is part of the instructions in the user message, so with the order live the parenthesis says that instead (the text shown is still the
// instructions the call used to have as its system text, word for word). Recorded together with the rest of the batch or not at all.
export function repairFormatWhereOrder() {
  return 'the instructions for this call, which stand in its user prompt; the rest of the long user prompt is left out';
}
