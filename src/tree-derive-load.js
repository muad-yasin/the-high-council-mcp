// The loader for src/tree-derive.js (0.8.3 M4): reads the run folders and the tree record and hands deriveChild everything it needs as plain data. The derivation itself is pure; this is the only part that reads files.
//   - the parent: its acceptance list as it ran (report.json criteria and criteria_kinds), its registered obligation map (node_registered.obligations; none for the root), its verified split block (PLAN 5.5 items 1-3 are
//     re-run here, so a derivation never rests on a parent that has drifted) and its signed plan body;
//   - the providers a child expects something from: each provider's plan, and its whole subtree at the current generation (plans, split blocks, pins) and every recorded resolution in it;
//   - the generation's opening decisions, the root task file, and the child chain's flags.
// A pin is `thinContractSha256` on the node's `node_closed` event (the member's end hook writes it); a descendant that was never pinned, or whose report no longer says the same, is `missing_context` in the derivation.
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outdatedChainHint } from './chain-name.js';
import { readRunFile, readRunJson } from './run-files.js';
import { readTreeRecord, stateOf } from './tree-record.js';
import { childNode, nodeKey } from './tree-identity.js';
import { isSupersededGeneration, occupantOf, orphansOf, planAuthorityOf } from './tree-transitions.js';
import { bodyOfDelivered, extractSplitBlocks } from './tree-split.js';
import { expansionCheck, refusalWords } from './tree-expansion.js';
import { configSha256, limitsOnlyWords } from './tree-continuation.js';
import { DeriveRefusal } from './tree-derive.js';
import { slotEarlierPlan } from './old-plan.js';
import { rootTaskOf } from './tree-root-task.js';

const PKG_CHAINS = join(dirname(fileURLToPath(import.meta.url)), '..', 'chains');

/** The forms of a finished run's acceptance list, as the origin held them: a string, or { criterion, kind, check, on } for an item that was a kind object (src/report-shape.js criteria_kinds, index-aligned). */
export function formsOfReport(report) {
  const list = Array.isArray(report?.criteria) ? report.criteria : [];
  const kinds = Array.isArray(report?.criteria_kinds) ? report.criteria_kinds : [];
  return list.map((criterion, i) => {
    const k = kinds[i];
    if (k?.kind === 'checkable' && k.check) return { criterion, kind: 'checkable', check: k.check, on: k.on ?? 'build' };
    if (k?.kind === 'judgement') return { criterion, kind: 'judgement' };
    return criterion;
  });
}

/**
 * A node's signed plan, its thin-contract hash and (for a node that split) its block, from its run folder; unreadable pieces come back null, never guessed.
 * `acceptedBodySha256` (gate page section 12; 2b): the body hash the RECORD holds as accepted for this node (planAuthorityOf), or null (every node without a `plan_accepted`: the body is then checked against report.json's own
 * `delivered_text.body_sha256`, exactly as before - this is the check R7 relies on). When given, the body is checked against THAT hash and nothing else: an old body that hashes to the report's hash does not read, a swapped file does not read.
 * Every reader of a node's plan calls `readPlanOf` (below) so the authority cannot be forgotten at a call site (test/tree-plan-authority-pin.test.js).
 */
export function readNodePlan(runDir, { acceptedBodySha256 = null } = {}) {
  const report = readRunJson(runDir, 'report.json');
  const deliverable = readRunFile(runDir, 'deliverable.md');
  const deliveredAsAccepted = acceptedBodySha256 ? { ...(report?.delivered_text ?? {}), body_sha256: acceptedBodySha256 } : report?.delivered_text;
  const body = report && typeof deliverable.text === 'string' ? bodyOfDelivered(deliverable.text, deliveredAsAccepted) : { error: 'unreadable' };
  const plan = body.body !== undefined ? { name: 'deliverable.md', text: body.body, sha256: deliveredAsAccepted.body_sha256 } : null;
  let block = null;
  if (plan) { const blocks = extractSplitBlocks(plan.text); if (blocks.length === 1) { try { block = JSON.parse(blocks[0].text); } catch { block = null; } } }
  const thin = typeof report?.thin_contract?.sha256 === 'string' ? report.thin_contract.sha256 : null;
  return { report, plan, block, thinContractSha256: plan ? thin : null, accepted: Boolean(acceptedBodySha256) && plan !== null };
}

