# Verifying backend work, and reviewing someone else's

## You cannot self-certify correctness from "it compiles and the happy path ran"

A green build and one successful manual run are evidence the code runs, not that it's correct. Four gaps generation is measurably bad at closing on its own:

- **Error paths.** The happy path gets exercised by a quick manual check; the error path (bad input, a downstream timeout, a partial write) usually doesn't, and it's exactly where silent-failure defects hide (SKILL.md rule 16).
- **Concurrent/interleaved behavior.** A test that runs one request at a time won't catch a race between two writers, a double-submit, or a job that isn't actually idempotent. If a code path can run more than once for the same logical event (a retried webhook, a re-queued job, a double click on a real endpoint), it needs an explicit idempotency key or a test that fires it twice.
- **Scale/shape of real data.** A three-row fixture won't show an N+1 query, a pagination bug, or a timeout on a payload ten times larger than what was hand-tested.
- **Ambiguously-graded tasks invite shortcuts.** On a vague "make it work," the cheapest passing signal is the tempting one: a test edited to match the output, a hardcoded expected value, a check that asserts "no exception thrown" and nothing else. Independent benchmarks of coding agents have observed exactly this (overwriting tests, hardcoding outputs, rationalizing the shortcut). **Never let the same agent both write the check and certify the result without a second look**, and state plainly what was *not* verified.

## Verification traps, in detail

Each of these produced a "success" that was not one.

- **The stale-build run.** Tooling invoked while the project has compile errors - or while a rebuild simply hasn't finished - runs the *last good* build and reports normal success. It has bitten in several distinct ways on one project: generated artifacts rebuilt from old code twice in one milestone; a recurrence that survived an "is anything running, is the console empty" check and was only caught by reading the generated file; and two concurrent sessions sharing one environment, where one session's in-progress errors made the other session's generation runs silently execute pre-fix code and produce identical output. **Rule:** confirm a clean, fresh build before any long operation; afterward, verify the output on disk.
- **Verify a long operation by its output artifact, never its log.** Grep the produced file for a value only the new code writes, compare its timestamp against a marker, or read the changed field back. Two separate failure modes make the log lie: the stale-build run above, and **partial-write staleness** - a tool that legitimately ran but, by design, never touches certain fields (a "copy into existing record" path that preserves hand-tuned values), so a code default change "regenerates successfully" while the stored value stays old. When a copy tool skips fields by design, say so in a comment at the copy site.
- **Serialized data keeps its old defaults.** Changing a field's default in code updates new records only. Every existing record, fixture, and config file keeps the value it was written with. Read the real stored value back after any default change.
- **Registries outside the test's view.** A list of entries wired into a data file, a scene, a seed script, or a database table is invisible to unit tests and to a plan review. On one project a new entry silently failed to land twice in a row (a new content type showed up as "unknown" at runtime). Every addition gets an explicit live check that it is actually in the list - and even when a sync tool automates the wiring, verify the stored list, never the tool's success message.
- **A completion claim names how it counted.** "All 11 updated" needs the command that produced 11. A check that silently under-counted (reporting 8 of a real 11) was once acted on as complete.

## Reviewing someone else's backend diff

A checklist worth running as a real pass, not a skim:

- Does every new piece of persistent state have an owner, a tier (persisted / runtime / re-rolled-on-restart), and documented reset/migration behavior?
- Does every new external call (HTTP, DB, queue) have a timeout and a defined behavior on failure - retry, fail loudly, or a documented fallback?
- Is every changed function's full set of real callers accounted for, not just the ones in the diff?
- Is there a comment at every swallowed exception or silent fallback explaining why the silence is correct?
- Does anything emit an event/webhook before the state it describes is committed? Do two entry points to the same fact do different bookkeeping?
- Does every new constant trace its derivation?
- Is any secret, token, or credential present as a literal anywhere, including a test fixture or a log statement?

## A structural review pass, before calling work done

Cheap, needs no tooling:

- **Does any branch rely on a silent fallback to paper over an unclear invariant?** Make the boundary explicit instead.
- **Can related updates leave state half-applied?** Push toward a more atomic structure - the atomic-write rule and emit-after-commit are the same shape at two scales.
- **Is feature-specific logic leaking into a general-purpose module, or is a one-off boolean mode complicating shared control flow?**
- **The deletion test:** what would be lost if this module were deleted? A thin pass-through loses nothing. A deep module - small interface, large hidden implementation - is the target shape.
- **Could a whole branch or layer be deleted rather than polished?**
- **Prefer a few high-conviction findings over a long list of nits.** Where something is genuinely fine, say "fine - no action" rather than manufacturing a concern to look thorough.

## Applying an approved change set

When a review produces an itemized, approved list of changes, **apply it by parsing the approved file programmatically, never by retyping items into edits by hand.** The review artifact is the contract; parsing it gives zero transcription drift. On one project a parsed application landed 57 edits losslessly, while a hand-batched sweep's single regression was only caught by a mechanical re-check. Corollary: write review artifacts in a parseable per-item format in the first place.

## Don't describe instruments that aren't installed

Never claim a check, test type, or tool as "current practice" unless it is actually wired into the project's suite. Describing an instrument that doesn't run as if it does is a silent-failure defect in prose instead of code. Proposals for new instruments, with honest costs, are in `generated-data-and-simulation.md`.
