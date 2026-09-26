// A chain argument is a chain's name, never a path or a flag (security scan 2026-09-26, THC #5).
// MCP dry_run and start_run, the CLI's --chain, and the chain a --resume, --rematch or --replay reads
// back from run.json all go through src/chain-name.js. `council doctor --chain <file>` still takes
// a path: a person names that file on their own command line. Offline, mock chains, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isChainName } from '../src/chain-name.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const BAD = ['../../x', '../chains/mock', '/etc/passwd', 'chains/mock.json', '--spend', '--replay', '-x', '.hidden', '..', '', 'a b', 'mock\n'];

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
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chain-name', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const textOf = m => m.result?.content?.[0]?.text ?? JSON.stringify(m.error ?? m);

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-chain-name-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  // A JSON file outside chains/ that a path-shaped chain name would have loaded.
  writeFileSync(join(dir, 'x.json'), readFileSync(join(root, 'chains', 'mock.json')));
  return dir;
}
const cliRun = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 60_000 });

test('isChainName: names only', () => {
  for (const ok of ['mock', 'plan-debate', 'cheap-7-v2', 'my_chain.v2']) assert.ok(isChainName(ok), ok);
  for (const bad of [...BAD, null, 7]) assert.ok(!isChainName(bad), JSON.stringify(bad));
});

test('MCP dry_run and start_run refuse a chain that is not a name, before the CLI sees it', async () => {
  const dir = workspace();
  try {
    const calls = [
      ...BAD.map(chain => ({ name: 'dry_run', arguments: { chain } })),
      ...BAD.map(chain => ({ name: 'start_run', arguments: { chain, task: 'tasks/t.md' } })),
      { name: 'dry_run', arguments: { chain: 'mock' } },
    ];
    const res = await mcpSession(dir, calls);
    BAD.forEach((chain, i) => {
      assert.match(textOf(res.get(i + 2)), /expected a chain name/, `dry_run ${JSON.stringify(chain)}`);
      const s = JSON.parse(textOf(res.get(BAD.length + i + 2)));
      assert.equal(s.started, false, `start_run ${JSON.stringify(chain)}`);
      assert.match(s.error, /expected a chain name/);
    });
    assert.match(textOf(res.get(2 * BAD.length + 2)), /per run/, 'a real name still prices');
    assert.ok(!existsSync(join(dir, 'runs')) || readdirSync(join(dir, 'runs')).length === 0, 'no run was started');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: --chain must be a name, and so must the chain a resume, rematch or replay reads from run.json', () => {
  const dir = workspace();
  try {
    for (const chain of ['../x', 'x/../../x', '-x', '.hidden']) {
      const r = cliRun(dir, ['--chain', chain, '--task', 'tasks/t.md']);
      assert.equal(r.status, 2, `${chain}: ${r.stderr}`);
      assert.match(r.stderr, /--chain: expected a chain name/);
    }
    // A finished mock run, then its run.json pointed at a path.
    const ok = cliRun(dir, ['--chain', 'mock', '--task', 'tasks/t.md']);
    assert.equal(ok.status, 0, ok.stderr);
    const id = readdirSync(join(dir, 'runs'))[0];
    const runDir = join(dir, 'runs', id);
    const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...meta, chain: '../x' }));
    for (const [args, what] of [[['--rematch', `runs/${id}`], '--rematch'], [['--replay', `runs/${id}`], '--replay']]) {
      const r = cliRun(dir, args);
      assert.equal(r.status, 2, `${what}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, new RegExp(`${what}: the chain recorded in .*expected a chain name`));
    }
    // A resume reads the chain from run.json too (a finished run is refused with 15 before that, so
    // take away its report).
    rmSync(join(runDir, 'report.json'));
    const r = cliRun(dir, ['--resume', `runs/${id}`]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--resume: the chain recorded in run.json: expected a chain name/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('council doctor --chain still takes a path to a chain file', () => {
  const r = spawnSync(process.execPath, [cli, 'doctor', '--chain', 'chains/mock.json'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
});
