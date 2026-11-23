# 0.8.5: prepared, and changes built on dev

This folder holds work prepared for 0.8.5 so that a later build session can start from it without redoing the research, and the records of the changes already built on `dev` ("Built on dev", below). The prepared notes are not built, and none of them is a build order: each note is input, and what it proposes waits for a build session and, where it says so, for the owner's yes.

## What it is based on

Every note but three was read against the code at commit `0b4016a5`, and its line numbers are that commit's. Before this folder was added, `dev` took exactly that tree, through a merge that keeps dev's earlier snapshots in its history. Note 209 also cites two rows of the commit that added them, as it says. Note 216 was read at `6eb41961`, note 213 at `2c727fd9` and note 217 at `07dbe925`, each the tip of `dev` when it was written; the `skills/` that note 217 reads is the same there as at `0b4016a5`. When a later build starts, it reads the line numbers again against the code of that day.

## What was run to prepare it, and what was not

No test was run to prepare these notes except note 213, and nothing in them is built. These were run to prepare them, and none wrote a file in the repository:
- `npm audit --package-lock-only` on the lockfile of `0b4016a5`, once, on 23 Nov 2026, with npm 11.20.0. It asks the npm registry. Its output is the basis of note 210.
- One evaluation of two pure functions of `src/`: `exchangeLayerOf` and `settingsDependOnCap` of `src/cache-order-gate.js`, called on the shipped chain files, with `shortExchangeOn` of `src/short-exchange.js`. It is the basis of one statement in note 209.
- For note 213: `test/stall-ratings.test.js`, once; one offline run, at no cost, of that file's UB-13 scenario with its log kept; and the red runs of the first step's tests, on the tree before that step.

Every "expected red" in a note is therefore a prediction, which the first test run of the build must confirm.

How the claims were checked:
- Each file-and-line claim of the first ten notes was checked against the file at `0b4016a5` by the session that wrote them.
- Each of those notes was then reviewed, with spot-checks, by a second session, which corrected the cites it found off.
- Note 213: the session that wrote it checked its cites and its "Today" cells against `2c727fd9` by script; a second session read it whole and spot-checked seven of its cites there.
- Note 217: the session that wrote it read each of its six places in THC's own `skills/` and searched the tests and documents for the sentences they pin; a second session read the note whole and spot-checked fourteen of its cites at `07dbe925`.
- Note 216's plan, and then the note itself, were reviewed by a second session, which read the code at `6eb41961` for itself and had what it found corrected.
- A claim that could not be read in the code is marked "read, not run", "not established", "not checked" or "reported, not verified".

## How to read a note

A note says, in this order:
- what is wrong, shown on the code with file and line;
- the smallest change;
- the test, and how it fails first;
- the owner's gates it touches;
- what the change must not touch;
- the questions only the owner can answer.

Five notes depart from that order. Note 199 goes row by row, eight rows, with its questions collected at the end. Note 210 has an exit check, the audit run again, in place of a failing test. Note 216 opens with what is there today, since it lifts a rule, and adds a table of the sentences as drafts. Note 213 sets out the design, the record and a table of the sentences as drafts before its tests. Note 217 goes place by place, six places, with its gates and questions collected at the end.

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
| `213-sustain-ownership.md` | today a sustained objection becomes the sustaining judge's own: the second step of a fix whose first step is built (a judge that restates a row shown in its prompt as `continues <its id>` is heard) | the sentences a model reads, for the owner's yes; a record field's meaning changes; three questions |
| `216-grok-ban-lift.md` | the ban on xAI/Grok is lifted with 0.8.5: what refuses such a seat today, what the lift changes, and what stays refused | the owner's own rule and its new sentence; A-DRAFT sentences; two questions; a table filter that must not be emptied by accident |
| `217-writing-skills-review.md` | an outside review of copies of five writing skills found six places in THC's own `skills/`: four defects, one of them only in part as a missing scope, and two wording points that hold in part | every proposed sentence is read by a model, for the owner's yes; one place is his pick of three options; one is legal wording; three questions |

## Built on dev

| Record | What it is about | Gates and open questions |
| --- | --- | --- |
| `gpt-6.2-chains.md` | three shipped chains seat GPT-6.2 Sol and GPT-6.2 Astra in place of GPT-6.1 Sol and GPT-6 Astra; three tables gain the two models' entries, and the zero-retention table is written whole from the list of 2026-11-23 | A-DRAFT sentences and labels |
| the commit message of "relation: a judge's `continues` on a row it was shown is heard as its own objection" | a judge that restates a row of another seat shown in its prompt as `continues <its id>`, or the copy it took over by a sustain, is heard instead of refused; what a sustain does is unchanged | how a run that started before this change reads when it resumes is open (read, not run) |

## Not prepared

These points came up while preparing the notes, and no note takes them on:
- **Whether the Claude Code plugin route starts.** Claude Code installs the plugin's dependencies from the lockfile in its own cache. No install was run (note 202).
- **Whether the two other readers of a pass's verdicts lose what the exchange adds to a carried verdict** (`src/chain.js:5718` and `:6240`; note 200).
- **A legend that shows `[DISPUTED: ...]`.** It may raise `claim_disputed_early` (`src/claim-markers.js:107`); not checked (note 208).
- **Whether `pkg` bundles `express` into the binaries,** because `pkg.scripts` takes in `src/http-server.js`, which no CLI path starts (note 210).
- **A paused stage answered by `submit_stage` and then by the file route.** The file route ends in a rename onto `<stage>.md`, which by then holds the submitted answer. The submission path writes that file once, or keeps a second answer aside as `<stage>.late.md` (`src/stage-submission.js:150-166`), but a later rename by the session itself is outside that path. Whether anything notices that the answer was replaced, after the run may already have read it, was not read. That is a record point (note 203).
- **A failure with no relation.** A reply in which a failure leaves its relation out is refused whole as unreadable (`relation_missing`, `src/chain.js:5502-5504`), and the re-ask that follows says nothing of why, so a seat can still go unheard after the first step of note 213.
- **The rest of the maintainer's roadmap.**
