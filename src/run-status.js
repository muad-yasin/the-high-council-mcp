// v5 item 2: run identity and per-run liveness. Status is derived, never stored, so a crash or
// kill can't leave a stale value on disk - every reader recomputes it from what's actually on
// disk right now. One module so src/cli.js (item 3's state.json writer) and src/mcp/server.js
// (list_runs, run_status) can't drift on what "running" means.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, basename } from 'node:path';
import { listGates, readGateAnswer, runCapAuthority, RUN_CAP_KIND } from './gate.js';
import { readStoppedMarker, STOP_STATUS, isAdviceFolder } from './stop-files.js';
import { changedByWords } from './text-labels.js';
import { lockHolder } from './run-lock.js';
import { readRunJson } from './run-files.js';
import { resumeCeilingUsd } from './resume-ceiling.js';
import { verdictWords, adviceWords, gateWords, earlyFinishWords } from './verdict-headline.js';

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

// The file the SERVER writes into a run folder at every spawn it makes (start_run, an advice start, resume_run): the child's pid, host and the time. It exists because
// "no live lock holder" must not read as "stopped" for a child that was just spawned and has not taken the lock yet (the advice path's folder already exists at the spawn; a
// resume's old run.json pid is dead): `until: settled` settles on anything that is not `running`, so a starting run reading `stopped` would settle early. Written fresh on every spawn.
export const SPAWN_FILE = '.spawn.json';
export function readSpawn(dir) {
  const r = readRunJson(dir, SPAWN_FILE);
  return r && typeof r === 'object' && Number.isInteger(r.pid) && typeof r.host === 'string' ? r : null;
}

// Is a process working on this run folder right now? READ ORDER (13 Oct 2026, stated once): (1) a LIVE LOCK HOLDER on this host (src/run-lock.js: the run takes the lock
// right after it makes its folder); (2) a live SPAWN pid on this host (.spawn.json, the window between the server's spawn and the child's lock); (3) the pid in run.json
// (a run older than its lock); otherwise NOT alive. `running` is only ever said about a pid that is alive on this host. There is no machine-wide search for "any council
// process": that answered `running` for a dead run whenever anything else was running (a parallel test, another session; in the packaged binary the server's own process),
// and then `run_status until: settled` held to its limit. A holder on another host or an unreadable lock file is not a pid we can check, so it does not count.
export function isRunAlive(dir, runMeta) {
  const h = lockHolder(dir);
  if (h && h.host === hostname() && isAlivePid(h.pid)) return true;
  const sp = readSpawn(dir);
  if (sp && sp.host === hostname() && isAlivePid(sp.pid)) return true;
  return !!(runMeta && runMeta.pid && isAlivePid(runMeta.pid));
}

// dir: the run folder. runMeta: parsed run.json, or null/undefined if absent/unreadable.
// Returns one of: 'done' | 'budget_stopped' | 'failed' | 'user_stopped' | 'client_cancel_stopped' | 'wall_clock_stopped' | 'blocked' |
// 'paused' | 'running' | 'stopped', or an approval status of an advice folder before its start.
// The three '<cause>_stopped' (0.8.1 M6, decided rule 6; 'user_stopped' since brief 29): an advice run ended at exit 18 because a
// person, a client or its wall clock stopped it (STOPPED-<cause>.json), before or after paid calls.
// 'blocked' (added 2026-09-23, additive): the artifact gate stopped it before any call; fix the
// task (fence the named files), then resume - resuming alone re-runs the gate and stops again.
/**
 * 0.8.3 M6 typed cap T4a (typed-cap gate page section 8): a paid run that exited 21 is waiting for a limit that a person types. -> { gate } of its newest `run_cap` gate that is pending, or approved and not yet used, requested after the last limit consumed for the run (or the first, when none was); null otherwise (a run that has consumed its limit is a normal run, a run with no limit gate is a free or an older one). A READ: it writes nothing.
 */
