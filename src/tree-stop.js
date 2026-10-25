// The texts a PERSON reads at a stop (0.8.3 M5a; PLAN 8.2, 8.4, 8.6). PURE: a deterministic string from plain data, no file, no clock, no model. Each text is what `requestGate` hashes and writes, so the person approves exactly
// these words; M6's `tree status` shows the same renderers. They are code-built DATA for a person, not prompts for a seat (C&C, 8 Oct): plain words, figures with their basis, no claim that anything is better or worse.
//
// The frontier text names the first PREFIX_LEN characters of the frontier key; the person types them before the gate is answered (PLAN 8.2), so what must be typed is inside the hashed text.
import { terminalSafe } from './terminal-safe.js';
import { ceilCents } from './tree-budget.js';

export const PREFIX_LEN = 8;
export const prefixOf = key => String(key).slice(0, PREFIX_LEN);

/** The pool line for money held on a spend nobody can read (R9): null when none. `b`: { unknownSpendHeldUsd, unknownSpendNodes } (src/tree-budget.js budgetOf). Not spend: the PLAN 7.1 sum does not include it. */
export const unknownSpendLine = b => (b?.unknownSpendHeldUsd > 0 ? `held for unknown spend: ${money(b.unknownSpendHeldUsd)} (${b.unknownSpendNodes} closed node${b.unknownSpendNodes === 1 ? ' whose run folder is' : 's whose run folders are'} gone)` : null);

