# Decisions

Records project decisions that aren't obvious from the code or commit messages.

## 2026-09-13: docs/demo.html added to answer the GP "interactive, not static" criterion

gp-6f's Golden Path judging pass flagged the Pages site as a static walkthrough with no
interactive element. Fix: `docs/demo.html`, a click-through reconstruction of a council run
(proposals, blind debate, keep/amend/withdraw replies, sign-off), built entirely with
`<details>`/`<summary>` - no `<script>`, no network calls, consistent with `docs/`'s existing
script-free rule (`test/landing-page.test.js`).

The data is hand-authored to match `report.json`'s real shape and explicitly banner-labelled
"SIMULATED DEMO · NOT A REAL RUN," not sourced from an actual run. This repo's own CLAUDE.md
forbids moving harness run output into the repo, since run folders can carry the author's
business and personal plans; a real `report.json` shipped as a public site asset would be
exactly that, unreviewed. `docs/board.html` already exists as the real-run counterpart (drawn
from an actual `report.json`, published as prose rather than a raw file) and the demo links to
it both ways so neither is mistaken for the other.

Deploy note: the push-triggered Pages workflow for f238a05 failed with "Failed to get ID
Token, request timeout" (transient GitHub OIDC issue; permissions were correct). Rerunning
that same failed run then failed with "Multiple artifacts named github-pages," because a
rerun re-uploads the artifact into the same run. A fresh `workflow_dispatch` run succeeded
and the demo went live. Lesson: on a Pages OIDC failure, dispatch a new run rather than
rerunning the failed one.

## 2026-09-13: v2 (0.2.0) re-curation from ~/Projects/relay - scope and one real regression caught

Brought over the v2 build's own files only (see CHANGELOG.md 0.2.0): six new `src/` modules,
updated `cli.js`/`mcp/server.js`/`spend.js`, matching tests, `docs/dispatch-pattern.md`, README
and landing-page updates. Deliberately did **not** bring over:

- `src/verdict-stats.js` and its `verdict_stats` MCP tool / `--stats` CLI subcommand. These exist
  in relay but predate this v2 build and are not one of its nine numbered items - bringing them
  over would have been unreviewed scope creep under a v2 commit. Stripped from the copied
  `cli.js`/`mcp/server.js` before committing.
- Any `chains/*.json` drift between the two repos (real-model version bumps, maxToken fixes from
  unrelated work in relay). Out of scope for this build; someone else's re-curation to do.
- relay's own `docs/`, `README.md` wholesale - relay's README is an internal 151-line doc, this
  repo's is a public ~350-line document with its own voice; copied only the specific sections
  (tool table row, external-vs-API note, `--cost-today` mention) by hand instead of overwriting.

**Regression caught before commit:** copying relay's `cli.js`/`mcp/server.js` wholesale as a
starting point briefly reintroduced `const work = pkg` (relay-only: its MCP server always runs
from the repo itself) over this repo's own `const work = process.cwd()` (required for `npx`
installs - resolving a task path against `pkg` would send an installed user looking inside
`node_modules` for their own file, the exact bug a prior fix here corrected). Caught by diffing
against `git show HEAD:src/cli.js` / `src/mcp/server.js` before committing; restored both.

MCP tool count: 12 (this repo's actual pre-v2 count, not the "eleven" some prose elsewhere says -
see the landing-page test's own incident note) plus `prepare_stage_prompt` = 13. `docs/index.html`
and `README.md` updated to match; `test/landing-page.test.js` derives and checks this count so it
cannot drift silently again.
