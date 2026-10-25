// REUSE of old sub-plans at a root re-plan: the LOADER (0.8.3 M6 S8-9, C1; contract Review/Build_0.8.3/m6-closing/S8-9_Reuse_Contract.md section 2, option O-A). It reads the two sides of the comparison from the run folders through the
// ONE derivation both sides use (`loadDerivation` + `deriveChild` in preview mode, src/tree-derive-load.js / tree-derive.js) and VERIFIES the old side before it is offered for comparison; the comparison itself is the pure
// src/tree-reuse.js. Reads files; writes nothing; takes no lock; calls no model.
//
// Contract:
//   verifyOldChild({ rootDir, work, rootTaskPath, oldParent: { node, generation }, node, generation, derive = deriveChild }) -> { problem: string | null, side: <the old side> | null, old: { node, generation, runId } | null }
//        The old side is RE-DERIVED from the old parent's verified split and the root task bytes (the task is pinned: `rootReplanPreflight` refuses a re-plan whose task changed), then checked against what the old child
//        REGISTERED AND RAN ON (C&C's fix-up ruling on 87f0ce2: every F-field of the old side comes from bytes the old child actually ran on, or the verdict is `changed: old inputs cannot be verified`):
//        (1) its bundle folder under tree/inputs/ hashes (`bundleSha256Of`, the folder hasher the derivation's `bundleHashOfFiles` matches) to the `bundleSha256` of its `node_registered`; (2) the re-derived obligation
//        map equals the registered one; (3) the re-derived task.md and criteria.json equal the bundle's files byte for byte; (4) the re-derived context.md equals the bundle's in the parts that carry F-fields - 1 (the entry:
//        scope, agreements), 2 (the root-task sections) and 6 (carried in context) - byte for byte. Parts 3, 4, 5 and 7 (the providers' settled text, the parent plan, the parent's criteria, the decisions) are the ones the
//        contract EXCLUDES and are not compared. The re-derivation is the FULL one (not the preview): the files are what is compared. Anything else is a `problem` and NO side: a hand-edited old bundle cannot manufacture
//        a `same`, and a change in how `deriveChild` RENDERS the entry, the question, the agreements or the carried text fails closed, as does one that alters the map or the list. `derive` is a seam for tests only.
//   newRootAmbiguousKeys({ rootDir, newParent: { node, generation } }) -> [key] : the criteria the NEW root plan lists more than once (same { originNode, originClass, textSha256 }), in the form compareChildren's `ambiguousKeys` takes.
//        Every child that inherits one of them is `changed: acceptance list is ambiguous`: each child's own check cannot see a duplicate that two children inherit one each of, and the tree-wide identity table would then
//        hold two answers for one `from` (S8-9 identity-map survey). `ambiguousKeysOfItems({ items, classOf })` is the pure part (a test feeds it a list with a repeated criterion).
//   loadChildren({ rootDir, work, rootTaskPath, newParent, oldParent, slotGeneration, eligibility, wholeBranch }) -> children for compareChildren, providers before consumers (`dependencyOrder`). `newParent` and `oldParent` are ANY { node, generation } pair
//        (S8-9 §11: the comparison runs at every split, so the old parent may be a non-root node such as R/M1@g1).
//        `eligibility(oldNodeKey) -> { eligible, why }` and `wholeBranch(oldNodeKey) -> boolean` are HANDED IN, BOTH REQUIRED (a missing one throws: no fail-open default): they are the two record-only predicates of the held state (src/tree-transitions.js, A's file:
//        per-node eligibility and the whole-branch flag, S8-9 §11.3) and this file has no second list of either. Each child gets `wholeBranch: true | false`.
//   ancestorChainOf(state, parent) -> [{ node, generation }] from `parent` up to the root, by the frontier each node was registered under (a broken chain stops the walk where it breaks).
//   ambiguousKeysOfChain({ rootDir, newParent }) -> [key] : the criteria that repeat in the OWN list of the new parent or of ANY of its ancestors (S8-9 §11.5: the identity table is tree-wide, so an inherited root criterion repeated at the root is ambiguous for a deeper adoption even when the parent's own list holds it once).
import { readFileSync } from 'node:fs';
import { readRunJson } from './run-files.js';
import { dirname, join } from 'node:path';
import { canonicalJson, sha256Of } from './thin-contract.js';
import { oneLine } from './criteria-lock.js';
import { readTreeRecord, stateOf } from './tree-record.js';
import { childNode } from './tree-identity.js';
import { formsOfReport, loadDerivation, readPlanOf } from './tree-derive-load.js';
import { deriveChild, itemText } from './tree-derive.js';
import { bundleDirOf, bundleSha256Of } from './tree-continuation.js';
import { dependencyOrder } from './tree-frontier.js';
import { duplicateKeysOf, sideOf } from './tree-reuse.js';

