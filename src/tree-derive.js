// What a child receives (0.8.3 M4; PLAN 6.1-6.4, decisions D5, D6, D14). Built by CODE, before any paid call and without a model: for each child of a verified split, four files in
// `runs/<rootId>/tree/inputs/<node>@g<n>/`: task.md, criteria.json, context.md and node.json (the lineage `--tree-node` reads). The same inputs always give byte-identical files.
//
// This module is PURE: `deriveChild` takes in-memory data (src/tree-derive-load.js reads the run folders and the record) and returns the four files and what the record needs, or throws a DeriveRefusal; it writes nothing.
// `writeBundle` is the only writer: through a temp folder and a rename, never over a different bundle. A refusal writes no bundle and no run folder.
//
// Which obligations reach a child (PLAN 6.2), decided from obligation identities, in this order: (1) every obligation of the parent whose class in the parent's block is `global`; (2) every one the child's `inherits`
// names; (3) every obligation the parent carries only in context, unchanged (these never enter criteria.json: they ride in context.md); (4) the child's own `obligations` sentences, as `refinement`s. Items 1-2 are handed in
// in the exact form of their ORIGIN (a string, or { criterion, kind, check, on }); a copy is never re-derived from the parent's local numbering, and the parent's OWN copy must still hash to the origin's `textSha256`
// and equal its form, or the derivation is refused (`weakened_obligation`). Both existing guards (src/chain.js metaCriteria shape-only, infeasibleCriteria) run on each item with the child chain's flags; an item a guard
// refuses is left out of criteria.json, carried verbatim in context.md and recorded `guard_refused`, and the child is held (`blocked_criteria_guard`). Nothing is dropped, reworded or summarized.
import { existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, realpathSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256Of } from './thin-contract.js';
import { oneLine } from './criteria-lock.js';
import { taskHashOf } from './scope-freeze.js';
import { infeasibleCriteria, metaCriteria } from './chain.js';
import { held } from './held-roles.js';
import { lintCriteria } from './criteria-lints.js';
import { normaliseCriteria, parseCriteriaFile } from './criteria-kinds.js';
import { headingsOf } from './tree-split.js';
import { DeriveRefusal, EXCLUSION_HEADINGS, resolveContextRefs } from './tree-context-refs.js';
import { appendTreeEvent, fsyncDir, readTreeRecord, stateOf } from './tree-record.js';
import { childNode, nodeKey, obligationIdentity } from './tree-identity.js';
import { isNodePath } from './tree-transitions.js';
import { bundleHashOfFiles, bundleDirName, NODE_FILE } from './tree-continuation.js';

export { DeriveRefusal, EXCLUSION_HEADINGS, resolveContextRefs };       // moved to src/tree-context-refs.js (a leaf the verification of a split imports too); re-exported for every existing importer
export const CONTEXT_SOURCES = Object.freeze(['root-task', 'parent-plan']);

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
/** The words of an acceptance item, whether it is a string or { criterion, kind, check, on }. */
export const itemText = form => (typeof form === 'string' ? form : String(form?.criterion ?? form?.text ?? ''));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- sections, copied whole and verbatim

/**
 * The section of `text` under the heading whose text is `heading` (whitespace normalised, case kept): { count, section, headingText }. `count` is how many headings of that text the document has (a reference
 * must name exactly one). The section runs from the heading line to the line before the next heading of the same or a higher level (or the end) and is a byte-for-byte slice of the document.
 */
export function sectionOf(text, heading) {
  const doc = String(text ?? '');
  const all = headingsOf(doc);
  const wanted = norm(heading);
  const hits = all.filter(h => norm(h.text) === wanted);
  if (hits.length !== 1) return { count: hits.length, section: null, headingText: wanted };
  const h = hits[0];
  const next = all.find(x => x.line > h.line && x.level <= h.level);
  const lines = doc.split(/(?<=\n)/);                               // keeps each line's own terminator, so the slice is the original bytes
  return { count: 1, section: lines.slice(h.line - 1, next ? next.line - 1 : lines.length).join(''), headingText: norm(h.text) };
}

export const piece = (label, text) => `----- ${label} -----\n${text}${text.endsWith('\n') ? '' : '\n'}----- end -----\n\n`;
const missing = (detail, owner = null) => new DeriveRefusal('missing_context', detail, owner);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the acceptance list (PLAN 6.2) and the two guards (6.3)

