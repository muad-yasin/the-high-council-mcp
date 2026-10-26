// The readiness rule as code (0.8.3 M6 slice S1; PLAN 9.1 items 1-3 and 5, and the held-items part of item 4; M6 plan S1). READ-ONLY: it reads the tree record and the member run folders and answers; it appends nothing,
// takes no lock and writes no file. Callers that record a verdict (S3) and show one (S4, S6, S7) build on this one function.
//
// THE CONTRACT (fixed before the tests, so a test can fail against it):
//   readinessOf(rootDir, { work, deps? }) -> { verdict, reasons, milestones, inputs }
//     verdict     'ready' | 'incomplete' | 'blocked'. ready only when `reasons` is empty. A limit never produces ready (an unexpanded `decompose` milestone is a reason, with the limit named when it is the cause).
//                 Precedence: blocked (a refusal or a failed check) wins over incomplete (work a person or a budget left undone). Both kinds stay in `reasons`.
//     reasons     [{ severity: 'blocked' | 'incomplete', code, scope, text }], sorted by (scope, code, text). `scope` is a node key (`R/M1@g1`), a qualified id (`R@g1:A1`) or 'tree'. The text names the thing and what is
//                 missing; it never names a command or a route (the 4b rule: no route is named until a test shows the tree accepts it; `tree check` does not exist yet).
//     milestones  [{ node, generation, id, status, settled }] for every milestone of every verified split at the newest generation. `settled` is the rule of PLAN 9.1 item 1: `ready`; `decompose` with a child that is
//                 itself ready; `needs-decision` with a milestone_resolved event. No milestone of an unexpanded `decompose` is ever settled.
//     inputs      what the verdict rests on, plain data (no Map, no Set, no clock), sorted by path: [{ node, generation, runId, phase, passed, status, thinContractSha256 }] plus `integrations: []`. S3 compares it
//                 with the last `readiness` event's inputs, so two calls on an unchanged tree give canonical-JSON-equal output.
//   gatherReadinessFacts(rootDir, { work, deny }) -> facts (plain data, below; `deny` is the secret denylist predicate every MCP caller passes - R16, src/run-contract-check.js); verdictOf(facts) -> the answer. readinessOf is the two together; the split exists so the rules can be tested on hand-built facts and the readers
//   on real (all-mock) trees.
//
// WHAT COUNTS (PLAN 9.1, stated here so the tests and the reader agree):
//   Newest generation only. A path whose newest REGISTERED generation is older than one a decision OPENED (latestGenerationOf, maxOpened) is `generation_pending` (incomplete) and is not judged further. Orphans (nodes
//   dead with a replaced parent, orphansOf) are not part of the tree.
//   Item 2, one policy for every node, the root included: the run passed; its panel signed it and the delivered text is the signed text (report.json signed_text.signed_off, delivered_text.same_as_signed; else
//   `blocked: unsigned change`, naming changed_by); a lint record exists (report.json handoff_milestones; its absence is NOT "no findings": fail closed) and its (Status, findings) is one of
//     ready_for_build + no finding; partial + exactly status_not_ready, only when the node's split has a `decompose` milestone; needs_decision + exactly status_not_ready, only when it has a `needs-decision` milestone.
//   Item 3: `contract check` exits 0 (the command's own function, contractCheckOf; any other exit, or one that cannot run, is blocked).
//   Item 1: every milestone of a node's VERIFIED split (a split_verified record naming the sha256 of the block on disk) is settled (above). A node whose plan holds a split fence but has no split_verified is
//   `split_not_verified` (incomplete), or `expansion_refused` (blocked) when a refusal was recorded for it and it has no verification: once a split_verified exists, no refusal record counts (D2 F3: what `tree approve` meets later is
//   read live, never as the plan's verdict).
//   Item 5: no node is stale (the fold's stale marks, or a registered dependsOn whose provider now has a newer generation: stale/incomplete; or whose thin-contract pin differs: provider_pin/blocked), stopped at
//   its cap, still running, or closed incomplete by a person; no needs_decision stop is open; no sticky tree block (record_corrupt, parent_changed, root_affected); the accounting gate (gateTree) passes.
//   Which `blocked` RECORDS count: only expansion_refused for a node, as above, and the sticky reasons. A derivation refusal (transition 'derivation') is never counted as recorded: it is a TRIGGER for a live re-derivation of the
//   unregistered child, and a refusal of a plan's own text found NOW is `derivation_refused` (blocked) at the node whose text failed (D2 F2; facts.derivationRefused). transition_refused, continuation_refused and accounting_blocked records are refused requests that change
//   nothing (tree-transitions.js), so one stray resume cannot freeze readiness; the accounting gate is read live instead.
//   Item 4 (HELD ITEMS): every agreement of a verified split (its integration_check), every check_not_enforced item and every obligation carried in context only (deduplicated by obligation identity, not by carrier)
//   is a reason `integration_unrecorded` / `held_unrecorded` (incomplete) until a person records a result. M6 S2: an AGREEMENT's result is counted only as `council tree check` writes it (src/tree-check.js): the NEWEST
//   integration_recorded event for the agreement decides (an incomplete newest event - no gateId, shownSha256 or bound - leaves the item open, fail-closed); a complete `pass` whose `bound` equals bindingOf() now
//   (the owner's verified split, the agreement's text, and the thin-contract pin of the newest live generation of EVERY node in the subtrees of its two children) is current and counts; a current `fail` is a BLOCKED
//   reason `integration_failed`; a result bound to other versions is history and the item is open again. Held items other than agreements stay open reasons until their own commit.
//
// facts = { problems: [string], treeId, sticky: [reason], accounting: { ok, problems: [{code, detail}] }, cap: null | { capUsd, availableUsd, waiting: [{ kind, key }], exhausted } (gate page 13), openStops: [{ id, node, generation }], limits: { maxDepth, maxRuns, maxChildrenPerSplit, runs }, nodes: [node],
//           integrations: [{ target (qualified agreement id), node, generation, result, complete, current, bound }] (M6 S2; absent = none) }
// node  = { node, generation, runId, phase, depth, nextGeneration, outcome, closedStatus, stale: [text], providers: [{ node, boundGeneration, newestGeneration, pinChanged }],
//           run: null | { unreadable, passed, signedOff, sameAsSigned, changedBy: [stage], lint: null | { status, findings: [kind] }, thinContractSha256, contractExit },
//           split: null (a leaf: no fence) | { readable, sha256, verifiedSha256, refusals: [{ check, detail }], milestones: [{ id, status }], agreements: [id], resolved: [milestone id] },
//           held: [{ kind, key, label, text }] }
// `problems` non-empty (tree.json or the record does not read, or the tree has not started) means nothing else is read: the verdict is blocked.
import { dirname, join } from 'node:path';
import { canonicalJson, sha256Of } from './thin-contract.js';
import { readRunJson, trustedRunDir } from './run-files.js';
import { contractCheckOf } from './run-contract-check.js';
import { readTreeRecord, stateOf } from './tree-record.js';
import { approvalValid, deadKeys, isSupersededGeneration, latestByPath, latestGenerationOf, liveNodesOf, orphansOf, placeOf, planAuthorityOf } from './tree-transitions.js';
import { childNode, depthOf, nodeKey, obligationKey } from './tree-identity.js';
import { qualify } from './tree-qid.js';
import { blockEdges, isWithin, statusPolicyOk } from './tree-deps.js';
import { loadDerivation, readNodePlan, readPlanOf } from './tree-derive-load.js';
import { extractSplitBlocks, splitSha256 } from './tree-split.js';
import { DeriveRefusal, deriveChild, itemText } from './tree-derive.js';
import { rootTaskOf, rootTaskPathOf } from './tree-root-task.js';
import { budgetOf, capFactsOf, effectiveLimits, gateTree } from './tree-budget.js';
import { describeFrontier, findPendingFrontier } from './tree-frontier.js';
import { chainWayOn } from './tree-ways-on.js';

