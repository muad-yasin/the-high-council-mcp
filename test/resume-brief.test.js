// relay/test/resume-brief.test.js
//
// v2 plan §5 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md). Pins the two
// load-bearing properties the merged board position required: a short brief a returning,
// fresh-context session can act on, and idempotent regeneration - RESUME.md is never itself
// trusted, only ever rebuilt from run.json + the files actually on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { generateResumeBrief } from '../src/resume-brief.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));

function fixtureRun() {
  const dir = mkdtempSync(join(tmpdir(), 'resume-brief-test-'));
  const taskPath = join(dir, 'task.md');
  writeFileSync(taskPath, '# A fixture task\n\nDoes the fixture thing, for this test only.');
  writeFileSync(join(dir, 'criteria.md'), 'criteria stage output');
  writeFileSync(join(dir, 'build.md'), 'build stage output');
  const runMeta = { chain: 'mock', task: taskPath };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(runMeta));
  return { dir, runMeta };
}

test('test_resume_brief_after_stage_completion: names completed stages, the pending state, and a next action, under 500 words', () => {
  const { dir, runMeta } = fixtureRun();
  try {
    const brief = generateResumeBrief({ runId: 'fixture-run', dir, runMeta, chainConfig: mockConfig });
    assert.match(brief, /RESUME BRIEF — run fixture-run/);
    assert.match(brief, /A fixture task/);
    assert.match(brief, /- criteria: complete/);
    assert.match(brief, /- build: complete/);
    assert.doesNotMatch(brief, /- critique: complete/, 'a stage with no output file on disk must not be reported complete');
    assert.match(brief, /## Next action for the driving session/);
    const wordCount = brief.trim().split(/\s+/).length;
    assert.ok(wordCount < 500, `expected under 500 words, got ${wordCount}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('test_resume_brief_idempotent: regenerating from the same on-disk state twice is byte-identical', () => {
  const { dir, runMeta } = fixtureRun();
  try {
    const first = generateResumeBrief({ runId: 'fixture-run', dir, runMeta, chainConfig: mockConfig });
    const second = generateResumeBrief({ runId: 'fixture-run', dir, runMeta, chainConfig: mockConfig });
    assert.equal(first, second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a completed run (deliverable.md present) reports full status and no pending stage', () => {
  const { dir, runMeta } = fixtureRun();
  try {
    writeFileSync(join(dir, 'deliverable.md'), 'the finished deliverable');
    const brief = generateResumeBrief({ runId: 'fixture-run', dir, runMeta, chainConfig: mockConfig });
    assert.match(brief, /Stage: none - run is complete/);
    assert.match(brief, /Run is complete\. Deliverable at/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v3 §2: a recorded scope amendment surfaces in the resume brief, not just the run folder', () => {
  const { dir, runMeta } = fixtureRun();
  try {
    writeFileSync(join(dir, 'AMENDMENTS.md'), 'old -> abc123 | added the mobile-web-app requirement, deliberately | 2026-09-13T13:00:00Z\n');
    const brief = generateResumeBrief({ runId: 'fixture-run', dir, runMeta, chainConfig: mockConfig });
    assert.match(brief, /Scope amendment\(s\) recorded/);
    assert.match(brief, /added the mobile-web-app requirement, deliberately/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
