// Advice money limits and one policy shape (14 Oct 2026, C&C's entries 7 + 14 and the owed `[]` row). Every row drives the REAL entry (the direct MCP server, `council --mcp`, `council doctor`) and asserts the sentence or the value. $0: no chain is started.
//   entries 7 + 14  COUNCIL_ADVISE_MAX_USD_PER_CALL / _PER_SESSION / _PER_DAY set but not a plain number was replaced by the default ($1.50 / $3 / $10): the MCP server refuses to start, and the CLI is not touched (`--advice-adopt`, which the server starts with the same environment, is not checked again: proposed in the report).
//   owed row  a policy.json whose top level is `[]` makes council_quote answer policy_unreadable (D's T1-10 sends a non-object top level to loadPolicy's error).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
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
test('entries 7 + 14: a malformed advice money limit stops the MCP server with the sentence (the value, the default it would have fallen back to); a plain number starts; the CLI is not stopped', async () => {
  const rows = [['COUNCIL_ADVISE_MAX_USD_PER_CALL', '0,50', '$1.50'], ['COUNCIL_ADVISE_MAX_USD_PER_DAY', '2,5', '$10.00'], ['COUNCIL_ADVISE_MAX_USD_PER_SESSION', '1e1', '$3.00']];
  for (const [name, bad, dflt] of rows) {
    const dir = folder();
    const r = await boot({ entry: [server], cwd: dir, env: { [name]: bad } });
    assert.equal(r.exit, 2, `${name}=${bad}: ${r.stderr}`);
    assert.ok(r.stderr.includes(`the-high-council: ${name} is "${bad}", which is not a plain number of dollars (digits with an optional dot), so nothing started. A limit it cannot read would be replaced by the default of ${dflt}, which may not be the limit you meant. Set a number such as 2.5, or remove the setting.`), r.stderr.slice(0, 400));
    assert.equal(r.started, false, `${name}: no server answered`);
    const d = doctor(dir, { [name]: bad });
    assert.equal(d.status, 0, `${name}: a CLI command is not stopped by an advice limit: ${d.stdout}${d.stderr}`.slice(0, 300));
  }
  const ok = await boot({ entry: [server], cwd: folder(), env: { COUNCIL_ADVISE_MAX_USD_PER_DAY: '2.5', COUNCIL_ADVISE_MAX_USD_PER_CALL: '' } });
  assert.equal(ok.started, true, `control (a plain number, and an empty value): ${ok.stderr}`);
  const viaCli = await boot({ entry: [cli, '--mcp'], cwd: folder(), env: { COUNCIL_ADVISE_MAX_USD_PER_DAY: '2,5' } });
  assert.equal(viaCli.exit, 2, `through council --mcp as well: ${viaCli.stderr}`);
  assert.match(viaCli.stderr, /COUNCIL_ADVISE_MAX_USD_PER_DAY is "2,5"/);
});

test('entries 7 + 14: adviceLimitRefusal reads three names, a plain decimal passes, a key-shaped value is never echoed', async () => {
  const { adviceLimitRefusal } = await import('../src/advice-guards.js'); // imported here so the other rows still run against a tree that lacks it
  assert.equal(adviceLimitRefusal({}), null);
  assert.equal(adviceLimitRefusal({ COUNCIL_ADVISE_MAX_USD_PER_CALL: ' 0.5 ', COUNCIL_ADVISE_MAX_USD_PER_SESSION: '3', COUNCIL_ADVISE_MAX_USD_PER_DAY: '0' }), null);
  assert.equal(adviceLimitRefusal({ COUNCIL_ADVISE_CALLS_PER_DAY: ' 12 ', COUNCIL_ADVISE_CALLS_PER_SESSION: '0', COUNCIL_ADVISE_COOLDOWN_MS: '0' }), null, 'plain whole numbers (zero included) pass, as before');
  assert.match(adviceLimitRefusal({ COUNCIL_ADVISE_CALLS_PER_DAY: 'abc' }) ?? '', /^COUNCIL_ADVISE_CALLS_PER_DAY is "abc", which is not a whole number of calls/, 'FLIPPED 14 Oct 2026 (this row used to assert null, "the count limits are not covered here"): a malformed count now answers the sentence');
  const r = adviceLimitRefusal({ COUNCIL_ADVISE_MAX_USD_PER_CALL: `sk-or-v1-${'a'.repeat(40)}` });
  assert.ok(r && !r.includes('sk-or-v1-aaaa') && r.includes('[redacted: possible secret]'), r);
});

