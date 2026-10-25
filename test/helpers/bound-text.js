// Shared by the `tree decide` tests that pin "what the person read is what was hashed" (0.8.3 M5g, C&C's K10 order) and the fail-fast refusals. Not a test file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../../src/thin-contract.js';

/** What terminalSafe removes (src/terminal-safe.js), spelled out here on purpose: the test must not borrow the function it checks. */
// eslint-disable-next-line no-control-regex
export const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/;
/** A word with a control character and a bidi override inside it, and the word as it must read once cleaned. */
export const dirty = (word, cut = 4) => ({ raw: `${word.slice(0, cut)}‮${word.slice(cut)}\u0007`, clean: word });
/** The same, with a ZERO-WIDTH SPACE (U+200B, built from its number) inside the word as well: terminalSafe leaves it, the gate text must MARK it in place as [U+200B] (audit item 7, commit 2), so the word as it must read is the word with that token. */
export const dirtyMarked = (word, cut = 4) => ({ raw: `${word.slice(0, cut)}‮${String.fromCodePoint(0x200B)}${word.slice(cut)}\u0007`, clean: `${word.slice(0, cut)}[U+200B]${word.slice(cut)}` });

/**
 * The gate text of a tree gate (kind: tree_decide by default, tree_frontier for `tree approve`), found by the hash the record kept: its sha256 IS that hash, it holds no unsafe character, it carries the injected word (so the check can fail), and the screen showed it
 * (clean) as well. `shownSha256` is the field of the event the decision wrote.
 */
export function assertBoundTextClean({ rootDir, shownSha256, shown, word, kind = 'tree_decide' }) {
  assert.match(String(shownSha256), /^[0-9a-f]{64}$/, 'the event carries the hash of the text read');
  const text = readFileSync(join(rootDir, 'tree', 'gate-texts', `${kind}-${shownSha256.slice(0, 16)}.txt`), 'utf8');
  assert.equal(sha256Of(text), shownSha256, 'the hash the record bound is the hash of the gate text');
  assert.equal(UNSAFE.test(text), false, 'the gate text (and so the hashed text) holds no control or bidi character');
  for (const ch of [String.fromCodePoint(0x200B)]) assert.equal(text.includes(ch) || shown.includes(ch), false, 'a hidden character is MARKED in place as [U+XXXX], never left raw in the hashed text or on the screen');
  for (const ch of ['\u202e', '\u0007']) assert.equal(shown.includes(ch), false, `nor does the screen (U+${ch.codePointAt(0).toString(16)}); the prompt's own cursor codes are not model text`);
  assert.ok(text.includes(word), `the injected field reached the gate text (${JSON.stringify(word)}), so a missing terminalSafe would show`);
  assert.ok(shown.includes(word), 'and the screen shows the same words');
  return text;
}

/** Runs a decide whose guard must refuse: stdin is closed first, so a run that wrongly asks a person ends (with the text on screen) instead of waiting; a timer turns any remaining wait into a failure. */
export async function assertRefusedWithoutAsking(d, pattern, { code = 1 } = {}) {
  d.io.stdin.end();
  let timer;
  const gave = await Promise.race([d.run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('still waiting for an answer: the guard did not refuse before asking')), 5000); })]);
  clearTimeout(timer);
  assert.equal(d.io.shown(), '', 'nobody was shown a text or asked a question');
  assert.match(d.io.errors(), pattern);
  assert.equal(gave, code);
}
