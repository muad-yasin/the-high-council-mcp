// The tree loop, part 2: one SITTING (0.8.3 M5c2; PLAN 8.1, 8.3 steps 2-5, 10.1 `tree stop`, M5 exit checks L1, L19). `runTree` registers and starts the approved children one at a time until something needs a person or there is
// nothing left to do, and returns why it stopped. It never decides anything a person decides: it starts no frontier that is not approved, resumes no interrupted execution (that is `tree resume`, src/tree-resume.js: it ends the sitting as `interrupted`), retries no failure, and sends a registered node down the resume path only for its FIRST claim when an earlier start was refused before the claim and left a run.json (the run id cannot be started twice), and
// reads the record again before every step, so a `decide` or a `tree stop` from another terminal takes effect at the next step.
//
// A sitting's steps, each after re-reading the record:
//   0. a STOP marker (`tree/STOP`, written by `council tree stop`; not an event: the record is for authorizations) ends the sitting before anything is registered or started; a child that is running continues to its
//      next pause or end on its own;
//   1. record-only reconciliation (a run that ended and left no end event gets it, src/tree-recovery.js) - never a start or a resume;
//   2. closed nodes are verified (src/tree-loop.js verifyClosedNodes);
//   3. a node that is already active decides the step: registered and never started -> start it with the registered id and grant; paused at an external seat -> the sitting ends, `waiting` (no sibling starts, PLAN 8.1);
//      running with a live claim -> `running_elsewhere`; running with a dead claim -> `interrupted` (an ordinary execution to resume: `tree resume`, never here);
//   4. otherwise the next child is registered (src/tree-loop.js registerNextChild) and started.
// Starting a run is injected (`startRun`); the default is api.run with the bundle's own files, the registered run id, the node file and the grant as the cap (the child's own CLI clamps it to its lifetime cap). The tree
// lock is NEVER held across the start: the child's memberStart takes the same lock and gives up after about two seconds. The exit code of a run is read and never retried: 0 goes on, 3 (an external seat) ends the sitting
// as `waiting`, 4 (the cap) as `budget_stop`, 19 (the tree refused the start) as `tree_refused`, anything else as `crashed` with the run folder's STOPPED-* files named.
import { priceRefusedOf } from './tree-price-stop.js';
import { rebuildRegisteredBundle, setAsideStaleRunFolder } from './tree-rebuild.js';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as api from './api.js';       // a STATIC import: a packaged binary cannot run a dynamic one (test/binary-packaging.test.js)
import { RunLockedError, acquireRunLock, lockHolder } from './run-lock.js';
import { claimAlive, deadKeys, heldPhraseOf } from './tree-transitions.js';
import { TREE_DIR, TreeRefusal, readTreeRecord, stateOf, treeDirOf } from './tree-record.js';
import { treePiiModeFrom } from './tree-pii-mode.js';
import { pausedAtExternalSeat, runEndOf, waitsForChoice } from './tree-member.js';
import { recoverTree } from './tree-recovery.js';
import { bundleDirOf } from './tree-continuation.js';
import { registerNextChild, verifyClosedNodes } from './tree-loop.js';
import { detectIntegrationStops, detectStops } from './tree-detect.js';
import { computeReadiness, recordReadinessAfter } from './tree-readiness.js';
import { openBlockedChildStops } from './tree-blocked-child.js';
import { UNCHECKED_WHY, restoreClosedStops } from './tree-restore.js';
import { waitingForMoney } from './tree-budget.js';
import { rootRemedies } from './tree-decide-stop.js';
import { findPendingFrontier } from './tree-frontier.js';
import { needsDecisionStopText, sittingFacts } from './tree-stop-view.js';
import { renderIntegrationStopRecovered, renderIntegrationStopUnreadable } from './tree-stop.js';
import { SITTING_LOCK_FILE, fileProblemLine, writeTreeFiles } from './tree-files.js';
import { finalSentenceOf } from './tree-abandon.js';
import { pendingChoiceOf, replacedOf } from './tree-choice.js';
import { STOP_MARKER, stopMarkerPath, stopRequested } from './tree-stop-marker.js';

