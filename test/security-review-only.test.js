// test/security-review-only.test.js
//
// F9 (relay/Docs/SophiA-Seat-Families-Plan.md §5, §2.9): chains/security-review-only.json - a
// tiny chain whose only real content is a human/orchestrator-supplied artifact plus the final
// security-review gate (515439a). This test is the F9 acceptance test named in the plan: the
// chain lints, a mock run pauses at build, resumes after the file is written, and exits 7 with
// the blocking mock reviewer / 0 with a passing one. Fully offline, mock provider only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cli = join(root, 'src', 'cli.js');
const chainPath = join(root, 'chains', 'security-review-only.json');

test('1. chains/security-review-only.json lints clean', () => {
  const cfg = JSON.parse(readFileSync(chainPath, 'utf8'));
  assert.deepEqual(lintChain(cfg, chainPath), []);
});

test('2. the chain\'s builder seat is external and security_review is enabled', () => {
  const cfg = JSON.parse(readFileSync(chainPath, 'utf8'));
  assert.equal(cfg.seats.builder.provider, 'external');
  assert.equal(cfg.security_review.enabled, true);
});

// Runs a fresh chain, discovers the real external-stage label from the run's own NEEDS-*.md
// file (never assumed to be "build"), writes `artifactText` as that stage's answer, resumes, and
// returns { runDir, exitStatus }. A caller-provided reviewerModel is swapped into a throwaway
// copy of the chain config so the same fixture drives both the blocking and passing paths without
// duplicating the chain file.
function runSecurityReviewOnly({ reviewerModel, artifactText }) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-secreview-only-'));
  mkdirSync(join(dir, 'chains'));
  const cfg = JSON.parse(readFileSync(chainPath, 'utf8'));
  cfg.seats.security_reviewer.model = reviewerModel;
  writeFileSync(join(dir, 'chains', 'security-review-only.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(join(dir, 'task.md'), 'Security review of the artifact provided at the paused build stage.\n');
  const env = { PATH: process.env.PATH };

  let firstStatus = null;
  try {
    execFileSync('node', [cli, '--chain', 'security-review-only', '--task', 'task.md'], { cwd: dir, encoding: 'utf8', env, stdio: 'pipe' });
  } catch (err) {
    firstStatus = err.status;
  }
  assert.equal(firstStatus, 3, 'the first run must pause (exit 3) at the external build stage');

  const runId = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', runId);
  const needsFiles = readdirSync(runDir).filter(f => /^NEEDS-.+\.md$/.test(f));
  assert.equal(needsFiles.length, 1, 'exactly one external stage should be paused');
  // The real label, read from the run folder - never assumed to be "build". This chain's only
  // external seat is the builder, so today it resolves to "build", but the test derives it from
  // disk exactly the way a real caller (Sophi-A's securityGate.js) must, not by hardcoding it.
  const label = needsFiles[0].slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(runDir, `${label}.md`), artifactText);

  let exitStatus = 0;
  try {
    execFileSync('node', [cli, '--resume', join('runs', runId)], { cwd: dir, encoding: 'utf8', env, stdio: 'pipe' });
  } catch (err) {
    exitStatus = err.status;
  }
  return { dir, runDir, label, exitStatus };
}

test('3. a run resumes after the artifact is written and exits 7 (blocked) with the blocking mock reviewer', () => {
  const { dir, runDir, label, exitStatus } = runSecurityReviewOnly({
    reviewerModel: 'mock-security-block',
    artifactText: 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',
  });
  try {
    assert.equal(label, 'build', 'this chain\'s only external seat is the builder');
    assert.equal(exitStatus, 7);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.security_review.gate, 'blocked');
    assert.ok(report.security_review.blocking_count >= 1);
    assert.ok(existsSync(join(runDir, 'security-review.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('4. a run resumes and exits 0 (pass) with a non-blocking mock reviewer', () => {
  const { dir, runDir, exitStatus } = runSecurityReviewOnly({
    reviewerModel: 'mock-security-clean',
    artifactText: 'A clean artifact with nothing to flag.',
  });
  try {
    assert.equal(exitStatus, 0);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.security_review.gate, 'pass');
    assert.equal(report.security_review.blocking_count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('5. a run exits 8 (not_judged) with the could-not-judge mock reviewer, never a pass', () => {
  const { dir, runDir, exitStatus } = runSecurityReviewOnly({
    reviewerModel: 'mock-security-cannot-judge',
    artifactText: 'An artifact the mock reviewer is scripted to say it cannot judge.',
  });
  try {
    assert.equal(exitStatus, 8);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.security_review.gate, 'not_judged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('6. the chain makes no engine change: it is built entirely from existing seat kinds and the existing security_review flag', () => {
  const cfg = JSON.parse(readFileSync(chainPath, 'utf8'));
  const knownTopLevelKeys = ['name', 'description', 'maxRounds', 'criteria', 'seats', 'security_review'];
  for (const key of Object.keys(cfg)) assert.ok(knownTopLevelKeys.includes(key), `unexpected top-level chain key: ${key}`);
});
