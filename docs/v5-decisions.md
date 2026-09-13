# v5 Phase 1 build decisions

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
