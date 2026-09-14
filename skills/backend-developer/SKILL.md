---
name: backend-developer
description: General backend engineering rules - API/service design, state and persistence, concurrency, error handling, derived numbers, generated data, and the verification discipline logic code needs beyond "it compiles and the happy path ran." Use whenever a task touches server logic, a CLI's core behavior, data models, storage/migration, background jobs, queues, integrations with external APIs, scripts that transform data, generators, or any non-UI code - including refactors and bug fixes, even if the request doesn't name a "backend" explicitly. Also the review checklist before calling backend work done. Not for UI, views, or anything a person looks at directly - that is frontend-developer's. Not for deciding whether a feature should exist - that is planning-and-scoping's.
---

# Backend Developer

You build the logic layer underneath whatever interface calls it: a web API, a CLI, an MCP server, a background worker, a data script. Priorities in order: **correctness of the data model, then integrity of anything persisted, then convenience.** Never trade the first two for speed.

**The register these rules are written in is deliberate, and new ones should match it: a rule that only describes fixing one instance isn't finished - push it until it describes making the whole bug class impossible.** (Ousterhout's tactical-vs-strategic programming; in practice, *make illegal states unrepresentable* - a state your storage cannot hold needs no migration, a value derived on read cannot drift, a dependency wireable only through one composition point cannot become a hidden direct reference.)

## Contract-first rule

Before implementing a service, module, or command, write its **contract**: the public functions/endpoints, the events or messages it emits (with payload shapes), and the state it owns. A short markdown block or a doc-comment header is enough. This is what callers code against - writing it down is what stops caller and implementation drifting apart, and stops guessed field names on either side. Design it against the consumer's real flow, never in isolation.

## Hard rules

