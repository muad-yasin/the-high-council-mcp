// D2 F13b (T13b): the limit raise a pending frontier's screen points at is accepted BEFORE any preview of that frontier is recorded. The limit stop reads the pending frontier's live preview (read-only), so a child the
// children-per-split limit refuses on that screen is "waiting for this limit". Real all-mock tree, $0; the person answers n (nothing is raised).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, DEFAULT_LIMITS } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

test('T13b: with maxChildrenPerSplit 2 and a three-child split, `decide --max-children 3` before any approve shows the limit stop (the third child is waiting for this limit); answered n, nothing is recorded', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: { ...DEFAULT_LIMITS, maxChildrenPerSplit: 2 } });
  assert.equal(readTreeRecord(r.t.rootDir).events.some(e => e.event === 'frontier_previewed'), false, 'no preview is recorded yet');
  const io = terminal(['3', 'n']); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'max-children': '3' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  const shown = io.shown() + io.errors();
  assert.doesNotMatch(shown, /no child is waiting for this limit/, shown);
  assert.match(shown, /Raise maxChildrenPerSplit from 2 to 3/, shown);
  assert.notEqual(code, 0, 'answered n: not raised');
  assert.equal(readTreeRecord(r.t.rootDir).events.some(e => e.event === 'limit_raised'), false);
});
