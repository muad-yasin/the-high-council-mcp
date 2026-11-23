// start_run takes the ladder, and a run started over MCP keeps its caps through resume_run (084/mcp-start). The CLI start line carries `--ladder`, `--ladder-exchange N` and `--ladder-credit N`; start_run took none of them, so a run that needs the
// ladder could only be started from a terminal. Here: (L1) the three arguments are in the tool's schema, none required; (L2) their bounds are the ladder's own (ladderOf) and the argument builder maps them to the CLI's flags; (L3) a start saves the ladder
// in run.json exactly as the CLI start line does, and a start without them saves none; (L4) an exchange or a credit without `ladder: true` is refused before a run id is taken, and an out-of-range value never reaches the CLI; (L5) a ladder on a chain without
// three layers is refused by the CLI child and nothing is spent; (L6) under the per-cap switch the dialog asks every cap, the run starts once, and the saved ladder survives the resume the dialog makes; (L7) resume_run over MCP holds the per-cap resume verdict:
// the same caps continue the run, the switch gone from the server's environment or a narrower switch that leaves a seat uncovered is refused with nothing started. Offline, $0: a real stdio MCP child, mock seats only (the caps chains place them in two caps with no key).
// The expected reds of this file (against 4665462a and against known-bad trees) are PREDICTED, never observed: Review/084/cnc/mcp-start/EXPECTED_REDS.md.
// CHANGED ACCEPTED TESTS (0.8.4 apply, C&C ruling 12 Nov 2026; L2, L3, L4, L6). OLD: the rows started the ladder with `ladder_exchange: 2` (the bench run's CLI line `--ladder --ladder-exchange 2 --ladder-credit 1`) and expected the argument to reach the CLI; L4 expected a bare `ladder_exchange` to be refused with 'go with ladder: true'. Red on 13f0a686 (job 129, four rows): since 023339ba (ladder-exchange is refused, with any value, once the shortened exchange is in force; the pair W5 + W14 is recorded in src/roles.js), start_run refuses `ladder_exchange` with
// any value and with or without `ladder: true`, before a run id is taken (src/mcp/start-ladder.js LADDER_EXCHANGE_NOT_USED_SENTENCE), and the sentence for a credit without the ladder reads 'goes with'. NEW: no row passes `ladder_exchange` to a start it expects to run: the ladder is started with `ladder: true` and `ladder_credit` (the agent's route: run.json saves {block 3, visits 3, credit N, exchange 0}); `ladder_exchange` with any value is refused by the not-used sentence (with and without `ladder: true`); a credit without `ladder: true` is refused by the needs-ladder sentence.
// WHY: the inputs were stale, the claims are kept (the arguments are in the schema, the builder maps them, a start saves the ladder, a credit alone is refused, the saved ladder survives the resume the dialog makes). L1 is unchanged (the schema still lists the argument; its description says it is refused). Red: a credit WITH `ladder: true` is not refused (L4's known-bad input: that call listed among the refusals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readGateAnswer, answerGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const WAIT_MS = 40000;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const CAPS_ON = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const CAPS_OFF = { COUNCIL_SPEND_CAPS: '' };

// A three-layer chain whose judges all sign off at once (the ladder needs exactly three layers and overseer rounds; test/ladder.test.js's shape).
const WRITER = { provider: 'mock', model: 'mock-builder', lab: 'author' };
const LAYERED = {
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: WRITER, reviser: WRITER, critics: [1, 2, 3].map(n => ({ provider: 'mock', model: `mock-critic-script-o-m${n}`, lab: `l${n}`, layer: n })) },
};
// The same three layers with seats that declare the account they bill through, so the two caps are in force with no key (test/fixtures/caps/mock-bills-two-caps.json's way).
const priced = extra => ({ provider: 'mock', model: 'mock-priced', maxTokens: 8000, ...extra });
const LAYERED_CAPS = {
  name: 'lad-caps', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { criteria: { provider: 'mock', model: 'mock-priced', maxTokens: 100 }, builder: priced({ mockBills: 'anthropic' }), reviser: priced({ mockBills: 'anthropic' }),
    critics: [priced({ lab: 'l1', layer: 1, mockBills: 'openrouter' }), priced({ lab: 'l2', layer: 2, mockBills: 'anthropic' }), priced({ lab: 'l3', layer: 3, mockBills: 'openrouter' })] },
};
// Two caps in force and an EXTERNAL builder: the run pauses at the build stage (exit 3) after both limits are armed, so there is a paused caps run to resume.
const PAUSING = {
  name: 'caps-pause', maxRounds: 2, stopOnPass: true, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { criteria: { provider: 'mock', model: 'mock-priced', maxTokens: 100 }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'external', model: 'claude-code-session' },
    critics: [priced({ lab: 'mock-a', mockBills: 'openrouter' }), priced({ lab: 'mock-b', mockBills: 'anthropic' })] },
};
const TWO_CAPS = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json'), 'utf8'));   // one critic, no layers

