// 0.8.3 ROADMAP 77, step 1 (the GRANT of the paid repair recommendation; plan note Review/Build_0.8.3/m7/Roadmap77_Paid_Repair_Plan_Note_2026-10-20.md section 10): records and money only. All $0, synthetic run folders, no model.
// Rows: (G1) the hold is written and counted once; (G2) admission refuses what does not fit and writes nothing but a `blocked`; (G3) once a call has started, held is the grant's REMAINDER, never the grant plus the mirrored reservations (6d's gate row);
// (G4) an advice run goes through the same gate as a member, mirror included; (G5) ending releases, and a call cannot be added to an ended request; (G6) the wait for the brief's approval is bounded: reconcile releases it; (G7) abandon is refused while a request is live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { transitionRefusal } from '../src/tree-transitions.js';
import { MONEY_EPS, budgetOf, gateTree, lifetimeCapOf } from '../src/tree-budget.js';
import { adviceStart, endAdvice, reconcileAdvice, registerAdviceAdmitted } from '../src/tree-advice-record.js';
import { abandonRefusal, abandonTree } from '../src/tree-abandon.js';
import { closedRootTree, hostnameOf, reservedLine, settledLine, syntheticRun } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const SHA = 'a'.repeat(64);
const TTL = 600_000;
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const answer = { actor: 'session', via: 'mcp', reason: 'inside the typed cap; the person approves the brief' };
const fresh = (cap = 20) => { const t = closedRootTree({ cap }); track(t.work); return t; };
const budget = t => budgetOf(t.rootDir);
const hold = (t, over = {}, deps = {}) => registerAdviceAdmitted(t.rootDir, { adviceId: 'A1', grantUsd: 4, stopId: 'e9', gateId: 'g-grant', shownSha256: SHA, answer, ttlMs: TTL, ...over }, { now: () => T0, ...deps });
const events = (t, name) => readTreeRecord(t.rootDir).events.filter(e => e.event === name);
const callRun = (t, runId) => syntheticRun(t, runId, {});
const lineTo = (t, runId, line) => appendFileSync(join(t.runsDir, runId, 'spend-reservations.jsonl'), `${JSON.stringify(line)}\n`);
const RUN1 = '2026-10-20T12-01-00-000Z'; const RUN2 = '2026-10-20T12-02-00-000Z';

test('G1 the grant is HELD once: advice_registered carries the claim, the answer and the expiry; budget.advice holds it, heldUsd and availableUsd move by exactly the grant, every node sees it in heldByOthers, and budget.nodes is untouched', () => {
  const t = fresh();
  const before = budget(t);
  const ev = hold(t);
  assert.deepEqual([ev.event, ev.grantUsd, ev.actor, ev.via, ev.pid, ev.host, ev.expiresAtMs], ['advice_registered', 4, 'session', 'mcp', process.pid, hostnameOf(), T0 + TTL]);
  const after = budget(t);
  assert.equal(after.advice.length, 1); assert.equal(after.advice[0].heldUsd, 4);
  assert.ok(Math.abs(after.heldUsd - before.heldUsd - 4) < MONEY_EPS, 'held moves by the grant');
  assert.ok(Math.abs(before.availableUsd - after.availableUsd - 4) < MONEY_EPS, 'available moves by the grant');
  assert.equal(lifetimeCapOf(after, 'R@g1').heldByOthersUsd - lifetimeCapOf(before, 'R@g1').heldByOthersUsd, 4, 'a node\'s heldByOthers counts the advice hold');
  assert.deepEqual(after.nodes.map(n => n.key), before.nodes.map(n => n.key), 'no advice row in budget.nodes (AP-3)');
  assert.equal(gateTree(t.rootDir).members.length, 1, 'no advice row in gate.members');
  // the table: a session answer carries its reason; a request is one at a time
  assert.throws(() => hold(t, { adviceId: 'A2', answer: { actor: 'session', via: 'mcp' } }), /reason/);
  assert.throws(() => hold(t, { adviceId: 'A2' }), /one recommendation request at a time/);
  assert.equal(events(t, 'advice_registered').length, 1);
});

