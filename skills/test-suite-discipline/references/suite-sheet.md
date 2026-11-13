# The suite sheet

*Open this file when making or auditing the list of what a test suite holds, or when writing down a project's run rule. Two small tables; neither needs a tool.*

## 1. The list (one row per test, or per test file where one file guards one behaviour)

| Column | What goes in it |
|---|---|
| Test | The file and the test's name. |
| Guards | The behaviour someone relies on, as the break the test would catch ("a missing config file gives the default, not a crash"). Empty means: candidate for review. |
| Reads | What the assertion looks at: a returned value, a field, a code, a file, or one part of a message. A whole message gets a note naming the program that parses it or the approved copy it guards. |
| Also caught by | Other tests that fail on the same break. "None found" means: not a duplicate, whatever the coverage says. "Not checked" is a different answer and is written as that. |
| Cost | Run time, what it needs (a service, a key, a build), and any history of unstable results. |
| State | active, skipped, known failure, or quarantined. Anything but active carries the reason, the date it left active and what brings it back. |
| Decision | keep, rewrite, or retire, with one line of reason and the date of the decision. |

Fill it from the suite and the source, not from memory: list the test files with a tool, then pair each source file with its tests through names, paths and import lines. A source file that pairs with nothing is a lead to look at, not yet a gap. List those files under the table: the table has a row only where there is a test.

## 2. The run rule (one row per kind of change)

The four rows are a starting set. A project writes its own and names the selector that the first row relies on.

| Kind of change | What runs | Why that is enough |
|---|---|---|
| A change inside one module | The tests that load it, plus any test named in the task | The selection's own blind spots are covered by the next full run |
| Configuration, manifests, build files, the test setup | Everything | The selection cannot follow these |
| A file type or a place nobody has mapped | Everything | An unknown change is not a small change |
| Text that no program reads (prose documentation, comments) | The checks on that text, if any | It changes no program and no input of one. It gets a row of its own so that it is not run as an unmapped change. A document that a test or a tool reads belongs to the rows above |

Under the table, write the points at which the whole suite runs. Beside each, write what it catches that the selected runs cannot: the merged state before a merge, a finished task, work joined from parallel changes, a schedule. A project that cannot name such a point has no backstop for its selections.
