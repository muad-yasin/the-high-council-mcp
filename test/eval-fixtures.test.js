// test/eval-fixtures.test.js
//
// MLLM Coder v4 item 5: the fixed fixture set and its scorer. Offline - the self-test makes no
// model call and no network request. It checks the fixtures and the scoring arithmetic; it
// measures no reviewer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCases, scoreVerdicts } from '../scripts/eval-fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'eval-fixtures.mjs');

test('the fixture set is 10 cases, 5 buggy and 5 clean, read from disk', () => {
  const cases = loadCases();
  assert.equal(cases.length, 10);
  assert.equal(cases.filter(c => c.expected === 'buggy').length, 5);
});

test('--self-test passes: every fixture is honest and the scorer gets the three mock verdict sets right', () => {
  const r = spawnSync(process.execPath, [script, '--self-test'], { encoding: 'utf8', timeout: 300_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /self-test passed/);
  assert.equal((r.stdout.match(/\bok$/gm) || []).length, 10, 'one integrity line per fixture');
});

test('scoreVerdicts refuses a missing or unknown verdict instead of counting it as a pass', () => {
  const cases = loadCases();
  const all = Object.fromEntries(cases.map(c => [c.id, 'pass']));
  assert.throws(() => scoreVerdicts(cases, { ...all, [cases[0].id]: undefined }), /must be "flag" or "pass"/);
  assert.throws(() => scoreVerdicts(cases, { ...all, [cases[0].id]: 'maybe' }), /must be "flag" or "pass"/);
});

test('the harness makes no network request and no efficacy claim', () => {
  const src = readFileSync(script, 'utf8');
  assert.doesNotMatch(src, /\bfetch\(|node:https?\b|from 'https?'|\bXMLHttpRequest\b/);
  assert.doesNotMatch(src, /\b(outperform|better than|beats|more accurate|improv(es|ement) over)\b/i);
});
