# Audit export (`audit.jsonl`)

A signed, append-only log written alongside `report.json` in a run folder (`runs/<id>/audit.jsonl`),
one JSON line per provider call plus one final line closing the hash chain. This document is the
schema; reading `audit.jsonl` into a SIEM or any other ingestion pipeline is the reader's own job -
this repo doesn't build one.

## When it's written

On by default only when a `policy.json` exists in the working directory (see
[policy.md](policy.md)) - otherwise opt-in via `"audit": true` in a chain config. A default user who sets neither
gets no `audit.jsonl` and no other change to their run folder; this item is fully inert unless
turned on.

## Data line (one per provider call)

```json
{
  "seq": 0,
  "ts": "2026-09-14T18:03:11.204Z",
  "run": "2026-09-14T18-03-00-000Z",
  "chain": "plan-cheap",
  "user": "muad",
  "stage": "criteria",
  "provider": "anthropic",
  "model": "claude-sonnet-5",
  "lab": "anthropic",
  "region": null,
  "tokensIn": 1620,
  "tokensOut": 410,
  "usd": 0.0113,
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "9f1c...e02a",
  "signature": "c4a0...918f"
}
```

Every field is derived from data the run already produces (`report.json`'s own `stages[]` entries
carry `label`/`provider`/`model`/`lab`/`usage`/`usd`) - nothing here is separately recorded or
tracked outside the run folder. `user` comes from `os.userInfo().username`, falling back to
`$USER`/`$USERNAME`/`"unknown"` on a sandboxed environment with no passwd entry for the running
uid. `region` is currently always `null` - no seat in this repo declares one yet; the field exists
so a future seat-level `region` (e.g. for the policy file's `allowed_regions` check) has somewhere to
land in the audit trail without a schema version bump.

`hash` is `sha256` over the line's own fields (`seq`, `ts`, `run`, `chain`, `user`, `stage`,
`provider`, `model`, `lab`, `region`, `tokensIn`, `tokensOut`, `usd`, `prevHash`, in that exact
order) - `hash` and `signature` are never included in their own hash input. `prevHash` is the
previous line's `hash` (the first line's `prevHash` is 64 zeros). `signature` is
`HMAC-SHA256(key, hash)` in hex - `null`, with a printed warning at write time, when no signing key
is configured (`AUDIT_HMAC_KEY` env var, or a key file named by `AUDIT_HMAC_KEY_FILE`, kept
outside the run folder - a key stored alongside the log it signs gives no real tamper-evidence, and
`AUDIT_HMAC_KEY_FILE` resolving inside the run folder is refused outright, not just discouraged).

## Closing line (exactly one, always last)

```json
{
  "type": "chain-close",
  "lineCount": 6,
  "finalHash": "7b21...44dd",
  "signature": "a812...0033"
}
```

`finalHash` is a rolling hash over every data line's own `hash`, in order:
`finalHash = sha256(sha256(...sha256(genesis + hash_0) + hash_1...) + hash_n)`, genesis being the
same 64-zero value data line 0's `prevHash` uses. `signature` is `HMAC-SHA256(key, finalHash)`, or
`null` under the same no-key condition as above. A run that crashes or is killed mid-flight simply
has no closing line - a real, discoverable state (`lineCount` in the last data line's `seq` plus
one tells you how far it got), not silent corruption to paper over.

## Verifying

Re-derive, never trust: recompute every line's `hash` from its own fields and check it against the
stored value, check `prevHash` chains correctly from one line to the next, recompute `finalHash`
over every data line's `hash` and check it against the closing line - `src/audit.js`'s
`verifyAuditLog()` does exactly this, offline, given nothing but the file's own bytes (and the
signing key, if you also want signatures checked). A single mutated byte anywhere in a data line
changes that line's recomputed `hash`, which breaks the next line's `prevHash` check and the
closing line's `finalHash` check. A log with no closing line fails verification by default, so
cutting lines off the end is detected too; pass `allowUnclosed: true` only to inspect a run that has
not finished, and read its result as "unclosed", not "verified".

What it does not catch: **without the HMAC key, a full rewrite.** Every hash is a plain SHA-256 of
the file's own content, so anyone who can edit the file can recompute the whole chain, closing line
included, and it verifies. No key is the default. Only a log signed with a key kept away from the
file (`AUDIT_HMAC_KEY_FILE`, verified with that key) detects a rewrite.

## What this item is not

Not a benchmark, not an evaluation, not a claim about output quality - this is an operational audit
trail (who called what, when, at what cost), the same non-claim the rest of this repo's telemetry
(`verdict-stats.js`, `metrics.js`) already makes about itself.
