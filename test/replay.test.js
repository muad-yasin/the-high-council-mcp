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

// Bug audit 2026-10-24 C-018: `council replay --run` printed a proposal's title and what-text from report.json straight to the terminal. A folder from someone else, or a proposer reply, holding an escape sequence, a carriage return or a bidi override could clear or retitle the terminal and overprint lines; every other log sink goes through terminalSafe. The same text with the controls removed still reads.
test('council replay --run (text mode) prints no terminal control or bidi character from a hostile title, and the readable words stay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-replay-hostile-'));
  const runDir = join(dir, 'run');
  mkdirSync(runDir);
  const hostile = 'fine title\u001b[2J\u001b]0;pwned\u0007 ‮evil‬ \rOVERPRINT \u009b31m';
  const report = fixtureReport();
  report.proposals = [{ id: 'A-1', lab: 'a', title: hostile, what: hostile, withdrawn: false }];
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report));
  const out = execFileSync('node', [cli, 'replay', '--run', runDir], { encoding: 'utf8', cwd: dir });
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(out, /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/, 'no C0/C1 control, DEL or bidi character reaches the terminal');
  assert.match(out, /fine title/);
  assert.match(out, /OVERPRINT/, 'the words around the removed controls are kept');
});

test('council replay --run --json carries no raw DEL, C1 or bidi character either, and parses to the same title', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-replay-hostile-json-'));
  const runDir = join(dir, 'run');
  mkdirSync(runDir);
  const hostile = 'fine title\u001b[2J ‮evil‬ \u009b31m\u007f';
  const report = fixtureReport();
  report.proposals = [{ id: 'A-1', lab: 'a', title: hostile, what: 'w', withdrawn: false }];
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report));
  const out = execFileSync('node', [cli, 'replay', '--run', runDir, '--json'], { encoding: 'utf8', cwd: dir });
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(out, /[\u007F-\u009F؜‎‏‪-‮⁦-⁩]/, 'JSON.stringify leaves these raw: the verb escapes them');
  assert.ok(JSON.parse(out).some(step => step.text.includes(hostile)), 'the escaped document parses to the same title');
});
