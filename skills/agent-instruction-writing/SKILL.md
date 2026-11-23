---
name: agent-instruction-writing
description: Writes and revises text an agent loads (a skill, an instruction file, a rules file) so that it is found, followed and still true next month. Use when writing or changing a skill, when wording or ordering the rules of a CLAUDE.md, an AGENTS.md or a rules file, when an agent keeps missing a written rule, or when such a file has grown. Not for what an always-loaded file should hold, briefs or handoffs (context-and-handoff), prose for people (drafting, line-editing), or vetting someone else's skill (skill-and-plugin-vetting).
license: MIT
---

# Agent Instruction Writing

Text written for an agent fails differently from text written for a person. A person skims a bad manual and asks a colleague. An agent loads the file and acts on what it finds, on every run: a stale line is obeyed, a vague line is read five ways, a long file thins the attention each rule gets, and a description that names the wrong moment means the file is never opened. For an agent, the writing is the interface.

**Evidence and grades.** **D** = documented in a named source, read on the date in `references/evidence.md`: the open Agent Skills specification and its authoring guides, one coding harness's documentation, the authoring skills of two public skill collections and, for one point, one tool's skill file. A harness fact is true for that harness on that date. **Preprint** = a finding of a paper on a preprint server, of which the abstract was read; whether it has been peer reviewed was not checked, and its figures and setup are in the reference, not here. **I** = inferred, with the reason in the sentence. This skill does not claim that following it improves an agent's results. Where a source reports its own wording tests, that is the source's claim.

**This skill owns:** the form, order, size and upkeep of text an agent loads. **It hands off:** what an always-loaded instruction file should contain, a document that disagrees with the code, briefs and handoffs (`context-and-handoff`); enforcement by the harness (`tool-and-action-discipline` item 11); prose for human readers (`drafting`, `line-editing`); whether to trust someone else's skill (`skill-and-plugin-vetting`).

## 1. First ask whether it should be text

- **A rule with no exceptions is not a wording problem.** Text goes to a model, and the model chooses how to act on it; a permission rule, a check or a test applies whatever the model decided. One harness's documentation draws this line and adds that a line which needs ever more emphasis belongs in enforcement (D). Keep text for judgment (`tool-and-action-discipline` item 11).
- **What the agent finds by looking stays out.** `context-and-handoff` section 1 owns this rule for always-loaded files, with its evidence. It holds for a skill as well: one harness's documentation says so, and one collection calls a written copy of the environment a cache that goes stale (D).
- **Write a rule for a failure somebody saw:** an incident, a review comment, a correction made twice. Instructions generated from general knowledge come out generic (D, the authoring guide), and a rule for a failure nobody watched has nothing to be checked against (I).
- **The cut test, line by line:** would the agent make a mistake if this line were gone? If not, the line goes (D, the guide). A sentence that only repeats what the model does anyway is paid for on every run and changes nothing (D, one collection).

## 2. The description is the most expensive sentence

Only a skill's name and description are loaded for every task; the body is loaded once the agent picks the skill (D, the specification).

- **Say when to use it, in the words of the person asking,** with the cases where they would not name the subject (D, the guide). Lead with the main use case: one harness cuts each listing entry at a fixed length and, when the whole listing outgrows its budget, drops entire descriptions, least-used first (D, dated: `references/evidence.md`).
- **Do not summarize the procedure in it.** One collection gives its reason: an agent given the procedure in short form acts on the short form and leaves the body unopened (D that it says so; the effect is its own observation).
- **Say what it is not for, and name the neighbour.** Two skills that could both answer a request leave the choice to chance (I). One preprint found that as a skill library grew the agent picked the wrong skill more often, and that this, not the longer context, was the main loss.
- **A description cannot force a load.** Agents tend to consult a skill only for a task beyond what they manage alone (D, the guide), so a skill for something easy is rarely opened: fold it into another file or drop it (I).

## 3. Order and size: what is read, and what survives

- **The rules that matter most go first.** One harness re-attaches only the start of each loaded skill after it compacts a long conversation (D, dated), and one preprint's benchmark saw a bias toward the earlier instructions of a long list.
- **Write a standing rule, not a one-time step,** for anything that must hold through the task ("check the build after each change", not "check the build"). A harness may read the file once and not again (D, one harness).
- **Cut to the rules that are needed.** In one preprint's synthetic test, following fell as the number of instructions given at once grew; in another's benchmark, focused skills did better than exhaustive bundles. Neither measured your file, and other studies of rule count were not read for this skill: the two are a reason to cut, not a number to quote.
- **Stay inside the format's sizes.** The specification recommends a body under 500 lines and under 5,000 tokens, with detail in reference files one level down (D).
- **Traps stay in the main file.** A fact that contradicts what anyone would assume (a flag the tool ignores when it is misspelled, a test command that passes when no test ran) helps only if it is read before the agent meets the trap, and the agent may not know that it needs the reference (D, the guide; the examples are ours).
- **A pointer to a reference names its condition:** "open the migration notes when a schema file changes", not "see the references" (D, the guide).
- **One meaning, one place** (`context-and-handoff` section 5 owns the rule on single copies). Inside one file, keep a rule beside its caveat, so that reading one brings the other (I).

