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
import { DEFAULT_MAX_USD } from '../src/default-cap.js';

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
    // wait for the LINE, not only the file: openReservations creates the file (openSync 'a') a moment before the reserved line is appended, and a kill in that gap left nothing to read (seen once in 1 of ~100 suites, 14 Oct 2026)
    const reserved = () => existsSync(join(run, RESERVATIONS_FILE)) && readFileSync(join(run, RESERVATIONS_FILE), 'utf8').includes('"reserved"');
    for (let i = 0; i < 100 && !reserved(); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(reserved(), 'the reservation was written before the call went out');
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
  // CHANGED (expected-cost gate, 27 Okt 2026, owner: the gate decides on the expected case, not the worst case). OLD: the one-line task; the build's WORST case crossed the $7 default. NEW: a task of about 40,000
  // characters, so the first call's EXPECTED cost alone (~$10 at the fixture price) crosses it. WHY: on the one-line task every call now fits, and the run finishes.
  // CHANGED ACCEPTED (default cap $12, 10 Nov 2026, Muad). OLD bar: 40,000 characters (about $10, above the $7 default). NEW bar: 5,000 characters per dollar of the default cap (60,000 for $12, about $15 at the fixture price), so the first call's expected cost crosses it again and the first sitting still stops at exit 4.
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a habit tracker.\n' + 'x'.repeat(DEFAULT_MAX_USD * 5000) + '\n');
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

// ---------------------------------------------------------------------------------------------------------------------------------- 0.8.3 M2 (D18): a charge is tied to its reservation by id
import { recordLostCharge, supersededStagesOf } from '../src/superseded.js';
import { setChargeHook } from '../src/chain.js';

test('reservationId (0.8.3 M2, D18): every paid call\'s usage file, its report.json stage and its cached replay carry the id of the reserved line written before it; a mock run writes no id and no reservation', () => {
  const dir = tmp(); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a habit tracker.\n');
  const env = { PATH: process.env.PATH, HOME: dir };
  // CHANGED (expected-cost gate, 27 Okt 2026, owner: the gate decides on the expected case, not the worst case). OLD: a $9 cap, four stages in (critique-2's WORST case crossed it). NEW: $1.50, three stages in:
  // criteria, build and critique-1 fit at their EXPECTED cost, revise-1 (~$1.78 with what was spent) does not. WHY: under $9 every call now fits; no cap stops this run four stages in (revise-1's figure is above critique-2's).
  // CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026; the box prints of jobs 74, 75 and 79 on the tip and on 81cf65ac). OLD: --max-usd 1.5, and the comment above says "three stages in"; the run on 81cf65ac paid criteria and build and stopped before critique-1. NEW: 1.65, the same scenario (criteria and build paid, stop before critique-1). WHY: the gate prices a planned stage at its EXPECTED cost (the fixture seat bills $1000 per Mtok in and out: expected = the whole prompt + the typical output of the kind), and the prompts grew, not the sizing rule: build's gate was $1.230 on 81cf65ac (230 input tokens + 1000 typical output; worst case 8.230) and is $1.483 on the tip (483 + 1000; worst case 8.483): +253 input tokens, the typical output unchanged; critique-1's gate went from $1.461 to $1.618 (1161 + 300 to 1318 + 300 tokens). With criteria at $0.053 and build at $0.075 the run stops before build when the cap is below 0.053 + 1.483 = $1.536 (so $1.50 stopped it one stage in) and runs critique-1 when the cap is at least 0.128 + 1.618 = $1.746; $1.65 lies between, 11 and 10 cents from its two ends. The turn falls between 81cf65ac (the row passed) and 2bdc192a (it failed); 15 commits in that range change src/, chains/ or scripts/ (among them the wording apply f60ebad2, the held-name record dc60423a, the judges' voice frame 31ab9241 and 9e4c3e3c, the cache-shaped order 68538aa3, the persona-form switch and the lane A wiring e83cff33), and which of them grew which prompt is not traced. "Three stages in" was already untrue on 81cf65ac (two usage files, which is what the row asserts at least).
  const first = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1.65'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(first.status, 4, 'mock-budget (fixture prices) stops at a $1.65 cap, two stages in (before critique-1)');
  const id = readdirSync(join(dir, 'runs'))[0]; const run = join(dir, 'runs', id);
  const reserved = lines(run).filter(l => l.event === 'reserved');
  const settled = lines(run).filter(l => l.event === 'settled');
  const usageFiles = readdirSync(run).filter(f => f.endsWith('.usage.json') && !f.startsWith('handoff-from-run'));
  assert.ok(usageFiles.length >= 2, 'the run paid for stages before the cap stopped it');
  const paidBy = {};
  for (const f of usageFiles) {
    const u = JSON.parse(readFileSync(join(run, f), 'utf8')); const label = f.replace(/\.usage\.json$/, '');
    const r = reserved.find(x => x.id === u.reservationId);
    assert.ok(r, `${f} carries the id of a reserved line (${u.reservationId})`);
    assert.equal(r.label, label, 'the reserved line is that stage\'s own');
    const s = settled.find(x => x.id === u.reservationId);
    assert.equal(s.outcome, 'recorded'); assert.equal(s.usd, u.usd, 'the settlement and the usage file read one value');
    paidBy[label] = u.reservationId;
  }
  // resume to the end: replayed stages keep the id of the sitting that paid; new ones carry their own
  const resumed = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`, '--max-usd', '1000000'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
  const replayed = report.stages.filter(s => s.cached);
  assert.ok(replayed.length >= 2);
  for (const s of replayed) assert.equal(s.reservationId, paidBy[s.label], `${s.label}: the replay names the sitting that paid`);
  for (const s of report.stages.filter(x => !x.cached && x.usd > 0)) assert.match(s.reservationId, /^r\d+$/, `${s.label} was paid this sitting`);
  const all = new Set(lines(run).filter(l => l.event === 'reserved').map(l => l.id));
  for (const s of report.stages.filter(x => x.usd > 0)) assert.ok(all.has(s.reservationId), `${s.label}'s id is a reserved line of this run`);
  // the unpriced all-mock chain: no id anywhere, no reservations file
  const plain = tmp(); mkdirSync(join(plain, 'tasks')); writeFileSync(join(plain, 'tasks', 't.md'), 'Plan a habit tracker.\n');
  assert.equal(spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/t.md'], { cwd: plain, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: plain }, timeout: 120_000 }).status, 0);
  const prun = join(plain, 'runs', readdirSync(join(plain, 'runs'))[0]);
  assert.equal(existsSync(join(prun, RESERVATIONS_FILE)), false);
  for (const f of readdirSync(prun).filter(x => x.endsWith('.usage.json'))) assert.equal('reservationId' in JSON.parse(readFileSync(join(prun, f), 'utf8')), false, f);
  assert.equal(JSON.parse(readFileSync(join(prun, 'report.json'), 'utf8')).stages.some(s => 'reservationId' in s), false);
});

test('reservationId: a billed_unreadable charge record carries its id and kind `billed`; a call that leaves BOTH a discarded attempt\'s waste and a billed charge gives two records with one id and two kinds, and superseded stages are matched by id', async () => {
  const d = tmp();
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'f'.repeat(40);
  // a dropped 200 body: the request went out, so the call may be billed and its usage is unreadable
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end('this is not json'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  try {
    setBudget(50); setReservationSink(openReservations(d)); setChargeHook(c => recordLostCharge(d, c.label, c));
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl }, { system: 's', user: 'u', label: 'billed' }));
    const sl = lines(d).find(l => l.event === 'settled'); assert.equal(sl.outcome, 'billed_unreadable');
    const charges = supersededStagesOf(d);
    assert.equal(charges.length, 1);
    assert.deepEqual([charges[0].reservationId, charges[0].kind, charges[0].usd], [sl.id, 'billed', sl.usd]);
  } finally { srv.close(); }
  // the thinking retry: first answer cut off at its cap with all tokens spent on thinking (waste), the retry then drops its body (billed)
  const d2 = tmp(); let hits = 0;
  const srv2 = http.createServer((req, res) => { req.resume(); req.on('end', () => { hits += 1; res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (hits === 1) res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 } } }));
    else res.end('not json'); }); });
  await new Promise(r => srv2.listen(0, '127.0.0.1', r));
  try {
    setBudget(50); setReservationSink(openReservations(d2)); setChargeHook(c => recordLostCharge(d2, c.label, c));
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl: `http://127.0.0.1:${srv2.address().port}` }, { system: 's', user: 'u', label: 'both' }));
    assert.equal(hits, 2, 'the retry was sent');
    const sl = lines(d2).find(l => l.event === 'settled'); assert.equal(sl.outcome, 'billed_unreadable');
    const both = supersededStagesOf(d2);
    assert.equal(both.length, 2);
    assert.deepEqual(both.map(c => c.kind).sort(), ['billed', 'waste']);
    assert.ok(both.every(c => c.reservationId === sl.id), 'one reservation, two charge records, told apart by kind');
    assert.equal(both.find(c => c.kind === 'billed').usd, sl.usd, 'the settlement equals the billed record only');
  } finally { srv2.close(); setReservationSink(null); setBudget(null); setChargeHook(null); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

test('reservationId: `superseded[]` in report.json attributes the superseded records its total absorbed, by label, amount and reservation id', () => {
  const dir = tmp(); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a habit tracker.\n');
  const env = { PATH: process.env.PATH, HOME: dir };
  // CHANGED (expected-cost gate, 27 Okt 2026): OLD $9, NEW $1.50 (the stop three stages in, as in the test above). WHY: under $9 every call now fits at its expected cost.
  // CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026): NEW $1.65, the cap of the test above (the stop two stages in, before critique-1; derivation there). WHY: this row only needs a stop (exit 4) and a stage set aside; it stayed green at $1.50 (the stop one stage in), and its cap moves with the one it is tied to by its own comment.
  assert.equal(spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1.65'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 }).status, 4);
  const id = readdirSync(join(dir, 'runs'))[0]; const run = join(dir, 'runs', id);
  // a stage set aside and paid for again: plant a superseded record with a known id and amount, then finish the run
  mkdirSync(join(run, 'superseded'), { recursive: true });
  writeFileSync(join(run, 'superseded', 'build.1.usage.json'), JSON.stringify({ provider: 'mock', model: 'mock-priced', usage: { input: 1, output: 1 }, usd: 0.25, reservationId: 'r77' }));
  const done = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`, '--max-usd', '1000000'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
  assert.deepEqual(report.superseded, [{ label: 'superseded/build.1', usd: 0.25, reservationId: 'r77' }]);
  assert.equal(report.totals.supersededUsd, 0.25);
  const sum = report.stages.reduce((n, s) => n + s.usd, 0) + report.totals.supersededUsd;
  assert.ok(Math.abs(sum - report.totals.usd) < 1e-9, 'the identity totals.usd = sum of stages + supersededUsd holds');
  // a run with nothing superseded has no `superseded` key
  const dir2 = tmp(); mkdirSync(join(dir2, 'tasks')); writeFileSync(join(dir2, 'tasks', 't.md'), 'Plan.\n');
  assert.equal(spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/t.md'], { cwd: dir2, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir2 }, timeout: 120_000 }).status, 0);
  assert.equal('superseded' in JSON.parse(readFileSync(join(dir2, 'runs', readdirSync(join(dir2, 'runs'))[0], 'report.json'), 'utf8')), false);
});
