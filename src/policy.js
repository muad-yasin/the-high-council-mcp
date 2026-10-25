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
//   evaluatePolicy(policy, ctx) -> { ok: boolean, reasons: string[], checks, warnings: string[] }  (warnings never refuse: 0.8.2 item 8c, the maximum over max_usd_per_run)
//     Pure - no filesystem, no network, no provider call - so it is fully offline-testable.
//     `ctx`: { config, allSeats, worstCaseUsd, maximumUsd?, monthToDateUsd, changeRequest?, signoff? }.
//     `reasons` is empty iff ok. Also returns `checks`: [{ capability, field, ok }], one per
//     check the policy configures (see POLICY_CAPABILITIES).
//
// Fail-closed by design: every check below refuses on anything it cannot verify (an
// undeclared seat region, an unparsed file) rather than treating "unknown" as "allowed". This is
// a procurement/compliance gate - a policy an operator cannot trust to actually block a
// non-compliant run is worse than no policy at all.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceOf, estimateChainRows } from './cost.js';
import { spendReport } from './spend.js';
import { outsideFences } from './quote-check.js';
import { terminalSafe } from './terminal-safe.js';

export const POLICY_FILENAME = 'policy.json';

// Synthetic seats are never billed, never call a real vendor, and were never going to carry a
// real "provider" or "region" in the procurement sense this file exists for - exempted from
// every check below, the same precedent estimateChainRows/dry-run's unpriced-seat warning
// already sets for these two provider names.
const SYNTHETIC_PROVIDERS = new Set(['mock', 'external']);

export function POLICY_PATH(workDir) {
  return join(workDir, POLICY_FILENAME);
}

// What a JSON value is, in words a person reads in a refusal ("the file holds a list").
const kindOf = v => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'string' ? 'a string' : typeof v === 'number' ? 'a number' : typeof v === 'boolean' ? 'true or false' : 'an object');

// 0.8.3 T1-10 (Batch 2 audit item 10): the top level must be a JSON object. A `null`, `0`, `""`, `false` or `[]` file used to load as
// "a policy" that configured nothing, or (the falsy ones) as no policy at all, because the callers test `if (policy)`: a file that exists is
// enforced or it refuses, never silently skipped. Callers treat a non-null `error` as a refusal (cli.js, gate-cli.js: COUNCIL-E005, whose
// text for this error starts at NOT_AN_OBJECT below, src/errors.js).
export const NOT_AN_OBJECT = 'the top level must be a JSON object';
export function loadPolicy(workDir) {
  const path = POLICY_PATH(workDir);
  if (!existsSync(path)) return { policy: null, error: null };
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { policy: null, error: `${NOT_AN_OBJECT}, but the file holds ${kindOf(value)}` };
    return { policy: value, error: null };
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
  return monthToDate(runsDir, now).usd;
}
// The same, with the count of run-folder figures that did not read (src/spend.js usdFigure): `usd` is then a FLOOR and the monthly limit cannot be checked against it; `unknownWhere` names them as
// `<run id>/<file>` (a run id and a file name are not run content), so a person can find and repair them.
export function monthToDate(runsDir, now = Date.now()) {
  const d = new Date(now);
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  // +1 second of slack so a run created in the same instant the month began is never excluded
  // by a zero-width window - spendReport's cutoff is strictly `when >= cutoff`.
  const days = (now - startOfMonth) / 86_400_000 + 1 / 86_400;
  const r = spendReport(runsDir, { days, now });
  return { usd: r.totalUsd, unknownFigures: r.unknownFigures, unknownWhere: r.runs.flatMap(x => (x.unknownFiles ?? []).map(f => `${x.id}/${f}`)) };
}

// The EXPECTED figure of the dry run (typical review output), as it always was: a policy REFUSES on this one. The MAXIMUM (0.8.2 item 8c, estimateChainRows with maximum: true) only WARNS (owner, 7 Oct 2026: "make it a warning, not a refusal").
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
    maximumUsd: estimateChainRows(config, { maximum: true }).reduce((s, r) => s + r.usd, 0),
    ...(() => { const m = monthToDate(runsDir, now); return { monthToDateUsd: m.usd, monthUnknownFigures: m.unknownFigures, monthUnknownWhere: m.unknownWhere }; })(),
  };
}

// MLLM Coder v5 item 5: each policy.json field named as the capability it restricts, so a report
// (or an operator reading one) sees "data-residency" rather than a raw field name. One table, the
// only place these names live. test/policy-capabilities.test.js fails if a check in
// evaluatePolicy has no entry here, so a new check cannot ship unnamed.
export const POLICY_CAPABILITIES = Object.freeze({
  allowed_providers: 'provider-choice',
  allowed_regions: 'data-residency',
  max_usd_per_run: 'run-spend-limit',
  max_usd_per_month: 'monthly-spend-limit',
  required_chain_tags: 'chain-classification',
  refuse_unpriced_seats: 'priced-seats-only',
  required_signoff_paths: 'path-signoff',
});

