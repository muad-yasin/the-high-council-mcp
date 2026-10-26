// 0.8.3 M7 apply, C2b-2 (plan Review/Build_0.8.3/m7/C2b2_Plan_DRAFT_2026-10-18.md): the one place that turns the pure comparison (src/tree-reuse.js) and its loader (src/tree-reuse-load.js) into the `reused` entries of a frontier's preview.
// `reusePlanFor` READS (the record, the plan and run files) and writes nothing; describeFrontier (src/tree-frontier.js) puts each entry on the preview child of its slot, inside `boundSha256`, so the person approves exactly the adopted set. WHOLE adoptions only (outcome 'whole'): a
// candidate adopted AS ITSELF (its branch not whole) is C2b-3's; it stays kept and its slot gets a new run (a rerun, never a hole).
import { candidatesOf, endedNeedsDecision } from './tree-transitions.js';
import { comparePairs, assignSlots } from './tree-reuse.js';
import { loadSlotsAndCandidates } from './tree-reuse-load.js';

const depthOf = path => String(path).split('/').length - 1;
const parentOf = path => String(path).replace(/\/[^/]+$/, '');

/**
 * A pair whose candidate sits at another LEVEL than the slot, or under another PARENT at the same level, is refused at PAIRING, before the person is asked (a frontier that is approved must be buildable): its 'same' row becomes a 'changed' row naming both paths. Mutates and returns the Map. Pure.
 * Why the same parent too: the comparison derives the candidate against ITS OWN proposing parent and the slot against the new one, and nothing in the place model has been walked for an adopted branch that changes parent (R/M2/X into R/M1/B); a refusal is a rerun, never a hole.
 * Why same level only: the place model (C2b-1b) rewrites only the prefix of a path, so a move across levels would put the adopted branch deeper or shallower than its own depth accounting.
 */
export function refuseCrossLevel(pairs) {
  for (const [k, row] of pairs) {
    if (row.verdict !== 'same' || !row.adopts) continue;
    if (depthOf(row.node) === depthOf(row.adopts.node) && parentOf(row.node) !== parentOf(row.adopts.node)) { pairs.set(k, { ...row, verdict: 'changed', field: 'parent', reason: `changed: ${row.adopts.node} sits under ${parentOf(row.adopts.node)} and the slot ${row.node} under ${parentOf(row.node)}; a finished run is reused only for a slot under its own parent`, adopts: undefined, identityMap: undefined, selfRow: undefined }); continue; }       // B-DRAFT (C2b-2, cross-parent)
    if (depthOf(row.node) !== depthOf(row.adopts.node)) pairs.set(k, { ...row, verdict: 'changed', field: 'depth', reason: `changed: ${row.adopts.node} sits at level ${depthOf(row.adopts.node)} and the slot ${row.node} at level ${depthOf(row.node)}; a finished run is reused only for a slot at its own level`, adopts: undefined, identityMap: undefined, selfRow: undefined });       // B-DRAFT (C2b-2)
  }
  return pairs;
}

/**
 * K6 wholeness (the plan's "wholeness" predicate): a candidate's branch is whole when it is itself a finished, passed node that did not end needs_decision and every node its verified split names is registered below it as a node that is whole in turn. A node whose verified split is
 * unknown (a record from before the field) is not whole. A node with NO split is a leaf and is whole. -> boolean. Pure.
 */
