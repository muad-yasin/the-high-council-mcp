// The gate ledger: `runs/<id>/gate-ledger.jsonl`, one hash-chained line per event (0.8.1 plan DR-4, M3,
// persistence register P5). It is the record of every gate a run asked a person to answer and of what
// happened after: a send, a stop, an advisor's request for more material.
//
// Contract.
//   readLedger(runDir)      -> { ok, missing, lines[], torn, failedAt?, reason? }  (read-only)
//   verifyLedger(runDir)    -> the same verdict, for `council gate verify`
//   withLedger(runDir, fn)  -> runs fn({ lines, append }) holding the run's ledger lock; append(event, fields)
//                              writes one line. Used by src/gate.js for the two gate events.
//   appendEvent(runDir, event, fields) -> appends one of PUBLIC_EVENTS (sent, stopped, more_material_requested, amend_requested).
//   EVENTS, PUBLIC_EVENTS, LEDGER_FILE, LEDGER_SCHEMA
//   RELAY_REASON, ROUTE_REASON_MAX   the two meanings of a route decision's `reason` (see the route kinds below): the relay sentence, and the longest free reason a handler may give
//
// Line format: {"schema":"gate-ledger/1","seq":n,"prev":<sha256 hex | null>,"ts":<ISO>,"event":<name>,...fields}.
// `seq` starts at 1. `prev` is the sha256 of the previous line's bytes WITHOUT its trailing newline, so a
// reader can check a ledger by hand with `head -n1 | tr -d '\n' | sha256sum`; the first line's `prev` is null.
//
// Tamper-evident, not tamper-proof (decided rule 9): a changed or deleted line BEFORE the last one breaks
// the chain and the run fails closed (`gate_ledger_corrupt`). Anything that can write the run folder can
// edit or append the last line, cut the tail, or rewrite the whole file, and the chain cannot tell (src/gate.js
// compares a gate's file with its ledger lines, which catches an edit of one but not of both). No text
// anywhere says otherwise.
//
// Torn tail. A line is complete only when it ends in "\n"; every line is written by one write() of the
// whole line, newline included, then fsync. A last segment with no newline is a write a crash cut short:
// it is ignored on read and cut away (at the byte offset after the last complete line) before the next
// append. A COMPLETE line that does not parse, or whose seq/prev/schema is wrong, is a mid-file break,
// never a torn tail.
//
// Concurrency. The `prev` of a new line depends on the last line, so read-then-append must not interleave
// between two processes (an MCP server and a terminal answering the same run). Every append holds the
// run's ledger lock, the same O_EXCL lock with stale-pid takeover as the run lock (src/run-lock.js).
// Every holder is synchronous from take to release, so a lock whose pid is alive is really in use. A lock
// file that cannot be read (a crash between creating it and writing the pid) is judged by its age: older
// than 30 s (P14's rule for the advice lock) it is stale and taken over; until then it is waited on.
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { acquireRunLock, RunLockedError } from './run-lock.js';

