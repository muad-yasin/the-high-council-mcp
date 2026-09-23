// relay/test/cache-integrity.test.js
//
// v2 plan §7.2 (GLM-6 primary design). Same class of bug as the lab-dropout fix: a "successful"
// result (a cache hit) shown that does not correspond to a full, current execution - because
// the task text or chain config changed between when the stage was cached and now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintInputs, cacheVerdict, promptHashOf } from '../src/cache-integrity.js';

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

// withStalenessCheck was exported and tested here but never called by the harness (pre-release
// cache audit, backlog), so these tests covered nothing that ran. The decision chain.js actually
// makes is cacheVerdict(); the CLI supplies `staleInputs` from the fingerprint above.
const P = promptHashOf('system', 'user');

test('test_cache_invalidated_on_criteria_change: a hit whose task/config fingerprint changed is stale', () => {
  assert.equal(cacheVerdict({ text: 'x', staleInputs: true, promptHash: P }, P).status, 'stale');
});

test('a hit that answered the same prompt is fresh; a different prompt is stale', () => {
  assert.equal(cacheVerdict({ text: 'x', inputsFingerprint: 'f', promptHash: P }, P).status, 'fresh');
  assert.equal(cacheVerdict({ text: 'x', inputsFingerprint: 'f', promptHash: P }, promptHashOf('system', 'other')).status, 'stale');
});

test('cache audit #1: a hit with no record of its inputs at all is stale, not trusted', () => {
  assert.equal(cacheVerdict({ text: 'legacy cache entry', fromDisk: true }, P).status, 'stale');
  // A caller's own in-memory cache records nothing by construction: trusted, but unverified.
  assert.equal(cacheVerdict({ text: 'in-memory entry' }, P).status, 'unverified');
});

test('cache audit #1: a hit from between the two fixes (fingerprint, no prompt hash) is trusted but unverified', () => {
  const v = cacheVerdict({ text: 'x', inputsFingerprint: 'f' }, P);
  assert.equal(v.status, 'unverified');
  assert.match(v.why, /prompt/);
});
