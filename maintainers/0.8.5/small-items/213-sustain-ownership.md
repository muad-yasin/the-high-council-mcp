# 213: today a sustained objection becomes the sustaining judge's own (the second step of the fix)

A-DRAFT: every sentence of this note waits for the owner's yes.

Read against the code at commit `2c727fd9`, where the first step of this item is built: a judge that restates a row it was shown in its prompt as "continues <its id>" is heard, as its own new objection. This note prepares the rest of the item. Nothing in it is built.

## What is wrong

**A sustain makes a copy, and closes the raiser's objection.** When a judge of a ruling layer sustains an objection another judge raised, the code does two things.
- **It makes a copy** under the sustaining judge, with a new id derived from that judge's key (`src/chain.js:6004-6009`; `src/objection-ids.js:66`). The copy carries the row's rating in force and `sustained_from`. It joins the pass's failures (`:6388`), so it goes to the writer as the sustaining judge's objection, and the ledger the top layer reads lists it as that judge's raise (`:6394`).
- **It closes the raiser's id:**
  - `closedByRuling` counts a sustain as a closing (`:5096`);
  - `ruledNow` drops the id from the top layer's ledger and from layer 1's open list (`:5101`);
  - the raiser's answer-back entry loses it (`:6010-6013`), so the raiser is no longer asked about it;
  - in later passes the id is in the closed state `adopted` (`:3706`; `src/objection-assign.js:44`), so it comes back only by "reopens".

**The words say so.** Seven prompt sentences tell a ruling judge that a sustained objection becomes its own (the wording table below, rows 1 to 7). The relation rule tells every judge, in every chain with answer-back on, that a sustained objection was "adopted" (row 7b).

**The record says so.** A ruling's outcome row lists the copies in `adopted_as`, each copy carries `sustained_from`, the board writes "from then on the objection of <lab>" (`src/report-shape.js:459`), and the block above the deliverable says whose objection it then was (`src/escalation.js:146`).

**The owner's decision** has two parts: a sustained objection no longer becomes the sustaining judge's own, and the plan is still revised at the sustaining layer before it climbs on, as today. That the objection then stays the objection of the judge who raised it is the reading of those two answers, not a third decision. The sentences in rows 1 to 7b carry that reading, so the owner's yes on them confirms it.

**Another way a seat goes unheard,** unrelated to a sustain, is named in this folder's README under "Not prepared": a reply whose failure leaves its relation out.

## The design

- **The raiser keeps the objection** (the reading above), open, under its own id. A sustain copies nothing and closes nothing for the raiser.
- **The sustain holds the sustaining layer.** That layer counts as objecting by the row while the hold lasts, at the row's rating in force, so the plan is revised there, as a copy makes it today. One rated below 4 holds nothing, as today.
- **The sustain is recorded as a ruling:** the outcome row says sustained, and by whom.
- **A judge that restates the row it sustains** ("continues <the row's id>", heard since the first step) keeps that restatement as its own objection, at its own rating. The raiser keeps the row too, so the defect is listed twice: the raiser's row, and the judge's own.

