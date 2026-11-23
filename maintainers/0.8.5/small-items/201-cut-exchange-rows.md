# 201: when a finish stops a layer's exchange, `report.json` keeps none of that exchange's completed rounds

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is wrong

**Part 1: the cut exchange has no row.** When a person's finish stops the run in the middle of a layer's exchange, `report.json` gets no `layer_debates` row for that exchange.
- `exchangeRound` (`src/chain.js:3013`) builds the rows only after its loop of rounds (`rows`, `:3209`), and the caller pushes them (`layerDebates.push`, `:5976`).
- The finish is thrown inside the loop, and the catch (`:3196-3203`) rethrows it, so neither step happens.
- What the finish does carry out (`:3199` and `:3201`):
  - the objections that a raiser withdrew in a completed round (`exchangeWithdrawn`);
  - the objections a judge named in a post that still stand (`exchangeNamed`).
- `noteCutOpen` records the withdrawals:
  - in the set that keeps them off the open list (`cutWithdrawn`, `:5696`);
  - in the list shown back to the judge in later passes (`exchangeWithdrawals`, `:5697`; it is in memory only, and `src/report-shape.js` has no field for it);
  - in the answer-back ledger, when the ledger is on (`:5698`);
  - in the severity record, unless the objection was itself named in the exchange (`:5699`).

So, for the cut exchange, `report.json` loses two things:
- **The completed rounds:** their summaries (`roundsRun`, pushed at `:3191`), their posts and their replies. The stage files of those calls stay in the run folder.
- **Any trace of an objection that a judge raised in one of that exchange's posts and took back later in it.**
  - The severity record skips objections born in the exchange (`:5699`).
  - A completed exchange does not write a severity row for them either (`:5945` withdraws verdict failures only); it relies on its `layer_debates` row instead.
  - With the answer-back ledger off, no field of `report.json` names that objection; only the stage files hold it. Every shipped planning chain has the ledger on (`"answer_back": { "enabled": true }` in `chains/plan-*.json`), so this case can arise only on a person's own chain, as part 2's can.

**Part 2: two readers do not follow the report's open list.**
- The accept step reads `openObjectionsOf` (`src/acceptance.js:28-30`), which takes `report.lastCritique.failures` when the report has no `dispute.open_objections`.
- The CLI's closing line "open: N objection(s) for human review" counts `lastCritique.failures` too (`src/cli.js:5152-5154`). Its only filter, `closedAtEnd`, holds what the closing read closed (`:5151`).
- `report.json`'s `lastCritique` is the run's own, without a withdrawal filter (`src/report-shape.js:154`).
- `cutWithdrawn` filters neither reader: its only uses are `src/chain.js:4823`, `:5696` and `:7466` (the held list).
- So, on a chain without the dispute stage, an objection taken back in a completed round of the cut exchange can still appear in accept's list and in the CLI line's count, while the report's own count leaves it out.
- Every shipped planning chain has the dispute stage on (`chains/plan-*.json`), so the case can arise only on a person's own chain. Whether a run reaches it, with the taken-back objection still in `lastCritique.failures`, is not established.

## When a round counts as completed

A round's post calls are awaited together through `settleAll` (`:1538-1542`), which throws the first rejection after all of them have settled. A finish inside a post call is rethrown at `:3089`. So:
- **A finish at a post of round k:** the throw comes before the round's posts are folded into the exchange's state (`:3100` onward), and round k is left out.
- **A finish at a reply of round k:** round k's posts are already folded in (`:3104`), and the objections they name are registered (`:3132`), before the replies are awaited (`:3137`). The round's summary is pushed only after its replies (`:3191`). So round k's posts and named objections stay in the state, and `exchangeNamed`, which has no round test (`:3201`), includes those objections.

The existing tests cut only posts. Their cut labels (`git grep -n cutLabels -- test/`) include no reply of an exchange.

## The smallest change

**Part 1.**
1. In `exchangeRound`, lift the row builder (`:3209` onward) into a function that the catch can call too.
2. Attach to the finish the rows and the round summaries, beside `exchangeWithdrawn`. Which rounds they cover follows question 2:
   - under (a), the rounds whose posts are in the state, the reply-phase round included;
   - under (b), only the rounds whose replies came back (`roundsRun.at(-1)?.round ?? 0`), with `exchangeNamed` given the same limit.
3. Where the finish is caught for the layered pass (`:6333`), push one `layer_debates` row for the cut exchange, marked `cut: true`. Reusing the builder gives only the outcome words that exist today (question 1).
4. Readers that take or test a layer's rows (`git grep -n -E "layerDebates|layer_debates" -- src/`):
   - **The ending exchange** takes the last layer-1 row and uses it only if it is a `not_run` row of the last pass that asked layer 1 (`:7484-7486`), so a later cut row would hide it. But a layer-1 `not_run` row means that fewer than two judges were heard in that pass (`:5914`), and the ending exchange needs two heard judges in the last pass that asked layer 1 (`:7471`, `:7481`). So whether a run reaches this hazard is not established. A `!d.cut` filter there changes nothing in the cases that are established.
   - **`notDebatedNext`** (`src/escalation.js:180-182`) counts an objection as debated after a send-back when a later pass's row carries posts on it. A cut row with posts would count, which moves the words of the escalated sign-off block (`src/chain.js:7973`) and the report's `escalations`. Whether it counts is question 3. Whether a cut run reaches `:7973` at all was not read.
   - The other readers take the current pass's rows while the pass is still running (`:5994`, `:6092`, `:6763`), or render every row (`layerDebatesWithMakers`, `src/answered-by.js:175`; `src/judge-persona.js:57`; `src/report-shape.js:224`).
