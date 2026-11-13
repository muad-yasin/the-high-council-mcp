# maintainers/

Internal project documents for the people who maintain The High Council. They are not user
documentation (that is `README.md`, `TROUBLESHOOTING.md`, `PERSONAS.md` and `CONTRIBUTING.md` at
the root) and they are not part of the npm package. Like everything committed here, they are
publishable.

- `HANDOFF.md` - the day-1 release handoff and its hard rules, and the release order. `CLAUDE.md` points to its release order for a release.
- `DECISIONS.md` - decisions that are not obvious from the code or the commit messages.
- `ARCHITECTURE.md` - the architecture detail moved out of `CLAUDE.md`, which keeps what a run leaves on disk and each rule that code outside its own part can break.
- `RUN-FLOW.md` - how a run flows: the seats and switches of a chain file, the ladder, the stage order, pauses, stops and exit codes. `CLAUDE.md` points to it.
- `PROGRESS.md` - one line per milestone, append-only.
- `STATUS-LEDGER.md` - the v5 GUI feature status table (`test/status-ledger.test.js` checks it).
- `ideas/` - the idea matrix (THCMCP and Sophi-A) and its PDF renders.
- `proposals/` - design proposals kept as input for later planning, not build orders.
- `ROADMAP-0.8.0.md` - the 0.8.0 plan: local web UI headline, prerequisites, debate and checklist items.

Moved here from the repository root (and one file from the gitignored `Review/`) on 2026-09-23.
