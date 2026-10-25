// E2a (0.8.3, layered panel): the unanimous panel asks its seats through ONE function, `askLayer(seats)` in src/chain.js, so a layered round and an unlayered round cannot drift apart. A later edit that calls
// `reviewSeat(` from anywhere else in the round would ask a seat outside the re-ask / unanswered-fallback bookkeeping that askLayer wraps around it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/chain.js', import.meta.url)), 'utf8');
const START = 'const askLayer = async seats => {';

test('ask-layer: askLayer exists once, and the unlayered panel calls it once with every critic', () => {
  assert.equal(src.split(START).length - 1, 1, 'one definition');
  assert.equal(src.split('await askLayer(config.seats.critics);').length - 1, 1, 'one call with all critics');
});

test('ask-layer: every `reviewSeat(` call of the unanimous panel sits inside askLayer\'s body', () => {
  const from = src.indexOf(START);
  assert.ok(from > 0, 'askLayer found');
  const to = src.indexOf('\n      };\n', from);
  assert.ok(to > from, 'the end of askLayer found');
  const calls = [...src.matchAll(/\breviewSeat\(/g)].map(m => m.index);
  assert.ok(calls.length >= 3, `the panel's reviewSeat calls were found (${calls.length})`);
  const outside = calls.filter(i => i < from || i > to);
  assert.deepEqual(outside.map(i => src.slice(0, i).split('\n').length), [], 'reviewSeat( called outside askLayer at these lines');
});
