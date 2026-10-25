// readUsdLimit (src/mcp/usd-limit.js, 13 Oct 2026, audit item 1): COUNCIL_MAX_USD_LIMIT is unset when EMPTY, a positive finite number when it reads as one, and a REFUSAL (the server does not start)
// otherwise. A set but unreadable limit used to become "unset", which let a client's max_usd 25, or "none", through: a fail-open on money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readUsdLimit, PLACEHOLDER_LIMIT_POLICY } from '../src/mcp/usd-limit.js';

test('an empty or absent value is unset; a positive finite number is the limit', () => {
  assert.deepEqual(readUsdLimit(undefined), { value: null, refusal: null });
  assert.deepEqual(readUsdLimit(''), { value: null, refusal: null });
  for (const [raw, v] of [['5', 5], ['2.50', 2.5], [' 7 ', 7], ['0.5', 0.5], ['007', 7]]) assert.deepEqual(readUsdLimit(raw), { value: v, refusal: null }, raw);
});

test('any other value is refused, and the sentence names the variable and the bad value', () => {
  for (const raw of ['$2', '1,50', 'abc', '0', '0.0', '-3', 'Infinity', 'NaN', ' ', '5abc', '1e999', '0x10', '1e2', '.5', '5.', '+5', '1_000']) {
    const r = readUsdLimit(raw);
    assert.equal(r.value, null, raw);
    assert.ok(r.refusal, `refused: ${JSON.stringify(raw)}`);
    assert.ok(r.refusal.includes('COUNCIL_MAX_USD_LIMIT') && r.refusal.includes(`"${raw}"`) && /did not start/.test(r.refusal), r.refusal);
  }
  assert.ok(readUsdLimit('x'.repeat(100)).refusal.includes(`"${'x'.repeat(40)}..."`), 'a long value is cut in the sentence');
});

test('the unexpanded ${user_config.max_usd} placeholder is the one named branch: refused by default (until the owner answers), unset when told so', () => {
  assert.equal(PLACEHOLDER_LIMIT_POLICY, 'refuse');
  const refused = readUsdLimit('${user_config.max_usd}');
  assert.equal(refused.value, null);
  assert.ok(refused.refusal && refused.refusal.includes('${user_config.max_usd}') && refused.refusal.includes('Spend ceiling per run (USD)') && /did not start/.test(refused.refusal), refused.refusal);
  assert.deepEqual(readUsdLimit('${user_config.max_usd}', { placeholder: 'unset' }), { value: null, refusal: null });
  assert.ok(readUsdLimit('${nothing_like_a_setting}').refusal, 'only the user_config shape is a placeholder; anything else unreadable is refused');
});

test('a key pasted into the limit is not echoed: the sentence says the value was redacted', () => {
  const key = 'sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789';
  const r = readUsdLimit(key);
  assert.ok(r.refusal && !r.refusal.includes('AbCdEf0123456789') && r.refusal.includes('[redacted: possible secret]'), r.refusal);
});
