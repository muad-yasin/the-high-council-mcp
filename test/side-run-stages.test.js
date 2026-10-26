// T2-1 + J1-08-1 (13 Oct 2026): a side run (--replay, --rematch) writes each stage as it completes, takes the run lock, and RESUMES through the stage cache. Before: every paid stage text lived in memory until the end (a stop or a
// failure lost what was paid for), a re-run of the same folder paid the whole chain again, and a LIVE replay read as "stopped, resumable" to run_status (no lock, no pid). Offline: the priced mock chain `mock-budget` ($0.506 per
// run); a held mock call (COUNCIL_MOCK_HOLD_FILE) makes a run live without any timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpentUsd } from '../src/spend.js';
import { estimateChainRows } from '../src/cost.js';
import { deriveRunStatus, runResumability, isRunAlive } from '../src/run-status.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ENV = { PATH: process.env.PATH };
const DATE = '2026-10-13';
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const sh = (cwd, args, env = ENV) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env, timeout: 90_000 });
const usageSum = dir => readdirSync(dir).filter(f => f.endsWith('.usage.json')).reduce((n, f) => n + readJson(join(dir, f)).usd, 0);

// a finished priced run to replay / rematch
function original() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-sidestages-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.');
  const first = sh(dir, ['--chain', 'mock-budget', '--task', 'tasks/x.md', '--max-usd', 'none']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, total: readJson(join(run, 'report.json')).totals.usd, replayDir: `${run}.replay-${DATE}`, rematchDir: `${run}.rematch-1` };
}
const withOriginal = fn => { const o = original(); try { return fn(o); } finally { rmSync(o.dir, { recursive: true, force: true }); } };
const replay = (o, cap) => sh(o.dir, ['--replay', o.run, '--replay-date', DATE, '--max-usd', String(cap)]);

test('SR-1 a replay stopped at its cap keeps every stage it paid for as <label>.md + <label>.usage.json, and its spend is the usage records\' sum (the stop file\'s figure, not twice that)', () => withOriginal(o => {
  const r = replay(o, 3);                                                                            // stops before the build stage: only the criteria stage was paid
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.ok(existsSync(join(o.replayDir, 'criteria.md')) && existsSync(join(o.replayDir, 'criteria.usage.json')), 'the paid stage is on disk');
  const stop = readJson(join(o.replayDir, 'STOPPED-budget.json'));
  near(runSpentUsd(o.replayDir), usageSum(o.replayDir), 'the folder costs its usage records');
  near(runSpentUsd(o.replayDir), stop.spentUsd, 'and that is what the stop file says');
}));

test('SR-2 a stopped replay is RESUMED, not refused and not re-paid: the paid stages replay from disk and the finished replay costs what one replay costs', () => withOriginal(o => {
  assert.equal(replay(o, 3).status, 4);
  const paidSoFar = runSpentUsd(o.replayDir);
  const r = replay(o, 'none');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`--replay: .*replay-${DATE} was started and did not finish: 1 stage\\(s\\) are on disk \\(recorded spend so far: \\$0\\.0500\\); the stages still to run could cost up to \\$[0-9.]+ more\\. Only those stages run from here\\.`));
  assert.match(r.stdout, /criteria: .* from disk/);
  const remaining = Number(/cost up to \$([0-9.]+) more/.exec(r.stdout)[1]);
  const rows = estimateChainRows(readJson(join(root, 'chains', 'mock-budget.json')), { maximum: true });
  const full = rows.reduce((n, x) => n + x.usd, 0), left = rows.filter(x => x.label !== 'criteria').reduce((n, x) => n + x.usd, 0);
  assert.ok(left < full, 'fixture: the criteria stage has a priced row');
  assert.ok(Math.abs(remaining - left) < 0.006, `the remaining stages' worst case (${remaining}) is the chain's maximum less the stage already on disk (${left}), not the whole chain (${full})`);
  assert.ok(existsSync(join(o.replayDir, 'report.json')));
  near(runSpentUsd(o.replayDir), o.total, 'one replay of the same chain costs what the original cost: the paid stage was not paid again');
  assert.ok(paidSoFar < o.total);
  assert.equal(existsSync(join(o.replayDir, 'superseded')), false, 'nothing went stale');
  assert.equal(existsSync(join(o.replayDir, 'STOPPED-budget.json')), false, 'the old stop marker is cleared');
}));

