// test/init.test.js
//
// v5 §1 candidate 6: `council init` - a starter chain and task a stranger
// owns, plus a real run folder to inspect, all offline and $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

test('test_council_init: exit 0 with no keys, a starter chain and task written, a real run folder produced, next command named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-init-'));

  const out = execFileSync('node', [cli, 'init', '--yes'], {
    encoding: 'utf8',
    cwd: dir,
    env: { PATH: process.env.PATH },  // no API keys
  });

  // The starter chain parses and has the shape a chain config needs.
  const chainPath = join(dir, 'chains', 'my-first-chain.json');
  assert.ok(existsSync(chainPath));
  const chain = JSON.parse(readFileSync(chainPath, 'utf8'));
  assert.equal(typeof chain.name, 'string');
  assert.ok(Array.isArray(chain.seats.critics) && chain.seats.critics.length >= 1);
  assert.ok(chain.seats.builder && chain.seats.criteria);

  // The starter task file exists and parses (it's plain prose, so "parses"
  // means: readable, non-empty text).
  const taskPath = join(dir, 'tasks', 'my-first-task.md');
  assert.ok(existsSync(taskPath));
  const task = readFileSync(taskPath, 'utf8');
  assert.ok(task.trim().length > 0);

  // The dry-run stage ran - a price for the starter chain is in stdout.
  assert.match(out, /Price of your starter chain/);
  assert.match(out, /\$/);

  // The mock run folder exists and is a real run folder.
  const runsDir = join(dir, 'runs');
  assert.ok(existsSync(runsDir));
  const runIds = readdirSync(runsDir).filter(f => f.endsWith('-init'));
  assert.equal(runIds.length, 1);
  const runDir = join(runsDir, runIds[0]);
  assert.ok(existsSync(join(runDir, 'report.json')));
  assert.ok(existsSync(join(runDir, 'deliverable.md')));
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.totals.usd, 0, 'the canned demo run must be $0 - mock only, no real provider');

  // stdout names the next command to run with real keys.
  assert.match(out, /--chain my-first-chain/);
  assert.match(out, /council doctor/);
});

test('a user edit to the starter chain/task survives rerunning council init - bug-audit finding, 2026-09-13', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-init-edit-'));
  execFileSync('node', [cli, 'init', '--yes'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });

  const chainPath = join(dir, 'chains', 'my-first-chain.json');
  const taskPath = join(dir, 'tasks', 'my-first-task.md');
  const editedChain = JSON.parse(readFileSync(chainPath, 'utf8'));
  editedChain.name = 'edited-by-the-user';
  writeFileSync(chainPath, JSON.stringify(editedChain, null, 2));
  writeFileSync(taskPath, 'The user\'s own edited task text.\n');

  const out = execFileSync('node', [cli, 'init', '--yes'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });

  assert.equal(JSON.parse(readFileSync(chainPath, 'utf8')).name, 'edited-by-the-user', 'a rerun must not overwrite an edited starter chain');
  assert.equal(readFileSync(taskPath, 'utf8'), 'The user\'s own edited task text.\n', 'a rerun must not overwrite an edited starter task');
  assert.match(out, /already exists - left as-is/);
});

test('an init-produced report.json carries the same fields a real run writes, so --from-run works against it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-init-report-shape-'));
  execFileSync('node', [cli, 'init', '--yes'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  const runId = readdirSync(join(dir, 'runs')).find(f => f.endsWith('-init'));
  const report = JSON.parse(readFileSync(join(dir, 'runs', runId, 'report.json'), 'utf8'));
  assert.ok(Array.isArray(report.criteria) && report.criteria.length > 0, '--from-run reads report.criteria - it must not be missing from an init-produced report.json');
  assert.ok('proposals' in report);
  assert.ok('debate' in report);
});

test('council init is idempotent-safe: running twice does not throw or overwrite the first run folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-init-twice-'));
  execFileSync('node', [cli, 'init', '--yes'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  execFileSync('node', [cli, 'init', '--yes'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  const runIds = readdirSync(join(dir, 'runs')).filter(f => f.endsWith('-init'));
  assert.equal(runIds.length, 2, 'each init run gets its own timestamped folder, never overwritten');
});
