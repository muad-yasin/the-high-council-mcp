// The reservation record (0.8.2 item 8b; ChatGPT review 1 #4c; owner 7 Oct 2026; C&C: a killed process must not lap the cap): invoke() persists a paid call's worst case BEFORE it sends, settles it when the call
// returns or throws, and an unsettled one stays charged on resume and in the spend figures. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { openReservations, unsettledReservations, unsettledUsd, RESERVATIONS_FILE } from '../src/spend-reservations.js';
import { runSingleStage, setBudget, setReservationSink, budgetState } from '../src/chain.js';
import { runSpentUsd, spendReport } from '../src/spend.js';
import { budgetOf } from '../src/run-budget.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const tmp = () => mkdtempSync(join(tmpdir(), 'thc-res-'));
const lines = d => readFileSync(join(d, RESERVATIONS_FILE), 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
const PRICED = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500 };

test('the record: reserve, then settle; ids continue after a resume; torn, corrupt and foreign lines read as nothing; a missing file reads as none; only amounts, label, seat and times are written', () => {
  const d = tmp();
  assert.deepEqual(unsettledReservations(d), [], 'no file: no reservations');
  const sink = openReservations(d);
  const a = sink.reserve({ label: 'panel-1-x', seat: 'p/m', usd: 0.5 });
  const b = sink.reserve({ label: 'panel-1-y', seat: 'p/m', usd: 1.5 });
  assert.deepEqual([a, b], ['r1', 'r2']);
  assert.deepEqual(unsettledReservations(d).map(r => r.id), ['r1', 'r2']);
  sink.settle(a, { outcome: 'recorded', usd: 0.4 });
  assert.deepEqual(unsettledReservations(d).map(r => r.id), ['r2']);
  assert.equal(unsettledUsd(d), 1.5);
  // a resumed process opens the same file: its ids go on from the file
  assert.equal(openReservations(d).reserve({ label: 'z', seat: 'p/m', usd: 2 }), 'r3');
  // what is on disk (read before junk is appended below)
  for (const l of lines(d)) assert.deepEqual(Object.keys(l).filter(k => !['schema', 'event', 'id', 'label', 'seat', 'usd', 'outcome', 'at'].includes(k)), [], 'no other field is ever written');
  // junk never throws and never counts: a torn last line, a corrupt line, a foreign schema, a non-positive amount
  appendFileSync(join(d, RESERVATIONS_FILE), 'not json\n{"schema":"other/1","event":"reserved","id":"r9","usd":9}\n{"schema":"spend-reservations/1","event":"reserved","id":"r8","usd":-1}\n{"schema":"spend-reservations/1","event":"reserved","id":"r7","usd":5');
  assert.deepEqual(unsettledReservations(d).map(r => r.id), ['r2', 'r3']);
});

test('invoke(): the reservation is on disk BEFORE the request is sent, and settled with the real cost when the call returns', async () => {
  const d = tmp(); let seenAtSend = null;
  const srv = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      seenAtSend = existsSync(join(d, RESERVATIONS_FILE)) ? lines(d) : [];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  try {
    setBudget(50); setReservationSink(openReservations(d));
    const r = await runSingleStage({ ...PRICED, baseUrl: `http://127.0.0.1:${srv.address().port}` }, { system: 's', user: 'u', label: 'one' });
    assert.equal(seenAtSend.length, 1, 'one line at send time');
    assert.equal(seenAtSend[0].event, 'reserved'); assert.equal(seenAtSend[0].label, 'one'); assert.ok(seenAtSend[0].usd > 0);
    const all = lines(d);
    assert.deepEqual(all.map(l => l.event), ['reserved', 'settled']);
    assert.equal(all[1].outcome, 'recorded'); assert.equal(all[1].usd, r.usd);
    assert.deepEqual(unsettledReservations(d), [], 'a call that settled leaves nothing charged');
    assert.equal(budgetState().reserved, 0);
  } finally { setReservationSink(null); setBudget(null); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; srv.close(); }
});

