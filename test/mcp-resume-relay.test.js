// 0.8.4 H10 (S20): resume_run relays a raise the PERSON said: `max_usd` with `person_words` (their own words, with the number in them). Offline, $0: the one paid seat points at a local stub that COUNTS requests; the MCP server is a real
// stdio child; the run is set up with the real CLI (the fixture of test/start-path-typed-cap.test.js and test/mcp-start-cap-dialog.test.js).
// Rows: a relay at a budget stop is recorded on the session channel with the words and used (RELAY-1); an early relay at a later resume (RELAY-2); words that lack the figure are refused and record nothing (RELAY-3);
// a gate the PERSON asked for is never taken over (RELAY-4); a relayed figure the CLI then closes is reported as closed, with its code and reason, never as a bare resumed:true (RELAY-5);
// a bare max_usd on a run with a paid seat is refused and starts nothing (RELAY-6), but is unchanged on a chain with no paid seat (RELAY-7); arguments that cannot be a relay are refused before any spawn (RELAY-8);
// a figure above COUNCIL_MAX_USD_LIMIT is refused (RELAY-9); an answer the person already gave and nobody used is not stacked on (RELAY-10); both relay paths take the same reason from one constant (RELAY-11);
// a relay on a chain with no paid seat gets the CLI's own refusal and relayed:false (RELAY-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { typeCap } from './helpers/typed-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const WAIT_MS = 40000;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-11-04T12-00-00-000Z';
const PAID = port => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` });

async function fixture(extraEnv = {}) {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-relay-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: PAID(srv.address().port) } }));
  const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1', ...extraEnv };
  // the CLI, async on purpose (the stub lives in THIS process); `until`: kill the child once the stub has been hit that many times in total
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

// One stdio MCP session. No elicitation capability: the relay needs no dialog, and a plain resume_run then returns the awaiting result.
function session(f) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: f.work, env: f.env });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise((ok, no) => {
    const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms from the MCP child pid ${child.pid}`)); }, WAIT_MS);
    waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'relay-test', version: '9.9' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    async tools() { await ready; return (await rpc('tools/list', {})).result.tools; },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const events = d => ledger(d).map(l => `${l.event}:${l.gate ?? ''}`);
const until = async (cond, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (cond()) return true; await new Promise(r => setTimeout(r, 100)); } return cond(); };
// loaded inside the rows that need it, so a tree without the export fails those rows one by one instead of failing the whole file at link time
const reasonOfRelay = async () => (await import('../src/run-controls.js')).RELAY_REASON;
const logsIn = f => readdirSync(f.work).filter(n => /^council-\d+\.log$/.test(n));

// a paid run that STOPPED at its typed limit of $0.001 (exit 4, before any request)
async function stoppedRun(f) {
  assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
  assert.equal(typeCap(f.runDir, '0.001'), 'g1');
  const stopped = await f.run(['--resume', f.runDir]);
  assert.equal(stopped.status, 4, stopped.stdout + stopped.stderr); assert.equal(f.count(), 0);
  assert.ok(existsSync(join(f.runDir, 'STOPPED-budget.json')));
}
// a paid run under a typed limit of $5 that is NOT stopped: its first resume reached the provider once and was killed (an early raise has something to raise)
async function runningRun(f) {
  assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
  assert.equal(typeCap(f.runDir, '5'), 'g1');
  await f.run(['--resume', f.runDir], 1);
  assert.ok(f.count() >= 1);
  assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 1);
}

