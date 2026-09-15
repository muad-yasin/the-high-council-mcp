// test/verdict-diff.test.js
//
// Pure diff logic shared by --rematch (item C) and --replay (item D) of the v6 harness-feature
// round. No file I/O, no network, no chain execution - just the five-field shape against two
// report.json-shaped objects.
//
// src/verdict-diff.js and schemas/verdict-diff.json in this worktree are a byte-identical copy
// of item C's already-shipped versions on master (commit 1e681b6, "Add --rematch..."), pulled
// in deliberately once discovered - see this build's final report for why. These tests exercise
// that shared module's real API: `signoff_match` reads `report.passed` directly, and seat
// identity is positional (`critic-0`, `critic-1`, ...), not provider/model - a rematch/replay
// changes which model backs a seat, so a lab-name label would spuriously read as "critic
// removed, critic added" on every model swap even when the seat's own verdict didn't change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeVerdictDiff } from '../src/verdict-diff.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, '../schemas/verdict-diff.json'), 'utf8'));

function assertMatchesSchema(diff) {
  assert.deepEqual(Object.keys(diff).sort(), schema.required.slice().sort());
  assert.equal(typeof diff.signoff_match, 'boolean');
  assert.equal(typeof diff.verdict_category_changed, 'boolean');
  assert.ok(Array.isArray(diff.critics_objecting_added));
  assert.ok(diff.critics_objecting_added.every(s => typeof s === 'string' && /^critic-[0-9]+$/.test(s)));
  assert.ok(Array.isArray(diff.critics_objecting_removed));
  assert.ok(diff.critics_objecting_removed.every(s => typeof s === 'string' && /^critic-[0-9]+$/.test(s)));
  assert.equal(typeof diff.objection_overlap_ratio, 'number');
  assert.ok(diff.objection_overlap_ratio >= 0 && diff.objection_overlap_ratio <= 1);
}

function report({ passed, outcome, signoff }) {
  return { passed, outcome, signoff };
}

test('test_verdict_diff_identical_runs: no change reads as no change', () => {
  const r = report({
    passed: true,
    outcome: 'consensus',
    signoff: [
      { provider: 'a', model: 'a1', signedOff: true, objections: [] },
      { provider: 'b', model: 'b1', signedOff: true, objections: [] },
    ],
  });
  const diff = computeVerdictDiff(r, r);
  assertMatchesSchema(diff);
  assert.equal(diff.signoff_match, true);
  assert.equal(diff.verdict_category_changed, false);
  assert.deepEqual(diff.critics_objecting_added, []);
  assert.deepEqual(diff.critics_objecting_removed, []);
  assert.equal(diff.objection_overlap_ratio, 1); // both empty objection sets
});

test('test_verdict_diff_new_objector: the seat at index 1 signed off originally, objects now', () => {
  const original = report({
    passed: true,
    outcome: 'consensus',
    signoff: [
      { provider: 'a', model: 'a1', signedOff: true, objections: [] },
      { provider: 'b', model: 'b1', signedOff: true, objections: [] },
    ],
  });
  const next = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [
      { provider: 'a', model: 'a1', signedOff: true, objections: [] },
      { provider: 'b', model: 'b1', signedOff: false, objections: [{ criterion: 'x', problem: 'missing edge case' }] },
    ],
  });
  const diff = computeVerdictDiff(original, next);
  assertMatchesSchema(diff);
  assert.equal(diff.signoff_match, false);
  assert.equal(diff.verdict_category_changed, true);
  assert.deepEqual(diff.critics_objecting_added, ['critic-1']);
  assert.deepEqual(diff.critics_objecting_removed, []);
  assert.equal(diff.objection_overlap_ratio, 0); // original had zero objection texts
});

test('test_verdict_diff_objector_resolved: the seat at index 0 objected originally, signs off now', () => {
  const original = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [{ provider: 'a', model: 'a1', signedOff: false, objections: [{ criterion: 'x', problem: 'too slow' }] }],
  });
  const next = report({
    passed: true,
    outcome: 'consensus',
    signoff: [{ provider: 'a', model: 'a1', signedOff: true, objections: [] }],
  });
  const diff = computeVerdictDiff(original, next);
  assertMatchesSchema(diff);
  assert.deepEqual(diff.critics_objecting_added, []);
  assert.deepEqual(diff.critics_objecting_removed, ['critic-0']);
});

