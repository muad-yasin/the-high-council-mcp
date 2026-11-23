# 216: the ban on xAI/Grok is lifted with 0.8.5; what refuses such a seat today, and what the lift changes

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 6eb41961 on the dev branch; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is there today

**The decision.** Since 23 September 2026 THC has refused to seat any xAI model, by the owner's rule, with no opt-out. On 23 November 2026 the owner decided to lift that ban with 0.8.5. The published 0.8.4 keeps refusing.

**The rule, as written:**
- `CLAUDE.md:43-46`, the rule itself, and `:340`, where it stands among the gates checked at a review;
- `AI-README.md:13` ("any lab except xAI") and `:323-325`;
- `CONTRIBUTING.md:16`.

**What enforces it.** One module, `src/denied-models.js`, and nine places that call it:
- **The ban is two patterns:** `DENIED_MODEL` (line 20), tested on a seat's provider and model, on a plugin's id and on every string under the routing keys of `extra`; and `DENIED_HOST` (line 62), tested on the host of a seat's `baseUrl`.
- **The lint rule `denied-model`** (`src/chain-lint.js:1234-1245`): a hard error for every seat the module returns, after the roster is resolved.
- **The run:** `assertNoDeniedModels` at the top of `runChain` (`src/chain.js:3277`) and `deniedReasonsOf` on every call in `invoke()` (`:2152`). The error class `DeniedModel` is control flow, so no catch turns it into an abstention.
- **The digest command** (`src/cli.js:1419-1422`, `src/dissent-digest.js:83-84`) and **the destination check after a reshuffle** (`src/rematch.js:74`).
- **The zero-retention table.** Its maker leaves every id on the ban's list out of the table (`src/zdr-table.js:24`), for the shipped table and for a person's refreshed list alike. `test/zero-retention-denied.test.js` pins that.

**What the same rule id also refuses, and why that matters here:**
- **A router id:** an id that names a router, such as `openrouter/auto`, a server-side preset, or any other id with one segment after `openrouter/` (`ROUTER_MODEL`, line 37). By the comment at lines 27-31, that namespace held routers, tools and models whose lab is not disclosed when OpenRouter's list was read on 30 September 2026. Every sentence about router ids gives the ban as its reason: a router "could route to a denied model".
- **A seat on an API provider with no model** (lines 92-95).
- **A `baseUrl` on a host that is no known provider's own** (line 82). Its printed reason is the ban too: "so the seat cannot be shown to avoid a denied model". The same line is what keeps a free, key-less seat off a public host that could bill outside the spend cap; lines 72-80 cover only a paid provider's own host. For a keyed seat, the lint's `key-host` rule (`src/providers.js:1155-1162`) says the same and more.

**Ten printed sentences name the ban or rest on it:** lines 70, 82, 103, 104, 108, 114, 115, 125, 126 and 160 of the module, plus the lint's `fix` text (`src/chain-lint.js:1243`) and the digest's refusal (`src/cli.js:1421`).

**The seven shipped chains.** Each description ends its roster sentence with "no Grok", beside "no Kimi" or "no Mistral", which are not banned. That is a statement about the chain's own roster.

**No xAI model can be called directly, and none has a table row.** There is no `xai` provider (`test/denied-models.test.js:111-118` pins it: no adapter, no alias, no price row, no example key). No xAI id stands in `src/pricing.json`, `src/reasoning-table.json`, `src/context-windows.json` or `src/zdr-hosts.json`.

## The smallest change

**The names stay.** The file, its exports (`deniedReasonsOf`, `deniedSeatsOf`, `DeniedModel`, `assertNoDeniedModels`), the rule id `denied-model`, and the stop record's kind `denied_model` (`src/cli.js:4976`) keep their names. Six modules import the exports. Of the test files, nine name the module's file (seven of them import it) and nine hold the rule id, thirteen in all. The record's kind is a value a reader may hold. The error's first line (line 160) and the digest's closing sentence (`src/cli.js:1421`) keep their words too: both say "denied model", as the names do, and two tests assert those words (`test/prerelease-batch2.test.js:69-81`, `test/denied-baseurl.test.js`). After the lift they name the seats THC still refuses to call.

