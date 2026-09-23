// test/resource-allocator.test.js
//
// v7.3, Resource Allocator: disagreement-targeted round spending
// (maintainers/proposals/v7x-gatekeeper-allocator-proposal.md item 2), built now per the author's own
// instruction to build rather than just scope it. Its own Research: line flagged the real risk:
// concentrating rounds on contested claims is structurally still repeated re-debate of that
// claim, closer to the literature's degradation warning than v7 item 3 (descending rounds), not
// automatically safe - so the falsification watch (engaged vs. rubber-stamp) must ship WITH the
// feature, tested here, not added later.
//
// Disagreement definition (documented in src/chain.js's pickContestedCriterion): a criterion
// some voting critics marked FAILED this round and others did not - unanimous either way is
// consensus, not disagreement, and is excluded. Chosen over stance/debate.replies because it is
// the only signal present on every unanimous-signoff run regardless of whether debate is enabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, runDescendingChain, pickContestedCriterion } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { metricsReport } from '../src/metrics.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unanimousConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));

// A split panel: mock-critic-a signs off once the draft is revised; mock-critic-holdout never
// signs off and always fails the same criterion - so once the draft has been revised once, the
// two disagree on that one criterion every round after.
function splitConfig(overrides = {}) {
  return {
    ...unanimousConfig,
    maxRounds: 3,
    seats: {
      ...unanimousConfig.seats,
      critics: [
        { provider: 'mock', model: 'mock-critic-a', lab: 'lab-a' },
        { provider: 'mock', model: 'mock-critic-holdout', lab: 'lab-holdout' },
      ],
    },
    ...overrides,
  };
}

test('pickContestedCriterion: fewer than two voting critics can never have a split', () => {
  assert.equal(pickContestedCriterion([]), null);
  assert.equal(pickContestedCriterion([{ seat: {}, critique: { failures: [] } }]), null);
});

test('pickContestedCriterion: unanimous failure or unanimous pass is consensus, not disagreement', () => {
  const seat = (lab) => ({ provider: 'mock', model: 'x', lab });
  const bothFail = [
    { seat: seat('a'), critique: { failures: [{ criterion: 'C1' }] } },
    { seat: seat('b'), critique: { failures: [{ criterion: 'C1' }] } },
  ];
  const bothPass = [
    { seat: seat('a'), critique: { failures: [] } },
    { seat: seat('b'), critique: { failures: [] } },
  ];
  assert.equal(pickContestedCriterion(bothFail), null);
  assert.equal(pickContestedCriterion(bothPass), null);
});

test('pickContestedCriterion: a criterion failed by one of two critics is contested', () => {
  const seat = (lab) => ({ provider: 'mock', model: 'x', lab });
  const split = [
    { seat: seat('a'), critique: { failures: [] } },
    { seat: seat('b'), critique: { failures: [{ criterion: 'C1' }] } },
  ];
  const contested = pickContestedCriterion(split);
  assert.ok(contested);
  assert.equal(contested.criterion, 'C1');
  assert.deepEqual(contested.failedBy, ['b']);
  assert.equal(contested.votingCount, 2);
});

test('runChain: allocator absent preserves current behavior exactly (mock-unanimous.json runs unchanged)', async () => {
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: unanimousConfig, log: () => {} });
  assert.equal(result.allocator, null);
});

test('runChain: with allocator enabled and a split panel, one extra round targets the contested criterion and the draft actually changes (engaged)', async () => {
  const config = splitConfig({ allocator: { enabled: true } });
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });

  assert.ok(result.allocator, 'expected an allocator object in the result');
  assert.equal(result.allocator.targetedRounds.length, 1, 'expected exactly one targeted round (round 2 - round 1 is unanimous failure, round 3 is round-capped before the allocator step runs)');
  const [round] = result.allocator.targetedRounds;
  assert.equal(round.criterion, 'It states the assumptions it was written under.');
  assert.equal(round.failedBy.length, 1);
  assert.equal(round.votingCount, 2);
  assert.equal(round.engaged, true, 'expected the scripted reviser to visibly apply the allocator fix');
  assert.equal(result.allocator.engagedCount, 1);
  assert.equal(result.allocator.rubberStampCount, 0);
  // Not asserted against result.deliverable: mock-unanimous.json's finalist stage runs after the
  // allocator round and its mock text is a fixed template independent of the draft it receives -
  // the engagement signal lives in the allocator round record, not in the shipped deliverable.
});

test('runChain: with allocator enabled and a reviser that ignores the targeted round, the run records a rubber-stamp, not a false engagement', async () => {
  const config = splitConfig({
    allocator: { enabled: true },
    seats: { ...splitConfig().seats, reviser: { provider: 'mock', model: 'mock-reviser-stubborn' } },
  });
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });

  assert.equal(result.allocator.targetedRounds.length, 1);
  assert.equal(result.allocator.targetedRounds[0].engaged, false);
  assert.equal(result.allocator.engagedCount, 0);
  assert.equal(result.allocator.rubberStampCount, 1);
});

test('runChain: allocator.tools fires the sandboxed tool whose keyword matches the contested criterion, and only that one', async () => {
  const config = splitConfig({
    allocator: {
      enabled: true,
      tools: [
        { tool: 'grep_repo', args: { pattern: 'assumptions' }, keywords: ['assumptions'] },
        { tool: 'check_versions', keywords: ['this keyword never matches anything'] },
      ],
    },
  });
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  assert.equal(result.allocator.targetedRounds[0].tool, 'grep_repo');
});