test('SR-3 control: a FINISHED replay is still "already replayed" (exit 2, nothing run)', () => withOriginal(o => {
  assert.equal(replay(o, 'none').status, 0);
  const r = replay(o, 'none');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /already exists - this run was already replayed for that date/);
}));

test('SR-4 a stage whose chain changed between sittings is STALE: it re-runs and its first payment stays in the total (superseded/), not overwritten', () => withOriginal(o => {
  mkdirSync(join(o.dir, 'chains'));
  const chain = readJson(join(root, 'chains', 'mock-budget.json'));
  writeFileSync(join(o.dir, 'chains', 'mock-budget.json'), JSON.stringify(chain));
  assert.equal(replay(o, 3).status, 4);
  const first = runSpentUsd(o.replayDir);
  chain.seats.builder = { ...chain.seats.builder, maxTokens: 20000 };                                    // an edited chain: the inputs fingerprint differs
  writeFileSync(join(o.dir, 'chains', 'mock-budget.json'), JSON.stringify(chain));
  const r = replay(o, 'none');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(o.replayDir, 'superseded', 'criteria.1.usage.json')), 'the stale stage\'s first payment is kept');
  assert.ok(runSpentUsd(o.replayDir) >= first + o.total - 1e-9, 'the total holds the first payment plus a whole second run');
  const report = readJson(join(o.replayDir, 'report.json'));
  assert.ok(report.totals.supersededUsd > 0, 'the report shows what was set aside');
  near(report.totals.usd, usageSum(o.replayDir) + report.totals.supersededUsd, 'report.json totals.usd = its stages + supersededUsd, as the main run\'s report is (its own total is not lower than the folder costs)');
  near(runSpentUsd(o.replayDir), report.totals.usd, 'and the folder\'s spend is that report total');
  assert.ok(Array.isArray(report.superseded) && report.superseded.some(x => x.label === 'superseded/criteria.1'), 'superseded[] lists it');
}));

// a run that is LIVE: a mock call held until a file exists; `kill` releases it by PID
function live(o, args) {
  const hold = join(o.dir, 'hold');
  const child = spawn(process.execPath, [cli, ...args], { cwd: o.dir, env: { ...ENV, COUNCIL_MOCK_HOLD_FILE: hold }, stdio: 'ignore' });
  return { child, release: () => writeFileSync(hold, '1') };
}
async function until(cond, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await new Promise(r => setTimeout(r, 50)); } return false; }

test('SR-5 a LIVE replay reads running, not "stopped, resumable"; a second replay of the same folder is refused by the lock; the lock is gone after exit', async () => {
  const o = original();
  let lv;
  try {
    lv = live(o, ['--replay', o.run, '--replay-date', DATE, '--max-usd', 'none']);
    assert.ok(await until(() => existsSync(join(o.replayDir, '.council.lock')) && existsSync(join(o.replayDir, 'spend-reservations.jsonl'))), 'the replay holds its lock');
    assert.equal(deriveRunStatus(o.replayDir, null), 'running');
    assert.equal(isRunAlive(o.replayDir, null), true);
    assert.deepEqual([runResumability(o.replayDir, null).resumable, runResumability(o.replayDir, null).reason], [false, 'running']);
    const second = sh(o.dir, ['--replay', o.run, '--replay-date', DATE, '--max-usd', 'none']);
    assert.equal(second.status, 2, second.stdout + second.stderr);
    assert.match(second.stderr, /run is already running: pid \d+/);
    lv.release();
    await new Promise(r => lv.child.on('exit', r));
    assert.equal(existsSync(join(o.replayDir, '.council.lock')), false, 'released on exit');
    assert.equal(deriveRunStatus(o.replayDir, null), 'done');
  } finally { if (lv && lv.child.exitCode === null) lv.child.kill('SIGKILL'); rmSync(o.dir, { recursive: true, force: true }); }
});

test('SR-6 a LIVE rematch reads running too, and is refused a second time while live', async () => {
  const o = original();
  let lv;
  try {
    lv = live(o, ['--rematch', o.run, '--rematch-seed', '1', '--max-usd', 'none']);
    assert.ok(await until(() => existsSync(join(o.rematchDir, '.council.lock')) && existsSync(join(o.rematchDir, 'run.json'))), 'the rematch holds its lock (and has written its run.json: the lock is taken first, the file follows)');
    assert.equal(deriveRunStatus(o.rematchDir, readJson(join(o.rematchDir, 'run.json'))), 'running');
    const second = sh(o.dir, ['--rematch', o.run, '--rematch-seed', '1', '--max-usd', 'none']);
    assert.equal(second.status, 2, second.stdout + second.stderr);
    lv.release(); await new Promise(r => lv.child.on('exit', r));
    assert.equal(existsSync(join(o.rematchDir, '.council.lock')), false);
  } finally { if (lv && lv.child.exitCode === null) lv.child.kill('SIGKILL'); rmSync(o.dir, { recursive: true, force: true }); }
});

