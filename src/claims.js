// v7.x: claim schema with typed evidence (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md
// item 1). Gated on config.claims.enabled - absent/false keeps every existing chain's output
// byte-identical: no claim-extraction stage runs, report.json carries no `claims[]` field, and
// no critic-objection shape changes. This module owns the extraction call shape and the
// validator; src/chain.js only decides *when* to call it (one new optional stage, same pattern
// as config.verify/config.allocator).
//
// Contract
// --------
// A "claim" is how one of this run's own objections (the union of a critic panel's `failures[]`,
// already computed by chain.js before this stage ever runs) gets restated with typed evidence
// attached, rather than staying free text:
//
//   { claim: string, evidence: { kind: "quote" | "tool" | "reasoning", quote?: string, result_ref?: string } }
//
// extractionUser(...) / CLAIM_EXTRACTION_SYSTEM (src/roles.js) ask one seat to restate each
// objection this way. extractClaims() below makes that one call and returns whatever the seat's
// reply parses to (never throws - an unreadable reply yields an empty claims list, same posture
// as every other optional stage in chain.js).
//
// validateEvidence(evidenceClaim, { draft, groundTruth }) checks one claim's evidence against
// what can actually be checked offline, no second model call:
//   - kind "quote": `evidence.quote` must be a literal substring of `draft` (the deliverable the
//     objection was raised against). No fuzzy match - a quote that doesn't appear verbatim is not
//     evidence, it's a paraphrase wearing evidence's shape.
//   - kind "tool": `evidence.result_ref` must name a real entry in `groundTruth`, the array
//     v7 item 1's tool-grounded verification produces (src/chain.js's `runVerification()` /
//     `config.verify.enabled`; each entry is `{ tool, args, result }`). A ref matches either the
//     bare tool name ("grep_repo") when it's unambiguous, or "<tool>:<index>" (0-based, in
//     invocation order) when more than one ground-truth entry used the same tool. No
//     `config.verify.enabled` run at all means `groundTruth` is `undefined` - every "tool" claim
//     is then unverifiable and dropped, not silently trusted.
//   - kind "reasoning": always valid. There is nothing external to check - it's the critic's own
//     inference, not a claim about the draft or a tool result, and this schema doesn't pretend
//     otherwise.
//   - a missing `evidence`, a missing/unknown `kind`, or (for "quote"/"tool") a missing value for
//     the field that kind requires, is invalid.
//
// dropInvalidClaims(rawClaims, { draft, groundTruth }) runs validateEvidence over a whole list and
// splits it: `claims` (validated, kept) and `warnings` (one line per dropped claim, ready to
// append to a run's WARNINGS.md exactly the way pre_flight/cache_stale warnings already are in
// src/cli.js - this module never touches the filesystem itself). A dropped claim is dropped, not
// crashed: one bad quote must not lose every other claim in the same reply.

/**
 * @param {string} refText
 * @param {Array<{tool: string, args?: object, result?: object}>|undefined} groundTruth
 * @returns {boolean}
 */
export function toolRefExists(refText, groundTruth) {
  if (!Array.isArray(groundTruth) || !groundTruth.length) return false;
  if (typeof refText !== 'string' || !refText) return false;
  const indexed = refText.match(/^(.+):(\d+)$/);
  if (indexed) {
    const [, tool, idxStr] = indexed;
    const idx = Number(idxStr);
    const entriesForTool = groundTruth.filter(g => g.tool === tool);
    return idx >= 0 && idx < entriesForTool.length;
  }
  return groundTruth.some(g => g.tool === refText);
}

/**
 * Validates one claim's evidence. Returns { ok: true } or { ok: false, reason }. Pure, no I/O.
 * @param {{claim?: string, evidence?: {kind?: string, quote?: string, result_ref?: string}}} rawClaim
 * @param {{draft?: string, groundTruth?: Array}} ctx
 */
export function validateEvidence(rawClaim, { draft = '', groundTruth } = {}) {
  if (!rawClaim || typeof rawClaim.claim !== 'string' || !rawClaim.claim.trim()) {
    return { ok: false, reason: 'missing or empty "claim" text' };
  }
  const evidence = rawClaim.evidence;
  if (!evidence || typeof evidence !== 'object') {
    return { ok: false, reason: 'missing "evidence"' };
  }
  const kind = evidence.kind;
  if (kind === 'quote') {
    if (typeof evidence.quote !== 'string' || !evidence.quote) {
      return { ok: false, reason: 'evidence.kind is "quote" but evidence.quote is missing' };
    }
    if (!draft.includes(evidence.quote)) {
      return { ok: false, reason: `evidence.quote does not appear verbatim in the draft: "${evidence.quote.slice(0, 120)}"` };
    }
    return { ok: true };
  }
  if (kind === 'tool') {
    if (typeof evidence.result_ref !== 'string' || !evidence.result_ref) {
      return { ok: false, reason: 'evidence.kind is "tool" but evidence.result_ref is missing' };
    }
    if (!toolRefExists(evidence.result_ref, groundTruth)) {
      return { ok: false, reason: `evidence.result_ref "${evidence.result_ref}" does not match any tool-verification result on this run` };
    }
    return { ok: true };
  }
  if (kind === 'reasoning') return { ok: true };
  return { ok: false, reason: `unknown evidence.kind "${kind}"` };
}

/**
 * Validates a whole list of raw claims. Never throws - a claim that fails validation is dropped,
 * not the whole batch. Returns { claims, warnings } - `warnings` are plain strings, ready to be
 * appended to WARNINGS.md by the caller (this module writes nothing to disk).
 * @param {Array} rawClaims
 * @param {{draft?: string, groundTruth?: Array}} ctx
 */
export function dropInvalidClaims(rawClaims, ctx = {}) {
  const claims = [];
  const warnings = [];
  for (const raw of Array.isArray(rawClaims) ? rawClaims : []) {
    const verdict = validateEvidence(raw, ctx);
    if (verdict.ok) claims.push(raw);
    else warnings.push(`claim dropped: ${verdict.reason} (claim text: "${String(raw?.claim ?? '').slice(0, 160)}")`);
  }
  return { claims, warnings };
}

/**
 * The extraction call itself: one seat, asked to restate `failures` (the union of this run's
 * critic objections) as typed claims. Never throws - an unreadable reply yields no claims, the
 * same degrade-not-crash posture every other optional stage in chain.js already has.
 * @param {object} seat
 * @param {{request: string, draft: string, failures: Array}} args
 * @param {{invoke: Function, parseJson: Function, roles: object, log?: Function, label?: string}} deps
 */
export async function extractClaims(seat, { request, draft, failures }, { invoke, parseJson, roles, log = () => {}, label = 'claims' }) {
  if (!failures || !failures.length) return { claims: [], stage: null };
  const stage = await invoke(seat, {
    system: roles.CLAIM_EXTRACTION_SYSTEM,
    user: roles.claimExtractionUser({ request, draft, failures }),
    log, label,
  });
  const parsed = parseJson(stage.text);
  const raw = Array.isArray(parsed?.claims) ? parsed.claims : [];
  return { claims: raw, stage };
}
