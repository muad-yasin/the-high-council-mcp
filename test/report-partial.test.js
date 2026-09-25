// report-partial.json (0.7.7): a run the per-run spend cap stops writes what it had so far, in
// report.json's shape plus partial: true, without report.json itself - whose existence means
// "finished" to run-status, spend, the JS API and the MCP server. Incident: a premium-7 run capped
// after 11 rounds ($33.33 of $36, 2026-09-25) left ~300 stage files and nothing machine-readable.
// All offline: mock-budget's fixture prices (mock/mock-priced) trip the cap with no key and no call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setBudget, BudgetExceeded } from '../src/chain.js';
import { partialReportJsonShape, renderPartialBoardMd, PARTIAL_REPORT_FILE, PARTIAL_BOARD_FILE } from '../src/report-shape.js';
import { deriveRunStatus } from '../src/run-status.js';
import { spendReport } from '../src/spend.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schema);
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

function assertValid(report, what) {
  assert.ok(validate(report), `${what}: ${JSON.stringify(validate.errors, null, 2)}`);
  const undeclared = Object.keys(report).filter(k => !(k in schema.properties));
  assert.deepEqual(undeclared, [], `${what}: top-level key(s) missing from schemas/report-v1.json`);
}

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-partial-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a small offline tool that keeps a list of notes.');
  return dir;
}
const run = (dir, args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);

// mock-debate with a priced reviser and two panel seats that never sign off, so every round runs
// and the cap can stop the run several rounds in. Only the reviser costs anything on paper.
function roundsChain() {
  const c = chain('mock-debate');
  return {
    ...c, name: 'mock-budget-rounds', maxRounds: 4,
    seats: {
      ...c.seats,
      reviser: { provider: 'mock', model: 'mock-priced', maxTokens: 100 },
      critics: [
        { provider: 'mock', model: 'mock-critic-holdout', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-critic-holdout', lab: 'mock-b' },
      ],
    },
  };
}

test('report-partial: a mock-budget run stopped at the cap writes report-partial.json and no report.json', () => {
  const dir = workDir();
  const r = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/x.md', '--max-usd', '1']);
  assert.equal(r.status, 4, `expected the cap to stop the run (exit 4): ${r.stdout.slice(-400)}`);
  const runDir = onlyRun(dir);
  assert.ok(!existsSync(join(runDir, 'report.json')), 'a stopped run must not look finished');
  const stopped = readJson(join(runDir, 'STOPPED-budget.json'));
  const partial = readJson(join(runDir, PARTIAL_REPORT_FILE));
  assertValid(partial, 'mock-budget partial');
  assert.equal(partial.partial, true);
  assert.equal(partial.stoppedBy, 'budget');
  assert.equal(partial.stoppedAtStage, stopped.stoppedAt);
  assert.equal(partial.stoppedAtStage, 'build');
  assert.deepEqual(partial.stages.map(s => s.label), ['criteria'], 'the stages done before the stop, and only those');
  assert.ok(partial.criteria.length > 0, 'the criteria stage ran, so its criteria are in the record');
  assert.equal(partial.passed, false);
  assert.equal(partial.chain, 'mock-budget');
  assert.equal(partial.maxUsd, 1);
  assert.ok(Math.abs(partial.totals.usd - stopped.spentUsd) < 1e-9, 'totals match what STOPPED-budget.json says was spent');
  // Same privacy rules as report.json: relative task, and no absolute path anywhere in the file.
  assert.equal(partial.task, 'tasks/x.md');
  assert.ok(!readFileSync(join(runDir, PARTIAL_REPORT_FILE), 'utf8').includes(dir), 'no absolute path in report-partial.json');
  // STOPPED-budget.md points to it; nothing else changes its meaning.
  assert.match(readFileSync(join(runDir, 'STOPPED-budget.md'), 'utf8'), /report-partial\.json/);
  assert.equal(deriveRunStatus(runDir, readJson(join(runDir, 'run.json'))), 'budget_stopped');
  const spent = spendReport(join(dir, 'runs'), { days: 1 }).runs.find(x => runDir.endsWith(x.id));
  assert.equal(spent.state, 'stopped: spend cap');
  assert.ok(Math.abs(spent.usd - partial.totals.usd) < 1e-9);
});

test('report-partial: a resume that finishes removes report-partial.json and BOARD-partial.md; report.json replaces them', () => {
  const dir = workDir();
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'mock-budget-rounds.json'), JSON.stringify(roundsChain(), null, 2));
  assert.equal(run(dir, ['--chain', 'mock-budget-rounds', '--task', 'tasks/x.md', '--max-usd', '1']).status, 4);
  const runDir = onlyRun(dir);
  assert.ok(existsSync(join(runDir, PARTIAL_REPORT_FILE)));
  assert.ok(existsSync(join(runDir, PARTIAL_BOARD_FILE)), 'the debate ran before the stop, so there is a board');
  const r = run(dir, ['--resume', runDir, '--max-usd', 'none']);
  assert.equal(r.status, 0, `resume failed: ${r.stdout.slice(-400)}${r.stderr}`);
  for (const f of [PARTIAL_REPORT_FILE, PARTIAL_BOARD_FILE, 'STOPPED-budget.json', 'STOPPED-budget.md']) {
    assert.ok(!existsSync(join(runDir, f)), `${f} must not outlive the stop it describes`);
  }
  const report = readJson(join(runDir, 'report.json'));
  assert.equal(report.partial, undefined, 'report.json never carries partial');
  assert.equal(report.stoppedBy, undefined);
  assertValid(report, 'resumed report.json');
});

