// The gate: a send that waits for a person (0.8.1 plan DR-3, DR-4, M3; persistence register P4).
//
// A gate names a text file in the run folder and the sha256 of its bytes. A person answers it through a
// channel a person uses (PERSON_CHANNELS: the terminal, `council gate answer`, or an MCP elicitation that
// shows the whole text), bound to the hash of the text they were shown (decided rule 10). A run may start
// on an approved gate that is `usable` only.
//
// Contract.
//   requestGate(runDir, {kind, textPath, price, seats, sensitivity, masks, follow_up?, expiresAt?}, {now?})
//       -> { ok: true, gate } | { ok: false, code, message }
//   answerGate(runDir, gateId, {channel, shownSha256, decision, actor, reason?, tty}, {now?})
//       -> { ok: true, status, seq, warning? } | { ok: false, code, message }
//   readGateAnswer(runDir, gateId, {now?})
//       -> { status: 'pending' | 'approved' | 'declined' | 'expired' | 'invalid', reason?, gate?, answer?,
//            usable?, usable_until?, used? }   (the last three on `approved` only)
//   listGates(runDir, {now?}) -> [{ id, status, reason? }] | null when the ledger is broken
//   recordDeclined(runDir, gateId, 'amend_decided', fields?, {now?, before?}) -> the same, for a gate a person DECLINED (0.8.2 item 6d)
//   recordUse(runDir, gateId, event, fields?, {now?, before?}) -> the same; event is one of USE_EVENTS (sent, contract_locked, amend_decided; `sent` is read-only vocabulary since 0.8.4: the advice add-on that wrote it is removed, and old ledgers still verify)
//   The `run_cap` kind (0.8.3 M6 typed cap T3; see RUN_CAP_KIND below): requestGate takes `cap` (the bound pending decision); answerGate takes `typedCap` (the person's raw text) and `client`; and
//   consumeRunCap(runDir, gateId, {runId, scopeSha256}, {now?}) -> { ok: true, seq, gate, runId, capUsd, capMicroUsd } | { ok: false, code, message }   (the single `cap_consumed` use)
//   0.8.4 DUALCAP unit 4b1 (src/caps.js RECORDS, "run_cap gate"): a run_cap gate may carry cap.cap_name (a provider that bills: the per-provider cap its limit is for); its
//   `cap_consumed` line carries the same name, and the order rules run PER CAP (two caps are two sequences in one ledger). A gate without it is byte for byte as before.
//   runCapAuthority(runDir, {runId?, capName?, now?}) -> { status: 'none' } | { status: 'ok', gate, runId, operation, capUsd, capMicroUsd, channel, actor, seq } | { status: 'invalid', reason }   (a read, never a write)
//   capScopeSha256(scope) -> hex   RUN_CAP_KIND, CAP_OPERATION
//   0.8.4 D5a: the `stop_decision` kind (STOP_DECISION_KIND, STOP_CHOICES, STOP_ADVISOR_STATES): requestGate takes `stop` ({ id }, requestedBy 'session'); answerStopDecisionAsSession(runDir, gateId, {shownSha256, reason, stopAnswer}, {now?})
//   approves it with the session's answer ({ choice, advisor, advisor_said }, stored as `stop_answer` on the ledger line); deferStopDecisionAsSession declines it; stopDecisionAnswerOf(runDir, stopId, choice, {now?}) -> null | the answered
//   gate's fields for the CLI's entry site (answered within the last GATE_TTL_MS). See src/stop-gate.js.
//   PERSON_CHANNELS, GATE_TTL_MS, GATE_SCHEMA, GATES_DIR, textSha256, metaSha256
//
// Owned state: `runs/<id>/gates/<gate_id>.json` (schema gate/1, a view) and the `gate_requested` and
// `gate_answered` lines of the run's ledger (the record, src/gate-ledger.js).
//
// The ledger is the truth; the gate file is a view of it. An answer is committed when its ledger line is
// written; the gate file is rewritten after. So:
//   - `approved` is read only from a `gate_answered` line in a ledger that verifies, carrying the gate's
//     recorded hash, AND the text file's bytes hashing to it now. A gate file whose status, answer, text,
//     hash, expiry or metadata (price, seats, sensitivity, masks: bound by `meta_sha256`) disagrees with the
//     ledger reads `invalid` (gate_record_mismatch).
//   - A crash between the ledger line and the view leaves the file saying `pending` with no answer; the
//     ledger wins, so an answered gate can never be answered twice nor stranded unanswerable.
//   - The chain cannot see an edit of the LAST ledger line, or a line appended by anything that can write
//     the run folder (decided rule 9). Comparing the view with the ledger catches an edit of one of the two;
//     an edit of both together is not detected.
//   - `expired` is derived from `expires_at` on read and is never written. An approval does not outlive its
//     gate either: `approved` stays the status (it is history), and `usable` is false once `expires_at` has
//     passed or once a `sent` line names the gate (`used`). M4 starts a run on approved + usable only.
//   - Refusals are not events: a refused answer (wrong hash, expired, not a person's channel, ...) appends
//     nothing.
//   - `invalid` (a fifth value; the plan lists four, see Review/0.8.1-decisions.md) covers what cannot be
//     trusted: a broken ledger (gate_ledger_corrupt), an unreadable or contradicting gate file, an unknown
//     gate, a text file changed after approval or reached through a link out of the run folder. It is never
//     `approved`.
//
// This module is the only writer of `gate_answered` and of a gate file's `approved`; it reads no
// environment variable and no command-line flag (test/gate-answer.test.js scans for both).
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { withLedger, readLedger, RELAY_REASON, sha256Hex, routeLineProblem, pauseLineProblem, budgetFinishLineProblem, budgetFinishOf, budgetFinishLatest, budgetPlainFinishOf, budgetPlainFinishOfRun, budgetLatestOfRun, budgetFinishStandsOfRun, pauseRequestsOf, untakenPauseOf, LedgerBusyError, LedgerCorruptError, LedgerWriteError } from './gate-ledger.js';
import { parseCapInput } from './cap-input.js';
import { limitReachable, roundsUnreachableSentence, stopIdOf, stopOffersContinue } from './overseer-rounds.js';
import { acceptanceReasonProblem, ACCEPTANCE_REASON_MAX } from './acceptance.js';
import { readSecretStop, secretGateStopId, secretChoicesOf } from './secret-pause.js';   // 0.8.4 (Q9): a relayed choice at a found-secret pause
import { cleanDeclared } from './answered-by.js';
import { BILLING_CAP_IDS, CAP_RECORD_FIELDS } from './caps.js';
import { rulingGateText, parseRulingGateText, rulingTextInWords, withdrawalGateText, parseWithdrawalGateText } from './rulings.js';
// The two ledger functions the contract record (src/contract-record.js) reads and appends through, so that only the gate modules name the ledger file: the verified ledger, and the public events (appendEvent refuses every other).
export { readLedger, appendEvent, RELAY_REASON } from './gate-ledger.js';   // RELAY_REASON: the interface (src/run-controls.js) takes it from here, because only gate.js and gate-cli.js may import gate-ledger.js (test/gate-answer.test.js R2)

// A gate is answered only through a channel a person uses (decided rule 10, DR-3). One constant, so 0.8.3
// adds `ui` here together with its proof that a click is a person's.
export const PERSON_CHANNELS = Object.freeze(['cli', 'elicitation']);
// SESSION CHANNEL (0.8.3 M7; Muad 19 Okt 2026 "the main session gets the first say"; C&C thcmcp-6d rulings): the controlling session may answer a gate of a TREE decision kind, with a written reason, and ONLY those kinds. A send-path gate (advice and every other kind) stays a person's:
// otherwise the session could approve its own paid send. This list is the gate-level fence by KIND; the fence by FORM is the tree table (answeredByRefusal sessionAllowed), because every decide form is spent under the one kind tree_decide.
export const SESSION_CHANNEL = 'session';
export const SESSION_ELIGIBLE_KINDS = Object.freeze(['tree_decide', 'tree_frontier', 'stop_decision', 'acceptance']);       // tree_frontier: the session answers only a gate it requested, and only the frontier_approved table row (first approval of a split, the figures it saw) and src/tree-approve-session.js decide whether it may
/** The ONE call that answers a gate on the session channel (the scan in test/gate-answer.test.js keeps every other module off answerGate): approve, with the session's written reason. The kind, requester and reason rules are answerGate's. */
export function answerGateAsSession(runDir, gateId, { shownSha256, reason }, opts) {
  return answerGate(runDir, gateId, { channel: SESSION_CHANNEL, shownSha256, decision: 'approved', actor: 'main-session', reason, tty: false }, opts);
}
/** The ONE call that answers a stop_decision gate (0.8.4 D5a): the session's approval of the quote, with its written reason and its answer ({ choice, advisor, advisor_said }); the rules are answerGate's. */
export function answerStopDecisionAsSession(runDir, gateId, { shownSha256, reason, stopAnswer, personWords }, opts) {
  return answerGate(runDir, gateId, { channel: SESSION_CHANNEL, shownSha256, decision: 'approved', actor: 'main-session', reason, tty: false, stopAnswer, ...(personWords === undefined ? {} : { personWords }) }, opts);
}
/** The ONE call that answers an acceptance gate on the session channel (0.8.4 D2, step accept of stop_decide): the session's approval with its written reason and its answer ({ advisor, advisor_said, objections: [{ id, person_test }] }); the rules are answerGate's. */
export function answerAcceptanceAsSession(runDir, gateId, { shownSha256, reason, acceptanceAnswer, personWords }, opts) {
  return answerGate(runDir, gateId, { channel: SESSION_CHANNEL, shownSha256, decision: 'approved', actor: 'main-session', reason, tty: false, acceptanceAnswer, ...(personWords === undefined ? {} : { personWords }) }, opts);
}
/** The session hands the stop to the person (step defer): it DECLINES its own stop_decision gate with its written reason. The run stays stopped; the person answers at the terminal as before. */
export function deferStopDecisionAsSession(runDir, gateId, { shownSha256, reason, stopDefer }, opts) {
  return answerGate(runDir, gateId, { channel: SESSION_CHANNEL, shownSha256, decision: 'declined', actor: 'main-session', reason, tty: false, stopDefer }, opts);
}
/**
 * For the CLI's entry site of --continue / --finish (0.8.4 D5a): the newest answered stop_decision gate (answered within the last ten minutes) of this run that the SESSION asked for and answered on the session channel, for THIS stop id and THIS choice.
 * -> null | { gate, actor: 'handling_session', channel: 'session', at, reason, advisor, advisor_said }. Reads the hash-chained ledger and the gate's own checks (readGateAnswer); writes nothing. A ledger that does not read gives null.
 */
export function stopDecisionAnswerOf(runDir, stopId, choice, opts = {}) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return null;
  const asked = ledger.lines.filter(l => l.event === 'gate_requested' && l.kind === STOP_DECISION_KIND && l.requested_by === 'session' && (opts.gate === undefined || l.gate === opts.gate)).map(l => l.gate).reverse();   // 0.8.4 (C&C 10 Nov): `opts.gate` names the ONE gate to read; the CLI asks only for the gate its command line names (a choice typed with no gate is never attributed to a gate found by stop and choice)
  for (const id of asked) {
    const st = readGateAnswer(runDir, id, opts);
    if (st.status !== 'approved' || st.answer?.channel !== SESSION_CHANNEL || st.gate?.stop?.id !== stopId || st.answer?.stop_answer?.choice !== choice) continue;
    if (ledger.lines.some(l => l.event === 'stop_answer_closed' && l.gate === id)) continue;   // closed by the harness: the run did not take it, and it is never consumed later
    // The gate was answered while it was valid (answerGate refuses an expired one); the CLI that follows the answer reads it up to one gate lifetime LATER, so an answer given just before the gate's expiry is still the session's
    // when the resume starts a moment after it (the ledger says the session chose; the entry must not say a person typed it). A much later reader is a different choice.
    const answeredAt = Date.parse(st.answer.ts);
    if (!(Number.isFinite(answeredAt) && (opts.now?.() ?? Date.now()) < answeredAt + GATE_TTL_MS)) continue;
    const a = st.answer.stop_answer;
    if (a.relayed === true) return { gate: id, actor: 'person', channel: SESSION_CHANNEL, at: st.answer.ts, reason: st.answer.reason, person_words: st.answer.person_words, relayed: true, ...(a.rounds !== undefined ? { rounds: a.rounds } : {}) };   // 0.8.4 (finish at once; C&C 10 Nov: ONE actor for every relayed choice): the entry's actor is the person (the ledger line, like the relayed cap raise's, names the session that carried it: actor main-session), channel session, relayed true. Recorded like the relayed cap raise: the session relays, the person's words are beside it, the reason is the relay sentence; never "unknown" / "cli" (a typed choice), and chooserOf says "relayed by the handling session"
    return { gate: id, actor: 'handling_session', channel: SESSION_CHANNEL, at: st.answer.ts, reason: st.answer.reason, advisor: a.advisor, advisor_said: a.advisor_said, person_test: a.person_test, over_disagreement: a.over_disagreement };
  }
  return null;
}
// B3 PROTOTYPE (pinned branch only, 30 Okt 2026; the person's word, relayed by C&C): the handler session may also relay two answers on the person's permission, each with the person's own words as a REQUIRED field
// (`person_words`): a typed total that RAISES a run's limit (a run_cap gate whose operation is `raise`; never a first limit or an amendment), and a `ruling`. The tool cannot verify the permission; the record shows who relayed it.
export const RULING_KIND = 'ruling';
export const RULING_WITHDRAWAL_KIND = 'ruling_withdrawal';   // the person's decision to take an approved ruling out of force from a later pass on; its own kind, so no reader of a ruling mistakes it for one
const RULING_TTL_MS = 24 * 60 * 60 * 1000;   // a ruling gate may wait a day for his answer; after that it can never be approved (answerGate refuses an expired gate)
const isRulingKind = kind => kind === RULING_KIND || kind === RULING_WITHDRAWAL_KIND;
const isRelayAskKind = kind => isRulingKind(kind);   // the kinds the session may ask for itself, decline itself and relay the person's words for (a ruling, its withdrawal)
const relayedKind = (kind, record) => isRelayAskKind(kind) || (kind === RUN_CAP_KIND && record?.cap?.operation === 'raise');
const answeredOnAllowedChannel = (channel, kind, record = null) => PERSON_CHANNELS.includes(channel) || (channel === SESSION_CHANNEL && (SESSION_ELIGIBLE_KINDS.includes(kind) || relayedKind(kind, record)));
/**
 * Every answer the session relayed on a person's permission (B3 prototype): [{ gate, kind, channel, actor, person_words, at, total_usd? }], oldest first; [] when there is none or the ledger cannot be read.
 * report.json `relayed` lists them, so a reader sees who relayed what, in whose words.
 */
export function relayedAnswersOf(runDir) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return [];
  const closedBy = new Map(ledger.lines.filter(l => l.event === 'stop_answer_closed').map(l => [l.gate, l.code]));   // 0.8.4 (C&C 10 Nov): an answer the harness closed (the run did not take it) keeps its row, marked `not_taken` with the close code: it is never read as a choice the run made, and never omitted
  return ledger.lines.filter(l => l.event === 'gate_answered' && l.channel === SESSION_CHANNEL && typeof l.person_words === 'string').map(l => {
    const rec = readRecord(runDir, l.gate);
    return { gate: l.gate, kind: rec?.kind ?? null, channel: l.channel, actor: l.actor, person_words: l.person_words, at: l.ts, ...(Number.isFinite(l.cap_usd) || typeof l.cap_usd === 'string' ? { total_usd: Number(l.cap_usd) } : {}), ...(capNameOf(rec?.cap ?? {}) ? { cap_name: capNameOf(rec.cap) } : {}), ...(closedBy.has(l.gate) ? { not_taken: closedBy.get(l.gate) } : {}) };   // DUALCAP 4c1: the cap a relayed raise was for (absent with the switch off); not_taken: the harness closed the answer, the run did not take it (0.8.4)
  });
}
/**
 * S20 slice 1: every APPROVED answer to a raise gate (a run_cap gate whose operation is `raise`), oldest first, with what the ledger knows about it: who requested the gate, the answer's channel, actor, the person's words (a relay),
 * the client (a window), the figure, whether the run used it (a `cap_consumed` line for the gate) and the total of the SAME cap that was in force before it (the previous consumption of that cap: the OLD total is never stored, it is read).
 * -> { ok, rows: [{ gate, cap_name, requested_by, channel, actor, person_words, client_name, client_version, cap_micro_usd, cap_usd, answered_at, used_at, prior_micro_usd }] }; { ok: false, rows: [] } when the ledger cannot be read.
 * src/run-controls.js controlHistory formats it; the ledger line names stay in this module (test/gate-answer.test.js R3).
 */
