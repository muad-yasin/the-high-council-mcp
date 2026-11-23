# 199: eight documentation lines that are missing or out of date

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

Each row below is a line that a document lacks or gets wrong, checked against the code. Every public sentence it adds is A-DRAFT until the owner's yes.

Which tests a row runs:
- **Rows A to E and H** touch only documents or test comments, so each runs the files it touches and the source scanners.
- **Rows F and G** change `src/`, so their sets follow the per-commit rule.

## A. CHANGELOG: a rematch and a replay count a settled call with no usage file too

**What is wrong.** The 0.8.4 bullet on counted spend (`CHANGELOG.md:75`) says that one reader now counts each paid call once. It ends: a call settled just before its usage file was written "was counted nowhere (a resume now counts it in its budget too)". It names only a resume, but the code counts that call in more places:
- a resume (`src/cli.js:3980`);
- a rematch and a replay, through `armSideRun` (`src/cli.js:1575`, the count at `:1585`; called for `--rematch` at `:2055` and for `--replay` at `:2205`).

A tree does not add a path of its own. It counts such a call once, through each run's own figure (`src/run-budget.js:33`), and takes it off its own rows so that it is not counted twice (`src/tree-budget.js:247-248`).

**The change.** Name the rematch and the replay beside the resume in that bullet. The bullet sits in the released 0.8.4 section; question E decides where such a line goes.

**The test.** None needed for a sentence. A grep of the bullet's phrases in `test/` finds only the tests' own titles and comments, and no test that pins `CHANGELOG.md`'s words (`git grep -n -E "counted nowhere|a resume now counts it" -- test/`). Before the edit, the 18 test files that name `CHANGELOG` (`git grep -l CHANGELOG -- test/`) are checked for a read of this bullet.

## B. CHANGELOG: the size at which the spending check prices an exchange call

**What is wrong.** The 0.8.4 bullet on the exchange (`CHANGELOG.md:104`) says how the dry run prices it ("its upper estimate counts three rounds per pass, its expected figure one"). It says nothing of how the spending check prices one exchange call. `KNOWN-LIMITS.md:36-39` states that: at the size the dry run prices it at, a seat's review size, and not at the seat's whole `maxTokens`.

**The change.** One sentence in that bullet, pointing to the Known limit. Like row A, it edits the released section (question E).

**The test.** None needed for a sentence. No test pins the bullet's words (`git grep -n "its upper estimate counts three rounds" -- test/` finds nothing). The behaviour is pinned by `test/exchange-gate-expected.test.js` (`:20`, `:29` and `:48`).

## C. The limit screen warns of a dearer provider, and the Known limits do not

**What is wrong.** The limit screen shows its `weak` text until every item of the stronger enforcement has landed (`src/cap-screen.js:23-25`), so that is what it shows today. That text says: "The price it uses is the price table's row for each model, so a provider that charges more can take a call past your limit by that difference. This is a guardrail, not a guarantee." (`:31`)

The Known limits come near it but never say it:
- the cap "is only as good as the price table", and a fallback model is charged at the priced seat's price (`KNOWN-LIMITS.md:49-50`);
- prices "are estimates, not invoices", and the provider's bill is the real number (`:115-125`);
- a grep of the file finds no sentence about a provider that charges more.

The paragraph at `:115-125` also says that, once a row's date has passed, a call through OpenRouter "stops the run instead of overpaying" (`:125`). An OpenRouter call carries the row as its price limit, which the Known limits say rests on one documented filter and one probe (`:186`). So the two texts may speak of different routes. This note's reading, not checked further: the screen's sentence holds for a call straight to a lab.

**The change.** The builder's first step is to establish which routes the screen's sentence holds for. This note's reading above is not checked. Then one sentence in the Known limits says what is found, no narrower than what is true. It goes in the expected-cost limit (`:26-41`) or in the price paragraph (`:115-125`).

**The test.** One more row in `test/known-limits.test.js`, which pins one phrase per limit.
- Expected red today (not run): the phrase is absent.
- The new sentence must not use a phrase that the file bans (`:126-139`).
- The 20 test files that name `KNOWN-LIMITS` (`git grep -l KNOWN-LIMITS -- test/`) run with it.

## D. The maintainers' release steps still name 0.8.3's branch and 0.8.4's tag

**What is wrong.** `CLAUDE.md` sends a release to "the release order, the last section of `maintainers/HANDOFF.md`".
- That section (`maintainers/HANDOFF.md:107` onward) is headed "0.8.3: the release order, as a pull request".
- It is dated, it records the owner's decisions of 20 and 23 Oct 2026, and its steps name the branch `release/0.8.3` and the tag `v0.8.4`.
- Its order: seven steps before the pull request, the pull request, and then the merge into `master`, `npm publish`, the tag, the GitHub release with the `.mcpb`, and the registry entry last.

