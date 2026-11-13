# The High Council skills

*A small, curated set of Claude Code skills shipped alongside The High Council. MIT, free, no
account, no keys. Last updated 2026-11-13.*

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
flag" list - rather than general advice, and they skip what current models already do well.

The folders follow the open [Agent Skills](https://agentskills.io) format (`name` and
`description` frontmatter, progressive disclosure), so other agent tools that read `SKILL.md`
folders can load them too. They are written for Claude Code, and they mention its features (plan
mode, hooks, compaction, subagents) only as examples of a general mechanism.

## The skills

### Core agentic work - any task, any domain

| Skill | Use it when | What it guards against |
|---|---|---|
| [`task-scoping`](task-scoping/SKILL.md) | Starting any multi-step or ambiguous task, delegating, starting an unattended run, or checking whether something is really done | Acting before "done" is defined; silent assumptions; a default passed off as the requester's decision; risky steps found too late; easiest-first ordering; partial results reported as complete |
| [`research-and-sourcing`](research-and-sourcing/SKILL.md) | Any claim about the outside world: APIs, versions, prices, research, real people and companies | Summaries mistaken for sources; syndicated copies counted twice; inferences hardening into facts; numbers stripped of their setup; invented statistics |
| [`verification-and-critique`](verification-and-critique/SKILL.md) | Before reporting done, when reviewing any output, when answering a review's findings, when designing a review, vote, or debate | Self-review mistaken for proof; tests edited to pass; unreadable results counted as passes; an empty result read as clean; reviewers who rewrite; findings that block without being demonstrated; debate that flips correct answers through conformity |
| [`context-and-handoff`](context-and-handoff/SKILL.md) | Long or multi-session work, delegation, pausing and resuming, writing or relying on an instruction file, several agents in one workspace | Context rot; state that exists only in the conversation; a stale document followed against the code; vague briefs; handoffs that hide what failed; guessing instead of pausing; a peer's word treated as the owner's approval |
| [`tool-and-action-discipline`](tool-and-action-discipline/SKILL.md) | Any action that changes state, spends money, or is visible to others; loading a third-party skill or plugin; designing a tool | Destructive commands aimed at patterns; spend checked after the fact; retries as a fix for wrong answers; faked human gates; instructions smuggled in through tool output or fetched pages; third-party skills and plugins loaded unread |
| [`computer-use-discipline`](computer-use-discipline/SKILL.md) | An agent operating a desktop, its apps or web pages through a computer-use tool: clicking, typing, reading the screen | The tool's "OK" taken for what the application did; a click or a submit repeated after a timeout; on-screen text followed as an instruction; purchases, sends and consent prompts clicked without the person's confirmation; a screenshot offered as proof of a save |
| [`agent-instruction-writing`](agent-instruction-writing/SKILL.md) | Writing or changing a skill; wording or ordering the rules of a CLAUDE.md, an AGENTS.md or a rules file; an agent that keeps missing a written rule | Rules left to wording that needed enforcement; a description that does not say when to load the skill; the rule that matters most at the end of a long file; "unless it matters" clauses; rules nobody dares delete |
| [`skill-and-plugin-vetting`](skill-and-plugin-vetting/SKILL.md) | Before installing someone else's skill or plugin, before starting an agent in a cloned repository that carries agent files, and before taking an update of one already reviewed | A skill loaded unread; a review of the files a skill names instead of the files it contains; compiled files accepted beside readable source; a scanner's pass reported as "safe"; an update taken without reading the difference |
| [`command-and-control`](command-and-control/SKILL.md) | A session put in charge of other agent sessions as coordinator, lead or orchestrator: dispatching work, reviewing finished units, speaking to the owner, getting a release done, choosing models and helper counts for others | The coordinator doing dispatched work itself; a review of every worker step; a review, check or rule nobody asked for; "your rule" said of the session's own reading; a decision for the owner buried in status text; a list that keeps growing before a release; the strongest model on a job a cheaper one does |

### Building software

