// Crash recovery for a tree (0.8.3 M1; PLAN 8.3). Recovery reads `events.jsonl` first (after the tail rule, which the writer applies) and completes or blocks each interrupted transition using the authorization
// ALREADY recorded, never a new one. `planRecovery` is pure: it takes the record and facts about each run folder and returns the actions, in the order PLAN 8.3 gives them; `recoverTree` applies the ones that are
// only record writes and hands the rest (start, resume, register the next child) to the caller's functions. It spawns nothing itself: the orchestrator (M5) owns that.
//
// Order (one group per pass; the caller plans again after the appends):
//   1. completed outcomes first: a run whose report.json or cap-stop record exists but whose node_closed / node_stopped is missing gets it appended;
//   2. a dead post-run execution (a node_resumed with purpose post_run, no node_released after, its process gone on this host): node_released, which releases only that claim. The purpose is on the record so an
//      ordinary execution is never released as though it were a post-run call;
//   3. an interrupted decision (decision_recorded with no generation_opened): the generation_opened it authorized;
//   4. a tree.json with no events gets its tree_started; an empty tree (started, no node) registers its root;
//   5. the active node: registered but never started -> start it with the registered run id and the grant its node_registered carries (when its folder already has a run.json it is RESUMED, as the same attempt: a
//      `--run-id` for an existing folder is refused, and the member's own claim picks node_started vs node_resumed from the record); started or resumed with a dead process, run not ended and not paused at an
//      external seat -> an interrupted ordinary execution: resume the same node, folder, attempt and grant; started but no folder or run.json -> accounting_blocked; a claim from another host is never judged
//      stale from here and waits for a person; a run paused at an external seat waits for its answer file and `tree resume`;
//   6. a frontier interrupted part-way: previewed and not approved -> await approval (previewing again is a no-op); approved -> register only its remaining children, one at a time (a child is active from its
//      registration, so the next one waits for the one before to end).
// A corrupt record is not recovered: the only action is `blocked`.
import { hostname } from 'node:os';
import { approvalValid, claimAlive, foldRecord, unansweredAdviceOf } from './tree-transitions.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord } from './tree-record.js';
import { returnedUsdOf, unreadableFloorOf } from './tree-budget.js';
import { keepPlanCopy, waitsForChoice } from './tree-member.js';
import { pendingChoiceOf, replacedOf } from './tree-choice.js';

/**
 * Q3 (C&C, a recorded deviation from PLAN 8.4's wording "the affected nodes below the root"): only the TOPMOST affected nodes get a replacement; a descendant comes back through its parent's new split. S8 (rulings row 130): the root is
 * one too, BUT ONLY FOR A ROOT RE-PLAN (`root: true`, the decision's replansRoot): R is then topmost by definition, so every other affected node is below it and only R@g+1 is opened. A decision that does not re-plan the root (a root
 * milestone resolution answers a root stop in place; the stop's `affected` still lists R) leaves R out, as before S8: the root is not replaced by it.
 * An affected node nobody ever registered counts like any other: it enters at generation + 1 as a fresh admission.
 */
export function topmostOf(all, { root = false } = {}) {
  const affected = root ? all : all.filter(a => a.node !== 'R');
  return affected.filter(a => !affected.some(b => b !== a && a.node.startsWith(`${b.node}/`)));
}

/**
 * The path and generation a decision opens for one listed node (the topmost affected). Without an adoption it is the node's own path one generation up, as ever. A node that is ADOPTED (it fills a slot of a newer plan), or lies INSIDE an adopted branch (a record older than the closure
 * rule may list only such a node), is planned again as its SLOT (option 4: planning any part of a reused branch plans the whole slot): ONE above every generation of the slot's path that is registered or opened (and above the slot's own number), the number `childGenerationOf` gives a replacement.
 * A root re-plan is untouched. Pure over the folded state.
 */