export const LEDGER_FILE = 'gate-ledger.jsonl';
export const LEDGER_LOCK_FILE = 'gate-ledger.lock';
export const LEDGER_SCHEMA = 'gate-ledger/1';
// The set M4 (sent), M5 (more_material_requested) and M6 (stopped) need; plan M3 Work 2. 0.8.2 item 6d (owner, 7 Oct 2026: "we go with the full one") adds the contract record's three:
// contract_locked, amend_requested and amend_decided (src/contract-record.js). A ledger that holds one of them is read as "broken" by a 0.8.1 tool (it reports an unknown event, whatever the
// format id says), which the CHANGELOG lists under the breaking heading.
// 0.8.3 M5b (C&C, 8 Oct 2026): a recursive-councils tree reuses the gate for the person's approvals, and a tree gate is used ONCE like any other, so its use events join the list: `tree_frontier_approved` (a frontier
// approval), `tree_decided` (a `council tree decide` answer) and, since M6 S2, `tree_checked` (a `council tree check` run the person approved). Same breaking-format sentence as the contract events above: an older tool reads a ledger that holds one of them as "broken".
export const EVENTS = Object.freeze(['gate_requested', 'gate_answered', 'sent', 'stopped', 'more_material_requested', 'contract_locked', 'amend_requested', 'amend_decided', 'tree_frontier_approved', 'tree_decided', 'tree_checked', 'cap_consumed', 'cap_raise_closed', 'stop_answer_closed', 'budget_finish', 'pause_finished', 'route_requested', 'route_decided', 'pause_requested', 'pause_taken', 'pause_lapsed', 'excerpt_switch_on', 'excerpts_recorded']);
// 0.8.4 S20 slice 2 (control 1, routing the next pass to layer 3; Mini-C&C's rulings R176 and R179): `route_requested` records that the PERSON asked for the next pass to be routed to layer 3 and `route_decided` records what the HANDLER decided, with its advisor,
// by reasoning (routed or declined), or what the PERSON decided when the handler asked and carries the answer out. Neither is an approval of a gate: no field of either is `approved`, no gate id is named, and no reader of a person's answer looks at them. Each is marked as what it is
// (`by` "person" / "handler"; `decided_by` says whose decision it was). The chain check below (routeLineProblem, which src/gate.js's writers use too, so the two cannot disagree) refuses a line that is not marked, not shaped, has no words where words are required, names a request that is
// not there, decides one request twice or routes one pass twice. It does NOT refuse a second open request for a pass: that is a writer refusal, not corruption. An older tool reads a ledger that holds either as broken (the same breaking-format sentence as the events above).
export const ROUTE_CHANNELS = Object.freeze(['cli', 'session']);
export const ROUTE_DECISIONS = Object.freeze(['routed', 'declined']);
// The two meanings of a route decision's `reason` (C&C's ruling R228, which amends R179(2)): when the PERSON decided (`decided_by` "person") the reason is the relay sentence below, written by THC and never typed by the person (his own words are in `person_words`);
// when the HANDLER decided (`decided_by` "handler") the reason is the handler's own free text, at most ROUTE_REASON_MAX code points, and never the relay sentence. routeLineProblem enforces both, so the writer and the chain check cannot disagree. Null is not allowed in either case.
// The sentence lives HERE, the lowest module that needs it (the other direction would be a cycle: run-controls imports gate.js, which imports this file). src/gate.js re-exports it and src/run-controls.js re-exports it from gate.js, because only gate.js and gate-cli.js may import this file (test/gate-answer.test.js R2).
export const RELAY_REASON = 'relayed by the handler session on the person\'s permission, as the session states it; the person\'s words, as the session gave them, are in person_words';
export const ROUTE_REASON_MAX = 400;
const isPass = n => Number.isInteger(n) && n >= 1;
const hasWords = s => typeof s === 'string' && s.trim() !== '';
/**
 * The shape and references of one route line, against the lines before it. null when it is fine, else { code, message } (the message is what the chain check reports; the writers refuse with the same pair). A-DRAFT sentences.
 * - route_requested: pass (>= 1), floor 3, by "person", channel cli (person_words null) or session (person_words required).
 * - route_decided: pass, floor 3, decision routed | declined, by "handler", decided_by handler (person_words null) or person (person_words required), a reason on every decision (the relay sentence when the person decided; the handler's own free text, at most 400 code points and never the relay sentence, when the handler did), request_seq null (a route the handler or the person decided with no request, so
 *   only "routed") or the seq of an earlier route_requested for the same pass that no decision has answered yet; one routed decision per pass.
 */
