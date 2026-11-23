// PR #2 fix unit, item 8 (Sol: "a concrete weakness in criterion identity matching"): a judge's table row that differs from its criterion in a word that decides the requirement (a negation, a bound such as at least / at most, a number) names NO
// criterion, whether the row is read by its text (`names`) or by its position (`byPosition`, guard G6). A retyped row that only drops or swaps a filler word still counts (ROADMAP item 151: the looser match exists because retyped tables lost whole sign-offs).
// Pure and $0. The three cases are Sol's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ledger from '../src/criteria-ledger.js';
const { signoffTableGap, missingCriteriaRows, outsideCriteriaRows, criterionIndexOf, rowCriterionIndex } = ledger;

const row = (criterion, verdict = 'MET') => ({ criterion, verdict, evidence: 'The draft covers it.' });
const signOff = rows => ({ meets: true, criteria: rows, failures: [] });
const gapOf = (criterion, rowText) => signoffTableGap(signOff([row(rowText)]), [criterion]);

const SOL = [
  ['"must write" for "must not write"', 'must not write secret tokens', 'Must write secret tokens'],
  ['"at least three" for "at most three"', 'The plan says the worker makes at most three failed attempts.', 'The plan says the worker makes at least three failed attempts.'],
  ['"thirty" for "three"', 'The worker stops after three failed attempts.', 'The worker stops after thirty failed attempts.'],
];

for (const [name, criterion, retyped] of SOL) {
  test(`Sol's case, ${name}: the table is NOT a full table (a row for the criterion is missing), and the row is an outside row`, () => {
    assert.equal(gapOf(criterion, retyped)?.kind, 'missing_rows');
    assert.deepEqual(missingCriteriaRows(signOff([row(retyped)]), [criterion])?.criterion_ids, ['C1']);
    assert.equal(rowCriterionIndex(signOff([row(retyped)]), [criterion]).size, 0, 'no row is assigned to the criterion');
    assert.deepEqual(outsideCriteriaRows(signOff([row(retyped)]), [criterion]), [retyped]);
    assert.equal(criterionIndexOf(retyped, [criterion]), -1);
  });
}

test('the dropped-words match too: a "not" dropped from a criterion of 8 words or more is not the criterion; a row that only TRIMS a long criterion (the contained-text rule) still is, as before', () => {
  const long = 'The plan must not write secret tokens into the run log files';
  const dropped = 'The plan must write secret tokens into the run log files';
  assert.equal(criterionIndexOf(dropped, [long]), -1, 'wordsDropped: one word removed in order, but it is the negation');
  assert.equal(gapOf(long, dropped)?.kind, 'missing_rows');
  const trimmed = 'The worker must retry failed requests, but not more than three times in a row';
  assert.equal(criterionIndexOf('The worker must retry failed requests', [trimmed]), 0, 'a judge trimming a long criterion keeps naming it (the tail holds "not": unchanged, 13% of real table rows are trimmed)');
});

test('with several criteria: the position reading refuses a table in which one row says the opposite, and still reads the table when the rows differ only in filler', () => {
  const C = ['The plan names an owner for every step.', 'The worker must not write secret tokens to any log.', 'The retry limit is at most three attempts.'];
  const swapped = ['Restated names an owner for every step.', 'Restated must write secret tokens to any log.', 'Restated retry limit is at most three attempts.'];
  assert.equal(signoffTableGap(signOff(swapped.map(t => row(t))), C)?.kind, 'missing_rows', 'row 2 lost its "not"');
  const filler = ['Restated names an owner for every step.', 'Restated must not write secret tokens to any log.', 'Restated retry limit is at most three attempts.'];
  assert.equal(signoffTableGap(signOff(filler.map(t => row(t))), C), null, 'GREEN control: only the first word was retyped');
  const bound = ['Restated names an owner for every step.', 'Restated must not write secret tokens to any log.', 'Restated retry limit is at least three attempts.'];
  assert.equal(signoffTableGap(signOff(bound.map(t => row(t))), C)?.kind, 'missing_rows', 'row 3 says at least for at most');
});

test('GREEN control (ROADMAP item 151): a retyped criterion with a dropped or swapped filler word, a number written as a digit, a list number and an id all still count', () => {
  const C1 = 'The plan shows a declared model as declared rather than as verified in the final summary table';
  assert.equal(gapOf(C1, 'The plan shows a declared model as declared rather than verified in the final summary table'), null, 'the debate run that lost a sign-off to "rather than verified"');
  const C2 = 'The worker retries failed requests up to three times before it stops';
  assert.equal(gapOf(C2, 'The worker retries failed requests up to 3 times before it stops'), null, 'a number as a digit is the same number');
  assert.equal(gapOf(C2, 'The worker retries failed requests up to three times, then it stops'), null, 'a changed filler word');
  assert.equal(signoffTableGap(signOff([row('1. The worker retries failed requests up to 3 times before it stops')]), [C2]), null, 'a leading list number is a position, not a number of the requirement');
  assert.equal(gapOf(C2, 'C1'), null, 'the id itself');
});

test('sameRequirementWords: negations are one class, bounds count as themselves, numbers by value and only a substituted number counts, and only for a row near its criterion', () => {
  assert.equal(ledger.sameRequirementWords('The worker cannot retry', 'The worker must not retry'), true);
  assert.equal(ledger.sameRequirementWords('no more than three', 'no fewer than three'), false);
  assert.equal(ledger.sameRequirementWords('three attempts', '3 attempts'), true);
  assert.equal(ledger.sameRequirementWords('three attempts', '30 attempts'), false);
  assert.equal(ledger.sameRequirementWords('the retry limit', 'the retry limit of five'), true, 'a number only added (or only dropped) is left to the other rules');
  assert.equal(ledger.sameRequirementWords('Restated plan states what it chose and why it lost without any reviewer saying so and when', 'The plan does not state what it chose and why it lost without any reviewer saying so'), true, 'a heavily reworded row has no word-for-word pair: the position reading stands, as before');
});