export function awaitingUserCap(dir) {
  const gates = listGates(dir);
  if (!gates) return null;
  // T4b2: a run may carry several consumptions; what it waits for is a pending (or approved, unused) limit gate REQUESTED AFTER the last consumption (a raise or an amendment), or the first one when nothing was consumed yet.
  const auth = runCapAuthority(dir);
  if (auth.status === 'invalid') return null;
  const since = auth.status === 'ok' ? auth.seq : 0;
  let waiting = null;
  for (const g of gates) {
    const st = readGateAnswer(dir, g.id);
    if (st.gate?.kind === RUN_CAP_KIND && st.gate.seq > since && (st.status === 'pending' || (st.status === 'approved' && st.usable))) waiting = g.id;
  }
  return waiting ? { gate: waiting } : null;
}

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
  if (awaitingUserCap(dir)) return 'awaiting_user_cap';
  // 0.8.1 DR-15: an advice call's folder exists before anyone approves it. With no run.json yet, its gate says where it stands;
  // without this it read as a crashed run, resumable.
  const beforeStart = !existsSync(join(dir, 'run.json')) && approvalStatus(dir);
  if (beforeStart) return beforeStart;
  return isRunAlive(dir, runMeta) ? 'running' : 'stopped';
}

// The `state` text for a run that has a report.json. Bug-audit fix, 2026-09-23
// (Review/BugAudit_GuardLayer_2026-09-23.md #5): a run whose final security gate blocked (exit 7)
// or could not judge (exit 8) still carries passed:true from the panel, and a detached run's exit
// code never reaches the MCP server - so it read "every lab signed off". The gate outranks the panel.
export function finishedRunState(report) {
  const gate = gateWords(report);
  if (gate) return `done: ${gate}`;
  // An advice call (src/advise.js) has no sign-off: say what it is (brief 29).
  if (report?.advise?.status === 'answered') {
    return `done: ${adviceWords(report.advise)}`;
  }
  if (!report?.passed) return earlyFinishWords(report) ? 'done: open objections; finished early by the session (not agreed)' : 'done: open objections';
  // 0.8.2 item 4: the panel signed one draft and a later model stage changed what is delivered. ADDITIVE (C&C ruling, 6 Oct 2026): the old sentence stays the start, so a matcher on it still matches.
  const d = report.delivered_text;
  if (d && d.same_as_signed === false) { const by = changedByWords(d); return `done: ${verdictWords(report)}, on the signed draft; the delivered text differs${by ? ` (changed by ${by})` : ''}`; }
  return `done: ${verdictWords(report)}`;
}

// Can this run be continued, and what does that take? 0.8.0 WM0 item 4. Derived from the marker files
// the CLI leaves, like deriveRunStatus above (nothing is stored), so it is right for a run of any
// age and for a run whose process is gone. `status` is deriveRunStatus's word; `reason` is finer
// (a truncated draft and an unreachable seat are both 'stopped'/'failed' there); `needs` is what
// has to happen before --resume can get further:
//   nothing            resume as is (a process that died)
//   answer             write the answer file for each stage in `waiting`, then resume
//   higher_cap         resume with a --max-usd above what was spent (it is a total, not extra); `suggestedMaxUsd` is a ceiling that gets past the stop
//   person_choice      the run stopped because the conflict decider asked for the person (E4b unit 3): `--resume <run> --prevail n=<id>|neither` (a tree MEMBER: its stop sentence, stoppedAt.reason, names the tree's `tree decide --prevail-node` command instead; cli.js refuses `--prevail` on a member's folder); a plain resume only says so again at $0; MCP has no verb for the choice
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

