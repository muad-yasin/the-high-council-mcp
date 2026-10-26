// `council tree decide --close <node>` (0.8.3 M5d, sub-commit 4; PLAN 7.5, 8.5, 10.1; M5 exit check L10 for the Q2 clear). Synthetic nodes (a registered child, an interrupted one, a paused one) and real all-mock trees, $0.
// Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, TREE_DIR, TREE_FILE } from '../src/tree-record.js';
import { budgetOf, gateTree, returnedUsdOf, topUp } from '../src/tree-budget.js';
import { closeIncomplete, consumersWaiting } from '../src/tree-close.js';
import { approvalValid } from '../src/tree-transitions.js';
import { decideHandler } from '../src/tree-decide.js';
import { chooseNextChild, registerNextChild } from '../src/tree-loop.js';
import { resumeHandler } from '../src/tree-resume.js';
import { approveHandler } from '../src/tree-approve.js';
import { apiStarter, runTree } from '../src/tree-run.js';
import * as api from '../src/api.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { stoppedChildFixture, usdRx } from './helpers/money-figures.js';
import { externalChildren, pricedChildren, splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { LEAF_PLAN, approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { assertBoundTextClean, dirty } from './helpers/bound-text.js';
import { GATE_FIELDS, IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, reservedLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';

const dead = { pidAlive: () => false };
const decide = (rootDir, work, flags, answers, { facts, onPrompt, tty } = {}) => {
  const io = terminal(answers, tty === false ? { tty: false } : {});
  if (answers.length === 0) io.stdin.end();     // a run that has nobody to answer and wrongly ASKS ends (and fails its assertions) instead of waiting for ever: a removed guard must not look like a hang
  if (onPrompt) io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d))) onPrompt(); });
  return { io, run: () => decideHandler({ rootDir, rootId: ROOT_ID, flags, work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), facts }) };
};
const closes = rootDir => readTreeRecord(rootDir).events.filter(e => e.event === 'node_closed' && e.outcome === 'incomplete');
const money2 = v => Math.round(v * 100) / 100;

/** A synthetic tree: the root closed, R/M1 registered with a grant of 10; `started` writes its claim (this process's pid; pair it with `dead` facts for an interrupted node). */
function kid({ started = false, host = hostnameOf(), lines = [], externalNeed = false } = {}) {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  const dir = syntheticRun(t, IDS[0], {});
  if (started) appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, host) });
  if (lines.length) writeLines(t, IDS[0], 'R/M1', lines);
  if (externalNeed) writeFileSync(join(dir, 'NEEDS-build.md'), 'waiting\n');
  return { t, dir, key };
}

test('a registered, never-started node: the text names its phase, grant, what returns and the available figure before and after; typing the node path closes it incomplete with the gate fields; the WHOLE grant returns; no other number moves; nothing starts', async () => {
  const c = kid();
  const before = budgetOf(c.t.rootDir); const treeBefore = readFileSync(join(c.t.rootDir, TREE_DIR, TREE_FILE));
  assert.equal(before.nodes.find(n => n.node === 'R/M1').heldUsd, 10);
  const d = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, ['R/M1', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const shown = d.io.shown();
  assert.match(shown, /Close R\/M1@g1 as incomplete\?/); assert.match(shown, /It is: registered, never started\./); assert.match(shown, /a grant of \$10\.00 \(first grant \$10\.00\); it has spent \$0\.00/);
  assert.match(shown, /Closing gives \$10\.00 back to the root's pool: available \$90\.00 -> \$100\.00\. Everything it spent stays counted\./);
  assert.match(shown, /never resumed and can never be a provider[^]*Nothing else is changed or closed for it/); assert.match(shown, /To approve, type the node path: R\/M1\n/); assert.match(shown, /Type the node path shown in the last line above: /);
  const ev = closes(c.t.rootDir); assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].node, ev[0].generation, ev[0].outcome, ev[0].passed, ev[0].status, ev[0].share, ev[0].returnedUsd], ['R/M1', 1, 'incomplete', false, null, 'released', 10]);
  assert.equal(ev[0].planCopy, null, 'a person\'s incomplete close keeps no plan: an explicit null (restore gap 2a)');
  assert.ok(ev[0].gateId); assert.match(ev[0].shownSha256, /^[0-9a-f]{64}$/);
  const after = budgetOf(c.t.rootDir);
  assert.equal(after.heldUsd, 0); assert.equal(money2(after.availableUsd - before.availableUsd), 10); assert.equal(after.treeSpentUsd, before.treeSpentUsd, 'spend stays counted');
  assert.deepEqual(readFileSync(join(c.t.rootDir, TREE_DIR, TREE_FILE)), treeBefore); assert.equal(stateOf(readTreeRecord(c.t.rootDir)).nodes.get('R/M1@g1').phase, 'closed');
  assert.equal(eventsOf({ t: c.t }).some(e => e.event === 'node_started' && e.node === 'R/M1'), false, 'nothing was started');
});