export function routeLineProblem(line, lines) {
  const bad = (code, message) => ({ code, message });
  if (line.event === 'route_requested') {
    if (!isPass(line.pass)) return bad('route_pass_invalid', 'a route request names the pass it is for (a whole number from 1).');   // A-DRAFT
    if (line.floor !== 3) return bad('route_floor_invalid', 'a route request asks for layer 3.');   // A-DRAFT
    if (line.by !== 'person') return bad('route_request_not_marked', 'a route request is marked as the person\'s (by "person").');   // A-DRAFT
    if (!ROUTE_CHANNELS.includes(line.channel)) return bad('channel_not_allowed', `a route request comes by the terminal (cli) or the handler's relay (session), not ${JSON.stringify(line.channel)}.`);   // A-DRAFT
    if (line.channel === 'session' && !hasWords(line.person_words)) return bad('person_words_required', 'a route request the handler relays carries the person\'s words as the person typed them.');   // A-DRAFT
    if (line.channel === 'cli' && line.person_words !== null) return bad('person_words_not_for_terminal', 'a route request typed at the terminal carries no relayed words.');   // A-DRAFT
    return null;
  }
  if (line.event !== 'route_decided') return null;
  if (!isPass(line.pass)) return bad('route_pass_invalid', 'a route decision names the pass it is for (a whole number from 1).');   // A-DRAFT
  if (line.floor !== 3) return bad('route_floor_invalid', 'a route decision is about layer 3.');   // A-DRAFT
  if (line.by !== 'handler') return bad('route_decision_not_marked', 'a route decision is recorded by the handler session (by "handler").');   // A-DRAFT
  if (!ROUTE_DECISIONS.includes(line.decision)) return bad('route_decision_invalid', `a route decision is routed or declined, not ${JSON.stringify(line.decision)}.`);   // A-DRAFT
  if (line.decided_by !== 'handler' && line.decided_by !== 'person') return bad('route_decider_invalid', 'a route decision says whose it is: the handler\'s or the person\'s.');   // A-DRAFT
  if (line.decided_by === 'person' && !hasWords(line.person_words)) return bad('person_words_required', 'a route decision that is the person\'s carries the person\'s words as the person typed them.');   // A-DRAFT
  if (line.decided_by === 'handler' && line.person_words !== null) return bad('person_words_not_for_handler', 'a route decision that is the handler\'s own carries no person\'s words.');   // A-DRAFT
  if (!hasWords(line.reason)) return bad('route_reason_required', 'a route decision carries its reason.');   // A-DRAFT
  if (line.decided_by === 'person' && line.reason !== RELAY_REASON) return bad('route_reason_not_relay', 'a route decision that is the person\'s carries the relay sentence as its reason, exactly as THC writes it; the person\'s words go in person_words.');   // A-DRAFT
  if (line.decided_by === 'handler') {
    const length = [...line.reason].length;
    if (length > ROUTE_REASON_MAX) return bad('route_reason_too_long', `a route decision's reason is at most ${ROUTE_REASON_MAX} characters (this one has ${length}).`);   // A-DRAFT
    if (line.reason === RELAY_REASON) return bad('route_reason_relay_for_handler', 'a route decision that is the handler\'s own gives its own reason; the relay sentence is only for a decision that is the person\'s.');   // A-DRAFT
  }
  if (line.request_seq === null) {
    if (line.decision !== 'routed') return bad('route_decline_needs_request', 'only a request can be declined: a decision with no request is a route.');   // A-DRAFT
  } else {
    const request = Number.isInteger(line.request_seq) ? lines[line.request_seq - 1] : undefined;
    if (!request || request.event !== 'route_requested') return bad('route_request_not_found', `request ${JSON.stringify(line.request_seq)} is not a route request in this run's record.`);   // A-DRAFT
    if (request.pass !== line.pass) return bad('route_pass_mismatch', `request ${line.request_seq} is for pass ${request.pass}, not pass ${line.pass}.`);   // A-DRAFT
    if (lines.some(l => l.event === 'route_decided' && l.request_seq === line.request_seq)) return bad('route_already_decided', `request ${line.request_seq} was already decided.`);   // A-DRAFT
  }
  if (line.decision === 'routed' && lines.some(l => l.event === 'route_decided' && l.decision === 'routed' && l.pass === line.pass)) return bad('route_pass_routed', `pass ${line.pass} is already routed to layer 3.`);   // A-DRAFT
  return null;
}
// 0.8.4 S20 slice 2 (#16c, the owner's "pause after this round"; Mini-C&C R358, R360): `pause_requested` records that the PERSON or the HANDLER session asked the RUNNING run to stop before the next pass starts; `pause_taken` records that the sitting
// which stopped for that request was resumed (the request is used up); `pause_lapsed` records that a request ended without being taken (the run was resumed some other way, or stopped at another cause): a request governs only the run that was running
// when it was asked, so an old one never pauses a later sitting at once. Each is written only by src/gate.js under the ledger lock, none is public, none is an approval. `pause_requested` has the R228 two-meanings shape: BY THE PERSON at the terminal
// (channel cli): no words, no reason; BY THE PERSON, relayed (channel session): his words and the relay sentence as the reason; BY THE HANDLER: its own free reason (at most ROUTE_REASON_MAX code points, never the relay sentence), no words.
// pauseLineProblem is the chain check AND what the writers use; a second untaken request is a writer refusal (not corruption).
const PAUSE_ACTORS = Object.freeze(['person', 'handler']);
/** The pause requests of a ledger, oldest first: [{ seq, line, taken, lapsed }] where taken / lapsed are the settling line or null. Pure. */
export function pauseRequestsOf(lines) {
  return lines.filter(l => l.event === 'pause_requested').map(r => ({ seq: r.seq, line: r, taken: lines.find(l => l.event === 'pause_taken' && l.request_seq === r.seq) ?? null, lapsed: lines.find(l => l.event === 'pause_lapsed' && l.request_seq === r.seq) ?? null, finished: lines.find(l => l.event === 'pause_finished' && l.request_seq === r.seq) ?? null }));
}
export const untakenPauseOf = lines => pauseRequestsOf(lines).find(r => !r.taken && !r.lapsed && !r.finished) ?? null;
/** 0.8.4 (ladder unit, C&C 10 Nov): `pause_finished` is the third way a pause request ends: the run PAUSED and the person ended it there (choice finish or finish_now). `pause_taken` is a pause that was resumed; `pause_lapsed` a request that never paused the run. */
export const PAUSE_FINISH_CHOICES = Object.freeze(['finish', 'finish_now']);
/** null when the line is fine, else { code, message } (A-DRAFT sentences; the chain check reports them as `<event>: <sentence>`, the writers refuse with the same pair). */
export function pauseLineProblem(line, lines) {
  const bad = (code, message) => ({ code, message });
  if (line.event === 'pause_requested') {
    if (!isPass(line.pass)) return bad('pause_pass_invalid', 'a pause request names the pass the run is in (a whole number from 1).');   // A-DRAFT
    if (!PAUSE_ACTORS.includes(line.by)) return bad('pause_by_invalid', 'a pause request says who asked: the person or the handler session.');   // A-DRAFT
    if (!ROUTE_CHANNELS.includes(line.channel)) return bad('channel_not_allowed', `a pause request comes by the terminal (cli) or the handler's relay (session), not ${JSON.stringify(line.channel)}.`);   // A-DRAFT
    if (line.by === 'person' && line.channel === 'cli') {
      if (line.person_words !== null) return bad('person_words_not_for_terminal', 'a pause request typed at the terminal carries no relayed words.');   // A-DRAFT
      if (line.reason !== null) return bad('pause_reason_not_for_person', 'a pause request that is the person\'s carries no reason of its own.');   // A-DRAFT
    } else if (line.by === 'person') {
      if (!hasWords(line.person_words)) return bad('person_words_required', 'a pause request the handler relays carries the person\'s words as the person typed them.');   // A-DRAFT
      if (line.reason !== RELAY_REASON) return bad('pause_reason_not_relay', 'a pause request that is the person\'s and relayed carries the relay sentence as its reason, exactly as THC writes it; the person\'s words go in person_words.');   // A-DRAFT
    } else {
      if (line.person_words !== null) return bad('person_words_not_for_handler', 'a pause request that is the handler\'s own carries no person\'s words.');   // A-DRAFT
      if (!hasWords(line.reason)) return bad('pause_reason_required', 'a pause request that is the handler\'s own carries its reason.');   // A-DRAFT
      const length = [...line.reason].length;
      if (length > ROUTE_REASON_MAX) return bad('route_reason_too_long', `a pause request's reason is at most ${ROUTE_REASON_MAX} characters (this one has ${length}).`);   // A-DRAFT
      if (line.reason === RELAY_REASON) return bad('route_reason_relay_for_handler', 'a pause request that is the handler\'s own gives its own reason; the relay sentence is only for a request that is the person\'s.');   // A-DRAFT
    }
    return null;
  }
  if (line.event !== 'pause_taken' && line.event !== 'pause_lapsed' && line.event !== 'pause_finished') return null;
  if (line.event === 'pause_finished' && !PAUSE_FINISH_CHOICES.includes(line.choice)) return bad('pause_finish_choice_invalid', 'a finished pause says how the person ended it: finish or finish_now.');   // A-DRAFT
  if (line.event === 'pause_finished' && !(Number.isInteger(line.pass) && line.pass >= 2)) return bad('pause_finish_pass_invalid', 'a finished pause names the pass the run stopped before (a whole number from 2).');   // A-DRAFT (the pass of the STOP: a request made during a pass\'s first call is recorded one pass earlier than the stop)
  const request = Number.isInteger(line.request_seq) ? lines[line.request_seq - 1] : undefined;
  if (!request || request.event !== 'pause_requested') return bad('pause_request_not_found', `request ${JSON.stringify(line.request_seq)} is not a pause request in this run's record.`);   // A-DRAFT
  if (lines.some(l => (l.event === 'pause_taken' || l.event === 'pause_lapsed' || l.event === 'pause_finished') && l.request_seq === line.request_seq)) return bad('pause_request_settled', `pause request ${line.request_seq} was already taken or lapsed, or finished.`);   // A-DRAFT
  return null;
}
// 0.8.4 (ladder unit, C&C 10 Nov: ONE finish-now, given once, ends the run): `budget_finish` records the person's `--finish-now` at a SPENDING stop, so the resume that follows a session's answer (a session writes the handoff on every shipped chain) goes on ending the run
// without asking for a limit. A `finish_now` is bound to THE stop the person saw by `stop_sha256` (the hash of the stop file's identifying fields); a raise, or a second stop, changes those fields, so it never applies to another stop. A plain `finish` is different: it governs the RUN's ending (see budgetPlainFinishOfRun) until a later finish_now. Written only by src/gate.js under the ledger lock, never an
// approval of a gate, never a cap answer: no reader of a cap-gate answer can read it. Typed at the terminal (channel cli, actor person) or relayed by the handling session (channel session, with the person's words and the stop_decision gate that holds them). `choice` is finish_now (ends the run at no cost) or finish (the plain --finish, inside the review rounds: recorded now, the run ends after a typed raise and one last read); the person's LATEST line for a stop decides, so a later finish sets an earlier finish_now aside.
export const BUDGET_FINISH_PHASES = Object.freeze(['loop', 'after']);
export const BUDGET_FINISH_CHOICES = Object.freeze(['finish', 'finish_now', 'continue']);   // 0.8.4 (unit-end item ii): `continue` is the way back - the person goes on past a finish they gave (the raise itself is a separate gate); the LATEST choice decides
export function budgetFinishLineProblem(line, lines) {
  const bad = (code, message) => ({ code, message });
  if (line.event !== 'budget_finish') return null;
  if (!/^[0-9a-f]{64}$/.test(String(line.stop_sha256 ?? ''))) return bad('budget_finish_stop_invalid', 'a finish at the spending limit names the stop it was given for (its hash).');   // A-DRAFT
  if (!BUDGET_FINISH_CHOICES.includes(line.choice)) return bad('budget_finish_choice_invalid', 'a finish at the spending limit says what the person chose: finish_now, finish inside the review rounds, or continue (go on past a finish they gave).');   // A-DRAFT
  if (line.label !== undefined && !(typeof line.label === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/.test(line.label))) return bad('budget_finish_label_invalid', 'a finish at the spending limit names the stage it was given at, as a stage label.');   // A-DRAFT
  if (line.cap_name !== undefined && typeof line.cap_name !== 'string') return bad('budget_finish_cap_invalid', 'a finish at the spending limit names its cap as text.');   // A-DRAFT
  if (line.choice === 'finish' && line.phase !== 'loop') return bad('budget_finish_plain_after', 'a plain finish ends a spending stop only inside the review rounds (after them the run is already ending).');   // A-DRAFT
  if (!BUDGET_FINISH_PHASES.includes(line.phase)) return bad('budget_finish_phase_invalid', 'a finish at the spending limit is given at a stop inside or after the review rounds.');   // A-DRAFT
  // typed at the terminal (channel cli: no words, not relayed) or RELAYED by the handling session with the person's own words, through the answered stop_decision gate it names (channel session, relayed true, person_words, gate): a relayed finish-now is recorded as relayed, never as typed
  if (line.actor !== 'person' || !['cli', 'session'].includes(line.channel)) return bad('budget_finish_channel_invalid', 'a finish at the spending limit is the person\'s, typed at the terminal or relayed by the handling session with the person\'s words.');   // A-DRAFT
  if (line.channel === 'cli' && (line.relayed !== undefined || line.person_words !== undefined || line.stop_gate !== undefined)) return bad('budget_finish_typed_shape', 'a finish at the spending limit typed at the terminal carries no relayed mark, no words and no gate.');   // A-DRAFT
  if (line.channel === 'session' && !(line.relayed === true && hasWords(line.person_words) && typeof line.stop_gate === 'string' && line.stop_gate)) return bad('budget_finish_relayed_shape', 'a finish at the spending limit relayed by the handling session carries the person\'s words and the stop_decision gate that holds them, and is marked relayed.');   // A-DRAFT
  return null;   // (a second line for the same stop is allowed: the person's LATEST choice decides, so a finish-now typed again after a raise was started is a new line; the writer, not the chain check, keeps a retyped command from writing a line twice)
}
/**
 * The record of the person's finish at THIS stop (by its hash) that STANDS, or null. Pure. The person's LATEST choice at a stop decides, and what sets a record aside is what the PERSON did after it, not when a gate was asked for:
 *  (1) a limit the person APPROVED after it (a gate_answered line, decision approved, of a run_cap gate - whenever that gate was requested); or
 *  (2) a raise the person STARTED after it and has not walked away from: a run_cap gate requested after the record, not by the session (requested_by absent = the terminal or the person's own dialog), that is still waiting (not declined, not expired).
 * A raise the SESSION opened (requested_by session) that was declined, expired or is still waiting is not the person's choice and does not set the record aside; if the person later approves it, (1) applies. This also binds a record to the ledger's raise, not to the stop file (project-writable).
 * `nowMs` decides whether a waiting gate has expired.
 */