test('owed row: a policy.json that is `[]` makes council_quote answer policy_unreadable (nothing is sent, no run folder); `{}` quotes', async () => {
  const brief = { schema_version: 'advice-brief/1', moment: 'before_commit', question: 'Should we drop the legacy invoices column before the release?',
    decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
    options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
    tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }], sensitivity: 'internal', not_included: ['the conversation', 'environment variables'], excerpts: [] };
  const call = { name: 'council_quote', arguments: { brief, mode: 'single' } };
  const bad = folder(undefined, '[]');
  const [r] = (await boot({ entry: [cli, '--mcp'], cwd: bad, calls: [call] })).results;
  assert.equal(r?.result?.structuredContent?.code, 'policy_unreadable', JSON.stringify(r).slice(0, 400));
  assert.equal(existsSync(join(bad, 'runs')), false);
  const [ok] = (await boot({ entry: [cli, '--mcp'], cwd: folder(undefined, '{}'), calls: [call] })).results;
  assert.equal(ok?.result?.isError, undefined, `control: ${JSON.stringify(ok).slice(0, 300)}`);
  assert.equal(ok?.result?.structuredContent?.kind, 'send_preview');
});

test('count and cooldown limits (C&C 14 Oct 2026): a malformed COUNCIL_ADVISE_CALLS_PER_SESSION / _PER_DAY / COUNCIL_ADVISE_COOLDOWN_MS stops the MCP server with the sentence (the value, the default it would have fallen back to); whole numbers start; the CLI is not stopped', async () => {
  const rows = [['COUNCIL_ADVISE_CALLS_PER_SESSION', '2.5', 'calls', '3 calls', 'a whole number such as 3'], ['COUNCIL_ADVISE_CALLS_PER_DAY', '1e3', 'calls', '8 calls', 'a whole number such as 8'], ['COUNCIL_ADVISE_COOLDOWN_MS', '0x10', 'milliseconds', '120000 milliseconds', 'a whole number such as 120000'], ['COUNCIL_ADVISE_CALLS_PER_DAY', 'five', 'calls', '8 calls', 'a whole number such as 8'], ['COUNCIL_ADVISE_CALLS_PER_SESSION', '-1', 'calls', '3 calls', 'a whole number such as 3'], ['COUNCIL_ADVISE_COOLDOWN_MS', '+5', 'milliseconds', '120000 milliseconds', 'a whole number such as 120000']];
  for (const [name, bad, unit, dflt, hint] of rows) {
    const dir = folder();
    const r = await boot({ entry: [server], cwd: dir, env: { [name]: bad } });
    assert.equal(r.exit, 2, `${name}=${bad}: ${r.stderr}`);
    assert.ok(r.stderr.includes(`the-high-council: ${name} is "${bad}", which is not a whole number of ${unit} (digits only), so nothing started. A limit it cannot read would be replaced by the default of ${dflt}, which may not be the limit you meant. Set ${hint}, or remove the setting.`), r.stderr.slice(0, 400));
    assert.equal(r.started, false, `${name}: no server answered`);
    const d = doctor(dir, { [name]: bad });
    assert.equal(d.status, 0, `${name}: a CLI command is not stopped by an advice limit: ${d.stdout}${d.stderr}`.slice(0, 300));
  }
  const ok = await boot({ entry: [server], cwd: folder(), env: { COUNCIL_ADVISE_CALLS_PER_SESSION: '0', COUNCIL_ADVISE_CALLS_PER_DAY: ' 12 ', COUNCIL_ADVISE_COOLDOWN_MS: '0' } });
  assert.equal(ok.started, true, `control (whole numbers, zero included): ${ok.stderr}`);
  const { adviceLimitRefusal, limitsFromEnv } = await import('../src/advice-guards.js');
  assert.deepEqual([limitsFromEnv({ COUNCIL_ADVISE_CALLS_PER_SESSION: '0', COUNCIL_ADVISE_CALLS_PER_DAY: ' 12 ', COUNCIL_ADVISE_COOLDOWN_MS: '0' })].map(l => [l.sessionCalls, l.dayCalls, l.cooldownMs])[0], [0, 12, 0], 'valid values are read exactly as before');
  const key = adviceLimitRefusal({ COUNCIL_ADVISE_COOLDOWN_MS: `sk-or-v1-${'a'.repeat(40)}` });
  assert.ok(key && !key.includes('sk-or-v1-aaaa') && key.includes('[redacted: possible secret]'), key);
});
