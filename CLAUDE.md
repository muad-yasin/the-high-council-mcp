# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`the-high-council-mcp` — a multi-model planning harness, published as an MCP server and a CLI.
It runs one request past seats filled by models from different labs, makes them argue on the
record, and writes a deliverable plus a full debate board. MIT, BYOK-only.

Read `HANDOFF.md` before starting work. It carries the release order and the hard rules. Its two
"open decisions" are now settled and should not be reopened: the `LICENSE` holder stays
**Sower Industries** (the legal company, confirmed by the author), and the package was renamed to
**`the-high-council`** (npm names are lowercase, so `THC` would have shipped as `thc`; `THC` stays
internal shorthand). The `council` command is the public one; `relay` is kept as an alias so
anything already shelling out to it keeps working.

"The High Council" is this harness. "Sophi-A" is a separate product (a Tauri app, different repo,
Apache-2.0). Do not conflate them.

## Commands

```bash
npm install
npm test                                  # node --test over test/*.js
node --test test/chain.test.js            # one file
node --test --test-name-pattern 'parseJson: raw newline'   # one test

npm run mcp                               # MCP server, stdio transport
npm run dry -- --task tasks/x.md --chain verify   # price a run, call nothing
node src/cli.js --task tasks/x.md --chain verify  # a real, paid run
node src/cli.js --resume runs/<id>        # continue a run paused at an external seat
node src/cost.js                          # price a roster of models
npm run ui                                # local run browser (src/ui/)
```

Any chain whose seats are all `provider: "mock"` (`chains/mock*.json`) runs the full pipeline
offline for $0 and needs no keys. Use those to exercise plumbing changes before spending money.

`npm run http-server` exists but `src/http-server.js` is **not part of this release**. Its
`MAX_USD_PER_DAY` is a separate, daily cap and is unrelated to the per-run cap below.

## Architecture

The whole harness is one function, `runChain()` in `src/chain.js` (~700 lines), driven by a JSON
config. Everything else is an entry point into it or a support module.

**Config is the product.** `chains/*.json` are not examples — they are how behaviour is chosen.
A chain names its seats (`criteria`, `skeleton`, `builder`, `reviser`, `handoff`, `critics[]`),
the `maxRounds` cap, and feature flags (`questions`, `proposals`, `debate`, `handoff`,
`signoff: "unanimous"`, `panel: "relay"`). `runChain` reads those flags and skips whole stages.
Adding a capability usually means a stage in `chain.js` plus a flag, not a new chain file.

A **seat** is `{ provider, model, maxTokens?, temperature?, extra?, lab? }`. `lab` overrides the
identity used for independence accounting — three seats on OpenRouter are three labs, and mock
chains put two labs on one provider. Blind-panel and debate logic key off `labOf(seat)`, so
getting `lab` wrong silently corrupts the thing the harness exists to measure.

**Stage flow** (`runChain`, in order): questions → criteria → skeleton → proposals (blind, per
lab) → debate (anonymised posts, then author keep/amend/withdraw) → build → critic/revise rounds
under the cap → optional final edit → handoff. Two termination modes: `first` (any one critic
passes) and `unanimous` (every critic signs off on the *same* draft, else the reviser fixes the
union of all objections and the whole panel re-reviews).

**Layers:**
- `src/providers.js` — one adapter shape in, one out. Anthropic speaks the Messages API; every
  other provider shares one OpenAI-chat-completions adapter (`OPENAI_COMPAT`). Adding a provider
  is usually one line there. `mock` is a fake provider with named models
  (`mock-unreadable`, `mock-provider-error`, `mock-proposer-empty`) that each exercise a specific
  failure branch offline.
- `src/roles.js` — every system and user prompt. Prompt changes belong here, never inline in
  `chain.js`. `criticSystem(open)` / `criteriaSystem(open)` etc. swap a scope rule by template.
- `src/cost.js` — `pricing.json` lookup, `costOf`/`summarise` (measurement, after the fact) and
  `worstCaseOf`/`wouldBreach` (projection, before the fact — what the spend cap enforces against).
- `src/cli.js` — flags, `.env` loading, the run folder, the stage cache.
- `src/mcp/server.js` — the same operations as MCP tools. It **spawns `src/cli.js` detached** so a
  long run outlives the tool call; the client polls `run_status`. It does not run chains in-process.

**The run folder is the database.** Each run writes `runs/<iso-timestamp>/` containing
`run.json` (how to resume), `<label>.md` + `<label>.usage.json` per stage, `run.log`,
`deliverable.md`, `BOARD.md`, `HANDOFF.md`, `report.json`. There is no other state store.

**Resume and the stage cache.** `setCache()` gives `chain.js` a `get(label)` that replays a stage
from `<label>.md` on disk at zero cost. This is what makes resume free and is why stage labels
must stay stable — renaming a label orphans every run that paused before it.

**The spend cap is enforced in `invoke()`, before the call.** `setBudget(cap)` arms a per-run
ceiling; `invoke()` projects the worst case for the stage it is about to run (whole prompt as
input, whole `maxTokens` as output, doubled for Anthropic's retry) and throws `BudgetExceeded`
rather than spending past it. Replayed stages count toward the ceiling too, so resuming cannot lap
it. Any new paid call must go through `invoke()` or it escapes the cap entirely. An unpriced seat
projects $0 and is therefore uncapped — which is why the `mock-*` chains run free under any
ceiling, and why `mock-budget` exists with fixture prices to test the cap offline.

**External seats pause the run.** `provider: "external"` throws `ExternalPause` (thrown, not
returned, so control flow stays linear). The CLI catches it, writes `NEEDS-<stage>.md` with both
prompts, and exits 3. The run resumes once `<label>.md` exists. The MCP path exposes the same
thing as `external_prompt` / `submit_stage`. A paused run is not a stuck run.

**Model output is assumed to be broken.** `parseJson` in `chain.js` repairs specific, observed
failure modes (unescaped quotes inside markdown-quoted spans, raw newlines in string values) with
real string-state tracking rather than regex, and deliberately still fails on genuinely garbled
output. `classifyUnreadable` separates provider errors from truncation from malformed JSON.
`invoke()` retries once with thinking disabled when an Anthropic seat burns its whole `maxTokens`
budget on thinking. Every one of these encodes a real incident — the comments name the run and the
date. Read the comment before changing the behaviour, and keep the regression tests in
`test/chain.test.js`, which are built from the actual broken replies.

## Rules that are not style preferences

- **BYOK only.** Never add a default key, a proxy, or a hosted/"try it free" path.
- **No efficacy claims** in any user-facing text until something has actually been measured. The
  README is deliberately written without them.
- **The README's "Known limits" section stays honest.** Delete a limit when it stops being true,
  never because it is embarrassing. It currently admits the missing spend cap; that admission is
  removed by landing the cap, not by editing the sentence.
- This tree is a curated extraction from a private repo. **Never add** `context/`, `tasks/`,
  `plans/`, `Docs/`, `benchmark/`, `Dockerfile`, or `fly.toml`.
- **Never move harness run output into this repo.** Run folders (`runs/<id>/` here, and
  `~/Projects/relay/runs/<id>/` upstream) hold deliverables about the author's business and
  personal plans — pledge stress-tests, company structure, strategy. This repo is public; a run
  folder is not publishable by default. `runs/` is gitignored for this reason; keep it that way.
- Internal references in code comments and chain descriptions are public on purpose. Do not
  "clean" them.
- Branch convention is `master`.
