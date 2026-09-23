// Descriptive telemetry, computed from existing run logs on disk.
//
// This is NOT an evaluation, a benchmark, or a baseline. v7's Direction 1
// (a paid comparison harness measuring the council against a single model)
// was cut - the author declined both the ~$300 full and ~$20 pilot spend,
// and no free version of an actual *comparison* run was found that didn't
// smuggle in real cost or an implicit efficacy claim. This module is the
// stated zero-cost substitute for that cut direction's measurement intent:
// four counts pulled out of run folders that already exist, with no claim
// attached to any of them about whether the debate mechanism produces
// "better" output than anything else. Nothing here is a baseline. Nothing
// here is graded. It is arithmetic over what already happened.
//
// Same disk-is-the-source-of-truth convention as spend.js and
// verdict-stats.js: everything is DERIVED from runs/<id>/report.json and
// runs/<id>/HANDOFF.md at read time. No ledger, no config key, nothing
// written. A run folder that is deleted takes its numbers with it.
//
// Descriptive figures, each a plain rate or count:
//   - amendment rate: proposals marked amended / total proposals
//   - withdrawal rate: proposals marked withdrawn / total proposals
//   - objection-follow-through rate: of proposals that drew at least one
//     "object" post in debate, how many were later amended or withdrawn
//     (as opposed to standing unchanged after being objected to)
//   - tool-call usage: of HANDOFF.md acceptance-test items written against
//     a task that declared an "## Available tools" section, how many name
//     one of those tools by its exact listed name (per roles.js's
//     HANDOFF_SYSTEM convention) rather than a manual/generic check
//   - allocator rubber-stamp rate (v7.3): of the resource allocator's
//     targeted extra rounds, how many left the draft byte-for-byte unchanged
//   - consensus-induced-regression count (v7.2, this addition): see the
//     block below this header for the full definition
//
// Privacy: chain name, counts and rates only. Never task content, proposal
// text, debate text or HANDOFF prose beyond the tool names it lists.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runIdToDate } from './spend.js';
import { withoutCanary } from './canary.js';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

