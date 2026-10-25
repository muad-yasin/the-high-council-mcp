// `council tree status`, the view (0.8.3 M6 slice S6; the M6 pins). Offline, $0: hand-built facts for the renderer, REAL all-mock trees (and hand-built records) for the reader. One fixture per pin:
// orphan wording; split_changed by each of its three writers; registered-not-started with its grant; a frontier closed under a changed parent; tree/STOP; open stops with the command that answers each; a provider
// pin that changed (blocked) worded differently from a newer provider generation (incomplete); the two money figures never merged; "ready" only when S1 says so. Every wording check compares with the OWN renderer's output
// (no second wording path), and a known-bad input is fed to each check that could pass by construction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { awaitingApprovalOf, chooseNextChild, registerNextChild } from '../src/tree-loop.js';
import { requestStop, runTree } from '../src/tree-run.js';
import { verifySplit } from '../src/tree-expansion.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { approveHandler } from '../src/tree-approve.js';
import { sittingLines } from '../src/tree-resume.js';
import { money, renderHeldChildren, renderParentChanged, renderSplitChanged, prefixOf } from '../src/tree-stop.js';
import { splitChangedOf } from '../src/tree-split-changed.js';
import { gatherStatusFacts, renderTreeStatus, statusHandler } from '../src/tree-status.js';
import { sha256Of } from '../src/thin-contract.js';
import { GATE_FIELDS, IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, newTree, registerKid, reservedLine, rootOpts, root as repoRoot, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren, pricedChildren, splitChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const HEX = c => c.repeat(64);
const snapshot = dir => { const out = {}; const walk = p => { for (const n of readdirSync(p).sort()) { const f = join(p, n); if (statSync(f).isDirectory()) { out[`${f}/`] = true; walk(f); } else out[f] = readFileSync(f, 'utf8'); } }; walk(dir); return out; };
const view = (t, work = t.work) => renderTreeStatus(gatherStatusFacts(t.rootDir, { work }));
const lines = text => text.split('\n');
const section = (text, head) => { const i = lines(text).indexOf(head); if (i < 0) return ''; const rest = lines(text).slice(i + 1); const j = rest.findIndex(l => l !== '' && !l.startsWith(' ')); return rest.slice(0, j < 0 ? rest.length : j).join('\n'); };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the renderer, on hand-built facts
const T1 = '2026-10-11T12:00:01.000Z';
const facts = (over = {}) => ({
  rootId: 'rootid', treeId: 'rootid', position: { lastEventId: 'e9', lastEventAt: T1, events: 9 }, consistency: null, problems: [], stopMarker: false,
  readiness: { source: 'computed', verdict: 'incomplete', reasons: [{ severity: 'incomplete', code: 'open_stop', scope: 'R@g1', text: 'a needs_decision stop (e7) is open' }], eventId: 'e9', at: T1 },
  gate: { ok: true, problems: [] },
  nodes: [{ node: 'R', generation: 1, depth: 0, runId: 'rootid', phase: 'closed', outcome: 'passed', nextGeneration: null }, { node: 'R/M1', generation: 2, depth: 1, runId: 'run-m1-2', phase: 'registered', outcome: null, nextGeneration: 3 }],
  waiting: [{ node: 'R/M2', why: ['R/M1 is not registered yet'] }], awaitingApproval: ['a'.repeat(64)],
  held: { registeredNotStarted: [{ node: 'R/M1', generation: 2, runId: 'run-m1-2', grantUsd: 5.25 }], parentChanged: [{ frontierKey: 'b'.repeat(64) }], guardRefusals: [{ node: 'R/M3', generation: 1, guard: 'g', item: 'an item' }] },
  splitChanged: [{ kind: 'verified', node: 'R', generation: 1, verified: 'c'.repeat(12), now: 'd'.repeat(12) }], dead: [{ node: 'R/M1/M1', why: ['R/M1/M1 is not registered: dead with a replaced plan'] }],
  openStops: [{ id: 'e7', node: 'R/M2', generation: 1, text: 'Stop e7: R/M2 generation 1 ended.\n\nYou can:\n  - regenerate: council tree decide rootid --stop e7\n' }],
  limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 4, attemptsPerChild: 1, runs: 3, raised: [{ id: 'e4', at: T1, limit: 'maxRuns', from: 12, to: 20 }] },
  money: { unit: 'usd', rootCapUsd: 100, memberSpend: { sumUsd: 0.7, members: [{ node: 'R', generation: 1, runId: 'rootid', started: true, runSpentUsd: 0.7 }], reservations: [] }, adjustments: { sumUsd: -0.3, reservations: [{ key: 'k' }] } },
  ...over,
});

