// The thin contract (0.8.2 item 6a; owner 6 Oct 2026: "Thin contract: YES ... task hash + criteria hash + repo/evidence snapshot hash + signed-text hash. Not the full CONTRACT.json").
// One small record in report.json (`thin_contract`) that says, in full-width sha256 hashes, WHAT this run was asked, graded against, shown and signed, plus one hash over the record itself.
// It repeats values report.json already holds (task_sha256, criteria_sha256, checks_sha256, signed_text.sha256: item 4's hash is READ, never defined a second time) and adds the evidence hashes.
//
// What it is: a tamper-EVIDENT fingerprint. Whoever can edit report.json can edit the record too, so a copy the builder holds (HANDOFF.md carries it from item 6b) is the one that matters; this
// is the same posture as the criteria lock ("tamper-evident, not tamper-proof"). What it is not: a repo hash. Seats never see the repo, so the "evidence snapshot" is what the run RECORDED as shown:
// the --context documents and the tool results (ground truth). Material handed in with --draft or --from-run is not covered, and on a resume the tool results are those collected in the sitting that wrote
// report.json. A repo hash would certify something the run never checked.
//
// Hash input, defined once so anyone can recompute it: the record without its own `sha256` field, as JSON with every object's keys sorted (by UTF-16 code unit, JavaScript's default), no whitespace, strings
// escaped exactly as JSON.stringify does (non-ASCII text is NOT \\u-escaped; python: json.dumps(ensure_ascii=False, sort_keys=True, separators=(',', ':')), which agrees for text in the Basic Multilingual
// Plane), UTF-8; an unknown component of the RECORD is the literal null, never an absent key, while an undefined field inside a tool result is absent, as in JSON.stringify. All hashes are 64 hex characters (never the 12-character fingerprint src/integrity.js uses). Pure and $0: no file, no model.
import { createHash } from 'node:crypto';

export const THIN_CONTRACT_SCHEMA = 'thin-contract/1';
const HEX64 = /^[0-9a-f]{64}$/;
export const sha256Of = s => createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');

/** JSON with every object's keys sorted and no whitespace (arrays keep their order). The one canonical form behind every hash here. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(v => canonicalJson(v)).join(',')}]`;
  // Exactly what JSON.stringify does with undefined, so a value hashes the same before and after report.json's own JSON round trip (a tool result with an undefined field would otherwise differ:
  // the review of 6a found check_versions returns version: undefined for a package.json with no version): an undefined-valued key is absent, an undefined element is null.
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined && typeof value[k] !== 'function').sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * sha256 over the tool results the run recorded as shown to the seats, or null when there were none. Each entry is { tool, args, result } (plus a fact flag when the spec had one); `result_ref` is left out
 * because it is an id the harness assigns and no seat ever saw. Order is the order the seats' prompts list them.
 */
export function groundTruthSha256(groundTruth) {
  if (!Array.isArray(groundTruth) || !groundTruth.length) return null;
  return sha256Of(canonicalJson(groundTruth.map(({ result_ref, ...shown }) => shown)));
}

/** The hash of a record: over the record without its own `sha256` field. */
export function recordHash(record) {
  const { sha256, ...rest } = record || {};
  return sha256Of(canonicalJson(rest));
}

/**
 * The record, or null when it cannot be made honestly (a run with no criteria, no task hash or no signed text has nothing to seal). Every field but the evidence ones is required to be a
 * 64-hex string; a value that is not one makes the whole record null rather than a record that looks complete.
 */
export function buildThinContract({ taskSha256, criteriaSha256, checksSha256 = null, contextSha256 = null, groundTruth = null, signedTextSha256 }) {
  const need = [taskSha256, criteriaSha256, signedTextSha256];
  if (need.some(h => typeof h !== 'string' || !HEX64.test(h))) return null;
  if ([checksSha256, contextSha256].some(h => h !== null && (typeof h !== 'string' || !HEX64.test(h)))) return null;
  const record = {
    schema: THIN_CONTRACT_SCHEMA,
    task_sha256: taskSha256,
    criteria_sha256: criteriaSha256,
    checks_sha256: checksSha256,
    evidence: { context_sha256: contextSha256, ground_truth_sha256: groundTruthSha256(groundTruth) },
    signed_text_sha256: signedTextSha256,
  };
  return { ...record, sha256: recordHash(record) };
}
