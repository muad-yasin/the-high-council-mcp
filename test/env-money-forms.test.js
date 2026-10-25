// Spend settings read in a form nobody meant (14 Oct 2026, C&C's entries 5 and 12). Every row drives the REAL entry (`council doctor`, the direct MCP server) and asserts the sentence, never only an exit code. $0: no chain is started.
//   entry 5   a spend line the .env reader could not read (`"COUNCIL_MAX_USD_LIMIT"=5`, `COUNCIL_MAX_USD_LIMIT: 5`, `max_usd_per_run=2`) was skipped in silence: now every command refuses, naming the file and the line.
//   entry 12  COUNCIL_WORKDIR is refused from a project .env, by name (the RA-15 list in test/regression-081-audit-reaudit.test.js carries it too).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const server = join(root, 'src/mcp/server.js');

function folder(dotenv, policy) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-moneyforms-'));
  if (dotenv !== undefined) writeFileSync(join(dir, '.env'), dotenv);
  if (policy !== undefined) writeFileSync(join(dir, 'policy.json'), policy);
  return dir;
}
const base = dir => ({ PATH: process.env.PATH, HOME: dir });
const doctor = (dir, env = {}) => spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, env: { ...base(dir), ...env }, encoding: 'utf8', timeout: 60_000 });

// Starts an MCP server entry, sends initialize and the given tools/call requests; resolves { exit, stderr, started, results } when it exits, answers everything or 20 s pass.
function boot({ entry, cwd, env = {}, calls = [] }) {
  return new Promise(done => {
    const child = spawn(process.execPath, entry, { cwd, env: { ...base(cwd), COUNCIL_ADVISE_MOCK: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', d => { err += d; });
    const byId = new Map(); let buf = ''; let exit = null; let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); try { child.kill(); } catch { /* gone */ } done({ exit, stderr: err, started: byId.has(1), results: calls.map((_, i) => byId.get(i + 2)) }); };
    const timer = setTimeout(finish, 20_000);
    child.on('exit', code => { exit = code; setTimeout(finish, 50); });
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
      }
      if (byId.has(1) && calls.every((_, i) => byId.has(i + 2))) setTimeout(finish, 50);
    });
    child.stdin.on('error', () => { /* the server exited first: the refusal is the result */ });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'money-forms', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const sentence = (file, line, name) => `${file}: line ${line} names ${name} but is not written as ${name}=<value>, so it sets nothing. It is a spend setting, so nothing started rather than guess what you meant. Write it as ${name}=<value> on one line and run the command again.`;

test('entry 5: a spend line in a form the reader cannot read stops `council doctor`, naming the file, the line and the setting; a comment and the plain form do not', () => {
  const forms = [['"COUNCIL_MAX_USD_LIMIT"=5', 'COUNCIL_MAX_USD_LIMIT'], ['COUNCIL_MAX_USD_LIMIT: 5', 'COUNCIL_MAX_USD_LIMIT'], ['max_usd_per_run=2', 'MAX_USD_PER_RUN'], ["export 'MAX_USD_PER_RUN' = 3", 'MAX_USD_PER_RUN']];
  for (const [text, name] of forms) {
    const dir = folder(`OPENROUTER_API_KEY=k\n${text}\n`);
    const r = doctor(dir);
    assert.equal(r.status, 2, `${text}: ${r.stdout}${r.stderr}`.slice(0, 400));
    assert.ok(r.stderr.includes(sentence(join(dir, '.env'), 2, name)), `${text}: the sentence names the file, line 2 and ${name}: ${r.stderr.slice(0, 400)}`);
  }
  for (const ok of ['# COUNCIL_MAX_USD_LIMIT: 5', 'COUNCIL_MAX_USD_LIMIT=5', 'MAX_USD_PER_RUN_NOTES: five dollars']) {
    const dir = folder(`OPENROUTER_API_KEY=k\n${ok}\n`);
    const r = doctor(dir);
    assert.equal(r.status, 0, `${ok} is not a refused form: ${r.stdout}${r.stderr}`.slice(0, 400));
  }
});

test('entry 5: the direct MCP server refuses the same line with the same sentence and starts nothing; the plain form starts', async () => {
  const dir = folder('"COUNCIL_MAX_USD_LIMIT"=5\n');
  const r = await boot({ entry: [server], cwd: dir });
  assert.equal(r.exit, 2, r.stderr);
  assert.ok(r.stderr.includes(`the-high-council: ${sentence(join(dir, '.env'), 1, 'COUNCIL_MAX_USD_LIMIT')}`), r.stderr.slice(0, 400));
  assert.equal(r.started, false);
  const ok = await boot({ entry: [server], cwd: folder('COUNCIL_MAX_USD_LIMIT=5\n') });
  assert.equal(ok.started, true, `control: ${ok.stderr}`);
});

test('entry 12: COUNCIL_WORKDIR in a project .env is refused by name, once, through `council doctor`', () => {
  const dir = folder(`OPENROUTER_API_KEY=k\nCOUNCIL_WORKDIR=${join(tmpdir(), 'elsewhere')}\nCOUNCIL_WORKDIR=/y\n`);
  const r = doctor(dir);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(0, 300));
  assert.equal((r.stderr.match(/\.env: COUNCIL_WORKDIR is not read from a project \.env file/g) || []).length, 1, r.stderr);
});
