# Templates: briefs, handoffs, resume notes, instruction files

## Delegation brief

```
Request (verbatim): <the owner's words, quoted, not paraphrased>
Objective:   <what to accomplish> - feeds: <the decision or next step>
Mode:        research only | implement (branch/worktree: <name>)
Starts:      fresh (gets this whole brief) | fork of this conversation
Context:     <what the worker must know; exact paths and line numbers>
Known / ruled out: <don't redo these>
In scope:    <...>
Out of scope: <...; handled by: <other worker>>
Decisions already made: <what must come out one way: names, formats, chosen trade-offs>
Consumes / produces: <files, names, formats at the seam with other workers>
Output:      <format, sections, length limit>
Stop when:   <definition of done / budget>
Constraints: <binding rules: no pushes, no new dependencies, offline tests, etc.>
Report back: <to whom, and what must be in the report: what changed, test results, deviations>
```

A brief pins what the worker cannot decide for itself. It does not contain the finished code, and a line that decides nothing ("make it robust", "as needed") is replaced by the decision or cut.

## Handoff note (end of a work block or session)

```
Goal:          <one line>
State:         done | partial | paused (waiting on: <exact input needed>)
Done:          - <step> -> evidence: <path / command run and its result / commit>
Files:         read: <...> | changed: <...>
Tried & failed: - <approach> -> why it failed
Open:          - <unresolved question or remaining step>
Do not redo:   - <expensive steps already complete>
Left non-default: - <flag, stopped service, moved file, workaround> -> how to put it back
Where state lives: <plan file / run folder / branch / commit>
Not verified:  - <what wasn't checked>
Next action:   <the single next step a fresh reader should take>
Received:      <with a live receiver: its restatement of Open and Next action>
```

Before sending, read the note as its reader will, with nothing else open. It should answer four questions: what was asked (in the requester's words), what was changed and where, what was decided and why, and what the next step is. The same four check a compaction summary. Every command in the note is one its writer ran; one recalled from memory is marked untested. With a live receiver the handoff ends when the receiver has said back what it now holds.

## Resume brief (regenerated; what cannot be derived is kept as a card)

A resume brief is derived from the primary state at the moment of resuming - the run folder, the plan file, the git log - not kept up to date by hand. It answers, in a few lines: what the task is, what stage it reached, what is pending and why, and exactly what input unblocks it. Regenerate it on demand; a stored copy goes stale.

What cannot be derived - the owner's exact words, a decision made in conversation, why an approach was dropped - is kept by hand, as a card and not a log: the current state, the single next step, and pointers to where the detail lives. Change it one entry at a time, and write a status ("sent", "asked") only after the act.

## Coordinating parallel sessions

```
Session A owns: <files / branch / long-running operation>
Session B owns: <...>
Shared, read-only for both: <...>
Integration: <who merges, in what order, with tests after each>
Ruled out (one shared, running list): <cause> - <how it was eliminated> - <by whom>
Destructive ops: <none without status check + owner confirmation>
Pushing/publishing: <owner-confirmed only>
```

## Instruction file (always loaded)

Every line is paid for on every session, so each one holds something that looking cannot find:

```
Decided elsewhere:    <decision> - <its reason> - <date> - <where it is recorded>
The code misleads:    <place> - <what it suggests, and what is true>
Finished work is checked with: <exact commands, each one run by the writer>
Slow, costly, dangerous: <operation> -> the cheaper or safer way: <...>
Facts about the code: <fact> - as of <date>, true at <commit>
Rules:                <what the owner requires or forbids, as imperatives>
```

Leave out the directory tour and anything a script can check (put that in the check). When a fact line and the code disagree, the code wins and the line gets fixed; a rule line is the owner's to change.

## Approved change set, parseable

Write review outcomes one item per line so they can be applied mechanically:

```
ITEM 01 | file: <path> | find: <exact text> | replace: <exact text> | approved: yes
ITEM 02 | file: <path> | action: delete-section <heading> | approved: yes
```

Apply with a script that reads the approved lines and fails loudly on any item that doesn't match exactly once - never by retyping the items.
