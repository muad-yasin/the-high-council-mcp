// Registering nodes (0.8.3 M1; PLAN 8.3 steps 0-2, 8.5). The orchestrator side of the record: it writes `node_registered` (never `node_started`: the member's own CLI does that, PLAN 7.6 step 3) and, through a
// function it is given, starts the run. Nothing here spawns a process or spends money: the starter is injected (M5's loop passes api.run), and the grant is just a number the caller computed (M2 owns the arithmetic).
//
// Registration is ONE CHILD AT A TIME. A node is active from its `node_registered` until its run ends, so the second child of a frontier cannot be registered until the first has ended; `runFrontier` therefore
// registers a child, starts it, waits for it, then moves to the next. A frontier is idempotent (PLAN 4.4, 12 row 2): children already registered are returned as they are and start nothing, so asking twice leaves one
// `node_registered` and one run folder per child.
import { fanOutOf } from './tree-fan-out.js';
import { TreeRefusal, appendTreeEvent, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { depthOf, nodeKey } from './tree-identity.js';
import { MONEY_EPS, budgetOf, effectiveCapUsd, effectiveLimits, gateTree } from './tree-budget.js';

const parentOf = node => node.split('/').slice(0, -1).join('/') || null;

/**
 * Registers the root: node R, generation 1, run id = the tree id, the WHOLE root cap IN FORCE as its grant (PLAN 8.3 step 0; its authority is the explicit `tree start` request, not a frontier approval). The cap in force is
 * the starting cap unless `--amend-cap` was accepted before the root was registered (it is accepted once `tree_started` is written): before 18 Okt 2026 this read tree.json's starting cap, so a total the person had
 * withdrawn still granted the root (M7 apply, E54).
 * Returns the event. Throws a TreeRefusal when the table does not allow it (no tree_started yet, root already registered...).
 */
export function registerRoot(rootDir, { extra = {}, now } = {}) {
  // ONE hold of the tree lock for the read of the cap in force AND the append: `council tree decide --amend-cap` takes no sitting lock, so an amendment accepted between a read and an append made outside the lock would
  // record a grant at a cap the person had just withdrawn (E54 in a narrower window). The same pattern as registerChildAdmitted.
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const { tree } = record;
    if (!tree) throw new Error(`${rootDir} has no tree.json: start the tree first`);
    const capUsd = effectiveCapUsd(record);
    // fail closed: a grant is money; a cap in force that does not read as a positive finite number (a corrupt cap_amended) grants nothing
    if (record.corrupt.length || !(Number.isFinite(capUsd) && capUsd > 0)) throw new Error(`${rootDir}: the cap in force does not read as a positive number of dollars, so the root is not registered`);
    const chain = tree.chains.find(c => c.depth === 0);
    return appendTreeEventLocked(rootDir, {
      event: 'node_registered', node: 'R', generation: 1, runId: tree.treeId, attempt: 1, depth: 0, parentNode: null, parentRunId: null, frontierKey: null, splitSha256: null,
      chain: { name: chain.name, sha256: chain.sha256 }, grant: { amount: capUsd, unit: 'usd' }, ...extra,
    }, { now });
  });
}

/**
 * UNCHECKED registration: checks only the transition table (an approved frontier, nothing else active, not already registered) and writes. For fixtures and for tests of the table. It knows nothing of the accounting
 * gate, the limits or what the root cap has free: production code registers through `registerChildAdmitted` below. A test pins that nothing under src/ outside this file calls this one.
 * Registers one child of an approved frontier with its first grant, in ONE event (PLAN 8.3 step 1: there is no separate grant event at registration, so no crash leaves a registered node without a grant).
 * `child` = { frontierKey, node, generation, runId, parentRunId, chain: {name, sha256}, grant: {amount, unit}, ...more fields of node_registered }. depth and parentNode are derived from the node path.
 * Returns the event, or throws a TreeRefusal (another node active, frontier not approved, already registered...).
 */
export function registerChildUnchecked(rootDir, child, { now, facts } = {}) {
  const { node, generation } = child;
  return appendTreeEvent(rootDir, { event: 'node_registered', attempt: 1, depth: depthOf(node), parentNode: parentOf(node), ...child }, { now, facts });
}

/**
 * Admission (PLAN 7.2, 7.3): registers one child ONLY after, in ONE hold of the tree lock, the accounting gate passes, the child is admitted against the limits in force (its depth, the children of its frontier, the runs
 * in the tree) and its first grant fits what the root cap still has free (`grant <= available`), and covers the chain's cheapest end when `child.cheapestUsd` is given. Anything else writes a `blocked` record
 * (reason continuation_refused, check `admission`, the "not admitted: ..." words of PLAN 7.3) and throws a TreeRefusal: nothing is registered, no run folder is made. M5's tree loop MUST register through THIS (DECISIONS,
 * 8 Oct), not through registerChildUnchecked.
 */