/** The person's LATEST choice line (finish or finish_now) for this stop, whatever has happened since, or null. Pure. */
export const budgetFinishLatest = (lines, stopSha256) => { let last = null; for (const l of lines) if (l.event === 'budget_finish' && l.stop_sha256 === stopSha256) last = l; return last; };
/** The person's plain finish (choice finish) when it is their LATEST choice at the stop with this hash, or null. Pure (the arming of the ending uses the run-wide budgetPlainFinishOfRun). A raise approved after it does NOT set it aside: the raise is what lets the sitting run, and the ending it arms is the one the person asked for; only a later finish_now replaces it. */
/**
 * The plain finish that governs the RUN's ending, or null (pure). A plain finish is the person's choice to end the review rounds at the stage the run stopped before and read the final plan once more; a raise too small for what follows stops the run AGAIN (a new stop file, so another hash), and the rounds must still end at that same stage when the next raise comes -
 * the person must never pay for rounds they chose to end. So it is the latest `budget_finish` line of the run (a ledger is one run's) that governs: while it is a plain finish the ending is armed, whatever stop the run is at; a later finish_now replaces it. The line names the stage it was given at.
 */
export const budgetPlainFinishOfRun = lines => { let last = null; for (const l of lines) if (l.event === 'budget_finish') last = l; return last && last.choice === 'finish' ? last : null; };
/** The person's latest budget_finish line of the RUN (any stop), or null. Pure. */
export const budgetLatestOfRun = lines => { let last = null; for (const l of lines) if (l.event === 'budget_finish') last = l; return last; };
/** Whether a finish (plain or now) is the person's latest choice of the run, so a `continue` has something to go on past. Pure. */
export const budgetFinishStandsOfRun = lines => { const last = budgetLatestOfRun(lines); return !!last && (last.choice === 'finish' || last.choice === 'finish_now'); };
export const budgetPlainFinishOf = (lines, stopSha256) => { const last = budgetFinishLatest(lines, stopSha256); return last && last.choice === 'finish' ? last : null; };
export const budgetFinishOf = (lines, stopSha256, nowMs = Date.now()) => {
  const last = budgetFinishLatest(lines, stopSha256);
  if (!last || last.choice !== 'finish_now') return null;   // no record, or the person's latest choice at this stop is the plain finish: a finish-now does not stand
  const capGates = new Set(lines.filter(l => l.event === 'gate_requested' && l.kind === 'run_cap').map(l => l.gate));
  if (lines.some(l => l.event === 'gate_answered' && capGates.has(l.gate) && l.seq > last.seq && l.decision === 'approved')) return null;   // (1)
  for (const g of lines) {   // (2)
    if (g.event !== 'gate_requested' || g.kind !== 'run_cap' || g.seq <= last.seq || g.requested_by === 'session') continue;
    const answered = lines.some(a => a.event === 'gate_answered' && a.gate === g.gate);
    if (!answered && !(Number.isFinite(Date.parse(g.expires_at)) && nowMs >= Date.parse(g.expires_at))) return null;
  }
  return last;
};
// 0.8.4 S20 slice 1 (C&C's ruling, 4 Nov 2026): `cap_raise_closed` is THC's OWN determination that an APPROVED raise of a run's typed limit can never be consumed (its figure is not above what the run has counted, not above the limit the run has, or above the ceiling now in force):
// it references the approval it closes (the gate), names the case (`code`) and the reason, and is marked `by: "harness"`; it is never a person's answer and never relayed. The approval line is never rewritten. The chain check below refuses one that names an
// approval that does not exist before it, one not marked as the harness's, and a second one for the same gate. An older tool reads a ledger that holds it as broken (the same breaking-format sentence as the events above).
// 0.8.3 M6 typed cap T3 (14 Oct 2026): `cap_consumed` is the use event of a `run_cap` gate (the limit a person typed for one run); an older tool reads a ledger that holds it as "broken", the same breaking-format sentence as the events above.
// 0.8.4 D10 slice 2a: `excerpts_recorded` is the use event of an `excerpt_approval` gate (src/gate.js recordExcerptsRecorded): the pause wrote one row per excerpt from the person's answer. Single use; the second
// new kind of 0.8.4, covered by the same breaking-format sentence.
// 0.8.4 D10 (plan A T5.5): `excerpt_switch_on` records that a run was started or resumed with the privacy switch asked for (`--approve-excerpts`, or the chain's `approve_excerpts`). It is a setting THC recorded, not a person's
// answer (no actor, no channel, `approval: false`), written and read only by src/gate.js; an older tool reads a ledger that holds it as "broken", the same breaking-format sentence as the events above.
// The two gate events are written only by src/gate.js and the contract's lock and decision events only by src/contract-record.js (both through withLedger); everything else may append these.
// amend_requested is public on purpose: it is a request that decides nothing (the `contract_amend` tool appends it), and a person reads its words before a decision.
export const PUBLIC_EVENTS = Object.freeze(['sent', 'stopped', 'more_material_requested', 'amend_requested']);

