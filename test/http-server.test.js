// relay/test/http-server.test.js
//
// 2026-09-09 build: acceptance tests for src/http-server.js, the network interface trigger-service
// calls in production instead of spawning a local child process (see that file's own header
// comment for the full context). Real end-to-end tests run against `chains/mock-questions-wait`,
// the same $0 offline fixture trigger-service's own A3.2/A4/A5 tests already use (real `node
// src/cli.js` child processes, zero API cost, zero mocked spawnFn) - matching this repo's own
// testing convention rather than inventing a second one. Unit-level tests (auth, idempotency,
// budget guard, provider-key derivation) use an injected `spawnFn` for speed/determinism, the same
// dependency-injection shape trigger-service's own test suite uses throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRelayHttpServer, dailyUsage, requiredEnvForChain } from '../src/http-server.js';

const TOKEN = 'test-token-not-real';

async function startServer(opts = {}) {
  const app = createRelayHttpServer({ token: TOKEN, ...opts });
  const server = app.listen(0);
  await new Promise((resolvePromise) => server.once('listening', resolvePromise));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => {
      const closed = new Promise((resolvePromise) => server.close(resolvePromise));
      server.closeAllConnections();
      return closed;
    },
  };
}

function auth(token = TOKEN) {
  return { Authorization: `Bearer ${token}` };
}

function fakeChildProcess(exitCode, { stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });
  return child;
}

test('requiredEnvForChain(plan-auto) matches this repo\'s own chain config, not a guessed list', () => {
  const keys = requiredEnvForChain('plan-auto');
  assert.deepEqual(keys, ['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'TOGETHER_API_KEY']);
});

test('GET /health needs no auth and reports spend', async () => {
  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.ok(typeof body.spendLast24h.usd === 'number');
  } finally {
    await close();
  }
});

test('POST /runs without a bearer token -> 401, no spawn attempted', async () => {
  const spawnCalls = [];
  const { base, close } = await startServer({ spawnFn: (...a) => { spawnCalls.push(a); return fakeChildProcess(0); } });
  try {
    const res = await fetch(`${base}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'mock', taskContent: 'x', idempotencyKey: 'k1' }),
    });
    assert.equal(res.status, 401);
    assert.equal(spawnCalls.length, 0);
  } finally {
    await close();
  }
});

test('POST /runs budget_exceeded refuses before any spawn', async () => {
  const spawnCalls = [];
  const { base, close } = await startServer({
    spawnFn: (...a) => { spawnCalls.push(a); return fakeChildProcess(0); },
    maxUsdPerDay: 0,
    maxRunsPerDay: 5,
  });
  try {
    const res = await fetch(`${base}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ chain: 'mock', taskContent: 'x', idempotencyKey: 'k-budget' }),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'budget_exceeded');
    assert.equal(spawnCalls.length, 0);
  } finally {
    await close();
  }
});

test('POST /runs idempotency: a retried request with the same key replays the first result and never spawns twice', async () => {
  let spawnCount = 0;
  const relayRoot = mkdtempSync(join(tmpdir(), 'relay-idem-'));
  const { base, close } = await startServer({
    relayRoot,
    spawnFn: () => { spawnCount += 1; return fakeChildProcess(1, { stderr: 'boom' }); },
  });
  try {
    const body = { chain: 'mock', taskContent: 'x', idempotencyKey: 'order-123' };
    const first = await fetch(`${base}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) });
    const firstBody = await first.json();
    assert.equal(first.status, 500);
    assert.equal(firstBody.reason, 'nonzero_exit');

    const second = await fetch(`${base}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) });
    const secondBody = await second.json();
    assert.equal(second.status, 500);
    assert.deepEqual(secondBody, firstBody, 'replayed verbatim, not recomputed');
    assert.equal(spawnCount, 1, 'only spawned once despite two requests with the same idempotency key');
  } finally {
    await close();
    rmSync(relayRoot, { recursive: true, force: true });
  }
});

