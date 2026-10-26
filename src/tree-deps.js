// Who depends on whom in a recursive-councils tree (0.8.3 M5a; PLAN 8.1, 8.4). PURE: plain data in, plain data out. No file, no record, no clock. The loop (src/tree-loop.js) reads the record and the run folders and
// passes what this module needs; the tests build the data by hand.
//
// Nodes are LOGICAL (a path such as R/M2/M1); a generation says which replacement of that path is meant. A split's `expects` names block child ids (K1, K2), which are not node paths: `blockEdges` maps them through the
// parent's verified block to paths first, and everything else works on paths, so a replacement generation whose child ids and milestone ids repeat those of an earlier one is never confused with it.
import { childNode } from './tree-identity.js';

/** True when `node` is `ancestor` or sits below it (R/M2/M1 is within R/M2 and within R; R/M20 is not within R/M2). */
export const isWithin = (node, ancestor) => node === ancestor || String(node).startsWith(`${ancestor}/`);
/** The parent path of a node path (null for R). */
export const parentPathOf = node => (node === 'R' ? null : node.split('/').slice(0, -1).join('/'));
/** The `R/M2` of `R/M2@g1`. */
export const pathOfKey = key => String(key).replace(/@g\d+$/, '');

/**
 * The provider -> consumer edges one verified split declares, as node paths: an agreement's `from` child provides to its `to` child, and a non-empty provides/expects entry says the same. Child ids are mapped through the
 * block's own children to their milestones to `parentNode/<milestone>`; an id the block does not hold is dropped (and reported in `unreadable`), never guessed.
 */
export function blockEdges(parentNode, block) {
  const pathOf = new Map((block?.children ?? []).map(c => [c.id, childNode(parentNode, c.milestone)]));
  const edges = new Map(); const unreadable = [];
  const add = (from, to) => {
    const p = pathOf.get(from); const c = pathOf.get(to);
    if (!p || !c) { unreadable.push(`${from}->${to}`); return; }
    if (p !== c) edges.set(`${p}>${c}`, { provider: p, consumer: c });
  };
  for (const a of block?.agreements ?? []) add(a.from, a.to);
  for (const c of block?.children ?? []) {
    for (const e of c.provides ?? []) if (e.agreements?.length) add(c.id, e.sibling);
    for (const e of c.expects ?? []) if (e.agreements?.length) add(e.sibling, c.id);
  }
  return { edges: [...edges.values()], unreadable };
}

/**
 * The nodes a stop puts in question (PLAN 8.4 "Who is affected"), as node PATHS. Starting from the stopped node, repeat until nothing is added:
 *   - every node that CONSUMES a node already in the set: an edge whose provider is the node or an ancestor of it (a consumer of A is a consumer of everything inside A's subtree, so a stop inside A reaches A's consumers
 *     even when A1's own provides/expects are explicitly empty), or a node whose registered `dependsOn` names it;
 *   - every descendant of a node in the set.
 * `obligationCarriers` (node paths whose obligation map carries the obligation the person says the stop is about) join the set and are closed the same way. If the graph cannot be read (`graphReadable` false)
 * every sibling of the stopped node, and everything below them, is treated as affected rather than assumed independent.
 *   nodes   [{ node, dependsOn: [nodePath] }] the CURRENT generation of every logical node the record knows (registered or not yet registered children of an approved frontier are given with dependsOn [])
 *   edges   [{ provider, consumer }] from blockEdges over every verified split of the tree
 * Returns { affected: Set of paths, rootAffected: boolean, byEdge: Map consumer -> why (the first reason it was added) }.
 */
export function affectedSet({ stopped, nodes, edges, obligationCarriers = [], graphReadable = true }) {
  const known = new Set(nodes.map(n => n.node));
  const dependsOn = new Map(nodes.map(n => [n.node, n.dependsOn ?? []]));
  const affected = new Set(); const why = new Map();
  const add = (n, reason) => { if (!affected.has(n)) { affected.add(n); why.set(n, reason); return true; } return false; };
  add(stopped, 'the node that stopped');
  if (!graphReadable) {
    const parent = parentPathOf(stopped);
    for (const n of known) if (parentPathOf(n) === parent || (parent !== null && isWithin(n, stopped))) add(n, 'the graph could not be read: every sibling is treated as affected');
  }
  for (const c of obligationCarriers) add(c, 'it carries the obligation the stop is about');
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of known) {
      if (affected.has(n)) continue;
      const underAffected = [...affected].find(a => a !== n && isWithin(n, a));
      if (underAffected) { grew = add(n, `it sits below ${underAffected}`) || grew; continue; }
      const byDep = (dependsOn.get(n) ?? []).find(d => affected.has(d));
      if (byDep) { grew = add(n, `it depends on ${byDep}`) || grew; continue; }
      const byEdge = edges.find(e => e.consumer === n && [...affected].some(a => isWithin(a, e.provider)));
      if (byEdge) grew = add(n, `it expects an agreement from ${byEdge.provider}`) || grew;
    }
  }
  return { affected, rootAffected: affected.has('R'), why };
}

/**
 * The nodes of a provider's SUBTREE (the provider and everything below it) from the nodes the record knows, in path order. A consumer is registered only when every one of them is eligible (PLAN 8.1);
 * its `dependsOn` lists each with its generation and thin-contract pin.
 */
export const subtreeOf = (nodes, provider) => nodes.filter(n => isWithin(n.node, provider)).sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation));