export function openingTargetOf(state, a, { root = false } = {}) {
  const key = `${a.node}@g${a.generation}`;
  const rootKey = root ? undefined : (state.adopted?.has(key) ? key : state.adoptedBelow?.get(key));
  const adoption = rootKey === undefined ? undefined : state.adopted?.get(rootKey);
  if (!adoption) return { node: a.node, generation: a.generation + 1 };
  const path = adoption.slot.replace(/@g\d+$/, '');
  const registered = [...state.nodes.values()].filter(n => n.node === path).map(n => n.generation);
  return { node: path, generation: Math.max(Number(/@g(\d+)$/.exec(adoption.slot)[1]), state.maxOpened?.get(path) ?? 0, ...registered) + 1 };
}
/** The `generation_opened` an unopened decision authorizes: the topmost affected nodes, each through `openingTargetOf` (a root re-plan: R only). One definition for the interrupted-re-plan step and the general `opening` step. */
export const openingOf = state => ([id, d]) => ({ action: 'append', event: { event: 'generation_opened', decisionId: id, nodes: topmostOf(d.affected, { root: d.replansRoot === true }).map(a => openingTargetOf(state, a, { root: d.replansRoot === true })) } });
const keyOf = n => `${n.node}@g${n.generation}`;
const foreign = (claim, facts) => !!claim && claim.host !== (facts.host ?? hostname());     // a claim from another host is never judged stale from here (PLAN 8.3)

function endEventFor(n, end, runDir, floorUsd) {
  // MONEY fails closed (C&C, M5f fix-up): a close with no run folder to read the spend from would give the WHOLE grant back (spend counted as 0), the one direction this accounting never errs in
  if (end.kind !== 'stopped' && typeof runDir !== 'string') throw new TypeError('endEventFor: a closing event needs the run folder (runFactsOf must return runDir): its spend decides what goes back to the pool');
  const base = { node: n.node, generation: n.generation, runId: n.runId };
  return end.kind === 'stopped'
    ? { event: 'node_stopped', ...base, reason: 'budget' }
    // M5c2 (found by test/tree-run.test.js): the thin-contract pin is part of the closing event (M4: a consumer's derivation refuses a provider with no recorded pin), so a closing event written from the run's files carries it too
    : { event: 'node_closed', ...base, outcome: end.outcome, passed: end.passed, status: end.status ?? null, share: end.share, ...(typeof end.thinContractSha256 === 'string' ? { thinContractSha256: end.thinContractSha256 } : {}),
      // restore gap 2a: a close written from the run's files carries the body hash (entry 3 left it out of this writer, so a recovered node could never be restored); the audit copy is written by recoverTree right BEFORE the append (planRecovery stays pure: it only says what it would keep)
      ...(typeof end.deliveredBodySha256 === 'string' ? { deliveredBodySha256: end.deliveredBodySha256 } : {}),
      // M5f (C&C): the grant a close gives back to the pool is written by EVERY closing writer through the one function (the member's exit hook and `--close` use it too); a close written from the run's files
      // without it never released its share, so the L17 offer (a budget-refused child proposed again) never fired for a tree that recovery closed. `runDir` is required (a TypeError otherwise) and is given by the production facts (runFactsOfIn).
      returnedUsd: returnedUsdOf(n, runDir, floorUsd) };
}

/**
 * The actions recovery would take. `runFactsOf(runId)` -> { hasRunJson, runDir (the run folder: the closing figure reads its spend), end: null | { kind: 'closed', outcome, passed, status, share } | { kind: 'stopped' }, paused } (see src/tree-member.js `runEndOf`
 * and `pausedAtExternalSeat`). `facts` is passed to the liveness check (`pidAlive`, `host`), so a test can name a dead process.
 * Each action is one of: { action: 'append', event } | { action: 'start', node, generation, runId, grant } | { action: 'resume', node, generation, runId, firstStart } |
 * { action: 'register_root' } | { action: 'register_next', frontierKey } | { action: 'await_approval', frontierKey } | { action: 'wait_for_answer', node, generation } |
 * { action: 'wait_for_person', node, generation, reason } | { action: 'blocked', reason }.
 */
