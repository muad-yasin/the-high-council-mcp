# CLAUDE.md

Guidance for Claude Code sessions in this repository.

## What is not in this file, and when to read it

This file holds what every session needs. The detail that one kind of work needs is in `maintainers/`; a part named
in quotes below stands in `maintainers/ARCHITECTURE.md`, moved there word for word. Read the part before you start
that work:

- **Money** (you change `invoke()`, `src/cost.js`, a price, or anything that counts, reserves or shows spend): "The
  spend cap" and "Cross-run spend: what is recorded".
- **Prompt wording** (you draft or change it): "Held prompt text".
- **A module or part named in `maintainers/ARCHITECTURE.md`** (the CLI, the MCP server, providers, keys, `.env`,
  reasoning, cost, the contract record, the debate pieces, the approval gate, the repair pause, what the advice
  add-on left behind): its entry.
- **A run, a chain file or a seat** (you change `src/chain.js`, write or change a chain file or a seat, or need to
  know why a run paused, stopped or ended): `maintainers/RUN-FLOW.md`, how a run flows.
- **A release:** the release order, the last section of `maintainers/HANDOFF.md`.
- The earlier, longer version of this file (with the history behind many rules) is
  `maintainers/CLAUDE-2026-10-09-before-rewrite.md`; git history keeps every version.

## What this is

`the-high-council-mcp` - a multi-model planning harness, published as an MCP server and a CLI. It runs one
request past seats filled by models from different labs, makes them argue on the record, and writes a
deliverable plus a full debate board. MIT, BYOK-only.

- **Public.** The repo is public: anything pushed is published. The npm package `the-high-council` is public;
  the latest release is **0.8.4** (tag `v0.8.4`; npm, a GitHub release with the `.mcpb`, the MCP registry).
  Release history: `maintainers/HANDOFF.md` and `CHANGELOG.md`.
- **Settled, do not reopen:** the package name is `the-high-council` (`THC` is internal shorthand); `council`
  is the public command and `relay` an alias kept for compatibility; the `LICENSE` holder is Sower Industries;
  the licence stays MIT. Homepage: https://sower-industries.de/en/THC/.
- "The High Council" is this harness. "Sophi-A" is a separate product (a Tauri app, a different repo,
  Apache-2.0). Do not conflate them.

## Rules that are not style preferences

### The product

- **BYOK only.** Never add a default key, a proxy, or a hosted/"try it free" path.
- **No xAI/Grok, ever** (owner, 2026-09-23). Not in any chain, roster, example or default, and not through a
  router id that could pick it (`openrouter/auto` and the like). Enforced by chain-lint's `denied-model` rule
  and a run-time check, with no opt-out (`test/denied-models.test.js`, `test/denied-router-ids.test.js`); never
  add one.
- **Reasoning effort is never lowered** (owner, 2026-10-05: "NO LOWER EFFORT"). Shipped chains run high; no
  code path may lower a seat's effort (`test/reasoning-never-lower.test.js` scans for it; chain-lint's
  `reasoning-not-high` refuses a shipped chain that does, a user's own chain passes through).
- **No efficacy numbers** about the harness in any user-facing text until something has actually been measured. A
  qualitative claim the owner has seen and approved in his own words may be printed as his statement; nothing is
  quantified, and no comparison with another tool is claimed.
- **The "Known limits" (`KNOWN-LIMITS.md`, linked from the README) stay honest.** Delete a limit only when the code makes it untrue, in the same
  commit as the fix; never because it is embarrassing (`test/known-limits.test.js`).

### The owner's gates

- **Paid runs.** No paid run (any non-`mock` provider) without the owner's explicit go and a `--max-usd` cap; use
  `chains/mock*.json` otherwise.
- **Prompt wording.** New or changed prompt wording needs the owner's yes.
- **Pushing and releasing.** Commit freely; push, tag, release and `npm publish` are the owner's (publish needs his
  2FA passkey, from a real terminal). No new release unless he asks.

