// 0.8.1 FX-3 (the 2026-10-02 audit of 0.8.0, finding 3): `--dry-run --json` gave worstCaseWithTaskUsd null and
// worstCaseAboveDefault false for a chain with no `estimate` block and a task longer than its assumed prompt, because
// the reprice spread an empty estimate and summed NaN. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 0.8.2 (owner, 6 Oct 2026, archive the unused chains): cheap and plan-debate moved to archive/chains/; cheap-7-v2 and plan-daily-7 stand in below.
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

test('FX-3: a chain with no estimate and an 80,000-character task gets a finite worst case, and a $0.01 cap reads as exceeded', () => {
  const c = chain('cheap-7-v2');
  delete c.estimate;
  const r = dryRunReport(c, { taskChars: 80_000, defaultCapUsd: 0.01 });
  assert.ok(Number.isFinite(r.estimate.worstCaseWithTaskUsd), `worstCaseWithTaskUsd ${r.estimate.worstCaseWithTaskUsd}`);
  assert.ok(r.estimate.worstCaseWithTaskUsd > r.estimate.worstCaseUsd, 'a task larger than the assumption costs more');
  assert.equal(r.cap.worstCaseAboveDefault, true);
});

test('FX-3 (M2 review): a partial estimate block (promptTokens only) is filled from the defaults: finite, and over a $0.01 cap', () => {
  const c = chain('plan-daily-7');
  c.estimate = { promptTokens: 4000 };
  const r = dryRunReport(c, { taskChars: 80_000, defaultCapUsd: 0.01 });
  assert.ok(Number.isFinite(r.estimate.worstCaseUsd), `worstCaseUsd ${r.estimate.worstCaseUsd}`);
  assert.ok(Number.isFinite(r.estimate.worstCaseWithTaskUsd), `worstCaseWithTaskUsd ${r.estimate.worstCaseWithTaskUsd}`);
  assert.equal(r.cap.worstCaseAboveDefault, true);
});

test('FX-3: the over-cap flag compares finite numbers only: a chain with an estimate keeps its old answer', () => {
  const c = chain('cheap-7-v2');
  const r = dryRunReport(c, { taskChars: 80_000, defaultCapUsd: 100 });
  assert.ok(Number.isFinite(r.estimate.worstCaseWithTaskUsd));
  assert.equal(r.cap.worstCaseAboveDefault, false);
});
