# Idea matrix - THCMCP + Sophi-A

*Created 2026-09-16. A living table, not a plan - nothing here is scheduled by being listed.
Purpose: one scannable place to see every idea gathered across `Review/FLAGSHIP-IDEAS.md`,
`Review/IDEAS-INDEX.md`, `~/Projects/Ideas.md`'s v7 sections, and chat, with an honest status so a
long-horizon reader doesn't have to re-derive "is this built" from commit archaeology. Update the
Status column when something ships, gets deferred, or gets declined - don't let this drift stale
like the docs it replaces the need to re-read. Full reasoning for any row lives in its Source doc;
this file is a pointer + status, not the argument itself.*

**Status legend:** ✅ Built/shipped · 🔶 Partially built · 🔷 Planned/scoped, not built · 💭 Idea
only, not scoped · ⛔ Deferred (named trigger to reopen) · ❌ Declined (real reason on file)

---

## THCMCP - debate/verification mechanism

| Idea | Status | Notes | Source |
|---|---|---|---|
| Tool-grounded verification (run tests/checks, inject ground truth into panel review) | ✅ | Shipped v7 core mechanic - the literature's single highest-value gap, closed | `Ideas.md` v7 restructure |
| Evaluation harness (council vs. single strong model at matched cost) | 🔶 | Gate item, ranked above all v7 features; SWE-bench diff-review pilot planned 2026-09-15 as the first real measurement, not yet run | `Ideas.md` v7 restructure; FOCUS.md item 6 |
| Descending rounds (plan → architecture → edge cases → code, each level frozen) | ✅ | Shipped v7 | `Ideas.md` "DESCENDING rounds" |
| Seat-requested bounded tool calls, canary objections, claim schema w/ typed evidence | ✅ | v7.5 six-item batch, shipped | FOCUS.md item 6 |
| Resource Allocator (route scarce strong-model attention to real disagreement) | ✅ | v7.3, shipped before v7.5 | FOCUS.md item 6 |
| Ambiguity-union + strongest-seat criteria, roster inversion, two-strong-model comparison chain | ✅ | v7.5 batch | FOCUS.md item 6 |
| Provider failure → recorded dropout, never crash the run | ✅ | v7 fast-follow: seat-reliability + provider-failure degradation shipped | FOCUS.md item 6; `Ideas.md` "provider failure" |
| Unevidenced FAILED verdicts silently synthesized by our own code | ✅ | Root-caused and fixed (evidence-driven verdict enforcement) | `Ideas.md` "self-reversing critics" |
| Partial-output safety check schema-mismatched, false-positives every panel call | 🔷 | Named bug, check current `stage-contract.js` before assuming still open - `f1ef464` in git log looks related | `Ideas.md` v7 backlog #2 |
| Fixed budgets (e.g. dossier README) must fail loudly, never truncate silently | 🔷 | Named twice as a real recurring defect; check current budget-handling code before assuming fixed | `Ideas.md` v7 backlog #3 |
| "Prompts are not validation" - systematic enforcement pass (every stated rule gets a test) | 🔶 | Several individual instances fixed (verdict enforcement above); no evidence of a systematic sweep | `Ideas.md` v7 backlog #4 |
| Graphe paranomon challenge stage (reopen one signed-off criterion, at cost to challenger) | 🔷 | Ranked #1 mechanism candidate against the debate plateau; not shipped as of last check | `Ideas.md` research section; FOCUS.md v3 item 5+6 deferral note (related, not identical) |
| Reward information contributed, not agreement (isegoria; wire novel-objection rate to score) | 🔷 | Instrument (independence-skew report) already exists, not wired to scoring | `Ideas.md` research section |
| Invert speaking order (weakest seats first) | 💭 | Cheapest possible falsifiable experiment, never run | `Ideas.md` research section |
| Sortition (draw seats by lot per run) | 💭 | Conflicts with cost control + no-lab-grades-own-draft rule; needs a constrained design | `Ideas.md` research section |
| Discessio (discrete support/object/abstain as structured data, separate from prose) | 🔷 | Motivated by two real bugs where prose and structured verdict disagreed | `Ideas.md` research section |
| Per discessionem (skip debate entirely when first pass is unanimous, zero objections) | 💭 | Cost-saving idea, not built | `Ideas.md` research section |
| Structured objections, Toulmin-shaped (`{criterion, category, claim, grounds, warrant, verifiable, evidence_ref}`) | 🔷 | Named as the substrate every later metric needs; check current objection schema before assuming unbuilt | `Ideas.md` v7 restructure #4 |
| Disagreement-survival / novelty metrics (never an agreement score) | 🔷 | Depends on structured objections above | `Ideas.md` v7 restructure #5 |
| "Dissent and what you lose" section preserved in every deliverable | 🔷 | Not confirmed built | `Ideas.md` v7 restructure #6 |
| Confidence calibration per criterion | 💭 | Not scoped | `Ideas.md` v7 restructure #7 |
| Cost routing (frontier models on Proposals/Debate/Panel, cheap models on Skeleton/Build/Handoff) | 🔷 | Aider-style split, 30-50% reported cost reduction elsewhere; not confirmed built here | `Ideas.md` v7 restructure #8 |
| MLLM north star: many models propose/vote on building a business's whole infrastructure | 🔷 | Explicitly "third slice," gated on tool-verification + descending rounds (both now shipped) - this is the next real door to open, not parked | `Ideas.md` "V7 NORTH STAR" |
| Plan → executable, dependency-ordered task list | 💭 | Bridges a plan document to real Claude Code work; not built | `Ideas.md` v7 additions #1 |
| Follow-up questions against a completed run (answer FROM the run record, not re-reasoned) | 💭 | Cheap (retrieval + one seat); not built | `Ideas.md` v7 additions #2 |
| Per-run debate-value summary attached to report.json | 💭 | Script (`audit-debate-value.mjs`) already exists in relay for archive-wide computation; per-run attachment not confirmed built | `Ideas.md` v7 additions #4 |
| Deliverable in the buyer's language (translated plan, not translated legal text) | 💭 | Legal texts stay human-written German/English only; plan translation is lower-risk | `Ideas.md` v7 additions #5 |
| Chain blames builder for sections the chain itself requires (Assumptions/Scope ledger) | 🔷 | Cheap fix identified (criteria generator exempts chain-required sections); cost one revision round on 3 separate runs | `Ideas.md` "chain blames the builder" |
| npm publish | ✅ | `the-high-council@0.7.5` live on registry | FOCUS.md item 6 |
| Local-model/Ollama seats | ✅ | Shipped v7.1 | FOCUS.md item 6 |
| Windows `.exe` + Linux AppImage packaging, CI workflow | 🔶 | Binaries built + smoke-tested (9/9); CI workflow (`release-binaries.yml`) exists but has **never actually run** - `wine64` package name on ubuntu-24.04 unverified | FOCUS.md item 6 |
| Backend/frontend-developer generic skills shipped inside THCMCP | ✅ | De-SMO'd from sower-plugins, MIT, shipped v0.7.0 | FOCUS.md item 6 |
| Reusable criteria library (by task shape, not by project) | 💭 | GP's 40-criterion rubric took weeks; a shared library would raise the floor everywhere | `Ideas.md` "third item" |
| Pre-delivery checklist for customer plans (abstentions, round-cap hits, untraceable numbers) | 💭 | Built from known failure modes; not built as a gate | `Ideas.md` "fourth item" |
| Plan-vs-build diff capture (what the plan got wrong, cheap ground truth) | 💭 | Zero-cost substitute for a paid eval; not built | `Ideas.md` "feedback loop" section |
| Intake-form quality as the real lever on customer plan quality | 💭 | Commercial insight, not an engineering task; applies to sower-industries' plan-shop intake directly | `Ideas.md` "commercial insight" |

