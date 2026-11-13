// 0.8.4 D8 (plan A T5.2, test/excerpt-extract.test.js of the plan): the harness cuts the text of an excerpt from the named lines of a file in the project directory, and the PATH CHECK refuses everything that leaves it.
// The path check has a named fail condition (C&C, 09 Nov 2026): the root is the project directory the run started in; the named path is resolved with realpath and must stay inside it; '..', an absolute path
// outside it and a symlink that leaves the root are refused with a reason and NO text read. FAILS WHEN any path outside the real root is read, or any refusal carries a byte of the file. Offline, $0.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as X from '../src/excerpt-extract.js';
import { fenceFile } from '../src/fence.js';

const sha = t => createHash('sha256').update(t).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'thc-extract-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const SECRET = 'OUTSIDE-FILE-CONTENT-never-to-be-read';
const proj = join(scratch, 'proj');
const evil = join(scratch, 'proj-evil');   // a sibling whose name starts with the root's name: a string-prefix check would let it pass
mkdirSync(join(proj, 'src'), { recursive: true }); mkdirSync(evil, { recursive: true }); mkdirSync(join(scratch, 'elsewhere'), { recursive: true });
const FILE = 'line one\nline two\nline three\nline four\nline five\nline six\n';
writeFileSync(join(proj, 'src', 'a.js'), FILE);
writeFileSync(join(proj, 'no-newline.txt'), 'only\nsecond');
writeFileSync(join(proj, '.env'), 'KEY=value\n');
writeFileSync(join(proj, 'bad\nname.txt'), 'x'); writeFileSync(join(proj, 'rtl\u202ename.txt'), 'x');
const BYTES = Buffer.concat([Buffer.from('caf\u00e9\nsecond\n'), Buffer.from([0xff, 0xfe]), Buffer.from('\nthird\n')]);   // an invalid UTF-8 byte pair: the decoded text is not the file
writeFileSync(join(proj, 'odd-bytes.txt'), BYTES);
writeFileSync(join(evil, 'x.txt'), SECRET);
writeFileSync(join(scratch, 'elsewhere', 'out.txt'), SECRET);
symlinkSync(join(scratch, 'elsewhere', 'out.txt'), join(proj, 'link-out.txt'));
symlinkSync(join(scratch, 'elsewhere'), join(proj, 'dir-out'));
symlinkSync(join(proj, 'src', 'a.js'), join(proj, 'link-in.js'));
const linkedRoot = join(scratch, 'root-link'); symlinkSync(proj, linkedRoot);
const noText = r => { assert.equal(r.ok, false); assert.equal('text' in r, false, 'a refusal carries no text'); assert.equal(JSON.stringify(r).includes(SECRET), false, 'and no byte of the outside file'); return r.reason; };

test('T5.2 / plan l.649: src/a.js lines 3-5 yields exactly those lines, with the hash of that text and of the whole file', () => {
  const r = X.extractExcerpt(proj, 'src/a.js', '3-5');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'line three\nline four\nline five');
  assert.equal(r.path, 'src/a.js'); assert.equal(r.lines, '3-5'); assert.equal(r.whole_file, false);
  assert.equal(r.text_sha256, sha('line three\nline four\nline five'));
  assert.equal(r.file_sha256, sha(FILE));
});

test('a whole file is the range from its first to its last line; one line is "n"; a file without a final newline keeps its last line', () => {
  const whole = X.extractExcerpt(proj, 'src/a.js');
  assert.equal(whole.lines, '1-6'); assert.equal(whole.whole_file, true); assert.equal(whole.text, FILE.slice(0, -1));
  assert.equal(X.extractExcerpt(proj, 'src/a.js', '2').text, 'line two');
  assert.equal(X.extractExcerpt(proj, 'no-newline.txt', '1-2').text, 'only\nsecond');
});

test('PATH CHECK: an absolute path outside the root is refused as outside_root, with no text', () => {
  assert.equal(noText(X.extractExcerpt(proj, join(scratch, 'elsewhere', 'out.txt'))), 'outside_root');
});

