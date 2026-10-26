// COUNCIL_MAX_USD_LIMIT written in a project's .env (13 Oct 2026, audit item 1, C&C's ruling after ba359ef): `council --mcp` applies the .env AFTER src/mcp/server.js is imported (cli.js imports it
// statically), so a server that read the variable at import never saw a limit set there, and a client's start_run max_usd 50 ran over a .env limit of 1. The limit is now read at the start of
// runMcpServer. Every row goes through the real entry point (`cli.js --mcp`, a project folder with a .env, a tiny stdio client): no hand-built server state.
// Claims: (1) a .env limit holds against max_usd; (2) a malformed .env limit stops the server at start; (3) the real environment wins over the .env (row 3 guards env-file's present-wins rule, it cannot fail on the old server);
// (4) a placeholder, whitespace-only or half-placeholder value in the real environment is not replaced by the .env (env-file counts those as absent; the server keeps them and refuses); (5) the helper's rule on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { limitSource } from '../src/mcp/usd-limit.js';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const serverPath = join(dirname(cliPath), 'mcp', 'server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One project folder with a .env (the text given), a task file, and the server started from it. `env` is the real environment the host gives the server.
function session({ dotenv, env = {}, entry = 'cli', cwdDotenv }) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-usdenv-'));
  // cwdDotenv: the server is started in ANOTHER folder (its cwd) holding its own .env, with COUNCIL_WORKDIR = dir (the work folder).
  const cwdDir = cwdDotenv === undefined ? dir : mkdtempSync(join(tmpdir(), 'thc-usdenv-cwd-'));
  if (cwdDotenv !== undefined) writeFileSync(join(cwdDir, '.env'), cwdDotenv);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'A test task.');
  if (dotenv !== undefined) writeFileSync(join(dir, '.env'), dotenv);
  const srv = spawn(process.execPath, entry === 'direct' ? [serverPath] : [cliPath, '--mcp'], { cwd: cwdDir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_WORKDIR: dir, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  let buf = ''; const waiters = new Map(); let exited = null;
  srv.on('exit', (code, sig) => { exited = { code, sig }; for (const w of waiters.values()) w(null); });
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id !== undefined && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch { /* not a JSON-RPC line */ } } });
  const send = obj => { try { srv.stdin.write(`${JSON.stringify(obj)}\n`); } catch { /* the server is gone: the waiter below sees the exit */ } };
  const call = (id, method, params) => new Promise(r => { if (exited) return r(null); waiters.set(id, r); send({ jsonrpc: '2.0', id, method, params }); setTimeout(() => r(null), 20_000).unref(); });
  return {
    dir, cwdDir,
    stderr: () => err,
    exited: () => exited,
    async initialize() {
      const r = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'usd-env-test', version: '1' } });
      if (r) send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      return r;
    },
    async startRun(max_usd) {
      const r = await call(2, 'tools/call', { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md', max_usd } });
      return r?.result?.content?.[0]?.text ?? JSON.stringify(r?.error ?? r);
    },
    async tool(name, args) { const r = await call(3, 'tools/call', { name, arguments: args }); return r?.result ?? r; },
    async waitExit() { for (let i = 0; i < 400 && !exited; i++) await sleep(50); return exited; },
    runFolders: () => (existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')) : []),
    stop() { try { srv.kill(); } catch { /* already gone */ } },
  };
}

test('a COUNCIL_MAX_USD_LIMIT in the project .env holds: start_run max_usd 50 over a .env limit of 1 is refused and no run folder is made', async () => {
  const s = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=1\n' });
  try {
    assert.ok(await s.initialize(), `the server started: ${s.stderr()}`);
    const answer = await s.startRun(50);
    assert.ok(answer.includes('max_usd 50 is above') && answer.includes('COUNCIL_MAX_USD_LIMIT of $1'), `refused against the .env limit (the old server started the run at 50): ${answer}`);
    assert.deepEqual(s.runFolders(), [], 'a refused start makes no run folder');
  } finally { s.stop(); }
});

test('a malformed COUNCIL_MAX_USD_LIMIT in the project .env stops the server at start (exit 2, the sentence on stderr)', async () => {
  const s = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT="$2"\n' });
  try {
    const exit = await s.waitExit();
    assert.equal(exit?.code, 2, `exit code (the old server started with no limit): ${JSON.stringify(exit)} ${s.stderr()}`);
    assert.ok(s.stderr().includes('COUNCIL_MAX_USD_LIMIT is "$2"') && /did not start/.test(s.stderr()), s.stderr());
  } finally { s.stop(); }
});

test('the real environment wins over the .env: a real limit of 5 and a .env limit of 100 give a limit of 5', async () => {
  const s = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=100\n', env: { COUNCIL_MAX_USD_LIMIT: '5' } });
  try {
    assert.ok(await s.initialize(), `the server started: ${s.stderr()}`);
    const answer = await s.startRun(50);
    assert.ok(answer.includes('COUNCIL_MAX_USD_LIMIT of $5'), `the limit is the real environment's 5, not the .env's 100: ${answer}`);
  } finally { s.stop(); }
});

test('an unexpanded placeholder in the real environment is not replaced by the .env: the server still refuses to start', async () => {
  const s = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=100\n', env: { COUNCIL_MAX_USD_LIMIT: '${user_config.max_usd}' } });
  try {
    const exit = await s.waitExit();
    assert.equal(exit?.code, 2, `exit code (a project file must not pick the cap exactly when the operator's own setting failed): ${JSON.stringify(exit)} ${s.stderr()}`);
    assert.ok(s.stderr().includes('Spend ceiling per run (USD)'), s.stderr());
  } finally { s.stop(); }
});

// src/env-file.js fills a name whose real value is not PRESENT, and blank / whitespace-only / containing `${user_config.` count as not present: so these real values are all ones a .env could replace unless the server keeps them.
test('a whitespace-only or half-placeholder value in the real environment is not replaced by the .env either: the server refuses to start (the real environment wins)', async () => {
  for (const real of ['   ', '5${user_config.x}']) {
    const s = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=100\n', env: { COUNCIL_MAX_USD_LIMIT: real } });
    try {
      const exit = await s.waitExit();
      assert.equal(exit?.code, 2, `${JSON.stringify(real)}: exit code (the .env's 100 would have started the server): ${JSON.stringify(exit)} ${s.stderr()}`);
      assert.ok(/did not start/.test(s.stderr()), s.stderr());
    } finally { s.stop(); }
  }
});

test('limitSource: any non-empty value at import stays; only an unset or empty one takes the value after the .env', () => {
  assert.equal(limitSource('${user_config.max_usd}', '100'), '${user_config.max_usd}');
  assert.equal(limitSource('${user_config.max_usd}', undefined), '${user_config.max_usd}');
  assert.equal(limitSource('   ', '1'), '   ');
  assert.equal(limitSource('5${user_config.x}', '1'), '5${user_config.x}');
  assert.equal(limitSource('abc', 'abc'), 'abc');
  assert.equal(limitSource('5', '5'), '5');
  assert.equal(limitSource(undefined, '1'), '1');
  assert.equal(limitSource('', '1'), '1');
  assert.equal(limitSource(undefined, undefined), undefined);
});

// The advice path reads the same limit (its ctx gets `usdLimit` by value when the tools are registered, inside runMcpServer): a council_quote over a .env limit is refused before anything is written. The mock advice
// chain's ceiling is above 0.1 (test/advice-tools.test.js asserts the same refusal for a real-environment 0.1); the control row quotes the same brief with NO limit and is not refused, so the refusal is the limit's.
const BRIEF = {
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation', 'environment variables'],
};
test('the advice path reads the .env limit too: council_quote over a .env limit of 0.1 is refused (over_server_limit) and writes nothing; the same quote with no limit is not', async () => {
  const limited = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=0.1\n', env: { COUNCIL_ADVISE_MOCK: '1' } });
  const free = session({ dotenv: 'OPENROUTER_API_KEY=k\n', env: { COUNCIL_ADVISE_MOCK: '1' } });
  try {
    assert.ok(await limited.initialize(), limited.stderr());
    const refused = await limited.tool('council_quote', { brief: BRIEF, mode: 'single' });
    assert.equal(refused?.structuredContent?.code, 'over_server_limit', `refused against the .env limit: ${JSON.stringify(refused).slice(0, 300)}`);
    assert.match(refused.structuredContent.reason, /COUNCIL_MAX_USD_LIMIT/);
    assert.equal(existsSync(join(limited.dir, 'runs')), false, 'nothing was written');
    assert.ok(await free.initialize(), free.stderr());
    const quoted = await free.tool('council_quote', { brief: BRIEF, mode: 'single' });
    assert.equal(quoted?.structuredContent?.code, undefined, `control, no limit: the quote succeeded: ${JSON.stringify(quoted).slice(0, 300)}`);
    assert.match(String(quoted?.structuredContent?.quote_id), /^q_/, 'and it is a real quote (it carries a quote_id)');
  } finally { limited.stop(); free.stop(); }
});

// THE DIRECT ENTRY (`node src/mcp/server.js`, `npm run mcp`, the .mcpb bundle) applies no .env: a cap written there was read by nothing, and start_run max_usd "none" ran unbounded (C&C, from the Haiku diff audit). The server now reads
// the work folder's .env through env-file's own reader when the process was given no value. Rows: the red input; PARITY with `council --mcp`; the real environment still wins; a malformed or repeated line stops it the same way.
const refusal = async s => { assert.ok(await s.initialize(), s.stderr()); const a = await s.startRun('none'); return a; };
test('DIRECT ENTRY: a .env limit of 1 refuses start_run max_usd "none" (it ran unbounded), and the refusal sentence is the one `council --mcp` gives (parity)', async () => {
  const direct = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=1\n', entry: 'direct' }); const viaCli = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=1\n' });
  try {
    const a = await refusal(direct); const b = await refusal(viaCli);
    assert.ok(a.includes('max_usd \\"none\\" (no ceiling) is refused') && a.includes('COUNCIL_MAX_USD_LIMIT to $1'), `the direct entry refused (the old one started an unbounded run): ${a.slice(0, 300)}`);
    assert.equal(a, b, 'the same answer through both entries');
    assert.deepEqual(direct.runFolders(), [], 'no run folder');
  } finally { direct.stop(); viaCli.stop(); }
});

