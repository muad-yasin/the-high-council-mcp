// MLLM Coder v6 item 2 (relay/runs/2026-09-16T12-16-41-099Z/revise-3.md) - acceptance coverage
// for spans.jsonl, a separate GUI-polling log alongside stage-log.jsonl and audit.jsonl. Same
// mock-debate/execFileSync CLI-integration pattern as test/spans-cli.test.js, so this runs fully
// offline against the repo's own mock provider (src/providers.js's callMock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpanRecord, spansFilePath, readLastSpanRecord } from '../src/progress-spans.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function runMockDebate(dir, extraArgs = []) {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'A spans.jsonl acceptance-test task.');
  execFileSync('node', [cli, '--chain', 'mock-debate', '--task', 'tasks/smoke.md', ...extraArgs], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });
  const runId = readdirSync(join(dir, 'runs'))[0];
  return { runId, runDir: join(dir, 'runs', runId) };
}

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

test('1. a mocked run produces spans.jsonl with at least one record per round/stage boundary actually executed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans2-'));
  const { runDir } = runMockDebate(dir);
  const spanLines = readLines(spansFilePath(runDir));
  const stageLines = readLines(join(runDir, 'stage-log.jsonl'));
  // Every stage-log.jsonl line (stage or round boundary) has a matching spans.jsonl record.
  assert.ok(spanLines.length >= stageLines.length, `expected >= ${stageLines.length} span records, got ${spanLines.length}`);
  const roundBoundariesInStageLog = stageLines.filter(l => l.kind === 'round').length;
  const roundBoundariesInSpans = spanLines.filter(l => typeof l.stage === 'string' && l.stage.startsWith('round-')).length;
  assert.equal(roundBoundariesInSpans, roundBoundariesInStageLog);
});

test('2. every record is parseable JSON with run_id/stage/round/started_at present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans2-'));
  const { runId, runDir } = runMockDebate(dir);
  const spanLines = readLines(spansFilePath(runDir));
  assert.ok(spanLines.length > 0);
  for (const line of spanLines) {
    assert.equal(line.run_id, runId);
    assert.ok(typeof line.stage === 'string' && line.stage.length > 0, JSON.stringify(line));
    assert.ok('round' in line, JSON.stringify(line));
    assert.ok('started_at' in line, JSON.stringify(line));
  }
});

test('3. already-written records stay readable after a simulated crash (torn final line)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans2-'));
  const { runDir } = runMockDebate(dir);
  const path = spansFilePath(runDir);
  const completeLinesBefore = readLines(path);
  assert.ok(completeLinesBefore.length > 0);
  // Simulate a crash mid-write: append a torn (incomplete) JSON fragment with no trailing
  // newline, as a process killed mid-appendFileSync would leave behind.
  appendFileSync(path, '{"run_id":"x","stage":"round-9","started_a');
  const linesAfterCrash = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  // Every line written before the crash still parses exactly as before.
  const parsedComplete = linesAfterCrash.slice(0, -1).map(l => JSON.parse(l));
  assert.deepEqual(parsedComplete, completeLinesBefore);
  // The torn line itself does not parse, but does not corrupt anything before it.
  assert.throws(() => JSON.parse(linesAfterCrash[linesAfterCrash.length - 1]));
  // readLastSpanRecord() tolerates the torn trailing line and returns the last real record.
  const last = readLastSpanRecord(runDir);
  assert.deepEqual(last, completeLinesBefore[completeLinesBefore.length - 1]);
});

test('4. a second mocked run writes to its own separate run-id file with no collision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans2-'));
  const run1 = runMockDebate(dir);
  // A second, distinct run directory (mock-debate's own runId is a timestamp, so drive two
  // runs from two distinct temp dirs to force two genuinely separate run.json/runId pairs,
  // exactly as two concurrent real runs would never share a runDir).
  const dir2 = mkdtempSync(join(tmpdir(), 'thc-spans2-'));
  const run2 = runMockDebate(dir2);
  assert.notEqual(run1.runId, run2.runId);
  const lines1 = readLines(spansFilePath(run1.runDir));
  const lines2 = readLines(spansFilePath(run2.runDir));
  assert.ok(lines1.every(l => l.run_id === run1.runId));
  assert.ok(lines2.every(l => l.run_id === run2.runId));
});

test('5. report.json shape is unchanged by this feature (spans.jsonl is purely additive)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans2-'));
  const { runDir } = runMockDebate(dir);
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.ok(!('spans' in report), 'report.json must not gain a spans field from this change');
});

test('buildSpanRecord: placeholder-marks started_at/cost_so_far with a reason when not supplied, never invents a value', () => {
  const rec = buildSpanRecord({ runId: 'r1', stage: 'criteria', round: null, seatsParticipating: ['lab-a'] });
  assert.equal(rec.started_at, null);
  assert.equal(typeof rec.started_at_reason, 'string');
  assert.equal(rec.cost_so_far, null);
  assert.equal(typeof rec.cost_so_far_reason, 'string');
});

test('buildSpanRecord: real values pass through untouched, with no placeholder-reason fields', () => {
  const rec = buildSpanRecord({
    runId: 'r1', stage: 'panel-1-labA', round: 1, seatsParticipating: ['labA'],
    startedAt: '2026-09-16T00:00:00.000Z', endedAt: '2026-09-16T00:00:01.000Z',
    outcome: 'ok', costSoFar: 0.0123,
  });
  assert.equal(rec.started_at, '2026-09-16T00:00:00.000Z');
  assert.equal(rec.cost_so_far, 0.0123);
  assert.equal('started_at_reason' in rec, false);
  assert.equal('cost_so_far_reason' in rec, false);
});