export class LedgerBusyError extends Error {
  constructor(holder, lockPath) {
    super(`the gate ledger is being written (lock ${lockPath}, held by pid ${holder?.pid ?? 'unknown'}${holder?.host ? ` on ${holder.host}` : ''}). Try again; if no council process is running on this run, delete that lock file.`);
    this.code = 'gate_busy';
  }
}

export class LedgerWriteError extends Error {
  constructor(message) {
    super(message);
    this.code = 'gate_ledger_write_failed';
  }
}

export class LedgerCorruptError extends Error {
  constructor(verdict) {
    super(`the gate ledger is broken at line ${verdict.failedAt}: ${verdict.reason}`);
    this.code = 'gate_ledger_corrupt';
    this.verdict = verdict;
  }
}

export const sha256Hex = data => createHash('sha256').update(data).digest('hex');

// The gate kind of src/gate.js EXCERPT_APPROVAL_KIND, spelled here because this module cannot import the gate (test/excerpt-use-verifier.test.js pins the two to each other).
const EXCERPT_APPROVAL_KIND_NAME = 'excerpt_approval';
// -> null, or why an `excerpts_recorded` line does not belong at this point of the ledger (`before` = the lines already checked).
function excerptsRecordedProblem(line, before) {
  const asked = before.find(l => l.event === 'gate_requested' && l.gate === line.gate);
  if (!asked || asked.kind !== EXCERPT_APPROVAL_KIND_NAME) return `excerpts_recorded names ${JSON.stringify(line.gate)}, which no earlier line asked for as an ${EXCERPT_APPROVAL_KIND_NAME} gate`;
  if (!before.some(l => l.event === 'gate_answered' && l.gate === line.gate)) return `excerpts_recorded names ${line.gate}, which no earlier line answered`;
  if (before.some(l => l.event === 'excerpts_recorded' && l.gate === line.gate)) return `excerpts_recorded names ${line.gate} a second time: one answer covers one recording`;
  return null;
}

