// v5 item 2: run identity and per-run liveness. Status is derived, never stored, so a crash or
// kill can't leave a stale value on disk - every reader recomputes it from what's actually on
// disk right now. One module so src/cli.js (item 3's state.json writer) and src/mcp/server.js
// (list_runs, run_status) can't drift on what "running" means.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { finalReadBlocksAgreement } from './final-read.js';
import { hostname } from 'node:os';
import { join, basename } from 'node:path';
import { stopShaOf } from './spend-finish.js';
import { budgetFinishRecordFor, listGates, readGateAnswer, runCapAuthority, excerptApprovalStops, excerptApprovalWaiting, gatesOfKind, EXCERPT_APPROVAL_KIND, excerptSwitchOf, SHOWN_LINES_MAX, EXCERPT_LINE_NUMBER_MAX, RUN_CAP_KIND, GATE_ID } from './gate.js';
import { EXIT_AWAITING_EXCERPT_APPROVAL } from './exit-codes.js';
import { rebindsLater } from './excerpt-pause.js';
import { readStoppedMarker, STOP_STATUS, isAdviceFolder } from './stop-files.js';
import { readSecretStop, secretFinishState, secretPauseFiles } from './secret-pause.js';
import { deliveredDiffersClause } from './text-labels.js';
import { lockHolder } from './run-lock.js';
import { readRunJson } from './run-files.js';
import { resumeCeilingUsd } from './resume-ceiling.js';
import { verdictWords, adviceWords, gateWords, earlyFinishWords, secretFinishWords, budgetFinishWords, endingWords, agreedAfterEscalationWords, finishedAtStopWords, ownerPauseFinishWords, stagesNotRunWords } from './verdict-headline.js';
import { nothingStandsAtEnd, finishedEarlyNothingOpen } from './ending-matrix.js';
import { topLayerOf, layerWord } from './top-layer.js';

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
// Returns one of: 'done' | 'budget_stopped' | 'failed' | 'blocked' |
// 'paused' | 'running' | 'stopped' (and the stop statuses of stop-files.js STOP_STATUS).
// 'blocked' (added 2026-09-23, additive): the artifact gate stopped it before any call; fix the
// task (fence the named files), then resume - resuming alone re-runs the gate and stops again.
/**
 * 0.8.3 M6 typed cap T4a (typed-cap gate page section 8): a paid run that exited 21 is waiting for a limit that a person types. -> { gate } of its newest `run_cap` gate that is pending, or approved and not yet used, requested after the last limit consumed for the run (or the first, when none was); null otherwise (a run that has consumed its limit is a normal run, a run with no limit gate is a free or an older one). A READ: it writes nothing.
 */
/**
 * 0.8.4 D10 slice 2c: a run stopped at an excerpt approval. -> { gate, status } of its first excerpt_approval gate with NO `excerpts_recorded` line that STOPS a resume (excerptApprovalStops; the same basis as the resume refusal in src/cli.js), or null
 * (none waits, or the ledger cannot be read: then the readers that need it say so). The words of the state are src/exit-codes.js EXIT_AWAITING_EXCERPT_APPROVAL's.
 */
/**
 * 0.8.4 F3 (H-F3-b): true when `id` has the shape of a gate id (src/gate.js GATE_ID, the one copy). src/mcp/server.js asks it here, and imports no gate module itself (test/gate-answer.test.js scans for that), before it shows
 * a gate id read from the run's ledger, which anything that can write the run folder can append to.
 */
export const isGateId = id => typeof id === 'string' && GATE_ID.test(id);
/**
 * C&C 09 Nov 2026 (the reader-list finding, then its expired twin): an excerpt gate that does NOT stop a resume but needs one: the person has ANSWERED it (approved or declined) and no resume has applied it yet, or it EXPIRED unanswered
 * (the next resume asks again). With the privacy switch on neither stops a resume (excerptApprovalStops); the run needs exactly one thing, a resume, so run_status says it, as awaitingUserCap says an approved-unused limit gate.
 * -> { gate, status } (status approved, declined or expired) of the first such gate, or null (the switch is off, or none is). With the switch off every such gate STOPS a resume and awaitingExcerptApproval reports it.
 */
