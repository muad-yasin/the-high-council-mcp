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
3. **No just-in-case fields or endpoints.** No state, parameter or column without a concrete near-term consumer. Generated code tends to pad and duplicate where a human would reuse (industry measurements of AI-assisted code show copy-pasted lines rising sharply); looking complete is not a requirement.
4. **One source of truth; derive, don't duplicate.** A derived value cannot drift. The exception is data whose job is capturing a moment nothing else can reconstruct - a timestamp, an audit entry, elapsed time across a restart.
5. **Every piece of state has a tier, chosen on purpose:** persisted; runtime-only; or **re-rolled on restart as an accepted loss** (a randomized schedule position, a jitter window). The third tier says so in its doc comment so nobody "fixes" it into the schema - and the *guarantee* it served is rebuilt from persisted state on startup. Losing the roll is fine; losing the guarantee is a bug. Decide what happens on reset and on corrupt data for every new piece of state.
6. **Loose coupling through one composition point.** Components raise events or return results; they never call each other's internals. Cross-component reactions live in one wiring or bootstrap module you can read top to bottom.
7. **Never assume initialization or listener order.** A consumer needing another component's current state fetches it at first real use. Anything emitted during startup has fired before a late subscriber arrives - pair it with a one-shot "sync now" call right after subscribing. **Make the ordering assumption explicit at the line that enforces it** (an ordered call, a poll, an assertion). "Subscribe earlier" and "add a null check" are the tempting non-fixes. If you can't point at the line, it isn't done.
8. **Emit only after committing the state the event describes - and every entry point to the same fact runs the same bookkeeping.** An event raised before the write hands subscribers stale data (one real case produced a 100%-reproducible lockout). When a fact can become true two ways (the normal path and a webhook, replay or "external notify" path), diff their side effects before shipping either.
9. **Nothing can hard-lock itself.** Every failure or terminal state (a rejected request, maxed retries, a stuck job) has a real exit - retry, override, expiry. Verify it exists.
10. **Randomness and time are injectable** - a clock or RNG instance, or one seam. Anything checked against an expected value is only verifiable if its inputs are controllable; unseeded is unverifiable by construction.
11. **A stricter entry point is a thin wrapper that adds the policy and delegates** - never a behavior change to the permissive original others depend on. A wrapper that only renames hides nothing; delete it. One implementation is a hypothetical seam; two is a real one.
12. **A design-level asymmetry found mid-change doesn't have to be fixed by that change.** Record it with a name; rebalance later with existing knobs. Never bake a special case into the change that surfaced it.
13. **Every number carries its derivation** in a comment; a value with no trace is presumed invented. **Derive against a self-contained anchor**, never another component's unbuilt ceiling (a ~60x error shipped in a draft that derived a gate from a ceiling reachable only after spending far more than the gate protected). Two tunables that could drift get two names and a decoupling test.
14. **Every hard gate or filter is paired with a loud check on the output invariant it could break.** Gates fail by producing nothing: a tightened eligibility check once rejected every candidate and silently split a generated graph in half. State the invariant (connectivity, minimum count, coverage) and make its violation a hard error. When a gate cuts a count below target, **prefer fewer correct instances over loosening the gate**, and record which knobs would raise it.
15. **Throttle cross-component polls and repeated external calls out of hot loops** - and sweep every similar loop in the same pass, recording the negative results too (an unrecorded clearance gets re-investigated).
16. **Every swallowed exception, null/default/empty error return and silent fallback is a presumptive defect until a comment justifies it.** Studies of generated code find missing checks and error handling to be the dominant robustness gap, and code that keeps the surface appearance of working while doing nothing passes casual review. Where silence is right, say why at the site; otherwise fail loudly - and fail *closed*: an exception on a security or policy path denies, never allows (OWASP Top 10:2025 now lists mishandled exceptional conditions as its own category).
17. **The script is the artifact; session state is lost.** Migrations, bulk edits, data fixes and generation runs are committed, deterministic, re-runnable code - never a sequence of interactive commands nobody can replay. Destructive operations run only against an **explicit, enumerated target list confirmed against live state first**. Write against the installed version's docs or source and feed real error output back, rather than recalling an API from memory.

## Security baseline

Not a substitute for a security review; the floor every change meets. Categories follow the OWASP Top 10:2025.

