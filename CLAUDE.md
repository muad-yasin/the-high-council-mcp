# CLAUDE.md

Guidance for Claude Code sessions in this repository. Read `maintainers/HANDOFF.md` before starting work: it
carries the release order and the hard rules. The earlier, longer version of this file (with the history behind
many rules) is `maintainers/CLAUDE-2026-10-09-before-rewrite.md`; git history keeps every version.

## What this is

`the-high-council-mcp` - a multi-model planning harness, published as an MCP server and a CLI. It runs one
request past seats filled by models from different labs, makes them argue on the record, and writes a
deliverable plus a full debate board. MIT, BYOK-only.

- **Public.** The repo is public: anything pushed is published. The npm package `the-high-council` is public;
  the latest release is **0.8.3** (tag `v0.8.3`; npm, a GitHub release with the `.mcpb`, the MCP registry).
  Release history: `maintainers/HANDOFF.md` and `CHANGELOG.md`.
- **Settled, do not reopen:** the package name is `the-high-council` (`THC` is internal shorthand); `council`
  is the public command and `relay` an alias kept for compatibility; the `LICENSE` holder is Sower Industries;
  the licence stays MIT. Homepage: https://sower-industries.de/en/THC/.
- "The High Council" is this harness. "Sophi-A" is a separate product (a Tauri app, a different repo,
  Apache-2.0). Do not conflate them.

## Rules that are not style preferences

- **BYOK only.** Never add a default key, a proxy, or a hosted/"try it free" path.
- **No xAI/Grok, ever** (owner, 2026-09-23). Not in any chain, roster, example or default, and not through a
  router id that could pick it (`openrouter/auto` and the like). Enforced by chain-lint's `denied-model` rule
  and a run-time check, with no opt-out (`test/denied-models.test.js`, `test/denied-router-ids.test.js`); never
  add one. **Kimi K3** is out of every shipped chain (`test/shipped-chains-no-kimi.test.js`) but a user may seat
  it in their own chain.
- **Reasoning effort is never lowered** (owner, 2026-10-05: "NO LOWER EFFORT"). Shipped chains run high; no
  code path may lower a seat's effort (`test/reasoning-never-lower.test.js` scans for it; chain-lint's
  `reasoning-not-high` refuses a shipped chain that does, a user's own chain passes through).
- **No efficacy numbers** about the harness in any user-facing text until something has actually been measured. A qualitative claim the owner has seen and approved in his own words may be printed as his statement; nothing is quantified, and no comparison with another tool is claimed.
- **The README's "Known limits" stay honest.** Delete a limit only when the code makes it untrue, in the same
  commit as the fix; never because it is embarrassing (`test/known-limits.test.js`).
- **The owner's gates.** No paid run (any non-`mock` provider) without the owner's explicit go and a
  `--max-usd` cap; use `chains/mock*.json` otherwise. New or changed prompt wording needs the owner's yes.
  Commit freely; push, tag, release and `npm publish` are the owner's (publish needs his 2FA passkey, from a
  real terminal). No new release unless he asks.
- **A count moves in the same commit as the thing it counts** (chains, tools, providers, skills, the default
  cap): the README, `docs/index.html` and `docs/skills.html` type them by hand, and tests derive the real ones.
- **Never add** `context/`, `tasks/`, `plans/`, `Docs/`, `benchmark/`, `Dockerfile` or `fly.toml` (this tree is a
  curated extraction from a private repo; `Docs/` with a capital D is unrelated to the public `docs/` landing
  page). `tasks/` is gitignored: task files are never committed.
- **Never move harness run output into this repo.** Run folders hold the author's private deliverables;
  `runs/` is gitignored - keep it that way, and never commit a run folder's contents anywhere else.
