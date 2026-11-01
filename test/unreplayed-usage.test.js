// S5-01 (0.8.4): paid stage files that no stage row accounts for count in the report's total, in `--spend` once report.json exists, and are attributed in the tree.
// Found in the pilot: re-asks a sitting paid for and a later sitting never asked again stayed in the run folder; `--spend` read higher before report.json existed than after. Offline: planted files for the finders (unit level),
// the real CLI for the end to end case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unreplayedOf, foldUnreplayedInto } from '../src/unreplayed.js';
import { foldSupersededInto } from '../src/stage-cache.js';
import { runSpendOf, runSpentUsd } from '../src/spend.js';

const folder = files => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-unreplayed-'));
  for (const [name, body] of Object.entries(files)) { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body)); }
  return dir;
};
const u = (usd, reservationId) => ({ provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd, ...(reservationId ? { reservationId } : {}) });
const rows = [{ label: 'a', usd: 0.1, reservationId: 'r1' }, { label: 'b', usd: 0.2, reservationId: 'r2' }];

test('unreplayedOf finds a paid top-level file that neither a label nor a reservation id of a stage row accounts for, and nothing else', () => {
  const dir = folder({
    'a.usage.json': u(0.1, 'r1'), 'b.usage.json': u(0.2, 'r2'),
    'panel-3-x-reask1.usage.json': u(0.3, 'r3'),        // paid, asked by no row: counts
    'moved.usage.json': u(0.4, 'r2'),                    // another label, but its id is a row's: accounted (errs low, never twice)
    'old.usage.json': u(0.5),                            // no id: only its label can account for it; no row has it: counts
    'free.usage.json': u(0), 'bad.usage.json': u('x'), 'torn.usage.json': '{',
    'handoff-from-run.usage.json': u(0.6, 'r9'),         // a post-run call, added by name elsewhere
    'superseded/a.charge-1.usage.json': u(0.7, 'r8'),    // its own record
  });
  assert.deepEqual(unreplayedOf(dir, rows), [{ label: 'old', usd: 0.5, reservationId: null }, { label: 'panel-3-x-reask1', usd: 0.3, reservationId: 'r3' }]);
});

test('foldUnreplayedInto adds them to the total the way superseded records are added, and does nothing when there are none', () => {
  const dir = folder({ 'a.usage.json': u(0.1, 'r1'), 'p.usage.json': u(0.3, 'r3') });
  const r = foldUnreplayedInto({ stages: [rows[0]], totals: { usd: 0.1 } }, dir);
  assert.deepEqual([r.totals.usd, r.totals.unreplayedUsd, r.unreplayed], [0.1 + 0.3, 0.3, [{ label: 'p', usd: 0.3, reservationId: 'r3' }]]);
  const none = foldUnreplayedInto({ stages: [rows[0], { label: 'p', usd: 0.3 }], totals: { usd: 0.4 } }, dir);
  assert.deepEqual(none, { stages: [rows[0], { label: 'p', usd: 0.3 }], totals: { usd: 0.4 } });
  assert.equal(foldUnreplayedInto({ totals: { usd: 1 } }, dir).totals.usd, 1, 'no stage rows: no basis, nothing added');
  const side = foldSupersededInto({ stages: [rows[0]], totals: { usd: 0.1 } }, dir);
  assert.equal(side.totals.unreplayedUsd, 0.3, 'a side run\'s report is folded the same way');
});

test('--spend reads the same before and after report.json exists: the symptom this row names', () => {
  const dir = folder({ 'a.usage.json': u(0.1, 'r1'), 'b.usage.json': u(0.2, 'r2'), 'panel-3-x-reask1.usage.json': u(0.3, 'r3') });
  const before = runSpendOf(dir).usd;
  assert.equal(before, 0.1 + 0.2 + 0.3);
  const result = foldUnreplayedInto({ stages: rows, totals: { usd: 0.1 + 0.2 } }, dir);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ chain: 'c', stages: result.stages, totals: result.totals, unreplayed: result.unreplayed }));
  assert.equal(runSpendOf(dir).usd, before, 'a report that holds the orphan is not added to a second time');
  assert.equal(runSpentUsd(dir), before);
});

test('an older report (no totals.unreplayedUsd) is read with the orphans added; a report with no stages array is read as it was', () => {
  const dir = folder({ 'a.usage.json': u(0.1, 'r1'), 'b.usage.json': u(0.2, 'r2'), 'panel-3-x-reask1.usage.json': u(0.3, 'r3'), 'report.json': { chain: 'c', stages: rows, totals: { usd: 0.1 + 0.2 } } });
  assert.equal(runSpendOf(dir).usd, 0.1 + 0.2 + 0.3);
  const bare = folder({ 'a.usage.json': u(99), 'report.json': { chain: 'c', totals: { usd: 3.5 } } });
  assert.equal(runSpendOf(bare).usd, 3.5);
});
