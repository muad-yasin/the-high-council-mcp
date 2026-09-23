// v5 §1 candidate 11: scan task files and chain configs for text shaped like a real API key
// before it is ever committed or shared. BYOK means the user's own keys are the entire trust
// boundary - nothing currently stops one from ending up pasted into a task file by accident, and
// this repo is public.
//
// Read-only, offline, no network call. The match location is reported; the matched text itself
// never is - printing the very thing you're trying to keep out of a shared log defeats the scan.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { findSecrets } from './secret-patterns.js';

// The patterns live in src/secret-patterns.js, shared with tools.redactSecrets and (through this
// module) the PII gate. Pre-release audit 2026-09-23 (FenceToolsRedaction #1, HIGH): this module's
// own list never matched an OpenRouter key ("sk-or-v1-..."), so `--pii-gate hard-stop` and
// `council doctor --scan-artifacts` passed one straight through.
//
// Scans one file's text, returning `{ line, column, pattern }` for each match - never the
// matched substring itself. Matched on the whole text (a private-key block spans lines), then
// mapped back to a line and column.
export function scanText(text, filename = '') {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = idx => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo; };
  return findSecrets(text, { filename }).map(s => {
    const l = lineOf(s.start);
    return { line: l + 1, column: s.start - starts[l] + 1, pattern: s.name };
  });
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
