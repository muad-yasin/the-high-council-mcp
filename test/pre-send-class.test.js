// S6-10 (0.8.4): a failed call is "nothing was sent" (free to retry, never charged) or "may have been sent" (never re-sent, charged a worst case) by WHAT FAILED, not by a list of codes.
// Pre-send: the name lookup (syscall `getaddrinfo`) or the connect (syscall `connect`) failed, or undici's connect timeout (no syscall, kept by name). An AggregateError (one error per address tried;
// its own `.code` is only the first member's) is pre-send only if EVERY member qualifies. Everything else is post-send: fail closed.
// Offline: stubbed fetch with the error shapes the $0 no-network rehearsal observed (Node 22: a TypeError whose cause is an Error, or an AggregateError of them), and the real CLI against a closed loopback port.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, setRetrySleep, isRetryable } from '../src/providers.js';
import { runChain, setBudget, setCache, budgetState } from '../src/chain.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const member = (code, syscall) => Object.assign(new Error('a message that decides nothing'), { code, ...(syscall ? { syscall } : {}) });
const aggregate = (members, code = members[0]?.code) => Object.assign(new AggregateError(members, 'agg'), code ? { code } : {});

// What one call does when fetch throws `new TypeError('fetch failed', { cause })`: how many times it was sent, and whether the thrown error says it may have been billed
async function classify(cause) {
  const real = globalThis.fetch; let calls = 0; setRetrySleep(async () => {});
  globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed', { cause }); };
  try {
    const err = await call('ollama', { model: 'm', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 10, baseUrl: 'http://127.0.0.1:11434/v1' }).then(() => assert.fail('expected a throw'), e => e);
    return { calls, maybeBilled: err.maybeBilled === true, retryable: isRetryable(err) };
  } finally { globalThis.fetch = real; setRetrySleep(null); }
}
const PRE = { calls: 3, maybeBilled: false };
const POST = { calls: 1, maybeBilled: true };
const same = (got, want, why) => assert.deepEqual({ calls: got.calls, maybeBilled: got.maybeBilled }, want, why);

test('a dual-stack name that failed on every address at connect is pre-send, whatever the first code is (the observed EADDRNOTAVAIL shape)', async () => {
  same(await classify(aggregate([member('EADDRNOTAVAIL', 'connect'), member('ENETUNREACH', 'connect')])), PRE, 'both members failed at connect: nothing was sent, so it is retried free and not charged');
  same(await classify(member('ENETUNREACH', 'connect')), PRE);
  same(await classify(member('ECONNREFUSED', 'connect')), PRE);
});

test('an AggregateError with one member that is not a connect failure is post-send, even when its own code looks like a refusal', async () => {
  const mixed = aggregate([member('ECONNREFUSED', 'connect'), member('ECONNRESET', 'read')], 'ECONNREFUSED');
  const got = await classify(mixed);
  same(got, POST, 'the code on the aggregate is only the first member\'s: it must not decide');
  assert.equal(got.retryable, false);
});

test('a name lookup that failed is pre-send whatever its code; undici\'s connect timeout stays pre-send by name', async () => {
  same(await classify(member('ENOTFOUND', 'getaddrinfo')), PRE);
  same(await classify(member('EAI_AGAIN', 'getaddrinfo')), PRE);
  same(await classify(member('EAI_FAIL', 'getaddrinfo')), PRE, 'an unlisted code at the lookup stage is still before the request');
  same(await classify(member('UND_ERR_CONNECT_TIMEOUT')), PRE, 'no syscall, but the name says it is the connect');
});

test('guards: anything not proven pre-send stays post-send (marked maybeBilled, not re-sent)', async () => {
  same(await classify(member('EWHATEVER')), POST, 'no syscall and a code nobody classified');
  same(await classify(member('ECONNREFUSED')), POST, 'a code alone is no longer the proof: the syscall is');
  same(await classify(member('ECONNRESET', 'read')), POST, 'a reset while reading');
  same(await classify(member('UND_ERR_SOCKET')), POST, 'a socket closed by the other side');
  same(await classify(member('UND_ERR_HEADERS_TIMEOUT')), POST, 'no response headers within the limit: the request had gone out');
  same(await classify(member('UND_ERR_BODY_TIMEOUT')), POST, 'a body that stalled: the request had gone out');
  same(await classify(aggregate([])), POST, 'an AggregateError with no members proves nothing');
  same(await classify(aggregate([member('ENETUNREACH', 'connect'), member('EWHATEVER')])), POST, 'one member without a syscall');
  same(await classify(undefined), POST, 'no cause at all');
  const throwing = new Error('x'); Object.defineProperty(throwing, 'syscall', { get() { throw new Error('boom'); } });
  same(await classify(throwing), POST, 'a getter that throws fails closed: the call is marked maybeBilled, and the error thrown is still the provider failure, not the getter\'s');
  const codeGetter = new Error('x'); Object.defineProperty(codeGetter, 'code', { get() { throw new Error('boom'); } });
  same(await classify(codeGetter), POST, 'a throwing `code` getter too: explainFetchFailure reads it');
  const boom = new Error('x'); Object.defineProperty(boom, 'errors', { get() { throw new Error('boom'); } });
  same(await classify(boom), POST, 'a throwing `errors` getter too');
});

