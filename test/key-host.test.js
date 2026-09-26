// A provider's API key goes only to that provider's own host (security scan 2026-09-26, THC #6).
// The denied-model check accepts a loopback host, or any known provider's host, for every seat, since
// it only asks whether an endpoint can be shown to avoid a denied model; the adapter then sent the
// seat's key there. chain-lint's `key-host` rule now refuses a keyed seat whose baseUrl is not its
// own provider's https API host, and the CLI runs lint before every run and every resume. Keyless
// local providers (ollama) keep loopback and private-network hosts. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyDestinationReasons } from '../src/providers.js';
import { lintChain } from '../src/chain-lint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

test('keyDestinationReasons: a keyed provider only to its own https host; keyless local providers anywhere local', () => {
  const refused = [
    { provider: 'openrouter', baseUrl: 'http://127.0.0.1:9999/v1' },
    { provider: 'openrouter', baseUrl: 'http://localhost:1234/v1' },
    { provider: 'openrouter', baseUrl: 'https://api.mistral.ai/v1' },
    { provider: 'openrouter', baseUrl: 'http://openrouter.ai/api/v1' },
    { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
    { provider: 'mistral', baseUrl: 'http://192.168.1.20:8000/v1' },
    { provider: 'openrouter', baseUrl: 'not a url' },
  ];
  for (const s of refused) assert.ok(keyDestinationReasons({ model: 'm', ...s }).length, JSON.stringify(s));
  const allowed = [
    { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
    { provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1' },
    { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
    { provider: 'ollama', baseUrl: 'http://192.168.1.20:11434/v1' },
    { provider: 'openrouter' },
    { provider: 'mock', baseUrl: 'http://127.0.0.1:1/v1' },
  ];
  for (const s of allowed) assert.deepEqual(keyDestinationReasons({ model: 'm', ...s }), [], JSON.stringify(s));
  // The environment-only opt-in for a local proxy: loopback only.
  const optIn = { COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  assert.deepEqual(keyDestinationReasons({ provider: 'openrouter', model: 'm', baseUrl: 'http://127.0.0.1:9999/v1' }, optIn), []);
  assert.deepEqual(keyDestinationReasons({ provider: 'openrouter', model: 'm', baseUrl: 'http://localhost:4000/v1' }, optIn), []);
  assert.ok(keyDestinationReasons({ provider: 'openrouter', model: 'm', baseUrl: 'https://api.mistral.ai/v1' }, optIn).length);
  assert.ok(keyDestinationReasons({ provider: 'openrouter', model: 'm', baseUrl: 'http://192.168.1.20:4000/v1' }, optIn).length);
  assert.ok(keyDestinationReasons({ provider: 'openrouter', model: 'm', baseUrl: 'http://127.0.0.1:9999/v1' }, { COUNCIL_ALLOW_LOOPBACK_KEY_HOST: 'yes' }).length, 'only "1" opts in');
});

test('lint: a keyed seat pointed at another host is a key-host finding; every shipped chain is clean', () => {
  const c = chain('mock');
  const cfg = { ...c, seats: { ...c.seats, builder: { provider: 'openrouter', model: 'openai/gpt-5', baseUrl: 'http://127.0.0.1:9999/v1' } } };
  const found = lintChain(cfg).filter(f => f.kind === 'key-host');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /seats\.builder: .*OPENROUTER_API_KEY/);
  const pre = { ...c, preflight: { seats: [{ provider: 'openai', model: 'gpt-5', baseUrl: 'https://api.mistral.ai/v1' }] } };
  assert.ok(lintChain(pre).some(f => f.kind === 'key-host'), 'a seat outside seats{} is walked too');
  assert.deepEqual(lintChain(chain('local-ollama')).filter(f => f.kind === 'key-host'), []);
});

test('CLI: the key never reaches a listener a chain names as a keyed seat\'s baseUrl', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { seen.push(req.headers.authorization || ''); req.resume(); res.statusCode = 500; res.end('{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'thc-key-host-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    const c = chain('mock');
    const leak = { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, lab: 'leak' };
    writeFileSync(join(dir, 'chains', 'leak.json'), JSON.stringify({ ...c, name: 'leak', seats: { ...c.seats, criteria: leak } }));
    const out = await new Promise(done => {
      const child = spawn(process.execPath, [cli, '--chain', 'leak', '--task', 'tasks/t.md', '--max-usd', '1'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, OPENROUTER_API_KEY: 'sk-or-v1-CANARYKEY' } });
      let err = '';
      child.stderr.on('data', d => { err += d; });
      child.on('exit', code => done({ code, err }));
    });
    assert.equal(out.code, 1, out.err);
    assert.match(out.err, /\[key-host\]/);
    assert.deepEqual(seen, [], 'nothing was sent to the listener');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