/**
 * THE status policy (PLAN 9.1 item 2; M6 R2): which handoff Status a node may end with and still count. ONE definition for the readiness rule (src/tree-ready.js, which also reads the lint findings) and for eligibility
 * (subtreeEligible, which does not read them): `ready_for_build` always; `partial` only when the node's split holds a `decompose` milestone; `needs_decision` only when it holds a `needs-decision` milestone (whether each such
 * milestone is SETTLED is a different question: providerEligibility's unsettled list, readinessOf's milestone reasons). `findings` is optional: given, `ready_for_build` needs none and the other two need exactly `status_not_ready`.
 */
export const STATUS_ALLOWED_FINDINGS = Object.freeze(['status_not_ready']);
export function statusPolicyOk({ status, findings = null, hasDecompose = false, hasNeeds = false, accepted = false }) {       // `accepted`: a KEEP accepted this needs_decision result as it is, so the plan need not carry a needs-decision milestone
  const sameKinds = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
  if (status === 'ready_for_build') return findings === null || findings.length === 0;
  if (status === 'partial') return hasDecompose && (findings === null || sameKinds(findings, STATUS_ALLOWED_FINDINGS));
  if (status === 'needs_decision') return (hasNeeds || accepted) && (findings === null || sameKinds(findings, STATUS_ALLOWED_FINDINGS));
  return false;
}

/**
 * Is a provider's whole subtree eligible for consumption (PLAN 8.1)? `facts` per node of the subtree: { node, closed, passed, status, openStop, itemsOk, hasBlock, blockOk }:
 * closed successfully and passed (`incomplete`: a person ended it, M5d), Status not needs_decision, no open stop on it, PLAN 5.5 items 1-2 hold (`itemsOk`), and item 3 holds WHEN IT HOLDS A BLOCK (`blockOk` is only consulted if `hasBlock`: the
 * common provider is a leaf with no split block, and a finished leaf must not make its consumers wait forever). Returns { eligible, why: [string] } naming every node that is not.
 * The lint facts (M6): `lint` = undefined (not given: hand-built facts, not judged) | null (the report records no `handoff_milestones`: refused) | { status, findings } (judged by statusPolicyOk with `hasDecompose` / `hasNeeds`);
 * `reportUnreadable` = true when report.json itself does not read (then `lint` is null too, and the reason says the file cannot be read instead of "records no lint").
 */
export function subtreeEligible(facts) {
  const why = [];
  for (const f of facts) {
    if (!f.closed) why.push(`${f.node} has not closed`);
    else if (f.incomplete) why.push(`${f.node} was closed incomplete by a person`);
    else if (!f.passed) why.push(`${f.node} closed but the panel did not pass it`);
    else if (f.status == null) why.push(`${f.node} ended with no recorded Status`);          // R2 follow-up: the readiness rule blocks it (no lint), so eligibility fails closed too (two readers, one rule)
    else if (!statusPolicyOk({ status: f.status, hasDecompose: f.hasDecompose === true, hasNeeds: f.hasNeeds === true, accepted: f.statusAccepted === true })) why.push(f.status === 'needs_decision' ? `${f.node} ended with needs_decision` : `${f.node} ended with the Status ${f.status}, which its split does not allow`);
    // M6 (C&C's OPTION A, rulings rows 120 and 128): the readiness rule's lint input, judged by THE status policy WITH its findings, in BOTH directions with no exception. undefined = not given (hand-built facts); null = the report records
    // no lint at all - the readiness rule blocks that (no_milestone_lint, fail closed) and so does eligibility, so no consumer registers on a provider that can never be ready; a lint that exists is judged by statusPolicyOk.
    // `reportUnreadable` (C&C 12 Oct): report.json does not read at all - say THAT, not "records no lint" (which sends the person looking for a lint in a file that cannot be read); lint is null then too
    // D2 F7a (CR-2J-003): a Status a person or the session ACCEPTED (KEEP) counts in the lint check too, as in the Status check above and in readiness (src/tree-ready.js): one status policy for both readers
    if (f.closed && f.passed && !f.incomplete && f.reportUnreadable === true) why.push(`${f.node}'s report.json does not read, so its milestone lint cannot be shown`);
    else if (f.closed && f.passed && !f.incomplete && f.lint === null) why.push(`${f.node} records no milestone lint (handoff_milestones), so "no findings" cannot be shown`);
    else if (f.closed && f.passed && !f.incomplete && f.lint && !statusPolicyOk({ status: f.lint.status, findings: f.lint.findings, hasDecompose: f.hasDecompose === true, hasNeeds: f.hasNeeds === true, accepted: f.statusAccepted === true })) why.push(`${f.node}'s milestone lint (Status ${JSON.stringify(f.lint.status)}, ${f.lint.findings.length ? `findings ${f.lint.findings.join(', ')}` : 'no findings'}) is not one a ready node may have`);
    if (f.openStop) why.push(`${f.node} has an open stop`);
    else if (f.staleBecause?.length) why.push(`${f.node} is stale: ${f.staleBecause.join('; ')}`);        // M5e S3: a stale mark is not an open stop; its source says what to do
    if (f.closed && f.passed && !f.itemsOk) why.push(`${f.node} no longer holds PLAN 5.5 items 1-2 (its files are not what the run wrote)`);
    if (f.closed && f.passed && f.hasBlock && !f.blockOk) why.push(`${f.node} holds a split block the handoff did not reproduce`);
  }
  return { eligible: why.length === 0, why };
}
