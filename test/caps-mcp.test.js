// The MCP surface under the per-provider caps switch (0.8.4 DUALCAP unit 4c2). Over MCP a run under the caps starts, waits for one typed limit per cap, continues and
// reports per cap as it does at the CLI: the server never adds a run-wide --max-usd to a run whose chain has a cap in force (it refuses a caller's max_usd there before
// anything is spawned), the client dialog asks every cap still open and then continues the run once, a waiting start's folder (with the server's own .spawn.json) is
// a pending start, run_status reports each cap and the stopped cap's own figures, and a per-cap ceiling left as a host placeholder reaches the CLI as given (refused
// there, as COUNCIL_MAX_USD_LIMIT is). Offline, $0: a real stdio MCP child, mock seats only (the two-cap fixture places them in two caps with no key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGateAnswer, answerGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { capsPendingStart } from '../src/caps.js';
import { resumeCeilingUsd } from '../src/resume-ceiling.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const WAIT_MS = 40000;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ON = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const TWO_CAPS = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json'), 'utf8'));

function fixture(extraEnv = {}) {
  const work = mkdtempSync(join(tmpdir(), 'thc-caps-mcp-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  writeFileSync(join(work, 'chains', `${TWO_CAPS.name}.json`), JSON.stringify(TWO_CAPS));
  // every paid provider's key is malformed (nothing real can be reached from this clone's .env or shell): the chain is mock-only, and the $0 guard (test/no-paid-chain-spawn.test.js) asks for the proof
  const env = { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), ...ON, ...extraEnv };
  return { work, env };
}
// One stdio session; `answer(request, n)` answers each server-to-client elicitation request.
function session(f, { elicitation = false, answer = null } = {}) {
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
  const rpc = (method, params) => new Promise((ok, no) => {
    const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms from the MCP child pid ${child.pid}`)); }, WAIT_MS);
    waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'caps-mcp-test', version: '1.0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    asked,
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}
const START = { chain: TWO_CAPS.name, task: 'tasks/x.md' };
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const typeLimit = (d, id, total) => { const g = readGateAnswer(d, id).gate; const a = answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: total }); assert.equal(a.ok, true, JSON.stringify(a)); };
const gateOfCap = (d, cap) => ledger(d).filter(l => l.event === 'gate_requested').map(l => l.gate).find(id => readGateAnswer(d, id).gate.cap.cap_name === cap);
async function settled(s, run) { for (let i = 0; i < 12; i++) { const r = await s.call('run_status', { run, wait_seconds: 25, until: 'settled' }); if (r.progress?.settled !== false && r.status !== 'running') return r; } return s.call('run_status', { run }); }

test('P1 a waiting per-cap start over MCP continues with resume_run once both limits are typed: the server adds no --max-usd (a run-wide figure the CLI refuses under the caps), and the folder, which holds the server\'s .spawn.json, is a pending start', async () => {
  const f = fixture(); const s = session(f);
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.started, false, JSON.stringify(r));
    assert.equal(r.state, 'awaiting_user_cap', JSON.stringify(r));
    const dir = join(f.work, 'runs', r.run);
    assert.ok(existsSync(join(dir, '.spawn.json')), 'the server recorded its spawn in the run folder');
    for (const cap of ['anthropic', 'openrouter']) typeLimit(dir, gateOfCap(dir, cap), '1000');
    const go = await s.call('resume_run', { run: r.run });
    assert.equal(go.resumed, true, JSON.stringify(go));
    const done = await settled(s, r.run);
    assert.equal(done.status, 'done', JSON.stringify(done).slice(0, 600));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).caps, { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } });
  } finally { await s.close(); }
});

test('P1b with COUNCIL_MAX_USD_LIMIT set (and each cap\'s own ceiling, option B) a new start_run without max_usd is NOT given a run-wide --max-usd: it waits at the per-cap gates (awaiting_user_cap), not refused', async () => {
  const f = fixture({ COUNCIL_MAX_USD_LIMIT: '50', COUNCIL_MAX_USD_LIMIT_OPENROUTER: '20', COUNCIL_MAX_USD_LIMIT_ANTHROPIC: '20' }); const s = session(f);
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.state, 'awaiting_user_cap', JSON.stringify(r).slice(0, 600));
  } finally { await s.close(); }
});

test('P2 a waiting start\'s folder with the server\'s .spawn.json is a pending start (the allowlist)', () => {
  const entries = ['run.json', 'gate-ledger.jsonl', 'gates', 'gates/g1.json', 'cap-screen-1.md', 'cap-scope-1.json', '.spawn.json'];
  assert.equal(capsPendingStart(entries, { chain: 'x' }), true);
  assert.equal(capsPendingStart([...entries, 'criteria.md'], { chain: 'x' }), false, 'a stage file still makes it a run that started');
});

test('P3 a client that can ask: start_run asks EVERY cap still open in the dialog (one question per cap, each field naming its cap), then starts the run once; run.json carries both limits', async () => {
  const f = fixture(); const s = session(f, { elicitation: true, answer: () => ({ action: 'accept', content: { limit_usd: 1000 } }) });
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.started, true, JSON.stringify(r).slice(0, 600));
    assert.equal(s.asked.length, 2, `two questions, one per cap: ${s.asked.length}`);
    const titles = s.asked.map(m => m.params.requestedSchema.properties.limit_usd.title).sort();
    assert.match(titles[0], /anthropic/); assert.match(titles[1], /openrouter/);
    const done = await settled(s, r.run);
    assert.deepEqual(JSON.parse(readFileSync(join(f.work, 'runs', r.run, 'run.json'), 'utf8')).caps, { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } });
    assert.equal(done.status, 'done', JSON.stringify(done).slice(0, 400));
  } finally { await s.close(); }
});

test('P4 run_status of a run stopped at ONE cap reports the caps and the stopped cap\'s own figures: budget per cap with the stop naming its cap, and the suggested total from that cap\'s spend (not the run total)', async () => {
  const f = fixture();
  const id = '2026-11-01T15-00-00-000Z'; const dir = join(f.work, 'runs', id);
  const cliRun = args => spawnSync(process.execPath, [cli, ...args], { cwd: f.work, env: f.env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(cliRun(['--task', 'tasks/x.md', '--chain', TWO_CAPS.name, '--run-id', id]).status, 21);
  typeLimit(dir, gateOfCap(dir, 'anthropic'), '1000'); typeLimit(dir, gateOfCap(dir, 'openrouter'), '0.01');
  assert.equal(cliRun(['--resume', dir]).status, 4);
  const st = JSON.parse(readFileSync(join(dir, 'STOPPED-budget.json'), 'utf8'));
  const s = session(f);
  try {
    const r = await s.call('run_status', { run: id });
    assert.equal(r.budget.stoppedByCap.capName, 'openrouter', JSON.stringify(r.budget));
    assert.equal(r.budget.caps.openrouter.capUsd, 0.01, JSON.stringify(r.budget));
    assert.equal(r.budget.caps.anthropic.capUsd, 1000, JSON.stringify(r.budget));
    assert.ok(Math.abs(r.budget.caps.openrouter.spentUsd - st.capSpentUsd) < 1e-9, JSON.stringify(r.budget));
    const want = resumeCeilingUsd({ cap: st.capUsd, spent: st.capSpentUsd + (st.capAssumedUsd || 0), projected: st.projectedStageUsd, gate: st.gateStageUsd });
    assert.equal(r.resumable.suggestedMaxUsd, want, JSON.stringify(r.resumable));
    assert.equal(r.resumable.capName, 'openrouter', JSON.stringify(r.resumable));
  } finally { await s.close(); }
});

test('P5 start_run with max_usd on a chain with a cap in force is refused by the server BEFORE anything is spawned, naming max_usd and COUNCIL_SPEND_CAPS; a chain with no cap in force still starts with it (its run cap)', async () => {
  const f = fixture(); const s = session(f);
  try {
    const r = await s.call('start_run', { ...START, max_usd: 3 });
    assert.equal(r.started, false, JSON.stringify(r));
    assert.match(r.error ?? '', /max_usd/);
    assert.match(r.error ?? '', /COUNCIL_SPEND_CAPS/);
    assert.equal(readdirSync(f.work).some(n => /^council-.*\.log$/.test(n)), false, 'no CLI child was spawned');
    const plain = await s.call('start_run', { chain: 'mock', task: 'tasks/x.md', max_usd: 3 });
    assert.equal(plain.started, true, JSON.stringify(plain).slice(0, 400));
  } finally { await s.close(); }
});

test('P6 a per-cap ceiling left as a host placeholder reaches the CLI as given (as COUNCIL_MAX_USD_LIMIT does) and is refused there as a placeholder, instead of being dropped by the server and read as "not set"', async () => {
  const f = fixture({ COUNCIL_MAX_USD_LIMIT: '50', COUNCIL_MAX_USD_LIMIT_OPENROUTER: '20', COUNCIL_MAX_USD_LIMIT_ANTHROPIC: '${user_config.anthropic_ceiling}' }); const s = session(f);
  try {
    const r = await s.call('start_run', START);
    assert.equal(r.started, false, JSON.stringify(r));
    assert.match(JSON.stringify(r), /COUNCIL_MAX_USD_LIMIT_ANTHROPIC still holds a placeholder/);
  } finally { await s.close(); }
});

test('P7 the per-cap RAISE through the client dialog: a run stopped at the openrouter cap, resume_run from a client that can ask: ONE question, its field naming openrouter (the stopped cap; anthropic is not asked again), the raise recorded for that cap, and the run continues and finishes under the new limit', async () => {
  const f = fixture();
  const id = '2026-11-01T15-00-07-000Z'; const dir = join(f.work, 'runs', id);
  const cliRun = args => spawnSync(process.execPath, [cli, ...args], { cwd: f.work, env: f.env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(cliRun(['--task', 'tasks/x.md', '--chain', TWO_CAPS.name, '--run-id', id]).status, 21);
  typeLimit(dir, gateOfCap(dir, 'anthropic'), '1000'); typeLimit(dir, gateOfCap(dir, 'openrouter'), '0.01');
  assert.equal(cliRun(['--resume', dir]).status, 4);
  const s = session(f, { elicitation: true, answer: () => ({ action: 'accept', content: { limit_usd: 1000 } }) });
  try {
    const r = await s.call('resume_run', { run: id });
    assert.equal(s.asked.length, 1, `one question, for the stopped cap only: ${JSON.stringify(r).slice(0, 300)}`);
    assert.match(s.asked[0].params.requestedSchema.properties.limit_usd.title, /openrouter/);
    const raises = ledger(dir).filter(l => l.event === 'cap_consumed' && l.cap_name === 'openrouter');
    assert.equal(raises.length, 2, 'the first limit and the raise, both for openrouter');
    assert.equal(ledger(dir).filter(l => l.event === 'cap_consumed' && l.cap_name === 'anthropic').length, 1, 'anthropic was not asked again');
    const done = await settled(s, id);
    assert.equal(done.status, 'done', JSON.stringify(done).slice(0, 400));
    assert.equal(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).caps.openrouter.maxUsd, 1000);
  } finally { await s.close(); }
});
