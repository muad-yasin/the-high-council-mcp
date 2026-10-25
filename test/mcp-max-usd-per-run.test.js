// MAX_USD_PER_RUN over MCP (13 Oct 2026, audit item 11 / S02-3, C&C's rulings): the server's two ceiling defaults (src/mcp/server.js ceilingArgs) turned a MAX_USD_PER_RUN that is set but not a positive number
// (`2  # cheap`, `abc`, `-1`) into $7 without a word, while the CLI refuses the same value with a sentence. Now both branches refuse with the CLI's own sentence (src/cli.js:1074-1080):
//   (1) a limit is set and start_run/resume_run names no max_usd   -> was min(limit, 7);
//   (2) NO limit and resume_run of a run with no saved cap          -> was an explicit `--max-usd 7` (so the child never read the variable).
// The reader is Number(), as the CLI's (the plain-decimal rule belongs to COUNCIL_MAX_USD_LIMIT only). `none` / `off` are the CLI's words for "no ceiling": over MCP they read as unset (the default of 7, min(limit, 7) under a limit), never an open ceiling and never a higher default.
// Driven through the REAL server process started directly (`node src/mcp/server.js`): through `council --mcp` a malformed value exits at the CLI's own start-up check before any server exists. $0 (a mock chain).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const server = join(root, 'src/mcp/server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// M7 apply E102: the sentence an MCP client reads names MAX_USD_PER_RUN (pass 2 final wording), not the CLI's --max-usd
const EXPECTED = bad => `MAX_USD_PER_RUN is "${bad}", which is not a positive number of dollars. Set a number such as 2 or 7.50 for it where it is set (the server's environment, or the work folder's .env), or remove it to use the default of $7 (or your COUNCIL_MAX_USD_LIMIT where that is lower).`;

function mcp(work, calls, env, entry = 'direct') {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, entry === 'cli' ? [cli, '--mcp'] : [server], { cwd: work, env: { PATH: process.env.PATH, HOME: work, COUNCIL_WORKDIR: work, ...malformedProviderKeys(), ...env } });
    const want = new Set(calls.map((_, i) => i + 2)); const byId = new Map(); let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, 60_000);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
      }
      if ([...want].every(id => byId.has(id))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(calls.map((_, i) => byId.get(i + 2))); }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'max-usd-per-run', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const errorOf = a => String(a.error ?? a.raw ?? JSON.stringify(a));
const payload = m => { const t = m?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return { raw: t ?? JSON.stringify(m) }; } };

// A working folder with a task; `paused` makes it a real run paused at its external stage whose run.json has NO saved cap (the shape a cloned repository can ship).
function world({ paused = false, dotenv } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'thc-maxusd-')); mkdirSync(join(work, 'tasks'), { recursive: true });
  if (dotenv !== undefined) writeFileSync(join(work, '.env'), dotenv);
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  if (!paused) return { work };
  const p = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
  assert.equal(p.status, 3, `fixture: the run paused at its external stage: ${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0]; const dir = join(work, 'runs', id);
  const meta = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); meta.maxUsd = null;
  writeFileSync(join(dir, 'run.json'), JSON.stringify(meta));
  writeFileSync(join(dir, 'build.md'), '# Plan\n\nA short plan.\n');
  return { work, id, dir, logs: () => readdirSync(work).filter(f => /^council-.*\.log$/.test(f)).map(f => readFileSync(join(work, f), 'utf8')).join('\n') };
}
const capLines = w => [...w.logs().matchAll(/^cap:\s+(.*)$/gm)].map(m => m[1]);
const savedCap = async (work, run) => { for (let i = 0; i < 200; i++) { const p = join(work, 'runs', run, 'run.json'); if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')).maxUsd; } catch { /* mid-write */ } } await sleep(50); } return undefined; };
const START = { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } };

test('(1) a limit is set and start_run names no max_usd: a MAX_USD_PER_RUN of `2  # cheap`, `abc` or `-1` is refused with the CLI sentence and no run starts (it was min(limit, 7))', async () => {
  for (const bad of ['2  # cheap', 'abc', '-1']) {
    const w = world();
    const [r] = await mcp(w.work, [START], { COUNCIL_MAX_USD_LIMIT: '20', MAX_USD_PER_RUN: bad });
    const a = payload(r);
    assert.ok(errorOf(a).includes(EXPECTED(bad)), `${JSON.stringify(bad)} is refused with the CLI's sentence (the old server started the run under 7): ${JSON.stringify(a).slice(0, 300)}`);
    assert.equal(existsSync(join(w.work, 'runs')), false, 'a refused start makes no run folder');
  }
});

test('(1) the same for 0 and for an EMPTY value (their own sentences), and `none` / `off` read as unset: the run is capped at min(limit, 7) = 7, as it was before', async () => {
  const w = world();
  const [r0] = await mcp(w.work, [START], { COUNCIL_MAX_USD_LIMIT: '20', MAX_USD_PER_RUN: '0' });
  assert.ok(errorOf(payload(r0)).includes(EXPECTED('0')), JSON.stringify(payload(r0)).slice(0, 300));
  const [rEmpty] = await mcp(world().work, [START], { COUNCIL_MAX_USD_LIMIT: '20', MAX_USD_PER_RUN: '' });
  assert.ok(errorOf(payload(rEmpty)).includes('MAX_USD_PER_RUN is set but empty. Set a number such as 2 or 7.50, or remove it to use the default of $7 (or your COUNCIL_MAX_USD_LIMIT where that is lower).'), JSON.stringify(payload(rEmpty)).slice(0, 300));
  for (const word of ['none', 'off']) {
    const x = world();
    const [r] = await mcp(x.work, [START], { COUNCIL_MAX_USD_LIMIT: '20', MAX_USD_PER_RUN: word });
    assert.equal(payload(r).started, true, `${word}: ${JSON.stringify(payload(r)).slice(0, 200)}`);
    assert.equal(await savedCap(x.work, payload(r).run), 7, `${word}: never an open ceiling and never above the default over MCP`);
  }
});

