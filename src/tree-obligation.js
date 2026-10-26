// Obligations by IDENTITY (0.8.3 M5e slice 4; PLAN 4.4, 8.4). A positional id (`C1`) means a different obligation in every node's list, so `council tree decide --obligation <node>@g<n>:<id>` is resolved here to the obligation's
// ORIGIN (originNode, originGeneration, originId) - the identity every copy of it carries down the tree (src/tree-identity.js obligationIdentity) - and the CARRIERS are found by that origin, never by position:
//   - a registered node carries it when an item of its `node_registered.obligations.items` OR an entry of its `context` (guard-refused, check_not_enforced, context-only) has that origin;
//   - an item with NO identity is the node's own refinement: its origin is that node (the identity is made at its own split, src/tree-derive.js);
//   - the origin node itself carries it (the root does, for what it originated: PLAN 8.4 "reaches the root only when the root carries it").
// The root has no obligation map: its list is its acceptance list (report.json criteria, ids C1..Cn) and its classes are the verified block's.
import { join } from 'node:path';
import { formsOfReport, readPlanOf } from './tree-derive-load.js';
import { liveNodesOf } from './tree-transitions.js';

const QUALIFIED = /^(R(?:\/[A-Za-z][A-Za-z0-9_-]*)*)@g([1-9][0-9]*):([A-Za-z0-9_.-]{1,64})$/;
const sameOrigin = (identity, o) => !!identity && identity.originNode === o.node && identity.originGeneration === o.generation && identity.originId === o.id;
const registeredEvent = (record, n) => record.events.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation);

/** -> { origin: { node, generation, id }, cls, label } | { refusal }. `label` is the canonical origin written as `<node>@g<n>:<id>`. */
export function resolveObligation({ record, state, runsDir, arg }) {
  const m = QUALIFIED.exec(String(arg));
  if (!m) return { refusal: `--obligation ${arg}: write it as <node>@g<n>:<id> (for example R/M2@g1:C2)` };
  const n = state.nodes.get(`${m[1]}@g${m[2]}`);
  if (!n) return { refusal: `--obligation ${arg}: ${m[1]}@g${m[2]} is not in this tree` };
  const id = m[3];
  if (n.node === 'R') {
    const plan = readPlanOf(runsDir, n);
    const ids = formsOfReport(plan.report).map((_, i) => `C${i + 1}`);
    if (!ids.includes(id)) return { refusal: `--obligation ${arg}: the root's acceptance list holds ${ids.join(', ') || 'nothing'}, not ${id}` };
    const cls = plan.block?.classes?.find(c => c.id === id)?.class ?? null;
    return { origin: { node: 'R', generation: n.generation, id }, cls, label: `R@g${n.generation}:${id}` };
  }
  const item = (registeredEvent(record, n)?.obligations?.items ?? []).find(i => i.id === id);
  if (!item) return { refusal: `--obligation ${arg}: ${n.node}@g${n.generation} carries no obligation ${id}` };
  const origin = item.identity ? { node: item.identity.originNode, generation: item.identity.originGeneration, id: item.identity.originId } : { node: n.node, generation: n.generation, id };
  const cls = item.identity?.originClass ?? null;
  return { origin, cls, label: `${origin.node}@g${origin.generation}:${origin.id}` };
}

/**
 * C2b-ob (records; Review/Build_0.8.3/m7/CarriersOf_Note_2026-10-18.md): the NODES that carry the obligation of this origin, as [{ node, generation }] sorted by node then generation: the live node of each path (the newest) PLUS the adopted ones (a node reused from an earlier plan sits beside
 * the new node of its path, and it is the one that may carry the rule), the origin node included when it is in the tree (its newest). With nothing adopted it is exactly one node per path, as before.
 */
export function carrierNodesOf({ record, state, origin }) {
  const live = liveNodesOf(state);
  const out = new Map();
  const add = n => out.set(`${n.node}@g${n.generation}`, { node: n.node, generation: n.generation });
  const onPath = live.filter(n => n.node === origin.node);
  const originNode = onPath.find(n => n.generation === origin.generation) ?? onPath.sort((a, b) => b.generation - a.generation)[0];       // the origin names a generation (an item with no identity is its node's own refinement): that very node when it is live, else the newest of the path
  if (originNode) add(originNode);
  for (const n of live) {
    const map = registeredEvent(record, n)?.obligations;
    if (!map) continue;
    if ((map.items ?? []).some(i => sameOrigin(i.identity, origin)) || (map.context ?? []).some(c => sameOrigin(c.identity, origin))) add(n);
  }
  return [...out.values()].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation));
}

/** The node PATHS that carry the obligation of this origin (the same nodes as `carrierNodesOf`, one entry per path), the origin node included when it is in the tree. */
export function carriersOf(args) { return [...new Set(carrierNodesOf(args).map(c => c.node))].sort(); }