test('the renderer: the sections in order, every piece through its own renderer, the money as two figures that are not added, and a clean tree says there is nothing to do', () => {
  const f = facts();
  const text = renderTreeStatus(f);
  const heads = ['Verdict: incomplete', 'Nodes', 'Dead with a replaced parent', 'Waiting', 'Held and refused', 'Open stops', 'Limits', 'Money', 'What you can do'];
  const at = heads.map(h => text.indexOf(h));
  assert.ok(at.every(i => i >= 0), `missing: ${heads.filter((h, i) => at[i] < 0)}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the sections are in order');
  assert.equal(renderTreeStatus(structuredClone(f)), text, 'pure');
  for (const l of [...renderHeldChildren(f.held.registeredNotStarted, 'rootid'), ...renderParentChanged(f.held.parentChanged, 'rootid'), ...renderSplitChanged(f.splitChanged, 'rootid')]) assert.ok(text.includes(l), `from the shared renderer: ${l.slice(0, 60)}`);
  assert.match(text, /Spent by the member runs: \$0\.70 \(1 run started\)/); assert.match(text, /adjustments: -\$0\.30 \(1 reservation\)/); assert.match(text, /two figures and are not added here/);
  assert.equal(text.includes(money(0.4)), false, 'the sum of the two figures is nowhere in the text');
  assert.match(text, /generation 3 was opened and is not registered yet/);
  assert.match(text, /council tree decide rootid --stop e7/, 'the stop text carries the command that answers it');
  const quiet = renderTreeStatus(facts({ readiness: { source: 'computed', verdict: 'ready', reasons: [], eventId: 'e9', at: T1 }, waiting: [], awaitingApproval: [], held: { registeredNotStarted: [], parentChanged: [], guardRefusals: [] }, splitChanged: [], dead: [], openStops: [] }));
  assert.match(quiet, /Verdict: ready/); assert.match(quiet, /Nothing is asked of you right now\./); assert.match(quiet, /\(nothing is waiting\)/); assert.match(quiet, /Open stops\n {2}\(none\)/);
  // bad: a renderer that prints a merged total would be caught by the same check
  assert.equal((renderTreeStatus(f) + '\nTotal $0.40').includes(money(0.4)), true);
});

test('the start hint is shown only when `resume` would start the child: not under a stop marker, not with an open stop, not with a failing accounting gate', () => {
  const free = facts({ readiness: { source: 'computed', verdict: 'incomplete', reasons: [], eventId: 'e9', at: T1 }, awaitingApproval: [], openStops: [], gate: { ok: true, problems: [] } });
  assert.match(renderTreeStatus(free), /start the registered child with `council tree resume rootid`/);
  assert.doesNotMatch(renderTreeStatus({ ...free, gate: { ok: false, problems: [{ code: 'mirror_disagrees' }] } }), /start the registered child/, 'a failing gate: resume makes no paid start');
  assert.doesNotMatch(renderTreeStatus({ ...free, openStops: [{ id: 'e7', node: 'R/M1', generation: 2, text: 'Stop e7\n' }] }), /start the registered child/, 'an open stop holds the child');
  assert.doesNotMatch(renderTreeStatus({ ...free, stopMarker: true }), /start the registered child/);
});

test('the stop marker uses the sitting\'s own sentence; a record that does not read, a moving record and a failing accounting gate are said in words', () => {
  const stopped = renderTreeStatus(facts({ stopMarker: true }));
  for (const l of sittingLines({ status: 'stopped_by_person', started: [] }, 'rootid')) assert.ok(stopped.includes(l), l);
  assert.equal(renderTreeStatus(facts({ stopMarker: false })).includes('A stop is in force'), false, 'bad: no marker, no sentence');
  const bad = renderTreeStatus(facts({ problems: ['the tree record is corrupt at line 3: not json'], consistency: 'the record was still changing while it was read', gate: { ok: false, problems: [{ code: 'mirror_disagrees' }, { code: 'mirror_disagrees' }] } }));
  assert.match(bad, /The record could not be read:\n {2}the tree record is corrupt at line 3/); assert.match(bad, /WARNING: the record was still changing/);
  assert.match(bad, /accounting gate does not trust the record \(2 problems: mirror_disagrees\)/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- real trees
const leafRootChain = () => {
  const c = JSON.parse(readFileSync(join(repoRoot, 'chains', 'mock-debate.json'), 'utf8'));
  return { ...c, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-reads-prompt' } }, handoff_contract: { ...(c.handoff_contract ?? {}), milestones: true } };
};
async function leafTree() {
  const t = newTree({ rootChain: 'leaf-root', extraChains: { 'leaf-root': leafRootChain() } }); track(t.work);
  registerRoot(t.rootDir);
  const res = await api.run(rootOpts(t));
  assert.equal(res.exitCode, 0, res.outputTail);
  return t;
}

test('"ready" only when S1 says so: a finished one-node tree reads ready with no reason; the same tree with a needs_decision stop opened reads NOT ready, names the stop, shows its text with its route (no `decide` command where decide would refuse), and exits the view with 0; nothing on disk changes', async () => {
  const t = await leafTree();
  const before = snapshot(t.work);
  const ready = view(t);
  assert.match(ready, /Verdict: ready \(computed from the record at e\d+/); assert.match(ready, /No reason: every rule of readiness holds/); assert.match(ready, /Open stops\n {2}\(none\)/);
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R', generation: 1 }] });
  const after = snapshot(t.work);
  const stopped = view(t);
  assert.doesNotMatch(stopped, /Verdict: ready/); assert.match(stopped, /Verdict: (incomplete|blocked)/); assert.match(stopped, /\[incomplete\] open_stop at R@g1/);
  const stopId = readTreeRecord(t.rootDir).events.find(e => e.event === 'needs_decision_opened').id;
  assert.match(stopped, new RegExp(`Stop ${stopId} on R@g1:`));
  assert.match(stopped, /answer it with a NEW ROOT plan: council tree decide \S+ --stop e\d+/, 'the stop text names its route');       // S8-4 (old: "the root's split has no needs-decision milestone, so the only route is a new root run")
  assert.match(stopped, /council tree decide \S+ --stop e\d+/, 'a root stop with no milestone is answered by decide now (S8-4; old: the view named no such command, decide refused)');
  assert.match(stopped, /answer the open stop with `council tree decide \S+` \(the stop text above says how\)/);       // S8-4 (old: "an open stop needs your answer: the stop text above names the route", while decide refused a root stop)
  assert.deepEqual(snapshot(t.work), after, 'viewing wrote nothing (every byte and folder as it was)');
  assert.notDeepEqual(before, after, 'bad: the snapshot check sees a real change when one happens');
  const out = { text: '', write(s) { this.text += s; } };
  assert.equal(await statusHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: out }), 0); assert.equal(out.text, stopped);
});

test('M6 pin: a child registered and not started names the child and the grant it holds (the shared renderer), says `council tree resume` starts it, and that is true', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered');
  const state = stateOf(readTreeRecord(r.t.rootDir)); const n = state.nodes.get(`${reg.node}@g1`);
  const grant = n.grant.amount + n.topUps.reduce((a, x) => a + x.amount, 0);
  const untouched = snapshot(r.t.work);
  const text = view(r.t);
  assert.deepEqual(snapshot(r.t.work), untouched, 'viewing a tree with a registered child wrote nothing (every byte and folder as it was)');
  assert.ok(text.includes(renderHeldChildren([{ node: reg.node, generation: 1, runId: n.runId, grantUsd: grant }], ROOT_ID)[0]));
  assert.match(text, new RegExp(`${reg.node} is registered but has not started: it holds a grant of ${money(grant).replace('$', '\\$')} \\(run ${n.runId}\\)`));
  assert.match(text, new RegExp(`start the registered child with \`council tree resume ${ROOT_ID}\``));
  assert.equal(view(r.t).includes('registered but has not started') && !view(r.t).includes('(nothing)'), true);
  // the count moves with what it counts: the registered child has no run, so it is not one; its spend is read, not assumed (the root's run is); the Limits line says its own count includes registered rows
  assert.match(text, /Spent by the member runs: \$\d+\.\d\d \(1 run started; 1 more member the record shows as not started: nothing spent\)\./);
  assert.match(text, /runs 2 of \d+ \(registered, started or not\), children per split/);
  const run = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.ok(run.started.map(s => s.node).includes(reg.node), 'the sentence is true: resume starts the registered child');
  assert.doesNotMatch(view(r.t), /is registered but has not started/, 'once it has started the line is gone');
  assert.match(view(r.t), /Spent by the member runs: \$\d+\.\d\d \(2 runs started\)\./, 'once it has started it is a run, and the clause is gone');
});

