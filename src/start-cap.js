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
//   3. the newest `run_cap` gate of THIS run id and THIS scope: approved and usable -> consume it; pending -> ask (interactive) or wait; expired or declined -> a new gate.
//   4. no such gate -> a new gate. A gate shown for another scope is left alone and a new one is requested (consuming it would give the limit typed for one screen to another run).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestGate, readGateAnswer, listGates, consumeRunCap, runCapAuthority, capScopeSha256, RUN_CAP_KIND } from './gate.js';
import { changedParts } from './start-scope.js';
import { formatUsd } from './cost.js';

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
//   not above the floor leaves a NOTE and a NEW gate, and the number of screens since the last consumption is bounded.
//   `history()` (the caller, cli.js) gives { spentUsd, unsettledUsd, floorUsd, suggestedUsd, projectedStageUsd, stopped: { capUsd } | null }: the figures of the run folder, the floor and suggestion from STOPPED-budget.json through src/resume-ceiling.js.
//   `buildScreen(kind, { history })` returns the screen text (kind run | side | legacy | raise | amend); `scope` is the scope object, written beside the screen as cap-scope-<n>.json so a later amend screen can name what changed.
export async function authorizeStart({ runDir, runId, resume = false, sideVerb = null, scopeSha256, scope = null, screenText = '', buildScreen = null, history = null, ceiling, interactive, ask, now = () => Date.now() }) {
  const auth = runCapAuthority(runDir, { runId, now });
  if (auth.status === 'invalid') return { status: 'refused', code: auth.reason, message: `the record of this run's limit cannot be used (${auth.reason}). Nothing was started.` };

  const hist = history ? history() : {};
  const listed = listGates(runDir, { now });
  if (listed === null) return { status: 'refused', code: 'gate_ledger_corrupt', message: 'the approval record of this run cannot be read (gate_ledger_corrupt). Nothing was started.' };
  const all = listed.map(g => ({ id: g.id, state: readGateAnswer(runDir, g.id, { now }) })).filter(g => g.state.gate?.kind === RUN_CAP_KIND && g.state.gate.cap.run_id === runId);

  // T5: a paid side command's first limit is its own operation (gate.js CAP_OPERATION already allows side:<verb>) and screen kind.
  let operation = sideVerb ? `side:${sideVerb}` : 'start'; let kind = sideVerb ? 'side' : 'run'; let since = 0; let previousCapUsd = null; let changed = null;
  if (auth.status === 'ok') {
    const lastGate = readGateAnswer(runDir, auth.gate, { now }).gate;
    const bound = lastGate?.cap?.scope_sha256;
    const stoppedAtActive = hist.stopped && Number.isFinite(hist.stopped.capUsd) && Math.round(hist.stopped.capUsd * 1e6) === auth.capMicroUsd;
    if (bound === scopeSha256 && !stoppedAtActive) return authorized(auth, auth.gate, 'continued');
    since = auth.seq; previousCapUsd = Number(auth.capUsd);
    if (bound !== scopeSha256) {
      operation = 'amend_scope'; kind = 'amend';
      // what changed: the scope object of that gate, kept beside its screen (cap-scope-<n>.json) and verified against the digest it was bound to; missing or altered -> the screen says it cannot be shown
      const m = /^cap-screen-(\d+)\.md$/.exec(lastGate?.text ?? '');
      if (m && scope) { try { const old = JSON.parse(readFileSync(join(runDir, `cap-scope-${m[1]}.json`), 'utf8')); if (capScopeSha256(old) === bound) changed = changedParts(old, scope); } catch { /* absent or unreadable: changed stays null */ } }
    } else { operation = 'raise'; kind = 'raise'; }
  } else if (resume && !all.length) { operation = 'resume_legacy'; kind = 'legacy'; }

  const floorMicro = Number.isFinite(hist.floorUsd) && hist.floorUsd > 0 ? Math.ceil(hist.floorUsd * 1e6) : 0;
  const since_ = g => g.state.gate.seq > since;
  const mine = all.filter(g => g.state.gate.cap.scope_sha256 === scopeSha256 && since_(g) && (since === 0 || /^(raise|amend_scope)$/.test(g.state.gate.cap.operation)));
  const newest = mine.at(-1) ?? null;

  const consume = gate => {
    const used = consumeRunCap(runDir, gate, { runId, scopeSha256, committedMicroUsd: floorMicro }, { now });
    if (!used.ok) return { status: 'refused', code: used.code, message: used.message };
    const after = runCapAuthority(runDir, { runId, now });
    return after.status === 'ok' ? authorized(after, gate, 'answered') : { status: 'refused', code: after.reason ?? 'cap_record_mismatch', message: 'the limit was recorded but cannot be read back. Nothing was started.' };
  };

  // A typed limit that cannot be used must not LOCK the run (an approved gate that stays approved-and-usable cannot be re-answered): it is left unused, a NEW gate is requested and the person is told why.
  //   - a ceiling now in force BELOW what the gate was shown or typed under (code above_ceiling_now); LOOSENED or MISSING -> the gate stands (it holds the ceiling it was typed under)
  //   - a total NOT ABOVE the floor the run has already counted (code below_floor)
  let note = null;
  let reuse = newest;
  if (newest) {
    const { status, usable, answer, gate } = newest.state;
    if (status === 'approved' && usable && ceiling && Number(answer.cap_usd) > ceiling.usd) {
      note = { code: 'above_ceiling_now', message: `the limit typed for this run (${formatUsd(Number(answer.cap_usd))}) is above the ceiling now in force (${formatUsd(ceiling.usd)}, set by ${ceiling.source}), so it was not used. Nothing was started.` };
      reuse = null;
    } else if (status === 'approved' && usable && floorMicro > 0 && answer.cap_micro_usd <= floorMicro) {
      note = { code: 'below_floor', message: `the limit typed for this run (${formatUsd(Number(answer.cap_usd))}) is not above what the run has already counted (${formatUsd(hist.floorUsd)}), so it was not used. Nothing was started.` };
      reuse = null;
    } else if (status === 'pending' && ceiling && (gate.cap.ceiling_usd === null || ceiling.usd < gate.cap.ceiling_usd)) reuse = null;
  }
  if (reuse?.state.status === 'approved' && reuse.state.usable) return consume(reuse.id);
  // Bounded since the last consumption: every limit screen is a gate file and a person's attention; a task, a setting or a ceiling that keeps changing must end somewhere that HAS an exit (a new run), not in an endless g3, g4, g5 ...
  // (raises and amendments that were ANSWERED do not use these up: only the screens of the current question count.)
  const screens = all.filter(since_).length;
  if (!(reuse?.state.status === 'pending') && screens >= MAX_LIMIT_SCREENS) {
    return { status: 'refused', code: 'too_many_limit_screens', message: `this run has already had ${screens} limit screens (the task, the settings or the ceiling kept changing), so no more are shown. Nothing was started. Start a new run.` };
  }

  let gateId;
  if (reuse?.state.status === 'pending') gateId = reuse.id;
  else {
    const n = listed.length + 1;
    const file = `cap-screen-${n}.md`;
    const text = buildScreen ? buildScreen(kind, { history: { ...hist, previousCapUsd, changed } }) : screenText;
    writeFileSync(join(runDir, file), text);   // fs-ok: the run folder, a new name per gate (an older gate's text must keep its bytes)
    if (scope) writeFileSync(join(runDir, `cap-scope-${n}.json`), JSON.stringify(scope));   // fs-ok: the scope object this gate is bound to, verifiable against its digest; a later amend screen names what changed from it
    const cap = { operation, run_id: runId, scope_sha256: scopeSha256, ceiling_usd: ceiling ? ceiling.usd : null, ceiling_source: ceiling ? ceiling.source : null };
    const made = requestGate(runDir, { kind: RUN_CAP_KIND, textPath: file, cap, expiresAt: now() + CAP_GATE_TTL_MS }, { now });
    if (!made.ok) return { status: 'refused', code: made.code, message: `the limit screen could not be recorded (${made.code}: ${made.message}). Nothing was started.` };
    gateId = made.gate.id;
  }

  if (!interactive) return { status: 'pending', gate: gateId, ...(note ? { note } : {}) };
  const code = await ask(runDir, gateId);
  const now2 = readGateAnswer(runDir, gateId, { now });
  if (code === 0 && now2.status === 'approved' && now2.usable) return consume(gateId);
  return { status: 'pending', gate: gateId, ...(note ? { note } : {}) };
}