**In `src/denied-models.js`:**
- `DENIED_MODEL` goes, with its branches at lines 103, 114 and 125 and its uses at lines 69 and 108.
- `DENIED_HOST` goes. An xAI host as a `baseUrl` is then judged like any other host by line 82, and stays refused, since THC has no xAI provider.
- Line 82 stays as a rule. Its printed reason needs its real grounds: where the seat's key may go (the reason of the lint's `key-host` rule, `src/providers.js:1155-1162`) and what the call costs, since a free seat is priced at $0 whatever its host (lines 72-73).
- The header: line 1 says what the module refuses after the lift, and the router sentence of lines 5-7 takes new words, as a dated line of 23 November 2026 (both in the table below). The other dated comments at the top stay as history.

**The router ids stay refused.** The owner decided that with the lift, on 23 November 2026. `ROUTER_MODEL` and its checks stay as they are. Only their words change. The five router sentences and the lint's `fix` text give the ban as their reason today. Their ground now is the one the owner picked: a seat must name its model. A router id does not say whose model answers: a router or a preset picks the model at request time, and an id with one segment after `openrouter/` carries no lab. The drafts below keep the word "router", which `test/denied-router-ids.test.js:18` asserts. Nothing changes for a person who names a router.

**Comments that give the ban as the reason for code that stays** are reworded by the build on the same ground: `src/denied-models.js:56-57` and `:60-61`, `src/chain-lint.js:1236`, `src/chain.js:3275-3276`, `test/denied-router-ids.test.js:1` and the title of the test at `test/denied-models.test.js:50`. The comment at line 19 goes with `DENIED_MODEL`. Dated comments that record why a check was added stay as history: lines 27-31 of the module, `src/providers.js:1155-1157` and `test/key-host.test.js:1-3`, like the earlier entries of `CHANGELOG.md`.

**The zero-retention table (question 1).** If the ban's list simply empties, the table maker stops dropping xAI ids, and the next refresh of `src/zdr-hosts.json` writes rows for them. To add no row, the maker keeps a pattern of its own for the ids it leaves out. Then a person who switches zero retention on and seats an xAI model is stopped at the start as "not listed", and that reason is worded as "OpenRouter's list has no endpoint for it" (`src/zero-retention.js:9`), which can be untrue for such a model.

**The rule sentences:** `CLAUDE.md:43-46` and `:340`, `AI-README.md:13` and `:323-325`, `CONTRIBUTING.md:16`. What stays in them: the refusal of router ids, with its own ground, and "There is no `xai` provider".

**The seven chain files do not change.** Their "no Grok" stays true, so no chain's content hash moves.

**What a person gets after the lift,** for a seat `{ "provider": "openrouter", "model": "x-ai/<a model>" }` in a chain of their own (read, not run):
- the lint's `denied-model` rule says nothing;
- under a spend cap the start refuses the seat as unpriced, before anything is sent, until the person adds a row for it to their own `pricing.user.json`;
- with no row in the reasoning table the harness adds no reasoning field, so the seat reasons at the model's own default unless the chain sets one. `reasoning-not-high` checks shipped chains only;
- with zero retention on, see above.

**Not checked:** what a run does for a model with no row in `src/context-windows.json`; whether the lint's `missing-tool-reference` finding stops a run or only reports; and the start's refusal of an unpriced seat, which this note takes from the comment at `src/chain.js:1479-1480` and did not follow into `src/unpriced.js`.

## The test, and how it fails first

An accepted test whose assertion turns round is named as reversed in its commit. Each has one red run: with its assertion turned, it fails on the code as it is today.

