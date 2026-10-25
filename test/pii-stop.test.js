// The personal-data STOP (0.8.3, owner 18 Okt 2026 16:45: "The warning has to stop the plan from running, unless the user explicitly chooses to continue"; 19 Okt: a standing warn only from the user). Rows: the way-on line has one builder and one
// parser with four fixed words; over MCP the agent has no argument that continues, only a dialog the person answers (accept respawns the SAME arguments with --allow-pii <types found> added by the SERVER; decline, "no", cancel and a dialog nobody
// answers start nothing); a key-shaped stop never reaches the dialog. The MCP server is a real stdio child; the client declares the elicitation capability and answers from the test. Mock chain only: nothing paid, nothing real is reachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { piiAllowLines, parsePiiAllowLine, PII_ALLOW_PREFIX } from '../src/run-preflight.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const EMAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');
const WAIT_MS = 60000;

test('PS-1 the way-on line: one builder, one parser, four fixed words in a fixed order; a word outside the four, a missing line and a different prefix parse to null', () => {
  assert.deepEqual(piiAllowLines(['iban', 'email']), [`${PII_ALLOW_PREFIX}email,iban`, 'That allows every email / iban-shaped string in these files, also when this run is resumed.']);
  for (const t of [['email'], ['email', 'iban'], ['card', 'secret', 'email', 'iban']]) assert.deepEqual(parsePiiAllowLine(`noise\n${piiAllowLines(t)[0]}\n${piiAllowLines(t)[1]}`), ['email', 'iban', 'card', 'secret'].filter(x => t.includes(x)), JSON.stringify(t));
  assert.equal(parsePiiAllowLine(`${PII_ALLOW_PREFIX}email,rm -rf`), null);
  assert.equal(parsePiiAllowLine(`${PII_ALLOW_PREFIX}`), null);
  assert.equal(parsePiiAllowLine('PII-GATE: stopped.'), null);
  assert.equal(parsePiiAllowLine(undefined), null);
});

function workspace(task) {
  const work = mkdtempSync(join(tmpdir(), 'thc-pii-stop-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), task);
  return { work, env: { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys() } };
}
function session(f, { elicitation = true, answer = null } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: f.work, env: f.env });
  const waiting = new Map(); const asked = []; let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) { asked.push(m); Promise.resolve(answer ? answer(m, asked.length) : { action: 'cancel' }).then(result => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n`)); }
      else if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms from the MCP child pid ${child.pid}`)); }, WAIT_MS); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'pii-stop-test', version: '1' } }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    asked,
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}
const runsOf = f => (existsSync(join(f.work, 'runs')) ? readdirSync(join(f.work, 'runs')) : []);
const START = { chain: 'mock', task: 'tasks/x.md' };

test('PS-2 MCP, the person says yes: the dialog shows the stop screen (no value) and a REQUIRED yes/no with no default; accept respawns the same arguments with --allow-pii email added by the server; run.json records the allowance; the answer says which types the person allowed', async () => {
  const f = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  const s = session(f, { answer: () => ({ action: 'accept', content: { send_anyway: true } }) });
  try {
    const a = await s.call('start_run', START);
    assert.equal(a.started, true, JSON.stringify(a)); assert.deepEqual(a.pii_allowed, ['email']);
    assert.equal(s.asked.length, 1, 'one dialog');
    const ask = s.asked[0];
    assert.match(ask.params.message, /PII-GATE: stopped/); assert.match(ask.params.message, /Send it anyway\?/);
    for (const part of ['jane', 'mail-corp']) assert.equal(ask.params.message.includes(part), false, `the dialog carries no part of the address (${part})`);
    assert.deepEqual(ask.params.requestedSchema.required, ['send_anyway']); assert.equal(ask.params.requestedSchema.properties.send_anyway.default, undefined, 'no default');
    const runDir = join(f.work, 'runs', runsOf(f)[0]);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).piiGate, { mode: 'hard-stop', allow: ['email'] });
  } finally { await s.close(); }
});

test('PS-3 MCP, anything but a yes starts nothing: decline, cancel, "no" and an accept without the field each give started:false, exit 11, no run folder, and the terminal command for the person', async () => {
  for (const answer of [{ action: 'decline' }, { action: 'cancel' }, { action: 'accept', content: { send_anyway: false } }, { action: 'accept', content: {} }]) {
    const f = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
    const s = session(f, { answer: () => answer });
    try {
      const a = await s.call('start_run', START);
      assert.equal(a.started, false, JSON.stringify(a)); assert.equal(a.exitCode, 11); assert.equal(a.paid_started, false); assert.match(a.next, /--allow-pii email/);
      assert.equal(runsOf(f).length, 0, `no run folder (${JSON.stringify(answer)})`);
    } finally { await s.close(); }
  }
});