test('an interrupted node (its claim is dead on this host): closes incomplete; an UNSETTLED reservation stays charged at its worst case, so the grant returns less it (the figure errs high); the tree\'s spend is the same before and after', async () => {
  const c = kid({ started: true, lines: [reservedLine('r1', 1.0, 'build')] });
  const gate = gateTree(c.t.rootDir); assert.equal(gate.ok, true, JSON.stringify(gate.problems));
  const before = budgetOf(c.t.rootDir, { gate });
  assert.equal(before.nodes.find(n => n.node === 'R/M1').spentUsd, 1, 'the worst case of the reservation');
  const d = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, ['R/M1', 'y'], { facts: dead });
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /It is: interrupted \(its process is gone\)\./); assert.match(d.io.shown(), /it has spent \$1\.00 \(an unsettled reservation counts at its worst case, so this figure errs high\)/); assert.match(d.io.shown(), /Closing gives \$9\.00 back/);
  const ev = closes(c.t.rootDir); assert.equal(ev.length, 1); assert.equal(ev[0].returnedUsd, 9);
  const after = budgetOf(c.t.rootDir);
  assert.equal(after.treeSpentUsd, before.treeSpentUsd); assert.equal(money2(after.availableUsd - before.availableUsd), 9, 'grant - worst case returns; the unsettled 1.00 stays charged');
});

test('a node paused at an external seat (dead claim, an open NEEDS file) can be closed: the text says so and the NEEDS file is left alone', async () => {
  const c = kid({ started: true, externalNeed: true });
  const d = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, ['R/M1', 'y'], { facts: dead });
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /It is: paused, waiting for an external answer \(its NEEDS file stays as it is\)\./);
  assert.equal(existsSync(join(c.dir, 'NEEDS-build.md')), true); assert.equal(closes(c.t.rootDir).length, 1);
});

