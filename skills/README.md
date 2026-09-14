# The High Council skills

*A small, curated set of Claude Code skills shipped alongside The High Council. MIT, free, no
account, no keys. Last updated 2026-09-14.*

You can build almost anything in a weekend now. So can everyone else. The difference is no longer
whether it gets built - it is whether the right thing got built, and whether it actually works.
These skills are written for that part: the thinking before the code, and the checking after it.

**No efficacy claim is made here.** Nothing in these files has been measured against working
without them. Each rule says what it guards against and why - usually a real failure that
happened on a real project, generalized - so you can judge it yourself.

## What a skill is

A skill is a folder with a `SKILL.md`: a short set of rules an AI coding agent loads when a task
matches its description, plus an optional `references/` folder for depth it opens only when
needed. The rules are deliberately concrete - named failure modes, checklists, and a "mistakes to
flag" list - rather than general advice.

## The skills

### Core agentic work - any task, any domain

| Skill | Use it when | What it guards against |
|---|---|---|
| [`task-scoping`](task-scoping/SKILL.md) | Starting any multi-step or ambiguous task, delegating, or checking whether something is really done | Acting before "done" is defined; silent assumptions; risky steps found too late; easiest-first ordering; partial results reported as complete |
| [`research-and-sourcing`](research-and-sourcing/SKILL.md) | Any claim about the outside world: APIs, versions, prices, research, real people and companies | Summaries mistaken for sources; syndicated copies counted twice; inferences hardening into facts; numbers stripped of their setup; invented statistics |
| [`verification-and-critique`](verification-and-critique/SKILL.md) | Before reporting done, when reviewing any output, when designing a review, vote, or debate | Self-review mistaken for proof; tests edited to pass; unreadable results counted as passes; reviewers who rewrite; debate that flips correct answers through conformity |
| [`context-and-handoff`](context-and-handoff/SKILL.md) | Long or multi-session work, delegation, pausing and resuming, several agents in one workspace | Context rot; state that exists only in the conversation; vague briefs; handoffs that hide what failed; guessing instead of pausing; a peer's word treated as the owner's approval |
| [`tool-and-action-discipline`](tool-and-action-discipline/SKILL.md) | Any action that changes state, spends money, or is visible to others; designing a tool | Destructive commands aimed at patterns; spend checked after the fact; retries as a fix for wrong answers; faked human gates; instructions smuggled in through tool output |

### Building software

| Skill | Use it when | What it guards against |
|---|---|---|
| [`backend-developer`](backend-developer/SKILL.md) | Server logic, CLIs, data models, storage and migration, jobs, integrations, generators, scripts | Silent fallbacks; events fired before state is committed; invented numbers; filters that silently return nothing; "it ran successfully" with no artifact checked |
| [`frontend-developer`](frontend-developer/SKILL.md) | Anything that renders or reacts to input: web, mobile, desktop, game UI, terminal, CLI output | Happy-path-only screens; text overflowing fixed boxes; layouts that only work at one screen size; locale bugs; mockups reproduced by eye instead of by value |
| [`ux-design`](ux-design/SKILL.md) | Before building any user-facing surface, even "just add a button" | Visuals before flow; missing states; notifications louder than they deserve; dark patterns; onboarding by lock-out tutorial |
| [`visual-craft`](visual-craft/SKILL.md) | Once flow and implementation are right and the question is "does this look right" | Unanchored styles; generic defaults chosen by accident; color judged by eye; a single screenshot trusted as proof; vision models used as taste authorities |

### Writing

| Skill | Use it when | What it guards against |
|---|---|---|
| [`good-news-writing`](good-news-writing/SKILL.md) | Warm, positive coverage of a real person or organization doing something good | Press-release tone; invented villains; backhanded praise; untraceable quotes; overstated good deeds |

## How the skills fit together

- **Scope, then build, then verify.** `task-scoping` decides what the work is; the building skills
  do it; `verification-and-critique` proves it. `research-and-sourcing` feeds any of them with facts.
- **Design before implementation.** `ux-design` hands a flow, wireframe, and states list to
  `frontend-developer`; `visual-craft` judges the built result.
- **Every skill says what it is not for**, and points at the skill that is. Overlap is kept small on
  purpose - one rule lives in one place.

## Install

Copy the folders you want into your project's `.claude/skills/` directory, or point Claude Code at
this repository's `skills/` directory. Each skill loads only when a task matches its description,
so installing all of them costs little. They work on their own; none requires The High Council
harness, an MCP server, or an API key.

## How these are written

- **Keep the scar, drop the coordinates.** Each rule keeps the failure that produced it and the
  reasoning behind it; project names, file paths, and tool trivia are removed.
- **Structure over exhortation.** A checklist, a gate, a separate reviewer, or a hard cap beats
  "be careful." Where a mistake happened twice, the rule asks for a mechanical guard.
- **Evidence is graded.** Where a rule rests on published research, the finding is paraphrased
  with its source named and its strength stated; where it rests on practitioner reports or
  inference, it says so.
- **Rules get deleted when they stop being true.** Many rules encode something models currently do
  badly. When that changes, the rule goes.

## Updates

The skills are versioned with this repository. Changes are listed in the repository's
`CHANGELOG.md`. A presentation page for sharing lives at `docs/skills.html`; both it and this
catalog are checked by the test suite against the actual `skills/` folder, so neither can list a
skill that doesn't exist or miss one that does.

To propose a change, open an issue or pull request. A good proposal names the failure it prevents,
where that failure was seen, and what the rule should say - not just that a rule would be nice.
