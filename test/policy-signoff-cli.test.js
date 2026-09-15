// test/policy-signoff-cli.test.js
//
// MLLM Coder v4 item 4 (relay/runs/2026-09-15T01-35-10-051Z/deliverable.md): v3 built
// required_signoff_paths in src/policy.js, but nothing handed it a change request or a signoff,
// so it could never fire from a real run. src/cli.js now reads `target_file:`/`signoff:` from the
// task file and `--signoff <name>` from the command line. These run the real CLI against the
// offline mock chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangeRequestFields } from '../src/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const MOCK_CHAIN = readFileSync(resolve(here, '../chains/mock.json'), 'utf8');

function run(taskText, policy, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-signoff-cli-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'mock.json'), MOCK_CHAIN);
  writeFileSync(join(dir, 'task.md'), taskText);
  if (policy) writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy));
  try {
    const stdout = execFileSync('node', [cli, '--chain', 'mock', '--task', 'task.md', ...extraArgs], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '', ranRun: existsSync(join(dir, 'runs')) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '', ranRun: existsSync(join(dir, 'runs')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const AUTH_CHANGE = 'target_file: src/auth/login.js\nintent: Tighten the session check.\n';
const POLICY = { required_signoff_paths: ['src/auth/**'] };

test('parseChangeRequestFields: reads line-start keys, first occurrence wins, empty value stays empty', () => {
  assert.deepEqual(parseChangeRequestFields('target_file: src/a.js\nsignoff: bob\ntarget_file: other.js\n'), { target_file: 'src/a.js', signoff: 'bob' });
  assert.deepEqual(parseChangeRequestFields('A plan about target_file: handling.\n'), {}, 'a mid-line mention is not a field');
  assert.deepEqual(parseChangeRequestFields('target_file:   \r\n'), { target_file: '' });
  assert.deepEqual(parseChangeRequestFields(''), {});
  assert.deepEqual(parseChangeRequestFields(undefined), {});
});

test('a matching target_file with no signoff is refused before any run folder exists', () => {
  const r = run(AUTH_CHANGE, POLICY);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /COUNCIL-E005/);
  assert.match(r.stderr, /required_signoff_paths/);
  assert.match(r.stderr, /src\/auth\/\*\*/);
  assert.equal(r.ranRun, false, 'nothing was started');
});

test('--signoff lets the same change request run', () => {
  const r = run(AUTH_CHANGE, POLICY, ['--signoff', 'alice']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /signed off|open objections|round cap/);
});

test('a task-file signoff: line is the fallback when no flag is given', () => {
  const r = run(`${AUTH_CHANGE}signoff: alice\n`, POLICY);
  assert.equal(r.status, 0, r.stderr);
});

test('an empty task-file signoff: line counts as no signoff', () => {
  const r = run(`${AUTH_CHANGE}signoff:\n`, POLICY);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /required_signoff_paths/);
});

test('a task file without target_file is not a change request - unaffected by the policy, exactly as before', () => {
  const r = run('A short plan for a reading list.\n', POLICY);
  assert.equal(r.status, 0, r.stderr);
});

test('a non-matching target_file runs without a signoff', () => {
  const r = run('target_file: README.md\n', POLICY);
  assert.equal(r.status, 0, r.stderr);
});

test('a bare --signoff with no name is a usage error, never read as signed', () => {
  const r = run(AUTH_CHANGE, POLICY, ['--signoff']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--signoff: needs a name/);
});