test('DIRECT ENTRY: the real environment wins over the .env (5 beats 100), and an unexpanded placeholder in the real environment is not replaced by the .env (exit 2)', async () => {
  const s = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=100\n', env: { COUNCIL_MAX_USD_LIMIT: '5' }, entry: 'direct' });
  const p = session({ dotenv: 'COUNCIL_MAX_USD_LIMIT=100\n', env: { COUNCIL_MAX_USD_LIMIT: '${user_config.max_usd}' }, entry: 'direct' });
  try {
    assert.ok(await s.initialize(), s.stderr());
    assert.ok((await s.startRun(50)).includes('COUNCIL_MAX_USD_LIMIT of $5'));
    assert.equal((await p.waitExit())?.code, 2, p.stderr());
  } finally { s.stop(); p.stop(); }
});

test('DIRECT ENTRY: a malformed .env limit and a repeated spend line stop the server at start (exit 2), with the same sentences as `council --mcp`', async () => {
  for (const [dotenv, want] of [['COUNCIL_MAX_USD_LIMIT="$2"\n', 'COUNCIL_MAX_USD_LIMIT is "$2"'], ['COUNCIL_MAX_USD_LIMIT=1\nCOUNCIL_MAX_USD_LIMIT=100\n', 'COUNCIL_MAX_USD_LIMIT is written on lines 1 and 2']]) {
    const d = session({ dotenv, entry: 'direct' }); const c = session({ dotenv });
    try {
      const ed = await d.waitExit(); const ec = await c.waitExit();
      assert.equal(ed?.code, 2, `${JSON.stringify(dotenv)}: ${d.stderr()}`);
      assert.equal(ec?.code, 2, c.stderr());
      assert.ok(d.stderr().includes(want) && c.stderr().includes(want), `${d.stderr()} | ${c.stderr()}`);
    } finally { d.stop(); c.stop(); }
  }
});

