# Evaluation design: does The High Council beat one good model?

Status: **DESIGN ONLY. No runs authorized. No code written.** This document is itself the
deliverable requested by cnc-harness-a7, per Muad. Real runs need a separate, explicit go from
Muad; they will cost more than anything run tonight.

## 0. Why this exists, stated once

An external research analysis Muad supplied
(`~/Downloads/compass_artifact_wf-dc24df3f-385a-58d6-99a8-3442774102ca_text_markdown.md`) makes
one finding that reorders this project's priorities: **the central premise - that multi-model
debate improves open-ended decisions - is unproven, and the current literature is actively
skeptical of it on exactly the kind of no-ground-truth task THC exists to help with.** We have
never measured whether The High Council beats one good model. This document designs the
measurement. It does not run it.

**Citation spot-check, done tonight, not skipped:** three of the source document's most
load-bearing citations were checked live against arXiv/search rather than trusted on sight -
Wynn/Satija/Hadfield "Talk Isn't Always Cheap" (arXiv 2509.05396), "The Deliberative Illusion"
(arXiv 2606.03032, Wan et al.), and "The Cost of Consensus" (arXiv 2605.00914, Bertalanič &
Fortuna) - all three are real, current papers whose actual abstracts match the claims made about
them. ArchBench (arXiv 2603.17833) was also checked and is real: a 1000-document, five-project
benchmark with an existing automated scoring pipeline (BERTScore/ROUGE/BLEU/METEOR). The
remaining ~10 citations in the source document were not independently checked (time-bounded, not
skipped out of confidence) - Du et al. and Khan et al. are well-established prior results I have
high independent confidence in; the GDPR/§201 StGB legal citations are out of scope for this
document; the rest should be spot-checked before any of their specific numbers are quoted
publicly, per the source document's own caveat.

## 1. The reframe that changes the design (Muad, relayed 2026-09-14)

The literature indicts **convergence**, not **collaboration**. Sycophantic conformity, anchoring,
and stance homogenization are all failure modes of models *persuading each other into agreement*
- five voices becoming one, usually the most confident one. That is a different mechanism from
five different strengths being *combined* without requiring mutual persuasion at all, and nothing
in the literature says combining independent strengths is harmful - the founding debate results
(Du et al., Khan et al.) and the newer critiques agree on this: independent-first-round diversity
is the part that plausibly helps, and it is *successive rounds of mutual exposure* where accuracy
decays.

THC's own pipeline already contains both mechanisms, bolted together, and this evaluation is
designed to tell them apart rather than average them into one win/lose number:

- **Blind parallel proposals** - complementarity. Five labs, no contact. Closer to Delphi /
  wisdom-of-crowds than to debate. This is the part the research suggests *should* work.
- **Debate and reply rounds** - mutual persuasion. This is precisely where the literature says
  accuracy decays over successive rounds.
- **Integration by a single builder** - aggregation without conformity (the builder synthesizes;
  it does not vote or average).

**Consequently this is not designed as "council vs. one model."** It is designed to isolate which
*stage* of THC's own pipeline earns its cost, with the binary comparison as one output among
several, not the headline.

## 2. Arms

All arms run against the same task and are matched to the same USD budget as the full council run
on that task (see §5 for how matching is computed). Arm numbering matches the brief.

