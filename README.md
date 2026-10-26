<div align="center">

<img src="https://raw.githubusercontent.com/muad-yasin/the-high-council-mcp/master/docs/logo-diamond.png" alt="Sower Industries diamond logo" width="120">

# THE HIGH COUNCIL

"A beginning is the time for taking the most delicate care that the balances are correct"<br>
— Frank Herbert, *Dune*

---

You bring an idea for a new project, a feature or any kind of update.<br>
THC debates on your idea and the Software Engineering behind it.<br>
Through multiple debate rounds and 3 layers of judges, they catch a lot of things that even your strongest initial draft-writing LLM will not have thought about.<br>
The goal is to get everyone to work together, in harmony and with manners. Exact effectiveness numbers are unmeasured by decision.

Update 0.8.3 brought: Recursive Councils - "Plans within Plans within Plans"

[![License: MIT](https://img.shields.io/badge/license-MIT-gold)](LICENSE)
[![npm](https://img.shields.io/npm/v/the-high-council?label=npm&color=gold)](https://www.npmjs.com/package/the-high-council)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-gold)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.muad-yasin/the-high-council)

[Website](https://sower-industries.de/en/THC/) · [Pricing](#pricing) · [AI-Readme (the full text)](AI-README.md) · [Changelog](CHANGELOG.md) · [Known limits](#known-limits-stated-plainly)

<img src="https://raw.githubusercontent.com/muad-yasin/the-high-council-mcp/master/media/council-water-collector.gif" width="480" alt="The council chamber from the project website: the debate graph of a real recorded run (a water-collector design), with the Claude seat in the middle.">

</div>

## Try it in 30 seconds

    npx the-high-council council demo

No keys, no network, $0. Add it to Claude Code as an MCP server:

    claude mcp add council -- npx -y the-high-council council --mcp

For Claude Desktop, download the `.mcpb` bundle (`the-high-council-<version>.mcpb`) from [Releases](https://github.com/muad-yasin/the-high-council-mcp/releases/latest).

## Contents

- [Your first ten minutes](AI-README.md#your-first-ten-minutes) · [Words used here](AI-README.md#words-used-here)
- [How it works](AI-README.md#how-it-works) · [Reading a run with a program](AI-README.md#reading-a-run-with-a-program)
- [Requirements](AI-README.md#requirements) · [Setup](AI-README.md#setup) · [Quick start (CLI)](AI-README.md#quick-start-cli) · [Quick start (MCP)](AI-README.md#quick-start-mcp)
- [The spend cap](AI-README.md#the-spend-cap) · [Pricing](#pricing) · [Chains](AI-README.md#chains)
- [How this was built](AI-README.md#how-this-was-built) · [Skills](AI-README.md#skills)
- [Known limits](#known-limits-stated-plainly) · [Privacy](#privacy) · [Accessibility](AI-README.md#accessibility) · [Reporting a bug](#reporting-a-bug) · [License](#license)
- [AI-Readme (the full text)](AI-README.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Agent skills](skills/README.md) · [Personas](PERSONAS.md) · [Contributing](CONTRIBUTING.md)

## What you get

1. **Criteria before planning.** Your request becomes a short list of yes/no checks the plan has to pass, written before anyone plans.
2. **Blind proposals and a recorded debate.** Each lab proposes without seeing the others, then reads the rest with the names hidden and posts support, an objection or a merge. Every author then keeps, amends or withdraws its own proposal, on the record.
3. **Review and revision.** A panel of judges checks the draft against the criteria, and a failed check sends it back for a revision. The planning chains judge in three layers. An objection that was never settled stays on the record; nothing is averaged away.
4. **A handoff for building.** `HANDOFF.md` is written for whoever builds the plan: the acceptance checks and the instructions a coding agent works from, and in the planning chains the milestones too.

Every run writes a folder, `runs/<id>/`:

| File | What it gives you |
|---|---|
| `deliverable.md` | The plan |
| `BOARD.md` | The whole debate: every post, every withdrawal |
| `HANDOFF.md` | The build instructions and the acceptance checks, for the coding agent |
| `report.json` | The same board, structured, with the token and cost accounting |

> **On what this does and doesn't claim.** This repo publishes the mechanism: the chains, the seat
> rosters, the stage order. We did have the Council measured by frontier AI on the run that planned
> update 0.8.3: the plan improved in every measured rubric but one, and that one was that it got
> longer and harder to read. What the repo does, concretely, is make disagreement between models
> *visible and recorded* instead of averaged away - you can read who objected to what, who withdrew
> a proposal under argument, and who held their position.

<a id="setup"></a>
<a id="quick-start-cli"></a>

## Your first run

The quick-start chain, `plan-default-opro-council`, runs on **one [OpenRouter](https://openrouter.ai) API key**: one account that reaches many labs' models. Put the key in a file called `.env` in the folder you run from:

```dotenv
OPENROUTER_API_KEY=your-key-here
```

Add `.env` to your `.gitignore` (and `runs/` if your ideas are private). Then:

```bash
npx the-high-council init
npx the-high-council doctor
```

`init` writes `tasks/my-first-task.md`. Edit it into your own idea, in plain words: what you want, the constraints that matter, and what done looks like. Price it, then run it:

```bash
npx the-high-council --task tasks/my-first-task.md --chain plan-default-opro-council --dry-run
npx the-high-council --task tasks/my-first-task.md --chain plan-default-opro-council --max-usd 10
```

<a id="the-spend-cap"></a>

The first command spends nothing. A paid run starts only after **you type its spending limit** on a screen; `--max-usd 10` puts $10 there as the suggestion. A run can also pause and wait for an answer from your Claude Code session, or from you; a swing between two judge layers' objections is one such pause.

A run that stops at its limit keeps every stage it paid for. `npx the-high-council --resume runs/<id>` continues it: the screen asks for a new total above what the run has counted, and the finished stages cost nothing the second time.

<a id="quick-start-mcp"></a>

## Use it with your coding agent

Runs as an **MCP server** (so a coding-agent session such as Claude Code can drive it) or as a **CLI**. Bring your
own API keys. Nothing is resold, nothing is hosted for you, and your keys go only to the
providers you choose, never to us.

For **Claude Code**:

```bash
claude mcp add council -- npx -y the-high-council council --mcp
```

Or as a Claude Code plugin, which registers the same server and also installs the skills in
[`skills/`](skills/README.md):

```bash
claude plugin marketplace add muad-yasin/the-high-council-mcp
claude plugin install the-high-council@the-high-council
```

**Claude Desktop:** download and open `the-high-council-<version>.mcpb` from [Releases](https://github.com/muad-yasin/the-high-council-mcp/releases/latest).

[Other MCP clients](docs/mcp-clients.md) · [Plugin settings and keys](AI-README.md#quick-start-mcp) · [Standalone binaries](AI-README.md#standalone-binaries)

<a id="chains"></a>

## Pricing

What each shipped chain costs per run, in US dollars. **Expected** and **Upper estimate** are worked out by the code
before anything is sent, from the shipped price table and the chain's own size estimates. `council doctor` prints
the same figures; `--dry-run` prices your own task, and a longer task costs more. **Upper estimate** prices every planned call at its
whole output allowance, with every allowed round used. It leaves out re-asks and retries, so it is not a
ceiling: the limit you type is what stops a run. **Tested** is what real runs cost; – means no run has been reported yet. Seats your Claude Code session answers cost $0 here, because they run on your own
subscription. The two `advise-` rows show what the advice add-on itself shows and enforces: a brief at its
48,000-character limit, and **Upper estimate** includes one retry of a reply that was cut off.

<!-- pricing:start (generated by scripts/pricing-table.mjs: edit maintainers/run-costs.json or the chains, then run it) -->

| Chain | Expected | Upper estimate | Tested (real runs) |
|---|---|---|---|
| **Planning chains** | | | |
| `plan-mini-council` | $1.51 | $5.27 | – |
| `plan-medium-council` | $7.16 | $23.04 | – |
| `plan-high-council` | $25.89 | $272.24 | – |
| **Variants** | | | |
| `plan-claude-council` | $0.00 | $0.00 | – |
| `plan-mini-council-sol-session` | $1.41 | $4.46 | – |
| `plan-default-opro-council` | $2.95 | $16.26 | – |
| **Chinese-lab alternatives** | | | |
| `plan-china-mini-council` | $1.69 | $6.15 | – |
| `plan-china-medium-council` | $5.78 | $17.71 | – |
| `plan-china-high-council` | $18.64 | $175.72 | – |
| **Advice add-on** | | | |
| `advise-single` | $0.08 | $1.32 | $0.03–$0.15 (3 runs) |
| `advise-standard` | $0.75 | $1.40 | – |
| **Other** | | | |
| `local-ollama` | $0.00 | $0.00 | – |
| `verify` | $0.48 | $3.20 | – |
| `daily7-sub-a` | $1.39 | $5.06 | – |

<!-- pricing:end -->

With recursive councils, a tree at the default limits runs up to 12 councils (the root and 11 sub-plans), each on the chain you name for it, so with one chain throughout it can cost up to 12 times that chain's figures; `council tree start --dry-run` prints the projection for your own task and chains, and the limit you type stops the tree.

Ran one of these chains? [CONTRIBUTING.md](CONTRIBUTING.md#send-a-run-cost) says how to send us the figure.

## Recursive Councils: Plans within Plans within Plans

**New in 0.8.3.** A milestone of the plan can get a Council of its own, and its milestones can again, so the runs form a tree under one root plan. You type the tree's spending limit once, and every sub-plan runs under it. A sub-plan inherits the acceptance criteria its parent delegates to it and cannot narrow the ones that hold for the whole tree. Approvals, and the decisions taken when a run gets stuck, are recorded, and the record says who made each: you, or the Claude Code session driving the tree.

Price a whole tree before anything is spent:

```bash
npx the-high-council tree start --task tasks/my-first-task.md --chain plan-mini-council --child-chain daily7-sub-a --dry-run
```

[Tree commands and exit codes](AI-README.md#exit-codes)

## Known limits, stated plainly

- **The panel signs one draft; later stages can change what you receive, and nobody re-reads it.** The dispute pass, the post-sign-off challenge and the final edit are model edits made after
  the last review, and the dissent and cold-read blocks are written by the harness. The run labels this and does not repair it: `report.json` has `signed_text` and `delivered_text`
  (hashes, `same_as_signed`, `changed_by`), `BOARD.md` says so when it applies, and `HANDOFF.md` opens with a banner when a model edit changed the text after the panel signed it (a run the panel did not sign keeps its own "not a signed-off plan" banner). A cold-read or dissent block the harness adds is named in `delivered_text.harness_notes` and gets no banner. The panel is not run
  again on the changed text (that would be a further paid pass per run), and `run_status` says so after "every lab signed off" when the delivered text differs (`delivered_text.same_as_signed` in `report.json`).
- **An early finish needs a reviser that is your own session.** On a layered chain the reviser may end its reply with `EARLY-FINISH: <why>`, and the top layer then decides whether the run stops there; that
  works only when the reviser seat is your Claude Code session (`external`). A chain whose reviser is an API seat has no early finish: the line is removed from its text and the log says so. An early finish is not
  agreement: `passed` is false, the run exits 22, and every open objection is a named builder task at the end of `HANDOFF.md`.
- The spend cap is enforced against a **worst case**, not a prediction: the whole prompt billed as
  input plus the seat's entire `maxTokens` budget billed as output (for Anthropic seats, plus the
  bigger cap of the one retry they may make). Real stages almost never cost that much, so a run can stop with headroom
  left. That is the intended trade - resume it: a paid run asks for a new, higher total on the limit screen (a chain with no paid seat takes `--max-usd`).
- The dry run (`--dry-run`, MCP `dry_run`) prices the task alone and does not read `--context`
  documents, so for a run with context its estimate is too low. The spend cap is not affected: it
  checks every real prompt, context included, before each call.
- A seat whose model has no price, neither in `src/pricing.json` nor in your project's `pricing.user.json`, cannot be held by a spend cap, because the cap would count every call to it as $0. Since 0.8.2 a run **refuses** such a
  seat before it sends anything (exit 5; the message names the seat and, since 0.8.3, the way out: add a row for it to `pricing.user.json` in your project folder, for example `{ "openrouter/vendor/model": { "in": 1.0, "out": 4.0 } }`, in US dollars per million tokens; your row can add a missing price or raise a shipped one and can never lower a shipped one, and a file that cannot be read in full is refused as a whole), and
  `--dry-run` shows the same refusal at $0. `mock`, `external` and `ollama` seats are exempt: `ollama` prices at an explicit $0 for any model name, because it is genuinely free to run.
  What remains: the cap is only as good as the price table (it is dated, and the dry run says when it is old), and a model that answers in place of a priced one (an OpenRouter fallback in
  `extra.models`) is charged at the priced seat's price, which can differ from its own.
- A call that fails **after** it reached the provider - the connection drops while a 200 reply is
  being read, a 200 carries a body that is not JSON, or the request times out waiting for headers -
  is not retried, because the generation was probably already billed. Its real usage cannot be
  read, so it is counted toward the per-run cap at its worst-case projection, and recorded as
  `superseded/<label>.charge-<n>.usage.json`, which `council --spend` and a resume count.
- Some hosted reasoning models stop at a provider-side reasoning ceiling well below the seat's own
  cap, before writing any answer (seen 2026-09-23: `deepseek/deepseek-v4.1-flash` via OpenRouter, 6 of
  28 calls stopped at ~4.2k tokens, all reasoning, under a 36k cap). A bigger cap cannot fix that, so
  such a reply is recorded as `REASONING_EXHAUSTED` and is not retried: the seat abstains, which
  blocks unanimity and never counts as consent. Whether to change a chain's reasoning settings for it
  is a roster decision, not something the harness does for you.
- **The Claude Code plugin installs from the repository root.** `claude plugin validate .` passes with one warning, and
  `claude plugin validate --strict .` fails on it: "CLAUDE.md at the plugin root is not loaded as project context" (the
  file is this project's own instructions and is not part of the plugin). A separate `plugin/` directory would not have it;
  that layout was declined for 0.8.1 and comes back with the plugin directory listing. What Claude Code passes for an
  unset optional dialog field was seen once, in a scratch plugin on Claude Code 2.1.289 (an empty string), not across
  versions or on Claude Desktop's own client.
- **The reasoning fields were set from the providers' documents and OpenRouter's public model list,
  not exercised in a live call** (src/reasoning-table.json; its `asOf` field is the date they were read). A provider that rejects a
  field fails that seat's call with the provider's own error; the first real run of a changed chain is
  the live test. The table turns stale after 60 days and a release test fails then. Seats that now
  reason at high use their output cap faster, and a cap sized for a short answer (a questions or criteria
  stage) can be spent on thinking: such a seat is retried once at a bigger cap and, past the limit, is
  recorded with no answer. A direct Anthropic call is not streamed, so its retry is bounded at 64,000
  tokens; streaming is not built.
- Prices in `src/pricing.json` are hand-maintained list prices. Its `asOf` date (2026-10-23: the
  oldest date every entry was last checked) is printed by `council doctor` and `--dry-run`, with a
  warning once it is more than 60 days old. A model whose provider has retired it or no longer
  lists a price keeps the figure the table already had for it, and its row's `_source` says so:
  the date records the read, not that figure. The spend cap and every estimate use these static
  prices. They are estimates, not invoices. Your provider's bill is the real number. A row whose
  price is known to change carries an `expires` date (GPT-5.6 Sol's promotional price, at least
  through 2026-11-21; Gemini 3.8 Flash and Gemini 3.6 Flash, whose prices double on 2027-01-01): past it, `council doctor` and
  `--dry-run` warn, but the projection and the cap keep the old price, so they can project low
  until the table is updated.
- The retired `plan-highest-7` (in `chains/outdated/`) was never run with real models, and `plan-daily-7` ran once (2026-09-28) with the roster it had before the 7 Oct 2026 redesign. None of the tiered councils' mechanisms (tiers, the deep-dive seat, the majority
  guard) has been measured. Their dry-run prices are projections.
- **`run_tests` runs a repository's own test files as trusted code, with no sandbox.** It belongs to the opt-in seat tools (`verify.tools` naming `run_tests`; no shipped chain does; a seat
  may request it mid-stage only when the chain also sets `tools.seat_requests`). Since 0.8.2 the test process gets an allowlisted environment: `PATH`, `HOME` (`USERPROFILE`), the temporary-folder
  variables, `LANG`, `LANGUAGE`, `LC_*`, `TERM`, `CI` and the Windows system variables (`SystemRoot`, `ComSpec`, `PATHEXT`, `WINDIR`). No provider key is in its environment, but a test is code you trust: it can still read the parent process's environment and files on disk (for example `/proc/<pid>/environ`). A project's tests that need another
  variable (a database URL, say) will not see it. It can still read every file you can read, write files and use the network, so use it only on a repository you trust.
- **The symbolic-link containment of the MCP tools is untested on Windows.** Since 0.8.2 the tools refuse a run folder that holds a symbolic link and open run-folder files with `O_NOFOLLOW`. That flag does not exist on Windows, so there the
  protection rests on the `lstat` checks alone, and it has been tested on Linux only: not on a real Windows machine, and the packaged `.exe`'s smoke test under Wine does not exercise it.
- Seats marked `external` (the decider of every planning chain, the writer seats of all of them but `plan-default-opro-council`, and the seats answered through your Claude subscription or, in `plan-mini-council-sol-session`, your ChatGPT plan) pause the run until someone answers them, and are $0 only because a Claude Code
  session on a subscription, or you on your own plan, writes them. Nothing checks who wrote the answer.
- Chains with many labs and high round caps get expensive quickly: every round asks every critic seat. Price
  before you run.
- A panel that signs off is not a guarantee the output is correct. It means every critic seat
  checked it against the stated acceptance criteria and found nothing. Criteria that are vague
  produce sign-offs that mean nothing - the quality of the run depends heavily on the quality of
  the criteria stage.
- Some chains pause for human input by design. They are not stuck.
- The audit log (`audit.jsonl`) detects an edited line or a cut-off end, but **with no HMAC key,
  which is the default, it does not detect a full rewrite**: anyone who can edit the file can
  recompute every hash. Set `AUDIT_HMAC_KEY_FILE` to a key kept outside the run folder if the log
  has to stand up to that.
- The advice tools (`council_quote`, `council_advise`) are experimental, and a call takes **seconds
  (one seat) to minutes (a council), not milliseconds**, and **costs real money every time**: the quote
  shows the worst case and the expected price, and the call cannot pass its ceiling. The brief goes to
  outside labs: the preview says who, and its "ZDR-tagged by OpenRouter" wording is OpenRouter's routing
  tag for an endpoint, **not a guarantee** about what that host does with your text (the table behind it,
  `src/advice-retention.json`, is a dated snapshot). Masking catches the shapes it knows (emails, IBANs, cards, IPv4 addresses, a fixed list of internal host-name endings, home paths under
  `/home`, `/Users` and `/srv`) and misses others (IPv6 addresses, `/var/home`, a WSL `/mnt/c/Users/...` path, `.home.arpa`, `.fritz.box`), and never names, addresses or a password written in words. The run folder of any run holds the absolute path of your working folder (`run.json`, `run.log`, `RESUME.md`): committing a run folder publishes it. The approval step covers `council_advise` only: `write_task` and `start_run` with another chain send text to the labs with no preview, only the key scan, the personal-data check (it stops the run at a finding unless you set `COUNCIL_PII_GATE` to `warn`) and the spend cap. The call limits bind
  the advice tools, not a shell that runs `council` itself, and their ledger sits in your working folder.
  Nothing has been measured that shows advice from other labs improves what the session does.
- The outbound key scan matches **key shapes only**, the formats in `src/secret-patterns.js`; a
  password written in prose is not detectable. Generic shapes (a password inside a URL or an
  assignment) are checked in your inputs before the run; text the models write is checked only for
  distinctive key formats.
- **The council advisor (`council_quote`, `council_advise`) was checked only against mock providers; these were not verified against a live provider or client.**
  None of them is a claim about quality; a live check is yours to run, with a cap.
  - U1: `zdr`, `data_collection` and `max_price` together on a real OpenRouter request. A wrong combination fails before generation, at $0, so the risk is a
    refused call, not an overspend.
  - U2: whether the output cap bounds reasoning tokens on all three council routes. The quoted ceiling is a projection; the provider's own billing decides.
  - U3: whether a billed timeout is retried and charged twice against one reservation.
  - U4: what a real client shows for an approval prompt of a 48,000-character brief (the limit), and whether the approval wait counts toward a client's background
    threshold. The terminal path (`council gate answer`) always exists.
  - U5: what each provider bills for an aborted request, and a real client's cancel (the tests send `notifications/cancelled` by hand).
  - U6: Sol's real output length and latency, and GLM-5.3's latency, as advisors.
  - U7: cancellation semantics under the protocol revision the SDK negotiates (generic cancellation, not the newer stdio requirement).
- **The contract record (`council contract`, `contract_read`, `contract_amend`) was checked only against mock providers and a pretend terminal.** Its drafting call was never made with a real model
  (its wording, recorded in 0.8.2, has only been read by a mock seat). The person's answer is friction, not enforcement: a shell-capable agent can open a pseudo-terminal, as
  with `council gate answer`. A contract is an agreement between a person and a build session's instructions; it does not make a build session follow it, and nothing here measures whether it helps.
- **The approval gate is friction, not enforcement.** Every advice call needs a person to answer a gate through a terminal or an elicitation, so scripted or
  unattended use is not supported: a client that cannot ask a person (headless Claude Code, a script) gets `awaiting_approval`, and nothing is sent until someone answers at a terminal. The terminal answer can be typed by anything that runs as you. The gate's ledger is
  tamper-evident, not tamper-proof: an edit before its last line is detected; the last line, the tail and a rewrite of both the ledger and its view are not.
- **Planning runs still cannot be stopped from outside** (`council stop` and the client's cancel stop an advice call only).
- **`advise-premium` sends your text to labs that have no zero-retention-tagged endpoint.** It is retired to `chains/outdated/` in 0.8.3 (copy it into the folder you name in `COUNCIL_ADVICE_CHAINS_DIR` to use it). It is `public`-only (the operator sets that floor), and its
  worst case is above the add-on's default per-call limit, so an operator raises the limits to use it. GPT-6 Astra is reachable only through OpenRouter: there
  is no subscription route. The retention table behind the send preview is a dated snapshot (`src/advice-retention.json`); the preview's wording is OpenRouter's
  routing tag, not a guarantee.
- **The advice brief is written into the run folder** (`runs/<id>/advice-brief.md`), so a commit of the run folder publishes it.
- **`advise-single`'s ceiling is $1.32 (the upper estimate its tool description shows).** It covers the first call and one retry of a cut-off reply; the typical
  cost of one call is far lower. A person's own terminal run of an advice chain is not gated (`gate: null`), and the add-on's money limits and its chain choice can
  also be set from a project `.env` (as can the audit-log key `AUDIT_HMAC_KEY` and the quote lifetime `COUNCIL_ADVISE_QUOTE_TTL_MS`): whether those should be refused is open. The single-seat swaps
  (Astra, Gemini) keep fixed output caps. The three added or raised in 0.8.2 were priced by dry run only, and no live call was made: Qwen3.8 Max has a 36,000-token cap (whether that is enough when the model reasons at its own default, above high, is not verified); DeepSeek V4.1 Flash, now the 1017 build, is set to 360,000 tokens, which only some of its zero-data-retention endpoints accept (7 of 9 providers, list read 2026-10-23); GLM-5.3 Flash is set to the lab's 131,072, which all but one of its zero-data-retention providers accept (24 of 25, list read 2026-10-23); and whether OpenRouter routes around an endpoint that does not or refuses the call is not verified. No advice chain has a time limit of its own, so a stop (`council stop`, a client cancel) waits for calls already in flight, up to the 2-hour request deadline.
- **A review cut-off in the security-review seat:** `src/security-review.js` cuts reviewer fields at 2,000 characters with a visible marker and no record.
- **Untested on case-insensitive file systems (macOS, Windows).** The fix for `handoff.md` and `HANDOFF.md` being one file (FX-9: `handoff --from-run` now also writes with an exclusive create, so it cannot replace an existing file whatever the disk's case rules) and the working-folder path checks were tested on Linux only. No pass on a Mac or a Windows machine was run for 0.8.1 or 0.8.2.
- **The dry run's expected figure does not price every cap.** A planning chain's expected figure prices a critic at the chain's own estimate, not at its output cap, so the larger caps of
  0.8.1 and 0.8.3 (now 393,216 tokens for DeepSeek V4.1 Flash) appear in the dry run's upper estimate and in the per-stage projection checked against your limit, not in the expected figure; the projection can stop a run before
  the expected total. The speed of DeepSeek V4.1 Flash at its 393,216-token cap is not measured, so whether a reply that long fits inside the 2-hour request deadline is not known; a call that deadline cuts is a paid timeout.
- **A failed start after approval is counted at the full ceiling.** If an advisor run cannot start after a person approved it (for example an unreadable audit-key file named in a project `.env`), the approval is used up, nothing is sent, and the call is still counted in the limits at its full ceiling (`advise-single`: $1.32). Two of these and one real call pass the $3 session limit, which then refuses advice for six hours with nothing spent.
- **One approval can start two runs if the approved run folder is copied:** the approval is bound to the text, not to the run folder.
- **One shipped chain seats Gemini 2.5** (`verify`, through the direct Google provider; the retired `us-only`, `plan-two-strong`, `seven`, `cheap` and `smo` did too). Google has closed Gemini 2.5 to new projects, so a run on those chains by a new user will probably fail at that seat; use a chain with another seat, or change the seat's model.
- **The retry of a direct Anthropic seat whose thinking used the whole cap may never fire.** It keys on a thinking-token count in the reply's `usage`
  (`output_tokens_details.thinking_tokens`) that Anthropic's public Messages API reference does not list (thinking counts inside `output_tokens`); OpenRouter reports
  `reasoning_tokens`, so it fires for an Anthropic seat sent through a single-vendor route (`"transport": "openrouter"`). Where the count is absent, a reply cut off at its cap is retried by the panel's ordinary cut-off rule (one bigger call),
  not by this one. Not verified against the live API.
- **Some fields an agent reads about a run are not marked as untrusted text.** `external_prompt` returns an external seat's claim (`claimed_by` and `contested_by`, strings a peer session wrote into the run folder)
  as ordinary fields; text there could carry an instruction. `list_runs` and `run_status` name a run's label, chain name, task path and log lines in `untrusted_fields`, and `external_prompt` names its prompt there;
  those are marked. A stage bundle for a subagent says its referenced files are data.
- **The terminal command for approving a call was not run under the `.mcpb` route.** It names the server's own Node binary and `cli.js` with absolute paths (or the standalone binary alone). Under Claude Desktop's bundled Node, whether that binary can be run from a terminal was not checked; `council gate answer` from an installed `council` always works.
- **A process killed in the middle of a paid call leaves that call charged at its worst case, not at what it cost.** Since 0.8.2 a call's worst case is written to
  `runs/<id>/spend-reservations.jsonl` before the request goes out, and a settle line follows when the call returns. If the process dies in between (there are no signal handlers), the provider may bill
  the call and no usage file exists, so the unsettled reservation stays counted at its worst case in a resume's cap, in `council --spend` and in the spend report. No command clears one: the figure errs high,
  and goes when the run folder goes. Whoever can write the run folder can edit the file. A brief of non-ASCII text (CJK, say) is projected low in a planning chain (four characters a token); the add-on prices such a brief from its bytes.
- **A run paused under 0.8.1 on a chain or a prompt that 0.8.2 changed is not replayed when resumed:** the config fingerprint or the prompt hash differs (0.8.2 changed seven planning chains and the criteria and judge prompts of every chain), so its API stages are
  paid for again and the answers already given to its external stages are set aside and asked again (the same holds for a run paused under 0.8.0 on a chain 0.8.1 changed). Finish such a run on the version that paused it, or start it again.
- **`npm test` turns red on dates, by design:** 2026-11-21 (the `gpt-5.6-sol` promotional price row), 2026-11-23 (the retention table, older than 30 days), 2026-12-10
  (the OpenRouter price rows of `src/pricing.json`, more than 45 days after `scripts/refresh-openrouter-prices.mjs` last compared them with OpenRouter's list) and 2026-12-23
  (`src/reasoning-table.json`, older than 60 days; regenerated 2026-10-23). Re-read the pages, re-date the file, then the suite is green again. The price rows of the direct providers
  (Anthropic, OpenAI, Google, ...) carry their own dates in `_source` and are not covered by that test.
- **DeepSeek V4 Flash on Together** is sent `chat_template_kwargs {thinking: true, reasoning_effort: "high"}` from vLLM's serving recipe; Together's own page for it was
  not found, so the on-value is unconfirmed on Together.

- **The review notes lane (0.8.3) is unmeasured and has costs the dry run does not show.** With `reviewNotes` on, each judge may add up to 3 proposals and 3 improvement ideas per overseer round in the same JSON reply as its verdict. A reply cut off inside the notes loses a sign-off (a cut-off sign-off counts as an abstention) but keeps an objection that parsed, because the notes ride in the same reply; a seat whose reply was cut off after the notes ask is not asked for notes again in that overseer round. From overseer round 2 on, every judge call also reads a memory block of the last round's items and the writer's answers: paid input that neither dry-run figure prices (up to 10000 tokens per call; in a worst-case run about $0.00 for `plan-mini-council`, $0.00 for `plan-default-opro-council`, $0.02 for `plan-mini-council-sol-session`, $0.25 for `plan-medium-council`, $9.77 for `plan-high-council`, $0.00 for `plan-china-mini-council`, $0.38 for `plan-china-medium-council` and $5.30 for `plan-china-high-council`, at the table prices of 2026-10-18); the limit you type is what stops spending. The dry run's expected figure prices the writer's answers for one overseer round's items and the upper estimate prices every planned round; a handoff that answers several rounds' unanswered items reads more than the expected figure counts. On a chain whose handoff seat is not the plan's writer, the lane adds one more stage, `notes-answer`; on the nine planning chains the writer's answers ride in the handoff. Only exact-id duplicates are merged (an id is computed over the whitespace-normalised text), and "taken" is the writer's claim, which nothing checks.
- **The price limit on OpenRouter calls rests on one documented filter and one probe.** OpenRouter's documentation calls `provider.max_price` a filter but does not say what happens when no host is at or under it. One real call (18 October 2026, a limit far under the only host of its model) was refused with HTTP 404 "No endpoints found that satisfy the max price for this request" and cost nothing. That wording is the only one this program recognises: any other 404 on a call that carried the limit also stops the run (exit 24) but recommends nothing. A limit exactly equal to a host's price and a model with more than one host have not been run; if OpenRouter refuses a call there, the run stops at exit 24 and asks you. If OpenRouter's list price rises above a row in `src/pricing.json`, the run stops the same way instead of overpaying: add the model's current price as a row in `pricing.user.json` (an installed copy cannot refresh its price table; update THC, or in a clone run `scripts/refresh-openrouter-prices.mjs`), or skip the seat with `--skip-seat` where its stage can do without it.
- **The DeepSeek V4 Pro seat of `plan-china-high-council` has five hosts at its price (0.8.3).** The seat is priced at the model's listed 0.66 in / 1.98 out per million tokens, and every call carries that price as a filter, so only a host at or under it can serve the seat. On 23 October 2026 OpenRouter listed 23 endpoints for the model; seven of them, from five hosts (DeepSeek, StreamLake, Alibaba, Baidu and Sail Research), were at or under that price and declare an output allowance of at least 384,000 (the output-allowance filter is not verified: it is OpenRouter's field, not a probe). If none of the five can serve a call, it is refused and the run stops (exit 24); resume it when one is back or after you add a dearer row to `pricing.user.json`. The seat is a panel judge, so it is never skipped: not in a tree, and not in a standalone run either, because the panel agrees only when every judge is heard.
- **A price row you add is trusted as typed.** `pricing.user.json` in your project folder can add a model the shipped table lacks or raise a shipped price, never lower one. For a model the shipped table lacks, anything that can write your project folder can set a low price and make the spend cap under-count that model. A run's limit screen, and the screen of a paid rematch, replay, handoff, contract draft or digest, lists the seats priced by that file, with their figures, so a low figure is visible before you type a limit; `council tree start` shows no such screen and uses the file's figure without saying so (`council doctor` and `--dry-run` list the file's rows). The controlling session can raise such a row too, through `tree_decide`, but only for the model a stopped member of that tree was refused for at its price limit, and it never lowers one, and it is told to ask you first and record your yes as the reason (THC cannot check that it asked; nothing runs until you type `council tree resume`): the row is for every run in the project, the record names the session as the one that added it and the source it cited, and a price set too low lets the cap under-count that model on a direct provider.
- **`price_raise` cannot tell whether the session asked you (0.8.3).** The tool tells the session to show you the quoted text and get your yes in the chat before it confirms, but THC cannot see that, and the `reason` it records is text the session supplied (it is told to pass your words). What does not depend on the session: confirming spends nothing, and `resume_run` afterwards stops at the spending-limit gate again because a price row changed, and that gate is answered by you (the dialog in a client that can ask (Claude Desktop), which the client shows to you, or `council gate answer` in a terminal). The quote makes a network call to openrouter.ai from the MCP server process (the same list the terminal offer reads), and the server reads `pricing.user.json` once at start, so a quote can show a limit that is out of date if the file was edited by hand since.
- **The session's answers in a tree are the session's, and THC cannot see who is behind the tool call.** Through `tree_decide`, the controlling session can answer some stops of a tree (accept a finished run as it is, resolve a milestone in place, plan a sub-plan again, hand a stop back to you, raise the price of the model a stopped member was refused for, approve the first frontier of a split when every child gets its full ceiling). The record names the session, its channel and its written reason, and never writes such an answer as yours; money (a top-up, the cap, a raised limit on runs, depth or children), closing, abandoning, a new root plan and every personal-data or key-scan answer stay yours, at a terminal (for a new root plan the session may write the draft of the decision: you read it in full there and approve it by typing the stop id, or ask for a change). Approving a frontier lets the children's grants be issued from the tree's cap (the approval itself moves no money); the session is told to show you the quoted text and record your yes in your words before it does (THC cannot check that it asked), and nothing starts until you type `council tree resume`; the record carries the free amount and the grants the code computed when it asked (sessionConditions), which are THC's own figures, not a check by a second party, and the grants themselves are still issued against the free amount at registration. The check is a guardrail between cooperating tools: a program that can call the tool is taken to be the session.

- **The handoff lists the dependencies the plan names; it does not check them.** When the plan has the build session install or download something, `HANDOFF.md` ends its own part with a "Dependencies to verify" section: one line per item, the name and version copied from the plan, a line for every choice the plan leaves open, and an instruction to check each name before installing. 0.8.3 only lists and asks. It makes no registry lookup and no network call, a model writes the list and can leave an item out or get one wrong, and nothing in the harness confirms the build session did the check. The check is yours.
- **Who answered a seat that a coding-agent session fills is the session's own statement and is never checked (0.8.3).** `report.json` and the BOARD say which client answered and which model the session declared, and count the panel's companies from that. A session can say anything, and a session that declares no model is shown as not known, not as the company the chain names. Nothing in a run depends on it.
- **A smaller plan of a tree gets your goal only from a heading of the task (0.8.3).** When a tree splits a plan, each smaller plan is given the sections of your task that its plan names, plus every section headed Non-goals, Non-goal, Exclusions, Out of scope or Not in scope. In a task that has headings, a goal written only above the first heading sits in no section, so no smaller plan receives it: put the goal under a heading of its own. A task with no headings at all, or whose only headings are exclusions headings, is given whole.

## Privacy

This tool collects nothing. Stated plainly, not as a claim about quality:

- No telemetry, no analytics, no tracking of any kind, anywhere in this repo.
- The only network calls this tool ever makes are to the AI provider APIs you configure with
  your own keys (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, and so on) - and only when you start
  a real run with a non-mock, non-external seat. `council doctor` and `council demo` make zero
  network calls; both are implemented to read only local files and environment variable names.
- The landing page in `docs/` ships no JavaScript and loads no third-party resource - see
  `test/landing-page.test.js`, which fails the build if either ever changes.
- Everything a run produces - the task, the debate, the deliverable, the cost - is written to a
  folder on your own disk (`runs/<id>/`) and nowhere else. Deleting that folder deletes the
  record. See `src/spend.js`'s own documentation for why spend accounting is derived from those
  folders rather than kept in a separate log.
- **Personal data.** A run sends your task to the providers your chain names. Keep personal data out of it where you can. Every run checks the task for an email address, an IBAN or a card number before anything is sent, and stops by default when it finds one: nothing is sent or spent. To send it anyway, run the same command again with `--allow-pii <types>`. It does not recognise names, addresses or other personal details. The stop and the logs name the kind of match and where it is (line and column), never the value: on a stop the lines are printed (over MCP they go to the start's log file) and no run folder exists yet; under `warn` the run goes on and writes the same lines to its `run.log`, and a tree member also to its `WARNINGS.md`. If you have to send personal data, use providers that sign a data processing agreement with you. Whether a run complies with the GDPR depends on those agreements and on what your task contains; THC makes no claim about it.
- An advice call (`council_advise`) sends a brief the session wrote, after masking, to the labs the preview named, through
  OpenRouter, only after you approved its exact text (in your client's dialog or with `council gate answer`); there is no
  allowance and no statement that skips that. Like every run, it writes the exact text to disk, in the run folder:
  `runs/<id>/advice-brief.md`, hashed in `report.json` (`task_sha256`) and in the gate; the folder is made before you
  answer, so a declined or unanswered request leaves one too (nothing in it was sent or spent). `advise-log.json` keeps no
  brief text (only hashed, salted words of the question, salt kept in your home folder); `audit.jsonl` (always written
  for advice calls) holds a hash and a size per call, never the text. If you commit a run folder, you publish its masked
  brief.
- If you opt in to the audit export (`"audit": true`, and on automatically whenever a `policy.json`
  exists), each run also writes `audit.jsonl` into its own folder: signed, hash-chained lines (each carries the previous line's hash) that
  `verifyAuditLog` in `src/audit.js` checks offline. Seat, cost and timing only, never task or
  prompt text. Format: `docs/audit-schema.md`.

## Reporting a bug

Open an issue at
[github.com/muad-yasin/the-high-council-mcp/issues](https://github.com/muad-yasin/the-high-council-mcp/issues).
For anything security-related, or that should not be public, write to
[contact@sower-industries.de](mailto:contact@sower-industries.de) instead.

## If this makes you money

The licence is MIT. You owe nothing, and that is the whole licence - nothing below changes it.

If The High Council ends up helping you build something that earns, I'd ask for **0.7%** of what it
earns. Not a fee, not a clause, not a subscription. A request between people who build things.

There is no reporting, no audit, no tracking, and nothing checks. **No is a complete answer** - use
it, fork it, sell what you build with it, and never think about this section again. That is a fine
outcome and it's why the licence says what it says.

If you'd rather say yes: [pay what you think it's worth](https://buy.stripe.com/cNi14neoycSF0sseYrfjG01).

## License

MIT. See [LICENSE](LICENSE). The section above is a request, not a term of it.
