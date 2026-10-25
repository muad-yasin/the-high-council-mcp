// The stop-answering forms of `council tree decide` (0.8.3 M5d, sub-commit 5; PLAN 8.4, 8.5 rows 4 and 11, 10.1): `--milestone <id>` (resolve in place) and no option (regenerate), with `--stop <stopId>` and
// `--obligation <qualified id>`. Both record a DECISION: text the person types at the terminal BEFORE the gate text is built, so the gate shows it word for word and the record holds exactly those bytes.
//   - The text is typed, never a flag or a file or an environment variable (a flag would put it in shell history and let a script answer for a person); a non-interactive stdin is refused plainly.
//   - The prompt ends at a line holding only a dot. Whitespace-only is empty and refused. The size is capped (DECISION_MAX_BYTES) and checked WHILE reading, before any text is built.
//   - terminalSafe is applied to the typed decision on the way in, and again (idempotent) to the whole gate text built from it and the plan's own words (R8); that exact decision string is in the gate text and in decision_recorded.text.
//   - Every precondition that needs no text is checked FIRST (an open stop, an unambiguous id), so nobody types a long decision and is then refused.
// In M5d the stops are the ones the record holds (hand-appended in tests; M5e writes them from a closed node), `regenerate` writes the decision and nothing else (the generation it authorizes is opened by recovery on the
// next command, PLAN 8.5), and `--obligation` is validated and RECORDED on the decision: the set of nodes the decision re-plans is the stop's recorded set; carriers of the obligation are not added yet (M5e).
import { dashFence } from './text-fence.js';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { terminalSafe, terminalSafeMarked } from './terminal-safe.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, treeDirOf, withTreeLock } from './tree-record.js';
import { lockHolder } from './run-lock.js';
import { SITTING_LOCK_FILE } from './tree-files.js';
import { readPlanOf } from './tree-derive-load.js';
import { affectedFor } from './tree-affected.js';
import { carrierNodesOf, resolveObligation } from './tree-obligation.js';
import { MAX_CONTEXT_FILE_BYTES } from './context-files.js';
import { bundleAllowanceBytesOf, bundleInputBytes, ceilCents, effectiveLimits } from './tree-budget.js';
import { deadKeys, ineligibleBelowRoot, keepRefusal, latestGenerationOf, obligationOriginOf, racingNodeOf, racingRefusalOf, subplanAffectedWanted } from './tree-transitions.js';
import { activeNodeWords } from './tree-close.js';
import { regenerateDecisionEvent, stopDecisionBase } from './tree-decision-event.js';
import { newPlanInputBytes } from './tree-decide-size.js';
import { nodesToVerify } from './tree-loop.js';
import { rootBundle, rootReplanPreflight } from './tree-root-replan.js';
import { chooseOldPlan, oldPlanOf } from './old-plan.js';
import { hiddenIn } from './hidden-chars.js';

/**
 * The most bytes one decision may hold: 16 KiB (16384). Derivation: a decision is copied verbatim into the context.md of every node it re-plans and of every consumer of a resolved milestone (src/tree-derive.js parts 6
 * and 7), and a context file may hold 2,000,000 bytes in all (src/context-files.js MAX_CONTEXT_FILE_BYTES) next to the parent's plan and the other decisions. 16 KiB is about 4,000 words, 0.82% of that limit: more than a
 * person decides in a terminal, and fifty of them still use under half of it. It also keeps the gate text a person has to read in one sitting.
 */
export const DECISION_MAX_BYTES = 16384;
export const END_LINE = '.';

/** Reads the decision text from a terminal until a line holding only a dot. -> { text } | { error }. Nothing else is read from stdin; the reader is closed before the gate opens its own. */
/**
 * The person-facing words of `readDecisionText`, as functions of the byte limit: the DEFAULTS are the accepted M5d words, byte for byte (test/tree-person-stop.test.js pins them); S8-8 hands its own for a reason a person types.
 */
export const DECISION_WORDS = Object.freeze({
  intro: maxBytes => `Type your decision. It is recorded word for word (at most ${maxBytes} bytes). End it with a line holding only a dot (${END_LINE}).`,
  prompt: 'decision: ',
  empty: 'the decision is empty',
  tooLong: maxBytes => `the decision is longer than ${maxBytes} bytes`,
  hidden: code => `the decision holds an invisible character (${code}) that you cannot see on the screen; type it again without it`,   // audit item 7, commit 2b (E 180, held)
});
export function readDecisionText({ stdin, stdout, maxBytes = DECISION_MAX_BYTES, words = DECISION_WORDS }) {
  return new Promise(resolve => {
    stdout.write(`${words.intro(maxBytes)}\n`);
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const lines = []; let bytes = 0; let done = false;
    const finish = r => { if (done) return; done = true; rl.close(); resolve(r); };
    rl.setPrompt(words.prompt);
    rl.on('line', line => {
      if (done) return;
      const l = line.replace(/\r$/, '');
      if (l === END_LINE) {
        const text = terminalSafe(lines.join('\n')).replace(/\s+$/, '');
        if (text.trim() === '') return finish({ error: words.empty });
        // audit item 7, commit 2b: text a PERSON types is refused when it holds a hidden character (the author rewrites it; C&C 14 Oct 2026); the quiet joiners and the soft hyphen stay allowed. Controls and bidi marks were removed above, as before.
        const bad = hiddenIn(text, { allowQuiet: true });
        if (bad) return finish({ error: (words.hidden ?? DECISION_WORDS.hidden)(bad.code) });
        return finish({ text });
      }
      bytes += Buffer.byteLength(l, 'utf8') + 1;
      if (bytes - 1 > maxBytes) return finish({ error: words.tooLong(maxBytes) });
      lines.push(l);
    });
    rl.on('close', () => finish({ error: `the input ended before the closing line (${END_LINE}); nothing was recorded` }));
    rl.prompt();
  });
}

const openStopEvents = (record, state) => state.openStops.map(id => record.events.find(e => e.id === id)).filter(Boolean);
const describeStop = e => `${e.id} (${e.source ?? 'a stop'}${e.node ? `, ${e.node}@g${e.generation ?? 1}` : ''})`;

/**
 * Which open stop this invocation answers: --stop <id>, or the only open one. -> { stop } | { refusal }. `owner` ({ node, generation }) restricts the choice for a resolution in place (PLAN 8.4): it answers ONLY the stop
 * of the node whose split marks the milestone needs-decision (the stop that node's Status opened), never another node's.
 */