test('PS-4 MCP backstop: a dialog nobody answers does not hold the call past its time budget: started:false, exit 11, nothing started', async () => {
  const f = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  const s = session(f, { answer: () => new Promise(() => {}) });
  const from = Date.now();
  try {
    const a = await s.call('start_run', START);
    assert.equal(a.started, false, JSON.stringify(a)); assert.equal(a.exitCode, 11); assert.equal(runsOf(f).length, 0);
    assert.ok(Date.now() - from < 40000, `answered inside the dialog budget (${Date.now() - from} ms)`);
  } finally { await s.close(); }
});

test('PS-5 MCP, a key-shaped string never reaches the dialog: the key scan\'s own refusal comes back (started:false, exit 11), no dialog is asked, no run folder', async () => {
  const SECRET = `sk_${'live_'}${'abcd'.repeat(6)}`;
  const f = workspace(`Plan a tiny change.\nThe key is ${SECRET}\n`);
  const s = session(f, { answer: () => ({ action: 'accept', content: { send_anyway: true } }) });
  try {
    const a = await s.call('start_run', START);
    assert.equal(a.started, false, JSON.stringify(a)); assert.equal(a.exitCode, 11); assert.equal(s.asked.length, 0, 'no dialog');
    assert.match(a.logTail, /OUTBOUND KEY SCAN/); assert.equal(runsOf(f).length, 0);
    assert.equal(JSON.stringify(a).includes('abcd'), false, 'no part of the value');
  } finally { await s.close(); }
});

test('PS-6 MCP, a finding in a CONTEXT file: the dialog lists EVERY finding (eight, not the first few) and the command for the person carries the same --context (and limit) as the stopped run, minus the server\'s folder name', async () => {
  const f = workspace('Plan a small app.\n');
  mkdirSync(join(f.work, 'context'));
  writeFileSync(join(f.work, 'context', 'c.md'), Array.from({ length: 8 }, (_, i) => `Contact ${i}: person${i}.x@mail-corp.de`).join('\n') + '\n');
  const plain = session(f, { elicitation: false });
  try {
    const a = await plain.call('start_run', { ...START, context: 'context/c.md', max_usd: 3 });
    assert.equal(a.started, false, JSON.stringify(a)); assert.equal(a.exitCode, 11); assert.deepEqual(a.types_found, ['email']);
    assert.match(a.next, new RegExp(`--context ${join(f.work, 'context', 'c.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)); assert.match(a.next, /--max-usd 3/); assert.doesNotMatch(a.next, /--run-id/); assert.match(a.next, /--allow-pii email$/);
  } finally { await plain.close(); }
  const s = session(f, { answer: () => ({ action: 'decline' }) });
  try {
    await s.call('start_run', { ...START, context: 'context/c.md', max_usd: 3 });
    const msg = s.asked[0].params.message;
    assert.equal((msg.match(/email \(value not shown\)/g) ?? []).length, 8, 'every finding is in the dialog');
    assert.equal(msg.includes('person0'), false, 'no value');
  } finally { await s.close(); }
});

test('PS-7 MCP, a PAID chain: the person says yes to the personal-data stop and the SAME call then asks the spending limit (two dialogs, started:true); nothing reaches the paid stub before the limit', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();
  const f = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(f.work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
  f.env = { ...f.env, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  let seen = 0;
  const s = session(f, { answer: m => { seen += 1; const atAsk = requests; s.atAsk.push(atAsk); return /Send it anyway/.test(m.params.message) ? { action: 'accept', content: { send_anyway: true } } : { action: 'accept', content: { limit_usd: 4 } }; } });
  s.atAsk = [];
  try {
    const r = await s.call('start_run', { chain: 'c', task: 'tasks/x.md' });
    assert.equal(r.started, true, JSON.stringify(r)); assert.equal(seen, 2, 'two dialogs: the personal-data stop, then the limit');
    assert.match(s.asked[0].params.message, /PII-GATE: stopped/); assert.match(s.asked[1].params.requestedSchema.required.join(), /limit_usd/);
    assert.deepEqual(s.atAsk, [0, 0], 'no request reached the paid stub before the limit');
  } finally { await s.close(); srv.close(); }
});

test('PS-8 a scan-only secret shape (a 32-character token next to the word mistral) is NOT covered by --allow-secret-shaped: the PII gate still stops on it (exit 11) and names `--allow-pii secret`; --allow-pii secret goes on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pii-scanonly-')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), `Plan a tiny change.\nThe mistral token is ${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hL'}\n`);
  const run = extra => spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/x.md', ...extra], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const a = run(['--allow-secret-shaped']);
  assert.equal(a.status, 11, a.stdout + a.stderr); assert.match(a.stderr, /--allow-pii secret/); assert.equal(a.stderr.includes('aB3dE6'), false);
  const b = run(['--allow-secret-shaped', '--allow-pii', 'secret']);
  assert.equal(b.status, 0, b.stdout + b.stderr);
});
