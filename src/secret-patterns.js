// The one list of credential shapes (pre-release audit 2026-09-23, FenceToolsRedaction #1-#4).
//
// Three modules used to carry their own lists and had drifted apart in both directions:
// key-redaction.js (read by `council doctor --scan-artifacts` and, through pii-gate.js, by
// `--pii-gate`) never matched an OpenRouter key - `\bsk-[A-Za-z0-9]{20,}` stops at the "-" in
// "sk-or-v1-", and OpenRouter is the owner's main provider - while tools.js's redactSecrets (tool
// results, `council fence`) caught that but missed camelCase names, Bearer tokens, PGP blocks,
// Groq/HF/Together keys, an empty-user URL password, and half of every Z.ai key. Every consumer
// now reads this module; test/secret-patterns.test.js runs one fake key per provider format
// through all three.
//
// Each entry: `name` (reported instead of the value - a scan never prints what it found), `re`
// (global; `d` flag where a named `secret` group marks the only part to redact, so the name, the
// user or the host around it stays readable), and optionally `contextRe` (a shape too generic to
// flag on its own - a 32/64-char hex string is also an MD5/SHA-256 - counts only when the text or
// file names the provider) and `scanOnly` (context-dependent shapes the scanner reports but the
// redactor leaves alone, since redaction has no filename to check the context against).
//
// Deliberately conservative: a missed key is a false negative the user still owns; a filter that
// fires on every hash and every `apiKey: config.apiKey` gets turned off.

const OPAQUE = '[A-Za-z0-9_-]';

// Exported on its own for callers that must blank a multi-line block line by line (grep_repo).
export const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;

export const SECRET_PATTERNS = [
  // Private keys, PEM and PGP. Multi-line, so matched on the whole text, never line by line.
  { name: 'private key block (PEM/PGP)', re: PRIVATE_KEY_BLOCK },
  // Provider keys with their own prefix. The prefix-specific ones come first so the report names
  // the provider; the generic sk-/pk-/rk- rule after them catches the rest (dashes allowed, which
  // is exactly what the old key-redaction rule lacked).
  { name: 'OpenRouter (sk-or-v1-...)', re: /\bsk-or-v1-[A-Za-z0-9]{32,}/g },
  { name: 'Anthropic (sk-ant-...)', re: new RegExp(`\\bsk-ant-${OPAQUE}{20,}`, 'g') },
  { name: 'OpenAI project-scoped (sk-proj-...)', re: new RegExp(`\\bsk-proj-${OPAQUE}{20,}`, 'g') },
  { name: 'OpenAI-style (sk-/pk-/rk-...)', re: new RegExp(`\\b(?:sk|pk|rk)-${OPAQUE}{20,}`, 'g') },
  { name: 'Stripe (sk_/rk_/pk_ live/test)', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'Google AI (AIza...)', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { name: 'xAI (xai-...)', re: /\bxai-[A-Za-z0-9]{20,}/g },
  { name: 'Groq (gsk_...)', re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { name: 'Hugging Face (hf_...)', re: /\bhf_[A-Za-z0-9]{30,}/g },
  { name: 'GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'GitHub fine-grained token (github_pat_...)', re: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { name: 'Slack token (xox?-...)', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'AWS access key id (AKIA...)', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'JWT', re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Z.ai: 32 hex, a dot, a secret part. The whole thing goes - the old rule stopped at the dot and
  // left the secret half in clear.
  { name: 'Z.ai (<hex>.<secret>)', re: /\b[a-f0-9]{32}\.[A-Za-z0-9]{16,}/g },
  // A token after "Bearer": only the token goes.
  { name: 'Bearer token', re: /\bBearer\s+(?<secret>[A-Za-z0-9._~+/=-]{16,})/dg },
  // A password inside a URL, including an empty user (`redis://:pw@host`). Only the password goes;
  // rebuilt from the capture group, so a password that also appears in the user name cannot make
  // the replacement hit the wrong occurrence.
  { name: 'URL credentials (scheme://user:pass@)', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:(?<secret>[^\s/@]+)@/dgi },
  // A named assignment whose value looks like a credential: snake, kebab AND camelCase names
  // (`AccessToken`, `openAiApiKey`, `x-api-key`, `"password":`). Needs the name AND a long opaque
  // value, so `apiKey: config.apiKey` stays.
  { name: 'named credential assignment', re: /(?<![A-Za-z0-9])[A-Za-z0-9_.-]*?(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|auth)[A-Za-z0-9_]*['"]?\s*[:=]\s*['"]?(?<secret>[A-Za-z0-9/+_.=-]{20,})/dgi },
  // Env-style upper-case name ending in KEY/TOKEN/SECRET/PASSWORD with an opaque value
  // (`GOOGLE_PLAY_PUBKEY=...`, `export DEPLOY_TOKEN="..."`). `CACHE_KEY=1` stays.
  { name: 'env-style credential assignment', re: /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)\s*=\s*['"]?(?<secret>[A-Za-z0-9/+_.-]{16,})/dg },
  // Too generic alone (an MD5 / a SHA-256): flagged by the scanner only in the provider's context.
  { name: 'Mistral (32 chars, mistral context only)', re: /\b[A-Za-z0-9]{32}\b/g, contextRe: /mistral/i, scanOnly: true },
  { name: 'Together (64 hex, together context only)', re: /\b[a-f0-9]{64}\b/g, contextRe: /together/i, scanOnly: true },
];

// Legitimate hex-looking content this project is full of, excluded by shape: run folder
// timestamps, short and full git SHAs.
const KNOWN_SAFE = [
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/,
  /^[0-9a-f]{7,8}$/,
  /^[0-9a-f]{40}$/,
];
export const isKnownSafe = s => KNOWN_SAFE.some(re => re.test(s));

// Where each credential is: [{ start, end, name }] over the whole text, overlapping hits merged
// (the widest wins, so a Bearer + generic-assignment double hit counts once). `filename` feeds the
// context rules. Values are never returned.
export function findSecrets(text, { filename = '', redactable = false } = {}) {
  const spans = [];
  for (const p of SECRET_PATTERNS) {
    if (redactable && p.scanOnly) continue;
    if (p.contextRe && !p.contextRe.test(filename) && !p.contextRe.test(text)) continue;
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      if (isKnownSafe(m[0])) continue;
      const g = m.indices?.groups?.secret;
      const [start, end] = g && m.groups.secret ? g : [m.index, m.index + m[0].length];
      spans.push({ start, end, name: p.name });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) { if (s.end > last.end) last.end = s.end; continue; }
    merged.push({ ...s });
  }
  return merged;
}

export const REDACTED = '[redacted: possible secret]';

// The text with every credential span replaced by REDACTED, and how many there were.
export function redactText(text) {
  if (typeof text !== 'string' || !text) return { text: text ?? '', redacted: 0 };
  const spans = findSecrets(text, { redactable: true });
  let out = '';
  let at = 0;
  for (const s of spans) { out += text.slice(at, s.start) + REDACTED; at = s.end; }
  return { text: out + text.slice(at), redacted: spans.length };
}
