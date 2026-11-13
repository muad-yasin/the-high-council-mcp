// S6-02 (0.8.4): STOPPED-error.json says what KIND of failure stopped the run: `causeClass` = transport / http_status / provider_body / unreadable_reply / other, from the error's flags only (never message text). `transient` keeps its meaning.
// Before, a dropped connection read `transient: false, maybeBilled: true` and nothing said "transport failure". Offline: stubbed fetch, loopback stubs, the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, causeClassOf, setRetrySleep } from '../src/providers.js';
import { runResumability } from '../src/run-status.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const opts = baseUrl => ({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, baseUrl });
const BASE = 'http://127.0.0.1:11434/v1';
const withFetch = async (fn, handler) => { const real = globalThis.fetch; globalThis.fetch = handler; setRetrySleep(async () => {}); try { return await fn(); } finally { globalThis.fetch = real; setRetrySleep(null); } };
const classOfThrown = (handler) => withFetch(() => call('ollama', opts(BASE)).then(() => assert.fail('expected a throw'), e => causeClassOf(e)), handler);

test('causeClassOf reads flags only: a message that says "HTTP 503" or "fetch failed" decides nothing', () => {
  assert.equal(causeClassOf(Object.assign(new Error('x'), { causeClass: 'transport' })), 'transport');
  assert.equal(causeClassOf(Object.assign(new Error('x'), { status: 503 })), 'http_status');
  assert.equal(causeClassOf(Object.assign(new Error('x'), { providerCode: 529 })), 'provider_body');
  assert.equal(causeClassOf(Object.assign(new Error('x'), { causeClass: 'unreadable_reply' })), 'unreadable_reply');
  assert.equal(causeClassOf(Object.assign(new Error('x'), { errorBody: { usage: null } })), 'provider_body');
  assert.equal(causeClassOf(new Error('HTTP 503 Service Unavailable')), 'other');
  assert.equal(causeClassOf(new TypeError('fetch failed')), 'other', 'a bare TypeError with no flag is not claimed as transport');
  assert.equal(causeClassOf(Object.assign(new Error('x'), { causeClass: 'made-up' })), 'other', 'an unknown class is not passed through');
  assert.equal(causeClassOf(null), 'other');
});

test('each place post() throws sets its class', async () => {
  assert.equal(await classOfThrown(async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET', syscall: 'read' } }); }), 'transport', 'no answer');
  assert.equal(await classOfThrown(async () => new Response('down', { status: 503, headers: { 'retry-after': '0' } })), 'http_status', 'a non-2xx status');
  assert.equal(await classOfThrown(async () => new Response(JSON.stringify({ error: { code: 529, message: 'overloaded' } }), { status: 200 })), 'provider_body', 'a 200 error body');
  assert.equal(await classOfThrown(async () => new Response('<html>not json</html>', { status: 200 })), 'unreadable_reply', 'a 200 body that is not JSON');
  assert.equal(await classOfThrown(async () => new Response('null', { status: 200 })), 'unreadable_reply', 'a 200 whose JSON the adapter\'s own parsing threw on (the marked-billed path)');
  assert.equal(await classOfThrown(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }); } })), 'transport', 'a connection dropped while reading a 200');
});

const workspace = chain => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cause-class-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  if (chain) writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain));
  return dir;
};
const stubbed = (handler, name) => new Promise(done => {
  const srv = http.createServer(handler);
  srv.listen(0, '127.0.0.1', () => {
    const seat = { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, lab: 'a' };
    done({ srv, dir: workspace({ name, maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [{ ...seat, lab: 'b' }] } }) });
  });
});
const RUN = '2026-10-28T16-50-00-000Z';
const startPaid = async (dir, chain) => {
  const spawnCli = args => new Promise(done => spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }, stdio: 'ignore' }).on('exit', code => done({ code })));
  const { code } = await startTyped(spawnCli, ['--chain', chain, '--task', 'tasks/t.md', '--run-id', RUN], join(dir, 'runs', RUN));
  return { code, error: JSON.parse(readFileSync(join(dir, 'runs', RUN, 'STOPPED-error.json'), 'utf8')) };
};

test('the CLI: a dropped connection is `transport`, still maybeBilled and not transient; run_status passes the field on', async () => {
  const { srv, dir } = await stubbed((req, res) => { req.resume(); req.on('end', () => req.socket.destroy()); }, 'drop');
  try {
    const { code, error } = await startPaid(dir, 'drop');
    assert.equal(code, 16);
    assert.deepEqual([error.causeClass, error.maybeBilled, error.transient], ['transport', true, false]);
    const runDir = join(dir, 'runs', RUN);
    const s = runResumability(runDir, JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')));
    assert.equal(s.error.causeClass, 'transport');
    assert.equal(s.reason, 'error', '`reason` is untouched: this unit adds the class, it does not redefine transient or needs');
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('the CLI: a provider that kept answering 503 is `http_status`, and transient stays true', async () => {
  const { srv, dir } = await stubbed((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 503; res.setHeader('retry-after', '0'); res.end('down'); }); }, 'down');
  try {
    const { code, error } = await startPaid(dir, 'down');
    assert.equal(code, 16);
    assert.deepEqual([error.causeClass, error.httpStatus, error.transient], ['http_status', 503, true]);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('the CLI: a seat that fails with a plain error is `other`', () => {
  const dir = workspace();
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8')); cfg.name = 'broken'; cfg.seats.builder = { provider: 'mock', model: 'mock-network-error' };
  writeFileSync(join(dir, 'chains', 'broken.json'), JSON.stringify(cfg));
  const r = spawnSync(process.execPath, [cli, '--chain', 'broken', '--task', 'tasks/t.md', '--run-id', RUN], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmpdir() }, timeout: 60_000 });
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', RUN, 'STOPPED-error.json'), 'utf8')).causeClass, 'other');
});
