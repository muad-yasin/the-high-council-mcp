// 0.8.4 D22: the chain key `builder_kind` is checked before any run, in the schema and in chain-lint: "session" and "one_shot" pass, anything else is refused with a fix (it would silently run as "session"). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { lintChain } from '../src/chain-lint.js';

const root = new URL('..', import.meta.url);
const chain = JSON.parse(readFileSync(new URL('chains/mock.json', root), 'utf8'));
const schema = JSON.parse(readFileSync(new URL('config/chain-schema.json', root), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const kinds = config => lintChain(config, 'chains/x.json').filter(f => f.kind === 'builder-kind');

test('chain-lint: an unset key, "session" and "one_shot" give no builder-kind finding; any other value gives one with its fix', () => {
  for (const v of [undefined, 'session', 'one_shot']) assert.deepEqual(kinds({ ...chain, ...(v === undefined ? {} : { builder_kind: v }) }), [], String(v));
  for (const v of ['session', 'one_shot']) assert.deepEqual(lintChain({ ...chain, builder_kind: v }, 'chains/x.json'), lintChain(chain, 'chains/x.json'), `${v}: the key adds no finding of any kind`);
  for (const v of ['oneshot', 'ONE_SHOT', '', true, 1, null]) {
    const found = kinds({ ...chain, builder_kind: v });
    assert.equal(found.length, 1, JSON.stringify(v));
    assert.match(found[0].message, /silently run as "session"/);
    assert.match(found[0].fix, /"session" or "one_shot"/);
  }
});

test('chain-schema: builder_kind takes "session" and "one_shot" and nothing else', () => {
  assert.equal(validate({ ...chain, builder_kind: 'one_shot' }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...chain, builder_kind: 'session' }), true);
  assert.equal(validate({ ...chain, builder_kind: 'oneshot' }), false);
  assert.equal(validate({ ...chain, builder_kind: true }), false);
});
