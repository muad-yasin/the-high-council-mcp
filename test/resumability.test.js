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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResumability } from '../src/run-status.js';
import { withMalformedKeysInProcess, malformedProviderKeys } from './helpers/no-real-keys.js';
import { mcpCalls } from './helpers/mcp-calls.js';
import { generateResumeBrief } from '../src/resume-brief.js';
import { startTyped } from './helpers/typed-cap.js';

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
    const spawnCli = args => new Promise(done => spawn(process.execPath, [cli, ...args], { cwd: dir, env: env({ OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }), stdio: 'ignore' }).on('exit', code => done({ code })));
    // 0.8.3 M6 typed cap T4a: a paid start waits for a typed limit (exit 21); startTyped types one and resumes the same run.
    const { code } = await startTyped(spawnCli, ['--chain', 'down', '--task', 'tasks/t.md', '--run-id', RUN], join(dir, 'runs', RUN));
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

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the marker was STOPPED-wall_clock.json (stoppedBy 'wall_clock'), expected status/reason 'wall_clock_stopped' and stoppedBy 'wall_clock'. NEW: STOPPED-overseer_cap.json, status/reason 'awaiting_choice', stoppedBy 'overseer_cap'. WHY: wall_clock was the advice call's own stop cause and left STOP_CAUSES with the add-on (a STOPPED-wall_clock.json is no longer read as a marker at all); the rule pinned (resumeAfterStop in the marker decides, an unreadable marker reads not resumable) is the generic branch of runResumability and is unchanged.
test('0.8.1 M6: a stopped run resumes only if its chain said resumeAfterStop: true, as recorded in its marker; an unreadable marker does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-resumable-stop-'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'x', pid: 999999 }));
  writeFileSync(join(dir, 'STOPPED-overseer_cap.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'overseer_cap', beforeFirstCall: false, resumeAfterStop: false }));
  let s = runResumability(dir, { chain: 'x', pid: 999999 });
  assert.deepEqual([s.status, s.resumable, s.reason, s.stoppedBy], ['awaiting_choice', false, 'awaiting_choice', 'overseer_cap']);
  writeFileSync(join(dir, 'STOPPED-overseer_cap.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'overseer_cap', resumeAfterStop: true }));
  s = runResumability(dir, { chain: 'x', pid: 999999 });
  assert.deepEqual([s.resumable, s.needs], [true, 'nothing'], 'a chain that allows it (a planning chain in a later release)');
  writeFileSync(join(dir, 'STOPPED-overseer_cap.json'), '{ torn');
  s = runResumability(dir, { chain: 'x', pid: 999999 });
  assert.equal(s.resumable, false);
  assert.notEqual(s.reason, 'process_gone');
});

test('0.8.1 decided rule 6 (M6 review D3): an advice call is never offered a resume, whatever ended it: an error, its cap, a crash', () => {
  for (const marker of ['STOPPED-error.json', 'STOPPED-budget.json', null]) {
    const dir = mkdtempSync(join(tmpdir(), 'thc-resumable-advice-'));
    // CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD the folder named the chain advise-single (a file that existed in chains/outdated/). NEW it names a chain that does not exist ('a-chain-that-no-longer-exists'): the advice folder is recognised by its advise-log.json, never by a chain lookup. WHY advise-single is deleted from the repository; this is the Q3 row for the resumability status of an old advice folder.
    // zero-spend-ok: runResumability runs in THIS process on a folder naming no chain; it sends nothing, and the call below runs under withMalformedKeysInProcess so no usable key is reachable even if that stopped being true
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'a-chain-that-no-longer-exists', pid: 999999 }));
    writeFileSync(join(dir, 'advise-log.json'), JSON.stringify({ schema: 'advise-log/1' }));
    if (marker) { writeFileSync(join(dir, marker), '{}'); if (marker === 'STOPPED-error.json') writeFileSync(join(dir, 'STOPPED-error.md'), '# x\n'); }
    const s = withMalformedKeysInProcess(() => runResumability(dir, { chain: 'a-chain-that-no-longer-exists', pid: 999999 }));
    assert.deepEqual([s.resumable, s.reason], [false, 'advice_call'], String(marker));
  }
});

