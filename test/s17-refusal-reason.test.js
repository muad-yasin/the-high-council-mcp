// 0.8.4 S17 (spec l.519 "recorded with the refusal reason"; WORDING S17-w1; C&C ruled 09 Nov, Q2): a withdrawal that is refused carries ONE reason word on its reply row: not_found, too_short or unreadable.
// Pure (applyAnswers over plain data), offline, $0. The red is the parent source: the row has no `refusal`, so each case fails at its assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAnswers } from '../src/answer-back.js';

const OWN = [{ id: 'O-aaaaaaaa', criterion: 'C1', problem: 'p1' }];
const DRAFT = 'The cache is cleared on every write. Reads go through one shared cache with a five minute TTL.';
const refuse = evidence => applyAnswers({ lab: 'a', critique: { failures: [], answers: [{ id: 'O-aaaaaaaa', status: 'withdrawn', evidence }] }, own: OWN, shownDraft: DRAFT, round: 2 }).records[0];

test('T21ai (refusal reason), S17-w1: a refused withdrawal says why: a long quoted passage that the draft does not hold is not_found', () => {
  const row = refuse('It now says "Writes are queued and flushed every second."');
  assert.equal(row.effect, 'withdrawal_refused');
  assert.equal(row.refusal, 'not_found');
});

test('T21ai (refusal reason), S17-w1: a refused withdrawal whose quoted passages are all under 8 characters is too_short', () => {
  const row = refuse('It now says `cache` and "TTL".');
  assert.equal(row.effect, 'withdrawal_refused');
  assert.equal(row.refusal, 'too_short');
});

test('T21ai (refusal reason), S17-w1: a refused withdrawal with no quoted passage at all is unreadable', () => {
  const row = refuse('The cache section was rewritten, see section two.');
  assert.equal(row.effect, 'withdrawal_refused');
  assert.equal(row.refusal, 'unreadable');
});

test('S17-w1 (pin): an accepted withdrawal carries no refusal word', () => {
  const row = refuse('It now says "Reads go through one shared cache with a five minute TTL."');
  assert.equal(row.effect, 'withdrawn');
  assert.equal('refusal' in row, false);
});
