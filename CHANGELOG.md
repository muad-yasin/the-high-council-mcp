# Changelog

## Unreleased

### Changes that can break a script or a client

- **A judge that signs off without answering its own earlier objections no longer passes the round** (chains with `answer_back.enabled`: the seven shipped planning chains;
  found by an outside review of 0.8.2, 7 October 2026; roadmap item 27). Until now an objection the judge simply left out of its `answers` was recorded as `unanswered` and
  dropped, so a clean sign-off passed, while a withdrawal without a quote was kept open. Now that judge is asked once more, told the objection ids it skipped (a new
  sentence, `criticUnansweredNote`); whatever is still unanswered after that is carried as an open failure, and the judge's verdict is an objection. A judge that
  already objects carries its skipped objections at once, with no extra call. **Cost:** a judge that never writes `answers` turns each round it would have signed
  off into an objection: one re-ask, then a reviser call and a full panel review in the next round, until the stall rule (two identical rounds, with `dispute.enabled`)
  or the round cap stops the run. The dry run's figures do not include re-asks. `report.json`'s `answer_back_replies` keeps the
  `unanswered` record; the carried objection is in `signoff[].objections` with `carried_from_round` (`test/held-door-27.test.js`).
- **A judge that was not heard in a round keeps its open objections into the next one** (roadmap item 30, found while building item 27). A judge whose reply was
  unreadable, lost or refused for its table was no longer shown its earlier objections in the next round, nor were its answers read, so a plain clean sign-off passed
  the run. This happened both when the round went on with no revise (every heard judge signed off) and when another judge's objection caused a revise (the answer-back
  data was rebuilt from the heard judges only). The still-open objections now stay with that judge (an objection it withdrew with a quote in a reply that was not
  counted stays withdrawn); they go to the judge again, not into the reviser's list. `report.json`'s `answer_back` lists each round for the judges asked again
  (`test/answer-back-unheard.test.js`).
- **A run paused before this change and resumed after it asks the writer's panel seat again** (`panel-N-sonnet5-writer` in `plan-daily-7` and `plan-highest-7`): that
  seat's prompt text changed (item 28 below), so its cached reply no longer matches. No stage label changed.

### Changed

- **The writer's own seat on the panel is told it wrote the draft** (roadmap item 28). In a chain with `"selfReview": "allowed"` (`plan-daily-7`, `plan-highest-7`) the
  critic prompt of the seat that wrote the plan used to say "You did not write the draft you are reviewing"; that seat now gets a self-review opening and the same
  evidence rules. Every other judge's prompt is unchanged. The writer's seat is found by the same rule chain-lint's self-review check uses (`modelIdentity` and
  `seatIdentity` now live in `src/chain.js`; `src/chain-lint.js` still exports `modelIdentity`).
- **The deep dive's wording no longer says its seat does not vote** (item 28): under `"judging": "all-roles"` its lab also judges on the panel. Its prompt now says the
  job is not a vote, the reviser's note says the findings are not votes, and BOARD.md adds "The same lab also sits on the panel and votes there." when it does.
- The prompt record (`ROLES_SHA256` in `test/prompt-pin.test.js`) is re-recorded for these sentences; the prompts every mock chain sends are unchanged.

### Fixed

- **A machine with no `git` on its PATH refused every task over MCP** (found by the Wine smoke test of the Windows .exe on 7 October 2026; the same applies to any machine without `git` on PATH, such as a Windows PC without Git for Windows).
  `start_run` and the other tools that read a file check `.gitignore` through `git`, and a missing `git` was treated as a failed check, so `start_run` answered
  `refused: can't check .gitignore (ENOENT)` for a task in a folder that is no repository at all. A missing `git` now counts as "not a repository" only when no `.git` entry exists in the
  folder or above it and `GIT_DIR` / `GIT_WORK_TREE` are unset. Inside a checkout the gate stays closed, and its message now says what to do: `git is not installed or not on PATH, and this
  folder is inside a git repository`. Every other git failure still refuses (`test/gitignore-no-git.test.js`).
- **The binary smoke test (`scripts/smoke-binary.mjs`) prints `start_run`'s reply, the server's stderr and the started run's log**, so a failing check explains itself in the CI output.

## 0.8.2 - 2026-10-07 (BREAKING for scripts and clients that rely on the changes listed under "Changes that can break a script or a client")

What changed in 0.8.2, by section; nothing in them claims the council
advises or plans better than one model, and nothing was measured to say so.

### Changes that can break a script or a client

- **A run paused under 0.8.1 is not replayed when resumed on 0.8.2** (audit `cnc-cli-resume` F1): seven planning chains changed (`plan-daily-7`, `plan-highest-7`, `plan-premium-7`, `plan-open-7`, `cheap-7-v2`, `plan-debate-roles-c1`, `verify`) and the criteria and judge prompts changed in every chain, so the config fingerprint or the prompt hash differs: its API stages are
  paid for again (the spend cap still holds, and the old files are kept under `superseded/`) and the answers already given to its external stages are set aside and asked again. **Finish a paused run on 0.8.1, or expect to pay for its stages again and answer its external stages again.**