// Tool names declared under "## Available tools" in a task file get echoed
// into HANDOFF.md by roles.js's HANDOFF_SYSTEM as a bullet list under the
// same heading. We read them back out of the handoff, not the task, so this
// stays a pure function of the run folder - no need to re-resolve the task
// path, which may not even exist anymore on this machine.
function toolNamesFromHandoff(text) {
  const m = text.match(/## Available tools\n([\s\S]*?)(\n## |\n?$)/);
  if (!m) return [];
  const names = [];
  for (const line of m[1].split('\n')) {
    const bullet = line.match(/^[\s*-]+`?([A-Za-z0-9_.\/-]+)`?/);
    if (bullet) names.push(bullet[1]);
  }
  return names;
}

// Acceptance-test bullet items live under "## Acceptance test per item" in
// HANDOFF.md, one bullet per item (see roles.js HANDOFF_SYSTEM). We only
// need to count them and check whether each one names a declared tool.
function acceptanceItemsFromHandoff(text) {
  const m = text.match(/## Acceptance test per item\n([\s\S]*?)(\n## |\n?$)/);
  if (!m) return [];
  return m[1].split('\n').filter(l => /^[\s]*-\s+/.test(l));
}

function toolCallUsageOfRun(dir) {
  const text = readText(join(dir, 'HANDOFF.md'));
  if (!text) return null; // no handoff stage in this run (e.g. panel-only chain) - not applicable
  const tools = toolNamesFromHandoff(text);
  if (!tools.length) return { hasToolsSection: false, items: 0, itemsNamingTool: 0 };
  const items = acceptanceItemsFromHandoff(text);
  let itemsNamingTool = 0;
  for (const item of items) {
    if (tools.some(t => item.includes(t))) itemsNamingTool += 1;
  }
  return { hasToolsSection: true, items: items.length, itemsNamingTool };
}

// v7.3: the resource allocator's own required falsification watch, read
// back out of report.json's `allocator.targetedRounds[]` (chain.js). Not a
// new stage - purely reading what chain.js already wrote, same convention
// as every other figure in this module.
function allocatorMetricsOfRun(report) {
  const rounds = report?.allocator?.targetedRounds;
  if (!Array.isArray(rounds) || !rounds.length) return null;
  return {
    targeted: rounds.length,
    engaged: rounds.filter(r => r.engaged).length,
    toolFired: rounds.filter(r => r.tool).length,
  };
}

function proposalMetricsOfRun(report) {
  const proposals = Array.isArray(report?.proposals) ? report.proposals : [];
  const amended = proposals.filter(p => p.amended === true).length;
  const withdrawn = proposals.filter(p => p.withdrawn === true).length;

  // v7.x item 4: canary objections (src/canary.js) are injected into this exact same
  // posts/replies shape, each carrying `canary: true`, so they can be answered by an author the
  // same way a real objection is. They are NOT real objections and must never count toward this
  // rate - additive-only exclusion filter, the rest of this function's logic is unchanged.
  const posts = (Array.isArray(report?.debate?.posts) ? report.debate.posts : []).filter(p => p.canary !== true);
  const replies = (Array.isArray(report?.debate?.replies) ? report.debate.replies : []).filter(r => r.canary !== true);
  const objectedIds = new Set(posts.filter(p => p.stance === 'object' && p.on).map(p => p.on));
  let objectedFollowedThrough = 0;
  for (const id of objectedIds) {
    const followedThrough = replies.some(r => r.id === id && (r.action === 'amend' || r.action === 'withdraw')) ||
      proposals.some(p => p.id === id && (p.amended === true || p.withdrawn === true));
    if (followedThrough) objectedFollowedThrough += 1;
  }

  return {
    proposals: proposals.length,
    amended,
    withdrawn,
    objected: objectedIds.size,
    objectedFollowedThrough,
  };
}

// v7.2: consensus-induced-regression signal. Purely structural, derived at read time from
// report.json's existing debate.posts[]/debate.replies[]/ground_truth - no NLP or semantic
// matching, no new persisted field. See CIR_DISCLAIMER below for what this can and cannot claim.
// Design: relay/runs/2026-09-14T12-55-34-482Z/deliverable.md, Item 1.
//
// Two places where this repo's actual field shapes are narrower than the deliverable's own
// illustrative sketch (its Assumptions section delegates exact shapes to the implementer):
//
// - No round field exists on debate.posts[]/debate.replies[] - the whole proposal/debate/reply
//   sequence is one pass (chain.js runs it once, before the panel-review round loop even
//   starts), not repeated per round. "Same round or a later round" therefore collapses to plain
//   array precedence: every post in debate.posts[] precedes every reply in debate.replies[] by
//   construction, so no round-bounding logic is needed (or possible) to establish that ordering.
//   roundWithdrawn/roundContradicted in this module's case records are always null as a result -
//   there is no round number anywhere in this schema to put there, and inventing one would be
//   exactly the kind of placeholder field this file's own convention (see proposalMetricsOfRun
//   above, and spend.js/verdict-stats.js) avoids.
// - ground_truth[] entries as chain.js actually writes them ({tool, args, result}, from
//   verify.enabled's single pre-debate run) carry no proposalRef, AND are always emitted once,
//   before the whole request (including debate) even starts - there is no "later, mid-run"
//   ground_truth anywhere in the current schema. The ground_truth-contradiction channel below
//   reads an optional `proposalRef` field on each entry *if present*; on every real report.json
//   today it is absent, so that channel is dormant on real data until/unless a future chain.js
//   change tags ground_truth entries by position AND by when they were produced - out of this
//   item's scope (Item 2 confines changes to this file). It is fully exercised by this file's
//   own tests, which supply the optional field directly on fixture reports.
//   One consequence of "always precedes, by construction" worth being explicit about: for a
//   `withdraw`, the disqualifying position (the withdrawn id) and the converged-on position (a
//   different id, from the merge/replacement record) are different, so "did ground_truth already
//   contradict the WITHDRAWN id" and "does ground_truth now contradict the REPLACEMENT id" read
//   two different (albeit still real-data-dormant) entries and cannot collide. For an `amend`,
//   they are the SAME id (an amend doesn't change identity) - and since this schema's ground_truth
//   has no round tag to say "this entry is from after the amend, not before it", checking that id
//   against ground_truth would be self-contradictory: the same entry can't honestly mean both "it
//   already invalidated the pre-amend text" and "it now invalidates the post-amend text". Resolved
//   by not disqualifying an amend on a ground_truth hit at all (only withdraw gets that
//   disqualifier) - an amend is, by definition, the author already responding to known feedback,
//   so any ground_truth naming that id is read purely as evidence for whether the POST-amend
//   content still fails, which is exactly Item 1's own distinction between pre- and post-amend
//   state.
// - "the objecting post... was itself withdrawn or amended away" (objecting_post_not_live): a
//   debate post has no retract action anywhere in this schema (only a proposal's own author can
//   amend/withdraw the proposal itself, via debate.replies[]). Read instead as: the same author
//   later posted a different stance on the same target, superseding their own objection - the
//   one form of "an objection stopped standing" this schema can represent without a new field.
// - "the board's replacement/merge record" for a withdrawal's converged-on position: read from
//   the existing `merge_with` field a `stance: 'merge'` post already carries (roles.js's own
//   debate-post schema) - a merge post `on` the withdrawn id naming `merge_with` IS the
//   replacement record already produced by this pipeline; no new field is introduced to track it.

export const CIR_DISCLAIMER = 'This signal compares debate outcome to later same-run evidence '
  + 'only. It cannot prove the council underperforms (or outperforms) a single model; no '
  + 'single-model counterfactual is measured or implied.';

// A post is "live" against its target unless the same author later posted a different stance on
// the same target - array order is generation order (chain.js appends in that order), so a
// later index is a later post.
function isPostLive(post, posts) {
  const idx = posts.indexOf(post);
  return !posts.some((p, i) => i > idx && p.by === post.by && p.on === post.on && p.stance !== post.stance);
}

function replacementOf(posts, proposalRef) {
  const merge = posts.find(p => p.on === proposalRef && p.stance === 'merge' && p.merge_with);
  return merge ? merge.merge_with : null;
}

// Item 2's first named helper: does replies[]'s position change on `positionId` qualify (a
// preceding, still-live `object` post, no ground_truth hit against it), and if not, why. Reads
// only report.json fields, never throws on a report missing debate/ground_truth entirely.
export function isQualifyingPositionChange(report, positionId) {
  report = withoutCanary(report);
  const posts = Array.isArray(report?.debate?.posts) ? report.debate.posts : [];
  const replies = Array.isArray(report?.debate?.replies) ? report.debate.replies : [];
  const groundTruth = Array.isArray(report?.ground_truth) ? report.ground_truth : [];

  const reply = replies.find(r => r.id === positionId && (r.action === 'withdraw' || r.action === 'amend'));
  if (!reply) return { qualifies: false, reason: null }; // not a position change at all - not this helper's concern

  const precedingObjects = posts.filter(p => p.on === positionId && p.stance === 'object');
  if (!precedingObjects.length) return { qualifies: false, reason: 'no_preceding_object' };

  const liveObjects = precedingObjects.filter(p => isPostLive(p, posts));
  if (!liveObjects.length) return { qualifies: false, reason: 'objecting_post_not_live' };

  // Only withdraw, not amend - see the module comment above on why the same id's ground_truth
  // entry can't honestly serve as both "already contradicted the pre-change text" and "now
  // contradicts the post-amend text" in a schema with no round tag to tell them apart.
  if (reply.action === 'withdraw') {
    const gtHit = groundTruth.find(g => g && g.proposalRef === positionId);
    if (gtHit) return { qualifies: false, reason: 'ground_truth_preceded_withdrawal' };
  }

  return { qualifies: true, reason: null, reply };
}

// Item 2's second named helper: channel (a)/(b) matcher against one converged-on position.
// `groundTruth` entries only match via the optional, currently-never-real `proposalRef` field
// described above.
export function findContradictingEvidence(report, positionId) {
  report = withoutCanary(report);
  const groundTruth = Array.isArray(report?.ground_truth) ? report.ground_truth : [];
  const gtHit = groundTruth.find(g => g && g.proposalRef === positionId);
  if (gtHit) return { contradiction: 'ground_truth', roundContradicted: gtHit.round ?? null };

  const posts = Array.isArray(report?.debate?.posts) ? report.debate.posts : [];
  const replies = Array.isArray(report?.debate?.replies) ? report.debate.replies : [];
  const objectingPosts = posts.filter(p => p.on === positionId && p.stance === 'object' && isPostLive(p, posts));
  if (!objectingPosts.length) return null;
  // "never followed by a withdraw/corresponding amend reply to itself" - the converged
  // position's own reply record, if any, is that resolution.
  const convergedReply = replies.find(r => r.id === positionId);
  const retracted = convergedReply && (convergedReply.action === 'amend' || convergedReply.action === 'withdraw');
  if (retracted) return null;
  return { contradiction: 'unretracted_objection', roundContradicted: null };
}

// One report -> { count, cases[], excluded[] } per Item 1's output shape. Iterates
// debate.replies[] (not signoff[], which carries no posts/replies linkage) joined to
// debate.posts[] by proposal reference via the two helpers above, exactly as Item 2 specifies.
export function consensusInducedRegressionOfRun(report) {
  report = withoutCanary(report); // an author yielding to a canary is not a consensus regression
  const posts = Array.isArray(report?.debate?.posts) ? report.debate.posts : [];
  const replies = Array.isArray(report?.debate?.replies) ? report.debate.replies : [];

  const cases = [];
  const excluded = [];

  for (const reply of replies) {
    if (reply.action !== 'withdraw' && reply.action !== 'amend') continue; // not a position change
    const proposalRef = reply.id;
    if (!proposalRef) { excluded.push({ proposalRef: null, reason: 'unmatchable_position_reference' }); continue; }

    const { qualifies, reason } = isQualifyingPositionChange(report, proposalRef);
    if (!qualifies) { excluded.push({ proposalRef, reason }); continue; }

    // Qualifies. Find the converged-on position and check for later contradiction.
    const convergedRef = reply.action === 'amend' ? proposalRef : replacementOf(posts, proposalRef);
    if (!convergedRef) { excluded.push({ proposalRef, reason: 'unmatchable_position_reference' }); continue; }

    const contradiction = findContradictingEvidence(report, convergedRef);
    if (!contradiction) continue; // qualifying change, but nothing later contradicts it - not a case, not excluded either
    cases.push({
      proposalRef: convergedRef,
      roundWithdrawn: null, // no round field exists in this schema - see the module comment above
      contradiction: contradiction.contradiction,
      roundContradicted: contradiction.roundContradicted,
    });
  }

  return { count: cases.length, cases, excluded };
}

/**
 * Descriptive telemetry across every run in `runsDir` within the last `days`.
 * Never throws - a missing, empty or unreadable runs/ is not an error, and a
 * single corrupt or partial run folder is skipped (counted in `unreadable`
 * or excluded from a rate's denominator) rather than aborting the whole
 * report. This is descriptive telemetry only - see file header.
 */
export function metricsReport(runsDir, { days = 30, now = Date.now() } = {}) {
  const cutoff = now - days * 24 * 3600 * 1000;

  let ids = [];
  try {
    ids = existsSync(runsDir) ? readdirSync(runsDir) : [];
  } catch {
    return emptyReport(runsDir, days, cutoff, 'runs directory could not be read');
  }
  if (!ids.length) return emptyReport(runsDir, days, cutoff);

  let runsSeen = 0;
  let unreadable = 0;
  let totalProposals = 0, totalAmended = 0, totalWithdrawn = 0;
  let totalObjected = 0, totalObjectedFollowedThrough = 0;
  let runsWithHandoff = 0, runsWithToolsSection = 0, runsWithoutToolsSection = 0;
  let totalAcceptanceItems = 0, totalItemsNamingTool = 0;
  let totalAllocatorTargeted = 0, totalAllocatorEngaged = 0, totalAllocatorToolFired = 0;
  let totalCirCount = 0;
  const cirCases = [];
  const cirExcluded = [];

  for (const id of ids) {
    const when = runIdToDate(id);
    if (!when || when.getTime() < cutoff) continue;
    const dir = join(runsDir, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch { unreadable += 1; continue; }

    runsSeen += 1;
    const report = readJson(join(dir, 'report.json'));
    if (report) {
      const pm = proposalMetricsOfRun(report);
      totalProposals += pm.proposals;
      totalAmended += pm.amended;
      totalWithdrawn += pm.withdrawn;
      totalObjected += pm.objected;
      totalObjectedFollowedThrough += pm.objectedFollowedThrough;
      const am = allocatorMetricsOfRun(report);
      if (am) {
        totalAllocatorTargeted += am.targeted;
        totalAllocatorEngaged += am.engaged;
        totalAllocatorToolFired += am.toolFired;
      }
      const cir = consensusInducedRegressionOfRun(report);
      totalCirCount += cir.count;
      cir.cases.forEach(c => cirCases.push({ run: id, ...c }));
      cir.excluded.forEach(e => cirExcluded.push({ run: id, ...e }));
    }
    // report.json being absent (paused/incomplete run) or unparseable (corrupt
    // file) just means this run contributes nothing to the proposal-derived
    // rates - it is not treated as an error.

    let tc = null;
    try {
      tc = toolCallUsageOfRun(dir);
    } catch { tc = null; } // a malformed HANDOFF.md degrades to "no data", not a crash
    if (tc) {
      runsWithHandoff += 1;
      if (tc.hasToolsSection) {
        runsWithToolsSection += 1;
        totalAcceptanceItems += tc.items;
        totalItemsNamingTool += tc.itemsNamingTool;
      } else {
        runsWithoutToolsSection += 1;
      }
    }
  }

  const rate = (n, d) => (d > 0 ? n / d : null);

  return {
    label: 'descriptive telemetry',
    runsDir,
    days,
    since: new Date(cutoff),
    runsSeen,
    unreadable,
    amendmentRate: rate(totalAmended, totalProposals),
    withdrawalRate: rate(totalWithdrawn, totalProposals),
    objectionFollowThroughRate: rate(totalObjectedFollowedThrough, totalObjected),
    toolCallUsageRate: rate(totalItemsNamingTool, totalAcceptanceItems),
    // v7.3: the allocator's own required falsification watch (Review/
    // maintainers/proposals/v7x-gatekeeper-allocator-proposal.md's own falsifier condition) - a
    // high rubber-stamp rate here means the targeted extra rounds are pure
    // cost with no engagement gain, exactly the failure the proposal named.
    // Descriptive only, same as every other rate in this module: never a
    // claim that allocator rounds are worth their spend, only what happened.
    allocatorRubberStampRate: rate(totalAllocatorTargeted - totalAllocatorEngaged, totalAllocatorTargeted),
    // v7.2: a plain number at the top level, like every other figure here; the per-case
    // cases[]/excluded[] drill-down (each tagged with its run id for cross-run aggregation)
    // lives nested under this object rather than inline, so consensusInducedRegressionCount
    // stays a bare count a consumer can read without knowing the drill-down shape.
    consensusInducedRegressionCount: totalCirCount,
    consensusInducedRegression: { cases: cirCases, excluded: cirExcluded },
    counts: {
      proposals: totalProposals,
      amended: totalAmended,
      withdrawn: totalWithdrawn,
      objected: totalObjected,
      objectedFollowedThrough: totalObjectedFollowedThrough,
      runsWithHandoff,
      runsWithToolsSection,
      runsWithoutToolsSection,
      acceptanceItems: totalAcceptanceItems,
      acceptanceItemsNamingTool: totalItemsNamingTool,
      allocatorRoundsTargeted: totalAllocatorTargeted,
      allocatorRoundsEngaged: totalAllocatorEngaged,
      allocatorRoundsToolFired: totalAllocatorToolFired,
    },
    note: 'descriptive telemetry only - counts and rates derived from existing run logs. ' +
      'Not an evaluation, not a benchmark, not a baseline, and not a claim that the council ' +
      'produces higher-quality output than any other tool or person; nothing here has been ' +
      'measured against anything outside this harness\'s own run history. ' +
      'consensusInducedRegressionCount counts cases where debate pressure and later same-run ' +
      'evidence disagree; says nothing about single-model performance. ' + CIR_DISCLAIMER,
  };
}

function emptyReport(runsDir, days, cutoff, note) {
  return {
    label: 'descriptive telemetry',
    runsDir, days, since: new Date(cutoff),
    runsSeen: 0, unreadable: 0,
    amendmentRate: null, withdrawalRate: null, objectionFollowThroughRate: null, toolCallUsageRate: null,
    allocatorRubberStampRate: null,
    consensusInducedRegressionCount: 0,
    consensusInducedRegression: { cases: [], excluded: [] },
    counts: { proposals: 0, amended: 0, withdrawn: 0, objected: 0, objectedFollowedThrough: 0,
      runsWithHandoff: 0, runsWithToolsSection: 0, runsWithoutToolsSection: 0,
      acceptanceItems: 0, acceptanceItemsNamingTool: 0,
      allocatorRoundsTargeted: 0, allocatorRoundsEngaged: 0, allocatorRoundsToolFired: 0 },
    ...(note ? { note } : {}),
  };
}
