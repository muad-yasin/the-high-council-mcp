// Stop detection (0.8.3 M5e slice 2; PLAN 8.4; M5 exit check L3): a REAL child whose handoff ends `needs_decision` opens its stop in the next step of the sitting. All-mock, $0. The child chain `nd-debate` has the NAMED mock handoff seat
// `mock-handoff-needs-decision` (src/providers.js; a fixture price row beside mock-priced), so EVERY child of that chain ends needs_decision; the root test uses a root chain with the same seat. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { budgetOf } from '../src/tree-budget.js';
import { runSpentUsd } from '../src/spend.js';
import { detectStops } from '../src/tree-detect.js';
import { chooseNextChild } from '../src/tree-loop.js';
import { decideHandler } from '../src/tree-decide.js';
import { terminal } from './helpers/terminal.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { runTree } from '../src/tree-run.js';
import { sittingLines } from '../src/tree-resume.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren, needsDecisionRoot, pricedChildren } from './helpers/child-chains.js';
import { LEAF_PLAN, approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { IDS, ROOT_ID, claim, closedRootTree, hostnameOf, registerKid, approveFrontier, syntheticRun } from './helpers/tree-fixture.js';

const stopsOf = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened');

async function stoppedTree({ maxStarts } = {}) {
  const r = await trackedRealRoot(needsDecisionChildren());
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, ...(maxStarts ? { maxStarts } : {}), startRun: draftStarter(r) });
  return { r, out };
}

test('L3 (real): R/M1 ends needs_decision => the sitting opens ITS stop with the affected closure {R/M1, R/M2 (it expects from R/M1)}; R/M3 (D) still runs (and, on this chain, ends needs_decision too: its own stop, itself only); share revoked (the money is its own test below)', { timeout: 400_000 }, async () => {
  const { r, out } = await stoppedTree();
  assert.deepEqual(out.started.map(s => s.node), ['R/M1', 'R/M3'], 'D keeps running; the consumer R/M2 is not registered'); assert.equal(phases(r)['R/M2'], undefined);
  assert.equal(out.status, 'held_by_stop', 'R/M2 is held back by the open stops: the sitting does not claim to be finished'); assert.deepEqual(out.held.map(h => h.node), ['R/M2']);
  const closed = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M1');
  assert.deepEqual([closed.status, closed.share], ['needs_decision', 'revoked']);
  const stops = stopsOf(r); assert.equal(stops.length, 2);
  assert.deepEqual([stops[0].node, stops[0].generation, stops[0].runId, stops[0].source], ['R/M1', 1, closed.runId, 'node_closed']);
  assert.deepEqual(stops[0].affected, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }]);
  assert.deepEqual([stops[1].node, stops[1].affected], ['R/M3', [{ node: 'R/M3', generation: 1 }]], 'D has its own stop and puts nothing else in question');
  assert.deepEqual(out.stops.map(s => s.node), ['R/M1', 'R/M3'], 'the sitting reports them');
  const st = stateOf(readTreeRecord(r.t.rootDir)); assert.deepEqual([...st.stale].sort(), ['R/M1@g1', 'R/M2@g1', 'R/M3@g1']); assert.deepEqual(st.openStops, [stops[0].id, stops[1].id]);
  assert.equal(st.nodes.get('R/M3@g1').phase, 'closed');
});

test('idempotent per (node, generation, runId): a second sitting appends nothing; detectStops called again appends nothing', { timeout: 400_000 }, async () => {
  const { r } = await stoppedTree();
  const n = eventsOf(r).length;
  assert.deepEqual(detectStops(r.t.rootDir), []); const again = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(again.stops, []); assert.equal(stopsOf(r).length, 2);
  assert.equal(eventsOf(r).length, n, 'nothing at all was appended'); 
});

test('providerEligibility already refuses a needs_decision provider (M5c1), so detection is not the only guard: with the stop line removed from the record, R/M2 still waits ("ended with needs_decision") and the independent R/M3 is chosen', { timeout: 400_000 }, async () => {
  const { r } = await stoppedTree({ maxStarts: 1 });                                                 // only R/M1 ran
  const f = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('"needs_decision_opened"')).join('\n'));
  assert.equal(stopsOf(r).length, 0);
  const pick = chooseNextChild(r.t.rootDir, { work: r.t.work });
  assert.match(pick.waiting.flatMap(w => w.why).join(' | '), /R\/M1 ended with needs_decision/);
  assert.ok(pick.waiting.some(w => w.node === 'R/M2')); assert.equal(pick.node, 'R/M3', 'the independent sibling is chosen');
});

