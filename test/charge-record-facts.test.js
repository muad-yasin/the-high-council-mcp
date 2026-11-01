// S5-04 + S6-01(b) + S6-03 part 2 (0.8.4): a billed charge file (`superseded/<label>.charge-<n>.usage.json`) says what failed and how long the call ran:
// `ms` (the same span as a stage's `ms`), and the failure's own facts (`cause`, request `host`, a 200 body's `providerCode`; providers.js failureFactsOf: tokens only, never a message).
// Before, the file said "failed after it was sent and may have been billed" and nothing more, so a person reading a run folder could not tell a dropped socket from an error reply.
// Offline: the writer, then the real CLI against loopback stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordLostCharge } from '../src/superseded.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

test('the charge file carries the facts when the failure said some, and keeps its old key set when it said none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-charge-facts-'));
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const withFacts = read(recordLostCharge(dir, 'a', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', kind: 'billed', ms: 1234, cause: 'TypeError > ECONNRESET read', host: 'h.example', providerCode: 529 }));
  assert.deepEqual([withFacts.ms, withFacts.cause, withFacts.host, withFacts.providerCode], [1234, 'TypeError > ECONNRESET read', 'h.example', 529]);
  const plain = read(recordLostCharge(dir, 'b', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', kind: 'billed' }));
  assert.deepEqual(Object.keys(plain).sort(), ['kind', 'model', 'provider', 'reason', 'usage', 'usd']);
  const zero = read(recordLostCharge(dir, 'c', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', ms: 0 }));
  assert.equal(zero.ms, 0, 'a call that failed at once ran for 0 ms: that is a figure, not an absence');
  for (const bad of [-1, NaN, '12', null, undefined, Infinity]) assert.ok(!('ms' in read(recordLostCharge(dir, 'd', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', ms: bad }))), `left out: ${String(bad)}`);
});

const startWithStub = async handler => {
  const srv = http.createServer(handler);
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  const dir = mkdtempSync(join(tmpdir(), 'thc-charge-cli-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const seat = { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, lab: 'a' };
  writeFileSync(join(dir, 'chains', 'cf.json'), JSON.stringify({ name: 'cf', maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [{ ...seat, lab: 'b' }] } }));
  const RUN = '2026-10-28T20-00-00-000Z'; const runDir = join(dir, 'runs', RUN);
  const spawnCli = args => new Promise(done => spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }, stdio: 'ignore' }).on('exit', code => done({ code })));
  try { await startTyped(spawnCli, ['--chain', 'cf', '--task', 'tasks/t.md', '--run-id', RUN], runDir); } finally { srv.closeAllConnections(); srv.close(); }
  const supDir = join(runDir, 'superseded');
  const charges = readdirSync(supDir).filter(f => /\.charge-\d+\.usage\.json$/.test(f)).map(f => ({ f, ...JSON.parse(readFileSync(join(supDir, f), 'utf8')) }));
  return charges;
};

// the real verb: a loopback server that reads the request and drops the connection
test('the CLI: a dropped connection leaves a charge file with the cause, the request host and the time it ran', async () => {
  const charges = await startWithStub((req, res) => { req.resume(); req.on('end', () => req.socket.destroy()); });
  const billed = charges.filter(c => c.kind === 'billed');
  assert.equal(billed.length, 1, JSON.stringify(charges));
  assert.match(billed[0].cause, /^TypeError > .*(UND_ERR_SOCKET|ECONNRESET)/);
  assert.equal(billed[0].host, '127.0.0.1');
  assert.ok(Number.isFinite(billed[0].ms) && billed[0].ms >= 0, `ms is a figure: ${billed[0].ms}`);
  assert.ok(!('providerCode' in billed[0]));
});

test('the CLI: a 200 error reply leaves a charge file with the error code and the host', async () => {
  const charges = await startWithStub((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { code: 529, message: 'overloaded' } })); }); });
  const billed = charges.filter(c => c.kind === 'billed');
  assert.equal(billed.length, 1, JSON.stringify(charges));
  assert.deepEqual([billed[0].providerCode, billed[0].host], [529, '127.0.0.1']);
  assert.ok(Number.isFinite(billed[0].ms));
});
