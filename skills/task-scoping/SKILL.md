---
name: task-scoping
description: Turns a request into bounded, checkable work before acting - acceptance criteria and a stop condition first, only the questions that change the outcome, written non-goals, risky steps flagged up front, work ordered by risk, effort sized to the task, a substitute for what was asked put back to the requester, and a review checkpoint after work is reported done. Use at the start of any multi-step or ambiguous task, before delegating or an unattended run, when a new idea arrives mid-task, when scope feels fuzzy, and when something is reported finished. Not for sourcing facts (research-and-sourcing), proving correctness (verification-and-critique), handoffs (context-and-handoff) or tool safety (tool-and-action-discipline).
license: MIT
---

# Task Scoping

Before the first action that changes anything, turn the request into work that has a definition of done. Most agent failures that look like execution failures started here: a constraint dropped between reading and doing, a stop condition nobody wrote, an assumption taken silently, a risky step discovered only when reached. The MAST taxonomy of multi-agent failures ("Why Do Multi-Agent LLM Systems Fail?", 2025) files "disobeying the task specification" and "unawareness of termination conditions" under system-design issues, its first category, which covers poor or ambiguous specifications - and found prompt-level fixes gave only limited gains.

**This skill owns:** what the work is, what it is not, when it is done, what order it happens in, and whether the finished thing is actually finished.

## 1. Explore, then plan, then act

- **Read the real current state before writing the plan - not a summary of it.** A plan built on a remembered or previously-summarized description of a file, an API, or a system will assume things that are false: which fields have setters, whether an event already has listeners, what a component's own documentation says about its constraints. Re-reading every touched file before planning caught real gaps every time it was done on one long-running project; a plan referencing more than a couple of files earns the pass. If the harness has a read-only planning mode (Claude Code's plan mode, for example), use it for multi-file or risky work: exploration cannot change anything, and the plan is approved before the first edit.
- **Start with the simplest structure that could work, and decide whether the thing should exist before designing how.** A single call, then a fixed pipeline, then an open-ended loop - add autonomy only when the simpler shape demonstrably falls short. A fixed localize-repair-validate pipeline (Agentless, 2024) outscored every open-source agent on SWE-bench Lite at the time, at well under a dollar per issue. Benchmarks move; the lesson - agentic complexity is not automatically where results come from - has not.

## 2. Write the spec - short enough to re-read in a minute

1. **Goal** - the question this work answers, in one sentence.
2. **Acceptance criteria** - each answerable yes or no by inspecting the result. "Is well written" is not checkable; "names the version it was written against" is. Never ask "could this be better?" - that question has no false answer, so every pass adds scope. Ask whether each written criterion is met. List every part of the request that could be left out without the rest failing: each becomes a criterion or a written non-goal - what is on neither list is what gets dropped unnoticed.
3. **Explicit non-goals** - what is deliberately not being done. This list matters as much as the scope list; writing it down stops it being relitigated. Where it can be, a non-goal is a fence that can be checked: "no file outside X is touched", "no new dependency".
4. **Stop condition** - what "done" means, plus a hard cap on rounds, retries, time, or spend. An agent with no written stop condition either stops too early or never stops. "Done" names an end state that can be observed, not an activity - "investigate the cache" never ends (what it must name, by kind of task: `references/scoping-toolkit.md`). Inside the cap, a repeat of a failed round changes something - the brief, the worker, or the approach - because an unchanged attempt has no reason to end differently.
5. **Risky steps, flagged now** - anything irreversible, destructive, externally visible, or costly is named in the plan before execution starts, with where a human confirmation gate sits. Discovering a risky step when you reach it is how it gets taken without one.

In a plan of several steps, every step also ends on something that can be checked, or nobody can say it was finished rather than skipped. Before asking for approval, read the spec as the one who has to build from it - a fresh reader is better - and list what that builder would still have to ask; answer each in the spec, or ask it.

As a working heuristic, not a measured limit: scope is 3-5 concrete items. More than five is a prompt to cut rather than accept - sort Must/Should/Could/Won't, and put Won't in writing rather than silently dropping it.

## 3. Ask only the questions that change the outcome

- **Ask only when two reasonable readings lead to different deliverables.** Never ask what the request already answers, what the requester has already decided in writing, what the environment can answer (read the file, run the command), or what the plan can decide itself with a stated assumption.
- **Every question carries the default you would otherwise take**, stated as a decision. If nobody answers, the default applies and the result says so under "Assumptions." A default you took is recorded as your call, not as the requester's agreement; and an answer approves the option as it was worded - what the wording left out is still open.
- **A choice states what each option gives the requester.** The effort each one takes goes on its own line, for the requester to weigh; folded into the descriptions, convenience picks unseen.
- **Ask what can be asked now in one round, and write each answer into the spec** in the same pass: it becomes a criterion, joins the non-goals, or stands as a named assumption. A question whose wording depends on an earlier answer waits for it; an answer that lives only in the conversation is gone at the next summary.
- **When blocked on a decision that is genuinely the requester's**, stop and ask - don't guess past it. When not blocked, proceed on the stated default rather than stalling. A question blocks only what depends on its answer: the rest goes on, and what does wait is named to the requester with its reason. (Seen: a whole batch waited overnight on the approval of its first item, while the requester expected the rest to be under way.)
- **Check the question's premise before answering it.** When the evidence contradicts what the question assumes - "where is the missing data?" asked when most of the failures had all their data - say so first, then answer the question that remains.