test('runChain: allocator.tools with no matching keyword fires no tool (not every declared tool runs regardless of relevance)', async () => {
  const config = splitConfig({
    allocator: {
      enabled: true,
      tools: [{ tool: 'check_versions', keywords: ['nothing-in-the-criterion-matches-this'] }],
    },
  });
  const result = await runChain({ request: 'Write a short fixture deliverable.', config, log: () => {} });
  assert.equal(result.allocator.targetedRounds[0].tool, null);
});

test('runDescendingChain: allocator is not silently dropped when stacked with descending - the final round is a normal unanimous runChain() call over the whole stack', async () => {
  const config = {
    ...splitConfig({ allocator: { enabled: true } }),
    descending: true,
    seats: {
      ...splitConfig().seats,
      critics: [
        { provider: 'mock', model: 'mock-critic-a', lab: 'lab-a' },
        { provider: 'mock', model: 'mock-critic-holdout', lab: 'lab-holdout' },
      ],
    },
  };
  const result = await runDescendingChain({ request: 'Plan a small offline tool.', config, log: () => {} });
  assert.notEqual(result.allocator, undefined, 'expected result.allocator to be forwarded from the final stacked round, not dropped');
});

// --- chain-lint: allocator.enabled is validated, not silently accepted ---

function baseLintConfig() {
  return {
    signoff: 'unanimous',
    seats: {
      // Distinct labs AND distinct models on the panel: this fixture exists to exercise
      // allocator config, and a roster where the builder's model also sits on the panel trips
      // chain-lint's self-review check (added 2026-09-20; since 2026-09-23 it matches the model,
      // not only the lab label), burying the finding this file actually asserts on.
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'author' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'author' },
      critics: [
        { provider: 'openrouter', model: 'openai/gpt-6', lab: 'panel-one' },
        { provider: 'openrouter', model: 'google/gemini-3.8-flash', lab: 'panel-two' },
      ],
    },
  };
}

test('chain-lint: allocator.enabled alone under unanimous signoff has no findings', () => {
  const findings = lintChain({ ...baseLintConfig(), allocator: { enabled: true } }, 'chains/fixture.json');
  assert.deepEqual(findings, []);
});

test('chain-lint: allocator.enabled without unanimous signoff fails validation', () => {
  const config = { ...baseLintConfig(), signoff: undefined, allocator: { enabled: true } };
  const findings = lintChain(config, 'chains/fixture.json');
  assert.ok(findings.some(f => f.kind === 'invalid-allocator-config' && /signoff/.test(f.message)));
});

test('chain-lint: an unrecognized allocator key fails validation', () => {
  const config = { ...baseLintConfig(), allocator: { enabled: true, maxAllocations: 5 } };
  const findings = lintChain(config, 'chains/fixture.json');
  assert.ok(findings.some(f => f.kind === 'invalid-allocator-config' && /maxAllocations/.test(f.message)));
});

test('chain-lint: allocator.tools entries are validated (unknown tool, missing keywords)', () => {
  const config = {
    ...baseLintConfig(),
    allocator: {
      enabled: true,
      tools: [
        { tool: 'run_a_shell_command', keywords: ['x'] },
        { tool: 'grep_repo' }, // missing keywords
      ],
    },
  };
  const findings = lintChain(config, 'chains/fixture.json').map(f => f.message);
  assert.ok(findings.some(m => /unrecognized tool/.test(m)));
  assert.ok(findings.some(m => /keywords/.test(m)));
});

// --- metrics.js: the falsification watch is exposed across runs, not hoped-for ---

function metricsFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-allocator-metrics-'));
  const runs = join(dir, 'runs');
  mkdirSync(runs);
  const add = (id, report) => {
    const d = join(runs, id);
    mkdirSync(d);
    writeFileSync(join(d, 'report.json'), JSON.stringify(report));
  };
  return { runs, add };
}

test('metricsReport: allocatorRubberStampRate is derived from report.json allocator.targetedRounds across runs', () => {
  const { runs, add } = metricsFixture();
  add('2026-09-14T10-00-00-000Z', {
    allocator: { targetedRounds: [{ engaged: true }, { engaged: false }] },
  });
  add('2026-09-14T11-00-00-000Z', {
    allocator: { targetedRounds: [{ engaged: false }] },
  });
  const report = metricsReport(runs, { days: 3650 });
  // 3 targeted rounds total, 1 engaged, 2 rubber-stamped -> rate 2/3.
  assert.equal(report.counts.allocatorRoundsTargeted, 3);
  assert.equal(report.counts.allocatorRoundsEngaged, 1);
  assert.ok(Math.abs(report.allocatorRubberStampRate - 2 / 3) < 1e-9);
});

test('metricsReport: no allocator data anywhere degrades to null, not zero or a crash', () => {
  const { runs, add } = metricsFixture();
  add('2026-09-14T10-00-00-000Z', { proposals: [] });
  const report = metricsReport(runs, { days: 3650 });
  assert.equal(report.allocatorRubberStampRate, null);
  assert.equal(report.counts.allocatorRoundsTargeted, 0);
});
