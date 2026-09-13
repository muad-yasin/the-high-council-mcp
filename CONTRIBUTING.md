# Contributing

This project has one maintainer. The bottleneck is reviewing pull requests, not writing code -
an unscoped PR costs more of that time than it saves. The three shapes below are pre-scoped and
easy to land; a PR outside them is welcome but will take longer to review, since it needs a scope
discussion first.

## The three smallest landable contributions

1. **A new provider adapter** (`src/providers.js`). Every provider except `mock`/`external` speaks
   either the Anthropic Messages API or the OpenAI chat-completions shape via `OPENAI_COMPAT`.
   Adding a new OpenAI-compatible provider is usually one entry in `OPENAI_COMPAT` plus a pricing
   row in `src/pricing.json`. Test it the way the existing providers are tested: no network calls
   in `node --test`, real calls are opt-in and cost real money.

2. **A new chain config** (`chains/*.json`). A chain is data, not code - it names which seats run
   which stages. `council doctor` validates any chain you add against every shipped-provider's key
   presence and prices it worst-case with zero network calls; run that against your new file
   before opening a PR. Look at `chains/plan-debate.json` or `chains/verify.json` as a starting
   shape depending on whether you want a debate-and-panel chain or a single-critic chain.

3. **A new mock fixture** (`src/providers.js`'s `callMock`, exercised from `test/*.test.js`). If
   you're adding test coverage for a new code path in the chain itself, the offline `mock`
   provider needs a new scripted branch (keyed on a `mock-<something>` model name) rather than a
   real API call. See the existing branches in `callMock` - `mock-unreadable`,
   `mock-provider-error` - for the shape: a model name that triggers one deterministic scripted
   reply, documented with which real-world failure it stands in for.

## Everything else

Bug fixes, docs fixes, and typo fixes are always welcome with no scoping step. Anything larger -
a new CLI command, a new stage, a change to what a chain's JSON schema can express - should start
as an issue describing what it's for, before the PR, so review time isn't spent re-deriving scope
from a diff.

## Running the tests

    npm test

Offline, no API key, no network call, no cost. `node --test` matches the project's own test
runner - no additional test framework to install.