/** Dollars as a person reads them: two decimals, four below one cent so a small figure is not shown as $0.00. */
export const money = n => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.abs(n) > 0 && Math.abs(n) < 0.01 ? n.toFixed(4) : n.toFixed(2)}` : 'unknown');

const indent = (text, pad) => String(text).split('\n').map(l => (l ? `${pad}${l}` : l)).join('\n');
const quoted = text => indent(String(text).replace(/\s+$/, ''), '      | ');
/**
 * A person's typed reason as the readers show it (S8-8 commit 3; the stop screen, `tree status` and TREE_HANDOFF.md): control and bidi characters removed (terminalSafe), EVERY line behind the quote marker (an empty one too), so a line that reads "## Decisions"
 * or "----- end -----" inside the reason is a quoted line and starts nothing. -> the lines joined by newlines, no trailing newline.
 */
export const quotedReason = text => terminalSafe(text).replace(/\s+$/, '').split('\n').map(l => `      | ${l}`).join('\n');
/** A refused child's reason already begins "not admitted: " (tree-frontier.js, tree-budget.js); a line that carries its own NOT ADMITTED label prints the rest, so the label appears once. A reason without the prefix (and a null) comes back as it was. */
export const notAdmittedWords = reason => (typeof reason === 'string' ? reason.replace(/^not admitted: /, '') : reason);

// (The three choices PLAN 6.3 words for a held item are NOT printed: two of them had no command behind them. C&C ruling, 8 Oct 2026, accepted as a deviation: the text says only what exists. ROADMAP 43.)

function priceLine(chain) {
  if (!chain) return 'Price: price pending preparation (no dry-run figure for this chain yet)';
  const f = chain.figures;
  if (!f) return `Chain ${chain.name}: price pending preparation (no dry-run figure for this chain yet)`;
  // bundle unit (19 Okt 2026, Muad's yes on the line "priced for an input of up to 100 KB"; KB = 1000 bytes, the unit of the tree's allowance): the figures are priced for an input of that size
  const size = Number.isInteger(f.inputBytes) && f.inputBytes > 0 ? (f.inputBytes >= 1000 ? `${Math.round(f.inputBytes / 1000)} KB` : `${f.inputBytes} bytes`) : null;
  return `Price: ${money(f.cheapestUsd)} cheapest end, ${money(f.expectedUsd)} expected, ${money(ceilCents(f.atMostUsd))} upper estimate (${size ? `priced for an input of up to ${size}; an estimate from a dry run` : 'a task-less estimate from a dry run'}, not a measured cost)`;
}

/**
 * The text of `council tree approve` for one frontier. `view`:
 *   frontierKey, parent { node, generation, runId, results: [{ item, ok, words }] (PLAN 5.5 items 1-4 as checked), splitSha256 }, openedBy: [{ id, text }] (a replacement frontier's opening decisions, verbatim)
 *   children: [{ node, generation, milestone, scope, chain { name, figures | null }, grant (the proposed amount), ceiling, admitted, notAdmittedReason,
 *               mayStop (grant below the chain's at-most figure), inherited: [{ origin, text }], refinements: [text], provides: [{ id, to, what, check }], expects: [{ id, from, what, check }],
 *               refused: [{ guard, text, origin }], notEnforced: [{ id, check, text }], lints: [{ id, message }] }]
 *   budget { rootCapUsd, spentUsd, heldUsd, availableUsd }, limits [{ limit, count, effective }], unexpanded: [milestone ids still `decompose` and not in this frontier]
 */
export function renderFrontierText(view) {
  if (view.kind === 'root_replan') return renderRootReplanText(view);
  const L = [];
  const p = view.parent;
  const root = view.rootId ?? '<rootId>';
  L.push(`Approve the next set of child runs?   (frontier ${prefixOf(view.frontierKey)})`);
  L.push('This is the next set of child plans the tree would start. Nothing is started or paid until you approve.', '');
  L.push('The plan that was split');
  L.push(`  Node ${p.node}, generation ${p.generation}, run ${p.runId}`);
  for (const r of p.results) L.push(`  ${r.ok ? 'ok' : 'NOT OK'}: ${r.words} (plan 5.5, item ${r.item})`);
  L.push(`  The split block: sha256 ${p.splitSha256}`);
  if (view.openedBy?.length) {
    L.push('', 'This set replaces earlier generations. It was opened by this decision, word for word:');
    for (const d of view.openedBy) L.push(`  decision ${d.id}:`, quoted(d.text));
  }
  L.push('', `Children (${view.children.length})`);
  view.children.forEach((c, i) => {
    L.push('', `  ${i + 1}. ${c.node} generation ${c.generation} (milestone ${c.milestone})`);
    L.push(`     Scope: ${c.scope}`);
    L.push(`     Chain: ${c.chain?.name ?? 'unknown'}`);
    L.push(`     ${priceLine(c.chain)}`);
    if (c.registered) L.push(`     ALREADY REGISTERED (${c.registered.phase}), ${['closed', 'stopped'].includes(c.registered.phase) ? 'granted' : 'holding'} ${money(c.registered.heldUsd)} (run ${c.registered.runId}); it keeps the grant it has; this approval adds no new money for it and does not size it again.`);
    else if (c.reused) {
      // C3 step b: the per-child line is the pass-2 wording (E48, Fable>Astra>Fable) when the comparison's reason is at hand; the moved-from line is B-DRAFT (the Delta note, section 4)
      const r = c.reused;
      L.push(c.reuseNote?.kind === 'reused'
        ? `     ${c.node}: ${c.reuseNote.reason}: REUSED: no new run and no new spend; run ${r.runId} and its spend${c.reuseNote.spentUsd === null ? '' : ` ${money(c.reuseNote.spentUsd)}`} carried.`
        : `     REUSED: the finished run ${r.runId} fills this slot. No new run is started and no new spend is added for it; what the run already spent stays counted toward the tree's cap.`);       // B-DRAFT (C2b-2): only when the reason is not at hand
      if (r.adoptsNode !== c.node) L.push(`     That run was ${r.adoptsNode} generation ${r.adoptsGeneration} in the earlier plan.`);       // B-DRAFT (C3 b)
    } else {
      if (c.reuseNote?.kind === 'changed') L.push(`     ${c.node}: ${c.reuseNote.reason}: a NEW run${c.admitted ? ` (grant ${money(c.grant)})` : ''}.`);       // pass-2 wording (E48)
      L.push(c.admitted ? `     Proposed grant: ${money(c.grant)}, never more than ${money(c.ceiling)} (a grant issued later may be lower, never higher)` : '     No grant (not admitted)');
      L.push(`     ${c.admitted ? 'Admitted.' : `NOT ADMITTED: ${notAdmittedWords(c.notAdmittedReason)}`}`);
    }
    if (c.mayStop) L.push(`     May stop before finishing: yes (the grant is below the chain's upper estimate).`);
    // C&C 12 Oct (the ceiling finding, rulings row 126): a grant EQUAL to the ceiling is not a promise to finish - the at-most figure rests on the chain's ASSUMED prompt sizes, not on the real plan, so a longer plan or more
    // criteria can stop the run at its grant. Derived from the view's two figures in cents (no new field, nothing in boundSha256).
    else if (!c.registered && c.admitted && Math.round(c.ceiling * 100) > 0 && Math.round(c.grant * 100) >= Math.round(c.ceiling * 100)) L.push(`     May stop before finishing: possibly (the grant equals the chain's upper estimate, but that figure rests on the chain's assumed prompt sizes, not on the real plan: a longer plan or more criteria can stop the run at its grant; then raise it with \`council tree decide ${root} --top-up ${c.node} --amount <usd>\`).`);
    L.push('     Inherited obligations, word for word, with their origin:');
    if (!c.inherited.length) L.push('       (none)');
    for (const o of c.inherited) L.push(`       - [${o.origin}] ${o.text}`);
    if (c.refinements?.length) { L.push('     Added for this plan:'); for (const r of c.refinements) L.push(`       - ${r}`); }
    L.push('     Agreements it provides:', ...(c.provides.length ? c.provides.map(a => `       - ${a.id} to ${a.to}: ${a.what} | check: ${a.check}`) : ['       (none)']));
    L.push('     Agreements it expects:', ...(c.expects.length ? c.expects.map(a => `       - ${a.id} from ${a.from}: ${a.what} | check: ${a.check}`) : ['       (none)']));
    for (const l of c.lints ?? []) L.push(`     Note (not a stop): ${l.id}: ${l.message}`);
  });
  const held = view.children.flatMap(c => [...(c.refused ?? []).map(r => ({ c, kind: 'guard', ...r })), ...(c.notEnforced ?? []).map(r => ({ c, kind: 'check', ...r }))]);
  if (held.length) {
    L.push('', 'Items held at this stop');
    for (const h of held) {
      if (h.kind === 'guard') L.push(`  ${h.c.node}: refused by ${h.guard}, carried in context only: ${h.text}`);
      else L.push(`  ${h.c.node}: ${h.id} has a check this chain will not enforce: ${h.check} (item: ${h.text})`);
    }
    L.push('  Approving admits every child above with these items carried in context only: the tree then needs a person-recorded result for each before it can be ready.');
    L.push(`  Not approving starts nothing. To stop here: council tree stop ${root} (nothing further starts; you can resume later).`);
  }
  L.push('', 'Money and limits');
  L.push(`  Root cap ${money(view.budget.rootCapUsd)}; spent so far ${money(view.budget.spentUsd)}; held for running children ${money(view.budget.heldUsd)}; still available ${money(view.budget.availableUsd)}.`);
  if (unknownSpendLine(view.budget)) L.push(`  ${unknownSpendLine(view.budget)}.`);
  for (const l of view.limits) L.push(`  ${l.limit}: ${l.count} of ${l.effective}`);
  const refused = view.children.filter(c => !c.admitted);                          // a registered child is admitted by construction (src/tree-frontier.js), so it never lands here
  if (refused.length) {
    L.push('', 'Not admitted, and why');
    for (const c of refused) L.push(`  ${c.node} generation ${c.generation}: ${c.notAdmittedReason}`);
    // R17: a raise is accepted only at a limit stop, so the hint names it only when a refused child was refused BY a limit (a stale, budget or price refusal has no limit to raise)
    if (refused.some(c => c.refusedLimit)) L.push(`  A limit can be raised only by you, after seeing this: council tree decide ${root} --max-runs|--max-depth|--max-children <n> (a raise never changes the root cap).`);
  }
  if (view.unexpanded?.length) L.push('', `Milestones still to expand later: ${view.unexpanded.join(', ')}`);
  // what the approval authorizes in total: the sum of the grants printed above (the same numbers the approval's hash binds)
  if (view.passedOver?.length) {
    L.push('', 'Earlier finished runs this plan does not use. They stay kept; a later plan can use one again only if the run fits that plan exactly as it stands:');       // B-DRAFT (C3 b)
    for (const p of view.passedOver) L.push(`  - ${p.key}${p.slot ? ` (compared with ${p.slot})` : ''}: ${p.reason}`);
  }
  const fresh = view.children.filter(c => c.admitted && !c.registered && !c.reused);
  const total = Math.round(fresh.reduce((n, c) => n + c.grant, 0) * 10000) / 10000;
  L.push('', fresh.length ? `Approving authorizes up to ${money(total)} of new paid runs (the sum of the NEW grants above, each shown rounded to the cent; already registered children are not counted).` : view.children.some(c => c.reused) ? /* B-DRAFT (C2b-2): the sentence with 'reused'; the old sentence below is byte-identical */ 'Approving authorizes no new paid runs (every child above is already registered, reused or not admitted). A registered run that has not finished keeps its grant and may still spend it.' : view.children.some(c => c.registered) ? 'Approving authorizes no new paid runs (every child above is already registered or not admitted).' : 'Approving authorizes no new paid runs (no child above is admitted).');
  L.push('', `To approve, type the first ${PREFIX_LEN} characters of the frontier key: ${prefixOf(view.frontierKey)}`);
  return `${L.join('\n')}\n`;
}

