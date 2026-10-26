// Notes lane unit 2, commit 1 (gate note Review/Build_0.8.3/m6-closing/Notes_Lane_Unit2_Gate_Note.md section 2, C&C PASS ON CONDITIONS 15 Okt 2026, ruling Q11): the writer's answer lines
// (`NOTE-TAKEN|DECLINED|SAME: N-xxxxxxxx ...`, grammar in src/review-notes.js) are trailer lines of a reviser's reply. They cost nothing in the closing walk, they are stripped from the text by EVERY
// caller of parseDisputes / stripDeclined, and they are returned apart in `noteLines`. A malformed NOTE line is plain text. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDisputes, stripDeclined, readModelDraft, CLOSING_LINES_MAX } from '../src/draft-disputes.js';

const body = 'The plan.\n\nStep one. Step two.';
const D = n => `DECLINED: O-${String(n).repeat(8)}: reason ${n}`;
const N = n => `NOTE-TAKEN: N-${String(n).repeat(8)}`;
const NS = (a, b) => `NOTE-SAME: N-${String(a).repeat(8)}: N-${String(b).repeat(8)}`;
const parse = (text, opts = { withIds: true }) => parseDisputes(text, opts);

test('NT-1: DECLINED x3, then NOTE x10, then a closing sentence: every DECLINED line recorded, every NOTE line stripped and returned, the sentence stays', () => {
  const notes = Array.from({ length: 10 }, (_, i) => N(i));
  const r = parse(`${body}\n${[D(1), D(2), D(3)].join('\n')}\n${notes.join('\n')}\nThanks, done.`);
  assert.deepEqual(r.disputeIds, ['O-11111111', 'O-22222222', 'O-33333333']);
  assert.deepEqual(r.noteLines, notes);
  assert.equal(r.draft, `${body}\nThanks, done.`);
});

test('NT-2: the trailer kinds in EVERY order (DECLINED lines, NOTE lines, a Disputed block): all recorded, nothing left in the plan', () => {
  const kinds = {
    D: { text: `${D(1)}\n${D(2)}`, check: r => assert.deepEqual(r.disputeIds.filter(Boolean), ['O-11111111', 'O-22222222']) },
    N: { text: `${N(1)}\n${NS(2, 3)}`, check: r => assert.deepEqual(r.noteLines, [N(1), NS(2, 3)]) },
    B: { text: 'Disputed: the plan keeps its position.', check: r => assert.ok(r.disputes.some(d => /keeps its position/.test(d))) },
  };
  const orders = [['D', 'N', 'B'], ['D', 'B', 'N'], ['N', 'D', 'B'], ['N', 'B', 'D'], ['B', 'D', 'N'], ['B', 'N', 'D']];
  for (const order of orders) {
    const r = parse(`${body}\n\n${order.map(k => kinds[k].text).join('\n\n')}\n`);
    for (const k of order) kinds[k].check(r);
    assert.equal(r.draft, body, `order ${order.join('')}: the plan is left as written`);
  }
});

test('NT-3: a well-formed NOTE line quoted in the MIDDLE of the plan is not touched', () => {
  const text = `Intro.\n\nA reviser answered "${N(1)}" once.\n${N(1)}\n\nStep one.\nStep two.\nStep three.\nStep four.\nThanks.`;
  const r = parse(text);
  assert.deepEqual(r.noteLines, []);
  assert.ok(r.draft.includes(N(1)));
});

test('NT-4 (PIN, Q11 condition 4): a NOTE line with a malformed id is plain text: it stays, it spends the closing budget, and the DECLINED line above it is still recorded', () => {
  const bad = ['NOTE-TAKEN: N-xyz', 'NOTE-TAKEN: N-1234567', 'note-taken: N-11111111', 'NOTE-SAME: N-11111111: N-11111111'];
  for (const line of bad) {
    const r = parse(`${body}\n${D(1)}\n${line}`);
    assert.deepEqual(r.noteLines, [], `${line}: not a note`);
    assert.ok(r.draft.endsWith(line), `${line}: stays in the text`);
    assert.deepEqual(r.disputeIds, ['O-11111111'], `${line}: the DECLINED line above still records`);
  }
  // the budget is spent by it: CLOSING_LINES_MAX malformed lines still let the DECLINED line strip, one more does not
  const bound = Array.from({ length: CLOSING_LINES_MAX }, () => 'NOTE-TAKEN: N-xyz').join('\n');
  assert.deepEqual(parse(`${body}\n${D(1)}\n${bound}`).disputeIds, ['O-11111111']);
  assert.deepEqual(parse(`${body}\n${D(1)}\n${bound}\nNOTE-TAKEN: N-xyz`).disputeIds, []);
});

test('NT-5 (PIN, Q11 condition 4): NOTE lines mixed with real DECLINED lines record both, and neither parser swallows the other', () => {
  const r = parse(`${body}\n${N(1)}\n${D(2)}\n${NS(3, 4)}\nDECLINED: O-55555555: see NOTE-TAKEN: N-66666666 in the notes\nNOTE-DECLINED: N-77777777: O-88888888 is wrong\n`);
  assert.deepEqual(r.disputeIds, ['O-22222222', 'O-55555555']);
  assert.deepEqual(r.disputes, ['reason 2', 'see NOTE-TAKEN: N-66666666 in the notes']);
  assert.deepEqual(r.noteLines, [N(1), NS(3, 4), 'NOTE-DECLINED: N-77777777: O-88888888 is wrong']);
  assert.equal(r.draft, body);
});

test('NT-6: the build-stage form (disputedBlock:false), stripDeclined and readModelDraft on a revise file strip NOTE lines too (every caller)', () => {
  const text = `${body}\n${D(1)}\n${N(1)}\n${N(2)}\n`;
  assert.deepEqual(parseDisputes(text, { disputedBlock: false }).noteLines, [N(1), N(2)]);
  assert.equal(stripDeclined(text), body);
  const dir = mkdtempSync(join(tmpdir(), 'dd-notes-'));
  writeFileSync(join(dir, 'revise-2.md'), text);
  writeFileSync(join(dir, 'build.md'), text);
  assert.equal(readModelDraft(join(dir, 'revise-2.md')), body);
  assert.equal(readModelDraft(join(dir, 'build.md')), body);
});

test('NT-7: noteLines is always present (an empty list when there are none), and a reply without NOTE lines parses exactly as before', () => {
  const plain = parse(`${body}\n${D(1)}\n`);
  assert.deepEqual(plain.noteLines, []);
  assert.deepEqual(plain.disputeIds, ['O-11111111']);
  assert.equal(plain.draft, body);
  assert.deepEqual(parse(body).noteLines, []);
});

test('NT-8: NOTE lines above closing chatter are collected for free (budget untouched), and the order returned is top to bottom', () => {
  const r = parse(`${body}\n${N(1)}\n${D(1)}\n${N(2)}\nChatter one.\nChatter two.\nChatter three.\n${N(3)}`);
  assert.deepEqual(r.noteLines, [N(1), N(2), N(3)]);
  assert.deepEqual(r.disputeIds, ['O-11111111']);
  assert.equal(r.draft, `${body}\nChatter one.\nChatter two.\nChatter three.`);
});
