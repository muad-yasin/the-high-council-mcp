// The WHAT-IF size check of a sub-plan regenerate (0.8.3 SG-1 unit; C&C thcmcp-cd 23 Okt 2026: "refuse at `decide`, in the same shape as the root route, for BOTH the terminal and the MCP session route"; design note Review/Build_0.8.3/m8/C_SG1_Oversize_Design_2026-10-23.md).
// A sub-plan's input was only measured when its replacement REGISTERED (tree-loop.js: loadDerivation + deriveChild, then the size against the tree's allowance), so a person could approve a decision and then a frontier only to see the new child stop with a bundle_input
// finding. This module answers the same question BEFORE the person approves: it folds the record a decision WOULD leave, derives the new plan's input exactly as registration does, and returns its size. The comparison with the allowance (bundleAllowanceBytesOf) and the
// sentences are the caller's (src/tree-decide-stop.js).
//   newPlanInputBytes({ rootDir, record, runsDir, work, decisionArgs })
//     -> { ok: true, byNode: Map('R/M1' -> bytes), skipped: [{ node, why }] }   the size of the input of the new generation of every topmost node the decision opens that could be derived, WITHOUT the earlier plan (offered as data it adds its own bytes: src/old-plan.js); a node that could not be derived is NAMED in `skipped`
//      | { ok: false, why }                           the what-if could not be built at all (no task folder, the decision does not fold): the caller SAYS so and registration stays the backstop
// THE SYNTHETIC EVENTS COME FROM THE REAL BUILDERS, not from literals: the decision event from regenerateDecisionEvent (src/tree-decision-event.js, the function the apply in src/tree-decide-stop.js writes it with; the gate fields are placeholders, the derivation never reads them) and the generation_opened
// from openingOf (src/tree-recovery.js, the function recovery writes it with). Only the two ids are placeholders in the sense that nothing is appended: they are the next two ids the real events would get. Nothing is written anywhere.
import { deadKeys, foldRecord } from './tree-transitions.js';
import { openingOf } from './tree-recovery.js';
import { regenerateDecisionEvent } from './tree-decision-event.js';
import { ChainUnavailable, NotExpandable, loadDerivation, readPlanOf } from './tree-derive-load.js';
import { DeriveRefusal, deriveChild } from './tree-derive.js';
import { childNode } from './tree-identity.js';
import { bundleInputBytes } from './tree-budget.js';
import { rootTaskPathOf } from './tree-frontier.js';

// What the screen says when the size could not be checked: a FIXED phrase per class, never the raw message (it can carry local paths, and the screen's text is hashed and shown to an MCP agent).
export const WHY = Object.freeze({
  noWork: 'the task folder is not known here',
  changed: 'the plan it grows from is missing or has changed',      // readNodePlan gives the same null plan for a deliverable that is gone and for a body whose hash is not the accepted one: ONE phrase that is true for both
  missing: 'a piece it is built from is not there',
  unreadable: 'a file it needs could not be read',
  chain: 'the chain file it needs is missing or has changed',
  unfolded: 'the decision could not be placed in the record',
  opensNothing: 'the decision opens no new plan',
});
const idNo = id => Number(String(id).replace(/\D/g, '')) || 0;

export function newPlanInputBytes({ rootDir, record, runsDir, work, decisionArgs }) {
  if (typeof work !== 'string') return { ok: false, why: WHY.noWork };
  let opening; let hypothetical; let state;
  try {
    const last = record.events.at(-1);
    const decId = `e${idNo(last?.id) + 1}`; const genId = `e${idNo(last?.id) + 2}`; const at = last?.at;
    // the decision exactly as the apply would write it, with the earlier plan left out (its bytes are added by the caller, which knows whether the person keeps it)
    const decision = { schema: 'tree-events/1', ...regenerateDecisionEvent(decisionArgs, { oldPlan: { form: 'fresh' } }), id: decId, at };
    const afterDecision = foldRecord([...record.events, decision]);
    const d = afterDecision.decisions.get(decId);
    if (!d) return { ok: false, why: WHY.unfolded };
    opening = openingOf(afterDecision)([decId, d]);
    hypothetical = { ...record, events: [...record.events, decision, { schema: 'tree-events/1', ...opening.event, id: genId, at }] };
    state = foldRecord(hypothetical.events);
  } catch (e) { return failOpen(e); }
  // openingOf always returns an event (never null), but a decision whose `affected` list is empty opens no node: measuring nothing must SAY so, not read as "nothing is over the allowance". No real verb lists nothing (a regenerate lists at least the stopped node), so only a hand-made decisionArgs reaches this line (test O6).
  if (!opening.event.nodes.length) return { ok: false, why: WHY.opensNothing };
  const dead = deadKeys(state);
  const byNode = new Map(); const skipped = [];
  for (const target of opening.event.nodes) {
    // ONE node at a time: a node that cannot be derived (a never-registered consumer whose provider has no new plan yet, a changed file) is named as skipped and must not hide the others
    try {
      // the parent as registration finds it: the node it replaces, if registered, was registered under a frontier of the parent; a node never registered (a consumer waiting for a provider) is registered under the newest live generation of its parent path
      const previous = [...state.nodes.values()].filter(n => n.node === target.node && n.generation < target.generation).sort((a, b) => b.generation - a.generation)[0];
      const viaFrontier = previous ? state.frontiers.get(previous.frontierKey) : null;
      const parentPath = target.node.slice(0, target.node.lastIndexOf('/'));
      const parentGeneration = typeof viaFrontier?.parentGeneration === 'number' && viaFrontier.parentNode === parentPath ? viaFrontier.parentGeneration
        : [...state.nodes.values()].filter(n => n.node === parentPath && !dead.has(`${n.node}@g${n.generation}`)).map(n => n.generation).sort((a, b) => b - a)[0];
      const parent = typeof parentGeneration === 'number' ? state.nodes.get(`${parentPath}@g${parentGeneration}`) : null;
      const entry = parent ? readPlanOf(runsDir, parent).block?.children?.find(c => childNode(parentPath, c.milestone) === target.node) : null;
      if (!entry) { skipped.push({ node: target.node, why: parent ? WHY.changed : WHY.missing }); continue; }
      const args = loadDerivation({ rootDir, parentRef: { node: parentPath, generation: parentGeneration }, childId: entry.id, generation: target.generation, rootTaskPath: rootTaskPathOf(rootDir, work), work, record: hypothetical });
      byNode.set(target.node, bundleInputBytes(deriveChild(args).files));
    } catch (e) { const f = failOpen(e); skipped.push({ node: target.node, why: f.why }); }
  }
  return { ok: true, byNode, skipped };
}
/** deliberately fail-open and loud, but ONLY for the classes registration also meets (tree-loop.js): a parent file that changed or a piece that is missing (NotExpandable, DeriveRefusal), a chain file that is gone or changed (ChainUnavailable) and a file that cannot be read now. This is a UX pre-check whose authoritative twin is the registration check; it must
 *  not make `decide` unusable, but the caller says that the size was NOT checked. Anything else (a defect in this very code) is thrown, not turned into a permanent silent skip. */
function failOpen(e) {
  if (e instanceof NotExpandable) return { ok: false, why: e.drift ? WHY.changed : WHY.missing };
  if (e instanceof DeriveRefusal) return { ok: false, why: WHY.missing };
  if (e instanceof ChainUnavailable) return { ok: false, why: WHY.chain };       // the chain file the tree registered is gone or edited (a package update, a project copy): registration throws the same error at the sitting
  if (['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR'].includes(e?.code)) return { ok: false, why: WHY.unreadable };
  throw e;
}
