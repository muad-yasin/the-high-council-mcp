# Status ledger: v5 GUI features and Project A overlap

V6-1 (`relay/runs/2026-09-15T15-13-25-950Z/deliverable.md`). A real read of `origin/master`
(commits `8318b18`, `f914bd3`), `CHANGELOG.md`, and `coder-gate-agent-stub`'s own git log and
`RESULTS.md`, checked against what is actually on disk today - not what any plan claimed would
be built. `test/status-ledger.test.js` re-checks every row's cited path at HEAD; this file is
not a claim that outlives its own evidence.

Status values, exactly one per row: **Built**, **Partial**, **Not started**, **Cut**.

| v5 GUI feature | Status | Evidence |
|---|---|---|
| Round/wedge live state | Built | `src/cli.js` (`state.json` writer: round, maxRounds, seats[].status) - `8318b18` |
| Disagreement grouped by claim | Partial | `src/disagreement-groups.js` groups by proposal id; a finer claim tag is deferred, named in that file's own header - `f914bd3` |
| No-consensus vs error | Built | `src/outcome.js` (consensus / no_consensus / degraded in report.json) - `8318b18` |
| Live cost readouts | Partial | `src/cli.js`'s `state.json.cost` updates per finished stage from `stage-log.jsonl`; no in-call streaming, provider-balance readouts cut - `8318b18` |
| Debate/swarm dispatch split | Not started | Cut as a THCMCP field in v5 item 7 (see `CHANGELOG.md`); swarm review exists only in `coder-gate-agent-stub` (`coder-gate-agent-stub/src/review/swarm-policy.js`, `coder-gate-agent-stub/test/swarm-policy.test.js`) - `7557449` |
| Multi-session tracking | Partial | `src/cli.js` (`run.json` `label`/`pid`), `src/run-status.js` (`deriveRunStatus`) - `8318b18`; no cross-session aggregate |
| Permission-boundary enforcement | Partial | Built for planning seats (`docs/seat-permission-boundary.md`, `test/mcp-seat-boundary.test.js` - `f914bd3`); build seats enforced separately, in the stub (`coder-gate-agent-stub/src/seat/bus.js` - `7557449`) |

## Project A overlap (item 8)

Project A is `coder-gate-agent-stub`'s own build-ready plan
(`relay/runs/2026-09-15T03-42-24-956Z/deliverable.md`, 6 tasks). Already settled there, and not
re-scoped by this ledger or by v6:

- worktree-per-task sandbox;
- OS sandboxing deferred;
- agents run no tests and no shell;
- the `agent-state.v1.json` fields (`files[]`, `maxItems: 1`);
- diff-shape validator, review-outcome interpretation (`ddec3da`), seat bus, swarm review policy
  (`7557449`) - all built there, not duplicated here.

Tasks 1-2 of that plan (`src/agent/`, `schema/`) are **not built**. v6 only adds spec input to
the unbuilt Task 1 schema (item V6-3 in the v6 plan) and writes down an already-settled isolation
decision (item V6-4) - both out of scope for this ledger and deferred/scoped separately, per the
v6 plan itself.

## What this ledger does not claim

This is a snapshot, not a live dashboard - it is not regenerated automatically and will go stale
the next time any of the cited files change. It carries no efficacy claim about any feature's
quality, only whether the feature exists on disk as described. Re-run `test/status-ledger.test.js`
before trusting a specific row after this file's own last edit.
