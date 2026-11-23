// 0.8.4 S20 slice 2, Q1 (RU-S20-12, RU-S20-13, T22i, T22j, T22r; C&C's R155 and R161): a ruling is the PERSON'S own text. When the handler session relays one, the person's quoted words must CONTAIN the ruling text; "Yes" alone is refused.
// The comparison (src/rulings.js rulingTextInWords): every run of whitespace (JavaScript's own \s: the non-breaking space and the other Unicode spaces included) is collapsed to one space on BOTH sides and both are trimmed, then plain containment; the words may hold more.
// Case and punctuation stay EXACT, and a word split by a hyphen at a line end is a different text and stays refused. The record is NOT normalised: the words are stored as typed. Offline, $0.
// Rules of the rule: withdrawals are program-built texts and are out of it (re-tags left the gate at M1 S19 (c): they are the handler's own act, src/handler-retags.js); the terminal channel takes no words and is unchanged; an unparseable ruling gate is refused (fail closed).
// WHERE EACH KIND'S TEXT IS STORED (R161): written into the run folder BEFORE its gate is requested (askForGate), and resolved against that stored file by hash, never against a fresh render:
//   ruling      ruling-<pass>-<sha8>.md                       (rulingGateText: "Ruling from pass N" + the text)
//   withdrawal  ruling-withdrawal-<gate>-<pass>-<sha8>.md      (withdrawalGateText)
// gate_answered carries `sha256` of the bound text (hash-chained at approval); rulingsOf lists a gate whose stored file is missing or altered as `unreadable` (UNRESOLVED), never as a ruling and never re-rendered (S-1).
// Evidence that a row can fail: the helper rows (H-*) and the two refusing gate rows (G-1, G-4) fail on the tree without the rule; the pins (G-7, G-8, S-1) hold on both trees and carry their own control inside the row (an unaltered gate resolves).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestRuling, requestWithdrawal, requestGate, answerGate, answerGateAsRelay, readGateAnswer, rulingsOf, textSha256 } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';

const T0 = Date.parse('2026-11-04T12:00:00.000Z');
const now = () => T0;
const TEXT = 'Replace E5 by the amended R19.';
// loaded inside each row, so a tree without the helper fails the rows one by one (the export does not exist there)
const contains = async (words, text) => (await import('../src/rulings.js')).rulingTextInWords(words, text);
const folder = () => { const d = join(mkdtempSync(join(tmpdir(), 'rt-words-')), 'run-1'); mkdirSync(d); return d; };
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const shown = (d, id) => readGateAnswer(d, id, { now }).gate.sha256;
const relay = (d, id, personWords) => answerGateAsRelay(d, id, { shownSha256: shown(d, id), reason: 'relayed on the person\'s permission', personWords }, { now });
const ask = (d, over = {}) => { const r = requestRuling(d, { pass: 3, text: TEXT, relayed: true, ...over }, { now }); assert.equal(r.ok, true, JSON.stringify(r)); return r.gate.id; };

test('H-1 the helper: the ruling text exactly, and inside longer words, is contained', async () => {
  assert.equal(await contains(TEXT, TEXT), true);
  assert.equal(await contains(`Yes: ${TEXT} Please do.`, TEXT), true, 'the words may hold more');
});

test('H-2 the helper: whitespace-only differences are accepted: a line break from a wrapped handler window, a double space, a tab, a non-breaking space, an ideographic space, white space at the ends', async () => {
  assert.equal(await contains('Yes: Replace E5 by the\namended R19.', TEXT), true, 'a wrapped line');
  assert.equal(await contains('Replace  E5\tby the amended R19.', TEXT), true, 'a double space and a tab');
  assert.equal(await contains('Replace E5 by the amended　R19.', TEXT), true, 'JavaScript \\s includes the non-breaking space and the ideographic space');
  assert.equal(await contains(`  \n ${TEXT} \n`, TEXT), true, 'white space at the ends');
  assert.equal(await contains(TEXT, 'Replace E5  by the\namended R19.'), true, 'and on the text side too: both sides are collapsed');
});

test('H-3 the helper: a one-character CASE difference is refused', async () => {
  assert.equal(await contains('yes: replace E5 by the amended R19.', TEXT), false);
  assert.equal(await contains('Replace e5 by the amended R19.', TEXT), false);
});

test('H-4 the helper: a PUNCTUATION difference is refused (the final period, a comma)', async () => {
  assert.equal(await contains('Replace E5 by the amended R19', TEXT), false, 'no final period');
  assert.equal(await contains('Replace E5, by the amended R19.', TEXT), false, 'an added comma');
});