/**
 * The parent's obligations as this derivation sees them: [{ id, ownForm, ownText, identity, fresh }]. For an item with an origin identity the parent's OWN copy must still hash to `textSha256` (after oneLine) and equal the
 * origin's form: one changed character is `weakened_obligation`. An item with no identity (the root's own list, or a refinement the parent added) is the origin: its identity is made here from the parent's class for it.
 */
function parentObligations(parent, classOf) {
  const byId = new Map((parent.obligations?.items ?? []).map(o => [o.id, o]));
  return parent.items.map(({ id, form }) => {
    const ownText = itemText(form);
    const entry = parent.obligations ? byId.get(id) : null;
    if (parent.obligations && !entry) throw new Error(`deriveChild: the parent's obligation map has no entry for ${id}`);
    if (entry?.identity) {
      const id0 = entry.identity;
      const textSame = sha256Of(oneLine(ownText)) === id0.textSha256;
      // a parent whose chain has criterion kinds OFF records its list as plain texts (src/chain.js takeCriteria), so its copy of a kind item (checkable / judgement) is the origin's TEXT as a string: the words are the origin's when the string IS its criterion text; the child below takes the ORIGIN's form from the identity (o.identity.form, not the parent's copy), so a checkable item stays check_not_enforced instead of becoming plain text (BUG-B-007). A parent whose copy has other words, or another object form, is still refused.
      const plainOfKind = typeof form === 'string' && id0.form !== null && typeof id0.form === 'object' && form === id0.form.criterion;
      if (!textSame || (canonicalJson(form) !== canonicalJson(id0.form) && !plainOfKind)) {
        throw new DeriveRefusal('weakened_obligation', `${parent.node} holds ${id} (obligation ${id0.originId} of ${id0.originNode}) in words that are not the origin's: an inherited obligation is never reworded (its text hash ${id0.textSha256.slice(0, 12)} does not match)`, { node: parent.node, generation: parent.generation });
      }
      return { id, ownForm: form, ownText, identity: id0, fresh: false };
    }
    const cls = classOf.get(id);
    return { id, ownForm: form, ownText, identity: obligationIdentity({ originNode: parent.node, originGeneration: parent.generation, originId: id, originClass: cls, text: ownText, form }), fresh: true };
  });
}