export function raiseAnswersOf(runDir) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { ok: false, rows: [] };
  const lines = ledger.lines;
  const consumed = lines.filter(l => l.event === 'cap_consumed');
  const rows = [];
  for (const a of lines.filter(l => l.event === 'gate_answered' && l.decision === 'approved' && Number.isFinite(l.cap_micro_usd))) {
    const rec = readRecord(runDir, a.gate);
    if (!rec || rec.kind !== RUN_CAP_KIND || rec.cap?.operation !== 'raise') continue;
    const capName = capNameOf(rec.cap);
    const sameCap = consumed.filter(c => capNameOf(c) === capName);
    const use = sameCap.find(c => c.gate === a.gate) ?? null;
    const before = sameCap.filter(c => c.seq < (use ? use.seq : a.seq)).at(-1) ?? null;
    const requested = lines.find(l => l.event === 'gate_requested' && l.gate === a.gate);
    const closed = lines.find(l => l.event === 'cap_raise_closed' && l.gate === a.gate);
    rows.push({
      gate: a.gate, cap_name: capName, requested_by: requested?.requested_by ?? 'person', channel: a.channel, actor: a.actor ?? null,
      person_words: typeof a.person_words === 'string' ? a.person_words : null,
      client_name: typeof a.client_name === 'string' ? a.client_name : null, client_version: typeof a.client_version === 'string' ? a.client_version : null,
      cap_micro_usd: a.cap_micro_usd, cap_usd: Number(a.cap_usd), answered_at: a.ts, used_at: use ? use.ts : null, prior_micro_usd: before ? before.cap_micro_usd : null,
      ...(closed ? { closed: { code: closed.code, reason: closed.reason, at: closed.ts } } : {}),
    });
  }
  return { ok: true, rows };
}
/**
 * S20 slice 1 (C&C's ruling): THC's own determination that an APPROVED raise cannot be used. One `cap_raise_closed` line referencing the approval (the gate), the case (`code`: above_ceiling_now | below_floor | not_above_current) and the reason,
 * marked `by: "harness"`; the approval line is never rewritten. It uses the approval up (USE_EVENTS), so the gate reads as used and no longer usable: no reader mistakes it for a withdrawal, a person's answer or a relay.
 * Refuses (nothing written): a gate that is not a raise gate, a gate not approved or already used, an unknown code, no reason.
 */
export const RAISE_CLOSE_CODES = Object.freeze(['above_ceiling_now', 'below_floor', 'not_above_current']);
/**
 * 0.8.4 (C&C 10 Nov): THC's own determination that an APPROVED stop_decision answer was not taken by the run: the resume did not start, or the command line refused the answer's number. One `stop_answer_closed` line referencing the approval, marked `by: "harness"`;
 * the approval line is never rewritten. stopDecisionAnswerOf then skips it, so no later `--stop-gate` consumes it; the stop can be quoted and answered again (a new gate). Refuses (nothing written): a gate that is not a stop_decision gate, not approved or already used, an unknown code.
 */
export const STOP_CLOSE_CODES = Object.freeze(['number_refused', 'resume_not_started']);
export function closeStopAnswer(runDir, gateId, { code } = {}, { now = () => Date.now() } = {}) {
  if (!STOP_CLOSE_CODES.includes(code)) return refuse('bad_close_code', `a stop answer is closed for one of ${STOP_CLOSE_CODES.join(', ')}.`);   // A-DRAFT
  return recordUse(runDir, gateId, 'stop_answer_closed', { by: 'harness', code }, { now, before: ({ gate }) => (gate.kind === STOP_DECISION_KIND ? null : { code: 'not_a_stop_gate', message: `gate ${gateId} is not a stop_decision gate.` }) });
}
export function closeRaiseApproval(runDir, gateId, { code, reason } = {}, { now = () => Date.now() } = {}) {
  if (!RAISE_CLOSE_CODES.includes(code)) return refuse('bad_close_code', `a raise is closed for one of ${RAISE_CLOSE_CODES.join(', ')}.`);   // A-DRAFT
  if (typeof reason !== 'string' || !reason.trim()) return refuse('close_reason_required', 'a closed raise carries its reason.');   // A-DRAFT
  const st = readGateAnswer(runDir, gateId, { now });
  if (!st.gate || st.gate.kind !== RUN_CAP_KIND || st.gate.cap?.operation !== 'raise') return refuse('not_a_raise_gate', `gate ${gateId} is not a request to raise a run's spending limit.`);   // A-DRAFT
  return recordUse(runDir, gateId, 'cap_raise_closed', { by: 'harness', code, reason: reason.slice(0, 400), ...(Number.isFinite(st.answer?.cap_micro_usd) ? { cap_micro_usd: st.answer.cap_micro_usd } : {}) }, {
    now,
    before: ({ gate }) => (gate.kind === RUN_CAP_KIND && gate.cap?.operation === 'raise' ? null : { code: 'not_a_raise_gate', message: `gate ${gateId} is not a request to raise a run's spending limit.` }),
  });
}
/**
 * S20 slice 2, control 1 (Mini-C&C's rulings R176 and R179): the two writers of the route kinds, the only ones. `recordRouteRequest` writes `route_requested` (the PERSON asked for the next pass to be routed to layer 3; channel cli or session);
 * `recordRouteDecision` writes `route_decided` (the HANDLER decided, `decidedBy` "handler", or the PERSON decided and the handler carries the answer out, `decidedBy` "person", which needs his words). Neither is an approval of a gate and
 * neither touches one. The `reason` has two meanings (R228): the person's decision carries the relay sentence (`RELAY_REASON`, src/gate-ledger.js), the handler's own decision a free reason of at most 400 code points that is never the relay sentence; it is never cut here, a reason that does not fit is refused. Both check the line with the ledger's own `routeLineProblem` (so the chain check and the writer cannot disagree) under the ledger lock, and refuse, writing nothing, what only a state check can see:
 * route_request_open (a request for this pass waits for its decision) and route_pass_routed (the pass is already routed). -> { ok: true, seq } | { ok: false, code, message }
 */
export function recordRouteRequest(runDir, { pass, channel, personWords = null } = {}, { now = () => Date.now() } = {}) {
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const fields = { pass, floor: 3, by: 'person', channel, person_words: personWords };
      const problem = routeLineProblem({ event: 'route_requested', ...fields }, lines);
      if (problem) return refuse(problem.code, problem.message);
      if (lines.some(l => l.event === 'route_decided' && l.decision === 'routed' && l.pass === pass)) return refuse('route_pass_routed', `pass ${pass} is already routed to layer 3.`);   // A-DRAFT
      if (lines.some(l => l.event === 'route_requested' && l.pass === pass && !lines.some(d => d.event === 'route_decided' && d.request_seq === l.seq))) return refuse('route_request_open', `a request to route pass ${pass} waits for its decision.`);   // A-DRAFT
      return { ok: true, seq: append('route_requested', fields).seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}
export function recordRouteDecision(runDir, { requestSeq = null, pass, decision, decidedBy, personWords = null, reason } = {}, { now = () => Date.now() } = {}) {
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const fields = { request_seq: requestSeq, pass, floor: 3, decision, by: 'handler', decided_by: decidedBy, person_words: personWords, reason };
      const problem = routeLineProblem({ event: 'route_decided', ...fields }, lines);
      if (problem) return refuse(problem.code, problem.message);
      // a route with no request is for a pass nobody asked about: while a person's request for the pass waits, THAT request is what the handler decides (a writer refusal, not corruption: the chain check does not look for it)
      const open = fields.request_seq === null ? lines.find(l => l.event === 'route_requested' && l.pass === pass && !lines.some(d => d.event === 'route_decided' && d.request_seq === l.seq)) : null;
      if (open) return refuse('route_request_open', `a request to route pass ${pass} (request ${open.seq}) waits for its decision: decide that request.`);   // A-DRAFT
      return { ok: true, seq: append('route_decided', fields).seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}
/**
 * S20 slice 2 (#16c): the writers of the pause kinds, the only ones. `recordPauseRequest` writes `pause_requested` (the person or the handler asked the RUNNING run to stop before its next pass); `recordPauseSettled` writes `pause_taken` (the sitting that stopped for the
 * request was resumed) or `pause_lapsed` (the request ended without being taken). Neither is an approval of a gate. All check the line with the ledger's own `pauseLineProblem` (so the chain check and the writer cannot disagree) under the ledger lock; a second UNTAKEN request is
 * `pause_request_open` (a writer refusal, not corruption). -> { ok: true, seq } | { ok: false, code, message }
 */
export function recordPauseRequest(runDir, { pass, by, channel, personWords = null, reason = null } = {}, { now = () => Date.now() } = {}) {
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const fields = { pass, by, channel, person_words: personWords, reason };
      const problem = pauseLineProblem({ event: 'pause_requested', ...fields }, lines);
      if (problem) return refuse(problem.code, problem.message);
      if (untakenPauseOf(lines)) return refuse('pause_request_open', 'a request to pause the run waits to be taken.');   // A-DRAFT
      return { ok: true, seq: append('pause_requested', fields).seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}
/**
 * 0.8.4 (ladder unit): the writer of `budget_finish`, the only one: the person's choice at a spending stop - finish_now (ends the run at no cost) or the plain finish (inside the review rounds) - typed at the terminal or RELAYED by the handling session (see gate-ledger.js). Checks the line with the
 * ledger's own `budgetFinishLineProblem` under the ledger lock. The person's LATEST choice decides: a finish_now stands until the person approves a limit after it, starts a raise after it that still waits, or gives a plain finish after it; a choice given again is a NEW line unless it is still the
 * standing one (typed twice = one line). A RELAYED line is written only behind an approved answer on the person-only stop gate of THIS stop (`stopId`) that carries this choice and these words, relayed by the session; without it nothing is recorded (WORDING LAD-R12).
 * -> { ok: true, seq, already } | { ok: false, code, message }
 */
export function recordBudgetFinish(runDir, { stopSha256, phase, choice = 'finish_now', stopId = null, relayed = null, label = null, capName = null } = {}, { now = () => Date.now() } = {}) {   // `relayed`: { personWords, gate } when the handling session relays the person's words (channel session); null for a choice typed at the terminal
  if (relayed) {
    const st = readGateAnswer(runDir, relayed.gate, { now });
    const answered = st.status === 'approved' && st.gate?.kind === STOP_DECISION_KIND && st.gate.stop?.person_only === true && typeof stopId === 'string' && st.gate.stop.id === stopId
      && st.answer?.channel === SESSION_CHANNEL && st.answer.stop_answer?.relayed === true && st.answer.stop_answer.choice === choice && typeof relayed.personWords === 'string' && st.answer.person_words === relayed.personWords;
    if (!answered) return refuse('budget_finish_unanswered', 'a relayed finish at the spending limit is written only behind the person\'s answer on the person-only stop gate of this stop, with their words; none was found. Nothing was recorded.');   // A-DRAFT (LAD-R12)
  }
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const standing = choice === 'finish_now' ? budgetFinishOf(lines, stopSha256, now()) : (budgetFinishLatest(lines, stopSha256)?.choice === choice ? budgetFinishLatest(lines, stopSha256) : null);   // the same choice already the latest at this stop: nothing is written twice
      if (standing) return { ok: true, seq: standing.seq, already: true };
      const fields = { stop_sha256: stopSha256, phase, choice, ...(label ? { label } : {}), ...(capName ? { cap_name: capName } : {}), actor: 'person', ...(relayed ? { channel: 'session', relayed: true, person_words: relayed.personWords, stop_gate: relayed.gate } : { channel: 'cli' }) };
      const problem = budgetFinishLineProblem({ event: 'budget_finish', ...fields }, lines);
      if (problem) return refuse(problem.code, problem.message);
      return { ok: true, seq: append('budget_finish', fields).seq, already: false };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}
/**
 * 0.8.4 (relay of --finish-now): whether a spending limit was APPROVED (a run_cap gate answered "approved", on any channel) after the stop_decision gate `gateId` was requested. An answer relayed for one spending stop must not be taken once the person has raised the limit since: the raise is on the
 * ledger, the stop file (project-writable) may be put back. true also when the ledger cannot be read (fail closed). Pure of the clock.
 */
export function limitApprovedAfterGate(runDir, gateId) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return true;
  const asked = ledger.lines.find(l => l.event === 'gate_requested' && l.gate === gateId);
  if (!asked) return true;
  const capGates = new Set(ledger.lines.filter(l => l.event === 'gate_requested' && l.kind === RUN_CAP_KIND).map(l => l.gate));
  return ledger.lines.some(l => l.event === 'gate_answered' && capGates.has(l.gate) && l.decision === 'approved' && l.seq > asked.seq);
}
/** Whether the command line took the answer of stop_decision gate `gateId` for a spending stop: it wrote the person's finish-now on the ledger naming that gate (before its first call). The tool then does not close the answer even when the resume ended at exit 4. */
export function budgetFinishTakenFromGate(runDir, gateId) {
  const ledger = readLedger(runDir);
  return ledger.ok && ledger.lines.some(l => l.event === 'budget_finish' && l.stop_gate === gateId);
}
/** 0.8.4 (parity item G1; C&C 10 Nov): whether the person's finish at the owner's pause of pass `pass` was RELAYED by the handling session, read from the gate ledger (the answered stop_decision gate of that pause, session channel, relayed, this choice) - never from run.json, which a crash between the settle and the choice flush leaves without the entry. NEVER throws. */
export function pauseFinishRelayedFromLedger(runDir, pass, choice, finishedSeq) {
  try {
    const ledger = readLedger(runDir);
    if (!ledger.ok) return false;
    for (const l of ledger.lines) {
      if (l.event !== 'gate_requested' || l.kind !== STOP_DECISION_KIND || l.requested_by !== 'session') continue;
      if (ledger.lines.some(c => c.event === 'stop_answer_closed' && c.gate === l.gate)) continue;   // an answer the run did not take (closed by the harness) is not how this finish came
      const answeredAt = ledger.lines.find(a => a.event === 'gate_answered' && a.gate === l.gate && a.decision === 'approved')?.seq;
      if (!Number.isInteger(answeredAt) || !(answeredAt < finishedSeq)) continue;   // only an answer given BEFORE the settle wrote pause_finished can have ended the run
      const st = readGateAnswer(runDir, l.gate);
      const m = /^owner_pause:\d+:(\d+)/.exec(String(st.gate?.stop?.id ?? ''));
      if (st.status === 'approved' && st.answer?.channel === SESSION_CHANNEL && m && Number(m[1]) === pass && st.answer.stop_answer?.relayed === true && st.answer.stop_answer.choice === choice) return true;
    }
  } catch { /* an unreadable ledger answers "not relayed": the person's choice still stands, only the mark is not added */ }
  return false;
}
/**
 * 0.8.4 (Q9): whether gate `gateId` holds the person's RELAYED `choice` at THIS found-secret pause (`stopId` = secretGateStopId): approved on the person-only stop gate, on the session channel, with the person's words (and these words, when given). The ledger is the only authority, never run.json:
 * a later sitting that carries a recorded relayed finish checks it here before it says the finish was relayed. No time limit (the sitting after a session's handoff comes later than the ten minutes the first read allows). -> null | { gate, person_words, at }.
 */
export function relayedSecretAnswerOf(runDir, gateId, stopId, choice, personWords = null) {
  if (typeof gateId !== 'string' || !gateId) return null;
  const ledger = readLedger(runDir);
  if (!ledger.ok || ledger.lines.some(l => l.event === 'stop_answer_closed' && l.gate === gateId)) return null;   // fail closed: a closed answer (the run did not take it) is never a relayed choice
  const st = readGateAnswer(runDir, gateId, {});
  const ok = st.status === 'approved' && st.gate?.kind === STOP_DECISION_KIND && st.gate.stop?.person_only === true && st.gate.stop.id === stopId
    && st.answer?.channel === SESSION_CHANNEL && st.answer.stop_answer?.relayed === true && st.answer.stop_answer.choice === choice && typeof st.answer.person_words === 'string' && (personWords === null || st.answer.person_words === personWords);
  return ok ? { gate: gateId, person_words: st.answer.person_words, at: st.answer.ts } : null;
}
/** The person's finish-now on record for THIS stop (by its hash), or null; null too when the ledger cannot be read (fail closed: nothing is applied from a record that cannot be verified). */
export function budgetFinishRecordFor(runDir, stopSha256) {
  const ledger = readLedger(runDir);
  return ledger.ok ? budgetFinishOf(ledger.lines, stopSha256) : null;   // ONE authority, the hash-chained ledger: a plain finish given later is a later line there, run.json is never read
}
/** The person's plain finish at THIS stop (by its hash) when it is their latest choice there, or null; null too when the ledger cannot be read (fail closed). The ONE authority that arms the ending after a raise (never run.json alone). */
/** The plain finish that governs the run's ending (the latest budget_finish line of the run, if it is a plain finish), or null; null too when the ledger cannot be read. The authority that arms the ending after a raise, across a second stop. */
export function budgetPlainFinishRunRecord(runDir) {
  const ledger = readLedger(runDir);
  return ledger.ok ? budgetPlainFinishOfRun(ledger.lines) : null;
}
/** Same, with the ledger's own state: { ok: false } when the approval record cannot be read (a caller that would otherwise fall through to an unarmed raise refuses instead), else { ok: true, rec }. */
export function budgetPlainFinishRunState(runDir) {
  const ledger = readLedger(runDir);
  return ledger.ok ? { ok: true, rec: budgetPlainFinishOfRun(ledger.lines), continued: budgetLatestOfRun(ledger.lines)?.choice === 'continue' } : { ok: false, rec: null, continued: false };
}
/** 0.8.4 (unit-end item ii): whether a finish of the person's (plain or now) is their latest choice of the run, so a `continue` has something to go on past; false too when the ledger cannot be read (fail closed). */
export function budgetFinishStandsForContinue(runDir) {
  const ledger = readLedger(runDir);
  return ledger.ok && budgetFinishStandsOfRun(ledger.lines);
}
export function budgetPlainFinishRecordFor(runDir, stopSha256) {
  const ledger = readLedger(runDir);
  return ledger.ok ? budgetPlainFinishOf(ledger.lines, stopSha256) : null;
}
/** Whether the quote text the stop_decision gate `gateId` holds names the FULL hash of the stop file (the id carries only its first 12 characters): the answer is taken only for the stop whose figures hash exactly so. false when the gate or its text cannot be read. */
export function gateQuoteNamesHash(runDir, gateId, stopSha256) {
  const st = readGateAnswer(runDir, gateId);
  if (!st.gate || typeof stopSha256 !== 'string' || stopSha256.length !== 64) return false;
  const bytes = readGateText(runDir, st.gate.text);
  return !!bytes && Buffer.from(bytes).toString('utf8').includes(`Stop file hash: ${stopSha256}`);
}
export function recordPauseSettled(runDir, { event, requestSeq, choice, pass } = {}, { now = () => Date.now() } = {}) {
  if (event !== 'pause_taken' && event !== 'pause_lapsed' && event !== 'pause_finished') return refuse('pause_event_invalid', 'a pause request is taken, lapsed or finished.');   // A-DRAFT
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const fields = { request_seq: requestSeq, ...(event === 'pause_finished' ? { choice, pass } : {}) };
      const problem = pauseLineProblem({ event, ...fields }, lines);
      if (problem) return refuse(problem.code, problem.message);
      return { ok: true, seq: append(event, fields).seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}
/**
 * Every pause request of a run, read from the gate ledger (never recorded anywhere else), oldest first: [{ seq, pass, by, channel, person_words, reason, at, taken: { seq, at } | null, lapsed: { seq, at } | null }] and `untaken` (the one standing request or null).
 * -> { ok: true, requests, untaken } | { ok: false, requests: [], untaken: null } when the ledger cannot be read (a missing ledger is an empty one).
 */
export function pauseStateOf(runDir) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { ok: false, requests: [], untaken: null };
  const requests = pauseRequestsOf(ledger.lines).map(({ line, taken, lapsed, finished }) => ({ seq: line.seq, pass: line.pass, by: line.by, channel: line.channel, person_words: line.person_words, reason: line.reason, at: line.ts, taken: taken ? { seq: taken.seq, at: taken.ts } : null, lapsed: lapsed ? { seq: lapsed.seq, at: lapsed.ts } : null, finished: finished ? { seq: finished.seq, at: finished.ts, choice: finished.choice, pass: finished.pass } : null }));
  return { ok: true, requests, untaken: requests.find(r => !r.taken && !r.lapsed && !r.finished) ?? null };
}
/**
 * Every route request and decision of a run, read from the gate ledger and never recorded anywhere else (report.json's `run_controls[]` derives from this): [{ pass, request, decision }], in the ledger's order, where `request` is
 * { seq, channel, person_words, at } or null (a route nobody asked for) and `decision` is { seq, decision, decided_by, person_words, reason, at } or null (a request nobody has decided: it is NEVER dropped, and nothing closes it but a decision).
 * -> { ok: true, controls } | { ok: false, controls: [] } when the ledger cannot be read.
 */
export function routeControlsOf(runDir) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { ok: false, controls: [] };
  const controls = []; const byRequest = new Map();
  for (const l of ledger.lines) {
    if (l.event === 'route_requested') {
      const row = { pass: l.pass, request: { seq: l.seq, channel: l.channel, person_words: l.person_words, at: l.ts }, decision: null };
      controls.push(row); byRequest.set(l.seq, row);
    } else if (l.event === 'route_decided') {
      const decision = { seq: l.seq, decision: l.decision, decided_by: l.decided_by, person_words: l.person_words, reason: l.reason, at: l.ts };
      const row = l.request_seq === null ? null : byRequest.get(l.request_seq);
      if (row) row.decision = decision; else controls.push({ pass: l.pass, request: null, decision });
    }
  }
  return { ok: true, controls };
}
/**
 * Every request the session declined itself (B3 prototype): [{ gate, kind, actor, reason, at }], oldest first; [] when there is none or the ledger cannot be read. It carries no person_words (a refusal sets nothing), so `relayedAnswersOf`
 * does not list it; report.json `declined_requests` does, so a reader finds it without opening the gate ledger.
 */
export function declinedBySessionOf(runDir) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return [];
  return ledger.lines.filter(l => l.event === 'gate_answered' && l.channel === SESSION_CHANNEL && l.decision === 'declined').map(l => ({ gate: l.gate, kind: readRecord(runDir, l.gate)?.kind ?? null, actor: l.actor ?? null, reason: l.reason ?? null, at: l.ts })).filter(r => isRelayAskKind(r.kind));   // only a ruling or a withdrawal: no other kind of gate surfaces here
}
/**
 * A ruling is asked for (B3 prototype): its text file is written into the run folder and a gate of kind `ruling` is requested for it (as a session gate when `relayed`, so the handler session can relay his answer). Refuses, writing
 * nothing: ruling_empty, ruling_duplicate (the same text for the same pass is already pending or approved), and whatever requestGate refuses.
 */