const keyOf = (node, generation) => `${node}@g${generation}`;
const words = e => String(e?.message ?? e).split('\n')[0].slice(0, 300);

/**
 * deriveChild's seven part headings, exactly as src/tree-derive.js writes them (a test pins this list against a real derived context: a heading reworded there makes every old child unverifiable, never a wrong `same`).
 * Parts 2, 3, 4 and 7 QUOTE model-written text verbatim (root-task and plan sections, decisions), and a quoted section may carry numbered headings of its own: so the parts are found by these full heading lines, each
 * exactly once and in this order, not by any line that looks like `## <n>. `.
 */
const PART_HEADINGS = Object.freeze([
  "## 1. The child's entry in the signed split", '## 2. The root task: its goal and exclusions', '## 3. What the providers settled', "## 4. Sections of the parent plan named in the child's context_refs",
  "## 5. The parent's locked criteria, for reference", '## 6. Obligations carried in context only, and checks the harness cannot enforce', '## 7. The decisions that opened this generation',
]);

/** A context.md split into its seven parts -> Map n -> text (heading line to the next heading); null when a heading is missing, repeated or out of order - then nothing can be compared and the old side is not verified. */
export function contextParts(text) {
  const t = String(text); const at = [];
  for (const h of PART_HEADINGS) {
    const needle = `\n${h}\n`; const first = t.indexOf(needle);
    if (first < 0 || t.indexOf(needle, first + 1) >= 0 || (at.length && first <= at.at(-1))) return null;
    at.push(first + 1);
  }
  return new Map(at.map((from, i) => [i + 1, t.slice(from, i + 1 < at.length ? at[i + 1] : undefined)]));
}
const COMPARED_PARTS = Object.freeze([1, 2, 6]);

