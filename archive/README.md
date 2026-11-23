# archive/

These files left their folders because nothing in this repository reads them any more. They are kept here, not deleted: each keeps its old path below this folder (`archive/docs/...` was `docs/...`), and git history holds every earlier version. Nothing under `archive/` ships in the npm package (`package.json` `files` does not name it, and `test/package.test.js` checks it), and no test reads these files.

| File | Moved | Why it moved |
| --- | --- | --- |
| `docs/v5-progress.md` | 23 Nov 2026 | The progress log of v5 Phase 1. No file reads it. |
| `docs/v6-progress.md` | 23 Nov 2026 | The progress log of v6. No file reads it. |
| `docs/coder-gate-v2-differentiation.md` | 23 Nov 2026 | The MLLM Coder v2 differentiation, framings and cut list. No file reads it. It names `docs/coder-gate-write-boundary.md`, which stays where it was. |
| `maintainers/ROADMAP-0.8.0.md` | 23 Nov 2026 | The plan for 0.8.0, a released version. The two index sentences that named it (`maintainers/README.md` and `maintainers/0.8.5/README.md`) now point here. |
| `scripts/set-high-reasoning.mjs` | 23 Nov 2026 | A one-time migration for 0.8.1, as its own header says. It is kept as a record and does not run from this folder: it imports from `../src/`. |
| `scripts/v5_status_audit.js` | 23 Nov 2026 | An audit of the v5 status ledger against another repository. It is kept as a record; from this folder it would look for `src/` in the wrong place. |

The move was checked with the tests that walk a folder a file left or entered (`docs/`, `scripts/`, `maintainers/` and the root), run once before the commit: `test/addon-rework.test.js`, `test/council-intro.test.js`, `test/cli-unknown-flag.test.js`, `test/notes-lane-on.test.js`, `test/landing-page.test.js`, `test/budget-buys-removed.test.js`, `test/outdated-chains.test.js`, `test/package.test.js`, `test/mcp-usd-limit-paths.test.js` and `test/repo-hygiene.test.js`. The full suite did not run. A push to the `dev` branch starts no CI run: `.github/workflows/test.yml` runs on pushes to `master` and on pull requests.
