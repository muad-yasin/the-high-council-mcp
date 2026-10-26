// What the sitting's end text tells a person beyond "what started" (0.8.3 M5e slice 6; PLAN 8.4, 8.2; item 6). READS the record and the run folders, writes nothing, calls no model. The words are tree-stop.js's renderers (pure); this
// module only gathers the facts they print:
//   - the needs_decision stop a sitting just opened (renderNeedsDecisionStop): the node's own words ("What this is"), the agreements it provides and expects, the affected set with the reason each node is in it, the spend and the share
//     given back, the work that can still run;
//   - a registered child that has NOT started and the grant it holds;
//   - a frontier closed under a changed parent;
//   - a guard refusal of a node that was derived and never registered ("derived, not admitted").
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readTreeRecord, stateOf } from './tree-record.js';
import { readPlanOf } from './tree-derive-load.js';
import { childNode, nodeKey } from './tree-identity.js';
import { affectedFor, treeGraph } from './tree-affected.js';
import { gateTree, memberSpentUsd } from './tree-budget.js';
import { renderBundleInputStop, renderClosedUnstartedStop, renderNeedsDecisionStop } from './tree-stop.js';
import { milestoneKeysOf, openMilestones, rootRemedies } from './tree-decide-stop.js';
import { deadKeys, isSupersededGeneration, keepRefusal, orphansOf, placeOf } from './tree-transitions.js';

