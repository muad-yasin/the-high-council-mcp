// The OUTPUT BUILDER of the MCP tool `tree_status` (0.8.3 M6 slice S7, B's new-files part; PLAN 10.2/10.3). It turns the tree-status view (src/tree-status.js, S6) into the tool's result: a JSON object in the one text block every
// read tool of this server returns, with the run-folder-derived text named as untrusted exactly as `run_status` and `list_runs` do (src/mcp/untrusted.js). READ-ONLY: it appends nothing, takes no lock, writes no file.
//
// THE SEAM (A's, named so that neither side guesses):
//   1. src/mcp/server.js registers the tool: `server.tool('tree_status', <description>, { run: <the ROOT run id> }, async ({ run }) => treeStatusResult({ runsDir, run, work }))` (or registerTool, as the advice tools do).
//      The description is user-facing wording and is A's/Muad's. The input is one run id, the id of the tree's ROOT run (the folder that holds `tree/`).
//   2. src/mcp/untrusted.js TOOL_TRUST gets   tree_status: treeStatusTrustRule()   (that is `{ wrap: 'fields', fields: TREE_STATUS_UNTRUSTED_FIELDS }`). wrapResult then marks those fields, adds the notice, strips hidden characters.
//      A tool not in TOOL_TRUST throws at registration, so this cannot be forgotten silently.
//   3. The counts that move with the tool (19 -> 20 in docs/index.html and the README, mcpb/manifest.json when it is registered with `server.tool(`) are A's, in the same commit as the registration.
//   4. The result is additive and experimental: fields may be added, none renamed or removed within 0.8.x.
//
// PLAN 10.3 says of this tool only: one read-only tool, wrapped as untrusted text because its output carries node scopes and decision text; and PLAN 9.2 says the verdict is shown with the time of its event. Every
// item maps to a key: read-only (nothing is written, tested), untrusted wrapping (TREE_STATUS_UNTRUSTED_FIELDS), verdict + time (verdict.value, verdict.at, verdict.eventId). The plan names no other key; the rest of the
// payload is this view's own design. (PLAN 10.2's `tree` block of run_status, with the active node, is a different tool and A's.)
//
// THE CONTRACT (fixed before the tests):
//   treeStatusPayload(facts) -> object     PURE. From gatherStatusFacts' facts. camelCase like run_status. Keys: run, treeId, verdict { value, source, eventId, at, reasons[] } (value is null and reasons empty once the tree is abandoned), stopMarker, abandoned (null, or { eventId, at, gateId, shownSha256, retiredStops[] }: ROADMAP 57, ids and times the harness wrote, so TRUSTED; openStops, waiting, held and awaitingApproval are empty then), piiGate ('off' | 'warn' | 'hard-stop' | 'unusable' | 'unreadable': the state word, S8-6b part 1), memberRefusals [{ node, generation, count, runJson }] (member starts the tree refused for its personal-data rule while the node is still registered; S8-6b part 2a; never the record's detail text), closedUnstarted [{ node, generation, stopId, at }] (children a person closed before they started; S8-6b part 2b; never the stop's findings), consistency, problems[],
//                                          gate { ok, problems[] }, nodes[], waiting[], awaitingApproval[], dead[], held { registeredNotStarted[], parentChanged[], guardRefusals[], splitChanged[] }, openStops[] ({ id, node, generation, child, text }: `child` is the fixed key of the unregistered node a bundle_input stop on the root names, else null),
//                                          limits, money, view (the same text `council tree status` prints). `money` keeps the two figures apart (memberSpend, adjustments) and has no total.
//   treeStatusResult({ runsDir, run, work }) -> { content: [{ type: 'text', text }] }     the tool's result. A run that is not a folder this server may touch (src/run-files.js trustedRunDir, the id pattern RUN_FOLDER), or not the
//                                          root of a tree, gives { error } in the same shape (run_status's way): a member run names its tree so the caller can ask again. EVERY member folder the record registers must pass trustedRunDir too
//                                          (a symbolic link anywhere in one ends the call with an error naming it): the readers underneath open member folders by themselves.
//
// WHICH FIELDS ARE UNTRUSTED, and why (TREE_STATUS_UNTRUSTED_FIELDS): a field is named when its text can come from a run folder or a model, directly or quoted:
//   view            the whole rendered text: it quotes a stop's handoff text ("What it says it is"), reason texts and the guard's item words.
//   verdict         its reasons[].text: a held item's reason carries a clipped quote of a criterion (src/tree-ready.js), and scopes name nodes.
//   waiting         the eligibility reasons (they name paths, statuses and a stop's words).
//   dead            the orphan reasons.
//   held            guard refusals carry the refused item's words ("the guard g refused the item \"...\""); the rest are ids and numbers but travel in the same object.
//   openStops       each stop's text, with the node's own words verbatim.
//   problems        what the record reader says about a corrupt line.
// NOT named (harness numbers and ids only): abandoned (event and gate ids, a recorded time, retired stop ids: ROADMAP 57), nodes (paths, generations, phases, run ids), memberRefusals (paths, generations, counts, a flag), closedUnstarted (paths, generations, a stop id, a recorded time), acceptedNodes (paths, generations, run ids, a decision id, an actor), adoptedNodes (paths, generations, run ids, a slot, a parent, a decision id), heldNodes and keptNodes (paths, generations, run ids), gate (codes, run ids, reservation keys), limits, money, stopMarker, piiGate (one of five fixed words: the reason text of an unusable value is never in the payload or the view), consistency, run, treeId, awaitingApproval (frontier keys).
import { readRunJson, trustedRunDir } from '../run-files.js';
import { RUN_FOLDER } from '../run-status.js';
import { isDeniedPath } from '../tools.js';
import { readTreeRecord } from '../tree-record.js';
import { gatherStatusFacts, renderTreeStatus, startedOf } from '../tree-status.js';

