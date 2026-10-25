// 0.8.3 M6, the approval summary line (C&C, after the Finding-A fix-up's real-verb probe): the line `council tree approve` prints LAST - the one a person reads after typing y - must say what the text above it says. It counts only the children this
// approval starts (admitted and not registered yet) and names the already-registered ones as such. Before: "Up to $14.00 for 2 child runs (R/M1, R/M3)" on an approval whose own text said "Approving authorizes no new paid runs (every child
// above is already registered or not admitted)". Real `approveHandler`, real gate, the terminal helper: the person's screen is pinned, not probed. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { approveHandler } from '../src/tree-approve.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { decideHandler } from '../src/tree-decide.js';
import { parentChangedEvent } from '../src/tree-continuation.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren, pricedChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const approve = async r => {
  const key = findPendingFrontier({ rootDir: r.t.rootDir }).key;                  // the frontier that waits (a first one is not in the record yet)
  const io = terminal([key.slice(0, 8), 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  const line = io.shown().split('\n').filter(l => l.startsWith('Approved:')).at(-1);
  return { code, io, line };
};
const blockParent = r => appendTreeEvent(r.t.rootDir, parentChangedEvent({ scope: 'R/M1@g1', frontierKey: [...stateOf(readTreeRecord(r.t.rootDir)).frontiers.keys()][0], detail: 'the parent plan changed after the approval', ancestor: 'R' }));

test('THE FIRST APPROVAL: every admitted child is new - the line counts them and says the NEW children start with `council tree resume`', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() });
  const { code, line } = await approve(r);
  assert.equal(code, 0);
  assert.match(line, /^Approved: frontier [0-9a-f]{8}, revision 1\. Up to \$[0-9.]+ for 3 new child runs \(R\/M1, R\/M2, R\/M3\)\. Nothing has started: the new children start with `council tree resume /);
  assert.doesNotMatch(line, /Already registered/);
});

test('A RE-APPROVAL with one child already registered and two new: the line counts the TWO new runs and names the registered one as such', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1 });                    // R/M1 is registered and runs
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R/M1@g1'));
  blockParent(r);
  const { code, line, io } = await approve(r);
  assert.equal(code, 0);
  assert.match(line, /Up to \$[0-9.]+ for 2 new child runs \(R\/M2, R\/M3\)\. Already registered, not started by this approval: R\/M1\. Nothing has started: the new children start with `council tree resume /, line);
  assert.doesNotMatch(line, /3 child runs/);
  assert.match(io.shown(), /Approving authorizes up to \$[0-9.]+ of new paid runs/, 'the text above says the same');
});

test('A RE-APPROVAL with NOTHING new (a child closed before it started, the others registered): "No new run, $0.00", the registered ones named, never counted as runs to start', async () => {
  const sc = splitChildren(); const cfg = sc.extraChains['split-child'];
  const seat = { provider: 'mock', model: 'mock-plan-placeholder-url', maxTokens: 4000 };
  cfg.seats = { ...cfg.seats, builder: seat, reviser: seat };
  const r = await trackedRealRoot({ ...sc, plan: plan3() }); approvePending(r);
  for (let i = 0; i < 5; i += 1) await runTree(r.t.rootDir, { work: r.t.work });
  const d = terminal(['R/M2', 'y']); const timer = setTimeout(() => d.stdin.end(), 8000);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { close: 'R/M2' }, work: r.t.work, stdin: d.stdin, stdout: d.stdout, stderr: d.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0);
  blockParent(r);
  const { code, line, io } = await approve(r);
  assert.equal(code, 0);
  assert.match(line, /^Approved: frontier [0-9a-f]{8}, revision 2\. No new run, \$0\.00\. Already registered, not started by this approval: R\/M1, R\/M3\. Run `council tree resume /, line);
  assert.doesNotMatch(line, /child runs/);
  assert.match(io.shown(), /Approving authorizes no new paid runs/, 'the text above says the same');
});