5. `exchangeRound` has a second caller, the ending exchange (`:7504`). Steps 1 and 2 change `exchangeRound` itself, so the ending exchange gets the changed catch whether or not step 3 covers it. The builder's first step, before the change, is to read whether a finish can land inside the ending exchange and what it then records.

**Part 2,** only if a run reaches its case. Make the two readers follow the report's open list by leaving out what `cutWithdrawn` holds.
- `src/acceptance.js` has only the report, so it cannot filter by `cutWithdrawn`. The filter belongs where the run writes `lastCritique` into its result or into the report.
- `lastCritique` is read in `src/acceptance.js`, `src/anchor.js`, `src/cli.js`, `src/mcp/stop-decide.js`, `src/report-shape.js` and 33 places in `src/chain.js` (`git grep -c lastCritique -- src/`). Each of them must be checked before it is filtered once.

## The test, and how it fails first

New cases in `test/finish-cut-objection-open.test.js`, offline and at $0, on its scenario helper. The file already compiles the schema (`validate`, `:24`) and shapes the report (`reportOf`, `:30`).
- **CX-1.** Take the case at `:154-165`: pass 1, a finish at the post of round 2 (`ldebate-1-x2-lb`), after the raiser withdrew an objection in round 1. Assert:
  - `report.layer_debates` has one row with `pass` 1, `layer` 1 and `cut: true`;
  - round 1 is in its `rounds`, the withdrawn objection has the outcome `withdrawn_argued`, and round 1's posts are there;
  - `validate(report)` passes.
  - Expected red today (not run): the report has no row for that exchange.
- **CX-2.** The same with the finish at a reply of round 2. The posts' labels in that test (`ldebate-1-lb`, `ldebate-1-x2-lb`, `lreply-1-la`) suggest `lreply-1-x2-la`; check the label against `exchangeRound` first. Assert the rounds that question 2's answer gives.
  - Expected red today (not run): no row.
- **CX-4, part 2.** Use the fixture `HELD_WITHDRAWN` (`:111-116`) with the dispute stage off. The test at `:117` asserts the same case with it on: there, the withdrawn objection is "not asked at accept". With the stage off, assert that `openObjectionsOf(report)` does not list the objection withdrawn in round 1 of pass 2.
  - Expected red today (not run): accept reads `lastCritique.failures`, which still hold it, if pass 1's critique raised it.

The case of step 4's first bullet gets no test until a run is shown to reach it.

These run with the change:
- `test/finish-cut-objection-open.test.js`;
- the 18 test files that read `layer_debates` (`git grep -l layer_debates -- test/`), `test/report-schema.test.js` among them;
- the source scanners.

## The owner's gates

- **Prompt wording:** none.
- **Sentences a person or a session reads:** these are re-read and rewritten where the change makes them false, A-DRAFT until the owner's yes:
  - the schema's description of `layer_debates` ("present only when a layer exchange ran or was due and could not run");
  - the two `cut` descriptions (`panelVerdicts[].cut` and `signoffEntry.cut` in `schemas/report-v1.json`), which say where a withdrawal in the cut exchange is recorded;
  - `AI-README.md:291` and the objection-record lines of `docs/report-format.md` (`:86`, `:88`);
  - the 0.8.5 change note.
- **Records:** `report.json` is a public contract (`schemas/report-v1.json`). A new row, and a `cut` field on it, is additive: the rows have no `required` list and no `additionalProperties: false`. A new outcome word would be a new value in a closed list (question 1).
- **Money:** none in the established cases. The one paid reader of the rows, the ending exchange's candidates (`:7484`), meets a cut row only in the hazard that is not established.
- **Hand-typed counts:** none.

## What the change must not touch

- The open list that `exchangeNamed` feeds, apart from question 2(b).
- The withdrawals that `noteCutOpen` records today.
- The carry store of the exchange (`exchangeCarried`, written at `:5892`, `:5921` and `:6117`): the change adds nothing to it.
- The ending exchange (`:7504`): what it records must not change, unless step 5's reading shows a finish can land inside it, and then by its own decision.
- Stage labels.
- The rows of exchanges that completed.

## Questions only the owner can answer

1. For an objection still standing when the finish cut the exchange, what should its row show?
   - (a) An ordinary outcome (`not_debated`, `stands_*`), with only the row marked `cut: true`.
     - Result: no new value in the schema; a reader tells a cut row by its flag.
   - (b) An outcome that says the finish cut it.
     - Result: a sixth value in the schema's closed list of outcomes (`withdrawn_argued`, `stands_uncontested`, `stands_contested`, `not_debated`, `unresolved_at_stop`), which readers of the schema have not seen.
2. Objections named in the posts of a round whose replies the finish cut: are they named? Today they are, through `exchangeNamed`.
   - (a) Named. Result: they stay open, and the row shows that round's posts.
   - (b) Not named. Result: `exchangeNamed` gets the rows' limit, and those objections leave the open list.
3. Does a cut row count when `notDebatedNext` asks whether an objection was debated after a send-back?
   - (a) No, the cut row is left out there. Result: the escalated sign-off's words and the report's `escalations` stay as they are today.
   - (b) Yes. Result: an objection that drew posts in the cut exchange reads as debated after the send-back, and both the sign-off's words and `escalations` say so.