- **Internal references in code comments and chain descriptions are public on purpose.** Do not "clean" them.
- **Ideas are free to study; code and prose are never copied.** Studying other tools and papers for ideas is
  encouraged: describe an idea in this project's own words, judge it against this project's identity and
  standing exclusions (WANT / MIGHT-WANT / DON'T-WANT), never quote another repo verbatim, never port code from
  a differently-licensed project.
- **Branches.** The default branch is `master`. Work happens on branches; a release lands on `master` as one
  squash commit.
- `Review/` is the maintainer's local, gitignored folder: a path into it may not exist in your checkout.

## Commands

```bash
npm install
npm test                                  # node --test over test/*.js
node --test test/chain.test.js            # one file
node --test --test-name-pattern 'parseJson: raw newline'   # one test

npm run mcp                               # MCP server, stdio transport
npm run dry -- --task tasks/x.md --chain verify   # price a run, call nothing (--dry-run; there is no --dry)
node src/cli.js --task tasks/x.md --chain verify  # a REAL, PAID run: owner's go + --max-usd only
node src/cli.js --resume runs/<id>        # continue a run paused at an external seat
node src/cli.js doctor                    # keys by name, lints every shipped chain, prices; no network
node src/cost.js                          # price a roster of models
npm run ui                                # local run browser (src/ui/)
```

Any chain whose seats are all `provider: "mock"` (`chains/mock*.json`) runs the full pipeline offline for $0
and needs no keys. Use those to exercise plumbing changes before spending money. Exit 3 = paused at an external
seat; exit 5 = an unpriced seat under a cap.

`src/http-server.js` is not in the npm package (since 0.7.8 `package.json` `files` leaves it out and `express` is
a devDependency; `test/package.test.js` pins both); `npm run http-server` runs it from a clone only. Its
`MAX_USD_PER_DAY` is a separate daily cap, unrelated to the per-run cap.

**Dated tables expire on purpose.** The reasoning table, the advice retention table and the price rows turn
`npm test` red when they are old: a release-week chore, not a bug. Regenerate them
(`scripts/refresh-reasoning-table.mjs`, `scripts/refresh-openrouter-prices.mjs`; the failing test names the
table) - never patch an expiry date in a test.

## Architecture

The whole harness is one function, `runChain()` in `src/chain.js`, driven by a JSON config. Everything else is
an entry point into it or a support module.

**Config is the product.** `chains/*.json` are not examples - they are how behaviour is chosen. A chain names its
seats (`criteria`, `skeleton`, `builder`, `reviser`, `handoff`, `critics[]`), the `maxRounds` cap, and feature
flags (`questions`, `proposals`, `debate`, `handoff`, `signoff: "unanimous"`, `panel: "relay"`); `runChain` reads
those flags and skips whole stages. A capability is usually a stage in `chain.js` plus a flag, not a new chain
file. A chain's switches (`signoff_table`, `answer_back`, `debate_hygiene`, `handoff_contract`, `judging`) are listed in
`config/chain-schema.json` (`test/chain-schema.test.js`);
`"judging": "all-roles"` is the explicit override that lets a chain's architects, proposers, deep dive and writer
also vote.

A **seat** is `{ provider, model, maxTokens?, temperature?, extra?, lab? }`. Independence accounting keys off
`labOf(seat)` = `seat.lab || seat.provider`: without `lab`, a seat's lab is its PROVIDER, so set `lab` whenever the
provider is a router or a mock - three OpenRouter seats without it count as ONE lab (with three `lab` values, three);
mock chains put two labs on one provider this way. Blind-panel and debate logic key off it,
so getting `lab` wrong silently corrupts the thing the harness exists to measure.

**Stage flow** (`runChain`, in order): questions → criteria → skeleton → proposals (blind, per lab) → debate
(anonymised posts, then author keep/amend/withdraw) → build → critic/revise rounds under the cap → optional
final edit → handoff. Two termination modes: `first` (any one critic passes) and `unanimous` (every critic signs
off on the *same* draft, else the reviser fixes the union of all objections and the whole panel re-reviews).

**Layers:**
- `src/providers.js` - one adapter shape in, one out. Anthropic speaks the Messages API; every other provider
  shares one OpenAI-chat-completions adapter (`OPENAI_COMPAT`); adding a provider is usually one line. `mock` is a
  fake provider with named models (`mock-unreadable`, `mock-provider-error`, `mock-proposer-empty`) that each
  exercise a failure branch offline.
- `src/roles.js` - the WORDING of every system and user prompt; never inline in `chain.js`. A scope rule is
  swapped by template (`criticSystem(open)`, `criteriaSystem(open)`).
  `src/handoff-prompt.js` is the one place the handoff prompts are ASSEMBLED, from `roles.js`'s words.
  `HANDOFF_SYSTEM` reads an optional `## Available tools` section from the task file; its real content is the
  restraint: exact names only, never invent a tool or command line, assume nothing when the section is absent.
  Tests pin how prompts are built (`test/roles.test.js`); the mock provider ignores prompt text, so no test
  shows how a model answers changed wording.
- **Held prompt text.** Wording drafted but not yet approved is test data in `test/held-prompts/held.js`;
  `src/held-roles.js` returns a held function only once `src/roles.js` exports one of that name, and
  `setPromptSpy` (chain.js) lets a test read the prompt a seat is sent. Every held sentence must also be in
  `roles.js` once recorded; `test/held-prompts.test.js` compares the two.
- `src/cost.js` - `pricing.json` lookup, `costOf`/`summarise` (measurement, after the fact) and
  `worstCaseOf`/`wouldBreach` (projection, before the fact - what the cap enforces against).
- `src/cli.js` - flags, `.env` loading, the run folder, the stage cache.
- `src/reasoning.js` + `src/reasoning-table.json` - per model, which field means high, the model's default and
  its largest reply (sources in the file; written by `scripts/refresh-reasoning-table.mjs`); `loweringReasons`
  is the one list of settings that lower effort.
- `src/key-env.js` - the one reader of provider keys: the plugin dialog's `COUNCIL_PLUGIN_<LAB>_API_KEY`, then
  the standard variable, then `.env`. Empty, blank or a `${user_config.` placeholder counts as unset; a key with a
  control character is "malformed" (never sent; `council doctor` says so).
- `src/env-file.js` - the one reader of a project's `.env`. It never sets `COUNCIL_PLUGIN_*`, process-level
  variables (`NODE_*`, `LD_*`, `PATH`, proxies), the loopback-key switch or an operator-only setting, and names
  each refused name once (`.env` is project-writable).
- `src/draft-disputes.js` (`parseDisputes`, `stripDeclined`) - **every reader of a builder's or reviser's raw stage text must go through
  `stripDeclined`** (a test scans `src/` for readers that skip it). The build stage strips DECLINED lines only; a
  reviser also a trailing Disputed block.
- **The send path (advisor add-on):** `src/mcp/advice.js` (`council_quote` / `council_advise`);
  `src/send-path.js` + `send-path-refusals.js` + `send-profiles.js` (one quote → approve → start path and what
  refuses a send); `src/gate.js` + `gate-ledger.js` + `gate-cli.js` (the approval gate and its hash-chained
  ledger; the terminal answer is `council gate answer`); `src/advice-brief.js` + `advice-mask.js` (the brief, the
  masking, the exact text a person reads); `src/advise.js` (blind, then debate); `src/advice-guards.js` (limits
  and the cross-run ledger); `src/advice-run.js` + `advice-stop.js` + `stop-files.js` (the run folder and the stop
  rule); `src/mcp/untrusted.js` + `return-path.js` (what comes back to the agent is marked untrusted text).
- **The contract record:** `src/contract-lint.js`, `contract-record.js`, `contract-cli.js`, `contract-draft.js`,
  `src/mcp/contract.js`. Versions live in `runs/<id>/contract/`; the gate ledger is the authority;
  `council contract draft|lock|show|check|amend`; MCP `contract_read` / `contract_amend`.
- **Cost honesty:** `src/unpriced.js` refuses an unpriced seat under a cap; `src/spend-reservations.js` writes a
  call's worst case before it is sent; `estimateChainRows(..., { maximum: true })` gives the dry run's second
  figure; `scripts/model-caps-report.mjs` generates `maintainers/MODEL-CAPS.md` and a test diffs it.
- **Debate pieces:** `src/objection-ids.js`, `answer-back.js`, `post-quotes.js`, `criteria-ledger.js`,
  `milestones.js`, `lanes.js`.
- `src/mcp/server.js` - the same operations as MCP tools. It **spawns `src/cli.js` detached** so a long run
  outlives the tool call; the client polls `run_status`. It does not run chains in-process.

**The run folder is the database.** Each run writes `runs/<iso-timestamp>/`: `run.json` (how to resume),
`<label>.md` + `<label>.usage.json` per stage, `run.log`, `deliverable.md`, `BOARD.md`, `HANDOFF.md`,
`report.json`, and where used `contract/` and `spend-reservations.jsonl`. There is no state outside the run
folder.

**`report.json` is the machine-readable board; `BOARD.md` is the same thing for people.** Anything built on a run
reads the JSON - `proposals[]`, `debate.posts[]` (`by`/`on`/`stance`/`merge_with`), `debate.replies[]`
(`keep`/`amend`/`withdraw`), `signoff[]`, `scoreboard`, `totals`: together a directed graph with verifiable edges.
Nothing may parse `BOARD.md`'s headings; the README says so (a council once specified a markdown parser because
the JSON was undocumented). Its shape is a public contract (`schemas/report-v1.json`,
`test/report-schema.test.js`): adding fields is fine, renaming or removing one is a breaking change.

