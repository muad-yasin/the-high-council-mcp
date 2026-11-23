# The chains move to GPT-6.2 Sol and GPT-6.2 Astra (built on dev)

A-DRAFT: every sentence of this note waits for the owner's yes.

This is the record of a change built on `dev`, not a prepared note. It was made on top of `dev` at `6eb41961`, and its line numbers are that tree's with the change.

## What changed

**The seats.** Three shipped chains seat the two 6.2 models in place of the two older OpenAI models. The seats, their caps (128,000) and their reasoning (high) stay the same:
- `plan-medium-council`: `openai/gpt-6.2-sol` at layer 3, in place of `openai/gpt-6.1-sol`;
- `plan-high-council` and `plan-the-high-council`:
  - `openai/gpt-6.2-sol` as the third proposer and at layer 2, in place of `openai/gpt-6.1-sol`;
  - `openai/gpt-6.2-astra` at layer 3, in place of `openai/gpt-6-astra`.

The seats' lab tags follow the model: `gpt6.2-sol` and `gpt6.2-astra`, which were `gpt6.1-sol` and `gpt6-astra`. Every other seat is unchanged, GPT-6 Luna included. Every OpenRouter seat keeps its ban on the Open Inference host.

**The tables.** Three tables gain the two models' entries, and nothing else; their old rows stay as they were. The zero-retention table is written whole.
- **`src/pricing.json`:** one row per model, written by `scripts/refresh-openrouter-prices.mjs` from OpenRouter's lists as read on 2026-11-23:
  - GPT-6.2 Astra is 8 / 40 dollars per million tokens, and 16 / 60 from 272,000 prompt tokens;
  - GPT-6.2 Sol is 2 / 10, and 4 / 15 from 272,000 prompt tokens;
  - each row has its cache prices and its host picture;
  - neither row has a measured review size (`critiqueTokens`) yet.
- **`src/reasoning-table.json`:** one row per model. Each offers every effort up to max, the chains set high, and the largest reply is 128,000.
- **`src/context-windows.json`:** one entry per model, 1,050,000.
- **`src/zdr-hosts.json`:** written whole by `scripts/refresh-zdr-table.mjs` from OpenRouter's zero-retention list of 2026-11-23 (358 models). Each 6.2 model has one entry, `azure`, at the row's price. The section below says what else moves with it.

**Not taken in.** The same reads showed other price rows moving. This change does not take them in: that is a refresh of its own.

**What the scripts regenerated.** These derived figures come from `scripts/regen-derived-figures.mjs` and `scripts/chain-overview.mjs`, run on this tree:
- the dry-run figures in the descriptions of `plan-medium-council` and `plan-high-council`;
- the README's Pricing table and its chain overview;
- the AI-README's rows;
- the review-notes bounds in `KNOWN-LIMITS.md`;
- `maintainers/MODEL-CAPS.md`.

**By hand:**
- the model names in the three descriptions;
- the version labels, A-DRAFT: "(0.8.4)" becomes "(0.8.5)" in the titles of the medium and the high chain, in "on a new roster" of `plan-the-high-council`, and in "Dry run (0.8.5, prices of 2026-11-11, ...)";
- the date in "prices of" follows the price table's stamp, which this change does not move;
- `KNOWN-LIMITS.md`: the zero-retention list's red day (below);
- note 209 (`small-items/209-gpt-seat-cache.md`), where its sentences about the shipped seats and their rows changed: the seats it names, the cache multiples of the two GPT-6.2 rows (read 0.05, write 1.25, like Sol's), and its test CK-2, which now prices the seated Sol. Its design and its questions are unchanged.

## The zero-retention table, written whole

**Why whole.** The table is one list of one day: a model it does not name has no zero-retention host on that day. A start with zero retention on prints that day as the source of each call's hosts. Two entries of 2026-11-23 under a date of 2026-11-10 would make that sentence false for the 6.2 seats on every such start of the three chains.

**What it changes.** With the setting on, no shipped chain's start result changes, on either route of the Claude seats. With the setting off nothing changes, and no figure moves. Of the 18 models the shipped chains send through OpenRouter, 11 get other hosts (the seats' own ignore lists still apply):
- GPT-6 Luna and GPT-6.1 Terra: `azure` only, where the table also named `azure/eu` and `azure/us`;
- Claude Haiku 5.5, Claude Opus 5.5 and Claude Sonnet 5.5, on the route through OpenRouter: `amazon-bedrock` only, where the table also named `amazon-bedrock/eu-west-1` and `amazon-bedrock/us-east-1`;
- DeepSeek V4.1 Flash, 43 hosts before and 42 now: `decart/fp8`, `ionstream/flex`, `nebius/fp8`, `novita/fp8`, `phala` and `siliconflow/fp8` leave; `inceptron/fp4`, `morph/fast`, `nebius/fp4`, `pearl-research/fp8` and `tenstorrent/fp8` join;
- MiniMax M3.1 Flash, 10 before and 12 now: `novita/fp16` leaves; `inferact-vllm/nvfp4`, `makora/fp4` and `wafer/nvfp4` join;
- Kimi K3.1 Pro, 23 before and 24 now: `moonshotai/highspeed`, `moonshotai/mxfp4`, `phala` and `phala/us` leave; `amazon-bedrock/us-east-1`, `amazon-bedrock/us-east-2`, `decart/mxfp4`, `makora` and `river` join;
- Qwen 3.8 27B, 20 before and 18 now: `deepinfra/bf16`, `novita`, `phala` and `wafer/fp8` leave; `deepinfra/fp8` and `pearl-research/fp8` join;
- GLM-5.3, 40 before and 40 now: `novita/fp8`, `parasail/fp8`, `phala`, `primeintellect`, `reka`, `siliconflow/fp8` and `z-ai/fp8` leave; `cohere/nvfp4`, `deepinfra/fp4/flex`, `doubleword/nvfp4`, `featherless`, `modelrun/fp4`, `parasail/fp4` and `sambanova` join;
- GLM-5.3 Flash, 35 before and 32 now: `baseten/fp8/us`, `nextbit/fp4`, `novita/fp8`, `parasail/fp4`, `phala/nvfp4`, `primeintellect`, `siliconflow/fp8` and `z-ai/fp8` leave; `dekallm`, `fireworks/us`, `parasail/fp8`, `particle-ai/nvfp4/flex` and `river` join.

