// The tree loop, part 1 (0.8.3 M5c1; PLAN 8.1, 8.3, 8.5, 12 rows 2-3): what to verify, WHICH child is next, and registering it. Nothing here starts a run (the starter is part 2) and the tree lock is never held
// across anything slow: every record write is one short hold inside tree-record.js, the derivation and the bundle are written outside any hold, and registration is one `registerChildAdmitted` call.
//
// Three functions, in the order a sitting uses them:
//   verifyClosedNodes   a node that closed and passed and whose plan holds a split block is checked (PLAN 5.5 items 1-4) with the tree's REAL inheritedGlobal / ancestorQuestions (src/tree-frontier.js treeInputsFor):
//                       `split_verified` on success, a `blocked: expansion_refused` record naming the item and the field on a refusal. No folder either way. Once per node: a verified or refused node is not asked again,
//                       EXCEPT a node refused only for a file cause (RECHECKED, D2 F4a), which is asked again at every sitting; each such refusal is written once.
//   chooseNextChild     THE one function that picks the next child of an approved frontier: providers before consumers (src/tree-frontier.js dependencyOrder), and a consumer only when every provider's WHOLE
//                       subtree is eligible (PLAN 8.1: closed, passed, Status not needs_decision, no open stop, not stale, PLAN 5.5 items 1-2 hold and, if it split, item 3). Recovery
//                       (src/tree-recovery.js) names a frontier with children left and steps aside to this function; src/tree-register.js `runFrontier` is a fixture helper (a test scans src/ for any other user).
//   registerNextChild   derive in FULL (providers loaded) -> checks that need no money (the held items are the ones the approval bound, the split is the approved one, the context fits the CLI's limit) ->
//                       write the bundle -> the grant (never above the cap the approval showed) -> `registerChildAdmitted`. A refusal at any step is a `blocked` record, creates no run folder and ends the sitting.
// A held child (a guard refused one of its items, or its chain will not enforce a check) IS registered: approving the frontier is the person's choice and the approval binds the held items (C&C, 9 Oct 2026). A held
// item that is NEW at full derivation (not in the approved preview) is refused: the person runs `tree approve` again.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { MAX_CONTEXT_FILE_BYTES } from './context-files.js';
import { readRunJson } from './run-files.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from './tree-record.js';
import { childNode, nodeKey } from './tree-identity.js';
import { approvalValid, builtFromOf, frontierParentReplaced, retiredParentBy, heldKeys, isSupersededGeneration, keptKeys, latestGenerationOf, liveNodesOf, orphansOf, placeOf, planAuthorityOf, slotHeldBy } from './tree-transitions.js';
import { parentChangedEvent } from './tree-continuation.js';
import { isWithin, subtreeEligible } from './tree-deps.js';
import { milestoneLintOf } from './tree-ready.js';
import { expansionCheck, recordExpansionRefusal, verifySplit } from './tree-expansion.js';
import { DeriveRefusal, deriveChild, itemText, recordDerivationRefusal, recordGuardRefusals, writeBundle } from './tree-derive.js';
import { ChainUnavailable, NotExpandable, loadChainConfig, loadDerivation, readNodePlan, readPlanOf } from './tree-derive-load.js';
import { REOPEN_CHECKS, dependencyOrder, frontierReopened, heldDigest, heldItemsOf, rootReplanBound, rootTaskPathOf, rootTaskTextOf, treeInputsFor } from './tree-frontier.js';
import { registerRootReplan, rootBundle, writeRootBundle } from './tree-root-replan.js';
import { oldPlanOf } from './old-plan.js';
import { effectiveLimits } from './tree-budget.js';
import { registerChildAdmitted } from './tree-register.js';
import { bundleInputCheck, openBundleInputStop, rootTaskCoverage } from './tree-bundle-input.js';
import { treeInputScanModeFrom, treePiiAllowFrom } from './tree-pii-mode.js';
import { MONEY_EPS, allowanceOfDecision, bundleAllowanceBytesOf, budgetOf, chainFigures, ceilCents, gateTree, proposeGrants } from './tree-budget.js';
import { extractSplitBlocks } from './tree-split.js';
import { sha256Of } from './thin-contract.js';

/** The largest context file the CLI accepts (src/context-files.js): a bundle whose context.md is bigger would be refused at the child's start, so it is refused BEFORE it is registered. */
export const CONTEXT_LIMIT_BYTES = MAX_CONTEXT_FILE_BYTES;

const byPath = (a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation);
const closedEventOf = (record, n) => record.events.filter(e => e.event === 'node_closed' && e.node === n.node && e.generation === n.generation && e.runId === n.runId).at(-1) ?? null;
/**
 * What a node's plan says about a split, THREE-valued (T1-7, audit S10-1): 'fence' (the plan reads and holds a split block), 'none' (it reads and holds none), 'unreadable' (report.json or deliverable.md is missing, unreadable, or no longer the text the panel
 * signed: readNodePlan gives plan = null). Until T1-7 "unreadable" and "none" were the same `false`.
 */
export function splitFenceOf(runDir, acceptedBodySha256 = null) {
  const p = readNodePlan(runDir, { acceptedBodySha256 });
  if (!p.plan) return 'unreadable';
  return extractSplitBlocks(p.plan.text).length > 0 ? 'fence' : 'none';
}
// nodesToVerify keeps the boolean (T1-7, D1 accepted by C&C): a plan that does not read is simply not verified, nothing is recorded, and the next sitting asks again - not a one-way door
const holdsSplitFence = (runDir, n) => splitFenceOf(runDir, planAuthorityOf(n)) === 'fence';

