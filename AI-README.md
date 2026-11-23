# AI-Readme: The High Council, the full text

The full manual; the [README](README.md) is the short version.

- [Overview](#overview) · [Your first ten minutes](#your-first-ten-minutes) · [Words used here](#words-used-here)
- [How it works](#how-it-works) · [Reading a run with a program](#reading-a-run-with-a-program)
- [Requirements](#requirements) · [Setup](#setup) · [Quick start (CLI)](#quick-start-cli) · [Exit codes](#exit-codes) · [Quick start (MCP)](#quick-start-mcp)
- [The spend cap](#the-spend-cap) · [The contract record](#the-contract-record-council-contract)
- [Chains](#chains) · [How this was built](#how-this-was-built) · [Skills](#skills) · [Accessibility](#accessibility)

## Overview

You choose the number of debate rounds, the seats and labs (any lab except xAI), and the token
limit for each model's replies.

We recommend our own chains: the three planning tiers `plan-mini-council` (the default when no `--chain` is given), `plan-medium-council` and `plan-high-council` (the table below says who does what and what each costs). All three tiers have a layered review panel. You can also edit a chain to suit yourself, or write one
of your own.

See it work right now - no keys, no setup, no cost:

    npx the-high-council council demo

The demo takes one example request (a tool that renames holiday photos by date) through every
stage: blind proposals, an anonymised debate in which one proposal is withdrawn and two are
amended, a panel that splits in round 1 and signs off in round 2, and the handoff file. Every
model reply in it is written in advance; what is real is the code that runs the stages around
them.

**What it costs.** You pay the model providers directly, with your own API keys. The demo,
`doctor`, `init` and the `mock` chains cost $0 and make no network call. `--dry-run` prints two
figures before anything is called:

- **The expected cost:** what the chain's own size assumptions expect a run to cost.
- **The upper estimate:** the most the planned calls could cost if every one used its seat's whole output allowance.

What the upper estimate does with repeated calls:

- **Counted in:** a judge's re-asks (up to two a pass, and one for a final read) and the automatic retries after a network error (up to three in a run), each at the expected cost of the call it repeats.
- **Not counted in:** the cut-off retry of a seat that is not Anthropic, the extra passes a silent judge can cause, and the repeated attempts after a provider error.

A real run pays for those calls too, so it can cost more than the upper estimate. Only the spending limit you type is a bound.

Every paid run stops before any call that, by THC's estimate, would take it past the spending limit you type before it starts; estimates can be low, so a run can end above the limit. The shipped planning chains have no round limit, so there both figures rest on an assumed number of top-layer reads (visits of the top judge layer to the plan): three for the first figure and seven for the second (an assumption, not a limit: a number you type with `--rounds` replaces it); a run that agrees sooner costs less. On a chain of your own with an overseer-round limit both figures count every allowed round, and a panel
that signs off early skips the remaining rounds.

Three commands from nothing to a priced run of your own idea (no key needed until you drop
`--dry-run`; [Your first ten minutes](#your-first-ten-minutes) walks through them):

    npx the-high-council demo       # $0: every stage, scripted replies, no network
    npx the-high-council init       # writes tasks/my-first-task.md for your idea, plus a $0 mock run
    npx the-high-council --task tasks/my-first-task.md --chain plan-mini-council --dry-run

**Which chain.** Prices as `council doctor` prints them (expected / upper estimate), from the shipped price table
(prices as of 2026-10-23) and the default task-size estimate; a long task costs more.

| Chain | Who does what | Needs | Expected / upper estimate |
|---|---|---|---|
| `plan-mini-council` | The default chain, and the smallest of three planning chains: three proposers and a layered review panel of eight judges from six companies in three layers (at least two judges in every layer), no round limit, no alternatives stage and no deep dive. Compared with `plan-high-council` it asks fewer models. Claude Haiku 5.5 (layer 1) and Claude Sonnet 5.5 (layer 3) are called through Anthropic's API and the other seats run on OpenRouter. A Claude Code session writes the skeleton, the plan and the handoff. Its upper estimate ($530.17) is above the default cap of $12, which is also the Claude Desktop bundle's Spend ceiling; the expected figure ($9.52) fits under it. This roster has not run. | OpenRouter key + Anthropic key (without it the Claude seats go through OpenRouter) + a Claude Code session | $9.52 / $530.17 |
| `plan-medium-council` | The middle of three planning chains: three proposers and a layered review panel of eight judges from six companies in three layers; no round limit, no alternatives stage and no deep dive. Claude Sonnet 5.5 (a proposer), Claude Haiku 5.5 (layer 1) and Claude Opus 5.5 (layer 3) are called through Anthropic's API and the other seats run on OpenRouter. A Claude Code session writes the skeleton, the plan and the handoff. This roster has not run. Its upper estimate ($631.91) and expected figure ($14.78) are above the default cap of $12; the cheapest end ($8.83) fits under it. | OpenRouter key + Anthropic key (without it the Claude seats go through OpenRouter) + a Claude Code session | $14.78 / $631.91 |
| `plan-high-council` | The most thorough of three planning chains, with the strongest models and the same fifteen seats as `plan-the-high-council` (each seat carries a persona name in the title form): three proposers and a layered review panel of twelve named judges from eight companies in three layers, asked from layer 1 up; no round limit, no alternatives stage and no deep dive. Claude Opus 5.5 (a proposer), Claude Haiku 5.5 (layer 1), Claude Opus 5.5 (layer 2) and Claude Fable 5.2 (layer 3) are called through Anthropic's API and the other seats run on OpenRouter. A Claude Code session writes the skeleton, the plan and the handoff. This roster has not run. Its upper estimate ($1749.87) and cheapest end ($17.34) are above the default cap of $12. | OpenRouter key + Anthropic key (without it the Claude seats go through OpenRouter) + a Claude Code session | $31.56 / $1749.87 |
| `plan-china-medium-council` | An alternative to `plan-medium-council`, not a replacement: three proposers and a layered review panel of eight judges in three layers, all models from Chinese companies, no alternatives stage and no deep dive. It needs the zero-data-retention setting of your OpenRouter account switched off (Qwen 3.8 Flash and Qwen 3.8 Max have no zero-data-retention host). The criteria stage is answered through your Claude subscription and the skeleton, build, revise, handoff and decider stages by your Claude Code session. No round limit. This roster has not run. | OpenRouter key (zero data retention off) + a Claude subscription + a Claude Code session | $8.82 / $315.80 |
| `plan-china-high-council` | An alternative to `plan-high-council`, not a replacement: three proposers and a layered review panel of eight judge seats in three layers, eight models from Chinese companies, no alternatives stage and no deep dive. It needs the zero-data-retention setting of your OpenRouter account switched off (Qwen 3.8 Flash and Qwen 3.8 Max have no zero-data-retention host). The criteria stage is answered through your Claude subscription and the skeleton, build, revise, handoff and decider stages by your Claude Code session. No round limit. The upper estimate is not a spending ceiling. This roster has not run. | OpenRouter key (zero data retention off) + a Claude subscription + a Claude Code session | $14.88 / $464.22 |
| `local-ollama` | Every seat on your own machine, through Ollama. | Ollama and the models pulled | $0 / $0 |

The first figure is what the chain's own assumptions expect (the typical output of a review; every round up to the cap on a chain that has a round limit, and three top-layer reads on the shipped planning chains, which have none); the second is the most the planned calls could cost
if every one wrote its seat's whole output allowance (on the shipped planning chains seven top-layer reads, an assumption and not a limit, which a number you type with `--rounds` replaces; an Anthropic seat's one retry included; a judge's re-asks and the automatic retries after a network error are added at their expected cost; the cut-off retry of other seats and the extra passes a silent judge can cause are not priced, so the limit you type is the only bound). The second figure is the larger one by a wide margin because the reasoning models can spend that
allowance thinking (every shipped seat reasons at high, except the Qwen 3.8 27B seats, which run at xhigh because the model offers no high setting). `plan-high-council`, `plan-medium-council`, `plan-china-high-council`, `plan-the-high-council` and `plan-claude-council` expect to cost more than the default cap ($12), so type a limit of your own (`--max-usd N` puts N on the screen as the suggestion): at or above the upper estimate, so that only a call outside the plan, or a top-layer read beyond the assumed seven, can stop the run at its limit, or lower if you accept that a run that uses much of its allowance stops at the limit with no plan yet (it keeps what it paid for and
resumes with a higher total, which the screen asks for). A run that signs off early costs less than either figure. In the planning chains, the writer seats, and the seats answered through your Claude subscription, are [external](#quick-start-mcp): the run pauses
and a Claude Code session (or you) writes that stage, at no API cost. Nothing about any chain's
output quality has been measured.

Add it to Claude Code as an MCP server:

    claude mcp add council -- npx -y the-high-council council --mcp

It is also listed in the official MCP Registry as `io.github.muad-yasin/the-high-council`, and
there is a one-file Claude Desktop bundle ([Quick start (MCP)](#quick-start-mcp)).

Runs as an **MCP server** (so a coding-agent session such as Claude Code can drive it) or as a **CLI**. Bring your
own API keys. Nothing is resold, nothing is hosted for you, and your keys go only to the
providers you choose, never to us.

Run `npx the-high-council council doctor` to see which of your own keys are
set, which shipped chains you can already run with them, and what each would cost - before
spending anything. Where it falls short: [Known limits](KNOWN-LIMITS.md#known-limits-stated-plainly).

## Your first ten minutes

New to API keys, or to this? This path costs nothing until step 4, and step 4 tells you the price
before anything is spent.

1. **Watch one.** `npx the-high-council demo` walks an example request through every stage with
   scripted replies. No key, no network, $0.
2. **Make it yours.** `npx the-high-council init` writes `tasks/my-first-task.md` (edit it into
   your own idea, in plain words) and `chains/my-first-chain.json`, and runs a $0 mock pass so
   you can look inside a real run folder.
3. **Find the least setup.** `npx the-high-council doctor` lists what your keys can run. Its
   "Start here" block names the chains that need **one key and your session**. The default chain, `plan-mini-council`, uses two keys: an `ANTHROPIC_API_KEY` for its Claude seats and an `OPENROUTER_API_KEY`
   (one account at [openrouter.ai](https://openrouter.ai) that reaches many labs' models) for the other seats of a panel of eight judges from six companies, with your agent session answering the writer stages. With only the `OPENROUTER_API_KEY` set the chain still runs: its Claude seats then go through OpenRouter. Put the keys in a file called `.env` in the folder you run from,
   as `ANTHROPIC_API_KEY=...` and `OPENROUTER_API_KEY=...`, and add `.env` to your `.gitignore` so it is never committed.
4. **Price it, then run it.** Add `--dry-run` to see the expected cost and the upper estimate for your task,
   then run it without:

       npx the-high-council --task tasks/my-first-task.md --chain plan-mini-council --dry-run
       npx the-high-council --task tasks/my-first-task.md --chain plan-mini-council --max-usd 12

   `plan-mini-council` expects $9.52, with an upper estimate of $530.17. The expected figure is under the default cap and the upper estimate is not,
   so the run command carries `--max-usd 12`: the screen that asks for your limit suggests $12, and you type the number you accept (12 is also Claude Desktop's setting; the upper estimate counts a judge's re-asks and the network retries only at their expected cost and leaves out some other calls, so only the limit is a bound). Every paid run stops before a call that, by THC's estimate, would pass the limit you typed; estimates can be low, so a run can end above it. A run stopped at its limit keeps what it paid for but has no plan yet; a limit below the upper estimate can stop a run that uses a lot of its allowance (resume it: the screen asks for a new, higher total). This chain has no round limit, so both figures rest on an assumption: the expected figure counts three top-layer reads at a typical climb, and the upper estimate seven with every revision the ladder allows below each (a number you type with `--rounds` replaces it); a run that agrees at its first read costs less than the expected figure. A swing between judge layers also pauses the run (exit 3) and leaves a file for the Claude Code session, or you, to answer.

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
- **Spending limit** - the most one run may cost: the limit you type before a paid run starts. It is checked before every paid call.
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
   a slip, and is not a signature. `report.json` also carries a small `thin_contract` (0.8.2): full-width
   hashes of the task, the criteria, the evidence the run recorded as shown to the seats (the `--context` documents and the tool
   results; never a repository, seats do not see one, and not material handed in with `--draft` or `--from-run`) and the
   text the panel signed, plus one hash over the record. `council contract check runs/<id>` ($0) recomputes what the run folder still holds and says
   `sealed`, `DRIFT` (what changed) or `cannot check` (never a pass for what it could not read). Like the
   lock, it is tamper-evident, not tamper-proof: whoever can edit `report.json` can edit the record too.
   `HANDOFF.md` also carries two short sections the harness writes (no model does): "Before you build" (read the
   plan and write down blockers before coding; the criteria are not to be edited; the record's hash in plain
   text, which `council contract check runs/<id> --handoff HANDOFF.md` compares with the run) and "Replan
   triggers" (stop and send the plan back when the contract check or check-lock reports a difference, when a
   named check fails twice in a row, and so on). The "twice" is `handoff_contract.check_failures` in a chain,
   default 2. A chain can also set `handoff_contract.milestones` (off by default; on in every shipped `plan-*` chain, where the handoff seat is asked for the milestone shape):
   the harness then lints the milestones the handoff seat wrote ($0: every criterion discharged by a milestone
   that has a named check and an expected result) and records what it found in `report.json`
   (`handoff_milestones`), `WARNINGS.md` and the "Before you build" section; a finding never changes `passed`.

The delivered plan's own body gets two more $0 checks (0.8.4): one flags a statement about the project that carries none of the four markers (CHECKED, UNVERIFIED, DISPUTED, ABSENT), the other lists the names a fenced test file of the task uses that the plan never mentions. Each finding is one line in `WARNINGS.md` and an entry in `report.json` `plan_checks` (`docs/report-format.md`); a finding never changes `passed`.

Some chains add optional stages to this: whole alternative architectures written blind before
the skeleton, a deep-dive check of the first draft, a dispute stage that records unresolved
objections at the top of the plan, and a final security review.

Every run writes a folder: the deliverable, `BOARD.md` (the full debate - every post, every
withdrawal), `HANDOFF.md`, a per-lab scoreboard, and the real token/cost accounting.
A run that was stopped and resumed also keeps one small record per earlier stop in its folder, `stop-0001.json`, `stop-0002.json`, ... (the stop and the stop markers as they were; `read_run_file` reads them).
deliverable.md can start with a summary block the handling session added after the run (report.json `delivered_text.summary_block` gives its length as `chars` and its hash as `sha256`); it is not part of the plan, and a reader that wants the plan takes the first `chars` characters off only when their hash is that `sha256`.

A run that stopped before it wrote its handoff (the spend cap, an abandoned pause, a crash) can get one from its latest draft: `council handoff --from-run runs/<id>`. It goes to the chain's handoff seat, with the same policy check and key scan as a run. Where that seat is your own session, as on the shipped planning chains, the command writes a prompt file, and the `HANDOFF.md` you save from it gets no note and no lock block from the harness. Where the seat is a model THC calls, the command makes one call, under the spending limit you type (what the folder already cost counts toward it; `--max-usd N` is the total the screen suggests, as on `--resume`), and a run no panel signed off gets a note at the top, written by the harness, saying so. It never overwrites an existing `HANDOFF.md`.

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

`totals.input` counts the prompt tokens that were not read from a provider's prompt cache (a direct Anthropic call also leaves out the tokens it wrote to the cache, and so does a Claude call that THC sent through OpenRouter with a cache marker, and so does a call whose `cacheCounts` is `write-in-input`); `totals.cacheRead` and `totals.cacheWrite` hold the read and the written counts and appear when a call that used a cache carried the count, a zero included; `totals.cacheNotReported` lists the counts a call that used a cache left out. `totals.total` is input plus output and leaves the cache counts out.

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
which experimental. A run whose stall was passed up a layer, or whose layer 2 used its revisions in an overseer round and still objected (`trigger` is `layer2_bound`: the plan goes up to layer 3 instead of stopping), has `escalations`: each escalation's rounds and layers, every judge's ruling, and what became of each objection, with the ids it continues under when judges took it over as their own. An objection that the exchange of its layer left not debated is not ruled on: it is listed under `not_debated`, and `next` says what became of it (`debated_after_send_back`, `withdrawn`, `standing_dissent` or `pending`). `report-partial.json` carries `escalations` too, and a passed-over layer's `layers` row reads `escalated`. With the majority guard on, a withdrawal that does not quote the argument it
concedes to carries `unargued: true` in `debate.replies[]` and its proposal stays for the builder.

`signoff[].lab` is the seat's lab; `signoff[].provider` holds the same value under an older,
misleading name and is deprecated (kept until the report format's version 2).
`signoff[].objections` lists the seat's objections, on the seat's own record. Where `signedOff` is false, the list gives the reasons for that result. `signedOff: null` means
the seat gave no usable reply and abstained - neither a pass nor an objection, and `objections` is
`null` rather than empty so the two stay apart. A seat that signed off has an empty list or, since 0.8.4, one whose objections are all rated below 4, by the seat itself or by a later lowering: `signedOff` is the harness's reading of the ratings in force, so a seat whose own reply said no reads `true` once its objections are all rated below 4.
A row with `cut: true` in `signoff[]` or `panelVerdicts[]` is the reply of a seat that had answered, in the layer being asked, when the person's finish ended the run at a pause for a credential-shaped string or at the spending limit (on a layered chain the run's `stop.kind` is then `secret_pause` or `budget_stop`; an unlayered chain writes no `stop` for a spending finish). It counts for no sign-off and no read, and a reader that counts sign-offs skips it. Its objections count as open, and `signed_text.open_objections` counts them, except one its raiser withdrew in a completed round of the exchange the finish cut: that one is closed, and neither counted nor listed. Of the others, one the seat already held open before the finish keeps the row it had; any other (raised in the cut reply, or named in a completed round of its exchange) is marked `cut_off`, and `dispute.open_objections` lists it with `cut_off: true` where the report carries a dispute record, which is where `council accept` reads it (a run of a unanimous chain whose dispute stage is off has no such record: it counts the objection and does not list it there). No judge and no writer is asked about a `cut_off` objection after the finish.
A stated pass that holds an objection of its own has `signedOff: null` and `objections: null`, so its row carries `holds_layer`: the seat's own open objections that keep its layer from signing off (the ones carried from an earlier pass and any it named in an exchange post). A seat that signed off in its blind review and then named a defect in an exchange post is `signed_off` with `defect_named: true` in `panelVerdicts` (its blind sign-off is kept there) and `signedOff: false` in `signoff[]`, with the defect in `objections`.
The same objections also appear flattened in `lastCritique.failures[]`, tagged with `lab`, because
the reviser wants the union across the whole panel. Both are built in one pass; they cannot drift.
An objection's `id` is `O-` and eight hex digits, the same for the same seat, criterion and quoted passage in every round. Since 0.8.4 it may end in a suffix: `#2`, `#3` for a new objection of the same seat whose key repeats (`same_key: true`), `#r2`, `#r3` for one that reopens an objection of the same seat that was withdrawn, overruled, adopted by an upper layer or put below 4 by a re-tag (`reopens` names the old id; the exception is an objection the handler or the top layer lowered below 4, which keeps its own id). Treat an id as one whole string: `O-1a2b3c4d`, `O-1a2b3c4d#2` and `O-1a2b3c4d#r2` are three different objections, so cutting the suffix off merges them, and a check of an id's shape must accept `^O-[0-9a-f]{8}(#r?[0-9]+)?$`.

A layered chain's exchange is in `layer_debates`, one row per objection. A row's `raised_in` is the label of the call whose reply raised it, a `stages[].label` (the reply is in `<label>.md`), so you can find that reply and see who answered it. A defect a judge names in a post must name a criterion and, where the judges are asked to rate, carry a valid rating: one without is not an objection. It is listed in the exchange entry's `proposed` (one entry per post and round, with the reason `no_criterion` or `no_valid_rating`), no id is minted, nothing holds on it, nobody is asked again, and the rest of the post counts. The `severity` section's `asked` says whether the judges were asked to rate; while it is false every objection reads unrated, band `unreadable`, and that is not a broken reply.

On a chain with the Decisions rule on, when the top layer objects to a decision rather than to wording, it says so, names the numbered entry of the plan's Decisions section and quotes that entry's Choice line; the harness checks the quote against the plan's own text. On a chain with proposer seats that one decision then goes back to the proposers before the writer revises (at most three calls per proposer; a reply that cannot be read is not asked again), and `proposer_returns` in `report.json` records what came back. A chain with no proposer seat sends the objection to the writer with the entry in full. A mark the check refuses goes to the writer as an ordinary objection.

**Before you publish a run,** note that `report.json` records `task` as the path to your task file
(relative to where you started the run, never absolute). Nothing transmits it anywhere - but if you are rendering a board onto a public
page, drop that field. The debate itself is the part worth showing.

## Requirements

- Node 24+
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
with no override. There is no `xai` provider. Kimi K3.1 Pro is a judge in `plan-the-high-council` and `plan-high-council` and a proposer and a judge in
`plan-china-high-council`, and you may seat any Kimi/Moonshot model in a chain of your own.

The CLI refuses to start if any seat in the chosen chain is missing its key, rather than failing
halfway through a paid run. `ollama` (below) is the one exception - it needs no key at all.

A keyed seat sends its key only to its own provider's https API. A chain that points a keyed
seat's `baseUrl` anywhere else is refused before any call (see
[Local models](#local-models-ollama-lm-studio-)).

Other settings, all optional, read from the environment or `.env` (except `COUNCIL_WORKDIR`, `COUNCIL_PERSONAS_FILE`, `COUNCIL_PII_GATE`, `COUNCIL_SPEND_CAPS`, `COUNCIL_CLAUDE_ROUTE`, `COUNCIL_ZERO_RETENTION` and
`COUNCIL_ALLOW_LOOPBACK_KEY_HOST`, which only the real environment sets: a project's `.env` is
something the session can write, so the CLI prints a notice and ignores them there):

| Variable | What it does |
|---|---|
| `MAX_USD_PER_RUN` | The figure the spending-limit screen suggests for a paid run; `--max-usd` overrides it for one run. A plain command-line run with neither set suggests nothing. When a client sends no `max_usd`, the MCP server suggests `MAX_USD_PER_RUN`, or the lesser of it and `COUNCIL_MAX_USD_LIMIT` when that is set (7 for an unset `MAX_USD_PER_RUN`), and nothing when neither is set. It is not the limit. A chain with no paid seat has no screen: there it is the run's cap, the default cap when unset. |
| `COUNCIL_WORKDIR` | MCP server only: the folder for `tasks/` and `runs/`, when the client starts the server somewhere else. |
| `COUNCIL_MAX_USD_LIMIT` | A ceiling on the dollars a person or a client may set. The MCP server's `max_usd` cannot raise or remove it; the CLI's typed limit for a paid run, and the total typed for a paid tree (`council tree start --max-usd`, `council tree decide --amend-cap`), cannot go above it. |
| `COUNCIL_ALLOW_LOOPBACK_KEY_HOST` | `1` lets a keyed seat use a loopback `baseUrl` (a local proxy in front of the provider). Nothing else. |
| `OLLAMA_API_KEY` | Sent to an `ollama` seat's server only if you set it. |
| `COUNCIL_PII_GATE` | What a run does when its task holds an email address, an IBAN or a card number: `hard-stop` (the default) stops the run, `warn` prints a warning and carries on. Any other value refuses the run (exit 2, a dry run too). A typed `--pii-gate` wins for that run. A project's `.env` cannot set it. In the Claude Desktop settings it is the field "When a task holds personal data". |
| `COUNCIL_ZERO_RETENTION` | `on` or `off`. With `on`, every call through OpenRouter names only the hosts that OpenRouter's own list gives for its model as zero-retention hosts, and a seat that no such host serves is named and the start is refused before anything is sent (exit 5; a dry run reports it and goes on). Seats called straight to their lab are not covered by it. `--zero-retention on|off` on a command, the `zero_retention` argument of the MCP tools and the `zeroRetention` option of the library choose it for one run; a tree takes the environment only, and a tree that began with it on keeps it for every run it starts later (the variable in the shell of a `tree resume` wins when it says `on` or `off`). A typed value beats the variable, and the variable beats what a run began with; with neither, a run that began with it on keeps it. Any other value refuses the start (exit 2, nothing sent). A project's `.env` never sets it. When the list of hosts this version shipped with is more than 45 days old, a start with the setting on is refused until `council refresh-zdr-list` has fetched OpenRouter's list again (a public request, nothing of the project is sent) and written `zdr-hosts.user.json` in the folder; that file is read as narrowed to what this version shipped with, so it never adds a host, and a failed refresh writes nothing. |
| `COUNCIL_CLAUDE_ROUTE` | Where a chain's Claude seats are called: `auto` (the default: straight to Anthropic, or through OpenRouter when only an OpenRouter key is set), `anthropic`, `openrouter` or `session`. `--claude-route` on a command, the `claude_route` argument of the MCP tools and the `claudeRoute` option of the library choose it for one run. `session` hands every Claude seat to a Claude Code session of your own, one session for each seat: the run pauses at each such seat (exit 3) until its session has answered, those seats cost no API money, and a chain whose other seats still bill names them and still asks for the limit. Only you choose it (`auto` never does) and it needs no key. Nothing checks that the sessions were separate: one session answering several seats gives up the independence those seats are for, and a seat's effort is the effort its session runs at. Any other value refuses the start (exit 2, nothing sent). A run keeps the route it began with: a resume whose keys would choose the other route stops before anything is sent and names both ways out; a run that began as a session run stays one unless you type another route on that command or in that MCP call: a shell variable or a key does not move it. |
| `COUNCIL_PERSONAS_FILE` | Your own persona set for debate seats ([PERSONAS.md](PERSONAS.md)). |
| `AUDIT_HMAC_KEY` / `AUDIT_HMAC_KEY_FILE` | Signs the opt-in audit log (see [Privacy](README.md#privacy)). |

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

### Standalone binaries

The 0.8.3 [GitHub release](https://github.com/muad-yasin/the-high-council-mcp/releases) carries a single-file
`council` that needs no Node install to run: a Linux binary, a Linux AppImage and a Windows `.exe`, with a file of
their SHA-256 sums. The 0.8.4 release does not carry them. From a clone you can build them yourself, all on Linux:

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
council --task tasks/your-idea.md --chain plan-mini-council --dry-run

# a real run
council --task tasks/your-idea.md --chain plan-mini-council --max-usd 10
```

Your requests and everything the council writes about them stay on your machine, in `tasks/` and
`runs/` under the directory you ran from. In a clone of this repo both are gitignored, so a fork
will not accidentally publish them.

Without `--chain`, `council --task x.md` uses the default chain, `plan-mini-council`, and says so; a paid run's limit is a number you type, as for any chain.
`plan-mini-council` needs an OpenRouter key and an agent session, and uses an Anthropic key for its Claude seats (without one they go through OpenRouter); `council doctor` lists every chain that runs on the keys you have.
`--chain` takes a chain's name (`plan-mini-council`), never a file path: a `chains/<name>.json` of your
own in the working directory is found by its name.

**If your task already contains its own acceptance list.** A task written like a specification often ends with what the answer must contain and when it fails. The criteria seat can mirror that
list: criteria about the format of the answer, not about what makes it right. The criteria stage has two checks that catch some of these (criteria about the criteria list or its JSON shape, or criteria that demand several documents: it asks once more, and stops the run before any paid review
round if the second try does the same), after one to three paid criteria calls (the two checks run one after the other); a mirrored list that avoids those patterns passes them silently. Write the criteria yourself and hand them in instead: `council --task tasks/x.md --chain plan-mini-council --criteria criteria.md`. The file holds one
criterion per line (a leading `- `, `* ` or `1. ` is dropped, lines starting with `#` are skipped), or JSON (an array, or `{ "criteria": [...] }`). A hand-written list skips the criteria stage and
gets the same two checks before any paid review: criteria about the criteria list itself, or ones that demand documents one build stage cannot produce, stop the run. `council lint-criteria --criteria criteria.md`
runs the $0 word-level lints on the file first.

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
| 0 | Finished and the panel agreed: a deliverable and `report.json` (`passed: true`) were written. A step or the root of a recursive-councils tree also exits 0 when its panel did not agree: read the outcome from its own record. |
| 1 | The chain failed lint, an input is missing (no task file, a resume from the wrong directory), or a recursive-councils tree's record cannot be read. |
| 2 | Usage error: a flag is missing its value or has an invalid one, `--chain` is not a chain name, a `--context` file is not a regular file or is over 2 MB, or `--rematch`/`--replay` of a run given `--criteria`, or `COUNCIL_PII_GATE` is set to something other than `warn` or `hard-stop` (a dry run refuses it too), or `--claude-route` or `COUNCIL_CLAUDE_ROUTE` holds something other than `auto`, `anthropic`, `openrouter` or `session` (a dry run refuses it too), or `--zero-retention` or `COUNCIL_ZERO_RETENTION` holds something other than `on` or `off` (a dry run refuses it too), or a resume, rematch, replay or handoff would send the Claude seats the other way from the run's own route (a dry run of it stops the same way, and is never stopped by a key). |
| 3 | Paused at an external seat, or for a repair of a seat's reply (0.8.4): answer `NEEDS-<stage>.md`, then `--resume`. |
| 4 | Stopped at the run's spending limit before the next call was paid for; `council --resume <run folder>` asks for a new, higher total (a chain with no paid seat takes `--max-usd`). On a layered chain with unanimous sign-off stopped inside the review rounds, `--resume <run folder> --finish` records your choice to end the run at that stage after the final read (exit 4, nothing run or spent); raise the limit as before and the run ends, NOT agreed; a raise that does not cover the final read stops the run again, still not ended. |
| 5 | A provider key the chain needs is missing or has a line break or another control character in it, or the zero-retention setting is on and a seat of the chain has no host it may use (degradable: set the key and run again, or switch the zero-retention setting off). |
| 6 | Fatal: the chain file cannot be parsed, or the audit key cannot be loaded. |
| 7 | Finished, but the final security review blocked the deliverable. |
| 8 | Finished, but the final security review could not judge it (never a pass). |
| 9 | Artifact gate: the task names files whose content it never includes (`BLOCKED-ARTIFACTS.md`). |
| 10 | Preflight: a seat objected to the task description itself (`STOPPED-preflight.md`). |
| 11 | Something in the input must not be sent unless you allow it: a prompt matches one of the key formats listed in `src/secret-patterns.js` (checked by default; before the run starts it refuses it, and `--allow-secret-shaped` allows the values in the input; mid-run it pauses the run, `STOPPED-secret.md`, and `--resume <run folder> --continue` at a terminal (or the person's own word relayed by the handling session through `stop_decide`) sends that stage and allows the value, and `--finish` there records that the run is to end, not agreed, on the next `--continue`; a report's `stop.kind` is then `secret_pause`; a pause at a key-shaped line of an excerpt is named `excerpt-E-<n>` and takes `--continue` or `--drop-excerpt`, which leaves the text out), or the input holds an email address, an IBAN or a card number (the run stops before anything is sent or spent and names the flag that continues it, `--allow-pii <types>`). |
| 12 | `policy.json` refused the chain. |
| 13 | Another process is already running this run folder. |
| 14 | The task file, or (since 0.8.0) a `--context` document, changed since the run started and `AMENDMENTS.md` does not cover it. The message prints the hashes to write; a context hash is written `ctx-<hash>`. |
| 15 | `--resume` of a run that already finished (it has a `report.json`); nothing is run or spent. |
| 16 | The run stopped at an unexpected error (a seat that could not be reached, a crash); `STOPPED-error.md` says what, and `--resume` continues from the completed stages. |
| 17 | A draft (build, revise, dispute, final edit or handoff) was cut off at its token cap, and its one larger-cap retry was cut off too; the fragment is never graded or shipped (`STOPPED-truncated.md`). |
| 19 | A recursive-councils tree refused the start or resume of one of its runs: the run is not a step its record (`runs/<root id>/tree/events.jsonl`) allows, the record cannot be read, or the tree was abandoned by a person (`council tree decide <root id> --abandon`). Nothing was run and nothing was spent (0.8.3). |
| 20 | `council tree resume` stopped because a person can act and nothing is broken; the end text says what to do (0.8.3). |
| 21 | A paid run, or a paid rematch, replay, handoff, contract draft or digest, is waiting for a spending limit that a person types: nothing was started and nothing more was spent. Record the limit with `council gate answer <folder> <gate>`, then continue a run with `council --resume <run folder>` or run the same side command again (0.8.3). A run that waits for a raised limit after a spending stop inside the review rounds can still be given `--resume <run folder> --finish` (exit 4, recorded, nothing run or spent): after your raise the run ends at that stage, NOT agreed, once the final read has run; a raise that does not cover that read stops the run again, still not ended. |
| 22 | Finished, but the panel did NOT agree: the deliverable and `report.json` were written, and `report.json` says `passed: false` (open objections, no quorate panel, a reviewer never heard, a round cap reached, or the end you chose with `--finish`). Read the open objections before you use the deliverable. A step or the root of a recursive-councils tree keeps 0: the tree's record carries the outcome (0.8.3). |
| 23 | A run stopped and waits for you: it is resumable and has no `report.json` yet. Two cases. (1) A layered run stopped at its overseer-round limit, at layer 1's revision limit (at layer 2's the plan goes up to layer 3 instead, while a pass is left), because a seat of a layer stayed silent for too many passes in a row, (0.8.4) because no seat of the top layer could read the final plan, or because an objection stood unchanged and could not be passed up (the top layer holds it; no pass is left; the chain keeps no answer-back list or does not ask its judges to rate; or the next pass is a ladder pass, which does not pass a plan up); it is NOT agreed. It waits for your choice: `council --resume <run folder> --continue` (it extends the limit that was reached, counts the stalled objections afresh, or has the top layer read the final plan once more when none of its seats could read it; the run's spending limit still applies) or `council --resume <run folder> --finish` (the dispute stage and the handoff run; the result stays "not agreed", and the end text says that the top layer did not sign off on this plan, except at a stop reached after the handling session answered `not_yet` at its build check, where the top layer had signed off). The end text says why (0.8.3). At the stop where no seat of the top layer could read the final plan, `--finish` has the top layer read it once more first and ends the run only if a seat read it; with no handling session the run is paused and names nobody to choose. At a stall with no pass left there is no `--continue`. From seven used overseer rounds the stop is the hard stop (0.8.4): only you decide there, and `--continue`, `--finish` and revising the draft yourself outside the Council are all offered. (2) Since 0.8.4, a run that was PAUSED on request (`council pause <run folder>`, by you, or by the handler session on your word or for a reason of its own): it stopped between two passes, before the next pass was started, written or paid for; it is resumable by a plain `council --resume <run folder>` with no `--continue` or `--finish`, and `run_status` says `owner_paused`. |
| 24 | A run stopped because OpenRouter refused a seat at its price limit: no host serves the model at or under the price in the price table (or the refusal is one this program does not recognise). It is resumable and there is no `report.json` yet. `run_status` answers `status: awaiting_choice` with the state "stopped, waiting for the person's choice". The stop message names the model, the price limit and what OpenRouter said, and recommends what to do: add the model's current price to `pricing.user.json` and run `council --resume <run folder>`, or, where the stage can do without the seat, `council --resume <run folder> --skip-seat`. This run records the refused call as $0: that is the harness's own record, and what OpenRouter bills for such a refusal is not documented (0.8.3). At a terminal, a plain run first looks up the cheapest OpenRouter host that can serve the seat and asks whether to raise the price in `pricing.user.json` and continue the run in the same step (0.8.3); with no terminal, for a tree member, for a seat whose limit comes from the chain itself and for a refusal this program does not recognise it only stops, as above. For such a seat (its own `provider.max_price`) change the numbers in your chain: the finished stages are kept; a plain run stops once at the spending-limit screen because the chain file changed, and a tree member waits for `council tree decide <root> --accept-chain-limits <chain>`, which shows the old and the new limits and asks you to confirm (0.8.3). A tree member's seat is never skipped (`--skip-seat` is not available for a member). If a member stops at a price refusal and the provider's answer names the price, raise the model's price in `pricing.user.json` (or let the controlling session do it through the price step of `tree_decide`) and resume with `council tree resume <root>`. |
| 25 | A layered run stopped because the conflict decider asked for you to choose between objections (an objection from a judge of one layer came back after the writer revised the plan in response to an objection from another layer): it is resumable, NOT agreed, and there is no `report.json` yet. Nothing was revised and nothing more was spent. Choose with `council --resume <run folder> --prevail 1=<objection id>` (or `neither`: all the objections stand); resuming without a choice only says this again. `run_status` answers `status: awaiting_choice` with the state "stopped, waiting for the person's choice". Over MCP there is no verb for the choice. A tree member stops the same way and waits; you answer through its tree, `council tree decide <tree id> --prevail-node <node> --prevail 1=<objection id>` (or `neither`: all the objections stand), and `council tree resume <tree id>` applies it. |
| 26 | A run is stopped at an approval of excerpts of your project (0.8.4): the privacy switch is on (`--approve-excerpts`, or the chain's `approve_excerpts: true`) and an approval of excerpts was asked. A `--resume` of a run in that state exits 26, does nothing and spends nothing, while the approval waits for your answers (`council gate answer <run> <gate>` at a terminal). Once it is answered, the next `--resume` records your answers and goes on; an approval that ran out of time is asked again. |
| 27 | `council --resume <run folder> --next-pass-layer-3` recorded a request to start the next pass at layer 3 and stopped: nothing was run and nothing was spent. The run waits for the handler session's decision (`council route-decide <run folder> <request number> --route --reason "<why>"`, or `--decline`); the resume that follows starts the pass at layer 3. The bare flag is the person's own request and is recorded only at a terminal (stdin and stdout); a handler session relays the person's request with `--person-words "<the person's answer>"`. (0.8.4) |

Codes 9-17 were split out or added on 2026-09-23. Before that, several of these outcomes shared a code (2, 5,
6 or 1). Codes 19 to 25 are new in 0.8.3. Codes 26 and 27 are new in 0.8.4. Code 18 is retired: it was the exit of an advice call stopped before it finished; the advice add-on is removed (0.8.4), and nothing in THC starts such a call.

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

### Your host preference (`provider-preference.json`, 0.8.4)

Optional. To have OpenRouter try the hosts you name first for a model that runs there, put a `provider-preference.json` in your project folder next to `pricing.user.json` and list those hosts by their endpoint tags exactly as OpenRouter writes them (`azure/us`, `wafer/mxfp4`). A base endpoint is named by its bare tag, such as `azure`. A bare tag also matches that provider's regional and variant endpoints, such as `azure/us`, unless a chain ignores them with `extra.provider.ignore` (which takes full tags too); it does not match a service-tier endpoint such as `openai/flex`. For example:

```json
{ "openrouter/z-ai/glm-5.3-flash": { "prefer": ["wafer/nvfp4", "novita/fp8"] } }
```

THC sends the list as `provider.order` and leaves fallbacks on, so another host can still serve a call that none of yours can; a seat's own `extra.provider.order` wins, and a host a chain bans with `extra.provider.ignore` is never preferred (Open Inference is banned on every call, so an endpoint under it is never preferred either). The file never changes a price or the price limit, and the spend cap counts the same figures with or without it. A file that cannot be read in full is not used at all, and the command that sends the call says why it was not used. Changing the file changes the screen that asks for your limit. `node scripts/refresh-openrouter-prices.mjs ... --for-chain <chain.json> --propose all` (from a clone, after a `--fetch`) writes a proposed preference file next to the fetched answers: the eligible hosts at or below the median of the base prices, cheapest first, leaving out any whose context or output limit cannot serve the chain; copy it and edit it.

### The spend cap

Every paid run has a spending limit in USD that you type before it starts (a tree member runs under its grant from the tree's cap you typed), and it is checked *before* each paid
stage - a call that, by THC's estimate, would take the run past the ceiling is not sent. The estimate can be low (a re-ask or a retry is checked at the expected cost of the call it repeats), so a run can end above the ceiling; what it spent is counted and reported. `--max-usd` and `MAX_USD_PER_RUN` only set the figure the screen suggests (a plain command-line run with neither set suggests nothing); the default cap, $12, is the figure the dry run compares a chain with, and the cap of a chain with no paid seat. Every call to an OpenRouter seat also carries a price limit (`provider.max_price`) at the seat's price in the price table (`src/pricing.json`, or your own row in `pricing.user.json`, which can only raise it), so the figure the cap projects with is the most such a call can be billed per token at that price (a ceiling, not the bill: a host may be cheaper); a `prompt` or `completion` price a seat sets itself (a number above 0) is kept as typed and a missing one is filled from the table, and an `extra.provider` or `max_price` that is not an object is refused before the run starts. Every call to an OpenRouter seat also carries `provider.ignore` with `open-inference`, which asks OpenRouter never to route the call to the Open Inference host: your own entries in `extra.provider.ignore` are kept and the host is added once, in a chain of your own too, with no switch to turn it off, and an `extra.provider.ignore` that is not a list of host names is refused before the run starts. A run's typed limit can also be raised at a resume that is not a stop: `council --resume <run folder> --raise-cap` (`--raise-cap <cap>` under the per-provider caps) opens a limit screen; the person types the new total at the terminal, and it must be above the limit the run has now (a raise at a budget stop can also be answered in an MCP client's dialog, as before). A raise goes alone (not with `--continue`, `--finish` or `--next-pass-layer-3`). The handler session can relay it on the person's permission (`--relayed`, then `council relay-answer <run folder> <gate> --total <dollars> --person-words "<the person's words>"`): the person's own words are required and the total must appear in them; the ledger records channel `session`, the actor `main-session` and the words, and the tool cannot verify that the person gave them. A raise the person approved that can never be used (not above what the run has counted, not above the limit it has, or above the ceiling now in force) is closed in the gate ledger by THC itself (`cap_raise_closed`, marked as THC's own determination); the run keeps its limit, the person is told once with the reason, and a new raise is typed with `--raise-cap`. `run_status` answers `awaiting_user_cap` only for a limit that is pending, or approved and still usable (not used, not closed, not expired): a closed raise is not awaited. `report.json` lists the raises the run used in `raises`. If OpenRouter refuses a call at the price limit, a run stops at exit 24 and asks you what to do, with a recommendation (nothing is skipped silently).

```bash
council --task tasks/x.md --chain plan-mini-council --max-usd 10    # suggests $10 on the screen where you type your limit
council --task tasks/x.md --chain mock-budget --max-usd none  # a chain with no paid seat: no ceiling (0 is refused: it used to mean this)
export MAX_USD_PER_RUN=20                         # the figure the screen suggests
```

A run that hits the ceiling stops cleanly and writes `STOPPED-budget.md` saying what it spent, which
stage it stopped at, and what that stage would have cost. Nothing is half-written: it produces no
`deliverable.md` and no `report.json`, so a stopped run never reads as a finished one. What it did
get through is in `report-partial.json` and `BOARD-partial.md`
([docs/report-format.md](docs/report-format.md)). Continue it: the screen asks for a new total above what the run counted (`--max-usd 10` suggests one), and completed
stages replay from disk and cost nothing the second time:

```bash
council --resume runs/<id> --max-usd 10
```

A resume after an update of THC keeps its saved replies where only THC's wording changed (0.8.4): a stage whose saved prompt differs is not asked again when the version or code that wrote it differs from the running one, its reply is unedited and nothing it depends on changed in this sitting; it is listed in `report.json` as `answered_under_earlier_wording`, and a new run (`--draft` with the plan as it stands) asks it again under the current wording. A run resumed on another route (the direct Anthropic key, OpenRouter or a Claude Code session) keeps the stages it saved as they were instead of asking them again; they are listed in `report.json` as `answered_on_another_route`, each with the route it was written on and the route of this sitting, and a stage whose prompt changed because something it depends on changed is asked again and is not listed. A stage whose prompt differs because something before it was asked again, rewritten in a later sitting or edited is asked again and paid, as before. The handler's answers to the planner's questions and a build-check answer are kept the same way; a stage whose reply was repaired after it was saved is not covered. A run paused on 0.8.3 or earlier has no record of the version that wrote its stages, so it is asked again where a prompt differs.

A stage replays only if it would be asked the same thing again: the task text, the chain config
and the stage's own prompt must all match what it answered (the two numbers of a seat's own
`provider.max_price`, its price limit, are not part of that: changing them keeps the stage; nor is the `open-inference` entry of `extra.provider.ignore`, which every OpenRouter call carries anyway). If one changed (you edited the chain,
or an earlier stage came out differently this time), the stage runs again and its old files move
into `superseded/` inside the run folder. What the old answer cost still counts toward the ceiling,
`--spend` and `report.json`'s `totals.usd` (shown separately as `totals.supersededUsd`), so a resume
cannot spend past the cap. A stage an earlier sitting paid for that the finishing sitting never asks again (the chain now gives its criteria itself, say) stays in the run folder. Since 0.8.4 it counts in `report.json`'s `totals.usd` (shown separately as `totals.unreplayedUsd`, with each such stage listed in `unreplayed[]`), in `council --spend` and in `run_status`; the cap of a resumed sitting does not count it yet. An answer you wrote for an external stage is never re-used against a
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

### When a seat's reply needs a repair (0.8.4)

A paid reply can be almost right and still unreadable: one missing bracket, and the reader gets
nothing it can use. Until 0.8.4 such a reply was asked again once and then counted as an
abstention, so a judge's objections could drop out of the record.

Now three kinds of reply pause the run instead (exit 3) and write `NEEDS-<stage>.md`:

- a reply that looks like JSON, was not cut off, closes its last brace, and still does not parse
  after every repair `parseJson` makes (in a panel's verdict, the exchange inside a judge layer,
  the final read, and a critic in a chain that stops at the first pass);
- a sign-off table with one row per criterion whose rows cannot be matched to the criteria, not
  even by position (in a panel's verdict);
- an exchange post, or an answer to one, that names an objection id one character away from
  exactly one id the judge was shown (in the exchange inside a judge layer).

The request carries the original reply. An answer may change only what a repair may change, and
the harness checks it before it reads it:

- an almost-JSON reply: the same reply with its JSON fixed, taken only if, with JSON punctuation
  and white space left out, it reads word for word like the original;
- a table: the criterion text of a row the request names (a row whose words did not fit the criterion at its
  position), set to the exact text of the criterion at that row's position. A verdict, evidence, a
  failure or a rating never changes, and a row the judge did not write is never added;
- an objection id: the id the request names, set to the id the judge was shown (the id one character
  away), if the post or answer clearly means that objection. A stance, a reason, a quote or an answer never
  changes.

Writing the original back unchanged declines the repair: the reply is then read as it would be
without one (an abstention, or the usual re-ask). A stage is repaired once. Answer a repair before
you change a ruling, a criterion or the draft: if the seat's prompt changes before the run
resumes, the repair is set aside and the seat is asked again, and paid again.

Over MCP, `external_prompt` shows such a stage with `repair` and its kind, and `repair_reply`
answers it (`text`, `restore_rows`, `ids` or `decline: true`); `submit_stage` refuses it, because its
record would replace the paid one. From a terminal, write the answer under a `.partial` name and
rename it, as above.

Afterwards a repaired stage is an ordinary stage. The paid call is counted once, under its real
provider, and nothing in `report.json`, `BOARD.md` or a later prompt mentions the repair. The
original reply stays in the run folder under `originals/`, with the request and a record of the
repair, for whoever looks after the run; while a repair is pending, `<stage>.repair.json` sits
beside the stage files. `--rematch` and `--replay` never pause for a repair: there such a reply is
handled as before.

### A ruling for the judges (`council ruling-add`, `council ruling-withdraw`; 0.8.4)

The person who owns the request can give the judges and the reviser a ruling in the middle of a run: a
sentence of their own that every judge and the reviser read from the next pass on. It is given from a
terminal; there is no MCP tool for it.

- `council ruling-add <run folder> --ruling "<the ruling, as it will be shown to the judges>" [--relayed]`
  asks for a ruling for the pass after the revise pause the run is waiting at. It writes the ruling
  text into the run folder (`ruling-<pass>-<hash>.md`) and requests an approval of kind `ruling` for it;
  the approval can wait a day. The run does not go on until it is answered or has expired. `--relayed`
  says the handler session is asking on the person's behalf. It writes nothing and refuses when the folder
  is not a run, the run is not at a revise pause or waits for an answer to a stage, the pass already has a
  stage on disk (a ruling would change what that stage was asked), or the ruling is empty or the same as
  one already given or waiting for that pass.
- The answer: the person runs `council gate answer <run folder> <gate>` at a terminal. When the handler
  session asked with `--relayed`, it relays the answer with `council relay-answer <run folder> <gate>
  --person-words "<the person's words>"`; for a ruling the words are accepted only if the ruling's text is in
  them (line breaks and spaces may differ). A session cannot decline a ruling that the person asked for.
- `council ruling-withdraw <run folder> <gate> [--relayed]` is the way out. For a ruling or a withdrawal that
  still waits: with `--relayed` the handler session declines the request it asked for itself, and the
  command prints how a person declines their own (`council gate answer <run folder> <gate> --decline`). For
  an approved ruling it asks, with a new approval of kind `ruling_withdrawal`, to take the ruling out of
  force from the next pass; the passes that already ran keep it. It refuses, writing nothing, when the gate
  is not a ruling, the run is not at a revise pause, or the pass has a stage on disk.
- The record: `report.json` lists the approved rulings in `owner_rulings` (the gate, the pass it applies
  from, the text as it was shown to the person, the channel, the actor and, when the handler relayed it, the
  person's words; a withdrawal is listed under the ruling as `withdrawn`) and the requests the handler
  declined in `declined_requests`. The gate ledger holds the same lines.

### Accepting a plan the panel did not agree on (`council accept`, step `accept` of `stop_decide`; 0.8.4)

A run that did not end agreed (the plan the panel did not sign, or a signed-off one whose final read objected) hands over a plan that the harness marks as not agreed: the banner says so and the handoff's Status cannot read `ready_for_build` or `partial`. Accepting is a separate, explicit act that approves building that plan as it stands. It agrees with no judge, changes no objection and marks nothing agreed.

- `council accept <run folder> --reason "<why, one line, at most 600 characters>"` is for a person at a terminal. It shows the question (the plan's hash and the open objections) and asks y/N; with no terminal it says the gate waits and exits 3. Run again after the gate is answered, it applies an approved acceptance. It refuses a run that has not ended, one that ended agreed, a node of a tree (a tree's plan is accepted with the tree's own commands) and a run with no HANDOFF.md; for one already accepted it says so and writes nothing (exit 0).
- The handling session uses `stop_decide`: step `quote` on a finished run returns the question; step `accept` sends the gate and the hash back with `reason`, `advisor`, `advisor_said` and `objections`, one `{ id, person_test }` for each open objection (the same person test as a stop's, run for each objection). The session may accept only when no stop of the run was the person's (an answer typed at the terminal, a scan hit, the spending limit or a raise of it, a conflict or a silent seat decided at the terminal, a stop answered with the person's own words relayed by the session, the hard stop after seven overseer rounds, the stop at the limit the person typed on a ladder run), the delivered text is the text the panel last reviewed (`delivered_text.same_as_signed`), and no objection is the person's by both parts of its test (one yes is recorded in `over_disagreement` and the session still accepts); otherwise the answer says that the person must be the one to accept, with `council accept` or by telling you: step `quote` still returns the question (with `requires_user` and a `note`, no `error`), and step `accept` with the person's own words as `person_words` (leave out `reason`, `advisor`, `advisor_said` and `objections`) records the acceptance as the person's (actor `person`, channel `session`, `relayed` true, the words beside the relay sentence). The same call on any channel but the session's is refused.
- The record is the gate ledger (kind `acceptance`). `report.json` gets `acceptance` (the gate, actor, channel, time, reason, the objections accepted as they stand, and for the session its advisor state and tests), `handoff_text.file_sha256` follows HANDOFF.md while `file_sha256_at_end` stays the file as the run wrote it, and `council contract check` reads the file as the run wrote it plus the acceptance and any notes.
- HANDOFF.md gets one line under its banner (`Accepted as it stands by ... on <date>: <reason> ...`, written by the harness) and the Status word the seat wrote, where the harness had replaced it. The open objections stay listed. The question and the record name every finding still open at the end: the open objections and the late findings the run still carries (ids starting `L-`, marked late, found where no round follows to debate them); the session's `objections` list holds one entry for each of them. On a unanimous chain whose dispute stage is off, an objection of the layer or panel the person's finish cut that still stands, and that the seat did not already hold open, is counted in `signed_text.open_objections` and is not named here.

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
runs, a per-run spend ceiling that Claude cannot raise or remove from a chat (default $12 in the bundle; on the command line your limit is the number you type), which is also the figure the bundle's limit dialog suggests, or a lower one Claude asks for, and one optional
field per provider key (marked sensitive, so the app keeps them in the OS keychain). The bundle is unsigned. How it is built:
[mcpb/README.md](mcpb/README.md).

**MCP Registry:** the server is listed in the official registry as
`io.github.muad-yasin/the-high-council` (npm package, stdio). A client that installs from the
registry runs the same `npx` command as above.

Registering with a client other than Claude Code (DeepSeek Harness, OpenHands, Cline, goose,
Continue): [docs/mcp-clients.md](docs/mcp-clients.md) has the real config for each.

Whichever way you add it, the server reads and writes in **your** working directory, not inside
the package: `.env` for keys, `tasks/` for requests, `runs/` for output, and a `chains/` of your
own takes precedence over the bundled ones. In a git project, add `.env` (and `runs/` if your
ideas are private) to `.gitignore` before the session commits everything; `council doctor` warns
when `.env` is not ignored.

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
| `list_chains` | Available chains with descriptions (price one with `dry_run`); a chain the chain lint refuses carries `refused` with the first reason and cannot be started |
| `write_task` | Write the request the harness plans against |
| `dry_run` | Price a run before spending anything (a layered chain with a round limit of its own also shows the most calls its rules allow; the shipped planning chains have no such limit and show none) |
| `start_run` | Start a run in the background (for a paid chain `max_usd` is the figure the limit dialog suggests and you type the limit, in the dialog or with `council gate answer` at a terminal; a chain with no paid seat takes it as its ceiling). `chain` is a chain name; `task`, `draft`, `context` and `from_run` must be inside the working directory |
| `run_status` | Stage reached, panel verdicts, scoreboard, cost, budget remaining; for a running run, `in_flight`: the paid calls sent and not yet settled (stage label, seat, since). A run stopped at an approval of excerpts of your project reads `awaiting_excerpt_approval`, with its gate and exit code 26 (0.8.4); once the person has answered (reason `excerpt_answers_to_apply`) or the approval has expired unanswered (reason `excerpt_gate_expired`), it still reads `awaiting_excerpt_approval` but is resumable with `needs: resume` (`resume_run` applies the answers, or asks again) |
| `spend_report` | What every run has cost across a window of days, plus `session_cost_today` (calendar-day, per-model breakdown), derived from disk. A run that paid OpenRouter also carries `providerReported` (the provider's reported figure beside THC's usd; unverified, in no total). The part of a figure that is an estimate (`estimatedUsd`, `totalEstimatedUsd`: a typical or expected cost, or a reservation counted at its worst case) is not in this tool's answer; `council --spend` prints it. |
| `verdict_stats` | How the debate mechanism itself is doing, per chain and per lab: sign-off rate, rounds, objections, dropouts, cost/wall time, largest prompt files - derived from disk |
| `metrics_report` | Descriptive telemetry only (never an evaluation or baseline): amendment rate, withdrawal rate, objection-follow-through rate, tool-call usage, consensus-induced-regression count - derived from disk. See [`docs/paid-comparison-run.md`](docs/paid-comparison-run.md) for what a *real* comparison against a single model would need - not built, not this metric |
| `external_prompt` | The prompt a paused external stage is waiting on - **read it with this, not by opening the file**; the prompts are routinely tens of thousands of tokens and most clients silently truncate a file read. `waiting` lists every stage the run waits on (a panel of external critics pauses together); pass `stage` for another one's prompt. A long prompt can be read in pages: `max_chars` (500 or more) and `part` (from 1); the answer then says `part`, `parts` and `total_chars` |
| `prepare_stage_prompt` | Write a self-contained bundle for a paused stage, so a driving session doing other work at the same time can dispatch it to a fresh subagent instead of authoring it inline - see [`docs/dispatch-pattern.md`](docs/dispatch-pattern.md). Pass `stage` to bundle another waiting stage than the first; it is written to `stage_prompt-<stage>.md`. A stage that waits for a repair is refused: answer it with `repair_reply` |
| `submit_stage` | Answer a paused stage; the run resumes once every stage it waits on has an answer. Optional `claimed_by` records who's answering; optional `answered_model` records which model the session says wrote the answer (its own statement, never checked); a second submission for an already-answered stage no longer errors - it's kept as `<stage>.late.md` with a warning instead of being rejected. Optional `session_reads` (the project files the session read for its answer) and `excerpt_answers` (its answers to the text requests the stage's prompt lists) are listed in the tool: the harness cuts the lines itself, scans them for keys and shows the text to every later seat; an answer that carries either field is refused as a whole, with nothing written, when the field is not in the form the tool lists or holds a key-shaped string |
| `repair_reply` | Answer a stage that waits for a repair of its seat's paid reply: `text` (the same words, JSON fixed), `restore_rows` (THC sets the criterion text of the rows the pause names to the criterion at their position), `ids` (THC sets an objection id a judge wrote one character off to the id it was shown) or `decline: true` (the original back); a stage is repaired once, and the original stays in the run folder |
| `resume_run` | Resume a paused run, or ask for a new, higher total on one its limit stopped (the person types it in the dialog). To use a total the person has already said, pass `max_usd` with `person_words`, their own words with the number in them: the record keeps the words and that you relayed them. On a run with a paid seat a figure without the person's words is refused, and a session never suggests one. A call with `person_words` answers `relayed`: `false` when nothing was recorded or used, else `{ gate, figure, state }` where `consumed` carries `old_usd` and `new_usd`, `closed` carries `code` and `reason` (the run goes on under its old limit and a new screen waits), and `recorded` means not used yet (`resume_run` without `max_usd` continues it). A run stopped at an approval of excerpts of your project is not resumed (nor does `submit_stage` resume it): the answer names the gate and what it waits for, with exit code 26 (0.8.4). To let the person raise the limit at a resume that is not a stop, pass `raise_limit: true` (not together with `max_usd` or `person_words`; refused for a run held to a cap per provider, whose caps are raised one at a time, when the run stops at one): the dialog asks them for the new total with nothing pre-filled, and the answer carries `raised`: `false` when nobody was asked, else `{ gate, state }` where `consumed` carries `old_usd` and `new_usd`, `closed` carries `code` and `reason`, `declined` and `pending` mean no total was given; a client without the dialog gets the same awaiting answer as at a stop |
| `read_run_file` | Read any file from a run folder (`report-partial.json` for a run the cap stopped) |
| `list_runs` | Past runs |
| `plan_outline` | Section tree of a run's deliverable (or a `.md` file in the working directory) with word counts |
| `contract_read` | Read the locked contract of a run: its version, the obligations a person approved and the amendment requests filed against it. Checked first ($0): if the record, its approval or the ledger disagree, nothing is returned. The text comes back marked as model-written |
| `contract_amend` | Ask for an obligation of a locked contract to be changed. Free; it only files a request, and a person decides it at a terminal with `council contract amend --decide`. See [The contract record](#the-contract-record-council-contract) |
| `tree_status` | Read-only view of a recursive-councils tree (pass its root run id): verdict and reasons, nodes, open stops, limits and money as two figures; it writes nothing |
| `tree_decide` | Answer a stop of a recursive-councils sub-plan as the controlling session: the answers (keep, milestone, sub-plan regenerate, price) take two calls (quote, then answer with a written reason), handing a stop to the person takes one; recorded as the session's, never a person's. The price step adds or raises one model's price, only the model a stopped member of this tree was refused for, and never lowers one; the session is told to show you the quoted text and pass your yes as the reason, and THC cannot check that it did. The frontier step approves the next split frontier once (the session is told to show you the quoted text and pass your yes as the reason; THC cannot check that it did), when every child gets its full ceiling and nothing is held back, unenforced or of unknown size; otherwise the person approves it with `council tree approve`. For a stuck root plan the session writes the new decision as a draft (the draft step, one call; nothing is decided or spent): `council tree decide` opens on the draft in full and you approve it by typing the stop id, or say what should change, and the session writes a new draft from your request (it reads it in `tree_status`). A root re-plan itself, a top-up and any other money, close and abandon stay a person's |
| `stop_decide` | Answer a plan run's stop at an overseer-round cap, at a layer's revision bound, at a layer's silent seat or where an objection stood unchanged and could not be passed up (a stall) as the handling session (0.8.4): call `quote` for the exact stop text and its hash (nothing is decided), then `answer` with the hash, `continue` or `finish`, a written `reason`, what your advisor said (`advisor`: `consulted`, `none` or `unavailable`; `advisor_said`) and `person_test` (your own verdict and your advisor's on whether this stop is the person's: `person`, `unsettled_by_record`, `preference`, `reason` each; THC records both and judges neither), or `defer` to hand the stop to the person: a defer is accepted only when both verdicts say the stop is the person's, and an answer is refused then. The record keeps both verdicts and marks a choice made over a disagreement (`over_disagreement`, computed by THC). The answer is recorded in the run's choice entry as the session's (actor `handling_session`, channel `session`). When the person has said what they want in their own words, relay it instead: `answer` with `continue`, `finish` or `finish_now` and `person_words` (their words exactly as typed; leave out `reason`, `advisor`, `advisor_said` and `person_test`); it is recorded as the person's (actor `person`, channel `session`, `relayed` true, the words beside it). A relayed `continue` may carry `rounds`, as a typed `--rounds N` does: on a ladder run the person's new total of top-layer reads (refused when it is not above the reads already made), elsewhere it changes nothing; `finish_now` ends the run at once, with no final read and no judge asked again: inside the review rounds the run ends not agreed, and at a spending stop or a credential-shaped pause after them it keeps the verdict the rounds reached, and so does a panel that had signed off at the stop where no seat of the top layer could read the final plan. Stops that are the person's are refused with whose they are: an approval of excerpts and a scan hit. A run paused at a credential-shaped string is quoted through the same stop only the person decides (its stop id is `secret_pause:` and the pause record's own id; the text names each finding by prompt part, line and name and never repeats a value), and the session relays the person's own choice with their words: `continue` (sends the stage and allows the value), `finish` (inside the rounds), `finish_now` or `drop` (an excerpt only); a pause with no whole record, or with a spending stop's files beside it, is refused and the terminal answers it. A run stopped at its spending limit (inside or after the review rounds) is quoted through the same stop only the person decides as the owner's pause, and the session relays the person's own `finish_now` with their words (a relayed `continue` is refused: going on is the person's own number, the relayed raise). A stop only the person decides (the hard stop after seven overseer rounds off the ladder, and on a ladder run the stop at the typed limit, at any number, and the owner's pause, which is continued by `resume_run` and ended with a relayed `finish` or `finish_now`) has a gate like any stop, but the gate refuses the session's own answer: only the relayed choice is taken there, and a `defer` is allowed with or without an advisor. At a stall with no pass left the quote offers `finish` only; a conflict between objections is answered at the terminal. the step `accept` answers the acceptance of a plan the panel did not agree on, described in its own section; the choice `reopen` is not built |
| `price_raise` | Give a run that a price refusal stopped (exit 24) a higher price, in two calls: `quote` looks up the cheapest OpenRouter host that can serve the seat and returns a text for the user and its hash (nothing is written); `confirm`, with that hash and a `reason` (the session is told to pass the user's own yes), writes the row into `pricing.user.json`. The tool description tells the session to show the user the text and get the yes in the chat first; THC cannot check that it did. It spends nothing: `resume_run` then stops at the spending-limit gate, which the person answers. Tree members, advice runs and seats whose limit the chain sets are refused |
| `pause_run` | Ask a RUNNING run to pause after the pass it is in: it finishes that pass and stops before the next one starts (`run_status` `owner_paused`; nothing is paid for the stop). `run`, plus `person_words` (the person's own answer as they typed it) or `reason` (the session's own), never both and one is required: a session is never the person at a terminal, so the bare, terminal form of `council pause` has no MCP form. Refuses a run nobody is running, a member of a tree and a request that is already open; nothing is recorded on a refusal. Going on is the person's call: `resume_run` with only the run id. So is ending the run there: `council --resume <run folder> --finish` or `--finish-now` at a terminal, or `stop_decide` (the pause is quoted as a stop only the person decides; `answer` with `finish` or `finish_now` and `person_words`; a `continue` is refused, because a pause is continued by resuming it). The request is then recorded as finished at the pause (`pause_finished`, with the choice; `report.json` `pauses[].finished`), a third case beside a pause that was resumed (`taken`) and a request that never paused the run (`lapsed`). |

**Text from a run comes back marked as model-written.** A deliverable, a board or a log line
was written by AI models, and a model can be fooled into writing instructions aimed
at the agent that reads it. So `read_run_file` (and `run_status` with `brief: true`) returns the text
between a notice written by the server and markers whose id changes on every call, with Unicode tag
characters, bidi controls and zero-width characters removed and counted; JSON answers that carry such text name those fields
in `untrusted_fields`. A sentence the server composed itself (a refusal that names a file or a value read from one) keeps its own words as they are: only the value sits between the same markers, and a short notice (`untrusted_fragment_notice` in a JSON answer, a second block in an error result) says so. Which tool returns what is one table in `src/mcp/untrusted.js`, and a tool
missing from it is refused when the server starts. This is a label, not a filter: it does not make
hostile text harmless, and the file on disk is unchanged.

**External vs. API-backed seats.** `{ "provider": "external" }` pauses a run at that seat so a
Claude Code session on a flat-rate subscription plays it - free at the point of use, since the
subagent runs on the same subscription. If you don't hold a flat-rate subscription and pay
metered rates for everything anyway, `{ "provider": "anthropic" }` (or another API provider) may
be simpler for those seats: no dispatch pattern to learn, at roughly 5x the metered cost of the
same debate on external, based on one measured comparison, not a guarantee. Not the default
anywhere in this repo's config, README ordering, or example chains - external stays recommended
for anyone with a subscription, since the project's cost story depends on it.

### The contract record (`council contract`)

After a run has ended, a person can lock a **contract** from it: a short list of obligations (an id and a sentence or two each) that a build session works against. A model drafts the list. Nothing
becomes the contract until a person has read the exact text and approved it at a terminal.

```
council contract lock runs/<id>                         # shows the exact text, asks, then writes runs/<id>/contract/v1.json and CONTRACT.md
council contract show runs/<id> [--md]                  # the current version, each obligation, the requests filed against it
council contract check runs/<id>                        # $0: do the record, its approval, the ledger and CONTRACT.md still agree?
council contract amend --decide runs/<id> [request]     # a person's decision on an amendment request
```

A version is never edited. A build session that finds an obligation wrong or impossible does not change it: it calls `contract_amend`, which is free, files a request and decides nothing. A person
decides the request at a terminal, with the exact current and the exact proposed words in front of them. An approval writes the next version, which names the one before it and the request;
a refusal is recorded. `contract_read` hands the build session the current version, after the same check `council contract check` makes; the obligation text comes back marked as model-written.

The record is **tamper-evident, not tamper-proof**. It lives in the run folder together with its approval and the ledger; whoever can write that folder can rewrite all three together, and nothing
here detects it. `council contract check` catches an edit of one of them without the others. A 0.8.1 `council gate verify` reads a ledger that holds contract events as broken; verify it with 0.8.2.

## Chains

26 chain configs live in `chains/`. Each one is plain JSON - the seat roster, which models fill
which seat, the round cap, and whether proposals/debate/handoff stages run. They are meant to be
copied and edited.

The recommended ones (`plan-mini-council`, `plan-medium-council`, `plan-high-council`) are in the table at the top. The seven planning chains (`plan-mini-council`, `plan-medium-council`, `plan-high-council`, `plan-china-medium-council`, `plan-china-high-council`, `plan-claude-council` and `plan-the-high-council`) also ask each judge, beside its verdict, for a capped number of proposals and improvement ideas (the chain key `reviewNotes`); the plan's writer answers them, and no judge gives a verdict on those answers. The chains the 0.8.2 and 0.8.3 cleanups moved out of `chains/` are in `chains/outdated/` in the repository (not in the npm package); copy one into your project's own `chains/` to run it by name. A run recorded on one of them needs its file there too before it can be resumed, rematched or replayed (the error says so). A few more worth knowing:

- **Retired in 0.8.3**: the chains `cheap-7-v2`, `plan-daily-7`, `plan-highest-7`, `plan-premium-7`, `plan-open-7`, `plan-lanes-4`, `plan-debate-roles-c1`, `coder-gate-v1`, `coder-gate-v2`, `security-review-only`, `eu-only`, `us-only`, `single-vendor-anthropic` and `single-vendor-openai` are in the repository under `chains/outdated/` (with the 21 chains 0.8.2 moved out of `chains/`), not in the npm package, and `--chain` does not look there. To use one, copy its file into your project's own `chains/` folder. The `lane` seat key still works (it is what `plan-lanes-4` shows: one writer and three reviewers, each told where to look first, every reviewer still checking every criterion); `chains/outdated/plan-lanes-4.json` is the worked example.
- **Retired in 0.8.4**: the chains `verify`, `plan-mini-council-sol-session`, `plan-default-opro-council` (the old quick-start chain) and `plan-china-mini-council` are in the repository under `chains/outdated/`, not in the npm package; `--chain` does not look there, and a run recorded on one of them needs its file copied into your project's own `chains/` folder before it can be resumed. The chain `daily7-sub-a`, the old child chain of a recursive-councils tree, is in the repository under `chains/outdated/`, not in the npm package, and `--chain` and `--child-chain` do not look there. A tree's sub-plans now run on the root chain unless `--child-chain` names another. To use `daily7-sub-a`, copy its file into your project's own `chains/` folder.

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

- **Models that default above high.** GLM-5.3, GLM-5.3 Flash, MiniMax M3.1 Flash and Qwen3.8 Max run at
  `max` or `xhigh` unless told otherwise. THC sends them `high` like every other model: the shipped
  chains say so in the seat, and in your own chain a seat that sets no reasoning level is sent `high`.
  A level you write yourself (`low`, `xhigh`, `max`) is sent as written.
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
- **`gp-judge-v1`** (since 0.8.2 out of `chains/`, now in `chains/outdated/`) ran its Sonnet and Qwen seats with reasoning on (it ran with it off before). Scores
  from that version on come from the high-effort judge, so earlier and later GP scores are not
  directly comparable.

### Optional chain-config fields

- **`schemaVersion`** - an integer, optional. `council doctor` warns (never fails) when a chain
  omits it or names an older/newer one than this build knows about. A chain file without it keeps
  working exactly as it always did - this is a warning, not a requirement.
- **`max_proposals_per_seat`** - an integer, **opt-in, no default**. Debate size stays unlimited
  unless a chain file explicitly sets this. When it is set and one seat's own proposals still
  exceed it, that seat gets one merge prompt to fold its own list down before the debate board
  ever sees the extras.
  The older spelling `proposals.maxProposalsPerSeat` still works; a chain that sets both with
  different values is refused (`council doctor` names it).
- **`role`** - optional, on any `seats.proposers` entry only (set anywhere else and `council
  doctor` rejects it fail-loud, since it would silently do nothing there): `{ lens?, persona? }`.
  `lens` is one of `adversary | integrator | long-horizon | user-advocate | security-and-legal` -
  a critique function. `persona` is a name - a voice, resolved against the default set in
  `PERSONAS.md` when it matches, otherwise used as free text. Applies only to that seat's
  debate-stage prompt; the panel/critique stage that sets `passed` never sees it, enforced by a
  source-level guard, not just an intention. A chain with no `role` set is byte-identical to
  before. **No efficacy claim**: this ships the mechanism, not evidence that it helps - see
  CHANGELOG.md's 0.6.0 entry.
- **`persona`** (a different carrier from `role.persona` above) - optional, on a `seats.critics` entry (a judge) or a `seats.proposers` entry (a proposer); set on any other seat, `council doctor` rejects it and says why, since it would silently do nothing there. A critic may not carry both `role` and `persona`, and a proposer may not carry both `persona` and `role.persona` (a `role.lens` beside `persona` is fine); `council doctor` rejects one that does. It is a plain name, read only with the chain switch **`seat_personas`** `{ enabled, form }` (opt-in, no default; needs `"signoff": "unanimous"`). `form` is `title` or `voice`, one for the whole chain: everyone has a title or everyone has the full voice. Under `title`, the system prompts of each named seat get one sentence before the reply format saying the name is the title of the seat and changes nothing it does (a judge: the verdict prompt and the two layer-exchange prompts; a proposer: its debate post, and its proposal and reply prompts); a `role.persona` voice on any proposer is refused under either form. Under `voice` (experimental; of the shipped chains only `plan-the-high-council` uses it), every named seat gets the voice block: the owner's frame ("you speak in the voice of the name") for every job, the same for every name, alive or not (there is no setting that gives one name less than another), and after it, for each of the fifteen seat names of `plan-the-high-council`, a few plain sentences about that person (`PERSONAS.md`); a name with no such line gets the frame alone. The name is a bare string and is never looked up in the shipped persona set. `report.json` gets an optional `seat_personas` key: the form, the seats that carry a name (judges, then proposers, each with its `kind`) and every place a persona name appears in judge-written text (counted, not removed). All seven shipped planning chains switch `seat_personas` on, `plan-the-high-council` in the form `voice` and the other six in the form `title`, with a persona on every proposer and judge seat. The debate stage's `role.persona` is unchanged and the panel still never sees it; this is a second route with its own source-level guard (`test/stage-isolation.test.js`). With the switch off, or for a seat without a `persona`, this adds nothing to any prompt. **No efficacy claim.**
- **`seat_personas` for one run** - `--persona-form title|voice` on the start line, and `persona_form` on MCP `start_run` and `dry_run`, set the form of a chain's `seat_personas` switch for that run only; the chain must already switch it on, or the setting is refused. The run saves the form in `run.json` as `persona_form`; a resume keeps it and refuses the other form.
- **`layer`** - optional, on any `seats.critics` entry only (set anywhere else and `council
  doctor` rejects it fail-loud, since it would silently do nothing there): a whole number from 1
  to 3. Either every critic has one or none does, and each layered critic needs its own `lab`.
  With layers the panel reviews in steps: layer 1 reviews the draft first, and a higher layer is
  asked only when every seat of the layers below it signed off on that same draft. An objection
  that holds a sign-off (an objection with no rating does; one rated below 4 does not) ends the round's climb,
  the reviser gets the objections, and the next round starts again at layer 1 (exceptions: a stall
  below the top layer, see "When a layered panel stalls" below, a run under `--ladder`, whose
  passes start at the layer the ladder or a request chose, and a pass the handler routed to layer 3 with `--next-pass-layer-3`, on any layered chain with a layer 3). With two or more layers, the top layer needs an explicit sign-off from every seat: a
  stated pass there stops the run as not agreement. `report.json` gets a `layers` list (one row
  per round per layer; a layer that was not asked is a row, `not_asked`, never a gap). Layers need
  a unanimous, non-relay panel without `quorum`. With `answer_back`, a judge keeps its own open
  objections until it is next asked, however many rounds go by first. A judge that states a pass
  while one is open has not withdrawn it: the objection is carried, and only a withdrawal that
  quotes the draft closes it.
  A chain with no `layer` runs exactly as before. **No efficacy claim**: this ships the
  mechanism, not evidence that it helps.
- **`seats.decider`** - optional, one seat, only on a chain whose critics all have a `layer`. When an objection from a judge of one layer comes back after the writer revised the plan in response to an objection from another layer (the plan swings between two sets of demands), the decider is asked once which side should prevail, and its answer reaches the
  writer as a note. `report.json` gets a `decisions` list with one row per such conflict: who ruled, or why
  nobody did. A ruling closes nothing: the judge who raised an objection is still asked about it. The decider
  is not a judge, so the one-lab-per-seat rule does not apply to it, and a row says so when the decider's lab
  is one of the labs in the conflict. The seven layered planning chains (`plan-mini-council`, `plan-medium-council`, `plan-high-council`, `plan-the-high-council`, `plan-china-medium-council`, `plan-china-high-council`, `plan-claude-council`) name the Claude Code session as their decider.
  A decider that is the Claude Code session pauses the run (exit 3) and leaves a file to answer. A chain without a decider records each conflict as `no_decider_seat`.
  For each requested choice, `<n>` is the conflict number and `<choice>` is an objection id listed for that conflict, or `neither`. When the decider asks for your choice, the run stops at exit 25. For a plain run, record and apply the choice with `council --resume <run folder> --prevail <n>=<choice>`. For a tree member, record it with `council tree decide <tree id> --prevail-node <node> --prevail <n>=<choice>`, then apply it with `council tree resume <tree id>`. Supply a choice for every conflict that asks for one.
- **When a layered panel stalls** (0.8.4) - on a chain whose critics all have a `layer` and whose dispute stage is on (`dispute.enabled`), a stall below the top layer no longer ends the review. A stall is one objection that stands unchanged for `dispute.stall_rounds` verdicts of its judge in a row (3 in every layered chain that comes with the package, 2 where a chain does not say): the same id, the same quoted passage and a writer who has not changed that passage (an objection without a quote counts while it stands). A judge who rewords the complaint keeps the count; another objection of the same judge neither adds to it nor resets it; a judge who was not asked or not heard in between (a lower layer objected, a seat was unreachable, a re-ask carried a verdict) neither adds to it nor ends it. A chain without layers counts the same way. The plan is passed up instead, for that one round: the layers from the one above the stalled layer upward review it as they always do, only the objections that stalled are passed up, the layers below read the plan again in the round after it (unless the run ends there), and each judge of the layer the plan went up to then rules on every stuck objection in a call of its own (stage `rule-<round>-<lab>`, under your spending limit). This is not the decider's ruling: the decider rules on a swing between layers and closes nothing, while here a judge either sustains an objection or overrules it with a reason. Each passed-up objection ends in one of three states: sustained, when a judge of that layer sustains it, which makes it that judge's own (one rated below 4 holds nothing back: the plan goes on to the next layer); overruled, when every judge of that layer overrules it, which closes it although its raiser did not withdraw it if it is rated below 4 and was never rated 7 or above, and otherwise leaves it open under its id (an objection that is not rated counts as 4 or above, and on a chain whose judges are not asked to rate no objection carries a rating); or undecided, when it was neither sustained nor overruled by every judge (a ruling that could not be read, for instance), which leaves it open as the objection of the judge who raised it. The ruling prompt names neither the lab nor the layer of the judge who raised an objection. An objection that was passed up is not passed up again in the same overseer round; a chain without overseer rounds counts the whole run as one round. A stall that cannot be passed up (the top layer holds one of the stalled objections; no pass is left; the chain keeps no answer-back list or does not ask its judges to rate; or the next pass is a ladder pass, which does not pass a plan up) does not end the run on a layered chain: it stops it for your choice (exit 23; see the exit table). The stop's kind is `stall_stop`, except for a top-layer stall at the overseer-round cap, which is the cap's own stop (`overseer_cap`) and carries the stalled objections. Only a chain without layers still ends the review as `stalled`.

  If the top layer then signs off while the layers below were passed over, the run ends as an
  *escalated sign-off*, which is not agreement of the whole panel: `passed` is false, `outcome` is
  `no_consensus`, `report.json` has `escalated_signoff`, and the plan opens with an "Escalated sign-off" block that says what became of each passed-up objection. With a handling session, that session answers its build check before the run ends: after `good_to_build` the run ends agreed on that check (`ending` says so; it does not exit 22, and the dispute stage does not run); after `not_yet` it does not end there, and the plan is sent back. Without a handling session the run exits 22 and the dispute stage lists the objections no ruling closed. If the top layer objects instead, the next round climbs from
  layer 1 again, and a round in which every judge signs the same draft is an ordinary sign-off. Without a quote, an objection's id stands only for its judge and its criterion,
  so when that judge raises it again after a ruling closed it, nobody can tell it from another
  problem under the same criterion: it counts as a live objection, and the plan can stall and be
  passed up again within the run's round limits. The top layer still sees every judge's lab in its
  objection ledger (with `answer_back`). **No efficacy claim**: this ships the mechanism, not evidence that it helps.
  On a LADDER chain (the `ladder` key; every shipped planning chain from 0.8.4 on) the plan is never passed up ahead of its turn: layer 1 revises in blocks, layer 2 is asked in its visits and layer 3 reads when the ladder's order reaches it, so a stall below the top layer is not escalated. A stall the top layer holds, a judge that stays silent after its re-asks and its one solo ask, or the person's own stop ends the work for now as a resumable stop: you can continue, finish after one last top-layer read, or finish at once.
- **Ending a stopped run at once (0.8.4)** - the stops in the table below take `--finish-now` (typed with `--resume <run folder>`), a spending stop or a credential-shaped pause only once the review rounds have begun (before them there is no review to end); a stop at a seat's price limit or at a conflict between objections does not take it; the handling session can relay a choice with the person's own words through `stop_decide` (`person_words`) where the table says so. No stop screen asks "finish now?": the choice is accepted at every stop in the table, and the screens of the spending stop and of the pause between two passes name it as a way to end the run there.

  | Stop | `--finish` | `--finish-now` | relayed through `stop_decide` |
  |---|---|---|---|
  | a round stop (overseer-round limit, a layer's bound, a stall, a silent seat) | one last top-layer read, then the end, NOT agreed | at once, NOT agreed (a panel that had signed off keeps that verdict at the stop where no seat of the top layer could read the final plan) | `continue`, `finish`, `finish_now` |
  | the owner's pause (`council pause`) | one last read, then the end | at once | `finish`, `finish_now` (a pause is continued by resuming it) |
  | a spending stop | records the choice inside the review rounds (the end follows your raise, after one last read; a raise that does not cover that read stops the run again, still not ended); `--continue` is the way back | at once, no call that bills; a final read already on disk counts | `finish_now`, `finish` (inside the rounds), `continue` (only past a finish given earlier) |
  | a credential-shaped pause | records the choice; `--continue` then ends the run and allows the found value | at once; the value is NOT allowed, so a later prompt that still holds it pauses again. At a pause after the review rounds it ends the run at the pause: no call that bills, no judge, and a call whose prompt holds the value is not made (it does not pause again; `stages_not_run`, reason `finished_at_once`) | `continue` (sends the stage as it is and allows the value), `finish` (inside the rounds), `finish_now`, `drop` (an excerpt only); the person's words in `person_words`, and the record says relayed |

  A run ended at once inside the review rounds, or at a round stop, is NOT agreed, except at the round stop where no seat of the top layer could read the final plan: a panel that had signed off before the read keeps that verdict there, and the report says the top layer did not read the final plan. Ended at once at a spending stop or a credential-shaped pause after the review rounds, it keeps the verdict the rounds reached, and where the top layer owed a read of the final plan the report says the top layer did not read the final plan, that only part of it had read this version, or, where the run did not end agreed, that all of it had read this version but not again after an objection or late finding was opened or amended. No judge is asked again, a final read that is already on disk for this text is kept and counts as read, and what the top layer already read of the current text stays on the record. The handling session's own sort of a split final read is not asked either (`final_read.handler_sort_not_run`).

- **`quorum: { "minHeard": N }`** - opt-in, unanimous chains only, set in no shipped chain. A
  round's sign-off counts only when at least N reviewers gave a verdict (signed off or objected);
  a round short of it is recorded as `notQuorate`, the run does not pass, and the loop stops.
- **Tiered councils (experimental, used by the planning tiers, `mock-tiered` and the retired `plan-highest-7` and `plan-daily-7` in `chains/outdated/`).**
  `seats.alternatives` names who writes the whole alternative architectures, separately from the
  proposers. `deep_dive` + `seats.deep_dive` add one seat with its own dollar cap
  (`usd`, required) inside the run's cap. `majority_guard.enabled` shows each author every
  argument once, with no lab name or count, and keeps a proposal whose withdrawal does not quote
  the argument it gives in to. chain-lint refuses a tiered chain where a lab or model sits
  both among the proposers and among the reviewers or architecture authors, or where the deep-dive seat shares a lab or model with a reviewer, unless the chain says `"judging": "all-roles"` at the top level (the owner's deliberate override of 7 Oct 2026, set in the seven planning chains and in six retired chains under `chains/outdated/` (`daily7-sub-a`, `plan-daily-7`, `plan-highest-7`, `plan-china-mini-council`, `plan-default-opro-council` and `plan-mini-council-sol-session`): a model may then both propose, write architectures or deep-dive and sit on the voting panel; `"selfReview": "allowed"` seats the plan's writer on the panel too). See
  CHANGELOG.md's 0.7.8 entry.
- **`tools.seat_requests`** - opt-in (`tools.seat_requests.enabled`), and only together with `verify.enabled` and a `verify.tools` list. A chain that turns on seat tool requests sends their results to every later seat. Those results are not excerpts: they are not recorded in `excerpts.jsonl` and the privacy switch does not cover them.

## How this was built

Vibecoded, with **Claude Code** doing the writing, by one person at
[Sower Industries](https://sower-industries.de). Parts of it were planned by the harness itself —
the build order for its own v2 went through a four-lab council, and the plan came back with one of
its findings built on evidence that turned out to be wrong, which is recorded rather than quietly
dropped.

The parts worth knowing, because they explain why the code looks the way it does:

**Almost every defensive branch here is a headstone.** `parseJson` in `chain.js` first repaired two
specific malformations — an unescaped `"` inside a markdown-quoted span, and raw newlines inside
string values — because three consecutive real runs died on the first one and silently logged a
pass that never happened. The comments name the run id and the date. Among the repairs added since
(`PARSE_REPAIRS`), each found in a real reply: a key missing its opening quote, and a closing bracket
with nothing of its kind open. A verdict closed one brace early, with its keys still following it,
now reads as unreadable instead of as a sign-off, because one such reply had lost its list of
failures without a word. A sign-off table whose rows follow the criteria in order but in the judge's
own words is read by row position, under guards that refuse a tie, a row number that disagrees, a
row its text places elsewhere and a row too short to claim a criterion (`src/criteria-ledger.js`). The retry after a
reply that spent its whole budget thinking exists because an Anthropic seat burned its entire
`maxTokens` budget thinking and returned nothing; until 0.8.0 it switched thinking off, and since
0.8.1 it keeps the same effort and raises the cap. The `ROSTER SHRANK` warning exists because a lab can return nothing and vanish
from the scoreboard without saying so. None of these were designed in advance; each one is a day
that went wrong.

**The failure modes are testable offline.** The `mock` provider has named models
(`mock-unreadable`, `mock-provider-error`, `mock-proposer-empty`, `mock-critic-holdout`, `mock-near-json`,
`mock-early-closer`, `mock-retyped-table`, `mock-http-503-all`) that each drive one of those branches for $0, so the regression tests run
without keys and without spend.

**`docs/` ships no JavaScript on purpose.** The landing page arrived from a design tool depending
on an unlicensed runtime that also fetched React and Babel from a CDN at page load. Shipping it
would have relicensed someone else's build artifact as MIT and put a third-party request on a page
shared with a German site. Its loops were pre-rendered to static HTML and the fonts self-hosted
instead. `test/landing-page.test.js` fails if a script tag or a third-party URL ever comes back —
and if the page's typed-in numbers stop matching the repo, which has already caught the page
claiming 29 chains and 12 tools when there were 30 and 11.

## Skills

`skills/` carries a small set of Claude Code skills shipped alongside this harness, not part of
it - usable in any project, with or without the harness, and needing no API key:

- **Core agentic work:** `task-scoping`, `research-and-sourcing`, `verification-and-critique`,
  `context-and-handoff`, `tool-and-action-discipline`, `computer-use-discipline`,
  `agent-instruction-writing`, `skill-and-plugin-vetting`, `command-and-control` - the work around
  the work, for any agent task, including setups where several models propose, critique, and hand
  off to each other.
- **Building software:** `backend-developer`, `test-suite-discipline`, `frontend-developer`, `ux-design`, `visual-craft`.
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
