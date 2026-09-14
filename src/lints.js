// v7.x: deterministic plan lints (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md item 2).
// Gated on config.lints.enabled - absent/false keeps every existing chain's output
// byte-identical: no lint stage runs, report.json carries no `lints[]` key. When enabled, this
// runs BEFORE any critic sees the draft (src/chain.js calls it right after the first build,
// ahead of the critic/revise loop), so a $0 deterministic pass catches what it can before a paid
// critic round is spent on something it would have already caught. A lint failure never blocks
// the run - it's informational, written to report.json.lints[] and WARNINGS.md by the caller.
//
// Contract
// --------
// runLints(reportLike) -> Array<{ id: string, message: string }>
//   reportLike: {
//     deliverable: string,                          // the draft/plan text
//     proposals?: Array<{ id: string }>,             // from config.proposals, if that stage ran
//     forks?: Array<{ issue: string, resolution?: string }>,  // raised by criteria/skeleton, see below
//   }
//   Four pure, no-I/O, no-model-call checks, each also exported individually so it's directly
//   testable over a plain fixture object with no seats or run folder involved:
//
//   checkScopeLedger(deliverable, proposals) - every proposals[].id must appear in the
//     deliverable's "Scope ledger" section (the same section config.proposals mode already
//     requires the builder to write - src/roles.js's proposer/build prompts, src/preflight.js's
//     requiredDeliverableSections). An id the ledger never mentions is unaccounted for, exactly
//     the condition scoreProposals() in chain.js already detects post-hoc for the human-facing
//     scoreboard; this check exists to catch it before a critic round is spent on the same plan.
//
//   checkBareNumbers(deliverable) - every bare number in the deliverable's prose must carry
//     either a stated derivation on the same line (an arithmetic operator, or a word like "from"/
//     "because"/"based on"/"derived") or the literal word "placeholder" nearby. Deliberately
//     excludes numbers that are structural, not claims: markdown headings, list/ordinal markers
//     at the start of a line, and four-digit years - a heuristic, not a guarantee (same documented
//     posture as src/preflight.js's TRIGGER_KEYWORDS check: known to miss a rephrasing, not a bug).
//
//   checkForks(forks) - every fork raised by the criteria/skeleton stage needs a non-empty
//     recorded `resolution`. This module does not itself invent a way to detect a "fork" in free
//     text (that would be a second, competing heuristic on top of checkBareNumbers' one) - it
//     trusts whatever the caller passes as `forks`, letting src/chain.js decide how a fork gets
//     recorded (currently: none of today's stages produce one, so `forks` is `[]` by default and
//     this check is vacuously clean until a future stage starts raising them).
//
//   checkAcceptanceTests(deliverable) - every "Acceptance test:" line must name something beyond
//     a bare placeholder (`<...>`, empty, or only whitespace after the colon). This build's
//     version deliberately does not try to verify the named command actually runs.
//
// Each check returns Array<{ id, message }> with a distinct `id` per failure so report.json.lints
// stays machine-filterable (`ledger_id`, `bare_number`, `unresolved_fork`, `bad_acceptance_test`).

const SCOPE_LEDGER_HEADING = /^#{1,6}\s*Scope ledger\s*$/im;

/**
 * @param {string} deliverable
 * @param {Array<{id: string}>} [proposals]
 */
export function checkScopeLedger(deliverable = '', proposals = []) {
  if (!Array.isArray(proposals) || !proposals.length) return [];
  const headingMatch = deliverable.match(SCOPE_LEDGER_HEADING);
  const ledgerText = headingMatch ? deliverable.slice(headingMatch.index) : '';
  const findings = [];
  for (const p of proposals) {
    if (!p || !p.id) continue;
    const re = new RegExp(`(^|[\\s*_\`-])${p.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s*_\`:-]|$)`, 'm');
    if (!headingMatch || !re.test(ledgerText)) {
      findings.push({ id: 'ledger_id', message: `proposal "${p.id}" does not appear in the deliverable's "Scope ledger" section${headingMatch ? '' : ' (no "Scope ledger" section found at all)'}` });
    }
  }
  return findings;
}

const DERIVATION_HINT = /[=×*/+-]|\bfrom\b|\bbecause\b|\bbased on\b|\bderived\b|\bplaceholder\b/i;
// Bare integer/decimal, not part of a larger word (so "v7" or "GPT-4" aren't flagged) and not
// immediately preceded by '#' (a markdown heading marker or an id like "#3").
const NUMBER_TOKEN = /(?<![\w#.])\d+(?:\.\d+)?(?!\w)/g;
const YEAR = /^(19|20)\d{2}$/;

export function checkBareNumbers(deliverable = '') {
  const findings = [];
  const lines = deliverable.split('\n');
  for (const line of lines) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) continue; // markdown heading
    if (/^\s*(\d+[.)]|[-*+]\s)/.test(line)) {
      // list/ordinal marker at line start - still check the REST of the line for bare numbers,
      // just don't flag the marker itself.
    }
    const stripped = line.replace(/^\s*\d+[.)]\s*/, '');
    const matches = stripped.match(NUMBER_TOKEN);
    if (!matches) continue;
    for (const m of matches) {
      if (YEAR.test(m)) continue;
      if (DERIVATION_HINT.test(line)) continue;
      findings.push({ id: 'bare_number', message: `bare number "${m}" has no stated derivation and no "placeholder" marker nearby: "${line.trim().slice(0, 160)}"` });
    }
  }
  return findings;
}

/**
 * @param {Array<{issue: string, resolution?: string}>} [forks]
 */
export function checkForks(forks = []) {
  if (!Array.isArray(forks)) return [];
  const findings = [];
  for (const f of forks) {
    if (!f || typeof f.resolution !== 'string' || !f.resolution.trim()) {
      findings.push({ id: 'unresolved_fork', message: `fork "${f?.issue || '(unnamed)'}" raised by the criteria/skeleton stage has no recorded resolution` });
    }
  }
  return findings;
}

const ACCEPTANCE_LINE = /^.*Acceptance test:\s*(.*)$/gim;
const BARE_PLACEHOLDER = /^\s*(<[^>]*>)?\s*$/;

export function checkAcceptanceTests(deliverable = '') {
  const findings = [];
  for (const m of deliverable.matchAll(ACCEPTANCE_LINE)) {
    const value = m[1] || '';
    if (BARE_PLACEHOLDER.test(value)) {
      findings.push({ id: 'bad_acceptance_test', message: `"Acceptance test:" line names no real command: "${m[0].trim().slice(0, 160)}"` });
    }
  }
  return findings;
}

/**
 * @param {{deliverable?: string, proposals?: Array, forks?: Array}} reportLike
 * @returns {Array<{id: string, message: string}>}
 */
export function runLints({ deliverable = '', proposals = [], forks = [] } = {}) {
  return [
    ...checkScopeLedger(deliverable, proposals),
    ...checkBareNumbers(deliverable),
    ...checkForks(forks),
    ...checkAcceptanceTests(deliverable),
  ];
}
