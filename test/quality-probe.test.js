// test/quality-probe.test.js
//
// v5 §1 candidate 15, Phase 1: named `test_quality_probe_smoke` / includes `defect_seed` in its
// test names per the plan's `pytest -k defect_seed` equivalent (this project's own runner is
// `node --test`, not pytest). No API key, no network call - the "panel" is three deterministic
// heuristic detectors (test/quality-probe/detectors.js), not real labs; see
// test/quality-probe/README.md for what this measures and does not mean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runQualityProbe } from './quality-probe/probe.js';
import { FIXTURES, DEFECT_TYPES } from './quality-probe/fixtures.js';

test('test_quality_probe_smoke (defect_seed): catch count is recorded against a baseline, no API key, offline', () => {
  const result = runQualityProbe();
  assert.equal(result.fixtureCount, FIXTURES.length);
  assert.equal(result.fixtureCount, 5);
  assert.deepEqual(result.defectTypes, DEFECT_TYPES);
  assert.equal(result.defectTypes.length, 5);
  assert.equal(typeof result.baseline, 'string');
  assert.ok(result.baseline.length > 0);
  assert.equal(result.rows.length, result.fixtureCount * result.defectTypes.length);
});

test('defect_seed: unanimity and catch-rate are reported as separate numbers, never merged', () => {
  const result = runQualityProbe();
  assert.ok('catchRate' in result.overall);
  assert.ok('unanimityRate' in result.overall);
  assert.notEqual(result.overall.catchRate, undefined);
  assert.notEqual(result.overall.unanimityRate, undefined);
  // The two numbers must be independently computable, i.e. not always equal - a probe that only
  // ever reports them as the same number has silently collapsed back into "agreement == correct".
  const distinctPerType = result.defectTypes.some(t =>
    result.byDefectType[t].catchRate !== result.byDefectType[t].unanimityRate);
  assert.ok(distinctPerType, 'at least one defect type must show catch-rate and unanimity diverge');
});

test('defect_seed: every planted defect instance is graded by all three sensitivity tiers', () => {
  const result = runQualityProbe();
  for (const row of result.rows) {
    assert.deepEqual(Object.keys(row.votes).sort(), ['loose', 'medium', 'strict']);
    assert.equal(row.caught, Object.values(row.votes).filter(Boolean).length >= 2);
  }
});

test('defect_seed: the summary carries its own caveat and never claims real-world or comparative efficacy', () => {
  const result = runQualityProbe();
  assert.equal(typeof result.caveat, 'string');
  const c = result.caveat.toLowerCase();
  assert.ok(c.includes('planted'), 'caveat must say the defects were planted, not real-world');
  assert.ok(c.includes('not a comparison') || c.includes('not real-world'));
  // The forbidden sentence itself must be named inside the caveat, not just implied.
  assert.ok(result.caveat.includes('The High Council catches'));
});

test('defect_seed: a clean baseline draft (no planted defect) is available per fixture for comparison', () => {
  for (const fixture of FIXTURES) {
    assert.equal(typeof fixture.baseline, 'string');
    assert.ok(fixture.baseline.length > 0);
    // The baseline must differ from every one of its own planted-defect drafts.
    for (const type of DEFECT_TYPES) assert.notEqual(fixture.baseline, fixture.defects[type]);
  }
});

test('defect_seed: this module is never imported by any runtime src/ file (Phase 1 must stay test-only)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = join(root, 'src');

  // Recursive: src/mcp/ and src/ui/ are real subdirectories with their own runtime files (e.g.
  // ui/server.js walks runs/), and a non-recursive scan here would silently stop guarding this
  // hard constraint the moment someone added an import to either one.
  const offenders = [];
  const walk = dir => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) { walk(p); continue; }
      if (!name.name.endsWith('.js')) continue;
      if (/quality-probe/.test(readFileSync(p, 'utf8'))) offenders.push(p);
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [], `no src/ file may import the quality probe: ${offenders.join(', ')}`);
});
