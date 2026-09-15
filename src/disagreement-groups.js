// MLLM Coder v5 item 4 (relay/runs/2026-09-15T03-43-44-216Z/deliverable.md): report.json's
// `disagreement_groups`, the "where they disagree" view grouped by what is being argued about, not
// by time.
//
// Contract:
//   deriveDisagreementGroups(debate, proposals) -> Array | undefined
//     undefined when the run had no debate (debate is null/absent), so report.json omits the key
//     rather than carrying an empty array that would read as "debated, nobody disagreed".
//     One entry per proposal that received at least one `object` or `merge` post:
//       { on, title, author_lab, outcome: 'kept'|'amended'|'withdrawn'|'unknown', posts: [{ by, stance, text, merge_with? }] }
//     Ordered by proposal id with numeric-aware comparison (KIMI-2 before KIMI-10), never by post
//     order. Support-only proposals get no group - agreement is not disagreement.
//
// Derived, never stored anywhere else: every field is read from debate.posts[], proposals[] and the
// amended/withdrawn flags chain.js already sets on each proposal from debate.replies[].
//
// Granularity, stated plainly: this groups at PROPOSAL level, because `posts[].on` names a proposal
// id and nothing finer. Two objections to different sentences of one proposal share a group. A
// finer claim tag on posts is DEFERRED (plan item 4): it would need a prompt change plus a third
// src/chain.js touch point (the post mapper whitelists fields), and free-text claim names written by
// different labs do not group. Reopen trigger: the Sophi-A GUI renders these groups against real
// runs and records a case where one group mixed unrelated objections - the fix then is an id-based
// anchor, not free text.
const DISAGREEING_STANCES = new Set(['object', 'merge']);

export function deriveDisagreementGroups(debate, proposals) {
  if (!debate || !Array.isArray(debate.posts)) return undefined;
  const byId = new Map((proposals || []).map(p => [p.id, p]));
  const groups = new Map();
  for (const post of debate.posts) {
    if (!DISAGREEING_STANCES.has(post.stance)) continue;
    if (!groups.has(post.on)) groups.set(post.on, []);
    groups.get(post.on).push({
      by: post.by,
      stance: post.stance,
      text: post.text,
      ...(post.merge_with ? { merge_with: post.merge_with } : {}),
    });
  }
  return [...groups.keys()]
    .sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))
    .map(on => {
      const p = byId.get(on);
      // A post whose target is missing from proposals[] is kept, never dropped: chain.js filters
      // posts to real proposal ids today, so 'unknown' marks a data problem worth seeing.
      const outcome = !p ? 'unknown' : p.withdrawn ? 'withdrawn' : p.amended ? 'amended' : 'kept';
      return { on, title: p?.title ?? null, author_lab: p?.lab ?? null, outcome, posts: groups.get(on) };
    });
}
