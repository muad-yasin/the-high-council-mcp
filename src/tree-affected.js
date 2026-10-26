// The set of nodes a stop puts in question (0.8.3 M5e slice 1; PLAN 8.4 "Who is affected", Astra N5), built from the RECORD: PURE of side effects (it reads the record and the plan files of closed nodes, writes nothing).
//   - the nodes are the CURRENT generation of every logical node the record knows, plus the children every verified split names that are not registered yet (given with dependsOn []);
//   - a registered node's dependsOn comes from its `node_registered` event, where each entry is { node, generation, thinContractSha256 } (src/tree-derive.js): the PATH is what the closure compares. The fold's node objects
//     carry no dependsOn, so nothing here reads them (M5d-4 obligation, C&C (c));
//   - the edges are blockEdges over every closed node's verified split block;
//   - a closed node that holds a verified split whose plan no longer reads makes the graph unreadable: every sibling of the stopped node is then treated as affected rather than assumed independent (PLAN 8.4);
//   - the closure itself is src/tree-deps.js affectedSet (unchanged): consumers of the node and of every ancestor of it, dependsOn, and everything below a node in the set;
//   - the ROOT ending needs_decision is pinned to {R} (C&C Q1, PLAN 290: the plan stands unchanged, the children keep running).
// The result lists { node, generation }: the generation is the node's newest registered or OPENED one, or the generation the next frontier registers a not-yet-registered path at (generationOf; the stale marks and decision_recorded.affected key on `node@gN`).
import { join } from 'node:path';
import { affectedSet, blockEdges } from './tree-deps.js';
import { childNode, nodeKey } from './tree-identity.js';
import { readPlanOf } from './tree-derive-load.js';
import { generationOf, liveNodesOf, orphansOf, placeOf } from './tree-transitions.js';


/** The dependency graph of the tree: { nodes: [{ node, dependsOn: [path] }], edges, readable, latest } from the record and the plans of its closed nodes. */
export function treeGraph({ record, state, runsDir }) {
  // ORPHANS (dead with a replaced parent, src/tree-transitions.js orphansOf) are not part of the graph. For each path the block is the NEWEST CLOSED generation's: g1 while g2 is still open, g2 once it closes
  // (a replaced node keeps proposing its children until its replacement is settled; after that only the new split counts).
  const orphans = orphansOf(state);
  const live = [...state.nodes.values()].filter(n => !orphans.has(nodeKey(n.node, n.generation)));
  // C2b-1b: the graph is keyed by PLACE (the plan in force: an adopted node fills the slot it was adopted into, a node below it sits under that slot), so an adopted node and the new node of its old path are two vertices. With nothing adopted a place is the path.
  const place = n => placeOf(state, n);
  const latest = new Map(liveNodesOf(state, live).map(n => [place(n), n]));
  const newestClosed = new Map();
  for (const n of live) if (n.phase === 'closed' && (!newestClosed.has(place(n)) || newestClosed.get(place(n)).generation < n.generation)) newestClosed.set(place(n), n);
  const registeredEvent = n => record.events.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation);
  const verified = new Set(record.events.filter(e => e.event === 'split_verified').map(e => nodeKey(e.node, e.generation)));
  const edgeMap = new Map(); const known = new Set(latest.keys()); let readable = true;
  for (const n of newestClosed.values()) {
    const block = readPlanOf(runsDir, n).block;
    if (!block) { if (verified.has(nodeKey(n.node, n.generation))) readable = false; continue; }
    const { edges, unreadable } = blockEdges(place(n), block);
    if (unreadable.length) readable = false;
    for (const e of edges) edgeMap.set(`${e.provider}>${e.consumer}`, e);
    for (const c of block.children ?? []) known.add(childNode(place(n), c.milestone));
  }
  const nodes = [...known].map(p => {
    const n = latest.get(p);
    const reg = n ? registeredEvent(n) : null;
    const placeOfPin = d => { if (typeof d === 'string') return d; const m = d?.node ? state.nodes.get(nodeKey(d.node, d.generation)) : null; return m ? place(m) : d?.node; };       // a pin names a node (path, generation): its place
    return { node: p, dependsOn: [...new Set((reg?.dependsOn ?? []).map(placeOfPin).filter(Boolean))] };
  });
  return { nodes, edges: [...edgeMap.values()], readable, latest };
}

