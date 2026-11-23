# 204: the dry run gives no task-sized price below the chain's assumed prompt, and MCP `dry_run` cannot be given a task

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is wrong

A person or a model session runs a dry run to learn what a run will cost before anything is paid. For the task in hand, the answer says less than it seems to, in two separate ways.

**1. MCP `dry_run` takes no task.** The tool has six arguments: `chain`, `json`, `rounds`, `claude_route`, `zero_retention` and `persona_form` (`src/mcp/server.js:477`). The command line it builds never carries `--task` (`src/mcp/server.js:486-492`). A session can price a chain over MCP but never its own task, while the CLI can (`council --dry-run --task <file>`). The server already runs a dry run with a task for its own use: at `start_run`, when the project has a policy file, `dryRunPolicyWarnings` passes `--task` to read the policy warnings and drops the figures (`src/mcp/server.js:514-521`, called at `:812`).

**2. Below the chain's assumed prompt size, a task changes no figure.**
- Each chain is priced at its own assumed sizes. `estimate.promptTokens` is the whole prompt a seat is assumed to read: 28,000 tokens on every shipped planning chain (`chains/plan-*.json:57`), and 4,000 for a chain that sets none (`src/cost.js:343`).
- The dry run counts a task at four characters per token. It prices again only when the task alone is larger than that whole prompt, and then it adds the task on top of it (`src/dry-run.js:46-54`). The text path repeats the rule in its own copy (`src/cli.js:2990-3002`).
- Below that line, the text answer says "Your task (roughly N tokens) fits inside the 28000-token prompt this estimate assumes." (`src/cli.js:3000`). The JSON gives the task's size (`task`, `src/dry-run.js:103`), and every `*WithTaskUsd` figure is null (`src/dry-run.js:51-54` and `:90-98`).
- So on a planning chain, every task up to about 112,000 characters gets the same answer: the same rows and no with-task figure.
- On the two sides of the line the code computes these prompt sizes: a task of 28,000 tokens (112,000 characters) is priced at the chain's 28,000-token prompt; a task of 28,001 tokens is priced at a 56,001-token prompt.

Part 2 is the behaviour that the comment at `src/cli.js:2986-2989` describes: the rows price the chain's assumed size, not the task, and the task line says how the task compares. It is therefore a question for the owner (below), not a defect. Part 1 is a missing argument.

One sentence is wrong today, whatever is decided: `KNOWN-LIMITS.md:43-45` says the dry run "(`--dry-run`, MCP `dry_run`) prices the task alone and does not read `--context` documents". MCP `dry_run` prices no task. Below the line, the CLI prices the chain's assumed prompt, not the task.

## The smallest change (part 1)

1. `src/mcp/server.js:477`: an optional `task` argument on `dry_run` (`z.string().optional()`).
2. Before anything runs, check it the way `start_run` checks its task: `startRunInputRefusal({ task })` (defined at `:316`; `start_run` calls it at `:779`). A refusal is answered like the tool's other refusals (`text({ error })`, as at `:482`).
3. Pass it on as `'--task', resolve(work, task)`, the form `dryRunPolicyWarnings` uses (`:516`).
4. Add one clause to the tool's description (A-DRAFT 204-w1, below). The `.mcpb` manifest carries only the description's first sentence (`mcpb/manifest.json:53-54`), which does not change; `test/distribution-manifests.test.js:63` compares tool names only.
5. Correct the Known limit at `KNOWN-LIMITS.md:43-45` (A-DRAFT 204-w2). Name the argument in the MCP tool table at `AI-README.md:758` (A-DRAFT 204-w3). The landing page's card (`docs/index.html:527`, "Price a run before spending anything") stays true and stays as it is.
6. Read two entries again, because a task brings the CLI's own checks of a task into `dry_run`'s answer (a refusal names the caller's own path, as `write_task`'s refusals do, `test/mcp-untrusted-fragments.test.js:169`):
   - `dry_run`'s trust row, which says its answer holds prices and seat names computed from a chain file (`src/mcp/untrusted.js:38`);
   - its reason in the F3 guard's `NONE` list, "its refusals stay under the default" (`test/mcp-untrusted-fragments.test.js:165`). The guard compares only whether the tool is listed, so it stays green. Its reason is corrected in the same commit if it no longer holds.

## The test, and how it fails first