export const VERDICTS = Object.freeze(['ready', 'incomplete', 'blocked']);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the version binding (M6 S2)
const byPathGen = (a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation);
const isStrField = v => typeof v === 'string' && v.length > 0;

/** The node paths of an agreement's two ends: `from` and `to` name the owner's CHILDREN (K1, K2), and each child is registered at the path of the milestone it expands (`<owner>/<milestone>`). null when a child is not in the block. */
export function agreementEndsOf(ownerNode, block, agreement) {
  const path = id => { const c = (block?.children ?? []).find(x => String(x.id) === String(id)); return c ? childNode(ownerNode, String(c.milestone)) : null; };
  const from = path(agreement.from); const to = path(agreement.to);
  return from && to ? { from, to } : null;
}

/** The thin-contract pin a node's report shows NOW (null when its run folder or report cannot be read). */
function thinContractNow(runsDir, n) {
  const t = trustedRunDir(runsDir, n.runId);
  if (t.refusal) return null;
  const sha = readRunJson(t.dir, 'report.json')?.thin_contract?.sha256;
  return typeof sha === 'string' ? sha : null;
}

/**
 * The versions a recorded result is bound to, for ONE target - the single place that builds a `bound` (the verb records it, the reader compares with it: no second derivation). `target` is
 * { kind: 'agreement', node, generation, id }. -> the bound object, or null when the owner has no verified split, its plan does not read, or it holds no such agreement.
 *   agreement: { kind, owningNode, owningGeneration, splitSha256 (the owner's VERIFIED split), agreementId, agreementTextSha256, participants: [{ node, generation, thinContractSha256 }] }
 * `participants` = the newest live generation (orphans out) of EVERY node in the subtree of each of the two children `<owner>/<from>` and `<owner>/<to>` (code cannot tell which descendant supplies a provider_refs
 * section, PLAN 9.1 item 4), sorted by path: a node registered later anywhere in either subtree changes the list.
 */
export function bindingOf({ state, runsDir, target }) {
  // a held item (obligation): bound to the thin-contract pin of the newest live generation of every node that CARRIES it (the target's carriers, read from the record when the target was made)
  if (target?.kind === 'obligation') {
    const live = liveNodesOf(state, [...state.nodes.values()].filter(n => !orphansOf(state).has(nodeKey(n.node, n.generation))));
    // C2b-1b: a carrier is the live node of its (path, generation); one whose generation is no longer live is read at the newest live node of its path, as before
    const liveOf = c => live.find(n => n.node === c.node && n.generation === c.generation) ?? live.filter(n => n.node === c.node).sort((a, b) => b.generation - a.generation)[0];
    const participants = (target.carriers ?? []).map(liveOf).filter(Boolean).sort(byPathGen).map(n => ({ node: n.node, generation: n.generation, thinContractSha256: thinContractNow(runsDir, n) }));
    if (!participants.length || participants.length !== target.carriers.length) return null;
    return { kind: 'obligation', obligationKey: target.key, participants };
  }
  if (target?.kind !== 'agreement') return null;
  const owner = state.nodes.get(nodeKey(target.node, target.generation));
  if (!owner?.verifiedSplit) return null;
  const block = readPlanOf(runsDir, owner).block;
  const agreement = block?.agreements?.find(a => String(a.id) === target.id);
  const ends = agreement ? agreementEndsOf(placeOf(state, owner), block, agreement) : null;       // C2b-1b: the owner's PLACE (an adopted owner fills another slot)
  if (!ends) return null;
  const roots = [ends.from, ends.to];
  const orphans = orphansOf(state);
  const live = liveNodesOf(state, [...state.nodes.values()].filter(n => !orphans.has(nodeKey(n.node, n.generation))));
  const participants = live.filter(n => roots.some(r => isWithin(placeOf(state, n), r))).sort(byPathGen)
    .map(n => ({ node: n.node, generation: n.generation, thinContractSha256: thinContractNow(runsDir, n) }));
  return {
    kind: 'agreement', owningNode: owner.node, owningGeneration: owner.generation, splitSha256: owner.verifiedSplit.sha, agreementId: String(agreement.id),
    agreementTextSha256: sha256Of(canonicalJson(agreement)), participants,
  };
}

/**
 * Where one agreement stands, from the record: { latest (the NEWEST integration_recorded event for it, complete or not, or null), complete, result, now (bindingOf now), current }. `current` is true only for a complete
 * event whose `bound` equals `now` in canonical JSON. Newest decides, whatever its shape: an incomplete newest event leaves the item open even when an older complete pass exists (fail-closed).
 */
export function integrationStatusOf({ record, state, runsDir, target }) {
  const qid = target.qid ?? qualify({ node: target.node, generation: target.generation, id: target.id });
  const latest = record.events.filter(e => e.event === 'integration_recorded' && e.agreement === qid).sort((a, b) => idNum(a.id) - idNum(b.id)).at(-1) ?? null;
  const complete = !!latest && isStrField(latest.gateId) && isStrField(latest.shownSha256) && latest.bound !== null && typeof latest.bound === 'object' && !Array.isArray(latest.bound);
  const now = bindingOf({ state, runsDir, target });
  const current = complete && now !== null && canonicalJson(latest.bound) === canonicalJson(now);
  return { qid, latest, complete, result: latest?.result ?? null, now, current };
}

const short = h => String(h ?? '').slice(0, 12);
const idNum = id => Number(String(id).slice(1)) || 0;
const clip = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- reading

