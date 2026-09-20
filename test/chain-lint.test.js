// test/chain-lint.test.js
//
// v5 §1 candidate 5: fail-loud pre-flight chain linting - missing stage
// contracts, unreachable stages, missing tool (provider) references.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const root = resolve(here, '..');

test('a clean chain config has no findings', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }, 'chains/fixture.json');
  assert.deepEqual(findings, []);
});

test('test_chain_lint_catches_errors: a missing stage contract, an unreachable stage, and a missing tool reference, each with a fix', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critc: { provider: 'anthropic', model: 'claude-sonnet-5' },  // typo'd key: missing stage contract
      critics: [],                                                  // unreachable stage
      builder: { provider: 'nosuchlab', model: 'x' },               // missing tool reference
    },
  }, 'chains/fixture.json');

  const kinds = findings.map(f => f.kind).sort();
  assert.deepEqual(kinds, ['missing-stage-contract', 'missing-tool-reference', 'unreachable-stage']);
  for (const f of findings) {
    assert.ok(f.fix && f.fix.length > 0, `${f.kind} must carry an actionable fix`);
    assert.match(f.fix, /chains\/fixture\.json/, `${f.kind}'s fix must name the real file path`);
  }
});

test('missing seats.critics entirely (not just empty) is also unreachable-stage', () => {
  const findings = lintChain({ seats: { criteria: { provider: 'anthropic', model: 'x' } } }, 'chains/fixture.json');
  assert.ok(findings.some(f => f.kind === 'unreachable-stage'));
});

test('an unrecognized provider is only reported once even if it appears on multiple seats', () => {
  const findings = lintChain({
    seats: {
      builder: { provider: 'nosuchlab', model: 'x' },
      reviser: { provider: 'nosuchlab', model: 'y' },
      critics: [{ provider: 'anthropic', model: 'z' }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'missing-tool-reference').length, 1);
});

test('mock and external providers are never flagged', () => {
  const findings = lintChain({
    seats: {
      builder: { provider: 'mock', model: 'x' },
      reviser: { provider: 'external' },
      critics: [{ provider: 'mock', model: 'z' }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'missing-tool-reference').length, 0);
});

test('a malformed/empty config never throws', () => {
  assert.deepEqual(lintChain({}), [{
    kind: 'unreachable-stage',
    message: 'seats.critics is missing or empty, so the critique/panel round can never run a real review.',
    fix: 'Add at least one seat to "seats.critics" in <chain>, e.g. { "provider": "anthropic", "model": "claude-sonnet-5" }.',
  }]);
  assert.deepEqual(lintChain(null), lintChain({}));
  assert.deepEqual(lintChain(undefined), lintChain({}));
});

test('council doctor --chain <file> exits 1 and lists all three problems, each with a fix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-lint-cli-'));
  const chainPath = join(dir, 'broken.json');
  writeFileSync(chainPath, JSON.stringify({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critc: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [],
      builder: { provider: 'nosuchlab', model: 'x' },
    },
  }));
  assert.throws(() => execFileSync('node', [cli, 'doctor', '--chain', chainPath], { encoding: 'utf8' }));
  try {
    execFileSync('node', [cli, 'doctor', '--chain', chainPath], { encoding: 'utf8' });
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr, /missing-stage-contract/);
    assert.match(err.stderr, /unreachable-stage/);
    assert.match(err.stderr, /missing-tool-reference/);
    assert.match(err.stderr, /fix:/);
  }
});

test('council doctor --chain <file> exits 0 on a clean chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-lint-cli-clean-'));
  const chainPath = join(dir, 'clean.json');
  writeFileSync(chainPath, JSON.stringify({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }));
  const out = execFileSync('node', [cli, 'doctor', '--chain', chainPath], { encoding: 'utf8' });
  assert.match(out, /no lint problems/);
});

test('council --chain <broken chain name> refuses to run, fail-loud, before any metered call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-lint-run-'));
  const chainsDir = join(dir, 'chains');
  mkdirSync(chainsDir);
  writeFileSync(join(chainsDir, 'broken.json'), JSON.stringify({
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [],
    },
  }));
  const taskPath = join(dir, 'task.md');
  writeFileSync(taskPath, 'A tiny task.');
  assert.throws(() => execFileSync('node', [cli, '--chain', 'broken', '--task', taskPath], { encoding: 'utf8', cwd: dir }));
  try {
    execFileSync('node', [cli, '--chain', 'broken', '--task', taskPath], { encoding: 'utf8', cwd: dir });
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr, /chain lint/);
    assert.match(err.stderr, /unreachable-stage/);
  }
});

test('item 6: chains/plan-two-strong.json (the roster-inversion chain) passes chain-lint', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'plan-two-strong.json'), 'utf8'));
  const findings = lintChain(config, 'chains/plan-two-strong.json');
  assert.deepEqual(findings, []);
});

// Check 12: self-review. The real incident is the cheap-7 run of 2026-09-20 -
// one lab wrote the criteria, skeleton, draft and every revision AND held a
// critic seat, so it voted on its own work under unanimous signoff.

