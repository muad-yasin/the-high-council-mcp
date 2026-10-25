// `council tree status <rootId>`, the VIEW (0.8.3 M6 slice S6; PLAN 10.1 "status is read-only"; the M6 pins). A pure read of the tree record and the member run folders that says, in words, where the tree stands. It
// appends nothing, takes no lock, writes no file, calls no model and shows no approval gate.
//
// NO SECOND WORDING PATH. Every sentence about a thing the tree already knows how to say comes from the module that says it:
//   the verdict and its reasons        src/tree-ready.js (S1) through buildTreeReport (src/tree-report.js, S4: one record position for readiness AND money)
//   a stop is in force                 src/tree-resume.js sittingLines (the `stopped_by_person` sentence)
//   waiting children and why           src/tree-loop.js chooseNextChild (`waiting`, `awaitingApproval`), plus a pending frontier no preview lists yet that `tree approve` takes (src/tree-frontier.js findPendingFrontier + describeFrontier, D2 F12), providerEligibility (the orphan reason of M6 S0 a)
//   held nodes of a re-plan (root or sub-plan)   src/tree-handoff.js HELD_PENDING_TITLE (heldTitleOf) + HELD_PENDING_SENTENCE + heldNodesOf (the handoff says the same words; S8-6a2; one list for both routes since C2a-record commit 2)
//   the personal-data mode             src/tree-handoff.js PII_MODE_TITLE + PII_MODE_WORDS + piiModeLine (the state word only: the reason of an unusable value is the handoff file's alone; S8-6b part 1)
//   registered, not started + grant    src/tree-stop.js renderHeldChildren          a frontier closed under a changed parent   renderParentChanged
//   split_changed (3 writers)          src/tree-split-changed.js splitChangedOf + renderSplitChanged     derived, not admitted   renderDerivedNotAdmitted
//   each open stop + its routes        src/tree-stop-view.js needsDecisionStopText (the stop text, with the command that answers it)
//   money                              src/tree-stop.js money (one formatter), and the TWO figures of buildTreeReport, never added here.
//
// THE CONTRACT (fixed before the tests):
//   gatherStatusFacts(rootDir, { work }) -> facts    plain data. The record is read before and after everything else; if its last event or count moved the reads are repeated (up to 3 times), else
//                                                    `consistency` says so. `work` is required (S1's contract check resolves task files from it).
//   renderTreeStatus(facts) -> string                PURE. Sections in this order: Verdict, the stop marker, Nodes, Waiting, Held pending the new root plan (only while a root re-plan holds nodes), Held and refused, Open stops, Limits, Money, What you can do.
//   statusHandler({ rootDir, rootId, work, stdout }) -> 0 | 1    THE SEAM FOR THE VERB (A's, in src/tree-cli.js: `status` joined TREE_VERBS with no options and one positional (it was a later verb until M6 S6; LATER_VERBS is gone since S5), and its handler is
//                                                    this function). It prints what it can and never prompts. 0 when the record reads; 1 when it does not (README exit row 1: "a recursive-councils tree's record
//                                                    cannot be read"; C&C's ruling, 11 Oct), the text is printed all the same.
// The commands this view names are the ones that exist today: `council tree approve | decide | resume | stop <rootId>`. It names no route that the tree would refuse, and none for `start` or `check`: no `resume` for a tree whose personal-data mode reads `unusable` or for a member a hand start already had refused (its way out is `decide --close`; S8-6b part 2a).
import { basename, dirname } from 'node:path';
import { readTreeRecord, stateOf } from './tree-record.js';
import { gatherReadinessFacts } from './tree-ready.js';
import { buildTreeReport } from './tree-report.js';
import { acceptedNodesOf, acceptedRowOf, deferredRowOf, deferredStopsOf, draftedRowOf, draftedStopsOf, adoptedNodesOf, adoptedRowOf, HELD_PENDING_SENTENCE, KEPT_SENTENCE, heldTitleOf, keptTitleOf, rowPhraseOf, subRowsSentenceOf, NO_START_UNUSABLE, abandonedTextOf, childKeyOf, closeRefusedLine, closedUnstartedLine, heldNodesOf, keptNodesOf, memberRefusalLine, piiModeLine, positionOfRecord, retiredStopsOf, stopToOpenLine } from './tree-handoff.js';
import { deadKeys, heldKeys, orphansOf } from './tree-transitions.js';
import { pendingBlockedChildren } from './tree-blocked-child.js';
import { nodeKey } from './tree-identity.js';
import { chooseNextChild, providerEligibility } from './tree-loop.js';
import { sittingFacts, needsDecisionStopText } from './tree-stop-view.js';
import { splitChangedOf } from './tree-split-changed.js';
import { describeFrontier, findPendingFrontier } from './tree-frontier.js';
import { accountingAcceptLines, effectiveLimits } from './tree-budget.js';
import { stopRequested } from './tree-run.js';
import { chainWayOn, sittingLines } from './tree-resume.js';
import { cannotExpandWords } from './tree-approve.js';
import { rootUnstartedOf } from './tree-root-unstarted.js';
import { renderDerivedNotAdmitted, renderHeldChildren, renderParentChanged, renderSplitChanged, money, prefixOf } from './tree-stop.js';

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const idNum = id => Number(String(id ?? '').replace(/\D+/g, '')) || 0;
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const samePosition = (a, b) => a.lastEventId === b.lastEventId && a.events === b.events;