test('RELAY-1 a raise at a budget stop: max_usd with the person\'s words is recorded on the session channel with the words, the reason, and used in the same call', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await stoppedRun(f);
    const r = await s.call('resume_run', { run: ID, max_usd: 5, person_words: 'Yes, raise it to $5 please' });
    assert.equal(typeof r.relayed, 'object', `the result carries the relay's outcome: ${JSON.stringify(r)}`);
    assert.equal(r.resumed, true, JSON.stringify(r));
    assert.deepEqual([r.relayed.gate, r.relayed.state, r.relayed.new_usd, r.relayed.old_usd], ['g2', 'consumed', 5, 0.001], JSON.stringify(r.relayed));
    const req = ledger(f.runDir).find(l => l.event === 'gate_requested' && l.gate === 'g2');
    assert.equal(req.requested_by, 'session');
    const ans = ledger(f.runDir).find(l => l.event === 'gate_answered' && l.gate === 'g2');
    assert.deepEqual([ans.channel, ans.actor, ans.person_words, ans.cap_usd, ans.reason], ['session', 'main-session', 'Yes, raise it to $5 please', '5', await reasonOfRelay()]);
    assert.deepEqual(events(f.runDir).slice(-3), ['gate_requested:g2', 'gate_answered:g2', 'cap_consumed:g2']);
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 5);
    assert.equal(await until(() => f.count() >= 1), true, 'the run went on and reached the provider');
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-2 an early raise at a later resume (the run has not stopped): the relay is recorded and used, the limit moves from 5 to 8', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await runningRun(f);
    const r = await s.call('resume_run', { run: ID, max_usd: 8, person_words: 'make the limit $8' });
    assert.equal(typeof r.relayed, 'object', `the result carries the relay's outcome: ${JSON.stringify(r)}`);
    assert.equal(r.resumed, true, JSON.stringify(r));
    assert.deepEqual([r.relayed.gate, r.relayed.state, r.relayed.old_usd, r.relayed.new_usd], ['g2', 'consumed', 5, 8], JSON.stringify(r.relayed));
    assert.deepEqual(events(f.runDir).slice(-3), ['gate_requested:g2', 'gate_answered:g2', 'cap_consumed:g2']);
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-3 words that do not contain the figure are refused: nothing is recorded, nothing is sent, the stop stays', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await stoppedRun(f);
    const stopFile = readFileSync(join(f.runDir, 'STOPPED-budget.json'), 'utf8');
    const r = await s.call('resume_run', { run: ID, max_usd: 5, person_words: 'yes, raise it' });
    assert.equal(r.resumed, false); assert.equal(r.relayed, false); assert.equal(r.code, 'person_words_total', JSON.stringify(r));
    assert.match(r.error, /does not appear in the person's words|Nothing was recorded/);
    assert.equal(ledger(f.runDir).some(l => l.event === 'gate_answered' && l.gate === 'g2'), false, 'no answer on record');
    assert.equal(ledger(f.runDir).filter(l => l.event === 'cap_consumed').length, 1, 'no second limit');
    assert.equal(f.count(), 0, 'no request reached the provider');
    assert.equal(readFileSync(join(f.runDir, 'STOPPED-budget.json'), 'utf8'), stopFile, 'the stop stays');
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-4 a limit screen the PERSON asked for is never taken over: the relay is refused with the person\'s route, nothing is recorded, and the person can still answer it', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await stoppedRun(f);
    assert.equal((await f.run(['--resume', f.runDir])).status, 21, 'a plain resume opens the raise screen for the person');
    const r = await s.call('resume_run', { run: ID, max_usd: 5, person_words: 'raise it to $5' });
    assert.equal(r.resumed, false); assert.equal(r.relayed, false); assert.equal(r.code, 'gate_not_session_requested', JSON.stringify(r));
    assert.match(r.error, /asked for by a person, so only the person answers it/);
    assert.match(r.error, /council gate answer /);
    assert.equal(ledger(f.runDir).some(l => l.event === 'gate_answered' && l.gate === 'g2'), false);
    assert.equal(typeCap(f.runDir, '5'), 'g2', 'the person can still answer the same screen');
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-5 a relayed figure the CLI then closes (not above the limit) is reported as closed with its code and reason, never as a bare resumed:true; a new screen waits and the limit is unchanged', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await runningRun(f);
    const r = await s.call('resume_run', { run: ID, max_usd: 3, person_words: 'cut it to $3' });
    assert.equal(typeof r.relayed, 'object', `the result carries the relay's outcome: ${JSON.stringify(r)}`);
    assert.equal(r.resumed, false, JSON.stringify(r));
    assert.deepEqual([r.relayed.state, r.relayed.code], ['closed', 'not_above_current'], JSON.stringify(r.relayed));
    assert.match(r.relayed.reason, /\$3\.00\) is not above the limit it has now \(\$5\.00\)/);
    assert.equal(r.requires_user, true); assert.equal(r.state, 'awaiting_user_cap');
    assert.deepEqual(events(f.runDir).slice(-3), ['gate_answered:g2', 'cap_raise_closed:g2', 'gate_requested:g3']);
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).maxUsd, 5, 'the limit is unchanged');
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-6 a bare max_usd on a run with a paid seat is refused and starts nothing (a session never suggests a figure); the sentence names the two ways on', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await stoppedRun(f);
    const linesBefore = ledger(f.runDir).length; const logsBefore = logsIn(f).length;
    const r = await s.call('resume_run', { run: ID, max_usd: 5 });
    assert.equal(r.resumed, false); assert.equal(r.relayed, false); assert.equal(r.paid_started, false);
    assert.match(r.error, /is the new total THE PERSON said, and it is accepted only with their own words in person_words/);
    assert.match(r.error, /leave max_usd out and the person types the new total in the dialog/);
    assert.equal(ledger(f.runDir).length, linesBefore, 'the ledger is untouched');
    assert.equal(logsIn(f).length, logsBefore, 'no CLI was spawned');
    assert.equal(f.count(), 0);
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-7 (control) a bare max_usd on a chain with no paid seat is unchanged: it is not refused, the CLI is spawned with it', async () => {
  const f = await fixture(); const s = session(f);
  try {
    const first = await f.run(['--chain', 'mock-external', '--task', 'tasks/x.md', '--run-id', ID]);
    assert.equal(first.status, 3, first.stdout + first.stderr);
    const r = await s.call('resume_run', { run: ID, max_usd: 5 });
    assert.doesNotMatch(String(r.error ?? ''), /person_words|PERSON said/, JSON.stringify(r));
    assert.equal(r.relayed, undefined);
    assert.equal(logsIn(f).length, 1, 'the CLI was spawned');
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-8 arguments that cannot be a relay are refused before anything is spawned: words without a figure, "none" with words, empty words', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await stoppedRun(f);
    const linesBefore = ledger(f.runDir).length;
    const a = await s.call('resume_run', { run: ID, person_words: 'raise it to $5' });
    assert.match(a.error, /person_words goes with max_usd/); assert.equal(a.resumed, false);
    const b = await s.call('resume_run', { run: ID, max_usd: 'none', person_words: 'no limit at all' });
    assert.match(b.error, /max_usd "none" cannot be the new total of a spending limit/);
    const c = await s.call('resume_run', { run: ID, max_usd: 5, person_words: '   ' });
    assert.match(c.error, /person_words is empty/);
    assert.equal(ledger(f.runDir).length, linesBefore); assert.equal(logsIn(f).length, 0, 'no CLI was spawned'); assert.equal(f.count(), 0);
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-9 a figure above the user\'s COUNCIL_MAX_USD_LIMIT is refused before any spawn, with the words', async () => {
  const f = await fixture({ COUNCIL_MAX_USD_LIMIT: '3' }); const s = session(f);
  try {
    await stoppedRun(f);
    const r = await s.call('resume_run', { run: ID, max_usd: 5, person_words: 'raise it to $5' });
    assert.equal(r.resumed, false);
    assert.match(r.error, /max_usd 5 is above the user's COUNCIL_MAX_USD_LIMIT of \$3/);
    assert.equal(logsIn(f).length, 0, 'no CLI was spawned'); assert.equal(ledger(f.runDir).some(l => l.gate === 'g2'), false);
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-10 an answer the person already gave to a raise and that nobody used is not stacked on: the relay is refused and says how to use it', async () => {
  const f = await fixture(); const s = session(f);
  try {
    await stoppedRun(f);
    assert.equal((await f.run(['--resume', f.runDir, '--raise-cap'])).status, 21);
    assert.equal(typeCap(f.runDir, '5'), 'g2');
    const before = ledger(f.runDir).length;
    const r = await s.call('resume_run', { run: ID, max_usd: 9, person_words: 'make it $9' });
    assert.equal(r.resumed, false); assert.equal(r.relayed, false);
    assert.match(r.error, /already answered a raise of this run's limit and it has not been used yet/);
    assert.equal(ledger(f.runDir).length, before, 'nothing recorded'); assert.equal(logsIn(f).length, 0, 'no CLI was spawned');
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-12 a relay on a chain with no paid seat has no limit to raise: the CLI\'s own refusal comes back, relayed is false, nothing is recorded', async () => {
  const f = await fixture(); const s = session(f);
  try {
    const first = await f.run(['--chain', 'mock-external', '--task', 'tasks/x.md', '--run-id', ID]);
    assert.equal(first.status, 3, first.stdout + first.stderr);
    const r = await s.call('resume_run', { run: ID, max_usd: 5, person_words: 'raise it to $5' });
    assert.equal(r.relayed, false, JSON.stringify(r));
    assert.equal(r.resumed, false);
    assert.match(String(r.logTail ?? ''), /this run has no spending limit to raise/);
    assert.equal(existsSync(join(f.runDir, 'gate-ledger.jsonl')), false, 'no gate was opened or answered');
  } finally { await s.close(); f.srv.close(); }
});

test('RELAY-11 the terminal relay and the MCP relay record the same reason because both import it: src/gate-relay-cli.js takes RELAY_REASON from src/run-controls.js and carries no copy of the sentence', () => {
  // CHANGED ACCEPTED ROW (H10 fix-up, slot H20). OLD: the row compared the sentence in gate-relay-cli.js with RELAY_REASON (two copies kept equal). NEW: the terminal relay imports the constant, so there is one sentence.
  const src = readFileSync(join(root, 'src', 'gate-relay-cli.js'), 'utf8');
  assert.match(src, /import \{[^}]*\bRELAY_REASON\b[^}]*\} from '\.\/run-controls\.js'/, 'gate-relay-cli.js imports RELAY_REASON from the interface');
  assert.equal(src.includes('as the session states it'), false, 'and no longer carries the sentence itself');
});
