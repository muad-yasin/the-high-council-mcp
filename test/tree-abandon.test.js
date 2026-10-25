// 0.8.3 M6 ROADMAP 57, commit 1 (the RECORD side; contract Review/Build_0.8.3/m6-closing/ROADMAP57_Tree_Abandon_Contract.md, gate 1 and C&C's departures of 13 Oct 2026): `tree_abandoned` is a typed event written by ONE function
// (src/tree-abandon.js abandonTree); the fold retires the open stops, lifts the root and parent blocks and releases every held era; the table refuses every later event but the three plain records, with ONE sentence; budgetOf holds
// nothing afterwards; recoverTree writes nothing to a final tree. DA-1 (table + fold), DA-2 (money), DA-7 (deadKeys/orphansOf unchanged), DA-8 (blocks, sitting lock), DA-11 (held era released) and the single-writer scan (DA-10, the
// record half). Fold units are raw events like test/tree-held-state.test.js; the writer, money and recovery tests run on a REAL tree (the same helpers as test/tree-status.test.js). Nothing here calls a model: all $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { abandonRefusal, abandonTree, abandonedSentence, treeFinalRefusal } from '../src/tree-abandon.js';
import { SITTING_LOCK_FILE } from '../src/tree-files.js';
import { acquireRunLock } from '../src/run-lock.js';
import { EVENTS_SCHEMA, EVENT_NAMES, deadKeys, eventShapeError, foldRecord, heldKeys, orphansOf, transitionRefusal } from '../src/tree-transitions.js';
import { EVENTS_FILE, TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';
import { recoverTree } from '../src/tree-recovery.js';
import { registerNextChild } from '../src/tree-loop.js';
import { GATE_FIELDS, claim, hostnameOf } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending } from './helpers/sitting.js';

const G = GATE_FIELDS;
const AT = '2026-10-13T08:00:00.000Z';
const ABANDON = { id: 'e90', event: 'tree_abandoned', at: AT, ...G };
const runFor = (n, g) => (n === 'R' && g === 1 ? 't' : `run-${n.replace(/\//g, '-')}-${g}`);
const reg = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: runFor(n, g), attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 4, unit: 'usd' } });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: 'f'.repeat(64), frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', frontierKey: fk, revision: 1, ...G, boundSha256: 'f'.repeat(64) }];
const started = (id, n, g, extra = {}) => ({ id, event: 'node_started', node: n, generation: g, runId: runFor(n, g), pid: 1, host: 'h', ...extra });
const closed = (id, n, g, extra = {}) => ({ id, event: 'node_closed', node: n, generation: g, runId: runFor(n, g), outcome: 'passed', passed: true, status: null, share: 'released', ...extra });
const stopped = (id, n, g) => ({ id, event: 'node_stopped', node: n, generation: g, runId: runFor(n, g), reason: 'budget' });
const split = (id, n, children) => ({ id, event: 'split_verified', node: n, generation: 1, runId: runFor(n, 1), splitSha256: 's', children });
const stop = (id, n, g) => ({ id, event: 'needs_decision_opened', node: n, generation: g, runId: runFor(n, g), source: 'node_closed', affected: [{ node: n, generation: g }] });

// the held-state fixture of test/tree-held-state.test.js: R closed (needs_decision); R/M1 closed passed with a closed passed child R/M1/M1; R/M2 closed (needs_decision); R/M3 stopped at its cap
const TREE = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, { status: 'needs_decision' }),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }, { node: 'R/M3', generation: 1 }], 'e3'),
  { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1), split('e4v', 'R/M1', ['R/M1/M1']),
  ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e5'), { id: 'e6', ...reg('R/M1/M1', 1, 'R/M1', 'kB') }, started('e6b', 'R/M1/M1', 1), closed('e6c', 'R/M1/M1', 1),
  { id: 'e7', ...reg('R/M2', 1, 'R', 'kA') }, started('e7b', 'R/M2', 1), closed('e7c', 'R/M2', 1, { status: 'needs_decision' }),
  { id: 'e8', ...reg('R/M3', 1, 'R', 'kA') }, started('e8b', 'R/M3', 1), stopped('e8c', 'R/M3', 1)];
