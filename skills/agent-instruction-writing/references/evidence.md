# Evidence for agent-instruction-writing (dated)

*Read this file when a figure, a limit or a harness fact from `SKILL.md` is about to be relied on or quoted: it says where each comes from, how much of the source was read, and what the source did not test.*

*Grades as in `SKILL.md`. Every source below was fetched as plain text and read on 2026-11-12. Ideas are restated in this skill's own words; no sentence is taken from a source. Nothing here was measured by the author of this file, and no test of these rules was run for this skill.*

## A. The Agent Skills format (D)

- **Source:** `docs/specification.mdx` in the repository `agentskills/agentskills` on GitHub, at commit `83021e2be457a9b6679148719c1f6074f0ad975e` (served at agentskills.io/specification). Read: the field table, the name and description rules, and the section on progressive disclosure.
  - `name`: at most 64 characters, lowercase letters, digits and hyphens, no hyphen at either end and no double hyphen, and equal to the folder's name.
  - `description`: 1 to 1,024 characters, stating the skill's purpose and the occasions for it.
  - Loading in three steps: name and description for every skill at startup (about 100 tokens each); the body once the skill is chosen (under 5,000 tokens recommended, and under 500 lines); other files only when needed, referenced one level below the main file.
- **Source:** `https://agentskills.io/skill-creation/best-practices` (markdown copy). Read: the passages on starting from real expertise, on spending context, on moderate detail, on loading reference files, on matching specificity to fragility, on defaults and on traps. Other parts of the page were not read.
  - A skill generated from general knowledge, with no material from the domain, comes out vague; real incident reports, runbooks and fixes are the better source.
  - For each piece of content, ask if leaving it out would cause a mistake.
  - A skill that tries to cover everything can do harm: the agent follows instructions that do not apply to the task at hand.
  - Each reference file comes with the occasion for opening it.
  - A reason helps on flexible instructions; fragile operations get exact steps.
  - Name one way as the default; other ways get a short mention.
  - The most valuable content is often a list of traps, kept in the main file; each correction a person has to make becomes a new entry.
- **Source:** `https://agentskills.io/skill-creation/optimizing-descriptions` (markdown copy). Read: the passage on how triggering works and the list on writing a description. Not used: its trigger-test design.
  - Agents tend to consult a skill only for a task beyond what they handle alone, so a simple request may not trigger a matching skill.
  - Word the description like an instruction on when the skill applies, in terms of what the user wants and also for requests that never name the domain; keep it to a few sentences.

## B. One coding harness: Claude Code's documentation (D, facts about this harness on the day read)

- **Source:** `https://code.claude.com/docs/en/skills` (markdown copy).
  - The listing entry of a skill (the description plus an optional field for when to use it) is cut at 1,536 characters, which is why the main use case leads.
  - The listing has a character budget equal to 1% of the context window of the model in use. Every name stays; when the listing overflows, descriptions are dropped starting with the least-invoked skills.
  - The harness loads a skill's content into the conversation a single time, at invocation, and does not go back to the file afterwards, so guidance for the whole task is worded as a standing instruction.
  - After a compaction the harness brings back each skill as last invoked, up to its first 5,000 tokens, within 25,000 tokens for all of them, newest first.
  - The page asks for a concise body that states what to do without narrating how or why, because a loaded line costs tokens on every later turn. It also repeats the 500-line advice.
- **Source:** `https://code.claude.com/docs/en/best-practices` (markdown copy). Read: the section on instructions the model decides about and instructions the harness enforces; the note that an instruction file and a skill hold only what cannot be found by looking; the table of advice the vendor says is no longer needed.
  - The retired advice named in `SKILL.md` section 4 (capital letters and "IMPORTANT", "think harder", "keep going") is in that table, with the vendor's reason for each; the same table drops the description of architecture and file layout.
  - A line that keeps needing more emphasis is a candidate for enforcement.
- **Source:** `https://code.claude.com/docs/en/memory` (markdown copy). Read: the section on writing effective instructions.
  - Instructions should be concrete enough to verify; a target of under 200 lines per instruction file; two instructions that contradict each other may be resolved either way.

