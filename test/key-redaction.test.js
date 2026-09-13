// test/key-redaction.test.js
//
// v5 §1 candidate 11: `council doctor --scan-artifacts` must flag a key-shaped string pasted
// into a task file or chain config, name the file and line, and never echo the matched text
// itself back into its own warning. Must also not false-positive on the legitimate hex-looking
// content this project's own files are full of (run-folder timestamps, git SHAs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanText, scanArtifacts } from '../src/key-redaction.js';

test('test_key_redaction_scan: an OpenAI-shaped key is flagged by file and line, value never echoed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-redact-'));
  mkdirSync(join(dir, 'tasks'));
  const fakeKey = 'sk-' + 'A'.repeat(40);
  writeFileSync(join(dir, 'tasks', 'my-task.md'), `# Task\n\nUse this key: ${fakeKey}\n`);

  const { findings, filesScanned } = scanArtifacts([join(dir, 'tasks')]);
  assert.equal(filesScanned, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, join(dir, 'tasks', 'my-task.md'));
  assert.equal(findings[0].line, 3);
  assert.ok(findings[0].pattern.includes('OpenAI'));
  // The finding object itself must carry no field containing the matched key text.
  const serialised = JSON.stringify(findings);
  assert.equal(serialised.includes(fakeKey), false);
});

test('test_key_redaction_scan: true negative - a git SHA and a run-folder timestamp are not flagged', () => {
  const text = [
    'Built on commit 405658f9c1a2b3d4e5f6a7b8c9d0e1f2a3b4c5d6.',
    'See runs/2026-09-13T18-01-29-810Z/report.json for the full run.',
  ].join('\n');
  assert.deepEqual(scanText(text), []);
});

test('scanText: a Mistral-shaped 32-hex-char key is only flagged in Mistral context', () => {
  const hex32 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  assert.deepEqual(scanText(`random hash: ${hex32}`, 'notes.md'), []);
  assert.equal(scanText(`MISTRAL_API_KEY=${hex32}`, 'notes.md').length, 1);
});

test('scanText: a generic bearer-token assignment is flagged', () => {
  const hits = scanText('api_key: "abcdefghijklmnopqrstuvwx1234"');
  assert.ok(hits.length >= 1);
});
