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
| `refuse_unpriced_seats` | `boolean` | If `true`, any non-synthetic seat with no entry in `src/pricing.json` is refused, rather than silently running unpriced (and therefore uncapped by the per-run spend cap). |

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