function fixture(chains, extraEnv = {}) {
  const work = mkdtempSync(join(tmpdir(), 'thc-mcp-ladder-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  for (const c of chains) writeFileSync(join(work, 'chains', `${c.name}.json`), JSON.stringify(c));
  // every paid provider's key is malformed (nothing real can be reached from this clone's .env or shell): the chains are mock-only, and the $0 guard (test/no-paid-chain-spawn.test.js) asks for the proof
  return { work, env: { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), ...extraEnv } };
}
// One stdio session; `answer(request, n)` answers each server-to-client elicitation request (test/caps-mcp.test.js's way).
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
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'mcp-start-ladder-test', version: '1.0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    asked,
    async tools() { await ready; return (await rpc('tools/list', {})).result.tools; },
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}
const START = { task: 'tasks/x.md' };
const runJson = (f, run) => JSON.parse(readFileSync(join(f.work, 'runs', run, 'run.json'), 'utf8'));
const noRunFolders = f => !(existsSync(join(f.work, 'runs')) && readdirSync(join(f.work, 'runs')).length > 0);
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const typeLimit = (d, id, total) => { const g = readGateAnswer(d, id).gate; const a = answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: total }); assert.equal(a.ok, true, JSON.stringify(a)); };
const gateOfCap = (d, cap) => ledger(d).filter(l => l.event === 'gate_requested').map(l => l.gate).find(id => readGateAnswer(d, id).gate.cap.cap_name === cap);
async function settled(s, run) { for (let i = 0; i < 12; i++) { const r = await s.call('run_status', { run, wait_seconds: 25, until: 'settled' }); if (r.progress?.settled !== false && r.status !== 'running') return r; } return s.call('run_status', { run }); }

test('L1 start_run lists ladder (boolean), ladder_exchange (integer 0 to 7) and ladder_credit (integer from 0) in its schema, and none of the three is required', async () => {
  const f = fixture([LAYERED], CAPS_OFF); const s = session(f);
  try {
    const schema = (await s.tools()).find(t => t.name === 'start_run').inputSchema;
    assert.equal(schema.properties.ladder?.type, 'boolean', 'ladder is a boolean argument');
    assert.equal(schema.properties.ladder_exchange?.type, 'integer', 'ladder_exchange is an integer argument');
    assert.deepEqual([schema.properties.ladder_exchange?.minimum, schema.properties.ladder_exchange?.maximum], [0, 7], 'ladder_exchange runs from 0 to 7');
    assert.equal(schema.properties.ladder_credit?.type, 'integer', 'ladder_credit is an integer argument');
    assert.equal(schema.properties.ladder_credit?.minimum, 0, 'ladder_credit starts at 0');
    for (const k of ['ladder', 'ladder_exchange', 'ladder_credit']) assert.equal((schema.required ?? []).includes(k), false, `${k} is optional`);
  } finally { await s.close(); }
});

test('L2 the schema\'s bounds are the ladder\'s own (ladderOf), and the argument builder maps the three arguments to the CLI\'s flags and refuses an exchange or a credit without ladder: true', async () => {
  const { LADDER_START_SHAPE, ladderStartArgs, LADDER_NEEDS_LADDER_SENTENCE, LADDER_EXCHANGE_NOT_USED_SENTENCE } = await import('../src/mcp/start-ladder.js');   // loaded here, so the other tests of this file can fail on their own where the module does not exist yet
  const { ladderOf } = await import('../src/ladder.js');
  for (const n of [0, 1, 7, 8, -1, 1.5]) assert.equal(z.object({ e: LADDER_START_SHAPE.ladder_exchange }).safeParse({ e: n }).success, ladderOf({ exchange: n }) !== null, `ladder_exchange ${n}: the schema and ladderOf agree`);
  for (const n of [0, 1, 5, -1, 1.5]) assert.equal(z.object({ c: LADDER_START_SHAPE.ladder_credit }).safeParse({ c: n }).success, ladderOf({ credit: n }) !== null, `ladder_credit ${n}: the schema and ladderOf agree`);
  assert.deepEqual(ladderStartArgs({}), { args: [] }, 'no ladder argument, no flag');
  assert.deepEqual(ladderStartArgs({ ladder: false }), { args: [] });
  assert.deepEqual(ladderStartArgs({ ladder: true }), { args: ['--ladder'] });
  assert.deepEqual(ladderStartArgs({ ladder: true, ladder_credit: 1 }), { args: ['--ladder', '--ladder-credit', '1'] }, 'the agent route: the ladder and a credit, no exchange');
  assert.deepEqual(ladderStartArgs({ ladder: true, ladder_credit: 0 }), { args: ['--ladder', '--ladder-credit', '0'] }, 'a 0 is a value, not "left out"');
  for (const bad of [{ ladder: true, ladder_exchange: 2 }, { ladder: true, ladder_exchange: 0 }, { ladder_exchange: 2 }, { ladder: false, ladder_exchange: 1 }, { ladder: true, ladder_exchange: 2, ladder_credit: 1 }]) assert.deepEqual(ladderStartArgs(bad), { refused: LADDER_EXCHANGE_NOT_USED_SENTENCE }, `${JSON.stringify(bad)}: an exchange with any value is refused (023339ba)`);
  for (const bad of [{ ladder_credit: 1 }, { ladder: false, ladder_credit: 1 }]) assert.deepEqual(ladderStartArgs(bad), { refused: LADDER_NEEDS_LADDER_SENTENCE }, `${JSON.stringify(bad)} is refused: a credit goes with ladder: true`);
  assert.equal(ladderStartArgs({ ladder: true, ladder_exchange: 8 }).args, undefined, 'a value past the bound is refused by the backstop even if the schema were skipped');
  assert.match(LADDER_NEEDS_LADDER_SENTENCE, /goes with ladder: true\. Nothing was started and nothing was spent\.$/);
  assert.match(LADDER_EXCHANGE_NOT_USED_SENTENCE, /ladder_exchange is no longer used.*Leave it out\. Nothing was started and nothing was spent\.$/);
});