export function verifyOldChild({ rootDir, work, rootTaskPath, oldParent, node, generation, derive = deriveChild }) {
  const fail = (problem, old = null) => ({ problem, side: null, old });
  const record = readTreeRecord(rootDir); const state = stateOf(record); const runsDir = dirname(rootDir);
  const n = state.nodes.get(keyOf(node, generation));
  if (!n) return fail(`${keyOf(node, generation)} is not registered in this tree`);
  const old = { node, generation, runId: n.runId };
  const reg = record.events.find(e => e.event === 'node_registered' && e.node === node && e.generation === generation);
  // the node's CURRENT bundle hash (its registration, or its newest rebuild: the fold keeps it on the node)
  const wantBundle = typeof n.bundleSha256 === 'string' ? n.bundleSha256 : reg?.bundleSha256;
  if (!reg || typeof wantBundle !== 'string') return fail(`${keyOf(node, generation)} was registered without the hash of its input bundle`, old);
  if (!reg.obligations) return fail(`${keyOf(node, generation)} was registered without its obligation map`, old);
  const parentNode = state.nodes.get(keyOf(oldParent.node, oldParent.generation));
  if (!parentNode) return fail(`the earlier parent ${keyOf(oldParent.node, oldParent.generation)} is not in the record`, old);
  const block = readPlanOf(runsDir, parentNode).block;
  const milestone = node.split('/').at(-1);
  const childId = block?.children?.find(c => c.milestone === milestone)?.id;
  if (!childId) return fail(`the earlier parent's signed split has no child for milestone ${milestone}`, old);
  let args; let derived;
  try { args = loadDerivation({ rootDir, parentRef: oldParent, childId, generation, rootTaskPath, work, preview: false }); derived = derive(args); } catch (e) { return fail(`its earlier derivation cannot be redone (${words(e)})`, old); }
  const folder = bundleDirOf(rootDir, node, generation);
  const onDisk = bundleSha256Of(folder);
  if (onDisk === null) return fail('its input bundle folder is gone', old);
  if (onDisk !== wantBundle) return fail('its bundle folder is not the one registered (the hash of its files differs from the record)', old);
  if (canonicalJson(reg.obligations) !== canonicalJson(derived.obligationMap)) return fail('the earlier derivation no longer reproduces the obligation map the node registered with', old);
  let criteria; try { criteria = JSON.parse(readFileSync(join(folder, 'criteria.json'), 'utf8')); } catch { return fail('its criteria.json cannot be read', old); }
  if (canonicalJson(criteria) !== canonicalJson(derived.criteria)) return fail('the earlier derivation no longer reproduces the acceptance list the node ran with', old);
  const rendered = derived.files ?? {}; const said = (what) => fail(`the earlier derivation no longer renders ${what} as the node ran on it`, old);
  for (const name of ['task.md', 'criteria.json']) { let disk; try { disk = readFileSync(join(folder, name), 'utf8'); } catch { return fail(`its ${name} cannot be read`, old); } if (rendered[name] !== disk) return said(name); }
  let ctx; try { ctx = readFileSync(join(folder, 'context.md'), 'utf8'); } catch { return fail('its context.md cannot be read', old); }
  const now = contextParts(rendered['context.md'] ?? ''); const ran = contextParts(ctx);
  if (!now || !ran) return fail(`its context.md${ran ? ' as rendered today' : ''} does not split into deriveChild's seven parts (a heading is missing, repeated or out of order)`, old);
  for (const n of COMPARED_PARTS) if (now.get(n) !== ran.get(n)) return said(`context part ${n}`);
  return { problem: null, side: sideOf({ args, derived }), old };
}

export function loadChildren({ rootDir, work, rootTaskPath, newParent, oldParent, slotGeneration, eligibility, wholeBranch }) {
  if (typeof eligibility !== 'function') throw new TypeError('loadChildren: `eligibility` (A\'s per-node held-eligible predicate) is required: this file keeps no list of its own');
  if (typeof wholeBranch !== 'function') throw new TypeError('loadChildren: `wholeBranch` (A\'s whole-branch predicate) is required: without it a branch with a missing piece could be adopted as a unit');
  const record = readTreeRecord(rootDir); const state = stateOf(record); const runsDir = dirname(rootDir);
  const newNode = state.nodes.get(keyOf(newParent.node, newParent.generation));
  if (!newNode) throw new TypeError(`loadChildren: ${keyOf(newParent.node, newParent.generation)} is not in the record`);
  const newBlock = readPlanOf(runsDir, newNode).block;
  if (!newBlock) return [];
  const out = [];
  for (const c of dependencyOrder(newParent.node, newBlock)) {
    const node = childNode(newParent.node, c.milestone);
    const slot = { node, generation: slotGeneration };
    let newSide = null; let newProblem = null;
    try { const args = loadDerivation({ rootDir, parentRef: newParent, childId: c.id, generation: slotGeneration, rootTaskPath, work, preview: true }); newSide = sideOf({ args, derived: deriveChild(args) }); } catch (e) { newProblem = words(e); }
    // the earlier node of this path: the one the OLD parent's frontier proposed (the newest generation of it)
    const earlier = [...state.nodes.values()].filter(n => n.node === node && state.frontiers.get(n.frontierKey)?.parentNode === oldParent.node && state.frontiers.get(n.frontierKey)?.parentGeneration === oldParent.generation).sort((a, b) => b.generation - a.generation)[0];
    if (!earlier) { out.push({ node, slot, newSide, newProblem, oldSide: null, old: null, oldProblem: null, eligible: true, ineligibleWhy: null, wholeBranch: true }); continue; }
    const ver = verifyOldChild({ rootDir, work, rootTaskPath, oldParent, node, generation: earlier.generation });
    const el = eligibility(keyOf(node, earlier.generation)) ?? { eligible: false, why: 'the eligibility predicate gave no answer' };
    out.push({ node, slot, newSide, newProblem, oldSide: ver.side, old: ver.old, oldProblem: ver.problem, eligible: el.eligible === true, ineligibleWhy: el.eligible === true ? null : (el.why ?? 'the earlier node is not eligible for reuse'), wholeBranch: wholeBranch(keyOf(node, earlier.generation)) === true });
  }
  return out;
}

