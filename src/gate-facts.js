// 0.8.4 A-fix1 (R492, R496): the two gate facts a session tool hands back OUTSIDE every untrusted marker, a gate's id and its expiry time (tools stop_decide and tree_decide). They are read from the gate ledger and the gate's
// view file, which a project can write, and the tools compare the view with the ledger by equality only, so each is checked to be exactly what the harness writes: an id of the shape of a gate id and the time `new Date(ms).toISOString()`
// gives. A field that is not that is refused loudly, never passed on. (Marking `expiresAt` as untrusted text was the other way: a harness field should be exactly what the harness wrote, and a marker would turn a machine
// value into a notice for every honest caller while a wrong value still went out.) One check, one refusal sentence, for both tools. The id is checked by F3's one definition of a gate id (isGateId, src/run-status.js over src/gate.js GATE_ID): this file holds no id pattern of its own. No file is read here.
import { isGateId } from './run-status.js';

/** -> { id, expiresAt } when both are in the form THC writes, otherwise null. `gate` has the ledger's names: { id, expires_at }. */
export const gateFactsOf = gate => {
  const id = gate?.id; const at = gate?.expires_at;
  const timeOk = typeof at === 'string' && !Number.isNaN(Date.parse(at)) && new Date(at).toISOString() === at;
  return isGateId(id) && timeOk ? { id, expiresAt: at } : null;
};

/** The refusal a tool answers with when the gate record fails gateFactsOf (A-DRAFT). */
export const GATE_FACTS_REFUSAL = 'The gate record of this stop is not in the form THC writes (its id or its expiry time). Nothing was decided. Tell the person: something other than THC changed the run folder.';
