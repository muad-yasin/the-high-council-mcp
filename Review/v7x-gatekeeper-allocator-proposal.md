# Gatekeeper and Resource Allocator: a v7.x proposal

> **This document is input for a later planning cycle. It is not a build order. Nothing in
> here should be built today, and nothing in it should be read as approved scope.** It exists
> so that when a future planning session revisits the council's architecture, these two ideas
> have already been through one pass of Research:/Falsified if:/Backward compat: discipline
> instead of starting from the raw ChatGPT sketch again. Treat every claim below as untested
> until its own Research: line says otherwise — none has been prototyped or measured yet.

## Where this comes from

Muad shared a ChatGPT architecture sketch for a hypothetical "THC 2.0": an 11-chamber pipeline
(Gatekeeper, Cartographer, Explorers, Hypothesis Garden, Conflict Engine, Investigators,
Reality/Oracle, Argument Graph, Resource Allocator, Synthesizer, Auditor). Checked against the
just-shipped v7 plan (`~/Projects/relay/runs/2026-09-14T00-20-44-997Z/deliverable.md`), most of
the sketch already exists or was just built under a different name. Two chambers are not covered
by anything in v7 or the shipped codebase. This document proposes those two, in the same
Research:/Falsified if:/Backward compat: format v7 used, and nothing else.

## What's cut / deferred (the other 9 chambers)

Stated plainly so this reads as a scoped addition, not a rediscovery of the whole sketch:

- **Cartographer** → already shipped. This is the `criteria` + `skeleton` stages in `chain.js`.
- **Explorers** → already shipped. This is the blind, per-lab `proposals` stage.
- **Reality/Oracle** → already shipped as v7 item 1, tool-grounded verification
  (`verify.enabled`, the four-tool allowlist, `ground_truth` injection), on branch
  `v7/item1-tool-verification`.
- **Argument Graph** → already exists. `report.json`'s `proposals[]` / `debate.posts[]`
  (`by`/`on`/`stance`/`merge_with`) / `debate.replies[]` (`keep`/`amend`/`withdraw`) /
  `signoff[]` is a directed graph with verifiable edges today; it is a public contract per
  CLAUDE.md ("adding fields is fine, renaming or removing one is a breaking change").
- **Auditor** → already shipped as v7 item 5, the bounded post-signoff challenge stage
  (`challenge.enabled`).
- **Conflict Engine** (as a philosophy of using disagreement as signal, not as the specific
  mechanism proposed below) → its spirit is v7 item 6, the descriptive-metrics extension
  (amendment rate, withdrawal rate, objection-follow-through) computed from existing run logs.
  Note this is descriptive telemetry only, explicitly barred by v7 from being read as an
  efficacy baseline — it does not itself allocate anything, which is exactly the gap Resource
  Allocator (below) would fill if ever built.
- **Synthesizer** → already shipped. This is the existing `build` + `reviser` stage pair (the
  seat that turns proposals/debate into a draft, and the seat that amends it under critic
  objections).
- **Hypothesis Garden** — does not clearly map to anything shipped or planned. The nearest
  existing mechanism (blind per-lab proposals) already generates divergent candidate answers;
  a dedicated "generate many wild hypotheses before narrowing" chamber would be new machinery
  layered on top of that, with no named need in any current chain or run. **Deferred, not
  proposed here**, for lack of a demonstrated gap — not because it was rejected.
- **Investigators** — does not clearly map either. Tool-grounded verification (item 1) already
  gives seats a way to check specific claims against ground truth; a separate "Investigators"
  chamber tasked with open-ended digging reads as a broader, less bounded version of the same
  idea, and the sketch does not specify what it would do that verification does not.
  **Deferred, not proposed here**, for the same reason: no demonstrated gap, and an
  open-ended investigation role is harder to keep offline-testable than the fixed four-tool
  allowlist verification already uses.

The two remaining chambers — **Gatekeeper** and **Resource Allocator** — are the actual subject
of this document, because neither maps to anything shipped or in the v7 plan, and both name a
real, currently-true gap: every chain run invokes every configured seat on a fixed round
schedule regardless of the question's complexity or where seats actually disagree.

## 1. Gatekeeper — pre-council triage

**What it would do:** before invoking the full chain (criteria/skeleton/proposals/debate/build/
critique), run one cheap triage step that decides whether the request warrants multi-seat
council debate at all, versus a single model call. Today, `runChain()` always invokes every
configured seat in `chains/*.json` regardless of whether the underlying question is trivial
(e.g., "rename this variable consistently") or genuinely contested (a scoping decision with
real tradeoffs). The cost model in `src/cost.js` and the spend cap in `invoke()` price and bound
a run that the Gatekeeper never gets a chance to avoid starting in the first place.

- **Research:** Silent. The 2025-26 literature the v7 plan draws on is about what happens once
  multi-agent debate is running (degradation over rounds, the value of ground-truth contact);
  it says nothing about whether a given request should enter debate at all. This is an internal
  cost/value question, not one the cited literature addresses either way.
- **Falsified if:** Across the next 20 real runs where a Gatekeeper triage step is enabled and
  logged (but not yet acted on — logged in shadow mode first), the triage's own "single-call
  sufficient" predictions disagree with what the full council actually produced (measured by,
  e.g., whether debate produced any accepted amendment on the triaged-as-trivial requests) in
  more than roughly 20% of cases, indicating the triage signal is not reliable enough to gate
  spend on. (20 runs / 20%: placeholders, matching v7's own placeholder-threshold convention —
  author-adjustable, untested.)
