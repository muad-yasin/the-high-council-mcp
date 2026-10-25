// Stop detection (0.8.3 M5e slice 2; PLAN 8.4, 8.5 row `needs_decision_opened`). The FIRST production writer of `needs_decision_opened`: a child (or the root) whose run ended with handoff Status `needs_decision` has a closing event
// with that status (src/tree-member.js closedFieldsOf; `share: revoked`, its unspent grant already given back through returnedUsdOf by the closing writer, spend stays counted), and the person must be told. For each such closed node
// that has no stop for THIS (node, generation, run) yet, this appends `needs_decision_opened { node, generation, runId, source: 'node_closed', affected }` with the affected set of src/tree-affected.js (the ROOT's own stop is pinned to {R}).
//   - IDEMPOTENT per (node, generation, runId), re-checked under the tree lock: a second sitting appends nothing; a REPLACEMENT generation that ends needs_decision has its own run id and opens its own stop.
//   - It runs inside the sitting after recovery and verification. It is NOT the only guard: providerEligibility (src/tree-loop.js, M5c1) already refuses a provider whose closing Status is needs_decision, so a consumer cannot start
//     between the node_closed and the next sitting's detection.
//   - It writes no `root_affected` block: that comes only from an obligation stop opened by a child (S4).
import { dirname } from 'node:path';
import { appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { affectedFor } from './tree-affected.js';
import { integrationGapsOf } from './tree-check.js';
import { deadKeys } from './tree-transitions.js';

const stopKey = e => `${e.node}@g${e.generation}:${e.runId}`;

/** -> the needs_decision_opened events appended (usually none). */
export function detectStops(rootDir, { facts, now } = {}) {
  const opened = [];
  const pending = () => {
    const record = readTreeRecord(rootDir);
    if (record.corrupt.length || !record.tree) return [];
    const state = stateOf(record);
    // an OBLIGATION root stop (src/tree-decide-stop.js) and a PERSON's root stop (S8-8) are written with the root's node, generation and run id: neither may hide the root's OWN stop from this key
    const have = new Set(record.events.filter(e => e.event === 'needs_decision_opened' && e.source !== 'obligation' && e.source !== 'person').map(stopKey));
    // a DEAD key (replaced or set aside by a decision, or a node above it was) gets no stop: the table refuses one (tree-transitions.js, the dead-key row of needs_decision_opened), and an append that is refused kills the sitting (S8-8 fix-up, J1-15-1)
    const dead = deadKeys(state);
    return [...state.nodes.values()].filter(n => n.phase === 'closed' && !dead.has(`${n.node}@g${n.generation}`)).filter(n => {
      const ev = record.events.filter(e => e.event === 'node_closed' && e.node === n.node && e.generation === n.generation && e.runId === n.runId).at(-1);
      return ev?.status === 'needs_decision' && !have.has(stopKey(n));
    }).map(n => ({ node: n.node, generation: n.generation, runId: n.runId }));
  };
  if (!pending().length) return opened;                                      // the common case takes no lock
  withTreeLock(rootDir, () => {
    for (const p of pending()) {                                             // re-read under the lock: another sitting may have written it
      const record = readTreeRecord(rootDir); const state = stateOf(record);
      const { affected } = affectedFor({ record, state, runsDir: dirname(rootDir), node: p.node, generation: p.generation });
      opened.push(appendTreeEventLocked(rootDir, { event: 'needs_decision_opened', ...p, source: 'node_closed', affected }, { facts, now }));
    }
  });
  return opened;
}

/**
 * The SECOND detection of the sitting (check-fail wedge): `council tree check <id> fail` writes two records in one lock hold, `integration_recorded` then the node-less integration stop. A process that ended between them leaves
 * a failure with no stop (readiness `integration_failed`, nothing to answer, and `tree check fail` refuses the duplicate). This writes the missing stop with the same `affected` the verb would have shown (failAffectedOf), under the
 * tree lock and from a fresh read (a second sitting writes nothing), and it FAILS CLOSED: a failure whose owner's files do not read gets NO stop and comes back in `unreadable` with the files named, so the sitting says so.
 * -> { opened: the stops appended (usually none), unreadable: [{ agreement, reason, files }] }. The common case (no failed check without its stop) takes no lock.
 */
export function detectIntegrationStops(rootDir, { facts, now } = {}) {
  const read = () => {
    const record = readTreeRecord(rootDir);
    if (record.corrupt.length || !record.tree) return null;
    const state = stateOf(record);
    return state.started ? { record, state, ...integrationGapsOf({ record, state, runsDir: dirname(rootDir) }) } : null;
  };
  const first = read();
  if (!first) return { opened: [], unreadable: [] };
  if (!first.missing.length) return { opened: [], unreadable: first.unreadable };
  const opened = []; let unreadable = first.unreadable;
  withTreeLock(rootDir, () => {
    const fresh = read();                                                    // re-read under the lock: another sitting may have written it
    if (!fresh) return;
    unreadable = fresh.unreadable;
    for (const m of fresh.missing) opened.push(appendTreeEventLocked(rootDir, { event: 'needs_decision_opened', source: 'integration', agreement: m.agreement, affected: m.affected }, { facts, now }));
  });
  return { opened, unreadable };
}
