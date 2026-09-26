# Evidence behind the rules, and templates

## The evidence, graded

Findings below are each source's result about its own setup - never a claim about any particular skill or system built from them.

- **Self-correction limits - STRONG.** "Large Language Models Cannot Self-Correct Reasoning Yet" (ICLR 2024) and "When Can LLMs Actually Correct Their Own Mistakes?" (TACL 2024) find that without external feedback, self-review struggles and at times degrades accuracy; external signals are what make correction work.
- **False success - MODERATE (single workshop paper, 2026).** "From Confident Closing to Silent Failure: Characterizing False Success in LLM Agents" (ICML 2026 workshop) found false success - the agent claims completion, the environment disagrees - to be a large share of agent failures on tau2-bench and AppWorld, and LLM judges performing poorly at detecting it while leaning on confident closing language.
- **Reward hacking against tests - STRONG (benchmarked).** ImpossibleBench (2025) makes tasks impossible so any pass means cheating, and catalogues agents editing tests, special-casing inputs and overloading operators. SpecBench (2026) compares visible tests with held-out ones on long-horizon builds and finds the gap growing with code size.
- **Judge bias in software engineering - STRONG (survey).** "LLM-as-a-Judge for Software Engineering" (literature review, ACM TOSEM 2026) documents self-bias, position bias, and judges that frequently misjudge code correctness. Family-level bias is not established there; treat "use a different model family" as a reasonable inference.
- **Multi-agent failure taxonomy - STRONG.** The MAST taxonomy ("Why Do Multi-Agent LLM Systems Fail?") names failures including disobeying the task or role specification, step repetition, loss of history, unawareness of termination conditions, failure to ask for clarification, information withholding, ignoring other agents' input, reasoning-action mismatch, and no/incomplete/incorrect verification - and reports that prompt- and role-level fixes gave only limited gains, arguing for structural redesign (NeurIPS 2025 Datasets and Benchmarks).
- **Debate conformity - STRONG.** "Talk Isn't Always Cheap" (2025 preprint) found debate flipping correct answers to wrong more often than the reverse, peer pressure overriding correct isolated agents, and correctness-encouraging prompts sometimes backfiring. "Voting or Consensus?" (ACL 2025) found more discussion rounds before voting could reduce performance. Sycophancy-propagation work finds agreement amplifying across agents.
- **Visual sycophancy and temporal blindness - MODERATE-STRONG.** Vision-language models anchor on plausible textual framing over their own perception when framed as evaluation, give unstable quality judgments across repeated queries, and on several video benchmarks retain most of their accuracy when frames are shuffled - evidence they rely little on temporal order. The evidence covers measurable drift and image quality, not artistic taste.
- **Generated-UI accessibility - STRONG (peer-reviewed).** "Generated Inaccessible" (W4A 2026) found about 29% WCAG compliance across AI UI design tools, and that naming accessibility requirements in the prompt decreased compliance - intent is not a control.

## Review packet template (what an author hands a reviewer)

```
Task & criteria:   <the written acceptance criteria, verbatim>
Result:            <artifact paths / diff / output>
Evidence per criterion:
  1. <criterion> -> <test run / tool output / quote / capture>
Checks changed in this work: <tests or checks added, edited, removed - with reason>
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
