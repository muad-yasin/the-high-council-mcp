# Changelog

## 0.7.0 - 2026-09-14

v7 build per the council-signed plan (`relay/runs/2026-09-14T00-20-44-997Z/deliverable.md`).
Six items, each gated behind its own opt-in config key so a chain that sets none of them behaves
exactly as it did in 0.6.0; 335 tests, offline, no API key, no live provider call (296 baseline +
39 new). No efficacy claim is made anywhere below - every item here is a correctness, cost, or
process-honesty change, not a claim that debate output improves.

- **Tool-grounded verification** (`verify.enabled`) - seats may invoke a fixed, sandboxed
  allowlist of four offline tools (`run_tests`, `check_versions`, `grep_repo`, `read_file`, no
  network access, no generic shell executor); results are appended to the run record verbatim
  under `ground_truth` and re-presented to later seats unedited by the debate. The literature this
  plan draws on names external ground-truth contact as the one mechanism that holds up in
  open-ended, no-ground-truth debate; this is its direct implementation.
- **Seat reliability recording and provider-failure dropout degradation**
  (`degrade_on_provider_error`) - a provider failure in the non-unanimous critique loop used to
  crash the whole run; it now degrades to a recorded `dropped` seat and the run completes.
  `verdict_stats` gained a per-lab `usableVerdictRate`. Absent the flag, a provider failure
  crashes exactly as it always did - this is a real behavior change only for opt-in callers.
- **Descending rounds** (`descending: true`) - a chain mode where each round debates a new,
  frozen object in sequence (plan -> architecture -> edge cases -> code) instead of re-opening the
  same object; an amendment against an already-frozen stage is rejected at the executor level, not
  by an unenforced prompt rule. Extended per the author's direction after the initial build: round
  1 flows into the existing criteria/proposals/debate/reply pipeline rather than a bespoke
  descending-only prompt, and the final stage runs signoff + handoff once, over the whole frozen
  stack, rather than per stage.
- **Scoped debate freedoms** (`freedoms: { blocking_questions, pass }`) - two rights only: a
  critic may ask one blocking question that pauses its verdict until the proposer answers, or may
  pass with a stated reason (recorded distinctly from both sign-off and objection, excluded from
  the unanimity vote like an abstention). Novelty-based stopping, seconding, and
  question-challenging were cut - none is deterministically offline-testable.
- **Bounded post-signoff challenge stage** (`challenge.enabled`) - modeled on the Athenian graphe
  paranomon: after signoff, exactly one recorded challenge may re-open exactly one decision for
  one round. The one-challenge, one-decision, one-round bound is hard-coded in the executor, not
  configurable upward - `chain-lint.js` rejects any attempt to set a max-challenges or
  additional-rounds key, since the narrowness of the re-open is itself the decay mitigation.
- **Zero-cost retrospective metrics** (new `metrics_report` MCP tool and `council --metrics`
  CLI subcommand, +1 to the tool count) - amendment rate, withdrawal rate, objection-follow-through
  rate, and tool-call usage, computed from existing run logs on disk, modeled on `spend.js`'s
  "derive, never record" discipline. Explicitly labeled descriptive telemetry throughout, never a
  baseline: Direction 1 (a paid harness comparing the council against a single strong model at
  matched cost) was **cut** - the author declined both the ~$300 full and ~$20 pilot cost, and no
  free version of an actual comparison run was proposed that didn't smuggle in real cost or an
  implicit efficacy claim. This metrics extension is the free, non-comparative salvage of that
  direction's measurement intent, not a revival of it.

**Also cut from this release, recorded plainly:** the scale/governance "many models jointly
propose and vote on building something large" direction. Its granularity question is answered on
paper (the unit of proposal-and-vote is a module: named, single-responsibility, with a declared
interface and test plan) but it is not built - running unanchored, open-ended votes before the
anchoring machinery above existed would have repeated exactly the failure mode the 2025-26
literature warns about for open-ended multi-agent debate. Items 1 and 3 above are the named
prerequisites for revisiting it, not a deferral without a stated condition.

