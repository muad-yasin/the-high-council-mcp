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
  const result = validateDeliverable('panel', JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' }));
  assert.equal(result.ok, true);
});

// Regression, 2026-09-15: thcmcp-66 reported "PARTIAL OUTPUT WARNING: missing required
// field(s): verdict, objections" on all three panel stages of a real run
// (relay/runs/2026-09-15T18-55-34-601Z), every one a clean SIGNED OFF verdict with reasoning.
// Root cause, confirmed by reading the real prompt and parser, not assumed from the warning
// text: `verdict`/`objections` never existed in the real critic schema - CRITIC_SYSTEM_TEMPLATE
// (src/roles.js) has always asked for `{ meets, criteria, failures, verdict_line }`, and
// normaliseCritique (src/chain.js) has always read `criteria`/`failures`. The check above (using
// the correct field names) would have caught this immediately had the fixture matched a real
// reply instead of an imaginary schema - this test pins a byte-real reply (the exact content of
// that run's panel-1-glm.md, fence and all) so the fixture can never silently drift from reality
// again the same way.
test('regression: a real critic reply (relay/runs/2026-09-15T18-55-34-601Z/panel-1-glm.md) is not flagged as partial', () => {
  const realReply = `\`\`\`json
{
  "meets": true,
  "criteria": [
    { "criterion": "Question 1 (family model) is debated explicitly and resolved with a stated decision plus reasoning, not silently decided by omission or folded unnoticed into the polish list.", "verdict": "MET", "evidence": "Section 1 opens with a bolded decision." }
  ],
  "failures": [],
  "verdict_line": "All fourteen acceptance criteria are met."
}
\`\`\``;
  const result = validateDeliverable('panel', realReply);
  assert.equal(result.ok, true, `expected a real, well-formed critic reply to pass; got: ${result.reason}`);
});

test('a genuinely broken panel reply (missing criteria and failures) is still flagged - the fix narrows the schema, it does not remove the check', () => {
  const result = validateDeliverable('panel', JSON.stringify({ meets: true, verdict_line: 'looks fine' }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['criteria', 'failures']);
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
