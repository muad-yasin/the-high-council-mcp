# Changelog

## 0.2.0 - 2026-09-13

v2 build per the council-signed plan (`~/Projects/relay/runs/2026-09-11T12-19-34-184Z/`),
re-curated from `~/Projects/relay`. Nine numbered items; the debate/proposal/reply/blind-panel
mechanism is untouched, no telemetry or network calls were added, and no efficacy claim is made
anywhere below - these are correctness and resumability fixes, not performance claims.

- **Stage contract schema** (`src/stage-contract.js`) - the shared internal data structure
  (`required_sections`, `role`, `no_prior_context`, `return_instructions`) every item below reads
  or writes.
- **`prepare_stage_prompt`** (new MCP tool, +1 to the tool count) - writes a self-contained bundle
  for a paused external stage so a driving session juggling other work can dispatch it to a fresh
  subagent instead of authoring it inline. See `docs/dispatch-pattern.md`. Context is referenced
  by path, never inlined.
- **Prompt-file truncation integrity** - `NEEDS-<stage>.md` now carries a footer (line count,
  byte size, sha256) verified on read; `external_prompt` returns a warning instead of silently
  handing back a truncated or corrupted prompt.
- **Resume-brief mechanism** - `run_status(brief: true)` returns and persists `RESUME.md`,
  regenerated at every stage-completion boundary from run state on disk - never itself trusted,
  always regenerable. No new tool.
- **Cross-run cost breakdown, narrowed from the original plan** - the plan proposed a new local
  ledger file; that was rejected against this project's existing "derived, never recorded" spend
  invariant (`src/spend.js`), whose reasons (drift, a failing write path, a sensitive-deletion
  leak) the plan's debate never addressed. Built instead: `costToday()` (calendar-day boundary,
  per-model breakdown) as an extension of the existing derivation, a `--cost-today` CLI
  subcommand, and a `session_cost_today` field on the existing `spend_report` tool. No ledger, no
  new tool. Full deviation recorded in `DECISIONS.md`.
- **Static pre-flight check** - before any stage runs, a keyword check compares a chain's
  hard-required deliverable sections against the task text for the conflict class this project
  already hit once (a required "Scope ledger" section vs. a "standalone" requirement). Warns,
  never blocks; a known, accepted limitation (rephrased conflicts without trigger words) is
  pinned by name in its own test rather than hidden.
- **Partial-deliverable detection** - a stage's output is validated against its declared required
  sections before being trusted; a miss is logged loudly and recorded, never silently passed
  downstream.
- **Cache-hit staleness detection** - a cached stage is fingerprinted against the task text and
  chain config it depended on; a stale hit (inputs changed since caching - e.g. the task was
  edited between a pause and a resume) is invalidated and the stage actually re-runs, rather than
  silently replaying stale output.
- **Docs** - `docs/dispatch-pattern.md`, an updated MCP tool table (13 tools; `prepare_stage_prompt`
  is the only addition, nothing renamed or removed), and an external-vs-API documentation note for
  operators without a flat-rate subscription (not the default anywhere in config or examples).

Built and tested entirely offline against `chains/mock-*.json` fixtures - zero API spend for the
whole build. See `PROGRESS.md` and `DECISIONS.md` for the full build log and every judgment call.

## 0.1.0

Initial public release.