test('L3 start_run saves the ladder in run.json as the CLI start line does (--ladder --ladder-credit 1; the exchange stays 0), a bare ladder: true saves the defaults, and a start without the arguments saves no ladder', async () => {
  const f = fixture([LAYERED], CAPS_OFF); const s = session(f);
  try {
    const a = await s.call('start_run', { chain: 'lad', ...START, ladder: true, ladder_credit: 1 });
    assert.equal(a.started, true, JSON.stringify(a));
    assert.deepEqual(runJson(f, a.run).ladder, { block: 3, visits: 3, credit: 1, exchange: 0 }, 'run.json carries the ladder the call asked for (the exchange is not an argument any more: 0)');
    await settled(s, a.run);
    const b = await s.call('start_run', { chain: 'lad', ...START, ladder: true });
    assert.equal(b.started, true, JSON.stringify(b));
    assert.deepEqual(runJson(f, b.run).ladder, { block: 3, visits: 3, credit: 0, exchange: 0 }, 'a bare ladder: true is the ladder with its defaults');
    await settled(s, b.run);
    const c = await s.call('start_run', { chain: 'lad', ...START });
    assert.equal(c.started, true, JSON.stringify(c));
    assert.equal('ladder' in runJson(f, c.run), false, 'a start without the arguments saves no ladder');
    await settled(s, c.run);
  } finally { await s.close(); }
});

test('L4 an exchange or a credit without ladder: true is refused before a run id is taken, and a value outside the bounds never reaches the CLI: no run folder either way', async () => {
  const f = fixture([LAYERED], CAPS_OFF); const s = session(f);
  try {
    for (const bad of [{ ladder_credit: 1 }, { ladder: false, ladder_credit: 1 }]) {
      const r = await s.call('start_run', { chain: 'lad', ...START, ...bad });
      assert.equal(r.started, false, `${JSON.stringify(bad)}: ${JSON.stringify(r).slice(0, 300)}`);
      assert.match(r.error ?? '', /goes with ladder: true\. Nothing was started and nothing was spent\./, `${JSON.stringify(bad)}: the refusal names ladder: true`);
    }
    for (const bad of [{ ladder_exchange: 2 }, { ladder: false, ladder_exchange: 1 }, { ladder: true, ladder_exchange: 2 }]) {
      const r = await s.call('start_run', { chain: 'lad', ...START, ...bad });
      assert.equal(r.started, false, `${JSON.stringify(bad)}: ${JSON.stringify(r).slice(0, 300)}`);
      assert.match(r.error ?? '', /ladder_exchange is no longer used.*Leave it out\. Nothing was started and nothing was spent\./, `${JSON.stringify(bad)}: an exchange with any value is refused (023339ba)`);
    }
    for (const bad of [{ ladder: true, ladder_exchange: 8 }, { ladder: true, ladder_credit: -1 }, { ladder: true, ladder_exchange: 1.5 }]) {
      const r = await s.call('start_run', { chain: 'lad', ...START, ...bad });
      assert.ok(r.isError === true || r.error, `${JSON.stringify(bad)} is refused by the schema: ${JSON.stringify(r).slice(0, 300)}`);
    }
    assert.equal(noRunFolders(f), true, 'no refusal took a run id or made a folder');
  } finally { await s.close(); }
});

