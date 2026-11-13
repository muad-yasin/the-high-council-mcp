// 0.8.4 the optional zero-retention setting: COUNCIL_ZERO_RETENTION is OPERATOR-ONLY. A project's .env (writable by the project, by an agent, by a cloned repo) must not set it: it decides which hosts a person's text may reach, so only the person's own flag, shell
// variable or MCP argument sets it. Refused through env-file.js's OWN list, by name, once. The name is typed in env-file.js (the early-loaded module pulls in nothing of the chain) and pinned here equal to the module's constant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvFile, envFileRefuses } from '../src/env-file.js';

const ZR = await import('../src/zero-retention.js').catch(() => ({}));      // a dynamic import: on a tree without the module the refusal below is still the first assertion to fail

test('EZR-1 COUNCIL_ZERO_RETENTION is refused from a project .env, by name and reported once, and the name is the module\'s own constant; names beside it stay allowed', () => {
  assert.equal(envFileRefuses('COUNCIL_ZERO_RETENTION'), true, 'the name is on env-file.js\'s own refused list');
  assert.equal(ZR.ZERO_RETENTION_ENV, 'COUNCIL_ZERO_RETENTION', 'the typed name in env-file.js and the module\'s constant are one name');
  const ignored = [], env = {};
  const set = applyEnvFile('COUNCIL_ZERO_RETENTION=off\nOPENROUTER_API_KEY=sk-or-v1-fine\nCOUNCIL_ZERO_RETENTION=on\nCOUNCIL_ZERO_RETENTIONS=x\nCOUNCIL_ZERO=y\nMY_COUNCIL_ZERO_RETENTION=z\n', env, { onIgnored: n => ignored.push(n) });
  assert.deepEqual(ignored, ['COUNCIL_ZERO_RETENTION'], 'named once although written twice');
  assert.equal(env.COUNCIL_ZERO_RETENTION, undefined, 'it was not set');
  assert.deepEqual(set.sort(), ['COUNCIL_ZERO', 'COUNCIL_ZERO_RETENTIONS', 'MY_COUNCIL_ZERO_RETENTION', 'OPENROUTER_API_KEY'], 'and nothing near its name is lost');
});