test('a real node stopped at its cap: returns grant + top-ups - spent (budgetOf before and after); nothing starts', { timeout: 300_000 }, async () => {
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed it as #4072). OLD: cap 26, the grant 8.65 and the typed 11.65 (8.65 + the $3 top-up), sized against mock-budget's cheapest end 8.064. NEW: G, CAP = test/helpers/money-figures.js stoppedChildFixture() (the root cap whose equal share among three children is just over mock-budget's own cheapest end, and that share); the expected grant is G + 3. WHY: recording the drafted words moves the cheapest end (8.064 -> 8.714), so R/M1 was not admitted and the sitting ended in another stop.
  const { G, CAP } = stoppedChildFixture();
  const r = await trackedRealRoot({ childChain: 'mock-budget', cap: CAP });      // CAP is stoppedChildFixture()'s root cap and the grant is G = floorCents((CAP - the root's handoff) / 3), just over mock-budget's cheapest end (the CHANGED ACCEPTED note above); history: the estimator unit moved the typed cap 20 -> 26 (fixture-delta-trace.txt)
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work }); assert.equal(out.status, 'budget_stop', JSON.stringify(out));
  topUp(r.t.rootDir, { node: 'R/M1', amountUsd: 3, ...GATE_FIELDS });
  const before = budgetOf(r.t.rootDir); const n0 = before.nodes.find(n => n.node === 'R/M1');
  // the grant is an equal share of what is available: proposeGrants (src/tree-budget.js:333) proposes min(atMost, available / k) with k = 3 children, shown through floorCents (src/tree-frontier.js:261): available = 20 - 0.04 (the root's handoff), so floorCents(19.96 / 3) = 6.65 (it was floorCents(20 / 3) = 6.66 while the root's handoff cost $0), plus the $3 top-up
  assert.equal(money2(n0.grantUsd), money2(G + 3));      // OLD 9.65 = 6.65 + the $3 top-up; NEW G + 3 (G is stoppedChildFixture()'s grant)
  // CHANGED ACCEPTED (money-test conversion, lane C, 24 Okt 2026; C&C thcmcp-cd: "restore it"): the check `assert.equal(n0.phase, 'stopped')` had been swallowed into the end of the comment above by an earlier edit (history: 4dc662f9 era), so it had not run since. OLD: inside a comment. NEW: it runs again, on its own line. WHY: the test's own title says the node is STOPPED at its cap; the top-up must leave it stopped.
  assert.equal(n0.phase, 'stopped');
  const registered = eventsOf(r).filter(e => e.event === 'node_registered').length;
  const d = decide(r.t.rootDir, r.t.work, { close: 'R/M1' }, ['R/M1', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /It is: stopped at its budget cap\./); assert.match(d.io.shown(), new RegExp(`first grant \\$${usdRx(G)} plus top-ups \\$3\\.00`));
  const ev = closes(r.t.rootDir); assert.equal(ev.length, 1);
  assert.equal(money2(ev[0].returnedUsd), money2(n0.grantUsd - n0.spentUsd)); assert.equal(ev[0].returnedUsd, returnedUsdOf(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1'), join(r.t.runsDir, n0.runId), 0));
  const after = budgetOf(r.t.rootDir); assert.equal(after.heldUsd, before.heldUsd - n0.heldUsd); assert.equal(money2(after.availableUsd - before.availableUsd), money2(n0.heldUsd));
  assert.equal(eventsOf(r).filter(e => e.event === 'node_registered').length, registered, 'nothing registered or started');
});

test('refusals ask nobody and write nothing: a live claim (this host), a claim from another host (never judged dead from here), a post-run call in flight, a run that already ended, the root, a closed node, an unknown node', async () => {
  const live = kid({ started: true });
  const foreign = kid({ started: true, host: 'some-other-host' });
  const ended = kid({ started: true }); writeFileSync(join(ended.dir, 'STOPPED-budget.json'), '{}');
  const closed = kid(); appendTreeEvent(closed.t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'incomplete', passed: false, status: null, share: 'released', returnedUsd: 10, ...GATE_FIELDS });
  const post = kid({ started: true });
  appendTreeEvent(post.t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'not_passed', passed: false, status: null, share: 'released' });
  appendTreeEvent(post.t.rootDir, { event: 'node_resumed', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()), purpose: 'post_run' });
  const cases = [[live, 'R/M1', {}, /R\/M1@g1 is running: pid \d+ on \S+ holds its claim and is alive/], [foreign, 'R/M1', dead, /on some-other-host holds its claim \(another host: never judged dead from here\)/], [post, 'R/M1', {}, /in a post-run paid call/],
    [ended, 'R/M1', dead, /already ended[^]*`council tree resume` records how it ended[^]*overwrite a real result/], [live, 'R', {}, /the root cannot be closed as a node[^]*council tree decide [^ ]+ --abandon[^]*council tree stop/], [closed, 'R/M1', {}, /already closed/], [live, 'R/M9', {}, /no such node in this tree/]];
  for (const [c, node, facts, re] of cases) {
    const n = readTreeRecord(c.t.rootDir).events.length;
    const d = decide(c.t.rootDir, c.t.work, { close: node }, ['x'], { facts });                // a throwaway answer: a form that wrongly gets as far as the prompt fails the assertions below instead of hanging
    assert.equal(await d.run(), 1, `${node}: ${d.io.errors()}`); assert.match(d.io.errors(), re); assert.match(d.io.errors(), /Nothing was asked and nothing was written\./);
    assert.equal(readTreeRecord(c.t.rootDir).events.length, n, `${node}: nothing written`);
  }
});

