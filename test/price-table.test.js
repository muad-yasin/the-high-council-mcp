// The one price source and the user price row (0.8.3 user price row P1; gate page UserPriceRow_Gate_Page.md, 14 Oct 2026). No wiring yet: setUserPrices is called by tests only.
// Muad: "a user can add their own price row in their project"; C&C: marked as theirs, never lowering a shipped price; fail closed on any row that cannot be read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPED_PRICES, setUserPrices, resetUserPrices, effectiveRow, priceSource, isUserPriced, userRowOf, ignoredUserFields, userPriceLines, UserPriceFileError, USER_PRICE_FILE, userPriceFile } from '../src/price-table.js';
import { priceOf, needsPrice, priceTableLines, unusablePriceRows } from '../src/cost.js';
import { priceRoster } from '../src/budget.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shippedKeys = Object.keys(SHIPPED_PRICES).filter(k => k.includes('/') && SHIPPED_PRICES[k]?.in >= 0 && SHIPPED_PRICES[k]?.out >= 0);
const withFile = (obj, raw = null) => { const d = mkdtempSync(join(tmpdir(), 'thc-userprice-')); writeFileSync(join(d, USER_PRICE_FILE), raw ?? JSON.stringify(obj)); return d; };
const withRows = (obj, fn) => { try { setUserPrices(withFile(obj)); return fn(); } finally { resetUserPrices(); } };
const NEW = 'openrouter/vendor/not-in-the-shipped-table';
const sk = shippedKeys[0]; const [skProvider, ...skRest] = sk.split('/'); const skModel = skRest.join('/'); const S = SHIPPED_PRICES[sk];

test('no user file: every shipped row prices exactly as before (priceOf equals the shipped row), no user rows, the shipped readers unchanged', () => {
  resetUserPrices();
  assert.ok(shippedKeys.length > 20);
  for (const key of shippedKeys) { const [p, ...m] = key.split('/'); assert.deepEqual(priceOf(p, m.join('/')), SHIPPED_PRICES[key], key); }
  const empty = mkdtempSync(join(tmpdir(), 'thc-userprice-none-'));
  assert.deepEqual(setUserPrices(empty), { file: null, rows: 0 });
  assert.equal(userPriceFile(), null); assert.deepEqual(userPriceLines(), []);
  assert.equal(needsPrice({ provider: 'openrouter', model: 'vendor/not-in-the-shipped-table' }), true, 'an unpriced seat is still unpriced');
});

test('a user row adds a model the shipped table lacks: priced as given, marked as the user\'s, listed in the doctor lines, absent from the SHIPPED readers', () => {
  withRows({ [NEW]: { in: 1.5, out: 6, note: 'my own check' } }, () => {
    assert.deepEqual(priceOf('openrouter', 'vendor/not-in-the-shipped-table'), { in: 1.5, out: 6, note: 'my own check' });
    assert.equal(needsPrice({ provider: 'openrouter', model: 'vendor/not-in-the-shipped-table' }), false);
    assert.equal(isUserPriced('openrouter', 'vendor/not-in-the-shipped-table'), true);
    assert.deepEqual(priceSource('openrouter', 'vendor/not-in-the-shipped-table'), { in: 'user', out: 'user' });
    assert.deepEqual(userRowOf('openrouter', 'vendor/not-in-the-shipped-table'), { in: 1.5, out: 6, note: 'my own check' });
    assert.match(userPriceLines()[0], /^openrouter\/vendor\/not-in-the-shipped-table: from pricing\.user\.json in your project folder: in 1\.5 \/ out 6 per million tokens\.$/);
    assert.equal(priceTableLines().join('\n').includes('not-in-the-shipped-table'), false, 'the shipped "as of" and expiry lines stay about the package\'s table');
    assert.equal(unusablePriceRows().some(r => r.key === NEW), false);
    const roster = priceRoster({ perModel: 1_000_000, roster: [NEW], inputShare: 0.5 });
    assert.equal(roster.rows[0].usd, 0.5 * 1.5 + 0.5 * 6, 'budget.js reads the same merged table');
    assert.deepEqual(roster.unpriced, []);
  });
  assert.equal(priceOf('openrouter', 'vendor/not-in-the-shipped-table'), null, 'reset forgets the rows');
});