test('BUG-B-010: right after an approval the admitted child is not registered yet - the status names `council tree resume` (same holds as for a registered child), not "Nothing is asked of you right now", and chooseNextChild carries the approval list in this kind too', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const pick = chooseNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(pick.kind, 'child', JSON.stringify(pick.kind));
  assert.deepEqual(pick.awaitingApproval, awaitingApprovalOf(record, state), 'one rule: the child kind carries the list the none kind does');
  assert.deepEqual(pick.awaitingApproval, []);
  const f = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.equal(f.nextChild, pick.node);
  const text = renderTreeStatus(f);
  assert.match(text, new RegExp(`start the next child with \`council tree resume ${ROOT_ID}\``));
  assert.doesNotMatch(text, /Nothing is asked of you right now/);
  // a registered node is ACTIVE: resume retries it first, so the registered-child line stands alone and the new line is gone
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered');
  const after = view(r.t);
  assert.match(after, new RegExp(`start the registered child with \`council tree resume ${ROOT_ID}\``)); assert.doesNotMatch(after, /start the next child with/);
  // the holds of the registered-child line: a stop marker withholds it (a second tree in the same state, so the first assertion is not vacuous)
  const held = await trackedRealRoot(pricedChildren()); approvePending(held);
  assert.ok(gatherStatusFacts(held.t.rootDir, { work: held.t.work }).nextChild, 'precondition: the child is waiting');
  requestStop(held.t.rootDir);
  assert.doesNotMatch(view(held.t), /start the next child with/);
  // a tree whose frontier is not approved yet has no admitted child waiting for registration: no such line
  const fresh = await trackedRealRoot(pricedChildren());
  const pre = gatherStatusFacts(fresh.t.rootDir, { work: fresh.t.work });
  assert.equal(pre.nextChild, null); assert.doesNotMatch(renderTreeStatus(pre), /start the next child with/);
});