test('the claim is re-checked UNDER the tree lock: a claim that appears after the form was built is refused by closeIncomplete itself (a blocked record, a TreeRefusal), and closing a run that ended is refused there too', () => {
  const c = kid();
  appendTreeEvent(c.t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const n = readTreeRecord(c.t.rootDir).events.length;
  assert.throws(() => closeIncomplete(c.t.rootDir, { node: 'R/M1', ...GATE_FIELDS }), e => e instanceof TreeRefusal && /holds its claim/.test(e.reason));
  const ev = readTreeRecord(c.t.rootDir).events;
  assert.equal(ev.length, n + 1); assert.deepEqual([ev.at(-1).event, ev.at(-1).reason, ev.at(-1).check], ['blocked', 'continuation_refused', 'close']); assert.equal(closes(c.t.rootDir).length, 0);
  writeFileSync(join(c.dir, 'report.json'), JSON.stringify({ passed: true }));
  assert.throws(() => closeIncomplete(c.t.rootDir, { node: 'R/M1', ...GATE_FIELDS }, { facts: dead }), e => e instanceof TreeRefusal && /already ended/.test(e.reason), 'a run whose folder holds its end is not interrupted');
  assert.equal(closes(c.t.rootDir).length, 0);
});

test('the typed step is the node path; a wrong one, a decline and no terminal write nothing; a claim that appears while the person reads means the yes is NOT used', async () => {
  const c = kid();
  const wrong = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, ['R/M2', 'y']); assert.equal(await wrong.run(), 1); assert.match(wrong.io.shown(), /That is not what the text asks you to type/);
  const declined = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, ['R/M1', 'n']); assert.equal(await declined.run(), 1);
  const notty = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, [], { tty: false }); assert.equal(await notty.run(), 2);
  assert.equal(closes(c.t.rootDir).length, 0);
  const moved = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, ['R/M1', 'y'], { onPrompt: () => appendTreeEvent(c.t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) }) });
  assert.equal(await moved.run(), 1); assert.match(moved.io.errors(), /what you were shown has changed while you were reading it[^]*approval was NOT used/);
  assert.equal(closes(c.t.rootDir).length, 0); assert.equal(stateOf(readTreeRecord(c.t.rootDir)).nodes.get('R/M1@g1').phase, 'running');
});

test('closeIncomplete requires the gate fields (a TypeError), and the table refuses a node_closed with outcome incomplete that lacks them (that outcome is only a person\'s); the ordinary outcomes need neither', () => {
  const c = kid();
  assert.throws(() => closeIncomplete(c.t.rootDir, { node: 'R/M1' }), TypeError); assert.throws(() => closeIncomplete(c.t.rootDir, { node: 'R/M1', gateId: 'g' }), TypeError); assert.throws(() => closeIncomplete(c.t.rootDir, { node: 'R/M1', gateId: 'g', shownSha256: 'zz' }), TypeError);
  assert.throws(() => appendTreeEvent(c.t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'incomplete', passed: false, status: null, share: 'released', returnedUsd: 10 }), e => e instanceof TreeRefusal && /carries the gate whose approval authorized it/.test(e.reason));
  assert.equal(closes(c.t.rootDir).length, 0);
  const ok = closeIncomplete(c.t.rootDir, { node: 'R/M1', ...GATE_FIELDS }); assert.equal(ok.outcome, 'incomplete');
});

test('the sitting for a consumer says WHY it waits: a provider closed incomplete by a person is "closed incomplete by a person", not "the panel did not pass it"; the consumers are named by the form, transitively through the ancestors (real depth 2)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  const one = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.deepEqual(one.started.map(s => s.node), ['R/M1', 'R/M3']);
  approvePending(r);                                                                                 // R/M1's own frontier
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.node], ['registered', 'R/M1/M1']);
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const waiting = consumersWaiting({ record, state, runsDir: r.t.runsDir, node: 'R/M1/M1' });
  assert.deepEqual(waiting.map(w => w.node), ['R/M1/M2', 'R/M2'], 'the sibling that expects from it AND the consumer of its ancestor R/M1 (R/M2 expects from R/M1); not R/M1/M3, not R/M3');
  assert.match(waiting.find(w => w.node === 'R/M2').why, /expects an agreement from R\/M1/); assert.equal(waiting.find(w => w.node === 'R/M2').phase, null);
  const d = decide(r.t.rootDir, r.t.work, { close: 'R/M1/M1' }, ['R/M1/M1', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /These wait for it and will not start[^]*- R\/M1\/M2 \(not registered yet\): [^]*- R\/M2 \(not registered yet\): it expects an agreement from R\/M1/); assert.equal(/- R\/M1\/M3|- R\/M3/.test(d.io.shown()), false);
  const next = chooseNextChild(r.t.rootDir, { work: r.t.work });
  const why = next.waiting.flatMap(w => w.why).join(' | ');
  assert.match(why, /R\/M1\/M1 was closed incomplete by a person/); assert.equal(/R\/M1\/M1 closed but the panel did not pass it/.test(why), false);
  assert.equal(phases(r)['R/M1/M1'], 'closed');
});

