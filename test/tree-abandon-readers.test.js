// ROADMAP 57, commit 3: what every READER of a tree says once a person has abandoned it (contract Review/Build_0.8.3/m6-closing/ROADMAP57_Tree_Abandon_Contract.md section 3; the record side is commit 1, src/tree-abandon.js).
// A final tree has no verdict (its retired stops no longer hold one back, so a computed one could read `ready`), no next step, no open stop, nothing waiting and nothing held: `council tree status`, TREE_HANDOFF.md,
// tree/report.json, the MCP `tree_status` payload and the `tree` block of `run_status` all say so, from ONE record helper and ONE sentence (`abandonedSentence`).
// The state is made by the real verbs on a real all-mock tree (a failed integration check opens a stop), and then by c1's writer `abandonTree`. Its gate fields are FIXTURE strings: c2's form (`decide --abandon`) is not exercised here,
// and NO sitting or verb is run on an abandoned tree (what those write on a final tree is commit 2's, not pinned here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { abandonTree } from '../src/tree-abandon.js';
import * as SPEND from '../src/spend.js';
import { abandonedSentence } from '../src/tree-transitions.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { checkHandler } from '../src/tree-check.js';
import { buildTreeReport, renderTreeReport } from '../src/tree-report.js';
import { HELD_PENDING_SENTENCE, gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';
import { treeBlock } from '../src/mcp/tree-block.js';
import { registerRoot } from '../src/tree-register.js';
import { cli, newTree } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const GATE = { gateId: 'g-fixture', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' };            // FIXTURE strings: the form (c2) is not exercised. K10 (EDITED; OLD: no actor/via; NEW: a person at the terminal; WHY: the table requires who answered on a new abandon)
const NEXT_STEP = /council tree (resume|approve|decide|check|stop)\b/;          // a final tree names none of these commands anywhere
const A1 = 'R@g1:A1';
const rootBlock = () => { const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null }; return b; };

/** A finished tree with one open integration stop (a recorded failed check): the readers have a verdict, an open stop and next steps to show. */
async function treeWithOpenStop() {
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(rootBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const io = terminal([A1, 'y']);
  assert.equal(await checkHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, args: [A1, 'fail'], flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  return r;
}
const facts = r => gatherStatusFacts(r.t.rootDir, { work: r.t.work });
const stopOf = r => stateOf(readTreeRecord(r.t.rootDir)).openStops;

test('DA-5a `council tree status` of an abandoned tree: the one sentence, what it left unanswered, no verdict, no waiting/held/open-stop sections, no command, and "Nothing: the tree is final."', async () => {
  const r = await treeWithOpenStop();
  const before = renderTreeStatus(facts(r));
  assert.match(before, /Verdict: blocked/); assert.match(before, NEXT_STEP, 'the control: an open tree names its next steps');
  const [stopId] = stopOf(r); assert.ok(stopId, 'the control: a stop is open');
  abandonTree(r.t.rootDir, GATE);
  const f = facts(r); const text = renderTreeStatus(f);
  assert.ok(text.includes(abandonedSentence(stateOf(readTreeRecord(r.t.rootDir)))), text);
  assert.match(text, new RegExp(`Stops it left unanswered: ${stopId}\\b`));
  assert.ok(!/Verdict:/.test(text), 'no verdict'); assert.ok(!NEXT_STEP.test(text), `no command is named:\n${text}`);
  for (const gone of ['\nWaiting\n', 'Held and refused', '\nOpen stops\n', 'Held pending the new root plan']) assert.ok(!text.includes(gone), `${gone.trim()} is not printed`);
  assert.match(text, /Holds: none \(released when the tree was abandoned\)\./);
  assert.ok(text.trimEnd().endsWith('What you can do\n  Nothing: the tree is final.'), text.slice(-120));
  assert.ok(text.includes('\nNodes\n'), 'the nodes stay as history');
  assert.deepEqual([f.waiting, f.awaitingApproval, f.openStops, f.stopToOpen, f.heldNodes, f.memberRefusals, f.closedUnstarted], [[], [], [], [], [], [], []], 'the FACTS are emptied, not only the text');
  assert.equal(f.rootUnstarted, false);
});

test('DA-5b tree/report.json: `abandoned` carries the fold\'s ids (no verdict reason can hold it back), readiness.verdict is null and reasons are empty; the file is byte-identical when written twice; an open tree has `abandoned: null`', async () => {
  const r = await treeWithOpenStop();
  assert.ok(!buildTreeReport(r.t.rootDir, { work: r.t.work }).abandoned, 'an open tree is not abandoned');
  assert.notEqual(buildTreeReport(r.t.rootDir, { work: r.t.work }).readiness.verdict, null, 'the control: an open tree has a verdict');
  const [stopId] = stopOf(r);
  abandonTree(r.t.rootDir, GATE);
  const rep = buildTreeReport(r.t.rootDir, { work: r.t.work });
  assert.equal(rep.readiness.verdict, null); assert.deepEqual(rep.readiness.reasons, []);
  const ev = readTreeRecord(r.t.rootDir).events.find(e => e.event === 'tree_abandoned');
  assert.deepEqual(rep.abandoned, { eventId: ev.id, at: ev.at, gateId: GATE.gateId, shownSha256: GATE.shownSha256, retiredStops: [stopId] });
  const a = renderTreeReport(buildTreeReport(r.t.rootDir, { work: r.t.work })); const b = renderTreeReport(buildTreeReport(r.t.rootDir, { work: r.t.work }));
  assert.equal(a, b); assert.deepEqual(JSON.parse(a).abandoned, rep.abandoned);
});

test('DA-5c TREE_HANDOFF.md: an `Abandoned` section (the sentence, the event, the stops it left unanswered with their nodes), no verdict, no reading order, no integration results to record, no command; byte-identical twice', async () => {
  const r = await treeWithOpenStop();
  const before = renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work }));
  assert.match(before, /## 1\. Readiness/); assert.match(before, /### Integration checks/);
  const [stopId] = stopOf(r);
  abandonTree(r.t.rootDir, GATE);
  const text = renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work }));
  assert.equal(text, renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work })), 'byte-identical when generated twice');
  assert.match(text, /## 1\. Abandoned/); assert.ok(text.includes(abandonedSentence(stateOf(readTreeRecord(r.t.rootDir)))));
  assert.match(text, new RegExp(`- ${stopId} \\(an integration stop, which belongs to no node\\)`));
  assert.ok(!text.includes(HELD_PENDING_SENTENCE), 'no reader of a final tree shows "held" (the abandon released every held node)');
  for (const gone of ['Verdict:', '## 1. Readiness', '## 2. Reading and build order', '### Integration checks', '### Open decisions', '## 5. Pointers', 'Held pending the new root plan']) assert.ok(!text.includes(gone), `${gone} is not in a final tree's file`);
  assert.ok(!NEXT_STEP.test(text), `no command is named:\n${text.slice(0, 600)}`);
  assert.ok(text.includes('## 3. What to read next\n\n- Nothing: the tree is final.'));
  assert.ok(text.includes('## 2. Nodes at their newest generation'));
});

