// The stop rule (0.8.1 plan M6, decided rule 6, DR-10, persistence P8, P9, P17, P20): exit 18 means "stopped before finishing" by a
// person, a client or a wall clock; the run writes report-partial.json, BOARD-partial.md where there is a board, STOPPED-<cause>.json
// and state.json; an advice call is not resumed. Mock seats only, $0: the stops are STOP files the test writes and mock calls slowed
// with COUNCIL_MOCK_DELAY_MS / COUNCIL_MOCK_PRESTART_MS, so each case is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stoppedRun } from '../scripts/stop-fixtures.mjs';
import { runResumability, deriveRunStatus } from '../src/run-status.js';
import { readRun } from '../src/api.js';
import { stopState } from '../src/handoff-from-run.js';
import { spendReport } from '../src/spend.js';
import { readStopRequest } from '../src/stop-files.js';
import { readLedger } from '../src/gate-ledger.js';
import { requestGate } from '../src/gate.js';
import { gateSeatsOf } from '../src/send-path-refusals.js';
import { renderPartialBoardMd } from '../src/report-shape.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const has = (dir, f) => existsSync(join(dir, f));

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-stop-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# Advice\n\nShould the note list keep ticked items or remove them?\n');
  return dir;
}
// A person's own terminal run of a mock advice chain, started in the background.
function start(dir, id, { chain = 'mock-advise-standard', env = {} } = {}) {
  const child = spawn(process.execPath, [cli, '--chain', chain, '--task', 'tasks/t.md', '--run-id', id], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env } });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return { runDir: join(dir, 'runs', id), done: new Promise(r => child.on('exit', code => r({ code, out }))) };
}
async function until(pred, ms = 20_000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(50); } return false; }
const logOf = runDir => { try { return readFileSync(join(runDir, 'run.log'), 'utf8'); } catch { return ''; } };
const stop = (runDir, by, run) => writeFileSync(join(runDir, 'STOP'), `${JSON.stringify({ schema: 'stop/1', by, run, at: new Date().toISOString() })}\n`);
// Never the generic error path (plan test 8): no exit 16, no STOPPED-error.
const notAnError = (r, runDir) => { assert.notEqual(r.code, 16, r.out); assert.ok(!has(runDir, 'STOPPED-error.md') && !has(runDir, 'STOPPED-error.json')); };

for (const cause of ['client_cancel', 'user']) {
  test(`${cause}: stopped while the blind calls are in flight: the four answers are kept, no debate, exit 18, report-partial.json, STOPPED-${cause}.json, the golden board`, async () => {
    const r = await stoppedRun(cause);
    assert.equal(r.code, 18);
    notAnError(r, r.runDir);
    assert.ok(!has(r.runDir, 'report.json'), 'a stopped run is not finished');
    const p = readJson(join(r.runDir, 'report-partial.json'));
    assert.equal(p.partial, true); assert.equal(p.stoppedBy, cause);
    assert.equal(p.advise.status, 'stopped');
    assert.equal(p.advise.seats_answered, 4, 'every call in flight finished and was recorded');
    assert.equal(p.advise.debate.rounds_run, 0, 'the debate did not start');
    assert.equal(p.advise.synthesis.flag, `skipped_${cause}`);
    const m = readJson(join(r.runDir, `STOPPED-${cause}.json`));
    assert.deepEqual([m.schema, m.stoppedBy, m.beforeFirstCall, m.resumeAfterStop], ['stopped/1', cause, false, false]);
    assert.equal(readJson(join(r.runDir, 'state.json')).phase, `${cause}_stopped`);
    const log = readJson(join(r.runDir, 'advise-log.json'));
    assert.equal(log.status, 'stopped'); assert.equal(log.stopped_by, cause);
    // P20: the board names the actual cause and equals its golden file.
    assert.equal(readFileSync(join(r.runDir, 'BOARD-partial.md'), 'utf8'), readFileSync(join(root, 'test', 'fixtures', 'stop', `BOARD-partial-${cause}.md`), 'utf8'));
  });
}

test('wall_clock: the deadline passes inside the synthesis call: the call is cut off (no_reply), the blind answers and the debate are kept, exit 18, the golden board', async () => {
  const r = await stoppedRun('wall_clock');
  assert.equal(r.code, 18);
  notAnError(r, r.runDir);
  const p = readJson(join(r.runDir, 'report-partial.json'));
  assert.equal(p.stoppedBy, 'wall_clock'); assert.equal(p.advise.status, 'stopped');
  assert.equal(p.advise.seats_answered, 4);
  assert.equal(p.advise.debate.rounds_run, 1, 'the debate finished before the deadline');
  assert.equal(p.advise.synthesis.flag, 'no_reply', 'the synthesis call was cut at the deadline');
  assert.deepEqual([readJson(join(r.runDir, 'STOPPED-wall_clock.json')).beforeFirstCall, readJson(join(r.runDir, 'state.json')).phase], [false, 'wall_clock_stopped']);
  assert.equal(readFileSync(join(r.runDir, 'BOARD-partial.md'), 'utf8'), readFileSync(join(root, 'test', 'fixtures', 'stop', 'BOARD-partial-wall_clock.md'), 'utf8'));
});