**The sites** (51 hits of the closing and copying names in `src/`, without `src/prompts/`):
- **The copy stops.** It is made at `:6004-6009`, and its readers go with it: `:5258` (the climb's sorting items at agreement), `:5677` and `:5682` (the panel row), `:5735` (a summary line), `:6017` (the layer row), `:6386` (`openOwnAny`), `:6388` (the pass's failures), `:6394` (the ledger's raises), `:6478` and `:6485` (the signoff rows), `:5099` (`adoptedHolds`), and `:3683`, `:3691`, `:6008` (`readoptedAt`).
- **A sustain no longer closes the raiser's objection.** `closedByRuling` closes on an overrule only, by the existing rule (`src/severity.js:171`). Through it every reader keeps the raiser's id open:
  - `closedByRowRuling` (`:5097`), and through that `:4899`, the re-raise filter (`:5989`, `:6288`), `closedByLaterRuling`, `closedLater` and `standsAfter` (`:7429`, `:7431`, `:7463`), and the standing dissent (`:7465`);
  - `ruledNow` (`:5101`), so the row stays in the top layer's ledger and in layer 1's open list (`:6232`, `:6237`);
  - the raiser's answer-back entry (`:6010-6013`);
  - `closedInCall` (`:6462`), so a row sustained in layer 2's own review stays with the writer as the raiser's objection.
- **The raiser's history** (`closedOnRecord`, `:3706`) no longer marks a sustained id `adopted`: the id stays standing for its raiser. `GONE_STATES` keeps `adopted` (`src/objection-assign.js:44`), so that older records still read.
- **The hold** replaces the copy where a copy made the layer object: `:5677`, `:6017`, `:6386`, `:6485`. How long it lasts is question 1.

**What the second step does to the first step's parts.**
- Part 1, the hearing of a row shown in the prompt, stays.
- The set of copies a seat holds (`heldCopiesOf`, read only by a `continues`) reads the `adopted_as` of the rulings the run settles. The second step makes no copies, so that set is always empty, and it goes with the copy.
- Five of the first step's tests pin today's sustain (`test/continues-shown.test.js` CN-1d, CN-2, CN-2r, CN-2n1 and CN-2n2), so they join the tests that reverse.

## The record

- **Stays:** `escalations[].outcome[]` and `layers[].rulings_in_call[].outcome` (`id`, `lab`, `result`), each row's per-seat `rulings`, and `panelVerdicts[].sustained` and `layers[].sustained` (the seat holds the ids, and the layer objects).
- **No longer written in new reports:** `adopted_as` with its `withdrawn_in_exchange`, and `sustained_from`. Each stays declared in `schemas/report-v1.json`, so an older report still validates.
- **The meaning of `result: "sustained"` changes:** the objection stays its raiser's, and open. A script that relied on the old meaning, or on the fields that stop, breaks. That belongs in the CHANGELOG's changes that can break a script or a client.

## The wording

Two kinds of text change:
- **The sentences a model reads** (rows 1 to 7b) wait for the owner's yes, one form each.
- **The record texts and documents** (rows 8 to 16) land as draft wording, each named in the commit message.

Rows 1, 5 and 8 name how long a hold lasts, so each has a form per answer to question 1. Row 1's clause "it goes to the writer with your ruling" depends on question 2.

| # | Where | Today | Proposed |
| --- | --- | --- | --- |
| 1 | `src/prompts/recorded-083.js:225` (the stall and send-up ruling) and `src/prompts/recorded-084-b.js:131` (the layer-2 go-up ruling) | "If you sustain an objection, it becomes your own: it goes to the writer as one of your objections and is treated like any objection you raised." | (a) "If you sustain an objection, it stays the objection of the judge who raised it, and in this pass it holds up your layer's sign-off as an objection of yours would: it goes to the writer with your ruling." (b) the same, with "until it is closed" in place of "in this pass". |
| 2 | `recorded-083.js:272` and `recorded-084-b.js:183` (the top layer's ledger, the stall and go-up rulings) | "They are not in the ledger above." and "a sustained one belongs to the judge who took it over, in the ledger above, and follows the ledger's usual rule." | "The overruled ones are not in the ledger above." and "a sustained one stays with the judge who raised it, in the ledger above, and follows the ledger's usual rule." |
| 3 | `recorded-083.js:268` and `recorded-084-b.js:179` (the line for each sustained row) | "...: sustained in round N by <lab> (layer L); it is now <new id> of <lab>; see that judge's rows in the ledger above." | "...: sustained in round N by <lab> (layer L); it stays the objection of the judge who raised it, in the ledger above." |
| 4 | `recorded-084-b.js:204` (layer 2's rulings inside its review) | "Then rule on each objection: sustain it, and it becomes yours, or overrule it with a reason." | "Then rule on each objection: sustain it, or overrule it with a reason." |
| 5 | `recorded-084-b.js:208` (the same section) | "A sustained objection becomes yours and is treated like any objection you raised; one rated below 4 holds nothing up." | (a) "A sustained objection stays the objection of the judge who raised it, and in this pass it holds up your layer's sign-off as an objection of yours would; one rated below 4 holds nothing up." (b) the same, with "until it is closed". |
| 6 | `recorded-084-b.js:231` (the top layer's ledger, layer 2's rulings) | "They are not in the ledger above.", "A sustained one belongs to each judge who sustained it, under a new id given with it, and follows the ledger's usual rule;" and "the ledger lists each new id under its judge from the round after the ruling." | "The overruled ones are not in the ledger above.", "A sustained one stays with the judge who raised it, under its own id, and follows the ledger's usual rule;" and the last clause left out. |
| 7 | `recorded-084-b.js:227` (the line for each sustained row) | "...: sustained in round N by <lab> (layer L); it is now <new id> of <lab>; from the round after the ruling the ledger lists the new id under that judge." (with more than one sustaining judge: "each new id under its judge") | "...: sustained in round N by <lab> (layer L); it stays the objection of the judge who raised it, in the ledger above." |
| 7b | `recorded-084-b.js:15` (the relation rule; every judge of every chain with answer-back on reads it in every blind review) | "- \"continues O-xxxxxxxx\" for the same defect in a standing objection. Use this if an upper layer overruled your objection but it still stands because it is rated 4 or above." and "- \"reopens O-xxxxxxxx\" for the same defect in an earlier objection that you withdrew, that an upper layer overruled and closed on the record at a rating below 4, that an upper layer sustained and adopted, or that a re-tag below 4 cleared." | "- \"continues O-xxxxxxxx\" for the same defect in a standing objection. Use this if an upper layer overruled your objection but it still stands because it is rated 4 or above, or if an upper layer sustained it." and "- \"reopens O-xxxxxxxx\" for the same defect in an earlier objection that you withdrew, that an upper layer overruled and closed on the record at a rating below 4, or that a re-tag below 4 cleared." |
| 8 | `src/escalation.js:146` (the block above the deliverable) | "- <raised>: sustained in round N by <lab> (layer L), whose objection it then was (<new ids>). Final status: <one per new id>." | (a) "- <raised>: sustained in round N by <lab> (layer L); it stayed the objection of the judge who raised it and held up layer L's sign-off in that round. Final status: <the raiser's>." (b) "... and held up layer L's sign-off until it was closed. ..." |
| 9 | `src/escalation.js:137` (one final status) | "<lab> signed off in round N and still holds it as its own, open objection" | no longer reached: no new id is made, so the final status is the raiser's |
| 10 | `src/report-shape.js:459` (the board) | "sustained; from then on the objection of <lab> (<new id>)" | "sustained by <lab>; still the objection of the judge who raised it" |
| 11 | `src/chain.js:6016` (the run log) | "<id>: sustained by <labs>." | "<id>: sustained by <labs>; it stays the objection of the judge who raised it and holds up layer <L>'s sign-off." |
| 12 | `src/chain.js:5735` (the panel's summary line) | "...; then sustained <ids> as its own" | "...; then sustained <ids>, which it holds" |
| 12b | `src/chain.js:6301` (the run log: a judge raises again an id a ruling closed) | "raised <id> again, which a ruling in round N gave to another judge (sustained) - not counted." | no longer reached for a sustain: the raiser's id stays open, so its re-raise is counted |
| 13 | `docs/report-format.md:158` | "and a `sustained` one lives on under the ids in `adopted_as`, which `lastCritique.failures` lists with `sustained_from`." | "and a `sustained` one stays the objection of the judge who raised it, held by the judges who sustained it (`panelVerdicts[].sustained`)." |
| 14 | `AI-README.md:907` | "sustained, when a judge of that layer sustains it, which makes it that judge's own (one rated below 4 holds nothing back: the plan goes on to the next layer);" | "sustained, when a judge of that layer sustains it: it stays the objection of the judge who raised it and holds up that layer's sign-off (one rated below 4 holds nothing back: the plan goes on to the next layer);" |
| 15 | `schemas/report-v1.json`, `panelVerdicts[].sustained` | "...; it then holds them as its own, so its verdict reads objected whatever its blind review said." | "...; it then holds them (they stay their raisers' objections), so its verdict reads objected whatever its blind review said." |
| 16 | `schemas/report-v1.json`, `adopted_as` and its `withdrawn_in_exchange` | no description on `adopted_as`; "... the sustain made it the seat's own again ..." on `withdrawn_in_exchange` | "Not written since 0.8.5." on both |

Unchanged:
- **The relation rule's opening,** "Replace O-xxxxxxxx with your own objection id". The first step hears a "continues" on a row shown in the prompt without a change of wording.
- **The mock provider** keys only on the phrase `set "relation" to one of` (`src/providers.js:183`) and writes only `new` or `continues`, so row 7b does not move its replies.
- **The two ruling user prompts** hold no sentence about a sustain.

## The tests, and how they fail first

**The accepted tests that reverse.** They were found by a grep of `test/` for `adopted_as`, `sustained_from` and the `adopted` state. The grep also matches comments, and not every test was read in full. Each is an expected red, not run:
- `test/s7b-rulings.test.js` RC-3 (a sustain adopts the row and holds nothing), `test/s7b-records.test.js` RR-2 (a sustain recorded with the new id), `test/s7b-gaps.test.js` G-2 (two layer-2 judges both sustain);
- `test/s7-go-up.test.js` GU-H2, GU-3 (layer 3 sustains the sent-up objection) and GU-15b;
- `test/stall-escalation.test.js` SE-2, SE-3, SE-9 and SE-10;
- `test/stall-ratings.test.js` UB-3, UB-12 and UB-13: UB-13 asserts the copy listed as the sustaining judge's own, the old id not listed, and a raiser's "reopens" of the sustained id, and under this design each of those reverses;
- `test/short-exchange-sentup.test.js` T6a and Q6;
- `test/objection-closed-states.test.js`: the pin T12j / T12o / T20k / T20x (layer 2 sustains a sent-up objection rated 8: a new id under the layer-2 seat, and the original retired as adopted);
- `test/objection-spans-replay.test.js`: the declared pin on the stall path's adoption;
- `test/not-agreed-nothing-open.test.js` NAN-13 (the intro of the board passed up);
- because the sentences change: their held twins (`test/held-prompts/held-escalation.js`, `test/held-prompts/held-084-b.js`) and the comparisons that read them (`test/held-prompts.test.js`, `test/held-prompts-084-b.test.js`);
- the first step's CN-1d, CN-2, CN-2r, CN-2n1 and CN-2n2.

**New tests,** each red first on the tree before the change:
- after a sustain, the raiser's id stays open and the raiser is still asked about it;
- the sustaining layer objects by the row, so the plan is revised there, and one rated below 4 holds nothing;
- the top layer's ledger lists the row under its raiser;
- no `adopted_as` or `sustained_from` is written;
- the hold, for as long as question 1's answer makes it last, including its rebuild on a resume.

## The owner's gates

- **Prompt words:** rows 1 to 7b need the owner's yes.
- **Records:** `result: "sustained"` changes meaning, and two fields stop being written. Both are changes that can break a script or a client.
- **Recorded decisions** named at the changed sites:
  - **Reversed, in their sustain part:** an upper layer's adoption as a closing of the raiser's id (`:3693`, `:6613`); "a sustain adopts the objection under the sustaining seat" (`:6017`, `:6019`, `:6460`); the sustain branch of `closedByRuling` (`:5096`).
  - **Moot:** the re-adoption of an objection the sustaining judge withdrew in its exchange, "the later act counts" (`:3683`, `:5996`, `:6008`), because no copy is made.
  - **Kept:**
    - the overrule rule, which closes only below 4;
    - the re-tag rules;
    - the rule that one rated below 4 holds nothing;
    - the linked id of a "reopens";
    - the quote rules at the fold (`:6388`);
    - the dispute stage's run over the standing ids after an escalated sign-off (`:7453`), which now includes a sustained row.

## What the change must not touch

- the overrule and re-tag rules;
- the first step's hearing of a row shown in the prompt;
- the relation rule's other forms;
- the ladder's order;
- the spend cap and every price.

## Questions only the owner can answer

**Where a hold bites, by reading, not run.**
- On the seven shipped plan chains, no ruled row holds anything:
  - they run the ladder from the first pass;
  - a ladder pass makes no bound go-up and passes no stall up;
  - the one ruling left, layer 2's inside its own review, is on rows rated below 4.
- Five cases were not read: layer-3 re-tags, rows an exchange adds to a carried verdict, tree members, the answer-back's budget, and a resumed run with a credit.
- So on those chains the answers below change what the record says, not the climb.
- On a chain without the ladder they change the climb too, on the stall and bound go-up paths.

1. **How long does a hold last?**
   - **Today:** a sustain's copy holds its seat's layer in every later pass where that seat is asked, until the copy is closed by that seat's withdrawal with a quote, an overrule below 4 or a re-tag below 4. This was shown by a run on a fixture of a stall escalation, not of a ladder chain; for a ladder pass it is read from the same call, not run.
   - **(a) Until the row is closed,** as today. This needs a kept list of holds, across passes and across a resume, and new words: the sustaining judge is shown, in later asks, a row that is not its own, and is told how it releases it.
   - **(b) For the ruling's pass only.** No kept list and no new words. But a later pass can reach the sustaining layer again with the row still standing and no ruling asked (on a ladder chain the ladder can start a pass at layer 2), and that layer then signs off by its own verdicts. On a ladder chain this needs a sustain that holds, which arises only on a pass under the plain rules, such as a credited pass of a resumed run.
2. **What puts a sustained row before the writer on the stall and go-up paths?**
   - Today the copy does: the writer's list is the pass's failures, and the copy is among them (`:6387-6388`, `:6461-6465`).
   - In the ruling pass of a stall or go-up the raiser's layer is not asked, and nothing is carried into that pass (`:6645`). So without the copy, nothing gives the writer the row it must revise for.
   - Row 1's clause "it goes to the writer with your ruling" promises it.
3. **How should a run read that started before this change and resumes after it?**
   - Its stored rulings replay and settle as sustained, but no copy is made and nothing is closed, so the run takes another path.
   - A stored raiser reply that says "reopens <the sustained id>" names an id that now stands, and is refused.
   - A stored sustaining reply that names a copy's id is refused unless that id is shown to the seat.
   - Later stages whose prompts changed are kept as answered under earlier wording until a stage runs live (`src/stale-guard.js:82-96`).
   - Read, not run. The options are to accept this, or to fence the new reading by the run's start (a new mechanism).
