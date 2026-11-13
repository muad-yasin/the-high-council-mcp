# Evidence for test-suite-discipline (dated)

*Open this file before a source or a figure from `SKILL.md` is quoted: it says where each rule comes from, how much of the source was read, and what the source did not test.*

*Grades as in `SKILL.md`. Every source below was fetched as plain text on 2026-11-12, and the passage each rule rests on was read in that copy; unless a line says otherwise, the rest of the page or file was not read. Ideas are restated in this skill's own words; no sentence is taken from a source. Nothing here was measured by the author of this file.*

## A. One company's book and blog (D: what Google's engineers wrote about their own practice)

- **Source:** "Software Engineering at Google" (O'Reilly, 2020; free HTML edition at abseil.io/resources/swe-book), chapter 11 "Testing Overview" (Adam Bender), chapter 12 "Unit Testing" (Erik Kuefler), chapter 23 "Continuous Integration" (Rachel Tannenbaum). Licence CC BY-NC-ND 4.0: ideas only. Read: the sections named below.
  - Chapter 11, the section on what to test: a behaviour you want to rely on needs an automated test; the passage counts performance, accessibility and security among such behaviours.
  - Chapter 12, the section on tests that should not need changing: ideally a test is edited only because what the system has to do has changed; the chapter then sorts edits into four kinds, of which only the opening of that list was read.
  - Chapter 23: before a submit only fast and reliable tests run, with some loss of coverage accepted; two changes to separate files may both pass alone and still fail once combined; a mechanism is needed to disable broken tests for a while without losing sight of them (bug lists are the technique named); one team's account says that with the tests commented out, forgetting the failures would have been too easy.
  - Written for a very large single repository with heavy automation. The direction may carry to a smaller project; the numbers and tools do not (I).
- **Source:** "Testing on the Toilet: Change-Detector Tests Considered Harmful" (Alex Eagle, Google Testing Blog, 2015-01-27). Read: the post.
  - A test that mirrors the code it tests breaks on any change to that code and checks no behaviour. The post says such tests have negative value, because they catch no defect and add maintenance cost, and advises rewriting or deleting them.

## B. Tool and CI documentation (D: what each product documents about itself, on the day read)

- **Source:** Jest documentation, "Snapshot Testing" (the best-practices list) and "Jest CLI Options" (`--onlyChanged`).
  - Snapshots are committed and reviewed like code, kept short and focused and given descriptive names, and the page warns against renewing them when a suite fails without looking for the cause; choosing tests by changed files works only where the imports can be resolved statically.
- **Source:** Vitest documentation, recipe "Running Only Affected Tests" and config entry `forceRerunTriggers`.
  - Two bases for deciding what is affected: a revision in version control, or each test's last run with the files it loaded. The page says that before a merge the full run is the check to make. Listed trigger files (package manifest and the runner's own config by default) rerun the whole suite; a test that executes a built script as a process cannot be re-selected through the module graph.
- **Source:** pytest documentation, "How to use skip and xfail to deal with tests that cannot succeed" (the `strict` parameter).
  - With `strict` set, a test marked as an expected failure fails the suite when it passes.
- **Source:** Mocha documentation, "Command-Line Usage" (`--forbid-only`).
  - The option fails the run when an exclusive test is found; from version 12 it is on by default where the `CI` variable is set.
- **Source:** testmon.org, the page of the pytest plug-in testmon.
  - It selects tests by the code each one executed on an earlier run, and says that static files and outside services are not tracked.
- **Source:** Microsoft Learn, "Speed up testing by using Test Impact Analysis (TIA)" (Azure Pipelines).
  - A commit with a file type the feature does not know makes it run all tests.
- **Source:** GitHub Docs, "Managing a merge queue" and "Troubleshooting required status checks" (the table on skipped but required checks).
  - A merge queue validates each change on a short-lived branch that also holds the changes ahead of it, with the required checks run there. A required workflow skipped by a path or branch filter leaves its check pending, which blocks the merge.

## C. Practitioner articles (D that the author says so; each is one person's experience)

- **Source:** Benji Weber, "Delete your Tests" (2014-04-27). Read: the opening and the sections on value and redundancy.
- **Source:** Ham Vocke, "The Practical Test Pyramid" (martinfowler.com, 2018-02-26). Read: the section on avoiding duplication between test levels.
- **Source:** Martin Fowler, "Continuous Integration" (martinfowler.com, revised 2024-01-18). Read: the passage on the commit build and the secondary build.
- **Source:** Martin Fowler, "Eradicating Non-Determinism in Tests" (martinfowler.com, 2011-04-14). Read: the section on quarantine. Its examples of a limit are eight tests, or one week.

