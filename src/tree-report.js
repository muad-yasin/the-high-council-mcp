// tree/report.json, the tree's own report (0.8.3 M6 slice S4, second commit; PLAN 9.2, CL-125). MONEY: the tree's spend is shown as TWO figures that are never merged, each with the reservations behind it:
//   memberSpend   the sum of the members' spend as the tree counts it (memberSpentUsd, src/tree-budget.js): the run folder's figure (src/spend.js: a reservation with no settlement counts at its worst case; a charge record counts besides it), never below a floor a person accepted for an unreadable report.json.
//   adjustments   the tree's signed adjustments under PLAN 7.1, "sum of added(R)": extra conservative charges (a reservation the run's own record no longer accounts for: rows 4 and 5, added = max(0, worst case - evidence)),
//                 and the one reconciliation that removes a call runSpentUsd counts twice (row 3, added = minus the charge's evidence). It can be negative. Rows 0, 1 and 2 add nothing.
// No field of this file is their sum: there is no "total", no "treeSpentUsd". (The tree's spend for a cap decision is memberSpend + adjustments, PLAN 7.1; src/tree-budget.js gateTree computes it; this file only reports.)
// A test pins the exact key set, and that the two figures equal gateTree's own members[] and addedUsd (this module computes no money of its own: it sorts and sums what gateTree returns, in a fixed order).
//
// THE CONTRACT (fixed before the tests):
//   buildTreeReport(rootDir, { work }) -> report     plain data, read-only, no lock, no clock (the only times are the record's own `at`).
//     { schema: 'tree-report/1', treeId, rootRunId, position: { lastEventId, lastEventAt, events }, readiness: { source, verdict, reasons, eventId, at },
//       piiGate: 'off' | 'warn' | 'hard-stop' | 'unusable' | 'unreadable' (the tree's personal-data mode as tree.json records it, S8-6b part 1; 'unusable' = a value that is neither mode, 'unreadable' = tree.json cannot be read, which is NOT 'off'; the state word only, never the text of an unusable value: piiModeOf in src/tree-handoff.js),
//       abandoned: null | { eventId, at, gateId, shownSha256, retiredStops: [stop ids] } (ROADMAP 57: a person abandoned the tree, src/tree-abandon.js; null otherwise. When it is set, readiness.verdict is null and readiness.reasons is []: the retired stops no longer hold the verdict back, so a computed one could read `ready`),
//       stopMarker: boolean (a `council tree stop` marker file stands; the marker is not a record event, so no position moves with it), heldNodes: [{ node, generation, runId, route, replaces }] (the nodes the held state holds: eligible old children while a root re-plan's, or a sub-plan regenerate's, new plan is made; `route` is 'root' or 'sub', `replaces` the replaced sub-plan's path or null: additive since C2a-record commit 2), keptNodes: [{ node, generation, runId, route, replaces }] (the held nodes a later frontier approval went past without using them: kept, not dead; C2a-record),
//       memberRefusals: [{ node, generation, count, runJson }] (member starts the tree refused for its personal-data rule - a pii_mode_mismatch record - counted per node that is STILL registered; runJson: the node's run folder holds run.json; never the record's detail text: S8-6b part 2a),
//       closedUnstarted: [{ node, generation, stopId, at }] (children a person closed before they ever started, c3b; not nodes rows; never the stop's findings: S8-6b part 2b),
//       consistency: null | 'the record was still changing while it was read',
//       gate: { ok, problems: [{ code, node, runId, keys }] },
//       money: { unit: 'usd', rootCapUsd,
//                memberSpend: { sumUsd, members: [{ node, generation, runId, started, runSpentUsd }], reservations: [{ key, node, row, worstCaseUsd, evidenceUsd, settledAccepted }] },
//                adjustments: { sumUsd, reservations: [{ key, node, row, worstCaseUsd, evidenceUsd, addedUsd }] } } }
//     memberSpend.reservations are the reservations whose state shapes what runSpentUsd read (rows 1, 2, 3); adjustments.reservations are the ones that add something (addedUsd != 0, rows 3, 4, 5). Row 3 is in both: its
//     worst case is inside memberSpend and its correction inside adjustments. Sorted by key; members by node, generation. The sums add in that order.
//     PLAN 7.1 has five states for a reservation (settled and accepted: row 1; unsettled, no evidence: row 2; unsettled with a durable evidence record: row 3; in the mirror only: row 4; settled but rejected by the gate: row 5).
//     Row 0 is gateTree's label for an id that is in NONE of them: no reserved line for it in the run's own file (as runSpentUsd reads it) and none mirrored, so only a settled line (settled_without_reserved, which the gate
//     reports) can exist. It has no worst case: nothing counts it and nothing is added for it, so it is in neither list.
//     `gate.ok` false means the accounting gate does not trust the record (a paid start is refused): the figures are what the record shows, and the file says so.
//   renderTreeReport(report) -> string               deterministic JSON text: keys in canonical order, two-space indent, one final newline.
//   writeTreeReport(rootDir, { work }) -> { path, sha256, bytes }   buildTreeReport + renderTreeReport + one atomic write of `<rootDir>/tree/report.json` (writeTreeFileAtomic, src/tree-handoff.js). Takes no lock; the hook is A's (the
//                                                    sitting lock held by the caller), as for TREE_HANDOFF.md.
// SEAM: `readiness` is the same computed verdict as TREE_HANDOFF.md shows, through readinessFor (src/tree-handoff.js), which S3 switches to the last recorded `readiness` event.
import { basename, dirname } from 'node:path';
import { canonicalJson } from './thin-contract.js';
import { gatherReadinessFacts, verdictOf } from './tree-ready.js';
import { effectiveCapUsd, gateTree } from './tree-budget.js';
import { readTreeRecord, stateOf } from './tree-record.js';
import { abandonedOf, acceptedNodesOf, deferredStopsOf, draftedStopsOf, adoptedNodesOf, closedUnstartedOf, heldNodesOf, keptNodesOf, memberRefusalsOf, piiModeOf, positionOfRecord, readinessFor, writeTreeFileAtomic } from './tree-handoff.js';
import { stopRequested } from './tree-stop-marker.js';