test('L5 a ladder on a chain without exactly three layers is refused by the CLI child, with its sentence in the answer; nothing is spent', async () => {
  const f = fixture([TWO_CAPS], CAPS_OFF); const s = session(f);
  try {
    const r = await s.call('start_run', { chain: TWO_CAPS.name, ...START, ladder: true });
    assert.equal(r.started, false, JSON.stringify(r).slice(0, 400));
    assert.equal(r.exitCode, 2, JSON.stringify(r).slice(0, 400));
    assert.match(r.logTail ?? '', /does not have exactly three layers/);
    const usage = existsSync(join(f.work, 'runs')) ? readdirSync(join(f.work, 'runs'), { recursive: true }).filter(p => String(p).endsWith('.usage.json')) : [];
    assert.deepEqual(usage, [], 'no stage was run');
  } finally { await s.close(); }
});

test('L6 under the per-cap switch a ladder start (ladder: true, a credit) asks every cap in the dialog, starts the run once, and the saved ladder survives the resume the dialog makes (the resume carries no ladder of its own)', async () => {
  const f = fixture([LAYERED_CAPS], CAPS_ON); const s = session(f, { elicitation: true, answer: () => ({ action: 'accept', content: { limit_usd: 1000 } }) });
  try {
    const r = await s.call('start_run', { chain: LAYERED_CAPS.name, ...START, ladder: true, ladder_credit: 1 });
    assert.equal(r.started, true, JSON.stringify(r).slice(0, 500));
    assert.equal(s.asked.length, 2, 'one question per cap, no more');
    await settled(s, r.run);
    const meta = runJson(f, r.run);
    assert.deepEqual(meta.caps, { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } }, 'both limits are on record');
    assert.deepEqual(meta.ladder, { block: 3, visits: 3, credit: 1, exchange: 0 }, 'the ladder typed at the start is the one in force after the resume');
  } finally { await s.close(); }
});

test('L7 resume_run over MCP holds the per-cap resume verdict: a paused caps run is refused when the switch is gone from the server\'s environment or is narrowed so a seat is uncovered (nothing started), and continues under the same caps', async () => {
  const f = fixture([PAUSING], CAPS_ON); const s = session(f);
  const others = [];
  try {
    const r = await s.call('start_run', { chain: PAUSING.name, ...START });
    assert.equal(r.started, false, JSON.stringify(r).slice(0, 400));
    assert.deepEqual((r.decisions ?? []).map(d => d.cap).sort(), ['anthropic', 'openrouter'], 'the start waits for one limit per cap');
    const dir = join(f.work, 'runs', r.run);
    for (const cap of ['anthropic', 'openrouter']) typeLimit(dir, gateOfCap(dir, cap), '1000');
    const go = await s.call('resume_run', { run: r.run });
    assert.equal(go.resumed, true, JSON.stringify(go).slice(0, 400));
    await settled(s, r.run);
    assert.equal(existsSync(join(dir, 'NEEDS-build.md')), true, 'the run paused at the external build stage');
    assert.deepEqual(runJson(f, r.run).caps, { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } }, 'the caps are on record in the paused run');
    writeFileSync(join(dir, 'build.md'), 'A plan.\n');   // the external answer: from here on only the caps decide whether the run continues
    // the switch is gone from the server's environment (the MODE FLIP): refused, nothing started
    const off = session({ ...f, env: { ...f.env, ...CAPS_OFF } }); others.push(off);
    const flipped = await off.call('resume_run', { run: r.run });
    assert.equal(flipped.resumed, false, JSON.stringify(flipped).slice(0, 500));
    assert.equal(flipped.exitCode, 2, JSON.stringify(flipped).slice(0, 500));
    assert.match(flipped.logTail ?? '', /the setting is now empty, so it was not continued/);
    // a narrower switch: mock-b bills through anthropic, which the switch no longer names, so the CLI's start refusals (uncovered seat, exit 5) speak BEFORE the resume verdict; the verdict's own 'set of caps changed' sentence cannot be reached with these seats
    const fewer = session({ ...f, env: { ...f.env, COUNCIL_SPEND_CAPS: 'openrouter' } }); others.push(fewer);
    const changed = await fewer.call('resume_run', { run: r.run });
    assert.equal(changed.resumed, false, JSON.stringify(changed).slice(0, 500));
    assert.equal(changed.exitCode, 5, JSON.stringify(changed).slice(0, 500));
    assert.match(changed.logTail ?? '', /no cap covers/);
    assert.match(changed.logTail ?? '', /Nothing was started\./);
    assert.equal(existsSync(join(dir, 'panel-1-mock-a.md')) || existsSync(join(dir, 'deliverable.md')), false, 'the two refusals ran no stage');
    // the same caps in force: the run continues
    const again = await s.call('resume_run', { run: r.run });
    assert.equal(again.resumed, true, JSON.stringify(again).slice(0, 500));
    await settled(s, r.run);
  } finally { await s.close(); for (const o of others) await o.close(); }
});
