// Prompt words: tiered councils: the reply prompts, the debate guard and the deep dive. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

import { boardText } from './core.js';

export const REPLY_SYSTEM = `You are one lab on a planning panel, answering what the other labs posted
about YOUR proposals. For each of your proposals that received posts, decide:
- keep: the proposal still stands as written. Explain why in one or two sentences, including when the posts support it.
- amend: the objection is right in part; give the amended "how" and/or
  "acceptance_test".
- withdraw: the objection holds, or a merge makes your proposal redundant.
  Name its replacement if there is one.
Answer the substance, not the tone. A withdrawal is a first-class outcome.

Reply with a single JSON object and nothing else:
{
  "replies": [
    { "id": "<your proposal id>", "action": "keep" | "amend" | "withdraw",
      "text": "<why, short>", "how": "<if amended>", "acceptance_test": "<if amended>",
      "replaced_by": "<proposal id, if withdrawn in favour of one>" }
  ]
}`;

export const ALT_REPLY_SYSTEM = `You are one lab on an architecture panel, answering what the other labs
posted about YOUR alternative architecture. Decide:
- keep: the architecture still stands as written. Explain why in one or two sentences, including when the posts support it.
- amend: an objection is right in part; give the amended "shape", "key_tradeoffs"
  and/or "bad_at".
- withdraw: the objections are right, or a merge makes yours redundant; say
  which alternative replaces it, if any.
Answer the substance, not the tone. A withdrawal is a first-class outcome.

Reply with a single JSON object and nothing else:
{
  "replies": [
    { "id": "<your alternative id>", "action": "keep" | "amend" | "withdraw",
      "text": "<why, short>", "shape": "<if amended>", "key_tradeoffs": "<if amended>",
      "bad_at": "<if amended>", "replaced_by": "<alternative id, if withdrawn in favour of one>" }
  ]
}`;

// ---------------------------------------------------------------------------
// Tiered councils (2026-09-26, Muad: "the highest models for the highest tasks, and the lowest
// models (in price) for the mass-agentic tasks"). Two prompt additions, both reached only through a
// chain flag that no chain written before this existed sets, so the case-study runs keep today's
// prompts byte for byte (test/tiered.test.js pins that).
//
// 1. The majority guard (config.majority_guard.enabled). Mass seats argue; they must never win by
//    numbers. The literature the research repo collected says the damage in a debate happens at
//    the author's reply: a model starting against a wrong majority rarely recovers (Wu et al.,
//    arXiv 2511.07784, a preprint), and conformity to wrong peers is common (BenchForm, ICLR 2025).
//    The one prompt lever with a measured effect is an evidence bar that tells the reader the head-
//    count is not evidence (Free-MAD, arXiv 2509.11035, a preprint; DebateLLM's agreement
//    intensity, ICML 2024). So, with the guard on: the author sees each argument once, with no lab
//    letter and no count; the reply prompt carries the evidence bar; and a withdrawal must quote
//    the argument it concedes to, or it is not taken as a withdrawal and the proposal goes to the
//    plan's author to judge. Mechanism only: no claim that it improves plans.

const GUARD_REPLY_RULES = `Evidence bar (this panel runs the majority guard):
- The posts are shown without their authors and without a count. How many labs
  raised a point is not evidence; only what the point says is.
- Keep yours unless a post shows a concrete error: a constraint it
  breaks, a number that is wrong, a conflict with another proposal or with the
  existing build, a test that cannot pass. Keeping it against every post on it
  is a first-class outcome when the evidence is on your side.
- If a post misreads yours, keep it and say in one sentence what was
  misread; amend only the wording that caused the misreading.
- A withdrawal names the argument it concedes to: put a short exact quote of
  that post in "conceded_to". A withdrawal without one is not recorded as a
  withdrawal; yours goes to the plan's author, who judges it on its merits.
`;

function withGuard(system, replacedByLine) {
  const anchor = 'Answer the substance, not the tone. A withdrawal is a first-class outcome.\n';
  if (!system.includes(anchor) || !system.includes(replacedByLine)) throw new Error('roles.js: the majority-guard anchors moved; update withGuard()');
  return system
    .replace(anchor, `${anchor}\n${GUARD_REPLY_RULES}`)
    .replace(replacedByLine, `${replacedByLine.replace(/ \}$/, '')},\n      "conceded_to": "<exact short quote of the post you concede to, if withdrawn>" }`);
}

/** REPLY_SYSTEM, or with the majority guard's evidence bar when `guard` is true. */
export function replySystem(guard = false) {
  return guard ? withGuard(REPLY_SYSTEM, '"replaced_by": "<proposal id, if withdrawn in favour of one>" }') : REPLY_SYSTEM;
}

