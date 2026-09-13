// relay/test/cache-integrity.test.js
//
// v2 plan §7.2 (GLM-6 primary design). Same class of bug as the lab-dropout fix: a "successful"
// result (a cache hit) shown that does not correspond to a full, current execution - because
// the task text or chain config changed between when the stage was cached and now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintInputs, withStalenessCheck } from '../src/cache-integrity.js';

test('fingerprintInputs changes when the task text changes, stable otherwise', () => {
  const config = { name: 'verify' };
  const a = fingerprintInputs('original task text', config);
  const b = fingerprintInputs('original task text', config);
  const c = fingerprintInputs('edited task text', config);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('fingerprintInputs changes when the chain config changes', () => {
  const a = fingerprintInputs('task', { maxRounds: 2 });
  const b = fingerprintInputs('task', { maxRounds: 3 });
  assert.notEqual(a, b);
});

test('test_cache_invalidated_on_criteria_change: a hit fingerprinted against old inputs is treated as a miss', () => {
  const oldFingerprint = fingerprintInputs('original task', { name: 'verify' });
  const currentFingerprint = fingerprintInputs('edited task', { name: 'verify' });
  let staleLabel = null;
  const wrapped = withStalenessCheck(
    () => ({ text: 'cached criteria output', inputsFingerprint: oldFingerprint }),
    currentFingerprint,
    label => { staleLabel = label; },
  );
  const result = wrapped('criteria');
  assert.equal(result, null, 'a stale hit must be treated as a miss so chain.js re-runs the stage');
  assert.equal(staleLabel, 'criteria', 'the staleness callback must name which stage was invalidated');
});

test('a hit fingerprinted against current inputs is still served from cache', () => {
  const fp = fingerprintInputs('task', { name: 'verify' });
  const wrapped = withStalenessCheck(() => ({ text: 'cached', inputsFingerprint: fp }), fp, () => assert.fail('must not be called'));
  assert.deepEqual(wrapped('criteria'), { text: 'cached', inputsFingerprint: fp });
});

test('a cache miss stays a miss, and a hit with no fingerprint (pre-fix cache entry) is trusted rather than invalidated', () => {
  const currentFingerprint = fingerprintInputs('task', {});
  const wrapped = withStalenessCheck(() => null, currentFingerprint);
  assert.equal(wrapped('criteria'), null);
  const wrappedNoFingerprint = withStalenessCheck(() => ({ text: 'legacy cache entry' }), currentFingerprint, () => assert.fail('must not be called'));
  assert.deepEqual(wrappedNoFingerprint('criteria'), { text: 'legacy cache entry' });
});