## THCMCP - MLLM Coder (the coding/diff-review pillar)

| Idea | Status | Notes | Source |
|---|---|---|---|
| MLLM Coder v1 (debate-gated diff review, one diff/file/hunk, no write tool) | ✅ | Planned + built | FOCUS.md item 6 |
| MLLM Coder v2 (OpenRouter interchangeability) | ✅ | Merged `620ae44` | FOCUS.md item 6 |
| MLLM Coder v3 (trust-hazard fact, fallback-misattribution fix, path-sensitive signoff) | ✅ | Items 2+3+4 merged; items 5+6 (debate-before-propose, security-lens critic) ⛔ deferred - `chain.js` can't support pre-propose debate without redefining what "critic" means | FOCUS.md item 6; `coder-gate-v3-item5-6-deferral.md` |
| MLLM Coder v4 (preflight stage, verify re-invocation, `--signoff` wiring, offline fixture scoring) | ✅ | Shipped, re-verified from scratch against literal acceptance tests, 40/40 | FOCUS.md item 6 |
| MLLM Coder v4.5 Project B (gate integration against a stub agent) | ✅ | Task 0+1 done; Muad has since added Tasks 1+2+5+6 directly, status of "Project A" genuinely unclear (flagged, not resolved) | FOCUS.md item 6 |
| MLLM Coder v4.5 Project A (real write-capable coding agent, parity w/ Claude Code/Cursor/Codex) | ⛔ | Explicitly deferred by scoping council, not cancelled. Reopen triggers: (a) ≥3 publicly cited unreviewed-apply failures in a comparable OSS agent, or (b) a real external pilot user demands it | FOCUS.md item 6 |
| MLLM Coder v6 (status ledger, span-tree progress records) | ✅ | Items V6-1+V6-2 merged | git log `56e1e60`/`05ddaff` |
| MLLM Coder v6 remaining items | 🔷 | Ran through council, 2/3 signoff, hit round cap - Mistral's objection on V6-4's stub-test acceptance check left as a named open human decision, not overridden | `IDEAS-INDEX.md` |
| Gesture-based diff review UX (swipe-approve a hunk, debate-board view when contested) | 💭 | Explicitly belongs to GUI phase 3, not coder-gate itself - v1 has zero UX surface by design | `FLAGSHIP-IDEAS.md` |
| Multi-candidate diff comparison (Rover-style) | 💭 | Real, reinvented six times across the OSS ecosystem in 2026, nothing shipped in that shape anywhere; unit should be the hunk, not the candidate | `deep-research-v8-directional-followup-2026-09-15.md` |
| Security-lens critic (diff-authoring critics) | ⛔ | Same deferral as v3 items 5+6 - would change what "critic" means in coder-gate | `coder-gate-v3-item5-6-deferral.md` |
| Context partitioning across proposal-stage seats | 🔶 | v1 shipped (`2cd65c3`) | git log |
| Cold-reader coherence check (post-signoff, zero-context) | ✅ | Merged `0e16f0b` | git log |
| Final security-review gate (read-only, post-build, typed findings) | ✅ | Merged `515439a` | git log |

