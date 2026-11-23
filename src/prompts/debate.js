// Prompt words: the debate stage, and the handoff system prompt that sits in its section. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

import { boardText } from './core.js';
import { UNARGUED_STATUS, conceded, guardedPosts } from './tiered.js';

// ---------------------------------------------------------------------------
// Debate (his call, 2026-09-07: "the labs should talk to each other"). Where
// the talk happens is a design choice, not a measured result. Talk about
// VERDICTS hurt in our own relay test (anchoring), so the labs debate
// PROPOSALS, in two rounds, and still grade blind. This comment used to cite
// arXiv 2510.20963 (ColMAD) as support for "roles that disagree"; the paper
// does not support that reading. It argues that, in error detection, competitive debate
// between assigned opponents tends to slide into cheap talk (persuading, not
// finding errors), and it proposes collaborative debate, where agents pool
// complementary evidence toward one answer, instead. It does not test debate
// about what to build. Labs are anonymised inside the prompts so nobody
// defers to a name; the saved board carries real names.

export const DEBATE_SYSTEM = `You are one lab on a planning panel. Every lab proposed parts of a plan
blind; now you read all of them and say what you think, so the integrator
builds the best set, not the loudest.

For each proposal by another lab, post one of:
- support: you would build it as written (one line why).
- object: name the concrete problem - it conflicts with a constraint, with
  another proposal, with the existing build, or its numbers or test are wrong.
  Quote the phrase you object to.
- merge: it and another proposal are the same part or must be one part; say
  which one and what the merged part is.
You may skip proposals you have nothing to add to. Do not post on your own.
If reading the others changes your own proposals, revise them: give the new
"how" or "acceptance_test" for that id. Never withdraw here - the author
decides that in the reply round.

No pleasantries, no summary of the proposals, no addressing the integrator.

Reply with a single JSON object and nothing else:
{
  "posts": [
    { "on": "<proposal id>", "stance": "support" | "object" | "merge",
      "text": "<one to three sentences, concrete>",
      "merge_with": "<proposal id, only for merge>" }
  ],
  "revisions": [
    { "id": "<your own proposal id>", "how": "<revised, or omit>", "acceptance_test": "<revised, or omit>" }
  ]
}`;

export const HANDOFF_SYSTEM = `You write the handoff file a build session reads before it touches the plan.

You are given the request and the final plan. Write HANDOFF.md: what the plan
is, the order of work in one list, the acceptance test the session runs after
each item, the files it must keep current while it works (a progress file, a
decisions file, a built-log per commit naming the plan section and proposal
ids served, and the board file the plan defines), what it must never do
(scope outside the plan), and the one line a human types to start it. Under
600 words. No preamble. Do not restate the plan's content; point at its
section numbers.

If the request contains an "Available tools" section, the build session has
those tools and no others. Name the right one in the acceptance test for each
item of work it fits - the reviewer, checker or generator that should run
against that item - using the exact name as listed. Where no listed tool fits
an item, write the check the session performs by hand instead. Never name a
tool that is not in that section, and never invent a command line for one:
you are told what exists, not how it is invoked. If the request has no such
section, write acceptance tests that assume nothing beyond the project's own
test suite.

If the plan has the build session install or download anything (a package, library, plugin, MCP server, container image, install script or CI action), end the handoff with a section "Dependencies to verify". List one line per item, using only what the plan itself names: \`name (what kind, version): why the plan needs it\`. Copy the name and the version exactly as the plan writes them. If the plan gives no version, write "version not stated in the plan". Never supply a name or a version yourself. For every choice the plan leaves open ("a markdown parser"), write one line saying the build session must verify whatever it picks. Then tell the session: before it installs or downloads any item, it checks that the exact name exists, that it is the one the plan means, and that it is not a near-copy of a better-known name. If it cannot check, it stops and asks the person. It never treats this list as already checked. If the plan names nothing to install, write "Dependencies to verify: none named in the plan." This section does not count toward the word limit.`;

const labLetter = i => `Lab ${String.fromCharCode(65 + i)}`;

// Anonymise labs for the prompts: ids become "A-1", labs "Lab A". Returns the
// rendered list and the maps to translate replies back.
// The anonymised name an injected canary post is shown under in the author's prompt (pre-release
// audit 2026-09-23, ProposalsDebateDispute #1: it rendered as "undefined", itself a tell). It
// borrows the label of another lab that really is on the board, so the post reads exactly like
// the others; with no other lab, the next unused letter. Prompt-only: the recorded post keeps
// `by: 'canary'` and `canary: true`, so nothing attributes the objection to that lab in data.
export function canaryPosterLabel(maps, authorLab) {
  const other = Object.keys(maps.labTo).find(l => l !== authorLab);
  return other ? maps.labTo[other] : labLetter(Object.keys(maps.labTo).length);
}

