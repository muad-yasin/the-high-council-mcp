# Changelog

## 0.7.8 - 2026-09-26

### Added

- **Dropped debate posts and replies are counted.** The debate stage has always filtered out a
  post on an unknown proposal id, on the poster's own proposal, or with a stance other than
  support/object/merge, and the reply stage the same for replies; the filtered item vanished and
  only the raw reply on disk showed it. Each one is now counted per lab and reason in
  `report.json`'s `debate.dropped` (experimental: `[{ stage, by, reason, count }]`, `[]` when
  nothing was dropped) and listed under "Dropped from the debate" in `BOARD.md`. A reply that did
  not parse at all counts as `unreadable`. The filters are unchanged, and the board text the
  builder reads is unchanged: the new section is `BOARD.md`'s alone.
- **The price table says how old it is.** `src/pricing.json` has a machine-readable top-level
  `asOf` (`2026-09-06`: the oldest date every entry was last checked, so it errs old), and
  `council doctor` and `--dry-run` print it. Past 60 days they add a warning: the spend cap and
  every estimate project with these static prices.
- **An opt-in quorum floor for unanimous sign-off:** `quorum: { "minHeard": N }` in a chain. The
  panel's sign-off counts only when at least N reviewers gave a verdict (signed off or objected);
  a stated pass is not a verdict. Without it, a seven-seat panel where one seat signs off and six
  state a pass reads as unanimous. A round short of the floor is recorded as `notQuorate`
  (experimental, in `report.json`), `passed` is false, the outcome is `degraded`, and the loop
  stops, as it does after a round with no heard reviewer. With the dispute stage on, its reason is
  `not_quorate`. chain-lint refuses a floor on a non-unanimous chain or above the panel's size.
  **No shipped chain sets it**, so every shipped chain behaves as before.

