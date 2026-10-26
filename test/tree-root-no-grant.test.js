// CR-SOL-004 (RULE 1c): a ROOT whose spend reached its grant gets a next command at its member start, chosen by phase, and only one the tree takes. `--close` refuses the root (src/tree-close.js), so the child's way out (D2 F13c
// S10) is not it. A root STOPPED at its cap, with money free in the root cap: the top-up form, and `council tree decide --top-up` then takes it. An INTERRUPTED root (its run never ended): no top-up is taken (only a stopped
// node) and a cap raise moves no grant, so the way on is to end the tree. Synthetic all-mock trees written through the table, as the S10 test builds its interrupted child (test/tree-printed-ways-f13.test.js); the cap raise
// and the top-up go through `council tree decide`'s own handler. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { memberStart } from '../src/tree-member.js';
import { decideHandler } from '../src/tree-decide.js';
import { ROOT_ID, claim, hostnameOf, newTree, reservedLine, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

const DEAD_CLAIM = { pidAlive: () => false };

/** R registered (its grant: the cap, 5) and STARTED (our claim, read as dead: interrupted), its one paid stage reserved and settled at the whole grant; `stopped` adds the node_stopped a budget stop writes. */
function rootSpent({ stopped }) {
  const t = newTree({ cap: 5 }); track(t.work);
  registerRoot(t.rootDir);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  syntheticRun(t, ROOT_ID, { usage: [{ file: 'build', usd: 5, reservationId: 'r1' }] });
  writeLines(t, ROOT_ID, 'R', [reservedLine('r1', 5, 'build')]);
  writeLines(t, ROOT_ID, 'R', [settledLine('r1', 'recorded', 5)]);
  if (stopped) appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R', generation: 1, runId: ROOT_ID, reason: 'budget' });
  return t;
}
const startRoot = t => {
  try { memberStart({ runDir: join(t.runsDir, ROOT_ID), runId: ROOT_ID, lineage: { treeId: ROOT_ID, node: 'R', generation: 1, attempt: 1 }, purpose: 'run', capAskedUsd: 5, chainPath: join(t.work, 'chains', 'split-root.json'), inputs: {}, piiGate: null, piiAllow: [], allowSecretShaped: false, ceiling: null, work: t.work, facts: DEAD_CLAIM }); return null; } catch (e) { return e; }
};
// the root's claim is this test process's own pid, alive: the dead-claim seam (as the member start gets) makes it read as the interrupted root it stands for, for `decide` too (its cap amendment refuses a live claim)
const decide = async (t, flags, answers) => {
  const io = terminal(answers); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), facts: DEAD_CLAIM }).finally(() => clearTimeout(timer));
  return { code, text: io.shown() + io.errors() };
};
const TOP_UP = `. Resuming it needs a larger grant: \`council tree decide ${ROOT_ID} --top-up R@g1 --amount <usd>\`.`;
const ABANDON = `. Nothing is left of its grant: end the tree with \`council tree decide ${ROOT_ID} --abandon\`.`;

test('CR-SOL-004: a root STOPPED at its cap with money free names the top-up form, and `council tree decide --top-up` takes it', { timeout: 300_000 }, async () => {
  const t = rootSpent({ stopped: true });
  assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.get('R@g1').phase, 'stopped');
  const raise = await decide(t, { 'amend-cap': '8' }, ['8', 'y']); assert.equal(raise.code, 0, raise.text);       // money free in the root cap; the root's own grant stays 5
  const e = startRoot(t);
  assert.ok(e instanceof TreeRefusal, String(e));
  assert.match(e.reason, /^R@g1 has no live grant: /, e.reason);
  assert.ok(e.reason.endsWith(TOP_UP), e.reason);
  const top = await decide(t, { 'top-up': 'R@g1', amount: '1' }, ['1', 'y']);
  assert.equal(top.code, 0, `the command the refusal names is taken: ${top.text}`);
});

test('CR-SOL-004: an INTERRUPTED root (its run never ended) names the end of the tree, not a top-up the form would refuse, even with money free in the root cap', { timeout: 300_000 }, async () => {
  const t = rootSpent({ stopped: false });
  assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.get('R@g1').phase, 'running');
  const raise = await decide(t, { 'amend-cap': '8' }, ['8', 'y']); assert.equal(raise.code, 0, raise.text);
  const e = startRoot(t);
  assert.ok(e instanceof TreeRefusal, String(e));
  assert.match(e.reason, /^R@g1 has no live grant: /, e.reason);
  assert.ok(e.reason.endsWith(ABANDON), e.reason);
  assert.doesNotMatch(e.reason, /--top-up|--close R/);
});
