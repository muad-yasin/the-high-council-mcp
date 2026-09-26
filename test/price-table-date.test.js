// The price table's as-of date (0.7.8). The spend cap and every dry-run price project with
// src/pricing.json, which is static between releases; `council doctor` and `--dry-run` now say how
// old it is, and warn past 60 days (thc-research briefs 09 and 11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceTableAge, priceTableLines, priceOf, PRICE_TABLE_STALE_DAYS } from '../src/cost.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const table = JSON.parse(readFileSync(resolve(here, '../src/pricing.json'), 'utf8'));
const at = d => new Date(`${d}T12:00:00Z`);

test('pricing.json carries a machine-readable asOf that is never newer than any entry\'s own check date', () => {
  assert.match(table.asOf, /^\d{4}-\d{2}-\d{2}$/);
  const dates = Object.entries(table).filter(([k]) => k.includes('/'))
    .flatMap(([, v]) => String(v._source || '').match(/\d{4}-\d{2}-\d{2}/g) || []);
  for (const d of dates) assert.ok(table.asOf <= d, `asOf ${table.asOf} is newer than an entry checked ${d}`);
  assert.equal(priceOf('x', 'asOf'), null, 'asOf is not a price entry');
});

test('priceTableAge: days since asOf, stale only past the limit', () => {
  const t = { asOf: '2026-09-06' };
  assert.deepEqual(priceTableAge(at('2026-09-26'), t), { asOf: '2026-09-06', days: 20, stale: false });
  assert.equal(priceTableAge(at('2026-11-05'), t).days, PRICE_TABLE_STALE_DAYS);
  assert.equal(priceTableAge(at('2026-11-05'), t).stale, false, 'exactly 60 days is not stale yet');
  assert.equal(priceTableAge(at('2026-11-06'), t).stale, true);
  assert.deepEqual(priceTableAge(at('2026-09-26'), {}), { asOf: null, days: null, stale: true });
  assert.deepEqual(priceTableAge(at('2026-09-26'), { asOf: 'September' }), { asOf: null, days: null, stale: true });
});

test('priceTableLines: one line when fresh, a WARNING line added when stale or undated', () => {
  const fresh = priceTableLines(at('2026-09-26'), { asOf: '2026-09-06' });
  assert.deepEqual(fresh, ['Prices: src/pricing.json as of 2026-09-06 (20 days ago). List prices change; treat every figure as an estimate.']);
  const stale = priceTableLines(at('2026-12-01'), { asOf: '2026-09-06' });
  assert.equal(stale.length, 2);
  assert.match(stale[1], /^WARNING: the price table is 86 days old \(more than 60\)/);
  assert.match(priceTableLines(at('2026-09-06'), { asOf: '2026-09-06' })[0], /\(today\)/);
  assert.match(priceTableLines(at('2026-09-26'), {})[1], /^WARNING: the price table has no date/);
});

test('--dry-run and council doctor print the price table date', () => {
  const env = { PATH: process.env.PATH };
  const dry = execFileSync(process.execPath, [cli, '--chain', 'mock', '--dry-run'], { encoding: 'utf8', env });
  assert.ok(dry.includes(`Prices: src/pricing.json as of ${table.asOf}`), dry);
  const doctor = execFileSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env });
  assert.ok(doctor.includes(`Prices: src/pricing.json as of ${table.asOf}`), doctor.slice(-600));
});
