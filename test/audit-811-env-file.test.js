// Audit items 8 + 11 and the T1-2 class (13 Oct 2026, C&C's ruling): `export NAME=value`, the standard dotenv form, was dropped without a word, so an operator's `export COUNCIL_MAX_USD_LIMIT=1` set no limit at all.
// Only the leading word `export` is read; the same refusal list applies to the name after it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvFile } from '../src/env-file.js';

test('a leading `export ` is read like the plain form: the limit lands (it was dropped before)', () => {
  const env = {};
  const set = applyEnvFile('export COUNCIL_MAX_USD_LIMIT=1\nMAX_USD_PER_RUN=2\nexport   OPENROUTER_API_KEY = k\n', env);
  assert.deepEqual(set.sort(), ['COUNCIL_MAX_USD_LIMIT', 'MAX_USD_PER_RUN', 'OPENROUTER_API_KEY']);
  assert.equal(env.COUNCIL_MAX_USD_LIMIT, '1');
  assert.equal(env.OPENROUTER_API_KEY, 'k');
});

test('the refusal list applies after `export ` too, and nothing beyond the word is read (lowercase names, `exportX=`, a bare `export NAME` are still not settings)', () => {
  const env = {}; const ignored = [];
  const set = applyEnvFile('export XDG_CONFIG_HOME=/x\nexport NODE_OPTIONS=y\nexportFOO=1\nexport lower=1\nexport JUSTANAME\nexport OK_NAME=1\n', env, { onIgnored: n => ignored.push(n) });
  assert.deepEqual(ignored, ['XDG_CONFIG_HOME', 'NODE_OPTIONS']);
  assert.deepEqual(set, ['OK_NAME']);
  assert.deepEqual(Object.keys(env), ['OK_NAME']);
});

// C&C's red input for the `export` fix, verbatim: the limit must land after, and is dropped without a word before.
test('the audit input: `export COUNCIL_MAX_USD_LIMIT=1` + a repeated MAX_USD_PER_RUN: the limit lands, the first MAX_USD_PER_RUN wins (the repeat itself is src/cli.js\'s refusal, test/audit-811-env-repeat.test.js)', () => {
  const env = {};
  const set = applyEnvFile('export COUNCIL_MAX_USD_LIMIT=1\nMAX_USD_PER_RUN=2\nMAX_USD_PER_RUN=9\n', env);
  assert.deepEqual(set.sort(), ['COUNCIL_MAX_USD_LIMIT', 'MAX_USD_PER_RUN']);
  assert.equal(env.COUNCIL_MAX_USD_LIMIT, '1');
  assert.equal(env.MAX_USD_PER_RUN, '2');
});
