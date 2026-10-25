// REUSE of old sub-plans at a root re-plan: the COMPARISON (0.8.3 M6 S8-9, C1; contract Review/Build_0.8.3/m6-closing/S8-9_Reuse_Contract.md; design note section 16; Muad's reading 2, 11 Oct 2026 23:09: "same criteria text + same
// milestone scope, wording around them may change; deterministic, no model; a sub-plan whose supplier is redone is redone too; redo only with a shown reason").
//
// THIS FILE IS PURE: data in, verdicts out. No file, no clock, no network, no randomness, no model; the same inputs give the same bytes and the inputs are never changed. (The LOADER that reads the two sides from the run folders and
// verifies the old one is src/tree-reuse-load.js; it is a separate file on purpose, and a test scans this one for any file access.)
//
// Contract:
//   sideOf({ args, derived }) -> side      args = what `loadDerivation` handed `deriveChild` (src/tree-derive-load.js), derived = `deriveChild(args)` in PREVIEW mode. The side is the plain data F1-F9 are compared on:
//        { node, milestone, scope, openQuestion, acceptance: [{ key: { originNode, originClass, textSha256 }, text, from: '<originNode>@g<n>:<originId>', identity: <the whole identity object> }], refinements: [text],
//          carried: [{ reason, originClass, text, check, on, guard?, key | null, from | null, identity | null }], agreements: [{ direction, sibling (a milestone id), what, integrationCheck, providerRefs }], rootSections: [{ heading, text }],
//          chain: <canonical JSON of the child chain's flags>, expects: [node paths this child expects something from] }
//   compareChildren({ children, ambiguousKeys }) -> rows  `children` = [{ node, slot: { node, generation }, newSide (null + newProblem when the new child cannot be derived), oldSide | null, old: { node, generation, runId } | null, oldProblem | null, eligible, ineligibleWhy, wholeBranch? }] in the order
//        the caller wants them decided - PROVIDERS BEFORE THEIR CONSUMERS (`dependencyOrder`, src/tree-frontier.js). A row: { node, slot, verdict: 'same' | 'changed', field, reason, oldText?, newText?, fieldsSha256,
//        adopts?: { node, generation, runId } (same only), identityMap?: [{ from, to }] (same only) }.
//
// What F1-F9 are (the child's OWN inputs; design note 16.2): F1 the milestone, F2 `scope`, F3 `open_question`, F4 the acceptance list the child inherits (a multiset of { originNode, originClass, text }: NOT originGeneration or
// originId, which differ across root generations by construction), F5 the refinements (a multiset of texts), F6 what is carried in context only or not enforced (a multiset), F7 the agreements it provides and expects (a multiset
// of their text fields: the agreement's own id renumbers), F8 the root-task sections it names, F9 the child chain's flags. EVERY text is compared after a WHITESPACE-ONLY normalisation (`oneLine`, the one collapse
// src/criteria-lock.js already uses for criteria): no case folding, no punctuation or synonym handling. What is NOT compared is named in the contract (the providers' settled text, the parent-plan sections, the parent's
// criteria for reference, the decisions, identity metadata, the old child's output): a reuse means "its own inputs did not change", nothing more.
// S8-9 §11 (reuse is checked piece by piece at every split): `wholeBranch !== true` means the earlier node is held-eligible but its BRANCH is not whole (a piece below it never finished or failed): it is never adopted as a unit (`changed: its branch is not whole`),
// and the row carries `ownFields` ({ verdict: 'same' } or { verdict: 'changed', field, reason }) so the approval can print the node's own F1-F9 as well, because its finished pieces below it are compared at ITS new generation's split. ANYTHING BUT `true` is read as not whole
// (fail closed: a caller that forgot the predicate must not adopt a branch with a hole; the loader, src/tree-reuse-load.js, always sets a boolean). The ambiguity reason names whose list repeats the criterion from the matched key's own `originNode`
// ('R' -> the new root plan, any other node -> the plan of that node), so it never blames the wrong plan.
// Order of reasons for a `changed` row (fixed): no earlier node on that path; old inputs that cannot be verified; the earlier node is not eligible (src/tree-transitions.js ineligibleBelowRoot says why); its branch is not whole; the first differing
// field in F1..F9 order (an ambiguous acceptance list is an F4 reason); a provider that is not reused (the transitive clause, decided after the providers' own rows).
import { canonicalJson, sha256Of } from './thin-contract.js';
import { oneLine } from './criteria-lock.js';
import { childNode } from './tree-identity.js';
import { itemText, sectionOf } from './tree-derive.js';

