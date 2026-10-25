// test/policy-signoff-cli.test.js
//
// MLLM Coder v4 item 4 (relay/runs/2026-09-15T01-35-10-051Z/deliverable.md): v3 built
// required_signoff_paths in src/policy.js, but nothing handed it a change request or a signoff,
// so it could never fire from a real run. src/cli.js now reads `target_file:`/`signoff:` from the
// task file and `--signoff <name>` from the command line. These run the real CLI against the
// offline mock chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
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
    // --allow-unfenced: these fixtures name a target_file (src/auth/login.js) and never
    // fence it, which the artifact gate added 2026-09-20 correctly blocks. Waived here
    // rather than exempting `target_file:` in the gate itself - a task naming a file and
    // asking for a change to it is precisely the case where seats invent that file's
    // contents, so the gate is right and it is this fixture that is deliberately partial.
    const stdout = execFileSync('node', [cli, '--chain', 'mock', '--task', 'task.md', '--allow-unfenced', ...extraArgs], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
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

// Bug audit 2026-10-24 C-025: on a plain `--resume` (every MCP resume_run) `--task` is absent, so cli.js read the policy's task text as '' and `required_signoff_paths` found no target_file and passed: a resume skipped the sign-off check that a start refuses (exit 12). A resume now reads the task
// file the run recorded, and the sign-off name typed at the start (run.json `signoff`) counts on a resume, then one typed on the resume, then the task file's own `signoff:` line. Real CLI, real pause at the external stage (mock-external, exit 3), real resume.
const EXTERNAL_CHAIN = readFileSync(resolve(here, '../chains/mock-external.json'), 'utf8');
function pausedRun(taskText, { policyAtStart = null, startArgs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-signoff-resume-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'mock-external.json'), EXTERNAL_CHAIN);
  writeFileSync(join(dir, 'task.md'), taskText);
  if (policyAtStart) writeFileSync(join(dir, 'policy.json'), JSON.stringify(policyAtStart));
  const go = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
  const started = go(['--chain', 'mock-external', '--task', 'task.md', '--allow-unfenced', '--max-usd', 'none', ...startArgs]);
  assert.equal(started.status, 3, `fixture: the run paused at its external stage: ${started.stdout}${started.stderr}`);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, runDir, setPolicy: policy => writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy)), saved: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), edit: fn => { const m = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); fn(m); writeFileSync(join(runDir, 'run.json'), JSON.stringify(m, null, 2)); }, resume: (extra = []) => go(['--resume', runDir, '--allow-unfenced', ...extra]) };
}

test('C-025: a run started before the sign-off rule existed is refused on resume (exit 12, the same E005 text a start gets); a resume used to pass', () => {
  const f = pausedRun(AUTH_CHANGE);
  try {
    f.setPolicy(POLICY);
    const r = f.resume();
    assert.equal(r.status, 12, r.stdout + r.stderr);
    assert.match(r.stderr, /COUNCIL-E005/);
    assert.match(r.stderr, /required_signoff_paths/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('C-025: a run started with --signoff (name saved in run.json) and a run whose task file carries a signoff: line both continue on a plain resume', () => {
  const typed = pausedRun(AUTH_CHANGE, { policyAtStart: POLICY, startArgs: ['--signoff', 'alice'] });
  const inFile = pausedRun(`${AUTH_CHANGE}signoff: alice\n`, { policyAtStart: POLICY });
  try {
    assert.equal(typed.saved().signoff, 'alice', 'the typed name is saved with the run');
    const a = typed.resume(); assert.equal(a.status, 3, a.stdout + a.stderr); assert.doesNotMatch(a.stderr, /COUNCIL-E005/);
    const b = inFile.resume(); assert.equal(b.status, 3, b.stdout + b.stderr); assert.doesNotMatch(b.stderr, /COUNCIL-E005/);
  } finally { rmSync(typed.dir, { recursive: true, force: true }); rmSync(inFile.dir, { recursive: true, force: true }); }
});

test('C-025: a sign-off typed on the resume passes it and is saved, so the next plain resume passes too', () => {
  const f = pausedRun(AUTH_CHANGE);
  try {
    f.setPolicy(POLICY);
    const typed = f.resume(['--signoff', 'bob']);
    assert.equal(typed.status, 3, typed.stdout + typed.stderr);
    assert.equal(f.saved().signoff, 'bob', 'saved for the next sitting');
    const again = f.resume();
    assert.equal(again.status, 3, again.stdout + again.stderr);
    assert.doesNotMatch(again.stderr, /COUNCIL-E005/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

// C-025 fix-up (C&C, owner choice A: an agent's resume trusts what run.json saved, after strict checks): the saved sign-off counts only as a non-empty string. A junk value (an object, a number, blanks) in the project-writable run.json is ignored: it used to be handed to the policy as it was, where it shadowed the task file's own `signoff:` line (`flag || saved || line`) and, being no string, was refused.
test('C-025: a junk sign-off saved in run.json is ignored: it does not shadow the task file\'s own signoff: line, and without such a line the resume is still refused (exit 12)', () => {
  const withLine = pausedRun(`${AUTH_CHANGE}signoff: alice\n`, { policyAtStart: POLICY });
  const noLine = pausedRun(AUTH_CHANGE);
  try {
    for (const junk of [{ name: 'alice' }, 42, '   ']) {
      withLine.edit(m => { m.signoff = junk; });
      const ok = withLine.resume();
      assert.equal(ok.status, 3, `${JSON.stringify(junk)} is ignored and the task file's line counts: ${ok.stdout}${ok.stderr}`);
      assert.doesNotMatch(ok.stderr, /COUNCIL-E005/);
    }
    noLine.setPolicy(POLICY);
    noLine.edit(m => { m.signoff = { name: 'alice' }; });
    const refused = noLine.resume();
    assert.equal(refused.status, 12, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /required_signoff_paths/);
  } finally { rmSync(withLine.dir, { recursive: true, force: true }); rmSync(noLine.dir, { recursive: true, force: true }); }
});
