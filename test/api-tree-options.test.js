// 0.8.3 M1 (PLAN 8.3 step 2, D13): `api.run` gains three additive options, `criteria`, `runId` and `treeNode`, so a node starts exactly as the library starts any run. test/api.test.js is unchanged (the existing library
// behaviour is kept); the new options are tested here. Offline: the all-mock chain, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '../src/api.js';

function workdir() {
  const dir = mkdtempSync(join(tmpdir(), 'council-api-tree-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), '# Task\n\nPlan a small todo app.\n');
  return dir;
}
const ID = '2026-10-08T12-00-00-000Z';

test('runId: the run uses the folder name it was given; one that is not digits, T, Z and "-" is refused before anything starts', async () => {
  const dir = workdir();
  const res = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, runId: ID });
  assert.equal(res.runId, ID);
  assert.equal(res.exitCode, 0, res.outputTail);
  assert.ok(existsSync(join(dir, 'runs', ID, 'report.json')));
  for (const bad of ['../x', 'a b', '2026-10-08T12:00:00', '', 42]) await assert.rejects(api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, runId: bad }), TypeError, String(bad));
});

test('runId: a folder that already holds a run is refused; a folder that holds only the tree record (a tree root\'s) is accepted', async () => {
  const dir = workdir();
  await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, runId: ID });
  await assert.rejects(api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, runId: ID }), /already a run/);
  const rootId = '2026-10-08T12-30-00-000Z';
  mkdirSync(join(dir, 'runs', rootId, 'tree'), { recursive: true });
  const res = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, runId: rootId });
  assert.equal(res.exitCode, 2, 'the CLI still refuses a non-member run in a folder that exists');
  assert.match(res.outputTail, /already exists/);
});

test('criteria: the file is handed to the run (--criteria): run.json records it and the run uses that list, not a criteria seat', async () => {
  const dir = workdir();
  writeFileSync(join(dir, 'criteria.md'), 'The plan names every file it creates.\nThe plan says what happens on a crash.\n');
  const res = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, runId: ID, criteria: 'criteria.md' });
  assert.equal(res.exitCode, 0, res.outputTail);
  const meta = JSON.parse(readFileSync(join(dir, 'runs', ID, 'run.json'), 'utf8'));
  assert.ok(meta.criteriaFile.endsWith('criteria.md'), JSON.stringify(meta.criteriaFile));
  assert.deepEqual(res.report.criteria, ['The plan names every file it creates.', 'The plan says what happens on a crash.']);
});

test('treeNode: the lineage file reaches the CLI; a node the record does not hold is refused with exit 19, and the library reports it', async () => {
  const dir = workdir();
  mkdirSync(join(dir, 'bundles'));
  writeFileSync(join(dir, 'bundles', 'R.json'), JSON.stringify({ treeId: ID, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0 }));
  const res = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, runId: ID, treeNode: 'bundles/R.json' });
  assert.equal(res.exitCode, 19, res.outputTail);
  assert.match(res.outputTail, /Nothing was run and nothing was spent/);
  assert.equal(res.report, null);
});
