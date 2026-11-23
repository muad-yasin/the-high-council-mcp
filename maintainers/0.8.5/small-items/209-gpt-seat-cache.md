# 209: THC adds no cache mark for its GPT seats behind OpenRouter

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note except one evaluation of two pure functions on the shipped chain files (named under "What THC sends"). Every "expected red" below is a prediction that the first test run must confirm.

In this note a **selected seat** is an OpenRouter seat whose model is an `openai/` GPT of version 5.6 or later, or an `openai/` id whose version THC cannot read (`isAutoCacheWriteModel`, `src/cost.js:135`).

## What is wrong

**What THC sends.** THC adds a cache mark for two kinds of seat only: a direct Anthropic seat and a Claude seat routed through OpenRouter.
- **The gate** is at `src/chain.js:2147`.
- **The mark's lifetime** (`markTtlOf`, `src/cache-order-gate.js:53-57`) is non-null only for those two kinds of seat. Its two other conditions:
  - `exchangeLayerOf` (`:41-46`): the seat's layer has two or more judges, and is the lowest layer or one that runs the shortened exchange. A judge alone in its layer is never marked: it "would pay the write and read nothing", in the words of the comment above `markTtlOf`.
  - `settingsDependOnCap` (`:64-69`): the seat's reasoning setting is not derived from its output cap.
  - Every selected judge seat listed below meets both. This was evaluated with `node`, importing `src/cache-order-gate.js` and `src/short-exchange.js` and calling the two functions on the shipped chain files: the shortened exchange is on in the shipped code (`shortExchangeOn()` is true), every listed layer has two or more judges, and no listed seat's setting depends on its cap. The cap-dependent case is the budget form of `highExtraFor`, `src/reasoning.js`.
  - `markTtlOf` also needs the chain's `prompt_cache` lifetime and a live cache order (`cacheOrderSeat`, `:22`).
- **The adapter** marks only a routed Claude seat (`src/providers.js:1686`). Its comment at `:1685` says `cache` is passed for no other seat.
- **The request body** of an OpenRouter seat (`src/providers.js:1697-1713`) carries the seat's `extra` (spread first, at the root: `:1706`), the model, the messages, the output limit, an optional temperature, the run's `session_id` (`:1711`) and `plugins` (`:1712`).
- No `prompt_cache_key`, `prompt_cache_breakpoint` or `prompt_cache_options` appears anywhere in `src/`. A seat's own `extra` can still add a caching option at the root, as `KNOWN-LIMITS.md:21` allows.

This is pinned on purpose. `test/cache-marks.test.js:317` (a recorded decision, "GO row 8" in its name) builds a layer of two GPT-6 Luna judges and checks three things:
- `markTtlOf` gives no mark;
- the judges still get the new prompt order;
- no key containing "cache" appears at any depth of any request body.

**What THC counts.** For a selected seat with no mark, the cache mode is `auto` (`src/cost.js:148-152`). `costOf` charges every uncached prompt token at the row's write multiple, because OpenRouter's caching page says this family bills a cache write at 1.25 times the input price even with no marker sent (the comment at `:236-237`; `CHANGELOG.md:135`).
- So THC counts what the page says is billed. Unlike item 206, this is not THC counting more than the bill.
- What is lost is in the bill: if no later call reads the written prefix, each call is billed the write price for all of its uncached prompt and the read price for none of it.

**Where it reaches.**
- Every shipped planning chain turns prompt caching on, at the 5-minute lifetime in the four chains that seat these models (`chains/plan-*.json:51`).
- Their cache order gives the judges a shared head (`cacheHead`, passed for a laid-out prompt at `src/chain.js:1771`, `:5314` and `:5365`). Only `:5314` and `:5365` add `markOf`, which gives a GPT seat nothing (`:4709`).
- The selected judge seats:
  - GPT-6 Luna at layer 1 in `plan-mini-council`, `plan-medium-council`, `plan-high-council` and `plan-the-high-council`;
  - GPT-6.1 Terra at layer 3 in `plan-mini-council`;
  - GPT-6.1 Sol at layer 3 in `plan-medium-council`, and at layer 2 in `plan-high-council` and `plan-the-high-council`, where GPT-6 Astra sits at layer 3.
  - Sol is also a proposer in those last two chains. No proposer call passes a head: the head is passed by the panel calls (`:5314`, `:5365`), the exchange's posts and answers (laid out at `:3024`), the refused-sign-off re-asks (`:7112`, `:7157`) and the final read (`:1771`), and by no other call (`git grep -n cacheHead -- src/chain.js`).
- With zero retention on, Luna can be served by Azure hosts only (`src/zdr-hosts.json:3704-3716`). Otherwise its seat leaves out one host (`extra.provider.ignore`), and other hosts can serve it.