## 4. Order and size the work

- **Order by risk and dependency, not ease.** The unproven thing first; safe polish last. A plan that front-loads comfortable work discovers its real problem late.
- **Prove the cheapest end-to-end path first.** Push one trivial instance through the real pipeline before investing in volume - convention mismatches fail by looking broken, not by erroring.
- **Build one, verify it, then duplicate.** Redoing one is cheap; redoing twelve is not. Verifying the one includes its cost: measure it against a control on size, memory and time before duplicating - a blow-up multiplies with the volume (one generated mesh type came out 12x the size of its control, and was found only after the full run).
- **Size effort to the task, explicitly.** Name how many steps, tool calls, or parallel agents the task deserves. One published research orchestrator spawned dozens of subagents for simple queries until effort tiers were written into its prompt, and its multi-agent runs used roughly 15x the tokens of a chat (Anthropic, 2025). Use more agents where work is genuinely parallel or independence genuinely matters. Where the model exposes an effort or thinking-budget setting, pick it for the task rather than leaving the maximum on. Scoping is sized too: for a single lookup or a change of one line, the spec is one line of goal and one line of check - a full spec for a trivial task is scope creep of its own.
- **Before a run goes unattended, five answers are written:** the end state, the check the run applies to itself, its fence, what ends it early, and who receives the result and signs it off (`references/scoping-toolkit.md`).
- **Spec now, build later is a real state** when a dependency would otherwise force doing the same work twice. Say what it is waiting on.
- **Separate settled from open.** Research answers "how does this work"; "whether" and "what for" are owner decisions. Never close an open decision by guessing and presenting the guess as a finding.

## 5. Scope discipline during execution

- **Unrequested additions are a defect, not initiative.** Fix what the criteria require; record anything else as a suggestion.
- **A new idea mid-task is not a task.** Check it against the current goal; if it doesn't serve it, write it down and continue.
- **The requester's words are the spec; a substitute is their decision.** When the plan would deliver something other than what was literally asked - a cheaper mechanism, a proxy, a different shape - put it to the requester as a choice before building: their words, your substitute, the trade-off. Writing the substitution into a plan or design document is not approval; nobody re-reads a design to find out their request changed. Keep the request verbatim at the top of the spec and check the result against those words at the review checkpoint. (Seen: a request for one physical shape was quietly turned into a different mechanism in the design, recorded there, and discovered only when the requester saw the result.)
- **Name which kind of change you're making:** a continuation of an existing decision, or a reversal of one. A reversal gets written down next to the rule it reverses, with its cost - a reversal that isn't recorded gets silently re-reversed later.
- **Record deliberate overrides with their reasoning, in the same pass.** An override without its reasoning on record is indistinguishable from an accident.

## 6. The review checkpoint - after anything is reported finished

- Does the result still match the spec, or did scope expand quietly? Did a written non-goal sneak back in?
- **Is each criterion actually met, or "mostly working"?** Name the difference.
- **A criterion dropped along the way counts as not met unless the requester took it out.** It is reported with its reason and who decided, never left out of the report (a criterion changed after the results: `verification-and-critique`).
- **A partial answer states plainly what it does not close.** A narrowly-scoped pass left to stand in for the whole named problem reads as false completeness to anyone skimming the status.
- **The same class of mistake a second time earns a mechanical guard** (a test, a lint rule, a scripted check), not a note to try harder - a boolean check can't be talked past the way a remembered rule can.
- **A review that always passes is suspect** (`verification-and-critique`).
- **A review finding is a claim about the current state, and claims rot.** Gate, fold amendments in, re-verify every amendment against the real state, re-gate if anything moved. On one plan, an independent re-check found three of a review's own accepted amendments already stale.

## Honesty mandate

Give real assessments, not encouragement. If the plan is weaker than an alternative you can see, say so before executing, with the trade-off - one honest alternative beats three polite variations of the ask. Hold a recommendation under mild pushback if the reasoning stands; fold immediately on an actual decision and record it. Never manufacture a concern to look thorough: where something is fine, say "fine - no action."

## Mistakes to flag

- Acting before acceptance criteria and a stop condition exist; a stop condition that names an activity; a failed round repeated unchanged.
- Criteria that can't be answered yes or no.
- A clarifying question with no stated default, or a silent assumption with no "Assumptions" line.
- A question the environment or the requester's own notes could have answered; a choice with effort folded into its options instead of shown on its own line.
- A default recorded as the requester's decision; an answer stretched past the wording it approved.
- Work that did not depend on a pending answer left waiting for it.
- A risky or irreversible step not named until it was reached.
- Easiest-first ordering that defers the unproven part.
- Volume built before one instance passed end to end.
- Scope well over five items accepted rather than cut; non-goals not written down.
- An open owner decision closed by a guess dressed as a finding.
- A reversal of a standing decision adopted silently.
- A requested deliverable replaced by a substitute that was recorded but never put to the requester.
- A question answered without checking whether its premise holds.
- A partial result reported without naming what it doesn't close; a dropped criterion missing from the report.
- An unattended run started without its stop and its sign-off written.
- A recurring mistake answered with a reminder instead of a guard.
- Time estimates with no measured base rate behind them - name dependencies and uncertainty instead.

Spec template, what "done" names by kind of task, the unattended-run questions, estimation techniques, and the scope-gate questions in full: `references/scoping-toolkit.md`.