Built across six independent branches (`v7/item1-tool-verification` through
`v7/item6-metrics`), each test-verified in isolation before merge, then merged one at a time
into master with two integration-only conflicts resolved (a frozen-key test fixture that didn't
yet know about the challenge stage's new key, and two independent mock-provider branches that
needed to sit side by side) - no feature logic was changed to resolve either.

## 0.6.0 - 2026-09-13

Role-assigned debate seats (`relay/runs/2026-09-13T20-20-07-757Z/`, plan revise-2.md), built
across seven phases. 296 tests, offline, no API key, no live provider call. Every merge point
run through `sower-review:bug-audit`; two real integration-seam bugs were found where phases
built in parallel (without seeing each other's code) had made quietly conflicting assumptions,
both fixed before this release (see docs/v6-decisions.md, Phase 7, for the full account).

**Status - stated plainly, as every commit tonight has:** the plan behind this release was **not
five-lab signed off**. Four labs passed clean; qwen refused over a single objection (the
"Decisions left to the author" section wasn't the plan's last section, which one criterion
required). That run's own `report.json` said `passed:true` regardless - a separate, real
false-pass bug in the chain's own reporting (qwen's reply was silently unparsed, not evaluated),
since fixed in `relay`. Muad reviewed the objection directly and said build - it is about
document ordering, not the design - and building proceeded on that basis, not on a false
sign-off.

**No efficacy claim.** This release ships the mechanism only. Whether role-assigned debate seats
actually improve anything about a real multi-lab debate is untested by this release. The
offline measurement harness built for this feature (phase 4) returned a NEGATIVE result for
lens-routing against a deterministic heuristic defect-catch probe, and never measured persona at
all - and after review, that experiment was found not to speak to the feature's real purpose in
the first place (debate diversity among real model seats reasoning differently about real
decisions, not defect-catching by a heuristic mock). See docs/v6-decisions.md's Phase 4 and
Phase 5 entries for the full reasoning. Nothing here states or implies role-assigned seats
produce better output than plain ones.

**What shipped:**

- **An optional per-seat `role` field** (`{ lens?, persona? }`) on any `seats.proposers` entry,
  applied only to that seat's debate-stage system prompt. A chain with no `role` set produces
  byte-identical prompts to before - proven by a golden-hash test against every shipped chain
  config, the same discipline `max_proposals_per_seat` used in 0.5.0.
  - `lens`: one of a fixed enum (`adversary`, `integrator`, `long-horizon`, `user-advocate`,
    `security-and-legal`) - a defined critique function.
  - `persona`: a name, resolved against a curated default set when it matches one (see personas,
    below) with a fallback to free text for an operator's own persona - a voice, not a function.
    Modeled as strictly separable from `lens` so any measured effect (if one is ever found) can
    be attributed to the function or the voice, not a blended "character."
  - `role` set on any seat kind other than `seats.proposers` is now caught fail-loud by
    `council doctor` and the run codepath - it would silently do nothing, since only the debate
    stage ever reaches the seats that use it.
- **Stage isolation, enforced, not just true today.** Four source-level guards (not runtime
  behavior tests) assert `applySeatRole` has exactly one call site in the whole codebase, that
  call site is the debate stage, and the panel/critique-stage prompt builders reference `role`
  nowhere in their own source - so a future edit that accidentally lets a role reach the
  evidence-only grading stage fails CI loudly rather than silently.
- **A weighted debate tiebreak** (`src/tie-break.js`): the arithmetic and a `report.json` field
  (`debate.tie_break`) recording whenever a tie is broken - not yet wired into a real
  vote-counting decision point in this release; that wiring is separate, future work.
- **Four failure-mode detectors**, computed from a run's own real debate output (never from the
  offline probe) and attached at `report.json`'s `debate.diagnostics`: a seat quoting no evidence
  despite objecting or merging (performing a character instead of reviewing), textual overlap
  between differently-lensed seats arguing the same proposal (roles collapsing into agreement
  instead of diversifying), a same-run gap between role-bearing and role-less seats' evidence
  quoting, and the fraction of a seat's own words that fall inside quoted evidence versus voice.
