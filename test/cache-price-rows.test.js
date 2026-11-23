// 0.8.4 cache part a (money): the cache prices of a shipped OpenRouter row, as multiples of the row's own `in` (src/price-table.js cacheMultsOf / rateOfRow). Pure functions, offline, $0. Written without a run (no tests on the laptop).
// A user row stays { in, out, note } (test/price-table.test.js pins that); only a shipped row names cache prices. Namespace import, so the file still loads on a tree without cacheMultsOf and each assertion fails on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as PT from '../src/price-table.js';

const mults = row => (typeof PT.cacheMultsOf === 'function' ? PT.cacheMultsOf(row) : 'cacheMultsOf is not exported');
const SHIPPED = { in: 0.1, out: 0.5, cache_read: 0.01, cache_write: 0.125, tiers: [{ from: 272000, in: 0.2, out: 0.75 }] };
const close = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

test('CPR-1: the cache prices of a shipped row are its multiples of `in`: read 0.1x, write 1.25x for 0.01 / 0.125 on 0.1; a row that names none gives null for both, and a write the host does not list stays null (unknown, priced at the input price, not free)', () => {
  const m = mults(SHIPPED);
  assert.ok(close(m.read, 0.1) && close(m.write, 1.25), JSON.stringify(m));
  assert.deepEqual(mults({ in: 0.1, out: 0.5 }), { read: null, write: null });
  assert.equal(mults({ in: 0.1, out: 0.5, cache_read: 0.01 }).write, null);
  assert.deepEqual(mults(null), { read: null, write: null });
  assert.deepEqual(mults({ in: 0, out: 1, cache_read: 0.01 }), { read: null, write: null }, 'a row with no usable in has no multiple to give');
});

test('CPR-2: a cache price that is present and not a finite number >= 0 FAILS CLOSED (a read is the input price, 1x; a write 2.5x, the dearest write OpenRouter documents); zero is a real price (a free write); a read above the input price counts as the input price', () => {
  for (const bad of [-1, NaN, '0.01', null, Infinity]) {
    const m = mults({ in: 0.1, out: 0.5, cache_read: bad, cache_write: bad });
    assert.deepEqual([m.read, m.write], [1, 2.5], `${String(bad)} is not a price`);
  }
  assert.deepEqual(mults({ in: 0.1, out: 0.5, cache_read: 0, cache_write: 0 }), { read: 0, write: 0 });
  assert.equal(mults({ in: 0.1, out: 0.5, cache_read: 0.3 }).read, 1, 'a read is never dearer than the input price');
});

test('CPR-3: rateOfRow hands the multiples on at every size; a tier that raises `in` leaves the multiples as they are, so the cache prices rise with it', () => {
  const base = { in: 0.1, out: 0.5 };
  const low = PT.rateOfRow(base, SHIPPED, 100000);
  const high = PT.rateOfRow(base, SHIPPED, 300000);
  assert.deepEqual([low.in, high.in], [0.1, 0.2]);
  for (const r of [low, high]) assert.ok(close(r.cacheReadMult, 0.1) && close(r.cacheWriteMult, 1.25), JSON.stringify(r));
});

test('CPR-4 (NAMED PIN: passes on the parent, which hands on no multiple; FAIL CONDITION: a row WITHOUT cache prices gets a cacheReadMult / cacheWriteMult key, or rateOfRow returns a new object for it): a shipped row with no cache price returns exactly what it always returned', () => {
  const base = { in: 0.1, out: 0.5 };
  assert.equal(PT.rateOfRow(base, { in: 0.1, out: 0.5 }, 100000), base, 'the base object itself');
  const plain = { in: 0.1, out: 0.5, tiers: [{ from: 272000, in: 0.2, out: 0.75 }] };
  const r = PT.rateOfRow(base, plain, 300000);
  assert.equal('cacheReadMult' in r || 'cacheWriteMult' in r, false);
});

// 0.8.4 cache part a, STOP 1c: the multiples divide by `cache_basis_in`, the input price the cache figures were taken at (the dearest eligible host's BASE price), not by an `in` a tier-driven row holds above it.
const HAIKU = { in: 0.55, out: 2.75, cache_read: 0.011, cache_write: 0.1375, cache_basis_in: 0.11, tiers: [{ from: 100000, in: 0.55, out: 2.75 }] };
const TERRA = { in: 1.2, out: 6, cache_read: 0.05, cache_write: 1.25, cache_basis_in: 1.0, tiers: [{ from: 272000, in: 2, out: 7.5 }] };
const priced = (row, size) => { const r = PT.rateOfRow({ ...row }, row, size); return { read: r.in * r.cacheReadMult, write: r.in * r.cacheWriteMult, in: r.in }; };

test('CPR-5: with a basis the multiples are the hosts\' own: the haiku-shaped row (in held at 0.55, cache figures taken at a base of 0.11) gives 0.1x and 1.25x, not 0.02x and 0.25x', () => {
  const m = mults(HAIKU);
  assert.ok(close(m.read, 0.1) && close(m.write, 1.25), JSON.stringify(m));
});

test('CPR-6: a basis that is absent, not a positive finite number, or ABOVE `in` falls back to `in` (never a smaller multiple than the row alone would give)', () => {
  for (const basis of [undefined, 0, -1, NaN, '0.11', null]) {
    const m = mults({ in: 0.55, out: 2.75, cache_read: 0.011, cache_write: 0.1375, ...(basis === undefined ? {} : { cache_basis_in: basis }) });
    assert.ok(close(m.read, 0.02) && close(m.write, 0.25), `${String(basis)}: ${JSON.stringify(m)}`);
  }
  const above = mults({ in: 0.55, out: 2.75, cache_read: 0.011, cache_write: 0.1375, cache_basis_in: 5 });
  assert.ok(close(above.read, 0.02) && close(above.write, 0.25), 'a basis above in is not used');
});

test('CPR-7: on a real tier row the priced read and write USD per Mtok past the tier equal the host\'s tier price: gpt-6.1-terra at its 272000 tier (input 2.0) reads at 0.1 and writes at 2.5, below the tier at 0.06 / 1.5 (never under the hosts\' 0.05 / 1.25); the haiku-shaped row reads at 0.055 and writes at 0.6875 at every size', () => {
  const past = priced(TERRA, 300000), below = priced(TERRA, 100000);
  assert.ok(close(past.in, 2) && close(past.read, 0.1) && close(past.write, 2.5), JSON.stringify(past));
  assert.ok(close(below.in, 1.2) && close(below.read, 0.06) && close(below.write, 1.5), JSON.stringify(below));
  for (const size of [1000, 100000, 300000]) { const h = priced(HAIKU, size); assert.ok(close(h.read, 0.055) && close(h.write, 0.6875), `${size}: ${JSON.stringify(h)}`); }
});
