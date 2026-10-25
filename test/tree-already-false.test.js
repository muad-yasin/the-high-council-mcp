import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/api.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { affectedFor } from '../src/tree-affected.js';
import { bundleDirOf, deadRefusal } from '../src/tree-continuation.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { memberRefusalLine } from '../src/tree-handoff.js';
import { budgetOf } from '../src/tree-budget.js';
import { clearStop, requestStop, runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { deadKeys, foldRecord, heldKeys, orphansOf, transitionRefusal } from '../src/tree-transitions.js';
import { closeRefusal } from '../src/tree-close.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { FIXTURE_BOUND, ROOT_ID } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';
import { registerNextChild, chooseNextChild } from '../src/tree-loop.js';
import { frontierReopened } from '../src/tree-frontier.js';
// 0.8.3 already-false unit (Builder C, 23 Okt 2026; plan note Review/Build_0.8.3/m8/C_AlreadyFalse_Plan_2026-10-23.md): sentences and readers that stayed false for a node whose plan was REPLACED (dead) or for a planned child that never registered.
// DRIVER A (no hand-written stop or decision record): the QB3 shape of test/tree-decide-accept.test.js:294. A real tree, the first child of R/M1 registers and the stop marker lands right there, the person edits R/M1's plan, a sitting opens the blocked-child stop itself
// (openBlockedChildStops: `affected` is the real affectedFor), `decide` answers it with the regenerate form, a sitting opens the generation, and the registered never-started children of R/M1@g1 are dead. All-mock, $0.
// WHAT THESE TESTS DO NOT DRIVE (said plainly, 24 Okt 2026): `approvePending` (test/helpers/sitting.js) is the shared stand-in for `council tree approve`: it appends frontier_previewed and frontier_approved by hand and skips the approval gate, so NO test here drives `tree approve`; registration goes through `registerNextChild`, the sitting's own step; the K1 stop record is written by the fixture (the stoppedWithChild shape), the real writer detectStops has no fixture; the M1 control and DEAD WORDS are pure folds on raw events.

// R/M1 finished with REGISTERED children, none started (the sitting that registered the first one stopped right there): a local copy of tree-decide-accept.test.js's notStartedTree, as tree-bundle-rebuild.test.js keeps one.
async function notStartedTree(opts = {}) {
  const r = await trackedRealRoot({ ...splitChildren(), ...opts });
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, hooks: { afterRegister: next => { if (next.kind === 'registered' && next.node.startsWith('R/M1/')) requestStop(r.t.rootDir); } } });
  return { r, start };
}
const nodesOf = r => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()];
const planFile = (r, node) => join(r.t.runsDir, nodesOf(r).find(x => x.node === node).runId, 'deliverable.md');
const sit = (r, start) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
const stopsOf = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const decide = async (r, flags, answers) => {
  const io = terminal(answers); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, shown: io.shown().replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''), errors: io.errors() };
};
/** The plan of R/M1 is edited, a sitting opens the blocked-child stop, and the person is shown the regenerate form; `through` also types the decision, so the stop is answered. */
async function stopOnM1(r, start) {
  // the edit QB3 makes (tree-decide-accept.test.js:294), the one proven on this base: the regenerate's size check counts the earlier plan's bytes, so a longer plan could move this fixture over its allowance
  const before = readFileSync(planFile(r, 'R/M1'), 'utf8'); const after = before.replace('A plan.', 'A plan, changed.');
  assert.notEqual(after, before, 'the edit changed the plan file');
  writeFileSync(planFile(r, 'R/M1'), after);
  await sit(r, start);
  const stop = stopsOf(r, 'R/M1').at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'a stop is open for R/M1');
  return stop;
}
/** The QB3 steps up to the generation being opened: the registered, never-started children of R/M1@g1 are DEAD (orphans). */
async function deadChildren(r, start) {
  const stop = await stopOnM1(r, start);
  const out = await decide(r, { stop: stop.id }, ['Rewrite the overview.\n.', stop.id, 'y']);
  assert.equal(out.code, 0, out.errors);
  clearStop(r.t.rootDir);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const state = stateOf(readTreeRecord(r.t.rootDir)); const dead = deadKeys(state);
  const old = [...state.nodes.values()].filter(n => n.node.startsWith('R/M1/') && n.generation === 1 && n.phase === 'registered');
  assert.ok(old.length >= 1 && old.every(n => dead.has(`${n.node}@g${n.generation}`)), `the old children are dead: ${[...dead].join(', ')}`);
  return old.map(n => `${n.node}@g${n.generation}`);
}

