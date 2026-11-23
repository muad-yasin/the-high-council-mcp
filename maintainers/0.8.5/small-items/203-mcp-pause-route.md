# 203: a paused stage's prompt names the terminal's way to answer, also when a session reads it over MCP

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is wrong

**Two routes in one answer.** A run that pauses at an external seat writes `NEEDS-<label>.md`.
- **The route paragraph.** Its body, in the plain form at `src/cli.js:4762`, has a route paragraph that runs from "Write the reply to" through the `--resume` line. It tells the reader to write the reply to `<label>.md.partial`, rename it to `<label>.md` when it is complete, and run `<command> --resume runs/<id>`.
- **What follows it.** Between that paragraph and `## System prompt` come the sentence naming the model the seat is asked for, the block of text requests, and the excerpt block.
- **Repairs.** The repair bodies carry the same route. Their text `how` (`:4745-4747`) ends in the same `--resume` line and goes into the three builders of `src/near-json.js` (`:305`, `:315` and `:325`).
- **The pause log** names it as well (`:4771`, `:4775`, `:4778` and the resume line at `:4780`).

Over MCP, `external_prompt` (`src/mcp/server.js:823-859`):
- checks the integrity footer on the whole text (`:847`);
- can page the text by code point (`:837-843`);
- returns the file whole as `prompt`. Beside it, `answerWith` says `submit_stage(run, "<label>", <text>)`, or `repair_reply(...)` for a repair (`:855`).

So one answer to a session names two ways to answer: the terminal's file and `--resume`, and MCP's `submit_stage`.
- **File first, then `submit_stage`.** A session that follows both routes in this order has the second answer kept aside as `<stage>.late.md`. The reply says that `<stage>.md` "was left untouched" (`src/mcp/server.js:939-940`; `src/stage-submission.js:150-156`), and the run goes on with that first answer: it resumes from `<label>.md` (the comment at `src/cli.js:4757`).
- **`submit_stage` first, then the file.** The file route ends in a rename onto `<stage>.md`, which exists by then. Whether anything guards that was not read.

The other texts a session meets:
- `RESUME.md` is written for a driving session and names the MCP tools whatever the channel (`src/resume-brief.js:132-140`): for a waiting stage, `prepare_stage_prompt` or `submit_stage`. It also points to the file itself (`:109`).
- The dispatch bundle of `prepare_stage_prompt` names `submit_stage` first and the file route as the alternative (`src/stage-contract.js:325-332`). Both routes in one text, labelled, is the form of option (c) below. The bundle also lists the file among its references (`src/mcp/server.js:896-898`).

**A chain's description is incomplete.** `chains/mock-external.json` says: "The builder and reviser are external seats".
- The handoff seat falls back to the builder when a chain names none (`src/chain.js:7993`), and this chain names none, so its handoff is external too.
- That comes from reading the code and the chain file: its builder and its reviser are `external`.
- No test of a handoff pause on this chain was found. Among the tests that name it (`git grep -l mock-external -- test/`), those read pause at the build. `test/answered-by-record.test.js:255` pins a handoff pause on another chain.

## The smallest change

**The route.** There are two real designs, and question 1 picks one of them, or the third form it names.
- **(A) Read side.** `external_prompt` returns the body with the route paragraph removed. The integrity check stays on the whole file as written (`:847`), and paging cuts the returned text. The CLI keeps writing the file as it does.
  - `answerWith` already names the route outside the prompt, so removal may be enough.
  - Both `prompt` and `answerWith` are marked as run-folder text (`src/mcp/untrusted.js:40`). A sentence added inside `prompt` would put the server's words in the middle of the file's text, not beside it.
  - The tool's description says that it returns "the exact system and user prompt that stage needs answered" (`:823`). That stays true: (A) changes only the header above them.
  - Per form:
    - the plain form drops the route paragraph;
    - a repair's body drops `how`, which sits right before `## The original reply` (`src/near-json.js:311`, `:321` and `:330`);
    - a tree member's form is not worked out. Its paragraph ends in the tree's own command, and `submit_stage` writes a member's answer without resuming it (`src/resume-brief.js:135`), so that command must stay.
- **(B) Write side.** The CLI child learns its channel and writes that channel's route at `src/cli.js:4745-4762` and `:4771-4780`.
  - No channel mark exists in `src/cli.js` today. The closest is `--run-id`, which `start_run` passes (`src/mcp/server.js:794`; the CLI reads it, `src/cli.js:3294`). But a person can pass it too, and the resume spawn passes none (`src/mcp/server.js:1110`). Another candidate is the spawn record `.spawn.json` (`src/run-status.js:75`), which the server writes for each run it spawns: on `start_run`, once startup is past (the comment at `src/mcp/server.js:525-528`). Whether it is on disk when the child writes its prompt file was not traced.
  - Otherwise `spawnRun` (`:726-731`) and the resume spawn (`:1114`) would set a new signal; today both pass `cliEnv`, which is `process.env` (`:122`).
  - A run that pauses on one channel and is answered on the other would show the wrong route. That is P5's own setup: started at the terminal, read over MCP.