test('review D1: a stop that leaves no readable answer still ends at exit 18, not at the error path: a skipped retry, and a call the wall clock cut', async () => {
  // A person's stop while a one-seat call's first reply is unreadable: the retry is skipped, the seat is a dropout.
  const dir = project(); const id = '2026-10-03T07-00-00-007Z';
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-single.json'), 'utf8'));
  c.name = 'mock-unreadable-one'; c.seats.critics = [{ provider: 'mock', model: 'mock-unreadable', lab: 'solo' }];
  writeFileSync(join(dir, 'chains', 'mock-unreadable-one.json'), JSON.stringify(c));
  const s = start(dir, id, { chain: 'mock-unreadable-one', env: { COUNCIL_MOCK_DELAY_MS: '1500' } });
  assert.ok(await until(() => /Stage: advice/.test(logOf(s.runDir))));
  stop(s.runDir, 'user', id);
  const r = await s.done;
  assert.equal(r.code, 18, r.out);
  notAnError(r, s.runDir);
  const m = readJson(join(s.runDir, 'STOPPED-user.json'));
  assert.equal(m.beforeFirstCall, false);
  const p = readJson(join(s.runDir, 'report-partial.json'));
  assert.equal(p.advise ?? null, null, 'no readable answer was kept');
  assert.equal(p.dropouts.length, 1);
  assert.ok(!has(s.runDir, 'BOARD-partial.md'));
  // A one-seat call whose wall clock passes while its only call is still running: the call is cut, the run is stopped by the clock.
  const dir2 = project(); const id2 = '2026-10-03T07-00-00-008Z';
  const w = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-single.json'), 'utf8'));
  w.name = 'mock-wall-one'; w.advise.max_wall_ms = 1000;
  writeFileSync(join(dir2, 'chains', 'mock-wall-one.json'), JSON.stringify(w));
  const r2 = await start(dir2, id2, { chain: 'mock-wall-one', env: { COUNCIL_MOCK_DELAY_MS: '2500' } }).done;
  assert.equal(r2.code, 18, r2.out);
  notAnError(r2, join(dir2, 'runs', id2));
  assert.equal(readJson(join(dir2, 'runs', id2, 'report-partial.json')).stoppedBy, 'wall_clock');
});

test('a stop before the first call: exit 18, nothing spent, a partial report with no paid results, STOPPED-user.json with beforeFirstCall: true (council stop)', async () => {
  const dir = project(); const id = '2026-10-03T07-00-00-001Z';
  const s = start(dir, id, { chain: 'mock-advise-single', env: { COUNCIL_MOCK_PRESTART_MS: '3000' } });
  assert.ok(await until(() => has(s.runDir, 'run.json')));
  const asked = spawnSync(process.execPath, [cli, 'stop', `runs/${id}`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(asked.status, 0, asked.stderr);
  const r = await s.done;
  assert.equal(r.code, 18, r.out);
  notAnError(r, s.runDir);
  const p = readJson(join(s.runDir, 'report-partial.json'));
  assert.equal(p.stoppedBy, 'user');
  assert.equal(p.totals.usd, 0);
  assert.equal(p.advise ?? null, null, 'no paid results (the report leaves the empty advise object out)');
  assert.equal(readdirSync(s.runDir).filter(f => f.endsWith('.usage.json')).length, 0);
  const m = readJson(join(s.runDir, 'STOPPED-user.json'));
  assert.equal(m.beforeFirstCall, true); assert.equal(m.spentUsd, 0);
  assert.ok(!has(s.runDir, 'BOARD-partial.md'), 'nothing was paid for, so there is no board');
  // council stop refuses what it cannot stop
  const again = spawnSync(process.execPath, [cli, 'stop', `runs/${id}`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(again.status, 2); assert.match(again.stderr, /already ended/);
});

test('a stopped advice run is not resumed: --resume refuses it (resumeAfterStop false), runResumability says not resumable, resume_run refuses it', async () => {
  const r = await stoppedRun('user');
  const st = runResumability(r.runDir, readJson(join(r.runDir, 'run.json')));
  assert.deepEqual([st.status, st.resumable, st.stoppedBy], ['user_stopped', false, 'user']);
  assert.notEqual(st.reason, 'process_gone');
  const resumed = spawnSync(process.execPath, [cli, '--resume', `runs/${r.runDir.split('/').pop()}`], { cwd: r.dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: r.dir } });
  assert.equal(resumed.status, 2, resumed.stdout + resumed.stderr);
  assert.match(resumed.stderr, /resumeAfterStop: false/);
  assert.ok(has(r.runDir, 'report-partial.json') && has(r.runDir, 'STOPPED-user.json'), 'a refused resume removes nothing');
  // over MCP
  const mcp = spawnSync(process.execPath, [cli, '--mcp'], { cwd: r.dir, encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, HOME: r.dir },
    input: [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'resume_run', arguments: { run: r.runDir.split('/').pop() } } }].map(x => JSON.stringify(x)).join('\n') + '\n' });
  assert.match(mcp.stdout, /this is an advice run, which is not resumed over MCP/);
});