export function planRecovery(record, { runFactsOf, facts = {}, now = () => Date.now() } = {}) {
  const nowOf = () => facts.nowMs ?? now();
  if (record.corrupt.length) return [{ action: 'blocked', reason: 'record_corrupt', detail: record.corrupt.map(c => c.reason).join('; ') }];
  if (record.tree && !record.events.length) return [{ action: 'append', event: { event: 'tree_started', treeId: record.tree.treeId, treeJsonSha256: record.treeSha256 } }];
  const state = foldRecord(record.events);
  if (!state.started) return [];
  // F2b (the crash window; C&C gate 1 on F2b_Crash_Window_Quarter_Page.md): a root re-plan is TWO records in one lock hold, `decision_recorded {replansRoot}` then `generation_opened`. A kill between them leaves a decision that
  // is answered (so `decide` has nothing to answer) and, for an obligation root stop, a sticky `root_affected` block that only the era boundary - the very record that is missing - clears. Finishing the decision therefore goes
  // AHEAD of the sticky check, and only for a replansRoot decision (the same record the writer appends: R@g+1). `record_corrupt` returns above, so it still wins; the opening is record-only and starts nothing.
  const interrupted = [...state.decisions].filter(([, d]) => d.replansRoot === true && !d.generated);
  if (interrupted.length) return interrupted.map(openingOf(state));
  // ROADMAP 77: a recommendation request with NO call whose wait for the brief's approval has run out (or whose claim is dead) is ended here, so its hold is released by the next sitting or decide without anyone asking. Record-only. A request WITH calls is
  // reconcileAdvice's (a call may outlive the process that registered it, and its folder says whether it ended).
  const unanswered = unansweredAdviceOf(state, { ...facts, nowMs: nowOf() });
  if (unanswered.length) return unanswered.map(x => ({ action: 'append', event: { event: 'advice_ended', ...x } }));
  if (state.sticky.size) return [{ action: 'blocked', reason: [...state.sticky.keys()].join(', ') }];
  const nodes = [...state.nodes.values()];
  const factsOf = n => runFactsOf(n.runId);

  // M5 row 3: a completed run is reconciled only when its claim's process is gone on this host (or the claim is none): while the member's own exit hook may still be about to write its end event, recovery must not race it
  const reconcile = nodes.filter(n => n.phase === 'running' && factsOf(n).end && !waitsForChoice(factsOf(n).end) && !(n.claim && claimAlive(n.claim, facts))).map(n => {
    const end = factsOf(n).end; const runDir = factsOf(n).runDir;
    const a = { action: 'append', event: endEventFor(n, end, runDir, unreadableFloorOf(record, n.runId)) };
    if (end.kind === 'closed') Object.defineProperty(a, 'keep', { value: { runDir, body: end.body ?? null }, enumerable: false });     // what recoverTree writes as the audit copy before the append; non-enumerable so a plan compared or printed shows only the event
    return a;
  });
  if (reconcile.length) return reconcile;

  const released = nodes.filter(n => n.postRun && !claimAlive(n.postRun, facts)).map(n => ({ action: 'append', event: { event: 'node_released', node: n.node, generation: n.generation, runId: n.runId, reason: 'dead_post_run' } }));
  if (released.length) return released;

  const opening = [...state.decisions].filter(([, d]) => !d.generated).map(openingOf(state));
  if (opening.length) return opening;

  if (!nodes.some(n => n.node === 'R')) return [{ action: 'register_root' }];

  const out = [];
  for (const n of nodes) {
    if (n.phase === 'registered') {
      const f = factsOf(n);
      out.push(f.hasRunJson ? { action: 'resume', node: n.node, generation: n.generation, runId: n.runId, firstStart: true } : { action: 'start', node: n.node, generation: n.generation, runId: n.runId, grant: n.grant });
    } else if (n.phase === 'running') {
      const f = factsOf(n);
      if (foreign(n.claim, facts)) out.push({ action: 'wait_for_person', node: n.node, generation: n.generation, reason: `its claim is from host ${n.claim.host}` });
      else if (claimAlive(n.claim, facts)) continue;                                       // in progress
      else if (waitsForChoice(f.end) && !replacedOf(state, keyOf(n)) && pendingChoiceOf(f.runDir, n)) out.push({ action: 'resume', node: n.node, generation: n.generation, runId: n.runId, firstStart: false, choice: pendingChoiceOf(f.runDir, n).choice });      // member verb: the person's choice for this stop is recorded: `tree resume` applies it
      else if (waitsForChoice(f.end)) out.push({ action: 'wait_for_person', node: n.node, generation: n.generation, reason: f.end.kind === 'conflict_stopped' ? 'conflict_stop' : 'round_stop' });      // round semantics 2b: the run stopped at its overseer limit and waits for a choice; a sitting must not resume it
      else if (f.paused) out.push({ action: 'wait_for_answer', node: n.node, generation: n.generation });
      else if (!f.hasRunJson) out.push({ action: 'blocked', reason: 'accounting_blocked', node: n.node, generation: n.generation, detail: `${keyOf(n)} started but its run folder or run.json is missing` });   // derived: the gate refuses the next start (PLAN 8.3, 7.2)
      else out.push({ action: 'resume', node: n.node, generation: n.generation, runId: n.runId, firstStart: false });
    } else if (foreign(n.postRun, facts)) {
      out.push({ action: 'wait_for_person', node: n.node, generation: n.generation, reason: `its post-run claim is from host ${n.postRun.host}` });
    }
  }
  if (out.length) return out;

  for (const [frontierKey, f] of state.frontiers) {
    if (f.previewed && !f.revisions.length) { out.push({ action: 'await_approval', frontierKey }); continue; }
    if (!approvalValid(f) || state.active !== null) continue;
    // WHICH child is next is not decided here: src/tree-loop.js chooseNextChild is the one scheduler (dependency order and provider eligibility, PLAN 8.1); recovery only says a frontier has children left
    if (f.children.some(c => !c.reused && !state.nodes.has(`${c.node}@g${c.generation}`)))       // C2b-2: a slot filled by a finished run is never registered, so it is not a child left to register
     out.push({ action: 'register_next', frontierKey });
  }
  return out;
}