| # | Arm | What it is | What it isolates |
|---|---|---|---|
| 1 | Single model, one shot | The strongest single available model, zero-shot plan, no extra sampling | The floor - what one call gets you |
| 2 | Self-consistency | Same model, k independent samples at matched budget, majority/best-of synthesis | Extra *compute* without cross-model diversity or persuasion |
| 3 | Self-critique | Same model: draft -> self-critique -> revise, matched budget | Extra *reflection* without another mind in the loop |
| 4 | **Blind proposals + integration, no debate** | Five labs propose blind, exactly as today; skip debate/reply entirely; one seat integrates the surviving proposals directly | **Complementarity alone** - cross-lab diversity without mutual persuasion |
| 5 | **Full current chain** | Proposals + debate/reply rounds + integration + panel, as THC ships today | Complementarity **and** persuasion, bolted together, exactly as a real user gets it |
| 6 (stretch) | Full chain, extended debate | Arm 5 with the round cap raised (e.g. 2x today's default) | Whether the literature's round-over-round decay is visible in **our own data**, not just theirs |

Arm 4 vs. arm 5 is the single most actionable comparison in this design, not a side note. **If
arm 4 matches or beats arm 5 at equal or lower cost, that means we are paying for the stage that
plausibly hurts (debate) and getting our benefit from the stage that is cheap (blind proposals).**
That would directly justify shipping a "quick council" chain (proposals + integration only, no
debate) as the new default, with debate demoted to opt-in. Arm 6 exists to see whether the
decay curve the literature reports (accuracy declining round over round) shows up in THC's actual
output when we deliberately push past today's round cap - if it does not, that is also a real and
reportable finding, not a null result to bury.

**Not an arm, but instrumented on every run**: THC's own panel signoff (`report.json`'s `passed`
field and the independence-skew report, `verdict_stats`/`--stats`, already built) is recorded for
every arm that has one (4, 5, 6), but is *never* used as the quality signal for scoring an arm -
it is the thing partly under test. Using it to grade itself would be circular in the most literal
sense.

## 3. Tasks - three sets, because a benchmark that only measures the easy case proves nothing

The crux, stated plainly: THC's own planning tasks have no ground truth, which is exactly why
debate might not help on them and exactly why they are the hardest, most honest test. A single
task type either overclaims (if it is the one case debate happens to help) or underclaims (if it
is the one case debate happens to hurt). Three types, each with a named, different failure mode
of its own:

### Task Set B - checkable planning-to-code (primary, least circular)

**What it is:** a small, held-out feature specification (never seen by THC or any baseline model
before this run). Each arm produces a *plan*, not code. A single, fixed, cheap downstream
implementer (one model, low temperature, no debate, identical prompt and budget for every arm)
builds strictly from that plan alone. The resulting code is graded against a **hidden test suite
the planner never sees**, written in advance by a human (or a separate model that never
participates in any arm) before any plan exists.

**Why this is the headline signal:** grading is pass/fail against tests, not another LLM's
opinion. This is the least-circular measurement available to us without paying for human raters,
and it directly operationalizes "did the plan lead to a better outcome" rather than "did a judge
like the plan."

**What it does NOT measure:** whether the plan is good along axes tests cannot check (is the
chosen approach maintainable, does it fit the existing codebase's conventions, is the scope
right). A plan that produces test-passing code by accident, or by narrowly gaming the visible
tests, would score well here without being a good plan. Task selection (below) tries to reduce
this by choosing specs with a broad, non-trivial hidden suite, not a handful of easy assertions.
This is a real, named, unmitigated residual confound - narrowing it further would mean either a
much larger hidden suite (more Stage-1 cost) or human review of each build's approach, not just
its test result (which reintroduces a judge). Carried into Stage 1 as a known limitation, not
solved by this design.

**Two implementation details fixed here, in response to `sower-review:scope-gate`'s review of
this design (both were previously implied, not stated):**
- **The downstream implementer model is chosen and locked before any plan exists for any task**,
  by whoever authors Task Set B's specs (see Task sourcing, below) - the same person/process that
  writes the hidden tests, and specifically NOT by whoever configures the council/baseline arms.
  It must not be a model that also sits in any arm being compared, for the same reason the judge
  models in §6 are excluded from every arm they judge.
- **Grading is mechanical (test pass/fail) and the grading process is blind to arm identity by
  construction**, not by discipline: the harness must run each arm's build through the identical,
  unmodified test command and record only file-existence-and-pass-rate as the raw output columns
  before arm labels are ever joined back on for reporting - so "blind grading" is a fact about the
  script's own architecture (labels attached only in a post-processing pass), not a promise about
  the process.

**Task sourcing, and the contamination problem named plainly:** several of THC's own recent
phases (v5, v6 tonight) were literally *planned by THC itself*, using models likely to sit in
these baselines - reusing them verbatim would let a model "recognize" work it effectively already
did. Task Set B must be **freshly authored for this evaluation**, not drawn from THC's own run
history, and ideally specified by a human (Muad) or a model that will not appear in any arm.
Target: 15-20 small, self-contained specs (a single utility module, a small CLI subcommand, a
small data-transform function) - big enough to have a real planning decision in them (which
approach, what to validate, what the interface looks like), small enough that a fixed implementer
can build from any arm's plan in one pass without needing follow-up questions.

