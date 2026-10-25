// CR-RC-006: the root task reader (src/tree-task-pin.js readTaskAgainstPin, the one read every root-task route goes through) never opens a path the secret denylist names, on every route. `tree start` refuses such a --task
// (src/tree-start.js, the same words, one copy), so a recorded one is an edit of run.json after the start. The answer must not tell whether a file of that name exists: before the fix a present file read as "changed" (its
// hash differs from the pin) and an absent one as "cannot be read", an existence oracle on a secrets path. Real tree, all-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootTaskOf } from '../src/tree-root-task.js';
import { readinessOf } from '../src/tree-ready.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { isDeniedPath } from '../src/tools.js';
import { trackedRealRoot } from './helpers/temp-trees.js';

const NEVER_READ = 'the task file .env: a file of that name is never read (it looks like a secrets file)';

/** A real root whose run.json `task` is rewritten to `.env` after the start; `present` writes a file of that name (its bytes are not the pinned task's). */
async function deniedRoot(present) {
  const r = await trackedRealRoot();
  const meta = join(r.t.rootDir, 'run.json');
  writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, 'utf8')), task: '.env' }));
  if (present) writeFileSync(join(r.t.work, '.env'), 'NOT_A_SECRET=placeholder\n');
  return r;
}

test('CR-RC-006: a recorded root task path the denylist names is refused with the never-read words, and the SAME words whether a file of that name exists or not (no existence oracle)', { timeout: 600_000 }, async () => {
  const roots = [await deniedRoot(true), await deniedRoot(false)];
  const refusals = roots.map(r => rootTaskOf(r.t.rootDir, { work: r.t.work }).refusal);
  assert.equal(refusals[0]?.detail, refusals[1]?.detail, `the answer does not say whether the file exists: ${JSON.stringify(refusals)}`);
  for (const [i, r] of roots.entries()) {
    assert.deepEqual([refusals[i]?.code, refusals[i]?.detail], ['root_task_unreadable', NEVER_READ]);
    const codes = readinessOf(r.t.rootDir, { work: r.t.work }).reasons.map(x => x.code);
    assert.ok(codes.includes('root_task_unreadable') && !codes.includes('root_task_changed'), JSON.stringify(codes));
    const mcp = renderTreeStatus(gatherStatusFacts(r.t.rootDir, { work: r.t.work, deny: isDeniedPath }));     // the MCP tree_status route's own call (src/mcp/tree-status.js)
    assert.ok(mcp.includes('root_task_unreadable at tree') && !mcp.includes('root_task_changed'), mcp);
  }
});
