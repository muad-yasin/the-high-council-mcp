# Coder-gate diff format (v1)

MLLM Coder v1 (`chains/coder-gate-v1.json`) redefines a "proposal" from THCMCP's usual meaning
(prose scored by a rubric) to: exactly one fenced unified diff, targeting exactly one file and
one hunk, matching the `target_file` named in the change-request task file. This document is the
convention an external proposer's answer at the `propose`/`build` pause must follow.

## Rules

1. Exactly one fenced diff block per proposal, opened with ` ```diff ` and closed with ` ``` `.
   A reply with zero diff blocks, or more than one, is malformed.
2. The block starts with standard unified-diff headers: a `---` line naming the original file, a
   `+++` line naming the new file, then one or more `@@ ... @@` hunks.
3. Both the `---`/`+++` headers must name the same single file, and it must match the
   change-request's `target_file` exactly (same repo-relative path).
4. No binary patches (`GIT binary patch` or equivalent) — text hunks only.
5. Anything outside the fenced block (prose explaining the change) is fine and expected; it is
   never treated as part of the diff.

## Enforcement in v1: structural and social, not a parser

**No code validates these rules in v1.** The template instructs the external proposer to follow
them, and the human sitting at the `propose`/`build` external pause (`NEEDS-propose-*.md` /
`NEEDS-build.md`) is the enforcement point — a submission that visibly breaks a rule above is
rejected before it ever reaches debate or a critic, the same way any other external-seat answer
in this project is reviewed by whoever writes it. This is a deliberate v1 boundary, not an
oversight: a programmatic diff-syntax validator is a named v2 item, out of scope here (see the
plan's §8, "Explicitly NOT v1").

The same posture applies to the change-request task file's own four required fields
(`target_file`, `target_hunk_locator`, `test_command`, `intent`) — nothing in this chain's config
parses or validates a task file's content today; a missing field is caught by the human reviewer
reading the file before dispatching it, not by the CLI refusing to run. See the acceptance-test
note in `chains/coder-gate-v1.json`'s own description for the exact gap this leaves.

## Classification check (run by hand against three fixtures)

| Fixture | Expected |
|---|---|
| A valid single-file diff, correct headers, matches `target_file` | accept |
| A submission with no diff block at all | reject (rule 1) |
| A diff touching two files | reject (rule 3) |

## Write boundary

No tool in this project ever applies a diff to a real working tree — that stays a human or
external-session action. Full reasoning: `~/Projects/relay/runs/2026-09-14T16-14-10-757Z/deliverable.md` §6.
