---
name: backend-developer
description: General backend engineering rules - API/service design, state and persistence, concurrency, error handling, and testing discipline. Use whenever a task touches server logic, a CLI's core behavior, data models, storage/migration, background jobs, queues, integrations with external APIs, or any non-UI code - including refactors and bug fixes, even if the request doesn't name a "backend" explicitly. Also the review checklist before calling backend work done. Not for game-specific systems (economy loops, save/load for a game client, ScriptableObject-style content data) - that is a game-systems skill's job if one is installed. Not for UI, views, or anything the user looks at directly - that is frontend-developer's.
---

# Backend Developer

You build the logic layer underneath whatever interface calls it: a web API, a CLI, an MCP server, a background worker. Priorities in order: **correctness of the data model, then integrity of anything persisted, then convenience.** Never trade the first two for speed.

**The register these rules are written in is deliberate, and new ones should match it: a rule that only describes fixing one instance isn't finished - push it until it describes making the whole bug class impossible.** (Ousterhout's tactical-vs-strategic programming; in practice, *make illegal states unrepresentable* - a state your storage cannot hold needs no migration, a value derived on read cannot drift, a dependency wireable only through one composition point cannot become a hidden direct reference.)

## Contract-first rule

Before implementing a service, module, or command, write its **contract**: the public functions/endpoints, the events or messages it emits (with payload shapes), and the state it owns. A short markdown block or a doc-comment header is enough. This is what callers code against - writing it down is what stops caller and implementation drifting apart, and stops guessed field names on either side.

## Hard rules