## THCMCP - packaging, protocol, ecosystem

| Idea | Status | Notes | Source |
|---|---|---|---|
| Versioned run/event protocol (`events.jsonl` live, not just `report.json` at the end) | 💭 | Useful for Sophi-A GUI regardless of Android; cheap, no architecture conflict | `Ideas.md` "AI operating environment" |
| ACP (Agent Client Protocol) integration | 💭 | Real standard, both directions unassessed before; a proxy-chain RFD is "the shape a gate actually is" | `deep-research-v8-directional-followup-2026-09-15.md` |
| Reserved reason codes + a named non-verdict for "could not judge" | 💭 | Cheapest real item from the v8 followup | `deep-research-v8-directional-followup-2026-09-15.md` |
| Digest-bound one-time approvals for human-stop gates | 💭 | From v8 followup | `deep-research-v8-directional-followup-2026-09-15.md` |
| Meter a debate run as a cost unit | 💭 | Named as a clean, currently-unfilled gap industry-wide | `deep-research-v8-directional-followup-2026-09-15.md` |
| Monthly research methodology (paper-feed + changelog watching, triggered-only issue mining) | ✅ | Settled 2026-09-15, unanimous 3/3 | `IDEAS-INDEX.md` |
| Hash-chained audit-log entries (AgentGuard-style) | 💭 | Top find from market survey, unbuilt | `market-feature-survey-2026-09-15.md` |
| Academic citations for the blind-panel approach | ✅ | Built into v5 item 6 | `IDEAS-INDEX.md` |
| Capability-first framing for policy checks | ✅ | Built into v5 item 5 | `IDEAS-INDEX.md` |

