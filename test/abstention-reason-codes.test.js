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
    'SEAT_UNREACHABLE', 'PROVIDER_ERROR', 'REPLY_TRUNCATED', 'REPLY_UNPARSEABLE', 'REASONING_EXHAUSTED',
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

// 2026-09-23 seeded-defect paid run: deepseek/deepseek-v4.1-flash via OpenRouter stopped 6 times at
// 4,224-4,226 output tokens, all of them reasoning, against a 36k cap - and all 3 bigger-cap (64k)
// retries stopped at the same place. Fixtures are the real usage records of one first attempt and its
// retry (relay/pilot/seeded-2026-09-23/runs/2026-09-23T02-35-53-867Z/panel-1-deepseek-v4.1-flash*.usage.json).
const FIRST_ATTEMPT = { input: 9090, output: 4225, thinking: 4225, stop: 'length' };
const BIGGER_CAP_RETRY = { input: 9090, output: 4225, thinking: 4225, stop: 'length' };

test('REASONING_EXHAUSTED: all-reasoning, stopped far under the cap - the real first attempt and its 64k retry', () => {
  assert.equal(abstentionReasonCode(FIRST_ATTEMPT, 36000), 'REASONING_EXHAUSTED');
  assert.equal(abstentionReasonCode(BIGGER_CAP_RETRY, 64000), 'REASONING_EXHAUSTED');
  assert.match(classifyUnreadable(FIRST_ATTEMPT, 36000), /^REASONING_EXHAUSTED: all 4225 tokens were reasoning/);
  // Not this: reasoning that burned OUR cap is still a truncation the bigger-cap retry may fix...
  assert.equal(abstentionReasonCode({ output: 36000, thinking: 36000, stop: 'length' }, 36000), 'REPLY_TRUNCATED');
  // ...and so is an early stop that wrote some answer, or a stop with no reasoning at all.
  assert.equal(abstentionReasonCode({ output: 4225, thinking: 3000, stop: 'length' }, 36000), 'REPLY_TRUNCATED');
  assert.equal(abstentionReasonCode({ output: 4225, thinking: 0, stop: 'length' }, 36000), 'REPLY_TRUNCATED');
});

test('REASONING_EXHAUSTED on a panel seat: no bigger-cap retry is paid for, and the seat abstains, never consents', async () => {
  const { setCache, setBudget } = await import('../src/chain.js');
  const asked = [];
  setBudget(null);
  setCache({ get: label => {
    asked.push(label);
    return /^panel-\d+-ds/.test(label) ? { text: '', usage: FIRST_ATTEMPT, usd: 0, provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' } : null;
  } });
  try {
    const r = await runChain({ request: 'R', draft: 'REVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.', log: () => {}, config: {
      name: 'rx', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'],
      seats: { critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'ok' }, { provider: 'mock', model: 'm', lab: 'ds', maxTokens: 36000 }] },
    } });
    assert.ok(!asked.some(l => /-retry$/.test(l)), `no bigger-cap retry: ${asked.join(', ')}`);
    const ds = r.signoff.find(s => s.provider === 'ds');
    assert.equal(ds.signedOff, null);
    assert.equal(ds.reason_code, 'REASONING_EXHAUSTED');
    assert.equal(r.passed, false);
  } finally { setCache(null); }
});
