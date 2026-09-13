// test/chain-lint.test.js
//
// v5 §1 candidate 5: fail-loud pre-flight chain linting - missing stage
// contracts, unreachable stages, missing tool (provider) references.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

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
