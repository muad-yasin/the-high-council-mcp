# Generated data, derived numbers, simulation, and the instruments that judge code

Read before writing or tuning any generator (a data seeder, a procedural layout, a graph builder, a fixture factory), before any work where numbers are derived from other numbers (pricing, quotas, rate limits, credits, rewards, pacing), and before proposing a new test instrument.

## 1. Generators: gates, invariants, validation

- **Every hard eligibility gate inside a generator is paired with a loud check on the output invariant it could break.** Gates fail by producing nothing. Real incident: a tightened curvature gate rejected every candidate site, placed zero connecting features, and silently pruned about 60% of a generated graph's nodes - leaving 40% of the result unreachable - caught only by reading the run log by hand. The shipped fix was a hard error when the feature count fell below a floor or the largest connected component fell below 90%. State the invariant, make its violation unshippable.
- **Validate over golden seeds plus random seeds.** A few frozen seeds catch regressions deterministically; a few fresh random seeds per run catch what the goldens missed. This is exactly what property-based testing automates, if it is ever adopted (section 4).
- **Instrument before iterating.** Rejection counters per gate and sampled percentiles of the real input distribution, before any tuning. Blind tune-and-rerun is threshold roulette. The measure-the-distribution form matters too: an uncalibrated first-guess cap was measured to exclude only ~6% of what it was meant to exclude before being recalibrated from real percentiles.
- **Fewer correct instances beat a loosened gate.** Count-chasing reintroduces exactly the broken instances the gate exists to reject. Ship the smaller correct count and record which knobs would raise it later, so the compromise stays reversible.
- **Make the generator log its risky features' positions in reviewer-usable coordinates**, so a review crops straight to the likeliest defects instead of hunting.
- **Build one, verify it, then duplicate.** Redoing one instance is cheap; redoing twelve is not.
- **Prove the cheapest end-to-end path before investing in content.** Push one trivial instance through the real pipeline first - convention mismatches fail by looking broken, not by erroring.

## 2. Derived numbers

- **Trace every number to its source in a comment.** A value with no trace is presumed invented. This is defensive rather than settled science: the tendency of generated code toward magic numbers and weak numeric reasoning is well documented, while the specific claim that models mis-trace derivations is inferred rather than directly studied. Keep the rule because it is cheap and the incident is real, not because the literature proved it.
- **Derive against a self-contained anchor.** The ~60x error: a gate's cost was derived from another subsystem's eventual full-ceiling multiplier, which was only reachable after spending far more than the gate itself protected. Anchor to something that exists now and doesn't depend on the gate.
- **Read current thresholds from their one source; never quote them in a second place.** A document that once carried four copies of live thresholds had all four go stale as they were retuned. Point to the source instead.
- **Two knobs that could drift independently get two names and a decoupling test.** Worked shape: when a cap that had doubled as a quality reference was split into two constants, a byte-identical-output test proved raising the cap did not change the payout the old reference produced.

## 3. Simulating flow offline

- **Model forward before waiting for live data.** Any system where value flows in and out over time (credits, quotas, balances, pacing, rewards) is checkable by running its formulas forward in a plain harness and printing time-to-threshold at each step. Exponential systems in particular break in ways nobody predicts by reading formulas.
- **Simulate the individual session's net flow, not the aggregate.** A widely-discussed live-game failure is exactly this: a sink designed to keep an economy in check balanced in aggregate while ordinary play sessions routinely ended with the player *down* - every session felt like a loss. A retune that preserves the total per hour can still make each session negative; check the per-session curve at every stage.
- **Elapsed-time math is the highest-risk numeric code.** Long elapsed-time multiplications, capped windows, and compounding all meet in one function. Give it its own invariant suite: monotonic in elapsed time, never negative, never exceeding its cap, equal to a closed-form expectation for the simple single-source case - and exercise the numeric type over the full range reached, because precision loss and overflow are silent.
- **Describe what to measure post-launch before choosing how.** Per-flow source/sink events and a stage-transition funnel (what fraction reaching stage N reach N+1, and how long it takes - a cliff localizes the problem to one knob). The telemetry mechanism is a separate decision; never pre-install an analytics dependency on the authority of this paragraph.

## 4. Instruments that judge code past compile-and-pass

**Treat each as a proposal with a real cost. Raise it before adopting; never write as if it were existing practice.** The honest framing: a model cannot certify "does this migration work" or "does this number derive from its stated source" by inspection - it can write and run checks that answer those questions.

- **Golden fixtures (no new tooling, adopt freely).** Real stored examples frozen per meaningful state, loaded by a test asserting key fields survive. A migration that a read-through blessed and a fixture rejects is the entire point.
- **Contract/schema tests** (JSON Schema, OpenAPI validation, protobuf compatibility). Catch drift between what a service promises and returns - cheap once the contract is written down.
- **Property-based testing** - assert an invariant, let the framework generate hundreds of inputs and shrink any failure to a minimal case. Best fit: serializers, state machines, numeric invariants. Properties worth having: `decode(encode(x)) == x`; loading any generated old-version record yields a valid current one; balances never negative; a derived total equals the sum of its sources; a derive function is idempotent and order-independent (the structural form of the ~60x lesson); generator invariants over arbitrary seeds. Weak for anything whose correctness depends on external state.
- **Mutation testing** - mutate production code (`>` to `>=`, drop a call, flip a boolean) and see whether any test fails. A surviving mutant is a test that executes code without asserting its effect - the classic "asserts no exception was thrown." That is precisely the shape generated tests fall into, which is why it is worth more on a generated suite than a hand-written one. Point it at the highest-signal module only; treat a survivor on a numeric constant or state transition as a real gap rather than chasing a global score. Slow - an occasional deliberate pass, never a per-change gate.

Evidence note: all four are strong as general practice; their specific value on any one codebase is an inference until measured there.