/**
 * The text of `council tree approve` for a ROOT replacement (S8-5; design note 8.2). `view`: kind 'root_replan', frontierKey, rootId, generation (the new root's), previous { generation, runId }, openedBy [{ id, text }],
 * taskHash, child { chain { name, figures | null }, grant, ceiling, admitted, notAdmittedReason, mayStop, refusedLimit }, setAside (nodes of the earlier plan that are dead), held (nodes held for the release), budget, limits.
 */
function renderRootReplanText(view) {
  const L = [];
  const c = view.child;
  const root = view.rootId ?? '<rootId>';
  L.push(`Start a NEW ROOT run (R@g${view.generation})?   (frontier ${prefixOf(view.frontierKey)})`);
  L.push('This is the new root plan of the tree. Nothing is started or paid until you approve.', '');
  L.push('It was decided by this decision, word for word:');
  for (const d of view.openedBy) L.push(`  decision ${d.id}:`, quoted(d.text));
  L.push('', `The new root run`);
  L.push(`  Node R, generation ${view.generation} (it replaces R@g${view.previous.generation}, run ${view.previous.runId})`);
  L.push(`  Chain: ${c.chain?.name ?? 'unknown'}`);
  L.push(`  ${priceLine(c.chain)}`);
  L.push(c.admitted ? `  Proposed grant: ${money(c.grant)}, never more than ${money(c.ceiling)} (a grant issued later may be lower, never higher)` : '  No grant (not admitted)');
  L.push(`  ${c.admitted ? 'Admitted.' : `NOT ADMITTED: ${notAdmittedWords(c.notAdmittedReason)}`}`);
  if (c.mayStop) L.push(`  May stop before finishing: yes (the grant is below the chain's upper estimate).`);
  else if (c.admitted && Math.round(c.ceiling * 100) > 0 && Math.round(c.grant * 100) >= Math.round(c.ceiling * 100)) L.push(`  May stop before finishing: possibly (the grant equals the chain's upper estimate, but that figure rests on the chain's assumed prompt sizes, not on your plan: a longer plan or more criteria can stop the run at its grant; a larger grant is \`council tree decide ${root} --top-up R --amount <usd>\`).`);
  if (view.oldPlan?.form === 'data') L.push('', `An input, as DATA: the earlier root plan R@g${view.previous.generation} (${view.oldPlan.bytes} bytes, sha256 ${view.oldPlan.sha256}) goes to the writer of the new plan, marked as not to be followed. The new root plan is planned from the same task (sha256 ${view.taskHash}) and your decision above.`);       // A-DRAFT
  else L.push('', `Not an input: the earlier root plan. The new root plan is planned afresh from the same task (sha256 ${view.taskHash}) and your decision above.`);
  L.push(`The earlier plan R@g${view.previous.generation} and ${view.setAside > 1 ? `${view.setAside - 1} other node${view.setAside - 1 === 1 ? '' : 's'}` : 'nothing else'} are set aside and stay counted.`);
  // the held nodes hang under the plan being replaced (the common case: the sentence is unchanged), or under OLDER root plans (held from an earlier re-plan, across this one): then the screen says which (X4 fix-up, 13 Oct 2026)
  const unknown = view.heldUnknown ?? 0;
  const heldUnder = Array.isArray(view.heldEras) && (unknown > 0 || (view.heldEras.length && !view.heldEras.every(e => e === view.previous.generation))) ? view.heldEras.map(e => `R@g${e}`) : null;
  const below = !heldUnder ? 'the earlier plan'
    : !heldUnder.length ? 'an earlier root plan (the record does not say which one)'
    : `${heldUnder.length === 1 ? 'the earlier root plan' : 'the earlier root plans'} ${heldUnder.join(' and ')}${view.heldEras.includes(view.previous.generation) || unknown > 0 ? '' : ` (not below R@g${view.previous.generation}, the plan being replaced)`}${unknown > 0 ? ` (and, for ${unknown} of them, a root plan the record does not identify)` : ''}`;
  if (view.held) L.push(`${view.held} finished node${view.held === 1 ? ' is' : 's are'} held below ${below}; they stay held until you approve the new root plan's children (checking them for reuse comes in a later step).`);
  L.push('', 'Money and limits');
  L.push(`  Root cap ${money(view.budget.rootCapUsd)}; spent so far ${money(view.budget.spentUsd)}; held for running children ${money(view.budget.heldUsd)}; still available ${money(view.budget.availableUsd)}.`);
  if (unknownSpendLine(view.budget)) L.push(`  ${unknownSpendLine(view.budget)}.`);
  for (const l of view.limits) L.push(`  ${l.limit}: ${l.count} of ${l.effective} (the new root counts as a run)`);
  if (!c.admitted && c.refusedLimit) L.push(`  A limit can be raised only by you, after seeing this: council tree decide ${root} --max-runs|--max-depth|--max-children <n> (a raise never changes the root cap).`);
  L.push('', c.admitted ? `Approving authorizes up to ${money(c.grant)} of new paid runs (the grant above, shown rounded to the cent).` : 'Approving authorizes no new paid run (the new root run is not admitted).');
  L.push('', `To approve, type the first ${PREFIX_LEN} characters of the frontier key: ${prefixOf(view.frontierKey)}`);
  return `${L.join('\n')}\n`;
}

