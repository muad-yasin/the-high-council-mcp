// Accepting a CHANGED plan file (0.8.3 M6 unit 2b; gate page Review/Build_0.8.3/m6-closing/Restore_Gap_Gate_Page.md sections 10 and 12; Muad's packet-3 answer 4, 14 Oct 2026: "a CHANGED plan file: the session prepares and explains,
// ACCEPTING a change to an accepted obligation is the person's, with the diff"; his in-run rule 14 Oct 00:02: the main session and its advisor first, the person when a named condition fires).
//
// A closed node whose deliverable.md no longer hashes to what report.json records opens a `blocked` stop (plan_unreadable, usually with contract_check beside it: an edited sealed file fails both). The sitting closes that stop by itself ONLY when the bytes
// come back (src/tree-restore.js). This module is the ONE writer of `plan_accepted`, the answer for a plan that is DIFFERENT now: a person, or the session with a written reason, accepts the file as it is.
//
// Contract:
//   changedPlanSnapshot(runsDir, runId) -> { unreadable } | { report, text, bodySha256, notes, thinContractSha256, passed }
//        ONE read (report.json + deliverable.md through trustedRunDir/readRunFile). The body of a plan with no harness note above it IS the whole file; a note makes the start of a changed body ambiguous, so `notes` is returned and the writer refuses.
//   candidatePlanAccept(rootDir, { stopId, actor, via, reason, gate, runsDir }) -> { refusal, writer } | { event, facts }   (2c: the ONE source of every number and sentence; builds the event and asks the table, never appends, takes no lock)
//   acceptChangedPlan(rootDir, { stopId, actor, via, reason, gate, runsDir, now, facts, expect }) ->  (expect = the two hashes a PERSON was shown; refused under the lock when the fresh snapshot differs)
//   -> { event, previousBodySha256, acceptedBodySha256, revert }
//        The caller names only WHO answers and why. The hashes, the split hash and the scan counts are computed HERE from the one snapshot (the caller cannot pass them: a number the writer chose would be a number the table could not check).
//        Under the tree lock; appends ONE `plan_accepted` through the transition table, which owns every other refusal (each its own sentence, src/tree-transitions.js). Throws a TreeRefusal (a refusal) or a TypeError (a caller bug).
// No money: no grant, no gate spend, nothing of the tree's budget is touched.
import { dirname } from 'node:path';
import { sha256Of } from './thin-contract.js';
import { readRunFile, trustedRunDir } from './run-files.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { extractSplitBlocks, splitSha256 } from './tree-split.js';
import { approvedFrontiersOf, deadKeys, planAcceptStopRefusal, registeredChildrenOf, registeredDependentsOf, transitionRefusal } from './tree-transitions.js';
import { treeInputScanModeFrom } from './tree-pii-mode.js';
import { piiGateReport, textSecretFindings } from './run-preflight.js';
import { snapshotOfRun } from './tree-restore.js';

const refuse = reason => new TreeRefusal({ code: 'transition_refused', transition: 'plan_accepted', reason });

/** The changed file, read ONCE. { unreadable: <why> } when the run folder is refused or report.json does not read as an object. `notes`: how many harness notes the report says sit above the body. */
export function changedPlanSnapshot(runsDir, runId) {
  const trusted = trustedRunDir(runsDir, runId);
  if (trusted.refusal) return { unreadable: trusted.refusal };
  const reportFile = readRunFile(trusted.dir, 'report.json');
  let report = null;
  if (typeof reportFile.text === 'string') { try { report = JSON.parse(reportFile.text); } catch { report = null; } }
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return { unreadable: 'report.json is missing or unreadable' };
  const deliverable = readRunFile(trusted.dir, 'deliverable.md');
  if (typeof deliverable.text !== 'string') return { unreadable: 'deliverable.md is missing or unreadable' };
  return {
    report, text: deliverable.text, bodySha256: sha256Of(deliverable.text), notes: Array.isArray(report.delivered_text?.harness_notes) ? report.delivered_text.harness_notes.length : 0,
    thinContractSha256: typeof report.thin_contract?.sha256 === 'string' ? report.thin_contract.sha256 : null, passed: report.passed === true,
  };
}

