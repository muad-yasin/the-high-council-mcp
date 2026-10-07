// v5 item 2: run identity and per-run liveness. Status is derived, never stored, so a crash or
// kill can't leave a stale value on disk - every reader recomputes it from what's actually on
// disk right now. One module so src/cli.js (item 3's state.json writer) and src/mcp/server.js
// (list_runs, run_status) can't drift on what "running" means.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { listGates, readGateAnswer } from './gate.js';
import { readStoppedMarker, STOP_STATUS, isAdviceFolder } from './stop-files.js';
import { changedByWords } from './text-labels.js';

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
// Bug audit 2026-09-28 (area 4 LOW-2): `council init` names its example run `<iso>-init`, which
// list_runs showed but run_status and the viewer refused.
export const RUN_FOLDER = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-init|\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2}))?$/;
const LEGACY_ARTIFACTS_BLOCKED_FILE = 'NEEDS-ARTIFACTS.md';
export function artifactsBlocked(dir) {
  return existsSync(join(dir, ARTIFACTS_BLOCKED_FILE)) || existsSync(join(dir, LEGACY_ARTIFACTS_BLOCKED_FILE));
}

/** Every external stage a run is waiting on, sorted (directory order is not stable across systems). */
// The marker files of a run stopped short that is neither the spend cap nor an error: one list, read by deriveRunStatus, `council --spend` and the handoff banner (audit A5-3).
export const STOPPED_SHORT_FILES = Object.freeze(['STOPPED-truncated.json', 'STOPPED-truncated.md', 'STOPPED-preflight.md', 'STOPPED-secret.md']);
export const stoppedShortFile = dir => STOPPED_SHORT_FILES.find(f => existsSync(join(dir, f))) ?? null;

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
// Returns one of: 'done' | 'budget_stopped' | 'failed' | 'user_stopped' | 'client_cancel_stopped' | 'wall_clock_stopped' | 'blocked' |
// 'paused' | 'running' | 'stopped', or an approval status of an advice folder before its start.
// The three '<cause>_stopped' (0.8.1 M6, decided rule 6; 'user_stopped' since brief 29): an advice run ended at exit 18 because a
// person, a client or its wall clock stopped it (STOPPED-<cause>.json), before or after paid calls.
// 'blocked' (added 2026-09-23, additive): the artifact gate stopped it before any call; fix the
// task (fence the named files), then resume - resuming alone re-runs the gate and stops again.
export function deriveRunStatus(dir, runMeta) {
  if (existsSync(join(dir, 'report.json'))) return 'done';
  if (existsSync(join(dir, 'STOPPED-budget.json'))) return 'budget_stopped';
  // CLI audit #5: a run that stopped at an unexpected error (exit 16) says so, instead of 'stopped'.
  if (existsSync(join(dir, 'STOPPED-error.md'))) return 'failed';
  const stop = readStoppedMarker(dir);
  if (stop) return STOP_STATUS[stop.stoppedBy];
  // 0.8.1 FX-7: a cut-off draft, a preflight objection and a key-shaped prompt each end the run with a marker. Without
  // these checks the stop exit's own state write saw its still-living process and wrote "running". A resume removes all
  // three markers before it starts (src/cli.js), so a stale one cannot shadow a live resume.
  if (stoppedShortFile(dir)) return 'stopped';
  if (artifactsBlocked(dir)) return 'blocked';
  if (waitingStage(dir)) return 'paused';
  // 0.8.1 DR-15: an advice call's folder exists before anyone approves it. With no run.json yet, its gate says where it stands;
  // without this it read as a crashed run, resumable.
  const beforeStart = !existsSync(join(dir, 'run.json')) && approvalStatus(dir);
  if (beforeStart) return beforeStart;
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
  // An advice call (src/advise.js) has no sign-off: say what it is (brief 29).
  if (report?.advise?.status === 'answered') {
    const a = report.advise;
    return `done: advice from ${a.seats_answered} of ${a.seats_asked} seat(s), leaning ${String(a.verdict).replace('_', ' ')}${a.stopped_by ? ` (stopped early: ${a.stopped_by})` : ''}`;
  }
  if (!report?.passed) return 'done: open objections';
  // 0.8.2 item 4: the panel signed one draft and a later model stage changed what is delivered. ADDITIVE (C&C ruling, 6 Oct 2026): the old sentence stays the start, so a matcher on it still matches.
  const d = report.delivered_text;
  if (d && d.same_as_signed === false) { const by = changedByWords(d); return `done: every lab signed off, on the signed draft; the delivered text differs${by ? ` (changed by ${by})` : ''}`; }
  return 'done: every lab signed off';
}