export function registerChildAdmitted(rootDir, child, { now, facts } = {}) {
  // C&C, M5 (DECISIONS Q1, half 1): every child registration carries the bundle it was derived with. This is the ONLY production writer of one, so requiring it here closes every production path to a child
  // that is not tied to a bundle (the start-time refusal of a hand-edited record is outside the record's trust model and goes on the roadmap).
  if (typeof child.bundleSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(child.bundleSha256)) throw new TypeError('registerChildAdmitted: a child is registered with the sha256 of its input bundle (bundleSha256, 64 hex characters)');
  if (!Number.isInteger(child.bundleBytes) || child.bundleBytes < 1) throw new TypeError('registerChildAdmitted: a child is registered with the byte size of its input bundle (bundleBytes, a whole number of 1 or more)');
  const key = nodeKey(child.node, child.generation);
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const refuse = (reason, check, detail) => {
      appendTreeEventLocked(rootDir, { event: 'blocked', reason, scope: key, transition: 'node_registered', ...(check ? { check } : {}), detail }, { facts, now });
      throw new TreeRefusal({ code: reason, transition: 'node_registered', reason: detail, check });
    };
    if (record.corrupt.length || !record.tree) return appendTreeEventLocked(rootDir, { event: 'node_registered', attempt: 1, depth: depthOf(child.node), parentNode: parentOf(child.node), ...child }, { facts, now });   // throws record_corrupt / not started
    const gate = gateTree(rootDir, { record });
    if (!gate.ok) refuse('accounting_blocked', null, `the accounting gate fails: ${gate.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ')}`);
    const state = stateOf(record);
    const limits = effectiveLimits(record.tree, record.events);
    const siblings = fanOutOf(state, child.frontierKey);       // C2b-2: registered children AND the slots filled by a finished run of an earlier plan (src/tree-fan-out.js)
    if (depthOf(child.node) > limits.maxDepth) refuse('continuation_refused', 'admission', `${key}: not admitted: depth limit (${depthOf(child.node)} > ${limits.maxDepth})`);
    if (siblings >= limits.maxChildrenPerSplit) refuse('continuation_refused', 'admission', `${key}: not admitted: fan-out limit (${siblings} of ${limits.maxChildrenPerSplit} children of this split are registered)`);
    if (state.nodes.size + 1 > limits.maxRuns) refuse('continuation_refused', 'admission', `${key}: not admitted: run limit (${state.nodes.size} runs, limit ${limits.maxRuns})`);
    const budget = budgetOf(rootDir, { record, gate });
    const grant = child.grant?.amount;
    if (!(grant > 0) || grant > budget.availableUsd + MONEY_EPS) refuse('continuation_refused', 'admission', `${key}: not admitted: budget (a grant of ${grant} does not fit the ${budget.availableUsd.toFixed(4)} the root cap has free)`);
    if (Number.isFinite(child.cheapestUsd) && grant + MONEY_EPS < child.cheapestUsd) refuse('continuation_refused', 'admission', `${key}: not admitted: budget (a grant of ${grant} is under the chain's cheapest end ${child.cheapestUsd})`);
    const { cheapestUsd, ...fields } = child;
    return appendTreeEventLocked(rootDir, { event: 'node_registered', attempt: 1, depth: depthOf(child.node), parentNode: parentOf(child.node), ...fields }, { facts, now });
  });
}

/**
 * FIXTURE HELPER (M1/M2 tests): registers and runs the children of one approved frontier in LIST order, one at a time. Production does not use it: src/tree-loop.js chooseNextChild is the one scheduler (dependency order
 * and provider eligibility); a test scans src/ for any other user. Registers and runs the children of one approved frontier, in order, one at a time. `startChild(child)` is called after each registration and awaited; it should run the member to its end or its pause
 * (api.run with `treeNode`). A child that is already registered is skipped (it is never registered twice and starts nothing: recovery owns a registered node that never started). If a node is still active after a
 * start (paused at an external seat), the rest wait. Returns [{ node, generation, status: 'registered' | 'existing' | 'waiting', event? }].
 */
export async function runFrontier(rootDir, frontier, { startChild, now, facts, register = registerChildAdmitted } = {}) {
  const out = [];
  for (const child of frontier.children) {
    const key = nodeKey(child.node, child.generation);
    const state = stateOf(readTreeRecord(rootDir));
    if (state.nodes.has(key)) { out.push({ node: child.node, generation: child.generation, status: 'existing' }); continue; }
    if (state.active !== null) { out.push({ node: child.node, generation: child.generation, status: 'waiting', activeNode: state.active }); continue; }
    const event = register(rootDir, { frontierKey: frontier.frontierKey, ...child }, { now, facts });
    out.push({ node: child.node, generation: child.generation, status: 'registered', event });
    await startChild({ rootDir, ...child, grant: event.grant });
  }
  return out;
}
