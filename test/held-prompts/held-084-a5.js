// 0.8.4, A5 (WORDING WRR-a5 and the rows after it). His words, 03 Nov 2026 17:39: "the handling session and its advisor pick one of the two, as the plan already does when the two top judges split at the final read (D31)". When two or more top-layer seats re-rate ONE objection to
// different ratings in the same pass, the handling session picks one of the ratings by reasoning, at a wait of its own (`retag-pick-<n>`, src/retag-pick.js), before anything is put in force.
// A-DRAFT: drafted for the one release wording review, recorded all together or not at all (test/held-prompts-084-a5.test.js). Until they are recorded in src/roles.js nothing waits and the higher rating applies, as it always did.
// The voice is handlerSortSystem's / handlerSortUser's (test/held-prompts/held-084-b.js). Choices that are the builder's, for the review: the answer is the RATING (not a seat); "and your advisor's if you have one" follows his option text (the sort wait's wording has no such clause);
// "from this pass on" is said because the run goes on after the pick (a revision, another wait or a build check can follow), so the sort wait's "Nothing else follows" is not used; "pass" is the word `council retag-add` already uses.
const layerWord = n => (Number.isInteger(n) && n >= 1 ? `layer ${n}` : 'the top layer');
const layerWordCap = n => (Number.isInteger(n) && n >= 1 ? `Layer ${n}` : 'The top layer');

// handlerRetagPickSystem({ layer }) / handlerRetagPickUser({ plan, sha, objection, options, layer }): `objection` { id, lab, from (a rating or null), criterion, problem, quote? }; `options` [{ seat, to, reason }]. The model's text arrives escaped by the caller.
export function handlerRetagPickSystem({ layer = null } = {}) {
  return `${layerWordCap(layer)} has read this plan. Two or more of its seats re-rated the same objection to different ratings in the same pass; the ratings, and each seat's reasons, are below. The rating you pick is the one in force for this objection from this pass on. Pick one of these ratings, by your reasoning and your advisor's if you have one. Start your answer with the rating you pick, then your reasons, which must name the objection by its id.`;
}
export function handlerRetagPickUser({ plan, sha, objection, options = [], layer = null }) {
  const o = objection;
  return `# The plan ${layerWord(layer)} read (id ${sha})\n\n${plan}\n\n# The objection\n\n- ${o.id} (raised by ${o.lab}; ${typeof o.from === 'number' ? `rated ${o.from.toFixed(1)} before this pass` : 'not rated, read as 4 or above'}): <critic-claim>${o.criterion}: ${o.problem}</critic-claim>${o.quote ? `\n  Quote: <critic-claim>${o.quote}</critic-claim>` : ''}\n\n# The ratings\n\n${options.map(x => `- ${x.seat} re-rated it to ${Number(x.to).toFixed(1)}: <critic-claim>${x.reason}</critic-claim>`).join('\n')}`;
}