/** F1..F9 in the order they are checked, with the plain name each reason uses. */
export const REUSE_FIELDS = Object.freeze([
  ['milestone', 'milestone differs'], ['scope', 'scope differs'], ['open_question', 'open question differs'], ['acceptance', 'acceptance list differs'], ['refinements', 'refinements differ'],
  ['carried', 'obligations carried in context only differ'], ['agreements', 'agreements differ'], ['root_sections', 'root task sections differ'], ['chain', 'child chain differs'],
]);

/**
 * THE COMPARISON TABLE'S SWITCHES (C2a gate 1, C&C 14 Oct 2026): which of F1..F9 decide `same`. F1, the milestone id, is a LABEL (a finished sub-plan whose milestone MOVED is found by content, Muad 14 Oct 2026): it is shown as old path -> new path and never compared.
 * F3, `open_question`, is SUBSTANCE (Muad's word, 14 Oct 2026): a changed question is a changed job, and a reworded one costs a rerun, never a wrong reuse. If he ever says WORDING, the change is this one line (`open_question: false`) and the screen names the risk.
 * `fieldsSha256` binds the COMPARED fields only, so a label change alone changes neither the verdict nor the hash.
 */
export const COMPARED_FIELDS = Object.freeze({ milestone: false, scope: true, open_question: true, acceptance: true, refinements: true, carried: true, agreements: true, root_sections: true, chain: true });
const norm = s => oneLine(s);
const keyOfIdentity = id => ({ originNode: id.originNode, originClass: id.originClass, textSha256: id.textSha256 });
const fromOf = id => `${id.originNode}@g${id.originGeneration}:${id.originId}`;
/**
 * THE F4/F5 COMPARISON, in ONE place, on the WHOLE criterion form (a string, or { criterion, kind, check, on }): the sides keep the forms, not only their texts. Muad, 12 Oct 2026, on the survey's finding 3: "Redo" - a criterion with
 * the same wording but a changed check counts as CHANGED. It continues his rule "same criteria text", tightened by his own answer: the criterion is its text AND its check (design note 16.2's "form text"). Text, kind, check and `on`
 * are each whitespace-collapsed (no case folding, no synonyms). Returns a readable string, which is also what a changed row shows: a plain criterion reads as its collapsed text; a checkable one as `text [kind; check: ...; on: ...]`.
 */
export const formOf = form => {
  const text = norm(itemText(form));
  if (typeof form !== 'object' || form === null) return text;
  const kind = form.kind === undefined || form.kind === null ? null : norm(form.kind);
  const check = form.check === undefined || form.check === null ? null : norm(form.check);
  const on = form.on === undefined || form.on === null ? null : norm(form.on);
  return kind === null && check === null && on === null ? text : `${text} [${kind ?? ''}; check: ${check ?? ''}; on: ${on ?? ''}]`;
};
const keyOf = k => canonicalJson({ originNode: k.originNode, originClass: k.originClass, textSha256: k.textSha256 });

