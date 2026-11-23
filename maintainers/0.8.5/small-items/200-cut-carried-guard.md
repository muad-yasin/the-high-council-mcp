# 200: when a finish cuts a layer, a carried verdict is read as if it were new

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is wrong

When a person's finish cuts a layer in the middle of a pass, `noteCutOpen` (`src/chain.js:5692-5712`) records as open, marked `cut_off`, what each cut verdict objected to. Its loop over the verdicts (`:5702-5711`) takes every verdict's failures and its own open objections (`:5705`). It does not ask whether the verdict was carried.

How a verdict comes to be carried:
- When the draft is unchanged since the last pass, the pass's verdicts are kept (`:6808`) and handed back into the next pass marked `carried: true` (`carriedVerdict`, `:5614-5619`).
- A carried verdict was already counted in the pass that produced it.

The two other places that read a pass's verdicts treat a carried verdict differently. They count only the objections that the current pass's exchange added to it:
- `:5718` commits the severity tags. Its comment: "A carried verdict counted in an earlier pass, except for what this pass's exchange minted on it."
- `:6240` builds layer 1's open objections: from the objection ledger (`objectionLedger`, `:6232`), plus each layer-1 verdict's own (`:6237-6246`).
- Both skip a carried verdict's failures. For its own open objections, both use `v.carried && v.exchangeChangedIn !== round ? [] : openOwnOf(v)`.

The exchange can add objections to a carried verdict in the pass being cut, and each time it sets `exchangeChangedIn: round`:
- own open objections, for a stated pass (`:5939`) and for a clean sign-off (`:5953`);
- failures, for an objecting verdict: new ones join the list at `:5956`, and the verdict is rewritten at `:5967`.

## What it changes today

- **Inherited objections already on the record:** nothing changes. The held list wins (`heldKeys`, `:7467-7468`). `test/finish-cut-objection-open.test.js:143` pins this on a layered chain: a carried objection stays as it was, not `cut_off`, and the dispute stage still litigates it.
- **Objections the cut pass's exchange added:** today's loop keeps them open, which is right, and the change must keep them.
- **Inherited objections that are not on the record:** not established by reading. Whether a carried verdict can reach the cut holding such objections is the open point. One candidate:
  - The layer exchange and its rating ledger run on every layered unanimous chain, the shipped planning chains among them (`:4597`, `:4712`).
  - An own objection rated below the settle line holds no sign-off (`:5737`).
  - When a lab's latest verdict signed off while holding only such objections, the list of judges not asked in the final round adds nothing for it (`:7444`).
  - `noteCutOpen` would then put those objections on the open list as `cut_off`.
  - That chain was read, not run. The two other sources of the held list, the unheard judges' objections (`:7429`) and the standing ones (`:7462`), were not checked for this case.
- **An unlayered pass** (the caller at `:6166`): only the layer exchange sets `exchangeChangedIn`, so after the change a carried verdict there contributes nothing. Whether the held list already holds its objections was not read.

## The smallest change

Whether to make it follows from the open case, so the case is established before the change, not only before CO-3:
- If no run can reach the case, the change is a guard with no visible effect.
- If a run can reach it and the owner answers (a) to question 1, nothing changes and the item closes.
- If a run can reach it and the owner answers (b), the change below is made.

This is not the siblings' test word for word. The siblings always skip a carried verdict's failures. This change keeps them when the current pass's exchange changed the verdict, because that exchange can add failures to it (`:5956`).

In `noteCutOpen`'s loop (`src/chain.js:5705`):

```js
for (const f of (v.carried && v.exchangeChangedIn !== round ? [] : [...(v.critique && v.critique.meets !== true ? v.critique.failures : []), ...openOwnOf(v)])) {
```

