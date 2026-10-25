// The restore gap (0.8.3 M6; Muad 14 Oct 2026: "what can be automated safely should be automated", THC records WHO answered; Astra #16-#18; gate page Review/Build_0.8.3/m6-closing/Restore_Gap_Gate_Page.md sections 3, 7 and 8).
//
// A closed node whose report.json cannot be read opens a `blocked`-source stop (src/tree-blocked-child.js); restoring the file used to close NOTHING. Now the SITTING closes that one stop when the files on disk are, byte for byte,
// what the run produced: the plan body hashes to the sha256 the tree RECORDED at the node's close (`node_closed.deliveredBodySha256`, entry 3). The comparison is to the RECORD, never to the report's own claim: a swapped
// deliverable.md beside a swapped report.json whose `body_sha256` matches the swapped body is a different hash and stays open.
//
// Contract:
//   snapshotOfRun(runsDir, runId) -> { unreadable } | { report, observedBodySha256, bodyError, thinContractSha256, passed, status }
//        ONE read of the three files (report.json, deliverable.md, HANDOFF.md) through trustedRunDir + readRunFile; everything the HASHES and the closure comparison use is derived from that in-memory text (Astra #17). It calls neither readNodePlan nor
//        closedFieldsOf nor handoffStatusOf: each re-reads from disk. ONE DEPARTURE, named (restore fix-up, 14 Oct 2026): for a stop that holds contract_check, restoreClosedStops also runs `contractCheckOf` on the same run folder, which READS the folder again (a second read, after the snapshot).
//        It fails closed: if the bytes changed in between, the re-run exits non-zero and the stop stays open, and the event carries the SNAPSHOT's hash; every reader checks the file as it is when it reads it (the R7 rule), so a swap after the append reopens a stop on the next step.
//   restoreDecision({ state, stop, snapshot, providerSnapshots }) -> { restore: false, why } | { restore: true, event }       PURE: the close test (below); `stop` = { id, ... } an open blocked stop's event; `providerSnapshots` = Map('node@gN' -> snapshotOfRun) of the node's registered providers (only read when the stop names provider_pin).
//   restoreClosedStops(rootDir, { runsDir, now, facts, afterSnapshot, work, deny }) -> [{ stopId, node, generation, restored: true } | { stopId, ..., restored: false, why }]
//        `work` = the working folder the contract check resolves the task file from (the sitting passes its own; without it a stop holding contract_check stays open). `deny` = the secret denylist predicate of an UNTRUSTED caller (R16); the sitting passes none,
//        like verifyClosedNodes and the readiness gatherer: a sitting runs only from the CLI on the person's own folder (no MCP route runs one).
//        Under the tree lock: for every OPEN blocked-source stop whose codes are all restorable, snapshot, decide, and append ONE `stop_restored` (actor 'sitting'). Idempotent (an answered stop is no longer open); a crash between the
//        check and the write leaves nothing half-written (one append). The table (transitionRefusal) repeats the record-side tests; if it refuses what this decided, that is a defect and the refusal propagates (never swallowed).
//
// THE CLOSE TEST: the stop is open, source 'blocked', every blocked code is in RESTORABLE_CODES and passes its own live test (D2 F4c, Q2: resolved / still failing / unable to check, and only EVERY cause resolved closes): report_unreadable,
// plan_unreadable and split_changed by the body hash below, provider_pin by the providers' pins (gate page sections 8, 9.2, 9.3), contract_check by the sitting's re-run exiting 0 (alone or beside plan_unreadable), expansion_refused by a
// split_verified on record for the run, derivation_refused by readiness' live re-derivation returning for every child that reads this node's plan (fail closed: D3 F4-1); the node is closed with a record-held deliveredBodySha256; the snapshot reads (report.json parses to
// an object) and yields a body whose recomputed sha256 equals the record-held one; the closure's thinContractSha256 (when held) equals the snapshot's; the closure's passed/outcome equal the snapshot's `passed` and its status equals the
// HANDOFF.md status. Anything else leaves the stop open and the answer path (a new plan / abandon, a person) untouched. A node that still has another readiness reason keeps it: the close removes only the decision point the unreadable file created.
// No money: no file of the tree's money, no grant, no gate is touched.
import { dirname } from 'node:path';
import { sha256Of } from './thin-contract.js';
import { readRunFile, trustedRunDir } from './run-files.js';
import { contractCheckOf } from './run-contract-check.js';
import { bodyOfDelivered } from './tree-split.js';
import { parseMilestones } from './milestones.js';
import { appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { RESTORABLE_CODES, isSupersededGeneration, planAuthorityOf } from './tree-transitions.js';
import { rederivationOutcome, rederivedTriggers } from './tree-ready.js';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The `why` words of a close test that could NOT RUN (Astra (a): unable to check is not still failing; the sitting says them apart). */
export const UNCHECKED_WHY = Object.freeze(['contract_check_not_run', 'derivation_not_run']);

/** The three files of a finished run, read ONCE. { unreadable: <why> } when the run folder is refused or report.json does not read as a JSON object (the readiness rule's `report_unreadable`, tree-ready.js runFactsOf). */
export function snapshotOfRun(runsDir, runId, { accepted = null } = {}) {
  const trusted = trustedRunDir(runsDir, runId);
  if (trusted.refusal) return { unreadable: trusted.refusal };
  const reportFile = readRunFile(trusted.dir, 'report.json');
  const deliverable = readRunFile(trusted.dir, 'deliverable.md');
  const handoff = readRunFile(trusted.dir, 'HANDOFF.md');
  let report = null;
  if (typeof reportFile.text === 'string') { try { report = JSON.parse(reportFile.text); } catch { report = null; } }
  if (!isObj(report)) return { unreadable: 'report.json is missing or unreadable' };
  const body = typeof deliverable.text === 'string' ? bodyOfDelivered(deliverable.text, accepted ? { ...report.delivered_text, body_sha256: accepted } : report.delivered_text) : { error: 'deliverable.md is missing or unreadable' };
  let status = null;
  if (typeof handoff.text === 'string') { try { status = parseMilestones(handoff.text).status ?? null; } catch { status = null; } }
  return {
    report, observedBodySha256: body.body !== undefined ? sha256Of(body.body) : null, bodyError: body.error ?? null,
    thinContractSha256: typeof report.thin_contract?.sha256 === 'string' ? report.thin_contract.sha256 : null, passed: report.passed === true, status,
  };
}

/** The close test. `state` is the fold, `stop` the open stop's event, `snapshot` snapshotOfRun's answer. -> { restore: true, event } | { restore: false, why }. `why` is a stable word, never a sentence. */
export function restoreDecision({ state, stop, snapshot, providerSnapshots = new Map(), contractExit = null, derivation = null }) {
  const meta = state.stopMeta.get(stop.id);
  if (!meta || !state.openStops.includes(stop.id) || meta.source !== 'blocked') return { restore: false, why: 'not_a_blocked_stop' };
  const codes = meta.blockedCodes ?? [];
  // D2 F4c (Q2: each cause has its own live test with THREE outcomes, resolved / still failing / unable to check; the stop closes only when EVERY cause is resolved). `contract_check` closes alone too, CHANGED from the 14 Oct 2026
  // fix-up's "only beside plan_unreadable": that rule's premise ("a restored file does not change a failed check") is false for the task, context and HANDOFF files, which the check reads live (src/run-contract-check.js).
  if (!codes.length || codes.some(c => !RESTORABLE_CODES.includes(c))) return { restore: false, why: 'other_reason' };
  if (codes.includes('contract_check') && contractExit === null) return { restore: false, why: 'contract_check_not_run' };      // no working folder, a refused run folder, or a check that threw: it never ran (2b carry-over: two different conditions, two words)
  if (codes.includes('contract_check') && contractExit !== 0) return { restore: false, why: 'contract_check_still' };       // it ran and still fails
  // derivation_refused (D3 F4-1: FAIL CLOSED): resolved only when every derivation that reads this node's plan RETURNED; one still refused for a plan's text = still; anything else, an empty set included, = not run (never "no new failure")
  if (codes.includes('derivation_refused') && derivation !== 'resolved') return { restore: false, why: derivation === 'still' ? 'derivation_still' : 'derivation_not_run' };
  const n = state.nodes.get(`${stop.node}@g${stop.generation}`);
  if (!n || n.phase !== 'closed' || n.runId !== stop.runId) return { restore: false, why: 'not_closed' };
  if (codes.includes('expansion_refused') && !(n.verifiedSplit && n.verifiedSplit.runId === stop.runId)) return { restore: false, why: 'split_not_verified' };     // a record fact: under F3 readiness stops raising it exactly then
  if (!n.deliveredBodySha256) return { restore: false, why: 'no_recorded_hash' };
  if (snapshot.unreadable) return { restore: false, why: 'still_unreadable' };
  if (snapshot.observedBodySha256 !== n.deliveredBodySha256) return { restore: false, why: snapshot.observedBodySha256 === null ? 'plan_unreadable' : 'body_differs' };
  if (n.thinContractSha256 && snapshot.thinContractSha256 !== n.thinContractSha256) return { restore: false, why: 'thin_contract_differs' };
  if ((n.outcome === 'passed') !== snapshot.passed || (n.closedStatus ?? null) !== snapshot.status) return { restore: false, why: 'closure_differs' };
  // provider_pin (gate page 9.3): every pin the dependent REGISTERED against must read the same from the provider's own files now, through the SAME trusted reader (snapshotOfRun) - readiness' own pinChanged rule. The pins are the registration's, the
  // observed numbers the providers' snapshots: neither is passed in by a caller.
  let providerPins;
  if (codes.includes('provider_pin')) {
    providerPins = [];
    for (const d of (n.dependsOn ?? []).filter(x => x.thinContractSha256)) {
      if (isSupersededGeneration(state, d.node, d.generation)) return { restore: false, why: 'provider_moved' };
      const ps = providerSnapshots.get(`${d.node}@g${d.generation}`);
      if (!ps || ps.unreadable || typeof ps.thinContractSha256 !== 'string') return { restore: false, why: 'provider_unreadable' };
      if (ps.thinContractSha256 !== d.thinContractSha256) return { restore: false, why: 'provider_pin_differs' };
      providerPins.push({ node: d.node, generation: d.generation, boundThinContractSha256: d.thinContractSha256, observedThinContractSha256: ps.thinContractSha256 });
    }
    if (!providerPins.length) return { restore: false, why: 'no_pin_to_compare' };
  }
  return {
    restore: true,
    event: {
      event: 'stop_restored', actor: 'sitting', stopId: stop.id, node: stop.node, generation: stop.generation, runId: stop.runId,
      deliveredBodySha256: n.deliveredBodySha256, observedBodySha256: snapshot.observedBodySha256, ...(n.thinContractSha256 ? { thinContractSha256: snapshot.thinContractSha256 } : {}), ...(providerPins ? { providerPins } : {}), ...(codes.includes('contract_check') ? { contractExit: 0 } : {}), ...(codes.includes('derivation_refused') ? { rechecked: ['derivation_refused'] } : {}),
    },
  };
}

/** Every open blocked-source stop whose files are back as the run produced them is closed by the sitting. See the header. A record that does not read answers nothing ([]). */
export function restoreClosedStops(rootDir, { runsDir = dirname(rootDir), now, facts, afterSnapshot = null, work = null, deny = null } = {}) {
  const peek = readTreeRecord(rootDir);
  if (peek.corrupt.length || !peek.tree) return [];
  if (!stateOf(peek).openStops.some(id => stateOf(peek).stopMeta.get(id)?.source === 'blocked')) return [];     // the common case takes no lock
  const results = [];
  withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);                                                      // re-read under the lock: another sitting may have answered it
    if (record.corrupt.length || !record.tree) return;
    for (const id of stateOf(record).openStops) {
      const state = stateOf(readTreeRecord(rootDir));                                            // each close changes the fold the next stop is judged against
      if (!state.openStops.includes(id)) continue;
      const stop = readTreeRecord(rootDir).events.find(e => e.id === id);
      if (!stop || stop.source !== 'blocked') continue;
      if (typeof stop.runId !== 'string') { results.push({ stopId: id, node: stop.node, generation: stop.generation, restored: false, why: 'not_closed' }); continue; }     // a child closed before it ever started has no run folder to read
      const where = { stopId: id, node: stop.node, generation: stop.generation };
      const me = state.nodes.get(`${stop.node}@g${stop.generation}`);
      const snapshot = snapshotOfRun(runsDir, stop.runId, { accepted: planAuthorityOf(me) });     // ONE snapshot per stop: scanned, hashed and consumed from the same bytes (read against the ACCEPTED hash when the record holds one, gate page 12)
      const providerSnapshots = new Map();
      if ((state.stopMeta.get(id)?.blockedCodes ?? []).includes('provider_pin')) for (const d of (me?.dependsOn ?? []).filter(x => x.thinContractSha256)) {
        const p = state.nodes.get(`${d.node}@g${d.generation}`);
        if (p) providerSnapshots.set(`${d.node}@g${d.generation}`, snapshotOfRun(runsDir, p.runId, { accepted: planAuthorityOf(p) }));              // one read per provider, through the same trusted reader
      }
      // the contract check, when the stop holds contract_check (see restoreDecision): the SITTING'S OWN re-run on the same run folder (the event carries its exit, the table checks it is 0); without a working folder to resolve the task file from it cannot run, and the stop stays open
      let contractExit = null;
      if (work && (state.stopMeta.get(id)?.blockedCodes ?? []).includes('contract_check')) {
        const t = trustedRunDir(runsDir, stop.runId);
        if (!t.refusal) {
          // FAIL CLOSED (2b carry-over, C&C 14 Oct 2026): a check that cannot run (the task file cannot be read, any throw) leaves contractExit null, which restoreDecision answers 'contract_check_not_run' and never closes: an unknowable check is not a passed one.
          try { const c = contractCheckOf(t.dir, { work, deny, accepted: planAuthorityOf(me) }); contractExit = Number.isInteger(c.exit) ? c.exit : null; } catch { contractExit = null; }
        }
      }
      // the live re-derivation, when the stop holds derivation_refused (D2 F4c, D3 F4-1): the derivations that READ this node's plan (it is the child's parent, a provider of the child, or inside a provider's subtree), through readiness' own
      // helper (one rule). FAIL CLOSED: any throw here is 'unable', never resolved
      let derivation = null;
      if ((state.stopMeta.get(id)?.blockedCodes ?? []).includes('derivation_refused')) {
        try { derivation = rederivationOutcome(rederivedTriggers({ rootDir, record: readTreeRecord(rootDir), state, runsDir, work }), stop).outcome; } catch { derivation = 'unable'; }
      }
      afterSnapshot?.({ stopId: id, node: stop.node, generation: stop.generation });                 // TEST-ONLY seam (R7): a file replaced between the read and the append
      const d = restoreDecision({ state, stop, snapshot, providerSnapshots, contractExit, derivation });
      if (!d.restore) { results.push({ ...where, restored: false, why: d.why }); continue; }
      appendTreeEventLocked(rootDir, d.event, { ...(now ? { now } : {}), ...(facts ? { facts } : {}) });
      results.push({ ...where, restored: true, ...(d.event.contractExit === 0 ? { contractChecked: true } : {}), ...(d.event.rechecked ? { derivationRechecked: true } : {}), ...((state.stopMeta.get(id)?.blockedCodes ?? []).includes('expansion_refused') ? { splitVerified: true } : {}) });     // E164 (M7): the sitting's line names each live re-check only when the stop held it (D2 F4c adds two)
    }
  });
  return results;
}