// a CONTROL, no red of its own (rule 8b already charged an unsettled reservation in any folder, and a reservation-only folder was already reused): the standing question (b), shown for a side folder
test('SR-7 control: a replay killed while a priced call is in flight leaves a reserved line with no settled line: it stays charged at its worst case in the folder\'s total, and a resume still counts it', async () => {
  const o = original();
  try {
    const lv = live(o, ['--replay', o.run, '--replay-date', DATE, '--max-usd', 'none']);
    assert.ok(await until(() => existsSync(join(o.replayDir, 'spend-reservations.jsonl')) && readFileSync(join(o.replayDir, 'spend-reservations.jsonl'), 'utf8').includes('"reserved"')));
    lv.child.kill('SIGKILL'); await new Promise(r => lv.child.on('exit', r));
    const lines = readFileSync(join(o.replayDir, 'spend-reservations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const worst = lines.filter(l => l.event === 'reserved').reduce((n, l) => n + l.usd, 0);
    assert.ok(worst > 0 && !lines.some(l => l.event === 'settled'));
    near(runSpentUsd(o.replayDir), worst, 'the unsettled call is charged at its worst case');
    const again = sh(o.dir, ['--replay', o.run, '--replay-date', DATE, '--max-usd', 'none']);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.ok(runSpentUsd(o.replayDir) >= o.total + worst - 1e-9, 'the resume\'s total still holds the in-flight call');
  } finally { rmSync(o.dir, { recursive: true, force: true }); }
});

test('SR-8 a REMATCH stopped at its cap is resumed the same way: its paid stages replay from disk', () => withOriginal(o => {
  const first = sh(o.dir, ['--rematch', o.run, '--rematch-seed', '1', '--max-usd', '3']);
  assert.equal(first.status, 4, first.stdout + first.stderr);
  assert.ok(existsSync(join(o.rematchDir, 'criteria.usage.json')));
  const r = sh(o.dir, ['--rematch', o.run, '--rematch-seed', '1', '--max-usd', 'none']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /--rematch: .*rematch-1 was started and did not finish: 1 stage\(s\) are on disk/);
  assert.ok(existsSync(join(o.rematchDir, 'report.json')));
  assert.equal(sh(o.dir, ['--rematch', o.run, '--rematch-seed', '1', '--max-usd', 'none']).status, 2, 'a finished rematch is still "already run"');
}));

test('SR-9 the side-run stage writer is atomic and cost first (a source scan, as the main run\'s writer is pinned)', () => {
  const src = readFileSync(join(root, 'src', 'stage-cache.js'), 'utf8');
  const w = src.slice(src.indexOf('export function writeSideStage'));
  assert.ok(w.indexOf('.usage.json') < w.indexOf('.md`'), 'the usage record is written before the text');
  assert.match(w, /writeFileAtomic\(join\(dir, `\$\{s\.label\}\.usage\.json`\)/);
  assert.match(w, /writeFileAtomic\(join\(dir, `\$\{s\.label\}\.md`\), s\.text\)/);
});

test('SR-10 the standing question on a SIDE folder: a stage whose usage record exists and whose text is gone (the process ended between the writes) keeps its first payment when the replay resumes', () => withOriginal(o => {
  assert.equal(replay(o, 3).status, 4);                                                                 // criteria paid, text and cost on disk
  const first = runSpentUsd(o.replayDir);
  const aside = join(o.dir, 'aside'); mkdirSync(aside);
  writeFileSync(join(aside, 'criteria.md'), readFileSync(join(o.replayDir, 'criteria.md')));
  rmSync(join(o.replayDir, 'criteria.md'));                                                             // the orphan: usage record kept, text gone
  const r = replay(o, 'none');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(o.replayDir, 'superseded', 'criteria.1.usage.json')), 'the orphan payment is kept in superseded/');
  assert.match(readFileSync(join(o.replayDir, 'WARNINGS.md'), 'utf8'), /cache_orphan: stage "criteria"/);
  assert.ok(runSpentUsd(o.replayDir) >= first + o.total - 1e-9, 'the total holds the orphan payment plus one whole replay');
}));
