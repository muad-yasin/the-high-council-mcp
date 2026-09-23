// Pre-release audit batch 2 fixes that need no run folder of their own
// (Review/PreRelease_Audit_{moneypath,providers,cli,metrics}_2026-09-23.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIdToDate, spendReport } from '../src/spend.js';

test('metrics #3: runIdToDate accepts only a whole run id, so a renamed copy is not counted twice', () => {
  assert.ok(runIdToDate('2026-09-23T10-06-06-899Z') instanceof Date);
  for (const id of ['old-2026-09-23', '2026-09-23', '2026', 'x2026-09-23T10-06-06-899Z', '2026-09-23T10-06-06-899Z-copy']) {
    assert.equal(runIdToDate(id), null, id);
  }
  const runs = mkdtempSync(join(tmpdir(), 'runid-'));
  const now = new Date();
  const id = now.toISOString().replace(/[:.]/g, '-');
  for (const name of [id, `old-${id.slice(0, 10)}`]) {
    mkdirSync(join(runs, name));
    writeFileSync(join(runs, name, 'report.json'), JSON.stringify({ chain: 'c', totals: { usd: 1.5 } }));
  }
  const r = spendReport(runs, { days: 1, now: now.getTime() + 1000 });
  assert.equal(r.count, 1);
  assert.equal(r.totalUsd, 1.5);
});

// ---- money path #1, #3, #5; providers #1; metrics #1, #2 ----
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarise } from '../src/cost.js';
import { generateDigestText } from '../src/dissent-digest.js';
import { call, setRequestDeadline, setRetrySleep } from '../src/providers.js';
import { stageKindOfFile } from '../src/verdict-stats.js';

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const cliRun = (cwd, args) => spawnSync('node', [cliPath, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH } });

