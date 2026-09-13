# v6 build decisions

## Phase 1 - seat-role mechanism

- **Debate stage identified as `debateUser`/`R.DEBATE_SYSTEM` in `src/chain.js`/`src/roles.js`**
  (the proposal-debate posts stage: support/object/merge with reasoning), and panel stage as
  `criticUser` (the blind grading that sets `report.json`'s `passed`). The plan's own text used
  "debate stage" and "panel stage" generically; this is the concrete mapping onto the real
  codebase, made once here rather than re-derived per phase.
- **Role augmentation applies to the debate-stage SYSTEM prompt, not the user prompt.** The
  system prompt already varies per invocation (it's a plain string passed to `invoke`), so
  appending a per-seat block there is additive and doesn't require restructuring
  `debateUser`'s own signature (which takes `lab`, not a seat object, and stays that way).
- **Golden-hash test uses a hardcoded SHA-256 literal**, computed once against the unmodified
  `DEBATE_SYSTEM` constant before this diff touched `chain.js`, rather than a hash the test
  recomputes from the code under test. A self-referential golden hash can't catch the code
  drifting; a literal committed value can.
- **`applySeatRole` is a pure function with no chain-lint dependency of its own** -
  `validateSeatRole` lives in the same file and is called separately from `chain-lint.js`,
  matching v5 candidate 5's existing lint-check pattern (one check per concern, each returning
  `{kind, message, fix}`).
- **Phase 2's structural guard (role-stripped panel projection, single-call-site scan) is not
  built in phase 1.** Phase 1's wiring only ever calls `applySeatRole` from the debate-stage
  call site in `chain.js`, so the panel stage is unaffected by construction already - phase 2
  adds a second, independent guard against a future careless edit, which is real defense-in-depth
  work, not redundant with phase 1.
- **Persona names are lowercase-hyphenated identifiers** (`moses`, `van-gogh`, ...) rather than
  the display-case names in the plan's prose, since `role.persona` is a config value, not
  display text - phase 6 (public naming config, not built yet) is where a persona identifier maps
  to its display name and voice directive text.

## Phase 2 - stage isolation (§3)

**Reasoned deviation from §3's own text, recorded rather than silently skipped**, per the release
owner's explicit invitation to argue a deviation instead of transcribing both halves of the plan
faithfully: this phase does NOT build KIMI-3's role-stripped panel-seat projection
(`seat.without_role()` passed to the panel builder). It builds the single-call-site static scan
(GLM-2) plus two additional source-level guards, all four enforced as tests that fail loudly in
CI - `test/stage-isolation.test.js`.

**Why the projection is redundant here, not merely unbuilt:** the projection's whole point is to
strip `role` off a seat object before it reaches the panel-stage prompt builder, so that even a
careless future call site has nothing to leak. But the actual panel-stage prompt builders in this
codebase - `criticSystem(open)` and `criticUser({ request, criteria, draft, prior })` - take no
seat object, and no `role` field, as a parameter at all, today, independent of anything this
candidate built. There is nothing to strip. Building the projection pattern here would mean one
of two things: (a) doing nothing, since there's no seat parameter to strip it from, or (b) adding
a seat/role parameter to `criticSystem`/`criticUser` specifically so this phase could then
demonstrate stripping it - which would be inventing the exact new call site this phase exists to
prevent, not closing one. Phase 1 already achieved §3's guarantee by construction (`applySeatRole`
is only ever called from the debate-stage invoke); the failure mode phase 2 defends against is a
*future* edit accidentally adding a second call site or a seat/role parameter to the panel
builders - which is exactly what the four tests below catch, and what a projection pattern on
functions with no seat parameter cannot catch any better than not having the parameter in the
first place.

**What was built instead, all as CI-failing assertions, not documentation:**
1. `applySeatRole` has exactly one call site across every `.js` file under `src/` (a full source
   walk, not just `chain.js` - a second call site added anywhere would fail this).
2. That one call site's surrounding source is confirmed to sit inside the `debate-${lab}` labeled
   block, and confirmed absent from any `panel-`/`critique-`labeled block's surrounding source.
3. `criticSystem`'s and `criticUser`'s own function-definition source spans are scanned and must
   contain no reference to `role` in any form and no call to `applySeatRole` - and `criticUser`'s
   own parameter-destructuring line specifically must not accept a `role` field, so a future edit
   would have to change a line this test reads before it could wire a role in.
4. `src/roles.js` (where every prompt, debate and panel alike, is actually built) never imports
   `applySeatRole` at all - only `chain.js`'s one debate-stage call site may call it.

Verified these guards actually catch a regression rather than passing vacuously: temporarily
added a second `applySeatRole` call to the panel-stage call site locally, confirmed guard 1 fails
loudly (`not ok`), then reverted. Not committed - a manual verification step only, recorded here
so it doesn't have to be repeated to trust the guard.

## Phase 5 - failure-mode detectors (§7), reconsidered against Muad's corrected framing

Muad's own words, relayed 2026-09-13: "It's not about catching planted bugs. It's about
philosophy of different models in software infrastructure. They will just roleplay and talk
differently. But still talk about the different ideas." The phase 4 measurement harness (§5)
answers a real question - does lens-routing change what a deterministic heuristic probe catches
- but that question is not this feature's purpose. A heuristic mock cannot have a philosophy, so
phase 4's NEGATIVE result (lens-routing showed no benefit on the probe's defect-catch fixtures)
does not mean the feature failed. Persona was modeled as zero-effect by construction in phase 4
and was never measured at all. Neither result speaks to debate diversity among real model seats,
which is what the feature is actually for. This is not a rationalization written after the fact -
it is exactly what `test/quality-probe/role-experiment.js`'s own `LIMIT` constant already says,
independent of and before this framing correction arrived.

