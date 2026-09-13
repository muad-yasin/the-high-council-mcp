# Dispatching an external stage to a subagent

v2 plan §3 (`~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md`). Optional -
a driving session with a clear context budget and nothing else going on can still author
an external stage inline, exactly as before this existed.

## When to use this

A run pauses at an external seat (`provider: "external"`) and writes `NEEDS-<stage>.md`
in the run folder with that stage's full system and user prompt - sometimes tens of
thousands of tokens, by design (see `README.md` / `CLAUDE.md` on the external-seat
arbitrage: that size is not a bug). Authoring the reply inline costs the driving
session's own context window that many tokens, every time, for the life of the run.

If the driving session is doing *only* this - one run, full attention - that cost is
fine and dispatch adds nothing. If the driving session is coordinating other work at
the same time, the external stage's prompt crowds out context needed for everything
else. That is when to dispatch.

## The pattern

```
1. Call prepare_stage_prompt(run, stage)
   -> writes runs/<run>/stage_prompt.md: a small, self-contained bundle -
      role, required sections, the task statement in full, and PATH REFERENCES
      to the run's larger context (NEEDS-<stage>.md, BOARD.md, the task's context
      dir) rather than that content inlined.

2. Fork a subagent. Give it ONLY the path to stage_prompt.md - nothing else from
   the driving session's own context.

3. The subagent reads stage_prompt.md, follows its "CONTEXT REFERENCES" section to
   read whatever it actually needs (including the full NEEDS-<stage>.md prompt),
   and writes its deliverable per the bundle's "return_instructions".

4. The driving session takes the subagent's returned deliverable text and calls
   submit_stage(run, stage, <that text>) exactly as it would for an inline answer.
   No change to submission - the harness cannot tell the difference between an
   inline answer and a dispatched one.
```

What moves is *whose context absorbs the large prompt*: a disposable subagent's, not
the driving session's own. The driving session's context only holds one tool call, one
file path, and the final deliverable text.

## What this does not change

- **Cost.** The subagent runs on the same Claude Code subscription as the driving
  session - not a separate metered account - so the external-seat arbitrage this
  project protects is completely untouched.
- **`submit_stage`'s contract.** Identical call, identical shape, whether the content
  came from inline authoring or a dispatched subagent.
- **Context document sizes.** `stage_prompt.md` references `NEEDS-<stage>.md`, `BOARD.md`
  and any task context by path; it does not shrink or summarise them. A subagent (or the
  driving session, undelegated) can still read them in full.

## What the harness itself never does

The harness has no subagent-spawning capability and this pattern does not give it one.
`prepare_stage_prompt` only writes a file; forking a subagent is the driving session's
own tooling (e.g. Claude Code's own Task/fork mechanism), used against a well-shaped
artifact the harness produced.