**Resume and the stage cache.** `setCache()` gives `chain.js` a `get(label)` that replays a stage from
`<label>.md` on disk at zero cost: a replayed stage makes no new paid call, the stages still to run do. Stage
labels must stay stable - renaming a label orphans every run that paused before it.

**The spend cap is enforced in `invoke()`, before the call.** `setBudget(cap)` arms a per-run ceiling; `invoke()`
projects the worst case for the stage it is about to run (whole prompt as input, whole `maxTokens` as output,
doubled for Anthropic's retry) and throws `BudgetExceeded` rather than spend past it. Replayed stages count
toward the ceiling, so resuming cannot lap it. **Any new paid call must go through `invoke()` or it escapes the
cap entirely.** An unpriced seat projects $0, so a run under a cap refuses one before anything is sent
(`unpricedSeats` in `src/unpriced.js`, exit 5; `invoke()` throws `UnpricedSeat` as the backstop); the way out is a row in the project's `pricing.user.json` (`src/price-table.js`, the one price
source: it adds a model or raises a shipped price, never lowers one). `mock` (hence `mock-budget`, with fixture prices, tests the cap offline), `external` and `ollama`
are exempt (`needsPrice` in `src/cost.js`).

**External seats pause the run.** `provider: "external"` throws `ExternalPause` (thrown, not returned, so control
flow stays linear). The CLI catches it, writes `NEEDS-<stage>.md` with both prompts, and exits 3. The run resumes
once `<label>.md` exists. The MCP path exposes the same thing as `external_prompt` / `submit_stage`. A paused run
is not a stuck run.