test('self-review: the builder\'s own lab on the critic panel fails lint under unanimous signoff', () => {
  const findings = lintChain({
    signoff: 'unanimous',
    seats: {
      builder: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
      critics: [
        { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
        { provider: 'openrouter', model: 'openai/gpt-5-mini', lab: 'gpt5-mini' },
      ],
    },
  }, 'chains/fixture.json');
  const selfReview = findings.filter(f => f.kind === 'self-review');
  assert.equal(selfReview.length, 1);
  assert.match(selfReview[0].message, /seats\.builder is lab "sonnet5"/);
  // The fix must name the real escape hatch, not just the problem.
  assert.match(selfReview[0].fix, /selfReview/);
});

test('self-review: the reviser is caught too, and separately from the builder', () => {
  const findings = lintChain({
    signoff: 'unanimous',
    seats: {
      builder: { provider: 'openrouter', model: 'openai/gpt-5-mini', lab: 'gpt5-mini' },
      reviser: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
      critics: [
        { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
        { provider: 'openrouter', model: 'openai/gpt-5-mini', lab: 'gpt5-mini' },
      ],
    },
  }, 'chains/fixture.json');
  const kinds = findings.filter(f => f.kind === 'self-review').map(f => f.message);
  assert.equal(kinds.length, 2);
  assert.ok(kinds.some(m => /seats\.builder is lab "gpt5-mini"/.test(m)));
  assert.ok(kinds.some(m => /seats\.reviser is lab "sonnet5"/.test(m)));
});

test('self-review: "selfReview": "allowed" is an explicit, greppable escape', () => {
  const config = {
    signoff: 'unanimous',
    selfReview: 'allowed',
    seats: {
      builder: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
      critics: [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' }],
    },
  };
  assert.deepEqual(lintChain(config, 'chains/fixture.json').filter(f => f.kind === 'self-review'), []);
});

test('self-review: a near-miss escape value fails loudly rather than silently reading as "not allowed"', () => {
  for (const value of [true, 'yes', 'Allowed']) {
    const findings = lintChain({
      signoff: 'unanimous',
      selfReview: value,
      seats: { builder: { provider: 'mock', model: 'mock-a', lab: 'a' }, critics: [{ provider: 'mock', model: 'mock-b', lab: 'b' }] },
    }, 'chains/fixture.json');
    const f = findings.filter(x => x.kind === 'self-review');
    assert.equal(f.length, 1, `expected ${JSON.stringify(value)} to be rejected`);
    assert.match(f[0].message, /must be the exact string "allowed"/);
  }
});

test('self-review: keys on lab, not provider - several labs on one provider is the normal case, not a finding', () => {
  // Every mock chain puts several labs on the "mock" provider by design, and
  // cheap-7's seven labs all share the "openrouter" provider. A check keyed on
  // provider would fire on all of them and miss the real defect entirely.
  const findings = lintChain({
    signoff: 'unanimous',
    seats: {
      builder: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [
        { provider: 'mock', model: 'mock-critic', lab: 'panel-one' },
        { provider: 'mock', model: 'mock-critic', lab: 'panel-two' },
      ],
    },
  }, 'chains/fixture.json');
  assert.deepEqual(findings.filter(f => f.kind === 'self-review'), []);
});

test('self-review: scoped to unanimous signoff, where the author\'s lab holds a real veto', () => {
  const seats = {
    builder: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
    critics: [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' }],
  };
  assert.deepEqual(lintChain({ seats }, 'chains/fixture.json').filter(f => f.kind === 'self-review'), []);
  assert.equal(lintChain({ signoff: 'unanimous', seats }, 'chains/fixture.json').filter(f => f.kind === 'self-review').length, 1);
});

// The sweep: which shipped chains does this rule actually fail? Pinned so that
// adding a chain that grades its own work, or quietly "fixing" cheap-7 with the
// escape hatch, fails the suite instead of passing unnoticed.
test('self-review: exactly one shipped chain fails it, and it is the superseded one', () => {
  const failing = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).filter(f => {
    const config = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    return lintChain(config, `chains/${f}`).some(x => x.kind === 'self-review');
  });
  assert.deepEqual(failing, ['cheap-7.json']);
});

test('cheap-7-v2: the replacement chain passes lint, and its panel excludes its author\'s lab', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'cheap-7-v2.json'), 'utf8'));
  assert.deepEqual(lintChain(config, 'chains/cheap-7-v2.json'), []);
  const criticLabs = config.seats.critics.map(s => s.lab || s.provider);
  assert.equal(criticLabs.length, 6);
  for (const kind of ['builder', 'reviser', 'skeleton', 'handoff']) {
    assert.ok(!criticLabs.includes(config.seats[kind].lab), `${kind}'s lab must not be on the panel`);
  }
  // The lab that sets the bar must not be the lab that clears it.
  assert.notEqual(config.seats.criteria.lab, config.seats.builder.lab);
  // No escape hatch in our own chain (Muad's call, 2026-09-20).
  assert.ok(!('selfReview' in config));
});