test('(1) control: a readable MAX_USD_PER_RUN is used as before (2, under a limit of 20)', async () => {
  const w = world();
  const [r] = await mcp(w.work, [START], { COUNCIL_MAX_USD_LIMIT: '20', MAX_USD_PER_RUN: '2' });
  assert.equal(payload(r).started, true, JSON.stringify(payload(r)).slice(0, 200));
  assert.equal(await savedCap(w.work, payload(r).run), 2);
});

test('(2) NO limit, resume_run of a run with no saved cap: a malformed MAX_USD_PER_RUN is refused with the CLI sentence (it was an explicit `--max-usd 7`, so nothing refused)', async () => {
  const w = world({ paused: true });
  const before = capLines(w).length;
  const [r] = await mcp(w.work, [{ name: 'resume_run', arguments: { run: w.id } }], { MAX_USD_PER_RUN: '2  # cheap' });
  assert.ok(errorOf(payload(r)).includes(EXPECTED('2  # cheap')), `refused (the old server resumed it under $7): ${JSON.stringify(payload(r)).slice(0, 300)}`);
  await sleep(1500);
  assert.equal(capLines(w).length, before, 'and no sitting started: no new cap line in the log');
});

test('(2) control: with a readable MAX_USD_PER_RUN the same resume runs under it ($3), and with none set under the default $7', async () => {
  for (const [env, cap] of [[{ MAX_USD_PER_RUN: '3' }, /^\$3\.00 per run/], [{}, /^\$7\.00 per run/]]) {
    const w = world({ paused: true });
    const before = capLines(w).length;
    await mcp(w.work, [{ name: 'resume_run', arguments: { run: w.id } }], env);
    let line; for (let i = 0; i < 200 && capLines(w).length <= before; i++) await sleep(100);
    line = capLines(w).pop();
    assert.match(line ?? '', cap, JSON.stringify(env));
  }
});

// BUG-D-032: a limit is set, resume_run names no max_usd and the run was saved with no cap (maxUsd null): the audit fix's comment says it gets the default like a new run, min(limit, 7) = 7 here, not the limit itself (20).
// No MAX_USD_PER_RUN is in the child's environment and world({ paused: true }) writes no .env, so the 7 is the built-in default.
test('(3) a limit of 20, resume_run of a run saved with no cap and no max_usd: the run goes on under the default $7, not under the limit', async () => {
  const w = world({ paused: true });
  const before = capLines(w).length;
  await mcp(w.work, [{ name: 'resume_run', arguments: { run: w.id } }], { COUNCIL_MAX_USD_LIMIT: '20' });
  for (let i = 0; i < 200 && capLines(w).length <= before; i++) await sleep(100);
  assert.match(capLines(w).pop() ?? '', /^\$7\.00 per run/, 'min(20, 7); the old server passed the limit, $20');
});

// THE DIRECT ENTRY and the per-run default (found by the advisor at the 7th commit): `node src/mcp/server.js` applies no .env, so once a .env LIMIT is read there, the per-run default must come from the same file or the server passes
// an explicit `--max-usd min(limit, 7)` and the child's own .env value (2) is ignored: a run the person capped at $2 went on at $7. Parity: the same .env gives the same cap through `council --mcp`.
test('DIRECT ENTRY: a MAX_USD_PER_RUN written in the work folder\'s .env is the default under a limit (2), as through `council --mcp`; the real environment still wins', async () => {
  const dotenv = 'COUNCIL_MAX_USD_LIMIT=20\nMAX_USD_PER_RUN=2\n';
  const caps = {};
  for (const [name, entry, env, text] of [['direct', 'direct', {}, dotenv], ['cli', 'cli', {}, dotenv], ['direct, limit in the real environment', 'direct', { COUNCIL_MAX_USD_LIMIT: '20' }, 'MAX_USD_PER_RUN=2\n'], ['direct, real default wins', 'direct', { MAX_USD_PER_RUN: '3' }, dotenv]]) {
    const w = world({ dotenv: text });
    const [r] = await mcp(w.work, [START], env, entry);
    assert.equal(payload(r).started, true, `${name}: ${JSON.stringify(payload(r)).slice(0, 200)}`);
    caps[name] = await savedCap(w.work, payload(r).run);
  }
  assert.deepEqual(caps, { direct: 2, cli: 2, 'direct, limit in the real environment': 2, 'direct, real default wins': 3 });
});

test('DIRECT ENTRY: a malformed MAX_USD_PER_RUN in the .env under a limit is refused with the CLI sentence (through `council --mcp` the CLI refuses it at start)', async () => {
  const w = world({ dotenv: 'COUNCIL_MAX_USD_LIMIT=20\nMAX_USD_PER_RUN=2  # cheap\n' });
  const [r] = await mcp(w.work, [START], {}, 'direct');
  assert.ok(errorOf(payload(r)).includes(EXPECTED('2  # cheap')), JSON.stringify(payload(r)).slice(0, 300));
  assert.equal(existsSync(join(w.work, 'runs')), false);
});