**Its red day.** The suite's test of the table's age now turns red on 2027-01-08 (read date + 45 + 1), not 2026-12-26. `KNOWN-LIMITS.md` names the new day in its list of red days, and the test that pins that list changed with it.

## The dates of the four tables

- **The price rows** carry their own dates: each new row's host picture is dated 2026-11-23, and that is the first date in its `_source`. The table's own stamp is the oldest check date, so it stays.
- **The zero-retention table** is dated 2026-11-23, the day of the list it was written from.
- **The reasoning table** (2026-10-23) and **the context windows** (2026-11-09) keep their dates. No reader prints their date for these rows, and their age tests turn red early, never late.

## The figures, before and after

The dry run's figures at the table's prices, expected / upper estimate:

| Chain | Before | After |
| --- | --- | --- |
| `plan-medium-council` | $14.78 / $631.91 | $14.64 / $628.41 |
| `plan-high-council` | $31.56 / $1749.87 | $29.76 / $1697.38 |
| `plan-the-high-council` | $31.71 / $1751.03 | $29.90 / $1698.46 |

The cheapest end moves from $8.83 to $8.79 (medium) and from $17.34 to $16.53 (high). The comparisons with the default cap of $12 do not change. The four other shipped chains' figures do not move.

Why they move:
- **The price.** GPT-6.2 Astra's row is 8 / 40, where GPT-6 Astra's is 10 / 50. GPT-6.2 Sol's row is 2 / 10, where GPT-6.1 Sol's row is 2.2 / 11: that row is held at its dearest zero-retention endpoint of its read day, as its `_source` says, and it is not refreshed here.
- **Not the review size.** The two high chains set 5,000 tokens for a review. GPT-6 Astra's measured 3,500 never raised that (`src/cost.js:333-337`), so GPT-6.2 Astra's missing measurement changes no figure.

## What a paused run or a tree does after the change (read, not run)

- **A paused run.** A stage's fingerprint covers the whole chain file apart from a few keys (`src/cache-integrity.js:19`), and a resume reads the chain file as it is now (`src/cli.js:2691`).
  - So on resume, every finished stage of a run of these three chains that paused before the change reads as stale. It is set aside and asked again, a paid call where the seat is paid. A paid chain shows the limit screen first.
  - Any edit of a chain file does this.
- **The renamed tags.** With the renamed lab tags, the two seats' stages also get new labels, so their old stage files are never asked for again. Their spend stays in the report and in `council --spend`, but it is not counted against the resumed run's limit (`KNOWN-LIMITS.md:42`).
- **A tree.** A tree started on the old files cannot continue, because it pins each chain file by its hash (`src/tree-continuation.js:4`).

## With zero retention on

Each 6.2 seat has one zero-retention host, `azure`, priced exactly at the seat's price limit, so the start check passes (`src/zero-retention.js:66-90`).
- **Sol:** before this change, GPT-6.1 Sol's seats had three hosts under their price limit (`azure`, `azure/eu`, `azure/us`). GPT-6.2 Sol's have one.
- **Astra:** GPT-6 Astra's seat had one host under its limit (`azure`; `azure/us` was priced above it), and GPT-6.2 Astra's has one too.

## What was run

- **Two public reads of OpenRouter** (no key), on 2026-11-23, saved outside the repository: the models' endpoint lists and the zero-retention list.
- **Each table's own script,** from the saved reads. The price, reasoning and context tables were written once and then restored to `dev`'s text, except for the two models' entries. The zero-retention table stands as its script writes it from the saved list, and its `--check` against that list exits 0.
- **The two figure scripts above,** and the `--check` of each figure script. All exit 0 on this tree.
- **Evaluations of pure functions of `src/`** on the chain files: the dry-run figures, and the zero-retention start check on every shipped chain, on both routes of the Claude seats, with the old table and the new one.
- **Five test files** pinned what changed, and each was run once where it fails: the four that pin the models, before their edits (9 tests); and `test/known-limits.test.js` with its new pin, before `KNOWN-LIMITS.md` changed (1 test). Each changed test carries a note beside the change. The unit's tests run once on the final tree before the commit.
- **No call to a 6.2 model.** This roster has not run, and none of its seats has been measured.

## Open for the owner

- **`KNOWN-LIMITS.md` keeps its line on GPT-6 Astra** ("reachable only through OpenRouter"). Whether GPT-6.2 Astra needs such a line is not checked.
- **The version labels** (A-DRAFT, above).