/** The data F1-F9 are compared on, from a derivation. Pure. */
export function sideOf({ args, derived }) {
  const block = args.parent.block;
  const child = block.children.find(c => c.id === args.childId);
  const milestone = block.milestones.find(m => m.id === child.milestone);
  const agr = id => block.agreements.find(a => a.id === id);
  const milestoneOf = siblingId => block.children.find(c => c.id === siblingId)?.milestone ?? siblingId;
  const items = derived.obligationMap.items; const acceptance = []; const refinements = [];
  items.forEach((it, i) => {
    if (it.refinement) refinements.push(derived.criteria[i]);
    else if (it.identity) acceptance.push({ key: keyOfIdentity(it.identity), text: itemText(it.identity.form), form: it.identity.form, from: fromOf(it.identity), identity: it.identity });
  });
  const carriedOf = (reason, c, extra = {}) => ({ reason, ...extra, originClass: c.identity?.originClass ?? null, text: itemText(c.form), check: c.form?.check ?? null, on: c.form?.on ?? null, key: c.identity ? keyOfIdentity(c.identity) : null, from: c.identity ? fromOf(c.identity) : null, identity: c.identity ?? null });
  const carried = [
    ...derived.obligationMap.context.map(c => carriedOf(c.reason ?? 'context', c, c.guard ? { guard: c.guard } : {})),
    ...derived.checkNotEnforced.map(c => carriedOf('check_not_enforced', c)),
  ];
  // F7 compares the SIBLING by its own content (its scope text), not by its label and not through the slot assignment (a moved sibling is the same sibling; a pair verdict must not depend on the assignment it feeds); two siblings with the same scope make the agreement ambiguous.
  const scopeOfSibling = siblingId => norm(block.children.find(c => c.id === siblingId)?.scope ?? '');
  const siblingIsAmbiguous = siblingId => { const sc = scopeOfSibling(siblingId); return sc !== '' && block.children.filter(c => norm(c.scope ?? '') === sc).length > 1; };
  const agreements = ['provides', 'expects'].flatMap(direction => child[direction].flatMap(e => e.agreements.map(id => { const a = agr(id); return { direction, sibling: milestoneOf(e.sibling), siblingScope: scopeOfSibling(e.sibling), siblingAmbiguous: siblingIsAmbiguous(e.sibling), what: a.what, integrationCheck: a.integration_check, providerRefs: [...(a.provider_refs ?? [])] }; })));
  const expects = [...new Set(child.expects.filter(e => e.agreements.length).map(e => childNode(args.parent.node, milestoneOf(e.sibling))))].sort();
  const rootRefs = child.context_refs.map(r => /^root-task:\s*(\S[\s\S]*)$/.exec(String(r))).filter(Boolean).map(m => norm(m[1]));
  const rootSections = rootRefs.length ? rootRefs.map(heading => ({ heading, text: sectionOf(args.rootTask.text, heading).section ?? '' })) : [{ heading: '(the whole root task)', text: args.rootTask.text }];
  const cc = args.childChain ?? {};
  return {
    node: derived.node, milestone: child.milestone, scope: child.scope, openQuestion: milestone?.open_question ?? '', acceptance, refinements, carried, agreements, rootSections,
    chain: canonicalJson({ handoff: cc.handoff === true, debate: cc.debate === true, kindsEnabled: cc.kindsEnabled === true }), expects,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- comparing

/** A side with every text collapsed and every multiset sorted: what is compared and what `fieldsSha256` binds. */
function canonicalSide(s) {
  const sorted = list => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    milestone: norm(s.milestone), scope: norm(s.scope), open_question: norm(s.openQuestion),
    acceptance: sorted(s.acceptance.map(a => canonicalJson({ key: { originNode: a.key.originNode, originClass: a.key.originClass, textSha256: a.key.textSha256 }, text: formOf(a.form ?? a.text) }))),
    refinements: sorted(s.refinements.map(formOf)),
    carried: sorted(s.carried.map(c => canonicalJson({ key: c.key ?? null, reason: c.reason, guard: c.guard ?? null, originClass: c.originClass ?? null, text: norm(c.text), check: c.check === null ? null : norm(c.check), on: c.on ?? null }))),
    agreements: sorted(s.agreements.map(a => canonicalJson({ direction: a.direction, sibling: norm(a.siblingScope ?? a.sibling), ...(a.siblingAmbiguous ? { ambiguous: true } : {}), what: norm(a.what), integrationCheck: norm(a.integrationCheck), providerRefs: [...a.providerRefs].map(norm).sort() }))),
    root_sections: sorted(s.rootSections.map(r => canonicalJson({ heading: norm(r.heading), text: norm(r.text) }))),
    chain: s.chain,
  };
}

/** The part of a canonical side that is compared (the label F1 is out, COMPARED_FIELDS): what `fieldsSha256` binds. */
const comparedOf = canon => Object.fromEntries(Object.entries(canon).filter(([field]) => COMPARED_FIELDS[field] !== false));

/** The first element of `a` (a sorted list of canonical strings) that `b` does not hold as often, shown as plain text. */
function firstMissing(a, b) {
  const count = new Map(); for (const x of b) count.set(x, (count.get(x) ?? 0) + 1);
  for (const x of a) { const n = count.get(x) ?? 0; if (n === 0) return x; count.set(x, n - 1); }
  return null;
}
const shown = canon => { try { const o = JSON.parse(canon); return typeof o === 'string' ? o : (o.reason !== undefined && o.text !== undefined ? `${o.reason}${o.guard ? ` (${o.guard})` : ''}: ${o.text}` : o.text !== undefined ? (o.heading !== undefined ? `${o.heading}: ${o.text}` : o.text) : (o.what !== undefined ? `${o.direction} ${o.sibling}: ${o.what} (check: ${o.integrationCheck})` : canon)); } catch { return canon; } };

const hasDuplicates = list => new Set(list).size !== list.length;
/** The identity keys of a canonical list (acceptance or carried): ambiguity is by KEY - the map pairs by { originNode, originClass, textSha256 } - and under Reading F two items of one wording with different checks share a key although their forms differ. */
const keysOf = list => list.map(x => JSON.parse(x).key).filter(Boolean).map(k => canonicalJson(k));

function firstDifference(oldC, newC) {
  for (const [field, words] of REUSE_FIELDS) {
    if (COMPARED_FIELDS[field] === false) continue;
    const a = oldC[field]; const b = newC[field];
    if (Array.isArray(a)) {
      if (field === 'acceptance' && (hasDuplicates(keysOf(a)) || hasDuplicates(keysOf(b)))) return { field, reason: 'acceptance list is ambiguous (two items have the same origin, class and text, so the identity map could not pair them)', oldText: shown(a.find((x, i) => a.indexOf(x) !== i) ?? a[0] ?? '(none)'), newText: shown(b.find((x, i) => b.indexOf(x) !== i) ?? b[0] ?? '(none)') };
      if (field === 'carried') {
        if (hasDuplicates(keysOf(a)) || hasDuplicates(keysOf(b))) return { field, reason: 'obligations carried in context only are ambiguous (two carried items have the same origin, class and text, so the identity map could not pair them)', oldText: shown(a[0] ?? '(none)'), newText: shown(b[0] ?? '(none)') };
      }
      if (field === 'agreements') {
        const amb = [...a, ...b].map(x => JSON.parse(x)).find(x => x.ambiguous === true);
        if (amb) return { field, reason: 'agreements are ambiguous (two siblings have the same scope, so an agreement could not tell which one it names)', oldText: shown(a[0] ?? '(none)'), newText: shown(b[0] ?? '(none)') };
      }
      if (canonicalJson(a) !== canonicalJson(b)) {
        const gone = firstMissing(a, b); const added = firstMissing(b, a);
        return { field, reason: words, oldText: gone === null ? '(none)' : shown(gone), newText: added === null ? '(none)' : shown(added) };
      }
    } else if (a !== b) return { field, reason: words, oldText: field === 'chain' ? a : String(a), newText: field === 'chain' ? b : String(b) };
  }
  return null;
}

/**
 * The identity map of a `same` child: one entry per acceptance item AND per carried item that has an identity (guard-refused, context-only, check_not_enforced: `heldOf` reads exactly those), { from: '<old label>',
 * to: <the NEW side's whole identity object> }, paired by { originNode, originClass, textSha256 }. The whole `to` identity travels, not a label: an identity rebuilt from the old one by swapping `originGeneration` and
 * `originId` would keep the old raw `form`, and `obligationKey` (a hash of the whole identity) would differ from the new copy's. An own refinement has no identity and no entry (its origin is the node itself).
 */
function identityMapOf(oldSide, newSide) {
  const out = [];
  for (const list of ['acceptance', 'carried']) {
    const byKey = new Map(newSide[list].filter(x => x.key && x.identity).map(x => [keyOf(x.key), x.identity]));
    for (const o of oldSide[list]) if (o.key && o.identity && byKey.has(keyOf(o.key)) && !out.some(m => m.from === o.from)) out.push({ from: o.from, to: byKey.get(keyOf(o.key)) });     // one entry per `from`: a check_not_enforced item sits in BOTH lists
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** The keys (canonical strings, the same form `compareChildren`'s `ambiguousKeys` takes) that appear more than once in a list of { originNode, originClass, textSha256 }: the NEW ROOT's own list, read by the loader. Pure. */
export function duplicateKeysOf(keys) {
  const count = new Map(); for (const k of keys) { const c = keyOf(k); count.set(c, (count.get(c) ?? 0) + 1); }
  return [...count].filter(([, n]) => n > 1).map(([c]) => c).sort();
}

/** The first acceptance or carried item of a side whose key repeats in some plan's list (null if none), and the plan's name for the sentence: 'R' is the root plan, any other origin node is that node's plan. */
const ambiguousHit = (side, ambiguous) => [...side.acceptance, ...side.carried].find(x => x.key && ambiguous.has(keyOf(x.key))) ?? null;
const planNameOf = originNode => (originNode === 'R' ? 'new root plan' : `plan of ${originNode}`);

/** One slot's row against ONE candidate (c.old / c.oldSide): the fixed order of reasons of the contract. `providerNotReused(path)` answers the transitive clause (compareChildren: from the rows already decided; comparePairs: never, the gate is applied by assignSlots). Pure. */
function rowFor(c, ambiguous, providerNotReused) {
  if (!c.newSide) return { node: c.node, slot: c.slot, fieldsSha256: null, verdict: 'changed', field: 'new_side', reason: `changed: the new child cannot be derived: ${c.newProblem ?? 'unknown'}` };
  const newC = canonicalSide(c.newSide);
  const fieldsSha256 = sha256Of(canonicalJson(comparedOf(newC)));
  const base = { node: c.node, slot: c.slot, fieldsSha256 };
  const changed = (field, reason, extra = {}) => ({ ...base, verdict: 'changed', field, reason: `changed: ${reason}`, ...extra });
  if (!c.old || !c.oldSide && !c.oldProblem) return changed('new_child', 'no earlier node of this path: a new run');
  if (c.oldProblem) return changed('old_side', `old inputs cannot be verified: ${c.oldProblem}`);
  if (c.eligible === false) return changed('ineligible', `${c.ineligibleWhy ?? 'the earlier node is not eligible for reuse'}`);
  if (c.wholeBranch !== true) { const own = firstDifference(canonicalSide(c.oldSide), newC); return changed('branch_not_whole', 'its branch is not whole', { ownFields: own ? { verdict: 'changed', field: own.field, reason: own.reason } : { verdict: 'same' } }); }
  if (ambiguousHit(c.newSide, ambiguous)) return changed('acceptance', `acceptance list is ambiguous (the ${planNameOf(ambiguousHit(c.newSide, ambiguous).key.originNode)} lists the same criterion more than once, so the identity map could not tell which one this child inherited)`);
  const diff = firstDifference(canonicalSide(c.oldSide), newC);
  if (diff) return changed(diff.field, diff.reason, { oldText: diff.oldText, newText: diff.newText });
  const notReused = (c.newSide.expects ?? []).find(providerNotReused);
  if (notReused !== undefined) return changed('provider', `provider ${notReused} is not reused`);
  return { ...base, verdict: 'same', field: null, reason: `same (scope identical; acceptance list identical: ${newC.acceptance.length} item${newC.acceptance.length === 1 ? '' : 's'}; refinements identical; agreements identical)`, adopts: { node: c.old.node, generation: c.old.generation, runId: c.old.runId }, identityMap: identityMapOf(c.oldSide, c.newSide) };
}

/** The verdicts for the direct children of a new split, in the order given (providers first). Pure; see the contract above. */
export function compareChildren({ children, ambiguousKeys }) {
  if (!Array.isArray(ambiguousKeys)) throw new TypeError('compareChildren: `ambiguousKeys` is required (the loader\'s newRootAmbiguousKeys, or [] when the new root lists nothing twice): without it the whole-root ambiguity check would be silently off');
  const ambiguous = new Set(ambiguousKeys);
  const rows = []; const verdictOf = new Map();
  for (const c of children) {
    const row = rowFor(c, ambiguous, p => verdictOf.get(p) !== 'same');
    verdictOf.set(c.node, row.verdict); rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the slot rule (C2a gate 1, C&C 14 Oct 2026)

const PAIR_SEP = '\u0000';
const pairKey = (slotNode, candidateKey) => `${slotNode}${PAIR_SEP}${candidateKey}`;
const slotLabel = s => `${s.node}@g${s.generation}`;

/**
 * Every (slot, candidate) pair compared on F1-F9 and the non-text gates (eligibility, wholeness, ambiguity, the old side), WITHOUT the provider gate (that depends on the assignment and is applied inside `assignSlots`). Candidates come from ANY path (relocation by content).
 *   slots       [{ node, generation, position, newSide, newProblem?, expects? }]   the slots of one children frontier, in the verified split's order
 *   candidates  [{ key: '<node>@g<n>', node, generation, runId, oldSide | null, oldProblem?, eligible?, ineligibleWhy?, wholeBranch }]   the held / kept nodes (each loaded against its OWN proposing parent)
 * -> Map<pairKey, row>. Pure.
 */
export function comparePairs({ slots, candidates, ambiguousKeys }) {
  if (!Array.isArray(ambiguousKeys)) throw new TypeError('comparePairs: `ambiguousKeys` is required');
  const ambiguous = new Set(ambiguousKeys); const out = new Map();
  for (const slot of slots) for (const cand of candidates) {
    const row = rowFor({ node: slot.node, slot: { node: slot.node, generation: slot.generation }, newSide: slot.newSide, newProblem: slot.newProblem, oldSide: cand.oldSide, oldProblem: cand.oldProblem ?? null, old: { node: cand.node, generation: cand.generation, runId: cand.runId }, eligible: cand.eligible !== false, ineligibleWhy: cand.ineligibleWhy ?? null, wholeBranch: cand.wholeBranch }, ambiguous, () => false);
    // OUTCOME (b) (Astra #15, C&C 14 Oct 2026): a candidate whose OWN inputs are unchanged but whose branch is not whole is adopted AS ITSELF (its plan and verified split are kept, its children are compared one by one at its children frontier). The pair is judged again as if the branch were whole.
    if (row.field === 'branch_not_whole' && row.ownFields?.verdict === 'same') {
      const selfRow = rowFor({ node: slot.node, slot: { node: slot.node, generation: slot.generation }, newSide: slot.newSide, oldSide: cand.oldSide, oldProblem: null, old: { node: cand.node, generation: cand.generation, runId: cand.runId }, eligible: true, wholeBranch: true }, ambiguous, () => false);
      if (selfRow.verdict === 'same') row.selfRow = selfRow;
    }
    out.set(pairKey(slot.node, cand.key), row);
  }
  return out;
}

/**
 * THE SLOT RULE (gate page C2a section 4): adopt the NEWEST FULLY ADOPTABLE candidate per slot, one candidate per slot and one slot per candidate, and say what became of EVERY candidate. Deterministic from its inputs (no clock, no model, no input-order dependence):
 *   adoptable pair = F1-F9 `same` and every gate passed (comparePairs); sorted by (the candidate's own path first, then a WHOLE branch before an as-itself one, then its NEWER generation, then the slot's position in the split, then the candidate key: C&C's ruling 14 Oct 2026, "newest FULLY adoptable", Astra #12) and taken greedily while both ends are free;
 *   the provider gate (a consumer whose supplier slot is not bound is not reused) is applied to a FIXED POINT: a violating pair is removed and the assignment redone, until nothing changes.
 * -> { bindings: [{ slot, candidate, row }], fates: [{ candidate, fate: 'adopted' | 'kept', slot?, reason }], slotFates: [{ slot, fate: 'reused' | 'new', candidate?, reason }] }, fates in the candidates' order and slotFates in the slots'. A kept candidate is NEVER dropped: it stays a candidate (a later frontier compares it again). Pure.
 */
export function assignSlots({ slots, candidates, pairs, adoptSelf = true }) {
  const slotOf = new Map(slots.map(s => [s.node, s]));
  const removed = new Map();     // pairKey -> the provider reason that removed it
  // `adoptSelf: false` (the wire, while C2b-3 is dropped): an as-itself adoption binds NOTHING, so it can neither take a slot nor stand as the supplier of a consumer that is then reused against it (BUG-B-003)
  const outcomeOf = row => (row.verdict === 'same' ? { outcome: 'whole', row } : adoptSelf && row.selfRow ? { outcome: 'self', row: row.selfRow } : null);
  const expectsOf = slot => slot.expects ?? slot.newSide?.expects ?? [];
  const adoptable = () => {
    const out = [];
    for (const slot of slots) for (const cand of candidates) {
      const k = pairKey(slot.node, cand.key); const raw = pairs.get(k); const o = raw && outcomeOf(raw);
      if (o && !removed.has(k)) out.push({ slot, cand, row: o.row, outcome: o.outcome, k });
    }
    return out.sort((a, b) => (Number(b.cand.node === b.slot.node) - Number(a.cand.node === a.slot.node)) || (Number(b.outcome === 'whole') - Number(a.outcome === 'whole')) || (b.cand.generation - a.cand.generation) || (a.slot.position - b.slot.position) || (a.cand.key < b.cand.key ? -1 : a.cand.key > b.cand.key ? 1 : 0));
  };
  // THE PROVIDER GATE, at run level (Astra #8, gate page section 7): a consumer is reused only when EVERY supplier slot it expects is bound, and bound to the very run its candidate was planned against (`dependsOn` pins { node, generation, runId }); a pin that no supplier slot
  // of this plan matches is a supplier the new plan does not provide. Fail closed: a supplier path that is not a slot of this frontier, or a candidate with no pins on record (`dependsOn` absent), is NOT reused (compareChildren reads an undecided provider the same way).
  const providerProblem = (b, bySlotNow) => {
    const expects = expectsOf(b.slot);
    if (!expects.length && !(b.cand.dependsOn ?? []).length) return null;
    for (const p of expects) {
      const occupant = bySlotNow.get(p);
      if (!occupant) return `provider ${p} is not reused`;
      if (!Array.isArray(b.cand.dependsOn)) return `provider ${p} cannot be checked (this node's suppliers are not on record)`;
      if (!b.cand.dependsOn.some(d => d.runId === occupant.cand.runId && d.node === occupant.cand.node && d.generation === occupant.cand.generation)) return `provider ${p} is not the run this plan was made against`;
    }
    // the runs a consumer may have been planned against: each supplier slot's occupant AND the nodes of that occupant's own branch (`branchPins`, tree-reuse-load.js; a consumer's `dependsOn` lists the provider's whole subtree, BUG-B-002). A candidate with no `branchPins` on record counts its own run only
    const filled = new Set(expects.flatMap(p => { const o = bySlotNow.get(p); return o ? [o.cand.runId, ...(o.cand.branchPins ?? []).map(d => d.runId)] : []; }));
    const stray = (b.cand.dependsOn ?? []).find(d => !filled.has(d.runId));
    return stray ? `it was planned against ${stray.node}@g${stray.generation}, which no supplier slot of this plan reuses` : null;
  };
  let bindings;
  for (;;) {
    const takenSlots = new Set(); const takenCands = new Set(); bindings = [];
    for (const p of adoptable()) if (!takenSlots.has(p.slot.node) && !takenCands.has(p.cand.key)) { takenSlots.add(p.slot.node); takenCands.add(p.cand.key); bindings.push(p); }
    const bySlotNow = new Map(bindings.map(b => [b.slot.node, b]));
    const bad = bindings.map(b => ({ b, why: providerProblem(b, bySlotNow) })).filter(x => x.why);
    if (!bad.length) break;
    for (const { b, why } of bad) removed.set(b.k, why);
  }
  const bySlot = new Map(bindings.map(b => [b.slot.node, b])); const byCand = new Map(bindings.map(b => [b.cand.key, b]));
  const ranked = cand => slots.map(slot => ({ slot, row: pairs.get(pairKey(slot.node, cand.key)) })).filter(x => x.row)
    .sort((a, b) => (Number(b.slot.node === cand.node) - Number(a.slot.node === cand.node)) || (a.slot.position - b.slot.position));
  const fates = candidates.map(cand => {
    const b = byCand.get(cand.key);
    if (b) return { candidate: cand.key, fate: 'adopted', outcome: b.outcome, slot: slotLabel(b.slot), moved: b.slot.node !== cand.node, code: b.outcome === 'self' ? 'self' : 'same', reason: b.outcome === 'self' ? 'adopted as itself: its own inputs are unchanged but its branch is not whole; its children are compared one by one' : b.row.reason };
    if (!slots.length) return { candidate: cand.key, fate: 'kept', slot: null, code: 'no_slot', reason: 'the new plan has no slot for it' };
    const rows = ranked(cand);
    const lost = rows.find(x => outcomeOf(x.row));
    if (lost) {
      const k = pairKey(lost.slot.node, cand.key);
      if (removed.has(k)) return { candidate: cand.key, fate: 'kept', slot: slotLabel(lost.slot), code: pairs.get(k)?.field ?? 'changed', reason: `changed: ${removed.get(k)}` };
      const winner = bySlot.get(lost.slot.node);
      return { candidate: cand.key, fate: 'kept', slot: slotLabel(lost.slot), code: 'slot_filled', reason: `slot ${slotLabel(lost.slot)} was filled by ${winner.cand.key}` };
    }
    const best = rows[0];
    if (!best) return { candidate: cand.key, fate: 'kept', slot: null, code: 'not_compared', reason: 'it was not compared with any slot' };
    return { candidate: cand.key, fate: 'kept', slot: slotLabel(best.slot), code: best.row.field ?? 'changed', reason: best.row.reason };
  });
  const slotFates = slots.map(slot => {
    const b = bySlot.get(slot.node);
    if (b) return { slot: slotLabel(slot), fate: 'reused', candidate: b.cand.key, reason: b.row.reason };
    return { slot: slotLabel(slot), fate: 'new', candidate: null, reason: candidates.length ? 'no finished candidate fits it: a new run' : 'no earlier node of this path: a new run' };
  });
  return { bindings: bindings.map(b => ({ slot: slotLabel(b.slot), candidate: b.cand.key, outcome: b.outcome, row: b.row })), fates, slotFates };
}
