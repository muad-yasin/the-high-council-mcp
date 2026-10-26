// D2 F18 fold (C&C's ruling, 25 Okt 2026): a root task that does not READ feeds the derived tree-scope readiness reason root_task_unreadable (put-back words) beside root_task_changed; it clears itself when the file reads with the
// pinned bytes. And the fix-up ON TOP of a943f492 (C&C, G5+6): neither reason carries an absolute path, because readiness is printed in the tree handoff, which names nothing outside the runs folder. Real verbs, all-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { readinessOf } from '../src/tree-ready.js';
import { writeTreeHandoff } from '../src/tree-handoff.js';
import { readFileSync } from 'node:fs';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';
import { closedRootTree, newTree } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const UNREADABLE = 'root_task_unreadable at tree: the root task file does not read: put it back as the tree was started with; a different goal is a new tree, started with `council tree start`';

test('F18 fold: after a root re-plan, a root task file that does not read shows at TREE scope in `tree status` (root_task_unreadable, put-back words); with the file back it is gone', { timeout: 900_000 }, async () => {
  const S = await driveToDepthTwoReplan();
  const task = join(S.work, 'tasks', 'x.md');
  renameSync(task, `${task}.away`);
  const gone = renderTreeStatus(gatherStatusFacts(S.rootDir, { work: S.work }));
  assert.ok(gone.includes(`[blocked] ${UNREADABLE}`), gone);
  renameSync(`${task}.away`, task);
  const back = renderTreeStatus(gatherStatusFacts(S.rootDir, { work: S.work }));
  assert.equal(back.includes('root_task_unreadable'), false, back);
});

test('fix-up ON TOP of a943f492: a CHANGED root task gives the readiness reason and the tree handoff with no absolute path (the file is named by its name)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot();
  writeFileSync(join(r.t.work, 'tasks', 'x.md'), 'A different task.\n');
  const reason = readinessOf(r.t.rootDir, { work: r.t.work }).reasons.find(x => x.code === 'root_task_changed');
  assert.ok(reason, 'the changed task is a readiness reason');
  assert.match(reason.text, /the task file x\.md has changed since the tree was started/, reason.text);
  const handoff = readFileSync(writeTreeHandoff(r.t.rootDir, { work: r.t.work }).path, 'utf8');
  for (const text of [reason.text, handoff]) assert.ok(!text.includes(r.t.work) && !text.includes(tmpdir()), `no absolute path: ${text.slice(0, 600)}`);
  assert.ok(handoff.includes('the task file x.md has changed since the tree was started'), 'the handoff prints the reason');
});

test('an interrupted `tree start` (tree_started, the root not yet run: no run.json records a task) is NOT root_task_unreadable: the task file is intact and root_missing says what the state needs', () => {
  const t = newTree(); track(t.work);
  const codes = readinessOf(t.rootDir, { work: t.work }).reasons.map(x => x.code);
  assert.equal(codes.includes('root_task_unreadable'), false, JSON.stringify(codes));
});

test('a hand-built tree (closedRootTree: the fixture\'s root run.json records the pinned tasks/x.md, as a real root run does) reads its root task: no root_task_unreadable', () => {
  const t = closedRootTree(); track(t.work);
  const codes = readinessOf(t.rootDir, { work: t.work }).reasons.map(x => x.code);
  assert.equal(codes.includes('root_task_unreadable'), false, JSON.stringify(codes));
});
