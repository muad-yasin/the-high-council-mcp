// 0.8.4 PRICES unit 2b: a price row can carry TIERS (from `from` prompt tokens a host can charge more), and ONE function, rateFor in src/price-table.js, gives the rate of a call from its prompt size. A row without tiers, NO size asked (undefined)
// and a size under every threshold give exactly the base the caller always got; a fractional size rounds up and a size that was passed but is broken (NaN, null, Infinity) prices at the dearest tier; a malformed `tiers` fails closed (the dearest tier for every size). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTiers, rateOfRow, rateFor, tiersOf, effectiveRow } from '../src/price-table.js';

const BASE = { in: 2.2, out: 11 };
const ROW = { in: 2.2, out: 11, tiers: [{ from: 272000, in: 4.4, out: 16.5 }] };

test('PT-1: a call is priced at the highest tier its prompt reaches; under every threshold, with no size asked (undefined), or with no tiers it is the base object itself', () => {
  assert.deepEqual(rateOfRow(BASE, ROW, 271999), BASE);
  assert.deepEqual(rateOfRow(BASE, ROW, 272000), { in: 4.4, out: 16.5 }, 'from the threshold on');
  assert.deepEqual(rateOfRow(BASE, ROW, 1_000_000), { in: 4.4, out: 16.5 });
  assert.equal(rateOfRow(BASE, ROW, undefined), BASE, 'a caller that passes no size gets the answer it always got');
  assert.deepEqual(rateOfRow(BASE, ROW, 271999.5), { in: 4.4, out: 16.5 }, 'a fractional size rounds UP: 271999.5 reaches the 272000 tier (the cap and the pin must never land on different tiers)');
  assert.equal(rateOfRow(BASE, { in: 2.2, out: 11 }, 5_000_000), BASE, 'a row without tiers');
  assert.equal(rateOfRow(null, ROW, 5), null);
  const two = { tiers: [{ from: 100, in: 3, out: 12 }, { from: 200, in: 5, out: 20 }] };
  assert.deepEqual(rateOfRow(BASE, two, 150), { in: 3, out: 12 }); assert.deepEqual(rateOfRow(BASE, two, 250), { in: 5, out: 20 });
  assert.deepEqual(rateOfRow(BASE, { tiers: [{ from: 10, in: 1, out: 50 }] }, 20), { in: 2.2, out: 50 }, 'a tier below the base on one side never lowers that side');
});

test('PT-2: a malformed tiers list fails closed: the dearest valid tier prices every size; parseTiers says it is malformed', () => {
  for (const bad of [{ tiers: 'x' }, { tiers: [{ from: 0, in: 1, out: 1 }] }, { tiers: [{ from: 100, in: 1, out: 1 }, { from: 100, in: 2, out: 2 }] }, { tiers: [{ from: 100, in: 3, out: 12 }, { from: 50, in: 5, out: 20 }] }, { tiers: [{ from: 100, in: -1, out: 1 }] }]) {
    assert.equal(parseTiers(bad).malformed, true, JSON.stringify(bad));
  }
  assert.deepEqual(rateOfRow(BASE, { tiers: [{ from: 100, in: 3, out: 12 }, { from: 50, in: 5, out: 20 }] }, 1), { in: 5, out: 20 }, 'every size is priced at the dearest tier');
  assert.equal(parseTiers({}).malformed, false); assert.deepEqual(parseTiers({}).tiers, []);
});

// CHANGED ACCEPTED (0.8.4 cache part a). OLD: rateFor with no size, or for a row without tiers, was deepEqual to effectiveRow. NEW: the same, apart from the two keys cacheReadMult / cacheWriteMult that rateFor adds when the shipped row names cache prices
// (cache_read / cache_write; none does until the cache fill). WHY: the multiples are the rate of ONE call and are derived from the shipped row's own fields, so the row without them is still exactly what it was.
const bare = r => { if (!r) return r; const { cacheReadMult, cacheWriteMult, ...rest } = r; return rest; };
test('PT-3: on the shipped table rateFor with no size, or for a row without tiers, is exactly effectiveRow (apart from the cache multiples a row with cache prices adds); tiersOf is empty for such a row', () => {
  const row = effectiveRow('openrouter', 'qwen/qwen3.7-plus');
  assert.deepEqual(bare(rateFor('openrouter', 'qwen/qwen3.7-plus')), row);
  assert.deepEqual(bare(rateFor('openrouter', 'deepseek/deepseek-v4.1-flash-1017', 5_000_000)), effectiveRow('openrouter', 'deepseek/deepseek-v4.1-flash-1017'));
  assert.equal(rateFor('openrouter', 'vendor/not-in-the-table', 100), null);
  assert.ok(Array.isArray(tiersOf('openrouter', 'qwen/qwen3.7-plus')));
});

