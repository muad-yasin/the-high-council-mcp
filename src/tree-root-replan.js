// The root re-plan LIBRARY (0.8.3 M6 slice S8-3; rulings row 130, design note M6_Root_Regenerate_Design_Note.md sections 2, 3.4, 3.6, 6): what a person's decision to re-plan the ROOT needs, as functions that can be tested
// without a terminal. Three things and nothing else:
//   rootReplanPreflight   the preconditions of section 2, ALL read-only and checked BEFORE the person types anything (a refusal costs no typing and writes nothing): the record reads, an open stop of the root is chosen,
//                         nothing is active and no sitting runs, the accounting gate passes, the money after the set-aside covers the root chain's cheapest end, no earlier re-plan is pending, the root plan is
//                         closed, and the task file is still the one the tree was started with.
//   rootBundle            the input bundle of R@g<n> (section 3.6): task.md (the task's bytes, unchanged), context.md (section 6, Draft A: the existing part-7 shape and the person's text, no new sentence),
//                         node.json (the lineage `--tree-node` reads, which carries the bundle's hash and is not part of it). Pure: writes nothing. writeRootBundle writes it through tree-derive's writeBundle.
//   registerRootReplan    the registration of R@g<n>, n >= 2, through registerChildAdmitted (the accounting gate, the limits and the grant fitting what the cap has free, in ONE hold of the tree lock), with the
//                         run it replaces and the sha256 of the task bytes. The table row R2 (src/tree-transitions.js) is what makes this a record at all.
// NOT here: the decide form and its gate text (S8-4), the frontier kind and the approve text (S8-5), the starter. This file calls no model and spends nothing.
// The task is read from the PIN in tree.json (`rootTask`, src/tree-task-pin.js; C&C ruling 12 Oct: the pin, never run.json - there is NO fall-back). A tree whose tree.json has no pin, or a damaged one, is refused. Every tree
// `council tree start` makes has a pin; the test fixture (test/helpers/tree-fixture.js newTree) writes one too.
// THE PRODUCTION CALLER that must supply `sittingHeld` is the decide form of S8-4 (src/tree-decide-stop.js, regenerate on a ROOT stop): it passes `() => lockHolder(treeDirOf(rootDir), { file: SITTING_LOCK_FILE }) !== null`. The argument
// is required and the function throws without it, so a caller cannot omit the check silently.
// Tier of what this file keeps (backend-developer rule 5): nothing. Every figure is derived on read from the record and the files.
import { basename, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { sha256Of } from './thin-contract.js';
import { taskHashOf } from './scope-freeze.js';
import { nextRunId } from './run-files.js';
import { readTreeRecord, stateOf } from './tree-record.js';
import { latestGenerationOf, unopenedBeforeReplan } from './tree-transitions.js';
import { activeNodeWords } from './tree-close.js';
import { nodeKey } from './tree-identity.js';
import { MONEY_EPS, bundleAllowanceBytesOf, budgetOf, ceilCents, chainFigures, floorCents, gateTree } from './tree-budget.js';
import { loadChainConfig } from './tree-derive-load.js';
import { piece, writeBundle } from './tree-derive.js';
import { bundleHashOfFiles, NODE_FILE } from './tree-continuation.js';
import { OLD_PLAN_FILE } from './tree-bundle-input.js';
import { registerChildAdmitted } from './tree-register.js';
import { checkRootTaskPin, rootTaskPinFrom } from './tree-task-pin.js';

const refusal = (code, text) => ({ refusal: { code, text } });
const money = n => `$${n.toFixed(2)}`;

/** Where the root task is recorded: { ref: { task, cwd, taskHash }, source: 'pin' } | { refusal }. Only the pin in tree.json; none or a damaged one refuses. */
export function rootTaskRefOf(tree) {
  const pin = rootTaskPinFrom(tree);
  if (pin.status === 'ok') return { ref: pin.pin, source: 'pin' };
  if (pin.status === 'unusable') return refusal('task_pin_unusable', `the root task recorded in tree.json cannot be used (${pin.reason}): the task cannot be shown to be the same, and a different goal is a new tree`);
  return refusal('task_not_recorded', 'tree.json records no root task (a tree started before the task was pinned): a root re-plan needs it to show the task is unchanged, and a different goal is a new tree');
}

/** The sentence for "a node is active" in the root re-plan preflight: the shared words (src/tree-close.js activeNodeWords) when `--close` is refused or the node waits for the person, else today's sentence, which is true there (A-DRAFT, C&C 23 Okt 2026; the rule S8 2.3 is unchanged). */
function activeSentenceOf({ state, record, rootDir, key }) {
  const n = state.nodes.get(key);
  const fixed = `${key} is ${n?.phase ?? 'active'}: answer or close it first (a node registered and not started counts as active; \`council tree decide --close\` ends it)`;
  return activeNodeWords({ state, runsDir: dirname(rootDir), key, route: 'a root re-plan', record }) ?? fixed;
}

/**
 * The preconditions of design note section 2, in the note's order. `sittingHeld` is REQUIRED: a function that says whether a sitting of this tree runs (the decide form passes `() => lockHolder(...) !== null`; this
 * file must not import the sitting, which imports the loop that will import this file). `stopId` names the root stop to answer; absent = the only open root stop.
 * -> { refusal: { code, text } } or { ok: true, stop, previous: { node:'R', generation, runId }, generation, task: { path, source, taskHash, taskSha256, text }, chain: { name, sha256, figures },
 *      spentUsd, unknownSpendHeldUsd, freeUsd, rootCapUsd }. Reads only.
 */
export function rootReplanPreflight(rootDir, { work, stopId, sittingHeld, allowanceBytes } = {}) {
  if (typeof sittingHeld !== 'function') throw new TypeError('rootReplanPreflight: sittingHeld is required (a function that says whether a sitting of this tree runs)');
  // 2.1 the record reads
  const record = readTreeRecord(rootDir);
  if (record.treeError || !record.tree) return refusal('record_unreadable', `the tree record cannot be read (${record.treeError ?? 'there is no tree.json'}): nothing was changed`);
  if (record.corrupt.length) return refusal('record_corrupt', `the tree record is corrupt (${record.corrupt.map(c => c.reason).join('; ')}): nothing was changed`);
  const state = stateOf(record);
  // 2.2 the chosen stop is open and belongs to the LIVE root plan. The live root is the newest registered R; a stop of an older generation (the table refuses to open one now, but a record written before that rule may hold
  // one) asks about a plan that no longer stands and is never offered. 2.7 first: the root plan being replaced is CLOSED (a budget-stopped, running or paused root must end first).
  const gen = latestGenerationOf(state, 'R');
  const root = [...state.nodes.values()].filter(n => n.node === 'R').sort((a, b) => b.generation - a.generation)[0];
  if (!root) return refusal('no_root', 'the tree has no registered root: there is no root plan to replace');
  const openStops = state.openStops.map(id => record.events.find(e => e.id === id)).filter(Boolean);
  const rootStops = openStops.filter(e => e.node === 'R' && e.generation === root.generation);
  if (stopId !== undefined) {
    const s = openStops.find(e => e.id === stopId);
    if (!s) return refusal('stop_not_open', `--stop ${stopId}: that is not an open stop`);
    if (s.node !== 'R') return refusal('stop_not_root', `stop ${stopId} belongs to ${s.node ?? 'no node'}, not to the root: only a stop of the root is answered by a new root plan`);
    if (s.generation !== root.generation) return refusal('stop_dead', `stop ${stopId} belongs to R@g${s.generation}, a root plan that was already replaced (the root now is R@g${root.generation}): it is not answered by a new root plan`);
  } else if (!rootStops.length) return refusal('no_root_stop', 'no open stop of the root: there is nothing to answer with a new root plan');
  else if (rootStops.length > 1) return refusal('stop_ambiguous', `${rootStops.length} stops of the root are open (${rootStops.map(e => e.id).join(', ')}); name the one this answers with --stop <id>`);
  const stop = stopId !== undefined ? openStops.find(e => e.id === stopId) : rootStops[0];
  if (root.phase !== 'closed') return refusal('root_not_closed', `the root plan ${nodeKey(root.node, root.generation)} is not closed (it is ${root.phase}): it must end first (answer its pause, raise its cap, or close it with \`council tree decide --close\`)`);
  // 2.6 no earlier root re-plan is still pending: a decision that re-plans the root whose generation is not registered yet
  if (gen > root.generation || [...state.decisions.values()].some(d => d.replansRoot && !d.opened)) return refusal('replan_pending', `a root re-plan is already pending (R@g${gen} is opened and not registered): run \`council tree approve\` for it`);
  // CR-2G-004 (A-DRAFT words): a recorded decision whose new generation is not opened yet would open into the NEW era and feed its text to a child of a plan chosen without it; the resume opens it (recovery runs its openings under a block
  // too, D2 F5a), so the way out printed here is real. Decisions this re-plan supersedes are not waited for (the same predicate recovery skips: supersededByRootReplan)
  { const waiting = unopenedBeforeReplan(state, stop.id); if (waiting.length) return refusal('decision_unopened', `decision ${waiting.join(', ')} is recorded but the new plan it asked for is not opened yet: run \`council tree resume ${record.tree?.treeId ?? '<rootId>'}\` first, then decide`); }
  // 2.3 nothing is active, no sitting runs
  if (state.active !== null) return refusal('node_active', activeSentenceOf({ state, record, rootDir, key: state.active }));
  if (sittingHeld()) return refusal('sitting_running', 'a sitting of this tree is running: nothing was changed; wait for it to end');
  // 2.4 the accounting gate passes
  const gate = gateTree(rootDir, { record });
  if (!gate.ok) return refusal('accounting_blocked', `the accounting gate fails: ${gate.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ')}`);
  // the task is the one the tree was started with (a different goal is a new tree)
  const found = rootTaskRefOf(record.tree);
  if (found.refusal) return found;
  const checked = checkRootTaskPin(found.ref);
  if (!checked.ok) return refusal('task_changed', `${checked.reason} (recorded in ${found.source}): a different goal is a new tree, started with \`council tree start\``);
  const text = readFileSync(checked.path, 'utf8');
  // 2.5 money: what is free AFTER the set-aside covers the root chain's cheapest end. Computed from the cap, the spend and the unknown-spend hold, never from today's availableUsd (which still counts grants the decision is
  // about to release). The cap is never raised: when it does not fit, the only route left is a new tree.
  const budget = budgetOf(rootDir, { record, gate });
  const freeUsd = budget.rootCapUsd - budget.treeSpentUsd - budget.unknownSpendHeldUsd;
  let chain; try { chain = loadChainConfig({ tree: record.tree, depth: 0, work }); } catch (e) { return refusal('chain_unreadable', `the root chain cannot be read: ${e.message}`); }
  const figures = chainFigures(chain.config, { inputBytes: Number.isInteger(allowanceBytes) && allowanceBytes > 0 ? allowanceBytes : bundleAllowanceBytesOf(record.tree) });   // a raise typed for THIS new root plan (--allow-size) prices it at the raised size
  if (!figures) return refusal('chain_unpriced', `the root chain ${chain.name} has no dry-run figure: it cannot be priced, so a grant for it cannot be checked`);
  if (freeUsd + MONEY_EPS < figures.cheapestUsd) return refusal('budget', `the free amount ${money(freeUsd)} (the cap ${money(budget.rootCapUsd)} minus ${money(budget.treeSpentUsd)} spent${budget.unknownSpendHeldUsd ? ` and ${money(budget.unknownSpendHeldUsd)} held for a spend that cannot be read` : ''}) is below the cheapest end ${money(figures.cheapestUsd)} of the root chain. You can raise the tree's cap with \`council tree decide ${basename(rootDir)} --amend-cap <total>\` (the total is yours to type), or start a new tree with \`council tree start\``)       // B-DRAFT (Astra 17: the cap CAN be raised since the cap amendment; a false sentence does not wait for the yes)
  return {
    ok: true, stop, previous: { node: 'R', generation: root.generation, runId: root.runId }, generation: gen + 1,
    task: { path: checked.path, source: found.source, taskHash: taskHashOf(text), taskSha256: sha256Of(text), text },
    chain: { name: chain.name, sha256: chain.sha256, figures },
    spentUsd: budget.treeSpentUsd, unknownSpendHeldUsd: budget.unknownSpendHeldUsd, freeUsd, rootCapUsd: budget.rootCapUsd,
  };
}

/**
 * The input bundle of R@g<generation> (section 3.6). `decisions` = [{ id, text }], the decisions that opened this generation. Pure.
 * -> { node:'R', generation, files, bundleSha256, bundleBytes, lineage }. context.md is Draft A (Muad's pick, 11 Oct): the existing `# Context` / part-7 heading and the existing `piece()` frame around the
 * person's text, nothing else - no sentence of its own. NO criteria.json: the new root derives its criteria through its chain's criteria stage, as generation 1 did.
 */
export function rootBundle({ treeId, generation, decisions, taskText, oldPlanText = null }) {
  if (!Number.isInteger(generation) || generation < 2) throw new TypeError('rootBundle: a root bundle is for generation 2 or later');
  if (!Array.isArray(decisions) || !decisions.length || decisions.some(d => typeof d?.id !== 'string' || typeof d?.text !== 'string' || !d.text)) throw new TypeError('rootBundle: the decisions that opened the generation are { id, text } with the person\'s text');
  const files = {
    'task.md': taskText,
    'context.md': `# Context\n\n## 7. The decisions that opened this generation\n\n${decisions.map(d => piece(`decision ${d.id}`, d.text)).join('')}`,
    ...(typeof oldPlanText === 'string' ? { [OLD_PLAN_FILE]: oldPlanText } : {}),       // bundle unit step 2: the set-aside plan as builder-only data (src/old-plan.js); absent = a bundle exactly as before
  };
  const bundleSha256 = bundleHashOfFiles(files);
  const lineage = { treeId, node: 'R', generation, attempt: 1, parentNode: null, depth: 0, splitSha256: null, bundleSha256 };
  files[NODE_FILE] = `${JSON.stringify(lineage, null, 2)}\n`;
  return { node: 'R', generation, files, bundleSha256, bundleBytes: Object.values(files).reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0), lineage };
}

