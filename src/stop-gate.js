// 0.8.4 D5a (plan A T4.3; Mini-C&C R357): the ONE module outside src/gate-cli.js that talks to the gate for the handling session's answer to a round stop, like src/tree-gate.js for the tree. The session asks for a `stop_decision`
// gate whose text is the quote of the stop (requestedBy 'session', the stop's id bound in the gate), answers it on the session channel with the choice, its reason and the advisor state, or hands the stop to the person by declining it.
// The CLI reads the answered gate at the entry site of --continue / --finish (stopDecisionAnswerOf). Reads no environment and no command line (test/gate-answer.test.js R1 scans the gate modules; this file keeps to the same rule).
import { readRunJson } from './run-files.js';
import { isPersonStop, stopIdOf } from './overseer-rounds.js';
import { stopShaOf } from './spend-finish.js';
import { capUsdNumber } from './cap-input.js';
import { readSecretStop, secretGateStopId } from './secret-pause.js';
import { RELAY_REASON, STOP_DECISION_KIND, answerStopDecisionAsSession, deferStopDecisionAsSession, listGates, readGateAnswer, requestGate, runCapAuthority, stopDecisionAnswerOf } from './gate.js';

export { stopDecisionAnswerOf };
export { runCapAuthority };   // 0.8.4: the one way the stop tool reads the run's limit authority (src/mcp/stop-decide.js may not import gate.js itself: test/gate-answer.test.js R2)
export { relayedSecretAnswerOf } from './gate.js';
export { limitApprovedAfterGate, budgetFinishTakenFromGate, budgetFinishStandsForContinue, gateQuoteNamesHash } from './gate.js';
export { closeStopAnswer } from './gate.js';
export { PAUSE_CONTINUE_REFUSAL, BUDGET_CONTINUE_REFUSAL, PERSON_ONLY_STOP_REFUSAL } from './gate.js';

/** The run's spending limit in dollars, from the hash-chained record of the limit the person typed (never from run.json, which is project-writable text); null when the run has none on record or it cannot be read. */
export function runLimitUsd(runDir, opts = {}) {
  const a = runCapAuthority(runDir, opts);
  return a?.status === 'ok' ? capUsdNumber(a.capUsd) : null;   // the record holds the typed limit as a decimal string
}

/** A pending, unexpired stop_decision gate of this run for this stop whose text has this sha256 (a repeated quote of an unchanged stop reuses it, so quoting twice does not pile up gates). -> null | the gate record. */
export function pendingStopQuote(runDir, stopId, sha256, opts = {}) {
  for (const g of [...(listGates(runDir, opts) ?? [])].reverse()) {
    if (g.status !== 'pending') continue;
    const st = readGateAnswer(runDir, g.id, opts);
    if (st.gate?.kind === STOP_DECISION_KIND && st.gate.stop?.id === stopId && (st.gate.stop?.person_only === true) === personOnlyStopOf(runDir, stopId) && st.gate.sha256 === sha256) return st.gate;
  }
  return null;
}

/** Asks for the gate of a quote whose text was written to `textPath` (a file inside the run folder). -> requestGate's answer. */
/**
 * 0.8.4 (C&C 10 Nov, fail closed): whether this stop is the person's alone is read HERE, from the run's own partial report, never taken from the caller. A stop that names the id asked for and is a person stop
 * (isPersonStop: the hard stop off the ladder, or a ladder run's typed-limit stop) marks the gate `person_only`, which the gate then holds to the person's relayed answers. No readable stop with this id: the gate is the ordinary one.
 */