/**
 * A limit stop (PLAN 8.6): which limit, its count and effective value, the open work, and a rough added cost. `view`: { limit ('maxRuns' | 'maxDepth' | 'maxChildrenPerSplit'), count, effective, initial,
 * raises: [{ from, to }], open: [{ node, scope }] (children not admitted, scope verbatim), unexpanded: [milestone], perChild: { name, atMostUsd } | null, wouldAdmit (how many a raise by one admits), budget }.
 */
export function renderLimitStop(view) {
  const L = [`A limit stops the tree: ${view.limit} is ${view.count} of ${view.effective}.`, ''];
  L.push(`Started at ${view.initial}${view.raises?.length ? `; raised ${view.raises.map(r => `${r.from} -> ${r.to}`).join(', ')}` : ''}.`);
  L.push('', 'Open work');
  if (!view.open.length) L.push('  (no child is waiting)');
  for (const o of view.open) L.push(`  ${o.node}: ${o.scope}`);
  if (view.unexpanded?.length) L.push(`  Milestones still unexpanded: ${view.unexpanded.join(', ')}`);
  if (view.perChild?.atMostUsd != null) {
    const n = view.wouldAdmit ?? 1;
    L.push('', `A rough added cost: ${n} more child${n === 1 ? '' : 'ren'} x ${money(ceilCents(view.perChild.atMostUsd))} (${view.perChild.name}, upper estimate) = ${money(n * ceilCents(view.perChild.atMostUsd))}. That is a task-less estimate, not a measured cost.`);
  } else L.push('', 'A rough added cost: not yet priced (no dry-run figure for the child chain).');
  L.push(`The root cap stays ${money(view.budget.rootCapUsd)} whatever you decide; ${money(view.budget.availableUsd)} is still available under it.`);
  if (unknownSpendLine(view.budget)) L.push(`${unknownSpendLine(view.budget)}.`);
  L.push('', `To raise it: council tree decide ${view.rootId ?? '<rootId>'} --${view.flag} <n> with n above ${view.effective}. Leaving it as it is ends this part of the tree incomplete, with this limit as the reason.`);
  return `${L.join('\n')}\n`;
}

