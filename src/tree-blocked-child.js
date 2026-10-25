// The blocked-child stop (0.8.3 M6; owner's yes, Muad 11 Oct 2026: "I'd say yes to the stop", rulings row 116, CHANGELOG CL-151, PLAN section 12). A CHILD that has closed and that the readiness rule blocks at NODE level
// had no route out: `decide` refused (no stop open), the sitting had nothing to do, nothing wrote a second attempt. Now a needs_decision stop opens on that child (`source: 'blocked'`, `blockedBy`: the codes and words),
// and the person answers it with the regenerate form of `council tree decide --stop <id>`, which opens a new generation of the child through the M5e machinery (a NEW generation admitted under maxRuns, not a second
// attempt: attemptsPerChild stays 1). THE RULE (C&C, from the five probes of rulings row 124, ruled in row 125): every `blocked`-severity reason at a closed child's own `node@g<n>` scope opens the stop, and `closed_incomplete`
// (incomplete severity, a person's own act with no other route to a replacement) stays named. There is NO exception: the owner said yes to `no_milestone_lint` as well (rulings row 128). A future blocked code therefore fails closed into a stop.
//   - S8 G9 (rulings row 130): the ROOT is a node too. A blocked-severity reason at the LIVE root generation's own `R@g<n>` scope opens the same stop (node R), answered by a NEW ROOT plan (`council tree decide --stop`, the root re-plan form); a reason at another scope (tree, an agreement, an obligation) is not a node's.
//   - IDEMPOTENT per node@generation: an OPEN stop of any source for that key means none is opened again (so one open stop per key at a time); an ANSWERED stop holds nothing back - a stop answered in place
//     (`--milestone`) leaves the node at its generation, still blocked, and it must be able to open this stop on the next step; one answered by regenerate is already filtered by the generation check.
//     Re-checked under the tree lock, from the fold's own `openStops`.
//   - A node already IN QUESTION gets none: `state.stale` holds it, and each of its sources has its own remedy that releases it or replaces the node - an OPEN stop whose affected set names it (answer that stop), a parent that changed (approve the frontier again),
//     a regenerate decision that is replacing it (between the decision and the generation it opens the old generation is still the newest, and an answered stop holds nothing back). Once the mark is released the next step opens the stop.
//   - It reads the verdict it is handed (src/tree-readiness.js computeReadiness: one computation per tree step) and writes only the stop. The caller runs it BEFORE recording readiness, so the recorded verdict already carries the stop.
import { dirname } from 'node:path';
import { appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { affectedFor } from './tree-affected.js';
import { closedUnstartedGenerationOf, deadKeys, isSupersededGeneration, orphansOf, undetectedDecisionCloses } from './tree-transitions.js';
import { nodeKey } from './tree-identity.js';

// `closed_incomplete` IS here although it is incomplete severity and a person's own act (`decide --close`): measured, a node closed incomplete has NO other route to a replacement (decide refuses with no stop open,
// the sitting does nothing, nothing writes attempt 2), so the stop is the only way "what waits for it starts only if that node is replaced" can ever happen.
export const BLOCKED_CHILD_ALSO = Object.freeze(['closed_incomplete']);
/** True when a readiness reason is one the stop covers (the scope is checked by the caller). */
export const opensBlockedStop = r => r.severity === 'blocked' || BLOCKED_CHILD_ALSO.includes(r.code);
const stopKey = e => `${e.node}@g${e.generation}`;                              // a closed node@generation has exactly one run, so the run id adds nothing to the key
const SCOPE = /^(R(?:\/[A-Za-z][A-Za-z0-9_-]*)*)@g([1-9]\d*)$/;     // a node key, the root's included (G9; pendingOf keeps only the live generation of each path)

/**
 * The PURE half of the rule: the children the verdict blocks at node level that have no stop yet, from a record and its fold - [{ node, generation, runId, blockedBy: [{ code, text }] }]. `verdict` needs only `reasons`.
 * It reads no file, so the writer (openBlockedChildStops, through pendingOf) and the readers that say "the next sitting opens a stop for this child" (src/tree-status.js, S8-6b part 2a) ask the SAME function: one rule, not a copy of its filters.
 */
export function pendingBlockedChildren(record, state, verdict) {
  const orphans = orphansOf(state);
  // CR-2J-001: a close that ended needs_decision and whose node_closed stop detection has not written yet (a sitting that `tree stop` ended before detection ran) is detection's to open: its answers include the free KEEP, which a blocked stop never offers.
  const undetected = new Set(undetectedDecisionCloses(state).map(u => nodeKey(u.node, u.generation)));
  const have = new Set(state.openStops.map(id => record.events.find(e => e.id === id)).filter(Boolean).map(stopKey));   // OPEN stops of any source only
  const byKey = new Map();
  for (const r of verdict.reasons) {
    if (!opensBlockedStop(r)) continue;
    const m = SCOPE.exec(r.scope);
    if (!m) continue;
    const key = nodeKey(m[1], Number(m[2]));
    // c3b: a child a person closed before it ever started has no nodes row and no run; it is closed all the same (its stop carries no runId, like the stop that led to the close)
    const n = state.nodes.get(key) ?? (state.closedUnstarted.has(key) && !deadKeys(state).has(key) ? { node: m[1], generation: Number(m[2]), phase: 'closed', runId: undefined } : undefined);
    if (!n || n.phase !== 'closed' || orphans.has(nodeKey(n.node, n.generation)) || isSupersededGeneration(state, n.node, n.generation) || closedUnstartedGenerationOf(state, n.node) > n.generation || state.stale.has(nodeKey(n.node, n.generation)) || undetected.has(nodeKey(n.node, n.generation)) || have.has(stopKey(n))) continue;
    const entry = byKey.get(nodeKey(n.node, n.generation)) ?? { node: n.node, generation: n.generation, runId: n.runId, blockedBy: [] };
    entry.blockedBy.push({ code: r.code, text: r.text });
    byKey.set(nodeKey(n.node, n.generation), entry);
  }
  return [...byKey.values()].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0)).map(e => ({ ...e, blockedBy: e.blockedBy.sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0)) }));
}