// Parses and checks the ledger's bytes. Pure: no file access.
export function parseLedger(buf) {
  const lines = [];
  let offset = 0;          // byte offset just after the last complete, good line
  let prev = null;
  let i = 0;
  while (offset < buf.length) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl === -1) return { ok: true, lines, torn: true, goodBytes: offset, lastSha: prev };
    const raw = buf.subarray(offset, nl);
    i += 1;
    let line;
    try { line = JSON.parse(raw.toString('utf8')); } catch { return { ok: false, lines, failedAt: i, reason: 'the line is not JSON', goodBytes: offset }; }
    if (!line || typeof line !== 'object' || Array.isArray(line)) return { ok: false, lines, failedAt: i, reason: 'the line is not an object', goodBytes: offset };
    if (line.schema !== LEDGER_SCHEMA) return { ok: false, lines, failedAt: i, reason: `schema is not ${LEDGER_SCHEMA}`, goodBytes: offset };
    if (line.seq !== i) return { ok: false, lines, failedAt: i, reason: `seq is ${JSON.stringify(line.seq)}, expected ${i}`, goodBytes: offset };
    if (line.prev !== prev) return { ok: false, lines, failedAt: i, reason: 'prev does not match the sha256 of the line before', goodBytes: offset };
    if (!EVENTS.includes(line.event)) return { ok: false, lines, failedAt: i, reason: `unknown event ${JSON.stringify(line.event)}`, goodBytes: offset };
    if (line.event === 'cap_raise_closed') {
      if (!lines.some(l => l.event === 'gate_answered' && l.gate === line.gate && l.decision === 'approved')) return { ok: false, lines, failedAt: i, reason: `cap_raise_closed names gate ${JSON.stringify(line.gate)}, which has no approval before it`, goodBytes: offset };
      if (line.by !== 'harness') return { ok: false, lines, failedAt: i, reason: 'cap_raise_closed is not marked as the harness\'s own determination', goodBytes: offset };
      if (lines.some(l => l.event === 'cap_raise_closed' && l.gate === line.gate)) return { ok: false, lines, failedAt: i, reason: `cap_raise_closed closes gate ${JSON.stringify(line.gate)} a second time`, goodBytes: offset };
    }
    if (line.event === 'stop_answer_closed') {   // 0.8.4 (C&C 10 Nov): THC's own determination that an answered stop_decision gate was not taken by the run (the resume did not start, or the command line refused the number): the answer is closed and never consumed later
      if (!lines.some(l => l.event === 'gate_answered' && l.gate === line.gate && l.decision === 'approved')) return { ok: false, lines, failedAt: i, reason: `stop_answer_closed names gate ${JSON.stringify(line.gate)}, which has no approval before it`, goodBytes: offset };
      if (line.by !== 'harness') return { ok: false, lines, failedAt: i, reason: 'stop_answer_closed is not marked as the harness\'s own determination', goodBytes: offset };
      if (lines.some(l => l.event === 'stop_answer_closed' && l.gate === line.gate)) return { ok: false, lines, failedAt: i, reason: `stop_answer_closed closes gate ${JSON.stringify(line.gate)} a second time`, goodBytes: offset };
    }
    if (line.event === 'route_requested' || line.event === 'route_decided') {
      const problem = routeLineProblem(line, lines);
      if (problem) return { ok: false, lines, failedAt: i, reason: `${line.event}: ${problem.message}`, goodBytes: offset };
    }
    if (line.event === 'budget_finish') {
      const problem = budgetFinishLineProblem(line, lines);
      if (problem) return { ok: false, lines, failedAt: i, reason: `${line.event}: ${problem.message}`, goodBytes: offset };
    }
    if (line.event === 'pause_requested' || line.event === 'pause_taken' || line.event === 'pause_lapsed' || line.event === 'pause_finished') {
      const problem = pauseLineProblem(line, lines);
      if (problem) return { ok: false, lines, failedAt: i, reason: `${line.event}: ${problem.message}`, goodBytes: offset };
    }
    // 0.8.4 D10 slice 2c: a use line of an excerpt_approval gate is believed only after the gate it names was asked for AS an excerpt_approval gate, was answered, and was not used before. The run refuses to go on while such a gate
    // has no use line, so a forged `excerpts_recorded` line (the chain is tamper-evident, not tamper-proof) would otherwise let a resume walk past the person's approval; here it breaks the ledger instead, for every reader.
    if (line.event === 'excerpts_recorded') {
      const why = excerptsRecordedProblem(line, lines);
      if (why) return { ok: false, lines, failedAt: i, reason: why, goodBytes: offset };
    }
    lines.push(line);
    prev = sha256Hex(raw);
    offset = nl + 1;
  }
  return { ok: true, lines, torn: false, goodBytes: offset, lastSha: prev };
}

