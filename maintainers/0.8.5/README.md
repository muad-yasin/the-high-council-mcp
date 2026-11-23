# 0.8.5: prepared, and one change built

This folder holds work prepared for 0.8.5 so that a later build session can start from it without redoing the research, and the record of one change already built on `dev` ("Built on dev", below). The prepared notes are not built, and none of them is a build order: each note is input, and what it proposes waits for a build session and, where it says so, for the owner's yes.

## What it is based on

Every note was read against the code at commit `0b4016a5`, and its line numbers are that commit's. Before this folder was added, `dev` took exactly that tree, through a merge that keeps dev's earlier snapshots in its history. When a later build starts, it reads the line numbers again against the code of that day.

## What was run to prepare it, and what was not

No test was run to prepare these notes, and nothing in them is built. Two things were run to prepare them, and neither wrote a file:
- `npm audit --package-lock-only` on the lockfile of `0b4016a5`, once, on 23 Nov 2026, with npm 11.20.0. It asks the npm registry. Its output is the basis of note 210.
- One evaluation of two pure functions of `src/`: `exchangeLayerOf` and `settingsDependOnCap` of `src/cache-order-gate.js`, called on the shipped chain files, with `shortExchangeOn` of `src/short-exchange.js`. It is the basis of one statement in note 209.

Every "expected red" in a note is therefore a prediction, which the first test run of the build must confirm.

How the claims were checked:
- Each file-and-line claim was checked against the file at `0b4016a5` by the session that wrote the notes.
- Each note was then reviewed, with spot-checks, by a second session, which corrected the cites it found off.
- A claim that could not be read in the code is marked "read, not run", "not established", "not checked" or "reported, not verified".

## How to read a note

A note says, in this order:
- what is wrong, shown on the code with file and line;
- the smallest change;
- the test, and how it fails first;
- the owner's gates it touches;
- what the change must not touch;
- the questions only the owner can answer.

Two notes depart from that order. Note 199 goes row by row, eight rows, with its questions collected at the end. Note 210 has an exit check, the audit run again, in place of a failing test.

A sentence a person or a session would read is marked A-DRAFT: its words wait for the owner's yes. A note's options state each option's result.

The numbers are the items of the maintainer's own roadmap. That roadmap is not in this repository; `archive/maintainers/ROADMAP-0.8.0.md` is an older and different file. So each note restates its item in its own words.

## The notes (`small-items/`)

| Note | What it is about | Gates and open questions |
| --- | --- | --- |
| `199-doc-lines.md` | eight documentation lines that are missing or out of date: two CHANGELOG bullets, a Known limit, the release steps, the 0.8.4 CHANGELOG's gaps, pointers to sections in another file, a refusal hint, test comments | A-DRAFT sentences; questions D, E, F and G |
| `200-cut-carried-guard.md` | when a finish cuts a layer, a carried verdict is read as if it were new | the case that would change a record is not established; one conditional question |
| `201-cut-exchange-rows.md` | when a finish stops a layer's exchange, `report.json` keeps none of that exchange's completed rounds; two readers do not follow the report's open list | records (additive), A-DRAFT sentences; three questions |
| `202-npx-unpinned.md` | the MCP install command names no version | A-DRAFT sentences; three questions |
| `203-mcp-pause-route.md` | a paused stage's prompt names the terminal's way to answer, also over MCP | A-DRAFT sentences; one question with three designs |
| `204-dry-run-task-price.md` | MCP `dry_run` takes no task; below the chain's assumed prompt size a task changes no figure | A-DRAFT sentences; two questions; the second is a money path |
| `206-haiku-price-tier.md` | the price rows of Claude Haiku 5.5 price every prompt at the long-prompt rate | a money path; four questions |
| `208-verify-first-legend.md` | the "Verify first" gap check reads a marker legend as a claim, and misses a match when apostrophes differ | two questions |
| `209-gpt-seat-cache.md` | THC adds no cache mark for its GPT seats behind OpenRouter | a money path; a paid check first; a recorded decision would be reversed; four questions |
| `210-dependency-advisories.md` | the lockfile holds dependency versions with published advisories | an A-DRAFT note; two questions; the build needs npm and the full suite |

## Built on dev

| Record | What it is about | Gates and open questions |
| --- | --- | --- |
| `gpt-6.2-chains.md` | three shipped chains seat GPT-6.2 Sol and GPT-6.2 Astra in place of GPT-6.1 Sol and GPT-6 Astra; three tables gain the two models' entries, and the zero-retention table is written whole from the list of 2026-11-23 | A-DRAFT sentences and labels; a Known limit, for the owner |

## Not prepared

These points came up while preparing the notes, and no note takes them on:
- **Whether the Claude Code plugin route starts.** Claude Code installs the plugin's dependencies from the lockfile in its own cache. No install was run (note 202).
- **Whether the two other readers of a pass's verdicts lose what the exchange adds to a carried verdict** (`src/chain.js:5718` and `:6240`; note 200).
- **A legend that shows `[DISPUTED: ...]`.** It may raise `claim_disputed_early` (`src/claim-markers.js:107`); not checked (note 208).
- **Whether `pkg` bundles `express` into the binaries,** because `pkg.scripts` takes in `src/http-server.js`, which no CLI path starts (note 210).
- **A paused stage answered by `submit_stage` and then by the file route.** The file route ends in a rename onto `<stage>.md`, which by then holds the submitted answer. The submission path writes that file once, or keeps a second answer aside as `<stage>.late.md` (`src/stage-submission.js:150-166`), but a later rename by the session itself is outside that path. Whether anything notices that the answer was replaced, after the run may already have read it, was not read. That is a record point (note 203).
- **The rest of the maintainer's roadmap.**