### Task Set A - ArchBench ADR-generation (quasi-ground-truth, external, public)

**What it is:** 1000 architectural documents across five open-source projects (ArDoCo-sourced),
each pairing a design problem with the ADR that project's real maintainers actually adopted.
Score with ArchBench's own pipeline (BERTScore + rationale-quality judging) against the *real,
adopted* decision - a genuine external ground truth, in the weak sense that it is what actually
happened, not what a judge merely prefers.

**Why include it:** it is the closest public analog to THC's actual target use case (architecture
decisions) and comes with scoring infrastructure we do not have to build. It lets us report a
number against a benchmark other tools could in principle also be run against, which the
Priority-1 gate in the source research explicitly asks for.

**What it does NOT measure:** closeness to the real adopted decision is not the same as "the
better decision" - the real maintainers could themselves have chosen wrong, and BERTScore rewards
surface/semantic similarity to that specific text, not correctness in any absolute sense. It also
carries a **contamination risk stated plainly**: ArchBench has been public since roughly March
2026; a frontier model trained or updated after that date may have seen these exact
problem/decision pairs during pretraining, which would inflate every arm roughly equally (not
selectively favor THC) but would inflate the absolute numbers and should be disclosed alongside
any result from this task set. Sample ~15-20 documents, not all 1000, to bound cost (§6).

### Task Set C - our own real tasks, proxy outcome (ecologically valid, weakest signal)

**What it is:** a handful (~8-10) of real planning tasks drawn from *before* tonight's v5/v6
work - old enough that the specific models in play tonight are unlikely to have been shaped by
having planned them, but recent enough that we have real operational data about them. **Outcome
is a pre-registered proxy, not a strong ground truth**: whether an independent `sower-review:
bug-audit` pass (or, for tasks without one, a fresh one run specifically for this evaluation)
found a real, confirmed defect in what was actually built from the plan, within a fixed window.
Fewer confirmed defects is scored as a better outcome; this is explicitly a *proxy for decision
quality*, not decision quality itself - a plan could be defect-free and still have chosen the
wrong feature to build, which this proxy cannot see.

**Why include it despite the weak signal:** it is the only task set drawn from THC's actual,
real-world use, rather than a benchmark or a synthetic spec. Small n and retrospective design
mean this set should never carry a pre-registered win/loss threshold on its own (see §7) - it is
reported as a supporting, descriptive number, not a decisive one.

## 4. Instrumentation already built, reused rather than rebuilt

This evaluation is not starting from nothing. Tonight's own work already ships the measurement
primitives it needs:

- **`verdict_stats`/`--stats`'s independence-skew report** (v5) - per-lab novel-objection rate and
  solo-signoff rate. Reused here as the **posture-diversity** signal: does each arm's proposal/
  debate stage actually produce independent objections, or does one lab's view dominate?
- **`src/role-diagnostics.js`'s `pairwiseAgreement`** (v6) - mean textual overlap between
  different labs' posts on the same proposal. Reused directly to quantify **stance
  homogenization** across debate rounds (arm 5) and, for arm 6, whether it *increases* round over
  round - the literal signature the literature reports.
- **`report.json`'s `passed`/panel signoff** - recorded, never scored, per §2.

**What tonight's own real run already showed, in miniature, and what this evaluation is built to
generalize:** the 2026-09-13 persona-seat run (`2026-09-13T22-18-38-117Z`) saw *posture* diversity
survive (GLM/integrator merged proposals 7 of 10 times, MiniMax/adversary had the lowest support
rate on the board and caught the sharpest objection) while *verdict* diversity did not (the panel
converged unanimously on round one). That is posture surviving, verdict homogenizing - in one
uncontrolled data point. This design turns that observation into a measured, repeated,
pre-registered comparison instead of an anecdote.

## 5. Measurement-validity dependency (a requirement this design has, not part of the design itself)

