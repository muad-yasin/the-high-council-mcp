# Architecture detail

The parts of this repository's architecture that one kind of work needs, moved word for word out of `CLAUDE.md`.
`CLAUDE.md` keeps what a run leaves on disk and each rule that code outside its own part can break; a part that
stayed there whole is not repeated here. How a run flows is in `maintainers/RUN-FLOW.md`. Code comments and
`maintainers/HANDOFF.md` cite the section names "Architecture", "Cross-run spend" and "The one recorded figure" as
`CLAUDE.md`'s: the first two are sections there, and the third is named in its "Cross-run spend" section and stands
in full below.

## Architecture

**Entry points**

- `src/cli.js` - flags, `.env` loading, the run folder, the stage cache.
- `src/mcp/server.js` - the same operations as MCP tools. It **spawns `src/cli.js` detached** so a long run
  outlives the tool call; the client polls `run_status`. It does not run chains in-process.

**Providers, keys and reasoning**

- `src/providers.js` - one adapter shape in, one out. Anthropic speaks the Messages API; every other provider
  shares one OpenAI-chat-completions adapter (`OPENAI_COMPAT`); adding a provider is usually one line. `mock` is a
  fake provider with named models (`mock-unreadable`, `mock-provider-error`, `mock-proposer-empty`, `mock-near-json`,
  `mock-early-closer`, `mock-retyped-table`, `mock-http-503-all`) that each exercise a failure branch offline.
- `src/key-env.js` - the one reader of provider keys: the plugin dialog's `COUNCIL_PLUGIN_<LAB>_API_KEY`, then
  the standard variable, then `.env`. Empty, blank or a `${user_config.` placeholder counts as unset; a key with a
  control character is "malformed" (never sent; `council doctor` says so).
- `src/env-file.js` - the one reader of a project's `.env`. It never sets `COUNCIL_PLUGIN_*`, process-level
  variables (`NODE_*`, `LD_*`, `PATH`, proxies), the loopback-key switch or an operator-only setting, and names
  each refused name once (`.env` is project-writable).
- `src/reasoning.js` + `src/reasoning-table.json` - per model, which field means high, the model's default and
  its largest reply (sources in the file; written by `scripts/refresh-reasoning-table.mjs`); `loweringReasons`
  is the one list of settings that lower effort.

**Cost**

- `src/cost.js` - `pricing.json` lookup, `costOf`/`summarise` (measurement, after the fact) and
  `worstCaseOf`/`wouldBreach` (projection, before the fact - what the cap enforces against).
- **Cost honesty:** `src/unpriced.js` refuses an unpriced seat under a cap; `src/spend-reservations.js` writes a
  call's worst case before it is sent; `estimateChainRows(..., { maximum: true })` gives the dry run's second
  figure; `scripts/model-caps-report.mjs` generates `maintainers/MODEL-CAPS.md` and a test diffs it.

**The contract and the debate**

- **The contract record:** `src/contract-lint.js`, `contract-record.js`, `contract-cli.js`, `contract-draft.js`,
  `src/mcp/contract.js`. Versions live in `runs/<id>/contract/`; the gate ledger is the authority;
  `council contract draft|lock|show|check|amend`; MCP `contract_read` / `contract_amend`.
- **Debate pieces:** `src/objection-ids.js`, `answer-back.js`, `post-quotes.js`, `criteria-ledger.js`,
  `milestones.js`, `lanes.js`.

**Prompt wording**

- **Held prompt text.** Wording drafted but not yet approved is test data in `test/held-prompts/` (`held.js` and
  the other batches up to 0.8.3, then one `held-084-<x>.js` per 0.8.4 lane); `src/held-roles.js` returns a held function
  only once `src/roles.js` exports one of that name, and `setPromptSpy` (chain.js) lets a test read the prompt a
  seat is sent. Every held sentence must also be in `roles.js` once recorded; `test/held-prompts.test.js` compares
  the batches up to 0.8.3, and a 0.8.4 lane's batch is compared in its own `test/held-prompts-084-<x>.test.js`. The same
  file checks every held file from the folder: no name is drafted in two held files, and each 0.8.4 held file has
  its partner test.

**Reading what a seat wrote**

