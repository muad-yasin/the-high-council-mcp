// Item C (blind rematch) / item D (council replay) shared diff module -
// relay/runs/2026-09-15T15-12-52-325Z/deliverable.md. Unit tests against src/verdict-diff.js's
// pure computeVerdictDiff(), validated against schemas/verdict-diff.json's own required-field
// list so the two never drift apart silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeVerdictDiff } from '../src/verdict-diff.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '../schemas/verdict-diff.json'), 'utf8'));

function signoff(entries) {
  return entries.map(([signedOff, objections]) => ({ signedOff, objections: objections ?? null }));
}

test('1. identical reports: signoff matches, no category change, no added/removed objectors, full overlap', () => {
  const report = { passed: true, outcome: 'consensus', signoff: signoff([[true, null], [true, null]]) };
  const diff = computeVerdictDiff(report, report);
  assert.deepEqual(diff, {
    signoff_match: true, verdict_category_changed: false,
    critics_objecting_added: [], critics_objecting_removed: [], objection_overlap_ratio: 1,
  });
});

test('2. every field named in schemas/verdict-diff.json is present on the diff, and nothing extra', () => {
  const report = { passed: true, outcome: 'consensus', signoff: signoff([[true, null]]) };
  const diff = computeVerdictDiff(report, report);
  assert.deepEqual(Object.keys(diff).sort(), schema.required.slice().sort());
});

test('3. a critic that objects in the new report but signed off in the original -> added, not removed', () => {
  const original = { passed: true, outcome: 'consensus', signoff: signoff([[true, null], [true, null]]) };
  const rematch = { passed: false, outcome: 'no_consensus', signoff: signoff([[true, null], [false, [{ criterion: 'x', problem: 'new problem' }]]]) };
  const diff = computeVerdictDiff(original, rematch);
  assert.equal(diff.signoff_match, false);
  assert.equal(diff.verdict_category_changed, true);
  assert.deepEqual(diff.critics_objecting_added, ['critic-1']);
  assert.deepEqual(diff.critics_objecting_removed, []);
});

test('4. a critic that signed off in the new report but objected originally -> removed, not added', () => {
  const original = { passed: false, outcome: 'no_consensus', signoff: signoff([[false, [{ criterion: 'x', problem: 'p' }]], [true, null]]) };
  const rematch = { passed: true, outcome: 'consensus', signoff: signoff([[true, null], [true, null]]) };
  const diff = computeVerdictDiff(original, rematch);
  assert.deepEqual(diff.critics_objecting_added, []);
  assert.deepEqual(diff.critics_objecting_removed, ['critic-0']);
});

test('5. objection_overlap_ratio is exact-string-match Jaccard: half-shared objection texts -> 1/3', () => {
  const original = { passed: false, outcome: 'no_consensus', signoff: signoff([[false, [{ criterion: 'a', problem: 'shared problem' }, { criterion: 'b', problem: 'only in original' }]]]) };
  const rematch = { passed: false, outcome: 'no_consensus', signoff: signoff([[false, [{ criterion: 'a', problem: 'shared problem' }, { criterion: 'c', problem: 'only in rematch' }]]]) };
  const diff = computeVerdictDiff(original, rematch);
  // union = {shared problem, only in original, only in rematch} = 3; intersection = {shared problem} = 1.
  assert.equal(diff.objection_overlap_ratio, 1 / 3);
});

test('6. both reports raising zero objections -> overlap ratio 1, not division-by-zero NaN', () => {
  const report = { passed: true, outcome: 'consensus', signoff: signoff([[true, null], [true, null]]) };
  const diff = computeVerdictDiff(report, report);
  assert.equal(diff.objection_overlap_ratio, 1);
});

test('7. an outcome change from consensus to degraded is caught even when passed happens to stay the same value on both sides is not the case here - passed differs too', () => {
  const original = { passed: true, outcome: 'consensus', signoff: signoff([[true, null]]) };
  const rematch = { passed: false, outcome: 'degraded', signoff: signoff([[null, null]]) };
  const diff = computeVerdictDiff(original, rematch);
  assert.equal(diff.verdict_category_changed, true);
  assert.equal(diff.signoff_match, false);
});

test('8. missing signoff array on either side degrades to empty roles/objections rather than throwing', () => {
  const original = { passed: true, outcome: 'consensus' };
  const rematch = { passed: true, outcome: 'consensus', signoff: signoff([[true, null]]) };
  assert.doesNotThrow(() => computeVerdictDiff(original, rematch));
});

test('9. seat-role ids are positional (critic-N), matching the schema pattern, never a lab name', () => {
  const original = { passed: false, outcome: 'no_consensus', signoff: signoff([[false, [{ criterion: 'x', problem: 'p' }]]]) };
  const rematch = { passed: true, outcome: 'consensus', signoff: signoff([[true, null]]) };
  const diff = computeVerdictDiff(original, rematch);
  for (const role of [...diff.critics_objecting_added, ...diff.critics_objecting_removed]) {
    assert.match(role, /^critic-\d+$/);
  }
});

test('10. objections with no problem field are ignored, not treated as empty-string objection text', () => {
  const original = { passed: false, outcome: 'no_consensus', signoff: signoff([[false, [{ criterion: 'x' }]]]) };
  const rematch = { passed: false, outcome: 'no_consensus', signoff: signoff([[false, [{ criterion: 'y' }]]]) };
  const diff = computeVerdictDiff(original, rematch);
  assert.equal(diff.objection_overlap_ratio, 1);
});