export function awaitingExcerptResume(dir) {
  const w = excerptApprovalWaiting(dir);
  const sw = excerptSwitchOf(dir);
  if (!w.ok || !(sw.ok === true && sw.on === true)) return null;
  // a gate that was asked again (a newer gate binds some of its ids) is superseded: the newer one is the state (an expired gate never gets a use line, so it stays in the waiting list for the rest of the run)
  const every = gatesOfKind(dir, EXCERPT_APPROVAL_KIND).map(x => ({ id: x.gate, excerpts: readGateAnswer(dir, x.gate).gate?.excerpts }));
  const g = w.waiting.find(x => (x.status === 'approved' || x.status === 'declined' || x.status === 'expired') && !rebindsLater(x.gate, every.find(e => e.id === x.gate)?.excerpts, every));
  return g ? { gate: g.gate, status: g.status } : null;
}
export function awaitingExcerptApproval(dir) {
  const w = excerptApprovalStops(dir);
  return w.ok && w.waiting.length ? { gate: w.waiting[0].gate, status: w.waiting[0].status } : null;
}
/**
 * 0.8.4 D10 (C&C 09 Nov 2026, ruling (ii)): the privacy switch as the run's ledger holds it, with the two bounds an approval gate cannot go past, for the one caller that must not look at the ledger itself
 * (src/stage-submission.js may not reach the gate, test/gate-answer.test.js: its caller, src/mcp/server.js, hands it this function as the `excerptSwitch` option). -> { ok: true, on, shownLinesMax, lineNumberMax } | { ok: false, message } (a ledger that cannot be verified is never read as "off").
 */
export function excerptSwitchForSubmit(dir) {
  const sw = excerptSwitchOf(dir);
  return sw.ok ? { ok: true, on: sw.on === true, shownLinesMax: SHOWN_LINES_MAX, lineNumberMax: EXCERPT_LINE_NUMBER_MAX } : { ok: false, message: sw.message };
}
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
/**
 * DUALCAP 4c2: every limit a run waits for, ONE per cap: [{ gate, capName }] sorted by cap (capName null for a run with one limit). Per cap, the newest run_cap gate of
 * that cap that is pending, or approved and not yet used, requested after that cap's last consumption (awaitingUserCap's rule, read per cap). [] when none.
 */
export function awaitingUserCaps(dir) {
  const gates = listGates(dir);
  if (!gates) return [];
  const byCap = new Map();
  for (const g of gates) {
    const st = readGateAnswer(dir, g.id);
    if (st.gate?.kind !== RUN_CAP_KIND) continue;
    const capName = typeof st.gate.cap?.cap_name === 'string' ? st.gate.cap.cap_name : null;
    if (!byCap.has(capName)) byCap.set(capName, []);
    byCap.get(capName).push({ id: g.id, st });
  }
  const out = [];
  for (const [capName, list] of byCap) {
    const auth = runCapAuthority(dir, { capName });
    if (auth.status === 'invalid') continue;
    const since = auth.status === 'ok' ? auth.seq : 0;
    let waiting = null;
    for (const { id, st } of list) if (st.gate.seq > since && (st.status === 'pending' || (st.status === 'approved' && st.usable))) waiting = id;
    if (waiting) out.push({ gate: waiting, capName });
  }
  return out.sort((a, b) => String(a.capName ?? '').localeCompare(String(b.capName ?? '')));
}

