// 0.8.1 FX-9 (the 2026-10-02 audit of 0.8.0, finding 9): on a case-insensitive file system (macOS, Windows) the stage
// cache file handoff.md and the final HANDOFF.md are one file, and so are handoff-from-run.md and HANDOFF-from-run.md.
// Writing HANDOFF.md (the model's text plus the harness's lock block) overwrote the cached stage, so a later replay of the
// `handoff` stage carried the lock block into the model text. Stage labels stay (decided rule 11), so: the replay cuts a
// trailing lock block; the lowercase intermediate of handoff --from-run is renamed handoff-from-run.reply.md; and the
// HANDOFF.md existence check reads an exact-case directory listing. The collision is simulated by writing the final
// HANDOFF.md text into handoff.md. Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const golden = readFileSync(join(root, 'test', 'fixtures', 'regression-081', 'HANDOFF-golden.md'), 'utf8');

test('FX-9: a replayed handoff stage whose file holds the final HANDOFF.md text has no lock block', async () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  setBudget(null);
  setCache({ get: label => (label === 'handoff' ? { text: golden, usage: { input: 0, output: 0 }, usd: 0, provider: 'mock', model: 'mock-builder' } : null) });
  let r;
  try { r = await runChain({ config, request: 'Plan a small command-line tool that renames photos by the date they were taken.', log: () => {} }); }
  finally { setCache(null); }
  assert.ok(r.handoff, 'the chain has a handoff stage');
  assert.doesNotMatch(r.handoff, /## Locked criteria|the-high-council:criteria-lock/);
  assert.match(r.handoff, /\S/);
});

test('FX-9: handoff --from-run keeps the reply as handoff-from-run.reply.md, a name that differs from HANDOFF-from-run.md by more than case', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx9-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool.\n');
  const id = '2026-10-02T22-30-00-000Z';
  const rd = join(dir, 'runs', id);
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, 'run.json'), JSON.stringify({ chain: 'mock', task: 'tasks/t.md', cwd: dir, maxUsd: 5 }));
  writeFileSync(join(rd, 'criteria.md'), '{"criteria": ["It renames by date"]}');
  writeFileSync(join(rd, 'build.md'), '# Plan\n\nRename photos by date.\n');
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', join('runs', id)], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const names = readdirSync(rd);
  assert.ok(names.includes('handoff-from-run.reply.md'), names.join(', '));
  assert.ok(!names.includes('handoff-from-run.md'), 'the old lowercase name is no longer written');
  assert.ok(names.includes('HANDOFF.md'));
});

test('FX-9: the exact-case check sees only the name as written', async () => {
  const { existsExactCase } = await import('../src/handoff-from-run.js');
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx9-case-'));
  writeFileSync(join(dir, 'handoff.md'), 'stage text');
  assert.equal(existsExactCase(dir, 'HANDOFF.md'), false, 'only the other-case name exists');
  assert.equal(existsExactCase(dir, 'handoff.md'), true);
  assert.equal(existsExactCase(join(dir, 'nope'), 'HANDOFF.md'), false, 'a missing folder is not an error');
});
