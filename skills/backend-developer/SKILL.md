---
name: backend-developer
description: Applies backend engineering rules - contract-first design, state and persistence integrity, event ordering, error handling without silent fallbacks, traced numbers, a security baseline, and verification beyond "it compiles and the happy path ran". Use when a task touches server logic, a CLI's core behavior, data models, storage or migrations, background jobs, queues, external API integrations, data scripts or generators - including refactors and bug fixes - and as the review checklist before calling backend work done. Not for UI (frontend-developer) or deciding whether a feature should exist (task-scoping).
license: MIT
---

# Backend Developer

You build the logic layer under whatever calls it: a web API, a CLI, an MCP server, a background worker, a data script. Priorities in order: **correctness of the data model, then integrity of anything persisted, then convenience.** Never trade the first two for speed.

**A rule that only fixes one instance isn't finished - push it until it makes the bug class impossible.** (Ousterhout's strategic-over-tactical programming; in practice, *make illegal states unrepresentable*: a state storage cannot hold needs no migration, a value derived on read cannot drift, a dependency wireable only through one composition point cannot become a hidden direct reference.)

## Contract first

Before implementing a service, module or command, write its **contract**: public functions or endpoints, the events or messages it emits (with payload shapes), and the state it owns. A doc-comment header is enough. Design it against the consumer's real flow; it is what stops caller and implementation drifting apart and stops guessed field names on either side.

## Hard rules