test('M3: the amend-cap screen does not list a dead registered node, which never starts, among "the nodes that hold money or wait for it"', { timeout: 900_000 }, async () => {
  const { r, start } = await notStartedTree();
  const dead = await deadChildren(r, start);
  const cap = budgetOf(r.t.rootDir).rootCapUsd; const to = String(Math.ceil(cap) + 10);
  const out = await decide(r, { 'amend-cap': to }, [to, 'y']);
  assert.equal(out.code, 0, out.shown + out.errors);
  assert.match(out.shown, /The nodes that hold money or wait for it:/);
  for (const k of dead) assert.doesNotMatch(out.shown, new RegExp(`${k.replace(/[/@]/g, '\\$&')}: registered`), `${k} is dead and holds nothing: it is not listed`);
});

const esc = text => text.replace(/[.*+?^${}()|[\]\\/@]/g, '\\$&');
test('M1: `decide --close` REFUSES a dead registered node that has not started (nothing is asked or written), where it used to show "Closing gives $G back ... available A -> A+G" for a grant its replacement had already returned', { timeout: 900_000 }, async () => {
  const { r, start } = await notStartedTree();
  const dead = await deadChildren(r, start);
  const key = dead[0];
  const events0 = eventsOf(r).length;
  const out = await decide(r, { close: key }, []);
  // Exit 1 alone cannot tell the old code from the new: the old code also exits 1 when nobody answers (box row set-4dbc0913). The refusal is proven by the errors match below.
  assert.equal(out.code, 1, `the form refuses (exit 1): ${out.shown}${out.errors}`);
  assert.match(out.errors, new RegExp(`tree decide: --close ${esc(key)}: ${esc(key)} is dead: it was replaced or set aside by a decision, or a node above it was`));
  assert.match(out.errors, /council tree status /);
  assert.match(out.errors, /Nothing was asked and nothing was written\./);
  assert.equal(out.shown, '', 'nobody was asked');
  assert.equal(eventsOf(r).length, events0, 'nothing was written');
  assert.equal(nodesOf(r).find(n => `${n.node}@g${n.generation}` === key).phase, 'registered', 'the node is as it was');
});