A new file, `test/mcp-dry-run-task.test.js`. It drives a real MCP session through `mcpCalls` (`test/helpers/mcp-calls.js`), offline and at $0, in a temporary work folder.
- **DT-1.** With `tasks/big.md` of 200,000 characters (50,000 tokens, past the 28,000-token line), call `dry_run { chain: 'plan-mini-council', json: true, task: 'tasks/big.md' }` (`tasks/` is one of the server's input folders, `src/mcp/server.js:276`). Assert that the answer's `task.largerThanAssumed` is `true` and that `estimate.expectedWithTaskUsd` is a number above `estimate.expectedUsd`.
  - Expected red today (not run): the tool has no `task` argument, so the answer carries no task figures. The red run records which form the failure takes.
- **DT-2.** With a file one folder above the work folder, call `dry_run { chain: 'plan-mini-council', task: '../outside.md' }`. Assert that the error matches `/^task: .*outside the working directory/`, as `test/start-run-inputs.test.js:91` expects for `start_run`, and that no price is given.
  - Expected red today (not run): nothing checks the path, so the answer is not that refusal.

Run with part 1:
- the tests that name `dry_run` today (`git grep -l dry_run -- test/`: 15 test files and one fixture);
- `test/distribution-manifests.test.js`;
- the source scanners.

Part 1 leaves the tests of part 2's behaviour alone. Two of them pin what happens below the line:
- `test/first-ten-minutes.test.js:113-123`, on `plan-mini-council`: a small task "fits inside the N-token prompt", and a big one is "Priced again".
- `test/dry-run-json.test.js:114-125`, on the retired `plan-premium-7`, which the test copies in from `chains/outdated/` (its assumed prompt is 10,000 tokens): a small task has `worstCaseWithTaskUsd` null, and a big one has a larger figure.

Six more test files pin the with-task figures above the line (`git grep -n WithTaskUsd -- test/`): `test/addon-rework.test.js:61`, `test/dry-run-two-figures.test.js:69-73`, `test/regression-081-dry-run-null-worst-case.test.js:20-37`, `test/tree-allow-size.test.js:112-117`, `test/tree-bundle-grant.test.js:100-101` and `test/tree-start-dryrun.test.js:17`, `:67` and `:128`. `test/plan-tiers.test.js` and two test helpers read `chainFigures` (`git grep -l chainFigures -- test/`). Under option (b) of question 2, the two below-the-line pins turn red by design and are recorded as changed accepted tests, and the others are read again, because a new rule can move the figures above the line too.

## The owner's gates

- **Prompt wording:** none. No seat's system or user prompt changes.
- **Sentences a person or a session reads:** 204-w1 (read by the model of every MCP client), 204-w2 and 204-w3. Each stays A-DRAFT until the owner's yes. If part 2 changes, the CLI's task lines (`src/cli.js:2997-3000`) join them.
- **Money:** part 1 touches no money path. The dry run calls nothing and records nothing (`maintainers/ARCHITECTURE.md`, "Cross-run spend: what is recorded"). The spend cap is enforced in `invoke()` before every paid call ("The spend cap"), and no caller of `dryRunReport` is on that path: in `src/` it is called only by the CLI's JSON dry run and the three tree modules (`git grep -n "dryRunReport(" -- src/`). Part 2 is a money path; see question 2.
- **Hand-typed counts:** none. An argument is not a tool, so the MCP tool count does not move. The README, AI-README and landing-page figures come from a dry run without a task (`test/dry-run-figures-docs.test.js:21`), so part 1 cannot move them, and part 2 must not.

## What the change must not touch

- `src/dry-run.js` and the text path's rule (`src/cli.js:2990-3002`). They are part 2, which waits for the owner.
- The trees' figures: `src/tree-budget.js:474-480`, `src/tree-frontier.js:240` and `:316`, `src/tree-projection.js:34` and `:39`.
- `start_run` and its checks. They are reused as they are.
- The shape of the JSON. `task` is already a key, and `DRY_RUN_SCHEMA_VERSION` stays 1 (`src/dry-run.js:16`).
- The `.mcpb` manifest's description.
- The phrase of a fixed 0.8.0 defect, `worstCaseWithTaskUsd: null`, which the Known limits must not contain (`test/known-limits.test.js:130`).

## Questions only the owner can answer

1. May MCP `dry_run` take a task, so that a session can price its own task before a paid start?
2. Below the assumed size, what should a person see?
   - (a) As today: the chain's assumed run, with the task line saying that the task fits.
     - Result: on a planning chain, no figure changes with the task below about 112,000 characters.
   - (b) A smaller figure for a smaller task, carried in the with-task fields.
     - Result: the figure follows the task.
     - If the rule moves the at-most figure, the trees' cheapest end and at-most figure move for small inputs, and a tree approved before is refused at its next sitting with `ceiling_changed` (`src/tree-loop.js:331` and `:404`; read, not run).
   - (c) A smaller figure shown beside the chain's figure, for display only.
     - Result: the person sees the signal, and the with-task fields and the trees stay as they are.

   This note's reading, not a decided rule: a smaller figure needs a number that the chain files do not carry today, the size of the prompt without the task (`estimate` holds `promptTokens`, `draftTokens` and `critiqueTokens`). Whatever rule is picked also decides the step at the line: today, a task one token over the line is priced at the chain's whole assumed prompt plus the whole task.

## A-DRAFT wording (each waits for the owner's yes)

- **204-w1**, in the `dry_run` description, after the sentence on `chain`: "task is a task file inside the working directory, checked as start_run checks it; the answer then says how the task compares with the prompt size the chain assumes, and prices the run again with the task added when the task is larger."
- **204-w2**, replacing `KNOWN-LIMITS.md:43-45`: "The dry run (`--dry-run`, MCP `dry_run`) prices each chain at its own assumed prompt size. A task (`--task`, or `task` on MCP) changes the figures only when it is larger than that size, so a smaller task does not lower them, and `--context` documents are not read, so for a run with context its estimate is too low. The spend cap is not affected: it checks every real prompt, context included, before each call."
  - It is written for part 1 with question 2 answered (a). Another answer changes its second sentence, and a no to question 1 replaces "or `task` on MCP" with "MCP `dry_run` takes no task". Its consequence for context ("so for a run with context its estimate is too low") and its last sentence are today's, word for word.
- **204-w3**, the `dry_run` row of the MCP tool table (`AI-README.md:758`): "Price a run before spending anything, for a given task too (a layered chain with a round limit of its own also shows the most calls its rules allow; the shipped planning chains have no such limit and show none)".
