<div align="center">

<img src="https://raw.githubusercontent.com/muad-yasin/the-high-council-mcp/master/docs/logo-diamond.png" alt="Sower Industries diamond logo" width="120">

# The High Council

Several AI models from different labs argue about your idea, then debate on Software Engineering choices.<br>
The goal is to get everyone to work together, in harmony and with manners. Effectiveness is unproven, but it is a fun way to spend your tokens!

[![npm](https://img.shields.io/npm/v/the-high-council?label=npm)](https://www.npmjs.com/package/the-high-council)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-5865f2)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.muad-yasin/the-high-council)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Website](https://sower-industries.de/en/THC/) · [Releases](https://github.com/muad-yasin/the-high-council-mcp/releases) · [Changelog](CHANGELOG.md) · [Known limits](#known-limits-stated-plainly)

<img src="https://raw.githubusercontent.com/muad-yasin/the-high-council-mcp/master/media/council-water-collector.gif" width="480" alt="The council chamber from the project website: the debate graph of a real recorded run (a water-collector design), with the Claude seat in the middle.">

</div>

## Try it in 30 seconds

    npx the-high-council council demo

No keys, no network, $0. Add it to Claude Code as an MCP server:

    claude mcp add council -- npx -y the-high-council council --mcp

For Claude Desktop, download the `.mcpb` bundle (`the-high-council-<version>.mcpb`) from [Releases](https://github.com/muad-yasin/the-high-council-mcp/releases/latest).

## Contents

- [Your first ten minutes](#your-first-ten-minutes) · [Words used here](#words-used-here)
- [How it works](#how-it-works) · [Reading a run with a program](#reading-a-run-with-a-program)
- [Requirements](#requirements) · [Setup](#setup) · [Quick start (CLI)](#quick-start-cli) · [Quick start (MCP)](#quick-start-mcp)
- [Available tools](#available-tools) · [The spend cap](#the-spend-cap) · [Chains](#chains)
- [How this was built](#how-this-was-built) · [Skills](#skills)
- [Known limits](#known-limits-stated-plainly) · [Privacy](#privacy) · [Accessibility](#accessibility) · [Reporting a bug](#reporting-a-bug) · [License](#license)

You choose the number of debate rounds, the seats and labs (any lab except xAI), and the token
limit for each model's replies.

We recommend our own chains: `cheap-7-v2`, `plan-premium-7` and `plan-highest-7` (the top
models, GPT-6 Astra, Claude Opus 5.5, DeepSeek V4 Pro
and GLM-5.3, write the alternative
architectures and are the only seats that vote; cheaper seats write the proposals and the debate). You can also edit a chain to suit yourself, or run every seat on
your own machine with `local-ollama`.

See it work right now - no keys, no setup, no cost:

    npx the-high-council council demo

The demo takes one example request (a tool that renames holiday photos by date) through every
stage: blind proposals, an anonymised debate in which one proposal is withdrawn and two are
amended, a panel that splits in round 1 and signs off in round 2, and the handoff file. Every
model reply in it is written in advance; what is real is the code that runs the stages around
them.

**What it costs.** You pay the model providers directly, with your own API keys. The demo,
`doctor`, `init` and the `mock` chains cost $0 and make no network call. `--dry-run` prints a
run's worst-case price before anything is called, and every run stops before any stage that could
take it past its spend cap ($7 unless you set `--max-usd`). Most runs cost less than the worst
case: a panel that signs off early skips the remaining rounds.

Three commands from nothing to a priced run of your own idea (no key needed until you drop
`--dry-run`; [Your first ten minutes](#your-first-ten-minutes) walks through them):

    npx the-high-council demo       # $0: every stage, scripted replies, no network
    npx the-high-council init       # writes tasks/my-first-task.md for your idea, plus a $0 mock run
    npx the-high-council --task tasks/my-first-task.md --chain cheap-7-v2 --dry-run

**Which chain.** Worst-case prices as `council doctor` prints them, from the shipped price table
(prices as of 2026-09-06) and the default task-size estimate; a long task costs more.

| Chain | Who does what | Needs | Worst case |
|---|---|---|---|
| `cheap-7-v2` | Claude Sonnet 5 writes the plan; low-cost models from seven other labs review it, and all seven must sign off. Up to 7 rounds. | one OpenRouter key | $11.22 |
| `plan-premium-7` | A Claude Code session writes the plan; a seven-lab panel of larger models (GPT-6 Astra, Claude Fable 5.1, Gemini 3.8 Flash, Muse Spark 1.2, Qwen 3.8 Max, DeepSeek V4 Pro, GLM-5.3) proposes, debates and reviews. | OpenRouter key + a Claude Code session | $36.75 |
| `plan-highest-7` | Seven low-cost models propose and debate; four top models write whole architectures and are the only reviewers; one deep-dive seat checks the first draft against the task. **Untested with real models.** | OpenRouter key + a Claude Code session | $17.34 |
| `local-ollama` | Every seat on your own machine, through Ollama. | Ollama and the models pulled | $0 |

All three cost more than the default cap at their worst case, so give them a `--max-usd` at or above
their dry-run price (since 0.8.1 a proposal may use a seat's whole output allowance and every shipped seat reasons at
high, which raised the worst cases; a run that signs off early costs far less). The writer seats of `plan-premium-7` and `plan-highest-7` are [external](#quick-start-mcp): the run pauses
and a Claude Code session (or you) writes that stage, at no API cost. Nothing about any chain's
output quality has been measured.

Add it to Claude Code as an MCP server:

    claude mcp add council -- npx -y the-high-council council --mcp

It is also listed in the official MCP Registry as `io.github.muad-yasin/the-high-council`, and
there is a one-file Claude Desktop bundle ([Quick start (MCP)](#quick-start-mcp)).

Runs as an **MCP server** (so an agent like Claude Code can drive it) or as a **CLI**. Bring your
own API keys. Nothing is resold, nothing is hosted for you, and your keys go only to the
providers you choose, never to us.

Run `npx the-high-council council doctor` to see which of your own keys are
set, which shipped chains you can already run with them, and what each would cost - before
spending anything. Where it falls short: [Known limits](#known-limits-stated-plainly).

> **On what this does and doesn't claim.** This repo publishes the mechanism: the chains, the seat
> rosters, the stage order. It does not claim to produce better plans than a single good model
> would. That is an open question and we have not measured it. What it does, concretely, is make
> disagreement between models *visible and recorded* instead of averaged away - you can read who
> objected to what, who withdrew a proposal under argument, and who held their position.

## Your first ten minutes

New to API keys, or to this? This path costs nothing until step 4, and step 4 tells you the price
before anything is spent.

1. **Watch one.** `npx the-high-council demo` walks an example request through every stage with
   scripted replies. No key, no network, $0.
2. **Make it yours.** `npx the-high-council init` writes `tasks/my-first-task.md` (edit it into
   your own idea, in plain words) and `chains/my-first-chain.json`, and runs a $0 mock pass so
   you can look inside a real run folder.
3. **Find the least setup.** `npx the-high-council doctor` lists what your keys can run. Its
   "Start here" block names the chains that need **one key only**: a single `OPENROUTER_API_KEY`
   (one account at [openrouter.ai](https://openrouter.ai) that reaches many labs' models) is
   enough for a seven-lab panel. Put the key in a file called `.env` in the folder you run from,
   as `OPENROUTER_API_KEY=...`, and add `.env` to your `.gitignore` so it is never committed.
4. **Price it, then run it.** Add `--dry-run` to see the worst-case price for your task, then run
   it without:

       npx the-high-council --task tasks/my-first-task.md --chain cheap-7-v2 --dry-run
       npx the-high-council --task tasks/my-first-task.md --chain cheap-7-v2 --max-usd 11.23

   `cheap-7-v2`'s worst case ($11.22) is above the default cap, so the run command carries its own
   cap, set just above that price. Every run stops before it would pass its spend cap ($7 unless
   you set `--max-usd`). A run stopped by the cap keeps what it paid for but has no plan yet, so pick
   a cap at or above the dry run's price. A panel that signs off early costs less than the worst case.

   The plan lands in `runs/<time>/deliverable.md`; the argument behind it is in `BOARD.md`.

No key and no budget? A chain can run on models on your own machine through
[Ollama](#local-models-ollama-lm-studio-) at $0, if your computer can run them.
Everywhere below, `council` means `npx the-high-council` unless you installed it globally.

## Words used here

- **Lab** - a company that makes AI models (Anthropic, OpenAI, Google, DeepSeek, ...). "Different
  labs" means models trained by different companies.
- **Provider** - where a call goes and who bills it: a lab's own API, OpenRouter (many labs, one
  key and one bill), or `ollama` (your own machine).
- **API key** - a secret string from a provider that lets a program use your account there. You
  pay the provider for what the program uses; nobody else sees the key.
- **Seat** - one job in a run, filled by one model: the one that writes criteria, the builder, a
  critic, and so on.
- **Chain** - a JSON file that says which model sits in which seat and which stages run. Pick one
  with `--chain`; `council doctor` lists them all.
- **Task** - your request, a plain text file in `tasks/`. No format.
- **Criteria** - yes/no checks the plan has to pass, written from your task before anyone plans.
- **Proposal, debate** - each lab suggests parts of the plan without seeing the others, then
  they read each other's (with names hidden) and object, support or merge.
- **Panel, round, sign-off** - the critics grade the draft against the criteria; each failed check
  goes back for a revision, which is one round. Sign-off means a critic found nothing failing.
- **Dry run** - `--dry-run`: price a run, call nothing.
- **Spend cap** - the most one run may cost. It is checked before every paid call.
- **Mock** - a fake provider with scripted replies, for trying the machinery for free.
- **External** - a seat that waits for a person or another agent (such as your Claude Code session)
  to answer it from a file.
- **Handoff** - `HANDOFF.md`, the build instructions a coding agent works from.

**A visual write-up of all of this, built around one real run, is at
[sower-industries.de/en/THC/](https://sower-industries.de/en/THC/).** What changed in each release:
[CHANGELOG.md](CHANGELOG.md).

## How it works

A run moves through fixed stages. Which stages fire depends on the chain you pick.

1. **Questions** - a seat reads the request and asks only the questions whose answers would change
   the output. You answer them (or take its stated defaults).
2. **Criteria** - the request becomes a short list of acceptance criteria, each one a yes/no check
   rather than a matter of taste.
3. **Skeleton** - an outline the other models will propose against. Names the parts, decides
   nothing.
4. **Proposals** - every lab proposes buildable parts, blind to each other.
5. **Debate** - the labs read each other's proposals, anonymised, and post support / object /
   merge. Then each author replies: keep, amend, or withdraw.
6. **Build** - one seat integrates the surviving proposals into a single document.
7. **Panel review** - every critic independently grades the draft against the acceptance criteria,
   blind. Not unanimous? It revises against the union of every objection and the panel reviews
   again, up to the chain's round cap.
8. **Handoff** - a `HANDOFF.md` written for whoever executes the result. It ends with a block the
   harness writes, not a model: the acceptance criteria the run settled, how each checkable one is
   checked, and a fingerprint for each of the two. `council check-lock HANDOFF.md` ($0) says whether a
   copy still carries them; it catches an edit or
   a slip, and is not a signature.

Some chains add optional stages to this: whole alternative architectures written blind before
the skeleton, a deep-dive check of the first draft, a dispute stage that records unresolved
objections at the top of the plan, and a final security review.

Every run writes a folder: the deliverable, `BOARD.md` (the full debate - every post, every
withdrawal), `HANDOFF.md`, a per-lab scoreboard, and the real token/cost accounting.

A run that stopped before it wrote its handoff (the spend cap, an abandoned pause, a crash) can get one from
its latest draft: `council handoff --from-run runs/<id>`. It is one call on the chain's handoff seat, under the
run's own spend cap (what the folder already cost counts toward it; `--max-usd N` is a total, as on `--resume`),
the same policy check and key scan as a run, and a run no panel signed off gets a note at the top, written by
the harness, saying so. It never overwrites an existing `HANDOFF.md`.

### Reading a run with a program

`BOARD.md` is for people. **`report.json` is the same board, structured** - if you are building
anything on top of a run, read that instead. Do not parse the markdown. The format is versioned
(`schemaVersion`) and published as a JSON Schema, `schemas/report-v1.json`; which fields are stable,
which are experimental, and how versions change: [docs/report-format.md](docs/report-format.md).

```jsonc
{
  "schemaVersion": 1, "runId": "...", "chain": "...", "passed": false, "maxUsd": 7,
  "criteria":  [ "each acceptance criterion, as written before the debate" ],
  "questions": [ { "question": "...", "why": "...", "default": "..." } ],  // null if the chain skipped them
  "proposals": [ { "id": "DEEPSEEK-1", "lab": "deepseek", "model": "...",
                   "title": "...", "serves": "...", "what": "...", "why": "...",
                   "how": "...", "acceptance_test": "...", "attempt": 1,
                   "withdrawn": true, "amended": true, "replaced_by": "GLM-1" } ],
  "dropouts":  [ { "lab": "...", "model": "...", "stage": "proposals", "reason": "..." } ],
  "debate": {
    "posts":   [ { "by": "deepseek", "on": "QWEN-1", "stance": "object|support|merge",
                   "text": "...", "merge_with": "GLM-2" } ],
    "replies": [ { "id": "DEEPSEEK-1", "action": "keep|amend|withdraw",
                   "text": "...", "replaced_by": "GLM-1" } ],
    // Since 0.7.8 (experimental): posts and replies the harness rejected, counted per lab and
    // reason (unknown_target, own_proposal, bad_stance, not_own_proposal, not_posted_on,
    // bad_action, unreadable). [] when nothing was dropped.
    "dropped": [ { "stage": "debate|replies", "by": "qwen", "reason": "unknown_target", "count": 1 } ]
  },
  // Only on chains with `alternatives: { enabled: true }`: one whole architecture per lab, written
  // blind before the skeleton, and the same post/reply board the proposals get.
  "alternatives": {
    "items":   [ { "id": "GLM-ALT", "lab": "glm", "model": "...", "name": "...", "shape": "...",
                   "key_tradeoffs": "...", "bad_at": "...", "amended": true, "withdrawn": false } ],
    "posts":   [ { "by": "qwen", "on": "GLM-ALT", "stance": "object|support|merge", "text": "..." } ],
    "replies": [ { "id": "GLM-ALT", "action": "keep|amend|withdraw", "text": "..." } ],
    "dropouts": [ { "lab": "...", "model": "...", "stage": "alternatives", "reason": "..." } ]
  },
  // Only on chains with `argued: { enabled: true }` (off by default, on in no shipped chain): the
  // "How this plan was argued" section, written to ARGUED.md next to deliverable.md (never inside it)
  // by the handoff seat, from a fact pack of this run's own record. unknown_refs / unknown_labs are
  // ids and labs it named that the run never had; each is also a line in WARNINGS.md.
  "argued": {
    "file": "ARGUED.md",
    "facts_counts": { "labs": 7, "alternatives": 7, "proposals": 14, "objections": 9, "...": 0 },
    "unknown_refs": [], "unknown_labs": [], "missing_labs": [], "missing_sections": [],
    "refs_cited": 23, "ok": true
  },
  "signoff": [ { "lab": "qwen", "provider": "qwen", "model": "...", "signedOff": false,
                 "objections": [ { "criterion": "...", "problem": "...", "fix": "..." } ] } ],
  "lastCritique": { "meets": false, "failures": [ { "criterion": "...", "lab": "qwen" } ] },
  "scoreboard": {
    "rows": [ /* one per proposal, with its outcome */ ],
    "labs": [ { "lab": "deepseek", "model": "...", "proposed": 3, "accepted": 0,
                "cut": 0, "withdrawn": 3, "unaccounted": 0, "built": null } ]
  },
  "totals": { "input": 0, "output": 0, "total": 0, "usd": 0, "unpriced": [] }
}
```

`proposals` plus `debate.posts` is a directed graph with verifiable edges: one node per proposal,
one edge per posture, and `replies[].action` says what each author did with their own proposal
once they had read the argument against it. That is the whole artifact, already machine-readable.
`scoreboard.labs` is the per-lab tally already aggregated for you — start there for a scoreboard
rather than counting `proposals` yourself.

**`dropouts` is the field you will regret ignoring.** A lab whose proposals came back unreadable
after a retry is dropped from the run: it is not in `proposals`, not in the debate, and not in the
scoreboard. It is only in `dropouts`. A consumer that counts labs from `proposals` and reports
"four labs debated this" will be wrong — the roster shrank, and the run log says so loudly at the
time. Report a seated lab that produced nothing as what it was, or you are publishing a panel that
was smaller than you claim. Treat `null` and `[]` alike here; runs written by older versions have
no such field at all.

**Two of these are not closed schemas.** `debate.replies[]` is built by spreading the model's own
reply object and normalising `id`, `action` and `replaced_by` over it, so an entry carries at least
those plus `text` and may carry more (an `amend` often brings a `how`). `replaced_by` is only set
when the action is `withdraw`. `proposals[]` likewise carries `withdrawn` / `amended` /
`replaced_by` only when they apply. Read defensively: check for a field, do not assume it.

Chains with newer, opt-in stages add their own fields (`deep_dive`, `notQuorate`, `dispute`,
`security_review`, ...); [docs/report-format.md](docs/report-format.md) lists which are stable and
which experimental. With the majority guard on, a withdrawal that does not quote the argument it
concedes to carries `unargued: true` in `debate.replies[]` and its proposal stays for the builder.

`signoff[].lab` is the seat's lab; `signoff[].provider` holds the same value under an older,
misleading name and is deprecated (kept until the report format's version 2).
`signoff[].objections` is why a seat declined, on the seat's own record. `signedOff: null` means
the seat gave no usable reply and abstained - neither a pass nor an objection, and `objections` is
`null` rather than empty so the two stay apart. A seat that agreed has an empty list.
The same objections also appear flattened in `lastCritique.failures[]`, tagged with `lab`, because
the reviser wants the union across the whole panel. Both are built in one pass; they cannot drift.

**Before you publish a run,** note that `report.json` records `task` as the path to your task file
(relative to where you started the run, never absolute). Nothing transmits it anywhere - but if you are rendering a board onto a public
page, drop that field. The debate itself is the part worth showing.

## Requirements

- Node 20+
- API keys for whichever labs the chain you choose actually uses

## Setup

Nothing to install beyond Node: `npx the-high-council council <command>` fetches the published
package and runs it. To keep a `council` command on your PATH instead:

```bash
npm install -g the-high-council
council doctor
```

`council` reads and writes in the directory you run it from: `.env` for keys, `tasks/` for
requests, `runs/` for output, and a `chains/` of your own there takes precedence over the bundled
ones. Put only the keys your chosen chain needs in that `.env`, one `NAME=value` per line
(`.env.example` in the package lists them all). Supported providers:

`ANTHROPIC_API_KEY` · `OPENAI_API_KEY` · `GOOGLE_API_KEY` · `MISTRAL_API_KEY` ·
`DEEPSEEK_API_KEY` · `GROQ_API_KEY` · `TOGETHER_API_KEY` · `COHERE_API_KEY` ·
`OPENROUTER_API_KEY` · `ZAI_API_KEY`

xAI/Grok is never seated, and neither is a router id (`openrouter/auto`, the Pareto Code router,
any other `openrouter/<name>` id) that could route to it: chain-lint refuses such a chain and the run itself refuses such a seat,
with no override. There is no `xai` provider. Kimi/Moonshot models are not in any chain this
package ships, but you may seat one in a chain of your own.

The CLI refuses to start if any seat in the chosen chain is missing its key, rather than failing
halfway through a paid run. `ollama` (below) is the one exception - it needs no key at all.

A keyed seat sends its key only to its own provider's https API. A chain that points a keyed
seat's `baseUrl` anywhere else is refused before any call (see
[Local models](#local-models-ollama-lm-studio-)).

Other settings, all optional, read from the environment or `.env` (except `COUNCIL_ADVICE_SENSITIVITY_FLOOR` and
`COUNCIL_ADVICE_CHAINS_DIR`, which only the server's own environment sets: a project's `.env` is something an agent can write):

| Variable | What it does |
|---|---|
| `MAX_USD_PER_RUN` | The default per-run spend cap (`7` when unset). `--max-usd` overrides it for one run. |
| `COUNCIL_WORKDIR` | MCP server only: the folder for `tasks/` and `runs/`, when the client starts the server somewhere else. |
| `COUNCIL_MAX_USD_LIMIT` | MCP server only: a cap the MCP client cannot raise or remove through `max_usd`. |
| `COUNCIL_ALLOW_LOOPBACK_KEY_HOST` | `1` lets a keyed seat use a loopback `baseUrl` (a local proxy in front of the provider). Nothing else. |
| `OLLAMA_API_KEY` | Sent to an `ollama` seat's server only if you set it. |
| `COUNCIL_PERSONAS_FILE` | Your own persona set for debate seats ([PERSONAS.md](PERSONAS.md)). |
| `AUDIT_HMAC_KEY` / `AUDIT_HMAC_KEY_FILE` | Signs the opt-in audit log (see [Privacy](#privacy)). |

### From source

```bash
git clone https://github.com/muad-yasin/the-high-council-mcp.git
cd the-high-council-mcp
npm install
cp .env.example .env
```

In a clone, `node src/cli.js` does what `council` does, on the current source rather than the
published package. `npx github:muad-yasin/the-high-council-mcp council demo` runs the current
source without cloning.

### Standalone binaries (build them yourself)

There are no published binary downloads yet. From a clone you can build a single-file `council`
that needs no Node install to run: a Linux binary, a Linux AppImage, and a Windows `.exe`, all
built on Linux.

```bash
npm run build:bin                 # dist/the-high-council-linux, dist/the-high-council-win.exe
npm run build:appimage            # dist/the-high-council-x86_64.AppImage (downloads a pinned appimagetool)
npm run smoke:bin -- dist/the-high-council-linux   # demo + an MCP session, offline, $0
```

Stated plainly: the `.exe` is tested under Wine on Linux, not on a real Windows machine, and none
of the binaries are code-signed, so Windows SmartScreen will warn. Put `.env` in the directory you
run the binary from.

### Local models (Ollama, LM Studio, ...)

A seat can run on a model you're hosting yourself instead of a paid API. Set its provider to
`ollama`:

```json
{ "provider": "ollama", "model": "llama3.1" }
```

This talks to Ollama's own OpenAI-compatibility endpoint (`http://localhost:11434/v1` by
default) - no `OLLAMA_API_KEY` needed; Ollama's docs describe a key as "required, but unused."
If your local runner listens somewhere else (LM Studio, a different port, a remote box), add
`baseUrl` to that seat:

```json
{ "provider": "ollama", "model": "mistral", "baseUrl": "http://localhost:1234/v1" }
```

Put a local or self-hosted server on an `ollama` seat, as above. A seat with a keyed provider
(`openrouter`, `openai`, ...) sends that provider's key to its `baseUrl`, so chain lint refuses
one whose `baseUrl` is anything but that provider's own https API address (`key-host`), and the
CLI lints before every run and every resume. For a local proxy in front of the provider, set
`COUNCIL_ALLOW_LOOPBACK_KEY_HOST=1` in your environment: it allows a loopback address, nothing else.

A local seat prices at $0 in every estimate and run report - `dry_run` shows it as priced, not
"unpriced," and it can never trip the spend cap. See `chains/local-ollama.json` for a full
example chain with every seat local. As with every other seat in this project: BYOK is really
BYO-compute here, and no efficacy claim is made about local models versus hosted ones - nothing
has been measured.

### Final security-review gate

`"security_review": { "enabled": true }` adds one read-only reviewer as the last stage of a chain,
after the build and everything else. It returns typed findings, and any critical or high finding
fails the run (exit 7). A reviewer with no usable verdict fails it too (exit 8); that never counts
as a pass. The default reviewer is `anthropic/claude-fable-5-1` (your key, priced, capped);
`seats.security_reviewer` can be any seat, including a local `ollama` one as an offline option.
Full details: [docs/security-review-gate.md](docs/security-review-gate.md).

## Quick start (CLI)

A task file is the request the council plans against: plain prose, written by you. There is no
template and no format - write what you actually want, including the constraints that matter.

```bash
mkdir -p tasks
echo "Plan the data model for a bookmarking app. Single user, offline-first." > tasks/your-idea.md

# see what's available and what it would cost
council --help
council --task tasks/your-idea.md --chain verify --dry-run

# a real run
council --task tasks/your-idea.md --chain verify
```

Your requests and everything the council writes about them stay on your machine, in `tasks/` and
`runs/` under the directory you ran from. In a clone of this repo both are gitignored, so a fork
will not accidentally publish them.

`verify` is the default when you name no chain: a panel of two labs, a hard two-round cap. It
needs three keys (Anthropic, OpenAI and Google, one account each). With one OpenRouter key, start
with `cheap-7-v2` instead; `council doctor` lists every chain that runs on the keys you have.
`--chain` takes a chain's name (`cheap-7-v2`), never a file path: a `chains/<name>.json` of your
own in the working directory is found by its name.

**If your task names files.** A task that names a file (`src/app.js`) without including its
content is stopped before any call (exit 9, `BLOCKED-ARTIFACTS.md`), because the seats would
otherwise plan against code they never saw. Put the real content in with
`council fence --task tasks/x.md --repo <path to your repo> src/app.js` (it appends each file,
fenced and labelled, and refuses to write if it finds a key), read the task file, then run.
If a name is only a location, pass `--allow-unfenced` for the whole task or
`--allow-unfenced app.js` for named files. Everything in the task file goes to every seat.

### Exit codes

Each outcome has its own code, so a script or CI job can branch on it:

| Code | Meaning |
|---|---|
| 0 | Finished: a deliverable and `report.json` were written. |
| 1 | The chain failed lint, or an input is missing (no task file, a resume from the wrong directory). |
| 2 | Usage error: a flag is missing its value or has an invalid one, `--chain` is not a chain name, a `--context` file is not a regular file or is over 2 MB, or `--rematch`/`--replay` of a run given `--criteria`. |
| 3 | Paused at an external seat: answer `NEEDS-<stage>.md`, then `--resume`. |
| 4 | Stopped at the per-run spend cap before the next stage was paid for; resume with a higher `--max-usd`. |
| 5 | A provider key the chain needs is missing (degradable: set it and run again). |
| 6 | Fatal: the chain file cannot be parsed, or the audit key cannot be loaded. |
| 7 | Finished, but the final security review blocked the deliverable. |
| 8 | Finished, but the final security review could not judge it (never a pass). |
| 9 | Artifact gate: the task names files whose content it never includes (`BLOCKED-ARTIFACTS.md`). |
| 10 | Preflight: a seat objected to the task description itself (`STOPPED-preflight.md`). |
| 11 | Something in the input must not be sent: a prompt matches one of the key formats listed in `src/secret-patterns.js` (checked by default; `--allow-secret-shaped` overrides), or, under `--pii-gate hard-stop`, a PII shape. |
| 12 | `policy.json` refused the chain. |
| 13 | Another process is already running this run folder. |
| 14 | The task file, or (since 0.8.0) a `--context` document, changed since the run started and `AMENDMENTS.md` does not cover it. The message prints the hashes to write; a context hash is written `ctx-<hash>`. |
| 15 | `--resume` of a run that already finished (it has a `report.json`); nothing is run or spent. |
| 16 | The run stopped at an unexpected error (a seat that could not be reached, a crash); `STOPPED-error.md` says what, and `--resume` continues from the completed stages. |
| 17 | A draft (build, revise, dispute, final edit or handoff) was cut off at its token cap, and its one larger-cap retry was cut off too; the fragment is never graded or shipped (`STOPPED-truncated.md`). |
| 18 | An advice call was stopped before finishing: by a person (`council stop runs/<id>`), by the MCP client that cancelled the call or went away, or by its own wall-clock ceiling (`advise.max_wall_ms`). Calls already in flight finish and are recorded (a wall-clock stop cuts a call still running at the deadline, recorded as not answering); nothing new starts. It writes `report-partial.json` (`stoppedBy`: `user`, `client_cancel` or `wall_clock`; the answers that were paid for under `advise`), `BOARD-partial.md` when anything was paid for, and `STOPPED-<stoppedBy>.json`. An advice call is not resumed: ask again. |

Codes 9-17 were split out or added on 2026-09-23. Before that, several of these outcomes shared a code (2, 5,
6 or 1). Code 18 came with the advice tools.

### Telling the council what your build session can actually use

One optional convention, worth the four lines it costs. If your task file ends with a section
headed **`## Available tools`**, the handoff seat will name the right one in the acceptance test
for each item of work, instead of inventing a check from nothing:

```markdown
## Available tools

- `scope-gate` - decides GO / NEEDS-SPEC / KILL before anything is built
- `bug-audit` - reads code line by line, reports verified defects, edits nothing
- `npm test` - the project's own suite
```

The council is told what exists, not how it is invoked, and is instructed never to name a tool
that is not on your list. Leave the section out and the handoff assumes nothing beyond your test
suite - which is what it did before this existed, and what it will keep doing.

This costs no tokens you were not already spending: the task file is already in the handoff seat's
prompt. It is the difference between *"write a test for this"* and *"run `scope-gate` on this
before building it."*

### The spend cap

Every run has a per-run ceiling in USD. It defaults to **$7**, and is checked *before* each paid
stage - a stage that could take the run past the ceiling is never called, so the cap holds rather
than reporting the overspend afterwards.

```bash
council --task tasks/x.md --max-usd 2     # this run stops at $2
council --task tasks/x.md --max-usd none  # no ceiling (0 is refused: it used to mean this)
export MAX_USD_PER_RUN=20                         # change the default
```

A run that hits the ceiling stops cleanly and writes `STOPPED-budget.md` saying what it spent, which
stage it stopped at, and what that stage would have cost. Nothing is half-written: it produces no
`deliverable.md` and no `report.json`, so a stopped run never reads as a finished one. What it did
get through is in `report-partial.json` and `BOARD-partial.md`
([docs/report-format.md](docs/report-format.md)). Continue it with a higher ceiling - completed
stages replay from disk and cost nothing the second time:

```bash
council --resume runs/<id> --max-usd 10
```

A stage replays only if it would be asked the same thing again: the task text, the chain config
and the stage's own prompt must all match what it answered. If one changed (you edited the chain,
or an earlier stage came out differently this time), the stage runs again and its old files move
into `superseded/` inside the run folder. What the old answer cost still counts toward the ceiling,
`--spend` and `report.json`'s `totals.usd` (shown separately as `totals.supersededUsd`), so a resume
cannot spend past the cap. An answer you wrote for an external stage is never re-used against a
changed prompt: it is set aside the same way and the run asks you again.

The cap governs one run. To see what you have spent across all of them:

```bash
council --spend            # today
council --spend --days 7   # the last week
council --cost-today       # today by calendar day, with a per-model breakdown
council --cost-today --date 2026-09-01
council --stats --days 30    # how the debate mechanism itself is doing
```

That is read back off the run folders on disk - there is no ledger file, nothing is recorded
anywhere else, and nothing leaves your machine. Runs still going, or stopped by the cap, are
counted from the stages they already paid for. The same figures are available to an MCP client as
`spend_report`.

To watch this work without spending anything, the `mock-budget` chain calls no API but carries
fixture prices:

```bash
council --task tasks/your-idea.md --chain mock-budget --max-usd 1
```

If a chain pauses for your input, it writes `NEEDS-<stage>.md` into the run folder and tells you
how to resume. The run resumes as soon as the answer file exists, so write it under a `.partial`
name and rename it when it is complete:

```bash
# write your answer to runs/<id>/answers.md.partial, then:
mv runs/<id>/answers.md.partial runs/<id>/answers.md
council --resume runs/<id>
```

## Quick start (MCP)

Register the server with your MCP client. No clone needed - from the published npm package:

```bash
claude mcp add council -- npx -y the-high-council council --mcp
```

The same line with `npx -y github:muad-yasin/the-high-council-mcp` runs the current source
instead.

Or from a clone of this repo:

```bash
claude mcp add high-council -- node /absolute/path/to/the-high-council-mcp/src/mcp/server.js
```

**The path must be absolute.** The client starts the server from its own working directory, not
from this one, so a relative path resolves somewhere unexpected and the server never starts.

Or as a Claude Code plugin, which registers the same server and also installs the skills in
[`skills/`](skills/README.md):

```bash
claude plugin marketplace add muad-yasin/the-high-council-mcp
claude plugin install the-high-council@the-high-council
```

Claude Code copies the plugin into its plugin cache and runs `npm ci` there itself, so the first
install takes a little longer. Start a new session (or run `/reload-plugins`) and the server shows
up in `claude mcp list` as `plugin:the-high-council:high-council`. Remove it with
`claude plugin uninstall the-high-council@the-high-council`. If you add the marketplace from a
local clone instead (`claude plugin marketplace add /path/to/clone`), the server runs from the
clone itself, so run `npm install` in it first.

Your provider keys can go into the plugin's settings dialog (`/plugin`, then the plugin's settings): one
optional field per lab, marked sensitive, so Claude Code keeps it in the OS keychain. Leave a field empty and
the key from your environment or a `.env` file in your project is used instead; a key in the dialog is used
first. The plugin passes each dialog value under its own name (`COUNCIL_PLUGIN_<LAB>_API_KEY`), so an empty
field never replaces a key you exported yourself.

**Claude Desktop:** download `the-high-council-<version>.mcpb` from the
[GitHub Releases](https://github.com/muad-yasin/the-high-council-mcp/releases) page (its SHA-256
is next to it) and open it. Claude Desktop shows a settings form: a council folder for tasks and
runs, a per-run spend ceiling that Claude cannot raise or remove from a chat, and one optional
field per provider key (marked sensitive, so the app keeps them in the OS keychain). The bundle is unsigned. How it is built:
[mcpb/README.md](mcpb/README.md).

**MCP Registry:** the server is listed in the official registry as
`io.github.muad-yasin/the-high-council` (npm package, stdio). A client that installs from the
registry runs the same `npx` command as above.

Registering with a client other than Claude Code (DeepSeek Harness, OpenHands, Cline, goose,
Continue): [docs/mcp-clients.md](docs/mcp-clients.md) has the real config for each.

Whichever way you add it, the server reads and writes in **your** working directory, not inside
the package: `.env` for keys, `tasks/` for requests, `runs/` for output, and a `chains/` of your
own takes precedence over the bundled ones (not for advice chains: see
[Asking other labs for advice](#asking-other-labs-for-advice-council_quote-council_advise-experimental)). In a git project, add `.env` (and `runs/` if your
ideas are private) to `.gitignore` before an agent commits everything; `council doctor` warns
when `.env` is not ignored. An advice call also leaves `council-<id>.log` and a `.council-advice-lock/` folder in the working folder: ignore those too.

The server only works inside that directory. `dry_run` and `start_run` take a chain by name.
Every path `start_run` is given (`task`, `draft`, `context`, `from_run`, and each file inside a
`context` folder or `from_run` run folder) must resolve inside the working directory, after
symlinks, and must not be on the secret/credential denylist; outside `tasks/`, `runs/` and
`context/` a gitignored file is refused too. Set `COUNCIL_MAX_USD_LIMIT` in the server's
environment to cap what the client's `max_usd` can ask for.

To run it by hand:

```bash
council --mcp        # from a clone: npm run mcp
```

Then drive it with these tools:

| Tool | What it does |
|---|---|
| `list_chains` | Available chains with descriptions and worst-case price |
| `write_task` | Write the request the harness plans against |
| `dry_run` | Price a run before spending anything |
| `start_run` | Start a run in the background (`max_usd` sets its ceiling). `chain` is a chain name; `task`, `draft`, `context` and `from_run` must be inside the working directory |
| `run_status` | Stage reached, panel verdicts, scoreboard, cost, budget remaining |
| `spend_report` | What every run has cost across a window of days, plus `session_cost_today` (calendar-day, per-model breakdown), derived from disk |
| `verdict_stats` | How the debate mechanism itself is doing, per chain and per lab: sign-off rate, rounds, objections, dropouts, cost/wall time, largest prompt files - derived from disk |
| `metrics_report` | Descriptive telemetry only (never an evaluation or baseline): amendment rate, withdrawal rate, objection-follow-through rate, tool-call usage, consensus-induced-regression count - derived from disk. See [`docs/paid-comparison-run.md`](docs/paid-comparison-run.md) for what a *real* comparison against a single model would need - not built, not this metric |
| `external_prompt` | The prompt a paused external stage is waiting on - **read it with this, not by opening the file**; the prompts are routinely tens of thousands of tokens and most clients silently truncate a file read. `waiting` lists every stage the run waits on (a panel of external critics pauses together); pass `stage` for another one's prompt |
| `prepare_stage_prompt` | Write a self-contained bundle for a paused stage, so a driving session doing other work at the same time can dispatch it to a fresh subagent instead of authoring it inline - see [`docs/dispatch-pattern.md`](docs/dispatch-pattern.md) |
| `submit_stage` | Answer a paused stage; the run resumes once every stage it waits on has an answer. Optional `claimed_by` records who's answering; a second submission for an already-answered stage no longer errors - it's kept as `<stage>.late.md` with a warning instead of being rejected |
| `resume_run` | Resume a paused run, or raise `max_usd` on one the cap stopped |
| `read_run_file` | Read any file from a run folder (`report-partial.json` for a run the cap stopped) |
| `list_runs` | Past runs |
| `plan_outline` | Section tree of a run's deliverable (or a `.md` file in the working directory) with word counts |
| `council_quote` | Experimental. Preview and price a request for advice from other labs: who would receive the text, its exact size and `sha256` after masking, the worst-case and expected price, a `quote_id`. Sends and spends nothing. See [Asking other labs for advice](#asking-other-labs-for-advice-council_quote-council_advise-experimental) |
| `council_advise` | Experimental. Spends. Asks other labs for advice on one decision, once you approve it: a leaning and every dissent in the models' own words. `start_run` and `resume_run` refuse advice chains, so this is the only way in over MCP |

**Text from a run comes back marked as model-written.** A deliverable, a board, a log line or an
advisor's answer was written by AI models, and a model can be fooled into writing instructions aimed
at the agent that reads it. So `read_run_file` (and `run_status` with `brief: true`) returns the text
between a notice written by the server and markers whose id changes on every call, with Unicode tag
characters, bidi controls and zero-width characters removed and counted; JSON answers that carry such text name those fields
in `untrusted_fields`. Which tool returns what is one table in `src/mcp/untrusted.js`, and a tool
missing from it is refused when the server starts. This is a label, not a filter: it does not make
hostile text harmless, and the file on disk is unchanged.

### Asking other labs for advice (`council_quote`, `council_advise`; experimental)

Two more tools let a coding agent, when you ask it to, put **one decision** to models from other
labs and read back a **leaning**, every dissent in the models' own words, and what each would need
to see to change its answer. It is advice from other models, never an instruction, and it comes
**in addition to** whatever model is already the caller: the default seat is not Anthropic's.
Nothing has been measured that shows it improves what an agent does; it is an instrument, and each
call leaves a small record (`advise-log.json`) you can rate later with
`council advise-rate runs/<id> useful|not-useful|unclear [note]` (the only supported way to write the
rating: a typo in a hand edit of that file makes every later advice call refuse).

- **`council_quote`** sends nothing and spends nothing. The agent writes a short structured
  **brief** (at most 48,000 characters, about 12,000 tokens, all together; over the limit is refused, never cut; no
  transcript, tool output, environment or file listing). The quote scans the whole text for key
  shapes, masks emails, IBANs, cards, IPs, internal hostnames and home paths (reversibly: the
  mapping stays in memory), and returns a **send preview**: who receives it (lab, model, the
  endpoint's retention wording), the exact size and `sha256` of the text, the worst-case and
  expected price, and a `quote_id` valid for ten minutes. The text itself goes to you, not back to the agent:
  you read all of it in the approval step.
- **`council_advise`** spends, and only after **you** approved the exact text. It needs the quote id
  and the hash. It writes the run folder first (`runs/<id>/advice-brief.md`, the masked text, and a
  pending approval, a "gate"), then asks you: in your client, if it can show you a dialog (MCP
  elicitation: the price, the hash, the seats and the whole text), or at a terminal with
  `council gate answer runs/<id> g1`, which prints the same and asks y/N. Until you answer, the call
  returns `awaiting_approval` with that command; the agent sends the same quote again once you have.
  The run starts only on an approved gate, and one approval covers one send. Nothing else approves a
  call an agent asked for: no setting, no flag, no tool argument (the 0.8.0 `COUNCIL_ADVISE_APPROVAL=host`
  statement is gone, and a server that still has it set refuses to start). The run is held to the seats and
  the ceiling the gate showed you, whatever else is in the folder. Running an advice chain yourself at your
  own terminal (`council --chain advise-single --task brief.md`) is your own call and has no gate; its
  record says so (`gate: null` in `advise-log.json`). The terminal check is friction, not proof
  that a person answered: a program can open a pseudo-terminal. Advice calls therefore need a person
  at the keyboard; scripted or unattended use is not supported. `mode: "single"` asks one seat (default GPT-6.1 Sol through OpenRouter; the
  `advisor` argument picks another); `mode: "council"` asks three labs (OpenAI GPT-6.1 Sol, Z.ai GLM-5.3, Google Gemini 3.8 Flash)
  blind, lets them read each other once, and a seat changes its answer only by quoting an argument.
  The call holds for up to `wait_seconds` (default 25, at most 30, the same for every client), your approval included;
  a run that outlives the hold returns its id, and `run_status(run, wait_seconds: 25, until: "settled")` (also at most
  30) returns the answer. Use the default: a client that gives up on a call cancels it, and a cancel stops the run.
- **Limits, meant to be set by you in the server's environment and not by the agent** (a project `.env` can still set them: see Known limits):
  `COUNCIL_ADVISE_MAX_USD_PER_CALL` ($1.50, compared with the call's ceiling, the most it can spend), `..._PER_SESSION` ($3), `..._PER_DAY` ($10),
  `COUNCIL_ADVISE_CALLS_PER_SESSION` (3), `..._CALLS_PER_DAY` (8), `COUNCIL_ADVISE_COOLDOWN_MS`
  (two minutes). A question asked again needs `new_evidence` in the brief; an answer with
  dissent needs an accept, reject or defer, with a reason, for each dissent before the next call.
  Every refusal says that nothing was spent and what to do next.
- **What may be sent** starts from the floor you set in the server's settings,
  `COUNCIL_ADVICE_SENSITIVITY_FLOOR` (`public`, `internal`, `confidential`; default `internal`). A
  project's `policy.json` may raise it with `advice_sensitivity_floor` and can never lower it, since
  the project folder is something the agent can write. The brief's own label can only tighten it:
  a missing or `unknown` label counts as `confidential`, `personal_data` and `secret_adjacent` are
  never sent, a `confidential` brief goes to one seat and never to a council, and a model that has
  no endpoint OpenRouter tags zero-data-retention is reachable only for `public` material. The label
  is the agent's word, so the approval text tells you what the text is treated as and who set each
  part (your floor, the project's policy, the agent's label): you are the check on it.
- **Your own chain, or a $0 trial.** `COUNCIL_ADVISE_CHAIN_SINGLE` and `COUNCIL_ADVISE_CHAIN_COUNCIL` point a
  mode at an advise chain by name. An advice chain is read from the package's own `chains/` or from one
  folder you name in `COUNCIL_ADVICE_CHAINS_DIR` (an absolute path outside the project; anything else stops
  the server), and never from the project's `chains/`: a repository's chain file would otherwise choose who
  receives the text. Your chain must pass the same checks: priced seats, not denied, zero-retention routing
  where the model has it, a wall clock. `COUNCIL_ADVISE_MOCK=1` runs the mock chains, so the whole exchange
  can be tried with no key and no money.
- **When an advisor asks for more.** An answer can list what was missing from the brief. That list is model
  text, shown to the agent as untrusted, and the next call does not go out on the agent's say-so: its
  approval text starts with "This call follows an advisor's request for more material", so you see that
  the new text answers a model's request, and decide whether that material should leave your machine.
- **Stopping.** A client that cancels the call or goes away, `council stop runs/<id>` at your
  terminal, or the chain's own wall-clock ceiling (`advise.max_wall_ms`) stops the run before its
  next paid step: calls already in flight finish and are billed (the wall clock cuts a call still
  running at its deadline, which may still be billed), the run exits 18, and the answers
  that were paid for are kept in `report-partial.json`, which `run_status` hands back. A stopped call
  is not resumed; ask again.

What this does **not** do, stated plainly: "ZDR" in the preview is OpenRouter's routing tag for an
endpoint, not a guarantee about what that host does with your text, and the retention table
(`src/advice-retention.json`) is a dated snapshot (read on 2026-09-30; the preview prints its date and
says when it is more than 30 days old). No scanner catches names, addresses, phone
numbers or passwords written as prose: read the text the server shows you. The limits above bind
these two tools and `start_run` / `resume_run` for advice chains, which refuse them; they do not
bind a shell that runs `council` itself, and the ledger they read is in your working folder.
Headless use is refused by design: with no dialog and no person at a terminal the call returns
`awaiting_approval` and nothing runs (Claude Code in `-p` or CI mode included). The
models see only the brief: nothing is run or checked. A call takes seconds (one seat) or minutes (a
council) and costs real money: see the price in the quote, in your own units.

**External vs. API-backed seats.** `{ "provider": "external" }` pauses a run at that seat so a
Claude Code session on a flat-rate subscription plays it - free at the point of use, since the
subagent runs on the same subscription. If you don't hold a flat-rate subscription and pay
metered rates for everything anyway, `{ "provider": "anthropic" }` (or another API provider) may
be simpler for those seats: no dispatch pattern to learn, at roughly 5x the metered cost of the
same debate on external, based on one measured comparison, not a guarantee. Not the default
anywhere in this repo's config, README ordering, or example chains - external stays recommended
for anyone with a subscription, since the project's cost story depends on it.

## Chains

64 chain configs live in `chains/`. Each one is plain JSON - the seat roster, which models fill
which seat, the round cap, and whether proposals/debate/handoff stages run. They are meant to be
copied and edited.

The four recommended ones (`cheap-7-v2`, `plan-premium-7`, `plan-highest-7`, `local-ollama`) are
in the table at the top. A few more worth knowing:

- **`verify`** - two labs, two rounds. The default when you name no chain; needs Anthropic, OpenAI
  and Google keys.
- **`plan-open-7`** - the `cheap-7-v2` panel, with a Claude Code session writing the plan instead
  of a paid seat.
- **`plan-daily-7`** - `plan-highest-7`'s stages at a lower price, for planning one feature:
  Claude Opus 5.5 on your Claude subscription (an external seat), GPT-6 Luna and DeepSeek V4 Pro
  write the architectures and alone vote; seven low-cost labs propose and debate. Two Claude Code
  sessions answer its external seats: Opus 5.5 every stage whose label contains `opus5.5-sub`
  (including `-retry` and `-reask1`/`-reask2` forms), Sonnet 5 the writer stages. $5.70 worst case
  (0.8.1 dry run at the prices of 2026-10-06; $5.08 at the earlier prices, $4.88 before every seat reasoned at high, $1.90 before proposals could use a
  seat's whole output allowance).
  **Run once with real models (2026-09-28); nothing about it has been measured.**
- **`cheap`** - small models throughout. For testing the harness itself, not for real work.
- **`plan-debate`** - five labs propose blind, debate each other's proposals anonymised, then a
  blind panel grades the integrated draft.
- **`plan-auto`** - the full open-scope chain with every seat on a real API, so no stage waits for
  an external session. It still pauses once for your answers to its questions.
- **`plan-unanimous`** - every critic must independently sign off on the *same* draft. Three rounds
  here means up to fifteen critic calls, not five.

Read a chain's `description` field before running it; they say what they cost you in calls.

### Reasoning effort

Every seat in a shipped chain is set to `high` where its model has a setting for it, and no code
path lowers it. What "high" means depends on the model, so `src/reasoning-table.json` lists,
per model, the request field that sets it (Anthropic `output_config.effort`, OpenRouter
`reasoning.effort`, OpenAI and Google `reasoning_effort`, Z.ai `thinking`, Together's Qwen chat
template), the model's own default effort and its largest reply. Each row carries the document it was
read from and a date. `chain-lint` refuses a shipped chain whose seat is set below high (a reasoning
setting that is off, low, medium, minimal, a smaller token budget, or hidden). That rule binds the
chains in this package only: a chain of your own is not refused, and a setting you write in your own
chain is sent as written. In your own chain, a seat with no reasoning setting gets the high default
for any model the table has a field for.

- **Models that default above high.** GLM-5.3, GLM-5.3 Flash and Qwen3.8 Max run at `max` or `xhigh`
  unless told otherwise, so sending "high" would be a lower effort. They are sent nothing and run at
  their own default.
- **Claude Haiku 4.5** has no effort levels. Its "high" is thinking on with a token budget of half the
  seat's output cap (at least 1,024), and the cap carries the budget on top of the room the answer had.
- **A reply that spent its whole cap thinking** is retried once with the same request and a bigger cap
  (double, up to the model's own maximum and what its connection can return). At that limit it is not
  retried; the seat is recorded as `no answer: thinking used the whole cap` (the `no_answer` field of
  that seat's entry in `panelVerdicts`) and is unheard, never a pass. Until 0.8.0 the retry turned
  thinking off.
- **Models the table has no field for** (for example Cohere, Groq, Mistral Large, the models on Together
  other than Qwen3.5-9B and DeepSeek V4 Flash, local Ollama models) are sent nothing. DeepSeek V4 Flash on
  Together is sent the chat-template switch vLLM documents for it; Together's own page for it was not found.
- **`gp-judge-v1`** now runs its Sonnet and Qwen seats with reasoning on (it ran with it off). Scores
  from this version on come from the high-effort judge, so earlier and later GP scores are not
  directly comparable.

### Optional chain-config fields

- **`schemaVersion`** - an integer, optional. `council doctor` warns (never fails) when a chain
  omits it or names an older/newer one than this build knows about. A chain file without it keeps
  working exactly as it always did - this is a warning, not a requirement.
- **`max_proposals_per_seat`** - an integer, **opt-in, no default**. Debate size stays unlimited
  unless a chain file explicitly sets this. When it is set and one seat's own proposals still
  exceed it, that seat gets one merge prompt to fold its own list down before the debate board
  ever sees the extras.
- **`role`** - optional, on any `seats.proposers` entry only (set anywhere else and `council
  doctor` rejects it fail-loud, since it would silently do nothing there): `{ lens?, persona? }`.
  `lens` is one of `adversary | integrator | long-horizon | user-advocate | security-and-legal` -
  a critique function. `persona` is a name - a voice, resolved against the default set in
  `PERSONAS.md` when it matches, otherwise used as free text. Applies only to that seat's
  debate-stage prompt; the panel/critique stage that sets `passed` never sees it, enforced by a
  source-level guard, not just an intention. A chain with no `role` set is byte-identical to
  before. **No efficacy claim**: this ships the mechanism, not evidence that it helps - see
  CHANGELOG.md's 0.6.0 entry.
- **`quorum: { "minHeard": N }`** - opt-in, unanimous chains only, set in no shipped chain. A
  round's sign-off counts only when at least N reviewers gave a verdict (signed off or objected);
  a round short of it is recorded as `notQuorate`, the run does not pass, and the loop stops.
- **Tiered councils (experimental, used by `plan-highest-7`, `plan-daily-7` and `mock-tiered`).**
  `seats.alternatives` names who writes the whole alternative architectures, separately from the
  proposers. `deep_dive` + `seats.deep_dive` add one non-voting seat with its own dollar cap
  (`usd`, required) inside the run's cap. `majority_guard.enabled` shows each author every
  argument once, with no lab name or count, and keeps a proposal whose withdrawal does not quote
  the argument it gives in to. chain-lint refuses a tiered chain where a lab or model sits
  both among the proposers and among the reviewers or architecture authors, or where the deep-dive seat shares a lab or model with a reviewer. See
  CHANGELOG.md's 0.7.8 entry.

## How this was built

Vibecoded, with **Claude Code** doing the writing, by one person at
[Sower Industries](https://sower-industries.de). Parts of it were planned by the harness itself —
the build order for its own v2 went through a four-lab council, and the plan came back with one of
its findings built on evidence that turned out to be wrong, which is recorded rather than quietly
dropped.

The parts worth knowing, because they explain why the code looks the way it does:

**Almost every defensive branch here is a headstone.** `parseJson` in `chain.js` repairs two
specific malformations — an unescaped `"` inside a markdown-quoted span, and raw newlines inside
string values — because three consecutive real runs died on the first one and silently logged a
pass that never happened. The comments name the run id and the date. The retry after a
reply that spent its whole budget thinking exists because an Anthropic seat burned its entire
`maxTokens` budget thinking and returned nothing; until 0.8.0 it switched thinking off, and since
0.8.1 it keeps the same effort and raises the cap. The `ROSTER SHRANK` warning exists because a lab can return nothing and vanish
from the scoreboard without saying so. None of these were designed in advance; each one is a day
that went wrong.

**The failure modes are testable offline.** The `mock` provider has named models
(`mock-unreadable`, `mock-provider-error`, `mock-proposer-empty`, `mock-critic-holdout`) that each
drive one of those branches for $0, so the regression tests run without keys and without spend.

**`docs/` ships no JavaScript on purpose.** The landing page arrived from a design tool depending
on an unlicensed runtime that also fetched React and Babel from a CDN at page load. Shipping it
would have relicensed someone else's build artifact as MIT and put a third-party request on a page
shared with a German site. Its loops were pre-rendered to static HTML and the fonts self-hosted
instead. `test/landing-page.test.js` fails if a script tag or a third-party URL ever comes back —
and if the page's typed-in numbers stop matching the repo, which has already caught the page
claiming 29 chains and 12 tools when there were 30 and 11.

No claim is made here that any of this produces better plans. It has not been measured.

## Skills

`skills/` carries a small set of Claude Code skills shipped alongside this harness, not part of
it - usable in any project, with or without the harness, and needing no API key:

- **Core agentic work:** `task-scoping`, `research-and-sourcing`, `verification-and-critique`,
  `context-and-handoff`, `tool-and-action-discipline` - the work around the work, for any agent
  task, including setups where several models propose, critique, and hand off to each other.
- **Building software:** `backend-developer`, `frontend-developer`, `ux-design`, `visual-craft`.
- **Game development:** `proof-discipline`, `game-verification`, `open-world-streaming`,
  `engine-editor-driving`, `dcc-agent-authoring` - verification, streaming, editor and Blender work
  for games.
- **Writing:** `drafting`, `fact-checking`, `line-editing`, `final-read`, `good-news-writing`.

The full catalog, with when to use each and what it guards against, is
[`skills/README.md`](skills/README.md); a shareable presentation page is `docs/skills.html`. Both
are checked by the test suite against the real `skills/` folder. Same MIT/BYOK ethos as the
harness: the skills don't claim to make results better - nothing has been measured - they describe
what each rule guards against and why. Copy the folders you want into your project's
`.claude/skills/`, or point Claude Code at this repo's `skills/` directory.

## Known limits, stated plainly

- The spend cap is enforced against a **worst case**, not a prediction: the whole prompt billed as
  input plus the seat's entire `maxTokens` budget billed as output (for Anthropic seats, plus the
  bigger cap of the one retry they may make). Real stages almost never cost that much, so a run can stop with headroom
  left. That is the intended trade - resume it with a higher ceiling.
- The dry run (`--dry-run`, MCP `dry_run`) prices the task alone and does not read `--context`
  documents, so for a run with context its estimate is too low. The spend cap is not affected: it
  checks every real prompt, context included, before each call.
- A seat whose model has no entry in `src/pricing.json` is **unpriced, and therefore uncapped**.
  It contributes $0 to the running total no matter what it really costs. Check `dry_run` output
  for `unpriced` before trusting a ceiling. `ollama` seats are the one deliberate exception: they
  price at an explicit $0 for any model name (they are genuinely free to run), so they never show
  up in that `unpriced` list and never need a pricing.json entry.
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
  not exercised in a live call** (src/reasoning-table.json, read 2026-10-05). A provider that rejects a
  field fails that seat's call with the provider's own error; the first real run of a changed chain is
  the live test. The table turns stale after 60 days and a release test fails then. Seats that now
  reason at high use their output cap faster, and a cap sized for a short answer (a questions or criteria
  stage) can be spent on thinking: such a seat is retried once at a bigger cap and, past the limit, is
  recorded with no answer. A direct Anthropic call is not streamed, so its retry is bounded at 64,000
  tokens; streaming is not built.
- Prices in `src/pricing.json` are hand-maintained list prices. Its `asOf` date (2026-09-06: the
  oldest date every entry was last checked) is printed by `council doctor` and `--dry-run`, with a
  warning once it is more than 60 days old. The spend cap and every estimate use these static
  prices. They are estimates, not invoices. Your provider's bill is the real number. A row whose
  price is known to change carries an `expires` date (GPT-5.6 Sol's promotional price, at least
  through 2026-11-21; Gemini 3.8 Flash, which doubles on 2027-01-01): past it, `council doctor` and
  `--dry-run` warn, but the projection and the cap keep the old price, so they can project low
  until the table is updated.
- `plan-highest-7` has not been run with real models, and `plan-daily-7` has run once
  (2026-09-28). None of the tiered councils' mechanisms (tiers, the deep-dive seat, the majority
  guard) has been measured. Their dry-run prices are projections.
- Seats marked `external` (the writer seats in `plan-premium-7`, `plan-highest-7`,
  `plan-daily-7` and `plan-open-7`, and the Opus 5.5 anchor seat in `plan-daily-7`) pause the run until someone answers them, and are $0 only because a Claude Code
  session on a subscription writes them. Nothing checks who wrote the answer.
- Chains with many labs and high round caps get expensive quickly. `plan-unanimous` at three rounds
  is fifteen critic calls; `plan-auto` runs several frontier models over multiple rounds. Price
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
  `/home`, `/Users` and `/srv`) and misses others (IPv6 addresses, `/var/home`, a WSL `/mnt/c/Users/...` path, `.home.arpa`, `.fritz.box`), and never names, addresses or a password written in words. The run folder of any run holds the absolute path of your working folder (`run.json`, `run.log`, `RESUME.md`): committing a run folder publishes it. The approval step covers `council_advise` only: `write_task` and `start_run` with another chain send text to the labs with no preview, only the key scan and the spend cap. The call limits bind
  the advice tools, not a shell that runs `council` itself, and their ledger sits in your working folder.
  Nothing has been measured that shows advice from other labs improves what an agent does.
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
- **The approval gate is friction, not enforcement.** Every advice call needs a person to answer a gate through a terminal or an elicitation, so scripted or
  unattended use is not supported: a client that cannot ask a person (headless Claude Code, a script) gets `awaiting_approval`, and nothing is sent until someone answers at a terminal. The terminal answer can be typed by anything that runs as you. The gate's ledger is
  tamper-evident, not tamper-proof: an edit before its last line is detected; the last line, the tail and a rewrite of both the ledger and its view are not.
- **Planning runs still cannot be stopped from outside** (`council stop` and the client's cancel stop an advice call only).
- **`advise-premium` sends your text to labs that have no zero-retention-tagged endpoint.** It is `public`-only (the operator sets that floor), and its
  worst case is above the add-on's default per-call limit, so an operator raises the limits to use it. GPT-6 Astra is reachable only through OpenRouter: there
  is no subscription route. The retention table behind the send preview is a dated snapshot (`src/advice-retention.json`); the preview's wording is OpenRouter's
  routing tag, not a guarantee.
- **The advice brief is written into the run folder** (`runs/<id>/advice-brief.md`), so a commit of the run folder publishes it.
- **`advise-single`'s ceiling is $1.32 (the "at most" its tool description shows).** It covers the first call and one retry of a cut-off reply; the typical
  cost of one call is far lower. A person's own terminal run of an advice chain is not gated (`gate: null`), and the add-on's money limits and its chain choice can
  also be set from a project `.env` (as can the audit-log key `AUDIT_HMAC_KEY` and the quote lifetime `COUNCIL_ADVISE_QUOTE_TTL_MS`): whether those should be refused is open. The council's wall clock (900 seconds) is untuned, and the single-seat swaps
  (Astra, Gemini) keep fixed output caps.
- **A review cut-off in the security-review seat:** `src/security-review.js` cuts reviewer fields at 2,000 characters with a visible marker and no record.
- **Untested on case-insensitive file systems (macOS, Windows).** The fix for `handoff.md` and `HANDOFF.md` being one file (FX-9: `handoff --from-run` now also writes with an exclusive create, so it cannot replace an existing file whatever the disk's case rules) and the working-folder path checks were tested on Linux only. No pass on a Mac or a Windows machine was run for 0.8.1.
- **The dry run does not price every cap.** A planning chain's dry run prices a critic at the chain's own estimate, not at its output cap, so the larger caps of
  0.8.1 (360,000 tokens for DeepSeek V4.1 Flash and the panel review of GLM-5.3 Flash) appear only in the spend cap's per-stage projection, which can stop a run before
  the dry-run total. A retry of 720,000 tokens (a 360,000-token seat at the model's maximum) cannot finish inside the 45-minute request deadline and would be a paid timeout.
- **A failed start after approval is counted at the full ceiling.** If an advisor run cannot start after a person approved it (for example an unreadable audit-key file named in a project `.env`), the approval is used up, nothing is sent, and the call is still counted in the limits at its full ceiling (`advise-single`: $1.32). Two of these and one real call pass the $3 session limit, which then refuses advice for six hours with nothing spent.
- **One approval can start two runs if the approved run folder is copied:** the approval is bound to the text, not to the run folder.
- **Six shipped chains seat Gemini 2.5** (`plan-two-strong`, `seven`, `cheap`, `smo`, `us-only`, `verify` through the direct Google provider). Google has closed Gemini 2.5 to new projects, so a run on those chains by a new user will probably fail at that seat; use a chain with another seat, or change the seat's model.
- **The retry of a direct Anthropic seat whose thinking used the whole cap may never fire.** It keys on a thinking-token count in the reply's `usage`
  (`output_tokens_details.thinking_tokens`) that Anthropic's public Messages API reference does not list (thinking counts inside `output_tokens`); OpenRouter reports
  `reasoning_tokens`, so it fires for an Anthropic seat sent through a single-vendor route (`"transport": "openrouter"`). Where the count is absent, a reply cut off at its cap is retried by the panel's ordinary cut-off rule (one bigger call),
  not by this one. Not verified against the live API.
- **Some fields an agent reads about a run are not marked as untrusted text.** `list_runs`, `run_status` and `external_prompt` return a run's label, chain name, task path and an
  external seat's claim as ordinary fields; text from a cloned repository's run folder or chain file could carry an instruction there. Only the model-written fields named in
  `untrusted_fields` are marked. A stage bundle for a subagent now says its referenced files are data; the field marking is planned for 0.8.2.
- **The terminal command for approving a call was not run under the `.mcpb` route.** It names the server's own Node binary and `cli.js` with absolute paths (or the standalone binary alone). Under Claude Desktop's bundled Node, whether that binary can be run from a terminal was not checked; `council gate answer` from an installed `council` always works.
- **A process killed in the middle of a call records nothing** (there are no signal handlers): the provider bills the call, but it is missing from `council --spend` and from a resume's
  cap. A brief of non-ASCII text (CJK, say) is projected low in a planning chain (four characters a token); the add-on prices such a brief from its bytes.
- **A run paused under 0.8.0 on a chain that 0.8.1 changed is not replayed when resumed:** the config fingerprint differs, so its stages are set aside and paid for again.
  Finish such a run on 0.8.0, or start it again.
- **`npm test` turns red on dates, by design:** 2026-10-31 (the retention table, 30 days old), 2026-11-21 (the `gpt-5.6-sol` promotional price row, and the OpenRouter
  price rows of `src/pricing.json`, 45 days after `scripts/refresh-openrouter-prices.mjs` last compared them with OpenRouter's list) and 2026-12-05
  (`src/reasoning-table.json`, 60 days old). Re-read the pages, re-date the file, then the suite is green again. The price rows of the direct providers
  (Anthropic, OpenAI, Google, ...) carry their own dates in `_source` and are not covered by that test.
- **DeepSeek V4 Flash on Together** is sent `chat_template_kwargs {thinking: true, reasoning_effort: "high"}` from vLLM's serving recipe; Together's own page for it was
  not found, so the on-value is unconfirmed on Together.

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
- An advice call (`council_advise`) sends a brief an agent wrote, after masking, to the labs the preview named, through
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

## Accessibility

The landing page (`docs/`) uses only native HTML elements for interaction - `<a href>`
links and `<details>/<summary>` for the expandable demo sections - specifically because those
are keyboard-operable by the browser itself, with no custom JavaScript to get wrong. Tested by
hand, 2026-09-13, on the live site:

- **`index.html`**: tabbed from the page's first link; focus reached the "Clone the repo",
  "How it works" and "Try it (demo)" buttons in order, each showing a visible focus ring;
  pressing Enter on "Try it (demo)" navigated to `demo.html`, the same as a click.
- **`demo.html`**: tabbed to the first proposal's `<summary>` ("A-1 Synchronous invalidation...");
  pressing Enter expanded it in place (the ▶ marker flipped to ▼ and the body text appeared),
  identical to clicking it.
- No custom widget on any page (`index.html`, `board.html`, `demo.html`) uses a `<div>` or
  `<span>` with a click handler in place of a real interactive element - checked directly in the
  page source, not inferred.
- The only image in `docs/` is the local logo (`logo-diamond.png`): the header copy carries alt
  text, the faint background copy on `index.html` has an empty `alt=""` as decoration.
  `test/landing-page.test.js` checks both on every page.
- Primary body text (`#8d8a84`/`#b9b5ad`) against the page background (`#0a0a0b`) measures
  roughly 5.7:1 contrast by the WCAG relative-luminance formula, above the 4.5:1 AA threshold
  for normal text.

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
