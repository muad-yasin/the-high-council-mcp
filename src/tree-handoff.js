// TREE_HANDOFF.md, the building session's first read of a recursive-councils tree (0.8.3 M6 slice S4; PLAN 9.2, 9.3; CL-53, CL-125). Written by code only, deterministically: the same record and the same run folders give the
// same bytes. It POINTS and never quotes plan text: ids, headings, hashes, paths, counts and the recorded words of a person's decisions are in it; a milestone's basis, a criterion's words or a scope are not.
//
// THE CONTRACT (fixed before the tests, so a test can fail against it):
//   gatherHandoffFacts(rootDir, { work }) -> facts   plain data (no Map, Set, undefined or clock). Reads the record and the member run folders; writes nothing, takes no lock.
//                                                    Facts also carry `piiGate` ('off' | 'warn' | 'hard-stop' | 'unusable' | 'unreadable') and `piiGateReason` (a string for 'unusable' only, else null): the tree's personal-data mode (piiModeOf, S8-6b part 1). The reason is the one text of tree.json this file prints, and only here.
//                                                    And `memberRefusals` ([{ node, generation, count, runJson }]: refused member starts of nodes still registered, memberRefusalsOf; the record's detail is never printed), `closedUnstarted` ([{ node, generation, stopId, at }]: children closed before they started, closedUnstartedOf; section 2 labels them, section 3 lists them) and `rootUnstarted` (rootUnstartedOf, src/tree-root-unstarted.js; with no active node - no R registered - section 6 says so instead of "read the root plan"; R registered without run.json keeps its "active node" sentence) and, per open stop, `child` (childKeyOf; S8-6b part 2a).
//   renderTreeHandoff(facts) -> string               PURE. It prints the facts in the order given; gatherHandoffFacts has already sorted every list (paths by plain comparison, generations numerically, event ids by their number). An absent value is written "none recorded", never left blank;
//                                                    no locale formatting; every pin is the full 64 hex characters; the only times in the text are the `at` of recorded events.
//   writeTreeHandoff(rootDir, { work }) -> { path, sha256, bytes }   gather + render + one atomic write (writeTreeFileAtomic: temp file in the same folder, fsync, rename, fsync of the folder) of `<rootDir>/tree/TREE_HANDOFF.md`.
//                                                    It writes ONLY that file. It refuses (throws) when the target is a symbolic link. A second call on an unchanged tree rewrites the same bytes.
//
// SEAMS (named here so that S3, which hooks this into the sitting, and this file never guess about each other):
//   1. READINESS SOURCE. S3 appends `readiness` events; they do not exist yet. Until they do, the verdict shown is COMPUTED by S1's readinessOf (gatherReadinessFacts + verdictOf) and the text says so, with the position of the record it
//      was computed at (last event id + that event's `at`: no wall clock). When S3 lands, `readinessFor(record, computed)` below is the ONE function that prefers the last recorded `readiness` event (verdict, reasons, `at`, id);
//      the rest of the file does not change.
//   2. THE HOOK. `afterStep` (S3, the sitting's, A's) calls `writeTreeHandoff(rootDir, { work })` after a step has been committed to the record. The caller holds the sitting lock; this module takes none (the record is
//      append-only and the one file it writes has one writer at a time under that lock). Wired 12 Oct (a must-fix: nothing called it until then): `writeTreeFiles` in src/tree-run.js calls this and `writeTreeReport` from `afterStep`, never throwing (a failing writer is a `fileProblems` entry of the sitting's result).
//   3. INTEGRATION RESULTS. S2 defines the binding of an `integration_recorded` event (owningNode, owningGeneration, splitSha256, agreementId, agreementTextSha256, the participants' versions). This file lists every such
//      event whose `agreement` is a qualified id of an agreement of the tree, with whatever extra fields it carries (sorted, as written); it does not judge them (S1/S2 do).
//   4. TWO READS OF THE RECORD. S1's gatherReadinessFacts reads the record itself and takes none as a parameter, so this module's own reads are separate. The record is read before and after S1's gather; if its last event
//      or its event count moved, the gather is repeated (up to 3 times); if it still moved, the file says so ("the record was still changing while it was read"). A file written under the sitting lock never meets that case.
//
// WHAT IT NEEDS FROM EXISTING CODE (nothing is changed there): src/tree-ready.js (S1: gatherReadinessFacts, verdictOf), src/tree-record.js (readTreeRecord, stateOf, fsyncDir), src/tree-transitions.js (orphansOf), src/tree-derive-load.js (readNodePlan), src/run-files.js (trustedRunDir, readRunJson, listRunFiles: run folders are read only through it), src/tree-identity.js, src/tree-qid.js.
//
// Paths in the file are relative to the RUNS folder (the folder that holds `<rootId>/`): `<runId>/deliverable.md`. No absolute path, temp name or working folder appears in the text.
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { sha256Of } from './thin-contract.js';
import { listRunFiles, readRunJson, trustedRunDir } from './run-files.js';
import { TREE_DIR, fsyncDir, readTreeRecord, stateOf } from './tree-record.js';
import { abandonedSentence, candidateOriginOf, deadKeys, heldKeys, keptKeys, orphansOf, placeOf, planAuthorityOf, subHeldPhrase, subKeptPhrase } from './tree-transitions.js';
import { stopRequested } from './tree-stop-marker.js';
import { quotedReason } from './tree-stop.js';
import { treePiiModeFrom } from './tree-pii-mode.js';
import { terminalSafe } from './terminal-safe.js';
import { childNode, nodeKey } from './tree-identity.js';
import { qualify } from './tree-qid.js';
import { readNodePlan } from './tree-derive-load.js';
import { gatherReadinessFacts, verdictOf } from './tree-ready.js';
import { rootUnstartedOf } from './tree-root-unstarted.js';

export const HANDOFF_FILE = 'TREE_HANDOFF.md';
export const HANDOFF_SCHEMA_NOTE = 'tree-handoff/1';
export const positionOfRecord = record => positionOf(record);
const NONE = 'none recorded';

const idNum = id => Number(String(id ?? '').replace(/\D+/g, '')) || 0;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byNode = (a, b) => byText(a.node, b.node) || a.generation - b.generation;
const byEventId = (a, b) => idNum(a.id) - idNum(b.id);
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const cell = s => oneLine(s).replace(/\|/g, '\\|') || NONE;
const code = s => `\`${oneLine(s).replace(/`/g, "'")}\``;   // one line: a newline in a record value cannot start a heading

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- reading

const positionOf = record => {
  const last = record.events.at(-1) ?? null;
  return { lastEventId: last?.id ?? null, lastEventAt: last?.at ?? null, events: record.events.length };
};
const samePosition = (a, b) => a.lastEventId === b.lastEventId && a.events === b.events;

/**
 * SEAM 1. The verdict to show. `computed` is S1's answer ({ verdict, reasons }). Until S3 writes `readiness` events this is always the computed one; the day it does, the last recorded event wins here and only here.
 */
export function readinessFor(record, computed, position) {
  return { source: 'computed', verdict: computed.verdict, reasons: computed.reasons.map(r => ({ severity: r.severity, code: r.code, scope: r.scope, text: r.text })), eventId: position.lastEventId, at: position.lastEventAt };
}