1. **Logic is interface-agnostic and testable with nothing else running.** No reaching into a request object, a DOM, or a rendering layer from inside core logic. The strongest version is a structural boundary - a package, module, or lint rule that makes the dependency direction a build error rather than a convention.
2. **Configuration is data, not code.** If an operator or a later session might change it without a redeploy, it's a config value with a documented default. Prefer **optional config with a built-in fallback** over a required parameter: missing config means "use the default," never a crash - and every existing caller, including tests, keeps working with zero signature churn when the config is introduced. Config is never where runtime state lives. Never let a secret live in config as a literal - env var or secret store, always.
3. **No just-in-case fields or endpoints.** No state, parameter, or column without a concrete near-term consumer; a field justified only by a parked, unscheduled feature stays out until that feature has a scheduled consumer. This runs against a measured LLM bias: generated code pads and duplicates where a human would reuse, because looking complete scores well.
4. **One source of truth; derive, don't duplicate.** Prefer deriving a value on read over storing a redundant copy - a derived value can't drift. The deliberate exception is data whose *job* is capturing a moment nothing else can reconstruct (a timestamp, an audit entry, elapsed wall-clock time across a restart) - that earns a persisted field precisely because it is not derivable.
5. **Every piece of state belongs to one of three tiers, chosen on purpose.** Persisted; runtime-only; or **re-rolled on restart as an accepted loss** (a randomized schedule position, a jitter window). The third tier must say so in its doc comment, so nobody "fixes" it into the schema - and the *guarantee* it served must still be rebuilt from persisted state on startup. Losing the roll is fine; losing the guarantee is a bug. For every new piece of state, decide what happens on reset and on corrupt data - never default silently.
6. **Loose coupling through one composition point.** A component raises events or returns results; it never calls another component's internals. When two independent things must react to each other, the reaction lives in one wiring/bootstrap/orchestrator module - so every real coupling is listed in one place you can read top to bottom.
7. **Don't assume initialization or listener order, and don't assume a listener exists when an event fires.** A consumer needing another component's *current* state fetches it once at first real use. Anything emitted during startup has already fired before a late subscriber arrives - pair it with an explicit one-shot "sync now" call right after subscribing. **Make the ordering assumption explicit at the line that enforces it** - an ordered call, a poll, an assertion. This is logical ordering, not a race, and it is the reasoning generation is measurably worst at: it reaches for "subscribe earlier" or "add a null check" instead of naming the schedule guarantee. If you can't point at the line, it isn't done.
8. **Emit only after committing the state the event describes - and every entry point to the same fact runs the same bookkeeping.** A subscriber gets one guaranteed read; an event raised before the write hands it stale data (a real version of this produced a 100%-reproducible lockout). When a fact can become true two ways (the normal path and an "external notify"/webhook/replay path), diff their side effects before shipping either - one path skipping bookkeeping stays latent until the first caller that uses it.
9. **Nothing can hard-lock itself with no route forward.** Every new failure or terminal state (a rejected request, a maxed-out retry, a stuck job) needs a real exit - retry, override, expiry. Verify it exists.
10. **Randomness and time are injectable.** Accept a clock or RNG instance, or isolate every call behind one seam. Determinism is a correctness property, not just a test convenience: anything checked against an expected value - a schedule, an elapsed-time calculation, a generator - is only verifiable if its inputs are controllable. Unseeded is unverifiable by construction.
11. **A stricter entry point is a thin wrapper that adds the policy and then delegates - never a behavior change to the permissive original that other callers depend on.** The wrapper earns its existence by *adding a policy*; a pass-through that only renames hides nothing - delete it. Same test for abstraction: one implementation is a hypothetical seam, two is a real one.
12. **A design-level asymmetry, once found, doesn't have to be fixed by the change that found it.** Record it with a name; rebalance later with knobs that already exist. Never bake a special case into the change that happened to surface it.
13. **Every number carries its derivation.** A constant, threshold, rate, or limit gets a comment tracing where it came from - a value with no trace is presumed invented, which is the default shape of generated numeric code. **Derive against a self-contained anchor, never against a moving target owned by another component's not-yet-built shape** (a real ~60x error shipped in a draft that derived a gate from a ceiling reachable only after spending far more than the gate protected). If two tunables could drift apart when only one changes, name them separately and prove the decoupling with a test.
14. **Every hard gate or filter is paired with a loud check on the output invariant it could break.** Gates fail silently by producing nothing: a tightened eligibility check once rejected every candidate, produced zero connecting features, and silently split a generated graph in half. State the invariant (connectivity, minimum count, coverage) and make its violation impossible to ship silently - a hard error or an aborted run. **When a gate cuts a count below target, prefer fewer correct instances over loosening the gate**, and record which knobs would raise it later.
15. **Throttle cross-component polls and repeated external calls out of hot loops** - and when you find one, sweep every similar loop in the same pass and record the negative results too (an unrecorded clearance gets re-investigated and paid for twice).
16. **Every swallowed exception, every error path returning null/default/empty, and every silent fallback is a presumptive defect until a comment justifies the silence.** The AI-authored failure mode with the strongest evidence: generated code keeps the surface appearance of working while quietly doing nothing, and review isn't calibrated for it. Where silence is right (a documented recovery path behind it), say why at the site; where it isn't, fail loudly or don't catch.
17. **The script is the artifact; session state is lost.** Migrations, bulk edits, data fixes and generation runs are authored as committed, deterministic, re-runnable code - never as a sequence of one-off interactive commands nobody can replay. Destructive operations run only against an **explicit, enumerated target list confirmed against live state first**, never a pattern or "everything matching." Pin the tool/API version you are writing against in the task context and feed real error output back rather than recalling an API from memory - version-drift recall is a named failure.

## Persistence integrity - low-freedom checklist

Run this exactly whenever anything persistent (a schema, a file format, an event/message shape consumed elsewhere) changes.

- **Version the schema/format; migrate stepwise-forward** (vN to vN+1, each step giving new fields sensible defaults), never one big-bang converter across versions.
- **Atomic writes**: temp-then-rename, keep a last-good backup the loader can fall back to, and have the loader return a recoverable "no data" rather than throw on a corrupt file. Know your platform's durability guarantees - a rename is not always atomic or durable across a crash without syncing the file and its directory, and is not atomic over an existing file on every OS.
- **Golden fixtures prove compatibility - nothing else does, and reading the migration carefully is not a substitute.** Freeze one real example per meaningful state at the current version and load each in a test. "Does this migration work" is answered by a fixture that fails, never by a read-through.
- **Decide tamper-resistance once, against the real trust model, and say why.** A locally-editable single-user file needs none; anything shared, multi-tenant, or economically meaningful needs real server-side validation. Don't add checksums or obfuscation reflexively - that only complicates recovery.

