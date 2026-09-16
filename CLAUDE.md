# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`the-high-council-mcp` - a multi-model planning harness, published as an MCP server and a CLI.
It runs one request past seats filled by models from different labs, makes them argue on the
record, and writes a deliverable plus a full debate board. MIT, BYOK-only.

**As of the `skills/backend-frontend-developer` branch, this repo also carries `skills/` - a
growing set of generic, non-game-specific skills shipped alongside the harness, not part of it.**
Explicit, informed scope expansion (Muad's call, after being told plainly this widens the repo
from "debate harness" to "debate harness + skills distributor"): `backend-developer` and
`frontend-developer` cover general backend/frontend engineering - not any single project's stack,
and not game-specific systems work (that lives in the separate `sower-backend`/`sower-frontend`
plugins, which this repo does not bundle). `good-news-writing` (added on the
`skills/news-content-generic` branch, de-SMO'd from Stock Market Oasis's four `news-*` skills per
that project's own migration plan, which named it as deferred, real work rather than invented
scope) covers the warm-register content craft for writing genuine positive coverage of a real
person or organization - composes with the `sower-writer` plugin's drafting/fact-checking/
line-editing/final-read skills rather than duplicating them; three of SMO's four source skills
were found, on inspection, to already be fully generalized into `sower-writer`, so only the one
genuinely novel register shipped here. `ux-design` and `visual-craft` followed the same way. The
`skills/core-task-skills` branch (2026-09-14, Muad's direct request) added five cross-domain core
agentic skills - `task-scoping`, `research-and-sourcing`, `verification-and-critique`,
`context-and-handoff`, `tool-and-action-discipline` - built from a research pass on agent and
multi-agent failure modes plus the rest of Stock Market Oasis's skill library, and upgraded
`backend-developer`/`frontend-developer` with that library's remaining generalizable rules. A future
session should not be confused by a `skills/` directory with no mention here - if more skills are
ever added, they belong to this same "generic, public, BYOK-consistent" bar, not project-specific
content, and go through the same leftover-content grep (source project names, internal paths,
private seat build names, third-party text) before they ship.

**The skill list lives in `skills/` itself.** `skills/README.md` (the catalog) and
`docs/skills.html` (the customer-facing presentation) both enumerate it by hand, so
`test/skills-catalog.test.js` derives the real set from the folders and fails if either document
drifts - same reasoning as `test/landing-page.test.js`. Add or remove a skill and the suite tells
you which document needs updating. `docs/skills.html` carries the landing page's two properties:
no scripts, no third-party requests.

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

The whole harness is one function, `runChain()` in `src/chain.js` (a large, growing file - check its
current line count rather than trusting a number here), driven by a JSON
config. Everything else is an entry point into it or a support module.

**Config is the product.** `chains/*.json` are not examples - they are how behaviour is chosen.
A chain names its seats (`criteria`, `skeleton`, `builder`, `reviser`, `handoff`, `critics[]`),
the `maxRounds` cap, and feature flags (`questions`, `proposals`, `debate`, `handoff`,
`signoff: "unanimous"`, `panel: "relay"`). `runChain` reads those flags and skips whole stages.
Adding a capability usually means a stage in `chain.js` plus a flag, not a new chain file.

A **seat** is `{ provider, model, maxTokens?, temperature?, extra?, lab? }`. `lab` overrides the
identity used for independence accounting - three seats on OpenRouter are three labs, and mock
chains put two labs on one provider. Blind-panel and debate logic key off `labOf(seat)`, so
getting `lab` wrong silently corrupts the thing the harness exists to measure.

**Stage flow** (`runChain`, in order): questions → criteria → skeleton → proposals (blind, per
lab) → debate (anonymised posts, then author keep/amend/withdraw) → build → critic/revise rounds
under the cap → optional final edit → handoff. Two termination modes: `first` (any one critic
passes) and `unanimous` (every critic signs off on the *same* draft, else the reviser fixes the
union of all objections and the whole panel re-reviews).

**Layers:**
- `src/providers.js` - one adapter shape in, one out. Anthropic speaks the Messages API; every
  other provider shares one OpenAI-chat-completions adapter (`OPENAI_COMPAT`). Adding a provider
  is usually one line there. `mock` is a fake provider with named models
  (`mock-unreadable`, `mock-provider-error`, `mock-proposer-empty`) that each exercise a specific
  failure branch offline.
- `src/roles.js` - every system and user prompt. Prompt changes belong here, never inline in
  `chain.js`. `criticSystem(open)` / `criteriaSystem(open)` etc. swap a scope rule by template.
  `HANDOFF_SYSTEM` reads an optional `## Available tools` section out of the task file and names
  the listed tool in each item's acceptance test. The task text is already in that seat's prompt,
  so the convention costs nothing; the instruction's real content is the restraint - exact names
  only, never invent a tool or a command line, and assume nothing when the section is absent.
  `test/roles.test.js` pins that, since a prompt cannot be tested by running it (the mock provider
  ignores prompt text by design).
- `src/cost.js` - `pricing.json` lookup, `costOf`/`summarise` (measurement, after the fact) and
  `worstCaseOf`/`wouldBreach` (projection, before the fact - what the spend cap enforces against).
- `src/cli.js` - flags, `.env` loading, the run folder, the stage cache.
- `src/mcp/server.js` - the same operations as MCP tools. It **spawns `src/cli.js` detached** so a
  long run outlives the tool call; the client polls `run_status`. It does not run chains in-process.

**The run folder is the database.** Each run writes `runs/<iso-timestamp>/` containing
`run.json` (how to resume), `<label>.md` + `<label>.usage.json` per stage, `run.log`,
`deliverable.md`, `BOARD.md`, `HANDOFF.md`, `report.json`. There is no other state store.

**`report.json` is the machine-readable board; `BOARD.md` is the same thing for people.** Anything
built on a run reads the JSON - `proposals[]`, `debate.posts[]` (`by`/`on`/`stance`/`merge_with`),
`debate.replies[]` (`keep`/`amend`/`withdraw`), `signoff[]`, `scoreboard`, `totals`. Together those
are a directed graph with verifiable edges. Nothing should ever parse `BOARD.md`'s headings, and
the README now says so, because a four-lab council given a published run folder concluded the data
existed only in prose and specified a markdown parser against it (2026-09-11). That was a
documentation failure, not a model failure: the JSON was right there and undocumented. Its shape is
a public contract now - adding fields is fine, renaming or removing one is a breaking change.

**Resume and the stage cache.** `setCache()` gives `chain.js` a `get(label)` that replays a stage
from `<label>.md` on disk at zero cost. This is what makes resume free and is why stage labels
must stay stable - renaming a label orphans every run that paused before it.

**The spend cap is enforced in `invoke()`, before the call.** `setBudget(cap)` arms a per-run
ceiling; `invoke()` projects the worst case for the stage it is about to run (whole prompt as
input, whole `maxTokens` as output, doubled for Anthropic's retry) and throws `BudgetExceeded`
rather than spending past it. Replayed stages count toward the ceiling too, so resuming cannot lap
it. Any new paid call must go through `invoke()` or it escapes the cap entirely. An unpriced seat
projects $0 and is therefore uncapped - which is why the `mock-*` chains run free under any
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
budget on thinking. Every one of these encodes a real incident - the comments name the run and the
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
  personal plans - pledge stress-tests, company structure, strategy. This repo is public; a run
  folder is not publishable by default. `runs/` is gitignored for this reason; keep it that way.
- Internal references in code comments and chain descriptions are public on purpose. Do not
  "clean" them.
- Branch convention is `master`.
- **Ideas are free to study; code and prose are never copied.** Researching the open-source
  market (competing tools, academic papers, adjacent infrastructure patterns) for feature and
  architecture ideas is standing, encouraged practice here - see
  `Review/market-feature-survey-2026-09-15.md` for the shape of it. The discipline is: describe
  an idea in this project's own words and evaluate it against this project's own identity and
  standing exclusions (WANT / MIGHT-WANT / DON'T-WANT), never quote another repo's README, docs,
  or code verbatim, and never port code from a differently-licensed project. This project is MIT
  and wants others to do the same with it - the same courtesy runs the other way.

## The landing page (`docs/`)

`docs/` is a GitHub Pages site: a single standalone `index.html` plus self-hosted fonts. It is a
Claude Design treatment of the README, and it has two properties that must survive any edit:

- **No scripts and no third-party requests.** The design arrived depending on Claude Design's
  `dc-runtime` (`support.js`, an unlicensed build artifact that also pulled React and Babel from
  unpkg at runtime) and on Google Fonts. The runtime was removed by pre-rendering its three
  `<sc-for>` loops to static HTML and converting `style-hover` to CSS; the fonts are self-hosted.
  Never reintroduce either - hotlinked Google Fonts in particular are a live legal problem for the
  German site this design is shared with.
- **Its numbers are claims about this repo.** The counts (chain configs, MCP tools, providers,
  default cap) are typed into the HTML, not derived - a static page cannot compute them. So
  `test/landing-page.test.js` derives each one from the repo and fails if the page disagrees,
  along with checking the page stays script-free and third-party-free. Change `chains/`, the tool
  list, or the default ceiling and the suite will tell you the page needs updating. This is not
  hypothetical: the page shipped saying 29 chains and 12 tools when the repo had 30 and 11, with
  its own tools table listing eleven rows directly beneath the "12".

**Canonical URL - the planned flip was cancelled, on evidence.** The original plan was: once
`sower-industries.de/en/MCP/` deployed, point this page's `rel=canonical` and `og:url` there, on
the assumption the two were the same page in two places.

That deploy landed 2026-09-11 and both URLs now return 200, so the assumption was checked instead
of acted on. **They are not duplicates.** This page is a treatment of the README (~1,300 words,
what the harness is and how to install it). The sower-industries page is a different article
(~1,850 words) built around one specific run's debate board - the withdrawals, the holdouts, the
$0.0442. A cross-canonical between two pages that are not duplicates is at best ignored by search
engines and at worst deindexes a page with its own content and its own audience, on the domain
that actually hosts the code.

So `docs/index.html` stays self-canonical, permanently, and the two pages link to each other as
what they are: two different write-ups. The README and the page footer now link the live URL
rather than calling it forthcoming. Do not "finish" the flip - it was reconsidered, not forgotten.

## Cross-run spend (`src/spend.js`)

`spendReport()` answers "what have I spent across every run", which `run_status` (one run) and the
per-run cap (one run) cannot. It is **derived, never recorded**: every figure is read back out of
`runs/<id>/` on disk. There is no ledger file.

That was a deliberate choice over an append-only ledger in a dotfile, and it should not be quietly
reversed. A ledger is a second copy of the truth that can drift from the run folders; it needs a
write path, and a write path can fail during a run; it cannot account for runs that predate it; and
because it would outlive the run folders, it would keep a record of work a user deleted precisely
because it was sensitive. Deriving has none of those properties, and it keeps the project's
existing invariant that a run's truth lives in its own folder.

Consequences worth knowing: delete a run folder and its spend disappears from the report, which is
intended. Runs with no `report.json` (still going, or stopped by the cap) are counted from their
`<label>.usage.json` files, so the total stays honest mid-run.

Spend output carries the chain and the cost only - never the task path or any run content. A test
pins that, along with the degradation contract: a missing, unreadable or corrupt `runs/` must
produce a usable answer rather than an error, and `spendReport` must never write to disk.