/** A reason's words as the handoff shows them. A held item's reason carries a clipped quote of the criterion (S1: `("...")`); a handoff points and does not quote, so that tail is dropped. */
const reasonText = r => (r.code === 'held_unrecorded' ? oneLine(r.text).replace(/ \("[^"]*"\)(?= has no recorded pass$)/, '') : oneLine(r.text));

function blockOfRun(dir, n) {
  try { return readNodePlan(dir, { acceptedBodySha256: planAuthorityOf(n) }).block; } catch { return null; }
}

/** Reading/build order (PLAN 9.3 item 2): the root, then the children of each split in agreement order (a provider before the consumers it has an agreement with; ties by milestone number), each child followed by its own children. */
function orderOf(nodes, blocks) {
  // C2b-1c: the reading order walks the PLAN IN FORCE, so it visits PLACES (`blocks` is keyed by place); an entry names the node's real path and adds `place` only when that differs (an adopted node)
  const placeOfNode = n => n.place ?? n.node;
  const realOf = new Map(nodes.map(n => [placeOfNode(n), n.node]));
  const known = new Set(realOf.keys());
  const out = []; const seen = new Set(); let cycle = false;
  const visit = (path, registered) => {
    if (seen.has(path)) return;
    seen.add(path); out.push({ node: realOf.get(path) ?? path, ...(realOf.has(path) && realOf.get(path) !== path ? { place: path } : {}), registered });
    const block = blocks.get(path);
    if (!block) return;
    const kids = (block.children ?? []).filter(k => (block.milestones ?? []).some(m => m.id === k.milestone && m.status === 'decompose'));
    const indeg = new Map(kids.map(k => [k.id, 0])); const edges = new Map(kids.map(k => [k.id, []]));
    for (const a of block.agreements ?? []) if (indeg.has(a.from) && indeg.has(a.to) && a.from !== a.to) { edges.get(a.from).push(a.to); indeg.set(a.to, indeg.get(a.to) + 1); }
    const ready = kids.filter(k => indeg.get(k.id) === 0).sort((a, b) => idNum(a.milestone) - idNum(b.milestone) || byText(a.milestone, b.milestone));
    const sorted = [];
    while (ready.length) {
      const k = ready.shift(); sorted.push(k);
      for (const to of edges.get(k.id)) { indeg.set(to, indeg.get(to) - 1); if (indeg.get(to) === 0) { ready.push(kids.find(x => x.id === to)); ready.sort((a, b) => idNum(a.milestone) - idNum(b.milestone) || byText(a.milestone, b.milestone)); } }
    }
    if (sorted.length < kids.length) { cycle = true; for (const k of kids.filter(k => !sorted.includes(k)).sort((a, b) => byText(a.milestone, b.milestone))) sorted.push(k); }
    for (const k of sorted) { const p = childNode(path, k.milestone); visit(p, known.has(p)); }
  };
  visit('R', known.has('R'));
  for (const n of [...nodes].sort(byNode)) visit(placeOfNode(n), true);
  return { order: out, cycle };
}

// How an integration result's binding reads in the handoff (C&C's ruling, 11 Oct 2026): the participants as `node@gN (thin contract <12>)` (the short form the gate text of `council tree check` uses; formatted here on purpose, the
// two copies are pinned to agree at the M6 PASS), the gate id and the first 12 characters of the shown text hash. The other keys of the bound (agreement id and text hash, kind, owner, split hash) are NOT printed: they are in the
// record (events.jsonl), which is the authority, and the agreement id is the line's own id. The record is project-writable text, so each value is shape-checked before it is printed (a node path, a positive generation, 64 hex
// characters, a plain id) and anything else prints "unreadable" with the event id: one malformed event must never stop a writer that runs after every tree step.
const NODE_PATH = /^R(\/[A-Za-z][A-Za-z0-9_-]*)*$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PLAIN_ID = /^[A-Za-z0-9._-]{1,40}$/;
function boundWords(e) {
  const words = [];
  const id = String(e.id ?? '').replace(/[^A-Za-z0-9]/g, '');
  if (e.bound !== undefined) {
    const ps = e.bound?.participants;
    const ok = Array.isArray(ps) && ps.length > 0 && ps.every(p => p !== null && typeof p === 'object' && typeof p.node === 'string' && NODE_PATH.test(p.node) && Number.isInteger(p.generation) && p.generation >= 1 && p.generation < 1e6 && typeof p.thinContractSha256 === 'string' && HEX64.test(p.thinContractSha256));
    words.push(ok ? `bound to ${ps.map(p => `${p.node}@g${p.generation} (thin contract ${p.thinContractSha256.slice(0, 12)})`).join(', ')}` : `bound unreadable, see event ${id}`);
  }
  if (e.gateId !== undefined) words.push(typeof e.gateId === 'string' && PLAIN_ID.test(e.gateId) ? `gateId=${e.gateId}` : `gateId unreadable, see event ${id}`);
  if (e.shownSha256 !== undefined) words.push(typeof e.shownSha256 === 'string' && HEX64.test(e.shownSha256) ? `shownSha256=${e.shownSha256.slice(0, 12)}` : `shownSha256 unreadable, see event ${id}`);
  return words;
}

/** The ONE held sentence (S8-6a2: the status view src/tree-status.js, and through it the MCP `view` text, say it from here; nothing else retypes it) and the title of the section that carries it. E item 51, INTERIM. */
export const HELD_PENDING_TITLE = 'Held pending the new root plan';
/** B-DRAFT (M7 apply, C2a-record commit 2; C&C 18 Okt 2026: one list of held things, route-aware): when a row hangs under a REPLACED SUB-PLAN the section is not about the root plan alone. */
export const HELD_ANY_TITLE = 'Held pending a new plan';
export const KEPT_ANY_TITLE = 'Kept from an earlier plan';
export const SUB_ROWS_SENTENCE = 'A row that names a plan refers to a finished node from an earlier version of that sub-plan. It is held until the replacement plan\'s split is verified and approved, and kept if that plan does not use it. Holding or keeping it starts no new run, and what it spent stays counted.';
export const heldTitleOf = rows => (rows.some(r => r.route === 'sub') ? HELD_ANY_TITLE : HELD_PENDING_TITLE);
export const keptTitleOf = rows => (rows.some(r => r.route === 'sub') ? KEPT_ANY_TITLE : KEPT_TITLE);
export const subRowsSentenceOf = rows => (rows.some(r => r.route === 'sub') ? [SUB_ROWS_SENTENCE] : []);
/** The words after a held or kept row: nothing for the root route (the section's own sentence says it), the replaced plan for the sub-plan route. */
export const rowPhraseOf = (row, kept) => (row.route === 'sub' ? ` (${kept ? subKeptPhrase(row.replaces) : subHeldPhrase(row.replaces)})` : '');
/** B-DRAFT (M7 apply, C2a-record; C&C 18 Okt 2026): the candidates a later frontier approval went past without adopting (K2: kept, not dead). Facts only; nothing here promises what happens to them next (that is C3's sentence). */
export const KEPT_TITLE = 'Kept from an earlier root plan';
export const KEPT_SENTENCE = 'Finished nodes from an earlier root plan that a later root plan did not use: the later plan\'s children were approved without them, or the later plan finished with no children. They are kept, not deleted: their run folders stay on disk and what they spent stays counted.';
export const HELD_PENDING_SENTENCE = "Finished nodes of an earlier root plan that are kept while the new root plan is made: they are held until the new plan's split is verified, and the approval of its children then shows, for each one, whether it is reused, replaced, or kept without being used. Their run folders stay on disk.";
/**
 * The personal-data mode of the tree (S8-6b part 1; tree.json `piiGate`, written by `council tree start --pii-gate`; src/tree-pii-mode.js reads it). The ONE place the readers' words for it live: the handoff, the report, the status view
 * (and through it the MCP `view` text) and the MCP payload say it from here; nothing else retypes it. E item 55, INTERIM. The words state the RECORDED mode and claim nothing about what enforces it.
 * Five states: off | warn | hard-stop | unusable (a value that is neither mode) | unreadable (tree.json itself cannot be read: that is NOT "off", the mode is not known).
 */
export const PII_MODE_TITLE = 'Personal-data check';
export const PII_MODE_WORDS = Object.freeze({
  off: 'off. This tree records no personal-data mode.',
  warn: 'warn. This tree records the mode "warn".',
  'hard-stop': 'hard-stop. This tree records the mode "hard-stop".',
  unusable: "unusable. The personal-data mode in this tree's tree.json is neither \"warn\" nor \"hard-stop\".",
  unreadable: "unreadable. This tree's tree.json could not be read, so its personal-data mode is not known.",
});
/** The one line every reader prints. A facts object that carries no state is "not known", which is what `unreadable` says (the gatherers always set one; a hand-built facts object in a test may not). */
export const piiModeLine = state => `${PII_MODE_TITLE}: ${PII_MODE_WORDS[state] ?? PII_MODE_WORDS.unreadable}`;
/** { state, reason } of a record read by readTreeRecord. `reason` (up to 40 characters of tree.json content, cut by treePiiModeFrom) exists for `unusable` only and is printed in TREE_HANDOFF.md ONLY, terminal-safe; every other surface shows the state word. Never throws. */
export function piiModeOf(record) {
  if (!record?.tree || typeof record.tree !== 'object') return { state: 'unreadable', reason: null };
  const m = treePiiModeFrom(record.tree);
  if (m.status === 'on') return { state: m.mode, reason: null };
  if (m.status === 'unusable') return { state: 'unusable', reason: m.reason };
  return { state: 'off', reason: null };
}
/**
 * What the readers say about the starts of a tree they cannot or must not describe as "waiting" (S8-6b part 2a; E items 60-62, INTERIM, Muad's yes at M7). ONE place for the words; the handoff, the status view (and the MCP `view`) say them from here.
 * MEMBER_REFUSAL_REASON covers BOTH causes of a `blocked` record of reason pii_mode_mismatch (the member's mode differs from the tree's, or it brought a non-empty --allow-pii): the record's `detail` is never printed anywhere, because it can
 * embed up to 40 characters of tree.json or the typed allow-list. NO_START_UNUSABLE is the next step of a tree whose personal-data mode reads `unusable`: every start is refused (src/tree-start.js beginRoot step 3, src/tree-member.js), so no resume is named.
 */
export const MEMBER_REFUSAL_REASON = "refused by the tree's personal-data rule: its mode differed from the tree's, or it brought an allow-list (a tree member takes none).";
export const NO_START_UNUSABLE = 'No run of this tree can start while its personal-data mode is unusable (the Personal-data check line says so).';
export const memberRefusalText = m => `${m.count === 1 ? 'one start was' : `${m.count} starts were`} ${MEMBER_REFUSAL_REASON}`;
export const memberRefusalLine = m => `${nodeKey(m.node, m.generation)}: ${memberRefusalText(m)}`;
export const closeRefusedLine = (node, rootId) => `close ${node} with \`council tree decide ${rootId} --close ${node}\`: a resume would be refused again by the tree's personal-data rule`;
/**
 * Children a person CLOSED BEFORE THEY EVER STARTED (c3b `node_closed_unstarted`; S8-6b part 2b, E items 69-70, INTERIM). They are not state.nodes rows (no run, no grant), so the node lists skipped them. The readers LIST them: the status Nodes
 * section and the handoff (section 2's label, section 3's subsection, only when there is one), `tree/report.json` and the MCP payload (key `closedUnstarted`). Fixed fields only: { node, generation, stopId, at } - never the findings of the stop.
 * Which children count is the readiness facts' own filter (src/tree-ready.js: not a dead key, not superseded by a registered generation); this module only joins the fold's stop id and time.
 */
export const CLOSED_UNSTARTED_TITLE = 'Closed before they started';
export const CLOSED_UNSTARTED_SENTENCE = 'A person closed these children before they ever started: nothing ran, nothing was spent, and no run folder exists for them.';
export const closedUnstartedLine = c => `${c.node}  generation ${c.generation}  closed before it started, by a person  (stop ${c.stopId ?? 'none recorded'})`;
export function closedUnstartedOf(state, ready) {
  return (ready ?? []).map(c => { const info = state.closedUnstarted?.get(nodeKey(c.node, c.generation)); return { node: c.node, generation: c.generation, stopId: info?.stopId ?? null, at: info?.at ?? null }; }).sort(byNode);
}
/** The next step while the sitting still has a stop to open for a closed child (E 64; status only): nothing is open to answer yet, and `council tree resume` is what opens it. `keys` are node keys like `R/M1@g1`. */
export const stopToOpenLine = (keys, rootId) => `${keys.join(', ')} ${keys.length === 1 ? 'has' : 'have'} no way on yet: \`council tree resume ${rootId}\` opens the stop that offers one`;
/**
 * The refused member starts the readers show: a `blocked` record of reason pii_mode_mismatch, counted per node, ONLY for a node whose phase is still `registered` (a node that ran has moved on and the record is history; otherwise a corrected
 * start would show a stale refusal for ever). Node and generation come from the fold, never from the record's `scope` string. `runJson` says whether the node's run folder holds run.json: a HAND start writes it before the member's check, so the
 * next sitting resumes that run with the saved mode and is refused again (the next step is `decide --close`); with none, a sitting starts the node afresh (`resume`). [{ node, generation, count, runJson }] sorted by node, generation.
 */
export function memberRefusalsOf(record, state, runsDir) {
  const counts = new Map();
  for (const e of record.events) if (e.event === 'blocked' && e.reason === 'pii_mode_mismatch' && typeof e.scope === 'string') counts.set(e.scope, (counts.get(e.scope) ?? 0) + 1);
  const out = [];
  for (const n of state.nodes.values()) {
    const count = counts.get(nodeKey(n.node, n.generation));
    if (n.phase !== 'registered' || !count) continue;
    const t = trustedRunDir(runsDir, n.runId);
    out.push({ node: n.node, generation: n.generation, count, runJson: !t.refusal && existsSync(join(t.dir, 'run.json')) });
  }
  return out.sort(byNode);
}
/** The child a bundle_input stop on the ROOT names (`child`, an unregistered node), as the fixed key `R/M3@g1`; null when the stop names none or the field is not { node: non-empty string, generation: integer >= 1 }. */
export function childKeyOf(e) {
  const c = e?.child;
  return c && typeof c.node === 'string' && c.node && Number.isInteger(c.generation) && c.generation >= 1 ? nodeKey(c.node, c.generation) : null;
}
/** The nodes the held state holds NOW (heldKeys: eligible old children between a root re-plan's, or a sub-plan regenerate's, decision and the new plan's split), as [{ node, generation, runId, route, replaces }] sorted by node, generation (`route` 'root' | 'sub'; `replaces` the replaced sub-plan's path for the sub route, else null). The ONE list the handoff, the report and the MCP payload share. */
export function heldNodesOf(state) {
  const held = heldKeys(state); const kept = keptKeys(state);                 // BOTH routes (C&C 18 Okt: one list of held things); a row says which plan it hangs under
  return [...state.nodes.values()].filter(n => held.has(nodeKey(n.node, n.generation)) && !kept.has(nodeKey(n.node, n.generation))).map(n => ({ node: n.node, generation: n.generation, runId: n.runId, ...candidateOriginOf(state, nodeKey(n.node, n.generation)) })).sort((a, b) => byText(a.node, b.node) || a.generation - b.generation);
}
/** The held nodes a later frontier approval (X1) or a `held_released` record (X2) went past: kept, not dead (K2). Same row shape as heldNodesOf; the readers show them apart. */
export function keptNodesOf(state) {
  const kept = keptKeys(state);
  return [...state.nodes.values()].filter(n => kept.has(nodeKey(n.node, n.generation))).map(n => ({ node: n.node, generation: n.generation, runId: n.runId, ...candidateOriginOf(state, nodeKey(n.node, n.generation)) })).sort((a, b) => byText(a.node, b.node) || a.generation - b.generation);
}

/**
 * C4a (B-DRAFT readers): the finished runs of an EARLIER plan that fill a slot of the plan in force (state.adopted), with where they sit and the decision that opened the plan they were adopted into. Derived on read, nothing stored.
 * `under` is the parent whose children frontier adopted them (the root route: R@g2, whose own decision is the root_replan frontier's openedBy; the sub-plan route: the replacement frontier's own openedBy). Empty when the tree adopted nothing.
 */
export function adoptedNodesOf(state) {
  const out = [];
  for (const [key, a] of state.adopted ?? []) {
    const n = state.nodes.get(key); if (!n) continue;
    const f = state.frontiers.get(a.frontierKey);
    const parentKey = f?.parentNode ? nodeKey(f.parentNode, f.parentGeneration) : null;
    const parent = parentKey ? state.nodes.get(parentKey) : null;
    out.push({ node: n.node, generation: n.generation, runId: n.runId, slot: a.slot, under: parentKey, decisionId: f?.openedBy ?? (parent ? state.frontiers.get(parent.frontierKey)?.openedBy : null) ?? null });
  }
  return out.sort((a, b) => byText(a.node, b.node) || a.generation - b.generation);
}
/**
 * KEEP (B-DRAFT readers): the finished runs a keep ACCEPTED as they are (their Status stays needs_decision on the record). Derived on read from state.accepted and the decision that recorded it. Empty when nothing was accepted.
 */
export function acceptedNodesOf(state) {
  const out = [];
  for (const key of state.accepted ?? []) {
    const n = state.nodes.get(key); if (!n) continue;
    const d = [...state.decisions].find(([, x]) => x.form === 'keep' && x.node === n.node && x.generation === n.generation);
    out.push({ node: n.node, generation: n.generation, runId: n.runId, decisionId: d ? d[0] : null, actor: d?.[1]?.answeredBy?.actor ?? null });
  }
  return out.sort((a, b) => byText(a.node, b.node) || a.generation - b.generation);
}
/** DEFERRAL (B-DRAFT readers): the open stops the session handed to the person, with its condition codes and written reason (the reason is the session's text). Empty when nothing was deferred. */
export function deferredStopsOf(state) {
  return [...(state.deferred ?? [])].filter(([id]) => state.openStops.includes(id)).map(([stopId, d]) => ({ stopId, conditions: [...d.conditions], reason: d.reason, actor: d.actor })).sort((a, b) => byText(a.stopId, b.stopId));
}
/** GAP A (A-DRAFT readers): the open ROOT stops that hold a session draft: the draft (the session's own text), and the person's change request when one was asked for it. The request is the person's text and the draft the session's: both reach a model, so the MCP payload marks the whole list untrusted. */
export function draftedStopsOf(state) {
  return [...(state.drafts ?? [])].filter(([id]) => state.openStops.includes(id)).map(([stopId, d]) => ({ stopId, draftId: d.id, bytes: Buffer.byteLength(d.text, 'utf8'), at: d.at, text: d.text, reason: d.reason, changeAsked: d.changeAsked ? { text: d.changeAsked.text, at: d.changeAsked.at } : null })).sort((a, b) => byText(a.stopId, b.stopId));
}
export const draftedRowOf = d => `stop ${d.stopId}: draft ${d.draftId} (${d.bytes} bytes, ${d.at})${d.changeAsked ? `; you asked for a change: ${d.changeAsked.text}` : ''}`;       // A-DRAFT
// BUG-C-045 (bug audit 24 Okt 2026): the reason is the SESSION's text and `council tree status` prints this row to a terminal and TREE_HANDOFF.md carries it as a list item, so it is made safe once here, for both readers: control and bidi characters removed (terminalSafe), then ONE line (a newline in it cannot start a heading or a second row), as `code` and `quotedReason` do for the other record texts.
export const deferredRowOf = d => `stop ${d.stopId}: the session handed it to you (${d.conditions.join(', ')}); its reason: ${oneLine(terminalSafe(d.reason))}`;       // B-DRAFT
export const acceptedRowOf = o => `${o.node} generation ${o.generation} (run ${o.runId}) was accepted as it is${o.decisionId ? `, decision ${o.decisionId}` : ''}${o.actor ? `, by ${o.actor === 'person' ? 'a person' : 'the session'}` : ''}`;       // B-DRAFT (KEEP)
export const adoptedRowOf = o => `${o.node} generation ${o.generation} (run ${o.runId}) fills ${o.slot}${o.under ? ` of ${o.under}` : ''}${o.decisionId ? `, decision ${o.decisionId}` : ''}`;       // B-DRAFT (C4a): adopted under <plan> from <earlier plan>

/**
 * ROADMAP 57 (commit 3): the abandon as every reader shows it. `abandonedOf(state)` -> null, or { eventId, at, gateId, shownSha256, retiredStops: [stop ids] }: `state.abandoned` copied (the fold's shape, ids only). ONE helper for
 * tree/report.json, the `tree_status` payload, the status view and this file. `retiredStopsOf(state)` adds each retired stop's node (from the fold's stopMeta) for the places that name it. `abandonedTextOf(state)` is the one sentence
 * (`abandonedSentence`, src/tree-transitions.js): no reader words it again, and none adds a next step.
 */
export const abandonedOf = state => (state.abandoned ? { eventId: state.abandoned.eventId, at: state.abandoned.at, gateId: state.abandoned.gateId, shownSha256: state.abandoned.shownSha256, retiredStops: [...state.abandoned.retiredStops] } : null);
export const retiredStopsOf = state => (state.abandoned?.retiredStops ?? []).map(id => ({ id, node: state.stopMeta?.get(id)?.node ?? null, generation: state.stopMeta?.get(id)?.generation ?? null, source: state.stopMeta?.get(id)?.source ?? null }));
export const abandonedTextOf = state => (state.abandoned ? abandonedSentence(state) : null);

/** Everything the file says, as plain data (see the header). Reads the record and the run folders; writes nothing. */
export function gatherHandoffFacts(rootDir, { work, deny = null } = {}) {
  if (typeof work !== 'string' || !work) throw new TypeError('gatherHandoffFacts: `work` (the working folder `contract check` resolves the task file from) is required');
  let rf; let record; let position; let moved = false;
  for (let tries = 0; tries < 3; tries += 1) {
    const before = positionOf(readTreeRecord(rootDir));
    rf = gatherReadinessFacts(rootDir, { work, deny });
    record = readTreeRecord(rootDir);
    position = positionOf(record);
    moved = !samePosition(before, position);
    if (!moved) break;
  }
  const pii = piiModeOf(record);
  const facts = { schemaNote: HANDOFF_SCHEMA_NOTE, rootId: basename(rootDir), treeId: rf.treeId, problems: rf.problems, consistency: moved ? 'the record was still changing while it was read' : null, position, stopMarker: stopRequested(rootDir), abandoned: null, abandonedText: null, retiredStops: [], piiGate: pii.state, piiGateReason: pii.reason };
  if (rf.problems.length) return { ...facts, readiness: { source: 'computed', ...pick(verdictOf(rf)), eventId: position.lastEventId, at: position.lastEventAt }, order: [], cycle: false, nodes: [], replaced: [], orphans: [], heldNodes: [], keptNodes: [], openStops: [], memberRefusals: [], closedUnstarted: [], rootUnstarted: false, held: [], integrations: [], resolved: [], limits: [], accounting: [], constraints: { refs: [], globals: [] }, next: null };
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  const verdict = verdictOf(rf);
  const byId = new Map(record.events.map(e => [e.id, e]));

  const blocks = new Map(); const dirs = new Map();
  const nodes = rf.nodes.map(n => {
    const t = trustedRunDir(runsDir, n.runId);
    const dir = t.refusal ? null : t.dir;
    const report = dir ? readRunJson(dir, 'report.json') : null;
    const files = dir ? listRunFiles(dir) : [];
    if (dir) { dirs.set(nodeKey(n.node, n.generation), dir); const b = blockOfRun(dir, n); if (b) blocks.set(nodeKey(n.node, n.generation), b); }       // C2b-1c: per-node data is keyed by the node's own key (an adopted node and the new node of its path are two nodes)
    const tc = report?.thin_contract;
    return {
      node: n.node, generation: n.generation, depth: n.depth, runId: n.runId, phase: n.phase, outcome: n.outcome, closedStatus: n.closedStatus,
      thinContractSha256: typeof tc?.sha256 === 'string' ? tc.sha256 : null, signedTextSha256: typeof tc?.signed_text_sha256 === 'string' ? tc.signed_text_sha256 : null,
      deliverable: Array.isArray(files) && files.includes('deliverable.md') ? `${n.runId}/deliverable.md` : null, handoff: Array.isArray(files) && files.includes('HANDOFF.md') ? `${n.runId}/HANDOFF.md` : null,
      pendingGeneration: n.nextGeneration,
      ...(n.place !== undefined ? { place: n.place } : {}),         // C2b-1c: where the node sits in the plan in force, only when that is not its own path
      accepted: n.accepted ?? null, acceptedBodySha256: n.acceptedBodySha256 ?? null,     // 2b (gate page 12.3a): a node whose plan the record accepts, so a builder is told which file is which
    };
  }).sort(byNode);

  // replaced generations: every registered, non-orphan generation older than the newest registered one of its path, with the decision that opened a later generation of the path
  const orphanKeys = orphansOf(state);
  const heldNow = heldKeys(state);                 // a held node is an orphan to `orphansOf` by design (the held state's contract D1): it is listed as HELD, not as gone
  const newestOf = new Map(nodes.map(n => [n.node, n.generation]));
  const opened = record.events.filter(e => e.event === 'generation_opened').sort(byEventId);
  const decisionOf = (path, generation) => {
    const o = opened.find(e => (e.nodes ?? []).some(x => x.node === path && x.generation > generation));
    const d = o ? byId.get(o.decisionId) : null;
    return { decisionId: o?.decisionId ?? null, decisionAt: d?.at ?? o?.at ?? null, decisionForm: d?.form ?? null, decisionText: d ? `${oneLine(d.text)}${d.actor === 'session' ? ' (answered by the session)' : ''}` : null };       // B-DRAFT (the actor, session channel): a person's answer reads exactly as before
  };
  const replaced = []; const orphans = [];
  const heldNodes = heldNodesOf(state); const keptNodes = keptNodesOf(state);
  for (const m of state.nodes.values()) {
    const k = nodeKey(m.node, m.generation);
    if (heldNow.has(k)) continue;
    if (state.adopted?.has(k) || state.adoptedBelow?.has(k)) continue;           // C2b-1 (K4): an ADOPTED node fills a slot of the new plan and is live: it is not 'replaced' by the newer node of its path (it is listed where C4's readers list adoptions)
    if (orphanKeys.has(k)) { orphans.push({ node: m.node, generation: m.generation, runId: m.runId }); continue; }
    if (newestOf.has(m.node) && m.generation < newestOf.get(m.node)) replaced.push({ node: m.node, generation: m.generation, runId: m.runId, ...decisionOf(m.node, m.generation) });
  }
  // S8-6b part 2b-2 (E 71): a child closed before it started is not a nodes row, so the loop above never sees it; once a regenerate opens a later generation the readiness filter drops it from the live `closedUnstarted` list (the decision made its key
  // dead). It stays in THIS section as one entry with no run (closedBeforeStart), so the list does not lie by omission. Listed ONLY when this section's own `decisionOf` finds the decision that opened a later generation of the path (the same data
  // every replaced row uses): a key that left the live list for any other reason (e.g. gone with a replaced parent: orphansOf walks nodes rows only and never returns these keys) is left out, which fails toward silence.
  const liveClosed = new Set((rf.closedUnstarted ?? []).map(c => nodeKey(c.node, c.generation)));
  for (const k of state.closedUnstarted?.keys() ?? []) {
    if (liveClosed.has(k)) continue;
    const m = /^(.*)@g(\d+)$/.exec(k); const d = decisionOf(m[1], Number(m[2]));
    if (d.decisionId) replaced.push({ node: m[1], generation: Number(m[2]), runId: null, closedBeforeStart: true, ...d });
  }
  replaced.sort(byNode); orphans.sort(byNode);

  const openStops = state.openStops.map(id => byId.get(id)).filter(Boolean).sort(byEventId).map(e => ({ id: e.id, node: e.node ?? null, generation: e.generation ?? null, child: childKeyOf(e), source: e.source ?? null, at: e.at ?? null, reason: e.source === 'person' ? (e.reason ?? null) : null }));   // S8-8 commit 3: a person's own words, shown QUOTED in the Open decisions list (and nowhere else: report.json and tree_status carry no `reason` key)
  const held = [];
  for (const n of rf.nodes) for (const h of n.held) held.push({ kind: h.kind, label: h.label, carrier: n.node, generation: n.generation, key: h.key });
  held.sort((a, b) => byText(a.kind, b.kind) || byText(a.label, b.label) || byText(a.carrier, b.carrier));

  // integration checks: one entry per agreement of each node's readable split block, with every recorded result that names it
  const integrations = []; const agreementIds = new Set();
  for (const n of nodes) {
    const b = blocks.get(nodeKey(n.node, n.generation));
    if (!b || n.pendingGeneration) continue;
    for (const a of b.agreements ?? []) {
      const qid = qualify({ node: n.node, generation: n.generation, id: String(a.id) });
      agreementIds.add(qid);
      integrations.push({ qid, node: n.node, generation: n.generation, from: String(a.from), to: String(a.to), results: [] });
    }
  }
  const other = [];
  for (const e of record.events.filter(x => x.event === 'integration_recorded').sort(byEventId)) {
    const res = { id: e.id, at: e.at ?? null, result: String(e.result), bound: boundWords(e) };
    const target = integrations.find(i => i.qid === e.agreement);
    if (target) target.results.push(res); else other.push({ agreement: String(e.agreement), ...res });
  }
  integrations.sort((a, b) => byText(a.qid, b.qid));

  const resolved = record.events.filter(e => e.event === 'milestone_resolved').sort(byEventId).map(e => {
    const d = e.decisionId ? byId.get(e.decisionId) : null;
    return { id: e.id, at: e.at ?? null, node: e.node, generation: e.generation, milestone: e.milestone, changesProvides: typeof e.changesProvides === 'boolean' ? e.changesProvides : null, decisionId: e.decisionId ?? null, decisionText: d ? oneLine(d.text) : null };
  });
  const limits = record.events.filter(e => e.event === 'limit_raised').sort(byEventId).map(e => ({ id: e.id, at: e.at ?? null, limit: e.limit, from: e.from, to: e.to, shownSha256: e.shownSha256 ?? null }));
  const nodeOfRun = new Map(record.events.filter(e => e.event === 'node_registered').map(e => [e.runId, e.node]));
  const accounting = record.events.filter(e => e.event === 'accounting_accepted').sort(byEventId).map(e => {
    const runs = [...new Set((e.reservationIds ?? []).map(k => String(k).split(':')[0]))].sort();
    const owners = [...new Set(runs.map(r => nodeOfRun.get(r)).filter(Boolean))].sort();
    return { id: e.id, at: e.at ?? null, keys: [...(e.reservationIds ?? [])].map(String).sort(), nodes: owners };
  });

  // pointers to the root constraints: headings the splits' context_refs name in the root task, and the root's global criteria, by id
  const refs = new Map(); const globals = new Set();
  for (const n of nodes) {
    const b = blocks.get(nodeKey(n.node, n.generation));
    if (!b) continue;
    for (const k of b.children ?? []) for (const ref of k.context_refs ?? []) {
      const m = String(ref).match(/^root-task:\s*(\S[\s\S]*)$/);
      if (!m) continue;
      const heading = oneLine(m[1]);
      if (!refs.has(heading)) refs.set(heading, new Set());
      refs.get(heading).add(qualify({ node: n.node, generation: n.generation, id: String(k.milestone) }));
    }
    if (n.node === 'R') for (const c of b.classes ?? []) if (c.class === 'global') globals.add(String(c.id));
  }
  const constraints = { refs: [...refs.entries()].sort((a, b) => byText(a[0], b[0])).map(([heading, used]) => ({ heading, usedBy: [...used].sort(byText) })), globals: [...globals].sort(byText) };

  const blocksByPlace = new Map(nodes.filter(n => blocks.has(nodeKey(n.node, n.generation))).map(n => [n.place ?? n.node, blocks.get(nodeKey(n.node, n.generation))]));
  const { order, cycle } = orderOf(nodes, blocksByPlace);
  const rows = new Map(nodes.map(n => [n.place ?? n.node, n]));
  const activeKey = state.active ?? null;
  const activeNode = activeKey ? [...state.nodes.values()].find(m => nodeKey(m.node, m.generation) === activeKey || m.node === activeKey) : null;
  const activePath = activeNode ? placeOf(state, activeNode) : null;                      // the place (= the path for every node that is not adopted)
  const deadNow = deadKeys(state);       // SLOT FIX (C&C 23 Okt 2026): a dead registered node never starts and is no longer "the active node"; the next node to read is a live one
  const waiting = order.find(o => o.registered && rows.get(o.place ?? o.node) && ['registered', 'running', 'stopped'].includes(rows.get(o.place ?? o.node).phase) && !deadNow.has(nodeKey(rows.get(o.place ?? o.node).node, rows.get(o.place ?? o.node).generation)));
  const nextPath = activePath ?? (waiting ? waiting.place ?? waiting.node : null);
  let next = null;
  if (nextPath && rows.has(nextPath)) {
    const row = rows.get(nextPath);
    const parent = nextPath.includes('/') ? nextPath.slice(0, nextPath.lastIndexOf('/')) : null;
    const pb = parent ? blocksByPlace.get(parent) : null;
    const pr = parent ? rows.get(parent) : null;
    const kid = pb ? (pb.children ?? []).find(k => childNode(parent, k.milestone) === nextPath) : null;
    const agreements = kid && pr ? (pb.agreements ?? []).filter(a => a.from === kid.id || a.to === kid.id).map(a => qualify({ node: parent, generation: pr.generation, id: String(a.id) })).sort(byText) : [];
    next = { node: row.node, runId: row.runId, phase: row.phase, handoff: row.handoff, agreements };
  }
  return {
    ...facts, readiness: state.abandoned ? { ...readinessFor(record, verdict, position), verdict: null, reasons: [] } : readinessFor(record, verdict, position), abandoned: abandonedOf(state), abandonedText: abandonedTextOf(state), retiredStops: retiredStopsOf(state), order, cycle, nodes, replaced, orphans, heldNodes, keptNodes, ...(adoptedNodesOf(state).length ? { adoptedNodes: adoptedNodesOf(state) } : {}), ...(acceptedNodesOf(state).length ? { acceptedNodes: acceptedNodesOf(state) } : {}), ...(deferredStopsOf(state).length ? { deferredStops: deferredStopsOf(state) } : {}), openStops, memberRefusals: memberRefusalsOf(record, state, runsDir), closedUnstarted: closedUnstartedOf(state, rf.closedUnstarted), rootUnstarted: !state.sticky.size && rootUnstartedOf(state, runsDir), held, integrations, otherIntegrations: other, resolved, limits, accounting, constraints, next
  };
}
const pick = v => ({ verdict: v.verdict, reasons: v.reasons.map(r => ({ severity: r.severity, code: r.code, scope: r.scope, text: r.text })) });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- rendering (pure)

const list = (items, empty, f) => (items.length ? items.map(f) : [`- ${empty}`]);

/** The file's text for a facts object. Pure: no clock, no random, no file. */
export function renderTreeHandoff(facts) {
  const L = [];
  const add = (...lines) => L.push(...lines);
  const pos = facts.position ?? { lastEventId: null, lastEventAt: null, events: 0 };
  add(`# TREE_HANDOFF.md - tree ${oneLine(facts.treeId ?? NONE)}`, '',
    'Written by code from the tree record, the member run folders and the stop marker (same record, folders and marker, same bytes). It points; it never quotes plan text. Paths are relative to the runs folder (the folder that holds this tree\'s root run). Every sha256 is the full pin.',
    `Record position: ${oneLine(pos.lastEventId ?? NONE)} at ${oneLine(pos.lastEventAt ?? NONE)} (${pos.events} events). Root run: ${oneLine(facts.rootId ?? NONE)}.`);
  if (facts.consistency) add(`WARNING: ${facts.consistency}.`);
  if (facts.problems.length) add('', '## The record could not be read', ...facts.problems.map(p => `- ${oneLine(p)}`));

  if (facts.abandoned) {
    // ROADMAP 57 (c3): a final tree. No verdict, no reading order, no next step: the one sentence (abandonedSentence), the event, what it left unanswered, then the nodes as history.
    const ab = facts.abandoned;
    add('', '## 1. Abandoned', '', facts.abandonedText, '', `Event: ${oneLine(ab.eventId)} at ${oneLine(ab.at ?? NONE)}.`, 'Stops it left unanswered:',
      ...list(facts.retiredStops ?? [], 'none', st => `- ${oneLine(st.id)}${st.node ? ` on ${code(`${st.node}@g${st.generation}`)}` : st.source === 'integration' ? ' (an integration stop, which belongs to no node)' : ' (no node)'}`));
    add('', piiModeLine(facts.piiGate));
  } else {
    const rd = facts.readiness;
    add('', '## 1. Readiness', '',
      `Verdict: **${rd.verdict}**${rd.verdict === 'ready' && rd.reasons.some(r => r.severity === 'info') ? ' (no rule of readiness fails; one or more plans were accepted, not signed by the panel: see the reasons)' : ''}`,
      rd.source === 'recorded' ? `Source: a recorded readiness event (${oneLine(rd.eventId ?? NONE)}) at ${oneLine(rd.at ?? NONE)}.` : `Source: computed from the record at ${oneLine(rd.eventId ?? NONE)} (${oneLine(rd.at ?? NONE)}); no readiness event is recorded yet. A computed verdict is not a recorded one.`,
      'Reasons:', ...list(rd.reasons, 'none (the tree is ready)', r => `- [${oneLine(r.severity)}] ${code(r.code)} at ${code(r.scope)}: ${reasonText(r)}`));
    if (facts.stopMarker) add('', 'A stop was requested (`council tree stop`): no further node of this tree is registered or started until `council tree resume` removes the stop. A node that is running continues to its next pause or end.');

    add('', piiModeLine(facts.piiGate));
    if (facts.piiGate === 'unusable' && facts.piiGateReason) add(`Why: ${code(terminalSafe(facts.piiGateReason))}`);     // the reason is file text only: no other reader prints it

    add('', '## 2. Reading and build order', '', 'The root plan first, then the children of each split in agreement order (a provider before the nodes that depend on it), each followed by its own children.');
    if (facts.cycle) add('Note: an agreement cycle among siblings; those siblings are listed in milestone order.');
    add('', ...list(facts.order, 'no node is registered', (o, i) => `${i + 1}. ${code(o.node)}${o.place && o.place !== o.node ? ` (an earlier plan's run that fills ${code(o.place)})` : ''}${o.registered ? '' : (facts.closedUnstarted ?? []).some(c => c.node === o.node) ? ' (closed before it started)' : ' (not registered yet)'}`));       // B-DRAFT (C4a): the reading order listed an adopted node and the new node of its own path both as the bare path

  }
  add('', `## ${facts.abandoned ? 2 : 3}. Nodes at their newest generation`, '',
    '| node | generation | depth | run id | outcome | thin-contract sha256 | signed_text_sha256 | deliverable.md | HANDOFF.md |', '|---|---|---|---|---|---|---|---|---|',
    ...(facts.nodes.length ? facts.nodes.map(n => `| ${cell(n.node)} | ${n.generation} | ${n.depth} | ${cell(n.runId)} | ${cell(n.outcome ?? n.phase)} | ${cell(n.thinContractSha256)} | ${cell(n.signedTextSha256)} | ${cell(n.deliverable)} | ${cell(n.handoff)} |`) : ['| none registered | | | | | | | | |']));
  for (const n of facts.nodes.filter(x => x.accepted)) add('', `${code(n.node)}: its plan was accepted by ${n.accepted.actor === 'person' ? 'a person' : n.accepted.actor === 'session' ? 'the session' : 'someone'}${n.accepted.via ? ` (${oneLine(n.accepted.via)})` : ''}, not signed by the panel (accepted body sha256 ${code(n.acceptedBodySha256)}). The deliverable.md above is the accepted text; HANDOFF.md describes the text the run produced.`);
  for (const n of facts.nodes.filter(x => x.pendingGeneration)) add('', `${code(n.node)}: generation ${n.pendingGeneration} was opened and is not registered yet; the row above is the older generation ${n.generation}.`);

  if ((facts.closedUnstarted ?? []).length) add('', `### ${CLOSED_UNSTARTED_TITLE}`, '', CLOSED_UNSTARTED_SENTENCE, ...facts.closedUnstarted.map(c => `- ${code(c.node)} generation ${c.generation}, closed by stop ${oneLine(c.stopId ?? NONE)} at ${oneLine(c.at ?? NONE)}`));
  add('', '### Replaced generations', '', 'Never the current pin. A replaced generation is listed once, here.',
    ...(facts.replaced.length ? ['', '| node | generation | run id | replaced by decision | decision time | decision |', '|---|---|---|---|---|---|', ...facts.replaced.map(r => `| ${cell(r.node)} | ${r.generation} | ${r.closedBeforeStart ? 'closed before it started' : cell(r.runId)} | ${cell(r.decisionId)} | ${cell(r.decisionAt)} | ${cell(r.decisionText)} |`)] : ['', '- none']));
  // a final tree holds nothing (the abandon released every held node): no reader of it shows "held"
  if (!facts.abandoned) add('', `### ${heldTitleOf(facts.heldNodes ?? [])}`, '', HELD_PENDING_SENTENCE, ...subRowsSentenceOf(facts.heldNodes ?? []), ...list(facts.heldNodes ?? [], 'none', o => `- ${code(o.node)} generation ${o.generation}, run ${oneLine(o.runId)}${rowPhraseOf(o, false)}`));
  if (!facts.abandoned && facts.keptNodes?.length) add('', `### ${keptTitleOf(facts.keptNodes)}`, '', KEPT_SENTENCE, ...subRowsSentenceOf(facts.keptNodes), ...list(facts.keptNodes, 'none', o => `- ${code(o.node)} generation ${o.generation}, run ${oneLine(o.runId)}${rowPhraseOf(o, true)}`));
  if (!facts.abandoned && facts.draftedStops?.length) add('', '### Drafts waiting for you', '', ...facts.draftedStops.map(d => `- ${draftedRowOf(d)}`));       // A-DRAFT
  if (!facts.abandoned && facts.deferredStops?.length) add('', '### Stops the session handed to you', '', ...facts.deferredStops.map(d => `- ${deferredRowOf(d)}`));       // B-DRAFT
  if (!facts.abandoned && facts.acceptedNodes?.length) add('', '### Finished runs accepted as they are', '', ...facts.acceptedNodes.map(o => `- ${acceptedRowOf(o)}`));       // B-DRAFT (KEEP)
  if (!facts.abandoned && facts.adoptedNodes?.length) add('', '### Finished runs of an earlier plan that fill a slot of this one', '', ...facts.adoptedNodes.map(o => `- ${adoptedRowOf(o)}`));       // B-DRAFT (C4a)
  add('', '### No longer part of the tree', '', 'Nodes registered under a generation that a decision has since replaced; their run folders stay on disk.', ...list(facts.orphans, 'none', o => `- ${code(o.node)} generation ${o.generation}, run ${oneLine(o.runId)}`));

  if (facts.abandoned) add('', '## 3. What to read next', '', '- Nothing: the tree is final. Its run folders stay on disk as history.');
  else {
    add('', '## 4. Decisions, checks and limits', '', '### Open decisions', ...list(facts.openStops, 'none', s => `- ${oneLine(s.id)}: needs_decision on ${s.node ? code(`${s.node}@g${s.generation}`) : NONE}${s.child ? ` (for child ${code(s.child)})` : ''}, opened by ${oneLine(s.source ?? NONE)} at ${oneLine(s.at ?? NONE)}${s.reason ? `\n  Your reason, word for word:\n${quotedReason(s.reason)}` : ''}`));
    add('', '### Held items (a check not enforced, a guard-refused or context-only obligation)', ...list(facts.held, 'none', h => `- ${oneLine(h.kind).replace(/_/g, ' ')} ${code(h.label)} (carried by ${code(`${h.carrier}@g${h.generation}`)}, obligation key ${oneLine(h.key)})`));
    if ((facts.memberRefusals ?? []).length) add('', '### Refused member starts', ...facts.memberRefusals.map(m => `- ${code(nodeKey(m.node, m.generation))}: ${memberRefusalText(m)}`));
    add('', '### Integration checks', ...list(facts.integrations, 'no agreement in the tree', i => {
      const res = i.results.length ? i.results.map(r => `${oneLine(r.result)} (${oneLine(r.id)} at ${oneLine(r.at ?? NONE)}${r.bound.length ? `; ${r.bound.join('; ')}` : ''})`).join('; ') : 'no result recorded';
      return `- ${code(i.qid)}: ${oneLine(i.from)} -> ${oneLine(i.to)}: ${res}`;
    }));
    if ((facts.otherIntegrations ?? []).length) add('', 'Recorded results that name no agreement of this tree:', ...facts.otherIntegrations.map(r => `- ${code(r.agreement)}: ${oneLine(r.result)} (${oneLine(r.id)} at ${oneLine(r.at ?? NONE)})`));
    add('', '### Resolved needs-decision milestones', ...list(facts.resolved, 'none', r => `- ${code(qualify({ node: r.node, generation: r.generation, id: r.milestone }))} resolved at ${oneLine(r.at ?? NONE)} (${oneLine(r.id)}${r.decisionId ? `, decision ${oneLine(r.decisionId)}` : ''}${r.changesProvides === null ? '' : `, changes what it provides: ${r.changesProvides ? 'yes' : 'no'}`}): ${r.decisionText ?? NONE}`));
    add('', '### Limits raised', ...list(facts.limits, 'none', l => `- ${oneLine(l.limit)}: ${oneLine(l.from)} -> ${oneLine(l.to)} (${oneLine(l.id)} at ${oneLine(l.at ?? NONE)}${l.shownSha256 ? `, shown text sha256 ${oneLine(l.shownSha256)}` : ''})`));
    add('', '### Accounting accepted', ...list(facts.accounting, 'none', a => `- ${oneLine(a.id)} at ${oneLine(a.at ?? NONE)}: ${a.keys.length} reservation${a.keys.length === 1 ? '' : 's'} (${oneLine(a.keys.join(', '))})${a.nodes.length ? ` of ${a.nodes.map(code).join(', ')}` : ''}`));

    add('', '## 5. Pointers to the root constraints', '', 'The root task\'s sections that the splits\' context_refs name (by heading), and the root\'s global criteria (by id). Read them in the root task itself.',
      ...list(facts.constraints.refs, 'no context_refs name a root-task section', c => `- root-task heading ${code(c.heading)}, named by ${c.usedBy.map(code).join(', ')}`),
      `- global criteria of the root: ${facts.constraints.globals.length ? facts.constraints.globals.map(code).join(', ') : NONE}`);

    add('', '## 6. What to read next', '');
    if (facts.rootUnstarted && !facts.next) add(facts.piiGate === 'unusable' ? `- The root plan has not been started. ${NO_START_UNUSABLE}` : `- The root plan has not been started, so there is no plan to read yet: \`council tree resume ${oneLine(facts.rootId)}\` starts it.`);
    else if (!facts.next) add('- No node is waiting to run: read the root plan above, then the children in the order of section 2.');
    else add(`- The active node: ${code(facts.next.node)} (${oneLine(facts.next.phase)}), run ${oneLine(facts.next.runId)}: read ${oneLine(facts.next.handoff ?? NONE)}.`, ...(facts.next.agreements.length ? [`- Then the agreements it is party to: ${facts.next.agreements.map(code).join(', ')}.`] : ['- It is party to no agreement.']));
  }
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- writing

/**
 * Writes `<rootDir>/tree/<name>` atomically: a temp file in the same folder, fsync, rename over the target, fsync of the folder. Refuses (throws) when the target is a symbolic link. Takes no lock (SEAM 2).
 * The one writer of the two files this slice adds (TREE_HANDOFF.md here, report.json in src/tree-report.js).
 */
export function writeTreeFileAtomic(rootDir, name, text) {
  const dir = join(rootDir, TREE_DIR);
  const target = join(dir, name);
  try { if (lstatSync(target).isSymbolicLink()) throw new Error(`refused: ${name} is a symbolic link, and nothing was written`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const tmp = join(dir, `.${name}.tmp-${process.pid}`);
  const fd = openSync(tmp, 'w', 0o666);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, target);
  fsyncDir(dir);
  return { path: target, sha256: sha256Of(text), bytes: Buffer.byteLength(text) };
}

/** Gather, render and write `<rootDir>/tree/TREE_HANDOFF.md` atomically (writeTreeFileAtomic). Takes no lock (SEAM 2). */
export function writeTreeHandoff(rootDir, { work } = {}) {
  return writeTreeFileAtomic(rootDir, HANDOFF_FILE, renderTreeHandoff(gatherHandoffFacts(rootDir, { work })));
}