// The control, a pure fold on raw events (the shapes of tree-dead-nodes.test.js G3): the refusal is the condition of nodeMoneyOf's hold, dead AND not running. A dead RUNNING node cannot be made with the verbs any more (SG-1 refuses the regenerate that would list it), so
// only a fold can show that it stays closable; a node whose plan was NOT replaced is closable in every phase.
const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' } });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', gateId: 'g', shownSha256: '0'.repeat(64), boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const claimed = (id, n, g, host, pid) => ({ id, event: 'node_started', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, pid, host });
test('M1 control: closeRefusal refuses a dead node that is not running (registered, stopped) and keeps a dead RUNNING node and every live node closable', () => {
  const closedAt = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status, share: 'released' });
  const ROOT = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, claimed('e2b', 'R', 1, 'h', 1), closedAt('e2c', 'R', 1)];
  const gone = 2147483000;       // a pid no process has: its claim is dead on this host
  const kid = phase => [...ROOT, ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'),
    { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, claimed('e4b', 'R/M1', 1, 'h', 1), closedAt('e4c', 'R/M1', 1, 'needs_decision'),
    { id: 'e5', ...run('R/M2', 1, 'R', 'kA') },
    ...(phase === 'registered' ? [] : [claimed('e5b', 'R/M2', 1, hostname(), phase === 'running' ? gone : 1)]),
    ...(phase === 'stopped' ? [{ id: 'e5c', event: 'node_stopped', node: 'R/M2', generation: 1, runId: 'run-R-M2-1', reason: 'budget' }] : [])];
  const stop = { id: 'e6', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] };
  const dec = { id: 'e7', event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], form: 'regenerate', stopId: 'e6', gateId: 'g', shownSha256: '0'.repeat(64) };
  const open = { id: 'e8', event: 'generation_opened', decisionId: 'e7', nodes: [{ node: 'R/M1', generation: 2 }] };
  const ask = (phase, replaced) => { const state = foldRecord(replaced ? [...kid(phase), stop, dec, open] : kid(phase)); return { dead: deadKeys(state).has('R/M2@g1'), why: closeRefusal({ state, runsDir: join(tmpdir(), 'af-no-such-runs-dir'), node: 'R/M2', generation: 1, facts: { host: hostname() }, rootId: 'rid' }) }; };
  for (const phase of ['registered', 'stopped']) {
    const x = ask(phase, true);
    assert.equal(x.dead, true, `${phase}: the fixture makes R/M2 dead`);
    assert.equal(x.why?.kind, 'dead', `${phase} and dead: refused`);
    const verb = phase === 'stopped' ? 'is never resumed' : 'can never start';       // a stopped node DID start (budget stop); a registered one never started
    assert.match(x.why.reason, new RegExp(`^R/M2@g1 is dead: it was replaced or set aside by a decision, or a node above it was, so it holds no money and ${verb}\\. .*council tree status rid`), phase);
    assert.equal(ask(phase, false).why, null, `${phase} and NOT replaced: closable`);
  }
  const running = ask('running', true);
  assert.equal(running.dead, true, 'running: the fixture makes R/M2 dead');
  assert.equal(running.why, null, 'a dead node that RUNS (its claim is gone) keeps its hold and stays closable');
  assert.equal(ask('running', false).why, null, 'running and NOT replaced: closable');
});

/** The real CLI path (api.run spawns `council --tree-node ...`, the way test/tree-readers-p2a.test.js P2A-4 starts a node by hand) for a registered node, with the inputs of its bundle. */
function handStart(r, key) {
  const [node, gen] = key.split('@g'); const generation = Number(gen);
  const reg = eventsOf(r).find(e => e.event === 'node_registered' && e.node === node && e.generation === generation);
  const bundle = bundleDirOf(r.t.rootDir, node, generation);
  return { reg, run: () => api.run({ chain: reg.chain.name, task: join(bundle, 'task.md'), criteria: join(bundle, 'criteria.json'), context: join(bundle, 'context.md'), runId: reg.runId, treeNode: join(bundle, 'node.json'), cwd: r.t.work, maxUsd: reg.grant.amount }) };
}
test('L3: a hand start (`council --tree-node`) of a DEAD registered node is refused FIRST, with the backstop\'s own words and before run.json exists; the old code wrote run.json and the node_started table row refused it afterwards (this fixture has a sound bundle, so no way out was offered either)', { timeout: 900_000 }, async () => {
  const { r, start } = await notStartedTree();
  const dead = await deadChildren(r, start);
  const key = dead[0];
  const h = handStart(r, key);
  const blockedBefore = eventsOf(r).filter(e => e.event === 'blocked').length;
  const out = await h.run();
  assert.equal(out.exitCode, 19, out.outputTail);
  assert.equal(existsSync(join(r.t.runsDir, h.reg.runId, 'run.json')), false, 'refused before run.json: nothing is left in the run folder');
  assert.match(out.outputTail, new RegExp(`${esc(key)} is dead: it was replaced or set aside by a decision, or a node above it was`));
  assert.doesNotMatch(out.outputTail, /--close/, 'the refusal offers no way out the node cannot take');
  const added = eventsOf(r).filter(e => e.event === 'blocked').slice(blockedBefore);
  assert.deepEqual(added.map(e => [e.reason, e.check, e.scope]), [['continuation_refused', 'dead', key]], 'ONE refusal record: continuation_refused / dead (the old code wrote the table row\'s transition_refused)');
});