**Labeled explicitly per `sower-review:scope-gate`'s review**: this document is a design, and the
items below are engineering work, not design work. They belong on a separate, small, already-
scoped ticket - stated here only as a hard *prerequisite* this evaluation depends on, not as
something this design document builds. Two real bugs found tonight (`~/Projects/Ideas.md`,
"Harness defect found 2026-09-13 evening" and the v7 backlog's rank-1 items) would bias any
quality signal derived from THC's own panel, in a direction that cannot be predicted in advance:

1. **Unevidenced FAILED verdicts are synthesized by our own code**, not merely passed through -
   `normaliseCritique()` manufactures a failure entry from a criterion's `evidence` field whenever
   a critic marks a criterion FAILED with no matching `failures[]` entry, even when the critic's
   own prose reverses to MET. This makes `passed:false` untrustworthy in exactly the direction
   that would make arm 5 (full chain) look *worse* than it is, or - if the bug interacts
   differently across arms - bias the comparison in an unknown direction.
2. **The partial-output safety check is schema-mismatched** (`src/stage-contract.js`'s PANEL
   contract checks `verdict`/`objections`; real panel replies use `meets`/`criteria`/`failures`/
   `verdict_line`) and fires as a false positive on every panel call - noise that could mask a
   real partial-output failure during the evaluation itself.

**Both must be fixed and regression-tested before Task Set B/A/C tasks are ever run**, using the
same discipline as every other fix tonight: fixed and tested against the *existing* offline
suite, not tuned against the evaluation's own tasks (which must stay unseen until the pre-
registered run). This is a correctness fix, not evaluation-tuning - the distinction matters and
should be stated in the eventual write-up so nobody reads the fix as having been made to help
THC's score.

## 6. Who judges

Ranked by circularity, least first:

1. **Task Set B's hidden test suite.** Not an LLM. Pass/fail (or a pass-rate score) against tests
   written before any plan exists, by a human or a model excluded from every arm. **This is the
   least-circular option available to us and is the primary judge wherever it applies.**
2. **ArchBench's own automated scoring** (Task Set A) - BERTScore against a real, external,
   already-adopted decision. Not our judge, not an LLM chosen by us, but still an automated
   text-similarity metric, not a correctness check - residual circularity is low but non-zero
   (BERTScore's own biases, e.g. toward similar phrasing/length, are not THC's biases, but they
   are still *a* model's biases).
3. **A rotating blind LLM-as-judge**, used only where 1 and 2 don't apply (Task Set C's plan
   quality where the defect-proxy signal is silent, and as a secondary read on Task Sets A/B
   alongside their primary judges). Judge model(s) must be **excluded from every arm being
   compared** in that run, and rotated across tasks so no single judge's idiosyncrasies dominate
   the aggregate. **Residual circularity, stated plainly and not engineered around:** an LLM
   judge, even a fully independent one, carries its own documented biases - toward longer,
   hedged, more "confident-sounding" answers - and multi-model synthesis (arms 4/5/6) plausibly
   produces exactly that shape of output more often than a single-model baseline does. The
   direction of this bias relative to THC is not knowable in advance; it is named here so a
   result that favors the council is read with that caveat attached, not presented as clean.
4. **THC's own panel** - named for completeness, explicitly **not used as a judge of any arm's
   quality** anywhere in this design, for the reason stated in §2: it is what is partly under
   test.
5. **A small human spot-check (Muad), optional, cheap, valuable as a calibration check** - a
   random ~10% sample of Task Set B/C outputs, blind-labeled (arm identity hidden), rated by
   Muad against the LLM-judge's verdict on the same items. Not proposed as the primary judge (one
   person, solo-operator constraint, cannot scale to the full task set) but a real, low-cost check
   on whether the LLM judge's numbers are trustworthy at all.

## 7. Headline numbers and the decision rule - pre-registered before any run

**Primary headline: arm-4-vs-arm-5 win rate and cost-per-quality**, on Task Set B, using the
hidden-test pass rate. This is the actionable number - it tells us whether debate is earning its
keep, not just whether five labs beat one.

**Secondary headline: arm-5-vs-{1,2,3} win rate and cost-per-quality**, the binary "does the
current shipped chain beat a well-resourced single model" question the brief asked for,
reported on all three task sets with each task set's own judge (§6), never blended into one
number across sets.