test('M6 pin: tree/STOP present: the sitting\'s sentence appears and the start hint is withheld; without the marker neither does', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  registerNextChild(r.t.rootDir, { work: r.t.work });
  const without = view(r.t);
  assert.doesNotMatch(without, /A stop is in force/); assert.match(without, /council tree resume/);
  requestStop(r.t.rootDir);
  const withStop = view(r.t);
  assert.match(withStop, /A stop is in force: no further node starts\./); assert.doesNotMatch(withStop, /start the registered child with/);
});

test('M6 pin: a frontier closed under a changed parent says so through renderParentChanged, with the approval as its remedy', async () => {
  const r2 = await trackedRealRoot(pricedChildren()); approvePending(r2);
  await runTree(r2.t.rootDir, { work: r2.t.work, maxStarts: 1, startRun: draftStarter(r2) });
  registerNextChild(r2.t.rootDir, { work: r2.t.work });
  const f = join(r2.t.runsDir, ROOT_ID, 'deliverable.md'); writeFileSync(f, `${readFileSync(f, 'utf8')}\nAn edit after the approval.\n`);
  await runTree(r2.t.rootDir, { work: r2.t.work, startRun: draftStarter(r2) });
  await runTree(r2.t.rootDir, { work: r2.t.work, startRun: draftStarter(r2) });
  const keys = [...stateOf(readTreeRecord(r2.t.rootDir)).parentBlocks.keys()].filter(Boolean);
  assert.ok(keys.length >= 1, 'the sitting recorded a parent_changed block');
  const untouched = snapshot(r2.t.work);
  const text = view(r2.t);
  assert.deepEqual(snapshot(r2.t.work), untouched, 'viewing a tree with a changed-parent frontier wrote nothing');
  for (const l of renderParentChanged(keys.map(frontierKey => ({ frontierKey })), ROOT_ID)) assert.ok(text.includes(l), l);
  assert.match(text, new RegExp(`approve it again \\(\`council tree approve ${ROOT_ID}\`\\)`));
});

