// The tree loop, part 2: a sitting (0.8.3 M5c2; PLAN 8.1, 8.3 steps 2-5, 10.1 `tree stop`, M5 exit checks L1, L8 (depth 2), L19, and the held items of the frontier stop). All-mock, $0; the children RUN through api.run, exactly as
// the default starter does them, except where a test names an injected starter (exit codes, the lock). A frontier is approved by direct appends of the previewed/approved pair (the approve verb has its own tests).
// Every working folder is removed at the end of the file (test/helpers/temp-trees.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf, withTreeLock } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { sittingLines } from '../src/tree-resume.js';
import { STOP_MARKER, apiStarter, clearStop, requestStop, runTree, stopMarkerPath, stopRequested } from '../src/tree-run.js';
import { registerNextChild } from '../src/tree-loop.js';
import { treeCommand } from '../src/tree-cli.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { externalChildren, heldGuardChildren, heldKindsChildren, pricedChildren, splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { GATE_FIELDS, ROOT_ID, claim, hostnameOf, syntheticRun } from './helpers/tree-fixture.js';

import { approvePending, draftStarter, eventsOf, indexOf, phases } from './helpers/sitting.js';

test('L1: nothing is registered or started before approve (a sitting says what waits); after approve the children run ONE AT A TIME in dependency order, each registered only after the one before closed, and the sitting ends nothing_to_do with all three closed', { timeout: 180_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d.preview, boundSha256: d.boundSha256 });
  const calls = [];
  const idle = await runTree(r.t.rootDir, { work: r.t.work, startRun: args => { calls.push(args); throw new Error('must not start'); } });
  assert.equal(idle.status, 'nothing_to_do'); assert.deepEqual(idle.awaitingApproval, [d.frontierKey]); assert.deepEqual(calls, []);
  assert.equal(readdirSync(r.t.runsDir).length, 1, 'no run folder besides the root\'s'); assert.equal(existsSync(join(r.t.rootDir, 'tree', 'inputs')), false);
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: 1, boundSha256: d.boundSha256 });
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out)); assert.deepEqual(out.started.map(s => [s.node, s.exitCode]), [['R/M1', 0], ['R/M2', 0], ['R/M3', 0]]);
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'closed', 'R/M2': 'closed', 'R/M3': 'closed' });
  // never two nodes at once: between a node's registration and its close no other registration is written; the consumer was registered after its provider closed
  const ev = eventsOf(r);
  for (const n of ['R/M1', 'R/M2', 'R/M3']) {
    const reg = ev.findIndex(e => e.event === 'node_registered' && e.node === n); const closed = ev.findIndex(e => e.event === 'node_closed' && e.node === n);
    assert.ok(reg >= 0 && closed > reg, `${n} registered, then closed`);
    assert.equal(ev.slice(reg + 1, closed).some(e => e.event === 'node_registered'), false, `no other registration while ${n} is active`);
  }
  assert.ok(ev.findIndex(e => e.event === 'node_registered' && e.node === 'R/M2') > ev.findIndex(e => e.event === 'node_closed' && e.node === 'R/M1'), 'the consumer after its provider');
  for (const s of out.started) assert.equal(ev.find(e => e.event === 'node_registered' && e.node === s.node).runId, s.runId, 'the run id registered is the run id started');
});

test('the exit code of a run is read and never retried: 3 ends the sitting as waiting, 4 as budget_stop, 19 as tree_refused, anything else as crashed (the STOPPED-* files named), a thrown start as start_failed; the starter is called once and no sibling is registered', async () => {
  for (const [code, status] of [[3, 'waiting'], [4, 'budget_stop'], [19, 'tree_refused'], [23, 'awaiting_choice'], [1, 'crashed'], [16, 'crashed']]) {
    const r = await trackedRealRoot(pricedChildren());
    approvePending(r);
    let calls = 0;
    const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { calls += 1; return { exitCode: code, outputTail: 'x' }; } });
    assert.equal(out.status, status, `exit ${code}`); assert.equal(calls, 1, `exit ${code}: one start, no retry`);
    assert.equal(out.node, 'R/M1'); assert.equal(out.exitCode, code);
    assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1'], `exit ${code}: no sibling was registered`);
    // a second sitting meets the same node: it starts nothing new (the node is still active; a fake run left it registered, so it is the SAME start that is offered, never a new registration)
    const again = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { calls += 1; return { exitCode: code }; } });
    assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1']); assert.deepEqual(again.started.map(s => [s.node, s.runId]), [['R/M1', out.started[0].runId]], 'the SAME registered node is offered its start again (same id, same grant), never a second registration');
  }
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { throw new Error('cannot spawn'); } });
  assert.equal(out.status, 'start_failed'); assert.match(out.error, /cannot spawn/); assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1']);
});