test('N: a refused member start of a dead node stays in the status list (the history is true), but its `next` line no longer says "close it": `--close` refuses a node that holds nothing (LEGACY state: a run.json left by a start from before the member unit, the one hand-made file of P2A-4b)', { timeout: 900_000 }, async () => {
  const { r, start } = await notStartedTree();
  const dead = await deadChildren(r, start);
  const key = dead[0]; const h = handStart(r, key);
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'pii_mode_mismatch', scope: key, transition: 'node_started', check: 'pii_mode', detail: 'refused for the personal-data rule (older record)' });
  mkdirSync(join(r.t.runsDir, h.reg.runId), { recursive: true }); writeFileSync(join(r.t.runsDir, h.reg.runId, 'run.json'), '{}');
  const facts = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  const [node, gen] = key.split('@g');
  const entry = facts.memberRefusals.find(m => m.node === node && m.generation === Number(gen));
  assert.deepEqual(entry && [entry.count, entry.runJson], [1, true], `the refusal is listed with its run.json: ${JSON.stringify(facts.memberRefusals)}`);
  const text = renderTreeStatus(facts);
  assert.ok(text.includes(memberRefusalLine(entry)), 'the history line stays');
  const steps = text.slice(text.indexOf('What you can do'));
  assert.doesNotMatch(steps, new RegExp(`--close ${esc(node)}(?![\\w/@])`), 'no next step tells the person to close a node `--close` refuses (closeRefusedLine prints the node path, without its generation)');
});

// DRIVER B (no appended record line either): the same real tree, but the sitting stops right after the CONSUMER R/M2 registers, so R/M2 (depends on R/M1) is registered, not started, while R/M1 and everything below it are finished.
async function consumerRegisteredTree() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, hooks: { afterRegister: next => { if (next.kind === 'registered' && next.node === 'R/M2') requestStop(r.t.rootDir); } } });
  return { r, start };
}
test('M1 on a LISTED CONSUMER (Driver B): `decide --close R/M2@g1` refuses the consumer a decision listed, which never wrote a plan, with the one sentence of the dead nodes', { timeout: 900_000 }, async () => {
  const { r, start } = await consumerRegisteredTree();
  const m2 = nodesOf(r).find(n => n.node === 'R/M2');
  assert.ok(m2 && m2.phase === 'registered', `the consumer R/M2 is registered and has not started: ${JSON.stringify(nodesOf(r).map(n => [n.node, n.generation, n.phase]))}`);
  const stop = await stopOnM1(r, start);
  const answered = await decide(r, { stop: stop.id }, ['Rewrite the overview.\n.', stop.id, 'y']);
  assert.equal(answered.code, 0, answered.shown + answered.errors);
  clearStop(r.t.rootDir);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  assert.ok(deadKeys(stateOf(readTreeRecord(r.t.rootDir))).has('R/M2@g1'), 'the decision listed the consumer R/M2@g1 and its generation is opened: it is dead');
  const events0 = eventsOf(r).length;
  const out = await decide(r, { close: 'R/M2@g1' }, []);
  assert.equal(out.shown, '', `nobody was asked: ${out.shown}`);
  assert.match(out.errors, /tree decide: --close R\/M2@g1: R\/M2@g1 is dead: it was replaced or set aside by a decision, or a node above it was, so it holds no money and can never start\./);
  assert.equal(eventsOf(r).length, events0, 'nothing was written');
});

