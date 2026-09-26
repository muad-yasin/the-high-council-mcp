# Scoping toolkit

## A one-page task spec

```
Goal:        <the question this work answers, one sentence>
Criteria:    1. <yes/no-checkable property of the result>
             2. ...
Non-goals:   - <deliberately not doing>
Stop when:   <definition of done> | cap: <rounds / retries / spend / time>
Risky steps: - <irreversible or external action> -> gate: <who confirms, when>
Defaults:    - <assumption taken if no answer arrives>
Order:       1. <riskiest unknown first> 2. <cheapest end-to-end> 3. <volume> 4. <polish>
Effort:      <n steps / tool calls / agents this deserves>
Open:        - <owner decisions not closed by this plan>
```

Criteria describe the *property* checked, never a phrase the result must contain. "Makes no decision about any excluded topic" can be judged; "labels each excluded topic 'out of scope'" turns reviewers into string-matchers who fail a result for wording it got right. Keep criteria to the smallest atomic set - merge any two a reviewer would check by reading the same passage.

## The scope gate - run on every new idea before acting on it

1. **Does it serve the current goal?** If not, it waits - written down, not lost.
2. **Which phase does it belong to?** Later-phase work proposed now goes to a written parking list.
3. **Reuse or new system?** Name honestly whether this reuses an existing mechanism or opens new engineering surface.
4. **Can it strand anyone?** A new failure state with no route back is a blocker.
5. **User and business lens.** Retention or monetization ideas get checked against category norms (cite comparable products as evidence, not opinion) and against manipulative patterns - especially when revenue-positive.
6. **Is there a cheaper version that answers the same question?**

## Estimation without a base rate

- **Outside view first.** Before estimating from the plan's details, ask how long similar work actually took, from real records. The inside view systematically underestimates.
- **Pre-mortem.** Assume the work failed; list the most likely reasons; add the cheap mitigations to the plan now.
- **Tag assumptions.** Mark each load-bearing assumption as verified, plausible, or guessed. A plan resting on guessed assumptions says so.
- **Don't invent a number.** Where no measured base rate exists, describe what the work depends on and what makes it uncertain instead of quoting hours.

## Effort tiers (adapt to your system)

- **Lookup** - one source, one answer: a single call, no delegation.
- **Comparison** - a handful of sources or options: a few calls, maybe two parallel workers.
- **Investigation** - open-ended, many sources: a lead plus several workers with distinct, non-overlapping briefs.
- **Build** - state changes: plan, cheapest end-to-end instance, verify, then volume.

Write the tiers into the orchestrator's instructions; an unwritten tier is not applied.

## Ordering heuristics

- Riskiest unknown first; the thing that could invalidate the whole plan goes before anything that depends on it.
- Anything a later step's numbers depend on goes first, so nothing gets tuned twice.
- One concrete, finishable goal per work block - silent scope creep then shows up as a missed micro-goal rather than a vague long session.
- Irreversible steps as late as possible, after everything reversible has been verified.
