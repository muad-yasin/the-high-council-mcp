// Finding the next frontier and describing it for a person (0.8.3 M5b2c; PLAN 8.1-8.3). A frontier is one set of children proposed from one verified split. Nothing here writes: `findPendingFrontier` reads the
// record, `describeFrontier` derives every child as a PREVIEW (src/tree-derive.js; the providers have not run), simulates admission and the grant split with the SAME pure functions registration uses
// (src/tree-budget.js admitAgainstLimits, proposeGrants), and returns the view src/tree-stop.js renders plus the data an approval binds. src/tree-approve.js is the only caller that records anything.
import { basename, dirname, join } from 'node:path';
import { canonicalJson, sha256Of } from './thin-contract.js';
import { readTreeRecord, stateOf } from './tree-record.js';
import { childNode, frontierKey, nodeKey } from './tree-identity.js';
import { blockEdges } from './tree-deps.js';
import { approvalValid, retiredNodeBy, childGenerationOf, deadKeys, foldRecord, heldKeys, isSupersededGeneration, orphansOf, planAuthorityOf, slotHeldBy } from './tree-transitions.js';
import { checkRootTaskPin } from './tree-task-pin.js';
import { rootTaskRefOf } from './tree-root-replan.js';
import { expansionCheck } from './tree-expansion.js';
import { rootTaskPathOf } from './tree-root-task.js';
import { loadChainConfig, loadDerivation, readPlanOf } from './tree-derive-load.js';
import { DeriveRefusal, deriveChild, itemText } from './tree-derive.js';
import { dryRunReport } from './dry-run.js';
import { reusePlanFor } from './tree-reuse-wire.js';
import { fanOutOf } from './tree-fan-out.js';
import { MONEY_EPS, admitAgainstLimits, allowanceOfDecision, bundleAllowanceBytesOf, budgetOf, chainFigures, effectiveCapUsd, effectiveLimits, ceilCents, floorCents, gateTree, proposeGrants } from './tree-budget.js';

/** What every approval binds besides the children (PLAN 8.2): the formula the grants come from. */
export const GRANT_FORMULA = 'min(atMost, available/k)@7.3';

/** The words of PLAN 5.5 items 1-4 once they hold, in plain sentences (the reference is added by the renderer). */
export const RESULT_WORDS = Object.freeze([
  'the panel passed and signed this text; the delivered text is the signed text; the handoff was made from it',
  '`contract check` exits 0 (the files are what the run wrote)',
  'the split block in the plan is the block the handoff reproduced',
  'the split passes every mechanical check of the split contract',
]);

const pathOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The items a child is HELD for (a guard refused them, or its chain will not enforce their check), normalised and sorted. Approving a frontier admits a held child with these items carried in context only (C&C, 9 Oct
 * 2026: approving IS the choice), so the approval must bind exactly them: the preview carries their digest per child (`heldSha256`) and the loop compares it with the FULL derivation before it registers the child.
 */
export function heldItemsOf(d) {
  const text = f => itemText(f);
  return [
    ...d.guardRefused.map(g => ({ kind: 'guard_refused', guard: g.guard, text: text(g.form), origin: g.identity ? `${g.identity.originNode}:${g.identity.originId}` : null })),
    ...d.checkNotEnforced.map(n => ({ kind: 'check_not_enforced', id: n.id, check: typeof n.form === 'object' ? (n.form.check ?? '') : '', text: text(n.form) })),
  ].sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0));
}
export const heldDigest = d => sha256Of(canonicalJson(heldItemsOf(d)));

/** The root task file of a tree: the root run's own record of it (run.json `task`, relative to the folder it was started from, else `work`). */
export { rootTaskPathOf };                       // moved to src/tree-root-task.js (one place for the verification of a split and for the derivation); re-exported for every existing importer

/**
 * The inputs PLAN 5.3 checks 3 and 8 need for a node: `inheritedGlobal` = the ids of its own acceptance list whose obligation was `global` where it originated (none at the root), and `ancestorQuestions` = the open
 * questions of the milestones along its path (the question its own milestone answers included). Read from the record and from the ancestors' verified blocks; an ancestor whose plan cannot be read gives no
 * question here and `unreadable` names it, so the caller can refuse rather than check "by silence".
 */
export function treeInputsFor({ record, state, runsDir, node }) {
  const registered = record.events.filter(e => e.event === 'node_registered');
  const mine = [...state.nodes.values()].filter(n => n.node === node).sort((a, b) => b.generation - a.generation)[0];
  const reg = mine ? registered.find(e => e.node === mine.node && e.generation === mine.generation) : null;
  const inheritedGlobal = node === 'R' ? [] : (reg?.obligations?.items ?? []).filter(i => i.identity?.originClass === 'global').map(i => i.id);
  const ancestorQuestions = []; const unreadable = [];
  const segments = node.split('/');
  for (let i = 1; i < segments.length; i += 1) {
    const ancestor = segments.slice(0, i).join('/');
    const a = [...state.nodes.values()].filter(n => n.node === ancestor).sort((x, y) => y.generation - x.generation)[0];
    const block = a ? readPlanOf(runsDir, a).block : null;
    const m = block?.milestones?.find(x => x.id === segments[i]);
    if (!m) { unreadable.push(ancestor); continue; }
    if (typeof m.open_question === 'string' && m.open_question.trim()) ancestorQuestions.push(m.open_question);
  }
  return { inheritedGlobal, ancestorQuestions, unreadable };
}