## C. Two public skill collections (D that they say it; their test results are their own claims)

- **Source:** `skills/writing-skills/SKILL.md` in `obra/superpowers` on GitHub, at commit `22f0b463e7a5e579904dd6211a520321035526f7`. Licence: MIT. Read whole (399 lines); its reference files were not read.
  - A description gives only the conditions for use; the stated reason is that an agent follows a workflow summary in place of the body.
  - The table of failure and fitting form that `SKILL.md` section 4 restates, the rule against nuance clauses, and the point that an exemption clause does not reliably limit a rule. The file reports these from its own wording tests and gives no models, sample sizes or dates.
  - Its method for testing a wording: one fresh sample per call, always a control with no guidance, several repetitions, and every flagged match read by a person.
- **Source:** `skills/productivity/writing-for-agents/SKILL.md` in `mattpocock/skills` on GitHub, at commit `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`. Licence: MIT. Read whole (81 lines); the file it points to was not read.
  - State the target behaviour; a prohibition is kept for hard limits and goes together with the positive target.
  - Each step closes on a stated condition for being done, and a condition that demands every item drives more thorough work.
  - A document repeating what the environment already says will drift from it; record only what cannot be found by looking.
  - A sentence the model already follows by default says nothing; delete the whole sentence.
- **Source:** `skills/agent-desktop/SKILL.md` in `vercel-labs/agent-desktop` on GitHub, at commit `54855b6225aec00da4ac65e2d0362fd41cd9fcb3`. Licence: Apache-2.0. Read whole. Used for one point: the file sends the agent to the tool's own help for flags and does not repeat them.

## D. Four preprints (the abstracts were read, through arXiv's interface for programs; none of the four records names a journal, and review status was not checked further)

Each figure below belongs to its setup. None of them measured this skill, this catalog or your files.

- **Source:** "How Many Instructions Can LLMs Follow at Once?" (arXiv:2507.11538v1, 15 July 2025).
  - A benchmark of up to 500 keyword-inclusion instructions inside one report-writing task, 20 models from seven providers. The best models reached 68% at 500 instructions; the abstract reports several patterns of decline and a bias toward earlier instructions. A synthetic task with models of 2025: it shows a direction, not a limit for today's models.
- **Source:** "SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks" (arXiv:2602.12670v4, 14 June 2026).
  - 87 tasks spread over 8 domains, each with a deterministic verifier, run with and without curated skills on 18 pairs of model and harness. Mean pass rate went up to 50.5% from 33.9% with its curated skills, and the abstract says focused skills of at most three modules did better than larger or exhaustive bundles. The skills were curated for those tasks.
- **Source:** "More Skills, Worse Agents? Skill Shadowing Degrades Performance When Expanding Skill Libraries" (arXiv:2605.24050v2, 23 June 2026).
  - The pass rate fell as much as 21% once a small set of known-helpful skills was placed in a 202-skill library. The authors split the loss into wrong skill selection, which grew with library size, and the effect of a larger context, which they could not tell from zero.
- **Source:** "Why Does CLAUDE.md Keep Growing? Catastrophic Remembering in Agentic Coding" (arXiv:2608.11095v1, 11 August 2026; one author).
  - 1,867 repositories and 247,694 instruction lifetimes: files more than tripled over their life (+226%), and an older instruction was less likely to be deleted. In a synthetic setting built from an instruction-following benchmark, comments carrying the reasoning behind instructions removed 99.3% of the excess instructions. Applied to a second benchmark of real-world instructions, such comments improved instruction-following by as much as 23.1%. The abstract does not say where the comments sat or whether the model that carried out the instructions saw them.

## Not read, so not used

The research this skill started from cites more papers: on repository context files, on rules files, on stale instruction files and on skills an agent writes for itself. `context-and-handoff` cites two of them, on stale instruction files and on context files, in its own evidence file; nothing from the others is used here. The reference files of the two collections were not read.