test('PATH CHECK: ".." out of the root is refused as outside_root, however it is spelled', () => {
  for (const p of ['../elsewhere/out.txt', 'src/../../elsewhere/out.txt', './../proj-evil/x.txt']) assert.equal(noText(X.extractExcerpt(proj, p)), 'outside_root', p);
});

test('PATH CHECK: a sibling directory whose name starts with the root\'s name is outside (no string-prefix test)', () => {
  assert.equal(noText(X.extractExcerpt(proj, join(evil, 'x.txt'))), 'outside_root');
  assert.equal(noText(X.extractExcerpt(proj, '../proj-evil/x.txt')), 'outside_root');
});

test('PATH CHECK: a symlink inside the root that points outside it is refused as symlink_escape, file or directory', () => {
  assert.equal(noText(X.extractExcerpt(proj, 'link-out.txt')), 'symlink_escape');
  assert.equal(noText(X.extractExcerpt(proj, 'dir-out/out.txt')), 'symlink_escape');
});

test('PATH CHECK: a symlink that stays inside the root is read, and the entry names the real file', () => {
  const r = X.extractExcerpt(proj, 'link-in.js', '1-1');
  assert.equal(r.ok, true); assert.equal(r.path, 'src/a.js'); assert.equal(r.text, 'line one');
});

test('PATH CHECK: a root that is itself a symlink works, and the real root is the boundary', () => {
  assert.equal(X.extractExcerpt(linkedRoot, 'src/a.js', '1').text, 'line one');
  assert.equal(noText(X.extractExcerpt(linkedRoot, join(evil, 'x.txt'))), 'outside_root');
  assert.equal(noText(X.extractExcerpt(linkedRoot, 'link-out.txt')), 'symlink_escape');
});

test('the root itself and a directory are not files; a missing file is a recorded refusal, never a throw', () => {
  assert.equal(noText(X.extractExcerpt(proj, '.')), 'outside_root');
  assert.equal(noText(X.extractExcerpt(proj, 'src')), 'not_a_file');
  assert.equal(noText(X.extractExcerpt(proj, 'src/missing.js')), 'not_found');
  for (const p of ['', '   ', null, undefined, 42]) assert.equal(noText(X.extractExcerpt(proj, p)), 'not_found', String(p));
});

test('the secret and credential denylist refuses a file inside the root (.env), with no text', () => {
  assert.equal(noText(X.extractExcerpt(proj, '.env')), 'denied');
});

test('a name with a control or bidi character is refused (it would write a line of its own into a heading)', () => {
  writeFileSync(join(proj, 'bad\nname.txt'), 'x'); writeFileSync(join(proj, `rtl${String.fromCharCode(0x202e)}name.txt`), 'x');
  assert.equal(noText(X.extractExcerpt(proj, 'bad\nname.txt')), 'bad_name');
  assert.equal(noText(X.extractExcerpt(proj, `rtl${String.fromCharCode(0x202e)}name.txt`)), 'bad_name');
});

test('lines that cannot be a range, or run past the end of the file, are refused as bad_lines', () => {
  for (const l of ['0', '0-2', '5-3', 'x', '1-', '-3', '3-99', '7', '1-7', '1,2']) assert.equal(noText(X.extractExcerpt(proj, 'src/a.js', l)), 'bad_lines', l);
  assert.deepEqual(X.parseLineRange(' 3 - 5 '), { a: 3, b: 5 });
  assert.deepEqual(X.parseLineRange(null), { a: 1, b: null });
});

test('every refusal reason is in the exported list (the caller\'s switch has no unnamed case)', () => {
  const seen = new Set();
  for (const [p, l] of [[join(scratch, 'elsewhere', 'out.txt'), null], ['link-out.txt', null], ['.env', null], ['nope', null], ['src', null], ['src/a.js', '9-10'], ['bad\nname.txt', null]]) {
    const r = X.extractExcerpt(proj, p, l); if (!r.ok) seen.add(r.reason);
  }
  for (const reason of seen) assert.ok(X.EXTRACT_REFUSALS.includes(reason), reason);
  assert.deepEqual([...seen].sort(), ['bad_lines', 'bad_name', 'denied', 'not_a_file', 'not_found', 'outside_root', 'symlink_escape']);
});

