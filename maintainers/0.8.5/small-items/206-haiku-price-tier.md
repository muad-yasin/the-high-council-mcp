# 206: the price rows for Claude Haiku 5.5 price every prompt at the long-prompt rate

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is wrong

**The direct row.** `anthropic/claude-haiku-5-5` (`src/pricing.json:1588-1591`) is `in 0.5`, `out 2.5` (US dollars per million tokens), with no `tiers`. Its own `_source`, a reading of Anthropic's price page dated 2026-10-30, says the model costs $0.10 / $0.50 for prompts up to 100,000 tokens and $0.50 / $2.50 for longer prompts. It says the row holds the higher pair "so the cap never projects less than a long prompt bills".

That was the safe choice while a price could not depend on the size of a prompt. Since 0.8.4 it can:
- A row's `tiers` list prices a call at the highest tier its prompt reaches (`src/price-table.js:135-147`; the pick is at `:144`).
- The spend cap's projection uses it (`worstCaseOf`, `src/cost.js:983-985`, sized from the call's characters at `src/chain.js:2182-2183`).
- So do the gate (`expectedCallUsd`, `src/chain.js:2333`), the reservation written before the call (`src/chain.js:2373-2374`), and the cost counted after the call (`costOf`, `src/cost.js:220-226`, at the size the provider reports; called at `src/chain.js:2405` and `:2552`).

So for every Haiku call whose prompt is up to 100,000 tokens, THC projects, gates, reserves and counts five times the rate on the page.

**The routed row, the same over-count.** With the default `auto` setting, a Claude seat goes through OpenRouter when there is no usable Anthropic key and there is a usable OpenRouter key (`claudeRouteOf`, `src/claude-route.js:43-55`).
- The seat is rewritten to `provider: "openrouter"` with the OpenRouter model id (`src/providers.js:119`), so its calls are priced at the row `openrouter/anthropic/claude-haiku-5.5` (`src/pricing.json:1069-1076`).
- That row is `in 0.55`, `out 2.75`: the long-prompt pair of the dearest host, a regional one.
- Its one tier, at 100,000 tokens (`:1076`), equals its base, so it changes nothing.
- Its `hosts` block (opening at `:1077`) says `tier_driven: true` (`:1091`).

The consequences, on either route:
- The counted spend reaches a person's limit while the bill is still below it, and the run stops there.
- The spend recorded in the run folder is higher than the bill.

Five shipped chains seat this model as a judge with `provider: "anthropic"`: `plan-mini-council`, `plan-medium-council`, `plan-high-council`, `plan-claude-council` and `plan-the-high-council`. The README's figures are derived from the chain files as written (`provider: "anthropic"`), so they price the direct row.

A tier can only raise a call's price above the row's base (`src/price-table.js:146`). So a row's base must become the short-prompt pair, and the long-prompt pair must become a tier.

## The smallest change

1. In `src/pricing.json`, change the row `anthropic/claude-haiku-5-5`: `"in": 0.1, "out": 0.5, "tiers": [{ "from": 100001, "in": 0.5, "out": 2.5 }]`.
   - Rewrite its `_source` from a fresh, dated reading of the price page. `test/price-table-date.test.js:22` checks the table's `asOf` against the newest reading date.
   - `from` 100001 is the page's "over 100,000". Where the line goes is question 2.
2. Change the routed row only if question 3 says so.
   - Its figures are written by `scripts/refresh-openrouter-prices.mjs`. The script's header keeps a tier-driven row's `in` and `out` at "the higher of today's figure and the dearest eligible host at BASE price (never lowered)" until the cap reads the tiers (`scripts/refresh-openrouter-prices.mjs:12-15`).
   - The cap does read them now: `worstCaseOf` sizes the prompt and prices it with `priceAt` (`src/cost.js:983-985`, sized at `src/chain.js:2182-2183`), and so does `costOf` (`src/cost.js:220-226`). Two texts still say otherwise and are stale together: the routed row's source ("until src/cost.js learns prompt-length tiers") and the script's header ("only once DUALCAP's wiring (4d) passes them a prompt size").
   - So lowering this row also means changing that rule; otherwise the next refresh would raise the row again. The script's writing code was not traced further.
3. Run `node scripts/regen-derived-figures.mjs`, then the same command with `--check`. Its header names everything it rewrites: the README pricing table, the dry-run figures in the planning chains' descriptions, the AI-README rows, the landing-page sentence, the sentences that compare a figure with the default cap, the review-notes Known-limit bounds and `maintainers/MODEL-CAPS.md` (whose Haiku row is at `:10`).
4. Make two edits by hand, because the script's header says it covers neither:
   - the `plan-high-council` file pin in `test/plan-tiers.test.js:215`, with a CHANGED ACCEPTED note;
   - any Known-limit sentence that a moved figure makes false.

No code in `src/` changes. The dry run's expected figure reads the base row without a size (`src/cost.js:557`, `:573` and `:726`). After the change, Haiku's expected figure uses the short-prompt pair at every size, which is what `KNOWN-LIMITS.md:188` already says of every tiered row ("for a very long prompt it reads low"). The upper estimate and the spend cap count the step.

## The test, and how it fails first

