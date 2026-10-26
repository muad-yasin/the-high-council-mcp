// The root task pin (0.8.3 M6 S5 commit 3; C&C ruling 12 Oct): `council tree start` records WHICH task the tree's root answers in tree.json (`rootTask: { task, cwd, taskHash }`, the same three values run.json carries
// for a run: the task file's absolute path, the folder the run was started from, and the hash made by the same function), so that a root that never ran (no run.json) still has its task on record. The readers never
// throw: an old tree.json without the field reads as "unknown", a damaged field as "unusable"; a task outside the working folder is fine (a normal run accepts one, the pin must not refuse what the run accepts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTreeFile, readTreeRecord, startTree } from '../src/tree-record.js';
import { checkRootTaskPin, makeRootTaskPin, rootTaskPinFrom } from '../src/tree-task-pin.js';
import { taskHashOf } from '../src/scope-freeze.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'thc-pin-')); made.push(d); return d; };
const SHA = 'a'.repeat(64);   // a chain file's sha256 in tree.json
const H12 = 'abcdef012345';   // a task hash as run.json carries it (12 hex characters)
const CHAINS = [0, 1, 2].map(depth => ({ depth, name: depth ? 'priced-debate' : 'split-root', sha256: SHA }));
const GOLDEN = join(import.meta.dirname, 'fixtures', 'tree-json', 'tree-35a9b38.json');

test('PIN-1 an old tree.json (frozen from 35a9b38, no rootTask) reads as "unknown" - never a throw - and the record still loads with its hash intact', () => {
  const dir = tmp(); const rootDir = join(dir, '2026-10-12T00-00-00-000Z'); mkdirSync(join(rootDir, 'tree'), { recursive: true });
  copyFileSync(GOLDEN, join(rootDir, 'tree', 'tree.json'));
  const rec = readTreeRecord(rootDir);
  assert.ok(!rec.treeError, 'the record loads'); assert.equal(rec.tree.schema, 'tree/1'); assert.equal(rec.tree.rootCapUsd, 5);
  assert.deepEqual(rootTaskPinFrom(rec.tree), { status: 'unknown' });
  assert.deepEqual(rootTaskPinFrom(JSON.parse(readFileSync(GOLDEN, 'utf8'))), { status: 'unknown' }, 'the frozen file itself');
});

test('PIN-2 a damaged field reads as "unusable" with a reason and never throws: a wrong type, a missing field, a bad hash shape', () => {
  const good = { task: '/w/tasks/x.md', cwd: '/w', taskHash: H12 };
  assert.deepEqual(rootTaskPinFrom({ rootTask: good }), { status: 'ok', pin: good });
  for (const [label, rootTask] of [['a string', 'x'], ['null', null], ['an array', []], ['a number', 7],
    ['no task', { cwd: '/w', taskHash: H12 }], ['task not a string', { ...good, task: 5 }], ['an empty task', { ...good, task: '' }],
    ['no cwd', { task: good.task, taskHash: H12 }], ['cwd not a string', { ...good, cwd: false }],
    ['no hash', { task: good.task, cwd: good.cwd }], ['a short hash', { ...good, taskHash: 'abc' }], ['an upper-case hash', { ...good, taskHash: 'A'.repeat(12) }], ['a non-hex hash', { ...good, taskHash: 'z'.repeat(12) }], ['a full-width sha256 (run.json carries 12)', { ...good, taskHash: SHA }]]) {
    const r = rootTaskPinFrom({ rootTask });
    assert.equal(r.status, 'unusable', label); assert.match(r.reason, /\S/, label);
  }
  for (const tree of [null, undefined, 'x', 5, []]) assert.deepEqual(rootTaskPinFrom(tree), { status: 'unknown' }, String(tree));
  assert.equal(rootTaskPinFrom({ rootTask: { ...good, extra: 1 } }).status, 'ok', 'an additional key is not damage (the record is additive)');
});

test('PIN-3 a task OUTSIDE the working folder is accepted by the pin (a normal run accepts one); the file is checked by its hash: changed, missing and unreadable files read as unusable', () => {
  const work = tmp(); const elsewhere = tmp(); const file = join(elsewhere, 'task.md'); writeFileSync(file, 'Plan a tiny change.\n');
  const pin = makeRootTaskPin(file, work);
  assert.deepEqual(pin, { task: file, cwd: work, taskHash: taskHashOf('Plan a tiny change.\n') }, 'the same three values and the same hash function as run.json');
  assert.equal(rootTaskPinFrom({ rootTask: pin }).status, 'ok');
  // CHANGED ACCEPTED TEST (lane T, G2, C&C's Q5 ruling B): the check now RETURNS the text it read and hashed (one read: src/tree-task-pin.js readTaskAgainstPin), so no caller reads the file a second time after the check. BEFORE { ok, path }.
  assert.deepEqual(checkRootTaskPin(pin), { ok: true, path: file, text: 'Plan a tiny change.\n' });
  writeFileSync(file, 'A DIFFERENT task.\n');
  const changed = checkRootTaskPin(pin); assert.equal(changed.ok, false); assert.match(changed.reason, /changed/);
  const gone = checkRootTaskPin({ ...pin, task: join(elsewhere, 'missing.md') }); assert.equal(gone.ok, false); assert.match(gone.reason, /cannot be read/);
  const dir = checkRootTaskPin({ ...pin, task: elsewhere }); assert.equal(dir.ok, false);
  assert.equal(checkRootTaskPin({ task: 5 }).ok, false, 'a damaged pin is unusable, not a throw');
  // a relative path resolves against the recorded cwd, as run.json's task does
  const rel = checkRootTaskPin({ task: 'task.md', cwd: elsewhere, taskHash: taskHashOf('A DIFFERENT task.\n') }); assert.deepEqual(rel, { ok: true, path: file, text: 'A DIFFERENT task.\n' });     // CHANGED ACCEPTED (as above): BEFORE { ok, path }
});

test('PIN-4 createTreeFile writes the pin when given one (and only then), refuses a damaged one before writing, and the tree_started hash covers the field', () => {
  const dir = tmp(); const work = tmp(); const file = join(work, 'x.md'); writeFileSync(file, 'Plan.\n'); const pin = makeRootTaskPin(file, work);
  const rootDir = join(dir, '2026-10-12T00-00-01-000Z');
  startTree(rootDir, { rootCapUsd: 5, chains: CHAINS, rootTask: pin, now: () => Date.parse('2026-10-12T00:00:00Z') });
  const rec = readTreeRecord(rootDir); assert.deepEqual(rec.tree.rootTask, pin); assert.equal(rec.events[0].treeJsonSha256, rec.treeSha256);
  assert.deepEqual(rootTaskPinFrom(rec.tree), { status: 'ok', pin });
  const plain = join(dir, '2026-10-12T00-00-02-000Z'); startTree(plain, { rootCapUsd: 5, chains: CHAINS }); assert.equal('rootTask' in readTreeRecord(plain).tree, false, 'no pin given, no field written');
  const bad = join(dir, '2026-10-12T00-00-03-000Z');
  for (const rootTask of ['x', { task: 5, cwd: work, taskHash: H12 }, { task: file, cwd: work, taskHash: 'nope' }]) assert.throws(() => createTreeFile(bad, { rootCapUsd: 5, chains: CHAINS, rootTask }), TypeError);
  assert.equal(existsSync(join(bad, 'tree')), false, 'nothing was written for a refused pin: not even the folder');
});
