// 0.8.4 unit 1 (C&C 09 Nov 2026, FIX): a second answer for a stage is accepted and kept as <stage>.late.md; the session_reads / excerpt_answers it carries go into the late usage file, which no resume reads. The reply says so
// (WORDING U1-w12), so a silent loss of the handler's reads cannot happen. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHeldForTest } from '../src/held-roles.js';
import { submitStageAnswer, duplicateReadsNote } from '../src/stage-submission.js';
import * as RS from '../src/run-status.js';
import { pendingExcerptWork } from '../src/excerpt-resume.js';
import * as H from './held-prompts/held-084-a.js';

const dirs = [];
afterEach(() => { setHeldForTest(null); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

test('the note names the fields the duplicate carried and where they sit; a duplicate that carried neither adds nothing', () => {
  const reads = [{ path: 'a.js', why: 'w' }];
  assert.equal(duplicateReadsNote('revise-1', { sessionReads: reads }), ' Not recorded: session_reads. They are kept, unread, in "revise-1.late.usage.json"; only the answer written first for a stage is read for them.');
  assert.equal(duplicateReadsNote('build', { excerptAnswers: [{ request: 1 }] }), ' Not recorded: excerpt_answers. They are kept, unread, in "build.late.usage.json"; only the answer written first for a stage is read for them.');
  assert.match(duplicateReadsNote('build', { sessionReads: reads, excerptAnswers: [{ request: 1 }] }), /^ Not recorded: session_reads and excerpt_answers\. /);
  assert.equal(duplicateReadsNote('build', {}), '');
  assert.equal(duplicateReadsNote('build', { sessionReads: [], excerptAnswers: [] }), '');
  assert.equal(duplicateReadsNote('build'), '');
});

test('a duplicate submission keeps its reads in the late usage file, no resume reads them, and the MCP reply carries the note', () => {
  setHeldForTest({ excerptsBlock: H.excerptsBlock, sessionReadsField: H.sessionReadsField });
  const dir = mkdtempSync(join(tmpdir(), 'thc-dup-')); dirs.push(dir);
  const first = submitStageAnswer(dir, 'revise-1', '# Plan\n\nFirst.\n', { excerptSwitch: RS.excerptSwitchForSubmit, sessionReads: [{ path: 'src/a.js', why: 'First read.' }] });
  assert.equal(first.isDuplicate, false);
  const second = submitStageAnswer(dir, 'revise-1', '# Plan\n\nSecond.\n', { excerptSwitch: RS.excerptSwitchForSubmit, sessionReads: [{ path: 'src/b.js', why: 'Second read.' }] });
  assert.equal(second.isDuplicate, true);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'revise-1.late.usage.json'), 'utf8')).session_reads.map(r => r.path), ['src/b.js']);
  const { work } = pendingExcerptWork(dir, []);
  assert.deepEqual(work.flatMap(w => w.reads.map(r => r.path)), ['src/a.js'], 'only the first answer\'s reads are read');
  const server = readFileSync(new URL('../src/mcp/server.js', import.meta.url), 'utf8');
  assert.match(server, /to resolve\.\$\{duplicateReadsNote\(stage, \{ sessionReads: session_reads, excerptAnswers: excerpt_answers \}\)\}\$\{member \?/);
});
