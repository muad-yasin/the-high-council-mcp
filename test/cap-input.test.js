// The typed spending limit's parser (typed-cap gate page T1, 14 Oct 2026; Astra #10): a strict finite decimal grammar, micro-dollar integers, zero is not a cap for a paid start, ceilings stay ceilings, `none` is not a number. Pure, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
const { parseCapInput, CAP_GRAMMAR, MICRO } = await import('../src/cap-input.js').catch(() => ({}));

const bad = (text, code, opts) => { const r = parseCapInput(text, opts); assert.equal(r.ok, false, `${JSON.stringify(text)} must be refused: ${JSON.stringify(r)}`); assert.equal(r.code, code, `${JSON.stringify(text)}: ${r.sentence}`); assert.match(r.sentence, /Nothing was started\.$/); return r; };

test('CI-1 plain amounts parse to a normalized decimal string and EXACT micro-dollar integers (no float: 1.005 is 1005000, not 1004999.99...)', () => {
  const rows = [['7', '7', 7_000_000], ['7.50', '7.5', 7_500_000], [' 0.05 ', '0.05', 50_000], ['0.0001', '0.0001', 100], ['999999.9999', '999999.9999', 999_999_999_900], ['1.005', '1.005', 1_005_000], ['0.07', '0.07', 70_000], ['12.00', '12', 12_000_000], ['100', '100', 100_000_000]];
  for (const [text, capUsd, capMicroUsd] of rows) assert.deepEqual(parseCapInput(text), { ok: true, capUsd, capMicroUsd }, text);
  assert.equal(MICRO, 1_000_000); assert.ok(CAP_GRAMMAR.test('2.5') && !CAP_GRAMMAR.test('2.'));
});

test('CI-2 blank, whitespace-only and non-string entries are not an answer', () => {
  for (const v of ['', '   ', '\n', undefined, null, 5, {}]) bad(v, 'empty');
});

test('CI-3 "none", "off", "unlimited" and the like are refused with the instruction to type a limit (--max-usd none is removed even from a person); "1" is a limit, not "unlimited"', () => {
  for (const v of ['none', 'NONE', 'off', 'unlimited', 'Infinity', 'inf', 'no limit']) assert.match(bad(v, 'unlimited').sentence, /^An unlimited run is not offered\. Type a limit in US dollars/, v);
  assert.equal(parseCapInput('1').ok, true); assert.equal(parseCapInput('1').capUsd, '1');
});

test('CI-4 a comma, a currency sign, letters, a sign, an exponent, hexadecimal, NaN, non-ASCII digits and inner spaces are refused with their own sentence (known-bad inputs of the old Number() reader: 1e3, 0x10, +5, a bare "5 USD")', () => {
  assert.match(bad('2,5', 'comma').sentence, /Use a dot for the decimals, for example 2\.50\./); bad('1,000', 'comma'); bad('0,50', 'comma');
  for (const v of ['$5', '5 USD', '5usd', '-3', '+5', '1e3', '1E3', '0x10', 'NaN', '٣', '5 5', '--5', '5%', '5$', 'five']) bad(v, 'format');
  for (const v of ['.5', '5.', '007', '05', '0.', '1..2', '1.2.3']) bad(v, 'format');
});

test('CI-5 more than four decimals and more than six digits are refused', () => {
  bad('2.50000', 'precision'); bad('0.00001', 'precision'); bad('1234567', 'too_large'); bad('1234567.5', 'too_large');
  assert.equal(parseCapInput('999999.9999').ok, true); assert.equal(parseCapInput('123456').ok, true);
});

test('CI-6 ZERO parses but is not a cap for a paid start (it would allow no paid call and never reaches setBudget); a free-only run may carry it', () => {
  assert.match(bad('0', 'zero_paid').sentence, /^A limit of 0 allows no paid call, and this chain has paid seats\./); bad('0.0000', 'zero_paid'); bad('0.00', 'zero_paid');
  assert.deepEqual(parseCapInput('0', { paid: false }), { ok: true, capUsd: '0', capMicroUsd: 0 });
});

test('CI-7 a ceiling stays a ceiling: an amount above it is refused with the ceiling and its source named; at or below it passes; an unreadable ceiling refuses (fails closed)', () => {
  const opts = { ceilingUsd: 10, ceilingSource: 'COUNCIL_MAX_USD_LIMIT' };
  assert.equal(parseCapInput('10', opts).ok, true); assert.equal(parseCapInput('9.9999', opts).ok, true);
  assert.equal(bad('10.0001', 'above_ceiling', opts).sentence, 'The limit you typed ($10.0001) is above the ceiling in force ($10, set by COUNCIL_MAX_USD_LIMIT). Type $10 or less. Nothing was started.');
  assert.match(bad('11', 'above_ceiling', { ceilingUsd: 2.5 }).sentence, /ceiling in force \(\$2\.5\)\. Type \$2\.5 or less\./, 'no source named: no "set by"');
  bad('1', 'ceiling_unreadable', { ceilingUsd: NaN }); assert.equal(parseCapInput('1', { ceilingUsd: null }).ok, true, 'no ceiling in force');
});

test('CI-8 a value echoed in a sentence is redacted and cut: a key pasted into the limit field is never repeated', () => {
  const key = `sk-or-v1-${'a'.repeat(40)}`;
  const r = bad(key, 'format'); assert.ok(!r.sentence.includes('sk-or-v1-aaaa') && r.sentence.includes('[redacted: possible secret]'), r.sentence);
  const long = bad('x'.repeat(200), 'format'); assert.ok(long.sentence.length < 330 && long.sentence.includes('...'), long.sentence);
});
