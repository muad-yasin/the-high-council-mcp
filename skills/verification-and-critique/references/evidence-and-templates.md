# Evidence behind the rules, and templates

## The evidence, graded

Findings below are each source's result about its own setup - never a claim about any particular skill or system built from them.

- **Self-correction limits - STRONG.** "Large Language Models Cannot Self-Correct Reasoning Yet" (ICLR 2024) and "When Can LLMs Actually Correct Their Own Mistakes?" (TACL 2024) find that without external feedback, self-review struggles and at times degrades accuracy; external signals are what make correction work.
- **False success - MODERATE (single workshop paper, 2026).** "From Confident Closing to Silent Failure: Characterizing False Success in LLM Agents" (FAGEN workshop at ICML 2026) found false success - the agent claims completion, the environment disagrees - to be anywhere from about 3% to 76% of failures depending on the setting (45-48% in the single-control tau2-bench domains, 3% in the dual-control telecom domain, 75.8% of AppWorld failures among self-assessing coding agents), and LLM judges performing poorly at detecting it (no judge configuration above AUROC 0.65) while leaning on confident closing language. Cheap text detectors calibrated to the domain reached 0.83 and 0.95 in the same study, which supports preferring a check cheap enough to always run.
- **Reward hacking against tests - STRONG (benchmarked).** ImpossibleBench (2025) makes tasks impossible so any pass means cheating, and catalogues agents editing tests, special-casing inputs, counting calls and overloading operators. Its mitigations: hiding the tests cut cheating to near zero but also cost performance; read-only access to the tests is a middle ground that prevents test modification; and giving the agent an explicit way to flag a conflict for a human significantly reduced cheating. SpecBench (2026) compares visible tests with held-out ones on long-horizon builds and finds the gap growing by about 28 percentage points for every tenfold increase in code size.
- **Judge bias in software engineering - MODERATE (vision paper with a literature review, not a measurement).** "LLM-as-a-Judge for Software Engineering" (arXiv 2510.24367; the paper itself lists limited empirical findings on judge bias in software engineering as a limitation) documents self-bias, position, verbosity and egocentric bias, and also reports strong agreement with humans on some tasks (for example 0.81 Pearson on code translation). It does not establish that judges frequently misjudge code correctness, and family-level bias is not established there; treat "use a different model family" as a reasonable inference.
- **Multi-agent failure taxonomy - STRONG.** The MAST taxonomy ("Why Do Multi-Agent LLM Systems Fail?") names failures including disobeying the task or role specification, step repetition, loss of history, unawareness of termination conditions, failure to ask for clarification, information withholding, ignoring other agents' input, reasoning-action mismatch, and no/incomplete/incorrect verification - and reports that prompt- and role-level fixes gave only limited gains, arguing for structural redesign (NeurIPS 2025). Its first category is now "system design issues", which includes poor or ambiguous specifications.
- **Debate conformity - STRONG.** "Talk Isn't Always Cheap" (ICML 2025 multi-agent workshop) found debate flipping correct answers to wrong more often than the reverse, peer pressure overriding correct isolated agents, and correctness-encouraging prompts sometimes backfiring. "Voting or Consensus?" (ACL 2025 Findings) found more discussion rounds before voting could reduce performance. Sycophancy-propagation work finds agreement amplifying across agents.
- **Generated-UI accessibility - STRONG (peer-reviewed).** "Generated Inaccessible" (W4A 2026): 29.0% compliance on five WCAG success criteria across six AI UI design tools; naming the requirements in the prompt lowered it. Full citation: `frontend-developer`.
- **Vision-model reads as measurements:** the evidence and its grades live with the rule, in `visual-craft`.

## Review packet template (what an author hands a reviewer)

```
Task & criteria:   <the written acceptance criteria, verbatim, each marked blocking | reported>
Result:            <artifact paths / diff / output>
Evidence per criterion:
  1. <criterion> -> <test run / tool output / quote / capture>
Checks changed in this work: <tests or checks added, edited, removed - with reason>
Criteria changed after results were known: <dated: old bar -> new bar, why; result reported against both>
Neighbours checked: <what a fix could have worsened, and the before/after on it>
Skipped checks: <listed separately, never counted as passes>
Not verified:      <what wasn't checked, and why>
Sources:           <claim ledger, if outside facts are involved>
Known risks:       <what the author is least sure of>
```

A reviewer receiving work without this packet hands it back.

## Verdict format (what a reviewer returns)

```
Verdict: PASS | NEEDS CHANGES | ABSTAIN (reason)
Per criterion:
  1. <criterion> - MET | FAILED - evidence: <quote or precise absence>
Failures:
  - <criterion> - <what is wrong, one sentence> - <where>
Not checked: <what the reviewer could not verify>
Facts checked: <n>
```

Rules for the verdict: FAILED always carries quotable evidence; a PASS carries an explicit empty failure list, never a placeholder; ABSTAIN is used when the input was unreadable or the packet was missing - it neither passes nor blocks by itself, and it is reported, not hidden.

## Debate structure checklist

- [ ] Independent proposals/verdicts collected before any participant sees another's
- [ ] Prior verdicts anonymized and framed as claims, not instructions
- [ ] Hard round cap; each round re-anchored on the original request and criteria
- [ ] Concur/dissent requires quoted evidence
- [ ] Every objection ends with a recorded disposition
- [ ] Participant independence declared (model family / provider), dropped participants reported
- [ ] A bounded, single re-open mechanism if settled decisions can be challenged
- [ ] Final report separates "participants agreed" from "result verified"

## Lineup check (for taste-shaped questions)

Mix the candidate, unlabeled, into a small set of examples already judged good and bad. Ask the judge to rank all of them. If the candidate can't be distinguished from the good examples, that is evidence; if the judge ranks a known-bad example above a known-good one, the judge is unreliable for this question - downgrade it to drift detection only.
