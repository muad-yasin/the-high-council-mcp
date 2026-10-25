// The one place src/ starts git (13 Oct 2026, audit item 8, C&C's ruling). Every git this package runs reads a folder the project (or an agent working in it) controls, and git runs a program named by
// `core.fsmonitor` in its configuration when it checks ignores or status (shown on git 2.56.0: `$XDG_CONFIG_HOME/git/config` or the repository's own config makes `git check-ignore` start it). So every call carries
// `-c core.fsmonitor=false`, which stops that program for the call whatever the configuration says. It is the second layer: src/env-file.js already refuses XDG_* from a project `.env`, but a real environment, a
// repository config or a name nobody listed yet are not covered by that list. `rev-parse` never starts the program; it carries the flag anyway so a scanner can say "no other git literal in src/".
//   runGit(args, options, run)  ->  run('git', ['-c', 'core.fsmonitor=false', ...args], options)
// `run` defaults to spawnSync; a caller that wants execFileSync (or a test double that records the call) passes it. The caller's own `options` (cwd, env, input, timeout, shell) pass through untouched, and so do its `args`.
import { spawnSync } from 'node:child_process';

export const GIT_SAFE_ARGS = Object.freeze(['-c', 'core.fsmonitor=false']);
export const runGit = (args, options, run = spawnSync) => run('git', [...GIT_SAFE_ARGS, ...args], options);