/** Whether the person's --finish-now is on the ledger FOR the spending stop this folder holds (bound by the stop's hash; false when the stop file or the ledger cannot be read). */
/** WORDING LAD-B15: what a status says of a run that holds the person's recorded finish-now: a resume ENDS the run on that choice. */
export const BUDGET_FINISH_NOTE = "the person has recorded --finish-now for this spending stop: a resume ENDS the run on that choice (no limit is asked for, no judge reads the plan again); to raise the limit instead, resume with --raise-cap";
/** WORDING LAD-R18 (A-DRAFT): a pause marker with no whole record (a crash between the two writes, or a folder from an earlier build): only a terminal answers it, and its plain resume pauses it again and writes the record. */
export const SECRET_RECORD_MISSING_NOTE = 'paused at a credential-shaped string, but the pause record was not written: only a command typed at a terminal answers it, and `council --resume <run>` there pauses it again and writes the record (no MCP tool answers it, and resume_run starts nothing when the run also holds a spending stop).';
/** WORDING LAD-R6 (A-DRAFT): run_status of a run stopped at its spending limit INSIDE or AFTER the review rounds names the ways on, and any limit question that is open. */
export const budgetWaysNote = (dir, stoppedAt, runMeta = null) => {
  if (!stoppedAt || runMeta?.tree || (stoppedAt.phase !== 'loop' && stoppedAt.phase !== 'after')) return null;   // a tree member is resumed and decided by its tree, never through this tool
  const open = awaitingUserCap(dir)?.gate;
  return `stopped at the spending limit: the person raises the limit (resume_run with their words, or at a terminal), or ends the run here at no cost (stop_decide: step quote, then step answer with finish_now and the person's own words; at a terminal --finish-now).${open ? ` A limit question is open (gate ${open}): the person answers it, or ends the run here instead.` : ''}`;
};
export function budgetFinishRecordedAt(dir) {
  const sha = stopShaOf(readJsonSafe(join(dir, 'STOPPED-budget.json')));
  return !!(sha && budgetFinishRecordFor(dir, sha));
}
export function deriveRunStatus(dir, runMeta) {
  if (existsSync(join(dir, 'report.json'))) return 'done';
  // 0.8.4 (C&C 09 Nov 2026, carried fix): an excerpt approval that stops a resume is the state, whatever marker the run also carries (an owner pause, a budget stop): a resume is refused with exit 26 first, so the state must not say
  // owner_paused while the refusal says 26.
  if (awaitingExcerptApproval(dir)) return 'awaiting_excerpt_approval';
  // 0.8.4 (ladder unit, ONE finish-now ends the run): a spending stop whose stop the person's recorded --finish-now is FOR is no longer waiting for a higher limit: the run waits for whatever else stops it (a session's answer, a credential pause) and then for the resume that ends it.
  const budgetFile = existsSync(join(dir, 'STOPPED-budget.json'));
  const finishRecorded = budgetFile && budgetFinishRecordedAt(dir);
  // a found-secret pause that sits beside the spending stop's files (a deferred-clear sitting met a credential-shaped prompt) is named FIRST: only the terminal answers it, and a status that asked for a higher limit would send the person to the wrong question
  const secretPaused = secretPauseFiles(dir).marker;   // the ONE reader (src/secret-pause.js): a pause is the marker the terminal's commands test
  if (budgetFile && !finishRecorded && !secretPaused) return 'budget_stopped';
  // CLI audit #5: a run that stopped at an unexpected error (exit 16) says so, instead of 'stopped'.
  if (existsSync(join(dir, 'STOPPED-error.md'))) return 'failed';
  const stop = readStoppedMarker(dir);
  if (stop) return STOP_STATUS[stop.stoppedBy];
  // 0.8.1 FX-7: a cut-off draft, a preflight objection and a key-shaped prompt each end the run with a marker. Without
  // these checks the stop exit's own state write saw its still-living process and wrote "running". A resume removes all
  // three markers before it starts (src/cli.js), so a stale one cannot shadow a live resume.
  if (stoppedShortFile(dir)) return 'stopped';
  if (artifactsBlocked(dir)) return 'blocked';
  // (the excerpt approval was checked first, above: nothing can go on, not even the answer to an external stage, until the person has answered the excerpts)
  if (awaitingExcerptResume(dir)) return 'awaiting_excerpt_approval';   // (after the markers, before an external stage that waits, as the approval that stops is placed first) answered and not yet applied, or expired: the next resume applies it or asks again (resumable; runResumability says so)
  if (waitingStage(dir)) return 'paused';
  if (finishRecorded && !secretPaused) return 'budget_stopped';   // nothing else waits: the resume that ends the run
  if (awaitingUserCap(dir)) return 'awaiting_user_cap';
  return isRunAlive(dir, runMeta) ? 'running' : 'stopped';
}