/** The stop the run's partial report holds for this id, or null: an object with a whole overseer round and a whole pass whose stopIdOf is exactly the id asked for. Anything else (no file, a damaged file, no stop object, no whole round or pass, another id) is null. */
/** 0.8.4 (relay of --finish-now): the id of a spending stop carries the first 12 characters of the hash of the stop file's figures (stop file: stage, phase, cap, limit, spent), so an answer given for one spending stop is never taken for the next one at the same stage after a raise too small to pass it. */
export const budgetStopWithSha = (runDir, stop) => (stop?.kind === 'budget_stop' ? { ...stop, sha: stopShaOf(readRunJson(runDir, 'STOPPED-budget.json')) ?? undefined } : stop);
const readableStopOf = (runDir, stopId) => {
  const stop = budgetStopWithSha(runDir, readRunJson(runDir, 'report-partial.json')?.stop);   // the name is report-shape.js PARTIAL_REPORT_FILE (not imported: this module stays small)
  return stop && typeof stop === 'object' && !Array.isArray(stop) && Number.isInteger(stop.overseer_round) && stop.overseer_round >= 0 && Number.isInteger(stop.pass) && stop.pass >= 1 && stopIdOf(stop) === stopId ? stop : null;
};
const secretPauseOf = (runDir, stopId) => { const rec = typeof stopId === 'string' && stopId.startsWith('secret_pause:') ? readSecretStop(runDir) : null; return rec && secretGateStopId(rec) === stopId ? rec : null; };   // 0.8.4 (Q9): a found-secret pause is read from its own record; a stop id that names no whole, matching record is no stop
export const personOnlyStopOf = (runDir, stopId) => { if (typeof stopId === 'string' && stopId.startsWith('secret_pause:')) return !!secretPauseOf(runDir, stopId); const stop = readableStopOf(runDir, stopId); return !!stop && isPersonStop(stop); };
export const requestStopQuote = (runDir, { textPath, stopId }, opts) => {
  // fail closed (C&C 10 Nov): a gate is ordinary ONLY when the stop was read AND is not the person's alone. Every other case asks no question and records nothing; the terminal stays open to the person.
  if (typeof stopId === 'string' && stopId.startsWith('secret_pause:')) {   // 0.8.4 (Q9): the pause of a found secret is the person's alone: its gate is person_only like a spending stop's, so only the person's relayed words answer it
    if (!secretPauseOf(runDir, stopId)) return { ok: false, code: 'stop_unreadable', message: 'The pause record of this run (secret-stop.json) cannot be read or is not the pause asked about, so no question was asked. Nothing was recorded.' };   // A-DRAFT (LAD-Q9-3)
    return requestGate(runDir, { kind: STOP_DECISION_KIND, textPath, stop: { id: stopId, person_only: true }, requestedBy: 'session' }, opts);
  }
  const stop = readableStopOf(runDir, stopId);
  if (!stop) return { ok: false, code: 'stop_unreadable', message: 'The stop of this run cannot be read (its partial report is damaged), so it cannot be told whether the stop is the person\'s alone; no question was asked. Nothing was recorded.' };   // A-DRAFT (LAD-F19)
  return requestGate(runDir, { kind: STOP_DECISION_KIND, textPath, stop: { id: stopId, ...(isPersonStop(stop) ? { person_only: true } : {}) }, requestedBy: 'session' }, opts);
};

/** The session's answer: approve the quote with the choice, its reason and the advisor state. -> the gate's answer. */
export const answerStopQuote = (runDir, gateId, { shownSha256, reason, choice, advisor, advisorSaid, personTest }, opts) => answerStopDecisionAsSession(runDir, gateId, { shownSha256, reason, stopAnswer: { choice, advisor, advisor_said: advisorSaid, person_test: personTest } }, opts);

/** 0.8.4 (finish at once, typed = relayed): the person's choice (continue, finish or finish_now; a continue may carry the new limit `rounds`), relayed by the session with the person's own words. The gate records it as the person's choice (person_words, the relay sentence as its reason); no advisor and no person test, because the session decides nothing here. -> the gate's answer. */
export const answerStopRelayed = (runDir, gateId, { shownSha256, personWords, choice, rounds }, opts) => answerStopDecisionAsSession(runDir, gateId, { shownSha256, reason: RELAY_REASON, stopAnswer: { choice, relayed: true, ...(rounds === undefined ? {} : { rounds }) }, personWords }, opts);

/** The session hands the stop to the person: it declines its own gate with its reason, the advisor state and what the advisor said, and the person test in which both parts say the stop is the person's. */
export const deferStopQuote = (runDir, gateId, { shownSha256, reason, advisor, advisorSaid, personTest }, opts) => deferStopDecisionAsSession(runDir, gateId, { shownSha256, reason, stopDefer: { advisor, advisor_said: advisorSaid, person_test: personTest } }, opts);
