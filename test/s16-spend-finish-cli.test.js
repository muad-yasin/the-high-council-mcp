// 0.8.4 S16 (F; T9e T21q T21bz; N29; C&C's rulings of 09 Nov 2026): the REAL verbs. A layered chain of priced mock seats (the $1000-per-Mtok fixture price, offline, $0) is stopped by a small --max-usd; every stop is the harness's own (no record is written by hand).
// (a) a stop INSIDE the review rounds: `--resume --finish` records the choice, prints what the raise will do, exits 4, makes NO call (no new usage file, no new reservation line) and leaves the run stopped; (b) the resume after the raise ends the loop at the stage the limit
// stopped, runs the final read BEFORE the end, and report.json (when the run ends) says budget_stop / finish; (c) a stop BEFORE the review rounds refuses --finish with the sentence for it, exit 2, nothing recorded.
// The cap that lands the stop inside the review rounds is FOUND, not assumed: the caps below are tried in order and the first whose STOPPED-budget.json says phase "loop" is used (a premise failure lists what each cap gave).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findStopCap } from './helpers/find-stop-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const seat = (extra = {}) => ({ provider: 'mock', model: 'mock-priced', maxTokens: 4000, ...extra });
const CHAIN = { name: 'sf', signoff: 'unanimous', handoff: true, maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { criteria: seat({ maxTokens: 100 }), builder: seat({ lab: 'author' }), reviser: seat({ lab: 'author' }), critics: [seat({ lab: 'l1', layer: 1 }), seat({ lab: 'l2', layer: 2 }), seat({ lab: 'l3', layer: 3 })] } };
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spend-finish-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small thing with a retry limit.\n'); writeFileSync(join(dir, 'chains', 'sf.json'), JSON.stringify(CHAIN));
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  return { dir, run, runDir: join(dir, 'runs', ID) };
}
const ID = '2026-11-09T12-00-00-000Z';
const CAPS = ['0.001', '0.5', '1', '1.5', '2', '2.25', '2.5', '2.75', '3', '3.25', '3.5', '3.75', '4', '5', '6', '8', '10', '12', '15', '20'];   // a finer ladder around the first completing cap: the stop AFTER the review rounds (the final read) lies between the loop stop and a finished run
const phaseOf = w => { try { return JSON.parse(readFileSync(join(w.runDir, 'STOPPED-budget.json'), 'utf8')).phase ?? null; } catch { return null; } };
const files = w => readdirSync(w.runDir).filter(n => !/lock/i.test(n)).sort();   // the run lock is held while the command runs and is not a record of the run
const reservationLines = w => (existsSync(join(w.runDir, 'spend-reservations.jsonl')) ? readFileSync(join(w.runDir, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0);

// the first cap whose stop is in the given phase (a fresh folder for each try).
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state; the same finding as test/finish-now-spending.test.js): OLD bar: the first cap of the fixed grid above whose stop is in the phase. NEW bar: the same, and when the grid finds none, findStopCap (test/helpers/find-stop-cap.js) bisects between a stop and a finished run. WHY: the stop AFTER the review rounds is a window of the cap that the grid stepped over (3.25 stopped in the loop, 3.5 finished). If no cap stops in the phase the premise fails and lists every cap tried: that is a finding (a paid call no cap can stop), to be read, not a moved grid.
function stopIn(phase) {
  const run = cap => { const w = workspace(); const r = w.run(['--chain', 'sf', '--task', 'tasks/t.md', '--max-usd', cap, '--run-id', ID]); return { status: r.status, phase: r.status === 4 ? phaseOf(w) : null, w }; };
  const found = findStopCap({ phase, caps: CAPS, attempt: run });
  if (found.a) return { w: found.a.w, cap: found.cap };
  assert.fail(`premise: no cap stopped the run in the phase "${phase}": ${found.tried.join(' | ')}`);
}

test('T9e, T21q, T21bz (a)+(b): --finish at a stop INSIDE the review rounds records the choice, makes no call and leaves the run stopped; after the raise the final read runs before the end, NOT agreed, budget_stop', () => {
  const { w, cap } = stopIn('loop');
  const before = files(w); const reserved = reservationLines(w);
  const f = w.run(['--resume', w.runDir, '--finish']);
  assert.equal(f.status, 4, `--finish exits 4: ${f.stdout}${f.stderr}`);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the sentence ended `after the final read of layer 3: that read makes up to 2 calls` (the figure form). NEW: it reads `after the final read of layer 3: it makes two calls for each seat of that layer for each part of a long list, fewer when a seat has already read exactly this text. That read runs only once your raise pays for it; a raise that does not cover it stops the run again, still not ended.` (K5). WHY: src/spend-finish.js spendFinishAnswer gives the `parts` form once the long-list part rule is recorded (finalReadPartRule, S16 W42; WORDING S16-w62h).
  assert.match(f.stdout, /^Your choice to end the run here is recorded: nothing was run and nothing was spent\. The run stays stopped\. When you raise the spending limit as before \(the way to do it is in .*STOPPED-budget\.md\), the run ends at stage "[^"]+", NOT agreed, after the final read of layer 3: it makes two calls for each seat of that layer for each part of a long list, fewer when a seat has already read exactly this text\. That read runs only once your raise pays for it; a raise that does not cover it stops the run again, still not ended\./m);
  const runJson = JSON.parse(readFileSync(join(w.runDir, 'run.json'), 'utf8'));
  assert.deepEqual([runJson.budgetFinish.choice, runJson.budgetFinish.via, typeof runJson.budgetFinish.label, typeof runJson.budgetFinish.at], ['finish', 'cli', 'string', 'string']);
  // CHANGED ACCEPTED (0.8.4 relay of --finish at a spending stop): OLD bar: no new file at all after --finish. NEW: the only new file is the gate ledger (gate-ledger.jsonl) when the folder had none: the person's choice is a hash-chained line there (event budget_finish, choice finish), the authority for who chose and in which order; still no stage, no usage file, no report, no reservation.
  assert.deepEqual(files(w), [...before, ...(before.includes('gate-ledger.jsonl') ? [] : ['gate-ledger.jsonl'])].sort(), 'no new file but the ledger: no stage, no usage file, no report');
  assert.equal(reservationLines(w), reserved, 'no reservation line: no call was reserved or sent');
  assert.ok(existsSync(join(w.runDir, 'STOPPED-budget.json')), 'the run is still stopped');
  assert.ok(!existsSync(join(w.runDir, 'report.json')), 'and not ended');
  // the person's own raise: a much higher total (the mock chain takes it as a flag)
  const raise = w.run(['--resume', w.runDir, '--max-usd', String(Number(cap) * 100)]);
  assert.match(raise.stdout + raise.stderr, /you chose to end the run at the spending stop \(stage "[^"]+"\); it ends there, NOT agreed, after the final read\./);
  const labels = files(w).filter(n => n.endsWith('.md')).map(n => n.replace(/\.md$/, ''));
  assert.ok(labels.some(l => l.startsWith('final-read-')), `the final read ran before the end: ${labels.join(', ')}`);
  if (existsSync(join(w.runDir, 'report.json'))) {
    const report = JSON.parse(readFileSync(join(w.runDir, 'report.json'), 'utf8'));
    assert.deepEqual([report.passed, report.stop?.kind, report.stop?.chosen], [false, 'budget_stop', 'finish']);
    assert.equal(report.stop.label, runJson.budgetFinish.label);
    assert.equal(raise.status, 22, 'exit 22: finished, not agreed');
  } else {
    assert.ok(existsSync(join(w.runDir, 'report-partial.json')), 'the run is not ended without a report: it stopped again, with its record');
  }
});

test('T9e (c): --finish at a stop BEFORE the review rounds is refused with the sentence for it, exit 2, nothing recorded', () => {
  const { w } = stopIn('before');
  const before = files(w); const runJsonBefore = readFileSync(join(w.runDir, 'run.json'), 'utf8');
  const f = w.run(['--resume', w.runDir, '--finish']);
  assert.equal(f.status, 2, f.stdout + f.stderr);
  assert.match(f.stderr, /^--finish: this stop came before the review rounds began, so there is no plan under review yet and nothing to finish\. Raise the spending limit as before \(the way to do it is in .*STOPPED-budget\.md\): the run then goes on from the stage it stopped at\. Nothing was recorded, run or spent\.$/m);
  assert.equal(readFileSync(join(w.runDir, 'run.json'), 'utf8'), runJsonBefore, 'run.json is untouched');
  assert.deepEqual(files(w), before);
});

test('T9e (c): --finish at a stop AFTER the review rounds is refused with the sentence for it (the raise completes the read and the run), exit 2, nothing recorded', () => {
  const { w } = stopIn('after');
  const before = files(w); const runJsonBefore = readFileSync(join(w.runDir, 'run.json'), 'utf8');
  const f = w.run(['--resume', w.runDir, '--finish']);
  assert.equal(f.status, 2, f.stdout + f.stderr);
  assert.match(f.stderr, /^--finish: this stop came after the review rounds, so the run is already ending\. Raise the spending limit as before \(the way to do it is in .*STOPPED-budget\.md\): the stage it stopped at is paid for and the run ends the way it was going to\. Nothing was recorded, run or spent\.$/m);
  assert.equal(readFileSync(join(w.runDir, 'run.json'), 'utf8'), runJsonBefore, 'run.json is untouched');
  assert.deepEqual(files(w), before);
});

test('--finish with --max-usd is refused: it only records the choice; the limit comes with the resume that follows', () => {
  const { w } = stopIn('loop');
  const f = w.run(['--resume', w.runDir, '--finish', '--max-usd', '100']);
  assert.equal(f.status, 2, f.stdout + f.stderr);
  assert.match(f.stderr, /^--finish: give it alone\./);
  assert.ok(!('budgetFinish' in JSON.parse(readFileSync(join(w.runDir, 'run.json'), 'utf8'))), 'nothing was recorded');
});

test('a budgetFinish in run.json that cannot be read refuses the resume with one sentence, nothing run or spent', () => {
  const { w } = stopIn('loop');
  const j = JSON.parse(readFileSync(join(w.runDir, 'run.json'), 'utf8'));
  writeFileSync(join(w.runDir, 'run.json'), JSON.stringify({ ...j, budgetFinish: 'finish' }));   // the damaged entry is the premise of this row (project-writable text), not a stop
  const r = w.run(['--resume', w.runDir, '--max-usd', '4000']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^--resume: the finish recorded in run\.json \(budgetFinish\) cannot be read/);
});

test('C&C ruling (1): a chain with no final read (mock-budget: one critic, first sign-off) keeps today\'s behaviour exactly: --finish at its spending stop is the old refusal (exit 2, nothing recorded) and a stray budgetFinish entry in run.json is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spend-finish-nofr-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small thing.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  const runDir = join(dir, 'runs', ID);
  const stopped = run(['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '0.001', '--run-id', ID]);
  assert.equal(stopped.status, 4, stopped.stdout + stopped.stderr);
  const runJsonBefore = readFileSync(join(runDir, 'run.json'), 'utf8');
  const f = run(['--resume', runDir, '--finish']);
  assert.equal(f.status, 2, f.stdout + f.stderr);
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026: the sentence at cli.js's old line 3553 is made true). OLD: /--continue \/ --finish: .* is not stopped for --continue or --finish, so there is nothing to answer/ (false: the run IS stopped, at its spending limit). NEW: the refusal says why and names --finish-now. The result is the same: exit 2, nothing recorded.
  assert.match(f.stderr, /--finish: this run is stopped at its spending limit, and this chain has no final read, so there is no last read to end after\. Give --finish-now to end the run here, or raise the limit\. Nothing was recorded, run or spent\./);
  assert.equal(readFileSync(join(runDir, 'run.json'), 'utf8'), runJsonBefore, 'nothing recorded');
  const j = JSON.parse(runJsonBefore);
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...j, budgetFinish: { choice: 'finish', label: 'x', at: '2026-11-09T10:00:00.000Z', via: 'cli' } }));   // the stray entry is the premise (project-writable text), not a stop
  const again = run(['--resume', runDir, '--max-usd', '100000']);
  assert.ok(!/you chose to end the run at the spending stop/.test(again.stdout + again.stderr), 'not armed');
  assert.ok(existsSync(join(runDir, 'report.json')), `the run went on and ended: ${again.stdout}${again.stderr}`);
});
