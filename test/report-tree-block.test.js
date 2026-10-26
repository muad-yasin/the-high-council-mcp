// The `tree` block of report.json (0.8.3 M6 slice S7; PLAN 10.4, M6 exit 15): a tree MEMBER's report.json (and its report-partial.json) carries its lineage, exactly the `tree` field of its run.json; a run that is
// no member has no such key; schemas/report-v1.json documents it (description, x-stability experimental) and the member's real report validates. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain } from '../src/chain.js';
import { partialReportJsonShape, reportJsonShape } from '../src/report-shape.js';
import { runTree } from '../src/tree-run.js';
import { TREE_FIELDS } from '../src/tree-member.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot, track } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const LINEAGE = { treeId: '2026-10-08T11-00-00-000Z', node: 'R/M2', generation: 2, attempt: 1, parentNode: 'R', depth: 1, splitSha256: 'a'.repeat(64), bundleSha256: null };

test('the schema documents `tree`: a description, x-stability experimental, and exactly the eight lineage fields of run.json (src/tree-member.js TREE_FIELDS)', async () => {
  const p = schema.properties.tree;
  assert.ok(p, 'tree is a property of report.json');
  assert.equal(p['x-stability'], 'experimental'); assert.ok(p.description.length > 80);
  assert.deepEqual(Object.keys(p.properties).sort(), [...TREE_FIELDS].sort()); assert.deepEqual([...p.required].sort(), [...TREE_FIELDS].sort());
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const base = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'x', chain: config.name, task: 't', result: await runChain({ request: 'Plan a small offline tool.', config, log: () => {} }), config })));
  assert.equal(validate(base), true, `the control: a real report without a tree validates (${JSON.stringify(validate.errors)})`);
  assert.equal(validate({ ...base, tree: LINEAGE }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, tree: { ...LINEAGE, generation: 0 } }), false, 'bad input: generation 0 is refused');
  assert.equal(validate({ ...base, tree: { ...LINEAGE, extra: 1 } }), false, 'bad input: a ninth field is refused');
});


test('reportJsonShape and partialReportJsonShape write `tree` exactly as given, and no key at all for a run that is no member', async () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const result = await runChain({ request: 'Plan a small offline tool.', config, log: () => {} });
  const base = { runId: 'x', chain: config.name, task: 't', result };
  assert.deepEqual(reportJsonShape({ ...base, tree: LINEAGE }).tree, LINEAGE);
  assert.equal('tree' in reportJsonShape(base), false); assert.equal('tree' in reportJsonShape({ ...base, tree: null }), false);
  const part = partialReportJsonShape({ stoppedBy: 'budget', ...base, tree: LINEAGE });
  assert.deepEqual(part.tree, LINEAGE); assert.equal(part.partial, true);
  assert.equal('tree' in partialReportJsonShape({ stoppedBy: 'budget', ...base }), false);
});

test('a REAL member run (the root and a child of a priced mock tree): report.json `tree` deep-equals run.json `tree` and the report validates against the schema; a plain run has none', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const member = readdirSync(r.t.runsDir).find(d => d !== ROOT_ID && /^\d{4}-/.test(d));
  for (const id of [ROOT_ID, member]) {
    const meta = json(join(r.t.runsDir, id, 'run.json')); const report = json(join(r.t.runsDir, id, 'report.json'));
    assert.ok(meta.tree && meta.tree.treeId === ROOT_ID, `${id}: run.json carries the lineage`);
    assert.deepEqual(report.tree, meta.tree, `${id}: report.json carries the same lineage`);
    assert.equal(validate(report), true, `${id}: ${JSON.stringify(validate.errors)}`);
  }
  assert.equal(json(join(r.t.runsDir, member, 'report.json')).tree.node.startsWith('R/'), true);
  const dir = track(mkdtempSync(join(tmpdir(), 'thc-report-tree-'))); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a small offline tool.');
  const run = spawnSync('node', [join(root, 'src', 'cli.js'), '--chain', 'mock', '--task', 'tasks/x.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  const id = readdirSync(join(dir, 'runs'))[0]; assert.ok(id, `${run.stdout}${run.stderr}`);
  assert.equal('tree' in json(join(dir, 'runs', id, 'report.json')), false, 'a plain run\'s report has no tree key');
});
