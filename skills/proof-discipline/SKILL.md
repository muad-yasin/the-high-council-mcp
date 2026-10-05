---
name: proof-discipline
description: Fixes the test before the data is seen, for any measured result that will gate a milestone, set a baseline, decide a rebuild or cost real compute - a short proof card with a scoped claim, a sample, criteria tiered blocking or reported (each able to come out either way), guardrails on what must not get worse, a verdict rule and a fallback, all committed before the run. Keeps the verdict apart from the decision to proceed, scopes every claim to the sample actually tested, and labels any change made after seeing results as a dated post-data amendment. Use before a batch, migration, pipeline change or fix run over real data, before writing "this works" about anything validated on a sample, and when a result tempts you to adjust the bar. Not for a quick try where a person's own use is the test (write a few acceptance lines instead), scoping a task (task-scoping), what counts as evidence in general (verification-and-critique), or a generator's own output invariants (backend-developer).
license: MIT
---

# Proof Discipline

A proof run is a test of a claim, and it only tests anything if the bar was fixed before the data was seen. Once you have looked at results and then chosen the bar, the run can no longer fail: the bar is drawn around what happened. Research methods call this HARKing (hypothesising after the results are known), and its remedy is to fix the question and the analysis plan before observing the outcome, so predictions stay separable from after-the-fact explanations. The remedy has a known weak half. In one audit of the first preregistered studies in a psychology journal, 25 of 27 deviated from their plan and only one disclosed every deviation (Claesen et al. 2021). So the rule has two halves: write the bar first, and **say out loud every time it moved.**

**This skill owns:** how a proof is specified, run, scoped and reported. **It hands off:** what counts as evidence in general, a check that was skipped or unreadable, per-item output, who may certify a result, and the two criteria tiers with the rule that the verdict never bends (`verification-and-critique`: "Criteria come in two tiers, and the verdict never bends"; the owner of that rule); what to build, whether the claim is what was asked, and the stop-condition rule (`task-scoping`); the invariants a generator's own output must meet (`backend-developer`).

## Is a card worth writing?

A card is for a result that will **gate a milestone, set a baseline, decide a rebuild, or cost real compute.** A quick try where a person's own use is the test (does it feel right, does it look right) gets a few acceptance lines written first and that person's verdict; a card there is overhead that buys nothing. A skill-effects benchmark found that tasks got worse when a skill prescribed one pipeline with no applicability boundary (SkillsBench v4; evidence in the reference), so this is a boundary on purpose. When in doubt, ask whether anyone will rely on the number. If yes, write the card.

## Before any data: the proof card

A few lines each, in a file whose commit precedes the first output. It may be a header in the launcher script or a section of a handoff; what matters is the order, and the commit hash goes in the report, which is how a reader sees the card came first.

1. **Claim.** One sentence with its scope in it. "Junction arms agree in height on the 40 tiles in sample S" is a claim; "junction heights are fixed" is not. If the claim tests something narrower than, or different from, what was asked, say so on the card in the requester's own words, and put the difference to the requester as a choice (`task-scoping`). A proof that passes can otherwise launder a substitution nobody agreed to.
2. **Sample.** What exactly the proof runs on, how it was chosen, how big it is. A sample picked by looking at what fails shows the fix works on those cases and nothing else. A random or stratified sample drawn before the run, seed recorded, supports a wider claim. Include the strata the change does not aim at, and any place a person has already reported a problem.
3. **Criteria.** Each checkable by a script or a number, with its threshold written before you see the distribution. Never "looks right". For each one, write four things:
   - **Tier.** BLOCKING (it gates the milestone or decision) or REPORTED (measured and written down, never re-run on its own account). The rule and its reasoning are `verification-and-critique`'s; the card only records which tier each criterion has.
   - **A threshold from outside the run.** If it has to come from data, derive it on a separate calibration sample the proof will not use, and name that sample and the rule on the card. Splitting the data and sealing one part until exploration is done is how research methods turn exploration into a test (Nosek et al. 2018).
   - **Both outcomes reachable.** Ask whether this data could produce a NO, and whether this sample size could produce a YES. If the way the data was made forces the answer, the test is a tautology, whatever its controls: one check asked whether the small bends of a smoothed surface sat on the grid it was smoothed over, got 99 percent, and reported "lined up", when a surface smoothed over a grid can only bend on grid lines. Change the question or the data. On the other side, work out the best possible result at N before the run: a 95 percent lower bound of at least 0.95 cannot be met with 40 cases even at 40 of 40 (Wilson lower bound 0.91). An unreachable threshold is a defect in the card, not a finding.
   - **Presence, where something must happen.** Anything that must occur at least once gets a count of at least 1, so a feature that never fires is a FAIL and not a quiet zero. One feature logged "0 shown" through two builds because no criterion asked for one.