test('the tree lock is NOT held while a child runs: inside the starter the lock can be taken at once (a member\'s own start takes the same lock and gives up after about two seconds)', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  let heldInside = null;
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: async () => { heldInside = withTreeLock(r.t.rootDir, () => 'taken', { tries: 1 }); return { exitCode: 3 }; } });
  assert.equal(heldInside, 'taken');
});

test('L1 (a pause blocks the rest): a child waiting for an external answer is paused (exit 3, NEEDS file named); the sitting ends waiting, no sibling is registered, and a second sitting starts nothing', { timeout: 180_000 }, async () => {
  const r = await trackedRealRoot(externalChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
  assert.equal(out.status, 'waiting', JSON.stringify(out)); assert.equal(out.node, 'R/M1'); assert.equal(out.exitCode, 3); assert.ok(out.needs.length >= 1 && out.needs.every(f => /^NEEDS-.*\.md$/.test(f)), JSON.stringify(out.needs));
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'running' }, 'paused is still active: its claim stands');
  let calls = 0;
  const again = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { calls += 1; return { exitCode: 0 }; } });
  assert.equal(again.status, 'waiting'); assert.equal(calls, 0, 'nothing is started while the child waits'); assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1']);
});

test('L19: a STOP marker ends the sitting before anything is registered or started; a marker written while a child runs lets that child finish and starts no further node; `council tree stop` writes it and says what it does; removing it lets the sitting go on', { timeout: 180_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  assert.equal(stopRequested(r.t.rootDir), false);
  requestStop(r.t.rootDir);
  assert.equal(stopMarkerPath(r.t.rootDir), join(r.t.rootDir, 'tree', STOP_MARKER)); assert.equal(stopRequested(r.t.rootDir), true);
  let calls = 0;
  const none = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { calls += 1; return { exitCode: 0 }; } });
  assert.equal(none.status, 'stopped_by_person'); assert.equal(calls, 0); assert.deepEqual(Object.keys(phases(r)), ['R'], 'nothing was registered');
  assert.equal(clearStop(r.t.rootDir), true); assert.equal(stopRequested(r.t.rootDir), false); assert.equal(clearStop(r.t.rootDir), false, 'nothing left to remove');
  // the marker appears while R/M1 runs: it finishes, and the sitting ends before R/M2
  const real = draftStarter(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: async args => { const res = await real(args); requestStop(r.t.rootDir); return res; } });
  assert.equal(out.status, 'stopped_by_person'); assert.deepEqual(out.started.map(s => [s.node, s.exitCode]), [['R/M1', 0]]);
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'closed' });
  // the verb: it writes the marker, says what a running child does, and says so when a stop already stands
  const io = () => ({ stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
  clearStop(r.t.rootDir);
  const a = io(); const text = []; a.stdout.on('data', d => text.push(String(d)));
  assert.equal(await treeCommand(['stop', ROOT_ID], { work: r.t.work, ...a }), 0);
  assert.equal(stopRequested(r.t.rootDir), true); assert.match(text.join(''), /Stop requested\. No further node of tree .* continues to its next pause or end/);
  const b = io(); const text2 = []; b.stdout.on('data', d => text2.push(String(d)));
  assert.equal(await treeCommand(['stop', ROOT_ID], { work: r.t.work, ...b }), 0); assert.match(text2.join(''), /A stop was already requested; it stands\./);
  clearStop(r.t.rootDir);
  const rest = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(rest.status, 'nothing_to_do'); assert.deepEqual(rest.started.map(s => s.node), ['R/M2', 'R/M3']);
});

