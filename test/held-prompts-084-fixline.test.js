// 0.8.4 leftovers, the judge's fix line (WORDING LVO-w1): the batch of test/held-prompts/held-084-fixline.js (the pairing convention of test/held-prompts.test.js). Recorded all together or not at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as HF from './held-prompts/held-084-fixline.js';

const CALLS = { criticFixHint: [[]] };

test('the fix-line batch of the 0.8.4 build (held-084-fixline.js): recorded all together or not at all, and a recorded one renders exactly as drafted', () => {
  const names = Object.keys(HF).filter(n => typeof HF[n] === 'function');
  assert.deepEqual(Object.keys(CALLS).sort(), names.slice().sort(), 'every drafted function has calls here: add one when you draft one');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not`);
  for (const name of recorded) for (const args of CALLS[name]) assert.equal(R[name](...args), HF[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-fixline.js`);
});

test('the drafted fix line: asks for the change that would fix it, as small or as large as the problem needs; never for the smallest one; asks for nothing else (no "required", no effort)', () => {
  const text = HF.criticFixHint();
  assert.equal(text, '<the change that would fix it, as small or as large as the problem needs>');
  assert.doesNotMatch(text, /smallest|minimal|minimum/i, 'the old ask is gone');
  assert.match(text, /^<.*>$/, 'a placeholder in angle brackets, as the reply format shows its other fields');
  assert.doesNotMatch(text, /must|required|always|effort/i, 'it does not make a fix required (open) and says nothing about effort');
});
