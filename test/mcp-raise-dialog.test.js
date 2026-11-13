// #19 (0.8.4; his words of 3 Nov 2026: the typed limit can be raised at any resume, best in the window that opens inside Claude Code): resume_run with `raise_limit: true` asks the PERSON for a new total in the client's dialog at a resume
// that is not a stop. The CLI is spawned with `--raise-cap` (no --relayed) and exits 21; the existing dialog (T6a) asks the gate, and the answer is recorded through the one interface (src/run-controls.js, channel elicitation) with the
// client's name. Offline, $0: the one paid seat points at a local stub that COUNTS requests; the MCP server is a real stdio child; the run is set up with the real CLI (the fixture of test/mcp-resume-relay.test.js).
// Rows: accept 8 on a run under 5 (RAISE-1: the dialog's message IS the raise screen, the field is a required number with NO default, recorded on the elicitation channel, used in the same call, the result says so); decline records nothing
// that grants consent (RAISE-2); a number not above the limit is recorded and then CLOSED by THC, and the result says so, never a bare resumed:true (RAISE-3); a client without the dialog gets the awaiting result and the gate stays pending
// (RAISE-4); arguments that cannot be this route are refused before any spawn (RAISE-5); an answer nobody used is not stacked on (RAISE-6); a chain with no paid seat gets the CLI's own refusal and raised:false (RAISE-7); the tool's
// arguments (RAISE-8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { readGateAnswer } from '../src/gate.js';
import { typeCap } from './helpers/typed-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const WAIT_MS = 40000;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-11-04T13-00-00-000Z';
const PAID = port => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` });

async function fixture({ extraEnv = {} } = {}) {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-raise-dialog-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: PAID(srv.address().port) } }));
  const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1', ...extraEnv };
  const run = (args, until = null) => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const poll = until ? setInterval(() => { if (requests >= until) child.kill('SIGKILL'); }, 50) : null;
    child.on('exit', status => { clearTimeout(timer); if (poll) clearInterval(poll); resolve({ status, stdout, stderr }); });
  });
  return { srv, work, env, run, count: () => requests, runDir: join(work, 'runs', ID) };
}

// One stdio MCP session; `answer(request, k)` answers each server-to-client elicitation request (no `answer`: cancel); `elicitation: false` declares no dialog.
function session(f, { elicitation = true, answer = null } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: f.work, env: f.env });
  const waiting = new Map(); const asked = []; let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) {
        asked.push(m);
        Promise.resolve(answer ? answer(m, asked.length) : { action: 'cancel' }).then(result => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n`));
      } else if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise((ok, no) => {
    const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms from the MCP child pid ${child.pid}`)); }, WAIT_MS);
    waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'raise-dialog-test', version: '9.9' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    asked,
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    async tools() { await ready; return (await rpc('tools/list', {})).result.tools; },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const events = d => ledger(d).map(l => `${l.event}:${l.gate ?? ''}`);
const logsIn = f => readdirSync(f.work).filter(n => /^council-\d+\.log$/.test(n));

// a paid run under a typed limit of $5 that has NOT stopped: its first resume reached the provider once and was killed (a resume that is not a stop, with something to raise)
async function runningRun(f) {
  assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
  assert.equal(typeCap(f.runDir, '5'), 'g1');
  await f.run(['--resume', f.runDir], 1);
  assert.ok(f.count() >= 1);
  assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 1);
}

test('RAISE-1 accept 8 at a resume that is not a stop: the dialog\'s message IS the raise screen, its field is a required number with NO default, the answer is recorded on the elicitation channel with the client\'s name, used in the same call, and the result says so', async () => {
  const f = await fixture(); const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 8 } }) });
  try {
    await runningRun(f);
    const r = await s.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(r.resumed, true, JSON.stringify(r));
    assert.equal(s.asked.length, 1);
    const screen = readFileSync(join(f.runDir, 'cap-screen-2.md'), 'utf8');
    assert.equal(s.asked[0].params.message, screen, 'exactly the pending screen whose hash the gate covers');
    assert.match(screen, /This run is under a limit of \$5\.00/, 'it is the early-raise screen, not a stop screen');
    assert.deepEqual(s.asked[0].params.requestedSchema.required, ['limit_usd']);
    assert.equal(JSON.stringify(s.asked[0].params.requestedSchema).includes('"default"'), false, 'nothing is pre-filled');
    const req = ledger(f.runDir).find(l => l.event === 'gate_requested' && l.gate === 'g2');
    assert.notEqual(req.requested_by, 'session', 'a gate the PERSON answers');
    const ans = ledger(f.runDir).find(l => l.event === 'gate_answered' && l.gate === 'g2');
    assert.deepEqual([ans.channel, ans.cap_usd, ans.client_name, ans.client_version], ['elicitation', '8', 'raise-dialog-test', '9.9']);
    assert.deepEqual(events(f.runDir).slice(-3), ['gate_requested:g2', 'gate_answered:g2', 'cap_consumed:g2']);
    assert.deepEqual([r.raised.gate, r.raised.state, r.raised.old_usd, r.raised.new_usd], ['g2', 'consumed', 5, 8], JSON.stringify(r.raised));
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 8);
  } finally { await s.close(); f.srv.close(); }
});

test('RAISE-2 decline: nothing is recorded that grants consent, nothing is used, the run is not resumed and the result says declined', async () => {
  const f = await fixture(); const s = session(f, { answer: () => ({ action: 'decline' }) });
  try {
    await runningRun(f);
    const before = f.count();
    const r = await s.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(r.resumed, false, JSON.stringify(r)); assert.equal(r.declined, true);
    assert.deepEqual([r.raised.gate, r.raised.state], ['g2', 'declined'], JSON.stringify(r.raised));
    assert.equal(readGateAnswer(f.runDir, 'g2').status, 'declined');
    assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 1, 'no second limit');
    assert.equal(f.count(), before, 'nothing was sent');
  } finally { await s.close(); f.srv.close(); }
});

test('RAISE-3 a number not above the limit the run has is recorded, then CLOSED by THC (not_above_current): the result says closed with the code, never a bare resumed:true, and the limit stays 5', async () => {
  const f = await fixture(); const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 3 } }) });
  try {
    await runningRun(f);
    const r = await s.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(r.raised.state, 'closed', JSON.stringify(r)); assert.equal(r.raised.code, 'not_above_current');
    assert.equal(typeof r.raised.reason, 'string');
    assert.equal(ledger(f.runDir).some(l => l.event === 'cap_raise_closed' && l.gate === 'g2'), true, 'the closing is in the record');
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 5);
  } finally { await s.close(); f.srv.close(); }
});

test('RAISE-4 a client without the dialog gets the awaiting result naming the terminal command; the gate stays pending and the terminal can still answer it, then a plain resume_run uses the answer', async () => {
  const f = await fixture(); const s = session(f, { elicitation: false });
  try {
    await runningRun(f);
    const r = await s.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(r.resumed, false); assert.equal(r.state, 'awaiting_user_cap'); assert.equal(r.requires_user, true); assert.equal(r.paid_started, false);
    assert.equal(r.decision, 'g2'); assert.match(r.next, /council gate answer/);
    assert.deepEqual([r.raised.gate, r.raised.state], ['g2', 'pending']);
    assert.equal(readGateAnswer(f.runDir, 'g2').status, 'pending');
    assert.equal(typeCap(f.runDir, '8'), 'g2', 'the terminal path still works');
    const used = await s.call('resume_run', { run: ID });
    assert.equal(used.resumed, true, JSON.stringify(used));
    assert.deepEqual(events(f.runDir).slice(-2), ['gate_answered:g2', 'cap_consumed:g2']);
  } finally { await s.close(); f.srv.close(); }
});

test('RAISE-5 arguments that cannot be this route are refused before any spawn and record nothing: with max_usd, with person_words', async () => {
  const f = await fixture(); const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 8 } }) });
  try {
    await runningRun(f);
    const logs = logsIn(f).length; const n = ledger(f.runDir).length;
    for (const [args, re] of [[{ raise_limit: true, max_usd: 8 }, /takes no figure and no words/], [{ raise_limit: true, person_words: 'raise it to $8' }, /takes no figure and no words/]]) {
      const r = await s.call('resume_run', { run: ID, ...args });
      assert.equal(r.resumed, false); assert.equal(r.raised, false); assert.equal(r.paid_started, false); assert.match(r.error, re, JSON.stringify(r));
    }
    assert.equal(s.asked.length, 0, 'nobody was asked');
    assert.equal(logsIn(f).length, logs, 'nothing was spawned'); assert.equal(ledger(f.runDir).length, n, 'nothing was recorded');
  } finally { await s.close(); f.srv.close(); }
});

test('RAISE-6 an answer the person already gave to a raise and nobody used is not stacked on: raise_limit is refused before any spawn, and a plain resume_run uses the answer', async () => {
  const f = await fixture(); const s = session(f, { elicitation: false });
  try {
    await runningRun(f);
    await s.call('resume_run', { run: ID, raise_limit: true });          // opens g2 (pending)
    assert.equal(typeCap(f.runDir, '8'), 'g2');                           // answered at the terminal, not used yet
    const logs = logsIn(f).length;
    const r = await s.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(r.resumed, false); assert.equal(r.raised, false); assert.match(r.error, /already answered a raise of this run's limit and it has not been used yet/);
    assert.equal(logsIn(f).length, logs, 'nothing was spawned');
    const used = await s.call('resume_run', { run: ID });
    assert.equal(used.resumed, true, JSON.stringify(used));
    assert.equal(events(f.runDir).at(-1), 'cap_consumed:g2');
  } finally { await s.close(); f.srv.close(); }
});

test('RAISE-7 a chain with no paid seat has no limit to raise: the CLI\'s own refusal comes back, raised is false, nobody was asked and nothing is recorded', async () => {
  const f = await fixture(); const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 8 } }) });
  try {
    const first = await f.run(['--chain', 'mock-external', '--task', 'tasks/x.md', '--run-id', ID]);
    assert.equal(first.status, 3, first.stdout + first.stderr);
    const r = await s.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(r.raised, false, JSON.stringify(r)); assert.equal(r.resumed, false); assert.equal(s.asked.length, 0, 'nobody was asked');
    assert.match(String(r.logTail ?? ''), /this run has no spending limit to raise/);
    assert.equal(existsSync(join(f.runDir, 'gate-ledger.jsonl')), false, 'no gate was opened or answered');
  } finally { await s.close(); f.srv.close(); }
});

test('RAISE-8 the tool takes raise_limit (boolean), and its description says what raise_limit does and that nothing is pre-filled', async () => {
  const f = await fixture(); const s = session(f);
  try {
    const t = (await s.tools()).find(x => x.name === 'resume_run');
    assert.equal(t.inputSchema.properties.raise_limit.type, 'boolean');
    assert.equal('raise_cap' in t.inputSchema.properties, false, 'there is no per-cap raise: a run under per-provider caps is refused');
    assert.match(t.description, /raise_limit: true: the dialog asks them for the new total and nothing is pre-filled/);
    assert.equal(t.inputSchema.required.includes('raise_limit'), false);
  } finally { await s.close(); f.srv.close(); }
});

// Mini-C&C R240, Q2: no per-cap raise dialog. A run held to per-provider caps (COUNCIL_SPEND_CAPS, read from the SERVER's environment as the max_usd refusal reads it) is refused before anything is spawned: nobody is asked, nothing is recorded.
test('RAISE-9 a run held to per-provider caps is refused at raise_limit before any spawn: nobody is asked and nothing is recorded; the same run without the switch is asked', async () => {
  const f = await fixture();
  await runningRun(f);
  const capped = session({ ...f, env: { ...f.env, COUNCIL_SPEND_CAPS: 'openrouter' } }, { answer: () => ({ action: 'accept', content: { limit_usd: 8 } }) });
  try {
    const logs = logsIn(f).length; const n = ledger(f.runDir).length;
    const r = await capped.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(r.resumed, false); assert.equal(r.raised, false); assert.equal(r.paid_started, false); assert.match(r.error, /holds a run of this chain to a limit for each provider\. Nothing was started or spent\./, JSON.stringify(r));
    assert.equal(capped.asked.length, 0, 'nobody was asked'); assert.equal(logsIn(f).length, logs, 'nothing was spawned'); assert.equal(ledger(f.runDir).length, n, 'nothing was recorded');
  } finally { await capped.close(); }
  const plain = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 8 } }) });
  try {
    const r = await plain.call('resume_run', { run: ID, raise_limit: true });
    assert.equal(plain.asked.length, 1, 'control: without the switch the same call asks the person'); assert.equal(r.resumed, true, JSON.stringify(r));
  } finally { await plain.close(); f.srv.close(); }
});
