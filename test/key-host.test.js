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
import { baseUrlReasons } from '../src/denied-models.js';
import { costOf, needsPrice } from '../src/cost.js';
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

// 0.8.3 (C&C ruling 12 Oct; found by Builder C, Review/Build_0.8.3/m7/Mentat_Repos_Ideas.md section 1, check 1): an `ollama` seat (free, no key required) whose baseUrl names a KNOWN PAID provider's host passed baseUrlReasons (any known
// provider's own host was allowed for every provider) and keyDestinationReasons (optional-key providers are exempt), priced at $0, and sent OLLAMA_API_KEY there as a bearer: a paid call outside the spend cap. The fix is in baseUrlReasons ONLY, so
// chain-lint, the run-time check and the key-host rule inherit it with no second predicate: a free / optional-key provider's baseUrl may name only a loopback or private-network host.
const ollama = baseUrl => ({ provider: 'ollama', model: 'm', baseUrl });
test('baseUrlReasons: an ollama seat may name only a loopback or private-network host; a KNOWN PAID provider\'s host is refused with a reason naming the right provider; unknown public hosts stay refused', () => {
  const paid = [['https://openrouter.ai/api/v1', 'openrouter'], ['https://api.mistral.ai/v1', 'mistral'], ['https://api.anthropic.com/v1', 'anthropic'], ['https://api.openai.com/v1', 'openai']];
  for (const [url, name] of paid) {
    const r = baseUrlReasons(ollama(url));
    assert.equal(r.length, 1, `${url}: refused`);
    assert.match(r[0], new RegExp(`is ${name}'s own API host`), `${url}: names the provider`);
    assert.match(r[0], new RegExp(`use provider ${name} with its key, so the seat is priced and capped`), `${url}: says what to do`);
    assert.match(r[0], /ollama/);
  }
  for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:11434/v1', 'http://[::1]:11434/v1', 'http://192.168.1.20:11434/v1', 'http://10.0.0.5:11434/v1', 'http://172.16.3.4:11434/v1', 'http://box.local:11434/v1']) assert.deepEqual(baseUrlReasons(ollama(url)), [], url);
  assert.equal(baseUrlReasons(ollama('https://example.com/v1')).length, 1, 'an unknown public host stays refused');
  assert.equal(baseUrlReasons(ollama('https://model-router.example/v1')).length, 1, 'a router-named host stays refused');
  assert.equal(baseUrlReasons(ollama('https://api.x.ai/v1')).length, 1, 'a denied lab\'s host stays refused');
  assert.deepEqual(baseUrlReasons({ provider: 'ollama', model: 'm' }), [], 'no baseUrl: nothing to check');
  // the fix is not a rule for every provider: a KEYED provider's allowance of other known hosts is what it was (noted as a finding for the owner, not changed here); keyDestinationReasons is untouched
  assert.deepEqual(keyDestinationReasons(ollama('https://openrouter.ai/api/v1')), [], 'keyDestinationReasons still exempts optional-key providers: the refusal comes from baseUrlReasons');
});

test('lint and the price: an ollama seat on a paid provider\'s host is a denied-model finding now (0 before, 1 after), the controls stay as they were, and the seat would have priced at $0 (the escape the refusal closes)', () => {
  const c = chain('mock');
  const lint = baseUrl => lintChain({ ...c, seats: { ...c.seats, builder: ollama(baseUrl) } }).filter(f => f.kind === 'denied-model');
  assert.equal(lint('https://openrouter.ai/api/v1').length, 1, 'ollama -> a known paid host');
  assert.match(lint('https://openrouter.ai/api/v1')[0].message, /seats\.builder.*openrouter's own API host/);
  assert.equal(lint('http://192.168.1.20:11434/v1').length, 0, 'ollama -> a LAN host (control)');
  assert.equal(lint('http://127.0.0.1:11434/v1').length, 0, 'ollama -> loopback (control)');
  assert.equal(lint('https://example.com/v1').length, 1, 'ollama -> an unknown public host (control, refused as before)');
  assert.deepEqual(lintChain(chain('local-ollama')).filter(f => f.kind === 'denied-model'), [], 'the shipped local chain is clean');
  // why the refusal matters: the seat prices at $0 whatever the host, so only the host check can keep a paid call inside the cap
  assert.equal(needsPrice(ollama('https://openrouter.ai/api/v1')), false);
  assert.equal(costOf('ollama', 'm', { input: 1000, output: 1000 }).usd, 0);
});