test('H-5 the helper: a word split by a hyphen at a line end is a DIFFERENT text and stays refused (the wrap must not add characters)', async () => {
  assert.equal(await contains('Replace E5 by the amend-\ned R19.', TEXT), false);
});

test('H-6 the helper: an empty text or empty words never match', async () => {
  assert.equal(await contains('anything', ''), false);
  assert.equal(await contains('anything', '   \n'), false);
  assert.equal(await contains('', TEXT), false);
});

test('G-1 a relayed ruling whose words do not contain the text is refused with its own code and nothing is recorded; the gate stays pending', async () => {
  const d = folder(); const id = ask(d);
  const before = ledger(d).length;
  for (const words of ['Yes', 'ok, do it', 'Yes, replace e5 by the amended R19.', 'Replace E5 by the amended R19']) {
    const r = relay(d, id, words);
    assert.deepEqual([r.ok, r.code], [false, 'person_words_text'], `${JSON.stringify(words)}: ${JSON.stringify(r)}`);
  }
  assert.equal(ledger(d).length, before, 'nothing appended');
  assert.equal(readGateAnswer(d, id, { now }).status, 'pending');
});

test('G-2 (control) words that contain the text, line breaks and all, are accepted and STORED AS TYPED', () => {
  const d = folder(); const id = ask(d);
  const words = 'Yes: Replace E5 by the\namended R19. Go ahead.';
  const r = relay(d, id, words);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rulingsOf(d, { now }).rulings[0].person_words, words, 'byte-exact: line breaks and the non-breaking space kept');
  assert.equal(ledger(d).find(l => l.event === 'gate_answered').person_words, words);
});

test('G-3 (control) empty words keep their own code: person_words_required', () => {
  const d = folder(); const id = ask(d);
  assert.equal(relay(d, id, '').code, 'person_words_required');
  assert.equal(relay(d, id, '   ').code, 'person_words_required');
});

test('G-4 fail closed: a ruling gate whose stored text is not exactly a ruling cannot be approved by a relay, whatever the words say', () => {
  const d = folder();
  writeFileSync(join(d, 'ruling-bad.md'), 'Just some words, not a ruling.\n');
  const g = requestGate(d, { kind: 'ruling', textPath: 'ruling-bad.md', expiresAt: T0 + 3600e3, requestedBy: 'session' }, { now });
  assert.equal(g.ok, true, JSON.stringify(g));
  const before = ledger(d).length;
  const r = relay(d, g.gate.id, 'Just some words, not a ruling.');
  assert.deepEqual([r.ok, r.code], [false, 'gate_text_unreadable'], JSON.stringify(r));
  assert.equal(ledger(d).length, before);
});

// CHANGED ACCEPTED (0.8.4 S19 (c), H-M1-r4; a row of D's slice 2). OLD: G-5 covered a withdrawal AND a re-tag (requestRetag, relayed with 'yes, lower it'). NEW: the withdrawal only. WHY: the re-tag gate is removed (the handler session's re-tag is its own act, no person's words: N23, W38; C&C's G4). RED BEFORE (c): none by name: the removed half cannot be asserted green or red on a tree that has no requestRetag; the kept half is green by design.
test('G-5 (control, scope) a withdrawal is a program-built text: it still needs the person\'s words but not their text', () => {
  const d = folder(); const g1 = ask(d, { pass: 2 });
  assert.equal(relay(d, g1, `Yes: ${TEXT}`).ok, true);
  const w = requestWithdrawal(d, { gate: g1, pass: 3, relayed: true }, { now }); assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(relay(d, w.gate.id, '').code, 'person_words_required');
  assert.equal(relay(d, w.gate.id, 'yes, drop it').ok, true, 'a withdrawal: words that do not contain its text');
});

test('G-6 (control) the terminal channel takes no words and is unchanged: a person\'s own approval of a ruling is a ruling with no words', () => {
  const d = folder(); const r = requestRuling(d, { pass: 3, text: TEXT }, { now });
  const a = answerGate(d, r.gate.id, { channel: 'cli', shownSha256: shown(d, r.gate.id), decision: 'approved', actor: 'tester', tty: true }, { now });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual([rulingsOf(d, { now }).rulings[0].channel, rulingsOf(d, { now }).rulings[0].person_words], ['cli', null]);
});

