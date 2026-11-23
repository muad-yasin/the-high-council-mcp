// The typed limit at the START of a run: find the run's limit, or ask for it (0.8.3 M6 typed cap T4a; typed-cap gate page sections 3, 7, 8; T4 start-path page sections 1 and 3; 14 Oct 2026).
// PURE of the terminal and the clock (both injected); it reads and writes only the run folder's gate ledger, through src/gate.js. cli.js is the one caller.
//
// Contract:
//   authorizeStart({ runDir, runId, resume, scopeSha256, screenText, ceiling, interactive, ask, now? })
//       resume      false: a new run (operation `start`); true: a resume. A resume of a run with NO `run_cap` gate on record at all is a LEGACY run (made before the typed cap): operation `resume_legacy`, a typed TOTAL; a resume of a run that has one (pending, expired, declined, another scope) asks again as `start`.
//       scopeSha256 buildStartScope(...).sha256, rebuilt NOW by the caller; a gate shown for another scope is never consumed
//       screenText  the exact screen a person reads (buildCapScreen(...).text); written to the run folder and hashed into the gate
//       ceiling     { usd, source } the lowest ceiling in force, or null (then the gate carries ceiling_usd null and ceiling_source null)
//       interactive true when stdin AND stdout are terminals: the person types the limit in THIS process; false: the run waits (exit 21)
//       ask         async (runDir, gateId) -> exit code 0 when a limit was recorded (the terminal form, src/gate-cli.js answerAtTerminal), anything else when not
//   -> { status: 'authorized', capUsd: number, capMicroUsd, gate, via: 'continued' | 'answered' }   the run may start; `continued` = a limit already consumed for this run id (a resume), `answered` = consumed just now
//    | { status: 'pending', gate, note? }                                                           no limit is recorded yet: nothing may be started (exit 21); `note` = an earlier typed limit that a lower ceiling now in force set aside (code above_ceiling_now)
//    | { status: 'refused', code, message }                                                        the record cannot be trusted or the limit cannot be used (broken ledger, a copied folder ...): nothing may be started
// THE DECISION ORDER (T4 page section 3), because runCapAuthority says `none` both for a legacy run and for a run whose gate is still pending:
//   1. a consumed limit for this run id and an `ok` authority: continue under it when its bound scope still equals the scope now and no budget stop sits at that limit; otherwise a NEW screen (amend_scope | raise, T4b2, full order below authorizeStart's header).   2. an `invalid` authority: refuse.
//   3. the newest `run_cap` gate of THIS run id and THIS scope: approved and usable -> consume it (an approved RAISE that can never be used is CLOSED in the record first: `cap_raise_closed`); pending -> ask (interactive) or wait; expired, declined or closed -> a new gate.
//   4. no such gate -> a new gate. A gate shown for another scope is left alone and a new one is requested (consuming it would give the limit typed for one screen to another run).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestGate, readGateAnswer, listGates, consumeRunCap, closeRaiseApproval, runCapAuthority, capScopeSha256, RUN_CAP_KIND } from './gate.js';
import { changedParts } from './start-scope.js';
import { formatUsd } from './cost.js';
import { CAP_RECORD_FIELDS } from './caps.js';
import { FINISH_NOTE_PREFIX } from './cap-screen.js';
import { raiseVerdict } from './run-controls.js';

// 0.8.4 DUALCAP unit 4b1 (src/caps.js RECORDS, "run_cap gate"): `capName` = the per-provider cap this limit is for (null: the run's one limit, as before). Everything below then
// reads and writes THAT cap only: its authority (gate.js runCapAuthority per cap), its gates (cap.cap_name equal), its stop (a stop file whose capName is this cap AND whose capUsd
// is this cap's consumed limit: two caps with the same figure never raise the wrong one), its screen bound (MAX_LIMIT_SCREENS counts this cap's screens), and the new gate names it.
const CAP_NAME_KEY = CAP_RECORD_FIELDS.gate;

/** How long a limit screen stays answerable: a run that exited 21 may be answered later in the day; a later start shows a fresh screen. 24 hours (the advice gate's TTL is shorter because its text is sent; this text is only read). */
/** At most this many limit screens (gates) for one run id; the next change ends in a plain refusal that points at a new run. 5: the first screen, then four changes of task, settings or ceiling is already unusual; the number is a bound, not a measurement. */
export const MAX_LIMIT_SCREENS = 5;
export const CAP_GATE_TTL_MS = 24 * 60 * 60 * 1000;

const authorized = (auth, gate, via) => ({ status: 'authorized', capUsd: Number(auth.capUsd), capMicroUsd: auth.capMicroUsd, gate, via, operation: auth.operation });

