// v5 §1 candidate 11: scan task files and chain configs for text shaped like a real API key
// before it is ever committed or shared. BYOK means the user's own keys are the entire trust
// boundary - nothing currently stops one from ending up pasted into a task file by accident, and
// this repo is public.
//
// Read-only, offline, no network call. The match location is reported; the matched text itself
// never is - printing the very thing you're trying to keep out of a shared log defeats the scan.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// Each pattern names the provider shape it targets and requires enough length/character variety
// to make a legitimate hex-looking string (a run ID, a git SHA, a content hash) an unlikely
// match. Deliberately conservative: a missed key is a false negative the user still owns; a
// false positive on every SHA in every commit message would make the scan noise the maintainer
// (and every stranger who runs it) learns to ignore.
const KEY_PATTERNS = [
  { name: 'OpenAI-style (sk-...)', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'OpenAI project-scoped (sk-proj-...)', re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic (sk-ant-...)', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Google AI (AIza...)', re: /\bAIza[A-Za-z0-9_-]{30,}\b/g },
  { name: 'xAI (xai-...)', re: /\bxai-[A-Za-z0-9]{20,}\b/g },
  { name: 'Groq (gsk_...)', re: /\bgsk_[A-Za-z0-9]{20,}\b/g },
  { name: 'Mistral (32 hex chars, mistral context only)', re: /\b[a-f0-9]{32}\b/g, contextRe: /mistral/i },
  { name: 'generic Bearer-token assignment', re: /\b(?:api[_-]?key|authorization|bearer)\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}["']?/gi },
];

// Run IDs (`2026-09-13T18-01-29-810Z`), git SHAs standing alone, and UUIDs are the legitimate
// hex-looking content this project's own files are full of - excluding them by shape, not by
// location, keeps the scan honest across any file it's pointed at.
const KNOWN_SAFE = [
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/,           // run folder timestamp
  /^[0-9a-f]{7,8}$/,                                         // a short git SHA
  /^[0-9a-f]{40}$/,                                          // a full git SHA (never 32 - that's an MD5-shaped length this scan deliberately still treats as key-shaped in provider context)
];

function isKnownSafe(match) {
  return KNOWN_SAFE.some(re => re.test(match));
}

// Scans one file's text, returning `{ line, column, pattern }` for each match - never the
// matched substring itself.
export function scanText(text, filename = '') {
  const hits = [];
  const lines = text.split('\n');
  for (const pattern of KEY_PATTERNS) {
    if (pattern.contextRe && !pattern.contextRe.test(filename) && !pattern.contextRe.test(text)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      pattern.re.lastIndex = 0;
      let m;
      while ((m = pattern.re.exec(line))) {
        if (isKnownSafe(m[0])) continue;
        hits.push({ line: i + 1, column: m.index + 1, pattern: pattern.name });
      }
    }
  }
  return hits;
}

const SCANNABLE_EXT = new Set(['.md', '.json', '.txt', '.yaml', '.yml', '.js']);

function listFiles(root) {
  const out = [];
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'runs') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (SCANNABLE_EXT.has(extname(e.name))) out.push(p);
    }
  };
  const st = statSync(root, { throwIfNoEntry: false });
  if (!st) return out;
  if (st.isDirectory()) walk(root); else out.push(root);
  return out;
}

/**
 * Scan every task file and chain config under `roots` (task files, `chains/`) for key-shaped
 * text. Returns `{ findings: [{ file, line, column, pattern }], filesScanned }`. Never reads or
 * returns the matched substring - only its location and which pattern it matched.
 */
export function scanArtifacts(roots) {
  const findings = [];
  let filesScanned = 0;
  for (const root of roots) {
    for (const file of listFiles(root)) {
      filesScanned++;
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      for (const hit of scanText(text, file)) findings.push({ file, ...hit });
    }
  }
  return { findings, filesScanned };
}