/** The plan of a NODE (a fold entry of the tree record), read against the hash the record accepts for it, else the report's own. The one entry every reader outside this file uses. */
export function readPlanOf(runsDir, n) { return readNodePlan(join(runsDir, n.runId), { acceptedBodySha256: planAuthorityOf(n) }); }

/** The chain file a tree registered cannot be used now (missing, or its sha256 is not the registered one: a package update, an edited project copy). A typed Error subclass (same messages, same throwing as before: registration still lets it through) so the what-if size check at decide (src/tree-decide-size.js) can tell this environmental case from a defect and SAY so. */
export class ChainUnavailable extends Error {}       // no `name` set on purpose: `String(e)` and every top-level print stay "Error: ...", as before
/** The chain file the tree registered for a depth, read: { name, sha256, config } (its sha256 must be the registered one). The price figures of the frontier stop and the flags a derivation needs both come from here. */
export function loadChainConfig({ tree, depth, work }) {
  const entry = tree.chains.find(c => c.depth === Math.min(depth, 2));
  if (!entry) throw new ChainUnavailable(`tree.json names no chain for depth ${depth}`);
  const path = [join(work, 'chains', `${entry.name}.json`), join(PKG_CHAINS, `${entry.name}.json`)].find(existsSync);
  if (!path) throw new ChainUnavailable(`the chain file ${entry.name}.json is not in the working folder's chains/ or the package.${outdatedChainHint(entry.name)}`);       // fix-up ON TOP of 56a6bba4 (CR-G2-002 class, A-DRAFT): the folder by its role, never its absolute path - since D2 F18 this sentence is a refusal detail written to the tree record and returned to an MCP session
  if (configSha256(path) !== entry.sha256) { const words = limitsOnlyWords({ tree, entry, path }); throw new ChainUnavailable(`the chain file ${basename(path)} is not the one the tree registered (sha256 differs)${words ? `; ${words}` : ''}`); }
  return { name: entry.name, sha256: entry.sha256, config: JSON.parse(readFileSync(path, 'utf8')) };
}

/** The flags the child chain will run with, from the chain file the tree registered for that depth (its sha256 must be the registered one). */
export function childChainFlags({ tree, depth, work }) {
  const { name, config } = loadChainConfig({ tree, depth, work });
  // the same reading the chain makes of its own flags (src/chain.js: `!!config.handoff`, `!!config.debate`)
  return { name, handoff: !!config.handoff, debate: !!config.debate, kindsEnabled: config.criteria_kinds?.enabled === true };
}

const byPath = (a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation);

/**
 * deriveChild's arguments for child `childId` of `parentRef` ({ node, generation }), generation `generation` of the child:
 * { treeId, generation, parent, childId, rootTask, childChain, providers, openedBy, preview }. Throws a plain Error when the parent is not expandable (items 1-3 of PLAN 5.5 fail) or the record cannot answer.
 * `preview: true` is the frontier stop (M5): the providers are siblings that are not in the record yet, so none are loaded and deriveChild leaves their part out.
 */
/** The parent of a child cannot be expanded now (it is not in the record, or PLAN 5.5 items 1-3 no longer hold for it). A typed error so the loop can record it as a refusal and rethrow everything else. */
export class NotExpandable extends Error {
  /** `drift`: the parent is in the record but PLAN 5.5 items 1-3 no longer hold for it (its files changed): the loop records that as parent_changed. false: it is not in the record at all. */
  constructor(message, { drift = false } = {}) { super(message); this.name = 'NotExpandable'; this.drift = drift; }
}