/** Which guard (by name) refuses this one item, with the child chain's flags; null when none does. */
function guardOf(text, flags) {
  if (metaCriteria([text], { shapeOnly: true }).length) return 'metaCriteria';
  if (infeasibleCriteria([text], { handoff: flags.handoff === true, debate: flags.debate === true }).length) return 'infeasibleCriteria';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the derivation

/**
 * deriveChild: { node, generation, files, criteria, obligationMap, guardRefused, checkNotEnforced, held, startable, bundleSha256, bundleBytes, lineage, dependsOn }. Throws DeriveRefusal; writes nothing.
 *   treeId, generation  the tree and the generation of this child (1 unless a recorded decision opened a replacement)
 *   parent              { node, generation, runId, items: [{ id, form }] (its acceptance list as it ran), obligations (null at the root; else its registered map { items, context }),
 *                         block (its verified split), blockSha256, plan: { name, text, sha256 } (its signed body) }
 *   childId             the id of the child in the parent's block
 *   rootTask            { name, text, sha256 }
 *   childChain          { handoff, debate, kindsEnabled }: the flags the child chain will run with
 *   providers           { [childId of a provider sibling]: { node, generation, runId, thinContractSha256, pin, plan, descendants: [...], resolutions: [...] } }
 *   openedBy            for generation 2 and later: [{ id, text }] the recorded decisions that opened it
 *   preview             true for the stop BEFORE a frontier is approved (M5): the providers have not run yet, so part 3 of the context (what the providers settled) is left out and a placeholder stands in its place.
 *                       Everything a person is shown at the stop is derived exactly as in the full derivation (the acceptance list, the guards, the held items, the lints, the other refusals); there is no bundle,
 *                       so `files`, `lineage`, `bundleSha256` and `bundleBytes` are null and `writeBundle` refuses it. test/tree-derive.test.js pins that a preview and the full derivation agree.
 */
export function deriveChild({ treeId, generation = 1, parent, childId, rootTask, childChain = {}, providers = {}, openedBy = [], preview = false, earlierPlan = null }) {
  const block = parent.block;
  const child = block.children.find(c => c.id === childId);
  if (!child) throw new TypeError(`deriveChild: the parent's block has no child ${JSON.stringify(childId)}`);
  const milestone = block.milestones.find(m => m.id === child.milestone);
  const node = childNode(parent.node, child.milestone);
  if (!isNodePath(node)) throw new TypeError(`deriveChild: ${JSON.stringify(node)} is not a node path`);
  const classOf = new Map(block.classes.map(c => [c.id, c.class]));

  // 1. the acceptance list, in the plan's order, each in the form of its origin
  const own = parentObligations(parent, classOf);
  const ownById = new Map(own.map(o => [o.id, o]));
  const entries = [];                                         // { identity|null, form, refinement?, source }
  for (const o of own) if (classOf.get(o.id) === 'global') entries.push({ identity: o.identity, form: o.identity.form, source: 'global' });
  for (const id of child.inherits) {
    const o = ownById.get(id);
    if (!o) throw new TypeError(`deriveChild: the child inherits ${id}, which the parent's acceptance list does not hold (PLAN 5.3 check 3 should have refused the block)`);
    if (!entries.some(e => e.identity?.originNode === o.identity.originNode && e.identity?.originGeneration === o.identity.originGeneration && e.identity?.originId === o.identity.originId)) entries.push({ identity: o.identity, form: o.identity.form, source: 'inherits' });
  }
  for (const sentence of child.obligations) entries.push({ identity: null, form: sentence, refinement: node, source: 'refinement' });

  // 2. the two guards, per item, with the child chain's flags
  const kept = []; const guardRefused = []; const contextOnly = [...(parent.obligations?.context ?? [])];
  for (const e of entries) {
    const guard = guardOf(itemText(e.form), childChain);
    if (guard) { guardRefused.push({ guard, form: e.form, identity: e.identity, refinement: e.refinement ?? null }); contextOnly.push({ identity: e.identity, form: e.form, refinement: e.refinement ?? null, reason: 'guard_refused', guard }); } else kept.push(e);
  }
  const texts = kept.map(e => itemText(e.form));
  if (metaCriteria(texts, { shapeOnly: true }).length || infeasibleCriteria(texts, { handoff: childChain.handoff === true, debate: childChain.debate === true }).length) {
    throw new Error('deriveChild: the final list still trips a guard (an output check that cannot fail while the per-item check holds)');
  }
  const checkNotEnforced = [];
  const items = kept.map((e, i) => {
    const notEnforced = typeof e.form === 'object' && e.form?.kind === 'checkable' && childChain.kindsEnabled !== true;
    if (notEnforced) checkNotEnforced.push({ id: `C${i + 1}`, identity: e.identity, form: e.form });
    return { id: `C${i + 1}`, identity: e.identity, ...(e.refinement ? { refinement: e.refinement } : {}), ...(notEnforced ? { checkNotEnforced: true } : {}) };
  });
  const heldFor = [...(guardRefused.length ? ['blocked_criteria_guard'] : []), ...(checkNotEnforced.length ? ['check_not_enforced'] : [])];

  // 3. context.md, its seven parts in order (PLAN 6.4)
  const ctx = [];
  // the stretches of context.md the TREE CODE wrote from the pinned root task's own bytes (the body between a piece's label line and its end line), as character offsets: the only text a root allowance may cover in a child's input (C&C ruling, 19 Okt 2026: bytes, never the value)
  const rootTaskSpans = [];
  const rootPush = (label, text) => { const from = ctx.join('').length + `----- ${label} -----\n`.length; ctx.push(piece(label, text)); rootTaskSpans.push({ from, to: from + text.length }); };
  const resolved = resolveContextRefs({ refs: child.context_refs, rootTask, parentPlan: parent.plan, owner: { node: parent.node, generation: parent.generation } });
  ctx.push('# Context\n\n');
  ctx.push('## 1. The child\'s entry in the signed split\n\n');
  ctx.push(entryText({ block, child, milestone }));
  ctx.push('\n## 2. The root task: its goal and exclusions\n\n');
  if (resolved.whole) {
    const named = resolved.whole.refs.length ? ` (context_refs ${resolved.whole.refs.map(r => JSON.stringify(r)).join(', ')} resolve to it)` : '';
    rootPush(`root task ${rootTask.name} (sha256 ${rootTask.sha256}), the whole file: ${resolved.whole.onlyExclusions ? 'its only headings are exclusions headings' : 'it has no addressable headings'}${named}`, rootTask.text);     // the first variant: LB-2 (ii) (A-DRAFT)
  } else for (const p of resolved.root) rootPush(p.label, p.text);
  ctx.push('## 3. What the providers settled\n\n');
  const provided = preview ? { text: '(the providers have not finished: what they settled is added when they have)\n\n', dependsOn: [] } : providerPieces({ block, child, providers });
  const providedAt = ctx.join('').length;
  ctx.push(provided.text || '(this plan expects nothing from its siblings)\n\n');
  ctx.push('## 4. Sections of the parent plan named in the child\'s context_refs\n\n');
  if (resolved.plan.length) for (const p of resolved.plan) ctx.push(piece(p.label, p.text)); else ctx.push('(none named)\n\n');
  ctx.push('## 5. The parent\'s locked criteria, for reference\n\n');
  // Muad's yes, 11 Oct 2026 ("Yes to all three"): the parent's items are PC<n> (never C<n>, which is the child's own numbering: its position in criteria.json, the list its handoff prompt shows), the sentence below says so, and each
  // item names the child's own number when the child carries it - matched by IDENTITY (origin node, generation, id), never by text or by the parent's id string. A refinement has no parent item.
  ctx.push('The parent plan\'s criteria, for reference only. Check and cite only your own C-numbers.\n');
  const sameOrigin = (a, b) => !!a && !!b && a.originNode === b.originNode && a.originGeneration === b.originGeneration && a.originId === b.originId;
  ctx.push(`${own.map((o, i) => {
    const k = kept.findIndex(e => sameOrigin(e.identity, o.identity));
    return `PC${i + 1}. ${o.ownText} ${k >= 0 ? `(this is your C${k + 1})` : '(not in your acceptance list)'}`;
  }).join('\n')}\n\n`);
  ctx.push('## 6. Obligations carried in context only, and checks the harness cannot enforce\n\n');
  ctx.push(carriedText({ contextOnly, checkNotEnforced, items: kept, childChain }));
  ctx.push('## 7. The decisions that opened this generation\n\n');
  ctx.push(openedBy.length ? openedBy.map(d => piece(d.ancestor ? `decision ${d.id} re-planned ${d.ancestor}; this plan is part of that re-plan` : `decision ${d.id}`, String(d.text))).join('') : '(none: this is the first generation)\n\n');
  const context = ctx.join('');

  // 4. task.md (data only until the instruction sentence is recorded: held), criteria.json, node.json
  const instruction = held('treeChildTaskInstruction')?.();
  const task = `Milestone: ${child.milestone}\nScope: ${child.scope}\nOpen question: ${milestone?.open_question ?? ''}\n${instruction ? `\n${instruction}\n` : ''}`;
  const criteria = kept.map(e => e.form);
  const files = { 'task.md': task, 'criteria.json': `${JSON.stringify(criteria, null, 2)}\n`, 'context.md': context };
  if (criteria.length) assertHandedInUnchanged(criteria, files['criteria.json'], i => (kept[i]?.identity ? { node: kept[i].identity.originNode, generation: kept[i].identity.originGeneration } : { node: parent.node, generation: parent.generation }));
  if (preview) {
    return {
      preview: true, node, generation, files: null, criteria, lineage: null, bundleSha256: null, bundleBytes: null,
      obligationMap: { items, context: contextOnly.map(c => ({ identity: c.identity ?? null, form: c.form ?? c.identity?.form, ...(c.refinement ? { refinement: c.refinement } : {}), reason: c.reason ?? 'context', ...(c.guard ? { guard: c.guard } : {}) })) },
      guardRefused, checkNotEnforced, held: heldFor, startable: criteria.length > 0, lints: lintCriteria(criteria), dependsOn: [],
    };
  }
  if (earlierPlan) files['old-plan.md'] = earlierPlan.text;       // bundle unit step 2 (slot route): the builder-only earlier plan (src/old-plan.js OLD_PLAN_FILE)
  const bundleSha256 = bundleHashOfFiles(files);
  const lineage = { treeId, node, generation, attempt: 1, parentNode: parent.node, depth: node.split('/').length - 1, splitSha256: parent.blockSha256, bundleSha256 };
  files[NODE_FILE] = `${JSON.stringify(lineage, null, 2)}\n`;
  return {
    node, generation, files, criteria, lineage, bundleSha256, bundleBytes: Object.values(files).reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0),
    obligationMap: { items, context: contextOnly.map(c => ({ identity: c.identity ?? null, form: c.form ?? c.identity?.form, ...(c.refinement ? { refinement: c.refinement } : {}), reason: c.reason ?? 'context', ...(c.guard ? { guard: c.guard } : {}) })) },
    guardRefused, checkNotEnforced, held: heldFor, startable: criteria.length > 0,
    carrierSpans: (provided.spans ?? []).map(x => ({ node: x.node, generation: x.generation, from: providedAt + x.from, to: providedAt + x.to })),     // S5b part B: whose text each stretch of context.md is
    // the $0 word-level lints (src/criteria-lints.js) on the list as it will be handed in: findings, never a stop (the chain only logs them and records them in report.json criteria_lints); returned so the stop before the frontier can show them
    lints: lintCriteria(criteria),
    dependsOn: provided.dependsOn,
    rootTaskSpans, rootTaskHash: taskHashOf(rootTask.text),
    // REBUILD (gate page 14, C&C condition A): the plans whose text ENTERED this bundle, from what the derivation consumed, not from what the node declares: the parent (part 4), every node whose text is in part 3 (the owners of the carrier spans) and every node it pinned (dependsOn: a provider and each descendant)
    sources: uniqueSources([{ node: parent.node, generation: parent.generation }, ...(provided.spans ?? []).map(x => ({ node: x.node, generation: x.generation })), ...provided.dependsOn.map(d => ({ node: d.node, generation: d.generation })), ...(earlierPlan ? [{ node: earlierPlan.node, generation: earlierPlan.generation }] : [])]),
  };
}