export const TREE_STATUS_UNTRUSTED_FIELDS = Object.freeze(['view', 'verdict', 'waiting', 'dead', 'held', 'openStops', 'problems', 'deferredStops', 'draftedStops']);       // deferredStops carries the session's own written reason; draftedStops the session's draft and the person's change request (both reach a model)
/** The TOOL_TRUST entry for `tree_status` (A pastes this in src/mcp/untrusted.js). */
export const treeStatusTrustRule = () => ({ wrap: 'fields', fields: [...TREE_STATUS_UNTRUSTED_FIELDS] });

const result = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

/** The tool's payload for a facts object (pure). */
export function treeStatusPayload(f) {
  const rd = f.readiness;
  return {
    run: f.rootId, treeId: f.treeId ?? null,
    verdict: { value: rd.verdict, source: rd.source, eventId: rd.eventId ?? null, at: rd.at ?? null, reasons: rd.reasons.map(r => ({ severity: r.severity, code: r.code, scope: r.scope, text: r.text })) },
    stopMarker: f.stopMarker === true, abandoned: f.abandoned ?? null, piiGate: f.piiGate, memberRefusals: (f.memberRefusals ?? []).map(m => ({ node: m.node, generation: m.generation, count: m.count, runJson: m.runJson === true })), closedUnstarted: (f.closedUnstarted ?? []).map(c => ({ node: c.node, generation: c.generation, stopId: c.stopId ?? null, at: c.at ?? null })), consistency: f.consistency ?? null, problems: [...(f.problems ?? [])],
    gate: { ok: f.gate?.ok !== false, problems: (f.gate?.problems ?? []).map(p => ({ code: p.code, node: p.node ?? null, runId: p.runId ?? null, keys: [...(p.keys ?? [])] })) },
    nodes: f.nodes.map(n => ({ node: n.node, generation: n.generation, depth: n.depth, runId: n.runId, phase: n.phase, outcome: n.outcome ?? null, nextGeneration: n.nextGeneration ?? null, accepted: n.accepted ? { actor: n.accepted.actor, via: n.accepted.via } : null })),
    waiting: f.waiting.map(w => ({ node: w.node, why: [...w.why] })), awaitingApproval: [...f.awaitingApproval],
    heldNodes: (f.heldNodes ?? []).map(h => ({ node: h.node, generation: h.generation, runId: h.runId, route: h.route ?? 'root', replaces: h.replaces ?? null })),      // route/replaces: additive (C2a-record commit 2): which plan the node hangs under
    keptNodes: (f.keptNodes ?? []).map(h => ({ node: h.node, generation: h.generation, runId: h.runId, route: h.route ?? 'root', replaces: h.replaces ?? null })),
    ...(f.draftedStops?.length ? { draftedStops: f.draftedStops.map(d => ({ stopId: d.stopId, draftId: d.draftId, bytes: d.bytes, at: d.at, text: d.text, reason: d.reason, changeAsked: d.changeAsked ? { text: d.changeAsked.text, at: d.changeAsked.at } : null })) } : {}),      // GAP A: additive; absent when no draft waits
    ...(f.deferredStops?.length ? { deferredStops: f.deferredStops.map(d => ({ stopId: d.stopId, conditions: [...d.conditions], reason: d.reason, actor: d.actor })) } : {}),      // DEFERRAL: additive; absent when nothing was deferred
    ...(f.acceptedNodes?.length ? { acceptedNodes: f.acceptedNodes.map(o => ({ node: o.node, generation: o.generation, runId: o.runId, decisionId: o.decisionId, actor: o.actor })) } : {}),      // KEEP: additive; absent when nothing was accepted
    ...(f.adoptedNodes?.length ? { adoptedNodes: f.adoptedNodes.map(o => ({ node: o.node, generation: o.generation, runId: o.runId, slot: o.slot, under: o.under, decisionId: o.decisionId })) } : {}),      // C4a: additive; absent when the tree adopted nothing
    dead: f.dead.map(d => ({ node: d.node, why: [...d.why] })),
    held: { registeredNotStarted: f.held.registeredNotStarted.map(h => ({ ...h })), parentChanged: f.held.parentChanged.map(h => ({ ...h })), guardRefusals: f.held.guardRefusals.map(h => ({ ...h })), splitChanged: f.splitChanged.map(h => ({ ...h })) },
    openStops: f.openStops.map(s => ({ id: s.id, node: s.node, generation: s.generation, child: s.child ?? null, text: s.text ?? null })),
    limits: f.limits ? { ...f.limits, raised: f.limits.raised.map(r => ({ ...r })) } : null,
    money: f.money ? { unit: f.money.unit, rootCapUsd: f.money.rootCapUsd, memberSpend: { sumUsd: f.money.memberSpend.sumUsd, runs: startedOf(f.money) }, adjustments: { sumUsd: f.money.adjustments.sumUsd, reservations: f.money.adjustments.reservations.length } } : null,
    view: renderTreeStatus(f),
  };
}