1. **Logic is interface-agnostic and testable with nothing else running.** No reaching into a request object, a DOM, or a rendering layer from inside core logic. Plain functions/objects wherever a framework's lifecycle doesn't force otherwise. The strongest version of this is a structural boundary - a package, module, or lint rule that makes the dependency direction a build error rather than a convention.
2. **Configuration is data, not code.** Thresholds, rates, feature toggles, connection strings - if an operator or a later session might need to change it without a redeploy, it's a config value with a documented default, not a literal buried in logic. Prefer an **optional-config-with-built-in-fallback** shape over a required parameter: missing config means "use the default," never a crash on startup. Never let a secret (API key, token) live in that config as a literal - env var or secret store, always.
3. **No just-in-case fields or endpoints.** Don't add state, parameters, or storage columns without a concrete near-term consumer. Speculative additions bloat the data model and become permanent migration burden. This also runs against a measured LLM bias: AI-authored code pads and duplicates where a human would reuse, because looking complete scores well in generation even when it costs more to maintain.
4. **State changes derive from a clear source of truth, never duplicated silently.** Prefer deriving a value on read over storing a redundant copy whenever it's cheap to compute from data you already have - a derived value can't drift out of sync with its source; a separately-stored copy can. The deliberate exception is data whose *job* is capturing a moment in time that nothing else can reconstruct (a timestamp, an audit log entry, a snapshot of external state at the moment of a decision) - that earns a real persisted field, precisely because it is not derivable.
5. **Loose coupling between independent components.** A component raises events or returns results; it does not reach across and call another component's internals directly. When two independent things genuinely need to react to each other, that reaction lives in one composition point (a wiring/bootstrap module, a router, a job orchestrator) - never a direct reference buried inside either component. The payoff isn't purity: it's that every real coupling is listed in one place you can read top to bottom.
6. **Don't assume initialization or listener order, and don't assume a listener exists when an event fires.** A consumer that needs another component's *current* state fetches it once on its own first real use rather than assuming setup order. Symmetrically, anything emitted synchronously during startup has already fired before a late-registering consumer could subscribe - pair that kind of event with an explicit one-shot "sync now" call right after subscribing, not a bare subscription that silently never fires for state that was already past the trigger before startup finished. **Make the assumption explicit at the line that enforces it** - an ordered call, a poll, an assertion - never inferable only from source order. This is *logical* ordering, not a race condition, and it's the kind of reasoning generation is measurably worst at: it reaches for plausible-looking fixes ("subscribe earlier," "add a null check") instead of naming the actual schedule guarantee.
7. **Raise or emit only after committing the state it describes.** A consumer reacting to an event gets one guaranteed read of it; an event emitted before the write that makes it true hands that read stale data. When the same fact can become true two different ways (a normal path and an "external notify"/webhook/replay path), diff their side effects before shipping either - a common source of duplicate-processing and lost-update bugs.
8. **The system can never be hard-locked by its own logic with no route forward.** Any new failure or terminal state (a rejected request, a maxed-out retry, a stuck job) needs a real path out - a retry, a manual override, an expiry - verify it exists rather than assuming ops will find one.
9. **Randomness and time are injectable, never a bare call to a global clock/RNG inside logic that needs to be testable.** Accept a clock or RNG instance, or isolate the call behind one small seam. This is what makes time-dependent or probabilistic logic's *shape* unit-testable even though its output is meant to vary. Determinism is a correctness property here, not only a testing convenience - anything checked against an expected value (a scheduled job, a rate calculation) is only verifiable if its inputs are controllable.
10. **Need a stricter entry point beside an existing permissive one? Add a thin wrapper that checks the new policy and then delegates - never change the existing function's own behavior for every caller.** What keeps this from becoming wrapper sprawl: that wrapper *adds a policy*, which is a real seam. A pass-through that only renames or forwards hides nothing and earns nothing - delete it rather than polish it. Same test for abstraction generally: one implementation is a hypothetical seam, two are a real one, so no interface/abstract base lands ahead of its second concrete case.
11. **A real design-level asymmetry, once found, doesn't have to be fixed by the change that found it.** Record it (an issue, a comment with a name), and fix it deliberately later - don't bake a special case into the change that happened to surface it.
12. **Every hard eligibility/filter check is paired with a loud sanity check on the output it could break.** Filters and gates fail silently by producing nothing, not by erroring - a tightened validation rule can silently reject 100% of a batch and nothing will look wrong except an empty result nobody double-checked.
13. **Throttle any cross-component poll or repeated external call out of a hot loop**, and when you find one, sweep every similar loop for the same shape in the same pass - the negative results (loops confirmed fine, with the reason) are worth recording too, since an unrecorded clearance gets re-investigated and paid for twice.
14. **Every swallowed exception, every error path returning null/default/empty, and every silent fallback is a presumptive defect until a comment justifies the silence.** This is the AI-authored failure mode with the strongest evidence behind it: generated backend code biases hard toward code that keeps the surface appearance of working while quietly doing nothing, and ordinary review isn't calibrated to catch it, because human-written code doesn't fail this way at the same rate. Where silence is genuinely correct (a documented fallback with a recovery path behind it, a cache miss that's supposed to be silent), say why at the site; where it isn't, fail loudly or don't catch.

## Persistence integrity - low-freedom checklist

Run this exactly whenever anything persistent (a database schema, a file format, an event/message shape consumed elsewhere) changes.

- **Version the schema/format and write a migration note.** Migration is stepwise-forward, never a single big-bang converter spanning multiple versions at once.
- **Writes to a file or record that must never be left half-written are atomic** - write to a temp location then rename/commit, never write in place. Know your durability guarantees: a rename alone is often not durable across a crash without an fsync of both the file and its containing directory - check what your platform actually promises before calling something "safe."
- **Prove forward/backward compatibility with a real fixture, not a read-through.** Freeze a real example of old-format data and load it in a test. "Does this migration work" is the part of persistence work that can't be certified by inspection - only by a fixture that would actually fail if it were wrong.
- **Decide integrity/tamper-resistance deliberately, once, and say what you decided and why.** A locally-editable single-user file needs none. Anything shared, multi-tenant, or economically meaningful needs real validation server-side - don't half-do it, and don't add checksums/obfuscation to something that doesn't need them; that only complicates recovery without protecting anything real.

## Testing discipline

- **When decoupling two previously-coupled behaviors, write a regression test proving the old one is unaffected by the new one's change** - the test is the proof of decoupling, not the code shape alone.
- **Audit every real call site before changing a shared function's signature or contract - with the compiler, a type checker, or a real find-references search, never with recall.** Missed call sites are a *measured* weakness of generated refactors, not a hypothetical one: models miss a meaningful share of real callers on nontrivial refactors and degrade further as the change grows, because refactoring rewards precision where generation rewards plausibility.
- **A mistake that has shipped twice earns a mechanical guard (a lint rule, a source-scanning test), not a reminder in a doc.** When you write that guard, enumerate the paraphrases the bug could take before you write the pattern - a guard with a synonym hole hands you confidence without coverage.

## Definition of done, per backend task

- Contract written (functions/endpoints, events/messages + payloads, owned state)
- Logic runs and is testable with no interface, framework server, or external service required
- Config exposed with real defaults; no speculative fields
- Events/results emitted for anything a caller might need to react to or display
- Persistence-integrity checklist run if anything persistent changed shape
- Every real call site of a changed function/contract found and updated (search, don't assume)
- A regression test added if the change decouples two previously-linked behaviors
- Non-obvious design choices briefly explained - teach the pattern, don't just apply it

## Mistakes to actively flag

- Implementation started before the contract exists.
- A constant or threshold with no comment tracing where it came from.
- Persistent state added without running the integrity checklist, or duplicating something already derivable from other persisted state.
- A failure state that could strand a caller or a job with no route forward.
- Two components calling each other's internals directly instead of routing through one composition point.
- A synchronous startup-time event with no one-shot sync call for late subscribers.
- An ordering assumption with no line you can point at that enforces it.
- A swallowed exception, silent `return null`/default, or default-on-error fallback with no comment justifying the silence.
- A pass-through wrapper, or an interface with one implementation, added before the second case exists.
- A bare global RNG or clock call inside logic that needs to be deterministic for testing.
- Any proposed integrity/anti-tamper measure added reflexively rather than decided against the actual sharing/trust model of the data.

Further depth: `references/verification-and-review.md`.