/** The folder names a --rematch / --replay makes (`<run id>.rematch-<seed>`, `<run id>.replay-<date>`): the folders --resume refuses. */
export const SIDE_FOLDER_NAME = /\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2})$/;
export function runResumability(dir, runMeta) {
  const status = deriveRunStatus(dir, runMeta);
  const out = (resumable, reason, needs, extra = {}) => ({ status, resumable, reason, needs, ...extra });
  if (status === 'done') return out(false, 'finished', null);
  if (status === 'running') return out(false, 'running', null);
  // 0.8.3 M6 typed cap T4a: a paid run that exited 21 waits for a limit a person types; `council gate answer`, then --resume, is the way on (never a plain resume: it would ask again).
  // T5a: a --rematch / --replay folder waits for its limit too, but --resume refuses those folders (cli.js, src/mcp/server.js): the way on is to answer the gate and run the SAME rematch / replay command again, so it is not 'resumable'.
  if (status === 'awaiting_user_cap' && SIDE_FOLDER_NAME.test(basename(dir))) return out(false, 'side_command_awaiting_limit', 'type_limit_and_rerun', { gate: awaitingUserCap(dir)?.gate ?? null });
  if (status === 'awaiting_user_cap') return out(true, 'awaiting_user_cap', 'type_limit', { gate: awaitingUserCap(dir)?.gate ?? null });
  // 0.8.1 M6: whether a stopped run resumes belongs to its chain (decided rule 6). The run recorded its chain's resumeAfterStop in the
  // marker; no chain file is read here. Every shipped advice chain says false. An unreadable marker reads not resumable (the only
  // runs that can be stopped in 0.8.1 are advice runs, which do not resume).
  // A3a commit 2 (18 Okt 2026, C&C ruling F3): a run stopped because OpenRouter refused a seat at its price pin is resumable, but not before the cause is fixed (a pricing.user.json row; the stop sentence in stoppedAt.reason says so),
  // so it reads `fix_cause` like an error stop, not the round stop's 'nothing' (an MCP agent would resume at once and meet the same refusal). No new enum value.
  if (status === STOP_STATUS.price_refused && readStoppedMarker(dir)?.stoppedBy === 'price_refused') {
    const m = readStoppedMarker(dir);
    const again = m?.data?.resumeAfterStop === true;
    return out(again, status, again ? 'fix_cause' : null, { stoppedAt: m?.data ?? null, stoppedBy: 'price_refused' });
  }
  // E4b unit 3: a run stopped because the conflict decider asked for the person is resumable only with a choice (`--resume --prevail ...`, or for a tree member the tree's own verb, named in the marker's sentence that `stoppedAt` carries; a plain resume says so again at $0), so it reads `person_choice`: ONE additive word (no existing word means
  // "a person chooses at a terminal"; `nothing` is what let an MCP agent loop on the round stop). MCP has no verb for the choice.
  if (status === STOP_STATUS.conflict && readStoppedMarker(dir)?.stoppedBy === 'conflict') {
    const m = readStoppedMarker(dir);
    const again = m?.data?.resumeAfterStop === true;
    return out(again, status, again ? 'person_choice' : null, { stoppedAt: m?.data ?? null, stoppedBy: 'conflict' });
  }
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
  if (status === 'budget_stopped') {
    const stoppedAt = readJsonSafe(join(dir, 'STOPPED-budget.json'));
    // Cost-unit U1 split (14 Oct 2026): `spentUsd` in that file is the RECORDED spend; the cap also counted a worst case for replayed stages with no recorded figure (`assumedAtWorstCase.usd`). `suggestedMaxUsd` is the ceiling that gets past this stop, computed
    // exactly as the CLI's printed resume command is (src/cost.js resumeCeilingUsd), so "above what was spent" cannot under-shoot. Additive; null when the file does not hold the figures.
    const suggestedMaxUsd = stoppedAt ? resumeCeilingUsd({ cap: stoppedAt.capUsd, spent: stoppedAt.spentUsd + (stoppedAt.assumedAtWorstCase?.usd || 0), projected: stoppedAt.projectedStageUsd }) : null;
    return out(true, 'budget', 'higher_cap', { stoppedAt, suggestedMaxUsd });
  }
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
