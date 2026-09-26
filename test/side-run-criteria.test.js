// --rematch and --replay of a run given --criteria (bug audit 2026-09-26 #3). Both re-run from the
// task text alone; the hand-written criteria were dropped and a criteria seat wrote new ones, so the
// diff blamed the panel for a difference in inputs. They are now refused up front, like a run that
// used --context, --draft or --from-run. Offline, mock chain, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');

test('--rematch and --replay refuse a run that was given --criteria, before any call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-side-criteria-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'criteria.md'), 'It names the storage format.\nIt says how notes are searched.\n');
    const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    const first = run(['--chain', 'mock', '--task', 'tasks/t.md', '--criteria', 'criteria.md']);
    assert.equal(first.status, 0, first.stderr);
    const id = readdirSync(join(dir, 'runs'))[0];
    for (const what of ['--rematch', '--replay']) {
      const r = run([what, `runs/${id}`]);
      assert.equal(r.status, 2, `${what}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, new RegExp(`${what}: the original run also used --criteria`));
    }
    assert.deepEqual(readdirSync(join(dir, 'runs')), [id], 'no side-run folder was written');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
