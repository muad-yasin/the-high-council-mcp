// test/claims.test.js - src/claims.js, the claim schema with typed evidence
// (config.claims.enabled). Offline, mock seats only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvidence, dropInvalidClaims, toolRefExists } from '../src/claims.js';
import { runChain } from '../src/chain.js';

const DRAFT = `# Plan\n\nThe cache holds 512 entries, evicted least-recently-used.\n`;

test('validateEvidence: a quote that string-matches the draft passes', () => {
  const claim = { claim: 'The draft states an eviction policy.', evidence: { kind: 'quote', quote: 'evicted least-recently-used' } };
  const verdict = validateEvidence(claim, { draft: DRAFT });
  assert.equal(verdict.ok, true);
});

test('validateEvidence: a quote that does not match the draft is invalid (dropped, not crashed)', () => {
  const claim = { claim: 'The draft states something it does not.', evidence: { kind: 'quote', quote: 'this phrase is nowhere in the draft' } };
  const verdict = validateEvidence(claim, { draft: DRAFT });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /does not appear verbatim/);
});

test('validateEvidence: a tool ref matching a real ground-truth entry passes', () => {
  const groundTruth = [{ tool: 'grep_repo', args: {}, result: { ok: true, matches: [] } }];
  const claim = { claim: 'grep found nothing.', evidence: { kind: 'tool', result_ref: 'grep_repo' } };
  assert.equal(validateEvidence(claim, { groundTruth }).ok, true);
});

test('validateEvidence: a tool ref with a bad/missing reference is invalid', () => {
  assert.equal(validateEvidence({ claim: 'x', evidence: { kind: 'tool', result_ref: 'nonexistent_tool' } }, { groundTruth: [{ tool: 'grep_repo' }] }).ok, false);
  assert.equal(validateEvidence({ claim: 'x', evidence: { kind: 'tool' } }, { groundTruth: [{ tool: 'grep_repo' }] }).ok, false);
  assert.equal(validateEvidence({ claim: 'x', evidence: { kind: 'tool', result_ref: 'grep_repo' } }, { groundTruth: undefined }).ok, false);
});

test('validateEvidence: indexed tool refs disambiguate repeated tool calls', () => {
  const groundTruth = [{ tool: 'read_file' }, { tool: 'read_file' }];
  assert.equal(toolRefExists('read_file:0', groundTruth), true);
  assert.equal(toolRefExists('read_file:1', groundTruth), true);
  assert.equal(toolRefExists('read_file:2', groundTruth), false);
});

test('validateEvidence: reasoning is always valid', () => {
  assert.equal(validateEvidence({ claim: 'x', evidence: { kind: 'reasoning' } }, {}).ok, true);
});

test('validateEvidence: missing evidence or unknown kind is invalid', () => {
  assert.equal(validateEvidence({ claim: 'x' }, {}).ok, false);
  assert.equal(validateEvidence({ claim: 'x', evidence: { kind: 'vibes' } }, {}).ok, false);
});

test('dropInvalidClaims: one bad claim is dropped with a WARNINGS.md-ready line, the rest survive', () => {
  const raw = [
    { claim: 'good', evidence: { kind: 'reasoning' } },
    { claim: 'bad quote', evidence: { kind: 'quote', quote: 'not in draft anywhere' } },
  ];
  const { claims, warnings } = dropInvalidClaims(raw, { draft: DRAFT });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].claim, 'good');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /claim dropped/);
});

test('runChain: claims.enabled absent - no claims stage runs, no claims[] on the result, v6 shape unchanged', async () => {
  const mockConfig = {
    name: 'mock-claims-absent',
    maxRounds: 1,
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-unreadable' }],
    },
  };
  const result = await runChain({ request: 'A short plan for a reading list.', config: mockConfig, log: () => {} });
  assert.equal(result.claims, undefined);
  assert.equal(result.claimWarnings, undefined);
});

test('runChain: claims.enabled true with a clean extraction seat keeps claims and drops nothing', async () => {
  const mockConfig = {
    name: 'mock-claims-enabled',
    maxRounds: 1,
    claims: { enabled: true },
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-unreadable' }],
      claims: { provider: 'mock', model: 'mock-claims-good' },
    },
  };
  const result = await runChain({ request: 'A short plan for a reading list.', config: mockConfig, log: () => {} });
  assert.ok(Array.isArray(result.claims));
  assert.ok(result.claims.length > 0, 'the critic seat is mock-unreadable, so an abstention still leaves an unparseable-critic failure to extract a claim from');
  assert.deepEqual(result.claimWarnings, []);
});

test('runChain: claims.enabled true with a bad-quote extraction seat drops the claim, not the run', async () => {
  const mockConfig = {
    name: 'mock-claims-bad-quote',
    maxRounds: 1,
    claims: { enabled: true },
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-unreadable' }],
      claims: { provider: 'mock', model: 'mock-claims-bad-quote' },
    },
  };
  const result = await runChain({ request: 'A short plan for a reading list.', config: mockConfig, log: () => {} });
  assert.deepEqual(result.claims, []);
  assert.ok(result.claimWarnings.length > 0);
  assert.match(result.claimWarnings[0], /claim dropped/);
});
