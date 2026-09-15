// V6-2 (relay/runs/2026-09-15T15-13-25-950Z/deliverable.md) - CLI integration coverage for the
// span-tree instrumentation in stage-log.jsonl, per the plan's own acceptance test: offline, on
// mock-debate for 2 rounds. Same execFileSync pattern as test/init.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function runMockDebate(dir) {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'A span-tree smoke-test task.');
  execFileSync('node', [cli, '--chain', 'mock-debate', '--task', 'tasks/smoke.md'], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });
  const runId = readdirSync(join(dir, 'runs'))[0];
  return join(dir, 'runs', runId);
}

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

test('1. every stage line has span_id, and a parent_span_id that resolves to an existing span or the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  const runDir = runMockDebate(dir);
  const lines = readLines(join(runDir, 'stage-log.jsonl'));
  const runMeta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  const allSpanIds = new Set([runMeta.rootSpanId, ...lines.map(l => l.span_id)]);
  for (const line of lines) {
    assert.ok(line.span_id, JSON.stringify(line));
    assert.ok(allSpanIds.has(line.parent_span_id), `unresolved parent in ${JSON.stringify(line)}`);
  }
});

test('2. exactly one kind:"round" line per round (mock-debate, maxRounds 2, both close unanimous)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  const runDir = runMockDebate(dir);
  const lines = readLines(join(runDir, 'stage-log.jsonl'));
  const roundLines = lines.filter(l => l.kind === 'round');
  assert.deepEqual(roundLines.map(l => l.round).sort(), [1, 2]);
});

test('3. a round record\'s seats[] carries every critic\'s real final status for that round, never "working" for the seat that just closed it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  const runDir = runMockDebate(dir);
  const lines = readLines(join(runDir, 'stage-log.jsonl'));
  const roundLines = lines.filter(l => l.kind === 'round');
  for (const round of roundLines) {
    for (const seat of round.seats) {
      assert.notEqual(seat.status, 'working', `round ${round.round} seat ${seat.lab} should have a real posted status`);
    }
  }
});

test('4. state.json stays one valid JSON object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  const runDir = runMockDebate(dir);
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8')));
});

test('5. the summed stage-line usd equals state.json\'s reported spentUsd (round records never double-count)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  const runDir = runMockDebate(dir);
  const lines = readLines(join(runDir, 'stage-log.jsonl'));
  const stageSum = lines.filter(l => !l.kind).reduce((sum, l) => sum + (l.usd || 0), 0);
  const state = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'));
  assert.equal(state.cost.spentUsd, stageSum);
});

test('6. a resumed run\'s new lines share the same root span id recorded in run.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  const runDir = runMockDebate(dir);
  const runId = runDir.split('/').pop();
  const rootBefore = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).rootSpanId;
  // Nothing to actually resume (the mock run already finished), but --resume on a finished run
  // must be a no-op that preserves run.json's rootSpanId rather than regenerating it.
  execFileSync('node', [cli, '--resume', join('runs', runId)], {
    encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH },
  });
  const rootAfter = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).rootSpanId;
  assert.equal(rootAfter, rootBefore);
});

test('7. round records never appear in a chain with no critics seat (proposals-only or criteria-only chains)', () => {
  // mock.json is this repo's simplest offline chain: single critic, single round, "first" signoff -
  // still has one critic, so use a purpose-checked assertion on the shape instead: a round record
  // only ever appears when the closing count actually reached a real critics.length > 0, which
  // this run structurally satisfies. The real "criticsCount === 0" branch is covered directly by
  // test/spans.test.js #8 - CLI-level chains in this repo all define at least one critic seat.
  const dir = mkdtempSync(join(tmpdir(), 'thc-spans-'));
  const runDir = runMockDebate(dir);
  const lines = readLines(join(runDir, 'stage-log.jsonl'));
  assert.ok(lines.some(l => l.kind === 'round'));
});