const ROOT_STOP = stop('e9', 'R', 1);
const decide = affected => ({ id: 'e10', event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: 'e9', replansRoot: true, affected, ...G });
const OPEN = { id: 'e11', event: 'generation_opened', decisionId: 'e10', nodes: [{ node: 'R', generation: 2 }] };
const keys = (...ks) => ks.map(k => ({ node: k.split('@g')[0], generation: Number(k.split('@g')[1]) }));
const REPLAN = [ROOT_STOP, decide(keys('R@g1', 'R/M2@g1', 'R/M3@g1')), OPEN];
const why = (state, event, facts) => transitionRefusal(state, { id: 'e99', ...event }, facts)?.reason ?? null;

test('DA-1 the event: it is shaped (both gate fields), accepted at a tree with nothing alive, refused without a hash, and the fold records who/when/what it retired', () => {
  assert.match(eventShapeError({ schema: EVENTS_SCHEMA, id: 'e5', event: 'tree_abandoned', at: AT, gateId: 'g' }) ?? '', /shownSha256/);
  assert.match(eventShapeError({ schema: EVENTS_SCHEMA, id: 'e5', event: 'tree_abandoned', at: AT, shownSha256: 'a'.repeat(64) }) ?? '', /gateId/);
  assert.equal(eventShapeError({ schema: EVENTS_SCHEMA, ...ABANDON }), null);
  const before = foldRecord([...TREE, ROOT_STOP]);
  assert.equal(before.abandoned, null, 'null for every record before it');
  assert.equal(why(before, { event: 'tree_abandoned', ...G }), null, 'accepted: R/M3 is stopped at its cap, nothing is alive');
  assert.match(why(before, { event: 'tree_abandoned', gateId: 'g', shownSha256: 'not-hex' }) ?? '', /decision.*gate that was typed/);
  const after = foldRecord([...TREE, ROOT_STOP, ABANDON]);
  assert.deepEqual(after.abandoned, { eventId: 'e90', at: AT, gateId: G.gateId, shownSha256: G.shownSha256, retiredStops: ['e9'] });
  assert.deepEqual(after.openStops, [], 'the open stop is retired');
});

test('DA-1 live members refuse it (known-bad control: a live claim DOES, a dead one does NOT); another host\'s claim is never judged dead; registered-never-started and stopped nodes do not refuse', () => {
  const alive = { pidAlive: () => true }; const dead = { pidAlive: () => false };
  const withRunning = (extra = {}) => foldRecord([...TREE, { id: 'e30', ...reg('R/M4', 1, 'R', 'kA') }, started('e31', 'R/M4', 1, { pid: process.pid, host: hostnameOf(), ...extra })]);
  assert.match(why(withRunning(), { event: 'tree_abandoned', ...G }, alive) ?? '', /R\/M4@g1 still has a live claim \(pid \d+ on /);
  assert.equal(why(withRunning(), { event: 'tree_abandoned', ...G }, dead), null, 'a DEAD claim does not stop it');
  assert.match(why(withRunning({ host: 'elsewhere' }), { event: 'tree_abandoned', ...G }, dead) ?? '', /live claim/, 'another host\'s claim is never judged dead from here');
  const registeredOnly = foldRecord([...TREE, { id: 'e30', ...reg('R/M4', 1, 'R', 'kA') }]);
  assert.equal(why(registeredOnly, { event: 'tree_abandoned', ...G }, alive), null, 'registered and never started');
  const postRun = foldRecord([...TREE, { id: 'e40', event: 'node_resumed', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), pid: process.pid, host: hostnameOf(), purpose: 'post_run' }]);
  assert.match(why(postRun, { event: 'tree_abandoned', ...G }, alive) ?? '', /still has a live post-run call/);
  const released = foldRecord([...TREE, { id: 'e40', event: 'node_resumed', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), pid: process.pid, host: hostnameOf(), purpose: 'post_run' }, { id: 'e41', event: 'node_released', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), reason: 'post_run_done' }]);
  assert.equal(why(released, { event: 'tree_abandoned', ...G }, alive), null, 'a released post-run call does not');
});