- **(C) Both routes,** as the dispatch bundle names them. The sites are (B)'s, with no signal: every file names the terminal's route and MCP's, each labelled.
  - Test PR-C: a plain run's `NEEDS-build.md` holds both `--resume runs/` and `submit_stage`. Expected red today (not run): the file names no `submit_stage`.
  - `test/tree-pause-notice.test.js:40-46` stays green.
  - The route sentence is A-DRAFT.

**The description.** Name the handoff in `chains/mock-external.json`'s description.
- `test/fixtures/cache-unrecorded-f039a88a.json` embeds the description's text. It is the dry run's output captured on an earlier commit (the header of `test/cache-unrecorded-pin.test.js`).
- Whether that pin compares the description was not read. Read it before the edit.
- No document copies the description: `CHANGELOG.md:1405-1406` and `docs/report-format.md:174` name the chain only.

## The test, and how it fails first

- **PR-A, for (A).** Use P5's setup (`test/mcp-external-prompt-system.test.js:21`). Assert that `reply.prompt` holds no `.md.partial` and no `--resume runs/`, and that it still holds the system section byte for byte.
  - Expected red today (not run): the prompt is the file, route included.
  - P5 pins the whole file so that the system text reaches the client exactly as the CLI wrote it (its header, `:1-7`). PR-A keeps that purpose. P5's assertion `reply.prompt === needs` (`:36`) becomes a changed accepted test.
- **PR-B, for (B).** Start `mock-external` over MCP (`start_run`), read `NEEDS-build.md`, and assert that it holds no `--resume` line.
  - Expected red today (not run): the file has the line.
  - `test/tree-pause-notice.test.js:40-46` must stay green: a plain run at the terminal keeps its `--resume` line.

These run with the change:
- the two test files above, and `test/tree-pause-notice.test.js`;
- `test/cache-unrecorded-pin.test.js`, if the description changes;
- the 14 files under `test/` that hold `md.partial` or `--resume runs/` (`git grep -l -E 'md\.partial|--resume runs/' -- test/`), one of them a fixture. Under (B) and (C), every paused run's file changes;
- the source scanners.

## The owner's gates

- **Prompt wording:** none, as long as the change touches the route paragraph alone.
  - Between that paragraph and `## System prompt` stand the asked-for sentence, the block of text requests and the excerpt block (`externalStageBlock()`). The last is held wording: `src/excerpt-record.js:207` reads `held('externalStageParagraph')`, recorded at `src/prompts/recorded-084-a.js:133`.
  - The system and user sections stay as they are.
  - The hash that a resume holds the answer to covers the system and user prompts only, not the header (`promptHashOf(system, user)`, `src/chain.js:2167`; stored in `<label>.prompt.json` at `src/cli.js:4756`).
  - The repair bodies' words are written inline in `src/near-json.js`, which imports nothing from `src/roles.js`.
- **Sentences a person or a session reads:** under (A), none is added: the route paragraph is only removed from what the tool returns. Under (B), the route sentence and the pause log; under (C), the labelled routes. Also the description of `mock-external`. All are A-DRAFT until the owner's yes.
- **Money:** none.
- **Hand-typed counts:** none.

## What the change must not touch

- **The integrity footer,** which covers the whole file (`withIntegrityFooter`, `src/integrity.js:21`). The check, and its warning in the reply, stay on the file as written.
- **The header line that names the model a seat is asked for.** `askedForOfNeeds` reads it above `## System prompt` (`src/answered-by.js:223-227`), and so does the dispatch bundle (`src/mcp/server.js:900-902`).
- **A tree member's form** (`memberNotice`, `src/cli.js:4745-4746`, `:4762` and `:4780`). It names the tree's own command and never the direct `--resume` (the comment at `:4759-4760`).
- **The system and user sections,** and stage labels.

## Questions only the owner can answer

1. Which route does a paused stage's prompt show?
   - (a) Read side.
     - Result: a session that reads the prompt through `external_prompt` sees only `submit_stage`, whichever channel started the run. For a tree member this is not worked out: `submit_stage` writes a member's answer without resuming it, so the member's form must keep the tree's command.
     - A session that opens the file itself still sees the terminal's route: `RESUME.md` points to it, and the dispatch bundle lists it among its references. The pause log names the terminal's route too.
     - `external_prompt` no longer returns the file whole, which P5 pins from a plan item.
   - (b) Write side.
     - Result: the file names the route of the channel that wrote it, for every reader. A run answered on the other channel sees the wrong one.
   - (c) Both routes in every file, each labelled with its channel, as the dispatch bundle does today.
     - Result: one text for every reader, which then chooses by its own channel.
