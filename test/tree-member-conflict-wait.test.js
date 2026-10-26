// 0.8.3 M7 MEMBER VERB (conflict ask), commit 1: a tree member the conflict decider stopped for the person's choice (STOPPED-conflict.json, exit 25) ENDED CLEANLY and waits, like a member at an overseer limit.
// Recovery must not reconcile it as finished or resume it, a person's --close must not be refused as "already ended", and the status words name what it waits for. The marker is written by hand (the stop itself is commit 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { planRecovery } from '../src/tree-recovery.js';
import { closeRefusal, describePhase } from '../src/tree-close.js';
import { runEndOf, waitsForChoice, pausedAtExternalSeat } from '../src/tree-member.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending } from './helpers/sitting.js';
import { ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';

const GONE = { pidAlive: () => false };
async function conflictStoppedTree() {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: async () => ({ exitCode: 25, outputTail: 'x' }) });
  const reg = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim('R/M1', reg.runId, process.pid, 1, hostnameOf()) });       // the claim's process is reported gone through facts.pidAlive below: the member ended and waits
  const dir = join(r.t.runsDir, reg.runId); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: r.t.childChain, task: 'x', maxUsd: 10 }));
  writeFileSync(join(dir, 'STOPPED-conflict.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'conflict', beforeFirstCall: false, spentUsd: 0.01, resumeAfterStop: true, at: '2026-10-19T00:00:00.000Z', reason: 'the decider asked' }));
  return { r, n: stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1'), dir };
}

test('A member stopped at a conflict WAITS: its end kind waits for a choice, recovery holds it (no reconcile, no resume), --close is not refused as "already ended", and the status words name the conflict', async () => {
  const { r, n, dir } = await conflictStoppedTree();
  assert.deepEqual(runEndOf(dir), { kind: 'conflict_stopped' });
  assert.equal(waitsForChoice(runEndOf(dir)), true); assert.equal(waitsForChoice({ kind: 'round_stopped' }), true); assert.equal(waitsForChoice({ kind: 'closed' }), false); assert.equal(waitsForChoice(null), false);
  const record = readTreeRecord(r.t.rootDir);
  const plan = planRecovery(record, { runFactsOf: runId => ({ hasRunJson: true, runDir: join(r.t.runsDir, runId), end: runEndOf(join(r.t.runsDir, runId)), paused: pausedAtExternalSeat(join(r.t.runsDir, runId)) }), facts: GONE });
  assert.deepEqual(plan.filter(a => a.node === 'R/M1').map(a => [a.action, a.reason]), [['wait_for_person', 'conflict_stop']], JSON.stringify(plan));
  assert.equal(closeRefusal({ state: stateOf(record), runsDir: r.t.runsDir, node: 'R/M1', generation: 1, rootId: ROOT_ID, facts: GONE })?.kind === 'ended', false, 'a conflict-stopped member can be given up');
  assert.equal(describePhase({ ...n, phase: 'running' }, r.t.runsDir), 'stopped at a conflict the decider asked you to choose, waiting for your choice');
});
