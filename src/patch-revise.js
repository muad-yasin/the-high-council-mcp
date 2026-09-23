// Patch-mode reviser (2026-09-20). Default off; `revise: { mode: "patch" }` opts in.
//
// The reviser rewrites the whole plan every round. That is the single largest output cost in a
// run - in the cheap-7 run, two revise stages were ~$0.36 of $1.58, and output is the expensive
// half of that - and the cost is not the real problem. Rewriting invites unrequested drift: a
// model asked to reproduce 4,000 words while fixing three sentences will quietly reword the
// other 3,900, and no reviewer sees a diff, so nobody notices.
//
// Patch mode asks for the edits instead: search/replace blocks the harness applies locally.
// The parts nobody objected to come out byte-identical, by construction rather than by trust.
//
// The honest limit, stated where it cannot be missed: whether real models reliably produce
// anchors that match verbatim is UNVERIFIED. It cannot be tested at $0 - the mock provider
// ignores prompt text by design - so this ships default-off and falls back to a full rewrite
// the moment any block fails to apply. The fallback is the feature: a chain that turns this on
// gets cheaper runs when it works and today's behaviour when it does not.

import { fenceFor } from './fence.js';

export const PATCH_BLOCK_RE = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

/** Parse search/replace blocks out of a reviser reply. Never throws. */
export function parsePatches(text) {
  const patches = [];
  for (const m of String(text || '').matchAll(PATCH_BLOCK_RE)) {
    patches.push({ search: m[1], replace: m[2] });
  }
  return patches;
}

/**
 * Apply patches to a draft. Every block must match exactly once, or the whole application
 * fails and the caller falls back to a full rewrite.
 *
 * A non-unique search is refused rather than resolved by "first match". The reviser cannot see
 * which occurrence the harness would pick, so picking one silently edits a place nobody chose -
 * and in a plan, the same sentence genuinely does recur across sections.
 *
 * Applied sequentially, each against the result of the last, so a later block can legitimately
 * target text an earlier one produced.
 */
export function applyPatches(draft, patches) {
  let out = String(draft ?? '');
  if (!patches.length) {
    return { ok: false, text: out, applied: 0, reason: 'no search/replace blocks found in the reply' };
  }
  for (const [i, p] of patches.entries()) {
    if (!p.search) {
      return { ok: false, text: String(draft ?? ''), applied: i, reason: `block ${i + 1} has an empty SEARCH section` };
    }
    const first = out.indexOf(p.search);
    if (first === -1) {
      return {
        ok: false, text: String(draft ?? ''), applied: i,
        reason: `block ${i + 1}'s SEARCH text does not appear in the draft verbatim`,
      };
    }
    if (out.indexOf(p.search, first + 1) !== -1) {
      return {
        ok: false, text: String(draft ?? ''), applied: i,
        reason: `block ${i + 1}'s SEARCH text appears more than once - ambiguous, so nothing was applied`,
      };
    }
    out = out.slice(0, first) + p.replace + out.slice(first + p.search.length);
  }
  return { ok: true, text: out, applied: patches.length, reason: null };
}

/**
 * The diff critics are shown alongside the full draft, so a reviewer can see what moved without
 * re-reading the whole plan. Deliberately a list of the edits themselves rather than a computed
 * line diff: these ARE the edits, and re-deriving them would only add a chance to be wrong.
 */
export function changedSince(patches) {
  if (!patches?.length) return '';
  // Pre-release audit 2026-09-23 (PreRelease_Audit_revise #3): a fixed ``` fence was closed early by
  // any fenced snippet inside the patch text itself, so critics saw a garbled change directly under
  // "everything not shown is byte-identical". Each block now gets a fence longer than any backtick
  // run in its own content (fence.js's fenceFor, the rule `council fence` uses), so it parses whole.
  const block = text => { const f = fenceFor(text); return [f, text, f]; };
  const body = patches.map((p, i) => [
    `### Change ${i + 1}`,
    '',
    'Was:',
    ...block(p.search),
    '',
    'Now:',
    ...block(p.replace),
  ].join('\n')).join('\n\n');
  return `\n\n## Changed since your last review\n\nEverything not shown below is byte-identical to the draft you reviewed.\n\n${body}`;
}
