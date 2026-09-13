# v5 Phase 1 progress

Source: `relay/runs/2026-09-13T14-51-08-757Z/` (deliverable.md, handoff.md). Phase 1 only - no
later phase has cleared its Muad gate.

All three built by this session (thc-17) on branch `v5/candidates-1-3-phase1` in the main
checkout (candidate 1, candidate 3) and `v5/candidate-2-independence-skew` (candidate 2, built
first, separate branch). Not merged into each other or into master yet - not pushed.

- [x] §1 candidate 1 - shape-round flag. Commit ab953df. `test_shape_round_flagging` +
      full suite (139/139 at that point) pass.
- [x] §1 candidate 2 - independence skew report. Commit aa5ef47 (separate branch, off master).
      `test_independence_stats` + full suite (138/138 at that point) pass.
- [x] §1 candidate 3 - withdrawal-chain termination check. Commit 483d9de.
      `test_orphaned_section_detection` + full suite (148/148) pass, including a regression
      test against the real run folder that authored this candidate (catches the real
      KIMI-4/MISTRAL-2 mutual withdrawal). resume-brief.js/cli.js write-order pieces are
      thcmcp-cb's, folded in and credited in the commit message.

Phase 1 is code-complete pending merge. The two branches (candidate 2 vs. candidates 1+3) still
need reconciling into one before Phase 1 can be called closed - neither has been merged into the
other or into master.
