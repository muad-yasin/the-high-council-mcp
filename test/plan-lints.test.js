// test/plan-lints.test.js - src/lints.js, the $0 deterministic pass that runs before any critic
// sees a draft (config.lints.enabled). Pure functions over plain fixture objects - no seats, no
// model calls, no run folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLints, checkScopeLedger, checkBareNumbers, checkForks, checkAcceptanceTests } from '../src/lints.js';
import { runChain } from '../src/chain.js';

test('checkScopeLedger: a ledger missing one proposal id is caught', () => {
  const deliverable = `# Plan\n\nSome text.\n\n## Scope ledger\n\nMOCKA-1 - accepted - core loop.\n`;
  const proposals = [{ id: 'MOCKA-1' }, { id: 'MOCKB-1' }];
  const findings = checkScopeLedger(deliverable, proposals);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'ledger_id');
  assert.match(findings[0].message, /MOCKB-1/);
});

test('checkScopeLedger: every id present is clean', () => {
  const deliverable = `## Scope ledger\n\nA-1 - accepted - x.\nB-1 - cut - y.\n`;
  const findings = checkScopeLedger(deliverable, [{ id: 'A-1' }, { id: 'B-1' }]);
  assert.deepEqual(findings, []);
});

test('checkBareNumbers: a bare number with no derivation and no placeholder marker is caught', () => {
  const deliverable = `The cache holds 512 entries.\n`;
  const findings = checkBareNumbers(deliverable);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'bare_number');
  assert.match(findings[0].message, /512/);
});

test('checkBareNumbers: a derived number is not flagged', () => {
  const deliverable = `The cache holds 512 entries, derived from 8 shards × 64 slots.\n`;
  assert.deepEqual(checkBareNumbers(deliverable), []);
});

test('checkBareNumbers: a number marked placeholder is not flagged', () => {
  const deliverable = `The cache holds 512 entries (placeholder, not yet measured).\n`;
  assert.deepEqual(checkBareNumbers(deliverable), []);
});

test('checkBareNumbers: years and heading/list markers are not flagged', () => {
  const deliverable = `## Section 3\n\n1. First item\n\nBuilt in 2026.\n`;
  assert.deepEqual(checkBareNumbers(deliverable), []);
});

test('checkForks: a fork with no recorded resolution is caught', () => {
  const findings = checkForks([{ issue: 'sync vs async API', resolution: '' }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'unresolved_fork');
});

test('checkForks: a resolved fork is clean', () => {
  const findings = checkForks([{ issue: 'sync vs async API', resolution: 'async, per criterion 4' }]);
  assert.deepEqual(findings, []);
});

test('checkAcceptanceTests: a bare placeholder is caught', () => {
  const deliverable = `## Part 1\nAcceptance test: <...>\n`;
  const findings = checkAcceptanceTests(deliverable);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'bad_acceptance_test');
});

test('checkAcceptanceTests: an empty value is caught', () => {
  const deliverable = `Acceptance test:\n`;
  assert.equal(checkAcceptanceTests(deliverable).length, 1);
});

test('checkAcceptanceTests: a real command is clean', () => {
  const deliverable = `Acceptance test: \`npm test\` passes.\n`;
  assert.deepEqual(checkAcceptanceTests(deliverable), []);
});

test('runLints: a clean fixture satisfying all four checks produces an empty lints[]', () => {
  const deliverable = `# Plan\n\n1. Built from 4 modules × 2 layers = 8 pieces.\n\nAcceptance test: \`npm test\` passes.\n\n## Scope ledger\n\nA-1 - accepted - core.\n`;
  const report = { deliverable, proposals: [{ id: 'A-1' }], forks: [{ issue: 'x', resolution: 'settled' }] };
  assert.deepEqual(runLints(report), []);
});

test('runLints: with lints.enabled absent, the lint function is never invoked and report.json shape is unchanged', async () => {
  const mockConfig = {
    name: 'mock-lints-absent',
    maxRounds: 1,
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-unreadable' }],
    },
  };
  const result = await runChain({ request: 'A short plan for a reading list.', config: mockConfig, log: () => {} });
  assert.equal(result.lints, undefined);
  assert.ok(!('lints' in result) || result.lints === undefined);
});

test('runLints: with lints.enabled true, report.json-shaped result carries lints[]', async () => {
  const mockConfig = {
    name: 'mock-lints-enabled',
    maxRounds: 1,
    lints: { enabled: true },
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-unreadable' }],
    },
  };
  const result = await runChain({ request: 'A short plan for a reading list.', config: mockConfig, log: () => {} });
  assert.ok(Array.isArray(result.lints));
});
