// Prompt words: the proposal stage: skeleton, proposers, the judge and the proposal merge. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

// Absent (no alternatives stage), both sections are the empty string, so skeletonUser and
// builderUser are byte-identical to what they were before this stage existed.
export function alternativesSkeletonSection(board) {
  if (!board) return '';
  return `\n\n# Whole alternative architectures, with their debate board\n\nBefore this skeleton, each lab proposed one whole architecture blind, the labs debated them, and each author kept, amended or withdrew theirs. Build the skeleton on one of them or on a combination, and name the one(s) at the top of the skeleton by id. No alternative is required because it was proposed, and a lab's support is not a vote. A withdrawn alternative is out unless another one absorbed it.\n\n${board}`;
}

// ---------------------------------------------------------------------------
// Proposal stage (2026-09-07, his design, shaped by the evidence in
// Docs/Evidence.md): the cheap seats get to AUTHOR, not only grade - but as
// proposers of buildable parts against a skeleton, never as co-writers of the
// plan. One model integrates, so the plan keeps one voice; every proposal is
// recorded in a scope ledger as accepted or cut with a reason, so nothing a
// lab contributed disappears silently and each lab can be scored afterwards.

export const SKELETON_SYSTEM = `You write the skeleton of a plan, not the plan.

From the request and its acceptance criteria, write a short outline other
models will propose buildable parts against: the systems the deliverable is
made of, the constraints that bind every part, the bar the whole must meet,
and what is out of scope. Name things; decide nothing in detail. No numbers
unless the request fixes them. Under 800 words, markdown, no preamble.`;

export const PROPOSER_SYSTEM = `You are a proposer in a multi-model planning chain.

You are given a request, its acceptance criteria and a skeleton of the plan.
Propose buildable parts of that plan. Another model will integrate the
accepted ones into a single plan and record why any were cut, and your
proposals are scored later by whether they were accepted and whether they
were built - so propose what you can specify well, not what sounds big.

Rules:
- Propose at most the number of parts you are told. Fewer is fine.
- A part is one buildable element: its name, which bar item or criterion it
  serves, what it is, why it is worth building, how to build it (which
  scripts or files it adds or changes, where authority sits, the numbers),
  and one acceptance test a machine or a tester can run.
- Every number carries a one-line reason or the word "placeholder".
- Never propose anything the request names as out of scope or deferred.
- Do not restate the skeleton, do not comment on the request, do not
  address the integrator. Proposals only.

Reply with a single JSON object and nothing else:

{
  "proposals": [
    { "title": "<short name>",
      "serves": "<the bar item or criterion it serves>",
      "what": "<what it is, two sentences at most>",
      "why": "<why it is worth building, one sentence>",
      "how": "<scripts or files touched, authority, numbers - concrete>",
      "acceptance_test": "<one test with an expected result>" }
  ]
}`;

export function skeletonUser({ request, criteria, alternatives = null }) {
  return `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}${alternativesSkeletonSection(alternatives)}`;
}

// `slice` (v1 context partitioning, opt-in via config.proposals.partition - see chain.js) is a
// per-seat additional instruction layered on top of the identical request/criteria/skeleton every
// seat already gets. It never replaces or subsets that shared material - only frames it - and
// when absent/empty the returned prompt is byte-for-byte identical to the pre-partition output.
// This is a mechanism only: it makes no claim about what effect, if any, it has on proposals.
export function proposerUser({ request, criteria, skeleton, parts, slice }) {
  const base = `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Skeleton of the plan\n\n${skeleton}\n\n# Your allowance\n\nAt most ${parts} proposals.`;
  return slice
    ? `${base}\n\nPer-seat focus instruction (you were given this slice; other reviewers may have received different instructions):\n${slice}`
    : base;
}

