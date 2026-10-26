// CR-2G-003 (25 Okt 2026): a node that holds a LIVE post-run claim (a paid `council handoff --from-run` on its finished run, still running) is active, but the sitting reported it as INTERRUPTED ("its process is gone, its run did not end"), which is
// false. It now reports running_elsewhere ("is running in another process. Nothing was started."), the sentence a live run claim already gets. A DEAD post-run claim on this host is released by the record-only phase before the sitting looks at the
// node (no state is reported for it). The claim is written by the product's own memberStart (the call `handoff --from-run` makes), with this test's pid: a real `handoff --from-run` cannot be held open inside a test without a long call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateOf, readTreeRecord } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { memberStart } from '../src/tree-member.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function finishedTree() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  return r;
}
const claimPostRun = (r, node, pid) => {
  const n = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
  // the chain file the node was registered against (memberStart checks its hash): the fixture's own chains/ folder, else the package's
  const chainName = eventsOf(r).find(e => e.event === 'node_registered' && e.node === node).chain.name;
  const chainPath = [join(r.t.work, 'chains', `${chainName}.json`), join(root, 'chains', `${chainName}.json`)].find(existsSync);
  return memberStart({ runDir: join(r.t.runsDir, n.runId), runId: n.runId, lineage: { treeId: basename(r.t.rootDir), node, generation: n.generation }, purpose: 'post_run', capAskedUsd: 1, chainPath, piiGate: null, piiAllow: [], allowSecretShaped: false, ceiling: null, work: r.t.work, pid });
};
const neverStart = () => { throw new Error('a sitting must not start anything here'); };

test('PC-1: a live post-run claim (this process) is reported as running_elsewhere, nothing is started', async () => {
  const r = await finishedTree();
  claimPostRun(r, 'R/M1', process.pid);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').postRun?.pid, process.pid, 'the claim is on the record');
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: neverStart });
  assert.equal(out.status, 'running_elsewhere', JSON.stringify(out).slice(0, 300));
});

test('PC-2: a DEAD post-run claim on this host is released by the sitting (node_released, reason dead_post_run) and the node is not reported as running or interrupted', async () => {
  const r = await finishedTree();
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;                         // a pid that has exited
  claimPostRun(r, 'R/M1', gone);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: neverStart });
  assert.notEqual(out.status, 'running_elsewhere'); assert.notEqual(out.status, 'interrupted');
  assert.ok(eventsOf(r).some(e => e.event === 'node_released' && e.node === 'R/M1' && e.reason === 'dead_post_run'), 'the dead claim was released');
});
