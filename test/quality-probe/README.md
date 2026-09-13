# Seeded-defect quality probe (v5 §1 candidate 15, Phase 1)

## What this measures

Five checked-in fixtures (`fixtures.js`), each a synthetic planning-doc draft with one of five
defect types planted into it (missing section, wrong number, dropped constraint, broken
ordering, unresolved objection) — 25 planted-defect instances total. Three deterministic
heuristic detectors (`detectors.js`), tiered strict/medium/loose, stand in for a "mock panel" and
each independently votes on whether it notices the planted defect. `probe.js` aggregates the
votes into two **separate** numbers per defect type and overall:

- **catch-rate** — did the majority (≥2 of 3) detectors notice the defect?
- **unanimity** — did all three detectors agree, regardless of whether that agreement was right?

These are reported separately on purpose. Evidence from real council runs showed convergence
(the panel agreed) measured something entirely different from correctness (the panel was right)
— that conflation is the whole reason this probe exists. Reporting one number that blends them
back together would recreate the exact problem this candidate was built to fix.

## What this does NOT measure, and never may be quoted as

- **Not real-world correctness.** The defects are synthetic and planted by us, into synthetic
  fixtures we also wrote. A detector that catches 100% of these planted defects has demonstrated
  nothing about how it, or a real model panel, performs on a real plan with a real, un-cataloged
  defect.
- **Not a comparison against any other tool, model, or panel design.** This probe has no control
  group and was never built to have one.
- **Not a claim about how a real multi-lab council panel would perform.** The "panel" here is
  three deterministic heuristic functions (see `detectors.js`), not GLM/Kimi/DeepSeek/Mistral/
  Qwen. Phase 2 (replaying real recorded objections against seeded real deliverables) is the
  candidate that would let a real-panel claim be made honestly — Phase 2 needs a replay-driver
  design that does not exist yet and is not built by this Phase 1 work.

**The sentence this must never become, anywhere this number is published:**

> "The High Council catches N% of defects."

That sentence erases the fixture count, the synthetic-defect method, and the baseline in one
breath, and turns a heuristic self-test into an efficacy claim about a product. If a catch-rate
or unanimity number from this probe is ever quoted outside its own run folder, the fixture count,
defect types, and this caveat travel with it — `probe.js`'s `runQualityProbe()` return value
carries all four in the same object specifically so they can't be separated by accident.

## Where results live

`runQualityProbe()` returns an in-memory object; nothing writes to disk from importing it. A
maintainer who wants a persisted record can run `node scripts/quality-probe-report.mjs`, which
writes the same object as `summary.json` **inside its own timestamped folder** under
`quality-probe-runs/` — a sibling of, not inside, `runs/`. That's deliberate: `runs/` is where
real chain runs live, and the local UI's run list (and other `runs/`-scanners) has no
timestamp-shaped-ID filter guarding it from treating a foreign subfolder as a phantom run. A flat
sibling directory keeps this output out of `report.json`, `spend_report`, `verdict_stats`, the
local UI, or any other runtime or user-facing surface by construction, not by every reader
remembering to skip it. Publishing that file anywhere outside this repo is a separate, deliberate
human decision each time, never an automatic export.

## Test

    node --test --test-name-pattern=defect_seed test/quality-probe.test.js

No API key, no network call. Equivalent in spirit to the plan's `pytest -k defect_seed` — this
project's own test runner is `node --test`, not pytest.
