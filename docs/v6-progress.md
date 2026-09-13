# v6 progress

Source: `relay/runs/2026-09-13T20-20-07-757Z/` (revise-2.md is the plan, handoff.md the build
order). **Status: NOT five-lab signed off** - four labs passed, qwen refused over a section-
ordering objection recorded in the plan's own text; `report.json`'s `passed:true` is a known
reporting defect (relay-9c is fixing it), not a real sign-off. Muad said build anyway; the
objection is about document ordering, not design, and does not block phase 1.

Roadmap phases (plan §"Roadmap"):

- [x] Phase 1 - seat-role mechanism (§1). This branch, `v6/phase1-seat-role-mechanism`, built by
      thc-17. `role` field + validation (`src/seat-role.js`), wired into the debate-stage system
      prompt only (`src/chain.js`), chain-lint check for an invalid role
      (`src/chain-lint.js`), golden-hash compatibility test across all 30 shipped chains
      (`test/seat-role.test.js`). Full suite: 230/230 (229 pass, 1 environment-dependent skip).
- [ ] Phase 2 - stage isolation (§3): the structural guarantee (role-stripped panel projection +
      single-call-site static scan) that a role can never reach the panel stage even by accident.
      Not started. Phase 1's wiring only ever calls `applySeatRole` from the debate-stage call
      site, so panel isolation already holds by construction - phase 2 adds the *defense-in-depth*
      guard, not the first line of defense.
- [ ] Phase 3 - weighted voting (§4). thcmcp-cb, in parallel, independent of role content.
- [ ] Phase 4 - measurement (§5), THE GATE. Not started. Decides whether phases 5-6 are worth
      finishing.
- [ ] Phase 5 - failure-mode detectors (§7). Not started.
- [ ] Phase 6 - public naming config (§6). Not started.
- [ ] Phase 7 - release. Not started.
