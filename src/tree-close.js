// `council tree decide --close <node>` (0.8.3 M5d, sub-commit 4; PLAN 7.5, 8.5 last row, 10.1): the person ends a node that will not finish. The library function closeIncomplete is the ONLY writer of a
// `node_closed` with outcome `incomplete` (the table refuses one without the gate that authorized it); it re-checks under the tree lock, because the table's node_closed rule does not look at claims and a member
// could claim between the form's last rebuild and the append. Not exported by src/api.js, the types or any MCP tool (the M2 pin).
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { DEAD_REASON, claimAlive, deadKeys } from './tree-transitions.js';
import { runEndOf, pausedAtExternalSeat, waitsForChoice } from './tree-member.js';
import { readStoppedMarker } from './stop-files.js';
import { priceStopKindOf, priceStopStatus } from './tree-price-stop.js';
import { closeReturnOf, unreadableFloorOf } from './tree-budget.js';
import { affectedFor } from './tree-affected.js';
import { pendingChoiceOf, replacedOf } from './tree-choice.js';

const keyOf = n => `${n.node}@g${n.generation}`;

/**
 * Why a node cannot be closed by a person right now, or null: { reason, kind }. ONE function for the form (before it asks anybody) and for closeIncomplete (under the lock).
 *  - the root (PLAN 7.5/8.5/10.1 give `--close` no meaning for R: a closed R is refused by the table, and ending the tree is `council tree stop`);
 *  - a live claim, on this host or another (a claim from another host is never judged dead from here);
 *  - a post-run call in flight;
 *  - a run that already ended (report.json or STOPPED-budget.json on a node that is `running`): it is not interrupted, it ended without its end event, and `council tree resume` records how it ended.
 */
export function closeRefusal({ state, runsDir, node, generation = 1, facts = {}, rootId = null }) {
  const n = state.nodes.get(`${node}@g${generation}`);
  if (!n) return { kind: 'unknown', reason: `no such node in this tree: ${node}` };
  if (n.node === 'R') return { kind: 'root', reason: `the root cannot be closed as a node; to end the whole tree for good use \`council tree decide ${rootId ?? '<tree id>'} --abandon\`, or \`council tree stop\` to start nothing further for now` };
  if (n.postRun) return { kind: 'post_run', reason: `${keyOf(n)} is in a post-run paid call (pid ${n.postRun.pid}); it ends the call first` };
  if (n.phase === 'closed') return { kind: 'closed', reason: `${keyOf(n)} is already closed` };
  // already-false unit (M1; C&C ruling 23 Okt 2026): only `registered` and `stopped` reach this line (`closed` and `post_run` were refused above, and `running` is not refused here), so the verb has two cases: a stopped node DID start and is never resumed, a registered one never starts.
  // already-false unit (M1; C&C ruling 23 Okt 2026): the same condition as tree-budget.js nodeMoneyOf's hold (dead and not running): the node holds nothing and can never start, so a close would release nothing and its screen could only say a grant comes back twice. A dead node that RUNS keeps its hold and stays closable.
  if (n.phase !== 'running' && deadKeys(state).has(keyOf(n))) return { kind: 'dead', reason: `${keyOf(n)} is dead: it was ${DEAD_REASON}, so it holds no money and ${n.phase === 'stopped' ? 'is never resumed' : 'can never start'}. Nothing is left to close here; \`council tree status ${rootId ?? '<tree id>'}\` shows what is registered now` };       // A-DRAFT
  if (n.phase === 'running' && claimAlive(n.claim, facts)) return { kind: 'claim', reason: `${keyOf(n)} is running: pid ${n.claim.pid} on ${n.claim.host} holds its claim${n.claim.host === (facts.host ?? hostname()) ? ' and is alive' : ' (another host: never judged dead from here)'}` };
  if (n.phase === 'running' && (end => end && !waitsForChoice(end))(runEndOf(join(runsDir, n.runId)))) return { kind: 'ended', reason: `${keyOf(n)}'s run already ended (its folder holds the end); \`council tree resume\` records how it ended, and closing it here would overwrite a real result` };
  return null;
}

/**
 * What the node is doing, as one kind: the ONE reading behind describePhase's words and behind every sentence that must not steer a person to end a run that waits for THEM (a root re-plan's "a node is active" refusal,
 * src/tree-root-replan.js). 'registered' | 'stopped' (budget cap) | 'round_stopped' | 'conflict_stopped' | 'price_refused' | 'external_pause' | 'interrupted' (running on paper, process gone) | the phase itself otherwise.
 */