**Reported, not verified here.** The two pages below were read on 15 Nov 2026; this note re-read neither.
- **Observed in runs** (with zero retention on, so the calls went to Azure): every Luna and Sol call reported a cache write of about its whole prompt and no cached tokens, while other models in the same passes read their shared head from the cache.
- **Inferred from Microsoft's page on prompt caching in Azure OpenAI:**
  - for these models, the default places the cache point at the latest message, which differs on every call;
  - a cache key, together with an explicit breakpoint at the end of the shared prefix, is the documented way to make the prefix reusable;
  - an explicit mode with no breakpoint turns caching, and its write charge, off.
- **Inferred from OpenRouter's prompt-caching page:**
  - the same two fields for OpenAI models: a mode at the root, and a breakpoint on a text block;
  - a cache key as the sticky-routing key. THC's own comment names `session_id` instead, which THC already sends (`src/providers.js:1812-1813`).
- **Documented by neither page:** whether OpenRouter passes these fields on to Azure, and whether a key keeps the calls with one host.
- **The size of the saving,** derived and not recomputed: in the two runs, the unread writes cost a few cents per run, and working reads would have saved about ten cents per run.

## The smallest change

1. **A switch first.** Build the gate and the adapter branch behind a switch that no shipped chain sets. No code path can send a breakpoint today: a seat's `extra` reaches only the body's root (`src/providers.js:1706`), and a breakpoint goes on a message block.
   - **The gate:** let `markTtlOf` (`src/cache-order-gate.js:53`) and `cacheOn` (`src/chain.js:2147`) mark a selected seat when the switch is on. Both conditions above still apply. Both functions feed the dry run too (`markFor` and `inputUsdOf`, `src/cost.js:541` and `:546`).
   - **The adapter:** in `callOpenAICompat` (`src/providers.js:1684`), for a marked `openai/` model, split the user text at the head as for a routed Claude seat, then put the provider's breakpoint field on the head block and its mode field at the root. The exact names and nesting come from the current documentation.
2. **A paid check,** on the owner's go and under a cap the owner types. It must be able to come out either way.
   - **The chain:** a layered unanimous chain with two GPT-6 Luna judges in its lowest layer, prompt caching on at the 5-minute lifetime and the cache order live, so that the gate marks them (a judge alone in its layer is never marked). Its task must give a judge an objection that stands. The exchange runs only with two heard judges and a standing objection (the comment at `src/chain.js:4597`), and a pass in which no judge objects writes and never reads (`KNOWN-LIMITS.md:20`).
   - **The two calls that count:** a judge's blind review (the panel call, which writes) and the same judge's exchange post in that pass, inside the 5-minute lifetime. A run with no such post, or with the post after the lifetime has passed, is no result either way.
   - **The proof before any paid call:** the chain's request bodies are shown offline to carry the fields, by CK-1's method. Otherwise "reads nothing" cannot be told apart from "sent nothing".
   - **The host:** the run has zero retention on. A call to Luna is then sent with the list of its Azure hosts as the only hosts allowed (`zdrAllowedHosts`, `src/zero-retention.js:61`; passed by `invoke()`, `src/price-pin.js:121`). The start refuses a chain with an OpenRouter seat that no zero-retention host serves (`zeroRetentionStops`, `:66`), so the chain's other seats need such a host, or must send nothing to a hosted lab (mock or external). Each call's record names the endpoint that served it, when OpenRouter's reply names one (`src/providers.js:1747`, recorded at `src/chain.js:2510`). Read and keep it.
   - **Two runs:** a baseline with the switch off, then the same chain with it on. The baseline stands in for the runs above, which are not in the repository. Each goes through `invoke()` under its own `--max-usd` (the cap is per run), and the dry run of the chain prices each before the go.
   - **The outcomes:**
     - The marked post reads the cache and the baseline's does not: go on with steps 3 and 4, and with question 1.
     - The marked post reads nothing: the change saves nothing, and what follows is question 4.
     - The baseline's post reads the cache too: the missing fields are not what stops a read, and the reported runs had another cause. What follows is question 4 as well.
3. **The key,** per run and per seat.
   - The run's id lives in `src/providers.js` (`setOpenRouterSessionId`, `:1816`; made by the CLI at `src/cli.js:4133-4135` and kept in `run.json`). The seat is known in `src/chain.js`. The two meet only if `chain.js` passes the seat inside the `cache` argument.
   - A run with no id is a designed state ("Not set (null): no OpenRouter request changes", `src/providers.js:1814`). This note proposes sending no key then, as for `session_id`.
