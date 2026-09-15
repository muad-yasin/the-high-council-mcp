# Policy file

A `policy.json` at the root of your working directory - next to `chains/`, `tasks/`, `runs/` -
is a locked set of limits checked before any provider is called. If it exists, every real run
and every `--dry-run` is checked against it first; if it doesn't exist, nothing changes, at all,
from today's behavior. There is no flag to point at a different path or to skip the check: the
whole point of a policy file is that an operator commits one file every invocation is bound to.

A run that would violate the policy never starts. Nothing is spent either way - the check runs
before any provider is invoked, before even the missing-API-key check.

## Fields

All fields are optional; a policy file with none of them present enforces nothing (equivalent
to having no file at all, but is still a real, present file an operator can point at).

| Field | Type | Checks |
|---|---|---|
| `allowed_providers` | `string[]` | Every non-synthetic seat's `provider` must be in this list. |
| `allowed_regions` | `string[]` | Every non-synthetic seat's `region` must be in this list. A seat with no `region` declared fails this check - an undeclared region cannot be verified, and this policy fails closed. |
| `max_usd_per_run` | `number` | This chain's worst-case cost (the same number `--dry-run` prints) must be under this. |
| `max_usd_per_month` | `number` | Spend already recorded this calendar month, across every run folder on disk, must be under this - derived via `spendReport()`, the same on-disk accounting `council spend` already uses. Does not add this run's own projected cost; it answers "have I already gone over," not "would this run push me over." |
| `required_chain_tags` | `string[]` | The chain config's own `tags` array (a new, optional field - see below) must contain every one of these. |
| `required_signoff_paths` | `string[]` | Globs (`*` within one path segment, `**` across segments) over repo-relative, forward-slash paths. A change request whose `target_file` matches one needs a named signoff; the refusal names the matched pattern. Runs without a change request are unaffected. A change request with no `target_file`, or one that is absolute or climbs out with `..`, is refused. The path comes from the task file's `target_file:` line; a task file without that line is not a change request. The signoff comes from `--signoff <name>`, or the task file's `signoff:` line when the flag is absent. |
| `refuse_unpriced_seats` | `boolean` | If `true`, any non-synthetic seat with no entry in `src/pricing.json` is refused, rather than silently running unpriced (and therefore uncapped by the per-run spend cap). |

## Capabilities, and what a run's report records

Each field is named as the capability it restricts. The names live in one table,
`POLICY_CAPABILITIES` in `src/policy.js`:

| Field | Capability |
|---|---|
| `allowed_providers` | `provider-choice` |
| `allowed_regions` | `data-residency` |
| `max_usd_per_run` | `run-spend-limit` |
| `max_usd_per_month` | `monthly-spend-limit` |
| `required_chain_tags` | `chain-classification` |
| `refuse_unpriced_seats` | `priced-seats-only` |
| `required_signoff_paths` | `path-signoff` |

When a run goes ahead under a policy, its `report.json` gets a `policy` block listing the checks
that policy **configured** - `{ "checks": [{ "capability", "field", "ok" }] }`. A field the policy
does not set is not listed, so the report never claims a restriction that was not in force. With no
`policy.json`, there is no `policy` key at all. The list is recorded in the run's `run.json` when
the run starts, so a resumed run reports what its first round enforced even if `policy.json` changed
in between. (A run that fails its policy never starts, so it has no report.)

"Non-synthetic" excludes seats with `provider: "mock"` or `provider: "external"` - these are
never billed and were never going to carry a real provider/region in the procurement sense this
file exists for, the same exemption `--dry-run`'s own unpriced-seat warning already makes.

## Seat `region`

`region` is a new, optional field on a seat (`{ provider, model, region?, ... }`), read only by
policy enforcement. It has no effect when no `policy.json` sets `allowed_regions`.

## Chain `tags`

`tags` is a new, optional array field at the top level of a chain config (alongside `name`,
`seats`, `maxRounds`), read only by `required_chain_tags`. It has no effect when no
`policy.json` sets that field.

## Malformed policy files

A `policy.json` that exists but fails to parse is treated as a refusal, quoting the parse error -
never a silent fallback to "no policy present." See `COUNCIL-E005` in `TROUBLESHOOTING.md`.

## Backward compatibility

No `policy.json` at the locked path: every existing chain, CLI invocation, and `run_status`
output is byte-identical to before this feature existed. This is checked directly in
`test/policy.test.js`.
