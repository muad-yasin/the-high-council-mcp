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

## Phase 5 - role debate chain (real-run candidate, chains/plan-debate-roles-c1.json)

**Context:** Muad corrected the frame after phase 4's offline result: "It's not about catching
planted bugs. It's about philosophy of different models in software infrastructure. They will
just roleplay and talk differently. But still talk about the different ideas." Phase 4's NEGATIVE
result stands - a deterministic heuristic detector has no philosophy to change, so it could never
have seen the thing this feature is actually for. This phase builds the real thing it was
correcting toward: an actual chain config that puts five real models from five labs into a live
debate, each carrying a role, so the difference (if any) can be watched, not inferred from a
detector proxy.

**Chain shape:** `plan-debate-open-c2.json`'s shape, minus Kimi - five critic seats, not six, so
every lens and every persona is used exactly once. Pipeline seats (criteria/skeleton/builder/
reviser/handoff) stay untouched external Claude-Code seats; roles only ever reach the debate-stage
system prompt for the five critic seats, per phase 1/2's own construction.

**Lens-persona pairing, chosen deliberately, not alphabetically:**

| Lab | Lens | Persona | Why this pairing |
|---|---|---|---|
| deepseek | security-and-legal | Moses | The lawgiver - the one figure in the set whose defining act is bringing down binding rules and obligations. Fits a lens about what a proposal exposes you to and obligates you for. |
| qwen | long-horizon | Noah | Built for a slow-building consequence nobody else believed in yet, on a timeline of years, not the next sprint. Fits a lens about maintenance cost a year out. |
| glm | integrator | Matthew | A gospel chronicler whose own text opens by tracing a genealogy - explicitly the connective-tissue writer of the set, concerned with how this fits what came before. Fits a lens about what a proposal would break or duplicate elsewhere. |
| mistral | user-advocate | Van Gogh | A painter whose defining subject was ordinary people's lived experience (laborers, peasants), rendered with empathy rather than as the picturesque version. Fits a lens about what the person actually using this experiences. |
| gemini | adversary | Parzival | A knight whose entire arc turns on failing to ask the one uncomfortable question, then learning to ask it. The closest narrative fit in the set for "argue as the strongest opponent, find where it fails." |

**Whether the role block overwhelms the task - checked before any live run, per the explicit
standing concern ("a persona instruction that crowds out evidence turns review into
performance"):** measured, not assumed. `scripts/preview-role-prompt.mjs` prints the exact
debate-stage SYSTEM prompt per seat; the appended `[SEAT ROLE]` block is ~290 characters
(~1-2 sentences: the lens directive plus one persona-voice sentence) against a base system prompt
of ~1300 characters - looks like a meaningful fraction of the SYSTEM prompt alone. But the system
prompt is not the whole prompt a model sees: `--dry-run` against this exact chain shows the
debate-stage USER prompt (the actual proposals, criteria, and skeleton a critic argues about) at
62,600 input tokens per seat. The role block is roughly 70-90 tokens. That is under 0.15% of what
the model actually reads for that call - the base prompt's own "quote the phrase you object to"
instruction and the six proposal drafts overwhelmingly dominate the context, not the role. This is
a size measurement, not a claim about what a model attends to or weights internally - stated
plainly as its own limit, the same discipline phase 4's LIMIT statement uses.

**`sower-review:scope-gate` verdict: GO**, run against the chain design and pairing specifically
rather than taking the size argument above as sufficient on its own. Its reasoning: the persona
sentence itself carries an explicit guardrail ("without changing what you are actually judging")
that does real work against the named failure mode, not decoration; the pairing is genuinely
reasoned (Moses/Noah/Parzival read as strong fits, Matthew/Van Gogh as real-but-contestable fits,
none of the five arbitrary); and a diff against the source chain confirms no scope crept in beyond
adding `role` to five seats and dropping Kimi to make the lens/persona count 1:1. **One
non-blocking flag from that review, worth carrying forward rather than dropping:** three of the
five personas (Moses, Noah, Matthew) are shared religious figures, and while nothing in the
prompt text is irreverent or doctrinal, a security-and-legal seat "arguing as Moses" is the kind
of pairing an outside reader could read as flip - worth one more human look before this run's
output (or the pairing itself) is ever shown outside this repo, not before running it internally.

**Cost, no history yet:** `--forecast-cost` returns no estimate (zero prior runs of this chain
name) - it names its own fallback correctly. `--dry-run` worst case (full 3-round cap, nothing
resolves early): **$0.47/run**, 1,394,800 input + 137,300 output tokens across the five real-lab
seats. A clean early signoff costs less; this is the ceiling, not an expectation.

**Not run live.** No API call has been made against this chain. cnc-harness-a7's go is required
before any spend.
