// The helper test/helpers/wording-files.js (0.8.4, roles.js split, row S0): the list is what is on disk, and the text it returns is the files' text. Two tests, because a helper that returned the right list and empty text would
// make every reader that asserts an ABSENCE (no applySeatRole, no Math.random in the wording) pass without reading a word, in the full suite too. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORDING_FILES, wordingText } from './helpers/wording-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the listing: WORDING_FILES is src/roles.js plus every .js file under src/prompts/ (found on disk, sorted), in that order, and each file exists', () => {
  const dir = join(root, 'src', 'prompts');
  const onDisk = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.js')).map(f => `src/prompts/${f}`).sort() : [];
  assert.deepEqual([...WORDING_FILES], ['src/roles.js', ...onDisk]);
  for (const f of WORDING_FILES) assert.ok(statSync(join(root, f)).isFile(), `${f} is a file`);
});

const direct = () => WORDING_FILES.map(f => readFileSync(join(root, f), 'utf8'));
// words that move with the wording (they are in whichever file holds the critic prompt builders), so these checks survive a split of src/roles.js
const ANCHORS = ['export function criticUser(', 'export function criticSystem(', 'export function judgePersonaBlock('];

test('the content: wordingText(root) is each listed file read directly, joined in order with one newline', () => {
  assert.equal(wordingText(root), direct().join('\n'));
});

test('the content is whole: every wording file is non-empty and sits whole inside the text, and the text holds the anchors the prompt builders define', () => {
  const text = wordingText(root);
  for (const p of direct()) { assert.ok(p.length > 0, 'a wording file is empty'); assert.ok(text.includes(p), 'a wording file is cut or missing from the text'); }
  for (const a of ANCHORS) assert.ok(text.includes(a), `the text lacks ${a}`);
});

test('one file: its bytes unchanged (so the byte pin of an unsplit tree is unaffected)', () => {
  assert.equal(wordingText(root, ['src/roles.js']), readFileSync(join(root, 'src/roles.js'), 'utf8'));
});

test('a list naming a missing file is an error, never an empty string', () => {
  assert.throws(() => wordingText(root, [...WORDING_FILES, 'src/prompts/not-there.js']), /ENOENT/);
});

test('an empty set is not the wording', () => {
  assert.notEqual(wordingText(root, []), wordingText(root));
});

// ---- spans: a span of one export never runs into the next file (a split puts the last export of a file next to the header and imports of the next one) ----
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const W = await import('./helpers/wording-files.js');   // the span helpers are read off the namespace: a missing one fails each test that uses it by name

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wording-spans-'));
  writeFileSync(join(dir, 'a.js'), "// file a\nexport function first() {\n  return 'one';\n}\nexport function last() {\n  return 'the last export of a';\n}\n");
  writeFileSync(join(dir, 'b.js'), "// HEADER OF B: role seat applySeatRole\nimport { x } from './x.js';\nexport function other() {\n  return 'b';\n}\n");
  return dir;
};
const FILES = ['a.js', 'b.js'];

test('a span ends at the next export of its own file', () => {
  assert.equal(W.wordingExportSpan(fixture(), 'export function first(', FILES), "export function first() {\n  return 'one';\n}");
});

test('the LAST export of a file ends at that file\'s end: it does not run into the header and imports of the next file', () => {
  const span = W.wordingExportSpan(fixture(), 'export function last(', FILES);
  assert.equal(span, "export function last() {\n  return 'the last export of a';\n}\n");
  assert.doesNotMatch(span, /HEADER OF B|import \{ x \}/);
});

test('a marker that is in no file, or in two, is an error', () => {
  const dir = fixture();
  assert.throws(() => W.wordingExportSpan(dir, 'export function nowhere(', FILES), /0 wording files/);
  assert.throws(() => W.wordingExportSpan(dir, 'return', FILES), /2 wording files|3 wording files|exactly one/);
});

test('wordingBetween: from one marker up to the next, in one file; an end marker before the start, or in another file, is an error', () => {
  const dir = fixture();
  assert.equal(W.wordingBetween(dir, 'export function first(', 'export function last(', FILES), "export function first() {\n  return 'one';\n}\n");
  assert.throws(() => W.wordingBetween(dir, 'export function last(', 'export function first(', FILES), /does not follow/);
  assert.throws(() => W.wordingBetween(dir, 'export function last(', 'export function other(', FILES), /does not follow/);
});

test('on the real wording: criticUser and criticSystem spans are non-empty, end before the next export and hold no export of their own beyond the first', () => {
  for (const marker of ['export function criticUser(', 'export function criticSystem(', 'export function criticUserHead(']) {
    const span = W.wordingExportSpan(root, marker);
    assert.ok(span.startsWith(marker) && span.length > 50, marker);
    assert.ok(!span.slice(marker.length).includes('\nexport '), `${marker} span holds another export`);
  }
});

test('the pin input: each wording file as its repo path, one NUL byte and its bytes, in WORDING_FILES order (so a moved word, a renamed file or a changed order moves the pin)', () => {
  const dir = fixture();
  const input = W.wordingPinInput(dir, FILES);
  assert.ok(Buffer.isBuffer(input));
  assert.equal(input.toString('utf8'), `a.js\0${readFileSync(join(dir, 'a.js'), 'utf8')}b.js\0${readFileSync(join(dir, 'b.js'), 'utf8')}`);
  assert.notEqual(W.wordingPinInput(dir, ['b.js', 'a.js']).toString('utf8'), input.toString('utf8'), 'order is part of the pin');
  const real = W.wordingPinInput(root);
  assert.ok(real.length > readFileSync(join(root, 'src/roles.js')).length, 'the pin covers the prompts files, not roles.js alone');
});
