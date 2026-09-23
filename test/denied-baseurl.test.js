// Pre-release audit 2026-09-23 (PreRelease_Audit_guards / _lint, HIGH): "No grok, ever" had a
// baseUrl bypass. denied-models never looked at seat.baseUrl, but the adapter sends the request
// there, so an ordinary-looking seat pointed at a denied lab's API passed lint and the run-time
// check. Hosts are assembled at runtime so no source line names the denied API outright.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { baseUrlReasons, deniedReasonsOf } from '../src/denied-models.js';
import { lintChain } from '../src/chain-lint.js';
import { runChain } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const deniedApi = `https://api.${'x'}.${'ai'}/v1`;

for (const baseUrl of [deniedApi, `https://${'x'}.${'ai'}`, 'https://kimi-proxy.example/v1', 'https://auto-router.example/v1', 'https://some-proxy.example.com/v1', 'not a url']) {
  test(`a seat whose baseUrl is ${baseUrl} is refused by lint and at run time`, async () => {
    const seat = { provider: 'openrouter', model: 'openai/gpt-5', baseUrl };
    assert.ok(deniedReasonsOf(seat).length >= 1);
    const cfg = { ...chain('mock'), seats: { ...chain('mock').seats, builder: seat } };
    assert.ok(lintChain(cfg).some(f => f.kind === 'denied-model'));
    await assert.rejects(() => runChain({ request: 'r', config: cfg, log: () => {} }), /denied/);
  });
}

test('local models keep working: loopback hosts, and a private-network host for an ollama seat', () => {
  for (const baseUrl of ['http://localhost:11434/v1', 'http://localhost:1234/v1', 'http://127.0.0.1:8080/v1', 'http://[::1]:11434/v1']) {
    assert.deepEqual(baseUrlReasons({ provider: 'ollama', baseUrl }), [], baseUrl);
    assert.deepEqual(baseUrlReasons({ provider: 'openrouter', baseUrl }), [], `${baseUrl} (a local stub)`);
  }
  for (const baseUrl of ['http://192.168.1.20:11434/v1', 'http://10.0.0.5:11434/v1', 'http://gpu-box.local:11434/v1']) {
    assert.deepEqual(baseUrlReasons({ provider: 'ollama', baseUrl }), [], baseUrl);
    assert.ok(baseUrlReasons({ provider: 'openrouter', baseUrl }).length, `${baseUrl} is not a local model for an openrouter seat`);
  }
  assert.deepEqual(lintChain(chain('local-ollama')).filter(f => f.kind === 'denied-model'), [], 'the shipped local chain still lints clean');
});

test('a known provider\'s own API host is allowed', () => {
  for (const baseUrl of ['https://openrouter.ai/api/v1', 'https://api.mistral.ai/v1', 'https://api.anthropic.com/v1']) {
    assert.deepEqual(baseUrlReasons({ provider: 'openrouter', baseUrl }), [], baseUrl);
  }
});