// Rendered into the builder's and reviser's prompts when proposals exist.
export function proposalsSection(proposals, board = null) {
  if (!proposals || !proposals.length) return '';
  if (board) {
    return `\n\n# Proposals from the other labs, with their debate board\n\nEach proposal below was written blind against a skeleton, then every lab read the others' and posted support, objections or merges, and each author replied: keep, amend or withdraw. Judge each proposal on whether it serves the request and its bar and fits the constraints, with the board as evidence; nothing here is required and a lab's support is not a vote. A withdrawn proposal is not built; its replacement may be. Accepted proposals count as requested scope: work each one into the plan where it belongs and reference it by its id and lab at that place. Cut the rest.\n\nThe plan must end with a section titled "Scope ledger": one line per proposal id, in the form\n\`<id> - accepted - <where it landed, one line>\`, \`<id> - cut - <reason, one line>\` or \`<id> - withdrawn - <by its author, one line>\`.\nEvery id below appears there exactly once.\n\n${board}`;
  }
  const body = proposals.map(p =>
    `## ${p.id} (from ${p.lab})\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`
  ).join('\n\n');
  return `\n\n# Proposals from the other labs on this panel\n\nEach is a candidate part of the plan, written blind against a skeleton. Judge each on whether it serves the request and its bar and fits the constraints; nothing here is required. Accepted proposals count as requested scope: work each one into the plan where it belongs and reference it by its id and lab at that place. Cut the rest.\n\nThe plan must end with a section titled "Scope ledger": one line per proposal id, in the form\n\`<id> - accepted - <where it landed, one line>\` or \`<id> - cut - <reason, one line>\`.\nEvery id below appears there exactly once.\n\n${body}`;
}

// Best-of-N (his call, 2026-09-07): each proposer is sampled several times
// and a judge picks the strongest distinct parts from that lab's pool. The
// evidence (Self-MoA) is that repeated samples of one model, filtered, beat
// mixing models; here it also gives each lab more shots at a good idea
// without making the integrator read every shot.
export const JUDGE_SYSTEM = `You are the judge of a proposal pool in a multi-model planning chain.

You are given the request, its acceptance criteria, the plan skeleton, and a
numbered pool of proposals that one lab wrote in several independent
attempts. Pick the strongest distinct proposals, up to the number you are
told. Another model will integrate what you pick.

Judge each proposal on: does it serve the request's bar and constraints; is
"how" concrete enough to build from (files, authority, numbers); is the
acceptance test runnable. Drop duplicates and near-duplicates - keep the
better-specified one. Drop anything the request names as out of scope.
Do not rewrite proposals. Pick only.

Reply with a single JSON object and nothing else:
{ "picks": [<pool numbers, best first>], "dropped_because": "<one line on what you dropped and why>" }`;

export function judgeUser({ request, criteria, skeleton, pool, keep }) {
  const listed = pool.map((p, i) =>
    `## ${i + 1}\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`
  ).join('\n\n');
  return `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Skeleton of the plan\n\n${skeleton}\n\n# Pool (${pool.length} proposals from one lab)\n\n${listed}\n\n# Your task\n\nPick up to ${keep} distinct proposals, best first.`;
}

// v5 §1 candidate 10 (2026-09-13, his call: no default cap - a chain must
// opt in to max_proposals_per_seat, and unlimited stays unlimited otherwise).
// When a chain does set the cap and one seat's own list still exceeds it,
// that seat gets one prompt to fold its own proposals down before the board
// ever sees the extras - cheaper than pruning them on the board itself,
// which is what most of the largest observed run's volume actually was.
export const PROPOSAL_MERGE_SYSTEM = `You are folding your own proposals down to a smaller set, in a multi-model planning chain.

You already wrote more proposals than this chain's cap allows. Pick which of
your own proposals to keep, merging any that overlap into one entry rather
than simply dropping the others - a merged proposal should name what each
of its sources contributed. Keep the strongest, most concretely specified
set; drop the rest.

Reply with a single JSON object and nothing else:
{ "kept": [<numbers of your own proposals to keep, best first>], "merged_because": "<one line on what you folded together or dropped and why>" }`;

export function proposalMergeUser({ request, criteria, skeleton, list, cap }) {
  const listed = list.map((p, i) =>
    `## ${i + 1}\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`
  ).join('\n\n');
  return `# Request\n\n${request}\n\n# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Skeleton of the plan\n\n${skeleton}\n\n# Your own proposals (${list.length}, over this chain's cap of ${cap})\n\n${listed}\n\n# Your task\n\nFold down to at most ${cap}, best first.`;
}
