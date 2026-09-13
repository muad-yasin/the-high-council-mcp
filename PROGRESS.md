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
