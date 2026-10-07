// 0.8.2 item 6b (owner 6 Oct 2026: handoff milestones with checks and replan triggers; builder reviews the plan before coding): the HARNESS-written section of HANDOFF.md. Product text, no seat prompt, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builderSection, checkFailuresOf, DEFAULT_CHECK_FAILURES, recordLine, RECORD_LINE_RE } from '../src/handoff-contract-text.js';
import { createHash } from 'node:crypto';
import { lintChain } from '../src/chain-lint.js';
import { parseLock, checkLock } from '../src/criteria-lock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const thin = { sha256: 'a'.repeat(64) };

test('the section says: read the plan and list blockers before coding, never edit the criteria, the record hash in plain text, the replan triggers', () => {
  const t = builderSection({ thin, runId: 'run-1', hasChecks: true });
  assert.match(t, /^## Before you build \(written by the harness, not by a seat\)/);
  assert.match(t, /write down every blocker/);
  assert.match(t, /Do not edit them; where a criterion names a check/);
  assert.match(t, new RegExp(`record sha256 ${'a'.repeat(64)}, run run-1\\.`));
  assert.match(t, /## Replan triggers/);
  for (const trigger of [/contract check/, /named check fails 2 times in a row/, /not the signed text/, /never saw your repository/, /edit a criterion/]) assert.match(t, trigger);
  assert.doesNotMatch(t, /Locked criteria/, 'the lock block\'s own heading is never repeated here: parseLock and stripLockBlock look for it');
  assert.doesNotMatch(t, /<!--/, 'no comment marker: check-lock must never read this text as the lock block');
  assert.equal(RECORD_LINE_RE.exec(recordLine({ sha256: 'b'.repeat(64) }))[1], 'b'.repeat(64));
});

test('no thin contract (an older run), no section; the threshold is a documented default of 2 that a chain can set, and the lint refuses a bad value', () => {
  assert.equal(builderSection({ thin: undefined, runId: 'r' }), '');
  assert.equal(DEFAULT_CHECK_FAILURES, 2);
  assert.equal(checkFailuresOf({}), 2);
  assert.equal(checkFailuresOf({ handoff_contract: { check_failures: 3 } }), 3);
  assert.equal(checkFailuresOf({ handoff_contract: { check_failures: 0 } }), 2, 'a value below 1 never reaches the text');
  assert.match(builderSection({ thin, failures: 3 }), /fails 3 times in a row/);
  assert.match(builderSection({ thin, failures: 1 }), /named check fails once\./);
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  assert.deepEqual(lintChain({ ...cfg, handoff_contract: { check_failures: 3 } }, 'x.json').filter(f => /handoff-contract/.test(f.kind)), []);
  assert.ok(lintChain({ ...cfg, handoff_contract: { check_failures: 0 } }, 'x.json').some(f => /handoff-contract/.test(f.kind)));
  assert.ok(lintChain({ ...cfg, handoff_contract: { retries: 2 } }, 'x.json').some(f => /handoff-contract/.test(f.kind)), 'an unknown key would silently do nothing');
});

// ---- through the CLI: one mock run (the copy of its folder is read, not re-run) --------------------------------------------------------------------------------------------

let shared;
function runOnce(extraChain = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-hc-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'hc.json'), JSON.stringify({ ...cfg, name: 'hc', ...extraChain }));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'hc', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const run = join('runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, handoff: readFileSync(join(dir, run, 'HANDOFF.md'), 'utf8'), report: JSON.parse(readFileSync(join(dir, run, 'report.json'), 'utf8')) };
}
const cli = (dir, args) => spawnSync(process.execPath, [join(root, 'src/cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

test('a real run: HANDOFF.md carries the section above the lock block, prints the record hash report.json holds, the lock block is still last and check-lock still passes', () => {
  shared = runOnce();
  const { dir, run, handoff, report } = shared;
  assert.match(handoff, /## Before you build/);
  assert.equal(RECORD_LINE_RE.exec(handoff)[1], report.thin_contract.sha256, 'the HANDOFF prints the very record the report holds');
  assert.ok(handoff.indexOf('## Before you build') < handoff.indexOf('## Locked criteria'), 'the section sits above the lock block');
  assert.ok(handoff.trimEnd().endsWith('-->'), 'the lock block is the last thing in the file');
  assert.equal(parseLock(handoff).found, true);
  assert.equal(checkLock(handoff).ok, true);
  assert.equal(report.handoff_text.file_sha256, createHash('sha256').update(handoff, 'utf8').digest('hex'), 'file_sha256 is the hash of HANDOFF.md as written, section included (this line compared a value with itself before the review)');
  const lock = cli(dir, ['check-lock', join(run, 'HANDOFF.md'), '--run', run]);
  assert.equal(lock.status, 0, lock.stdout + lock.stderr);
});

test('contract check --handoff: the copy that names this run\'s record is sealed; a copy that names another record, or none, is not', () => {
  const { dir, run, handoff } = shared;
  writeFileSync(join(dir, 'copy-ok.md'), handoff);
  const ok = cli(dir, ['contract', 'check', run, '--handoff', 'copy-ok.md']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^ok: HANDOFF copy: /m);
  writeFileSync(join(dir, 'copy-bad.md'), handoff.replace(/record sha256 [0-9a-f]{64}/, `record sha256 ${'0'.repeat(64)}`));
  const bad = cli(dir, ['contract', 'check', run, '--handoff', 'copy-bad.md']);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /DRIFT: HANDOFF copy/);
  writeFileSync(join(dir, 'copy-none.md'), '# HANDOFF\n\nNo line.\n');
  const none = cli(dir, ['contract', 'check', run, '--handoff', 'copy-none.md']);
  assert.equal(none.status, 0, none.stdout + none.stderr);
  assert.match(none.stdout, /cannot check: HANDOFF copy/);
  assert.equal(cli(dir, ['contract', 'check', run, '--handoff', 'missing.md']).status, 2);
});

test('the chain\'s own threshold reaches the file', () => {
  const w = runOnce({ handoff_contract: { check_failures: 3 } });
  assert.match(w.handoff, /named check fails 3 times in a row/);
});