/** A registered child that has not started: the grant it holds is held until it starts or a person closes it (M5e S6). `items`: [{ node, generation, runId, grantUsd }]. */
export function renderHeldChildren(items, rootId = '<rootId>') {
  return items.map(i => `${i.node} is registered but has not started: it holds a grant of ${money(i.grantUsd)} (run ${i.runId}) until it starts or a person closes it (\`council tree decide ${rootId} --close ${i.node}\`).`);
}
/** A frontier closed under a changed parent (M5e S6). `items`: [{ frontierKey }]. */
export function renderParentChanged(items, rootId = '<rootId>') {
  return items.map(i => `Frontier ${prefixOf(i.frontierKey)} was closed under a changed parent: the plan it was approved on is no longer the one the run holds, and nothing under it starts until you approve it again (\`council tree approve ${rootId}\`).`);
}
/**
 * The two `split_changed` refusals (0.8.3 M6 S0 b; src/tree-split-changed.js reads them). `items`: [{ kind: 'verified', node, generation, verified, now } | { kind: 'frontier', frontierKey, verified, now }], the hashes short or null.
 * (B) a node verified once and verified again against another plan: the first verification stands and NO approval is waiting, so no command is named. (C) `tree approve` itself found the record naming another split than the plan holds: it says so and what the command does, no route. (A) an approval that showed another split: a new approval is the remedy.
 */