// ----------------------------------------------------------------------------------------------------------------------- Q2 (L10): the parent_changed block clears when every REGISTERED child of the frontier is closed
test('Q2 / L10 through the REAL verb: R/M2 is registered and refused for a changed parent (parent_changed); closing it with `decide --close` leaves every registered child of the frontier closed, so the block clears; the parent file is STILL edited, so the next registration writes parent_changed again (cleared never means the plan is fine)', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d0 = approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const b = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(b.node, 'R/M2');
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); writeFileSync(file, `${readFileSync(file, 'utf8')}\nAn edit after the approval.\n`);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) }); assert.equal(first.status, 'tree_refused', JSON.stringify(first));
  let st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.sticky.has('parent_changed'), true); assert.equal(approvalValid(st.frontiers.get(d0.frontierKey)), false); assert.equal(st.stale.has('R/M2@g1'), true);
  const dd = decide(r.t.rootDir, r.t.work, { close: 'R/M2' }, ['R/M2', 'y']);
  assert.equal(await dd.run(), 0, dd.io.shown() + dd.io.errors());
  st = stateOf(readTreeRecord(r.t.rootDir));
  // R1 (the M5 API reviews, Opus 1-1 and Fable Q3-1): the BLOCK lifts (the tree is not stuck, nothing is stale), the APPROVAL does not: R/M3 was not registered when the drift was found, and the revision-1 approval showed
  // the parent as it was before the edit. Only a frontier_approved written after the block makes the frontier startable again.
  assert.equal(st.sticky.has('parent_changed'), false, 'every registered child of the frontier is closed: the block lifts'); assert.deepEqual([...st.stale], ['R@g1'], 'nothing of the frontier is stale; only the ROOT, held by its own blocked stop (S8 G9: the edit also made the root unsigned_change; old: stale.size 0)');
  assert.equal(approvalValid(st.frontiers.get(d0.frontierKey)), false, 'the approval of the parent as it was before the edit does NOT revive for the sibling that was never registered');
  const blocksBefore = eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'parent_changed').length;
  const offer = chooseNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(offer.awaitingApproval, [d0.frontierKey], 're-approval is offered');
  const again = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(again.kind, 'none', JSON.stringify(again)); assert.deepEqual(again.awaitingApproval, [d0.frontierKey]);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R/M3@g1'), false, 'R/M3 is NOT registered on the old approval');
  assert.equal(eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'parent_changed').length, blocksBefore, 'nothing new was found or written: the old approval was never used');
  // "cleared never means the plan is fine": the parent file is STILL edited, so the way back (a new approval) refuses and nothing registers
  const io = terminal([]);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.notEqual(code, 0, io.shown() + io.errors());
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R/M3@g1'), false, 'still not registered');
});

test('Q2 is event-ordered: a block written AFTER its registered children closed is not cleared by them (R/M1 closed, then the block); closing nothing clears nothing', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d0 = approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });                 // R/M1 closed (passed)
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); writeFileSync(file, `${readFileSync(file, 'utf8')}\nAn edit after the approval.\n`);
  const a = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.deepEqual([a.kind, a.check], ['refused', 'parent_changed']);
  let st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.nodes.get('R/M1@g1').phase, 'closed'); assert.equal(st.sticky.has('parent_changed'), true, 'the registered child had closed BEFORE the block: it does not clear it');
  // a later close of a node of another shape changes nothing about this block: R/M1 is already closed; nothing closes now
  const none = decide(r.t.rootDir, r.t.work, { close: 'R/M1' }, []); assert.equal(await none.run(), 1); assert.equal(none.io.shown(), '', 'a refusal asks nobody'); assert.match(none.io.errors(), /--close R\/M1: /);
  st = stateOf(readTreeRecord(r.t.rootDir)); assert.equal(st.sticky.has('parent_changed'), true);
  void d0;
});

test('Q2 is never vacuous: a block with NO registered child (registration-time drift) has nothing a close could clear; only a new approval of that frontier lifts it', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d0 = approvePending(r);
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); writeFileSync(file, `${readFileSync(file, 'utf8')}\nAn edit after the approval.\n`);
  const a = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.deepEqual([a.kind, a.check], ['refused', 'parent_changed']);
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal([...st.nodes.values()].some(n => n.frontierKey === d0.frontierKey), false, 'no child of that frontier is registered');
  assert.equal(st.parentBlocks.has(d0.frontierKey), true); assert.equal(st.sticky.has('parent_changed'), true);
  const none = decide(r.t.rootDir, r.t.work, { close: 'R/M1' }, ['x']); assert.equal(await none.run(), 1, 'there is no such node to close'); assert.match(none.io.errors(), /no such node in this tree/);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).parentBlocks.has(d0.frontierKey), true, 'standing; only a new approval lifts it');
});

