// test/mcp-seat-boundary.test.js
//
// MLLM Coder v5 item 8 (docs/seat-permission-boundary.md): for planning seats, "a side seat reaches
// only its own agents" holds by construction. These pin the two parts of that claim a test can check,
// against a real MCP server over stdio, offline: no tool accepts a seat or agent identity, and a
// stage answer cannot be written to a stage the run is not waiting for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const RUN = '2026-01-01T00-00-00-000Z';

// One batch session: requests on stdin, responses matched by id. The server handles stdin lines in
// order and exits at end of input.
function mcpSession(cwd, calls) {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'boundary-test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, ...c })),
  ];
  const r = spawnSync(process.execPath, [cli, '--mcp'], {
    cwd, input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH },
  });
  const byId = new Map();
  for (const line of (r.stdout || '').split('\n')) {
    try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not a JSON-RPC line */ }
  }
  return byId;
}

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-boundary-'));
  const run = join(dir, 'runs', RUN);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'NEEDS-criteria.md'), '# External stage: criteria\n');
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'mock', task: 'task.md' }));
  return { dir, run };
}

test('no MCP tool takes a seat or agent identity', () => {
  const { dir } = workspace();
  try {
    const res = mcpSession(dir, [{ method: 'tools/list', params: {} }]);
    const tools = res.get(2)?.result?.tools;
    assert.ok(Array.isArray(tools) && tools.length > 0, 'tools/list returned no tools');
    const offending = tools.flatMap(t => Object.keys(t.inputSchema?.properties || {})
      .filter(p => /seat|agent/i.test(p)).map(p => `${t.name}.${p}`));
    assert.deepEqual(offending, [], 'a tool now accepts a seat/agent identity - docs/seat-permission-boundary.md stops being true by construction');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('submit_stage refuses a stage the run is not waiting for, and writes nothing', () => {
  const { dir, run } = workspace();
  try {
    const res = mcpSession(dir, [{ method: 'tools/call', params: { name: 'submit_stage', arguments: { run: RUN, stage: 'build', content: 'an answer for a stage nobody asked for' } } }]);
    // The tool's reply text is itself a JSON document, so parse it rather than matching escaped quotes.
    const reply = JSON.parse(res.get(2)?.result?.content?.[0]?.text || '{}');
    assert.equal(reply.error, 'run is not waiting for "build"');
    assert.equal(reply.waitingFor, 'criteria');
    assert.equal(existsSync(join(run, 'build.md')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
