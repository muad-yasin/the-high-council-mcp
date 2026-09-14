// test/two-strong-mock.test.js
//
// Item 6 (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md): chains/plan-two-strong.json is a
// roster-inversion chain - two strong seats from different labs propose and debate one round, one
// strong adjudicator seat signs off, no cheap-tier critic roster. This exercises the same chain
// shape end-to-end with `mock` provider seats standing in for the two strong labs and the
// adjudicator - no API key required - and separately prices the real chain file with --dry-run to
// confirm it never calls a real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runChain } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'src/cli.js');
const twoStrongConfig = JSON.parse(readFileSync(join(root, 'chains', 'plan-two-strong.json'), 'utf8'));

test('chains/plan-two-strong.json passes chain-lint', () => {
  const findings = lintChain(twoStrongConfig, 'chains/plan-two-strong.json');
  assert.deepEqual(findings, []);
});

test('chains/plan-two-strong.json sets roster.minimal_two_strong and stays under a five-seat critic roster', () => {
  assert.equal(twoStrongConfig.roster.minimal_two_strong, true);
  assert.ok(twoStrongConfig.seats.critics.length < 5);
  assert.equal(twoStrongConfig.seats.proposers.length, 2);
  // Two different labs, per the item's own design.
  const labs = new Set(twoStrongConfig.seats.proposers.map(s => s.lab || s.provider));
  assert.equal(labs.size, 2);
});

test('"council doctor --chain chains/plan-two-strong.json" (the shipped chain) exits 0', () => {
  const out = execFileSync('node', [cli, 'doctor', '--chain', 'chains/plan-two-strong.json'], { encoding: 'utf8', cwd: root });
  assert.match(out, /no lint problems/);
});

test('"npm run dry -- --chain plan-two-strong" prices the chain without calling any real provider', () => {
  const dir = mkTmpTaskDir();
  const out = execFileSync('node', [cli, '--task', 'tasks/probe.md', '--chain', 'plan-two-strong', '--dry-run'], { encoding: 'utf8', cwd: dir.cwd });
  assert.match(out, /Chain: plan-two-strong/);
  dir.cleanup();
});

test('runChain: the two-strong shape end-to-end with mock seats completes and produces a signoff', async () => {
  const config = {
    ...twoStrongConfig,
    proposals: { parts: 2, maxTokens: 400 },
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      skeleton: { provider: 'mock', model: 'mock-skeleton' },
      builder: { provider: 'mock', model: 'mock-builder' },
      reviser: { provider: 'mock', model: 'mock-builder' },
      handoff: { provider: 'mock', model: 'mock-handoff' },
      proposers: [
        { provider: 'mock', model: 'mock-proposer-a', lab: 'strong-lab-1' },
        { provider: 'mock', model: 'mock-proposer-b', lab: 'strong-lab-2' },
      ],
      critics: [
        { provider: 'mock', model: 'mock-critic-a', lab: 'adjudicator-lab' },
      ],
    },
  };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  assert.ok(result.proposals.length > 0, 'the two strong seats should have proposed');
  assert.ok(result.debate, 'one debate round should have run');
  assert.ok(Array.isArray(result.signoff) && result.signoff.length === 1, 'exactly one adjudicator seat should have voted');
  assert.equal(typeof result.deliverable, 'string');
  assert.ok(result.deliverable.length > 0);
});

function mkTmpTaskDir() {
  const cwd = mkdtempSync(join(tmpdir(), 'thc-two-strong-dry-'));
  mkdirSync(join(cwd, 'tasks'));
  writeFileSync(join(cwd, 'tasks', 'probe.md'), 'A one-line fixture task for dry-run pricing tests.');
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
