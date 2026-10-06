// test/resumability.test.js
//
// 0.8.0 WM0 items 4 and 7. Which stopped runs can be continued, and what it takes, read off the marker
// files the CLI leaves (src/run-status.js runResumability); STOPPED-error.json says what an error
// stop was and whether asking again could work; and state.json at rest says what the run is now,
// not the "running" its last progress event wrote. Offline: mock chains and a loopback stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResumability } from '../src/run-status.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-09-28T14-00-00-000Z';
const env = extra => ({ PATH: process.env.PATH, HOME: tmpdir(), ...extra });
const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-resumable-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  return dir;
};
const run = (dir, args, e = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: env(e), timeout: 60_000 });
const rd = dir => join(dir, 'runs', RUN);
const readJson = (dir, f) => JSON.parse(readFileSync(join(rd(dir), f), 'utf8'));
const stat = dir => runResumability(rd(dir), readJson(dir, 'run.json'));

test('a run the spend cap stopped: resumable with a higher cap; state.json no longer says running', () => {
  const dir = workspace();
  const r = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', RUN]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const s = stat(dir);
  assert.deepEqual([s.status, s.resumable, s.reason, s.needs], ['budget_stopped', true, 'budget', 'higher_cap']);
  assert.equal(s.stoppedAt.stoppedAt, 'build');
  assert.equal(readJson(dir, 'state.json').phase, 'budget_stopped');
  assert.equal(readJson(dir, 'state.json').stage, null);
});

test('a run paused at an external seat: resumable once each waiting stage is answered', () => {
  const dir = workspace();
  const r = run(dir, ['--chain', 'mock-external', '--task', 'tasks/t.md', '--run-id', RUN]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const s = stat(dir);
  assert.deepEqual([s.status, s.resumable, s.reason, s.needs, s.waiting], ['paused', true, 'external_pause', 'answer', ['build']]);
  const state = readJson(dir, 'state.json');
  assert.equal(state.phase, 'paused');
  assert.deepEqual(state.waiting, ['build']);
});

test('a run that crashed at a seat with no reply: STOPPED-error.json names it, and says it will fail the same way', () => {
  const dir = workspace();
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  cfg.name = 'broken';
  cfg.seats.builder = { provider: 'mock', model: 'mock-network-error' };
  writeFileSync(join(dir, 'chains', 'broken.json'), JSON.stringify(cfg));
  const r = run(dir, ['--chain', 'broken', '--task', 'tasks/t.md', '--run-id', RUN]);
  assert.equal(r.status, 16, r.stdout + r.stderr);
  const e = readJson(dir, 'STOPPED-error.json');
  assert.equal(e.exitCode, 16);
  assert.equal(e.kind, 'error');
  assert.equal(typeof e.message, 'string');
  const s = stat(dir);
  assert.deepEqual([s.status, s.resumable, s.needs], ['failed', true, 'fix_cause']);
  assert.equal(readJson(dir, 'state.json').phase, 'failed');
});

test('a provider that kept answering 503: the error stop is marked transient, so asking again may work', async () => {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 503; res.setHeader('retry-after', '0'); res.end('down'); }); });
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  try {
    const dir = workspace();
    const seat = { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, lab: 'a' };
    writeFileSync(join(dir, 'chains', 'down.json'), JSON.stringify({ name: 'down', maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [{ ...seat, lab: 'b' }] } }));
    const child = spawn(process.execPath, [cli, '--chain', 'down', '--task', 'tasks/t.md', '--run-id', RUN], { cwd: dir, env: env({ OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }), stdio: 'ignore' });
    const code = await new Promise(done => child.on('exit', done));
    assert.equal(code, 16);
    const e = readJson(dir, 'STOPPED-error.json');
    assert.equal(e.httpStatus, 503);
    assert.equal(e.transient, true);
    assert.equal(stat(dir).reason, 'error_transient');
  } finally { srv.close(); }
});

