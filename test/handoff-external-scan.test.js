// `council handoff --from-run` with an EXTERNAL handoff seat (a session the person runs): the outbound key scan runs BEFORE the prompt file is written (13 Oct 2026, order re-read at 9584e37 / 4ba6176). The external branch used to write
// handoff-from-run.prompt.md and exit 3 first, so a key-shaped string in the task or in the draft (model text) went into a file on disk that a person pastes into another tool. A tree member's own refusal is KO-10 in
// test/tree-member-key-order.test.js (it needs a real member). Offline: no provider is called, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const RUN = '2026-10-13T09-00-00-000Z';
const KEY = 'sk-or-v1-' + 'a1b2c3d4e5'.repeat(4);
const PLAN = '# Plan\n\n## Decisions\n\nWe use SQLite.\n';

function workspace({ task = 'Plan a small reading list app.\n', build = PLAN } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-ext-scan-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'runs', RUN), { recursive: true });
  writeFileSync(join(dir, 'tasks', 't.md'), task);
  writeFileSync(join(dir, 'chains', 'ext.json'), JSON.stringify({ name: 'ext', maxRounds: 1, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] } }));
  writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ chain: 'ext', task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
  writeFileSync(join(dir, 'runs', RUN, 'build.md'), build);
  writeFileSync(join(dir, 'runs', RUN, 'criteria.md'), JSON.stringify({ criteria: ['The plan names a data store.'] }));
  return { dir, rd: join(dir, 'runs', RUN), prompt: join(dir, 'runs', RUN, 'handoff-from-run.prompt.md') };
}
const handoff = (w, args = []) => spawnSync(process.execPath, [cli, 'handoff', '--from-run', join('runs', RUN), ...args], { cwd: w.dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: w.dir }, timeout: 60_000 });
const withWorkspace = (opts, fn) => { const w = workspace(opts); try { return fn(w); } finally { rmSync(w.dir, { recursive: true, force: true }); } };

test('ES-1 control: a clean request with an external handoff seat still gets its prompt file and exit 3', () => withWorkspace({}, w => {
  const r = handoff(w);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.equal(existsSync(w.prompt), true);
}));

test('ES-2 a key-shaped string in the task, external seat: refused (exit 11), the prompt file is NOT written', () => withWorkspace({ task: `Plan a small app. Use the key ${KEY} for the service.\n` }, w => {
  const r = handoff(w);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /refused - the task file contains 1 credential-shaped string/);
  assert.match(r.stderr, /Remove the key from the task, or rerun with --allow-secret-shaped to send it deliberately\./, 'control: a run that is not a member keeps the remedy');
  assert.equal(existsSync(w.prompt), false, 'no prompt file');
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), 'the value is never printed');
}));

test('ES-3 a key-shaped string in the DRAFT (model text), external seat: refused (exit 11) before the prompt file is written', () => withWorkspace({ build: `${PLAN}\nAPI key: ${KEY}\n` }, w => {
  const r = handoff(w);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /refused/);
  assert.match(r.stderr, /Remove the key from the input, or rerun with --allow-secret-shaped to send it deliberately\./, 'control: a run that is not a member keeps the remedy');
  assert.equal(existsSync(w.prompt), false, 'no prompt file');
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), 'the value is never printed');
}));

test('ES-4 the override still works for a run that is not a tree member: --allow-secret-shaped writes the prompt file and exits 3', () => withWorkspace({ task: `Plan a small app. Use the key ${KEY}.\n` }, w => {
  const r = handoff(w, ['--allow-secret-shaped']);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.equal(existsSync(w.prompt), true);
}));

// the saved-value row: run.json can carry allowSecretShaped true (a run started with the flag); `handoff --from-run` reads the flag from its own argv only, so a saved value waives nothing here
test('ES-5 a run.json that SAVED allowSecretShaped true does not waive the scan for the handoff: key in the task, external seat, no flag -> refused, no prompt file', () => withWorkspace({ task: `Plan a small app. Use the key ${KEY}.\n` }, w => {
  const saved = JSON.parse(readFileSync(join(w.rd, 'run.json'), 'utf8')); saved.allowSecretShaped = true;
  writeFileSync(join(w.rd, 'run.json'), JSON.stringify(saved));
  const r = handoff(w);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.equal(existsSync(w.prompt), false, 'no prompt file');
}));