test('a REPLACEMENT generation that ends needs_decision opens its OWN stop (new run id), not a duplicate of the old one; a second call appends nothing (synthetic nodes, hand-closed)', () => {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const keys = { 1: approveFrontier(t.rootDir, ['R/M1']), 2: approveFrontier(t.rootDir, ['R/M1'], { generation: 2, openedBy: 'e99' }) };
  const finish = (generation, runId) => {
    registerKid(t, keys[generation], 'R/M1', runId, 10, generation); syntheticRun(t, runId, {});
    appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', runId, process.pid, generation, hostnameOf()) });
    appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation, runId, outcome: 'not_passed', passed: false, status: 'needs_decision', share: 'revoked' });
  };
  finish(1, IDS[0]);
  const a = detectStops(t.rootDir); assert.equal(a.length, 1); assert.deepEqual([a[0].node, a[0].generation, a[0].runId], ['R/M1', 1, IDS[0]]);
  finish(2, IDS[1]);
  const b = detectStops(t.rootDir); assert.equal(b.length, 1); assert.deepEqual([b[0].generation, b[0].runId], [2, IDS[1]]);
  assert.deepEqual(detectStops(t.rootDir), []); assert.equal(readTreeRecord(t.rootDir).events.filter(e => e.event === 'needs_decision_opened').length, 2);
});

test('the end text gives ONE remedy per source of the hold: an open stop is answered with decide; a replacement is waited for (no command); a changed parent is approved again', () => {
  const res = (stopIds, sources, extra = {}) => ({ status: 'held_by_stop', started: [], stopIds, held: [{ node: 'R/M2', why: ['x'], sources }], waiting: [], ...extra });
  const text = (stopIds, sources, extra) => sittingLines(res(stopIds, sources, extra), 'rid').join('\n');
  const a = text(['e5'], [{ kind: 'stop', id: 'e5' }]); assert.match(a, /Open stop: e5\. Answer it with `council tree decide rid`/); assert.equal(/Being replaced|approve the frontier/.test(a), false);
  const b = text([], [{ kind: 'decision', id: 'e9' }]); assert.match(b, /Being replaced by decision e9: nothing to answer/); assert.equal(/council tree decide/.test(b), false);
  const unrelated = text([], [{ kind: 'decision', id: 'e9' }], { approvalWaits: true, replacementWaits: false }); assert.match(unrelated, /nothing to answer/); assert.equal(/the replacement waits for your approval/.test(unrelated), false, 'an unrelated first-split approval is not "the replacement"');
  const repl = text([], [{ kind: 'decision', id: 'e9' }], { approvalWaits: true, replacementWaits: true }); assert.match(repl, /Being replaced by decision e9: the replacement waits for your approval: run `council tree approve rid`/);
  const c = text([], [{ kind: 'parent', id: 'k1' }]); assert.match(c, /approve the frontier again with `council tree approve rid`/); assert.equal(/council tree decide|Being replaced/.test(c), false);
});

test('R12 (C&C: "verify detection needs no change, do not assume"): a REAL root that ends needs_decision with two needs-decision milestones: after the first --milestone answer the stop is still open, detection opens nothing new (now or in a later sitting), and after the last answer the stop is answered and detection still opens nothing', { timeout: 400_000 }, async () => {
  const b = block3(); b.milestones.push({ id: 'M6', status: 'needs-decision', basis: 'nobody has said whether exports stay', open_question: 'Do exports stay?' });
  const r = await trackedRealRoot({ ...needsDecisionRoot(), plan: planWith(b, { extraMilestones: ['M6'], preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(stopsOf(r).length, 1, 'the root\'s own stop was opened by detection');
  const answer = async (id, text) => { const io = terminal([`${text}\n.`, `R@g1:${id}`, 'y']); return { code: await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { milestone: id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), io }; };
  const first = await answer('M5', 'The old API stays.'); assert.equal(first.code, 0, first.io.shown() + first.io.errors());
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.length, 1, 'still open after the first answer');
  assert.deepEqual(detectStops(r.t.rootDir), [], 'detection opens nothing new while the stop stands');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(stopsOf(r).length, 1, 'and a further sitting writes no second stop for the same node');
  const last = await answer('M6', 'Exports stay.'); assert.equal(last.code, 0, last.io.shown() + last.io.errors());
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.length, 0, 'the last answer answers the stop');
  assert.deepEqual(detectStops(r.t.rootDir), [], 'detection is idempotent per (node, generation, run): the answered stop is not opened again');
  assert.equal(stopsOf(r).length, 1);
});

test('Q1: the ROOT ending needs_decision (a root chain with the named seat, a real plan) opens a stop pinned to {R}, writes NO root_affected, and the children still start while that stop is open (the plan stands unchanged)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionRoot());
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const rootClosed = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R'); assert.equal(rootClosed.status, 'needs_decision');
  const stops = stopsOf(r); assert.equal(stops.length, 1); assert.deepEqual([stops[0].node, stops[0].affected], ['R', [{ node: 'R', generation: 1 }]]);
  assert.equal(eventsOf(r).some(e => e.event === 'blocked' && e.reason === 'root_affected'), false);
  assert.deepEqual(out.started.map(s => s.node), ['R/M1', 'R/M2', 'R/M3'], 'the children went on while the root\'s own stop was open');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.length, 1);
  // row 8, end to end: the root's own stop is answered IN PLACE (the root's split marks M5 needs-decision): the stop is answered and its mark released, recorded as a milestone_resolved
  const io = terminal(['The old API stays.\n.', 'R@g1:M5', 'y']);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { milestone: 'M5' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 0, io.shown() + io.errors());
  const st = stateOf(readTreeRecord(r.t.rootDir)); assert.deepEqual([st.openStops.length, st.stale.size], [0, 0]);
  assert.equal(eventsOf(r).filter(e => e.event === 'milestone_resolved').length, 1);
});

