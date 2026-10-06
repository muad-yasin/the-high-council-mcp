// 0.8.1 FX-6 (the 2026-10-02 audit of 0.8.0, finding 6): `handoff --from-run` read criteria.md with plain JSON.parse,
// so a criteria reply that needed the run's own JSON repair (an unescaped quote) gave no criteria, and the HANDOFF.md
// it wrote had no lock block, silently. It now uses the run's repairing parseJson, and says so when it finds none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCriteria } from '../src/handoff-from-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
// What a criteria seat sent: valid JSON apart from the unescaped quotes around "done".
const NEEDS_REPAIR = '```json\n{"criteria": ["The CLI prints "done" when it finishes", "It exits 0 on success"]}\n```\n';

function stoppedRun(criteriaText) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx6-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool.\n');
  const id = '2026-10-02T22-00-00-000Z';
  const rd = join(dir, 'runs', id);
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, 'run.json'), JSON.stringify({ chain: 'mock', task: 'tasks/t.md', cwd: dir, maxUsd: 5 }));
  writeFileSync(join(rd, 'criteria.md'), criteriaText);
  writeFileSync(join(rd, 'build.md'), '# Plan\n\nRename photos by date.\n');
  return { dir, id, rd };
}
const handoff = (dir, id) => spawnSync(process.execPath, [cli, 'handoff', '--from-run', join('runs', id)], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

test('FX-6: a criteria reply that needs JSON repair still yields the criteria, and the handoff carries a lock block', () => {
  const { dir, id, rd } = stoppedRun(NEEDS_REPAIR);
  assert.deepEqual(readCriteria(rd), ['The CLI prints "done" when it finishes', 'It exits 0 on success']);
  const r = handoff(dir, id);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = readFileSync(join(rd, 'HANDOFF.md'), 'utf8');
  assert.match(text, /## Locked criteria/);
  assert.match(text, /^C1\. The CLI prints "done" when it finishes$/m);
});

test('FX-6: a run with no readable criteria gets a printed warning, not a silent HANDOFF.md without a lock block', () => {
  const { dir, id, rd } = stoppedRun('The seat wrote prose, no JSON at all.\n');
  assert.deepEqual(readCriteria(rd), []);
  const r = handoff(dir, id);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /no criteria|without a lock block/i);
  assert.doesNotMatch(readFileSync(join(rd, 'HANDOFF.md'), 'utf8'), /## Locked criteria/);
});
