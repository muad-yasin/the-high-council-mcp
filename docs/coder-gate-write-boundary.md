# MLLM Coder v1: the write-boundary trust design

Design source: `relay/runs/2026-09-14T16-14-10-757Z/deliverable.md` §6 (private planning repo,
referenced here for provenance only - this file is the content itself, not a pointer to it).

THCMCP's current tool allowlist (`run_tests`, `grep_repo`, `read_file`, `check_versions`,
`src/tools.js`) is read-only in effect: no tool can change what another tool subsequently sees. A
write-capable tool is not an incremental addition to that allowlist - it is a different risk
class, for three concrete reasons:

1. **Irreversible mutation of the working tree.** Every current tool's output is a value returned
   to the chain; nothing on disk changes as a side effect. A write tool changes disk state
   directly, and a bad write is not undone by the chain's own machinery.
2. **Sandbox escape via crafted content.** A write tool that can create a file gives an
   adversarial or simply wrong proposal a path to writing an executable that `run_tests` then
   runs - turning a read-only verification tool into an unwitting executor of attacker-chosen
   content.
3. **The allowlist's own invariant breaks.** "No tool changes what another tool sees" is currently
   true by construction (all four tools are pure reads). A write tool falsifies that invariant for
   every tool that runs after it in the same stage, which is a change to the trust model of every
   existing chain, not just the new one.

**v1 decision: no write tool is added anywhere in `src/tools.js`.** Applying a proposed diff to a
real working tree stays a human or external-session action, never something THCMCP's own process
does. This is not deferred by omission - it is the explicit v1 answer, and any future write tool
is its own design round with its own risk analysis, not an extension slipped in under a
coder-gate feature.

This is why MLLM Coder v1's `verify` stage (see IN-3) runs `run_tests` against a workspace where
the candidate diff has *already* been applied externally, by the same human/session that
authored it, in a disposable branch - never by THCMCP itself. THCMCP's own process only ever
reads: the diff, the test output, and the change-request fields.
