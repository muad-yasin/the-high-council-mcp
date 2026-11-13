// S6-03 part 1 (0.8.4): a stage's `<label>.usage.json` says which endpoint served the call, when the reply named one (OpenRouter's `provider` field).
// Before, the name reached the stage record and the audit line only, so a run folder could not say where a stage ran. Offline: loopback stub, the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpointField, writeSideStage } from '../src/stage-cache.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

test('endpointField keeps a plain short name and leaves out anything else, never cleaning it', () => {
  assert.deepEqual(endpointField({ endpoint: 'Azure' }), { endpoint: 'Azure' });
  assert.deepEqual(endpointField({ endpoint: 'Google AI Studio' }), { endpoint: 'Google AI Studio' });
  assert.deepEqual(endpointField({ endpoint: 'Together (fp8)' }), { endpoint: 'Together (fp8)' });
  for (const bad of ['', 'a'.repeat(65), 'two\nlines', 'a "quoted" name', '<b>x</b>', 'https://user:pw@host/p?k=1', '$(x)', null, undefined, 7, { n: 1 }]) {
    assert.deepEqual(endpointField({ endpoint: bad }), {}, `left out: ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(endpointField({}), {});
  assert.deepEqual(endpointField(null), {});
});

test('a side run\'s usage file carries the endpoint, and none when the reply named none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-endpoint-side-'));
  const stage = extra => ({ label: 'build', provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: 0.01, ms: 5, promptHash: 'h', text: 't', ...extra });
  writeSideStage(dir, stage({ endpoint: 'Azure' }), { fingerprint: 'f' });
  assert.equal(JSON.parse(readFileSync(join(dir, 'build.usage.json'), 'utf8')).endpoint, 'Azure');
  writeSideStage(dir, stage({ label: 'other', endpoint: null }), { fingerprint: 'f' });
  assert.ok(!('endpoint' in JSON.parse(readFileSync(join(dir, 'other.usage.json'), 'utf8'))));
});

// the real verb: a loopback stub that answers like OpenRouter and names the host that served the call, under the real CLI
test('the CLI writes the endpoint the reply named into the stage\'s usage file', async () => {
  const reply = provider => JSON.stringify({ model: 'deepseek/deepseek-v4-pro', ...(provider === undefined ? {} : { provider }), choices: [{ message: { content: 'A draft.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
  for (const [provider, expected] of [['Azure', 'Azure'], ['bad "name"\nline', undefined]]) {
    const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(reply(provider)); }); });
    await new Promise(done => srv.listen(0, '127.0.0.1', done));
    try {
      const dir = mkdtempSync(join(tmpdir(), 'thc-endpoint-cli-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
      writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
      const seat = { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, lab: 'a' };
      writeFileSync(join(dir, 'chains', 'ep.json'), JSON.stringify({ name: 'ep', maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [{ ...seat, lab: 'b' }] } }));
      const RUN = '2026-10-28T19-00-00-000Z'; const runDir = join(dir, 'runs', RUN);
      const spawnCli = args => new Promise(done => spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }, stdio: 'ignore' }).on('exit', code => done({ code })));
      await startTyped(spawnCli, ['--chain', 'ep', '--task', 'tasks/t.md', '--run-id', RUN], runDir);
      const files = readdirSync(runDir).filter(f => f.endsWith('.usage.json'));
      assert.ok(files.length >= 1, `a stage was recorded: ${readdirSync(runDir).join(' ')}`);
      for (const f of files) {
        const u = JSON.parse(readFileSync(join(runDir, f), 'utf8'));
        if (expected) assert.equal(u.endpoint, expected, f); else assert.ok(!('endpoint' in u), `${f}: an endpoint that is not a plain name is left out`);
      }
    } finally { srv.closeAllConnections(); srv.close(); }
  }
});
