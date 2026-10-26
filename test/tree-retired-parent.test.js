// 0.8.3 M7 money fix-up 3 (C&C thcmcp-6d, 19 Okt 2026; found by the C2b-3 root-route fixture): once a recorded decision replaces or sets aside a parent, the approval that was given for that parent's children registers nothing more. REAL VERBS, all-mock, $0. No import that exists only in the C2b-2 / regenerate stack, so the file runs (and is red) on the release ac9f0002.
// Walk: a splitting child R/M1@g1 whose children frontier is approved, ONE of its three children registered and finished (R/M1/M1); a root stop; the root decision ("SET ASIDE from now on ... start nothing more"); R@g2 planned with the same block; the person approves R@g2's children frontier. KNOWN-BAD at ac9f0002: R/M1/M3@g1 then REGISTERS under the OLD frontier (granted 7.00, closed passed having spent 6.96) while the new R/M1@g2 replaces the whole branch.
// Why R/M1/M2@g1 never registered (scratch on ac9f0002, chooseNextChild right after the approval): the chooser returns R/M1/M3 first (the first eligible child in dependency order); M2 had not been chosen when R/M1@g2 registered and frontierParentReplaced ended the old frontier. So the leak is bounded by the order in which the chooser happens to run, not by any rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { runTree } from '../src/tree-run.js';
import { budgetOf } from '../src/tree-budget.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { FIXTURE_BOUND, ROOT_ID } from './helpers/tree-fixture.js';
import { foldRecord, transitionRefusal } from '../src/tree-transitions.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };

test('money fix-up 3: after a root re-plan the SET-ASIDE sub-plan R/M1@g1 registers nothing more under its old children approval, and no money is held for its unregistered children', async () => {
  const r = await trackedRealRoot({ ...splitChildren(), cap: 100 }); approvePending(r);
  const m1 = block3(); for (const m of m1.milestones) if (m.open_question) m.open_question = `Inside the layer: how is ${m.id} cut?`;
  writeFileSync(join(r.t.work, 'plan-m1.md'), planWith(m1, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const kids = draftStarter(r, { 'R/M1': 'plan-m1.md' });
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: kids });                  // R/M1@g1 runs and closes; its split is verified at the next sitting
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: kids });                  // R/M3@g1 (an independent sibling) runs
  approvePending(r);                                                                               // R/M1@g1's children frontier
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: kids });                  // exactly one of its three children starts
  const oldFrontier = [...stateOf(readTreeRecord(r.t.rootDir)).frontiers].find(([, f]) => f.parentNode === 'R/M1' && f.parentGeneration === 1)?.[0];
  assert.ok(oldFrontier, 'R/M1@g1 has an approved children frontier');
  const registeredBefore = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'node_registered' && e.frontierKey === oldFrontier).map(e => e.node);
  assert.ok(registeredBefore.length >= 1 && registeredBefore.length < 3, `the old frontier is only partly filled (${registeredBefore})`);
  // the root stop, the decision, the new root plan
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  let t = io(['Plan it again, offline store first.\n.', stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  assert.match(t.shown(), /SET ASIDE from now on/);
  assert.match(t.shown(), /R\/M1@g1/);
  const decided = readTreeRecord(r.t.rootDir).events.find(e => e.event === 'decision_recorded');
  assert.ok(decided.affected.some(a => a.node === 'R/M1' && a.generation === 1), 'the recorded root decision LISTS R/M1@g1 (the predicate keys on it)');
  const sample = readTreeRecord(r.t.rootDir).events.find(e => e.event === 'node_registered' && e.frontierKey === oldFrontier);
  assert.throws(() => appendTreeEvent(r.t.rootDir, { event: 'node_registered', node: 'R/M1/M2', generation: 1, runId: '2026-10-19T09-09-09-999Z', attempt: 1, depth: sample.depth, parentNode: 'R/M1', frontierKey: oldFrontier, chain: sample.chain, grant: { amount: 7, unit: 'usd' } }), /which decision .* replaced or set aside/, 'right after the decision the table refuses a hand-appended registration under the retired frontier (accepted on the release; the parent is not yet replaced by a newer R/M1)');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  t = io([pending.key.slice(0, 8), 'y']);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  writeFileSync(join(r.t.work, 'plan-r2.md'), planWith(block3(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const rootPlan = ({ chain, bundleDir, runId, grantUsd }) => api.run({ chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}), ...(existsSync(join(bundleDir, 'context.md')) ? { context: join(bundleDir, 'context.md') } : {}), runId, treeNode: join(bundleDir, 'node.json'), cwd: r.t.work, maxUsd: grantUsd, draft: 'plan-r2.md', rounds: 1 });
  const start = opts => (opts.node === 'R' ? rootPlan(opts) : kids(opts));
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });                  // R@g2 is planned and closes
  const heldBefore = budgetOf(r.t.rootDir).heldUsd;
  approvePending(r);                                                                               // the person approves R@g2's children frontier
  assert.equal(budgetOf(r.t.rootDir).heldUsd, heldBefore, 'an approval holds no money');
  let last = null;
  for (let k = 0; k < 8; k += 1) last = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 5, startRun: start });       // a FIXED number of sittings
  assert.equal(last.status, 'nothing_to_do', JSON.stringify(last));
  const waiting = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.deepEqual(waiting ? [waiting.parent.node, waiting.parent.generation] : null, ['R/M1', 2], 'the one approval that waits is the NEW plan\'s R/M1@g2 children frontier; the retired R/M1@g1 asks the person for nothing');
  const ev = readTreeRecord(r.t.rootDir).events;
  const decisionAt = ev.findIndex(e => e.event === 'decision_recorded');
  const late = ev.slice(decisionAt).filter(e => e.event === 'node_registered' && e.frontierKey === oldFrontier);
  assert.deepEqual(late.map(e => `${e.node}@g${e.generation}`), [], 'NO node is registered under the retired frontier after the decision (known-bad: R/M1/M3@g1, granted 7.00)');
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.ok(st.nodes.has('R/M1@g2'), 'the new plan\'s R/M1 registered as usual');
  assert.equal([...st.nodes.values()].filter(n => n.frontierKey === oldFrontier).length, registeredBefore.length, 'the old frontier\'s registered set is what it was at the decision');
  assert.equal([...st.nodes.values()].filter(n => n.node.startsWith('R/M1/') && n.generation === 1 && n.phase !== 'closed').length, 0, 'nothing of the set-aside branch is running or holding a grant');
});

