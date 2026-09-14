# Single-vendor mode

Routes every seat in a chain through one vendor account/key instead of one direct key per lab.
This is a procurement convenience - fewer keys to provision, one bill to reconcile - not a
governance or risk-reduction feature, and not a step toward a hosted service: it is still BYOK,
your own vendor key pays for every call, nothing is proxied through infrastructure this project
runs.

## What ships in this slice

OpenRouter, as the reference vendor adapter. Bedrock, Vertex, and Azure are documented follow-ups
in the same shape (a vendor-model-ID map plus a `transport` value) - not built here.

## Using it

Set `"transport": "openrouter"` at the top level of a chain config to route every seat through
OpenRouter, or on an individual seat to route just that one (a seat's own `transport` always wins
over the chain-level value). Set `OPENROUTER_API_KEY` and unset whatever direct-lab keys you'd
otherwise need - single-vendor mode never reads them.

```json
{
  "name": "my-chain",
  "transport": "openrouter",
  "seats": {
    "builder": { "provider": "anthropic", "model": "claude-sonnet-5" },
    "critics": [
      { "provider": "google", "model": "gemini-3.6-flash" }
    ]
  }
}
```

Both seats above still declare their real provider and model - that's what gets mapped to
OpenRouter's own model-ID naming under the hood (`src/providers.js`'s `VENDOR_MODEL_MAPS`). A
seat with no explicit `lab` keeps using its original `provider` value as its lab identity
(`anthropic`, `google`), exactly as it would with no `transport` set at all - debate and
independence accounting never see the vendor, only the lab.

Price the routing before spending anything with the existing dry-run:

```
node src/cli.js --chain my-chain --task tasks/x.md --dry-run
```

Every row will show `openrouter/<vendor-model-id>` once `transport` is resolved - the same
listing `--dry-run` already prints, now reflecting the real routing rather than the direct-lab
config on disk.

## A seat with no vendor route

If a seat's `provider:model` pair has no entry in `VENDOR_MODEL_MAPS[transport]`, resolution
fails fast with `no route for <lab> under transport <transport>` - before any provider call, not
as a silent fallback to a direct-lab request. Add the missing mapping to
`src/providers.js`'s `VENDOR_MODEL_MAPS` rather than routing around the check.

## Backward compatibility

A chain with no `transport` field, and no seat with its own `transport`, runs exactly as it did
before this feature existed - `resolveChainSeats()` returns the same config object, unchanged.
