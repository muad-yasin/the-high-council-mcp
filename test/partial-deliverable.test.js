// relay/test/partial-deliverable.test.js
//
// v2 plan §7.1 (GLM-6 primary design, DEEPSEEK-6's schema/required-field validation kept).
// Same class of bug as the lab-dropout fix this project already shipped: a "successful"
// result that does not actually correspond to a full, correct stage output. This pins that
// a missing required field (structured stages) or empty text (freeform stages) is caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeliverable } from '../src/partial-deliverable.js';

test('test_partial_deliverable_not_marked_complete: a structured stage missing a required field is flagged', () => {
  const result = validateDeliverable('criteria', JSON.stringify({ notCriteria: [] }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['criteria']);
});

test('a structured stage with every required field present passes', () => {
  const result = validateDeliverable('panel', JSON.stringify({ verdict: 'pass', objections: [] }));
  assert.equal(result.ok, true);
});

test('unreadable JSON on a structured stage is flagged, not silently accepted', () => {
  const result = validateDeliverable('criteria', 'this is not JSON at all');
  assert.equal(result.ok, false);
  assert.match(result.reason, /not readable as JSON/);
});

test('a freeform stage with empty text is flagged', () => {
  const result = validateDeliverable('build', '   \n  ');
  assert.equal(result.ok, false);
  assert.match(result.reason, /empty or missing/);
});

test('a freeform stage with real content passes', () => {
  const result = validateDeliverable('build', '# A real draft\n\nContent here.');
  assert.equal(result.ok, true);
});
