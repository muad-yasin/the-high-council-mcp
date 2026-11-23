// Prompt words: the dispute stage and the patch reviser. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

import { containerText } from '../container-text.js';
import { renderClaim } from './core.js';
import { reviserSystem } from './scope.js';

// ---------------------------------------------------------------------------
// Dispute stage (2026-09-20). One reviser pass after a unanimous chain stops
// WITHOUT agreement - stalled or round-capped. Its job is the opposite of the
// reviser's usual one: not to fix the objections and not to defend against
// them, but to mark honestly what could not be settled.
//
// The cheap-7 run is why this exists. A claim about a directory that does not
// exist survived into the deliverable because the objection to it first landed
// in the last round, and the cap hit before anything could be done with it. A
// model with no way to check a disputed fact should say so; what it did
// instead was keep the confident version, because nothing ever asked it not to.
export const DISPUTE_SYSTEM = `You are revising a plan one last time, after a review panel
failed to reach agreement. The panel is finished. It will not review your output, and nothing
you write can turn this into an approved plan.

This is not a chance to defend the draft or to win the argument. Every objection below was
raised by a reviewer and never resolved. Your only job is to make the draft honest about them.

For each open objection:
- If the objection is right, fix the draft.
- If the draft makes a claim the objection disputes and you cannot verify that claim from the
  material you were given, do not keep the confident version. Rewrite it as UNVERIFIED, stating
  plainly what would settle it. A named file, directory, function or number you have not been
  shown the contents of is NOT verified, no matter how reasonable it seems.
- If you believe the objection is wrong, do not silently ignore it. Keep the disputed claim as
  it is and add one sentence beside it saying why.

Never delete a disputed claim silently. A reader must be able to tell the difference between
"this was checked", "this could not be checked" and "a reviewer disagreed with this".

Reply with the full revised plan in markdown and nothing else. Do not add a summary of what
you changed; the disagreement is recorded separately, verbatim, and is not yours to write.`;

export function disputeUser({ request, criteria, draft, failures, severity = false }) {
  // Same wrapping as criticUser/reviserUser: this is reviewer-controlled text and must not be
  // able to pass for an instruction from this prompt.
  const open = (failures || [])
    .map((f, i) => `${i + 1}. ${renderClaim(f, { raisedBy: true, severity })}`)
    .join('\n\n') || '(none listed)';
  return `# Original request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Current draft\n\n${draft}\n\n# Objections that were never resolved\n\n${open}`;
}

// Dispute review (2026-09-23, opt-in `dispute: { review: true }`). Muad: "Reviewers should
// check disputes thoroughly, no?" After the dispute stage the reviser has had the last word
// on every open objection, and nothing checked what it did with them. This asks the seat
// that raised each objection, once, whether the final draft handles it honestly. It is a
// check on the record, not another vote: nothing here can re-open the review or pass the plan.
export const DISPUTE_REVIEW_SYSTEM = `You raised one or more objections during a review that ended
without agreement. The reviser then had one last pass at the plan, whose only job was to make it honest
about the objections nobody settled: fix what was right, mark as UNVERIFIED what could not be
checked, or leave the text and say in one sentence, where it applies, why the objection is wrong.

You are not voting again and you are not re-arguing your objection. The review is over either
way. For each of YOUR objections, numbered below, answer one question: does the final draft
deal with it honestly?

- "accepted": the draft handles it in one of the three honest ways above, and any reason it
  gives describes your objection fairly, even if you still disagree with the reason.
- "misrepresented": the draft addresses it, but restates your objection as something you did
  not say, or answers a weaker version of it.
- "silently_dropped": the disputed claim was removed or changed with no mark, or your
  objection is simply not dealt with anywhere.

Quote the exact text from the FINAL draft that your verdict rests on, copied character for
character. For "silently_dropped" there may be nothing to quote: use an empty string then. A
quote that is not in the final draft makes your answer count as unconfirmed.

Reply with JSON only, one entry per objection, in the same order:
{"reviews": [{"objection": 1, "verdict": "accepted" | "misrepresented" | "silently_dropped", "quote": "<exact text or empty>", "note": "<one sentence>"}]}`;

export function disputeReviewUser({ request, objections, draftBefore, draftAfter }) {
  // Everything below that came from a seat is wrapped, as in disputeUser: the objections are
  // this seat's own words, the drafts are the reviser's, and neither may pass for an instruction.
  const listed = (objections || [])
    .map((o, i) => `${i + 1}. ${renderClaim(o)}`)
    .join('\n\n');
  return `# Original request\n\n${request}\n\n# Your objections (verbatim from your review)\n\n${listed}\n\n# The draft before the reviser's last pass\n\n<draft-before>\n${containerText(draftBefore)}\n</draft-before>\n\n# The FINAL draft, after that pass\n\n<draft-after>\n${containerText(draftAfter)}\n</draft-after>`;
}

// Patch-mode reviser (2026-09-20, src/patch-revise.js). Opt-in via `revise: { mode: "patch" }`.
// The default full-rewrite prompt is unchanged and still what every existing chain gets.
export const PATCH_REVISER_RULE = `

## Reply format for this run: edits, not a rewrite

Do not reproduce the plan. Reply with ONLY the edits you are making, each as a block:

<<<<<<< SEARCH
<text to find, copied from the draft exactly as it appears>
=======
<text to replace it with>
>>>>>>> REPLACE

Rules, all of them load-bearing:
- The SEARCH text must be copied from the draft character for character, including punctuation
  and line breaks. It is matched literally, not approximately.
- The SEARCH text must appear exactly once in the draft. If the line you want is not unique,
  widen the block with the lines around it until it is - do not hope the right one is picked.
- Make one block per change. Several small blocks are better than one large one.
- Change only what an objection requires. Text nobody objected to must stay exactly as it is:
  unrequested rewording of untouched sections is the specific problem this format exists to
  prevent, and it is visible here in a way it is not in a rewrite.
- If a change is so extensive that editing is not sensible, say so in one line instead of
  emitting blocks, and the full-rewrite path will be used.

Any DECLINED: lines go after the last block, exactly as they would otherwise.`;

export const patchReviserSystem = (open, fenced = false, opts = {}) => reviserSystem(open, fenced, opts) + PATCH_REVISER_RULE;
