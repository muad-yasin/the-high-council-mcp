// S8-6a, the readers for the two things that exist on release already (C&C's go, 12 Oct 2026; MCP-surface SHA-stop: the P9/P14 pins move, old -> new):
//   HELD NODES (the held state, c3a7318): TREE_HANDOFF.md, tree/report.json and the MCP tree_status payload show a held node as "held pending the new root plan", never as "no longer part of the tree" / dead. A held node is an
//     orphan to `orphansOf` by design (A's contract D1), so every reader that lists orphans listed it as gone.
//   A REQUESTED STOP (`council tree stop`): the marker is a FILE, not a record event, and only `council tree status` read it. TREE_HANDOFF.md, tree/report.json, the MCP tree_status payload (it already had `stopMarker`) and
//     run_status's `tree` block (src/mcp/tree-block.js) now say a stop was requested, under the one name `stopMarker`; and `council tree stop` itself refreshes the two files (the marker moves no record position, so nothing
//     else would), through the views lock, with a named problem line, never fatal.
//   S8-6a2 (HD-5..HD-8, C&C 12 Oct: picked as ONE unit with S8-6a): the status VIEW (src/tree-status.js, also the `view` text of the MCP payload) says the same held sentence as the handoff and lists a held node as held, never under "Dead with a replaced parent".
// New exports are read through a namespace (the habit from the views-lock slip). Everything is mock and $0; every folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';
import { buildTreeReport, renderTreeReport } from '../src/tree-report.js';
import { treeStatusPayload, treeStatusResult } from '../src/mcp/tree-status.js';
import { treeBlock } from '../src/mcp/tree-block.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import * as handoff from '../src/tree-handoff.js';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { heldKeys } from '../src/tree-transitions.js';
import * as run from '../src/tree-run.js';
import { track } from './helpers/temp-trees.js';
import { GATE_FIELDS, IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

const marker = await import('../src/tree-stop-marker.js').catch(() => ({}));
const HANDOFF = rootDir => join(rootDir, 'tree', 'TREE_HANDOFF.md');
const REPORT = rootDir => join(rootDir, 'tree', 'report.json');

/** A REAL record in the held window (as test/tree-held-state.test.js's money test builds it): R/M1 closed and passed, the root's stop answered by a root re-plan, R@g2 opened. R/M1@g1 is HELD. */
function heldTree() {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], { usage: [{ file: 'a', usd: 0.5, provider: 'mock' }] });
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 9.5 });
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] });
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  assert.deepEqual([...heldKeys(stateOf(readTreeRecord(t.rootDir)))], ['R/M1@g1'], 'the fixture is in the held window');
  return t;
}
const section = (text, title) => { const i = text.indexOf(`### ${title}`); if (i < 0) return null; const j = text.indexOf('\n#', i + 4); return text.slice(i, j < 0 ? undefined : j); };

test('HD-1 TREE_HANDOFF.md shows a HELD node under "Held pending the new root plan" and NOT under "No longer part of the tree" (known-bad at the base: it was listed as no longer part of the tree)', () => {
  const t = heldTree();
  const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  const held = section(text, 'Held pending the new root plan'); const gone = section(text, 'No longer part of the tree');
  assert.ok(held, 'the section exists'); assert.match(held, /R\/M1/); assert.match(held, new RegExp(IDS[0]));
  assert.ok(gone, 'the other section still exists'); assert.doesNotMatch(gone, /R\/M1/, 'a held node is not "no longer part of the tree"');
});

test('HD-2 tree/report.json has an additive `heldNodes` list ({ node, generation, runId }, sorted) and the report\'s contract lists it; empty when nothing is held', () => {
  const t = heldTree();
  const r = buildTreeReport(t.rootDir, { work: t.work });
  assert.deepEqual(r.heldNodes, [{ node: 'R/M1', generation: 1, runId: IDS[0], route: 'root', replaces: null }]);   // EDITED in the M7 apply (C2a-record commit 2; old: { node, generation, runId }; why: ONE list of held things for both routes, each row says which plan it hangs under: additive fields route and replaces)
  assert.equal(r.stopMarker, false, 'and the stop flag is a boolean, false without a marker');
  const calm = closedRootTree({ cap: 100 }); track(calm.work);
  assert.deepEqual(buildTreeReport(calm.rootDir, { work: calm.work }).heldNodes, []);
  assert.match(readFileSync(new URL('../src/tree-report.js', import.meta.url), 'utf8'), /heldNodes/, 'THE CONTRACT comment names the new keys (the P9 pin follows it)');
});

