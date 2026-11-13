// 0.8.4 D8 (plan A T5.2): the harness, not the session, cuts the text of an excerpt. The session names a path and a line range (a whole file is the range from its first line to its last); this module
// reads that range from the file in the project directory the run started in and hands back the text with its hashes. Pure file work, $0, no model call. The caller (the pause that answers a text request, the
// session's own reads) records the entry (src/excerpt-record.js) and runs the scans (D20); this module only extracts or refuses.
//
// THE PATH CHECK is the safety of the channel: a wrong check is a data-exposure bug that the scans only partly cover (they catch shapes, not meaning). It is the jail of src/fence.js and src/tools.js, with
// its two classic gaps closed here on purpose: (1) the root and the named path are both resolved with realpath, and containment is decided with path.relative on the REAL paths (a string-prefix test lets
// `/proj-evil` pass for `/proj`); (2) the text is read from the REAL path that was checked, never from the name that was given. Refused, with no text read: a path outside the root ('..', an absolute path
// outside it), a symlink that leaves the root, a file on the secret and credential denylist or ignored by git (src/tools.js pathRefusal, the one place that defines it), a name with a control or
// bidi character in it, a directory, a missing file. The check and the read are two steps, so a file swapped between them is a limit of this module (the same limit as fence.js).
//
// -> { ok: true, path (relative, '/'-separated, from the real root), lines ('a-b', 1-based, inclusive), text, text_sha256, file_sha256, whole_file }
//  | { ok: false, reason, path } with reason one of outside_root, symlink_escape, denied, not_found, not_a_file, bad_name, bad_lines, unreadable, too_large (the text to keep holds more than MAX_CLIENT_FILE_BYTES bytes). No text is ever in a refusal.
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathRefusal, MAX_CLIENT_FILE_BYTES } from './tools.js';
import { createHash } from 'node:crypto';
import { sha256Of } from './excerpt-record.js';


/** WORDING D38-w5 (a), D10-w7, D10-w16: why a text was not cut, by the refusal's code (the codes of extractExcerpt, plus too_long: an approval screen cannot hold it, which only the resume's backstop in src/excerpt-resume.js says). */
export const REFUSAL_WORDS = Object.freeze({
  outside_root: 'it is outside the project folder',
  symlink_escape: 'it is a link that leaves the project folder',
  denied: 'it is a file the harness never reads (keys and credentials)',
  not_a_file: 'it is not a file',
  not_found: 'there is no such file',
  bad_name: 'its name has a control character',
  bad_lines: 'the lines do not fit the file',
  unreadable: 'it could not be read',
  too_long: 'it is longer than an approval screen can hold',
  too_large: `it holds more than ${MAX_CLIENT_FILE_BYTES} bytes to keep`,   // WORDING D10-w16: the cap is on the bytes the harness keeps, a whole file or a range alike
});

/**
 * THE ONE READER of both modes (C&C 09 Nov 2026: one module, two modes, one streaming reader, one jail). It reads the checked file in blocks, never the whole file at once, and KEEPS only the bytes of the lines a..b (b null = to the
 * last line): the cap is on the bytes kept, not on the bytes passed over, so a narrow range of a big file is still cut. A line is a run of bytes ended by 0x0A; a final newline ends the last line and does not start another; an empty
 * file is one empty line. Full mode hashes every block (the file's sha256 is of its bytes, so the reader runs to the end of the file: the time is that of the person's own file and range). Count mode (`countUpTo`) keeps nothing, hashes
 * nothing and stops as soon as it knows the file holds more than `countUpTo` lines, or (whole file) more than `cap` bytes, or (a named range) the range's bytes pass `cap`, or the range is behind it. -> { tooLarge } | { over } (count mode) | { total, kept: [Buffer], sha256 } (full mode: total lines in the file).
 */
function streamLines(real, { a, b, cap, countUpTo }) {
  const count = countUpTo !== undefined;
  const sumRange = count && b !== null;   // count mode of a NAMED range: sum the bytes that would be kept, stop at the range's end or the cap
  const track = !count || sumRange;
  const fd = openSync(real, 'r');
  const buf = Buffer.allocUnsafe(65536);
  const hash = count ? null : createHash('sha256');
  const kept = []; let keptBytes = 0;
  let line = 1; let total = 0; let cur = []; let curBytes = 0; let streamed = 0; let lastByte = 10; let sawData = false;
  const inRange = () => line >= a && (b === null || line <= b);
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      sawData = true; streamed += n; lastByte = buf[n - 1];
      if (hash) hash.update(buf.subarray(0, n));
      if (count && !sumRange && streamed > cap) return { tooLarge: true };
      const view = buf.subarray(0, n);
      let start = 0;
      while (start < n) {
        const nl = view.indexOf(10, start);
        const end = nl === -1 ? n : nl;
        if (track && inRange()) {
          if (!count) cur.push(Buffer.from(view.subarray(start, end)));   // a copy: the block buffer is reused
          curBytes += end - start;
          if (keptBytes + curBytes + (nl === -1 ? 0 : 1) > cap) return { tooLarge: true };
        }
        if (nl === -1) break;
        if (track && inRange()) { if (!count) kept.push(Buffer.concat(cur)); keptBytes += curBytes + 1; cur = []; curBytes = 0; }
        line += 1; total += 1;
        if (sumRange && line > b) return { over: false };   // the range is behind us: nothing more to sum, no hash at submit, no need to reach the end
        if (count && total > countUpTo) return { over: true };
        start = nl + 1;
      }
    }
    if (sawData && lastByte !== 10) {   // a last line without a newline still counts
      if (!count && inRange()) kept.push(Buffer.concat(cur));
      total += 1;
    } else if (!sawData) {   // an empty file is one empty line
      if (!count && inRange()) kept.push(Buffer.alloc(0));
      total = 1;
    }
  } finally { closeSync(fd); }
  return count ? { over: total > countUpTo } : { total, kept, sha256: hash.digest('hex') };
}