/**
 * C2a (gate page section 7, Astra #8): a candidate's SUPPLIER pins as RUN-level pins. The record's `dependsOn` (registered with the node) holds { node, generation, thinContractSha256 }; the slot rule matches suppliers by { node, generation, runId }, so each pin gets its run id from the record
 * and its thin contract is checked against the supplier's own report, exactly as the continuation check does (tree-continuation.js). -> { pins: [{ node, generation, runId }] | undefined, problem: string | null }. `registeredDependsOn` absent (a record from before the field) gives pins
 * undefined: the slot rule fails closed on that. A supplier that is not in the record, or whose thin contract is not the registered one, is a problem and no pins.
 */
export function pinsOf({ registeredDependsOn, state, runsDir }) {
  if (!Array.isArray(registeredDependsOn)) return { pins: undefined, problem: null };
  const pins = [];
  for (const d of registeredDependsOn) {
    const n = state.nodes.get(keyOf(d.node, d.generation));
    if (!n) return { pins: undefined, problem: `a supplier it was planned against, ${keyOf(d.node, d.generation)}, is not in the record` };
    if (d.thinContractSha256) {
      const sha = readRunJson(join(runsDir, n.runId), 'report.json')?.thin_contract?.sha256;
      if (sha !== d.thinContractSha256) return { pins: undefined, problem: `the thin contract of ${keyOf(d.node, d.generation)} is not the one this node was planned against` };
    }
    pins.push({ node: d.node, generation: d.generation, runId: n.runId });
  }
  return { pins, problem: null };
}

/**
 * The nodes of a candidate's OWN branch as run-level pins: the kids its frontiers proposed (parent = this node@generation), the newest generation of each path, and so on down. Read from the record by lineage and NOT by liveness: a held candidate and its whole
 * branch are orphans of a replaced parent by design (providerSubtreeOf leaves orphans out), but a consumer planned against the candidate pinned exactly this set (tree-derive.js dependsOn). Pure. -> [{ node, generation, runId }] sorted by path.
 */
export function branchPinsOf(state, n) {
  const out = []; const seen = new Set();
  const walk = parent => {
    const kids = [...state.nodes.values()].filter(c => state.frontiers.get(c.frontierKey)?.parentNode === parent.node && state.frontiers.get(c.frontierKey)?.parentGeneration === parent.generation);
    const newest = new Map();
    for (const c of kids) if (!newest.has(c.node) || newest.get(c.node).generation < c.generation) newest.set(c.node, c);
    for (const c of newest.values()) {
      const k = keyOf(c.node, c.generation); if (seen.has(k)) continue;
      seen.add(k); out.push({ node: c.node, generation: c.generation, runId: c.runId }); walk(c);
    }
  };
  walk({ node: n.node, generation: n.generation });
  return out.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation));
}

