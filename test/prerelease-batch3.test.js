// Pre-release audit batch 3 (the non-HIGH items), 2026-09-23: Review/PreRelease_Audit_GuardLayer
// and _FenceToolsRedaction, plus RolesPrompts #4. Each test fails on the code before this fix.
// Offline: mock/external seats, temp dirs, no keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from '../src/chain.js';
import { gateOf } from '../src/security-review.js';
import { runTool, renderToolsMd, resetToolCallLog, toolCallLog } from '../src/tools.js';
import * as R from '../src/roles.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const run = (args, cwd) => {
  try { return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH } }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
};
const fill = (n, set = 'aZ3kQ9xB') => Array.from({ length: n }, (_, i) => set[i % set.length]).join('');

// --- GuardLayer #1: the security gate in a descending chain ------------------------------------

test('a descending chain keeps its security gate: reviewed once, over the final stack, and returned', async () => {
  const cfg = { ...chain('mock-security-review'), descending: true };
  const r = await runChain({ request: 'Plan a tiny script.', config: cfg, log: () => {} });
  assert.ok(r.security_review, 'the gate result must reach the caller (it drives exit 7/8)');
  assert.equal(r.security_review.gate, 'blocked');
  assert.equal(r.stages.filter(s => s.label.startsWith('security-review')).length, 1, 'one review, not a plan-stage one replayed');
});

// --- GuardLayer #6: a "pass" with dropped or malformed findings -----------------------------------

test('the gate never passes a "pass" whose findings were malformed or dropped a possibly blocking one', () => {
  assert.equal(gateOf({ seat_verdict: 'pass', findings: [], findings_malformed: true }), 'not_judged');
  assert.equal(gateOf({ seat_verdict: 'pass', findings: [], dropped_unsafe: 1 }), 'not_judged');
  assert.equal(gateOf({ seat_verdict: 'pass', findings: [] }), 'pass', 'a clean pass still passes');
});

// --- FenceToolsRedaction #5/#6/#7: tools ----------------------------------------------------------

test('check_versions redacts a credential inside a dependency spec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cv-'));
  const token = ['gh', 'p_', fill(36)].join('');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { lib: `git+https://x-access-token:${token}@github.com/o/lib.git` } }));
  const res = runTool('check_versions', {}, { cwd: dir });
  assert.equal(res.ok, true);
  assert.equal(JSON.stringify(res).includes(token), false);
  assert.ok(res.redacted >= 1);
});

test('grep_repo refuses a denylisted file by its real path, even with cwd inside the secrets folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-grep-'));
  mkdirSync(join(dir, 'secrets'));
  writeFileSync(join(dir, 'secrets', 'notes.txt'), 'the vault combination is 1234\n');
  const res = runTool('grep_repo', { pattern: 'vault' }, { cwd: join(dir, 'secrets') });
  assert.equal(res.matches.length, 0);
  assert.ok(res.deniedPaths >= 1);
});

test('TOOLS.md: every call with its real answer size; the CLI writes it', () => {
  resetToolCallLog();
  const dir = mkdtempSync(join(tmpdir(), 'thc-tools-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { a: '^1' } }));
  runTool('check_versions', {}, { cwd: dir });
  const [c] = toolCallLog();
  assert.ok(c.bytes > 2, `check_versions answer logged as ${c.bytes} bytes`);
  const md = renderToolsMd();
  assert.match(md, /^# Tool calls/);
  assert.match(md, /\| check_versions \|/);
  resetToolCallLog();
  assert.equal(renderToolsMd(), null, 'no calls, no file');
  assert.match(readFileSync(cli, 'utf8'), /appendFileSync\(join\(runDir, 'TOOLS\.md'\)/);
});

// --- RolesPrompts #4: the builder sees the skeleton when alternatives are on ------------------

test('with an alternatives board, the builder is shown the skeleton it is told to build on', () => {
  const u = R.builderUser({ request: 'r', criteria: ['c'], alternatives: '## A-ALT ...', skeleton: 'SKELETON: pick A-ALT' });
  assert.match(u, /# Skeleton of the plan \(the architecture it chose\)\n\nSKELETON: pick A-ALT/);
  assert.equal(R.builderUser({ request: 'r', criteria: ['c'], skeleton: 'S' }), R.builderUser({ request: 'r', criteria: ['c'] }), 'without alternatives the prompt is unchanged');
});

test('the alternatives stage actually passes the skeleton to the build call', async () => {
  const cfg = { ...chain('mock-debate'), alternatives: { enabled: true } };
  const seen = [];
  const r = await runChain({ request: 'r', config: cfg, log: () => {}, onStage: s => seen.push(s.label) });
  assert.ok(seen.includes('skeleton') && seen.includes('build'));
  assert.match(readFileSync(join(root, 'src', 'chain.js'), 'utf8'), /R\.builderUser\(\{[^}]*skeleton \}\)/);
  assert.ok(r.deliverable);
});

// --- GuardLayer #3/#4: the PII gate and policy.json on every resume sitting ---------------------

function pausedRun(work, extra = []) {
  mkdirSync(join(work, 'tasks'), { recursive: true });
  writeFileSync(join(work, 'tasks', 'x.md'), 'A test task.');
  const r = run(['--task', 'tasks/x.md', '--chain', 'mock-external', '--max-usd', '1', ...extra], work);
  const runs = readdirSync(join(work, 'runs'));
  assert.equal(runs.length, 1, r.out);
  const runDir = join(work, 'runs', runs[0]);
  assert.ok(readdirSync(runDir).some(f => f.startsWith('NEEDS-')), `did not pause:\n${r.out}`);
  return runDir;
}

test('--pii-gate is saved with the run and re-applied, with a fresh scan, on resume', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'thc-pii-resume-')));
  mkdirSync(join(work, 'ctx'));
  writeFileSync(join(work, 'ctx', 'notes.md'), '# Notes\n\nNothing personal here.\n');
  const runDir = pausedRun(work, ['--pii-gate', 'hard-stop', '--context', 'ctx']);
  assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).piiGate, { mode: 'hard-stop', allow: [] });
  // During the pause, personal data lands in a context document the resume re-reads.
  writeFileSync(join(work, 'ctx', 'notes.md'), '# Notes\n\nWrite to someone@example.com about it.\n');
  const r = run(['--resume', runDir], work);
  assert.equal(r.code, 11, `the resume must be stopped by the saved hard-stop gate:\n${r.out}`);
  assert.match(r.out, /PII-GATE \(hard-stop\)/);
});

test('policy.json is evaluated on every sitting, not only the first', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'thc-policy-resume-')));
  const runDir = pausedRun(work);
  // The operator puts a policy in force during the pause (mock/external seats are unbilled, so a
  // provider rule would not apply to them; a chain-tag rule does).
  writeFileSync(join(work, 'policy.json'), JSON.stringify({ required_chain_tags: ['approved-for-production'] }));
  const r = run(['--resume', runDir], work);
  assert.equal(r.code, 12, `the resume must be refused under the policy now in force:\n${r.out}`);
});