/**
 * The held items one registered node carries (check_not_enforced items, guard-refused and context-only obligations), as { kind, key, label, text, full }. `key` is the obligation identity's (so every carrier's copy is the SAME
 * item); `label` is what `council tree check` takes (M6 S2, design 1.4): an obligation with an identity is addressed by its ORIGIN, `<originNode>@g<n>:<originId>` (what `decide --obligation` takes); an entry with no
 * identity (a refinement sentence a guard refused) is addressed `<refinement node>@g<n>:ref-<first 12 hex of its key>`; an own refinement item that is check_not_enforced keeps its carrier's positional id.
 */
function heldOf(registered, node, generation, genOf) {
  const map = registered?.obligations;
  if (!map) return [];
  const out = [];
  for (const i of map.items ?? []) {
    if (i?.checkNotEnforced !== true) continue;
    const key = i.identity ? obligationKey(i.identity) : sha256Of(canonicalJson({ node, generation, id: i.id }));
    const label = i.identity ? qualify({ node: i.identity.originNode, generation: i.identity.originGeneration, id: String(i.identity.originId) }) : qualify({ node, generation, id: String(i.id) });
    const full = String(itemText(i.identity?.form ?? '') ?? '');
    out.push({ kind: 'check_not_enforced', key, label, text: clip(full), full });
  }
  for (const c of map.context ?? []) {
    const key = c.identity ? obligationKey(c.identity) : sha256Of(canonicalJson({ form: c.form ?? null, refinement: c.refinement ?? null }));
    const label = c.identity ? qualify({ node: c.identity.originNode, generation: c.identity.originGeneration, id: String(c.identity.originId) })
      : qualify({ node: c.refinement ?? node, generation: c.refinement ? genOf(c.refinement) : generation, id: `ref-${key.slice(0, 12)}` });
    const full = String(itemText(c.form ?? c.identity?.form ?? '') ?? '');
    out.push({ kind: c.reason === 'guard_refused' ? 'guard_refused' : 'context_only', key, label, text: clip(full), full });
  }
  return out;
}

/**
 * HELD is not CARRIED (C&C, row 119): `carriersOf` (src/tree-obligation.js) asks who carries an obligation at all - kept or context, the ORIGIN included; this asks who holds it as HELD, the nodes whose pins a person's check binds
 * to. Both read the same node_registered map. The origin is excluded so rule 1 never judges the whole tree (every node is within R) and a held fail's closure never reaches the root.
 * Every held item of the tree as ONE target per obligation identity, whatever its kind: { kind: 'obligation', key, label, qid: label, kinds: [...sorted], text, full, carriers: [{ node, generation }] sorted by path }.
 * The same identity can be guard-refused at one carrier and check_not_enforced at another (different child chains): one target, one binding, every carrier. Carriers are the newest live generation of each path
 * (orphans out) that has no newer generation opened. Reads the record and the state only.
 */
export function heldTargetsOf({ record, state }) {
  const orphans = orphansOf(state);
  const liveNow = [...state.nodes.values()].filter(n => !orphans.has(nodeKey(n.node, n.generation)));
  const latest = latestByPath(liveNow);                  // the refinement label below names a PATH, so its generation is the path's newest (kept; BASELINE says why)
  const genOf = path => latest.get(path)?.generation ?? latestGenerationOf(state, path) ?? 1;
  const byKey = new Map();
  for (const n of liveNodesOf(state, liveNow).sort(byPathGen)) {                       // C2b-1b: every live node, an adopted one beside the new node of its path included
    if (isSupersededGeneration(state, n.node, n.generation)) continue;
    const reg = record.events.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation);
    for (const h of heldOf(reg, n.node, n.generation, genOf)) {
      const t = byKey.get(h.key) ?? { kind: 'obligation', key: h.key, label: h.label, qid: h.label, kinds: new Set(), text: h.text, full: h.full, carriers: [] };
      t.kinds.add(h.kind);
      if (!t.carriers.some(c => c.node === n.node && c.generation === n.generation)) t.carriers.push({ node: n.node, generation: n.generation });
      byKey.set(h.key, t);
    }
  }
  return [...byKey.values()].map(t => ({ ...t, kinds: [...t.kinds].sort(), carriers: t.carriers.sort(byPathGen) })).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** The milestone lint a report records, as the readiness rule and the eligibility reader both read it: { status, findings: [kind] }, or null when the report holds none (an absent lint is NOT "no findings"). ONE parse. */
export const milestoneLintOf = report => {
  const lintOf = report?.handoff_milestones;
  return Array.isArray(lintOf?.findings) ? { status: typeof lintOf.status === 'string' ? lintOf.status : null, findings: lintOf.findings.map(f => String(f?.kind ?? '')) } : null;
};

function runFactsOf(runsDir, n, work, deny) {
  const trusted = trustedRunDir(runsDir, n.runId);
  if (trusted.refusal) return { run: { unreadable: trusted.refusal }, plan: null, dir: null };
  const report = readRunJson(trusted.dir, 'report.json');
  if (!report) return { run: { unreadable: 'report.json is missing or unreadable' }, plan: null, dir: trusted.dir };
  let contractExit = null;
  try { const c = contractCheckOf(trusted.dir, { work, deny, accepted: planAuthorityOf(n) }); contractExit = Number.isInteger(c.exit) ? c.exit : null; } catch { contractExit = null; }
  return {
    run: {
      unreadable: null, passed: report.passed === true, signedOff: report.signed_text?.signed_off === true, sameAsSigned: report.delivered_text?.same_as_signed === true,
      changedBy: Array.isArray(report.delivered_text?.changed_by) ? report.delivered_text.changed_by.map(String) : [],
      lint: milestoneLintOf(report),
      thinContractSha256: typeof report.thin_contract?.sha256 === 'string' ? report.thin_contract.sha256 : null, contractExit,
    },
    plan: readNodePlan(trusted.dir, { acceptedBodySha256: planAuthorityOf(n) }), dir: trusted.dir,
  };
}

