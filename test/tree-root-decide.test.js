// 0.8.3 M6 S8-4 (rulings row 130; design note 8.1 with the round-2 wording; ledger of C&C 12 Oct): the decide form on a ROOT stop - `council tree decide <root> [--stop <id>]` answers a stop of the root with a NEW ROOT plan. The preconditions refuse BEFORE the
// person types (src/tree-root-replan.js + the unverified-split guard); the gate text lists what is set aside and what is HELD; ONE lock hold writes the decision (replansRoot, exactly R@g + the nodes that cannot be held) and its generation_opened; what
// the person was shown is what is recorded (the form is rebuilt after the approval, and the set is re-checked under the lock). Real flow: trackedRealRoot (a real root run, so split_verified carries `children`), the real verb, the real gate. All-mock, $0.
// The window "decided, not registered yet" is dev-only until S8-5 (the frontier, `council tree approve`, the registration), which follows straight after; nothing else lands between them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { acquireRunLock } from '../src/run-lock.js';
import { SITTING_LOCK_FILE, runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { buildStopDecision } from '../src/tree-decide-stop.js';
import { deadKeys, heldKeys } from '../src/tree-transitions.js';
import { readinessOf } from '../src/tree-ready.js';
import { registerNextChild } from '../src/tree-loop.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 8000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
// a real root whose first child R/M1 ran to the end (closed, passed, a leaf: eligible), then a stop on the root
async function rootWithFinishedChild() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.equal(out.started.length, 1, JSON.stringify(out.started));
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  return { r, stop };
}

test('THE FLOW (real verbs, real gate): a decision on the root stop records ONE decision that lists exactly R@g1 + what cannot be held, and its generation_opened in the same hold; R/M1 (finished and passed) is HELD, readiness names the way on (generation_pending, ROOT wording), the text shown is the text bound', async () => {
  const { r, stop } = await rootWithFinishedChild();
  const typed = 'Plan it again, offline store first.\n```\na fence of the person\'s own\n```';
  const d = decide(r, { stop: stop.id }, [`${typed}\n.`, stop.id, 'y']);
  const code = await d.run();
  assert.equal(code, 0, d.io.shown() + d.io.errors());
  const shown = d.io.shown();
  for (const needle of ['Answer stop', '(re-plan the root)', typed, 'SET ASIDE from now on', '  - R@g1', 'HELD (1 node in 1 run: finished and passed;', '  - R/M1@g1', 'Nothing is started by this decision.', `council tree approve ${ROOT_ID}`, 'The root cap ($100.00) does not change.', 'The task file is not changed:', `To approve, type the stop id: ${stop.id}`]) assert.ok(shown.includes(needle), `the gate text has: ${needle}\n${shown}`);
  const events = eventsOf(r); const dec = events.find(e => e.event === 'decision_recorded'); const open = events.find(e => e.event === 'generation_opened');
  assert.equal(dec.replansRoot, true); assert.equal(dec.form, 'regenerate'); assert.equal(dec.stopId, stop.id); assert.equal(dec.text, typed, 'the typed bytes, verbatim');
  assert.deepEqual(dec.affected, [{ node: 'R', generation: 1 }]);
  assert.deepEqual(open.nodes, [{ node: 'R', generation: 2 }]); assert.equal(open.decisionId, dec.id);
  assert.equal(Number(open.id.slice(1)), Number(dec.id.slice(1)) + 1, 'ONE hold: the two events are consecutive, nothing between');
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual([...heldKeys(state)], ['R/M1@g1']); assert.ok(deadKeys(state).has('R@g1')); assert.equal(deadKeys(state).has('R/M1@g1'), false);
  assert.equal(state.openStops.includes(stop.id), false, 'the stop is answered');
  const v = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.notEqual(v.verdict, 'ready'); assert.equal(v.reasons.length, 1);
  assert.deepEqual([v.reasons[0].code, v.reasons[0].scope], ['generation_pending', 'R@g1']);
  assert.equal(v.reasons[0].text, `R: a new root plan (R@g2) was decided and its run is not registered yet: run \`council tree approve ${ROOT_ID}\``);
});