export function wholeBranchOf(state, key) {
  const n = state.nodes.get(key);
  if (!n || n.phase !== 'closed' || n.outcome !== 'passed' || endedNeedsDecision(state, n)) return false;
  if (state.stale?.has(key)) return false;                                            // a stop put it in question: it is being decided, not finished work
  const names = n.verifiedSplit ? n.verifiedSplit.children : [];       // no verified split: a leaf. A split verified before the record listed its children (children: null, tree-transitions.js:243): unknown, so not whole
  if (names === null) return false;
  return names.every(path => {
    const kids = [...state.nodes.values()].filter(c => c.node === path && state.frontiers.get(c.frontierKey)?.parentNode === n.node && state.frontiers.get(c.frontierKey)?.parentGeneration === n.generation);
    // The LIVE child is judged inside ITS OWN LINEAGE: the kids of THIS parent node@generation, newest first (a child planned again in place leaves its older generation behind; a finished older one must not make the branch whole while the newer one failed). The path-wide
    // liveness predicate would count the new plan's node on the same path against this branch's child, which is not the branch's replacement. `kids` is a fresh array: the sort touches no state.
    const live = kids.sort((a, b) => b.generation - a.generation)[0];
    if (live === undefined) return false;
    if ((state.maxOpened?.get(path) ?? 0) > live.generation) return false;           // a newer generation of the child was OPENED and is not registered yet: the branch is being planned again (the opened number is keyed by path and cannot say whose lineage it is, so it errs towards a rerun, never a hole)
    return wholeBranchOf(state, `${live.node}@g${live.generation}`);
  });
}

/**
 * The reused slots of ONE children frontier. `slotsWanted`: [{ node, generation }] - the children still to be decided (not registered, not stale, not closed unstarted) with the generation each one will register at. Those generations can differ (a sub-plan regenerate of one child
 * puts its slot one generation above its siblings: childGenerationOf), and the loader derives slots at ONE generation, so it is called once per distinct generation and the slots of every call are compared and assigned TOGETHER: finished work is never re-planned because its sibling's number differs.
 * -> { reused: Map(slot path -> the K8 `reused` entry), fates, slotFates }. Empty (and nothing read) when the tree holds no candidate, so a tree that never re-planned is untouched.
 * A pair whose candidate sits at another LEVEL than the slot is refused HERE, at pairing, before the person is asked (a frontier that is approved must be buildable): the pair becomes a 'changed' row naming both paths.
 */
export function reusePlanFor({ rootDir, work, rootTaskPath, state, parent, slotsWanted, deny = null }) {       // `deny` (R16): describeFrontier's, passed to every derivation the comparison loads
  const candidates = candidatesOf(state).filter(c => c.state !== 'set_aside' && c.eligible === true);
  if (!candidates.length || !slotsWanted.length) return { reused: new Map(), fates: [], slotFates: [] };
  const newParent = { node: parent.node, generation: parent.generation };
  const generations = [...new Set(slotsWanted.map(s => s.generation))].sort((a, b) => a - b);
  let loaded = null; const slots = [];
  for (const generation of generations) {
    const got = loadSlotsAndCandidates({ rootDir, work, rootTaskPath, newParent, slotGeneration: generation, candidateKeys: candidates.map(c => c.key), eligibility: () => ({ eligible: true }), wholeBranch: key => wholeBranchOf(state, key), deny });
    loaded ??= got;       // the candidates and the ambiguous keys do not depend on the slot generation
    slots.push(...got.slots.filter(sl => slotsWanted.some(w => w.node === sl.node && w.generation === generation)));
  }
  slots.sort((a, b) => a.position - b.position);
  const pairs = comparePairs({ slots, candidates: loaded.candidates, ambiguousKeys: loaded.ambiguousKeys });
  refuseCrossLevel(pairs);
  const res = assignSlots({ slots, candidates: loaded.candidates, pairs, adoptSelf: false });      // an as-itself adoption is C2b-3's and is dropped: it must not bind, or it would stand as the supplier of a consumer that is reused against it (BUG-B-003)
  const reused = new Map();
  for (const b of res.bindings) {
    if (b.outcome !== 'whole') continue;                 // outcome (b), adopted as itself, is C2b-3's
    const slotPath = b.slot.replace(/@g\d+$/, '');
    reused.set(slotPath, { adoptsNode: b.row.adopts.node, adoptsGeneration: b.row.adopts.generation, runId: b.row.adopts.runId, fieldsSha256: b.row.fieldsSha256, identityMap: b.row.identityMap ?? [] });
  }
  return { reused, fates: res.fates, slotFates: res.slotFates };
}