test('HD-3 the MCP tree_status payload has `heldNodes` and its `dead` list no longer contains the held path (known-bad at the base: the held path was "dead")', () => {
  const t = heldTree();
  const p = JSON.parse(treeStatusResult({ runsDir: t.runsDir, run: ROOT_ID, work: t.work }).content[0].text);       // the real tool path (the held nodes come from the status facts, S8-6a2)
  assert.deepEqual((p.heldNodes ?? []).map(h => [h.node, h.generation, h.runId]), [['R/M1', 1, IDS[0]]]);
  assert.equal(p.dead.some(d => d.node === 'R/M1'), false, 'a held path is not dead');
  assert.deepEqual(p.keptNodes, [], 'nothing is passed over yet: an empty list, not a missing key');
  // K2 (C2a-record): after the release the SAME node is in `keptNodes` and in neither `heldNodes` nor `dead`
  releaseHeld(t);
  const q = JSON.parse(treeStatusResult({ runsDir: t.runsDir, run: ROOT_ID, work: t.work }).content[0].text);
  assert.deepEqual([q.heldNodes, q.keptNodes.map(h => [h.node, h.generation, h.runId]), q.dead.some(d => d.node === 'R/M1')], [[], [['R/M1', 1, IDS[0]]], false]);
});

test('HD-4 (K2, C2a-record) after the held state is RELEASED the same node reads as KEPT ("Kept from an earlier root plan"), is in `keptNodes` and in no `heldNodes` (the release case: an `held_released` record, the exit X2)', () => {
  const t = heldTree();
  // the record as it stands after the release (exit X2). The table accepts `held_released` only once R@g2 is registered and closed (src/tree-transitions.js:485), and this fixture stops at `generation_opened`, so the line is appended raw, in the writer's own shape: a READER test, not a writer test. (Old comment: "the table refuses `held_released` until the loop that writes it exists (S8-5)". It was never the table's reason: the registered-and-closed rule is in the table's first version, 3945050.)
  const last = readTreeRecord(t.rootDir).events.at(-1);
  appendFileSync(join(treeDirOf(t.rootDir), 'events.jsonl'), `${JSON.stringify({ schema: last.schema, id: `e${Number(last.id.slice(1)) + 1}`, at: new Date().toISOString(), event: 'held_released', reason: 'no_children', nodes: ['R/M1@g1'] })}\n`);
  // EDITED 18 Okt 2026 (C2a-record K2; C2a_Gate_Page.md section 3). OLD: heldKeys size 0 ("released"), the node under "No longer part of the tree", report.heldNodes []. NEW: the node stays in heldKeys (passed over), the handoff lists it under "Kept from an earlier root plan" and not under "No longer part of the tree", report.heldNodes [] and report.keptNodes has it. WHY: release is not death (Muad 12 Oct 21:25).
  assert.equal(heldKeys(stateOf(readTreeRecord(t.rootDir))).size, 1, 'still held (passed over)');
  const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  assert.match(section(text, 'Kept from an earlier root plan') ?? '', /R\/M1/); assert.doesNotMatch(section(text, 'No longer part of the tree') ?? '', /R\/M1/); assert.doesNotMatch(section(text, 'Held pending the new root plan') ?? '', /R\/M1/);
  assert.deepEqual(buildTreeReport(t.rootDir, { work: t.work }).heldNodes, []);
  assert.deepEqual(buildTreeReport(t.rootDir, { work: t.work }).keptNodes.map(h => [h.node, h.generation]), [['R/M1', 1]]);
});

test('ST-1 the leaf module owns the stop marker (src/tree-stop-marker.js: STOP_MARKER, stopMarkerPath, stopRequested) and src/tree-run.js re-exports the SAME functions - no importer changes (the SITTING_LOCK_FILE pattern, which breaks the tree-handoff -> tree-run import cycle)', () => {
  assert.equal(typeof marker.stopRequested, 'function', 'the leaf exists');
  assert.equal(run.stopRequested, marker.stopRequested); assert.equal(run.stopMarkerPath, marker.stopMarkerPath); assert.equal(run.STOP_MARKER, marker.STOP_MARKER);
  assert.doesNotMatch(readFileSync(new URL('../src/tree-stop-marker.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''), /from '\.\/tree-(run|handoff|report|files)\.js'/, 'the leaf imports none of the modules that would make a cycle');
});

test('ST-2 a requested stop is SHOWN: TREE_HANDOFF.md says so (a line under the readiness), tree/report.json has `stopMarker: true`, the MCP tree_status payload keeps its `stopMarker`, and run_status\'s `tree` block carries `stopMarker`; all false/absent without the marker (known-bad at the base: none of the first, second and fourth knew)', () => {
  const t = heldTree(); track(t.work);
  const calm = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work })); assert.doesNotMatch(calm, /stop was requested/i);
  run.requestStop(t.rootDir);
  const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  assert.match(text, /A stop was requested/); assert.match(text, /council tree resume/);
  assert.equal(buildTreeReport(t.rootDir, { work: t.work }).stopMarker, true);
  assert.equal(treeStatusPayload(gatherStatusFacts(t.rootDir, { work: t.work })).stopMarker, true);
  const block = treeBlock(t.runsDir, ROOT_ID, { treeId: ROOT_ID, node: 'R', generation: 1 });
  assert.equal(block.stopMarker, true, JSON.stringify(block));
  run.clearStop(t.rootDir);
  assert.equal(treeBlock(t.runsDir, ROOT_ID, { treeId: ROOT_ID, node: 'R', generation: 1 }).stopMarker, false);
});

