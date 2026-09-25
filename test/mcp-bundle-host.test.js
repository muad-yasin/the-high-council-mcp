// A host that launches src/mcp/server.js from a bundle (Claude Desktop's .mcpb, mcpb/manifest.json)
// controls neither the server's working directory nor, for an optional setting the user left
// empty, whether its `${user_config.x}` placeholder was substituted. Offline, against a real
// server over stdio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(root, 'src', 'mcp', 'server.js');

function mcpSession({ cwd, env, calls }) {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bundle-host-test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
  ];
  // No PATH: the server must find Node for its CLI child without one, as a bundle host may not
  // put its own Node on PATH.
  const r = spawnSync(process.execPath, [server], {
    cwd, input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 90_000, env,
  });
  const byId = new Map();
  for (const line of (r.stdout || '').split('\n')) {
    try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
  }
  return byId;
}
const payload = m => JSON.parse(m?.result?.content?.[0]?.text ?? 'null');

test('COUNCIL_WORKDIR puts tasks and runs there, not in the directory the host started the server in', () => {
  const hostCwd = mkdtempSync(join(tmpdir(), 'thc-host-'));
  const work = join(mkdtempSync(join(tmpdir(), 'thc-work-')), 'council'); // does not exist yet
  try {
    const res = mcpSession({
      cwd: hostCwd,
      env: { COUNCIL_WORKDIR: work },
      calls: [
        { name: 'write_task', arguments: { name: 'demo', content: '# Task\n\nPlan a small todo app.\n' } },
        { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/demo.md', max_usd: 1 } },
      ],
    });
    assert.ok(existsSync(join(work, 'tasks', 'demo.md')), 'the task was written under COUNCIL_WORKDIR');
    assert.ok(!existsSync(join(hostCwd, 'tasks')), 'nothing was written where the host started the server');
    const started = payload(res.get(3));
    assert.equal(started?.started, true, JSON.stringify(started));
    assert.ok(existsSync(join(work, 'runs', started.run)), 'the run folder is under COUNCIL_WORKDIR');
  } finally {
    rmSync(hostCwd, { recursive: true, force: true });
  }
});

test('an unsubstituted ${user_config.x} placeholder is read as unset, not as a key or a ceiling', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-work-'));
  try {
    const res = mcpSession({
      cwd: work,
      env: { OPENAI_API_KEY: '${user_config.openai_api_key}', MAX_USD_PER_RUN: '${user_config.max_usd}' },
      calls: [
        { name: 'write_task', arguments: { name: 'demo', content: '# Task\n\nPlan a small todo app.\n' } },
        { name: 'start_run', arguments: { chain: 'single-vendor-openai', task: 'tasks/demo.md' } },
        { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/demo.md' } },
      ],
    });
    const keyed = payload(res.get(3));
    assert.equal(keyed?.started, false, 'a placeholder must not pass the key check');
    assert.equal(keyed.exitCode, 5, `missing key (COUNCIL-E001), got ${JSON.stringify(keyed)}`);
    assert.doesNotMatch(readFileSync(keyed.log, 'utf8'), /user_config/);
    const mock = payload(res.get(4));
    assert.equal(mock?.started, true, `a placeholder ceiling must fall back to the default, got ${JSON.stringify(mock)}`);
  } finally {
    // The mock run started above is detached and may still be writing; the tmp dir is left for the OS.
  }
});

test('COUNCIL_MAX_USD_LIMIT is a ceiling the tool arguments cannot lift or remove', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-work-'));
  try {
    const res = mcpSession({
      cwd: work,
      env: { COUNCIL_MAX_USD_LIMIT: '1', MAX_USD_PER_RUN: '50' },
      calls: [
        { name: 'write_task', arguments: { name: 'demo', content: '# Task\n\nPlan a small todo app.\n' } },
        { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/demo.md', max_usd: 0 } },
        { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/demo.md', max_usd: 5 } },
        { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/demo.md' } },
      ],
    });
    for (const id of [3, 4]) {
      const r = payload(res.get(id));
      assert.equal(r?.started, false, JSON.stringify(r));
      assert.match(r.error, /COUNCIL_MAX_USD_LIMIT/);
      assert.equal(r.run, undefined, 'refused before any run folder was made');
    }
    // No max_usd: the lower of the limit ($1) and MAX_USD_PER_RUN ($50) applies, and stops the run.
    const capped = payload(res.get(5));
    assert.equal(capped?.exitCode, 4, JSON.stringify(capped));
    const stop = JSON.parse(readFileSync(join(work, 'runs', capped.run, 'STOPPED-budget.json'), 'utf8'));
    assert.equal(stop.capUsd, 1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
