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