/** The `tree_status` tool's result for one run id. Read-only. */
export function treeStatusResult({ runsDir, run, work }) {
  if (typeof run !== 'string' || !RUN_FOLDER.test(run)) return result({ error: 'no such run' });
  const t = trustedRunDir(runsDir, run);
  if (t.refusal) return result({ error: t.refusal });
  const record = readTreeRecord(t.dir);
  if (!record.exists) {
    const meta = readRunJson(t.dir, 'run.json');
    const tid = typeof meta?.tree?.treeId === 'string' && RUN_FOLDER.test(meta.tree.treeId) ? meta.tree.treeId : null;
    return result({ error: tid ? `run ${run} is a member of the tree ${tid}, not its root: ask for the tree's root run` : `run ${run} is not the root of a recursive-councils tree (it has no tree/ folder)` });
  }
  // CONTAINMENT (0.8.2 item 2: every run folder a tool touches is a real folder with no symbolic link in it). The readers behind the view were written for the CLI and open member folders themselves (a stop's "What this
  // is" is read raw from HANDOFF.md, for one), so EVERY run folder the record registers is checked here first; one that refuses ends the call and is named. A missing folder (a registered node that has not started) is fine.
  const members = [...new Set(record.events.filter(e => e.event === 'node_registered' && typeof e.runId === 'string').map(e => e.runId))].sort();
  for (const id of members) {
    const m = RUN_FOLDER.test(id) ? trustedRunDir(runsDir, id) : { refusal: 'not a run folder name' };
    if (m.refusal && m.refusal !== 'no such run') return result({ error: `the tree's member run ${id} is not a folder this tool may read: ${m.refusal}` });
  }
  return result(treeStatusPayload(gatherStatusFacts(t.dir, { work, deny: isDeniedPath })));   // the held nodes and a `dead` list without them come from the facts (src/tree-status.js, S8-6a2): one source for the payload and its `view` text
}
