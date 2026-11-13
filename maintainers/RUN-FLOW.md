# How a run flows

How a run moves from a chain file to a finished plan, as the code stands for 0.8.4. `CLAUDE.md` points here. Read
this before you change `src/chain.js`, or write or change a chain file or a seat.

**Config is the product.** `chains/*.json` are not examples - they are how behaviour is chosen. A chain names its
seats (`criteria`, `skeleton`, `proposers[]`, `builder`, `reviser`, `handoff`, `decider`, `critics[]`), a
`maxRounds` cap where it has one, and feature flags (`questions`, `proposals`, `debate`, `handoff`,
`signoff: "unanimous"`, `panel: "relay"`); `runChain` reads those flags and skips whole stages. A capability is
usually a stage in `chain.js` plus a flag, not a new chain file. A chain's switches (`signoff_table`,
`answer_back`, `debate_hygiene`, `handoff_contract`, `judging`) are listed in `config/chain-schema.json`
(`test/chain-schema.test.js`); `"judging": "all-roles"` is the explicit override that lets a chain's architects,
proposers and deep dive also vote. Under `signoff: "unanimous"` the lint refuses a builder or reviser whose lab or
model also holds a critic seat, unless the chain says `"selfReview": "allowed"`.

**The shipped planning chains run the ladder.** Every `chains/plan-*.json` is `signoff: "unanimous"`, gives each
judge in `critics[]` a `layer` (1, 2 or 3) and carries `ladder: { block: 3, visits: 3 }`; none has `maxRounds`, so
the chain file sets no cap on the review passes (`test/ladder-chain-key.test.js`). Its `skeleton`, `builder`,
`reviser`, `handoff` and `decider` seats are `provider: "external"` with the model `claude-code-session`: the
person's own session sits on them as the **handling session**, and it writes and revises the plan. The `criteria`
seat is external as well, under a model name of its own (`subscription:opus-5.5`). The lint refuses a layered chain
with no handling session unless every seat is mock (`test/layered-handling-session.test.js`).

A **seat** is `{ provider, model, maxTokens?, temperature?, extra?, lab? }`. On a planning chain a judge also
carries `layer` and `persona`, a proposer `persona`. Independence accounting keys off `labOf(seat)` =
`seat.lab || seat.provider`: without `lab`, a seat's lab is its PROVIDER, so set `lab` whenever the provider is a
router or a mock - three OpenRouter seats without it count as ONE lab (with three `lab` values, three); mock chains
put two labs on one provider this way. Blind-panel and debate logic key off it, so getting `lab` wrong silently
corrupts the thing the harness exists to measure. A layered judge with no `lab` of its own is refused
(`src/layers.js`).

**Stage flow of a planning run** (`runChain`, in order): criteria → skeleton → proposals (blind, per lab) → debate
(anonymised posts, then author keep/amend/withdraw) → build → passes (each one review of one draft by the judges'
layers, then a revision if a layer objects) → dispute (only with open objections and no agreement) → final read →
handoff. Two termination modes: `first` (any one critic passes) and `unanimous` (every critic signs off on the
*same* draft, else the reviser fixes the union of all objections and the whole panel re-reviews). On a ladder chain
the whole panel does not re-review: the next pass starts at the ladder's floor. A chain that names no `signoff`
runs `first`, the critique loop (`critique-<round>`).

**External seats pause the run.** `provider: "external"` throws `ExternalPause` (thrown, not returned, so control
flow stays linear). The CLI catches it, writes `NEEDS-<stage>.md` with both prompts, and exits 3. The run resumes
once `<label>.md` exists. The MCP path exposes the same thing as `external_prompt` / `submit_stage`. A paused run
is not a stuck run. A stage of the handling session pauses the same way, and so does the repair pause for a
near-JSON reply, which carries the original reply.

**A pass** (`round` in the code and in the stage labels; the run log prints "Round N") is one review of one draft.
`floorOf` (`src/ladder.js`) picks the layer it starts at: layer 1 while the current block has had fewer than
`ladder.block` layer-1 revisions, else layer 2 while layer 2 has had fewer than `ladder.visits` visits since layer
3's last one, else layer 3. From that floor the layers are asked upward, in order (`panel-<round>-*`;
`test/layered-panel.test.js`). Before a layer's state is decided its judges can debate each other (the layer
exchange, `ldebate-<round>-*` and `lreply-<round>-*`). A layer that signs off lets the next one be asked in the
same pass; one that does not ends the pass there, and the layers above it are not asked. After an objection the
handling session revises (`revise-<round>`), and a visit to layer 2 or 3 that ends in an objection sends the next
pass back to layer 1.

**Agreement and the end.** When the top layer signs off (every layer asked before it on that pass has then signed
off too), the handling session is asked the build check (`build-check-<n>`; `test/build-check.test.js`):
`good_to_build` for that pass records the agreement (`agreedByCheck`), `not_yet` with its reasons counts as a
layer-3 objection, and a non-answer is set aside and the check asked again. An agreement on a pass that started
above layer 1 has kind `ladder` and leaves `passed` false. A finished run exits 22 when `endsNotAgreed(report)` is
true, else 0: that check reads `ending.kind` where an ending is recorded (and a final read that blocks), and
`passed` only where none is. Two cases stand outside it: a run whose security review blocked it or could not judge
it exits 7 or 8 before that check, and a tree member keeps 0, because its record carries the outcome. At every end,
an agreed one included, the top-layer seats that have not read the final text read it (the final read,
`final-read-*`; `test/final-read-stage.test.js`). At an end that is not agreed, a top-layer seat that did read this
text is asked again when the open objections and late findings hold an item its last verdict was not shown (only
while `sortingOn` in `src/sorting.js` holds). A finish at once (below) skips an owed read. The final read has no
key in the chain file, and the lint refuses a chain that names `final_read`.

**Stops and exit codes** (`test/exit-codes.test.js`). Exit 23 is a stop that waits for the person. A ladder run
stops this way for a top-layer objection that stalled (`stall_stop`; on a ladder pass only the top layer's counts,
and it is never passed up: `test/stall-stop.test.js`), a judge that stayed silent after being asked again on its
own, a final text that no seat read, the limit of top-layer reads the person typed (`--rounds N`), and the person's
own pause before a pass. At a stop the person can continue, finish (the run ends not agreed; the dispute stage
still runs, then a final read if one is owed, then the handoff), finish at once (`finish_now`: not agreed, and no
judge reads again; `test/finish-now-stops.test.js`) or pause and resume. One exception: at the stop for a final
text that no seat read, finishing at once keeps the verdict of a panel that had signed off before the read. The
handling session may relay the person's words; the person's own stops (the pause, the spending limit, the
`--rounds` limit) it relays and never answers. Among the other exits: 11, personal data or a key-shaped text that
would be sent: found before the run starts, it refuses the run by default (nothing started or spent); a key-shaped
text in a later prompt pauses the run (`STOPPED-secret.md`; the prompt is sent only on `--continue`, typed at a
terminal or relayed by the handling session with the person's own words through `--stop-gate`); 4, the spending
limit, before the next call is paid; 5, an unpriced seat under a cap (refused before anything is sent); 21, a paid
run with no typed limit yet (nothing starts); 24, OpenRouter refused a price, and 25, a conflict needs the person
(both resume).
