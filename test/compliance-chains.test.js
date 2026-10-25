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
// 0.8.3 (lane B): the four compliance chains were retired to chains/outdated/ (Muad 18 Okt 2026); the compliance LINT stays, these files are its fixtures.
const chainsDir = join(here, '../chains/outdated');
const knownProviders = new Set(providerNames());

const COMPLIANCE_CHAINS = ['eu-only', 'us-only', 'single-vendor-anthropic', 'single-vendor-openai'];

function loadChain(name) {
  return JSON.parse(readFileSync(join(chainsDir, `${name}.json`), 'utf8'));
}

test('the compliance chains exist and lint clean, except us-only, whose "US" region no check reads (refused, like any unknown region)', () => {
  for (const name of COMPLIANCE_CHAINS.filter(n => n !== 'us-only')) {
    const config = loadChain(name);
    const findings = lintChain(config, `chains/outdated/${name}.json`);
    assert.deepEqual(findings, [], `${name}.json should lint clean, got: ${JSON.stringify(findings)}`);
  }
  // 0.8.3 (lane B, C&C order 23 Okt 2026): us-only is retired and the lint does not bind chains/outdated/; a user who copies it back gets this one finding from `council doctor --chain`, not a pass for a region claim nothing checks.
  const usOnly = lintChain(loadChain('us-only'), 'chains/outdated/us-only.json');
  assert.equal(usOnly.length, 1, `us-only.json: exactly the region finding, got: ${JSON.stringify(usOnly)}`);
  assert.match(usOnly[0].message, /names "US", which is not a region this check knows/);
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

// 0.8.3 (lane B, C&C order 23 Okt 2026; A-DRAFT message): only the exact string "EU" earns a region check ("US" has none, so it is refused too). "eu" used to skip the routing check (only the description was compared), so a chain claiming it with a deepseek seat passed.
test('chain-lint: a compliance region spelled any other way is refused (fail closed), never checked less; a regions value that is not a list of strings is refused', () => {
  const chain = regions => ({ description: 'eu europe anthropic deepseek', compliance: { regions, providers: ['anthropic', 'deepseek'] }, seats: { criteria: { provider: 'anthropic', model: 'claude-sonnet-5' }, builder: { provider: 'anthropic', model: 'claude-sonnet-5' }, critics: [{ provider: 'deepseek', model: 'deepseek-chat' }] } });
  const hits = regions => lintChain(chain(regions), 'chains/fixture.json').filter(f => f.kind === 'invalid-compliance-config');
  for (const spelled of ['eu', 'Eu', 'europe', ' EU', 'EU ', 'us', 'US']) {
    const found = hits([spelled]);
    assert.ok(found.some(f => f.message.includes(`names "${spelled}", which is not a region this check knows`)), `"${spelled}" is refused: ${found.map(f => f.message).join(' | ')}`);
  }
  assert.ok(hits('EU').some(f => /must be a list of region names/.test(f.message)), 'a string where a list belongs is refused (it used to become the letters E and U, which no check read)');
  assert.ok(hits([1]).some(f => /must be a list of region names/.test(f.message)));
  assert.ok(!hits(['EU']).some(f => /not a region this check knows|must be a list/.test(f.message)), 'control: the exact spelling is not refused for its spelling (it still fails the routing check for the deepseek seat)');
  assert.ok(hits(['EU']).some(f => /not an EU-based lab/.test(f.message)), 'control: "EU" with a deepseek seat still gets the routing finding');
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

test('the four compliance chains sit in chains/outdated/ (retired in 0.8.3)', () => {
  const count = readdirSync(chainsDir).filter(f => f.endsWith('.json')).length;
  for (const name of COMPLIANCE_CHAINS) {
    assert.ok(readdirSync(chainsDir).includes(`${name}.json`));
  }
  assert.ok(count >= COMPLIANCE_CHAINS.length);
});
