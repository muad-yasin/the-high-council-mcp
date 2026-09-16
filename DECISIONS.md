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

## 2026-09-13: reliability-error-handling - left as-is, model-disagreement noise not a real gap

GP's rubric-v2 re-judge scored this 2 MET / 1 PARTIAL / 1 FAILED. Per gp-6f's breakdown: the
MET labs (deepseek, glm) correctly quoted README text already describing the spend-cap's
clean-stop behavior (STOPPED-budget.md, no half-written deliverable). The PARTIAL (qwen) found
different, also-real README text but marked partial because the live demo page is a static
simulation and can't dynamically exhibit runtime error handling - a structural property of a
static demo page, not a defect to fix. The FAILED (mistral) claimed no evidence exists at all,
which is simply wrong - the same evidence the other three labs read was in its own dossier.
Not chasing a unanimous MET here: there's no real code gap (error handling already exists and
is already documented) and no real evidence gap (2 of 4 labs found the evidence fine) - this is
one lab missing real text plus one lab wanting a static page to do something only a live process
can do. Left as scored.

## 2026-09-13: v6 phase 4 harness - mock-seat model, lens routing, and why persona ties by design

**Context:** §5 asks for four arms (plain, lens-only, persona-only, lens+persona) run against
v5's five fixtures/25 defect instances, "template-driven, not live model calls," where "a
lens-aware mock checks its assigned defect category first." The plan names the five lenses
(adversary, integrator, long-horizon, user-advocate, security-and-legal) but leaves the
lens->defect-type mapping and the exact mock-seat mechanics to the builder.

**Decision:** each lens is the pre-registered specialist for exactly one of the five defect types
(role-experiment.js's `LENS_TO_DEFECT_TYPE`, chosen and committed before any run, with a one-line
stated reason per pairing - e.g. "security-and-legal" -> `unresolved_objection`). A lens-bearing
seat's specialist vote reuses the existing detector's 'strict' tier for its assigned type; every
seat also has a generic 'loose'-tier read available for every type. `caught = specialist OR
generic`; `unanimous = specialist === generic`. Persona is modeled as having **zero** effect on
either value - Arm C (persona-only) is mechanically identical to Arm A, and Arm D (lens+persona)
identical to Arm B, verified by an equality assertion in the test suite, not just asserted in a
comment.

**Why:** the plan's own rationale for this section is "the experiment tests whether role-
conditioning changes *where a detector looks* (routing), not whether a model gets smarter." A
persona is a name and a voice; it carries no checklist of what to look for, and inventing one
would silently build a claim ("persona alone makes the mock notice more") the landed design
(§3/§6) never makes about personas. Making C=A and D=B by construction is the honest expression of
that: if this offline model gave persona a detection effect, it would be fabricating the exact
kind of result the LIMIT statement explicitly disclaims this harness can speak to. Reusing
'strict' as the specialist tier and 'loose' as the generic tier (rather than inventing a fourth
sensitivity level) keeps every number traceable to the same three detector functions the v5 probe
already ships and has already been reviewed - no new heuristic logic, only new routing over
existing ones.