test('idemDir is independently overridable from relayRoot - a marker lands there, not under relayRoot, and survives independently of runs/', async () => {
  const relayRoot = mkdtempSync(join(tmpdir(), 'relay-idem-root-'));
  const idemDir = mkdtempSync(join(tmpdir(), 'relay-idem-store-'));
  let spawnCount = 0;
  const { base, close } = await startServer({
    relayRoot,
    idemDir,
    spawnFn: () => { spawnCount += 1; return fakeChildProcess(0); },
  });
  try {
    const body = { chain: 'mock', taskContent: 'x', idempotencyKey: 'order-separate-dir' };
    const res = await fetch(`${base}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) });
    assert.equal(res.status, 200);

    assert.ok(existsSync(join(idemDir, 'order-separate-dir.json')), 'the idempotency marker was written under the independent idemDir');
    assert.equal(existsSync(join(relayRoot, '.idempotency')), false, 'nothing was written under relayRoot\'s own default idempotency path');

    // A second request with the same key still replays without a second spawn, proving idemDir
    // (not just relayRoot) is what claimIdempotencyKey()/resolveIdempotencyKey() actually use.
    await fetch(`${base}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) });
    assert.equal(spawnCount, 1);
  } finally {
    await close();
    rmSync(relayRoot, { recursive: true, force: true });
    rmSync(idemDir, { recursive: true, force: true });
  }
});

test('dailyUsage sums report.json totals.usd only for run ids within the last 24h', () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'relay-usage-'));
  const recentId = new Date().toISOString().replace(/[:.]/g, '-').replace(/(\d{3})-Z$/, '$1Z');
  const oldId = new Date(Date.now() - 48 * 3600 * 1000).toISOString().replace(/[:.]/g, '-').replace(/(\d{3})-Z$/, '$1Z');
  for (const [id, usd] of [[recentId, 3.5], [oldId, 100]]) {
    mkdirSync(join(runsDir, id), { recursive: true });
    writeFileSync(join(runsDir, id, 'report.json'), JSON.stringify({ totals: { usd } }));
  }
  const usage = dailyUsage(runsDir);
  assert.equal(usage.count, 1);
  assert.equal(usage.usd, 3.5);
  rmSync(runsDir, { recursive: true, force: true });
});

test('real end-to-end against the $0 mock-questions-wait fixture: start pauses, resume completes, attachments serve PLAN.md/BOARD.md/HANDOFF.md content', async (t) => {
  // High caps: this hits the real repo root (cli.js needs its real chains/src alongside it, so
  // relayRoot can't be an isolated temp dir the way the idempotency/dailyUsage tests use) - the
  // real runs/ directory already holds this project's own day-to-day usage, which the default
  // $20/5-runs caps would otherwise count against. The budget guard itself has its own dedicated,
  // isolated test above.
  const { base, close } = await startServer({ maxUsdPerDay: 1_000_000, maxRunsPerDay: 1_000_000 });
  try {
    const startRes = await fetch(`${base}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({
        chain: 'mock-questions-wait',
        taskContent: 'A small tool that turns a one-paragraph idea into a build plan.',
        idempotencyKey: `test-run-${Date.now()}`,
      }),
    });
    const startBody = await startRes.json();
    assert.equal(startRes.status, 200);
    assert.equal(startBody.outcome, 'paused');
    assert.ok(startBody.runId, 'run id returned');
    assert.ok(Array.isArray(startBody.questions) && startBody.questions.length > 0);
    t.diagnostic(`run started and paused: ${startBody.runId}, ${startBody.questions.length} question(s)`);

    const answersText = startBody.questions.map((q, i) => `${i + 1}. default`).join('\n');
    const resumeRes = await fetch(`${base}/runs/${startBody.runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ answersText }),
    });
    const resumeBody = await resumeRes.json();
    assert.equal(resumeRes.status, 200);
    assert.deepEqual(resumeBody, { success: true });
    t.diagnostic('resume completed: PLAN.md/BOARD.md/HANDOFF.md all present');

    const attachRes = await fetch(`${base}/runs/${startBody.runId}/attachments`, { headers: auth() });
    const attachBody = await attachRes.json();
    assert.equal(attachRes.status, 200);
    const names = attachBody.files.map((f) => f.filename).sort();
    assert.deepEqual(names, ['BOARD.md', 'HANDOFF.md', 'PLAN.md']);
    for (const f of attachBody.files) assert.ok(f.content.length > 0, `${f.filename} has real content`);

    // Same cleanup convention as trigger-service's own a4-resume-harness.test.js: this ran against
    // the real, shared runs/ directory (see the high-caps comment above), so leave it exactly as
    // found rather than leaving test noise in a directory other live tools (relay's own MCP
    // server, list_runs) also read.
    rmSync(join(import.meta.dirname, '..', 'runs', startBody.runId), { recursive: true, force: true });
  } finally {
    await close();
  }
});

test('GET /runs/:id/attachments for an unknown run id -> 404', async () => {
  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/runs/not-a-real-run/attachments`, { headers: auth() });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});