// Which checks this policy actually configures - the same conditions each check below uses to
// decide whether it runs at all. A check that is not configured is not listed: a report must never
// claim a restriction was enforced when it was not.
function configuredFields(policy) {
  const set = {
    allowed_providers: Array.isArray(policy.allowed_providers),
    allowed_regions: Array.isArray(policy.allowed_regions),
    max_usd_per_run: typeof policy.max_usd_per_run === 'number',
    max_usd_per_month: typeof policy.max_usd_per_month === 'number',
    required_chain_tags: Array.isArray(policy.required_chain_tags) && policy.required_chain_tags.length > 0,
    refuse_unpriced_seats: policy.refuse_unpriced_seats === true,
    required_signoff_paths: Array.isArray(policy.required_signoff_paths) && policy.required_signoff_paths.length > 0,
  };
  return Object.keys(POLICY_CAPABILITIES).filter(field => set[field]);
}

// 0.8.3 T1-10: what is wrong with the policy file itself, one sentence per problem, before any check runs. Fail closed: a key that is not a
// policy key would enforce nothing (a misspelt `max_usd_per_runs` let any spend through), and a value of the wrong type is skipped by the check
// that reads it (`"allowed_providers": "openrouter"` admitted every provider). A top-level key that starts with "$" or "_" is metadata
// (`$schema`, `_comment`) and is ignored: a misspelt policy key never starts with either (C&C ruling 13 Oct 2026). `advice_sensitivity_floor` is a
// key whose VALUE src/advice-tier.js reads (documented: a value that is not one of the three levels is read as confidential), so only the key is checked.
// Key names are project-writable text: shown JSON-quoted, control characters removed, cut at 60 characters.
// one cleaning for any name out of a project-writable folder that goes into a refusal: terminal-safe (controls, escapes, bidi marks), no new line or tab, cut at 60 characters
const cleanName = k => terminalSafe(k).replace(/[\n\t]/g, '').slice(0, 60);
const shown = k => JSON.stringify(cleanName(k));
const isStrings = v => Array.isArray(v) && v.every(x => typeof x === 'string');
const FIELD_RULES = {
  allowed_providers: [isStrings, 'a list of strings'],
  allowed_regions: [isStrings, 'a list of strings'],
  required_chain_tags: [isStrings, 'a list of strings'],
  required_signoff_paths: [Array.isArray, 'a list of glob strings'],   // its entries are checked just below with the sentence checkRequiredSignoffPaths has always used
  max_usd_per_run: [v => typeof v === 'number' && Number.isFinite(v) && v >= 0, 'a number of dollars, zero or more'],
  max_usd_per_month: [v => typeof v === 'number' && Number.isFinite(v) && v >= 0, 'a number of dollars, zero or more'],
  refuse_unpriced_seats: [v => typeof v === 'boolean', 'true or false'],
};
export function policyProblems(policy) {
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) return [`policy.json: ${NOT_AN_OBJECT}, but it holds ${kindOf(policy)}.`];
  const known = [...Object.keys(POLICY_CAPABILITIES), 'advice_sensitivity_floor'];
  const out = [];
  for (const [key, value] of Object.entries(policy)) {
    if (key.startsWith('$') || key.startsWith('_')) continue;
    if (key === 'advice_sensitivity_floor') continue;
    const rule = FIELD_RULES[key];
    if (!rule) out.push(`${shown(key)} is not a policy key, so it would enforce nothing. The keys are: ${known.join(', ')}. (A key that starts with "$" or "_" is ignored.)`);
    else if (key === 'required_signoff_paths' && Array.isArray(value) && value.some(p => typeof p !== 'string' || p.trim() === '')) out.push(`required_signoff_paths: every entry must be a non-empty glob string; got ${JSON.stringify(value.filter(p => typeof p !== 'string' || p.trim() === ''))}.`);   // the same sentence checkRequiredSignoffPaths gives a bad entry, now also when no change request is in play
    else if (!rule[0](value)) out.push(`${key}: must be ${rule[1]}; the file has ${typeof value === 'number' ? (Number.isFinite(value) ? 'a negative number' : 'a number that is not finite') : kindOf(value)}, so this rule would enforce nothing.`);
  }
  return out;
}

