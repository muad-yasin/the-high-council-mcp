// 0.8.4, A5: the batch of test/held-prompts/held-084-a5.js (the pairing convention of test/held-prompts.test.js). Recorded all together or not at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as HA from './held-prompts/held-084-a5.js';

const OBJ = { id: 'O-0123abcd', lab: 'mid-beta', from: 5, criterion: 'C', problem: 'No owner is named.' };
const OPTS = [{ seat: 'top-gamma', to: 2, reason: 'Section two names the owner.' }, { seat: 'top-delta', to: 6, reason: 'It does not.' }];
const CALLS = { handlerRetagPickSystem: [[{ layer: 3 }], [{ layer: null }]], handlerRetagPickUser: [[{ plan: 'P', sha: 'abc', objection: OBJ, options: OPTS, layer: 3 }], [{ plan: 'P', sha: 'abc', objection: { ...OBJ, from: null, quote: 'q' }, options: OPTS }]] };

test('the re-rate pick batch of the 0.8.4 build (held-084-a5.js): recorded all together or not at all, and a recorded one renders exactly as drafted', () => {
  const names = Object.keys(HA).filter(n => typeof HA[n] === 'function');
  assert.deepEqual(Object.keys(CALLS).sort(), names.slice().sort(), 'every drafted function has calls here: add one when you draft one');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not`);
  for (const name of recorded) for (const args of CALLS[name]) assert.equal(R[name](...args), HA[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-a5.js`);
});

test('the drafted pick prompt: the answer starts with the rating (what the reader accepts), names the id, says the pick is in force from this pass on, and shows every rating with its reasons', () => {
  const sys = HA.handlerRetagPickSystem({ layer: 3 });
  assert.match(sys, /Start your answer with the rating you pick, then your reasons, which must name the objection by its id\./);
  assert.match(sys, /in force for this objection from this pass on/);
  assert.doesNotMatch(sys, /Nothing else follows|the run goes on|round/i, 'it claims nothing about what follows (a revision, another wait or a build check can) and uses the word pass');
  const user = HA.handlerRetagPickUser({ plan: 'P', sha: 'abc', objection: OBJ, options: OPTS, layer: 3 });
  assert.match(user, /# The ratings\n\n- top-gamma re-rated it to 2\.0: <critic-claim>Section two names the owner\.<\/critic-claim>\n- top-delta re-rated it to 6\.0: <critic-claim>It does not\.<\/critic-claim>$/);
  assert.match(user, /- O-0123abcd \(raised by mid-beta; rated 5\.0 before this pass\): <critic-claim>C: No owner is named\.<\/critic-claim>/);
  assert.match(HA.handlerRetagPickUser({ plan: 'P', sha: 'abc', objection: { ...OBJ, from: null }, options: OPTS }), /not rated, read as 4 or above/);
});