**The change.** Question D picks one form:
- (a) Reword the heading and the steps without a version number. Result: one section serves every release, but a dated record of decisions is rewritten.
- (b) Add a short current section, and keep the 0.8.3 section as history. Result: the record stays as written, and `CLAUDE.md`'s pointer to "the last section" lands on the new one.

Either way the order of the steps stays as the section gives it.

**The test.** No test names `release/0.8.3` (`git grep -n "release/0.8.3" -- test/` finds nothing). `test/repo-hygiene.test.js` only checks that the file exists.

**Gate.** Sessions read the section for a release, so its words are A-DRAFT.

## E. The 0.8.4 CHANGELOG names neither the zero-retention setting nor three other additions

**What is wrong.** The 0.8.4 section (`CHANGELOG.md:3-177`) names none of these, and each is in the code. The section was searched for `zero.retention`, `note-add`, `ladder-credit`, `ladder_credit` and `credit`; the only hits for "credit" are in other senses.
- `--zero-retention` and `COUNCIL_ZERO_RETENTION` (`src/cli.js:469-475`; `KNOWN-LIMITS.md:18` has the limit);
- `council note-add` (`src/cli.js:349-352`);
- the start's `--ladder-credit`: the CLI reads it (`src/cli.js:2438`), says what it means at `:2435`, and refuses it without `--ladder` or with a bad number (`:2442-2444`). Over MCP it is `ladder_credit` (`src/mcp/start-ladder.js:2` and `:14`).

The section names exit 5 once, for the key check (`CHANGELOG.md:43`). What else exit 5 (`EXIT_DEGRADABLE`, `src/cli.js:137`) has covered since 0.8.4 was not settled by reading. Read its uses before writing that bullet.

**The change.** One bullet for each.

**Question E.** Where do lines about 0.8.4 go now that 0.8.4 is released? It covers rows A and B too.
- (a) Into the released 0.8.4 section. Result: the section becomes complete, after its release.
- (b) Into the 0.8.5 section, as lines on what 0.8.4 also added. Result: the released section stays as it was published.

## F. Pointers send a reader to README sections that exist only in AI-README

**What is wrong.** These pointers name sections that `README.md` does not have (`git grep -n -E 'README(\.md)?(#| ")' -- src/ .env.example`):
- `.env.example:21`: `README "Setup" lists them all`;
- `src/cli.js:823`, when no key is set: "see README.md#setup";
- `src/errors.js`: `README.md#setup` (`:24`), `README.md#the-spend-cap` (`:35`, `:41`, `:46`) and `README.md#chains` (`:56`).

`README.md`'s headings run from "Try it in 30 seconds" to "License", and none of them is Setup, The spend cap or Chains. `AI-README.md` has all three: `## Setup` (`:304`), `### The spend cap` (`:530`) and `## Chains` (`:817`).

**The change.** Each pointer names the file that has the section, or the README gains those headings (question F).
- `.env.example` must keep its key-name lines. `test/distribution-manifests.test.js:23` reads them (`^[A-Z_]+_API_KEY(?==)`), and `test/denied-models.test.js:117` reads the file too.

**The test.** A new check: every `README.md#<anchor>` in `src/`, and every `README "<section>"` in `.env.example`, names a heading that the file has.
- Expected red today (not run): `setup`, `the-spend-cap` and `chains` are not headings of `README.md`.
- `test/tree-start-prechecks.test.js` pins a captured output (GOLD-1, `test/fixtures/preflight-35a9b38.json`) that holds the missing-key error with its pointer. If that output changes, GOLD-1 becomes a changed accepted test.
- These run with it: the 5 test files that read `.env.example` (`git grep -l '\.env\.example' -- test/`) and the 6 that name `errors.js` (`git grep -l errors.js -- test/`).

**Gate.** The CLI line, the error texts and the `.env.example` line are sentences a person reads: A-DRAFT.

**Question F.** The npm package does not ship `AI-README.md`: `package.json` `files` lists `README.md`, `KNOWN-LIMITS.md`, `TROUBLESHOOTING.md`, `CONTRIBUTING.md`, `PERSONAS.md`, `LICENSE` and `.env.example`.
- (a) The pointers name `AI-README.md`.
  - Result: they work in a clone and on GitHub. From an npm install they name a file that is not on the disk, unless the pointer is a web address or `AI-README.md` joins `files`.
  - The README stays short, and each section stays in one place.
- (b) The README gains Setup, The spend cap and Chains. Result: the package carries the sections the pointers name, and two places hold each section, which must be kept equal.

## G. A tree begun on 0.8.3 with the child chain `daily7-sub-a`: the hint offers a step that cannot work