/** Everything the view says, as plain data. Reads the record and the run folders; writes nothing. */
export function gatherStatusFacts(rootDir, { work, readRecord = readTreeRecord, deny = null } = {}) {
  if (typeof work !== 'string' || !work) throw new TypeError('gatherStatusFacts: `work` (the working folder `contract check` resolves the task file from) is required');
  let moved = false; let facts;
  for (let tries = 0; tries < 3; tries += 1) {
    const before = positionOfRecord(readRecord(rootDir));
    facts = gatherOnce(rootDir, work, readRecord, deny);
    moved = !samePosition(before, positionOfRecord(readRecord(rootDir)));
    if (!moved) break;
  }
  return { ...facts, consistency: moved ? 'the record was still changing while it was read' : null };
}

function gatherOnce(rootDir, work, readRecord, deny) {
  const report = buildTreeReport(rootDir, { work, readRecord, deny });
  const base = { rootId: basename(rootDir), treeId: report.treeId, position: report.position, readiness: report.readiness, gate: report.gate, piiGate: report.piiGate, memberRefusals: report.memberRefusals ?? [], closedUnstarted: report.closedUnstarted ?? [], abandoned: report.abandoned ?? null, abandonedText: null, retiredStops: [], problems: [] };
  const rf = gatherReadinessFacts(rootDir, { work, deny });
  if (rf.problems.length) return { ...base, problems: rf.problems, stopMarker: stopRequested(rootDir), nodes: [], waiting: [], awaitingApproval: [], nextChild: null, held: { registeredNotStarted: [], parentChanged: [], guardRefusals: [] }, rootUnstarted: false, stopToOpen: [], heldNodes: [], keptNodes: [], splitChanged: [], dead: [], openStops: [], limits: null, money: null };
  const record = readRecord(rootDir);
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  const nodes = rf.nodes.map(n => ({ node: n.node, generation: n.generation, depth: n.depth, runId: n.runId, phase: n.phase, outcome: n.outcome, nextGeneration: n.nextGeneration, accepted: n.accepted ?? null })).sort((a, b) => byText(a.node, b.node) || a.generation - b.generation);
  const choice = chooseNextChild(rootDir, { work, deny });
  const waiting = (choice.waiting ?? []).map(w => ({ node: w.node, why: [...(w.why ?? [])] })).sort((a, b) => byText(a.node, b.node));
  const awaitingApproval = [...(choice.awaitingApproval ?? [])];
  // D2 F12 (A1b): a frontier that was never previewed waits for the person all the same (`council tree approve` offers it: findPendingFrontier is the verb's own first read), so it is listed too, once (a previewed one is awaitingApprovalOf's),
  // and the view and the tree_status payload name the approval instead of "Nothing is asked of you right now". Not listed: a verified node whose plan no longer reads (key null: describeFrontier refuses it), and a parent the
  // verdict holds a `derivation_refused` at (between the approve that refused and the stop opening, `stopToOpen` names `council tree resume`, stopToOpenLine; once the stop is open findPendingFrontier skips that parent itself, D2 F2(e)).
  // A root re-plan's frontier (kind 'root_replan') is listed under the same words as once it is previewed; the verdict's generation_pending line keeps its own words.
  // RULE 1c (C&C's ruling on F12: status prints approve ONLY where `council tree approve` takes the frontier): nor is a frontier listed that describeFrontier refuses (the verb's second read, refused there with exit 19: a split_changed
  // (B)/(C), a check of items 1-4, a root re-plan that cannot be put yet). The live read is read-only, as D2 F13b's limitStopView (src/tree-decide.js) reads it; a throw is not listed either (the verb meets the same throw; D3 F13 note).
  // The state's own way out is printed all the same: a split_changed parent is `blocked` at its own scope, so `stopToOpen` names `council tree resume` (stopToOpenLine) and, once the stop is open, its `decide` route.
  // G7 item 4 (C&C 25 Okt 2026, T's trace): the same gate for a PREVIEWED frontier. awaitingApprovalOf lists it without asking describeFrontier, so a frontier the verb now refuses (a child chain file edited after the preview,
  // tree-approve.js) printed `council tree approve` as the only way on. Now a children frontier is listed only where describeFrontier takes it; where it refuses, the approve verb's own words are printed (approveRefusal),
  // and for a chain file S13's way on (src/tree-resume.js chainWayOn). A root re-plan keeps its F12 treatment (listed once previewed; the verdict's generation_pending line is T's, G7 item 1).
  // G7 item 2c: the catch. Since F18a/F18b a missing chain and an unreadable root task refuse rather than throw. What can still throw is anything else describeFrontier meets (its derivation loop rethrows what it does not
  // recognise; on the MCP route a NotExpandable from a derivation that read without the denylist did, until G7 item 3): an unpreviewed frontier is then not listed and a previewed one stays listed as before, with nothing printed
  // for it, because the approve verb meets the same throw.
  let approveRefusal = null;
  { const pending = findPendingFrontier({ rootDir, record, state });
    const held = pending?.key && (report.readiness?.reasons ?? []).some(r => r.code === 'derivation_refused' && r.scope === nodeKey(pending.parent.node, pending.parent.generation));
    const previewed = pending?.key && awaitingApproval.includes(pending.key);
    if (pending?.key && !held && !(previewed && pending.kind === 'root_replan')) {
      let described = null; try { described = describeFrontier({ rootDir, work, deny, pending }); } catch { described = null; }
      if (described && !described.refusal) { if (!previewed) awaitingApproval.push(pending.key); }
      else if (described?.refusal) {
        awaitingApproval.splice(0, awaitingApproval.length, ...awaitingApproval.filter(k => k !== pending.key));
        if (pending.kind !== 'root_replan') approveRefusal = { frontierKey: pending.key, check: described.refusal.check, words: cannotExpandWords(pending, described.refusal) };
      }
    }
  }
  awaitingApproval.sort(byText);
  // an approved frontier whose admitted child is not registered yet: the next sitting registers it (`council tree resume`); nothing the record holds says so otherwise (BUG-B-010)
  const nextChild = choice.kind === 'child' && !state.sticky.size && state.active === null ? choice.node : null;       // a registered node is ACTIVE: resume retries it first (the registered-child line says so), it registers nobody
  const held = sittingFacts(rootDir);
  // a path whose every registration is dead with a replaced parent: the reason is the eligibility check's own sentence (M6 S0 a)
  // a HELD node is an orphan to `orphansOf` by design (the held state's contract D1): it is listed as held (S8-6a2), never as dead
  const orphanKeys = orphansOf(state); const heldNow = heldKeys(state);
  const livePaths = new Set([...state.nodes.values()].filter(n => !orphanKeys.has(nodeKey(n.node, n.generation))).map(n => n.node));
  const deadPaths = [...new Set([...state.nodes.values()].filter(n => orphanKeys.has(nodeKey(n.node, n.generation)) && !heldNow.has(nodeKey(n.node, n.generation)) && !livePaths.has(n.node)).map(n => n.node))].sort(byText);
  const dead = deadPaths.map(path => ({ node: path, why: providerEligibility({ record, state, runsDir, work }, path).why }));
  const openStops = state.openStops.map(id => record.events.find(e => e.id === id)).filter(Boolean).sort((a, b) => idNum(a.id) - idNum(b.id)).map(e => ({ id: e.id, node: e.node ?? null, generation: e.generation ?? null, child: childKeyOf(e), text: needsDecisionStopText(rootDir, e) }));
  const limits = { ...effectiveLimits(record.tree, record.events), runs: state.nodes.size, raised: record.events.filter(e => e.event === 'limit_raised').sort((a, b) => idNum(a.id) - idNum(b.id)).map(e => ({ id: e.id, at: e.at ?? null, limit: e.limit, from: e.from, to: e.to })) };
  const facts = { ...base, stopMarker: stopRequested(rootDir), nodes, waiting, awaitingApproval, approveRefusal, nextChild, held: { registeredNotStarted: held.registeredNotStarted ?? [], parentChanged: held.parentChanged ?? [], guardRefusals: held.guardRefusals ?? [] }, rootUnstarted: !state.sticky.size && rootUnstartedOf(state, runsDir), stopToOpen: state.sticky.size ? [] : pendingBlockedChildren(record, state, report.readiness).map(p => nodeKey(p.node, p.generation)), heldNodes: heldNodesOf(state), keptNodes: keptNodesOf(state), ...(adoptedNodesOf(state).length ? { adoptedNodes: adoptedNodesOf(state) } : {}), ...(acceptedNodesOf(state).length ? { acceptedNodes: acceptedNodesOf(state) } : {}), ...(deferredStopsOf(state).length ? { deferredStops: deferredStopsOf(state) } : {}), ...(draftedStopsOf(state).length ? { draftedStops: draftedStopsOf(state) } : {}), splitChanged: splitChangedOf(record), dead, openStops, limits, money: report.money };
  // already-false unit (L3): a refused member start of a node whose plan was REPLACED stays in `memberRefusals` (the history is true), but the `next` line that says "close it" is not: a dead node holds nothing and `--close` refuses it
  { const deadNow = deadKeys(state); facts.memberRefusalsDead = (base.memberRefusals ?? []).map(m => nodeKey(m.node, m.generation)).filter(k => deadNow.has(k)); }
  // ROADMAP 57 (c3): a final tree has nothing waiting and nothing to open, answer or start. The FACTS are emptied here (not only the text), so the view and the `tree_status` payload cannot disagree: a stranded abandoned root would
  // otherwise say "start the root plan with `council tree resume`".
  if (!state.abandoned) return facts;
  return { ...facts, abandonedText: abandonedTextOf(state), retiredStops: retiredStopsOf(state), stopMarker: false, waiting: [], awaitingApproval: [], approveRefusal: null, nextChild: null, held: { registeredNotStarted: [], parentChanged: [], guardRefusals: [] }, rootUnstarted: false, stopToOpen: [], heldNodes: [], keptNodes: [], splitChanged: [], openStops: [], memberRefusals: [], closedUnstarted: [] };
}