/** Everything the rules read, as plain data (see the header). Reads the record and the run folders; writes nothing. */
export function gatherReadinessFacts(rootDir, { work, deny = null } = {}) {
  if (typeof work !== 'string' || !work) throw new TypeError('gatherReadinessFacts: `work` (the working folder `contract check` resolves the task file from) is required');
  const record = readTreeRecord(rootDir);
  const problems = [];
  if (!record.tree) problems.push('tree.json is missing');
  for (const c of record.corrupt) problems.push(`the tree record is corrupt${c.line ? ` at line ${c.line}` : ''}: ${c.reason}`);
  const empty = { problems, treeId: null, sticky: [], accounting: { ok: true, problems: [] }, openStops: [], limits: null, nodes: [], integrations: [] };
  if (problems.length) return empty;
  const state = stateOf(record);
  if (!state.started) return { ...empty, problems: ['the tree has not started (no tree_started record)'] };
  const runsDir = dirname(rootDir);
  const orphans = orphansOf(state);
  const liveNodes = liveNodesOf(state, [...state.nodes.values()].filter(n => !orphans.has(nodeKey(n.node, n.generation))));       // C2b-1b: the newest node of each path PLUS the adopted ones
  const registeredOf = n => record.events.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation) ?? null;
  const nodes = [];
  const integrations = [];
  for (const n of liveNodes.sort(byPathGen)) {
    const key = nodeKey(n.node, n.generation);
    const closed = record.events.filter(e => e.event === 'node_closed' && e.node === n.node && e.generation === n.generation && e.runId === n.runId).at(-1) ?? null;
    const newest = latestGenerationOf(state, n.node);
    const reg = registeredOf(n);
    const fact = {
      node: n.node, generation: n.generation, runId: n.runId, phase: n.phase, depth: depthOf(placeOf(state, n)), ...(placeOf(state, n) !== n.node ? { place: placeOf(state, n) } : {}), nextGeneration: isSupersededGeneration(state, n.node, n.generation) ? newest : null,
      outcome: closed?.outcome ?? null, closedStatus: closed?.status ?? null, statusAccepted: state.accepted?.has(key) === true, stale: state.staleWhy.get(key) ?? [],
      providers: (Array.isArray(reg?.dependsOn) ? reg.dependsOn : []).filter(d => d && typeof d.node === 'string').map(d => {
        const all = [...state.nodes.values()].filter(x => x.node === d.node).sort((a, b) => b.generation - a.generation);
        // C2b-1 (K4): a provider the consumer is pinned to that was ADOPTED into another slot stays the provider even though its path has a newer generation; with nothing adopted `pinnedLive` is the newest registered one, exactly `all[0]`
        const top = all.find(x => x.generation === d.generation && !isSupersededGeneration(state, x.node, x.generation)) ?? all[0] ?? null;
        let pinChanged = false;
        if (top && top.generation === d.generation && d.thinContractSha256) {
          const t = trustedRunDir(runsDir, top.runId);
          pinChanged = (t.refusal ? null : readRunJson(t.dir, 'report.json')?.thin_contract?.sha256) !== d.thinContractSha256;
        }
        return { node: d.node, boundGeneration: d.generation, newestGeneration: top?.generation ?? d.generation, pinChanged };
      }),
      run: null, planReadable: null, split: null, held: [],
      accepted: planAuthorityOf(n) ? { actor: n.acceptedBy?.actor ?? null, via: n.acceptedBy?.via ?? null } : null,     // 2b: the record accepts a body for this node that no panel read (gate page 12.4)
      acceptedBodySha256: planAuthorityOf(n),
    };
    if (n.phase === 'closed') {
      const { run, plan } = runFactsOf(runsDir, n, work, deny);
      fact.run = run;
      fact.planReadable = !!plan?.plan;      // restore gap (C&C 14 Oct 2026): a closed node whose plan (deliverable.md read against report.json's delivered_text.body_sha256) cannot be read was judged READY - `split` stays null, judgeNode returned at `if (!split)`. A boolean the gatherer ALWAYS sets for a closed node. (Cause found by the suite: an edited sealed file is ALSO contract_check, pinned by test/tree-ready.test.js:281, so the reason is added and judging goes on.)
      if (plan?.plan) {
        const fences = extractSplitBlocks(plan.plan.text);
        if (fences.length) {
          const verified = n.verifiedSplit ?? null;
          // D2 F3 (CR-2I-001; C&C accepted the rule, 25 Okt 2026): a refusal counts only while the node has NO split_verified (a verify-time refusal of the plan's own output). After the verification every cause is read LIVE (the accounting
          // gate, the contract check, the plan's readability, a changed split, the ancestors), so a refusal `tree approve` met at that moment (transition 'approval' since 0.8.3; 'expansion' in records written before it, the only writer
          // of that word after a verification) is history: it was never the plan's verdict, and a plan that was never wrong is not held against it.
          const after = verified ? [] : record.events.filter(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.transition === 'expansion' && e.scope === key);
          fact.split = {
            readable: !!plan.block, sha256: plan.block ? splitSha256(plan.block) : null, verifiedSha256: verified?.sha ?? null,
            refusals: after.map(e => ({ check: String(e.check ?? ''), detail: String(e.detail ?? '') })),
            milestones: (plan.block?.milestones ?? []).map(m => ({ id: String(m.id), status: String(m.status) })),
            agreements: (plan.block?.agreements ?? []).map(a => String(a.id)),
            resolved: record.events.filter(e => e.event === 'milestone_resolved' && e.node === n.node && e.generation === n.generation).map(e => String(e.milestone)),
          };
        }
      }
    }
    // M6 S2: where each agreement of a verified split stands (a target with no integration_recorded event at all is simply absent)
    if (fact.split?.verifiedSha256) for (const id of fact.split.agreements) {
      const st = integrationStatusOf({ record, state, runsDir, target: { kind: 'agreement', node: n.node, generation: n.generation, id } });
      if (st.latest) integrations.push({ target: st.qid, node: n.node, generation: n.generation, result: String(st.result), complete: st.complete, current: st.current, bound: st.complete ? st.latest.bound : null });
    }
    nodes.push(fact);
  }
  // held items: one entry per obligation identity, on the first carrier's fact (with every carrier named); where each stands is listed with the agreements'
  for (const t of heldTargetsOf({ record, state })) {
    const f = nodes.find(x => x.node === t.carriers[0].node && x.generation === t.carriers[0].generation);
    f?.held.push({ kind: t.kinds[0], kinds: t.kinds, key: t.key, label: t.label, text: t.text, carriers: t.carriers.map(c => ({ ...c })) });
    const st = integrationStatusOf({ record, state, runsDir, target: t });
    if (st.latest) integrations.push({ target: t.label, node: t.carriers[0].node, generation: t.carriers[0].generation, result: String(st.result), complete: st.complete, current: st.current, bound: st.complete ? st.latest.bound : null });
  }
  let accounting = { ok: true, problems: [] };
  let cap = null;                                                                             // gate page 13: what waits for money and whether the CAP is what it waits for (null = not computable: the gate cannot be read)
  try { const g = gateTree(rootDir, { record }); accounting = { ok: g.ok === true, problems: (g.problems ?? []).map(p => ({ code: String(p.code), detail: String(p.detail) })) }; try { cap = capFactsOf(record, budgetOf(rootDir, { record, gate: g })); } catch { cap = null; } } catch (e) { accounting = { ok: false, problems: [{ code: 'gate_unreadable', detail: String(e.message) }] }; }
  return {
    problems, treeId: state.treeId, sticky: [...state.sticky.keys()], accounting, cap, derivationRefused: derivationRefusalsOf({ rootDir, record, state, runsDir, work, liveNodes }),
    // C&C's Q5 ruling B, point 3 (25 Okt 2026): the root task read against its pin on EVERY read, never recorded (a second copy of the file's state); it holds paid work only (every derivation refuses while it stands), never the record-only phase
    // D2 F18 fold (C&C ruling, 25 Okt 2026): a root task that does not READ feeds the same derived reason as a changed one (root_task_unreadable beside root_task_changed). Neither text carries an absolute path (the pin check's
    // sentence names the file by its name since the fix-up ON TOP of a943f492): readiness is printed in the tree handoff, which names nothing outside the runs folder
    // only a task file that does not READ is root_task_unreadable here: a root run that has not written its run.json yet (an interrupted `tree start`: tree_started with no R, or R registered and refused before its run.json) records
    // no task to read, and root_missing / not_started already say what that state needs (the fresh-eyes review of G5+6: the put-back words would be false there)
    ...(t => ({ rootTaskChanged: t.refusal?.code === 'root_task_changed' ? t.refusal.detail : null, rootTaskUnreadable: t.refusal?.code === 'root_task_unreadable' && (() => { try { rootTaskPathOf(rootDir, work); return true; } catch { return false; } })() }))(rootTaskOf(rootDir, { work })),
    // G7 item 1 (RULE 1c): a pending root re-plan that `council tree approve` cannot offer now (describeFrontier, the verb's own read, refuses it: the task, the accounting gate, the root chain) must not be named as approve's.
    // The read is read-only and derives no child (describeRootReplan); `deny` is readiness' own (R16), passed through. A throw is a refusal too (fail closed: the line then names no verb that would meet it), in fixed words.
    rootReplanRefusal: (() => { try { const pending = findPendingFrontier({ rootDir, record, state }); if (pending?.kind !== 'root_replan') return null; const d = describeFrontier({ rootDir, work, deny, pending }); return d.refusal ? { check: d.refusal.check, detail: String(d.refusal.detail) } : null; } catch { return { check: 'unreadable', detail: 'what it is described from could not be read this time' }; } })(),       // fixed words, never the throw's message: readiness reaches TREE_HANDOFF.md, which names no path outside the runs folder (CR-G2-002)
    openStops: state.openStops.map(id => { const e = record.events.find(x => x.id === id); return { id, node: e?.node ?? null, generation: e?.generation ?? null }; }),
    limits: { ...effectiveLimits(record.tree, record.events), runs: state.nodes.size }, nodes, integrations,
    // c3b: children a person closed before they were ever registered (no nodes row, no run): the newest generation of a live path only, like a node
    closedUnstarted: [...state.closedUnstarted.keys()].filter(k => !deadKeys(state).has(k)).map(k => { const m = /^(.*)@g(\d+)$/.exec(k); return { node: m[1], generation: Number(m[2]) }; }).filter(c => c.generation >= latestGenerationOf(state, c.node)),
  };
}

