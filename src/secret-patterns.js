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
// redactor leaves alone, since redaction has no filename to check the context against), and
// `generic` (a shape defined by its surroundings - a Bearer header, a URL password, a named
// assignment - rather than by a provider's own key format; models write these as placeholders,
// `postgres://postgres:postgres@localhost`, so the outbound scan checks them in the user's inputs
// only, and `distinctiveOnly` leaves them out for prompts that carry model output).
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
  { name: 'Bearer token', generic: true, re: /\bBearer\s+(?<secret>[A-Za-z0-9._~+/=-]{16,})/dg },
  // A password inside a URL, including an empty user (`redis://:pw@host`). Only the password goes;
  // rebuilt from the capture group, so a password that also appears in the user name cannot make
  // the replacement hit the wrong occurrence.
  // 0.8.3 T1-4 (Builder D; Batch 2 audit item 4): the userinfo runs to the LAST "@" of the authority (the authority ends at "/" or white space), and the user/password split is at the
  // FIRST ":" (a user name may be an e-mail address - `smtp://me@gmail.com:app-pw@smtp.gmail.com` - and a password may hold "@", ":", "?" or "#"). DETECTION stays as wide as it was
  // (a password with a "?" or "#" in it is still found); only the reserved-host EXEMPTION is narrowed, in findSecrets: it needs a clean userinfo (the user part holds no "?", "#" or "\\"; the password none of "@", "?", "#", "\\" or "/")
  // AND every host of the authority (a comma list, a libpq host= parameter) to be a plain reserved placeholder host: see urlHostsAreAllReserved. `pw@db.corp.io?next=a@localhost` makes the greedy password swallow the query string,
  // and `pw@db.corp.io@localhost` has parsers disagree about which "@" ends the userinfo (v0.8.2 refused both and so must the exemption).
  { name: 'URL credentials (scheme://user:pass@)', generic: true, exemptHost: true, re: /\b[a-z][a-z0-9+.-]*:\/\/(?<user>[^\s:/]*):(?<secret>[^\s/]+)@/dgi },
  // The SAME rule for a password that CONTAINS a "/" (0.8.3 key-scan regression unit, item 3; Haiku batch 4 A13 F2: a generated base64 password is the common case and the entry above stops at the first "/"). Guards, because "/" is
  // also what ends an authority: the text before the first "/" is not only digits (that is a port: `https://registry.example.com:443/@scope/pkg`); the user part holds no "@" (so `git+ssh://git@github.com:org/repo.git@v1.2.3` cannot match;
  // an e-mail user name with a "/" password is NOT found here); the password holds no "@" (the first "@" after the "/" ends it); and the "@" must be followed by a host-looking token that ends at the end of the text or at any character
  // that cannot be part of a host name (a URL ends in a quote, a backtick or a bracket in JSON, YAML, .env and markdown). A password that starts with digits and then a "/" (`12/ab`) reads as a port and a path and is NOT found. A secret
  // holding "/" is never exempt as a placeholder (findSecrets).
  { name: 'URL credentials (scheme://user:pass@)', generic: true, exemptHost: true, re: /\b[a-z][a-z0-9+.-]*:\/\/(?<user>[^\s:/@]*):(?<secret>(?!\d+\/)[^\s@/]*\/[^\s@]*)@(?=(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d+)?(?![A-Za-z0-9.:\-\[\]]))/dgi },
  // A named assignment whose value looks like a credential: snake, kebab AND camelCase names
  // (`AccessToken`, `openAiApiKey`, `x-api-key`, `"password":`). Needs the name AND a long opaque
  // value, so `apiKey: config.apiKey` stays.
  { name: 'named credential assignment', generic: true, re: /(?<![A-Za-z0-9])[A-Za-z0-9_.-]*?(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|auth|passwort|kennwort|zugangsdaten|(?:api|zugangs)[_-]?schl(?:ue|\u00fc)ssel)[A-Za-z0-9_]*['"]?\s*[:=]\s*['"]?(?<secret>[A-Za-z0-9/+_.=-]{20,})/dgi },
  // Env-style upper-case name ending in KEY/TOKEN/SECRET/PASSWORD with an opaque value
  // (`GOOGLE_PLAY_PUBKEY=...`, `export DEPLOY_TOKEN="..."`). `CACHE_KEY=1` stays.
  { name: 'env-style credential assignment', generic: true, re: /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWORT|PASSWD|PWD)\s*=\s*['"]?(?<secret>[A-Za-z0-9/+_.-]{16,})/dg },
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

// RESERVED PLACEHOLDER HOSTS (0.8.3 M6 S5b Part E; the owner chose this over a per-run override, 12 Oct 2026): a password in a URL on one of these hosts is a placeholder (`postgres://user:pass@localhost/db`), not a credential,
// and an e-mail address on one of these domains is an example, not personal data. ONE list, here beside the pattern it narrows; src/pii-gate.js imports `isReservedPlaceholderHost` for the e-mail domain check. Never a second copy.
// The scope is the HOST position of the URL-credentials match and nothing else (a filter after the match, in `findSecrets`: the named `secret` group and the redactor keep working); every other host, every provider key format,
// Bearer tokens and named assignments are checked as before. THE EXEMPTION IS AN OPTION, OFF BY DEFAULT (`findSecrets(text, { exemptReservedHosts: true })`; C&C ruling 12 Oct after the advice-mask probe): only the REFUSAL scans pass it
// (the input scan in src/run-preflight.js and src/cli.js, the PII gate in src/pii-gate.js); redaction and masking (redactText, tools.redactSecrets, the advice masker), the artifact scanner and the advice send path never do, so a REAL password on
// `localhost` in text that is redacted or leaves the machine is still hidden (test/reserved-placeholder-hosts.test.js RES-6, RES-7 lists the files that pass it). The host is compared at its END with a dot boundary (`localhost.evil.com` and `example.com.evil.io` are NOT reserved; `db.example.com` and `db.localhost` are).
//   hosts   exactly these (localhost, the IPv4 loopback address, the IPv6 loopback address)
//   names   RFC 2606: the name and any subdomain (the RFC reserves the whole subtree)
//   tlds    RFC 2606 / 6761 top-level names: any host ending in `.<name>`
export const RESERVED_PLACEHOLDER_HOSTS = Object.freeze({
  hosts: Object.freeze(['localhost', '127.0.0.1', '::1']),
  names: Object.freeze(['example.com', 'example.net', 'example.org']),
  tlds: Object.freeze(['test', 'example', 'invalid', 'localhost']),
});
/** Is `host` (as written: any case, a bracketed IPv6 literal, one trailing dot) a reserved placeholder host? Pure. */
export function isReservedPlaceholderHost(host) {
  const h = String(host ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (!h) return false;
  const { hosts, names, tlds } = RESERVED_PLACEHOLDER_HOSTS;
  return hosts.includes(h) || names.some(n => h === n || h.endsWith(`.${n}`)) || tlds.some(t => h.endsWith(`.${t}`));
}
// WHERE A URL PASSWORD GOES, for the reserved-host exemption (0.8.3 key-scan regression unit, Builder D; Haiku batch 4 notice 2 group D; v0.8.2 had no exemption, so it refused every one of these).
// The exemption is given only when EVERYTHING that decides where the password goes is a reserved placeholder host:
//  - the AUTHORITY after the match runs to the first white space, "/", "?", "#" or a closing character no host name holds (a quote, a backtick, ")", ">", "<", "}"), or the end of the text. It is split on ",":
//    a host list (`mongodb://u:pw@a.corp.io,db.example.com`). NO stop character is added for "\", ";" or "%": they stay INSIDE the member, and a member with any such character is not a plain host. (Stopping at
//    "," would read `localhost,prod.corp.io` as `localhost`; stopping at "\" would read `localhost\x.corp.io` as `localhost`: both refused in v0.8.2, both must stay refused.)
//  - EVERY member must be a plain host (letters, digits, "." and "-", or a bracketed IPv6 literal) with an optional ":port", and a reserved one. An empty member, or one with anything else in it, means no exemption.
//  - libpq: every `host=` / `hostaddr=` parameter in the rest of the URL (past a path, after "?" or "&", repeated ones too) is a host list of its own, under the same rule.
//  - the userinfo is clean: the user part holds no "?", "#" or "\", and the password holds none of "@", "?", "#", "\" or "/" (see findSecrets). An e-mail user name stays allowed.
const AUTHORITY_END = /[\s/?#"'`)><}]/;
const PLAIN_MEMBER = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d*)?$/;
const memberIsReserved = m => { const x = PLAIN_MEMBER.exec(m); return x !== null && isReservedPlaceholderHost(x[1]); };
const listIsReserved = list => list.length > 0 && list.split(',').every(memberIsReserved);
export function urlHostsAreAllReserved(text, at) {
  const rest = text.slice(at, at + 400);
  const end = rest.search(AUTHORITY_END);
  if (end === -1 && rest.length === 400) return false;           // an authority this long is not a host list
  if (!listIsReserved(end === -1 ? rest : rest.slice(0, end))) return false;
  const tail = (/^[^\s"'`]*/.exec(text.slice(at, at + 2000)) ?? [''])[0];
  for (const m of tail.matchAll(/[?&](?:host|hostaddr)=([^&#\s]*)/gi)) if (!listIsReserved(m[1])) return false;
  return true;
}

// Where each credential is: [{ start, end, name }] over the whole text, overlapping hits merged
// (the widest wins, so a Bearer + generic-assignment double hit counts once). `filename` feeds the
// context rules. Values are never returned.
// `exemptReservedHosts`: skip a URL-credentials hit whose host is a reserved placeholder host (above). A refusal scan asks for it; the default (redaction, masking, every other caller) does not.
// `everyContext`: apply the context-only shapes everywhere, without their context word (an advice brief: the whole text is
// outgoing, so a bare 32-character Mistral or 64-hex Together key is refused even with no provider named; 0.8.1, audit A5).
export function findSecrets(text, { filename = '', redactable = false, distinctiveOnly = false, everyContext = false, exemptReservedHosts = false } = {}) {
  const spans = [];
  for (const p of SECRET_PATTERNS) {
    if (redactable && p.scanOnly && !everyContext) continue;
    if (distinctiveOnly && p.generic) continue;
    if (p.contextRe && !everyContext && !p.contextRe.test(filename) && !p.contextRe.test(text)) continue;
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      if (isKnownSafe(m[0])) continue;
      if (exemptReservedHosts && p.exemptHost && !/[?#\\]/.test(m.groups?.user ?? '') && !/[@?#\\/]/.test(m.groups?.secret ?? '') && urlHostsAreAllReserved(text, m.index + m[0].length)) continue;   // a placeholder on a reserved host (above); never when the password text holds a "?" or "#" (T1-4: the greedy password ran into a query string)
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

// ---- the URL-userinfo rule's other two users (0.8.3 key-scan regression unit, item 4; C&C's gate add 2): ONE rule, here --------------------------------------------------------------------------------
// src/providers.js masked URL credentials in error text with a copy of the pattern that stopped at the first "@" and knew no "/" in a password; src/advice-brief.js refused a credentialed origin with a lookahead that knew no "/" either.
// Both now ask these two functions, which use the SAME entries as the scan above (test/url-userinfo-single-copy.test.js scans src/ so a fourth copy cannot appear). The mask keeps its old reach: a user-only credential
// (`https://token@github.com`) is hidden too, up to the LAST "@" before the first "/".
const URL_ENTRIES = SECRET_PATTERNS.filter(p => p.exemptHost);
const USER_ONLY_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/]+@/dgi;
function userinfoSpans(text) {
  const spans = [];
  for (const re of [...URL_ENTRIES.map(p => p.re), USER_ONLY_URL]) {
    for (const m of text.matchAll(re)) spans.push([m.index + m[0].indexOf('://') + 3, m.index + m[0].length - 1]);   // from after "://" up to the "@"
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) { if (sp[1] > last[1]) last[1] = sp[1]; continue; }
    merged.push([...sp]);
  }
  return merged;
}
// Detection keeps the reach the advice brief's old origin check had (5b3a9e1: `.*://[^/\s]*@`): no word boundary before the scheme, no scheme at all, an empty user part - a refusal check errs toward refusing. The mask above keeps ITS old reach.
const ANY_USERINFO = /:\/\/[^\s/]*@/;
/** Does `text` hold a URL with a user name or password in it (`scheme://user@host`, `scheme://user:pass@host`, a "/" or a second "@" in the password included)? */
export const hasUrlUserinfo = text => { const t = String(text ?? ''); return ANY_USERINFO.test(t) || userinfoSpans(t).length > 0; };
/** `text` with the userinfo of every URL replaced by `[redacted]` (provider error text and run logs). */
export function maskUrlUserinfo(text) {
  const t = String(text ?? '');
  let out = '';
  let at = 0;
  for (const [start, end] of userinfoSpans(t)) { out += `${t.slice(at, start)}[redacted]`; at = end; }
  return out + t.slice(at);
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
