// T6a (typed cap, MCP; Review/Build_0.8.3/m6-closing/T6_Gate_Note.md): a paid start_run asks for its limit INSIDE the call through the client's dialog.
// The paid seat points at a local stub that COUNTS requests (none are sent before a limit is recorded); the MCP server is a real stdio child; the client declares (or not) the elicitation capability and answers the dialog from the test.
// Rows: accept 4 -> the run starts under 4 on the elicitation channel with the client's name and version; the dialog's message IS the cap screen and its field has no default; decline / cancel record nothing that grants consent; a number
// above the ceiling is refused with the gate's sentence and asked again; an accept with no number is asked again; a client WITHOUT the capability gets the awaiting result (a pin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGateAnswer } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { typeCap } from './helpers/typed-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

// longest honest wait: the dialog budget is 25 s (DEFAULT_HOLD_S); a reply later than this is a hang
const WAIT_MS = 40000;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const PAID = port => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` });

async function fixture(extraEnv = {}) {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();   // an open stub (a row that failed before its finally, a keep-alive socket of the detached run) must never keep this process alive: that held the CPU lock for 36 min on 15 Oct 2026
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-cap-dialog-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: PAID(srv.address().port) } }));
  // every paid provider's key is malformed (nothing real can be reached from this clone's .env or shell); ONLY the stub seat's openrouter key is well-formed, and it points at a loopback stub that counts requests
  const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1', ...extraEnv };
  return { srv, work, env, count: () => requests };
}

// One stdio session; `answer(request)` is called for each server-to-client elicitation request and returns the result object.
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
  // every wait is bounded (the 24f2216 / be10b97 shape): a reply that never comes fails the row naming the server's pid instead of holding the CPU lock
  const rpc = (method, params) => new Promise((ok, no) => {
    const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms from the MCP child pid ${child.pid}`)); }, WAIT_MS);
    waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'cap-dialog-test', version: '9.9' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    asked,
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}
const runsOf = f => readdirSync(join(f.work, 'runs'));
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const START = { chain: 'c', task: 'tasks/x.md' };

test('accept 4: the call starts the run under the typed 4, recorded on the elicitation channel with the client\'s name and version; the dialog\'s message IS the cap screen and its field is a required number with NO default', async () => {
  const f = await fixture(); const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 4 } }) });
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.started, true, JSON.stringify(r));
    assert.equal(s.asked.length, 1);
    const [dir] = runsOf(f).map(n => join(f.work, 'runs', n));
    const screen = readFileSync(join(dir, 'cap-screen-1.md'), 'utf8');
    assert.equal(s.asked[0].params.message, screen, 'exactly the pending screen whose hash the gate covers');
    assert.deepEqual(s.asked[0].params.requestedSchema.required, ['limit_usd']);
    assert.equal(JSON.stringify(s.asked[0].params.requestedSchema).includes('"default"'), false, 'nothing is pre-filled');
    const answered = ledger(dir).find(l => l.event === 'gate_answered');
    assert.deepEqual([answered.channel, answered.cap_usd, answered.client_name, answered.client_version], ['elicitation', '4', 'cap-dialog-test', '9.9'], 'the ledger keeps the normalized dollars as the gate wrote them (a string)');
    for (let i = 0; i < 100 && f.count() === 0; i++) await new Promise(r2 => setTimeout(r2, 100));
    assert.ok(f.count() >= 1, 'the stub was reached after the limit was recorded');
    assert.equal(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).maxUsd, 4);
  } finally { await s.close(); f.srv.close(); }
});

test('decline: nothing is started or spent, the gate is declined, a late answer is refused; cancel: the gate stays pending and the terminal can still answer', async () => {
  const f = await fixture();
  const d = session(f, { answer: () => ({ action: 'decline' }) });
  try {
    const r = await d.call('start_run', START);
    assert.equal(r.started, false); assert.equal(r.state, 'awaiting_user_cap'); assert.equal(r.declined, true);
    const dir = join(f.work, 'runs', runsOf(f)[0]);
    assert.equal(readGateAnswer(dir, 'g1').status, 'declined');
    assert.throws(() => typeCap(dir, '4'), /no pending limit gate/, 'a late answer finds nothing to answer');
    assert.equal(f.count(), 0);
  } finally { await d.close(); }
  const c = session(f, { answer: () => ({ action: 'cancel' }) });
  try {
    const r = await c.call('start_run', START);
    assert.equal(r.started, false); assert.equal(r.state, 'awaiting_user_cap'); assert.equal(r.requires_user, true);
    const dir = join(f.work, 'runs', runsOf(f).sort().at(-1));
    assert.equal(readGateAnswer(dir, 'g1').status, 'pending');
    assert.equal(typeCap(dir, '4'), 'g1', 'the terminal path still works');
    assert.equal(f.count(), 0);
  } finally { await c.close(); f.srv.close(); }
});