**What is wrong.**
- The chain moved to `chains/outdated/daily7-sub-a.json`, and the moved file differs from 0.8.3's: its description, `dispute.stall_rounds` (2 to 3) and `extra.provider.ignore` (44 lines in and 4 out by `git diff v0.8.3:chains/daily7-sub-a.json 0b4016a5:chains/outdated/daily7-sub-a.json`).
- The hint for a retired chain says: "To use it again, copy that file from GitHub into this project's chains/ folder" (`src/chain-name.js:42`).
- A tree pins each chain file by its hash. The continuation's checks include `chain`: the chain file the run uses is not the one registered, by its sha256 (`src/tree-continuation.js:4`). `--accept-chain-limits` accepts a file that differs in nothing but its two price-limit fields (`src/tree-chain-limits.js:1-6`).

**Read, not run, and not established.** When a tree's child chain file is missing, the tree's loader throws with the retired-chain hint (`src/tree-derive-load.js:64`). The copied file would then differ from the one the tree registered. So for such a tree the hint seems to offer a step that cannot work. The condition a fix needs, "this tree registered the 0.8.3 text", would come from the tree's own record of the chain hash.

**The change.** The builder's first step is to establish the path above: by a run on a mock tree, or by reading the continuation's check to its end. Then the sentence follows what is found: a sentence in the hint, said only where it is true, that a tree begun before the move cannot go on with the copied file, because its registered hash differs.
- The hint serves every retired chain (`src/chain-name.js:42`), so the tree sentence must be conditional. Otherwise it tells a plain run something false.

**The test.**
- CM-2 (`test/child-chain-move.test.js:31-34`) matches the hint's words by pattern. It stays green if the tree sentence is added only where it applies, and becomes a changed accepted test if the existing words change.
- A new case asserts the tree sentence where it applies, and its absence for a plain run. Expected red today (not run): the sentence does not exist.
- The 8 test files that name `chain-name.js` (`git grep -l chain-name.js -- test/`) run with it.

**Gate.** A refusal sentence a person reads: A-DRAFT.

**Question G.**
- (a) Only warn. Result: such a tree is told that it cannot go on.
- (b) Widen `--accept-chain-limits` to such a file. Result: a way on, but a change to what a tree accepts, which is more than a sentence.

## H. Test comments describe the mock provider as blind to prompts

**What is wrong.** The mock provider reads fixed markers in a prompt:
- the rating demand (`mockDemandIn`, `src/providers.js:143`);
- a judge prompt's opening sentence (the comment at `:152`);
- the `relation` field (`mockRelationIn`, `:183`).

`CLAUDE.md` says so at 0b4016a5 (`:147-150`: "the mock provider picks its canned reply by fixed phrases and markers it looks for in a prompt ... so no test shows how a model answers changed wording").

These comments describe the mock as ignoring prompt text:
- `test/roles.test.js:5` and `:67`;
- `test/quote-check.test.js:113`;
- `test/tool-verification.test.js:5` and `:20`;
- `test/hostile-fenced-corpus.test.js:17`;
- `test/writer-note.test.js:4`;
- `test/excerpt-block-chain.test.js:4`;
- `test/handoff-dependencies.test.js:2` and `:71`;
- `test/objection-closed-states.test.js:4`.

The wider grep `git grep -n -i -E "mock[^.]{0,40}ignor" -- test/ src/ '*.md'` also finds six lines where "ignore" means something else, such as `stdio: 'ignore'` or prices that ignore the input. Those stay. What most of the eleven conclude ("no test can say how a real model reacts") is still true.

Two comments speak of one seat and may be true as written: `test/tool-verification.test.js:70` (the builder and critics of `mock.json`) and `test/tree-split.test.js:298` (the default mock handoff). Read both before editing them.

**The change.** Reword each of the eleven comments to say what `CLAUDE.md` says: a canned reply chosen by fixed markers, so no test shows how a model answers changed wording. Comments only.

**The test.** None. A comment-only commit runs the files it touches.

**Gate.** None: these are test comments.

## The owner's gates, for all eight rows

- **Prompt wording:** none.
- **Sentences a person or a session reads:** the CHANGELOG lines (A, B, E), the Known limit (C), the release section (D), the CLI line, the error texts and `.env.example` (F), and the refusal sentence (G). All are A-DRAFT.
- **Money:** none. Row C describes the spend cap and changes none of it. Row G's option (b) would change what a tree accepts, which is why it is a question.
- **Hand-typed counts:** none.

## What the changes must not touch

- Released history, in any way that changes a tested figure.
- The order of the release steps (row D).
- The behaviour behind any of the sentences: rows A, B, C and H describe code that stays as it is.

## Questions only the owner can answer

Each is set out, with its options and their results, in its row above:
- **D.** The release steps: reword them without a version, or add a current section beside the dated one.
- **E.** Where lines about 0.8.4 go now that it is released (this covers rows A and B too).
- **F.** Where the pointers send a reader, given what the npm package ships.
- **G.** For a tree begun on 0.8.3: only warn, or widen `--accept-chain-limits`.
