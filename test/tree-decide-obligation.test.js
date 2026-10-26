// `council tree decide --obligation` (0.8.3 M5e slice 4; PLAN 4.4, 8.4; M5 exit check L5): obligations are found by IDENTITY (origin), the decision widens the affected set with the carriers and their closure, an obligation the ROOT
// carries blocks the tree (root_affected) through a ROOT stop that only a root milestone resolution clears. Real trees, all-mock, $0; stops are real where a child ends needs_decision, hand-appended where noted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { carriersOf, resolveObligation } from '../src/tree-obligation.js';
import { decideHandler } from '../src/tree-decide.js';
import { foldRecord } from '../src/tree-transitions.js';
import { runTree } from '../src/tree-run.js';
import { resumeHandler, sittingLines } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren, needsDecisionRoot, pricedChildren, splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const view = r => { const record = readTreeRecord(r.t.rootDir); return { record, state: stateOf(record), runsDir: r.t.runsDir }; };
const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 6000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};

async function depth2() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return r;
}

test('IDENTITY, not position: R/M2\'s positional C2 is the ROOT\'s C3 (its origin), R/M1/M2\'s C2 is R/M1\'s C3; the carriers are found by origin in the registered maps; an id the node does not hold, a node not in the tree, and a root id the root\'s list does not hold are refused', { timeout: 400_000 }, async () => {
  const r = await depth2();
  const { record, state, runsDir } = view(r);
  const res = arg => resolveObligation({ record, state, runsDir, arg });
  const a = res('R/M2@g1:C2'); assert.deepEqual([a.origin, a.label, a.cls], [{ node: 'R', generation: 1, id: 'C3' }, 'R@g1:C3', 'delegated'], 'position C2 at R/M2 is origin R:C3');
  assert.deepEqual(carriersOf({ record, state, origin: a.origin }), ['R', 'R/M2'], 'only the nodes whose map carries R:C3 (R/M2) and the origin node');
  const b = res('R/M1/M2@g1:C2'); assert.equal(b.label, 'R/M1@g1:C3', 'position C2 at R/M1/M2 is origin R/M1:C3 (a refinement R/M1 made)');
  assert.deepEqual(carriersOf({ record, state, origin: b.origin }), ['R/M1', 'R/M1/M2']);
  assert.equal(res('R/M1@g1:C3').label, 'R/M1@g1:C3', 'an item with no identity is the node\'s own refinement: its origin is that node');
  assert.deepEqual(carriersOf({ record, state, origin: { node: 'R', generation: 1, id: 'C1' } }), ['R', 'R/M1', 'R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2', 'R/M3'], 'a root-origin global item is carried by every node');
  assert.equal(res('R@g1:C2').label, 'R@g1:C2'); assert.match(res('R@g1:C9').refusal, /the root's acceptance list holds C1, C2, C3, not C9/);
  assert.match(res('R/M2@g1:C9').refusal, /R\/M2@g1 carries no obligation C9/); assert.match(res('R/M9@g1:C1').refusal, /not in this tree/); assert.match(res('C1').refusal, /write it as/);
});

test('SUBTREE origin (L5): `--obligation R/M1@g1:C3` on a stop of R/M1 widens the decision\'s set to R/M1\'s subtree and its consumer R/M2, NOT to R, R/M3 (the third branch keeps running) and writes NO root stop and NO block; R/M1 and below stay held, R is untouched', { timeout: 400_000 }, async () => {
  const r = await depth2();
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: view(r).state.nodes.get('R/M1@g1').runId, source: 'status', affected: [{ node: 'R/M1', generation: 1 }] });
  const d = decide(r, { obligation: 'R/M1@g1:C3' }, ['The retention rule changes.\n.', stop.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /The stop is about the obligation R\/M1@g1:C3 \(found by its origin/); assert.match(d.io.shown(), /The root does not carry it, so no block is written/);
  const dec = eventsOf(r).find(e => e.event === 'decision_recorded');
  assert.deepEqual(dec.affected.map(a => a.node), ['R/M1', 'R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2'], 'the carriers with their closure; not R, not R/M3');
  assert.equal(dec.obligation, 'R/M1@g1:C3');
  assert.equal(eventsOf(r).some(e => e.event === 'blocked' && e.reason === 'root_affected'), false); assert.equal(eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'obligation').length, 0);
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual([...st.stale].sort(), ['R/M1/M1@g1', 'R/M1/M2@g1', 'R/M1/M3@g1', 'R/M1@g1', 'R/M2@g1'], 'the decision\'s OWN set is held (the carriers were never in the stop\'s set); R and R/M3 are not stale');
  assert.equal(st.sticky.size, 0);
  // the closure starts from the CARRIERS, not from the stopped node: a stop of the independent R/M3 (its own recorded set empty) answered with R/M1's obligation does not drag R/M3 in
  const s3 = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M3', generation: 1, runId: view(r).state.nodes.get('R/M3@g1').runId, source: 'status', affected: [] });
  const d2 = decide(r, { stop: s3.id, obligation: 'R/M1@g1:C3' }, ['Same rule.\n.', s3.id, 'y']);
  assert.equal(await d2.run(), 0, d2.io.shown() + d2.io.errors());
  const dec2 = eventsOf(r).filter(e => e.event === 'decision_recorded').at(-1);
  assert.equal(dec2.affected.some(a => a.node === 'R/M3'), false, 'R/M3 is not an obligation carrier and not in the stop\'s own set'); assert.equal(dec2.affected.some(a => a.node === 'R'), false);
});