/**
 * D2 F2(b) (CR-2E-002, CR-MAP-007): a derivation refusal whose cause is a plan's OWN TEXT, as it stands NOW. Every `blocked` record of a derivation (transition 'derivation', check missing_context or weakened_obligation) for a child that
 * is not registered is a TRIGGER only, never the verdict (RULE 1a): the child is derived again, live, with the call the refusing verb made (a preview while its frontier has no valid approval, else in full, the providers included),
 * and only a DeriveRefusal that names an owner becomes a fact { owner, child, check, detail }. Anything else - it derives now (a code change, a file back), an owner-less refusal, an unreadable file, a moved chain - gives no fact: the
 * other reasons speak for files and drift (D3 F2-1: every throw is caught here, so no reader of readiness can be broken by it). File reads only: no model, no network; bounded by the refused, unregistered children (usually none).
 */
function derivationRefusalsOf(args) {
  return rederivedTriggers(args).filter(t => t.outcome === 'owned').map(t => ({ owner: t.owner, child: t.child, check: t.check, detail: t.detail }));
}

/**
 * The live re-derivation itself, one entry per trigger child (D2 F2(b)'s filters): { child: 'node@gN', parent: { node, generation }, outcome } where outcome is 'derives' (it returned), 'owned' (a refusal of a plan's own text: + owner, check,
 * detail) or 'unable' (anything else: an owner-less refusal, a file, the record, a chain; + detail). ONE rule for its two readers: readiness (derivationRefusalsOf: the owned ones) and the sitting's close test of a derivation_refused
 * stop (src/tree-restore.js, D2 F4c as D3 F4-1 amends it: it closes only when every derivation that reads the stopped node's plan RETURNS). `liveNodes` defaults to the record's live nodes. Takes no lock (file reads only), so the
 * close test may call it inside the tree lock.
 */
export function rederivedTriggers({ rootDir, record, state, runsDir, work, liveNodes = liveNodesOf(state, [...state.nodes.values()].filter(n => !orphansOf(state).has(nodeKey(n.node, n.generation)))) }) {
  const out = []; const seen = new Set();
  let rootTaskPath;
  for (const e of record.events) {
    if (e.event !== 'blocked' || e.reason !== 'expansion_refused' || e.transition !== 'derivation' || (e.check !== 'missing_context' && e.check !== 'weakened_obligation')) continue;
    const m = /^(R(?:\/[A-Za-z][A-Za-z0-9_-]*)+)@g([1-9]\d*)$/.exec(String(e.scope));
    if (!m || seen.has(e.scope)) continue;
    seen.add(e.scope);
    const child = m[1]; const generation = Number(m[2]);
    if (state.nodes.has(e.scope)) continue;                                                           // registered: its own run and readiness speak for it
    const parentPath = child.slice(0, child.lastIndexOf('/'));
    const parent = liveNodes.find(n => n.node === parentPath && n.phase === 'closed' && n.verifiedSplit && !isSupersededGeneration(state, n.node, n.generation));       // the live generation of the parent path (adopted-aware)
    if (!parent) continue;
    const where = { child: e.scope, parent: { node: parent.node, generation: parent.generation }, preview: true, treeId: record.tree?.treeId ?? '<root>' };       // preview: until the call below says otherwise (a throw before it read nothing in full)
    let block;
    try {
      block = readPlanOf(runsDir, parent).block;
      const entry = (block?.children ?? []).find(c => childNode(parent.node, c.milestone) === child);
      if (!entry) continue;
      const approved = [...state.frontiers.values()].some(f => f.parentNode === parent.node && f.parentGeneration === parent.generation && f.revisions?.length && approvalValid(f) && (f.children ?? []).some(c => c.node === child));
      rootTaskPath ??= rootTaskPathOf(rootDir, work);
      where.preview = !approved;
      deriveChild(loadDerivation({ rootDir, parentRef: { node: parent.node, generation: parent.generation }, childId: entry.id, generation, rootTaskPath, work, preview: !approved, record }));
      out.push({ ...where, providers: providersOf(parent.node, block, child), outcome: 'derives' });
    } catch (err) {
      // only a refusal of a plan's own text is a fact; every other throw (a file, the record, a chain, a defect elsewhere) is left to the reasons that read those things live
      if (err instanceof DeriveRefusal && err.owner) out.push({ ...where, providers: providersOf(parent.node, block, child), outcome: 'owned', owner: { node: err.owner.node, generation: err.owner.generation }, check: err.code, detail: err.detail });
      else out.push({ ...where, providers: providersOf(parent.node, block, child), outcome: 'unable', detail: String(err?.detail ?? err?.message ?? err).split('\n')[0].slice(0, 300) });
    }
  }
  return out;
}