test('a number above the ceiling is refused with the gate\'s sentence and asked again (the re-ask carries it above the same screen); an accept with no number is asked again; both inside one call', async () => {
  const f = await fixture({ COUNCIL_MAX_USD_LIMIT: '5' });
  const replies = [{ action: 'accept', content: { limit_usd: 8 } }, { action: 'accept', content: {} }, { action: 'accept', content: { limit_usd: 4 } }];
  const s = session(f, { answer: (m, k) => replies[k - 1] });
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.started, true, JSON.stringify({ r, asked: s.asked.map(m => m.params.message.slice(0, 200)) }));
    assert.equal(s.asked.length, 3);
    const dir = join(f.work, 'runs', runsOf(f)[0]);
    const screen = readFileSync(join(dir, 'cap-screen-1.md'), 'utf8');
    assert.ok(s.asked[1].params.message.endsWith(screen) && s.asked[1].params.message.length > screen.length, 'the re-ask is the screen with one line above it');
    assert.match(s.asked[1].params.message, /\$5\.00|COUNCIL_MAX_USD_LIMIT/, 'the first re-ask carries the ceiling sentence');
    assert.ok(s.asked[2].params.message.startsWith('No limit was typed. Type a number of dollars.'));
    assert.equal(ledger(dir).filter(l => l.event === 'gate_answered').length, 1, 'only the accepted answer was recorded');
  } finally { await s.close(); f.srv.close(); }
});

test('F2 (review fix, 18 Okt 2026): two runs waiting at their own g1 with overlapping dialogs are each asked their own question, and each ledger holds its own answer (the single-flight map is keyed by run folder + gate)', async () => {
  const f = await fixture();
  const s = session(f, { answer: async () => { await new Promise(r => setTimeout(r, 1500)); return { action: 'accept', content: { limit_usd: 4 } }; } });
  try {
    const [a, b] = await Promise.all([s.call('start_run', START), s.call('start_run', START)]);
    assert.equal(s.asked.length, 2, 'each person is asked: one dialog per run, not one shared');
    assert.equal(a.started, true, JSON.stringify(a)); assert.equal(b.started, true, JSON.stringify(b));
    assert.notEqual(a.run, b.run, 'two run folders');
    for (const r of [a, b]) {
      const answered = ledger(join(f.work, 'runs', r.run)).filter(l => l.event === 'gate_answered');
      assert.equal(answered.length, 1, `${r.run}: its own gate_answered`);
      assert.equal(answered[0].cap_usd, '4');
    }
  } finally { await s.close(); f.srv.close(); }
});

test('PIN: a client WITHOUT the elicitation capability gets the awaiting result at once, zero requests, nothing asked', async () => {
  const f = await fixture(); const s = session(f, { elicitation: false });
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.started, false); assert.equal(r.state, 'awaiting_user_cap'); assert.equal(r.requires_user, true); assert.equal(r.paid_started, false);
    assert.equal(s.asked.length, 0); assert.equal(f.count(), 0);
  } finally { await s.close(); f.srv.close(); }
});

test('a DECLINED limit leaves the run folder (exit 21, no stages): run_status and list_runs show it as stopped, not awaiting, and a later start_run spawns a NEW run (C&C clause 2)', async () => {
  const f = await fixture();
  const d = session(f, { answer: () => ({ action: 'decline' }) });
  let old;
  try {
    const r = await d.call('start_run', START); old = r.run;
    assert.equal(r.declined, true, JSON.stringify(r));
    const st = await d.call('run_status', { run: old });
    const listed = (await d.call('list_runs', {})).find(x => x.id === old || x.run === old);
    const shown = JSON.stringify({ st, listed });
    assert.ok(listed, `the folder is listed: ${shown}`);
    assert.equal(st.status, 'stopped', shown);
    assert.equal(listed.status, 'stopped', shown);
    assert.equal(st.resumable?.resumable, true, shown);   // the stored state names it resumable (process_gone); the words say crashed/killed/paused, which a declined limit is none of: a text finding for C&C, pinned here so a change shows
    assert.equal(f.count(), 0);
  } finally { await d.close(); }
  const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 4 } }) });
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.started, true, JSON.stringify(r));
    assert.notEqual(r.run, old, 'a new run, not the declined one');
    assert.equal(runsOf(f).length, 2);
  } finally { await s.close(); f.srv.close(); }
});