export function renderSplitChanged(items, rootId = '<rootId>') {
  return items.map(i => (i.kind === 'approve_refused'
    ? `${i.node}@g${i.generation}: the split recorded as verified${i.verified ? ` (${i.verified})` : ''} is not the block its plan holds now${i.now ? ` (${i.now})` : ''}; \`council tree approve\` refuses its frontier while they differ.`
    : i.kind === 'verified'
    ? `${i.node}@g${i.generation}: its plan changed after it was verified${i.verified && i.now ? ` (verified split ${i.verified}, plan now ${i.now})` : ''}. The first verification stands; nothing new is verified from this plan and no approval is waiting on it.`
    : `Frontier ${prefixOf(i.frontierKey)}: the plan changed after the approval was shown${i.verified && i.now ? ` (approved split ${i.verified}, plan now ${i.now})` : ''}. Nothing under it starts until you approve it again (\`council tree approve ${rootId}\`).`));
}
/** A guard refusal for a node that was derived and never registered: it is NOT a refusal of a running child, the node was "derived, not admitted" (M5e S6). `items`: [{ node, generation, guard, item }]. */
export function renderDerivedNotAdmitted(items) {
  return items.map(i => `${i.node}@g${i.generation} was derived, not admitted: the guard ${i.guard} refused the item "${i.item}" and the node was not registered.`);
}

/** A finding's name as a person reads it: a key shape by its name, a personal-data finding as `personal data (<type>)`. */
const findingLabel = name => (String(name).startsWith('pii:') ? `personal data (${String(name).slice(4).replace(':', ', ')})` : String(name));

/**
 * A stop on a child that was NEVER REGISTERED (S5b part B, source `bundle_input`): its derived input holds text the run would be refused. `view`: { stopId, node, generation, onRoot, parent: { node, generation }, findings: [{ file, line, name }],
 * carriers: [{ node, generation }], affected: [{ node, finished }], rootId }. Nothing was registered, started or spent; the one way on is to regenerate the node whose text carries it. Names the shape and the place, never the value.
 */
export function renderBundleInputStop(view) {
  const key = n => `${n.node} generation ${n.generation}`;
  const L = [`Stop ${view.stopId}: ${view.node} generation ${view.generation} was not registered and nothing was started or spent: the input its run would read holds text the run would be refused for.`, ''];
  L.push('What was found (the kind and the place, never the value):', ...view.findings.map(f => `  - ${f.file}${f.line === null ? '' : ` line ${f.line}`}: ${findingLabel(f.name)}`));
  L.push('', 'Whose text it is:');
  if (!view.carriers.length) L.push(`  - ${view.parent.node} generation ${view.parent.generation}, the parent: the task or its own plan carries it`);
  for (const c of view.carriers) L.push(`  - ${key(c)}${c.node === view.parent.node ? ', the parent: its own plan carries it' : ', a finished node: its plan or a decision of its subtree carries it'}`);
  L.push('', 'Affected by this stop');
  for (const a of view.affected) L.push(`  ${a.node}${a.finished ? ' (finished, now stale)' : ' (not started, now stale)'}`);
  L.push('', 'Spent: $0.00. Nothing was registered, so no money is held for it.');
  // the nodes a regenerate would run again: the carriers (the parent among them when its own text carries it), else the parent
  const names = [...new Set((view.carriers.length ? view.carriers : [view.parent]).map(c => c.node))];
  L.push(view.onRoot
    ? `A new root plan is a new paid run: council tree approve then shows its price and its cap, and nothing is spent before you approve it. The finished sub-plans that passed are not thrown away: they are held, and when you approve the new root plan's children each is checked for reuse. ${view.node} was never registered: the new root plan decides its own children.`
    : `Regenerating ${names.join(', ')}, which ${names.length === 1 ? 'is' : 'are'} finished, runs ${names.length === 1 ? 'it' : 'them'} again and spends money under a new approval: council tree approve shows the price and the cap, and nothing is spent before you approve it.`);
  L.push('', 'You can:', view.onRoot
    ? `  - answer it with a NEW ROOT plan: council tree decide ${view.rootId} --stop ${view.stopId}`
    : `  - regenerate what it affects: council tree decide ${view.rootId} --stop ${view.stopId}`,
  `  - close ${view.node} without ever starting it ($0; what waits for it starts only if it is replaced): council tree decide ${view.rootId} --close ${view.node}`,
  ...(view.allowPii ? [`  - allow personal data of these types in this sub-plan, after seeing where it sits (${view.allowPii.join(', ')} only): council tree decide ${view.rootId} --allow-pii-node ${view.node}@g${view.generation}`] : []));
  return `${L.join('\n')}\n`;
}

