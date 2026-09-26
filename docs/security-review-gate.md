# Final security-review gate

An optional last stage for any chain: one read-only reviewer reads the final deliverable
(for a coder-gate chain, the diff) and reports security findings. A blocking finding fails the
gate. The reviewer never writes code, has no tools, and its reply never reaches a reviser or the
deliverable.

No claim is made that this gate finds any particular share of real vulnerabilities. It has not
been measured. Treat a passing gate as "one reviewer found nothing blocking", not as "secure".

## Where it runs

After everything else: build, `verify_post`, every critic and revise round, the challenge stage,
the final edit and the handoff. It never runs before the build, so it always reviews an artifact
that exists. Stage label: `security-review` (stable, safe to key on).

## Turning it on

```json
{
  "security_review": { "enabled": true }
}
```

`enabled` is the only key. `chain-lint` rejects any other key under `security_review`, a
non-boolean `enabled`, and a `seats.security_reviewer` in a chain that never enables the stage.

### Default reviewer seat

With no `seats.security_reviewer`, the stage uses:

```json
{ "provider": "anthropic", "model": "claude-fable-5-1", "maxTokens": 8000, "lab": "anthropic-security" }
```

BYOK: it reads `ANTHROPIC_API_KEY`. It is priced in `src/pricing.json` ($10 input / $50 output per
million tokens, Anthropic's list price on 2026-09-15), so `--dry-run` shows its worst case and a
`--max-usd` ceiling stops the run before this stage is paid for if it would breach.

### Local/offline reviewer seat

To run the stage with no key and no spend, seat a local model through the existing `ollama`
provider:

```json
{
  "security_review": { "enabled": true },
  "seats": {
    "security_reviewer": { "provider": "ollama", "model": "qwen2.5-coder", "maxTokens": 8000, "lab": "local-security" }
  }
}
```

This is a local/offline option. Nothing has been measured comparing a local model's findings
with the default seat's, so choose it for cost, privacy or an air-gapped machine, not on an
assumption about what it will catch. Use whichever model you have pulled; `baseUrl` works as it
does for any other local seat (see the README's "Local models" section).

## What it checks

Injection (SQL, command, path, template), hard-coded or leaked secrets, missing or broken
authorization, unsafe deserialization, unsafe command or dynamic-code execution, risky or
unpinned dependencies, and prompt-injection surfaces. The deliverable is wrapped in a
`<deliverable>` container and the reviewer is told that text inside it is data; an instruction
found in it is itself reported as a `prompt_injection` finding.

## Output

`report.json` gains a `security_review` object (additive; absent when the stage is off), and the
run folder gets `security-review.json` with the same content:

```json
{
  "label": "security-review",
  "seat": "anthropic/claude-fable-5-1",
  "lab": "anthropic-security",
  "gate": "blocked",
  "seat_verdict": "fail",
  "reason_code": null,
  "reason": null,
  "findings": [
    { "severity": "high", "category": "injection", "file": "src/db.js", "line": 42,
      "evidence": "db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)",
      "problem": "User input is interpolated into SQL." }
  ],
  "blocking_count": 1,
  "dropped_findings": 0
}
```

- `severity`: `critical`, `high`, `medium`, `low` or `info`. A finding whose severity is missing or
  unrecognised is recorded as `high` with `severity_assumed: true` (fail closed).
- `category`: `injection`, `secrets`, `authz`, `unsafe_deserialization`, `unsafe_exec`,
  `dependency`, `prompt_injection` or `other`.
- `dropped_findings`: entries the reviewer returned with neither evidence nor a problem statement.

### The gate

Derived from the findings, not from the reviewer's own summary:

| `gate` | When | CLI exit code |
|---|---|---|
| `blocked` | any `critical` or `high` finding | 7 |
| `not_judged` | no readable verdict, or the reviewer said it could not judge | 8 |
| `pass` | neither of the above (lower-severity findings are still listed) | 0 |

`not_judged` is never a pass. Its `reason_code` is one of `SEAT_UNREACHABLE`, `PROVIDER_ERROR`,
`REPLY_TRUNCATED`, `REPLY_UNPARSEABLE`, `REASONING_EXHAUSTED` (these five mirror the panel
abstention codes) or `SEAT_COULD_NOT_JUDGE` (the reply was readable and the reviewer said it
lacked what it needed).

The blocking levels (`critical`, `high`) are fixed in `src/security-review.js`, not a chain
setting, so a chain cannot loosen its own gate.

**The gate can pass even when the reviewer's own verdict is `fail`.** `gateOf()` looks only at
`findings[].severity`, not at `seat_verdict` - a reviewer that returns `seat_verdict: "fail"` but
whose findings are all `medium`/`low`/`info` still yields `gate: "pass"`. This is intentional, not
a bug: severity is the reviewer's own graded judgment of how bad each finding is, and the gate
exists to block on the findings that matter, not on the reviewer's summary label. `seat_verdict`
is still recorded in the report for a human to read, it's just not what the gate keys on.

One exception (2026-09-23 audit): a `fail` whose findings cannot be trusted is `not_judged`, never
`pass` - a `fail` with no kept finding, a `fail` where a possibly-blocking finding was dropped as
malformed, or a `findings` value that is not a list. A summary `fail` the gate cannot read the
reasons for is treated as "could not judge", not as "nothing serious".

## Testing it at $0

`chains/mock-security-review.json` runs the whole path offline with a mock reviewer that always
reports one high finding:

```bash
council --chain mock-security-review --task tasks/<your-task>.md
echo $?   # 7
```

Swap its reviewer model to `mock-security-clean` for the passing path. `test/security-review-gate.test.js`
covers both, plus the non-verdict, fail-closed and spend-cap paths.