/**
 * Applies recovery: record-only actions are appended (then the record is read and planned again); the first run action is handed to the matching function in `deps` (`startNode`, `resumeNode`,
 * `registerRoot`, `registerNext`, each may be async). Returns { applied: [action...], pending: [action...] }: `pending` holds what only a person or a later step can do (await_approval, wait_for_answer,
 * wait_for_person, blocked). Stops after the first run action: only one node is ever active.
 */
export async function recoverTree(rootDir, { runFactsOf, facts, now, startNode, resumeNode, registerRoot, registerNext, beforeAppend } = {}) {
  const applied = [];
  let replanned = false;
  if (foldRecord(readTreeRecord(rootDir).events).abandoned) return { applied, pending: [] };       // ROADMAP 57: an abandoned tree is final; the table would refuse every append below, and each refusal writes a `blocked` line (d5dbd25's refuse-and-retry would write two)
  for (let pass = 0; pass < 100; pass++) {
    const actions = planRecovery(readTreeRecord(rootDir), { runFactsOf, facts, ...(now ? { now } : {}) });
    const appends = actions.filter(a => a.action === 'append');
    if (appends.length) {
      // The plan above is read OUTSIDE the lock and each append takes it, so a writer (a `decide` whose second append lands, another sitting) can move the record in between: the table then refuses the planned record (an
      // opening that is already open, say). That is a stale plan, not a broken tree: plan again ONCE from a fresh read. A second refusal in the same call is real and propagates.
      try { for (const a of appends) { beforeAppend?.(a); appendTreeEvent(rootDir, a.keep ? { ...a.event, ...keepPlanCopy(a.keep.runDir, a.keep.body) } : a.event, { facts, now }); applied.push(a); } }     // the audit copy is written HERE, immediately before the append (one write path: keepPlanCopy), never while planning
      catch (e) { if (e instanceof TreeRefusal && !replanned) { replanned = true; continue; } throw e; }
      continue;
    }
    const run = actions.find(a => ['start', 'resume', 'register_root', 'register_next'].includes(a.action));
    if (run) {
      const fn = { start: startNode, resume: resumeNode, register_root: registerRoot, register_next: registerNext }[run.action];
      if (typeof fn === 'function') { await fn(run); applied.push(run); }
      return { applied, pending: actions.filter(a => a !== run && !['start', 'resume', 'register_root', 'register_next'].includes(a.action)) };
    }
    return { applied, pending: actions };
  }
  throw new Error('recoverTree: more than 100 passes; the record is not settling');
}