// `STOP_MARKER`, `stopMarkerPath` and `stopRequested` live in src/tree-stop-marker.js (a leaf, so the view files can read the marker); re-exported here for every existing importer.
export { STOP_MARKER, stopMarkerPath, stopRequested };
/** `council tree stop`: no further node starts. A marker, not an event (the record holds authorizations); it fails safe, and `tree resume` removes it. */
export function requestStop(rootDir, { now = () => Date.now() } = {}) {
  mkdirSync(treeDirOf(rootDir), { recursive: true });
  writeFileSync(stopMarkerPath(rootDir), `${JSON.stringify({ requestedAt: new Date(now()).toISOString(), by: 'council tree stop' })}\n`);
}
export function clearStop(rootDir) { try { unlinkSync(stopMarkerPath(rootDir)); return true; } catch { return false; } }

// `writeTreeFiles` and `SITTING_LOCK_FILE` live in src/tree-files.js (below the readiness module, so a verb can write the files too); re-exported here for every existing importer.
export { writeTreeFiles, SITTING_LOCK_FILE };

/** The default starter: api.run with the bundle's own files (the child's CLI checks them against the registration by content hash). */
export function apiStarter({ work }) {
  return async ({ rootDir, chain, bundleDir, runId, grantUsd }) => {
    // S5b: the tree's personal-data mode (tree.json is its one source) goes to the member as its own --pii-gate; an unusable field passes nothing and the member's start refuses it (src/tree-member.js memberStart)
    const piiMode = treePiiModeFrom(readTreeRecord(rootDir).tree);
    // A ROOT bundle (R@g2 and later, src/tree-root-replan.js rootBundle) has no criteria.json: the root makes its own criteria. Leaving the flag out for a bundle that has none is safe for every other member: the file is part of the
    // bundle hash the member's CLI re-checks (continuationRefusal 'bundle'), so a child whose criteria.json was taken away is refused there (exit 19) before any provider call - the flag is never what protects it.
    const criteriaFile = join(bundleDir, 'criteria.json');
    return api.run({ chain, task: join(bundleDir, 'task.md'), ...(existsSync(criteriaFile) ? { criteria: criteriaFile } : {}), context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), ...(piiMode.status === 'on' ? { piiGate: piiMode.mode } : {}), cwd: work, maxUsd: grantUsd });
  };
}

/** The default resumer: api.resume with the node's whole grant as the cap (a resume without --max-usd would inherit the cap run.json recorded at the first start). */
export function apiResumer({ work }) {
  return async ({ runDir, maxUsd }) => {
    return api.resume({ runDir, cwd: work, maxUsd });
  };
}

/** What recovery needs to know about a run folder, from its files alone (src/tree-member.js). */
export const runFactsOfIn = runsDir => runId => {
  const dir = join(runsDir, runId);
  return { hasRunJson: existsSync(join(dir, 'run.json')), runDir: dir, end: runEndOf(dir), paused: pausedAtExternalSeat(dir) };
};
const stoppedFilesOf = (runsDir, runId) => { try { return readdirSync(join(runsDir, runId)).filter(f => /^STOPPED-/.test(f)).sort(); } catch { return []; } };
const needsFilesOf = (runsDir, runId) => { try { return readdirSync(join(runsDir, runId)).filter(f => /^NEEDS-.*\.md$/.test(f)).sort(); } catch { return []; } };

/**
 * One sitting. -> { status, started: [{ node, generation, runId, exitCode }], verified: [...], ...why } with status one of:
 *   stopped_by_person | blocked | waiting | budget_stop | tree_refused | crashed | start_failed | interrupted | running_elsewhere | refused | held_by_stop | nothing_to_do | limit_reached
 * `maxStarts` is a belt: a sitting of that many steps stops as `limit_reached` (NOT nothing_to_do: children may still wait; a loop that cannot end is a defect, not a feature).
 */
export async function runTree(rootDir, { work, startRun = apiStarter({ work }), resumeRun = apiResumer({ work }), facts, now, rootTaskPath, maxStarts = 100, hooks = {}, sittingLockHeld = false } = {}) {
  // MECHANICAL, not a convention (C&C, 9 Oct): a sitting runs under the sitting lock. A caller that already holds it (`tree resume`) says so and is checked: the lock file must name THIS process. Anyone else gets the lock
  // taken here, and a sitting that finds another one running THROWS (RunLockedError) instead of starting anything.
  let release = null;
  if (sittingLockHeld) {
    const holder = lockHolder(treeDirOf(rootDir), { file: SITTING_LOCK_FILE });
    if (!holder || holder.pid !== process.pid) throw new Error('runTree: sittingLockHeld was claimed but this process does not hold tree/.sitting.lock');
  } else {
    mkdirSync(treeDirOf(rootDir), { recursive: true });
    release = acquireRunLock(treeDirOf(rootDir), { file: SITTING_LOCK_FILE });
  }
  try { return await sitting(rootDir, { work, startRun, resumeRun, facts, now, rootTaskPath, maxStarts, hooks }); } finally { if (release) release(); }
}