- **Reversed:** `test/denied-models.test.js:31` (an OpenRouter seat with an x-ai id gets no `denied-model` finding; the rows with `provider: 'xai'` leave it: such a seat is then named by another lint rule, `missing-tool-reference`, as an unrecognized provider, `src/chain-lint.js:167-187`) and `test/shipped-chains-no-kimi.test.js:67-69` (title and assertion).
- **A new trigger, same guard.** These test something that stays, and only their example id was an xAI one: `test/denied-models.test.js:91` (found after the roster is resolved) and `:96` (refused before any stage, never downgraded), `test/conflict-decider.test.js:168`, `test/tiered.test.js:271`, `test/rematch-whole-seat.test.js:94`, `test/prerelease-batch2.test.js:69-81` (the digest), and five of the six shapes in `test/denied-extra-routing.test.js:53`, all but `{ model: 'openrouter/auto' }`, which keeps its trigger. The new trigger is a router id.
- **Unchanged:** `test/denied-router-ids.test.js`, since it asserts the word "router" and no sentence about the ban; only its first comment line gives the old ground. `test/denied-baseurl.test.js` stays green as long as the error's first line keeps the word "denied", which it asserts at run time; its two xAI hosts are then refused by line 82, as hosts no known provider runs. `test/key-host.test.js:107` stays green for the same reason; its message, "a denied lab's host stays refused", names the ban, and the build rewords it. `test/denied-models.test.js:111-118` stays on purpose: it pins that there is still no xAI provider and no row.
- **`test/zero-retention-denied.test.js`:** unchanged but for its import if the table keeps its own pattern; reversed if the filter goes.
- **Not touched,** although they name the lab: `test/caps-contract.test.js`, `test/caps-records.test.js` and `test/argued.test.js` use the name as an example of an unknown provider or lab; `test/plugin-user-config.test.js:36`, `test/china-chains.test.js:35` and `test/plan-china-high-council.test.js:68` assert facts that stay true. `test/tree-member-stops.test.js`, `test/tree-start-prechecks.test.js`, `test/start-scope-no-model.test.js` and `test/verdict-envelope.test.js` name the rule or the module in a comment only (lines 5, 31, 1 and 198), and none of them seats an xAI id.

**The probe, offline:** a scratch chain that names an x-ai id, through `chain-lint` (a `denied-model` finding today, none after the change) and through a dry run (the seat shows as unpriced). No call to any model.

## The owner's gates

- **The rule is the owner's.** The new sentence of `CLAUDE.md:43-46` needs his yes before the commit that carries it. So does every other rule sentence above.
- **Sentences a person reads:** the reworded reasons in the module, its two header lines and the lint's `fix` text are A-DRAFT until the owner's yes. The drafts are in the table below.
- **Money:** no price, cap or record changes.
- **Paid runs:** none. The probe is offline.
- **Hand-typed counts:** none moves. No chain, provider, tool or skill is added or removed.
- **Reasoning:** nothing lowers a seat's effort.

## The sentences, as A-DRAFT

None is approved. Each row gives the words as they are at 6eb41961 and a draft.