test('"never resumed" is true: a node paused at an external seat that was closed incomplete is NOT resumed when its answer file appears and `tree resume` runs (nothing is started or claimed for it)', async () => {
  const c = kid({ started: true, externalNeed: true });
  const d = decide(c.t.rootDir, c.t.work, { close: 'R/M1' }, ['R/M1', 'y'], { facts: dead }); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  writeFileSync(join(c.dir, 'build.md'), 'the answer\n');                                                  // the file its NEEDS-build.md waited for
  let started = 0; let resumed = 0;
  const io = terminal([]);
  const code = await resumeHandler({ rootDir: c.t.rootDir, rootId: ROOT_ID, work: c.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), facts: dead, deps: { startRun: async () => { started += 1; return { exitCode: 0 }; }, resumeRun: async () => { resumed += 1; return { exitCode: 0 }; } } });
  assert.equal(started + resumed, 0, `code ${code}: ${io.shown()}${io.errors()}`);
  assert.equal(eventsOf({ t: c.t }).some(e => e.event === 'node_resumed' && e.node === 'R/M1'), false); assert.equal(stateOf(readTreeRecord(c.t.rootDir)).nodes.get('R/M1@g1').phase, 'closed');
});

test('Q2: one registered child of the frontier still open keeps the block; the close that leaves EVERY registered child closed clears it (fold, hand-built record); a block with a different frontier key is untouched', () => {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });
  registerKid(t, key, 'R/M2', IDS[1], 10); syntheticRun(t, IDS[1], {});
  appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'R/M2@g1', frontierKey: key, check: 'ancestor', ancestor: 'R', detail: 'test' });
  appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'R/M9@g1', frontierKey: 'other-frontier', check: 'ancestor', ancestor: 'R', detail: 'test' });
  const st = () => stateOf(readTreeRecord(t.rootDir));
  assert.equal(st().parentBlocks.has(key), true);
  closeIncomplete(t.rootDir, { node: 'R/M2', ...GATE_FIELDS });
  assert.equal(st().parentBlocks.has(key), true, 'R/M1 (stopped) is registered and not closed: the block stands');
  closeIncomplete(t.rootDir, { node: 'R/M1', ...GATE_FIELDS });
  assert.equal(st().parentBlocks.has(key), false, 'every registered child is closed now'); assert.equal(st().parentBlocks.has('other-frontier'), true, 'another frontier\'s block is untouched');
  assert.equal(st().sticky.has('parent_changed'), true, 'the other block still stands, so the tree is still blocked');
});

test('the MEMBER CLI path refuses a closed member (C&C): a real member paused at an external seat is closed incomplete, its answer file is written, and `council --resume` on its run folder exits 19 with no provider call and no node_resumed', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(externalChildren());
  approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
  assert.equal(first.status, 'waiting', JSON.stringify(first));
  const dir = join(r.t.runsDir, first.runId);
  const d = decide(r.t.rootDir, r.t.work, { close: 'R/M1' }, ['R/M1', 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.equal(phases(r)['R/M1'], 'closed');
  writeFileSync(join(dir, 'build.md'), LEAF_PLAN);
  const usage = () => readdirSync(dir).filter(f => f.endsWith('.usage.json')).length; const before = usage(); const events = eventsOf(r).length;
  const res = await api.resume({ runDir: dir, cwd: r.t.work });
  assert.equal(res.exitCode, 19, JSON.stringify(res).slice(0, 600)); assert.equal(usage(), before, 'no provider call');
  assert.equal(eventsOf(r).some(e => e.event === 'node_resumed' && e.node === 'R/M1'), false);
  assert.equal(phases(r)['R/M1'], 'closed');
  const rec = eventsOf(r).slice(events);
  assert.equal(rec.length, 1, JSON.stringify(rec)); assert.deepEqual([rec[0].event, rec[0].reason, rec[0].scope, rec[0].transition], ['blocked', 'transition_refused', 'R/M1@g1', 'node_resumed']);
  assert.match(rec[0].detail, /R\/M1@g1 is closed; resume follows a budget stop or a dead claim/, 'it is the table\'s refusal of node_resumed on a closed node, not some other tree refusal');
});

test('the close text SAYS why it names every sibling when a plan in the tree could not be read (C&C, M5e S2): the root\'s verified plan is edited after a child was registered, then --close of that child', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered');
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); writeFileSync(file, `${readFileSync(file, 'utf8')}\nedited after the verification\n`);
  const d = decide(r.t.rootDir, r.t.work, { close: reg.node }, [reg.node, 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /A plan in this tree could not be read, so every sibling is treated as waiting/);
  // and when everything reads, the line is absent
  const ok = await trackedRealRoot(pricedChildren()); approvePending(ok); const reg2 = registerNextChild(ok.t.rootDir, { work: ok.t.work });
  const d2 = decide(ok.t.rootDir, ok.t.work, { close: reg2.node }, [reg2.node, 'y']); assert.equal(await d2.run(), 0);
  assert.equal(d2.io.shown().includes('could not be read'), false);
});

