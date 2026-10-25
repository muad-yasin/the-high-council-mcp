// `council tree resume <rootId>` (0.8.3 M5c3; PLAN 8.3 steps 4-5, 10.1, 12 rows 1 and 6; M5-DEFAULTS rows 2 and 3, defaults 9 and 22). The person's command to go on with a tree. ONE command is ONE person's attempt:
//   1. one sitting at a time: the command takes `tree/.sitting.lock` (a pid lock like a run folder's, NOT the record's short lock); a second `tree resume` while one runs starts nothing and says so;
//   2. it removes a `council tree stop` marker first (the person asked to go on);
//   3. it resumes AT MOST ONE interrupted node, once: an ordinary execution whose claim's process is gone (the member's own CLI re-claims it and re-runs every continuation check). A node paused at an external seat
//      resumes only when its answer file exists (otherwise the command names the file and starts nothing). A node stopped at its budget cap is not resumed here (its grant must be raised first: `decide --top-up`, M5d);
//   4. then it runs the sitting (src/tree-run.js runTree), which registers and starts the next approved children. runTree resumes an INTERRUPTED execution never (a node whose claim is gone ends the command as `interrupted`); the only thing it sends down the resume path is the FIRST claim of a registered node whose
//      folder already has a run.json (an earlier start was refused before its claim): that is a start, not a resume of an execution. So "one resume of an interrupted execution per command" holds structurally and
//      nothing here loops on a deterministic failure. Before and after, the command shows the node's resume count (derived from the record) and the run folder's STOPPED-* files, with their contents.
//   0. BEFORE all of that, a root that was never started is started (0.8.3 M6 closing): when the record has no root R, or R generation 1 is registered and its run folder has no run.json (a `tree start` that was interrupted, or whose root run was refused before its folder
//      was made). `beginRoot` (src/tree-start.js, the function `tree start` calls) does it from the task pin in tree.json, never from run.json; the root's exit code is mapped to this command's set (0 goes on into the sitting).
// The cap a resumed run is held to is its whole grant (first grant plus every top-up), passed explicitly: a resume without a cap would inherit the cap run.json recorded at the first start, which a top-up must be able to
// raise; the member's own CLI still clamps it to the lifetime cap (PLAN 7.4).
import { priceRefusedOf, priceStopLines } from './tree-price-stop.js';
import { memberContinueCommand, memberFinishCommand, memberPrevailCommand } from './tree-redirect.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as api from './api.js';
import { RunLockedError, acquireRunLock } from './run-lock.js';
import { terminalSafe } from './terminal-safe.js';
import { DEAD_REASON, HELD_PHRASE, KEPT_PHRASE, claimAlive, deadKeys } from './tree-transitions.js';
import { readTreeRecord, stateOf, treeDirOf } from './tree-record.js';
import { MONEY_EPS } from './tree-budget.js';
import { pausedAtExternalSeat, runEndOf, waitsForChoice } from './tree-member.js';
import { renderDerivedNotAdmitted, renderHeldChildren, renderParentChanged } from './tree-stop.js';
import { SITTING_LOCK_FILE, apiResumer, apiStarter, blockedFacts, clearStop, isDeadNode, recordOnlyPhase, runTree } from './tree-run.js';
import { sittingFacts } from './tree-stop-view.js';
import { beginRoot } from './tree-start.js';
import { rootUnstartedOf } from './tree-root-unstarted.js';
import { fileProblemLine, writeTreeFiles } from './tree-files.js';
import { formatUsd } from './cost.js';
import { applyChoice, pendingChoiceOf, replacedOf } from './tree-choice.js';
import { finalSentenceOf } from './tree-abandon.js';

export { SITTING_LOCK_FILE, apiResumer };

/** How many times this node was resumed so far: the `node_resumed` records of purpose `resume` (a post-run call is not a resume). Derived, never stored. */
export const resumeCountOf = (record, node, generation) => record.events.filter(e => e.event === 'node_resumed' && e.purpose === 'resume' && e.node === node && e.generation === generation).length;

/** The run folder's STOPPED-* files with their contents (cut at 600 characters each), for the person to read. */
export function stoppedReasonsOf(runDir) {
  let names = [];
  try { names = readdirSync(runDir).filter(f => /^STOPPED-/.test(f)).sort(); } catch { return []; }
  return names.map(name => { let text = ''; try { text = readFileSync(join(runDir, name), 'utf8').trim(); } catch { text = '(unreadable)'; } return { name, text: text.length > 600 ? `${text.slice(0, 600)} ...` : text }; });
}

