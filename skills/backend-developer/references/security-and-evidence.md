# The security baseline in full, and notes behind some hard rules

Each rule of the baseline with its detail, its categories and its figures; then the cases and sources behind some of the hard rules.

## Security baseline

Not a substitute for a security review; the floor every change meets. Categories follow the OWASP Top 10:2025.

- **Authorize every request on the server**, per object, not just per route; the client's view of what a user may do is a hint, not a control (broken access control, including SSRF: validate and allow-list any URL the server fetches).
- **Treat all input as data.** Parameterized queries, no string-built shell or SQL, output encoded for its context, schemas validated at the boundary.
- **Verify every new dependency exists and is the one you meant** before installing it - code models regularly suggest package names that don't exist (a USENIX Security 2025 study measured this across 16 models: 5.2% of suggested packages from commercial models and 21.7% from open ones; a 2026 single-author preprint still found about 5% on frontier models, not yet peer-reviewed), and attackers register those names (OWASP A03:2025, Software Supply Chain Failures). Pin versions with a lockfile; review what a new dependency pulls in.
- **Third-party data, models and assets get the same gate.** Read the licence for the intended use (machine processing, derived data, redistribution) before ingesting, and prefer an openly licensed equivalent you already hold - one research shortcut pointed at a data source whose terms forbid machine interpretation while an open equivalent sat unused. Reading the terms is `research-and-sourcing`'s; the gate sits here.
- **Ship no debug or default configuration.** Debug modes, default credentials, sample endpoints, permissive CORS and verbose error pages are off in anything deployed (A02:2025, Security Misconfiguration).
- **Secrets never appear** in code, config literals, logs, error messages, URLs or test fixtures.
- **Errors to callers are generic and structured** (for HTTP APIs, RFC 9457 problem details); detail goes to logs, never the stack trace to the client. Log security-relevant events so an incident can be reconstructed.
- **Every external call has a timeout and a defined failure behavior**; a write that may be retried carries an idempotency key or is naturally idempotent.

## Notes behind the hard rules

- **Rule 3, padded and duplicated code.** Generated code tends to pad and duplicate where a human would reuse (GitClear's 2025 vendor analysis of 211 million changed lines found duplicated blocks up about eightfold in 2024; it is not peer-reviewed).
- **Rule 13, the anchor.** A ~60x error shipped in a draft that derived a gate from a ceiling reachable only after spending far more than the gate protected. The incident in full: `generated-data-and-simulation.md`, section 2.
- **Rule 16, silent failure.** Studies of generated code find missing checks and error handling to be the dominant robustness gap, and code that keeps the surface appearance of working while doing nothing passes casual review.
- **Rule 16, failing closed.** An exception on a security or policy path denies, never allows (OWASP Top 10:2025 now lists mishandled exceptional conditions as its own category).
- **Rule 18, units and frames.** The textbook case is the 1999 Mars Climate Orbiter loss, attributed to pound-force-seconds supplied where newton-seconds were specified (NASA's mishap board report, seen here only through summaries).
- **Atomic writes.** Rename-over-existing is atomic on POSIX but not guaranteed on every platform (Windows replace APIs make no atomicity promise) - know your target.
