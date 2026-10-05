# Evidence behind the rules, and a filled-in example card

## Evidence, graded

Each finding is a source's result about its own setup. None of it measures this skill. Grades follow `research-and-sourcing`: strong (primary source, read), moderate (one reputable source), inferential (derived, or read second-hand), proposed (untested).

- **Postdiction presented as prediction lowers reproducibility - strong.** Nosek, Ebersole, DeHaven and Mellor, "The preregistration revolution", PNAS 115(11), 2018 (full text on PubMed Central, PMC5856500): "Presenting postdictions as predictions can increase the attractiveness and publishability of findings by falsely reducing uncertainty. Ultimately, this decreases reproducibility." Two passages carry rules here. The calibration split: "the dataset is split in two. One part is used for exploratory analysis to develop the models and predictions; the other part is sealed until exploration is complete", which converts postdictions from the first part into predictions for the second. And transparent reporting: when changes are made, they can be reported "transparently ... making it possible to assess their impact".
- **Deviations from a registered plan are common and often undisclosed - strong for this sample.** Claesen, Gomes, Tuerlinckx and Vanpaemel, "Comparing dream to reality: an assessment of adherence of the first generation of preregistered studies", Royal Society Open Science 8:211037, 2021 (PMC8548785): of 27 preregistered studies, 2 had no deviations (so 25 deviated); in one study all deviations were disclosed; nine disclosed none. The authors recommend disclosing deviations "clearly and directly in the main text". The sample is one journal's first preregistered studies; it shows the failure exists, not its rate elsewhere.
- **A template for reporting deviations exists - moderate.** Willroth and Atherton, "Best Laid Plans: A Guide to Reporting Preregistration Deviations", Advances in Methods and Practices in Psychological Science, first published online 5 Feb 2024, open access, doi 10.1177/25152459231213802: a framework and template for transparent, standardised reporting of deviations, drawn from the authors' experience, existing templates and a survey of 34 journal editors. The "dated, labelled amendment" rule follows its spirit. Its individual template fields were read only in a secondary summary, so none of them is copied here (inferential). The "report both verdicts side by side" and "someone other than the author approves" parts of the amendment rule are this skill's own synthesis (inferential).
- **The term HARKing - inferential.** Kerr, "HARKing: Hypothesizing After the Results are Known", Personality and Social Psychology Review 2(3):196-217, 1998; the attribution comes from search listings and is widely repeated.
- **Coding agents exploit tests when honest passing is impossible - strong.** Zhong, Raghunathan and Carlini, "ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases", arXiv 2510.20270 v1, 23 Oct 2025. Tasks are made impossible so any pass is a cheat. The paper names four behaviours (modifying test cases, overloading comparison operators, recording extra state, special-casing inputs) and finds that "hiding tests from agents reduces cheating success rate to near zero" at a cost to legitimate performance, while "read-only access provides a middle ground: it restores legitimate performance while preventing test modification attempts". Giving the agent a way to stop and flag a conflict (submitting `flag_for_human_intervention`, which ended the run) cut one model's cheating rate from 54 percent to 9 percent on one variant. The skill uses the read-only finding. For the wider evidence on agents gaming checks, see `verification-and-critique`.
- **Guardrail metrics and segment slicing - strong.** Machmouchi, Gupta and Zhang (Microsoft Experimentation Platform), "Patterns of Trustworthy Experimentation: During-Experiment Stage", 25 Jan 2021: guardrail metrics "measure aspects of the product that we don't want to degrade but won't necessarily improve", and "treatments affect users differently depending on their characteristics", which is why results are sliced by segment instead of read only in aggregate.
- **Excessive verification is a documented procedural failure - moderate.** Dong et al., "Agent Skills Can Be Harmful: An Empirical Study of Skill-Induced Failures in LLM Agents", arXiv 2608.11888, 12 Aug 2026 (abstract): "The largest sources within Excessive Procedure are excessive verification and heavy implementation pipelines, contributing 67 and 30 cases, respectively." The study analysed 307 skill-induced failures; 67 is a count within the Excessive Procedure category, not a share of the 307.
- **A skill with no applicability boundary can make tasks worse - inferential.** SkillsBench, Li et al., arXiv 2602.12670 v4: 13 of 87 tasks got worse with curated skills, and the cause given in the body (Sec. 5.1.3) is a prescribed pipeline with no applicability boundary. Read second-hand from the full text; the abstract does not state it.
- **Interval arithmetic used in the card examples - computed, not sourced.** Wilson 95 percent lower bound: 40 of 40 gives 0.91; 5 of 6 gives 0.44; 6 of 6 gives 0.61. Anyone can recompute these.