// CHANGED ACCEPTED (0.8.4 S19 (c), H-M1-r4). OLD: G-7 pinned the answered line's sha256 for all three kinds (ruling, withdrawal, re-tag). NEW: two kinds. WHY: the re-tag kind is removed. RED BEFORE (c): none by name (green by design for the kept kinds).
test('G-7 (pin) the answered line carries the sha256 of the bound text, for both kinds: the reference a reader resolves by hash', () => {
  const d = folder(); const g1 = ask(d, { pass: 2 });
  assert.equal(relay(d, g1, TEXT).ok, true);
  const w = requestWithdrawal(d, { gate: g1, pass: 3, relayed: true }, { now }); assert.equal(relay(d, w.gate.id, 'drop it').ok, true);
  for (const id of [g1, w.gate.id]) {
    const answered = ledger(d).find(l => l.event === 'gate_answered' && l.gate === id);
    const file = readGateAnswer(d, id, { now }).gate.text;
    assert.equal(answered.sha256, textSha256(readFileSync(join(d, file))), `${id}: the answered line names the hash of the stored text ${file}`);
  }
});

test('G-8 (pin) a "yes" recorded against the hash of a DIFFERENT text is refused: the gate binds every answer to the exact text shown', () => {
  const d = folder(); const id = ask(d);
  const before = ledger(d).length;
  const r = answerGateAsRelay(d, id, { shownSha256: textSha256(Buffer.from('some other text\n')), reason: 'relayed', personWords: `Yes: ${TEXT}` }, { now });
  assert.deepEqual([r.ok, r.code], [false, 'hash_mismatch'], JSON.stringify(r));
  assert.equal(ledger(d).length, before);
});

// CHANGED ACCEPTED (0.8.4 S19 (c), H-M1-r4). OLD: S-1 covered the ruling, its withdrawal and the re-tag (retagsOf listed a re-tag whose stored text was missing as unreadable). NEW: the ruling and its withdrawal; the 'missing stored file' case now removes the WITHDRAWAL's text and expects it listed unreadable by rulingsOf. WHY: the re-tag kind is removed; the pin it carried (a missing or altered stored text is never dropped silently) still holds for the two kinds. RED BEFORE (c): none by name (green by design).
test('S-1 (pin, R161) a gate whose STORED text is missing or altered is listed as unreadable (unresolved), never as a ruling and never re-rendered: for the ruling and its withdrawal; an untouched gate resolves', () => {
  const setup = () => {
    const d = folder(); const g1 = ask(d, { pass: 2 });
    assert.equal(relay(d, g1, TEXT).ok, true);
    const w = requestWithdrawal(d, { gate: g1, pass: 3, relayed: true }, { now }); assert.equal(relay(d, w.gate.id, 'drop it').ok, true);
    return { d, g1, w: w.gate.id, fileOf: id => join(d, readGateAnswer(d, id, { now }).gate.text) };
  };
  { // control: nothing touched, everything resolves
    const { d } = setup();
    assert.deepEqual(rulingsOf(d, { now }).unreadable, []);
    assert.equal(rulingsOf(d, { now }).rulings.length, 1);
  }
  { // altered: the ruling's stored file
    const { d, g1, fileOf } = setup();
    writeFileSync(fileOf(g1), 'Ruling from pass 2\n\nSomething else entirely.\n');
    assert.ok(rulingsOf(d, { now }).unreadable.includes(g1), 'an altered ruling is unresolved');
    assert.equal(rulingsOf(d, { now }).rulings.length, 0, 'and is no ruling');
  }
  { // missing: the withdrawal's stored file
    const { d, w, fileOf } = setup();
    unlinkSync(fileOf(w));
    assert.ok(rulingsOf(d, { now }).unreadable.includes(w), 'a missing withdrawal text is unresolved');
  }
  { // altered: the withdrawal's stored file (the withdrawal is listed with the rulings; the ruling itself still resolves)
    const { d, g1, w, fileOf } = setup();
    writeFileSync(fileOf(w), 'Withdraw ruling g1 from pass 9\n');
    const o = rulingsOf(d, { now });
    assert.ok(o.unreadable.includes(w), 'an altered withdrawal is unresolved');
    assert.ok(!o.unreadable.includes(g1), 'the ruling it names is still resolved');
  }
  // where the texts are stored (the header names the two files)
  const { d } = setup();
  const names = readdirSync(d);
  assert.ok(names.some(f => /^ruling-2-[0-9a-f]{8}\.md$/.test(f)) && names.some(f => /^ruling-withdrawal-g1-3-[0-9a-f]{8}\.md$/.test(f)), names.join(' '));
});
