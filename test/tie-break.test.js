// test/tie-break.test.js
//
// v6 §4: weighted voting, 1.001 tiebreak, never silent. Muad's own decision:
// seat #1 (the C&C seat, index 0) is a deliberate tiebreaker, not a
// hierarchy - it only ever matters on an exact unweighted tie, and every
// tie-break event must be visible in the run record, never silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tallyVote, NO_TIE_BREAK, TIE_BREAK_WEIGHT, TIE_BREAK_SEAT_INDEX } from '../src/tie-break.js';
import { runChain } from '../src/chain.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const debateRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockDebateConfig = JSON.parse(readFileSync(join(debateRoot, 'chains', 'mock-debate.json'), 'utf8'));

// The plan's own 5-seat acceptance test as a genuine 2-2-1 split: 5 seats
// vote, one (seat 4) abstains, leaving an exact 2-2 unweighted tie among the
// 4 seats that actually voted - seat #1 is on the pass side and breaks it.
test('test_weighted_tiebreak: a 2-2-1 split with seat #1 on the pass side is decided by the weight, and it is recorded', () => {
  const votes = [
    { seat: 0, vote: 'pass' }, // the tiebreaker seat
    { seat: 1, vote: 'fail' },
    { seat: 2, vote: 'pass' },
    { seat: 3, vote: 'fail' },
    { seat: 4, vote: 'abstain' },
  ];
  const { winner, tieBreak } = tallyVote(votes);
  assert.equal(winner, 'pass', "seat #1's side must win the exact tie");
  assert.equal(tieBreak.occurred, true);
  assert.equal(tieBreak.decided_by, 'seat_weights');
  assert.deepEqual(tieBreak.weights, { [TIE_BREAK_SEAT_INDEX]: TIE_BREAK_WEIGHT });
  assert.deepEqual(tieBreak.unweighted_tally, { pass: 2, fail: 2 });
  assert.deepEqual(tieBreak.weighted_tally, { pass: 2.001, fail: 2 });
  assert.equal(tieBreak.outcome_changed, true);
});

test('test_weighted_tiebreak: a 3-1 non-tied vote is decided by the unweighted majority, untouched, and no tie-break is recorded', () => {
  const votes = [
    { seat: 0, vote: 'fail' }, // the tiebreaker seat votes the losing side - must not matter
    { seat: 1, vote: 'pass' },
    { seat: 2, vote: 'pass' },
    { seat: 3, vote: 'pass' },
  ];
  const { winner, tieBreak } = tallyVote(votes);
  assert.equal(winner, 'pass', 'strictly more votes wins outright - weighting is never consulted');
  assert.deepEqual(tieBreak, NO_TIE_BREAK);
  assert.equal(tieBreak.occurred, false);
});

test('the tie_break field is always present, even when no tie occurred - absence must never be mistaken for "not wired up"', () => {
  const { tieBreak } = tallyVote([{ seat: 1, vote: 'pass' }, { seat: 2, vote: 'pass' }]);
  assert.ok('occurred' in tieBreak);
  assert.equal(tieBreak.occurred, false);
});

test('the epsilon cannot tip a close-but-not-tied vote: a 1-vote gap is unaffected by any seat weight', () => {
  // Smallest possible non-tied gap (1 vote) with seat #1 on the losing side -
  // if the epsilon could ever cross an integer gap this would wrongly flip.
  const votes = [
    { seat: 0, vote: 'fail' },
    { seat: 1, vote: 'pass' },
    { seat: 2, vote: 'pass' },
  ];
  const { winner, tieBreak } = tallyVote(votes);
  assert.equal(winner, 'pass');
  assert.equal(tieBreak.occurred, false);
});

test('an empty or all-abstaining vote list produces no winner and no tie-break, never throws', () => {
  assert.deepEqual(tallyVote([]), { winner: null, tieBreak: NO_TIE_BREAK });
  assert.deepEqual(tallyVote(undefined), { winner: null, tieBreak: NO_TIE_BREAK });
  assert.deepEqual(tallyVote([{ seat: 0, vote: 'abstain' }]), { winner: null, tieBreak: NO_TIE_BREAK });
});

test('a tie where the tiebreaker seat itself did not vote survives as a tie, never silently resolved', () => {
  const votes = [
    { seat: 1, vote: 'pass' },
    { seat: 2, vote: 'fail' },
  ];
  const { winner, tieBreak } = tallyVote(votes);
  assert.equal(winner, null);
  assert.equal(tieBreak.occurred, true);
  assert.equal(tieBreak.outcome_changed, false, 'no side actually won, so nothing changed');
});

// Integration: once a debate stage runs, report.json's debate.tie_break must
// always be present - not just the pure function, the actual field on a
// real run's result, so the "never silent" guarantee holds end to end.
test('runChain: a run with a debate stage always carries debate.tie_break, defaulting to occurred: false', async () => {
  const result = await runChain({ request: 'Do the thing.', config: mockDebateConfig, log: () => {} });
  assert.ok(result.debate, 'this chain runs a debate stage, so result.debate must not be null');
  assert.ok('tie_break' in result.debate, 'debate.tie_break must be present, not absent');
  assert.equal(result.debate.tie_break.occurred, false);
});

test('duplicate votes for the same seat collapse to one (last wins), so a tie stays a genuine 2-2 tie and seat 0 is never double-weighted (bug-audit finding)', () => {
  const { winner, tieBreak } = tallyVote([
    { seat: 0, vote: 'pass' },
    { seat: 0, vote: 'pass' }, // duplicate entry for the tiebreaker seat - must collapse to one vote
    { seat: 1, vote: 'fail' },
    { seat: 2, vote: 'pass' },
    { seat: 3, vote: 'fail' },
  ]);
  assert.equal(winner, 'pass');
  assert.deepEqual(tieBreak.unweighted_tally, { pass: 2, fail: 2 }, 'the duplicate must collapse rather than inflate the pass count to 3');
  assert.deepEqual(tieBreak.weighted_tally, { pass: 2.001, fail: 2 }, 'seat 0 must contribute its weight exactly once, not per duplicate entry');
});
