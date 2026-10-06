// Reversible masking for the advice brief (thc-research brief 25's prototype, re-written here for the product).
//
// Each detected span (an email, a checksum-valid IBAN or card, an IP, an internal hostname, an absolute home
// path) becomes a stable placeholder such as [EMAIL_1]. The mapping (placeholder -> original) is returned to
// the caller and is never written to a run folder or sent anywhere; the server holds it in memory for the life
// of the call so the answer can be read with the original words again.
//
// This reduces the blast radius of an honest mistake. It is NOT anonymisation: names, postal addresses, phone
// numbers, birth dates, tax ids and passwords written as prose have no fixed shape and pass through (brief 25,
// section 5.1: 9 of 29 toy classes passed every layer). The person reading the send preview is the control for
// those. Pseudonymised text is still personal data while the mapping exists (GDPR recital 26); the public text
// says mechanism only and makes no protection claim.
import { findSecrets } from './secret-patterns.js';
// The IBAN shapes are the PII gate's own (0.8.1 M1 Work 7): one definition, so a fix to one reaches both. matchAll copies the
// regex, so sharing the global ones is safe.
import { ibanChecksumValid, luhnValid, IBAN_SHAPE_RE as IBAN, IBAN_SPACED_RE as IBAN_SPACED } from './pii-gate.js';

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+\b/g;
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;
// A hostname is three or more labels, or two labels ending in an internal-network suffix. Two-label names such
// as `config.md` or `server.py` are not matched (.md and .py are country domains and hit every source tree).
const TLDS = 'com|net|org|io|dev|de|eu|fr|uk|nl|at|ch|us|cloud|app|ai|info|biz|co|internal|local|lan|corp|intra';
const HOST = new RegExp(`\\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.){2,}(?:${TLDS})\\b|\\b[A-Za-z0-9-]+\\.(?:internal|local|lan|corp|intra)\\b`, 'gi');
// Home and service paths name a person or a machine: /home/<user>, /Users/<user>, C:\Users\<user>, /srv/<service>, and /root (root's
// home, which has no user part; 0.8.1 M1 Work 7, audit A5). /root must end there or continue with a separator, so /rooted is not one.
// The path must start a token (nothing word-like before its first character), so a relative path such as src/root/index.js or
// lib/srv/x.js is left alone (M1 review: it became src[PATH_1]).
const ABS_PATH = /(?<![A-Za-z0-9._~-])(?:\/(?:home|Users|srv)\/[^\s/'"`)]+|\/root(?=[\/\s'"`)]|$)|[A-Za-z]:\\Users\\[^\s\\'"`)]+)(?:[\/\\][^\s'"`)]*)?/g;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
// Public hosts carry information an advisor needs and protect nothing; masking every FQDN made the preview
// unreadable (32 hits on 34k lines of a secret-free tree, brief 25). Only these are masked: an internal suffix,
// or a label that ends in an instance number (web-7.example.com).
const INTERNAL_SUFFIX = /\.(?:internal|local|lan|corp|intra)$/i;
const INSTANCE_LABEL = /(?:^|\.)[A-Za-z][A-Za-z-]*-?\d+\./;

const PLACEHOLDER = /\[(?:SECRET|EMAIL|IBAN|CARD|IP|PATH|HOST)_\d+\]/;

/** The spans to mask: [{ start, end, kind }], widest first where they overlap. Keys are refused before this runs. */
export function detect(text) {
  const spans = [];
  for (const s of findSecrets(text, { redactable: true })) spans.push({ start: s.start, end: s.end, kind: 'SECRET' });
  const add = (re, kind, ok = () => true) => {
    for (const m of text.matchAll(re)) if (ok(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, kind });
  };
  add(EMAIL, 'EMAIL');
  add(IBAN, 'IBAN', ibanChecksumValid);
  add(IBAN_SPACED, 'IBAN', ibanChecksumValid);
  add(CARD, 'CARD', v => luhnValid(v.replace(/[ -]/g, '')));
  add(IPV4, 'IP', ip => ip !== '127.0.0.1' && !ip.startsWith('0.'));
  add(ABS_PATH, 'PATH');
  add(HOST, 'HOST', h => INTERNAL_SUFFIX.test(h) || INSTANCE_LABEL.test(h));
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) continue; // an earlier, wider span already covers it
    out.push(s);
  }
  return out;
}

/**
 * { text, mapping, counts }. A path under `repoRoot` is rewritten to its repo-relative form instead of a
 * placeholder: the relative path is what an advisor needs, and it carries no user name.
 * Throws when the text already holds a placeholder-shaped token: unmasking would be ambiguous.
 */
export function mask(text, { repoRoot = null } = {}) {
  if (PLACEHOLDER.test(text)) throw new Error('the brief already contains a token shaped like [EMAIL_1]; rename it so the masking can be undone without doubt');
  const root = repoRoot ? repoRoot.replace(/[\\/]$/, '') : null;
  const seen = new Map(); const counts = {}; const mapping = {};
  let out = ''; let at = 0;
  for (const s of detect(text)) {
    const raw = text.slice(s.start, s.end);
    let rep;
    if (s.kind === 'PATH' && root && raw.startsWith(`${root}/`)) rep = raw.slice(root.length + 1);
    else {
      const key = `${s.kind}:${raw}`;
      if (!seen.has(key)) { counts[s.kind] = (counts[s.kind] || 0) + 1; seen.set(key, `[${s.kind}_${counts[s.kind]}]`); mapping[seen.get(key)] = raw; }
      rep = seen.get(key);
    }
    out += text.slice(at, s.start) + rep; at = s.end;
  }
  return { text: out + text.slice(at), mapping, counts };
}

/** Puts the original words back. Placeholders are replaced longest first, so [IP_10] is never read as [IP_1]0. */
export function unmask(text, mapping) {
  return Object.entries(mapping).sort((a, b) => b[0].length - a[0].length).reduce((t, [ph, raw]) => t.split(ph).join(raw), String(text ?? ''));
}