test('file_sha256 is the hash of the file\'s BYTES (checkable with sha256sum), also when a byte is not valid UTF-8; an ASCII file gives the same on both readings', () => {
  const r = X.extractExcerpt(proj, 'odd-bytes.txt', '1-2');
  assert.equal(r.ok, true); assert.equal(r.text, 'caf\u00e9\nsecond');
  assert.equal(r.file_sha256, sha(readFileSync(join(proj, 'odd-bytes.txt'))));
  assert.notEqual(r.file_sha256, sha(readFileSync(join(proj, 'odd-bytes.txt'), 'utf8')), 'the decoded text would give another hash');
  assert.equal(X.extractExcerpt(proj, 'src/a.js').file_sha256, sha(readFileSync(join(proj, 'src', 'a.js'))));
});

test('DRIFT GUARD: the third jail agrees with the fence\'s on accept or refuse for every fixture path (one place defines what a lab may see)', () => {
  const accepts = f => { try { fenceFile(proj, f); return true; } catch { return false; } };
  const paths = ['src/a.js', 'link-in.js', 'no-newline.txt', join(scratch, 'elsewhere', 'out.txt'), '../elsewhere/out.txt', '../proj-evil/x.txt', join(evil, 'x.txt'), 'link-out.txt', 'dir-out/out.txt', '.env', 'src/missing.js', 'src', '.', 'bad\nname.txt', 'rtl\u202ename.txt'];
  const disagree = paths.filter(p => accepts(p) !== X.extractExcerpt(proj, p).ok);
  assert.deepEqual(disagree, [], 'paths where fenceFile and extractExcerpt differ');
});

// ---- COUNT-ONLY mode (C&C 09 Nov 2026, whole files counted at submit): the SAME jail, no text, a count that stops at the bound ------------------------------------------------------------------------------------
test('COUNT-ONLY: every refusal is the extraction\'s own refusal (same code, same path), for each name that extraction refuses, and no text is returned', () => {
  const names = ['../elsewhere/out.txt', 'link-out.txt', 'dir-out/out.txt', '.env', 'nope.txt', 'src', `bad\nname.txt`, `rtl${String.fromCharCode(0x202e)}name.txt`, '/etc/hostname', proj + '-evil/x.txt'];
  for (const name of names) {
    const full = X.extractExcerpt(proj, name, null);
    const count = X.extractExcerpt(proj, name, null, { countUpTo: 10 });
    assert.equal(count.ok, false, name);
    assert.deepEqual([count.reason, count.path], [full.reason, full.path], name);
    assert.equal('text' in count, false);
  }
});

test('COUNT-ONLY: over means more than the bound by extraction\'s own rule of lines (a last line without a newline counts; an empty file is one line), at the bound with and without a final newline', () => {
  const put = (name, text) => { writeFileSync(join(proj, name), text); return name; };
  const lines = n => 'l\n'.repeat(n);
  for (const [name, text, count] of [['c3.txt', lines(3), 3], ['c3b.txt', lines(2) + 'l', 3], ['c0.txt', '', 1], ['c1.txt', 'x', 1], ['cblank.txt', '\n\n', 2]]) {
    put(name, text);
    const full = X.extractExcerpt(proj, name, null);
    assert.equal(full.text.split('\n').length, count, `${name}: the fixture's line count by extraction`);
    assert.equal(X.extractExcerpt(proj, name, null, { countUpTo: count }).over, false, `${name}: exactly at the bound is within`);
    assert.equal(X.extractExcerpt(proj, name, null, { countUpTo: count - 1 }).over, true, `${name}: one more than the bound is over`);
  }
  // a file longer than one read block still counts right (65536-byte blocks)
  put('big.txt', lines(40000));
  assert.deepEqual([X.extractExcerpt(proj, 'big.txt', null, { countUpTo: 40000 }).over, X.extractExcerpt(proj, 'big.txt', null, { countUpTo: 39999 }).over], [false, true]);
});