/** True when the node is DEAD in the record (deadKeys: replaced or set aside by a decision, or a node above it was). A dead node that is still the ACTIVE one is refused by its own continuation check at every start or resume (exit 19) and holds the active slot, so the sitting names the way out. */
export function isDeadNode(rootDir, node, generation) {
  return deadKeys(stateOf(readTreeRecord(rootDir))).has(`${node}@g${generation}`);
}

/**
 * THE RECORD-ONLY PHASE of a sitting step (D2 F5a/F5b; Q3, Muad 25 Okt 2026 14:45 "Yes to all" on Astra's list: ONE centralized, whitelisted reconciliation phase before the block check). In order: recovery's record-only completions
 * (src/tree-recovery.js: a finished run's end, a dead post-run claim released, a recorded decision's opening; no start, resume or registration function is given, so none runs), the verification of finished splits (split_verified or a
 * refusal line), and the sitting's close test of blocked stops (stop_restored). Each event passes the table as always; none is paid, so a sticky block refuses none of them (tree-transitions.js: only paid events are refused under a block).
 * The sitting runs it at the top of every step; `tree resume` runs it before its blocked branch, so a block whose way out needs one of these facts is no longer a loop. -> { verified, restored, unchecked }.
 */
export async function recordOnlyPhase(rootDir, { work, facts, now, afterSnapshot = null } = {}) {
  const runsDir = dirname(rootDir);
  await recoverTree(rootDir, { runFactsOf: runFactsOfIn(runsDir), facts, now });     // record-only appends: no start, no resume function is given
  const verified = verifyClosedNodes(rootDir, { work, facts, now });
  // RESTORE GAP (gate page sections 3, 8-10; C&C 14 Oct 2026). WHY THE SITTING MAY CLOSE EVEN THE ROOT'S STOP, and why that is never the sitting answering the root: (a) Muad 14 Oct 2026 00:02: "byte-identical to a recorded hash = closed automatically and recorded" - a byte-identical file is the RUN'S OWN file back, nobody's decision, node or root alike; (b) where a DECISION is made the root stays the PERSON's: a CHANGED plan (packet 3 #4, commits 2b/2c) and the repaired approach of a re-plan (11 Oct). Lock order: this sitting holds the SITTING lock (outermost); restoreClosedStops takes the TREE lock inside it and releases it before afterStep takes it again: always sitting -> tree, never nested the other way (nothing takes the sitting lock while holding the tree lock: grep acquireRunLock). BEFORE detectStops and afterStep, so the verdict afterStep records already reflects the closed stop. It appends only `stop_restored` (actor 'sitting') for a blocked stop whose files are back byte for byte;
  // a node that still has another reason gets a NEW stop from the sitting's afterStep. A lock held elsewhere never replaces the sitting's real result: the next step asks again.
  let restored = []; let unchecked = [];
  try { const rs = restoreClosedStops(rootDir, { runsDir, now, facts, work, afterSnapshot }); restored = rs.filter(r => r.restored); unchecked = rs.filter(r => UNCHECKED_WHY.includes(r.why)); } catch (e) { if (!(e instanceof RunLockedError)) throw e; }     // ONLY a busy lock is skipped (the next step asks again); a TreeRefusal here is the library and the table DISAGREEING, a defect that must surface, not a step to skip (and a refused append also writes a blocked line)
  return { verified, restored, unchecked };
}

