// ROADMAP 57 (0.8.3 M6, commit 1): a person ends a whole tree for good. The record side; the form (`council tree decide <root> --abandon`), the refusals of the verbs and the readers are the next commits.
//
// CONTRACT (Review/Build_0.8.3/m6-closing/ROADMAP57_Tree_Abandon_Contract.md, gate 1 and C&C's departures of 13 Oct 2026):
//   event     tree_abandoned { gateId, shownSha256 }   written ONLY by abandonTree below (a source scan pins it); no reason text, no snapshot: every view derives from the record.
//   state     state.abandoned = null | { eventId, at, gateId, shownSha256, retiredStops: [stop ids] }   (src/tree-transitions.js foldRecord). The fold retires every open stop, lifts the root and parent blocks and releases every held era;
//             the table (transitionRefusal, FIRST line) refuses every later event except blocked, guard_refused and reservation_mirrored, with abandonedSentence(state).
//   refusal   abandonRefusal(...) -> null | { kind, reason }: a damaged record, an already abandoned tree, a tree whose start was never recorded (the way out is `council tree resume`), a member with a live claim or a live post-run
//             call (liveMembersOf: another host's claim is never judged dead from here), a running sitting (the sitting lock has a live holder; a stale lock does not refuse). A registered-never-started node, one paused at an
//             external seat, one stopped at its cap and a running node with a DEAD claim do not refuse. The sticky blocks do not refuse either: a tree under parent_changed / root_affected is exactly what a person abandons.
//   writer    abandonTree(rootDir, { gateId, shownSha256 }, { facts, now }) under the tree lock: re-reads the record, applies the SAME abandonRefusal the form used, appends. A refusal writes a `blocked: continuation_refused`
//             (check 'abandon') record and throws a TreeRefusal - except on a damaged or already final record, where nothing is written.
//   money     budgetOf (src/tree-budget.js) holds 0 for every node of an abandoned tree; the spend stays counted.
//   guard     treeFinalRefusal(state) -> null | the abandonedSentence: the FIRST step of every form's build, so a gate that was pending when the tree was abandoned is not used (the next commit).
import { basename } from 'node:path';
import { lockHolder } from './run-lock.js';
import { SITTING_LOCK_FILE } from './tree-files.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, treeDirOf, withTreeLock } from './tree-record.js';
import { abandonedSentence, liveMembersOf } from './tree-transitions.js';
import { adviceAbandonHoldsOf } from './tree-advice-record.js';

export { abandonedSentence };

/** The sentence of a final tree for a form that is about to be built (null when the tree is not abandoned). */
export const treeFinalRefusal = state => (state?.abandoned ? abandonedSentence(state) : null);
/**
 * The line a verb prints when the tree refused to record what the person approved (a TreeRefusal after the approval was used): the reason may end with a full stop (the abandoned sentence does), so ONE is stripped before the verb's own
 * is added; and on a FINAL tree there is nothing to run again, so it says what happened instead. -> the whole line, without a newline. Pure but for the record read that decides "final".
 */
export function recordRefusalLine({ verb, reason, rootDir, again = 'Run the command again: it shows the tree\'s current state.' }) {
  const text = String(reason ?? '').trim().replace(/[.\s]+$/, '');
  return finalSentenceOf(rootDir)
    ? `${verb}: ${text}. Your approval was used and nothing was recorded; nothing more can be run on this tree.`
    : `${verb}: the tree refuses to record this: ${text}. ${again}`;
}
/** The same, read from the record on disk NOW: the first step of every verb and the step right before an approval is spent (a gate that was pending when the tree was abandoned is not used). */
export const finalSentenceOf = rootDir => treeFinalRefusal(stateOf(readTreeRecord(rootDir)));

/**
 * Why this tree cannot be abandoned now, or null. `record` is the record as read (its `corrupt` lines are the damaged ones), `state` its fold. Reads the sitting lock (the filesystem); everything else is the record.
 * -> { kind: 'corrupt' | 'abandoned' | 'not_started' | 'live_advice' | 'live_member' | 'sitting', reason } | null
 */
export function abandonRefusal({ rootDir, record, state, facts = {}, runStatusOf }) {
  const id = basename(rootDir);
  if (record.corrupt?.length) return { kind: 'corrupt', reason: `the record of tree ${id} has ${record.corrupt.length} damaged line${record.corrupt.length === 1 ? '' : 's'} and cannot be read, so an abandon cannot be recorded in it; restore the damaged line from a backup, or start a new tree` };
  if (state.abandoned) return { kind: 'abandoned', reason: abandonedSentence(state) };
  if (!state.started) return { kind: 'not_started', reason: `the start of tree ${id} was never recorded; run \`council tree resume ${id}\` first (it completes the start), then abandon it` };
  // a recommendation request still holds its grant (the table refuses on the narrow rule; a call that outlives the brief wait or its registering process is caught here, BUG-B-015): the table's own sentence
  { const advice = adviceAbandonHoldsOf(rootDir, state, { facts, ...(runStatusOf ? { runStatusOf } : {}) }); if (advice.length) return { kind: 'live_advice', reason: `a recommendation request (${advice[0].adviceId}) is still in progress (registered by pid ${advice[0].pid} on ${advice[0].host}): a tree cannot be abandoned while one is` }; }
  const live = liveMembersOf(state, facts);
  if (live.length) return { kind: 'live_member', reason: `${live.map(m => `${m.key} (${m.kind === 'post_run' ? 'a post-run call' : 'a running member'}, pid ${m.pid} on ${m.host})`).join(', ')} still ${live.length === 1 ? 'has' : 'have'} a live claim: a tree with a running member cannot be abandoned; wait for it to end` };
  const sitting = lockHolder(treeDirOf(rootDir), { file: SITTING_LOCK_FILE });
  if (sitting) return { kind: 'sitting', reason: `a sitting of tree ${id} is running (pid ${sitting.pid ?? 'unknown'} on ${sitting.host ?? 'unknown'}); wait for it to end, then abandon it (\`council tree stop ${id}\` keeps it from starting more nodes, but does not end the one running)` };
  return null;
}

/**
 * Records the abandon (the gate's approval is already used by the caller). ONE `tree_abandoned` under the tree lock; the table re-checks the gate fields and the live members. A refusal throws a TreeRefusal; it also writes a
 * `blocked: continuation_refused` record unless the record is damaged or the tree is already final (nothing may be appended there).
 */
export function abandonTree(rootDir, { gateId, shownSha256, actor, via } = {}, { facts = {}, now, runStatusOf } = {}) {
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('abandonTree: gateId and shownSha256 (64 hex) are required: abandoning a tree is a decision a person typed');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const state = stateOf(record);
    const refusal = abandonRefusal({ rootDir, record, state, facts, runStatusOf });
    if (refusal) {
      if (refusal.kind !== 'corrupt' && refusal.kind !== 'abandoned') appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'continuation_refused', scope: 'tree', check: 'abandon', detail: refusal.reason }, { facts, now });
      throw new TreeRefusal({ code: 'continuation_refused', transition: 'tree_abandoned', reason: refusal.reason });
    }
    return appendTreeEventLocked(rootDir, { event: 'tree_abandoned', gateId, shownSha256, actor, via }, { facts, now });
  });
}