test('G2 admission refuses what does not fit: a grant above what the cap has free writes a blocked record and NO advice_registered; so does a hold while a node is active', () => {
  const t = fresh(10);
  const free = budget(t).availableUsd;
  let refused = null; try { hold(t, { grantUsd: free + 0.01 }); } catch (e) { refused = e; }
  assert.equal(events(t, 'advice_registered').length, 0, 'nothing is held (the record is what counts)');
  assert.match(String(refused?.message), /budget/);
  assert.equal(events(t, 'blocked').at(-1).scope, 'advice:A1');
  assert.ok(hold(t, { grantUsd: free }).grantUsd === free, 'exactly what is free is admitted');
  assert.equal(budget(t).availableUsd < MONEY_EPS, true);
});

test('G3 once a call has started, held is the grant\'s REMAINDER: the grant plus its mirrored reservations is not counted twice (available is unchanged by the spend)', () => {
  const t = fresh();
  hold(t);
  const afterHold = budget(t);
  const { capUsd, mirror } = adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  assert.equal(capUsd, 4, 'the call is held to the grant\'s remainder');
  callRun(t, RUN1);
  for (const line of [reservedLine('r1', 1.5, 'advise')]) { lineTo(t, RUN1, line); mirror(line); }
  const g = gateTree(t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  const b = budgetOf(t.rootDir, { gate: g });
  assert.equal(b.advice[0].spentUsd, 1.5); assert.equal(b.advice[0].heldUsd, 2.5);
  assert.ok(Math.abs(b.heldUsd - afterHold.heldUsd + 1.5) < MONEY_EPS, 'held fell by the spend');
  assert.ok(Math.abs(b.treeSpentUsd - afterHold.treeSpentUsd - 1.5) < MONEY_EPS, 'spent rose by the spend');
  assert.ok(Math.abs(b.availableUsd - afterHold.availableUsd) < MONEY_EPS, 'available is the same: the grant is not counted twice');
  const second = adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN2, kind: 'reask', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 2000 });
  assert.ok(Math.abs(second.capUsd - 2.5) < MONEY_EPS, 'the one more ask is held to what is left');
});

test('G4 an advice run goes through the SAME gate as a member: a settled paid call with its mirror passes; the same call without the mirror fails with settlement_not_mirrored', () => {
  const t = fresh();
  hold(t);
  const { mirror } = adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  syntheticRun(t, RUN1, { usage: [{ file: 'advise-a', usd: 0.8, reservationId: 'r1' }] });
  const res = reservedLine('r1', 1, 'advise'); const set = settledLine('r1', 'recorded', 0.8);
  lineTo(t, RUN1, res); lineTo(t, RUN1, set);
  mirror(res);
  assert.equal(gateTree(t.rootDir).problems.some(p => p.code === 'settlement_not_mirrored'), true, 'the settlement is not mirrored yet: the gate says so');
  mirror(set);
  const g = gateTree(t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.ok(Math.abs(g.adviceRuns[0].spentUsd - 0.8) < MONEY_EPS);
});

test('G5 ending releases the unspent part and writes it down; a call cannot be added to an ended request, and a second end is refused', () => {
  const t = fresh();
  hold(t);
  const { mirror } = adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  syntheticRun(t, RUN1, { usage: [{ file: 'advise-a', usd: 1.25, reservationId: 'r1' }] });
  for (const line of [reservedLine('r1', 1.5, 'advise'), settledLine('r1', 'recorded', 1.25)]) { lineTo(t, RUN1, line); mirror(line); }
  const ended = endAdvice(t.rootDir, { adviceId: 'A1', reason: 'settled' }, { now: () => T0 + 5000 });
  assert.deepEqual([ended.reason, ended.returnedUsd], ['settled', 2.75]);
  assert.equal(budget(t).advice[0].heldUsd, 0, 'nothing is held after the end');
  let late = null; try { adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN2, kind: 'reask', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 6000 }); } catch (e) { late = e; }
  assert.equal(events(t, 'advice_run_added').length, 1, 'no call was added to the released hold (the record is what counts)');
  assert.match(String(late?.message), /has ended \(settled\)/);
  assert.throws(() => endAdvice(t.rootDir, { adviceId: 'A1', reason: 'settled' }), /already ended/);
});