async function sitting(rootDir, { work, startRun, resumeRun, facts, now, rootTaskPath, maxStarts, hooks }) {
  const runsDir = dirname(rootDir);
  const restored = [];       // the stops the SITTING closed this time (restore gap: a damaged file put back exactly as the run produced it); shown by sittingLines
  let unchecked = [];       // (Astra (a), D2 F4c) the stops whose check could NOT RUN at the last step (not a check that ran and failed): said apart, so nobody reads them as failures; replaced at each step
  const started = []; const verified = []; const stops = []; const fileProblems = []; const integrationGaps = [];
  // M6 S3 (PLAN 9.2): after every tree step the verdict is recorded when it (or what it rests on) changed. A step is one pass of the loop below; the state a start leaves behind is recorded at the next pass or, when a start ends the
  // sitting, when the result is built. Skipped when the record has not moved since the last call (nothing a step could have changed is outside the record except run files, which only a person edits).
  let recordedAt = null; let rootBlocked = [];
  const afterStep = () => {
    const at = readTreeRecord(rootDir).events.at(-1)?.id ?? null;
    if (at !== null && at === recordedAt) return;
    // a lock held elsewhere or a refused record write must never replace the sitting's real result: the next step records it - so a SKIPPED attempt is not remembered, and an unchanged record is asked again
    let out;
    try {
      // the verdict is computed ONCE for this step; a child it blocks at node level gets its stop first (so the recorded verdict carries it), then the verdict is recorded
      const computed = computeReadiness(rootDir, { work });
      if (!computed.unreadable) rootBlocked = computed.verdict.reasons.filter(r => r.severity === 'blocked' && /^R@g\d+$/.test(r.scope)).map(r => ({ code: r.code, text: r.text }));       // the ROOT's own blocked reasons, whichever root generation is the live one (readiness judges the newest generation only); S8 G9 opens a stop for it, answered by a new root plan
      const opened = computed.unreadable ? [] : openBlockedChildStops(rootDir, { verdict: computed.verdict, now });
      stops.push(...opened.map(e => ({ id: e.id, node: e.node, generation: e.generation, affected: e.affected, text: needsDecisionStopText(rootDir, e) })));
      out = (hooks.recordReadiness ?? recordReadinessAfter)(rootDir, { work, now, writeFiles: false, ...(opened.length || computed.unreadable ? {} : { precomputed: computed }) });
    } catch (e) { if (e instanceof RunLockedError || e instanceof TreeRefusal) out = { skipped: 'lock_busy' }; else throw e; }
    if (!out.skipped) recordedAt = readTreeRecord(rootDir).events.at(-1)?.id ?? null;
    // the record has moved (and the verdict is recorded): write the two files from it. Each problem is kept once (a full disk repeats itself on every step); a hook that itself throws is a problem too, never a crash.
    let problems;
    try { problems = (hooks.writeFiles ?? writeTreeFiles)(rootDir, { work }); } catch (e) { problems = [{ file: 'tree files', error: String(e?.message ?? e).split('\n')[0].slice(0, 300) }]; }
    for (const p of problems ?? []) if (!fileProblems.some(x => x.file === p.file && x.error === p.error)) fileProblems.push(p);
  };
  const result = (status, extra = {}) => { afterStep(); return { status, started, verified, stops, restored: [...restored], unchecked: [...unchecked], rootBlocked, fileProblems: [...fileProblems], integrationGaps: [...integrationGaps], ...sittingFacts(rootDir), ...extra }; };
  const runIt = async ({ node, generation, runId, chain, grantUsd }) => {
    const bundleDir = bundleDirOf(rootDir, node, generation);
    let res;
    // A registered node whose run folder already has a run.json (an earlier start was REFUSED before its claim, e.g. a parent_changed) cannot be started again with its run id (a new run never writes into an existing folder):
    // it is started through the resume path, which is still its FIRST claim (the member's CLI chooses node_started or node_resumed from the record, never from --resume), under the grant as the cap.
    // NARROWED (gate page 14.13): only a run.json whose contextHash equals the node's current input reaches this path; one that holds the hash of an OLDER input was moved aside by setAsideStaleRunFolder just before, so this is a fresh start.
    const folder = join(runsDir, runId);
    try { res = existsSync(join(folder, 'run.json')) ? await resumeRun({ rootDir, work, node, generation, runId, runDir: folder, maxUsd: grantUsd }) : await startRun({ rootDir, work, node, generation, runId, chain, bundleDir, grantUsd }); }
    catch (error) { started.push({ node, generation, runId, exitCode: null }); return result('start_failed', { node, generation, runId, error: String(error?.message ?? error) }); }
    started.push({ node, generation, runId, exitCode: res?.exitCode ?? null });
    const code = res?.exitCode;
    const named = { node, generation, runId, exitCode: code };
    if (code === 0) return null;                                                       // the next step re-reads the record
    if (code === 3) return result('waiting', { ...named, needs: needsFilesOf(runsDir, runId) });
    if (code === 4) return result('budget_stop', { ...named, stopped: stoppedFilesOf(runsDir, runId) });
    // round semantics 2b: a layered member stopped at its overseer-round cap or a layer's revision bound (exit 23): resumable, NOT agreed, waiting for the PERSON's choice (continue / finish), not a crash
    if (code === 23) return result('awaiting_choice', { ...named, stopped: stoppedFilesOf(runsDir, runId) });
    // the decider asked for the person at a conflict (exit 25, cli.js): the same wait, with its own verb (`--prevail-node`)
    if (code === 25) return result('awaiting_choice', { ...named, conflict: true, stopped: stoppedFilesOf(runsDir, runId) });
    if (code === 19) return result('tree_refused', { ...named, detail: res?.outputTail ?? null, deadNode: isDeadNode(rootDir, node, generation) });
    // c4: a run that crashed BEFORE any run was made (no run.json in its folder) is not "try it once more": the same refusal comes back until its cause is fixed (the sitting line says so)
    // C4b (A3a commit 2 wrote STOPPED-price_refused.json at exit 24): a member a PRICE REFUSAL stopped is not an unexplained crash; the sitting says why (the marker's own sentence) and what to do
    const priceRefused = code === 24 ? priceRefusedOf(join(runsDir, runId), chain) : null;
    if (priceRefused) return result('crashed', { ...named, stopped: stoppedFilesOf(runsDir, runId), priceRefused, ranNothing: false });
    return result('crashed', { ...named, stopped: stoppedFilesOf(runsDir, runId), detail: res?.outputTail ?? null, ranNothing: !existsSync(join(runsDir, runId, 'run.json')) });
  };

  for (let step = 0; step <= maxStarts; step += 1) {
    // ROADMAP 57: an abandoned tree is final. Checked at the TOP of every step, before the stop marker, recovery, the closed-node check, both stop detectors and afterStep - every one of them writes to the record - and the result is built here, NOT
    // through result(): result() runs afterStep() first (openBlockedChildStops, recordReadinessAfter), which the table would refuse and answer with a `blocked: transition_refused` line on a final tree. The sitting writes nothing.
    const finalSentence = finalSentenceOf(rootDir);
    if (finalSentence) return { status: 'abandoned', started, verified, stops: [], rootBlocked, fileProblems: [...fileProblems], sentence: finalSentence };
    if (stopRequested(rootDir)) return result('stopped_by_person');
    // THE RECORD-ONLY PHASE (D2 F5a/F5b, Q3): recovery's completions, the verification of finished splits, the sitting's close test; `tree resume` runs the SAME phase before its blocked branch (one rule, not a copy)
    const phase = await recordOnlyPhase(rootDir, { work, facts, now, afterSnapshot: hooks.afterRestoreSnapshot });
    verified.push(...phase.verified); restored.push(...phase.restored); unchecked = phase.unchecked;
    stops.push(...detectStops(rootDir, { facts, now }).map(e => ({ id: e.id, node: e.node, generation: e.generation, affected: e.affected, text: needsDecisionStopText(rootDir, e) })));
    // a failed integration check whose stop was never written (the process ended between the verb's two records) gets its stop now; when the files that decide it do not read, nothing is written and the gap is named (fail closed)
    const gap = detectIntegrationStops(rootDir, { facts, now });
    const rootId = readTreeRecord(rootDir).tree?.treeId;
    stops.push(...gap.opened.map(e => ({ id: e.id, node: null, generation: null, affected: e.affected, text: renderIntegrationStopRecovered({ stopId: e.id, agreement: e.agreement, affected: e.affected, rootId }) })));
    for (const u of gap.unreadable) if (!integrationGaps.some(x => x.agreement === u.agreement && x.reason === u.reason)) integrationGaps.push({ ...u, text: renderIntegrationStopUnreadable({ ...u, rootId }) });
    afterStep();       // M5e: a closed node whose Status is needs_decision opens its stop (src/tree-detect.js)
    const record = readTreeRecord(rootDir);
    const state = stateOf(record);
    if (record.corrupt.length) return result('blocked', { reasons: ['record_corrupt'] });
    if (state.sticky.size) return result('blocked', blockedFacts(record, state, runsDir));
    if (step === maxStarts) return result('limit_reached', { detail: `${maxStarts} steps in one sitting: stopping. Children may still be waiting; run the command again to go on.` });

    if (state.active !== null) {
      const n = state.nodes.get(state.active);
      if (n.phase === 'registered') {
        const reg = record.events.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation);
        // REBUILD (gate page 14): a registered node that has NOT started takes its input from the plans as they stand now; a plan accepted or put back since the input was built is quoted afresh before the node starts
        const rebuilt = rebuildRegisteredBundle(rootDir, { work, rootTaskPath, facts, now });
        if (rebuilt.kind === 'refused') return result('refused', { node: rebuilt.node, check: rebuilt.check, detail: rebuilt.detail });
        // PREFLIGHT-TO-LOCK (gate page 14.13): a run folder left by a start that was refused before its claim holds the hash of an OLDER input; it is moved aside so the start below is a fresh one, not a resume that the frozen-context check refuses
        const aside = setAsideStaleRunFolder(rootDir, { facts, now });
        if (aside.kind === 'refused') return result('refused', { node: aside.node, check: aside.check, detail: aside.detail });
        const out = await runIt({ node: n.node, generation: n.generation, runId: n.runId, chain: reg.chain.name, grantUsd: n.grant.amount });
        if (out) return out;
        continue;
      }
      const dir = join(runsDir, n.runId);
      if (pausedAtExternalSeat(dir)) return result('waiting', { node: n.node, generation: n.generation, runId: n.runId, needs: needsFilesOf(runsDir, n.runId) });
      if (n.claim && claimAlive(n.claim, facts)) return result('running_elsewhere', { node: n.node, generation: n.generation, runId: n.runId });
      // CR-2G-003: a node that holds a LIVE post-run claim (a paid `handoff --from-run` call on its finished run, in another terminal or on another host: claimAlive never judges another host's claim dead) is being worked on, as a live run claim is; a DEAD post-run claim on this host never reaches this line, the record-only phase released it above
      if (n.postRun && claimAlive(n.postRun, facts)) return result('running_elsewhere', { node: n.node, generation: n.generation, runId: n.runId });
      // round semantics 2b: the member stopped at its overseer limit and waits for the person's choice: a sitting holds here (exit 20), it neither resumes it nor goes on to a sibling
      // member verb: a recorded choice for THIS stop is acted on by `tree resume` (it writes the member's entry and resumes it), not by this loop: 'interrupted' points there
      if (waitsForChoice(runEndOf(dir)) && (replacedOf(state, `${n.node}@g${n.generation}`) || !pendingChoiceOf(dir, n))) return result('awaiting_choice', { node: n.node, generation: n.generation, runId: n.runId, conflict: runEndOf(dir)?.kind === 'conflict_stopped', stopped: stoppedFilesOf(runsDir, n.runId), replaced: replacedOf(state, `${n.node}@g${n.generation}`), replacedPhrase: heldPhraseOf(state, `${n.node}@g${n.generation}`) });
      return result('interrupted', { node: n.node, generation: n.generation, runId: n.runId });
    }

    const next = registerNextChild(rootDir, { work, rootTaskPath, facts, now, deps: { shouldStop: () => stopRequested(rootDir), afterDerive: hooks.afterDerive, beforeRegister: hooks.beforeRegister } });
    if (hooks.afterRegister) await hooks.afterRegister(next);
    // a stop written while the child was being derived (contract check, file reads) is honoured before the start: the child stays registered and `tree resume` starts it after the stop is removed
    if (next.kind === 'registered' && stopRequested(rootDir)) return result('stopped_by_person', { registeredNotStarted: [{ node: next.node, generation: next.event.generation, runId: next.runId, grantUsd: next.grantUsd }] });
    if (next.kind === 'registered') {
      const out = await runIt({ node: next.node, generation: next.event.generation, runId: next.runId, chain: next.event.chain.name, grantUsd: next.grantUsd });
      if (out) return out;
      continue;
    }
    if (next.kind === 'stopped') return result('stopped_by_person', { nothingRegistered: next.node });
    if (next.kind === 'refused') return result('refused', { node: next.node, check: next.check, detail: next.detail, items: next.items });
    if (next.kind === 'blocked') return result('blocked', { reasons: next.reasons });
    if (next.kind === 'stop_opened') continue;                                       // S5b part B: a child whose input was refused got a stop instead of a registration; the next read sees it (the child is stale), so the sitting goes on with what is independent and ends held_by_stop
    if (next.kind === 'active') continue;                                              // another process registered between our read and our call: read again
    // a stop holds children back (stale, or a provider with an open stop): that is NOT "nothing to do" - the person has something to answer (M5e S3, C&C: the same class as limit_reached). An open stop with nothing left to hold back is the same: the person still has it to answer (R6, Astra F9)
    const held = (next.waiting ?? []).filter(w => w.held);
    const pendingFrontier = findPendingFrontier({ rootDir, record, state });
    const approvalWaits = pendingFrontier !== null;                  // a frontier (a replacement included) waits for `council tree approve`
    const replacementWaits = pendingFrontier?.openedBy != null;      // ... and it is a REPLACEMENT
    if (held.length || state.openStops.length) return result('held_by_stop', { approvalWaits, replacementWaits, stopIds: state.openStops, blockedStopIds: state.openStops.filter(id => record.events.find(e => e.id === id)?.source === 'blocked'), openStopsInfo: state.openStops.map(id => record.events.find(e => e.id === id)).filter(Boolean).map(e => ({ id: e.id, source: e.source ?? null, node: e.node ?? null, child: e.child?.node ?? (e.source === 'bundle_input' ? e.node : null) })), held: held.map(w => ({ node: w.node, why: w.why, sources: w.sources ?? [] })), waiting: next.waiting, awaitingApproval: next.awaitingApproval });
    // D3 F9-1: an approved child (or new root plan) that was NOT admitted for budget waits for money: the sitting names that way on (S8) and exits 20, never a 0 that a script reads as "done"
    const refusedForBudget = waitingForMoney(record, state).filter(w => w.kind === 'refused').map(w => w.key);
    return result('nothing_to_do', { approvalWaits, replacementWaits, waiting: next.waiting, awaitingApproval: next.awaitingApproval, ...(refusedForBudget.length ? { refusedForBudget } : {}) });
  }
  return result('limit_reached');
}

