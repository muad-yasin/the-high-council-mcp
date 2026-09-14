# Verifying backend work, and reviewing someone else's

## You cannot self-certify correctness from "it compiles and the happy path ran"

A green build and one successful manual run are evidence the code runs, not that it's correct. Three gaps generation is measurably bad at closing on its own:

- **Error paths.** The happy path gets exercised by a quick manual check; the error path (bad input, a downstream timeout, a partial write) usually doesn't, and it's exactly where silent-failure defects hide (see the main SKILL.md's rule 14).
- **Concurrent/interleaved behavior.** A test that runs one request at a time won't catch a race between two writers, a double-submit, or a job that isn't actually idempotent. If a code path can run more than once for the same logical event (a retried webhook, a re-queued job, a double-click hitting a real endpoint), it needs an explicit idempotency key or a test that fires it twice.
- **Scale/shape of real data.** A test fixture with three rows won't show an N+1 query, a pagination bug, or a timeout on a payload ten times larger than what was hand-tested. Where possible, test against something closer to the real data's shape and size, not just its structure.

## Reviewing someone else's backend diff

A short checklist worth running as a real pass, not a skim:

- Does every new piece of persistent state have an owner and a documented reset/migration behavior?
- Does every new external call (HTTP, DB, queue) have a timeout and a defined behavior on failure - retry, fail loudly, or a documented fallback?
- Is every changed function's full set of real callers accounted for, not just the ones in the diff?
- Is there a comment at every swallowed exception or silent fallback explaining why the silence is correct?
- Does anything emit an event/webhook before the state it describes is actually committed?
- Is any secret, token, or credential present as a literal anywhere in the diff, including in a test fixture or a log statement?

## Instruments worth knowing about, with honest costs

- **Contract/schema tests** (e.g. JSON Schema, OpenAPI validation, protobuf compatibility checks) catch drift between what a service promises and what it actually returns - cheap to add once the contract is written down, and the contract-first rule in SKILL.md is what makes them possible at all.
- **Property-based testing** (generate many random inputs against an invariant, rather than hand-picking examples) is strong for pure logic with a checkable invariant (a sort is still sorted, a round-trip encode/decode returns the original) and weak for anything whose correctness depends on external state.
- **Golden-fixture tests** (freeze a real example, assert it still produces the same/compatible output) are the only reliable way to prove a migration or a format change is backward-compatible - a read-through of the migration code is not a substitute, because the failure mode is exactly the kind of edge case a read-through misses.

Don't claim any of these as "current practice" in a project unless it's actually wired into that project's test suite - describing an instrument that isn't installed as if it already runs is its own kind of silent-failure defect, just in prose instead of code.
