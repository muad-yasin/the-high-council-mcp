# v5 Phase 1 build decisions

## §1 candidate 1 - shape-round flag

**Finding worth reporting**: PLAN.md's own "How" for this candidate says it "reuses the existing
format/substance objection classes." No such classifier exists anywhere in this codebase (grepped
for format/substance/shape_only/objection_class - nothing). Built a fresh, deliberately
conservative keyword heuristic (`src/shape-rounds.js`, `classifyFailure`) instead of the assumed
reuse. Not adjusted to make a test pass after the fact - the heuristic was designed first, then
tested against both a same-round all-format case and a mixed case.

- A critique round is `shape_only` when it has at least one failure and every failure in it
  classifies as format-class; a round with zero failures (a clean pass) is not counted.
- Reads each round's critique file(s) already written to disk (`panel-N-<lab>.md` /
  `critique-N.md`) rather than adding new state.
- `shapeOnlyRounds` is summed per chain across the `--days` window in `verdict_stats`/`--stats`,
  matching the existing per-chain counters' convention.

## §1 candidate 2 - independence skew report

PLAN.md's "How" left the exact novelty/solo-signoff definitions to the builder. Interpreted as:

- **Novel objection**: within a run's `debate.posts`, an objection (`stance: 'object'`) is
  novel for the objecting lab if no other lab also objected (`stance: 'object'`) to the same
  target (`on`) in that run. Grouped per run, not across runs, since `on` ids are only unique
  within a run.
- **Solo signoff**: a lab's `signedOff: true` entry counts as a solo signoff if any other entry
  in that run's `signoff` array has `signedOff: false`, or has a non-empty `objections` array.
- **Low-independence flag**: `novelObjectionRate < 0.10 && soloSignoffRate > 0.60`, both
  configurable via `verdictStats(dir, { novelObjectionFloor, soloSignoffCeiling })`. Defaults
  match PLAN.md's stated default.
- A lab with zero objections or zero signoffs gets `null` rates, not `0` - matches the existing
  `meanRoundsToSignoff`/`meanCostUsd` convention of `null` for "no data" rather than a
  misleading zero.
- CSV formatter (`independenceStatsCsv`) is numbers-only, per the request's "no interpretation
  strings" constraint - `lowIndependence` is a boolean, not a label.
- No auto-reweighting of any panel based on this data - explicitly out of scope per PLAN.md's
  anti-roadmap and the candidate's own "Breaks/complicates" note.

## §1 candidate 3 - withdrawal-chain termination check

- A withdrawn proposal (`withdrawn: true`, `replaced_by: <id>`) is walked to whatever it names,
  repeatedly, until it reaches: (a) a proposal that is not withdrawn - resolved, not orphaned;
  (b) a proposal id already visited in this walk - a cycle, every id in the cycle is orphaned;
  (c) a withdrawn proposal with no `replaced_by` - a dead end, every id visited so far is
  orphaned; (d) a `replaced_by` id that doesn't exist in this run's proposals - dangling,
  treated the same as a dead end.
- `withdrawalCycles` counts distinct cycles by a sorted-id signature, so the same two-node cycle
  found by walking from either node only counts once.
- Wired in at the point closest to "stage close" that the codebase actually has for this: right
  after the reply round resolves `withdrawn`/`replaced_by` on `proposals` (`src/chain.js`, before
  the build stage). An orphan appends a note to `board` (read by the builder's prompt) naming the
  orphaned ids and requiring the plan to either assign or explicitly drop them - satisfies the
  "next round's integration prompt is told" requirement without a chain-schema change.
  `orphanSections`/`withdrawalCycles` are also recorded on the run's `report.json`.
- `council doctor --run <folder>` **recomputes** the ledger from `report.json`'s `proposals`
  rather than trusting a stored field, so it still works against a report.json written before
  this landed. Exits 1 and names the orphan(s) on stderr if any are found.
- Regression-tested against the real relay run that authored this candidate
  (`relay/runs/2026-09-13T14-51-08-757Z/`), per the handoff's explicit instruction: KIMI-4 and
  MISTRAL-2 mutually withdrew in each other's favour inside that run's own debate, and the
  landed detector does catch it (both ids appear in `orphanSections`, one cycle). That test
  skips rather than fails if the relay run folder isn't present on the machine running the
  suite, since it lives outside this repo.
