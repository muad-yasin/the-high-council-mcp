// 0.8.1 pre-release audit round (MAN-4), area A4 (add-on data flow and surface), findings fixed in batch 2.
// A4-1 a project .env line COUNCIL_PLUGIN_<KEY> outranked the operator's exported key (a regression: key-env.js is new in 0.8.1);
// A4-2 the .env loader accepted every name, so NODE_OPTIONS=--require ./x.cjs in a project .env ran code in every spawned child that holds the keys
// (`council --mcp`). Offline: the loader is exercised on a plain object, never on process.env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnvFile } from '../src/env-file.js';
import { keyEnvValue } from '../src/key-env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('A4-1: a project .env can never set COUNCIL_PLUGIN_* (that prefix is the plugin dialog\'s own, read before the operator\'s exported key)', () => {
  const env = { OPENROUTER_API_KEY: 'operator-key-1234' };
  const set = applyEnvFile('COUNCIL_PLUGIN_OPENROUTER_API_KEY=attacker-key-9999\nANTHROPIC_API_KEY=sk-ant-from-env-file\n', env);
  assert.equal(env.COUNCIL_PLUGIN_OPENROUTER_API_KEY, undefined);
  assert.equal(keyEnvValue('OPENROUTER_API_KEY', env), 'operator-key-1234', 'the operator\'s exported key still wins');
  assert.deepEqual(set, ['ANTHROPIC_API_KEY'], 'an ordinary key line still fills a standard variable the environment lacks');
});

test('A4-2: a project .env cannot set a variable that changes how the process or its children run (NODE_*, LD_*, DYLD_*, PATH, proxies, loopback-key switch)', () => {
  const env = {};
  const text = ['NODE_OPTIONS=--require ./p.cjs', 'NODE_EXTRA_CA_CERTS=/tmp/ca.pem', 'NODE_USE_ENV_PROXY=1', 'LD_PRELOAD=/tmp/x.so', 'LD_LIBRARY_PATH=/tmp', 'DYLD_INSERT_LIBRARIES=/tmp/x.dylib',
    'PATH=/tmp/evil:/usr/bin', 'HTTPS_PROXY=http://127.0.0.1:9', 'HTTP_PROXY=http://127.0.0.1:9', 'ALL_PROXY=http://127.0.0.1:9', 'NO_PROXY=x', 'https_proxy=http://127.0.0.1:9',
    'COUNCIL_ALLOW_LOOPBACK_KEY_HOST=1', 'OPENROUTER_API_KEY=sk-or-v1-fine', 'MAX_USD_PER_RUN=3'].join('\n');
  const set = applyEnvFile(text, env);
  assert.deepEqual(Object.keys(env).sort(), ['MAX_USD_PER_RUN', 'OPENROUTER_API_KEY'], `set: ${set}`);
});

test('A4-2: NODE_ENV (a common application setting that loads no code) stays allowed in a project .env', () => {
  const env = {};
  assert.deepEqual(applyEnvFile('NODE_ENV=production\nNODE_OPTIONS=--require ./p.cjs\n', env), ['NODE_ENV']);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test('A4-2: src/cli.js loads .env through applyEnvFile only (no second, unguarded loader)', () => {
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  assert.match(cli, /applyEnvFile\(readFileSync\(envPath/);
  assert.doesNotMatch(cli, /process\.env\[m\[1\]\]\s*=/);
});

test('A2-1 / A4-2: the loader asks whether a variable is PRESENT, not whether it is usable: a malformed shell key is not silently replaced by the .env value; every refused name is reported once', () => {
  const env = { OPENROUTER_API_KEY: 'sk-or-v1-AAAA\nsk-or-v1-BBBB' };
  const ignored = [];
  const set = applyEnvFile('OPENROUTER_API_KEY=sk-or-v1-from-env-file\nNODE_OPTIONS=--require ./p.cjs\nHTTPS_PROXY=http://x\nCOUNCIL_PLUGIN_GOOGLE_API_KEY=k\n', env, { onIgnored: n => ignored.push(n) });
  assert.deepEqual(set, []);
  assert.equal(env.OPENROUTER_API_KEY, 'sk-or-v1-AAAA\nsk-or-v1-BBBB');
  assert.deepEqual(ignored.sort(), ['COUNCIL_PLUGIN_GOOGLE_API_KEY', 'HTTPS_PROXY', 'NODE_OPTIONS'], 'one report per refused name');
  // a blank or placeholder value is still replaced (as before)
  const env2 = { OPENROUTER_API_KEY: '  ', GOOGLE_API_KEY: '${user_config.google_api_key}' };
  assert.deepEqual(applyEnvFile('OPENROUTER_API_KEY=real1\nGOOGLE_API_KEY=real2\n', env2).sort(), ['GOOGLE_API_KEY', 'OPENROUTER_API_KEY']);
});
