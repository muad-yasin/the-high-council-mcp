// Pre-release audit, follow-ups to batch 2 (C&C, 2026-09-23): money path #4 and MCP resume_run.
// Offline: a local stub server and mock seats; no real provider is called and no key is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
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

// ---- pre-release cache audit #1 (Review/PreRelease_Audit_cache_2026-09-23.md, HIGH) ----
const extChain = {
  name: 'ext', maxRounds: 1, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' },
    builder: { provider: 'external', model: 'claude-code-session' },
    reviser: { provider: 'external', model: 'claude-code-session' },
    critics: [{ provider: 'mock', model: 'mock-critic-passer' }],
  },
};
function extWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'cache1-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'chains', 'ext.json'), JSON.stringify(extChain));
  return dir;
}
const cliSync = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH } });

test('cache audit #1 (auditor repro): an external answer from before input fingerprints is not replayed after the chain changed', () => {
  const dir = extWorkspace();
  assert.equal(cliSync(dir, ['--task', 'tasks/x.md', '--chain', 'ext']).status, 3);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  writeFileSync(join(run, 'build.md'), 'OLD BUILD ANSWER');
  // A pre-fix answer: no prompt.json, so no fingerprint and no prompt hash on record.
  unlinkSync(join(run, 'build.prompt.json'));
  writeFileSync(join(dir, 'chains', 'ext.json'), JSON.stringify({ ...extChain, description: 'edited' }));
  const r = cliSync(dir, ['--resume', run]);
  assert.equal(r.status, 3, `the old answer must not be graded; the run asks again:\n${r.stdout}${r.stderr}`);
  assert.ok(!existsSync(join(run, 'deliverable.md')));
  assert.equal(readFileSync(join(run, 'superseded', 'build.1.md'), 'utf8'), 'OLD BUILD ANSWER');
});

test('cache audit #1: a between-fixes entry is replayed but recorded, and its prompt hash is backfilled', () => {
  const dir = extWorkspace();
  assert.equal(cliSync(dir, ['--task', 'tasks/x.md', '--chain', 'ext']).status, 3);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const up = join(run, 'criteria.usage.json');
  const u = JSON.parse(readFileSync(up, 'utf8'));
  delete u.promptHash; // cached after the fingerprint fix, before the prompt-hash fix
  writeFileSync(up, JSON.stringify(u));
  writeFileSync(join(run, 'build.md'), 'A build.');
  const r = cliSync(dir, ['--resume', run]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(join(run, 'WARNINGS.md'), 'utf8'), /cache_unverified: stage "criteria"/);
  assert.deepEqual(JSON.parse(readFileSync(join(run, 'report.json'), 'utf8')).unverifiedReplays.map(x => x.stage), ['criteria']);
  assert.ok(JSON.parse(readFileSync(up, 'utf8')).promptHash, 'the trusted hit now carries its prompt hash');
});
