// Central policy file (v7.x procurement-readiness plan, item 1). See docs/policy.md for the
// full field reference and rationale.
//
// Contract:
//   POLICY_FILENAME - the one documented, locked filename every caller resolves against its own
//     working directory. Never a CLI flag: the whole point of a policy file is that an operator
//     commits one file every invocation is bound to, not a flag a run can omit.
//   loadPolicy(workDir) -> { policy: object|null, error: string|null }
//     No file at the locked path -> { policy: null, error: null }: absent policy is today's
//     behavior, unchanged - this is the backward-compat case every acceptance test checks first.
//     A file that exists but fails to parse -> { policy: null, error: <message> }: malformed is
//     itself a refusal (the caller in cli.js treats a non-null error as fatal), never a silent
//     fallback to "no policy."
//   evaluatePolicy(policy, ctx) -> { ok: boolean, reasons: string[] }
//     Pure - no filesystem, no network, no provider call - so it is fully offline-testable.
//     `ctx`: { config, allSeats, worstCaseUsd, monthToDateUsd }. `reasons` is empty iff ok.
//
// Fail-closed by design: every check below refuses on anything it cannot verify (an
// undeclared seat region, an unparsed file) rather than treating "unknown" as "allowed". This is
// a procurement/compliance gate - a policy an operator cannot trust to actually block a
// non-compliant run is worse than no policy at all.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceOf, estimateChainRows } from './cost.js';
import { spendReport } from './spend.js';

export const POLICY_FILENAME = 'policy.json';

// Synthetic seats are never billed, never call a real vendor, and were never going to carry a
// real "provider" or "region" in the procurement sense this file exists for - exempted from
// every check below, the same precedent estimateChainRows/dry-run's unpriced-seat warning
// already sets for these two provider names.
const SYNTHETIC_PROVIDERS = new Set(['mock', 'external']);

export function POLICY_PATH(workDir) {
  return join(workDir, POLICY_FILENAME);
}

export function loadPolicy(workDir) {
  const path = POLICY_PATH(workDir);
  if (!existsSync(path)) return { policy: null, error: null };
  try {
    return { policy: JSON.parse(readFileSync(path, 'utf8')), error: null };
  } catch (err) {
    return { policy: null, error: err.message };
  }
}

// Reuses spendReport() exactly as the deliverable specifies - no new accounting, no ledger,
// same "derive from runs/*/report.json on disk" discipline as spend.js and metrics.js. Month
// boundary is the local calendar month, not a rolling 30-day window; spendReport's own `days`
// parameter is a rolling-window count, so this converts "since the 1st of this month" into the
// equivalent day count spendReport already understands, rather than adding a second code path
// for calendar-aware spend.
export function monthToDateUsd(runsDir, now = Date.now()) {
  const d = new Date(now);
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  // +1 second of slack so a run created in the same instant the month began is never excluded
  // by a zero-width window - spendReport's cutoff is strictly `when >= cutoff`.
  const days = (now - startOfMonth) / 86_400_000 + 1 / 86_400;
  return spendReport(runsDir, { days, now }).totalUsd;
}

function worstCaseRunUsd(config) {
  return estimateChainRows(config).reduce((s, r) => s + r.usd, 0);
}

/**
 * Everything evaluatePolicy needs, computed once by the caller (cli.js) so this stays a pure
 * function - no filesystem access here beyond what the caller already did for the run itself.
 */
export function buildPolicyContext(config, allSeats, runsDir, now = Date.now()) {
  return {
    config,
    allSeats,
    worstCaseUsd: worstCaseRunUsd(config),
    monthToDateUsd: monthToDateUsd(runsDir, now),
  };
}

export function evaluatePolicy(policy, { config, allSeats, worstCaseUsd, monthToDateUsd: mtdUsd }) {
  const reasons = [];
  const billedSeats = (allSeats || []).filter(s => s?.provider && !SYNTHETIC_PROVIDERS.has(s.provider));

  if (Array.isArray(policy.allowed_providers)) {
    for (const s of billedSeats) {
      if (!policy.allowed_providers.includes(s.provider)) {
        reasons.push(`allowed_providers: seat "${s.provider}/${s.model}" uses provider "${s.provider}", which is not in [${policy.allowed_providers.join(', ')}].`);
      }
    }
  }

  if (Array.isArray(policy.allowed_regions)) {
    for (const s of billedSeats) {
      if (!s.region) {
        reasons.push(`allowed_regions: seat "${s.provider}/${s.model}" declares no region, so it cannot be verified against [${policy.allowed_regions.join(', ')}].`);
      } else if (!policy.allowed_regions.includes(s.region)) {
        reasons.push(`allowed_regions: seat "${s.provider}/${s.model}" declares region "${s.region}", which is not in [${policy.allowed_regions.join(', ')}].`);
      }
    }
  }

  if (typeof policy.max_usd_per_run === 'number' && worstCaseUsd > policy.max_usd_per_run) {
    reasons.push(`max_usd_per_run: this chain's worst-case cost is $${worstCaseUsd.toFixed(4)}, over the $${policy.max_usd_per_run.toFixed(4)} limit.`);
  }

  if (typeof policy.max_usd_per_month === 'number' && mtdUsd > policy.max_usd_per_month) {
    reasons.push(`max_usd_per_month: $${mtdUsd.toFixed(4)} already spent this month, over the $${policy.max_usd_per_month.toFixed(4)} limit.`);
  }

  if (Array.isArray(policy.required_chain_tags) && policy.required_chain_tags.length) {
    const tags = Array.isArray(config.tags) ? config.tags : [];
    const missing = policy.required_chain_tags.filter(t => !tags.includes(t));
    if (missing.length) {
      reasons.push(`required_chain_tags: chain "${config.name}" is missing required tag(s): ${missing.join(', ')}.`);
    }
  }

  if (policy.refuse_unpriced_seats === true) {
    for (const s of billedSeats) {
      if (!priceOf(s.provider, s.model)) {
        reasons.push(`refuse_unpriced_seats: seat "${s.provider}/${s.model}" has no listed price, so its cost cannot be capped.`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
