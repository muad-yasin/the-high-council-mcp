// 0.8.4 unit 1 (C&C 09 Nov 2026, FIX): sentences a person or a reader of the schemas sees, kept true to the code (WORDING U1-w13 to U1-w16). Text-only checks, offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { excerptPauseText } from '../src/secret-pause.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the schemas say what the code records: pasted_by is main-session or null; the report count includes lines that could not be cut', () => {
  const ex = JSON.parse(read('schemas/excerpts-v1.json'));
  assert.match(JSON.stringify(ex), /main-session for a request the handling session answered with a paste or a decline; null for a session read and for a request left unanswered or not cut\./);
  assert.doesNotMatch(JSON.stringify(ex), /The name the stage answer declared/);
  assert.match(read('schemas/report-v1.json'), /or a request that was declined, left unanswered, withheld or not cut\) and the sha256/);
});

test('the pause text for an excerpt does not say a pasted seat request was read by the session', () => {
  const text = excerptPauseText({ label: 'excerpt-E-3', findings: [{ line: 2, name: 'x' }] }, { runId: 'r1', command: 'council' });
  assert.match(text, /This text is lines of a file in your project: one the handling session read for its answer, or one a seat asked to see and the handling session answered\. Read it, then choose, at a terminal:/);
});

test('--help and the changelog name the approval switch and exit 26', () => {
  const cli = read('src/cli.js');
  assert.match(cli, /--approve-excerpts \(a start or a --resume; "approve_excerpts": true in the chain does the same\) asks for your approval before any seat is shown project text the handling session added: the run stops with exit 26, nothing run and nothing spent;/);
  assert.match(cli, /council gate answer <run folder> <gate>\\` lets you approve, edit or refuse each text, and the next --resume records your answers and goes on\./);
  assert.match(read('CHANGELOG.md'), /- \*\*`--approve-excerpts` holds the excerpts at your approval, and exit 26 says so \(0\.8\.4\)\.\*\* With `--approve-excerpts` \(or `"approve_excerpts": true` in the chain\)/);
});
