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

## 2026-09-13: chains/ drift sync from relay - one real fix ported, one deliberately not

Diffed every chain config against relay's current state. Two real differences found, no
actual model-ID version bumps in either (every "different" model string was presence-vs-paused,
not an upgrade):

**Ported: `chains/gp-judge-v1.json` critic `maxTokens` 4000 -> 8000.** relay's own note (redacted
of an internal run-id and a private project path before porting - see the file's own
`_maxTokensNote`) explains why: 11 rubric criteria routinely need more than 4000 output tokens
for a full reply, and cheap critics (glm-5.3-flash especially) were hitting `stop:length`
mid-JSON and scoring as an unparseable abstention rather than a real verdict.

`council doctor` before/after for `gp-judge-v1` (unchanged either way):
```
gp-judge-v1  blocked  worst-case  $0.0424/run  (missing: anthropic, together, openrouter x3, google)
```
No visible difference, expected: `estimateChainRows` (`src/cost.js`) prices a critic stage from
the chain's own `estimate.critiqueTokens` (900 here), not from the seat's `maxTokens` ceiling -
`maxTokens` bounds a real call's output, it isn't an input to the worst-case estimate. The fix is
real (it prevents mid-reply truncation during an actual run) even though it doesn't move the
static price shown before spending anything.

`council doctor` for `verify` (untouched by this pass, shown as the second reference chain):
```
verify  blocked  worst-case  $1.27/run  (missing: anthropic (claude-opus-5), openai (gpt-5), google (gemini-2.5-pro))
```

**Not ported: relay's Gemini-seat pause across 18 chains.** relay disables the Gemini critic
seat on `_pausedCritics`/`_pauseNote`, quoting the project owner directly about his own AI
Studio account's prepayment-credit status. That's personal billing information about a named
individual, and this session's own publication-safety check blocked the raw copy attempt before
any sanitization was applied - taken as a real signal, not a false positive. It also doesn't
belong in a public template regardless: a public user's own Gemini key and credit status are
theirs, not the maintainer's, so the public chains keep the Gemini seat active as they already
were. Confirmed with cnc-harness-a7 before finalizing this decision.

`chains/plan-debate-c2-4lab.json` (relay-only) is a one-off scoped copy for a single run per its
own description, not a general-purpose chain - not added here. `seven-cheap.json`'s description
text differs too, but THCMCP's own copy ("six labs... cut down from seven") is already more
accurate than relay's stale "seven labs" text, so it was left as-is rather than reverted.

## 2026-09-13: verdict_stats ported from relay - no tests existed upstream, wrote them fresh

`src/verdict-stats.js` copied verbatim from relay (self-contained, documented as chain/lab
names/counts/cost/timing only, never task content or prompt bodies - already safe for a public
repo, unlike the chain-config pause note above). Wired in as a 14th MCP tool (`verdict_stats`)
and a `--stats [--days N]` CLI subcommand, mirroring `spend_report`/`--spend`'s existing pattern
exactly (same file, same disk-only derivation, same "nothing is recorded/transmitted" language).

relay itself has no test file for this module. Wrote `test/verdict-stats.test.js` fresh, matching
`test/spend.test.js`'s existing fixture conventions (real tmp `runs/` fixtures, not mocks) rather
than porting nothing and leaving the module untested in the one place it's actually exercised.
Notable behavior pinned: a `signedOff: null` entry is an abstention - not a sign-off, not an
objection, counted separately as `unparseable` - and must not silently read as either a pass or a
zero-objection result; a dropped-out lab is counted per lab and per chain even though it produced
nothing; a run with no `report.json` yet (paused/still going) is skipped for verdict scoring but
still contributes to prompt-size tracking. 9/9 new tests pass; full suite 103/103.

## 2026-09-13: v3 (0.3.0) re-curation - verdict on relay-9c's four logged deviations

Read relay's DECISIONS.md (stream-a and stream-b entries) before merging. All four agreed with,
landed as-is:

1. **§5 disputes entry shape** (`{ round, reason }`, only the `draft` variable stripped of the
   trailer - the raw stage record keeps the model's literal reply - and `BOARD.md` written on a
   dispute even with no debate). Sound: matches this project's existing convention that a raw
   stage record is "what the model actually said" and a derived field is the cleaned view;
   PLAN.md didn't specify `round` but its absence would have been the one unattributed record in
   `BOARD.md`, worth adding.
2. **§1 contested-claim mechanics** (`writeClaim` records a contest, first claim wins the record,
   a `contested_by` array holds the rest). Sound: keeps PLAN.md's exact `checkClaimStaleness`
   signature, needs no second file or in-memory history, and PLAN.md's own prose only specified
   the behavior, not the mechanism.
3. **Narrowing `submit_stage`'s existing "not waiting for X" guard** so an already-answered
   external stage falls through to `duplicate_answer` (warn, keep both files) instead of being
   rejected outright. **Agreed, with a condition.** This is a real behaviour change to an
   existing, shipped tool's contract for every caller, not only new peer-dispatch ones - a
   second `submit_stage` call for the same stage used to error, now it succeeds with a warning
   and an extra file. Landed anyway because: it's the narrowest possible scope (only the one case
   §1 needs - a stage that was never a pause point at all still hard-rejects, unchanged), it loses
   no data (strictly more informative than a bare rejection), and it matches PLAN.md's own
   explicit "all three checks warn, never reject" instruction, which the tool's pre-existing guard
   would otherwise have silently violated for exactly this one case. The condition: this is called
   out as its own paragraph in CHANGELOG.md's 0.3.0 entry, not folded silently into the feature
   list - a compatibility-relevant change earns visibility, even a disclosed and justified one.
4. **Skipping `buildStageContract` inside the new checks**, since `validateDeliverable` already
   derives the same required-sections data via `requiredSectionsFor`. Agreed: PLAN.md's prose
   named both functions, but the actual constraint it asks for - reuse existing data, no new
   validator - is satisfied either way; calling `buildStageContract` too would have been a
   redundant, unused call.

## 2026-09-13: v3 re-curation scope - only the five plan items, nothing else that happened to
   land on relay concurrently

relay's `main` picked up several unrelated things during this same session alongside the v3
merge: `verdict_stats`-adjacent fixes, a chain rename (`plan-debate-c2-7lab` → `-6lab`), three
previously-uncommitted-only features this session found and committed while chasing the v3 merge
(`dropouts` tracking, `signoff[].objections`, `mock-critic-holdout`, the `roles.js` "Available
tools" handoff instruction, and a prompt-injection-defense tag-wrapping feature for
critic/reviewer text). THCMCP's own `chain.js`/`roles.js`/`providers.js` already carried most of
these from an earlier sync, confirmed by diff before touching anything - only `mock-critic-holdout`
needed adding here to keep `test/signoff.test.js`'s own mock-provider fixture consistent with
relay's. The prompt-injection-defense feature (`<critic-claim>`/`<prior-review>` tags) is real,
already-committed-on-relay, security-relevant work but was not part of the five v3 plan items and
is not re-curated in this pass - it already exists in THCMCP's `src/roles.js` from an earlier
sync (confirmed via diff), so nothing was lost by leaving it out of this decision's scope.
