// BUG-D-018 (bug audit 24 Okt 2026): a chain that omits `maxRounds` (lint accepts it: "or remove it for the default") really gets maxRounds ?? 2 passes (roundLimitsOf), but estimateChainRows looped on the raw
// config.maxRounds (undefined), so the dry run, the typed-limit suggestion and the tree grant check priced NO panel, critique or revise rows at all. The estimate must price the passes the run gets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { estimateChainRows } from '../src/cost.js';
import { dryRunReport } from '../src/dry-run.js';
import { roundLimitsOf } from '../src/overseer-rounds.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const withTwo = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));   // signoff unanimous, maxRounds 2
const omitted = (() => { const c = { ...withTwo }; delete c.maxRounds; return c; })();

test('NM-1 the run gets 2 passes from a chain that omits maxRounds (the premise)', () => {
  assert.equal(withTwo.maxRounds, 2);
  assert.equal(roundLimitsOf(omitted).passes, 2);
});

test('NM-2 estimateChainRows prices the same rows for a chain that omits maxRounds as for maxRounds 2 (expected and maximum), and they hold a second panel pass and a revise', () => {
  for (const maximum of [false, true]) {
    const a = estimateChainRows(omitted, { maximum });
    assert.deepEqual(a, estimateChainRows(withTwo, { maximum }), `maximum=${maximum}`);
    const labels = a.map(r => r.label);
    assert.ok(labels.some(l => l.startsWith('panel-2-')), `a second panel pass is priced: ${labels.join(', ')}`);
    assert.ok(labels.includes('revise-1'), `the revise between the passes is priced: ${labels.join(', ')}`);
  }
});

test('NM-3 the dry-run estimate of a chain without maxRounds equals the one with maxRounds 2 (rows, floor, expected, maximum), and its floor is not above its expected figure', () => {
  const a = dryRunReport(omitted, { taskChars: 4000, now: 0 });
  const b = dryRunReport(withTwo, { taskChars: 4000, now: 0 });
  assert.deepEqual(a.estimate, b.estimate);
  assert.deepEqual(a.rows, b.rows);
  assert.ok(a.rows.some(r => r.label === 'revise-1') && a.rows.some(r => r.label.startsWith('panel-2-')), 'the rows hold the second pass');
  assert.ok(a.estimate.floorUsd <= a.estimate.expectedUsd, JSON.stringify({ floor: a.estimate.floorUsd, expected: a.estimate.expectedUsd }));
});