/**
 * The stop of a child a person CLOSED BEFORE IT EVER STARTED (c3b; the blocked-child rule applies to it like to any closed-incomplete child, C&C ruling 1): no run, no handoff, nothing spent. `view`: { stopId, node, generation,
 * affected: [{ node, finished }], rootId }. The one way on is a new generation of the child.
 */
export function renderClosedUnstartedStop(view) {
  const L = [`Stop ${view.stopId}: ${view.node} generation ${view.generation} was closed before it started, by your decision: nothing ran and nothing was spent ($0.00); what waits for it starts only if it is replaced.`, ''];
  L.push('Affected by this stop');
  for (const a of view.affected) L.push(`  ${a.node}${a.finished ? ' (finished, now stale)' : ' (not started, now stale)'}`);
  L.push('', 'You can:', `  - regenerate what it affects (a new generation of ${view.node}): council tree decide ${view.rootId} --stop ${view.stopId}`);
  return `${L.join('\n')}\n`;
}

/**
 * The integration stop a sitting wrote because the process that recorded the failed check ended before it wrote the stop (check-fail wedge). `view`: { stopId, agreement, affected: [{ node, generation }], rootId }.
 * The words after "Stop" are the ones `council tree status` and `decide` already use for an integration stop; the first sentence says why it appears only now.
 */
export function renderIntegrationStopRecovered(view) {
  const L = [`Stop ${view.stopId}: the integration check of ${view.agreement} was recorded as FAILED, but its stop was not written then. The stop is open now.`, ''];
  L.push('It stops these nodes', ...(view.affected.length ? view.affected.map(a => `  ${a.node}@g${a.generation}`) : ['  (none)']));
  L.push('', 'You can:', `  - regenerate what it affects: council tree decide ${view.rootId} --stop ${view.stopId}`);
  return `${L.join('\n')}\n`;
}