/** The ledger as data, checked. A missing ledger is an empty, valid one (`missing: true`). Never writes. */
export function readLedger(runDir) {
  const path = join(runDir, LEDGER_FILE);
  let buf;
  try { buf = readFileSync(path); } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, missing: true, lines: [], torn: false };
    // Exists but cannot be read: fail closed, never "no events".
    return { ok: false, missing: false, lines: [], torn: false, failedAt: 0, reason: `cannot read the ledger (${err.code})` };
  }
  const { goodBytes, lastSha, ...verdict } = parseLedger(buf);
  return { missing: false, ...verdict };
}

export const verifyLedger = readLedger;

const RESERVED = ['schema', 'seq', 'prev', 'ts', 'event'];

// A holder keeps the lock for one read, one write and one fsync (milliseconds), so a second writer waits
// rather than failing: two answers to one gate then end as one answer and one gate_not_pending, and a
// `sent` line is not lost to a terminal answering at the same moment. Two seconds is far above any
// holder's time on a local disk and far below the 30 s hold of a tool call (DR-6); past it the lock's
// holder is taken to be stuck and the writer gets gate_busy. A dead holder's lock is taken over at once.
const LOCK_WAIT_MS = 2000;
const UNREADABLE_LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 10;
const SLEEPER = new Int32Array(new SharedArrayBuffer(4)); // a synchronous sleep; the writers are synchronous