/** The split hash of a plan text: null when it holds no split fence, the block's hash when it holds exactly one that parses; anything else refuses (a half-read fence is not a plan this route can describe). */
function splitHashOf(text) {
  const blocks = extractSplitBlocks(text);
  if (!blocks.length) return null;
  if (blocks.length > 1) throw refuse(`the changed plan holds ${blocks.length} split blocks; it must hold exactly one, or none`);
  let block;
  try { block = JSON.parse(blocks[0].text); } catch { throw refuse('the changed plan\'s split block does not parse as JSON'); }
  return splitSha256(block);
}

/**
 * 2c (gate page 13, C&C 14 Oct 2026): the candidate `plan_accepted` and everything a person reads before approving it, from ONE snapshot. The typed form (src/tree-decide-accept.js) asks it for its preflight, its text and its rebuild comparison; `acceptChangedPlan` asks it under the tree lock and
 * appends the SAME event, so no number or sentence has a second source. It never appends and takes no lock (its answer is a view).
 * -> { refusal, writer: true }   a refusal that comes from the file side (the stop, the record, the files, the scans): thrown by the writer with its own TreeRefusal
 *  | { refusal, writer: false, event, facts }   the TABLE refuses the event it would write (appending it throws the same sentence)
 *  | { event, facts }   accepted by every check here and by the table.
 * facts: { node, stop, previousBodySha256, acceptedBodySha256, revert, text (the new body, one read), conditions: the session-only conditions that hold (root, children, approvedFrontiers, dependents), ... }.
 */
export function candidatePlanAccept(rootDir, { stopId, actor, via, reason, gate, runsDir = dirname(rootDir) } = {}) {
  if (typeof stopId !== 'string' || !stopId) throw new TypeError('candidatePlanAccept: { stopId } is required');
  if (actor !== 'session' && actor !== 'person' && actor !== 'sitting') throw new TypeError('candidatePlanAccept: actor is session, person or sitting (sitting is refused by the table)');
  const writerRefusal = reasonText => ({ refusal: reasonText, writer: true });
  const record = readTreeRecord(rootDir);
  if (record.corrupt.length || !record.tree) return writerRefusal('the tree record does not read, so nothing can be accepted');
  const state = stateOf(record);
  const stop = record.events.find(e => e.id === stopId);
  // the state-side refusals have ONE source (the table's own function): asked before any file is read, so no sentence is written twice and no table row is bypassed
  const early = planAcceptStopRefusal(state, { stopId, node: stop?.node ?? null, generation: stop?.generation ?? null, runId: stop?.runId ?? null });
  if (early) return writerRefusal(early);
  const n = state.nodes.get(`${stop.node}@g${stop.generation}`);
  const snap = changedPlanSnapshot(runsDir, stop.runId);
  if (snap.unreadable) return writerRefusal(`the run's files cannot be read (${snap.unreadable}): a plan is accepted only from files that read`);
  if (snap.notes > 0) return writerRefusal('a harness note sits above the plan in deliverable.md, so the start of a changed plan cannot be told: the answers are a new plan (regenerate) or abandon');
  // A REVERT is computed here, never passed: the file is the text the panel signed (it reads against report.json's OWN hash, the read every reader uses when no body is accepted) on a node that holds an accepted body. The record then puts the authority back to null.
  const accepted = snap.bodySha256;
  const own = n.acceptedBodySha256 ? snapshotOfRun(runsDir, stop.runId) : null;
  const revert = Boolean(own && !own.unreadable && own.observedBodySha256 !== null && own.observedBodySha256 === n.closedBodySha256 && accepted === n.closedBodySha256);
  let splitHash;
  try { splitHash = splitHashOf(snap.text); } catch (e) { if (e instanceof TreeRefusal) return writerRefusal(e.reason); throw e; }
  // the scans run on the SAME text that is hashed (one snapshot): the key scan of every run input and, when the tree turned it on, the PII gate. A finding refuses for EVERY actor (C&C 14 Oct 2026, 2c condition 3): an accepted body becomes the input of the sub-plans derived from it,
  // and a sub-plan's own scan would refuse at its start and strand the tree one step later. The shape NAMES are shown, never a value.
  const keyList = textSecretFindings(snap.text, 'deliverable.md');
  const pii = treeInputScanModeFrom(record.tree);
  if (pii.status === 'unusable') return writerRefusal(`the tree's personal-data mode cannot be read (${pii.reason}): a plan is not accepted while the check that guards it cannot be read`);
  const piiList = pii.status === 'on' ? piiGateReport({ mode: pii.mode, sources: [['deliverable.md', snap.text]], forTree: 'member' }).findings : null;
  if (keyList.length || (piiList?.length ?? 0) > 0) {
    const parts = [];
    if (keyList.length) parts.push(`${keyList.length} key-shaped string${keyList.length === 1 ? '' : 's'} (${[...new Set(keyList.map(f => f.name))].join(', ')})`);
    if (piiList?.length) parts.push(`${piiList.length} personal-data finding${piiList.length === 1 ? '' : 's'} (${[...new Set(piiList.map(f => f.type))].join(', ')})`);
    return writerRefusal(`the changed plan holds ${parts.join(' and ')}: the tree holds no plan that its own key and personal-data checks refuse. Edit the file to remove ${parts.length === 1 && keyList.length + (piiList?.length ?? 0) === 1 ? 'it' : 'them'} and ask again`);
  }
  if (actor === 'session' && typeof reason === 'string' && reason) {
    const inReason = textSecretFindings(reason, 'reason').length + (pii.status === 'on' ? piiGateReport({ mode: pii.mode, sources: [['reason', reason]], forTree: 'member' }).findings.length : 0);
    if (inReason > 0) return writerRefusal('the session\'s written reason holds a key-shaped or personal-data-shaped string: the reason is recorded in the tree and is not accepted with it');
  }
  const event = {
    event: 'plan_accepted', stopId, node: stop.node, generation: stop.generation, runId: stop.runId, actor,
    ...(via ? { via } : {}), ...(typeof reason === 'string' ? { reason } : {}),
    previousBodySha256: n.deliveredBodySha256, acceptedBodySha256: accepted,
    ...(snap.thinContractSha256 ? { thinContractSha256: snap.thinContractSha256 } : {}), splitSha256: splitHash,
    scan: { keyFindings: 0, piiFindings: pii.status === 'on' ? 0 : null },
    ...(gate ? { gateId: gate.gateId, shownSha256: gate.shownSha256 } : {}), ...(revert ? { revert: true } : {}),
  };
  const facts = {
    node: n, stop, previousBodySha256: n.deliveredBodySha256, acceptedBodySha256: accepted, revert, piiOn: pii.status === 'on', text: snap.text, bodyBytes: Buffer.byteLength(snap.text, 'utf8'), thinContractSha256: snap.thinContractSha256,
    // the table's own session-only conditions, from the SAME functions the table uses (the typed form tells the person which of them would have stopped a session)
    conditions: { root: stop.node === 'R', children: registeredChildrenOf(state, stop.node, stop.generation), approvedFrontiers: approvedFrontiersOf(state, stop.node, stop.generation), dependents: registeredDependentsOf(state, stop.node, stop.generation), dead: [...deadKeys(state)] },
  };
  const table = transitionRefusal(state, event);
  if (table) return { refusal: table.reason, writer: false, event, facts };
  return { event, facts };
}

