// 0.8.4 cache part (b)1, C&C's ruling on commit 4: with the cache-shaped order's words NOT recorded, the dry run (both figures, the marks of ruling B, an explicit lifetime of 5m and 1h) is exactly what the parent f039a88a priced.
// The fixture is the parent's own output, captured through the box by test/helpers/cache-unrecorded-figures.js (a probe run on the parent's tree) and pinned like the switch-off pin. The default-lifetime flip is outside it: every lifetime is explicit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unrecordedFigures } from './helpers/cache-unrecorded-figures.js';

// The fixture also rests on the price table (src/price-table.js): a price refresh moves it and means a re-capture on the parent, like the switch-off pin.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// CHANGED ACCEPTED (0.8.4 ladder unit, the exchange and cache rulings, 10 Nov 2026; FINDING, not on the owed list). OLD: the fixture was the parent f039a88a's own output. NEW: the fixture is re-captured on the ladder tree (test/helpers/cache-unrecorded-recapture.mjs): the layer-1 exchange moved from 7 to 3 rounds, the solo ask added its rows and a 1-hour marker now needs a 4-round budget, so the parent's figures are no longer the reference; the pin still fails when anything in the unrecorded state prices differently from the figures of this tree.
test('UNRECORDED-STATE PIN: the dry run with the order\'s words not recorded equals the parent\'s figures (synthetic chains row for row, every shipped chain in total), both figures, 5m and 1h', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/cache-unrecorded-f039a88a.json', import.meta.url), 'utf8'));
  const now = JSON.parse(JSON.stringify(unrecordedFigures(root, fixture.configs)));   // the parent's own chain files: a change of chains/ (another unit's) is not drift in the cost code
  assert.deepEqual(Object.keys(now.synthetic), Object.keys(fixture.synthetic));
  for (const key of Object.keys(fixture.synthetic)) assert.deepEqual(now.synthetic[key], fixture.synthetic[key], `synthetic ${key}`);
  assert.deepEqual(Object.keys(now.shipped), Object.keys(fixture.shipped), 'the same shipped chains are priced');
  for (const key of Object.keys(fixture.shipped)) assert.deepEqual(now.shipped[key], fixture.shipped[key], `shipped ${key}`);
});