test('the other markers: truncated draft, refused task, a process that died, a finished run', () => {
  const at = (files, meta = { pid: spawnSync(process.execPath, ['-e', '0']).pid }) => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-resumable-synth-'));
    for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body);
    return runResumability(dir, meta);
  };
  const cut = at({ 'STOPPED-truncated.json': JSON.stringify({ stage: 'build' }) });
  assert.deepEqual([cut.resumable, cut.reason, cut.needs, cut.stoppedAt.stage], [true, 'draft_truncated', 'raise_max_tokens', 'build']);
  const pre = at({ 'STOPPED-preflight.md': '# stopped' });
  assert.deepEqual([pre.resumable, pre.reason, pre.needs], [false, 'preflight_blocked', 'fix_task']);
  const gone = at({ 'run.log': 'chain: x\n' });
  assert.deepEqual([gone.status, gone.resumable, gone.reason, gone.needs], ['stopped', true, 'process_gone', 'nothing']);
  const done = at({ 'report.json': '{}' });
  assert.deepEqual([done.status, done.resumable, done.reason], ['done', false, 'finished']);
  const blocked = at({ 'BLOCKED-ARTIFACTS.md': '# x' });
  assert.deepEqual([blocked.resumable, blocked.reason, blocked.needs], [true, 'artifacts_blocked', 'fix_task']);
  const live = at({ 'run.log': 'x' }, { pid: process.pid });
  assert.deepEqual([live.status, live.resumable], ['running', false]);
});

test('a run stopped by a stale marker does not keep it: resuming clears STOPPED-error.json and the rest', () => {
  const dir = workspace();
  const first = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', RUN]);
  assert.equal(first.status, 4);
  writeFileSync(join(rd(dir), 'STOPPED-error.json'), '{}');
  const r = run(dir, ['--resume', `runs/${RUN}`, '--max-usd', 'none']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!existsSync(join(rd(dir), 'STOPPED-error.json')));
  assert.equal(readJson(dir, 'state.json').phase, 'done');
});

test('0.8.1 M6: a stopped run resumes only if its chain said resumeAfterStop: true, as recorded in its marker; an unreadable marker does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-resumable-stop-'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'x', pid: 999999 }));
  writeFileSync(join(dir, 'STOPPED-wall_clock.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'wall_clock', beforeFirstCall: false, resumeAfterStop: false }));
  let s = runResumability(dir, { chain: 'x', pid: 999999 });
  assert.deepEqual([s.status, s.resumable, s.reason, s.stoppedBy], ['wall_clock_stopped', false, 'wall_clock_stopped', 'wall_clock']);
  writeFileSync(join(dir, 'STOPPED-wall_clock.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'wall_clock', resumeAfterStop: true }));
  s = runResumability(dir, { chain: 'x', pid: 999999 });
  assert.deepEqual([s.resumable, s.needs], [true, 'nothing'], 'a chain that allows it (a planning chain in a later release)');
  writeFileSync(join(dir, 'STOPPED-wall_clock.json'), '{ torn');
  s = runResumability(dir, { chain: 'x', pid: 999999 });
  assert.equal(s.resumable, false);
  assert.notEqual(s.reason, 'process_gone');
});

test('0.8.1 decided rule 6 (M6 review D3): an advice call is never offered a resume, whatever ended it: an error, its cap, a crash', () => {
  for (const marker of ['STOPPED-error.json', 'STOPPED-budget.json', null]) {
    const dir = mkdtempSync(join(tmpdir(), 'thc-resumable-advice-'));
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'advise-single', pid: 999999 }));
    writeFileSync(join(dir, 'advise-log.json'), JSON.stringify({ schema: 'advise-log/1' }));
    if (marker) { writeFileSync(join(dir, marker), '{}'); if (marker === 'STOPPED-error.json') writeFileSync(join(dir, 'STOPPED-error.md'), '# x\n'); }
    const s = runResumability(dir, { chain: 'advise-single', pid: 999999 });
    assert.deepEqual([s.resumable, s.reason], [false, 'advice_call'], String(marker));
  }
});