test('the held items, REAL (guard): children whose chain refuses an inherited item are held; the frontier shows it, the approval binds it, the loop registers the child, and the item is carried in context only (obligation map, context.md, guard_refused with its origin)', { timeout: 180_000 }, async () => {
  const r = await trackedRealRoot(heldGuardChildren());
  const d = approvePending(r);
  assert.deepEqual(d.view.children.map(c => [c.node, c.held]), [['R/M1', ['blocked_criteria_guard']], ['R/M2', []], ['R/M3', ['blocked_criteria_guard']]], 'the stop shows R/M1 and R/M3 held');
  assert.deepEqual(d.view.children[0].refused.map(x => [x.guard, x.text, x.origin]), [['infeasibleCriteria', 'The summary of the debate is written to BOARD.md.', 'R:C2']]);
  assert.match(d.preview.children[0].heldSha256, /^[0-9a-f]{64}$/); assert.notEqual(d.preview.children[0].heldSha256, d.preview.children[1].heldSha256, 'a held child and a clean one bind different digests');
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out)); assert.deepEqual(out.started.map(s => [s.node, s.exitCode]), [['R/M1', 0], ['R/M2', 0], ['R/M3', 0]]);
  const reg = eventsOf(r).find(e => e.event === 'node_registered' && e.node === 'R/M1');
  assert.deepEqual(reg.obligations.context.map(c => [c.form, c.reason, c.guard, c.identity.originId, c.identity.originClass]), [['The summary of the debate is written to BOARD.md.', 'guard_refused', 'infeasibleCriteria', 'C2', 'delegated']], 'the refused item is in the obligation map\'s context list, with its origin');
  assert.equal(reg.obligations.items.some(i => i.identity?.originId === 'C2'), false, 'and not in the acceptance list (the child\'s own C2 is a refinement, a different item)');
  const bundle = bundleDirOf(r.t.rootDir, 'R/M1', 1);
  assert.equal(JSON.parse(readFileSync(join(bundle, 'criteria.json'), 'utf8')).includes('The summary of the debate is written to BOARD.md.'), false, 'criteria.json does not hold it');
  assert.match(readFileSync(join(bundle, 'context.md'), 'utf8'), /carried in context, still mandatory \(.*refused by infeasibleCriteria\)[^]*The summary of the debate is written to BOARD\.md\./);
  const g = eventsOf(r).filter(e => e.event === 'guard_refused');
  assert.deepEqual(g.map(e => [e.node, e.guard, e.origin]).sort(), [['R/M1', 'infeasibleCriteria', 'R:C2'], ['R/M3', 'infeasibleCriteria', 'R:C2']]);
  assert.equal(phases(r)['R/M1'], 'closed', 'the held child ran');
});

test('the held items, REAL (a check the child chain does not enforce): R/M1 and R/M3 inherit a checkable item and their chain has criterion kinds off; they are held, bound by the approval, registered, and the item is marked checkNotEnforced with its check carried in context.md', { timeout: 120_000 }, async () => {
  const r = await trackedRealRoot(heldKindsChildren());
  const d = approvePending(r);
  assert.deepEqual(d.view.children.map(c => [c.node, c.held]), [['R/M1', ['check_not_enforced']], ['R/M2', []], ['R/M3', ['check_not_enforced']]]);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const c2 = reg.event.obligations.items.find(i => i.id === 'C2');
  assert.equal(c2.checkNotEnforced, true); assert.equal(c2.identity.form.check, 'the deliverable has a heading named "Assumptions"');
  assert.match(readFileSync(join(reg.bundleDir, 'context.md'), 'utf8'), /check not enforced by this chain \(kinds are off\): C2[^]*the deliverable has a heading named "Assumptions"/);
});