test('report-partial: a run capped several rounds in keeps every round\'s verdicts, the debate and the board', () => {
  const dir = workDir();
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'mock-budget-rounds.json'), JSON.stringify(roundsChain(), null, 2));
  // Each revise projects about $0.70 and costs about $0.64: $1.90 pays for two and stops before the third.
  const r = run(dir, ['--chain', 'mock-budget-rounds', '--task', 'tasks/x.md', '--max-usd', '1.9']);
  assert.equal(r.status, 4, `expected the cap to stop the run (exit 4): ${r.stdout.slice(-400)}`);
  const runDir = onlyRun(dir);
  const partial = readJson(join(runDir, PARTIAL_REPORT_FILE));
  assertValid(partial, 'multi-round partial');
  assert.match(partial.stoppedAtStage, /^revise-\d+$/);
  const rounds = [...new Set(partial.panelVerdicts.map(v => v.round))];
  assert.ok(Math.max(...rounds) >= 2, `expected at least two review rounds before the stop, got ${rounds}`);
  for (const round of rounds) {
    assert.deepEqual(partial.panelVerdicts.filter(v => v.round === round).map(v => v.lab).sort(), ['mock-a', 'mock-b'], `round ${round}: one verdict per seat`);
  }
  const labels = partial.stages.map(s => s.label);
  for (const l of ['propose-mock-a', 'debate-mock-a', 'reply-mock-a', 'build', 'panel-1-mock-a', 'revise-1', 'panel-2-mock-b']) {
    assert.ok(labels.includes(l), `stage ${l} ran and must be listed: ${labels}`);
  }
  assert.ok(!labels.includes(partial.stoppedAtStage), 'the stage the cap stopped was never run');
  assert.equal(partial.proposals.length, 2);
  assert.ok(partial.debate.posts.length > 0 && partial.debate.replies.length > 0);
  assert.equal(partial.signoff.length, 2, 'the last review round\'s sign-off record');
  assert.ok(partial.signoff.every(s => s.signedOff === false));
  assert.ok(partial.lastCritique.failures.length > 0);
  assert.equal(partial.passed, false);
  const board = readFileSync(join(runDir, PARTIAL_BOARD_FILE), 'utf8');
  assert.match(board, /^> \*\*Partial board\.\*\*/);
  assert.match(board, new RegExp(`before stage \`${partial.stoppedAtStage}\``));
  assert.ok(!existsSync(join(runDir, 'BOARD.md')) && !existsSync(join(runDir, 'deliverable.md')));
});

