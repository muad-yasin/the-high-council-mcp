// test/decision-records.test.js
//
// Decision records (2026-09-23): the prompt rules themselves are pinned in test/roles.test.js.
// This file pins the wiring - that `decisions.enabled` (or the `alternatives` stage, which
// implies it) actually reaches the criteria and builder seats, and that a chain without either
// sends exactly what it always sent. An external seat throws ExternalPause carrying the prompts
// it would have been given, which is the one offline way to see what a stage was told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, ExternalPause } from '../src/chain.js';
import { DECISIONS_RULE_BUILDER, DECISIONS_RULE_CRITERIA } from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const EXTERNAL = { provider: 'external', model: 'claude-code-session' };

async function pausedAt(config) {
  try {
    await runChain({ config, request: 'A mock task.', log: () => {} });
  } catch (err) {
    if (err instanceof ExternalPause) return err;
    throw err;
  }
  assert.fail('expected the run to pause at an external seat');
}

const withCriteriaExternal = extra => {
  const c = { ...chain('mock-debate'), ...extra };
  return { ...c, seats: { ...c.seats, criteria: EXTERNAL } };
};
const withBuilderExternal = extra => {
  const c = { ...chain('mock-debate'), ...extra, proposals: undefined, debate: false };
  return { ...c, seats: { ...c.seats, builder: EXTERNAL } };
};

test('decisions.enabled: the criteria seat is told to write the decision-record criterion', async () => {
  const on = await pausedAt(withCriteriaExternal({ decisions: { enabled: true } }));
  assert.equal(on.label, 'criteria');
  assert.ok(on.system.includes(DECISIONS_RULE_CRITERIA), 'the criteria prompt must carry the rule');
  const off = await pausedAt(withCriteriaExternal({}));
  assert.ok(!off.system.includes('Decision records'), 'a chain that never opted in must not get it');
});

test('decisions.enabled: the builder is told to write the "Decisions" section', async () => {
  const on = await pausedAt(withBuilderExternal({ decisions: { enabled: true } }));
  assert.equal(on.label, 'build');
  assert.ok(on.system.endsWith(DECISIONS_RULE_BUILDER));
  const off = await pausedAt(withBuilderExternal({}));
  assert.ok(!off.system.includes('section titled "Decisions"'));
});

test('the alternatives stage implies decision records, since its losers are recorded there', async () => {
  const c = withCriteriaExternal({ alternatives: { enabled: true } });
  const p = await pausedAt(c);
  assert.equal(p.label, 'criteria', 'criteria still run first');
  assert.ok(p.system.includes(DECISIONS_RULE_CRITERIA));
});
