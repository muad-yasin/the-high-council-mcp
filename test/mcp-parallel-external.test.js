// MCP external_prompt / submit_stage with several stages waiting at once (bug audit 2026-09-26 #4).
// A panel of external critics pauses together, but external_prompt named only the first stage and
// submit_stage accepted only the first, so the rest could not be answered over MCP. Now
// external_prompt lists every waiting stage and returns any one's prompt, submit_stage accepts any
// of them, and the run resumes only once none is left. Offline: mock and external seats, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const EXT = lab => ({ provider: 'external', model: 'claude-code-session', lab });
const PASS = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });

function mcpSession(cwd, calls, { timeoutMs = 60_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd } });
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
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parallel', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const body = m => JSON.parse(m.result.content[0].text);
// One call per session, in order: each later call depends on what the one before wrote to disk.
const call = async (dir, name, args) => body((await mcpSession(dir, [{ name, arguments: args }])).get(2));

test('two external critics: both are listed, either can be answered first, and the run resumes after the last', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-parallel-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'chains', 'two-ext.json'), JSON.stringify({
      name: 'two-ext', description: 'test', maxRounds: 1, signoff: 'unanimous',
      estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: {
        criteria: { provider: 'mock', model: 'mock-criteria' },
        builder: { provider: 'mock', model: 'mock-builder' },
        reviser: { provider: 'mock', model: 'mock-builder' },
        critics: [EXT('ea'), { provider: 'mock', model: 'mock-critic-a', lab: 'mb' }, EXT('ec')],
      },
    }));
    const first = spawnSync(process.execPath, [cli, '--chain', 'two-ext', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const runDir = join(dir, 'runs', run);

    const p = await call(dir, 'external_prompt', { run });
    assert.deepEqual(p.waiting, ['panel-1-ea', 'panel-1-ec']);
    assert.equal(p.stage, 'panel-1-ea');
    const second = await call(dir, 'external_prompt', { run, stage: 'panel-1-ec' });
    assert.equal(second.stage, 'panel-1-ec');
    assert.ok(second.prompt.length > 0);
    assert.match((await call(dir, 'external_prompt', { run, stage: 'panel-1-mb' })).error, /not waiting/);

    // The second-listed stage first: accepted, and the run does not resume yet.
    const a = await call(dir, 'submit_stage', { run, stage: 'panel-1-ec', content: PASS });
    assert.equal(a.written, 'panel-1-ec.md', JSON.stringify(a));
    assert.equal(a.resumed, false);
    assert.deepEqual(a.waiting, ['panel-1-ea']);
    assert.ok(!existsSync(join(runDir, 'report.json')));
    // The last one resumes the run, which finishes.
    const b = await call(dir, 'submit_stage', { run, stage: 'panel-1-ea', content: PASS });
    assert.equal(b.resumed, true, JSON.stringify(b));
    for (let i = 0; i < 120 && !existsSync(join(runDir, 'report.json')); i++) await new Promise(r => setTimeout(r, 250));
    assert.ok(existsSync(join(runDir, 'report.json')), 'the run finished after both answers');
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
