// v5 item 2: run identity and per-run liveness. Status is derived, never stored, so a crash or
// kill can't leave a stale value on disk - every reader recomputes it from what's actually on
// disk right now. One module so src/cli.js (item 3's state.json writer) and src/mcp/server.js
// (list_runs, run_status) can't drift on what "running" means.
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// A run's unanswered external-pause label, if any - the same NEEDS-<label>.md-without-a-
// matching-<label>.md convention src/mcp/server.js's own `waiting()` already used before this
// module existed; kept here so both files call one implementation.
// The artifact gate's marker (src/cli.js). Deliberately not NEEDS-*: a NEEDS- file means "waiting
// for an external seat", and a blocked run must never read as one - resuming it would send the
// unfenced task to every seat (bug audit 2026-09-23, CLI #2). NEEDS-ARTIFACTS.md is the pre-fix
// name, still recognised as blocked for run folders written before it.
export const ARTIFACTS_BLOCKED_FILE = 'BLOCKED-ARTIFACTS.md';

// The exact shape of a run folder's name: a plain ISO timestamp, or a --rematch/--replay side run
// of one. Anything that takes a run id from outside (the MCP tools, the run viewer) accepts this and
// nothing else, so an id is never a path.
export const RUN_FOLDER = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2}))?$/;
const LEGACY_ARTIFACTS_BLOCKED_FILE = 'NEEDS-ARTIFACTS.md';
export function artifactsBlocked(dir) {
  return existsSync(join(dir, ARTIFACTS_BLOCKED_FILE)) || existsSync(join(dir, LEGACY_ARTIFACTS_BLOCKED_FILE));
}

/** Every external stage a run is waiting on, sorted (directory order is not stable across systems). */
export function waitingStages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.startsWith('NEEDS-') && f !== LEGACY_ARTIFACTS_BLOCKED_FILE)
    .map(f => f.slice(6, -3))
    .filter(l => !existsSync(join(dir, `${l}.md`)))
    .sort();
}

export function waitingStage(dir) {
  return waitingStages(dir)[0] || null;
}

// A specific pid, checked directly - real liveness, not an approximation.
export function isAlivePid(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Pre-v5 fallback for run folders whose run.json (if any) has no `pid` field: any live cli.js
// process at all, the same "cheap approximation" the pre-v5 code used - kept only for folders
// this version cannot do better on, never for a folder that does carry a real pid.
export function isAliveByGrep() {
  try {
    const out = execFileSync('pgrep', ['-af', process.pkg ? process.execPath : 'src/cli.js'], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// dir: the run folder. runMeta: parsed run.json, or null/undefined if absent/unreadable.
// Returns one of: 'done' | 'budget_stopped' | 'failed' | 'blocked' | 'paused' | 'running' | 'stopped'.
// 'blocked' (added 2026-09-23, additive): the artifact gate stopped it before any call; fix the
// task (fence the named files), then resume - resuming alone re-runs the gate and stops again.
export function deriveRunStatus(dir, runMeta) {
  if (existsSync(join(dir, 'report.json'))) return 'done';
  if (existsSync(join(dir, 'STOPPED-budget.json'))) return 'budget_stopped';
  // CLI audit #5: a run that stopped at an unexpected error (exit 16) says so, instead of 'stopped'.
  if (existsSync(join(dir, 'STOPPED-error.md'))) return 'failed';
  if (artifactsBlocked(dir)) return 'blocked';
  if (waitingStage(dir)) return 'paused';
  const alive = runMeta && runMeta.pid ? isAlivePid(runMeta.pid) : isAliveByGrep();
  return alive ? 'running' : 'stopped';
}

// The `state` text for a run that has a report.json. Bug-audit fix, 2026-09-23
// (Review/BugAudit_GuardLayer_2026-09-23.md #5): a run whose final security gate blocked (exit 7)
// or could not judge (exit 8) still carries passed:true from the panel, and a detached run's exit
// code never reaches the MCP server - so it read "every lab signed off". The gate outranks the panel.
export function finishedRunState(report) {
  const gate = report?.security_review?.gate;
  if (gate && gate !== 'pass') {
    return `done: security gate ${gate} - not a pass${report.passed ? ' (the panel signed off, the security review did not)' : ''}`;
  }
  return report?.passed ? 'done: every lab signed off' : 'done: open objections';
}
