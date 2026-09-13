# v6 progress

Source: `relay/runs/2026-09-13T20-20-07-757Z/` (revise-2.md is the plan, handoff.md the build
order). **Status: NOT five-lab signed off** - four labs passed, qwen refused over a section-
ordering objection recorded in the plan's own text; `report.json`'s `passed:true` was a known
false-pass bug, now fixed in relay at 87c6e2e. Muad said build anyway; the objection is about
document ordering, not design.

**Framing correction (Muad, 2026-09-13), carried through phases 4/5**: the feature's purpose is
debate diversity among real model seats, not catching planted defects. Phase 4's probe (a
deterministic heuristic mock) cannot see that purpose; its NEGATIVE result on defect-catch fixtures
is not a feature failure, and persona was never measured by it at all. See docs/v6-decisions.md's
Phase 5 section for the full argument and how it reshaped two of §7's four detectors.

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
- [x] Phase 3 - weighted voting (§4). thcmcp-cb, `v6/phase3-weighted-voting`.
- [x] Phase 4 - measurement (§5). wolv-a0, `v6/phase4-measurement-harness` (d24f61e), built ahead
      of phases 1-3 per handoff.md's own allowance. Test-only, offline, 226 tests at that commit.
      Framing correction above applies to this phase's own result.
- [x] Phase 5 - failure-mode detectors (§7). `v6/phase5-failure-detectors`, built by thc-17.
      **Reasoned deviation, recorded in docs/v6-decisions.md**: two of the four detectors
      (role-correlation collapse, role-degrades-a-weaker-model) originally read per-seat data
      from the phase 4 probe; both redesigned to read a real run's own debate output instead
      (`src/role-diagnostics.js`), since the probe cannot see what the feature is actually for.
      Wired into `report.json`'s `debate.diagnostics` via the shared `reportJsonShape()`
      function, additive-only (verified end-to-end: a chain with no debate stage still gets
      `debate: null`, one that does always gets a diagnostics object). Full suite: 249/249
      (248 pass, 1 environment-dependent skip).
- [ ] Phase 6 - public naming config (§6). thcmcp-cb, in progress.
- [ ] Phase 7 - release. In progress (this session) - integrating phases 1-6.