/** A failed integration check whose stop cannot be written because a file does not read (check-fail wedge; fail closed). `view`: { agreement, reason, files, rootId }. */
export function renderIntegrationStopUnreadable(view) {
  const files = view.files.filter(f => !f.startsWith('undefined/'));
  // E74(a) (M7, pass-2: "the plan is <runId>/deliverable.md, the report <runId>/report.json"): the real run ids, plan first. A reason that names only reports (several nodes' report.json) has no plan to name: "the reports are ..." (B-DRAFT, the one departure from pass-2's shape)
  const plans = files.filter(f => f.endsWith('/deliverable.md')); const reports = files.filter(f => f.endsWith('/report.json'));
  const where = [...(plans.length ? [`the plan is ${plans.join(' and ')}`] : []), ...(reports.length ? [reports.length === 1 ? `the report ${plans.length ? '' : 'is '}${reports[0]}` : `the reports are ${reports.join(' and ')}`] : [])].join(', ');
  return [`The integration check of ${view.agreement} was recorded as FAILED, but its stop was not written: ${view.reason}.`,
    `The failure stays recorded and the tree stays blocked.${files.length ? ` Restore the ${reports.length > 1 && !plans.length ? 'files' : 'file'} named above (${where}, in the runs folder), then run \`council tree resume ${view.rootId}\` again: the stop is written then.` : ` Restore what could not be read, then run \`council tree resume ${view.rootId}\` again: the stop is written then.`}`, ''].join('\n');
}

/**
 * A needs_decision stop (PLAN 8.4). `view`: { stopId, node, generation, status ('needs_decision'), whatThisIs (the handoff's text, verbatim), provides: [...], expects: [...],
 * affected: [{ node, why, finished }] , stale: [node], spentUsd, releasedUsd, independent: [node still runnable], rootAffected }.
 */
export function renderNeedsDecisionStop(view) {
  // M6 (owner's yes, row 116): a child the tree cannot count is a stop too - it says what blocks it, in the readiness rule's own words
  const L = view.blockedBy?.length
    ? [`Stop ${view.stopId}: ${view.node} generation ${view.generation} finished, and the tree cannot count it:`, ...view.blockedBy.map(b => `  - ${b.code}: ${b.text}`),
      // C&C 12 Oct (rulings row 129; answer 1, the Muad-approved recommendation): the accounting gate reads every run folder's report.json, the replaced generation's too. Restoring the file is the better fix and is named FIRST; when
      // the usage files beside it give a figure, a typed acceptance of that figure is the second route; when they do not, there is nothing to accept and only the restore lifts it.
      ...(view.blockedBy.some(b => b.code === 'report_unreadable') ? [`  Restore the report.json of ${view.node} first: the accounting gate reads every run folder, so regenerating cannot go on (the replacement cannot be approved) while that file does not read.${view.reportAcceptable ? ` If it cannot be restored, \`council tree decide ${view.rootId} --accounting ${view.node}\` accepts, as a typed decision, the figure the usage files beside it give: the tree then counts at least that for ${view.node}.` : ' The usage files beside it do not give a figure either, so there is nothing a typed acceptance could cover.'}`] : []),
      // E170 (M7 apply, pass-2 final wording): the restore hint for a changed or missing plan file; --accept-plan exists (E172)
      ...(view.blockedBy.some(b => b.code === 'plan_unreadable') ? [`  Put deliverable.md of ${view.node} back exactly as the run wrote it (in that run's folder): the next \`council tree resume\` closes this stop by itself when the plan text matches what was recorded (and, where a contract check failed, when that check passes again), and says so. A file that was changed is not closed that way: its answers are a new plan (regenerate), abandon, or accepting the change: \`council tree decide ${view.rootId} --accept-plan --stop ${view.stopId}\`.`] : []), '']
    : view.person
    // S8-8 commit 3: a stop the PERSON opened on a finished root plan: nothing ended with a status; the words are the person's own, quoted (49(c) of the E list)
    ? [`Stop ${view.stopId}: you opened this stop on ${view.node} generation ${view.generation}${view.person.at ? ` at ${view.person.at}` : ''}.`, 'Your reason, word for word:', quotedReason(view.person.reason ?? ''), 'The plan is not changed by this stop.', '']
    : [`Stop ${view.stopId}: ${view.node} generation ${view.generation} ended with the Status needs_decision.`, ''];
  L.push('What it says it is, word for word:', quoted(view.whatThisIs ?? '(the handoff has no text under "What this is")'));
  // 2b (gate page 12.3a): the words above are the run's own handoff of the text the panel signed; when the record accepted a changed plan for this node, say which file is which
  if (view.acceptedPlan) L.push(`(That is the run's own handoff of the text the run produced. This node's plan was accepted by ${view.acceptedPlan.actor === 'person' ? 'a person' : view.acceptedPlan.actor === 'session' ? 'the session' : 'someone'}${view.acceptedPlan.via ? ` (${view.acceptedPlan.via})` : ''} after the run and is not signed by the panel.)`);
  L.push('', 'Agreements it provides:', ...(view.provides.length ? view.provides.map(a => `  - ${a.id} to ${a.to}: ${a.what}`) : ['  (none)']));
  L.push('Agreements it expects:', ...(view.expects.length ? view.expects.map(a => `  - ${a.id} from ${a.from}: ${a.what}`) : ['  (none)']));
  L.push('', 'Affected by this stop');
  for (const a of view.affected) L.push(`  ${a.node}${a.finished ? ' (finished, now stale)' : ''}: ${a.why}`);
  L.push('', `Spent on it so far ${money(view.spentUsd)}; its unspent share ${money(view.releasedUsd)} went back to the pool; its spend stays counted.`);
  L.push(`Independent work that can still run: ${view.independent.length ? view.independent.join(', ') : '(none)'}`);
  if (view.rootAffected) L.push('', 'The ROOT is affected: the tree cannot become ready and every child stops at its next pause or end. The root plan is never rewritten. You can resolve a root milestone the split marks needs-decision, or start a new root run yourself.');
  // M5e S6: the routes are built from the STOP (view.routes), because the forms refuse the others: a root stop is answered in place or by a NEW ROOT plan (S8: the root re-plan form); a child stop is regenerated, and resolved in place only when its split
  // has a needs-decision milestone. A view without routes (the M5a fixtures) keeps the general sentence.
  if (Array.isArray(view.routes)) L.push('', 'You can:', ...view.routes.map(r => `  - ${r}`));
  else L.push('', 'You can: resolve a needs-decision milestone in place (decide --milestone <id>), regenerate the affected set (decide), widen it to one obligation (--obligation), or leave the branch incomplete.');
  return `${L.join('\n')}\n`;
}
