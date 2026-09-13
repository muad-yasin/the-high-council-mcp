// test/role-diagnostics.test.js
//
// v6 §7: failure-mode detectors, reconsidered to read real debate
// output (report.debate.posts) rather than the phase 4 probe's
// deterministic heuristic data - see docs/v6-decisions.md for why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perSeatMetrics, pairwiseAgreement, roleVsPlainSubstanceGap, computeRoleDiagnostics } from '../src/role-diagnostics.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const repoRoot = resolve(here, '..');

test('perSeatMetrics: a seat that always quotes on object/merge posts gets substanceRatio 1', () => {
  const posts = [
    { by: 'glm', on: 'A-1', stance: 'object', text: 'This conflicts with "the stated round cap".' },
    { by: 'glm', on: 'A-2', stance: 'merge', text: 'Same as "B-1", merge them.' },
  ];
  const m = perSeatMetrics(posts);
  assert.equal(m.glm.substanceRatio, 1);
});

test('perSeatMetrics: character-performed-not-reviewed - object/merge posts with no quote score 0', () => {
  const posts = [
    { by: 'kimi', on: 'A-1', stance: 'object', text: 'I do not like this one, it feels wrong somehow.' },
  ];
  const m = perSeatMetrics(posts);
  assert.equal(m.kimi.substanceRatio, 0);
});

test('perSeatMetrics: a support-only seat has substanceRatio null - nothing required a quote', () => {
  const posts = [{ by: 'mistral', on: 'A-1', stance: 'support', text: 'Good as written.' }];
  const m = perSeatMetrics(posts);
  assert.equal(m.mistral.substanceRatio, null);
});

test('perSeatMetrics: evidenceTokenShare reflects the fraction of words inside quotes', () => {
  const posts = [{ by: 'deepseek', on: 'A-1', stance: 'object', text: '"one two three four" plus two more words' }];
  const m = perSeatMetrics(posts);
  // Whitespace-split tokens: `"one`, `two`, `three`, `four"`, `plus`, `two`, `more`, `words`
  // = 8 total; the captured quote content "one two three four" = 4 tokens.
  assert.ok(Math.abs(m.deepseek.evidenceTokenShare - 4 / 8) < 1e-9);
});

test('perSeatMetrics: no posts at all for a lab means that lab never appears in the result', () => {
  const m = perSeatMetrics([]);
  assert.deepEqual(m, {});
});

test('pairwiseAgreement: two seats using nearly identical wording on the same proposal score high', () => {
  const posts = [
    { by: 'a', on: 'X-1', stance: 'object', text: 'this proposal conflicts with the round cap constraint badly' },
    { by: 'b', on: 'X-1', stance: 'object', text: 'this proposal conflicts with the round cap constraint clearly' },
  ];
  const score = pairwiseAgreement(posts);
  assert.ok(score > 0.6, `expected high agreement, got ${score}`);
});

test('pairwiseAgreement: two seats arguing completely differently score low', () => {
  const posts = [
    { by: 'a', on: 'X-1', stance: 'object', text: 'this conflicts with the round cap constraint entirely' },
    { by: 'b', on: 'X-1', stance: 'support', text: 'elegant simple solution works great honestly' },
  ];
  const score = pairwiseAgreement(posts);
  assert.ok(score < 0.2, `expected low agreement, got ${score}`);
});

test('pairwiseAgreement: fewer than two comparable posts on any target returns null, not zero', () => {
  const posts = [{ by: 'a', on: 'X-1', stance: 'support', text: 'fine' }];
  assert.equal(pairwiseAgreement(posts), null);
  assert.equal(pairwiseAgreement([]), null);
});

test('pairwiseAgreement: the same lab posting twice on one target is never compared against itself', () => {
  const posts = [
    { by: 'a', on: 'X-1', stance: 'object', text: 'first objection about something' },
    { by: 'a', on: 'X-1', stance: 'object', text: 'a revised objection about something else entirely' },
  ];
  assert.equal(pairwiseAgreement(posts), null);
});

test('roleVsPlainSubstanceGap: null when the run has no mix of role and role-less seats', () => {
  const perSeat = { a: { substanceRatio: 0.8 }, b: { substanceRatio: 0.9 } };
  assert.equal(roleVsPlainSubstanceGap(perSeat, new Set(['a', 'b'])), null);
  assert.equal(roleVsPlainSubstanceGap(perSeat, new Set()), null);
});

test('roleVsPlainSubstanceGap: negative when role-bearing seats argue less substantively', () => {
  const perSeat = { roleSeat: { substanceRatio: 0.2 }, plainSeat: { substanceRatio: 0.9 } };
  const gap = roleVsPlainSubstanceGap(perSeat, new Set(['roleSeat']));
  assert.ok(gap < 0, `expected a negative gap, got ${gap}`);
});