const D = 'd'.repeat(64);
async function rootOf() { const r = await trackedRealRoot({ ...pricedChildren() }); return r; }
test('M6 pin: split_changed by each of its three writers - (B) a node verified again against another plan: the first verification stands and NO command is named; (C) `tree approve` found the record naming another split: the approve refusal text; (A) a frontier approved on another split: the new approval is the remedy', async () => {
  // (B)
  const b = await rootOf();
  const file = join(treeDirOf(b.t.rootDir), EVENTS_FILE);
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').map(l => (l.includes('"event":"split_verified"') ? l.replace(/"splitSha256":"[0-9a-f]{64}"/, `"splitSha256":"${D}"`) : l)).join('\n'));
  assert.equal(verifySplit(b.t.rootDir, { node: 'R', generation: 1, runId: ROOT_ID, runDir: b.runDir, work: b.t.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal?.check, 'split_changed');
  const tb = view(b.t);
  const held = section(tb, 'Held and refused');
  for (const l of renderSplitChanged(splitChangedOf(readTreeRecord(b.t.rootDir)), ROOT_ID)) assert.ok(held.includes(l), l);
  assert.match(held, /The first verification stands; nothing new is verified from this plan and no approval is waiting on it\./);
  assert.doesNotMatch(held, /tree approve|approve it again|decide|regenerat/, 'for (B) the held section names no command');
  // (C)
  const c = await rootOf();
  const fc = join(treeDirOf(c.t.rootDir), EVENTS_FILE);
  writeFileSync(fc, readFileSync(fc, 'utf8').split('\n').map(l => (l.includes('"event":"split_verified"') ? l.replace(/"splitSha256":"[0-9a-f]{64}"/, `"splitSha256":"${'ab'.repeat(32)}"`) : l)).join('\n'));
  const io = terminal([]);
  await approveHandler({ rootDir: c.t.rootDir, rootId: ROOT_ID, work: c.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  const itemsC = splitChangedOf(readTreeRecord(c.t.rootDir));
  assert.deepEqual(itemsC.map(i => i.kind), ['approve_refused']);
  const tc = view(c.t);
  assert.ok(section(tc, 'Held and refused').includes(renderSplitChanged(itemsC, ROOT_ID)[0]));
  assert.match(tc, /`council tree approve` refuses its frontier while they differ\./); assert.doesNotMatch(tc, /The first verification stands/, '(C) is not (B)');
  // (A)
  const a = await rootOf();
  const d = describeFrontier({ rootDir: a.t.rootDir, work: a.t.work, pending: findPendingFrontier({ rootDir: a.t.rootDir }) });
  const preview = structuredClone(d.preview); preview.splitSha256 = 'c'.repeat(64);
  appendTreeEvent(a.t.rootDir, { event: 'frontier_previewed', ...preview, boundSha256: d.boundSha256 });
  appendTreeEvent(a.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: 1, boundSha256: d.boundSha256 });
  assert.equal(registerNextChild(a.t.rootDir, { work: a.t.work }).check, 'split_changed');
  const untouchedA = snapshot(a.t.work);
  const ta = view(a.t);
  assert.deepEqual(snapshot(a.t.work), untouchedA, 'viewing a tree with a split_changed frontier wrote nothing');
  assert.ok(section(ta, 'Held and refused').includes(renderSplitChanged(splitChangedOf(readTreeRecord(a.t.rootDir)), ROOT_ID)[0]));
  assert.match(ta, new RegExp(`Frontier ${prefixOf(d.frontierKey)}: the plan changed after the approval was shown`)); assert.match(ta, new RegExp(`approve it again \\(\`council tree approve ${ROOT_ID}\`\\)`));
  assert.doesNotMatch(ta, /The first verification stands/, '(A) is not (B)');
  // bad: a tree with none of the three writes none of the three sentences
  const none = view((await rootOf()).t);
  assert.doesNotMatch(none, /plan changed after|first verification stands|refuses its frontier/);
});

test('M6 pin: open stops each come with the command that answers them (the stop text of the shared view), a stopped sitting is not "finished", and the verdict is not ready', async () => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const stop = out.stops[0];
  const untouched = snapshot(r.t.work);
  const text = view(r.t);
  assert.deepEqual(snapshot(r.t.work), untouched, 'viewing a tree with an open stop on a child wrote nothing');
  assert.match(text, new RegExp(`Stop ${stop.id} on `)); assert.ok(text.includes(stop.text.split('\n')[0]), 'the stop text is the shared one');
  assert.match(text, new RegExp(`council tree decide ${ROOT_ID}[^\\n]*--stop ${stop.id}`)); assert.doesNotMatch(text, /Verdict: ready/);
  assert.match(text, /answer the open stop with `council tree decide/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- hand-built records: pins, generations, orphans
let tick = 0;
function rawEvents(t, list) {
  let n = Number(readTreeRecord(t.rootDir).events.at(-1).id.slice(1));
  for (const ev of list) { n += 1; tick += 1; appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: 'tree-events/1', id: `e${n}`, at: `2026-10-11T10:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`, ...ev })}\n`); }
}
const runIdOf = (node, generation) => (node === 'R' ? ROOT_ID : `run-${node.replace(/\//g, '-')}-${generation}`);
const reg = (node, generation, parentNode, frontierKey, depth, over = {}) => ({ event: 'node_registered', node, generation, runId: runIdOf(node, generation), attempt: 1, depth, parentNode, frontierKey, chain: { name: 'c', sha256: HEX('a') }, grant: { amount: 1, unit: 'usd' }, ...over });
const started = (node, generation) => ({ event: 'node_started', node, generation, runId: runIdOf(node, generation), pid: 1, host: 'h' });
const closed = (node, generation) => ({ event: 'node_closed', node, generation, runId: runIdOf(node, generation), outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' });
const front = (frontierKey, parentNode, parentGeneration, children) => [{ event: 'frontier_previewed', frontierKey, parentNode, parentGeneration, parentRunId: 'x', splitSha256: 's', children }, { event: 'frontier_approved', frontierKey, revision: 1 }];
const lastId = t => readTreeRecord(t.rootDir).events.at(-1).id;
function mkRun(t, node, generation, pin) {
  const dir = syntheticRun(t, runIdOf(node, generation), { report: { passed: true, thin_contract: { sha256: pin, signed_text_sha256: HEX('9') }, signed_text: { signed_off: true }, delivered_text: { same_as_signed: true } } });
  writeFileSync(join(dir, 'deliverable.md'), 'x\n');
}
/** R with a consumer R/M2 (registered with `dependsOn` the provider R/M1 at generation 1) and R/M1; `regenerated`: R/M1 is replaced by generation 2; `pin`: the consumer was registered against another pin than the provider's report shows. */
function consumerTree({ regenerated = false, pin = false } = {}) {
  const t = newTree({ childChain: 'mock-budget' }); track(t.work);
  rawEvents(t, [reg('R', 1, null, null, 0), started('R', 1), closed('R', 1), ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }]),
    reg('R/M1', 1, 'R', 'kA', 1), started('R/M1', 1), closed('R/M1', 1),
    reg('R/M2', 1, 'R', 'kA', 1, { dependsOn: [{ node: 'R/M1', generation: 1, thinContractSha256: pin ? HEX('b') : HEX('3') }] }), started('R/M2', 1), closed('R/M2', 1)]);
  mkRun(t, 'R', 1, HEX('1')); mkRun(t, 'R/M1', 1, HEX('3')); mkRun(t, 'R/M2', 1, HEX('5'));
  if (regenerated) {
    rawEvents(t, [{ event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runIdOf('R/M1', 1), source: 'status', affected: [{ node: 'R/M1', generation: 1 }] }]);
    const stop = lastId(t);
    rawEvents(t, [{ event: 'decision_recorded', text: 'redo', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: stop, gateId: 'g', shownSha256: HEX('0') }]);
    rawEvents(t, [{ event: 'generation_opened', decisionId: lastId(t), nodes: [{ node: 'R/M1', generation: 2 }] }, ...front('kC', 'R', 1, [{ node: 'R/M1', generation: 2 }]), reg('R/M1', 2, 'R', 'kC', 1), started('R/M1', 2), closed('R/M1', 2)]);
    mkRun(t, 'R/M1', 2, HEX('7'));
  }
  return t;
}

test('M6 pin: a provider whose pin changed (blocked) and a provider with a NEWER generation (incomplete) are worded differently, each with its severity, and neither is called ready', () => {
  const pinned = view(consumerTree({ pin: true }));
  assert.match(pinned, /\[blocked\] provider_pin at R\/M2@g1: R\/M2@g1: the thin contract of its provider R\/M1@g1 is not the one it was registered against/);
  assert.doesNotMatch(pinned, /now has generation/);
  const newer = view(consumerTree({ regenerated: true }));
  assert.match(newer, /\[incomplete\] stale at R\/M2@g1: R\/M2@g1 was registered against R\/M1@g1, and R\/M1 now has generation 2/);
  assert.doesNotMatch(newer, /not the one it was registered against/); assert.doesNotMatch(newer, /Verdict: ready/);
  assert.doesNotMatch(pinned, /\[incomplete\] stale at R\/M2/, 'the pin case is not worded as a newer generation');
});

// EDITED in the M7 apply (C2a-record commit 2; old: the decision listed R/M1 only; why: a finished, passed child is now a CANDIDATE when a decision does not list it (test/tree-subplan-candidates.test.js); this record is written in the shape from before commit 2, which listed every descendant, so the child is dead with its parent: the path this pin covers)
test('M6 pin: an orphan child (dead with its replaced parent) gets the new wording - it is NOT "not registered yet" - from the eligibility check\'s own sentence', () => {
  const t = newTree({ childChain: 'mock-budget' }); track(t.work);
  rawEvents(t, [reg('R', 1, null, null, 0), started('R', 1), closed('R', 1), ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }]), reg('R/M1', 1, 'R', 'kA', 1), started('R/M1', 1), closed('R/M1', 1),
    ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }]), reg('R/M1/M1', 1, 'R/M1', 'kB', 2), started('R/M1/M1', 1), closed('R/M1/M1', 1),
    { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runIdOf('R/M1', 1), source: 'status', affected: [{ node: 'R/M1', generation: 1 }] }]);
  const stop = lastId(t);
  rawEvents(t, [{ event: 'decision_recorded', text: 'redo', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/M1', generation: 1 }], form: 'regenerate', stopId: stop, gateId: 'g', shownSha256: HEX('0') }]);
  rawEvents(t, [{ event: 'generation_opened', decisionId: lastId(t), nodes: [{ node: 'R/M1', generation: 2 }] }, ...front('kC', 'R', 1, [{ node: 'R/M1', generation: 2 }]), reg('R/M1', 2, 'R', 'kC', 1), started('R/M1', 2), closed('R/M1', 2)]);
  for (const [n, g, p] of [['R', 1, '1'], ['R/M1', 1, '3'], ['R/M1/M1', 1, '4'], ['R/M1', 2, '7']]) mkRun(t, n, g, HEX(p));
  const text = view(t);
  const dead = section(text, 'Dead with a replaced parent');
  assert.match(dead, /R\/M1\/M1 is not registered: every registration of it \(generation 1\) belonged to a plan that R\/M1@g2 replaced and is dead with it/);
  assert.doesNotMatch(dead, /not registered yet/, 'the old promise is gone');
  // bad: a tree with no orphan has no such section content
  assert.doesNotMatch(view(consumerTree()), /Dead with a replaced parent/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- money, guards
function kidTree({ run = {}, lines = [] } = {}) {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 50);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], run);
  for (const [l, opts] of lines) writeLines(t, IDS[0], 'R/M1', l, opts);
  return t;
}
test('M6 pin: the two money figures are shown apart and never added: a settlement the gate rejects (+0.30 on a run that counts 0.70) and a charge the run counts twice (-0.30 on a run that reads 1.30)', () => {
  const row5 = kidTree({ run: { usage: [{ file: 'build', usd: 0.7, reservationId: 'r1' }] }, lines: [[[reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.6)]]] });
  const t5 = view(row5);
  assert.match(t5, /Spent by the member runs: \$0\.70 \(2 runs started\)/); assert.match(t5, /adjustments: \$0\.30 \(1 reservation\)/); assert.match(t5, /accounting gate does not trust the record \(1 problem: settlement_without_evidence\)/);
  assert.doesNotMatch(t5, /\$1\.00/, 'the 1.00 that the two add up to is not printed');
  const row3 = kidTree({ run: { superseded: [{ file: 'x.charge-1', usd: 0.3, reservationId: 'r1', kind: 'billed' }] }, lines: [[[reservedLine('r1', 1.0, 'x')]]] });
  const t3 = view(row3);
  assert.match(t3, /Spent by the member runs: \$1\.30/); assert.match(t3, /adjustments: -\$0\.30 \(1 reservation\)/); assert.doesNotMatch(t3, /accounting gate does not trust/);
  assert.match(t3, /Root cap \$100\.00\./);
});