- **Backward compat:** Gated on a new opt-in key, e.g. `gatekeeper: { enabled: true }`; absent
  key preserves exact current behavior (full chain always runs, no triage step). An offline
  test would assert that a scripted "obviously trivial" task with `gatekeeper.enabled` unset
  still runs the full configured chain unchanged, and that the existing test suite passes with
  the key absent everywhere.

Notes for a later planning cycle, not part of the proposal itself: this is the item most likely
to touch the spend cap's `worstCaseOf`/`wouldBreach` logic in `src/cost.js`, since a working
Gatekeeper is explicitly trying to avoid a projected cost rather than just staying under one —
that is new logic, not a reuse of the existing cap, and should be scoped as such if this is ever
picked up.

## 2. Resource Allocator — disagreement-targeted round spending

**What it would do:** spend more critique/debate rounds specifically on the claims or decisions
where seats actually disagree, rather than applying a fixed round schedule uniformly across the
whole draft. This is explicitly **not** the same thing as v7 item 3 (descending rounds): item 3
fixes a sequence of frozen objects (plan → architecture → edge cases → code) that every run
walks through in the same order regardless of content. A Resource Allocator would instead look
at where the *actual* signoff/objection data in a given run disagrees — e.g., which specific
claims in `report.json`'s `debate.posts[]`/`signoff[]` structure drew amendments, withdrawals,
or split verdicts — and route additional rounds only there, while claims with uniform early
agreement get no extra spend. The distinction matters because item 3 is a fixed schedule applied
identically to every run; this would be a schedule computed per-run from that run's own
disagreement data.

- **Research:** Silent to mildly contradictory. The literature the v7 plan draws on documents
  degradation from repeated re-debate of the *same* object; concentrating more rounds on the
  most contested claims is, structurally, more repeated re-debate of those specific claims, not
  less — so this idea sits closer to the failure mode the research warns about than item 3
  (descending rounds) does, which was designed specifically to avoid same-object repetition.
  Any prototype would need to watch for exactly that degradation pattern on the claims it
  targets, not assume that "more scrutiny where seats disagree" avoids the same decay.
- **Falsified if:** In a prototype comparing disagreement-targeted allocation against v7's fixed
  descending-round schedule on the same set of tasks, the targeted claims show falling
  amendment/withdrawal activity in their extra rounds (the same rubber-stamping signature v7
  item 3's own falsifier watches for at stages 2-4) — that would mean the extra rounds are
  pure cost with no engagement gain, i.e. exactly the failure this idea is meant to avoid.
- **Backward compat:** Gated on a new opt-in key, e.g. `allocator: { enabled: true }`, orthogonal
  to and stackable with `descending`; absent key preserves current fixed-round behavior
  identically. An offline test would assert a scripted run with split signoff data on one claim
  and unanimous signoff on another routes an extra round only to the split claim when enabled,
  and that existing fixed-round chains are unaffected when the key is absent.

Notes for a later planning cycle: a working prototype of this needs a defined, offline-testable
notion of "disagreement" derived from existing `report.json` fields (split `signoff[]` verdicts,
`stance` values in `debate.posts[]`, amend/withdraw counts in `debate.replies[]`) before any
round-routing logic is designed — that definition is itself a design decision this document
does not make.

## Cost accounting

- **BYOK constraint.** Both ideas are pure control-flow changes over the existing seat/provider
  model in `src/providers.js` and `src/chain.js`. Neither implies a hosted service, a default
  key, or any change to the BYOK-only rule in CLAUDE.md. Any prototype work would be priced and
  run the same way v7 items were: `npm run dry` first, then a small number of real paid runs
  against the author's own keys, with the round/seat counts these ideas are meant to *reduce*
  bounding the cost of testing them.
- **One-person-operates constraint.** Neither idea should add operational burden: no new service
  to run, no new file-based state beyond what already exists in `runs/<id>/`. A Gatekeeper
  triage step and a disagreement-derived round schedule are both meant to be computed from data
  already on disk (`report.json`, existing signoff/debate structures) or from one cheap extra
  call, not from a new subsystem someone has to babysit. If a prototype of either idea turns out
  to require new persistent state or a new process to operate, that is itself a signal against
  building it as scoped here.
- **No efficacy claims.** Nothing in this document claims that either feature would improve
  output quality, correctness, or debate outcomes. The stated goal in both cases is cost
  reduction (fewer wasted rounds/seats) with an explicit falsification condition against making
  things worse (rubber-stamping, missed genuine debate). Per CLAUDE.md's binding rule, no
  user-facing text about either feature — README, landing page, or otherwise — may claim an
  efficacy improvement until something has actually been measured, and nothing has been
  measured yet: no prototype of either idea exists as of this writing.

## Summary for the next planning cycle

Of the 11 sketched chambers: 7 already exist under different names (Cartographer, Explorers,
Reality/Oracle, Argument Graph, Auditor, Synthesizer, and the philosophy behind Conflict Engine
via v7 item 6's descriptive metrics); 2 are deferred for lack of a demonstrated gap (Hypothesis
Garden, Investigators); and 2 — Gatekeeper and Resource Allocator — are genuinely new and are
what this document scopes, in v7's own Research:/Falsified if:/Backward compat: format, as
candidates for a future v7.x or v8 cycle. Both are opt-in, zero-impact-when-absent by design,
consistent with the per-feature-flag pattern v7 established (`verify.enabled`,
`degrade_on_provider_error`, `descending`, `freedoms`, `challenge.enabled`). Neither should be
built from this document alone; both need their own planning-cycle debate, matching the process
v7 itself went through.
