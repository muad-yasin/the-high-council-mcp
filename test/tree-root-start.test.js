// 0.8.3 M6 S8-5b (tree-run.js; rulings row 130, design note 8.2): the NEW root run R@g2 is STARTED, from its bundle, by the sitting's default starter (src/tree-run.js apiStarter). A root bundle (src/tree-root-replan.js rootBundle) holds task.md,
// context.md and node.json and NO criteria.json (the root makes its own); the starter used to pass --criteria for a file that is not there (exit 2, "--criteria: no such file .../tree/inputs/R@g2/criteria.json") and leaves the flag out now when the
// bundle has no such file. The neighbour is pinned too: a CHILD whose criteria.json was taken away is refused by the member's bundle-hash re-check (exit 19), the flag is never what protects it. And the sitting's `rootBlocked` follows the LIVE
// root generation (it matched 'R@g1' only). Real flow: the real decide and approve verbs, the real gate, the REAL starter (api.run on the all-mock chain), $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { registerNextChild } from '../src/tree-loop.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };
// a real root with R/M1 finished and passed, a stop on the root, the decision recorded and the new root plan APPROVED through the real verbs: R@g2 waits for the sitting
async function approvedRootPlan() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  const d = io(['Plan it again, offline store first.\n.', stop.id, 'y']);
  const dc = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: d.stdin, stdout: d.stdout, stderr: d.stderr, now: () => Date.now() }).finally(d.stop);
  assert.equal(dc, 0, d.shown() + d.errors());
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const a = io([pending.key.slice(0, 8), 'y']);
  const ac = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: a.stdin, stdout: a.stdout, stderr: a.stderr, now: () => Date.now() }).finally(a.stop);
  assert.equal(ac, 0, a.shown() + a.errors());
  return r;
}

test('R@g2 is STARTED from its bundle by the default starter: the run exists with the grant as its cap, the bundle has no criteria.json, the node closes passed, the held nodes are released (X2), the sitting has nothing left to do', async () => {
  const r = await approvedRootPlan();
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3 });          // NO startRun: the real api.run starter on the all-mock chain
  assert.deepEqual(out.started.map(s => [s.node, s.generation, s.exitCode]), [['R', 2, 0]], JSON.stringify(out));
  const state = stateOf(readTreeRecord(r.t.rootDir)); const n = state.nodes.get('R@g2');
  assert.equal(existsSync(join(bundleDirOf(r.t.rootDir, 'R', 2), 'criteria.json')), false, 'a root bundle has no criteria file');
  assert.deepEqual([n.phase, n.outcome], ['closed', 'passed']);
  const run = JSON.parse(readFileSync(join(r.t.runsDir, n.runId, 'run.json'), 'utf8'));
  assert.equal(run.maxUsd, n.grant.amount, 'the run was started under the grant as its cap (the approved cap, S8-5)');
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out));
  assert.equal(eventsOf(r).filter(e => e.event === 'held_released').length, 1, 'the new root plan holds no split: the held nodes are released, once');
});

test('the NEIGHBOUR: a child whose criteria.json was taken away is refused by the member\'s bundle-hash re-check (exit 19, no provider call) - leaving --criteria out never lets it run', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const bundle = bundleDirOf(r.t.rootDir, reg.node, reg.event.generation);
  assert.equal(existsSync(join(bundle, 'criteria.json')), true, 'a child bundle has its criteria file');
  const aside = join(tmpdir(), `thc-s85b-${process.pid}`); mkdirSync(aside, { recursive: true }); renameSync(join(bundle, 'criteria.json'), join(aside, 'criteria.json'));
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 2 });
  assert.equal(out.status, 'tree_refused', JSON.stringify(out));
  assert.equal(out.started[0].exitCode, 19);
  assert.equal(existsSync(join(r.t.runsDir, reg.runId, 'criteria.md')), false, 'no stage ran');
});

test('rootBlocked follows the LIVE root generation: a blocked reason at R@g2 (a lint finding on the new root run\'s report) is reported by the sitting and opens a stop for node R generation 2 (it matched R@g1 only)', async () => {
  const r = await approvedRootPlan();
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3 });
  const n = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g2');
  const file = join(r.t.runsDir, n.runId, 'report.json');
  const rep = JSON.parse(readFileSync(file, 'utf8')); rep.handoff_milestones = { ...rep.handoff_milestones, findings: [{ kind: 'unknown_criterion', message: 'M0 names C3' }] }; writeFileSync(file, JSON.stringify(rep));
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3 });
  assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  assert.deepEqual(out.rootBlocked.map(b => b.code), ['status_policy'], 'the sitting reports the live root generation\'s reason');
  assert.ok(out.rootBlocked[0].text.startsWith('R@g2:'), out.rootBlocked[0].text);
  const stops = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked');
  assert.deepEqual(stops.map(e => [e.node, e.generation]), [['R', 2]], 'a stop for the new root generation, answered by another new root plan');
});
