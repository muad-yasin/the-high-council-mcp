# For future contributors: a real, paid matched-cost comparison run

**Not built. Not scheduled. Not approved scope for this repo right now.** This file exists so
that whoever wants to run this - a future contributor, or the author with different budget
constraints later - doesn't have to re-derive the design from scratch. It documents a real gap in
what this project can currently claim, without funding or building a way to close it.

## The gap this would fill

`src/metrics.js`'s `consensusInducedRegressionCount` (see the module's own header comment and
`CIR_DISCLAIMER`) is a free, retrospective, same-run signal: did debate pressure move a position
away from something later same-run evidence disagreed with. **It is not, and cannot be, a
comparison against what a single model would have produced instead.** No single-model
counterfactual is measured anywhere in this repo. That comparison is what this document scopes.

## What a real comparison would need

A matched-cost benchmark across roughly seven configurations, run over a shared set of tasks with
equal dollar/token budgets across all of them:

1. Single model, single call.
2. Single model, with the extra token/compute budget a council run would have spent, given to
   that one model instead (controls for "more compute" rather than "more models").
3. A 2-model council (no debate, panel-only).
4. A 5-model council (no debate, panel-only).
5. The 5-model council with debate enabled (`config.debate`).
6. The 5-model council with debate **and** tool-grounded verification enabled
   (`config.verify.enabled` - this repo's actual ground-truth path).
7. A Mixture-of-Agents baseline (multiple models, but averaged/synthesized rather than debated -
   the standard MoA pattern, not something this repo implements).

Roughly 50-100 tasks, chosen so a real grading methodology can be applied afterward (see below -
this document does not supply one).

## How to price it before spending anything

Use this repo's own `dry_run` tool/CLI (`src/spend.js`'s pricing path) against each of the seven
configurations' chain definitions, for the full task set, before calling any paid model. Confirm
the **total** projected cost across all seven configurations combined against your own budget -
the comparison is only meaningful if every configuration ran under a genuinely matched budget, not
just the cheapest one.

## What a result would prove, if funded

A matched-cost, matched-task-set comparison of output quality - as judged by whatever grading
method is set up separately (this repo includes none) - between a single model, small and large
councils, and MoA, on the specific task set and budget chosen.

## What it would not prove

- General efficacy of council debate over single-model use.
- Performance on any task outside the sampled set.
- Anything about unmatched-budget deployments (a council given 5x the token budget of a single
  model is not a fair comparison, and configuration 2 above exists specifically to control for
  that).
- Anything at all, without a separate, honest grading methodology for the 50-100 tasks themselves.
  Scoring "which output is better" is itself unscoped here and is real, non-trivial design work of
  its own - don't assume it's a small addendum to the benchmark harness.

## Why this isn't being built now

The author declined to fund this at both the ~$300 full-run price point and the ~$20 pilot price
point (see `relay/runs/2026-09-14T00-20-44-997Z/deliverable.md`, item 6 - a private planning run,
not part of this public repo, referenced here only so the number isn't re-derived from nothing).
Those figures are reproduced here as historical context for a future reader's own estimate, not as
a current re-priced quote - re-check real API pricing before budgeting anything. Re-proposing this
same spend under a new metric name (it resurfaced during the `consensusInducedRegressionCount`
design discussion) is explicitly not what that metric does, and is not what this document
authorizes.

## BYOK, still

Nothing above implies a hosted, shared, or default-funded evaluation path. Anyone running this
brings their own API keys and pays their own bill, exactly like every other chain in this repo.