test('DA-5d MCP: `tree_status` carries `abandoned` (trusted ids and times) with verdict null and every list that offers a next step empty; the `tree` block of `run_status` has abandoned true, no active node and no stale verdict', async () => {
  const r = await treeWithOpenStop();
  const open = treeStatusPayload(facts(r));
  assert.ok(!open.abandoned); assert.notEqual(open.verdict.value, null); assert.ok(open.openStops.length > 0);
  const member = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(n => n.node === 'R/M1');
  const marker = { treeId: ROOT_ID, node: 'R/M1', generation: 1 };
  const blockBefore = treeBlock(r.t.runsDir, member.runId, marker);
  assert.ok(!blockBefore.abandoned); assert.notEqual(blockBefore.verdict, null, 'the control: a recorded verdict is shown for an open tree');
  abandonTree(r.t.rootDir, GATE);
  const p = treeStatusPayload(facts(r));
  assert.equal(p.verdict.value, null); assert.deepEqual(p.verdict.reasons, []);
  assert.ok(p.abandoned && p.abandoned.gateId === GATE.gateId && Array.isArray(p.abandoned.retiredStops));
  assert.deepEqual([p.openStops, p.waiting, p.awaitingApproval, p.held.registeredNotStarted, p.held.parentChanged, p.held.guardRefusals, p.held.splitChanged, p.heldNodes], [[], [], [], [], [], [], [], []]);
  assert.ok(!NEXT_STEP.test(p.view), 'the view text names no command');
  const block = treeBlock(r.t.runsDir, member.runId, marker);
  assert.equal(block.abandoned, true); assert.equal(block.activeNode, null); assert.equal(block.verdict, null, 'a recorded `ready`/`blocked` from before is stale');
});

test('DA-6 the STRANDED ROOT (registered, its run never started): before the abandon the readers tell the person to `council tree resume`; after it every reader says abandoned, nothing is startable, nothing is held', async () => {
  const t = newTree({ cap: 50 }); registerRoot(t.rootDir);
  const before = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.equal(before.rootUnstarted, true); assert.match(renderTreeStatus(before), /start the root plan with `council tree resume/);
  abandonTree(t.rootDir, GATE);
  const f = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.equal(f.rootUnstarted, false); assert.ok(f.abandoned);
  const text = renderTreeStatus(f);
  assert.ok(!NEXT_STEP.test(text), text); assert.ok(!/start the root plan/.test(text));
  assert.ok(text.trimEnd().endsWith('What you can do\n  Nothing: the tree is final.'));
  assert.equal(buildTreeReport(t.rootDir, { work: t.work }).abandoned.gateId, GATE.gateId);
  const hand = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  assert.match(hand, /## 1\. Abandoned/); assert.ok(!/The root plan has not been started/.test(hand), 'no "start the root plan" step in a final tree');
  assert.equal(treeStatusPayload(f).abandoned.gateId, GATE.gateId);
});

test('DA-5e `council --spend`: the tree\'s line gains "; abandoned" (CLI text only); the MCP `trees` entry keeps exactly its three keys', async () => {
  const r = await treeWithOpenStop();
  const spend = () => spawnSync(process.execPath, [cli, '--spend', '--days', '36500'], { cwd: r.t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: r.t.work } });
  const lineOf = out => out.split('\n').find(l => l.includes(`tree ${ROOT_ID}:`));
  const line0 = lineOf(spend().stdout);
  assert.ok(line0 && line0.endsWith('already in the total'), spend().stdout + spend().stderr);
  abandonTree(r.t.rootDir, GATE);
  assert.equal(lineOf(spend().stdout), `${line0}; abandoned`);
  assert.equal(SPEND.treeIsAbandoned(r.t.runsDir, ROOT_ID), true);
  const rep = SPEND.spendReport(r.t.runsDir, { days: 36500, now: Date.now() });
  assert.deepEqual(Object.keys(rep.trees[0]).sort(), ['memberRuns', 'treeId', 'usd'], 'the MCP entry is unchanged: the flag is not in the report');
  assert.equal(SPEND.treeIsAbandoned(r.t.runsDir, 'no-such-tree'), false);
});