function uniqueSources(list) {
  const seen = new Set(); const out = [];
  for (const x of list) { const k = `${x.node}@g${x.generation}`; if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the list as the chain will read it

/**
 * "Byte-equal to the origin" must hold for what the CHILD RUNS WITH, not only for criteria.json: the chain reads `--criteria` through parseCriteriaFile and normaliseCriteria (src/criteria-kinds.js), which trims and
 * clips an object's `criterion` (2000 characters) and `check` (500), turns an unknown `on` into `build`, downgrades a checkable item with no check, and DROPS a whitespace-only string. An item that reading would change
 * is not handed in unchanged; the derivation refuses it (`weakened_obligation`) instead of recording equality the run would not honour. Strings are otherwise passed through untouched.
 */
function assertHandedInUnchanged(criteria, file, ownerOf = () => null) {
  // owner (D3 F2-4): the plan that WROTE the item - its origin node, or the parent for a refinement it added; a new plan of that node is the one that can word it so the child chain hands it in unchanged
  const refuse = (i, what) => new DeriveRefusal('weakened_obligation', `the child chain would not hand item C${i + 1} in unchanged (${what}); an inherited obligation is never altered on the way in`, ownerOf(i));
  const parsed = parseCriteriaFile(file, 'criteria.json');
  if (canonicalJson(parsed) !== canonicalJson(criteria)) throw refuse(0, 'criteria.json does not read back as the list');
  const n = normaliseCriteria(parsed);
  if (n.texts.length !== criteria.length) {
    const dropped = criteria.findIndex((f, i) => itemText(f) !== n.texts[i]);
    throw refuse(dropped < 0 ? criteria.length - 1 : dropped, 'the chain drops an empty item');
  }
  criteria.forEach((form, i) => {
    if (n.texts[i] !== itemText(form)) throw refuse(i, `its text would be trimmed or clipped to ${itemText(form).length > 2000 ? 2000 : 'fewer'} characters`);
    const want = typeof form === 'object' && form !== null ? (form.kind === 'checkable' ? { kind: 'checkable', check: form.check, on: form.on } : form.kind === 'judgement' ? { kind: 'judgement' } : { kind: null }) : { kind: null };
    const got = n.kinds?.[i] ?? { kind: null };
    if (canonicalJson(got) !== canonicalJson(want)) throw refuse(i, `its kind or check would become ${JSON.stringify(got).slice(0, 80)}`);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the parts of context.md


/** Part 1: the child's own entry, every value as the signed block holds it. */
function entryText({ block, child, milestone }) {
  const agr = id => block.agreements.find(a => a.id === id);
  const lines = [`Milestone: ${child.milestone}`, `Scope: ${child.scope}`, `Open question: ${milestone?.open_question ?? ''}`, `Inherits: ${child.inherits.length ? child.inherits.join(', ') : '(none)'}`];
  lines.push('Obligations:', ...(child.obligations.length ? child.obligations.map(o => `- ${o}`) : ['(none)']));
  for (const dir of ['provides', 'expects']) {
    lines.push(`Agreements this plan ${dir}:`);
    const rows = child[dir].flatMap(e => e.agreements.map(a => ({ e, a: agr(a) })));
    if (!rows.length) lines.push('(none)');
    for (const { e, a } of rows) {
      lines.push(`- ${a.id} ${dir === 'provides' ? 'to' : 'from'} ${e.sibling}: ${a.what}`, `  Integration check: ${a.integration_check}`);
      // C&C (M4 FIX): the consumer's derivation needs each of these headings to exist exactly once in THIS plan, so the plan that provides the agreement is shown them, verbatim
      if (dir === 'provides') lines.push('  Provider refs:', ...a.provider_refs.map(r => `  - ${r}`));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Part 3: for each provider the child expects something from, its whole subtree as it settled it (PLAN 6.4 item 3), nothing merged or summarized. */
function providerPieces({ block, child, providers }) {
  const out = []; const owners = []; const dependsOn = [];
  const seen = new Set();
  for (const e of child.expects) {
    if (!e.agreements.length || seen.has(e.sibling)) continue;
    seen.add(e.sibling);
    const p = providers[e.sibling];
    if (!p) throw missing(`the child expects ${e.agreements.join(', ')} from ${e.sibling}, and no provider data was given for it`);
    const pin = (n, what) => {
      if (typeof n.pin !== 'string' || !n.pin) throw missing(`${what} has no recorded thin-contract pin`);
      if (typeof n.thinContractSha256 !== 'string' || !n.thinContractSha256) throw missing(`${what}: its plan or its thin contract cannot be read`);
      if (n.pin !== n.thinContractSha256) throw missing(`${what}: its thin contract (${n.thinContractSha256.slice(0, 12)}) is not the one pinned (${n.pin.slice(0, 12)})`);
    };
    const label = n => `provider ${n.node} generation ${n.generation}, run ${n.runId}, thin contract ${n.thinContractSha256}`;
    pin(p, `the provider ${p.node}`);
    dependsOn.push({ node: p.node, generation: p.generation, thinContractSha256: p.thinContractSha256 });
    // (a) the sections of the provider's plan its agreements name
    const refs = [...new Set(e.agreements.flatMap(id => block.agreements.find(a => a.id === id)?.provider_refs ?? []))];
    for (const ref of refs) {
      const s = sectionOf(p.plan.text, ref);
      if (s.count !== 1) throw missing(`the provider ${p.node}: the heading ${JSON.stringify(norm(ref))} (provider_refs) must exist exactly once in its plan, found ${s.count}`, { node: p.node, generation: p.generation });
      out.push(piece(`${label(p)}, ${p.plan.name} (sha256 ${p.plan.sha256}), heading "${s.headingText}"`, s.section)); owners.push({ node: p.node, generation: p.generation });
    }
    // (b) every descendant at its current generation, in node-path order: the section its own split names as the basis of each ready milestone
    for (const d of [...(p.descendants ?? [])].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation))) {
      pin(d, `the descendant ${d.node}`);
      // PLAN 4.4, 8.1: dependsOn records EVERY node of the provider's subtree with its generation and pin, not only the provider (M5c2: found by the real depth-2 test; until now only the provider was listed)
      dependsOn.push({ node: d.node, generation: d.generation, thinContractSha256: d.thinContractSha256 });
      for (const m of (d.block?.milestones ?? []).filter(x => x.status === 'ready')) {
        const named = headingsOf(d.plan.text).filter(h => h.level <= 4 && !/^m\d+\b/i.test(norm(h.text)) && norm(h.text).toLowerCase() !== 'milestones' && basisContains(m.basis, h.text));
        if (!named.length) throw missing(`the descendant ${d.node}: the basis of its ready milestone ${m.id} names no heading of its plan`, { node: d.node, generation: d.generation });
        const done = new Set();
        for (const h of named) {
          const s = sectionOf(d.plan.text, h.text);
          if (s.count !== 1 || done.has(s.headingText)) { if (s.count !== 1) throw missing(`the descendant ${d.node}: the heading ${JSON.stringify(norm(h.text))} (the basis of ${m.id}) must exist exactly once, found ${s.count}`, { node: d.node, generation: d.generation }); continue; }
          done.add(s.headingText);
          out.push(piece(`${label(d)}, ${d.plan.name} (sha256 ${d.plan.sha256}), heading "${s.headingText}" (basis of its ready milestone ${m.id})`, s.section)); owners.push({ node: d.node, generation: d.generation });
        }
      }
    }
    // (c) every milestone_resolved decision anywhere in the provider's subtree, verbatim, with the milestone it resolved
    for (const r of [...(p.resolutions ?? [])].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.milestone < b.milestone ? -1 : a.milestone > b.milestone ? 1 : a.generation - b.generation))) {
      if (typeof r.text !== 'string' || !r.text) throw missing(`the resolution of ${r.milestone} in ${r.node} has no recorded text`);
      out.push(piece(`recorded resolution of milestone ${r.milestone} in ${r.node} generation ${r.generation} (decision ${r.decisionId})`, r.text)); owners.push({ node: r.node, generation: r.generation });
    }
  }
  // WHOSE text each piece is, as character ranges inside `text` (S5b part B): a key-shaped string found in context.md names the finished node whose plan or decision carries it, so the stop can say which node to regenerate
  const spans = []; let at = 0;
  out.forEach((t, i) => { spans.push({ ...owners[i], from: at, to: at + t.length }); at += t.length; });
  return { text: out.join(''), dependsOn, spans };
}

/** Does a ready milestone's `basis` name this heading? The same rule as src/tree-split.js basisNamesHeading, for ONE heading: 3+ words may sit inside the basis, a shorter heading must be the whole basis. */
function basisContains(basis, headingText) {
  const plain = s => norm(String(s).replace(/[*_`]/g, '')).toLowerCase();
  const b = plain(basis); const t = plain(headingText);
  const bare = b.replace(/^[#§\s"'`]+|[\s"'`.:;,]+$/g, '');
  return t.split(' ').length >= 3 ? b.includes(t) : bare === t;
}

/** Part 6: each obligation carried in context only (guard-refused or inherited as context), each check the child chain will not enforce, and the checks of the items handed in, with their obligation identity. */
function carriedText({ contextOnly, checkNotEnforced, items }) {
  const out = [];
  const idLine = id => (id ? `origin ${id.originNode} generation ${id.originGeneration}, ${id.originId}, class ${id.originClass}, text sha256 ${id.textSha256}` : 'a refinement added for a plan of this tree, no identity yet');
  if (!contextOnly.length) out.push('(no obligation is carried in context only)\n\n');
  for (const c of contextOnly) {
    const form = c.form ?? c.identity?.form;
    out.push(piece(`carried in context, still mandatory (${c.reason ?? 'context'}${c.guard ? `: refused by ${c.guard}` : ''}); ${idLine(c.identity)}`, `${itemText(form)}${typeof form === 'object' && form?.check ? `\nCheck (${form.on ?? 'build'}): ${form.check}` : ''}\n`));
  }
  for (const c of checkNotEnforced) out.push(piece(`check not enforced by this chain (kinds are off): ${c.id}; ${idLine(c.identity)}`, `${itemText(c.form)}\nCheck (${c.form.on ?? 'build'}): ${c.form.check}\n`));
  const withChecks = items.filter(e => typeof e.form === 'object' && e.form?.check && !checkNotEnforced.some(c => c.form === e.form));
  for (const e of withChecks) out.push(piece(`check of an item handed in; ${idLine(e.identity)}`, `${itemText(e.form)}\nCheck (${e.form.on ?? 'build'}): ${e.form.check}\n`));
  return out.join('');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- writing the bundle

/**
 * Writes the four files to `tree/inputs/<node>@g<n>/` through a temp folder and a rename. An existing bundle with the same files is left as it is ({ written: false }). One that differs: for a node that is
 * NOT registered the old folder is moved aside as `<name>.replaced-<n>` (never deleted) and the new bundle is written; for a REGISTERED node it is refused (never rewritten). The folder is named after the node
 * path, which bundleDirName validates (M1's shape rule), and its real path is checked to lie under `tree/inputs/`. `{ rebuild: true }` (src/tree-rebuild.js only) lets a REGISTERED node's differing bundle be replaced the same way.
 */
export function writeBundle(rootDir, derived, { rebuild = false } = {}) {
  if (derived.preview) throw new TypeError('writeBundle: a preview has no bundle (derive the child in full, with its providers, to write one)');
  const base = join(rootDir, 'tree', 'inputs');
  const name = bundleDirName(derived.node, derived.generation);                // throws for a hostile path
  mkdirSync(base, { recursive: true });
  for (const dir of [join(rootDir, 'tree'), base]) if (lstatSync(dir).isSymbolicLink()) throw new Error(`${dir} is a symbolic link: a bundle is written only into a real tree/inputs/ folder`);
  const final = join(base, name);
  if (existsSync(final)) {
    let differsIn = null;
    for (const [file, text] of Object.entries(derived.files)) {
      let have = null; try { have = readFileSync(join(final, file), 'utf8'); } catch { /* absent */ }
      if (have !== text) { differsIn = file; break; }
    }
    if (differsIn === null) return { dir: final, written: false };
    // A bundle that differs: for a REGISTERED node never a rewrite (its registration carries bundleSha256 and the start check refuses a mismatch; the loop must not silently repair what that check exists to catch).
    // For a node NOT registered yet (a child refused at admission, then something that feeds context.md moved before the next sitting) the old bundle is moved aside as `<name>.replaced-<n>`, never deleted, and
    // the new one is written; nothing reads a `.replaced-*` folder (a bundle is always addressed by its name). The record is read here so no caller can forget the question.
    const record = readTreeRecord(rootDir);
    if (!record.tree || record.treeError || record.corrupt.length) throw new Error(`the bundle ${name} already exists and differs in ${differsIn}, and the tree record is missing or cannot be read to say whether ${derived.node}@g${derived.generation} is registered: nothing is moved or rewritten`);
    // REBUILD (gate page 14): the ONE caller that may replace a registered node's bundle is src/tree-rebuild.js, for a node that has not started and whose quoted plan changed; the old folder is moved aside below, never deleted
    if (!rebuild && stateOf(record).nodes.has(nodeKey(derived.node, derived.generation))) throw new Error(`the bundle ${name} already exists and differs in ${differsIn}, and ${derived.node}@g${derived.generation} is registered: a registered node's bundle is never rewritten`);
    let n = 1; while (existsSync(`${final}.replaced-${n}`)) n++;
    renameSync(final, `${final}.replaced-${n}`);
    fsyncDir(base);
  }
  const tmp = mkdtempSync(join(base, '.tmp-'));
  for (const [file, text] of Object.entries(derived.files)) { const fd = openSync(join(tmp, file), 'wx'); try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); } }
  fsyncDir(tmp);                                       // the files' directory entries
  renameSync(tmp, final);
  fsyncDir(base);                                      // the rename itself is durable: atomic AND durable (the repo's own rule for what it records)
  const real = realpathSync(final);
  if (!real.startsWith(`${realpathSync(base)}/`)) throw new Error(`the bundle ${name} resolved outside tree/inputs/`);
  return { dir: final, written: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the record

/**
 * One `guard_refused` event per item a guard left out of criteria.json (PLAN 6.3): the child's node, the guard's name and the item's text verbatim. The child is `blocked_criteria_guard` exactly while such an event
 * stands for it and no person has chosen at the stop (M5): a derived state, not a new `blocked` reason and not a sticky mark.
 */
export function recordGuardRefusals(rootDir, derived, { facts, now } = {}) {
  return derived.guardRefused.map(g => appendTreeEvent(rootDir, { event: 'guard_refused', node: derived.node, generation: derived.generation, item: itemText(g.form), guard: g.guard, ...(g.identity ? { origin: `${g.identity.originNode}:${g.identity.originId}` } : {}) }, { facts, now }));
}

/** A refused derivation is a `blocked` record in the closed list: reason expansion_refused, the refusal's code (missing_context, weakened_obligation) as the check. Nothing else is written. Readiness never counts it as a verdict: it is the TRIGGER for a live re-derivation, and a refusal of a plan's own text found then is `derivation_refused` at the node whose text failed (D2 F2, src/tree-ready.js). */
export function recordDerivationRefusal(rootDir, { node, generation }, refusal, { facts, now } = {}) {
  return appendTreeEvent(rootDir, { event: 'blocked', reason: 'expansion_refused', scope: nodeKey(node, generation), transition: 'derivation', check: refusal.code, detail: refusal.detail }, { facts, now });
}