**Diagnostic numbers, reported alongside every headline, never buried:**
- **Decision-flip rate**: on Task Set B (where it's checkable), how often does arm 5's final plan
  differ materially from arm 1's single-shot plan, and was the flip toward a higher or lower
  test-pass rate? This is plausibly the single most informative number this evaluation can
  produce - it directly tests for the literature's most damaging documented pattern (correct
  answers flipped to incorrect via peer pressure), not just an aggregate score.
- **Posture-diversity vs. verdict-diversity gap** (§4): independence-skew and pairwise-agreement
  numbers for arms 4/5/6, to see whether (and by how much) verdict homogenizes even when posture
  does not - generalizing the one real data point already observed.
- **Round-over-round accuracy curve for arm 6**: does an extra round of debate move Task Set B's
  test-pass rate up, down, or not at all, direction and magnitude both reported.

**Pre-registered thresholds, committed before any task is run** (numbers below are a first draft
for Muad/cnc-harness-a7 to sharpen, not treated as sacred - what matters is that *some* numbers
are committed in writing before data exists, the same discipline `test/quality-probe/` and the v6
role-experiment harness already used):

- **Arm 5 (full chain) WINS against the best of arms 1-3** if its Task Set B hidden-test
  pass-rate is at least 5 percentage points higher, cost-matched, AND its Task Set A/C judge
  score is not more than a small tolerance worse. Task Set B is the tie-breaker whenever B and
  A/C disagree - stated here, in advance, specifically so nobody can pick whichever set looks
  better after seeing the results.
- **Arm 5 LOSES** if its Task Set B pass-rate is equal to or lower than the best of arms 1-3,
  regardless of what Task Set A or C say.
- **Arm 4 (complementarity only) EARNS ITS PLACE AS THE NEW DEFAULT** if it matches or beats arm
  5 on Task Set B at equal or lower cost - this is evaluated and reported independently of
  whether arm 5 wins or loses against the single-model baselines, because it is a comparison
  *within* THC's own mechanism, not THC-vs-outside.
- **INCONCLUSIVE** if Task Set B's sample size cannot distinguish a 5-point gap from noise at
  reasonable confidence (a quick power check before committing to a task count - with ~15-20
  tasks and binary-ish pass/fail outcomes, a 5-point true difference is a small-to-moderate
  effect that this sample size can plausibly miss; if Muad wants a firmer answer, the honest fix
  is more tasks, not a lower bar) - and inconclusive is reported as inconclusive, not rounded up
  to a win.

**The design is capable of producing "we lose," stated explicitly, not assumed:** nothing in this
design adds an arm, a judge, or a task set only after seeing a result; the decision rule is fixed
before data exists; Task Set B's hidden tests cannot be argued with after the fact the way an
LLM-judge's preference sometimes can; and the priority rule (B overrides A/C on conflict) is fixed
in the direction of the *harder* evidence, not the more flattering one.

**Freeze mechanism, added in response to `sower-review:scope-gate`'s review of this design** (the
gate correctly found that "pre-registered" was asserted here but not mechanically enforced
anywhere): the thresholds above are a first draft, open to sharpening per §10, until Stage 0's
pilot tasks are drafted. The moment Task Set B's first pilot spec is written, **the numbers in
this section are copied verbatim into a new, separate file, `docs/eval-prereg.md`, committed to
git with a commit message stating the exact date and that this is the frozen version** - after
that commit, this section of `eval-design-v1.md` is historical context, not the live threshold;
any change to a threshold after that point requires a new, separately-dated commit to
`eval-prereg.md` with a stated reason, and any such change made *after* seeing Stage 0 or Stage 1
data must be disclosed in the eventual write-up as a post-hoc revision, not silently folded in as
if it had always read that way. This makes "no post-hoc threshold shopping" a property of the git
history, not a promise in prose.

## 8. Cost estimate (design-time estimate only; real pricing to be confirmed at pilot time)

Rough order-of-magnitude, not a quote. The one verified real anchor is `docs/v6-decisions.md`'s
recorded **$0.4747/run** `--dry-run` worst-case estimate for a real 5-lab debate chain
(`chains/plan-debate-roles-c1.json`) - a *worst-case* full-round-cap number, not an expected one.
The per-task figure below (~$0.75) is that anchor multiplied by a rough 1.5x margin for: this
evaluation's tasks may run more rounds on average than that one chain's clean-early-signoff
expectation, and Task Set B's arms include baselines (self-consistency, self-critique) whose
matched-budget calls are new call shapes with no real anchor yet. Stated as a margin over a real
number, not a second independent guess - and re-confirmed against real pricing at Stage 0, before
Stage 1's larger spend is committed.

