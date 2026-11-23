# Evidence behind the measured claims

SKILL.md names a few findings in one clause each. This file carries what each number belongs to: the source, the setup, what was reported, and when the source was last read. Quote a number from here only together with its setup (`research-and-sourcing`). All three papers are preprints unless a venue is named, and none of them measured this skill.

## Stale instruction files (SKILL.md section 1)

- **Source:** Xiaonan Xu and Wenjing Wu, "Stale Instruction Files Override the Code in Coding Agents: A One-Sentence Fix", arXiv:2610.30571, submitted 22 October 2026. Preprint. Read: the abstract, 2026-11-12.
- **Setup:** 40 Python projects built for the study. In each, the project's instruction file demands a convention that the code already in place does not follow. Two coding agents, Claude Code and Codex CLI, were given a feature to build in every project, both without and with a single extra line in the user-level instructions saying that code already in place outranks the file. 320 runs in total.
- **Reported:** with no such sentence, the agents sided with the stale file in 90.1% of their choices. One agent named the disagreement in 79 of 80 runs and went with the file all the same; the other, in 20 of 80 runs, changed the code already in place so that it matched the file, and the project's tests then failed in 17 of the 20. With the sentence, the share of choices that went with the code rose from 4.2% to 91.4%.
- **How far it reaches:** purpose-built projects and two agents, at one point in time. It shows which way agents lean, not how often a real repository's file is stale.

## Repository context files (SKILL.md section 1)

- **Source:** Thibaud Gloaguen, Niels Mündler-Sasahara, Mark Niklas Müller, Veselin Raychev and Martin Vechev, "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?", arXiv:2602.11988, version 3 of 29 September 2026. Preprint. Read: the abstract, 2026-11-12.
- **Setup:** coding agents on SWE-bench tasks with model-written context files, and on a new set of issues from repositories whose developers had committed such files; several agents and models.
- **Reported:** task success was, on the whole, no higher with the files than without, and the cost of inference went up by more than 20% on average. Agents did follow the instructions in the files. Repository overviews did not help. The authors still see a use for the files: stating practices that are not standard.
- **How far it reaches:** it argues for short files that hold what cannot be discovered, not against instruction files as such.

## A memory rewritten whole (SKILL.md section 2)

- **Source:** Qizheng Zhang and twelve co-authors, "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models", arXiv:2510.04618, version 3 of 29 March 2026 (the authors list it as ICLR 2026). Read: the abstract and the passage on context collapse, 2026-11-12.
- **Setup:** one case from the AppWorld benchmark, which the authors show with an earlier method (Dynamic Cheatsheet) where a model rewrites the whole accumulated context at every adaptation step.
- **Reported:** that context held 18,282 tokens at step 60, with accuracy 66.7. At the next step it held 122 tokens, with accuracy 57.1, below the 63.7 reached with no adaptation.
- **How far it reaches:** one case on one benchmark. The authors say the risk is not specific to that method, and use the case to motivate updating a context item by item.

## Working advice, not measured

- **What an always-loaded file holds.**
  - **Source:** Claude Code's documentation, "Best practices" (code.claude.com/docs/en/best-practices), section "Keep CLAUDE.md short". Read: that section, 2026-11-12.
  - The list in SKILL.md section 1 draws on that section's test (keep what the code itself does not show) and on the evaluation above. The item on slow or costly operations is this skill's own reasoning.
- **The receiver confirms a handoff.**
  - **Source:** Google, "Site Reliability Engineering" (2017), chapter "Managing Incidents". Read: the section "Clear, Live Handoff", 2026-11-12.
  - When command of an incident changes hands, the outgoing lead says so explicitly and stays until the incoming lead has acknowledged it. A practice from human incident response, carried over here by analogy.
