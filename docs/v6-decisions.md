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
