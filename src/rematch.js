// Item C (blind rematch) - relay/runs/2026-09-15T15-12-52-325Z/deliverable.md.
// Re-runs an already-decided task with labs re-shuffled/re-anonymized to test order/framing
// robustness. This module is the pure, offline-testable half: given a chain config and a seed,
// produce a new config with a different provider/model-per-seat permutation. The CLI wrapper
// (src/cli.js's --rematch branch) does the I/O; nothing here touches disk or the network.

// Rotation, not a general shuffle: a cyclic rotation of a length-n array by any shift in
// [1, n-1] has no fixed points (a fixed point would need shift ≡ 0 mod n), so it is a guaranteed
// derangement - every seat gets a different provider/model than it started with. This is what
// backend-developer/SKILL.md rule 10 asks for ("anything checked against an expected value is
// only verifiable if its inputs are controllable"): the acceptance test needs a rematch to
// provably differ from the original every time, not merely with high probability the way an
// unconstrained Fisher-Yates shuffle would (a 2-seat panel has a 50% chance of shuffling back to
// itself).
function rotate(arr, shift) {
  const n = arr.length;
  return arr.map((_, i) => arr[(i + shift) % n]);
}

// Permutes which {provider, model, extra} triple sits in which seat slot within one seat array
// (critics or proposers), and re-anonymizes the `lab` field to a fresh sequential label
// independent of the original lab identity. The original lab name is exactly the framing signal
// a rematch exists to test robustness against (a critic's past reputation, or its position in a
// debate), so carrying it forward unchanged would defeat the point. Arrays shorter than 2 have no
// non-trivial permutation and are returned unchanged - not an error, just nothing to reshuffle.
function reshuffleSeatArray(seats, seed) {
  if (!Array.isArray(seats) || seats.length < 2) return seats;
  const n = seats.length;
  const shift = 1 + (((seed % (n - 1)) + (n - 1)) % (n - 1));
  const triples = seats.map(s => ({ provider: s.provider, model: s.model, extra: s.extra }));
  const rotated = rotate(triples, shift);
  return seats.map((s, i) => {
    const next = { ...s, provider: rotated[i].provider, model: rotated[i].model, lab: `lab-${i + 1}` };
    if (rotated[i].extra !== undefined) next.extra = rotated[i].extra; else delete next.extra;
    return next;
  });
}

/**
 * A deterministic, seedable reshuffle of a chain config's critic/proposer seats. Contract:
 *   reshuffleSeats(config, seed) -> a new config object (config itself is never mutated)
 *   - `seats.critics` and `seats.proposers`, if present as arrays of length >= 2, each get an
 *     independent rotation-based permutation of their provider/model/extra assignment, and a
 *     fresh `lab-1`, `lab-2`, ... label per slot.
 *   - Every other seat kind (criteria, builder, reviser, finalist, skeleton, handoff, questions,
 *     judge) and every non-seat chain-config field (rounds, signoff, maxRounds, ...) is passed
 *     through byte-for-byte - a rematch varies who argues, never the rules of the argument.
 *   - `seed` must be an integer; the same seed against the same config always produces the same
 *     permutation (determinism is what makes `--rematch-seed N` reproducible for tests and for a
 *     human re-checking a specific rematch later).
 */
export function reshuffleSeats(config, seed) {
  const seats = { ...config.seats };
  if (Array.isArray(seats.critics)) seats.critics = reshuffleSeatArray(seats.critics, seed);
  if (Array.isArray(seats.proposers)) seats.proposers = reshuffleSeatArray(seats.proposers, seed);
  return { ...config, seats };
}
