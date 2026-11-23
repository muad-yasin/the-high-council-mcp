// 0.8.4 D27, the draft boundary (WORDING D27-w1, D27-w2): the batch of test/held-prompts/held-084-d27.js (the pairing convention of test/held-prompts.test.js). Recorded all together or not at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as HD from './held-prompts/held-084-d27.js';

const CALLS_D27 = { draftStartLine: [[]], draftBoundarySentence: [[]] };

test('the D27 batch of the 0.8.4 build (held-084-d27.js): recorded all together or not at all, and a recorded one renders exactly as drafted', () => {
  const names = Object.keys(HD).filter(n => typeof HD[n] === 'function');
  assert.deepEqual(Object.keys(CALLS_D27).sort(), names.slice().sort(), 'every drafted D27 function has calls here: add one when you draft one');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial D27 re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not (the missing ones would be silently skipped)`);
  for (const name of recorded) for (const args of CALLS_D27[name]) assert.equal(R[name](...args), HD[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-d27.js`);
});

test('the drafted words: a bracketed start line that mirrors the recorded end line, and one sentence that names both lines', () => {
  assert.equal(HD.draftStartLine(), '[Start of the draft under review.]');
  assert.match(R.DRAFT_END_MARKER, /^\[End of the draft under review\./, 'the recorded end line the start line mirrors');
  assert.equal(HD.draftBoundarySentence(), 'The draft you grade is only the text between the start line and the end line.');
  assert.equal(HD.draftBoundarySentence().split(/(?<=\.)\s/).length, 1, 'one sentence');
});
