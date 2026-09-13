// v6 §6: the public-naming lint. Scans the whole repository for name
// patterns from a forbidden-name blocklist and fails loudly if any appear
// anywhere in the shipped tree.
//
// The engineering problem this module exists to solve: the lint needs to
// know the forbidden names to check for them, but the whole point is that a
// public MIT repo must never carry those names itself - not even hashed
// alongside a "these are forbidden" comment, since a hash next to a plain
// list of five approved names is still a place a real name could get pasted
// by accident. So this module ships knowing NOTHING about any specific
// third-party name. It is a generic scanner over SHA-256 hashes of
// lowercase, whitespace-normalized candidate name spans:
//
//   - DEFAULT_FORBIDDEN_HASHES here is empty. This repo's own author has an
//     internal, third-party-derived naming shorthand (Dune character names,
//     per the plan this module was built from) - that list is never typed
//     into this file, this repo, or any session's output. It lives only in
//     the author's own local, gitignored config (see loadForbiddenHashes()).
//   - An operator adds their own forbidden set - their own trademark risks,
//     not just this author's - by pointing COUNCIL_FORBIDDEN_NAMES_FILE (or
//     the `forbiddenNamesFile` option) at a local JSON file of plain-text
//     names. This module hashes them at load time; only the hash ever
//     participates in a comparison after that point.
//   - Without an operator-local file, the scan runs against the (empty)
//     default set and finds nothing - which is honest: there is nothing to
//     check against until an operator supplies their own list. The lint
//     test in this repo's own suite exists to prove the MECHANISM works
//     (via synthetic, clearly-fictional test names, never real ones), not
//     to prove any specific name is absent - that guarantee is only as good
//     as whatever forbidden list is actually loaded when it runs.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export const DEFAULT_FORBIDDEN_HASHES = Object.freeze([]);
// COUNCIL_FORBIDDEN_NAMES_FILE takes any path you give it - nothing here
// enforces that it lives under .council/. That directory is only a
// convention this repo's .gitignore happens to cover; if you point this at
// a path outside it, gitignore gives you no protection and it's on you not
// to `git add` it (bug-audit finding, 2026-09-13 - noted so it isn't
// mistaken for an enforced guarantee).
const ENV_FORBIDDEN_FILE = 'COUNCIL_FORBIDDEN_NAMES_FILE';

// Generated, vendored, or binary content - never shipped source a reader
// browses, and in runs/'s case, real user data this project's own rules
// already keep out of the repo. `.git` and `node_modules` are structural.
// Every entry here is also gitignored (see .gitignore), so a real checkout
// never has anything to skip in the first place - this list only matters
// for a working tree with local, uncommitted output sitting in it.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'runs', '.council']);
// Extensions worth reading as text. Anything else (images, fonts, lockfiles'
// noise) is skipped rather than mis-decoded.
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.txt', '.yml', '.yaml', '.sh']);

export function hashName(name) {
  // NFC-normalize before hashing: an accented name typed in decomposed form
  // (NFD) must hash identically to the same name in precomposed form (NFC),
  // or a forbidden name could slip past the check purely by which Unicode
  // form happened to get pasted in (bug-audit finding, 2026-09-13).
  return createHash('sha256').update(String(name).trim().toLowerCase().normalize('NFC')).digest('hex');
}

/**
 * The forbidden-hash set to scan against: DEFAULT_FORBIDDEN_HASHES (empty,
 * see module comment) plus any names in an operator-local file, hashed here
 * so the plain text never leaves this function. A missing or unreadable
 * file degrades to the default set - never throws, matching this project's
 * existing degrade-not-throw convention (spend.js, verdict-stats.js).
 */
export function loadForbiddenHashes({ forbiddenNamesFile, readFile = defaultReadFile } = {}) {
  const path = forbiddenNamesFile ?? process.env[ENV_FORBIDDEN_FILE];
  const hashes = new Set(DEFAULT_FORBIDDEN_HASHES);
  if (!path) return hashes;
  try {
    const names = JSON.parse(readFile(path));
    if (Array.isArray(names)) for (const n of names) hashes.add(hashName(n));
  } catch { /* no local list, or it's unreadable - scan with the default set */ }
  return hashes;
}