**Two of §7's four detectors originally read per-seat data from the phase 4 probe**
(role-correlation collapse compared against the probe's plain-arm baseline; a role degrading a
weaker model, read as a catch-rate delta from the probe's results). Per the instruction to
reconsider rather than wire dutifully: **both are redesigned here to read a real run's own debate
output (`report.debate.posts`) instead of the phase 4 probe**, so all four detectors measure
something the feature's actual purpose can be judged by:

1. **Character-performed-not-reviewed** (kept, same intent as §7's original) - `substanceRatio`
   per seat: the fraction of a seat's `object`/`merge` debate posts that contain a quoted span,
   since `DEBATE_SYSTEM`'s own system prompt already requires quoting the phrase being objected
   to or merged. A seat that never quotes despite the prompt asking for it is roleplaying instead
   of reviewing, whatever its role - this is a real, checkable failure mode independent of catch
   rate, and Muad wants roleplay, not theatre.
2. **Role-correlation collapse** (reconsidered) - originally a comparison against the phase 4
   probe's plain-arm baseline. Redesigned as `pairwiseAgreement`: the mean textual overlap
   (Jaccard over 4+ letter words) between different labs' posts on the SAME real proposal, within
   one real debate stage. A lens meant to diversify argument that instead makes every seat's
   objection read the same is a real signal computed from what seats actually wrote, not from a
   heuristic mock's agreement rate.
3. **A role degrading a weaker model** (reconsidered) - originally a per-seat catch-rate delta
   read from the phase 4 probe. Redesigned as `roleVsPlainSubstanceGap`: within the SAME real run,
   the mean `substanceRatio` of role-bearing seats minus role-less seats. This is a same-run,
   cross-sectional comparison, not longitudinal - it cannot say whether seat X got worse than seat
   X used to be without a role (that needs a baseline run of the identical chain with the role
   removed, which is out of this phase's scope), only whether role-bearing seats collectively
   argued less substantively than role-less seats in the one run being measured. Stated plainly
   here rather than left implicit, the same "state plainly what it does and does not measure"
   discipline the probe's own `LIMIT` statement already uses.
4. **Token spend shifting from substance to voice** (kept, same intent as §7's original) -
   `evidenceTokenShare`: the fraction of a seat's total post-text words that fall inside a quoted
   span, across every post regardless of stance. Computed from real debate output throughout.

**Wiring**: `computeRoleDiagnostics()` (`src/role-diagnostics.js`) is called once per run, from
the single `reportJsonShape()` function both the real run writer and `council init`'s canned-demo
writer already share (the same function the v5 Phase 2 bug-audit fix consolidated onto, to
prevent exactly the kind of report-shape drift a second hand-rolled writer would risk). Attached
at `report.json`'s `debate.diagnostics`, additive-only: a chain with no debate stage keeps
`debate: null` exactly as before (verified by an end-to-end test); a chain that does debate always
gets a `diagnostics` object, with nulls/empty flags rather than an absent key when a metric has
nothing to compute from (e.g. a seat that only ever supported, never objected or merged, has
`substanceRatio: null`, not a misleading `0`).

Verified end-to-end, not just unit-tested: ran a real `council` invocation against `chains/
mock-debate.json` with a role added to one proposer, confirmed `report.json`'s
`debate.diagnostics` populated correctly with real per-seat numbers computed from the actual mock
debate output produced by that run.

## Phase 7 - release integration

**Integration-time fix, found during the merge, not left for later**: phase 1's `src/seat-role.js`
and phase 6's `src/personas.js` were built in parallel off `master`, each unaware of the other,
and each shipped its own `DEFAULT_PERSONAS` constant naming the same five names - phase 1's a bare
array of keys, phase 6's a full name/voice object. Two independently-maintained ideas of the same
five names is exactly the "quietly agree today, nothing stops them drifting" class this project
has been bitten by before (v5 Phase 2's `report.json` writers). Fixed at merge time:
`seat-role.js`'s `DEFAULT_PERSONAS` is now `Object.keys()` of `personas.js`'s own constant, so
there is one source of the five names, not two. `validateSeatRole()` was deliberately left
permissive on `role.persona` (any string, not checked against `DEFAULT_PERSONAS`) rather than
tightened during this fix - phase 6's personas are explicitly operator-replaceable, and chain-lint
has no access to which `personas.json` an operator loaded at lint time, so validating strictly
against the shipped default would wrongly reject a legitimate custom persona.

Merge order: phase 1 -> phase 2 (fast-forward, phase 2 built directly on phase 1) -> phase 3
(one trivial two-line import conflict in `src/chain.js`, both lines kept) -> phase 4 (clean) ->
phase 5 (clean, phase 5 built directly on phase 2) -> phase 6 (clean, one `.gitignore` line
merged automatically). Full suite after every merge step and after the `DEFAULT_PERSONAS` fix:
288/288 (287 pass, 1 environment-dependent skip - the same skip present on every prior v5/v6
branch, not new).

Verified on this fresh worktree (`/tmp/v6-release`, its own real `npm install`, not a symlink)
per this project's own standing discipline against exactly the mistake that cost an hour
elsewhere tonight.