| Skill | Use it when | What it guards against |
|---|---|---|
| [`backend-developer`](backend-developer/SKILL.md) | Server logic, CLIs, data models, storage and migration, jobs, integrations, generators, scripts | Silent fallbacks; events fired before state is committed; invented numbers; missing server-side authorization; hallucinated or unpinned dependencies; "it ran successfully" with no artifact checked |
| [`test-suite-discipline`](test-suite-discipline/SKILL.md) | Writing or reviewing a change's tests; a suite grown slow, noisy or full of tests nobody can explain; a test about to be deleted, skipped, quarantined or pinned to exact wording; picking which tests to run; setting the rule for full runs | Tests that only detect change; one sentence pinned in many tests; skips with no way back; a selected run read as the whole suite; no named point where everything runs; a red full run blamed without a run on the revision it started from |
| [`frontend-developer`](frontend-developer/SKILL.md) | Anything that renders or reacts to input: web, mobile, desktop, game UI, terminal, CLI output | Happy-path-only screens; controls a keyboard or screen reader can't use; text overflowing fixed boxes; layouts that only work at one screen size; locale bugs; mockups reproduced by eye; command-line errors that exit with success |
| [`ux-design`](ux-design/SKILL.md) | Before building any user-facing surface, even "just add a button" | Visuals before flow; missing states; WCAG 2.2 design gaps; destructive actions with no undo and no question first; notifications louder than they deserve; dark patterns; onboarding by lock-out tutorial |
| [`visual-craft`](visual-craft/SKILL.md) | Once flow and implementation are right and the question is "does this look right" | Unanchored styles; generic defaults chosen by accident; color judged by eye; a single screenshot trusted as proof; vision models used as taste authorities |

### Game development - work inside an engine, or feeding one

| Skill | Use it when | What it guards against |
|---|---|---|
| [`proof-discipline`](proof-discipline/SKILL.md) | Before a measured result gates a milestone, sets a baseline, decides a rebuild or costs real compute | A bar moved after the data was seen; a sample picked from what fails; a test that could only say yes; the aggregate reported while a neighbouring case got worse |
| [`game-verification`](game-verification/SKILL.md) | Deciding whether a game change works and whether a build may go to a person, with nobody watching | A feature handed over that never ran in the integrated build; a skipped smoke test read as a pass; screenshots from a run with no rendering; timings from the wrong machine |
| [`open-world-streaming`](open-world-streaming/SKILL.md) | Streaming, level of detail, collision loading and loading hitches in large worlds on weak hardware | Two coordinate frames compared with no conversion; a counter reading zero accepted as clean; collision arriving after the vehicle; budgets set from a faster machine |
| [`engine-editor-driving`](engine-editor-driving/SKILL.md) | An agent operating a game-engine editor over a bridge | A success reply accepted with no read-back; object ids carried across a reload; play-mode edits leaking into the asset; a timed-out call re-issued blind |
| [`dcc-agent-authoring`](dcc-agent-authoring/SKILL.md) | Driving Blender from an agent to build and export engine-ready assets | Interactive edits nobody can repeat; scale lost between export and import; a builder that grades itself; a bridge pinned by command name instead of source |

### Writing

| Skill | Use it when | What it guards against |
|---|---|---|
| [`drafting`](drafting/SKILL.md) | Writing any new text: copy, docs, change notes, announcements, emails, articles, in-product text | Filler written to a length; no stance; a register nobody chose; endings that explain instead of land; a headline and an opening that say the same thing twice; a status report that says yes about a check that could only say yes; a change note that praises the change instead of stating it |
| [`fact-checking`](fact-checking/SKILL.md) | Before drafting from real events, before publishing any claim about a real person or organization, and when a published claim turns out wrong | Invented or sharpened quotes; figures and rulings never traced to the primary document; inherited claims on rewrites; indictments written as convictions; real names left in satire; a published error fixed silently; AI-written text published with no disclosure where the law asks for it |
| [`line-editing`](line-editing/SKILL.md) | Revising existing text that reads flat, generic, or machine-written; batch voice passes | Polishing prose that has no stance; the double lede; explained endings; machine-writing tells, with the evidence and its limits; sweeps that edit before grading |
| [`final-read`](final-read/SKILL.md) | After drafting and editing, before anyone else sees the work | Claims checked against memory instead of re-searched; reviewers who rewrite; "is this good?" answered yes by the author; untraced quotes let through; a self-run read passed off as an independent one |
| [`good-news-writing`](good-news-writing/SKILL.md) | Warm, positive coverage of a real person or organization doing something good | Press-release tone; invented villains; backhanded praise; untraceable quotes; overstated good deeds |