New cases in `test/price-tiers.test.js`, offline and at $0. The boundary in HK-1 follows the answer to question 2.
- **HK-1.** `priceAt('anthropic', 'claude-haiku-5-5', 100000)` has `in` 0.1 and `out` 0.5. `priceAt(..., 100001)` has `in` 0.5 and `out` 2.5. `priceOf('anthropic', 'claude-haiku-5-5')`, which takes no size, has the short-prompt pair.
- **HK-2.** `costOf('anthropic', 'claude-haiku-5-5', { input: 50000, output: 1000 }).usd` is 0.0055. At `input: 120000` it is 0.0625. Compare with a tolerance.
- Expected red today (not run): the row has no tiers, so every size is priced at 0.5 / 2.5. HK-1's short-prompt case fails, and HK-2's 50,000-token case gives 0.0275.
- If question 3 adds the routed row, the same two cases run on `openrouter` / `anthropic/claude-haiku-5.5` with its own pairs.

At least these tests read the Haiku price and run with the change (`git grep -n -i -E "haiku-5[-.]5" -- test/`):
- `test/cache-record.test.js` CR-9 (`:94-97`) prices a marked direct Haiku call by `priceAt`, so it moves with the row.
- `test/cache-anthropic-record-b3.test.js:10-12` holds three Haiku figures recorded on a real run.
  - Each of those prompts is over 100,000 tokens once its cache counts are added, so they keep the long-prompt pair and should stay green.
  - The file's header names the row as 0.5 / 2.5, and that note goes stale.

These follow the derived figures and the tier rules:
- `test/pricing-table.test.js` (the README table);
- `test/regen-derived-figures.test.js` RD-1 (`:33`);
- `test/plan-tiers.test.js:215`;
- `test/notes-lane-on.test.js` NL-4b (`:91`);
- `test/model-caps-report.test.js`;
- `test/dry-run-figures-docs.test.js`;
- `test/price-tiers.test.js` PT-1 (`:10`) and PT-4 (`:42`);
- `test/price-size-wiring.test.js` PSW-0 to PSW-8;
- `test/price-table-date.test.js`;
- the source scanners.

The other test files that name the model do not read its price: reasoning, routing, caching and record tests.

## The owner's gates

- **Prompt wording:** none.
- **Sentences a person or a session reads:** no CLI or MCP sentence changes. The figures that move are derived by the script. A Known-limit sentence that a moved figure makes false is rewritten by hand and stays A-DRAFT until the owner's yes. A row's `_source` is provenance.
- **Money:** this is a money path. `src/pricing.json` is the price source of the spend cap, the gate, the reservation and the counted cost (`maintainers/ARCHITECTURE.md`, "The spend cap").
  - Recorded figures: a run folder's `<label>.usage.json` keeps the dollar figure counted at call time, and `council --spend` adds those stored figures (`src/spend.js:94-96`). So past runs keep their figures, and only new calls count at the new rate.
  - The reservations file still records a call's worst case before the call ("Cross-run spend: what is recorded").
- **Hand-typed counts:** none. The figures are derived and checked by RD-1, and `maintainers/run-costs.json` holds measured run costs with no Haiku price in it.

## What the change can worsen

The tier is chosen before the call, from the prompt's characters divided by four (`src/chain.js:2182`, `src/cost.js:966`). Code, JSON and some languages can hold more tokens than that, so a call projected just under 100,000 tokens can be billed at the long-prompt pair after it was gated and reserved at the short one.

The Known limits already name this edge: "A long call that passes a price step its estimate did not reach is another" way for a run to end above its limit (`KNOWN-LIMITS.md:26-41`). The architecture notes say the same (`maintainers/ARCHITECTURE.md`, "The spend cap"). After the change, the edge reaches Haiku calls near 100,000 tokens. Today's rows hide it, because they price every call at the long-prompt pair. The counted cost stays right either way: `costOf` uses the provider's reported counts.

## What the change must not touch

- `src/price-table.js` and `src/cost.js`. The tier machinery exists; only the rows change.
- Every other row.

## Questions only the owner can answer

1. The table's notes say that it never lowers a price (`src/pricing.json:2`, and the row at `:57`). This change lowers a shipped row's base to the page's short-prompt pair, so that each Haiku call is priced at the rate for its own prompt's size. Is that allowed?
2. Where should the long-prompt pair start?
   - (a) At 100,001 tokens, the page's line.
     - Result: every call is priced as the page lists it, as long as its characters divided by four are right.
     - A call whose real size is above that estimate can be gated and reserved at the short pair and billed at the long one, near the line.
   - (b) Earlier, for example at 80,000 tokens.
     - Result: calls between that line and 100,000 tokens are gated, reserved and counted at the long pair, which is high, as every call is today.
     - The edge described in (a) becomes rarer.
3. Does this item also change the routed row, `openrouter/anthropic/claude-haiku-5.5`?
   - Result: runs without an Anthropic key get the same correction, at the routed row's own pairs: $0.11 / $0.55 and $0.55 / $2.75 for the dearest host, per its source.
   - The refresh script's rule for tier-driven rows changes with it.
4. Does this item also fix `google/gemini-2.5-pro` (`src/pricing.json:44`)? That row holds the lower of its two pairs: its source names $2.50 / $15 over 200,000 tokens, so for a long prompt the cap projects less than the bill.
   - Result: on a person's own chain, a long prompt is projected at the rate it is billed. No shipped chain seats the model (only retired chains in `chains/outdated/` do), so no shipped figure moves.

## Facts to read again before the change

Two facts come from Anthropic's current price page:
- the two pairs;
- whether the 100,000-token line counts cached tokens too.

THC's `costOf` takes input plus cache reads plus cache writes as the prompt's size (`src/cost.js:225`). For the routed row, the same holds for OpenRouter's current endpoint list.