// T4b2 (14 Oct 2026; T4b gate page, C&C's gate): a run's limit AFTER the first one. The decision order, in full:
//   1. `invalid` authority -> refuse (fail closed).
//   2. an `ok` authority (a limit already consumed for this run): continue under it when the scope bound in its gate equals the scope now AND no budget stop sits at that limit; else a NEW screen:
//        scope differs  -> operation amend_scope  (a recorded amendment, an edited chain file, a changed policy, price row or personal-data check: the screen NAMES what changed)
//        a stop file whose capUsd equals the active limit -> operation raise (the limit was used up)
//   3. no consumption yet -> `start` (a new run) or `resume_legacy` (a resume of a run with no limit gate at all).
//   Then, for the chosen operation: the newest gate of this run for THIS scope requested AFTER the last consumption is reused (approved and usable -> consume; pending -> ask or wait), a gate set aside by a ceiling that is now lower or by a total that is
//   not above the floor leaves a NOTE and a NEW gate (an approved RAISE set aside this way is also CLOSED in the record, S20 slice 1; start, amend_scope and legacy gates are not), and the number of screens since the last consumption is bounded.
//   `history()` (the caller, cli.js) gives { spentUsd, unsettledUsd, floorUsd, suggestedUsd, projectedStageUsd, stopped: { capUsd } | null }: the figures of the run folder, the floor and suggestion from STOPPED-budget.json through src/resume-ceiling.js.
//   `buildScreen(kind, { history })` returns the screen text (kind run | side | legacy | raise | amend); `scope` is the scope object, written beside the screen as cap-scope-<n>.json so a later amend screen can name what changed.
export async function authorizeStart({ runDir, runId, resume = false, sideVerb = null, scopeSha256, scope = null, screenText = '', buildScreen = null, history = null, ceiling, interactive, ask, forceRaise = false, relayed = false, capName = null, now = () => Date.now() }) {
  const auth = runCapAuthority(runDir, { runId, capName, now });
  if (auth.status === 'invalid') return { status: 'refused', code: auth.reason, message: `the record of this run's limit cannot be used (${auth.reason}). Nothing was started.` };

  const hist = history ? history() : {};
  const listed = listGates(runDir, { now });
  if (listed === null) return { status: 'refused', code: 'gate_ledger_corrupt', message: 'the approval record of this run cannot be read (gate_ledger_corrupt). Nothing was started.' };
  const all = listed.map(g => ({ id: g.id, state: readGateAnswer(runDir, g.id, { now }) })).filter(g => g.state.gate?.kind === RUN_CAP_KIND && g.state.gate.cap.run_id === runId && (g.state.gate.cap[CAP_NAME_KEY] ?? null) === capName);

  // T5: a paid side command's first limit is its own operation (gate.js CAP_OPERATION already allows side:<verb>) and screen kind.
  let operation = sideVerb ? `side:${sideVerb}` : 'start'; let kind = sideVerb ? 'side' : 'run'; let since = 0; let previousCapUsd = null; let changed = null; let approvedEarly = false;
  if (auth.status === 'ok') {
    const lastGate = readGateAnswer(runDir, auth.gate, { now }).gate;
    const bound = lastGate?.cap?.scope_sha256;
    const stoppedAtActive = hist.stopped && (hist.stopped.capName ?? null) === capName && Number.isFinite(hist.stopped.capUsd) && Math.round(hist.stopped.capUsd * 1e6) === auth.capMicroUsd;
    // B3 prototype: `forceRaise` (--raise-cap on a resume) opens a raise although the run has not stopped at its limit; `relayed` makes the gate one the handler session may answer on the person's permission (gate.js, the relay answer).
    // S20 slice 1 (G5): an early raise the person ANSWERED (approved, usable, not yet consumed, for this scope) is a raise whether or not this resume repeats --raise-cap: it is consumed here, never dropped (a plain resume used to continue
    // under the OLD limit and leave the approval unused). If it cannot be used (ceiling now lower, not above the counted spend, not above the limit now) the run continues under the limit it has, and `setAside` says why.
    approvedEarly = bound === scopeSha256 && !stoppedAtActive && !forceRaise && all.some(g => g.state.gate.seq > auth.seq && g.state.gate.cap.scope_sha256 === scopeSha256 && g.state.gate.cap.operation === 'raise' && g.state.status === 'approved' && g.state.usable);
    if (bound === scopeSha256 && !stoppedAtActive && !forceRaise && !approvedEarly) return authorized(auth, auth.gate, 'continued');
    since = auth.seq; previousCapUsd = Number(auth.capUsd);
    if (bound !== scopeSha256) {
      operation = 'amend_scope'; kind = 'amend';
      // what changed: the scope object of that gate, kept beside its screen (cap-scope-<n>.json) and verified against the digest it was bound to; missing or altered -> the screen says it cannot be shown
      const m = /^cap-screen-(\d+)\.md$/.exec(lastGate?.text ?? '');
      if (m && scope) { try { const old = JSON.parse(readFileSync(join(runDir, `cap-scope-${m[1]}.json`), 'utf8')); if (capScopeSha256(old) === bound) changed = changedParts(old, scope); } catch { /* absent or unreadable: changed stays null */ } }
    } else { operation = 'raise'; kind = stoppedAtActive ? 'raise' : 'raise_early'; }
  } else if (resume && !all.length) { operation = 'resume_legacy'; kind = 'legacy'; }

  const floorMicro = Number.isFinite(hist.floorUsd) && hist.floorUsd > 0 ? Math.ceil(hist.floorUsd * 1e6) : 0;
  const since_ = g => g.state.gate.seq > since;
  const mine = all.filter(g => g.state.gate.cap.scope_sha256 === scopeSha256 && since_(g) && (since === 0 || /^(raise|amend_scope)$/.test(g.state.gate.cap.operation)));
  const newest = mine.at(-1) ?? null;

  const consume = gate => {
    const used = consumeRunCap(runDir, gate, { runId, scopeSha256, committedMicroUsd: floorMicro }, { now });
    if (!used.ok) return { status: 'refused', code: used.code, message: used.message };
    const after = runCapAuthority(runDir, { runId, capName, now });   // DUALCAP: read back THIS cap's limit
    return after.status === 'ok' ? authorized(after, gate, 'answered') : { status: 'refused', code: after.reason ?? 'cap_record_mismatch', message: 'the limit was recorded but cannot be read back. Nothing was started.' };
  };

  // A typed limit that cannot be used must not LOCK the run (an approved gate that stays approved-and-usable cannot be re-answered): it is left unused, a NEW gate is requested and the person is told why.
  //   - a ceiling now in force BELOW what the gate was shown or typed under (code above_ceiling_now); LOOSENED or MISSING -> the gate stands (it holds the ceiling it was typed under)
  //   - a total NOT ABOVE the floor the run has already counted (code below_floor)
  let note = null;
  let reuse = newest;
  if (newest) {
    const { status, usable, answer, gate } = newest.state;
    // ONE rule for "can this answered limit be used" (src/run-controls.js raiseVerdict; S20 G6): the ceiling now in force and the counted spend always; for a raise the person ASKED for (--raise-cap, or an approved early raise) also the limit the
    // run has now (a total between the two would LOWER it). R3b: a typed total at a budget stop with no --raise-cap may still be below the old limit.
    const explicitRaise = (forceRaise || approvedEarly) && operation === 'raise';
    const verdict = status === 'approved' && usable ? raiseVerdict({ answer, floorUsd: hist.floorUsd, ceiling, previousCapUsd, requireAboveCurrent: explicitRaise }) : null;
    if (verdict) {
      note = verdict; reuse = null;   // where the resume WAITS for a new answer the sentence ends 'Nothing was started.'
      // S20 slice 1 (C&C's ruling): an APPROVED RAISE that cannot be used is CLOSED in the record by THC's own determination (a `cap_raise_closed` line referencing the approval; the approval line stays). It is never consumed later
      // (a ceiling that rises again does not revive it), no plain resume re-prints it, and the run's status stops answering awaiting_user_cap for it. Told once: at the moment it is closed.
      if (gate.cap?.operation === 'raise') {
        const closed = closeRaiseApproval(runDir, newest.id, { code: verdict.code, reason: verdict.reason }, { now });
        if (!closed.ok) return { status: 'refused', code: closed.code, message: `the approved raise could not be closed in the record (${closed.code}: ${closed.message}). Nothing was started.` };   // A-DRAFT
      }
    }
    else if (status === 'pending' && ceiling && (gate.cap.ceiling_usd === null || ceiling.usd < gate.cap.ceiling_usd)) reuse = null;
    // 0.8.4 (unit-end item i): a PENDING screen is reused only while the sentence it shows about the person's finish is still true. A finish given, taken back (--continue) or typed again since it was shown changes that sentence, and a person must never approve a figure under the old one: the screen is asked again.
    else if (status === 'pending') {
      const want = typeof hist.finishNote === 'string' && hist.finishNote.trim() ? `${FINISH_NOTE_PREFIX}${hist.finishNote.trim()}` : null;
      let shown = null;
      try { shown = readFileSync(join(runDir, gate.text), 'utf8').split('\n').find(l => l.startsWith(FINISH_NOTE_PREFIX)) ?? null; } catch { shown = undefined; }
      if (shown !== undefined && shown !== want) reuse = null;
    }
  }
  // A plain resume that found an approved early raise it cannot use: no new screen is opened (the person did not ask for one now); the run goes on under the limit it has and says why.
  // ... but here the run GOES ON under its limit, so the outcome carries the reason clause only (no 'Nothing was started.'): the printed sentence and the behaviour agree (cli.js capGateOrExit).
  if (approvedEarly && !(reuse?.state.status === 'approved' && reuse.state.usable)) return { ...authorized(auth, auth.gate, 'continued'), ...(note ? { setAside: { code: note.code, reason: note.reason } } : {}) };
  if (reuse?.state.status === 'approved' && reuse.state.usable) return consume(reuse.id);
  // Bounded since the last consumption: every limit screen is a gate file and a person's attention; a task, a setting or a ceiling that keeps changing must end somewhere that HAS an exit (a new run), not in an endless g3, g4, g5 ...
  // (raises and amendments that were ANSWERED do not use these up: only the screens of the current question count.)
  const screens = all.filter(since_).length;
  if (!(reuse?.state.status === 'pending') && screens >= MAX_LIMIT_SCREENS) {
    return { status: 'refused', code: 'too_many_limit_screens', message: `this run has already had ${screens} limit screens (the task, the settings or the ceiling kept changing), so no more are shown. Nothing was started. Start a new run.` };
  }

  // Opens a NEW limit gate (its screen text and scope files, then the gate line). A function because the interactive path below opens a second one when the answer just typed was closed in the record.
  const openGate = () => {
    const fresh = listGates(runDir, { now });   // read again: a gate may have been opened in this very call (the interactive path below); never a stale count, which would name the screen file of the gate just opened
    if (fresh === null) return { ok: false, refusal: { status: 'refused', code: 'gate_ledger_corrupt', message: 'the approval record of this run cannot be read (gate_ledger_corrupt). Nothing was started.' } };
    const n = fresh.length + 1;
    const file = `cap-screen-${n}.md`;
    const text = buildScreen ? buildScreen(kind, { history: { ...hist, previousCapUsd, changed }, ...(capName !== null ? { capName } : {}) }) : screenText;
    writeFileSync(join(runDir, file), text);   // fs-ok: the run folder, a new name per gate (an older gate's text must keep its bytes)
    if (scope) writeFileSync(join(runDir, `cap-scope-${n}.json`), JSON.stringify(scope));   // fs-ok: the scope object this gate is bound to, verifiable against its digest; a later amend screen names what changed from it
    const cap = { operation, run_id: runId, scope_sha256: scopeSha256, ceiling_usd: ceiling ? ceiling.usd : null, ceiling_source: ceiling ? ceiling.source : null, ...(capName !== null ? { [CAP_NAME_KEY]: capName } : {}) };
    const made = requestGate(runDir, { kind: RUN_CAP_KIND, textPath: file, cap, expiresAt: now() + CAP_GATE_TTL_MS, ...(relayed && operation === 'raise' ? { requestedBy: 'session' } : {}) }, { now });
    if (!made.ok) return { ok: false, refusal: { status: 'refused', code: made.code, message: `the limit screen could not be recorded (${made.code}: ${made.message}). Nothing was started.` } };
    return { ok: true, id: made.gate.id };
  };
  let gateId;
  if (reuse?.state.status === 'pending') gateId = reuse.id;
  else { const opened = openGate(); if (!opened.ok) return opened.refusal; gateId = opened.id; }

  if (!interactive || relayed) return { status: 'pending', gate: gateId, ...(note ? { note } : {}) };   // a relayed gate is answered by the handler session (council gate answer --relayed), never by a prompt in this process
  const code = await ask(runDir, gateId);
  const now2 = readGateAnswer(runDir, gateId, { now });
  if (code === 0 && now2.status === 'approved' && now2.usable) {
    // the same rule as above for the answer just typed (S20 G6): an interactive --raise-cap used to skip the "not above the limit it has now" check
    const typed = forceRaise && operation === 'raise' ? raiseVerdict({ answer: now2.answer, floorUsd: 0, ceiling: null, previousCapUsd, requireAboveCurrent: true }) : null;
    if (typed) {
      const closed = closeRaiseApproval(runDir, gateId, { code: typed.code, reason: typed.reason }, { now });   // the same closing as above: the answer just typed cannot be used
      if (!closed.ok) return { status: 'refused', code: closed.code, message: `the approved raise could not be closed in the record (${closed.code}: ${closed.message}). Nothing was started.` };   // A-DRAFT
      const opened = openGate();   // the closed answer cannot be answered again: a NEW gate waits, and the wait names that one
      if (!opened.ok) return opened.refusal;
      return { status: 'pending', gate: opened.id, note: typed };
    }
    return consume(gateId);
  }
  return { status: 'pending', gate: gateId, ...(note ? { note } : {}) };
}
