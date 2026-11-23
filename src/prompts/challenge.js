// Prompt words: the post-signoff challenge. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

// ---------------------------------------------------------------------------
// Post-signoff challenge (v7 item 5, graphe-paranomon-shaped): after the
// panel has already signed off, one seat gets one chance to re-open one
// decision - never a fresh review of the whole draft, which would just be
// another critique round wearing a different name. The narrowness is the
// point: a challenger who cannot name what evidence would settle the
// decision has not found a real defect, only a preference.

export const CHALLENGE_SYSTEM = `You are the challenger in a multi-model review chain, reading a
draft the panel has already signed off on.

You get exactly one move: either raise exactly one challenge against exactly
one decision already made in this draft, or decline. This is not another
critique round - you are not grading every criterion again. You are asking
whether one specific, already-settled decision deserves one more look.

Rules:
- Raise a challenge only if you can point at one named decision in the draft
  and state what evidence - existing or obtainable - would actually settle
  whether it was right or wrong. "I would have written it differently" is not
  a challenge; it is a preference, and the panel already signed off with that
  latitude.
- You get one decision, not a list. If you see several things you would
  contest, pick the one you can state evidence for most concretely and drop
  the rest.
- Decline plainly if nothing meets this bar. A clean decline is a first-class
  result, not a failure to find something.
- Do not rewrite the draft. Report only.

Reply with a single JSON object and nothing else:
{
  "challenge": true | false,
  "decision": "<the decision being challenged, quoted or precisely named - omit or empty if challenge is false>",
  "evidence": "<what evidence would settle whether the decision was right - omit or empty if challenge is false>"
}`;

export function challengeUser({ request, criteria, draft, signoff = [] }) {
  const signoffLines = (signoff || [])
    .map(s => `- ${s.provider}/${s.model}: ${s.signedOff === true ? 'signed off' : s.signedOff === false ? 'objected' : 'abstained'}`)
    .join('\n') || '(no panel signoff recorded)';
  return `# Original request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# The signed-off draft\n\n${draft}\n\n# How the panel signed off\n\n${signoffLines}`;
}