## D. Files of public skill collections (D that the file says it; their probe and cost results are their own claims)

- **Source:** `obra/superpowers` on GitHub at commit `22f0b463e7a5e579904dd6211a520321035526f7` (MIT): `skills/test-driven-development/writing-good-tests.md` (the first principle), `skills/subagent-driven-development/implementer-prompt.md`, `skills/executing-plans/SKILL.md`, `skills/dispatching-parallel-agents/SKILL.md`, and `RELEASE-NOTES.md` (the entry on test-driven development: in 11 of 12 of its probe runs a session whose task named one test file ran only that file). Read: the passages, not the files.
- **Source:** `github/awesome-copilot` on GitHub at commit `30a0d7465b14b05e05949d6588b99f7af0c537b4`: `skills/test-gap-audit/SKILL.md` (the passage on its source-to-test matcher and its limits).
- **Source:** `trailofbits/skills` on GitHub at commit `e4dd0bb5b15535f7c5a0834187dffba6ac37e4ff` (CC BY-SA 4.0: ideas only): `plugins/post-patch-validation/skills/post-patch-validation/SKILL.md` (a failed suite check is run again on the baseline).
- **Source:** `anthropics/skills` on GitHub at commit `2c5958ecac7cee2b583967a2c4981d0f4a75c579`: `skills/claude-api/shared/evals/cost-hillclimb.md`. The measured case removed several habits from a prompt at once (forced plan files, a re-read after every edit, the full test suite after every change) and saved nothing against its own pre-registered prediction. It does not isolate the full-suite habit, so it supports "measure a cadence", and no claim about full runs as such.

## E. Papers, by abstract only

Each figure belongs to its setup. None of them measured this skill or your suite. The abstracts were read through arXiv's API, or through OpenAlex where a paper is not on arXiv; review status is given as the record states it.

- **Source:** "Can we find bugs using LLM-generated oracles?" (arXiv:2410.21136v2, first version 2024-10-28; no journal on the record).
  - Developer-written and generated tests for 24 Java repositories. The study asks whether a generated test's assertions capture the program's actual behaviour or the expected one; the abstract says that tests generated by language models mainly capture the actual behaviour. It gives no share.
- **Source:** "Test Coverage Analysis of Agentic Pull Requests" (arXiv:2607.18057v1; the record's comment says it will appear at a conference on software maintenance).
  - 4,882 agent-generated pull requests of one public dataset, written by five coding agents (Python 4,350, Java 532). Error-handling constructs were what was under-tested most consistently; the highest miss rates given are 86.0% for Java and 81.0% for Python.
- **Source:** "Human-Agent versus Human Pull Requests: A Testing-Focused Characterization and Comparison" (arXiv:2601.21194v1; no journal on the record).
  - 6,582 human-agent and 3,122 human pull requests of the same dataset. The two groups included tests about equally often (42.9% and 40.0%). When code and tests change together (the abstract's "code-and-test co-evolution"), a human-agent pull request was likelier than a human one to add a new test (odds ratio 1.79); the human ones leaned towards modifying existing tests.
- **Source:** "A Comprehensive Study of Pseudo-tested Methods" (arXiv:1807.05030v2; journal reference on the record: Empirical Software Engineering, Springer Verlag, 2018, pp 1-31).
  - A pseudo-tested method is one that the suite covers and whose body can be removed without any test failing. A replication over more than 28,000 methods, and 101 such methods analysed by hand. The abstract says they exist even where a project counts as well tested and its statement coverage is high.
- **Source:** "Balancing Trade-Offs in Test-Suite Reduction" (FSE 2014, DOI 10.1145/2635868.2635921).
  - The abstract frames reduction as a trade between a smaller suite, its coverage and the faults it no longer detects. No figure is taken from it.
- **Source:** "How Disabled Tests Manifest in Test Maintainability Challenges?" (ESEC/FSE 2021, DOI 10.1145/3468264.3468609).
  - The abstract reports that 41% of the tests that were disabled never came back, and that the majority remained disabled for years. The projects studied are described in the paper, which was not read.

## F. Field cases (one project; observations)

- The per-change rule in `SKILL.md` section 0 is published in that project's own repository instructions.
- The re-aiming of sentence-matching assertions (section 1) comes from a review that was still running on 2026-11-12. Only one working rule of that review is told, no result.
- The dated table that turns the suite red (section 2) is that project's documented practice for its price and model tables.

## Not read, so not used

The research this skill started from cites more: studies of test selection and of batching in large CI systems, of test deletion, of test names and smells, of mutation testing used during code review, and a build tool's rule for tests left out of wildcard runs. Their full texts or the passages in question were not read by the author of this file, so nothing rests on them. Mutation testing is not covered by this skill.