/**
 * D2 F4c / D3 F4-1, and Astra (c): the outcome of the live re-derivation for the plan of `stop` = { node, generation }, from rederivedTriggers' list. Only the derivations that READ that plan count (it is the child's parent, a provider
 * of the child, or inside a provider's subtree). 'resolved' only when there is at least one and every one returned; 'still' when one was refused for a plan's own text; 'unable' otherwise (an empty set included: the absence of a
 * new failure is not a success). The sitting's close test and the accept of a repaired provider body read this ONE rule.
 */
export function rederivationOutcome(triggers, { node, generation }) {
  // CR-RC-001: a derivation is judged by the stopped plan's ROLE in it. As the child's PARENT, a preview read that plan, so a return counts. As a provider (or inside a provider's subtree: a descendant basis), it does not: a preview
  // never runs providerPieces (src/tree-derive.js), where an owned refusal of a provider is thrown, so a preview that returns has not checked the cause of this stop. That entry is 'unable', with its way on (A-DRAFT)
  const asParent = t => t.parent.node === node && t.parent.generation === generation;
  const mine = triggers.filter(t => asParent(t) || t.providers.some(p => isWithin(node, p)))
    .map(t => (t.outcome === 'derives' && t.preview && !asParent(t) ? { ...t, outcome: 'unable', detail: `derived as a preview only (its frontier waits for a new approval), and a preview does not read what its providers settled: approve the frontier again with \`council tree approve ${t.treeId}\`, then the check runs in full` } : t));
  if (!mine.length) return { outcome: 'unable', mine };
  if (mine.every(t => t.outcome === 'derives')) return { outcome: 'resolved', mine };
  return { outcome: mine.some(t => t.outcome === 'owned') ? 'still' : 'unable', mine };
}