test('invoke(): a call that fails settles as failed; a reservation that cannot be written means the call is NOT sent; a $0 projection and mock runs write nothing', async () => {
  const d = tmp(); let hits = 0;
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { hits++; res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end('{"error":{"message":"bad request"}}'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'd'.repeat(40);
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  try {
    setBudget(50); setReservationSink(openReservations(d));
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl }, { system: 's', user: 'u', label: 'bad' }));
    assert.deepEqual(lines(d).map(l => `${l.event}:${l.outcome ?? ''}`), ['reserved:', 'settled:failed']);
    assert.deepEqual(unsettledReservations(d), []);
    // the sink cannot write: fail closed, nothing is sent
    hits = 0;
    setReservationSink({ reserve() { throw new Error('disk full'); }, settle() {} });
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl }, { system: 's', user: 'u', label: 'nowrite' }), /disk full/);
    assert.equal(hits, 0, 'the call was not sent');
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl }, { system: 's', user: 'u', label: 'nowrite2' }), err => err.controlFlow === true, 'no catch may turn an unwritable reservation into an abstention');
    assert.equal(budgetState().reserved, 0, 'the in-memory reservation was released');
    // mock runs: no projected dollars, no file
    const d2 = tmp(); setReservationSink(openReservations(d2));
    await runSingleStage({ provider: 'mock', model: 'mock', maxTokens: 100 }, { system: 's', user: 'u', label: 'mock' });
    assert.equal(existsSync(join(d2, RESERVATIONS_FILE)), false, 'a mock run folder is unchanged');
  } finally { setReservationSink(null); setBudget(null); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; srv.close(); }
});