export function phaseKindOf(n, runsDir) {
  if (n.phase === 'registered') return 'registered';
  if (n.phase === 'stopped') return 'stopped';
  if (n.phase !== 'running') return n.phase;
  const dir = join(runsDir, n.runId);
  const end = runEndOf(dir)?.kind;
  if (end === 'round_stopped' || end === 'conflict_stopped') return end;
  if (readStoppedMarker(dir)?.stoppedBy === 'price_refused') return 'price_refused';
  return pausedAtExternalSeat(dir) ? 'external_pause' : 'interrupted';
}
/** The kinds that wait for the person's answer: closing such a node ends a run that waits for them. */
export const WAITS_FOR_PERSON = Object.freeze(['round_stopped', 'conflict_stopped', 'price_refused', 'external_pause']);

/** What the node is, in a few words, for the person: its phase and whether it waits for an external answer. */
/** The name of the chain a node was registered with (its node_registered event; the fold does not keep it), or null. */
export const registeredChainOf = (record, n) => record?.events?.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation)?.chain?.name ?? null;

/** `ctx` = { rootId, chain } for the words that name a runnable command; absent, those words leave the command out. */
export function describePhase(n, runsDir, ctx = {}) {
  switch (phaseKindOf(n, runsDir)) {
    case 'registered': return 'registered, never started';
    case 'stopped': return 'stopped at its budget cap';
    case 'round_stopped': return 'stopped at its overseer limit, not agreed, waiting for a choice';
    case 'conflict_stopped': return 'stopped at a conflict the decider asked you to choose, waiting for your choice';       // B-DRAFT (member verb, conflict ask)
    case 'price_refused': return priceStopStatus(priceStopKindOf(join(runsDir, n.runId)), ctx);       // B-DRAFT (Astra 38; one rule with 31-35)
    case 'external_pause': return 'paused, waiting for an external answer (its NEEDS file stays as it is)';
    case 'interrupted': return 'interrupted (its process is gone)';
    default: return n.phase;
  }
}

/**
 * The words for an ACTIVE node that a decision cannot go past (A-DRAFT, C&C thcmcp-cd 23 Okt 2026, wording only: no rule changes). The fixed sentences the callers used to say ("`--close` ends it", "close it") are false when `--close` is refused and misleading when the
 * node waits for the person's own answer, so the words follow closeRefusal's answer and phaseKindOf, in ONE place: the root re-plan's preflight (src/tree-root-replan.js, route 'a root re-plan') and the sub-plan regenerate's preflight (src/tree-decide-stop.js, route
 * 'a sub-plan regenerate'). A live process or a post-run call is waited for; a run whose folder already holds its end goes to `council tree resume` first (:30-31 above); a node that waits for the person (an external seat, a choice, a price) is answered, not closed; a replaced
 * node is given up. -> the sentence, or null when --close is accepted and nothing waits for the person (registered and never started; a dead claim whose run has not ended): the caller keeps its own sentence, which is true there.
 */