/** The view's text for a facts object. Pure: no clock, no file. */
// A "run" is a member that STARTED (the record's node_started, carried by gateTree and the report as `started`). A member that has not started - registered and waiting, closed before it started, or held - is no run; its own
// spend is read, never assumed to be 0 (a start refused before its claim can leave a run folder). The old count was every registered row.
export const startedOf = m => m.memberSpend.members.filter(x => x.started).length;
const idleOf = m => m.memberSpend.members.filter(x => !x.started);
const idleClause = m => { const idle = idleOf(m); if (!idle.length) return ''; const spent = idle.reduce((a, x) => a + (x.runSpentUsd || 0), 0); return `; ${idle.length} more member${idle.length === 1 ? '' : 's'} the record shows as not started: ${spent > 0 ? `${money(spent)} spent by ${idle.length === 1 ? 'it' : 'them'}` : 'nothing spent'}`; };
export function renderTreeStatus(f) {
  const L = [];
  const id = f.rootId ?? '<rootId>';
  const pos = f.position ?? { lastEventId: null, lastEventAt: null, events: 0 };
  L.push(`Tree ${f.treeId ?? '(unknown)'}: record at ${pos.lastEventId ?? 'no event'}${pos.lastEventAt ? ` (${pos.lastEventAt})` : ''}, ${pos.events} events.`);
  if (f.consistency) L.push(`WARNING: ${f.consistency}.`);
  if (f.problems?.length) { L.push('', 'The record could not be read:', ...f.problems.map(p => `  ${oneLine(p)}`)); }
  const ab = Boolean(f.abandoned);
  if (ab) {
    // ROADMAP 57 (c3): a final tree. No verdict (the retired stops no longer hold one back), no next step: the one sentence (abandonedSentence), then what it left unanswered.
    L.push('', 'Abandoned', `  ${f.abandonedText}`);
    if (f.retiredStops.length) L.push(`  Stops it left unanswered: ${f.retiredStops.map(st => `${st.id}${st.node ? ` on ${st.node}@g${st.generation}` : ''}`).join(', ')}.`);
  } else {
    const rd = f.readiness;
    L.push('', `Verdict: ${rd.verdict} (${rd.source === 'recorded' ? `a recorded readiness event ${rd.eventId ?? ''}${rd.at ? ` at ${rd.at}` : ''}` : `computed from the record at ${rd.eventId ?? 'no event'}${rd.at ? ` (${rd.at})` : ''}; no readiness event is recorded yet`}).`);
    if (rd.reasons.length) L.push(...rd.reasons.map(r => `  [${r.severity}] ${r.code} at ${r.scope}: ${oneLine(r.text)}`));
    else if (rd.verdict === 'ready') L.push('  No reason: every rule of readiness holds. "Ready" is the rule, not a statement about the quality of the plan.');
    // 2b (gate page 12.4, C&C condition 2): an aggregate never reads as a pass over text no panel read
    if (rd.verdict === 'ready' && rd.reasons.some(r => r.severity === 'info')) L.push('  "Ready" here means no rule of readiness fails; it does not say the run\'s review panel signed every plan: the plans marked above were accepted by a person or the session after the run.');
    if (f.gate && f.gate.ok === false) L.push(`  The accounting gate does not trust the record (${f.gate.problems.length} problem${f.gate.problems.length === 1 ? '' : 's'}: ${[...new Set(f.gate.problems.map(p => p.code))].join(', ')}): no paid start or resume is made until it does.`);
    if (f.gate && f.gate.ok === false) L.push(...accountingAcceptLines(f.gate.problems, id).map(s => `  ${s}`));       // D2 F13a S9 (A-DRAFT; B20a): the typed acceptance, one line per node with a keyed problem (unkeyed ones, B20b, are restored by hand)
    if (f.stopMarker) L.push('', ...sittingLines({ status: 'stopped_by_person', started: [] }, id));

  }
  L.push('', piiModeLine(f.piiGate));
  L.push('', 'Nodes');
  if (!f.nodes.length && !(f.closedUnstarted ?? []).length) L.push('  (none registered)');
  for (const n of f.nodes) L.push(`  ${n.node}  generation ${n.generation}  ${n.phase}${n.outcome ? `, ${n.outcome}` : ''}${n.accepted ? `, plan accepted by ${n.accepted.actor === 'person' ? 'a person' : n.accepted.actor === 'session' ? 'the session' : 'someone'}${n.accepted.via ? ` (${n.accepted.via})` : ''}, not signed by the panel` : ''}  run ${n.runId}${n.nextGeneration ? `  (generation ${n.nextGeneration} was opened and is not registered yet)` : ''}`);
  for (const c of f.closedUnstarted ?? []) L.push(`  ${closedUnstartedLine(c)}`);
  if (f.dead.length) { L.push('', 'Dead with a replaced parent'); for (const d of f.dead) L.push(...d.why.map(w => `  ${w}`)); }

  if (!ab) {
    const waits = [...f.waiting.map(w => `${w.node} waits: ${w.why.join('; ')}`), ...f.awaitingApproval.map(k => `A frontier (${prefixOf(k)}) waits for your approval: run \`council tree approve ${id}\`.`), ...(f.approveRefusal ? [f.approveRefusal.words] : [])];
    L.push('', 'Waiting', ...(waits.length ? waits.map(w => `  ${w}`) : ['  (nothing is waiting)']));

    // the held nodes of a root re-plan (S8-6a2): the handoff's own title and sentence (src/tree-handoff.js), only while something is held
    if (f.heldNodes?.length) L.push('', heldTitleOf(f.heldNodes), `  ${HELD_PENDING_SENTENCE}`, ...subRowsSentenceOf(f.heldNodes).map(s => `  ${s}`), ...f.heldNodes.map(h => `  ${h.node}  generation ${h.generation}  run ${h.runId}${rowPhraseOf(h, false)}`));
    if (f.keptNodes?.length) L.push('', keptTitleOf(f.keptNodes), `  ${KEPT_SENTENCE}`, ...subRowsSentenceOf(f.keptNodes).map(s => `  ${s}`), ...f.keptNodes.map(h => `  ${h.node}  generation ${h.generation}  run ${h.runId}${rowPhraseOf(h, true)}`));
    if (f.draftedStops?.length) L.push('', 'Drafts waiting for you:', ...f.draftedStops.map(d => `  ${draftedRowOf(d)}`));       // A-DRAFT
    if (f.deferredStops?.length) L.push('', 'Stops the session handed to you:', ...f.deferredStops.map(d => `  ${deferredRowOf(d)}`));       // B-DRAFT
    if (f.acceptedNodes?.length) L.push('', 'Finished runs accepted as they are:', ...f.acceptedNodes.map(o => `  ${acceptedRowOf(o)}`));       // B-DRAFT (KEEP)
    if (f.adoptedNodes?.length) L.push('', 'Finished runs of an earlier plan that fill a slot of this one:', ...f.adoptedNodes.map(o => `  ${adoptedRowOf(o)}`));       // B-DRAFT (C4a)

    const held = [...renderHeldChildren(f.held.registeredNotStarted, id), ...renderParentChanged(f.held.parentChanged, id), ...renderSplitChanged(f.splitChanged, id), ...renderDerivedNotAdmitted(f.held.guardRefusals), ...(f.memberRefusals ?? []).map(memberRefusalLine)];
    L.push('', 'Held and refused', ...(held.length ? held.map(h => `  ${h}`) : ['  (nothing)']));

    L.push('', 'Open stops');
    if (!f.openStops.length) L.push('  (none)');
    for (const s of f.openStops) { L.push(`  Stop ${s.id}${s.node ? ` on ${s.node}@g${s.generation}` : ''}:`); L.push(...(s.text ?? `(the stop's node is not in the record; answer it with \`council tree decide ${id} --stop ${s.id}\`)`).trimEnd().split('\n').map(l => (l ? `    ${l}` : ''))); }

  }
  L.push('', 'Limits');
  if (f.limits) {
    const lim = f.limits;
    L.push(`  depth ${lim.maxDepth}, runs ${lim.runs} of ${lim.maxRuns} (registered, started or not), children per split ${lim.maxChildrenPerSplit}, attempts per child ${lim.attemptsPerChild}.`);
    for (const r of lim.raised) L.push(`  ${r.limit} raised ${r.from} -> ${r.to} (${r.id}${r.at ? ` at ${r.at}` : ''}).`);
  } else L.push('  (not readable)');

  L.push('', 'Money');
  if (!f.money) L.push('  (not readable)');
  else {
    const m = f.money;
    L.push(`  Root cap ${money(m.rootCapUsd)}.`, `  Spent by the member runs: ${money(m.memberSpend.sumUsd)} (${startedOf(m)} run${startedOf(m) === 1 ? '' : 's'} started${idleClause(m)}).`,
      `  The tree's own adjustments: ${m.adjustments.sumUsd < 0 ? '-' : ''}${money(Math.abs(m.adjustments.sumUsd))} (${m.adjustments.reservations.length} reservation${m.adjustments.reservations.length === 1 ? '' : 's'}).`,
      '  These are two figures and are not added here; tree/report.json holds both with the reservations behind each.');
    if (ab) L.push('  Holds: none (released when the tree was abandoned).');
  }

  const next = [];
  // the command is named only where a stop's own text names it: a root stop with no needs-decision milestone is answered by a new root run, and `decide` would refuse it
  if (f.openStops.length) next.push(f.openStops.some(s => /council tree decide/.test(s.text ?? '')) ? `answer the open stop${f.openStops.length === 1 ? '' : 's'} with \`council tree decide ${id}\` (the stop text above says how)` : `an open stop needs your answer: the stop text above names the route`);
  if (f.awaitingApproval.length) next.push(`approve the frontier with \`council tree approve ${id}\``);
  if (f.approveRefusal?.check === 'chain') next.push(chainWayOn(id));       // G7 item 4: S13's way on, the one copy (src/tree-resume.js)
  // S8-6b part 2a: the next step is named only where the tree would take it. A tree whose personal-data mode reads `unusable` starts nothing (beginRoot step 3, the member's check): no resume line. A registered child that a HAND start already refused
  // (exit 19) has a run.json, so the next sitting resumes it with its saved mode and is refused again: its way out is `decide --close`. One whose refusal left no run.json is started afresh by `resume`, and stays on the resume line.
  const unusable = f.piiGate === 'unusable';
  const deadRefused = new Set(f.memberRefusalsDead ?? []);
  const closeFirst = new Set((f.memberRefusals ?? []).filter(m => m.runJson && !deadRefused.has(nodeKey(m.node, m.generation))).map(m => nodeKey(m.node, m.generation)));
  const startable = f.held.registeredNotStarted.filter(i => !closeFirst.has(nodeKey(i.node, i.generation)));
  // `resume` starts the registered child only when nothing holds it: no stop marker, no open stop and an accounting gate that passes (a failing gate makes no paid start)
  if (unusable) { if (f.rootUnstarted || startable.length || f.nextChild) next.push(NO_START_UNUSABLE); }
  else {
    if (f.rootUnstarted) next.push(`start the root plan with \`council tree resume ${id}\``);
    if (!f.stopMarker && !f.openStops.length && f.gate?.ok !== false && startable.length) next.push(`start the registered child with \`council tree resume ${id}\``);
    if (!f.stopMarker && !f.openStops.length && f.gate?.ok !== false && !(f.stopToOpen ?? []).length && f.nextChild) next.push(`start the next child with \`council tree resume ${id}\``);       // A-DRAFT (BUG-B-010): an approved frontier whose admitted child is not registered yet
  }
  for (const m of f.memberRefusals ?? []) if (m.runJson && !deadRefused.has(nodeKey(m.node, m.generation))) next.push(closeRefusedLine(m.node, id));
  if (!unusable && (f.stopToOpen ?? []).length) next.push(stopToOpenLine(f.stopToOpen, id));
  // F13 status line (owed; Review/Build_0.8.3/m8/cr-fixes/M_F14_status_before_after.txt, the second block): under a `council tree stop` marker with nothing else to do, "Nothing is asked" hid the one step that goes on: `tree resume`
  // removes the marker at its start (src/tree-resume.js, clearStop under the sitting lock), so it is named instead (A-DRAFT)
  L.push('', 'What you can do', ...(ab ? ['  Nothing: the tree is final.'] : next.length ? next.map(n => `  ${n}`) : f.stopMarker ? [`  go on with \`council tree resume ${id}\`: it lifts the stop that \`council tree stop\` set`] : ['  Nothing is asked of you right now.']));
  return `${L.join('\n')}\n`;
}

/** The handler of `council tree status <rootId>` (A wires it into src/tree-cli.js). Prints the view; returns 0, or 1 when the record cannot be read (the text is printed either way); never prompts, never writes. */
export async function statusHandler({ rootDir, rootId, work, stdout }) {
  const facts = gatherStatusFacts(rootDir, { work });
  stdout.write(renderTreeStatus(facts));
  return facts.problems.length ? 1 : 0;
}
