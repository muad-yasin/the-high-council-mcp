# MLLM Coder v2 — differentiation, framings, and cut list

This document covers the prose-only portions of MLLM Coder v2: how the debate mechanism
compares to OpenRouter's `openrouter/fusion`, why the same interchangeability mechanism serves
two different audiences, why proposer and critic seats must stay on different labs, what v2
changes in `src/chain.js` and `src/tools.js`, and what is explicitly not being built. v2's whole
scope is interchangeability of which model or router fills a seat — nothing about the governed
unit, the write-tool prohibition, or the debate protocol from v1 is reopened here.

No section below makes any comparative quality claim about this project's debate mechanism
against a single model, against Fusion, or against any other tool surveyed for this plan. The
claim made throughout is narrower: a differently-shaped, more governed mechanism exists, and it
is already built and tested for non-coding tasks.

## 1. Fusion, compared in this project's own words

`openrouter/fusion` is **parallel fan-out, then curate**: each of its panel models (one to eight)
answers the same prompt independently and in isolation. None of the panel models ever sees
another model's answer before finalizing its own. A separate analyst model then reads all the
answers and produces one JSON output describing consensus, contradictions, coverage gaps, and
blind spots. It is a single pass, and there is no interaction between the panel models at any
point in that pass.

This project's coder-gate mechanism is **cross-read, object, reply, until convergence**.
Proposals start blind, the same fan-out shape Fusion uses — but from there every participating
lab reads the other labs' proposals and posts support, objection, or a proposal to merge; the
original author of each proposal then replies to keep, amend, or withdraw it under that pressure;
and the run does not finish until every seat signs off unanimously or a configured round cap is
hit. The Resource Allocator then spends additional scrutiny specifically on the points labs
actually disagreed on, rather than re-running the whole board evenly. Fusion has the "many
models, one question" shape coder-gate also starts from, but it skips the debate itself: no
cross-reading, no objection-and-reply cycle, and no requirement that the panel converge before
an answer is returned.

Concretely, what coder-gate already has that Fusion's own documented behavior does not:

| Fusion | This project's coder-gate |
|---|---|
| Single round: panel answers once, analyst compares once | Multi-round debate: disagreement can trigger further rounds until signoff or the round cap |
| No signoff protocol — the analyst reports disagreement, it does not resolve it | Unanimous-signoff gate: a diff is not accepted until every critic seat signs off or the round cap is hit |
| No disagreement-targeted re-open | The Resource Allocator routes extra rounds specifically at the claims seats actually split on |
| No spend cap | Every run has a configured, enforced USD spend cap |
| No policy gate | A policy file gates allowed providers, regions, and tags before a run starts |
| No audit trail | A hash-chained audit log is exported per run |
| One JSON object returned per call, nothing persisted | A resumable, inspectable run folder holding proposals, debate posts, replies, and signoff records |

This comparison makes no claim about the quality of code, or of any answer, produced against
Fusion's fan-out-then-curate approach. It is a claim about mechanism shape only: unanimous
convergence with a disagreement-targeted re-open is a structurally different thing from a
single-pass fan-out with after-the-fact synthesis, and this project already has the former,
built and tested for non-coding tasks.

**On what v2 does with Fusion itself.** v2 does not build a version of coder-gate's own
mechanism modeled on Fusion's fan-out-then-curate shape, and it does not add a "many models
answer, one model curates" mode anywhere in coder-gate. Fusion is used in this plan only for two
things: as the competitive-differentiation point above, and as one available underlying
transport a seat's `model` field may reference (see §2 below) — never as an architecture this
project's own debate mechanism should start resembling. The debate protocol stays this project's
identity; OpenRouter's routers, including Fusion, are plumbing a seat's configuration may point
at, nothing more.

## 2. One mechanism, two framings

v2's mechanism is a seat's existing `model` field gaining the ability to reference more than a
single plain model id — a plain id, an array of ids interpreted through OpenRouter's own
provider-array fallback, or a routing-param route such as a Pareto-style code-quality selector.
That is one mechanism. It reads to two different audiences as two different value propositions,
not as two different features:

- **Vibecoder framing.** Try a cheaper or newer model for a coder-gate seat by editing one config
  line. No code change, no new tool to learn, no new concept beyond editing a field that already
  exists. This is pure cost and speed convenience under the existing bring-your-own-key model —
  useful for anyone experimenting seat by seat without committing to one vendor up front.