test('G6 the wait for the brief\'s approval is bounded: an unanswered request is ended when its expiry passes (not before), by a dead claim as never_started, and NOT while one of its calls is still running; a late approval is refused', () => {
  const t = fresh();
  hold(t);
  assert.deepEqual(reconcileAdvice(t.rootDir, { now: () => T0 + TTL - 1 }), [], 'live claim, not expired: held');
  assert.equal(budget(t).advice[0].heldUsd, 4);
  assert.throws(() => adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + TTL }), /after the wait for it ran out/);
  const out = reconcileAdvice(t.rootDir, { now: () => T0 + TTL });
  assert.deepEqual(out.map(e => [e.reason, e.returnedUsd]), [['expired', 4]]);
  assert.equal(budget(t).advice[0].heldUsd, 0);
  // a dead claim (this host), not expired
  const d = fresh(); hold(d);
  assert.deepEqual(reconcileAdvice(d.rootDir, { now: () => T0 + 1, facts: { pidAlive: () => false } }).map(e => e.reason), ['never_started']);
  // a call that is still running holds the grant even after the expiry
  const r = fresh(); hold(r);
  adviceStart(r.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  assert.deepEqual(reconcileAdvice(r.rootDir, { now: () => T0 + TTL * 2, runStatusOf: () => 'running' }), [], 'the call goes on: its grant stays held');
  assert.deepEqual(reconcileAdvice(r.rootDir, { now: () => T0 + TTL * 2, runStatusOf: () => 'failed' }).map(e => e.reason), ['crashed']);
});

test('G7 a tree cannot be abandoned while a recommendation request is live (unended, claim alive, wait not expired); an expired or dead one does not refuse it', () => {
  const t = fresh(); hold(t);
  const state = stateOf(readTreeRecord(t.rootDir));
  const abandon = { event: 'tree_abandoned', gateId: 'g', shownSha256: SHA, actor: 'person', via: 'terminal' };
  assert.match(transitionRefusal(state, abandon, { nowMs: T0 + 1 }).reason, /recommendation request \(A1\) is still in progress/);
  assert.equal(transitionRefusal(state, abandon, { nowMs: T0 + TTL }), null, 'expired: the reconcile\'s to end, not a reason to refuse');
  assert.equal(transitionRefusal(state, abandon, { nowMs: T0 + 1, pidAlive: () => false }), null, 'a dead claim does not refuse');
});

test('G7b (BUG-B-015) an abandon waits for a request whose CALL still runs, even after the brief wait ran out or the registering process died: the table cannot end the request once the tree is final', () => {
  const t = fresh(); hold(t);
  adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  callRun(t, RUN1);
  const read = () => { const record = readTreeRecord(t.rootDir); return { record, state: stateOf(record) }; };
  const late = { nowMs: T0 + TTL + 1 };                         // the wait for the brief's approval is over; the detached call is not
  const running = () => 'running'; const done = () => 'done';
  // BUG-B-004: the abandon FORM shows the table's refusal for a live claim before the person types (claim alive, wait open, call ended: only liveAdviceOf's half fires)
  const early = abandonRefusal({ rootDir: t.rootDir, ...read(), facts: { nowMs: T0 + 1 }, runStatusOf: done });
  assert.equal(early?.kind, 'live_advice', JSON.stringify(early)); assert.match(early.reason, /recommendation request \(A1\) is still in progress/);
  assert.equal(transitionRefusal(read().state, { event: 'tree_abandoned', gateId: 'g', shownSha256: SHA, actor: 'person', via: 'terminal' }, late), null, 'the table alone lets it through (it cannot see the folder)');
  const refusal = abandonRefusal({ rootDir: t.rootDir, ...read(), facts: late, runStatusOf: running });
  assert.equal(refusal?.kind, 'live_advice', JSON.stringify(refusal)); assert.match(refusal.reason, /a recommendation request \(A1\) is still in progress \(registered by pid \d+ on .+\): a tree cannot be abandoned while one is/);
  const dead = abandonRefusal({ rootDir: t.rootDir, ...read(), facts: { ...late, pidAlive: () => false }, runStatusOf: running });
  assert.equal(dead?.kind, 'live_advice', 'the registering process is gone but the call runs: still held');
  assert.throws(() => abandonTree(t.rootDir, { gateId: 'g', shownSha256: SHA, actor: 'person', via: 'terminal' }, { facts: late, now: () => T0 + TTL + 1, runStatusOf: running }), /recommendation request \(A1\) is still in progress/);
  assert.ok(!stateOf(readTreeRecord(t.rootDir)).abandoned, 'nothing was abandoned');
  // known-good controls: the call has ended, so the abandon is not held by the request; and the request can still be ended afterwards because the tree is not final
  assert.equal(abandonRefusal({ rootDir: t.rootDir, ...read(), facts: late, runStatusOf: done }), null);
  assert.equal(abandonRefusal({ rootDir: t.rootDir, ...read(), facts: late, runStatusOf: () => 'awaiting_approval' }), null, 'a call never sent is not running');
});

