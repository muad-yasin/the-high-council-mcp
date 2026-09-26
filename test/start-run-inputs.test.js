// MCP start_run's file inputs and the CLI's --context reads (security scan 2026-09-26, THC #1).
//
// start_run checked `task` and `draft` against the denylist only, and `context` and `from_run` not
// at all, so a client could name any readable file (a .env, a file outside the project) and the CLI
// appended it to every seat's prompt. Every file the CLI would read for the four inputs is now
// checked, and all of them must lie inside the working directory. The CLI reads each --context file
// with a size cap and refuses anything that is not a regular file. Offline: mock chains, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const SECRET = 'sk-or-v1-CANARY0123456789';

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
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inputs', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const body = m => JSON.parse(m.result.content[0].text);

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-inputs-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  writeFileSync(join(dir, '.env'), `OPENROUTER_API_KEY=${SECRET}\n`);
  return dir;
}

test('start_run: context and from_run go through the denylist and stay inside the working directory', async () => {
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), 'thc-inputs-outside-'));
  try {
    writeFileSync(join(outside, 'private.md'), `notes ${SECRET}\n`);
    writeFileSync(join(outside, 'build.md'), 'a draft\n');
    writeFileSync(join(outside, 'criteria.md'), '{"criteria":["x"]}\n');
    // A context folder inside the project whose .md entry is a symlink out of it.
    mkdirSync(join(dir, 'ctx'));
    symlinkSync(join(outside, 'private.md'), join(dir, 'ctx', 'a.md'));
    mkdirSync(join(dir, 'ctx2'));
    symlinkSync(join(dir, '.env'), join(dir, 'ctx2', 'env.md'));
    // A run folder inside the project whose build.md points outside it.
    mkdirSync(join(dir, 'runs', 'fake'), { recursive: true });
    symlinkSync(join(outside, 'build.md'), join(dir, 'runs', 'fake', 'build.md'));
    writeFileSync(join(dir, 'runs', 'fake', 'criteria.md'), '{"criteria":["x"]}\n');
    const calls = [
      { chain: 'mock', task: 'tasks/t.md', context: '.env' },
      { chain: 'mock', task: 'tasks/t.md', context: 'ctx' },
      { chain: 'mock', task: 'tasks/t.md', context: 'ctx2' },
      { chain: 'mock', task: 'tasks/t.md', context: join(outside, 'private.md') },
      { chain: 'mock', task: 'tasks/t.md', context: `tasks/t.md,${join(outside, 'private.md')}` },
      { chain: 'mock', task: 'tasks/t.md', from_run: outside, rounds: 1 },
      { chain: 'mock', task: 'tasks/t.md', from_run: 'runs/fake', rounds: 1 },
      { chain: 'mock', task: 'tasks/t.md', from_run: '.', rounds: 1 },
      { chain: 'mock', task: join(outside, 'private.md') },
      { chain: 'mock', task: 'tasks/t.md', draft: join(outside, 'private.md') },
    ].map(a => ({ name: 'start_run', arguments: a }));
    const res = await mcpSession(dir, calls);
    const out = calls.map((_, i) => body(res.get(i + 2)));
    const expect = [
      [/^context: .*denylist/], [/^context: .*outside the working directory/], [/^context: .*denylist/],
      [/^context: .*outside the working directory/], [/^context: .*outside the working directory/],
      [/^from_run: .*outside the working directory/], [/^from_run: .*outside the working directory/],
      [/^from_run: .*(denylist|not a run folder)/],
      [/^task: .*outside the working directory/], [/^draft: .*outside the working directory/],
    ];
    out.forEach((o, i) => {
      assert.equal(o.started, false, `call ${i}: ${JSON.stringify(o)}`);
      assert.match(o.error, expect[i][0], `call ${i}`);
    });
    assert.ok(!existsSync(join(dir, 'runs')) || readdirSync(join(dir, 'runs')).every(d => d === 'fake'), 'no run was started');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('start_run: a context folder the project gitignores (context/) is still accepted', async () => {
  const dir = workspace();
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '.env\ncontext/\nruns/\ntasks/\n');
    mkdirSync(join(dir, 'context', 'direction'), { recursive: true });
    writeFileSync(join(dir, 'context', 'direction', 'mission.md'), '# Mission\n\nKeep it small.\n');
    const res = await mcpSession(dir, [{ name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md', context: 'context/direction' } }]);
    const o = body(res.get(2));
    assert.equal(o.started, true, JSON.stringify(o));
    for (let i = 0; i < 120 && !existsSync(join(dir, 'runs', o.run, 'report.json')); i++) await new Promise(r => setTimeout(r, 250));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('CLI --context: a FIFO and an over-limit file are refused with exit 2 before any call', { skip: process.platform === 'win32' }, () => {
  const dir = workspace();
  try {
    const fifo = join(dir, 'pipe.md');
    execFileSync('mkfifo', [fifo]);
    let r = spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--context', fifo], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30_000 });
    assert.equal(r.error, undefined, 'the CLI must not block on the FIFO');
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /not a regular file/);
    writeFileSync(join(dir, 'big.md'), 'x'.repeat(2_000_001));
    r = spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--context', 'big.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30_000 });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /over the 2000000-byte limit/);
    assert.ok(!existsSync(join(dir, 'runs')) || readdirSync(join(dir, 'runs')).length === 0, 'no run folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