test('a STOP file that cannot be read still stops the run, as a person\'s stop (P8)', async () => {
  const dir = project(); const id = '2026-10-03T07-00-00-002Z';
  const s = start(dir, id, { chain: 'mock-advise-single', env: { COUNCIL_MOCK_PRESTART_MS: '2500' } });
  assert.ok(await until(() => has(s.runDir, 'run.json')));
  writeFileSync(join(s.runDir, 'STOP'), 'please stop {');
  assert.deepEqual(readStopRequest(s.runDir, id), { by: 'user', corrupt: true });
  const r = await s.done;
  assert.equal(r.code, 18, r.out);
  assert.equal(readJson(join(s.runDir, 'report-partial.json')).stoppedBy, 'user');
});

test('a STOP left for another run id is stale and does not stop this run', async () => {
  const dir = project(); const id = '2026-10-03T07-00-00-003Z';
  const s = start(dir, id, { chain: 'mock-advise-single', env: { COUNCIL_MOCK_PRESTART_MS: '2000' } });
  assert.ok(await until(() => has(s.runDir, 'run.json')));
  stop(s.runDir, 'user', '2026-10-03T00-00-00-000Z');
  assert.equal(readStopRequest(s.runDir, id), null);
  const r = await s.done;
  assert.equal(r.code, 0, r.out);
  assert.ok(has(s.runDir, 'report.json') && !has(s.runDir, 'report-partial.json'));
});

test('two parallel blind calls in flight when the stop arrives: both finish and are recorded, neither seat is a dropout, the run does not finish normally', async () => {
  const dir = project(); const id = '2026-10-03T07-00-00-004Z';
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-standard.json'), 'utf8'));
  c.name = 'mock-two'; c.seats.critics = c.seats.critics.slice(0, 2);
  writeFileSync(join(dir, 'chains', 'mock-two.json'), JSON.stringify(c));
  const s = start(dir, id, { chain: 'mock-two', env: { COUNCIL_MOCK_DELAY_MS: '1500' } });
  assert.ok(await until(() => /Stage: advice/.test(logOf(s.runDir))));
  stop(s.runDir, 'user', id);
  const r = await s.done;
  assert.equal(r.code, 18, r.out);
  notAnError(r, s.runDir);
  const p = readJson(join(s.runDir, 'report-partial.json'));
  assert.equal(p.advise.seats_answered, 2);
  assert.deepEqual(p.advise.dropouts, []);
  assert.ok(!/SEAT_UNREACHABLE|unreachable/i.test(logOf(s.runDir)));
  for (const lab of c.seats.critics.map(x => x.lab)) assert.ok(has(s.runDir, `advise-${lab}.usage.json`), `${lab} recorded`);
  assert.ok(!has(s.runDir, 'report.json'));
});

test('every reader gives a stopped advice run the right answer: run status, the API record, the MCP summary and answer, the handoff status, spend', async () => {
  const r = await stoppedRun('client_cancel');
  const id = r.runDir.split('/').pop();
  assert.equal(deriveRunStatus(r.runDir, readJson(join(r.runDir, 'run.json'))), 'client_cancel_stopped');
  const api = readRun(r.runDir);
  assert.equal(api.status, 'client_cancel_stopped');
  assert.equal(api.stop.stoppedBy, 'client_cancel'); assert.equal(api.budgetStop, null);
  assert.match(stopState(r.runDir).reason, /stopped by its client/);
  const row = spendReport(join(r.dir, 'runs'), { days: 3650, now: Date.parse('2026-10-04T00:00:00Z') }).runs.find(x => x.id === id);
  assert.equal(row.state, 'stopped: by its client');
  const mcp = spawnSync(process.execPath, [cli, '--mcp'], { cwd: r.dir, encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, HOME: r.dir },
    input: [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run_status', arguments: { run: id } } }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_runs', arguments: {} } }].map(x => JSON.stringify(x)).join('\n') + '\n' });
  const byId = Object.fromEntries(mcp.stdout.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m?.id).map(m => [m.id, m]));
  // run_status answers with what was paid for, wrapped like any advice answer, and says it was stopped
  const ans = byId[2].result.structuredContent;
  assert.equal(ans.kind, 'advice'); assert.equal(ans.stopped, true); assert.equal(ans.stopped_by, 'client_cancel'); assert.equal(ans.seats_answered, 4);
  const listed = JSON.parse(byId[3].result.content[0].text).find(x => x.id === id);
  assert.equal(listed.status, 'client_cancel_stopped');
  assert.match(listed.state, /stopped by its client after paid calls/);
});

