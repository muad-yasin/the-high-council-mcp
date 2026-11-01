// The two other places in src/chain.js that compare criterion TEXTS read the criterion the way the objection id does (src/objection-ids.js criterionKeyOf): a list number, case, inner spacing, quote marks and a closing full stop do not make another
// criterion. pickContestedCriterion (the allocator's most contested criterion) would have counted "7. X" and "X" as two criteria of one lab each; normaliseCritique would have added a second failure for a FAILED table row whose
// criterion differs from the failure's only by its number. Pure and $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickContestedCriterion, normaliseCritique } from '../src/chain.js';
import { objectionId, criterionKeyOf } from '../src/objection-ids.js';

const X = 'The plan states its assumptions plainly.';
const seat = lab => ({ provider: 'mock', model: 'x', lab });
const voter = (lab, criteria) => ({ seat: seat(lab), critique: { failures: criteria.map(criterion => ({ criterion })) } });

test('CI-1 pickContestedCriterion: "7. X" from one lab and "X" from another are ONE criterion failed by two of three critics, and its text comes back without the number', () => {
  const best = pickContestedCriterion([voter('a', [`7. ${X}`]), voter('b', [X]), voter('c', [])]);
  assert.deepEqual({ criterion: best?.criterion, failedBy: best?.failedBy.sort(), votingCount: best?.votingCount, score: best?.score }, { criterion: X, failedBy: ['a', 'b'], votingCount: 3, score: 1 });
});

test('CI-2 pickContestedCriterion: case, a closing full stop and spacing are not another criterion either', () => {
  const best = pickContestedCriterion([voter('a', [X.toLowerCase().replace(/\.$/, '')]), voter('b', [X]), voter('c', [])]);
  assert.deepEqual(best?.failedBy.sort(), ['a', 'b']);
});

test('CI-3 pickContestedCriterion (controls, they pass on any tree by design): marker-free text comes back exactly as written, and two different criteria stay two', () => {
  assert.equal(pickContestedCriterion([voter('a', [X]), voter('b', []), voter('c', [])])?.criterion, X);
  const two = pickContestedCriterion([voter('a', [X]), voter('b', ['It adds no scope the request did not ask for.']), voter('c', [])]);
  assert.equal(two.failedBy.length, 1, 'one lab per criterion: the criteria are two');
});

const row = (criterion, verdict = 'FAILED') => ({ criterion, verdict, evidence: 'Section one.' });
const reply = (failures, rows) => ({ meets: false, criteria: rows, failures, verdict_line: 'no' });

test('CI-4 normaliseCritique: a failure "7. X" (with its quote) beside a FAILED table row "X" adds NO second failure', () => {
  const c = normaliseCritique(reply([{ criterion: `7. ${X}`, quote: 'a passage', problem: 'p', fix: 'f' }], [row(X)]));
  assert.equal(c.failures.length, 1);
});

test('CI-5 normaliseCritique: a failure "x" in other case and without the closing full stop beside a FAILED row "X." adds none', () => {
  const c = normaliseCritique(reply([{ criterion: X.toLowerCase().replace(/\.$/, ''), problem: 'p', fix: 'f' }], [row(X)]));
  assert.equal(c.failures.length, 1);
});

test('CI-6 normaliseCritique (control, passes on any tree by design): a FAILED row for a DIFFERENT criterion is still added as a failure', () => {
  const c = normaliseCritique(reply([{ criterion: X, problem: 'p', fix: 'f' }], [row('It adds no scope the request did not ask for.')]));
  assert.equal(c.failures.length, 2);
});

test('CI-7 the objection id is byte for byte what it was (literals computed with the code before the list-marker change), with and without the number', () => {
  assert.equal(objectionId('l1', { criterion: X, quote: 'The cache is never cleared.' }), 'O-a91f68cd');
  assert.equal(objectionId('l1', { criterion: `7. ${X}`, quote: 'The cache is never cleared.' }), 'O-a91f68cd');
  assert.equal(objectionId('l1', { criterion: X }), 'O-bd07eb46');
  assert.equal(criterionKeyOf(`(3) ${X.toUpperCase()}`), criterionKeyOf(X));
});