const handoffText = runDir => {
  try { const m = /^## What this is\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readFileSync(join(runDir, 'HANDOFF.md'), 'utf8')); return m ? m[1].trim() : null; } catch { return null; }
};

/** The facts every sitting end text may need. */
export function sittingFacts(rootDir) {
  const record = readTreeRecord(rootDir);
  if (record.corrupt.length || !record.tree) return {};
  const state = stateOf(record);
  const dead = deadKeys(state);       // a DEAD registered node can never start and holds no money (SLOT FIX, C&C 23 Okt 2026): the sentences built on this list ("holds a grant", "start the registered child") would be false for it
  const registeredNotStarted = [...state.nodes.values()].filter(n => n.phase === 'registered' && n.node !== 'R' && !dead.has(`${n.node}@g${n.generation}`)).map(n => ({ node: n.node, generation: n.generation, runId: n.runId, grantUsd: n.grant.amount + n.topUps.reduce((a, t) => a + t.amount, 0) }));
  const parentChanged = [...state.parentBlocks.keys()].filter(k => k).map(frontierKey => ({ frontierKey }));
  const registered = new Set([...state.nodes.values()].map(n => `${n.node}@g${n.generation}`));
  const seen = new Set(); const guardRefusals = [];
  for (const e of record.events) {
    if (e.event !== 'guard_refused' || registered.has(`${e.node}@g${e.generation}`)) continue;
    const k = `${e.node}@g${e.generation}\u0000${e.guard}\u0000${e.item}`;
    if (!seen.has(k)) { seen.add(k); guardRefusals.push({ node: e.node, generation: e.generation, guard: e.guard, item: e.item }); }
  }
  return { registeredNotStarted, parentChanged, guardRefusals };
}

/** The needs_decision stop `stopEvent` (a needs_decision_opened record) as src/tree-stop.js's view, then its text. */
export function needsDecisionStopText(rootDir, stopEvent) {
  const record = readTreeRecord(rootDir); const state = stateOf(record); const runsDir = dirname(rootDir);
  // S5b part B: a stop with NO runId (C&C 12 Oct: the one key) has no run and no handoff to quote and may have no node row: ONE branch, BEFORE the lookup that would answer null. It is a `bundle_input` stop (a child never registered; on the root with
  // `child` naming it) or the blocked stop of a child a person closed before it started (c3b). Any other stop without a runId falls through to the old path, unchanged.
  if (stopEvent.node && stopEvent.runId === undefined) {
    const affectedOf = () => (stopEvent.affected ?? []).map(a => ({ node: a.node, finished: state.nodes.get(`${a.node}@g${a.generation}`)?.phase === 'closed' }));
    if (stopEvent.source === 'bundle_input') {
      const child = stopEvent.child ?? { node: stopEvent.node, generation: stopEvent.generation };
      return renderBundleInputStop({
        stopId: stopEvent.id, node: child.node, generation: child.generation, onRoot: stopEvent.node === 'R' && stopEvent.child !== undefined, parent: stopEvent.parent ?? { node: child.node.slice(0, child.node.lastIndexOf('/')), generation: 1 },
        findings: stopEvent.findings ?? [], carriers: stopEvent.carriers ?? [], rootId: record.tree.treeId, affected: affectedOf(),
        // T-b: the way on that keeps the child, offered only for a PII-only stop on the child itself (a stop recorded on the root for a model-written root plan counts too; not with key-shaped text, which a tree takes no override for)
        allowPii: (() => { const m = state.stopMeta.get(stopEvent.id); return m && !m.otherFindings && (m.piiTypes ?? []).length ? m.piiTypes : null; })(),
      });
    }
    if (stopEvent.source === 'blocked' && state.closedUnstarted.has(`${stopEvent.node}@g${stopEvent.generation}`)) {
      return renderClosedUnstartedStop({ stopId: stopEvent.id, node: stopEvent.node, generation: stopEvent.generation, rootId: record.tree.treeId, affected: affectedOf() });
    }
  }
  const node = state.nodes.get(`${stopEvent.node}@g${stopEvent.generation}`);
  if (!node) return null;
  const closed = record.events.filter(e => e.event === 'node_closed' && e.node === node.node && e.generation === node.generation && e.runId === node.runId).at(-1);
  // C2b-1b: an ADOPTED node is shown against the plan that adopted it (the adopting frontier's parent, the entry of the SLOT it fills); a node below one against the adopted node's own plan; any other node as before (the newest node of its parent's path)
  const ownKey = nodeKey(node.node, node.generation); const adoption = state.adopted?.get(ownKey) ?? null; const lineageParent = adoption || state.adoptedBelow?.has(ownKey);
  const parent = lineageParent
    ? (() => { const f = state.frontiers.get(adoption ? adoption.frontierKey : node.frontierKey); return f ? state.nodes.get(nodeKey(f.parentNode, f.parentGeneration)) ?? null : null; })()
    : node.parentNode ? [...state.nodes.values()].filter(n => n.node === node.parentNode).sort((a, b) => b.generation - a.generation)[0] : null;
  const block = parent ? readPlanOf(runsDir, parent).block : null;
  const entryPath = adoption ? String(adoption.slot).replace(/@g\d+$/, '') : node.node;
  const entry = block?.children?.find(c => childNode(parent.node, c.milestone) === entryPath);
  const pathOf = id => { const c = block.children.find(k => k.id === id); return c ? childNode(parent.node, c.milestone) : id; };
  const agreements = block?.agreements ?? [];
  const provides = entry ? agreements.filter(a => a.from === entry.id).map(a => ({ id: a.id, to: pathOf(a.to), what: a.what })) : [];
  const expects = entry ? agreements.filter(a => a.to === entry.id).map(a => ({ id: a.id, from: pathOf(a.from), what: a.what })) : [];
  const { why } = affectedFor({ record, state, runsDir, node: node.node, generation: node.generation });
  const placeOfEntry = a => { const m = state.nodes.get(nodeKey(a.node, a.generation)); return m ? placeOf(state, m) : a.node; };       // the closure is keyed by PLACE; a recorded entry is a real node
  const affected = (stopEvent.affected ?? []).map(a => ({ node: a.node, why: why.get(placeOfEntry(a)) ?? 'it is in the stop\'s recorded set', finished: state.nodes.get(`${a.node}@g${a.generation}`)?.phase === 'closed' }));
  const inSet = new Set((stopEvent.affected ?? []).map(placeOfEntry));
  // outside this stop's set, not finished, and still able to start: a stale, superseded or orphan node is not "work that can still run"
  const orphans = orphansOf(state);
  const graph = treeGraph({ record, state, runsDir });
  const adoptedish = x => state.adopted?.has(nodeKey(x.node, x.generation)) || state.adoptedBelow?.has(nodeKey(x.node, x.generation));
  // the occupant of a place: an adopted node (or one below it) fills its own place; any other place is read as before, from the newest node of that PATH that is not an adopted one
  const latestOf = p => { const live = graph.latest.get(p); return live && adoptedish(live) ? live : [...state.nodes.values()].filter(x => x.node === p && !adoptedish(x)).sort((a, b) => b.generation - a.generation)[0] ?? null; };
  const independent = graph.nodes.map(n => n.node).filter(p => {
    if (p === 'R' || inSet.has(p) || [...inSet].some(a => p.startsWith(`${a}/`))) return false;
    const n = latestOf(p);
    if (!n) return ![...state.stale].some(k => k.startsWith(`${p}@g`));                  // a child not registered yet: unless a stop put it in question
    return n.phase !== 'closed' && !state.stale.has(`${n.node}@g${n.generation}`) && !orphans.has(`${n.node}@g${n.generation}`) && !isSupersededGeneration(state, n.node, n.generation);
  });
  const rootId = record.tree.treeId;
  const own = stopEvent.id;
  // D2 F7b (A-DRAFT S4): the free KEEP is printed exactly when the table would take it: keepRefusal, the function buildKeep and the table row use, with buildKeep's own milestone reader (so a printed KEEP never refuses)
  const keepRoute = () => (stopEvent.source === 'node_closed' && keepRefusal(state, { stopId: own, node: node.node, generation: node.generation }, { milestonesOf: () => openMilestones(record, state, runsDir).filter(x => x.node === node.node && x.generation === node.generation).map(() => ({ status: 'needs-decision' })) }) === null
    ? [`accept it as it is ($0): council tree decide ${rootId} --keep ${node.node}@g${node.generation}`] : []);
  const routes = stopEvent.source === 'blocked'
    ? [node.node === 'R' ? `answer it with a NEW ROOT plan: council tree decide ${rootId} --stop ${own}` : `regenerate what it affects (a new generation of ${node.node}): council tree decide ${rootId} --stop ${own}`]
    : node.node === 'R'
    ? (() => { const ks = rootRemedies(record, state, runsDir); const plan = `answer it with a NEW ROOT plan: council tree decide ${rootId} --stop ${own}`; return ks.length ? [...ks.map(k => `answer it in place: council tree decide ${rootId} --milestone ${k} --stop ${own}`), plan] : [plan]; })()
    : [`regenerate what it affects: council tree decide ${rootId} --stop ${own}`, ...keepRoute(), ...(stopEvent.source === 'blocked' ? [] : milestoneKeysOf(record, state, runsDir, node.node, node.generation)).map(k => `resolve ${k} in place: council tree decide ${rootId} --milestone ${k} --stop ${own}`), `widen it to one obligation: council tree decide ${rootId} --stop ${own} --obligation <node>@g<n>:<id>`];
  return renderNeedsDecisionStop({
    stopId: stopEvent.id, node: node.node, generation: node.generation, status: 'needs_decision', whatThisIs: handoffText(join(runsDir, node.runId)), acceptedPlan: node.acceptedBy ? { actor: node.acceptedBy.actor, via: node.acceptedBy.via ?? null } : null, provides, expects, affected,
    spentUsd: (() => { try { return memberSpentUsd(record, node, join(runsDir, node.runId)); } catch { return 0; } })(),     // a node a person closed before it ever started has no run folder: nothing was spent
     releasedUsd: closed?.returnedUsd ?? 0, independent, rootAffected: state.sticky.has('root_affected'), routes, rootId, blockedBy: stopEvent.source === 'blocked' ? (stopEvent.blockedBy ?? []) : null,
    // D2 F13j (B3c): the providers whose thin-contract pin this node REGISTERED against (the registration's dependsOn, the pins src/tree-restore.js compares before it closes a provider_pin stop), as `<node>@g<n>`
    pinProviders: stopEvent.source === 'blocked' && (stopEvent.blockedBy ?? []).some(b => b.code === 'provider_pin') ? (node.dependsOn ?? []).filter(d => d && typeof d.node === 'string' && d.thinContractSha256).map(d => `${d.node}@g${d.generation}`) : [],
    person: stopEvent.source === 'person' ? { reason: stopEvent.reason, at: stopEvent.at ?? null } : null,     // S8-8 commit 3: the reason a person typed, shown quoted
    // answer 1: whether the accounting gate would let a person ACCEPT the unreadable report of this node (the usage files beside it give a figure): decides which remedy the screen names
    reportAcceptable: stopEvent.source === 'blocked' && (stopEvent.blockedBy ?? []).some(b => b.code === 'report_unreadable') && gateTree(rootDir, { record }).problems.some(p => p.node === `${node.node}@g${node.generation}` && p.code === 'report_unreadable' && p.keys.length > 0),
  });
}
