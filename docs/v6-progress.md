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
- [x] Phase 2 - stage isolation (§3). `v6/phase2-stage-isolation`, built by thc-17. **Reasoned
      deviation from §3's text, recorded in docs/v6-decisions.md**: did not build KIMI-3's
      role-stripped panel-seat projection, since the actual panel-stage prompt builders
      (`criticSystem`, `criticUser`) take no seat/role parameter at all - nothing to strip. Built
      instead: a full-codebase single-call-site scan for `applySeatRole`, a check that its one
      call site sits inside the debate-stage block and not any panel/critique block, a scan of
      `criticSystem`/`criticUser`'s own source confirming no `role` reference or `applySeatRole`
      call, and a check that `src/roles.js` never imports `applySeatRole` at all - four CI-failing
      assertions (`test/stage-isolation.test.js`), verified locally to actually fail when a second
      call site is injected, not just pass vacuously. Full suite: 234/234 (233 pass, 1 skip).
- [ ] Phase 3 - weighted voting (§4). thcmcp-cb, in parallel, independent of role content.
- [ ] Phase 4 - measurement (§5), THE GATE. Not started. Decides whether phases 5-6 are worth
      finishing.
- [ ] Phase 5 - failure-mode detectors (§7). Not started.
- [ ] Phase 6 - public naming config (§6). Not started.
- [ ] Phase 7 - release. Not started.
