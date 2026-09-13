// Peer-session dispatch (v3 plan §1, GLM-1 accepted, MISTRAL-1 cut - see PLAN.md's Scope
// ledger). Nine real runs were driven by handing an external stage to an already-running peer
// Claude Code session, not to a subagent - the harness had no record of this at all. A claim
// file, `runs/<id>/<stage>.claim.json`, is written by whoever intends to answer a stage, before
// it writes `<stage>.md`:
//
//   { "claimed_by": "cnc-harness-a7", "claimed_at": "2026-09-13T12:46:10.000Z" }
//
// `claimed_by` is a self-declared string, nothing more - this is BYOK, local-disk software with
// no identity infrastructure, and this module does not invent one. It buys staleness detection
// (a claim with no answer, older than a timeout) and contested-claim detection (two different
// claimants before an answer lands), never "who is right" - the harness cannot verify that, so
// it only makes the collision visible.
//
// File-based only, no subprocess spawning, no network call, no ledger: this module reads and
// writes exactly one JSON file per stage, inside the run folder it already belongs to.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours - operator-tunable via the options arg,
// matching how MAX_USD_PER_RUN is a plain value the caller resolves before calling in, not a
// second config file this module reads for itself.

function claimPath(dir, stage) {
  return join(dir, `${stage}.claim.json`);
}

function answerPath(dir, stage) {
  return join(dir, `${stage}.md`);
}

function readClaim(dir, stage) {
  const p = claimPath(dir, stage);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Write a claim for a stage, the whole mechanism for declaring one (same posture as
 * AMENDMENTS.md, §2: writing it is the entire path). Called by whoever intends to answer the
 * stage, before it writes `<stage>.md`.
 *
 * If a claim already exists for this stage, its `claimed_by` differs from this one, and no
 * answer has landed yet, this is a contested claim: the harness cannot decide which claimant is
 * "correct", so the original claim's `claimed_by`/`claimed_at` are kept as the record of first
 * claim and the new claimant is appended to `contested_by`, rather than silently overwritten -
 * the same posture as `duplicate_answer` below for the answer file itself. Otherwise (no
 * existing claim, the same claimant re-claiming, or the stage already has an answer - a fresh
 * work cycle) this simply (re)writes the claim.
 */
export function writeClaim(dir, stage, claimedBy, { now = () => new Date() } = {}) {
  const existing = readClaim(dir, stage);
  const hasAnswer = existsSync(answerPath(dir, stage));
  let claim;
  if (existing && existing.claimed_by !== claimedBy && !hasAnswer) {
    const contested_by = [...(existing.contested_by || []), claimedBy];
    claim = { ...existing, contested_by };
  } else {
    claim = { claimed_by: claimedBy, claimed_at: now().toISOString() };
  }
  writeFileSync(claimPath(dir, stage), JSON.stringify(claim, null, 2));
  return claim;
}

export function readClaimFor(dir, stage) {
  return readClaim(dir, stage);
}

/**
 * Staleness and contest detection for one stage's claim.
 *
 * - No claim at all: no warning.
 * - The claim was contested (see `writeClaim`) and no `<stage>.md` exists yet: `contested_claim`.
 * - A claim exists, no `<stage>.md` yet, and `claimed_at` is older than `timeoutMs`:
 *   `stalled_claim` - safe for a third party to pick the stage up.
 * - A claim exists and `<stage>.md` already exists: no warning (the claim did its job).
 *
 * Returns `null` (no warning) or `{ type, stage, ... }`.
 */
export function checkClaimStaleness(dir, stage, { now = () => new Date(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const claim = readClaim(dir, stage);
  if (!claim) return null;
  const hasAnswer = existsSync(answerPath(dir, stage));

  if (claim.contested_by?.length && !hasAnswer) {
    return { type: 'contested_claim', stage, claimed_by: claim.claimed_by, contested_by: claim.contested_by };
  }

  if (hasAnswer) return null;

  const claimedAt = Date.parse(claim.claimed_at);
  if (Number.isNaN(claimedAt)) return null; // an unparsable claimed_at is not this check's job to flag
  const ageMs = now().getTime() - claimedAt;
  if (ageMs > timeoutMs) {
    return { type: 'stalled_claim', stage, claimed_by: claim.claimed_by, claimed_at: claim.claimed_at, ageMs };
  }
  return null;
}