// THE CLASS (sub-plan regenerate): the same predicate covers a LISTED parent of a sub-plan regenerate in the window between `decision_recorded` and `generation_opened` (the recovery step that opens the next generation of the parent's path; before it, frontierParentReplaced is false). Fold-level record, as test/tree-root-generation.test.js builds them.
const G = { gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' };
const runFor = (n, g) => (n === 'R' && g === 1 ? 't' : `run-${n.replace(/\//g, '-')}-${g}`);
const reg = (n, g, parent, fk, extra = {}) => ({ event: 'node_registered', node: n, generation: g, runId: runFor(n, g), attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' }, ...extra });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: runFor(parent, pg), splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: runFor(n, g), pid: 1, host: 'h' });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: runFor(n, g), outcome: 'passed', passed: true, status, share: 'released' });

test('money fix-up 3, the class: a sub-plan regenerate that LISTS R/M1@g1 retires its children approval from decision_recorded on, before generation_opened', () => {
  const base = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, 'needs_decision'),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1),
    ...front('kB', 'R/M1', 1, [{ node: 'R/M1/A', generation: 1 }, { node: 'R/M1/B', generation: 1 }], 'e5'), { id: 'e6', ...reg('R/M1/A', 1, 'R/M1', 'kB') }, started('e6b', 'R/M1/A', 1), closed('e6c', 'R/M1/A', 1)];
  const child = { ...reg('R/M1/B', 1, 'R/M1', 'kB'), id: 'e99' };
  const open = foldRecord([...base]);
  assert.equal(transitionRefusal(open, child), null, 'control: before any decision the approved child registers');
  const stopped = [...base, { id: 'e7', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'status', affected: [{ node: 'R/M1', generation: 1 }] },
    { id: 'e8', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e7', affected: [{ node: 'R/M1', generation: 1 }], ...G }];
  const state = foldRecord(stopped);
  assert.equal(state.decisions.get('e8').generated, false, 'the generation is not opened yet: the window');
  assert.match(transitionRefusal(state, child)?.reason ?? '', /which decision e8 replaced or set aside: an approval given before that decision registers nothing more/);
  // NO NEW GENERATION EVER OPENED for R/M1 (the "no M1 child in the new plan" case at fold level): the refusal does not wait for one
  assert.equal(state.maxOpened.get('R/M1') ?? 0, 0);
});

test('money fix-up 3, START and RESUME: a child registered under the old frontier BEFORE the decision, never started, is refused by node_started and node_resumed from decision_recorded on (the node is stale until the generation opens and dead after; the table row had only the dead test)', () => {
  const base = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, 'needs_decision'),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1),
    ...front('kB', 'R/M1', 1, [{ node: 'R/M1/A', generation: 1 }], 'e5'), { id: 'e6', ...reg('R/M1/A', 1, 'R/M1', 'kB') }];
  const start = { event: 'node_started', node: 'R/M1/A', generation: 1, runId: runFor('R/M1/A', 1), pid: 1, host: 'h', id: 'e98' };
  assert.equal(transitionRefusal(foldRecord(base), start), null, 'control: before any decision it starts');
  const decided = [...base, { id: 'e7', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'status', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/A', generation: 1 }] },
    { id: 'e8', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e7', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/A', generation: 1 }], ...G }];
  const state = foldRecord(decided);
  assert.match(transitionRefusal(state, start)?.reason ?? '', /replaced or set aside by decision e8 .* never started/, 'known-bad: only the dead test, so a registered child starts and spends its grant');
  const resumed = { event: 'node_resumed', node: 'R/M1/A', generation: 1, runId: runFor('R/M1/A', 1), purpose: 'resume', id: 'e97' };
  assert.match(transitionRefusal(state, resumed)?.reason ?? '', /replaced or set aside by decision e8/);
});