// ---- 0.8.4 add-on removal, wave 2: THE OLD ADVICE FOLDER'S TOMBSTONES (Q3 rows; WORDING REM-w8, REM-w21, REM-w31, REM-w32; the reader is src/stop-files.js isAdviceFolder) ----
// A folder an advice call left (advice.meta.json or advise-log.json) is refused on its OWN FILES, before any chain is looked up: a project chains/advise-standard.json (the fixture below: an `advise` block with mock seats) never makes
// it resumable or handed off, and nothing is sent or spent. Real verbs, offline, $0. These three tests are the Q3 rows of this file: --resume (with the shadowing row), handoff / contract draft / contract lock, resume_run and run_status.
const ADVICE_FILES = ['advise-log.json', 'advice.meta.json'];
const adviceProject = file => {
  const dir = workspace();
  copyFileSync(join(root, 'test', 'fixtures', 'advice-chains', 'mock-advise-quick.json'), join(dir, 'chains', 'advise-standard.json'));   // the shadow: a project chain with the old advice chain's name
  const d = rd(dir); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'run.json'), JSON.stringify({ chain: 'advise-standard', task: 'tasks/t.md', cwd: dir, pid: 999999, maxUsd: 1 }));
  writeFileSync(join(d, file), '{}');
  return dir;
};
const keys = malformedProviderKeys();

test('Q3 --resume of an old advice folder is refused on the folder\'s own files (REM-w21), exit 2, before any chain is looked up: a project chains/advise-standard.json does not make it resumable; nothing is written', () => {
  for (const file of ADVICE_FILES) {
    const dir = adviceProject(file); const before = readdirSync(rd(dir)).sort();
    const r = run(dir, ['--resume', `runs/${RUN}`], keys);
    assert.equal(r.status, 2, `${file}: ${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes(`--resume: ${RUN} is an advice call, which is not continued, whatever ended it. Nothing was sent and nothing was spent.`), `${file}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /advise-standard|"advise" block|says resumeAfterStop/, `${file}: the refusal is the folder's, not a chain's`);
    assert.deepEqual(readdirSync(rd(dir)).sort(), before, `${file}: the folder is untouched`);
    assert.deepEqual(readdirSync(join(dir, 'runs')), [RUN], `${file}: no other run folder was started`);
  }
});

test('Q3 handoff --from-run and contract draft --from-run of an old advice folder are refused (REM-w32: no chain clause), contract lock too; nothing is called or written', () => {
  for (const file of ADVICE_FILES) {
    const dir = adviceProject(file); const before = readdirSync(rd(dir)).sort();
    const abs = join(dir, 'runs', RUN);
    for (const who of ['handoff', 'contract draft']) {
      const args = who === 'handoff' ? ['handoff', '--from-run', `runs/${RUN}`] : ['contract', 'draft', '--from-run', `runs/${RUN}`];
      const r = run(dir, args, keys);
      assert.equal(r.status, 2, `${file} ${who}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stderr.includes(`${who}: ${abs} is an advice call, not a plan: there is nothing to hand off. Read its deliverable.md (the advice) instead.`), `${file} ${who}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /chain "/, `${file} ${who}: no chain clause`);
    }
    const lock = run(dir, ['contract', 'lock', `runs/${RUN}`], keys);
    assert.equal(lock.status, 2, `${file}: ${lock.stdout}${lock.stderr}`);
    assert.ok(lock.stderr.includes(`contract lock: runs/${RUN} is an advice call, not a plan: it has nothing to make a contract from`), `${file}: ${lock.stderr}`);
    assert.deepEqual(readdirSync(rd(dir)).sort(), before, `${file}: the folder is untouched`);
  }
});

test('Q3 MCP: resume_run of an old advice folder is refused (REM-w8) and run_status says an advice call is not resumed, also for a spend-capped one (REM-w31); the resume brief says it too', { timeout: 90_000 }, async () => {
  const dir = adviceProject('advise-log.json');
  const stopRun = rd(dir);
  writeFileSync(join(stopRun, 'STOPPED-budget.json'), JSON.stringify({ stoppedAt: 'advise', capUsd: 1, spentUsd: 0, projectedStageUsd: 2 }));
  const res = await mcpCalls(dir, [{ name: 'resume_run', arguments: { run: RUN } }, { name: 'run_status', arguments: { run: RUN } }]);
  const text = id => (res.get(id)?.result?.content ?? []).map(b => b.text).join('\n');
  assert.ok(text(2).includes('this is an advice run, which is not resumed over MCP (a resume would spend with no new preview or approval). An advice call is never continued. Nothing was spent.'), text(2));
  assert.ok(text(3).includes("stopped: the run's spend cap was below this advice call's worst case; nothing was spent; an advice call is not resumed"), text(3));
  assert.doesNotMatch(text(3), /ask for a new quote|council_quote/);
  const brief = generateResumeBrief({ runId: RUN, dir: stopRun, runMeta: { chain: 'advise-standard', task: 'tasks/t.md' }, chainConfig: null });
  assert.ok(brief.includes(`This is an advice call, which is not resumed. Call run_status("${RUN}") for what it has.`), brief);
});