test('a milestone resolved in place with --obligation RECORDS the obligation only (nothing regenerates): no widening, no root stop, no block, and the text says so', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({});
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R', generation: 1 }] });
  const d = decide(r, { milestone: 'M5', obligation: 'R@g1:C1' }, ['Settled.\n.', 'R@g1:M5', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /recorded with the decision only: nothing regenerates when a milestone is resolved in place/);
  const dec = eventsOf(r).find(e => e.event === 'decision_recorded'); assert.deepEqual([dec.obligation, dec.affected, dec.stopId], ['R@g1:C1', [], stop.id]);
  assert.equal(eventsOf(r).some(e => e.event === 'blocked'), false); assert.equal(eventsOf(r).filter(e => e.event === 'needs_decision_opened').length, 1);
});

test('carriersOf reads the CONTEXT entries too (a guard-refused or check_not_enforced obligation is carried in context only) and matches a null-identity item as the node\'s own refinement (in-memory record)', () => {
  const reg = (node, obligations) => ({ id: `e-${node}`, event: 'node_registered', node, generation: 1, runId: `run-${node}`, attempt: 1, depth: 1, parentNode: 'R', frontierKey: 'k', chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' }, obligations });
  const idn = { originNode: 'R', originGeneration: 1, originId: 'C2', originClass: 'delegated' };
  const events = [{ id: 'e1', event: 'tree_started', treeId: 't' }, reg('R/A', { items: [{ id: 'C1', identity: idn }], context: [] }), reg('R/B', { items: [], context: [{ identity: idn, form: 'x', reason: 'guard_refused' }] }), reg('R/C', { items: [{ id: 'C1', identity: { ...idn, originId: 'C9' } }], context: [] })];
  const state = foldRecord(events);
  assert.deepEqual(carriersOf({ record: { events }, state, origin: { node: 'R', generation: 1, id: 'C2' } }), ['R/A', 'R/B'], 'R/B carries it in context only; R/C carries another obligation; the root is not registered here');
});

test('ROOT origin, end to end through the REAL verbs (L5): `decide --stop <child stop> --obligation R@g1:C1` -> the sitting is BLOCKED (root_affected) and its text names the ROOT stop and the root milestone; `decide --milestone M5` answers the root stop -> the block clears, R is not stale, the carriers stay held, another child\'s own stop stays open; the generation opened for the decision leaves R out', { timeout: 500_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionChildren());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const stops = eventsOf(r).filter(e => e.event === 'needs_decision_opened'); assert.deepEqual(stops.map(s => s.node), ['R/M1', 'R/M3']);
  const [s1, s3] = stops;
  // a regenerate of the ROOT carries no meaning: nothing to try here yet; first the obligation decision on R/M1's stop
  const d = decide(r, { stop: s1.id, obligation: 'R@g1:C1' }, ['The retention rule is wrong.\n.', s1.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /The ROOT carries this obligation\. Recording this blocks the whole tree \(root_affected\)[^]*council tree decide .* --milestone R@g1:M5/);
  const ev = eventsOf(r); const at = ev.findIndex(e => e.event === 'needs_decision_opened' && e.source === 'obligation');
  const rootStop = ev[at]; const block = ev.find(e => e.event === 'blocked' && e.reason === 'root_affected'); const dec = ev.find(e => e.event === 'decision_recorded');
  assert.deepEqual([rootStop.node, rootStop.originStopId, rootStop.obligation], ['R', s1.id, 'R@g1:C1']); assert.equal(block.stopId, rootStop.id);
  assert.ok(ev.indexOf(block) > at && ev.indexOf(dec) > ev.indexOf(block), 'the ROOT stop, then the block, then the decision LAST (one lock hold)');
  assert.ok(dec.affected.some(a => a.node === 'R') && dec.affected.some(a => a.node === 'R/M2'), 'everything the obligation touches, the root included');
  // the sitting is blocked and says what answers it
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'blocked'); assert.deepEqual(out.reasons, ['root_affected']); assert.deepEqual(out.rootAffected, { stopIds: [rootStop.id], milestones: ['R@g1:M5'] });
  const text = sittingLines(out, 'rid').join('\n'); assert.match(text, /root_affected/); assert.ok(text.includes(`--milestone R@g1:M5 --stop ${rootStop.id}`)); assert.ok(text.includes(`or with a new root plan: \`council tree decide rid --stop ${rootStop.id}\``), text);
  // R6 (Opus 4-1, Fable Q4-3): the verb a person types says the same and exits 20 ('stopped for a person'), not 1 with no remedy, and starts nothing
  { const calls = []; const eventsBefore = eventsOf(r).length; const io = terminal([]);
    const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { startRun: async () => { calls.push('start'); return { exitCode: 0 }; }, resumeRun: async () => { calls.push('resume'); return { exitCode: 0 }; } } });
    assert.equal(calls.length, 0); assert.equal(code, 20, `${io.shown()}${io.errors()}`);
    assert.equal(eventsOf(r).length, eventsBefore, 'the resume under a block wrote nothing (no verification, no stop detection)');
    assert.ok(io.shown().includes(`--milestone R@g1:M5 --stop ${rootStop.id}`), io.shown()); assert.match(io.shown(), /or with a new root plan: `council tree decide /); }
  // S8-4 (old: the root stop could not be regenerated, refused with "belongs to the root, and the root is never regenerated"): a regenerate answer to the root stop is a root re-plan and gets as far as asking for the text
  const bad = decide(r, { stop: rootStop.id }, []); assert.equal(await bad.run(), 1); assert.doesNotMatch(bad.io.errors(), /never regenerated/); assert.match(bad.io.errors(), /the input ended before the closing line/); assert.equal(bad.io.shown().includes('re-plan the root'), false, 'no gate text before the text is typed');
  // answering the root stop in place clears the block
  let st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.stale.has('R@g1'), true); assert.equal(st.sticky.has('root_affected'), true);
  const m = decide(r, { milestone: 'M5' }, ['The old API stays.\n.', 'R@g1:M5', 'y']);
  assert.equal(await m.run(), 0, m.io.shown() + m.io.errors());
  st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.sticky.has('root_affected'), false, 'the block clears');
  assert.equal(st.stale.has('R@g1'), false, 'the root is not held by the decision: its mark lived on the root stop');
  for (const k of ['R/M1@g1', 'R/M2@g1', 'R/M3@g1']) assert.equal(st.stale.has(k), true, `${k} stays held (it is being replaced)`);
  assert.deepEqual(st.openStops, [s3.id], 'R/M3\'s own stop is still open');
  // recovery opens the generation WITHOUT the root
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const gen = eventsOf(r).find(e => e.event === 'generation_opened'); assert.ok(gen);
  assert.deepEqual(gen.nodes.map(n => n.node), ['R/M1', 'R/M2', 'R/M3'], 'a root MILESTONE resolution does not replace R: it is not in generation_opened (only a replansRoot decision opens R@g+1)');
  assert.ok(gen.nodes.every(n => n.generation === 2));
});

test('a root-origin obligation decision with no needs-decision milestone at the root names a new root plan as the route (text and blocked end text; old wording "the only route is a new root run"); it is idempotent per originating stop (after a crash that left the root stop and the block but no decision, the form reuses them: one root stop, one block)', { timeout: 400_000 }, async () => {
  const noMilestone = block3(); noMilestone.milestones = noMilestone.milestones.map(x => (x.status === 'needs-decision' ? { id: x.id, status: 'ready', basis: 'Release and rollback plan', open_question: null } : x));
  const r = await trackedRealRoot({ ...needsDecisionChildren(), plan: planWith(noMilestone, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const s1 = eventsOf(r).find(e => e.event === 'needs_decision_opened');
  // the residue of a crash AFTER the root stop and the block and BEFORE the decision
  const rootStop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'obligation', originStopId: s1.id, obligation: 'R@g1:C1', affected: [{ node: 'R', generation: 1 }] });
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', stopId: rootStop.id, detail: 'residue' });
  const d = decide(r, { stop: s1.id, obligation: 'R@g1:C1' }, ['Wrong.\n.', s1.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /a NEW ROOT RUN: the root's split has no needs-decision milestone, so that is the only route/);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(out.rootAffected.milestones, []); assert.match(sittingLines(out, 'rid').join('\n'), /The root's split has no needs-decision milestone, so the route is a new root plan: `council tree decide rid --stop e\d+`/);       // S8-4 (old: "the only route is a new root run")
  assert.equal(eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'obligation').length, 1);
  assert.equal(eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'root_affected').length, 1);
  void existsSync;
});

test('two kinds of ROOT stop (M5e S4, advisor): an obligation root stop already in the record does not hide the root\'s OWN needs_decision stop from detection, and the blocked remedy names only the stop the block names (with --stop), never the root\'s own', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionRoot());
  approvePending(r);
  const obl = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'obligation', originStopId: 'e0', obligation: 'R@g1:C1', affected: [{ node: 'R', generation: 1 }] });
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const roots = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.node === 'R');
  assert.deepEqual(roots.map(e => e.source), ['obligation', 'node_closed'], 'the root\'s own stop is opened although an obligation stop has the same node, generation and run');
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', stopId: obl.id, detail: 'x' });
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'blocked'); assert.deepEqual(out.rootAffected.stopIds, [obl.id], 'not the root\'s own stop');
  assert.ok(sittingLines(out, 'rid').join('\n').includes(`--milestone R@g1:M5 --stop ${obl.id}`));
  // C&C Q2: ONE root milestone resolution answers EVERY open root stop, bound in one decision (else the milestone is used up by the first and the block is left only a paid root re-plan)
  const ownStop = roots.find(e => e.source === 'node_closed');
  const m = decide(r, { milestone: 'M5' }, ['The old API stays.\n.', 'R@g1:M5', 'y']);
  assert.equal(await m.run(), 0, m.io.shown() + m.io.errors());
  assert.ok(m.io.shown().includes(`EVERY open stop of the root (`) && m.io.shown().includes(ownStop.id) && m.io.shown().includes(obl.id), 'the shown (hashed) text names every stop it answers');
  // R10 (Opus 3-5): the effect sentence says what the head says - every listed stop is answered - and no longer claims 'other stops are untouched' without saying whose
  assert.match(m.io.shown(), /and the stops listed above are answered: their stale marks are cleared/); assert.match(m.io.shown(), /Stops of other nodes and other marks are untouched\./);
  assert.equal(/ Other stops and other marks are untouched\./.test(m.io.shown()), false, 'the old sentence is gone');
  const ev = eventsOf(r); const dec = ev.find(e => e.event === 'decision_recorded');
  assert.deepEqual([dec.stopId, dec.covers].flat().sort(), [obl.id, ownStop.id].sort(), 'one decision: the primary stop and the covered one');
  assert.equal(ev.filter(e => e.event === 'milestone_resolved').length, 1, 'the milestone is resolved ONCE');
  assert.ok(m.io.shown().includes(`the stops ${dec.stopId}, ${dec.covers[0]} are answered`), 'the closing line names every stop answered');
  const st = stateOf(readTreeRecord(r.t.rootDir)); assert.deepEqual(st.openStops, []); assert.equal(st.sticky.has('root_affected'), false, 'the block clears although the root also had its own stop');
});

test('the TABLE: a decision covers only open stops of its own node (a child\'s stop, an answered stop and an unknown id are refused)', async () => {
  const r = await trackedRealRoot(needsDecisionRoot());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const own = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.node === 'R');
  const child = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'obligation', affected: [] });
  const rec = covers => appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'milestone', stopId: own.id, covers, node: 'R', generation: 1, milestone: 'M5', gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' });
  assert.throws(() => rec(['e999']), e => /is not an open stop of R@g1/.test(e.reason));
  assert.throws(() => rec([own.id, 'e999']), e => /not an open stop/.test(e.reason));
  assert.ok(rec([child.id]).id, 'an open stop of the same node is accepted');
});