4. **Guardrails.** One to three criteria naming what must not get worse, measured where the change does not aim and reported per stratum, never only in aggregate. Cost and size against a control (a generated mesh with 12 times the triangles of its control was found only by measuring), counts in the strata the fix does not target, and a before/after diff at places a person already uses. Guardrail metrics "measure aspects of the product that we don't want to degrade but won't necessarily improve" (Microsoft Experimentation Platform, 2021), and segment slicing exists because treatments affect segments differently. A fix once made plain stretches five times smoother and the junctions between them worse; only the aggregate had been looked at.
5. **Verdict rule and fallback.**
   - How the criteria combine (all BLOCKING ones, or a stated count), what is FAIL, what is INCONCLUSIVE (too few cases, a check that could not run or was skipped, a result that cannot be read), and the **n/a conditions**: a criterion that does not apply is n/a, not a miss. An unreadable, skipped or missing result is never a PASS (`verification-and-critique`).
   - What happens on FAIL: revert, keep the old path, stop and escalate, or, for a REPORTED criterion, record the miss under "Does not close" and move on. Decide it now. A proof with no fallback invites lowering the bar when it fails (an inference), because the cost of failing is a gap nobody planned for.

Optional lines when the stakes warrant: a **stop condition** (maximum runs, time, spend; the rule is `task-scoping`'s) and an **independent check**, which may be a person's own use of the result, named on the card as the gate, with the automated criteria as the floor.

## Running it

- **Run the card as written.** A harness fix made before any result is seen is a harness fix: say what you fixed. One made after any result is seen, or one that changes what is counted (a filter, a join, a threshold), is a post-data change to the proof.
- **Check the checker before trusting it on real data.** Feed it one case that must fail and one that must pass. A check that says "all good" on every input has shown nothing. Keep the card and the checking script read-only to the agent that runs the proof: in a benchmark built to make honest passing impossible, read-only test access stopped test edits while keeping legitimate performance (ImpossibleBench, Zhong et al. 2025).
- **Keep the raw outputs.** The verdict is a derived claim; the files it came from are the evidence. Name them by path and commit, plus the per-case table.
- **A second reader only where it pays.** When the result gates a release or rebuild, sets a baseline, or decides to stop work, give a fresh session the card and the raw outputs and nothing else, and ask it to re-derive the verdict and list any criterion it cannot check. Below those triggers, skip it: excessive verification is a documented way for a procedure to make agents worse (the largest source, 67 cases, within the Excessive Procedure failures of a 307-failure study; Dong et al. 2026).

## When the result comes in

**PASS** means exactly the card's claim on exactly the card's sample. Write that sentence in the report before any wider one. A wider claim needs its own sample.

**FAIL** stays FAIL. Next comes the fallback on the card, or a decision by whoever owns the milestone to proceed anyway, recorded with who and when. That decision never changes the verdict, and "pass with caveats" is not a verdict when the caveat is the failed criterion. A failure you can explain is still a failure: form a hypothesis from what you saw, and test it on data that was not used to form it. A new card and a new run are for a miss that blocks something; a miss that blocks nothing goes under "Does not close" and work continues.

**INCONCLUSIVE** means the proof did not run well enough to say. Report it as such, with the reason; nothing failing is not the same as passing.

**A stop on the card's own rule** (FAIL, INCONCLUSIVE, the change cap) did its job. Report it plainly, take the fallback, and do not keep going until it passes: a pass that arrives after the bar was bent to reach it tells the reader nothing.

### Changes after seeing data

This run's verdict is computed on the card as written and never moves. Changing the bar, the sample or the method after seeing results is sometimes right, and it is never silent. Each change is a **dated post-data amendment**: what changed, why, when, and what the original rule would have said ("threshold moved from 0.5 m to 0.8 m after the median gap came out at 0.62 m; under the original threshold 31 of 40 tiles fail"). Disclose it in either direction, rescuing or stricter.

- **Report both verdicts**, the card's and the amended one. The amended one is exploratory and applies to the next attempt or to an exploratory reading.
- **Someone other than the author approves an amendment** that the result will be relied on through.
- **Do not rely on the amended verdict until new data confirms it.** Spend that confirmation run only if the result blocks a milestone or a decision; otherwise the original verdict stands and the miss goes under "Does not close."
- **Count the changes.** Several small amendments are one large change. Default cap: one (a judgement and not a measured figure). Past it, the run stands as written; write a new card if the miss blocks something.
- An amendment that exists because a bound turned out unreachable at the sample size is a defect in the card (see "Both outcomes reachable"), and says so.

## Scoping the claim

Write the scope into the headline. These are the shapes that go wrong:

| What was tested | What the report may say | What it may not say |
|---|---|---|
| The 12 cases that were failing | "Fixes these 12" | "Fixes the defect class" |
| A hand-picked sample of easy cases | "Works on this sample" | "Works" |
| A random sample of N, seed recorded | "On a random sample of N, the rate is p (interval)" | A precise rate for the whole population |
| One machine, one seed, one build | "On this machine and seed" | "Deterministic" |
| A test the author wrote after the change | "Passes the new check" | "Verified" |
| An offline rig or a stand-in engine | "Passes in the rig" | "Works in the real system" |

## Report template

```
Proof:             <name>   Card: <path or commit>   Run: <date, build or commit, seed>
Claim (scoped):    <one sentence>
Sample:            <what, how chosen, N>
Criteria:          <n>. <criterion, threshold, tier> -> <value> -> MET or FAILED or n/a
Guardrails:        <criterion, per stratum> -> <value> -> MET or FAILED
Verdict:           PASS or FAIL or INCONCLUSIVE   (rule as written on the card)
Decision:          none, or proceed past FAIL by <who>, <date>, <reason>
Post-data changes: none, or <what, why, when, original rule's verdict>
Fallback taken:    <none or what>
Does not close:    <what this does not show, including REPORTED misses>
Evidence:          <paths to raw outputs and the per-case table>
```

## Mistakes to flag

- Criteria written after the first look at the data, or a threshold chosen to sit just inside the result.
- A test whose NO answer was unreachable for this data (a tautology), or a threshold no result at this N could meet.
- A claim without a scope, or a scope that quietly grew between the card and the report.
- A sample picked from what fails, then described as representative.
- A gate or check never shown to fail on a known bad case; "zero problems" from a check that ran on zero inputs.
- A feature that must fire, with no criterion requiring a count of at least 1.
- No guardrail where the change could make things worse elsewhere; only the aggregate reported.
- A changed bar, filter or sample not labelled post-data, or only the amended verdict reported.
- A FAIL reframed as "pass with caveats", or the decision to proceed written over the verdict.
- A second round spent on a miss that blocks nothing, or "one more tweak" past a stop.
- No fallback written, so the bar moves when the proof fails.
- A card written for a result nobody will rely on, or none written for one that gates a decision.

Evidence for these rules, graded, and a filled-in example card: `references/evidence-and-example.md`.