**Threshold set before any run, and the negative-control proof:** POSITIVE/NEGATIVE/INCONCLUSIVE
(§5's own text) is implemented once in `decide()`, called by both the real 5-fixture run and a
direct unit test with synthetic per-arm data proving all three verdicts are reachable. The
"prove it can say NEGATIVE" requirement is satisfied two ways: (1) a hand-built negative-control
fixture whose decoy text shares zero significant words with its own constraint phrase (closing
the one real gap - case-1-plan-shop's dropped_constraint decoy happens to share two words with
its constraint, which is the only place a lens ever gains an edge over plain in the real
fixtures) - run alone, it ties on all 5 defect types and yields NEGATIVE with `winFixtureCount`
literally 0 for every role-bearing arm, not just "below the 3-fixture bar by fixture-count
starvation"; (2) the real, unmodified 5-fixture run itself already reads NEGATIVE today under
this model (regression-anchored in a test, not asserted from memory) - arm B/D's specialist vote
(always 'strict', which the real detectors already mark true on nearly every planted defect) only
out-catches arm A on one fixture out of five, short of the >=3 bar.

**Error visibility:** every cell is wrapped individually; a throw is recorded with `status:
'error'` in `rows` (never dropped from the array) and duplicated into a top-level `errors` array,
and every rate (`catchRate`, `unanimityRate`) is computed only over `status: 'ok'` rows, returning
`null` rather than a misleading `0` when nothing could be scored. Tested directly against a
fixture missing its `defects` object entirely (every cell throws), matching the shape of tonight's
real incident (a chain reporting `passed:true` while a lab's unparseable reply was silently
dropped from the mean) as the thing this harness must not reproduce.

## 2026-09-13: v6 phase 4 harness - bug-audit fix: a fixture-level win comparison must exclude
   any defect type either arm failed to score, not silently treat an error as "arm A missed it"

**Found by:** `sower-review:bug-audit` pass over the phase 4 harness diff, before this commit.

**The bug:** `decide()`'s fixture-level win comparison originally counted each arm's caught-type
total independently, filtering each side to its own `status: 'ok'` rows. If Arm A errored on a
cell while a role-bearing arm scored that same cell cleanly, Arm A's own total was silently
deflated (the errored type was simply absent, not counted as "attempted and missed") - which
could make the role arm look like it beat Arm A on a fixture it was never actually compared
against for that type. This does not fire on the five checked-in fixtures (none error), so it was
latent, not observed - exactly the kind of asymmetry a review pass exists to catch before a
future fixture change makes it real.

**Fix:** `compareCaughtTypes()` now walks the fixed five defect types per fixture and counts a
type toward either side's total only when BOTH arms have a scoreable ('ok') cell for it; a type
where either side errored is excluded from that fixture's comparison entirely, contributing to
neither a win nor a loss. Regression test added (`decide(): a fixture where arm A errors on one
defect type must not count as a "win" for a role arm that scores it`) using hand-built rows, not
dependent on ever engineering a real fixture that triggers this path.

**Also reviewed and left as-is, per the same bug-audit pass:** `decide()`'s `for (const arm of
['B','C','D'])` loop only ever reports the first satisfying arm as `cleanWinner`/`mixedWinner`.
Because Arm C is defined identical to A (never wins) and Arm D identical to B, only B can ever
actually win today - a latent trap only if that C=A/D=B invariant is ever broken by a future
change, not a live bug now. Left unguarded rather than adding speculative code for an invariant
this harness's own test (`persona-only arm C is mechanically identical to arm A...`) already
protects; noted here so a future editor sees the reasoning rather than rediscovering it.

**Also reviewed and confirmed correct, not touched:** error-visibility across all three surfaces
a reader might check (`rows`, the dedicated `errors` array, and `summarize()`'s printed count);
the persona-has-no-effect claim (re-derived from the branching in `runArmAgainstFixtures`, not
just the comment); and `LENS_TO_DEFECT_TYPE`'s completeness against `DEFECT_TYPES`.

**Separately, `sower-review:scope-gate` verdict: GO** on the experiment design itself - the
decision thresholds are copied verbatim from plan §5 (not loosened or tightened here), the
lens->defect-type mapping isn't tuned toward a result (the real run reads NEGATIVE despite it),
and the engineered negative-control fixture is a genuine content-driven tie (`winFixtureCount`
asserted as exactly 0, not just "below the bar"), reinforced by an independent synthetic-data
unit test of `decide()` covering all three verdicts. One thing that review surfaced and this
worktree does not resolve, because it isn't this worktree's decision: the real 5-fixture run
already reads NEGATIVE today, which is itself the author decision point named in the plan
("Decisions left to the author" - what happens if phase 4 comes back negative). Flagged to
cnc-harness-a7/Muad, not decided here.

## 2026-09-16: MLLM Coder v6 item 4 - execution isolation for Project A's v0, git-worktree-per-agent is sufficient

**Context:** Project A (`coder-gate-agent-stub`) needs an execution-isolation story for its v0
agent loop before that loop runs anything. v0's own build-ready plan
(`relay/runs/2026-09-15T03-42-24-956Z/deliverable.md`) already commits to one file, one diff,
reviewed before apply, with only narrow allowlisted verification (`run_tests`) - no arbitrary code
execution anywhere in that scope.

**Decision:** git-worktree-per-agent is sufficient for v0, because v0 never runs untrusted or
arbitrary code - only a fixed, allowlisted verification command (`run_tests`). No hosted
sandbox-as-a-service (E2B, Daytona, Modal, or similar) is adopted now. The crossing trigger, named
verbatim so a future session can check against it rather than re-litigate the call: **"the first
non-allowlisted code execution in the agent loop — e.g., arbitrary shell commands beyond the
allowlisted run_tests."** MicroVM-vs-container is recorded here as unmeasured framing only, for
use once/if that trigger fires - this decision does not recommend either.

**Why:** OSS agent-orchestrator projects independently converging on the same isolation choice at
a comparable scope is a real, corroborating pattern, not a novel bet: `Review/oss-agent-landscape-
v6-research-2026-09-15.md`'s live research found multiple independent projects (Claude Squad,
amux, parallel-code, Conductor) converging on git-worktree-per-agent as their isolation primitive.
The same research also names the heavier alternative some other OSS projects chose instead:
`agentbox` runs each agent in a sandboxed VM, and `agenttier` goes further, giving each agent a
Kubernetes Pod behind a default-deny network policy - named here as the named alternative this
decision explicitly does not adopt for v0, not as more worktree-convergence evidence. Adopting a
hosted sandbox or a microVM now would add operational surface (accounts, network egress, cost) for
a threat model v0 does not have, since the only code
that ever runs is the one allowlisted `run_tests` command reviewed in `src/tools.js` - there is no
arbitrary execution to isolate against yet.

**Overlap check (live, this pass):** none of `coder-gate-agent-stub`'s three commits (`c36a3fd`,
`7557449`, `ddec3da`) touch execution isolation - `7557449`'s seat permission-boundary bus governs
which capabilities a seat may invoke, not how or where code executes, and `ddec3da`'s diff-shape
validator runs no code at all. No overlap found; this decision is a fresh record, not a
reconciliation with existing work.

**Falsified if:** A future check of `coder-gate-agent-stub`'s commits shows execution already
crossing into non-allowlisted code, making the v0-sufficiency premise stale.