export function activeNodeWords({ state, runsDir, key, route, record = null }) {
  const n = state.nodes.get(key);
  if (!n) return null;
  // describePhase's runnable command (the `--accept-chain-limits` step of a price stop on the seat's own limits) needs the root run id and the chain the node was registered with: both known here (state.treeId; registeredChainOf reads the node_registered event, so the caller passes its `record`); without a record the command is left out (printed whole or not at all)
  const ctx = { rootId: state.treeId, chain: record ? registeredChainOf(record, n) : null };
  const closed = closeRefusal({ state, runsDir, node: n.node, generation: n.generation, rootId: state.treeId });
  if (closed?.kind === 'claim' || closed?.kind === 'post_run') return `${closed.reason}. Wait for it to end, then decide again: ${route} never races a running node`;       // A-DRAFT
  if (closed?.kind === 'ended') return `${closed.reason}. Do that first, then decide again`;       // A-DRAFT
  const kind = phaseKindOf(n, runsDir);
  // a node whose plan was REPLACED (dead, held, kept) cannot be resumed or given a choice: resume prints "cannot be given a choice ... give the node up" (tree-resume.js:114). Same gate as resume: replacedOf. External seat INCLUDED: resume's waiting lines (tree-resume.js:239-243) are printed even for a replaced node, but once the reply is written the member is refused as dead (continuationRefusal, exit 19), so pointing at them would mislead.
  if (replacedOf(state, key) && WAITS_FOR_PERSON.includes(kind)) return `${key} was stopped and waits for a person, but its plan was replaced, so it can no longer be resumed or given a choice. Give it up with \`council tree decide ${state.treeId} --close ${key}\`, then decide again`;       // A-DRAFT
  // a price stop is answered by raising the price FIRST (describePhase's own words say how, then resume): `council tree resume` alone would ask the refused stage again and may cost money (tree-price-stop.js priceStopLines)
  if (kind === 'price_refused') return `${key} is ${describePhase(n, runsDir, ctx)}. Do that first (resume asks the refused stage again and can cost money), then decide again (closing it would end a run that waits for you)`;       // A-DRAFT
  // a round or conflict stop whose choice is ALREADY recorded no longer waits: `council tree resume` applies it and starts the member again (tree-resume.js:247 gate, :253 apply; the SAME replacedOf condition as resume), which can cost money
  if ((kind === 'round_stopped' || kind === 'conflict_stopped') && !replacedOf(state, key) && pendingChoiceOf(join(runsDir, n.runId), n)) return `${key} is stopped and your choice for it is recorded: \`council tree resume ${state.treeId}\` applies it and starts the member again, which can cost money. Do that first, then decide again (closing it would end the run)`;       // A-DRAFT
  // external seat, overseer stop, conflict stop: `council tree resume` prints the way to answer each (tree-resume.js: 'waiting' :113, 'awaiting_choice' :114)
  if (WAITS_FOR_PERSON.includes(kind)) return `${key} is ${describePhase(n, runsDir, ctx)}: it waits for your answer; \`council tree resume ${state.treeId}\` says how to give it. Then decide again (closing it would end a run that waits for you)`;       // A-DRAFT
  return null;
}

/**
 * Everyone who waits for a node that will never settle (PLAN 8.1: a provider's whole subtree must be eligible before a consumer starts): the consumers of the node AND of every ancestor of it (closing R/A/A1 blocks A,
 * so A's consumers wait), then their consumers, by the edges of every verified split block the tree holds. Names only; nothing cascades. -> [{ node, phase, why }] in path order, `phase` null when not registered yet (`replaced: true` too when the path's registration was replaced).
 */
export function consumersWaiting(args) { return waitingFor(args).waiting; }

/** consumersWaiting plus whether the tree's graph could be read: when it could not, every sibling is named and the text must SAY why (C&C, M5e S2). */
export function waitingFor({ record, state, runsDir, node, generation = null }) {
  const { affected, why, graphReadable } = affectedFor({ record, state, runsDir, node, generation });       // C2b-1b: the node being closed is given by (path, generation), so closing an ADOPTED node does not count the new node of its old path
  const latest = new Map();
  for (const n of state.nodes.values()) if (!latest.has(n.node) || latest.get(n.node).generation < n.generation) latest.set(n.node, n);
  // already-false unit (W1): `affected` names each path at its CURRENT generation (generationOf). When the path's newest registration is dead and that generation is not registered, the dead node is not what waits: `phase` is null and `replaced` says why (a path that was never registered stays `replaced`-less)
  const dead = deadKeys(state); const listedGen = new Map(affected.map(a => [a.node, a.generation]));
  return { graphReadable, waiting: affected.map(a => a.node).filter(p => p !== node && !p.startsWith(`${node}/`)).map(p => {
    const l = latest.get(p); const replaced = !!l && listedGen.get(p) > l.generation && dead.has(keyOf(l));
    return { node: p, phase: replaced ? null : l?.phase ?? null, ...(replaced ? { replaced: true } : {}), why: why.get(p) };
  }) };
}

/**
 * Closes a node as `incomplete` by the person's decision (the gate's approval is already used by the caller). Under the tree lock: re-reads the record, applies closeRefusal, and appends
 * `node_closed { outcome: 'incomplete', passed: false, status: null, share: 'released', returnedUsd, gateId, shownSha256 }`. returnedUsd is the grant (first grant plus every top-up) minus runSpentUsd, which counts an
 * unsettled reservation at its worst case, so it is never more than what is really free (the figure errs high on what stays charged). A refusal writes a `blocked` record and throws a TreeRefusal.
 */
