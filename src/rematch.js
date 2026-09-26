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
// (critics, proposers or alternatives), and re-anonymizes the `lab` field to a fresh sequential
// label independent of the original lab identity. The original lab name is exactly the framing
// signal a rematch exists to test robustness against (a critic's past reputation, or its position
// in a debate), so carrying it forward unchanged would defeat the point. Arrays shorter than 2 have
// no non-trivial permutation and keep their models; their labels are still renamed.
//
// Labels come from ONE map for the whole config (verification of thc-research PR #13, finding 4):
// a lab keeps one new label in every list it sits in, and two different labs never share one. The
// labels used to be per list (slot i was `lab-${i + 1}` in critics AND in proposers), which was
// harmless while both lists held the same labs, but in a tiered chain (seven mass proposers, four
// anchor critics) it gave a mass seat and an anchor the same `lab-1` - one lab to every check keyed
// on labOf - and left seats.alternatives and seats.deep_dive under their real names. A lab seen for
// the first time takes `lab-${slot + 1}` when that label is still free (so a single list, or lists
// that hold the same labs, label exactly as before), else the lowest free `lab-N`.
function reshuffleSeatArray(seats, seed, relabel, used) {
  if (!Array.isArray(seats)) return seats;
  const n = seats.length;
  const shift = n < 2 ? 0 : 1 + (((seed % (n - 1)) + (n - 1)) % (n - 1));
  const triples = seats.map(s => ({ provider: s.provider, model: s.model, extra: s.extra, lab: s.lab || s.provider }));
  const rotated = rotate(triples, shift);
  return seats.map((s, i) => {
    const next = { ...s, provider: rotated[i].provider, model: rotated[i].model, lab: labelFor(rotated[i].lab, i + 1, relabel, used) };
    if (rotated[i].extra !== undefined) next.extra = rotated[i].extra; else delete next.extra;
    return next;
  });
}

function labelFor(original, preferred, relabel, used) {
  if (relabel.has(original)) return relabel.get(original);
  let label = `lab-${preferred}`;
  for (let k = 1; used.has(label); k++) label = `lab-${k}`;
  relabel.set(original, label);
  used.add(label);
  return label;
}

/**
 * A deterministic, seedable reshuffle of a chain config's seat lists. Contract:
 *   reshuffleSeats(config, seed) -> a new config object (config itself is never mutated)
 *   - `seats.proposers`, `seats.critics` and `seats.alternatives`, if present as arrays of length
 *     >= 2, each get an independent rotation-based permutation of their provider/model/extra
 *     assignment. Every seat in them, and `seats.deep_dive`, gets an anonymous `lab-N` label from
 *     one config-wide map: one lab, one label, in every list (see reshuffleSeatArray).
 *   - Every other seat kind (criteria, builder, reviser, finalist, skeleton, handoff, questions,
 *     judge) and every non-seat chain-config field (rounds, signoff, maxRounds, ...) is passed
 *     through byte-for-byte - a rematch varies who argues, never the rules of the argument.
 *   - `seed` must be an integer; the same seed against the same config always produces the same
 *     permutation (determinism is what makes `--rematch-seed N` reproducible for tests and for a
 *     human re-checking a specific rematch later).
 */
export function reshuffleSeats(config, seed) {
  const seats = { ...config.seats };
  // Pre-release audit, replay #2 (Review/PreRelease_Audit_replay_2026-09-23.md): `roster.*_seat`
  // names a seat by its lab ("criteria_seat": "mock-a"). The relabelling below renamed every lab, so
  // the reference matched nothing and every --rematch of such a chain failed. It now follows the
  // seat's lab to its new label, which is the same in every list.
  const relabel = new Map();
  const used = new Set();
  for (const key of ['proposers', 'critics', 'alternatives']) {
    if (Array.isArray(seats[key]) && seats[key].length >= 2) seats[key] = reshuffleSeatArray(seats[key], seed, relabel, used);
  }
  // Lists too short to permute, and the one deep-dive seat, keep their model but lose their name.
  for (const key of ['proposers', 'critics', 'alternatives']) {
    if (Array.isArray(seats[key]) && seats[key].length === 1 && seats[key][0]) seats[key] = [{ ...seats[key][0], lab: labelFor(seats[key][0].lab || seats[key][0].provider, 1, relabel, used) }];
  }
  if (seats.deep_dive && typeof seats.deep_dive === 'object' && !Array.isArray(seats.deep_dive)) {
    seats.deep_dive = { ...seats.deep_dive, lab: labelFor(seats.deep_dive.lab || seats.deep_dive.provider, 1, relabel, used) };
  }
  let roster = config.roster;
  if (roster && typeof roster === 'object') {
    roster = { ...roster };
    for (const [k, v] of Object.entries(roster)) if (k.endsWith('_seat') && relabel.has(v)) roster[k] = relabel.get(v);
  }
  return { ...config, seats, ...(roster !== undefined ? { roster } : {}) };
}
