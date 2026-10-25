// BUG-D-006: submit_stage wrote `<stage>.md` first, in place with O_TRUNC, then `<stage>.usage.json`. A failure in between (or part way through the text) left a truncated or empty answer that made the stage look answered.
// The main run's order is usage record first, text last, both atomic (temp file + rename). Offline, no API key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submitStageAnswer } from '../src/stage-submission.js';

const tmpNames = dir => readdirSync(dir).filter(n => n.includes('.tmp'));

test('submitStageAnswer: a symbolic link at <stage>.usage.json refuses the call, and no <stage>.md is left behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-order-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'stage-order-target-'));
  try {
    const sentinel = join(elsewhere, 'sentinel.txt');
    writeFileSync(sentinel, 'untouched');
    symlinkSync(sentinel, join(dir, 'build.usage.json'));
    assert.throws(() => submitStageAnswer(dir, 'build', '# A real draft\n\nContent here.'), /symbolic link/);
    assert.equal(existsSync(join(dir, 'build.md')), false, 'the answer text must not exist when the usage record was refused');
    assert.equal(readFileSync(sentinel, 'utf8'), 'untouched', 'nothing is written through the link');
    assert.deepEqual(tmpNames(dir), [], 'no temp file is left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('submitStageAnswer: a symbolic link at <stage>.md is a duplicate (the link exists), so the answer goes to <stage>.late.md and nothing is written through the link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-order-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'stage-order-target-'));
  try {
    const sentinel = join(elsewhere, 'sentinel.txt');
    writeFileSync(sentinel, 'untouched');
    symlinkSync(sentinel, join(dir, 'build.md'));
    const r = submitStageAnswer(dir, 'build', '# A real draft\n\nContent here.');
    assert.equal(r.isDuplicate, true);
    assert.equal(readFileSync(sentinel, 'utf8'), 'untouched');
    assert.equal(readFileSync(join(dir, 'build.late.md'), 'utf8'), '# A real draft\n\nContent here.');
    assert.deepEqual(tmpNames(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('submitStageAnswer: a successful call leaves the answer text, a parseable usage record and no temp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-order-'));
  try {
    const content = '# A real draft\n\nContent here.';
    const r = submitStageAnswer(dir, 'build', content);
    assert.equal(r.isDuplicate, false);
    assert.equal(readFileSync(join(dir, 'build.md'), 'utf8'), content);
    const usage = JSON.parse(readFileSync(join(dir, 'build.usage.json'), 'utf8'));
    assert.equal(usage.provider, 'external');
    assert.deepEqual(tmpNames(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
