// The public JS API (src/api.js, the package's "." export). Offline: mock chains only.
// The point under test is that a run started through the library meets the same spend ceiling as
// one started from the command line, with no setup by the caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function workdir() {
  const dir = mkdtempSync(join(tmpdir(), 'council-api-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), '# Task\n\nPlan a small todo app.\n');
  return dir;
}
// A caller's own MAX_USD_PER_RUN must not leak into the default-ceiling test.
const cleanEnv = { MAX_USD_PER_RUN: undefined };

test('the package exports map names the API and nothing else under src/', () => {
  assert.equal(pkg.exports['.'].import, './src/api.js');
  assert.equal(pkg.exports['.'].types, './types/index.d.ts');
  assert.ok(existsSync(join(root, 'types', 'index.d.ts')));
  for (const key of Object.keys(pkg.exports)) assert.ok(['.', './package.json'].includes(key), `unexpected export ${key}`);
});

test('every function the types declare is exported, and nothing else', () => {
  const dts = readFileSync(join(root, 'types', 'index.d.ts'), 'utf8');
  const declared = [...dts.matchAll(/^export (?:declare )?function (\w+)/gm)].map(m => m[1]).sort();
  assert.deepEqual(Object.keys(api).sort(), declared);
});

test('runChain and the budget setters are not part of the public surface', () => {
  for (const internal of ['runChain', 'setBudget', 'setCache', 'invoke']) assert.ok(!(internal in api), internal);
});

test('price() matches the chain and costs nothing', () => {
  const p = api.price({ chain: 'mock-budget' });
  assert.equal(p.chain, 'mock-budget');
  assert.ok(p.totalUsd > 1, 'mock-budget is priced above $1 on paper');
  assert.equal(api.price({ chain: 'mock' }).totalUsd, 0);
  assert.equal(api.price({ chain: 'mock', rounds: 1 }).rounds, 1);
  assert.throws(() => api.price({ chain: '../etc/passwd' }), TypeError);
  assert.throws(() => api.price({ chain: 'no-such-chain' }), /no such chain/);
});

test('maxUsd 0, negative or not a number is refused before anything starts', async () => {
  const cwd = workdir();
  for (const maxUsd of [0, -1, NaN, '5', null]) {
    await assert.rejects(api.run({ chain: 'mock', task: 'tasks/x.md', cwd, maxUsd }), RangeError, String(maxUsd));
  }
  assert.ok(!existsSync(join(cwd, 'runs')), 'no run folder was created');
});

test('a run through the API finishes on the mock chain and returns its report', async () => {
  const cwd = workdir();
  const r = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd, maxUsd: 1 });
  assert.equal(r.exitCode, 0, r.outputTail);
  assert.equal(r.status, 'done');
  for (const k of ['proposals', 'signoff', 'totals']) assert.ok(k in r.report, k);
  const again = api.readRun(r.runDir);
  assert.equal(again.status, 'done');
  assert.ok(again.files.includes('report.json'));
  assert.equal(api.listRuns({ cwd }).length, 1);
});

test('the spend ceiling stops an API run, and a resume with a higher one continues it', async () => {
  const cwd = workdir();
  const stopped = await api.run({ chain: 'mock-budget', task: 'tasks/x.md', cwd, maxUsd: 1, env: cleanEnv });
  assert.equal(stopped.exitCode, 4, stopped.outputTail);
  assert.equal(stopped.status, 'budget_stopped');
  assert.ok(api.readRun(stopped.runDir).budgetStop.capUsd === 1);
  const resumed = await api.resume({ runDir: stopped.runDir, cwd, maxUsd: 'none', env: cleanEnv });
  assert.equal(resumed.status, 'done', resumed.outputTail);
});

test('with no maxUsd the CLI default ceiling ($7) still applies', async () => {
  const cwd = workdir();
  // mock-budget's worst case is above $7, so the default ceiling must stop it.
  assert.ok(api.price({ chain: 'mock-budget' }).totalUsd > 7);
  const r = await api.run({ chain: 'mock-budget', task: 'tasks/x.md', cwd, env: cleanEnv });
  assert.equal(r.status, 'budget_stopped', r.outputTail);
  assert.equal(api.readRun(r.runDir).budgetStop.capUsd, 7);
});