test('L8 (depth 2), REAL: R/M2 expects from R/M1, which splits into three children; the independent R/M3 runs first; R/M2 is not registered until R/M1 AND every child of R/M1 are closed and settled, and its dependsOn lists the provider and each child with its pin', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  const one = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(one.status, 'nothing_to_do', JSON.stringify(one));
  assert.deepEqual(one.started.map(s => s.node), ['R/M1', 'R/M3'], 'the provider, then the independent sibling; the consumer waits');
  assert.deepEqual(one.verified.map(v => [v.node, v.refusal]), [['R/M1', null]], 'the provider\'s split was verified');
  assert.equal(one.waiting.length, 1); assert.equal(one.waiting[0].node, 'R/M2');
  assert.match(one.waiting[0].why.join(' | '), /R\/M1's child R\/M1\/M1 is not registered yet[^]*R\/M1\/M2[^]*R\/M1\/M3/, 'the whole subtree is part of the wait');
  assert.equal(phases(r)['R/M2'], undefined);
  approvePending(r);                                                                    // the person approves the provider's own frontier
  const two = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(two.status, 'nothing_to_do', JSON.stringify(two));
  assert.deepEqual(two.started.map(s => s.node), ['R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2'], 'the provider\'s children in dependency order, THEN the consumer');
  const ev = eventsOf(r);
  const regB = ev.findIndex(e => e.event === 'node_registered' && e.node === 'R/M2');
  for (const n of ['R/M1', 'R/M1/M1', 'R/M1/M2', 'R/M1/M3']) assert.ok(ev.findIndex(e => e.event === 'node_closed' && e.node === n) < regB, `${n} closed before the consumer was registered`);
  const pins = n => ev.find(e => e.event === 'node_closed' && e.node === n).thinContractSha256;
  assert.deepEqual(ev[regB].dependsOn.map(d => [d.node, d.generation, d.thinContractSha256]), ['R/M1', 'R/M1/M1', 'R/M1/M2', 'R/M1/M3'].map(n => [n, 1, pins(n)]), 'dependsOn: the provider and each node of its subtree, with generation and pin');
});

test('the sitting module reads no environment variable and no process argument (a tree verb takes none), and starts runs only through the injected starter', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'src', 'tree-run.js'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal(/process\.env|process\.argv|\bargv\b/.test(code), false);
  assert.equal(/\bspawn\b|execFile|child_process/.test(code), false, 'no process is spawned here: api.run does that');
});

test('a run that ended and left no end event is reconciled from its files before the next step (record-only: node_closed from report.json), then the sitting goes on to the next child', { timeout: 180_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.equal(first.started.length, 1); assert.equal(first.started[0].node, 'R/M1');
  // the process "died before writing its end event": drop the node_closed line of R/M1 from the record
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter(l => !(JSON.parse(l).event === 'node_closed' && JSON.parse(l).node === 'R/M1'));
  assert.equal(kept.length, lines.length - 1); writeFileSync(file, `${kept.join('\n')}\n`);
  assert.equal(phases(r)['R/M1'], 'running', 'before: claimed, no end event');
  // M5 row 3: while the claim's process may still be alive, its own exit hook may be about to write that event: nothing is reconciled and nothing is started
  let spied = 0;
  const alive = await runTree(r.t.rootDir, { work: r.t.work, facts: { pidAlive: () => true }, startRun: async () => { spied += 1; return { exitCode: 0 }; } });
  assert.equal(alive.status, 'running_elsewhere'); assert.equal(spied, 0); assert.equal(phases(r)['R/M1'], 'running', 'a live claim is not reconciled');
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.equal(out.status, 'limit_reached', 'the belt is its own status, not "nothing left to do"'); assert.match(out.detail, /run the command again to go on/);
  assert.equal(phases(r)['R/M1'], 'closed', `reconciled from report.json: ${JSON.stringify(out)}`);
  assert.deepEqual(out.started.map(s => s.node), ['R/M2'], `and the sitting went on: ${JSON.stringify({ ...out, verified: undefined })}`);
  assert.equal(eventsOf(r).filter(e => e.event === 'node_closed' && e.node === 'R/M1').length, 1);
  assert.match(eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M1').thinContractSha256, /^[0-9a-f]{64}$/, 'the closing event written from the files carries the thin-contract pin (a consumer needs it)');
});

test('a stop written while the next child is being derived is honoured before it starts: the child stays registered (not started) and a later sitting starts it with the same id', { timeout: 180_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  let calls = 0;
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { calls += 1; return { exitCode: 0 }; }, hooks: { afterRegister: next => { if (next.kind === 'registered') requestStop(r.t.rootDir); } } });
  const reg = eventsOf(r).find(e => e.event === 'node_registered' && e.node === 'R/M1');
  assert.equal(out.status, 'stopped_by_person'); assert.equal(calls, 0);
  // R7 (Fable Q4-2): the list the end text maps over - an array of { node, generation, runId, grantUsd }, not one bare object (the sitting text used to throw `items.map is not a function`)
  assert.deepEqual(out.registeredNotStarted, [{ node: 'R/M1', generation: 1, runId: reg.runId, grantUsd: reg.grant.amount }]);
  const text = sittingLines(out, 'rid').join('\n');
  assert.match(text, new RegExp(`R/M1 is registered but has not started: it holds a grant of \\$[0-9.]+ \\(run ${reg.runId}\\)`));
  assert.equal(phases(r)['R/M1'], 'registered');
  clearStop(r.t.rootDir);
  const next = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.deepEqual(next.started.map(s => [s.node, s.runId]), [['R/M1', reg.runId]]);
});

