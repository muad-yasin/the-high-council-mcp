// v7.x item 2 (relay/runs/2026-09-14T15-29-02-644Z/deliverable.md, "Redaction/data-class
// pre-flight gate"): scan the task file for PII-shaped and secret-shaped patterns before the
// first provider call, with a hard-stop mode. Same warn-never-block-by-default posture as
// src/preflight.js's checks, but this one CAN block - only when explicitly configured to.
//
// Backward compatibility, same discipline as every other v7.x item (src/chain-lint.js's
// config.challenge/config.allocator gating is the reference pattern): this gate is completely
// inert unless a caller explicitly asks for it. No CLI flag and no policy field means this
// module is never even invoked from src/cli.js - not "runs in warn mode with nothing to warn
// about", genuinely never invoked, so behavior is byte-for-byte identical to before this file
// existed.
//
// Leak prevention is load-bearing: this gate's whole point is to keep PII/secrets from leaving
// the machine, so its own output must never itself be the leak. Every finding carries only a
// `masked` echo (first 4 characters, then asterisks, capped at 40 characters total) - never the
// real matched substring - and secret-shaped matches (reusing src/key-redaction.js's own
// patterns, which already follow this rule) carry no echo at all, only a location and a pattern
// name.
import { scanText as scanSecretText } from './key-redaction.js';

// Masks a matched string for any output (log line, error message, WARNINGS.md entry). Never
// returns the original substring, and the result is always <= 40 characters, per the deliverable's
// explicit truncation requirement.
export function maskMatch(value) {
  if (!value) return '';
  const visible = Math.min(4, value.length);
  const head = value.slice(0, visible);
  const truncated = value.length > 40;
  // Budget: 40 chars total, minus the visible head, minus 1 for a truncation marker if needed.
  const maskedLen = Math.min(value.length - visible, 40 - visible - (truncated ? 1 : 0));
  const suffix = truncated ? '…' : '';
  return `${head}${'*'.repeat(maskedLen)}${suffix}`;
}

// Real mod-97 IBAN checksum (ISO 7064 MOD 97-10), not a format-shape guess. Rearranges the
// string (move the first 4 characters to the end), maps each letter to its two-digit numeral
// (A=10 ... Z=35), then reduces the resulting decimal digit string mod 97 in chunks small enough
// to stay within safe-integer math - a naive BigInt-free full-string parse would overflow for any
// IBAN longer than a handful of digits.
export function ibanChecksumValid(candidate) {
  const iban = (candidate || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = '';
  for (const ch of rearranged) {
    numeric += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  }
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(`${remainder}${numeric.slice(i, i + 7)}`) % 97;
  }
  return remainder === 1;
}

// Real Luhn (mod-10) check digit algorithm, not a digit-count regex. `digits` is expected to
// already be digits-only (punctuation/spaces stripped by the caller).
export function luhnValid(digits) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+\b/g;
// IBAN-shape: two letters, two check digits, 11-30 alphanumerics - checksum-validated below, so a
// shape match that fails mod-97 is not reported (this is the false-positive cut the deliverable
// asks for, not just a format match).
const IBAN_SHAPE_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
// Card-shaped digit runs, optionally space/dash separated, 13-19 digits once separators are
// stripped - Luhn-validated below, same false-positive discipline as IBAN.
const CARD_SHAPE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

const PII_TYPES = ['email', 'iban', 'card', 'secret'];

/**
 * Scan `text` for PII-shaped and secret-shaped content. Returns
 * `{ findings: [{ type, line, column, masked?, pattern? }], suppressed: string[] }`.
 * `allow` is a list of type names (a subset of PII_TYPES) to suppress from `findings` -
 * suppressed types are still reported back in `suppressed` so a caller can print them (an
 * applied suppression is always visible, never a silent hole). Never throws; never includes
 * the real matched substring anywhere in its return value.
 */
export function scanForPii(text, { allow = [] } = {}) {
  const body = text || '';
  const lines = body.split('\n');
  const allowSet = new Set(allow.filter(a => PII_TYPES.includes(a)));
  const findings = [];

  const addLineFindings = (re, type, validate) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const raw = m[0];
        if (validate && !validate(raw)) continue;
        findings.push({ type, line: i + 1, column: m.index + 1, masked: maskMatch(raw) });
        if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width loops
      }
    }
  };

  addLineFindings(EMAIL_RE, 'email');
  addLineFindings(IBAN_SHAPE_RE, 'iban', raw => ibanChecksumValid(raw));
  addLineFindings(CARD_SHAPE_RE, 'card', raw => luhnValid(raw.replace(/[ -]/g, '')));

  // Secret detection reuses src/key-redaction.js's own patterns (sk-/AWS/PEM/bearer/etc, plus
  // its KNOWN_SAFE exclusions for run-folder timestamps and git SHAs) rather than duplicating
  // them - prior art already tuned for this codebase's own false-positive shape.
  for (const hit of scanSecretText(body)) {
    findings.push({ type: 'secret', line: hit.line, column: hit.column, pattern: hit.pattern });
  }

  const suppressed = [...allowSet];
  const kept = allowSet.size ? findings.filter(f => !allowSet.has(f.type)) : findings;

  return { findings: kept, suppressed };
}

/**
 * Apply the gate's configured mode to a scan result. `mode` is `'warn'` or `'hard-stop'` - any
 * other value (including undefined/null, i.e. the gate not configured at all) means this
 * function is not meant to be called; callers gate the call itself, not the mode inside it, so
 * absence of config never reaches here (see src/cli.js's wiring). Returns
 * `{ block: boolean, messages: string[] }` - `block` is true only under `hard-stop` with at
 * least one finding. Messages never contain the real matched substring.
 */
export function applyPiiGate(scanResult, mode) {
  const { findings, suppressed } = scanResult;
  const messages = [];
  for (const s of suppressed) messages.push(`suppressed pattern class '${s}' (--allow-pii)`);
  for (const f of findings) {
    const detail = f.type === 'secret'
      ? `looks like ${f.pattern} (value not shown)`
      : `looks like a ${f.type} (masked: ${f.masked})`;
    messages.push(`line ${f.line}, col ${f.column}: ${detail}`);
  }
  const block = mode === 'hard-stop' && findings.length > 0;
  return { block, messages };
}