// The `state` text for a run that has a report.json. Bug-audit fix, 2026-09-23
// (Review/BugAudit_GuardLayer_2026-09-23.md #5): a run whose final security gate blocked (exit 7)
// or could not judge (exit 8) still carries passed:true from the panel, and a detached run's exit
// code never reaches the MCP server - so it read "every lab signed off". The gate outranks the panel.
export function finishedRunState(report) {
  const core = finishedRunStateCore(report);
  const notRun = stagesNotRunWords(report);   // 0.8.4 (LAD-B4): a run ended at the spending limit says which calls were not made, after the verdict it keeps
  return notRun ? `${core} (${notRun})` : core;
}
function finishedRunStateCore(report) {
  const gate = gateWords(report);
  if (gate) return `done: ${gate}`;
  // An advice call (src/advise.js) has no sign-off: say what it is (brief 29).
  if (report?.advise?.status === 'answered') {
    return `done: ${adviceWords(report.advise)}`;
  }
  if (finalReadBlocksAgreement(report?.final_read)) return `done: not agreed (${layerWord(topLayerOf({ layers: report?.layers, finalRead: report?.final_read }))} did not clear the final plan; see final_read in report.json)`;   // unit D, A-DRAFT: an agreed run that layer 3 objected to, or did not read, at the end
  if (endingWords(report)) return `done: not agreed (${endingWords(report)}; see ending in report.json)`;   // 0.8.4 S4, A-DRAFT: layer 3 signed off, the run does not end agreed
  if (agreedAfterEscalationWords(report)) return `done: ${agreedAfterEscalationWords(report)}`;   // an escalated sign-off the handler agreed: `passed` is false, the run is agreed
  if (!report?.passed) {
    if (earlyFinishWords(report)) return finishedEarlyNothingOpen(report) ? 'done: not agreed; finished early by the session' : 'done: open objections; finished early by the session (not agreed)';   // A-DRAFT (0.8.4 round 1, R3): the first text is the early finish with no objection standing in the record
    if (budgetFinishWords(report)) return `done: not agreed; finished at the person's choice at the spending limit (stage "${report.stop.label}")`;   // 0.8.4 S16 (F; WORDING S16-w60b)
    if (secretFinishWords(report)) return `done: not agreed; finished at the person's choice at a credential-shaped pause (stage "${report.stop.label}")`;
    if (ownerPauseFinishWords(report)) return `done: not agreed; ${ownerPauseFinishWords(report)}`;   // 0.8.4 (ladder unit, LAD-O6)
    const finished = finishedAtStopWords(report);   // 0.8.4 L3, A-DRAFT: a stop the person finished, with the top layer not signed off on that plan (derived from stop + layers[]; the final-read and ending sentences above win)
    return finished ? (nothingStandsAtEnd(report) ? `done: not agreed; ${finished}` : `done: open objections; ${finished}`) : (nothingStandsAtEnd(report) ? 'done: not agreed' : 'done: open objections');   // A-DRAFT (0.8.4 round 1, A7-1): the first text is the run finished at once with no objection open
  }
  // 0.8.2 item 4: the panel signed one draft and a later model stage changed what is delivered. ADDITIVE (C&C ruling, 6 Oct 2026): the old sentence stays the start, so a matcher on it still matches.
  const d = report.delivered_text;
  const differs = deliveredDiffersClause(d);
  if (differs) return `done: ${verdictWords(report)}, ${differs}`;
  return `done: ${verdictWords(report)}`;
}

