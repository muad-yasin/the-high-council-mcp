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
//     `ctx`: { config, allSeats, worstCaseUsd, monthToDateUsd, changeRequest?, signoff? }.
//     `reasons` is empty iff ok.
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

export function evaluatePolicy(policy, ctx) {
  const { config, allSeats, worstCaseUsd, monthToDateUsd: mtdUsd } = ctx;
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

  reasons.push(...checkRequiredSignoffPaths(policy, ctx));

  return { ok: reasons.length === 0, reasons };
}

// MLLM Coder v3 item 4 (relay/runs/2026-09-14T21-38-45-696Z/revise-1.md): a change request whose
// target_file matches a `required_signoff_paths` glob needs a named signoff before it may run.
//   ctx.changeRequest - the coder-gate change request ({ target_file, ... }), or absent for a
//     chain that isn't changing a file. Absent = nothing path-sensitive to gate, so it passes.
//   ctx.signoff - a non-empty string naming who signed off. Anything else counts as no signoff.
// Returns reason strings (empty = passes). Absent key = no reasons, exactly as before this check.
// Fail closed like every check above: a change request without a usable target_file, or a
// target_file that escapes the repo root (absolute, `..`), cannot be matched against
// repo-relative patterns, so it is refused rather than let through as "matched nothing".
export function checkRequiredSignoffPaths(policy, ctx = {}) {
  const patterns = policy.required_signoff_paths;
  if (!Array.isArray(patterns) || patterns.length === 0) return [];
  const cr = ctx.changeRequest;
  if (!cr) return [];
  const bad = patterns.filter(p => typeof p !== 'string' || p.trim() === '');
  if (bad.length) return [`required_signoff_paths: every entry must be a non-empty glob string; got ${JSON.stringify(bad)}.`];
  if (typeof cr.target_file !== 'string' || cr.target_file.trim() === '') {
    return ['required_signoff_paths: the change request has no target_file, so it cannot be checked against the signoff paths.'];
  }
  const path = normalizeRelPath(cr.target_file);
  if (path === null) {
    return [`required_signoff_paths: target_file "${cr.target_file}" is not a repo-relative path, so it cannot be checked against the signoff paths.`];
  }
  const matched = patterns.find(p => globMatch(normalizeRelPath(p) ?? p, path));
  if (!matched) return [];
  if (typeof ctx.signoff === 'string' && ctx.signoff.trim() !== '') return [];
  return [`required_signoff_paths: target_file "${path}" matches "${matched}", which requires a signoff, and none was given.`];
}

// MLLM Coder v4 item 4: the two change-request fields the policy gate needs, read from a task
// file's own `key: value` lines (the change-request template's format - see
// test/coder-gate-v1.test.js's CHANGE_REQUEST_TEMPLATE). Only lines that start with the key count,
// so prose that mentions "target_file:" mid-sentence is ignored; the first occurrence wins. A key
// that is present with an empty value comes back as '', never undefined, so the signoff-path check
// fails closed on it ("no target_file") instead of treating the task as not-a-change-request.
// Returns { target_file?, signoff? } - a key is absent iff its line is absent.
export function parseChangeRequestFields(text) {
  const fields = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^(target_file|signoff):[ \t]*(.*?)[ \t]*$/);
    if (m && !(m[1] in fields)) fields[m[1]] = m[2];
  }
  return fields;
}

// Forward slashes, no leading "./", no empty or "." segments. null for anything that isn't a
// repo-relative path (absolute, drive-lettered, or climbing out with "..").
function normalizeRelPath(p) {
  const parts = p.trim().replace(/\\/g, '/').split('/').filter(s => s !== '' && s !== '.');
  if (/^([A-Za-z]:)?\//.test(p.trim().replace(/\\/g, '/')) || parts.includes('..')) return null;
  return parts.join('/');
}

// Local glob, no dependency ($0/offline constraint): `*` matches within one path segment, `**`
// matches any number of whole segments (including none). Everything else is literal.
export function globMatch(pattern, path) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      const before = i === 0 || pattern[i - 1] === '/';
      const after = pattern[i + 2] === '/' || i + 2 === pattern.length;
      if (before && after) {
        // "**/" -> zero or more whole segments; a trailing "**" (as in "src/auth/**") -> anything.
        if (pattern[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 2; } else { re += '.*'; i += 1; }
        continue;
      }
      re += '[^/]*'; i += 1; // "a**b" inside a segment is just a single-segment wildcard
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`).test(path);
}