// DEAD WORDS (the constant commit): the routes into deadKeys, as pure folds on raw events (the shapes of tree-dead-nodes.test.js G1/G3 and tree-dead-key-scan.test.js). The ONE sentence is pinned as a LITERAL on each route, and this test never imports the constant: a change of the words fails it.
// Orphans are dead only when no regenerate listed them AND they are not held for reuse (finished and passed descendants are held: subCandidates), so the orphan routes use registered, never-started nodes the decision did not list; each precondition is asserted.
const G = { gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' };
const DEAD_WORDS = key => `${key} is dead: it was replaced or set aside by a decision, or a node above it was`;
test('DEAD WORDS: one true sentence on every route: a node a decision listed (with a successor, and a consumer with none), a depth-1 orphan, a transitive orphan, a superseded root generation', () => {
  const closedAt = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status, share: 'released' });
  const ROOT = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, claimed('e2b', 'R', 1, 'h', 1), closedAt('e2c', 'R', 1, 'needs_decision')];
  const base = [...ROOT, ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'),
    { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, claimed('e4b', 'R/M1', 1, 'h', 1), closedAt('e4c', 'R/M1', 1, 'needs_decision'), { id: 'e5', ...run('R/M2', 1, 'R', 'kA') }];
  const LISTED = [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }];
  const listing = [{ id: 'e10', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'node_closed', affected: LISTED },
    { id: 'e11', event: 'decision_recorded', text: 'redo', form: 'regenerate', stopId: 'e10', affected: LISTED, ...G },
    { id: 'e12', event: 'generation_opened', decisionId: 'e11', nodes: [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }] }];
  const successor = [...front('kD', 'R', 1, [{ node: 'R/M1', generation: 2 }], 'e13'), { id: 'e14', ...run('R/M1', 2, 'R', 'kD') }];
  const below = [...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e6'), { id: 'e7', ...run('R/M1/M1', 1, 'R/M1', 'kB') },
    ...front('kC', 'R/M1/M1', 1, [{ node: 'R/M1/M1/M1', generation: 1 }], 'e8'), { id: 'e9', ...run('R/M1/M1/M1', 1, 'R/M1/M1', 'kC') }];
  const isDead = (state, key, route) => { assert.equal(deadKeys(state).has(key), true, `${key} is dead (${route}); dead: ${[...deadKeys(state)].join(', ')}`); };
  const says = (state, key, route) => { isDead(state, key, route); assert.deepEqual(deadRefusal(state, key), { check: 'dead', detail: DEAD_WORDS(key) }, `${key}: ${route}`); };
  const noSuccessor = foldRecord([...base, ...listing]);
  says(noSuccessor, 'R/M2@g1', 'listed consumer: R/M2@g2 was opened and nothing is registered for it (set aside)');
  says(noSuccessor, 'R/M1@g1', 'listed, no replacement registered yet');
  assert.equal(transitionRefusal(noSuccessor, { event: 'node_started', node: 'R/M2', generation: 1, runId: 'run-R-M2-1', pid: 1, host: 'h' })?.reason, 'R/M2@g1 is dead (replaced or set aside by a decision, or a node above it was): it is never started', 'a table row, on the consumer with no successor');
  const withSuccessor = foldRecord([...base, ...listing, ...successor]);
  says(withSuccessor, 'R/M1@g1', 'listed, and its replacement R/M1@g2 is registered (replaced)');
  assert.equal(deadRefusal(withSuccessor, 'R/M1@g2'), null, 'control: the replacement is live');
  const orphans = foldRecord([...base, ...below, ...listing, ...successor]);       // the decision lists R/M1 and R/M2 only: R/M1/M1 and R/M1/M1/M1 are NOT listed
  for (const [key, route] of [['R/M1/M1@g1', 'depth-1 orphan'], ['R/M1/M1/M1@g1', 'transitive orphan: its parent R/M1/M1@g1 was never replaced or set aside by a decision itself']]) {
    assert.equal(orphansOf(orphans).has(key), true, `${key} is an orphan`); assert.equal(heldKeys(orphans).has(key), false, `${key} is not held for reuse`); assert.equal(LISTED.some(a => `${a.node}@g${a.generation}` === key), false, `${key} is not in the decision's list`);
    says(orphans, key, route);
  }
  const replanned = foldRecord([...base, ...listing,
    { id: 'e15', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] },
    { id: 'e16', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e15', replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...G },
    { id: 'e17', event: 'generation_opened', decisionId: 'e16', nodes: [{ node: 'R', generation: 2 }] }]);
  says(replanned, 'R@g1', 'a superseded root generation');
});
test('W1: the close screen of a registered node lists a consumer whose registration was REPLACED as having nothing registered now, not as "(registered)"', { timeout: 900_000 }, async () => {
  const { r, start } = await consumerRegisteredTree();
  const m2 = nodesOf(r).find(n => n.node === 'R/M2');
  assert.ok(m2 && m2.phase === 'registered', `the consumer R/M2 is registered and has not started: ${JSON.stringify(nodesOf(r).map(n => [n.node, n.generation, n.phase]))}`);
  const stop = await stopOnM1(r, start);
  const out = await decide(r, { stop: stop.id }, ['Rewrite the overview.\n.', stop.id, 'y']);
  assert.equal(out.code, 0, out.shown + out.errors);
  clearStop(r.t.rootDir);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  assert.ok(deadKeys(stateOf(readTreeRecord(r.t.rootDir))).has('R/M2@g1'), 'the decision listed the consumer R/M2@g1 and its generation is opened: it is dead');
  approvePending(r);
  // registerNextChild is the sitting's own registration step; `runTree` with maxStarts 0 stops BEFORE it (box result set-9fa9eb20 showed no R/M1@g2 after that)
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.node], ['registered', 'R/M1'], `the replacement frontier registers R/M1 first: ${JSON.stringify(reg)}`);
  const g2 = nodesOf(r).find(n => n.node === 'R/M1' && n.generation === 2);
  assert.ok(g2 && g2.phase === 'registered', `the replacement R/M1@g2 is registered and idle: ${JSON.stringify(nodesOf(r).map(n => [n.node, n.generation, n.phase]))}`);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).maxOpened.get('R/M2'), 2, 'the decision opened R/M2@g2: the screen reads its current generation as 2, which is not registered');
  const shown = (await decide(r, { close: 'R/M1@g2' }, ['R/M1', 'n'])).shown;
  assert.match(shown, /These wait for it and will not start/);
  assert.match(shown, /- R\/M2 \(replaced or set aside by a decision, or a node above it was; nothing is registered for it now\): /);
  assert.doesNotMatch(shown, /- R\/M2 \(registered\)/);
});


