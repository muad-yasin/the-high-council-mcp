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

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD (wave 1): the four advice fixture chains (test/fixtures/advice-chains/) were present and each validated against the whole schema, because the `advise` block stayed in config/chain-schema.json with the kept engine. NEW: the schema has no `advise` property, and its closed top-level key set REJECTS a chain file that carries one, for that reason; the one mock fixture left, mock-advise-quick, is the example. WHY: the add-on and its `advise` block are removed (the same rule as the removed `severity` key below); a chain with an `advise` block is refused everywhere else too (runChain, chain-lint advise-removed, the CLI start, start_run).
test('chain-schema: the schema no longer declares `advise`, and a chain file that carries one (the fixture mock-advise-quick) is refused by the closed top-level key set', () => {
  assert.equal('advise' in schema.properties, false, 'the schema no longer declares the key');
  const fx = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'advice-chains', 'mock-advise-quick.json'), 'utf8'));
  assert.equal(validate(fx), false);
  assert.ok(validate.errors.some(e => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'advise'), `refused because the key is not declared: ${JSON.stringify(validate.errors)}`);
  const { advise, ...without } = fx;
  assert.ok(!(validate(without) === false && (validate.errors ?? []).some(e => e.params?.additionalProperty === 'advise')), 'the same chain without the block is not refused for `advise`');
});

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

// Pre-release audit 2026-09-23 (VersionConsistency #7): chain-lint's self-review fix text tells
// users to add "selfReview": "allowed", which the schema used to reject as an unknown key.
test('chain-schema: "selfReview": "allowed", the escape chain-lint advises, validates; any other value does not', () => {
  const base = { seats: { critics: [{ provider: 'mock', model: 'mock-x' }] } };
  assert.ok(validate({ ...base, selfReview: 'allowed' }), JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, selfReview: true }), false);
});

// 0.8.3 (C&C ruling, 13 Oct 2026): the documented top-level `max_proposals_per_seat` (README, docs/index.html) had no schema row, so a chain that set it failed this schema (additionalProperties
// false at the top level) while chain.js ignored it. It is a positive integer; the older nested `proposals.maxProposalsPerSeat` has a row too.
test('chain-schema: "max_proposals_per_seat" is a positive integer at the top level; so is proposals.maxProposalsPerSeat', () => {
  const base = { seats: { critics: [{ provider: 'mock', model: 'mock-x' }] } };
  assert.ok(validate({ ...base, max_proposals_per_seat: 2 }), JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, max_proposals_per_seat: 0 }), false);
  assert.equal(validate({ ...base, max_proposals_per_seat: '2' }), false);
  assert.ok(validate({ ...base, proposals: { parts: 3, maxProposalsPerSeat: 2 } }), JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, proposals: { maxProposalsPerSeat: 0 } }), false);
});

// CHANGED ACCEPTED (0.8.4 S19, C&C's option (b)). OLD: the published schema declared `severity: { enabled }`; the test asserted it validates and that a non-boolean and an extra key do not. NEW: the schema no longer declares the key, and its closed top-level key set REJECTS `severity` in every form, for the right reason (additionalProperties naming severity); the same chain without the key validates. WHY: the switch is removed; a chain that still names it is refused by chain-lint (severity-switch-removed) and by the schema. RED ON OLD SRC: the old schema accepted `severity: { enabled: true }`.
test('chain-schema: the removed `severity` key is rejected in every form by the closed top-level key set, and the schema no longer declares it', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  assert.equal(validate(base), true, JSON.stringify(validate.errors));   // the same chain without the key validates
  for (const block of [{ enabled: true }, { enabled: false }, {}, { enabled: 'yes' }, { enabled: true, extra: 1 }]) {
    assert.equal(validate({ ...base, severity: block }), false, JSON.stringify(block));
    assert.ok(validate.errors.some(e => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'severity'), `${JSON.stringify(block)}: refused because the key is not declared`);
  }
  assert.equal('severity' in schema.properties, false, 'the schema no longer declares the key');
});

// B3 prep, JUDGE lane (unit H): the published schema knows the end-marker switch and closes its key set.
test('chain-schema: draft_end_marker { enabled } validates; a non-boolean and an extra key do not', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  assert.equal(validate({ ...base, draft_end_marker: { enabled: true } }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, draft_end_marker: { enabled: 'yes' } }), false);
  assert.equal(validate({ ...base, draft_end_marker: { enabled: true, extra: 1 } }), false);
});
