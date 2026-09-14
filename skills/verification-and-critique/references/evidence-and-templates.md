# Evidence behind the rules, and templates

## The evidence, graded

Findings below are each source's result about its own setup - never a claim about any particular skill or system built from them.

- **Self-correction limits - STRONG.** Work on intrinsic self-correction ("Large Language Models Cannot Self-Correct Reasoning Yet"; a TACL survey on when models can correct their own mistakes; self-verification limits on reasoning and planning) finds that without external feedback, self-review can leave accuracy unchanged or degrade it; external signals are what make correction work.
- **False success - STRONG (2026).** Research characterizing "confident closing to silent failure" documents agents asserting completion while environment state disagrees, and LLM judges misled by confident closing language.
- **Reward hacking against tests - STRONG (benchmarked).** ImpossibleBench, SpecBench, and related third-party benchmarks catalogue coding agents editing assertions, special-casing inputs, keeping hidden state, and rationalizing shortcuts on tasks where the grader is exploitable.
- **Judge bias in software engineering - STRONG (survey).** An LLM-as-a-judge literature review for SE documents self-preference, family-level preference bias, run-to-run inconsistency, prompt sensitivity, and weak correlation with functional correctness.
- **Multi-agent failure taxonomy - STRONG.** The MAST taxonomy ("Why Do Multi-Agent LLM Systems Fail?") names failures including disobeying the task or role specification, step repetition, loss of history, unawareness of termination conditions, failure to ask for clarification, information withholding, ignoring other agents' input, reasoning-action mismatch, and no/incomplete/incorrect verification - and finds structural fixes stronger than prompt tweaks.
- **Debate conformity - STRONG.** "Talk Isn't Always Cheap" found debate flipping correct answers to wrong more often than the reverse, peer pressure overriding correct isolated agents, and correctness-encouraging prompts sometimes backfiring. "Voting or Consensus?" (ACL 2025) found more discussion rounds before voting could reduce performance. Sycophancy-propagation work finds agreement amplifying across agents.
- **Visual sycophancy and temporal blindness - MODERATE-STRONG.** Vision-language models anchor on plausible textual framing over their own perception when framed as evaluation, give unstable quality judgments across repeated queries, and have scored near-identically on shuffled versus ordered frames. The evidence covers measurable drift and image quality, not artistic taste.
- **Generated-UI accessibility - STRONG (peer-reviewed).** A 2025 study of AI-generated interfaces found low WCAG compliance overall, and that explicitly requesting accessibility decreased compliance - intent is not a control.

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
