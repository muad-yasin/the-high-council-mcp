# Contributing

This project has one maintainer. The bottleneck is reviewing pull requests, not writing code -
an unscoped PR costs more of that time than it saves. The four shapes below are pre-scoped and
easy to land; a PR outside them is welcome but will take longer to review, since it needs a scope
discussion first.

## The four smallest landable contributions

1. **A new provider adapter** (`src/providers.js`). Every provider except `mock`/`external` speaks
   either the Anthropic Messages API or the OpenAI chat-completions shape via `OPENAI_COMPAT`.
   Adding a new OpenAI-compatible provider is usually one entry in `OPENAI_COMPAT` plus a pricing
   row in `src/pricing.json`. Test it the way the existing providers are tested: no network calls
   in `node --test`, real calls are opt-in and cost real money.

2. **A new chain config** (`chains/*.json`). A chain is data, not code - it names which seats run
   which stages. `council doctor --chain chains/<yours>.json` lints it (the same rules every run
   applies, including the denied-model and `key-host` rules), and `council doctor` prices it
   worst-case, both with zero network calls; run both against your new file before opening a PR. Look at `chains/cheap-7-v2.json` or `chains/verify.json` as a starting
   shape depending on whether you want a debate-and-panel chain or a single-critic chain.

3. **A new mock fixture** (`src/providers.js`'s `callMock`, exercised from `test/*.test.js`). If
   you're adding test coverage for a new code path in the chain itself, the offline `mock`
   provider needs a new scripted branch (keyed on a `mock-<something>` model name) rather than a
   real API call. See the existing branches in `callMock` - `mock-unreadable`,
   `mock-provider-error` - for the shape: a model name that triggers one deterministic scripted
   reply, documented with which real-world failure it stands in for.

4. **A change to a skill** (`skills/<name>/SKILL.md`). The bar is in [`skills/README.md`](skills/README.md):
   a good proposal names the failure it prevents, where that failure was seen, and what the rule
   should say. Skills are generic and public, so a change also passes the same leftover-content
   check every skill shipped through: no project names, internal paths, private model or session
   names, or third-party text copied in.

## Before you open a PR

These checks run in `npm test`, so they will fail a PR rather than surprise it in review:

- **No xAI/Grok seat in any chain.** Chain lint's `denied-model` rule refuses it, with no override.
- **A shipped chain's seats reason at high.** Chain lint's `reasoning-not-high` rule refuses a
  setting that lowers a seat's reasoning effort.
- **Prompt wording lives in `src/roles.js` only.** Changing it fails `test/prompt-pin.test.js` on
  purpose; say in the PR what the prompt now tells the model and why, and the maintainer re-records
  the pin.
- **Documents that list what the repo holds are checked against it.** `skills/README.md`,
  `docs/skills.html` and the landing page (`docs/index.html`) are compared with the repo by tests;
  a failing one names the document to update.
- **Run output is never committed.** `runs/` is gitignored; keep it that way.

Two stances, where a PR is closed rather than scoped: bring-your-own-key only (no default key,
proxy or hosted path), and no claim about output quality until something has been measured.

## Everything else

Bug fixes, docs fixes, and typo fixes are always welcome with no scoping step. Anything larger -
a new CLI command, a new stage, a change to what a chain's JSON schema can express - should start
as an issue describing what it's for, before the PR, so review time isn't spent re-deriving scope
from a diff.

## Running the tests

    npm test                                                  # the whole suite
    node --test test/chain.test.js                            # one file
    node --test --test-name-pattern 'parseJson: raw newline'  # one test

Offline, no API key, no network call, no cost. The whole suite is over 2,000 tests and takes
several minutes; run the files you touched first. `node --test` matches the project's own test
runner - no additional test framework to install.
