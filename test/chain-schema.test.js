// test/chain-schema.test.js
//
// v8 item (b), part 1 (deep-research-v8-directional-followup-2026-09-15.md §2.4(c)): a published
// JSON Schema for chains/*.json, checked against every real chain file the same way
// test/landing-page.test.js checks the landing page against real repo facts - so drift between
// the schema and a real chain file's shape fails a test, not a future human reading both by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

const chainFiles = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'));

test('chain-schema: at least one real chain file is present to check against', () => {
  assert.ok(chainFiles.length > 0);
});

for (const file of chainFiles) {
  test(`chain-schema: chains/${file} validates`, () => {
    const config = JSON.parse(readFileSync(join(root, 'chains', file), 'utf8'));
    const ok = validate(config);
    assert.ok(ok, `${file}: ${JSON.stringify(validate.errors)}`);
  });
}

test('chain-schema: a chain file with an unrecognized top-level key fails validation', () => {
  const bogus = { seats: { critics: [{ provider: 'mock', model: 'mock-x' }] }, chalenge: { enabled: true } };
  assert.equal(validate(bogus), false);
});

test('chain-schema: a chain file with no "seats" fails validation (required)', () => {
  const bogus = { signoff: 'first' };
  assert.equal(validate(bogus), false);
});

test('chain-schema: schemaVersion must be an integer when present', () => {
  const bogus = { seats: { critics: [] }, schemaVersion: 'x' };
  assert.equal(validate(bogus), false);
  const ok = { seats: { critics: [] }, schemaVersion: 1 };
  assert.equal(validate(ok), true);
});

test('chain-schema: schemaVersion absent still validates (v8 item (b), part 2 - optional, defaulted)', () => {
  const ok = { seats: { critics: [] } };
  assert.equal(validate(ok), true);
});