export const TREE_REPORT_SCHEMA = 'tree-report/1';
export const TREE_REPORT_FILE = 'report.json';

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byNode = (a, b) => byText(a.node, b.node) || a.generation - b.generation || byText(a.runId, b.runId);
const byKey = (a, b) => byText(a.key, b.key);
const sum = list => list.reduce((acc, x) => acc + x, 0);

/** The report as plain data. Reads the record and the run folders; writes nothing. */
export function buildTreeReport(rootDir, { work, readRecord = readTreeRecord, deny = null } = {}) {
  if (typeof work !== 'string' || !work) throw new TypeError('buildTreeReport: `work` (the working folder `contract check` resolves the task file from) is required');
  // ONE record position for readiness and money (the same check as TREE_HANDOFF.md, seam 4): S1's gather reads the record itself, so the record is read before it, once more for the gate and the position, and after; if the last event
  // or the event count moved between the first and the last read, everything is read again (up to 3 times); if it still moved, the file says so. `readRecord` is a seam for tests only.
  let facts; let record; let moved = false;
  for (let tries = 0; tries < 3; tries += 1) {
    const before = positionOfRecord(readRecord(rootDir));
    facts = gatherReadinessFacts(rootDir, { work, deny });
    record = readRecord(rootDir);
    const after = positionOfRecord(readRecord(rootDir));
    const here = positionOfRecord(record);
    moved = before.lastEventId !== after.lastEventId || before.events !== after.events || here.lastEventId !== after.lastEventId || here.events !== after.events;
    if (!moved) break;
  }
  const position = positionOfRecord(record);
  // ROADMAP 57 (c3): once the tree is abandoned its stops are retired, so a computed verdict could read `ready` on a tree whose only obstacle was a stop. The verdict is null and the reasons empty; `abandoned` says why.
  const abandoned = facts.problems.length ? null : abandonedOf(stateOf(record));
  const readiness = abandoned ? { ...readinessFor(record, verdictOf(facts), position), verdict: null, reasons: [] } : readinessFor(record, verdictOf(facts), position);
  const base = { schema: TREE_REPORT_SCHEMA, treeId: facts.treeId, rootRunId: basename(rootDir), position, readiness, stopMarker: stopRequested(rootDir), abandoned, piiGate: piiModeOf(record).state, heldNodes: facts.problems.length ? [] : heldNodesOf(stateOf(record)), keptNodes: facts.problems.length ? [] : keptNodesOf(stateOf(record)), ...(!facts.problems.length && adoptedNodesOf(stateOf(record)).length ? { adoptedNodes: adoptedNodesOf(stateOf(record)) } : {}), ...(!facts.problems.length && acceptedNodesOf(stateOf(record)).length ? { acceptedNodes: acceptedNodesOf(stateOf(record)) } : {}), ...(!facts.problems.length && deferredStopsOf(stateOf(record)).length ? { deferredStops: deferredStopsOf(stateOf(record)) } : {}), ...(!facts.problems.length && draftedStopsOf(stateOf(record)).length ? { draftedStops: draftedStopsOf(stateOf(record)) } : {}), memberRefusals: facts.problems.length ? [] : memberRefusalsOf(record, stateOf(record), dirname(rootDir)), closedUnstarted: facts.problems.length ? [] : closedUnstartedOf(stateOf(record), facts.closedUnstarted), consistency: moved ? 'the record was still changing while it was read' : null };
  if (facts.problems.length) return { ...base, gate: { ok: false, problems: facts.problems.map(() => ({ code: 'record_unreadable', node: null, runId: null, keys: [] })) }, money: null };
  const g = gateTree(rootDir, { record });
  const members = g.members.map(m => ({ node: m.node, generation: m.generation, runId: m.runId, started: m.started === true, runSpentUsd: m.spentUsd })).sort(byNode);
  const reservations = [...g.reservations].sort(byKey);
  const shaped = reservations.filter(r => r.row >= 1 && r.row <= 3).map(r => ({ key: r.key, node: r.node, row: r.row, worstCaseUsd: r.worstCaseUsd, evidenceUsd: r.evidenceUsd, settledAccepted: r.settledAccepted === true }));
  const adding = reservations.filter(r => r.addedUsd !== 0).map(r => ({ key: r.key, node: r.node, row: r.row, worstCaseUsd: r.worstCaseUsd, evidenceUsd: r.evidenceUsd, addedUsd: r.addedUsd }));
  return {
    ...base,
    gate: { ok: g.ok === true, problems: g.problems.map(p => ({ code: String(p.code), node: p.node ?? null, runId: p.runId ?? null, keys: [...(p.keys ?? [])].sort() })) },
    money: {
      unit: 'usd', rootCapUsd: record.tree ? effectiveCapUsd(record) : null,
      memberSpend: { sumUsd: sum(members.map(m => m.runSpentUsd)), members, reservations: shaped },
      adjustments: { sumUsd: sum(adding.map(r => r.addedUsd)), reservations: adding },
    },
  };
}

/** Deterministic JSON text of a report: canonical key order, two-space indent, one final newline. */
export function renderTreeReport(report) {
  return `${JSON.stringify(JSON.parse(canonicalJson(report)), null, 2)}\n`;
}

/** Build, render and write `<rootDir>/tree/report.json` atomically. Takes no lock. */
export function writeTreeReport(rootDir, { work } = {}) {
  return writeTreeFileAtomic(rootDir, TREE_REPORT_FILE, renderTreeReport(buildTreeReport(rootDir, { work })));
}
