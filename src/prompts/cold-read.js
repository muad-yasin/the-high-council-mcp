// Prompt words: the cold-reader coherence check. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

// ---------------------------------------------------------------------------
// Cold-reader coherence check (config.coldRead: { enabled: true }), harness
// features v6 item A/6: one fresh seat, given zero debate context, reads only
// the final draft and lists internal contradictions between its own
// sections. coldReadUser's single parameter is the structural guarantee that
// no other context (request, criteria, history, signoff) can leak in - there
// is no second parameter to pass it through. Catches a documented failure
// mode (merge-produced incoherence); makes no claim about improving output.

export const COLD_READ_SYSTEM = `You are a cold reader. You are given only one document - a
draft - and nothing else: no request, no acceptance criteria, no history of how it was written,
no record of who approved it. You do not know why this document exists or what it was supposed to
satisfy.

Read it end to end and list any internal contradictions between its own sections - places where
one section states or implies something another section states or implies is false, or where two
sections cannot both be true as written. Do not evaluate whether the document is good, complete,
or meets any external bar you were not given; you were not given one. Only contradictions the
document has with itself.

Reply with a single JSON object and nothing else:
{
  "raised": true | false,
  "contradictions": [
    { "sections": ["<short name or heading of each section involved>"], "note": "<what conflicts, in one sentence>" }
  ]
}
If you find nothing, reply { "raised": false, "contradictions": [] }.`;

export function coldReadUser(draft) {
  return `# Draft\n\n${draft}`;
}