/**
 * C2a (gate page sections 4 and 7): the PER-CANDIDATE loader. The slots of ONE children frontier (the new parent's verified split, in its order, each with its new side and the supplier paths it expects) and EVERY candidate, each loaded against its OWN proposing parent
 * (the frontier it was registered under: the old parent is per candidate, not one for the whole set), with its eligibility and wholeness handed in (A's predicates, both required, no default), its supplier pins as run-level pins, and the ambiguous keys of the new parent's whole chain.
 *   candidateKeys  ['<node>@g<n>', ...]  the held / kept nodes A's `candidatesOf` lists
 * -> { slots, candidates, ambiguousKeys } ready for comparePairs / assignSlots (src/tree-reuse.js). Reads files; writes nothing.
 */
export function loadSlotsAndCandidates({ rootDir, work, rootTaskPath, newParent, slotGeneration, candidateKeys, eligibility, wholeBranch }) {
  if (typeof eligibility !== 'function') throw new TypeError('loadSlotsAndCandidates: `eligibility` (A\'s per-node held-eligible predicate) is required: this file keeps no list of its own');
  if (typeof wholeBranch !== 'function') throw new TypeError('loadSlotsAndCandidates: `wholeBranch` (A\'s whole-branch predicate) is required: without it a branch with a missing piece could be adopted as a unit');
  const record = readTreeRecord(rootDir); const state = stateOf(record); const runsDir = dirname(rootDir);
  const newNode = state.nodes.get(keyOf(newParent.node, newParent.generation));
  if (!newNode) throw new TypeError(`loadSlotsAndCandidates: ${keyOf(newParent.node, newParent.generation)} is not in the record`);
  const newBlock = readPlanOf(runsDir, newNode).block;
  const slots = (newBlock?.children ?? []).map((c, position) => {
    const node = childNode(newParent.node, c.milestone);
    let newSide = null; let newProblem = null;
    try { const args = loadDerivation({ rootDir, parentRef: newParent, childId: c.id, generation: slotGeneration, rootTaskPath, work, preview: true }); newSide = sideOf({ args, derived: deriveChild(args) }); } catch (e) { newProblem = words(e); }
    return { node, generation: slotGeneration, position, newSide, newProblem, expects: newSide?.expects ?? [] };
  });
  const candidates = candidateKeys.map(key => {
    const n = state.nodes.get(key);
    const base = { key, node: n?.node ?? key.replace(/@g\d+$/, ''), generation: n?.generation ?? Number(/@g(\d+)$/.exec(key)?.[1] ?? 0), runId: n?.runId ?? null, oldSide: null, oldProblem: null, dependsOn: undefined };
    const el = eligibility(key) ?? { eligible: false, why: 'the eligibility predicate gave no answer' };
    const verdict = { eligible: el.eligible === true, ineligibleWhy: el.eligible === true ? null : (el.why ?? 'the earlier node is not eligible for reuse'), wholeBranch: wholeBranch(key) === true };
    if (!n) return { ...base, ...verdict, oldProblem: `${key} is not registered in this tree` };
    const f = state.frontiers.get(n.frontierKey);
    if (!f || typeof f.parentNode !== 'string' || typeof f.parentGeneration !== 'number') return { ...base, ...verdict, oldProblem: `${key} has no proposing frontier on record` };
    const ver = verifyOldChild({ rootDir, work, rootTaskPath, oldParent: { node: f.parentNode, generation: f.parentGeneration }, node: n.node, generation: n.generation });
    const reg = record.events.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation);
    const { pins, problem } = pinsOf({ registeredDependsOn: reg?.dependsOn, state, runsDir });
    // the nodes of this candidate's own branch as run-level pins: a consumer planned against this node pinned the provider AND its subtree (tree-derive.js dependsOn), so the slot rule counts them as filled when this candidate is the occupant (BUG-B-002)
    const branchPins = branchPinsOf(state, n);
    return { ...base, ...verdict, oldSide: ver.side, oldProblem: ver.problem ?? problem, dependsOn: pins, branchPins };
  });
  return { slots, candidates, ambiguousKeys: ambiguousKeysOfChain({ rootDir, newParent }) };
}

