// test/budget-pricing.test.js - Bug-audit fix, 2026-09-16: src/budget.js's priceRoster() silently
// treated an unpriced model (missing from src/pricing.json) as $0 in its total, understating the
// real cost of any roster containing one. The real incident: together/Qwen/Qwen2.5-72B-Instruct-
// Turbo was missing entirely, used by ROSTERS.frontier/.frontier-sonnet (each 7 models) -
// understating priceRoster()'s total by ~14% (1 of 7 seats silently zeroed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { priceRoster, ROSTERS } from '../src/budget.js';

test('every model in every shipped ROSTER has a real pricing.json entry (regression guard - the exact incident this fixes)', () => {
  for (const [name, roster] of Object.entries(ROSTERS)) {
    const { unpriced } = priceRoster({ perModel: 1e6, roster, inputShare: 0.8 });
    assert.deepEqual(unpriced, [], `roster "${name}" has unpriced model(s): ${unpriced.join(', ')}`);
  }
});

test('priceRoster: an unpriced model is named in the new `unpriced` field, not silently absorbed into total', () => {
  const roster = ['anthropic/claude-sonnet-5', 'nobody/not-a-real-model'];
  const { rows, total, unpriced } = priceRoster({ perModel: 1e6, roster, inputShare: 0.8 });
  assert.deepEqual(unpriced, ['nobody/not-a-real-model']);
  const priced = rows.find(r => r.key === 'anthropic/claude-sonnet-5');
  assert.equal(total, priced.usd, 'total must equal only the real, priced row - the unpriced row must not silently inflate or corrupt it');
});

test('priceRoster: a fully-priced roster reports an empty `unpriced` array (no false positives)', () => {
  const { unpriced } = priceRoster({ perModel: 1e6, roster: ['anthropic/claude-sonnet-5'], inputShare: 0.8 });
  assert.deepEqual(unpriced, []);
});

test('priceRoster: together/Qwen/Qwen2.5-72B-Instruct-Turbo (the exact model missing in the real incident) now has a price', () => {
  const { rows, unpriced } = priceRoster({ perModel: 1e6, roster: ['together/Qwen/Qwen2.5-72B-Instruct-Turbo'], inputShare: 0.8 });
  assert.deepEqual(unpriced, []);
  assert.ok(rows[0].usd > 0);
});