test('the budget stop keeps its exit code, its files and its board header (regression)', () => {
  const dir = project(); const id = '2026-10-03T07-00-00-005Z';
  const r = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', id], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const runDir = join(dir, 'runs', id);
  assert.ok(has(runDir, 'STOPPED-budget.json') && has(runDir, 'STOPPED-budget.md'));
  assert.equal(readJson(join(runDir, 'report-partial.json')).stoppedBy, 'budget');
  // mock-budget writes no board, so the budget header is pinned on the renderer itself: 0.7.7's words, unchanged by M6.
  assert.equal(renderPartialBoardMd({ runId: 'r', result: { board: 'the board' }, stoppedAtStage: 'build' }).split('\n')[0], '> **Partial board.** This run stopped at its spend cap before stage `build` and did not finish. The same record as data: `report-partial.json`.');
  assert.equal(deriveRunStatus(runDir, readJson(join(runDir, 'run.json'))), 'budget_stopped');
  for (const cause of ['user', 'client_cancel', 'wall_clock']) assert.ok(!has(runDir, `STOPPED-${cause}.json`));
});

// The terminal channel through a real pseudo-terminal (python3's pty module), as in test/send-path.test.js.
const hasPython = spawnSync('python3', ['-c', 'import pty'], { encoding: 'utf8' }).status === 0;
test('an adopted call that is stopped records `stopped` in its gate ledger after its `sent` line', { skip: !hasPython && 'python3 is not installed' }, async () => {
  const dir = project(); const id = '2026-10-03T07-00-00-006Z';
  const run = join(dir, 'runs', id); mkdirSync(run, { recursive: true });
  const text = '# A brief\n\nShould we keep the legacy invoices column?\n';
  const sha = createHash('sha256').update(text).digest('hex');
  writeFileSync(join(run, 'advice-brief.md'), text);
  writeFileSync(join(run, 'advice.meta.json'), JSON.stringify({ schema: 'advice-meta/1', quote_id: `q_${'1'.repeat(24)}`, chain: 'mock-advise-single', gate: 'g1', brief_sha256: sha, mode: 'single', advisor: 'sol', effective_sensitivity: 'internal', question_hash: sha.slice(0, 16), question_words: [sha.slice(0, 8)], has_new_evidence: false, quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: 1 }, previous_run: null, dispositions: [] }));
  const g = requestGate(run, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 1 }, seats: gateSeatsOf(readJson(join(root, 'chains', 'mock-advise-single.json'))), sensitivity: { label: 'internal', set_by: 'test' } });
  assert.ok(g.ok, g.message);
  const py = "import os, pty, sys\npid, fd = pty.fork()\nif pid == 0:\n    os.chdir(sys.argv[1]); os.execv(sys.argv[2], sys.argv[2:])\nout = b''; sent = False\nwhile True:\n    try: b = os.read(fd, 4096)\n    except OSError: break\n    if not b: break\n    out += b\n    if not sent and b'[y/N]' in out:\n        os.write(fd, b'y\\n'); sent = True\n_, status = os.waitpid(pid, 0)\nsys.exit(os.waitstatus_to_exitcode(status))\n";
  assert.equal(spawnSync('python3', ['-c', py, dir, process.execPath, cli, 'gate', 'answer', `runs/${id}`, 'g1'], { encoding: 'utf8', timeout: 60_000 }).status, 0);
  // Before its start, `council stop` refuses: the person declines the gate instead (M6 review D5).
  const early = spawnSync(process.execPath, [cli, 'stop', `runs/${id}`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(early.status, 2); assert.match(early.stderr, /has not started .* --decline/);
  // The adopted call runs; a person stops it while its call is in flight.
  const child = spawn(process.execPath, [cli, '--advice-adopt', `runs/${id}`], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVISE_COOLDOWN_MS: '0', COUNCIL_MOCK_DELAY_MS: '1500' } });
  const code = new Promise(res => child.on('exit', res));
  assert.ok(await until(() => /Stage: advice/.test(logOf(run))));
  assert.equal(spawnSync(process.execPath, [cli, 'stop', `runs/${id}`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } }).status, 0);
  assert.equal(await code, 18);
  const events = readLedger(run).lines.map(l => l.event);
  assert.deepEqual(events.slice(-2), ['sent', 'stopped']);
  assert.equal(readLedger(run).lines.at(-1).stoppedBy, 'user');
});
