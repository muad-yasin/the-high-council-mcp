// test/stage-jsonl-log.test.js
//
// v5 §1 candidate 14: structured JSON stage logs. Each stage writes one
// JSONL line to stage-log.jsonl in the run folder, alongside the existing
// markdown/report.json artifacts, so future tooling can read a run without
// re-parsing prose. No prompt content - seat/lab/counts/cost/timing only,
// the same privacy posture as verdict-stats.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

test('test_stage_jsonl_log: a mock chain run writes one well-formed JSONL line per stage', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'thc-stage-jsonl-'));
  try {
    mkdirSync(join(cwd, 'tasks'));
    writeFileSync(join(cwd, 'tasks', 'probe.md'), 'Fixture task for the mock chain.');
    execFileSync('node', [cli, '--task', 'tasks/probe.md', '--chain', 'mock'], { cwd, encoding: 'utf8' });

    const runsDir = join(cwd, 'runs');
    const runId = readdirSync(runsDir)[0];
    const logPath = join(runsDir, runId, 'stage-log.jsonl');
    assert.ok(existsSync(logPath), 'stage-log.jsonl must exist alongside the run\'s other artifacts');

    const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'at least one stage must have logged a line');

    // report.json's own stages array is the independent count of how many
    // real (non-cached) stages this run had - the JSONL must have exactly
    // one line per stage, not more, not fewer.
    const report = JSON.parse(readFileSync(join(runsDir, runId, 'report.json'), 'utf8'));
    assert.equal(lines.length, report.stages.length, 'one JSONL line per stage, matching report.json\'s stage count');

    for (const line of lines) {
      const row = JSON.parse(line); // throws if any line is not well-formed JSON
      for (const field of ['stage', 'seat', 'lab', 'tokensIn', 'tokensOut', 'ms', 'outcome']) {
        assert.ok(field in row, `missing required field "${field}" in ${line}`);
      }
      assert.equal(typeof row.tokensIn, 'number');
      assert.equal(typeof row.tokensOut, 'number');
      assert.doesNotMatch(line, /Fixture task for the mock chain/, 'no prompt content may leak into the stage log');
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