## How the skills fit together

- **Scope, then build, then verify.** `task-scoping` decides what the work is; the building skills
  do it; `verification-and-critique` proves it. `research-and-sourcing` feeds any of them with facts.
- **Design before implementation.** `ux-design` hands a flow, wireframe, and states list to
  `frontend-developer`; `visual-craft` judges the built result.
- **Tests.** `verification-and-critique` owns whether a single check proves anything; `backend-developer`
  what a fix owes and how one test run is read (a skip, a test file that never loaded, a red that passes on
  a re-run); `test-suite-discipline` what the suite holds, what runs for a change and the points at which
  the whole suite runs.
- **Facts, draft, edit, read.** On anything drawn from real events, `fact-checking` runs before
  `drafting`; `line-editing` revises what exists; `final-read` re-checks every claim and returns
  verdicts without editing. `good-news-writing` is the warm register those four hand off to.
  `research-and-sourcing` stays the owner of source grading; `fact-checking` applies it to prose.
- **Acting on the world.** `tool-and-action-discipline` owns the general rules for actions.
  `computer-use-discipline` states their screen form for a desktop or a browser, and
  `engine-editor-driving` does the same for a game-engine editor.
- **Text an agent loads.** `agent-instruction-writing` covers the form, order and upkeep of skills
  and instruction files; `context-and-handoff` owns what an always-loaded file holds, and briefs.
- **Someone else's skill.** `skill-and-plugin-vetting` owns the review before a third-party skill
  or plugin is loaded; `tool-and-action-discipline` states the rule in one paragraph and points there.
- **Several sessions, one owner.** `command-and-control` is for the session in charge: what it leaves
  to the others, when it reviews, and what reaches the owner. `context-and-handoff` owns the brief, the
  handoff and the shared workspace; `task-scoping` the form of a choice; `verification-and-critique`
  how a review is run.
- **Every skill says what it is not for**, and points at the skill that is. Overlap is kept small on
  purpose: where two skills need the same rule, one owns it and the other points to it or restates
  only the one line it needs.
- **Each skill works alone.** None depends on a skill outside this folder.

## Install

Copy the folders you want into your project's `.claude/skills/` directory (shared with everyone
who works in that repository) or into `~/.claude/skills/` (every project on your machine). Each
skill loads only when a task matches its description, so installing all of them costs little. They work on their own; none requires The High Council
harness, an MCP server, or an API key.

To install all of them at once, add this repository as a Claude Code plugin:

```bash
claude plugin marketplace add muad-yasin/the-high-council-mcp
claude plugin install the-high-council@the-high-council
```

Plugin skills are namespaced by the plugin, for example `/the-high-council:task-scoping`. The
plugin also registers The High Council MCP server. It does nothing until you call one of its
tools, and it needs your own API keys only for chains that call a paid model.

## How these are written

- **Keep the scar, drop the coordinates.** Each rule keeps the failure that produced it and the
  reasoning behind it; project names, file paths, and tool trivia are removed.
- **Structure over exhortation.** A checklist, a gate, a separate reviewer, or a hard cap beats
  "be careful." Where a mistake happened twice, the rule asks for a mechanical guard.
- **Evidence is graded.** Where a rule rests on published research, the finding is paraphrased
  with its source named and its strength stated; where it rests on practitioner reports or
  inference, it says so.
- **Rules get deleted when they stop being true.** Many rules encode something models currently do
  badly. When that changes, the rule goes. Cited research and standards were re-checked against their primary sources on 2026-09-26, and the game-development set on 2026-10-05 (each page's own date is in the file). A source added since then carries the day it was read, and how much of it was read, in that skill's evidence file under `references/`.

## Updates

The skills are versioned with this repository. Changes are listed in the repository's
`CHANGELOG.md`. A presentation page for sharing lives at `docs/skills.html`; both it and this
catalog are checked by the test suite against the actual `skills/` folder, so neither can list a
skill that doesn't exist or miss one that does.

To propose a change, open an issue or pull request. A good proposal names the failure it prevents,
where that failure was seen, and what the rule should say - not just that a rule would be nice.
