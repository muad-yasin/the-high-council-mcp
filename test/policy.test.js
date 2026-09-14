// test/policy.test.js
//
// v7.x item 1, central policy file (~/Projects/relay/runs/2026-09-14T15-29-02-644Z/
// deliverable.md). If policy.json exists at the locked path (work/policy.json), it is parsed
// and enforced before any provider call; absent, every existing chain runs exactly as it does
// today - checked directly below (case 1 of the deliverable's own acceptance test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, evaluatePolicy, monthToDateUsd, POLICY_PATH } from '../src/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const repoRoot = resolve(here, '..');

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// --- loadPolicy: the absent/malformed/present three-way, pure I/O ---

test('loadPolicy: no file at the locked path -> { policy: null, error: null } (today\'s behavior)', () => {
  const dir = tmpDir('thc-policy-absent-');
  assert.deepEqual(loadPolicy(dir), { policy: null, error: null });
});

test('loadPolicy: a malformed policy.json -> { policy: null, error: <parse error> }, never a silent fallback', () => {
  const dir = tmpDir('thc-policy-bad-');
  writeFileSync(join(dir, 'policy.json'), '{not valid json');
  const { policy, error } = loadPolicy(dir);
  assert.equal(policy, null);
  assert.ok(typeof error === 'string' && error.length > 0);
});

test('loadPolicy: a valid policy.json is parsed and returned', () => {
  const dir = tmpDir('thc-policy-ok-');
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_providers: ['anthropic'] }));
  const { policy, error } = loadPolicy(dir);
  assert.equal(error, null);
  assert.deepEqual(policy, { allowed_providers: ['anthropic'] });
});

test('POLICY_PATH is the documented locked path - policy.json at the given directory\'s root', () => {
  assert.equal(POLICY_PATH('/some/dir'), join('/some/dir', 'policy.json'));
});

// --- evaluatePolicy: pure, offline, one field at a time ---

const seat = (provider, model, extra = {}) => ({ provider, model, ...extra });