test('report-partial: in-process, BudgetExceeded carries the run so far, optional stages included, and it validates', async () => {
  const base = roundsChain();
  const config = {
    ...base, name: 'mock-partial-optional',
    questions: { max: 3, wait: false },
    alternatives: { enabled: true },
    canary: { enabled: true, sampleRate: 1 },
    dispute: { enabled: true, stall_rounds: 2 },
    verify: {
      enabled: true,
      tools: [{ tool: 'run_tests', args: { file: 'test/fixture.test.js' } }],
      runTool: (tool, args) => ({ tool, args, ok: true, exitCode: 0, stdout: 'ok', stderr: '' }),
    },
    seats: { ...base.seats, questions: { provider: 'mock', model: 'mock-questions' } },
  };
  setBudget(1);
  let err;
  try {
    await runChain({ config, request: 'Plan a small offline tool.', log: () => {} });
  } catch (e) { err = e; } finally { setBudget(null); }
  assert.ok(err instanceof BudgetExceeded, `expected the cap to stop the run, got ${err}`);
  assert.ok(!err.partial.stages.some(s => s.label === err.label), 'the stage the cap stopped was never run');
  const report = JSON.parse(JSON.stringify(partialReportJsonShape({
    stoppedBy: 'budget', stoppedAtStage: err.label,
    runId: '2026-09-25T00-00-00-000Z', chain: config.name, task: 'tasks/x.md', result: err.partial, config, maxUsd: 1,
  })));
  assertValid(report, 'in-process partial');
  for (const key of ['questions', 'alternatives', 'canary', 'ground_truth', 'panelVerdicts', 'debate', 'disagreement_groups']) {
    assert.ok(report[key] != null, `the partial report should carry ${key}`);
  }
  assert.match(err.label, /^revise-\d+$/);
  assert.ok(report.panelVerdicts.length > 0, 'at least one review round ran before the stop');
  assert.equal(report.dispute, undefined, 'the dispute stage runs after the rounds and was never reached');
  assert.ok(renderPartialBoardMd({ runId: 'x', result: err.partial, stoppedAtStage: err.label }).includes('## Alternative architectures'));
});

test('report-partial: a stop before any stage ran still validates (every field at its "did not run" value)', async () => {
  const config = { ...chain('mock-budget'), name: 'mock-budget-zero' };
  setBudget(0.001);
  let err;
  try {
    await runChain({ config, request: 'x', log: () => {} });
  } catch (e) { err = e; } finally { setBudget(null); }
  assert.ok(err instanceof BudgetExceeded);
  assert.equal(err.label, 'criteria');
  const report = JSON.parse(JSON.stringify(partialReportJsonShape({ stoppedBy: 'budget', stoppedAtStage: err.label, runId: 'r', chain: config.name, task: 'x.md', result: err.partial })));
  assertValid(report, 'empty partial');
  assert.deepEqual([report.criteria, report.stages, report.proposals, report.passed, report.debate], [[], [], [], false, null]);
});

test('report-partial: a descending-mode run carries every stage of the whole descending run', async () => {
  const config = { ...chain('mock-budget'), name: 'mock-budget-descending', descending: true };
  setBudget(9);
  let err;
  try {
    await runChain({ config, request: 'Plan a small offline tool.', log: () => {} });
  } catch (e) { err = e; } finally { setBudget(null); }
  assert.ok(err instanceof BudgetExceeded, `expected the cap to stop the run, got ${err}`);
  const labels = err.partial.stages.map(s => s.label);
  assert.ok(labels.includes('criteria') && labels.some(l => l.startsWith('descending-')), `the plan sub-run and the descending stages: ${labels}`);
  assert.ok(err.partial.criteria.length > 0);
  const report = JSON.parse(JSON.stringify(partialReportJsonShape({ stoppedBy: 'budget', stoppedAtStage: err.label, runId: 'r', chain: config.name, task: 'x.md', result: err.partial, config })));
  assertValid(report, 'descending partial');
  assert.equal(report.stages.length, labels.length);
});

test('report-partial: capped --rematch and --replay folders get one too', () => {
  const dir = workDir();
  assert.equal(run(dir, ['--chain', 'mock-budget', '--task', 'tasks/x.md', '--max-usd', 'none']).status, 0);
  const runDir = onlyRun(dir);
  const runId = runDir.split(/[\\/]/).at(-1);
  assert.equal(run(dir, ['--rematch', join('runs', runId), '--rematch-seed', '1', '--max-usd', '1']).status, 4);
  assert.equal(run(dir, ['--replay', join('runs', runId), '--replay-date', '2026-09-23', '--max-usd', '1']).status, 4);
  for (const side of [`${runDir}.rematch-1`, `${runDir}.replay-2026-09-23`]) {
    assert.ok(!existsSync(join(side, 'report.json')), `${side}: a stopped side run must not look finished`);
    const partial = readJson(join(side, PARTIAL_REPORT_FILE));
    assertValid(partial, side);
    assert.equal(partial.partial, true);
    assert.equal(partial.stoppedAtStage, readJson(join(side, 'STOPPED-budget.json')).stoppedAt);
    assert.equal(partial.runId, side.split(/[\\/]/).at(-1));
    assert.equal(partial.task, 'tasks/x.md');
  }
});