export function requestRuling(runDir, { pass, text, relayed = false }, { now = () => Date.now() } = {}) {
  if (!Number.isInteger(pass) || pass < 1 || typeof text !== 'string' || !text.trim()) return refuse('ruling_empty', 'a ruling needs a pass number and its text.');   // A-DRAFT
  const body = rulingGateText(pass, text);
  const have = rulingsOf(runDir, { now });
  if (!have.ok) return refuse('gate_ledger_corrupt', 'the approval record of this run cannot be read.');
  if ([...have.rulings, ...have.pending].some(r => r.pass === pass && String(r.text).trim() === text.trim())) return refuse('ruling_duplicate', `this ruling is already recorded or waiting for pass ${pass}.`);   // A-DRAFT
  const file = `ruling-${pass}-${textSha256(Buffer.from(body)).slice(0, 8)}.md`;
  return askForGate(runDir, RULING_KIND, file, body, relayed, now);
}
/** The text file of a ruling or a withdrawal is written, then its gate is requested; when requestGate refuses, the file it wrote is removed again (a refused request leaves nothing behind). */
function askForGate(runDir, kind, file, body, relayed, now) {
  writeAtomic(join(runDir, file), body);
  const res = requestGate(runDir, { kind, textPath: file, expiresAt: now() + RULING_TTL_MS, ...(relayed ? { requestedBy: 'session' } : {}) }, { now });
  if (!res.ok) { try { unlinkSync(join(runDir, file)); } catch { /* already gone */ } }
  return res;
}
/**
 * A withdrawal is asked for (B3 prototype, 31 Okt 2026): the person may take an APPROVED ruling out of force from pass `pass` on (a pass with no stage on disk, so no earlier prompt changes). It is a gate of its own kind; the ruling stays in the
 * record and `rulingsOf` shows the withdrawal beside it. Refuses, writing nothing: withdrawal_not_a_ruling (the target is not an approved, readable ruling), withdrawal_duplicate (already withdrawn, or one is waiting), whatever requestGate refuses.
 */
export function requestWithdrawal(runDir, { gate, pass, relayed = false }, { now = () => Date.now() } = {}) {
  if (typeof gate !== 'string' || !GATE_ID.test(gate) || !Number.isInteger(pass) || pass < 1) return refuse('withdrawal_not_a_ruling', 'a withdrawal needs the gate of an approved ruling and a pass number');   // A-DRAFT
  const have = rulingsOf(runDir, { now });
  if (!have.ok) return refuse('gate_ledger_corrupt', 'the approval record of this run cannot be read.');
  const target = have.rulings.find(r => r.gate === gate);
  if (!target) return refuse('withdrawal_not_a_ruling', `gate ${gate} is not an approved ruling of this run${have.pending.some(r => r.gate === gate) ? ' (it is still waiting for his answer: decline it instead)' : ''}`);   // A-DRAFT
  if (target.withdrawn || have.pending.some(r => r.kind === RULING_WITHDRAWAL_KIND && r.target === gate)) return refuse('withdrawal_duplicate', `ruling ${gate} is already withdrawn, or a withdrawal of it is already waiting for the person's answer.`);   // A-DRAFT
  const body = withdrawalGateText(gate, pass);
  return askForGate(runDir, RULING_WITHDRAWAL_KIND, `ruling-withdrawal-${gate}-${pass}-${textSha256(Buffer.from(body)).slice(0, 8)}.md`, body, relayed, now);
}
/**
 * The session declines a ruling or a withdrawal IT asked for and that still waits (B3 prototype): a refusal can set no ruling, so it takes no person_words, only the written reason. A gate a person asked for is declined only by the person
 * (`council gate answer <run> <gate> --decline`); a cap raise is not touched by this call at all.
 */
export function declineOwnRequest(runDir, gateId, { reason }, opts) {
  const state = readGateAnswer(runDir, gateId, opts);
  if (state.gate && !isRelayAskKind(state.gate.kind)) return refuse('decline_not_a_ruling', `gate ${gateId} is a ${state.gate.kind} gate: only a ruling or a withdrawal can be declined by the session that asked for it`);   // A-DRAFT
  return answerGate(runDir, gateId, { channel: SESSION_CHANNEL, shownSha256: state.gate?.sha256, decision: 'declined', actor: 'main-session', reason, tty: false }, opts);
}

/**
 * The rulings of a run, from its gate ledger (B3 prototype): { ok, rulings: [{ gate, pass, text, channel, actor, person_words, at }], pending: [{ gate, pass, text }], unreadable: [gate] }, oldest first.
 * `rulings` = approved ones, in force from their pass on whatever the clock says (an approval does not lapse); `pending` = asked for and not answered yet, not expired; `unreadable` = a ruling gate whose text is not a ruling or cannot
 * be read: the caller refuses to go on, because dropping it silently would change prompts that are already on disk. { ok: false } when the ledger cannot be read.
 */
export function rulingsOf(runDir, { now = () => Date.now() } = {}) {
  const listed = listGates(runDir, { now });
  if (listed === null) return { ok: false, rulings: [], pending: [], unreadable: [], unreadableInfo: [] };
  const out = { ok: true, rulings: [], pending: [], unreadable: [], unreadableInfo: [] };
  const withdrawals = [];
  const asked = readLedger(runDir).lines.filter(l => l.event === 'gate_requested');
  for (const g of listed) {
    const st = readGateAnswer(runDir, g.id, { now });
    const kind = asked.find(l => l.gate === g.id)?.kind ?? st.gate?.kind;   // the kind is the ledger's: a damaged gate file has no readable kind
    if (!isRulingKind(kind)) continue;
    if (st.status === 'invalid') { const rec = readRecord(runDir, g.id); out.unreadable.push(g.id); out.unreadableInfo.push({ gate: g.id, file: typeof rec?.text === 'string' ? rec.text : null, sha256: typeof rec?.sha256 === 'string' ? rec.sha256 : null }); continue; }   // a text changed after approval is 'invalid' with the record still readable: the record names the file and the bytes it was approved for
    if (st.status !== 'approved' && st.status !== 'pending') continue;   // declined or expired: no ruling
    const bytes = readGateText(runDir, st.gate.text);
    const parsed = bytes && textSha256(bytes) === st.gate.sha256 ? (kind === RULING_KIND ? parseRulingGateText(bytes) : parseWithdrawalGateText(bytes)) : null;   // the bytes must be the ones the gate was asked and answered for, pending or approved
    if (!parsed) { out.unreadable.push(g.id); out.unreadableInfo.push({ gate: g.id, file: st.gate.text, sha256: st.gate.sha256 }); continue; }
    if (st.status === 'pending') { out.pending.push(kind === RULING_KIND ? { gate: g.id, kind, ...parsed } : { gate: g.id, kind, target: parsed.gate, pass: parsed.pass }); continue; }
    const a = st.gate.answer || {};
    const who = { channel: a.channel ?? null, actor: a.actor ?? null, person_words: typeof a.person_words === 'string' ? a.person_words : null, at: a.at ?? null };
    if (kind === RULING_KIND) out.rulings.push({ gate: g.id, ...parsed, ...who });
    else withdrawals.push({ gate: g.id, target: parsed.gate, from_pass: parsed.pass, ...who });
  }
  for (const w of withdrawals) {   // an approved withdrawal is attached to its ruling; one that names no approved, readable ruling (or a second one for the same ruling) is never dropped: it is listed as unreadable
    const target = out.rulings.find(r => r.gate === w.target);
    if (!target || target.withdrawn) { out.unreadable.push(w.gate); out.unreadableInfo.push({ gate: w.gate, file: null, sha256: null }); continue; }
    const { target: _t, ...rest } = w;
    target.withdrawn = rest;
  }
  return out;
}
/** The whole numbers and decimals written in `words` ("$30", "30 dollars", "12.5"), as numbers. */
export const figuresIn = words => {
  // A whole run of digits, dots and commas is ONE token. A comma-free token is a number when it has at most one dot ("30", "12.5"). A token with a comma is read only as valid thousand grouping ("$1,000", "12,345,678.5"); any other ("12,50", "1,5",
  // "1.000,50", "1,0000") is ambiguous between a decimal comma and a separator, so NO figure is read from it, not even a part. A token with two dots ("1.000.000") likewise yields none. The total must then come from his words written with a dot or
  // without a separator.
  const out = [];
  for (const [tok] of String(words).matchAll(/\d(?:[\d.,]*\d)?/g)) {
    if (tok.includes(',') ? /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(tok) : /^\d+(?:\.\d+)?$/.test(tok)) out.push(Number(tok.replace(/,/g, '')));
  }
  return out.filter(Number.isFinite);
};
/** The ONE call that answers a gate on the session channel on a person's relayed permission (B3 prototype): the person's words verbatim are required, and for a limit the typed total must appear in them. */
export function answerGateAsRelay(runDir, gateId, { shownSha256, reason, personWords, typedCap }, opts) {
  return answerGate(runDir, gateId, { channel: SESSION_CHANNEL, shownSha256, decision: 'approved', actor: 'main-session', reason, tty: false, personWords, typedCap }, opts);
}
// The session answers only a gate it asked for itself (the ledger line of the request carries the requester): the refusal as ONE sentence for answerGate (below) and for the run-controls interface, which asks it BEFORE any other check so that the reason a
// person reads does not depend on timing. null = the gate was asked for by the session. (Moved out of answerGate unchanged, 0.8.4 S20 slice 2.)
const sessionOwnerRefusal = (lines, gateId) => (lines.find(l => l.event === 'gate_requested' && l.gate === gateId)?.requested_by !== 'session'
  ? refuse('gate_not_session_requested', `gate ${gateId} was asked for by a person: only the person answers it (the session answers a gate it asked for itself)`)       // B-DRAFT
  : null);
/** sessionOwnerRefusal for a run folder: null | { ok: false, code, message }. A ledger that cannot be read refuses (fails closed). */
export function sessionOwnerRefusalOf(runDir, gateId) {
  const ledger = readLedger(runDir);
  return ledger.ok ? sessionOwnerRefusal(ledger.lines, gateId) : refuse('gate_ledger_corrupt', 'the approval record of this run cannot be read.');
}
export const GATE_SCHEMA = 'gate/1';
export const GATES_DIR = 'gates';
// Ten minutes: the default life of a gate (it was the life of an advice add-on quote until 0.8.4; the window is unchanged).
// Defined here rather than imported because this module must not depend on the MCP layer.
export const GATE_TTL_MS = 10 * 60_000;
const DECISIONS = ['approved', 'declined'];
// What uses up an approval (one approval, one use): a contract lock, or the approval of a contract amendment (0.8.2 item 6d); `sent` is the legacy word of the removed advice add-on (read-only, so old ledgers verify). The
// others are written through recordUse (src/contract-record.js and the gate's own writers), so `used` is decided in one place, under the ledger lock.
export const USE_EVENTS = Object.freeze(['sent', 'contract_locked', 'amend_decided', 'tree_frontier_approved', 'tree_decided', 'tree_checked', 'cap_consumed', 'cap_raise_closed', 'stop_answer_closed', 'excerpts_recorded']);   // cap_raise_closed (S20 slice 1): THC closes an approved raise that can never be consumed, so it is `used` and no longer `usable`; the last three before it: 0.8.3 M5b, a tree's frontier approval and `tree decide`; M6 S2, `tree check` (src/tree-gate.js)
export const GATE_ID = /^g[1-9][0-9]{0,5}$/;   // exported (0.8.4 F3, H-F3-b): src/mcp/server.js shows a ledger's gate id only if it passes this test, one copy of the shape
const KIND = /^[a-z][a-z_]{0,31}$/;
const MASK_KEY = /^[a-z][a-z0-9_]{0,31}$/;
// Seat descriptions and labels are shown to the person before they approve, so they are short strings:
// 300 characters is about three terminal lines, room for a retention sentence quoted from a lab's page.
const FIELD_MAX = 300;
const SEATS_MAX = 16; // above any shipped advice chain (advise-premium has the most seats)

/** sha256 of a text file's raw bytes: the one definition the gate, the CLI and (M4) the quote share. */
export const textSha256 = bytes => sha256Hex(bytes);

