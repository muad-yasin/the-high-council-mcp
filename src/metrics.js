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
// Four descriptive figures, each a plain rate or count:
//   - amendment rate: proposals marked amended / total proposals
//   - withdrawal rate: proposals marked withdrawn / total proposals
//   - objection-follow-through rate: of proposals that drew at least one
//     "object" post in debate, how many were later amended or withdrawn
//     (as opposed to standing unchanged after being objected to)
//   - tool-call usage: of HANDOFF.md acceptance-test items written against
//     a task that declared an "## Available tools" section, how many name
//     one of those tools by its exact listed name (per roles.js's
//     HANDOFF_SYSTEM convention) rather than a manual/generic check
//
// Privacy: chain name, counts and rates only. Never task content, proposal
// text, debate text or HANDOFF prose beyond the tool names it lists.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runIdToDate } from './spend.js';

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

  const posts = Array.isArray(report?.debate?.posts) ? report.debate.posts : [];
  const replies = Array.isArray(report?.debate?.replies) ? report.debate.replies : [];
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
    // v7x-gatekeeper-allocator-proposal.md's own falsifier condition) - a
    // high rubber-stamp rate here means the targeted extra rounds are pure
    // cost with no engagement gain, exactly the failure the proposal named.
    // Descriptive only, same as every other rate in this module: never a
    // claim that allocator rounds are worth their spend, only what happened.
    allocatorRubberStampRate: rate(totalAllocatorTargeted - totalAllocatorEngaged, totalAllocatorTargeted),
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
      'measured against anything outside this harness\'s own run history.',
  };
}

function emptyReport(runsDir, days, cutoff, note) {
  return {
    label: 'descriptive telemetry',
    runsDir, days, since: new Date(cutoff),
    runsSeen: 0, unreadable: 0,
    amendmentRate: null, withdrawalRate: null, objectionFollowThroughRate: null, toolCallUsageRate: null,
    allocatorRubberStampRate: null,
    counts: { proposals: 0, amended: 0, withdrawn: 0, objected: 0, objectedFollowedThrough: 0,
      runsWithHandoff: 0, runsWithToolsSection: 0, runsWithoutToolsSection: 0,
      acceptanceItems: 0, acceptanceItemsNamingTool: 0,
      allocatorRoundsTargeted: 0, allocatorRoundsEngaged: 0, allocatorRoundsToolFired: 0 },
    ...(note ? { note } : {}),
  };
}
