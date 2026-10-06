// 0.8.1 FX-10 (DR-11; found 2026-10-02 by the execution-contracts research): the criteria fingerprint covered each
// criterion's wording, not how it is checked, so an edited `check` or `on` left both report.json's criteria_sha256 and
// the HANDOFF.md lock block unchanged. Now report.json carries checks_sha256, and the lock block carries the check lines
// and a second marker that `council check-lock` verifies. criteria_sha256 and the first marker are unchanged, so a
// 0.8.0 HANDOFF.md still passes (with a note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lock from '../src/criteria-lock.js';
import { reportJsonShape } from '../src/report-shape.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const criteria = ['npm audit exits 0 at high', 'The plan names its rollback', 'p95 under 200 ms'];
const kinds = [
  { criterion: criteria[0], kind: 'checkable', check: 'npm audit --audit-level=high', on: 'build' },
  { criterion: criteria[1], kind: 'judgement' },
  { criterion: criteria[2], kind: 'checkable', check: 'k6 run load.js, p95 < 200 ms', on: 'build' },
];
const editedKinds = kinds.map((k, i) => (i === 2 ? { ...k, check: 'k6 run load.js, p95 < 900 ms' } : k));
const report = k => JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r', chain: 'c', task: 't', result: { criteria, criteriaKinds: k, stages: [], totals: {} } })));

test('FX-10: report.json checks_sha256 changes when a check is edited; criteria_sha256 does not', () => {
  const a = report(kinds), b = report(editedKinds);
  assert.match(a.checks_sha256 || '', /^[0-9a-f]{64}$/);
  assert.equal(a.criteria_sha256, b.criteria_sha256, 'the wording fingerprint is unchanged (a public contract)');
  assert.notEqual(a.checks_sha256, b.checks_sha256);
  const onEdited = report(kinds.map((k, i) => (i === 0 ? { ...k, on: 'plan' } : k)));
  assert.notEqual(a.checks_sha256, onEdited.checks_sha256, 'an edited `on` changes it too');
});

test('FX-10: the lock block lists each check under its criterion and check-lock fails when one is edited', () => {
  const checks = kinds.map(k => (k.kind === 'checkable' ? { check: k.check, on: k.on } : null));
  const block = lock.lockBlock(criteria, { runId: 'r', checks });
  assert.match(block, /^C1\. npm audit exits 0 at high\n {3}check: npm audit --audit-level=high \(on: build\)$/m);
  assert.match(block, /<!-- the-high-council:criteria-checks sha256=[0-9a-f]{64} count=2 -->/);
  assert.equal(lock.checkLock(block).ok, true, lock.checkLock(block).problems.join('; '));
  const edited = block.replace('p95 < 200 ms (on: build)', 'p95 < 900 ms (on: build)');
  assert.notEqual(edited, block);
  const r = lock.checkLock(edited);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /check/);
  // The first marker (the wording) still holds on the edited file: only the checks changed.
  assert.equal(lock.criteriaHash(criteria), lock.parseLock(edited).sha256);
});

test('FX-10: a 0.8.0 HANDOFF.md (no checks marker) still passes, with a note that it carries no checks fingerprint', () => {
  const old = readFileSync(join(root, 'test', 'fixtures', 'regression-081', 'HANDOFF-golden.md'), 'utf8');
  const r = lock.checkLock(old);
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.ok((r.notes || []).some(n => /no checks fingerprint/.test(n)), JSON.stringify(r.notes));
  const cli = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), 'check-lock', join(root, 'test', 'fixtures', 'regression-081', 'HANDOFF-golden.md')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout + cli.stderr, /no checks fingerprint/);
});

test('FX-10: check-lock --run compares the file\'s checks with the run\'s checks_sha256', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx10-'));
  const checks = kinds.map(k => (k.kind === 'checkable' ? { check: k.check, on: k.on } : null));
  writeFileSync(join(dir, 'HANDOFF.md'), `# Plan\n${lock.lockBlock(criteria, { runId: 'r', checks })}`);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report(editedKinds)));
  const cli = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), 'check-lock', 'HANDOFF.md', '--run', '.'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /check/);
  // M2 review: deleting the checks marker must not turn a --run comparison into a pass.
  const report0 = report(kinds);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report0));
  const marker = /\n<!-- the-high-council:criteria-checks [^>]*-->/;
  writeFileSync(join(dir, 'HANDOFF.md'), `# Plan\n${lock.lockBlock(criteria, { runId: 'r', checks }).replace(marker, '')}`);
  const gone = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), 'check-lock', 'HANDOFF.md', '--run', '.'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(gone.status, 1, gone.stdout + gone.stderr);
  assert.match(gone.stderr, /checks marker was removed/);
});