/** The children of a block in the order they are proposed and started: providers before consumers (PLAN 8.1), then the block's own order. Pure. */
export function dependencyOrder(parentNode, block) {
  const ids = block.children.map(c => c.id);
  const pathOf = new Map(block.children.map(c => [c.id, childNode(parentNode, c.milestone)]));
  const { edges } = blockEdges(parentNode, block);
  const before = new Map(ids.map(id => [id, new Set()]));
  const idOf = new Map([...pathOf].map(([id, p]) => [p, id]));
  for (const e of edges) { const p = idOf.get(e.provider); const c = idOf.get(e.consumer); if (p && c) before.get(c).add(p); }
  const out = []; const done = new Set();
  while (out.length < ids.length) {
    const next = ids.find(id => !done.has(id) && [...before.get(id)].every(p => done.has(p)));
    if (!next) throw new Error('the split block has a dependency cycle (PLAN 5.3 check 6 should have refused it)');
    out.push(next); done.add(next);
  }
  return out.map(id => block.children.find(c => c.id === id));
}

/** The refusals of the loop that the person answers by approving again: what the approval was shown is no longer what would start (src/tree-loop.js registerNextChild). */
// limits_changed (D2 F8, CR-2D-004): a root re-plan whose approval binds what registration would no longer register: the task is the pinned one (refused first otherwise) and the decision, old plan and size are on the decision, so
// a limit raised after the approval is what differs; the root frontier waits for a new approval under the new limits (an earlier root plan's changed files stay approval_changed: its words name the way out)
// admission_changed (D2 F9a, B14a/b): a child the approved preview admitted was refused admission at registration (a limit or the budget moved): the frontier waits for a new approval that shows it with today's numbers
export const REOPEN_CHECKS = Object.freeze(['held_changed', 'split_changed', 'ceiling_changed', 'admission_changed', 'limits_changed']);
/**
 * Does this frontier wait for a person again? ONE function for every reason an earlier approval no longer covers what would start:
 *  - the loop refused it since its latest approval for a reason a new approval answers (held_changed, split_changed, ceiling_changed: blocked records that carry its frontierKey);
 *  - (M5d, PLAN 8.6) a `limit_raised` is newer than its latest approval AND its latest preview has a child that is not registered and was refused for exactly that limit: the raise changes what is admitted, so the earlier
 *    approval no longer matches what a person would be shown, and the newly admitted child needs its own approval. A frontier with no child refused for that limit is untouched. The refusal's KEY is the preview child's `limit`.
 *  - (R18) its latest preview bound a child as `not admitted: stale` (refusedBy 'stale') and that child's stale mark is gone and it is still unregistered: the child can be admitted now, a new approval shows it;
 * (A parent_changed block is not here: the fold makes approvalValid false while it stands.)
 */
export function frontierReopened(record, key) {
  const lastIndex = pred => { for (let i = record.events.length - 1; i >= 0; i -= 1) if (pred(record.events[i])) return i; return -1; };
  const approvedAt = lastIndex(e => e.event === 'frontier_approved' && e.frontierKey === key);
  if (lastIndex(e => e.event === 'blocked' && e.frontierKey === key && REOPEN_CHECKS.includes(e.check)) > approvedAt) return true;
  const raises = record.events.filter((e, i) => e.event === 'limit_raised' && i > approvedAt);
  const preview = record.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === key).at(-1);
  if (!preview) return false;
  const registered = new Set(record.events.filter(e => e.event === 'node_registered').map(e => `${e.node}@g${e.generation}`));
  // R18 (Fable Q3-3; hard-lock fix): a child bound 'not admitted: stale' whose stale mark is GONE (its stop was answered in place) is offered again: a new approval previews it admitted. Without this the approved frontier stays valid, the child
  // is never registered and nothing says why. Keyed on the structured `refusedBy`, never on the words of the reason.
  const folded = foldRecord(record.events);                          // the events only: a caller may hand in { events } alone
  const staleNow = folded.stale;
  // a child a person closed before it started (c3b) is settled for good: it is not "offered again" when its stale mark goes (its stop was answered by that very close)
  if (preview.children.some(c => c.admitted === false && c.refusedBy === 'stale' && !registered.has(`${c.node}@g${c.generation}`) && !folded.closedUnstarted.has(`${c.node}@g${c.generation}`) && !staleNow.has(`${c.node}@g${c.generation}`))) return true;
  if (!raises.length) return false;
  // keyed on the structured `limit` the preview carries (src/tree-budget.js admitAgainstLimits), never on the words of `reason`
  return preview.children.some(c => c.admitted === false && !registered.has(`${c.node}@g${c.generation}`) && raises.some(r => c.limit === r.limit));
}

/**
 * The next frontier that waits for a person: first the first node (in path order) whose run has closed and whose verified split (a `split_verified` record) proposes children that no valid approval covers; then the
 * REPLACEMENT frontiers (M5e S5): for each decision whose generations were opened, the replaced children of one parent, at their new generations, opened by that decision (a distinct key; the decision is its `openedBy`).
 * Only the newest generation of a path proposes anything: a replaced node or an orphan proposes nothing.
 * -> { parent: { node, generation, runId }, splitSha256, block, key, children?, openedBy? } | null (`block` and `key` are null for a verified node whose plan no longer reads: describeFrontier then returns the refusal).
 * `children` ([{ node, generation }]) and `openedBy` ({ id, text }) are present for a replacement frontier only.
 */
