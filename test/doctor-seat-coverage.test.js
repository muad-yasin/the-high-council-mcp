// test/doctor-seat-coverage.test.js
//
// Pre-release audit 2026-09-23 (PreRelease_Audit_lint #3): the bare `council doctor` listing
// hand-built its own seat list and missed the challenger, cold reader, claims, ambiguity,
// descending, preflight and default security-reviewer seats, so it called a chain "runnable" that
// a real run refuses; and the dry-run estimate had no rows for the optional stages those seats
// run. `council doctor` reads only the package's own chains/, so its listing is pinned at the
// source (it must use the shared enumerator), and the estimate is pinned directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateChainRows } from '../src/cost.js';

const base = {
  maxRounds: 1,
  estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' },
    builder: { provider: 'mock', model: 'mock-builder' },
    critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }, { provider: 'mock', model: 'mock-critic-b', lab: 'b' }],
  },
};
const labels = cfg => estimateChainRows(cfg).map(r => r.label);

test('doctor: the bare chain listing uses the same seat enumerator as a real run', () => {
  const src = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  const listing = src.slice(src.indexOf('Chains (runnable = '), src.indexOf('No network calls were made'));
  assert.match(listing, /everySeatOf\(/, 'the listing must check every seat a run would call');
  assert.doesNotMatch(listing, /cfg\.seats\.criteria, cfg\.seats\.builder/, 'no hand-built seat list');
});

test('dry run: optional stages are priced only when the chain enables them', () => {
  const plain = labels(base);
  for (const l of ['challenge', 'challenge-revise', 'cold-read', 'claims']) assert.ok(!plain.includes(l), l);
  assert.ok(!plain.some(l => l.startsWith('ambiguity-') || l.startsWith('preflight-')));

  const on = labels({
    ...base,
    challenge: { enabled: true }, coldRead: { enabled: true }, claims: { enabled: true },
    ambiguity_union: { enabled: true }, preflight: {},
    seats: { ...base.seats, coldRead: { provider: 'mock', model: 'mock-cold' } },
  });
  for (const l of ['challenge', 'challenge-revise', 'cold-read', 'claims', 'ambiguity-a', 'ambiguity-b', 'preflight-a', 'preflight-b']) {
    assert.ok(on.includes(l), `dry run is missing ${l}`);
  }
  assert.ok(on.indexOf('ambiguity-a') < on.indexOf('criteria'), 'ambiguity runs before criteria');
});