// JSON with object keys sorted at every depth, so equal metadata always hashes equal.
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v));
// The metadata as it is written to the gate file: JSON's own rules (an undefined key is dropped), so the hash
// at request time and the hash recomputed from the file are of the same thing. Without this, a price with
// `expected_usd: undefined` hashed differently from the file and made a gate no one could answer.
// `follow_up` (0.8.1 DR-8) is absent on most gates; JSON drops an undefined key, so a gate without it hashes as it did in M3.
// JSON writes NaN and Infinity as null, and null is an ACCEPTED value in several fields (a seat's "unknown", a cap's "no ceiling"), so a check made on the written form would take a NaN for an honest null (box-21, 14 Oct 2026: run-cap-gate.test.js 'ceiling NaN'). The class is closed here, once: every round trip below refuses a non-finite number, wherever it sits.
class NonFiniteError extends TypeError {}
const finiteOnly = (key, v) => { if (typeof v === 'number' && !Number.isFinite(v)) throw new NonFiniteError(`${key || 'the value'} is not a finite number (NaN or Infinity); every amount and count in a gate must be a finite number`); return v; };
const asWritten = ({ price, seats, sensitivity, masks, follow_up, cap, excerpts, stop }) => JSON.parse(JSON.stringify({ price, seats, sensitivity, masks, follow_up, cap, excerpts, stop }, finiteOnly));
/** sha256 binding what the person is told about a send: price, seats, sensitivity, masks, and the follow-up line when there is one. */
export const metaSha256 = meta => sha256Hex(canonical(asWritten(meta)));

// 0.8.3 M6 typed cap T3 (typed-cap gate page section 3; 14 Oct 2026): the `run_cap` gate kind. The text it names is the SCREEN a person reads (src/cap-screen.js); the pending decision is the `cap` object below, bound into meta_sha256
// like the price and seats, so it cannot be changed after the screen is shown. The answer is a TYPED amount: the person's text goes through parseCapInput HERE, against the ceiling bound in `cap`, and the normalized dollars
// and the integer micro-dollars are written on `gate_answered` from that parse - never from a caller's argument. An approval without typed text is refused by answerGate itself, so no channel (the terminal, an MCP dialog, a later
// caller) can approve with a bare yes. The use is `cap_consumed`, single-use for ever (consumeRunCap); continuing a run under its consumed cap is the read-only runCapAuthority.
export const RUN_CAP_KIND = 'run_cap';
// `start` a main run; `resume_legacy` a resume of a run made before the typed cap; `tree_start` a tree's root cap; `side:<verb>` a replay, rematch, handoff, contract draft or digest start (a new logical run).
// T4b (14 Oct 2026): a run may carry a SEQUENCE of consumptions. The first is one of the five above; every later one is `raise` (a new typed TOTAL after a budget stop) or `amend_scope` (a new typed total after the scope the first
// limit was typed under changed, a recorded amendment among others). One typed limit still has ONE spender: a GATE is consumed once (gate_used); a RUN's limit in force is its LAST consumption (runCapAuthority).
export const CAP_OPERATION = /^(start|resume_legacy|tree_start|raise|amend_scope|side:[a-z][a-z-]{0,23})$/;
const LATER_OPERATION = /^(raise|amend_scope)$/;
const CAP_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const CAP_KEYS = ['ceiling_source', 'ceiling_usd', 'operation', 'run_id', 'scope_sha256'];
// DUALCAP unit 4b1: the optional sixth key, the cap a typed limit is for (absent = a run's one limit, as before). One spelling for writer and reader: caps.js CAP_RECORD_FIELDS.
const CAP_NAME_KEY = CAP_RECORD_FIELDS.gate;
const capNameOf = x => (x && typeof x === 'object' && Object.hasOwn(x, CAP_NAME_KEY) ? x[CAP_NAME_KEY] : null);
function capProblem(cap) {
  if (!cap || typeof cap !== 'object' || Array.isArray(cap) || Object.keys(cap).filter(k => k !== CAP_NAME_KEY).sort().join() !== CAP_KEYS.join()) return ['bad_cap', `a run_cap gate needs cap = { ${CAP_KEYS.join(', ')} } and nothing else`];
  if (Object.hasOwn(cap, CAP_NAME_KEY) && !BILLING_CAP_IDS.includes(cap[CAP_NAME_KEY])) return ['bad_cap', `cap.${CAP_NAME_KEY} must be a provider that bills (one of ${BILLING_CAP_IDS.join(', ')}), or absent`];   // A-DRAFT
  if (typeof cap.operation !== 'string' || !CAP_OPERATION.test(cap.operation)) return ['bad_cap', 'cap.operation must be start, resume_legacy, tree_start or side:<verb>'];
  if (typeof cap.run_id !== 'string' || !CAP_RUN_ID.test(cap.run_id)) return ['bad_cap', 'cap.run_id must be the run id the limit is typed for'];
  if (typeof cap.scope_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(cap.scope_sha256)) return ['bad_cap', 'cap.scope_sha256 must be a sha256 hex digest of what the run will do (capScopeSha256)'];
  if (cap.ceiling_usd !== null && !(typeof cap.ceiling_usd === 'number' && Number.isFinite(cap.ceiling_usd) && cap.ceiling_usd > 0)) return ['bad_cap', 'cap.ceiling_usd must be null or a number above 0'];
  if (cap.ceiling_source !== null && !isStr(cap.ceiling_source)) return ['bad_cap', 'cap.ceiling_source must be null or a short string'];
  // Pairing (C&C ruling, 14 Oct 2026): both null is the honest "no ceiling known"; a figure with no named origin, or an origin with no figure, is refused. A closed list of sources is a T5 obligation (B_STATE follow-up list).
  if ((cap.ceiling_usd === null) !== (cap.ceiling_source === null)) return ['bad_cap', 'cap.ceiling_usd and cap.ceiling_source must both be null or both be set'];
  return null;
}
/** sha256 of the canonical JSON of what a run will do (task file hash, chain file hash, seats, policy hash, sensitivity floor, PII mode, the ceiling in force...). The caller assembles the object; this is the one hash both the request and the consumption use. */
// A non-finite number in the scope THROWS (finiteOnly, above): a NaN ceiling would otherwise hash like "no ceiling" and the stale-screen check could not tell them apart.
export const capScopeSha256 = scope => sha256Hex(canonical(JSON.parse(JSON.stringify(scope, finiteOnly))));

function capAnswerProblem(answered, cap) {
  if (typeof answered.cap_usd !== 'string' || !Number.isInteger(answered.cap_micro_usd)) return 'cap_answer_unreadable';
  const parsed = parseCapInput(answered.cap_usd, { ceilingUsd: cap.ceiling_usd, ceilingSource: cap.ceiling_source, paid: true });
  return parsed.ok && parsed.capUsd === answered.cap_usd && parsed.capMicroUsd === answered.cap_micro_usd ? null : 'cap_answer_inconsistent';
}

// 0.8.4 D10 (plan A T5.5), slice 2a: the `excerpt_approval` gate kind. One gate per pause; the text it names is the SCREEN a person reads (every excerpt of the pause, in full, with its lines numbered); the `excerpts`
// list below is bound in the gate's metadata hash, like a limit gate's `cap`, so a person's answer is for exactly these excerpts and this screen and cannot be replayed against others. Approving it is one answer
// per excerpt (approve, edit, refuse), never a bare yes; declining it stays allowed and means refuse-all. The session can neither answer nor relay it (the kind is in neither list above). The answers ride on the
// `gate_answered` line as `excerpt_answers`, and a later `excerpts_recorded` line says the pause wrote the rows from them (EXCERPTS_RECORDED_EVENT, below).
export const EXCERPT_APPROVAL_KIND = 'excerpt_approval';
export const EXCERPT_ANSWER_DECISIONS = Object.freeze(['approve', 'edit', 'refuse']);
export const EXCERPTS_RECORDED_EVENT = 'excerpts_recorded';
const EXCERPT_ID = /^E-[1-9][0-9]{0,5}$/;
const EXCERPT_LINES = /^([1-9][0-9]{0,5})-([1-9][0-9]{0,5})$/;
// How many excerpts ONE gate binds and how long one may be: bounds of the gate's metadata validator (a screen a person can read, chosen with the gate kind in D10 slice 2a). Nothing reads them as a limit of the RECORD:
// excerpts.jsonl has no count or length limit. A pause with more texts gets several gates (src/excerpt-pause.js); a text longer than the bound is not asked about (src/excerpt-resume.js).
export const EXCERPTS_MAX = 20;
export const SHOWN_LINES_MAX = 100000;
export const EXCERPT_LINE_NUMBER_MAX = 999999;   // the most digits EXCERPT_LINES below allows in a line number
const excerptNumber = id => Number(id.slice(2));
function excerptsProblem(list) {
  const bad = message => ['bad_excerpts', `an excerpt_approval gate needs excerpts = [{ id, lines, text_sha256, shown_lines }, ...]: ${message}`];
  if (!Array.isArray(list) || list.length < 1 || list.length > EXCERPTS_MAX) return bad(`between 1 and ${EXCERPTS_MAX} entries`);
  let prev = 0;
  for (const e of list) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).sort().join() !== 'id,lines,shown_lines,text_sha256') return bad('every entry has exactly id, lines, text_sha256 and shown_lines');
    if (typeof e.id !== 'string' || !EXCERPT_ID.test(e.id)) return bad('id must look like E-<n>');
    if (excerptNumber(e.id) <= prev) return bad('ids must be unique and ascending');
    prev = excerptNumber(e.id);
    if (e.lines !== null) { const m = typeof e.lines === 'string' ? EXCERPT_LINES.exec(e.lines) : null; if (!m || Number(m[1]) > Number(m[2])) return bad('lines must be a-b with a <= b, or null'); }
    if (typeof e.text_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.text_sha256)) return bad('text_sha256 must be a sha256 hex digest');
    if (!Number.isInteger(e.shown_lines) || e.shown_lines < 1 || e.shown_lines > SHOWN_LINES_MAX) return bad(`shown_lines must be a whole number from 1 to ${SHOWN_LINES_MAX}`);
  }
  return null;
}
/**
 * The person's answers against the list bound in the gate: one answer for EVERY bound id, no other id, none twice; each decision one of approve, edit, refuse; an edit names a narrower range (positions in the
 * numbered lines the screen showed) and/or lines to hide inside the kept range, and must change something; a refusal may carry the person's words (cleaned like a declared name: hidden and control characters
 * blanked, runs of space collapsed, a blank reason is no reason; NO length cap). Returns the canonical list in the bound order, which is what is stored, or { ok: false, code, message }. Nothing is repaired.
 */
function excerptAnswersParse(answers, bound) {
  const bad = message => ({ ok: false, code: 'bad_excerpt_answers', message });
  if (!Array.isArray(answers)) return bad('the answers must be a list with one answer for every excerpt of the gate');
  const byId = new Map();
  for (const a of answers) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return bad('every answer must be an object');
    if (Object.keys(a).some(k => !['id', 'decision', 'lines', 'hide', 'reason'].includes(k))) return bad('an answer may carry only id, decision, lines, hide and reason');
    if (typeof a.id !== 'string' || !bound.some(b => b.id === a.id)) return bad(`${JSON.stringify(a.id)} is not one of the excerpts of this gate`);
    if (byId.has(a.id)) return bad(`${a.id} is answered more than once`);
    byId.set(a.id, a);
  }
  const clean = [];
  for (const b of bound) {
    const a = byId.get(b.id);
    if (!a) return bad(`${b.id} has no answer: every excerpt of the gate needs one`);
    if (!EXCERPT_ANSWER_DECISIONS.includes(a.decision)) return bad(`${b.id}: the decision must be one of ${EXCERPT_ANSWER_DECISIONS.join(', ')}`);
    const out = { id: b.id, decision: a.decision };
    const hasReason = a.reason !== undefined && a.reason !== null;
    if (a.decision === 'approve') {
      if (a.lines !== undefined || a.hide !== undefined || hasReason) return bad(`${b.id}: an approval carries nothing else`);
    } else if (a.decision === 'refuse') {
      if (a.lines !== undefined || a.hide !== undefined) return bad(`${b.id}: a refusal carries no range and no hidden lines`);
      if (hasReason && typeof a.reason !== 'string') return bad(`${b.id}: the reason must be text`);
      out.reason = cleanDeclared(hasReason ? a.reason : null, Infinity);
    } else {
      if (hasReason) return bad(`${b.id}: only a refusal carries a reason`);
      let keep = [1, b.shown_lines];
      if (a.lines !== undefined) {
        const m = typeof a.lines === 'string' ? EXCERPT_LINES.exec(a.lines) : null;
        if (!m || Number(m[1]) > Number(m[2]) || Number(m[2]) > b.shown_lines) return bad(`${b.id}: lines must be a-b inside the ${b.shown_lines} line(s) the screen showed`);
        keep = [Number(m[1]), Number(m[2])];
        out.lines = a.lines;
      }
      let hidden = 0;
      if (a.hide !== undefined) {
        if (!Array.isArray(a.hide) || !a.hide.length) return bad(`${b.id}: hide must be a list of line numbers`);
        let prev = 0;
        for (const n of a.hide) {
          if (!Number.isInteger(n) || n <= prev || n < keep[0] || n > keep[1]) return bad(`${b.id}: hide must list ascending line numbers inside the kept lines (${keep[0]}-${keep[1]})`);
          prev = n;
        }
        if (a.hide.length === keep[1] - keep[0] + 1) return bad(`${b.id}: an edit that hides every line is a refusal`);
        out.hide = a.hide.slice();
        hidden = a.hide.length;
      }
      if (keep[0] === 1 && keep[1] === b.shown_lines && !hidden) return bad(`${b.id}: an edit that keeps every line and hides none is an approval`);
    }
    clean.push(out);
  }
  return { ok: true, answers: clean };
}
function excerptAnswersStoredProblem(stored, bound) {
  const parsed = excerptAnswersParse(stored, bound);
  return !parsed.ok || JSON.stringify(parsed.answers) !== JSON.stringify(stored) ? 'excerpt_answers_inconsistent' : null;
}

const refuse = (code, message) => ({ ok: false, code, message });
const gatePath = (runDir, id) => join(runDir, GATES_DIR, `${id}.json`);

// Temp file in the same directory, fsync, rename, then sync the directory (plan section 4, "Atomic").
function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  let dfd;
  try { dfd = openSync(join(path, '..'), 'r'); fsyncSync(dfd); } catch { /* a directory fsync is unsupported on some platforms; the rename is already done */ } finally { if (dfd !== undefined) closeSync(dfd); }
}

const inside = (root, p) => { const r = relative(root, p); return !!r && !r.startsWith('..') && !isAbsolute(r); };

// The text must live inside the run folder (DR-15: an advice brief is `runs/<id>/advice-brief.md`), so a
// gate can never point `gate show` at a file elsewhere on the disk: checked by path AND after following
// links (a link inside the run folder to a file outside it is refused). Stored relative, "/"-separated.
function textInside(runDir, textPath) {
  if (typeof textPath !== 'string' || !textPath) return null;
  const abs = resolve(runDir, textPath);
  if (!inside(resolve(runDir), abs)) return null;
  return { abs, rel: relative(resolve(runDir), abs).split(sep).join('/') };
}

// The bytes of a gate's text, or null when it cannot be read or resolves (through links) outside the run
// folder. Every read of a gate's text goes through here, so a forged `text` in a gate file or a ledger line
// ("../x", a link) reads as unreadable, never as a file elsewhere.
export function readGateText(runDir, rel) {
  const where = textInside(runDir, rel);
  if (!where) return null;
  try {
    if (!inside(realpathSync(runDir), realpathSync(where.abs))) return null;
    return readFileSync(where.abs);
  } catch { return null; }
}

const isStr = v => typeof v === 'string' && v.length <= FIELD_MAX;
const isMoney = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// The shapes the person is shown. Refused, not repaired: a price of '5' would otherwise print as "unpriced".
function metaProblem({ price, seats, sensitivity, masks, follow_up }) {
  if (price !== null && !(price && typeof price === 'object' && !Array.isArray(price) && isMoney(price.ceiling_usd)
    && (price.expected_usd === undefined || isMoney(price.expected_usd)) && Object.keys(price).every(k => ['ceiling_usd', 'expected_usd'].includes(k)))) {
    return ['bad_price', 'price must be null or { ceiling_usd: number >= 0, expected_usd?: number >= 0 }'];
  }
  if (!Array.isArray(seats) || seats.length > SEATS_MAX || !seats.every(s => s && typeof s === 'object' && !Array.isArray(s) && Object.values(s).every(v => v === null || isStr(v)))) {
    return ['bad_seats', `seats must be an array of at most ${SEATS_MAX} objects whose values are strings of at most ${FIELD_MAX} characters`];
  }
  if (sensitivity !== null && !(sensitivity && typeof sensitivity === 'object' && !Array.isArray(sensitivity) && isStr(sensitivity.label) && isStr(sensitivity.set_by) && Object.keys(sensitivity).length === 2)) {
    return ['bad_sensitivity', 'sensitivity must be null or { label: string, set_by: string }'];
  }
  if (!masks || typeof masks !== 'object' || Array.isArray(masks) || !Object.entries(masks).every(([k, n]) => MASK_KEY.test(k) && Number.isInteger(n) && n >= 0)) {
    return ['bad_masks', 'masks must map short lowercase names to whole numbers >= 0'];
  }
  if (follow_up !== undefined && !(isStr(follow_up) && follow_up.length > 0)) return ['bad_follow_up', `follow_up must be absent or a line of at most ${FIELD_MAX} characters`];
  return null;
}