export function findPendingFrontier({ rootDir, record = readTreeRecord(rootDir), state = stateOf(record) }) {
  const runsDir = dirname(rootDir);
  const orphans = orphansOf(state);
  const verified = new Map();
  for (const e of record.events) if (e.event === 'split_verified') verified.set(`${e.node}@g${e.generation}`, e);
  const alive = n => !isSupersededGeneration(state, n.node, n.generation) && !orphans.has(`${n.node}@g${n.generation}`) && retiredNodeBy(state, `${n.node}@g${n.generation}`) === null;       // money fix-up 3: a node a recorded decision replaced or set aside proposes no children frontier either (a reopened frontier, a limit raise or a share offer must not ask the person to approve them)
  const closed = [...state.nodes.values()].filter(n => n.phase === 'closed' && verified.has(`${n.node}@g${n.generation}`) && alive(n)).sort((a, b) => pathOrder(a.node, b.node) || a.generation - b.generation);
  // D2 F2(e): a parent whose OWN text cannot give one of its children its input waits behind its open `derivation_refused` stop (that stop is the door, answered by a new plan of the parent); its frontier is not offered, and the next
  // pending frontier in path order is (record-only: the stop's codes as the fold keeps them)
  const derivationStopOn = n => state.openStops.some(id => { const m = state.stopMeta.get(id); return m?.source === 'blocked' && m.node === n.node && m.generation === n.generation && (m.blockedCodes ?? []).includes('derivation_refused'); });
  for (const n of closed) {
    const v = verified.get(`${n.node}@g${n.generation}`);
    if (v.runId !== n.runId) continue;
    if (derivationStopOn(n)) continue;
    const block = readPlanOf(runsDir, n).block;
    // A verified node whose plan no longer reads (the file was edited after the review) is NOT skipped: it comes back with no block so the caller says why it is refused, instead of "nothing waits".
    if (!block) return { parent: { node: n.node, generation: n.generation, runId: n.runId }, splitSha256: v.splitSha256, block: null, key: null };
    if (!block.children?.length) continue;
    const key = frontierKey({ parentNode: n.node, parentGeneration: n.generation, parentRunId: n.runId, splitSha256: v.splitSha256, openedBy: null, children: block.children.map(c => ({ node: childNode(n.node, c.milestone), generation: childGenerationOf(state, n.generation, childNode(n.node, c.milestone)) })) });
    const f = state.frontiers.get(key);
    if (f?.revisions.length && approvalValid(f) && !frontierReopened(record, key) && !frontierOffersShare(record, key)) continue;   // approved: the loop registers its children
    return { parent: { node: n.node, generation: n.generation, runId: n.runId }, splitSha256: v.splitSha256, block, key };
  }
  for (const [decId, d] of state.decisions) {
    if (!d.opened?.length) continue;
    const text = record.events.find(e => e.event === 'decision_recorded' && e.id === decId)?.text ?? '';
    const allowanceBytes = record.events.find(e => e.event === 'decision_recorded' && e.id === decId)?.allowanceBytes ?? null;       // a size raise typed for this new root plan (--allow-size)
    const oldPlan = record.events.find(e => e.event === 'decision_recorded' && e.id === decId)?.oldPlan ?? null;       // bundle unit step 2: the root re-plan's choice about the earlier plan
    if (d.replansRoot) {
      // S8-5 (design note 3.3): the frontier of a ROOT replacement has no parent; it is opened by a decision that re-plans the root, lists the one root generation that decision opened, and waits until R@g is registered
      const o = d.opened.find(x => x.node === 'R');
      if (!o || isSupersededGeneration(state, 'R', o.generation) || state.nodes.has(`R@g${o.generation}`)) continue;
      const key = frontierKey({ parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, openedBy: decId, children: [{ node: 'R', generation: o.generation }] });
      const f = state.frontiers.get(key);
      if (f?.revisions.length && approvalValid(f) && !frontierReopened(record, key) && !frontierOffersShare(record, key)) continue;     // approved: the loop registers it (BUG-C-058, bug audit 2026-10-24: unless the new root run was shown not admitted for budget and money has come back since: it is offered again, as the split branches above do)
      const prev = [...state.nodes.values()].filter(x => x.node === 'R').sort((a, b) => b.generation - a.generation)[0];
      return { kind: 'root_replan', parent: { node: 'R', generation: prev.generation, runId: prev.runId }, splitSha256: null, block: null, key, children: [{ node: 'R', generation: o.generation }], openedBy: { id: decId, text, ...(oldPlan ? { oldPlan } : {}), ...(allowanceBytes ? { allowanceBytes } : {}) } };
    }
    const parents = new Map();
    for (const o of d.opened) {
      if (isSupersededGeneration(state, o.node, o.generation)) continue;                  // replaced again by a later decision
      const parentPath = o.node.slice(0, o.node.lastIndexOf('/'));
      if (!parentPath) continue;
      if (!parents.has(parentPath)) parents.set(parentPath, []);
      parents.get(parentPath).push(o);
    }
    for (const [parentPath, kids] of [...parents].sort(([a], [b]) => pathOrder(a, b))) {
      const parent = closed.filter(n => n.node === parentPath).sort((a, b) => b.generation - a.generation)[0];
      if (!parent || derivationStopOn(parent)) continue;
      const v = verified.get(`${parent.node}@g${parent.generation}`);
      if (!v || v.runId !== parent.runId) continue;
      const block = readPlanOf(runsDir, parent).block;
      if (!block) return { parent: { node: parent.node, generation: parent.generation, runId: parent.runId }, splitSha256: v.splitSha256, block: null, key: null };
      const inBlock = kids.filter(o => (block.children ?? []).some(c => childNode(parent.node, c.milestone) === o.node)).map(o => ({ node: o.node, generation: o.generation })).sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
      if (!inBlock.length) continue;
      const key = frontierKey({ parentNode: parent.node, parentGeneration: parent.generation, parentRunId: parent.runId, splitSha256: v.splitSha256, openedBy: decId, children: inBlock });
      const f = state.frontiers.get(key);
      if (f?.revisions.length && approvalValid(f) && !frontierReopened(record, key) && !frontierOffersShare(record, key)) continue;
      return { parent: { node: parent.node, generation: parent.generation, runId: parent.runId }, splitSha256: v.splitSha256, block, key, children: inBlock, openedBy: { id: decId, text } };
    }
  }
  return null;
}

/**
 * (M5e S6, L17) Should a frontier that is ALREADY approved be OFFERED again? A node that closed after the approval gave its unspent share back, and the approval showed a child as `not admitted: budget` that is still not
 * registered: it is proposed again at the next `council tree approve`. This is an OFFER only (findPendingFrontier, the sitting's `approvalWaits`): it never blocks the children the standing approval admitted (the chooser reads
 * frontierReopened, which stays for held_changed / split_changed / a limit raise).
 */
