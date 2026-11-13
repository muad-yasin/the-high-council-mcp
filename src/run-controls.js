// THE RUN CONTROLS' ONE INTERFACE (0.8.4, S20 slice 1: control 2, the raise of the typed spending limit at any resume; the person's ruling joins it in slice 2). Every surface calls THIS module and no other to record an answer
// to a raise: the terminal (src/gate-cli.js), the window inside Claude Code (src/send-path.js answerCapGate, channel elicitation), the handler session's relay at a terminal (src/gate-relay-cli.js) and its relay over MCP (src/mcp/server.js relayFlow, through relayRaise). RU-S20-09 to 11 hold here.
// Control 'ruling' (S20 slice 2): the person's ruling and its withdrawal are answered here too, from the terminal (src/gate-cli.js) and the handler's relay (src/gate-relay-cli.js); the window takes none of them.
//   - the PERSON types the figure (channel cli | elicitation), or the handler RELAYS the person's quoted words (channel session) and the figure must appear in them;
//   - a session never chooses, defaults or suggests a figure: the figure is a required argument with no default, a person channel takes no words, the session channel takes only the person's words;
//   - the record says typed or relayed (the ledger's channel) and who relayed it; the old and the new total per cap are READ from the ledger (controlHistory), never stored twice.
// The writers underneath are src/gate.js's (answerGate, answerGateAsRelay: the hash-chained ledger, accepted code); this module adds no ledger field.
//
// Contract (no I/O of its own beyond reading the run folder's gate ledger through src/gate.js and, for the approval of a ruling, the run folder's file names):
//   isRaiseGate(gate)                 -> boolean   a run_cap gate whose operation is `raise`
//   isRulingGate(gate), RULING_KINDS  -> the gate kinds of control `ruling` (ruling, ruling_withdrawal); an approval is refused when the pass the gate is dated at already has a stage on disk (stalePassRefusal); channels cli and session only
//   answerControl(runDir, gateId, { control: 'raise' | 'ruling', channel, decision = 'approved', shownSha256, typedCap, personWords, reason, actor, tty, client }, opts)
//        -> { ok: true, status, seq, warning? } | { ok: false, code, message }.  `control` 'raise': the gate must be a raise gate; `typedCap` (the figure as the person typed it) is required to approve and has no default.
//   relayRaise(runDir, gateId, { shownSha256, reason, personWords, typedCap }, opts) -> as answerControl   the ONE recorder of a relayed raise (the session channel), called by answerControl and by the MCP relay; `reason` and `typedCap` are required, no default
//   RELAY_REASON                      the reason sentence both relays record (and the reason of a route decision that is the person's): defined in src/gate-ledger.js, re-exported by src/gate.js and from here; the terminal relay (src/gate-relay-cli.js) and the MCP relay (src/mcp/server.js) import it from here, and test/mcp-resume-relay.test.js RELAY-11 pins that the terminal relay carries no copy
//   controlHistory(runDir, 'raise')   -> { ok, raises: [{ gate, cap_name, requested_by, channel, actor, person_words, client_name, client_version, old_usd, new_usd, answered_at, consumed, consumed_at, closed? }] } oldest first;
//        `old_usd` is the previous consumption of the SAME cap (null: none before), `new_usd` the figure answered; `consumed` false for an answer the run never used; `closed` ({ code, reason, at }) is present when THC closed it in the record because it could never be used (src/gate.js closeRaiseApproval, the ledger's `cap_raise_closed`). { ok: false, raises: [] } when the ledger cannot be read.
//   raiseVerdict({ answer, floorUsd, ceiling, previousCapUsd, requireAboveCurrent }) -> null | { code, message }   the one rule for "can this answered raise be used": the ceiling now in force, the counted spend (the floor) and,
//        for an explicit raise (--raise-cap), the limit the run has now (R3b: a typed total at a budget stop with NO --raise-cap may still be below the old limit).
//   (the refusal of the raise flags lives in src/raise-flags.js: CLI flag logic, no gate import)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roundStopPhraseOf, stopOffersContinue } from './overseer-rounds.js';
// 0.8.4 S5 U-C1 fix-up 3: the stop a run waits at, from report-partial.json (report-shape.js owns the name; it is not imported here because it pulls chain.js into this floor module). null unless it reads and carries an integer pass and overseer_round (the same rule as tree-choice.js readStopOfRun).
export const stopOfPartial = runDir => { try { const s = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8'))?.stop; return s && typeof s === 'object' && !Array.isArray(s) && typeof s.kind === 'string' && Number.isInteger(s.pass) && Number.isInteger(s.overseer_round) ? s : null; } catch { return null; } };
import { hostname } from 'node:os';
import { RELAY_REASON, pauseFinishRelayedFromLedger, recordPauseRequest, recordPauseSettled, pauseStateOf, recordRouteRequest, recordRouteDecision, routeControlsOf, raiseAnswersOf, readGateAnswer, readGateText, textSha256, sessionOwnerRefusalOf, answerGate, answerGateAsRelay, RUN_CAP_KIND, RULING_KIND, RULING_WITHDRAWAL_KIND, SESSION_CHANNEL, STOP_DECISION_KIND } from './gate.js';
import { parseRulingGateText, parseWithdrawalGateText } from './rulings.js';
import { stagesOfPass, pauseBefore, PASS_STAGE_FAMILIES } from './ladder-steps.js';
import { readStoppedMarker, isRoundStop } from './stop-files.js';
import { routeLayerRefusal } from './route-layer.js';
import { earlyFinishEligible, earlyFinishProposedAfter } from './early-finish-eligible.js';
import { acquireRunLock, RunLockedError, lockHolder } from './run-lock.js';
import { formatUsd } from './cost.js';

export const RAISE = 'raise';
// The reason a relayed answer carries in the record: ONE sentence for the terminal relay (src/gate-relay-cli.js) and the MCP relay (src/mcp/server.js, which calls relayRaise below). It is defined in src/gate-ledger.js, where the chain check of a route decision needs it, re-exported by src/gate.js (the only gate module this file may import) and from here, so every importer stays as it was.
export { RELAY_REASON } from './gate.js';
export const isRaiseGate = gate => gate?.kind === RUN_CAP_KIND && gate.cap?.operation === RAISE;
// Control 3 (S20 slice 2, step 3.1): the person's ruling and its withdrawal are gates of two kinds, answered through the same interface. The raise path above is unchanged.
export const RULING = 'ruling';
export const RULING_KINDS = Object.freeze([RULING_KIND, RULING_WITHDRAWAL_KIND]);
export const isRulingGate = gate => RULING_KINDS.includes(gate?.kind);

const refuse = (code, message) => ({ ok: false, code, message });

export function answerControl(runDir, gateId, { control = RAISE, channel, decision = 'approved', shownSha256, typedCap, personWords, reason, actor = null, tty = null, client } = {}, opts = {}) {
  if (control === RULING) return answerRuling(runDir, gateId, { channel, decision, shownSha256, personWords, reason, actor, tty }, opts);
  if (control !== RAISE) return refuse('unknown_control', `run control "${control}" is not one this program has. Nothing was recorded.`);   // A-DRAFT
  const state = readGateAnswer(runDir, gateId, opts);
  if (!state.gate) return refuse(state.reason ?? 'gate_not_found', `gate ${gateId} cannot be read (${state.reason ?? 'gate_not_found'}). Nothing was recorded.`);   // A-DRAFT
  if (!isRaiseGate(state.gate)) return refuse('not_a_raise_gate', `gate ${gateId} is not a request to raise a run's spending limit. Nothing was recorded.`);   // A-DRAFT
  if (channel === SESSION_CHANNEL) {
    if (decision !== 'approved') return refuse('session_cannot_decline', 'only the person declines a spending limit. Nothing was recorded.');   // A-DRAFT
    return relayRaise(runDir, gateId, { shownSha256, reason, personWords, typedCap }, opts);
  }
  if (channel !== 'cli' && channel !== 'elicitation') return refuse('channel_not_allowed', `a raise is answered by the person (cli or elicitation) or relayed by the session (${SESSION_CHANNEL}). Nothing was recorded.`);   // A-DRAFT
  if (personWords !== undefined) return refuse('person_words_not_for_person', 'the person types the figure; words are taken only from a relay. Nothing was recorded.');   // A-DRAFT
  // a person channel carries the figure the person typed; it is never supplied here. An empty or unreadable one is gate.js's own refusal (its sentence, which the dialog and the terminal show).
  if (decision === 'approved' && typedCap === undefined) return refuse('figure_required', 'a raise needs the figure the person typed; there is no default. Nothing was recorded.');   // A-DRAFT
  const typed = decision === 'approved' ? { typedCap: String(typedCap) } : {};
  // the channel is passed as a literal on each branch (test/gate-answer.test.js R4): the terminal and the client's dialog are the two channels a person uses
  if (channel === 'cli') return answerGate(runDir, gateId, { channel: 'cli', shownSha256, decision, actor, tty, ...typed }, opts);
  return answerGate(runDir, gateId, { channel: 'elicitation', shownSha256, decision, actor, tty, ...typed, ...(decision === 'approved' && client ? { client } : {}) }, opts);
}

/**
 * The ONE recorder of a relayed raise (the session channel): the handler session says the person gave this figure, with the person's words (the figure must appear in them, gate.js). Called by answerControl for the terminal relay and by the MCP relay
 * (src/mcp/server.js relayFlow, H10), which therefore passes no channel of its own. A session never chooses, defaults or suggests a figure: it is required, and so is the written reason (gate.js refuses an answer without one; RELAY_REASON is the sentence both relays use). -> as answerControl.
 */
export function relayRaise(runDir, gateId, { shownSha256, reason, personWords, typedCap } = {}, opts = {}) {
  const state = readGateAnswer(runDir, gateId, opts);
  if (!state.gate) return refuse(state.reason ?? 'gate_not_found', `gate ${gateId} cannot be read (${state.reason ?? 'gate_not_found'}). Nothing was recorded.`);   // A-DRAFT
  if (!isRaiseGate(state.gate)) return refuse('not_a_raise_gate', `gate ${gateId} is not a request to raise a run's spending limit. Nothing was recorded.`);   // A-DRAFT
  if (typedCap === undefined || String(typedCap).trim() === '') return refuse('figure_required', 'a raise needs the figure the person typed; the session does not choose or suggest one. Nothing was recorded.');   // A-DRAFT
  return answerGateAsRelay(runDir, gateId, { shownSha256, reason, personWords, typedCap: String(typedCap) }, opts);
}

/**
 * The pass a ruling or a withdrawal is dated at, read from its gate text; null when the text is not exactly that shape, undefined when the file is no longer the text that was shown. The pass is FIXED in the text when the request is made.
 */
function passOfRulingGate(runDir, gate) {
  const bytes = readGateText(runDir, gate.text);
  if (!bytes || textSha256(bytes) !== gate.sha256) return undefined;   // the file changed since it was shown (or is gone): no opinion here, gate.js answers hash_mismatch
  const parsed = gate.kind === RULING_KIND ? parseRulingGateText(bytes) : gate.kind === RULING_WITHDRAWAL_KIND ? parseWithdrawalGateText(bytes) : null;
  return parsed ? parsed.pass : null;
}

/**
 * Step 3.1 (money): can this ruling or withdrawal still be approved? Not when the pass it is dated at already has a stage on disk: the stage was asked without it, and a prompt that now carries it differs, so the next resume pays for that stage a second time.
 * Read at the moment of approval, for every caller (the terminal, the relay). null = fine, else { code, message }. It is NOT atomic with the run's own file writes (the run does not take the ledger lock), and it does not look at the run lock: a live run is not refused here
 * (a ruling made while pass N runs is to be dated at pass N+1, which this check then lets through; that dating is a later step). A stage file appears only after a paid reply, so between a pass's first send and its first reply no file exists to be seen.
 */
export function stalePassRefusal(runDir, gate) {
  const pass = passOfRulingGate(runDir, gate);
  if (pass === undefined) return null;
  const what = gate.kind === RULING_KIND ? 'a ruling' : 'a withdrawal';
  if (pass === null) return { code: 'gate_text_unreadable', message: `the text of this gate is not exactly ${what}, so it cannot be approved. Nothing was recorded.` };   // A-DRAFT
  const on = stagesOfPass(readdirSync(runDir), pass);
  if (on.length) return { code: 'pass_has_stages', message: `pass ${pass} already has a stage on disk (${on[0]}), so ${what} for it would change what that stage was asked. Nothing was recorded.` };   // A-DRAFT, the relay's own sentence
  return null;
}

/** Control 'ruling': the terminal (channel cli) approves or declines; the handler session (channel session) relays the person's permission with their words and a written reason. No window exists for these gates. */
function answerRuling(runDir, gateId, { channel, decision = 'approved', shownSha256, personWords, reason, actor = null, tty = null }, opts) {
  const state = readGateAnswer(runDir, gateId, opts);
  if (!state.gate) return refuse(state.reason ?? 'gate_not_found', `gate ${gateId} cannot be read (${state.reason ?? 'gate_not_found'}). Nothing was recorded.`);   // A-DRAFT
  if (!isRulingGate(state.gate)) return refuse('not_a_ruling_gate', `gate ${gateId} is not a ruling or a withdrawal. Nothing was recorded.`);   // A-DRAFT
  if (channel !== 'cli' && channel !== SESSION_CHANNEL) return refuse('channel_not_allowed', `a ruling is answered by the person at a terminal (cli) or relayed by the session (${SESSION_CHANNEL}); there is no window for it. Nothing was recorded.`);   // A-DRAFT
  if (channel === SESSION_CHANNEL && decision !== 'approved') return refuse('session_cannot_decline', 'only the person declines a ruling. Nothing was recorded.');   // A-DRAFT
  // a gate a PERSON asked for is not the session's to answer, whatever else is true of it: asked first, so the reason a person reads does not depend on timing
  if (channel === SESSION_CHANNEL) { const own = sessionOwnerRefusalOf(runDir, gateId); if (own) return own; }
  // a decline is never stage-checked (a person can always say no); only an approval of a gate that still waits is
  if (decision === 'approved' && state.status === 'pending') { const stale = stalePassRefusal(runDir, state.gate); if (stale) return refuse(stale.code, stale.message); }   // only for the text that was shown: a changed file is gate.js's own hash_mismatch, as before
  if (channel === SESSION_CHANNEL) return answerGateAsRelay(runDir, gateId, { shownSha256, reason, personWords }, opts);
  if (personWords !== undefined) return refuse('person_words_not_for_person', 'the person answers at the terminal themselves; words are taken only from a relay. Nothing was recorded.');   // A-DRAFT
  // the channel is a literal (test/gate-answer.test.js R4): the terminal is the one channel a person has for these gates
  return answerGate(runDir, gateId, { channel: 'cli', shownSha256, decision, actor, tty }, opts);
}

const microToUsd = m => (Number.isFinite(m) ? m / 1e6 : null);

export function controlHistory(runDir, control = RAISE) {
  if (control !== RAISE) return { ok: false, raises: [] };
  const { ok, rows } = raiseAnswersOf(runDir);
  // the ledger's own channel values (cli, elicitation, session), carried as they are: this is a formatter over the gate's vocabulary, not a mapping
  return { ok, raises: rows.map(({ cap_micro_usd, cap_usd, used_at, prior_micro_usd, answered_at, ...r }) => ({ ...r, old_usd: microToUsd(prior_micro_usd), new_usd: microToUsd(cap_micro_usd), answered_at, consumed: used_at !== null, consumed_at: used_at })) };
}

/**
 * Can this answered raise be used now? null when yes; else { code, reason, message }: `reason` is the clause that says why (the printed sentence for a run that GOES ON under its limit builds on it), `message` is `${reason}, so it was not used. Nothing was started.`
 * byte for byte as src/start-cap.js had it, for the case where the resume WAITS for a new answer (nothing started). An approved raise that fails the rule is CLOSED in the record by src/start-cap.js (the ledger's `cap_raise_closed`); the approval line itself stays. A-DRAFT.
 */
export function raiseVerdict({ answer, floorUsd = 0, ceiling = null, previousCapUsd = null, requireAboveCurrent = false }) {
  const usd = Number(answer?.cap_usd);
  const floorMicro = Number.isFinite(floorUsd) && floorUsd > 0 ? Math.ceil(floorUsd * 1e6) : 0;
  const no = (code, reason) => ({ code, reason, message: `${reason}, so it was not used. Nothing was started.` });
  if (ceiling && usd > ceiling.usd) return no('above_ceiling_now', `the limit typed for this run (${formatUsd(usd)}) is above the ceiling now in force (${formatUsd(ceiling.usd)}, set by ${ceiling.source})`);
  if (floorMicro > 0 && answer.cap_micro_usd <= floorMicro) return no('below_floor', `the limit typed for this run (${formatUsd(usd)}) is not above what the run has already counted (${formatUsd(floorUsd)})`);
  if (requireAboveCurrent && previousCapUsd !== null && usd <= previousCapUsd) return no('not_above_current', `the limit typed for this run (${formatUsd(usd)}) is not above the limit it has now (${formatUsd(previousCapUsd)})`);
  return null;
}

// ---- Control 1 (S20 slice 2): route the next pass to layer 3. The flag (src/cli.js) and the verb `council route-decide` (src/gate-relay-cli.js) both go through these; the ledger writers are src/gate.js's. ----
/**
 * Can the next pass of this run be routed to layer 3 NOW? -> { ok: true, pass } | { ok: false, code, message } where `message` is the REASON only (each caller adds its own frame and "Nothing was recorded"). The order is the order the flag
 * always refused in: a chain that is not a unanimous layered panel or has no layer 3, a round-limit stop, a pause that is not at a revise, the ladder's credit (a run under the ladder only), a stage already on disk for the pass, the early-finish proposal, N7 (src/route-layer.js: the pass that just ended was not objected to from layer 2 or above) and last that the pass that just ended was answered with a revision.
 * `ladder` is the ladder in force (typed on the command, else run.json's), or null: the control works on any layered chain with a layer 3 (0.8.4 S4, D27 option 1e), not only under the ladder; `config` the run's chain (seats resolved).
 */
export function routeRefusal(runDir, { ladder, config }) {
  const no = (code, message) => ({ ok: false, code, message });
  // The condition under which chain.js reads a routed step at all: a layered chain (every critic has a layer) with "signoff": "unanimous" (the step is read in that loop only) and a layer 3. A route recorded for a chain that fails it could never be undone and would be ignored.
  const critics = config?.seats?.critics || [];
  if (!critics.length || !critics.every(c => c.layer !== undefined) || config?.signoff !== 'unanimous') return no('route_not_layered', 'this chain is not a layered panel with "signoff": "unanimous", so it has no pass that can start at a layer.');   // A-DRAFT
  if (!critics.some(c => c.layer === 3)) return no('route_no_layer_3', 'this chain has no layer 3, so there is no layer to start a pass at.');   // A-DRAFT
  const stop = readStoppedMarker(runDir);
  if (stop && isRoundStop(stop.stoppedBy)) { const at = stopOfPartial(runDir) ?? { kind: stop.stoppedBy }; return no('route_round_stop', `this run is stopped ${roundStopPhraseOf(at)}, and waits for ${stopOffersContinue(at) ? '--continue or --finish' : '--finish (no pass is left, so there is no --continue)'}; answer that first.`); }   // A-DRAFT; any other stop is judged by the pending pause below
  const files = readdirSync(runDir);
  const paused = pausePointOf(runDir, files);   // a revise pause, or a run the owner's pause stopped (#16c)
  if (!paused.ok) return no('route_not_at_revise', paused.why === 'pending' ? `the run waits for an answer to ${paused.label}; give that first.` : 'the run is not at a revise pause, so there is no next pass to change.');   // A-DRAFT
  if (ladder && paused.pass <= ladder.credit) return no('route_credit', `pass ${paused.pass} is one of the first ${ladder.credit} passes, the ladder's credit, which run under the plain rules and not the ladder; so it has no first layer to change.`);   // A-DRAFT
  const on = stagesOfPass(files, paused.pass);
  if (on.length) return no('route_pass_has_stages', `pass ${paused.pass} already has a stage on disk (${on[0]}), so starting the pass at layer 3 would change what that stage was asked.`);   // A-DRAFT
  // The session proposed to finish early in its answer to the pass that just ended, and that proposal is acted on (both held sentences recorded): the next pass then asks the overseer layer alone, so a route would decide the same thing a second way. A route is always the second act (it needs the revise answered, and the proposal is in that answer), so it is the one refused.
  if (earlyFinishEligible(config) && earlyFinishProposedAfter(runDir, files, paused.pass - 1)) return no('route_after_early_finish', `the session proposed to finish early in its answer to pass ${paused.pass - 1}, so pass ${paused.pass} asks the overseer layer alone whether to finish; it cannot also be started at layer 3.`);   // A-DRAFT
  const layer = routeLayerRefusal(config, files, paused.pass);
  if (layer) return no(layer.code, layer.message);
  // A pass that ended WITHOUT a revision (an external reviser's answer, or a model reviser's stage, is `revise-<pass>.md`, or `-full`): a stall go-up (which makes no revise and leaves a stall escalation in force for the next pass), or a re-ask of the same draft (a lone-heard judge, a seat not heard).
  // No revised plan follows it, and a recorded route cannot be withdrawn, so the route is refused here instead of colliding with the escalation or skipping the layer where a judge was not heard. After N7's check on purpose: N7 names the more specific reasons.
  const ended = paused.pass - 1;
  if (!files.includes(`revise-${ended}.md`) && !files.includes(`revise-${ended}-full.md`)) return no('route_not_after_revision', `pass ${ended} was not answered with a revision (the plan went up a layer, or the same draft is asked again), so pass ${paused.pass} has no revised plan to start at layer 3.`);   // A-DRAFT
  return { ok: true, pass: paused.pass };
}

/**
 * The PERSON asked (the flag at the terminal, channel cli; the MCP relay later, channel session with his words) for the next pass to start at layer 3: records ONE `route_requested` and decides nothing. It takes the run lock, re-runs the refusals UNDER it
 * (so the state it records against cannot change between the check and the write: a live run refuses with `run_locked`), appends, and releases. Nothing is run and nothing is spent. -> { ok: true, seq, pass } | { ok: false, code, message }.
 */
export function requestRoute(runDir, { channel = 'cli', personWords = null, ladder, config } = {}, opts = {}) {
  let release;
  try { release = acquireRunLock(runDir); } catch (err) {
    if (err instanceof RunLockedError) return refuse('run_locked', err.message);
    throw err;
  }
  try {
    const may = routeRefusal(runDir, { ladder, config });
    if (!may.ok) return may;
    const res = recordRouteRequest(runDir, { pass: may.pass, channel, personWords }, opts);
    return res.ok ? { ...res, pass: may.pass } : res;
  } finally { release(); }
}

/**
 * The flag's one entry (R2-tty, Mini-C&C R417 and R418): WHO is asking decides the channel. `personWords` given = the handler session relays the person's request, channel session, the words recorded as typed (the line itself says it was relayed; a route request has no reason of
 * its own). Nothing given = the PERSON at the terminal, channel cli, and only when stdin and stdout are BOTH a terminal: read off the streams given, never off a setting or the environment (src/gate-cli.js answerAtTerminal; `council pause` does the same), so a handler session
 * cannot be recorded as the person. Without a terminal it refuses before the run lock is taken or anything is looked up, writing nothing. -> as requestRoute, plus code `route_request_needs_terminal`.
 */
export function askRoute(runDir, { personWords = null, stdin = process.stdin, stdout = process.stdout, ladder, config } = {}, opts = {}) {
  const relayed = typeof personWords === 'string';
  if (relayed && personWords.trim() === '') return refuse('route_person_words_missing', '--person-words needs the person\'s words after it, as the person typed them.');   // A-DRAFT (a missing value reaches here as an empty one)
  if (!relayed && (!stdin?.isTTY || !stdout?.isTTY)) return refuse('route_request_needs_terminal', 'a request typed by the person needs a person at a terminal: stdin and stdout must both be a terminal. A handler session gives the person\'s answer with --person-words "<their answer>".');   // A-DRAFT
  const channel = relayed ? 'session' : 'cli';   // (shorthand on purpose: test/gate-answer.test.js scans every file that names answerGate for a key named channel followed by a colon)
  return requestRoute(runDir, { channel, personWords: relayed ? personWords : null, ladder, config }, opts);
}

/**
 * The HANDLER decides (or the person did and the handler carries it out: `personWords` given). `decision` 'routed' | 'declined'. A routed decision is refused wherever the flag is (routeRefusal, N7 included) and when its request is for another pass than the
 * run's next one; a decline is not (it closes a request and changes nothing). The reason is the handler's own for a decision that is the handler's, and RELAY_REASON for one that is the person's (the person types no reason). NO run lock is taken: between
 * these checks and the write a live run could write the pass's first stage file (a named gap; it closes at Q9(b)). -> { ok: true, seq, pass } | { ok: false, code, message }.
 */
export function decideRoute(runDir, { requestSeq = null, decision, personWords = null, reason, ladder, config } = {}, opts = {}) {
  const decidedBy = personWords === null || personWords === undefined ? 'handler' : 'person';
  if (decidedBy === 'person' && reason !== undefined && reason !== null) return refuse('reason_not_for_person', 'a decision that is the person\'s carries no reason of its own: the person types none, and the line carries the relay sentence.');   // A-DRAFT
  let pass = null;
  if (requestSeq !== null) {
    const row = routeControlsOf(runDir).controls.find(c => c.request?.seq === requestSeq);
    if (!row) return refuse('route_request_not_found', `request ${requestSeq} is not a route request in this run's record.`);   // A-DRAFT (the ledger's own sentence)
    pass = row.pass;
  } else if (decision !== 'routed') {
    return refuse('route_decline_needs_request', 'only a request can be declined: a decision with no request is a route.');   // A-DRAFT (the ledger's own sentence)
  }
  if (decision === 'routed') {
    const may = routeRefusal(runDir, { ladder, config });
    if (!may.ok) return may;
    if (pass !== null && pass !== may.pass) return refuse('route_pass_mismatch', `request ${requestSeq} is for pass ${pass}, but the run's next pass is ${may.pass}.`);   // A-DRAFT
    pass = may.pass;
  }
  const res = recordRouteDecision(runDir, { requestSeq, pass, decision, decidedBy, personWords: decidedBy === 'person' ? personWords : null, reason: decidedBy === 'person' ? RELAY_REASON : reason }, opts);
  return res.ok ? { ...res, pass } : res;
}

/**
 * The steps the chain starts a pass at layer 3 by, DERIVED from the ledger's routed decisions (there is no second copy in run.json): [{ pass, floor: 3, at: <the decision's time>, via: 'ledger' }], the shape chain.js reads (stepOf).
 * -> { ok: true, steps } | { ok: false, steps: [] } when the ledger cannot be read (a missing ledger is an empty one).
 */
export function routedStepsOf(runDir) {
  const r = routeControlsOf(runDir);
  if (!r.ok) return { ok: false, steps: [] };
  return { ok: true, steps: r.controls.filter(c => c.decision?.decision === 'routed').map(c => ({ pass: c.pass, floor: 3, at: c.decision.at, via: 'ledger' })) };
}

/**
 * The rows report.json's `run_controls[]` lists: every route request and route decision of the run, read from the gate ledger when the report is written (never recorded anywhere else), oldest first: [{ pass, request, decision }] with `request` null for the handler's own route
 * and `decision` null for a request nobody has decided (it is never dropped). [] when there is none or the ledger cannot be read (a report never fails on it; a run with an unreadable ledger was refused at its start).
 */
export function runControlsOf(runDir) {
  const r = routeControlsOf(runDir);
  if (!r.ok) return [];
  // R420: a request the handler session RELAYED (the ledger's channel is session, nothing else is read) carries the relay sentence in the report row, derived here and not recorded: a route request line has no reason of its own. The sentence is RELAY_REASON's, the one a decision and a raise carry.
  return r.controls.map(c => (c.request && c.request.channel === 'session' ? { ...c, request: { ...c.request, reason: RELAY_REASON } } : c));
}

// ---- The owner's "pause after this round" (0.8.4 S20 slice 2, #16c; the ledger kinds are src/gate.js's, the stop cause src/owner-pause.js and src/stop-files.js). The VERB `council pause` (src/gate-relay-cli.js) and the CLI's resume go through these. ----
/** The highest pass that has a stage file on disk (0 when none): the pass in progress or just ended. `files` = the run folder's file names. */
export function highestStagedPass(files) {
  const re = new RegExp(`^(?:${PASS_STAGE_FAMILIES.join('|')})-(\\d+)(?:-|\\.)`);
  let top = 0;
  for (const f of files) { const m = re.exec(f); if (m && Number(m[1]) > top) top = Number(m[1]); }
  return top;
}
/** A live process OTHER than this one holds the run lock (read-only). The lock this process holds itself (requestRoute takes it before it asks routeRefusal) does not count. */
function otherLiveRun(runDir) {
  const holder = lockHolder(runDir);
  if (!holder) return null;
  if (holder.pid === process.pid && holder.host === hostname()) return null;
  return holder;
}
/**
 * Is this run STOPPED at the owner's pause, and before which pass? The authority is the run having actually stopped, three things together: the stop marker STOPPED-owner_pause.json names a request (`request_seq`), the gate ledger holds that
 * request with no `pause_taken` / `pause_lapsed`, and no other live process holds the run lock. Without all three it is not a pause (a planted marker with no ledger line behind it, a request on a run that has not stopped, a run that is going on).
 * The pass is the one after the highest pass with a stage on disk, so it has no stage. -> { ok: true, after, pass, request_seq } | { ok: false, why: 'none' }
 */
export function pausedPointOf(runDir, files = readdirSync(runDir)) {
  const none = { ok: false, why: 'none' };
  const marker = readStoppedMarker(runDir);
  if (marker?.stoppedBy !== 'owner_pause' || !Number.isInteger(marker.data?.request_seq)) return none;
  const state = pauseStateOf(runDir);
  if (!state.ok) return none;
  const req = state.requests.find(r => r.seq === marker.data.request_seq);
  if (!req || req.taken || req.lapsed || req.finished) return none;
  const after = highestStagedPass(files);
  if (after < 1 || otherLiveRun(runDir)) return none;
  return { ok: true, after, pass: after + 1, request_seq: req.seq };
}
/**
 * Which pass is the person about to start: a revise pause (ladder-steps.js pauseBefore, pure), or the run stopped at the owner's pause (above). An unanswered external-seat pause is answered first; a valid owner's pause is preferred to an older, answered NEEDS-revise file.
 * The four callers (ruling-add, ruling-withdraw, retag-add, routeRefusal) use this and nothing else. -> the shape of pauseBefore.
 */
/** Is the run's owner_pause marker backed by a request that still stands in the ledger (named by the marker's request_seq, neither taken nor lapsed)? The ledger half of pausedPointOf, for a command that already holds (or is about to take) the run lock: a planted marker with no request behind it is not a pause (0.8.4 ladder unit: `--finish` / `--finish-now` at the pause need it). */
export function pauseStandsForMarker(runDir) {
  const marker = readStoppedMarker(runDir);
  if (marker?.stoppedBy !== 'owner_pause' || !Number.isInteger(marker.data?.request_seq)) return false;
  const state = pauseStateOf(runDir);
  if (!state.ok) return false;
  const req = state.requests.find(r => r.seq === marker.data.request_seq);
  return !!req && !req.taken && !req.lapsed && !req.finished;
}
export function pausePointOf(runDir, files) {
  const r = pauseBefore(files);
  if (!r.ok && r.why === 'pending') return r;
  const p = pausedPointOf(runDir, files);
  return p.ok ? p : r;
}
/**
 * `council pause`: records ONE request that the RUNNING run stop before its next pass. No run lock is taken (the verb must work while the run holds it). Refuses a run nobody is running (a request on a stopped run would pause the first pass of its next
 * sitting) and a tree member (it has its own stop mapping). `by` 'person' (channel cli: typed at the terminal; channel session: relayed, with his words and RELAY_REASON) or 'handler' (its own reason). The request names the pass in progress (the highest with a
 * stage, at least 1). Named gap: between the lock check and the append the run may finish; the request then stays untaken and is listed. -> { ok: true, seq, pass } | { ok: false, code, message } (messages are the reason only)
 */
export function requestPause(runDir, { by, channel, personWords = null, reason = null, tree = false } = {}, opts = {}) {
  if (tree) return refuse('pause_tree_member', 'this run is a member of a tree, which has its own way to stop.');   // A-DRAFT
  const holder = lockHolder(runDir);
  if (!holder || holder.unreadable) return refuse('pause_not_running', 'the run is not running, so there is no pass to pause after (a request now would stop it at the first pass of its next sitting).');   // A-DRAFT
  const pass = Math.max(1, highestStagedPass(readdirSync(runDir)));
  const res = recordPauseRequest(runDir, { pass, by, channel, personWords, reason }, opts);
  return res.ok ? { ...res, pass } : res;
}
/**
 * WHO is asking a pause, the ONE mapping both entry points use (`council pause`, src/gate-relay-cli.js, and the MCP tool `pause_run`, src/mcp/pause.js; 0.8.4 16c-MCP). `personWords` (a string, as given) = the handler session relays the person's answer: by person, the words as given and the relay sentence. `reason` (a string) = the handler's own request, its own reason. Both = refused (code `pause_both`): a request that is the person's carries no reason of its own. Neither = the person's own request at a terminal (`bare: true`): the CALLER checks that a terminal exists (the CLI reads the streams, the MCP server never has one and refuses). A blank value is not judged here: the ledger's validator refuses it, the same words for both surfaces. -> { ok: true, ask, bare } | { ok: false, code }
 */
export function pauseAskOf({ personWords, reason } = {}) {
  const words = typeof personWords === 'string' ? personWords : null;
  const own = typeof reason === 'string' ? reason : null;
  if (words !== null && own !== null) return { ok: false, code: 'pause_both' };
  const channel = words !== null || own !== null ? 'session' : 'cli';   // (shorthand on purpose: test/gate-answer.test.js scans every file that names answerGate for a key named channel followed by a colon)
  if (words !== null) return { ok: true, bare: false, ask: { by: 'person', channel, personWords: words, reason: RELAY_REASON } };
  if (own !== null) return { ok: true, bare: false, ask: { by: 'handler', channel, reason: own } };
  return { ok: true, bare: true, ask: { by: 'person', channel } };
}
/**
 * The resume's settlement of a standing request, called under the run lock the resume holds and BEFORE the stop files are cleared: a request the run STOPPED for (the marker names it) is `pause_taken`; any other standing request lapses (`pause_lapsed`:
 * it was asked of a sitting that ended some other way, and must not stop this one at an unrelated pass). -> { ok: true, event: null | 'pause_taken' | 'pause_lapsed', request_seq? } | { ok: false, code, message }
 */
export function settlePauseAtResume(runDir, { finished = null, pass = null, ...opts } = {}) {   // `finished` (0.8.4 ladder unit): 'finish' | 'finish_now' when the person ended the run AT the pause: the request ends as `pause_finished` (the run DID pause and ended there); `pause_taken` is a pause that was resumed; `pause_lapsed` a request that never paused the run
  const state = pauseStateOf(runDir);
  if (!state.ok) return refuse('pause_ledger_unreadable', 'the gate ledger cannot be read, so a request to pause cannot be settled.');   // A-DRAFT
  if (!state.untaken) return { ok: true, event: null };
  const marker = readStoppedMarker(runDir);
  const stopped = marker?.stoppedBy === 'owner_pause' && marker.data?.request_seq === state.untaken.seq;   // the run stopped for THIS request
  const event = stopped && (finished === 'finish' || finished === 'finish_now') ? 'pause_finished' : stopped ? 'pause_taken' : 'pause_lapsed';
  const res = recordPauseSettled(runDir, { event, requestSeq: state.untaken.seq, ...(event === 'pause_finished' ? { choice: finished, pass } : {}) }, opts);
  return res.ok ? { ok: true, event, request_seq: state.untaken.seq, seq: res.seq } : res;
}
/**
 * The question the chain asks at the head of pass `round` (installed by the CLI as setPauseCheck): is an untaken request standing, and does `round` have no stage on disk? -> { request_seq } to stop, null to go on. NEVER throws and never writes.
 * It reads the ledger WITHOUT its lock, on purpose: (1) every ledger write of this process is ONE synchronous call into gate.js that takes and releases the ledger lock before it returns, and the head check is its own synchronous step between awaits, so no lock frame of
 * this process can be live when the chain asks (and chain.js imports no gate module: test/gate-answer.test.js R2/R5); (2) a line is appended with ONE write after a torn tail is cut, so a reader sees whole lines, or whole lines and a torn tail, which readLedger
 * reports as ok (torn: true), never a half line as a line; (3) a read under the lock could make the run wait on, or fail for, another process's short write, which the question must never do; (4) every other reader of the ledger reads the same way. A ledger that
 * cannot be read at all (broken mid-chain, no access) does not clear by itself: `{ problem }`, which the caller logs once and treats as no pause. The request then stays untaken for the rest of that sitting (listed in `pauses[]`), and no pause fires.
 */
/**
 * The chain's second question at the head of pass `round` (installed by the CLI as setPauseFinishCheck, asked BEFORE pauseDue): did the person END the run at the pause that stopped it before this pass? -> { request_seq, choice } or null. The authority is the gate ledger: a
 * `pause_finished` line naming this pass (the pass the pause stopped before, written by the settle from the partial report's stop) and no stage of `round` on disk. A run.json entry alone, a request that was taken, one that lapsed and a pause nobody finished all answer null. NEVER throws and never writes; reads the ledger without its lock for the reasons pauseDue gives.
 */
export function pauseFinishedFor(runDir, round) {
  if (!Number.isInteger(round) || round < 2) return null;
  try {
    const state = pauseStateOf(runDir);
    if (!state.ok) return null;
    const hit = state.requests.filter(r => r.finished && r.finished.pass === round).at(-1);   // the pass of the STOP, written on the line (a request records the pass in progress, which can be one earlier)
    if (!hit) return null;
    return stagesOfPass(readdirSync(runDir), round).length ? null : { request_seq: hit.seq, choice: hit.finished.choice, relayed: pauseFinishRelayedFromLedger(runDir, round, hit.finished.choice, hit.finished.seq) };
  } catch { return null; }
}
export function pauseDue(runDir, round) {
  if (!Number.isInteger(round) || round < 2) return null;
  try {
    const state = pauseStateOf(runDir);
    if (!state.ok) return { problem: 'the gate ledger could not be read, so a request to pause was not looked at before this pass' };   // A-DRAFT
    if (!state.untaken) return null;
    return stagesOfPass(readdirSync(runDir), round).length ? null : { request_seq: state.untaken.seq };
  } catch (err) { return { problem: `a request to pause could not be looked at (${err.code ?? err.message})` }; }   // A-DRAFT
}
/** The rows report.json's `pauses[]` lists: every request to pause the run, oldest first, read from the gate ledger when the report is written: [{ pass, request: { seq, by, channel, person_words, reason, at }, taken: null | { seq, at }, lapsed: null | { seq, at } }]. [] when none or unreadable. */
export function pausesOf(runDir) {
  const s = pauseStateOf(runDir);
  // (the shorthand is on purpose: test/gate-answer.test.js scans every file that names answerGate for a key named channel followed by a colon)
  return s.ok ? s.requests.map(({ pass, seq, by, channel, person_words, reason, at, taken, lapsed, finished }) => ({ pass, request: { seq, by, channel, person_words, reason, at }, taken, lapsed, finished })) : [];
}