| Where | Today | A-DRAFT |
|---|---|---|
| `CLAUDE.md:43-46` | "**No xAI/Grok, ever** (owner, 2026-09-23). Not in any chain, roster, example or default, and not through a router id that could pick it (`openrouter/auto` and the like). Enforced by chain-lint's `denied-model` rule and a run-time check, with no opt-out (`test/denied-models.test.js`, `test/denied-router-ids.test.js`); never add one." | "**No router ids** (owner, 2026-09-23, kept on 2026-11-23). A seat must name its model. A router id does not say whose model answers, so it is refused: an id that a router or a preset resolves at request time (`openrouter/auto` and the like), and any other `openrouter/<name>` id, which carries no lab. Enforced by chain-lint's `denied-model` rule and a run-time check, with no opt-out (`test/denied-router-ids.test.js`); never add one. The ban on xAI/Grok that stood here was lifted by the owner with 0.8.5 (2026-11-23): a person may seat an xAI model in a chain of their own." |
| `CLAUDE.md:340` | "no Grok" in the list of gates | "no router ids" |
| `AI-README.md:13` | "(any lab except xAI)" | "(any lab)" |
| `AI-README.md:323-325` | "xAI/Grok is never seated, and neither is a router id (`openrouter/auto`, the Pareto Code router, any other `openrouter/<name>` id) that could route to it: chain-lint refuses such a chain and the run itself refuses such a seat, with no override. There is no `xai` provider." | "A seat names its model. A router id (`openrouter/auto`, the Pareto Code router, a preset, any other `openrouter/<name>` id) does not say whose model answers: a router or a preset picks the model at request time, and an `openrouter/<name>` id carries no lab. chain-lint refuses such a chain and the run itself refuses such a seat, with no override. There is no `xai` provider. An xAI model can be seated through OpenRouter in a chain of your own; it has no price row, so under a spending limit the run refuses the seat until your own `pricing.user.json` holds one." |
| `CONTRIBUTING.md:16` | "(no Grok, reasoning never lowered, prompt wording only in `src/roles.js`)" | "(no router ids, reasoning never lowered, prompt wording only in `src/roles.js`)" |
| `src/denied-models.js:104`, `:115`, `:126` | "[...] is a router id that could route to a denied model" | "[...] is a router id: it does not say whose model answers" |
| `src/denied-models.js:108` | "extra.plugins id \"[id]\" is a router that could route to a denied model" | "extra.plugins id \"[id]\" is a router: it does not say whose model answers" |
| `src/denied-models.js:70` | "baseUrl host \"[host]\" is a denied lab or a router (no xAI/Grok; no override)" | "baseUrl host \"[host]\" is a router (no override)" |
| `src/denied-models.js:82` | "[...] is not a known provider's API host [...], so the seat cannot be shown to avoid a denied model" | "[...] is not a known provider's API host [...], so where the seat's key goes and what the call costs cannot be checked" |
| `src/denied-models.js:1` | "Models this harness will never seat - a standing owner decision, not a quality judgement." | "Seats this harness refuses to call. None of the refusals is a judgement of a model's quality." |
| `src/denied-models.js:5-7`, the router sentence (the dated lines before it stay) | "A router id is denied too: a seat whose model is chosen at request time (openrouter/auto, the Pareto Code router, any *-router plugin) can route to a denied model without the chain ever naming one, so it cannot be shown to comply." | "2026-11-23: the owner lifted the ban on xAI/Grok with 0.8.5, so a person may seat an xAI model in a chain of their own. Router ids stay refused, on the ground the owner picked, that a seat must name its model: a router id does not say whose model answers. A router or a preset picks the model at request time (openrouter/auto, the Pareto Code router, any *-router plugin, @preset/<name>), and an id with one segment after openrouter/ carries no lab." |
| `src/chain-lint.js:1243` | "Remove that seat from [file]. xAI/Grok is never seated, and a router id cannot prove it avoids it. There is no override." | "Name the seat's model in [file], on a known provider's host, or remove the seat. There is no override." |

## What the change must not touch

- **No xAI provider, and no row** for an xAI model in the price, reasoning, context-window or zero-retention tables, unless the owner answers question 1 that way.
- **The refusal of router ids,** and `test/denied-router-ids.test.js`.
- **No shipped chain, example or default** seats an xAI model.
- **Line 82 as a rule.** It is the spend cap's guard for a free seat. Only its printed reason changes.
- **The lint's `key-host` rule,** and the adapters' order of `extra` (`test/denied-extra-routing.test.js`, its first two tests).
- **The names and the record's kind** listed above.
- **`src/answered-by.js:84`** (the lab of a reply's model id) and **`src/secret-patterns.js:43`** (the shape of an xAI key, which the outbound scan must keep catching).
- **`chains/outdated/`, `archive/`, and the earlier entries of `CHANGELOG.md`.**

## Questions only the owner can answer

1. **Zero retention and an xAI seat:** rows for xAI models in the table at its next refresh, or a stop whose reason says that this table leaves the model out? Today's wording would give a reason that can be untrue.
2. **The shipped chains:** should a test keep xAI models out of the chains this package ships, as `test/shipped-chains-no-kimi.test.js` does for Kimi? Two of the seven chains have such a check of their own; for the other five none was found.