test('ST-3 `council tree stop` REFRESHES the two files (the marker moves no record position, so nothing else would): on an idle tree, after the command TREE_HANDOFF.md says a stop was requested and report.json says stopMarker true (known-bad at the base: neither file existed/said so)', async () => {
  const t = heldTree();
  assert.equal(existsSync(HANDOFF(t.rootDir)), false);
  const out = new PassThrough(); const err = new PassThrough(); let o = ''; let e = ''; out.on('data', d => { o += d; }); err.on('data', d => { e += d; });
  assert.equal(await run.stopHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: out, stderr: err, now: () => Date.now() }), 0, o + e);
  assert.match(readFileSync(HANDOFF(t.rootDir), 'utf8'), /A stop was requested/);
  assert.equal(JSON.parse(readFileSync(REPORT(t.rootDir), 'utf8')).stopMarker, true);
  assert.equal(e, '', 'nothing went wrong');
});

test('ST-4 a failing refresh after `council tree stop` is NAMED, never fatal: with report.json a symbolic link the stop is still requested (exit 0), the handoff is written, and ONE plain line names report.json', async () => {
  const t = heldTree();
  mkdirSync(treeDirOf(t.rootDir), { recursive: true });
  symlinkSync(join(t.work, 'elsewhere.json'), REPORT(t.rootDir));
  const out = new PassThrough(); const err = new PassThrough(); let e = ''; err.on('data', d => { e += d; }); out.resume();
  assert.equal(await run.stopHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: out, stderr: err, now: () => Date.now() }), 0, e);
  assert.equal(run.stopRequested(t.rootDir), true); assert.ok(existsSync(HANDOFF(t.rootDir)));
  const lines = e.split('\n').filter(l => /report\.json/.test(l)); assert.equal(lines.length, 1, e); assert.match(lines[0], /could not be written/);
  assert.equal(existsSync(join(t.work, 'elsewhere.json')), false);
  unlinkSync(REPORT(t.rootDir));
});

test('ST-5 the `tree` block keeps its TRUST rule for the marker: a run.json that names a tree whose record does NOT list this run (a forged tree id) must not show that tree\'s stop marker - only a run the record lists sees it (known-bad at d84cf7a: the marker was set before the "record lists this run" check)', () => {
  const t = heldTree();
  run.requestStop(t.rootDir);
  const forged = treeBlock(t.runsDir, '2026-10-08T11-59-00-000Z', { treeId: ROOT_ID, node: 'R/M1', generation: 1 });
  assert.match(forged.note ?? '', /does not list this run/); assert.equal(forged.stopMarker, false, 'another tree\'s marker is not shown to a run the record does not list');
  assert.equal(treeBlock(t.runsDir, ROOT_ID, { treeId: ROOT_ID, node: 'R', generation: 1 }).stopMarker, true, 'control: the root run IS listed and sees it');
  assert.equal(treeBlock(t.runsDir, ROOT_ID, { treeId: null, node: 'R', generation: 1 }).stopMarker, false, 'no tree id: false');
});

// ---- S8-6a2: the status view (src/tree-status.js) ----
const HELD_TITLE = 'Held pending the new root plan';
const heldSentence = () => { assert.equal(typeof handoff.HELD_PENDING_SENTENCE, 'string', 'src/tree-handoff.js exports the ONE held sentence (HELD_PENDING_SENTENCE)'); return handoff.HELD_PENDING_SENTENCE; };
const viewSection = (text, title) => { const i = text.indexOf(`\n${title}\n`); if (i < 0) return null; const j = text.indexOf('\n\n', i + 2); return text.slice(i, j < 0 ? undefined : j); };
const releaseHeld = t => {
  const last = readTreeRecord(t.rootDir).events.at(-1);       // raw append in the writer's shape (src/tree-loop.js): the table (X2) accepts `held_released` only once the new root plan R@g2 is REGISTERED and CLOSED, and this reader test does not build that state
  appendFileSync(join(treeDirOf(t.rootDir), 'events.jsonl'), `${JSON.stringify({ schema: last.schema, id: `e${Number(last.id.slice(1)) + 1}`, at: new Date().toISOString(), event: 'held_released', reason: 'no_children', nodes: ['R/M1@g1'] })}\n`);
};

