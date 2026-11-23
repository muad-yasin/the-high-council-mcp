---
name: test-suite-discipline
description: Keeps a test suite worth what it costs - which tests it should hold and why, how a test is retired, skipped or marked as a known failure, which tests run for a change, and at which points the whole suite runs. Use when writing or reviewing a change's tests, when a suite has grown slow, noisy or full of tests nobody can explain, when a test is about to be deleted, skipped, quarantined or pinned to exact wording, when picking which tests to run, and when a project sets its rule for full runs. Not for whether a single check proves anything or what a report may claim (verification-and-critique), what a fix owes (backend-developer), or a game build's smoke and soak runs (game-verification).
license: MIT
---

# Test Suite Discipline

A test suite fails in two directions. Tests that guard nothing are paid for on every run and turn red on changes that were meant. And a run of part of the suite, read as a run of all of it, passes tests that nobody ran. This skill is about the suite as a whole: what it should hold, what runs when, and what a result covers.

**Evidence and grades.** **D** = documented in a named source that was fetched and read on the date in `references/evidence.md`: one large company's engineering book and testing blog, the documentation of test runners and CI products, practitioner articles, and files of public skill collections. **Paper** = a finding taken from a paper's abstract; nothing else of the paper was read, and its figures stand in the reference with their setup. **I** = inferred, with the reason in the sentence. **F** = a field case from one project: an observation, not a measurement. Nothing here was measured by this skill's authors, and no rule below says by how much a suite improves.

**This skill owns:** which tests a suite should hold and the break each one guards; retiring, skipping and known failures; the choice of what runs for a change; the points at which the whole suite runs; what a partial run covers. **It hands off:** whether a check can fail at all, a checker changed after the results, and what a report may claim (`verification-and-critique`); what a fix owes, a skipped check or a test file that never loaded, and a red that passes on a re-run (`backend-developer`, "Testing discipline"); flaky checks in a build's runs (`game-verification`, "A FAIL stands").

## 0. The project's own rule comes first

