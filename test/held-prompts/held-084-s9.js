// 0.8.4 S9 + S9a (the proposer return; Q10, D8, D29): the HELD DRAFTS of the step's wording, A-DRAFT until the one release wording review (rows S9-w1 .. S9-w9 in Review/WORDING_0.8.4.md).
// The PLAN'S words (FEATURE_SPECS S9 "Wording drafts" W8, W10, W13; S9a W29(ii)) are kept as written wherever a function says so; test/held-prompts-084-s9.test.js pins each plan clause BODY by substring (not whole sentences, because W10 is one
// sentence in the plan and this step splits it into three calls: the edits are "Then," and "and" dropped and a capital letter at each piece's start, nothing else). Everything else here is HARNESS wording the step needs and the plan does not give
// (the reply keys, the headings and frames, the three calls' reply formats and system line, the writer note's scaffolding); each has its own WORDING row, so the review sees the plan's words and the harness's words apart.
// Injected with setHeldForTest, inert (byte-identical prompts) until src/roles.js exports a function of the same name. Recorded all together or not at all (test/held-prompts-084-s9.test.js).
// The seams: src/stage-system.js (builderSystemOf and reviserSystemFor: the numbering sentence), src/chain.js (the layer-3 prompt's note and the return's three calls), src/proposer-return.js.

import { boardText } from '../../src/prompts/core.js';
import { containerText } from '../../src/container-text.js';

// PR #2 fix unit, item 4 (V3): text ANOTHER model wrote reaches a seat's prompt escaped, never as the harness's own structure. The objection (a critic's criterion, problem and fix), an alternative, a post and an answer (a proposer's) go through boardText: claimText's escape of a leading "#" and of the critic-claim and prior-review tags, and
// continuation lines indented, so a forged "Post 9", "Problem:" or "3." line cannot read as a label or a list item (src/alternatives.js does the same for an alternative shown to other seats). containerText on top defuses every container tag, not only the two claimText knows.
// No wrapper tag is added and no sentence changes: a field of one paragraph with no heading mark and no container tag is byte-identical; a field of several lines gets its continuation lines indented and a line-leading # escaped. The plan's own text (the decision entry, the Choice line, the skeleton, the plan) and the request and criteria stay bare, as everywhere in the harness.
// A-DRAFT (pr2 fix, item 4): text another seat wrote reaches a prompt escaped and, after its first line, indented four spaces; a post's own first line is indented too.
const said = v => containerText(boardText(v ?? ''));

/** W8 (Q10(a), D8), the PLAN'S words: added to the top layer's prompt. */
export function decisionLevelRule() {
  return 'If you object, say whether the objection is about a decision or about wording. It is about a decision only if fixing it would change which option a Decisions entry chooses; then name the entry, quote its Choice line and cite the criterion it fails and the earlier decision, if any, that it contradicts. Otherwise it is about wording. If you raise several objections about decisions, say which one matters most; if you do not, the first one you list is taken.';
}

/** W8's reply keys (harness wording, no plan text): how the answer to W8 is written in the JSON reply, so the harness can read it and check it against the plan text. "most_consequential" is an ENTRY NUMBER (checkable against the plan), not a list position. */
export function decisionLevelKeys() {
  return 'In your reply, add to each objection the field "level" ("decision" or "wording"). For a decision, also add "entry" (the number of the Decisions entry, as a whole number), "choice" (that entry\'s Choice line, copied word for word) and, if the choice contradicts an earlier decision, "contradicts" (that decision, in a few words). If you raise several decision objections, add beside "failures" the field "most_consequential": the number of the Decisions entry whose objection matters most.';
}

// The shared frames (harness wording): the request and the criteria as the proposers' own prompt headings give them; the contested decision; the objection (criterion, problem and fix only: never the raising seat).
const requestBlock = request => `# Request\n\n${request ?? ''}`;
const criteriaBlock = criteria => `# Acceptance criteria\n\n${(Array.isArray(criteria) ? criteria : []).map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
const decisionBlock = (number, entryText) => `# The decision under review (Decision ${number ?? ''})\n\n${entryText ?? ''}`;
const objectionBlock = o => `# The objection\n\nCriterion: ${said(o?.criterion)}\nProblem: ${said(o?.problem)}${o?.fix ? `\nFix proposed: ${said(o.fix)}` : ''}`;
const altBlock = (a, head) => `${head}\nChoice: ${said(a?.choice)}\nTrade-offs: ${said(a?.trade_offs)}\nWhy the original wins or loses: ${said(a?.why_original_wins_or_loses)}`;