// What one call does when fetch throws THIS error object itself (not a cause behind a plain TypeError): used for getters on the top-level error, which explainFetchFailure reads (name, message)
async function classifyTop(thrown) {
  const real = globalThis.fetch; let calls = 0; setRetrySleep(async () => {});
  globalThis.fetch = async () => { calls += 1; throw thrown; };
  try {
    const err = await call('ollama', { model: 'm', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 10, baseUrl: 'http://127.0.0.1:11434/v1' }).then(() => assert.fail('expected a throw'), e => e);
    return { err, calls, maybeBilled: err.maybeBilled === true };
  } finally { globalThis.fetch = real; setRetrySleep(null); }
}

test('a getter that throws on the top-level error cannot replace it: the call is still marked, and the thrown error says nothing from the error', async () => {
  for (const prop of ['name', 'message']) {
    const top = new TypeError('fetch failed', { cause: member('ECONNRESET', 'read') });
    Object.defineProperty(top, prop, { get() { throw new Error('boom'); } });
    const { err, calls, maybeBilled } = await classifyTop(top);
    assert.deepEqual({ calls, maybeBilled }, POST, `a throwing ${prop} getter on a post-send failure`);
    assert.equal(err.causeClass, 'transport');
    assert.equal(err.failureHost, '127.0.0.1');
    assert.ok(!/boom/.test(err.message), 'the fallback message is the label only');
  }
  const pre = new TypeError('fetch failed', { cause: member('ECONNREFUSED', 'connect') });
  Object.defineProperty(pre, 'name', { get() { throw new Error('boom'); } });
  const { err, calls } = await classifyTop(pre);
  assert.deepEqual([calls, err.maybeBilled === true], [1, false], 'a pre-send failure whose error cannot be explained is not marked, and (failing closed) not retried');
});

// the real verb: nothing listens on the port, so undici reports a real refused connection; retried free with the real backoff, never charged
test('the CLI: a seat whose server is not running is retried free, ends transient, and leaves no charge file', async () => {
  const srv = http.createServer(); await new Promise(done => srv.listen(0, '127.0.0.1', done));
  const port = srv.address().port; await new Promise(done => srv.close(done));
  const dir = mkdtempSync(join(tmpdir(), 'thc-presend-cli-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const seat = { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}/v1`, lab: 'a' };
  writeFileSync(join(dir, 'chains', 'closed.json'), JSON.stringify({ name: 'closed', maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [{ ...seat, lab: 'b' }] } }));
  const RUN = '2026-10-28T21-00-00-000Z'; const runDir = join(dir, 'runs', RUN);
  const spawnCli = args => new Promise(done => spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }, stdio: 'ignore' }).on('exit', code => done({ code })));
  const { code } = await startTyped(spawnCli, ['--chain', 'closed', '--task', 'tasks/t.md', '--run-id', RUN], runDir);
  assert.equal(code, 16);
  const e = JSON.parse(readFileSync(join(runDir, 'STOPPED-error.json'), 'utf8'));
  assert.deepEqual([e.causeClass, e.transient, e.maybeBilled === true], ['transport', true, false]);
  const sup = join(runDir, 'superseded');
  assert.deepEqual(existsSync(sup) ? readdirSync(sup).filter(f => /\.charge-/.test(f)) : [], [], 'nothing was sent, so nothing is charged');
});

// The cap enforces budget.spent, not the reservation line: a fetch that failed at the connect stage (nothing was sent) must leave the run's spent at 0.
test('S5-07: a call that failed at the connect stage leaves the run\'s spent at 0 (the observed EADDRNOTAVAIL shape through invoke)', async () => {
  const real = globalThis.fetch; const hadKey = process.env.OPENROUTER_API_KEY; let calls = 0;
  process.env.OPENROUTER_API_KEY = 'sk-test'; setRetrySleep(async () => {});
  globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed', { cause: aggregate([member('EADDRNOTAVAIL', 'connect'), member('ENETUNREACH', 'connect')]) }); };
  try {
    setCache(null); setBudget(1000);
    const seat = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 1000 };
    await assert.rejects(() => runChain({ request: 'Req.', config: { name: 'x', maxRounds: 1, seats: { criteria: seat, builder: seat, critics: [seat] } }, log: () => {} }));
    assert.equal(budgetState().spent, 0, 'a call that never reached the provider is not charged');
    assert.equal(budgetState().reserved, 0);
    assert.equal(calls, 3, 'nothing was sent, so the call was retried free');
  } finally { globalThis.fetch = real; setRetrySleep(null); setBudget(null); if (hadKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = hadKey; }
});