/** The children the verdict blocks at node level that have no stop yet, from the record NOW (an unreadable or corrupt record has none). */
function pendingOf(rootDir, verdict) {
  const record = readTreeRecord(rootDir);
  if (record.corrupt.length || !record.tree) return [];
  return pendingBlockedChildren(record, stateOf(record), verdict);
}

/**
 * The entry to open next (CR-2F-002 / B7): a pending child that sits in NO OTHER pending child's affected set (src/tree-affected.js: the consumers of a node, of its ancestors, and everything below). The stop of a provider puts its consumers in question,
 * so once it is written the consumers are stale and `pendingBlockedChildren` drops them; a consumer opened FIRST would not drop its provider, and both would get a stop. Path order (the order `pendingBlockedChildren` returns) decides only when
 * no entry is free, a set of children that all put each other in question: nothing is then dropped silently, each gets its own stop as before.
 */
function nextToOpen(record, state, runsDir, pending) {
  const affectedKeys = new Map(pending.map(p => [nodeKey(p.node, p.generation), new Set(affectedFor({ record, state, runsDir, node: p.node, generation: p.generation }).affected.map(a => nodeKey(a.node, a.generation)))]));
  const free = pending.find(p => !pending.some(q => q !== p && affectedKeys.get(nodeKey(q.node, q.generation)).has(nodeKey(p.node, p.generation))));
  return free ?? pending[0];
}

/** -> the needs_decision_opened events appended (usually none). `verdict` is S1's answer for the record as it stands. */
export function openBlockedChildStops(rootDir, { verdict, now } = {}) {
  const opened = [];
  if (!pendingOf(rootDir, verdict).length) return opened;                       // the common case takes no lock
  withTreeLock(rootDir, () => {
    const done = new Set();                                                     // each node@generation at most once per hold: a repeat ends the loop (fail closed, never a spin)
    for (;;) {
      const record = readTreeRecord(rootDir);                                   // re-read under the lock AND after every append: another sitting may have written it, and a stop just written puts its consumers in question
      if (record.corrupt.length || !record.tree) break;
      const state = stateOf(record);
      const pending = pendingBlockedChildren(record, state, verdict).filter(p => !done.has(nodeKey(p.node, p.generation)));
      if (!pending.length) break;
      const p = nextToOpen(record, state, dirname(rootDir), pending);
      done.add(nodeKey(p.node, p.generation));
      const { affected } = affectedFor({ record, state, runsDir: dirname(rootDir), node: p.node, generation: p.generation });
      opened.push(appendTreeEventLocked(rootDir, { event: 'needs_decision_opened', node: p.node, generation: p.generation, ...(p.runId !== undefined ? { runId: p.runId } : {}), source: 'blocked', blockedBy: p.blockedBy, affected }, now ? { now } : {}));
    }
  });
  return opened;
}