/**
 * W10 (Q10(b), (c)), the FIRST call's user text: what the proposers receive (the request, the criteria, the skeleton when the run had one, the current plan, the objection with the number and full text of the contested entry; the raising seat
 * is not named), then the plan's first two clauses as written: "A reviewer objects to one decision of the plan: ..." with the bracket filled by the blocks, and "Without seeing the other proposers' answers, write an alternative choice for this decision only, with its trade-offs and why the original wins or loses."
 * `objection` = { criterion, problem, fix? }.
 */
export function proposerReturnAltUser({ request, criteria, skeleton, plan, number, entryText, choice, objection } = {}) {
  const parts = [requestBlock(request), criteriaBlock(criteria)];
  if (typeof skeleton === 'string' && skeleton) parts.push(`# Skeleton of the plan\n\n${skeleton}`);
  parts.push(`# The current plan\n\n${plan ?? ''}`, 'A reviewer objects to one decision of the plan:', decisionBlock(number, entryText), `The Choice line: ${choice ?? ''}`, objectionBlock(objection),
    'Without seeing the other proposers\' answers, write an alternative choice for this decision only, with its trade-offs and why the original wins or loses.');
  return parts.join('\n\n');
}

/**
 * W10's third clause, first half, as the SECOND call's user text: "reading the others' alternatives without their authors, write one post on them together" (the plan's "Then," dropped, a capital R). `alternatives` = the OTHER proposers' READABLE
 * alternatives, anonymised and in a shuffled order: [{ choice, trade_offs, why_original_wins_or_loses }]. A proposer is asked only when at least one other alternative is readable.
 */
export function proposerReturnPostUser({ request, criteria, number, entryText, choice, objection, alternatives } = {}) {
  const rows = Array.isArray(alternatives) ? alternatives : [];
  return [requestBlock(request), criteriaBlock(criteria), decisionBlock(number, entryText), `The Choice line: ${choice ?? ''}`, objectionBlock(objection), `# The other proposers' alternatives, without their authors\n\n${rows.map((a, i) => altBlock(a, `Alternative ${i + 1}`)).join('\n\n')}`,
    'Write one post covering the other proposers\' alternatives for this decision. Their identities are hidden.'].join('\n\n');
}

/**
 * W10's third clause, second half, as the THIRD call's user text: "answer once on the posts on yours" (the plan's "and" dropped, a capital A). `own` = this proposer's READABLE alternative; `posts` = the posts of the OTHER proposers, each written
 * after reading this alternative (anonymised, shuffled; never this proposer's own post): [string]. A proposer is asked only when its own alternative is readable and at least one such post exists.
 */
export function proposerReturnAnswerUser({ request, criteria, number, entryText, choice, objection, own, posts } = {}) {
  const list = Array.isArray(posts) ? posts : [];
  return [requestBlock(request), criteriaBlock(criteria), decisionBlock(number, entryText), `The Choice line: ${choice ?? ''}`, objectionBlock(objection), altBlock(own, '# Your alternative'), `# The posts written on the alternatives, without their authors\n\n${list.map((p, i) => `Post ${i + 1}\n    ${said(p)}`).join('\n\n')}`,
    'Write one answer to the posts on your alternative.'].join('\n\n');
}

/** The system line of the three return calls (harness wording): one short line, no persona and no seat role. */
export function proposerReturnSystem() {
  return 'You are one of several proposers answering a question about one decision in a plan. Answer in the JSON form you are given and write nothing else.';
}