// Can this run be continued, and what does that take? 0.8.0 WM0 item 4. Derived from the marker files
// the CLI leaves, like deriveRunStatus above (nothing is stored), so it is right for a run of any
// age and for a run whose process is gone. `status` is deriveRunStatus's word; `reason` is finer
// (a truncated draft and an unreachable seat are both 'stopped'/'failed' there); `needs` is what
// has to happen before --resume can get further:
//   nothing            resume as is (a process that died)
//   answer             write the answer file for each stage in `waiting`, then resume
//   higher_cap         resume with a --max-usd above what was spent (it is a total, not extra)
//   fix_cause          the run stopped at an error, or on a key-shaped prompt (secret_blocked: fix the cause, or resume
//                      with --allow-secret-shaped); a transient error may pass on its own next time
//   raise_max_tokens   a draft was cut off; raise that seat's maxTokens in the chain, then resume
//   replace_reply      a draft stage's reply held no draft (only DECLINED lines): replace <stage>.md, then resume
//   fix_task           the task itself was refused (fence it, or --allow-unfenced); the task is frozen
//                      once a run starts, so a preflight objection needs a new run
// `resumable` is false only where a resume cannot help: a finished run, one already running, a
// preflight objection, and an advice call stopped before its first paid call (advice runs never resume).
const readJsonSafe = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// The status of an advice call's folder before its run starts, from its last gate, or null when the folder has no gate (or its
// approved gate was already used: the run is starting, and the usual checks apply).
export const APPROVAL_STATUSES = Object.freeze(['awaiting_approval', 'approved', 'declined', 'approval_expired', 'approval_invalid']);
function approvalStatus(dir) {
  const gates = listGates(dir);
  if (gates === null) return 'approval_invalid';
  if (!gates.length) return null;
  const last = readGateAnswer(dir, gates.at(-1).id);
  if (last.status === 'pending') return 'awaiting_approval';
  if (last.status === 'declined') return 'declined';
  if (last.status === 'expired') return 'approval_expired';
  if (last.status === 'approved') return last.used ? null : last.usable ? 'approved' : 'approval_expired';
  return 'approval_invalid';
}

export function runResumability(dir, runMeta) {
  const status = deriveRunStatus(dir, runMeta);
  const out = (resumable, reason, needs, extra = {}) => ({ status, resumable, reason, needs, ...extra });
  if (status === 'done') return out(false, 'finished', null);
  if (status === 'running') return out(false, 'running', null);
  // 0.8.1 M6: whether a stopped run resumes belongs to its chain (decided rule 6). The run recorded its chain's resumeAfterStop in the
  // marker; no chain file is read here. Every shipped advice chain says false. An unreadable marker reads not resumable (the only
  // runs that can be stopped in 0.8.1 are advice runs, which do not resume).
  if (Object.values(STOP_STATUS).includes(status)) {
    const m = readStoppedMarker(dir);
    const again = m?.data?.resumeAfterStop === true;
    return out(again, status, again ? 'nothing' : null, { stoppedAt: m?.data ?? null, stoppedBy: m?.stoppedBy ?? null });
  }
  // An advice call before its start is never resumed: it is approved (council gate answer, or the client's dialog) and then
  // started by its own tool call, or it lapses.
  if (APPROVAL_STATUSES.includes(status)) return out(false, status, status === 'awaiting_approval' ? 'approval' : null);
  // 0.8.1 decided rule 6 (M6 review D3): an advice call is never resumed, whatever ended it (a crash, its cap, an error); it is asked
  // again. resume_run and `council --resume` refuse it; this says the same instead of offering a resume they would refuse.
  if (isAdviceFolder(dir)) return out(false, 'advice_call', null);
  if (status === 'budget_stopped') return out(true, 'budget', 'higher_cap', { stoppedAt: readJsonSafe(join(dir, 'STOPPED-budget.json')) });
  if (status === 'paused') return out(true, 'external_pause', 'answer', { waiting: waitingStages(dir) });
  if (status === 'blocked') return out(true, 'artifacts_blocked', 'fix_task');
  if (status === 'failed') {
    const e = readJsonSafe(join(dir, 'STOPPED-error.json'));
    // A run stopped before this file existed carries only STOPPED-error.md: resumable, cause unknown.
    return out(true, e ? (e.transient ? 'error_transient' : 'error') : 'error', 'fix_cause', e ? { error: e } : {});
  }
  if (existsSync(join(dir, 'STOPPED-truncated.json'))) {
    const t = readJsonSafe(join(dir, 'STOPPED-truncated.json'));
    // Audit A5-7: a reply that is only DECLINED lines is no draft: a bigger token limit does not help, the reply must be replaced.
    return out(true, 'draft_truncated', t?.stop === 'declined_only' ? 'replace_reply' : 'raise_max_tokens', { stoppedAt: t });
  }
  if (existsSync(join(dir, 'STOPPED-preflight.md'))) return out(false, 'preflight_blocked', 'fix_task');
  // 0.8.1 FX-8: a key-shaped prompt stop. It used to read as process_gone with nothing to do. A resume can help (the stop
  // file says so: fix the cause, or resume with --allow-secret-shaped), so it stays resumable; it needs the cause looked at.
  // The plan said resumable false; recorded as a deviation (Review/0.8.1-decisions.md).
  if (existsSync(join(dir, 'STOPPED-secret.md'))) return out(true, 'secret_blocked', 'fix_cause', { stoppedAt: 'STOPPED-secret.md' });
  // No marker and no live process: the run was killed, crashed or lost its machine. Every finished
  // stage is on disk, so a resume replays them and carries on.
  return out(true, 'process_gone', 'nothing');
}
