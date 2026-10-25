// The closing-chatter tolerance of the trailer strip (gate note Review/Build_0.8.3/m6-closing/Trailer_Fix_Gate_Note.md; C&C tier (a), 15 Oct 2026). Before this, a reviser's closing sentence AFTER its DECLINED lines left every
// dispute out of report.json AND shipped the DECLINED lines inside the plan (parseDisputes stripped trailing DECLINED lines only while the last non-blank line was one). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDisputes, stripDeclined, CLOSING_LINES_MAX } from '../src/draft-disputes.js';

const body = 'The plan.\n\nStep one. Step two.';
const D1 = 'DECLINED: O-11111111: not needed';
const D2 = 'DECLINED: O-22222222: out of scope';
const parse = (text, opts = { withIds: true }) => parseDisputes(text, opts);

test('C1: a strict DECLINED line followed by one closing sentence is stripped AND recorded (probe case 1: red on the old parser)', () => {
  const r = parse(`${body}\n${D1}\nThanks, done.`);
  assert.deepEqual(r.disputes, ['not needed']);
  assert.deepEqual(r.disputeIds, ['O-11111111']);
  assert.equal(r.draft.includes('DECLINED:'), false);
  assert.ok(r.draft.endsWith('Thanks, done.'), 'the closing chatter is NOT removed (never delete possible plan text)');
});

test('C2: the same with an unknown `KEY: value` last line (probe case 2)', () => {
  const r = parse(`${body}\n${D1}\nSTATUS: done`);
  assert.deepEqual(r.disputeIds, ['O-11111111']);
  assert.equal(r.draft.includes('DECLINED:'), false);
});

test('C3 (PIN): an unknown line ABOVE the DECLINED line, and the clean case, strip as they always did', () => {
  assert.deepEqual(parse(`${body}\nSTATUS: done\n${D1}`).disputeIds, ['O-11111111']);
  const clean = parse(`${body}\n${D1}\n`);
  assert.deepEqual(clean.disputes, ['not needed']);
  assert.equal(clean.draft, body);
});

test('C4: a well-formed DECLINED line quoted in the MIDDLE of the plan is NOT stripped (the plan may quote one)', () => {
  const text = `Intro.\n\nThe writer once answered "${D1}" in a review.\n${D1}\n\nStep one.\nStep two.\nStep three.\nStep four.\nThanks.`;
  const r = parse(text);
  assert.deepEqual(r.disputes, []);
  assert.ok(r.draft.includes(D1), 'the mid-plan line stays');
});

test('C5: the bound: closing chatter of exactly CLOSING_LINES_MAX non-blank lines still lets the line strip; one more does not', () => {
  assert.equal(CLOSING_LINES_MAX, 3);
  const chatter = n => Array.from({ length: n }, (_, i) => `closing line ${i + 1}`).join('\n');
  assert.deepEqual(parse(`${body}\n${D1}\n${chatter(3)}`).disputeIds, ['O-11111111']);
  assert.deepEqual(parse(`${body}\n${D1}\n${chatter(4)}`).disputeIds, []);
});

test('C6: MORE strict lines than the bound above ONE chatter line: all are stripped and recorded top to bottom (a region of "the last N lines" would leak)', () => {
  const ids = ['O-aaaaaaa1', 'O-aaaaaaa2', 'O-aaaaaaa3', 'O-aaaaaaa4', 'O-aaaaaaa5'];
  const lines = ids.map((id, i) => `DECLINED: ${id}: reason ${i + 1}`);
  const r = parse(`${body}\n${lines.join('\n')}\nThanks, done.`);
  assert.deepEqual(r.disputeIds, ids);
  assert.deepEqual(r.disputes, ['reason 1', 'reason 2', 'reason 3', 'reason 4', 'reason 5']);
  assert.equal(r.draft.includes('DECLINED:'), false);
});

test('C7: a loose DECLINED line (no id) followed by chatter is NOT stripped (today\'s rule); a loose one at the very end still is', () => {
  assert.deepEqual(parse(`${body}\nDECLINED: just because\nThanks.`).disputes, []);
  assert.deepEqual(parse(`${body}\nDECLINED: just because`).disputes, ['just because']);
});

test('C8: two strict lines with chatter between and after: both stripped, recorded in order; the chatter stays where it was', () => {
  const r = parse(`${body}\n${D1}\nA note in between.\n${D2}\nThanks.`);
  assert.deepEqual(r.disputeIds, ['O-11111111', 'O-22222222']);
  assert.ok(r.draft.includes('A note in between.') && r.draft.endsWith('Thanks.'));
});

test('C9: withIds false records the reason without an id (a stage whose prompt asks for none), true records it with the id', () => {
  const text = `${body}\n${D1}\nThanks.`;
  assert.deepEqual(parse(text, { withIds: false }).disputeIds, [null]);
  assert.equal(parse(text, { withIds: false }).draft.includes('DECLINED:'), false, 'the line is still stripped');
  assert.deepEqual(parse(text, { withIds: true }).disputeIds, ['O-11111111']);
});

test('C10: stripDeclined (every reader of raw stage text) and parseDisputes(...).draft agree on every case above', () => {
  const cases = [`${body}\n${D1}\nThanks, done.`, `${body}\nSTATUS: done\n${D1}`, `${body}\n${D1}\n`, `${body}\n${D1}\nA.\n${D2}\nB.`, `${body}\nDECLINED: just because\nThanks.`];
  for (const c of cases) assert.equal(stripDeclined(c), parseDisputes(c, { disputedBlock: false }).draft, c);
  assert.equal(stripDeclined(`${body}\n${D1}\nThanks, done.`).includes('DECLINED:'), false);
});

test('C11 (PIN): a trailing Disputed block is unchanged by the new walk (reviser mode strips it, build mode keeps it)', () => {
  const t = `${body}\n\n## Disputed\nThe plan keeps its position.`;
  assert.deepEqual(parseDisputes(t).disputes, ['The plan keeps its position.']);
  assert.equal(parseDisputes(t, { disputedBlock: false }).draft, t);
});