test('MERGE RULE, per field: a user figure above the shipped one is used, below is ignored and named; never lower than shipped', () => {
  const hi = { in: S.in * 2 + 1, out: S.out * 2 + 1 }; const lo = { in: S.in / 2 || 0.0001, out: S.out / 2 || 0.0001 };
  withRows({ [sk]: hi }, () => {
    assert.equal(effectiveRow(skProvider, skModel).in, hi.in); assert.equal(effectiveRow(skProvider, skModel).out, hi.out);
    assert.deepEqual(priceSource(skProvider, skModel), { in: 'user', out: 'user' }); assert.deepEqual(ignoredUserFields(skProvider, skModel), []);
    assert.equal(effectiveRow(skProvider, skModel).critiqueTokens, S.critiqueTokens, 'the rest of the shipped row (critiqueTokens ...) is kept');
  });
  withRows({ [sk]: lo }, () => {
    assert.equal(effectiveRow(skProvider, skModel).in, S.in); assert.equal(effectiveRow(skProvider, skModel).out, S.out);
    assert.equal(isUserPriced(skProvider, skModel), false); assert.deepEqual(ignoredUserFields(skProvider, skModel).sort(), S.in > 0 ? ['in', 'out'] : ['out']);
    assert.match(userPriceLines()[0], /below the shipped price/);
  });
  withRows({ [sk]: { in: S.in * 3 + 1, out: S.out / 2 || 0.0001 } }, () => {
    assert.deepEqual(priceSource(skProvider, skModel), { in: 'user', out: 'shipped' }, 'mixed: in from the file, out stays the shipped figure');
    assert.equal(effectiveRow(skProvider, skModel).in, S.in * 3 + 1); assert.equal(effectiveRow(skProvider, skModel).out, S.out);
  });
  withRows({ [sk]: { in: S.in, out: S.out } }, () => assert.equal(isUserPriced(skProvider, skModel), false, 'an equal figure is the shipped one'));
});

test('FAIL CLOSED: a file that cannot be read in full throws a UserPriceFileError naming the row, and installs nothing (the previous rows stay)', () => {
  setUserPrices(withFile({ [NEW]: { in: 1, out: 2 } }));
  try {
    const bad = {
      'not an object': '[1,2]', 'not json': '{nope', 'null': 'null',
      'no slash': JSON.stringify({ 'justamodel': { in: 1, out: 2 } }), 'unknown provider': JSON.stringify({ 'nobody/some-model': { in: 1, out: 2 } }),
      'free provider': JSON.stringify({ 'ollama/llama': { in: 1, out: 2 } }), 'row not an object': JSON.stringify({ [NEW]: 5 }),
      'unknown field': JSON.stringify({ [NEW]: { in: 1, out: 2, extra: 1 } }), 'in zero': JSON.stringify({ [NEW]: { in: 0, out: 2 } }), 'out negative': JSON.stringify({ [NEW]: { in: 1, out: -2 } }),
      'in a string': JSON.stringify({ [NEW]: { in: '1', out: 2 } }), 'out missing': JSON.stringify({ [NEW]: { in: 1 } }), 'note too long': JSON.stringify({ [NEW]: { in: 1, out: 2, note: 'x'.repeat(201) } }),
      'too many rows': JSON.stringify(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`openrouter/m${i}`, { in: 1, out: 2 }]))),
    };
    for (const [name, raw] of Object.entries(bad)) {
      assert.throws(() => setUserPrices(withFile(null, raw)), e => e instanceof UserPriceFileError && /cannot be read in full is not used at all/.test(e.message), name);
      assert.deepEqual(priceOf('openrouter', 'vendor/not-in-the-shipped-table'), { in: 1, out: 2 }, `${name}: the previous rows are untouched`);
    }
    assert.throws(() => setUserPrices(withFile(null, JSON.stringify({ [NEW]: { in: 1, out: 2, extra: 1 } }))), e => e.row === NEW && /unknown field "extra"/.test(e.message), 'the row is named');
    const dir = mkdtempSync(join(tmpdir(), 'thc-userprice-dir-')); mkdirSync(join(dir, USER_PRICE_FILE));
    assert.throws(() => setUserPrices(dir), UserPriceFileError, 'a directory in place of the file');
  } finally { resetUserPrices(); }
});

test('SINGLE SOURCE: no module of src/ other than price-table.js reads pricing.json (cost.js and budget.js go through the loader)', () => {
  const offenders = [];
  for (const f of readdirSync(join(root, 'src'), { recursive: true }).filter(n => n.endsWith('.js') && n !== 'price-table.js')) {
    if (!statSync(join(root, 'src', f)).isFile()) continue;
    const text = readFileSync(join(root, 'src', f), 'utf8');
    if (/readFileSync\([^)]*pricing\.json|join\([^)]*['"]pricing\.json['"]\)|import\([^)]*pricing\.json|from\s+['"][^'"]*pricing\.json['"]/.test(text)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});