/** ALT_REPLY_SYSTEM, or with the majority guard's evidence bar when `guard` is true. */
export function altReplySystem(guard = false) {
  return guard ? withGuard(ALT_REPLY_SYSTEM, '"replaced_by": "<alternative id, if withdrawn in favour of one>" }') : ALT_REPLY_SYSTEM;
}

// The posts on one proposal as a guarded author reads them: each distinct argument once, objections
// first, no lab letter, no tally. A support post carries no argument to answer, so it is shown only
// as its reason, like the others.
function guardedPosts(on, maps) {
  const order = { object: 0, merge: 1, support: 2 };
  const seen = new Set();
  const lines = [];
  for (const x of [...on].sort((a, b) => (order[a.stance] ?? 3) - (order[b.stance] ?? 3))) {
    const text = boardText(x.text);
    const key = `${x.stance}|${x.merge_with || ''}|${String(text).trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${x.stance}${x.merge_with ? ` with ${maps.idTo[x.merge_with] || boardText(x.merge_with)}` : ''}: ${text}`);
  }
  return `**Arguments on it** (authors and numbers withheld; answer each on what it says):\n${lines.join('\n')}`;
}

// A guarded withdrawal names what it conceded to; the board shows it. '' for every other reply, so
// an unguarded board is unchanged.
function conceded(r) {
  return r.action === 'withdraw' && typeof r.conceded_to === 'string' && r.conceded_to.trim() ? ` (conceded to: "${boardText(r.conceded_to)}")` : '';
}

export const UNARGUED_STATUS = 'STANDS: its author offered to withdraw it without naming the argument it concedes to, so the majority guard kept it for the plan\'s author to judge on its merits';

/** Put at the top of a guarded board, which the skeleton, builder and reviser read. */
export const GUARD_BOARD_NOTE = `> Majority guard: the posts below are arguments, not votes. How many labs posted for or against a proposal is not evidence. A proposal marked "STANDS: its author offered to withdraw it..." was not withdrawn on a named argument; judge it on its merits and record the outcome in the Scope ledger.`;

// 2. The deep-dive seat (config.deep_dive, seats.deep_dive). One seat, one job, a large output cap
//    and its own dollar cap inside the run's. Its findings are not votes: they go to the reviser as
//    one extra pass before the anchor panel's first review, and each is fixed or DECLINED like a
//    critic's. It reads the source in chunks, one call per chunk and focus, so a long task can get
//    millions of tokens of attention from a cheap model instead of a few thousand from a costly one.
export const DEEP_DIVE_JOBS = Object.freeze(['sources', 'subsystem']);

// Item 28 (Muad's yes 7 Oct 2026 via C&C): the line that hands the deep dive's findings to the reviser. The findings are not votes; the same lab may still judge on the panel
// ("judging": "all-roles"), so the line no longer says the seat does not vote (it used to be written inline in src/chain.js).
export function deepDiveVerdictLine({ job, count }) {
  return `Deep dive (${job}): ${count} finding(s). These findings are not votes.`;
}

export function deepDiveSystem(job) {
  const task = job === 'subsystem'
    ? `Your job: play the part of the plan named under "Focus" through in detail, step by step, the way a
build session would carry it out. Report every point where it breaks: an input nobody produces, a state
nobody handles, an order of work that cannot run, a number that does not add up, an acceptance test
that cannot pass. Use the source excerpt for the facts the plan must respect.`
    : `Your job: check the plan against the source excerpt you are given, line by line. Report every
requirement, number, constraint, name or decision in the excerpt that the plan contradicts, drops or
gets wrong. Something the excerpt does not mention is not a finding.`;
  return `You are the deep-dive reviewer on a planning panel. You have one job and a large budget for it.
This job is not a vote on the plan. Your findings go to the plan's author, who fixes or declines each one;
the review panel then reads the result.

${task}

Rules:
- Report only what you can show. Quote the plan's exact words in "quote" (copy them character for
  character; write "" if the problem is something the plan leaves out).
- For a source finding, quote the source's exact words in "source_quote".
- No style advice, no praise, no summary. An empty list is a valid answer.

Reply with a single JSON object and nothing else:
{ "findings": [ { "criterion": "<the acceptance criterion or source requirement it concerns>",
  "quote": "<exact plan text, or empty>", "source_quote": "<exact source text, or empty>",
  "problem": "<one to three sentences>", "fix": "<the smallest change that fixes it>" } ] }`;
}

export function deepDiveUser({ criteria, draft, chunk, index, of, focus }) {
  return `# Acceptance criteria\n\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# Focus\n\n${focus}\n\n# The plan\n\n${draft}\n\n# Source excerpt ${index} of ${of}\n\n${chunk}`;
}
export { conceded, guardedPosts };