/** The provider paths of `child` in its parent's block (src/tree-deps.js blockEdges); [] when the block did not read. */
function providersOf(parentNode, block, child) {
  return block ? blockEdges(parentNode, block).edges.filter(x => x.consumer === child).map(x => x.provider) : [];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the rules


/** The root_task_unreadable reason's words (D2 F18 fold, A-DRAFT); exported so the rebuild refusal prints the same way on (src/tree-rebuild.js, G7: one copy). */
export const ROOT_TASK_UNREADABLE_TEXT = 'the root task file does not read: put it back as the tree was started with; a different goal is a new tree, started with `council tree start`';

/** The verdict of a facts object (pure). */
export function verdictOf(facts) {
  const reasons = [];
  const add = (severity, code, scope, text) => reasons.push({ severity, code, scope, text });
  const blocked = (code, scope, text) => add('blocked', code, scope, text);
  const incomplete = (code, scope, text) => add('incomplete', code, scope, text);
  if (facts.problems.length) {
    for (const p of facts.problems) blocked('record_unreadable', 'tree', p);
    return answer(reasons, [], []);
  }
  const placeOfFact = n => n.place ?? n.node;                       // C2b-1b: the PLACE of a node in the plan in force (its path, or the slot an adopted node fills); hand-built facts have none
  const byPath = new Map(facts.nodes.map(n => [placeOfFact(n), n]));
  const key = n => nodeKey(n.node, n.generation);
  if (!byPath.has('R')) incomplete('root_missing', 'tree', 'the root is not registered yet');
  for (const r of facts.sticky) blocked('sticky_block', 'tree', `the tree is blocked: ${r}`);
  if (facts.rootTaskChanged) blocked('root_task_changed', 'tree', `the root task is not the one the tree was started with: ${facts.rootTaskChanged}`);     // A-DRAFT; clears itself when the bytes match again
  if (facts.rootTaskUnreadable) blocked('root_task_unreadable', 'tree', ROOT_TASK_UNREADABLE_TEXT);     // D2 F18 fold (A-DRAFT); clears itself when the file reads with the pinned bytes
  if (!facts.accounting.ok) blocked('accounting_blocked', 'tree', `the accounting gate fails: ${facts.accounting.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ') || 'no detail'}`);
  for (const c of facts.closedUnstarted ?? []) incomplete('closed_incomplete', nodeKey(c.node, c.generation), `${nodeKey(c.node, c.generation)} was closed before it started, by a person: nothing ran; what waits for it starts only if it is replaced`);
  for (const s of facts.openStops) incomplete('open_stop', s.node ? nodeKey(s.node, s.generation) : 'tree', `a needs_decision stop (${s.id}) is open`);
  // gate page 13 / Astra #15: the cap is exhausted and something waits for money. Incomplete (it refuses nothing, clears nothing, is not sticky); the words name the real next step per waiting item.
  if (facts.cap?.exhausted) {
    const root = facts.treeId ?? '<root>';
    const stoppedKeys = facts.cap.waiting.filter(w => w.kind === 'stopped').map(w => w.key); const refusedKeys = facts.cap.waiting.filter(w => w.kind === 'refused').map(w => w.key);
    const steps = [];
    if (stoppedKeys.length) steps.push(`a stopped node then gets money with \`council tree decide ${root} --top-up <node> --amount <usd>\` and is resumed`);
    if (refusedKeys.length) steps.push(`a child that was not admitted for budget is offered again by \`council tree approve ${root}\``);
    incomplete('awaiting_cap', 'tree', `the cap ($${facts.cap.capUsd.toFixed(2)}) is used or held and less than a cent is free: ${[...stoppedKeys.map(k => `${k} stopped at its cap`), ...refusedKeys.map(k => `${k} not admitted: budget`)].join('; ')}. A new total is typed at a terminal with \`council tree decide ${root} --amend-cap <total>\`${steps.length ? `; ${steps.join(', and ')}` : ''}`);
  }

  const nodeReasons = new Map();                       // key -> count of reasons this node's own checks added (the "is this child ready" answer)
  const milestones = [];
  const heldSeen = new Set();
  for (const n of facts.nodes) {
    const k = key(n);
    const before = reasons.length;
    judgeNode(n, k);
    // D2 F2(c): OUTSIDE judgeNode's early returns, so a leaf provider gets it and its count makes it 'not ready'; the one stop writer (src/tree-blocked-child.js) then opens a stop on this node, answered by a new plan of it
    for (const d of (facts.derivationRefused ?? []).filter(x => nodeKey(x.owner.node, x.owner.generation) === k)) blocked('derivation_refused', k, `${k}: ${d.child} cannot be derived from this plan (${d.check}): ${d.detail}`);
    nodeReasons.set(placeOfFact(n), reasons.slice(before).filter(r => r.severity !== 'info').length);     // an `info` note (accepted_change) does not make a child 'not ready'
  }

  function judgeNode(n, k) {
    // S8 (C&C 12 Oct: one mechanism, no second code): the same reason for the ROOT, with wording that names the way on - a person decided a new root plan and its run is not registered yet (valid once S8-5 builds `council tree approve` for it)
    // D2 F9c S8 (A-DRAFT): a new root plan an approved preview did NOT admit for budget waits for money, not for an approval ("Nothing waits" until money comes back): name the way out
    if (n.nextGeneration && n.node === 'R' && refusedForBudget(facts, `R@g${n.nextGeneration}`)) { incomplete('generation_pending', k, `R: the new root plan (R@g${n.nextGeneration}) was approved but not admitted for budget: raise the tree's cap with \`council tree decide ${facts.treeId ?? '<root>'} --amend-cap <total>\`, then \`council tree approve ${facts.treeId ?? '<root>'}\` offers it again`); return; }
    // G7 item 1 (A-DRAFT): the root re-plan that approve cannot offer names its cause, and the chain's way on, S13 whole (src/tree-ways-on.js chainWayOn, one copy; batch 17) (the task's put-back words are in its detail; the accounting gate's acceptance is printed with the gate)
    if (n.nextGeneration && n.node === 'R' && facts.rootReplanRefusal) { const r = facts.rootReplanRefusal; incomplete('generation_pending', k, `R: a new root plan (R@g${n.nextGeneration}) was decided and its run is not registered yet; \`council tree approve ${facts.treeId ?? '<root>'}\` cannot offer it now (${r.check}: ${r.detail})${r.check === 'chain' ? `: ${chainWayOn(facts.treeId ?? '<root>')}` : ''}`); return; }
    if (n.nextGeneration) { incomplete('generation_pending', k, n.node === 'R' ? `R: a new root plan (R@g${n.nextGeneration}) was decided and its run is not registered yet: run \`council tree approve ${facts.treeId ?? '<root>'}\`` : `${n.node}: generation ${n.nextGeneration} was opened and is not registered yet`); return; }
    // staleness is about the record (a provider moved, a stop put the node in question), so it is read whatever state the node's own run is in
    for (const p of n.providers) {
      if (p.newestGeneration > p.boundGeneration) incomplete('stale', k, `${k} was registered against ${p.node}@g${p.boundGeneration}, and ${p.node} now has generation ${p.newestGeneration}`);
      else if (p.pinChanged) blocked('provider_pin', k, `${k}: the thin contract of its provider ${p.node}@g${p.boundGeneration} is not the one it was registered against`);
    }
    for (const why of n.stale.slice(0, 1)) incomplete('stale', k, `${k} is stale: ${why}`);
    if (n.phase === 'registered') { incomplete('not_started', k, `${k} is registered and has not started`); return; }
    if (n.phase === 'running') { incomplete('running', k, `${k} is still running (or paused at an external seat)`); return; }
    if (n.phase === 'stopped') { incomplete('stopped', k, `${k} stopped at its cap and has not been resumed or closed`); return; }
    if (n.outcome === 'incomplete') { incomplete('closed_incomplete', k, `${k} was closed as incomplete by a person`); return; }
    const run = n.run;
    if (!run || run.unreadable) { blocked('report_unreadable', k, `${k}: ${run?.unreadable ?? 'its run folder was not read'}`); return; }
    if (!run.passed) { blocked('not_passed', k, `${k}: the run did not pass`); return; }
    // restore gap (C&C 14 Oct 2026): fail CLOSED. A node whose plan cannot be read must not judge ready (readiness is what `tree status`, the handoff and `tree check` tell a person; no code admits a child on the verdict alone, grepped 14 Oct 2026). `=== false`: a hand-built fact without the field is not judged here, the gatherer sets it for every closed node.
    if (n.planReadable === false) { blocked('plan_unreadable', k, `${k}: its plan file deliverable.md is missing, cannot be read, or is not the text whose hash report.json records`); }     // no return: the other checks of the report and the contract still speak (an edited sealed file is ALSO contract_check, an existing pin); the split checks below need the plan and are skipped by `if (!split)`
    if (!run.signedOff || !run.sameAsSigned) blocked('unsigned_change', k, `${k}: blocked: unsigned change - the delivered text is not the text the panel signed${run.changedBy.length ? ` (changed by ${run.changedBy.join(', ')})` : ''}`);
    if (run.contractExit !== 0) blocked('contract_check', k, `${k}: \`contract check\` ${run.contractExit === null ? 'could not run' : `exits ${run.contractExit}`}, not 0`);
    const split = n.split;
    const statuses = split?.milestones ?? [];
    const hasDecompose = statuses.some(m => m.status === 'decompose');
    const hasNeeds = statuses.some(m => m.status === 'needs-decision');
    if (!run.lint) blocked('no_milestone_lint', k, `${k}: its report records no milestone lint (handoff_milestones), so "no findings" cannot be shown`);
    else {
      const { status, findings } = run.lint;
      const ok = statusPolicyOk({ status, findings, hasDecompose, hasNeeds, accepted: n.statusAccepted === true });
      if (!ok) blocked('status_policy', k, `${k}: handoff Status ${JSON.stringify(status)} with ${findings.length ? `findings ${findings.join(', ')}` : 'no findings'} is not one a ready node may have`);
    }
    if (n.accepted && n.planReadable !== false) add('info', 'accepted_change', k, `${k}: its plan was accepted by ${n.accepted.actor === 'person' ? 'a person' : n.accepted.actor === 'session' ? 'the session' : 'someone'}${n.accepted.via ? ` (${n.accepted.via})` : ''}, not signed by the panel`);
    if (!split) return;
    if (!split.readable) { blocked('split_unreadable', k, `${k}: its plan holds a split fence that does not read as exactly one valid block`); return; }
    if (split.refusals.length) { const r = split.refusals.at(-1); blocked(r.check === 'split_changed' ? 'split_changed' : 'expansion_refused', k, `${k}: ${r.detail || r.check}`); }
    if (!split.verifiedSha256) { if (!split.refusals.length) incomplete('split_not_verified', k, `${k}: its split has not been verified yet`); return; }
    if (split.verifiedSha256 !== split.sha256) { blocked('split_changed', k, `${k}: the plan now holds split ${short(split.sha256)}, not the verified ${short(split.verifiedSha256)}`); return; }
    for (const m of split.milestones) {
      let settled = false;
      if (m.status === 'ready') settled = true;
      else if (m.status === 'decompose') {
        const child = byPath.get(childNode(placeOfFact(n), m.id));
        if (!child) incomplete('unexpanded', k, `${k}: milestone ${m.id} is decompose and its child ${childNode(placeOfFact(n), m.id)} is not registered${limitNote(facts, n, childNode(placeOfFact(n), m.id))}${refusedForBudget(facts, childNode(placeOfFact(n), m.id)) ? ` (it was not admitted for budget: raise the tree's cap with \`council tree decide ${facts.treeId ?? '<root>'} --amend-cap <total>\`, then \`council tree approve ${facts.treeId ?? '<root>'}\` offers it again)` : ''}`);     // D2 F9c S8b (A-DRAFT)
        // whether the child is ready is known only after every node is judged: settled below, bottom-up
      } else if (m.status === 'needs-decision') {
        settled = split.resolved.includes(m.id);
        if (!settled) incomplete('needs_decision_unresolved', k, `${k}: milestone ${m.id} needs a decision and none is recorded`);
      }
      milestones.push({ node: n.node, generation: n.generation, id: m.id, status: m.status, settled, _child: m.status === 'decompose' ? childNode(placeOfFact(n), m.id) : null, _place: placeOfFact(n) });
    }
    for (const a of split.agreements) {
      const qid = qualify({ node: n.node, generation: n.generation, id: a });
      const st = (facts.integrations ?? []).find(i => i.target === qid) ?? null;
      if (st?.current && st.result === 'pass') continue;
      if (st?.current && st.result === 'fail') blocked('integration_failed', qid, `the integration check of agreement ${qid} was recorded as failed`);
      else incomplete('integration_unrecorded', qid, st ? `the integration check of agreement ${qid} has no current recorded pass (the last result was recorded for other versions, or is incomplete)` : `the integration check of agreement ${qid} has no recorded pass`);
    }
  }
  // held items belong to the node that carries them, split or leaf (a replaced generation carries none that count)
  for (const n of facts.nodes) {
    if (n.nextGeneration) continue;
    for (const h of n.held) {
      if (heldSeen.has(h.key)) continue;
      heldSeen.add(h.key);
      const kinds = (h.kinds ?? [h.kind]).map(k => k.replace(/_/g, ' ')).join(' and ');
      const st = (facts.integrations ?? []).find(i => i.target === h.label) ?? null;
      if (st?.current && st.result === 'pass') continue;
      if (st?.current && st.result === 'fail') blocked('integration_failed', h.label, `${kinds} ${h.label}${h.text ? ` ("${h.text}")` : ''} was recorded as failed`);
      else incomplete('held_unrecorded', h.label, `${kinds} ${h.label}${h.text ? ` ("${h.text}")` : ''} has ${st ? 'no current recorded pass (the last result was recorded for other versions, or is incomplete)' : 'no recorded pass'}`);
    }
  }
  // a decompose milestone is settled only while its child (and the child's own milestones) are
  function childReady(path) {
    if ((nodeReasons.get(path) ?? 1) !== 0) return false;
    return milestones.filter(m => m._place === path).every(m => m.settled);
  }
  // the child may be judged after its parent: settle the decompose milestones in a second pass, bottom-up
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const m of milestones) {
      if (m.status !== 'decompose') continue;
      const now = byPath.has(m._child) && childReady(m._child);
      if (now !== m.settled) { m.settled = now; changed = true; }
    }
    if (!changed) break;
  }
  return answer(reasons, milestones.map(({ _child, _place, ...m }) => m), facts.nodes, facts.integrations ?? []);
}

/** D2 F9c: an approved preview refused this key (node@gN) or path (any generation) for budget, and it is still not registered: the cap facts' own list (src/tree-budget.js waitingForMoney). */
function refusedForBudget(facts, keyOrPath) {
  return (facts.cap?.waiting ?? []).some(w => w.kind === 'refused' && (w.key === keyOrPath || w.key.startsWith(`${keyOrPath}@g`)));
}

function limitNote(facts, n, childPath) {
  const l = facts.limits;
  if (!l) return '';
  const siblings = facts.nodes.filter(x => x.depth === n.depth + 1 && (x.place ?? x.node).startsWith(`${n.place ?? n.node}/`)).length;
  if (depthOf(childPath) > l.maxDepth) return ` (the depth limit ${l.maxDepth} is reached)`;
  if (l.runs >= l.maxRuns) return ` (the run limit is reached: ${l.runs} of ${l.maxRuns})`;
  if (siblings >= l.maxChildrenPerSplit) return ` (the fan-out limit is reached: ${siblings} of ${l.maxChildrenPerSplit})`;
  return '';
}

function answer(reasons, milestones, nodes, integrations = []) {
  const order = (a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
  const sorted = [...reasons].sort(order);
  // 2b (gate page 12.4): an `info` reason (accepted_change) is a NOTE every surface prints beside the verdict; it is never a blocker and never makes a tree incomplete, and `ready` is never worded as a pass over text no panel read
  const counted = sorted.filter(r => r.severity !== 'info');
  const verdict = counted.some(r => r.severity === 'blocked') ? 'blocked' : counted.length ? 'incomplete' : 'ready';
  const ms = [...milestones].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return {
    verdict, reasons: sorted, milestones: ms,
    inputs: { nodes: [...nodes].sort((x, y) => (x.node < y.node ? -1 : x.node > y.node ? 1 : x.generation - y.generation)).map(n => ({ node: n.node, generation: n.generation, runId: n.runId, phase: n.phase, passed: n.run && !n.run.unreadable ? n.run.passed : null, status: n.run?.lint?.status ?? n.closedStatus ?? null, thinContractSha256: n.run?.thinContractSha256 ?? null })),
      integrations: [...integrations].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0)).map(i => ({ target: i.target, result: i.result, complete: i.complete, current: i.current, bound: i.bound })) },
  };
}

/** The readiness of a tree, from its record and run folders. `work` is the working folder `contract check` resolves each task file from. Writes nothing. */
export function readinessOf(rootDir, { work, deny = null } = {}) {
  return verdictOf(gatherReadinessFacts(rootDir, { work, deny }));
}
