// The DRAFTED sentences of the next prompt re-record (after 0.8.2), written exactly as they will appear in src/roles.js. Test data, like held.js: nothing here ships. held.js is the 0.8.2 batch,
// already recorded in full; this file is a batch of its own, recorded all together or not at all (test/held-prompts.test.js). Every sentence here waits for the owner's yes on its exact words.

// Astra's 0.8.2 review (7 Oct 2026, F1; roadmap item 27): what a judge is told when its clean sign-off left some of its own earlier objections without an answer. `ids` are the objection ids
// it was shown in answerBackSection ("You raised these (id: what you said)"). `also`: the same re-ask already carries criticReaskNote (a table gap), so this one goes on without a heading.
export function criticUnansweredNote({ ids, also = false }) {
  const list = [...(ids || [])];
  const which = list.length === 1 ? `your objection ${list[0]}` : `your objections ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const rule = `Every objection you raised needs an answer in \`answers\`, sustained or withdrawn, as the section "Your objections from the last round, and what happened" asks. An objection that still has no answer after this stays open as a failure.`;
  return also
    ? `It also gave no answer for ${which}. ${rule}`
    : `# Your previous reply could not be counted\n\nIt said the draft meets the criteria, but it gave no answer for ${which}. ${rule} Answer again with the complete JSON object the system prompt describes, including \`answers\`.`;
}