// Can this run be continued, and what does that take? 0.8.0 WM0 item 4. Derived from the marker files
// the CLI leaves, like deriveRunStatus above (nothing is stored), so it is right for a run of any
// age and for a run whose process is gone. `status` is deriveRunStatus's word; `reason` is finer
// (a truncated draft and an unreachable seat are both 'stopped'/'failed' there); `needs` is what
// has to happen before --resume can get further:
//   nothing            resume as is (a process that died)
//   answer             write the answer file for each stage in `waiting`, then resume
//   higher_cap         resume with a --max-usd above what was spent (it is a total, not extra); `suggestedMaxUsd` is the smallest total that lets the next call to a model be sent
//   person_choice      the run stopped because the conflict decider asked for the person (E4b unit 3): `--resume <run> --prevail n=<id>|neither` (a tree MEMBER: its stop sentence, stoppedAt.reason, names the tree's `tree decide --prevail-node` command instead; cli.js refuses `--prevail` on a member's folder); a plain resume only says so again at $0; MCP has no verb for the choice
//                      Also a run PAUSED at a credential-shaped prompt (paused_secret): `--resume <run> --continue`, at a terminal (src/secret-pause.js)
//   fix_cause          the run stopped at an error, or on a key-shaped prompt of an earlier build (secret_blocked: one plain --resume pauses it again and writes the pause record); a transient error may pass on its own next time
//   raise_max_tokens   a draft was cut off; raise that seat's maxTokens in the chain, then resume
//   replace_reply      a draft stage's reply held no draft (only DECLINED lines): replace <stage>.md, then resume
//   fix_task           the task itself was refused (fence it, or --allow-unfenced); the task is frozen
//                      once a run starts, so a preflight objection needs a new run
// `resumable` is false only where a resume cannot help: a finished run, one already running, a
// preflight objection, and an advice call stopped before its first paid call (advice runs never resume).
const readJsonSafe = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
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
  // 0.8.4 D10 slice 2c: not resumable until the person has answered (a resume is refused with EXIT_AWAITING_EXCERPT_APPROVAL; with the privacy switch on only for a gate that waits for the person or cannot be read, src/gate.js excerptApprovalStops); `needs` says what: the person's answers, at a terminal.
  if (status === 'awaiting_excerpt_approval' && !awaitingExcerptApproval(dir)) { const g = awaitingExcerptResume(dir); return out(true, g?.status === 'expired' ? 'excerpt_gate_expired' : 'excerpt_answers_to_apply', 'resume', { gate: g?.gate ?? null }); }   // the person's answers are in (the next resume applies them), or the approval expired (the next resume asks again): A-DRAFT words in server.js state
  if (status === 'awaiting_excerpt_approval') return out(false, 'awaiting_excerpt_approval', 'excerpt_approval', { gate: awaitingExcerptApproval(dir)?.gate ?? null, exitCode: EXIT_AWAITING_EXCERPT_APPROVAL });
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
  // 0.8.4 S20 slice 2 (#16c, the owner's "pause after this round"): the run stopped between two passes at the person's or the handler session's request (STOPPED-owner_pause.json; exit 23). Resuming it is one plain `council --resume <run>` with no
  // --continue (0.8.4 ladder unit: the person can also END it there with --finish / --finish-now), but WHEN is the person's call: an agent must not resume on its own, which is what the generic branch below ("nothing needed") would invite. run_status reads the marker only, never the gate ledger.
  if (status === 'owner_paused') {
    const m = readStoppedMarker(dir);
    const again = m?.data?.resumeAfterStop === true;
    return out(again, status, again ? 'person_choice' : null, { stoppedAt: m?.data ?? null, stoppedBy: 'owner_pause' });
  }
  if (Object.values(STOP_STATUS).includes(status)) {
    const m = readStoppedMarker(dir);
    const again = m?.data?.resumeAfterStop === true;
    return out(again, status, again ? 'nothing' : null, { stoppedAt: m?.data ?? null, stoppedBy: m?.stoppedBy ?? null });
  }
  // 0.8.1 decided rule 6 (M6 review D3): an advice call is never resumed, whatever ended it (a crash, its cap, an error); it is asked
  // again. resume_run and `council --resume` refuse it; this says the same instead of offering a resume they would refuse.
  if (isAdviceFolder(dir)) return out(false, 'advice_call', null);
  if (status === 'budget_stopped' && budgetFinishRecordedAt(dir)) return out(true, 'budget_finish_recorded', 'nothing', { stoppedAt: readJsonSafe(join(dir, 'STOPPED-budget.json')), note: BUDGET_FINISH_NOTE });   // 0.8.4: the person's finish-now is on record: a plain resume ends the run and asks for no limit
  if (status === 'budget_stopped') {
    const stoppedAt = readJsonSafe(join(dir, 'STOPPED-budget.json'));
    // Cost-unit U1 split (14 Oct 2026): `spentUsd` in that file is the RECORDED spend; the cap also counted a worst case for replayed stages with no recorded figure (`assumedAtWorstCase.usd`). `suggestedMaxUsd` is the smallest total that lets the next call to a model be sent, computed
    // exactly as the CLI's printed resume command is (src/cost.js resumeCeilingUsd), so "above what was spent" cannot under-shoot. Additive; null when the file does not hold the figures.
    // DUALCAP 4c2: a stop at ONE per-provider cap suggests from that cap's own figures (capSpentUsd + capAssumedUsd), never the run total, and names the cap.
    const capStop = stoppedAt && typeof stoppedAt.capName === 'string' && Number.isFinite(stoppedAt.capSpentUsd);
    const suggestedMaxUsd = !stoppedAt ? null : capStop ? resumeCeilingUsd({ cap: stoppedAt.capUsd, spent: stoppedAt.capSpentUsd + (stoppedAt.capAssumedUsd || 0), projected: stoppedAt.projectedStageUsd, gate: stoppedAt.gateStageUsd }) : resumeCeilingUsd({ cap: stoppedAt.capUsd, spent: stoppedAt.spentUsd + (stoppedAt.assumedAtWorstCase?.usd || 0), projected: stoppedAt.projectedStageUsd, gate: stoppedAt.gateStageUsd });
    return out(true, 'budget', 'higher_cap', { stoppedAt, suggestedMaxUsd, ...(capStop ? { capName: stoppedAt.capName } : {}), ...(budgetWaysNote(dir, stoppedAt, runMeta) ? { note: budgetWaysNote(dir, stoppedAt, runMeta) } : {}) });
  }
  if (status === 'paused') return out(true, 'external_pause', 'answer', { waiting: waitingStages(dir), ...(existsSync(join(dir, 'STOPPED-budget.json')) && budgetFinishRecordedAt(dir) ? { note: BUDGET_FINISH_NOTE } : {}) });
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
  // 0.8.4 (Muad 8 Nov 2026: a found secret PAUSES the run): a whole secret-stop/1 record beside the marker means the run waits for the person's --continue (src/secret-pause.js); no record, a torn one or another schema keeps the
  // old reading (a folder from an earlier build: one plain --resume pauses it again and writes the record).
  if (existsSync(join(dir, 'STOPPED-secret.md'))) return readSecretStop(dir) ? out(true, 'paused_secret', 'person_choice', { stoppedAt: 'STOPPED-secret.md', ...(['finish', 'finish_now'].includes(secretFinishState(runMeta, readSecretStop(dir))) ? { choice: secretFinishState(runMeta, readSecretStop(dir)) } : {}) }) : out(true, 'secret_blocked', 'fix_cause', { stoppedAt: 'STOPPED-secret.md', note: SECRET_RECORD_MISSING_NOTE });
  // No marker and no live process: the run was killed, crashed or lost its machine. Every finished
  // stage is on disk, so a resume replays them and carries on.
  return out(true, 'process_gone', 'nothing');
}