test('PT-4: every tiers list in the shipped table is well formed (ascending, whole thresholds, positive rates), never below its own base, and every tier-driven row carries one', async () => {
  const { SHIPPED_PRICES } = await import('../src/price-table.js');
  const bad = [];
  for (const [k, row] of Object.entries(SHIPPED_PRICES)) {
    if (!row || typeof row !== 'object') continue;
    const { tiers, malformed } = parseTiers(row);
    if (malformed) bad.push(`${k}: malformed tiers`);
    if (row.hosts?.tier_driven && !tiers.length) bad.push(`${k}: tier_driven with no tiers`);
    for (const t of tiers) if (t.in < row.in || t.out < row.out) bad.push(`${k}: a tier below its base`);
  }
  assert.deepEqual(bad, []);
});

test('PT-5: pinnedExtra carries the tier the call\'s own prompt reaches (a third argument { promptTokens }); with no size, or a size under every threshold, it carries the base row exactly as before; a seat\'s own complete pin still wins', async () => {
  const { pinnedExtra } = await import('../src/price-pin.js');
  const { tiersOf } = await import('../src/price-table.js');
  const seat = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', lab: 'x', maxTokens: 500 };
  const base = effectiveRow('openrouter', seat.model); const [tier] = tiersOf('openrouter', seat.model);
  assert.ok(tier, 'PREMISE: gpt-6.1-sol carries a tier in the shipped table');
  assert.deepEqual(pinnedExtra(seat, undefined).provider.max_price, { prompt: base.in, completion: base.out });
  assert.deepEqual(pinnedExtra(seat, undefined, { promptTokens: tier.from - 1 }).provider.max_price, { prompt: base.in, completion: base.out });
  assert.deepEqual(pinnedExtra(seat, undefined, { promptTokens: tier.from }).provider.max_price, { prompt: tier.in, completion: tier.out });
  // the function of record itself (C&C fix-up 1 Nov 2026): a fractional size rounds up, a size that was passed but is broken prices at the dearest tier, an absent one at the base
  const { rateFor } = await import('../src/price-table.js');
  assert.deepEqual([rateFor('openrouter', seat.model, tier.from - 0.5).in, rateFor('openrouter', seat.model, tier.from - 0.5).out], [tier.in, tier.out], 'a fractional size rounds UP');
  assert.deepEqual([rateFor('openrouter', seat.model).in, rateFor('openrouter', seat.model).out], [base.in, base.out], 'no size asked: the base');
  // the UNWIRED shape: no third argument is the request of today, byte for byte (what every caller sends until DUALCAP passes a size)
  const { createHash } = await import('node:crypto');
  const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  // 0.8.4: the request of today also carries the Open Inference block (provider.ignore, his decision 8 of 28 Okt 2026); the object is otherwise the one it was, key for key
  assert.equal(digest(pinnedExtra(seat, undefined)), digest({ provider: { ignore: ['open-inference'], max_price: { prompt: base.in, completion: base.out } } }));
  const own = { provider: { max_price: { prompt: 9, completion: 9 } } };
  assert.deepEqual(pinnedExtra(seat, own, { promptTokens: tier.from * 2 }).provider.max_price, { prompt: 9, completion: 9 });
});

test('PT-6: "no size asked" is not "size broken": undefined prices at the base (the unwired callers, today\'s bytes); a size that WAS passed but is not a finite number (NaN, null from a failed estimate, Infinity) prices at the dearest tier, the same branch as a malformed list (C&C fix-up 1 Nov 2026)', async () => {
  const { rateFor, tiersOf } = await import('../src/price-table.js');
  const model = 'openai/gpt-6.1-sol'; const [tier] = tiersOf('openrouter', model);
  assert.ok(tier, 'PREMISE: gpt-6.1-sol carries a tier in the shipped table');
  const at = size => { const r = rateFor('openrouter', model, size); return [r.in, r.out]; };
  const base = effectiveRow('openrouter', model);
  assert.deepEqual(at(undefined), [base.in, base.out], 'undefined: the base');
  for (const broken of [NaN, null, Infinity, 'x']) assert.deepEqual(at(broken), [tier.in, tier.out], `${String(broken)}: the dearest tier`);
  assert.equal(rateOfRow(BASE, ROW, undefined), BASE);
  for (const broken of [NaN, null, Infinity]) assert.deepEqual(rateOfRow(BASE, ROW, broken), { in: 4.4, out: 16.5 }, String(broken));
  assert.equal(rateOfRow(BASE, { in: 2.2, out: 11 }, NaN), BASE, 'a row without tiers has no dearer tier: still the base');
});