// ---- THE BYTE CAP (C&C 09 Nov 2026, (b)): the cap is on the bytes the harness KEEPS, not on the bytes it passes over; one streaming reader, both modes -----------------------------------------------------------------
import { MAX_CLIENT_FILE_BYTES } from '../src/tools.js';
const writeBig = () => writeFileSync(join(proj, 'bigfile.txt'), `first\n${'x'.repeat(MAX_CLIENT_FILE_BYTES + 1000)}\nthird\nfourth\n`);   // shared by the two tests below, so either runs alone
test('BYTE CAP, a range inside a file over the cap is CUT (and the file hash is still of the whole file): the cap is on the bytes kept; a giant line BEFORE the range does not stop it', () => {
  writeBig();
  const head = X.extractExcerpt(proj, 'bigfile.txt', '1-1');
  assert.deepEqual([head.ok, head.text, head.lines, head.whole_file], [true, 'first', '1-1', false]);
  assert.equal(head.file_sha256, createHash('sha256').update(readFileSync(join(proj, 'bigfile.txt'))).digest('hex'), 'the hash is of the file\'s bytes');
  const tail = X.extractExcerpt(proj, 'bigfile.txt', '3-4');
  assert.deepEqual([tail.ok, tail.text, tail.lines], [true, 'third\nfourth', '3-4'], 'a narrow range AFTER a multi-megabyte line is cut');
  assert.equal(X.extractExcerpt(proj, 'bigfile.txt', '2-4').reason, 'too_large', 'the swapped input: the same tail range widened to take the giant line in is refused');
});

test('BYTE CAP, refusals: a giant line INSIDE the range, a range whose kept bytes pass the cap, and a whole file over the cap are not_cut (too_large); the same whole file in count-only mode; exactly the cap is within, in both modes', () => {
  const cap = MAX_CLIENT_FILE_BYTES;
  writeBig();
  assert.equal(X.extractExcerpt(proj, 'bigfile.txt', '2-2').reason, 'too_large');
  assert.equal(X.extractExcerpt(proj, 'bigfile.txt', '1-3').reason, 'too_large');
  assert.equal(X.extractExcerpt(proj, 'bigfile.txt', null).reason, 'too_large');
  assert.equal(X.extractExcerpt(proj, 'bigfile.txt', null, { countUpTo: Infinity }).reason, 'too_large');
  assert.match(X.REFUSAL_WORDS.too_large, new RegExp(`${cap} bytes`));
  writeFileSync(join(proj, 'exact-cap.txt'), 'y'.repeat(cap));
  writeFileSync(join(proj, 'exact-cap-nl.txt'), `${'y'.repeat(cap - 1)}\n`);
  writeFileSync(join(proj, 'cap-plus-nl.txt'), `${'y'.repeat(cap)}\n`);
  for (const name of ['exact-cap.txt', 'exact-cap-nl.txt']) {
    assert.equal(X.extractExcerpt(proj, name, null).ok, true, `${name}: exactly the cap is kept`);
    assert.equal(X.extractExcerpt(proj, name, null, { countUpTo: Infinity }).ok, true, `${name}: and counted`);
  }
  assert.equal(X.extractExcerpt(proj, 'cap-plus-nl.txt', null).reason, 'too_large');
  assert.equal(X.extractExcerpt(proj, 'cap-plus-nl.txt', null, { countUpTo: Infinity }).reason, 'too_large', 'count-only and full extraction agree at the bound');
  // count-only of a NAMED range sums the bytes that would be kept (C&C 09 Nov 2026, (b)) and agrees with the full extraction on every range of the big file
  for (const range of ['1-1', '2-2', '1-3', '3-4', '2-4']) {
    const full = X.extractExcerpt(proj, 'bigfile.txt', range);
    const counted = X.extractExcerpt(proj, 'bigfile.txt', range, { countUpTo: Infinity });
    assert.equal(counted.ok, full.ok, range);
    if (!full.ok) assert.equal(counted.reason, full.reason, range);
  }
});