test('DA-1 after it, the table refuses EVERY other event with the ONE sentence (the accounting check included) and allows exactly blocked, guard_refused and reservation_mirrored; a second abandon is refused', () => {
  const state = foldRecord([...TREE, ROOT_STOP, ABANDON]);
  const sentence = abandonedSentence(state);
  assert.match(sentence, /abandoned by a person \(event e90, 2026-10-13T08:00:00\.000Z\)\. It is final/);
  // OLD: exactly blocked, guard_refused, reservation_mirrored. NEW (ROADMAP 77): + advice_reservation_mirrored, the same mirrored-line record for a recommendation's run. WHY: an advice run settles after the tree is final the way a member does; the abandon is refused while one is live, so the line is a late record, not a decision.
  const allowed = ['blocked', 'guard_refused', 'reservation_mirrored', 'advice_reservation_mirrored'];
  for (const name of EVENT_NAMES.filter(n => !allowed.includes(n))) assert.equal(why(state, { event: name }), sentence, `${name} is refused with the abandoned sentence`);
  for (const name of allowed) assert.equal(why(state, { event: name }), null, `${name} stays allowed (a record of a refused request, a guard fact, a mirrored line)`);
  assert.equal(why(state, { event: 'accounting_accepted', reservationIds: ['x:y'], unreadableReports: [{ runId: 'not-a-member' }] }), sentence, 'the unreadable-report check does not answer first: an abandoned tree gets the abandoned sentence');
  assert.equal(why(state, { event: 'tree_abandoned', ...G }), sentence, 'a second abandon');
  assert.equal(treeFinalRefusal(state), sentence); assert.equal(treeFinalRefusal(foldRecord([...TREE, ROOT_STOP])), null);
});

test('DA-8 the sticky blocks do not refuse an abandon, and the abandon clears them (root_affected and parent_changed)', () => {
  const blocked = [...TREE, ROOT_STOP, { id: 'e50', event: 'blocked', reason: 'root_affected', scope: 'tree', stopId: 'e9' }, { id: 'e51', event: 'blocked', reason: 'parent_changed', scope: 'tree', frontierKey: 'kA' }];
  const before = foldRecord(blocked);
  assert.ok(before.sticky.has('root_affected') && before.sticky.has('parent_changed'), 'known-bad control: the blocks stand before the abandon');
  assert.equal(why(before, { event: 'tree_abandoned', ...G }), null, 'neither block refuses it');
  const after = foldRecord([...blocked, ABANDON]);
  assert.equal(after.sticky.size, 0, 'the abandon lifts both');
  assert.equal(after.parentBlocks.size, 0);
});

test('DA-7 an abandon makes nobody dead for a new reason: deadKeys and orphansOf are equal before and after on a re-planned tree with NO held node', () => {
  // R/M1 stopped too: every child is ineligible, so the root re-plan holds nothing
  const everyChildDead = [ROOT_STOP, decide(keys('R@g1', 'R/M1@g1', 'R/M1/M1@g1', 'R/M2@g1', 'R/M3@g1')), OPEN];       // the decision of a tree whose every child failed ITSELF marks all of them
  const noHeld = [...TREE.filter(e => !['e4c'].includes(e.id)), stopped('e4x', 'R/M1', 1), ...everyChildDead];
  const before = foldRecord(noHeld); const after = foldRecord([...noHeld, ABANDON]);
  assert.equal(heldKeys(before).size, 0, 'the fixture holds nothing');
  assert.deepEqual([...deadKeys(after)].sort(), [...deadKeys(before)].sort());
  assert.deepEqual([...orphansOf(after)].sort(), [...orphansOf(before)].sort());
  assert.ok(deadKeys(before).size > 0, 'the comparison is not empty');
});

