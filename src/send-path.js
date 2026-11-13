// The window's answerer: the three gate touches of the MCP server's typed-limit and raise dialogs. Until 0.8.4 this file also held the advice add-on's
// quote -> approve -> start path (createSendPath); that path left with the add-on, and what stays is what the server's dialogs need. The file keeps its name
// because test/gate-answer.test.js lists it among the only modules that may call the gate's answer writer.
import { answerGate, readGateAnswer, readGateText } from './gate.js';
import { answerControl, controlHistory, isRaiseGate } from './run-controls.js';

// 0.8.3 M6 typed cap T6a: the MCP server asks a run's limit through the client's dialog, but it may not name a gate module itself (test/gate-answer.test.js: only the answerers do, and submit_stage must reach no gate code from server.js's own imports).
// So the three gate touches of that dialog live here, in an answerer, on the person channel 'elicitation' only: the pending limit screen (the text its hash covers), the gate's recorded status, and the answer (a typed amount or a decline).
export function capGateScreen(runDir, gateId) {
  const state = readGateAnswer(runDir, gateId);
  const bytes = state?.gate ? readGateText(runDir, state.gate.text) : null;
  return bytes ? { text: bytes.toString('utf8'), sha256: state.gate.sha256 } : null;
}
export const capGateStatus = (runDir, gateId) => readGateAnswer(runDir, gateId)?.status ?? null;
// S20 slice 1: the window's answer to a RAISE goes through the one interface (src/run-controls.js, channel elicitation); a first limit or an amendment keeps its writer
export const answerCapGate = (runDir, gateId, { shownSha256, decision, typedCap, client }) => (isRaiseGate(readGateAnswer(runDir, gateId)?.gate)
  ? answerControl(runDir, gateId, { control: 'raise', channel: 'elicitation', shownSha256, decision, actor: client?.name ?? null, tty: null, ...(decision === 'approved' ? { typedCap, client } : {}) })
  : answerGate(runDir, gateId, { channel: 'elicitation', shownSha256, decision, actor: client?.name ?? null, tty: null, ...(decision === 'approved' ? { typedCap, client } : {}) }));
// H10 (S20, 0.8.4): two READS for the MCP relay (src/mcp/server.js relayFlow records the relayed answer itself, through src/run-controls.js relayRaise: this file, the window's answerer, records person channels only; the server may not name a gate module).
/** True when this gate is a raise of the run's limit that the person answered (approved), that nothing has used or closed, and that has not lapsed. */
export const openRaiseApproval = (runDir, gateId) => { const st = readGateAnswer(runDir, gateId); return isRaiseGate(st?.gate) && st.status === 'approved' && st.usable === true; };
/** What became of the raise answered at this gate: { state: 'consumed', old_usd, new_usd } | { state: 'closed', code, reason } | { state: 'recorded' } (answered, not used yet) | null (no such answer). Derived from the ledger (controlHistory). */
export function raiseFate(runDir, gateId) {
  const row = controlHistory(runDir).raises.find(r => r.gate === gateId);
  if (!row) return null;
  if (row.consumed) return { state: 'consumed', old_usd: row.old_usd, new_usd: row.new_usd };
  if (row.closed) return { state: 'closed', code: row.closed.code, reason: row.closed.reason };
  return { state: 'recorded' };
}
