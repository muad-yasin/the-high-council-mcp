// 0.8.3 ROADMAP 77 (the paid repair recommendation, the READING side; design note M6_Root_Regenerate_Design_Note.md 17.5): the parser is deterministic and PURE. $0, no model.
// Rows: (AR1) the numbered and the unnumbered shapes and what is recorded from a block; (AR2) the five named problems, each found by the parser and never by a model; (AR3) several problems at once, in the table's order, and what is not a problem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecommendations, PROBLEMS } from '../src/tree-advice-parse.js';
import { DECISION_MAX_BYTES } from '../src/tree-decide-stop.js';

const parse = a => parseRecommendations(a, { maxBytes: DECISION_MAX_BYTES });

test('AR1 numbered blocks come out in order; an unnumbered answer is ONE recommendation; a block of three or more lines loses its last two (changes, risks), a shorter one is taken whole; text before the first number is not kept', () => {
  const two = parse('Here are two:\n1. Split the task by milestone and plan each alone.\n   Changes: smaller plans.\n   Risks: more planning calls.\n2) Drop the optional reporting part.\n   Changes: less to plan');
  assert.deepEqual([two.ok, two.numbered], [true, true]);
  assert.deepEqual(two.items, [{ n: 1, text: 'Split the task by milestone and plan each alone.' }, { n: 2, text: 'Drop the optional reporting part.\nChanges: less to plan' }]);
  const one = parse('Plan the storage part first.\nChanges: order.\nRisks: none known.');
  assert.deepEqual([one.ok, one.numbered, one.items], [true, false, [{ n: 1, text: 'Plan the storage part first.' }]]);
  assert.deepEqual(parse('  Just do it  ').items, [{ n: 1, text: 'Just do it' }]);
});

test('AR2 each named problem is found by the parser: P-a empty, P-b punctuation only, P-c a repeated or backwards number or a numbered line with no text (that one is not also P-b), P-d too long, P-e a hidden or control character', () => {
  const problems = a => parseRecommendations(a, { maxBytes: 40 }).problems;
  for (const empty of ['', '  \n \t', undefined, null, 42]) assert.deepEqual(problems(empty), ['P-a'], String(empty));
  assert.deepEqual(problems('1. ... ---'), ['P-b']);
  assert.deepEqual(problems('1. Plan A\n1. Plan B'), ['P-c'], 'a number repeats');
  assert.deepEqual(problems('2. Plan A\n1. Plan B'), ['P-c'], 'a number goes backwards');
  assert.deepEqual(problems('1. Plan A\n2.\n3. Plan C'), ['P-c'], 'a numbered line with no text after it');
  assert.deepEqual(problems('1. ' + 'x'.repeat(41)), ['P-d']);
  assert.deepEqual(problems('1. Plan ‮A'), ['P-e'], 'a bidi override');
  assert.deepEqual(problems('1. Plan \u001b[31mA'), ['P-e'], 'an escape sequence');
});

test('AR3 several problems are listed in the table order; a gap in the numbering (1, 3) and a clean answer are not problems; a problem answer still carries the items it read', () => {
  const r = parseRecommendations('1. ...\n1. Plan ‮B', { maxBytes: 40 });
  assert.deepEqual([r.ok, r.problems], [false, ['P-b', 'P-c', 'P-e']]);
  assert.equal(r.items.length, 2);
  assert.deepEqual(PROBLEMS, ['P-a', 'P-b', 'P-c', 'P-d', 'P-e']);
  assert.equal(parse('1. Plan A\n3. Plan C').ok, true, 'a gap is not on the closed list');
  assert.equal(parse('1. Plan A\n2. Plan C').problems, undefined);
  assert.throws(() => parseRecommendations('1. A'), /byte limit/, 'no limit given: it throws, it does not guess one');
  assert.equal(parseRecommendations('1. ' + 'x'.repeat(DECISION_MAX_BYTES + 1), { maxBytes: DECISION_MAX_BYTES }).problems[0], 'P-d', 'the decision reader\'s own limit');
});