**Model output is assumed to be broken.** `parseJson` in `chain.js` repairs specific, observed failure modes
(unescaped quotes inside markdown-quoted spans, raw newlines in string values) with real string-state tracking
rather than regex, and deliberately still fails on genuinely garbled output. `classifyUnreadable` separates
provider errors from truncation from malformed JSON. `invoke()` retries once, at the same reasoning effort and a
bigger cap, when an Anthropic seat burns its whole `maxTokens` on thinking (never lower; see Rules). Every one of
these encodes a real incident - the comments name the run and the date. Read the comment before changing the
behaviour, and keep the regression tests in `test/chain.test.js`, built from the actual broken replies.

## Cross-run spend (`src/spend.js`)

`spendReport()` answers "what have I spent across every run". It is **derived, never recorded**: every figure is
read back out of `runs/<id>/`. Do not add a ledger outside the run folder: it would be a second copy of the truth
that can drift, need a write path that can fail mid-run, miss runs that predate it, and outlive run folders a user
deleted because they were sensitive. So a deleted run folder's spend disappears from the report, on purpose; runs
with no `report.json` (still going, or stopped by the cap) are counted from their `<label>.usage.json` files. Spend
output carries the chain and the cost only - never the task path or any run content. A missing, unreadable or
corrupt `runs/` gives a usable answer, never an error, and `spendReport` never writes to disk (a test pins both).

