// MCP start_run on a PAID chain with nobody to type the limit (0.8.3 M6 typed cap T4a; typed-cap gate page section 8; C&C Q3 ruling 14 Oct 2026): the detached CLI ends with exit 21, and the server answers with the
// structured "awaiting a limit" result instead of a failed start. $0: the paid seat points at a local stub that COUNTS requests; none may arrive. The MCP dialog itself is T6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

function session(cwd, env, calls, timeoutMs = 60_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env });
    const answers = []; let buf = ''; let next = 0; let err = '';
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out after ${answers.length} answers; stderr: ${err}`)); }, timeoutMs);
    const send = m => child.stdin.write(JSON.stringify(m) + '\n');
    const sendNext = () => {
      if (next >= calls.length) { clearTimeout(timer); child.stdin.end(); child.kill(); return done(answers); }
      send({ jsonrpc: '2.0', id: next + 2, method: 'tools/call', params: calls[next++] });
    };
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); sendNext(); }
        else if (m.id !== undefined) { answers.push(JSON.parse(m.result.content[0].text)); sendNext(); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'awaiting-cap-test', version: '0' } } });
  });
}

test('start_run on a paid chain with no way to type a limit answers awaiting_user_cap (requires_user, paid_started false, the gate and the terminal step), sends no request, and run_status reads the same state', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const work = mkdtempSync(join(tmpdir(), 'thc-mcp-cap-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
    writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
    const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
    // every paid provider's key is malformed (nothing real can be reached from this clone's .env or shell); ONLY the stub seat's openrouter key is well-formed, and it points at a loopback stub that counts requests
    const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
    const [start] = await session(work, env, [{ name: 'start_run', arguments: { chain: 'c', task: 'tasks/x.md' } }]);
    assert.equal(start.started, false, JSON.stringify(start));
    assert.deepEqual([start.state, start.requires_user, start.paid_started, start.decision], ['awaiting_user_cap', true, false, 'g1'], JSON.stringify(start));
    assert.match(start.next, /person must type the limit.*gate answer .* g1/);
    assert.equal(requests, 0, 'nothing reached the provider');
    // the exit-21 child is recorded like every other child (the record comes BEFORE the exit-21 return in spawnRun): a dead pid in .spawn.json is read as not alive (src/run-status.js isRunAlive), so run_status says awaiting_user_cap, not running
    const rec = JSON.parse(readFileSync(join(work, 'runs', start.run, '.spawn.json'), 'utf8'));
    assert.ok(Number.isInteger(rec.pid) && rec.pid > 0, JSON.stringify(rec));
    const [status] = await session(work, env, [{ name: 'run_status', arguments: { run: start.run } }]);
    assert.equal(status.status, 'awaiting_user_cap', JSON.stringify(status).slice(0, 400));
    assert.match(status.state, /waiting for a spending limit that a person types/);
    assert.equal(requests, 0);
  } finally { srv.close(); }
});