- **Authorize every request on the server**, per object, not just per route; the client's view of what a user may do is a hint, not a control (broken access control, including SSRF: validate and allow-list any URL the server fetches).
- **Treat all input as data.** Parameterized queries, no string-built shell or SQL, output encoded for its context, schemas validated at the boundary.
- **Verify every new dependency exists and is the one you meant** before installing it - code models regularly suggest package names that don't exist (a USENIX Security 2025 study measured this across 16 models), and attackers register those names. Pin versions with a lockfile; review what a new dependency pulls in.
- **Secrets never appear** in code, config literals, logs, error messages, URLs or test fixtures.
- **Errors to callers are generic and structured** (for HTTP APIs, RFC 9457 problem details); detail goes to logs, never the stack trace to the client. Log security-relevant events so an incident can be reconstructed.
- **Every external call has a timeout and a defined failure behavior**; a write that may be retried carries an idempotency key or is naturally idempotent.

## Persistence integrity - run exactly when anything persistent changes shape

- **Version the schema or format; migrate stepwise** (vN to vN+1, new fields get defaults), never one big-bang converter.
- **Atomic writes:** write a temp file, flush it to disk, rename over the target, then sync the directory; keep a last-good backup the loader can fall back to; a corrupt file loads as a recoverable "no data," not a throw. Rename-over-existing is atomic on POSIX but not guaranteed on every platform (Windows replace APIs make no atomicity promise) - know your target.
- **Golden fixtures prove compatibility; a careful read-through does not.** Freeze one real example per meaningful state at the current version and load each in a test.
- **Decide tamper-resistance once, against the real trust model, and say why.** A local single-user file needs none; anything shared, multi-tenant or economically meaningful needs server-side validation. Reflexive checksums only complicate recovery.

## Verification traps - each looked like success

- **A success log is not evidence the new code ran.** With a broken or unfinished build, tooling often runs the last good build and reports normal success. Confirm a clean build, then check the **output artifact** for a value only the new code writes.
- **A changed default never reaches already-serialized data.** Read the live stored value back.
- **A registry kept in data (a content list, a seed file, a table) is invisible to unit tests** - check each new entry actually landed.
- **Instrument before tuning a threshold.** One rejection counter showed a single gate eating 93% of candidates after three blind tune-and-rerun loops had failed.
- **Simulate per-user, per-session net flow, not just the aggregate.** A quota, credit or reward system can balance in total while every individual session ends in the red.

## Testing discipline

- When decoupling two behaviors, a regression test proves the old one is unaffected.
- **Find every real call site of a changed contract with the compiler, a type checker or find-references** - never recall. Missed callers grow with the size of the change.
- **A mistake shipped twice earns a mechanical guard** (a lint rule, a source-scanning test). Enumerate the paraphrases the bug could take first - a guard with a synonym hole is confidence without coverage.
- **Generated output is validated by invariants over golden seeds plus fresh random seeds** each run; never by eyeballing alone.

## Definition of done

- [ ] Contract written (functions/endpoints, events + payloads, owned state)
- [ ] Logic testable with no interface, server or external service running
- [ ] Config has real defaults; no speculative fields; every number traced
- [ ] Security baseline met for anything touching input, auth, dependencies or secrets
- [ ] Persistence checklist run if anything persistent changed shape
- [ ] Every call site of a changed contract found by tooling
- [ ] Output artifacts and stored values read back, not trusted from a log
- [ ] Non-obvious design choices briefly explained

## Mistakes to flag

- Implementation before the contract; a constant with no derivation.
- Persistent state added without the checklist, or duplicating something derivable; re-rollable state promoted into the schema.
- A failure state that can strand a caller or job.
- Components calling each other's internals; a startup event with no one-shot sync; an ordering assumption with no enforcing line.
- An event emitted before its state is committed; two entry points with different bookkeeping.
- A swallowed exception or silent fallback with no justifying comment; a policy path that fails open.
- A gate with no loud check on the invariant it could break.
- A pass-through wrapper; an interface with one implementation.
- A bare global clock or RNG in logic that must be verifiable.
- A missing server-side authorization check; string-built queries; an unverified new dependency; a secret in a log or fixture.
- A destructive operation aimed at a pattern instead of a confirmed list.
- "It ran successfully" offered without the artifact read back.

Further depth: `references/verification-and-review.md` (verifying and reviewing backend work), `references/generated-data-and-simulation.md` (generators, derived numbers, offline simulation, instruments that judge code past compile-and-pass).
