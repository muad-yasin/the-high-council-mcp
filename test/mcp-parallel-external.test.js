// MCP external_prompt / submit_stage with several stages waiting at once (bug audit 2026-09-26 #4).
// A panel of external critics pauses together, but external_prompt named only the first stage and
// submit_stage accepted only the first, so the rest could not be answered over MCP. Now
// external_prompt lists every waiting stage and returns any one's prompt, submit_stage accepts any
// of them, and the run resumes only once none is left. Offline: mock and external seats, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

// Bug audit 2026-09-28 (external seats #1): stage labels with a dot (plan-daily-7's `opus5.5-sub`)
// failed the tools' old /^[a-z0-9-]+$/ schema, so no such stage could be answered over MCP.
test('a dotted lab (opus5.5-sub) can be fetched and answered over MCP; a ".." label is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-dotted-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'chains', 'dotted.json'), JSON.stringify({
      name: 'dotted', description: 'test', maxRounds: 1, signoff: 'unanimous',
      estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: {
        criteria: { provider: 'mock', model: 'mock-criteria' },
        builder: { provider: 'mock', model: 'mock-builder' },
        reviser: { provider: 'mock', model: 'mock-builder' },
        critics: [{ provider: 'external', model: 'subscription:opus-5.5', lab: 'opus5.5-sub' }],
      },
    }));
    const first = spawnSync(process.execPath, [cli, '--chain', 'dotted', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const p = await call(dir, 'external_prompt', { run, stage: 'panel-1-opus5.5-sub' });
    assert.equal(p.stage, 'panel-1-opus5.5-sub', JSON.stringify(p));
    const bad = (await mcpSession(dir, [{ name: 'submit_stage', arguments: { run, stage: '..panel', content: PASS } }])).get(2);
    assert.ok(bad.error || bad.result?.isError, `a ".." label must be refused, got ${JSON.stringify(bad)}`);
    const a = await call(dir, 'submit_stage', { run, stage: 'panel-1-opus5.5-sub', content: PASS });
    assert.equal(a.written, 'panel-1-opus5.5-sub.md', JSON.stringify(a));
    assert.equal(a.resumed, true);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

// Bug audit 2026-09-28 (area 6 MED-1): start_run checked context files against the denylist, but a
// resume re-read the folder unchecked, so a secret added during a pause reached every seat.
test('an MCP resume refuses when a context folder gained a denied file during the pause', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-ctx-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'ctx')); mkdirSync(join(dir, 'secrets'));
    writeFileSync(join(dir, '.env'), '');
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'ctx', 'direction.md'), 'Keep it small.\n');
    writeFileSync(join(dir, 'secrets', 'token.md'), 'SECRET-MARKER-123\n');
    const first = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--context', 'ctx'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stdout + first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const waiting = (await call(dir, 'external_prompt', { run })).stage;
    const { symlinkSync } = await import('node:fs');
    symlinkSync(join('..', 'secrets', 'token.md'), join(dir, 'ctx', 'zz.md'));
    const r = await call(dir, 'submit_stage', { run, stage: waiting, content: '# Plan\n\nA small app.\n' });
    assert.equal(r.resumed, false, JSON.stringify(r));
    assert.match(r.error || JSON.stringify(r), /refused to resume: context: refused/);
    for (const f of readdirSync(join(dir, 'runs', run))) {
      if (f.startsWith('NEEDS-')) assert.doesNotMatch(readFileSync(join(dir, 'runs', run, f), 'utf8'), /SECRET-MARKER-123/, f);
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
