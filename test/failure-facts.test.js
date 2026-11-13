// S6-01 (0.8.4): the facts of a failed call. Node's fetch hides the real cause one or two levels down ("fetch failed" is a TypeError whose `cause` says what happened, or an AggregateError of one error per address tried);
// the stop line, STOPPED-error.json and a charge file (a later unit) printed only the top message. providers.js causeTextOf / failureFactsOf say it once, from the error's name, code and syscall TOKENS only (never a message, which can echo a
// header value or a URL). Offline: stubbed fetch, a loopback stub, the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, causeTextOf, failureFactsOf, setRetrySleep } from '../src/providers.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const opts = baseUrl => ({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, baseUrl });
const member = (code, syscall) => Object.assign(new Error('a message that must never be printed'), { code, syscall });
// the shape the $0 no-network rehearsal observed (Node 22): a TypeError whose cause is an AggregateError; its own `.code` is the FIRST member's
const observedAggregate = () => new TypeError('fetch failed', { cause: Object.assign(new AggregateError([member('EADDRNOTAVAIL', 'connect'), member('ENETUNREACH', 'connect')], 'agg'), { code: 'EADDRNOTAVAIL' }) });

test('the cause text names every level and the members of an AggregateError, as tokens', () => {
  assert.equal(causeTextOf(observedAggregate()), 'TypeError > AggregateError EADDRNOTAVAIL [Error EADDRNOTAVAIL connect, Error ENETUNREACH connect]');
  assert.equal(causeTextOf(new TypeError('fetch failed', { cause: { code: 'ECONNRESET', syscall: 'read' } })), 'TypeError > ECONNRESET read');
  assert.equal(causeTextOf(new Error('plain')), 'Error', 'an error with no cause says its name');
});

test('the cause text is built from tokens only: a message never reaches it, and a token that is not plain is dropped', () => {
  const secret = 'Bearer sk-or-v1-0123456789abcdef0123456789abcdef';
  const err = new TypeError(`Headers.append: "${secret}" is an invalid header value`, { cause: Object.assign(new Error(`bad ${secret} at https://user:pw@host/path?q=1`), { code: 'ECONNRESET', syscall: 'read' }) });
  const text = causeTextOf(err);
  assert.equal(text, 'TypeError > Error ECONNRESET read');
  assert.ok(!/sk-or|Bearer|user:pw|path/.test(text));
  assert.equal(causeTextOf({ name: 'Weird Name\nwith a newline', code: 'E OK', syscall: '$(rm -rf)' }), '', 'a token with spaces, newlines or shell characters is dropped, not cleaned');
});

test('a cause chain that loops, a getter that throws and a long chain end the text, they never hang or throw', () => {
  const a = new Error('a'); const b = new Error('b'); a.cause = b; b.cause = a;
  assert.equal(causeTextOf(a), 'Error');
  const g = new Error('g'); Object.defineProperty(g, 'cause', { get() { throw new Error('boom'); } });
  assert.equal(causeTextOf(g), 'Error');
  let deep = new Error('x'); for (let i = 0; i < 20; i++) deep = Object.assign(new Error('y'), { name: `L${i}`, cause: deep });
  assert.ok(causeTextOf(deep).length <= 300);
});

test('failureFactsOf: cause, request host and a 200 body\'s error code; nothing else, nothing unsafe', () => {
  assert.deepEqual(failureFactsOf({ causeText: 'TypeError > ECONNRESET read', failureHost: 'openrouter.ai', providerCode: 529 }), { cause: 'TypeError > ECONNRESET read', host: 'openrouter.ai', providerCode: 529 });
  assert.deepEqual(failureFactsOf({ providerCode: 'rate_limited', failureHost: '[::1]' }), { providerCode: 'rate_limited', host: '[::1]' });
  assert.deepEqual(failureFactsOf({ causeText: 'a "quoted" <tag>', failureHost: 'user:pw@host/path', providerCode: { nested: 1 } }), {}, 'anything outside the safe character sets is left out');
  assert.deepEqual(failureFactsOf(new Error('no facts')), {});
  assert.deepEqual(failureFactsOf(null), {});
});

test('a call that fails before any answer carries the cause text and the request host, and no URL parts or header values', async () => {
  const real = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' }) }); };
  setRetrySleep(async () => {});
  try {
    await assert.rejects(call('ollama', opts('http://127.0.0.1:11434/v1/secret-path?key=1')), err => {
      assert.equal(err.causeText, 'TypeError > Error ECONNRESET read');
      assert.equal(err.failureHost, '127.0.0.1');
      assert.equal(err.maybeBilled, true);
      return true;
    });
    assert.equal(calls, 1, 'a reset is after the send: not retried');
  } finally { globalThis.fetch = real; setRetrySleep(null); }
});

test('a dropped 200 body (the pilot\'s observed case) carries the inner cause too', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' }) }); } });
  try {
    await assert.rejects(call('ollama', opts('http://127.0.0.1:11434')), err => {
      assert.equal(err.causeText, 'TypeError > SocketError UND_ERR_SOCKET');
      assert.equal(err.failureHost, '127.0.0.1'); assert.equal(err.maybeBilled, true);
      return true;
    });
  } finally { globalThis.fetch = real; }
});

test('an error body (HTTP 200 with an error) carries its error code and the host', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 529, message: 'overloaded' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(call('ollama', opts('http://127.0.0.1:11434/v1')), err => { assert.deepEqual(failureFactsOf(err), { host: '127.0.0.1', providerCode: 529 }); return true; });
  } finally { globalThis.fetch = real; }
});

// the real verb: a loopback server that reads the request and drops the connection, under the real CLI
test('the CLI stop line and STOPPED-error.json name the cause of a dropped connection', async () => {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => req.socket.destroy()); });
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  try {
    const dir = mkdtempSync(join(tmpdir(), 'thc-facts-cli-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    const seat = { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, lab: 'a' };
    writeFileSync(join(dir, 'chains', 'drop.json'), JSON.stringify({ name: 'drop', maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [{ ...seat, lab: 'b' }] } }));
    const spawnCli = args => new Promise(done => spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }, stdio: 'ignore' }).on('exit', code => done({ code })));
    const RUN = '2026-10-28T16-00-00-000Z'; const runDir = join(dir, 'runs', RUN);
    const { code } = await startTyped(spawnCli, ['--chain', 'drop', '--task', 'tasks/t.md', '--run-id', RUN], runDir);
    assert.equal(code, 16);
    const e = JSON.parse(readFileSync(join(runDir, 'STOPPED-error.json'), 'utf8'));
    assert.match(e.cause, /^TypeError > .*(UND_ERR_SOCKET|ECONNRESET)/, e.cause);
    assert.equal(e.host, '127.0.0.1');
    assert.equal(e.message, 'fetch failed', 'the message itself is unchanged');
    assert.ok(!('providerCode' in e));
    const log = readFileSync(join(runDir, 'run.log'), 'utf8');
    assert.match(log, /STOPPED: the run failed - fetch failed \(cause: TypeError > .*(UND_ERR_SOCKET|ECONNRESET)/);
  } finally { srv.close(); }
});