**The one recorded figure:** `runs/<id>/spend-reservations.jsonl` (`src/spend-reservations.js`, schema
`spend-reservations/1`). `invoke()` appends a `reserved` line (the call's worst case, label, seat) with one write
and an fsync BEFORE it sends, and a `settled` line when the call returns or throws. A `reserved` line with no
`settled` line is a call in flight when the process died: the provider may have billed it, so it stays charged at
its worst case in a resume's cap, `--spend` and the spend report (`costOfRun` adds it). It lives and dies with the
run folder; a missing, torn or corrupt file reads as "none"; output carries amounts only. If a reservation cannot
be written, the call is not sent. There is no command that reconciles an unsettled reservation, on purpose: the
figure errs high.

## Skills (`skills/`)

`skills/` ships generic, public skills alongside the harness; they are not part of it. The wider scope is the
owner's deliberate call; do not re-litigate it.

- **The bar for any skill:** generic (no single project's stack, rules, paths, session names or decisions),
  public, BYOK-consistent. Game-engine and DCC skills qualify as neutral, dated, graded facts (owner,
  2026-10-05); vendors (Unity, Unreal, Blender, published talks) may be named for facts only.
- **Before a skill ships:** grep it for leftover content - source project names, internal paths, private seat
  build names, third-party text.
- The criteria-tier rule is owned by `verification-and-critique`; other skills point to it.
- **The folders are the list.** `skills/README.md` (the catalog) and `docs/skills.html` enumerate the skills by
  hand; `test/skills-catalog.test.js` derives the real set from the folders and fails if either drifts.
  `docs/skills.html` follows the landing-page rules below.

## The landing page (`docs/`)

`docs/index.html` is a static treatment of the README plus self-hosted fonts. GitHub Pages is off, so it is not
served anywhere; the live THC page is the Sower Industries site's own https://sower-industries.de/en/THC/. Two
properties must survive any edit (of `index.html` and `skills.html`):

- **No scripts and no third-party requests.** Never reintroduce a runtime or hotlinked fonts: hotlinked Google
  Fonts are a live legal problem for the German site this design is shared with.
- **Its numbers are claims about this repo.** The counts (chain configs, MCP tools, providers, default cap) are
  typed in; `test/landing-page.test.js` derives each from the repo and fails if the page disagrees, and checks
  the page stays script-free and third-party-free.

`rel=canonical`, `og:url` and every homepage link in the repo name https://sower-industries.de/en/THC/ (install
page /en/THC/2/; `/MCP`, `/en/MCP/` and `/en/Council/` are 301s to it). If GitHub Pages is ever turned back on,
revisit the canonical.

## How sessions work together (the owner's C&C workflow, published on purpose)

This is the owner's method for building this repo with several Claude Code sessions at once, published
deliberately (owner, 8 Oct 2026: it might help someone); the master copy lives on the owner's private board, and this is
its public copy as of 26 Oct 2026. **It applies only when the owner assigns a session a C&C or builder role**;
every session follows the Rules above. **C&C** is the owner's Command-and-Control session: it routes work to builder
sessions, reviews each milestone and answers PASS or FIX. "Advisor" here means the Claude Code session's advisor
model, not this product's advisor add-on.

1. **Roles.** C&C routes and decides; builder sessions build; the owner talks only to C&C. Dispatch means
   dispatch: C&C does not build a dispatched job itself.
2. **C&C consults its advisor before anything goes to a builder** that carries a fix, a ruling, a go, a
   PASS/FIX or a change to what it builds; also on a milestone's proposed defaults and at each milestone report
   before the verdict. Plain acknowledgements are exempt. If something went out without it: consult now, send a
   correction, and say so plainly. When an advisor call fails (rate-limited, overloaded, any error), the session
   waits 60 to 90 seconds (a background timer, not a blocking sleep) and calls it again, as often as it takes: the
   step that needs the consult waits and nothing goes out without it, while work that needs none goes on. This holds
   for C&C, every builder and every sub-agent.
3. **The advisor line, checked on both sides.** Every such C&C message ends with
   `Advisor: consulted - <what it changed>` ("no change" when it changed nothing; never a claim of a consultation
   that did not happen). Whatever its length, a message that contains a GO, a PASS, a FIX, a ruling or a
   correction to one carries the line; only "noted", "received", "thank you" and "wait for X" are plain
   acknowledgements. A builder that receives a fix, ruling or go without the line replies "advisor line missing?"
   and acts on nothing in it until the line arrives. A session with no advisor says so; it never claims a
   consultation.
4. **Builders use their advisor** at the start, before committing to an approach, at each important step, when
   stuck, before every commit and before every report; each report says what the advisor flagged. Also before
   writing any wording a person or a model will read (it stays marked A-DRAFT until the owner approves it), and the
   advisor reads the list of expected failures before a deliberately failing tree is built. No consult log is kept:
   an instruction from C&C to consult is enough.
5. **Skills.** Each role has a standing set, so a brief names a skill only when it adds one. C&C:
   `backend-developer`, `frontend-developer`, `verification-and-critique`, `context-and-handoff`,
   `tool-and-action-discipline` and `task-scoping`. A builder on this repo: the same six plus
   `research-and-sourcing`, plus `drafting` and `line-editing` when the piece is public text (every CLI or MCP
   sentence a person reads counts). Catalog: `skills/README.md`.
6. **After any `/compact`** (or a restart), a session re-reads its instructions, the testing and machine rules
   below, its own state file and its skills, then tells C&C (C&C tells the owner): its commit and state, the
   skills it re-read, one rule from two of them in its own words, what its advisor said, and its next three
   steps. A session that cannot produce this has lost the rules. A session writes its state file before a compact or
   a close, or when a standing rule or its plan changes; never per report, per message or per unit.
7. **Builder reports**, once per finished unit: the commit SHAs; every exit check with its command and output;
   per-file test counts (a file that did not run is a blank row) and the test arithmetic; evidence that a new or
   changed test can fail: one red run (before the fix, or against a known-bad input: the `backend-developer` skill's
   rule), never deliberate breakages applied in place, mutation scripts or reruns of earlier milestones' checks
   (owner, 11 Oct 2026: "a normal amount of testing"); one probe that drives the real verb, with its output; then
   the advisor's flags and the items to flag. Then wait for PASS/FIX. **Per commit:** one set on the tree that is
   committed (a later change to comments alone, or to the commit message, calls for no re-run): the new or changed
   test files, the tests that import a changed export and the source scanners, one row per file (a single multi-file
   `node --test` run flattens results and hides a file that never loaded), plus one failing run for each new or
   changed test (one deliberately failing tree, not the committed one, may carry several). **Not run:** a
   confirmation run after a commit, a run on a tree that has been replaced, a full suite for a single unit, a re-run
   of a failure that was only a timeout (it is recorded with its duration, not as a pass; the next full suite
   decides). **Full suites** run at three points: when the build is ready for review, after the reviewed wording is
   applied, and before the merge; the per-commit set runs in between. A heads-up before every full run, with
   absolute log paths, and a check that the process and the log exist after launch.
8. **C&C reviews** in its own worktree (never the shared checkout), against the plan's own exit list (not only the
   builder's map of it). At every SHA-stop review it reads the diff and the builder's result files, checks that the
   tree line of each set it relies on matches the tree under review (or differs from it only as rule 7 allows), and
   says which checks it ran and which it read; it does not run a full suite for a single unit. A SHA-stop is a unit
   that touches money, approvals, records, the MCP surface or earlier accepted code; builders continue while C&C
   reviews anything else. Every PASS walks the obligations of the go message by SHA, reads the log tails and the
   names of skipped tests, and checks the owner's gates (see Rules): prompt words need the owner's yes, no paid run
   without a go and a cap, push and release belong to the owner, no efficacy numbers, no Grok, reasoning never
   lowered, counts move with the thing they count.
9. **Mistakes are disclosed at once, in plain words,** by whoever made them.
10. **Clock times: check the time each time** (owner, 11 Oct 2026). A clock time is written only in the same action
    that reads the clock: in a shell, `$(date ...)` inside the command that writes it, never a typed digit; before a
    message that names a time, read the clock as the step right before it; otherwise write "now" or name the event
    ("after the M5 PASS") instead. A time relayed from another session is checked against the clock first. A session
    that writes a time without reading the clock in the same step reports it as a slip.
11. **The shared machine.** Sessions share one computer. Every test run, probe or dry run that takes longer than a
    few seconds goes through one lock and a CPU cap at the lowest priority, so the sessions together stay inside
    a stated share of the machine. Kill a process only by its PID, never by a pattern (a pattern kill has hit
    another session's run). A commit that was reported is never amended: fix-ups go on top.
12. **Sub-agents.** A builder may use up to three, for work whose input is big and whose output is a table or a trace
    (reading, tracing, mapping, counting, dated look-ups), each with its own advisor used regularly; its report ends
    with the advisor's flags. An agent gets a big slice and runs until the slice is done: done is a result (every
    file classified, every site traced, every id sourced), never a size or time cap, and an agent that cannot finish
    returns what it has with the open items named. Three agents on three slices of one big question is the good case.
    A sub-agent never commits and never writes a state or report file; one that edits works in its own worktree;
    none runs a test suite. A sub-agent's result is a delegate's report: the builder checks its load-bearing claims
    before they enter its own report.