## 4. The failure decides the form

Name the failure before choosing the wording. One collection gives this pairing from its own wording tests (D that it does; the results are its claim):

| The agent... | Form that fits | Form that fails |
|---|---|---|
| knows the rule and breaks it under pressure | a plain prohibition, with its reason and the excuses it does not accept | "prefer", "consider" |
| follows the rule, yet what it produces is shaped wrong | a recipe that names each part of the output and their order | a list of don'ts |
| leaves out a required element | a required slot in the template it fills in | a reminder near the template |
| should act differently by case | "if (something it can observe), then ..." | one rule with exemption clauses |

- **No "unless it matters".** A soft tail reopens what the rule closed. A real exception is its own if-then on something the agent can observe (D, the same collection).
- **Put the wanted behaviour beside every ban.** The two collections disagree here: one keeps bans for discipline failures, the other says a ban puts the banned thing in view and keeps one just for hard limits (D that they disagree). What both allow: say what to do, and keep a ban for a limit that cannot be put positively (I).
- **Give a reason where the agent must judge, and only there.** One harness's documentation asks for instructions without narration, since a loaded line is paid for on every later turn; the open guide says a reason helps on flexible instructions (D, both). So: one clause of reason on a rule the agent must apply to cases you did not list, none on a mechanical step (I).
- **No volume.** Capitals, "IMPORTANT", "think harder", "don't be lazy": one vendor now lists these as advice its current models no longer need, and says piled-on emphasis makes a rule over-applied (D, dated).
- **Concrete enough to check.** "Dates as YYYY-MM-DD", not "format dates consistently" (D for the rule, the harness documentation). Each step ends on a condition that tells done from not done, and the strong ones are exhaustive: "every caller of the changed function read" asks for more than "check the callers" (D, one collection).
- **One recommended way.** Name it, and give any alternative one short mention (D, the guide).
- **No two rules that disagree.** Faced with a contradiction the agent may follow either (D, the harness documentation).

## 5. Keep it true

- **A fact is dated; a rule is an imperative.** A line that describes the code in the form of a command goes on commanding after the code has moved (`context-and-handoff` section 1 owns the rule and its evidence).
- **Keep the reason a maintainer needs in order to delete the rule.** One preprint followed instruction files across many repositories: they kept growing, and the older a line was, the less likely anyone deleted it; in its tests, comments that carried the reasoning behind each line stopped the growth and, in one setting, also improved how well the instructions were followed. The abstract does not say where such a comment sits. Keep the reason where the maintainer will find it at the moment of deleting: next to the rule, beside the file or in the commit message (I: a reason nobody can find is the same as none).
- **Delete on purpose.** A rule goes when the failure it guards against no longer happens, when the tool changed, or when a newer model does the thing unasked. Re-read the file at every model or harness change: advice ages, and one vendor publishes its own list of retired advice (D).
- **Nothing a command can report.** A flag list or a version number in the text is wrong after the next release. Name the command that prints it; one tool's skill file does exactly that for its flags (D).
- **Whether a wording works is an empirical question, and this skill does not answer it.** One collection tests each wording against a run with no guidance, and writes nothing when that run does not show the failure; it also says a single sample misleads (D, its method).

## Mistakes to flag

- A rule that must never bend left to wording, with more emphasis each time it is missed.
- The directory tree, a script list or a version number restated in a file the agent loads.
- A rule written for a failure nobody saw; a line kept because it sounds right.
- A description that summarizes the procedure, or that does not say when to use the skill and what it is not for.
- Two skills that answer the same request.
- The rule that matters most at the end of a long file; a one-time step where a standing rule was meant.
- A trap moved to a reference; a pointer that says "see the references" with no condition.
- A list of don'ts where the shape of the output was the problem; a reminder where a template slot would do.
- "Unless it matters", "where appropriate", an exemption clause.
- A ban with no wanted behaviour beside it.
- Capitals or "IMPORTANT" used as a fix.
- A step with no condition that tells done from not done.
- Two instructions that contradict each other.
- A fact about the code written as a command, with no date; a rule nobody dares delete because its reason is gone.
- A benchmark figure quoted as if it had measured this file.

Depth: open `references/evidence.md` before a figure, a size limit or a harness fact from this file is relied on or quoted. It has each source and how much of it was read, the dated harness facts, and the preprints' figures with their setups.
