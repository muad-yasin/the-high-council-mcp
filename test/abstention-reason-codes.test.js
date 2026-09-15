// test/abstention-reason-codes.test.js
//
// v8 item (a) (deep-research-v8-directional-followup-2026-09-15.md §5.3 item 1): report.json's
// signoff[] entries gain an additive `reason_code` field - null for a real sign-off/pass/
// objection, one of RESERVED_ABSTENTION_REASONS for an abstention. Fixture pattern follows
// test/signoff.test.js (a real critic record is the thing this harness exists to produce).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, RESERVED_ABSTENTION_REASONS, abstentionReasonCode, classifyUnreadable } from '../src/chain.js';

const seat = (model, lab) => ({ provider: 'mock', model, lab });

const config = (critics) => ({
  // maxRounds: 2 - a scripted mock critic fails round 1 and passes only after the reviser's
  // revision (src/providers.js's callMock: "fails the first draft and passes the revision"),
  // so a real sign-off needs two rounds, same as test/signoff.test.js's own fixture.
  name: 'test-abstention-reason-codes', maxRounds: 2, stopOnPass: true, signoff: 'unanimous',
  seats: {
    criteria: seat('mock-criteria'), builder: seat('mock-builder'),
    reviser: seat('mock-builder'), critics,
  },
});

const run = critics => runChain({
  request: 'A test request.', config: config(critics), log: () => {},
});

test('RESERVED_ABSTENTION_REASONS is a small closed set', () => {
  assert.deepEqual(RESERVED_ABSTENTION_REASONS, [
    'SEAT_UNREACHABLE', 'PROVIDER_ERROR', 'REPLY_TRUNCATED', 'REPLY_UNPARSEABLE',
  ]);
});

test('a real sign-off carries reason_code: null', async () => {
  const result = await run([seat('mock-critic-a', 'mock-a')]);
  assert.equal(result.passed, true);
  const entry = result.signoff.find(s => s.provider === 'mock-a');
  assert.equal(entry.reason_code, null);
});

test('a thrown provider exception (mock-network-error) abstains with SEAT_UNREACHABLE', async () => {
  const result = await run([
    seat('mock-critic-a', 'mock-a'),
    seat('mock-network-error', 'mock-down'),
  ]);
  const entry = result.signoff.find(s => s.provider === 'mock-down');
  assert.equal(entry.signedOff, null, 'a caught provider exception must abstain, never fail');
  assert.equal(entry.reason_code, 'SEAT_UNREACHABLE');
});

test('a provider stop:"error" reply (mock-provider-error) abstains with PROVIDER_ERROR', async () => {
  const result = await run([
    seat('mock-critic-a', 'mock-a'),
    seat('mock-provider-error', 'mock-broken'),
  ]);
  const entry = result.signoff.find(s => s.provider === 'mock-broken');
  assert.equal(entry.signedOff, null);
  assert.equal(entry.reason_code, 'PROVIDER_ERROR');
});

test('an unparseable reply (mock-unreadable) abstains with REPLY_UNPARSEABLE', async () => {
  const result = await run([
    seat('mock-critic-a', 'mock-a'),
    seat('mock-unreadable', 'mock-garbled'),
  ]);
  const entry = result.signoff.find(s => s.provider === 'mock-garbled');
  assert.equal(entry.signedOff, null);
  assert.equal(entry.reason_code, 'REPLY_UNPARSEABLE');
});

test('abstentionReasonCode: near-cap output with no error reads as REPLY_TRUNCATED, matching classifyUnreadable', () => {
  const usage = { output: 7999 };
  assert.equal(abstentionReasonCode(usage, 8000), 'REPLY_TRUNCATED');
  assert.equal(classifyUnreadable(usage, 8000), 'hit the token cap, truncated');
});

test('abstentionReasonCode: stop:"error" wins over a near-cap output, matching classifyUnreadable\'s own priority', () => {
  const usage = { output: 7999, stop: 'error' };
  assert.equal(abstentionReasonCode(usage, 8000), 'PROVIDER_ERROR');
  assert.match(classifyUnreadable(usage, 8000), /error/i);
});
