# HANDOFF - The High Council MCP, day-1 release

*Written 2026-09-11 for the first build session in this repo. Read this, then start at "Order of
work". Ask before deviating — some of the rules below exist for legal and privacy reasons, not
style reasons.*

**2026-10-05 note: 0.8.1 is prepared as a release candidate on `release/0.8.1`** (see `CHANGELOG.md` `## 0.8.1` and `CLAUDE.md`); the release steps stay the owner's (the audit round, `npm publish`, the tag).

**2026-10-23 note: 0.8.3 ends as a pull request into `master`, not as a push plus release.** The order is the
last section of this file, "0.8.3: the release order, as a pull request". Nothing is tagged, published or released
until the owner says so after the review.

**2026-09-16 note (doc-hygiene pass): this is a historical day-1 snapshot, not a live status
file.** The "open decisions" below are settled (`CLAUDE.md`, "Settled, do not reopen"). The spend cap,
the npm package rename, and the public npm publish that "Order of work" and "What done looks like"
describe as not-yet-done have all since landed — `CLAUDE.md`'s "Architecture" section and
`maintainers/DECISIONS.md`/`CHANGELOG.md` are the current picture. This file is kept for its historical rules
and reasoning, not as a source of current state.

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
- **No efficacy numbers.** The author's recorded decision (WA-2026-09-11-A) is that the mechanism
  is an open secret *with no performance claims attached yet*, because nothing has been measured.
  The README is written accordingly. Do not add numbers, benchmarks or comparisons; the owner's
  approved qualitative sentences (README top, 14 Oct 2026) stay as he wrote them.
- **Honesty about limits stays.** The README's "Known limits, stated plainly" section is
  deliberate. Do not soften it, and do not delete a limit because it is embarrassing — delete it
  when it stops being true.
- Never add the excluded directories listed above.

## Decisions, now settled (package name, licence holder; see `CLAUDE.md`, "Settled, do not reopen")

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

## 0.8.3: the release order, as a pull request

*Added 2026-10-23. The owner's decision (20 Oct 2026): when 0.8.3 is finished it goes up as a pull request so it can
be reviewed before the real release, not as a push plus release. Every step that publishes something is the owner's.*

**Before the pull request is opened (the working branch is `release/0.8.3`):**

1. The integration branch lands on `release/0.8.3` in one move, after the maintainer's reviews and one full test
   run (`npm test`, the whole suite, from a clean checkout). One linear history on `release/0.8.3`.
2. The dated tables are regenerated, never patched: `scripts/refresh-reasoning-table.mjs` and
   `scripts/refresh-openrouter-prices.mjs` (the failing test names the table). `.github/workflows/test.yml` runs
   `npm test` on every pull request, so a stale table turns the pull request red. If a shipped seat's price moves,
   the work stops there: every typed figure that came from a dry run (the README's "Which chain" table, the
   over-$7 paragraph, `docs/index.html`, the `chains/*.json` descriptions that carry one) is regenerated as its own unit and shown to the owner before anything is
   committed.
3. `maintainers/MODEL-CAPS.md` is regenerated with `scripts/model-caps-report.mjs` (a test diffs it).
4. The version moves together, as the 0.8.2 release commit did it: `package.json`, `package-lock.json` (two
   fields), `server.json` (two fields), `mcpb/manifest.json` and `.claude-plugin/plugin.json`, and the
   `## Unreleased` heading in `CHANGELOG.md` becomes `## 0.8.3 - <date>`. No test anchors on the word
   "Unreleased"; `scripts/build-mcpb.sh` refuses a bundle whose manifest and package versions differ.
5. A last look at the tree before the push: none of `Review/`, `runs/`, `tasks/`, `context/`, `plans/`, `Docs/`,
   `benchmark/`, `Dockerfile` or `fly.toml` is tracked (`git ls-files` shows none of them), and no key or run
   folder is in the diff. The squash commit's message is public text and needs the owner's yes; it is grepped for
   session names, `Review/` paths and the maintainer's private words before the push.
6. **Decided by the owner, 23 Oct 2026 ("1: b"): the pull request holds ONE squash commit.** The commit messages of
   `release/0.8.3` are not published; that branch stays on the maintainer's machine, as `release/0.8.2` did. The
   pull-request branch is cut from `origin/master`, the public base, and holds one commit with the whole diff, so
   there is nothing to merge and the review sees one diff. `master` has local commits that touch `CLAUDE.md` and this
   file and are not on `origin/master`. Their content is already in the branch, except lines the branch replaced on
   purpose later (the `--max-usd none` wording and the efficacy wording), so the pull request needs no separate push
   of them. Whether they are pushed anyway stays the owner's call.
7. The refreshed "How sessions work together" section of `CLAUDE.md` is the last commit on `release/0.8.3`,
   before the squash.

**The pull request:** the owner pushes the squash branch and opens it into `master`. Review happens there. No tag,
no `npm publish`, no GitHub release and no merge into `master` until the owner says so.

**After the review, in this order, each the owner's step:**

1. Merge into `master` (the 0.8.2 shape: one commit on `master`). The sentence in `CLAUDE.md` that names the
   latest release ("the latest release is **0.8.2**") moves to 0.8.3 with the release, not in the pull request.
2. `npm publish` (needs the owner's 2FA passkey, from a real terminal).
3. Tag `v0.8.3`. A `v*` tag push starts `.github/workflows/release-binaries.yml` ("Build binaries": it runs `npm test`,
   builds the Linux binary, the AppImage and the Windows `.exe`, smoke-tests each and uploads workflow artifacts;
   it does not publish a release).
4. The GitHub release for the tag, with the `.mcpb` from `bash scripts/build-mcpb.sh` and its SHA-256 (and the
   binaries, if they are to be attached).
5. The MCP registry entry from `server.json`, last, since it points at the npm version published in step 2.