test('money #1: a capped rematch records what its in-flight panel siblings spent, not the figure at the moment of the stop', () => {
  const dir = mkdtempSync(join(tmpdir(), 'money1-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 's.md'), 'A smoke task.');
  const seat = t => ({ provider: 'mock', model: 'mock-priced', maxTokens: t });
  writeFileSync(join(dir, 'chains', 'mb3.json'), JSON.stringify({
    name: 'mb3', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
    seats: { criteria: seat(100), builder: seat(400), reviser: seat(400), critics: ['a', 'b', 'c'].map(lab => ({ ...seat(400), lab })) },
  }));
  assert.equal(cliRun(dir, ['--chain', 'mb3', '--task', 'tasks/s.md', '--max-usd', 'none']).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0];
  const stages = JSON.parse(readFileSync(join(dir, 'runs', id, 'report.json'), 'utf8')).stages;
  const cost = l => stages.find(s => s.label === l).usd;
  // 1.3 lets criteria, build and one parallel critic through, then stops the second.
  const r = cliRun(dir, ['--rematch', join('runs', id), '--rematch-seed', '7', '--max-usd', '1.3']);
  assert.equal(r.status, 4, r.stderr);
  const marker = JSON.parse(readFileSync(join(dir, 'runs', `${id}.rematch-7`, 'STOPPED-budget.json'), 'utf8'));
  const paid = cost('criteria') + cost('build') + cost('panel-1-a');
  assert.ok(Math.abs(marker.spentUsd - paid) < 1e-9, `marker says ${marker.spentUsd}, the sitting paid ${paid}`);
});

test('money #3: report totals use each stage\'s own usd, which includes a discarded thinking attempt', () => {
  const t = summarise([{ provider: 'mock', model: 'mock-priced', usage: { input: 0, output: 0 }, usd: 0.105 }]);
  assert.equal(t.usd, 0.105);
});

test('money #5: the digest never sends a denied model, in the library or through the CLI', async () => {
  let sent = 0;
  await assert.rejects(
    generateDigestText({ report: {}, call: async () => { sent++; return { text: 'x' }; }, provider: 'openrouter', model: 'x-ai/grok-4' }),
    /denied model/,
  );
  assert.equal(sent, 0);
  const dir = mkdtempSync(join(tmpdir(), 'digest-deny-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ outcome: 'passed' }));
  const r = cliRun(dir, ['digest', '--run', dir, '--provider', 'openrouter', '--model', 'x-ai/grok-4']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /denied model/);
});

test('providers #1: a request deadline that fires before any header keeps maybeBilled and a readable message', async () => {
  const sockets = [];
  const srv = createServer(s => sockets.push(s)); // accepts, never answers
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  setRequestDeadline(200);
  setRetrySleep(async () => {});
  try {
    await assert.rejects(
      call('ollama', { model: 'm', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 5, baseUrl: `http://127.0.0.1:${srv.address().port}/v1` }),
      err => /request deadline/.test(err.message) && err.maybeBilled === true,
    );
  } finally {
    setRequestDeadline(null); setRetrySleep(null);
    sockets.forEach(s => s.destroy()); srv.close();
  }
});

test('metrics #1: stage kinds collapse across real, dotted lab names', () => {
  for (const [f, kind] of [['panel-2-glm5.3.md', 'panel'], ['panel-1-gpt5.6-luna-question.md', 'panel'], ['alt-debate-fable5.1.md', 'alt-debate'],
    ['propose-gpt5.6-luna.md', 'propose'], ['debate-glm5.3.md', 'debate'], ['revise-3.md', 'revise'], ['criteria-retry.md', 'criteria-retry'], ['NEEDS-build.md', 'build']]) {
    assert.equal(stageKindOfFile(f), kind, f);
  }
});

test('metrics #2: council --metrics prints the consensus-induced regression count the README documents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metrics2-'));
  const r = cliRun(dir, ['--metrics']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /consensus-induced regressions/);
});

// ---- LOWs: run-lock takeover race, crash exit code ----
import { LOCK_FILE } from '../src/run-lock.js';
import { hostname } from 'node:os';

test('cli #4: three processes taking over one stale lock end with exactly one holder', async () => {
  const lockMod = resolve(dirname(fileURLToPath(import.meta.url)), '../src/run-lock.js');
  const { spawn } = await import('node:child_process');
  for (let trial = 0; trial < 8; trial++) {
    const d = mkdtempSync(join(tmpdir(), 'lockrace-'));
    writeFileSync(join(d, LOCK_FILE), JSON.stringify({ pid: 2 ** 22 + 4242, host: hostname(), at: 'then' }));
    const go = Date.now() + 400;
    const script = `import { acquireRunLock } from ${JSON.stringify(lockMod)};
      while (Date.now() < ${go}) {}
      try { acquireRunLock(${JSON.stringify(d)}); console.log('HELD'); setTimeout(() => {}, 300); } catch { console.log('LOCKED'); }`;
    const outs = await Promise.all([0, 1, 2].map(() => new Promise(res => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', script]);
      let o = ''; c.stdout.on('data', b => { o += b; }); c.on('close', () => res(o.trim()));
    })));
    assert.equal(outs.filter(o => o === 'HELD').length, 1, `trial ${trial}: ${outs.join(',')}`);
  }
});

test('cli #5: a run that crashes mid-stage exits 16 with STOPPED-error.md, not 1 with a raw stack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crash-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  // An ollama builder on a port nothing listens on: refused before sending, retried, then thrown.
  writeFileSync(join(dir, 'chains', 'dead.json'), JSON.stringify({
    name: 'dead', maxRounds: 1, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'ollama', model: 'm', baseUrl: 'http://127.0.0.1:9/v1' },
      reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-passer' }] },
  }));
  const r = cliRun(dir, ['--task', 'tasks/x.md', '--chain', 'dead']);
  assert.equal(r.status, 16, r.stdout + r.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  assert.match(readFileSync(join(run, 'STOPPED-error.md'), 'utf8'), /Run stopped/);
});

test('providers #2: a 200 whose body is an error object is reported as the provider\'s error, not an empty reply', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid api key', code: 401 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(call('ollama', { model: 'm', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 5, baseUrl: 'http://127.0.0.1:9/v1' }), /invalid api key/);
  } finally { globalThis.fetch = real; }
});

