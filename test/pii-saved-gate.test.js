// BUG-D-012 (a) and BUG-C-026 (bug audit 24 Okt 2026). Offline, $0, mock chains; fixtures are assembled at runtime.
//  - run.json is project-writable text: a saved piiGate whose mode is not warn / hard-stop (an "off", a typo) or whose allow is not a list of the four types REFUSES a `--resume` (exit 2, nothing started), and
//    the gate treats anything but the literal 'warn' as strict.
//  - the criteria file and the typed answers.md reach every seat's prompt, so the PII gate reads them too (same labels as the key scan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { savedPiiGateRefusal } from '../src/run-preflight.js';
import { scanForPii, applyPiiGate } from '../src/pii-gate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const EMAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');   // not a reserved placeholder host
const sh = (cwd, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd, ...env }, timeout: 120_000 });
function workspace(taskText) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pii-saved-'));
  writeFileSync(join(dir, '.env'), ''); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), taskText);
  return dir;
}
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
const setSaved = (run, piiGate) => { const p = join(run, 'run.json'); writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), piiGate }, null, 2)); };

test('SG-1 savedPiiGateRefusal: a valid saved gate is null; a bad mode, a bad allow and a non-object each give the sentence', () => {
  const at = '/w/runs/r1/run.json';
  assert.equal(savedPiiGateRefusal({ mode: 'warn', allow: ['email', 'secret'] }, at), null);
  assert.equal(savedPiiGateRefusal({ mode: 'hard-stop', allow: [] }, at), null);
  assert.equal(savedPiiGateRefusal({ mode: 'hard-stop' }, at), null);
  assert.equal(savedPiiGateRefusal({ mode: 'off', allow: [] }, at), `${at}: piiGate.mode "off" is not a mode. Set it to hard-stop (the default) or warn, or remove the piiGate entry. Nothing was started and nothing was spent.`);
  assert.match(savedPiiGateRefusal({ mode: 'warn', allow: ['phone'] }, at), /piiGate\.allow must be a list of the words email, iban, card or secret\. Fix it or remove the piiGate entry\./);
  assert.match(savedPiiGateRefusal({ mode: 'warn', allow: 'email' }, at), /piiGate\.allow must be a list/);
  assert.match(savedPiiGateRefusal('warn', at), /piiGate must hold a mode and a list of types/);
  assert.equal(savedPiiGateRefusal({ mode: 'off', allow: ['phone'] }, at, { mode: false, allow: false }), null, 'nothing used, nothing checked');
  assert.match(savedPiiGateRefusal({ mode: 'off', allow: ['phone'] }, at, { mode: false, allow: true }), /piiGate\.allow must be a list/);
  assert.doesNotMatch(savedPiiGateRefusal({ mode: `x\u001b[31m${'y'.repeat(100)}` }, at), /\u001b/);
});

test('SG-2 the gate is strict for anything but the literal warn (a junk or missing mode never loosens it)', () => {
  const found = scanForPii(`Contact: ${EMAIL}`);
  assert.equal(found.findings.length, 1);
  assert.equal(applyPiiGate(found, 'warn').block, false);
  for (const mode of ['hard-stop', 'off', 'warm', undefined, null, '']) assert.equal(applyPiiGate(found, mode).block, true, String(mode));
});

test('SG-3 a --resume of a run whose run.json saves piiGate mode "off" (or a junk allow) is refused at once: exit 2, the sentence names the file, the run folder is untouched', () => {
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  const first = sh(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md', '--pii-gate', 'warn']);
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const run = onlyRun(dir);
  for (const [saved, re] of [[{ mode: 'off', allow: [] }, /piiGate\.mode "off" is not a mode/], [{ mode: 'warn', allow: ['phone'] }, /piiGate\.allow must be a list/]]) {
    setSaved(run, saved);
    const before = readdirSync(run).sort();
    const r = sh(dir, ['--resume', run]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, re);
    assert.ok(r.stderr.includes(join(run, 'run.json')), 'the sentence names run.json');
    assert.deepEqual(readdirSync(run).sort(), before, 'nothing was started or written');
  }
  // a typed --allow-pii does not make a saved junk MODE usable: the mode is still read from run.json
  setSaved(run, { mode: 'off', allow: [] });
  const typedAllow = sh(dir, ['--resume', run, '--allow-pii', 'email']);
  assert.equal(typedAllow.status, 2, typedAllow.stdout + typedAllow.stderr);
  assert.match(typedAllow.stderr, /piiGate\.mode "off" is not a mode/);
  // a typed --pii-gate replaces the saved value entirely, so a junk saved value is not read
  const typedMode = sh(dir, ['--resume', run, '--pii-gate', 'hard-stop']);
  assert.notEqual(typedMode.status, 2, typedMode.stdout + typedMode.stderr);
  setSaved(run, { mode: 'warn', allow: [] });
  const ok = sh(dir, ['--resume', run]);
  assert.notEqual(ok.status, 2, 'a valid saved warn still resumes (PW-6): ' + ok.stdout + ok.stderr);
  assert.notEqual(ok.status, 11, ok.stdout + ok.stderr);
});

test('SG-4 (C-026) a --criteria file holding an email is a PII source: the default stop names the criteria file, never the value; --allow-pii email lets it through', () => {
  const dir = workspace('Plan a small app with no personal data in the task.\n');
  writeFileSync(join(dir, 'crit.md'), `1. The plan must say who to contact: ${EMAIL}\n`);
  const r = sh(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--criteria', 'crit.md']);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /PII-GATE \(hard-stop\): \[[^\]]*crit\.md\] line 1, col \d+: email \(value not shown\)/);
  assert.equal(r.stderr.includes(EMAIL), false);
  assert.equal(existsSync(join(dir, 'runs')), false, 'a stopped start makes no run folder');
  const allowed = sh(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--criteria', 'crit.md', '--allow-pii', 'email']);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
});

test('SG-5 (C-026) the typed answers.md holding an email is a PII source on resume: exit 11 naming answers.md, nothing replayed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pii-answers-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A small tool that turns a one-paragraph idea into a build plan.');
  const first = sh(dir, ['--chain', 'mock-questions-wait', '--task', 'tasks/x.md']);
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const run = onlyRun(dir);
  writeFileSync(join(run, 'answers.md'), `1. default\n2. write to ${EMAIL}\n3. default\n`);
  const before = readdirSync(run).sort();
  const r = sh(dir, ['--resume', run]);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /answers\.md \(the typed answers of the "answers" stage\)\] line 2/);
  assert.equal(r.stderr.includes(EMAIL), false);
  assert.deepEqual(readdirSync(run).sort(), before, 'nothing was replayed or written');
});
