# v5 Phase 1 progress

Source: `relay/runs/2026-09-13T14-51-08-757Z/` (deliverable.md, handoff.md). Phase 1 only - no
later phase has cleared its Muad gate.

All three built by this session (thc-17): candidates 1 and 3 on `v5/candidates-1-3-phase1`,
candidate 2 on `v5/candidate-2-independence-skew` (built first, separate branch, off master).
Merged into `v5/candidates-1-3-phase1` (candidate 2's branch left as-is, not deleted). Not merged
into master, not pushed - master stays where Muad left it.

- [x] §1 candidate 1 - shape-round flag. Commit ab953df. `test_shape_round_flagging` +
      full suite (139/139 at that point) pass.
- [x] §1 candidate 2 - independence skew report. Commit aa5ef47 (originally on a separate
      branch, off master). `test_independence_stats` + full suite (138/138 at that point) pass.
- [x] §1 candidate 3 - withdrawal-chain termination check. Commit 483d9de.
      `test_orphaned_section_detection` + full suite (148/148) pass, including a regression
      test against the real run folder that authored this candidate (catches the real
      KIMI-4/MISTRAL-2 mutual withdrawal). resume-brief.js/cli.js write-order pieces are
      thcmcp-cb's, folded in and credited in the commit message.

Phase 1 is now on one branch (`v5/candidates-1-3-phase1`), full suite green post-merge (see the
merge commit for the count). Still not in master - that landing is Muad's call, not this
session's.