/**
 * The nodes below a provider as they stand, sorted by path (what a consumer pins). Below an ADOPTED provider the subtree is its own lineage (`adoptedBelow`), not whatever is newest on the same paths - the new plan's own node at one of those paths is a different node and must not be
 * handed to the consumer as the provider's descendant (C2b-2). Below any other node: the newest live node of each path, orphans left out, as before. Pure.
 */
export function providerSubtreeOf(state, pnode) {
  const nodes = [...state.nodes.values()];
  const latest = path => nodes.filter(n => n.node === path).sort((a, b) => b.generation - a.generation)[0];
  const pKey = nodeKey(pnode.node, pnode.generation);
  if (state.adopted?.has(pKey)) return nodes.filter(n => state.adoptedBelow?.get(nodeKey(n.node, n.generation)) === pKey && !isSupersededGeneration(state, n.node, n.generation)).sort(byPath);       // inside the branch's own lineage: a branch node planned again after the adoption (D@g3) replaces D@g1 for the consumer
  const orphans = orphansOf(state);
  return nodes.filter(n => n.node.startsWith(`${pnode.node}/`)).filter(n => latest(n.node) === n && !orphans.has(nodeKey(n.node, n.generation))).sort(byPath);
}

// `record` (optional, default: the record on disk) lets the decide form ask a WHAT-IF question about the record a decision would leave (src/tree-decide-size.js); every other caller reads the record on disk, as before.
export function loadDerivation({ rootDir, parentRef, childId, generation = 1, rootTaskPath, work, preview = false, record = readTreeRecord(rootDir) }) {
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  const key = nodeKey(parentRef.node, parentRef.generation);
  const pn = state.nodes.get(key);
  if (!pn) throw new NotExpandable(`${key} is not in the record`);
  const runDir = join(runsDir, pn.runId);
  const check = expansionCheck({ runDir, work, upTo: 3, accepted: planAuthorityOf(pn) });
  if (check.refusal) throw new NotExpandable(`${key} cannot be expanded: ${refusalWords(check.refusal)}`, { drift: true });
  const me = readPlanOf(runsDir, pn);
  const registered = record.events.find(e => e.event === 'node_registered' && e.node === parentRef.node && e.generation === parentRef.generation);
  const parent = {
    node: parentRef.node, generation: parentRef.generation, runId: pn.runId,
    items: formsOfReport(me.report).map((form, i) => ({ id: `C${i + 1}`, form })),
    obligations: parentRef.node === 'R' ? null : (registered?.obligations ?? null),
    block: check.block, blockSha256: check.sha256, plan: me.plan,
  };
  const entry = check.block.children.find(c => c.id === childId);
  if (!entry) throw new Error(`${key}'s block has no child ${childId}`);
  const node = childNode(parentRef.node, entry.milestone);
  const depth = node.split('/').length - 1;
  // the root task's bytes through the ONE pin-checked reader (C&C's Q5 ruling B): a changed or unusable pin, or a file that does not read (D2 F18 fold, C&C 25 Okt 2026: a refusal, no longer a raw read error), is a FILE cause,
  // refused with no owner (no plan's text can change it; the live re-derivation counts it 'unable', src/tree-ready.js rederivationOutcome)
  const task = rootTaskOf(rootDir, { work, path: rootTaskPath });
  if (task.refusal) throw new DeriveRefusal(task.refusal.code, task.refusal.detail);
  const rootTask = { name: task.name, text: task.text, sha256: task.sha256 };

  // the providers this child expects something from, and each provider's whole subtree as it stands
  const nodes = [...state.nodes.values()];
  const latest = path => nodes.filter(n => n.node === path).sort((a, b) => b.generation - a.generation)[0];
  const closedPin = n => record.events.filter(e => e.event === 'node_closed' && e.node === n.node && e.generation === n.generation && typeof e.thinContractSha256 === 'string').at(-1)?.thinContractSha256 ?? null;
  const asPiece = n => { const r = readPlanOf(runsDir, n); return { node: n.node, generation: n.generation, runId: n.runId, thinContractSha256: r.thinContractSha256, pin: closedPin(n), plan: r.plan, block: r.block }; };
  const providers = {};
  for (const e of preview ? [] : entry.expects) {
    if (!e.agreements.length || providers[e.sibling]) continue;
    const pc = check.block.children.find(c => c.id === e.sibling);
    const pnode = pc ? (occupantOf(state, childNode(parentRef.node, pc.milestone)) ?? latest(childNode(parentRef.node, pc.milestone))) : null;       // C2b-2: a provider slot filled by a finished run of an earlier plan is that run
    if (!pnode) throw new DeriveRefusal('missing_context', `the provider ${e.sibling} is not in the record`);
    const orphans = orphansOf(state);        // dead with a replaced parent: never part of what a consumer pins
    const subtree = providerSubtreeOf(state, pnode);
    const inTree = n => n === pnode.node || n.startsWith(`${pnode.node}/`);
    const resolutions = record.events.filter(ev => ev.event === 'milestone_resolved' && inTree(ev.node)).map(ev => {
      const d = record.events.find(x => x.event === 'decision_recorded' && x.id === ev.decisionId);
      if (!d || typeof d.text !== 'string') throw new DeriveRefusal('missing_context', `the resolution of ${ev.milestone} in ${ev.node} names no recorded decision text (decisionId ${JSON.stringify(ev.decisionId)})`);
      return { node: ev.node, generation: ev.generation, milestone: ev.milestone, decisionId: d.id, text: d.text };
    });
    providers[e.sibling] = { ...asPiece(pnode), descendants: subtree.map(asPiece), resolutions };
  }

  // the decisions that opened a replacement generation, verbatim
  const openedBy = generation < 2 ? [] : record.events.filter(ev => ev.event === 'generation_opened' && ev.nodes.some(n => n.node === node && n.generation === generation)).map(ev => {
    const d = record.events.find(x => x.event === 'decision_recorded' && x.id === ev.decisionId);
    if (!d || typeof d.text !== 'string') throw new DeriveRefusal('missing_context', `generation ${generation} of ${node} was opened by ${ev.decisionId}, which has no recorded text`);
    return { id: d.id, text: d.text };
  });
  // a descendant born from a REPLACED ancestor's new split carries that ancestor's decision too, LABELLED as the ancestor's (C&C Q6): the seat is not told the stop was its own
  const seen = new Set(openedBy.map(d => d.id));
  let cur = { node: parentRef.node, generation: parentRef.generation };
  while (cur && cur.node !== 'R') {
    const ev = record.events.find(x => x.event === 'generation_opened' && x.nodes.some(n => n.node === cur.node && n.generation === cur.generation));
    if (ev && !seen.has(ev.decisionId)) {
      const d = record.events.find(x => x.event === 'decision_recorded' && x.id === ev.decisionId);
      if (!d || typeof d.text !== 'string') throw new DeriveRefusal('missing_context', `${cur.node}@g${cur.generation} was opened by ${ev.decisionId}, which has no recorded text`);
      openedBy.push({ id: d.id, text: d.text, ancestor: cur.node }); seen.add(d.id);
    }
    const cn = state.nodes.get(nodeKey(cur.node, cur.generation));
    const pg = cn ? state.frontiers.get(cn.frontierKey)?.parentGeneration : null;
    cur = cn && typeof pg === 'number' ? { node: cn.parentNode, generation: pg } : null;
  }
  // bundle unit step 2 (slot route): the decision that opened this generation may offer the stopped plan as data to the writer of the new one
  const earlierPlan = generation < 2 || preview ? null : slotEarlierPlan({ rootDir, record, state, node, generation });
  if (earlierPlan?.refusal) throw new DeriveRefusal('missing_context', earlierPlan.refusal);
  return { treeId: record.tree.treeId, generation, parent, childId, rootTask, childChain: childChainFlags({ tree: record.tree, depth, work }), providers, openedBy, ...(earlierPlan ? { earlierPlan } : {}), ...(preview ? { preview: true } : {}) };
}