export function anonymise(proposals) {
  const labs = [...new Set(proposals.map(p => p.lab))];
  const labTo = Object.fromEntries(labs.map((l, i) => [l, labLetter(i)]));
  const idTo = {}; const idFrom = {};
  for (const p of proposals) {
    const anon = `${labTo[p.lab].slice(4)}-${p.id.split('-').pop()}`;
    idTo[p.id] = anon; idFrom[anon] = p.id;
  }
  return { labTo, idTo, idFrom };
}

function renderProposal(p, idTo, labTo) {
  return `## ${idTo[p.id]} (by ${labTo[p.lab]})\n**Title:** ${boardText(p.title)}\n**Serves:** ${boardText(p.serves)}\n**What:** ${boardText(p.what)}\n**Why:** ${boardText(p.why)}\n**How:** ${boardText(p.how)}\n**Acceptance test:** ${boardText(p.acceptance_test)}`;
}

export function debateUser({ request, criteria, skeleton, proposals, lab, maps }) {
  const mine = proposals.filter(p => p.lab === lab);
  const others = proposals.filter(p => p.lab !== lab);
  return `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Skeleton of the plan\n\n${skeleton}\n\n# Your own proposals (you are ${maps.labTo[lab]})\n\n${mine.map(p => renderProposal(p, maps.idTo, maps.labTo)).join('\n\n')}\n\n# The other labs' proposals\n\n${others.map(p => renderProposal(p, maps.idTo, maps.labTo)).join('\n\n')}`;
}

export function replyUser({ request, proposals, posts, lab, maps, guard = false }) {
  const mine = proposals.filter(p => p.lab === lab);
  const threads = mine.map(p => {
    const on = posts.filter(x => x.on === p.id);
    if (!on.length) return null;
    if (guard) return `${renderProposal(p, maps.idTo, maps.labTo)}\n\n${guardedPosts(on, maps)}`;
    return `${renderProposal(p, maps.idTo, maps.labTo)}\n\n**Posts on it:**\n${on.map(x => `- ${maps.labTo[x.by]} - ${x.stance}${x.merge_with ? ` with ${maps.idTo[x.merge_with] || boardText(x.merge_with)}` : ''}: ${boardText(x.text)}`).join('\n')}`;
  }).filter(Boolean);
  return `# Request (for reference)\n\n${request}\n\n# Your proposals that received posts (you are ${maps.labTo[lab]})\n\n${threads.join('\n\n---\n\n')}`;
}

// The board as the integrator and the human read it: real names, per thread.
export function renderBoard(proposals, posts, replies) {
  return proposals.map(p => {
    const on = posts.filter(x => x.on === p.id);
    const re = replies.filter(r => r.id === p.id);
    const status = p.withdrawn ? `WITHDRAWN by ${p.lab}${p.replaced_by ? ` in favour of ${boardText(p.replaced_by)}` : ''}` : p.withdraw_unargued ? UNARGUED_STATUS : p.amended ? 'AMENDED by its author after debate' : 'stands';
    return `## ${p.id} (${p.lab}) - ${status}\n**Title:** ${boardText(p.title)}\n**Serves:** ${boardText(p.serves)}\n**What:** ${boardText(p.what)}\n**Why:** ${boardText(p.why)}\n**How:** ${boardText(p.how)}\n**Acceptance test:** ${boardText(p.acceptance_test)}\n\n**Board:**\n${on.map(x => `- ${x.by} - ${x.stance}${x.merge_with ? ` with ${boardText(x.merge_with)}` : ''}: ${boardText(x.text)}`).join('\n') || '- (no posts)'}\n${re.map(r => `- ${p.lab} (author) - ${r.action}: ${boardText(r.text)}${conceded(r)}`).join('\n')}`;
  }).join('\n\n');
}

// The heading above the tool output a debate carries as ground truth. It lived in src/prompts/advise.js until 0.8.4 (the advice add-on's prompts left); the words are unchanged.
export const DEBATE_GROUND_TRUTH_HEADING = 'Ground truth from the debate (tool output, verbatim)';
