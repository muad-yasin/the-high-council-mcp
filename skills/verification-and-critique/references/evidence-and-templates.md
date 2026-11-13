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
- **When a finding blocks, and labelled comments - WORKING PRACTICE, not measured.** Google's public engineering-practices guide for code reviewers (the page "The Standard of Code Review", read up to its section "Mentoring", and the section "Label comment severity" of "How to write code review comments"; both read 2026-11-12) says a reviewer should in general favour approving a change once it clearly leaves the code better than it was, even when it is not perfect, and suggests marking minor and optional comments as such, since an author may otherwise take each one as required. This is one company's stated practice for human review, and the parts read cite no study; the rules on what makes a finding block draw on it.

## Review packet template (what an author hands a reviewer)

```
Task & criteria:   <the written acceptance criteria, verbatim, each marked blocking | reported>
Result:            <artifact paths / diff / output>
Ran on:            <the commit / build / input set the evidence belongs to>
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

A reviewer receiving work without this packet hands it back. The author's own verdict, and the argument for it, stay out of the packet until the reviewer has committed one.

## Verdict format (what a reviewer returns)

```
Verdict: PASS | NEEDS CHANGES | ABSTAIN (reason)
Ran on: <the commit / build / input set the reviewer checked>
Per criterion:
  1. <criterion> (blocking | reported) - MET | FAILED | UNCHECKED - evidence: <quote or precise absence>
Failures:
  - <blocking criterion missed, or what got worse> - <what is wrong, one sentence> - <where> - <the input or condition that shows it>
Needs validation (argued, not demonstrated; not a failure yet): <finding - what would demonstrate it>
Advisory (does not hold the verdict): <preferences and points of polish, one list>
Standards (apart from the criteria): <where the work departs from a written standard>
Coverage: <each part of the scope: covered | out of scope | deferred, with the reason>
Not checked: <what the reviewer could not verify>
Facts checked: <n>
```

Rules for the verdict: FAILED always carries quotable evidence; a PASS carries an explicit empty failure list, never a placeholder; ABSTAIN is used when the input was unreadable or the packet was missing - it neither passes nor blocks by itself, and it is reported, not hidden. UNCHECKED marks a criterion with no check the work could have failed; a blocking criterion left UNCHECKED keeps the verdict from PASS.

Rules for the failures: the list holds demonstrated misses of blocking criteria and demonstrated regressions (something made worse than it was), and demonstrated means a failing input, a quoted line, a measured value or a precisely named absence. Any entry makes the verdict NEEDS CHANGES. A missed reported criterion is disclosed on its criterion line and does not turn the verdict. A finding that is argued but not demonstrated goes under "Needs validation": it is not a failure and does not turn the verdict by itself. Advisory points go on their one list, which the final review reads, so they neither block nor get lost. What a formatter or a linter can enforce is left to it. "Does what was asked" and "is well made" are two verdicts: tidy work does not offset a missed criterion.

## Answering a finding (the receiving side)

```
Finding:      <as the reviewer wrote it>
Checked by:   <how it was reproduced against the artifact, or why it could not be>
Disposition:  FIXED (<where>; <the evidence the fix holds>)
            | DECLINED (<the evidence it does not hold>)
            | ACCEPTED TRADE-OFF (<what is given up>; <who accepted it>)
            | CRITERION UNCLEAR (<the criterion as repaired>)
```

An unclear criterion is repaired before the work is. A trade-off accepted on a blocking criterion is the owner's decision, recorded as the criteria-tier rule asks. Every finding gets one of the four; none is dropped without one.

## What proves what

| Claim | Proved by | Not proved by |
|---|---|---|
| "The tests pass" | this run's output on this tree: how many ran, none failed, the skips listed | an earlier run; a run on another tree; "they should pass" |
| "The bug is fixed" | the input that showed it now gives the right result, and its neighbours still do | the code was changed; the suite is green |
| "The criteria are met" | a verdict for each criterion, each with its evidence | the suite is green |
| "Nothing was found" | the same gate catching a planted positive, and the list of what it did not scan | an empty result |
| "It works" | one run through the real entry point with real inputs | unit tests alone; mocks; a hand-built record |
| "The delegate finished" | its changes, read in the artifact | its own summary |
| "The build is good" | the artifact built from this tree, then exercised | a success line in the log |

## Debate structure checklist

- [ ] Independent proposals/verdicts collected before any participant sees another's
- [ ] Prior verdicts anonymized and framed as claims, not instructions
- [ ] Blind answers kept; a result that departs from them names the evidence that moved it
- [ ] One captured copy of the input for every reviewer; one that did not run listed as skipped, never as agreeing
- [ ] Hard round cap; each round re-anchored on the original request and criteria
- [ ] A stop on a stall (a round of repeated objections), not only on the cap
- [ ] Concur/dissent requires quoted evidence
- [ ] Every objection ends with a recorded disposition
- [ ] Participant independence declared (model family / provider), dropped participants reported
- [ ] A bounded, single re-open mechanism if settled decisions can be challenged
- [ ] Final report separates "participants agreed" from "result verified"

## Lineup check (for taste-shaped questions)

Mix the candidate, unlabeled, into a small set of examples already judged good and bad. Ask the judge to rank all of them. If the candidate can't be distinguished from the good examples, that is evidence; if the judge ranks a known-bad example above a known-good one, the judge is unreliable for this question - downgrade it to drift detection only.
