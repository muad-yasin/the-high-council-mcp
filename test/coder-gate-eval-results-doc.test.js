// test/coder-gate-eval-results-doc.test.js
//
// harness features v6, item A (relay/runs/2026-09-15T15-12-52-325Z/deliverable.md): the fixture
// self-test's raw numbers are published to docs/coder-gate-eval-results.md, not just run and
// discarded. This test enforces the acceptance criteria named in the plan directly: the file
// exists, carries at least one real numeric pass/fail count, states its method in prose, and
// contains no efficacy-claim language - a comparison this repo has never run and does not claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = join(root, 'docs', 'coder-gate-eval-results.md');

test('docs/coder-gate-eval-results.md exists', () => {
  assert.equal(existsSync(docPath), true);
});

test('the doc carries real numeric pass/fail counts, not just prose', () => {
  const text = readFileSync(docPath, 'utf8');
  assert.match(text, /flagged \d+ \| buggy flagged \d+ \| clean flagged \d+ \| clean passed \d+ \| buggy passed \d+/, 'expected the scorer\'s own numeric summary line to appear verbatim');
  assert.match(text, /Fixtures run: \d+/);
});

test('the doc states its method in prose', () => {
  const text = readFileSync(docPath, 'utf8');
  assert.match(text, /eval-fixtures\.mjs --self-test/);
});

test('the doc makes no efficacy claim - enforced, not just written honestly', () => {
  const text = readFileSync(docPath, 'utf8');
  const hit = /\b(better|outperform|superior|proves|wins|more accurate)\b/i.exec(text);
  assert.equal(hit, null, hit ? `efficacy-claim language found: "${hit[0]}"` : undefined);
});
