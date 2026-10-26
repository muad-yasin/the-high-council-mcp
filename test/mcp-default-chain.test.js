// 0.8.3 tiers, commit 2 (gate note Tiers_Gate_Note.md, C&C Q4): over MCP, `start_run` and `dry_run` take NO chain and use the default chain (plan-mini-council), and the answer names it. It is not a silent spend: a start with no chain
// reaches the SAME typed-limit gate as any named paid chain (awaiting_user_cap), and nothing reaches a provider. $0: the project's own chains/plan-mini-council.json (a project chain of the same name is read first) holds mock
// seats and ONE paid seat that points at a loopback stub which counts requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { DEFAULT_CHAIN, defaultChainNotice } from '../src/chain-name.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const parsed = t => { try { return JSON.parse(t); } catch { return { raw: String(t).slice(0, 300) }; } };   // a refused call comes back as plain text: the assertions below then fail on their own, not on a parse error
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
        else if (m.id !== undefined) { answers.push(m.result.content[0].text); sendNext(); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'default-chain-test', version: '0' } } });
  });
}

test('DC-1 start_run with NO chain uses the default chain, names it, and reaches the typed-limit gate (awaiting_user_cap); nothing reaches the provider', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-default-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  try {
    writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
    const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    writeFileSync(join(work, 'chains', `${DEFAULT_CHAIN}.json`), JSON.stringify({ ...base, name: DEFAULT_CHAIN, seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
    const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
    const [text] = await session(work, env, [{ name: 'start_run', arguments: { task: 'tasks/x.md' } }]);
    const start = parsed(text);
    assert.equal(start.chain, DEFAULT_CHAIN, JSON.stringify(start));
    assert.equal(start.default_chain, true);
    assert.equal(start.default_chain_notice, defaultChainNotice());
    assert.deepEqual([start.state, start.requires_user, start.paid_started], ['awaiting_user_cap', true, false], JSON.stringify(start));
    assert.equal(requests, 0, 'nothing reached the provider: the typed limit is a number a person types, whatever the chain');
  } finally { srv.close(); rmSync(work, { recursive: true, force: true }); }
});

test('DC-2 dry_run with NO chain prices the default chain and names it (text: the notice comes first; json: the answer carries chain and defaultChainNotice); a named chain gets neither', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-default-')); mkdirSync(join(work, 'tasks'));
  try {
    const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys() };
    const [plain, json, named] = await session(work, env, [{ name: 'dry_run', arguments: {} }, { name: 'dry_run', arguments: { json: true } }, { name: 'dry_run', arguments: { chain: 'mock' } }]);
    assert.ok(plain.startsWith(defaultChainNotice()), `the notice first: ${plain.slice(0, 200)}`);
    assert.ok(plain.includes(DEFAULT_CHAIN));
    const j = parsed(json);
    assert.equal(j.chain, DEFAULT_CHAIN);
    assert.equal(j.defaultChainNotice, defaultChainNotice());
    assert.equal(named.includes(defaultChainNotice()), false, 'a named chain is not announced as the default');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('DC-3 a chain that is not a name is still refused when given, and an omitted chain is the only way to the default (the refusal text is unchanged)', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-default-')); mkdirSync(join(work, 'tasks'));
  try {
    writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
    const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys() };
    const [start, dry] = await session(work, env, [{ name: 'start_run', arguments: { chain: '../evil', task: 'tasks/x.md' } }, { name: 'dry_run', arguments: { chain: '/etc/passwd' } }]);
    assert.equal(parsed(start).started, false); assert.match(String(parsed(start).error), /chain name/i);
    assert.match(String(parsed(dry).error), /chain name/i);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