// R1: a run limit that refuses children of R/M1's own split, then raised, reopens that frontier (its approval no longer matches what a person would be shown). Then R/M1 is replaced (the QB3 steps): the frontier belongs to a dead parent, registers nothing, and findPendingFrontier does not offer it.
const LOW_RUNS = { maxDepth: 2, maxRuns: 3, maxChildrenPerSplit: 4, attemptsPerChild: 1 };
test('R1: a frontier of a REPLACED parent is not listed as waiting for approval (the sitting, the status and the tree_status payload), though a raised limit had reopened it', { timeout: 900_000 }, async () => {
  const { r, start } = await notStartedTree({ limits: LOW_RUNS });
  const frontiers = () => [...stateOf(readTreeRecord(r.t.rootDir)).frontiers.entries()];
  const key = frontiers().find(([, f]) => f.parentNode === 'R/M1' && f.parentGeneration === 1)?.[0];
  assert.ok(key, `R/M1's children frontier exists: ${JSON.stringify(frontiers().map(([k, f]) => [k.slice(0, 8), f.parentNode, f.parentGeneration]))}`);
  const raise = await decide(r, { 'max-runs': '10' }, ['10', 'y']);
  assert.equal(raise.code, 0, raise.shown + raise.errors);
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), key), true, 'the raise reopened the frontier of R/M1 (a child of its split was refused for the run limit)');
  assert.ok(chooseNextChild(r.t.rootDir, { work: r.t.work }).awaitingApproval.includes(key), 'control: while R/M1 stands the reopened frontier waits for approval');
  await deadChildren(r, start);
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), key), true, 'the frontier still reads reopened; its parent R/M1@g1 is replaced');
  assert.equal(chooseNextChild(r.t.rootDir, { work: r.t.work }).awaitingApproval.includes(key), false, 'a frontier of a replaced parent registers nothing: it waits for no approval');
  assert.equal(gatherStatusFacts(r.t.rootDir, { work: r.t.work }).awaitingApproval.includes(key), false, 'nor does the status (and so the tree_status payload) list it');
});