- **Five default public personas** (Moses, Noah, Matthew, Van Gogh, Parzival - `PERSONAS.md`),
  each with a curated name and voice directive, replaceable wholesale by an operator via a
  `COUNCIL_PERSONAS_FILE`-pointed file. Chosen specifically so this public MIT repo never ships
  a third-party trademark or private name.
- **A third-party-name lint** (`src/name-lint.js`) scanning the repo's own source, config and
  docs recursively for name patterns that don't belong in a public repo, extensible via a local,
  gitignored exclusion file.
- **A real five-lab debate-role chain** (`chains/plan-debate-roles-c1.json`) pairing each of five
  labs' critic seats with a distinct lens and persona - the actual artifact the feature was built
  to run, reviewed (`sower-review:scope-gate`: GO) and priced (`--dry-run`: $0.47/run worst case)
  but **not run live** - that spend is a separate, later decision.

**Test count**: 213 at 0.5.0, 296 now.

## 0.5.0 - 2026-09-13

v5's fifteen-candidate feature horizon (`relay/runs/2026-09-13T14-51-08-757Z/`, unanimous
five-lab sign-off, $0.2181), built across five phases, each offline-tested against
`chains/mock-*.json` fixtures and each merge point run through `sower-review:bug-audit`. 213
tests, offline, no API key, no live provider call. The mechanism itself - debate, proposals,
signoff, BYOK, the no-ledger-file invariant - is unchanged. No efficacy claim is made anywhere
below, including for the quality probe (see its own section further down).

**Failure legibility and first-run experience**

- **`council init [--yes]`** - a starter chain and task file a stranger owns, a real (no-network)
  price of that chain, and a canned $0 mock run so the first artifact anyone inspects is a real
  run folder, not just terminal output. Reruns never overwrite an edit you made to either
  starter file.
- **A structured error catalog** (`COUNCIL-E001`-`COUNCIL-E004`, `TROUBLESHOOTING.md`) for this
  project's actual hard-fail paths - missing key, unpriced model, malformed chain file,
  unreadable stage reply - each wrapped from its existing raise site with no change to what
  fails, only to what's printed: a plain-words cause, what the missing concept IS, a concrete
  fix naming the real file, a doc pointer. Distinct exit codes: 5 for a condition you can fix and
  continue from, 6 for one that stops this invocation outright.
- **`council doctor --chain <file>`** - fail-loud chain-config linting, before any metered call:
  a seat under a misspelled key that would silently never run, a missing/empty `seats.critics`
  that would crash or vacuously pass the review round, an unrecognized provider. Wired into both
  a read-only doctor check and the run codepath itself.
- **`council doctor --scan-artifacts`** - scans `tasks/` and `chains/` for API-key-shaped strings
  before you commit or share them; reports file and line, never the matched text.

**Cost and observability**

- **`council --forecast-cost --chain <name>`** - a realistic-case USD range from a chain's own
  historical runs, repriced at today's rates, distinct from `--dry-run`'s worst case.
- **`council export-board --run <folder> --out <file>`** - one self-contained HTML file of a
  run's proposals, debate, replies and verdict. No external assets, no server.
- **`council replay --run <folder> [--json]`** - a numbered, step-by-step transcript of a run.
- **`--stats`'s independence-skew report** - per-lab novel-objection rate and solo-signoff rate,
  with a low-independence flag, plus a shape-only-critique-round counter. Both purely descriptive
  - neither reweights a panel or changes a verdict.
- **`stage-log.jsonl`** - one structured JSON line per stage per run folder (seat, lab, token
  counts, cost, timing - no prompt content), alongside the existing markdown/`report.json`.

**Chain-config evolution, both opt-in**

- **`schemaVersion`** - an optional integer field; `council doctor` warns, never fails, when a
  chain omits it or names an older/newer one. A chain file without it behaves exactly as before.
