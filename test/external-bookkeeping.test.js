// Bug audit 2026-09-28, external seats #2: an external answer is first read on a resume, as a cache
// hit, and onStage returned early for every cache hit - so a pasted draft never got the partial-output
// check (the only truncation signal a stop-less external reply has), a stage-log line, an audit entry
// or a span. Its first replay now counts as its completion. Mock + external seats, no keys, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const env = { PATH: process.env.PATH };

test('a half-pasted external draft gets a partial_output warning and a stage-log line on its first replay, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-ext-book-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
    let r = spawnSync('node', [cli, '--chain', 'mock-external', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const runId = readdirSync(join(dir, 'runs'))[0];
    const runDir = join(dir, 'runs', runId);
    assert.ok(existsSync(join(runDir, 'NEEDS-build.md')), readdirSync(runDir).join(', '));
    // An unclosed code fence: the shape a reply cut off mid-paste leaves.
    writeFileSync(join(runDir, 'build.md'), '# Plan\n\n## Decisions\n\nWe use one queue.\n\n```js\nconst queue = createQueue(');
    r = spawnSync('node', [cli, '--resume', join('runs', runId)], { cwd: dir, encoding: 'utf8', env });
    assert.ok([0, 3].includes(r.status), r.stdout + r.stderr);
    const warnings = readFileSync(join(runDir, 'WARNINGS.md'), 'utf8');
    assert.match(warnings, /partial_output: stage "build" \(build\) - the text ends mid-structure/);
    const logLines = () => readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => !e.kind && e.stage === 'build');
    assert.equal(logLines().length, 1, 'one stage-log line for the external build');
    assert.equal(readFileSync(join(runDir, 'build.md'), 'utf8').endsWith('createQueue('), true, 'the answer on disk is untouched');
    // A further resume (if the run paused again) must not log it twice.
    if (r.status === 3) {
      spawnSync('node', [cli, '--resume', join('runs', runId)], { cwd: dir, encoding: 'utf8', env });
      assert.equal(logLines().length, 1, 'still one line after another resume');
      assert.equal((readFileSync(join(runDir, 'WARNINGS.md'), 'utf8').match(/partial_output: stage "build"/g) || []).length, 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
