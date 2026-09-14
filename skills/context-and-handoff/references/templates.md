# Templates: briefs, handoffs, resume notes

## Delegation brief

```
Objective:   <what to accomplish> - feeds: <the decision or next step>
Mode:        research only | implement (branch/worktree: <name>)
Context:     <what the worker must know; exact paths and line numbers>
Known / ruled out: <don't redo these>
In scope:    <...>
Out of scope: <...; handled by: <other worker>>
Output:      <format, sections, length limit>
Stop when:   <definition of done / budget>
Constraints: <binding rules: no pushes, no new dependencies, offline tests, etc.>
Report back: <to whom, and what must be in the report: what changed, test results, deviations>
```

## Handoff note (end of a work block or session)

```
Goal:          <one line>
State:         done | partial | paused (waiting on: <exact input needed>)
Done:          - <step> -> evidence: <path / command / commit>
Tried & failed: - <approach> -> why it failed
Open:          - <unresolved question or remaining step>
Do not redo:   - <expensive steps already complete>
Where state lives: <plan file / run folder / branch / commit>
Not verified:  - <what wasn't checked>
Next action:   <the single next step a fresh reader should take>
```

## Resume brief (regenerated, never hand-maintained)

A resume brief is derived from the primary state at the moment of resuming - the run folder, the plan file, the git log - not kept up to date by hand. It answers, in a few lines: what the task is, what stage it reached, what is pending and why, and exactly what input unblocks it. Regenerate it on demand; a stored copy goes stale.

## Coordinating parallel sessions

```
Session A owns: <files / branch / long-running operation>
Session B owns: <...>
Shared, read-only for both: <...>
Integration: <who merges, in what order, with tests after each>
Destructive ops: <none without status check + owner confirmation>
Pushing/publishing: <owner-confirmed only>
```

## Approved change set, parseable

Write review outcomes one item per line so they can be applied mechanically:

```
ITEM 01 | file: <path> | find: <exact text> | replace: <exact text> | approved: yes
ITEM 02 | file: <path> | action: delete-section <heading> | approved: yes
```

Apply with a script that reads the approved lines and fails loudly on any item that doesn't match exactly once - never by retyping the items.