export function chooseStop(record, state, stopArg, owner = null) {
  const all = openStopEvents(record, state);
  if (!all.length) return { refusal: 'no stop is open: there is nothing to decide' };
  const mine = owner ? all.filter(e => e.node === owner.node && e.generation === owner.generation) : all;
  // the ROOT (C&C Q2): one resolution of a root milestone answers EVERY open stop of the root, bound in one decision (else answering one would use the milestone up and leave the others only a paid root re-plan)
  const coversOthers = (primary, pool) => (owner?.node === 'R' ? pool.filter(e => e !== primary) : []);
  const whose = owner ? `of ${owner.node}@g${owner.generation}, the node whose split holds the milestone` : '';
  if (stopArg !== undefined) {
    const s = all.find(e => e.id === stopArg);
    if (!s) return { refusal: `--stop ${stopArg}: that is not an open stop (open: ${all.map(describeStop).join(', ')})` };
    if (owner && !mine.includes(s)) return { refusal: `--stop ${stopArg}: ${s.node ? `that is the stop of ${s.node}@g${s.generation ?? '?'}` : 'that is an integration stop, which belongs to no node'}; a milestone is resolved in place only through the stop ${whose}` };
    return { stop: s, covers: coversOthers(s, mine) };
  }
  if (!mine.length) return { refusal: `no open stop ${whose || 'to answer'} (a milestone is resolved in place only through that node's own stop; open: ${all.map(describeStop).join(', ')})` };
  if (mine.length > 1 && owner?.node === 'R') return { stop: mine[0], covers: coversOthers(mine[0], mine) };
  if (mine.length > 1) return { refusal: `${mine.length} stops are open${owner ? ` ${whose}` : ''} (${mine.map(describeStop).join(', ')}); name the one this answers with --stop <id>` };
  return { stop: mine[0] };
}

const MILESTONE_ID = '[A-Za-z][A-Za-z0-9_-]*';
const QUALIFIED = new RegExp(`^(R(?:/${MILESTONE_ID})*)@g([1-9][0-9]*):(${MILESTONE_ID})$`);

/** The milestones a person could resolve in place: every `needs-decision` milestone in the split block of a closed node, not yet resolved. */
export function openMilestones(record, state, runsDir) {
  const resolved = new Set(record.events.filter(e => e.event === 'milestone_resolved').map(e => `${e.node}@g${e.generation}:${e.milestone}`));
  const out = [];
  for (const n of [...state.nodes.values()].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation))) {
    if (n.phase !== 'closed') continue;
    const block = readPlanOf(runsDir, n).block;
    for (const m of block?.milestones ?? []) {
      if (m.status !== 'needs-decision') continue;
      const key = `${n.node}@g${n.generation}:${m.id}`;
      out.push({ key, node: n.node, generation: n.generation, milestone: m.id, basis: m.basis ?? '', question: m.open_question ?? '', resolved: resolved.has(key) });
    }
  }
  return out;
}

/** PLAN 10.1: a milestone is addressed by its owning node and generation (`R/M2@g1:M1`); a bare id only when it names exactly one. -> { milestone } | { refusal }. */
export function chooseMilestone(record, state, runsDir, arg) {
  const all = openMilestones(record, state, runsDir);
  const qualified = QUALIFIED.exec(String(arg));
  const matches = qualified ? all.filter(m => m.key === arg) : all.filter(m => m.milestone === arg);
  if (!matches.length) return { refusal: `--milestone ${arg}: no needs-decision milestone of that name in this tree${all.some(m => !m.resolved) ? ` (open: ${all.filter(m => !m.resolved).map(m => m.key).join(', ')})` : ''}` };
  if (matches.length > 1) return { refusal: `--milestone ${arg} is ambiguous: ${matches.map(m => m.key).join(', ')}; name one as <node>@g<n>:<id>. Nothing was changed` };
  if (matches[0].resolved) return { refusal: `--milestone ${arg}: ${matches[0].key} is already resolved` };
  return { milestone: matches[0] };
}

/** --obligation <node>@g<n>:<id>: resolved to the obligation's ORIGIN by identity (src/tree-obligation.js); an unknown id or node refuses before any gate. -> { obligation, origin, cls } | { refusal }. */
export function chooseObligation(record, state, runsDir, arg) {
  if (arg === undefined) return { obligation: null, origin: null, cls: null };
  const r = resolveObligation({ record, state, runsDir, arg });
  return r.refusal ? r : { obligation: r.label, origin: r.origin, cls: r.cls };
}

/** The unresolved needs-decision milestones of ONE node (qualified ids): what could answer that node's stop in place. */
export function milestoneKeysOf(record, state, runsDir, node, generation) {
  return openMilestones(record, state, runsDir).filter(m => m.node === node && m.generation === generation && !m.resolved).map(m => m.key);
}

/** What can answer a ROOT stop IN PLACE (a resolution; a new root plan answers it too, S8-4): the root's unresolved needs-decision milestones, as qualified ids; empty means only a new root plan can answer it. */
export function rootRemedies(record, state, runsDir) {
  return openMilestones(record, state, runsDir).filter(m => m.node === 'R' && !m.resolved).map(m => m.key);
}

/**
 * Builds one stop decision from a decision text already typed. -> { refusal } | { text, expect, formName, after, apply, typedLabel }. Run again after the yes: nothing in it asks anybody. `form` is 'regenerate' or 'milestone'.
 */