/** The sentences a person reads for the end of a sitting. */
/**
 * c4 FIX-UP (C&C, from the crash probe of 13 Oct): what a member's output tail says about WHY it died before it began. The tail is either a raw throw (node's source echo, a caret, the `Error: ...` line, `at ...` frames, the error's own
 * properties between braces, `Node.js vX`) or a clean refusal of one or a few lines. A person gets the line that names the cause: the first `Error: ...` line when there is one, else the LAST three lines that are not stack noise (a clean refusal ends with its cause; what comes before it is log preamble: the real key-scan tail starts with "context: 1 document(s) appended"). Never an
 * `at` frame, a lone brace, a caret, node's `file:line` header or the version line. Pure; no I/O; an empty or unreadable tail gives [] (the caller then says it printed nothing that says why, E75).
 */
const STACK_NOISE = [/^\s*at\s/, /^\s*\^+\s*$/, /^Node\.js v\d/, /^node:[\w/.:-]+:\d+\s*$/, /^\s*[{}\])]+[,;]?\s*$/];
export function crashCauseLines(detail) {
  const lines = String(detail ?? '').split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
  const error = lines.find(l => /^\s*(?:[A-Za-z]+)?Error(?: \[[A-Z_]+\])?:/.test(l));
  if (error) return [error.trim().slice(0, 400)];
  return lines.filter(l => !STACK_NOISE.some(re => re.test(l))).slice(-3).map(l => l.trim().slice(0, 400));
}

export function sittingLines(res, rootId) {
  return [...sittingBody(res, rootId), ...sittingTail(res, rootId)];
}

/** What every end text adds (M5e S6): the needs_decision stops this sitting opened, children registered and not started, a frontier closed under a changed parent, guard refusals of nodes that were never admitted. */
function sittingTail(res, rootId) {
  const L = [];
  // the two views the sitting writes after each step (TREE_HANDOFF.md, tree/report.json): a failure is named, never silent, and never stops the sitting
  for (const p of res.fileProblems ?? []) L.push('', `  ${p.file} could not be written (${p.error}). The sitting went on; \`council tree status ${rootId}\` reads the record live and does not need the file.`);
  for (const r of res.restored ?? []) L.push('', `  Closed by the sitting: stop ${r.stopId} on ${r.node} (generation ${r.generation}). The plan text is the one recorded when that step finished${r.contractChecked ? ', and its contract check passes again' : ''}${r.splitVerified ? ', and its split is verified now' : ''}${r.derivationRechecked ? ', and every child it held back can be derived from it now' : ''}, so nothing needed your answer.`);
  // D2 F4c with Astra (a) (A-DRAFT): a stop whose check could not run is said apart from a check that ran and failed
  for (const r of res.unchecked ?? []) L.push('', r.why === 'contract_check_not_run'
    ? `  Stop ${r.stopId} on ${r.node} (generation ${r.generation}) stays open: its contract check could not be run this time (a file it reads did not read), which is not the same as a check that ran and failed. Once the file reads again, the next \`council tree resume ${rootId}\` runs the check and closes the stop if it passes.`
    : `  Stop ${r.stopId} on ${r.node} (generation ${r.generation}) stays open: the children it holds back could not be derived again this time (a file, a chain or the record did not read), which is not the same as a derivation that ran and failed. The next \`council tree resume ${rootId}\` tries again; \`council tree status ${rootId}\` shows what does not read.`);
  for (const s of res.stops ?? []) if (s.text) L.push('', ...s.text.trimEnd().split('\n'));
  for (const g of res.integrationGaps ?? []) L.push('', ...g.text.trimEnd().split('\n'));
  // S8 G9 (rulings row 130): a blocked ROOT opens a stop like a blocked child, answered by a NEW ROOT plan (the root re-plan form of `council tree decide`); the old root plan, its runs and what they spent stay on disk and stay counted
  if ((res.rootBlocked ?? []).length) L.push('', `  The ROOT is blocked (${res.rootBlocked.map(b => b.code).join(', ')}). A stop is open for it: answer it with a new root plan, \`council tree decide ${rootId}\` (add --stop <id> when more than one stop is open). The old root plan and what it spent stay as they are and stay counted.`);
  const extra = [...renderHeldChildren(res.registeredNotStarted ?? [], rootId), ...renderParentChanged(res.parentChanged ?? [], rootId), ...renderDerivedNotAdmitted(res.guardRefusals ?? [])];
  if (extra.length) L.push('', ...extra.map(l => `  ${l}`));
  if ((res.waiting ?? res.held ?? []).some(w => (w.why ?? []).some(x => /closed incomplete by a person/.test(x)))) L.push('  A node a person closed incomplete never becomes a provider: what waits for it starts only if that node is replaced.');
  return L;
}

