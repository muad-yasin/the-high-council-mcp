// The files that hold the words a seat is sent (0.8.4, the roles.js split): src/roles.js (the one import point, a list of exports) and every src/prompts/*.js (the words). A test that reads the wording
// as TEXT (a byte pin, a source scan, a span between two exports) reads it through this helper, never src/roles.js by path, so the split moves no test: only the list below changes. Test code, not shipped.
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';

/** Repo-relative paths, in a fixed order: src/roles.js first, then the files under src/prompts/ sorted. test/wording-files.test.js pins that this list is exactly what is on disk. */
export const WORDING_FILES = Object.freeze([
  'src/roles.js',
  ...['alternatives', 'ambiguity', 'challenge', 'cold-read', 'core', 'debate', 'dispute', 'notes-lane', 'proposals', 'questions', 'recorded-082', 'recorded-083', 'recorded-084-a', 'recorded-084-a5', 'recorded-084-b', 'recorded-084-c', 'recorded-084-cache-order', 'recorded-084-d27', 'recorded-084-fixline', 'recorded-084-ledger-out', 'recorded-084-s14', 'recorded-084-s16', 'recorded-084-s8', 'recorded-084-s9', 'recorded-084-summary', 'scope', 'tiered'].map(n => `src/prompts/${n}.js`),
]);

/** The wording files' text, joined in WORDING_FILES order with one newline between files (one file: its bytes unchanged). `files` is a parameter only so a test can hand it a known-bad list; it throws on a file that is not there. */
export function wordingText(root, files = WORDING_FILES) {
  return files.map(f => readFileSync(join(root, f), 'utf8')).join('\n');
}

const readAll = (root, files) => files.map(f => [f, readFileSync(join(root, f), 'utf8')]);
const inOneFile = (root, marker, files) => {
  const hits = readAll(root, files).filter(([, t]) => t.includes(marker));
  if (hits.length !== 1) throw new Error(`${marker} is in ${hits.length} wording files, not exactly one`);
  return hits[0][1];
};

/** The text from `marker` (the start of an export, such as `export function criticUser(`) to the next top-level `\nexport ` IN THE SAME FILE, or to that file's end. The marker must be in exactly one wording file; a span never runs into the next file. */
export function wordingExportSpan(root, marker, files = WORDING_FILES) {
  const text = inOneFile(root, marker, files);
  const at = text.indexOf(marker);
  const next = text.indexOf('\nexport ', at + 10);
  return text.slice(at, next === -1 ? undefined : next);
}

/** The text from `from` up to (not including) `to`; both must be in the same single wording file, `from` before `to`. */
export function wordingBetween(root, from, to, files = WORDING_FILES) {
  const text = inOneFile(root, from, files);
  const a = text.indexOf(from), b = text.indexOf(to);
  if (b === -1 || b < a) throw new Error(`${to} does not follow ${from} in the same wording file`);
  return text.slice(a, b);
}

/** The input of the byte pin (test/prompt-pin.test.js ROLES_SHA256): each wording file as its repo path, one NUL byte and the file's bytes, in WORDING_FILES order. A moved word, a renamed file or a changed order all change it. */
export function wordingPinInput(root, files = WORDING_FILES) {
  return Buffer.concat(files.flatMap(f => [Buffer.from(`${f}\0`, 'utf8'), readFileSync(join(root, f))]));
}