### The repository

- **A count moves in the same commit as the thing it counts** (chains, tools, providers, skills, the default cap):
  the README, `AI-README.md`, `docs/index.html` and `docs/skills.html` type them by hand, and tests derive the real
  ones.
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
npm run dry -- --task tasks/x.md --chain plan-mini-council   # price a run, call nothing (--dry-run; there is no --dry)
node src/cli.js --task tasks/x.md --chain plan-mini-council  # a REAL, PAID run: owner's go + --max-usd only
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

**Dated tables expire on purpose.** The reasoning table and the price rows turn
`npm test` red when they are old: a release-week chore, not a bug. Regenerate them
(`scripts/refresh-reasoning-table.mjs`, `scripts/refresh-openrouter-prices.mjs`; the failing test names the
table) - never patch an expiry date in a test.

## Architecture

The whole harness is one function, `runChain()` in `src/chain.js`, driven by a JSON config. Everything else is
an entry point into it or a support module.

This section keeps what a run leaves on disk and each rule that code outside its own part can break. How a run
flows is in `maintainers/RUN-FLOW.md`. The other parts are in `maintainers/ARCHITECTURE.md`, word for word. Read
the part there before you change it.

### What a run leaves on disk

**The run folder is the database.** Each run writes `runs/<iso-timestamp>/`: `run.json` (how to resume),
`<label>.md` + `<label>.usage.json` per stage, `run.log`, `deliverable.md`, `BOARD.md`, `HANDOFF.md`,
`report.json`, and where used `contract/`, `spend-reservations.jsonl` and `network-resumes.jsonl`. There is no state outside the run
folder.

**`report.json` is the machine-readable board; `BOARD.md` is the same thing for people.** Anything built on a run
reads the JSON - `proposals[]`, `debate.posts[]` (`by`/`on`/`stance`/`merge_with`), `debate.replies[]`
(`keep`/`amend`/`withdraw`), `signoff[]`, `scoreboard`, `totals`: together a directed graph with verifiable edges.
Nothing may parse `BOARD.md`'s headings; `AI-README.md` says so (a Council once specified a markdown parser because
the JSON was undocumented). Its shape is a public contract (`schemas/report-v1.json`,
`test/report-schema.test.js`): adding fields is fine, renaming or removing one is a breaking change.

**Resume and the stage cache.** `setCache()` gives `chain.js` a `get(label)` that replays a stage from
`<label>.md` on disk at zero cost: a replayed stage makes no new paid call, the stages still to run do. Stage
labels must stay stable - renaming a label orphans every run that paused before it.

### Prompt wording

