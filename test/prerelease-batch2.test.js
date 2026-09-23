// Pre-release audit batch 2 fixes that need no run folder of their own
// (Review/PreRelease_Audit_{moneypath,providers,cli,metrics}_2026-09-23.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIdToDate, spendReport } from '../src/spend.js';

test('metrics #3: runIdToDate accepts only a whole run id, so a renamed copy is not counted twice', () => {
  assert.ok(runIdToDate('2026-09-23T10-06-06-899Z') instanceof Date);
  for (const id of ['old-2026-09-23', '2026-09-23', '2026', 'x2026-09-23T10-06-06-899Z', '2026-09-23T10-06-06-899Z-copy']) {
    assert.equal(runIdToDate(id), null, id);
  }
  const runs = mkdtempSync(join(tmpdir(), 'runid-'));
  const now = new Date();
  const id = now.toISOString().replace(/[:.]/g, '-');
  for (const name of [id, `old-${id.slice(0, 10)}`]) {
    mkdirSync(join(runs, name));
    writeFileSync(join(runs, name, 'report.json'), JSON.stringify({ chain: 'c', totals: { usd: 1.5 } }));
  }
  const r = spendReport(runs, { days: 1, now: now.getTime() + 1000 });
  assert.equal(r.count, 1);
  assert.equal(r.totalUsd, 1.5);
});
