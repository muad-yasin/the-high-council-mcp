// S5-05: STOPPED-budget.json gains one field, `gateStageUsd` (the figure the next resume must clear at the stopped stage; `projectedStageUsd` keeps the call's worst case). Two golden shapes with SYNTHETIC numbers (the key set and
// nesting of a real pilot stop record; no run id, no seat text, no real figure): the OLD shape, written before the field, must keep the suggestion it always gave; the NEW shape's suggestion is the exact total, the spend the resume starts
// from (recorded + the worst case assumed for replayed stages: 1.25 + 0.25) plus the gate's figure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResumability } from '../src/run-status.js';
import { resumeCeilingUsd } from '../src/resume-ceiling.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stopped-budget');
const folderWith = shape => { const dir = mkdtempSync(join(tmpdir(), 'thc-stopped-shape-')); copyFileSync(join(fixtures, `${shape}.json`), join(dir, 'STOPPED-budget.json')); return dir; };

test('the OLD shape (no gateStageUsd) keeps its suggestion: above both the cap and the spend, plus the worst case', () => {
  const s = runResumability(folderWith('old-shape'), {});
  assert.deepEqual([s.status, s.resumable, s.needs], ['budget_stopped', true, 'higher_cap']);
  assert.equal(s.suggestedMaxUsd, 5);        // ceil(max(cap 2, counted 1.5) + projected 3)
  assert.equal(s.stoppedAt.gateStageUsd, undefined);
});

test('the NEW shape reads the gate figure: run_status.suggestedMaxUsd is the counted spend plus gateStageUsd, exactly', () => {
  const s = runResumability(folderWith('new-shape'), {});
  assert.equal(s.suggestedMaxUsd, 2.25);     // 1.25 + 0.25 counted, + gate 0.75
  assert.equal(s.stoppedAt.projectedStageUsd, 3, 'the worst case keeps its meaning');
  assert.equal(s.stoppedAt.gateStageUsd, 0.75);
});

test('resumeCeilingUsd: the gate figure wins when present, an unreadable one falls back to the worst case, nothing finite gives null', () => {
  assert.equal(resumeCeilingUsd({ cap: 2, spent: 1.5, projected: 3, gate: 0.75 }), 2.25);
  assert.equal(resumeCeilingUsd({ cap: 2, spent: 1.5, projected: 3, gate: 'x' }), 5);
  assert.equal(resumeCeilingUsd({ cap: 2, spent: 1.5, projected: 3 }), 5);
  assert.equal(resumeCeilingUsd({ cap: 2, spent: NaN, projected: 3, gate: 0.75 }), null);
});
