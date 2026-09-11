# The High Council

A planning harness that runs one idea past several AI models from different labs, makes them
argue about it on the record, and stops at a checkable result.

Runs as an **MCP server** (so an agent like Claude Code can drive it) or as a **CLI**. Bring your
own API keys. Nothing is resold, nothing is hosted for you, and no key ever leaves your machine.

> **On what this does and doesn't claim.** This repo publishes the mechanism: the chains, the seat
> rosters, the stage order. It does not claim to produce better plans than a single good model
> would. That is an open question and we have not measured it. What it does, concretely, is make
> disagreement between models *visible and recorded* instead of averaged away — you can read who
> objected to what, who withdrew a proposal under argument, and who held their position.

**A visual walkthrough of all of this — the stages, one real run's debate board, and what that run
cost — is at [muad-yasin.github.io/the-high-council-mcp](https://muad-yasin.github.io/the-high-council-mcp/).**
A different write-up, built around one run's actual debate board, is at
[sower-industries.de/en/MCP/](https://sower-industries.de/en/MCP/).

## How it works

A run moves through fixed stages. Which stages fire depends on the chain you pick.

1. **Questions** — a seat reads the request and asks only the questions whose answers would change
   the output. You answer them (or take its stated defaults).
2. **Criteria** — the request becomes a short list of acceptance criteria, each one a yes/no check
   rather than a matter of taste.
3. **Skeleton** — an outline the other models will propose against. Names the parts, decides
   nothing.
4. **Proposals** — every lab proposes buildable parts, blind to each other.
5. **Debate** — the labs read each other's proposals, anonymised, and post support / object /
   merge. Then each author replies: keep, amend, or withdraw.
6. **Build** — one seat integrates the surviving proposals into a single document.
7. **Panel review** — every critic independently grades the draft against the acceptance criteria,
   blind. Not unanimous? It revises against the union of every objection and the panel reviews
   again, up to the chain's round cap.
8. **Handoff** — a `HANDOFF.md` written for whoever executes the result.

Every run writes a folder: the deliverable, `BOARD.md` (the full debate — every post, every
withdrawal), `HANDOFF.md`, a per-lab scoreboard, and the real token/cost accounting.

### Reading a run with a program

`BOARD.md` is for people. **`report.json` is the same board, structured** — if you are building
anything on top of a run, read that instead. Do not parse the markdown.

```jsonc
{
  "runId": "...", "chain": "...", "passed": false,
  "criteria":  [ "each acceptance criterion, as written before the debate" ],
  "proposals": [ { "id": "DEEPSEEK-1", "lab": "deepseek", "model": "...",
                   "title": "...", "serves": "...", "what": "...", "why": "..." } ],
  "debate": {
    "posts":   [ { "by": "deepseek", "on": "QWEN-1", "stance": "object|support|merge",
                   "text": "...", "merge_with": "GLM-2" } ],
    "replies": [ { "id": "DEEPSEEK-1", "action": "keep|amend|withdraw",
                   "text": "...", "replaced_by": "GLM-1" } ]
  },
  "signoff": [ { "provider": "qwen", "model": "...", "signedOff": false,
                 "objections": [ { "criterion": "...", "problem": "...", "fix": "..." } ] } ],
  "lastCritique": { "meets": false, "failures": [ { "criterion": "...", "lab": "qwen" } ] },
  "scoreboard": { "rows": [ ... ] },
  "totals": { "input": 0, "output": 0, "usd": 0, "unpriced": [] }
}
```

`proposals` plus `debate.posts` is a directed graph with verifiable edges: one node per proposal,
one edge per posture, and `replies[].action` says what each author did with their own proposal
once they had read the argument against it. That is the whole artifact, already machine-readable.

`signoff[].objections` is why a seat declined, on the seat's own record. `signedOff: null` means
the seat gave no usable reply and abstained — neither a pass nor an objection, and `objections` is
`null` rather than empty so the two stay apart. A seat that agreed has an empty list.
The same objections also appear flattened in `lastCritique.failures[]`, tagged with `lab`, because
the reviser wants the union across the whole panel. Both are built in one pass; they cannot drift.

**Before you publish a run,** note that `report.json` records `task` as the path to your task file
on your own disk. Nothing transmits it anywhere — but if you are rendering a board onto a public
page, drop that field. The debate itself is the part worth showing.

## Requirements

- Node 20+
- API keys for whichever labs the chain you choose actually uses

## Setup

```bash
git clone https://github.com/muad-yasin/the-high-council-mcp.git
cd the-high-council-mcp
npm install
cp .env.example .env
```

Fill in `.env` with only the keys your chosen chain needs. Supported providers:

`ANTHROPIC_API_KEY` · `OPENAI_API_KEY` · `GOOGLE_API_KEY` · `MISTRAL_API_KEY` ·
`DEEPSEEK_API_KEY` · `GROQ_API_KEY` · `TOGETHER_API_KEY` · `COHERE_API_KEY` ·
`OPENROUTER_API_KEY` · `ZAI_API_KEY` · `XAI_API_KEY`

The CLI refuses to start if any seat in the chosen chain is missing its key, rather than failing
halfway through a paid run.

## Quick start (CLI)

A task file is the request the council plans against: plain prose, written by you. There is no
template and no format — write what you actually want, including the constraints that matter.

```bash
mkdir -p tasks
echo "Plan the data model for a bookmarking app. Single user, offline-first." > tasks/your-idea.md

# see what's available and what it would cost
node src/cli.js --help
npm run dry -- --task tasks/your-idea.md --chain verify

# a real run
node src/cli.js --task tasks/your-idea.md --chain verify
```

`tasks/` and `runs/` are both gitignored. Your requests and everything the council writes about
them stay on your machine — if you fork this repo, you will not accidentally publish them.

`verify` is the cheap default: two labs, a hard two-round cap. Start there.

### Telling the council what your build session can actually use

One optional convention, worth the four lines it costs. If your task file ends with a section
headed **`## Available tools`**, the handoff seat will name the right one in the acceptance test
for each item of work, instead of inventing a check from nothing:

```markdown
## Available tools

- `scope-gate` — decides GO / NEEDS-SPEC / KILL before anything is built
- `bug-audit` — reads code line by line, reports verified defects, edits nothing
- `npm test` — the project's own suite
```

The council is told what exists, not how it is invoked, and is instructed never to name a tool
that is not on your list. Leave the section out and the handoff assumes nothing beyond your test
suite — which is what it did before this existed, and what it will keep doing.

This costs no tokens you were not already spending: the task file is already in the handoff seat's
prompt. It is the difference between *"write a test for this"* and *"run `scope-gate` on this
before building it."*

### The spend cap

Every run has a per-run ceiling in USD. It defaults to **$5**, and is checked *before* each paid
stage — a stage that could take the run past the ceiling is never called, so the cap holds rather
than reporting the overspend afterwards.

```bash
node src/cli.js --task tasks/x.md --max-usd 2     # this run stops at $2
node src/cli.js --task tasks/x.md --max-usd none  # no ceiling
export MAX_USD_PER_RUN=20                         # change the default
```

A run that hits the ceiling stops cleanly and writes `STOPPED-budget.md` saying what it spent, which
stage it stopped at, and what that stage would have cost. Nothing is half-written: it produces no
`deliverable.md` and no `report.json`, so a stopped run never reads as a finished one. Continue it
with a higher ceiling — completed stages replay from disk and cost nothing the second time:

```bash
node src/cli.js --resume runs/<id> --max-usd 10
```

The cap governs one run. To see what you have spent across all of them:

```bash
node src/cli.js --spend            # today
node src/cli.js --spend --days 7   # the last week
```

That is read back off the run folders on disk — there is no ledger file, nothing is recorded
anywhere else, and nothing leaves your machine. Runs still going, or stopped by the cap, are
counted from the stages they already paid for. The same figures are available to an MCP client as
`spend_report`.

To watch this work without spending anything, the `mock-budget` chain calls no API but carries
fixture prices:

```bash
node src/cli.js --task tasks/your-idea.md --chain mock-budget --max-usd 1
```

If a chain pauses for your input, it writes `NEEDS-<stage>.md` into the run folder and tells you
how to resume:

```bash
# write your answer to runs/<id>/answers.md, then:
node src/cli.js --resume runs/<id>
```

## Quick start (MCP)

Register the server with your MCP client. For Claude Code, from a clone of this repo:

```bash
claude mcp add high-council -- node /absolute/path/to/the-high-council-mcp/src/mcp/server.js
```

**The path must be absolute.** The client starts the server from its own working directory, not
from this one, so a relative path resolves somewhere unexpected and the server never starts.

Once the package is published to npm, no clone is needed:

```bash
claude mcp add high-council -- npx -y the-high-council --mcp
```

Either way the server reads and writes in **your** working directory, not inside the package:
`.env` for keys, `tasks/` for requests, `runs/` for output, and a `chains/` of your own takes
precedence over the bundled ones.

To run it by hand, from a clone:

```bash
npm run mcp          # or: node src/cli.js --mcp
```

Then drive it with these tools:

| Tool | What it does |
|---|---|
| `list_chains` | Available chains with descriptions and worst-case price |
| `write_task` | Write the request the harness plans against |
| `dry_run` | Price a run before spending anything |
| `start_run` | Start a run in the background (`max_usd` sets its ceiling) |
| `run_status` | Stage reached, panel verdicts, scoreboard, cost, budget remaining |
| `spend_report` | What every run has cost across a window of days, derived from disk |
| `external_prompt` | The prompt a paused external stage is waiting on — **read it with this, not by opening the file**; the prompts are routinely tens of thousands of tokens and most clients silently truncate a file read |
| `submit_stage` | Answer a paused stage and resume |
| `resume_run` | Resume a paused run, or raise `max_usd` on one the cap stopped |
| `read_run_file` | Read any file from a run folder |
| `list_runs` | Past runs |
| `plan_outline` | Outline pass |

## Chains

30 chain configs live in `chains/`. Each one is plain JSON — the seat roster, which models fill
which seat, the round cap, and whether proposals/debate/handoff stages run. They are meant to be
copied and edited.

A few worth knowing:

- **`verify`** — two labs, two rounds. The recommended starting point.
- **`cheap`** — small models throughout. For testing the harness itself, not for real work.
- **`plan-debate`** — five labs propose blind, debate each other's proposals anonymised, then a
  blind panel grades the integrated draft.
- **`plan-auto`** — the full open-scope chain, every seat on a real API, runs unattended end to end.
- **`plan-unanimous`** — every critic must independently sign off on the *same* draft. Three rounds
  here means up to fifteen critic calls, not five.

Read a chain's `description` field before running it; they say what they cost you in calls.

## Known limits, stated plainly

- The spend cap is enforced against a **worst case**, not a prediction: the whole prompt billed as
  input plus the seat's entire `maxTokens` budget billed as output (doubled for Anthropic seats,
  which may retry once). Real stages almost never cost that much, so a run can stop with headroom
  left. That is the intended trade — resume it with a higher ceiling.
- A seat whose model has no entry in `src/pricing.json` is **unpriced, and therefore uncapped**.
  It contributes $0 to the running total no matter what it really costs. Check `dry_run` output
  for `unpriced` before trusting a ceiling.
- Prices in `src/pricing.json` are hand-maintained list prices, last verified 2026-09-06. They are
  estimates, not invoices. Your provider's bill is the real number.
- Chains with many labs and high round caps get expensive quickly. `plan-unanimous` at three rounds
  is fifteen critic calls; `plan-auto` runs several frontier models over multiple rounds. Price
  before you run.
- A panel that signs off is not a guarantee the output is correct. It means every critic seat
  checked it against the stated acceptance criteria and found nothing. Criteria that are vague
  produce sign-offs that mean nothing — the quality of the run depends heavily on the quality of
  the criteria stage.
- Some chains pause for human input by design. They are not stuck.

## If this makes you money

The licence is MIT. You owe nothing, and that is the whole licence — nothing below changes it.

If The High Council ends up helping you build something that earns, I'd ask for **0.7%** of what it
earns. Not a fee, not a clause, not a subscription. A request between people who build things.

There is no reporting, no audit, no tracking, and nothing checks. **No is a complete answer** — use
it, fork it, sell what you build with it, and never think about this section again. That is a fine
outcome and it's why the licence says what it says.

If you'd rather say yes: [pay what you think it's worth](https://buy.stripe.com/cNi14neoycSF0sseYrfjG01).

## License

MIT. See [LICENSE](LICENSE). The section above is a request, not a term of it.