// Ledger trouble becomes a refusal with its code; any other file error is `io_error`, never a stack trace.
function refusalFor(err) {
  if (err instanceof LedgerBusyError || err instanceof LedgerCorruptError || err instanceof LedgerWriteError) return refuse(err.code, err.message);
  return refuse('io_error', `a gate file could not be read or written (${err.code ?? err.message})`);
}

// 0.8.4 D5a (plan A T4.3; Mini-C&C R357: the record route is a gate kind the session answers, as tree_decide does): the `stop_decision` gate. The session asks for it (requestedBy 'session') with the quote of a ROUND stop as its
// text and the stop's id bound in its metadata; it answers it on the session channel with the choice (continue | finish), its written reason (the gate's `reason`) and the advisor state it states (`stop_answer`, in the
// `gate_answered` line). The CLI reads the answered gate at the entry site of `--continue` / `--finish` (stopDecisionAnswerOf) and records who chose, how, when and why in the choice entry. The gate is not spent: it is bound to the
// stop id and the choice, and it is read for ten minutes after its answer (GATE_TTL_MS). Only the session answers this kind: a round stop is the session's to decide (T4.1 cases C and D); the person's stops are other kinds.
export const STOP_DECISION_KIND = 'stop_decision';
export const STOP_CHOICES = Object.freeze(['continue', 'finish']);
/** 0.8.4 (finish at once): the one choice the session gives ONLY on the person's own words (`person_words`), never on its own authority: it ends a stopped run at once, with no final read and no judge asked again. Recorded as the person's (actor person, channel session), never as a choice typed at a terminal. */
export const RELAYED_STOP_CHOICE = 'finish_now';
/** 0.8.4 (C&C 10 Nov, typed = relayed): at EVERY stop the session may relay the person's own choice, continue, finish or finish_now, with the person's words; at a stop that is the person's alone (src/overseer-rounds.js isPersonStop) it gives no answer of its own. */
/** 0.8.4 (C&C 10 Nov, A-DRAFT LAD-P1): the one sentence that refuses the session's own answer or deferral at a stop that is the person's alone, and names the way the session can help: relaying. */
/** 0.8.4 (ladder unit, A-DRAFT LAD-O2): a relayed continue at the owner pause: the pause is continued by resuming the run, which records no choice. */
export const PAUSE_CONTINUE_REFUSAL = 'This run is paused on request: it is continued by resuming it (resume_run), which is not a choice. Give finish or finish_now with the person\'s words to end it here. Nothing was recorded.';
/** WORDING LAD-R1 (A-DRAFT): a relayed continue at a spending stop. A raise is the person's typed limit, not a choice of this tool. */
export const BUDGET_CONTINUE_REFUSAL = 'This run is stopped at its spending limit: going on means raising the limit, which is the person\'s own number, not a choice of this tool. To raise it, call resume_run with the person\'s limit and their words (the relayed raise), or the person raises it at a terminal. To end the run here instead, give finish_now (or finish where it is offered) with the person\'s words. A continue is taken only to go on past a finish the person gave earlier. Nothing was recorded.';   // A-DRAFT (LAD-R35)
export const PERSON_ONLY_STOP_REFUSAL = "This stop is the person's alone: the session gives no answer of its own here. Ask the person, and relay their own choice, continue, finish or finish_now, with their words in person_words. Nothing was recorded.";
/** The stop of the run's partial report (report-partial.json), or null: what a stop_decision gate's checks are made against, read when the answer arrives. */
const partialStopOf = runDir => { try { const stop = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop; return stop && typeof stop === 'object' ? stop : null; } catch { return null; } };
export const RELAYED_STOP_CHOICES = Object.freeze(['continue', 'finish', 'finish_now']);
export const STOP_ADVISOR_STATES = Object.freeze(['consulted', 'none', 'unavailable']);
const STOP_ID_SHAPE = /^((overseer_cap|layer_bound|stall_stop|owner_pause):\d{1,6}:\d{1,6}(:final_read\d{1,4})?|budget_stop:\d{1,6}:\d{1,6}:[A-Za-z0-9_][A-Za-z0-9._-]{0,199}(:[0-9a-f]{12})?|secret_pause:[0-9a-f]{16})$/;   // the three round-stop kinds and the owner pause (src/overseer-rounds.js stopIdOf; stall_stop since 0.8.4 S5, and its overseer round may be 0 on a chain with no overseer rounds): the id reaches an agent, so it is never free text
const stopMetaProblem = stop => (stop && typeof stop === 'object' && !Array.isArray(stop) && (Object.keys(stop).join() === 'id' || (Object.keys(stop).sort().join() === 'id,person_only' && stop.person_only === true)) && typeof stop.id === 'string' && STOP_ID_SHAPE.test(stop.id) ? null   // 0.8.4 (C&C 10 Nov): `person_only: true` marks the gate of a stop only the person's own words decide; it sits inside the hashed meta
  : ['bad_stop', 'a stop_decision gate needs stop = { id } with the stop id (overseer_cap, layer_bound, stall_stop, owner_pause or budget_stop, then the overseer round and the pass, joined by colons; a budget_stop also names the stage and the hash of its stop file)']);   // A-DRAFT
// 0.8.4 D4 (plan A T4.1, T4.2; STEP3 F6): the PERSON TEST. Before it answers or defers, the session writes its own verdict on "is this stop the person's" and asks its advisor the same question; both are recorded, in one shape:
// { person: yes | no, unsettled_by_record: boolean, preference: boolean, reason }. THC records both and does not judge either (A-plan: "THC records both parts and checks neither"); it checks the SHAPE, and that an advisor
// part is the filler where there is no advisor: advisor none -> person no, both booleans false, reason 'no advisor'; advisor unavailable (F6) -> the same with reason 'advisor unavailable'.
const PERSON_TEST_REASON_MAX = 400;
const PERSON_TEST_FILLER = Object.freeze({ none: 'no advisor', unavailable: 'advisor unavailable' });
const verdictProblem = (v, who) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== 'person,preference,reason,unsettled_by_record') return `person_test.${who} must be { person, unsettled_by_record, preference, reason }`;   // A-DRAFT
  if (v.person !== 'yes' && v.person !== 'no') return `person_test.${who}.person must be yes or no`;   // A-DRAFT
  if (typeof v.unsettled_by_record !== 'boolean' || typeof v.preference !== 'boolean') return `person_test.${who}: unsettled_by_record and preference must be true or false`;   // A-DRAFT
  if (typeof v.reason !== 'string' || !v.reason.trim() || [...v.reason].length > PERSON_TEST_REASON_MAX) return `person_test.${who}.reason must be a sentence or two (at most ${PERSON_TEST_REASON_MAX} characters)`;   // A-DRAFT
  return null;
};
/** -> null | why the person_test does not hold (for the advisor state given). Exported for the tool, which refuses with the same sentence before it asks the gate. */
export function personTestProblem(pt, advisor) {
  if (!pt || typeof pt !== 'object' || Array.isArray(pt) || Object.keys(pt).sort().join() !== 'advisor,session') return 'person_test must be { session, advisor }';   // A-DRAFT
  const bad = verdictProblem(pt.session, 'session') ?? verdictProblem(pt.advisor, 'advisor');
  if (bad) return bad;
  const filler = PERSON_TEST_FILLER[advisor];
  if (filler && (pt.advisor.person !== 'no' || pt.advisor.unsettled_by_record !== false || pt.advisor.preference !== false || pt.advisor.reason.trim() !== filler)) return `with advisor ${advisor} the advisor part is person no, unsettled_by_record false, preference false and reason '${filler}'`;   // A-DRAFT
  return null;
}
/** Both the session and a consulted advisor say the stop is the person's: the session may not decide it (A-plan T4.1). */
export const personTestBothYes = pt => pt?.session?.person === 'yes' && pt?.advisor?.person === 'yes';
/** True when an advisor answered and the two verdicts' `person` values differ (false with no advisor): computed here, never taken from the caller (T4.2). */
const overDisagreement = (pt, advisor) => advisor === 'consulted' && pt.session.person !== pt.advisor.person;
// -> { ok: true, answer } | { ok: false, message }: the session's answer in its one canonical shape (choice, advisor, advisor_said, person_test, over_disagreement); advisor_said is the advisor's words and only for an advisor that answered.
function stopAnswerParse(a, secret = false) {   // `secret`: the gate is the one of a found-secret pause, where a relayed answer may also be a drop (0.8.4, Q9)
  const relayedChoices = secret ? [...RELAYED_STOP_CHOICES, 'drop'] : RELAYED_STOP_CHOICES;
  const bad = message => ({ ok: false, message });   // A-DRAFT: the messages below reach an agent through the tool's error
  if (a && typeof a === 'object' && !Array.isArray(a) && a.rounds !== undefined && a.relayed !== true) return bad("rounds is the person's own limit: only a relayed continue carries it");   // A-DRAFT (0.8.4, C&C 10 Nov): the session's own answer carries no number
  if (a && typeof a === 'object' && !Array.isArray(a) && (a.relayed !== undefined || a.choice === RELAYED_STOP_CHOICE || (secret && a.choice === 'drop'))) {   // 0.8.4 (finish at once): the relayed answer is exactly { choice, relayed }; the person's words travel beside it, never inside it
    const withRounds = a.rounds !== undefined;   // 0.8.4 (C&C 10 Nov, typed = relayed): a continue may carry the person's new limit, the total of top-layer reads (a ladder run), as a typed --rounds N does
    if (Object.keys(a).sort().join() !== (withRounds ? 'choice,relayed,rounds' : 'choice,relayed') || a.relayed !== true || !relayedChoices.includes(a.choice) || (withRounds && (a.choice !== 'continue' || !Number.isSafeInteger(a.rounds) || a.rounds < 1))) return bad(`a relayed answer is exactly { choice: ${relayedChoices.map(c => `"${c}"`).join(' | ')}, relayed: true }, with rounds (a whole number) only on a continue`);   // A-DRAFT
    return { ok: true, answer: { choice: a.choice, relayed: true, ...(withRounds ? { rounds: a.rounds } : {}) } };
  }
  const keys = a && typeof a === 'object' && !Array.isArray(a) ? Object.keys(a).sort().join() : '';
  if (keys !== 'advisor,advisor_said,choice,person_test' && keys !== 'advisor,advisor_said,choice,over_disagreement,person_test') return bad('the answer must be { choice, advisor, advisor_said, person_test }');
  if (!STOP_CHOICES.includes(a.choice)) return bad(`choice must be one of ${STOP_CHOICES.join(', ')}`);
  if (!STOP_ADVISOR_STATES.includes(a.advisor)) return bad(`advisor must be one of ${STOP_ADVISOR_STATES.join(', ')}`);
  if (typeof a.advisor_said !== 'string' || (a.advisor === 'consulted') !== (a.advisor_said.trim() !== '')) return bad('advisor_said is the advisor\'s words: required with advisor consulted, empty otherwise');
  const why = personTestProblem(a.person_test, a.advisor);
  if (why) return bad(why);
  if (personTestBothYes(a.person_test)) return bad('the session and its advisor both say this stop is the person\'s: hand it to the person with step defer');   // A-DRAFT
  const over = overDisagreement(a.person_test, a.advisor);
  if (Object.hasOwn(a, 'over_disagreement') && a.over_disagreement !== over) return bad('over_disagreement is computed, not given');
  return { ok: true, answer: { choice: a.choice, advisor: a.advisor, advisor_said: a.advisor_said.trim(), person_test: a.person_test, over_disagreement: over } };
}
const stopAnswerStoredProblem = (stored, secret = false) => { const p = stopAnswerParse(stored, secret); return !p.ok || JSON.stringify(p.answer) !== JSON.stringify(stored) ? 'stop_answer_inconsistent' : null; };
// A deferral (the session declines its own gate): the advisor state, what the advisor said and the person test are recorded with it, and BOTH parts say the stop is the person's (A6). -> { ok, defer } | { ok: false, message }
function stopDeferParse(d, personOnly = false) {   // 0.8.4 (C&C 10 Nov): at a stop only the person decides (gate meta person_only) the session can always leave it waiting, with or without an advisor and whatever the person test says: the stop is the person's by rule, not by test
  const bad = message => ({ ok: false, message });   // A-DRAFT
  if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).sort().join() !== 'advisor,advisor_said,person_test') return bad('a deferral must be { advisor, advisor_said, person_test }');
  if (personOnly ? !STOP_ADVISOR_STATES.includes(d.advisor) : d.advisor !== 'consulted') return bad(personOnly ? `advisor must be one of ${STOP_ADVISOR_STATES.join(', ')}` : 'a stop is handed to the person only when the session and its advisor both say it is the person\'s, so the advisor must have answered (advisor consulted)');
  if (typeof d.advisor_said !== 'string' || (d.advisor === 'consulted' && !d.advisor_said.trim())) return bad('advisor_said is missing: write what your advisor said, in its words');
  const why = personTestProblem(d.person_test, d.advisor);
  if (why) return bad(why);
  if (!personOnly && !personTestBothYes(d.person_test)) return bad('a stop is handed to the person only when the session and its advisor both say it is the person\'s');
  return { ok: true, defer: { advisor: d.advisor, advisor_said: d.advisor_said.trim(), person_test: d.person_test } };
}
const stopDeferStoredProblem = (stored, personOnly = false) => { const p = stopDeferParse(stored, personOnly); return !p.ok || JSON.stringify(p.defer) !== JSON.stringify(stored) ? 'stop_defer_inconsistent' : null; };

// 0.8.4 T2.3 / D2 (C&C 09 Nov 2026): the ACCEPTANCE of a plan a run ended without agreement on (src/acceptance.js). A `kind: acceptance` gate's text is the question the acceptor reads (the plan's sha and the open objections, hashed with it). A person approves it at the terminal
// (channel cli) with a written reason, nothing more. The SESSION approves it only with this answer: its advisor state, what the advisor said, and the person test (T4.1) run ONCE FOR EACH open objection, in the same shape as a stop's; one yes
// on an objection is recorded (over_disagreement lists those ids), both-yes on any objection refuses the session (T4.1 as built: both parts say it is the person's). Which ids must be listed is the tool's check against the report; here the shape and the canonical form.
export const ACCEPTANCE_KIND = 'acceptance';
const ACCEPTANCE_OBJECTION_ID = /^[OL]-\w+(?:#r?\d+)?$/;
function acceptanceAnswerParse(a) {
  const bad = message => ({ ok: false, message });   // A-DRAFT: the messages below reach an agent through the tool's error
  if (a && typeof a === 'object' && !Array.isArray(a) && a.relayed !== undefined) return a.relayed === true && Object.keys(a).join() === 'relayed' ? { ok: true, answer: { relayed: true } } : bad('a relayed acceptance is exactly { relayed: true }');   // 0.8.4 (relayed accept): the person's own acceptance, carried by the session with the person's words beside it
  const keys = a && typeof a === 'object' && !Array.isArray(a) ? Object.keys(a).sort().join() : '';
  if (keys !== 'advisor,advisor_said,objections' && keys !== 'advisor,advisor_said,objections,over_disagreement') return bad('the answer must be { advisor, advisor_said, objections: [{ id, person_test }] }');
  if (!STOP_ADVISOR_STATES.includes(a.advisor)) return bad(`advisor must be one of ${STOP_ADVISOR_STATES.join(', ')}`);
  if (typeof a.advisor_said !== 'string' || (a.advisor === 'consulted') !== (a.advisor_said.trim() !== '')) return bad('advisor_said is the advisor\'s words: required with advisor consulted, empty otherwise');
  if (!Array.isArray(a.objections)) return bad('objections must be a list with one { id, person_test } for each open objection and late finding');
  const seen = new Set(); const objections = []; const over = [];
  for (const o of a.objections) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join() !== 'id,person_test') return bad('each objection must be { id, person_test }');
    if (typeof o.id !== 'string' || !ACCEPTANCE_OBJECTION_ID.test(o.id)) return bad(`${typeof o.id === 'string' ? o.id.slice(0, 40) : 'an objection'}: not an objection id`);
    if (seen.has(o.id)) return bad(`${o.id} is listed twice`);
    seen.add(o.id);
    const why = personTestProblem(o.person_test, a.advisor);
    if (why) return bad(`${o.id}: ${why}`);
    if (personTestBothYes(o.person_test)) return bad(`${o.id}: the session and its advisor both say this objection is the person's, so accepting the plan is the person's: ask the person`);   // A-DRAFT
    if (overDisagreement(o.person_test, a.advisor)) over.push(o.id);
    objections.push({ id: o.id, person_test: o.person_test });
  }
  if (Object.hasOwn(a, 'over_disagreement') && JSON.stringify(a.over_disagreement) !== JSON.stringify(over)) return bad('over_disagreement is computed, not given');
  return { ok: true, answer: { advisor: a.advisor, advisor_said: a.advisor_said.trim(), objections, over_disagreement: over } };
}
const acceptanceAnswerStoredProblem = stored => { const p = acceptanceAnswerParse(stored); return !p.ok || JSON.stringify(p.answer) !== JSON.stringify(stored) ? 'acceptance_answer_inconsistent' : null; };

/**
 * Records a pending gate for a text file in the run folder: one `gate_requested` ledger line, then the gate
 * file. The hash is computed here from the file's bytes, never taken from the caller.
 */