/** The reply form each return call ends with (harness wording). `kind` is 'alt', 'post' or 'answer'. */
export function proposerReturnReplyForm(kind) {
  if (kind === 'alt') return 'Reply with one JSON object only: {"alternative": {"choice": "...", "trade_offs": "...", "why_original_wins_or_loses": "..."}}';
  if (kind === 'post') return 'Reply with one JSON object only: {"post": "..."}';
  if (kind === 'answer') return 'Reply with one JSON object only: {"answer": "..."}';
  return '';
}

/** W13, first sentence (Q10(c)), the PLAN'S words: added to the builder's and the reviser's system text where the Decisions rule is on. */
export function decisionsNumberingRule() {
  return 'Number each entry of your Decisions section (Decision 1, Decision 2, and so on) and keep an entry\'s number when you revise.';
}

/**
 * W13, second sentence (Q10(c)), the PLAN'S words as the note's first sentence, with the scaffolding (harness wording) after it: added to the writer's revise step after a proposer return. `alternatives`, `posts`, `answers` are the readable ones,
 * anonymised. NOTE for the wording review: the plan says "options and why-lost fields", the Decisions rule the writer sees calls them "Options considered" and "Why the others lost".
 */
export function returnIntegrationNote({ number, entryText, objection, alternatives, posts, answers } = {}) {
  const block = (head, rows) => (rows.length ? `\n\n${head}:${rows.map((t, i) => `\n${i + 1}. ${said(t)}`).join('')}` : '');
  const alts = (Array.isArray(alternatives) ? alternatives : []).map(a => `Choice: ${a?.choice ?? ''} Trade-offs: ${a?.trade_offs ?? ''} Why the original wins or loses: ${a?.why_original_wins_or_loses ?? ''}`);   // escaped ONCE, by `block` below, over the whole row
  return `For the decision named below, integrate one of the alternatives, or keep the original and give your reasons; record the others in that entry's options and why-lost fields.\n\n${decisionBlock(number, entryText)}\n\n${objectionBlock(objection)}${block('Alternatives from the proposers', alts)}${block('Posts on the alternatives', Array.isArray(posts) ? posts : [])}${block('Answers to the posts', Array.isArray(answers) ? answers : [])}`;
}

/** W29 (ii) (Q10(f), D29), the PLAN'S words as the note's first sentence, with the same scaffolding: added to the writer's revise step after a decision-level objection on a chain with no proposer seat, in place of the integration sentence. Same wording-review note as above. */
export function noProposerRouteNote({ number, entryText, objection } = {}) {
  return `For the decision named below, reconsider the Choice: keep it and give your reasons, or change it, and record the options you weighed in that entry's options and why-lost fields.\n\n${decisionBlock(number, entryText)}\n\n${objectionBlock(objection)}`;
}

// ---- the route (S9-R1, C&C 08 Nov: the sorting's `route` key is S9's, built on S8's merge). W7 (S8's held text, test/held-prompts/held-084-s8.js layerThreeSortingRule) already ASKS for a route per must-do; these three finish it.

/** W7's route clause as the PLAN states it (FEATURE_SPECS S9a W29, the text W29(i) replaces), verbatim. Never sent on its own: src/stage-system.js uses it to find the clause inside W7's recorded text, exactly once, and to replace it on a chain with no proposer seat. */
export function layerThreeSortingRouteClause() {
  return 'For each must-do, name the route that would repair it: the writer, or the proposers only if fixing the objection would change which option a Decisions entry chooses; a fix of wording goes to the writer.';
}

/** W29 (i) (Q10(f), D29), the PLAN'S words: in place of W7's route clause on a chain that has no proposer seat. FLAG for the wording review: "(W8)" is an internal reference (the plan's own words; W7's clause carries it too). */
export function noProposerSortingRouteClause() {
  return 'For each must-do, name the route that would repair it: the writer. If fixing the objection would change which option a Decisions entry chooses, say so and name the entry.';
}

/** The reply key of the route (harness wording, no plan text): where a layer-3 seat writes the route W7 asks for, beside the entries of its sorting. `proposers` = the chain has a proposer seat. */
export function layerThreeSortingRouteKey({ proposers } = {}) {
  return proposers
    ? 'For each must-do entry add the field "route": "writer" or "proposers".'
    : 'For each must-do entry add the field "route": "writer".';
}