test('BEFORE ANYTHING IS TYPED the form refuses: a sitting runs; a node is active; a closed passed node has a split that is not verified yet - each with its own sentence, nothing asked, nothing written', async () => {
  const { r, stop } = await rootWithFinishedChild();
  const before = readTreeRecord(r.t.rootDir).events.length;
  // a sitting runs: the sitting lock is held by this process
  const release = acquireRunLock(treeDirOf(r.t.rootDir), { file: SITTING_LOCK_FILE });
  try { const d = decide(r, { stop: stop.id }, []); assert.equal(await d.run(), 1); assert.match(d.io.errors(), /a sitting of this tree is running/); assert.equal(d.io.shown(), ''); } finally { release(); }
  // a sitting that CRASHED leaves its lock file behind: a dead pid on this host is stale (lockHolder), not a sitting that runs - the form must not be locked out for good (a hard lock)
  { const lock = join(treeDirOf(r.t.rootDir), SITTING_LOCK_FILE); writeFileSync(lock, JSON.stringify({ pid: 2147483646, host: hostname(), at: new Date().toISOString() }));
    const d = decide(r, { stop: stop.id }, []); assert.equal(await d.run(), 1); assert.doesNotMatch(d.io.errors(), /a sitting of this tree is running/, 'a stale lock is not a running sitting'); assert.match(d.io.errors(), /the input ended before the closing line/, 'the form went on to ask for the text'); }
  // a node is active (registered, not started): the pricedChildren fixture has more children to register
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  { const d = decide(r, { stop: stop.id }, []); assert.equal(await d.run(), 1); assert.match(d.io.errors(), /is registered|is active|registered and not started/); assert.match(d.io.errors(), /council tree decide --close/); assert.equal(d.io.shown(), ''); }
  assert.equal(readTreeRecord(r.t.rootDir).events.length, before + 1, 'only the registration: the refusals wrote nothing');
  // a closed, passed node whose plan holds a split block that no split_verified names: the real root, NOT verified
  const u = await trackedRealRoot({ verify: false });
  appendTreeEvent(u.t.rootDir, STOP);
  { const d = decide(u, {}, []); assert.equal(await d.run(), 1); assert.match(d.io.errors(), /R@g1 has a split that is not verified yet \(the sitting verifies it first\): run `council tree resume /); assert.equal(d.io.shown(), ''); }
});

test('WHAT WAS SHOWN IS WHAT IS RECORDED: the set the form listed is re-checked UNDER THE LOCK - a node that opened a stop between the screen and the lock changes the set, the apply is refused ("changed while you read") and nothing is recorded; --obligation does not combine with a new root plan', async () => {
  const { r, stop } = await rootWithFinishedChild();
  const built = buildStopDecision({ rootDir: r.t.rootDir, rootId: ROOT_ID, form: 'regenerate', stopArg: stop.id, decisionText: 'Plan it again.', work: r.t.work, sittingHeld: () => false });
  assert.equal(built.refusal, undefined, built.refusal); assert.ok(built.text.includes('  - R/M1@g1'), 'R/M1 is shown as HELD');
  const n0 = readTreeRecord(r.t.rootDir).events.length;
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId, source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] });
  assert.throws(() => built.apply({ gateId: 'g', shownSha256: '0'.repeat(64) }), e => e.name === 'TreeRefusal' && /the nodes that cannot be held changed while you read/.test(e.reason));
  assert.equal(readTreeRecord(r.t.rootDir).events.length, n0 + 1, 'only the stop the test appended: no decision, no generation');
  // and the form built NOW lists R/M1 as set aside (its own stop is open)
  const again = buildStopDecision({ rootDir: r.t.rootDir, rootId: ROOT_ID, form: 'regenerate', stopArg: stop.id, decisionText: 'x', work: r.t.work, sittingHeld: () => false });
  assert.ok(/SET ASIDE[\s\S]*- R\/M1@g1[\s\S]*HELD \(0 nodes/.test(again.text), again.text);
  const ob = buildStopDecision({ rootDir: r.t.rootDir, rootId: ROOT_ID, form: 'regenerate', stopArg: stop.id, obligationArg: 'R@g1:C1', decisionText: 'x', work: r.t.work, sittingHeld: () => false });
  assert.match(ob.refusal ?? '', /--obligation does not combine with a new root plan/);
  assert.throws(() => buildStopDecision({ rootDir: r.t.rootDir, rootId: ROOT_ID, form: 'regenerate', stopArg: stop.id, decisionText: 'x' }), /needs `work` and `sittingHeld`/, 'the two inputs cannot be forgotten');
});
