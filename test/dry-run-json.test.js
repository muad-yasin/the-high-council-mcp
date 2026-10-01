// test/dry-run-json.test.js
//
// `council --dry-run --json` (src/dry-run.js): the dry run as one JSON document, with which seat
// lacks which key. The web UI shows the price and the missing keys before anything is paid, so
// the document is a contract: one JSON object on stdout, prices from the same function the human
// printout uses, a key's presence but never its value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { everySeatOf, everySeatSlotsOf } from '../src/chain.js';
import { estimateChainRows } from '../src/cost.js';
import { dryRunReport, seatKeyStatus } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const chainNames = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const load = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

// A clean environment: no provider key from the machine running the tests leaks in.
const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'TOGETHER_API_KEY', 'ZAI_API_KEY', 'OLLAMA_API_KEY'];
const cleanEnv = extra => {
  const env = { ...process.env, ...extra };
  for (const k of KEYS) if (!(k in extra)) delete env[k];
  return env;
};
const dry = (args, env = {}, cwd) => spawnSync(process.execPath, [cli, ...args, '--dry-run', '--json'], { encoding: 'utf8', env: cleanEnv(env), cwd: cwd ?? mkdtempSync(join(tmpdir(), 'thc-dry-')) });

test('the seat slots are the seats the guards read, for every shipped chain', () => {
  for (const name of chainNames) {
    const cfg = load(name);
    const slots = everySeatSlotsOf(cfg).map(s => s.seat);
    const seats = everySeatOf(cfg);
    assert.equal(slots.length, seats.length, name);
    slots.forEach((seat, i) => assert.equal(seat, seats[i], `${name}: slot ${i}`));
  }
});

test('--dry-run --json prints exactly one JSON document', () => {
  const r = dry(['--chain', 'mock-debate']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.schemaVersion, 1);
  assert.equal(j.kind, 'dry-run');
  assert.equal(j.chain, 'mock-debate');
  assert.equal(j.canRun, true);
  assert.deepEqual(j.missingKeys, []);
  assert.equal(j.estimate.worstCaseUsd, 0);
});

test('the JSON prices the chain with the same rows as the human printout', () => {
  for (const name of ['plan-premium-7', 'cheap-7-v2', 'mock-budget', 'plan-daily-7']) {
    const cfg = load(name);
    const rows = estimateChainRows(cfg);
    const j = dryRunReport(cfg);
    assert.equal(j.estimate.worstCaseUsd, rows.reduce((s, r) => s + r.usd, 0), name);
    assert.equal(j.rows.length, rows.length, name);
    assert.ok(j.estimate.floorUsd <= j.estimate.worstCaseUsd, `${name}: the one-round floor is never above the full cap`);
  }
});

test('a chain with one round has the same floor and worst case', () => {
  const cfg = { ...load('mock-budget'), maxRounds: 1 };
  const j = dryRunReport(cfg);
  assert.equal(j.estimate.floorUsd, j.estimate.worstCaseUsd);
});

test('every seat is listed with its own key status, and a missing key names the seats that need it', () => {
  const r = dry(['--chain', 'plan-premium-7']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.canRun, false);
  const slots = everySeatSlotsOf(load('plan-premium-7'));
  assert.equal(j.seats.length, slots.length);
  const external = j.seats.filter(s => s.provider === 'external');
  assert.ok(external.length > 0);
  for (const s of external) assert.deepEqual([s.keyRequired, s.status, s.envVar], [false, 'not_needed', null]);
  const missing = j.missingKeys.find(m => m.envVar === 'OPENROUTER_API_KEY');
  assert.ok(missing, 'OpenRouter is the key premium-7 needs');
  assert.ok(missing.seats.includes('criteria') && missing.seats.includes('critics[0]'));
  assert.ok(!missing.seats.includes('builder'), 'the external builder needs no key');
});

test('with the key set the chain can run, and the value is never printed', () => {
  const secret = 'sk-or-v1-THISISNOTAREALKEYBUTMUSTNEVERAPPEAR0123456789';
  const r = dry(['--chain', 'plan-premium-7'], { OPENROUTER_API_KEY: secret });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
  const j = JSON.parse(r.stdout);
  assert.equal(j.canRun, true);
  assert.deepEqual(j.missingKeys, []);
  assert.ok(j.seats.filter(s => s.provider === 'openrouter').every(s => s.status === 'ok'));
});

test('a key-optional provider (ollama) needs no key; mock and external never do', () => {
  assert.deepEqual(seatKeyStatus('ollama'), { envVar: 'OLLAMA_API_KEY', keyRequired: false, status: 'not_needed' });
  assert.equal(seatKeyStatus('mock').status, 'not_needed');
  assert.equal(seatKeyStatus('external').status, 'not_needed');
  assert.equal(seatKeyStatus('no-such-provider').status, 'unknown_provider');
});

test('--task adds the task size, and a task larger than the chain assumes is priced in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-dry-task-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'small.md'), 'A small task.\n');
  writeFileSync(join(dir, 'tasks', 'big.md'), 'x'.repeat(200_000));
  const small = JSON.parse(dry(['--chain', 'plan-premium-7', '--task', 'tasks/small.md'], {}, dir).stdout);
  assert.equal(small.task.largerThanAssumed, false);
  assert.equal(small.estimate.worstCaseWithTaskUsd, null);
  const big = JSON.parse(dry(['--chain', 'plan-premium-7', '--task', 'tasks/big.md'], {}, dir).stdout);
  assert.equal(big.task.largerThanAssumed, true);
  assert.ok(big.estimate.worstCaseWithTaskUsd > big.estimate.worstCaseUsd);
});

test('the cap block reports the default cap and whether the worst case is above it', () => {
  const r = dry(['--chain', 'plan-premium-7']);
  const j = JSON.parse(r.stdout);
  assert.equal(j.cap.defaultUsd, 7);
  assert.equal(j.cap.worstCaseAboveDefault, true);
  const r2 = dry(['--chain', 'plan-premium-7', '--max-usd', 'none']);
  assert.equal(JSON.parse(r2.stdout).cap.defaultUsd, null);
});

test('a chain that does not exist still fails as before, and prints no JSON', () => {
  const r = dry(['--chain', 'no-such-chain']);
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// The same document through the MCP tool, for an agent that starts runs (json is optional: without
// it dry_run still returns the text it always did).
function mcpCall(cwd, call) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: cleanEnv({ HOME: cwd }) });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, 60_000);
    child.stdout.on('data', d => {
      buf += d;
      for (const line of buf.split('\n')) {
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill(); done(m.result.content[0].text); } } catch { /* partial line */ }
      }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dry-run-json', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: call },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}

test('MCP dry_run: json true returns the JSON document, absent returns the text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-dry-mcp-'));
  const asJson = JSON.parse(await mcpCall(dir, { name: 'dry_run', arguments: { chain: 'mock-budget', json: true } }));
  assert.equal(asJson.kind, 'dry-run');
  assert.equal(asJson.chain, 'mock-budget');
  const asText = await mcpCall(dir, { name: 'dry_run', arguments: { chain: 'mock-budget' } });
  assert.match(asText, /TOTAL/);
});
