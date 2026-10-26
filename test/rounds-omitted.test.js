// CR-4B-007 (25 Okt 2026): a chain that omits maxRounds runs with the default of 2 passes (roundLimitsOf), and the cost figures say so (CHANGELOG), but the dry run still printed "Rounds: undefined", the run log "undefined round cap" and the live
// state "maxRounds" was missing. All three now print the EFFECTIVE cap. `council init` writes maxRounds: 1, so only a hand-edited chain hit it. Offline, $0: real verbs on a mock chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-18T07-00-00-000Z';

test('RO-1 (CR-4B-007, real verbs): a chain that omits maxRounds shows the effective cap of 2 in the dry run, the run log and state.json, and one that sets it shows its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rounds-omitted-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const { maxRounds: _dropped, ...omitted } = base;
  writeFileSync(join(dir, 'chains', 'ro-omitted.json'), JSON.stringify({ ...omitted, name: 'ro-omitted' }));
  writeFileSync(join(dir, 'chains', 'ro-set.json'), JSON.stringify({ ...base, name: 'ro-set', maxRounds: 3 }));
  const env = { PATH: process.env.PATH, HOME: dir };
  const sh = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env });
  const dry = sh(['--chain', 'ro-omitted', '--task', 'tasks/x.md', '--dry-run']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /^Rounds: 2$/m); assert.doesNotMatch(dry.stdout + dry.stderr, /undefined/);
  assert.match(sh(['--chain', 'ro-set', '--task', 'tasks/x.md', '--dry-run']).stdout, /^Rounds: 3$/m);
  const run = sh(['--chain', 'ro-omitted', '--task', 'tasks/x.md', '--run-id', RUN]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(readFileSync(join(dir, 'runs', RUN, 'run.log'), 'utf8'), /chain: ro-omitted \(2 round cap\)/);
  assert.doesNotMatch(readFileSync(join(dir, 'runs', RUN, 'run.log'), 'utf8'), /undefined round cap/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', RUN, 'state.json'), 'utf8')).maxRounds, 2, 'the live state carries the effective cap');
});
