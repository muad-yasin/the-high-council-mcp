// 0.8.4 S16 (K; D32 "after an error", T21r, T21bb; C&C ruled 09 Nov, WORDING S16-w57/w58): an error that stops a run on a chain with a final read is a failed run, not an ending: STOPPED-error.json carries final_read_owed (true), STOPPED-error.md and the printed
// stop say the final read has not run, and no paid call is made on that path. A chain without a final read (not layered) carries nothing new. Offline: mock chains, the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-11-09T10-00-00-000Z';
function failed(chainFile) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-s16-error-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', chainFile), 'utf8'));
  cfg.name = 'broken';
  cfg.seats.builder = { provider: 'mock', model: 'mock-network-error' };
  writeFileSync(join(dir, 'chains', 'broken.json'), JSON.stringify(cfg));
  const r = spawnSync(process.execPath, [cli, '--chain', 'broken', '--task', 'tasks/t.md', '--run-id', RUN], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmpdir() }, timeout: 60_000 });
  const runDir = join(dir, 'runs', RUN);
  return { r, runDir, json: JSON.parse(readFileSync(join(runDir, 'STOPPED-error.json'), 'utf8')), md: readFileSync(join(runDir, 'STOPPED-error.md'), 'utf8'), files: readdirSync(runDir) };
}

test('T21r, T21bb: an error on a layered chain: exit 16, final_read_owed true, the sentence in STOPPED-error.md and the printed stop, no final-read stage and no report.json (a failed record never carries a read claim)', () => {
  const f = failed('mock-layered.json');
  assert.equal(f.r.status, 16, f.r.stdout + f.r.stderr);
  assert.equal(f.json.kind, 'error');
  assert.equal(f.json.final_read_owed, true);
  assert.match(f.md, /\nThe final read of layer 3 has not run yet: it is still owed, and this run cannot end before it has run\.\n\nNo report\.json or deliverable\.md was written/);
  assert.match(f.r.stdout + f.r.stderr, /the final read of layer 3 has not run yet: it is still owed\./);
  assert.ok(!f.files.some(n => /^final-read-/.test(n)) && !f.files.includes('report.json'), f.files.join(', '));
});

test('a chain with no final read (not layered) has no final_read_owed and no sentence', () => {
  const f = failed('mock.json');
  assert.equal(f.r.status, 16, f.r.stdout + f.r.stderr);
  assert.equal('final_read_owed' in f.json, false);
  assert.doesNotMatch(f.md, /final read/i);
});
