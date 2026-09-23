// test/prerelease-batch4-mcp.test.js
//
// Pre-release audit 2026-09-23 (Review/PreRelease_Audit_McpServer_2026-09-23.md, fix batch 4),
// against a real MCP server over stdio, offline, mock chains only. Every test here fails on the
// code before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// A live session: requests go in at once, and the server stays up until every id is answered,
// so async tools (start_run waits on its child) get to reply.
function mcpSession(cwd, calls, { timeoutMs = 60_000, env = {} } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...env } });
    const want = new Set([1, ...calls.map((_, i) => i + 2)]);
    const byId = new Map();
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
      }
      if ([...want].every(id => byId.has(id))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(byId); }
    });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'batch4', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const body = m => JSON.parse(m.result.content[0].text);

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-batch4-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  return dir;
}

test('serverInfo carries the package version, not a hardcoded one', async () => {
  const dir = workspace();
  try {
    const res = await mcpSession(dir, []);
    assert.equal(res.get(1).result.serverInfo.version, version);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('plan_outline refuses .env, files outside the working directory and non-markdown; reads a task', async () => {
  const dir = workspace();
  writeFileSync(join(dir, '.env'), '# OPENAI_API_KEY=sk-FAKE-commented-out\n');
  const outside = mkdtempSync(join(tmpdir(), 'thc-batch4-out-'));
  writeFileSync(join(outside, 'x.md'), '# outside\n');
  try {
    const res = await mcpSession(dir, [
      { name: 'plan_outline', arguments: { file: '.env' } },
      { name: 'plan_outline', arguments: { file: join(outside, 'x.md') } },
      { name: 'plan_outline', arguments: { file: 'tasks/t.md' } },
    ]);
    const env = res.get(2).result.content[0].text;
    assert.match(env, /refused/);
    assert.doesNotMatch(env, /sk-FAKE/);
    assert.match(body(res.get(3)).error, /outside the working directory/);
    assert.equal(body(res.get(4)).sections[0].path, 'A plan');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('write_task creates tasks/ in a new project', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-batch4-new-'));
  try {
    const res = await mcpSession(dir, [{ name: 'write_task', arguments: { name: 'first', content: '# First\n' } }]);
    assert.ok(!res.get(2).result.isError, res.get(2).result.content[0].text);
    assert.equal(readFileSync(join(dir, 'tasks', 'first.md'), 'utf8'), '# First\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('list_chains shows a user chain from the working directory\'s chains/', async () => {
  const dir = workspace();
  mkdirSync(join(dir, 'chains'));
  const mock = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'my-own.json'), JSON.stringify({ ...mock, name: 'my-own', description: 'a user chain' }));
  try {
    const res = await mcpSession(dir, [{ name: 'list_chains', arguments: {} }]);
    const mine = body(res.get(2)).find(c => c.name === 'my-own');
    assert.ok(mine, 'user chain listed');
    assert.equal(mine.source, 'user');
    assert.ok(body(res.get(2)).some(c => c.name === 'verify'), 'package chains still listed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('start_run: parallel calls get distinct run ids; a run that dies at once is started:false; .env is refused as a task', async () => {
  const dir = workspace();
  writeFileSync(join(dir, '.env'), 'OPENROUTER_API_KEY=sk-or-v1-FAKE\n');
  try {
    const res = await mcpSession(dir, [
      { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } },
      { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } },
      { name: 'start_run', arguments: { chain: 'no-such-chain', task: 'tasks/t.md' } },
      { name: 'start_run', arguments: { chain: 'mock', task: '.env' } },
    ]);
    const [a, b, bad, env] = [2, 3, 4, 5].map(id => body(res.get(id)));
    assert.equal(a.started, true, JSON.stringify(a));
    assert.equal(b.started, true, JSON.stringify(b));
    assert.notEqual(a.run, b.run);
    assert.match(a.run, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/, 'plain ISO id, which spend.js counts');
    assert.ok(existsSync(join(dir, 'runs', a.run)) && existsSync(join(dir, 'runs', b.run)));
    assert.equal(bad.started, false, JSON.stringify(bad));
    assert.notEqual(bad.exitCode, 0);
    assert.equal(env.started, false);
    assert.match(env.error, /denylist/);
    assert.ok(!readFileSync(a.log, 'utf8').includes('sk-or-v1-FAKE'));
    // The mock runs keep writing after start_run answers; let them finish before cleaning up.
    for (const id of [a.run, b.run]) {
      for (let i = 0; i < 120 && !existsSync(join(dir, 'runs', id, 'report.json')); i++) await new Promise(r => setTimeout(r, 250));
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('CLI: --version prints the package version; a new run never reuses an existing folder', () => {
  assert.equal(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout.trim(), version);
  const dir = workspace();
  const id = '2026-01-01T00-00-00-000Z';
  mkdirSync(join(dir, 'runs', id), { recursive: true });
  try {
    const r = spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--run-id', id], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /already exists/);
    const bad = spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--run-id', '../x'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(bad.status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('start_run: a slow start that the artifact gate then refuses is started:false, not running', async () => {
  // Deterministic slow start, no CPU burners needed: a preload holds the run child for 2.5 s right
  // after it has taken the lock and written run.json, i.e. before the artifact gate. The old fixed
  // 1.5 s window (and a lock-only signal) both reported that as a running run.
  const dir = workspace();
  writeFileSync(join(dir, 'tasks', 'gate.md'), '# Review\n\nReview `src/billing/invoice.js` for bugs and fix the rounding.\n');
  const preload = join(dir, 'slow-start.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync;
fs.writeFileSync = function (p, ...rest) {
  const r = write.call(this, p, ...rest);
  if (process.argv.includes('--chain') && /[\\\\/]runs[\\\\/][^\\\\/]+[\\\\/]run\\.json$/.test(String(p))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
  return r;
};
syncBuiltinESMExports();
`);
  try {
    const res = await mcpSession(dir, [
      { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/gate.md' } },
      { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } },
    ], { env: { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` } });
    const [gated, ok] = [2, 3].map(id => body(res.get(id)));
    assert.equal(gated.started, false, JSON.stringify(gated));
    assert.equal(gated.exitCode, 9, JSON.stringify(gated));
    assert.match(gated.logTail, /BLOCKED/);
    assert.equal(ok.started, true, JSON.stringify(ok));
    for (let i = 0; i < 120 && !existsSync(join(dir, 'runs', ok.run, 'report.json')); i++) await new Promise(r => setTimeout(r, 250));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