/** `newRootKeys` = every { originNode, originClass, textSha256 } the NEW ROOT's own list makes (the keys deriveChild gives a root item's identity: a test checks they equal sideOf's). `newRootAmbiguousKeys` = those that repeat. The pure part of the latter: items [{ id, form }] and `classOf(id)` -> the keys that repeat. A root item's identity is made by deriveChild as { originNode: 'R', originClass, textSha256: sha256 of the one-line text }. */
export function ambiguousKeysOfItems({ items, classOf, originNode = 'R' }) {
  return duplicateKeysOf(items.map(i => ({ originNode, originClass: classOf(i.id) ?? null, textSha256: sha256Of(oneLine(itemText(i.form))) })));
}

/** The keys one plan's OWN criteria make (deriveChild gives a fresh item the identity { originNode: <that plan's node>, originClass, textSha256 }, tree-derive.js: `fresh: true`): `newParent` is any { node, generation } in the record, the root or not. */
export function newParentKeys({ rootDir, newParent }) {
  const state = stateOf(readTreeRecord(rootDir));
  const n = state.nodes.get(keyOf(newParent.node, newParent.generation));
  if (!n) throw new TypeError(`newParentKeys: ${keyOf(newParent.node, newParent.generation)} is not in the record`);
  const plan = readPlanOf(dirname(rootDir), n);
  const items = formsOfReport(plan.report).map((form, i) => ({ id: `C${i + 1}`, form }));
  const classOf = id => plan.block?.classes?.find(c => c.id === id)?.class ?? null;
  return items.map(i => ({ originNode: newParent.node, originClass: classOf(i.id) ?? null, textSha256: sha256Of(oneLine(itemText(i.form))) }));
}
/** The root's own keys (C1's name, kept): the same read with the root as the parent. */
export function newRootKeys({ rootDir, newParent }) { return newParentKeys({ rootDir, newParent }); }

/** `parent` and its ancestors up to the root, nearest first: each node's frontier names its parent (node and generation). A node the record does not hold, or one with no frontier, ends the chain. */
export function ancestorChainOf(state, parent) {
  const chain = []; let cur = { node: parent.node, generation: parent.generation };
  for (let guard = 0; cur && guard < 64; guard += 1) {
    chain.push(cur);
    if (cur.node === 'R') break;                       // the root has no tree parent (a root re-plan's frontier names none either), so the walk never reaches a superseded root generation
    const n = state.nodes.get(keyOf(cur.node, cur.generation));
    const f = n ? state.frontiers.get(n.frontierKey) : null;
    cur = f && typeof f.parentNode === 'string' && typeof f.parentGeneration === 'number' ? { node: f.parentNode, generation: f.parentGeneration } : null;
  }
  return chain;
}
/** The pure part: each plan's keys on its own (a key carries its plan's node as originNode, so lists of different plans never collide) -> the keys that repeat inside ONE list. */
export function ambiguousKeysOfLists(lists) { return [...new Set(lists.flatMap(keys => duplicateKeysOf(keys)))].sort(); }
export function ambiguousKeysOfChain({ rootDir, newParent }) {
  const state = stateOf(readTreeRecord(rootDir));
  return ambiguousKeysOfLists(ancestorChainOf(state, newParent).map(a => newParentKeys({ rootDir, newParent: a })));
}

/** The root-level name of the same check (C1's), kept; for a deeper split use `ambiguousKeysOfChain`, which also covers every ancestor's list (for the root the two are the same). */
export function newRootAmbiguousKeys({ rootDir, newParent }) { return ambiguousKeysOfChain({ rootDir, newParent }); }