export function closeIncomplete(rootDir, { node, generation = 1, gateId, shownSha256, actor, via } = {}, { facts = {}, now } = {}) {
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('closeIncomplete: gateId and shownSha256 (64 hex) are required: closing a node is a decision a person made through the gate');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const state = stateOf(record);
    const runsDir = dirname(rootDir);
    const refusal = closeRefusal({ state, runsDir, node, generation, facts });
    if (refusal) {
      appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'continuation_refused', scope: `${node}@g${generation}`, check: 'close', detail: refusal.reason }, { facts, now });
      throw new TreeRefusal({ code: 'continuation_refused', transition: 'node_closed', reason: refusal.reason });
    }
    const n = state.nodes.get(`${node}@g${generation}`);
    const runDir = join(runsDir, n.runId);
    return appendTreeEventLocked(rootDir, { event: 'node_closed', node, generation, runId: n.runId, outcome: 'incomplete', passed: false, status: null, share: 'released', planCopy: null, returnedUsd: closeReturnOf(n, runDir, unreadableFloorOf(record, n.runId)).returnedUsd, gateId, shownSha256, actor, via }, { facts, now });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- c3b: the close of a child that was never registered
// CONTRACT (0.8.3 M6 S5b part B, c3b; C&C Q1 revised, 12 Oct 2026). A child whose derived input was refused has an open `bundle_input` stop and NO record of its own (c3a). `council tree decide <root> --close <child>` ends it for good:
//   event   node_closed_unstarted { node, generation, stopId, gateId, shownSha256 }   no runId, no money. ONE event, one lock hold: it also ANSWERS the stop it names (the fold's answerStop), so no second write can be lost.
//           Its own name, not a flag on node_closed: node_closed keeps "every close has a run" and its readers never see a run-less one.
//   state   state.closedUnstarted: Map "node@gN" -> { stopId, gateId, shownSha256, at }. NOT a state.nodes row: every row there has a run folder and a grant (gateTree, budgetOf, returnedUsdOf, evidenceOf rely on it).
//   table   node_closed_unstarted: the child is not in the record and not already closed; stopId is an OPEN stop of source bundle_input whose target (its `child`, else its node/generation) is this child; the typed gate fields are there. A DEAD key is
//           accepted (it kills nothing; it is the only exit of a stop whose child was replaced meanwhile). node_registered and a new bundle_input stop refuse a key in closedUnstarted; the generic needs_decision_opened row accepts source
//           'blocked' for one (the closed_incomplete stop of the blocked-child rule, no runId).
//   readers tree-loop (chooseNextChild + registerNextChild skip it; providerEligibility says "closed before it started"), tree-blocked-child pendingOf (opens that blocked stop from closedUnstarted; the generation test counts it via
//           closedUnstartedGenerationOf, because latestGenerationOf sees only nodes and opened generations), tree-ready (facts.closedUnstarted -> reason closed_incomplete "closed before it started", newest live generation only),
//           tree-stop-view (ONE branch for a stop with no runId), tree-decide buildClose (this module's unstartedStopOf finds the stop by the child's path; the root variant through `child`). Listing it in the handoff/report/status is B's (S8-6b part 2).
//   after   the blocked stop is answered by the regenerate form: a new generation of the child (generation_opened names it g+1).

/**
 * The open `bundle_input` stop about the child at `path` (c3b), or null: the stop of a child that was never registered, found by the child's own path - the stop is on the child itself, or on the root with `child` naming it.
 * -> { stop, child: { node, generation } }.
 */
export function unstartedStopOf(record, state, path) {
  for (const id of state.openStops) {
    const e = record.events.find(x => x.id === id);
    if (!e || e.source !== 'bundle_input') continue;
    const child = e.child ?? { node: e.node, generation: e.generation };
    if (child.node === path) return { stop: e, child: { node: child.node, generation: child.generation } };
  }
  return null;
}

/**
 * Closes a child that was NEVER REGISTERED as incomplete, by the person's decision (c3b; the gate's approval is already used by the caller): ONE `node_closed_unstarted` under the tree lock - no run, no grant, $0 - which answers the
 * `bundle_input` stop it names in the same event. The table re-checks everything (the stop is still open and about this child, the child is still not in the record, the gate fields are there); a refusal throws a TreeRefusal.
 */
export function closeUnstarted(rootDir, { node, generation, stopId, gateId, shownSha256, actor, via } = {}, { facts = {}, now } = {}) {
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('closeUnstarted: gateId and shownSha256 (64 hex) are required');
  return withTreeLock(rootDir, () => appendTreeEventLocked(rootDir, { event: 'node_closed_unstarted', node, generation, stopId, gateId, shownSha256, actor, via }, { facts, now }));
}