// K1's driver is the shape of tree-subplan-preflight.test.js's stoppedWithChild: R/M1 is closed with its split, its first child R/M1/M1 is REGISTERED (never started), and a stop of R/M1 is open. The STOP RECORD is written by the fixture (needs_decision_opened with the real affectedFor); the real writer, detectStops,
// needs a close with Status needs_decision AND a verified split, which no fixture builds. (A stop a sitting opens after a person edits R/M1's plan, as in QB3, does not name the planned children: the edited plan's split block does not read against its hash, so affectedFor knows only the registered ones: box result 4e54265c.)
async function stoppedWithChild() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const b = block3(); for (const m of b.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });
  approvePending(r);                                                                                 // R/M1's own frontier
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.node], ['registered', 'R/M1/M1'], 'a descendant of R/M1 is registered');
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ record, state, runsDir: r.t.runsDir, node: 'R/M1' }).affected });
  return { r, stop };
}
test('K1: the regenerate screen of a stop on R/M1 does not call a planned child that never registered "kept (finished and passed)"; the registered child that has not started is listed as replaced', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  // the fixture must really hold planned-only children below R/M1 in the stop's recorded set, or the check below could not fail
  const registered = new Set(nodesOf(r).map(n => `${n.node}@g${n.generation}`));
  const plannedOnly = stop.affected.map(a => `${a.node}@g${a.generation}`).filter(k => k.startsWith('R/M1/') && !registered.has(k));
  assert.ok(plannedOnly.length >= 1, `the stop names a planned child that never registered: ${JSON.stringify(stop.affected)}`);
  assert.ok(registered.has('R/M1/M1@g1'), 'the registered child that has not started exists');
  const out = await decide(r, { fresh: true }, ['The retention rule changes: keep records for 90 days.\n.', stop.id, 'y']);
  assert.equal(out.code, 0, out.shown + out.errors);
  assert.doesNotMatch(out.shown, /Kept for the new plan/, `nothing finished and passed sits below R/M1 here, so no node is "kept": ${plannedOnly.join(', ')} never registered`);
  assert.ok(out.shown.includes('  - R/M1/M1@g1\n'), 'R/M1/M1@g1 (registered, not started) is listed among the nodes it replaces');
});

test('M2: the accept-plan screen of a changed ROOT plan does not say a REPLACED registered child "is rebuilt from the accepted text before it starts"', { timeout: 900_000 }, async () => {
  const { r, start } = await consumerRegisteredTree();
  const stop = await stopOnM1(r, start);
  const answered = await decide(r, { stop: stop.id }, ['Rewrite the overview.\n.', stop.id, 'y']);
  assert.equal(answered.code, 0, answered.shown + answered.errors);
  clearStop(r.t.rootDir);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const dead = deadKeys(stateOf(readTreeRecord(r.t.rootDir)));
  assert.ok(dead.has('R/M2@g1') && nodesOf(r).find(n => n.node === 'R/M2' && n.generation === 1).phase === 'registered', 'R/M2@g1 is registered, never started, and dead (the decision listed it as the consumer of R/M1)');
  const rootPlan = planFile(r, 'R');
  writeFileSync(rootPlan, `${readFileSync(rootPlan, 'utf8')}\nOne clarifying sentence the person reads.\n`);
  await sit(r, start);
  const rootStop = stopsOf(r, 'R').at(-1);
  assert.ok(rootStop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(rootStop.id), `a stop is open for the root plan: ${JSON.stringify(stopsOf(r, 'R').map(e => e.id))}`);
  const out = await decide(r, { 'accept-plan': true, stop: rootStop.id }, [rootStop.id, 'n']);
  assert.match(out.shown, /could not accept this on its own/, out.shown + out.errors);
  assert.match(out.shown, /1 registered sub-plan \(R\/M2@g1\) is dead: it was replaced or set aside by a decision, or a node above it was, so it never starts and nothing is rebuilt for it\./);
  assert.doesNotMatch(out.shown, /not started yet/, 'no sentence promises the replaced child a rebuild before it starts');
});
