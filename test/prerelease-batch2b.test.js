// Pre-release audit, follow-ups to batch 2 (C&C, 2026-09-23): money path #4 and MCP resume_run.
// Offline: a local stub server and mock seats; no real provider is called and no key is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spendReport } from '../src/spend.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');

test('money #4: a call that failed after it was sent is charged on disk, so --spend and a resume see it', async () => {
  // Answers 200 with a body that is not JSON: providers.js marks that maybeBilled.
  const srv = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>oops</html>'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const dir = mkdtempSync(join(tmpdir(), 'money4-'));
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
    writeFileSync(join(dir, 'chains', 'stub.json'), JSON.stringify({
      name: 'stub', maxRounds: 1, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: {
        criteria: { provider: 'mock', model: 'mock-criteria' },
        builder: { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1` },
        reviser: { provider: 'mock', model: 'mock-builder' },
        critics: [{ provider: 'mock', model: 'mock-critic-passer' }],
      },
    }));
    const r = await new Promise(res => {
      const c = spawn(process.execPath, [cli, '--task', 'tasks/x.md', '--chain', 'stub'], { cwd: dir, env: { PATH: process.env.PATH, OPENROUTER_API_KEY: 'test-not-a-key' } });
      let out = ''; c.stdout.on('data', b => { out += b; }); c.stderr.on('data', b => { out += b; });
      c.on('close', code => res({ code, out }));
    });
    assert.equal(r.code, 16, r.out);
    const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const charge = JSON.parse(readFileSync(join(run, 'superseded', 'build.charge-1.usage.json'), 'utf8'));
    assert.ok(charge.usd > 0, 'the possibly-billed attempt is on disk');
    assert.ok(spendReport(join(dir, 'runs'), { days: 1 }).totalUsd >= charge.usd, '--spend counts it');
  } finally { srv.close(); }
});

// A live MCP session over stdio (same shape as test/prerelease-batch4-mcp.test.js).
function mcpCall(cwd, call, timeoutMs = 60_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd } });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d;
      for (const line of buf.split('\n')) {
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill(); done(JSON.parse(m.result.content[0].text)); } } catch { /* partial or not JSON-RPC */ }
      }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'b2b', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: call },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}

test('MCP resume_run: a resume that dies at once is reported as not resumed, with its exit code and log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-resume-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'A task.');
  const id = '2026-09-01T00-00-00-000Z';
  mkdirSync(join(dir, 'runs', id), { recursive: true });
  writeFileSync(join(dir, 'runs', id, 'run.json'), JSON.stringify({ chain: 'no-such-chain', task: 'tasks/t.md', cwd: dir }));
  const r = await mcpCall(dir, { name: 'resume_run', arguments: { run: id } });
  assert.equal(r.resumed, false, JSON.stringify(r));
  assert.equal(r.exitCode, 1);
  assert.match(r.logTail, /No such chain/);
});