## Verification traps - each bit a real project, each looks like success

Detail and incidents: `references/verification-and-review.md`.

- **A tool's success log is not evidence the new code ran.** With a broken or unfinished build, tooling often runs the last successfully compiled version and reports normal success. Confirm a clean fresh build first; afterward verify the **output artifact itself** - grep it for a value only the new code writes. A tool can also legitimately skip fields by design, so a "successful" regeneration can leave the old value in place.
- **A code default change never reaches already-serialized data.** Every existing record and config file keeps its old value. After changing a default, read the live stored value back before trusting a verification pass.
- **A registry held in data outside the test suite's view needs its own live check.** A list of content entries wired in a data file, scene, or database is invisible to both unit tests and a plan review; a new entry needs an explicit check that it actually landed.
- **Instrument before iterating on any threshold.** Add cheap counters per gate and a sampled distribution of the real data first, then tune against the numbers. Three blind tune-and-rerun loops once failed where one rejection counter immediately showed a single gate eating 93% of candidates.
- **Simulate the per-user, per-session net flow, not just the aggregate.** A quota, credit, billing, or reward system can balance in total while every individual session ends in the red. Model it forward offline before waiting for live data.

## Testing discipline

- **When decoupling two previously-coupled behaviors, write a regression test proving the old one is unaffected** - the test is the proof, not the code shape.
- **Audit every real call site before changing a shared contract - with the compiler, a type checker, or find-references, never with recall.** Missed callers are a measured weakness of generated refactors, and it worsens as the change grows.
- **A mistake that has shipped twice earns a mechanical guard** (a lint rule, a source-scanning test), not a reminder. Enumerate the paraphrases the bug could take before writing the pattern - a guard with a synonym hole hands you confidence without coverage.
- **Generated or procedural output is validated by asserting invariants over a few golden seeds plus a few random seeds per run** - goldens catch regressions deterministically, random seeds catch what the goldens missed. Never eyeballing alone.

## Definition of done, per backend task

- Contract written (functions/endpoints, events + payloads, owned state)
- Logic testable with no interface, server, or external service running
- Config exposed with real defaults; no speculative fields; every number traced
- Events/results emitted for anything a caller must react to or display
- Persistence checklist run if anything persistent changed shape
- Every real call site of a changed contract found (search, don't assume)
- Output artifacts and stored values read back, not trusted from a log
- Non-obvious design choices briefly explained - teach the pattern, don't just apply it

## Mistakes to actively flag

- Implementation started before the contract exists.
- A constant or threshold with no comment tracing where it came from, or derived against another component's unbuilt ceiling.
- Persistent state added without the integrity checklist, or duplicating something already derivable.
- Re-rollable state quietly promoted into the schema, or a guarantee lost because its roll was.
- A failure state that could strand a caller or a job.
- Two components calling each other's internals instead of routing through one composition point.
- A startup-time event with no one-shot sync for late subscribers; an ordering assumption with no enforcing line.
- An event emitted before its state is committed, or two entry points to the same fact with different bookkeeping.
- A swallowed exception or silent fallback with no justifying comment.
- A gate or filter with no loud check on the invariant it could break.
- A pass-through wrapper, or an interface with one implementation.
- A bare global clock/RNG call in logic that must be verifiable.
- A destructive operation run against a pattern instead of an enumerated, confirmed target list.
- "It ran successfully" offered as evidence without the output artifact read back.
- Any integrity/anti-tamper measure added reflexively rather than decided against the real trust model.

Further depth: `references/verification-and-review.md` (verifying and reviewing), `references/generated-data-and-simulation.md` (generators, invariants, offline simulation, the instruments that judge code past compile-and-pass).