export function frontierOffersShare(record, key) {
  const approvedAt = record.events.reduce((a, e, i) => (e.event === 'frontier_approved' && e.frontierKey === key ? i : a), -1);
  const preview = record.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === key).at(-1);
  if (!preview || approvedAt < 0) return false;
  const registered = new Set(record.events.filter(e => e.event === 'node_registered').map(e => `${e.node}@g${e.generation}`));
  // budget commit 2 (gate page 13.1): a RAISE of the whole cap since the approval frees money exactly as a closed node's unspent share does, so a child refused for budget is offered again (before this it had no route after a `cap_amended` raise)
  const released = record.events.some((e, i) => i > approvedAt && ((e.event === 'node_closed' && typeof e.returnedUsd === 'number' && e.returnedUsd > 0) || (e.event === 'cap_amended' && e.toCapUsd > e.fromCapUsd)));
  return released && preview.children.some(c => c.admitted === false && c.refusedBy === 'budget' && !registered.has(`${c.node}@g${c.generation}`));
}

const originOf = id => (id ? `${id.originNode} ${id.originId}, ${id.originClass}` : 'this plan');

/**
 * What the approval of a ROOT replacement binds (design note 3.3): the preview payload, the grant formula, the limits, the sha256 of the decision text and of the root task bytes. ONE function: describeRootReplan makes it,
 * the registration (src/tree-loop.js) recomputes it, and a difference means what the person approved is not what would be registered.
 */
export function rootReplanBound({ preview, limits, decisionText, taskText, oldPlan = null, allowanceBytes = null }) {
  return sha256Of(canonicalJson({ ...preview, grantFormula: GRANT_FORMULA, limits: { maxDepth: limits.maxDepth, maxRuns: limits.maxRuns, maxChildrenPerSplit: limits.maxChildrenPerSplit }, decisionTextSha256: sha256Of(decisionText), taskSha256: sha256Of(taskText), ...(oldPlan ? { oldPlan } : {}), ...(Number.isInteger(allowanceBytes) ? { allowanceBytes } : {}) }));
}

/** The root task bytes a root replacement is planned from: the pin only (src/tree-root-replan.js rootTaskRefOf), and it must still be the pinned text. -> { text } | { refusal: string } */
export function rootTaskTextOf(tree) {
  const found = rootTaskRefOf(tree);
  if (found.refusal) return { refusal: found.refusal.text };
  const checked = checkRootTaskPin(found.ref);
  if (!checked.ok) return { refusal: `${checked.reason}: a different goal is a new tree, started with \`council tree start\`` };
  return { text: checked.text };      // the text the pin check read and hashed (one read: src/tree-task-pin.js readTaskAgainstPin)
}

/** describeFrontier for a root replacement (S8-5): no parent block, no providers, no split checks; the accounting gate, the limits and the grant are the same functions a child's use. */
function describeRootReplan({ rootDir, work, pending, record, state }) {
  const refuse = (check, detail) => ({ refusal: { item: 0, check, field: 'root replacement', detail } });
  const G = pending.children[0].generation;
  const task = rootTaskTextOf(record.tree); if (task.refusal) return refuse('task', task.refusal);
  const gate = gateTree(rootDir, { record });
  if (!gate.ok) return refuse('accounting', `the accounting gate fails: ${gate.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ')}`);
  const budget = budgetOf(rootDir, { record, gate });
  const limits = effectiveLimits(record.tree, record.events);
  let chain; try { chain = loadChainConfig({ tree: record.tree, depth: 0, work }); } catch (e) { return refuse('chain', `the root chain cannot be read: ${e.message}`); }
  const inputBytes = allowanceOfDecision(record.tree, record.events.find(e => e.event === 'decision_recorded' && e.id === pending.openedBy.id));       // a root plan is priced at the size its opening decision recorded (--allow-size), else the tree's number
  const figures = chainFigures(chain.config, { inputBytes });
  const expectedUsd = figures ? ((est) => est.expectedWithTaskUsd ?? est.expectedUsd)(dryRunReport(chain.config, { taskChars: inputBytes }).estimate) : null;       // the same basis as the cheapest end and the upper estimate (with the input), as tree-projection.js does
  const lim = admitAgainstLimits({ limits, registeredRuns: state.nodes.size, children: [{ id: 'R', depth: 0 }] })[0];
  const g = figures ? proposeGrants({ availableUsd: budget.availableUsd, children: [{ id: 'R', atMostUsd: figures.atMostUsd, cheapestUsd: figures.cheapestUsd }] })[0] : null;
  let admitted = lim.admitted; let reason = lim.reason; let refusedBy = null;
  if (admitted && !figures) { admitted = false; reason = 'not admitted: price pending preparation (the root chain has no dry-run figure)'; }
  else if (admitted && (!g.admitted || floorCents(g.grantUsd) + MONEY_EPS < figures.cheapestUsd)) { admitted = false; refusedBy = 'budget'; reason = `not admitted: budget (the ${budget.availableUsd.toFixed(2)} free after the set-aside does not cover the root chain's cheapest end ${figures.cheapestUsd.toFixed(2)}; you can raise the tree's cap with council tree decide ${basename(rootDir)} --amend-cap <total>)`; }       // B-DRAFT (Astra 17)
  const grant = admitted ? floorCents(g.grantUsd) : 0; const ceiling = figures ? ceilCents(figures.atMostUsd) : 0;
  const previewChild = { node: 'R', generation: G, chain: { name: chain.name, sha256: chain.sha256 }, ceilingUsd: ceiling, capUsd: grant, admitted, ...(admitted ? {} : { ...(lim.limit ? { limit: lim.limit } : {}), ...(refusedBy ? { refusedBy } : {}), reason }) };
  const preview = { frontierKey: pending.key, kind: 'root_replan', openedBy: pending.openedBy.id, parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [previewChild] };
  const boundSha256 = rootReplanBound({ preview, limits, decisionText: pending.openedBy.text, taskText: task.text, oldPlan: pending.openedBy.oldPlan ?? null, allowanceBytes: pending.openedBy.allowanceBytes ?? null });
  const dead = deadKeys(state); const held = heldKeys(state, { route: 'root' });                 // the root re-plan's own screen: sub-plan candidates are not held below a root plan
  const old = [...state.nodes.values()].filter(n => n.node !== 'R');
  // X4 fix-up (13 Oct 2026): a held node may hang under a root plan OLDER than the one this decision replaces (a node held from R@g1 across a second re-plan); the screen names the plan(s) the held nodes really hang under. The root generation whose children frontier a node hangs under = walk up its frontier chain to the frontier whose parent is R.
  const rootEraOf = n => { let f = state.frontiers.get(n.frontierKey); for (let i = 0; f && f.parentNode !== 'R' && i < 50; i += 1) f = state.frontiers.get(state.nodes.get(`${f.parentNode}@g${f.parentGeneration}`)?.frontierKey); return f?.parentGeneration ?? null; };
  const heldEraList = old.filter(n => held.has(`${n.node}@g${n.generation}`)).map(rootEraOf);
  const heldEras = [...new Set(heldEraList.filter(e => e !== null))].sort((a, b) => a - b);
  const heldUnknown = heldEraList.filter(e => e === null).length;       // a held node whose chain cannot be walked (cannot happen for a node heldKeys holds: it skips a null era; kept so the screen NEVER drops a node it counts)
  const view = {
    kind: 'root_replan', frontierKey: pending.key, rootId: record.tree.treeId, generation: G, previous: { generation: pending.parent.generation, runId: pending.parent.runId },
    openedBy: [{ id: pending.openedBy.id, text: pending.openedBy.text }], taskHash: sha256Of(task.text).slice(0, 12), ...(pending.openedBy.oldPlan ? { oldPlan: pending.openedBy.oldPlan } : {}),
    child: { chain: { name: chain.name, figures: figures ? { cheapestUsd: figures.cheapestUsd, expectedUsd, atMostUsd: figures.atMostUsd, inputBytes } : null }, grant, ceiling, admitted, notAdmittedReason: admitted ? null : reason, mayStop: admitted && g.maysStopBeforeFinishing, refusedLimit: admitted ? null : (lim.limit ?? null) },
    setAside: old.filter(n => dead.has(`${n.node}@g${n.generation}`)).length, held: old.filter(n => held.has(`${n.node}@g${n.generation}`)).length, heldEras, heldUnknown,
    budget: { rootCapUsd: effectiveCapUsd(record), spentUsd: budget.treeSpentUsd, heldUsd: budget.heldUsd, unknownSpendHeldUsd: budget.unknownSpendHeldUsd, unknownSpendNodes: budget.unknownSpendNodes, availableUsd: budget.availableUsd },
    limits: [{ limit: 'runs', count: state.nodes.size, effective: limits.maxRuns }],
  };
  return { view, frontierKey: pending.key, preview, boundSha256 };
}