test('DA-11 the HELD era is released by the abandon: heldKeys is empty, the formerly held nodes are dead through the orphan clause, nothing else changes', () => {
  const before = foldRecord([...TREE, ...REPLAN]); const after = foldRecord([...TREE, ...REPLAN, ABANDON]);
  assert.deepEqual([...heldKeys(before)].sort(), ['R/M1/M1@g1', 'R/M1@g1'], 'known-bad control: held before');
  assert.equal(heldKeys(after).size, 0);
  for (const k of ['R/M1@g1', 'R/M1/M1@g1', 'R@g1', 'R/M2@g1', 'R/M3@g1']) assert.ok(deadKeys(after).has(k), `${k} is dead after the abandon`);
  assert.deepEqual([...orphansOf(after)].sort(), [...orphansOf(before)].sort(), 'orphansOf is equal in every case');
  assert.deepEqual([...deadKeys(after)].filter(k => !deadKeys(before).has(k)).sort(), ['R/M1/M1@g1', 'R/M1@g1'], 'deadKeys grows by exactly the held nodes the abandon releases');
  assert.equal(why(after, { event: 'held_released', reason: 'no_children', nodes: ['R/M1@g1'] }), abandonedSentence(after), 'held_released stays refused after an abandon');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- a REAL tree
async function realTree() {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  const reg1 = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg1.kind, 'registered');
  return { r, rootDir: r.t.rootDir, child: reg1 };
}
const eventsOf = rootDir => readTreeRecord(rootDir).events;

test('DA-2 money: a registered-never-started child holds its grant before the abandon and nothing after; the spend stays counted; the tree\'s money is otherwise unchanged', async () => {
  const { rootDir } = await realTree();
  const before = budgetOf(rootDir); const gateBefore = gateTree(rootDir);
  const child = before.nodes.find(n => !n.isRoot);
  assert.ok(child.heldUsd > 0 && before.heldUsd > 0, 'known-bad control: the tree holds the child\'s grant before the abandon');
  abandonTree(rootDir, G, { now: () => Date.parse(AT) });
  const after = budgetOf(rootDir); const gateAfter = gateTree(rootDir);
  assert.equal(after.heldUsd, 0); assert.ok(after.nodes.every(n => n.heldUsd === 0));
  assert.equal(after.treeSpentUsd, before.treeSpentUsd, 'the spend stays counted');
  assert.deepEqual(after.nodes.map(n => [n.key, n.spentUsd, n.grantUsd]), before.nodes.map(n => [n.key, n.spentUsd, n.grantUsd]));
  assert.equal(after.availableUsd, after.rootCapUsd - after.treeSpentUsd - after.unknownSpendHeldUsd);
  assert.equal(gateAfter.treeSpentUsd, gateBefore.treeSpentUsd); assert.equal(gateAfter.members.length, gateBefore.members.length);
  // NOT EXERCISED HERE: R9's charge for a closed node whose spend nobody can read (unknownSpendHeldUsd). This tree has none (both figures are 0), so the line below proves nothing about R9; the claim rests on the diff: the abandon adds one term to heldUsd and the unreturnedUsd line is untouched.
  assert.equal(after.unknownSpendHeldUsd, before.unknownSpendHeldUsd);
});

test('the writer: it appends ONE tree_abandoned that carries the gate, the record ENDS with it, a second abandon throws and writes nothing, and the fold names the retired stops', async () => {
  const { rootDir } = await realTree();
  const n0 = eventsOf(rootDir).length;
  const rec = abandonTree(rootDir, G, { now: () => Date.parse(AT) });
  assert.equal(rec.event, 'tree_abandoned'); assert.equal(rec.gateId, G.gateId); assert.equal(rec.shownSha256, G.shownSha256);
  const events = eventsOf(rootDir);
  assert.equal(events.length, n0 + 1); assert.equal(events.at(-1).event, 'tree_abandoned', 'no readiness or other event follows');
  assert.equal(stateOf(readTreeRecord(rootDir)).abandoned.eventId, rec.id);
  assert.throws(() => abandonTree(rootDir, G), e => e instanceof TreeRefusal && /abandoned by a person/.test(e.reason ?? e.message));
  assert.equal(eventsOf(rootDir).length, n0 + 1, 'a refusal on a final tree writes nothing');
  assert.throws(() => abandonTree(rootDir, { gateId: '', shownSha256: 'x' }), TypeError, 'gate fields are required');
});

test('the writer refuses a live member (a blocked record is written; a dead claim does not refuse) and a running sitting (the lock), and succeeds once the lock is released', async () => {
  const live = await realTree();
  appendTreeEvent(live.rootDir, { event: 'node_started', ...claim(live.child.node, live.child.runId, process.pid, 1, hostnameOf()) });
  const n0 = eventsOf(live.rootDir).length;
  assert.throws(() => abandonTree(live.rootDir, G), e => e instanceof TreeRefusal && /still has a live claim/.test(e.reason ?? e.message));
  const tail = eventsOf(live.rootDir).slice(n0);
  assert.deepEqual(tail.map(e => [e.event, e.reason, e.check]), [['blocked', 'continuation_refused', 'abandon']], 'exactly one blocked record, no tree_abandoned');
  assert.equal(stateOf(readTreeRecord(live.rootDir)).abandoned, null);
  abandonTree(live.rootDir, G, { facts: { pidAlive: () => false } });
  assert.ok(stateOf(readTreeRecord(live.rootDir)).abandoned, 'known-bad control: the SAME tree with the claim\'s process gone is abandoned');
  const locked = await realTree();
  const release = acquireRunLock(treeDirOf(locked.rootDir), { file: SITTING_LOCK_FILE });
  try {
    assert.throws(() => abandonTree(locked.rootDir, G), e => e instanceof TreeRefusal && /a sitting of tree .* is running \(pid \d+/.test(e.reason ?? e.message));
    assert.equal(stateOf(readTreeRecord(locked.rootDir)).abandoned, null);
  } finally { release(); }
  abandonTree(locked.rootDir, G);
  assert.ok(stateOf(readTreeRecord(locked.rootDir)).abandoned, 'once the sitting is over');
});

test('abandonRefusal: a damaged record writes nothing and names the way out; a tree whose start was never recorded names `council tree resume`', async () => {
  const { rootDir } = await realTree();
  const file = join(treeDirOf(rootDir), EVENTS_FILE);
  appendFileSync(file, 'this line is not json\n');
  const bytes = readFileSync(file, 'utf8');
  assert.throws(() => abandonTree(rootDir, G), e => e instanceof TreeRefusal && /damaged line.*restore the damaged line from a backup, or start a new tree/.test(e.reason ?? e.message));
  assert.equal(readFileSync(file, 'utf8'), bytes, 'nothing was appended to a damaged record');
  const notStarted = abandonRefusal({ rootDir: '/runs/2026-10-08T11-00-00-000Z', record: { corrupt: [] }, state: foldRecord([]) });
  assert.equal(notStarted.kind, 'not_started'); assert.match(notStarted.reason, /run `council tree resume 2026-10-08T11-00-00-000Z` first/);
});

test('recoverTree writes NOTHING to an abandoned tree, also inside the crash window of a root re-plan (a decision_recorded with no generation_opened); the same record without the abandon IS finished (known-bad control)', async () => {
  const unopened = { schema: EVENTS_SCHEMA, id: null, event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', replansRoot: true, affected: keys('R@g1'), ...G, at: AT };
  const plant = rootDir => { const n = eventsOf(rootDir).length + 1; appendFileSync(join(treeDirOf(rootDir), EVENTS_FILE), `${JSON.stringify({ ...unopened, id: `e${n}` })}\n`); };
  const control = await realTree(); plant(control.rootDir);
  const done = await recoverTree(control.rootDir, { runFactsOf: () => ({}) });
  assert.ok(done.applied.some(a => a.event?.event === 'generation_opened'), 'control: the interrupted re-plan is finished');
  const final = await realTree(); plant(final.rootDir);
  abandonTree(final.rootDir, G);
  const bytes = readFileSync(join(treeDirOf(final.rootDir), EVENTS_FILE), 'utf8');
  const out = await recoverTree(final.rootDir, { runFactsOf: () => ({}) });
  assert.deepEqual(out, { applied: [], pending: [] });
  assert.equal(readFileSync(join(treeDirOf(final.rootDir), EVENTS_FILE), 'utf8'), bytes, 'byte-identical: no generation_opened, no blocked line');
});

test('DA-10 (the record half): only src/tree-abandon.js appends a tree_abandoned event', () => {
  const dir = new URL('../src/', import.meta.url);
  const writers = readdirSync(dir).filter(f => f.endsWith('.js') && /event:\s*['"]tree_abandoned['"]/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(writers, ['tree-abandon.js']);
});
