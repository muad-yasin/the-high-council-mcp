// 0.8.3 M6 ledger item 4 (after the stale-views pick fb5a50f + c89e174): `council tree decide` that ends in exit 19 ("the tree refuses to record this") has told the person the record is not what they read, and a decide
// whose apply refuses may have moved the record on its way (a multi-event form, or another writer's event in the window): the two view files are rewritten there too, from the record as it is now, under the views lock. Never
// fatal. Real verb, real gate, a real root (the shape of test/tree-root-decide.test.js); the window between the rebuild and the lock is opened through the clock the handler passes to the approval's use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { writeTreeFiles } from '../src/tree-files.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { trackedRealRoot, track } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, IDS, syntheticRun } from './helpers/tree-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const viewsOf = r => ['TREE_HANDOFF.md', 'report.json'].map(f => { const p = join(treeDirOf(r.t.rootDir), f); return existsSync(p) ? readFileSync(p, 'utf8') : null; });

test('exit 19 refreshes the view files: a record that moved while the person read is what the files show afterwards (known-bad: without the refresh the files keep the old record)', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.equal(out.started.length, 1, JSON.stringify(out.started));
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  assert.deepEqual(writeTreeFiles(r.t.rootDir, { work: r.t.work }), []);
  const before = viewsOf(r);
  assert.ok(before[0] && before[1], 'the views exist before');
  // the window: after the form was rebuilt and before the lock (the 6th clock read: the approval's use), a node of the tree opens a stop - the set the person was shown changed, apply refuses (exit 19)
  let calls = 0; let moved = false;
  const now = () => { calls += 1; if (calls === 6 && !moved) { moved = true; appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId, source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] }); } return Date.now(); };
  const io = terminal(['Plan it again.\n.', stop.id, 'y']);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now }).finally(() => clearTimeout(timer));
  assert.equal(moved, true, 'the window was opened'); assert.equal(code, 19, io.shown() + io.errors());
  assert.match(io.errors(), /the tree refuses to record this: .*changed while you read/);
  const after = viewsOf(r);
  assert.notDeepEqual(after, before, 'the files follow the record: they changed');
  assert.deepEqual(writeTreeFiles(r.t.rootDir, { work: r.t.work }), []);
  assert.deepEqual(after, viewsOf(r), 'and they are exactly what a fresh render of the record gives');
  assert.equal(readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'decision_recorded').length, 0, 'nothing was decided');
});

test('exit 19 of the CLOSE form, the refusal that writes its own `blocked` line: a claim that appears after the form was rebuilt is refused by closeIncomplete under the lock (continuation_refused), and TREE_HANDOFF.md / report.json are rewritten up to the record position of that line (the views do not print a blocked line itself: they carry the record position, so a stale file is one position behind)', async () => {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {});
  assert.deepEqual(writeTreeFiles(t.rootDir, { work: t.work }), []);
  const before = [join(treeDirOf(t.rootDir), 'TREE_HANDOFF.md'), join(treeDirOf(t.rootDir), 'report.json')].map(f => readFileSync(f, 'utf8'));
  let calls = 0; let moved = false;
  const now = () => { calls += 1; if (calls === 6 && !moved) { moved = true; appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) }); } return Date.now(); };
  const io = terminal(['R/M1', 'y']);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { close: 'R/M1' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now }).finally(() => clearTimeout(timer));
  assert.equal(moved, true, 'the window was opened'); assert.equal(code, 19, io.shown() + io.errors());
  const refused = readTreeRecord(t.rootDir).events.filter(e => e.event === 'blocked' && e.reason === 'continuation_refused' && e.check === 'close');
  assert.equal(refused.length, 1, 'the refusal wrote its own blocked line');
  const all = readTreeRecord(t.rootDir).events; assert.equal(all.at(-1).id, refused[0].id, 'the blocked line is the last line of the record');
  const files = [join(treeDirOf(t.rootDir), 'TREE_HANDOFF.md'), join(treeDirOf(t.rootDir), 'report.json')];
  const after = files.map(f => readFileSync(f, 'utf8'));
  assert.notDeepEqual(after, before, 'the files follow the record: they changed');
  assert.ok(after[0].includes(`Record position: ${refused[0].id} `), 'TREE_HANDOFF.md is at the position of the blocked line, not one behind it'); assert.ok(!before[0].includes(`Record position: ${refused[0].id} `));
  assert.deepEqual(writeTreeFiles(t.rootDir, { work: t.work }), []);
  assert.deepEqual(after, files.map(f => readFileSync(f, 'utf8')), 'and they are exactly what a fresh render of the record gives, the blocked line and the claim included (the CLAIM alone moves the files too: the position assertion above is what pins the blocked line)');
});
