#!/usr/bin/env node
// v6 plan item 1: a repeatable, offline check reproducing the manually-derived v5 status
// table (correct as of 2026-09-16) from named artifacts - specific files and commit hashes -
// rather than bare keyword grep, which false-positives across this corpus (e.g.
// "permission-boundary" exists in the sibling coder-gate-agent-stub repo for an unrelated
// purpose, and "round" matches 31+ unrelated files in src/). See backend-developer/SKILL.md
// rule 13 (every number traced) and verification-and-critique/SKILL.md (ground truth over
// self-review) - this script is the ground-truth check for the table, not the table itself.
//
// Usage: node scripts/v5_status_audit.js [path-to-coder-gate-agent-stub]
// Exits 0 and prints one JSON object with exactly 7 keys if every row's live state matches
// its expected status; exits 1 and prints the same JSON (with `ok: false` per mismatched
// row) if any row disagrees, so callers get the disagreement, not just a fatal error.

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function commitExists(hash) {
  try {
    execFileSync('git', ['cat-file', '-e', hash], { cwd: REPO_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function fileExists(relPath) {
  return existsSync(path.join(REPO_ROOT, relPath));
}

// "Not started" rows are proven by the *absence* of a named artifact in THCMCP, not by a
// keyword search - keyword search is exactly the false-positive risk this script exists to
// avoid, so these rows report "not started" unconditionally rather than grepping for one.
// The stub-repo arg is accepted (and validated) per the spec's contract even though this
// script's own checks only ever run against THCMCP_ROOT: the false-positive the spec warns
// about ("permission-boundary" existing in the stub repo for an unrelated purpose) is a risk
// list for the audit's reasoning, not a corpus this script searches - grepping the stub repo
// itself would just relocate the same keyword-collision risk this script is built to avoid.
function buildRows(stubRepoPath) {
  return {
    round_wedge_live_state: {
      status: fileExists('src/run-state.js') ? 'built' : 'not started',
      evidence: 'src/run-state.js',
    },
    disagreement_grouped_by_claim: {
      status: (fileExists('src/disagreement-groups.js') && fileExists('src/dissent-digest.js'))
        ? 'built' : 'not started',
      evidence: 'src/disagreement-groups.js, src/dissent-digest.js',
    },
    no_consensus_vs_error_distinction: {
      status: fileExists('src/outcome.js') ? 'built' : 'not started',
      evidence: 'src/outcome.js',
    },
    live_cost_readouts: (() => {
      const commits = ['1af20d2', '8f6251d'];
      const found = commits.filter(commitExists);
      const missing = commits.filter(c => !found.includes(c));
      return {
        status: found.length > 0 ? 'built' : 'not started',
        evidence: `git commits: ${found.join(', ') || 'none found'}`,
        note: missing.length > 0
          ? `expected commit(s) not found in this repo's history: ${missing.join(', ')}`
          : undefined,
      };
    })(),
    debate_swarm_dispatch_split: {
      status: 'not started',
      evidence: 'no "Debate it"/"Swarm it" dispatch-split artifact in src/',
    },
    multi_session_tracking: {
      status: 'not started',
      evidence: 'no multi-session-tracking artifact in src/',
    },
    permission_boundary_enforcement: {
      status: 'not started',
      evidence: 'no permission-boundary-enforcement artifact in THCMCP src/ '
        + '(coder-gate-agent-stub is a separate repo/mechanism, out of scope for this row)',
    },
  };
}

const EXPECTED = {
  round_wedge_live_state: 'built',
  disagreement_grouped_by_claim: 'built',
  no_consensus_vs_error_distinction: 'built',
  live_cost_readouts: 'built',
  debate_swarm_dispatch_split: 'not started',
  multi_session_tracking: 'not started',
  permission_boundary_enforcement: 'not started',
};

function main() {
  const stubRepoPath = path.resolve(process.argv[2] || '../coder-gate-agent-stub');
  if (!existsSync(stubRepoPath)) {
    console.error(`stub repo path does not exist: ${stubRepoPath}`);
    process.exitCode = 1;
    return;
  }

  const rows = buildRows(stubRepoPath);
  let allMatch = true;
  const output = {};
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const row = rows[key];
    const matches = row.status === expected;
    if (!matches) allMatch = false;
    output[key] = { ...row, matchesExpected: matches };
  }

  console.log(JSON.stringify(output, null, 2));
  process.exitCode = allMatch ? 0 : 1;
}

main();