test('metrics #4: a corrupt report.json is not called complete', () => {
  const runs = mkdtempSync(join(tmpdir(), 'corrupt-'));
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(join(runs, id));
  writeFileSync(join(runs, id, 'report.json'), '{"chain": "c", "tot');
  const r = spendReport(runs, { days: 1 });
  assert.equal(r.runs.length, 1);
  assert.notEqual(r.runs[0].state, 'complete');
});

// ---- replay/status audit (Review/PreRelease_Audit_replay_2026-09-23.md) ----
test('replay HIGH: --replay writes the full report.json contract and a BOARD.md, like the run it replays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-shape-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  assert.equal(cliRun(dir, ['--task', 'tasks/x.md', '--chain', 'mock-debate']).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0];
  const r = cliRun(dir, ['--replay', join('runs', id), '--replay-date', '2026-09-24']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const original = JSON.parse(readFileSync(join(dir, 'runs', id, 'report.json'), 'utf8'));
  const replayDir = join(dir, 'runs', `${id}.replay-2026-09-24`);
  const replay = JSON.parse(readFileSync(join(replayDir, 'report.json'), 'utf8'));
  const missing = Object.keys(original).filter(k => !(k in replay) && !['runId', 'fromRun', 'maxUsd'].includes(k));
  assert.deepEqual(missing, [], `replay report is missing ${missing.join(', ')}`);
  assert.ok(readdirSync(replayDir).includes('BOARD.md'));
});

test('replay #2: a rematch keeps roster.criteria_seat pointing at the same model after relabelling', async () => {
  const { reshuffleSeats } = await import('../src/rematch.js');
  const { findSeatByLab } = await import('../src/chain.js');
  const config = { seats: { critics: [{ provider: 'mock', model: 'A', lab: 'mock-a' }, { provider: 'mock', model: 'B', lab: 'mock-b' }, { provider: 'mock', model: 'C', lab: 'mock-c' }] }, roster: { criteria_seat: 'mock-a' } };
  for (const seed of [1, 2, 5]) {
    const r = reshuffleSeats(config, seed);
    assert.equal(findSeatByLab(r, r.roster.criteria_seat)?.model, 'A', `seed ${seed}`);
  }
});

test('status #2 / replay: MCP safeRun shape accepts rematch and replay folders and nothing path-like', () => {
  const RUN_FOLDER = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2}))?$/;
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/mcp/server.js'), 'utf8');
  assert.ok(src.includes(RUN_FOLDER.source), 'server.js uses the run-folder shape');
  for (const ok of ['2026-09-23T10-06-06-899Z', '2026-09-23T10-06-06-899Z.rematch-5', '2026-09-23T10-06-06-899Z.replay-2026-09-24']) assert.ok(RUN_FOLDER.test(ok), ok);
  for (const bad of ['../x', '2026-09-23T10-06-06-899Z/../x', '2026-09-23T10-06-06-899Z.rematch-5/..']) assert.ok(!RUN_FOLDER.test(bad), bad);
});

test('replay #3/#4: a bad run.json is a clean exit 2, and a repeated seed or same-day replay is refused, not re-paid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'side-dup-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  assert.equal(cliRun(dir, ['--task', 'tasks/x.md', '--chain', 'mock']).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0];
  assert.equal(cliRun(dir, ['--rematch', join('runs', id), '--rematch-seed', '4']).status, 0);
  const again = cliRun(dir, ['--rematch', join('runs', id), '--rematch-seed', '4']);
  assert.equal(again.status, 2, again.stderr);
  assert.equal(cliRun(dir, ['--replay', join('runs', id), '--replay-date', '2026-09-24']).status, 0);
  assert.equal(cliRun(dir, ['--replay', join('runs', id), '--replay-date', '2026-09-24']).status, 2);
  writeFileSync(join(dir, 'runs', id, 'run.json'), '{"chain": "mo');
  for (const args of [['--rematch', join('runs', id), '--rematch-seed', '9'], ['--replay', join('runs', id), '--replay-date', '2026-09-25']]) {
    const r = cliRun(dir, args);
    assert.equal(r.status, 2, r.stderr);
    assert.doesNotMatch(r.stderr, /at .*\.js:\d+/, 'no raw stack');
  }
});