/**
 * -> { affected: [{ node, generation }] in path order, why: Map path -> the first reason it was added, rootAffected, graphReadable }. `obligationCarriers` (node paths) join the set and are closed the same way (S4).
 */
export function affectedFor(args) {
  const own = affectedOf(args);
  // Option 4 (RegenSlot_Addendum2 section 10-11): a stop on a node INSIDE an adopted branch is a stop on the branch's SLOT. The decision plans the whole slot again, so it lists the closure as if the adopted ROOT had stopped (D@g1 -> [A@g1, D@g1, C@g2]); the nodes pinned to the root lose their provider otherwise, unlisted and unstale. A node outside any adopted branch is untouched.
  const { state, node, generation } = args; if (!state || args.seedless || (args.obligationCarriers ?? []).length) return own;
  const at = generation ?? [...state.nodes.values()].filter(n => n.node === node).map(n => n.generation).sort((a, b) => b - a)[0];
  const rootKey = at === undefined ? undefined : state.adoptedBelow?.get(nodeKey(node, at));
  const m = rootKey === undefined ? null : /^(.*)@g(\d+)$/.exec(rootKey);
  if (!m) return own;
  const root = affectedOf({ ...args, node: m[1], generation: Number(m[2]) });
  const byKey = new Map([...own.affected, ...root.affected].map(a => [nodeKey(a.node, a.generation), a]));
  return { ...own, affected: [...byKey.values()].sort((x, y) => (x.node < y.node ? -1 : x.node > y.node ? 1 : x.generation - y.generation)), why: new Map([...root.why, ...own.why]), rootAffected: own.rootAffected || root.rootAffected };
}
function affectedOf({ record, state, runsDir, node, generation = null, obligationCarriers = [], seedless = false }) {
  const graph = treeGraph({ record, state, runsDir });
  // C2b-ob: a carrier is a path (as before) or a node { node, generation }; either becomes its PLACE for the closure
  const carrierPlace = c => (typeof c === 'string' ? c : placeOf(state, state.nodes.get(nodeKey(c.node, c.generation)) ?? c));
  const carriers = obligationCarriers.map(carrierPlace);
  // C2b-1b: the closure runs over PLACES. The stopped node is given by path (the newest live node of that path) or, when the caller has it, by (path, generation): the adopted node and the new node of its old path are different stops. The result lists REAL nodes: an adopted node is { its path, its generation }, never its place.
  const stoppedAt = (() => {
    const exact = generation === null ? null : state.nodes.get(nodeKey(node, generation));
    const newest = [...graph.latest.values()].filter(n => n.node === node).sort((a, b) => b.generation - a.generation)[0];
    const m = exact ?? newest;
    return m ? placeOf(state, m) : node;
  })();
  const adoptedish = o => state.adopted?.has(nodeKey(o.node, o.generation)) || state.adoptedBelow?.has(nodeKey(o.node, o.generation));
  const gen = p => generationOf(state, p);                                     // one rule with the frontier's preview (R13): a not-yet-registered path is marked at the generation it will register at
  const listed = p => { const o = graph.latest.get(p); return o && adoptedish(o) ? { node: o.node, generation: o.generation } : { node: p, generation: gen(p) }; };
  // `seedless` (an obligation decision): the closure starts from the CARRIERS only. Seeding with the stopped node would drag in everything below it (the root: the whole tree), which the obligation does not reach.
  if (seedless && carriers.length) {
    const [first, ...rest] = carriers;
    const res = affectedSet({ stopped: first, nodes: graph.nodes, edges: graph.edges, obligationCarriers: rest, graphReadable: graph.readable });
    return { affected: [...res.affected].sort().map(listed), why: res.why, rootAffected: res.rootAffected, graphReadable: graph.readable };
  }
  if (node === 'R' && !carriers.length) return { affected: [{ node: 'R', generation: gen('R') }], why: new Map([['R', 'the node that stopped']]), rootAffected: false, graphReadable: graph.readable };
  const res = affectedSet({ stopped: stoppedAt, nodes: graph.nodes, edges: graph.edges, obligationCarriers: carriers, graphReadable: graph.readable });
  return { affected: [...res.affected].sort().map(listed), why: res.why, rootAffected: res.rootAffected, graphReadable: graph.readable };
}
