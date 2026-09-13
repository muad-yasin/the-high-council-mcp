// test/replay.test.js
//
// v5 §1 candidate 9: replayable run transcript - numbered, indented,
// step-by-step, with a --json flag for machine-readable output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTranscript, renderTranscriptText } from '../src/replay.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function fixtureReport() {
  return {
    runId: '2026-09-13T00-00-00-000Z',
    chain: 'verify',
    passed: true,
    proposals: [
      { id: 'A-1', lab: 'a', title: 'A distinctive proposal title', what: 'Adds a counter.', withdrawn: false },
    ],
    stages: [
      { label: 'criteria', provider: 'mock', model: 'mock-criteria' },
      { label: 'build', provider: 'mock', model: 'mock-builder' },
    ],
    signoff: [{ provider: 'a', signedOff: true, objections: [] }],
  };
}

test('test_replay_output: the text transcript contains every proposal\'s text and the final verdict', () => {
  const steps = buildTranscript(fixtureReport());
  const text = renderTranscriptText(steps);
  assert.match(text, /A distinctive proposal title/);
  assert.match(text, /Verdict: PASSED/);
  // numbered
  assert.match(text, /^\s*1\. /m);
});

test('--json output is valid JSON containing the same content', () => {
  const steps = buildTranscript(fixtureReport());
  const json = JSON.stringify(steps, null, 2);
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.some(s => s.text.includes('A distinctive proposal title')));
  assert.ok(parsed.some(s => s.text.startsWith('Verdict:')));
});

test('council replay --run against a malformed report.json degrades cleanly, no thrown stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-replay-bad-'));
  const runDir = join(dir, 'run');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'report.json'), '{not valid json');
  assert.throws(() => execFileSync('node', [cli, 'replay', '--run', runDir], { encoding: 'utf8' }));
  try {
    execFileSync('node', [cli, 'replay', '--run', runDir], { encoding: 'utf8' });
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(err.stderr, /not valid JSON/);
    assert.doesNotMatch(err.stderr, /SyntaxError/);
  }
});

test('council replay --run --json prints valid JSON from a real report.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-replay-'));
  const runDir = join(dir, 'run');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(fixtureReport()));
  const out = execFileSync('node', [cli, 'replay', '--run', runDir, '--json'], { encoding: 'utf8', cwd: dir });
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.some(s => s.text.includes('A distinctive proposal title')));
});

test('council replay --run (text mode) contains the proposal and the verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-replay-text-'));
  const runDir = join(dir, 'run');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(fixtureReport()));
  const out = execFileSync('node', [cli, 'replay', '--run', runDir], { encoding: 'utf8', cwd: dir });
  assert.match(out, /A distinctive proposal title/);
  assert.match(out, /Verdict: PASSED/);
});