- **Enterprise framing.** Model choice survives a pricing change, a capability regression, a
  provider outage, or a compliance finding against a single vendor, without an architecture
  rewrite. This is vendor-lock-in avoidance, not cost optimization. A 2026 CIO survey figure
  gathered for this plan's research is relevant here: 37% of enterprises now run five or more
  models in production, up from 29% the year before — read as evidence that running multiple
  models in production is already a deliberate risk posture at many organizations, not a
  hypothetical this plan invents.

Both framings describe the same `model` field mechanism. No config knob exists for only one of
these two audiences; the mechanism does not change shape depending on who is using it. It is one
mechanism, described for two audiences — not two features stacked on top of each other.

## 3. Why proposer and critic must stay different labs

The literature on LLM-as-judge behavior surveyed for this plan (arXiv:2510.24367) documents that
a model tends to rate its own output more favorably than an independent judge does, and shows a
family-level preference bias — a judge favoring certain model families over others regardless of
measured quality. This is independent, external support for a rule this project already enforces
and that v1 already assumed without needing to state the research behind it: **the proposer seat
and the critic seat for a governed diff must never be filled by the same lab.**

v2 makes it easier to change which model fills any given seat, through the `model` field
mechanism described above. This research is the reason that rule stays strict rather than being
relaxed for convenience — for example, routing both a proposer seat and its critic seat through
the same cheapest available model just because a routing param made that easy to configure. This
section introduces no new scope on its own: no new config field, no new automated check, no new
code path. It is grounding for a rule that already exists, enforced by config review exactly as
it is enforced today, not by any new validation logic v2 adds.

## 4. Chain and tool impact statement

`src/chain.js` and `src/tools.js` require no changes for v2. All of v2's interchangeability is
config-level: a seat's `model` field takes on additional shapes — an array, or a routing-param
route — that are interpreted entirely by the existing OpenRouter adapter and, where the adapter
needs it, a schema file describing which shapes are valid. The one file under `src/` that v2's
implementation may touch is `src/providers.js`, and only additively — a small, verbatim
pass-through, contingent on whether the adapter's own capability inventory finds it is needed at
all. If that inventory finds the adapter already forwards extra per-seat configuration keys,
`src/providers.js` is untouched too, and v2 makes zero changes anywhere under `src/`.

Worst case, the full list of files v2 touches: `src/providers.js` (additive pass-through, only
if the capability inventory shows it is needed), a new chain configuration file for the v2 seat
shapes, a new schema file describing the allowed `model` shapes, this document (or an equivalent
section in an existing doc), and a set of new offline test fixtures with their accompanying test
files. `src/chain.js` and `src/tools.js` are not on this list under any outcome of v2's build.

Touching `src/providers.js` at all is a genuinely bigger step than v1 took — v1 needed zero code
changes anywhere because it governed one pre-named model at one seat. v2's whole scope is
interchangeability of which model or router fills a seat, and the adapter is the one seam where
a seat's configuration becomes an actual OpenRouter request, so a small, additive pass-through
there — if it turns out to be needed at all — is the minimal step consistent with not
reintroducing model-selection or fallback logic into `chain.js`. That is stated here explicitly
rather than left implicit, because an unconditional "no code changes anywhere" claim would be
false if the pass-through ships.

## 5. Cut list

Explicitly excluded from v2, by name:

- **Any write-capable tool.** v1's decision stands: applying a diff to a real working tree stays
  a human or external-session action, never something this project's own process does.
- **Any subscription-OAuth orchestrator-seat feature.** Documenting or offering "plug in your own
  subscription as an automated seat" as a supported pattern is excluded outright, not deferred to
  a later version, on terms-of-service grounds already recorded for this project. Ordinary
  interactive use — a person manually running their own coding-assistant session to answer one
  paused stage, which this project already does today — is a different, lower-risk shape and is
  unaffected by this exclusion.
- **Any new agent loop built from scratch.** No file-editing tool, no iterate-until-tests-pass
  cycle, no new context-management story. v1's scoping-away of this stands unchanged.
- **Any paid comparison benchmark.** No benchmark run of any kind measuring this mechanism's
  output quality against Fusion or against any other tool surveyed for this plan.
- **Multi-file or multi-hunk change requests, and a programmatic diff-syntax parser.** Carried
  forward unchanged from v1's own cut list.
- **A version of coder-gate's own debate mechanism modeled on Fusion's fan-out-then-curate
  shape.** Per §1 above: Fusion is used in this plan only as a differentiation point and, for its
  routing primitives specifically, as one available transport — never as an architecture this
  project's own debate mechanism should imitate. No "many models answer, one model curates" mode
  is added anywhere in this plan.