/** Writes the bundle to tree/inputs/R@g<n>/ (tree-derive's writeBundle: a temp folder and a rename; an identical bundle is left; a different one for a REGISTERED node is refused). -> { dir, written }. */
export const writeRootBundle = (rootDir, bundle) => writeBundle(rootDir, bundle);

/**
 * Registers R@g<generation> (>= 2) through the admitted path. The grant is what is free after the set-aside, floored to cents and capped at the root chain's at-most figure ("the free amount, not the whole cap",
 * note 3.4); the table (row R2) and the admission checks (accounting gate, limits, the grant fits, covers the cheapest end) decide. `previous` = the run being replaced. A fresh run folder id is made here. Throws a
 * TreeRefusal when anything refuses (nothing is registered, a `blocked` record says why). -> the node_registered event.
 */
export function registerRootReplan(rootDir, { generation, frontierKey, bundle, chain, previous, taskSha256, capUsd, runId = nextRunId(), now, facts } = {}) {
  if (!(capUsd > 0)) throw new TypeError('registerRootReplan needs `capUsd`: the money cap the approval showed');
  const budget = budgetOf(rootDir);
  // never above the cap the approval showed (`capUsd`; the child path clamps the same way), nor the chain's at-most figure, nor what is free now: what is free can RISE between the approval and this call (the bound hashes the preview, not the budget), and a refusal there would strand an approved frontier
  // 99d151b (20 Okt, C&C thcmcp-6d gate finding: "a binding upper estimate is granted whole and never shown below its raw figure"): the at-most figure is a WHOLE CENT, rounded UP, here exactly as the approval's preview rounds it (tree-frontier.js describeRootReplan, proposeGrants). OLD: the raw figure (4.9190000000000005), which is below the 4.92 the approval showed and not a whole cent; this path was not updated with the child path.
  const grantUsd = Math.min(floorCents(budget.availableUsd), ceilCents(chain.figures.atMostUsd), capUsd);
  return registerChildAdmitted(rootDir, {
    frontierKey, node: 'R', generation, runId, parentRunId: null, splitSha256: null, chain: { name: chain.name, sha256: chain.sha256 }, grant: { amount: grantUsd, unit: 'usd' },
    bundleSha256: bundle.bundleSha256, bundleBytes: bundle.bundleBytes, replacesRunId: previous.runId, taskSha256, cheapestUsd: chain.figures.cheapestUsd,
  }, { now, facts });
}
