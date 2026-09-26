---
name: task-scoping
description: Turns a request into bounded, checkable work before acting - acceptance criteria and a stop condition first, only the clarifying questions that change the outcome, written non-goals, risky steps flagged up front, work ordered by risk, effort sized to the task, and a review checkpoint after anything is reported done. Use at the start of any multi-step or ambiguous task, before delegating, when a new idea arrives mid-task, when scope feels fuzzy, and when something is reported finished. Not for sourcing facts (research-and-sourcing), proving correctness (verification-and-critique), handoffs (context-and-handoff) or tool safety (tool-and-action-discipline).
license: MIT
---

# Task Scoping

Before the first action that changes anything, turn the request into work that has a definition of done. Most agent failures that look like execution failures started here: a constraint dropped between reading and doing, a stop condition nobody wrote, an assumption taken silently, a risky step discovered only when reached. The MAST taxonomy of multi-agent failures ("Why Do Multi-Agent LLM Systems Fail?", 2025) files "disobeying the task specification" and "unawareness of termination conditions" under specification failures - and found prompt-level fixes alone insufficient.

**This skill owns:** what the work is, what it is not, when it is done, what order it happens in, and whether the finished thing is actually finished.

## 1. Explore, then plan, then act

- **Read the real current state before writing the plan - not a summary of it.** A plan built on a remembered or previously-summarized description of a file, an API, or a system will assume things that are false: which fields have setters, whether an event already has listeners, what a component's own documentation says about its constraints. Re-reading every touched file before planning caught real gaps every time it was done on one long-running project; a plan referencing more than a couple of files earns the pass. If the harness has a read-only planning mode (Claude Code's plan mode, for example), use it for multi-file or risky work: exploration cannot change anything, and the plan is approved before the first edit.
- **Start with the simplest structure that could work.** A single call, then a fixed pipeline, then an open-ended loop - add autonomy only when the simpler shape demonstrably falls short. A fixed localize-repair-validate pipeline (Agentless, 2024) outscored every open-source agent on SWE-bench Lite at the time, at well under a dollar per issue. Benchmarks move; the lesson - agentic complexity is not automatically where results come from - has not.
- **A pipeline built before a use case is a solution shopping for a problem.** Decide whether the thing should exist before designing how.

## 2. Write the spec - short enough to re-read in a minute

1. **Goal** - the question this work answers, in one sentence.
2. **Acceptance criteria** - each answerable yes or no by inspecting the result. "Is well written" is not checkable; "names the version it was written against" is. Never ask "could this be better?" - that question has no false answer, so every pass adds scope. Ask whether each written criterion is met.
3. **Explicit non-goals** - what is deliberately not being done. This list matters as much as the scope list; writing it down stops it being relitigated.
4. **Stop condition** - what "done" means, plus a hard cap on rounds, retries, time, or spend. An agent with no written stop condition either stops too early or never stops.
5. **Risky steps, flagged now** - anything irreversible, destructive, externally visible, or costly is named in the plan before execution starts, with where a human confirmation gate sits. Discovering a risky step when you reach it is how it gets taken without one.

Scope is 3-5 concrete items. More than five means cut, not accept - sort Must/Should/Could/Won't, and put Won't in writing rather than silently dropping it.

## 3. Ask only the questions that change the outcome

- **Ask only when two reasonable readings lead to different deliverables.** Never ask what the request already answers, or what the plan can decide itself with a stated assumption.
- **Every question carries the default you would otherwise take**, stated as a decision. If nobody answers, the default applies and the result says so under "Assumptions."
- **When blocked on a decision that is genuinely the requester's**, stop and ask - don't guess past it. When not blocked, proceed on the stated default rather than stalling.

## 4. Order and size the work

- **Order by risk and dependency, not ease.** The unproven thing first; safe polish last. A plan that front-loads comfortable work discovers its real problem late.
- **Prove the cheapest end-to-end path first.** Push one trivial instance through the real pipeline before investing in volume - convention mismatches fail by looking broken, not by erroring.
- **Build one, verify it, then duplicate.** Redoing one is cheap; redoing twelve is not.
- **Size effort to the task, explicitly.** Name how many steps, tool calls, or parallel agents the task deserves. One published research orchestrator spawned dozens of subagents for simple queries until effort tiers were written into its prompt, and its multi-agent runs used roughly 15x the tokens of a chat (Anthropic, 2025). Use more agents where work is genuinely parallel or independence genuinely matters. Where the model exposes an effort or thinking-budget setting, pick it for the task rather than leaving the maximum on.
- **Spec now, build later is a real state** when a dependency would otherwise force doing the same work twice. Say what it is waiting on.
- **Separate settled from open.** Research answers "how does this work"; "whether" and "what for" are owner decisions. Never close an open decision by guessing and presenting the guess as a finding.

## 5. Scope discipline during execution

- **Unrequested additions are a defect, not initiative.** Fix what the criteria require; record anything else as a suggestion.
- **A new idea mid-task is not a task.** Check it against the current goal; if it doesn't serve it, write it down and continue.
- **Name which kind of change you're making:** a continuation of an existing decision, or a reversal of one. A reversal gets written down next to the rule it reverses, with its cost - a reversal that isn't recorded gets silently re-reversed later.
- **Record deliberate overrides with their reasoning, in the same pass.** An override without its reasoning on record is indistinguishable from an accident.

## 6. The review checkpoint - after anything is reported finished

- Does the result still match the spec, or did scope expand quietly? Did a written non-goal sneak back in?
- **Is each criterion actually met, or "mostly working"?** Name the difference.
- **A partial answer states plainly what it does not close.** A narrowly-scoped pass left to stand in for the whole named problem reads as false completeness to anyone skimming the status.
- **The same class of mistake a second time earns a mechanical guard** (a test, a lint rule, a scripted check), not a note to try harder - a boolean check can't be talked past the way a remembered rule can.
- **A review that always comes back clean is a signal to question the review,** not reassurance. A "needs changes" verdict is the healthy outcome of a real review.
- **A review finding is a claim about the current state, and claims rot.** Gate, fold amendments in, re-verify every amendment against the real state, re-gate if anything moved. On one plan, an independent re-check found three of a review's own accepted amendments already stale.

## Honesty mandate

Give real assessments, not encouragement. If the plan is weaker than an alternative you can see, say so before executing, with the trade-off - one honest alternative beats three polite variations of the ask. Hold a recommendation under mild pushback if the reasoning stands; fold immediately on an actual decision and record it. Never manufacture a concern to look thorough: where something is fine, say "fine - no action."

## Mistakes to flag

- Acting before acceptance criteria and a stop condition exist.
- Criteria that can't be answered yes or no.
- A clarifying question with no stated default, or a silent assumption with no "Assumptions" line.
- A risky or irreversible step not named until it was reached.
- Easiest-first ordering that defers the unproven part.
- Volume built before one instance passed end to end.
- Scope over five items accepted rather than cut; non-goals not written down.
- An open owner decision closed by a guess dressed as a finding.
- A reversal of a standing decision adopted silently.
- A partial result reported without naming what it doesn't close.
- A recurring mistake answered with a reminder instead of a guard.
- Time estimates with no measured base rate behind them - name dependencies and uncertainty instead.

Spec template, estimation techniques, and the scope-gate questions in full: `references/scoping-toolkit.md`.