| Component | Rough cost |
|---|---|
| Task Set B: 15 tasks x 6 arms x 2 replicates x ~$0.75 (matched-budget calls) | ~$135 |
| Task Set B: downstream implementer build+test, 15 x 6 x 2 x ~$0.20 | ~$36 |
| Task Set A: ~18 sampled ArchBench docs x 6 arms x ~$0.60 (single-pass, no replicate) | ~$65 |
| Task Set C: ~9 tasks x 6 arms x ~$0.60 | ~$32 |
| LLM-judge calls across all sets (rotated judges) | ~$40 |
| **Total, first pass** | **~$300-350** |

**Recommended staging, cheaper than committing to the full number above at once:**
- **Stage 0 - pilot, <$20**: 3 Task-Set-B tasks, arms 1/4/5 only, no replicates. Purpose:
  validate the harness mechanics (matched-budget computation, hidden-test grading, judge
  pipeline) actually work before any real evaluation spend, the same "prove the plumbing first"
  discipline the v6 role-experiment harness used with mock seats before anything real ran.
- **Stage 1 - the real evaluation, ~$300-350**, only after Stage 0 confirms the harness is
  correct, and only with Muad's explicit go.

## 9. What this design does NOT do (named, not silently out of scope)

- Does not touch Sophi-A / voice readiness at all - the source research is explicit that voice
  work should not start until this evaluation shows the council adds value, and nothing here
  assumes an answer in advance.
- Does not build the tool-grounded verification stage (source research's Priority 2) - that is a
  separate, likely-higher-value engineering item this evaluation's results should inform the
  sequencing of, not a prerequisite for running it.
- Does not run anything. Task Set B's specs are not yet written; ArchBench documents are not yet
  sampled; Task Set C's task list is not yet chosen; the two measurement-validity bugs (§5) are
  not yet fixed. All of that is real, separate work this design authorizes planning for, not
  spend for.

## 9a. Pre-mortem: the most likely way this produces a result nobody trusts or acts on

From `sower-review:scope-gate`'s adversarial review, kept here rather than left in a review
transcript, since both are real risks about what happens *after* the design is sound:

- **It never gets past Stage 0.** Task Set B's spec-authoring and the §5 bug fixes both currently
  have no owner or date attached, and this project already has several open, blocking items
  competing for attention. The base-rate failure for "we'll evaluate ourselves honestly" work on
  a small team is not a bad design, it's the pilot quietly losing priority to the next fire.
  Mitigation: §10 below names owners; if this stalls, that stall is itself information worth
  reporting, not silently absorbed.
- **It produces a technically clean but politically ambiguous result** - e.g. arm 4 ties arm 5
  inside the INCONCLUSIVE band - and the honest "we can't tell yet" result gets quietly overridden
  in practice by sunk-cost pressure to keep shipping the existing multi-round chain anyway,
  because it "feels more thorough." The document's decision rule guards the *number*; nothing
  guards the human decision that happens after the number. Naming this now is the only defense
  available at design time - the rest is a discipline question for whoever reads the result.

## 10. Decisions left to Muad / cnc-harness-a7

- Sharpen or accept the pre-registered thresholds in §7 (the 5-point margin, the tolerance on
  A/C, the sample sizes) before Stage 0.
- Confirm Task Set B's spec-authoring approach: Muad writes them by hand, or a model excluded
  from every arm writes them (and who checks that model has no other role in this project).
  Author the hidden tests separately, before any plan exists, however specs are sourced.
  Author the fixes to the two bugs in §5.
- Approve or adjust the total spend ceiling (§8) - this document proposes $20 for Stage 0 and
  ~$300-350 for Stage 1, both design-time estimates that should be re-confirmed against real
  provider pricing before any run.
- Whether arm 6 (extended debate rounds) is worth its extra cost in Stage 1, or held for a later,
  cheaper follow-up once arms 1-5 have already answered the higher-priority questions.
