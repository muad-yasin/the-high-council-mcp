// relay/test/preflight.test.js
//
// v2 plan §6 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md, GLM-5 primary
// design). Real incident: a chain requiring an appended "Scope ledger" section against task
// text demanding a standalone, publication-ready document with no internal process record -
// two labs held out over exactly this on a real run (see docs/board.html). This pins the
// catch, and pins the known miss by name so it can never be quietly "fixed" into a false
// sense of completeness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightCheck, requiredDeliverableSections } from '../src/preflight.js';

test('requiredDeliverableSections: proposal-mode chains require a Scope ledger, others require nothing', () => {
  assert.deepEqual(requiredDeliverableSections({ proposals: { parts: 3 } }), ['Scope ledger']);
  assert.deepEqual(requiredDeliverableSections({}), []);
});

test('test_preflight_catches_keyword_conflict: names both the required section and the matched phrase, zero API calls needed', () => {
  const chainConfig = { proposals: { parts: 3 } };
  const criteriaText = 'The deliverable must be a standalone, publication-ready document.';
  const warnings = preflightCheck(chainConfig, criteriaText);
  assert.equal(warnings.length > 0, true);
  assert.ok(warnings.some(w => w.section === 'Scope ledger' && w.keyword === 'standalone'));
  assert.ok(warnings.some(w => w.keyword === 'publication-ready'));
  for (const w of warnings) assert.match(w.message, /Scope ledger/);
  // This function is pure text matching - the mere fact it returns synchronously
  // with no network dependency is the "zero API calls" property the test asks to pin.
});

test('test_preflight_known_misses_semantic_conflicts: the same conflict, rephrased without trigger words, passes with no warning', () => {
  const chainConfig = { proposals: { parts: 3 } };
  // Same semantic conflict as above, deliberately avoiding every trigger keyword.
  const criteriaText = 'The deliverable must be readable with no other file open and no extra material appended at the end.';
  const warnings = preflightCheck(chainConfig, criteriaText);
  assert.deepEqual(warnings, [], 'a rephrased conflict with no trigger keyword must pass with no warning - this is a known, accepted limitation, not a bug to silently patch');
});

test('a chain with no required sections never warns, regardless of the text', () => {
  const warnings = preflightCheck({}, 'must be a standalone, publication-ready, self-contained document');
  assert.deepEqual(warnings, []);
});
