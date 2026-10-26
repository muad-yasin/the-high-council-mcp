// 0.8.3 M6 entry 3, commit 2 (audit batch 3 J1-03-1; Muad: "why would it stay blocked after repairing?"): `record_corrupt` is DERIVED from the current read, not from a recorded `blocked` line. A damaged line makes the tree blocked while the file does not read
// (nothing but a blocked record is appended, no paid start runs); a person who repairs the file in place gets a tree that is not blocked, and the recorded line stays as the incident's history. Real tree, real sitting, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, EVENTS_FILE, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { foldRecord } from '../src/tree-transitions.js';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const GARBAGE = 'this is not json\n';
const fileOf = r => join(treeDirOf(r.t.rootDir), EVENTS_FILE);
const corruptAndRefuse = async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  appendFileSync(fileOf(r), GARBAGE);
  assert.equal(readTreeRecord(r.t.rootDir).corrupt.length, 1);
  assert.throws(() => appendTreeEvent(r.t.rootDir, { event: 'node_started', node: 'R', generation: 1, runId: 'x', pid: process.pid, host: 'h' }), e => e.code === 'record_corrupt');   // writes the blocked record_corrupt line
  return r;
};
const repair = (r, lines = GARBAGE) => writeFileSync(fileOf(r), readFileSync(fileOf(r), 'utf8').replace(lines, ''));

test('RED TARGET: corrupt, the blocked line is written, the person repairs the file in place -> the tree is NOT blocked: no sticky record_corrupt, registerNextChild is not blocked, a real sitting is not blocked; the recorded line stays as history', async () => {
  const r = await corruptAndRefuse();
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).sticky.has('record_corrupt'), 'while the file does not read: blocked (derived)');
  assert.deepEqual(registerNextChild(r.t.rootDir, { work: r.t.work }), { kind: 'blocked', reasons: ['record_corrupt'] });
  repair(r);
  const rec = readTreeRecord(r.t.rootDir);
  assert.equal(rec.corrupt.length, 0, 'the file reads again');
  assert.ok(rec.events.some(e => e.event === 'blocked' && e.reason === 'record_corrupt'), 'the recorded line stays as history');
  assert.equal(stateOf(rec).sticky.has('record_corrupt'), false, 'and is not a block');
  assert.notEqual(registerNextChild(r.t.rootDir, { work: r.t.work }).kind, 'blocked');
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.notEqual(out.status, 'blocked', JSON.stringify(out).slice(0, 300));
});

test('a repair that leaves ANOTHER damaged line keeps the block (derived from what the file reads NOW), also after an era boundary opens on the fold', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  appendFileSync(fileOf(r), 'bad one\n'); appendFileSync(fileOf(r), 'bad two\n');
  assert.equal(readTreeRecord(r.t.rootDir).corrupt.length, 2);
  repair(r, 'bad one\n');
  assert.equal(readTreeRecord(r.t.rootDir).corrupt.length, 1);
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).sticky.has('record_corrupt'), 'one damaged line left: still blocked');
  // an era boundary on a fold cannot lift a corruption block that is derived from the read
  const events = [{ id: 'e1', event: 'tree_started', treeId: 't' }];
  const rec = { events, corrupt: [{ line: 3, reason: 'not json' }] };
  assert.ok(stateOf(rec).sticky.has('record_corrupt'));
  assert.ok(stateOf({ ...rec, events: [...events, { id: 'e2', event: 'generation_opened', decisionId: 'e0', nodes: [{ node: 'R', generation: 2 }] }] }).sticky.has('record_corrupt'), 'the boundary does not lift a real corruption');
  assert.equal(foldRecord(events).sticky.has('record_corrupt'), false, 'a bare fold of events has no read, so no derived block');
});