export function buildStopDecision({ rootDir, rootId, form, milestoneArg, stopArg, obligationArg, decisionText, changesProvides = null, work = null, sittingHeld = null, fresh = false, fromRecommendation = null, fromSessionDraft = null, allowBytes = null, offerRaise = false }) {
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) return { refusal: `the record of this tree does not read (${record.corrupt.length} problem${record.corrupt.length === 1 ? '' : 's'}); nothing can be decided on it` };
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  if (form === 'keep') return buildKeep({ rootDir, rootId, record, state, runsDir, keepArg: milestoneArg, stopArg, decisionText });
  let ms = null;
  if (form === 'milestone') { const r = chooseMilestone(record, state, runsDir, milestoneArg); if (r.refusal) return r; ms = r.milestone; }
  const s = chooseStop(record, state, stopArg, ms ? { node: ms.node, generation: ms.generation } : null); if (s.refusal) return s;
  // A blocked-child stop (src/tree-blocked-child.js) has exactly ONE answer: a new generation of the child. Resolving a milestone in place would leave the node at its generation, still blocked (C&C, 11 Oct).
  if (form === 'milestone' && [s.stop, ...(s.covers ?? [])].some(e => e.source === 'blocked')) { const b = [s.stop, ...(s.covers ?? [])].find(e => e.source === 'blocked'); return { refusal: `stop ${b.id} is a ${b.node === 'R' ? 'blocked-root' : 'blocked-child'} stop: it has one answer, ${b.node === 'R' ? 'a new root plan' : 'a new generation of the child'}: \`council tree decide ${rootId ?? '<rootId>'} --stop ${b.id}\`. Nothing was changed` }; }
  const ob = chooseObligation(record, state, runsDir, obligationArg); if (ob.refusal) return ob;
  const asksProvides = ms !== null && ms.node !== 'R';      // the root provides to no sibling: it is not asked
  if (asksProvides && changesProvides !== false) return { refusal: changesProvides === true ? `this changes what ${ms.node} provides to a sibling: use the regenerate form (council tree decide ${rootId ?? '<rootId>'})` : `${ms.node} is a stopped child: whether the answer changes what it provides to a sibling must be answered (no) first` };
  const stop = s.stop; const covers = s.covers ?? [];
  // R12 (C&C): a node's stop stands for ALL its needs-decision milestones, so the LAST one answers it. `remaining`: the others of this node@generation still unresolved. A non-final answer records the milestone and releases nothing.
  const remainingOf = (rec, st) => (ms ? openMilestones(rec, st, runsDir).filter(m => m.node === ms.node && m.generation === ms.generation && !m.resolved && m.key !== ms.key).map(m => m.milestone) : []);
  const remaining = remainingOf(record, state);
  const blockNamed = form === 'milestone' && record.events.some(e => e.event === 'blocked' && e.reason === 'root_affected' && [stop, ...covers].some(c => c.id === e.stopId));      // a root_affected block that names one of the stops this answers
  // S8-4 (rulings row 130, REVERSING PLAN 8.4's "the root is never regenerated"): a regenerate answer to a stop of the ROOT is a root re-plan (design note 8.1, round 2: the finished and passed nodes below are HELD, the rest set aside)
  if (allowBytes !== null && !(form === 'regenerate' && stop.node === 'R')) return { refusal: '--allow-size belongs to a new root plan for a stop of the root only' };
  if (fromSessionDraft !== null && !(form === 'regenerate' && stop.node === 'R')) return { refusal: 'a session draft belongs to a new root plan for a stop of the root only' };
  if (form === 'regenerate' && stop.node === 'R') return buildRootReplan({ rootDir, rootId, record, state, runsDir, stop, decisionText, obligationArg, ob, work, sittingHeld, fresh, fromRecommendation, fromSessionDraft, allowBytes, offerRaise });
  // bundle unit step 2 (slot route): an ordinary regenerate of a sub-plan offers the stopped plan to the writer of the new one as data (default), or --fresh leaves it out; an obligation answer carries no earlier plan
  const ordinaryRegen = form === 'regenerate' && !ob.obligation;
  if (!ordinaryRegen && fresh) return { refusal: `--fresh: it belongs to the answer that plans a node again, with no obligation named` };
  let oldChoice = null;
  if (ordinaryRegen) {
    oldChoice = chooseOldPlan({ rootDir, node: state.nodes.get(`${stop.node}@g${stop.generation}`), fresh, lenient: true });
    if (oldChoice.refusal) return { refusal: oldChoice.refusal };
  }
  // the node whose NEW plan receives it: the slot the stopped node fills when it is reused finished work (the adoption lapses once this decision is recorded, so the target is fixed NOW, from what the person is shown), else the stopped node itself
  const oldTarget = state.adopted?.get(`${stop.node}@g${stop.generation}`)?.slot?.replace(/@g\d+$/, '') ?? stop.node;
  if (oldChoice?.oldPlan.form === 'data') oldChoice.oldPlan.node = oldTarget;
  const oldPlanLine = !oldChoice ? '' : oldChoice.oldPlan.form === 'data'
    ? `\nThe earlier plan of ${stop.node}@g${stop.generation} (${oldChoice.oldPlan.bytes} bytes, sha256 ${oldChoice.oldPlan.sha256}) goes to the writer of the new plan of ${oldTarget} as DATA, marked as not to be followed. Add --fresh to leave it out.`       // A-DRAFT
    : `\nThe earlier plan of ${stop.node}@g${stop.generation} is left out${oldChoice.note ? ` (${oldChoice.note})` : ' (--fresh)'}: the new plan is written without it.`;       // A-DRAFT
  let affected = (stop.affected ?? []).map(a => ({ node: a.node, generation: a.generation }));
  // an OBLIGATION decision (regenerate form) widens the set to the nodes that carry the obligation, found by identity, with their closure; the closure starts from the carriers only. Root-origin => the root is carried: root_affected.
  const rootOrigin = form === 'regenerate' && ob.origin?.node === 'R';
  if (form === 'regenerate' && ob.origin) {
    const carriers = carrierNodesOf({ record, state, origin: ob.origin });       // C2b-ob: nodes, so an adopted carrier is the one widened to, not the new node of its path
    if (!carriers.length) return { refusal: `--obligation ${obligationArg}: no node of this tree carries it` };
    const wide = affectedFor({ record, state, runsDir, node: stop.node, obligationCarriers: carriers, seedless: true }).affected;
    const keyOf = a => `${a.node}@g${a.generation}`;       // C2b-ob: by NODE, not path: the adopted node and the new node of its old path are two entries, and one must not overwrite the other
    const own = new Map(affected.filter(a => rootOrigin || a.node !== 'R').map(a => [keyOf(a), a]));
    for (const a of wide) own.set(keyOf(a), a);
    affected = [...own.values()].sort((x, y) => (x.node < y.node ? -1 : x.node > y.node ? 1 : x.generation - y.generation));
  }
  // K1, the sub-plan route (M7 apply, C2a-record commit 2): an ordinary regenerate (no obligation) lists the nodes it REPLACES (the stopped node and its consumers) and the nodes below them that cannot be held; the finished, passed ones below are KEPT for the new plan's reuse check, not listed.
  // The table binds the same function (subplanAffectedWanted), and the apply below re-derives it under the lock, so what the person read is what is recorded.
  const ordinary = form === 'regenerate' && !ob.obligation;
  const stopSet = (stop.affected ?? []).map(a => `${a.node}@g${a.generation}`);
  if (ordinary) affected = subplanAffectedWanted(state, stop.id);
  // SG-1 PREFLIGHT (C&C 23 Okt 2026, Q1 + Q4; same shape as rootReplanPreflight, so the person is refused BEFORE they type): a sub-plan regenerate is refused while a sitting of the tree holds its lock (it could pick up an approved frontier and start a registered child while the record sets it aside) and while a node at or under a listed one has a PROCESS (running or in a post-run call). A registered, never-started node has none. The table row refuses the same race again at the record.
  if (form === 'regenerate') {
    const held = typeof sittingHeld === 'function' ? sittingHeld() : lockHolder(treeDirOf(rootDir), { file: SITTING_LOCK_FILE }) !== null;
    if (held) return { refusal: 'a sitting of this tree is running: nothing was changed; wait for it to end' };       // the root route's sentence (tree-root-replan.js), A-DRAFT here too
    const listedKeys = affected.map(a => `${a.node}@g${a.generation}`);
    // the PHASE decides (racingNodeOf: a node the record says runs is refused whatever its process does); the WORDS follow what --close can really do for it (activeNodeWords, src/tree-close.js; the same words as the root re-plan's preflight, A-DRAFT, C&C 23 Okt 2026): a node whose process is gone is told to resume, or to answer, or to give up, not always "close it"
    const racingNode = racingNodeOf(state, listedKeys, {});
    const racing = racingNode ? ((racingNode.gone && activeNodeWords({ state, runsDir: dirname(rootDir), key: racingNode.key, route: 'a sub-plan regenerate', record })) || racingRefusalOf(state, listedKeys, {}, { rootId })) : null;
    if (racing) return { refusal: racing };
  }
  // OVERSIZE AT DECIDE (0.8.3 SG-1 unit; C&C thcmcp-cd 23 Okt 2026: "refuse at decide, in the same shape as the root route, for BOTH the terminal and the MCP session route"; the root route does it below, in buildRootReplan). Until now a sub-plan's input was measured only when its
  // replacement REGISTERED, so a person could approve a decision and then a frontier only to see the new child stop with a bundle_input finding. The what-if (src/tree-decide-size.js) folds the record this decision WOULD leave (the decision and its generation_opened built by the
  // REAL builders: regenerateDecisionEvent, src/tree-decision-event.js; openingOf, src/tree-recovery.js:51) and derives the new plan's input as registration does (loadDerivation + deriveChild, src/tree-loop.js), then compares it with the allowance registration uses
  // (bundleAllowanceBytesOf). A sub-plan has no --allow-size (that belongs to a new ROOT plan). Every caller passes `work` today (tree-decide.js:625, tree-decide-session.js:81 and :94, stopPreflight below); a caller without it, or a what-if that cannot be built, SAYS so on the
  // screen (the cause in the line) and registration stays the backstop: fail-open on a UX pre-check, loudly.
  let sizeNote = '';
  if (ordinary) {
    const maxBytes = bundleAllowanceBytesOf(record.tree);
    const sized = newPlanInputBytes({ rootDir, record, runsDir, work, decisionArgs: { decisionText, affected, form, stop, covers, gateId: 'what-if', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal', obligation: undefined } });
    if (!sized.ok) sizeNote = `\nThe size of the new plan's input could not be checked now (${sized.why}); it is checked again before the plan starts.`;
    else {
      for (const [node, bytes] of sized.byNode) if (bytes > maxBytes) return { refusal: `the new plan of ${node}: its input would be about ${bytes} bytes, over the ${maxBytes} this tree's approval was priced for: give a shorter decision` };
      if (sized.skipped.length) sizeNote = `\nThe size of the new plan's input could not be checked now for ${sized.skipped.map(x => x.node).join(', ')} (${[...new Set(sized.skipped.map(x => x.why))].join('; ')}); it is checked again before ${sized.skipped.length === 1 ? 'that plan starts' : 'those plans start'}.`;
      // the earlier plan offered as data adds its own bytes to the slot that receives it: the existing sentence (give a shorter decision, or leave the earlier plan out with --fresh)
      if (oldChoice?.oldPlan.form === 'data') {
        const again = chooseOldPlan({ rootDir, node: state.nodes.get(`${stop.node}@g${stop.generation}`), fresh, lenient: true, restBytes: sized.byNode.get(oldTarget) ?? null, maxBytes });
        if (again.refusal) return { refusal: again.refusal };
      }
    }
  }
  // already-false unit (K1): only a node the record holds and that is live can be "kept". The stop's set also names the split's planned children that never registered (tree-affected.js adds them for the stale marks): they are neither finished nor passed.
  const deadNow = deadKeys(state);
  const keptByIt = ordinary ? stopSet.filter(k => !affected.some(a => `${a.node}@g${a.generation}` === k) && state.nodes.has(k) && !deadNow.has(k)).sort() : [];
  const affectedLines = affected.length ? affected.map(a => `  - ${a.node}@g${a.generation}`).join('\n') : '  (none recorded)';
  // B-DRAFT (M7 apply, regenerate of a reused node, option 4): a listed node that fills a slot of a newer plan. Planning it again plans the SLOT again; the finished run stops filling it. Nothing is added when no listed node is reused.
  const reusedLines = form === 'milestone' ? '' : affected.filter(a => state.adopted?.has(`${a.node}@g${a.generation}`)).map(a => `\n${a.node}@g${a.generation} is reused finished work: it fills the slot ${state.adopted.get(`${a.node}@g${a.generation}`).slot.replace(/@g\d+$/, '')}. Recording this plans that slot again, and the finished run no longer fills it.`).join('');
  const typed = form === 'milestone' ? ms.key : stop.id;
  const head = form === 'milestone'
    ? `Resolve ${ms.key} in place${remaining.length ? '' : `, answering ${covers.length ? `EVERY open stop of the root (${[stop, ...covers].map(describeStop).join(', ')})` : `stop ${describeStop(stop)}`}`}?\nThe milestone's question: ${ms.question || '(none)'}\nIts basis: ${ms.basis || '(none)'}`
    : `Answer stop ${describeStop(stop)} with a new plan?   (regenerate)`;
  const effect = form === 'milestone'
    ? `Recording it: the decision text is kept with ${ms.key} (the plan stands unchanged; the milestone counts as resolved)${remaining.length
      ? `. ${remaining.map(r => `${ms.node}@g${ms.generation}:${r}`).join(', ')} ${remaining.length === 1 ? 'is' : 'are'} still unresolved: the stop stays open; nothing is released (no stop is answered, no stale mark is cleared${blockNamed ? ', the root_affected block stays' : ''}). Resolve ${remaining.length === 1 ? 'it' : 'them'} the same way; the last one answers ${covers.length ? 'every open stop of the root' : 'the stop'}.`
      : `, and ${covers.length ? 'the stops listed above are' : 'this stop is'} answered: ${covers.length ? 'their' : 'its'} stale marks are cleared${blockNamed ? ' and the root_affected block they stand for is lifted' : ''}. Stops of other nodes and other marks are untouched.`}${asksProvides ? `\nDoes this answer change anything ${ms.node} provides to a sibling? You answered: no.` : ''}`
    : `Recording it: the decision text is kept and this stop is answered. The nodes it concerns ${ordinary ? 'are the ones it replaces (the stopped node and what depends on it) and the ones below them that cannot be kept (not finished and passed, or with a stop open)' : ob.origin ? 'are the ones that carry the obligation, with what depends on them' : 'are exactly the ones the stop recorded'}:\n${affectedLines}\nThey stay marked stale (they are being replaced); nothing is started or registered by recording it.${keptByIt.length ? `\nKept for the new plan, not replaced (finished and passed; they are not started again and what they spent stays counted):\n${keptByIt.map(k => `  - ${k}`).join('\n')}` : ''}${reusedLines}`;   // B-DRAFT (M7 apply, C2a-record commit 2): the "kept" paragraph and the new first clause, for the Fable pass
  const rootKeys = rootOrigin ? rootRemedies(record, state, runsDir) : [];
  const obText = !ob.obligation ? '' : form === 'milestone'
    ? `\nThe stop is recorded as being about the obligation ${ob.obligation}. That is recorded with the decision only: nothing regenerates when a milestone is resolved in place, so no other node is touched.`
    : `\nThe stop is about the obligation ${ob.obligation} (found by its origin, not by a list position).${rootOrigin ? `\nThe ROOT carries this obligation. Recording this blocks the whole tree (root_affected): every child stops at its next pause or end. A ROOT stop is opened for it, and only that stop clears the block, by ${rootKeys.length ? `\`council tree decide ${rootId ?? '<rootId>'} --milestone ${rootKeys.join('` or `--milestone ')}\` (the root's split marks ${rootKeys.length === 1 ? 'it' : 'them'} needs-decision)` : 'a NEW ROOT RUN: the root\'s split has no needs-decision milestone, so that is the only route'}. The root itself is never regenerated.` : '\nThe root does not carry it, so no block is written and the root is untouched.'}`;
  const text = `${head}\n\nYour decision, word for word (${Buffer.byteLength(decisionText, 'utf8')} bytes):\n----- decision -----\n${decisionText}\n----- end -----\n\n${effect}${obText}${oldPlanLine}${sizeNote}\n\nTo approve, type the ${form === 'milestone' ? 'milestone id' : 'stop id'}: ${typed}\n`;
  return {
    text: terminalSafeMarked(text), expect: typed, typedLabel: form === 'milestone' ? 'the milestone id' : 'the stop id',
    formName: form === 'milestone' ? `resolve ${ms.key} in place (stop${covers.length ? 's' : ''} ${[stop, ...covers].map(c => c.id).join(', ')})` : `decision for stop ${stop.id}`,
    after: form === 'milestone' ? (remaining.length ? `${ms.key} is resolved; the stop stays open until ${remaining.map(r => `${ms.node}@g${ms.generation}:${r}`).join(', ')} ${remaining.length === 1 ? 'is' : 'are'} resolved too.` : `${ms.key} is resolved and ${covers.length ? `the stops ${[stop, ...covers].map(c => c.id).join(', ')} are` : `stop ${stop.id} is`} answered.`) : `Stop ${stop.id} is answered. Nothing else was changed now.`,
    apply: ({ gateId, shownSha256, actor, via, reason, planMode }) => withTreeLock(rootDir, () => {
      // re-checked UNDER the lock, before the first append: the milestone form writes two events, and a stop answered or a milestone resolved since the rebuild must not leave a decision with no resolution behind
      const now = readTreeRecord(rootDir); const st = stateOf(now);
      const gone = reason => { throw new TreeRefusal({ code: 'continuation_refused', transition: 'decision_recorded', reason }); };
      if (!st.openStops.includes(stop.id)) gone(`stop ${stop.id} is no longer open`);
      if (ordinary && JSON.stringify(subplanAffectedWanted(st, stop.id)) !== JSON.stringify(affected)) gone('the nodes this decision concerns changed while you read; run the command again to see them');
      if (form === 'milestone' && now.events.some(e => e.event === 'milestone_resolved' && `${e.node}@g${e.generation}:${e.milestone}` === ms.key)) gone(`${ms.key} is already resolved`);
      if (form === 'milestone' && JSON.stringify(remainingOf(now, st)) !== JSON.stringify(remaining)) gone(`the milestones still unresolved for ${ms.node}@g${ms.generation} changed while you read`);
      // an obligation the ROOT carries: the ROOT stop and the sticky block FIRST, the decision LAST, all in this one hold (a crash after the decision but before the block would leave the tree unblocked); idempotent per originating stop
      if (rootOrigin) {
        const rootNode = st.nodes.get(`R@g${[...st.nodes.values()].filter(x => x.node === 'R').reduce((g, x) => Math.max(g, x.generation), 1)}`);
        let rootStop = now.events.find(e => e.event === 'needs_decision_opened' && e.source === 'obligation' && e.originStopId === stop.id);
        if (!rootStop) rootStop = appendTreeEventLocked(rootDir, { event: 'needs_decision_opened', node: rootNode.node, generation: rootNode.generation, runId: rootNode.runId, source: 'obligation', originStopId: stop.id, obligation: ob.obligation, affected }, {});
        if (!now.events.some(e => e.event === 'blocked' && e.reason === 'root_affected' && e.stopId === rootStop.id)) appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', stopId: rootStop.id, detail: `the root carries the obligation ${ob.obligation} that stop ${stop.id} is about` }, {});
      }
      if (form === 'milestone') for (const c of covers) if (!st.openStops.includes(c.id)) gone(`stop ${c.id} is no longer open`);
      const decisionArgs = { decisionText, affected, form, stop, covers, gateId, shownSha256, actor, via, reason, planMode, obligation: ob.obligation };
      const base = stopDecisionBase(decisionArgs);
      if (oldChoice?.oldPlan.form === 'data' && oldPlanOf({ rootDir, node: st.nodes.get(`${stop.node}@g${stop.generation}`) }).sha256 !== oldChoice.oldPlan.sha256) gone('the earlier plan changed while you read: nothing was recorded');
      if (form === 'regenerate') return appendTreeEventLocked(rootDir, regenerateDecisionEvent(decisionArgs, oldChoice));
      const d = appendTreeEventLocked(rootDir, { event: 'decision_recorded', ...base, node: ms.node, generation: ms.generation, milestone: ms.milestone });
      return appendTreeEventLocked(rootDir, { event: 'milestone_resolved', node: ms.node, generation: ms.generation, milestone: ms.milestone, decisionId: d.id, remaining, ...(asksProvides ? { changesProvides: false } : {}) });
    }),
    rootId, milestoneNode: ms ? ms.node : null,
  };
}

/**
 * The KEEP form (C&C thcmcp-6d, Muad 19 Okt 2026): `council tree decide <root> --keep <node>@g<n>` accepts a finished run that ended with the Status needs_decision AS IT IS: the stop is answered, its marks released, nothing regenerates, and the node then counts as finished work that can be reused.
 * node_closed stops ONLY (keepRefusal, ONE function with the table row): never a bundle_input (personal-data) stop, a blocked-child stop or any other source. A node whose plan has a needs-decision milestone is answered with --milestone, not here. All sentences are B-DRAFT.
 * -> { refusal } | { text, expect, typedLabel, formName, after, apply, rootId, milestoneNode }.
 */
function buildKeep({ rootDir, rootId, record, state, runsDir, keepArg, stopArg, decisionText }) {
  const m = /^(R(?:\/[A-Za-z][A-Za-z0-9_-]*)*)@g([1-9]\d*)$/.exec(String(keepArg ?? ''));
  if (!m) return { refusal: `--keep ${JSON.stringify(keepArg ?? null)}: name the finished run to accept, as <node>@g<n> (for example R/M1@g1)` };
  const node = m[1]; const generation = Number(m[2]);
  const key = `${node}@g${generation}`;
  const stopId = stopArg ?? state.openStops.find(id => { const sm = state.stopMeta.get(id); return sm?.node === node && sm?.generation === generation && sm?.source === 'node_closed'; });
  if (!stopId) return { refusal: `--keep ${key}: there is no open stop for ${key} from a finished run that ended with the Status needs_decision` };
  const milestonesOf = () => openMilestones(record, state, runsDir).filter(x => x.node === node && x.generation === generation).map(() => ({ status: 'needs-decision' }));
  const bad = keepRefusal(state, { stopId, node, generation }, { milestonesOf });
  if (bad) return { refusal: `--keep ${key}: ${bad}` };
  const text = `Accept ${key} as it is?   (keep)\nIts Status stays needs_decision on the record. Accepting it means that Status no longer holds back the nodes that wait for it. A later plan may reuse the run if it fits that plan as it stands. Other open stops still apply. Recording this decision regenerates nothing and spends nothing; any paid run that follows starts only with \`council tree resume\`.\n\nYour reason, word for word (${Buffer.byteLength(decisionText, 'utf8')} bytes):\n----- reason -----\n${decisionText}\n----- end -----\n\nTo approve, type the node: ${key}\n`;       // B-DRAFT
  return {
    text: terminalSafeMarked(text), expect: key, typedLabel: 'the node', formName: `accept ${key} as it is (stop ${stopId})`,
    after: `${key} is accepted as it is; stop ${stopId} is answered.`,       // B-DRAFT
    apply: ({ gateId, shownSha256, actor, via, reason }) => withTreeLock(rootDir, () => {
      const now = readTreeRecord(rootDir); const st = stateOf(now);
      const again = keepRefusal(st, { stopId, node, generation }, { milestonesOf: () => openMilestones(now, st, runsDir).filter(x => x.node === node && x.generation === generation).map(() => ({ status: 'needs-decision' })) });
      if (again) throw new TreeRefusal({ code: 'continuation_refused', transition: 'decision_recorded', reason: again });
      return appendTreeEventLocked(rootDir, { event: 'decision_recorded', text: decisionText, affected: [], form: 'keep', stopId, node, generation, gateId, shownSha256, actor, via, ...(reason ? { reason } : {}) });
    }),
    rootId, milestoneNode: null,
  };
}

/**
 * The root re-plan form (S8-4; design note 8.1 with the round-2 wording; contract M6_HeldState_Contract_2026-10-12.md). Needs `work` and `sittingHeld` (the decide handler builds them: this file must not import the sitting). Everything that needs no text is
 * refused before the person types (src/tree-root-replan.js rootReplanPreflight + the unverified-split guard); the decision lists EXACTLY R@g and the nodes that cannot be held (`ineligibleBelowRoot`, the table recomputes it), the text shows that very set
 * (the handler rebuilds the form after the approval and refuses when the text differs) and `apply` re-checks it under the lock. One hold writes the decision AND its `generation_opened` (no window in which the old children are neither stale nor orphaned).
 * -> { refusal } | { text, expect, typedLabel, formName, after, apply, rootId, milestoneNode }.
 */
function buildRootReplan({ rootDir, rootId, record, state, runsDir, stop, decisionText, obligationArg, ob, work, sittingHeld, fresh = false, fromRecommendation = null, fromSessionDraft = null, allowBytes = null, offerRaise = false }) {
  if (typeof work !== 'string' || typeof sittingHeld !== 'function') throw new TypeError('buildStopDecision: a root re-plan needs `work` and `sittingHeld` (the decide handler passes them)');
  // GAP A (A-DRAFT sentences): the person was shown the session's draft `fromSessionDraft.draftId`; it must still be the NEWEST draft of this stop and the text the one shown. A newer draft changes the text, so an approval of the old one is never used.
  const draft = fromSessionDraft ? state.drafts.get(stop.id) ?? null : null;
  if (fromSessionDraft) {
    if (!draft || draft.id !== fromSessionDraft.draftId) return { refusal: `the draft ${fromSessionDraft.draftId} is no longer the newest draft of stop ${stop.id}: the session wrote a newer one, or the stop was answered` };
    if (draft.text !== decisionText) return { refusal: 'the decision text is not the text of the draft' };
  }
  if (obligationArg !== undefined || ob.obligation) return { refusal: `--obligation does not combine with a new root plan: the stop is answered as a whole (it is about ${ob.obligation ?? obligationArg}); choose the stop alone` };
  // TWO-WAY REFUSAL (Muad's idea, 20 Okt 2026; A-DRAFT words): --allow-size <bytes> raises the size THIS new root plan is priced for; the new price is shown below and approved by the typed stop id, and the raise is recorded on the decision (allowanceBytes) for this one plan
  const treeMax = bundleAllowanceBytesOf(record.tree);
  if (allowBytes !== null && !(Number.isInteger(allowBytes) && allowBytes > treeMax)) return { refusal: `--allow-size: give a whole number of bytes above the ${treeMax} this tree's approval is priced for` };
  const pre = rootReplanPreflight(rootDir, { work, stopId: stop.id, sittingHeld, ...(allowBytes !== null ? { allowanceBytes: allowBytes } : {}) });
  if (pre.refusal) return { refusal: pre.refusal.text };
  const priceNow = allowBytes !== null ? rootReplanPreflight(rootDir, { work, stopId: stop.id, sittingHeld }) : null;
  if (priceNow?.refusal) return { refusal: priceNow.refusal.text };
  // the only guard for the window the fold cannot see: a closed, passed node whose plan holds a split block that is not verified yet may have children that are not on record
  const unverified = nodesToVerify({ record, state, runsDir });
  if (unverified.length) return { refusal: `${unverified.map(n => `${n.node}@g${n.generation}`).join(', ')} ${unverified.length === 1 ? 'has' : 'have'} a split that is not verified yet (the sitting verifies it first): run \`council tree resume ${rootId ?? '<rootId>'}\`, then decide` };
  const rootKey = `R@g${pre.previous.generation}`;
  // BUNDLE UNIT step 2 (Muad's direction 19 Okt 2026 via C&C): the set-aside root plan goes to the new plan's writer as DATA unless the person says --fresh; scanned here (a key shape has no override), and the size of the new root input is checked for EVERY root re-plan
  const maxBytes = allowBytes ?? treeMax;
  const bundleOf = oldPlanText => bundleInputBytes(rootBundle({ treeId: record.tree.treeId, generation: pre.generation, decisions: [{ id: 'e99999999', text: decisionText }], taskText: pre.task.text, oldPlanText }).files);       // a placeholder id as long as a real one: the estimate errs high
  // a recommendation was paid for before these checks: its refusal says so (the money is spent, this refusal spends nothing more)
  const paidNote0 = fromRecommendation ? ` The advice you chose this from was already paid for; this refusal spends nothing more.` : '';
  // the member reads context.md through readContextFile (src/cli.js): a file over MAX_CONTEXT_FILE_BYTES is refused at its start whatever the allowance says, so no raise can make such a decision work and none is offered (the same measurement tree-loop.js applies to a child)
  const ctxBytes = Buffer.byteLength(rootBundle({ treeId: record.tree.treeId, generation: pre.generation, decisions: [{ id: 'e99999999', text: decisionText }], taskText: pre.task.text }).files['context.md'] ?? '', 'utf8');
  if (ctxBytes > MAX_CONTEXT_FILE_BYTES) return { refusal: `the new root plan's context.md would be ${ctxBytes} bytes, over the ${MAX_CONTEXT_FILE_BYTES} the CLI accepts at the plan's start: give a shorter decision; no size raise can help${paidNote0}` };
  const restBytes = bundleOf(null);
  const paidNote = paidNote0;
  const raiseHint = n => (offerRaise && allowBytes === null ? ` or raise the size for this new plan with --allow-size ${n} (the new plan's price is then shown for you to approve)` : '');
  if (restBytes > maxBytes) return { refusal: offerRaise && allowBytes === null
    ? `the new root plan's input would be about ${restBytes} bytes, over the ${maxBytes} this tree's approval was priced for. Two ways on: give a shorter decision,${raiseHint(restBytes)}.${paidNote}`
    : `the new root plan's input would be about ${restBytes} bytes, over the ${maxBytes} this tree's approval was priced for: give a shorter decision${paidNote}` };
  const oldChoice = chooseOldPlan({ rootDir, node: state.nodes.get(rootKey), fresh, restBytes, maxBytes, raiseHint: offerRaise && allowBytes === null ? raiseHint : null, paidNote });
  if (oldChoice.refusal) return { refusal: oldChoice.refusal };
  const oldPlanLine = oldChoice.oldPlan.form === 'data'
    ? `The earlier root plan ${rootKey} (${oldChoice.oldPlan.bytes} bytes, sha256 ${oldChoice.oldPlan.sha256}) goes to the writer of the new plan as DATA, marked as not to be followed. Add --fresh to leave it out.\n`   // A-DRAFT
    : `The earlier root plan ${rootKey} is left out (--fresh): the new plan is written without it.\n`;       // A-DRAFT
  const raiseLine = allowBytes === null ? '' : `Raising the size this new plan is priced for from ${treeMax} to ${allowBytes} bytes (--allow-size). Price now: cheapest end $${priceNow.chain.figures.cheapestUsd.toFixed(2)}, upper estimate $${ceilCents(priceNow.chain.figures.atMostUsd).toFixed(2)}. Price after the raise: cheapest end $${pre.chain.figures.cheapestUsd.toFixed(2)}, upper estimate $${ceilCents(pre.chain.figures.atMostUsd).toFixed(2)}. Typing the stop id approves that price; it applies to this new root plan only.\n`;       // A-DRAFT
  const ineligible = ineligibleBelowRoot(state, { answeringStopId: stop.id });
  const keyOf = n => `${n.node}@g${n.generation}`;
  const toNode = k => ({ node: k.split('@g')[0], generation: Number(k.split('@g')[1]) });
  const affected = [toNode(rootKey), ...ineligible.map(toNode)];
  const dead = deadKeys(state);
  const held = [...state.nodes.values()].filter(n => n.node !== 'R' && !dead.has(keyOf(n))).map(keyOf).filter(k => !ineligible.includes(k)).sort();
  const runsOf = keys => new Set(keys.map(k => state.nodes.get(k)?.runId).filter(Boolean)).size;
  const otherStops = state.openStops.filter(id => id !== stop.id);
  // F2 (Muad, 12 Oct; C&C ruling 2): a stop is never answered silently. Every other open ROOT stop that came from an obligation decision of the person is named with the words they typed then. Those words are NOT carried into the new
  // root plan (text the person did not choose is not fed in): putting them there is the person's choice. New person-facing text: INTERIM, E list item 59.
  const earlierWords = otherStops.map(id => {
    const o = obligationOriginOf(state, id); if (!o) return null;
    const opened = record.events.find(e => e.event === 'needs_decision_opened' && e.id === id);
    const said = record.events.find(e => e.event === 'decision_recorded' && e.id === o.decisionId);
    return typeof said?.text === 'string' ? `  Stop ${id} (about the obligation ${opened?.obligation ?? '(not recorded)'}; your answer ${o.decisionId} to stop ${o.originStopId}), your words then:\n----- decision ${o.decisionId} -----\n${said.text}\n----- end -----\n` : null;
  }).filter(Boolean);
  const earlierBlock = earlierWords.length ? `These earlier words of yours are NOT carried into the new root plan. To put them there, answer n below and run the command again with them in your decision:\n${earlierWords.join('')}` : '';
  const limits = effectiveLimits(record.tree, record.events);
  const rootKeys = rootRemedies(record, state, runsDir);
  const list = ks => (ks.length ? ks.map(k => `  - ${k}`).join('\n') : '  (none)');
  // A recommendation is MODEL text: its frame is a dash fence longer than any dash run inside it (src/text-fence.js, as the send path frames a brief), so it cannot close the frame early and fake what follows. The person's own typed text keeps the fixed five-dash frame, byte for byte.
  const fenceOpen = fromRecommendation || draft ? dashFence(draft ? `${decisionText}\n${draft.reason}\n${draft.changeAsked?.text ?? ''}` : decisionText) : '-----';
  const text = `Answer stop ${describeStop(stop)} with a NEW ROOT plan?   (re-plan the root)

${draft ? `The session wrote draft ${draft.id} for this stop (${Buffer.byteLength(decisionText, 'utf8')} bytes, ${draft.at}${draft.replaces ? `; it replaces the earlier draft ${draft.replaces}` : ''}). Its reason, in its words:
${fenceOpen} reason ${fenceOpen}
${draft.reason}
${fenceOpen} end ${fenceOpen}
${draft.changeAsked ? `
You asked the session for a change (${draft.changeAsked.at}):
${fenceOpen} request ${fenceOpen}
${draft.changeAsked.text}
${fenceOpen} end ${fenceOpen}
The session has not written a newer draft yet; this one can still be approved.
` : ''}
The decision text, word for word (${Buffer.byteLength(decisionText, 'utf8')} bytes):` : `Your decision, word for word (${Buffer.byteLength(decisionText, 'utf8')} bytes):`}
${fenceOpen} decision ${fenceOpen}
${decisionText}
${fenceOpen} end ${fenceOpen}
${fromRecommendation ? `This decision text is recommendation ${fromRecommendation.n} from the advisor.\n` : ''}${draft ? `This decision text was written by the session (draft ${draft.id}). You approve it as written.\n` : ''}
Recording it: the decision text is kept and this stop is answered. The root plan ${rootKey} (run ${pre.previous.runId}) is replaced by a new root plan, R@g${pre.generation}, planned afresh from the same task; you approve it next.
${oldPlanLine}${raiseLine}SET ASIDE from now on (${1 + ineligible.length} node${ineligible.length ? 's' : ''}: they stay on disk, listed as replaced, start nothing more, and what they spent stays counted):
${list([rootKey, ...ineligible])}
HELD (${held.length} node${held.length === 1 ? '' : 's'} in ${runsOf(held)} run${runsOf(held) === 1 ? '' : 's'}: finished and passed; nothing runs or spends on them meanwhile; checking them for reuse comes in a later step):
${list(held)}
${otherStops.length ? `Also answered by this decision: the other open stop${otherStops.length === 1 ? '' : 's'} of the replaced plan (${otherStops.join(', ')}): ${otherStops.length === 1 ? 'its node no longer exists' : 'their nodes no longer exist'} in the plan.\n` : ''}${earlierBlock}Nothing is started by this decision. \`council tree approve ${rootId ?? '<rootId>'}\` then shows the new root run, its price and its cap, and asks again.
The root cap ($${pre.rootCapUsd.toFixed(2)}) does not change. Spent so far $${pre.spentUsd.toFixed(2)}; free after the set-aside $${pre.freeUsd.toFixed(2)}. The root chain's cheapest end is $${pre.chain.figures.cheapestUsd.toFixed(2)}. Runs counted toward the limit: ${state.nodes.size} of ${limits.maxRuns}.
The task file is not changed: the new root plan is planned from the same task bytes (sha256 ${pre.task.taskHash}).${rootKeys.length ? `\nIf a root milestone is the whole problem, \`council tree decide ${rootId ?? '<rootId>'} --milestone ${rootKeys[0]} --stop ${stop.id}\` resolves it in place instead and costs no run.` : ''}

${draft ? 'Not approving it? Type anything else at the prompt: you can then say what the session should change, or write your own decision.\n' : ''}To approve, type the stop id: ${stop.id}
`;
  return {
    text: terminalSafeMarked(text), expect: stop.id, typedLabel: 'the stop id', milestoneNode: null, rootId,
    formName: `new root plan for stop ${stop.id}`,
    after: `The new root plan R@g${pre.generation} is decided and not registered yet; ${held.length} finished node${held.length === 1 ? ' is' : 's are'} held.`,
    apply: ({ gateId, shownSha256, actor, via, reason, planMode }) => withTreeLock(rootDir, () => {
      const now = readTreeRecord(rootDir); const st = stateOf(now);
      const gone = reason => { throw new TreeRefusal({ code: 'continuation_refused', transition: 'decision_recorded', reason }); };
      if (!st.openStops.includes(stop.id)) gone(`stop ${stop.id} is no longer open`);
      // what the person was SHOWN is what is recorded: the set is recomputed here and must be the one in the text (the table refuses any other set as well)
      const nowIneligible = ineligibleBelowRoot(st, { answeringStopId: stop.id });
      if (JSON.stringify(nowIneligible) !== JSON.stringify(ineligible)) gone('the nodes that cannot be held changed while you read (a node stopped, closed or opened a stop): nothing was recorded; run the command again to see them as they are now');
      if (latestGenerationOf(st, 'R') !== pre.previous.generation) gone('the root changed while you read: nothing was recorded');
      if (draft && st.drafts.get(stop.id)?.id !== draft.id) gone('the session wrote a newer draft while you read: nothing was recorded; run the command again to read it');
      if (oldChoice.oldPlan.form === 'data' && oldPlanOf({ rootDir, node: st.nodes.get(rootKey) }).sha256 !== oldChoice.oldPlan.sha256) gone('the earlier plan changed while you read: nothing was recorded');
      const d = appendTreeEventLocked(rootDir, { event: 'decision_recorded', text: decisionText, affected, form: 'regenerate', stopId: stop.id, replansRoot: true, oldPlan: oldChoice.oldPlan, ...(allowBytes !== null ? { allowanceBytes: allowBytes } : {}), ...(fromRecommendation ? { fromRecommendation } : {}), ...(draft ? { fromSessionDraft: { draftId: draft.id } } : {}), gateId, shownSha256, actor, via });
      return appendTreeEventLocked(rootDir, { event: 'generation_opened', decisionId: d.id, nodes: [{ node: 'R', generation: pre.generation }] });
    }),
  };
}

/**
 * GAP A: the newest session draft of the open ROOT stop a regenerate would answer (`--stop`, or the only/first open stop), or null: { stopId, draftId, text, reason, at, replaces }. Read from the record; nothing is written.
 */
export function waitingDraft({ rootDir, stopArg }) {
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) return null;
  const state = stateOf(record);
  const s = chooseStop(record, state, stopArg, null);
  if (s.refusal || s.stop.node !== 'R') return null;
  const d = state.drafts.get(s.stop.id);
  return d ? { stopId: s.stop.id, draftId: d.id, text: d.text, reason: d.reason, at: d.at, replaces: d.replaces, changeAsked: d.changeAsked } : null;
}

/**
 * Everything that needs no text, checked before the person types any (the milestone, the stop of its own node, the obligation): -> { refusal } | { asksProvides, node }. `asksProvides` says whether the yes/no question
 * about what the stopped child provides to a sibling is to be asked (a resolution in place of a non-root node).
 */
export function stopPreflight({ rootDir, rootId = null, form, milestoneArg, stopArg, obligationArg, work = null, sittingHeld = null, fresh = false, allowBytes = null, offerRaise = false }) {
  const r = buildStopDecision({ rootDir, rootId, form, milestoneArg, stopArg, obligationArg, decisionText: '(not typed yet)', changesProvides: false, work, sittingHeld, fresh, allowBytes, offerRaise });
  if (r.refusal) return { refusal: r.refusal };
  return { asksProvides: form === 'milestone' && r.milestoneNode !== 'R', node: r.milestoneNode ?? null };
}

/** PLAN 8.4: asks "Does this answer change anything <node> provides to a sibling? (yes/no): ". Only `yes` or `no` (any case, trimmed) counts; anything else, an empty answer or the input ending is -> { error } and nothing is re-asked. */
export function askChangesProvides({ stdin, stdout, node }) {
  return new Promise(resolve => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    let done = false;
    rl.question(`Does this answer change anything ${node} provides to a sibling? (yes/no): `, a => { done = true; rl.close(); const v = String(a).trim().toLowerCase(); resolve(v === 'yes' ? { answer: true } : v === 'no' ? { answer: false } : { error: `the answer must be yes or no (you typed ${JSON.stringify(terminalSafe(String(a)).slice(0, 40))})` }); });
    rl.on('close', () => { if (!done) resolve({ error: 'the input ended before the question about what the node provides was answered' }); });
  });
}