export function requestGate(runDir, { kind, textPath, price = null, seats = [], sensitivity = null, masks = {}, follow_up, cap, excerpts, stop, expiresAt, requestedBy } = {}, { now = () => Date.now() } = {}) {
  if (requestedBy !== undefined && requestedBy !== 'session') return refuse('bad_requester', 'a gate is requested by the session or, when nothing is said, by a person');
  if (typeof kind !== 'string' || !KIND.test(kind)) return refuse('bad_kind', 'the gate kind must be a short lowercase name');
  const where = textInside(runDir, textPath);
  if (!where) return refuse('text_outside_run', 'the gate text must be a file inside the run folder');
  let meta;
  try { meta = asWritten({ price, seats, sensitivity, masks, follow_up, cap, excerpts, stop }); }
  catch (e) { return e instanceof NonFiniteError ? refuse('bad_number', `${e.message}; every amount and count in a gate must be an ordinary number`) : refuse('bad_price', 'the price, seats, sensitivity and masks must be plain JSON data'); }
  const problem = metaProblem(meta) ?? (kind === RUN_CAP_KIND ? capProblem(meta.cap) : (meta.cap !== undefined ? ['bad_cap', 'only a run_cap gate takes cap'] : null))
    ?? (kind === EXCERPT_APPROVAL_KIND ? excerptsProblem(meta.excerpts) : (meta.excerpts !== undefined ? ['bad_excerpts', 'only an excerpt_approval gate takes excerpts'] : null))
    ?? (kind === STOP_DECISION_KIND ? stopMetaProblem(meta.stop) : (meta.stop !== undefined ? ['bad_stop', 'only a stop_decision gate takes stop'] : null));
  if (problem) return refuse(...problem);
  const bytes = readGateText(runDir, where.rel);
  if (!bytes) return refuse('text_unreadable', `cannot read ${where.rel} inside the run folder (missing, or a link to a file outside it)`);
  const t = now();
  const expires = expiresAt === undefined ? t + GATE_TTL_MS : Number(expiresAt);
  if (!Number.isFinite(expires) || expires <= t) return refuse('bad_expiry', 'the gate must expire in the future');
  try {
    mkdirSync(join(runDir, GATES_DIR), { recursive: true });
    return withLedger(runDir, ({ lines, append }) => {
      const id = `g${lines.filter(l => l.event === 'gate_requested').length + 1}`;
      const record = {
        schema: GATE_SCHEMA, id, kind, status: 'pending', text: where.rel, sha256: textSha256(bytes), bytes: bytes.length,
        ...meta, meta_sha256: metaSha256(meta), requested_at: new Date(t).toISOString(), expires_at: new Date(expires).toISOString(), answer: null,
      };
      // REQUESTER MARK (6d, 19 Okt): only a gate the SESSION asked for may be answered by the session; absent = a person's (every older line). On the hash-chained ledger line, not in the view file.
      const line = append('gate_requested', { gate: id, kind, text: record.text, sha256: record.sha256, bytes: record.bytes, meta_sha256: record.meta_sha256, expires_at: record.expires_at, ...(requestedBy === 'session' ? { requested_by: 'session' } : {}) });
      record.seq = line.seq;
      // If this write fails the gate is in the ledger without a view: it reads `invalid`
      // (gate_record_unreadable) and cannot be answered, and a new gate can be requested.
      writeAtomic(gatePath(runDir, id), `${JSON.stringify(record, null, 2)}\n`);
      return { ok: true, gate: record };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

function readRecord(runDir, id) {
  try {
    const r = JSON.parse(readFileSync(gatePath(runDir, id), 'utf8'));
    return r && typeof r === 'object' && r.schema === GATE_SCHEMA && r.id === id ? r : null;
  } catch { return null; }
}

// The gate's state from a verified ledger's lines plus its file. Shared by the reader and the writer so
// the two can never disagree about what "pending" means.
// metaSha256 refuses a non-finite number, and a gate file edited to hold 1e999 PARSES as Infinity: that reads as a changed record, never as a crash (a throw here would leave the reader without an answer).
const metaHashOrNull = rec => { try { return metaSha256(rec); } catch (e) { if (e instanceof NonFiniteError) return null; throw e; } };
function stateOf(runDir, id, lines, t) {
  const requested = lines.find(l => l.event === 'gate_requested' && l.gate === id);
  if (!requested) return { status: 'invalid', reason: 'gate_not_found' };
  const record = readRecord(runDir, id);
  if (!record) return { status: 'invalid', reason: 'gate_record_unreadable' };
  const mismatch = { status: 'invalid', reason: 'gate_record_mismatch' };
  if (record.sha256 !== requested.sha256 || record.text !== requested.text || record.expires_at !== requested.expires_at
    || record.kind !== requested.kind || record.seq !== requested.seq) return mismatch;
  // What the person is told (price, seats, sensitivity, masks, follow_up) is bound to the ledger too.
  if (record.meta_sha256 !== requested.meta_sha256 || metaHashOrNull(record) !== requested.meta_sha256) return mismatch;
  // 0.8.3 M6 T3: a run_cap gate carries its pending decision (`cap`) in the bound metadata; any other kind carries none.
  const isCap = requested.kind === RUN_CAP_KIND;
  if (isCap ? capProblem(record.cap) : record.cap !== undefined) return mismatch;
  // 0.8.4 D10 slice 2a: an excerpt_approval gate carries the list its answer is checked against; any other kind carries none.
  const isEx = requested.kind === EXCERPT_APPROVAL_KIND;
  if (isEx ? excerptsProblem(record.excerpts) : record.excerpts !== undefined) return mismatch;
  // 0.8.4 D5a: a stop_decision gate carries the stop id it is about; any other kind carries none.
  const isSd = requested.kind === STOP_DECISION_KIND;
  const isAcc = requested.kind === ACCEPTANCE_KIND;
  if (isSd ? stopMetaProblem(record.stop) : record.stop !== undefined) return mismatch;
  const answered = lines.find(l => l.event === 'gate_answered' && l.gate === id);
  if (!answered) {
    // A file that claims an answer the ledger does not hold was edited by hand: trust neither.
    if (record.status !== 'pending' || record.answer !== null) return mismatch;
    if (t >= Date.parse(record.expires_at)) return { status: 'expired', gate: record };
    return { status: 'pending', gate: record };
  }
  if (!DECISIONS.includes(answered.decision) || answered.sha256 !== requested.sha256 || answered.meta_sha256 !== requested.meta_sha256
    || !answeredOnAllowedChannel(answered.channel, requested.kind, record)
    || (answered.channel === SESSION_CHANNEL && requested.requested_by !== 'session')) return mismatch;
  // The typed amount: present, consistent and inside the bound ceiling on an approved run_cap answer; on no other answer. (A consistent edit of BOTH fields on the LAST ledger line is not detected: the chain cannot see it, decided rule 9.)
  if (isCap && answered.decision === 'approved' ? capAnswerProblem(answered, record.cap) : (Object.hasOwn(answered, 'cap_usd') || Object.hasOwn(answered, 'cap_micro_usd'))) return mismatch;
  // The per-excerpt answers: present, canonical and consistent with the bound list on an approved excerpt_approval answer; on no other answer. A declined one means refuse-all and carries none.
  if (isEx && answered.decision === 'approved' ? excerptAnswersStoredProblem(answered.excerpt_answers, record.excerpts) : Object.hasOwn(answered, 'excerpt_answers')) return mismatch;
  // The session's answer to a round stop: present, canonical and consistent on an approved stop_decision answer; on no other answer.
  if (isSd && answered.decision === 'approved' ? stopAnswerStoredProblem(answered.stop_answer, record.stop?.id?.startsWith('secret_pause:') === true) : Object.hasOwn(answered, 'stop_answer')) return mismatch;
  // The session's deferral: present and canonical on a stop_decision gate the SESSION declined; on no other answer.
  if (isSd && answered.decision === 'declined' && answered.channel === SESSION_CHANNEL ? stopDeferStoredProblem(answered.stop_defer, record.stop?.person_only === true) : Object.hasOwn(answered, 'stop_defer')) return mismatch;
  // 0.8.4 D2: the session's answer to an acceptance: present, canonical and consistent on an approved acceptance answer given on the session channel; on no other answer.
  if (isAcc && answered.decision === 'approved' && answered.channel === SESSION_CHANNEL ? acceptanceAnswerStoredProblem(answered.acceptance_answer) : Object.hasOwn(answered, 'acceptance_answer')) return mismatch;
  // The view either lags the ledger (a crash before it was rewritten: still pending, no answer) or agrees
  // with it exactly. Anything else is an edit of one of the two (M3 review M1: an edited last line).
  const lagging = record.status === 'pending' && record.answer === null;
  const agrees = record.status === answered.decision && record.answer && record.answer.decision === answered.decision
    && record.answer.seq === answered.seq && record.answer.channel === answered.channel
    && (!isCap || answered.decision !== 'approved' || (record.answer.cap_usd === answered.cap_usd && record.answer.cap_micro_usd === answered.cap_micro_usd))
    && (!isEx || answered.decision !== 'approved' || JSON.stringify(record.answer.excerpt_answers) === JSON.stringify(answered.excerpt_answers))
    && (!isSd || answered.decision !== 'approved' || JSON.stringify(record.answer.stop_answer) === JSON.stringify(answered.stop_answer))
    && (!isSd || answered.decision !== 'declined' || JSON.stringify(record.answer.stop_defer) === JSON.stringify(answered.stop_defer))
    && (!isAcc || answered.decision !== 'approved' || JSON.stringify(record.answer.acceptance_answer) === JSON.stringify(answered.acceptance_answer));
  if (!lagging && !agrees) return mismatch;
  return { status: answered.decision, gate: record, answer: answered };
}

/**
 * Where a gate stands. `approved` only when a verified ledger holds a person's approval of the recorded
 * hash and the text file still hashes to it; then `usable` says whether a run may still start on it. Never
 * writes.
 */
export function readGateAnswer(runDir, gateId, { now = () => Date.now() } = {}) {
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return { status: 'invalid', reason: 'gate_not_found' };
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { status: 'invalid', reason: 'gate_ledger_corrupt' };
  const t = now();
  const state = stateOf(runDir, gateId, ledger.lines, t);
  if (state.status === 'approved') {
    const bytes = readGateText(runDir, state.gate.text);
    if (!bytes || textSha256(bytes) !== state.gate.sha256) return { status: 'invalid', reason: 'hash_mismatch', gate: state.gate };
    const used = ledger.lines.some(l => USE_EVENTS.includes(l.event) && l.gate === gateId);
    return { ...state, used, usable_until: state.gate.expires_at, usable: !used && t < Date.parse(state.gate.expires_at) };
  }
  return state;
}

/**
 * Every ACCEPTANCE the ledger holds for this run (0.8.4 D2): { ok, accepted: [{ gate, sha256, text, requested_by, channel, actor, at, reason, acceptance_answer? }] oldest first, pending: [{ gate, sha256, requested_by }], unreadable: [{ gate, reason }] }.
 * An approval does not lapse (like a ruling). An approved gate counts only when the ledger verifies, the gate file agrees with it and its text still hashes to the recorded value (readGateAnswer). A ledger that does not read gives ok false;
 * a gate that does not verify is listed, never dropped. Never writes.
 */
export function acceptancesOf(runDir, { now = () => Date.now() } = {}) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { ok: false, accepted: [], pending: [], unreadable: [{ gate: null, reason: 'gate_ledger_corrupt' }] };
  const out = { ok: true, accepted: [], pending: [], unreadable: [] };
  for (const l of ledger.lines.filter(x => x.event === 'gate_requested' && x.kind === ACCEPTANCE_KIND)) {
    const st = readGateAnswer(runDir, l.gate, { now });
    if (st.status === 'approved') out.accepted.push({ gate: l.gate, sha256: st.gate.sha256, text: st.gate.text, requested_by: l.requested_by ?? 'person', channel: st.answer.channel, actor: st.answer.actor ?? null, at: st.answer.ts, reason: st.answer.reason ?? null, ...(st.answer.acceptance_answer ? { acceptance_answer: st.answer.acceptance_answer } : {}), ...(typeof st.answer.person_words === 'string' ? { person_words: st.answer.person_words } : {}) });
    else if (st.status === 'pending') out.pending.push({ gate: l.gate, sha256: l.sha256, requested_by: l.requested_by ?? 'person' });
    else if (st.status === 'invalid') out.unreadable.push({ gate: l.gate, reason: st.reason });
  }
  return out;
}

/** Every gate the ledger names, with its status. Never writes. */
export function listGates(runDir, { now = () => Date.now() } = {}) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return null;
  return ledger.lines.filter(l => l.event === 'gate_requested').map(l => {
    const s = readGateAnswer(runDir, l.gate, { now });
    return { id: l.gate, status: s.status, ...(s.reason ? { reason: s.reason } : {}) };
  });
}

/**
 * The gates of ONE kind in the run's ledger: [{ gate, status }] (status as readGateAnswer says: pending, approved, declined, expired or invalid), oldest first; [] when there are none or the ledger cannot be read. It reads nothing of a gate's text. A resume uses it to NAME a gate of a kind
 * that no longer exists (the re-tag kind, removed at M1 S19 (c): a re-tag is the handler session's own act now, src/handler-retags.js), so that such a gate is never dropped silently.
 */
export function gatesOfKind(runDir, kind, { now = () => Date.now() } = {}) {
  const listed = listGates(runDir, { now });
  if (listed === null) return [];
  const asked = readLedger(runDir).lines.filter(l => l.event === 'gate_requested');
  return listed.filter(g => (asked.find(l => l.gate === g.id)?.kind ?? readGateAnswer(runDir, g.id, { now }).gate?.kind) === kind).map(g => ({ gate: g.id, status: g.status }));
}

/**
 * The only way a gate is answered. Refuses, appending nothing: channel_not_person, bad_decision,
 * gate_not_found, gate_ledger_corrupt, gate_busy, gate_record_unreadable, gate_record_mismatch,
 * gate_not_pending, gate_expired, hash_mismatch, io_error. An approval needs the text's bytes now, the
 * recorded hash and the hash the person was shown to agree; a decline needs only the shown hash to be the
 * recorded one (nothing is sent, and a person can always say no: decided rule 10). On success: one
 * `gate_answered` line, then the gate file rewritten; if that rewrite fails the answer stands (the ledger
 * holds it) and the result carries a `warning`.
 */
export function answerGate(runDir, gateId, { channel, shownSha256, decision, actor = null, reason = null, tty = null, typedCap, client = null, personWords, excerptAnswers, stopAnswer, stopDefer, acceptanceAnswer } = {}, { now = () => Date.now() } = {}) {
  if (!PERSON_CHANNELS.includes(channel) && channel !== SESSION_CHANNEL) return refuse('channel_not_person', `a gate is answered only through a channel a person uses (${PERSON_CHANNELS.join(', ')}), not ${JSON.stringify(channel)}`);
  if (!DECISIONS.includes(decision)) return refuse('bad_decision', `the decision must be one of ${DECISIONS.join(', ')}`);
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const t = now();
      const state = stateOf(runDir, gateId, lines, t);
      if (state.status === 'invalid') {
        const messages = { gate_not_found: `no gate ${gateId} in this run`, gate_record_unreadable: `gates/${gateId}.json cannot be read`, gate_record_mismatch: `gates/${gateId}.json does not match the ledger` };
        return refuse(state.reason, messages[state.reason] ?? state.reason);
      }
      if (state.status === 'approved' || state.status === 'declined') return refuse('gate_not_pending', `gate ${gateId} was already answered (${state.status})`);
      if (state.status === 'expired') return refuse('gate_expired', `gate ${gateId} expired at ${state.gate.expires_at}`);
      const record = state.gate;
      if (channel === SESSION_CHANNEL) {
        if (relayedKind(record.kind, record)) {
          if ((decision === 'approved' || !isRelayAskKind(record.kind)) && (typeof personWords !== 'string' || !personWords.trim())) return refuse('person_words_required', `the session answers this gate only on the person's permission, with the person's own words as typed in the handler's window. None were given. Nothing was recorded.`);   // A-DRAFT
        } else if (!SESSION_ELIGIBLE_KINDS.includes(record.kind)) return refuse('channel_not_session_eligible', `a ${record.kind} gate is answered only by a person (${PERSON_CHANNELS.join(' or ')}): the session may answer ${SESSION_ELIGIBLE_KINDS.join(' and ')} gates only`);       // B-DRAFT
        { const own = sessionOwnerRefusal(lines, gateId); if (own) return own; }
        if (typeof reason !== 'string' || !reason.trim()) return refuse('session_reason_required', 'the session answers a gate with its written reason: none was given');       // B-DRAFT
      }
      if (personWords !== undefined && channel !== SESSION_CHANNEL) return refuse('person_words_not_asked', `gate ${gateId} takes the person's words only from the session that relays them; a person answers it himself. Nothing was recorded.`);   // A-DRAFT
      const shown = typeof shownSha256 === 'string' ? shownSha256.slice(0, 12) : 'none';
      if (shownSha256 !== record.sha256) return refuse('hash_mismatch', `the text shown (${shown}) is not the text of gate ${gateId} (${record.sha256.slice(0, 12)})`);
      if (decision === 'approved') {
        const bytes = readGateText(runDir, record.text);
        const nowSha = bytes ? textSha256(bytes) : null;
        if (nowSha !== record.sha256) return refuse('hash_mismatch', `the text of gate ${gateId} changed on disk since it was shown (recorded ${record.sha256.slice(0, 12)}, on disk ${nowSha ? nowSha.slice(0, 12) : 'missing'})`);
        // S20 slice 2 (Q1): a RULING is the person's own text. Relayed by the session, it is accepted only with the person's words and the ruling text IN them (src/rulings.js rulingTextInWords: whitespace runs collapsed on both sides, nothing else). A ruling gate whose stored text is not exactly
        // a ruling cannot be checked, so it is refused here too (fail closed): no caller gets past this line. Withdrawals and re-tags are program-built texts and are out of this rule. The words are recorded as typed, below.
        if (channel === SESSION_CHANNEL && record.kind === RULING_KIND && typeof personWords === 'string' && personWords.trim()) {
          const parsedRuling = parseRulingGateText(bytes);
          if (!parsedRuling) return refuse('gate_text_unreadable', `the text of this gate is not exactly a ruling, so it cannot be approved. Nothing was recorded.`);   // A-DRAFT
          if (!rulingTextInWords(personWords, parsedRuling.text)) return refuse('person_words_text', `the ruling text does not appear in the person's words as given (only line breaks and spaces may differ). Ask the person for an answer that includes the ruling text; never add it to their words yourself. Nothing was recorded.`);   // A-DRAFT
        }
      }
      // 0.8.4 D10 slice 2a: approving an excerpt_approval gate is a per-excerpt answer, checked here against the list bound in the gate (every id once, a decision each, an edit that changes something); never a bare yes.
      // Declining the gate stays allowed and means refuse-all. Any other kind takes no excerptAnswers.
      let excerptFields = {};
      if (record.kind === EXCERPT_APPROVAL_KIND && decision === 'approved') {
        if (excerptAnswers === undefined) return refuse('excerpt_answers_required', `gate ${gateId} asks for an answer to every excerpt: approving it means answering each one. Nothing was recorded.`);
        const parsed = excerptAnswersParse(excerptAnswers, record.excerpts);
        if (!parsed.ok) return refuse(parsed.code, parsed.message);
        excerptFields = { excerpt_answers: parsed.answers };
      } else if (excerptAnswers !== undefined) return refuse('excerpt_answers_not_asked', `gate ${gateId} does not take answers to excerpts with this answer. Nothing was recorded.`);
      // 0.8.4 D5a: approving a stop_decision gate carries the session's answer (choice, advisor state, what the advisor said), checked here; any other kind takes none.
      let stopFields = {};
      if (record.kind === STOP_DECISION_KIND && decision === 'approved') {
        if (stopAnswer === undefined) return refuse('stop_answer_required', `gate ${gateId} asks for the session's answer to the stop (choice, advisor, advisor_said). Nothing was recorded.`);   // A-DRAFT
        const secretGate = record.stop?.id?.startsWith('secret_pause:') === true;
        const parsed = stopAnswerParse(stopAnswer, secretGate);
        if (!parsed.ok) return refuse('bad_stop_answer', `${parsed.message}. Nothing was recorded.`);
        if (parsed.answer.relayed === true) {   // 0.8.4 (finish at once): a relayed answer is the person's, and only the session carries it, with the person's words and the relay sentence as its reason (the person's words and the session's own reason are two different things)
          if (channel !== SESSION_CHANNEL) return refuse('relayed_session_only', `a relayed answer on gate ${gateId} is given by the handling session with the person's words; a person gives their own choice at the terminal. Nothing was recorded.`);   // A-DRAFT
          if (typeof personWords !== 'string' || !personWords.trim()) return refuse('person_words_required', `a relayed answer is the person's choice: the session gives it only with the person's own words as typed in the handler's window. None were given. Nothing was recorded.`);   // A-DRAFT
          if (parsed.answer.rounds !== undefined && !secretGate) {   // 0.8.4 (typed = relayed): the person's new limit rides on a relayed continue as a typed --rounds N rides on --continue. On a ladder run's typed-limit stop it is the new limit, checked here as the terminal checks it (limitReachable); anywhere else the number changes nothing, as at the terminal, where the run prints that it was not used (src/cli.js)
            const stopNow = partialStopOf(runDir);
            if (!stopNow || stopIdOf(stopNow) !== record.stop?.id) return refuse('stop_not_readable', `a relayed continue is checked against the stop it answers, and this run's stop cannot be read or is not the stop of gate ${gateId}. Nothing was recorded.`);   // A-DRAFT (fail closed)
            if (stopNow.kind === 'overseer_cap' && stopNow.ladder === true && !limitReachable(parsed.answer.rounds, stopNow.rounds)) return refuse('rounds_not_reachable', roundsUnreachableSentence(parsed.answer.rounds, stopNow.rounds));   // A-DRAFT
          }
          if (secretGate) {   // 0.8.4 (Q9): a found-secret pause is read from its own record, never from a partial report; the choice must be one the terminal takes at this pause (phase and label), and the record must be THIS pause (fail closed)
            const pause = readSecretStop(runDir);
            if (!pause || secretGateStopId(pause) !== record.stop.id) return refuse('stop_not_readable', `a relayed choice at a credential-shaped pause is checked against the pause it answers, and this run's pause record cannot be read or is not the pause of gate ${gateId}. Nothing was recorded.`);   // A-DRAFT (LAD-Q9-3)
            if (!secretChoicesOf(pause).includes(parsed.answer.choice)) return refuse('choice_not_taken_here', `choice must be one of ${secretChoicesOf(pause).join(', ')}: that is what the terminal takes at this pause. Nothing was recorded.`);   // A-DRAFT (LAD-Q9-4)
            if (parsed.answer.rounds !== undefined) return refuse('rounds_not_here', "a credential-shaped pause has no review-round limit to change. Nothing was recorded.");   // A-DRAFT (LAD-Q9-4)
          }
          if (parsed.answer.choice === 'continue' && record.stop?.id?.startsWith('budget_stop:') && !budgetFinishStandsForContinue(runDir)) return refuse('budget_continue_is_a_raise', BUDGET_CONTINUE_REFUSAL);   // a spending stop is continued by raising the limit; a continue is taken only to go on past a finish the person gave (item ii)
          if (parsed.answer.choice === 'continue' && record.stop?.id?.startsWith('owner_pause:')) return refuse('pause_continue_is_resume', PAUSE_CONTINUE_REFUSAL);   // a pause is continued by resuming it, which is not a choice
          if (parsed.answer.choice === 'continue' && !record.stop?.id?.startsWith('budget_stop:') && !secretGate) {   // a rule of the stop, not of the session: a stall with no pass left offers no continue to anyone
            const stopHere = partialStopOf(runDir);
            if (!stopHere || stopIdOf(stopHere) !== record.stop?.id) return refuse('stop_not_readable', `a relayed continue is checked against the stop it answers, and this run's stop cannot be read or is not the stop of gate ${gateId}. Nothing was recorded.`);   // A-DRAFT (fail closed, C&C 10 Nov)
            if (!stopOffersContinue(stopHere)) return refuse('no_continue_here', `choice must be one of finish or finish_now: this stop offers no continue (no pass is left). Nothing was recorded.`);   // A-DRAFT
          }
          if (reason !== RELAY_REASON) return refuse('relay_reason_fixed', `a relayed answer carries the relay sentence as its reason, as THC writes it; the person's words go in person_words. Nothing was recorded.`);   // A-DRAFT
        } else if (record.stop?.person_only === true) return refuse('person_only_stop', PERSON_ONLY_STOP_REFUSAL);   // 0.8.4 (C&C 10 Nov): the session's OWN answer at a stop that is the person's alone is refused here, in the gate, whichever tool carried it
        stopFields = { stop_answer: parsed.answer };
      } else if (stopAnswer !== undefined) return refuse('stop_answer_not_asked', `gate ${gateId} does not take an answer to a stop with this answer. Nothing was recorded.`);   // A-DRAFT
      // 0.8.4 D4: the session's deferral (it declines its own stop_decision gate) carries the advisor state, what the advisor said and the person test, in which both parts say the stop is the person's; a person's decline carries none.
      if (record.kind === STOP_DECISION_KIND && decision === 'declined' && channel === SESSION_CHANNEL) {
        if (stopDefer === undefined) return refuse('stop_defer_required', `gate ${gateId}: handing a stop to the person carries the advisor state, what the advisor said and the person test (advisor, advisor_said, person_test). Nothing was recorded.`);   // A-DRAFT
        const parsed = stopDeferParse(stopDefer, record.stop?.person_only === true);
        if (!parsed.ok) return refuse('bad_stop_defer', `${parsed.message}. Nothing was recorded.`);
        stopFields = { stop_defer: parsed.defer };
      } else if (stopDefer !== undefined) return refuse('stop_defer_not_asked', `gate ${gateId} does not take a deferral with this answer. Nothing was recorded.`);   // A-DRAFT
      // 0.8.4 D2: the SESSION's approval of an acceptance gate carries its answer (advisor state, what the advisor said, the person test for each open objection), checked here; a person's approval carries none; any other answer takes none.
      let acceptanceFields = {};
      if (record.kind === ACCEPTANCE_KIND && decision === 'approved' && acceptanceAnswer && typeof acceptanceAnswer === 'object' && acceptanceAnswer.relayed !== undefined && channel !== SESSION_CHANNEL) return refuse('relayed_session_only', `a relayed acceptance on gate ${gateId} is given by the handling session with the person's words; a person accepts at the terminal with council accept. Nothing was recorded.`);   // A-DRAFT (LAD-A2; channel parity with the stop path)
      if (record.kind === ACCEPTANCE_KIND && decision === 'approved' && channel === SESSION_CHANNEL) {
        if (acceptanceAnswer === undefined) return refuse('acceptance_answer_required', `gate ${gateId} asks for the session's answer to the acceptance (advisor, advisor_said, and the person test for each open objection). Nothing was recorded.`);   // A-DRAFT
        const parsed = acceptanceAnswerParse(acceptanceAnswer);
        if (!parsed.ok) return refuse('bad_acceptance_answer', `${parsed.message}. Nothing was recorded.`);
        if (parsed.answer.relayed === true) {   // 0.8.4 (relayed accept; typed = relayed): the person's acceptance, carried by the session: the person's words are required and the reason is the relay sentence, as THC writes it
          if (typeof personWords !== 'string' || !personWords.trim()) return refuse('person_words_required', `a relayed acceptance is the person's: the session gives it only with the person's own words as typed in the handler's window. None were given. Nothing was recorded.`);   // A-DRAFT
          { const form = acceptanceReasonProblem(personWords); if (form) return refuse('person_words_form', form === 'control' ? `the person's words contain a line break or a hidden character, and a relayed acceptance takes one line of plain text. Ask the person to give their words in one line; do not change them yourself. Nothing was recorded.` : `the person's words are longer than ${ACCEPTANCE_REASON_MAX} characters, and a relayed acceptance takes one line of at most ${ACCEPTANCE_REASON_MAX}. Ask the person to say it again in one line; do not shorten it yourself. Nothing was recorded.`); }   // A-DRAFT (LAD-A5; the bar a typed reason meets)
          if (reason !== RELAY_REASON) return refuse('relay_reason_fixed', `a relayed acceptance carries the relay sentence as its reason, as THC writes it; the person's words go in person_words. Nothing was recorded.`);   // A-DRAFT
        }
        acceptanceFields = { acceptance_answer: parsed.answer };
      } else if (acceptanceAnswer !== undefined) return refuse('acceptance_answer_not_asked', `gate ${gateId} does not take an answer to an acceptance with this answer. Nothing was recorded.`);   // A-DRAFT
      // A run_cap approval is a TYPED amount (the typed-cap page, section 3): the text a person typed is parsed here against the ceiling bound in the gate, and the dollars written are the parse's. Never a caller's figure; no bare yes.
      let capFields = {};
      if (record.kind === RUN_CAP_KIND && decision === 'approved') {
        if (typeof typedCap !== 'string') return refuse('cap_required', `gate ${gateId} asks for a limit in US dollars: approving it means typing one. Nothing was recorded.`);
        const parsed = parseCapInput(typedCap, { ceilingUsd: record.cap.ceiling_usd, ceilingSource: record.cap.ceiling_source, paid: true });
        if (!parsed.ok) return refuse(`cap_${parsed.code}`, parsed.sentence);
        capFields = { cap_usd: parsed.capUsd, cap_micro_usd: parsed.capMicroUsd };
        if (channel === SESSION_CHANNEL && !figuresIn(personWords).some(x => Math.round(x * 1e6) === parsed.capMicroUsd)) return refuse('person_words_total', `the total ${parsed.capUsd} does not appear in the person's words as given, so the limit was not recorded. Quote the person's words with the figure in digits. Nothing was recorded.`);   // A-DRAFT
        if (channel === 'elicitation' && client && typeof client === 'object') {
          const cn = typeof client.name === 'string' ? client.name.slice(0, 100) : null; const cv = typeof client.version === 'string' ? client.version.slice(0, 100) : null;
          if (cn) capFields.client_name = cn;
          if (cv) capFields.client_version = cv;
        }
      } else if (personWords !== undefined && !(channel === SESSION_CHANNEL && (relayedKind(record.kind, record) || stopFields.stop_answer?.relayed === true || acceptanceFields.acceptance_answer?.relayed === true))) return refuse('person_words_not_asked', `this gate does not take the person's words with this answer. Nothing was recorded.`);   // A-DRAFT
      else if (typedCap !== undefined) return refuse('cap_not_asked', `gate ${gateId} does not ask for a typed limit with this answer. Nothing was recorded.`);
      const line = append('gate_answered', { gate: gateId, decision, sha256: record.sha256, meta_sha256: record.meta_sha256, channel, actor, reason, tty, ...(channel === SESSION_CHANNEL && typeof personWords === 'string' && personWords.trim() ? { person_words: personWords } : {}), ...capFields, ...excerptFields, ...stopFields, ...acceptanceFields });
      const answered = { ...record, status: decision, answer: { decision, channel, actor, reason, tty, ...(channel === SESSION_CHANNEL && typeof personWords === 'string' && personWords.trim() ? { person_words: personWords } : {}), at: line.ts, seq: line.seq, ...(capFields.cap_usd ? { cap_usd: capFields.cap_usd, cap_micro_usd: capFields.cap_micro_usd } : {}), ...excerptFields, ...stopFields, ...acceptanceFields } };
      try {
        writeAtomic(gatePath(runDir, gateId), `${JSON.stringify(answered, null, 2)}\n`);
      } catch (err) {
        return { ok: true, status: decision, seq: line.seq, warning: `the answer is recorded in the ledger (line ${line.seq}); gates/${gateId}.json could not be rewritten (${err.code ?? err.message}) and still says pending, which reads correctly` };
      }
      return { ok: true, status: decision, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/**
 * The one writer of a line that uses up an approval: `contract_locked` and `amend_decided` (0.8.2 item 6d; `sent` too, until 0.8.4). The refusals are gate_not_found, gate_ledger_corrupt, gate_busy, gate_record_unreadable, gate_record_mismatch, gate_not_approved, gate_expired, gate_used, hash_mismatch and io_error, and the guarantees: the
 * gate is approved, usable, unused, and its text still hashes to the approved hash, all checked under the ledger lock, so one approval is one use. `before({ gate, lines })` (optional) runs under
 * the same lock after those checks and before the line is appended: it may refuse with { code, message } (nothing is appended), and it is where the contract's record file is written, so the file and
 * the line are made under one lock, file first (a crash between the two leaves a file with no line, which `council contract check` reports and which has no authority).
 */
export function recordUse(runDir, gateId, event, fields = {}, { now = () => Date.now(), before = null } = {}) {
  // excerpts_recorded has its own writer (recordExcerptsRecorded): it takes a declined gate and is not cut by the expiry, which this function does both.
  if (!USE_EVENTS.includes(event) || event === EXCERPTS_RECORDED_EVENT) return refuse('bad_event', `${JSON.stringify(event)} does not use an approval here`);
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const t = now();
      const state = stateOf(runDir, gateId, lines, t);
      if (state.status === 'invalid') return refuse(state.reason, `gate ${gateId} cannot be trusted (${state.reason})`);
      if (state.status !== 'approved') return refuse(state.status === 'expired' ? 'gate_expired' : 'gate_not_approved', `gate ${gateId} is ${state.status}, not approved`);
      if (lines.some(l => USE_EVENTS.includes(l.event) && l.gate === gateId)) return refuse('gate_used', `gate ${gateId} was already used; one approval covers one use`);
      if (t >= Date.parse(state.gate.expires_at)) return refuse('gate_expired', `the approval of gate ${gateId} lapsed at ${state.gate.expires_at}`);
      const bytes = readGateText(runDir, state.gate.text);
      if (!bytes || textSha256(bytes) !== state.gate.sha256) return refuse('hash_mismatch', `the text of gate ${gateId} changed after it was approved`);
      if (before) { const refused = before({ gate: state.gate, lines }); if (refused) return refuse(refused.code, refused.message); }
      const line = append(event, { ...fields, gate: gateId, sha256: state.gate.sha256 });
      return { ok: true, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/**
 * The line that records a person's REFUSAL against a request that went through a gate: `amend_decided` with decision "declined" (0.8.2 item 6d). Written only when the gate reads `declined` (a person's
 * channel declined it), under the ledger lock; `before({ lines })` may refuse (the request must still be open). It is the counterpart of recordUse, so the contract's ledger events stay written by this module.
 * -> { ok: true, seq } | { ok: false, code, message }
 */
export function recordDeclined(runDir, gateId, event, fields = {}, { now = () => Date.now(), before = null } = {}) {
  if (event !== 'amend_decided') return refuse('bad_event', `${JSON.stringify(event)} does not record a refusal`);
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const state = stateOf(runDir, gateId, lines, now());
      if (state.status !== 'declined') return refuse('gate_not_declined', `gate ${gateId} is ${state.status}; a refusal is recorded only after a person declined its gate`);
      if (before) { const refused = before({ gate: state.gate, lines }); if (refused) return refuse(refused.code, refused.message); }
      const line = append(event, { ...fields, decision: 'declined', gate: gateId });
      return { ok: true, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/**
 * Uses up an approved `run_cap` gate for ONE run: one `cap_consumed` line, under the ledger lock (typed-cap page section 3). Strictly single-use PER GATE: any second consume of the same gate fails (`gate_used`), whatever the run id - a crashed
 * start is re-answered by a new gate, and continuing a run under its cap is runCapAuthority's read-only job (never a second consume of the same gate). T4b: a RUN may carry a sequence of consumptions (first start | resume_legacy | ..., later raise | amend_scope, each gate requested after the previous consumption); `committedMicroUsd` is what the cap will already count (the caller's figure) and a total not above it is refused (below_exposure). Refuses, appending nothing: cap_copied (the run id is not the one the limit was typed for),
 * cap_stale (the scope rebuilt now, `capScopeSha256` of what the run will do, is not the one the person was shown), not_run_cap, and recordUse's own (gate_not_approved, gate_expired, gate_used, hash_mismatch ...).
 * -> { ok: true, seq, gate, runId, capUsd, capMicroUsd } | { ok: false, code, message }
 */
export function consumeRunCap(runDir, gateId, { runId, scopeSha256, committedMicroUsd = 0 } = {}, { now = () => Date.now() } = {}) {
  const st = readGateAnswer(runDir, gateId, { now });
  if (st.gate && st.gate.kind !== RUN_CAP_KIND) return refuse('not_run_cap', `gate ${gateId} is a ${st.gate.kind} gate, not a limit for a run`);
  // The figure is read BEFORE the lock, so the pre-read must already be an approval (a use line is never written with no figure), and the locked ledger must still hold that very figure (checked in `before`).
  if (st.status === 'invalid') return refuse(st.reason, `gate ${gateId} cannot be trusted (${st.reason})`);
  if (st.status !== 'approved') return refuse(st.status === 'expired' ? 'gate_expired' : 'gate_not_approved', `gate ${gateId} is ${st.status}, not approved`);
  const answered = st.answer;
  const capName = capNameOf(st.gate?.cap);   // DUALCAP: the use line names the gate's cap (absent: as before, byte for byte)
  const res = recordUse(runDir, gateId, 'cap_consumed', { run_id: runId, cap_micro_usd: answered.cap_micro_usd, ...(capName !== null ? { [CAP_NAME_KEY]: capName } : {}) }, {
    now,
    before: ({ gate, lines }) => {
      if (gate.kind !== RUN_CAP_KIND) return { code: 'not_run_cap', message: `gate ${gateId} is a ${gate.kind} gate, not a limit for a run` };
      const locked = lines.find(l => l.event === 'gate_answered' && l.gate === gateId);
      if (!locked || locked.cap_micro_usd !== answered.cap_micro_usd) return { code: 'cap_record_mismatch', message: `the answer of gate ${gateId} changed while it was being used; nothing was started` };
      if (gate.cap.run_id !== runId) return { code: 'cap_copied', message: `this limit was typed for run ${gate.cap.run_id}, not for run ${runId}, so it cannot start this run. Nothing was started.` };
      // T4b: the order of a run's consumptions. The first is never a raise or an amendment (there is nothing to raise); every later one is, and its gate must have been requested AFTER the previous consumption (a gate requested
      // earlier and used late asks about a state of the run that is gone). A repeated gate is gate_used (recordUse). 
      if (capNameOf(gate.cap) !== capName) return { code: 'cap_record_mismatch', message: `the cap of gate ${gateId} changed while it was being used; nothing was started` };
      const prior = lines.filter(l => l.event === 'cap_consumed' && capNameOf(l) === capName);   // DUALCAP: the order rules run per cap
      const later = LATER_OPERATION.test(gate.cap.operation);
      if (!prior.length && later) return { code: 'cap_sequence', message: `gate ${gateId} raises or amends a limit, but this run has no limit to raise yet. Nothing was started.` };
      if (prior.length && !later) return { code: 'cap_sequence', message: `this run already has a limit; gate ${gateId} is a first limit, not a raise or an amendment. Nothing was started.` };
      if (prior.length) {
        const requested = lines.find(l => l.event === 'gate_requested' && l.gate === gateId);
        if (!requested || !(requested.seq > prior[prior.length - 1].seq)) return { code: 'cap_sequence_stale', message: `gate ${gateId} was requested before the run's latest limit was recorded, so it asks about a state of the run that is gone. Nothing was started; start again to see the current screen.` };
      }
      // A total is a total for the WHOLE run: not above what the cap will already count (the caller's figure; src/resume-ceiling.js for a budget stop), it could not carry the run one more call.
      if (committedMicroUsd > 0 && answered.cap_micro_usd <= committedMicroUsd) return { code: 'below_exposure', message: `the limit typed ($${answered.cap_usd}) is not above what this run has already counted ($${(committedMicroUsd / 1e6).toString()}), so it cannot carry the run any further. Nothing was started. Type a total above $${(committedMicroUsd / 1e6).toString()}.` };
      if (gate.cap.scope_sha256 !== scopeSha256) return { code: 'cap_stale', message: 'the task, the chain or the settings changed after the limit screen was shown, so the limit you typed no longer applies. Nothing was started. Start again to see the new screen.' };
      return null;
    },
  });
  return res.ok ? { ok: true, seq: res.seq, gate: gateId, runId, capUsd: answered.cap_usd, capMicroUsd: answered.cap_micro_usd } : res;
}

/**
 * The limit a run is authorized under: a READ of its ledger, never a write. { status: 'none' } (no cap consumed: a LEGACY run, which gets no synthesized approval) |
 * { status: 'ok', gate, runId, operation, capUsd, capMicroUsd, channel, actor, seq } | { status: 'invalid', reason }. Fails closed: a broken ledger, more than one `cap_consumed` line (two authorities),
 * a consumed gate that does not read approved (or whose screen text changed), a use line that disagrees with its gate (cap_record_mismatch), or - when `runId` is given - a use line for another run (cap_copied: a folder copied
 * or moved carries the original run's id). The caller (a resume) holds the run lock while it reads this; `cap_amended` (the tree budget record) is another reader's.
 */
// DUALCAP unit 4b1: `capName` reads ONE cap's sequence (the consumptions whose cap_name equals it); absent, the lines with none (a run's one limit, and every ledger written
// before per-cap limits). The ledger-wide checks (one run per ledger, the run id, a cap_name that is not a provider that bills) still read every consumption.
export function runCapAuthority(runDir, { runId, capName = null, now = () => Date.now() } = {}) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { status: 'invalid', reason: 'gate_ledger_corrupt' };
  const consumed = ledger.lines.filter(l => l.event === 'cap_consumed');
  if (consumed.some(l => capNameOf(l) !== null && !BILLING_CAP_IDS.includes(capNameOf(l)))) return { status: 'invalid', reason: 'cap_record_mismatch' };
  const used = consumed.filter(l => capNameOf(l) === (capName ?? null));
  // the OTHER caps' lines (none in a ledger with one kind, so its checks below run exactly as before): for this run, like every line of one ledger
  const others = consumed.filter(l => capNameOf(l) !== (capName ?? null));
  if (others.some(l => (runId !== undefined && l.run_id !== runId) || l.run_id !== consumed[0].run_id)) return { status: 'invalid', reason: 'cap_copied' };
  if (!used.length) return { status: 'none' };
  // T4b: a run's limit in force is its LAST consumption, and EVERY consumption must hold: its gate approved and unchanged, its use line agreeing with its gate, the run id right, and the sequence valid (the first is not a raise or an
  // amendment; every later one is, and its gate was requested after the previous consumption; a gate is never used twice). Any failure makes the whole run invalid (fail closed): a total that cannot be traced is no authority.
  let prev = null; let last = null; const seen = new Set();
  for (const u of used) {
    if (seen.has(u.gate)) return { status: 'invalid', reason: 'cap_consumed_more_than_once' };
    seen.add(u.gate);
    const st = stateOf(runDir, u.gate, ledger.lines, now());
    if (st.status !== 'approved' || st.gate.kind !== RUN_CAP_KIND) return { status: 'invalid', reason: st.status === 'invalid' ? st.reason : 'cap_gate_not_approved' };
    const bytes = readGateText(runDir, st.gate.text);
    if (!bytes || textSha256(bytes) !== st.gate.sha256) return { status: 'invalid', reason: 'hash_mismatch' };
    if (u.sha256 !== st.gate.sha256 || u.run_id !== st.gate.cap.run_id || u.cap_micro_usd !== st.answer.cap_micro_usd || capNameOf(u) !== capNameOf(st.gate.cap)) return { status: 'invalid', reason: 'cap_record_mismatch' };
    if (runId !== undefined && u.run_id !== runId) return { status: 'invalid', reason: 'cap_copied' };
    if (prev && u.run_id !== prev.run_id) return { status: 'invalid', reason: 'cap_copied' };   // every consumption of one ledger is for ONE run
    const later = LATER_OPERATION.test(st.gate.cap.operation);
    if (!prev && later) return { status: 'invalid', reason: 'cap_sequence' };
    if (prev) {
      if (!later) return { status: 'invalid', reason: 'cap_sequence' };
      const requested = ledger.lines.find(l => l.event === 'gate_requested' && l.gate === u.gate);
      if (!requested || !(requested.seq > prev.seq)) return { status: 'invalid', reason: 'cap_sequence_stale' };
    }
    last = { gate: u.gate, runId: u.run_id, operation: st.gate.cap.operation, capUsd: st.answer.cap_usd, capMicroUsd: st.answer.cap_micro_usd, channel: st.answer.channel, actor: st.answer.actor, seq: u.seq, scopeSha256: st.gate.cap.scope_sha256 };
    prev = u;
  }
  return { status: 'ok', ...last, consumptions: used.length };
}

// 0.8.4 D10 (plan A T5.5, slice 1): the privacy switch's ON state. One ledger line, `excerpt_switch_on`, records that the run was started or resumed with the switch asked for, by the typed flag or by the chain's own
// setting (`source`). It is a SETTING THC recorded and not a person's answer: it names no actor and no channel and carries `approval: false`, so no reader counts it as an approval. It is additive (a tool older than
// 0.8.4 reads a ledger that holds it as broken, the same sentence as every event this module adds) and there is no line that turns the switch off in this slice: the state only ever goes from off to on.
// The first line stands for the run; asking again records nothing. A missing ledger reads as off; a ledger that does not verify reads as a refusal (fail closed), never as off.
export const EXCERPT_SWITCH_EVENT = 'excerpt_switch_on';
export const EXCERPT_SWITCH_SOURCES = Object.freeze(['flag', 'chain']);

/** -> { ok: true, already: boolean, seq } | { ok: false, code, message }. `already` is true when the run's ledger holds the line (nothing was appended). */
export function recordExcerptSwitchOn(runDir, { source }, { now = () => Date.now() } = {}) {
  if (!EXCERPT_SWITCH_SOURCES.includes(source)) return refuse('bad_source', `source must be ${EXCERPT_SWITCH_SOURCES.join(' or ')}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const had = lines.find(l => l.event === EXCERPT_SWITCH_EVENT);
      if (had) return { ok: true, already: true, seq: had.seq };
      const line = append(EXCERPT_SWITCH_EVENT, { source, recorded_by: 'thc', approval: false });
      return { ok: true, already: false, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/** The switch as the run's ledger holds it: { ok: true, on: false } | { ok: true, on: true, seq, source, ts } | { ok: false, code: 'gate_ledger_corrupt', message } (a ledger that cannot be verified is never read as "off"). */
export function excerptSwitchOf(runDir) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return refuse('gate_ledger_corrupt', 'the approval record of this run cannot be read.');
  const line = ledger.lines.find(l => l.event === EXCERPT_SWITCH_EVENT);
  return line ? { ok: true, on: true, seq: line.seq, source: line.source, ts: line.ts } : { ok: true, on: false };
}

// 0.8.4 D10 slice 2a: the use of an answered excerpt_approval gate. ONE `excerpts_recorded` line says the pause wrote one row per bound excerpt from the answer (`count` is that number) in run `run_id`. Single use, like
// every use event. Unlike recordUse it takes a DECLINED gate too (declining means refuse-all, and its rows are written all the same) and it is NOT cut by the gate's expiry: the ten minutes protect an
// unanswered gate; an answered one is applied at the next resume, however late. Refused, appending nothing: gate_not_found, gate_ledger_corrupt, gate_busy, gate_record_unreadable, gate_record_mismatch,
// not_excerpt_approval, gate_not_answered (pending or expired unanswered), gate_used, hash_mismatch, bad_run_id, bad_count (not the number of excerpts the gate binds), io_error.
export function recordExcerptsRecorded(runDir, gateId, { runId, count } = {}, { now = () => Date.now() } = {}) {
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  if (typeof runId !== 'string' || !CAP_RUN_ID.test(runId)) return refuse('bad_run_id', 'runId must be the run the rows were written for');
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const state = stateOf(runDir, gateId, lines, now());
      if (state.status === 'invalid') return refuse(state.reason, `gate ${gateId} cannot be trusted (${state.reason})`);
      if (state.gate.kind !== EXCERPT_APPROVAL_KIND) return refuse('not_excerpt_approval', `gate ${gateId} is a ${state.gate.kind} gate, not an approval of excerpts`);
      if (state.status !== 'approved' && state.status !== 'declined') return refuse('gate_not_answered', `gate ${gateId} is ${state.status}: nobody has answered it`);
      if (lines.some(l => USE_EVENTS.includes(l.event) && l.gate === gateId)) return refuse('gate_used', `gate ${gateId} was already used; one answer covers one recording`);
      if (count !== state.gate.excerpts.length) return refuse('bad_count', `gate ${gateId} binds ${state.gate.excerpts.length} excerpt(s): the recording must cover each one`);
      const bytes = readGateText(runDir, state.gate.text);
      if (!bytes || textSha256(bytes) !== state.gate.sha256) return refuse('hash_mismatch', `the text of gate ${gateId} changed after it was answered`);
      const line = append(EXCERPTS_RECORDED_EVENT, { gate: gateId, sha256: state.gate.sha256, run_id: runId, count });
      return { ok: true, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/**
 * The run's excerpt_approval gates that have NO `excerpts_recorded` line, WHATEVER their status (pending, answered, declined, expired, or unreadable): a run with one of them is stopped at its excerpt approval, and
 * a plain resume must not walk past it. -> { ok: true, waiting: [{ gate, status }] } | { ok: false, code: 'gate_ledger_corrupt', message } (a ledger that cannot be verified never reads as "nothing waits").
 * The pause unit (src/excerpt-pause.js) creates these gates; what actually stops a resume is excerptApprovalStops below.
 */
export function excerptApprovalWaiting(runDir, { now = () => Date.now() } = {}) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return refuse('gate_ledger_corrupt', 'the approval record of this run cannot be read.');
  const t = now();
  const waiting = ledger.lines
    .filter(l => l.event === 'gate_requested' && l.kind === EXCERPT_APPROVAL_KIND && !ledger.lines.some(u => u.event === EXCERPTS_RECORDED_EVENT && u.gate === l.gate))
    .map(l => ({ gate: l.gate, status: stateOf(runDir, l.gate, ledger.lines, t).status }));
  return { ok: true, waiting };
}

/**
 * CHANGED ACCEPTED (D10 slice 2c, "a resume is refused whatever the gate's status"; C&C 09 Nov 2026): forced, because an answered gate must be applied by the next resume, which the earlier rule forbade. The row that fails if
 * the switch-OFF behaviour changes: test/excerpt-resume-refusal.test.js "the basis is the record fact ... whatever the gate's status". The switch-ON rows: test/privacy-pause.test.js (pending refuses, answered applies),
 * test/excerpt-resume-refusal.test.js (unreadable refuses), test/excerpt-pause.test.js (expired is asked again).
 * What actually STOPS a resume (0.8.4, the pause unit): the waiting gates above, minus the ones the next resume deals with itself. In a run whose privacy switch is on (the only kind of run that has these gates), a resume
 * applies an answered gate's answers to the excerpts waiting, or asks again when the gate expired or no longer matches them; only a gate that waits for the person (pending) or cannot be read (invalid) stops it. A run whose
 * switch is not on, or whose ledger cannot say, keeps the earlier rule: every waiting gate stops it, whatever its status. Same shape as excerptApprovalWaiting.
 */
export function excerptApprovalStops(runDir, opts = {}) {
  const w = excerptApprovalWaiting(runDir, opts);
  if (!w.ok) return w;
  const sw = excerptSwitchOf(runDir);
  const dealtWith = sw.ok === true && sw.on === true;
  return { ok: true, waiting: w.waiting.filter(x => !dealtWith || x.status === 'pending' || x.status === 'invalid') };
}
