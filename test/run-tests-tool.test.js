// The opt-in run_tests seat tool runs test files only (security scan 2026-09-26, THC #4). It ran any
// readable file in the workspace under node, a run folder's model output included. Now: the file,
// by its real name as well as the name asked for, must end in .js, .mjs, .cjs or .ts, and nothing
// under runs/ runs at all. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool } from '../src/tools.js';

const PASSING = "import test from 'node:test';\ntest('ok', () => {});\n";

function withoutNodeTestContext(fn) {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try { return fn(); } finally { if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved; }
}

test('run_tests: only test files, never under runs/, and a real test file still runs', () => {
  const ws = mkdtempSync(join(tmpdir(), 'thc-run-tests-'));
  try {
    writeFileSync(join(ws, 'package.json'), '{"name":"x","version":"0.0.0"}');
    mkdirSync(join(ws, 'runs', '2026-01-01T00-00-00-000Z'), { recursive: true });
    // Model output that happens to be valid JavaScript.
    writeFileSync(join(ws, 'runs', '2026-01-01T00-00-00-000Z', 'build.md'), PASSING);
    writeFileSync(join(ws, 'runs', '2026-01-01T00-00-00-000Z', 'seat.test.js'), PASSING);
    writeFileSync(join(ws, 'notes.md'), PASSING);
    writeFileSync(join(ws, 'script.sh'), PASSING);
    symlinkSync(join(ws, 'notes.md'), join(ws, 'looks.test.js'));
    writeFileSync(join(ws, 'ok.test.mjs'), PASSING);
    const run = file => withoutNodeTestContext(() => runTool('run_tests', { file }, { cwd: ws }));
    for (const file of ['notes.md', 'script.sh', 'looks.test.js']) {
      const r = run(file);
      assert.equal(r.ok, false, file);
      assert.match(r.error, /not a test file/, file);
    }
    for (const file of ['runs/2026-01-01T00-00-00-000Z/build.md', 'runs/2026-01-01T00-00-00-000Z/seat.test.js']) {
      const r = run(file);
      assert.equal(r.ok, false, file);
      assert.match(r.error, /not a test file|inside runs\//, file);
    }
    assert.match(run('runs/2026-01-01T00-00-00-000Z/seat.test.js').error, /inside runs\//);
    const ok = run('ok.test.mjs');
    assert.equal(ok.ok, true, JSON.stringify(ok));
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