test('money (L3 "share revoked, spend counted"): at registration R/M1 HOLDS its grant; after it ends needs_decision it holds 0, available rose by exactly returnedUsd (= grant - spent), treeSpent rose by the run\'s own spend (above 0: the chain is priced); and DETECTION itself moves no money (budgetOf is identical before and after detectStops)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionChildren());
  approvePending(r);
  let atRegistration = null;
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r), hooks: { afterRegister: async next => { if (next.kind === 'registered' && next.node === 'R/M1') atRegistration = budgetOf(r.t.rootDir); } } });
  const closed = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M1');
  const spent = runSpentUsd(join(r.t.runsDir, closed.runId)); assert.ok(spent > 0, 'the priced chain spent something');
  const before = atRegistration.nodes.find(n => n.node === 'R/M1'); const after = budgetOf(r.t.rootDir); const n = after.nodes.find(x => x.node === 'R/M1');
  assert.ok(before.heldUsd > 0); assert.equal(before.heldUsd, before.grantUsd, 'holds its whole grant at registration');
  assert.equal(n.heldUsd, 0); assert.ok(Math.abs(n.spentUsd - spent) < 1e-9);
  assert.ok(Math.abs(closed.returnedUsd - (before.grantUsd - spent)) < 1e-9, 'returnedUsd = grant - spent');
  assert.ok(Math.abs((after.availableUsd - atRegistration.availableUsd) - closed.returnedUsd) < 1e-9, 'available rose by exactly returnedUsd');
  assert.ok(Math.abs((after.treeSpentUsd - atRegistration.treeSpentUsd) - spent) < 1e-9, 'treeSpent rose by the run\'s own spend');
  assert.equal(stopsOf(r).length, 1);
  // detection moves no money
  const f = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('"needs_decision_opened"')).join('\n'));
  const b1 = budgetOf(r.t.rootDir); assert.equal(detectStops(r.t.rootDir).length, 1); assert.deepEqual(budgetOf(r.t.rootDir), b1);
});

test('a CHILD that a stop put in question is never registered (PLAN 8.4: an unstarted affected node is simply not started): with a stop whose set holds R/M3, the sitting registers R/M1 and R/M2, ends held_by_stop (NOT tree_refused, NOT nothing_to_do), names the stop and the held child, and R/M3 is not registered', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'obligation', affected: [{ node: 'R/M3', generation: 1 }] });
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const stopId = stopsOf(r)[0].id;
  assert.equal(out.status, 'held_by_stop', JSON.stringify(out)); assert.deepEqual(out.started.map(x => x.node), ['R/M1', 'R/M2']);
  assert.deepEqual(out.stopIds, [stopId]); assert.deepEqual(out.held.map(h => h.node), ['R/M3']);
  assert.equal(phases(r)['R/M3'], undefined, 'never registered'); assert.match(out.held[0].why.join(' '), new RegExp(`R/M3 is stale: stop ${stopId} put it in question`));
  const lines = sittingLines(out, 'rid').join('\n');
  assert.match(lines, /NOT finished/); assert.ok(lines.includes(stopId)); assert.match(lines, /R\/M3 is held: /); assert.match(lines, /council tree decide rid/); assert.equal(/Done for now|Nothing could start\./.test(lines), false);
  assert.equal(eventsOf(r).some(e => e.event === 'blocked'), false, 'no start was refused: nothing was registered to be refused');
});