export const EXTRACT_REFUSALS = ['outside_root', 'symlink_escape', 'denied', 'not_found', 'not_a_file', 'bad_name', 'bad_lines', 'unreadable', 'too_large'];
const CONTROL_IN_NAME = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI_IN_NAME = [[0x202a, 0x202e], [0x2066, 0x2069]];   // the bidi embeddings, overrides and isolates: the same set as the name check of src/fence.js (controls and bidi only; joiners stay allowed in a file name)
const hiddenInName = name => CONTROL_IN_NAME.test(name) || [...name].some(ch => { const c = ch.codePointAt(0); return BIDI_IN_NAME.some(([a, b]) => c >= a && c <= b); });
const outside = rel => rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
const refuse = (reason, path) => ({ ok: false, reason, path: typeof path === 'string' ? path : String(path) });

/** "3-5", "7" (one line) or null/'' (the whole file) -> { a, b } (b null = to the last line), or null when it cannot be read as a range. */
export function parseLineRange(lines) {
  if (lines === null || lines === undefined || lines === '') return { a: 1, b: null };
  const m = /^\s*([1-9]\d*)\s*(?:-\s*([1-9]\d*))?\s*$/.exec(String(lines));
  if (!m) return null;
  const a = Number(m[1]); const b = m[2] === undefined ? a : Number(m[2]);
  return b < a ? null : { a, b };
}

/**
 * `countUpTo` (a number) is COUNT-ONLY mode, for src/stage-submission.js: every check up to the read is the same (one jail), then the SAME reader streams the file, keeping and hashing nothing; the answer is
 * { ok: true, path, over } with `over` = the file holds more than `countUpTo` lines (Infinity: never), or the refusal `too_large` once more than the byte cap has been streamed. A refusal is the same refusal.
 */
export function extractExcerpt(root, requestedPath, lines = null, { countUpTo } = {}) {
  const asked = requestedPath;
  if (typeof asked !== 'string' || asked.trim() === '') return refuse('not_found', asked);
  const range = parseLineRange(lines);
  let base;
  try { base = realpathSync(resolve(root)); } catch { return refuse('unreadable', asked); }
  const target = resolve(base, asked);
  if (outside(relative(base, target)) || relative(base, target) === '') return refuse('outside_root', asked);
  if (!existsSync(target)) return refuse('not_found', asked);
  let real;
  try { real = realpathSync(target); } catch { return refuse('not_found', asked); }
  const realRel = relative(base, real);
  if (outside(realRel) || realRel === '') return refuse('symlink_escape', asked);
  const rel = realRel.split(sep).join('/');
  if (hiddenInName(rel)) return refuse('bad_name', asked);
  let isFile;
  try { isFile = statSync(real).isFile(); } catch { return refuse('unreadable', asked); }
  if (!isFile) return refuse('not_a_file', rel);
  let denied;
  try { denied = pathRefusal(base, real); } catch { return refuse('denied', rel); }   // a .gitignore that cannot be checked refuses, as it does for the tools
  if (denied) return refuse('denied', rel);
  if (!range) return refuse('bad_lines', rel);
  let r;
  try { r = streamLines(real, { a: range.a, b: range.b, cap: MAX_CLIENT_FILE_BYTES, countUpTo }); } catch { return refuse('unreadable', rel); }   // the REAL path that was checked, never the name that was given
  if (r.tooLarge) return refuse('too_large', rel);
  if (countUpTo !== undefined) return { ok: true, path: rel, over: r.over };
  const b = range.b === null ? r.total : range.b;
  if (range.a > r.total || b > r.total) return refuse('bad_lines', rel);
  const text = r.kept.map(l => l.toString('utf8')).join('\n');
  return { ok: true, path: rel, lines: `${range.a}-${b}`, text, text_sha256: sha256Of(text), file_sha256: r.sha256, whole_file: range.a === 1 && b === r.total };
}