- **`max_proposals_per_seat`** - **opt-in, no default.** Debate size stays unlimited unless a
  chain file explicitly sets this field; no existing chain's behaviour changes. When a chain does
  set it and one seat's own proposals still exceed the cap, that seat gets one merge prompt to
  fold its own list down before the debate board sees the extras.

**Withdrawal-chain integrity**

- **A withdrawal-chain termination check** (`council doctor --run <folder>`, and wired into a
  run's own reply-round close) detects a cycle or a dead end in mutual proposal withdrawals - a
  section that ends up with no surviving owner. Caught a real instance of exactly this bug inside
  the v5 planning run that authored this feature (two proposals mutually withdrew in each
  other's favour); the fix is regression-tested against that real run folder.

**Seeded-defect quality probe (test-only, Phase 1 of 2)**

`test/quality-probe/`: five synthetic fixtures seeded with 25 planted defects, graded by three
deterministic heuristic detectors, reporting catch-rate and unanimity as two separate numbers -
conflating "the detectors agreed" with "the detectors were right" is the reason this exists.
**This is not an efficacy claim and never may be quoted as one.** The detectors are deterministic
heuristics standing in for a mock panel, not real model seats - these numbers say nothing yet
about what an actual multi-lab council catches on a real plan with a real, un-cataloged defect.
Not under `src/`, not in `package.json`'s `files`, isolated from every runtime surface (`runs/`
scanners, the local UI, `verdict_stats`) by construction. Phase 2 (replaying real recorded
objections, which would let a real-panel claim be made honestly) needs a replay-driver design
that does not exist yet and is explicitly out of this release.

**Other**

- **`CONTRIBUTING.md`** - the three smallest landable contribution shapes.

## 0.3.0 - 2026-09-13

v3 build, designed from nine real runs driven the same day (chain `plan-debate-c2-4lab`,
~$0.36 total metered spend, external Claude-role stages). Five items, all offline-tested
against `chains/mock*.json`; the debate/proposal/reply/blind-panel mechanism, external-seat
economics, BYOK, and the no-ledger-file invariant are all unchanged. No efficacy claim is
made anywhere below.

- **Contract-versus-criteria conflict, resolved.** The criteria stage is now told a chain's
  own required deliverable sections (reusing `requiredDeliverableSections()`, already
  computed for v2's pre-flight check) before it writes anything, so it can no longer write
  a criterion that conflicts with a section the builder is required to produce. This
  replaced v2's warn-only pre-flight check as the primary fix (that check remains, for runs
  that skip the criteria stage) after the same conflict class cost rounds in four separate
  runs, including a genuine deadlock during this plan's own review where two acceptance
  criteria contradicted each other and no revision could satisfy both.
- **Artifact inlining, warned about.** `checkArtifactReferences()` (`src/preflight.js`) warns
  when a task names a file path it never fences verbatim in its own text - the real failure
  mode that led four labs to invent plausible-but-nonexistent identifiers against a
  summarised rubric file. Warn-only, consistent with the rest of `preflight.js`.
- **A first-class dispute record.** A reviser that judges an objection to not be a real
  defect now ends its reply with `DECLINED: <reason>` lines, stripped before the text
  becomes the next round's draft and collected into `report.json`'s new `disputes` field
  and a `BOARD.md` section - never inside the deliverable text itself, so no format
  criterion can ever fail a draft for containing it.
- **Peer-session dispatch, made first-class.** External stages were, in practice, handed to
  independent peer sessions rather than the driver's own subagents. `<stage>.claim.json`
  (`src/peer-claim.js`) records who claimed a stage and when, surfaced in `external_prompt`
  and the resume brief; `submit_stage` gains an optional `claimed_by` argument and three
  warn-only checks (claimer mismatch, missing required sections, a late/duplicate answer
  kept as `<stage>.late.md` rather than silently overwritten). No harness-initiated spawning
  or messaging of any agent.
- **Frozen-scope enforcement.** A run now hashes its task file's text at start
  (`src/scope-freeze.js`) and refuses to silently `--resume` past a change to it unless an
  `AMENDMENTS.md` entry covers the new hash - the real fix for an operator's late,
  undeclared requirement burning two rounds and a restart because a critic couldn't tell it
  came from the owner rather than a lab inventing scope. The one item in this release that
  can refuse an otherwise-legitimate resume outright; that tradeoff is deliberate, not an
  oversight.

Deviation from the signed plan, recorded plainly: `submit_stage`'s pre-existing guard
(reject an already-answered stage outright) is narrowed for the one case peer-dispatch
needs - a stage that already has an answer now falls through to the `duplicate_answer`
warning instead of being rejected. This is a real behaviour change for every caller, not
only new peer-dispatch ones; a caller that never double-submits sees no difference.

## 0.2.0 - 2026-09-13

v2 build per the council-signed plan (`~/Projects/relay/runs/2026-09-11T12-19-34-184Z/`),
re-curated from `~/Projects/relay`. Nine numbered items; the debate/proposal/reply/blind-panel
mechanism is untouched, no telemetry or network calls were added, and no efficacy claim is made
anywhere below - these are correctness and resumability fixes, not performance claims.

- **Stage contract schema** (`src/stage-contract.js`) - the shared internal data structure
  (`required_sections`, `role`, `no_prior_context`, `return_instructions`) every item below reads
  or writes.
- **`prepare_stage_prompt`** (new MCP tool, +1 to the tool count) - writes a self-contained bundle
  for a paused external stage so a driving session juggling other work can dispatch it to a fresh
  subagent instead of authoring it inline. See `docs/dispatch-pattern.md`. Context is referenced
  by path, never inlined.
- **Prompt-file truncation integrity** - `NEEDS-<stage>.md` now carries a footer (line count,
  byte size, sha256) verified on read; `external_prompt` returns a warning instead of silently
  handing back a truncated or corrupted prompt.
- **Resume-brief mechanism** - `run_status(brief: true)` returns and persists `RESUME.md`,
  regenerated at every stage-completion boundary from run state on disk - never itself trusted,
  always regenerable. No new tool.
- **Cross-run cost breakdown, narrowed from the original plan** - the plan proposed a new local
  ledger file; that was rejected against this project's existing "derived, never recorded" spend
  invariant (`src/spend.js`), whose reasons (drift, a failing write path, a sensitive-deletion
  leak) the plan's debate never addressed. Built instead: `costToday()` (calendar-day boundary,
  per-model breakdown) as an extension of the existing derivation, a `--cost-today` CLI
  subcommand, and a `session_cost_today` field on the existing `spend_report` tool. No ledger, no
  new tool. Full deviation recorded in `DECISIONS.md`.
- **Static pre-flight check** - before any stage runs, a keyword check compares a chain's
  hard-required deliverable sections against the task text for the conflict class this project
  already hit once (a required "Scope ledger" section vs. a "standalone" requirement). Warns,
  never blocks; a known, accepted limitation (rephrased conflicts without trigger words) is
  pinned by name in its own test rather than hidden.
- **Partial-deliverable detection** - a stage's output is validated against its declared required
  sections before being trusted; a miss is logged loudly and recorded, never silently passed
  downstream.
- **Cache-hit staleness detection** - a cached stage is fingerprinted against the task text and
  chain config it depended on; a stale hit (inputs changed since caching - e.g. the task was
  edited between a pause and a resume) is invalidated and the stage actually re-runs, rather than
  silently replaying stale output.
- **Docs** - `docs/dispatch-pattern.md`, an updated MCP tool table (13 tools; `prepare_stage_prompt`
  is the only addition, nothing renamed or removed), and an external-vs-API documentation note for
  operators without a flat-rate subscription (not the default anywhere in config or examples).

Built and tested entirely offline against `chains/mock-*.json` fixtures - zero API spend for the
whole build. See `PROGRESS.md` and `DECISIONS.md` for the full build log and every judgment call.

## 0.1.0

Initial public release.