/** `expect` = { acceptedBodySha256, previousBodySha256 }: the hashes of the candidate a PERSON was shown. Under the lock the fresh snapshot must carry the same two, else nothing is recorded (C&C FIX on 2c, 14 Oct 2026: the form compares text before the lock, the file can move between that compare and the lock). The person's form always passes it. */
export function acceptChangedPlan(rootDir, { stopId, actor, via, reason, gate, runsDir = dirname(rootDir), now, facts, expect } = {}) {
  if (typeof stopId !== 'string' || !stopId) throw new TypeError('acceptChangedPlan: { stopId } is required');
  if (actor !== 'session' && actor !== 'person' && actor !== 'sitting') throw new TypeError('acceptChangedPlan: actor is session, person or sitting (sitting is refused by the table)');
  let out = null;
  withTreeLock(rootDir, () => {
    const c = candidatePlanAccept(rootDir, { stopId, actor, via, reason, gate, runsDir });
    if (c.refusal && c.writer) throw refuse(c.refusal);
    if (expect && (c.event.acceptedBodySha256 !== expect.acceptedBodySha256 || c.event.previousBodySha256 !== expect.previousBodySha256)) {
      throw refuse('the plan changed after it was shown to you, so no acceptance was recorded (your typed approval is used up): ask again to see the text as it is now');
    }
    // a TABLE refusal is thrown by the append itself, with its own TreeRefusal (code and sentence), exactly as before 2c
    const written = appendTreeEventLocked(rootDir, c.event, { ...(now ? { now } : {}), ...(facts ? { facts } : {}) });
    out = { event: written ?? c.event, previousBodySha256: c.event.previousBodySha256, acceptedBodySha256: c.event.acceptedBodySha256, revert: c.facts.revert };
  });
  return out;
}