What we have not found: a measurement of whether writing a proof card before a run improves the reliability of agent-run proofs. That claim is a mechanism taken from research methodology, not a measured effect for agents. Judge it in real use: note when a card caught something, and when it missed something. Real use so far, on one project: a post-data amendment was disclosed and accepted as a dated amendment (the rule worked), and a careful card still tested a tautology (the gap that "both outcomes reachable" closes).

## Example card (generic, filled in)

```
Proof: lane-graph-connectivity-after-fix       Written: before the run, committed as card.md
Claim:   After fix F, the largest connected component of the lane graph holds at least 98 percent
         of lanes in every stratum of the 120-tile stratified sample S (seed 7, drawn before the run).
Sample:  120 tiles, 4 strata (inner city, ring, outskirts, border), 30 per stratum, seed 7.
         Not the failing tiles; those get a separate card. Includes the 5 tiles where a person
         already reported a broken route.
Criteria:
  1. BLOCKING. Largest component fraction >= 0.98 per stratum (threshold: the pre-fix median 0.995
     minus a margin we accept, 0.015).
     Reachable: the broken-graph fixture must give a NO (fraction below 0.98), and 30 tiles per
     stratum can show a YES (the pre-fix median already exceeds the threshold).
  2. BLOCKING. No lane with zero successors outside tagged dead ends (count must be 0).
  3. BLOCKING. Harness self-check: the broken-graph fixture FAILS criterion 1, the golden fixture PASSES.
  4. BLOCKING, presence. At least 1 lane carries the re-linked junction tag in each stratum
     (a fix that never fires is a FAIL, not a quiet zero).
Guardrails (REPORTED, per stratum, never only in aggregate):
  G1. Junction-mouth connectivity does not drop below its pre-fix value.
  G2. Graph build time and node count no more than 1.5 times the pre-fix build (a generated
      artifact that doubles is a finding).
Verdict rule:  PASS if 1, 2, 3 and 4 hold. FAIL if 1, 2 or 4 fails in any stratum. INCONCLUSIVE if 3
               fails or any tile cannot be read (reported by name). A guardrail miss never changes
               the verdict; it is written under "Does not close".
Fallback:      On FAIL, revert F, keep the previous graph build, and note whether the miss blocks the
               milestone; a new card only if it does. On a guardrail miss, record it and move on.
Stop:          One run. One harness fix before any result is seen is allowed and disclosed.
               Post-data changes: at most one, dated, with the original verdict.
Independent check: The result gates the rebuild, so a fresh session gets this card and the per-tile
               table, nothing else, and re-derives the verdict.
```

What the report may then say on PASS: "On the 120-tile stratified sample S, the largest component holds at least 98 percent of lanes in every stratum." What it may not say: "the graph is connected" (no claim about the tiles outside S) or "F fixes junction topology" (not tested).

What goes in the report on an amendment: "Post-data, dated: criterion 1 threshold moved from 0.98 to 0.97 after observing the outskirts stratum at 0.972. Under the card as written: FAIL (outskirts). Amended: PASS. The amended verdict is exploratory; a confirmation run on a new sample S2 is spent only if this result is going to gate the rebuild."