/**
 * Describes a pending frontier: { refusal } when it cannot be put to a person (a PLAN 5.5 item fails, the audit inputs are unreadable, or a child cannot be derived), else
 *   { view, frontierKey, preview, boundSha256, text } where `view` is src/tree-stop.js's input, `preview` is the payload of the `frontier_previewed` record (including each child's chain, ceiling and the grant
 * shown as its cap) and `boundSha256` is the hash of exactly that payload plus the formula and the limits. Reads only. `ctx` = { rootDir, work, rootTaskPath }.
 */
export function describeFrontier({ rootDir, work, rootTaskPath, pending }) {
  const record = readTreeRecord(rootDir);
  const state = stateOf(record);
  if (pending.kind === 'root_replan') return describeRootReplan({ rootDir, work, pending, record, state });
  rootTaskPath = rootTaskPath ?? rootTaskPathOf(rootDir, work);       // (a root replacement reads its task from the pin, not from run.json)
  const runsDir = dirname(rootDir);
  const { parent, splitSha256, block, key } = pending;
  // a REPLACEMENT frontier names the children it replaces (at their new generations); a first split's children get their generation from childGenerationOf
  const subset = pending.children ?? null;
  const genOf = c => { const p = childNode(parent.node, c.milestone); return subset ? (subset.find(k => k.node === p)?.generation ?? 1) : childGenerationOf(state, parent.generation, p); };
  const parentDir = join(runsDir, parent.runId);
  // PLAN 5.5 items 1-4, as at a child's start and an expansion (the same function): a refusal names the item and the field
  const inputs = treeInputsFor({ record, state, runsDir, node: parent.node });
  if (inputs.unreadable.length) return { refusal: { item: 4, check: 'ancestor_questions', field: 'ancestors', detail: `the plan of ${inputs.unreadable.join(', ')} cannot be read, so PLAN 5.3 check 8 cannot be applied` } };
  const checked = expansionCheck({ runDir: parentDir, work, upTo: 4, inheritedGlobal: inputs.inheritedGlobal, ancestorQuestions: inputs.ancestorQuestions, accepted: planAuthorityOf(parent) });
  if (checked.refusal) return { refusal: checked.refusal };
  if (!block) return { refusal: { item: 3, check: 'body_block', field: 'deliverable.md', detail: 'the split block of the plan cannot be read' } };
  if (checked.sha256 !== splitSha256) return { refusal: { item: 3, check: 'split_changed', field: 'splitSha256', detail: `the verified split ${String(splitSha256).slice(0, 12)} is not the block now in the plan (${String(checked.sha256).slice(0, 12)})` } };

  const limits = effectiveLimits(record.tree, record.events);
  const ordered = dependencyOrder(parent.node, block).filter(c => !subset || subset.some(k => k.node === childNode(parent.node, c.milestone)));
  const derived = []; const derivationRefusals = [];
  for (const c of ordered) {
    try {
      const args = loadDerivation({ rootDir, parentRef: { node: parent.node, generation: parent.generation }, childId: c.id, generation: genOf(c), rootTaskPath, work, preview: true });
      derived.push({ child: c, d: deriveChild(args), chain: loadChainConfig({ tree: record.tree, depth: childNode(parent.node, c.milestone).split('/').length - 1, work }) });
    } catch (e) {
      if (e instanceof DeriveRefusal) derivationRefusals.push({ child: c, node: childNode(parent.node, c.milestone), generation: genOf(c), code: e.code, detail: e.detail ?? e.message, owner: e.owner ?? null });     // owner: in memory only (D2 F2(a)), so approve can say whether the plan's own text caused it
      else throw e;
    }
  }
  if (derivationRefusals.length) return { refusal: { item: 4, check: 'derivation', field: derivationRefusals[0].node, detail: `${derivationRefusals[0].node} cannot be derived (${derivationRefusals[0].code}): ${derivationRefusals[0].detail}`, derivationRefusals } };

  // admission against the limits, then the grant split, with the pure functions registration uses
  const gate = gateTree(rootDir, { record });
  if (!gate.ok) return { refusal: { item: 4, check: 'accounting', field: 'accounting gate', detail: `the accounting gate fails: ${gate.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ')}` } };
  const budget = budgetOf(rootDir, { record, gate });
  // the stop shows the chain's three dry-run figures; the grant split needs the cheapest end and the at-most (chainFigures), the expected figure is for the reader only
  const inputBytes = bundleAllowanceBytesOf(record.tree);
  const priced = derived.map(x => { const f = chainFigures(x.chain.config, { inputBytes }); return { ...x, figures: f ? { ...f, inputBytes, expectedUsd: ((est) => est.expectedWithTaskUsd ?? est.expectedUsd)(dryRunReport(x.chain.config, { taskChars: inputBytes }).estimate) } : null }; });
  // A frontier that is shown AGAIN (a parent_changed answered by approving, a limit raised) may already have registered children. They are SHOWN AND BOUND AS REGISTERED, at the grant they hold, never admitted again
  // and never re-sized; admission and the grant split run over the children not yet registered only (M5c5). The registered runs already count in registeredRuns, and those of THIS split count against its fan-out.
  const keyOfChild = x => nodeKey(childNode(parent.node, x.child.milestone), genOf(x.child));
  const registeredOf = x => state.nodes.get(keyOfChild(x)) ?? null;
  // a child a stop put in question (stale) is shown, bound as NOT admitted, with no grant and no share of the money, and counts toward no limit: the chooser will not register it either
  const staleOf = x => state.stale.has(keyOfChild(x));
  // a child a person closed before it started (c3b) is never registered and holds no share: shown, bound as NOT admitted, counted toward no limit, like a stale one
  const unstartedOf = x => state.closedUnstarted.has(keyOfChild(x));
  const fresh = priced.filter(x => !registeredOf(x) && !staleOf(x) && !unstartedOf(x));
  // C2b-2: a slot filled by a finished run of an earlier plan (REUSED) is not a run to start: it takes a place in the split's width, no money and no run. The entry is computed now (a pure comparison of the files) or, for a frontier shown AGAIN after its approval, read back from the preview that was approved.
  const slotPathOf = x => childNode(parent.node, x.child.milestone);
  const approvedReused = new Map((state.frontiers.get(key)?.children ?? []).filter(c => c.reused).map(c => [c.node, c.reused]));
  const reusePlan = reusePlanFor({ rootDir, work, rootTaskPath, state, parent, slotsWanted: fresh.map(x => ({ node: slotPathOf(x), generation: genOf(x.child) })) });
  const wanted = reusePlan.reused;
  // C2b-2 money fix-up 2: a slot a LIVE adoption holds that THIS frontier's own approval does not carry (a frontier re-keyed for the same parent - the era-2 numbering - sees the slot as unfilled and, before this, registered it fresh with a grant). The table (K8, reusedRefusal) lets exactly ONE approved frontier carry the `reused` entry of a candidate, so the second frontier cannot copy the entry: it shows the slot as NOT ADMITTED, held by the finished run, with no grant and no run. Its place in the split's width is counted by fanOutOf (a held slot is a child of every frontier that names it).
  const heldElsewhere = x => !approvedReused.has(slotPathOf(x)) && slotHeldBy(state, keyOfChild(x)) !== null;
  const reusedOf = x => approvedReused.get(slotPathOf(x)) ?? (heldElsewhere(x) ? null : (wanted.get(slotPathOf(x)) ?? null));
  const freshNew = fresh.filter(x => !reusedOf(x) && !heldElsewhere(x));
  const countedByFanOut = new Set((state.frontiers.get(key)?.children ?? []).filter(c => slotHeldBy(state, `${c.node}@g${c.generation}`) !== null).map(c => c.node));       // the held or reused slots fanOutOf already counts for THIS key
  const pendingReused = fresh.filter(x => (reusedOf(x) || heldElsewhere(x)) && !countedByFanOut.has(slotPathOf(x))).length;       // held or reused slots the record does not hold for this frontier yet (not yet approved)
  const alreadyOfThisSplit = fanOutOf(state, key, { pending: pendingReused });
  const freshLimits = admitAgainstLimits({ limits, registeredRuns: state.nodes.size, keptSoFar: alreadyOfThisSplit, children: freshNew.map(x => ({ id: x.child.id, depth: childNode(parent.node, x.child.milestone).split('/').length - 1 })) });
  const byLimits = new Map(freshLimits.map(l => [l.id, l]));
  const grantable = freshNew.filter(x => byLimits.get(x.child.id).admitted && x.figures && x.d.startable).map(x => ({ id: x.child.id, atMostUsd: x.figures.atMostUsd, cheapestUsd: x.figures.cheapestUsd }));
  const grants = new Map(proposeGrants({ availableUsd: budget.availableUsd, children: grantable }).map(g => [g.id, g]));

  const children = priced.map(x => {
    const node = childNode(parent.node, x.child.milestone);
    const reg = registeredOf(x);
    const heldUsd = reg ? reg.grant.amount + reg.topUps.reduce((a, t) => a + t.amount, 0) : null;      // exactly what the node holds: the first grant plus every top-up, no rounding
    const lim = byLimits.get(x.child.id) ?? { admitted: true, reason: null }; const g = grants.get(x.child.id);
    let admitted = lim.admitted; let reason = lim.reason; let refusedLimit = lim.limit ?? null; let refusedBy = null;
    const reused = reg ? null : reusedOf(x);
    if (reg) { /* registered: neither admitted nor sized again */ }
    else if (reused) { admitted = true; reason = null; refusedLimit = null; }       // filled by a finished run: admitted, never sized and never registered
    else if (heldElsewhere(x)) { admitted = false; refusedBy = 'held_by_adoption'; refusedLimit = null; reason = `not admitted: this slot is already filled by the finished run ${slotHeldBy(state, keyOfChild(x))}, which was reused when this split was approved`; }       // B-DRAFT (C2b-2 money fix-up 2, person-facing)
    else if (staleOf(x)) { admitted = false; refusedBy = 'stale'; reason = `not admitted: stale (${(state.staleWhy.get(keyOfChild(x)) ?? ['a stop put it in question']).join('; ')})`; }
    else if (unstartedOf(x)) { admitted = false; refusedBy = 'closed_unstarted'; reason = 'not admitted: closed before it started (a person closed it; it starts only as a new generation)'; }
    else if (admitted && !x.d.startable) { admitted = false; refusedBy = 'no_criteria'; reason = 'not admitted: no acceptance item is left after the guards (a run needs a criteria list)'; }       // A-DRAFT (BUG-B-006; mirrors tree-loop.js `no_criteria`, which refused it only AFTER the approval); it takes no share of the free money either (grantable above)
    else if (admitted && !x.figures) { admitted = false; reason = 'not admitted: price pending preparation (the child chain has no dry-run figure yet)'; }
    else if (admitted && (!g.admitted || floorCents(g.grantUsd) + MONEY_EPS < x.figures.cheapestUsd)) { admitted = false; refusedBy = 'budget'; reason = `not admitted: budget (an equal share of the ${budget.availableUsd.toFixed(2)} still free is under the chain's cheapest end ${x.figures.cheapestUsd.toFixed(2)}; you can raise the tree's cap with council tree decide ${basename(rootDir)} --amend-cap <total>)`; }     // D2 F9b S7 (A-DRAFT): the way out the root route already names
    const items = x.d.obligationMap.items;
    const agreementOf = (a, own) => ({ id: a.id, [own]: childNode(parent.node, block.children.find(k => k.id === (own === 'to' ? a.to : a.from)).milestone), what: a.what, check: a.integration_check });
    const mine = ids => (block.agreements ?? []).filter(a => ids.includes(a.id));
    const provides = mine(x.child.provides.flatMap(p => p.agreements)).map(a => agreementOf(a, 'to'));
    const expects = mine(x.child.expects.flatMap(p => p.agreements)).map(a => agreementOf(a, 'from'));
    return {
      id: x.child.id, node, generation: genOf(x.child), milestone: x.child.milestone, scope: x.child.scope,
      chain: { name: x.chain.name, sha256: x.chain.sha256, figures: x.figures ? { cheapestUsd: x.figures.cheapestUsd, expectedUsd: x.figures.expectedUsd ?? null, atMostUsd: x.figures.atMostUsd, inputBytes: x.figures.inputBytes ?? null } : null },
      grant: reg ? heldUsd : (reused ? 0 : (admitted ? floorCents(g.grantUsd) : 0)), ceiling: (reused || heldElsewhere(x)) ? 0 : (x.figures ? ceilCents(x.figures.atMostUsd) : 0), ...(reused ? { reused } : {}), admitted, notAdmittedReason: admitted ? null : reason, mayStop: !reg && !reused && admitted && g.maysStopBeforeFinishing,
      registered: reg ? { phase: reg.phase, heldUsd, runId: reg.runId } : null, refusedLimit: admitted ? null : refusedLimit, refusedBy: admitted ? null : refusedBy,
      inherited: items.filter(it => it.identity).map(it => ({ origin: originOf(it.identity), text: itemText(it.identity.form) })),
      refinements: items.filter(it => !it.identity).map(it => itemText(x.d.criteria[items.indexOf(it)])),
      provides, expects,
      refused: x.d.guardRefused.map(g2 => ({ guard: g2.guard, text: itemText(g2.form), origin: g2.identity ? `${g2.identity.originNode}:${g2.identity.originId}` : 'this plan' })),
      notEnforced: x.d.checkNotEnforced.map(n => ({ id: n.id, check: typeof n.form === 'object' ? n.form.check : '', text: itemText(n.form) })),
      lints: x.d.lints.map(l => ({ id: l.id, message: l.message })),
      held: x.d.held, heldSha256: heldDigest(x.d), bundleStartable: x.d.startable,
    };
  });

  const previewChildren = children.map(c => ({ node: c.node, generation: c.generation, chain: { name: c.chain.name, sha256: c.chain.sha256 }, ceilingUsd: c.ceiling, capUsd: c.grant, admitted: c.admitted, ...(c.reused ? { reused: c.reused } : {}), ...(c.registered ? { registered: true, phase: c.registered.phase } : {}), ...(c.admitted ? {} : { reason: c.notAdmittedReason, ...(c.refusedLimit ? { limit: c.refusedLimit } : {}), ...(c.refusedBy ? { refusedBy: c.refusedBy } : {}) }), scopeSha256: sha256Of(c.scope), heldSha256: c.heldSha256 }));
  // C3 (fate codes, bound in boundSha256): what became of every candidate the reuse check looked at, as CODES (never words: the printed text is bound by the gate's shownSha256). Absent when the tree holds no candidate, so a tree that never re-planned hashes as before.
  // The codes are read back from the latest STORED preview of this frontier, under the SAME condition `reused` is (approvedReused above: the preview already carries a reused slot) and also once the frontier is APPROVED (a frontier approved before this field existed has none): an adopted candidate leaves the live list the moment its approval is recorded, and the description of a previewed or approved frontier must never move its hash or make `reused` and `candidates` disagree.
  const storedPreview = record.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === key).at(-1);
  const readBack = storedPreview && (approvedReused.size > 0 || (state.frontiers.get(key)?.revisions?.length && approvalValid(state.frontiers.get(key))));
  // FAIL CLOSED: a candidate is `adopted` only if a `reused` entry that THIS preview's children carry names it, in that slot (a slot another frontier's adoption holds has no entry, and outcome 'self' adopts nothing: C2b-3 was dropped)
  const reusedSlots = new Map(children.filter(c => c.reused).map(c => [`${c.reused.adoptsNode}@g${c.reused.adoptsGeneration}`, `${c.node}@g${c.generation}`]));
  const candidates = readBack ? (storedPreview.candidates ?? []) : (reusePlan.fates ?? []).map(f => ({ key: f.candidate, fate: f.fate === 'adopted' && reusedSlots.get(f.candidate) !== f.slot ? 'kept' : f.fate, reason: f.code, slot: f.slot ?? null }));
  const adoptedSlots = candidates.filter(c => c.fate === 'adopted').map(c => c.slot).sort().join(',');
  // D2 F3(c) (rides BUG-B-008): the refusal is an object like every other describe refusal, so `tree approve` and the session route print its sentence through refusalWords (a plain string printed "PLAN 5.5 item undefined")
  if (adoptedSlots !== [...reusedSlots.values()].sort().join(',')) return { refusal: { item: 4, check: 'reuse_disagreement', field: 'reuse check', detail: `Cannot show the approval preview: the reuse check and the previewed children disagree about which slots a finished run fills (reuse check: ${adoptedSlots || 'none'}; previewed children: ${[...reusedSlots.values()].sort().join(', ') || 'none'}). This is a defect in the tree tool. The tree record has not been changed.` } };       // B-DRAFT (C3 a, fail closed)
  // C3 step b: the words of the screen (never bound: the gate binds the printed text, the preview binds the codes). Words are taken from the LIVE fates only where they match a bound candidate (same key and code); otherwise the screen prints the code. Per slot: the finished run that fills it (with the spend it carries, grant plus top-ups minus what it returned; unknown when the close recorded no return), or the comparison's reason a candidate was not used there.
  const liveFate = (key_, code) => (reusePlan.fates ?? []).find(f => f.candidate === key_ && f.code === code);
  for (const c of children) {
    const slotKey = `${c.node}@g${c.generation}`;
    const bound = candidates.find(x => x.slot === slotKey);
    const live = bound ? liveFate(bound.key, bound.reason) : null;
    if (c.reused && bound?.fate === 'adopted') {
      const sf = (reusePlan.slotFates ?? []).find(f => f.slot === slotKey && f.fate === 'reused');
      const n = state.nodes.get(`${c.reused.adoptsNode}@g${c.reused.adoptsGeneration}`);
      if (sf) c.reuseNote = { kind: 'reused', reason: sf.reason, spentUsd: n?.grant && typeof n.returnedUsd === 'number' ? Math.round((n.grant.amount + (n.topUps ?? []).reduce((a, t) => a + t.amount, 0) - n.returnedUsd) * 10000) / 10000 : null };
    } else if (!c.reused && !c.registered && c.admitted && !c.refusedBy && bound?.fate === 'kept' && live && String(live.reason).startsWith('changed:')) {
      c.reuseNote = { kind: 'changed', reason: live.reason, candidate: bound.key };
    }
  }
  const passedOver = candidates.filter(c => c.fate === 'kept').map(c => ({ key: c.key, slot: c.slot, reason: liveFate(c.key, c.reason)?.reason ?? `(${c.reason})` }));
  const preview = { frontierKey: key, parentNode: parent.node, parentGeneration: parent.generation, parentRunId: parent.runId, splitSha256, children: previewChildren, ...(candidates.length ? { candidates } : {}) };
  const boundSha256 = sha256Of(canonicalJson({ ...preview, grantFormula: GRANT_FORMULA, limits: { maxDepth: limits.maxDepth, maxRuns: limits.maxRuns, maxChildrenPerSplit: limits.maxChildrenPerSplit } }));
  const view = {
    frontierKey: key, rootId: record.tree.treeId,
    parent: { node: parent.node, generation: parent.generation, runId: parent.runId, splitSha256, results: RESULT_WORDS.map((words, i) => ({ item: i + 1, ok: true, words })) },
    openedBy: pending.openedBy ? [{ id: pending.openedBy.id, text: pending.openedBy.text }] : [],
    children,
    passedOver,
    budget: { rootCapUsd: effectiveCapUsd(record), spentUsd: budget.treeSpentUsd, heldUsd: budget.heldUsd, unknownSpendHeldUsd: budget.unknownSpendHeldUsd, unknownSpendNodes: budget.unknownSpendNodes, availableUsd: budget.availableUsd },
    limits: [{ limit: 'runs', count: state.nodes.size, effective: limits.maxRuns }, { limit: 'depth', count: parent.node.split('/').length, effective: limits.maxDepth }, { limit: 'children per split', count: fanOutOf(state, key, { pending: pendingReused + children.filter(c => c.admitted && !c.registered && !c.reused).length }), effective: limits.maxChildrenPerSplit }],
    unexpanded: (block.milestones ?? []).filter(m => m.status === 'decompose' && !block.children.some(c => c.milestone === m.id)).map(m => m.id),
  };
  return { view, frontierKey: key, preview, boundSha256 };
}