export function evaluatePolicy(policy, ctx) {
  const refused = policyProblems(policy);
  if (refused.length) return { ok: false, reasons: refused, checks: [], warnings: [] };   // a file that does not say what it enforces enforces nothing: refused, no other check runs
  const { config, allSeats, worstCaseUsd, maximumUsd, monthToDateUsd: mtdUsd } = ctx;
  const reasons = [];
  const warnings = [];
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
    // 0.8.2 item 1 (owner via C&C, 7 Oct 2026: "Terminal rule only, no cap change"): the advice send path now hands in the chain's expected cost as `worstCaseUsd` (the CLI's own figure) and the call's ceiling (at least the CLI's maximum) as `maximumUsd`, and says so (`figure: 'call'`).
    reasons.push(`max_usd_per_run: ${ctx.figure === 'call' ? `the expected cost of this call's chain (the first figure --dry-run prints) is $${worstCaseUsd.toFixed(4)}${Number.isFinite(maximumUsd) ? ` and the most this call can spend (its ceiling) $${maximumUsd.toFixed(4)}` : ''}` : `this chain's expected cost (the first figure --dry-run prints) is $${worstCaseUsd.toFixed(4)}${Number.isFinite(maximumUsd) ? ` and its maximum $${maximumUsd.toFixed(4)}` : ''}`}, over the $${policy.max_usd_per_run.toFixed(4)} limit.`);
  } else if (typeof policy.max_usd_per_run === 'number' && Number.isFinite(maximumUsd) && maximumUsd > policy.max_usd_per_run) {
    // Warns, never refuses (owner, 7 Oct 2026): the expected cost fits; a run in which every call writes its seat's whole output allowance could go past the limit. The spend cap, not this policy, is what stops it.
    warnings.push(ctx.figure === 'call'
      ? `max_usd_per_run: the expected cost of this call's chain (the first figure --dry-run prints) is $${worstCaseUsd.toFixed(4)}, within the $${policy.max_usd_per_run.toFixed(4)} limit, but the most this call can spend (its ceiling) is $${maximumUsd.toFixed(4)}, over it. It is sent only if you approve it, and its ceiling stops it at $${maximumUsd.toFixed(4)}.`
      : `max_usd_per_run: this chain's expected cost is $${worstCaseUsd.toFixed(4)}, within the $${policy.max_usd_per_run.toFixed(4)} limit, but its upper estimate (every call at its whole output allowance; the UPPER ESTIMATE figure --dry-run prints) is $${maximumUsd.toFixed(4)}, over it. The run starts; only its spend cap stops a run that goes past the limit.`);
  }

  if (typeof policy.max_usd_per_month === 'number' && mtdUsd > policy.max_usd_per_month) {
    reasons.push(`max_usd_per_month: $${mtdUsd.toFixed(4)} already spent this month, over the $${policy.max_usd_per_month.toFixed(4)} limit.`);
  } else if (typeof policy.max_usd_per_month === 'number' && ctx.monthUnknownFigures > 0) {
    // 0.8.3 (Builder D): the total is a floor (src/spend.js usdFigure): a figure that is there and is not a number of dollars was left out. A limit that cannot be checked is refused, not passed (fails closed).
    const where = ctx.monthUnknownWhere ?? [];
    // the run id is checked by the run-name rule; the file name after it is project-writable text (cleanName)
    const named = where.slice(0, 5).map(w => { const [id, ...file] = w.split('/'); return `${id}/${cleanName(file.join('/'))}`; }).join(', ');
    const more = where.length > 5 ? `, and ${where.length - 5} more` : '';
    const n = ctx.monthUnknownFigures;
    reasons.push(`max_usd_per_month: this month's spend cannot be totalled because ${n} figure${n === 1 ? '' : 's'} in the run folders could not be read as a number of dollars${named ? `: ${named}${more}` : ''}. The limit cannot be checked until ${n === 1 ? 'that file holds' : 'every file named here holds'} a readable number of dollars.`);
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

  // v5 item 5: `checks` is derived from `reasons`, never tracked separately - every reason already
  // starts with its field name, so a check failed iff one of its reasons is present.
  const checks = configuredFields(policy).map(field => ({
    capability: POLICY_CAPABILITIES[field],
    field,
    ok: !reasons.some(r => r.startsWith(`${field}:`)),
  }));
  return { ok: reasons.length === 0, reasons, checks, warnings };
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
  // Case-insensitive on purpose: src/Auth/session.js is the same file as src/auth/session.js on a
  // case-insensitive filesystem, and this check fails closed (bug audit 2026-09-23, GuardLayer #9).
  const matched = patterns.find(p => globMatch((normalizeRelPath(p) ?? p).toLowerCase(), path.toLowerCase()));
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
//
// Bug-audit fix, 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #9): only the exact form
// `target_file: path` at column 0 was read, so a quoted value, a markdown bullet or bold key, or a
// trailing comment made the field vanish or keep its quotes - and required_signoff_paths let the
// change through unsigned. The key may now sit behind a bullet and/or bold/italic markers; the
// value loses one pair of surrounding quotes or backticks and a trailing " # comment". A mention
// in the middle of a sentence still does not count.
const FIELD_LINE = /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*|__|\*|_)?(target_file|signoff)(?:\*\*|__|\*|_)?[ \t]*:(?:\*\*|__|\*|_)?[ \t]*(.*?)[ \t]*$/i;
function cleanFieldValue(v) {
  let out = v.replace(/[ \t]+#.*$/, '').trim();
  const q = out.match(/^(["'`])(.*)\1$/);
  if (q) out = q[2].trim();
  return out;
}
//
// Hostile-fence corpus, 0.7.8: only the task's own prose counts, never a fenced block. A fenced
// file with a `signoff: <name>` line used to satisfy required_signoff_paths, and one with an
// earlier `target_file:` line hid the real one (first occurrence wins).
export function parseChangeRequestFields(text) {
  const fields = {};
  for (const line of outsideFences(String(text ?? '')).split(/\r?\n/)) {
    const m = line.match(FIELD_LINE);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!(key in fields)) fields[key] = cleanFieldValue(m[2]);
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
