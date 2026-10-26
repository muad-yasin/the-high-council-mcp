// G7, RULE 1c (every printed way out is one the state accepts), two lines that named a verb the state refuses:
//   item 1: readiness' generation_pending line for a decided root re-plan said "run `council tree approve`" even when the verb's own read (describeFrontier) refuses that frontier; it now names the cause (A-DRAFT).
//   2b: a rebuild refused because the root task does not read said "Close it"; the way on is the file, in readiness' own root_task_unreadable words (one copy, exported from src/tree-ready.js).
// Real all-mock trees, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readinessOf } from '../src/tree-ready.js';
import { rebuildRegisteredBundle } from '../src/tree-rebuild.js';
import { decideHandler } from '../src/tree-decide.js';
import { clearStop, requestStop, runTree } from '../src/tree-run.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const pendingLine = S => readinessOf(S.rootDir, { work: S.work }).reasons.find(x => x.code === 'generation_pending' && x.scope.startsWith('R@g'))?.text ?? '';

test('item 1: a decided root re-plan whose root chain was edited is NOT named as `council tree approve`\'s: the generation_pending line names the cause and the chain\'s way on; before the edit it names approve (control)', { timeout: 900_000 }, async () => {
  const S = await driveToDepthTwoReplan();
  assert.match(pendingLine(S), new RegExp(`^R: a new root plan \\(R@g2\\) was decided and its run is not registered yet: run \`council tree approve ${S.rootId}\`$`), 'control: the verb takes it');
  const file = join(S.work, 'chains', 'depth2-root.json');
  const c = JSON.parse(readFileSync(file, 'utf8')); c.description = `${c.description ?? ''} (edited after the tree registered it)`; writeFileSync(file, JSON.stringify(c, null, 2));
  const line = pendingLine(S);
  assert.match(line, /^R: a new root plan \(R@g2\) was decided and its run is not registered yet; `council tree approve \S+` cannot offer it now \(chain: the root chain cannot be read: the chain file depth2-root\.json is not the one the tree registered \(sha256 differs\)[^)]*\): put the chain file back as the tree registered it, or end the tree with `council tree decide \S+ --abandon`$/, line);       // CHANGED ACCEPTED (batch 17, the S13 dedupe): OLD end ": put the chain file back as the tree registered it$"
  assert.doesNotMatch(line, /: run `council tree approve/, line);
});

// as test/tree-bundle-rebuild.test.js builds it: a child of R/M1 registered and not started, then R/M1's plan accepted by the person, so the child's input is due for a rebuild
async function notStartedTree() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, hooks: { afterRegister: next => { if (next.kind === 'registered' && next.node.startsWith('R/M1/')) requestStop(r.t.rootDir); } } });
  const first = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(n => n.node.startsWith('R/M1/'));
  assert.equal(first.phase, 'registered', 'a child is registered and not started');
  return { r, start, first };
}

test('2b: a rebuild refused because the root task does not read names the file\'s way on in readiness\' own words, not "Close it"', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  const m1 = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === 'R/M1');
  const plan = join(r.t.runsDir, m1.runId, 'deliverable.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('A plan.', 'A plan, changed once.'));
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const stop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === 'R/M1').at(-1);
  assert.ok(stop, 'a stop is open on R/M1');
  const io = terminal([stop.id, 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'accept-plan': true, stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, io.errors());
  clearStop(r.t.rootDir);
  renameSync(r.rootTaskPath, `${r.rootTaskPath}.away`);
  const out = rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work });
  assert.equal(out.kind, 'refused', JSON.stringify(out));
  assert.equal(out.detail, `the input of ${first.node}@g${first.generation} cannot be rebuilt: the root task file does not read: put it back as the tree was started with; a different goal is a new tree, started with \`council tree start\`.`, out.detail);
  assert.doesNotMatch(out.detail, /Close it/);
});