## Sophi-A - product/GUI

| Idea | Status | Notes | Source |
|---|---|---|---|
| Sophi-A visual identity (C&C seat centered, cheap-model seats arranged around it) | 🔷 | Design brief done (`relay/Docs/SophiA-CC-GUI-v1-DesignBrief.md`), real research + screenshots done, waiting on Muad to run it through Claude Design | FOCUS.md item 6; `Ideas.md` v7 additions #3 |
| TODO · Priority pill reads a new human-owned `cnc-harness/TODO.md` verbatim | 🔷 | Real answer settled, not built - open question is who may append/reorder/remove | `FLAGSHIP-IDEAS.md`; `sophia-todo-advisor-emissary-research-2026-09-15.md` |
| Advisor as cheap pre-debate triage/rubber-duck filter | 🔶 | Advisor itself already shipped (PLAN.md spec); this specific use-case framing is settled but not built as a distinct flow | `FLAGSHIP-IDEAS.md` |
| Emissary (drafts HANDOFF.md / status trackers / commit text, never sends messages itself) | 💭 | Genuinely new seat concept, real use cases ranked, nothing built | `FLAGSHIP-IDEAS.md` |
| Multi-session C&C delegation as a built-in Sophi-A capability | 🔷 | Scoped, unanimous signoff 2026-09-15 (hub-and-spoke, `cnc` fixed coordinator, max-concurrent 4, two soft-stop mechanisms) - not dispatched to build, waiting on Muad to prioritize | `FLAGSHIP-IDEAS.md`; `IDEAS-INDEX.md` |
| Seat Families (long-running delegated agent sessions per seat, compassion-policy failure states) | 🔶 | All 10 items built overnight, independently security-reviewed, integrated locally on a branch - **nothing merged/pushed**, `families.enabled=false`; 7 open decisions left for Muad; no `family_apply` command exists yet | FOCUS.md item 6 |
| Local-model support as flagship differentiator (BYO-hardware machine, no per-call cost) | 🔶 | THCMCP has it (v7.1); Sophi-A-specific framing/positioning not built | `FLAGSHIP-IDEAS.md` |
| Downloadable Sophi-A binaries | 🔷 | Tauri already produces native installers per platform - likely closer to done than THCMCP's case; not confirmed | `FLAGSHIP-IDEAS.md` |
| Quick Setup: one OpenRouter key provisions the whole council | 💭 | Real open question on whether routing all seats through OpenRouter preserves cross-lab diversity or redefines it | `FLAGSHIP-IDEAS.md` |
| User-named seats, roleplay-style (starting with C&C) | 💭 | Real UI/identity feature, needs its own design pass | `FLAGSHIP-IDEAS.md` |
| Premium / Business pricing tiers | 💭 | Named as a real pricing decision, not a GUI toggle - needs Muad's call before any Setup-screen design | `FLAGSHIP-IDEAS.md` |
| Sower Industries website wallet (Steam-style stored balance, EUR + BTC, non-cashable) | 💭 | Custody/legal framing, metering design, BYOK-relationship all unscoped | `FLAGSHIP-IDEAS.md`; `Ideas.md` pointer |
| Voice input, routed to intent (never acts on raw audio, always resolves to editable text) | 💭 | Real near-term UX framing: voice good at intent, bad at exact syntax; the real battleground is interruptibility, not recognition accuracy | `IDEAS-INDEX.md` long-horizon section |
| Dynamic spend control (adjust/cap live, not just warn) | 💭 | Needs a plan; `--max-usd` and `--cost-today` are the building blocks | `Ideas.md` 2026-09-13 session notes |
| Sophi-A build seats fan out into subagents (seat stays one tile) | 💭 | Needs orchestrator-change + cost-accounting + stop-all-semantics plan first | `Ideas.md` 2026-09-13 session notes |
| No green/yellow/red seat colors; real visual polish, blurred glows, breathing room | 💭 | Named as buildable now, no plan needed - check current GUI state before assuming still open | `Ideas.md` 2026-09-13 session notes |
| Council Minor / Council Major (two presets, two prices, one engine) | 💭 | Not on FOCUS; Muad's call | `Ideas.md` 2026-09-13 session notes |