- **The repair pause (0.8.4):** `src/near-json.js` (the pause on disk; the check a repair must pass, `acceptanceFor`, shared by the
  stage cache and MCP `repair_reply`; the NEEDS texts; `originals/`, where a repaired reply's original is kept and no record
  reader looks) and `src/repair-reply.js` (the tool's work).

**The approval gate, and what the advice add-on left behind**

- **The approval gate:** `src/gate.js` + `gate-ledger.js` + `gate-cli.js` (the approval gate and its hash-chained
  ledger; the terminal answer is `council gate answer`); `src/mcp/untrusted.js` + `return-path.js` (what comes back to
  the agent is marked untrusted text).
- **The advice add-on is gone (0.8.4).** Nothing in THC starts an advice call, and a chain with an `advise` block is refused (`chain-lint` rule `advise-removed`, `cli.js`, `start_run`). What stays is read-only: `src/stop-files.js` `isAdviceFolder` (an old advice run folder is never resumed, handed off or counted as a passed plan), the gate ledger's old event names (`sent`, `stopped`, `more_material_requested`, so old ledgers still verify), and the `advise` skip in `src/metrics.js` and `src/verdict-stats.js`. `src/send-path.js` keeps only the answerer of the MCP server's typed-limit and raise dialogs (`capGateScreen`, `capGateStatus`, `answerCapGate`, `openRaiseApproval`, `raiseFate`).

## The spend cap

**The spend cap is enforced in `invoke()`, before the call.** `setBudget(cap)` arms a per-run ceiling; `invoke()`
prices the call it is about to send at its expected cost (`expectedCallUsd` in `src/cost.js`: the whole prompt as
input, the dry run's typical output for that kind of call, one attempt), adds it to what is counted and to the
expected cost of the calls in flight (`reservedExpected`), and throws `BudgetExceeded` rather than spend past the
ceiling. A re-ask, a `-retry` and the thinking retry of an Anthropic seat are checked at the expected cost of the
call they repeat (`repeatExpectedCallUsd`); a call with no expected size anywhere (a merge, a full revise, the
conflict decider, the allocator) and an answer-back call (`-answered`, `-question`: not a re-ask) are gated at
their worst case (whole prompt as input, whole `maxTokens` as output, doubled for Anthropic's retry).

So a run can end above its ceiling when its last calls write more than expected: a call checked at an expected size
can write more than that, up to its whole `maxTokens`. A repeat that costs more than its expected cost is one case of
this; a long call whose real size passes a price step its estimate did not reach is another. What a call reserves on disk
(`spend-reservations.jsonl`) before it is sent, and what a call in flight at a crash is charged, stay its worst
case. Replayed stages count toward the ceiling, and so do an earlier sitting's set-aside stages, unsettled reservations and settled calls with no usage file: a resume does not lap it, apart from one case `KNOWN-LIMITS.md` names (a paid stage file the resumed run never asks for again); the other case named there counts a call high, not low.

**Any new paid call must go through `invoke()` or it escapes the cap entirely.**

An unpriced seat projects $0, so a run under a cap refuses one before anything is sent (`unpricedSeats` in
`src/unpriced.js`, exit 5; `invoke()` throws `UnpricedSeat` as the backstop); the way out is a row in the project's
`pricing.user.json` (`src/price-table.js`, the one price source: it adds a model or raises a shipped price, never
lowers one). `mock` (hence `mock-budget`, with fixture prices, tests the cap offline), `external` and `ollama` are
exempt (`needsPrice` in `src/cost.js`).

## Cross-run spend: what is recorded

**The one recorded figure:** `runs/<id>/spend-reservations.jsonl` (`src/spend-reservations.js`, schema
`spend-reservations/1`). `invoke()` appends a `reserved` line (the call's worst case, label, seat) with one write
and an fsync BEFORE it sends, and a `settled` line when the call returns or throws. A `reserved` line with no
`settled` line is a call in flight when the process died: the provider may have billed it, so it stays charged at
its worst case in a resume's cap, `--spend` and the spend report (`costOfRun` adds it; when a usage file also carries its id the call counts once, at the larger of the two, as `reserved_unsettled`). A `settled` line whose
call left no usage file (the process ended between the two writes) and whose `reserved` line is in the folder is counted too, at its settled figure (`src/counted-spend.js` is the one reader of all of it, and every record names its `basis`). A `settled` line with no `reserved` line is damage to the file, not a call (a call is reserved, with an fsync, before it is sent): it is counted nowhere, and `council --spend` names it. It lives and dies with the
run folder; a missing, torn or corrupt file reads as "none"; output carries amounts only. If a reservation cannot
be written, the call is not sent. There is no command that reconciles an unsettled reservation, on purpose: the
figure errs high. A `settled` line may carry `reachedProvider: true`: the attempt's request reached the provider
(an HTTP 5xx answered) though no usage figure came back, so its usd is THC's count (a typical cost for the call) and the bill is unknown.

`runs/<id>/network-resumes.jsonl` (`src/superseded.js`, schema `network-resumes/1`) is not a figure: it records
events, one line for each automatic resume after a network error of a seat that does not bill (a seat that bills
leaves a `resumed` field on its charge file instead). No spend figure reads it and nothing counts from it; a reader added
later must read a missing, torn or corrupt file as none.