/**
 * What a standing block adds to a sitting's result: { reasons, rootAffected? }. root_affected (M5e S4): the result carries what answers it, so the end text stays pure (the open ROOT stops and the root milestones that can
 * clear them; none = a new root run is the only route); only the open stops a root_affected block NAMES can clear it (the root's own needs_decision stop is another stop, answered separately). One function for the sitting
 * and for `tree resume` on a blocked tree (which must write nothing before it says so: R6).
 */
export function blockedFacts(record, state, runsDir) {
  const named = new Set(record.events.filter(e => e.event === 'blocked' && e.reason === 'root_affected' && typeof e.stopId === 'string').map(e => e.stopId));
  const rootAffected = state.sticky.has('root_affected') ? { stopIds: state.openStops.filter(id => named.has(id)), milestones: rootRemedies(record, state, runsDir) } : null;
  return { reasons: [...state.sticky.keys()], ...(rootAffected ? { rootAffected } : {}) };
}

/** `council tree stop <rootId>`: writes the marker and says what it does. Reads no environment variable. */
export async function stopHandler({ rootDir, rootId, work, stdout, stderr, now }) {
  const final = finalSentenceOf(rootDir);       // ROADMAP 57: nothing is left to stop on a final tree; no marker is written
  if (final) { stdout.write(`${final} There is nothing left to stop.\n`); return 0; }
  try {
    const already = stopRequested(rootDir);
    requestStop(rootDir, { now });
    // the marker moves no record position, so no refresh would follow it: the two view files are written now (through the views lock), so they say a stop was requested; a failing write is one named line, never fatal
    for (const p of writeTreeFiles(rootDir, { work })) stderr.write(`${fileProblemLine(rootDir, p)}\n`);
    stdout.write(`${already ? 'A stop was already requested; it stands.' : 'Stop requested.'} No further node of tree ${rootId} will be registered or started. A child that is running continues to its next pause or end on its own. \`council tree resume ${rootId}\` removes the stop and goes on.\n`);
    return 0;
  } catch (e) {
    stderr.write(`council tree stop: could not write the stop marker (${e.code || e.message}). Nothing was changed.\n`);
    return 1;
  }
}