- `src/roles.js` - the one import point of the WORDING of every system and user prompt (a list of exports by name); the words are in the files under `src/prompts/`; never inline in `chain.js`. A scope rule is
  swapped by template (`criticSystem(open)`, `criteriaSystem(open)`).
  `src/handoff-prompt.js` is the one place the handoff prompts are ASSEMBLED, from `roles.js`'s words.
  `HANDOFF_SYSTEM` reads an optional `## Available tools` section from the task file; its real content is the
  restraint: exact names only, never invent a tool or command line, assume nothing when the section is absent.
  Tests pin how prompts are built (`test/roles.test.js`); the mock provider picks its canned reply by fixed
  phrases and markers it looks for in a prompt (for example the opening words of a role, section headings, the
  rating demand, the `relation` field and a judge's own listed objections; `src/providers.js`), so no test shows
  how a model answers changed wording.

### Reading what a seat wrote

**Model output is assumed to be broken.** `parseJson` in `chain.js` repairs specific, observed failure modes
(unescaped quotes inside markdown-quoted spans, raw newlines in string values) with real string-state tracking
rather than regex, and deliberately still fails on genuinely garbled output. `classifyUnreadable` separates
provider errors from truncation from malformed JSON. `invoke()` retries once, at the same reasoning effort and a
bigger cap, when an Anthropic seat burns its whole `maxTokens` on thinking (never lower; see Rules). Every one of
these encodes a real incident - the comments name the run and the date. Read the comment before changing the
behaviour, and keep the regression tests in `test/chain.test.js`, built from the actual broken replies.

- `src/draft-disputes.js` (`parseDisputes`, `stripDeclined`) - **every reader of a builder's or reviser's raw stage text must go through
  `stripDeclined`** (a test scans `src/` for readers that skip it). The build stage strips DECLINED lines only; a
  reviser also a trailing Disputed block.

### Paid calls and the spend cap

**The spend cap is enforced in `invoke()`, before the call.** **Any new paid call must go through `invoke()` or it
escapes the cap entirely.** How a call is priced against the cap, how a run can still end above its ceiling and
what an unpriced seat does: "The spend cap" in `maintainers/ARCHITECTURE.md`.

## Cross-run spend (`src/spend.js`)

`spendReport()` answers "what have I spent across every run". It is **derived, never recorded**: every figure is
read back out of `runs/<id>/`. Do not add a ledger outside the run folder: it would be a second copy of the truth
that can drift, need a write path that can fail mid-run, miss runs that predate it, and outlive run folders a user
deleted because they were sensitive. So a deleted run folder's spend disappears from the report, on purpose; runs
with no `report.json` (still going, or stopped by the cap) are counted from their `<label>.usage.json` files. Spend
output carries the chain and the cost only - never the task path or any run content. A missing, unreadable or
corrupt `runs/` gives a usable answer, never an error, and `spendReport` never writes to disk (a test pins both).

**The one recorded figure** is `runs/<id>/spend-reservations.jsonl`. It lives and dies with the run folder; a
missing, torn or corrupt file reads as "none"; output carries amounts only. There is no command that reconciles an
unsettled reservation, on purpose: the figure errs high. `runs/<id>/network-resumes.jsonl` is not a figure. No
spend figure reads it and nothing counts from it; a reader added later must read a missing, torn or corrupt file as
none. Both are described in full under "Cross-run spend: what is recorded" in `maintainers/ARCHITECTURE.md`.

## Skills (`skills/`)

`skills/` ships generic, public skills alongside the harness; they are not part of it. The wider scope is the
owner's deliberate call; do not re-litigate it.

- **The bar for any skill:** generic (no single project's stack, rules, paths or decisions), public,
  BYOK-consistent. The role names of a setup of sessions, such as C&C, Builder A, Helper B or Server Controller,
  are fine in a skill's cases (owner, 12 Nov 2026). Game-engine and DCC skills qualify as neutral, dated, graded
  facts (owner, 2026-10-05); vendors (Unity, Unreal, Blender, published talks) may be named for facts only.
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

This is the owner's method for building this repo with several Claude Code sessions at once, published deliberately
(owner, 8 Oct 2026: it might help someone). The owner made this section the master copy of these rules on 11 Nov
2026; any other copy is a copy. **It applies only when the owner assigns a session a role**; every session follows
the Rules above.

**C&C** is the owner's Command-and-Control session: it routes work to builder sessions, reviews each milestone and
answers PASS or FIX. This text is the review shape for 0.8.4. "Advisor" here means the Claude Code session's
advisor model.

1. **Roles.** C&C routes and decides; builder sessions build. Dispatch means dispatch: C&C does not build a
   dispatched job itself. A second reviewing session takes unit reviews off C&C, helper sessions do reads, fact
   checks, wording reviews and small units, and a controller session runs every job on the test machine. Cards and
   messages name sessions by role, never by an id.

   **The second reviewer (Mini-C&C).** It is not always open. When it is, it takes work off C&C, so that C&C can
   keep to what matters most, delegating included. The owner names the builders that report to it, and it reviews
   their units at the end (rule 8). What it sends on to C&C meets the bar of rule 7 for what goes up. C&C keeps the
   order of the merges.

   **The owner in another window.** When the owner types in another session's window, that is his word: the session
   acts on it and tells C&C what he said, in his words, so that it is recorded.
2. **C&C consults its advisor before anything goes to a builder** that carries a fix, a ruling, a go, a
   PASS/FIX or a change to what it builds; also on a milestone's proposed defaults and at each milestone report
   before the verdict. Plain acknowledgements are exempt. If something went out without it: consult now, send a
   correction, and say so plainly.

   When an advisor call fails (rate-limited, overloaded, any error), the session waits 60 to 90 seconds (a
   background timer, not a blocking sleep) and calls it again, as often as it takes: the step that needs the consult
   waits and nothing goes out without it, while work that needs none goes on. This holds for C&C, every builder and
   every sub-agent.
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
6. **After any compact**, an automatic one included (or a restart), a session re-reads
   - its instructions,
   - the testing and machine rules below,
   - its own state file (a restart card: one current block, not a log),
   - the owner's list of the standing rules that bind after a compact,
   - if it is C&C, the short part of each of its skills (the description and the closing "Mistakes to flag"
     list), and
   - if it is a builder, the short part of two skills: `verification-and-critique`, on checking work, and
     `tool-and-action-discipline`, on safe actions (owner, 12 Nov 2026),

   then tells C&C (C&C tells the owner):
   - its commit and state,
   - the skills it re-read,
   - what its advisor said, and
   - its next step.

   This report is always sent. A session that cannot produce this has lost the rules.

   A skill is read in full when the session does that kind of work.

   **The state file is a restart card.** It holds what the session needs to start again: its branch, tip and base;
   what it has running on the test machine; what it owes to whom; its next step; its open questions; and one line
   for each unit it is working on, pointing to that unit's own working file. Notes on single steps go into that
   working file, as often as the work needs. When a unit merges or passes, its line leaves the card: git and the
   unit's files keep the history. An old block moves to an archive file; nothing is deleted. After a compact a
   session reads its card and opens a unit's file only when its next step needs it.

   A session writes its state file before a compact or a close, or when a standing rule or its plan changes.
7. **Builder reports**, once per finished unit:
   - the commit SHAs;
   - every exit check with its command and output;
   - per-file test counts (a file that did not run is a blank row) and the test arithmetic;
   - evidence that a new or changed test can fail: one red run (before the fix, or against a known-bad input: the
     `backend-developer` skill's rule), never deliberate breakages applied in place, mutation scripts or reruns of
     earlier milestones' checks (owner, 11 Oct 2026: "a normal amount of testing");
   - one probe that drives the real verb, with its output;
   - then the advisor's flags and the items to flag.

   Then wait for PASS/FIX.

   **What goes up.** A question only goes up when the plan is silent or contradicts itself on money, approvals or
   records, when a change touches another builder's code or already-accepted code, or when the plan must be
   departed from. Everything else the builder decides with its own advisor and notes in its report.

   **Between unit ends** a builder sends C&C one line after each commit ("one line per commit": owner, 9 Nov 2026):
   the SHA, what it does, and anything off the plan or against a recorded rule; C&C replies only if something is
   wrong, and the builder does not wait for a reply.

   **Per merge unit** (owner, 4 and 10 Nov 2026): one set per merge unit, run by each lane on its own tip without
   waiting for the merge (a later change to comments alone, or to the commit message, calls for no re-run): the new
   or changed test files, the tests that import a changed export and the source scanners, one row per file (a single
   multi-file `node --test` run flattens results and hides a file that never loaded), plus one failing run for each
   new or changed test (one deliberately failing tree, not the committed one, may carry several).

   **Not run:** a confirmation run after a commit, a run on a tree that has been replaced, a full suite for a single
   unit, a re-run of a failure that was only a timeout (it is recorded with its duration, not as a pass; the next full
   suite decides).

   **Full suites** run at three points: when the build is ready for review, after the reviewed wording is applied,
   and before the merge; a red gets fix-ups and a second full run. A heads-up before every full run, with absolute
   log paths, and a check that the process and the log exist after launch.
8. **C&C reviews a whole unit at its end** (owner, 1 and 8 Nov 2026), in its own worktree (never the shared
   checkout), against the plan's own exit list (not only the builder's map of it): it reads the builder's rows for
   the committed tree and runs only what has no row, saying which it ran and which it read; it does not run a full
   suite for a single unit.

   **Between unit ends** it reads each builder's one line per commit (rule 7) and answers only when something is
   wrong. Builders do not wait for it.

   **Every PASS** walks the obligations of the go message by SHA, reads the log tails and the names of skipped tests,
   and checks the owner's gates (see Rules): prompt words need the owner's yes, no paid run without a go and a cap,
   push and release belong to the owner, no efficacy numbers, no Grok, reasoning never lowered, counts move with the
   thing they count.
9. **Mistakes are disclosed at once, in plain words,** by whoever made them.
10. **Clock times: check the time each time** (owner, 11 Oct 2026). A clock time is written only in the same action
    that reads the clock: in a shell, `$(date ...)` inside the command that writes it, never a typed digit; before a
    message that names a time, read the clock as the step right before it; otherwise write "now" or name the event
    ("after the M5 PASS") instead. A time relayed from another session is checked against the clock first. A session
    that writes a time without reading the clock in the same step reports it as a slip.
11. **The shared machine.** Sessions share one computer.
    - While a test machine is up, a test set or a full suite that runs for several minutes goes to it, through
      its controller session, and does not run on the owner's own computer (owner, 4 and 12 Nov 2026). A small
      check that takes seconds is not a test run and may run on this computer: a parse check of a file
      (`node --check`), for example. The controller may stop a test it has confirmed hung, by its PID, and
      reports it (owner, 4 Nov 2026).
    - When no test machine is up, very light testing can run on this computer under the CPU lock (owner, 11 and 12
      Nov 2026).
    - What does run on this computer and takes longer than a few seconds goes through one lock and a CPU cap at the
      lowest priority, so the sessions together stay inside a stated share of the machine.
    - Kill a process only by its PID, never by a pattern (a pattern kill has hit another session's run).
    - A commit that was reported is never amended: fix-ups go on top.
12. **Sub-agents.** A builder may use up to three, for work whose input is big and whose output is a table or a trace
    (reading, tracing, mapping, counting, dated look-ups), each with its own advisor used regularly; its report ends
    with the advisor's flags.
    - An agent gets a big slice and runs until the slice is done: done is a result (every file classified, every
      site traced, every id sourced), never a size or time cap, and an agent that cannot finish returns what it has
      with the open items named. Three agents on three slices of one big question is the good case.
    - A sub-agent never commits, never writes a state or report file and runs nothing (owner, 8 Nov 2026); one that
      edits works in its own worktree.
    - A sub-agent's result is a delegate's report: the builder checks its load-bearing claims before they enter its
      own report.
13. **Habits of every session.**
    - No em-dashes in anything written for the owner (the owner's rule).
    - A builder ends a turn only on a pending test result, a sent unit-end report or a blocker.
    - A late find after a unit's list of owed items is frozen goes on a post-merge list unless it is a money or
      record defect, and a reviewer's FIX lists unmet obligations of the go message and money or record defects
      only, no new conditions on a tree already read.
    - Every ruling C&C sends by message is filed in the unit's own brief file, so the unit-end review can walk it.
    - Silence is never consent: when the owner steps away, approved work keeps running.
    - A commit uses the GitHub no-reply email address.

# Compact instructions

For a session that keeps a state file (session rule 6): the state file is what the session starts again from, so
the summary holds only what that file does not. Name the state file first. Keep, word for word, what the owner said
since the file was last written. Keep the decisions, results and open questions since then, and the step in flight
with its file paths. Do not retell what the state file, a unit's working file or git already hold, and do not copy
file contents or tool output. A session without a state file is summarised as usual.