1. **Logic is interface-agnostic and testable with nothing else running.** No request objects, DOM or rendering layer inside core logic. Strongest form: a package boundary or lint rule that makes the wrong dependency direction a build error.
2. **Configuration is data, not code.** Anything an operator might change without a redeploy is config with a documented default. Prefer **optional config with a built-in fallback**: missing config means "use the default," never a crash, and existing callers and tests keep working unchanged. Config never holds runtime state or a literal secret - secrets come from the environment or a secret store.
3. **No just-in-case fields or endpoints.** No state, parameter or column without a concrete near-term consumer. Generated code tends to pad and duplicate where a human would reuse (GitClear's 2025 vendor analysis, not peer-reviewed); looking complete is not a requirement.
4. **One source of truth; derive, don't duplicate.** A derived value cannot drift. The exception is data whose job is capturing a moment nothing else can reconstruct - a timestamp, an audit entry, elapsed time across a restart.
5. **Every piece of state has a tier, chosen on purpose:** persisted; runtime-only; or **re-rolled on restart as an accepted loss** (a randomized schedule position, a jitter window). The third tier says so in its doc comment so nobody "fixes" it into the schema - and the *guarantee* it served is rebuilt from persisted state on startup. Losing the roll is fine; losing the guarantee is a bug. Decide what happens on reset and on corrupt data for every new piece of state.
6. **Loose coupling through one composition point.** Components raise events or return results; they never call each other's internals. Cross-component reactions live in one wiring or bootstrap module you can read top to bottom.
7. **Never assume initialization or listener order.** A consumer needing another component's current state fetches it at first real use. Anything emitted during startup has fired before a late subscriber arrives - pair it with a one-shot "sync now" call right after subscribing. **Make the ordering assumption explicit at the line that enforces it** (an ordered call, a poll, an assertion). "Subscribe earlier" and "add a null check" are the tempting non-fixes. If you can't point at the line, it isn't done.
8. **Emit only after committing the state the event describes - and every entry point to the same fact runs the same bookkeeping.** An event raised before the write hands subscribers stale data (one real case produced a 100%-reproducible lockout). When a fact can become true two ways (the normal path and a webhook, replay or "external notify" path), diff their side effects before shipping either.
9. **Nothing can hard-lock itself.** Every failure or terminal state (a rejected request, maxed retries, a stuck job) has a real exit - retry, override, expiry. Verify it exists.
10. **Randomness and time are injectable** - a clock or RNG instance, or one seam. Anything checked against an expected value is only verifiable if its inputs are controllable; unseeded is unverifiable by construction.
11. **A stricter entry point is a thin wrapper that adds the policy and delegates** - never a behavior change to the permissive original others depend on. A wrapper that only renames hides nothing; delete it. One implementation is a hypothetical seam; two is a real one.
12. **A design-level asymmetry found mid-change doesn't have to be fixed by that change.** Record it with a name; rebalance later with existing knobs. Never bake a special case into the change that surfaced it.
13. **Every number carries its derivation** in a comment; a value with no trace is presumed invented. **Derive against a self-contained anchor**, never another component's unbuilt ceiling (the ~60x error: generator reference). Two tunables that could drift get two names and a decoupling test.
14. **Every hard gate or filter is paired with a loud check on the output invariant it could break.** Gates fail by producing nothing: a tightened eligibility check once rejected every candidate and silently split a generated graph in half. State the invariant, **floors and ceilings both** - connectivity, minimum count, coverage, and a size or count budget measured against a known control - and make its violation a hard error: a run that blows a budget fails like one that produces nothing. When a gate cuts a count below target, **prefer fewer correct instances over loosening the gate**, and record which knobs would raise it.
15. **Throttle cross-component polls and repeated external calls out of hot loops** - and sweep every similar loop in the same pass, recording the negative results too (an unrecorded clearance gets re-investigated).
16. **Every swallowed exception, null/default/empty error return and silent fallback is a presumptive defect until a comment justifies it.** Code that keeps the surface appearance of working while doing nothing passes casual review. Where silence is right, say why at the site; otherwise fail loudly - and fail *closed*: an exception on a security or policy path denies, never allows.
17. **The script is the artifact; session state is lost.** Migrations, bulk edits, data fixes and generation runs are committed, deterministic, re-runnable code - never a sequence of interactive commands nobody can replay. Destructive operations run only against an **explicit, enumerated target list confirmed against live state first**. Write against the installed version's docs or source and feed real error output back, rather than recalling an API from memory.
18. **Every quantity crossing a boundary carries its unit and reference frame in its type or name** - metres or engine units, world or local or origin-shifted coordinates, UTC or local time, per second or per day. A comparison across frames is a defect a type or an assertion should catch; the textbook case is the 1999 Mars Climate Orbiter loss. **A feature whose trigger count stays at zero through a run where it should fire is a failure, not a quiet run:** one feature never fired because two positions in different frames were compared, and its log said "0 shown" through two builds before anyone read it. Assert the count; do not leave it in a log.

## Security baseline

The floor every change meets, not a security review. Each rule in full, with figures and sources: `references/security-and-evidence.md`.

- Authorize every request on the server, per object, not just per route; allow-list any URL the server fetches.
- Treat all input as data: parameterized queries, no string-built shell or SQL, output encoded for its context, schemas validated at the boundary.
- Verify that a new dependency exists and is the one you meant (models suggest package names that don't exist, and attackers register them); pin it.
- Read the licence of third-party data, models and assets for the intended use before ingesting.
- Ship no debug or default configuration.
- Keep secrets out of code, config literals, logs, error messages, URLs and test fixtures.
- Errors to callers are generic and structured; detail and security-relevant events go to logs.
- Every external call has a timeout and a defined failure behavior; a write that may be retried is idempotent.

## Persistence integrity - run exactly when anything persistent changes shape

- **Version the schema or format; migrate stepwise** (vN to vN+1, new fields get defaults), never one big-bang converter.
- **Atomic writes:** write a temp file, flush it to disk, rename over the target, then sync the directory; keep a last-good backup the loader can fall back to; a corrupt file loads as a recoverable "no data," not a throw. Rename-over is not atomic on every platform: know your target.
- **Golden fixtures prove compatibility; a careful read-through does not.** Freeze one real example per meaningful state at the current version and load each in a test.
- **Round-trip and count:** after a save, an export or a migration, load the result and compare its counts with the source - a serializer can succeed and drop items.
- **Decide tamper-resistance once, against the real trust model, and say why.** A local single-user file needs none; anything shared, multi-tenant or economically meaningful needs server-side validation. Reflexive checksums only complicate recovery.

## Verification traps - each looked like success

- **A success log is not evidence the new code ran.** With a broken or unfinished build, tooling often runs the last good build and reports normal success. Confirm a clean build, then check the **output artifact** for a value only the new code writes.
- **A changed default never reaches already-serialized data.** Read the live stored value back.
- **A registry kept in data (a content list, a seed file, a table) is invisible to unit tests** - check each new entry actually landed.
- **Instrument before tuning a threshold.** One rejection counter showed a single gate eating 93% of candidates after three blind tune-and-rerun loops had failed.
- **Judge a change by its worst segment, not its average.** A quota, credit or reward system can balance in total while every individual session ends in the red; a fix can make the common case fivefold better and a rarer category much worse. Re-measure the whole output split by category and report the worst.

## Testing discipline

- **Every fix gets two checks:** the failure no longer happens, and the intended use still works - a guard that also blocks the good input passes the first alone (`verification-and-critique`, item 9). When decoupling two behaviors, a regression test proves the old one is unaffected.
- **If the third fix in a row uncovers yet another problem somewhere else, stop patching and question the design:** a fault that keeps moving sits in the structure.
- **Find every real call site of a changed contract with the compiler, a type checker or find-references** - never recall. Missed callers grow with the size of the change.
- **A mistake shipped twice earns a mechanical guard** (a lint rule, a source-scanning test). Enumerate the paraphrases the bug could take first - a guard with a synonym hole is confidence without coverage.
- **Generated output is validated by invariants over golden seeds plus fresh random seeds** each run; never by eyeballing alone.
- **A skipped check is not a pass.** A test that skips for a missing environment variable, file or key reports SKIP, and a required check that skipped fails the run - a suite once counted real-data checks as passed because they skipped silently without their environment. Name which checks are required and have the runner print the skip count. A file that never loaded is an unreported skip: print per-file results and count them.
- **A failure that passes on a re-run is a failure with its cause open** (timing, order, shared state), recorded as one.
- **A check is evidence only if it can fail.** Run it once against a known-bad input before trusting a pass; a check whose result is guaranteed by how the thing was built (a test that a smoothed surface bends only where its grid lines are, which it must) is a tautology that reads as confirmation. The general rule is `verification-and-critique`'s, Part 1: "Before trusting a check, ask whether it could have come out the other way".

## Mistakes to flag

- Implementation before the contract; a constant with no derivation.
- Persistent state added without the checklist, or duplicating something derivable; re-rollable state promoted into the schema.
- A failure state that can strand a caller or job.
- Components calling each other's internals; a startup event with no one-shot sync; an ordering assumption with no enforcing line.
- An event emitted before its state is committed; two entry points with different bookkeeping.
- A swallowed exception or silent fallback with no justifying comment; a policy path that fails open.
- A gate with no loud check on the invariant it could break; an invariant with a floor and no ceiling.
- A quantity compared across units or reference frames; a feature whose trigger count was zero in a run that should have fired it, left in a log.
- A skipped check counted as a pass; a test that cannot fail offered as proof; a red turned green by a re-run; a test file that never loaded.
- A fix checked only for the failure it removes.
- A rule change judged only at the site that prompted it, or a fix judged by its average instead of its worst category.
- A pass-through wrapper; an interface with one implementation.
- A bare global clock or RNG in logic that must be verifiable.
- A missing server-side authorization check; string-built queries; an unverified new dependency; third-party data or assets ingested with the licence unread; debug or default configuration in a deployed build; a secret in a log or fixture.
- A destructive operation aimed at a pattern instead of a confirmed list.
- "It ran successfully" offered without the artifact read back.

References: `references/verification-and-review.md` (definition of done, review), `references/security-and-evidence.md` (baseline in full, figures), `references/generated-data-and-simulation.md` (generators, simulation).