test('test_verdict_diff_seat_position_not_lab_name: a model swap at the same seat is not a critic add/remove', () => {
  // Same seat position (index 0), same verdict (objecting both times), different provider/model
  // entirely - this must NOT show up as "critic-0 removed, critic-0 added" or any add/remove at
  // all, which is exactly the failure mode positional labeling exists to avoid.
  const original = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [{ provider: 'anthropic', model: 'old-model', signedOff: false, objections: [{ criterion: 'x', problem: 'too slow' }] }],
  });
  const next = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [{ provider: 'openrouter', model: 'new-model', signedOff: false, objections: [{ criterion: 'x', problem: 'too slow' }] }],
  });
  const diff = computeVerdictDiff(original, next);
  assert.deepEqual(diff.critics_objecting_added, []);
  assert.deepEqual(diff.critics_objecting_removed, []);
});

test('test_verdict_diff_objection_overlap_exact_match: identical objection text overlaps fully', () => {
  const original = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [{ provider: 'a', model: 'a1', signedOff: false, objections: [{ criterion: 'x', problem: 'no tests' }] }],
  });
  const next = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [{ provider: 'a', model: 'a1', signedOff: false, objections: [{ criterion: 'x', problem: 'no tests' }] }],
  });
  const diff = computeVerdictDiff(original, next);
  assert.equal(diff.objection_overlap_ratio, 1);
});

test('test_verdict_diff_objection_overlap_partial: one shared, one new, one dropped -> 1/3', () => {
  const original = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [
      { provider: 'a', model: 'a1', signedOff: false, objections: [
        { criterion: 'x', problem: 'shared objection' },
        { criterion: 'y', problem: 'only in original' },
      ] },
    ],
  });
  const next = report({
    passed: false,
    outcome: 'no_consensus',
    signoff: [
      { provider: 'a', model: 'a1', signedOff: false, objections: [
        { criterion: 'x', problem: 'shared objection' },
        { criterion: 'z', problem: 'only in next' },
      ] },
    ],
  });
  const diff = computeVerdictDiff(original, next);
  // union = {shared, only-in-original, only-in-next} = 3, intersection = {shared} = 1
  assert.equal(diff.objection_overlap_ratio, 1 / 3);
});

test('test_verdict_diff_abstention_not_objection: signedOff null is not counted as objecting', () => {
  const original = report({
    passed: false,
    outcome: 'degraded',
    signoff: [{ provider: 'a', model: 'a1', signedOff: null, objections: null, passed: false }],
  });
  const next = report({
    passed: false,
    outcome: 'degraded',
    signoff: [{ provider: 'a', model: 'a1', signedOff: null, objections: null, passed: false }],
  });
  const diff = computeVerdictDiff(original, next);
  assertMatchesSchema(diff);
  assert.deepEqual(diff.critics_objecting_added, []);
  assert.deepEqual(diff.critics_objecting_removed, []);
  assert.equal(diff.signoff_match, true); // both reports' top-level `passed` are false
});

test('test_verdict_diff_never_makes_an_efficacy_claim: no field name or value is a comparative word', () => {
  const diff = computeVerdictDiff(
    report({ passed: false, outcome: 'no_consensus', signoff: [{ provider: 'a', model: 'a1', signedOff: false, objections: [] }] }),
    report({ passed: true, outcome: 'consensus', signoff: [{ provider: 'a', model: 'a1', signedOff: true, objections: [] }] }),
  );
  const serialized = JSON.stringify(diff);
  assert.doesNotMatch(serialized, /better|outperform|superior|proves|wins|more accurate/i);
});

test('test_verdict_diff_missing_signoff_degrades_gracefully: malformed report never throws', () => {
  assert.doesNotThrow(() => computeVerdictDiff({}, {}));
  const diff = computeVerdictDiff({}, {});
  assertMatchesSchema(diff);
  assert.equal(diff.objection_overlap_ratio, 1);
  assert.equal(diff.signoff_match, true); // undefined === undefined
});
