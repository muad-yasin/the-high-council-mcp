// Prompt words: whole alternative architectures, and the handoff user prompt that sits in its section. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

import { boardText } from './core.js';
import { UNARGUED_STATUS, conceded, guardedPosts } from './tiered.js';

// ---------------------------------------------------------------------------
// Whole alternative architectures (2026-09-23, opt-in `alternatives: { enabled: true }`). Muad, on
// the research intake: "have the models argue over whole alternative architectures: I think this
// is a great idea". Proposals are additive parts against one skeleton, so until now no seat ever
// argued for a different WHOLE shape - the skeleton's author chose the architecture alone. This
// stage runs first: every lab proposes ONE whole architecture blind, the labs debate them in the
// same anonymised post/reply format proposals use, and the skeleton and builder choose one or
// combine them. The losers are recorded in the plan's "Decisions" section (decision records,
// above), which this stage switches on. Mechanism only: no claim that it improves plans.

export const ALTERNATIVE_SYSTEM = `You are an architect on a planning panel. Before any plan exists,
each lab on the panel proposes, blind, ONE whole alternative architecture for the request. Not a
part of a plan: a complete shape the whole deliverable could take. The labs will then debate the
alternatives, and the plan's author will choose one or combine several, recording why the others
lost.

Rules:
- Exactly one alternative. Make it the one you would defend, not a safe middle.
- Whole: it covers the entire request end to end, at the level of the major
  pieces, how they connect, and where data and authority live.
- Say honestly what it is bad at. An alternative with no weakness is not
  credible and will be discounted.
- Every number carries a one-line reason or the word "placeholder".
- Never propose anything the request names as out of scope or deferred.
- No preamble, no commentary on the request, no addressing the author.

Reply with a single JSON object and nothing else:

{ "name": "<short name>",
  "shape": "<the architecture: major pieces, how they connect, where data and authority live - concrete>",
  "key_tradeoffs": "<what it buys and what it costs, for this request>",
  "bad_at": "<what this architecture is genuinely bad at>" }`;

export function alternativeUser({ request, criteria }) {
  return `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Your task\n\nPropose one whole alternative architecture.`;
}

export const ALT_DEBATE_SYSTEM = `You are one lab on an architecture panel. Every lab proposed ONE whole
alternative architecture blind; now you read all of them and say what you think, so the plan's
author chooses on evidence, not on who argued loudest.

For each alternative by another lab, post one of:
- support: it is a sound whole architecture for this request (one line why).
- object: name the concrete problem - a requirement it cannot meet, a
  constraint it breaks, a cost it hides, a weakness its own "bad at" understates.
  Quote the phrase you object to.
- merge: it and another alternative should be combined; say which one and
  what the combined shape is.
You may skip alternatives you have nothing to add to. Do not post on your own.
Never withdraw here - each author decides that in the reply round.

No pleasantries, no summary of the alternatives, no addressing the author.

Reply with a single JSON object and nothing else:
{
  "posts": [
    { "on": "<alternative id>", "stance": "support" | "object" | "merge",
      "text": "<one to three sentences, concrete>",
      "merge_with": "<alternative id, only for merge>" }
  ]
}`;

function renderAlternative(a, idTo, labTo) {
  return `## ${idTo[a.id]} (by ${labTo[a.lab]})\n**Name:** ${boardText(a.name)}\n**Shape:** ${boardText(a.shape)}\n**Key trade-offs:** ${boardText(a.key_tradeoffs)}\n**Bad at:** ${boardText(a.bad_at)}`;
}

export function altDebateUser({ request, criteria, alternatives, lab, maps }) {
  const mine = alternatives.filter(a => a.lab === lab);
  const others = alternatives.filter(a => a.lab !== lab);
  // Tiered councils (alternatives.debaters "all"): a mass seat that wrote no architecture reads and
  // posts on the anchors' ones. It gets no empty "your own" section; an author's prompt is unchanged.
  if (!mine.length) return `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# The labs' alternatives (you are ${maps.labTo[lab]}; you wrote none of them)\n\n${others.map(a => renderAlternative(a, maps.idTo, maps.labTo)).join('\n\n')}`;
  return `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Your own alternative (you are ${maps.labTo[lab]})\n\n${mine.map(a => renderAlternative(a, maps.idTo, maps.labTo)).join('\n\n')}\n\n# The other labs' alternatives\n\n${others.map(a => renderAlternative(a, maps.idTo, maps.labTo)).join('\n\n')}`;
}

export function altReplyUser({ request, alternatives, posts, lab, maps, guard = false }) {
  const threads = alternatives.filter(a => a.lab === lab).map(a => {
    const on = posts.filter(x => x.on === a.id);
    if (!on.length) return null;
    if (guard) return `${renderAlternative(a, maps.idTo, maps.labTo)}\n\n${guardedPosts(on, maps)}`;
    return `${renderAlternative(a, maps.idTo, maps.labTo)}\n\n**Posts on it:**\n${on.map(x => `- ${maps.labTo[x.by]} - ${x.stance}${x.merge_with ? ` with ${maps.idTo[x.merge_with] || boardText(x.merge_with)}` : ''}: ${boardText(x.text)}`).join('\n')}`;
  }).filter(Boolean);
  return `# Request (for reference)\n\n${request}\n\n# Your alternative and the posts on it (you are ${maps.labTo[lab]})\n\n${threads.join('\n\n---\n\n')}`;
}

// The alternatives board with real names, as the skeleton, the builder and a human read it.
export function renderAlternativesBoard(alternatives, posts, replies) {
  return alternatives.map(a => {
    const on = posts.filter(x => x.on === a.id);
    const re = replies.filter(r => r.id === a.id);
    const status = a.withdrawn ? `WITHDRAWN by ${a.lab}${a.replaced_by ? ` in favour of ${boardText(a.replaced_by)}` : ''}` : a.withdraw_unargued ? UNARGUED_STATUS : a.amended ? 'AMENDED by its author after debate' : 'stands';
    return `## ${a.id} (${a.lab}) - ${status}\n**Name:** ${boardText(a.name)}\n**Shape:** ${boardText(a.shape)}\n**Key trade-offs:** ${boardText(a.key_tradeoffs)}\n**Bad at:** ${boardText(a.bad_at)}\n\n**Board:**\n${on.map(x => `- ${x.by} - ${x.stance}${x.merge_with ? ` with ${boardText(x.merge_with)}` : ''}: ${boardText(x.text)}`).join('\n') || '- (no posts)'}\n${re.map(r => `- ${a.lab} (author) - ${r.action}: ${boardText(r.text)}${conceded(r)}`).join('\n')}`;
  }).join('\n\n');
}

// `checks` (criterion kinds): the checkable criteria with their commands, or ''. When present the
// handoff carries every one of them into its acceptance tests, so a number the plan committed to is
// actually measured by the session that builds it rather than only argued over by the panel.
export function handoffUser({ request, draft, planFile = 'PLAN.md', checks = '' }) {
  const carry = checks
    ? `${checks}\n\nCarry every check above into the acceptance tests, word for word, as a check the build session runs and records the result of. Do not soften a threshold.`
    : '';
  return `# Request\n\n${request}\n\n# Final plan\n\nIt will be saved next to the handoff as \`${planFile}\`; refer to it by that name and its section numbers.\n\n${draft}${carry}`;
}
