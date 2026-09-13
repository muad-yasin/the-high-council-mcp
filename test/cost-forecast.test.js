// test/cost-forecast.test.js
//
// v5 §1 candidate 7: a realistic-case cost range from a chain's own history,
// repriced at today's pricing.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forecastCost } from '../src/cost-forecast.js';
import { costOf } from '../src/cost.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

const ID = n => `2026-09-11T1${n}-00-00-000Z`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-forecast-'));
  const runs = join(dir, 'runs');
  mkdirSync(runs);
  const add = (id, report) => {
    const d = join(runs, id);
    mkdirSync(d);
    writeFileSync(join(d, 'report.json'), JSON.stringify(report));
  };
  return { dir, runs, add };
}

test('test_cost_forecast_range: a fixture chain with known historical usage lands within 10% of the expected range', () => {
  const { runs, add } = fixture();
  const model = { provider: 'anthropic', model: 'claude-sonnet-5' };

  // Two historical runs of the same chain, different token counts, so the
  // range has real width rather than being a single repeated number.
  add(ID(0), {
    chain: 'verify',
    stages: [
      { label: 'criteria', provider: model.provider, model: model.model, usage: { input: 4000, output: 1000 } },
      { label: 'critique-1', provider: model.provider, model: model.model, usage: { input: 2000, output: 500 } },
    ],
  });
  add(ID(1), {
    chain: 'verify',
    stages: [
      { label: 'criteria', provider: model.provider, model: model.model, usage: { input: 8000, output: 2000 } },
      { label: 'critique-1', provider: model.provider, model: model.model, usage: { input: 4000, output: 1000 } },
    ],
  });
  // A different chain must not pollute the estimate.
  add(ID(2), {
    chain: 'other-chain',
    stages: [{ label: 'criteria', provider: model.provider, model: model.model, usage: { input: 999999, output: 999999 } }],
  });

  const expectedLow = costOf(model.provider, model.model, { input: 6000, output: 1500 }).usd;   // run 0's total
  const expectedHigh = costOf(model.provider, model.model, { input: 12000, output: 3000 }).usd;  // run 1's total

  const f = forecastCost('verify', runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(f.runsUsed, 2);
  assert.ok(Math.abs(f.low - expectedLow) / expectedLow < 0.10, `low ${f.low} not within 10% of expected ${expectedLow}`);
  assert.ok(Math.abs(f.high - expectedHigh) / expectedHigh < 0.10, `high ${f.high} not within 10% of expected ${expectedHigh}`);
  assert.ok(f.low <= f.mean && f.mean <= f.high);
});

test('a single historical run gives a zero-width range rather than inventing variance', () => {
  const { runs, add } = fixture();
  add(ID(0), {
    chain: 'verify',
    stages: [{ label: 'criteria', provider: 'anthropic', model: 'claude-sonnet-5', usage: { input: 1000, output: 200 } }],
  });
  const f = forecastCost('verify', runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(f.runsUsed, 1);
  assert.equal(f.low, f.high);
});

test('no historical runs of this chain: a note, not an error', () => {
  const { runs } = fixture();
  const f = forecastCost('verify', runs, { days: 30 });
  assert.equal(f.runsUsed, 0);
  assert.equal(f.low, null);
  assert.ok(f.note);
});

test('a missing runs directory degrades instead of throwing', () => {
  const f = forecastCost('verify', '/no/such/directory/anywhere', { days: 30 });
  assert.equal(f.runsUsed, 0);
  assert.equal(f.low, null);
});

test('an unpriced provider/model pair is flagged, not silently counted as $0', () => {
  const { runs, add } = fixture();
  add(ID(0), {
    chain: 'verify',
    stages: [{ label: 'criteria', provider: 'nobody', model: 'no-such-model', usage: { input: 999999, output: 999999 } }],
  });
  const f = forecastCost('verify', runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(f.low, 0);
  assert.equal(f.high, 0);
  assert.equal(f.partial, true, 'an unpriced model must set partial:true rather than reading as a real $0 estimate');
  assert.ok(f.unpriced.includes('nobody/no-such-model'));
  assert.match(f.note, /no entry in pricing\.json/);
});

test('council --forecast-cost --chain prints a range from real history', () => {
  const { runs, add } = fixture();
  add(ID(0), {
    chain: 'verify',
    stages: [{ label: 'criteria', provider: 'anthropic', model: 'claude-sonnet-5', usage: { input: 1000, output: 200 } }],
  });
  const out = execFileSync('node', [cli, '--forecast-cost', '--chain', 'verify'], { encoding: 'utf8', cwd: runs.replace(/\/runs$/, '') });
  assert.match(out, /Cost forecast for chain "verify"/);
  assert.match(out, /\$/);
});
