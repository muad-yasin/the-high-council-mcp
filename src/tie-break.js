// v6 §4: weighted voting, 1.001 tiebreak, never silent (Muad's own decision -
// a deliberate tiebreaker, not a hierarchy: it decides only an exact
// deadlock and nothing else).
//
// Debate-stage votes are tallied twice, never once:
//   1. Unweighted tally first. Strictly more votes on one side wins outright
//      - weighting is never consulted unless the unweighted count is tied.
//   2. Only on an exact tie, recompute with weights: seat #1 (the C&C seat,
//      index 0) contributes 1.001; every other seat contributes 1.0. The
//      epsilon (0.001) is smaller than any possible integer vote-count gap
//      (the minimum non-tied gap is 1.0), so it can only ever matter when
//      the unweighted count is exactly equal - it cannot silently tip a
//      close-but-not-tied vote.
//
// The event this produces is meant for report.json's debate.tie_break -
// always present, never omitted, so its absence is never mistaken for
// "nothing to check" (the same silent-drop class of bug this project was
// burned by tonight with a dropped critic verdict under a false passed:true).

export const TIE_BREAK_SEAT_INDEX = 0;
export const TIE_BREAK_WEIGHT = 1.001;
export const DEFAULT_WEIGHT = 1.0;

// A tie_break object that is always safe to serialize when no vote was ever
// tallied this run - the field is present, occurred is false, nothing else
// is fabricated.
export const NO_TIE_BREAK = Object.freeze({ occurred: false });

/**
 * Tally a list of votes ({ seat, vote: 'pass' | 'fail' }, `seat` the seat's
 * index in the debate roster) and decide the outcome, weighting only on an
 * exact tie. Never throws on an empty or malformed vote list - returns the
 * unweighted result with occurred: false, same as any other non-tied vote.
 *
 * Returns { winner, tieBreak } where `winner` is 'pass' | 'fail' | null (null
 * only for zero votes) and `tieBreak` is the object to store verbatim under
 * report.json's debate.tie_break.
 */
export function tallyVote(votes) {
  // One vote per seat, last one wins if a caller ever passes a duplicate -
  // two entries for the same seat must never double-count that seat's
  // weight (bug-audit finding, 2026-09-13: unguarded, this would let one
  // seat contribute the tiebreaker weight twice). No real call site
  // constructs a votes array yet, so this is a guard against a future
  // caller's bug, not a live one.
  const bySeat = new Map();
  for (const v of Array.isArray(votes) ? votes : []) {
    if (v?.vote === 'pass' || v?.vote === 'fail') bySeat.set(v.seat, v);
  }
  const list = [...bySeat.values()];
  const unweighted_tally = { pass: 0, fail: 0 };
  for (const v of list) {
    if (v.vote === 'pass') unweighted_tally.pass += 1;
    else unweighted_tally.fail += 1;
  }

  if (unweighted_tally.pass === 0 && unweighted_tally.fail === 0) {
    return { winner: null, tieBreak: NO_TIE_BREAK };
  }

  if (unweighted_tally.pass !== unweighted_tally.fail) {
    const winner = unweighted_tally.pass > unweighted_tally.fail ? 'pass' : 'fail';
    return { winner, tieBreak: NO_TIE_BREAK };
  }

  // Exact tie: only here does the tiebreaker seat's weight ever get
  // consulted. Every other seat still contributes exactly 1.0, so the
  // weighted tally can only differ from the unweighted one by the epsilon.
  const weights = { [TIE_BREAK_SEAT_INDEX]: TIE_BREAK_WEIGHT };
  const weighted_tally = { pass: 0, fail: 0 };
  for (const v of list) {
    if (v?.vote !== 'pass' && v?.vote !== 'fail') continue;
    const w = v.seat === TIE_BREAK_SEAT_INDEX ? TIE_BREAK_WEIGHT : DEFAULT_WEIGHT;
    weighted_tally[v.vote] += w;
  }
  const winner = weighted_tally.pass > weighted_tally.fail ? 'pass'
    : weighted_tally.fail > weighted_tally.pass ? 'fail'
    // The tiebreaker seat itself didn't vote at all - the tie survives even
    // weighted. Not expected in practice (seat #1 is a debate participant
    // like any other), but never silently pick a side that has no votes for it.
    : null;

  return {
    winner,
    tieBreak: {
      occurred: true,
      decided_by: 'seat_weights',
      weights,
      unweighted_tally,
      weighted_tally,
      outcome_changed: winner !== null,
    },
  };
}