function sittingBody(res, rootId) {
  const L = [];
  const at = res.node ? `${res.node} (run ${res.runId})` : '';
  const stopped = () => { for (const s of res.stopped ?? []) L.push(`  ${s}`); };
  switch (res.status) {
    case 'nothing_to_do':
      L.push(res.started.length ? `Done for now: ${res.started.length} run${res.started.length === 1 ? '' : 's'} went through this sitting (${res.started.map(s => s.node).join(', ')}).` : 'Nothing could start.');
      for (const w of res.waiting ?? []) L.push(`  ${w.node} waits: ${w.why.join('; ')}`);
      for (const k of res.awaitingApproval ?? []) L.push(`  A frontier (${k.slice(0, 12)}) waits for your approval: run \`council tree approve ${rootId}\`.`);
      if (res.approvalWaits && !(res.awaitingApproval ?? []).length) L.push(`  A frontier waits for your approval: run \`council tree approve ${rootId}\`.`);
      // D3 F9-1 with D2 S8 (A-DRAFT): what was approved but not admitted for budget, and the way on
      for (const k of res.refusedForBudget ?? []) L.push(k.startsWith('R@g') ? `  R: the new root plan (${k}) was approved but not admitted for budget: raise the tree's cap with \`council tree decide ${rootId} --amend-cap <total>\`, then \`council tree approve ${rootId}\` offers it again.` : `  ${k} was approved but not admitted for budget: raise the tree's cap with \`council tree decide ${rootId} --amend-cap <total>\`, then \`council tree approve ${rootId}\` offers it again.`);
      break;
    case 'held_by_stop':
      L.push(res.started.length ? `${res.started.length} run${res.started.length === 1 ? '' : 's'} went through this sitting (${res.started.map(s => s.node).join(', ')}), and then it stopped: an open stop holds ${res.held.length === 1 ? 'a node' : 'nodes'} back, so this is NOT finished.` : 'Nothing could start: an open stop holds back what is left, so this is NOT finished.');
      for (const h of res.held ?? []) L.push(`  ${h.node} is held: ${h.why.join('; ')}`);
      // ONE remedy per source of the hold (an open stop is answered; a regenerate is waited for; a changed parent is approved again)
      const kinds = id => [...new Set((res.held ?? []).flatMap(h => h.sources ?? []).filter(s => s.kind === id).map(s => s.id))];
      // ONE sentence per source of the stop: a blocked-child stop has one answer (a new generation of the child); the others are answered in place or regenerated
      const info = new Map((res.openStopsInfo ?? []).map(x => [x.id, x]));
      const blockedIds = res.blockedStopIds ?? []; const inputIds = (res.stopIds ?? []).filter(id => info.get(id)?.source === 'bundle_input');
      const integrationIds = (res.stopIds ?? []).filter(id => info.get(id)?.source === 'integration');
      const otherIds = (res.stopIds ?? []).filter(id => !blockedIds.includes(id) && !inputIds.includes(id) && !integrationIds.includes(id));
      // D2 F7b S5 (A-DRAFT): the generic line no longer names --milestone, which a node with no needs-decision milestone does not take; status lists the answers each stop takes
      if (otherIds.length) L.push(otherIds.length === 1 ? `  Open stop ${otherIds[0]}: answer it with \`council tree decide ${rootId} --stop ${otherIds[0]}\`; \`council tree status ${rootId}\` shows the answers each stop takes.` : `  Open stops ${otherIds.join(', ')}: answer each with \`council tree decide ${rootId} --stop <id>\`; \`council tree status ${rootId}\` shows the answers each stop takes.`);
      // c4: a stop WITHOUT a node run behind it, and a stop of the ROOT, each get their own sentence (the generic ones named a milestone it does not have, and "the child" of a root)
      for (const id of inputIds) { const x = info.get(id); L.push(x.node === 'R' ? `  Input stop ${id}: ${x.child} was not registered (its input would be refused): answer it with a NEW ROOT plan, \`council tree decide ${rootId} --stop ${id}\`, or close it without starting it with \`council tree decide ${rootId} --close ${x.child}\`.` : `  Input stop ${id}: ${x.child} was not registered (its input would be refused): answer it with \`council tree decide ${rootId} --stop ${id}\` (regenerate), or close it without starting it with \`council tree decide ${rootId} --close ${x.child}\`.`); }
      // check-fail wedge: an integration stop belongs to no node, so there is no milestone to resolve in place (`decide --milestone` refuses it); its one answer is to regenerate what it affects, named by --stop
      for (const id of integrationIds) L.push(`  Integration stop ${id}: answer it with \`council tree decide ${rootId} --stop ${id}\` (regenerate what it affects).`);
      for (const id of blockedIds) L.push(info.get(id)?.node === 'R' ? `  Blocked-root stop ${id}: answer it with a NEW ROOT plan: \`council tree decide ${rootId} --stop ${id}\`.` : `  Blocked-child stop ${id}: answer it with \`council tree decide ${rootId} --stop ${id}\` (a new generation of the child).`);
      if (kinds('decision').length) L.push(res.replacementWaits ? `  Being replaced by decision${kinds('decision').length === 1 ? '' : 's'} ${kinds('decision').join(', ')}: the replacement waits for your approval: run \`council tree approve ${rootId}\`.` : `  Being replaced by decision${kinds('decision').length === 1 ? '' : 's'} ${kinds('decision').join(', ')}: nothing to answer; the held nodes wait for their replacement.`);
      if (kinds('parent').length) L.push(`  A parent changed after an approval: approve the frontier again with \`council tree approve ${rootId}\`.`);
      for (const w of (res.waiting ?? []).filter(x => !x.held)) L.push(`  ${w.node} waits: ${w.why.join('; ')}`);
      for (const k of res.awaitingApproval ?? []) L.push(`  A frontier (${k.slice(0, 12)}) waits for your approval: run \`council tree approve ${rootId}\`.`);
      break;
    case 'waiting': L.push(`${at} waits for an external answer. ${res.needs?.length ? `Write the reply the NEEDS file asks for (${res.needs.join(', ')}) into runs/${res.runId}/, then run \`council tree resume ${rootId}\`.` : `Run \`council tree resume ${rootId}\` once its answer file exists.`}`); break;
    case 'awaiting_choice': L.push(res.conflict ? `${at} stopped at a conflict the decider asked you to choose, and waits for YOUR pick.` : `${at} stopped at its overseer-round limit, at a layer's revision limit, or because a seat of a layer stayed silent for too many passes in a row, and is NOT agreed: it waits for YOUR choice.`); stopped(); if (res.replaced) { L.push(`  ${res.node} cannot be given a choice: its plan was replaced (${res.replaced === 'held' ? `it is ${res.replacedPhrase ?? HELD_PHRASE}` : res.replaced === 'kept' ? `it is ${res.replacedPhrase ?? KEPT_PHRASE}` : 'it is dead'}). To give the node up: \`council tree decide ${rootId} --close ${res.node}\`.`); break; } if (res.conflict) { L.push(`  Your pick: \`${memberPrevailCommand({ treeId: rootId, node: res.node })}\` (the stop lists the conflicts and their objection ids); then \`council tree resume ${rootId}\` applies it. To give the node up instead: \`council tree decide ${rootId} --close ${res.node}\`.`); break; } L.push(`  Your choice: \`${memberContinueCommand({ treeId: rootId, node: res.node })}\` (more rounds, under its own grant) or \`${memberFinishCommand({ treeId: rootId, node: res.node })}\` (the dispute stage and the handoff run, the result stays not agreed); then \`council tree resume ${rootId}\` applies it. To give the node up instead: \`council tree decide ${rootId} --close ${res.node}\`.`); break;
    case 'budget_stop': L.push(`${at} stopped at its budget cap.`); stopped(); L.push(`  Resuming it needs a larger grant: \`council tree decide ${rootId} --top-up ${res.node} --amount <usd>\`.`); break;
    case 'abandoned': L.push(res.sentence); break;
    case 'tree_refused':
      // the member's detail often ENDS with a full stop (its remedy sentences do): one is stripped, so the line does not end ".."
      L.push(`The tree refused to start or resume ${at} (exit 19)${res.detail ? `: ${String(res.detail).trim().split('\n').slice(-3).join(' ').slice(0, 400).replace(/[.\s]+$/, '')}` : ''}. Nothing was spent.`);
      // C&C 12 Oct (the active-dead-node finding): a dead node that is still the active one holds the slot - nothing else can register or start while it does - and the person already typed the decision that replaced it: the way out is named
      if (res.deadNode) L.push(`  ${res.node}@g${res.generation} is dead: it was ${DEAD_REASON}, and it still holds the active slot, so no other node can start. Close it: \`council tree decide ${rootId} --close ${res.node}@g${res.generation}\`.`);
      break;
    case 'crashed':
      if (res.priceRefused) {       // B-DRAFT (C4b): the words for a member stopped by a price refusal (exit 24); replaces "ended with exit code 24 and no result"
        const [head, ...rest] = priceStopLines({ at, rootId, reason: res.priceRefused.reason, kind: res.priceRefused.kind, chain: res.priceRefused.chain });
        L.push(head); stopped(); for (const l of rest) L.push(l);       // the head, the list of stop files, then the cause and the way on
        break;
      }
      if (res.ranNothing) {
        // c4: no run.json: the run never began, so nothing was spent and, when it printed a cause, "try it once more" would meet the same refusal; the tail of what it printed says why, and the way out is named (with no cause printed the line offers both moves, E75)
        L.push(`${at} did not start (exit code ${res.exitCode}, no run was made, nothing was spent).`);
        const cause = crashCauseLines(res.detail);
        for (const l of cause) L.push(`  ${l}`);
        if (cause.length === 0) L.push('  It printed nothing that says why.');                  // an empty or all-noise tail: say so, never point "above" at nothing
        // E75 (M7): with no cause printed there is nothing to fix, so the line offers the two moves that exist (try it once more, or close it) instead of "Fix the cause"
        stopped(); L.push(cause.length === 0
          ? `  Run \`council tree resume ${rootId}\` to try it once more, or close it with \`council tree decide ${rootId} --close ${res.node}\`.`
          : `  Fix ${cause.length === 1 ? 'what the line above says' : 'what the lines above say'} and run \`council tree resume ${rootId}\` again, or close it with \`council tree decide ${rootId} --close ${res.node}\`.`);
        break;
      }
      L.push(`${at} ended with exit code ${res.exitCode} and no result.`); stopped(); L.push(`  Run \`council tree resume ${rootId}\` to try it once more, or leave it.`); break;
    case 'start_failed': L.push(`${at} could not be started: ${res.error}`); break;
    case 'interrupted': L.push(`${at} was interrupted (its process is gone, its run did not end). Run \`council tree resume ${rootId}\` to resume it once.`); break;
    case 'running_elsewhere': L.push(`${at} is running in another process. Nothing was started.`); break;
    case 'refused': L.push(`${res.node} was not registered (${res.check}): ${res.detail}`); break;
    case 'blocked':
      L.push(`The tree is blocked: ${(res.reasons ?? []).join(', ')}. Nothing was started.`);
      if (res.rootAffected) {
        const ra = res.rootAffected;
        L.push(`  An obligation the root carries is in question (root_affected). ${ra.milestones.length ? `Answer the root stop${ra.stopIds.length === 1 ? ` ${ra.stopIds[0]}` : 's'} in place: \`council tree decide ${rootId} --milestone ${ra.milestones.join('` or `--milestone ')}${ra.stopIds.length === 1 ? ` --stop ${ra.stopIds[0]}` : ''}\`, or with a new root plan: \`council tree decide ${rootId}${ra.stopIds.length === 1 ? ` --stop ${ra.stopIds[0]}` : ''}\`.` : `The root's split has no needs-decision milestone, so the route is a new root plan: \`council tree decide ${rootId}${ra.stopIds.length === 1 ? ` --stop ${ra.stopIds[0]}` : ''}\`.`}`);
      }
      break;
    case 'stopped_by_person': L.push('A stop is in force: no further node starts.'); break;
    case 'limit_reached': L.push(res.detail); break;
    default: L.push(`The sitting ended: ${res.status}.`);
  }
  return L;
}
/** The nodes stopped at their budget cap that a top-up and a resume can still bring back, in path order. S8 G8: a DEAD stopped node (deadKeys: its plan was replaced) is never resumed and its top-up is refused, so it is not listed as waiting for one. */
export function stoppedNodesOf(state) {
  const dead = deadKeys(state);
  return [...state.nodes.values()].filter(n => n.phase === 'stopped' && !dead.has(`${n.node}@g${n.generation}`)).sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation));
}
/** Exit 20 (0.8.3): the sitting STOPPED FOR A PERSON and nothing broke: a stop holds children back (`held_by_stop`), or a sitting ran its step belt (`limit_reached`). Never 0 (not finished), and not 1, the fallback for "other" (crashed...), so a script can tell "a person must answer" from "something broke". Documented in README.md; src/cli.js names the same number (a test compares them). */
export const EXIT_STOPPED_FOR_PERSON = 20;
/** What a member run's exit code means at tree level (the resume paths; tree-run.js maps the same codes at start): 23 = a layered member stopped at its overseer limit, NOT agreed, waiting for the person's choice - never "crashed" (round semantics 2b); 25 = a member stopped at a conflict the decider asked about, waiting for the person's pick. */
export const STATUS_OF_EXIT = Object.freeze({ 3: 'waiting', 4: 'budget_stop', 19: 'tree_refused', 23: 'awaiting_choice', 25: 'awaiting_choice' });
const EXIT_OF = { held_by_stop: EXIT_STOPPED_FOR_PERSON, limit_reached: EXIT_STOPPED_FOR_PERSON, awaiting_choice: EXIT_STOPPED_FOR_PERSON, nothing_to_do: 0, stopped_by_person: 0, waiting: 3, budget_stop: 4, tree_refused: 19, abandoned: 19 };       // ROADMAP 57: the code the README defines as "a tree refused a start or resume that its record does not allow"

/**
 * The exit code of a finished sitting. A BLOCKED tree exits 20 when a person can act (root_affected: answer the root stop; parent_changed: approve again) and 1 when something is broken (record_corrupt, or a reason this
 * function does not know): "stopped for a person" and "broken" stay different codes (C&C, 9 Oct).
 */
export function exitCodeOf(sitting) {
  if (sitting.status === 'blocked') return (sitting.reasons ?? []).length && sitting.reasons.every(r => r === 'root_affected' || r === 'parent_changed') ? EXIT_STOPPED_FOR_PERSON : 1;
  // an approval that waits (a replacement frontier or an ordinary first split) is a human gate: 0 would let a script read "done" there (C&C, 9 Oct)
  if (sitting.status === 'nothing_to_do' && sitting.approvalWaits === true) return EXIT_STOPPED_FOR_PERSON;
  if (sitting.status === 'nothing_to_do' && (sitting.refusedForBudget ?? []).length) return EXIT_STOPPED_FOR_PERSON;      // D3 F9-1: money is the person's to raise
  return EXIT_OF[sitting.status] ?? 1;
}

/** `council tree resume`. `deps` = { startRun, resumeRun, startRootRun } is the seam a test uses (`startRootRun` has `api.run`'s shape: the root is a run, not a bundle). Returns the exit code: 0 nothing more to do, 3 waiting for an answer, 4 budget stop, 20 stopped for a person (an open stop or a pending replacement holds children back, or the step belt ran out; the end text says what to do), 19 refused by the tree, 1 anything else that needs the person. */
export async function resumeHandler({ rootDir, rootId, work, stdout, stderr, now, facts, deps = {} }) {
  // everything printed may quote a run folder or a provider (STOPPED-* files, an output tail): control and bidi characters are removed (src/terminal-safe.js), as the CLI does for its log lines
  const out = s => stdout.write(`${terminalSafe(s)}\n`); const err = s => stderr.write(`${terminalSafe(s)}\n`);
  const startRun = deps.startRun ?? apiStarter({ work });
  const resumeRun = deps.resumeRun ?? apiResumer({ work });
  const startRootRun = deps.startRootRun ?? (opts => api.run(opts));
  const runsDir = dirname(rootDir);
  // ROADMAP 57: an abandoned tree is final. A FAST PATH before the sitting lock (nothing is touched: no lock file, no stop marker, no recovery, no root start) and the AUTHORITY under it, read again: a concurrent `decide --abandon` can land between the two
  { const final = finalSentenceOf(rootDir); if (final) { out(final); return EXIT_OF.abandoned; } }
  let release;
  try { release = acquireRunLock(treeDirOf(rootDir), { file: SITTING_LOCK_FILE }); }
  catch (e) {
    if (e instanceof RunLockedError) { err(e.holder?.unreadable ? `council tree resume: ${e.message} Nothing was started.` : `council tree resume: another sitting of this tree is running (pid ${e.holder?.pid} on ${e.holder?.host}). Nothing was started.`); return 1; }
    err(`council tree resume: could not take the sitting lock (${e.code || e.message}). Nothing was started.`); return 1;
  }
  try {
    { const final = finalSentenceOf(rootDir); if (final) { out(final); return EXIT_OF.abandoned; } }
    if (clearStop(rootDir)) out('The stop was removed.');
    // the RECORD-ONLY PHASE first (D2 F5b, Q3; the sitting's own: src/tree-run.js recordOnlyPhase): a run that ended and left no end event, a dead post-run claim, a recorded decision's opening, a finished split's verification, a stop
    // whose cause is gone. So what is described below is what the record says, and a block whose way out needs one of these facts is not a loop
    const phase = await recordOnlyPhase(rootDir, { work, facts, now });
    const record = readTreeRecord(rootDir);
    if (record.corrupt.length) { err(`council tree resume: the tree record is corrupt (${record.corrupt.map(c => c.reason).join('; ')}). Nothing was started.`); return 1; }
    const state = stateOf(record);
    // a standing block ends the sitting BEFORE any resume of an active node (a paid resume never starts under a block): runTree's own blocked branch prints the reasons and the remedy (root_affected: answer the root stop in place;
    // parent_changed: approve again) and exitCodeOf gives 20 for a block a person can act on (R6, Opus 4-1 / Fable Q4-3)
    if (state.sticky.size) {
      // REVERSED by Q3 (Muad 25 Okt 2026 14:45 "Yes to all" on Astra's list: "allow narrowly defined free reconciliation under a block; keep execution blocked"; D2 F5b): the old rule here was "nothing is verified, detected or recovered:
      // a person asking 'what now?' under a block must not change the record". The record-only phase above now runs under a block too (its writes are facts already true, each checked by the table); nothing is started, resumed or
      // registered here, and nothing that authorizes spend is written.
      const blocked = { status: 'blocked', started: [], verified: phase.verified, stops: [], restored: phase.restored, unchecked: phase.unchecked, ...sittingFacts(rootDir), ...blockedFacts(record, state, runsDir) };
      for (const l of sittingLines(blocked, rootId)) out(l);
      return exitCodeOf(blocked);
    }
    // a root that was never started is started FIRST (no run is active, nothing else can be): the pin in tree.json is the task, the cap is the tree's own. The tree is already open (its original `tree start` was the person's request and its cap is in tree.json), so the cap is said before the launch
    const rootUnstarted = rootUnstartedOf(state, runsDir);                 // ONE predicate with the readers (src/tree-root-unstarted.js); the same test this line held inline
    if (rootUnstarted) {
      const began = await beginRoot(rootDir, { work, startRun: startRootRun, now, announce: a => out(`Starting the root plan of tree ${a.treeId} on ${a.chain} (task ${a.task}): up to ${formatUsd(a.capUsd)}, ${Math.abs(a.capUsd - a.capInForceUsd) <= MONEY_EPS ? 'the cap now in force for this tree' : `the grant already recorded for the root plan (the cap now in force for the whole tree is ${formatUsd(a.capInForceUsd)})`}.`), onOutput: (s, stream) => (stream === 'stderr' ? stderr : stdout).write(s) });
      if (began.code !== 0) {
        // the root's exit code in this command's set: 3 waiting, 4 budget stop, 19 refused by the tree; a refusal, a launch that threw, or any other code is 1 (the root's own code and the next step are named)
        const status = STATUS_OF_EXIT[began.code];
        if (began.refusal) err(`council tree resume: ${began.refusal}`);
        else if (began.launchError) err(`council tree resume: the root run could not be started: ${began.launchError}. Nothing was spent. Fix the cause, then run: council tree resume ${rootId}`);
        else if (status) {
          const needs = status === 'waiting' ? readdirSync(rootDir).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(rootDir, f.slice('NEEDS-'.length)))).sort() : [];
          for (const l of sittingLines({ status, started: [], node: 'R', generation: 1, runId: rootId, exitCode: began.code, deadNode: false, stopped: stoppedReasonsOf(rootDir).map(x => `${x.name}: ${x.text}`), detail: null, needs }, rootId)) out(l);
        } else err(`council tree resume: the root run of tree ${rootId} ended with exit code ${began.code}${existsSync(join(rootDir, 'run.json')) ? '' : ' (no run was made, nothing was spent)'}. Fix what the lines above say, then run: council tree resume ${rootId}`);
        // the root run may have moved the record: the two views are written from it, as `tree start` does after its root run
        for (const p of writeTreeFiles(rootDir, { work })) err(fileProblemLine(rootDir, p));
        return status ? EXIT_OF[status] : 1;
      }
    }

    // a node stopped at its budget cap resumes only after the person raised its grant (a grant_issued after the stop; the top-up form is `decide --top-up`, M5d)
    const toppedUpSinceStop = n => { let stopAt = -1; let topAt = -1; record.events.forEach((e, i) => { if (e.node !== n.node || e.generation !== n.generation) return; if (e.event === 'node_stopped') stopAt = i; if (e.event === 'grant_issued') topAt = i; }); return stopAt >= 0 && topAt > stopAt; };
    const stoppedNodes = stoppedNodesOf(state);
    for (const n of stoppedNodes) if (!toppedUpSinceStop(n)) out(`${n.node} (run ${n.runId}) stopped at its budget cap and is not resumed by this command: its grant must be raised first (\`council tree decide ${rootId} --top-up ${n.node} --amount <usd>\`).`);

    // at most ONE node, once: the interrupted active node, else the first stopped node that was topped up
    const active = rootUnstarted ? null : state.active ? state.nodes.get(state.active) : stoppedNodes.find(toppedUpSinceStop) ?? null;
    if (active && (active.phase === 'running' || active.phase === 'stopped')) {
      const dir = join(runsDir, active.runId);
      if (pausedAtExternalSeat(dir)) {
        const res = { status: 'waiting', started: [], node: active.node, runId: active.runId, needs: readdirSync(dir).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(dir, f.slice('NEEDS-'.length)))).sort() };
        for (const l of sittingLines(res, rootId)) out(l);
        return EXIT_OF.waiting;
      }
      if (active.phase === 'running' && active.claim && claimAlive(active.claim, facts)) { out(`${active.node} (run ${active.runId}) is running in another process. Nothing was started.`); return 1; }
      const pendingChoice = replacedOf(state, `${active.node}@g${active.generation}`) ? null : pendingChoiceOf(dir, active);   // member verb: the person's recorded choice for THIS stop (derived; a choice for another stop id is not pending)
      if (active.phase === 'running' && waitsForChoice(runEndOf(dir)) && !pendingChoice) {       // round semantics 2b: stopped at its overseer limit, waiting for a choice: nothing to resume, no node_resumed written
        const res = { status: 'awaiting_choice', started: [], node: active.node, runId: active.runId, conflict: runEndOf(dir)?.kind === 'conflict_stopped', stopped: [], replaced: replacedOf(state, `${active.node}@g${active.generation}`) };
        for (const l of sittingLines(res, rootId)) out(l);
        return EXIT_OF.awaiting_choice;
      }
      if (pendingChoice) { try { applyChoice(dir, pendingChoice); } catch (e) { err(`${active.node}'s choice could not be applied: ${e?.message ?? e}. Nothing was started.`); return 1; } if (!pendingChoice.applied) out(`${active.node} (run ${active.runId}): your choice for its stop (${pendingChoice.choice}) is applied.`); }
      const before = resumeCountOf(record, active.node, active.generation);
      out(`Resuming ${active.node} (run ${active.runId}): resume number ${before + 1} of this node.`);
      for (const s of stoppedReasonsOf(dir)) out(`  earlier: ${s.name}: ${s.text}`);
      const grantTotal = Math.round((active.grant.amount + active.topUps.reduce((a, t) => a + t.amount, 0)) * 1e6) / 1e6;
      let res;
      try { res = await resumeRun({ rootDir, work, node: active.node, generation: active.generation, runId: active.runId, runDir: dir, maxUsd: grantTotal }); }
      catch (e) { err(`${active.node} could not be resumed: ${e?.message ?? e}`); return 1; }
      const code = res?.exitCode;
      if (code !== 0) {
        const status = STATUS_OF_EXIT[code] ?? 'crashed';
        const after = readTreeRecord(rootDir);
        // BUG-C-055 (bug audit 24 Okt 2026): a member refused at its price limit (exit 24) is explained here as tree-run.js explains it at the start: the marker's price lines, with the stop FILES listed by name only (as tree-run.js does)
        const registered = after.events.find(e => e.event === 'node_registered' && e.node === active.node && e.generation === active.generation);
        const priceRefused = code === 24 ? priceRefusedOf(dir, registered?.chain?.name ?? null) : null;
        const r2 = { status, started: [], node: active.node, generation: active.generation, runId: active.runId, exitCode: code, conflict: code === 25, deadNode: code === 19 && isDeadNode(rootDir, active.node, active.generation), stopped: priceRefused ? stoppedReasonsOf(dir).map(s => s.name) : stoppedReasonsOf(dir).map(s => `${s.name}: ${s.text}`), detail: res?.outputTail ?? null, needs: [], ...(priceRefused ? { priceRefused, ranNothing: false } : {}) };
        out(`Resume number ${resumeCountOf(after, active.node, active.generation)} of ${active.node} ended with exit code ${code}.`);
        for (const l of sittingLines(r2, rootId)) out(l);
        return EXIT_OF[status] ?? 1;
      }
    }

    const sitting = await runTree(rootDir, { work, startRun, resumeRun, facts, now, sittingLockHeld: true });
    for (const l of sittingLines(sitting, rootId)) out(l);
    return exitCodeOf(sitting);
  } finally {
    release();
  }
}
