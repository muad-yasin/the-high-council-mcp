// test/compliance-chains.test.js
//
// v7.x item 3 (procurement-readiness plan, relay run
// 2026-09-14T15-29-02-644Z, "Compliance chains shipped by default"): four
// new chain files - eu-only, us-only, single-vendor-anthropic,
// single-vendor-openai - each documenting which providers/regions it
// touches, enforced by chain-lint.js's new "invalid-compliance-config"
// check the same way challenge/allocator config keys are validated. $0,
// offline, no live key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { priceOf } from '../src/cost.js';
import { providerNames } from '../src/providers.js';

const here = dirname(fileURLToPath(import.meta.url));
const chainsDir = join(here, '../chains');
const knownProviders = new Set(providerNames());

const COMPLIANCE_CHAINS = ['eu-only', 'us-only', 'single-vendor-anthropic', 'single-vendor-openai'];

function loadChain(name) {
  return JSON.parse(readFileSync(join(chainsDir, `${name}.json`), 'utf8'));
}

test('all four shipped compliance chains exist and lint clean', () => {
  for (const name of COMPLIANCE_CHAINS) {
    const config = loadChain(name);
    const findings = lintChain(config, `chains/${name}.json`);
    assert.deepEqual(findings, [], `${name}.json should lint clean, got: ${JSON.stringify(findings)}`);
  }
});

test('every seat in every compliance chain uses a known provider (src/providers.js)', () => {
  for (const name of COMPLIANCE_CHAINS) {
    const config = loadChain(name);
    const seats = [
      config.seats.criteria, config.seats.builder, config.seats.reviser,
      ...(config.seats.critics || []),
    ].filter(Boolean);
    for (const s of seats) {
      assert.ok(knownProviders.has(s.provider), `${name}.json: unknown provider "${s.provider}"`);
    }
  }
});

test('every seat in every compliance chain is priced (src/pricing.json) - no unpriced/uncapped seats', () => {
  for (const name of COMPLIANCE_CHAINS) {
    const config = loadChain(name);
    const seats = [
      config.seats.criteria, config.seats.builder, config.seats.reviser,
      ...(config.seats.critics || []),
    ].filter(Boolean);
    for (const s of seats) {
      assert.ok(priceOf(s.provider, s.model), `${name}.json: ${s.provider}/${s.model} has no price entry`);
    }
  }
});

test("each compliance chain's description names every provider and region it declares", () => {
  for (const name of COMPLIANCE_CHAINS) {
    const config = loadChain(name);
    for (const p of config.compliance.providers || []) {
      assert.match(config.description, new RegExp(p), `${name}.json: description doesn't name provider "${p}"`);
    }
    for (const r of config.compliance.regions || []) {
      assert.match(config.description, new RegExp(r), `${name}.json: description doesn't name region "${r}"`);
    }
  }
});

test('eu-only has zero seats on the non-EU labs the source report flags (deepseek, zai)', () => {
  const config = loadChain('eu-only');
  const seats = [
    config.seats.criteria, config.seats.builder, config.seats.reviser,
    ...(config.seats.critics || []),
  ].filter(Boolean);
  for (const s of seats) {
    assert.ok(!['deepseek', 'zai'].includes(s.provider), `eu-only.json: seat uses non-EU provider "${s.provider}"`);
  }
  assert.deepEqual(config.compliance.regions, ['EU']);
});

test('single-vendor-anthropic and single-vendor-openai route every seat through exactly one provider', () => {
  for (const [name, vendor] of [['single-vendor-anthropic', 'anthropic'], ['single-vendor-openai', 'openai']]) {
    const config = loadChain(name);
    const seats = [
      config.seats.criteria, config.seats.builder, config.seats.reviser,
      ...(config.seats.critics || []),
    ].filter(Boolean);
    assert.ok(seats.length > 0);
    for (const s of seats) {
      assert.equal(s.provider, vendor, `${name}.json: seat uses "${s.provider}", not the declared single vendor "${vendor}"`);
    }
  }
});

test('chain-lint: compliance.providers naming a provider no seat uses fails validation', () => {
  const findings = lintChain({
    description: 'touches nosuchlab',
    compliance: { providers: ['nosuchlab'] },
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }, 'chains/fixture.json');
  const kinds = findings.map(f => f.kind);
  assert.ok(kinds.includes('invalid-compliance-config'));
});

test('chain-lint: a seat using a provider the description/compliance block never names fails validation', () => {
  const findings = lintChain({
    description: 'anthropic only',
    compliance: { providers: ['anthropic'] },
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'openai', model: 'gpt-5' }],
    },
  }, 'chains/fixture.json');
  const kinds = findings.map(f => f.kind);
  assert.ok(kinds.includes('invalid-compliance-config'));
});

test('chain-lint: an unrecognized compliance key fails validation', () => {
  const findings = lintChain({
    description: 'anthropic only',
    compliance: { providers: ['anthropic'], maxCost: 5 },
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }, 'chains/fixture.json');
  const kinds = findings.map(f => f.kind);
  assert.ok(kinds.includes('invalid-compliance-config'));
});

test('chain-lint: compliance.regions claiming EU with a deepseek/zai seat fails validation', () => {
  const findings = lintChain({
    description: 'EU anthropic deepseek',
    compliance: { regions: ['EU'], providers: ['anthropic', 'deepseek'] },
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    },
  }, 'chains/fixture.json');
  const kinds = findings.map(f => f.kind);
  assert.ok(kinds.includes('invalid-compliance-config'));
});

test('chain-lint: a compliance chain with an unpriced model fails validation', () => {
  const findings = lintChain({
    description: 'anthropic only',
    compliance: { providers: ['anthropic'] },
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'no-such-model-version' }],
    },
  }, 'chains/fixture.json');
  const kinds = findings.map(f => f.kind);
  assert.ok(kinds.includes('invalid-compliance-config'));
});

test('chain-lint: a chain with no compliance field at all is unaffected (no-op)', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }, 'chains/fixture.json');
  assert.deepEqual(findings, []);
});

test('the shipped chains directory count includes the four new compliance chains', () => {
  const count = readdirSync(chainsDir).filter(f => f.endsWith('.json')).length;
  for (const name of COMPLIANCE_CHAINS) {
    assert.ok(readdirSync(chainsDir).includes(`${name}.json`));
  }
  assert.ok(count >= COMPLIANCE_CHAINS.length);
});