- Do not copy the failures half of `:5718` (`v.carried || !v.critique ? []`). It would drop the failures that the current pass's exchange added to a carried verdict.
- Do the siblings skip what `:5956` adds, or does the ledger behind `:6240` already carry it? That was not examined, and it is outside this item.
- The change sits inside `noteCutOpen`, so it covers both callers: the unlayered pass (`:6166`) and the layered one (`:6333`).

## The test, and how it fails first

No test fails today without the change. The tests below use the scenario helper of `test/finish-cut-objection-open.test.js` (`scenario`, `test/helpers/layer-two-run.js`), offline and at $0.
- **CO-1, the allowance.** Take a carried verdict that OBJECTED, to which the cut pass's exchange added a new objection, and then a finish that cuts the same layer after its exchange. After the cut, that objection is open, marked `cut_off`.
  - Today it is green, and it must stay green.
  - Its red run is against a known-bad tree: the guard copied in the `:5718` form, which drops the new failure.
  - It must be an objecting verdict. A stated pass or a clean sign-off gets the new objection in `openOwn`, which the `:5718` form keeps when `exchangeChangedIn` is the current pass, so the test would be green on the bad tree too.
  - The cut must come after the layer's exchange, inside the same layer. The existing tests' cut labels (`git grep -n cutLabels -- test/`, with the labels held in variables resolved) cut a judge's ask or re-ask (for example `panel-1-r3-reask3`, `test/signed-text-round-sent.test.js:94`), a post of the exchange, a revise, a final read or the handoff. None was confirmed to come after a layer's exchange inside that layer. Finding that call is the builder's first step.
- **CO-2, the unlayered pass.** Use the shape of the `:143` case on the `FLAT` fixture (`test/finish-cut-objection-open.test.js:29`): a carried judge's objection is still open after the cut, before and after the change.
- **CO-3, the inherited case.** Write it only once the candidate above is established. A carried verdict holds own objections rated below the settle line, and its lab's latest verdict signed off. After the cut, the open list holds them or not, as question 1 decides.
- `test/finish-cut-objection-open.test.js:143` stays green before and after the change.

These run with the change:
- the tests that read `cut_off` (`git grep -l cut_off -- test/`): `test/finish-cut-objection-open.test.js`, `test/review-notes-cutpaths.test.js`, `test/review-notes-cutreply.test.js`, `test/review-notes-reask.test.js` and `test/review-notes-wiring.test.js`;
- the source scanners.

## The owner's gates

- **Prompt wording:** none.
- **Sentences a person or a session reads:** none.
- **Money:** none. Objections marked `cut_off` stay out of every list a model is asked about (`:5691`), so no paid call depends on them.
- **Hand-typed counts:** none.
- **Records:** the change decides which objections a cut run's report lists as open: `signed_text.open_objections` and `dispute.open_objections` (as `:143` reads them), and the accept list, which reads the latter (`openObjectionsOf`, `src/acceptance.js:28-30`). The change moves them only in the cases that are not yet established.

## What the change must not touch

- The exchange's allowance (`v.exchangeChangedIn !== round`).
- The held list and its de-duplication (`:7466-7468`).
- `cutWithdrawn` and the `gone` filter inside `noteCutOpen`.
- The panel rows of a cut (built by `panelRowOf`, `:5669`, and marked `cut: true` by the callers, at `:6166`, `:6336` and `:6501`).
- Stage labels.

## Questions only the owner can answer

1. If a run can reach the inherited case above, what should a cut run's record show for the own objections, rated below the settle line, of a carried verdict whose lab signed off?
   - (a) Open, marked `cut_off`, as today.
     - Result: they count among the run's open objections and appear in the accept list.
     - At the end of an uncut run, the same objections are not open.
   - (b) Not open, as at the end of an uncut run (the change).
     - Result: a cut run's open list matches the uncut one for that verdict.

   The rule the answer must fit is the one in the comment at `src/chain.js:5690-5691`: what a judge's cut row objected to stays on the record as open, whichever finish cut it. In `:143`, the carried judge's row is marked `cut`.
