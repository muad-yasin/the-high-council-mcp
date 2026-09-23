# PROGRESS

One line per milestone as it lands. Append-only.

- 2026-09-13: v2 (0.2.0) re-curated from `~/Projects/relay` main (commits 7cd9209..705177b).
  Nine numbered items from the council-signed plan; full detail in relay's own PROGRESS.md and
  DECISIONS.md (not copied here - this repo's own DECISIONS.md records the re-curation-specific
  judgment calls instead). 94/94 tests passing, offline, zero API spend. CHANGELOG.md 0.2.0 entry
  added; package.json and the MCP server's own version bumped to match.
- 2026-09-13: Ported chains/gp-judge-v1.json's critic maxTokens fix (4000->8000) from relay,
  redacted of an internal run-id/path (DECISIONS.md). Deliberately did not port relay's
  Gemini-pause note across 18 chains - personal billing information, doesn't belong in a public
  repo or template. Also ported src/verdict-stats.js + the verdict_stats MCP tool + --stats CLI
  subcommand, with 9 new tests written fresh (none existed upstream). 103/103 tests passing.
- 2026-09-13: v3 (0.3.0) re-curated from `~/Projects/relay` main (two merged streams: v3/stream-a
  §4/§3/§2, v3/stream-b §5/§1, merged at relay commit 6c15fbd). Five items; full build detail in
  relay's own PROGRESS.md/DECISIONS.md. 130/130 tests passing, offline, zero API spend. Real
  smoke tests (not just unit tests) confirmed frozen-scope refusal, the dispute record, and
  demo/doctor all work end to end post-merge. CHANGELOG.md 0.3.0 entry added; package.json and
  the MCP server's own version bumped to match.
- 2026-09-13: v6 role-seat plan, phase 4 (measurement harness, §5) built in advance of phases
  1-3, per the plan's own handoff.md ("its harness can be built in advance"). Branch
  `v6/phase4-measurement-harness`, own worktree + npm install, test/ and scripts/ only - no src/
  changes. Four-arm role-conditioning experiment (plain / lens-only / persona-only / lens+persona)
  reusing v5's seeded-defect probe fixtures/detectors unchanged; a pre-registered decide()
  function (POSITIVE/NEGATIVE/INCONCLUSIVE) proven against both a hand-engineered negative-control
  fixture and synthetic per-arm data for all three verdicts; the real 5-fixture run reads NEGATIVE
  today (regression-anchored in a test). Error-visibility built in from the start (a malformed
  fixture's cells surface in `rows` and `errors`, never silently averaged as zero). Not run as an
  actual experiment - phases 1-3 don't exist in this worktree yet; `npm test` only exercises this
  harness's own offline code against its own fixtures, same as any other test in this repo.
  225/225 tests passing, offline, zero API spend.
