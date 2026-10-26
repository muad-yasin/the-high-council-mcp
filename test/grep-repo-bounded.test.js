// BUG-D-016 (bug audit 24 Okt 2026): grep_repo compiled a SEAT's pattern (model output) and ran it in this process on every line of every file, so a nested-quantifier pattern on one long line
// blocked the whole run with no way to interrupt it. The reading and matching now run in a worker thread that is stopped after a time limit (10 seconds); the calling thread keeps the walk, the denylist, the git-ignore filter, the redaction and the cap. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tools from '../src/tools.js';
const { runTool } = tools;
const GREP_LIMITS = tools.GREP_LIMITS ?? { timeoutMs: 0 };   // absent on the unfixed code: the red run then shows the unbounded search finishing late with ok:true instead of failing on an import

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'grep-bounded-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.js'), 'const alpha = 1;\nconst beta = 2;\nconst alphabet = 3;\n');
  writeFileSync(join(dir, 'notes.md'), `${'a'.repeat(32)}!\n`);   // one line that ends in a character the nested pattern cannot match: 2^32 backtracking steps (many seconds), not endless, so the unfixed code ends late instead of hanging the red run
  return dir;
}

test('GB-1 a catastrophic pattern is stopped after the time limit: ok false, the sentence, and the call RETURNS', () => {
  const dir = repo(); const old = GREP_LIMITS.timeoutMs; GREP_LIMITS.timeoutMs = 2000;
  try {
    const t0 = Date.now();
    const r = runTool('grep_repo', { pattern: '^(a+)+$' }, { cwd: dir });
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
    assert.equal(r.error, 'grep_repo stopped after 2 seconds: the pattern is too slow on this repository. Use a simpler pattern.');
    assert.ok(Date.now() - t0 < 15_000, 'it returned');
  } finally { GREP_LIMITS.timeoutMs = old; rmSync(dir, { recursive: true, force: true }); }
});

test('GB-2 an ordinary search is unchanged: matches with file, line and text, in walk order; a bad pattern is still refused in the parent', () => {
  const dir = repo();
  try {
    const r = runTool('grep_repo', { pattern: 'alpha' }, { cwd: dir });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.matches.map(m => [m.file, m.line, m.text]), [['src/a.js', 1, 'const alpha = 1;'], ['src/a.js', 3, 'const alphabet = 3;']]);
    const bad = runTool('grep_repo', { pattern: '(' }, { cwd: dir });
    assert.equal(bad.ok, false); assert.match(bad.error, /^bad pattern: /);
    assert.deepEqual(runTool('grep_repo', {}, { cwd: dir }).error, 'grep_repo requires a pattern');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GB-3 a secret-shaped match line is redacted in the parent, and the result is capped at 500 matches', () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, 'k.txt'), 'token=ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' + '\n');
    const r = runTool('grep_repo', { pattern: 'token=' }, { cwd: dir });
    assert.equal(r.ok, true);
    assert.ok(!JSON.stringify(r.matches).includes('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'), 'the value is not returned');
    writeFileSync(join(dir, 'many.txt'), 'x\n'.repeat(700));
    const many = runTool('grep_repo', { pattern: '^x$' }, { cwd: dir });
    assert.equal(many.matches.length, 500);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GB-4 a very long matching line comes back capped (regression guard): the search still succeeds and each returned line is under 6,000 characters', () => {
  const dir = repo();
  try {
    for (let i = 0; i < 3; i++) writeFileSync(join(dir, `min${i}.js`), `needle${'x'.repeat(1_000_000)}\n`);
    const r = runTool('grep_repo', { pattern: '^needle' }, { cwd: dir });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.equal(r.matches.length, 3);
    for (const m of r.matches) assert.ok(m.text.length < 6_000 && m.text.startsWith('needle'), `capped: ${m.text.length}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
