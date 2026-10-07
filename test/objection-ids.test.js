// 0.8.2 item 3 (owner decisions of 5 Oct 2026 + C&C's C4; tickets 1 and 12): a stable id per objection and a stall signature that stalls LESS, never more.
// Pure and $0. The implication "two rounds equal under the new signature are equal under the old one" is checked over thousands of random failure sets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { objectionId, problemKey, stallSignature, legacyStallSignature, objectionKey } from '../src/objection-ids.js';

const F = (lab, criterion, quote, problem = 'p') => ({ lab, criterion, ...(quote === undefined ? {} : { quote }), problem });

test('objectionId: the same lab + criterion + quoted text is the same id whatever the words, and any of the three changing changes it', () => {
  const a = objectionId('x', F('x', 'C1', 'The cache is never cleared.', 'first wording'));
  assert.match(a, /^O-[0-9a-f]{8}$/);
  assert.equal(objectionId('x', F('x', 'C1', '  the cache is NEVER cleared. ', 'a reworded complaint')), a, 'case, spacing and the problem prose do not change it');
  assert.equal(objectionId('x', F('x', 'C1', 'The *cache* is never "cleared".')), a, 'markdown emphasis and quote marks do not either');
  assert.notEqual(objectionId('y', F('y', 'C1', 'The cache is never cleared.')), a, 'another lab');
  assert.notEqual(objectionId('x', F('x', 'C2', 'The cache is never cleared.')), a, 'another criterion');
  assert.notEqual(objectionId('x', F('x', 'C1', 'The queue is never drained.')), a, 'another quoted text (a different defect)');
  assert.equal(problemKey({ quote: 'x'.repeat(500) }).length, 160);
  assert.equal(problemKey({}), '', 'no quote: the old, coarser key');
});

test('stall signature: two different defects under one criterion differ now and were equal before (the ticket 12 case)', () => {
  const r1 = [F('a', 'C3', 'Section 2 sets the limit to 40.'), F('b', 'C1', 'x')];
  const r2 = [F('a', 'C3', 'Section 5 drops the interlock.'), F('b', 'C1', 'x')];
  assert.equal(legacyStallSignature(r1), legacyStallSignature(r2), 'the old rule saw one stuck disagreement');
  assert.notEqual(stallSignature(r1), stallSignature(r2), 'the new rule sees two different defects');
  // the same problem reworded: still a stall
  assert.equal(stallSignature([F('a', 'C3', 'Section 2 sets the limit to 40.', 'one way')]), stallSignature([F('a', 'C3', 'section 2 sets the limit to 40.', 'another way')]));
  // seat order never matters
  assert.equal(stallSignature([r1[0], r1[1]]), stallSignature([r1[1], r1[0]]));
  assert.equal(objectionKey(r1[0]), 'a\u0000C3\u0000section 2 sets the limit to 40.');
});

test('stall signature never stalls MORE than the old one: equal under the new signature implies equal under the old (random failure sets)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const labs = ['a', 'b', 'c', 'a|b'], crits = ['C1', 'C2', 'C3', 'C|3', 'x|'], quotes = [undefined, '', 'q one', 'Q  ONE', 'q two', 'q three', '|q one', 'x|y'];
  const set = () => Array.from({ length: Math.floor(rnd() * 4) }, () => F(pick(labs), pick(crits), pick(quotes)));
  let equalNew = 0;
  for (let i = 0; i < 20000; i++) {
    const x = set(), y = set();
    if (stallSignature(x) === stallSignature(y)) { equalNew++; assert.equal(legacyStallSignature(x), legacyStallSignature(y), JSON.stringify([x, y])); }
  }
  assert.ok(equalNew > 200, `the property was exercised (${equalNew} equal pairs)`);
  // and the check can fail: the same key built with the OLD '|' delimiter violates the implication on a collision pair (the review's finding), so the property above is not vacuous
  const piped = fs => fs.map(f => `${f.lab}|${f.criterion}|${problemKey(f)}`).sort().join('\n');
  const x = [F('a', 'x|', 'y')], y = [F('a', 'x', '|y')];
  assert.equal(piped(x), piped(y), 'with a plain pipe two different objections collide');
  assert.notEqual(legacyStallSignature(x), legacyStallSignature(y));
  assert.notEqual(stallSignature(x), stallSignature(y), 'with NUL they do not');
});