Where a project has written down what runs per change and at which points the whole suite runs, follow that rule; this skill is the reasoning for writing one or questioning one (I: a cadence weighs a project's costs and risks, which no general text knows). F: one project's published rule is one set of the changed and affected tests per change, the whole suite at three named points (a build ready for review, the reviewed wording applied, before the merge), and no run that only confirms an earlier pass.

## 1. A test worth having

- **Name the break first.** Before the test body, answer: which change to the product is this test there to catch, and would that change be a defect or a deliberate choice? A test that only a deliberate choice can break (the value of a constant, the exact words of a message, how the internals are arranged) reacts to redesign and stays silent on bugs (D, one collection's testing reference). One company's testing blog rates a test that merely mirrors its code below zero: it finds no defect and taxes every edit (D).
- **It is tied to what the product must do, not to how the code looks today.** In that company's book the ideal test is edited only when the requirement moves (D). So a refactoring that forces edits to old tests points at tests tied to the code's form (I).
- **Check the fact, never the sentence.** Where an effect, a code, a field or an exit status shows the behaviour, assert that and let the words move (I: the words belong to a writer, not to the logic under test). Where the message itself has to be right (it names the file or the amount), or is the only sign that can be had (another tool's output, an interface that is frozen), assert the one part a faulty program would get wrong, and name that wrong output first (I: a message can come out wrong with no word of it edited, through the wrong branch or the wrong value put in). A whole sentence is compared only where a program parses it, which makes it an interface, or under the one guard below. Anywhere else, the one part catches the wrong output you named; the rest of the sentence only turns the test red on a rewording, and there a rewording is no defect (I). A stored output that holds messages falls under this rule too. F: in one project's review of its sentence-matching assertions, an assertion could be re-aimed at a code or a field only where the call the test makes prints or returns that value.
- **A text that may not change without approval gets one guard:** a comparison with the approved copy, in one place, named as that. The same sentences pinned across many tests add nothing to that guard, and each approved rewording turns them red (I). A test that has to show which message was printed asserts its one part, as above. A guard against a mistake that came back is a different thing: it names the mistake it blocks (`backend-developer`).
- **Recorded outputs are code.** A stored expected output is reviewed, kept small and named for what it shows; when it fails, the cause is looked into before the output is recorded again, which that documentation names as the habit to resist (D, one test runner's documentation).
- **The expected value comes from outside the code being tested:** a literal, a fixture checked by hand. A wanted value that the product's own code or its helpers work out agrees with that code whatever it does (D, the same collection).
- **What an agent's own tests tend to miss.** One preprint found that tests generated by language models mainly capture the program's actual behaviour, not the intended one (Paper). Another found error-handling code to be what agents' changes left under-tested most consistently (Paper). So take the expected behaviour from the requirement before looking at any output, and write the test of the failing path on purpose (I). A third compared pull requests that changed code and tests at once: those made with a coding agent were likelier to add a new test, those made by people alone to change an existing one (Paper). So look for the test that already guards a behaviour before adding one beside it (I).
- **Coverage finds untested code; it does not show that tested code is checked.** One study describes methods that tests execute and whose whole body can be removed without any test failing, in well-covered projects too (Paper).

## 2. The list: what the suite holds, and why

- **Needed means someone relies on it.** One company's book answers "what should be tested?" with: whatever you would not want broken (D). The record of why a test exists is the break it names; a test nobody can state a break for is a candidate for review, not yet a deletion (I).
- **An inventory answers "what do we have":** each source file with the tests that exercise it. An unmatched file is a lead and not yet a finding, because a matcher cannot see tests that reach the code through fixtures or other indirection (D, one public skill).
- **Retire on purpose.** A test goes when its cost is above its value. Candidates: a behaviour tested several times over, tests for code that nothing but tests calls any more, tests that repeat the implementation (D, one practitioner's article); a broad test whose every condition a narrower test already checks (D, another). Before deleting a "duplicate", say which other test catches its break: research on shrinking suites by coverage treats lost fault detection as the price to be weighed (Paper), so equal coverage is not equal protection (I).
- **A deleted feature takes its tests along, in the same change** (I: a test whose code is gone can only fail for the wrong reason or sit skipped). The same change removes a test file left empty, a fixture only the removed tests read, and any title or comment that still names the removed check (I: such a title claims a check nobody runs).
- **A skipped or disabled test carries its reason and what brings it back.** One company's book prefers a tracked list to commenting a test out, because a commented-out failure is easy to forget (D); one study found that many disabled tests never came back (Paper). A quarantine for unstable tests needs a limit, in number or in time, or tests are forgotten there (D, one practitioner). A skipped check is still not a pass (`backend-developer`).
- **A known failure is written as the right behaviour under a strict expected-failure mark, where the runner has one,** so that the suite goes red as soon as the bug is repaired, which forces the mark off (D, one test framework's documentation).
- **A test can guard freshness.** F: one project lets a dated table turn its suite red once the table is old. The repair is to check the data against its source and update its date, never to move the date in the test.

## 3. What runs for a change

- **Each way of choosing tests is blind to some inputs; look up which in its documentation.** By the import graph: dynamic imports (D, one runner), and a test that starts the built program as a separate process (D, another runner). By the code each test executed on an earlier run: static data files and outside services (D, one plug-in). One CI product runs everything when a commit holds a file type it does not know (D).
- **So a selection has a stated fallback.** Manifests, configuration, build files, the test setup and anything the selector does not recognize run the whole suite (D for one runner's default trigger files; I for the general rule: these are the changes a graph cannot follow).
- **A named test file is not the selection.** One collection reports that in 11 of its 12 probe runs a session whose task pointed at a single test file ran that file and nothing else, and now tells sessions that green is defined by the project's suite (D that it says so). A task that names a test still owes the tests of everything else it touched (I).
- **Ask "changed compared to what?"** A selection against a version-control reference and one against each test's last run answer different questions (D, one runner's documentation).
- **What a selected run tells you.** Nothing about the tests it left out, and a selection that matched no test is not a pass (I). A focus mark left in the code turns "all tests" into the marked ones; one runner refuses such marks, by default where it detects CI (D). A required check that a path filter skipped does not count as passed: on one platform it stays pending and blocks the merge (D). Count what ran against what should have run (`backend-developer`: a test file that never loaded).
- **A failure in a test the selection left out shows only when the rest runs too** (I). The points below are that check.

## 4. The points at which the whole suite runs

The rule: a project names the points at which the whole suite runs. Every selected run has one of those points after it (I: only a run of the whole suite catches what a selection cannot see). Points that the sources name, each with what it catches:

- **On the merged result, before the merge lands.** Two changes that touch separate files may both be green on their own and red once combined (D, one company's book); a merge queue runs its required checks on a change together with those ahead of it (D, one platform's documentation), so the whole suite runs there only where it is one of those checks (I).
- **Once when a task is finished, with narrow runs along the way.** The runs per step show which step broke something; the closing run is what the task owes (D, one collection). The same collection runs everything once more after work done in parallel is joined (D).
- **A slower, fuller stage after a fast one,** run whenever it can be. When it catches a bug, the fast stage gets a test for it (D, one practitioner).
- **After a change the selection cannot judge:** configuration, tooling, the test setup itself (I, from section 3).

Between those points:

- **No ritual in either direction.** One vendor's skill reports a measured case in which stripping habits from a prompt, the whole suite after each edit among them, saved nothing (D that it reports this). What a cadence costs or saves is measured, not assumed (I).
- **A red full run is attributed before it is blamed.** Repeat the failed check on the revision the change started from. If it passes there, report the failure as following the change; if it fails there too, keep the two logs and report the cause as not settled. Matching exit codes are not proof of the same failure (D, one security firm's skill). Then say for each failure whether the test is wrong, the product is wrong, or the surroundings are (a service, a machine, a setting) (I). It is never re-run until it passes (`backend-developer`; `game-verification`).

## Mistakes to flag

- A test added without naming the change that should break it; a test that goes red on every approved rewording.
- The same sentence pinned in many tests; a whole sentence asserted where a code, a field or the one telling part of the message would do.
- An expected value worked out by the product's own code; a stored output recorded again to make a failure go away.
- A model's tests taken from the code's output; no test of the failing path.
- A test added beside one that already guards the behaviour.
- A "duplicate" deleted without saying what else catches its break; tests of deleted code left behind; a title that names a check that is gone.
- A skip with no reason and no condition for its return; a quarantine without a limit; a known bug's test weakened instead of marked.
- The date in a freshness test moved instead of the data refreshed.
- A selected run reported as "the tests pass"; a selection with no fallback for configuration and data files; zero selected tests read as a pass; a focus mark left in.
- A named test file taken as the whole selection.
- No named point at which the whole suite runs; the whole suite after every small change, with nobody having measured why.
- A red full run blamed on the change without a run on the revision it started from.

Depth: open `references/evidence.md` before a source or a figure from this file is quoted (each source, how much of it was read, the papers' figures with their setups). Open `references/suite-sheet.md` when making or auditing the list of what a suite holds, or when writing down a project's run rule.