test('guards: `work` is required; a corrupt record is still shown and the handler exits 1 (a readable one exits 0, asserted in the ready/stop test); the module writes nothing and imports no writer, lock or clock', async () => {
  const t = await leafTree();
  assert.throws(() => gatherStatusFacts(t.rootDir), /`work`/);
  appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), 'this is not json\n');
  const out = { text: '', write(s) { this.text += s; } };
  assert.equal(await statusHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: out }), 1, 'README exit row 1: a record that cannot be read is exit 1, and the text is still printed');
  assert.match(out.text, /The record could not be read:/); assert.match(out.text, /Verdict: blocked/); assert.match(out.text, /Money\n {2}\(not readable\)/);
  const src = readFileSync(new URL('../src/tree-status.js', import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /appendTreeEvent|withTreeLock|writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync|mkdirSync|requestStop|registerNextChild|Date\.now|new Date|Math\.random|process\.env|process\.argv|toLocale/);
  assert.equal(sha256Of('x').length, 64);
});

test('The Money line reads the spend of a member that has not started instead of assuming 0: a start refused before its claim can leave spend behind, and the line then says so', () => {
  const m = facts().money;
  const text = renderTreeStatus(facts({ money: { ...m, memberSpend: { ...m.memberSpend, sumUsd: 0.95, members: [...m.memberSpend.members, { node: 'R/M1', generation: 1, runId: 'kid1', started: false, runSpentUsd: 0.25 }, { node: 'R/M2', generation: 1, runId: 'kid2', started: false, runSpentUsd: 0 }] } } }));
  assert.match(text, /\(1 run started; 2 more members the record shows as not started: \$0\.25 spent by them\)\./);
  assert.doesNotMatch(text, /nothing spent/);
});