test('computeRoleDiagnostics: never throws on an empty or missing debate stage', () => {
  const empty = computeRoleDiagnostics(null, new Set());
  assert.deepEqual(empty.perSeat, {});
  assert.equal(empty.pairwiseAgreement, null);
  assert.deepEqual(empty.flags.characterPerformedNotReviewed, []);
  assert.deepEqual(empty.flags.tokenShiftToVoice, []);
  assert.equal(empty.flags.roleCorrelationCollapse, false);
  assert.equal(empty.flags.roleDegradesOutput, false);
});

test('computeRoleDiagnostics: a synthetic all-voice-no-substance transcript flags characterPerformedNotReviewed and does not flag a clean one', () => {
  const noisy = computeRoleDiagnostics({
    posts: [
      { by: 'kimi', on: 'A-1', stance: 'object', text: 'I simply disagree with this in spirit and tone.' },
      { by: 'kimi', on: 'A-2', stance: 'object', text: 'This does not sit right with me at all, honestly.' },
    ],
  }, new Set(['kimi']));
  assert.ok(noisy.flags.characterPerformedNotReviewed.includes('kimi'));

  const clean = computeRoleDiagnostics({
    posts: [
      { by: 'kimi', on: 'A-1', stance: 'object', text: 'Conflicts with "the stated cap of two rounds".' },
      { by: 'kimi', on: 'A-2', stance: 'merge', text: 'Same part as "B-2", quote: "identical acceptance test".' },
    ],
  }, new Set(['kimi']));
  assert.ok(!clean.flags.characterPerformedNotReviewed.includes('kimi'));
});

test('end-to-end: a real council run with a role-bearing proposer writes debate.diagnostics into report.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-role-diag-e2e-'));
  mkdirSync(join(dir, 'chains'));
  mkdirSync(join(dir, 'tasks'));
  const cfg = JSON.parse(readFileSync(join(repoRoot, 'chains', 'mock-debate.json'), 'utf8'));
  cfg.name = 'mock-debate-role-e2e';
  cfg.seats.proposers[0].role = { lens: 'adversary' };
  writeFileSync(join(dir, 'chains', 'mock-debate-role-e2e.json'), JSON.stringify(cfg));
  writeFileSync(join(dir, 'tasks', 't.md'), 'A tiny task.\n');

  execFileSync('node', [cli, '--chain', 'mock-debate-role-e2e', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir });

  const runId = readdirSync(join(dir, 'runs'))[0];
  const report = JSON.parse(readFileSync(join(dir, 'runs', runId, 'report.json'), 'utf8'));
  assert.ok(report.debate.diagnostics, 'report.json debate.diagnostics must be present for a chain with a debate stage');
  assert.ok('perSeat' in report.debate.diagnostics);
  assert.ok('flags' in report.debate.diagnostics);
});

test('end-to-end: a chain with no debate stage keeps debate as-is (null), no diagnostics key forced in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-role-diag-nodebate-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'A tiny task.\n');
  execFileSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir });
  const runId = readdirSync(join(dir, 'runs'))[0];
  const report = JSON.parse(readFileSync(join(dir, 'runs', runId, 'report.json'), 'utf8'));
  assert.equal(report.debate, null, 'a chain with no debate stage must keep debate as null, not gain a diagnostics-only object');
});

test('end-to-end, v6 phase 7 bug-audit fix: a role on a non-proposer seat is rejected fail-loud, before the scenario that used to misclassify roleVsPlainSubstanceGap can even run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-role-diag-nonproposer-'));
  mkdirSync(join(dir, 'chains'));
  mkdirSync(join(dir, 'tasks'));
  const cfg = JSON.parse(readFileSync(join(repoRoot, 'chains', 'mock-debate.json'), 'utf8'));
  cfg.name = 'mock-debate-nonproposer-role';
  // Role set on a critic, not a proposer - has zero effect on the debate
  // stage (chain-lint's role-on-non-proposer-seat check, seat-role.test.js,
  // covers that in isolation) and used to be able to misclassify a real
  // proposer's debate posts as role-bearing via a shared provider-as-lab
  // string. Now caught fail-loud before a run can even start.
  cfg.seats.critics[0].role = { lens: 'adversary' };
  writeFileSync(join(dir, 'chains', 'mock-debate-nonproposer-role.json'), JSON.stringify(cfg));
  writeFileSync(join(dir, 'tasks', 't.md'), 'A tiny task.\n');

  assert.throws(() => execFileSync('node', [cli, '--chain', 'mock-debate-nonproposer-role', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir }));
  try {
    execFileSync('node', [cli, '--chain', 'mock-debate-nonproposer-role', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir });
  } catch (err) {
    assert.match(err.stderr, /role-on-non-proposer-seat/);
  }
});
