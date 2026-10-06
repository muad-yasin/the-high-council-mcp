// 0.8.1 FX-14 (owner's decision 2026-10-02, from the M1 review): `council handoff --from-run` on an advice run made a
// paid call and wrote a HANDOFF.md from an advice answer, read as signed off (report.passed is true for advice). An
// advice call has no plan to hand off, so the command refuses it (exit 2) before anything could spend. Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

test('FX-14: handoff --from-run refuses an advice run with exit 2, writes nothing and calls nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx14-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# Advice\n\nShould the note list keep ticked items or remove them?\n');
  // mock-advise-standard has a builder seat (its synthesis seat), so without the refusal the handoff would really call it
  // (M2 review: mock-advise-single has none and already exited 2 for that reason).
  assert.equal(run(dir, ['--task', 'tasks/t.md', '--chain', 'mock-advise-standard']).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0];
  const rd = join(dir, 'runs', id);
  const before = readdirSync(rd).sort();
  const r = run(dir, ['handoff', '--from-run', join('runs', id)]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /advice/i);
  assert.deepEqual(readdirSync(rd).sort(), before, 'nothing written to the run folder');
  for (const f of ['HANDOFF.md', 'HANDOFF-from-run.md', 'handoff-from-run.usage.json', 'superseded']) assert.equal(existsSync(join(rd, f)), false, f);
});