test('R9 (Opus 2-1, Astra F5): a node that STARTED and whose run folder is gone has an unknown spend - the close says so, gives nothing back and the pool keeps charging the grant; a node that never started (no folder is right) gives its whole grant back', { timeout: 120_000 }, async () => {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const dir = syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });
  registerKid(t, key, 'R/M2', IDS[1], 10);                                                              // never started: it has no run folder, and that is right
  renameSync(dir, `${dir}.moved`);                                                                       // R/M1's folder is gone
  const avail = () => budgetOf(t.rootDir).availableUsd;
  const before = avail();
  const d1 = decide(t.rootDir, t.work, { close: 'R/M1' }, ['R/M1', 'y']);
  assert.equal(await d1.run(), 0, d1.io.shown() + d1.io.errors());
  assert.match(d1.io.shown(), /it has spent unknown/); assert.match(d1.io.shown(), /Closing gives \$0\.00 back/);
  const closed1 = readTreeRecord(t.rootDir).events.find(e => e.event === 'node_closed' && e.node === 'R/M1');
  assert.equal(closed1.returnedUsd, 0, 'nothing is returned for a spend nobody can read');
  assert.ok(Math.abs(avail() - before) < 1e-9, `the pool keeps charging the grant: ${before} before, ${avail()} after`);
  // R9 follow-up (C&C): the charge is NOT spend. treeSpentUsd stays the PLAN 7.1 sum (the gate's), a node's spentUsd is what its folder shows, and the unknown part is its own named figure that availableUsd subtracts
  const b1 = budgetOf(t.rootDir);
  assert.equal(b1.treeSpentUsd, gateTree(t.rootDir).treeSpentUsd, 'the tree\'s spend is the gate\'s sum, nothing added');
  assert.equal(b1.nodes.find(n => n.node === 'R/M1').spentUsd, 0, 'the closed node\'s spend is what its folder shows (nothing)');
  assert.equal(b1.unknownSpendHeldUsd, 10); assert.equal(b1.unknownSpendNodes, 1); assert.equal(b1.nodes.find(n => n.node === 'R/M1').unreturnedUsd, 10);
  const d2 = decide(t.rootDir, t.work, { close: 'R/M2' }, ['R/M2', 'y']);
  assert.equal(await d2.run(), 0, d2.io.shown() + d2.io.errors());
  assert.match(d2.io.shown(), /Closing gives \$10\.00 back/);
  assert.match(d2.io.shown(), /held for unknown spend: \$10\.00 \(1 closed node whose run folder is gone\)/, 'every text that shows the pool says how much is held for unknown spend');
  const closed2 = readTreeRecord(t.rootDir).events.find(e => e.event === 'node_closed' && e.node === 'R/M2');
  assert.equal(closed2.returnedUsd, 10); assert.ok(Math.abs(avail() - (before + 10)) < 1e-9, 'the never-started node gave its whole grant back');
});

test('K10: the close is shown and hashed through terminalSafe: a control character and a bidi mark in the node\'s recorded run id are gone from the gate text, the screen and the hash, which agree', async () => {
  const word = dirty('run-HostileIdWords', 5);
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, key, 'R/M1', word.raw, 10);
  const d = decide(t.rootDir, t.work, { close: 'R/M1' }, ['R/M1', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const closedEv = closes(t.rootDir)[0];
  assertBoundTextClean({ rootDir: t.rootDir, shownSha256: closedEv.shownSha256, shown: d.io.shown(), word: word.clean });
});