function defaultReadFile(path) {
  return readFileSync(path, 'utf8');
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

// One Unicode letter/hyphen word per match, with the line it starts on.
// \p{L} rather than A-Za-z (bug-audit finding, 2026-09-13): a name
// containing a diacritic must still tokenize as one word, not fragment at
// the accented character. No apostrophe in the class: a name sitting inside
// a JS/JSON string literal ('Zorblax Prime') or Markdown text would
// otherwise absorb the closing quote into the last word ("Prime'"),
// silently breaking the hash match against the clean name. The rare loss
// (an apostrophe-containing name like "O'Brien" splits into two spans) is a
// smaller price than every quoted occurrence failing to match at all.
const WORD_RE = /\p{L}[\p{L}-]*/gu;

function wordsWithLines(text) {
  const words = [];
  let line = 1;
  let lastIndex = 0;
  for (const m of text.matchAll(WORD_RE)) {
    line += countNewlines(text, lastIndex, m.index);
    lastIndex = m.index;
    words.push({ word: m[0], line });
  }
  return words;
}

function countNewlines(text, from, to) {
  let n = 0;
  for (let i = from; i < to; i++) if (text[i] === '\n') n++;
  return n;
}

// Candidate name spans: every run of 1-3 consecutive words (so a two-word
// name like an approved persona's own "Van Gogh" pattern, or a two-word
// forbidden name, is checked as a unit, not only word-by-word) plus every
// single word on its own - spans deliberately cross line boundaries (a
// two-word name split by a Markdown line-wrap must still be caught; bug-
// audit finding, 2026-09-13), reported under the line the span STARTS on.
// Over-generous on purpose - a scanner that only checked single words, or
// only within one line, could miss a real name; false positives cost
// nothing here since the comparison is against a specific hash set, not a
// heuristic.
function candidateSpans(words) {
  const spans = [];
  for (let i = 0; i < words.length; i++) {
    spans.push({ span: words[i].word, line: words[i].line });
    if (i + 1 < words.length) spans.push({ span: `${words[i].word} ${words[i + 1].word}`, line: words[i].line });
    if (i + 2 < words.length) spans.push({ span: `${words[i].word} ${words[i + 1].word} ${words[i + 2].word}`, line: words[i].line });
  }
  return spans;
}

/**
 * Scan every text file under `root` (recursing into every subdirectory -
 * src/mcp/, src/ui/, docs/, chains/, tasks/, test/, all of it, not a
 * hand-picked subset, per the exact regression a prior version of this
 * lint hit) for any candidate name span whose hash is in `forbiddenHashes`
 * - in file CONTENT and in every file/directory NAME on the path (a
 * forbidden name used as a code-name for a file would otherwise never be
 * flagged; bug-audit finding, 2026-09-13). Returns findings; never throws
 * on an unreadable file or directory.
 */
export function scanForForbiddenNames(root, forbiddenHashes) {
  const hashes = forbiddenHashes instanceof Set ? forbiddenHashes : new Set(forbiddenHashes || []);
  const findings = [];
  if (!hashes.size) return { findings, filesScanned: 0 };

  const files = walk(root);
  for (const file of files) {
    // kebab-case/snake_case filenames are the common real-world shape for a
    // code-name-as-filename - "-"/"_" split into separate words here (unlike
    // prose content, where a hyphen usually joins one compound word) so
    // "zorblax-prime.js" tokenizes as "zorblax", "prime", not one fused word.
    const pathText = file.slice(root.length).replace(/[-_]/g, ' ');
    for (const { span } of candidateSpans(wordsWithLines(pathText))) {
      if (hashes.has(hashName(span))) {
        findings.push({ file, line: null, span, where: 'path' });
      }
    }
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const { span, line } of candidateSpans(wordsWithLines(text))) {
      if (hashes.has(hashName(span))) {
        // Unlike the key-redaction scan (candidate 11), the matched text
        // here is not a secret - it's a name already sitting in plain
        // sight in the file being scanned, so naming it in the finding
        // makes the failure fixable rather than a guessing game.
        findings.push({ file, line, span, where: 'content' });
      }
    }
  }
  return { findings, filesScanned: files.length };
}
