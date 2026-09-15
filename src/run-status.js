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
export function waitingStage(dir) {
  if (!existsSync(dir)) return null;
  const w = readdirSync(dir)
    .filter(f => f.startsWith('NEEDS-'))
    .map(f => f.slice(6, -3))
    .filter(l => !existsSync(join(dir, `${l}.md`)));
  return w[0] || null;
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
// Returns one of: 'done' | 'budget_stopped' | 'paused' | 'running' | 'stopped'.
export function deriveRunStatus(dir, runMeta) {
  if (existsSync(join(dir, 'report.json'))) return 'done';
  if (existsSync(join(dir, 'STOPPED-budget.json'))) return 'budget_stopped';
  if (waitingStage(dir)) return 'paused';
  const alive = runMeta && runMeta.pid ? isAlivePid(runMeta.pid) : isAliveByGrep();
  return alive ? 'running' : 'stopped';
}
