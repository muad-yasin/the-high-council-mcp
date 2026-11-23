// 0.8.4 S16 held wording (WORDING_0.8.4.md S16-w11b): the plan's own W42, the part sentence of a final read whose open objections do not fit one prompt. DRAFT as the plan prints it; recorded at the release review with the batch.
// finalReadPartRule({ n, k }): appended to the user prompt of EVERY part of such a read (src/chain.js runFinalRead), after the list of that part.
export function finalReadPartRule({ n, k } = {}) {
  return `The open objections of this plan are read in ${n} parts, from the highest rating down (unrated ones first), and this is part ${k}. Sort each objection shown in this part into must-do or may-leave, with your reason; the other parts are read in their own calls. In part 1 you also give your verdict and any late finding as in an ordinary final read; in every later part you sign nothing, raise nothing and record no late finding.`;
}

// finalReadRule({ read }): W31, the final read's own words (Q9), the plan's DRAFT word for word. Two things are the builder's, FLAGGED for the wording review: the plan's bracketed clauses "[If you have not read exactly this text before:] ..." / "[If you have:] ..." are put as sentences ("You have not read ...", "You read ..."), and the plan's note "(The tool prints the clause that is true for the seat.)" is left out (it is for the builder, not the seat).
// `read`: true when the seat read exactly this text before (a coverage seat), false when it did not. Added to the user prompt of a layer-3 seat's final read, in place of W7's closing-read clauses.
export function finalReadRule({ read = false } = {}) {
  return "This is the final text of the run. " + (read ? "You read exactly this text before, and the objections and late findings marked new below were opened after your last sorting; read the plan again, and sort every open objection and late finding. " : "You have not read exactly this text before. ") + "Below are the open objections and the late findings, each with its rating and, if you sorted it before, your sorting. Read the plan itself first and judge it on your own, then state your position: sign off, or object. If you object, give each objection a criterion, a passage of this text quoted word for word (for a missing part, quote the nearest passage where it belongs and say, outside the quote, what is absent there) and a rating from 1 to 10. An objection rated 4 or above holds your sign-off; one rated below 4 is recorded and does not. No exchange follows this read, so an objection must carry its quote.\n\nThen sort each listed open objection and each listed late finding as must-do or may-leave for the build and give your reason for each (for a late finding sorted must-do, say that its defect holds and why); a sorting does not change a rating. An objection you raise in this reply already counts as your must-do and needs no sorting entry. For a listed item you sort must-do, cite its id and a criterion or a decision of the plan; without them it is still a must-do and is flagged ungrounded.\n\nIf you find a defect for which you cannot quote a passage, write it as a late finding with its criterion, what is absent and where, and a rating from 1 to 10; it is recorded for the build and is not debated. Sort it in the same reply as must-do, with the reason that its defect holds, because no other seat has seen it.\n\nIf you have a point about the text for the build to watch, one that does not claim that a criterion fails and does not predict a failure, write it in the field concern, without a rating; it is recorded for the build under your name, it is not debated and it holds nothing back.";
}

// finalReadSortingForm(): WORDING S16-w16b (the BUILDER's words, FLAGGED: the plan names no reply form). The final read's reply form, in place of S8's layerThreeSortingForm: a defect the seat can quote goes in `failures` (W31), so only the entry with no passage is offered; the seat's own new objections are not listed; the `concern` field.
export function finalReadSortingForm() {
  return 'Put your sorting in the "sorting" array.\n- For each listed open objection or late finding, copy its id into "id", set "sort" to "must_do" or "may_leave", and give your "reason". For a must-do, also give the plan criterion in "criterion" or the plan decision in "decision".\n- An objection you raise in this reply already counts as your must-do. You need not add a sorting entry for it.\n- For a new defect with no passage you can quote, add an entry without an id. Set "sort" to "must_do", say in "reason" what is absent and where, name in "criterion" the criterion it breaks, and give a "rating" from 1 to 10.\n- Put a point for the build to watch that does not claim a criterion fails in the separate "concern" field of your reply. Give it as text without a rating.';
}

// finalReadSortingItems({ items }): WORDING S16-w17 (the BUILDER's words, FLAGGED). The list ONE seat sorts at the final read, in place of S8's layerThreeSortingItems: S8's line, with "marked new" when the item was opened or amended after this seat's last sorting (`it.isNew`) and "you sorted it before" with the earlier sort (`it.prior`: { sort, reason }) and the reason beneath.
export function finalReadSortingItems({ items } = {}) {
  if (!Array.isArray(items) || !items.length) return '';
  const line = it => {
    const late = it.kind === 'late finding';
    const from = late ? 'late finding' : Number.isInteger(it.layer) ? `raised in layer ${it.layer}` : 'raised in a layer not named';
    const rated = typeof it.rating === 'number' ? `rated ${it.rating.toFixed(1)}` : late ? 'not rated, read as 4 or above' : 'not rated';
    const before = it.prior ? `; you sorted it before: ${it.prior.sort === 'must_do' ? 'must-do' : 'may-leave'}` : '';
    const head = `- ${it.id} (${from}; ${rated}${it.flags?.length ? `; ${it.flags.join(', ')}` : ''}${it.isNew ? '; marked new' : ''}${before}): <critic-claim>${it.problem}</critic-claim>`;
    return it.prior && it.prior.reason ? `${head}\n  Your earlier reason: <critic-claim>${it.prior.reason}</critic-claim>` : head;
  };
  return `${items.some(it => it.kind === 'late finding') ? 'The open objections and late findings to sort' : 'The open objections to sort'}, with the id your sorting must use for each:\n${items.map(line).join('\n')}`;
}

// lateFindingRatingSentence(): WORDING S16-w19, the plan's W32 word for word: appended after W7's sentence on an unanchored failure.
export function lateFindingRatingSentence() {
  return ' Give it a rating from 1 to 10; it is recorded with its rating and is not debated.';
}