4. **The money path, in the same change.** The projection of a marked head on a selected seat is built and tested: `worstCaseOf` prices it at the row's own multiples (`src/cost.js:993-995`), as M2 (`test/cache-auto-write.test.js:276`) pins. What is missing:
   - **The settle.** `costOf` prices the cache counts of a marked call with `cacheMultsOfCall` (`src/cost.js:256-261`), which takes the fixed lifetime table for any model that is not a routed Claude one: read 0.1, write 1.25 at the 5-minute lifetime (`:132-134`; `src/cache-prices.js:9-14`). Against each row's own multiples at that lifetime:

     | Row | Where | Row's read / write | Against the table |
     | --- | --- | --- | --- |
     | Luna | `src/pricing.json:1037` | 0.1 / 1.25 | agrees |
     | Astra | `src/pricing.json:701` | 0.1 / 1.25 | agrees |
     | Sol | `src/pricing.json:1306-1312` | 0.05 / 1.25 | the read parts |
     | Terra | `src/pricing.json:1456-1462` | 0.05 / 1.25, on a basis of 1.0 below its `in` of 1.2 | the read parts |

     So for Sol and Terra, the settle counts a read at twice the rate the dry run's read rows use. The cap never assumes a hit (`CHANGELOG.md:88`), so the settle errs high, never low.
   - **`readUsage`** accepts only `5m` or `1h` as the lifetime asked for (`src/cost.js:199`).
   - **`usageOfOpenAICompat`** (`src/providers.js:1798`) takes the written tokens out of `input` for a marked call. That rule was measured on Claude hosts only (`:1783-1784` and `:1795-1796`), and whether Azure reports its writes inside `prompt_tokens` is to be confirmed.
   - **The reservation** errs high today, because it counts all of the prompt as a write. A marked head reserves less, so if the host ignores the fields and still writes the whole prompt, the bill passes the reservation.

## The test, and how it fails first

- **CK-1.** Offline, with `fetch` stubbed, in the pattern of `test/openrouter-session-id.test.js` SID-1 (`:42`), with the switch on and two Luna judges in the lowest layer.
  - Each judge's call with the head and a live order carries the breakpoint on the head block, the mode field, and a key built from the run's id and the seat.
  - The two Luna judges get different keys.
  - An unselected OpenRouter seat's body gains no cache field.
  - Expected red today (not run): there is no switch and no such field.
- **CK-2.** `costOf('openrouter', 'openai/gpt-6.1-sol', usage)`, for a marked usage at the 5-minute lifetime with a read count above zero and a write count, equals the figure at Sol's row multiples, as M2 prices the projection.
  - Expected red today (not run): the settle reads at the table's 0.1, where the row's multiple is 0.05.
  - On Luna or Astra the same case would be green today, because their rows agree with the table.
- `test/cache-marks.test.js:317` becomes a changed accepted test, but only with the owner's yes to reverse the decision it pins. With the switch off, its three assertions still hold.

These run with the change:
- `test/cache-auto-write.test.js` (18 tests: the `auto` mode of the selected seats, plus M2's marked projection);
- `test/cache-marks.test.js`, `test/openrouter-session-id.test.js`, `test/run-single-stage-cache.test.js` and `test/claude-route-body.test.js`, which build OpenRouter request bodies;
- the derived-figure tests, if the dry run's figures move (`test/regen-derived-figures.test.js`, `test/pricing-table.test.js`, `test/plan-tiers.test.js:215`);
- the source scanners.

## The owner's gates

- **Prompt wording:** none. The fields are request fields, but the head must stay exactly the recorded cache order (`src/prompts/recorded-084-cache-order.js`).
- **Sentences a person or a session reads:** `CHANGELOG.md:88` and `:135` describe 0.8.4's behaviour, so the 0.8.5 change note says what changed. The two cache limits (`KNOWN-LIMITS.md:20-21`) are read again, and any sentence the change makes false is rewritten. All of it is A-DRAFT.
- **Money:** this is a money path (`src/cost.js`, `invoke()` in `src/chain.js`, the reservations), and the check is paid.
- **Hand-typed counts:** none. The dry-run figures are derived (`scripts/regen-derived-figures.mjs`) if the pricing of these seats moves.
- **A recorded decision is reversed:** a GPT seat's request carries no cache field (`test/cache-marks.test.js:317`).

## What the change must not touch

- The words of the cache order and of every prompt.
- The stage cache's fingerprint (`cacheFingerprint`, `src/cli.js:3875`). The key stays out of it, as the session id does: SID-1 shows finished stages still replay from disk.
- Calls of selected seats that carry no head, such as the proposers'. They keep today's `auto` counting unless question 3 says otherwise.
- `report.json`'s schema, except for additive fields.

## Questions only the owner can answer

1. Reverse the recorded decision that a GPT seat's request carries no cache field?
2. The paid check of step 2: a go, and a cap for each of its two runs (the baseline with the switch off, then the marked run), since `--max-usd` caps one run. The dry run prices each before the go.
3. A selected seat whose calls have no shared head, such as the Sol proposer: keep it as today, or send the mode that turns caching and its write charge off? That mode's behaviour is to be confirmed from the documentation.
4. If the check shows that the marked post reads nothing, or that the baseline's post reads the cache too: close the item without a change?