test('HD-5 `council tree status` lists a HELD node under "Held pending the new root plan" with the one held sentence and NOT under "Dead with a replaced parent" (known-bad at the base: the view called the held path dead and had no held section)', () => {
  const t = heldTree();
  const facts = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.deepEqual((facts.heldNodes ?? []).map(h => [h.node, h.generation, h.runId]), [['R/M1', 1, IDS[0]]], 'the facts carry the held nodes');
  assert.equal(facts.dead.some(d => d.node === 'R/M1'), false, 'a held path is not in `dead`');
  const text = renderTreeStatus(facts);
  const held = viewSection(text, HELD_TITLE);
  assert.ok(held, `the view has the section:\n${text}`);
  assert.ok(held.includes(heldSentence()), 'the section says the one held sentence');
  assert.match(held, /R\/M1\s+generation 1\s+run /); assert.ok(held.includes(IDS[0]));
  assert.equal(text.includes('Dead with a replaced parent'), false, 'nothing else is dead here, so the dead section is absent');
  assert.ok(text.indexOf(HELD_TITLE) > text.indexOf('\nWaiting\n') && text.indexOf(HELD_TITLE) < text.indexOf('\nHeld and refused\n'), 'the section sits between Waiting and Held and refused');
});

test('HD-6 ONE held sentence: the handoff, the status view and the MCP `view` text say the same words, and src/tree-status.js holds no copy of them', () => {
  const t = heldTree(); const sentence = heldSentence();
  assert.ok(renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work })).includes(sentence), 'the handoff');
  assert.ok(renderTreeStatus(gatherStatusFacts(t.rootDir, { work: t.work })).includes(sentence), 'the status view');
  const p = JSON.parse(treeStatusResult({ runsDir: t.runsDir, run: ROOT_ID, work: t.work }).content[0].text);
  assert.ok(p.view.includes(sentence), 'the MCP view text: one response no longer disagrees with its own heldNodes');
  assert.equal(p.view.includes('Dead with a replaced parent'), false, 'and the view does not call the held path dead');
  assert.doesNotMatch(readFileSync(new URL('../src/tree-status.js', import.meta.url), 'utf8'), /kept while the new root plan is made/, 'the words live in src/tree-handoff.js only');
});

test('HD-7 (K2, C2a-record) no held section on a calm tree, and none after the release: the released node reads as KEPT, not as dead (the X2 exit), in the view and in the facts', () => {
  const calm = closedRootTree({ cap: 100 }); track(calm.work);
  const calmFacts = gatherStatusFacts(calm.rootDir, { work: calm.work });
  assert.deepEqual(calmFacts.heldNodes, [], 'an empty list, not missing'); assert.equal(renderTreeStatus(calmFacts).includes(HELD_TITLE), false);
  const t = heldTree(); releaseHeld(t);
  const facts = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.deepEqual(facts.heldNodes, []);
  const text = renderTreeStatus(facts);
  // EDITED 18 Okt 2026 (C2a-record K2). OLD: the released node was dead with a replaced parent (facts.dead had R/M1; the view had a "Dead with a replaced parent" section). NEW: it is kept (facts.keptNodes; the view's "Kept from an earlier root plan" section) and is in neither the held nor the dead list.
  assert.equal(text.includes(HELD_TITLE), false, 'passed over: nothing is held pending the new plan');
  assert.deepEqual(facts.keptNodes.map(h => h.node), ['R/M1']); assert.equal(facts.dead.some(d => d.node === 'R/M1'), false, 'the passed-over node is not dead');
  assert.match(viewSection(text, 'Kept from an earlier root plan') ?? '', /R\/M1/);
});

test('HD-8 an unreadable record gives the facts an empty `heldNodes` (not a missing key) and a view without the section', () => {
  const t = heldTree();
  writeFileSync(join(treeDirOf(t.rootDir), 'tree.json'), '{ not json');
  const facts = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.ok(facts.problems.length, 'the fixture is unreadable'); assert.deepEqual(facts.heldNodes, []);
  assert.equal(renderTreeStatus(facts).includes(HELD_TITLE), false);
});
