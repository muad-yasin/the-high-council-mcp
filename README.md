# The High Council

[![Test](https://github.com/muad-yasin/the-high-council-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/muad-yasin/the-high-council-mcp/actions/workflows/test.yml)

See it work right now - no keys, no setup, no cost:

    npx github:muad-yasin/the-high-council-mcp council demo

Add it to Claude Code as an MCP server the same way:

    claude mcp add council -- npx -y github:muad-yasin/the-high-council-mcp council --mcp

*(An npm package is coming - not yet published. Both lines above work today, straight from this
GitHub repo, no npm account needed.)*

A planning harness that runs one idea past several AI models from different labs, makes them
argue about it on the record, and stops at a checkable result.

Runs as an **MCP server** (so an agent like Claude Code can drive it) or as a **CLI**. Bring your
own API keys. Nothing is resold, nothing is hosted for you, and no key ever leaves your machine.
Run `npx github:muad-yasin/the-high-council-mcp council doctor` to see which of your own keys are
set, which shipped chains you can already run with them, and what each would cost - before
spending anything.

> **On what this does and doesn't claim.** This repo publishes the mechanism: the chains, the seat
> rosters, the stage order. It does not claim to produce better plans than a single good model
> would. That is an open question and we have not measured it. What it does, concretely, is make
> disagreement between models *visible and recorded* instead of averaged away - you can read who
> objected to what, who withdrew a proposal under argument, and who held their position.

**A visual walkthrough of all of this - the stages, one real run's debate board, and what that run
cost - is at [muad-yasin.github.io/the-high-council-mcp](https://muad-yasin.github.io/the-high-council-mcp/).**
A different write-up, built around one run's actual debate board, is at
[sower-industries.de/en/MCP/](https://sower-industries.de/en/MCP/).

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
8. **Handoff** - a `HANDOFF.md` written for whoever executes the result.

Every run writes a folder: the deliverable, `BOARD.md` (the full debate - every post, every
withdrawal), `HANDOFF.md`, a per-lab scoreboard, and the real token/cost accounting.

### Reading a run with a program

`BOARD.md` is for people. **`report.json` is the same board, structured** - if you are building
anything on top of a run, read that instead. Do not parse the markdown.

```jsonc
{
  "runId": "...", "chain": "...", "passed": false, "maxUsd": 5,
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
                   "text": "...", "replaced_by": "GLM-1" } ]
  },
  "signoff": [ { "provider": "qwen", "model": "...", "signedOff": false,
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

`signoff[].objections` is why a seat declined, on the seat's own record. `signedOff: null` means
the seat gave no usable reply and abstained - neither a pass nor an objection, and `objections` is
`null` rather than empty so the two stay apart. A seat that agreed has an empty list.
The same objections also appear flattened in `lastCritique.failures[]`, tagged with `lab`, because
the reviser wants the union across the whole panel. Both are built in one pass; they cannot drift.

**Before you publish a run,** note that `report.json` records `task` as the path to your task file
on your own disk. Nothing transmits it anywhere - but if you are rendering a board onto a public
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
halfway through a paid run. `ollama` (below) is the one exception - it needs no key at all.

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

A local seat prices at $0 in every estimate and run report - `dry_run` shows it as priced, not
"unpriced," and it can never trip the spend cap. See `chains/local-ollama.json` for a full
example chain with every seat local. As with every other seat in this project: BYOK is really
BYO-compute here, and no efficacy claim is made about local models versus hosted ones - nothing
has been measured.

## Quick start (CLI)

A task file is the request the council plans against: plain prose, written by you. There is no
template and no format - write what you actually want, including the constraints that matter.

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
them stay on your machine - if you fork this repo, you will not accidentally publish them.

`verify` is the cheap default: two labs, a hard two-round cap. Start there.

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

Every run has a per-run ceiling in USD. It defaults to **$5**, and is checked *before* each paid
stage - a stage that could take the run past the ceiling is never called, so the cap holds rather
than reporting the overspend afterwards.

```bash
node src/cli.js --task tasks/x.md --max-usd 2     # this run stops at $2
node src/cli.js --task tasks/x.md --max-usd none  # no ceiling
export MAX_USD_PER_RUN=20                         # change the default
```

A run that hits the ceiling stops cleanly and writes `STOPPED-budget.md` saying what it spent, which
stage it stopped at, and what that stage would have cost. Nothing is half-written: it produces no
`deliverable.md` and no `report.json`, so a stopped run never reads as a finished one. Continue it
with a higher ceiling - completed stages replay from disk and cost nothing the second time:

```bash
node src/cli.js --resume runs/<id> --max-usd 10
```

The cap governs one run. To see what you have spent across all of them:

```bash
node src/cli.js --spend            # today
node src/cli.js --spend --days 7   # the last week
node src/cli.js --cost-today       # today by calendar day, with a per-model breakdown
node src/cli.js --cost-today --date 2026-09-01
node src/cli.js --stats --days 30    # how the debate mechanism itself is doing
```

That is read back off the run folders on disk - there is no ledger file, nothing is recorded
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

Register the server with your MCP client. No clone needed - straight from GitHub:

```bash
claude mcp add council -- npx -y github:muad-yasin/the-high-council-mcp council --mcp
```

Or from a clone of this repo:

```bash
claude mcp add high-council -- node /absolute/path/to/the-high-council-mcp/src/mcp/server.js
```

**The path must be absolute.** The client starts the server from its own working directory, not
from this one, so a relative path resolves somewhere unexpected and the server never starts.

An npm package is coming - not yet published, no date. Once it lands:

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
| `spend_report` | What every run has cost across a window of days, plus `session_cost_today` (calendar-day, per-model breakdown), derived from disk |
| `verdict_stats` | How the debate mechanism itself is doing, per chain and per lab: sign-off rate, rounds, objections, dropouts, cost/wall time, largest prompt files - derived from disk |
| `metrics_report` | Descriptive telemetry only (never an evaluation or baseline): amendment rate, withdrawal rate, objection-follow-through rate, tool-call usage - derived from disk |
| `external_prompt` | The prompt a paused external stage is waiting on - **read it with this, not by opening the file**; the prompts are routinely tens of thousands of tokens and most clients silently truncate a file read |
| `prepare_stage_prompt` | Write a self-contained bundle for a paused stage, so a driving session doing other work at the same time can dispatch it to a fresh subagent instead of authoring it inline - see [`docs/dispatch-pattern.md`](docs/dispatch-pattern.md) |
| `submit_stage` | Answer a paused stage and resume. Optional `claimed_by` records who's answering; a second submission for an already-answered stage no longer errors - it's kept as `<stage>.late.md` with a warning instead of being rejected |
| `resume_run` | Resume a paused run, or raise `max_usd` on one the cap stopped |
| `read_run_file` | Read any file from a run folder |
| `list_runs` | Past runs |
| `plan_outline` | Outline pass |

**External vs. API-backed seats.** `{ "provider": "external" }` pauses a run at that seat so a
Claude Code session on a flat-rate subscription plays it - free at the point of use, since the
subagent runs on the same subscription. If you don't hold a flat-rate subscription and pay
metered rates for everything anyway, `{ "provider": "anthropic" }` (or another API provider) may
be simpler for those seats: no dispatch pattern to learn, at roughly 5x the metered cost of the
same debate on external, based on one measured comparison, not a guarantee. Not the default
anywhere in this repo's config, README ordering, or example chains - external stays recommended
for anyone with a subscription, since the project's cost story depends on it.

## Chains

31 chain configs live in `chains/`. Each one is plain JSON - the seat roster, which models fill
which seat, the round cap, and whether proposals/debate/handoff stages run. They are meant to be
copied and edited.

A few worth knowing:

- **`verify`** - two labs, two rounds. The recommended starting point.
- **`cheap`** - small models throughout. For testing the harness itself, not for real work.
- **`plan-debate`** - five labs propose blind, debate each other's proposals anonymised, then a
  blind panel grades the integrated draft.
- **`plan-auto`** - the full open-scope chain, every seat on a real API, runs unattended end to end.
- **`plan-unanimous`** - every critic must independently sign off on the *same* draft. Three rounds
  here means up to fifteen critic calls, not five.

Read a chain's `description` field before running it; they say what they cost you in calls.

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

## New in 0.6.0

- **Role-assigned debate seats** - see the `role` field above. Ships the mechanism only; whether
  it changes anything about a real debate is untested by this release.
- **`report.json`'s `debate.diagnostics`** - four failure-mode signals computed from a run's own
  real debate output (never from an offline probe): a seat quoting no evidence despite objecting
  or merging, textual overlap between differently-lensed seats' posts on the same proposal, a
  same-run gap between role-bearing and role-less seats' evidence quoting, and the share of a
  seat's own words that fall inside quoted evidence versus voice. Present (with nulls/empty
  flags where there's nothing to compute) on any run that had a debate stage; absent otherwise.
- **`debate.tie_break`** - a `report.json` field recording a weighted-tiebreak event, when one
  fires. Not yet wired into a live vote-counting decision in this release.
- **`PERSONAS.md`** - the five default public persona names and their voice directives, and how
  an operator replaces the whole set with their own via `COUNCIL_PERSONAS_FILE`.

## New in 0.5.0

- **`council init [--yes]`** - the first thing to run in a fresh clone with no keys yet. Prints a
  key check, writes a starter chain and task file you own (`chains/my-first-chain.json`,
  `tasks/my-first-task.md` - a rerun never overwrites an edit you made to either), prices the
  starter chain with no network call, then runs a canned, all-mock, $0 task end to end so the
  first thing you inspect is a real run folder, not just terminal output.
- **`council doctor --chain <file>`** - lints one chain config before you ever run it: a seat
  under a misspelled key (never wired to any stage), a missing or empty `seats.critics` (the
  review round can't run), or a seat naming a provider this codebase doesn't know. The same check
  also runs automatically, fail-loud, the moment you try to actually run a broken chain - before
  any paid call.
- **`council doctor --scan-artifacts`** - scans your `tasks/` and `chains/` for API-key-shaped
  strings before you commit or share them. Reports the file and line, never the matched text.
- **`council --forecast-cost --chain <name> [--days N]`** - a realistic-case USD range for a
  chain, built from its own historical runs on your machine and repriced at today's rates -
  distinct from `--dry-run`'s worst-case estimate from a chain's declared token assumptions.
- **`council export-board --run <folder> --out <file>`** - a run's proposals, debate, replies and
  verdict as one self-contained HTML file. No external assets, no server, `<details>` sections.
- **`council replay --run <folder> [--json]`** - a numbered, step-by-step transcript of a run's
  reasoning in your terminal, with a `--json` mode for scripting.
- **A structured error catalog** (`COUNCIL-E001`-`COUNCIL-E004`, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md))
  for the hard-fail paths this project actually has - a missing key, an unpriced model, a
  malformed chain file, an unreadable stage reply - each with a plain-words cause, a concrete fix
  naming the real file, and a doc pointer. Degradable conditions exit 5; fatal ones exit 6.
- **Structured per-stage JSON logs** - every run now also writes `stage-log.jsonl` (one line per
  stage: seat, lab, token counts, cost, timing - no prompt content) alongside the existing
  markdown/`report.json` artifacts.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - the three smallest landable contribution shapes, for
  anyone who wants to send a PR rather than only file an issue.

None of the above change any existing chain's behaviour. `schemaVersion` and
`max_proposals_per_seat` are both opt-in; a chain file that predates 0.5.0 runs exactly as it did
before.

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
pass that never happened. The comments name the run id and the date. The retry that disables
thinking exists because an Anthropic seat burned its entire `maxTokens` budget thinking and
returned nothing. The `ROSTER SHRANK` warning exists because a lab can return nothing and vanish
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

## Known limits, stated plainly

- The spend cap is enforced against a **worst case**, not a prediction: the whole prompt billed as
  input plus the seat's entire `maxTokens` budget billed as output (doubled for Anthropic seats,
  which may retry once). Real stages almost never cost that much, so a run can stop with headroom
  left. That is the intended trade - resume it with a higher ceiling.
- A seat whose model has no entry in `src/pricing.json` is **unpriced, and therefore uncapped**.
  It contributes $0 to the running total no matter what it really costs. Check `dry_run` output
  for `unpriced` before trusting a ceiling. `ollama` seats are the one deliberate exception: they
  price at an explicit $0 for any model name (they are genuinely free to run), so they never show
  up in that `unpriced` list and never need a pricing.json entry.
- Prices in `src/pricing.json` are hand-maintained list prices, last verified 2026-09-06. They are
  estimates, not invoices. Your provider's bill is the real number.
- Chains with many labs and high round caps get expensive quickly. `plan-unanimous` at three rounds
  is fifteen critic calls; `plan-auto` runs several frontier models over multiple rounds. Price
  before you run.
- A panel that signs off is not a guarantee the output is correct. It means every critic seat
  checked it against the stated acceptance criteria and found nothing. Criteria that are vague
  produce sign-offs that mean nothing - the quality of the run depends heavily on the quality of
  the criteria stage.
- Some chains pause for human input by design. They are not stuck.

## Privacy

This tool and the [demo page](https://muad-yasin.github.io/the-high-council-mcp/demo.html)
collect nothing. Stated plainly, not as a claim about quality:

- No telemetry, no analytics, no tracking of any kind, anywhere in this repo.
- The only network calls this tool ever makes are to the AI provider APIs you configure with
  your own keys (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, and so on) - and only when you start
  a real run with a non-mock, non-external seat. `council doctor` and `council demo` make zero
  network calls; both are implemented to read only local files and environment variable names.
- The GitHub Pages site (`docs/`) ships no JavaScript and loads no third-party resource - see
  `test/landing-page.test.js`, which fails the build if either ever changes.
- Everything a run produces - the task, the debate, the deliverable, the cost - is written to a
  folder on your own disk (`runs/<id>/`) and nowhere else. Deleting that folder deletes the
  record. See `src/spend.js`'s own documentation for why spend accounting is derived from those
  folders rather than kept in a separate log.

## Accessibility

The GitHub Pages site (`docs/`) uses only native HTML elements for interaction - `<a href>`
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
- No image ships anywhere in `docs/` (checked directly - zero `<img>` tags across all three
  pages), so there is no informative image that could be missing alt text.
- Primary body text (`#8d8a84`/`#b9b5ad`) against the page background (`#0a0a0b`) measures
  roughly 5.7:1 contrast by the WCAG relative-luminance formula, above the 4.5:1 AA threshold
  for normal text.

## Reporting a bug

Open an issue: [github.com/muad-yasin/the-high-council-mcp/issues](https://github.com/muad-yasin/the-high-council-mcp/issues).
Or write to [contact@sower-industries.de](mailto:contact@sower-industries.de).

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