/** One `blocked` record per distinct (scope, check, detail): a second sitting that meets the same refusal says it again on screen but does not write it again. Returns whether it wrote. */
function recordBlockedOnce(rootDir, record, fields, { facts, now } = {}) {
  const same = record.events.some(e => e.event === 'blocked' && e.scope === fields.scope && e.check === fields.check && e.detail === fields.detail);
  if (same) return false;
  appendTreeEvent(rootDir, { event: 'blocked', reason: 'expansion_refused', ...fields }, { facts, now });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- verifying closed nodes

// D2 F4a (2C-1, B15 ordering (i)): the verify-time refusals whose cause is a FILE outside the plan's own output, asked again at every sitting until the split verifies. An ancestor's plan that did not read; a sealed file that differed
// (the run-folder refusal included); a root task that could not be read (G1's no-route refusal, C&C's G1 obligation); a reference that did not resolve (`context_refs`, C&C 25 Okt 2026, Q1 of T's G2 plan: below the root the root task is
// read live, so an edited root task refuses there too; a reference the plan's own text got wrong gives the same answer again and writes nothing new, recordExpansionRefusal `once`). Every other check is the plan's own output: a
// byte-identical plan gives the same answer, so it is asked once.
// root_task_changed (C&C's Q5 ruling B): the root task differs from the pin; putting it back verifies the split again.
export const RECHECKED = Object.freeze(['ancestor_questions', 'contract_check', 'root_task_unreadable', 'root_task_changed', 'context_refs']);

/**
 * The closed, passed nodes whose plan holds a split block that no `split_verified` and no expansion refusal names yet. (A leaf has no block: nothing to verify, nothing recorded.)
 * `recheck` (D2 F4a): a node whose only verify-time refusals are RECHECKED checks is named again. Only the SITTING asks for it (verifyClosedNodes). The default stays "any refusal is final" because the root re-plan form's
 * unverified-split guard (src/tree-decide-stop.js) reads this list: a node refused for a file that still differs must not hold a re-plan, or the printed route ("run `council tree resume`, then decide") loops while the file
 * differs (D3 F4-2). A node never attempted still holds it.
 */
export function nodesToVerify({ record, state, runsDir, holdsSplit = holdsSplitFence, recheck = false }) {
  const verified = new Set(record.events.filter(e => e.event === 'split_verified').map(e => `${nodeKey(e.node, e.generation)}:${e.runId}`));
  const refused = new Set(record.events.filter(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.transition === 'expansion' && !(recheck && RECHECKED.includes(e.check))).map(e => e.scope));
  const out = [];
  for (const n of [...state.nodes.values()].sort(byPath)) {
    if (n.phase !== 'closed') continue;
    const key = nodeKey(n.node, n.generation);
    if (verified.has(`${key}:${n.runId}`) || refused.has(key)) continue;
    if (closedEventOf(record, n)?.passed !== true) continue;
    if (!holdsSplit(join(runsDir, n.runId), n)) continue;
    out.push(n);
  }
  return out;
}

/** Verifies every node `nodesToVerify` names, in path order. -> [{ node, generation, refusal: null | {item, check, field, detail}, sha256 }]. */
export function verifyClosedNodes(rootDir, { work, facts, now, deps = {} } = {}) {
  const verify = deps.verify ?? verifySplit;                                          // the seam a test uses to see the arguments (the tree's real lists)
  const record = readTreeRecord(rootDir);
  if (record.corrupt.length) return [];       // CR-RC-002: nothing is verified against, or appended to, a record that does not read; restoreClosedStops (the record-only phase's other writer, src/tree-restore.js) and detectStops (src/tree-detect.js) guard the same way, and the caller's corrupt check says so
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  const out = [];
  for (const n of nodesToVerify({ record, state, runsDir, holdsSplit: deps.holdsSplit, recheck: true })) {
    // PLAN 5.3 checks 3 and 8 never run "by silence": the lists are the tree's own, and a path whose ancestor plan cannot be read is refused rather than checked against less
    const inputs = treeInputsFor({ record, state, runsDir, node: n.node });
    if (inputs.unreadable.length) {
      const refusal = { item: 4, check: 'ancestor_questions', field: 'ancestors', detail: `the plan of ${inputs.unreadable.join(', ')} cannot be read, so PLAN 5.3 check 8 cannot be applied` };
      recordExpansionRefusal(rootDir, n, refusal, { facts, now, once: true });                  // asked again at every sitting (RECHECKED): the same refusal is written once
      out.push({ node: n.node, generation: n.generation, refusal, sha256: null });
      continue;
    }
    const v = verify(rootDir, { node: n.node, generation: n.generation, runId: n.runId, runDir: join(runsDir, n.runId), work, inheritedGlobal: inputs.inheritedGlobal, ancestorQuestions: inputs.ancestorQuestions }, { facts, now });
    out.push({ node: n.node, generation: n.generation, refusal: v.refusal, sha256: v.sha256 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the next child

/** { eligible, why } for one provider path: the provider and everything below it, at the newest generation of each path, as the record and the run folders stand now (PLAN 8.1). */
export function providerEligibility({ record, state, runsDir, work, deny = null }, providerPath) {
  // ORPHANS are dead with their replaced parent (src/tree-transitions.js orphansOf): they are not part of the provider's subtree, and a path whose only node is an orphan counts as not registered yet
  const orphans = orphansOf(state);
  // C2b-1b: the subtree is read by PLACE (the plan in force): an adopted node fills the slot it was adopted into, and a new node on its old path is another place
  const liveNodes = liveNodesOf(state, [...state.nodes.values()].filter(n => !orphans.has(nodeKey(n.node, n.generation))));
  const subtree = liveNodes.filter(n => isWithin(placeOf(state, n), providerPath)).sort(byPath);
  if (!subtree.some(n => placeOf(state, n) === providerPath)) {
    // M6 S0 (a): a path whose registrations are ALL orphans is not "not registered yet" (that promises it is only a matter of time): they are dead with the plan their parent replaced, and the path is registered again only if the new plan names it
    const dead = [...state.nodes.values()].filter(n => n.node === providerPath && orphans.has(nodeKey(n.node, n.generation))).map(n => n.generation).sort((a, b) => a - b);
    if (dead.length) {
      const parentPath = providerPath.slice(0, providerPath.lastIndexOf('/'));
      return { eligible: false, why: [`${providerPath} is not registered: every registration of it (generation${dead.length > 1 ? 's' : ''} ${dead.join(', ')}) belonged to a plan that ${parentPath}@g${latestGenerationOf(state, parentPath)} replaced and is dead with it; it is registered again only if the new plan names it and its frontier is approved`] };
    }
    return { eligible: false, why: [`${providerPath} is not registered yet`] };
  }
  // C2b-1b: a stop is matched by PATH, as before, except on a path that an adopted node (or one below it) shares with another node: there the stop belongs to the one node it names (path AND generation), so the adopted node and the new node of its path do not share it. Nothing else changes.
  const openStopEvents = state.openStops.map(id => record.events.find(e => e.id === id)).filter(e => e && e.node);
  const adoptedPaths = new Set([...state.nodes.values()].filter(x => state.adopted?.has(nodeKey(x.node, x.generation)) || state.adoptedBelow?.has(nodeKey(x.node, x.generation))).map(x => x.node));
  const stopOn = n => openStopEvents.some(e => e.node === n.node && (!adoptedPaths.has(n.node) || e.generation === n.generation));
  const facts = subtree.map(n => {
    const runDir = join(runsDir, n.runId);
    const ev = closedEventOf(record, n);
    const closed = n.phase === 'closed';
    // expansionCheck always runs items 1-3 (its `upTo` only gates item 4), and a leaf has no block, so for a leaf it ends at item 3 `no_split`: that refusal means items 1-2 held and there is nothing to reproduce
    const r = closed ? expansionCheck({ runDir, work, upTo: 3, deny, accepted: planAuthorityOf(n) }).refusal : { item: 0, check: 'not_closed' };
    // the milestone kinds of its split, for the ONE status policy (src/tree-deps.js statusPolicyOk): `partial` needs a decompose milestone, `needs_decision` a needs-decision one
    const ms = closed ? (readPlanOf(runsDir, n).block?.milestones ?? []) : [];
    // M6 (owner's yes 11 Oct, "the stop" route; C&C's OPTION A, rulings rows 120 and 128): the SAME lint input the readiness rule reads (report.json handoff_milestones), so a provider whose lint fails the status policy - or that records no
    // lint at all (null) - is not eligible either: no consumer registers on a provider that can never be ready. src/tree-deps.js subtreeEligible judges it, with no exception.
    const report = closed ? readRunJson(runDir, 'report.json') : undefined;
    const lint = closed ? milestoneLintOf(report) : undefined;
    return {
      lint, reportUnreadable: closed && !report,
      hasDecompose: ms.some(m => m.status === 'decompose'), hasNeeds: ms.some(m => m.status === 'needs-decision'), statusAccepted: state.accepted?.has(nodeKey(n.node, n.generation)) === true,
      node: n.node, closed, passed: ev?.passed === true, incomplete: ev?.outcome === 'incomplete', status: ev?.status ?? null,
      openStop: stopOn(n),
      staleBecause: state.staleWhy.get(nodeKey(n.node, n.generation)) ?? [], staleSources: state.staleSrc.get(nodeKey(n.node, n.generation)) ?? [],
      itemsOk: closed && (!r || r.item >= 3),
      hasBlock: closed && (!r || r.check !== 'no_split'), blockOk: closed && !r,
    };
  });
  const base = subtreeEligible(facts);
  // PLAN 8.1: "no unresolved milestones": a provider that split is not settled while one of its decompose milestones has no registered child (unexpanded, or its frontier not approved/registered yet), and a
  // needs-decision milestone is settled only by its milestone_resolved. Its children, once registered, are part of the subtree above.
  const unsettled = [];
  for (const n of subtree) {
    if (n.phase !== 'closed') continue;
    const block = readPlanOf(runsDir, n).block;
    for (const m of block?.milestones ?? []) {
      if (m.status === 'decompose') {
        const child = (block.children ?? []).find(c => c.milestone === m.id);
        if (!child) unsettled.push(`${n.node} has a decompose milestone ${m.id} with no child (it stays unexpanded)`);
        else if (!liveNodes.some(x => placeOf(state, x) === childNode(placeOf(state, n), m.id))) unsettled.push(`${n.node}'s child ${childNode(placeOf(state, n), m.id)} is not registered yet`);
      } else if (m.status === 'needs-decision' && !record.events.some(e => e.event === 'milestone_resolved' && e.node === n.node && e.generation === n.generation && e.milestone === m.id)) {
        unsettled.push(`${n.node}'s milestone ${m.id} needs a decision and none is recorded`);
      }
    }
  }
  return { eligible: base.eligible && !unsettled.length, why: [...base.why, ...unsettled], heldByStop: facts.some(f => f.openStop || f.staleBecause.length), heldSources: facts.flatMap(f => f.staleSources) };
}

/** The frontiers that wait for a person's approval: previewed, and the approval is missing, stale or reopened. The ONE rule chooseNextChild and the status view (src/tree-status.js) both read. -> [frontierKey] in record order. */
export function awaitingApprovalOf(record, state) {
  const out = [];
  for (const [key, f] of state.frontiers) {
    if (!f.previewed) continue;
    if (approvalValid(f) && !frontierReopened(record, key)) continue;
    // already-false unit (R1): a frontier whose PARENT was replaced registers nothing (the skip in chooseNextChild, and findPendingFrontier never offers it), so it waits for no approval: it is not listed, whatever its approval reads
    if (f.kind === 'root_replan' || !(frontierParentReplaced(state, f) || retiredParentBy(state, f) !== null)) out.push(key);
  }
  return out;
}

/**
 * The next child to register, from the first frontier whose approval is valid and that still has an admitted child unregistered (the approved preview says which children were admitted). Providers before consumers;
 * a consumer waits (and an independent sibling goes first) until every provider's whole subtree is eligible. -> { kind: 'child', frontierKey, parent, entry, node, previewChild, preview, block, splitSha256, waiting } (`waiting` = the children passed over so far and why) |
 * { kind: 'none', waiting: [{ node, why: [string] }], awaitingApproval: [frontierKey] }. Reads only. `awaitingApproval` is awaitingApprovalOf's, in BOTH kinds (BUG-B-010: the loop returns at the first eligible child and used to leave the list out of that result).
 */
export function chooseNextChild(rootDir, { work, deny = null }) {
  const record = readTreeRecord(rootDir);
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  const waiting = []; const drifted = []; const awaitingApproval = awaitingApprovalOf(record, state);
  for (const [key, f] of state.frontiers) {
    if (!f.previewed) continue;
    // already-false unit (R1): a frontier whose PARENT was replaced registers nothing (the skip below, and findPendingFrontier never offers it), so it waits for no approval: it is not listed here, whatever its approval reads
    if (!approvalValid(f) || frontierReopened(record, key)) continue;                 // it waits for a person (awaitingApprovalOf lists it)
    if (f.kind === 'root_replan') continue;                 // a ROOT replacement has no parent and no split: registerNextChild registers it through its own branch (S8-5)
    const preview = record.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === key && (e.boundSha256 ?? null) === f.previewHash).at(-1);
    if (!preview) continue;
    const parent = state.nodes.get(nodeKey(preview.parentNode, preview.parentGeneration));
    if (!parent) { waiting.push({ node: preview.parentNode, why: ['the parent of this frontier is not in the record'] }); continue; }
    if (frontierParentReplaced(state, f) || retiredParentBy(state, f) !== null) continue;     // the parent was replaced: its new split is the one that counts (a frontier of a dead parent registers nothing)
    const block = readPlanOf(runsDir, parent).block;
    if (!block) { waiting.push({ node: preview.parentNode, why: ['the parent plan or its split block cannot be read'] }); { const first = preview.children.find(c => c.admitted === true && !c.reused && !state.nodes.has(nodeKey(c.node, c.generation))); drifted.push({ frontierKey: key, parentNode: preview.parentNode, parentGeneration: preview.parentGeneration, childKey: first ? nodeKey(first.node, first.generation) : nodeKey(preview.parentNode, preview.parentGeneration) }); } continue; }
    for (const entry of dependencyOrder(preview.parentNode, block)) {
      const node = childNode(preview.parentNode, entry.milestone);
      const previewChild = preview.children.find(c => c.node === node);
      if (!previewChild || previewChild.admitted !== true) continue;                   // not admitted when it was shown: a later approval (a raised limit) may add it
      if (slotHeldBy(state, nodeKey(node, previewChild.generation)) !== null) continue;                  // C2b-2 money fix-up 2: whatever the preview says, a slot a live adoption holds is never registered (the table refuses it too)
      if (previewChild.reused) continue;                                              // C2b-2: a slot filled by a finished run of an earlier plan is never registered (nothing new starts for it)
      if (state.nodes.has(nodeKey(node, previewChild.generation))) continue;           // already registered: recovery or the runner owns it
      if (state.closedUnstarted.has(nodeKey(node, previewChild.generation))) continue;  // a person closed it before it started (c3b): it is never registered; a new generation of it is
      if (isSupersededGeneration(state, node, previewChild.generation)) continue;      // a newer generation of this node is registered or opened (a never-registered node that a decision replaced): its replacement frontier registers it
      // a child a stop put in question is NOT registered (PLAN 8.4: an unstarted affected node is simply not started): registration would make it the active node, its start would be refused as stale (exit 19) and it would block every independent node on every later sitting
      const staleKey = nodeKey(node, previewChild.generation);
      if (state.stale.has(staleKey)) { waiting.push({ node, held: true, sources: state.staleSrc.get(staleKey) ?? [], why: [`${node} is stale: ${(state.staleWhy.get(staleKey) ?? ['a stop put it in question']).join('; ')} (PLAN 8.4); it is not started`] }); continue; }
      const providers = [...new Set(entry.expects.filter(e => e.agreements.length).map(e => e.sibling))];
      const why = []; let held = false; const sources = [];
      for (const pid of providers) {
        const pc = block.children.find(c => c.id === pid);
        if (!pc) { why.push(`its provider ${pid} is not a child of this split`); continue; }
        const e = providerEligibility({ record, state, runsDir, work, deny }, childNode(preview.parentNode, pc.milestone));
        if (!e.eligible) { why.push(...e.why.map(w => `provider ${pid}: ${w}`)); if (e.heldByStop) { held = true; sources.push(...e.heldSources); } }
      }
      if (why.length) { waiting.push({ node, why, ...(held ? { held: true, sources } : {}) }); continue; }
      return { kind: 'child', frontierKey: key, parent: { node: parent.node, generation: parent.generation, runId: parent.runId }, entry, node, previewChild, preview, block, splitSha256: f.splitSha256 ?? preview.splitSha256, waiting, awaitingApproval };
    }
  }
  return { kind: 'none', waiting, awaitingApproval, drifted };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- registering it

function freshRunId(runsDir, record, now) {
  let ms = now ? now() : Date.now();
  for (;;) {
    const id = new Date(ms).toISOString().replace(/[:.]/g, '-');
    if (!existsSync(join(runsDir, id)) && !record.events.some(e => e.runId === id)) return id;
    ms += 1;
  }
}

/**
 * Registers the next child, or says why not. -> { kind: 'registered', node, runId, grantUsd, event, bundleDir } | { kind: 'refused', node, check, detail } (a `blocked` record is written, no folder is made) |
 * { kind: 'active', node } | { kind: 'stopped', node } (a stop was requested while it was derived: nothing registered) | { kind: 'blocked', reasons } | { kind: 'none', waiting, awaitingApproval }. A TreeRefusal from admission (a limit, the budget) is returned as `refused`, never thrown. Starting the
 * run is the caller's: this never spawns anything.
 */
export function registerNextChild(rootDir, { work, rootTaskPath = rootTaskPathOf(rootDir, work), facts, now, contextLimitBytes = CONTEXT_LIMIT_BYTES, deps = {} } = {}) {
  const register = deps.register ?? registerChildAdmitted;                            // the seam a test uses to refuse a registration AFTER the bundle was written
  const record = readTreeRecord(rootDir);
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  if (record.corrupt.length) return { kind: 'blocked', reasons: ['record_corrupt'] };
  if (state.sticky.size) return { kind: 'blocked', reasons: [...state.sticky.keys()] };
  if (state.active !== null) return { kind: 'active', node: state.active.replace(/@g\d+$/, ''), key: state.active };
  releaseHeldIfNoChildren(rootDir, { record, state, runsDir, facts, now });
  const rootPick = chooseRootReplan(record, state);
  if (rootPick) return registerRootFromFrontier(rootDir, { work, record, state, pick: rootPick, facts, now, deps });
  const pick = chooseNextChild(rootDir, { work });
  if (pick.kind === 'none' && pick.drifted.length) {
    // an approved frontier whose parent plan no longer reads (its files are not what the panel signed): the parent changed. The same record a member's start writes (src/tree-continuation.js parentChangedEvent).
    const d = pick.drifted[0];
    const detail = `${d.parentNode}'s plan or its split block no longer reads as the signed one (its files changed since the frontier was approved)`;
    appendTreeEvent(rootDir, parentChangedEvent({ scope: d.childKey, frontierKey: d.frontierKey, detail, ancestor: d.parentNode }), { facts, now });
    return { kind: 'refused', node: d.parentNode, check: 'parent_changed', detail };
  }
  if (pick.kind === 'none') return pick;
  const { node, entry, parent, previewChild } = pick;
  const scope = nodeKey(node, previewChild.generation);
  // A refusal a new approval answers (REOPEN_CHECKS) is written every time it happens: it is what makes the frontier wait for a person again (src/tree-frontier.js frontierReopened); the others are written once.
  const refuse = (check, detail, extra = {}) => {
    const fields = { scope, transition: 'derivation', check, detail, frontierKey: pick.frontierKey };
    if (REOPEN_CHECKS.includes(check)) appendTreeEvent(rootDir, { event: 'blocked', reason: 'expansion_refused', ...fields }, { facts, now });
    else recordBlockedOnce(rootDir, readTreeRecord(rootDir), fields, { facts, now });
    return { kind: 'refused', node, check, detail, ...extra };
  };

  // derive in FULL (the providers' pieces are in the record now); the preview could not
  let args; let derived;
  try {
    args = loadDerivation({ rootDir, parentRef: { node: parent.node, generation: parent.generation }, childId: entry.id, generation: previewChild.generation, rootTaskPath, work });
    derived = deriveChild(args);
  } catch (e) {
    if (e instanceof DeriveRefusal) {
      if (!record.events.some(x => x.event === 'blocked' && x.scope === scope && x.check === e.code && x.detail === e.detail)) recordDerivationRefusal(rootDir, { node, generation: previewChild.generation }, e, { facts, now });
      return { kind: 'refused', node, check: e.code, detail: e.detail };
    }
    if (e instanceof NotExpandable && e.drift) {
      // the parent's files changed since the approval (PLAN 5.5 items 1-3 fail): the tree is blocked until this frontier is approved again - the same record a member's start writes (src/tree-continuation.js parentChangedEvent)
      appendTreeEvent(rootDir, parentChangedEvent({ scope, frontierKey: pick.frontierKey, detail: e.message, ancestor: parent.node }), { facts, now });
      return { kind: 'refused', node, check: 'parent_changed', detail: e.message };
    }
    if (e instanceof NotExpandable) return refuse('parent', e.message);              // the parent is not in the record
    if (e instanceof ChainUnavailable) return refuse('chain', e.message);             // D2 F18 (B16a): the pinned chain file is changed or gone: a refusal the sitting ends on (its words name --accept-chain-limits when only the limits moved), never a stack trace
    throw e;                                                                          // anything else is a defect or an unreadable file: never recorded as a refusal
  }
  // a stop written while the child was being derived registers nothing and writes nothing (C&C, 9 Oct: the stop is checked again right before the bundle is written and right before the registration)
  const stopNow = () => deps.shouldStop?.() === true;
  if (deps.afterDerive) deps.afterDerive();
  if (stopNow()) return { kind: 'stopped', node };
  if (args.parent.blockSha256 !== pick.splitSha256) return refuse('split_changed', `the verified split ${String(pick.splitSha256).slice(0, 12)} is not the block now in the plan (${String(args.parent.blockSha256).slice(0, 12)})`);
  // the approval bound the held items the person was shown; one that is new at full derivation is not covered (C&C, 9 Oct 2026)
  if (previewChild.heldSha256 !== heldDigest(derived)) {
    const items = heldItemsOf(derived).map(i => (i.kind === 'guard_refused' ? `${i.guard}: ${i.text}` : `${i.id} (check not enforced): ${i.text}`));
    return refuse('held_changed', `the items ${scope} is held for are not the ones the approval showed${items.length ? ` (now: ${items.join(' | ')})` : ' (now: none)'}; run \`council tree approve\` again`, { items });
  }
  if (!derived.startable) return refuse('no_criteria', `${scope} has no acceptance item left after the guards: a run needs a criteria list`);
  const contextBytes = Buffer.byteLength(derived.files['context.md'] ?? '', 'utf8');
  if (contextBytes > contextLimitBytes) return refuse('context_size', `${scope}'s context.md is ${contextBytes} bytes, over the ${contextLimitBytes} the CLI accepts: it would be refused at the child's start`);
  // S5b part B: the child's input is asked the questions its run will ask at its own start (the key scan; the personal-data gate under 'hard-stop') BEFORE the child is in the record. A child refused at its start was registered and then refused
  // on every sitting (exit 11) with no run folder and no stop: stranded. Now nothing is registered, no bundle is written, and a person gets a stop.
  const inputFound = bundleInputCheck({ files: derived.files, carrierSpans: derived.carrierSpans, piiMode: treeInputScanModeFrom(record.tree), allow: state.piiAllowed?.get(nodeKey(node, previewChild.generation))?.types ?? [], rootCover: rootTaskCoverage(record.tree, derived), maxBytes: bundleAllowanceBytesOf(record.tree) });   // T-b: what a person allowed for THIS child after seeing it; the root allowance covers the root task's bytes the tree code copied (C&C ruling (c))
  if (inputFound.findings.length) return openBundleInputStop(rootDir, { child: { node, generation: previewChild.generation }, parent: { node: parent.node, generation: parent.generation }, found: inputFound, facts, now });

  // the grant: an equal share of what is free among the children still to register, never above the cap the approval showed (PLAN 7.3, 8.2)
  let chain; try { chain = loadChainConfig({ tree: record.tree, depth: node.split('/').length - 1, work }); } catch (e) { if (e instanceof ChainUnavailable) return refuse('chain', e.message); throw e; }       // D2 F18
  const inputBytes = bundleAllowanceBytesOf(record.tree);
  const figures = chainFigures(chain.config, { inputBytes });
  if (!figures) return refuse('price', `the child chain ${chain.name} has no dry-run figure: no grant can be sized`);
  // R5 (M5 API reviews): the ceiling the approval showed is part of what it approved (PLAN 8.2, L11). A chain whose at-most figure is no longer the shown one (prices, a model's cap) is a different approval: refused, and a new approval answers it
  if (typeof previewChild.ceilingUsd === 'number' && Math.abs(previewChild.ceilingUsd - ceilCents(figures.atMostUsd)) > MONEY_EPS) return refuse('ceiling_changed', `the most ${scope}'s chain can cost is ${ceilCents(figures.atMostUsd)} now, not the ${previewChild.ceilingUsd} the approval showed; run \`council tree approve\` again`);
  if (!(previewChild.capUsd > 0)) return refuse('approved_cap', `the approved preview shows no money cap for ${scope}`);
  const gate = gateTree(rootDir, { record });
  const budget = budgetOf(rootDir, { record, gate });
  // the share split reserves nothing for a child that will never register from this frontier (superseded) or is held back (stale)
  const remaining = pick.preview.children.filter(c => c.admitted === true && !c.reused && !state.nodes.has(nodeKey(c.node, c.generation)) && !state.closedUnstarted.has(nodeKey(c.node, c.generation)) && !isSupersededGeneration(state, c.node, c.generation) && !state.stale.has(nodeKey(c.node, c.generation))).map(c => {
    const f = c.node === node ? figures : chainFigures(loadChainConfig({ tree: record.tree, depth: c.node.split('/').length - 1, work }).config, { inputBytes });
    return { id: c.node, atMostUsd: f.atMostUsd, cheapestUsd: f.cheapestUsd };
  });
  const mine = proposeGrants({ availableUsd: budget.availableUsd, children: remaining }).find(g => g.id === node);
  // fail closed: a child the formula of PLAN 7.3 does not admit now gets NO grant, so registerChildAdmitted writes its own "not admitted: budget" record (never a larger grant than the formula gives)
  const grantUsd = mine?.admitted ? Math.min(previewChild.capUsd, mine.grantUsd) : 0;
  if (grantUsd > previewChild.capUsd + MONEY_EPS) return refuse('approved_cap', `a grant of ${grantUsd} is above the ${previewChild.capUsd} the approval showed`);   // belt and braces: min() above makes it unreachable

  // the bundle first (registerChildAdmitted needs its hash); one that exists and is byte-identical is left alone, so a refusal below and a later sitting re-derive the same bundle
  const bundle = writeBundle(rootDir, derived);
  recordGuardRefusalsOnce(rootDir, derived, { facts, now });
  const runId = freshRunId(runsDir, readTreeRecord(rootDir), now);
  if (deps.beforeRegister) deps.beforeRegister();
  if (stopNow()) return { kind: 'stopped', node };
  try {
    const event = register(rootDir, {
      frontierKey: pick.frontierKey, node, generation: previewChild.generation, runId, parentRunId: parent.runId,
      chain: { name: chain.name, sha256: chain.sha256 }, grant: { amount: grantUsd, unit: 'usd' }, cheapestUsd: figures.cheapestUsd,
      bundleSha256: derived.bundleSha256, bundleBytes: derived.bundleBytes, obligations: derived.obligationMap, dependsOn: derived.dependsOn, splitSha256: pick.splitSha256,
      builtFrom: builtFromOf(stateOf(readTreeRecord(rootDir)), derived.sources),             // REBUILD: the plans whose text is in this bundle, each with its newest body event now (a stop on a changed plan holds registration back, so no accept lands between the derive and this line)
    }, { facts, now });
    return { kind: 'registered', node, runId, grantUsd, event, bundleDir: bundle.dir };
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    // D2 F9a (B14a/b): a child its approved preview ADMITTED is refused admission now (a limit or the budget; accounting_blocked is not one): the frontier waits for a new approval that shows it with today's numbers, through
    // the reopen line (REOPEN_CHECKS: written every time it happens). Without it the approval stayed valid, nothing was offered and the refused child waited for nothing.
    // CR-RC-004 (RULE 1c): the refusal names its way on in the words its sibling reopen refusals carry (held_changed, ceiling_changed): the first sitting that meets it prints the detail, so the way on is in that line
    if (e.check === 'admission') return refuse('admission_changed', `${e.reason}; run \`council tree approve\` again`);
    return { kind: 'refused', node, check: e.code, detail: e.reason };                   // admission already wrote its `blocked` record
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the root replacement (S8-5)

/** The approved, unregistered ROOT replacement frontier, if any: { key, preview, child }. */
function chooseRootReplan(record, state) {
  for (const [key, f] of state.frontiers) {
    if (f.kind !== 'root_replan' || !f.previewed || !approvalValid(f) || frontierReopened(record, key)) continue;
    const preview = record.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === key && (e.boundSha256 ?? null) === f.previewHash).at(-1);
    const child = preview?.children?.[0];
    if (!child || child.admitted !== true || state.nodes.has(nodeKey('R', child.generation)) || isSupersededGeneration(state, 'R', child.generation)) continue;
    return { key, preview, child };
  }
  return null;
}

/** The root plan is registered from its approved frontier: the task still the pinned one, what the approval bound recomputed (the decision text, the task bytes, the limits), the bundle written, then the admitted registration. */
function registerRootFromFrontier(rootDir, { work, record, state, pick, facts, now, deps }) {
  const { key, preview, child } = pick;
  const scope = nodeKey('R', child.generation);
  const refuse = (check, detail, extra = {}) => {
    const fields = { scope, transition: 'derivation', check, detail, frontierKey: key };
    if (REOPEN_CHECKS.includes(check)) appendTreeEvent(rootDir, { event: 'blocked', reason: 'expansion_refused', ...fields }, { facts, now });
    else recordBlockedOnce(rootDir, readTreeRecord(rootDir), fields, { facts, now });
    return { kind: 'refused', node: 'R', check, detail, ...extra };
  };
  const decision = record.events.find(e => e.event === 'decision_recorded' && e.id === preview.openedBy);
  if (!decision || typeof decision.text !== 'string') return refuse('parent', `the decision ${preview.openedBy} that opened this root plan is not in the record`);
  const task = rootTaskTextOf(record.tree);
  if (task.refusal) return refuse('task_changed', task.refusal);
  const limits = effectiveLimits(record.tree, record.events);
  const payload = { frontierKey: preview.frontierKey, kind: preview.kind, openedBy: preview.openedBy, parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: preview.children };       // the recorded event minus its envelope and its hash
  if (rootReplanBound({ preview: payload, limits, decisionText: decision.text, taskText: task.text, oldPlan: decision.oldPlan ?? null, allowanceBytes: decision.allowanceBytes ?? null }) !== (state.frontiers.get(key).previewHash ?? null)) return refuse('limits_changed', 'the decision, the task bytes or a limit changed since the approval, so what would be registered is not what was approved; run `council tree approve` again');
  let chain; try { chain = loadChainConfig({ tree: record.tree, depth: 0, work }); } catch (e) { if (e instanceof ChainUnavailable) return refuse('chain', `the root chain cannot be read: ${e.message}`); throw e; }       // D2 F18 with D3's correction: the root chain too
  const rootAllowance = allowanceOfDecision(record.tree, decision);       // the size the approval of THIS root plan was priced at (--allow-size), else the tree's number
  const figures = chainFigures(chain.config, { inputBytes: rootAllowance });
  if (!figures) return refuse('price', `the root chain ${chain.name} has no dry-run figure: no grant can be sized`);
  if (typeof child.ceilingUsd === 'number' && Math.abs(child.ceilingUsd - ceilCents(figures.atMostUsd)) > MONEY_EPS) return refuse('ceiling_changed', `the most the root chain can cost is ${ceilCents(figures.atMostUsd)} now, not the ${child.ceilingUsd} the approval showed; run \`council tree approve\` again`);
  if (!(child.capUsd > 0)) return refuse('approved_cap', 'the approved preview shows no money cap for the new root run');
  const previous = [...state.nodes.values()].filter(n => n.node === 'R' && n.generation < child.generation).sort((a, b) => b.generation - a.generation)[0];
  // bundle unit step 2: the earlier root plan as data, only if the recorded decision says so and the plan is still the text the person's screen was about
  let oldPlanText = null;
  if (decision.oldPlan?.form === 'data') {
    const old = oldPlanOf({ rootDir, node: previous });
    if (old.none || old.sha256 !== decision.oldPlan.sha256) return refuse('approval_changed', `the earlier plan is not the one your decision was about (${old.none ?? 'its text changed'}): its run folder was changed after you decided. Nothing was registered. The way out is a new tree: \`council tree decide ${record.tree.treeId} --abandon\` ends this one, then \`council tree start\``);
    oldPlanText = old.text;
  }
  const bundle = rootBundle({ treeId: record.tree.treeId, generation: child.generation, decisions: [{ id: decision.id, text: decision.text }], taskText: task.text, oldPlanText });
  // S5b part B (C&C Q2, 12 Oct): a BACKSTOP, not a stop. The task is scanned at `tree start` and the decision texts at `decide`, by the same scanner with the same options, so this finds nothing in a tree that went through them (test/tree-bundle-input.test.js
  // feeds one input set to all three sites and pins identical findings). If it ever does, nothing is registered and the sentence names the exit; no `bundle_input` stop shape exists for a root generation in 0.8.3.
  const rootFound = bundleInputCheck({ files: bundle.files, piiMode: treeInputScanModeFrom(record.tree), allow: (() => { const a = treePiiAllowFrom(record.tree); return a.status === 'on' ? a.types : []; })(), allowOnly: ['task.md'], maxBytes: rootAllowance });   // T-b: the root task's allowance covers the task text (task.md is the task's bytes) and NOTHING else (C&C ruling (c))
  if (rootFound.findings.length) return refuse('bundle_input', `the input of the new root plan ${scope} holds ${rootFound.findings.length} finding${rootFound.findings.length === 1 ? '' : 's'} its run would be refused for (${rootFound.findings.map(f => `${f.file}${f.line === null ? '' : ` line ${f.line}`}: ${f.name}`).join('; ')}): it was not registered and nothing was spent. The task and the decision were scanned when they were given, so this should not happen; end the tree with \`council tree decide ${basename(rootDir)} --abandon\` and start a new one`);
  writeRootBundle(rootDir, bundle);
  if (deps.beforeRegister) deps.beforeRegister();
  try {
    const event = (deps.registerRoot ?? registerRootReplan)(rootDir, { generation: child.generation, frontierKey: key, bundle, chain: { name: chain.name, sha256: chain.sha256, figures }, previous, taskSha256: sha256Of(task.text), capUsd: child.capUsd, facts, now });
    return { kind: 'registered', node: 'R', runId: event.runId, grantUsd: event.grant.amount, event, bundleDir: join(rootDir, 'tree', 'inputs', `R@g${child.generation}`) };
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    return { kind: 'refused', node: 'R', check: e.code, detail: e.reason };
  }
}

/**
 * Exit X2 of the held state (contract M6_HeldState_Contract_2026-10-12.md section 5): the new root plan closed PASSED, with no open stop, and its plan holds no split block (`no_split`) or its VERIFIED split names no children
 * (`no_children`): nothing will adopt the held nodes from THIS plan, so they are marked passed over (K2: kept for a later frontier, not dead). Once per node: the event names only nodes not yet passed over. Written under no lock of its own (the table checks the keys are held).
 */
function releaseHeldIfNoChildren(rootDir, { record, state, runsDir, facts, now }) {
  // K2 (C2a-record): a release only ANNOTATES (the nodes stay held, kept for a later comparison), so "nothing is held afterwards" no longer holds: only the nodes NOT yet passed over are written, once each, or every sitting would append the same event
  const kept = keptKeys(state, { route: 'root' });
  const held = new Set([...heldKeys(state, { route: 'root' })].filter(k => !kept.has(k)));      // X2 is the ROOT route's release; a sub-plan candidate is passed over by its own plan's frontier, never by a root release
  if (!held.size) return;
  const root = [...state.nodes.values()].filter(n => n.node === 'R').sort((a, b) => b.generation - a.generation)[0];
  if (!root || root.generation < 2 || root.phase !== 'closed' || closedEventOf(record, root)?.passed !== true || closedEventOf(record, root)?.status === 'needs_decision') return;
  if (state.openStops.some(id => state.stopMeta.get(id)?.node === 'R' && state.stopMeta.get(id)?.generation === root.generation)) return;
  const runDir = join(runsDir, root.runId);
  // T1-7: the RECORD is consulted before the file - a verified split that names no children released the held nodes before the file could break, and still does. A plan that does not READ never releases (production was already protected by the
  // sitting's order: afterStep opens the root's blocked stop first, and the early return above sees it; this makes the rule explicit at the line, since registerNextChild is exported and a caller can skip afterStep).
  let reason = null;
  if (Array.isArray(root.verifiedSplit?.children) && root.verifiedSplit.children.length === 0) reason = 'no_children';
  else {
    const fence = splitFenceOf(runDir, planAuthorityOf(root));
    if (fence === 'unreadable') {
      recordBlockedOnce(rootDir, record, { scope: `R@g${root.generation}`, transition: 'held_release', check: 'plan_unreadable', detail: `the plan of R@g${root.generation} (run ${root.runId}: its report.json and deliverable.md) does not read as the text its panel signed, so the nodes held below it stay held and nothing was released` }, { facts, now });
      return;
    }
    if (fence === 'none') reason = 'no_split';
  }
  if (!reason) return;
  appendTreeEvent(rootDir, { event: 'held_released', reason, nodes: [...held].sort() }, { facts, now });
}

/** `guard_refused` once per (node, generation, item, guard): the same child met again after an admission refusal does not repeat the record. */
export function recordGuardRefusalsOnce(rootDir, derived, { facts, now } = {}) {
  const have = new Set(readTreeRecord(rootDir).events.filter(e => e.event === 'guard_refused' && e.node === derived.node && e.generation === derived.generation).map(e => `${e.guard}\u0000${e.item}`));
  const fresh = { ...derived, guardRefused: derived.guardRefused.filter(g => !have.has(`${g.guard}\u0000${itemText(g.form)}`)) };
  return recordGuardRefusals(rootDir, fresh, { facts, now });
}