function lineFor(seq, prev, ts, event, fields) {
  // Fixed key order by construction, so a golden ledger is byte-stable.
  return `${JSON.stringify({ schema: LEDGER_SCHEMA, seq, prev, ts, event, ...fields })}\n`;
}

/**
 * Holds the run's ledger lock, re-reads the ledger, and calls fn({ lines, append }). append(event, fields)
 * writes one whole line with one write() and fsyncs it, after cutting a torn tail away. Throws
 * LedgerBusyError when another live process holds the lock and LedgerCorruptError on a mid-file break
 * (nothing is appended to a broken ledger). `now` is injectable for golden fixtures.
 */
export function withLedger(runDir, fn, { now = () => Date.now(), waitMs = LOCK_WAIT_MS } = {}) {
  let release;
  for (const deadline = Date.now() + waitMs; ;) {
    try { release = acquireRunLock(runDir, { file: LEDGER_LOCK_FILE, unreadableStaleMs: UNREADABLE_LOCK_STALE_MS }); break; } catch (err) {
      if (!(err instanceof RunLockedError)) throw err;
      if (Date.now() >= deadline) throw new LedgerBusyError(err.holder, join(runDir, LEDGER_LOCK_FILE));
      Atomics.wait(SLEEPER, 0, 0, LOCK_RETRY_MS);
    }
  }
  try {
    const path = join(runDir, LEDGER_FILE);
    let buf;
    try { buf = readFileSync(path); } catch (err) {
      if (err.code !== 'ENOENT') throw new LedgerCorruptError({ failedAt: 0, reason: `cannot read the ledger (${err.code})` });
      buf = Buffer.alloc(0);
    }
    const parsed = parseLedger(buf);
    if (!parsed.ok) throw new LedgerCorruptError(parsed);
    const lines = parsed.lines;
    let goodBytes = parsed.goodBytes;
    let prev = parsed.lastSha;
    const append = (event, fields = {}) => {
      if (!EVENTS.includes(event)) throw new Error(`gate ledger: unknown event ${JSON.stringify(event)}`);
      const clash = RESERVED.filter(k => Object.hasOwn(fields, k));
      if (clash.length) throw new Error(`gate ledger: ${clash.join(', ')} are set by the ledger, not by the caller`);
      const text = lineFor(lines.length + 1, prev, new Date(now()).toISOString(), event, fields);
      const fd = openSync(path, existsSync(path) ? 'r+' : 'w');
      try {
        const size = fstatSync(fd).size;
        // Shorter than what was read under this same lock: something else cut the file. Never pad it.
        if (size < goodBytes) throw new LedgerCorruptError({ failedAt: lines.length, reason: 'the ledger got shorter while it was locked' });
        if (size > goodBytes) ftruncateSync(fd, goodBytes); // cut a torn tail
        const bytes = Buffer.from(text, 'utf8');
        const wrote = writeSync(fd, bytes, 0, bytes.length, goodBytes);
        // A short write leaves a torn tail, which the next reader ignores; this append did not happen.
        if (wrote !== bytes.length) throw new LedgerWriteError(`the ledger write stopped after ${wrote} of ${bytes.length} bytes`);
        fsyncSync(fd);
        goodBytes += bytes.length;
        prev = sha256Hex(bytes.subarray(0, bytes.length - 1));
      } finally { closeSync(fd); }
      const line = JSON.parse(text);
      lines.push(line);
      return line;
    };
    return fn({ lines, append });
  } finally {
    release();
  }
}

/** Appends one of PUBLIC_EVENTS. The gate events go through src/gate.js only. */
export function appendEvent(runDir, event, fields = {}, opts = {}) {
  if (!PUBLIC_EVENTS.includes(event)) throw new Error(`gate ledger: ${JSON.stringify(event)} is not an event this function writes (gate events are written by src/gate.js)`);
  return withLedger(runDir, ({ append }) => append(event, fields), opts);
}