- **Resuming a run over MCP no longer trusts what `run.json` says about money, secrets and folders** (`resume_run`, and `submit_stage`'s automatic resume; audit `cnc-mcp-security` F1 + F2). A run folder is data a cloned repository can ship. A saved `maxUsd` of `null` (a run started with `max_usd "none"`) now gets the default ceiling
  (`MAX_USD_PER_RUN` or $7) on an MCP resume **unless the caller passes `max_usd "none"` again**; a saved positive cap is kept as before. A run saved with `allowSecretShaped` is refused over MCP unless the caller passes `allow_secret_shaped true` again (the key scan stays on). A `run.json` whose `cwd` is not the server's
  own working folder is refused (it chose the policy and chain folders the resume read). `council --resume` typed by a person in a terminal is unchanged.
- **There is no default chain.** `council --task x.md` without `--chain` used to run `verify`, whose Gemini 2.5 seat is closed to new Google projects. It now stops with exit
  code 2 and names the recommended chains (`cheap-7-v2`, `plan-daily-7`, `plan-premium-7`, `plan-highest-7`, `local-ollama`); nothing runs and nothing is spent.
  `council --forecast-cost` without `--chain` stops the same way. `--resume`, `--advice-adopt`, `--rematch` and `--replay` still take their chain from the run folder. The MCP tools already required a chain.
- **21 chains moved out of `chains/`.** They are in `archive/chains/` in the repository (nothing was deleted) and are **not in the npm package**, so `--chain <name>` for any of them now fails
  with "No such chain" and the error says where the file went. The names: `cheap`, `cheap-7`, `gp-judge-v1`, `idea-open-c2`, `plan-auto`, `plan-auto-mistral`, `plan-cheap`, `plan-debate`,
  `plan-debate-c2`, `plan-debate-open-c2`, `plan-fast`, `plan-proposals`, `plan-proposals-best-of-5`, `plan-relay`, `plan-thorough`, `plan-two-strong`, `plan-unanimous`, `seven`,
  `seven-cheap`, `smo`, `smo-v2-cheap`. To use one again, copy its file from `archive/chains/` (on GitHub) into your project's own `chains/` folder: `--chain` takes a name, never a path, and a
  project's own `chains/` is searched first. A run recorded on an archived chain (paused, or one you want to resume, rematch or replay) needs its file there too. `council doctor --chain <file>` still lints a file by path.

- **`run_tests` (the opt-in seat tool) now gives the test process an allowlisted environment** (`PATH`, `HOME`, `USERPROFILE`, `TMPDIR`/`TEMP`/`TMP`, `LANG`, `LANGUAGE`, `LC_*`, `TERM`, `CI`,
  `SystemRoot`, `ComSpec`, `PATHEXT`, `WINDIR`; names compared in upper case). It used to inherit the whole environment, provider keys included. A repository whose tests need another variable
  (`DATABASE_URL`, say) will not see it when run through this tool.
- **The MCP tools refuse a run folder that contains a symbolic link, at any depth up to four** (`read_run_file`, `run_status`, `list_runs`, `external_prompt`, `prepare_stage_prompt`,
  `submit_stage`, `plan_outline`, the advisor result, and the objection dispositions a `council_advise` call records). The harness never creates one; before this, a link planted in `runs/<id>/`
  (a cloned repository can ship one) was followed out of the folder. What a caller now sees: `read_run_file` answers `no such run`, `bad file name` or `no such file` separately; `submit_stage`,
  `resume_run` and `run_status` with `brief: true` can answer `refused: ... is a symbolic link`; `list_runs` shows such a folder with `status: "refused"` instead of failing the whole listing on a dangling link;
  `council_advise` with dispositions for such a run answers `ledger_unreadable`.
- `prepare_stage_prompt` and `run_status` with `brief: true` show the task text only when the path in `run.json` is a regular file inside the **server's own working folder**; a task run from elsewhere is
  named but not shown. (The root is never a folder `run.json` itself names: a `cwd` field in it is as untrusted as the path. For the same reason a stage's chain config is looked up in the run's recorded `cwd`
  only when that is this server's working folder, then in the working folder's and the package's `chains/`.)

- **The majority guard is now on in `plan-premium-7`, `plan-open-7` and `cheap-7-v2`** (it was on in `plan-daily-7` and `plan-highest-7`): authors see each argument once with no lab letter and no tally, and a
  withdrawal that quotes nothing of the argument it concedes to is recorded as unargued and the proposal stays. This changes the reply prompts of those three chains.
- **The cold read (off in every shipped chain) now runs after the final edit** instead of before it, so it reads the text that is delivered. A reply that cannot be read, or a seat that cannot be reached, is
  `coldRead.status: "not_judged"` with a reason code, no longer a silent "found no contradictions" (`raised` stays false: read `status`). A descending chain runs it once, over the final stack.
- **The stall rule and the dissent block's "first raised" round compare the objection's quoted text as well as (lab, criterion).** Two different defects raised under one broad criterion no longer read as one stuck
  disagreement, so a dispute-enabled run can stop later than before in that case (never earlier). It only differs where objections carry a `quote`, which the critic prompt offers on tasks with fenced source.
- **Advice chains no longer have a wall clock, and the two cheapest single seats answer up to 360,000 tokens** (owner, 6 Oct 2026: "no clocks, no reason to add them. If it times out we restart, if it takes time it takes time", and "no reason to cap such a cheap model to just 36k"). (a) `advise.max_wall_ms`, which 0.8.1 made mandatory, is removed from every shipped advice chain, the chain-lint rule `advice-no-wall-clock` and the admission refusal "has no advise.max_wall_ms" are gone, and a chain of your own may leave it out or still set it (then it still ends the run at exit 18 with `stoppedBy: "wall_clock"`, and that value stays readable in old reports). Without it a call is bounded only by the request deadline every call has, **raised from 45 minutes to 2 hours in this release** (owner, 6 Oct 2026: "2h is OK"; GLM-5.3 Flash measured about 134 tokens/s with its thinking, so a 360,000-token answer takes about 50 minutes; DeepSeek's speed at that size is not measured). The deadline applies to every request of every chain, planning chains included, so a hung call can now hold any run for up to 2 hours; `council stop`, a client cancel and each chain's `advise.usd` ceiling are unchanged, except that a stop does not cut a call already running (owner, 6 Oct 2026, option A: in-flight calls finish, are billed and their answers are kept), so with no clock it can wait for a slow call, up to those 2 hours (it was at most the wall clock). Your own chain that calls a provider directly (not through OpenRouter) is also bounded by Node's 300-second headers timeout on a non-streaming call. A slow reasoning model took 6 to 13 minutes for one answer in the run that measured it (measured in the GP 2-judge run of 6 Oct 2026: GLM-5.3 Flash 554 s and 353 s, Qwen3.8 Max 753 s; a 300 s clock would have cut each of them): the tool text no longer says "usually under a minute". (b) `advise-single-glm-flash` and `advise-single-deepseek` go from `maxTokens` 36,000 and 11,000 to 360,000, and their `advise.usd` from $0.07 to **$0.42** and **$1.01** (first call plus one retry at the same cap, projected from each seat's `pricing.json` row, derivation in each chain's description). Those are ceilings, not expected costs: a real reply is far smaller. The cap rules endpoints out: of the endpoints OpenRouter tags zero-data-retention and inside each chain's `max_price`, 8 of 17 accept 360,000 completion tokens for GLM and 3 of 5 for DeepSeek (OpenRouter's public endpoint list, read 2026-10-06). Whether OpenRouter skips an endpoint below the requested `max_tokens` or refuses the call is **not verified** (it needs a live call). Gemini 3.8 Flash (12,000), Qwen, Sol, Astra and Opus keep their caps; Gemini's endpoints top out at 65,536 anyway.
- **`HANDOFF.md` gains two sections the harness writes, between the model's text and the criteria lock block** (item 6b): "Before you build" and "Replan triggers" (a run with no thin contract, such as one from before 0.8.2, is unchanged). A script that took everything above the lock block as the model's text now also gets these. The lock block is still the last thing in the file, and the section carries no comment marker, so `council check-lock` reads the file as before. The "named check fails N times in a row" trigger reads `handoff_contract.check_failures` (new, optional, a whole number of at least 1; default 2, derived from the harness's own stall rule, whose minimum is 2).
- **`HANDOFF.md` can now start with a banner written by the harness, and a run that finished degraded is no longer treated as a clean sign-off.** (a) A signed run whose delivered text differs from the
  text the panel signed (a post-sign-off challenge or a final edit changed it; a harness-written cold-read or dissent block alone does not count) gets a first line `> **Not the signed text.** ...` above the model's text. (b) A run that has
  `passed: true` but `outcome: "degraded"` (a seat was not heard) gets `> **Not a clean sign-off.** ...`; `council handoff --from-run` reads the outcome the same way. (c) An unsigned run keeps its
  existing `> **Not a signed-off plan.**` banner. The lock block stays the last thing in the file and `council check-lock` reads it as before. A script that expected `HANDOFF.md` to open with the
  model's own heading must skip a leading `>` block. `passed` and the exit codes are unchanged.

- **A gate ledger that holds contract events is read as broken by a 0.8.1 tool** (item 6d). The ledger format id stays `gate-ledger/1`, but `runs/<id>/gate-ledger.jsonl` can now hold three more events
  (`contract_locked`, `amend_requested`, `amend_decided`). A 0.8.1 `council gate verify` reports such a ledger as broken at line N (it names an unknown event; 0.8.1 has no way to say "too new"), and
  anything 0.8.1 does with a ledger it cannot read fails closed. Verify a ledger that holds contract events with 0.8.2. Only a run that had a contract locked or an amendment requested through it has one.

- **The printed dry run, `council doctor` and the cap note no longer say "worst case"** (item 8c; owner, 7 Oct 2026: "build it tonight"). The figure those lines called the worst case was never one: it prices
  the chain's own assumed sizes with the typical output of a review. It is now called **expected**, and a second figure, **maximum**, prices the same planned calls with every call writing its seat's whole
  output allowance (an Anthropic seat's one retry included), the way the spend cap's projection does; re-asks and the cut-off retry of a seat that is not Anthropic are not in it, and the cap is the only bound. A script that matched the words "worst case" in `--dry-run` or `doctor` output, or the `note:  this chain's worst
  case is` line, must read "expected" and "at most" now. `--dry-run --json` keeps `worstCaseUsd` and every field it had (its value is unchanged, and it is the expected figure) and adds `expectedUsd`,
  `maximumUsd`, `expectedWithTaskUsd`, `maximumWithTaskUsd`, `cap.maximumAboveDefault`, and `maximumOutputTokens` and `maximumUsd` on each row. The README table and the landing page print both figures
  (`cheap-7-v2`: $11.22 expected, $22.36 at most), checked against the dry run by `test/dry-run-figures-docs.test.js`; the README's advice to set the cap "just above" the price now says above which figure.
  `list_chains` no longer claims to return a price (it never did; `dry_run` prices a chain).

- **A seat with no price row is refused under a spend cap** (item 8a; ChatGPT review 1 #4a; owner, 7 Oct 2026: "build it tonight"). The cap projects an unpriced seat at $0, so it could not stop what a call to it
  costs; until now that was a Known limit. The default $7 cap is on unless you pass `--max-usd none`, so **every default run whose chain seats a model that has no row in `src/pricing.json` is now refused at its start**
  (exit 5, before a run folder exists, nothing sent, nothing spent): the message names the seat, the model, the roles it fills and both ways out (add a row to `src/pricing.json`, or run with `--max-usd none`).
  `--dry-run` prints the same refusal, and `--dry-run --json` adds `cap.unpricedSeatsRefused`. `invoke()` throws the new `UnpricedSeat` for any call that reaches it another way (a handoff or contract-draft call,
  a side run) and the run stops with exit 5 and resumes after a price row is added. Exempt: `mock`, `external` and `ollama` (priced at an explicit $0). Every shipped chain's seats are priced. A script that
  relied on an unpriced seat running under the default cap must pass `--max-usd none` or add the row. The README's Known limits entry on unpriced seats is rewritten to what remains.
- **The 0.8.2 prompt re-record: what a run now does differently in the seven shipped planning chains** (`cheap-7-v2`, `plan-daily-7`, `plan-debate-roles-c1`, `plan-highest-7`, `plan-lanes-4`, `plan-open-7`, `plan-premium-7`; owner's yes to every prompt change, 7 Oct 2026; `coder-gate-v1/v2` and every other chain keep their switches off; the judges' and criteria prompts changed for every chain). Four of the changes decide whether a run passes; a script or a comparison of runs across 0.8.1 and 0.8.2 must not treat them as the same behaviour:
  1. **A judge's sign-off needs a full per-criterion table** (`signoff_table.required`): a row for every criterion, each with evidence and a verdict that says MET or FAILED. A short table, a row without evidence or a row with a third word is not a sign-off: the judge is re-asked once per round, then counts as unheard for the round (`INCOMPLETE_TABLE`), and a run whose judge never writes a full table ends at the round cap as "not agreement".
  2. **The judges' standard of proof is higher** (every chain): a criterion is MET only if the judge quotes the passage that shows the condition holds ("it mentions it" is not enough), names what would have made it FAILED, and for an "every X" criterion identifies the complete set checked (compact ranges or section references where these cover every item); for a criterion that forbids something the evidence is what was searched for. A judge that cannot name a failing condition writes FAILED. Expect more FAILED verdicts on plans that only mention things, and a criterion nobody can falsify to end in the dispute stage instead of passing by mention. The harness records this and cannot check it.
  3. **A judge's withdrawal of its own objection counts only with a passage copied from the draft in backticks or quotes** (`answer_back.enabled`): from round 2 each judge that had objections is shown them, the writer's reasons (matched to the objection by id when the reviser gave one) and the changed passages, and marks each `sustained` or `withdrawn`; a withdrawal with no copied passage, or a status that is neither word, leaves the objection open and that judge does not sign off.
  4. **The criteria-seat prompt no longer lets a request's own "must contain / fails if" list be copied as criteria** (it asks for the condition that makes the answer right or wrong), and a criteria retry says so too.
  The rest changes what seats see without changing when a run passes: the authors' reply prompts mark an objection or merge that quotes nothing `[no quote]` and say what the mark means; debate posters are asked to copy the phrase they talk about in backticks; debate readers see proposals in their own seeded order with their own lab letters (`debate_hygiene.shuffle`); a re-asked judge is told what its table lacked; the reviser's DECLINED line carries the objection id; the handoff seat is asked for the milestone shape (`Status:`, `## Milestones`, `- check: C1, C3 | <what> => <result>`, at most 1,500 words instead of 600; the lint only warns), so **`HANDOFF.md` has a different shape in these chains than in 0.8.1** (a script that read its old sections must read the new ones); the final editor keeps a section named "Assumptions" (chains with a final-editor seat: none of the promoted ones); `plan-lanes-4`'s reviewers carry their lane paragraph; `council contract draft` has its recorded prompt. Every word is in `src/roles.js` and listed old and new in `Review/Build_0.8.2/ReRecord_Words_2026-10-07.md` (maintainer notes, not shipped).
- **`plan-daily-7` and `plan-highest-7`: every seat votes, the plan's writer too** (owner, 7 Oct 2026, deliberate: "all models that have another role judge and vote"; "everyone who is part of the chain ... writer judges too. Everyone!"). Both chains now seat 13 judges, blind, unanimous: the architects, the proposers, the deep-dive seat's lab, the criteria seat (Claude Opus 5.5 on your Claude subscription, an external seat, in both chains: `plan-highest-7` no longer uses Llama 4 Maverick) and the plan's writer (the Claude Code session that also writes the skeleton, build, revisions, dispute stage and handoff; panel label `panel-N-sonnet5-writer`). This reverses the September rule that no seat both argues and votes, for these two chains only, through a new chain-level key: `"judging": "all-roles"` (chain-lint's `mass-seat-votes` and `deep-dive-votes` are skipped for a chain that sets it, the value must be exactly that string, `grep -r '"judging"' chains/` lists every chain that does; a chain without it is still checked by both) together with the existing `"selfReview": "allowed"` for the writer. `plan-daily-7`'s roster changes with it (criteria Opus 5.5 subscription; architects GPT-6.1 Sol, Opus 5.5 subscription, GLM-5.3 Flash; proposers Hy4, Gemini 3.8 Flash, DeepSeek V4.1 Flash, Muse Spark 1.3, Qwen 3.8 Max, MiMo V2.6 Pro; judges also DeepSeek V4 Pro, GPT-6 Luna, MiniMax M3; Mistral out; the 6 Oct output caps; GLM-5.3 Flash seats no longer carry an explicit `reasoning.effort`, because the model's own default is above high). Dry run at the prices of 7 Oct: `plan-daily-7` $12.59 expected / $33.25 at most (it was $5.70 / $11.98), `plan-highest-7` $18.49 / $50.43 (it was $17.34 / $42.94): **both are above the default $7 cap, so a run needs `--max-usd`.** Routing of the two Claude Code sessions: every label containing `opus5.5-sub` and the three criteria labels (`criteria`, `criteria-retry`, `criteria-feasibility-retry`, which carry no lab name) go to the Opus 5.5 session; every other external stage, the writer's panel stage included, goes to the Sonnet session. New price and reasoning rows for `xiaomi/mimo-v2.6-pro` ($0.435 / $0.87 per million tokens, `maxTokens` 131,072; checked against OpenRouter's public model list on 7 Oct 2026). Nothing about either chain's output quality has been measured.
- **An unreadable word is never a pass** (owner, 7 Oct 2026, two rules; each changes when a run passes, each is behind a switch that is on in the seven shipped planning chains since the prompt re-record). **(a)** With
  `signoff_table.required`, a sign-off whose table has a row that says neither MET-shaped nor FAILED-shaped (`UNCHECKED`, `MET (partially)`, `SATISFIED`, `see notes`; a closing full stop is not a different
  word) is an incomplete table: the judge is not heard (`INCOMPLETE_TABLE`, `signoff_table_gaps[].kind` / `reason_code` table_gap kind `unreadable_verdict`, a new value in `report-v1`) and is re-asked as a refused
  table is, once per round; it is never a failure sent to the reviser. A script that reads `kind` as one of `no_table`, `missing_rows`, `no_evidence` must accept the fourth value. **(b)** With
  `answer_back.enabled`, an `answers` entry whose `status` is neither `sustained` nor `withdrawn` (`fixed`, `resolved`, `open`, empty, not a string; case, spaces and a closing full stop do not count as a
  different word) keeps the objection open: it is carried into the judge's failures exactly like a withdrawal with no quote, and `answer_back_replies` records it as `unreadable_answer`. An objection the judge
  does not answer at all is still recorded as `unanswered` and not carried (carrying those would let a judge that ignores the array stall every run).
- **A punctuated verdict word is read as the word** (owner, 7 Oct 2026; changes when a run passes, in EVERY chain, no switch). A criteria-table row whose `verdict` ends in a full stop or an exclamation mark is read without it:
  `"Failed."`, `"NOT MET."`, `"Fail!"`, `"No."` are now failing rows (before, the parser read only the bare word, so a reply with `meets: true` and such a row signed off with the failure ignored), and `"Met."`, `"Pass."`
  count as MET in the all-MET and the checkable-criterion readings. The words themselves are unchanged (`MET`, `PASS`, `PASSED`, `YES`; `FAILED`, `FAIL`, `NOT MET`, `UNMET`, `NO`).
- **A verdict word wrapped in markdown or ending in a colon is read as the word** (owner, 7 Oct 2026: "Your recommendation to both, yes"; changes when a run passes, in EVERY chain, no switch). `"**FAILED**"`, `` "`FAILED`" ``, `"Failed:"`, `"NOT MET:"` are now failing rows (before, a reply with `meets: true` and such a row signed off with the failure ignored), and `"**PASSED**"`, `"Passed:"`, `"Met:"` count as MET. The whole cell is still the word: `"**Partially met**"` and `"Met, except the TTL"` are neither, as before. Without `signoff_table.required` a row that is neither word does not stop a judge's own `meets: true` (unchanged); with it, the table is refused as incomplete.
- **`prepare_stage_prompt` and the stage-shape check now know the dispute, deep-dive and cold-read stages** (owner, 7 Oct 2026: "Your recommendation to both, yes"; what a client sees). A run paused at an external seat on `dispute` or `deep-dive-revise` (the writer is external on `plan-daily-7` and `plan-highest-7`, and both set `dispute` and `deep_dive`) was refused by `prepare_stage_prompt` ("could not resolve this stage") and never shape-checked. They now have kinds: `dispute` its own (the panel is finished, so the writer marks what could not be settled instead of fixing it), `deep-dive-revise` the revise kind. `submit_stage` now answers `stage_validation_failed` for an empty answer to them, and the CLI records a PARTIAL OUTPUT line in `WARNINGS.md`. Also mapped, for a chain that pauses there (none shipped does): `canary-reply-<lab>` (a reply) and `cold-read` (a new kind: JSON with `raised` and `contradictions`; a chain lists it only when `coldRead.enabled` is true). A test now reads every label `src/chain.js` calls a seat with, so a new one without a kind turns the suite red.
- **The advisor's send path applies `policy.json`'s `max_usd_per_run` like the CLI does** (owner, 7 Oct 2026: "Terminal rule only, no cap change"; cnc-money F1). Until now `council_quote` / `council_advise` compared the limit with the call's CEILING, so a $1 limit refused `advise-single` (ceiling $1.32; the chain's expected cost, the first figure `--dry-run` prints, is about $0.40). They now refuse only when that expected cost is over the limit, the same figure the CLI's start gate compares after the person approves (so an approved call is never refused there); when only the call's ceiling is over the limit, the quote goes ahead with a warning in the preview text, in the approval dialog (before the text) and in `council_quote`'s `policy_warnings`. A call the policy refused before is now allowed. The call's ceiling and `COUNCIL_ADVISE_MAX_USD_PER_CALL` are unchanged: they still stop it. `council gate answer` on an advice gate re-checks `policy.json` the same way (the chain's expected cost, the gate's recorded ceiling): it prints the same "Policy warning:" line before the question, and refuses an approval the policy refuses (nothing is written, the gate stays pending); declining is always allowed, and a `policy.json` that cannot be read refuses an approval. An advice gate whose run folder is not inside a `runs/` folder cannot be approved at the terminal (its project's `policy.json` cannot be located, so the approval is refused; declining still works). With no `policy.json` the terminal prints what it printed before.

### Not verified in this release (stated, not hidden)

- **No real model has read any of the recorded prompts.** Every prompt change (judges, criteria seat, reviser, authors, handoff, lanes, `council contract draft`) was proven offline: the text reaches a mock seat that reacts to it and the parser accepts its reply. Whether a real model follows a sentence is the first paid run's finding. The new chains `plan-daily-7` and `plan-highest-7` (13 judges each) have not run at all.
- **Descending-chain forwarding** of the debate options is exercised offline only. **The cold read** is off in every shipped chain (its seat's model is not named); a resumed run's cold-read stage re-runs when its prompt changed. **Windows** and **the Wine smoke test's CI fix** are untested; the symbolic-link containment of the MCP tools is tested on Linux only.
- **Prices:** the seats added in 0.8.2 (the two single seats, MiMo V2.6 Pro) are priced from OpenRouter's public list by dry run only. The default $7 cap refuses `cheap-7-v2`, `plan-premium-7`, `plan-highest-7` and `plan-daily-7`: pass `--max-usd`.
- Nothing here claims any chain plans better than another; none of the mechanisms has been measured.

### Security

- **Symlink containment (ChatGPT review 1, F1b/F1c).** Every read of a file inside a run folder by an MCP tool that returns its text goes through `src/run-files.js` (the folder must be real and hold no
  symbolic link, and each file is opened with `O_NOFOLLOW` and `O_NONBLOCK` where the platform has them, so a FIFO cannot hang the server), and so does every write the server makes there (`submit_stage`'s
  answer and usage files, `stage_prompt.md`, `RESUME.md`, the dispositions record `advise-log.json`). `write_task` refuses a `tasks/<name>.md` that is a link and a `tasks/` folder that is a link or resolves
  outside the working folder. The advice ledger read on every quote reads each log and `run.json` the same way (a link reads as a damaged record, which fails closed). A test
  (`test/run-files-guard.test.js`) fails on any new bare file call in `src/mcp/`, `src/stage-submission.js`, `src/send-path.js` or `src/advice-guards.js`.
- **`run_tests` no longer passes provider keys to the test process** (F12/F13); the README's Known limits now says the tool runs trusted code with no sandbox.
- **Windows is untested.** `O_NOFOLLOW` does not exist there, so the containment rests on the `lstat` checks alone; it was tested on Linux only (the `.exe` smoke test under Wine does not exercise it). The README's Known limits says so.
- Not covered, on purpose: the CLI's own reads of a run folder (`--resume` and the rest) run on a person's own command; the spawn log `council-<timestamp>.log` in the working folder; the peer claim file, which is written by temp file and rename (that replaces a link, it does not follow it); and the aggregate tools (`spend_report`, `verdict_stats`, `metrics_report`), which read every run's `report.json` with plain file reads but return only numbers and chain and lab names from a shape-checked JSON.

### Added

- **A paid call's worst case is written to the run folder before it is sent** (item 8b; ChatGPT review 1 #4c; owner, 7 Oct 2026: "build it tonight"). `runs/<id>/spend-reservations.jsonl` (new, append-only, schema
  `spend-reservations/1`, amounts, stage labels and `provider/model` only) gets a `reserved` line, fsynced, before `invoke()` sends, and a `settled` line when the call returns or fails. A process killed in
  between used to leave nothing: the provider could bill the call while `council --spend` and a resume's cap saw $0. An unsettled reservation now stays charged at its worst case in a resume's cap, in
  `council --spend`, the spend report and `run_status` cost. There is no command to clear one and the figure errs high; the README's Known limits entry is rewritten to say so. If a reservation cannot be written, the
  call is not sent. Calls projected at $0 (every mock run, an ollama seat) write nothing. This is the one recorded figure in a spend derivation that is otherwise read back from the run folder (CLAUDE.md, "Cross-run spend").
- **The contract record: `council contract draft | lock | show | check | amend --decide`, and the MCP tools `contract_read` and `contract_amend`** (item 6d, the full Slice A of the 0.8.1 plan; owner, 7 Oct 2026:
  "we go with the full one"). After a run has ended, a person can lock a contract: obligations (an id and words) that a build session works against. A model drafts them (`contract draft --from-run`: one call on
  the run's handoff seat, under the same key scan, spend cap and policy gate as `handoff --from-run`; its prompt is recorded in `src/roles.js` with the 0.8.2 prompt re-record, and has been read only by a mock seat), a $0 lint checks the
  draft (shape, unique ids, no field named like an identity field), and a person reads the exact text and approves it at a terminal through the approval gate; only then does the harness write
  `contract/v1.json` and `CONTRACT.md`. A version is never edited. A build session that finds an obligation wrong files a request with `contract_amend` (free, decides nothing); a person decides it with
  `council contract amend --decide`, seeing the exact current and proposed words, and the result is a new version that names the old one, or a recorded refusal. `contract_read` returns the contract only after
  `council contract check`'s own checks pass, with the obligation text marked as model-written. The record is tamper-evident, not tamper-proof (the README says so). Two tools more: the landing page says 19.
  `council contract check` also checks a run's record (ledger, versions, approvals, `CONTRACT.md`); a run without one is checked exactly as in 6a. Schema: `schemas/contract-v1.json`.

- **Two single-seat advisors** for `council_quote` / `council_advise`: `advisor: "glm-flash"` (GLM-5.3 Flash, `chains/advise-single-glm-flash.json`) and `advisor: "qwen"` (Qwen3.8 Max,
  `chains/advise-single-qwen.json`). Qwen3.8 Max has no endpoint OpenRouter tags zero-data-retention, so a quote for it is refused unless the operator set the sensitivity floor to `public`.
  GLM-5.3 Flash has a new row in `src/advice-retention.json` (class B; its endpoint tags were read from OpenRouter's public list on 2026-10-06, Z.ai's own terms were re-read for this model on 2026-10-07 and do not differ by model).
  Each chain's own dollar ceiling is derived in its description ($0.07 and $0.75 as first built; GLM's was re-derived to $0.42 with its cap below). Both are priced by dry run only: no live call was made, so whether the 36,000-token output cap (Qwen) is enough at its default reasoning is not verified.

### Debate and sign-off (new options, ON in the seven shipped planning chains since the 0.8.2 prompt re-record; a chain of your own sets them itself, and a chain without them behaves as before. Two records are always written: the objection ids and `outside_criteria_rows`)

- **`signoff_table.required`** (owner decision 1, 5 Oct 2026): a judge's sign-off without a full per-criterion table (a row for every criterion, each with evidence) does not count. The seat is re-asked alone (once per round for a refused table; the existing re-ask is twice for an unreadable reply), then recorded as an abstention (`reason_code: "INCOMPLETE_TABLE"`), never as consent; heard clean verdicts are carried on an unchanged draft and the round cap still ends the loop. This changes when
  a run passes. Table rows that name none of the criteria are recorded (`outside_criteria_rows`), never counted.
- **`debate_hygiene.shuffle`** (decision 2): each debate reader gets its own seeded order of the proposals and its own lab letters (and a post's free text, "see A-2", is re-lettered for each reader); the canary target is picked by seed;
  `debate_orders` records what each reader saw, and `debate.posts[].text` is stored with real ids and lab names so one lettering reads the record.
  Hygiene and canary fairness, not a position-effect fix. **`debate_hygiene.noQuoteMarks`**: objections and merges record `quoted: true|false` (data only).
- **`answer_back.enabled`** (decision 3): after each revise the harness builds what each judge will see about its own earlier objections (ids, the writer's DECLINED reasons, the changed passages); `answer_back` in
  report.json summarises it. The harness also reads a judge's `answers` array about its own earlier objections: **a withdrawal with no quote found in the draft does not count** (the objection stays open and is carried
  into the judge's failures, so that judge no longer signs off), a sustained objection stays; `answer_back_replies` records each effect. That rule changes when a run passes. The judges' prompt now asks for `answers` from round 2 (it also shows each judge its own objections, the writer's reasons and the changed passages, wrapped as quoted text), and an `answers` status
  that is neither `sustained` nor `withdrawn` keeps the objection open. How a quote is read (audit fixes `cnc-prompts` F1/F2, `cnc-debate` F1, `73-verdicts` 1+3, `73-config` F1): quote marks are paired first, so a short quoted term before the real quote no longer
  turns the prose between two terms into a "quote"; a withdrawal's quote may be any length (no 400-character cap), straight and curly quotes and apostrophes are the same on both sides, and a quote that is empty once normalised (`________`) counts for nothing; in patch mode it must be found in the draft itself, never in
  a "Was:" block or the harness's own sentences; a debate post's short exact quote (4 characters or more once normalised, such as `Redis`) counts as quoted.
- **`council contract lock` lists, before the gate, the criteria no obligation names and any obligation marked `UNRESOLVED`** (a listing for the person, never a refusal), and `council contract draft` refuses a draft that names a criterion when the run has no readable criteria (the lint is given an empty list, not "unknown", so an invented `C1` no longer passes). From the second prompt review of 7 Oct 2026. Audit fixes (`cnc-contract` F1-F3): `council contract lock` does the same on a run with no criteria (it used to pass "unknown"); a text with a lone surrogate (not well-formed UTF-16) is refused in a draft and in an amendment
  request instead of being saved as a replacement character that made `contract check` fail for good; and `council contract check` of a contract locked from a thin contract fails (exit 1) when the run's `report.json` is missing, unreadable or has no `thin_contract`, where it used to pass.
- **A DECLINED line may name the objection it answers** (P13; owner, 7 Oct 2026): `DECLINED: O-1a2b3c4d: <reason>` (also `[O-1a2b3c4d] <reason>`, a dash or a space after the id, any case). `parseDisputes` returns the ids beside the
  reasons (`disputeIds`); `report.json` `disputes[]` keeps the reason without the id and gains the optional `objection_id`; with `answer_back.enabled` a reason is shown to the judge that raised that objection, next to it, and
  a reason with no usable id stays a reason for the round. A line with no id is read exactly as before. With `answer_back.enabled` the reviser's prompt gives the DECLINED form WITH the id (the one sentence that gave the old form is replaced, there are never two forms) and lists each failure's id after the failures.
- **`debate_hygiene.noQuoteMarks` now also covers the alternatives stage** (data: `quoted` on an alternatives post that objects or merges) and shows the author the mark `[no quote]` before the colon of the post, with one sentence on what it means and one asking posters to copy the phrase they talk about inside backticks. The canary is shown through the same mark and `report.json` `canary.no_quote_mark` says whether it was on.
- A stable `id` on each objection (`O-` and eight hex digits: the same lab, criterion and quoted text give the same id in every round) on `objections`, `open_objections` and the new records.
- The README documents `--criteria` for a task that already contains its own acceptance list.
- **`plan-lanes-4`, an optional lanes chain, and the `lane` seat field** (item 7; owner, 6 Oct 2026: lanes chain yes, optional, existing chains unchanged). One writer (Sonnet 5.5, no panel seat; it writes the draft, the revisions and the handoff: there is no skeleton stage without proposals) and three reviewers from three labs (GPT-5.6 Luna, Gemini 3.8 Flash, GLM 5.3 Flash) with a lane each (`correctness_interfaces`, `security_failure`, `implementation_verification`); no proposals or debate; unanimous sign-off, cap 7 rounds; reasoning high wherever the model takes a setting (GLM 5.3 Flash defaults above high, so none) and GLM's panel review allowed 360,000 tokens. `lane` is read on `seats.critics` only (chain-lint `invalid-lane` refuses it elsewhere, with an unknown id, or on a descending chain); every critic system prompt now goes through one function in `chain.js` that appends the lane paragraph, and `report.json` `panelVerdicts[].lane` names the lane when a seat has one. **The lane words are recorded in `src/roles.js` (`LANE_TEXT`, P11, with the 0.8.2 prompt re-record)**: a lane seat's system prompt carries its paragraph (look there first and hardest; a row for every criterion still; "no defect in my lane" goes in `verdict_line`); no seat has read them but mock seats; no existing chain has a lane. Dry run $1.62; the spend cap's worst case about $6.3 over seven rounds at the chain's estimate sizes (about $8.9 if every GLM review were cut off and retried, which the cap would stop). Not verified: whether OpenRouter routes around a zero-data-retention endpoint that does not accept 360,000 completion tokens or refuses the call (8 of 17 accepted it for the add-on seat on 2026-10-06). The reasoning table gained its row for Sonnet 5.5 (`reasoning: { effort: "high" }` through OpenRouter; its own default is high, reasoning cannot be turned off) and was regenerated by `scripts/refresh-reasoning-table.mjs` on 2026-10-07 (two rows for models no shipped chain uses any more left it: an archived chain copied back into a project, such as `cheap-7`, gets the default retry ceiling for them until the table is regenerated with it). No efficacy claim: the roster is a starting hypothesis and cannot be measured without ground truth.
- **A $0 lint for seat-written milestones** (item 6c): `handoff_contract.milestones` (chain, default off; on in the seven shipped planning chains since the prompt re-record, where the handoff seat is asked for the milestone shape) parses the handoff for `Status:`, `### M<n> - title` milestones with `Entry`, `Work`, `Exit` (`- check: <what> => <expected>`, `- discharges: C1, C3`) and a final checklist, and records findings (`no_milestones`, `no_status`, `bad_status`, `duplicate_milestone`, `milestone_no_check`, `check_without_expected`, `unknown_criterion`, `criterion_not_discharged`) in the new optional `report.json` field `handoff_milestones`, `WARNINGS.md` and the harness-written "Before you build" section. The stage contract for the handoff lists `milestones` and `final_checklist` only with the flag on. The words that ask a seat to write this format (a `HANDOFF_SYSTEM` change, 600 -> about 1,500 words) are NOT live: they wait for the owner's prompt list and the one re-record, so today no shipped chain produces milestones.
- **A criterion counts as discharged only by a check that names it** (check-to-criterion link; owner, 7 Oct 2026: "Yes"; only with `handoff_contract.milestones`, on in the seven shipped planning chains since the prompt re-record; the format a seat is asked for). A check is written `- check: C1, C3 | <what> => <result>`; the ids before the first `|` count only when that part is nothing but criterion ids (a shell pipe in a check is not read as a list). `criterion_not_discharged` now means "no check names it" (it used to be satisfied by a `- discharges:` line next to any check); a `- discharges:` line is optional and, when present, each criterion on it must be named by a check of the same milestone (new finding `discharge_not_checked`); `unknown_criterion` also covers a check that names a criterion the run does not have. `report.json` `handoff_milestones.findings` carries the new kind. The seat's check objects gain `criteria` (parser output, not report data).
- **The milestone lint also reports a Status that is not `ready_for_build`** (item 10h): `blocked`, `needs_evidence`, `needs_decision` or `partial` is a finding (`status_not_ready`), so it reaches `WARNINGS.md`, `report.json` and the "Before you build" block of HANDOFF.md instead of sitting in one JSON field. `council metrics`' tool-call figure counts the `- check:` lines of a milestone-format handoff (item 10g; it read zero items on one). Both only with `handoff_contract.milestones`, which no shipped chain sets yet.
- **One objection id is one entry** (found by the review of the wiring block): the same lab, criterion and quoted text give the same id by design, so several unquoted problems a judge lists under one criterion are shown to it, and answered, as one objection with the problems joined; a passage a judge copies from the answer-back section (a heading shows as `\\##`, a defused tag as `&lt;`) is matched against the draft with those escapes undone.
- **`council contract check runs/<id> --handoff HANDOFF.md`** (item 6b) compares the record hash printed in a HANDOFF copy with the run's: the copy a builder holds is the one the run's own files cannot be edited to match.
- **The thin contract and `council contract check`** (item 6a; owner, 6 Oct 2026: thin contract yes, not the full CONTRACT.json). `report.json` gains an optional, experimental `thin_contract`: the task, criteria, checks, evidence and signed-text hashes (all 64 hex; the signed text's is item 4's `signed_text.sha256`, read, not defined again) and one `sha256` over the record. The evidence is what the run recorded as shown, the `--context` documents and the tool results, not a repository (seats never see one, so a repo hash would certify something the run did not check). `council contract check runs/<id>` is $0 and read-only: it recomputes the criteria, the task file, the context documents, the stored tool results, `deliverable.md` and `HANDOFF.md` and prints `ok`, `DRIFT` or `cannot check` per item; exit 1 on any drift, 2 when nothing could be checked, otherwise 0. It is tamper-evident, not tamper-proof (whoever can edit `report.json` can edit the record too). Absent for advice runs and for runs with no criteria or signed text. What it does not cover, said plainly: material handed in with `--draft` or `--from-run`; on a `--resume` the tool results are those collected in the sitting that wrote `report.json`; a descending chain does not forward its tool results, so its record seals none; two runs with identical inputs share a record (the HANDOFF line names the run, and `--handoff` compares both); and the hash input is the canonical JSON defined in `src/thin-contract.js` (keys sorted by UTF-16 code unit, strings escaped as `JSON.stringify` does, undefined fields absent). `council contract check` exits 2 when nothing outside `report.json` (the task file, the context documents, `deliverable.md`, `HANDOFF.md`, a copy) could be compared: the record agreeing with itself is not a seal. On a case-insensitive disk (macOS, Windows) a resume after a crash between writing `HANDOFF.md` and `report.json` can stack the new sections twice (the same narrow window as the banner).
- **Signed text and delivered text are labelled, never re-judged** (owner, 6 Oct 2026: label only). `report.json` gains three optional objects (schema `report-v1` updated; `passed` is untouched):
  `signed_text` (sha256 of the draft the panel last reviewed, the round, `signed_off`; for an unsigned run `label: "not_accepted"` and `open_objections`), `delivered_text` (sha256 of `deliverable.md`,
  the sha256 of the model-written body, `same_as_signed`, `changed_by` from `dispute`, `challenge`, `final_edit`, `harness_notes` from `dissent_block`, `cold_read_block`, and `re_reviewed: false`) and, in a chain
  with a handoff stage, `handoff_text` (`made_from_sha256`, `made_from_signed`, `panel_reviewed: false`, and `file_sha256` of `HANDOFF.md` as written, only when that run wrote the file: not in a `--rematch` or `--replay` report). `BOARD.md` gets a "Signed text and delivered text" section
  only when there is something to say (an unsigned run, a changed or noted text, a degraded finish) and a board exists. The panel is not run again on a changed text: the label says so, it does not repair it. The run result of `runChain` carries `signedText`,
  `deliveredText` and `handoffText`. The MCP `run_status` sentence for a signed run whose delivered text differs now keeps its start and appends to it: `done: every lab signed off, on the signed draft; the delivered text differs (changed by the final edit)`, so a matcher on "every lab signed off" still matches.

### Changed

- **A policy's `max_usd_per_run` warns when only the dry run's maximum is over it** (item 8c; owner, 7 Oct 2026: "make it a warning, not a refusal"). The limit still refuses a run whose expected cost is over it, exactly as before, and
  the refusal message now names both figures. When the expected cost fits but the maximum (every call at its whole output allowance, the second figure `--dry-run` prints) is over the limit, the run starts with a
  warning that names both figures and the limit: printed in the dry run and at the start, written to `WARNINGS.md` and added to `--dry-run --json` as `policyWarnings`. Only the spend cap stops a run that goes past the limit.
  `docs/policy.md` says so.

- **The never-lower check also refuses an explicit effort below the model's own default** (owner, 7 Oct 2026: "Yes"). Three models in `src/reasoning-table.json` default above "high" (GLM-5.3, GLM-5.3 Flash: "max"; Qwen 3.8 Max: "xhigh"). A shipped chain that wrote `reasoning.effort: "high"` (or any word below the model's default) on one of them was reasoning LOWER than leaving the field out; chain-lint's `reasoning-not-high` now refuses that. A chain of your own passes through as before, and no shipped chain tripped it.
- The README's chain table adds `plan-daily-7`; the README and the landing page now recommend those five chains, and the Gemini 2.5 limit counts the two chains that still seat it (`verify`, `us-only`).
- **Four small fixes from ChatGPT review 2** (each has an offline test that reads the real next prompt): (F3) a tool result a debate seat asked for (`tools.seat_requests`, in no shipped chain) now reaches the replies, the build and the critics as a block headed "Ground truth from the debate (tool output, verbatim)"; before, it was recorded in `ground_truth` and shown to nobody. A chain without seat requests sends the same prompts as before. On `--resume` the seat's tool requests are run again, so a run paused under 0.8.1 with seat requests is re-asked after its debate, and so is any run whose tool output differs between sittings (the stage-cache staleness warning says so); this only concerns runs with `tools.seat_requests`. (F5) `result_ref` on a seat-requested `ground_truth` entry is now run-wide, `<tool>:<position among that tool's entries>` (so the first seat-requested `check_versions` after a config-time one is `check_versions:1`; it used to be `check_versions:0` for every seat), and a claim that cites a bare tool name is accepted only when one entry carries that tool. The ground-truth block does not show these ids to a seat, so a claim in a run with two entries for one tool is dropped with a warning unless it names an id; showing the ids is a prompt change, held for the owner's list. (F11) was already closed by the cold-read work above (a descending chain reads once, over the final stack; a test pins it), so no lint refusal was added: it would refuse a combination that works. The stage contract shown to an external seat for the reply stage said `"proposal"` where the code reads `"id"`; it now says `"id"` (the reply format, which is public, is unchanged).
- The release-binaries workflow looks for `wine64` or `wine` instead of assuming a `wine64` command (the step failed with exit code 127 on current Ubuntu runners). Untested until the workflow runs.

## 0.8.1 - 2026-10-06 (BREAKING for scripts and clients that rely on the changes listed under "Changes that can break a script or a client")

The council advisor add-on and the contracts floor (the approval gate and its ledger), the stop rule, reasoning always high in the shipped chains, the
plugin settings dialog for keys, and the fixes for what a review of 0.8.0 found. The sections below say what each part does and how it was checked; nothing
in them claims the council advises better than one model, and nothing was measured to say so.

### Added
- The council advisor add-on (experimental): `council_quote` and `council_advise`, the advice chains, `council gate`, `council advise-rate`, `council stop`, exit 18 (below: the add-on, the gate and its ledger, the stop rule).
- `reasoning-not-high`, a chain-lint rule, and `src/reasoning-table.json` (below: reasoning is always high).
- Provider keys in the Claude Code plugin's settings dialog (below), and the npm package's file count as a test.
- `report.json`: `field_cuts`, `checks_sha256`, `panelVerdicts[].no_answer`, `stages[].cappedAt` and `noAnswer`, `advise` (all optional and additive).

### Changes that can break a script or a client
Checked against `v0.8.0` (the advisor tools, `council gate`, `council stop`, exit 18 and the advice chains are new in this release, so they change nothing that worked before). Differences from 0.8.0 that a script, a client or a habit can notice:
- A task or context file that assigns a 20-character-or-longer value to a German key name (`passwort`, `kennwort`, ...) now stops with exit 11 (0.8.0 let it through).
- MCP tools that return text from a run folder (`read_run_file`, `run_status` with `brief`) return three text blocks: the file is in the second (0.8.0 returned the file as the first and only block).
- Every shipped chain now reasons at high: the worst-case prices rose (table below), the retry after a reply that spent its cap thinking no longer turns thinking off, and a run paused under 0.8.0 on a changed chain re-pays its stages on resume.
- An external seat's answer is now written to `<label>.md.partial` and renamed to `<label>.md` when it is whole (FX-13): a seat that edited `<label>.md` in place used to trigger a resume on partial text.
- `--max-usd=50` (and every other `--name=value` spelling of a flag that takes a value) is now read. Before, the `=` form was ignored without a word and a run got the default $7 cap, so a script that
  used it spent under a different limit than it wrote.
- A flag that takes no value, spelled with `=` (`--dry-run=true`), is now refused with exit 2 (0.8.0 ignored it, so `--dry-run=true` started a real, paid run under the default cap).
- `council handoff --from-run` exits 13 while another process holds the run's lock, and when `HANDOFF.md` already exists it writes `HANDOFF-from-run.md`, then `HANDOFF-from-run-2.md` and so on (it never replaces a file).
- `council check-lock FILE --run RUN` now exits 2 when the run's `report.json` has no criteria list (0.8.0 printed "criteria lock holds" and exited 0 without comparing anything).
- A key that is set but has a control character in it (a two-line paste) is never sent: the call fails with a plain message, `council doctor` says "set but malformed", and the provider's own error
  text no longer carries the key (0.8.0 printed it in the error, the log and `report.json`).
- A project `.env` no longer sets `NODE_*` (except `NODE_ENV`), `LD_*`, `DYLD_*`, `PATH`, the proxy variables, `OPENSSL_*`, `SSL_CERT_*`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE`, `GIT_*`, `BASH_ENV`, `ENV`, `PYTHON*`, `HOME`, `TMPDIR`, `COUNCIL_PLUGIN_*` or `COUNCIL_ALLOW_LOOPBACK_KEY_HOST` (details in the reasoning section's
  list below); each ignored name is reported once on stderr.
- The add-on's `calls_at_most` is now 2 / 9 / 18 for `advise-single` / `advise-standard` / `advise-premium` (it was the row count 1 / 6 / 12: it now counts a retry of a cut-off reply, each debate reply and
  the synthesis, and an Anthropic seat's own repeat). The terminal command a person is told to type to approve is `<node> <path>/src/cli.js gate answer <absolute run folder> <gate>`
  (it was `council gate answer runs/<id> <gate>`, which failed under a plugin install and from another folder).
- Three add-on ceilings rose with the price refresh below (what the person approves in the dialog): `advise-standard` $1.20 -> $1.40, `advise-premium` $6 -> $6.50 and `advise-single-deepseek` $0.05 -> $0.07.
- `council --spend` and `run_status` know three more states for a run stopped short (a task refused before any stage, a draft that did not complete, a key-shaped prompt); `needs` in a run's
  resumability has a new value, `replace_reply`; `hidden_removed` may carry `invisible_characters` (all additive).
`report.json` changes are additive.

### Fixed: found by the pre-release audit (2026-10-06; each has a test that failed before its fix, `test/regression-081-audit-*.test.js`)
- Spend and money: an advice call whose blind wave would pass the run's `--max-usd` is stopped before any seat is called, with nothing spent (it used to pay some seats and abort); a cap that is not a
  number above zero in a run's `run.json` fails closed instead of reading as no cap; an advice retry starts from the cap the reply was really asked at (no second identical paid call) and a long, complete
  reply of an Anthropic seat that merely fails to parse is no longer read as cut off against the original cap; a `cappedAt` read back from a usage file is never below the seat's own cap.
- Reasoning fields: a seat that carries a reasoning field of any spelling gets no harness default beside it (Google rejects `reasoning_effort` next to `thinking_config`); the single-vendor reroute drops
  only `output_config.effort` and leaves the seat's own different field alone; the lowering check also sees `extra_body`, `include_reasoning: false`, top-level `thinking_budget` / `thinking_level` and `thinkingConfig`.
- The approval path: the dialog and `council gate show` fence the text with a dash line longer than any dash run in it and name the text's length and last line after it (a text could fake its own end);
  the terminal command works from any folder and under the standalone binary.
- The 0.8.0 fixes: `council handoff --from-run` takes the run's lock like `--resume` (exit 13) and writes with an exclusive create, so it can no longer replace a finished run's `HANDOFF.md`
  (also on a case-insensitive disk: FX-9); FX-15 widened a "Disputed" strip so a plan paragraph starting with that word vanished from the draft: the build stage and the readers it added strip DECLINED lines only;
  the MCP status budget of a finished run counts a later handoff call; a run stopped by a key-shaped prompt, a refused task or a cut-off draft reads right in `council --spend` and in the handoff banner;
  a builder reply of only DECLINED lines gets its own stop text.
- The add-on's surface: a stage bundle says its referenced files are data; the return path also removes LRM, RLM and ALM and counts zero-width spaces and word joiners; a corrupt stop marker reads as "spend unknown".
- Documentation: `council doctor`'s "Start here" no longer points a newcomer at the add-on's advice chains; the README's masking, gitignore and Known limits; a private project name and a home path left in a usage
  string and a chain description; the red-test dates; the landing page, report-format and skills page drifts.

### Fixed: the 0.8.0 defects found by the review after release (each has a test that failed before its fix, `test/regression-081-*.test.js`)
- FX-1: a second `council handoff --from-run` overwrote the first call's cost record. FX-2: a later `--resume` did not count that call toward the run's cap.
- FX-3: `--dry-run --json` gave `worstCaseWithTaskUsd: null` for a chain with no `estimate` and a long task. FX-4: `council check-lock` called an untouched CRLF `HANDOFF.md` edited.
- FX-5: an `AMENDMENTS.md` reason quoting a full commit hash was read as the new task hash. FX-6: `handoff --from-run` wrote no lock block, silently, when `criteria.md` needed JSON repair.
- FX-7: `state.json` said `running` after a stop for a cut-off draft, a preflight objection or a key-shaped prompt. FX-8: a key-shaped stop read as resumable with nothing to do.
- FX-9: on case-insensitive file systems `handoff.md` and `HANDOFF.md` were one file. FX-10: the criteria fingerprint covered a criterion's wording, not how it is checked (`checks_sha256`).
- FX-11: whole architectures, debate posts and critic fields were cut at 2,000 characters, silently; each kind keeps what its seat was allowed to write, and every cut is listed in `WARNINGS.md` and `report.json` `field_cuts` (below, "Proposals may use a seat's whole output allowance").
- FX-12: proposal output limits were too low for reasoning models (two seats were cut off and paid twice); every shipped non-mock chain now allows 12,000 tokens per part (same section).
- FX-13: a seat that edited its external answer file in place for minutes exposed partial text, and the run resumed on it. The `NEEDS-<label>.md` text and `prepare_stage_prompt` now tell the seat to write `<label>.md.partial` and rename it when it is whole; the harness never reads a `.partial` file; `submit_stage` writes in one step and is unchanged.
- FX-14: `council handoff --from-run` on an advice run made a paid call and read the answer as signed off; it now refuses an advice run.
- FX-15: a builder's trailing DECLINED lines stayed in the draft (the section below).

### The web home moved to https://sower-industries.de/en/THC/ (0.8.1, owner D4)

- The npm `homepage`, `server.json`, the plugin and bundle manifests, the README link and the landing page's `rel=canonical` and `og:url` name
  https://sower-industries.de/en/THC/ (checked by curl on 5 Oct: it and the install page /en/THC/2/ answer 200; /MCP, /en/MCP/ and /en/Council/ answer 301 to it).

### The Claude Code plugin asks for provider keys in its settings dialog (0.8.1 M9)

- `.claude-plugin/plugin.json` declares one optional, sensitive `userConfig` field per provider that needs a key (derived from `src/providers.js`;
  ten today) and maps each onto `COUNCIL_PLUGIN_<LAB>_API_KEY` in the server's `env`: never onto the standard variable, so a field left empty cannot
  replace a key exported in your shell (seen in a scratch plugin: Claude Code passes an empty string for an unset optional field). One helper,
  `src/key-env.js`, reads every key: the dialog value when usable, then the standard variable, then `.env`; empty, whitespace-only and an unsubstituted
  `${user_config.` placeholder count as unset, and the `.env` loader now fills such a variable too. `plugin.json` keeps the `${user_config.*}`-only rule in
  a test (it used to assert no `env` at all). The environment-variable and `.env` routes work as before.
- The npm package's file count is a checked condition (`test/plugin-file-count.test.js`, at most 512; 186 today). The repository root stays the plugin
  (the owner declined a `plugin/` directory, plan MAN-6). `claude plugin validate .` passes with one warning; `--strict` reports "CLAUDE.md at the plugin
  root is not loaded as project context" and fails on it (Claude Code 2.1.289; it passed when the plan was written).

### A builder's DECLINED lines no longer reach the draft (0.8.1 FX-15)

- The build stage did not parse `DECLINED: <reason>` lines (only reviser stages did), so a builder reply ending in them (an external
  session above all) kept them in the draft every critic graded and in the deliverable, and `report.json` `disputes` stayed empty. They are now
  stripped and recorded in `disputes` with round `"build"` (the board reads "declined by the builder or the reviser"); a reply made only of
  DECLINED lines stops the run (`stage "build" did not complete (stop: declined_only)`) instead of grading an empty page.
  Only the DECLINED lines are removed from a builder's reply: a paragraph that starts with "Disputed" is plan text there (the reviser stages still strip a trailing Disputed block, as in 0.8.0).
- `--from-run` and `council handoff --from-run` read a builder's (or reviser's) raw `build.md` / `revise-N.md` back as a draft; both now strip the
  same lines (a finished `deliverable.md` or `final.md` is returned as it is), through one function (`src/draft-disputes.js`, which also holds `parseDisputes`), and a test scans `src/` so a new reader cannot skip it.
  The final-edit stage is not routed through it: its prompt has no DECLINED channel.

### Reasoning is always high for a shipped chain (0.8.1 milestone R; owner, 4-5 Oct 2026)

- **Every seat in a shipped chain reasons at high, and no code path lowers it.** 22 shipped chains had a seat set below
  high or switched off: 37 Claude Sonnet 5 seats and 9 GLM-4.7-flash seats with thinking disabled, 8 Qwen3.5-plus seats
  with reasoning off, 9 Qwen3.5-9B seats and 8 DeepSeek V4 Flash seats (both on Together) with thinking off, 8 seats at `low` and 8 at
  `medium` (counted by command over the chains at the base commit). Each of those settings is
  gone and the seat says high in its own provider's field. `src/reasoning-table.json` (read 2026-10-05, from the providers'
  documents and OpenRouter's public model list; written by `scripts/refresh-reasoning-table.mjs`) holds that field per
  model, the model's own default and its largest reply. A new chain-lint rule, `reasoning-not-high`, refuses a shipped chain
  whose seat is below high (no opt-out; a chain whose seats are all mock is excepted). It binds the chains in this package
  only: your own chain is not refused, a setting you write in it is sent as written, and a seat of yours with no reasoning
  setting gets the high default for any model the table has a field for.
- **Models that default above high are left at their default.** GLM-5.3, GLM-5.3 Flash (default `max`) and Qwen3.8 Max
  (`xhigh`) are sent nothing: "high" would run them lower. GLM-5.3 Flash's old `low` is removed; its cap is the uniform
  36,000 on every stage and 360,000 for the panel review only (`panelMaxTokens`, as `plan-open-7` already had it).
- **DeepSeek V4 Flash on Together** ran with `chat_template_kwargs.thinking: false` in eight chains. It now sends
  `{thinking: true, reasoning_effort: "high"}`, the switch vLLM's serving recipe for the model documents; Together's own page for it
  was not found, so this on-value is unconfirmed on Together.
- **Claude Haiku 4.5 has no effort levels**, so its "high" is thinking on with a token budget of half the seat's output cap
  (at least 1,024); the cap grew by that budget (`cheap`, `seven-cheap`, `smo`, `single-vendor-anthropic`).
- **The retry no longer turns thinking off.** An Anthropic seat whose thinking used its whole `maxTokens` was retried with
  thinking disabled. It is now retried once with the same request and a bigger cap (double, up to the model's maximum and what
  a direct call can return, 64,000 for Anthropic); at that limit it is not retried, and the seat is recorded as
  `no answer: thinking used the whole cap` (`panelVerdicts[].no_answer`, a new optional field; the seat is unheard, never a
  pass). The spend cap now projects the first attempt plus the bigger retry (it was twice the first), and a call that fails
  after it was sent is charged the worst case of the attempt that failed. A seat that went from thinking off to on has its cap
  raised to at least 36,000 (its old cap was sized for no thinking); DeepSeek V4.1 Flash seats outside the advice chains have
  360,000 ($0.60 per million output tokens, about $0.22 a call at the cap). **The dry-run prices below do not cover those two cap
  raises** (a planning chain's dry run prices a critic at the chain's own estimate, not its cap); only the spend cap's projection, per stage,
  sees them, and it can stop a run before the dry-run total.
- **A retry never repeats a paid call.** An outer cut-off retry (a panel critic, a draft, a proposal, an alternative) now starts from the cap
  the reply was really asked at and is skipped when there is no room, where an Anthropic seat would have been asked twice at 64,000. A
  seat whose cap is above its model's own maximum is no longer re-asked at the same cap; the shipped chains' Llama 4 Maverick seats (36,000) and
  Llama 3.3 70B seats (20,000) are now set to the model's own 16,384, a model limit and not a lower effort (a test keeps every shipped seat at or
  under its model's maximum).
- **`advise-single` (the add-on's default seat) has a 36,000-token reply cap** (was 12,000), and its own ceiling `advise.usd`
  is $1.32 (was $0.30): it covers the first call and one retry of a cut-off reply at the 64,000-token retry cap, so a cut-off answer gets more
  room instead of dropping the seat (a retry is reserved at its worst case on top of what the first call cost; the dearest brief the add-on
  prices, 48,000 characters of non-ASCII text, is $0.503 for the first call and $0.811 for the retry). Worst case of one call at a 3,000-token
  brief $0.14 -> $0.40. The tool description's "at most" follows the ceiling, and the per-call guard ($1.50) still holds it. The other advice
  chains are unchanged.
- **A project `.env` can no longer set what changes how the process runs.** `NODE_*` (`NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_ENV_PROXY`), `LD_*`, `DYLD_*`, `PATH`,
  `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, `OPENSSL_*`, `SSL_CERT_*`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE`, `GIT_*`, `BASH_ENV`, `ENV`, `PYTHON*`, `HOME`, `TMPDIR`, `COUNCIL_PLUGIN_*` (the plugin settings dialog's own variables) and `COUNCIL_ALLOW_LOOPBACK_KEY_HOST` are ignored
  when they come from `<work>/.env`; each ignored name is reported once on stderr. Set them in the real environment. Why: `.env` is part of the project, which an agent
  or a cloned repository can write, and `NODE_OPTIONS=--require ./x.cjs` there ran code in every child process that holds the provider keys when the server starts as
  `council --mcp`. A key line still fills a standard variable the environment lacks, and a key that is set but malformed (a line break inside it) is no longer replaced by it.
- **Scores from `gp-judge-v1` change from this version on.** The judge's Sonnet, Qwen and DeepSeek seats ran with reasoning off and now run at
  high, so earlier and later GP scores are not directly comparable. Nothing here measures which are better. Its Mistral and Gemini seats' output
  caps are 36,000 (were 8,000), the uniform seat cap.
- **A run paused under 0.8.0 on one of the 41 changed chains is not replayed on resume.** A resume loads the chain by name from this package, the
  run's config fingerprint no longer matches, so its stages are set aside and paid for again (the old cost still counts toward the cap).
  Finish such a run on 0.8.0, or start it again. A stage's usage file also gains two optional fields, `cappedAt` and `noAnswer`, so a resume of a
  0.8.1 run replays a retried stage for free.
- **Not exercised in a live call.** Every field was set from documents; no paid call was made. A provider that rejects one fails
  that seat's call with its own error, and the first real run of each changed chain is the test. The table is dated and a release
  test fails when it is more than 60 days old.
- Worst cases (dry run, default task size, prices of 2026-09-06), before and after this change; a run that signs off early
  costs far less. Only the chains whose figure moved are listed:

  | Chain | Before | After |
  |---|---|---|
  | `advise-single` (12,000-character brief) | $0.14 | $0.40 |
  | `cheap-7-v2` | $11.09 | $11.10 |
  | `gp-judge-v1` | $0.048 | $0.051 |
  | `idea-open-c2` | $1.12 | $1.30 |
  | `plan-auto-mistral` | $1.86 | $2.40 |
  | `plan-auto` | $3.17 | $3.92 |
  | `plan-daily-7` | $4.88 | $5.08 |
  | `plan-debate-c2` | $1.12 | $1.30 |
  | `plan-debate-open-c2` | $1.12 | $1.30 |
  | `plan-debate-roles-c1` | $1.12 | $1.30 |
  | `plan-debate` | $3.13 | $3.88 |
  | `plan-highest-7` | $16.00 | $16.19 |
  | `plan-open-7` | $4.34 | $5.65 |
  | `plan-proposals-best-of-5` | $3.04 | $3.05 |
  | `plan-proposals` | $1.46 | $1.63 |

  The table in "Changed for every run" below shows the figures before this change.
- **Four OpenRouter price rows were raised to OpenRouter's own list on 2026-10-06** (pre-release audit): the spend cap projects against `src/pricing.json`, and these rows
  were below the list, so the cap projected less than the real price. DeepSeek V4.1 Flash $0.15/$0.60 -> $0.30/$1.20 per million tokens (in/out), Llama 3.3 70B $0.10/$0.32 -> $0.22/$0.50,
  GLM-5.3 output $4.40 -> $7.00, GLM-5.2 output $3.99 -> $12.00. A row above the list is never lowered, and a row with an expiry date is not touched. The worst cases that moved
  (dry run, default task size): `cheap-7-v2` $11.10 -> $11.22 (its run command is now `--max-usd 11.23`), `plan-daily-7` $5.08 -> $5.70, `plan-highest-7` $16.19 -> $17.34,
  `plan-premium-7` $35.89 -> $36.75, `plan-open-7` $5.65 -> $6.08, `plan-proposals-best-of-5` $3.05 -> $3.10; the add-on's council `advise-standard` $0.87 -> $1.15 (12,000-character brief) and
  $1.23 at the 48,000-character limit, so its own ceiling `advise.usd` went $1.20 -> $1.40 (and `advise-premium`'s $6 -> $6.50; each covers the worst case at a 30,000-token brief, $1.38; still within the add-on's per-call $1.50 and session $3 limits). The script
  `scripts/refresh-openrouter-prices.mjs` re-reads the list and does this; `npm test` turns red on 2026-11-21 (46 days after its last run). Not covered: the list's headline price is
  one endpoint's, and a call may fall back to a dearer endpoint (the dearest eligible one is up to several times the list for a few models); the rows do not price that. The rows of
  the direct providers (Anthropic, OpenAI, Google, ...) were not re-read in this pass.
- Tests: the Anthropic-through-a-vendor retry test and the two advise-single price tests were superseded by these orders (the
  broken-reply fixtures are kept; the assertions now say "same request, bigger cap, high on every attempt" and the new prices).
  `src/reasoning-table.json` is a packaged asset of the standalone binary.

### Changed for every run

- **The default-on outbound key scan reads German key names too** (thc-research brief 25): `passwort`, `kennwort`,
  `zugangsdaten`, `api-schluessel`/`api-schlüssel` and `zugangsschluessel` in a named assignment, and `PASSWORT=` in an
  environment-style one. It runs on every run, not only advice calls, so a task or context file that assigns a value of 20
  or more key-like characters to one of these names now stops with exit 11 where it used to go through. Remove the value, or
  pass `--allow-secret-shaped` for that run as before.
- The PII gate also finds IBANs printed in groups of four (`DE89 3704 0044 ...`), with the same checksum test.
- **Proposals may use a seat's whole output allowance** (0.8.1 FX-12): every shipped chain that is not a mock chain
  sets `proposals.maxTokens` (per part) to 12,000, so a 3-part proposal call asks min(seat cap, 3 x 12,000 + 300) =
  the seat's own 36,000 (reasoning seats were cut off at 12,300 and paid twice). A cut-off proposal is retried once at
  up to 64,000, as a critic's reply is. **Whole architectures, debate posts and replies are no longer cut at 2,000
  characters** (FX-11): they keep what their seat was allowed to write (at least 40,000 characters), critic fields keep
  8,000, and every cut is listed in `WARNINGS.md` and `report.json` `field_cuts`. The dry run now prices both, and
  proposal calls at what the call can really produce. Worst cases (dry run, default task size, prices of 2026-09-06 with Qwen3.7 Plus at its list price of 2026-10-03),
  before and after; a run that signs off early costs far less:

  | Chain | Before | After |
  |---|---|---|
  | `cheap-7-v2` | $5.38 | $11.09 |
  | `cheap-7` | $2.85 | $6.01 |
  | `idea-open-c2` | $0.81 | $1.12 |
  | `plan-auto-mistral` | $1.34 | $1.86 |
  | `plan-auto` | $2.20 | $3.17 |
  | `plan-daily-7` | $1.93 | $4.88 |
  | `plan-debate-c2` | $0.69 | $1.12 |
  | `plan-debate-open-c2` | $0.81 | $1.12 |
  | `plan-debate-roles-c1` | $0.81 | $1.12 |
  | `plan-debate` | $1.76 | $3.13 |
  | `plan-highest-7` | $11.21 | $16.00 |
  | `plan-open-7` | $2.49 | $4.34 |
  | `plan-premium-7` | $22.30 | $35.89 |
  | `plan-proposals-best-of-5` | $1.30 | $3.04 |
  | `plan-proposals` | $1.02 | $1.46 |
  | `plan-two-strong` | $1.50 | $2.54 |

  `cheap-7-v2`, `plan-premium-7` and `plan-highest-7` are above the default $7 cap at their worst case: give them a
  `--max-usd`. The "After" column includes M7's Qwen3.7 Plus list price (0.40 / 1.60, was a 20%-off 0.32 / 1.28): it moved
  `cheap-7-v2` from $11.04, `plan-open-7` from $4.25 and `plan-highest-7` from $15.95.
- **MCP tools that return text from a run folder now mark it as model-written** (0.8.1 decided rule 5b). `read_run_file`
  and `run_status` with `brief: true` return three text blocks: a notice written by the harness, the text between markers
  whose id changes on every call, and the closing marker; Unicode tag characters and bidi controls are removed and
  counted (the file on disk is unchanged). JSON results that carry such text (`run_status`'s `lastLogLines`,
  `keyLines` and `signoff`, `list_runs`' `lastLogLines` and `signoff`, `plan_outline`'s `sections` and `ledger`, `external_prompt`'s `prompt`, and
  the `logTail` of `start_run`, `resume_run` and `submit_stage`) stay JSON and gain `untrusted_fields` and
  `untrusted_notice`. Every result marked so carries `_meta["io.github.muad-yasin/the-high-council"].trust`. A reader
  that took `read_run_file`'s first block as the file now finds the file in the second. Which tool returns what is one
  table, `src/mcp/untrusted.js`; a tool missing from it is refused at registration. This is a label, not a filter.

### Prices, routing and retention data (0.8.1 M7)

- **Price rows may carry `"expires": "YYYY-MM-DD"`** when a price is known to change. `gpt-5.6-sol` (OpenAI's promotional 2 / 10,
  "at least through" 2026-11-21; list 4 / 20) and `gemini-3.8-flash` (doubles to 1.50 / 7.50 on 2027-01-01) carry one. Past the
  date, `council doctor` and `--dry-run` print a warning (and `--dry-run --json` / `dry_run` list it under `priceTable.expired`); the price itself is not switched (a test fails the release instead).
- **`qwen3.7-plus` is priced at its list 0.40 / 1.60** (0.32 / 1.28 was a limited-time 20% discount, so the cap under-projected):
  `cheap-7-v2` $11.04 -> $11.09, `plan-open-7` $4.25 -> $4.34, `plan-highest-7` $15.95 -> $16.00 at their worst case.
- Tests restate decided rule 1 over the shipped advice chains (no xAI/Grok, no router id, no Kimi K3; every seat priced and in the
  retention table, which must be at most 30 days old at release) and refuse each OpenRouter router id one by one.

### The stop rule: exit 18 for an advice call (0.8.1 M6, decided rule 6)

- **An advice call can be stopped before it finishes** by a person (`council stop runs/<id>`), by the MCP client that cancelled
  the call or went away, or by its chain's wall clock (`advise.max_wall_ms`). Calls already in flight finish and are recorded;
  nothing new starts (a wall-clock stop cuts a call still running at the deadline, which is recorded as not answering); the run
  exits **18**. It writes `report-partial.json` (the answers that were paid for, rolled up under
  `advise` with `advise.status: "stopped"`; nothing paid: no `advise` and a total of $0), `BOARD-partial.md` when anything was paid
  for (its first line names the cause), `STOPPED-<stoppedBy>.json` (`stopped/1`: `stoppedBy`, `beforeFirstCall`, `spentUsd`,
  `resumeAfterStop`) and `state.json`; an adopted call adds a `stopped` line to its gate ledger. **Changed:** before, a stop that came
  after the first paid call was not an exit: the run skipped its remaining stages and wrote a `report.json` with
  `advise.stopped_by`; a stop before the first call wrote `STOPPED-user.json` for every cause.
- `report-partial.json`'s `stoppedBy` gains `user`, `client_cancel` and `wall_clock` beside `budget` (additive; a reader ignores a
  value it does not know). Run statuses gain `client_cancel_stopped` and `wall_clock_stopped` beside `user_stopped`. `run_status`
  and `council_advise` answer a stopped call with what was paid for (`stopped: true`); `readRun()` gains `stop`.
- `runs/<id>/STOP` is JSON (`stop/1`: who asked, for which run); an unreadable one still stops the run, one naming another run is
  ignored.
- **An advice call is not resumed:** every advice chain must say `"resumeAfterStop": false` and carry `advise.max_wall_ms` (two new
  chain-lint rules); `council --resume` refuses an advice folder, as `resume_run` does. Planning runs still cannot be stopped from
  outside. `advise.stopped_by` in an answered `report.json` keeps only the money skips (`own_cap`, `run_cap`).

### The gate and its ledger (experimental; the contracts floor)

- **A gate is a send that waits for a person.** It names a text file in the run folder and the sha256 of its bytes
  (`runs/<id>/gates/<gate>.json`, `schemas/gate-v1.json`). Only a channel a person uses can answer it: the terminal
  (`council gate answer runs/<id> <gate> [--decline]`, which prints the whole text, the mask counts, the price and the
  seats and asks y/N) or an MCP elicitation that shows the same. The answer is bound to the hash
  of the text the person was shown; a changed file, an expired gate, any other channel, a second answer and a broken
  ledger are refused with nothing written. No setting, flag or environment variable answers a gate, and `submit_stage`
  cannot reach one. The terminal check is friction, not proof of a person: a program can open a pseudo-terminal.
- **Every gate event goes into `runs/<id>/gate-ledger.jsonl`** (`schemas/gate-ledger-v1.json`): one line per event,
  each carrying the sha256 of the line before. `council gate verify runs/<id>` ($0) recomputes the chain. A changed or
  deleted line before the last one breaks it and the run's gates then fail closed. This is tamper-evident, not
  tamper-proof: anything that can write the run folder can edit or add the last line, cut the tail or rewrite the whole
  file, and the chain does not see it (each gate's own file is compared with the ledger, which catches an edit of one of
  the two). An approval is good for one send, until the gate expires. `council gate show runs/<id> [gate]` lists the
  gates or prints one.

### The add-on advisor: `council_quote` and `council_advise` (experimental; thc-research brief 29)

Two MCP tools that let a coding agent, when a person asks for it, put **one decision** to models from other labs and read back a leaning,
the dissent in the models' own words and what would change each answer. **Advice from other models, never an instruction; nothing
measured says it improves what an agent does.** `council_quote` (read-only) takes a structured **advice brief** (at most 48,000
characters, refused and never cut; no transcript field), scans the whole text for key shapes, masks emails, IBANs, cards, IPs, internal
hosts and home paths (reversibly; the mapping stays in memory), applies the sensitivity floor (the operator's
`COUNCIL_ADVICE_SENSITIVITY_FLOOR`, default `internal`; a project's `policy.json` `advice_sensitivity_floor` may raise it, never lower
it; the brief's label can only tighten it; the approval text names who set each part), and returns a send preview: each seat's lab, model and retention wording (from a dated table,
`src/advice-retention.json`; "ZDR" is OpenRouter's tag, not a guarantee), the exact size and sha256, the worst-case and expected price and
a ten-minute `quote_id`. `council_advise` (spends; `openWorldHint`, `_meta["anthropic/requiresUserInteraction"]`) needs that id, the hash
and a person's approval of the exact text, never waived (the research's operator allowance and the host statement are not shipped:
0.8.1 DR-3). It creates the run folder with the masked brief and a gate, asks through an MCP elicitation that shows the price, the hash
and the whole text, or returns `awaiting_approval` with `council gate answer runs/<id> g1` for the terminal; the same quote sent again
picks the gate up. The run starts only on an approved gate, with `council --advice-adopt runs/<id>` (which replaces the sidecar flag
`--advice-meta`), and records its send in the gate ledger: one approval, one send. It runs the seats and the ceiling the gate bound (the meta file is
not trusted for either), re-checks admission, the sensitivity tier and the money guards, and takes no other option that could add
text. A person running an advice chain at their own terminal (`council --chain advise-... --task ...`) is ungated, as before, and
recorded with `gate: null`. `COUNCIL_ADVISE_APPROVAL` left set stops the server.
An advice chain comes from the package's `chains/` or from one operator folder named in `COUNCIL_ADVICE_CHAINS_DIR` (an absolute
path outside the working folder; anything else stops the server), never from the project's own `chains/`, for the tools, `--advice-adopt` and a `--resume` of an advice folder alike: a
repository's chain file would otherwise decide who receives the text. That setting and `COUNCIL_ADVICE_SENSITIVITY_FLOOR` are read
from the server's own environment only, never from a project's `.env`. `resume_run` recognises an advice run by its own files
(`advice.meta.json`, `advise-log.json`), not by a chain lookup a project chain could shadow.
`wait_seconds` is at most 30 and covers the approval too. The checks before a send live in one shared send path
(`src/send-path.js`, `src/send-path-refusals.js`, `src/send-profiles.js`) that the tools call; the kind of send is chosen by the
server, never by an argument. A run folder awaiting approval shows in `run_status` as `awaiting_approval`, `approved`, `declined`,
`approval_expired` or `approval_invalid`, never as resumable. Modes: `single` (default GPT-6.1 Sol, reasoning high, routed only to
zero-retention-tagged endpoints; the `advisor` argument swaps it) and `council` (Sol, GLM-5.3 and Gemini 3.8 Flash, blind, one
anonymised debate round, no synthesis seat). The shipped chains are listed under the council advisor below; every hosted seat
carries `max_price` at its `pricing.json` row; `advise-single-opus` keeps 27's Opus 5.5 single as a control. The guards are code
(`src/advice-guards.js`): call and dollar limits per call, session and day read from the run folders and failing closed on a damaged
entry, a same-question detector, `tried` required, a disposition gate (accept, reject or defer, with a reason, for each dissent before the
next call). `start_run` and `resume_run` refuse advice chains over MCP. A client's cancel, or a client that leaves, writes a `STOP` file
and the run stops before its next paid step (exit 18, see the stop rule above); `advise.max_wall_ms` bounds the whole call and every request. `report.json` gains,
inside the experimental `advise` object, `sent_to[]`, `dispositions[]` and `stopped_by` (the brief's hash is `task_sha256`; the
0.8.1 naming pass, DR-13); each call writes `advise-log.json` (no brief text, an empty
`owner_rating`) and always an `audit.jsonl` whose lines carry the prompt's sha256 and size, the serving host when named and the scan result.
`run_status` answers a settled advice run with the same structured answer. Exit code 18 is a stopped call (the stop rule above).
`src/return-path.js` is brief 17's file, unchanged. No prompt changed.

0.8.1 M5 also adds and changes, for the add-on:
- **A follow-up after a request for more material needs a person** (DR-8): when an answer lists what is missing from the brief, its
  run records `more_material_requested` in its gate ledger, and the next call in the session says "This call follows an advisor's
  request for more material" in its quote, its approval dialog and its gate (`follow_up`, which `council gate show|answer` print).
- **`council advise-rate runs/<id> useful|not-useful|unclear [note]`** writes `owner_rating` (stored as `"useful"`, `"not useful"`
  or `"unclear"`); any other token writes nothing. A hand edit could leave a file the money guards refuse to read.
- `advise-log.json` gains `client` (the name and version the client gave) and `approval_wait_ms`; `advice.meta.json` gains `client`.
- **Changed:** `run_status`'s `wait_seconds` is at most 30 (was 50), and no client name lengthens the default hold any more (it
  was 30 s for a client calling itself Claude Code; now 25 s for every client). A prepared quote sent again with different
  dispositions is refused (`dispositions_too_late`) instead of dropping them. `spend_report` names an advice call's folder that
  never started ("advice call not started: awaiting approval", with its chain, $0).

### The council advisor (experimental; thc-research brief 27)

A different shape from a planning run: one question, a short brief, one short leaning with the
dissent on the record. `advise` is an opt-in chain block (`{ enabled, usd, rounds, synthesis,
samples, skipDebateWhenUnanimous }`); no chain written before it sets it, and a chain without it
runs exactly as before. `src/advise.js` is the whole stage: the seats in `seats.critics` answer the
brief blind under a fixed answer field (`verdict`: `proceed`, `change`, `stop`, `need_information`) with
quote-checked risks; up to two anonymised debate rounds (no lab names, no tally, each distinct
argument once, a changed answer only by quoting an argument for the new one, a round that moves nothing ends the debate);
and a roll-up by the harness, or by one `seats.builder` seat that is not on the panel. The dissent
block is built by the harness from the seats' own fields, so a synthesis seat cannot drop a
dissenter. `advise.usd` is the call's own ceiling inside the run's cap: the blind opinions are
refused, with nothing called, when their worst case is above it; a debate round, a retry or the
synthesis that would pass it is skipped and recorded. Retries and calls in flight are reserved
against it. The shipped advice chains (0.8.1 roster, DR-16 and DR-7):
`advise-single` (GPT-6.1 Sol, the default), the swaps `advise-single-astra`, `-gemini`, `-deepseek` and `-opus` (the control),
`advise-standard` (the council: GPT-6.1 Sol, GLM-5.3, Gemini 3.8 Flash; Sol and Gemini answer in up to 12,000 output tokens, GLM-5.3 in up to 54,000), and `advise-premium` (operator-selected only, public
material only, above the default money limits); `mock-advise-*` twins run for $0. Not shipped: `advise-quick`, `advise-deep` and
the `glm`, `muse`, `qwen` and `sonnet` single chains the research drafted (a user may seat any of those models in their own chain).
Every advice chain sets `resumeAfterStop: false` (new optional chain field). The prompts are
in `src/roles.js` (`ADVISOR_SYSTEM`, `ADVISOR_DEBATE_SYSTEM`, `ADVISE_SYNTHESIS_SYSTEM`); that adds
prompt builders, so `test/prompt-pin.test.js`'s `ROLES_SHA256` is re-recorded (no existing prompt
changed; the mock-chain prompt pin is untouched). New chain-lint rules: `advise-uncapped`,
`advise-ignores-planning-stages`, `advise-synthesis-on-panel`, `advise-samples-with-debate`,
`advise-debate-one-seat`, `advise-unpriced`, and the `advise` block joins the closed-key check. `report.json` gains an
additive, experimental `advise` field (`schemas/report-v1.json`); `outcome` reads `consensus` when
every seat that answered gave one verdict, `no_consensus` when they did not, `degraded` with a
dropout. Nothing measured says a panel advises better than one model, and none of this claims it.
`test/advise.test.js` covers each tier's flow, the quote rule, the stall rule, the own ceiling and
a refused over-cap call at $0. The landing page's chain-config count is updated.

### Skills

- **The 14 generic skills were rewritten and five skills were added.** The rewrite followed a review of each skill against
  published sources and the failures it guards against; rules that two skills both carried now live in one skill and are
  pointed to from the other. `verification-and-critique` gained rules (criteria in two tiers with a verdict that never
  bends; a fix verified on what it could have worsened; a skipped check is not a pass), so its rule numbers moved: other skills now point to
  rules by their text, not their number. `backend-developer` gained a rule on units and reference frames.
- **New: `proof-discipline`, `game-verification`, `open-world-streaming`, `engine-editor-driving`, `dcc-agent-authoring`.** Neutral, dated and
  graded facts about game engines and Blender, kept free of any one project. `dcc-agent-authoring`'s scripts have unit tests for the pure checks and
  a mutation pass that need no Blender; the Blender-facing parts have not been run in Blender yet, and the skill says so.
- `ux-design` now says "withhold the action, never the information" and when a lock needs a caption; its description no longer claims button and error text,
  which `drafting` hands to it. `drafting` gained a register for status reports, and `fact-checking` a rule on disclosing AI-written text.
- No efficacy claim: nothing in these skills has been measured against working without them.

## 0.8.0 - 2026-10-02

### Breaking

- **A resume refuses a `--context` document edited during the pause** (exit 14; it used to go through),
  the same rule that already covered the task file. `run.json` stores `contextHash`; record the change in
  the run's `AMENDMENTS.md` (the message prints both `ctx-<hash>` values to write) and resume again. A run
  from before this, and a run with no `--context`, are unaffected.
- **No-Grok rule: every id in OpenRouter's own namespace is denied.** `ROUTER_MODEL`
  (`src/denied-models.js`) now denies any single-segment `openrouter/<name>` id, not only
  `openrouter/auto` and `pareto-code`. Research on OpenRouter's model list (2026-09-30) found four live
  ids that got past the name list: `openrouter/auto-beta`, `openrouter/fusion` (a hosted multi-model
  panel), `openrouter/free` (picks free models at random) and `openrouter/bodybuilder`. Each picks or
  hides the model at request time, so none can be shown to avoid a denied model; the namespace also
  carries anonymous "stealth" models whose lab is undisclosed. A chain that seats one of these ids is
  now refused by `chain-lint` and at run time. Ordinary ids (`openai/gpt-6.1-sol`), `:free` variants
  of them and provider-prefixed pricing keys (`openrouter/openai/...`) are unaffected. Tests in
  `test/denied-models.test.js`.

### Changed

- **`HANDOFF.md` ends with a block the harness writes** (not a model): the acceptance criteria the run
  settled, as C1..Cn, with a fingerprint. `council check-lock HANDOFF.md [--run runs/<id>]` (alias
  `verify-handoff`, $0) says whether a copy still carries them. It catches an edit or a slip; it is
  not a signature.
- **The local run viewer runs behind a request guard** (`src/ui/guard.js`): exact Host allow-list, Origin
  checks, POST + JSON only, a per-launch token that fails closed, and CSP with `frame-ancestors 'none'`
  plus nosniff, no-referrer and no-store on every reply, refusals included. It serves `index.html`,
  `app.js` and `style.css` by exact name only (it used to serve `server.js` and `parse.js` too). The
  read-only viewer has no route that changes state, so it configures no token yet.
- **Every run logs `$0` criteria lints** after the criteria stage (`criteria lint (...)` lines) and records
  them as `criteria_lints[]`: no criterion asks the plan to be consistent, most only ask that something
  be named, a vague word with no number. Word-level heuristics; never a stop.

### Added

- `council --dry-run --json` and MCP `dry_run` `json: true`: the price floor and worst case, per-seat key
  status (never the key), `missingKeys[]`, `canRun`. The worst case is an estimate, not a bound.
- `run_status` and `list_runs` say whether a stopped run can be continued and what that takes
  (`resumable`), `STOPPED-error.json` says what an error stop was and whether asking again could work,
  and `state.json` at rest names the run's final phase and the stages it waits on.
- A top-level chain `summary` (one display line, at most 120 characters) on the five recommended chains;
  `list_chains` returns it. It is left out of the stage-cache fingerprint.
- `council handoff --from-run runs/<id>`: a `HANDOFF.md` for a run that stopped before it wrote one, from
  its latest draft; one call under the run's own cap with what the folder already cost counted toward it
  (`--max-usd N` is a total for the run, as on `--resume`), the same policy gate and key scan as a run, the
  spend recorded in `handoff-from-run.usage.json` (so `council --spend` sees it), a banner when no panel
  signed off, and it never overwrites an existing `HANDOFF.md`.
- `council lint-criteria --criteria <file> | --run runs/<id>`: the criteria lints before a run exists.
- `report.json` (all experimental, all additive): `criteria_ids`, `criteria_sha256`, `criteria_lints`,
  `missing_criteria` (sign-offs whose criteria table skipped criteria; recorded only),
  `cut_despite_support` and `disagreement_map`. See `docs/report-format.md`.
- A test that every MCP tool answers within 15 s through a whole mock run (a new tool needs a step in it).
- `chains/security-review-only.json`, a security-review-only chain for Sophi-A's security gate call
  (F9 in Sophi-A's Seat Families plan, `relay/Docs/SophiA-Seat-Families-Plan.md` §2.9, §5; paired with
  cnc-harness's own F6, built in that repo). Its only real content is a human- or orchestrator-supplied
  artifact and the final security-review gate (`515439a`, `docs/security-review-gate.md`). The builder
  seat is `external`: the CLI pauses at `build` (exit 3), the caller writes the artifact as `build.md`,
  resumes, and reads the exit code: `0` pass, `7` blocked, `8` not_judged. One always-passing mock critic
  seat exists only because `chain-lint` requires at least one `seats.critics` entry; it is not what this
  chain reviews. No engine changes. `test/security-review-only.test.js` covers all three exit paths
  offline.

### Fixed

- An `AMENDMENTS.md` entry written with a full 64-character task hash (what `sha256sum` prints) named no
  target at all, so a deliberate amendment was refused; any 12-to-64 hex token now counts, reduced to its
  first 12. A long all-digit token (a compact timestamp) is not a hash.

## 0.7.9 - 2026-09-29

### Breaking

- **A spend ceiling of 0 is refused everywhere.** `--max-usd 0`, `MAX_USD_PER_RUN=0` and the MCP
  tools' `max_usd: 0` used to mean "no ceiling"; the JS API already refused 0. Now all of them refuse
  it (CLI exit 2, MCP schema error), because someone who writes 0 almost certainly means "spend
  nothing". For no ceiling, say so: `--max-usd none`, `MAX_USD_PER_RUN=none`, or `max_usd: "none"`
  over MCP (still refused when the user set `COUNCIL_MAX_USD_LIMIT`).
- **New hard chain-lint rules:** a seat on an API provider with no `model` (missing, `null` or
  empty) is refused, at lint and at run time (`external` and `mock` seats may leave it out); and
  `extra-models-unpriced`: a priced seat's `extra.models` fallback with no entry in
  `src/pricing.json`.
- **Key-shaped text in a prompt stops the run (exit 11).** Your inputs (the task, `--context`
  files, a handed draft, a `--criteria` file) are scanned before the run against every format in
  `src/secret-patterns.js`, including a password inside a URL or an assignment. Every prompt that
  leaves (each provider call, each external seat's `NEEDS-<stage>.md`) is scanned again for the
  distinctive key formats (provider prefixes, PEM/PGP, JWT, AWS, GitHub, Slack, Stripe, ...), so a
  model's placeholder such as `postgres://postgres:postgres@localhost` does not stop a run. A match
  stops before anything is sent and names the file or stage, the line and the format, never the
  value; a match mid-run writes `STOPPED-secret.md`. The one override is `--allow-secret-shaped`
  (saved in `run.json`, so a resume keeps it; MCP `start_run` / `resume_run`
  `allow_secret_shaped: true`; JS API `run` / `resume` `allowSecretShaped: true`). Key shapes only;
  PII stays behind the opt-in `--pii-gate`. A clean run's prompts are byte-identical.

### Fixed

- **A panel reply cut off at the token cap no longer counts as a sign-off when it happens to parse.**
  Cut-off is read from the provider's stop reason, parsed or not: one retry with a bigger cap, and a
  reply still cut off is an abstention if it signed off, or kept as an objection if it objected.
  This holds for `signoff: "first"` chains too (verify, cheap and 16 more), where a cut-off or
  provider-ended sign-off is no pass. A pasted external reply carries no stop reason, so this does
  not apply there.
- **A draft the provider ended with `error`, `content_filter` or `refusal` is no longer taken as
  finished.** Every draft stage retries it once at the same cap, then stops the run
  (`STOPPED-truncated.md`, exit 17) naming the stop; `STOPPED-truncated.json` gains `stop`. A panel
  sign-off in such a reply is an abstention.
- **A fallback model's reply is no longer charged $0.** When the answering model (an OpenRouter
  `extra.models` fallback) has no price entry, the stage is charged at its seat's own price, and the
  log says so. `src/pricing.json` gains `openrouter/openai/gpt-5` and
  `openrouter/google/gemini-3.6-flash`, the two fallbacks `coder-gate-v2` names (OpenRouter's model
  list, 2026-09-28).
- **`--rematch` and `--replay` run chain lint** before calling any seat, like a normal run and a
  resume. An edited chain could send a key to a foreign host on a side run.
- **A proposal cut off at its token cap is retried with a bigger cap**, as architectures and panel
  replies already were. The same cap was used again, so a reasoning seat that thought through all of
  it dropped out (`plan-daily-7`'s first real run lost Hy4 preview this way).
- **A debate post or reply round the provider ended with `error` (or a refusal or its content
  filter) is retried once**, and if it fails again it is recorded as `provider_error` in
  `debate.dropped`, not `unreadable` (a new value of the schema's `reason` enum). `WARNINGS.md` names the stop instead of "not readable as JSON".
  A 2.5-second provider error used to cost a lab its whole reply round.
- **A lab that dropped out is named where people read.** `report.json`'s `dropouts` was shown nowhere
  else, so a run whose `outcome` was "degraded" gave no visible reason. `BOARD.md` gains a "Dropped
  out" section, `WARNINGS.md` a `dropout:` line per lab, and the CLI summary a `dropped:` line.
- **The dry run prints external seats as `external`**, not a priced `$0.0000`, and says how many
  stages are answered outside its total (21 of 72 in `plan-daily-7`).
- **A pasted external answer gets the same bookkeeping as any other stage.** It is first read on a
  resume, as a cache hit, and cache hits skipped the partial-output check (the only truncation signal
  a stop-less pasted draft has), `stage-log.jsonl`, the audit log and `spans.jsonl`. Its first replay
  now counts as its completion; the answer on disk is not rewritten.
- **The questions stage's `answers` are checked for staleness** like every other external answer.
  After a task amendment the old answers used to be applied, by position, to the new questions; now
  they are set aside (`superseded/`) and the operator is asked again.
- **`--from-run` of a finished run keeps its criterion kinds** (`report.json` `criteria_kinds`),
  so checkable criteria and the "MET with no evidence" count survive it. It used to reuse the plain
  strings, which dropped every kind.
- **A missing `--draft` file or `--from-run` folder** (or a corrupt earlier `report.json`) exits 2
  with a message instead of a stack trace.
- **The withdrawal ledger lists a proposal that withdrew in favour of one inside a withdrawal
  cycle**; it was left out of `orphanSections`. `council doctor --run` no longer crashes on a
  hand-edited `proposals` list, and no longer says "cycle detected: 0 cycle(s)" for a plain
  withdrawal. The run log calls such a withdrawal a note for the builder, not a WARNING (the $0 demo
  printed one for a withdrawal its plan then handled as asked).
- **"MET with no evidence" counts every form the sign-off reads as MET** (`PASS`, `PASSED`, `YES`,
  any case, surrounding spaces), not only an exact `MET`: one shared classifier now.
- **A dropped first-mode critic's provider failure is no longer labelled `[COUNCIL-E005]`**, which the
  error catalog and TROUBLESHOOTING define as a policy refusal.
- **An aborted `api.run()` names its run.** The `AbortError` carries `runId` and `runDir`, and it
  rejects only after the run's process has exited, so `resume()` can pick the run up (the types
  promised a resumable run the caller had no handle on).
- **`council init`'s example run (`<id>-init`) is accepted by MCP `run_status` and the viewer**, not
  only listed by `list_runs`.
- **"No such chain" names every folder it looked in**, not only the one inside the package.
- **`replay-diff.json` / `rematch-diff.json` no longer report invented verdict changes on relay
  panels.** A relay panel lists `signoff[]` in its seeded review order, which differs between the two
  runs, and the diff keyed on array position. `signoff[]` entries gain an additive `seat_index` (the
  seat's index in `seats.critics`), and the diff keys on it.
- **Re-asking an unheard external reviewer says why.** The re-ask prompt gains a short "your previous
  reply could not be read" note; it used to be byte-identical to the first ask. API seats' prompts
  are unchanged.
- **An MCP resume re-checks the run's inputs** (task, draft, context files, from-run folder) against
  the same secret/gitignore/working-folder rules `start_run` applies. A resume re-reads a context
  folder, so a secret file added to it during a pause used to reach every seat.
- **`server.json` offers `COUNCIL_MAX_USD_LIMIT`**, so an install from the MCP Registry can set a
  hard per-run limit the client's model cannot raise or remove, as the Claude Desktop bundle already
  does. Without it, `max_usd: "none"` over MCP runs with no ceiling.
- **`report.json` `outcome: "degraded"` is described as it behaves**: a seated lab that produced
  nothing usable (in a tiered chain, possibly a debating seat that never votes), an abstention, no
  reviewer heard, or a missed quorum. The old wording said the voting roster never reached a verdict,
  which is not true when only a debating seat dropped out. The behaviour is unchanged (owner's call,
  2026-09-28).
- **Stage labels with a dot can be answered over MCP.** `external_prompt` and `submit_stage` refused
  any label outside `[a-z0-9-]`, so none of `plan-daily-7`'s Opus stages (lab `opus5.5-sub`) could be
  fetched by name or submitted, while the tools themselves told the client to submit that label.
- **`plan-daily-7`'s routing note** says "every label containing `opus5.5-sub`" and names the
  `-retry`/`-reask` forms; "ending in" sent those to the writer session.
- **`src/pricing.json`: `openrouter/z-ai/glm-5.3` refreshed** to OpenRouter's current $1.40 / $4.40
  (was $0.84 / $2.64, understated; a `plan-highest-7` and `plan-premium-7` seat). Dry runs:
  `plan-premium-7` $21.59 → $22.30, `plan-highest-7` $10.54 → $11.21 worst case.

### Added

- **`plan-daily-7`**, a lower-priced tiered council for planning one feature, on
  `plan-highest-7`'s stages and flags (majority guard on). Anchors, who write the architectures and
  alone vote: Claude Opus 5.5 as an external seat answered on a Claude subscription
  (`subscription:opus-5.5`, lab `opus5.5-sub`), GPT-6 Luna and DeepSeek V4 Pro. Mass seats: Tencent
  Hy4 preview, Gemini 3.8 Flash, DeepSeek V4.1 Flash, GLM 5.2, Muse Spark 1.3, Qwen 3.8 Max
  (0902), Mistral Medium 3.5. The writer seats are a Sonnet 5 Claude Code session; the Opus seat is a
  separate session. Deep-dive cap $0.50. Dry run $1.90 worst case. Run once with real models (2026-09-28); nothing about it has been measured.
  `src/pricing.json` gains `openai/gpt-6-luna`, `tencent/hy4-preview` and `meta/muse-spark-1.3` from
  OpenRouter's model list (2026-09-27).

### Changed

- **`plan-highest-7`: Claude Opus 5.5 takes the Anthropic anchor seat** (architectures and review),
  in place of Claude Fable 5.1. `src/pricing.json` gains Opus 5.5 at OpenRouter's $4 / $20 per million
  tokens.

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
  has been measured. Price it before any run: `council --task <file> --chain plan-highest-7 --dry-run`
  ($14.89 worst case for the default estimate with today's price table; a long task costs more).
  `src/roles.js` gained the deep-dive and guard prompts; every prompt the existing mock chains send
  is unchanged (`test/prompt-pin.test.js`).
- **Four writing skills:** `drafting`, `fact-checking`, `line-editing` and `final-read` join the
  published set (now fourteen). `good-news-writing` links to them.

### Changed

- **Kimi/Moonshot models may be seated in your own chains again.** They stay out of every chain
  this package ships. xAI/Grok, and router ids that could pick it, stay refused with no override.
- **All ten existing skills revised** for current practice: descriptions say what each skill does
  and when to use it, main files are shorter with detail in `references/`, citations were checked
  and several corrected, `backend-developer` gained a security baseline (OWASP Top 10:2025),
  `frontend-developer` an accessibility section, `ux-design` the WCAG 2.2 criteria. The install
  instructions in `skills/README.md` and `docs/skills.html` now name the real skill folders.

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
- **Docs.** The README's first screen now says what a run costs, gives three commands to a priced
  run, and compares the four recommended chains (`cheap-7-v2`, `plan-premium-7`, `plan-highest-7`,
  `local-ollama`) by roster, keys and worst-case price. The README, `docs/index.html`,
  `docs/mcp-clients.md` and `mcpb/README.md` describe the Claude Desktop bundle, the MCP Registry
  listing and this release's user-visible security rules, and the landing page installs from npm.

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
  These fields were read from any line of the task file, fenced blocks included, so text inside
  fenced source could count as the operator's sign-off for a policy's `required_signoff_paths`,
  or stand in for the task's own `target_file:` or `label:`. The three fields are now read from
  the task's own prose only. A change request written inside a code block is therefore no longer
  read as one: write the fields as plain lines. Likewise `council fence` now
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
- **`src/http-server.js` (not part of the release, but in the 0.7.7 package): a path-shaped
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