// ---- fix-up rows (C&C ruling A and the T6 clauses, 15 Oct 2026) ----
test('resume_run asks too: a run left waiting for its limit (client cancelled) is resumed under the number typed in the dialog', async () => {
  const f = await fixture();
  const c = session(f, { answer: () => ({ action: 'cancel' }) });
  let id;
  try { const r = await c.call('start_run', START); id = r.run; assert.equal(r.state, 'awaiting_user_cap', JSON.stringify(r)); } finally { await c.close(); }
  const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 4 } }) });
  try {
    const r = await s.call('resume_run', { run: id });
    assert.equal(r.resumed, true, JSON.stringify(r));
    assert.equal(s.asked.length, 1);
    const dir = join(f.work, 'runs', id);
    assert.deepEqual(ledger(dir).filter(l => l.event === 'gate_answered').map(l => [l.channel, l.cap_usd]), [['elicitation', '4']]);
    assert.equal(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).maxUsd, 4);
  } finally { await s.close(); f.srv.close(); }
});

test('submit_stage NEVER asks (DR-3: it can never reach a gate): a resume that exits 21 comes back as the awaiting result naming resume_run, zero dialogs, zero requests', async () => {
  const f = await fixture();
  // a FREE external-seat chain pauses at its builder; the chain file is then changed to hold a paid seat, so the resume that submit_stage starts needs a limit the run does not have
  const ext = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  writeFileSync(join(f.work, 'chains', 'c.json'), JSON.stringify({ ...ext, name: 'c' }));
  const s = session(f, { answer: () => ({ action: 'accept', content: { limit_usd: 4 } }) });
  try {
    const started = await s.call('start_run', START);
    assert.equal(started.started, true, JSON.stringify(started));
    let waiting = [];
    for (let i = 0; i < 100 && !waiting.length; i++) { await new Promise(r => setTimeout(r, 100)); waiting = (await s.call('external_prompt', { run: started.run })).waiting ?? []; }
    assert.ok(waiting.length, 'the run paused at an external seat');
    const paidAfter = { ...ext, name: 'c', seats: { ...ext.seats, criteria: PAID(f.srv.address().port) } };
    writeFileSync(join(f.work, 'chains', 'c.json'), JSON.stringify(paidAfter));
    const r = await s.call('submit_stage', { run: started.run, stage: waiting[0].stage ?? waiting[0], content: 'An answer.\n' });
    assert.equal(r.state, 'awaiting_user_cap', JSON.stringify(r));
    assert.equal(r.requires_user, true);
    assert.match(r.hint, /resume_run asks for it/, 'the result names the call that asks');
    assert.match(r.next, /gate answer/, 'and the terminal step stays');
    assert.equal(s.asked.length, 0, 'submit_stage opened no dialog');
    assert.equal(f.count(), 0);
  } finally { await s.close(); f.srv.close(); }
});

test('THE BUDGET: a client that never answers the dialog: start_run returns the awaiting result inside the call budget (25 s hold, the dialog closes 5 s before), the gate stays pending, nothing is started', { timeout: 60000 }, async () => {
  const f = await fixture();
  const s = session(f, { answer: () => new Promise(() => {}) });
  try {
    const t0 = Date.now();
    const r = await s.call('start_run', START);
    const took = Date.now() - t0;
    assert.equal(r.started, false); assert.equal(r.state, 'awaiting_user_cap'); assert.equal(r.requires_user, true);
    assert.equal(s.asked.length, 1);
    assert.ok(took > 15000 && took < 25000, `returned after ${took} ms: inside the 25 s budget, after the 20 s dialog window`);
    assert.equal(readGateAnswer(join(f.work, 'runs', r.run), 'g1').status, 'pending');
    assert.equal(f.count(), 0);
  } finally { await s.close(); f.srv.close(); }
});
