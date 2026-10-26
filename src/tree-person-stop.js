// S8-8 (0.8.3 M6): the PERSON-OPENED ROOT STOP. Muad, 11 Oct 2026: "a person may open a root stop himself (ready-but-wrong plans)". Contract: Review/Build_0.8.3/m6-closing/S8-8_Person_Opened_Root_Stop_Contract.md (gate 1 passed 12 Oct; C&C accepted
// the departures 13 Oct). The RECORD half is the `source: 'person'` branch of the needs_decision_opened row (src/tree-transitions.js); this file is the form's two other halves, the preflight and the writer. The gate text is built in
// src/tree-decide.js (every gate text is, and the tripwire of test/tree-decide-limits.test.js counts them there).
//
// CONTRACT
//   personStopPreflight({ rootDir, work? }) -> { refusal } | { record, state, root }       Everything that is checked BEFORE anyone types: one plain sentence, no trailing full stop (the caller adds ". Nothing was asked and nothing was written.").
//                                                                                           It reads "finished" exactly as the table does (unfinishedLiveNodes) and adds the one fact the table cannot see: a frontier waiting for approval.
//   openPersonStop(rootDir, { reason, gateId, shownSha256, expectedStopId }, { facts, now }) -> the appended event      One needs_decision_opened { node: 'R', generation: g, runId, source: 'person', affected, reason, gateId, shownSha256 }
//                                                                                           under the tree lock. `expectedStopId` is the id the gate text NAMED (the text is hashed, so the id the person read must be the id that is recorded): if the
//                                                                                           record moved and the next id differs, nothing is written. The table re-checks everything it can see.
import { dirname } from 'node:path';
import { lockHolder } from './run-lock.js';
import { gateTree } from './tree-budget.js';
import { findPendingFrontier } from './tree-frontier.js';
import { SITTING_LOCK_FILE } from './tree-files.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, treeDirOf, withTreeLock } from './tree-record.js';
import { affectedFor } from './tree-affected.js';
import { abandonedSentence, deadKeys, heldKeys, latestGenerationOf, undetectedDecisionCloses, unfinishedLiveNodes } from './tree-transitions.js';

export function personStopPreflight({ rootDir }) {
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) return { refusal: `the record of this tree does not read (${record.corrupt.length} problem${record.corrupt.length === 1 ? '' : 's'}); nothing can be decided on it. \`council tree status ${record.tree?.treeId ?? '<root>'}\` lists them` };
  const state = stateOf(record);
  if (state.abandoned) return { refusal: abandonedSentence(state).replace(/\.$/, '') };
  const g = latestGenerationOf(state, 'R');
  const root = state.nodes.get(`R@g${g}`);
  if ([...state.decisions.values()].some(d => d.replansRoot === true && !d.generated) || (g > 0 && !root)) return { refusal: 'a new root plan is already pending' };
  if (!root) return { refusal: 'the root plan is not registered' };
  const key = `R@g${g}`;
  if (deadKeys(state).has(key) || heldKeys(state).has(key)) return { refusal: `the root plan ${key} was replaced` };
  if (root.phase !== 'closed') return { refusal: `the root plan is not finished (${key} is ${root.phase})` };
  if (state.active !== null) return { refusal: `the tree is not finished (${state.active} is active)` };
  const unfinished = unfinishedLiveNodes(state);
  if (unfinished.length) return { refusal: `the tree is not finished (${unfinished[0].node}@g${unfinished[0].generation} is ${unfinished[0].phase})` };
  // a node that ended with the Status needs_decision has its stop written by the next sitting (`council tree resume`, which runs detection); until then a person's stop on the root would let a re-plan make that node dead before its stop exists
  const undetected = undetectedDecisionCloses(state);
  if (undetected.length) {
    const what = `${undetected[0].node}@g${undetected[0].generation} ended with the Status needs_decision and its stop is not written yet`;
    return { refusal: state.sticky.size ? `${what}, and the tree is blocked (${[...state.sticky.keys()].join(', ')}): answer the block first (\`council tree resume ${record.tree.treeId}\` says how); the next \`council tree resume ${record.tree.treeId}\` then writes the stop, and you answer that` : `${what}: run \`council tree resume ${record.tree.treeId}\` to write it, then answer that stop` };
  }
  const open = state.openStops.find(id => state.stopMeta.get(id)?.node === 'R');
  if (open) return { refusal: `a stop is already open on the root (${open}): answer that one` };
  const pending = findPendingFrontier({ rootDir, record, state });
  if (pending) return { refusal: `a frontier of children waits for your approval (${String(pending.key).slice(0, 12)}): approve it first, or ask for a stop once nothing waits` };
  const sitting = lockHolder(treeDirOf(rootDir), { file: SITTING_LOCK_FILE });
  if (sitting) return { refusal: `a sitting of this tree is running (pid ${sitting.pid ?? 'unknown'} on ${sitting.host ?? 'unknown'})` };
  const gate = gateTree(rootDir, { record });
  if (!gate.ok) return { refusal: `the accounting gate fails (${[...new Set(gate.problems.map(p => p.code))].join(', ')}): answer it first` };
  return { record, state, root };
}

export function openPersonStop(rootDir, { reason, gateId, shownSha256, actor, via, expectedStopId } = {}, { facts = {}, now } = {}) {
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('openPersonStop: gateId and shownSha256 (64 hex) are required: a stop on the root plan is a decision a person typed');
  if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('openPersonStop: the reason is required');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const state = stateOf(record);
    const next = `e${state.lastId + 1}`;
    if (typeof expectedStopId === 'string' && expectedStopId !== next) throw new TreeRefusal({ code: 'continuation_refused', transition: 'needs_decision_opened', reason: `the record moved while you were reading it (the stop would be ${next}, not ${expectedStopId})` });
    const g = latestGenerationOf(state, 'R');
    const root = state.nodes.get(`R@g${g}`);
    if (!root) throw new TreeRefusal({ code: 'continuation_refused', transition: 'needs_decision_opened', reason: 'the root plan is not registered' });
    const { affected } = affectedFor({ record, state, runsDir: dirname(rootDir), node: 'R' });
    return appendTreeEventLocked(rootDir, { event: 'needs_decision_opened', node: 'R', generation: g, runId: root.runId, source: 'person', affected, reason, gateId, shownSha256, actor, via }, { facts, now });
  });
}