- **Tiered councils (experimental), and a new chain that uses them, `plan-highest-7`.** Three
  additions, each off unless a chain turns it on, so every other shipped chain behaves as before:
  - `seats.alternatives` names who writes the whole alternative architectures, separately from who
    proposes parts (`seats.proposers`). With `alternatives.debaters: "all"` the proposers post on
    those architectures too, and only their authors reply.
  - A **deep-dive seat** (`deep_dive` + `seats.deep_dive`): one seat, one job (`sources` or
    `subsystem`), a large output cap and a dollar cap of its own (`usd`, required) inside the run's.
    It reads the task in chunks, once per `focus` entry, up to `maxCalls`; every call goes through
    the run's spend cap, and its own cap counts what the run cap counts (a stale cached call's old
    cost included). It does not vote: the reviser answers its findings before the panel's first
    review. Recorded in `report.json` as `deep_dive` (experimental) and on `BOARD.md`.
  - The **majority guard** (`majority_guard.enabled`): an author sees each argument on its proposal
    once, with no lab letter and no count; the reply prompts carry an evidence bar; and a withdrawal
    that does not quote the argument it concedes to is recorded with `unargued: true` and the
    proposal stays for the builder. It adds reply prompts, so it is on only in `plan-highest-7` and
    `mock-tiered`.
  - chain-lint: `deep-dive-uncapped`, `deep-dive-unpriced`, `deep-dive-votes` (the deep-dive seat
    may not share a lab or model with a voting reviewer), `alternatives-seats-unused`,
    `alternatives-seats-too-few`, `alternatives-debaters-unused`, `majority-guard-without-debate`,
    and `mass-seat-votes` (in any chain using these fields, a lab or model may not sit in both the
    proposers and the reviewers or architecture authors, guard on or off). `--rematch` now gives
    one anonymous label per lab across every seat list (tiered lists used to share `lab-1`), and
    relabels and key-checks `seats.alternatives` and `seats.deep_dive`; the live `state.json` board
    lists those seats. `chains/mock-tiered.json` runs every new path offline for $0.

  `plan-highest-7`: seven low-cost "mass" seats (the `cheap-7-v2` roster) write the blind proposals
  and do the proposal debate, and post on the architectures. Four "anchor" seats (GPT-6 Astra,
  Claude Fable 5.1, DeepSeek V4 Pro, GLM-5.3) write the architectures, answer the posts on them and
  form the review panel, the only seats that vote, under unanimous sign-off. A DeepSeek V4.1 Flash
  deep dive checks the first draft against the task under its own $4 cap, and the majority guard
  is on. Writer seats are external (a Claude Code session), as in `plan-premium-7`, with decision
  records and the dispute stage on. It is untested with real models, and nothing about its output
  has been measured. Price it before any run: `npm run dry -- --chain plan-highest-7 --task <file>`
  ($14.89 worst case for the default estimate with today's price table; a long task costs more).
  `src/roles.js` gained the deep-dive and guard prompts; every prompt the existing mock chains send
  is unchanged (`test/prompt-pin.test.js`).

### Changed

- **The dry-run prices each reviewer's review at that model's typical output.** A chain's
  `estimate.critiqueTokens` was one figure for every panel seat, but reasoning models spend most of
  a review thinking: `plan-premium-7` projected its Fable seat at $0.45 a round where a real run
  paid about $1.04, and its GLM 5.3 seat ran to its 36,000-token cap. Price entries now carry a
  measured `critiqueTokens` (the median panel-review output in the author's own runs; 13 models so
  far), which raises a seat's estimate above the chain's figure but never lowers it, and a seat can
  set its own `estimate: { critiqueTokens }`. Nothing exceeds the seat's review cap. `plan-premium-7`
  goes from $18.55 to $21.59 worst case, `cheap-7-v2` from $5.34 to $5.38, `plan-open-7` from $2.45
  to $2.49. The spend cap is unchanged: it still projects every stage at the seat's full
  `maxTokens`. No shipped chain file changed, so paused runs resume from their cache as before.

- **`src/http-server.js` and `express` are out of the npm package.** The HTTP trigger service was
  never part of the release but shipped in the tarball, with `express` as a runtime dependency that
  nothing else in the package uses. `package.json` `files` now excludes the file and `express` is a
  devDependency, so `npm install the-high-council` pulls one dependency fewer of its own. The file
  stays in the repository and `npm run http-server` still works from a clone (after `npm install`).
  `test/package.test.js` checks the tarball for the file and every shipped file for an `express`
  import.

### Fixed

- **`council fence` refuses a file whose name holds a control or bidi character.** A file name with
  a line break in it (legal on Linux and macOS) wrote a line of its own into the fenced block; when
  that line was a backtick run it closed the fence early, so the rest of the file read as task prose
  and the task prose after it read as fenced source. Names with C0/C1 control characters (line
  breaks included) or bidi embeddings, overrides or isolates are now refused with an error naming
  the file. Bidi and zero-width characters inside a file's content are still sent, since real
  source has them, but `council fence` now counts them in its summary line. Found by a hostile-name
  test matrix (`test/hostile-strings.test.js`).
- **The local run viewer (`npm run ui`) answers only `Host: 127.0.0.1:<port>` or
  `localhost:<port>`.** Listening on 127.0.0.1 keeps other machines out, not other web pages: a page
  that points its own host name at 127.0.0.1 (DNS rebinding) could read the viewer's API, and a
  run's texts can hold fenced private source. Any other Host header now gets `403`.
- **Fenced source can no longer set the task's `signoff:`, `target_file:` or `label:` line.**
  These fields were read from any line of the task file, fenced blocks included. A fenced file with
  a `signoff: <name>` line satisfied a policy's `required_signoff_paths` for a change the operator
  never signed; a fenced line `target_file: <other path>` above the real one hid it (the first
  occurrence wins); and a fenced YAML file's `label:` line renamed the run. The three fields are
  now read from the task's own prose only. A change request written inside a code block is
  therefore no longer read as one: write the fields as plain lines. Likewise `council fence` now
  writes its "Source, fenced verbatim" header unless the real header is already there, not when a
  fenced file merely quotes it. Found by a new hostile fenced-file corpus
  (`fixtures/hostile-fenced/`, `test/hostile-fenced-corpus.test.js`: forged fence headers,
  verdict and sign-off lines, fence-breaking lines, homoglyphs, bidi, base64, notes to reviewers,
  an over-limit line). What is sent to the seats is unchanged.
- **A run started with `--allow-unfenced` can be resumed without it.** The artifact gate runs again
  on every resume, but the waiver was read from that sitting's command line only, so the first
  resume without the flag stopped at exit 9. That was every MCP resume: `resume_run` and
  `submit_stage` cannot pass it. The waiver (whole-gate or a file list) is now saved in `run.json`
  and applied on resume; a flag given on a resume replaces it. The same resume also deleted a
  capped run's `STOPPED-budget.json`, `report-partial.json` and `BOARD-partial.md` before the gate
  refused it, so a blocked resume lost the stopped run's record; they are now deleted only once the
  gate has passed. Reported by the 2026-09-26 bug audit (#1).
- **`src/http-server.js` (not part of the release, but in the package): a path-shaped
  `idempotencyKey` could write the task file outside its temp directory.** `POST /runs` now
  refuses any key outside `[A-Za-z0-9_-]{1,128}` and any chain name that is a path, with
  `400 malformed_request`, before anything touches the disk. Reported by Socket.dev's AI scan of
  the published 0.7.7. The endpoint needs its bearer token, so only a holder of the token could
  have used it.

- **Resuming a relay-panel run no longer pays for its finished review round again.** The relay
  panel's order was drawn at random on every sitting, and a relay reviewer's prompt holds the
  verdicts before it, so a resumed run saw different prompts, set the finished panel stages aside
  as stale and re-ran them. The order is now derived from the run id and the round: it still
  changes from round to round, and a resume replays it. A new test resumes every mock chain after
  an external pause or a spend-cap stop and fails on any stale stage, and another keeps unseeded
  randomness out of `src/chain.js` and `src/roles.js`. Reported by the 2026-09-26 bug audit (#2).

- **`--rematch` and `--replay` refuse a run that was given `--criteria`.** Both re-run from the
  task text alone. They already refused a run that used `--context`, `--draft` or `--from-run`, but
  a run's hand-written `--criteria` were silently dropped and a criteria seat wrote new ones, so any
  difference in the verdict could come from the criteria rather than the panel. Refused before any
  call, exit 2. Reported by the 2026-09-26 bug audit (#3).

- **MCP: every external stage a run waits on can be answered.** A panel of external critics (or
  external proposers) pauses for all of them at once, but `external_prompt` named only the first
  and `submit_stage` accepted only the first, so the others could not be answered over MCP.
  `external_prompt` now lists every waiting stage under `waiting` and takes an optional `stage` to
  return that one's prompt; `submit_stage` accepts any waiting stage and resumes the run only once
  none is left (until then it answers `resumed: false` with the stages still waiting). Reported by
  the 2026-09-26 bug audit (#4).

- **A run the spend cap stops at the ambiguity or questions stage writes `report-partial.json`.**
  The record of the run so far was built from a value that did not exist yet at those stages, the
  error was swallowed, and the stopped run left no `report-partial.json` or `BOARD-partial.md`.
  Reported by the 2026-09-26 bug audit (#5).

- **The argued stage's contract names the headings the argued prompt asks for.** The stage
  contract (read by `prepare_stage_prompt`, the resume brief and the completeness check) kept its
  own list of headings, which had drifted from the prompt: it required "The objections that changed
  the plan" where the prompt asks for "The objections and how the authors answered". It now uses
  the argued module's own list. The argued prompt itself is unchanged. Reported by the 2026-09-26
  bug audit (#6).

### Security

- **MCP `start_run` checks every file it hands the CLI.** `task` and `draft` were checked against
  the secret/credential denylist only, and `context` and `from_run` not at all, so an MCP client
  could have a file such as `.env`, or one outside the project, appended to every seat's prompt.
  All four inputs, and each file inside a `context` folder or a `from_run` run folder, now go
  through the denylist and must lie inside the working directory (symlinks are followed before the
  check). Paths outside it are refused, including absolute ones. Outside `tasks/`, `runs/` and
  `context/` a gitignored file is refused as well. The CLI now reads each `--context` file with a
  2 MB limit and refuses a file that is not a regular file (a FIFO or a device), with exit 2 and
  the file's name, before any call. Reported by the 2026-09-26 security scan.

- **The local run viewer (`npm run ui`) reads run folders only.** A run id in its API is now
  accepted only in the exact run-folder shape the MCP tools use, and only when the folder's real
  path is directly inside `runs/`; before, an encoded path could read `.md`, `run.log` and
  `report.json` files outside it. A request line the server cannot parse is answered `400` instead
  of stopping the viewer, and the page now escapes every value it shows from a run folder, numbers
  from `report.json` included. The viewer also honours `COUNCIL_WORKDIR`, like the MCP server.

- **The spend cap no longer trusts a provider's usage numbers blindly.** A token count that was
  not a finite number of zero or more (a string, a negative, an overflowing value), or a reply with
  no usage at all, could turn a stage's cost into something no ceiling comparison ever breaches,
  and the run then continued past its cap. Such usage is now recorded as zero tokens and charged
  toward the cap at that call's projected worst case, with a line in the log. A stage's cost read
  back from disk on resume is checked the same way. Well-formed usage is priced exactly as before.

- **A chain is chosen by name only.** MCP `dry_run` and `start_run`, the CLI's `--chain`, and the
  chain a `--resume`, `--rematch` or `--replay` reads back from `run.json` now accept a chain name
  (letters, digits, `.`, `_`, `-`, not starting with `.` or `-`) and refuse anything else with a
  usage error (exit 2 on the CLI). Before, a path-shaped value could load any JSON file as a chain,
  and a value starting with `--` was read as a flag. `council doctor --chain <file>` still takes a
  path, as documented.

- **A provider's API key is sent only to that provider's own host.** A keyed seat (`openrouter`,
  `openai`, `mistral`, ...) with a `baseUrl` sends that provider's key there. The existing
  `baseUrl` check only asks whether an endpoint can be shown to avoid a denied model, so it
  accepted a loopback address or another lab's API for any seat, and the key went along. A new
  chain-lint rule, `key-host`, now refuses a keyed seat whose `baseUrl` is not its own provider's
  API host over https; the CLI lints before every run and every resume, so the seat is refused
  before any call. Local and self-hosted servers stay on `ollama` seats, which send no key unless
  `OLLAMA_API_KEY` is set, and keep loopback and private-network addresses. A local proxy in front
  of a keyed provider can be allowed from the environment only, with
  `COUNCIL_ALLOW_LOOPBACK_KEY_HOST=1` (loopback addresses only). Every shipped chain lints clean.

- **Model text is printed without control characters.** Log lines quote what the seats wrote
  (verdict lines, objections, answers), and a reply holding a terminal escape sequence, a carriage
  return or a bidi override reached the terminal and `run.log` as written. The CLI's log output now
  drops C0 and C1 control characters (newline and tab are kept) and bidi controls, for runs,
  resumes, `--rematch`, `--replay`, the demo and `init`. Stage files and everything sent to a seat
  keep the text exactly as it was.

- **The opt-in `run_tests` seat tool runs test files only.** With `tools.seat_requests` on, a
  seat's `run_tests` request ran any readable file in the workspace under Node, a run folder's
  saved model output included. The file must now be a `.js`, `.mjs`, `.cjs` or `.ts` file (by its
  real name, so a symlink named like a test does not count), and nothing under `runs/` is run.
  `run_tests` with no file is unchanged.

## 0.7.7 - 2026-09-25

Everything since 0.7.6. The summary comes first; the detailed notes follow under "Detail". This
release makes no claim that a council's output is better than a single model's: nothing like that
has been measured.

### Breaking changes

- **Deep imports are blocked.** `package.json` now has an `exports` map, so only the package root
  (`import ... from 'the-high-council'`, the new JS API below) and `the-high-council/package.json`
  resolve. An import such as `the-high-council/src/chain.js` now fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. The `council` command, `npx the-high-council` and the MCP server
  (`--mcp`) are unaffected. Code that imported a file under `src/` directly should move to the JS
  API, or pin 0.7.6.
- **`report.json`'s `task` and `fromRun` are never absolute paths.** After `--resume`, `--rematch`,
  `--replay` and `council init`, `task` used to be the absolute path from `run.json`
  (`/home/<user>/...`); `fromRun` was absolute on every resumed run, and on any run given an
  absolute `--from-run`. Both are now relative to the directory the run was started in
  (`run.json`'s `cwd`), or the file or run folder's name alone when it lies outside it. Code that
  opened either path from `report.json` must resolve it against that directory. `run.json` still
  keeps the absolute paths, for resume.

### Added

- **`report.json` is a versioned, published format:** `schemaVersion: 1` and
  `schemas/report-v1.json` (JSON Schema 2020-12, shipped in the package), every field described and
  marked `stable` or `experimental`. Additive fields in the same release: `producer`
  (`{ name, version }`), `started_at`, `finished_at`, `task_sha256`, `signoff[].lab`, and
  `reason_code` on alternatives dropouts. `signoff[].provider` (which has always held the lab) and
  `alternatives.dropouts[].reasonCode` stay as deprecated aliases until a schema version 2. See
  `docs/report-format.md`.
- **More ways in:**
  - An MCP Registry entry: `mcpName` (`io.github.muad-yasin/the-high-council`) in `package.json`
    and a `server.json` for the registry. The registry checks `mcpName` against the published npm
    version, so the listing can only follow this version's publish.
  - A Claude Desktop bundle: `mcpb/manifest.json` and `scripts/build-mcpb.sh` build a `.mcpb`. For
    it the MCP server gained `COUNCIL_WORKDIR` (where `tasks/` and `runs/` go) and
    `COUNCIL_MAX_USD_LIMIT` (a ceiling the tool arguments cannot lift or remove), reads a leftover
    `${user_config.x}` placeholder as unset, and starts its CLI child with the running Node, not
    whatever `node` is on `PATH`.
  - A JS API, the package's main entry: `run`, `resume`, `price`, `readRun`, `listRuns`,
    `listChains`, `version`, with TypeScript types in `types/`. Every run goes through the CLI as a
    child process, so the spend cap, the key check and the run lock apply exactly as on the
    command line. `runChain` is deliberately not exported.
- **The first ten minutes:**
  - `council doctor` ends with a "Start here" block: the $0 demo and `init`, the shipped chains one
    key runs on its own (with worst case and panel size), and how to price before paying. The
    `schemaVersion` warning is printed once, not under every chain.
  - Hints name `npx the-high-council ...` when the CLI was started through `npx`.
  - A refused key (401/402/403) says what to check and names the environment variable; a local
    model server that is not running says so and how to start it; `doctor` flags Ollama chains and
    warns when git would commit a `.env`.
  - `--dry-run --task` reports the task's size and prices again when the task is bigger than the
    estimate assumes; a run whose worst case is above its cap says so before the first stage.
  - README: "Your first ten minutes" and "Words used here"; TROUBLESHOOTING: a first-run section.
- **Checkable criteria (opt-in, off in every shipped chain except the offline
  `mock-criteria-kinds`):** `criteria_kinds: { enabled: true }` has the criteria stage mark each
  criterion `checkable` (with the check and whether it runs on the plan or the build) or
  `judgement`, flags vague ones, and records a critic's MET on a checkable criterion given with no
  evidence. `council --criteria <file>` takes hand-written criteria through the same guards.
  `report.json` gains `criteria_kinds`, `criteria_summary` and `criteria_met_without_evidence`.
  With the flag off, prompts and `report.json` are unchanged.
- **A run the spend cap stops leaves `report-partial.json`.** A capped run writes no
  `report.json`, so a premium-7 run stopped after 11 rounds left nothing machine-readable: its
  proposals, debate, per-round verdicts and costs had to be rebuilt from about 300 stage files.
  Now the stop also writes `report-partial.json` (the same schema, built by the same function from
  what the run had, plus the experimental `partial: true`, `stoppedBy: "budget"` and
  `stoppedAtStage`) and `BOARD-partial.md`, and `STOPPED-budget.md` points to it. `report.json`
  still means "finished": status, `--spend`, the JS API and the MCP server read a capped run
  exactly as before. A `--resume` deletes the partial files with the stop marker. Capped
  `--rematch` and `--replay` folders and descending-mode runs get them too. See
  `docs/report-format.md`.
- **Several external seats in one stage pause together** and **"How this plan was argued"
  (opt-in, off everywhere)**: see Detail.

### Fixed

- A descending-mode run's `report.json` lacked `questions`, `scoreboard`, `orphanSections` and
  `withdrawalCycles`; they are now `null`, `null`, `[]` and `0`.
- `ajv`, which four test files import, is a declared devDependency; it used to arrive only through
  the MCP SDK.

### Detail

#### `report.json` is a versioned, published format

`report.json` now starts with `schemaVersion: 1`, and its shape is published as a JSON Schema
(draft 2020-12) in `schemas/report-v1.json`, which now ships in the npm package. Every field has a
description, and every top-level field is marked `stable` or `experimental`. The version is an
integer and changes only on a breaking change. New fields are added without a bump, and readers
ignore fields they do not know. A report with no `schemaVersion` was written by an earlier version
and reads as 1. `test/report-schema.test.js` validates real offline runs of the 13 shipped mock
chains that finish in one sitting (all but `mock-external` and `mock-questions-wait`, which pause for
a person, and `mock-budget`, which stops at its cap and writes no report), one `mock-external` run
answered and resumed to the end, a descending-mode run, and one run with every optional stage
turned on. It also fails if a writer emits a top-level field the schema does not document. Details:
`docs/report-format.md`.

#### Several external seats pause together

A stage that asks several seats at once (panel, proposals, alternatives, debate) now writes one
`NEEDS-<label>.md` per external seat that paused, instead of surfacing only the first and pausing
again on the next after each resume. A panel of seven external seats used to need seven resumes per
round; now the operator answers all of them, in parallel if they like, and resumes once. Answering
only some pauses again on the rest. A budget stop that settled first still wins exactly as before.
`waitingStages()` already listed every open NEEDS file, so `run_status` and the resume brief needed
no change.

#### "How this plan was argued" (opt-in)

Muad, 2026-09-23 ("let's do #3"): the labs' arguments are part of the product, for beginner
developers too. A new opt-in flag, `argued: { enabled: true }`, **off by default and enabled in no
shipped chain** - that is his call after he has seen `maintainers/examples/argued-example.md`, which
is rendered from a mock run only. No claim is made that the section helps anyone; research intake 2
files its usefulness to beginners as an inference.

- **One stage, `argued`, after the handoff, on the handoff seat** (the builder when there is none).
  In the plan-7 chains that seat is the external Claude Code session, so the stage adds no API
  call; a billed seat goes through `invoke()` like every free-text stage (spend cap, denied-model
  check, the cut-off retry) and `--dry-run` prices an `argued` row.
- **Written to `ARGUED.md`, never into the deliverable.** The plan is what gets scored, reviewed and
  built; a narrative naming proposal ids inside it would be read as plan content.
- **Facts only.** `src/argued.js` builds a fact pack from the run's own record - alternatives and
  their debate, the plan's "Decisions" section verbatim, up to five objected proposals (each with
  every objection raised on it and its author's replies, ranked by a withdrawal, then an amendment,
  then a part the plan cut), declined objections, unresolved dissent and `dispute.review`, and each
  lab's counts and final verdict. Canary posts are excluded. An author replies to a proposal, not
  to one objection, so the pack and the prompt never state that an objection caused a withdrawal.
  The only citable ids are the ones a reader finds in BOARD.md and the plan (proposal and
  alternative ids, lab names, `DECISIONS`). The prompt requires a cited id on every claim and
  "Nothing recorded." for an empty section.
- **A reference check.** Every id and lab the section names is checked against the fact pack;
  anything the run never had lands in `WARNINGS.md` (`argued_unknown_ref`, `argued_unknown_lab`,
  `argued_missing_lab`, `argued_missing_section`) and in `report.json`. The text is kept as written.
- **Additive.** A new `report.json` field `argued`, present only when the flag is on. With the flag
  off nothing runs and every prompt is byte-identical (`test/argued.test.js` pins each stage's
  prompt hash on vs off). chain-lint: `argued` takes only `enabled` (schema and rule 5b), and
  `argued-with-descending` refuses the pair, where the stage would silently not run.

## 0.7.6 - 2026-09-23

Everything since 0.7.5. The summary comes first; the detailed notes, in the order they were
written, follow under "Detail". This release makes no claim that a council's output is better than
a single model's: nothing like that has been measured.

### Breaking changes

These can stop a chain, a script or a setup that worked with 0.7.5.

- **The `xai` provider is removed** (`84627c5`): adapter, alias, price and example key. A chain
  with `"provider": "xai"` no longer runs.
- **New hard lint errors, refused again at run time. None of them has an opt-out except where
  noted:**
  - `denied-model`: xAI/Grok, Kimi/Moonshot, and router ids that could pick them
    (`openrouter/auto`, `pareto-code`, `*-router`, suffixed forms such as `openrouter/auto:nitro`,
    `@preset/...`). It also covers the same ids anywhere under a seat's `extra`, and a `baseUrl`
    whose host is a denied lab's or unknown (`3a4a9d9`, `deec2ac`, `e355975`).
  - `self-review`: a builder or reviser whose model or lab also sits on the panel that grades it
    (`1c86993`, `a707ad2`). `"selfReview": "allowed"` at the top level waives it.
  - `duplicate-lab`: two seats of one lab in a stage whose cache labels are per lab (`19a251d`,
    `0f950fe`).
  - `invalid-max-rounds` (`7713d22`).
  - `role-without-debate`: a `role` on the debating seats of a chain that has no `proposals`
    stage or does not enable `debate`, where the role would never be heard (`9be005a`). No
    shipped chain is affected.
  - **Closed flag blocks.** `decisions`, `alternatives`, `lints`, `canary` and `ambiguity_union`
    now reject unknown inner keys, so a typo such as `"enable": true` is an error, not a silently
    skipped stage (`3568e3c`).
- **`--rounds` must be a whole number of at least 1.** `--rounds 0`, `abc` or `1.5` exits 2
  (usage error) instead of running (`7713d22`).
- **Exit codes.** 0.7.5 used 0-6. Codes 7-17 are new, and guard refusals that used to share 1, 2, 5
  or 6 now have their own:
  - 7/8: security review blocked, or could not judge.
  - 9: artifact gate.
  - 10: preflight.
  - 11: PII gate.
  - 12: `policy.json`.
  - 13: run locked.
  - 14: task changed without an amendment.
  - 15: resume of a finished run.
  - 16: unexpected error (`STOPPED-error.md`).
  - 17: a draft cut off at its token cap (`STOPPED-truncated.md`).

  Scripts that tested for 1, 5 or 6 need updating. The README's CLI section lists every code.
- **`outcome` for stated passes.** A seat's stated pass (`freedoms.pass`) now counts as an
  abstention, and a run on which no reviewer was heard is `degraded`, not a disagreement
  (`52a66cc`, `1d13f2b`).
- **A finished run can't be resumed.** `--resume` of a run folder that has a `report.json` exits
  15 without running or spending anything (`b795d70`). A `--rematch`/`--replay` folder can't be
  resumed either (`893759e`).
- **Other defaults that changed:**
  - The default spend ceiling is $7 (was $5) (`40c1618`).
  - The round cap is 7 (`9f5df20`).
  - `verifyAuditLog` refuses a log with no closing line unless `allowUnclosed` is passed
    (`2789f85`).

### Added

- **Chains:** `cheap-7`, `cheap-7-v2`, `plan-open-7` and `plan-premium-7`. Shipped rosters are
  refreshed, and Grok and Kimi seats are removed.
- **Stages, all opt-in per chain:**
  - The final security-review gate.
  - A preflight stage and post-build verify.
  - A cold-reader coherence check.
  - A dispute stage for unresolved dissent, and `dispute.review`.
  - Decision records.
  - A blind whole-architecture alternatives stage.
  - A canary (sampled, recorded, never applied).
- **Commands:**
  - `council fence`: the human picks the source the labs see.
  - `--rematch` and `--replay`.
  - `export-board` renders the alternatives stage.
  - `--forecast-cost`.
  - `council --version`.
- **Other:**
  - The patch-mode reviser.
  - A per-seat panel token cap.
  - Context partitioning for proposal seats.
  - A chain JSON Schema with `schemaVersion`.
  - Claude Code plugin packaging and standalone binaries.
  - Generic skills in `skills/` (not part of the npm package).
- **MCP:**
  - `start_run` takes `pii_gate` and `allow_unfenced`.
  - The server reports the package version.
  - User chains in `./chains` are listed.

### Changed

- **Internal project documents moved into `maintainers/`** (`79667d0`): `HANDOFF.md`,
  `DECISIONS.md`, `PROGRESS.md`, `STATUS-LEDGER.md`, `ideas/` and `proposals/`. They were never in
  the npm package, and the package's file list is unchanged; `maintainers/` is refused in the
  tarball by test.

### Fixed

- **Consent:**
  - An unheard, cut-off or unreadable reviewer never counts as consent.
  - A cut-off critic reply gets one retry with a bigger cap, and a retry never shrinks the cap.
  - A reasoning-only stop far under the cap abstains (`REASONING_EXHAUSTED`).
- **The spend cap:**
  - It's no longer swallowed by a catch.
  - Parallel calls reserve before they run.
  - `--rematch`/`--replay` are capped.
  - `STOPPED` markers and totals show true spend.
  - A call billed but failed, and a discarded Anthropic thinking attempt, are written to disk as
    charges, so `--spend`, the report totals and the cap on resume count them (`2472676`).
- **Resume:**
  - A cached stage replays only if it answered the same prompt.
  - One process per run.
  - Paths resolve from the start directory.
  - The PII gate and `policy.json` are re-applied on every sitting.
  - Only the latest amendment covers a changed task.
  - A cached entry with no record of the inputs it answered (anything from before `9733a8d`) is
    stale: re-run, or for an external stage set aside and asked again. Entries from between the
    two cache fixes replay but are recorded as `cache_unverified` (`daeb96f`).
- **The reviser:**
  - Its "Disputed" rebuttals no longer leak into the graded draft.
  - Critic text can't escape its tag.
  - Quotes reach the reviser.
- **Criteria guards:** criteria that describe the criteria list, or can't be checked, are caught
  before any paid round.
- **Personas:** a personas-file entry with no name or voice no longer puts "undefined" into a
  debate prompt (`9be005a`).
- **MCP `start_run` and `resume_run`** report `started:false`/`resumed:false`, with the exit code
  and log tail, for a run that stopped at startup. They wait for the child to exit, or to hold the
  run lock and write its first `state.json` (past every startup refusal), not for a fixed window
  (`2472676`, `814e741`, `81e5579`).
- **Many smaller fixes from the 2026-09-20 to 09-23 audits.** Details below.

### Security

- **One list of secret formats** (`src/secret-patterns.js`) for the artifact scanner, the PII gate
  and tool/fence redaction. The scanner used to miss OpenRouter keys. It now covers Groq, Hugging
  Face, Together, Z.ai, Bearer tokens, PGP blocks and URL passwords.
- **No Grok by another route:**
  - A seat's `extra.model` can no longer override the checked model.
  - A seat's `baseUrl` is checked.
- **Tools and fence:**
  - Sandboxed tools never return secrets or gitignored files.
  - The fence redacts before it truncates.
  - `grep_repo` checks the real path.
- **The MCP server:**
  - `plan_outline` is confined to Markdown files in the working directory.
  - `start_run` refuses denylisted task paths.
- **The audit log** detects a cut-off end. Without an HMAC key (the default), it doesn't detect a
  full rewrite; the README's Known limits says so.

### Detail

#### repository layout: internal docs in maintainers/

The internal project documents moved out of the repository root into `maintainers/`: `HANDOFF.md`,
`DECISIONS.md`, `PROGRESS.md`, `STATUS-LEDGER.md`, `ideas/` (the idea matrix and its two PDFs) and
`proposals/` (one design proposal that was tracked inside the gitignored `Review/`). User-facing
files stay at the root. None of these was ever in the npm package, and the package's file list is
unchanged. `test/repo-hygiene.test.js` keeps `runs/`, `tasks/`, `.council/`, `Review/` and
`.idempotency/` gitignored and the moved documents out of the root, and `test/package.test.js`
refuses `maintainers/` in the tarball.

#### a cut-off draft never ships; stricter amendments; alternatives in the HTML board

From the 2026-09-23 pre-release audits (`Review/PreRelease_Audit_revise`, `_contract`).

- **A truncated draft stops the run (exit 17).** Every stage whose reply becomes the deliverable
  (build, revise, the dispute pass, the challenge and allocator revisions, the final edit, the
  handoff) is checked for a cut-off: the provider's `length`/`max_tokens` stop, or no stop reason
  and the whole cap used. A cut-off reply is retried once with a bigger cap (the panel's
  `cutOffRetryCap` rule) under `<label>-retry`; if that is cut off too, or the seat is external,
  the run stops with `STOPPED-truncated.md` and no `report.json` or `deliverable.md`. Before this,
  a truncated final edit became the shipped deliverable with no review after it.
  `partial-deliverable` also warns on a cut-off reply and on free text that ends mid-structure
  (an unclosed code block, an unfinished table row, a trailing heading or empty list item).
- **Amendments: only the latest entry counts.** A task change is covered only when its hash is the
  target of `AMENDMENTS.md`'s latest entry; reverting to a hash an earlier entry mentioned now needs
  a new entry of its own.
- **`council export-board` renders the alternatives stage**, escaped like the rest.
- **Patch-mode critics see whole changes:** `changedSince()` fences each edit with a fence longer
  than any backtick run in it, so a fenced snippet inside a patch no longer closes its block early.

#### pre-release audit fixes, batch 3 (security)

- **One secret-pattern list.** `src/secret-patterns.js` is now the only list, used by the
  task/artifact scanner (`council doctor --scan-artifacts`), the PII gate (`--pii-gate`) and
  tool/fence redaction. The scanner never matched an OpenRouter key (`sk-or-v1-...`), so the PII
  gate let one through. New coverage: Groq, Hugging Face, Together and Z.ai keys (the whole key, not
  just the part before the dot), Bearer tokens, PGP private-key blocks, camelCase names
  (`AccessToken`, `openAiApiKey`), and URL passwords with an empty user (`redis://:pw@`). A URL
  password is now cut from its own position, never from a matching run inside the user name.
  `test/secret-patterns.test.js` runs one fake key per provider format through all three.
- **No Grok, no bypass.** A seat's `extra` is now spread before `model`/`messages`/the token cap,
  so `extra.model` can no longer replace the model the denied-model check approved. The check also
  refuses a denied or router id under `extra.model`/`route`/`provider`/`models`/`plugins` (any
  depth), router ids with a suffix (`openrouter/auto:nitro`), and server-side presets
  (`@preset/...`).

- **Descending chains keep their security gate.** It reviews the final stack once, and its
  result (exit 7/8, `report.json`) now reaches the CLI. The panel, dispute and outage records are
  forwarded too.
- **The PII gate and `policy.json` apply on every resume.** `--pii-gate` and `--allow-pii` are
  saved in `run.json` and re-applied with a fresh scan on each sitting (context and draft are
  re-read). The policy is evaluated on every sitting, not only the first.
- **The security gate never passes a "pass"** whose findings list was malformed or dropped a
  finding that might have been blocking.
- **Tools.** `check_versions` redacts credentials inside dependency specs. `grep_repo` checks the
  denylist against the real path, as `read_file` does. The tool-call log is written to the run
  folder as `TOOLS.md`, with the real size of each answer.
- **The builder sees the skeleton** when the alternatives board is on, since it is told to build
  on the architecture the skeleton chose.
- **No Grok through `baseUrl` either.** A seat's `baseUrl` decides where the request goes, and
  it was never checked. It is now refused if its host is the xAI domain (or a subdomain), names a
  denied model or a router, or is not a known provider's API host. Loopback hosts stay allowed
  (local models), as do private-network hosts for `ollama` seats. The check runs in lint and at
  run time.
- **Fence parity.** Fenced blocks are parsed by opening and closing fence length (CommonMark), and
  `council fence` writes a fence longer than any backtick run in the file. A fenced file with its
  own ``` example no longer turns the task's prose into "source", so a quote of that prose can no
  longer show as verified. Task front matter saved with CRLF line endings is read.
#### pre-release audit fixes, batch 1

Fixes from the 2026-09-23 pre-release audits (reviser prompts, alternatives stage, canary probe).
Each has a regression test that fails on the previous code (`test/prerelease-batch1.test.js`,
`test/alternatives.test.js`, `test/canary.test.js`).

- **A declined objection has one channel again.** The reviser prompt told it both to add a
  "Disputed" line at the end of the draft and to write `DECLINED:` lines (stripped before grading).
  Only `DECLINED:` was stripped, so a "Disputed" paragraph could stay inside the graded draft, with
  `disputes` empty, and reviewers could credit it as honest dissent. The "Disputed" rule is gone,
  and `parseDisputes` also strips a trailing Disputed block into `disputes`.
- **Critic text stays inside its tag.** The criterion now sits inside `<critic-claim>`, and seat
  text can no longer close `<critic-claim>`/`<prior-review>` early or plant a top-level `#`
  heading. The reviser and the dispute stage now see each objection's quote and its checked status
  (verified / unverified / unquoted).
- **Alternatives: no hidden 3000-token cap.** Each seat keeps its own `maxTokens` (a chain can
  still set `alternatives.maxTokens`). A reply cut off at the cap is retried with a bigger cap,
  and a lab that stays cut off drops out labelled as truncation, not "unreadable".
  `plan-premium-7`/`plan-open-7` drop their `maxTokens: 3000`. The dry-run now prices each
  alternative at the seat's cap, so the worst case rises.
- **Canary probe.** The injected objection no longer tells the author it is a probe, and its
  poster shows under a normal anonymised label (it rendered as "undefined"). What it is lives only
  in data (`canary: true`, `canary.note`). The roll is one decision per run, seeded by the run id
  and the same on every resume, and a canary reply already paid for is always replayed. Canary
  posts no longer leak into `disagreement_groups`, `council digest` or `export-board`. A guard test
  checks every reader of `debate.posts`.
- **Honest dissent after an outage.** If no reviewer could be heard in a round, the dispute
  record says so (`reason: "no_heard_reviewer"`, the real stop round). Older objections are carried
  with `unheard_in_final_round`/`last_raised_round` and shown as possibly out of date, never as
  current objections to the latest draft.
- **Shared labs are caught in every lab-keyed stage**, now including the alternatives stage,
  `preflight.seats` and descending critics. A guard test fails if a new lab-keyed stage label is
  added without a matching check.
- **Unknown `signoff` values are refused** by lint and at run time. Only `first` and `unanimous`
  exist. Before, `"quorum"` or `"Unanimous"` quietly ran as `first`.
- **The dry-run worst case includes** the dispute rewrite, each dispute review and the canary
  reply.
- **Board text cannot fake structure.** Seat-written fields on the proposal and alternatives
  boards cannot start a heading or a board line. `merge_with`/`replaced_by` keep only a real id on
  that board.
#### decision records and whole alternative architectures

Two opt-in planning structures, both from the 2026-09-23 research intake and both approved by the
author ("a great idea", "another great idea"). Mechanism only: **no efficacy claim** - nothing here
has been measured.

- **Decision records** (`decisions: { enabled: true }`). The builder must write a "Decisions"
  section: each major architecture decision with its context, at least two real options (a
  strawman does not count), the trade-offs, the choice, why the others lost, and what would change
  the call. The criteria seat adds a matching criterion, so reviewers check for real alternatives;
  the reviser keeps records true and may not delete one to dodge an objection. Absent the flag,
  every prompt is byte-identical to before.
- **Whole alternative architectures** (`alternatives: { enabled: true, maxTokens? }`). Before the
  skeleton, every proposer lab writes ONE whole architecture blind (name, shape, key trade-offs,
  what it is bad at); the labs then debate them in the same anonymised post/reply format proposals
  use. The skeleton names the architecture it builds on; the builder records every alternative in
  the Decisions section (the stage switches decision records on). Stable stage labels
  (`alternative-<lab>`, `alt-debate-<lab>`, `alt-reply-<lab>`) for resume and the stage cache;
  every call goes through `invoke()`, so the spend cap and the denied-model check apply; `--dry-run`
  prices the stage. `report.json` gains an additive `alternatives` field and `BOARD.md` an
  "Alternative architectures" section, both absent on chains without the stage. No persona in the
  alternatives debate: seat roles stay at their one call site, the proposal debate.

#### Opus 5 and Sonnet 5 pricing corrected

`src/pricing.json` listed `anthropic/claude-opus-5` at $15/$75 and `anthropic/claude-sonnet-5` at
$3/$15 per million tokens. Anthropic's pricing page (checked 2026-09-15) lists $5/$25 and $2/$10;
Sonnet 5's $2/$10 launch price became its standard price, and the planned rise to $3/$15 did not
happen. Both entries are corrected, so `--dry-run` estimates, the spend-cap projection and run
cost reports for these seats now match list price instead of overstating it about threefold
(Opus) and 1.5-fold (Sonnet). No other price changed; the Fable 5.1 and Haiku 4.5 entries already
matched.

#### final security-review gate

An optional last stage, `security-review`, that runs after build, `verify_post`, every critic and
revise round, the final edit and the handoff. One read-only reviewer reads the finished
deliverable and returns typed findings (severity, category, file, line, evidence, problem).
- **Gate:** any critical or high finding blocks it (CLI exit 7). No readable verdict, or a reviewer
  that says it could not judge, is `not_judged` (exit 8), never a pass. Lower-severity findings are
  still listed. The existing exit codes (5 degradable, 6 fatal) keep their meanings.
- **Config:** `security_review: { enabled: true }` is the only key; `chain-lint` rejects anything else.
- **Default seat:** `anthropic/claude-fable-5-1` (BYOK), newly priced in `src/pricing.json` at
  Anthropic's list price (## Unreleased - MLLM Coder v6 items V6-1 and V6-2: status ledger, span-tree progress records

From the v6 plan (`relay/runs/2026-09-15T15-13-25-950Z/deliverable.md`, unanimous 5/5). V6-3,
V6-4 and V6-7 deferred (the plan's own Mistral objection applies to V6-4 only) - not built here.

**V6-1.** `maintainers/STATUS-LEDGER.md` (new, tracked; at the root until 2026-09-23): a real, re-checkable status table for every v5 GUI
feature (built/partial/not started/cut) and the Project A overlap, each row citing the exact
commit and file that backs it. `test/status-ledger.test.js` re-verifies every cited path exists
at HEAD (in this repo or the named `coder-gate-agent-stub` sibling), that every status is one of
the four allowed values, and that no row reads "assumed" or "TBD" - the ledger cannot silently
drift from what it claims.

**V6-2.** `stage-log.jsonl` gains a span tree: every stage line now carries `span_id` and
`parent_span_id` (`src/spans.js`), and a `kind:"round"` summary record is appended once every
critic seat has posted for a panel round, giving `state.json`'s existing per-round polling a
matching append-only history without a third file or format. `run.json` gains `rootSpanId`,
carried forward unchanged across `--resume`. Additive only: existing stage-line fields are
unchanged, round records omit `usd` and are skipped by `sumCostFromStageLogText` so they are
never double-counted. The span-tree idea is attributed to Langfuse/LangSmith/AgentOps; none is
adopted as a dependency. No `src/chain.js` or `src/tools.js` change.
0/$50 per million tokens), so `--dry-run` and `--max-usd` cover it.
- **Local option:** any `ollama` seat works as a local/offline reviewer. Nothing has been
  measured comparing the two.
- **Invariants:** the reviewer has no tools and its reply never reaches the deliverable or a
  reviser, so critics still never write code.
- **Earlier idea:** the pre-propose security-lens critic deferred in v3 is not this. That idea
  needed a debate stage before any proposal existed; this reviews an artifact that already
  exists.
- **Output:** `report.json` gains `security_review` (additive) and the run folder gets
  `security-review.json`.
- **Tests:** `chains/mock-security-review.json` and `test/security-review-gate.test.js` run
  everything at $0. Docs: `docs/security-review-gate.md`.

#### MLLM Coder v6 items V6-1 and V6-2: status ledger, span-tree progress records

From the v6 plan (`relay/runs/2026-09-15T15-13-25-950Z/deliverable.md`, unanimous 5/5). V6-3,
V6-4 and V6-7 deferred (the plan's own Mistral objection applies to V6-4 only) - not built here.

**V6-1.** `maintainers/STATUS-LEDGER.md` (new, tracked; at the root until 2026-09-23): a real, re-checkable status table for every v5 GUI
feature (built/partial/not started/cut) and the Project A overlap, each row citing the exact
commit and file that backs it. `test/status-ledger.test.js` re-verifies every cited path exists
at HEAD (in this repo or the named `coder-gate-agent-stub` sibling), that every status is one of
the four allowed values, and that no row reads "assumed" or "TBD" - the ledger cannot silently
drift from what it claims.

**V6-2.** `stage-log.jsonl` gains a span tree: every stage line now carries `span_id` and
`parent_span_id` (`src/spans.js`), and a `kind:"round"` summary record is appended once every
critic seat has posted for a panel round, giving `state.json`'s existing per-round polling a
matching append-only history without a third file or format. `run.json` gains `rootSpanId`,
carried forward unchanged across `--resume`. Additive only: existing stage-line fields are
unchanged, round records omit `usd` and are skipped by `sumCostFromStageLogText` so they are
never double-counted. The span-tree idea is attributed to Langfuse/LangSmith/AgentOps; none is
adopted as a dependency. No `src/chain.js` or `src/tools.js` change.

#### Claude Code plugin packaging

The repository root is now also a Claude Code plugin and its own one-entry marketplace:
`.claude-plugin/plugin.json` registers the existing MCP server (`node
${CLAUDE_PLUGIN_ROOT}/src/mcp/server.js`) and the default `skills/` scan picks up every skill, with
no new functionality. Install with `claude plugin marketplace add muad-yasin/the-high-council-mcp`
then `claude plugin install the-high-council@the-high-council`; Claude Code runs `npm ci` in its
own cached copy, which is why `package-lock.json` must stay committed. The server is declared inline
rather than in a root `.mcp.json`, which every clone would also load as broken project MCP config.
`test/claude-plugin.test.js` pins the manifest's version to `package.json` and checks what the
install depends on. `claude plugin validate --strict` passes on the marketplace; on the plugin it
reports one warning, that the root `CLAUDE.md` is not loaded as plugin context, which is intended.

#### coder-gate v5: disagreement groups, policy capabilities, citations, seat boundary

From the v5 plan (`relay/runs/2026-09-15T03-43-44-216Z/deliverable.md`, signed off 4 of 5 - the
fifth lab never returned a verdict because of a provider credit error, not an objection). Items 4,
5, 6 and 8 here; items 1-3 are built separately. Every `report.json` change is additive.

**`disagreement_groups` in `report.json` (item 4).** For runs that debate: one entry per proposal
that drew an objection or a merge, ordered by proposal id, with its title, author lab, outcome
(kept / amended / withdrawn) and the posts under it - the "where they disagree" view, grouped by
what is argued about rather than by time. It groups at proposal level, because `debate.posts[].on`
names a proposal and nothing finer. A finer per-claim tag is deferred: it would need a prompt change
and a third `src/chain.js` edit, and free-text claim names from different labs don't group. It
reopens if a front end finds a group mixing unrelated objections. Derived in
`src/disagreement-groups.js`; `debate.posts` is unchanged.

**Policy checks named by capability (item 5).** `POLICY_CAPABILITIES` in `src/policy.js` names all
seven checks (`provider-choice`, `data-residency`, `run-spend-limit`, `monthly-spend-limit`,
`chain-classification`, `priced-seats-only`, `path-signoff`). `evaluatePolicy` also returns
`checks` for the checks a policy actually configures, and a run under a policy gets a
`policy: { checks }` block in `report.json`. The list is recorded in `run.json` when the run starts,
so a resumed run reports what its first round enforced. No `policy.json` means no `policy` key. A
test fails if a new check has no capability name.

**Citations (item 6).** `docs/coder-gate-v2-differentiation.md` §3 now cites arXiv:2505.19477 and
arXiv:2510.07517 as evidence of a real risk, not as evidence that this project avoids it - including,
stated plainly, that the first paper's finding (bias amplifies in multi-agent debate) applies to the
debate stage itself. The README's Privacy section now points at the audit export's hash-chained
`audit.jsonl` and `verifyAuditLog`, which already shipped; a hash-chained log was proposed again in
the plan's research and declined as a duplicate.

**Seat permission boundary (item 8).** `docs/seat-permission-boundary.md` records why "a side seat
reaches only its own agents" holds by construction for planning seats, and that enforcing it for
build seats belongs to the coding-agent plan, not here. `test/mcp-seat-boundary.test.js` checks it
against a live MCP server: no tool's input schema names a seat or agent, and `submit_stage` refuses a
stage the run is not waiting for.

**Item 7 needs no code.** The chain a caller picks already is the dispatch shape (a debate chain or
a diff-gate chain), so the plan's proposed `shape` field was cut for having no consumer, and "swarm"
dispatch belongs to the coding-agent plan.

#### coder-gate v4: signoff wiring and eval fixtures

**`required_signoff_paths` now fires from a real run.** v3 built the check but nothing handed it
a change request, so it could never trigger. `src/cli.js` now reads the task file's
`target_file:` line and takes the signoff from a new `--signoff <name>` flag, falling back to the
task file's `signoff:` line. A task file without `target_file:` is not a change request and runs
exactly as before; a bare `--signoff` with no name is a usage error. The plan put `signoff` inside
the change request, but the shipped check reads it at the top of the policy context, so the wiring
follows the code. `test/policy-signoff-cli.test.js` covers it end to end on the offline mock chain.

**Offline eval fixtures.** `fixtures/coder-gate-eval/cases/01..10` hold ten one-hunk changes, five
that break their test and five that don't. `node scripts/eval-fixtures.mjs --self-test` makes no
model call and no network request: it checks every fixture is honest (base passes, diff applies,
result fails only when buggy) and checks the scorer against three mock verdict sets. `--verdicts
<file>` scores verdicts an operator produced by hand. This is a detection count on ten hand-written
fixtures, not a measurement of any reviewer and not a comparison between reviewers.

#### binary packaging

**Standalone binaries, buildable from a clone.** `npm run build:bin` builds a Linux binary and a
Windows `.exe` with `@yao-pkg/pkg` (exact-pinned dev dependency). `npm run build:appimage` wraps the
Linux build as an AppImage, using appimagetool 1.9.1 checked against its SHA-256. `npm run
smoke:bin` checks a built artifact from an empty directory: `council demo`, plus an MCP session
(initialize, tools/list, list_chains, dry_run, and a start_run whose mock run must finish with a
report). A new `Build binaries` workflow runs all of it on a
tag or manual trigger and uploads the three artifacts; it does not publish a release. This replaces
a prototype from 2026-09-14 that was verified once in `/tmp` and never committed.

Building it for real found two bugs the prototype's checks missed, both only inside a binary.
First, the MCP tools that start the CLI (`dry_run`, `start_run`, `resume_run`) spawned
`node src/cli.js`, which doesn't exist there, and a plain re-spawn of the binary starts as bare
Node. They now re-invoke the binary itself with the right environment, and `run_tests` uses the
`node` on PATH when packaged. Second, three leftover `await import('node:fs')` calls (in
`start_run`, `resume_run` and `--context`) threw "A dynamic import callback was not specified";
they are static imports now. Behavior from source is unchanged. `test/binary-packaging.test.js`
guards all of this offline, including a ban on dynamic `import()` in `src/`.

Not done: a test on a real Windows machine (the `.exe` is tested under Wine) and code signing.

#### skills

**Five core agentic skills** added to `skills/`, for any agent task (coding or not), including
setups where several models propose, critique, and hand off to each other: `task-scoping`,
`research-and-sourcing`, `verification-and-critique`, `context-and-handoff`,
`tool-and-action-discipline`. Built from a research pass on published agent and multi-agent failure
modes (self-correction limits, false success, reward hacking against tests, judge bias, debate
conformity, context rot, tool-interface design) plus generalizable rules from a larger private
skill library. **`backend-developer` and `frontend-developer` upgraded** with that library's
remaining general rules (state tiers, emit-after-commit bookkeeping, traced derivations, gate
invariants, stale-build and on-disk verification traps; surplus-space layout, literal design-mockup
import, input and lifecycle idempotency, multi-shape verification). New catalog `skills/README.md`
and presentation page `docs/skills.html` (script-free, self-hosted fonts), both checked against the
real `skills/` folder by `test/skills-catalog.test.js`. No efficacy claim is made for any skill.

## 0.7.5 - 2026-09-14

Two batches merged same day as 0.7.0, both continuing the "7.x" generation (naming note: an
earlier task file in the private planning repo called part of this "v8" - it does not ship under
that name anywhere in this repo, by explicit instruction). Versioned 0.7.5 per the author's own
call, not strict semver - "7.x" in prose refers to the generation of work, matched deliberately by
the version number itself here. 516 tests, offline, no API key, no live provider call (452
baseline immediately before this entry + 64 new across both batches below).

**Enterprise-readiness MVP** (5 items, all gated, all off by default): a central `policy.json`
mechanism (allowed providers/regions, per-run and month-to-date USD caps reusing the existing
`spendReport()`, required chain tags, optional refusal of unpriced seats - fail-closed on any seat
with an undeclared region under a regional policy); a PII/secrets pre-flight gate (real mod-97 IBAN
checksum, real Luhn card check, masked/never-echoed output, `--pii-gate warn|hard-stop`); four
compliance chains (`eu-only`, `us-only`, `single-vendor-anthropic`, `single-vendor-openai`) with a
`chain-lint.js` rule enforcing that a chain's compliance claims match its actual seats, every seat
priced, and no non-EU lab in an EU-claimed chain; single-vendor routing via OpenRouter as the
reference adapter, preserving each seat's real `lab` identity so debate-independence accounting
stays correct even when multiple labs route through one billing endpoint; and a structured,
HMAC-signed, hash-chained `audit.jsonl` export per run (resume-safe - continues an in-progress
run's hash chain rather than forking it, refuses to reopen an already-closed log).

**Debate-mechanism upgrade** (6 items, all gated, all off by default): typed claim extraction
(`config.claims.enabled`) restating objections as `{claim, evidence}` checked against the real
draft text or the existing `ground_truth` array, never an invented shape; four deterministic,
$0, informational-only plan lints (`config.lints.enabled`) that never block a run; seat-requested
bounded tool calls (`tools.seat_requests.enabled`, gated by the existing `verify.tools` allowlist)
appending results to the same `ground_truth` array item 1 already produces; canary objections
(`canary.enabled`, default 10% sample rate) injected in debate and explicitly excluded from
`metrics.js`'s objection-follow-through-rate calculation, verified by its own test as the most
important assertion in that item; ambiguity-union criteria (`ambiguity_union.enabled`, three seats'
ambiguity lists deduplicated before criteria are written) and strongest-seat criteria routing
(`roster.criteria_seat`); and a minimal two-strong-model comparison chain
(`chains/plan-two-strong.json`, `roster.minimal_two_strong`), blocked by `chain-lint.js` from
coexisting with a five-seat critic roster.

No efficacy claims anywhere in either batch - both are correctness, cost-governance, and
process-honesty changes, consistent with every release before this one.

## 0.7.0 - 2026-09-14

v7 build per the council-signed plan (`relay/runs/2026-09-14T00-20-44-997Z/deliverable.md`).
Six items, each gated behind its own opt-in config key so a chain that sets none of them behaves
exactly as it did in 0.6.0; 335 tests, offline, no API key, no live provider call (296 baseline +
39 new). No efficacy claim is made anywhere below - every item here is a correctness, cost, or
process-honesty change, not a claim that debate output improves.

- **Tool-grounded verification** (`verify.enabled`) - seats may invoke a fixed, sandboxed
  allowlist of four offline tools (`run_tests`, `check_versions`, `grep_repo`, `read_file`, no
  network access, no generic shell executor); results are appended to the run record verbatim
  under `ground_truth` and re-presented to later seats unedited by the debate. The literature this
  plan draws on names external ground-truth contact as the one mechanism that holds up in
  open-ended, no-ground-truth debate; this is its direct implementation.
- **Seat reliability recording and provider-failure dropout degradation**
  (`degrade_on_provider_error`) - a provider failure in the non-unanimous critique loop used to
  crash the whole run; it now degrades to a recorded `dropped` seat and the run completes.
  `verdict_stats` gained a per-lab `usableVerdictRate`. Absent the flag, a provider failure
  crashes exactly as it always did - this is a real behavior change only for opt-in callers.
- **Descending rounds** (`descending: true`) - a chain mode where each round debates a new,
  frozen object in sequence (plan -> architecture -> edge cases -> code) instead of re-opening the
  same object; an amendment against an already-frozen stage is rejected at the executor level, not
  by an unenforced prompt rule. Extended per the author's direction after the initial build: round
  1 flows into the existing criteria/proposals/debate/reply pipeline rather than a bespoke
  descending-only prompt, and the final stage runs signoff + handoff once, over the whole frozen
  stack, rather than per stage.
- **Scoped debate freedoms** (`freedoms: { blocking_questions, pass }`) - two rights only: a
  critic may ask one blocking question that pauses its verdict until the proposer answers, or may
  pass with a stated reason (recorded distinctly from both sign-off and objection, excluded from
  the unanimity vote like an abstention). Novelty-based stopping, seconding, and
  question-challenging were cut - none is deterministically offline-testable.
- **Bounded post-signoff challenge stage** (`challenge.enabled`) - modeled on the Athenian graphe
  paranomon: after signoff, exactly one recorded challenge may re-open exactly one decision for
  one round. The one-challenge, one-decision, one-round bound is hard-coded in the executor, not
  configurable upward - `chain-lint.js` rejects any attempt to set a max-challenges or
  additional-rounds key, since the narrowness of the re-open is itself the decay mitigation.
- **Zero-cost retrospective metrics** (new `metrics_report` MCP tool and `council --metrics`
  CLI subcommand, +1 to the tool count) - amendment rate, withdrawal rate, objection-follow-through
  rate, and tool-call usage, computed from existing run logs on disk, modeled on `spend.js`'s
  "derive, never record" discipline. Explicitly labeled descriptive telemetry throughout, never a
  baseline: Direction 1 (a paid harness comparing the council against a single strong model at
  matched cost) was **cut** - the author declined both the ~$300 full and ~$20 pilot cost, and no
  free version of an actual comparison run was proposed that didn't smuggle in real cost or an
  implicit efficacy claim. This metrics extension is the free, non-comparative salvage of that
  direction's measurement intent, not a revival of it.

**Also cut from this release, recorded plainly:** the scale/governance "many models jointly
propose and vote on building something large" direction. Its granularity question is answered on
paper (the unit of proposal-and-vote is a module: named, single-responsibility, with a declared
interface and test plan) but it is not built - running unanchored, open-ended votes before the
anchoring machinery above existed would have repeated exactly the failure mode the 2025-26
literature warns about for open-ended multi-agent debate. Items 1 and 3 above are the named
prerequisites for revisiting it, not a deferral without a stated condition.

Built across six independent branches (`v7/item1-tool-verification` through
`v7/item6-metrics`), each test-verified in isolation before merge, then merged one at a time
into master with two integration-only conflicts resolved (a frozen-key test fixture that didn't
yet know about the challenge stage's new key, and two independent mock-provider branches that
needed to sit side by side) - no feature logic was changed to resolve either.

## 0.6.0 - 2026-09-13

Role-assigned debate seats (`relay/runs/2026-09-13T20-20-07-757Z/`, plan revise-2.md), built
across seven phases. 296 tests, offline, no API key, no live provider call. Every merge point
run through `sower-review:bug-audit`; two real integration-seam bugs were found where phases
built in parallel (without seeing each other's code) had made quietly conflicting assumptions,
both fixed before this release (see docs/v6-decisions.md, Phase 7, for the full account).

**Status - stated plainly, as every commit tonight has:** the plan behind this release was **not
five-lab signed off**. Four labs passed clean; qwen refused over a single objection (the
"Decisions left to the author" section wasn't the plan's last section, which one criterion
required). That run's own `report.json` said `passed:true` regardless - a separate, real
false-pass bug in the chain's own reporting (qwen's reply was silently unparsed, not evaluated),
since fixed in `relay`. Muad reviewed the objection directly and said build - it is about
document ordering, not the design - and building proceeded on that basis, not on a false
sign-off.

**No efficacy claim.** This release ships the mechanism only. Whether role-assigned debate seats
actually improve anything about a real multi-lab debate is untested by this release. The
offline measurement harness built for this feature (phase 4) returned a NEGATIVE result for
lens-routing against a deterministic heuristic defect-catch probe, and never measured persona at
all - and after review, that experiment was found not to speak to the feature's real purpose in
the first place (debate diversity among real model seats reasoning differently about real
decisions, not defect-catching by a heuristic mock). See docs/v6-decisions.md's Phase 4 and
Phase 5 entries for the full reasoning. Nothing here states or implies role-assigned seats
produce better output than plain ones.

**What shipped:**

- **An optional per-seat `role` field** (`{ lens?, persona? }`) on any `seats.proposers` entry,
  applied only to that seat's debate-stage system prompt. A chain with no `role` set produces
  byte-identical prompts to before - proven by a golden-hash test against every shipped chain
  config, the same discipline `max_proposals_per_seat` used in 0.5.0.
  - `lens`: one of a fixed enum (`adversary`, `integrator`, `long-horizon`, `user-advocate`,
    `security-and-legal`) - a defined critique function.
  - `persona`: a name, resolved against a curated default set when it matches one (see personas,
    below) with a fallback to free text for an operator's own persona - a voice, not a function.
    Modeled as strictly separable from `lens` so any measured effect (if one is ever found) can
    be attributed to the function or the voice, not a blended "character."
  - `role` set on any seat kind other than `seats.proposers` is now caught fail-loud by
    `council doctor` and the run codepath - it would silently do nothing, since only the debate
    stage ever reaches the seats that use it.
- **Stage isolation, enforced, not just true today.** Four source-level guards (not runtime
  behavior tests) assert `applySeatRole` has exactly one call site in the whole codebase, that
  call site is the debate stage, and the panel/critique-stage prompt builders reference `role`
  nowhere in their own source - so a future edit that accidentally lets a role reach the
  evidence-only grading stage fails CI loudly rather than silently.
- **A weighted debate tiebreak** (`src/tie-break.js`): the arithmetic and a `report.json` field
  (`debate.tie_break`) recording whenever a tie is broken - not yet wired into a real
  vote-counting decision point in this release; that wiring is separate, future work.
- **Four failure-mode detectors**, computed from a run's own real debate output (never from the
  offline probe) and attached at `report.json`'s `debate.diagnostics`: a seat quoting no evidence
  despite objecting or merging (performing a character instead of reviewing), textual overlap
  between differently-lensed seats arguing the same proposal (roles collapsing into agreement
  instead of diversifying), a same-run gap between role-bearing and role-less seats' evidence
  quoting, and the fraction of a seat's own words that fall inside quoted evidence versus voice.
- **Five default public personas** (Moses, Noah, Matthew, Van Gogh, Parzival - `PERSONAS.md`),
  each with a curated name and voice directive, replaceable wholesale by an operator via a
  `COUNCIL_PERSONAS_FILE`-pointed file. Chosen specifically so this public MIT repo never ships
  a third-party trademark or private name.
- **A third-party-name lint** (`src/name-lint.js`) scanning the repo's own source, config and
  docs recursively for name patterns that don't belong in a public repo, extensible via a local,
  gitignored exclusion file.
- **A real five-lab debate-role chain** (`chains/plan-debate-roles-c1.json`) pairing each of five
  labs' critic seats with a distinct lens and persona - the actual artifact the feature was built
  to run, reviewed (`sower-review:scope-gate`: GO) and priced (`--dry-run`: $0.47/run worst case)
  but **not run live** - that spend is a separate, later decision.

**Test count**: 213 at 0.5.0, 296 now.

## 0.5.0 - 2026-09-13

v5's fifteen-candidate feature horizon (`relay/runs/2026-09-13T14-51-08-757Z/`, unanimous
five-lab sign-off, $0.2181), built across five phases, each offline-tested against
`chains/mock-*.json` fixtures and each merge point run through `sower-review:bug-audit`. 213
tests, offline, no API key, no live provider call. The mechanism itself - debate, proposals,
signoff, BYOK, the no-ledger-file invariant - is unchanged. No efficacy claim is made anywhere
below, including for the quality probe (see its own section further down).

**Failure legibility and first-run experience**

- **`council init [--yes]`** - a starter chain and task file a stranger owns, a real (no-network)
  price of that chain, and a canned $0 mock run so the first artifact anyone inspects is a real
  run folder, not just terminal output. Reruns never overwrite an edit you made to either
  starter file.
- **A structured error catalog** (`COUNCIL-E001`-`COUNCIL-E004`, `TROUBLESHOOTING.md`) for this
  project's actual hard-fail paths - missing key, unpriced model, malformed chain file,
  unreadable stage reply - each wrapped from its existing raise site with no change to what
  fails, only to what's printed: a plain-words cause, what the missing concept IS, a concrete
  fix naming the real file, a doc pointer. Distinct exit codes: 5 for a condition you can fix and
  continue from, 6 for one that stops this invocation outright.
- **`council doctor --chain <file>`** - fail-loud chain-config linting, before any metered call:
  a seat under a misspelled key that would silently never run, a missing/empty `seats.critics`
  that would crash or vacuously pass the review round, an unrecognized provider. Wired into both
  a read-only doctor check and the run codepath itself.
- **`council doctor --scan-artifacts`** - scans `tasks/` and `chains/` for API-key-shaped strings
  before you commit or share them; reports file and line, never the matched text.

**Cost and observability**

- **`council --forecast-cost --chain <name>`** - a realistic-case USD range from a chain's own
  historical runs, repriced at today's rates, distinct from `--dry-run`'s worst case.
- **`council export-board --run <folder> --out <file>`** - one self-contained HTML file of a
  run's proposals, debate, replies and verdict. No external assets, no server.
- **`council replay --run <folder> [--json]`** - a numbered, step-by-step transcript of a run.
- **`--stats`'s independence-skew report** - per-lab novel-objection rate and solo-signoff rate,
  with a low-independence flag, plus a shape-only-critique-round counter. Both purely descriptive
  - neither reweights a panel or changes a verdict.
- **`stage-log.jsonl`** - one structured JSON line per stage per run folder (seat, lab, token
  counts, cost, timing - no prompt content), alongside the existing markdown/`report.json`.

**Chain-config evolution, both opt-in**

- **`schemaVersion`** - an optional integer field; `council doctor` warns, never fails, when a
  chain omits it or names an older/newer one. A chain file without it behaves exactly as before.
- **`max_proposals_per_seat`** - **opt-in, no default.** Debate size stays unlimited unless a
  chain file explicitly sets this field; no existing chain's behaviour changes. When a chain does
  set it and one seat's own proposals still exceed the cap, that seat gets one merge prompt to
  fold its own list down before the debate board sees the extras.

**Withdrawal-chain integrity**

- **A withdrawal-chain termination check** (`council doctor --run <folder>`, and wired into a
  run's own reply-round close) detects a cycle or a dead end in mutual proposal withdrawals - a
  section that ends up with no surviving owner. Caught a real instance of exactly this bug inside
  the v5 planning run that authored this feature (two proposals mutually withdrew in each
  other's favour); the fix is regression-tested against that real run folder.

**Seeded-defect quality probe (test-only, Phase 1 of 2)**

`test/quality-probe/`: five synthetic fixtures seeded with 25 planted defects, graded by three
deterministic heuristic detectors, reporting catch-rate and unanimity as two separate numbers -
conflating "the detectors agreed" with "the detectors were right" is the reason this exists.
**This is not an efficacy claim and never may be quoted as one.** The detectors are deterministic
heuristics standing in for a mock panel, not real model seats - these numbers say nothing yet
about what an actual multi-lab council catches on a real plan with a real, un-cataloged defect.
Not under `src/`, not in `package.json`'s `files`, isolated from every runtime surface (`runs/`
scanners, the local UI, `verdict_stats`) by construction. Phase 2 (replaying real recorded
objections, which would let a real-panel claim be made honestly) needs a replay-driver design
that does not exist yet and is explicitly out of this release.

**Other**

- **`CONTRIBUTING.md`** - the three smallest landable contribution shapes.

## 0.3.0 - 2026-09-13

v3 build, designed from nine real runs driven the same day (chain `plan-debate-c2-4lab`,
~$0.36 total metered spend, external Claude-role stages). Five items, all offline-tested
against `chains/mock*.json`; the debate/proposal/reply/blind-panel mechanism, external-seat
economics, BYOK, and the no-ledger-file invariant are all unchanged. No efficacy claim is
made anywhere below.

- **Contract-versus-criteria conflict, resolved.** The criteria stage is now told a chain's
  own required deliverable sections (reusing `requiredDeliverableSections()`, already
  computed for v2's pre-flight check) before it writes anything, so it can no longer write
  a criterion that conflicts with a section the builder is required to produce. This
  replaced v2's warn-only pre-flight check as the primary fix (that check remains, for runs
  that skip the criteria stage) after the same conflict class cost rounds in four separate
  runs, including a genuine deadlock during this plan's own review where two acceptance
  criteria contradicted each other and no revision could satisfy both.
- **Artifact inlining, warned about.** `checkArtifactReferences()` (`src/preflight.js`) warns
  when a task names a file path it never fences verbatim in its own text - the real failure
  mode that led four labs to invent plausible-but-nonexistent identifiers against a
  summarised rubric file. Warn-only, consistent with the rest of `preflight.js`.
- **A first-class dispute record.** A reviser that judges an objection to not be a real
  defect now ends its reply with `DECLINED: <reason>` lines, stripped before the text
  becomes the next round's draft and collected into `report.json`'s new `disputes` field
  and a `BOARD.md` section - never inside the deliverable text itself, so no format
  criterion can ever fail a draft for containing it.
- **Peer-session dispatch, made first-class.** External stages were, in practice, handed to
  independent peer sessions rather than the driver's own subagents. `<stage>.claim.json`
  (`src/peer-claim.js`) records who claimed a stage and when, surfaced in `external_prompt`
  and the resume brief; `submit_stage` gains an optional `claimed_by` argument and three
  warn-only checks (claimer mismatch, missing required sections, a late/duplicate answer
  kept as `<stage>.late.md` rather than silently overwritten). No harness-initiated spawning
  or messaging of any agent.
- **Frozen-scope enforcement.** A run now hashes its task file's text at start
  (`src/scope-freeze.js`) and refuses to silently `--resume` past a change to it unless an
  `AMENDMENTS.md` entry covers the new hash - the real fix for an operator's late,
  undeclared requirement burning two rounds and a restart because a critic couldn't tell it
  came from the owner rather than a lab inventing scope. The one item in this release that
  can refuse an otherwise-legitimate resume outright; that tradeoff is deliberate, not an
  oversight.

Deviation from the signed plan, recorded plainly: `submit_stage`'s pre-existing guard
(reject an already-answered stage outright) is narrowed for the one case peer-dispatch
needs - a stage that already has an answer now falls through to the `duplicate_answer`
warning instead of being rejected. This is a real behaviour change for every caller, not
only new peer-dispatch ones; a caller that never double-submits sees no difference.

## 0.2.0 - 2026-09-13

v2 build per the council-signed plan (`~/Projects/relay/runs/2026-09-11T12-19-34-184Z/`),
re-curated from `~/Projects/relay`. Nine numbered items; the debate/proposal/reply/blind-panel
mechanism is untouched, no telemetry or network calls were added, and no efficacy claim is made
anywhere below - these are correctness and resumability fixes, not performance claims.

- **Stage contract schema** (`src/stage-contract.js`) - the shared internal data structure
  (`required_sections`, `role`, `no_prior_context`, `return_instructions`) every item below reads
  or writes.
- **`prepare_stage_prompt`** (new MCP tool, +1 to the tool count) - writes a self-contained bundle
  for a paused external stage so a driving session juggling other work can dispatch it to a fresh
  subagent instead of authoring it inline. See `docs/dispatch-pattern.md`. Context is referenced
  by path, never inlined.
- **Prompt-file truncation integrity** - `NEEDS-<stage>.md` now carries a footer (line count,
  byte size, sha256) verified on read; `external_prompt` returns a warning instead of silently
  handing back a truncated or corrupted prompt.
- **Resume-brief mechanism** - `run_status(brief: true)` returns and persists `RESUME.md`,
  regenerated at every stage-completion boundary from run state on disk - never itself trusted,
  always regenerable. No new tool.
- **Cross-run cost breakdown, narrowed from the original plan** - the plan proposed a new local
  ledger file; that was rejected against this project's existing "derived, never recorded" spend
  invariant (`src/spend.js`), whose reasons (drift, a failing write path, a sensitive-deletion
  leak) the plan's debate never addressed. Built instead: `costToday()` (calendar-day boundary,
  per-model breakdown) as an extension of the existing derivation, a `--cost-today` CLI
  subcommand, and a `session_cost_today` field on the existing `spend_report` tool. No ledger, no
  new tool. Full deviation recorded in `maintainers/DECISIONS.md`.
- **Static pre-flight check** - before any stage runs, a keyword check compares a chain's
  hard-required deliverable sections against the task text for the conflict class this project
  already hit once (a required "Scope ledger" section vs. a "standalone" requirement). Warns,
  never blocks; a known, accepted limitation (rephrased conflicts without trigger words) is
  pinned by name in its own test rather than hidden.
- **Partial-deliverable detection** - a stage's output is validated against its declared required
  sections before being trusted; a miss is logged loudly and recorded, never silently passed
  downstream.
- **Cache-hit staleness detection** - a cached stage is fingerprinted against the task text and
  chain config it depended on; a stale hit (inputs changed since caching - e.g. the task was
  edited between a pause and a resume) is invalidated and the stage actually re-runs, rather than
  silently replaying stale output.
- **Docs** - `docs/dispatch-pattern.md`, an updated MCP tool table (13 tools; `prepare_stage_prompt`
  is the only addition, nothing renamed or removed), and an external-vs-API documentation note for
  operators without a flat-rate subscription (not the default anywhere in config or examples).

Built and tested entirely offline against `chains/mock-*.json` fixtures - zero API spend for the
whole build. See `maintainers/PROGRESS.md` and `maintainers/DECISIONS.md` for the full build log and every judgment call.

## 0.1.0

Initial public release.