test('a process killed while a paid call is in flight leaves the reservation, and it stays charged: runSpentUsd and the spend report count it', async () => {
  const d = tmp(); mkdirSync(join(d, 'runs', '2026-10-07T10-00-00-000Z'), { recursive: true });
  const run = join(d, 'runs', '2026-10-07T10-00-00-000Z');
  // a server that never answers
  const srv = http.createServer((req) => { req.resume(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const script = join(d, 'child.mjs');
  writeFileSync(script, `
    import { runSingleStage, setBudget, setReservationSink } from ${JSON.stringify(join(root, 'src/chain.js'))};
    import { openReservations } from ${JSON.stringify(join(root, 'src/spend-reservations.js'))};
    setBudget(50); setReservationSink(openReservations(${JSON.stringify(run)}));
    runSingleStage({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: 'http://127.0.0.1:${srv.address().port}' }, { system: 's', user: 'u', label: 'in-flight' }).catch(() => {});
  `);
  const child = spawn(process.execPath, [script], { env: { PATH: process.env.PATH, OPENROUTER_API_KEY: 'sk-or-v1-' + 'e'.repeat(40) } });
  try {
    for (let i = 0; i < 100 && !existsSync(join(run, RESERVATIONS_FILE)); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(existsSync(join(run, RESERVATIONS_FILE)), 'the reservation was written before the call went out');
    child.kill('SIGKILL');
    await new Promise(r => child.on('exit', r));
  } finally { srv.close(); }
  const left = unsettledReservations(run);
  assert.equal(left.length, 1); assert.equal(left[0].label, 'in-flight');
  assert.ok(runSpentUsd(run) >= left[0].usd - 1e-9 && runSpentUsd(run) > 0, 'the run folder reads as having spent its worst case');
  assert.equal(spendReport(join(d, 'runs'), { days: 30, now: Date.parse('2026-10-07T20:00:00Z') }).totalUsd, left[0].usd);
});

test('a resume counts it toward the cap: `handoff --from-run` under a cap below an unsettled reservation stops at the cap before any call (exit 4); under a higher cap it goes on', () => {
  const dir = tmp(); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'plain.json'), JSON.stringify({ ...cfg, name: 'plain' }));
  writeFileSync(join(dir, 'chains', 'priced.json'), JSON.stringify({ ...cfg, name: 'priced', seats: { ...cfg.seats, handoff: { provider: 'mock', model: 'mock-priced', maxTokens: 50 } } }));
  const env = { PATH: process.env.PATH, HOME: dir };
  assert.equal(spawnSync(process.execPath, [cli, '--chain', 'plain', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 }).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0]; const run = join(dir, 'runs', id);
  appendFileSync(join(run, RESERVATIONS_FILE), `${JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id: 'r1', label: 'panel-1-x', seat: 'p/m', usd: 3, at: '2026-10-07T10:00:00.000Z' })}\n`);
  const capped = spawnSync(process.execPath, [cli, 'handoff', '--from-run', `runs/${id}`, '--chain', 'priced', '--max-usd', '2'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(capped.status, 4, capped.stdout + capped.stderr);
  assert.match(capped.stdout + capped.stderr, /already spent|spend cap/);
  assert.equal(readdirSync(run).some(f => /^HANDOFF-from-run/.test(f)), false, 'no call was made');
  const ok = spawnSync(process.execPath, [cli, 'handoff', '--from-run', `runs/${id}`, '--chain', 'priced', '--max-usd', '20'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  // the new call wrote its own reservation and settled it; the old one is still charged
  const all = readFileSync(join(run, RESERVATIONS_FILE), 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(unsettledReservations(run).map(r => r.id), ['r1']);
  assert.ok(all.some(l => l.event === 'settled' && l.id === 'r2'), 'the handoff call settled its own reservation');
});

test('--resume counts an earlier sitting\'s unsettled reservation toward the cap and says so in the log', () => {
  const dir = tmp(); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a habit tracker.\n');
  const env = { PATH: process.env.PATH, HOME: dir };
  const first = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(first.status, 4, 'mock-budget stops at the default cap: the fixture the cap tests use');
  const id = readdirSync(join(dir, 'runs'))[0]; const run = join(dir, 'runs', id);
  appendFileSync(join(run, RESERVATIONS_FILE), `${JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id: 'r900', label: 'panel-1-x', seat: 'p/m', usd: 5000, at: '2026-10-07T10:00:00.000Z' })}\n`);
  const resumed = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`, '--max-usd', '1000'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(resumed.status, 4, resumed.stdout + resumed.stderr);
  assert.match(resumed.stdout, /earlier sitting: 1 call\(s\) were in flight when the process ended and were never settled \(panel-1-x\)/);
  const again = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`, '--max-usd', '1000000'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.notEqual(again.status, 4, 'a cap above it goes on');
});

test('schemas/spend-reservations-v1.json: the lines the code writes and the committed killed-process fixture validate; the fixture reads as one unsettled call at its worst case; a bad line does not validate', async () => {
  const Ajv2020 = (await import('ajv/dist/2020.js')).default;
  const validate = new Ajv2020({ allErrors: true, allowUnionTypes: true, validateFormats: false }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'spend-reservations-v1.json'), 'utf8')));
  const d = tmp(); const sink = openReservations(d);
  const a = sink.reserve({ label: 'x', seat: 'p/m', usd: 0.5 }); sink.settle(a, { outcome: 'recorded', usd: 0.1 }); sink.settle(sink.reserve({ label: 'y', seat: 'p/m', usd: 1 }), { outcome: 'billed_unreadable', usd: 1 });
  for (const l of lines(d)) assert.equal(validate(l), true, JSON.stringify(validate.errors));
  const fix = join(root, 'test', 'fixtures', 'spend-reservations', 'run-killed');
  const whole = readFileSync(join(fix, RESERVATIONS_FILE), 'utf8').split('\n').slice(0, -1);
  for (const l of whole) assert.equal(validate(JSON.parse(l)), true, l);
  assert.deepEqual(unsettledReservations(fix), [{ id: 'r2', label: 'panel-1-glm', seat: 'openrouter/z-ai/glm-5.3-flash', usd: 1.25 }], 'the torn last line settled nothing');
  assert.equal(validate({ schema: 'spend-reservations/1', event: 'reserved', id: 'r1', at: '2026-10-07T09:00:00Z', label: 'x', seat: 'p/m', usd: 1, task: 'Plan the secret thing' }), false, 'no other field');
  assert.equal(validate({ schema: 'spend-reservations/1', event: 'reserved', id: 'r1', at: '2026-10-07T09:00:00Z', label: 'x', seat: 'p/m', usd: 0 }), false, 'a reservation is worth something');
});

test('review fixes (item 8): a torn last line is not glued onto, ids continue past it, and a killed run\'s run_status budget counts the unsettled reservation (no report.json)', () => {
  const d = tmp();
  const sink = openReservations(d);
  sink.reserve({ label: 'a', seat: 'p/m', usd: 1 });
  appendFileSync(join(d, RESERVATIONS_FILE), '{"schema":"spend-reservations/1","event":"reserved","id":"r2","label":"torn"');
  const id = openReservations(d).reserve({ label: 'b', seat: 'p/m', usd: 2 });
  assert.equal(id, 'r3', 'the torn fragment still used the id r2');
  assert.deepEqual(unsettledReservations(d).map(r => r.label).sort(), ['a', 'b'], 'the new line is its own line and reads back');
  // run_status: no report.json, a cap in run.json, one unsettled reservation of $2 and one of $1
  writeFileSync(join(d, 'run.json'), JSON.stringify({ chain: 'x', maxUsd: 10 }));
  const b = budgetOf(d, null);
  assert.equal(b.spentUsd, 3); assert.equal(b.remainingUsd, 7);
});
