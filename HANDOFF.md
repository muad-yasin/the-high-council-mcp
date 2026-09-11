# HANDOFF - The High Council MCP, day-1 release

*Written 2026-09-11 for the first build session in this repo. Read this, then start at "Order of
work". Ask before deviating — some of the rules below exist for legal and privacy reasons, not
style reasons.*

## What this repo is

`the-high-council-mcp` — a multi-model planning harness published as an MCP server and CLI,
MIT-licensed, BYOK-only. It runs one request past several AI models from different labs, makes
them argue on the record, and produces a deliverable plus a full debate board.

Public repo: `https://github.com/muad-yasin/the-high-council-mcp` (created, public, currently
empty — this working copy has not been pushed yet).

**Naming:** "The High Council" is the harness. "Sophi-A" is the title of it, and is a *separate*
product — a Tauri desktop app living at `github.com/muad-yasin/sophi-a` (public, Apache-2.0).
Do not conflate them; two different repos, two different licenses.

## Where these files came from, and the hard rule that follows

This tree is a **curated extraction** from a private harness repo (`~/Projects/relay`, private,
and it must stay private). Only the mechanism was copied: `src/` (including `src/mcp/server.js`),
`chains/`, `test/`, `scripts/`, `package.json`, `package-lock.json`, `.env.example`, `.gitignore`.

**Never copy these in, now or later — they contain private business material:**
`context/` · `tasks/` · `plans/` · `Docs/` · `benchmark/` · `Dockerfile` · `fly.toml`

An audit found no secrets (`.env` and `runs/` are gitignored upstream, so no keys or run outputs
exist in any history). Internal architecture references *do* remain in code comments and chain
descriptions — the author reviewed these and deliberately wants them public. Do not "clean" them.

## Order of work

1. **Git init and first push** (the author may have done this already — check).
   ```
   git init && git remote add origin https://github.com/muad-yasin/the-high-council-mcp.git
   ```
   Upstream convention is `master`, not `main`. Before the first commit, get the author's answer
   on the two open decisions below — both are far cheaper to change now than after history exists.

2. **A per-run spend cap. This is the day-1 feature and the reason this release matters.**
   Today there is no spend ceiling on the CLI or MCP path; `MAX_USD_PER_DAY` exists only in
   `src/http-server.js`, which is not part of this release. For a BYOK tool this is close to a
   trust prerequisite — a stranger will not point their own API keys at an unbounded multi-model
   debate loop, and they are right not to.

   What it needs to do, concretely:
   - A per-run USD ceiling, settable per invocation (CLI flag) and as a default (env var).
   - Checked *before* each paid stage, not only after — a cap that reports overspend after the
     fact is not a cap.
   - On breach: stop cleanly, leave the run resumable, write what was spent and which stage it
     stopped at. Do not leave a half-written run folder that looks complete.
   - Surfaced in `run_status` so an MCP client can see remaining budget, not just spend.
   - Documented in README's "Known limits" section — which currently *admits this gap*. Update
     that section when the cap lands; do not leave the README claiming a limitation that no
     longer exists.

   `src/cost.js` and the existing accounting in `run_status` are the places to start; per-run cost
   is already tracked, so the missing piece is enforcement, not measurement.

3. **Write a `CLAUDE.md`** for this repo once the above is settled — a fresh session here has no
   context beyond this file.

## Hard rules

- **BYOK only.** No hosted option, no keys bundled, no key ever leaves the user's machine. Never
  add a default key, a proxy, or a "try it free" path.
- **No efficacy claims.** The author's recorded decision (WA-2026-09-11-A) is that the mechanism
  is an open secret *with no performance claims attached yet*, because nothing has been measured.
  The README is written accordingly. Do not add "better plans", "higher quality", "catches more
  bugs" or similar to any user-facing text until there is a real measurement behind it.
- **Honesty about limits stays.** The README's "Known limits, stated plainly" section is
  deliberate. Do not soften it, and do not delete a limit because it is embarrassing — delete it
  when it stops being true.
- Never add the excluded directories listed above.

## Open decisions - the author's call, ask before the first commit

1. **`LICENSE` copyright line** currently reads `Copyright (c) 2026 Sower Industries`. That is his
   trading identity. A copyright holder is most enforceable as the actual legal person (the name
   on his Impressum). He may want it changed — ask, do not guess.
2. **`package.json` still says `"name": "relay-harness"` and `"bin": { "relay": ... }`.** For a
   public release called The High Council this is the first mismatch a visitor notices. Renaming
   touches the CLI entry point and anything that shells out to `relay`, so it is a real change,
   not a cosmetic one. Ask whether to rename before day 1 or after.

## What "done" looks like for day 1

The repo is public and pushed, carries a LICENSE and a README that does not overclaim, and a user
who clones it can set their own keys, price a run with `dry_run`, and start one under a spend
ceiling they control. That last clause is the part that is not true yet.