test('G8 a call whose folder exists but holds only the approval gate\'s files (no run.json yet: the brief waits for its approval) does NOT fail the gate; once its run.json is there the usual run checks apply to it', () => {
  const t = fresh(); hold(t);
  adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  const dir = join(t.runsDir, RUN1); mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'advice-brief.md'), 'the brief, waiting for its approval\n');
  const g = gateTree(t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(g.adviceRuns.length, 1);
});

test('G9 an unanswered hold is released WITHOUT anyone asking: the next admission ends an expired request in the same hold and then admits; a recovery pass ends it too (no call, expiry passed); a request with a call is left to reconcileAdvice', async () => {
  const t = fresh(); hold(t);
  let second = null; let failed = null;
  try { second = registerAdviceAdmitted(t.rootDir, { adviceId: 'A2', grantUsd: 5, stopId: 'e9', gateId: 'g-grant2', shownSha256: SHA, answer, ttlMs: TTL }, { now: () => T0 + TTL + 1 }); } catch (e) { failed = e; }
  assert.deepEqual(events(t, 'advice_ended').map(e => [e.adviceId, e.reason, e.returnedUsd]), [['A1', 'expired', 4]], 'the expired hold was ended first (the record is what counts)');
  assert.equal(failed, null, String(failed?.message));
  assert.equal(second.adviceId, 'A2');
  // recovery: an unanswered request whose wait ran out
  const { recoverTree } = await import('../src/tree-recovery.js');
  const r = fresh(); hold(r);
  await recoverTree(r.rootDir, { runFactsOf: () => ({ hasRunJson: true, end: null, paused: false }), facts: { nowMs: T0 + TTL } });
  assert.deepEqual(events(r, 'advice_ended').map(e => [e.reason, e.returnedUsd]), [['expired', 4]]);
  assert.equal(budgetOf(r.rootDir).advice[0].heldUsd, 0);
  // a request WITH a call is not recovery's
  const c = fresh(); hold(c);
  adviceStart(c.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  await recoverTree(c.rootDir, { runFactsOf: () => ({ hasRunJson: true, end: null, paused: false }), facts: { nowMs: T0 + TTL * 3 } });
  assert.equal(events(c, 'advice_ended').length, 0, 'its call may still be running: reconcileAdvice decides');
});

test('G10 an unreadable report.json of an advice run can be accepted the way a member\'s can: the table does not call its run "not a member of this tree"', () => {
  const t = fresh(); hold(t);
  adviceStart(t.rootDir, { adviceId: 'A1', runId: RUN1, kind: 'first', briefSha256: SHA, shownSha256: SHA }, { now: () => T0 + 1000 });
  const state = stateOf(readTreeRecord(t.rootDir));
  const accept = runId => transitionRefusal(state, { event: 'accounting_accepted', reservationIds: [`${runId}:report.json`], unreadableReports: [{ runId, figureUsd: 1, files: [] }] });
  assert.equal(accept(RUN1), null);
  assert.match(accept('2026-10-20T13-00-00-000Z').reason, /not a member of this tree/);
});