test('DIRECT ENTRY, control: with no .env limit and no real limit it starts with no server limit, as before', async () => {
  const s = session({ dotenv: 'OPENROUTER_API_KEY=k\n', entry: 'direct' });
  try { assert.ok(await s.initialize(), s.stderr()); const a = await s.startRun('none'); assert.ok(!a.includes('COUNCIL_MAX_USD_LIMIT'), a.slice(0, 200)); } finally { s.stop(); }
});

// TWO FILES (C&C's question on departure (c)): `council --mcp` applies the cwd's .env; the server also reads the WORK folder's. The same spend setting with different values in both: the cwd file used to win in silence.
// Probe before the fix: cwd 2 / work 3 started and ran at 2 (the work folder's file ignored without a word). Now it stops, naming both files.
test('TWO FILES: the same spend setting in the cwd .env and the work folder\'s .env with DIFFERENT values stops `council --mcp` (exit 2), naming both files; the same value in both, and a setting in one file only, start', async () => {
  const conflict = session({ cwdDotenv: 'MAX_USD_PER_RUN=2\n', dotenv: 'MAX_USD_PER_RUN=3\n' });
  const sameVal = session({ cwdDotenv: 'COUNCIL_MAX_USD_LIMIT=20\n', dotenv: 'COUNCIL_MAX_USD_LIMIT=20\n' });
  const oneFile = session({ cwdDotenv: 'COUNCIL_MAX_USD_LIMIT=1\n', dotenv: 'OPENROUTER_API_KEY=k\n' });
  const direct = session({ cwdDotenv: 'MAX_USD_PER_RUN=2\n', dotenv: 'MAX_USD_PER_RUN=3\n', entry: 'direct' });
  try {
    const e = await conflict.waitExit();
    assert.equal(e?.code, 2, conflict.stderr());
    const cwdFile = join(conflict.cwdDir, '.env'); const workFile = join(conflict.dir, '.env');
    assert.ok(conflict.stderr().includes(`${cwdFile} and ${workFile} both set MAX_USD_PER_RUN, to different values, so nothing started rather than guess which file you meant. Keep it in one file and run the command again.`), conflict.stderr());
    assert.ok(await sameVal.initialize(), `same value in both files: ${sameVal.stderr()}`);
    assert.ok(await oneFile.initialize(), oneFile.stderr());
    assert.ok((await oneFile.startRun(50)).includes('COUNCIL_MAX_USD_LIMIT of $1'), 'a setting in the cwd file only is applied, as before');
    assert.ok(await direct.initialize(), `the direct entry reads only the work folder\'s file, so nothing conflicts there: ${direct.stderr()}`);
  } finally { conflict.stop(); sameVal.stop(); oneFile.stop(); direct.stop(); }
});
