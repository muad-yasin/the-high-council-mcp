// READ-B LB-2 (ii) through the REAL verbs (C&C's PASS condition for the LB group, after CR-G2-001: a route tested only below the verb it serves): a root task whose only heading is an exclusions heading is split, the split is
// verified, the frontier approved, and the child's bundle carries the WHOLE task under the label that names the case. Before LB-2 every split of such a task was refused at verification (context_refs). All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTree } from '../src/tree-run.js';
import { bundleDirName } from '../src/tree-continuation.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const TASK = 'Build X.\n\n## Non-goals\nNo Android.\n';

test('LB-2 (ii), real verbs: a root task whose only heading is "Non-goals" is split and verified, and the child\'s bundle holds the whole task under "its only headings are exclusions headings"', { timeout: 400_000 }, async () => {
  const b = block3(); for (const c of b.children) c.context_refs = ['root-task: Non-goals', 'parent-plan: Overview'];
  const r = await trackedRealRoot({ ...pricedChildren(), task: TASK, plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });     // realRoot runs the root and verifies its split (it asserts no refusal)
  assert.ok(r.split, 'the split is verified');
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), maxStarts: 1 });
  const ctx = readFileSync(join(r.t.rootDir, 'tree', 'inputs', bundleDirName('R/M1', 1), 'context.md'), 'utf8');
  const part2 = ctx.slice(ctx.indexOf('## 2. '), ctx.indexOf('## 3. '));
  assert.match(part2, /----- root task x\.md \(sha256 [0-9a-f]{64}\), the whole file: its only headings are exclusions headings \(context_refs "root-task: Non-goals" resolve to it\) -----\nBuild X\.\n\n## Non-goals\nNo Android\.\n----- end -----/, part2);
});