## Cross-cutting: strategy / positioning (not features)

| Idea | Status | Notes | Source |
|---|---|---|---|
| The durable moat is not the algorithm (MIT + commodity models = no code moat) | 💭 | Named as possibly the single most consequential open question the company has | `IDEAS-INDEX.md` long-horizon section |
| Candidate moat 1: orchestration UX (Sophi-A) as a craft moat | 💭 | Positioning idea | `IDEAS-INDEX.md` |
| Candidate moat 2: an honestly-published trust record over time (no efficacy claims until measured) | 🔶 | Discipline already practiced; the SWE-bench pilot is the first real step toward making it a visible asset | `IDEAS-INDEX.md` |
| Candidate moat 3: curatorial taste made visible (a public "why we said no" changelog) | 💭 | Nobody in the space currently publishes declined-idea reasoning as a selling point | `IDEAS-INDEX.md` |
| "Beats a single strong model" requires 3 conditions (decorrelated errors, real aggregator, disagreement routing) | ✅ | Promoted to `FLAGSHIP-IDEAS.md` as a standing positioning check before any marketing claim | `mllm-beyond-single-model-ideas.md` |
| Sophi-A/THCMCP merge into one runtime+clients product | ❌ | Directly contradicts THCMCP's own `CLAUDE.md` standing rule ("do not conflate them") | `Ideas.md` "AI operating environment" |
| Full Android port | ⛔ | Zero scoping done, single biggest scope-creep risk of the pasted ChatGPT roadmap; no reopening trigger named yet | `Ideas.md` "AI operating environment" |
| Trust/risk-tier layer on agent actions (read / low-risk-write / high-risk-write / irreversible) | 🔷 | Not new work - a second description of the already-open `required_signoff_paths` wiring gap | `Ideas.md`; FOCUS.md item 6 (MLLM Coder v3/v4) |
| Subscription-seat-as-third-party-automation | ❌ | Against Anthropic's own ToS, confirmed via a closed GitHub issue - don't re-litigate | `subscription-seat-tos-check.md` |

---

## How to keep this file useful

- **New idea:** add one row to the right table, status 💭, one-line note, source pointer. Don't
  write the reasoning here - link to where it already lives (a `Review/` doc, a relay run, a chat
  quote in `~/Projects/Ideas.md`).
- **Something ships:** flip the status to ✅ or 🔶 and say what's still missing in one clause. Do
  not delete the row - the history of "this was 🔷 for N weeks before it shipped" is itself useful
  long-horizon signal.
- **Something gets killed:** ❌ or ⛔ with the real reason in the Notes column, not just "no." A
  reader six months from now needs to know whether to re-propose it.
- **Before dispatching a research session to answer a question:** check this file and
  `Review/IDEAS-INDEX.md` first - both exist so nobody re-derives an already-answered question.
  This file is the status view; `IDEAS-INDEX.md` is the doc-pointer view. They overlap by design;
  keep both, don't merge them into one.