test('evaluatePolicy: an empty policy object refuses nothing', () => {
  const { ok, reasons } = evaluatePolicy({}, {
    config: { name: 'x' }, allSeats: [seat('anthropic', 'claude-sonnet-5')], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, true);
  assert.deepEqual(reasons, []);
});

test('evaluatePolicy: allowed_providers refuses a seat on a disallowed provider, and names it', () => {
  const { ok, reasons } = evaluatePolicy({ allowed_providers: ['anthropic'] }, {
    config: { name: 'x' }, allSeats: [seat('anthropic', 'claude-sonnet-5'), seat('deepseek', 'deepseek-v3')], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, false);
  assert.ok(reasons.some(r => r.includes('deepseek/deepseek-v3')));
});

test('evaluatePolicy: mock and external seats are exempt from allowed_providers (never billed, never a real vendor)', () => {
  const { ok } = evaluatePolicy({ allowed_providers: ['anthropic'] }, {
    config: { name: 'x' }, allSeats: [seat('mock', 'mock-builder'), seat('external', 'human')], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, true);
});

test('evaluatePolicy: allowed_regions refuses a seat with no declared region (fail closed on the unverifiable)', () => {
  const { ok, reasons } = evaluatePolicy({ allowed_regions: ['eu'] }, {
    config: { name: 'x' }, allSeats: [seat('anthropic', 'claude-sonnet-5')], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, false);
  assert.ok(reasons.some(r => /declares no region/.test(r)));
});

test('evaluatePolicy: allowed_regions refuses a seat whose declared region is not in the list', () => {
  const { ok, reasons } = evaluatePolicy({ allowed_regions: ['eu'] }, {
    config: { name: 'x' }, allSeats: [seat('deepseek', 'deepseek-v3', { region: 'us' })], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, false);
  assert.ok(reasons.some(r => r.includes('deepseek/deepseek-v3') && r.includes('"us"')));
});

test('evaluatePolicy: allowed_regions passes a seat whose declared region is listed', () => {
  const { ok } = evaluatePolicy({ allowed_regions: ['eu', 'us'] }, {
    config: { name: 'x' }, allSeats: [seat('anthropic', 'claude-sonnet-5', { region: 'eu' })], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, true);
});

test('evaluatePolicy: max_usd_per_run refuses over the limit, passes under it', () => {
  const policy = { max_usd_per_run: 1 };
  assert.equal(evaluatePolicy(policy, { config: { name: 'x' }, allSeats: [], worstCaseUsd: 2, monthToDateUsd: 0 }).ok, false);
  assert.equal(evaluatePolicy(policy, { config: { name: 'x' }, allSeats: [], worstCaseUsd: 0.5, monthToDateUsd: 0 }).ok, true);
});

test('evaluatePolicy: max_usd_per_month refuses when month-to-date spend already exceeds it, regardless of this run\'s own cost', () => {
  const policy = { max_usd_per_month: 10 };
  const { ok, reasons } = evaluatePolicy(policy, { config: { name: 'x' }, allSeats: [], worstCaseUsd: 0, monthToDateUsd: 11 });
  assert.equal(ok, false);
  assert.ok(reasons.some(r => r.startsWith('max_usd_per_month')));
});

test('evaluatePolicy: required_chain_tags refuses a chain missing one or more required tags, names them', () => {
  const policy = { required_chain_tags: ['compliance', 'audited'] };
  const { ok, reasons } = evaluatePolicy(policy, { config: { name: 'x', tags: ['compliance'] }, allSeats: [], worstCaseUsd: 0, monthToDateUsd: 0 });
  assert.equal(ok, false);
  assert.ok(reasons.some(r => r.includes('audited') && !r.includes('compliance,')));
});

test('evaluatePolicy: required_chain_tags passes when every required tag is present (extra tags are fine)', () => {
  const policy = { required_chain_tags: ['compliance'] };
  const { ok } = evaluatePolicy(policy, { config: { name: 'x', tags: ['compliance', 'extra'] }, allSeats: [], worstCaseUsd: 0, monthToDateUsd: 0 });
  assert.equal(ok, true);
});

test('evaluatePolicy: refuse_unpriced_seats refuses a seat with no pricing.json entry', () => {
  const policy = { refuse_unpriced_seats: true };
  const { ok, reasons } = evaluatePolicy(policy, {
    config: { name: 'x' }, allSeats: [seat('anthropic', 'no-such-model-in-pricing-json')], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, false);
  assert.ok(reasons.some(r => r.startsWith('refuse_unpriced_seats')));
});

test('evaluatePolicy: refuse_unpriced_seats absent or false never refuses on price alone', () => {
  const { ok } = evaluatePolicy({}, {
    config: { name: 'x' }, allSeats: [seat('anthropic', 'no-such-model-in-pricing-json')], worstCaseUsd: 0, monthToDateUsd: 0,
  });
  assert.equal(ok, true);
});

test('evaluatePolicy: multiple violated fields all appear in reasons, not just the first', () => {
  const policy = { allowed_providers: ['anthropic'], max_usd_per_run: 0 };
  const { ok, reasons } = evaluatePolicy(policy, {
    config: { name: 'x' }, allSeats: [seat('deepseek', 'deepseek-v3')], worstCaseUsd: 5, monthToDateUsd: 0,
  });
  assert.equal(ok, false);
  assert.equal(reasons.length, 2);
});

// --- monthToDateUsd: reuses spendReport(), calendar-month window ---

function runsFixture() {
  const dir = tmpDir('thc-policy-months-');
  const runs = join(dir, 'runs');
  mkdirSync(runs);
  return runs;
}

function addRun(runsDir, id, report) {
  const d = join(runsDir, id);
  mkdirSync(d);
  writeFileSync(join(d, 'report.json'), JSON.stringify(report));
}

test('monthToDateUsd: sums only runs from the current calendar month, reusing spendReport', () => {
  const runs = runsFixture();
  const now = new Date(2026, 8, 20).getTime(); // 2026-09-20, month is 0-indexed (8 = September)
  // Two run IDs spendReport's own runIdToDate can parse: this-month and clearly-last-month.
  addRun(runs, '2026-09-05T10-00-00-000Z', { totals: { usd: 3 } });
  addRun(runs, '2026-08-15T10-00-00-000Z', { totals: { usd: 100 } });
  const usd = monthToDateUsd(runs, now);
  assert.ok(Math.abs(usd - 3) < 1e-9, `expected only the September run's $3, got $${usd}`);
});

test('monthToDateUsd: an empty runs directory is $0, not an error', () => {
  const runs = runsFixture();
  assert.equal(monthToDateUsd(runs, Date.now()), 0);
});

// --- CLI integration: the deliverable's own three acceptance-test cases ---

function policyTestDir() {
  const dir = tmpDir('thc-policy-cli-');
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'task.md'), 'A task.');
  return dir;
}

const MOCK_CHAIN = JSON.parse(readFileSync(join(repoRoot, 'chains', 'mock.json'), 'utf8'));

test('CLI: no policy.json present - a mock chain run is unaffected (case 1 of the deliverable\'s acceptance test)', () => {
  const dir = policyTestDir();
  writeFileSync(join(dir, 'chains', 'mock.json'), JSON.stringify(MOCK_CHAIN));
  const out = execFileSync('node', [cli, '--chain', 'mock', '--task', 'task.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  assert.match(out, /signed off|open objections|round cap/);
  rmSync(dir, { recursive: true, force: true });
});

test('CLI: allowed_regions violation refuses before any provider call, naming both the field and the offending seat (case 2)', () => {
  const dir = policyTestDir();
  writeFileSync(join(dir, 'chains', 'needs-region.json'), JSON.stringify({
    name: 'needs-region', description: 'x', maxRounds: 1,
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5', region: 'eu' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5', region: 'eu' },
      critics: [{ provider: 'deepseek', model: 'deepseek-v3', region: 'us' }],
    },
  }));
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_regions: ['eu'] }));
  let threw = false;
  try {
    execFileSync('node', [cli, '--chain', 'needs-region', '--task', 'task.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  } catch (err) {
    threw = true;
    assert.notEqual(err.status, 0);
    assert.match(err.stderr, /allowed_regions/);
    assert.match(err.stderr, /deepseek\/deepseek-v3/);
    assert.match(err.stderr, /COUNCIL-E005/);
    // Nothing was ever invoked: no run folder was created at all.
    assert.equal(existsSync(join(dir, 'runs')), false);
  }
  assert.ok(threw, 'expected the CLI to exit non-zero');
  rmSync(dir, { recursive: true, force: true });
});

test('CLI: a malformed policy.json refuses, quoting the parse problem, before any provider call (case 3)', () => {
  const dir = policyTestDir();
  writeFileSync(join(dir, 'chains', 'mock.json'), JSON.stringify(MOCK_CHAIN));
  writeFileSync(join(dir, 'policy.json'), '{not valid json');
  let threw = false;
  try {
    execFileSync('node', [cli, '--chain', 'mock', '--task', 'task.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  } catch (err) {
    threw = true;
    assert.notEqual(err.status, 0);
    assert.match(err.stderr, /isn't valid JSON/);
    assert.match(err.stderr, /COUNCIL-E005/);
  }
  assert.ok(threw, 'expected the CLI to exit non-zero');
  rmSync(dir, { recursive: true, force: true });
});

test('CLI: policy is checked before the missing-API-key gate - a required-tag violation surfaces as COUNCIL-E005, not the key check', () => {
  const dir = policyTestDir();
  writeFileSync(join(dir, 'chains', 'needs-key.json'), JSON.stringify({
    name: 'needs-key', description: 'x', maxRounds: 1,
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }));
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ required_chain_tags: ['audited'] }));
  let threw = false;
  try {
    // No ANTHROPIC_API_KEY in env - if the key check ran first, this would fail as COUNCIL-E001
    // instead. It must not: the policy gate sits before it.
    execFileSync('node', [cli, '--chain', 'needs-key', '--task', 'task.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  } catch (err) {
    threw = true;
    assert.match(err.stderr, /COUNCIL-E005/);
    assert.doesNotMatch(err.stderr, /COUNCIL-E001/);
  }
  assert.ok(threw, 'expected the CLI to exit non-zero');
  rmSync(dir, { recursive: true, force: true });
});

test('CLI: a chain that satisfies the policy runs normally (allowed_providers includes mock)', () => {
  const dir = policyTestDir();
  writeFileSync(join(dir, 'chains', 'mock.json'), JSON.stringify(MOCK_CHAIN));
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_providers: ['mock'], max_usd_per_run: 1000 }));
  const out = execFileSync('node', [cli, '--chain', 'mock', '--task', 'task.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  assert.match(out, /signed off|open objections|round cap/);
  rmSync(dir, { recursive: true, force: true });
});