// M5g (builder B found mutation E1 of the M5c2 script GREEN at 140d474: step 0 of a sitting, `if (stopRequested(rootDir)) return result('stopped_by_person')`, replaced by `if (false)` changed no test). L19's tests have no child that is
// ALREADY registered, so the later shouldStop inside registerNextChild gave the same status. Step 0's real job: a child registered earlier but not started + a STOP marker present when a NEW sitting begins. runIt has no stop check of its own.
test('E1: a child that is registered but not started + a STOP marker at the START of a sitting: the sitting makes no start call, writes no node_started, leaves the child `registered`, and ends stopped_by_person', { timeout: 180_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => ({ exitCode: 0 }), hooks: { afterRegister: next => { if (next.kind === 'registered') requestStop(r.t.rootDir); } } });
  assert.equal(first.status, 'stopped_by_person'); assert.equal(phases(r)['R/M1'], 'registered', 'fixture: R/M1 is registered, not started');
  assert.equal(stopRequested(r.t.rootDir), true, 'fixture: the marker is still there when the next sitting begins (not cleared)');
  const before = eventsOf(r).length; let calls = 0;
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { calls += 1; return { exitCode: 0 }; }, resumeRun: async () => { calls += 1; return { exitCode: 0 }; } });
  assert.equal(calls, 0, 'no start (and no resume) call under a STOP marker');
  assert.equal(eventsOf(r).filter(e => e.node === 'R/M1' && (e.event === 'node_started' || e.event === 'node_resumed')).length, 0, 'no node_started / node_resumed written for R/M1 (the root R has its own node_started from the fixture)');
  assert.equal(phases(r)['R/M1'], 'registered', 'the child stays registered'); assert.equal(eventsOf(r).length, before, 'the sitting wrote nothing at all');
  assert.equal(out.status, 'stopped_by_person'); assert.deepEqual(out.started, []);
});

test('a stop written while the next child is DERIVED, or while its bundle is written, registers nothing (no node_registered, no bundle for the first case): the stop is checked before the bundle and again right before the registration', { timeout: 180_000 }, async () => {
  for (const [point, bundleExpected] of [['afterDerive', false], ['beforeRegister', true]]) {
    const r = await trackedRealRoot(pricedChildren()); approvePending(r);
    let calls = 0;
    const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: async () => { calls += 1; return { exitCode: 0 }; }, hooks: { [point]: () => requestStop(r.t.rootDir) } });
    assert.equal(out.status, 'stopped_by_person', point); assert.equal(out.nothingRegistered, 'R/M1'); assert.equal(calls, 0);
    assert.deepEqual(Object.keys(phases(r)), ['R'], `${point}: nothing was registered`);
    assert.equal(existsSync(join(r.t.rootDir, 'tree', 'inputs')), bundleExpected, `${point}: the bundle ${bundleExpected ? 'was already written (harmless: a later sitting re-derives the same bytes)' : 'was not written'}`);
  }
});

test('a node that is already running is never started again by a sitting: a live claim ends it running_elsewhere (another process owns it), a dead claim ends it interrupted (an ordinary execution to resume: `tree resume`, M5c3); the starter is not called', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  syntheticRun(r.t, reg.runId, {});                                                    // a started node has its run folder (PLAN 7.2)
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim(reg.node, reg.runId, process.pid, 1, hostnameOf()) });
  let calls = 0; const startRun = async () => { calls += 1; return { exitCode: 0 }; };
  const live = await runTree(r.t.rootDir, { work: r.t.work, startRun, facts: { pidAlive: () => true } });
  assert.equal(live.status, 'running_elsewhere'); assert.equal(live.node, 'R/M1');
  const dead = await runTree(r.t.rootDir, { work: r.t.work, startRun, facts: { pidAlive: () => false } });
  assert.equal(dead.status, 'interrupted'); assert.equal(dead.runId, reg.runId);
  assert.equal(calls, 0); assert.deepEqual(Object.keys(phases(r)).sort(), ['R', 'R/M1']);
});
